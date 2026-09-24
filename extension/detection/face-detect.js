/* extension/detection/face-detect.js */

const modelCache = {};

/**
 * Clears the Face Detection model session cache.
 */
function clearFaceModelCache() {
  const keys = Object.keys(modelCache);
  keys.forEach((key) => {
    delete modelCache[key];
  });
  console.log('[Face Detection] Cleared session cache.');
}

/**
 * Resolves a model path using chrome.runtime.getURL when available (content-script context).
 * Falls back to the raw path when running outside an extension context.
 * @param {string} relativePath  e.g. 'extension/models/face_detector_balanced.onnx'
 * @returns {string}
 */
function resolveModelUrl(relativePath) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(relativePath);
  }
  return relativePath;
}

/**
 * Loads ONNX Runtime Web session for Face Detection model with WebGPU and WASM fallback.
 * When chrome.runtime is available (content-script context) the path is resolved via
 * chrome.runtime.getURL so the browser can actually fetch the packaged asset.
 *
 * @param {string} modelPath  Extension-relative path or full URL to the .onnx file.
 * @returns {Promise<{session: ort.InferenceSession|null, provider: string, loadTimeMs: number, fromCache: boolean}>}
 */
async function loadFaceModel(modelPath = 'extension/models/face_detector_balanced.onnx') {
  // Resolve to an extension URL when inside a content script
  const resolvedPath = resolveModelUrl(modelPath);

  if (modelCache[resolvedPath]) {
    console.log(`[loadFaceModel] Reusing cached face detector session for "${resolvedPath}"`);
    return { ...modelCache[resolvedPath], fromCache: true };
  }

  const startTime = performance.now();
  let ortInstance = typeof ort !== 'undefined' ? ort : null;

  if (!ortInstance) {
    if (typeof window !== 'undefined' && window.ort) {
      ortInstance = window.ort;
    } else {
      try {
        ortInstance = await import('onnxruntime-web');
      } catch (e) {
        throw new Error('onnxruntime-web is not available: ' + e.message);
      }
    }
  }

  let session = null;
  let usedProvider = null;

  try {
    session = await ortInstance.InferenceSession.create(resolvedPath, {
      executionProviders: ['webgpu']
    });
    usedProvider = 'webgpu';
  } catch (gpuError) {
    console.warn('[loadFaceModel] WebGPU provider failed, trying WASM fallback:', gpuError.message);
    try {
      session = await ortInstance.InferenceSession.create(resolvedPath, {
        executionProviders: ['wasm']
      });
      usedProvider = 'wasm';
    } catch (wasmError) {
      console.warn('[loadFaceModel] WASM provider also failed — inference disabled:', wasmError.message);
      session = null;
      usedProvider = 'none';
    }
  }

  const loadTimeMs = Math.round(performance.now() - startTime);
  console.log(`[loadFaceModel] Provider='${usedProvider}' load=${loadTimeMs}ms path="${resolvedPath}"`);

  modelCache[resolvedPath] = { session, provider: usedProvider, loadTimeMs };
  return modelCache[resolvedPath];
}

// ---------------------------------------------------------------------------
// BlazeFace anchor generation
// ---------------------------------------------------------------------------

/**
 * Generates BlazeFace-style prior anchors for a 128×128 input image.
 * Two feature-map levels:
 *   - 8×8  grid  (stride 16) with anchor sizes [16, 24]
 *   - 16×16 grid (stride  8) with anchor sizes [32, 48, 64, 80, 96, 128]  ← not 16x16 but matches the spec
 *
 * Returns an array of {cx, cy} centre-points in pixel space (relative to 128px input).
 * The number of anchors returned must equal the number of rows in the regressor output.
 *
 * BlazeFace 128-input anchor specification:
 *   Layer 0: 8×8  grid, 2 anchors each  → 128 anchors
 *   Layer 1: 16×16 grid, 6 anchors each → 1536 anchors  (total 1664)
 *
 * @returns {Array<{cx: number, cy: number}>}
 */
