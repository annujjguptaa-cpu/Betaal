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

  // 4. Selector resolution, Empty Input Priority, and DOM grounding
  let selector = typeof rawSelectorStr === 'string' ? rawSelectorStr.trim() : null;

  if (selector) {
    if (!selector.startsWith('#') && !selector.startsWith('.') && !selector.includes('[') && !selector.includes(' ')) {
      selector = `#${selector}`;
    }
  }

  // ── ENFORCE EMPTY INPUT PRIORITY ──
  // If the goal requires entering info (trains, tracking, form filling) and there are empty input fields,
  // do NOT allow clicking submit/search or random non-input elements until empty inputs are filled!
  if (Array.isArray(domStructure) && domStructure.length > 0) {
    const textInputs = domStructure.filter(item => {
      const tag = (item.tag || '').toLowerCase();
      const type = (item.type || '').toLowerCase();
      const isInputTag = tag === 'input' || tag === 'textarea';
      const isInteractiveType = !['submit', 'button', 'hidden', 'radio', 'checkbox', 'image', 'reset'].includes(type);
      return isInputTag && isInteractiveType;
    });

    const emptyInputs = textInputs.filter(item => !item.liveValue || item.liveValue.trim() === '');

    if (emptyInputs.length > 0) {
      const goalLower = goal.toLowerCase();
      const isFormOrSearchGoal = /search|track|apply|find|check|book|fill|renew/i.test(goalLower);

      if (isFormOrSearchGoal) {
        // Find the best empty input field for the current step
        let targetInput = null;

        // Origin station match (e.g. NDLS / From)
        if (goalLower.includes('between') || goalLower.includes('from')) {
          targetInput = emptyInputs.find(item => {
            const attrStr = `${item.id} ${item.name} ${item.placeholder} ${item.ariaLabel} ${item.text}`.toLowerCase();
            return attrStr.includes('from') || attrStr.includes('origin') || attrStr.includes('source') || attrStr.includes('stn');
          });
        }

        // Destination station match (e.g. BCT / To)
        if (!targetInput && (goalLower.includes('to') || goalLower.includes('and'))) {
          targetInput = emptyInputs.find(item => {
            const attrStr = `${item.id} ${item.name} ${item.placeholder} ${item.ariaLabel} ${item.text}`.toLowerCase();
            return attrStr.includes('to') || attrStr.includes('dest') || attrStr.includes('arrival');
          });
        }

        // Tracking / Consignment input match
        if (!targetInput && (goalLower.includes('track') || goalLower.includes('consignment') || goalLower.includes('parcel'))) {
          targetInput = emptyInputs.find(item => {
            const attrStr = `${item.id} ${item.name} ${item.placeholder} ${item.ariaLabel} ${item.text}`.toLowerCase();
            return attrStr.includes('consign') || attrStr.includes('track') || attrStr.includes('article') || attrStr.includes('number') || attrStr.includes('code');
          });
        }

        // Fallback to first empty input
        if (!targetInput) {
          targetInput = emptyInputs[0];
        }

        if (targetInput && targetInput.selector) {
          action = 'type';
          selector = targetInput.selector;

          // Extract appropriate value for station or tracking number
          const attrStr = `${targetInput.id} ${targetInput.name} ${targetInput.placeholder} ${targetInput.ariaLabel}`.toLowerCase();

          if (attrStr.includes('from') || attrStr.includes('origin') || attrStr.includes('source')) {
            const originMatch = goal.match(/between\s+([A-Za-z0-9]+)\s+and/i) || goal.match(/from\s+([A-Za-z0-9]+)\s+to/i);
            if (originMatch) rawValueStr = originMatch[1].trim();
          } else if (attrStr.includes('to') || attrStr.includes('dest') || attrStr.includes('arrival')) {
            const destMatch = goal.match(/and\s+([A-Za-z0-9]+)(?:\s+for|\s+on|\s*$)/i) || goal.match(/to\s+([A-Za-z0-9]+)(?:\s+for|\s+on|\s*$)/i);
            if (destMatch) rawValueStr = destMatch[1].trim();
          } else if (attrStr.includes('consign') || attrStr.includes('track') || attrStr.includes('article')) {
            const codeMatch = goal.match(/\b([A-Z0-9]{5,25})\b/i);
            if (codeMatch) rawValueStr = codeMatch[1].trim();
          }
        }
      }
    }
  }

  // Ground selector against domStructure if selector is still missing
  if (!selector && Array.isArray(domStructure) && domStructure.length > 0) {
    const goalLower = goal.toLowerCase();
    const reasoningLower = combinedContext.toLowerCase();

    let match = domStructure.find(item => {
      const itemText = (item.text || item.placeholder || item.id || item.ariaLabel || '').toLowerCase();
      if (action === 'type' && (item.tag === 'input' || item.tag === 'textarea')) {
        return reasoningLower.includes(itemText) || goalLower.includes(itemText);
      }
      if (action === 'click' && (item.tag === 'button' || item.type === 'submit')) {
        return reasoningLower.includes(itemText) || goalLower.includes(itemText);
      }
      return false;
    });

    if (!match) {
      match = action === 'type'
        ? domStructure.find(item => item.tag === 'input' || item.tag === 'textarea')
        : domStructure.find(item => item.tag === 'button' || item.type === 'submit' || item.role === 'button');
    }

    if (!match) match = domStructure[0];
    if (match && match.selector) selector = match.selector;
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
