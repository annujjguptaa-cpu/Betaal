/* backend/llm.js */
const { buildPrompt } = require('./llm-prompt');

/**
 * Parses and validates raw VLM text response into structured action object.
 * @param {string} rawText 
 * @returns {{action: 'click'|'scroll'|'type', selector: string, reasoning: string}}
 */
function parseVLMResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Parse error: Empty or non-string response received from VLM. Raw: ' + rawText);
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
    throw new Error(`Invalid JSON returned by VLM: ${err.message}. Raw text was: "${rawText}"`);
  }

  const validActions = ['click', 'scroll', 'type'];
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('VLM response JSON is not an object. Raw text: ' + rawText);
  }

  if (!validActions.includes(parsed.action)) {
    throw new Error(`VLM field 'action' must be one of ['click', 'scroll', 'type'], got '${parsed.action}'. Raw: ` + rawText);
  }

  if (!parsed.selector || typeof parsed.selector !== 'string') {
    throw new Error(`VLM field 'selector' must be a non-empty string, got '${parsed.selector}'. Raw: ` + rawText);
  }

  if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
    throw new Error(`VLM field 'reasoning' must be a string, got '${parsed.reasoning}'. Raw: ` + rawText);
  }

  return {
    action: parsed.action,
    selector: parsed.selector,
    reasoning: parsed.reasoning,
    final: typeof parsed.final === 'boolean' ? parsed.final : false,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9
  };
}

/**
 * Scores a DOM element for relevance given the user's goal text.
 * Returns a numeric score (higher = more relevant).
 * @param {Object} el - element from domStructure
 * @param {string} goalLower - lowercased goal string
 * @param {string[]} goalWords - tokenized goal words
 * @returns {number}
 */
function scoreDomElement(el, goalLower, goalWords) {
  let score = 0;
  const tag = (el.tag || '').toLowerCase();
  const type = (el.type || '').toLowerCase();
  const text = (el.text || el.label || el.placeholder || el.value || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const name = (el.name || '').toLowerCase();
  const role = (el.role || '').toLowerCase();
  const autocomplete = (el.autocomplete || '').toLowerCase();

  // Strongly prefer interactive elements
  if (tag === 'button') score += 20;
  if (tag === 'a') score += 10;
  if (tag === 'input' && ['submit', 'button'].includes(type)) score += 20;
  if (tag === 'input' && ['text', 'email', 'tel', 'number', 'date'].includes(type)) score += 12;
  if (tag === 'textarea') score += 10;
  if (tag === 'select') score += 8;
  if (role === 'button') score += 15;

  // Keyword matching: goal words found in element text/id/name
  for (const word of goalWords) {
    if (word.length < 3) continue;
    if (text.includes(word)) score += 8;
    if (id.includes(word)) score += 6;
    if (name.includes(word)) score += 6;
    if (autocomplete.includes(word)) score += 4;
  }

  // Submit-like signals
  const submitWords = ['submit', 'send', 'proceed', 'continue', 'next', 'apply', 'confirm', 'go', 'lodge', 'register', 'save'];
  for (const sw of submitWords) {
    if (text.includes(sw)) score += 10;
    if (id.includes(sw)) score += 8;
    if (name.includes(sw)) score += 8;
  }

  // Fill-like signals: prefer empty inputs when goal is about filling
  const fillWords = ['fill', 'enter', 'complete', 'type'];
  const goalIsFill = fillWords.some(w => goalLower.includes(w));
  if (goalIsFill && tag === 'input' && ['text', 'email', 'tel', 'number'].includes(type)) score += 5;

  // Penalise hidden or unlikely elements
  if (type === 'hidden') score -= 50;
  if (tag === 'div' || tag === 'span') score -= 5;

  return score;
}

/**
 * Builds a CSS selector string for the given DOM element object.
 * Prefers #id, then [name], then tag[type].
 */
function buildSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  if (el.tag && el.type) return `${el.tag}[type="${el.type}"]`;
  return el.tag || 'button';
}

