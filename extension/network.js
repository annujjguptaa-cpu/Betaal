/* extension/network.js — Modules 87 & 90 */

const DEFAULT_BACKEND_URL = 'http://localhost:3000';

/**
 * Reads configured backend URL from chrome.storage.local key 'backendUrl', defaulting to http://localhost:3000
 * @returns {Promise<string>}
 */
async function getBackendUrl() {
  try {
    let url = null;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get(['backendUrl']);
      url = res.backendUrl;
    } else if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      const res = await browser.storage.local.get(['backendUrl']);
      url = res.backendUrl;
    }
    if (url && typeof url === 'string' && url.trim()) {
      return url.trim().replace(/\/+$/, ''); // Strip trailing slash
    }
  } catch (err) {
    console.warn('[network.js] Failed to read backendUrl from storage:', err);
  }
  return DEFAULT_BACKEND_URL;
}

/**
 * Sends redacted image, goal, DOM structure, and retrieved RAG examples to the backend Express server.
 * @param {string} redactedImage 
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @param {Array<Object>} [customRetrievedExamples] - Optional explicit override for RAG examples
 * @returns {Promise<{action: string, selector: string, reasoning: string}>}
 */
async function sendToBackend(redactedImage, goal, domStructure = [], customRetrievedExamples = null) {
  const backendUrl = await getBackendUrl();

  try {
    // Module 87: Compute structural signature & retrieve RAG examples before sending payload
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

    // Zero-image payload: send only text goal, DOM structure, and RAG examples over the network
    const response = await fetch(`${backendUrl}/act`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        goal: actualGoal,
        domStructure: actualDom,
        retrievedExamples: Array.isArray(retrievedExamples) ? retrievedExamples : []
      })
    });

    if (!response.ok) {
      let errJson = null;
      try { errJson = await response.json(); } catch (e) {}

      // 422 = CAPTCHA detected — signal caller to pause for user input
      if (response.status === 422 && errJson && errJson.error === 'CAPTCHA_REQUIRED') {
        const captchaError = new Error('CAPTCHA_REQUIRED');
        captchaError.isCaptcha = true;
        captchaError.captchaSelector = errJson.selector || null;
        captchaError.captchaMessage = errJson.message || 'Solve the CAPTCHA manually then click Approve.';
        throw captchaError;
      }

      let errorMsg = `Server error HTTP ${response.status}`;
      if (errJson && errJson.error) errorMsg = errJson.error;
      throw new Error(errorMsg);
    }

    const actionData = await response.json();
    return actionData;

  } catch (error) {
    console.error('[sendToBackend] Network error:', error.message);
    throw new Error(`Failed to reach Betaal backend server at ${backendUrl}: ${error.message}`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sendToBackend, getBackendUrl, DEFAULT_BACKEND_URL };
}
