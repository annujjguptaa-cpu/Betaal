/* extension/rag-retrieval.js — Modules 85 & 86
 *
 * RAG Structural Signature & Vault Similarity Retrieval
 * PRIVACY GUARANTEE: Does NOT store or extract any field values, user inputs, or PII.
 * Only extracts structural metadata: field counts, field types, and button labels.
 */

/**
 * Computes a structural signature object from the DOM structure array.
 * @param {Array<Object>} domStructure - Array of DOM element objects from GET_DOM_STRUCTURE
 * @returns {{fieldCount: number, fieldTypes: string[], buttonLabels: string[]}}
 */
function computeStructuralSignature(domStructure = []) {
  if (!Array.isArray(domStructure)) {
    return { fieldCount: 0, fieldTypes: [], buttonLabels: [] };
  }

  const fieldTypesSet = new Set();
  const buttonLabelsSet = new Set();
  let fieldCount = 0;

  for (const item of domStructure) {
    if (!item) continue;
    fieldCount++;

    // Collect type / tag signature
    const typeOrTag = (item.type || item.tag || 'element').toLowerCase();
    fieldTypesSet.add(typeOrTag);

    // Collect button / submit labels (lowercased, trimmed)
    const isButton = item.tag === 'button' || item.type === 'submit' || item.type === 'button' || (item.role && item.role === 'button');
    const labelText = (item.text || item.value || item.placeholder || '').trim().toLowerCase();
    if (isButton && labelText) {
      buttonLabelsSet.add(labelText);
    }
  }

  return {
    fieldCount,
    fieldTypes: Array.from(fieldTypesSet).sort(),
    buttonLabels: Array.from(buttonLabelsSet).sort()
  };
}

/**
 * Calculates Jaccard similarity (intersection size / union size) between two arrays of strings.
 * @param {string[]} arrA 
 * @param {string[]} arrB 
 * @returns {number} Score between 0.0 and 1.0
 */
function calculateJaccardSimilarity(arrA = [], arrB = []) {
  const setA = new Set(arrA.map(s => String(s).toLowerCase()));
  const setB = new Set(arrB.map(s => String(s).toLowerCase()));

  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersectionSize = 0;
  for (const elem of setA) {
    if (setB.has(elem)) intersectionSize++;
  }

  const unionSize = new Set([...setA, ...setB]).size;
  return unionSize > 0 ? intersectionSize / unionSize : 0.0;
}

/**
 * Calculates overlap of keywords in button labels between two lists of button labels.
 * @param {string[]} labelsA 
 * @param {string[]} labelsB 
 * @returns {number} Score between 0.0 and 1.0
 */
function calculateButtonOverlap(labelsA = [], labelsB = []) {
  const wordsA = labelsA.flatMap(l => l.split(/\s+/)).filter(Boolean);
  const wordsB = labelsB.flatMap(l => l.split(/\s+/)).filter(Boolean);
  return calculateJaccardSimilarity(wordsA, wordsB);
}

/**
 * Calculates similarity score (0 to 1) between two structural signatures.
 * Combines field-type Jaccard similarity, button-label overlap, and field-count difference penalty.
 * @param {{fieldCount: number, fieldTypes: string[], buttonLabels: string[]}} sigA 
 * @param {{fieldCount: number, fieldTypes: string[], buttonLabels: string[]}} sigB 
 * @returns {number} Similarity score between 0.0 and 1.0
 */
function scoreSimilarity(sigA, sigB) {
  if (!sigA || !sigB) return 0.0;

  const typeSim = calculateJaccardSimilarity(sigA.fieldTypes, sigB.fieldTypes);
  const btnSim = calculateButtonOverlap(sigA.buttonLabels, sigB.buttonLabels);

  // Field count penalty: 1 - |countA - countB| / max(countA, countB, 1)
  const maxCount = Math.max(sigA.fieldCount || 0, sigB.fieldCount || 0, 1);
  const diff = Math.abs((sigA.fieldCount || 0) - (sigB.fieldCount || 0));
  const countRatio = Math.max(0, 1 - (diff / maxCount));

  // Weighted combination: 50% field types, 30% button labels, 20% count similarity
  const score = (typeSim * 0.50) + (btnSim * 0.30) + (countRatio * 0.20);
  return Math.round(score * 1000) / 1000;
}

/**
 * Retrieves the top N structurally similar successful (outcome: 'completed') Vault entries.
 * Reads Vault entries from chrome.storage.local safely.
 * @param {{fieldCount: number, fieldTypes: string[], buttonLabels: string[]}} currentSignature 
 * @param {number} topN - Default 3
 * @returns {Promise<Array<{fieldTypes: string[], buttonLabels: string[], actionsTaken: string[], score: number}>>}
 */
async function retrieveSimilarEntries(currentSignature, topN = 3) {
  if (!currentSignature) return [];

  try {
    let vault = [];
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(['vault']);
      vault = Array.isArray(res.vault) ? res.vault : [];
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      const res = await browser.storage.local.get(['vault']);
      vault = Array.isArray(res.vault) ? res.vault : [];
    }

    if (!Array.isArray(vault) || vault.length === 0) {
      return [];
    }

    // Filter strictly to outcome: 'completed' (Module 86)
    const completedEntries = vault.filter(entry => entry && entry.outcome === 'completed');

    if (completedEntries.length === 0) {
      return [];
    }

    const scored = completedEntries.map(entry => {
      // Reconstruct or use stored signature
      let sig = entry.structuralSignature;
      if (!sig) {
        // Fallback: estimate signature if not stored directly
        sig = {
          fieldCount: (entry.actionsTaken || []).length || 5,
          fieldTypes: ['text', 'button'],
          buttonLabels: ['submit', 'continue']
        };
      }

      const score = scoreSimilarity(currentSignature, sig);
      return {
        fieldTypes: sig.fieldTypes || [],
        buttonLabels: sig.buttonLabels || [],
        actionsTaken: entry.actionsTaken || [],
        score
      };
    });

    // Sort descending by similarity score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN);

  } catch (err) {
    console.warn('[RAG Retrieval] Error retrieving vault entries:', err);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeStructuralSignature,
    calculateJaccardSimilarity,
    calculateButtonOverlap,
    scoreSimilarity,
    retrieveSimilarEntries
  };
}