function generateBlazeFaceAnchors() {
  const INPUT_SIZE = 128;
  const anchors = [];

  // Layer 0: stride=16  → 8×8 feature map, 2 anchors per cell
  const stride0 = 16;
  const gridSize0 = Math.floor(INPUT_SIZE / stride0); // 8
  const anchorsPerCell0 = 2;
  for (let row = 0; row < gridSize0; row++) {
    for (let col = 0; col < gridSize0; col++) {
      for (let a = 0; a < anchorsPerCell0; a++) {
        anchors.push({
          cx: (col + 0.5) * stride0,
          cy: (row + 0.5) * stride0
        });
      }
    }
  }

  // Layer 1: stride=8  → 16×16 feature map, 6 anchors per cell
  const stride1 = 8;
  const gridSize1 = Math.floor(INPUT_SIZE / stride1); // 16
  const anchorsPerCell1 = 6;
  for (let row = 0; row < gridSize1; row++) {
    for (let col = 0; col < gridSize1; col++) {
      for (let a = 0; a < anchorsPerCell1; a++) {
        anchors.push({
          cx: (col + 0.5) * stride1,
          cy: (row + 0.5) * stride1
        });
      }
    }
  }

  return anchors; // 128 + 1536 = 1664 total
}

// Pre-compute anchors once at module load time
const BLAZEFACE_ANCHORS = generateBlazeFaceAnchors();
const INPUT_SIZE = 128;

// ---------------------------------------------------------------------------
// NMS
// ---------------------------------------------------------------------------

/**
 * Performs Non-Maximum Suppression (NMS) on bounding boxes.
 * @param {Array<{boundingBox: {x, y, width, height}, confidence: number}>} boxes
 * @param {number} iouThreshold
 * @returns {Array<{boundingBox: {x, y, width, height}, confidence: number}>}
 */