/**
 * DOM-aware simulated VLM: scores real elements from domStructure
 * and picks the best match for the given goal. Works on ANY page —
 * no hardcoded selectors.
 * @param {Array<Object>} domStructure
 * @param {string} goal
 * @returns {string} JSON-serialised VLM decision
 */
function getSimulatedDecisionFromDOM(domStructure, goal) {
  console.log('[VLM] Simulated DOM-aware engine analysing', domStructure.length, 'elements for goal:', goal);

  const goalLower = (goal || '').toLowerCase();
  const goalWords = goalLower.split(/\s+/).filter(w => w.length >= 3);

  if (!domStructure || domStructure.length === 0) {
    return JSON.stringify({
      action: 'scroll',
      selector: 'body',
      reasoning: 'VLM (Simulated): No interactive elements found — scrolling to reveal more of the page.',
      final: false,
      confidence: 0.5
    });
  }

  // Score every element
  const scored = domStructure
    .map(el => ({ el, score: scoreDomElement(el, goalLower, goalWords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Nothing useful found — scroll to load more content
    return JSON.stringify({
      action: 'scroll',
      selector: 'body',
      reasoning: 'VLM (Simulated): No matching interactive elements found. Scrolling to reveal more content.',
      final: false,
      confidence: 0.4
    });
  }

  const best = scored[0].el;
  const selector = buildSelector(best);
  const label = best.text || best.label || best.placeholder || best.id || best.name || best.tag;

  // Determine action: type for text inputs, click for everything else
  const tag = (best.tag || '').toLowerCase();
  const type = (best.type || '').toLowerCase();
  const isTextInput = tag === 'input' && ['text', 'email', 'tel', 'number', 'date', 'password'].includes(type);
  const isTextarea = tag === 'textarea';

  if (isTextInput || isTextarea) {
    const isSensitive = best.sensitive;
    return JSON.stringify({
      action: 'type',
      selector,
      value: isSensitive ? undefined : '',
      valueSource: isSensitive ? 'name' : undefined,
      reasoning: `VLM (Simulated): Found input field "${label}" — filling with profile value.`,
      final: false,
      confidence: 0.7
    });
  }

  // Check if this looks like a final submit button
  const submitSignals = ['submit', 'send', 'apply', 'lodge', 'register', 'confirm'];
  const isFinalAction = submitSignals.some(w => (label || '').toLowerCase().includes(w));

  return JSON.stringify({
    action: 'click',
    selector,
    reasoning: `VLM (Simulated): Clicking "${label}" — best match for goal "${goal}".`,
    final: isFinalAction,
    confidence: scored[0].score > 30 ? 0.85 : 0.65
  });
}

/**
 * Helper to parse comma-separated API keys from environment variable or single key fallback.
 * @param {string} envVarValue 
 * @returns {string[]}
 */
function parseKeyPool(envVarValue) {
  if (!envVarValue || typeof envVarValue !== 'string') return [];
  return envVarValue
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

const Groq = require('groq-sdk');

/**
 * Helper to determine if an HTTP status code or error object represents a configuration-level error.
 * Config-level errors (404 model not found, invalid model ID, bad request shape) mean all keys for that provider will fail identically.
 * Per-key errors (401/403 auth, 429 rate limit, quota exceeded) mean rotating keys might succeed.
 * @param {number} status 
 * @param {string} errMessage 
 * @returns {boolean}
 */
function isConfigError(status, errMessage = '') {
  const msgLower = (errMessage || '').toLowerCase();
  // Do NOT treat API key errors as config errors (400 API key not valid / 401 invalid_api_key)
  if (msgLower.includes('api key') || msgLower.includes('invalid_api_key') || status === 401 || status === 403) {
    return false;
  }
  // 413 = payload too large — per-request error, not a model/config issue; skip remaining keys won't help
  if (status === 413) {
    return false;
  }
  // Model-not-found, 404, or invalid model name errors are config errors
  if (status === 404 || msgLower.includes('not_found') || msgLower.includes('does not exist')) {
    return true;
  }
  // "model" in message with non-413 non-key errors → config issue
  if (msgLower.includes('model') && status !== 413 && status !== 429) {
    return true;
  }
  return false;
}

/**
 * Calls Vision-Language Model API (Gemini/Groq) with redacted screenshot and prompt.
 * Supports API Key Pooling & Fail-Fast rotation:
 * - Rotates through Gemini keys (using gemini-2.0-flash).
 * - Rotates through Groq keys (using Groq SDK / vision models).
 * - If a provider returns a config-level error (e.g. 404 model not found), skips remaining keys for that provider.
 * - Falls back to local DOM-aware simulated engine if all providers fail.
 *
 * @param {string} redactedImageBase64 
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @param {Array<Object>} [retrievedExamples=[]]
 * @returns {Promise<string>} Raw model response text
 */
async function callVLM(redactedImageBase64, goal, domStructure = [], retrievedExamples = []) {
  const promptText = buildPrompt(goal, domStructure, retrievedExamples);

  const geminiKeys = parseKeyPool(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY);
  const groqKeys = parseKeyPool(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY);

  if (geminiKeys.length === 0 && groqKeys.length === 0) {
    console.warn('[VLM] No API keys found — using DOM-aware simulated engine.');
    return getSimulatedDecisionFromDOM(domStructure, goal);
  }

  const base64Image = redactedImageBase64.replace(/^data:image\/\w+;base64,/, '');
  const dataUrl = redactedImageBase64.startsWith('data:') 
    ? redactedImageBase64 
    : `data:image/png;base64,${base64Image}`;

  // 1. Try Groq Key Pool first (Fastest & Most Reliable Vision Inference)
  const groqModel = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

  for (let j = 0; j < groqKeys.length; j++) {
    const key = groqKeys[j];
    console.log(`[VLM] Trying Groq API Key ${j + 1}/${groqKeys.length}...`);

    try {
      const groqClient = new Groq({ apiKey: key });
      const chatCompletion = await groqClient.chat.completions.create({
        model: groqModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ]
      });

      const rawContent = chatCompletion.choices?.[0]?.message?.content;
      if (rawContent) {
        console.log(`[VLM] Groq API Key ${j + 1} succeeded with model '${groqModel}'.`);
        return rawContent;
      }
    } catch (groqErr) {
      const status = groqErr.status || groqErr.statusCode || (groqErr.message?.includes('404') ? 404 : 500);
      const msg = groqErr.message || '';
      console.warn(`[VLM] Groq Key ${j + 1} failed (${status}): ${msg.slice(0, 120)}...`);

      if (isConfigError(status, msg)) {
        console.warn(`[VLM] Groq model ID invalid, skipping remaining Groq keys`);
        break; // Skip remaining Groq keys immediately
      }
    }
  }

  // 2. Try Gemini Key Pool if Groq fails/exhausted
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  
  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[i];
    console.log(`[VLM] Trying Gemini API Key ${i + 1}/${geminiKeys.length}...`);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: 'image/png', data: base64Image } }] }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawContent) {
          console.log(`[VLM] Gemini Key ${i + 1} succeeded with model '${geminiModel}'.`);
          return rawContent;
        }
      } else {
        const errText = await response.text();
        console.warn(`[VLM] Gemini Key ${i + 1} failed (${response.status}): ${errText.slice(0, 120)}...`);

        if (isConfigError(response.status, errText)) {
          console.warn(`[VLM] Gemini model misconfigured, skipping remaining Gemini keys`);
          break; // Skip remaining Gemini keys immediately
        }
      }
    } catch (geminiErr) {
      console.warn(`[VLM] Gemini Key ${i + 1} network error: ${geminiErr.message}. Rotating...`);
    }
  }

  // 3. Final Fallback to DOM-aware simulated engine if all providers fail
  console.warn('[VLM] All Gemini and Groq API keys exhausted or failed — falling back to local DOM-aware simulated engine.');
  return getSimulatedDecisionFromDOM(domStructure, goal);
}

module.exports = { buildPrompt, callVLM, parseVLMResponse };
