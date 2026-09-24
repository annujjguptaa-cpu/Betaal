/* extension/detection/pii-detector.js */

/**
 * Detects sensitive PII from an image data URL.
 * @param {string} imageDataUrl 
 * @returns {Promise<Array<{text: string, type: string, boundingBox: {x: number, y: number, width: number, height: number}}>>}
 */
async function detectSensitivePII(imageDataUrl, domStructure = []) {
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

    const detected = [];

    // 1. DOM Element Inspection (Guarantees input box value bounding box redaction)
    if (Array.isArray(domStructure) && domStructure.length > 0) {
      for (const el of domStructure) {
        const val = el.value || el.placeholder || el.text || '';
        if (val) {
          const type = classifyFn(val) || classifyFn(el.name || '') || classifyFn(el.id || '');
          if (type && el.rect) {
            detected.push({
              text: val,
              type: type,
              boundingBox: {
                x: Math.round(el.rect.left),
                y: Math.round(el.rect.top),
                width: Math.round(el.rect.width),
                height: Math.round(el.rect.height)
              }
            });
          }
        }
      }
    }

    // 2. OCR Text Region Inspection
    const regions = await extractFn(imageDataUrl);
    if (Array.isArray(regions) && regions.length > 0) {
      const fullText = regions.map(r => r.text).join(' ');
      
      // Run BERT-NER entity recognition on the combined page text
      let nerEntities = [];
      if (typeof detectNamedEntities !== 'undefined') {
        nerEntities = await detectNamedEntities(fullText);
      } else {
        try {
          const nerModule = await import('./ner-detector.js');
          nerEntities = await nerModule.detectNamedEntities(fullText);
        } catch (e) {}
      }

      for (const region of regions) {
        let type = classifyFn(region.text);

        // If regex didn't catch it, check if BERT-NER identified this word as a Person or Location
        if (!type && nerEntities.length > 0) {
          const matchedEntity = nerEntities.find(e => 
            e.word.toLowerCase() === region.text.toLowerCase() ||
            region.text.toLowerCase().includes(e.word.toLowerCase())
          );
          if (matchedEntity) {
            type = matchedEntity.type;
          }
        }

        if (type !== null) {
          // Avoid duplicate bounding box if DOM already caught it
          const exists = detected.some(d => Math.abs(d.boundingBox.x - region.boundingBox.x) < 30 && Math.abs(d.boundingBox.y - region.boundingBox.y) < 30);
          if (!exists) {
            detected.push({
              text: region.text,
              type: type,
              boundingBox: region.boundingBox
            });
          }
        }
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
