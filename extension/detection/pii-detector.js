/* extension/detection/pii-detector.js */

/**
 * Detects sensitive PII from DOM structure AND image screenshot OCR.
 *
 * @param {string} imageDataUrl
 * @param {Array<Object>} domStructure - DOM elements array from content.js
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
        try {
          const ocrModule = await import('./ocr.js');
          const patternsModule = await import('./pii-patterns.js');
          extractFn = ocrModule.extractTextRegions;
          classifyFn = patternsModule.classifyPII;
        } catch (importErr) {
          console.warn('[pii-detector] Dynamic module import failed:', importErr.message);
        }
      }
    }

    const detected = [];

    // ─────────────────────────────────────────────────────────────────────────
    // 1. DOM Element Inspection (Bulletproof DOM-level PII extraction)
    // Inspects liveValue, text, placeholder, ariaLabel, and sensitive flag
    // ─────────────────────────────────────────────────────────────────────────
    if (Array.isArray(domStructure) && domStructure.length > 0) {
      for (const el of domStructure) {
        if (!el.rect || el.rect.width <= 0 || el.rect.height <= 0) continue;

        // Collect all possible text values associated with this DOM element
        const candidates = [
          el.liveValue,
          el.value,
          el.text,
          el.placeholder,
          el.ariaLabel,
          el.name,
          el.id
        ].filter(v => v && typeof v === 'string' && v.trim().length > 0);

        let detectedType = null;
        let matchedText = '';

        for (const cand of candidates) {
          const type = classifyFn(cand);
          if (type) {
            detectedType = type;
            matchedText = cand;
            break;
          }
        }

        // Fallback: If DOM element was marked sensitive by content.js heuristic AND has a value
        if (!detectedType && el.sensitive && candidates.length > 0) {
          detectedType = 'sensitive-field';
          matchedText = candidates[0];
        }

        if (detectedType) {
          detected.push({
            text: matchedText || '[SENSITIVE PII]',
            type: detectedType,
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

    // ─────────────────────────────────────────────────────────────────────────
    // 2. OCR Text Region Inspection (Sliding Window for Multi-Word PII)
    // ─────────────────────────────────────────────────────────────────────────
    if (extractFn && classifyFn) {
      try {
        const regions = await extractFn(imageDataUrl);
        if (Array.isArray(regions) && regions.length > 0) {

          // Single-word check
          for (const region of regions) {
            const type = classifyFn(region.text);
            if (type) {
              const exists = detected.some(d =>
                Math.abs(d.boundingBox.x - region.boundingBox.x) < 30 &&
                Math.abs(d.boundingBox.y - region.boundingBox.y) < 30
              );
              if (!exists) {
                detected.push({
                  text: region.text,
                  type: type,
                  boundingBox: region.boundingBox
                });
              }
            }
          }

          // Sliding window check for multi-word phrases (e.g. "1234 5678 9012" or "EPIC ABC1234567")
          for (let windowSize = 2; windowSize <= 4; windowSize++) {
            for (let i = 0; i <= regions.length - windowSize; i++) {
              const windowRegions = regions.slice(i, i + windowSize);
              // Ensure words are on roughly the same horizontal line (y difference < 20px)
              const firstY = windowRegions[0].boundingBox.y;
              const sameLine = windowRegions.every(r => Math.abs(r.boundingBox.y - firstY) < 20);
              if (!sameLine) continue;

              const combinedText = windowRegions.map(r => r.text).join(' ');
              const type = classifyFn(combinedText);
              if (type) {
                // Compute bounding box surrounding all words in window
                const minX = Math.min(...windowRegions.map(r => r.boundingBox.x));
                const minY = Math.min(...windowRegions.map(r => r.boundingBox.y));
                const maxX = Math.max(...windowRegions.map(r => r.boundingBox.x + r.boundingBox.width));
                const maxY = Math.max(...windowRegions.map(r => r.boundingBox.y + r.boundingBox.height));

                const mergedBox = {
                  x: minX,
                  y: minY,
                  width: maxX - minX,
                  height: maxY - minY
                };

                const exists = detected.some(d =>
                  Math.abs(d.boundingBox.x - mergedBox.x) < 30 &&
                  Math.abs(d.boundingBox.y - mergedBox.y) < 30
                );
                if (!exists) {
                  detected.push({
                    text: combinedText,
                    type: type,
                    boundingBox: mergedBox
                  });
                }
              }
            }
          }

        }
      } catch (ocrErr) {
        console.warn('[pii-detector] OCR extraction pass warning:', ocrErr.message);
      }
    }

    return detected;
  } catch (error) {
    console.warn('[pii-detector] detectSensitivePII top-level error:', error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectSensitivePII };
}
