/* extension/detection/ner-detector.js */

let _nerPipeline = null;
let _nerPipelineLoading = null;

/**
 * Lazily loads the @xenova/transformers token-classification pipeline
 * backed by Xenova/bert-base-NER.
 * @returns {Promise<Function|null>}
 */
async function getNERPipeline() {
  if (_nerPipeline) return _nerPipeline;
  if (_nerPipelineLoading) return _nerPipelineLoading;

  _nerPipelineLoading = (async () => {
    try {
      const { pipeline } = await import('@xenova/transformers');
      const pipe = await pipeline('token-classification', 'Xenova/bert-base-NER');
      _nerPipeline = pipe;
      console.log('[NER Detector] BERT-NER pipeline loaded (Xenova/bert-base-NER).');
      return pipe;
    } catch (err) {
      console.warn('[NER Detector] Failed to load BERT-NER pipeline:', err.message || err);
      _nerPipelineLoading = null;
      return null;
    }
  })();

  return _nerPipelineLoading;
}

/**
 * Runs Named Entity Recognition on input text and returns detected entities (PER, LOC, ORG).
 * @param {string} text 
 * @returns {Promise<Array<{entity: string, word: string, score: number, type: 'name'|'address'|'possible-id-number'}>>}
 */
async function detectNamedEntities(text) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return [];
  
  try {
    const pipe = await getNERPipeline();
    if (!pipe) return [];

    const results = await pipe(text);
    if (!Array.isArray(results)) return [];

    const entities = [];
    for (const res of results) {
      if (!res.word || res.score < 0.6) continue;

      const entityTag = (res.entity || res.entity_group || '').toUpperCase();
      let piiType = null;

      if (entityTag.includes('PER')) {
        piiType = 'name';
      } else if (entityTag.includes('LOC')) {
        piiType = 'address';
      } else if (entityTag.includes('ORG')) {
        piiType = 'address';
      }

      if (piiType) {
        entities.push({
          entity: entityTag,
          word: res.word.replace(/^##/, ''),
          score: res.score,
          type: piiType
        });
      }
    }
    return entities;
  } catch (err) {
    console.warn('[NER Detector] Error during entity recognition:', err.message || err);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectNamedEntities, getNERPipeline };
}
