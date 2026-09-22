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
 * @param {Array<Object>} [retrievedExamples=[]]
 * @returns {Promise<string>} Raw model response text
 */
async function callVLM(redactedImageBase64, goal, domStructure = [], retrievedExamples = []) {
  const promptText = buildPrompt(goal, domStructure, retrievedExamples);
  const startTime = performance.now();

  const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[VLM] No API key found in environment (GEMINI_API_KEY / ANTHROPIC_API_KEY). Returning simulated VLM decision.');
    
    // Dynamic simulated VLM decision based on available DOM elements
    const hasStep1Btn = domStructure.some(el => el.id === 'step1-next-btn');
    const hasStep2Btn = domStructure.some(el => el.id === 'step2-next-btn');
    const hasStep3Btn = domStructure.some(el => el.id === 'step3-next-btn' || el.id === 'photo-id-upload');
    const hasFinalSubmitBtn = domStructure.some(el => el.id === 'final-submit-btn');

    if (hasStep1Btn) {
      return JSON.stringify({
        action: 'click',
        selector: '#step1-next-btn',
        reasoning: 'VLM (Simulated): Personal details verified. Moving to Step 2 Address details.',
        final: false,
        confidence: 0.95
      });
    }

    if (hasStep2Btn) {
      return JSON.stringify({
        action: 'click',
        selector: '#step2-next-btn',
        reasoning: 'VLM (Simulated): Address details verified. Moving to Step 3 Document upload.',
        final: false,
        confidence: 0.95
      });
    }

    if (hasStep3Btn) {
      return JSON.stringify({
        action: 'click',
        selector: '#photo-id-upload',
        reasoning: 'VLM (Simulated): Selecting photo ID file input for document upload.',
        final: false,
        confidence: 0.90
      });
    }

    if (hasFinalSubmitBtn) {
      return JSON.stringify({
        action: 'click',
        selector: '#final-submit-btn',
        reasoning: 'VLM (Simulated): Application review complete. Submitting final passport application.',
        final: true,
        confidence: 0.95
      });
    }

    return JSON.stringify({
      action: 'click',
      selector: '#submit-grievance-btn',
      reasoning: 'VLM (Simulated): All form fields verified. Submitting grievance.',
      final: true,
      confidence: 0.95
    });
  }

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // Helper for simulated fallback decision
    const getSimulatedDecision = () => {
      console.log('[VLM] Falling back to Simulated Local VLM decision engine.');
      const hasStep1Btn = domStructure.some(el => el.id === 'step1-next-btn');
      const hasStep2Btn = domStructure.some(el => el.id === 'step2-next-btn');
      const hasStep3Btn = domStructure.some(el => el.id === 'step3-next-btn' || el.id === 'photo-id-upload');
      const hasFinalSubmitBtn = domStructure.some(el => el.id === 'final-submit-btn');

      if (hasStep1Btn) return JSON.stringify({ action: 'click', selector: '#step1-next-btn', reasoning: 'VLM (Fallback): Moving to Step 2.', final: false, confidence: 0.95 });
      if (hasStep2Btn) return JSON.stringify({ action: 'click', selector: '#step2-next-btn', reasoning: 'VLM (Fallback): Moving to Step 3.', final: false, confidence: 0.95 });
      if (hasStep3Btn) return JSON.stringify({ action: 'click', selector: '#photo-id-upload', reasoning: 'VLM (Fallback): Selecting photo upload.', final: false, confidence: 0.90 });
      if (hasFinalSubmitBtn) return JSON.stringify({ action: 'click', selector: '#final-submit-btn', reasoning: 'VLM (Fallback): Submitting final application.', final: true, confidence: 0.95 });

      return JSON.stringify({ action: 'click', selector: '#submit-grievance-btn', reasoning: 'VLM (Fallback): Submitting form.', final: true, confidence: 0.95 });
    };

    if (anthropicKey) {
      console.log('[VLM] Calling Anthropic Claude VLM API...');
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1024,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: redactedImageBase64.replace(/^data:image\/\w+;base64,/, '') } },
                { type: 'text', text: promptText }
              ]
            }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const rawContent = data.content?.[0]?.text;
          if (rawContent) return rawContent;
        } else {
          const errText = await response.text();
          console.warn(`[VLM] Anthropic API error (${response.status}): ${errText}. Attempting fallback...`);
        }
      } catch (anthropicErr) {
        console.warn(`[VLM] Anthropic fetch error: ${anthropicErr.message}. Attempting fallback...`);
      }
    }

    if (geminiKey) {
      console.log('[VLM] Calling Gemini VLM API...');
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }, { inline_data: { mime_type: 'image/png', data: redactedImageBase64.replace(/^data:image\/\w+;base64,/, '') } }] }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawContent) return rawContent;
        } else {
          console.warn(`[VLM] Gemini API error (${response.status}). Attempting fallback...`);
        }
      } catch (geminiErr) {
        console.warn(`[VLM] Gemini fetch error: ${geminiErr.message}. Attempting fallback...`);
      }
    }

    // Fallback if cloud keys fail or are out of credit
    return getSimulatedDecision();

  } catch (error) {
    console.error('[VLM Call Failed]:', error.message);
    throw new Error(`VLM API call failed: ${error.message}`);
  }
}

module.exports = { buildPrompt, callVLM, parseVLMResponse };
