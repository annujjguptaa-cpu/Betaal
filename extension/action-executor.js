/* extension/action-executor.js — Module 84
 *
 * Executes a UI action returned by the VLM backend on the active web page.
 * Module 84: For 'type' actions, if 'valueSource' is present, the real value
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

  // Calculate target element center coordinates for Agent Cursor animation
  const rect = el.getBoundingClientRect();
  const targetX = rect.left + rect.width / 2;
  const targetY = rect.top + rect.height / 2;

  // Animate agent cursor gliding to element if agent-cursor.js is loaded
  if (typeof window.animateAgentCursor === 'function') {
    await window.animateAgentCursor(targetX, targetY, true);
  }

  // Visual highlight indicator (temporary 3px red outline)
  const originalOutline = el.style.outline;
  const originalTransition = el.style.transition;
  el.style.transition = 'outline 0.2s ease-in-out';
  el.style.outline = '3px solid #ef4444';

  // Wait 300ms for demo visual feedback
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    if (action.action === 'click') {
      console.log(`[ActionExecutor] Executing CLICK on selector: "${action.selector}"`);
      el.click();

    } else if (action.action === 'scroll') {
      console.log(`[ActionExecutor] Executing SCROLL on selector: "${action.selector}"`);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } else if (action.action === 'type') {
      // Module 84: Local resolution path — value comes from local profile, never the network
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

        // Fallback: If VLM left action.value empty but user goal contains a tracking/consignment number or code, extract it directly
        if (!resolvedValue && window.__betaalCurrentGoal) {
          const match = window.__betaalCurrentGoal.match(/\b[A-Z0-9]{8,20}\b/i);
          if (match) {
            resolvedValue = match[0];
            console.log(`[ActionExecutor] Fallback extracted value "${resolvedValue}" from goal string.`);
          }
        }

        console.log(
          `[ActionExecutor] TYPE on "${action.selector}" — value from VLM/Goal (non-sensitive field). ` +
          `Value: "${resolvedValue}"`
        );
      }

      // Focus and clear element before typing
      el.focus();
      el.value = '';

      // Type character-by-character with realistic human delay (35ms - 65ms per char)
      const textToType = String(resolvedValue || '');
      for (let i = 0; i < textToType.length; i++) {
        const char = textToType.charAt(i);
        el.value += char;

        // Dispatch synthetic KeyboardEvent, input event for real-time reactivity
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));

        // Random delay between keystrokes (40ms average)
        const charDelay = Math.floor(Math.random() * 30) + 35;
        await new Promise((resolve) => setTimeout(resolve, charDelay));
      }

      // Final change event after typing complete
      el.dispatchEvent(new Event('change', { bubbles: true }));

      // Reset outline & hide cursor after brief delay
      setTimeout(() => { 
        el.style.outline = originalOutline; 
        el.style.transition = originalTransition; 
        if (typeof window.hideAgentCursor === 'function') window.hideAgentCursor();
      }, 800);
      return { success: true, valueResolution };

    } else {
      el.style.outline = originalOutline;
      if (typeof window.hideAgentCursor === 'function') window.hideAgentCursor();
      return { success: false, error: 'Unsupported action type: ' + action.action };
    }

    // Reset outline after action execution delay
    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.transition = originalTransition;
      if (typeof window.hideAgentCursor === 'function') window.hideAgentCursor();
    }, 1000);

    return { success: true };

  } catch (err) {
    el.style.outline = originalOutline;
    if (typeof window.hideAgentCursor === 'function') window.hideAgentCursor();
    return { success: false, error: 'Failed to execute action: ' + err.message };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { executeAction };
}
