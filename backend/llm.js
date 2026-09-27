/* backend/llm.js — Local Ollama Reasoning Gateway */
const { buildPrompt } = require('./llm-prompt');

/**
 * Parses and validates raw text response from local Ollama model into structured action object.
 * @param {string} rawText 
 * @returns {{action: 'click'|'scroll'|'type', selector: string, reasoning: string, final: boolean, confidence: number}}
 */
function parseVLMResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Parse error: Empty or non-string response received from local model. Raw: ' + rawText);
  }

  // Strip markdown code fences if present (e.g., ```json ... ```)
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON returned by local model: ${err.message}. Raw text was: "${rawText}"`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Local model response JSON is not an object. Raw text: ' + rawText);
  }

  const validActions = ['click', 'scroll', 'type'];

  // Action normalization for local 1.5B models (e.g., "Track Parcel" -> "type", "Fill" -> "type", "Press" -> "click")
  if (typeof parsed.action === 'string') {
    let rawAction = parsed.action.trim();
    let actionLower = rawAction.toLowerCase();

    if (!validActions.includes(actionLower)) {
      if (/type|fill|enter|input|write|track|consign/i.test(actionLower)) {
        parsed.action = 'type';
      } else if (/click|press|submit|search|select|go|navigate/i.test(actionLower)) {
        parsed.action = 'click';
      } else if (/scroll/i.test(actionLower)) {
        parsed.action = 'scroll';
      }
    } else {
      parsed.action = actionLower;
    }
  }

  if (!validActions.includes(parsed.action)) {
    throw new Error(`Local model field 'action' must be one of ['click', 'scroll', 'type'], got '${parsed.action}'. Raw: ` + rawText);
  }

  // Handle alternative selector keys from smaller models (e.g. target, element, cssSelector)
  if (!parsed.selector || typeof parsed.selector !== 'string') {
    const altSelector = parsed.target || parsed.element || parsed.cssSelector || parsed.targetSelector || parsed.id;
    if (altSelector && typeof altSelector === 'string') {
      parsed.selector = altSelector.startsWith('#') || altSelector.startsWith('.') || altSelector.includes('[') 
        ? altSelector 
        : `#${altSelector}`;
    }
  }

  if (!parsed.selector || typeof parsed.selector !== 'string') {
    throw new Error(`Local model field 'selector' must be a non-empty string, got '${parsed.selector}'. Raw: ` + rawText);
  }

  // Handle alternative value keys from smaller models (e.g. parcelId, trackingId, text)
  if (parsed.value == null) {
    const altValue = parsed.parcelId || parsed.trackingId || parsed.consignmentId || parsed.text || parsed.inputValue;
    if (altValue != null) {
      parsed.value = String(altValue);
    }
  }

  if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
    parsed.reasoning = `Executed ${parsed.action} on ${parsed.selector}`;
  }

  return {
    action: parsed.action,
    selector: parsed.selector,
    value: parsed.value != null ? String(parsed.value) : (parsed.action === 'type' && !parsed.valueSource ? '' : undefined),
    valueSource: parsed.valueSource || undefined,
    reasoning: parsed.reasoning,
    final: typeof parsed.final === 'boolean' ? parsed.final : false,
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
