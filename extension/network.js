/* extension/network.js */

const BACKEND_URL = 'http://localhost:3000';

/**
 * Sends redacted image, goal, and DOM structure to the backend Express server.
 * @param {string} redactedImage 
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @returns {Promise<{action: string, selector: string, reasoning: string}>}
 */
async function sendToBackend(redactedImage, goal, domStructure = []) {
  try {
    const response = await fetch(`${BACKEND_URL}/act`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        goal,
        redactedImage,
        domStructure
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
