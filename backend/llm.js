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
 * Calls Vision-Language Model API (Gemini/Claude) with redacted screenshot and prompt.
 * @param {string} redactedImageBase64 
 * @param {string} goal 
 * @param {Array<Object>} domStructure 
 * @returns {Promise<string>} Raw model response text
 */
async function callVLM(redactedImageBase64, goal, domStructure = []) {
  const promptText = buildPrompt(goal, domStructure);
  const startTime = performance.now();

  const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[VLM] No API key found in environment (GEMINI_API_KEY / ANTHROPIC_API_KEY). Returning simulated VLM decision.');
    return JSON.stringify({
      action: 'click',
      selector: '#submit-grievance-btn',
      reasoning: 'VLM (Simulated): All form fields are filled and verified. Ready to submit grievance.',
      final: true,
      confidence: 0.95
    });
  }

  try {
    // Attempt Gemini VLM call if key present
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: redactedImageBase64.replace(/^data:image\/\w+;base64,/, '')
                }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errText}`);
    }

    const data = await response.json();
    const duration = Math.round(performance.now() - startTime);
    console.log(`[VLM Call Success] Response received in ${duration} ms.`);

    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      throw new Error('VLM returned empty candidate content.');
    }
    return rawContent;

  } catch (error) {
    console.error('[VLM Call Failed]:', error.message);
    throw new Error(`VLM API call failed: ${error.message}`);
  }
}

module.exports = { buildPrompt, callVLM, parseVLMResponse };
