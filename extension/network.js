/* extension/network.js — Prompt 87 */

const BACKEND_URL = 'http://localhost:3000';

/**
 * Sends redacted image, goal, DOM structure, and retrieved RAG examples to the backend Express server.
 * @param {string} redactedImage 
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @param {Array<Object>} [customRetrievedExamples] - Optional explicit override for RAG examples
 * @returns {Promise<{action: string, selector: string, reasoning: string}>}
 */
async function sendToBackend(redactedImage, goal, domStructure = [], customRetrievedExamples = null) {
  try {
    // Prompt 87: Compute structural signature & retrieve RAG examples before sending payload
    let retrievedExamples = [];
    if (Array.isArray(customRetrievedExamples)) {
      retrievedExamples = customRetrievedExamples;
    } else if (typeof computeStructuralSignature === 'function' && typeof retrieveSimilarEntries === 'function') {
      try {
        const sig = computeStructuralSignature(domStructure);
        retrievedExamples = await retrieveSimilarEntries(sig, 3);
      } catch (ragErr) {
        console.warn('[sendToBackend] RAG retrieval warning:', ragErr);
        retrievedExamples = [];
      }
    }

    const response = await fetch(`${BACKEND_URL}/act`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        goal,
        redactedImage,
        domStructure,
        retrievedExamples: Array.isArray(retrievedExamples) ? retrievedExamples : []
      })
    });

    if (!response.ok) {
      let errorMsg = `Server error HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.error) errorMsg = errJson.error;
      } catch (e) {
        // Fallback to generic message
      }
      throw new Error(errorMsg);
    }

    const actionData = await response.json();
    return actionData;

  } catch (error) {
    console.error('[sendToBackend] Network error:', error.message);
    throw new Error(`Failed to reach Betaal backend server at ${BACKEND_URL}: ${error.message}`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sendToBackend, BACKEND_URL };
}
