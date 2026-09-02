/* content.js */
console.log('Betaal content script loaded');

/**
 * Extracts non-sensitive structural DOM info from interactive elements.
 * @returns {Array<{tag: string, id: string, className: string, text: string, placeholder: string}>}
 */
function getDOMStructure() {
  const elements = document.querySelectorAll('input, textarea, select, button');
  const structure = [];

  elements.forEach((el) => {
    // Exclude raw values of PII text inputs to strictly prevent raw data leakage
    structure.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      className: el.className || '',
      text: el.innerText || el.value && el.type === 'submit' ? el.value : '',
      placeholder: el.placeholder || ''
    });
  });

  return structure;
}

// Listen for messages from background/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'GET_DOM_STRUCTURE') {
      sendResponse({ success: true, domStructure: getDOMStructure() });
      return true;
    }

    if (message.type === 'EXECUTE_ACTION') {
      if (typeof executeAction !== 'undefined') {
        executeAction(message.action)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: err.message }));
      } else {
        sendResponse({ success: false, error: 'executeAction function not loaded on page.' });
      }
      return true;
    }
  } catch (err) {
    console.error('[ContentScript Message Error]:', err);
    sendResponse({ success: false, error: err.message });
    return true;
  }
});
