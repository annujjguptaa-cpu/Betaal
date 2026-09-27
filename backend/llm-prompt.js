/* backend/llm-prompt.js
 *
 * Builds the text-only instruction prompt for local Ollama reasoning.
 * Includes explicit worked example for 100% reliable JSON generation on smaller models.
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
  const selectorStr = item.selector ? ` → selector="${item.selector}"` : '';

  return `${idx + 1}. <${tag}${type}>${attrStr}${sensitiveTag}${selectorStr}`;
}

/**
 * Builds the text-only instruction prompt for local Ollama reasoning.
 * @param {string} goal
 * @param {Array<Object>} domStructure  - Real-time DOM from content.js
 * @param {Array<Object>} [retrievedExamples=[]] - RAG precedents from Vault
 * @returns {string} Formatted prompt text
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
=== SIMILAR PAGE PRECEDENTS (RAG) ===
${formattedExamples}
`;
  }

  return `You are an autonomous web browser form-filling agent. You receive the live DOM structure of a page and a user goal, and decide the SINGLE next UI action to take.

=== WORKED EXAMPLE ===
Input Goal: "Apply for citizen grievance reporting billing issue"
Input DOM:
1. <input[text]> { id="applicant-name", placeholder="Full Name" } [SENSITIVE] → selector="#applicant-name"
2. <input[email]> { id="applicant-email", placeholder="Email Address" } [SENSITIVE] → selector="#applicant-email"
3. <button[submit]> { text="Submit Grievance" } → selector="#submit-btn"

Output JSON:
{
  "action": "type",
  "selector": "#applicant-name",
  "value": null,
  "valueSource": "fullName",
  "reasoning": "First required field is applicant name. It is sensitive, so value is null and valueSource is fullName for local resolution.",
  "final": false,
  "confidence": 0.95
}

=== VALUE SOURCING RULES ===
- For "type" on a [SENSITIVE] field (name, email, phone, aadhaar, address, dob): return "value": null and "valueSource": "<key>" from [${profileKeys}].
- For "type" on a NON-sensitive field (search box, quantity, message, consignment ID): return "value": "<text>" containing the literal text to type.
- Tracking numbers, consignment IDs, reference codes, order IDs are ALWAYS non-sensitive — extract the code from the user goal into "value".
- Prefer filling empty required fields before clicking submit buttons.
- CRITICAL: Copy the EXACT selector string shown after → in the DOM list below.

=== LIVE PAGE DOM (${domStructure.length} interactive elements) ===
${domListFormatted}

=== CURRENT USER GOAL ===
"${goal}"
${ragPrecedentSection}
Determine the SINGLE next action. Respond with ONLY the JSON object. No explanation, no markdown formatting, no additional text before or after.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildPrompt };
}
