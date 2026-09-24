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

/**
 * Calls Vision-Language Model API (Gemini/Claude) with redacted screenshot and prompt.
 * Supports API Key Pooling & Fallover: rotates through all Gemini keys first,
 * then all Anthropic keys, before resorting to local DOM-aware fallback.
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
  const anthropicKeys = parseKeyPool(process.env.ANTHROPIC_API_KEYS || process.env.ANTHROPIC_API_KEY);

  if (geminiKeys.length === 0 && anthropicKeys.length === 0) {
    console.warn('[VLM] No API keys found — using DOM-aware simulated engine.');
    return getSimulatedDecisionFromDOM(domStructure, goal);
  }

  const base64Image = redactedImageBase64.replace(/^data:image\/\w+;base64,/, '');

  // 1. Try Gemini Key Pool first
  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[i];
    console.log(`[VLM] Trying Gemini API Key ${i + 1}/${geminiKeys.length}...`);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
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
          console.log(`[VLM] Gemini API Key ${i + 1} succeeded.`);
          return rawContent;
        }
      } else {
        const errText = await response.text();
        console.warn(`[VLM] Gemini Key ${i + 1} failed (${response.status}): ${errText.slice(0, 150)}... Rotating to next key.`);
      }
    } catch (geminiErr) {
      console.warn(`[VLM] Gemini Key ${i + 1} network error: ${geminiErr.message}. Rotating...`);
    }
  }

  // 2. Try Anthropic Key Pool if all Gemini keys fail/exhausted
  for (let j = 0; j < anthropicKeys.length; j++) {
    const key = anthropicKeys[j];
    console.log(`[VLM] Trying Anthropic Claude API Key ${j + 1}/${anthropicKeys.length}...`);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Image } },
              { type: 'text', text: promptText }
            ]
          }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawContent = data.content?.[0]?.text;
        if (rawContent) {
          console.log(`[VLM] Anthropic API Key ${j + 1} succeeded.`);
          return rawContent;
        }
      } else {
        const errText = await response.text();
        console.warn(`[VLM] Anthropic Key ${j + 1} failed (${response.status}): ${errText.slice(0, 150)}... Rotating to next key.`);
      }
    } catch (anthropicErr) {
      console.warn(`[VLM] Anthropic Key ${j + 1} network error: ${anthropicErr.message}. Rotating...`);
    }
  }

  // 3. Final Fallback to DOM-aware simulated engine if all keys exhausted
  console.warn('[VLM] All Gemini and Anthropic API keys exhausted or failed — falling back to local DOM-aware simulated engine.');
  return getSimulatedDecisionFromDOM(domStructure, goal);
}

module.exports = { buildPrompt, callVLM, parseVLMResponse };
