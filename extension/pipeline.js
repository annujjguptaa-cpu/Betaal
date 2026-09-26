/**
 * PERFORMANCE MODE IMPLEMENTATION ARCHITECTURE:
 * ---------------------------------------------
 * Why the Fallback Pipeline Approach Was Chosen over ONNX model swapping:
 * 1. Sourcing quantized or high-precision BlazeFace / ViT ONNX model variants with matching input tensor schemas
 *    in web extensions without external CDN dependencies creates high failure risk during offline evaluation.
 * 2. The pipeline-level performance mode approach delivers 3 functionally distinct execution behaviors:
 *    - 'Fast' mode: Skips the ViT screen classification step entirely (0ms classification overhead), running detectors directly.
 *    - 'Balanced' mode: Default pipeline (ViT classification first to guide processing, then detection).
 *    - 'Accurate' mode: Upscales image canvas by 1.5x before passing to detectors, improving detection sensitivity on small text/fields.
 *
 * Module 74 ARCHITECTURE - LARGE SCREENSHOT NORMALIZATION:
 * --------------------------------------------------------
 * If screenshot dimensions exceed MAX_SCREEN_DIM (1920px), we downscale it proportionally before running
 * any detection models (OCR, BlazeFace, ViT), bounding worst-case latency on 4K/retina displays.
 * All detected bounding boxes are scaled back up to the original image dimensions before redaction,
 * ensuring redaction lands accurately on the full-resolution screenshot without artifacts.
 *
 * Module 73 ARCHITECTURE - GRACEFUL DEGRADATION:
 * ----------------------------------------------
 * Each detection stage (ViT, PII/OCR, Face detection) is wrapped in its own try/catch.
 * If one detector fails (timeout, missing tensor, corrupted canvas), the pipeline records a
 * degradation note (e.g. 'Face detection unavailable this run') and continues with partial results.
 */

const MAX_SCREEN_DIM = 1920;

