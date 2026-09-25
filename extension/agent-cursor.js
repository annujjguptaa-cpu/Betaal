/* extension/agent-cursor.js
 *
 * Theme-aware Animated Agent Cursor & Visual Feedback Engine.
 * Renders an isolated SVG cursor inside a closed Shadow Root so host site CSS cannot affect it.
 * Smoothly glides across the viewport to point at target elements before actions execute.
 */

(function () {
  if (window.__betaalCursorInitialized) return;
  window.__betaalCursorInitialized = true;

  // Create isolated Shadow DOM host container
  const host = document.createElement('div');
  host.id = 'betaal-agent-cursor-host';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '2147483647'; // Max z-index

  const shadow = host.attachShadow({ mode: 'closed' });

  // Styles inside shadow root
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .cursor-wrapper {
      position: absolute;
      top: 0;
      left: 0;
      width: 32px;
      height: 32px;
      transform: translate(-50%, -50%);
      transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease;
      opacity: 0;
      pointer-events: none;
      filter: drop-shadow(0px 4px 10px rgba(0, 0, 0, 0.35));
    }
    .cursor-wrapper.visible {
      opacity: 1;
    }
    .cursor-pointer {
      width: 28px;
      height: 28px;
      fill: #6366f1;
      stroke: #ffffff;
      stroke-width: 2;
    }
    .cursor-glow {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 44px;
      height: 44px;
      margin-top: -22px;
      margin-left: -22px;
      border-radius: 50%;
      border: 2px solid #6366f1;
      animation: pulse-glow 1.5s infinite ease-in-out;
      opacity: 0.6;
    }
    .click-ripple {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 10px;
      height: 10px;
      margin-top: -5px;
      margin-left: -5px;
      border-radius: 50%;
      background: rgba(99, 102, 241, 0.6);
      transform: scale(1);
      opacity: 0;
    }
    .click-ripple.animate {
      animation: ripple 0.6s ease-out;
    }
    @keyframes pulse-glow {
      0%, 100% { transform: scale(1); opacity: 0.4; }
      50% { transform: scale(1.25); opacity: 0.8; }
    }
    @keyframes ripple {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(5); opacity: 0; }
    }
  `;

  // Cursor HTML
  const wrapper = document.createElement('div');
  wrapper.className = 'cursor-wrapper';
  wrapper.innerHTML = `
    <div class="cursor-glow"></div>
    <div class="click-ripple"></div>
    <svg class="cursor-pointer" viewBox="0 0 24 24">
      <path d="M3 3l7 18 3-7 7-3L3 3z"/>
    </svg>
  `;

  shadow.appendChild(style);
  shadow.appendChild(wrapper);

  // Append to document when ready
  const mount = () => {
    if (document.body) document.body.appendChild(host);
    else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host));
  };
  mount();

  const rippleEl = wrapper.querySelector('.click-ripple');

  /**
   * Animates the agent cursor to target coordinates and triggers click ripple.
   * @param {number} targetX 
   * @param {number} targetY 
   * @param {boolean} triggerClickRipple 
   * @returns {Promise<void>}
   */
  window.animateAgentCursor = function (targetX, targetY, triggerClickRipple = true) {
    return new Promise((resolve) => {
      wrapper.classList.add('visible');
      wrapper.style.transform = `translate(${targetX}px, ${targetY}px)`;

      setTimeout(() => {
        if (triggerClickRipple && rippleEl) {
          rippleEl.classList.remove('animate');
          void rippleEl.offsetWidth; // Force reflow
          rippleEl.classList.add('animate');
        }
        setTimeout(resolve, 350);
      }, 450);
    });
  };

  /**
   * Hides the agent cursor after execution.
   */
  window.hideAgentCursor = function () {
    if (wrapper) wrapper.classList.remove('visible');
  };
})();
