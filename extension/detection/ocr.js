/* extension/detection/ocr.js */

/**
 * Runs raw Tesseract OCR on the given image data URL.
 * Supports both bundler/module environments and window/script tag imports.
 * @param {string} imageDataUrl 
 * @returns {Promise<Object>} Raw Tesseract recognize result object
 */
async function runRawOCR(imageDataUrl) {
  let tesseractRecognize;

  if (typeof Tesseract !== 'undefined' && Tesseract.recognize) {
    tesseractRecognize = Tesseract.recognize;
  } else if (typeof window !== 'undefined' && window.Tesseract && window.Tesseract.recognize) {
    tesseractRecognize = window.Tesseract.recognize;
  } else {
    try {
      const module = await import('tesseract.js');
      tesseractRecognize = module.default?.recognize || module.recognize;
    } catch (e) {
      throw new Error('Tesseract library is not loaded or unavailable: ' + e.message);
    }
  }

  return await tesseractRecognize(imageDataUrl, 'eng');
}

/**
 * Extracts word-level text regions with bounding boxes from an image data URL.
 * @param {string} imageDataUrl 
 * @returns {Promise<Array<{text: string, boundingBox: {x: number, y: number, width: number, height: number}}>>}
 */
async function extractTextRegions(imageDataUrl) {
  try {
    const rawResult = await runRawOCR(imageDataUrl);
    const words = rawResult?.data?.words || [];
    const regions = [];

    for (const w of words) {
      const text = (w.text || '').trim();
      if (text && w.bbox) {
        regions.push({
          text,
          boundingBox: {
            x: w.bbox.x0,
            y: w.bbox.y0,
            width: w.bbox.x1 - w.bbox.x0,
            height: w.bbox.y1 - w.bbox.y0
          }
        });
      }
    }
    return regions;
  } catch (error) {
    console.warn('OCR extraction failed or returned no words:', error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runRawOCR, extractTextRegions };
}
