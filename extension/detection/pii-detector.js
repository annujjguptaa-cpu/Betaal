/* extension/detection/pii-detector.js */

/**
 * Detects sensitive PII from an image data URL.
 * @param {string} imageDataUrl 
 * @returns {Promise<Array<{text: string, type: string, boundingBox: {x: number, y: number, width: number, height: number}}>>}
 */
async function detectSensitivePII(imageDataUrl) {
  try {
    let extractFn = typeof extractTextRegions !== 'undefined' ? extractTextRegions : null;
    let classifyFn = typeof classifyPII !== 'undefined' ? classifyPII : null;

    if (!extractFn || !classifyFn) {
      if (typeof require !== 'undefined') {
        extractFn = extractFn || require('./ocr').extractTextRegions;
        classifyFn = classifyFn || require('./pii-patterns').classifyPII;
      } else {
        const ocrModule = await import('./ocr.js');
        const patternsModule = await import('./pii-patterns.js');
        extractFn = ocrModule.extractTextRegions;
        classifyFn = patternsModule.classifyPII;
      }
    }

    const regions = await extractFn(imageDataUrl);
    if (!Array.isArray(regions) || regions.length === 0) {
      console.warn('detectSensitivePII: No text regions returned from OCR.');
      return [];
    }

    const detected = [];
    for (const region of regions) {
      const type = classifyFn(region.text);
      if (type !== null) {
        detected.push({
          text: region.text,
          type: type,
          boundingBox: region.boundingBox
        });
      }
    }
    return detected;
  } catch (error) {
    console.warn('detectSensitivePII failed with error:', error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectSensitivePII };
}
