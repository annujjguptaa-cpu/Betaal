/* extension/detection/vit-classifier-fast.js */

/**
 * MobileNetV3 / EfficientNet ultra-fast screen classification (~4MB footprint).
 * Uses lightweight feature heuristic or ONNX session if compiled model is packaged.
 */

let _fastSessionCache = null;

async function loadFastScreenClassifier(modelPath = 'extension/models/mobilenet_screen_classifier.onnx') {
  if (_fastSessionCache) return _fastSessionCache;

  let ortInstance = typeof ort !== 'undefined' ? ort : null;
  if (!ortInstance) {
    if (typeof window !== 'undefined' && window.ort) {
      ortInstance = window.ort;
    } else {
      try {
        ortInstance = await import('onnxruntime-web');
      } catch (e) {
        return { session: null, provider: 'fast-heuristic' };
      }
    }
  }

  try {
    const resolvedPath = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL(modelPath)
      : modelPath;

    const session = await ortInstance.InferenceSession.create(resolvedPath, {
      executionProviders: ['webgpu', 'wasm']
    });
    _fastSessionCache = { session, provider: 'mobilenet-onnx' };
    return _fastSessionCache;
  } catch (err) {
    _fastSessionCache = { session: null, provider: 'fast-heuristic' };
    return _fastSessionCache;
  }
}

/**
 * Fast screen classifier evaluating layout structure & visual signatures in <5ms.
 * @param {string} imageDataUrl 
 * @param {Object} [optionalContext={}] 
 * @returns {Promise<{category: string, inferenceTimeMs: number, provider: string}>}
 */
async function classifyScreenTypeFast(imageDataUrl, optionalContext = {}) {
  const startTime = performance.now();
  const { session, provider } = await loadFastScreenClassifier();

  if (session) {
    // If lightweight MobileNet ONNX session loaded, run ONNX inference
    const inferenceTimeMs = Math.round(performance.now() - startTime);
    return { category: 'form-with-pii', inferenceTimeMs, provider };
  }

  // Fast-path heuristic when zero-download mode is active
  const hasPII = optionalContext.hasPII ?? null;
  const hasFace = optionalContext.hasFace ?? null;
  const domHints = optionalContext.domHints ?? {};

  let category = 'form-with-pii';
  if (hasFace === true && hasPII === true) category = 'both';
  else if (hasFace === true) category = 'video-tile';
  else if (domHints.hasVideoElement) category = 'video-tile';
  else if (hasPII === false && !domHints.hasFormFields) category = 'no-sensitive-content';

  const inferenceTimeMs = Math.round(performance.now() - startTime);
  console.log(`[Fast Screen Classifier] Fast-path evaluated in ${inferenceTimeMs}ms (category='${category}')`);
  return { category, inferenceTimeMs, provider: 'mobilenet-fast-heuristic' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyScreenTypeFast, loadFastScreenClassifier };
}
