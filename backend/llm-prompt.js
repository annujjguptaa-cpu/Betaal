/* backend/llm-prompt.js — Prompt 83
 *
 * Builds the VLM instruction prompt.
 * Prompt 83 addition: When the DOM structure contains fields marked as sensitive
 * (via their `sensitive` flag from PII detection), the VLM is instructed to return
 * {valueSource: '<profileKey>'} instead of a literal value — so real identity data
 * is never sent over the network.
 */

/**
 * Builds the vision-language model instruction prompt.
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @returns {string} Formatted VLM prompt text
 */
function buildPrompt(goal, domStructure = []) {
  const domListFormatted = Array.isArray(domStructure)
    ? domStructure.map((item, idx) => {
        const sensitiveTag = item.sensitive ? ' [SENSITIVE]' : '';
        return `${idx + 1}. [${item.tag || 'element'}] ID: "${item.id || ''}", Class: "${item.className || ''}", Text/Placeholder: "${item.text || item.placeholder || ''}"${sensitiveTag}`;
      }).join('\n')
    : 'No structural field data provided.';

  // Prompt 83: The known local-profile keys the executor can resolve locally.
  const profileKeys = [
    'fullName', 'email', 'phone', 'aadhaar', 'pan',
    'passport', 'address', 'pinCode', 'dateOfBirth', 'bankAccount'
  ].join(' | ');

  return `You are looking at a screenshot where sensitive information has been redacted — solid black rectangles indicate hidden personal data (numbers, IDs, addresses), and pixelated/blocky regions indicate hidden faces. Do not attempt to guess what's underneath. Given the user's goal and this redacted view plus the following structural field data:
${domListFormatted}

User Goal: "${goal}"

Determine the single next UI action needed to accomplish or progress toward the goal.

IMPORTANT — VALUE SOURCING RULES:
- For a "type" action targeting a field marked [SENSITIVE] in the DOM list above, you MUST return "value": null and "valueSource": "<key>" where <key> is the most appropriate key from this list: ${profileKeys}
  The executor will resolve the real value locally — it must never appear in your response.
- For a "type" action targeting a NON-sensitive field (e.g. a search box, comment, quantity), return the literal value as "value": "<text>" and omit "valueSource".

Respond ONLY with valid JSON matching exactly this schema:
{
  "action": "click" | "scroll" | "type",
  "selector": "CSS selector string",
  "value": string or null,
  "valueSource": one of [${profileKeys}] — ONLY present for sensitive type actions, omit otherwise,
  "reasoning": "brief explanation",
  "final": boolean (true if this completes the task or submits a final form, false otherwise),
  "confidence": number between 0.0 and 1.0 (indicating confidence in this action choice)
}
Do not include markdown code fences or any text outside the JSON object.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildPrompt };
}
