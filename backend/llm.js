/* backend/llm.js — Local Ollama Reasoning Gateway */
const { buildPrompt } = require('./llm-prompt');

/**
 * Universal, generalized parser for local LLM output.
 * Guarantees a valid schema response ({action, selector, value, valueSource, reasoning, final, confidence})
 * regardless of key names, nesting, or informal action descriptions returned by local models.
 *
 * @param {string} rawText 
 * @param {string} [goal=''] 
 * @param {Array<Object>} [domStructure=[]] 
 * @returns {{action: 'click'|'scroll'|'type', selector: string, value?: string, valueSource?: string, reasoning: string, final: boolean, confidence: number}}
 */
function parseVLMResponse(rawText, goal = '', domStructure = []) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Parse error: Empty response received from local model.');
  }

  // 1. Clean JSON fences / extra text
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Attempt JSON parse or extract first JSON block
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        // Fall back to null
      }
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    parsed = { rawExplanation: rawText };
  }

  // Helper to recursively scan all keys for target concepts
  function findValueByKeys(obj, keyRegex) {
    if (!obj || typeof obj !== 'object') return null;
    for (const [key, val] of Object.entries(obj)) {
      if (keyRegex.test(key) && val != null && val !== '') {
        return val;
      }
      if (typeof val === 'object' && val !== null) {
        const nested = findValueByKeys(val, keyRegex);
        if (nested != null && nested !== '') return nested;
      }
    }
    return null;
  }

  // 2. Discover raw key fields across non-standard key names
  let rawActionStr = findValueByKeys(parsed, /action|intent|step|command|operation|task|do|nextAction|actionType/i);
  let rawSelectorStr = findValueByKeys(parsed, /selector|target|element|cssSelector|targetSelector|id|xpath|button|input|field/i);
  let rawValueStr = findValueByKeys(parsed, /value|text|input|inputValue|parcelId|trackingId|code|query|data|content|val/i);
  let rawReasoningStr = findValueByKeys(parsed, /reasoning|reason|explanation|description|thought|details|summary/i);
  let valueSourceStr = findValueByKeys(parsed, /valueSource|profileKey|source/i);

  // If no explicit action string found, use full JSON string or raw text as candidate
  const combinedContext = [
    String(rawActionStr || ''),
    String(rawReasoningStr || ''),
    String(parsed.rawExplanation || ''),
    JSON.stringify(parsed)
  ].join(' ');

  // 3. Action classification
  let action = 'click'; // default fallback
  if (/type|fill|enter|input|write|track|consign|search box|query/i.test(combinedContext)) {
    if (!/click only|submit button/i.test(combinedContext) || rawValueStr || /id|code|number/i.test(goal)) {
      action = 'type';
    }
  }
  if (/click|press|submit|select|go|navigate|tap|choose|open/i.test(combinedContext) && !rawValueStr && action !== 'type') {
    action = 'click';
  }
  if (/scroll/i.test(combinedContext)) {
    action = 'scroll';
  }
  // Enforce valid enum if explicit verb matching
  if (typeof rawActionStr === 'string' && ['click', 'scroll', 'type'].includes(rawActionStr.trim().toLowerCase())) {
    action = rawActionStr.trim().toLowerCase();
  }

  // 4. Selector resolution and DOM grounding
  let selector = typeof rawSelectorStr === 'string' ? rawSelectorStr.trim() : null;

  // Clean selector syntax if model returned raw element description or id without prefix
  if (selector) {
    if (!selector.startsWith('#') && !selector.startsWith('.') && !selector.includes('[') && !selector.includes(' ')) {
      selector = `#${selector}`;
    }
  }

  // Ground selector against domStructure if selector is missing or not matching
  if (!selector && Array.isArray(domStructure) && domStructure.length > 0) {
    const goalLower = goal.toLowerCase();
    const reasoningLower = combinedContext.toLowerCase();

    // Strategy A: Find element matching action type & keywords
    let match = domStructure.find(item => {
      const itemText = (item.text || item.placeholder || item.id || item.ariaLabel || '').toLowerCase();
      if (action === 'type' && (item.tag === 'input' || item.tag === 'textarea')) {
        return reasoningLower.includes(itemText) || goalLower.includes(itemText) || itemText.includes('number') || itemText.includes('consignment') || itemText.includes('search') || itemText.includes('id');
      }
      if (action === 'click' && (item.tag === 'button' || item.type === 'submit')) {
        return reasoningLower.includes(itemText) || goalLower.includes(itemText) || itemText.includes('track') || itemText.includes('search') || itemText.includes('submit');
      }
      return false;
    });

    // Strategy B: Pick first input/button depending on action
    if (!match) {
      if (action === 'type') {
        match = domStructure.find(item => item.tag === 'input' || item.tag === 'textarea');
      } else if (action === 'click') {
        match = domStructure.find(item => item.tag === 'button' || item.type === 'submit' || item.role === 'button');
      }
    }

    // Strategy C: Absolute fallback to first DOM element
    if (!match) {
      match = domStructure[0];
    }

    if (match && match.selector) {
      selector = match.selector;
    }
  }

  if (!selector) {
    selector = 'body';
  }

  // 5. Value extraction & non-sensitive code parsing from Goal
  let value = rawValueStr != null ? String(rawValueStr) : undefined;
  let valueSource = valueSourceStr != null ? String(valueSourceStr) : undefined;

  if (action === 'type' && !value && !valueSource) {
    const codeMatch = goal.match(/\b([A-Z0-9]{5,25})\b/i) || goal.match(/(?:id|code|number|consignment|parcel):\s*([^\s]+)/i);
    if (codeMatch && codeMatch[1]) {
      value = codeMatch[1].trim();
    }
  }

  // 6. Reasoning & Metadata
  let reasoning = typeof rawReasoningStr === 'string' && rawReasoningStr.trim().length > 0
    ? rawReasoningStr.trim()
    : `Executed ${action} on ${selector} based on goal "${goal}".`;

  return {
    action: action,
    selector: selector,
    value: value,
    valueSource: valueSource,
    reasoning: reasoning,
    final: Boolean(parsed.final),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9
  };
}

