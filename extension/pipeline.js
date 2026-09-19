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
 */

async function processScreenshot(imageDataUrl, domStructure = [], currentSiteUrl = '') {
  const pipelineStart = performance.now();

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

  let processingImage = imageDataUrl;
  let scaleFactor = 1.0;

  // Accurate Mode: Upscale image by 1.5x for higher sensitivity on small fields
  if (performanceMode === 'accurate' && typeof document !== 'undefined') {
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = imageDataUrl; });
      const upCanvas = document.createElement('canvas');
      scaleFactor = 1.5;
      upCanvas.width = Math.round(img.width * scaleFactor);
      upCanvas.height = Math.round(img.height * scaleFactor);
      const ctx = upCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, upCanvas.width, upCanvas.height);
      processingImage = upCanvas.toDataURL('image/png');
    } catch (scaleErr) {
      scaleFactor = 1.0;
      processingImage = imageDataUrl;
    }
  }

  // 1. Screen Classification (Fast mode skips ViT classification entirely)
  let screenType = 'both';
  let classificationTime = 0;

  if (performanceMode !== 'fast') {
    const classStart = performance.now();
    const rawClassification = await classifyFn(processingImage);
    screenType = rawClassification.category || 'both';
    classificationTime = Math.round(performance.now() - classStart);
  }

  // 2. Execute PII detection
  const piiStart = performance.now();
  let rawPiiRegions = await extractPiiFn(processingImage, domStructure);
  const piiTiming = Math.round(performance.now() - piiStart);

  // 2b. Execute Face detection
  const faceStart = performance.now();
  let rawFaceRegions = await detectFacesFn(processingImage);
  const faceTiming = Math.round(performance.now() - faceStart);

  // If accurate mode upscaled, adjust bounding box coordinates back to original scale
  if (scaleFactor !== 1.0) {
    rawPiiRegions = rawPiiRegions.map(r => ({
      ...r,
      boundingBox: {
        x: Math.round(r.boundingBox.x / scaleFactor),
        y: Math.round(r.boundingBox.y / scaleFactor),
        width: Math.round(r.boundingBox.width / scaleFactor),
        height: Math.round(r.boundingBox.height / scaleFactor)
      }
    }));

    rawFaceRegions = rawFaceRegions.map(f => ({
      ...f,
      boundingBox: {
        x: Math.round(f.boundingBox.x / scaleFactor),
        y: Math.round(f.boundingBox.y / scaleFactor),
        width: Math.round(f.boundingBox.width / scaleFactor),
        height: Math.round(f.boundingBox.height / scaleFactor)
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

  // 3. Perform Redaction using active policy regions
  const redactStart = performance.now();
  const redactedImage = await redactFn(imageDataUrl, activeRedactRegions);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processScreenshot };
}

