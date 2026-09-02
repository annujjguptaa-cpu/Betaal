/* extension/redaction/redact.js */

/**
 * Draws a fully opaque solid black rectangle over the given boundingBox on the provided 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx 
 * @param {{x: number, y: number, width: number, height: number}} boundingBox 
 */
function applyBlackFill(ctx, boundingBox) {
  if (!ctx || !boundingBox) return;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height);
  ctx.restore();
}

/**
 * Pixelates/blurs a given boundingBox region on the canvas without smoothing (irreversible pixelation).
 * @param {CanvasRenderingContext2D} ctx 
 * @param {{x: number, y: number, width: number, height: number}} boundingBox 
 * @param {number} pixelSize 
 */
function applyBlur(ctx, boundingBox, pixelSize = 12) {
  if (!ctx || !boundingBox || boundingBox.width <= 0 || boundingBox.height <= 0) return;

  ctx.save();
  const { x, y, width, height } = boundingBox;

  // Extract raw ImageData for the target region
  const imgData = ctx.getImageData(x, y, width, height);

  // Create temporary offscreen canvas for downscaling
  const offscreen = document.createElement('canvas');
  const smallWidth = Math.max(1, Math.floor(width / pixelSize));
  const smallHeight = Math.max(1, Math.floor(height / pixelSize));
  offscreen.width = smallWidth;
  offscreen.height = smallHeight;

  const offCtx = offscreen.getContext('2d');
  
  // Put extracted image data on a temp canvas matching full region size
  const tempFull = document.createElement('canvas');
  tempFull.width = width;
  tempFull.height = height;
  tempFull.getContext('2d').putImageData(imgData, 0, 0);

  // Draw scaled down to offscreen canvas
  offCtx.drawImage(tempFull, 0, 0, smallWidth, smallHeight);

  // Disable image smoothing for blocky pixelation effect
  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.msImageSmoothingEnabled = false;

  // Draw back scaled up to original canvas context
  ctx.drawImage(offscreen, 0, 0, smallWidth, smallHeight, x, y, width, height);

  ctx.restore();
}

/**
 * Redacts specified regions on an image data URL and returns a new redacted PNG data URL.
 * @param {string} imageDataUrl 
 * @param {Array<{boundingBox: {x, y, width, height}, method?: 'blackfill'|'blur'}>} regions 
 * @returns {Promise<string>} Redacted base64 PNG Data URL
 */
async function redactImage(imageDataUrl, regions = []) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Apply redactions
      for (const region of regions) {
        const method = region.method || 'blackfill';
        if (method === 'blur') {
          applyBlur(ctx, region.boundingBox, region.pixelSize || 12);
        } else {
          applyBlackFill(ctx, region.boundingBox);
        }
      }

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (err) => reject(new Error('Failed to load image for redaction: ' + err));
    img.src = imageDataUrl;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyBlackFill, applyBlur, redactImage };
}
