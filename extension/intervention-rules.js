/* extension/intervention-rules.js */

/**
 * Determines whether an agent action requires human intervention before execution.
 * @param {Object} action - The VLM action object { action, selector, reasoning, final, confidence }
 * @param {Object} context - { consecutiveFailures, actionHistory, domStructure }
 * @returns {{needed: boolean, reason: string|null}}
 */
function needsHumanIntervention(action, context = {}) {
  if (!action) return { needed: false, reason: null };

  const consecutiveFailures = context.consecutiveFailures || 0;
  const domStructure = context.domStructure || [];

  // Trigger 1: Irreversible / Final step flag set by VLM
  if (action.final === true) {
    return {
      needed: true,
      reason: `Final action detected ("${action.action}" on "${action.selector}"). Human confirmation required before submitting or concluding task.`
    };
  }

  // Trigger 2: Repeated failure (consecutiveFailures >= 2 for the same selector)
  if (consecutiveFailures >= 2) {
    return {
      needed: true,
      reason: `Action failed ${consecutiveFailures} consecutive times on selector "${action.selector}". Manual assistance needed.`
    };
  }

  // Trigger 3: Low confidence score (below 0.6)
  if (typeof action.confidence === 'number' && action.confidence < 0.6) {
    return {
      needed: true,
      reason: `VLM confidence level is low (${Math.round(action.confidence * 100)}% < 60%). Human approval required.`
    };
  }

  // Trigger 4: Action targets a file input element
  const targetsFileInput = domStructure.some(el => {
    const isTargetSelector = (el.id && `#${el.id}` === action.selector) || (el.className && `.${el.className}` === action.selector);
    return isTargetSelector && el.tag === 'input' && el.type === 'file';
  });

  if (targetsFileInput) {
    return {
      needed: true,
      reason: `Action targets a file upload input ("${action.selector}"). Human intervention required for file selection.`
    };
  }

  // Trigger 5 (HITL-205): CAPTCHA / verification widget detected in DOM
  const captchaKeywords = ['captcha', 'recaptcha', 'hcaptcha', 'verification', 'verify', 'security-check', 'bot-check'];
  const hasCaptcha = domStructure.some(el => {
    const haystack = [el.id, el.name, el.ariaLabel, el.text, el.placeholder, el.dataTestId]
      .filter(Boolean).join(' ').toLowerCase();
    return captchaKeywords.some(kw => haystack.includes(kw));
  });

  if (hasCaptcha) {
    return {
      needed: true,
      reason: 'CAPTCHA or verification widget detected on the page. Please solve it manually, then click Approve to continue.'
    };
  }

  return { needed: false, reason: null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { needsHumanIntervention };
}
