/* extension/detection/vit-classifier.js */

// ---------------------------------------------------------------------------
// Module-level CLIP pipeline cache — initialised once, reused on every call.
// ---------------------------------------------------------------------------
let _clipPipeline = null;
let _clipPipelineLoading = null; // Promise<pipeline> while first init is in-flight

/**
 * Zero-shot classification labels and their mapping to our internal categories.
 * Order matters: @xenova/transformers returns scores for every label.
 */
const CLIP_LABELS = [
  'a government form with text input fields',
  'a video call or camera feed',
  'a social media or news page',
  'a document or article with no forms',
  'a login or authentication page'
];

/** @type {Record<string, string>} Maps CLIP label → internal category */
const LABEL_TO_CATEGORY = {
  'a government form with text input fields': 'form-with-pii',
  'a video call or camera feed':             'video-tile',
  'a social media or news page':             'no-sensitive-content',
  'a document or article with no forms':     'no-sensitive-content',
  'a login or authentication page':          'form-with-pii'
};

// ---------------------------------------------------------------------------
// Legacy ONNX session cache (kept for API compatibility with old callers)
// ---------------------------------------------------------------------------
const vitSessionCache = {};

/**
 * Clears the ViT / CLIP pipeline cache and any legacy ONNX session cache.
 */
function clearViTCache() {
  _clipPipeline = null;
  _clipPipelineLoading = null;
  const keys = Object.keys(vitSessionCache);
  keys.forEach((key) => {
    delete vitSessionCache[key];
  });
  console.log('[ViT Classifier] Cleared pipeline and session cache.');
}

// ---------------------------------------------------------------------------
// Legacy loadViTModel (kept so existing callers don't break)
// ---------------------------------------------------------------------------

/**
 * @deprecated  Direct ONNX loading is superseded by the CLIP pipeline.
 *              Kept for API compatibility only — always returns provider='clip'.
 * @param {string} _modelPath
 * @returns {Promise<{session: null, provider: string, loadTimeMs: number, fromCache: boolean}>}
 */
async function loadViTModel(_modelPath = './models/vit-tiny.onnx') {
  return { session: null, provider: 'clip', loadTimeMs: 0, fromCache: false };
}

// ---------------------------------------------------------------------------
// CLIP pipeline initialisation
// ---------------------------------------------------------------------------

/**
 * Lazily loads the @xenova/transformers zero-shot image-classification pipeline
 * backed by CLIP ViT-B/32.  The promise is cached so concurrent calls share
 * a single initialisation.
 *
 * @returns {Promise<Function|null>}  The pipeline function, or null if unavailable.
 */
async function getClipPipeline() {
  if (_clipPipeline) return _clipPipeline;
  if (_clipPipelineLoading) return _clipPipelineLoading;

  _clipPipelineLoading = (async () => {
    try {
      // Works in both ESM (import()) and CommonJS contexts.
      const { pipeline } = await import('@xenova/transformers');
      const pipe = await pipeline(
        'zero-shot-image-classification',
        'Xenova/clip-vit-base-patch32'
      );
      _clipPipeline = pipe;
      console.log('[ViT Classifier] CLIP pipeline loaded (Xenova/clip-vit-base-patch32).');
      return pipe;
    } catch (err) {
      console.warn('[ViT Classifier] Failed to load CLIP pipeline:', err.message || err);
      _clipPipelineLoading = null; // Allow retry on next call
      return null;
    }
  })();

  return _clipPipelineLoading;
}

// ---------------------------------------------------------------------------
// DOM-context heuristic fallback
// ---------------------------------------------------------------------------

/**
 * Derives a category from optional DOM-context hints when ML inference is
 * unavailable.  Defaults to 'form-with-pii' (safe/conservative).
 *
 * @param {Object} optionalContext
 * @returns {string}
 */
function heuristicCategory(optionalContext) {
  const hasPII   = optionalContext.hasPII   ?? null;
  const hasFace  = optionalContext.hasFace  ?? null;
  const domHints = optionalContext.domHints ?? {};

  if (hasFace === true && hasPII === true)  return 'both';
  if (hasFace === true)                     return 'video-tile';
  if (hasPII  === true)                     return 'form-with-pii';

  // DOM structure hints (e.g. passed by content script from document inspection)
  if (domHints.hasVideoElement)             return 'video-tile';
  if (domHints.hasFormFields)               return 'form-with-pii';

  // Conservative safe default — ensures redaction is applied
  return 'form-with-pii';
}

// ---------------------------------------------------------------------------
// Main public API
// ---------------------------------------------------------------------------

/**
 * Classifies a screenshot using CLIP zero-shot image classification.
 *
 * Inference order:
 *   1. Try @xenova/transformers CLIP pipeline (Xenova/clip-vit-base-patch32).
 *   2. On failure → derive category from optionalContext DOM hints.
 *   3. If no context → safe default 'form-with-pii'.
 *
 * Decision categories: 'form-with-pii' | 'video-tile' | 'both' | 'no-sensitive-content'
 *
 * @param {string} imageDataUrl             — data: URL of the screenshot
 * @param {Object} [optionalContext={}]     — optional hints: {hasPII, hasFace, domHints}
 * @returns {Promise<{category: string, inferenceTimeMs: number, provider: string}>}
 */
async function classifyScreenType(imageDataUrl, optionalContext = {}) {
  const startTime = performance.now();
  const useFastMode = optionalContext.performanceMode === 'fast' || optionalContext.useLightModel;

  if (useFastMode) {
    try {
      let fastFn;
      if (typeof classifyScreenTypeFast !== 'undefined') {
        fastFn = classifyScreenTypeFast;
      } else {
        const fastModule = await import('./vit-classifier-fast.js');
        fastFn = fastModule.classifyScreenTypeFast;
      }
      return await fastFn(imageDataUrl, optionalContext);
    } catch (e) {
      console.warn('[classifyScreenType] Fast mode import failed, continuing with standard pipeline.');
    }
  }

  // ------------------------------------------------------------------
  // Attempt 1: CLIP zero-shot inference
  // ------------------------------------------------------------------
  try {
    const pipe = await getClipPipeline();

    if (pipe) {
      // @xenova/transformers zero-shot-image-classification accepts a URL / data-URL
      const results = await pipe(imageDataUrl, CLIP_LABELS);

      // results is an array of {label, score} sorted descending by score
      const best = results[0];
      if (!best) throw new Error('Empty CLIP output');

      const category = LABEL_TO_CATEGORY[best.label] ?? 'no-sensitive-content';

      const inferenceTimeMs = Math.round(performance.now() - startTime);
      console.log(
        `[classifyScreenType] CLIP → label="${best.label}" score=${best.score.toFixed(3)} ` +
        `category="${category}" in ${inferenceTimeMs}ms`
      );
      return { category, inferenceTimeMs, provider: 'clip-vit-base-patch32' };
    }
  } catch (clipErr) {
    console.warn('[classifyScreenType] CLIP inference failed, using heuristic fallback:', clipErr.message || clipErr);
  }

  // ------------------------------------------------------------------
  // Attempt 2: DOM-context heuristic fallback
  // ------------------------------------------------------------------
  const category = heuristicCategory(optionalContext);
  const inferenceTimeMs = Math.round(performance.now() - startTime);
  console.log(`[classifyScreenType] Heuristic fallback → category="${category}" in ${inferenceTimeMs}ms`);
  return { category, inferenceTimeMs, provider: 'heuristic-fallback' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadViTModel, classifyScreenType, clearViTCache, vitSessionCache };
}
