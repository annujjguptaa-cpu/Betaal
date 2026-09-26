/* extension/som-overlay.js
 *
 * Set-of-Marks (SoM) Visual Overlay Engine.
 * Injects an isolated Shadow DOM overlay that draws numbered bounding boxes over real page elements.
 * Highlighted chosen element is drawn in distinct green (#22c55e), neutral elements in indigo (#6366f1).
 * Auto-removes after highlight window (2.5 seconds) to avoid cluttering page state.
 */

(function () {
  if (window.__betaalSomOverlayInitialized) return;
  window.__betaalSomOverlayInitialized = true;

  let hostEl = null;
  let shadowRoot = null;
  let overlayContainer = null;
  let autoRemoveTimer = null;

  function initSomOverlayHost() {
    if (hostEl) return;

    hostEl = document.createElement('div');
    hostEl.id = 'betaal-som-overlay-host';
    hostEl.style.position = 'absolute';
    hostEl.style.top = '0';
    hostEl.style.left = '0';
    hostEl.style.width = '100%';
    hostEl.style.height = '100%';
    hostEl.style.pointerEvents = 'none';
    hostEl.style.zIndex = '2147483646'; // 1 under agent cursor

    shadowRoot = hostEl.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .som-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }
      .som-box {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid rgba(99, 102, 241, 0.7);
        background: rgba(99, 102, 241, 0.08);
        border-radius: 4px;
        pointer-events: none;
        transition: all 0.2s ease-in-out;
      }
      .som-box.chosen {
        border: 3px solid #22c55e !important;
        background: rgba(34, 197, 94, 0.2) !important;
        box-shadow: 0 0 12px rgba(34, 197, 94, 0.6);
        z-index: 10;
      }
      .som-label {
        position: absolute;
        top: -20px;
        left: -2px;
        background: #6366f1;
        color: #ffffff;
        font-family: monospace, sans-serif;
        font-size: 11px;
        font-weight: bold;
        padding: 1px 5px;
        border-radius: 3px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }
      .som-box.chosen .som-label {
        background: #22c55e !important;
        color: #000000 !important;
        font-size: 12px !important;
      }
    `;

    overlayContainer = document.createElement('div');
    overlayContainer.className = 'som-container';

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(overlayContainer);

    const mount = () => {
      if (document.body) document.body.appendChild(hostEl);
      else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(hostEl));
    };
    mount();
  }

  /**
   * Cleans up and removes all active SoM bounding boxes.
   */
  window.clearSomOverlay = function () {
    if (autoRemoveTimer) {
      clearTimeout(autoRemoveTimer);
      autoRemoveTimer = null;
    }
    if (overlayContainer) {
      overlayContainer.innerHTML = '';
    }
  };

  /**
   * Renders Set-of-Marks (SoM) bounding boxes over DOM structure elements.
   * @param {Array<Object>} domStructure - Array of element objects from GET_DOM_STRUCTURE
   * @param {string} [chosenSelector] - CSS selector of element chosen by VLM
   * @param {number} [displayMs=2500] - Duration to display overlay before auto-removing
   */
  window.renderSomOverlay = function (domStructure = [], chosenSelector = null, displayMs = 2500) {
    initSomOverlayHost();
    window.clearSomOverlay();

    if (!Array.isArray(domStructure) || domStructure.length === 0) return;

    const scrollY = window.scrollY || 0;
    const scrollX = window.scrollX || 0;

    let chosenEl = null;
    if (chosenSelector) {
      try { chosenEl = document.querySelector(chosenSelector); } catch (e) {}
    }

    domStructure.forEach((item, idx) => {
      if (!item.rect) return;

      const isChosen = chosenSelector && (
        (chosenEl && chosenEl === document.querySelector(item.id ? `#${item.id}` : (item.name ? `[name="${item.name}"]` : item.tag))) ||
        (item.id && chosenSelector === `#${item.id}`) ||
        (item.name && chosenSelector.includes(item.name)) ||
        (item.id && chosenSelector.includes(item.id))
      );

      const box = document.createElement('div');
      box.className = `som-box ${isChosen ? 'chosen' : ''}`;
      box.style.left = `${item.rect.left}px`;
      box.style.top = `${item.rect.top}px`;
      box.style.width = `${item.rect.width}px`;
      box.style.height = `${item.rect.height}px`;

      const label = document.createElement('div');
      label.className = 'som-label';
      label.textContent = `[${idx + 1}] ${item.tag.toUpperCase()}`;

      box.appendChild(label);
      overlayContainer.appendChild(box);
    });

    // Auto-remove overlay after displayMs to prevent page clutter
    autoRemoveTimer = setTimeout(() => {
      window.clearSomOverlay();
    }, displayMs);
  };
})();
