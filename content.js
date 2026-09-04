/* content.js */
console.log('Betaal content script loaded');

/**
 * Extracts non-sensitive structural DOM info from interactive elements.
 * @returns {Array<{tag: string, id: string, className: string, text: string, placeholder: string}>}
 */
function getDOMStructure() {
  let skippedIframeCounts = 0;

  // 1. Skip elements inside iframes safely (wrap iframe check in try/catch)
  const isInsideIframe = (el) => {
    try {
      let win = el.ownerDocument ? el.ownerDocument.defaultView : null;
      if (win && win !== window.top) {
        return true;
      }
    } catch (e) {
      skippedIframeCounts++;
      return true;
    }
    return false;
  };

  // Helper to test visibility using getBoundingClientRect
  const isVisible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
      return false;
    }
  };

  // Helper to extract fields recursively from a root (document or shadow root)
  const collectElements = (root) => {
    let collected = [];
    if (!root) return collected;

    // Check if iframe root check itself throws cross-origin error
    try {
      const nodes = root.querySelectorAll('*');
      nodes.forEach((node) => {
        if (isInsideIframe(node)) {
          return;
        }

        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (['input', 'textarea', 'select', 'button'].includes(tag)) {
          collected.push(node);
        }

        // Traverse shadow DOM root if accessible
        if (node.shadowRoot) {
          collected = collected.concat(collectElements(node.shadowRoot));
        }
      });
    } catch (err) {
      skippedIframeCounts++;
    }

    return collected;
  };

  const rawElements = collectElements(document);

  if (skippedIframeCounts > 0) {
    console.warn(`[Betaal DOM Extraction] Warning: Skipped ${skippedIframeCounts} elements/frames due to cross-origin or iframe isolation.`);
  }

  // Separate visible vs hidden
  const visibleList = [];
  const hiddenList = [];

  rawElements.forEach((el) => {
    if (isVisible(el)) {
      visibleList.push(el);
    } else {
      hiddenList.push(el);
    }
  });

  // Prioritize visible elements over hidden ones, capped at 50
  const prioritized = [...visibleList, ...hiddenList].slice(0, 50);

  return prioritized.map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className: el.className || '',
    text: el.innerText || (el.value && el.type === 'submit' ? el.value : ''),
    placeholder: el.placeholder || ''
  }));
}

// Listen for messages from background/popup
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    if (message.type === 'GET_DOM_STRUCTURE') {
      return { success: true, domStructure: getDOMStructure() };
    }

    if (message.type === 'EXECUTE_ACTION') {
      if (typeof executeAction !== 'undefined') {
        const result = await executeAction(message.action);
        return result;
      } else {
        return { success: false, error: 'executeAction function not loaded on page.' };
      }
    }
  } catch (err) {
    console.error('[ContentScript Message Error]:', err);
    return { success: false, error: err.message };
  }
});
