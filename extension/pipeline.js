/* extension/pipeline.js */

/**
 * Executes full local privacy preservation and redaction pipeline on an image data URL.
 * @param {string} imageDataUrl 
 * @returns {Promise<{
 *   redactedImage: string,
 *   originalImage: string,
 *   detectedRegions: Array<Object>,
 *   screenType: string,
 *   timing: { classification: number, piiDetection: number, faceDetection: number, redaction: number, total: number },
 *   counts: { faces: number, piiFields: number }
 * }>}
 */
async function processScreenshot(imageDataUrl, domStructure = []) {
  const pipelineStart = performance.now();

  let extractPiiFn = typeof detectSensitivePII !== 'undefined' ? detectSensitivePII : null;
  let detectFacesFn = typeof detectFaces !== 'undefined' ? detectFaces : null;
  let classifyFn = typeof classifyScreenType !== 'undefined' ? classifyScreenType : null;
  let redactFn = typeof redactImage !== 'undefined' ? redactImage : null;

  if (!extractPiiFn || !detectFacesFn || !classifyFn || !redactFn) {
    if (typeof require !== 'undefined') {
      classifyFn = classifyFn || require('./detection/vit-classifier').classifyScreenType;
      extractPiiFn = extractPiiFn || require('./detection/pii-detector').detectSensitivePII;
      detectFacesFn = detectFacesFn || require('./detection/face-detect').detectFaces;
      redactFn = redactFn || require('./redaction/redact').redactImage;
    } else {
      const vit = await import('./detection/vit-classifier.js');
      const pii = await import('./detection/pii-detector.js');
      const face = await import('./detection/face-detect.js');
      const redact = await import('./redaction/redact.js');
      classifyFn = vit.classifyScreenType;
      extractPiiFn = pii.detectSensitivePII;
      detectFacesFn = face.detectFaces;
      redactFn = redact.redactImage;
    }
  }

  // 1. Screen Classification
  const classStart = performance.now();
  const rawClassification = await classifyFn(imageDataUrl);
  const screenType = rawClassification.category || 'both';
  const classificationTime = Math.round(performance.now() - classStart);

  let piiRegions = [];
  let piiTiming = 0;

  // 2. Execute PII detection
  const piiStart = performance.now();
  piiRegions = await extractPiiFn(imageDataUrl, domStructure);
  piiTiming = Math.round(performance.now() - piiStart);

  let faceRegions = [];
  let faceTiming = 0;

  // 2b. Execute Face detection
  const faceStart = performance.now();
  faceRegions = await detectFacesFn(imageDataUrl);
  faceTiming = Math.round(performance.now() - faceStart);

  // 3. Merge regions with specific redaction methods
  const mergedRegions = [];

  for (const pii of piiRegions) {
    mergedRegions.push({
      ...pii,
      method: 'blackfill'
    });
  }

  for (const face of faceRegions) {
    mergedRegions.push({
      text: '[FACE DETECTED]',
      type: 'face',
      boundingBox: face.boundingBox,
      confidence: face.confidence,
      method: 'blur',
      pixelSize: 12
    });
  }

  // 4. Perform Redaction
  const redactStart = performance.now();
  const redactedImage = await redactFn(imageDataUrl, mergedRegions);
  const redactionTime = Math.round(performance.now() - redactStart);

  const totalTime = Math.round(performance.now() - pipelineStart);

  return {
    redactedImage,
    originalImage: imageDataUrl,
    detectedRegions: mergedRegions,
    screenType,
    timing: {
      classification: classificationTime,
      piiDetection: piiTiming,
      faceDetection: faceTiming,
      redaction: redactionTime,
      total: totalTime
    },
    counts: {
      faces: faceRegions.length,
      piiFields: piiRegions.length
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processScreenshot };
}
