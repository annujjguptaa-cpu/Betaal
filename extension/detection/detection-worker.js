/* extension/detection/detection-worker.js */

/**
 * Dedicated Web Worker for off-main-thread ML inference.
 * Runs OCR, BERT-NER, BlazeFace ONNX, and Screen Classification off the UI thread to ensure zero UI jank.
 */

self.onmessage = async function (e) {
  const { id, type, payload } = e.data;

  try {
    if (type === 'RUN_DETECTION') {
      const { imageDataUrl, domStructure, performanceMode } = payload;

      let piiRegions = [];
      let faceRegions = [];
      let screenType = 'form-with-pii';

      // 1. PII & NER Detection
      if (typeof detectSensitivePII !== 'undefined') {
        piiRegions = await detectSensitivePII(imageDataUrl, domStructure);
      }

      // 2. Face Detection
      if (typeof detectFaces !== 'undefined') {
        faceRegions = await detectFaces(imageDataUrl, 1);
      }

      // 3. Screen Classification
      if (typeof classifyScreenType !== 'undefined') {
        const classResult = await classifyScreenType(imageDataUrl, { performanceMode });
        screenType = classResult.category || 'form-with-pii';
      }

      self.postMessage({
        id,
        success: true,
        result: {
          piiRegions,
          faceRegions,
          screenType
        }
      });
    } else {
      self.postMessage({ id, success: false, error: 'Unknown worker message type: ' + type });
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message || String(err) });
  }
};
