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

        // Fallback resolution if VLM left action.value empty
        if (!resolvedValue && window.__betaalCurrentGoal) {
          const goal = window.__betaalCurrentGoal;
          const selectorLower = (action.selector || '').toLowerCase();
          const placeholderLower = (el.placeholder || '').toLowerCase();
          const ariaLower = (el.getAttribute('aria-label') || '').toLowerCase();
          const combinedField = `${selectorLower} ${placeholderLower} ${ariaLower}`;

          // Station / Origin extraction for train / flight search
          if (combinedField.includes('from') || combinedField.includes('origin') || combinedField.includes('source') || combinedField.includes('starting')) {
            const match = goal.match(/between\s+([A-Za-z0-9\s()]+?)\s+and/i) || goal.match(/from\s+([A-Za-z0-9\s()]+?)\s+to/i);
            if (match) resolvedValue = match[1].trim();
          } else if (combinedField.includes('to') || combinedField.includes('dest') || combinedField.includes('arrival') || combinedField.includes('destination')) {
            const match = goal.match(/and\s+([A-Za-z0-9\s()]+?)(?:\s+for|\s+on|\s*$)/i) || goal.match(/to\s+([A-Za-z0-9\s()]+?)(?:\s+for|\s+on|\s*$)/i);
            if (match) resolvedValue = match[1].trim();
          }

          // Fallback tracking code / alphanumeric token extraction
          if (!resolvedValue) {
            const tokens = goal.match(/\b[A-Z0-9]{3,20}\b/gi) || [];
            const code = tokens.find(t => /[A-Z]/i.test(t) && /\d/.test(t)) || tokens.find(t => t.length >= 3 && !['THE', 'FOR', 'AND', 'WITH', 'MY'].includes(t.toUpperCase()));
            if (code) resolvedValue = code;
          }

          if (resolvedValue) {
            console.log(`[ActionExecutor] Fallback extracted value "${resolvedValue}" from goal for field [${action.selector}].`);
          }
        }

        // Clean parenthetical descriptors from station codes (e.g. "NDLS (New Delhi)" -> "NDLS")
        if (resolvedValue && typeof resolvedValue === 'string') {
          resolvedValue = resolvedValue.replace(/\s*\([^)]*\)/g, '').trim();
          // Extract 3-5 letter station code if present (e.g., "NDLS" from "NDLS NEW DELHI")
          const stationCodeMatch = resolvedValue.match(/\b[A-Z]{3,5}\b/);
          if (stationCodeMatch && resolvedValue.length > 5) {
            resolvedValue = stationCodeMatch[0];
          }
        }

        console.log(
          `[ActionExecutor] TYPE on "${action.selector}" — value: "${resolvedValue}"`
        );
      }

      // Native setter helper for Angular, React, Vue, PrimeNG (e.g. IRCTC)
      const setNativeValue = (target, val) => {
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
        const valueSetter = Object.getOwnPropertyDescriptor(target, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
          prototypeValueSetter.call(target, val);
        } else if (valueSetter) {
          valueSetter.call(target, val);
        } else {
          target.value = val;
        }
      };

      // Focus and clear element before typing
      el.focus();
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));

      // Type character-by-character with realistic human delay
      const textToType = String(resolvedValue || '');
      let currentVal = '';
      for (let i = 0; i < textToType.length; i++) {
        const char = textToType.charAt(i);
        currentVal += char;
        setNativeValue(el, currentVal);

        // Dispatch synthetic KeyboardEvent, InputEvent for Angular/React/PrimeNG binding
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
        el.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));

        const charDelay = Math.floor(Math.random() * 25) + 30;
        await new Promise((resolve) => setTimeout(resolve, charDelay));
      }

      // Final change and blur events after typing complete
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      // Autocomplete selection for railway/station search dropdowns (IRCTC / Indian Railways Enquiry):
      // Wait for station dropdown list to populate, then click the first matching dropdown item directly
      setTimeout(() => {
        try {
          const dropdownSelectors = [
            '.p-autocomplete-item',
            '.ui-autocomplete-item',
            'li.ui-menu-item',
            'ul.ui-autocomplete-items li',
            '.station-item',
            '.ng-option',
            '[role="option"]',
            '.stn-name',
            '.ui-menu-item-wrapper',
            '.ui-corner-all'
          ];
          let clicked = false;
          for (const sel of dropdownSelectors) {
            const items = Array.from(document.querySelectorAll(sel));
            const visibleItem = items.find(item => item.offsetWidth > 0 && item.offsetHeight > 0 && item !== el);
            if (visibleItem) {
              console.log(`[ActionExecutor] Auto-selecting dropdown option: "${(visibleItem.innerText || visibleItem.textContent || '').slice(0, 40)}"`);
              visibleItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              visibleItem.click();
              clicked = true;
              break;
            }
          }
          if (!clicked) {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
          }
        } catch (_) {}
      }, 500);

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
