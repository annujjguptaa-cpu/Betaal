/* extension/action-executor.js */

/**
 * Executes a UI action returned by the VLM backend on the active web page.
 * Supported actions: 'click' | 'scroll' | 'type'
 * @param {{action: 'click'|'scroll'|'type', selector: string, value?: string, reasoning?: string}} action 
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function executeAction(action) {
  if (!action || !action.selector) {
    return { success: false, error: 'Invalid action object: Missing selector.' };
  }

  const el = document.querySelector(action.selector);
  if (!el) {
    console.warn(`[ActionExecutor] Selector not found on page: "${action.selector}"`);
    return {
      success: false,
      selectorNotFound: true,
      error: `The selector [${action.selector}] does not exist on this page.`
    };
  }

  // Visual highlight indicator (temporary 3px red outline)
  const originalOutline = el.style.outline;
  const originalTransition = el.style.transition;

  el.style.transition = 'outline 0.2s ease-in-out';
  el.style.outline = '3px solid #ef4444';

  // Wait 500ms for demo visual feedback
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    if (action.action === 'click') {
      console.log(`[ActionExecutor] Executing CLICK on selector: "${action.selector}"`);
      el.click();
    } else if (action.action === 'scroll') {
      console.log(`[ActionExecutor] Executing SCROLL on selector: "${action.selector}"`);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (action.action === 'type') {
      console.log(`[ActionExecutor] Executing TYPE on selector: "${action.selector}" with value: "${action.value || ''}"`);
      el.focus();
      el.value = action.value || '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.style.outline = originalOutline;
      return { success: false, error: 'Unsupported action type: ' + action.action };
    }

    // Reset outline after action execution delay
    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.transition = originalTransition;
    }, 1000);

    return { success: true };

  } catch (err) {
    el.style.outline = originalOutline;
    return { success: false, error: 'Failed to execute action: ' + err.message };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { executeAction };
}