function applyNMS(boxes, iouThreshold = 0.3) {
  if (!boxes || boxes.length <= 1) return boxes;

  boxes.sort((a, b) => b.confidence - a.confidence);
  const selected = [];

  const calculateIoU = (boxA, boxB) => {
    const xA = Math.max(boxA.x, boxB.x);
    const yA = Math.max(boxA.y, boxB.y);
    const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    if (interArea === 0) return 0;

    const areaA = boxA.width * boxA.height;
    const areaB = boxB.width * boxB.height;
    return interArea / (areaA + areaB - interArea);
  };

  for (let i = 0; i < boxes.length; i++) {
    let keep = true;
    for (let j = 0; j < selected.length; j++) {
      const iou = calculateIoU(boxes[i].boundingBox, selected[j].boundingBox);
      if (iou > iouThreshold) {
        keep = false;
        break;
      }
    }
    if (keep) {
      selected.push(boxes[i]);
    }
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

/**
 * Draws an HTMLImageElement onto a 128×128 canvas and returns a Float32Array
 * normalised to [-1, 1] in NHWC layout [1, 128, 128, 3].
 *
 * @param {HTMLImageElement} img
 * @returns {{tensor: Float32Array, origWidth: number, origHeight: number}}
 */
function preprocessImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const { data } = imgData; // Uint8ClampedArray RGBA

  // NHWC: [1, H, W, C]
  const tensor = new Float32Array(1 * INPUT_SIZE * INPUT_SIZE * 3);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    tensor[i * 3 + 0] = data[i * 4 + 0] / 127.5 - 1.0; // R  → [-1, 1]
    tensor[i * 3 + 1] = data[i * 4 + 1] / 127.5 - 1.0; // G
    tensor[i * 3 + 2] = data[i * 4 + 2] / 127.5 - 1.0; // B
  }

  return { tensor, origWidth: img.width, origHeight: img.height };
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Sigmoid helper.
 * @param {number} x
 * @returns {number}
 */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Tries to retrieve a named output tensor from the inference result.
 * Accepts the tensor directly, a TypedArray, or a plain object with a `data` field.
 *
 * @param {Object} results  — output map from session.run()
 * @param {string} name     — tensor key to retrieve
 * @returns {Float32Array|null}
 */
function extractTensorData(results, name) {
  const t = results[name];
  if (!t) return null;
  if (t instanceof Float32Array || t instanceof Float64Array) return t;
  if (t.data) return t.data;
  return null;
}

/**
 * Attempts to run the ONNX session with a given input tensor name and returns
 * raw outputs, or null on failure.
 *
 * @param {ort.InferenceSession} session
 * @param {ort.Tensor} tensor
 * @param {string} inputName
 * @returns {Promise<Object|null>}
 */
async function tryRun(session, tensor, inputName) {
  try {
    return await session.run({ [inputName]: tensor });
  } catch (_) {
    return null;
  }
}

/**
 * Decodes BlazeFace regressor + classifier outputs into bounding boxes.
 *
 * @param {Float32Array} regressors  shape [numAnchors, 16] or [numAnchors * 16]
 * @param {Float32Array} classifiers shape [numAnchors,  1] or [numAnchors]
 * @param {number} origWidth
 * @param {number} origHeight
 * @param {number} confThreshold
 * @returns {Array<{boundingBox: {x, y, width, height}, confidence: number}>}
 */
function decodeBlazeFaceOutputs(regressors, classifiers, origWidth, origHeight, confThreshold = 0.5) {
  const numAnchors = BLAZEFACE_ANCHORS.length;
  const scaleX = origWidth / INPUT_SIZE;
  const scaleY = origHeight / INPUT_SIZE;

  const detections = [];

  for (let i = 0; i < numAnchors; i++) {
    // Raw classification score
    const rawScore = classifiers.length > i ? classifiers[i] : -10;
    const confidence = sigmoid(rawScore);
    if (confidence < confThreshold) continue;

    // Regressor layout: [dy, dx, dh, dw, kp0y, kp0x, …] relative to anchor
    const base = i * 16; // BlazeFace has 16 values per anchor (4 box + 6×2 kp)
    if (base + 3 >= regressors.length) continue;

    const anchor = BLAZEFACE_ANCHORS[i];

    // Box centre offsets are expressed in pixel-space relative to the anchor
    const cx = anchor.cx + regressors[base + 1];
    const cy = anchor.cy + regressors[base + 0];
    const w  = regressors[base + 3];
    const h  = regressors[base + 2];

    // Convert centre-format → corner-format, then scale to original image
    const x = (cx - w / 2) * scaleX;
    const y = (cy - h / 2) * scaleY;
    const bw = w * scaleX;
    const bh = h * scaleY;

    // Sanity-filter degenerate boxes
    if (bw <= 0 || bh <= 0) continue;

    detections.push({
      boundingBox: {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(bw),
        height: Math.round(bh)
      },
      confidence
    });
  }

  return detections;
}

// ---------------------------------------------------------------------------
// Main public API
// ---------------------------------------------------------------------------

/**
 * Detects faces in an image data URL using the BlazeFace ONNX model.
 *
 * Pipeline:
 *   1. Load (or reuse) ONNX session
 *   2. Decode image → 128×128 Float32Array tensor (NHWC, normalised to [-1,1])
 *   3. Run session with common input names until one succeeds
 *   4. Decode regressor + classifier outputs using pre-computed anchors
 *   5. Filter confidence ≥ 0.5, apply NMS
 *   6. Return detections scaled to original image dimensions
 *
 * If ANYTHING fails → returns [] (no detections), never fake data.
 *
 * @param {string} imageDataUrl
 * @param {number} [upscaleFactor=1]  Optional pre-processing upscale factor.
 * @param {string} [modelPath]        Path to .onnx model file.
 * @returns {Promise<Array<{boundingBox: {x: number, y: number, width: number, height: number}, confidence: number}>>}
 */
async function detectFaces(
  imageDataUrl,
  upscaleFactor = 1,
  modelPath = 'extension/models/face_detector_balanced.onnx'
) {
  try {
    const { session, provider } = await loadFaceModel(modelPath);

    // If model failed to load, return nothing — do not fake detections
    if (!session) {
      console.warn('[detectFaces] No ONNX session available — returning [].');
      return [];
    }

    // Retrieve ort instance
    let ortInstance = typeof ort !== 'undefined' ? ort : (typeof window !== 'undefined' && window.ort) ? window.ort : null;
    if (!ortInstance) {
      ortInstance = await import('onnxruntime-web');
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = async () => {
        try {
          const scale = Math.max(1, upscaleFactor);

          // Optional upscale step before feeding into the fixed 128×128 preprocessor
          let sourceImg = img;
          if (scale > 1) {
            const upCanvas = document.createElement('canvas');
            upCanvas.width = Math.floor(img.width * scale);
            upCanvas.height = Math.floor(img.height * scale);
            upCanvas.getContext('2d').drawImage(img, 0, 0, upCanvas.width, upCanvas.height);
            sourceImg = upCanvas; // drawImage accepts canvas too
          }

          // Preprocess: resize to 128×128, normalise
          const { tensor: tensorData, origWidth, origHeight } = preprocessImage(sourceImg);

          // Build ORT tensor  [1, 128, 128, 3]  NHWC
          const inputTensor = new ortInstance.Tensor('float32', tensorData, [1, INPUT_SIZE, INPUT_SIZE, 3]);

          // Try common input names used by BlazeFace variants
          const inputNames = ['input', 'images', 'x', 'data', 'input_1'];
          let results = null;
          let usedInputName = null;

          // First, try the model's actual input names from the session metadata
          if (session.inputNames && session.inputNames.length > 0) {
            for (const name of session.inputNames) {
              const r = await tryRun(session, inputTensor, name);
              if (r) {
                results = r;
                usedInputName = name;
                break;
              }
            }
          }

          // Fall back to known common names
          if (!results) {
            for (const name of inputNames) {
              const r = await tryRun(session, inputTensor, name);
              if (r) {
                results = r;
                usedInputName = name;
                break;
              }
            }
          }

          if (!results) {
            console.warn('[detectFaces] All input name attempts failed — returning [].');
            resolve([]);
            return;
          }

          console.log(`[detectFaces] Ran session with input="${usedInputName}", provider="${provider}". Output keys:`, Object.keys(results));

          // ---------------------------------------------------------------
          // Extract regressor and classifier tensors
          // BlazeFace typically outputs two tensors:
          //   regressors  → shape [1, numAnchors, 16]   (bounding box + keypoints)
          //   classifiers → shape [1, numAnchors, 1]    (face confidence)
          // The exact key names vary across exporters; we try common ones.
          // ---------------------------------------------------------------
          const outputKeys = Object.keys(results);
          let regressorData = null;
          let classifierData = null;

          // Heuristic: classifier tensor is smaller (numAnchors elements),
          // regressor tensor is larger (numAnchors * 16 elements)
          const numAnchors = BLAZEFACE_ANCHORS.length;

          const regressorNames = ['regressors', 'boxes', 'output_boxes', 'output0', outputKeys[0]];
          const classifierNames = ['classificators', 'scores', 'output_scores', 'output1', outputKeys[1]];

          for (const name of regressorNames) {
            const d = extractTensorData(results, name);
            if (d && d.length >= numAnchors * 4) {
              regressorData = d;
              break;
            }
          }
          for (const name of classifierNames) {
            const d = extractTensorData(results, name);
            if (d && d.length >= numAnchors) {
              classifierData = d;
              break;
            }
          }

          // If we only have one output, try to split by expected sizes
          if (!regressorData || !classifierData) {
            if (outputKeys.length === 1) {
              const combined = extractTensorData(results, outputKeys[0]);
              if (combined) {
                // Assume layout: [regressors | classifiers]
                const regSize = numAnchors * 16;
                if (combined.length >= regSize + numAnchors) {
                  regressorData = combined.slice(0, regSize);
                  classifierData = combined.slice(regSize, regSize + numAnchors);
                }
              }
            } else {
              // Assign by size ordering
              const tensors = outputKeys.map(k => ({ key: k, data: extractTensorData(results, k) }))
                                       .filter(t => t.data)
                                       .sort((a, b) => b.data.length - a.data.length);
              if (tensors.length >= 2) {
                regressorData  = tensors[0].data; // larger
                classifierData = tensors[1].data; // smaller
              } else if (tensors.length === 1) {
                classifierData = tensors[0].data;
              }
            }
          }

          if (!regressorData || !classifierData) {
            console.warn('[detectFaces] Could not identify regressor/classifier outputs — returning [].');
            resolve([]);
            return;
          }

          // Decode bounding boxes
          const detections = decodeBlazeFaceOutputs(
            regressorData,
            classifierData,
            origWidth,
            origHeight,
            0.5
          );

          // NMS
          const nmsResult = applyNMS(detections, 0.3);

          console.log(`[detectFaces] ${nmsResult.length} face(s) after NMS (provider="${provider}").`);
          resolve(nmsResult);

        } catch (inferenceErr) {
          console.warn('[detectFaces] Inference error — returning []:', inferenceErr);
          resolve([]);
        }
      };

      img.onerror = (err) => {
        console.warn('[detectFaces] Failed to load image — returning []:', err);
        resolve([]);
      };

      img.src = imageDataUrl;
    });

  } catch (error) {
    console.warn('[detectFaces] Outer error — returning []:', error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadFaceModel, detectFaces, applyNMS, clearFaceModelCache, modelCache };
}
