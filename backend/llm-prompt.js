/* backend/llm-prompt.js
 *
 * Builds the VLM instruction prompt with full rich DOM context:
 * live field values, aria attributes, roles, option lists, href,
 * disabled/required state, focus state — everything the VLM needs
 * to make intelligent decisions on ANY real-world page.
 */

/**
 * Formats a single DOM element into a compact, information-rich descriptor line.
 * @param {Object} item
 * @param {number} idx
 * @returns {string}
 */
function formatDomElement(item, idx) {
  const tag    = item.tag || 'element';
  const type   = item.type ? `[${item.type}]` : '';
  const parts  = [];

  if (item.id)           parts.push(`id="${item.id}"`);
  if (item.name)         parts.push(`name="${item.name}"`);
  if (item.ariaLabel)    parts.push(`aria-label="${item.ariaLabel}"`);
  if (item.placeholder)  parts.push(`placeholder="${item.placeholder}"`);
  if (item.text)         parts.push(`text="${item.text.slice(0, 80)}"`);
  if (item.liveValue)    parts.push(`currentValue="${item.liveValue.slice(0, 60)}"`);
  if (item.href)         parts.push(`href="${item.href.slice(0, 80)}"`);
  if (item.role)         parts.push(`role="${item.role}"`);
  if (item.autocomplete) parts.push(`autocomplete="${item.autocomplete}"`);
  if (item.dataTestId)   parts.push(`data-testid="${item.dataTestId}"`);
  if (item.isRequired)   parts.push('required');
  if (item.isDisabled)   parts.push('disabled');
  if (item.isFocused)    parts.push('FOCUSED');

  // For <select>: show choices
  if (item.options && item.options.length > 0) {
    const opts = item.options.slice(0, 8).map(o => o.text || o.value).join(' | ');
    parts.push(`options=[${opts}]`);
  }

  const sensitiveTag = item.sensitive ? ' [SENSITIVE]' : '';
  const attrStr = parts.length > 0 ? ` { ${parts.join(', ')} }` : '';

  return `${idx + 1}. <${tag}${type}>${attrStr}${sensitiveTag}`;
}

/**
 * Builds the vision-language model instruction prompt.
 * @param {string} goal
 * @param {Array<Object>} domStructure  - Real-time DOM from content.js
 * @param {Array<Object>} [retrievedExamples=[]] - RAG precedents from Vault
 * @returns {string} Formatted VLM prompt text
 */
function buildPrompt(goal, domStructure = [], retrievedExamples = []) {
  const domListFormatted = Array.isArray(domStructure) && domStructure.length > 0
    ? domStructure.map((item, idx) => formatDomElement(item, idx)).join('\n')
    : 'No interactive elements found on page.';

  // Profile keys for valueSource on sensitive fields
  const profileKeys = [
    'fullName', 'email', 'phone', 'aadhaar', 'pan',
    'passport', 'address', 'pinCode', 'dateOfBirth', 'bankAccount'
  ].join(' | ');

  // RAG precedent section
  let ragPrecedentSection = '';
  if (Array.isArray(retrievedExamples) && retrievedExamples.length > 0) {
    const formattedExamples = retrievedExamples.map((ex, idx) => {
      const typesStr   = (ex.fieldTypes   || []).join(', ')  || 'general';
      const btnsStr    = (ex.buttonLabels || []).join(', ')  || 'none';
      const actionsStr = (ex.actionsTaken || []).join(' -> ') || 'completed form';
      return `Example ${idx + 1}: Field Types: [${typesStr}] | Buttons: [${btnsStr}] | Successful Actions: ${actionsStr}`;
    }).join('\n');

    ragPrecedentSection = `
For reference, here are structurally similar pages this agent has successfully handled before:
${formattedExamples}
Use these as helpful precedent, but base your decision on the ACTUAL current page structure provided above.
`;
  }

  return `You are an autonomous form-filling agent looking at a screenshot of a live web page.
Sensitive information has been redacted: solid black boxes = PII text, pixelated regions = faces.
Do NOT guess what is hidden. Act only on what you can see and the DOM structure below.

=== LIVE PAGE DOM (${domStructure.length} interactive elements) ===
${domListFormatted}

=== USER GOAL ===
"${goal}"
${ragPrecedentSection}
=== YOUR TASK ===
Determine the SINGLE next UI action to make progress toward the goal.
- Prefer filling empty required fields before clicking submit buttons.
- If a field has a currentValue already set, skip it and move to the next empty field.
- Use the EXACT selector from the DOM list above (prefer #id over [name=...] over tag[type=...]).
- If the page has no relevant elements, use {"action":"scroll","selector":"body"} to reveal more.

=== VALUE SOURCING RULES ===
- For "type" on a [SENSITIVE] field: return "value": null and "valueSource": "<key>" from [${profileKeys}]. The executor resolves it locally — never put real PII in your response.
- For "type" on a NON-sensitive field (search box, comment, quantity, message): return "value": "<text>".

=== TASK CHECKLIST RULES ===
- Create or update a high-level 3 to 5 step task checklist in the "checklist" array field.
- Mark completed steps as [DONE], current step as [IN_PROGRESS], and future steps as [PENDING].

=== RESPONSE FORMAT ===
Respond ONLY with a single valid JSON object — no markdown fences, no extra text:
{
  "action": "click" | "scroll" | "type",
  "selector": "CSS selector exactly matching an element from the DOM list",
  "value": string or null,
  "valueSource": one of [${profileKeys}] — ONLY for sensitive type actions,
  "checklist": ["Step 1 [DONE]", "Step 2 [IN_PROGRESS]", "Step 3 [PENDING]"],
  "reasoning": "brief explanation of why this action and element",
  "final": true if this action submits the form or completes the task, false otherwise,
  "confidence": number 0.0–1.0
}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildPrompt };
}
