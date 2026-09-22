/* extension/action-executor.js — Prompt 84
 *
 * Executes a UI action returned by the VLM backend on the active web page.
 * Prompt 84: For 'type' actions, if 'valueSource' is present, the real value
 * is resolved locally via getProfileValue() from local-profile.js — the actual
 * sensitive data never travels over the network.
 *
 * Supported actions: 'click' | 'scroll' | 'type'
 * @param {{action: string, selector: string, value?: string, valueSource?: string, reasoning?: string}} action
 * @returns {Promise<{success: boolean, error?: string, valueResolution?: string}>}
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
      // Prompt 84: Local resolution path — value comes from local profile, never the network
      let resolvedValue = null;
      let valueResolution = 'vlm-provided'; // default: VLM sent a literal value

      if (action.valueSource) {
        // Resolve locally — getProfileValue() reads only from chrome.storage.local
        if (typeof getProfileValue === 'function') {
          resolvedValue = await getProfileValue(action.valueSource);
        } else {
          // Fallback: Try chrome.storage.local directly if function not in scope
          try {
            const result = await chrome.storage.local.get(['localProfile']);
            const profile = result.localProfile || {};
            resolvedValue = profile[action.valueSource] != null ? String(profile[action.valueSource]) : null;
          } catch (_) {}
        }

        if (resolvedValue != null) {
          valueResolution = 'local-profile'; // ✅ came from local store, never the network
          console.log(
            `[ActionExecutor] TYPE on "${action.selector}" — value resolved from LOCAL PROFILE (key: "${action.valueSource}"). ` +
            `Value NOT logged for privacy.`
          );
        } else {
          // Profile key not filled in — warn visibly and skip typing
          console.warn(
            `[ActionExecutor] valueSource "${action.valueSource}" requested but profile field is empty. ` +
            `Please fill in your Profile tab.`
          );
          setTimeout(() => { el.style.outline = originalOutline; el.style.transition = originalTransition; }, 1000);
          return {
            success: false,
            valueResolution: 'local-profile-empty',
            error: `Profile field "${action.valueSource}" is not set. Please fill in the Profile tab first.`
          };
        }

      } else {
        // Non-sensitive field — VLM provided a literal value
        resolvedValue = action.value || '';
        valueResolution = 'vlm-provided';
        console.log(
          `[ActionExecutor] TYPE on "${action.selector}" — value from VLM (non-sensitive field). ` +
          `Value: "${resolvedValue}"`
        );
      }

      // Actually type the resolved value
      el.focus();
      el.value = resolvedValue;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      // Reset outline
      setTimeout(() => { el.style.outline = originalOutline; el.style.transition = originalTransition; }, 1000);
      return { success: true, valueResolution };

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
