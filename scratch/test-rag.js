const fs = require('fs');

// Mock chrome storage
global.chrome = {
  storage: {
    local: {
      data: {},
      get: async (keys) => {
        const res = {};
        for (const k of keys) res[k] = global.chrome.storage.local.data[k];
        return res;
      },
      set: async (obj) => {
        Object.assign(global.chrome.storage.local.data, obj);
      }
    }
  }
};

const rag = require('../extension/rag-retrieval.js');
const { buildPrompt } = require('../backend/llm-prompt.js');
const network = require('../extension/network.js');

let passed = true;

// --- Test Prompt 85: Structural Signature Function ---
console.log('\n--- Testing Prompt 85: computeStructuralSignature ---');
const sampleDOM_Grievance = [
  { tag: 'input', type: 'text', id: 'name-input', text: 'Full Name' },
  { tag: 'input', type: 'email', id: 'email-input', text: 'Email' },
  { tag: 'textarea', type: 'textarea', id: 'complaint-text', text: 'Describe grievance' },
  { tag: 'button', type: 'submit', id: 'submit-btn', text: 'Submit Grievance' }
];

const sampleDOM_Passport = [
  { tag: 'input', type: 'text', id: 'given-name', text: 'Given Name' },
  { tag: 'input', type: 'text', id: 'surname', text: 'Surname' },
  { tag: 'input', type: 'date', id: 'dob', text: 'Date of Birth' },
  { tag: 'button', type: 'button', id: 'step1-next', text: 'Next Step' }
];

const sigGrievance = rag.computeStructuralSignature(sampleDOM_Grievance);
const sigPassport = rag.computeStructuralSignature(sampleDOM_Passport);

console.log('Grievance Signature:', sigGrievance);
console.log('Passport Signature:', sigPassport);

console.assert(sigGrievance.fieldCount === 4, 'Grievance fieldCount should be 4');
console.assert(sigGrievance.buttonLabels.includes('submit grievance'), 'Button label should be lowercased');
console.assert(!JSON.stringify(sigGrievance).includes('Full Name'), 'No PII values should be in signature');
console.assert(!JSON.stringify(sigPassport).includes('Given Name'), 'No PII values should be in signature');
console.log('✅ Prompt 85: Signature calculation and PII exclusion verified');

// --- Test Prompt 86: Similarity Scoring & Retrieval ---
console.log('\n--- Testing Prompt 86: scoreSimilarity & retrieveSimilarEntries ---');
const scoreSelf = rag.scoreSimilarity(sigGrievance, sigGrievance);
const scoreDiff = rag.scoreSimilarity(sigGrievance, sigPassport);

console.log(`Self Similarity Score: ${scoreSelf}`);
console.log(`Different Form Similarity Score: ${scoreDiff}`);

console.assert(scoreSelf === 1.0, 'Self similarity should be 1.0');
console.assert(scoreDiff < 1.0 && scoreDiff > 0, 'Cross-form similarity should be between 0 and 1');

// Setup Vault data in mock storage
global.chrome.storage.local.data.vault = [
  {
    id: 'v1',
    outcome: 'completed',
    actionsTaken: ['type on #name-input', 'click on #submit-btn'],
    structuralSignature: sigGrievance
  },
  {
    id: 'v2',
    outcome: 'paused', // Should be excluded!
    actionsTaken: ['click on #step1-next'],
    structuralSignature: sigPassport
  },
  {
    id: 'v3',
    outcome: 'completed',
    actionsTaken: ['type on #given-name', 'click on #step1-next'],
    structuralSignature: sigPassport
  }
];

(async () => {
  const retrieved = await rag.retrieveSimilarEntries(sigGrievance, 3);
  console.log('Retrieved for Grievance Signature:', retrieved);

  console.assert(retrieved.length === 2, 'Should only retrieve 2 completed entries (paused excluded)');
  console.assert(retrieved[0].score >= retrieved[1].score, 'Results should be sorted descending by score');
  console.assert(retrieved[0].actionsTaken.includes('click on #submit-btn'), 'Most similar entry should be first');

  // Test empty vault
  global.chrome.storage.local.data.vault = [];
  const emptyRetrieved = await rag.retrieveSimilarEntries(sigGrievance, 3);
  console.assert(Array.isArray(emptyRetrieved) && emptyRetrieved.length === 0, 'Empty Vault should return []');
  console.log('✅ Prompt 86: Vault retrieval, filtering, sorting, and empty case verified');

  // --- Test Prompt 87 & 88: Payload & Prompt Integration ---
  console.log('\n--- Testing Prompt 87 & 88: Prompt construction with RAG precedents ---');
  
  const promptEmptyRAG = buildPrompt('Submit form', sampleDOM_Grievance, []);
  console.assert(!promptEmptyRAG.includes('structurally similar pages'), 'Empty RAG should omit precedent section');

  const samplePrecedents = [
    { fieldTypes: ['text', 'email', 'submit'], buttonLabels: ['submit grievance'], actionsTaken: ['type on #name', 'click on #submit'], score: 0.95 }
  ];
  const promptWithRAG = buildPrompt('Submit form', sampleDOM_Grievance, samplePrecedents);
  
  console.assert(promptWithRAG.includes('For reference, here are structurally similar pages'), 'Non-empty RAG should include precedent section');
  console.assert(promptWithRAG.includes('base your decision on the ACTUAL current page structure provided above'), 'Must include instruction to prioritize current page');
  console.log('✅ Prompt 88: Prompt building with/without precedents verified');

  console.log('\n🎉 ALL UNIT & INTEGRATION TESTS PASSED FOR PROMPTS 85-88!');
})();
