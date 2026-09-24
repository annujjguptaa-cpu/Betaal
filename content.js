/* content.js */
console.log('Betaal content script loaded');

/**
 * Extracts real-time structural DOM info from interactive elements on the live page.
 * Captures: live field values, aria attributes, roles, bounding rects (scroll-adjusted),
 * focus state, select option text, link hrefs, shadow DOM traversal, computed visibility.
 * Works on ANY website — zero hardcoded selectors or assumptions.
 * @returns {Array<Object>}
 */
function getDOMStructure() {
  let skippedIframeCounts = 0;

  // Skip cross-origin iframe elements safely
  const isInsideIframe = (el) => {
    try {
      const win = el.ownerDocument ? el.ownerDocument.defaultView : null;
      if (win && win !== window.top) return true;
    } catch (e) {
      skippedIframeCounts++;
      return true;
    }
    return false;
  };

  // Visibility check using computed style + bounding rect
  const isVisible = (el) => {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.01) return false;
      return true;
    } catch (e) {
      return false;
    }
  };

  // Recursive element collector including open shadow DOM
  const collectElements = (root) => {
    let collected = [];
    if (!root) return collected;
    try {
      const nodes = root.querySelectorAll('*');
      nodes.forEach((node) => {
        if (isInsideIframe(node)) return;

        const tag = node.tagName ? node.tagName.toLowerCase() : '';
        const role = node.getAttribute ? (node.getAttribute('role') || '') : '';

        // Standard interactive elements
        if (['input', 'textarea', 'select', 'button', 'a', 'label'].includes(tag)) {
          collected.push(node);
        } else if (['button', 'textbox', 'combobox', 'listbox', 'checkbox', 'radio',
                    'link', 'menuitem', 'option', 'tab', 'switch', 'searchbox'].includes(role)) {
          if (!collected.includes(node)) collected.push(node);
        }

        // Traverse open shadow DOM
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
    console.warn(`[Betaal DOM] Skipped ${skippedIframeCounts} cross-origin elements.`);
  }

  // Visible first, then hidden; cap at 100 elements
  const visibleList = rawElements.filter(isVisible);
  const hiddenList  = rawElements.filter(el => !isVisible(el));
  const prioritized = [...visibleList, ...hiddenList].slice(0, 100);

  const scrollY  = window.scrollY  || 0;
  const scrollX  = window.scrollX  || 0;
  const focusedEl = document.activeElement;

  return prioritized.map((el) => {
    const rect        = el.getBoundingClientRect();
    const tag         = el.tagName.toLowerCase();
    const type        = (el.type  || '').toLowerCase();
    const id          = el.id     || '';
    const className   = (typeof el.className === 'string' ? el.className : '') || '';
    const name        = el.name   || '';
    const placeholder = el.placeholder || '';
    const role        = (el.getAttribute ? (el.getAttribute('role') || '')            : '');
    const autocomplete = el.autocomplete || '';
    const ariaLabel   = (el.getAttribute ? (el.getAttribute('aria-label') || '')     : '');
    const ariaDesc    = (el.getAttribute ? (el.getAttribute('aria-describedby') || '') : '');
    const dataTestId  = (el.getAttribute ? (el.getAttribute('data-testid') || el.getAttribute('data-test') || '') : '');
    const href        = tag === 'a' ? (el.getAttribute('href') || '') : '';
    const isFocused   = el === focusedEl;
    const isDisabled  = el.disabled || el.getAttribute('aria-disabled') === 'true';
    const isRequired  = el.required || el.getAttribute('aria-required') === 'true';

    // ── Live field value: what is ACTUALLY typed / selected RIGHT NOW ──
    let liveValue = '';
    if (tag === 'input' && !['password', 'hidden', 'file'].includes(type)) {
      liveValue = el.value || '';
    } else if (tag === 'textarea') {
      liveValue = el.value || '';
    } else if (tag === 'select') {
      const sel = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
      liveValue = sel ? (sel.text || sel.value || '') : '';
    }

    // ── Visible label text ──
    let text = '';
    if (['button', 'a', 'label'].includes(tag)) {
      text = (el.innerText || el.textContent || '').trim().slice(0, 120);
    } else if (['submit', 'button', 'reset'].includes(type)) {
      text = el.value || (el.innerText || el.textContent || '').trim().slice(0, 120);
    }

    // ── For <select>: collect all option labels to help VLM understand choices ──
    let options = [];
    if (tag === 'select' && el.options) {
      options = Array.from(el.options).slice(0, 20).map(o => ({ value: o.value, text: o.text }));
    }

    // ── Sensitivity heuristic: does this field likely contain PII? ──
    const combinedStr = `${id} ${className} ${name} ${placeholder} ${text} ${autocomplete} ${ariaLabel} ${dataTestId}`.toLowerCase();
    const sensitiveKeywords = [
      'aadhaar', 'pan', 'passport', 'ssn', 'tax', 'bank', 'account', 'card', 'cvv', 'password',
      'secret', 'license', 'dob', 'birth', 'phone', 'mobile', 'email', 'name', 'address', 'pin',
      'pincode', 'zipcode', 'zip', 'nid', 'voter', 'driving', 'vehicle', 'salary', 'income', 'contact',
      'gender', 'religion', 'caste', 'nationality', 'occupation', 'employer'
    ];
    const isSensitiveType = ['password', 'file'].includes(type);
    const isSensitive = isSensitiveType || sensitiveKeywords.some(kw => combinedStr.includes(kw));

    return {
      tag,
      type,
      id,
      className,
      name,
      text,
      placeholder,
      liveValue,      // REAL real-time value typed/selected by user on the live page
      autocomplete,
      ariaLabel,
      ariaDescribedBy: ariaDesc,
      dataTestId,
      role,
      href,
      options,        // <select> option list
      sensitive: isSensitive,
      isFocused,
      isDisabled,
      isRequired,
      rect: {
        left:   Math.round(rect.left   + scrollX),
        top:    Math.round(rect.top    + scrollY),
        width:  Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  });
}

/**
 * Waits for DOM stability using MutationObserver before re-capturing.
 * Resolves when quiet timer completes OR timeoutMs is reached.
 * @param {number} timeoutMs - Maximum total wait time (default 2000ms)
 * @param {number} quietMs   - Quiet window without mutations (default 300ms)
 * @returns {Promise<{stable: boolean, waitedMs: number, timedOut: boolean}>}
 */
function waitForDomStable(timeoutMs = 2000, quietMs = 300) {
  return new Promise((resolve) => {
    const startTime = performance.now();
    let quietTimer = null;
    let timeoutTimer = null;
    let observer = null;
    let finished = false;

    const cleanup = () => {
      finished = true;
      if (observer) { try { observer.disconnect(); } catch (e) {} }
      if (quietTimer) clearTimeout(quietTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    };

    const done = (timedOut) => {
      if (finished) return;
      cleanup();
      resolve({ stable: !timedOut, waitedMs: Math.round(performance.now() - startTime), timedOut });
    };

    const targetNode = document.body || document.documentElement;
    if (!targetNode) return resolve({ stable: true, waitedMs: 0, timedOut: false });

    try {
      observer = new MutationObserver(() => {
        if (finished) return;
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => done(false), quietMs);
      });
      observer.observe(targetNode, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (obsErr) {
      console.warn('[Betaal waitForDomStable] MutationObserver error, continuing:', obsErr);
      return resolve({ stable: true, waitedMs: 0, timedOut: false });
    }

    quietTimer   = setTimeout(() => done(false), quietMs);
    timeoutTimer = setTimeout(() => done(true),  timeoutMs);
  });
}

// ── Message listener: background service worker <-> content script ──
const browserApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
if (browserApi && browserApi.runtime && browserApi.runtime.onMessage) {
  browserApi.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    try {
      if (message.type === 'PING') {
        return { success: true, pong: true };
      }

      if (message.type === 'WAIT_FOR_DOM_STABLE') {
        const result = await waitForDomStable(
          typeof message.timeoutMs === 'number' ? message.timeoutMs : 2000,
          typeof message.quietMs   === 'number' ? message.quietMs   : 300
        );
        return { success: true, ...result };
      }

      if (message.type === 'CHECK_PAGE_READY') {
        const readyState = document.readyState;
        return { success: true, readyState, isComplete: readyState === 'complete' };
      }

      if (message.type === 'CHECK_SELECTOR') {
        if (!message.selector) return { success: true, exists: false, error: 'No selector provided' };
        try {
          const el = document.querySelector(message.selector);
          return { success: true, exists: !!el };
        } catch (selErr) {
          return { success: true, exists: false, error: selErr.message };
        }
      }

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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getDOMStructure, waitForDomStable };
}
