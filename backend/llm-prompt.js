/* backend/llm-prompt.js — Prompts 83 & 88
 *
 * Builds the VLM instruction prompt.
 * Prompt 83: valueSource schema for sensitive fields.
 * Prompt 88: Incorporates RAG retrievedExamples precedent section if non-empty.
 */

/**
 * Builds the vision-language model instruction prompt.
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @param {Array<Object>} [retrievedExamples=[]] - Prompt 88: Array of RAG precedents from Vault
 * @returns {string} Formatted VLM prompt text
 */
function buildPrompt(goal, domStructure = [], retrievedExamples = []) {
  const domListFormatted = Array.isArray(domStructure)
    ? domStructure.map((item, idx) => {
        const sensitiveTag = item.sensitive ? ' [SENSITIVE]' : '';
        return `${idx + 1}. [${item.tag || 'element'}] ID: "${item.id || ''}", Class: "${item.className || ''}", Text/Placeholder: "${item.text || item.placeholder || ''}"${sensitiveTag}`;
      }).join('\n')
    : 'No structural field data provided.';

  // Known local-profile keys for Prompt 83 valueSource rules
  const profileKeys = [
    'fullName', 'email', 'phone', 'aadhaar', 'pan',
    'passport', 'address', 'pinCode', 'dateOfBirth', 'bankAccount'
  ].join(' | ');

  // Prompt 88: Format retrieved structural examples if non-empty
  let ragPrecedentSection = '';
  if (Array.isArray(retrievedExamples) && retrievedExamples.length > 0) {
    const formattedExamples = retrievedExamples.map((ex, idx) => {
      const typesStr = (ex.fieldTypes || []).join(', ') || 'general';
      const btnsStr = (ex.buttonLabels || []).join(', ') || 'none';
      const actionsStr = (ex.actionsTaken || []).join(' -> ') || 'completed form';
      return `Example ${idx + 1}: Field Types: [${typesStr}] | Buttons: [${btnsStr}] | Successful Actions: ${actionsStr}`;
    }).join('\n');

    ragPrecedentSection = `
For reference, here are structurally similar pages this agent has successfully handled before:
${formattedExamples}
Use these as helpful precedent, but base your decision on the ACTUAL current page structure provided above, not on assumption.
`;
  }

  return `You are looking at a screenshot where sensitive information has been redacted — solid black rectangles indicate hidden personal data (numbers, IDs, addresses), and pixelated/blocky regions indicate hidden faces. Do not attempt to guess what's underneath. Given the user's goal and this redacted view plus the following structural field data:
${domListFormatted}

User Goal: "${goal}"
${ragPrecedentSection}
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