/**
 * Calls local Ollama model (qwen2.5:1.5b-instruct-q4_K_M) running at http://localhost:11434
 * Performs local text-based reasoning over prompt containing goal, DOM structure, and RAG examples.
 * Zero network dependencies, zero cloud API keys, zero image payload transmission.
 *
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @param {Array<Object>} [retrievedExamples=[]]
 * @returns {Promise<string>} Raw model text response
 */
async function callVLM(goal, domStructure = [], retrievedExamples = []) {
  // Support both (goal, domStructure, retrievedExamples) and legacy (redactedImage, goal, domStructure, retrievedExamples)
  let actualGoal = goal;
  let actualDom = domStructure;
  let actualRag = retrievedExamples;

  if (typeof goal !== 'string' && typeof domStructure === 'string') {
    // Legacy call format shift: (redactedImage, goal, domStructure, retrievedExamples)
    actualGoal = domStructure;
    actualDom = retrievedExamples || [];
    actualRag = arguments[3] || [];
  }

  const promptText = buildPrompt(actualGoal, actualDom, actualRag);
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b-instruct-q4_K_M';

  console.log(`[Local LLM] POSTing to local Ollama (${OLLAMA_MODEL}) at ${OLLAMA_URL}...`);
  const startTime = Date.now();

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: promptText,
        format: 'json',
        stream: false
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama returned status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (!data || typeof data.response !== 'string') {
      throw new Error('Ollama returned empty response string.');
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[Local LLM] Response received from local model '${OLLAMA_MODEL}' in ${elapsedMs}ms.`);
    return data.response;

  } catch (err) {
    console.error(`[Local LLM Error]: ${err.message}`);
    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed') || err.code === 'ECONNREFUSED') {
      throw new Error('Local model server not running — start Ollama');
    }
    throw new Error(`Local model server not running — start Ollama (${err.message})`);
  }
}

module.exports = { buildPrompt, callVLM, parseVLMResponse };
