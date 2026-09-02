/* backend/llm-prompt.js */

/**
 * Builds the vision-language model instruction prompt.
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @returns {string} Formatted VLM prompt text
 */
function buildPrompt(goal, domStructure = []) {
  const domListFormatted = Array.isArray(domStructure)
    ? domStructure.map((item, idx) => `${idx + 1}. [${item.tag || 'element'}] ID: "${item.id || ''}", Class: "${item.className || ''}", Text/Placeholder: "${item.text || item.placeholder || ''}"`).join('\n')
    : 'No structural field data provided.';

  return `You are looking at a screenshot where sensitive information has been redacted — solid black rectangles indicate hidden personal data (numbers, IDs, addresses), and pixelated/blocky regions indicate hidden faces. Do not attempt to guess what's underneath. Given the user's goal and this redacted view plus the following structural field data:
${domListFormatted}

User Goal: "${goal}"

Determine the single next UI action needed to accomplish or progress toward the goal.
Respond ONLY with valid JSON matching exactly this schema:
{
  "action": "click" | "scroll" | "type",
  "selector": "CSS selector string",
  "reasoning": "brief explanation"
}
Do not include markdown code fences or any text outside the JSON object.`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildPrompt };
}