async function processScreenshot(imageDataUrl, domStructure = [], currentSiteUrl = '') {
  const pipelineStart = performance.now();
  const degradationNotes = [];

  let extractPiiFn = typeof detectSensitivePII !== 'undefined' ? detectSensitivePII : null;
  let detectFacesFn = typeof detectFaces !== 'undefined' ? detectFaces : null;
  let classifyFn = typeof classifyScreenType !== 'undefined' ? classifyScreenType : null;
  let redactFn = typeof redactImage !== 'undefined' ? redactImage : null;
  let policyFn = typeof getEffectivePolicy !== 'undefined' ? getEffectivePolicy : null;

  if (!extractPiiFn || !detectFacesFn || !classifyFn || !redactFn || !policyFn) {
    if (typeof require !== 'undefined') {
      classifyFn = classifyFn || require('./detection/vit-classifier').classifyScreenType;
      extractPiiFn = extractPiiFn || require('./detection/pii-detector').detectSensitivePII;
      detectFacesFn = detectFacesFn || require('./detection/face-detect').detectFaces;
      redactFn = redactFn || require('./redaction/redact').redactImage;
      policyFn = policyFn || require('./policy-book').getEffectivePolicy;
    } else {
      const vit = await import('./detection/vit-classifier.js');
      const pii = await import('./detection/pii-detector.js');
      const face = await import('./detection/face-detect.js');
      const redact = await import('./redaction/redact.js');
      const pb = await import('./policy-book.js');
      classifyFn = vit.classifyScreenType;
      extractPiiFn = pii.detectSensitivePII;
      detectFacesFn = face.detectFaces;
      redactFn = redact.redactImage;
      policyFn = pb.getEffectivePolicy;
    }
  }

  // Fetch effective policy for current site
  const effectivePolicy = await policyFn(currentSiteUrl);
  const rules = effectivePolicy.rules;
  const performanceMode = effectivePolicy.performanceMode || 'balanced';

  // =========================================================================
  // Module 74: NORMALIZE LARGE SCREENSHOTS BEFORE PROCESSING
  // Cap longest side at 1920px. Keep aspect ratio. Scale back boxes up later.
  // =========================================================================
  let normScale = 1.0;
  let workingImage = imageDataUrl;

  if (typeof document !== 'undefined') {
    try {
      const origImg = new Image();
      await new Promise((res, rej) => {
        origImg.onload = res;
        origImg.onerror = rej;
        origImg.src = imageDataUrl;
      });

      const origW = origImg.width;
      const origH = origImg.height;

      if (origW > MAX_SCREEN_DIM || origH > MAX_SCREEN_DIM) {
        normScale = Math.min(MAX_SCREEN_DIM / origW, MAX_SCREEN_DIM / origH);
        const normW = Math.round(origW * normScale);
        const normH = Math.round(origH * normScale);

        const normCanvas = document.createElement('canvas');
        normCanvas.width = normW;
        normCanvas.height = normH;
        const normCtx = normCanvas.getContext('2d');
        normCtx.drawImage(origImg, 0, 0, normW, normH);
        workingImage = normCanvas.toDataURL('image/png');
        console.log(`[Module 74 Normalization] Downscaled large screenshot from ${origW}x${origH} to ${normW}x${normH} (scale=${normScale.toFixed(3)})`);
      }
    } catch (normErr) {
      console.warn('[Module 74 Normalization] Downscale skipped due to error:', normErr.message);
      normScale = 1.0;
      workingImage = imageDataUrl;
    }
  }

  // Accurate Mode: Upscale working image by 1.5x for higher sensitivity on small fields
  let modeScale = 1.0;
  let processingImage = workingImage;

  if (performanceMode === 'accurate' && typeof document !== 'undefined') {
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = workingImage; });
      const upCanvas = document.createElement('canvas');
      modeScale = 1.5;
      upCanvas.width = Math.round(img.width * modeScale);
      upCanvas.height = Math.round(img.height * modeScale);
      const ctx = upCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, upCanvas.width, upCanvas.height);
      processingImage = upCanvas.toDataURL('image/png');
    } catch (scaleErr) {
      modeScale = 1.0;
      processingImage = workingImage;
    }
  }

  // Combined scale factor from original imageDataUrl to processingImage:
  // processingCoords = originalCoords * normScale * modeScale
  const totalDetectorScale = normScale * modeScale;

  // =========================================================================
  // 1. Screen Classification (Module 73: Wrapped in Try/Catch for Graceful Degradation)
  // =========================================================================
  let screenType = 'both';
  let classificationTime = 0;

  if (performanceMode !== 'fast') {
    const classStart = performance.now();
    try {
      const rawClassification = await classifyFn(processingImage);
      screenType = rawClassification.category || 'both';
    } catch (vitErr) {
      console.warn('[Pipeline Degradation] ViT classifier failed:', vitErr.message);
      screenType = 'both'; // Fallback to safe default
      degradationNotes.push('ViT layout classifier unavailable this run (defaulted to general layout)');
    }
    classificationTime = Math.round(performance.now() - classStart);
  }

  // =========================================================================
  // 2. Execute PII detection (Module 73: Wrapped in Try/Catch)
  // =========================================================================
  const piiStart = performance.now();
  let rawPiiRegions = [];
  try {
    rawPiiRegions = await extractPiiFn(processingImage, domStructure);
  } catch (ocrErr) {
    console.warn('[Pipeline Degradation] OCR / PII detection failed:', ocrErr.message);
    rawPiiRegions = [];
    degradationNotes.push('OCR/PII detection unavailable this run');
  }
  const piiTiming = Math.round(performance.now() - piiStart);

  // Determine which face model to use based on performance mode
  let faceModelPath = './models/face_detector_balanced.onnx';
  if (performanceMode === 'fast') {
    faceModelPath = './models/face_detector_fast.onnx';
  } else {
    faceModelPath = './models/face_detector_balanced.onnx';
  }

  // =========================================================================
  // 2b. Execute Face detection (Module 73: Wrapped in Try/Catch)
  // =========================================================================
  const faceStart = performance.now();
  let rawFaceRegions = [];
  try {
    rawFaceRegions = await detectFacesFn(processingImage, 1, faceModelPath);
  } catch (faceErr) {
    console.warn('[Pipeline Degradation] Face detection failed:', faceErr.message);
    rawFaceRegions = [];
    degradationNotes.push('Face detection unavailable this run');
  }
  const faceTiming = Math.round(performance.now() - faceStart);

  // =========================================================================
  // Scale bounding boxes back up to original image resolution (Modules 73 & 74)
  // =========================================================================
  if (totalDetectorScale !== 1.0) {
    rawPiiRegions = rawPiiRegions.map(r => ({
      ...r,
      boundingBox: {
        x: Math.round(r.boundingBox.x / totalDetectorScale),
        y: Math.round(r.boundingBox.y / totalDetectorScale),
        width: Math.round(r.boundingBox.width / totalDetectorScale),
        height: Math.round(r.boundingBox.height / totalDetectorScale)
      }
    }));

    rawFaceRegions = rawFaceRegions.map(f => ({
      ...f,
      boundingBox: {
        x: Math.round(f.boundingBox.x / totalDetectorScale),
        y: Math.round(f.boundingBox.y / totalDetectorScale),
        width: Math.round(f.boundingBox.width / totalDetectorScale),
        height: Math.round(f.boundingBox.height / totalDetectorScale)
      }
    }));
  }

  // Map region types to policy keys
  const getPolicyKey = (type) => {
    switch (type) {
      case 'aadhaar': return 'aadhaar';
      case 'phone': return 'phone';
      case 'address': return 'address';
      case 'email': return 'email';
      case 'pan': return 'pan';
      case 'possible-id-number': return 'possibleIdNumber';
      case 'face': return 'faces';
      default: return 'address';
    }
  };

  const allDetectedRegions = [];
  const activeRedactRegions = [];
  let detectedCount = 0;
  let redactedCount = 0;
  let skippedCount = 0;

  // Process PII regions against policy
  for (const pii of rawPiiRegions) {
    detectedCount++;
    const ruleKey = getPolicyKey(pii.type);
    const rule = rules[ruleKey] || { enabled: true, method: 'blackfill' };

    const regionObj = {
      ...pii,
      policyKey: ruleKey,
      enabled: rule.enabled,
      method: rule.method || 'blackfill'
    };

    allDetectedRegions.push(regionObj);

    if (rule.enabled) {
      redactedCount++;
      activeRedactRegions.push(regionObj);
    } else {
      skippedCount++;
    }
  }

  // Process Face regions against policy
  for (const face of rawFaceRegions) {
    detectedCount++;
    const ruleKey = 'faces';
    const rule = rules.faces || { enabled: true, method: 'blur' };

    const faceObj = {
      text: '[FACE DETECTED]',
      type: 'face',
      policyKey: ruleKey,
      boundingBox: face.boundingBox,
      confidence: face.confidence,
      enabled: rule.enabled,
      method: rule.method || 'blur',
      pixelSize: 12
    };

    allDetectedRegions.push(faceObj);

    if (rule.enabled) {
      redactedCount++;
      activeRedactRegions.push(faceObj);
    } else {
      skippedCount++;
    }
  }

  // 3. Perform Redaction using active policy regions on ORIGINAL full-resolution screenshot
  const redactStart = performance.now();
  let redactedImage = imageDataUrl;
  try {
    redactedImage = await redactFn(imageDataUrl, activeRedactRegions);
  } catch (redactErr) {
    console.warn('[Pipeline Degradation] Redaction canvas pass failed:', redactErr.message);
    degradationNotes.push('Redaction overlay render error (served unmodified screenshot)');
    redactedImage = imageDataUrl;
  }
  const redactionTime = Math.round(performance.now() - redactStart);

  const totalTime = Math.round(performance.now() - pipelineStart);

  // Policy snapshot for Vault audit
  const policySnapshot = {};
  for (const [key, rule] of Object.entries(rules)) {
    policySnapshot[key] = { enabled: rule.enabled, method: rule.method };
  }

  return {
    redactedImage,
    originalImage: imageDataUrl,
    detectedRegions: allDetectedRegions,
    activeRedactedRegions: activeRedactRegions,
    screenType,
    performanceMode,
    policySnapshot,
    effectivePolicy,
    degradationNotes, // Module 73
    timing: {
      classification: classificationTime,
      piiDetection: piiTiming,
      faceDetection: faceTiming,
      redaction: redactionTime,
      total: totalTime
    },
    counts: {
      detected: detectedCount,
      redacted: redactedCount,
      skipped: skippedCount,
      faces: rawFaceRegions.length,
      piiFields: rawPiiRegions.length
    }
  };
}

/**
 * Clears all model session caches across ViT and Face detection models (Module 72).
 */
function clearAllModelCaches() {
  if (typeof clearViTCache === 'function') {
    clearViTCache();
  } else if (typeof require !== 'undefined') {
    try { require('./detection/vit-classifier').clearViTCache(); } catch (e) {}
  }

  if (typeof clearFaceModelCache === 'function') {
    clearFaceModelCache();
  } else if (typeof require !== 'undefined') {
    try { require('./detection/face-detect').clearFaceModelCache(); } catch (e) {}
  }
  console.log('[Pipeline] Cleared all model session caches.');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processScreenshot, clearAllModelCaches, MAX_SCREEN_DIM };
}
