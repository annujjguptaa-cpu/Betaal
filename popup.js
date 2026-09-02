/* popup.js */

let timerInterval = null;
let startTime = 0;

function updateBadgeState(state, text) {
  const badge = document.getElementById('state-badge');
  if (!badge) return;
  badge.className = `badge ${state}`;
  badge.textContent = text;
}

// Redaction Toggle Handler
const redactionToggle = document.getElementById('redaction-toggle');
const toggleStatusText = document.getElementById('toggle-status-text');
const toggleWarningMsg = document.getElementById('toggle-warning-msg');

redactionToggle.addEventListener('change', () => {
  if (redactionToggle.checked) {
    toggleStatusText.textContent = 'Redaction: ON';
    toggleStatusText.className = 'toggle-label on';
    toggleWarningMsg.style.display = 'none';
  } else {
    toggleStatusText.textContent = 'Redaction: OFF';
    toggleStatusText.className = 'toggle-label off';
    toggleWarningMsg.style.display = 'block';
  }
});

document.getElementById('run-agent-btn').addEventListener('click', async () => {
  const runBtn = document.getElementById('run-agent-btn');
  const debugPanel = document.getElementById('debug-panel');
  const statusList = document.getElementById('status-list');

  const isRedactionEnabled = redactionToggle.checked;

  runBtn.disabled = true;
  updateBadgeState('running', 'Running...');
  debugPanel.innerHTML = '';
  statusList.innerHTML = '';

  // Timer Setup
  startTime = performance.now();
  const timerDiv = document.createElement('div');
  timerDiv.className = 'timer-badge';
  timerDiv.id = 'live-timer';
  timerDiv.textContent = '⏱️ Running: 0 ms';
  debugPanel.appendChild(timerDiv);

  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.round(performance.now() - startTime);
    const tEl = document.getElementById('live-timer');
    if (tEl) tEl.textContent = `⏱️ Running: ${elapsed} ms`;
  }, 100);

  const addStatus = (msg) => {
    const p = document.createElement('div');
    p.textContent = msg;
    statusList.appendChild(p);
  };

  const captureStart = performance.now();

  try {
    // Stage 1: Capture Screen
    addStatus('⏳ [1/6] Capturing visible tab screenshot...');
    const captureRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (res) => resolve(res));
    });

    if (!captureRes || !captureRes.success) {
      throw new Error(captureRes ? captureRes.error : 'Failed to capture tab screenshot.');
    }
    const captureTime = Math.round(performance.now() - captureStart);
    addStatus(`✅ [1/6] Screen screenshot captured (${captureTime} ms)`);

    // Stage 2: Process Screenshot via Pipeline
    addStatus('⏳ [2/6] Running local vision detection & redaction pipeline...');
    const pipelineRes = await processScreenshot(captureRes.dataUrl);

    // Determine payload image based on redaction toggle state
    const payloadImage = isRedactionEnabled ? pipelineRes.redactedImage : pipelineRes.originalImage;
    addStatus(`✅ [2/6] Privacy pipeline complete (PII fields: ${pipelineRes.counts.piiFields}, Faces: ${pipelineRes.counts.faces})`);

    // Stage 3: Fetch DOM Structure
    const domStart = performance.now();
    addStatus('⏳ [3/6] Fetching page DOM structure...');
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) throw new Error('No active tab found.');

    const domRes = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM_STRUCTURE' }, (res) => resolve(res));
    });

    const domStructure = (domRes && domRes.success) ? domRes.domStructure : [];
    const domTime = Math.round(performance.now() - domStart);
    addStatus(`✅ [3/6] DOM structure retrieved (${domStructure.length} elements, ${domTime} ms)`);

    // Stage 4: Send to Backend VLM Server
    const netStart = performance.now();
    addStatus('⏳ [4/6] Sending payload to Backend VLM server...');
    const goal = 'Help me submit this grievance form';
    const actionResponse = await sendToBackend(payloadImage, goal, domStructure);
    const netTime = Math.round(performance.now() - netStart);
    addStatus(`✅ [4/6] VLM reasoning complete: Action=${actionResponse.action}, Selector=${actionResponse.selector} (${netTime} ms)`);

    // Stage 5: Execute Action on Page
    const execStart = performance.now();
    addStatus(`⏳ [5/6] Executing action [${actionResponse.action}] on selector "${actionResponse.selector}"...`);
    
    // Inject action-executor script dynamically if not already active on tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ['extension/action-executor.js']
      });
    } catch (e) {
      // Ignore if already loaded or on chrome://
    }

    const execRes = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'EXECUTE_ACTION', action: actionResponse }, (res) => {
        if (chrome.runtime.lastError) {
          // Attempt direct in-tab execution fallback via scripting API
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (act) => {
              const el = document.querySelector(act.selector);
              if (!el) return { success: false, error: 'Selector not found: ' + act.selector };
              el.style.outline = '3px solid #ef4444';
              setTimeout(() => { el.style.outline = ''; }, 1000);
              if (act.action === 'click') el.click();
              return { success: true };
            },
            args: [actionResponse]
          }).then((results) => {
            resolve(results?.[0]?.result || { success: false, error: chrome.runtime.lastError.message });
          }).catch((err) => resolve({ success: false, error: err.message }));
        } else {
          resolve(res);
        }
      });
    });

    if (!execRes || !execRes.success) {
      const detail = execRes ? execRes.error : 'Action execution failed on target page.';
      throw new Error(detail);
    }
    const execTime = Math.round(performance.now() - execStart);
    addStatus(`✅ [5/6] Action executed on active page (${execTime} ms)`);

    // Stop Live Timer
    clearInterval(timerInterval);
    const totalRunTime = Math.round(performance.now() - startTime);

    // Freeze & Render Breakdown Timer
    const tEl = document.getElementById('live-timer');
    if (tEl) {
      tEl.innerHTML = `⏱️ <b>Timing Breakdown:</b><br>` +
        `Capture: ${captureTime}ms | Classify: ${pipelineRes.timing.classification}ms | ` +
        `PII Detection: ${pipelineRes.timing.piiDetection}ms | Face Detection: ${pipelineRes.timing.faceDetection}ms | ` +
        `Redaction: ${pipelineRes.timing.redaction}ms | Network+VLM: ${netTime}ms | Action: ${execTime}ms | ` +
        `<b>Total: ${totalRunTime}ms</b>`;
    }

    // Render Side-by-Side Thumbnails (Original vs Redacted)
    const thumbRow = document.createElement('div');
    thumbRow.className = 'thumbnails-row';
    thumbRow.innerHTML = `
      <div class="thumb-card">
        <span>Original Screen (Click to Zoom)</span>
        <img id="thumb-orig" src="${pipelineRes.originalImage}" alt="Original Screenshot" />
      </div>
      <div class="thumb-card">
        <span>Redacted Screen (Click to Zoom)</span>
        <img id="thumb-redacted" src="${pipelineRes.redactedImage}" alt="Redacted Screenshot" />
      </div>
    `;
    debugPanel.appendChild(thumbRow);

    // Wire Click-to-Zoom Modal
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const closeModalBtn = document.getElementById('close-modal-btn');

    const openZoom = (src) => {
      modalImg.src = src;
      modal.style.display = 'flex';
    };

    document.getElementById('thumb-orig').addEventListener('click', () => openZoom(pipelineRes.originalImage));
    document.getElementById('thumb-redacted').addEventListener('click', () => openZoom(pipelineRes.redactedImage));

    closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    // Render Detection Audit Table (WITHOUT leaking raw PII text)
    const tableHeader = `
      <table class="detection-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Detected Text (Safe)</th>
            <th>Redaction Method</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    let tableRows = '';
    const formatSafeType = (type) => {
      switch (type) {
        case 'aadhaar': return 'Aadhaar Number';
        case 'phone': return 'Phone Number';
        case 'address': return 'Address Text';
        case 'pan': return 'PAN Card Number';
        case 'email': return 'Email Address';
        case 'face': return 'User Face Region';
        default: return 'Sensitive Region';
      }
    };

    pipelineRes.detectedRegions.forEach((region) => {
      const safeLabel = formatSafeType(region.type);
      const safeText = region.type === 'face' ? '[Face Detection Box]' : `${safeLabel} [HIDDEN]`;
      const methodLabel = region.method === 'blur' ? 'Irreversible Pixelation' : 'Solid Blackfill';

      tableRows += `
        <tr>
          <td><b>${safeLabel}</b></td>
          <td>${safeText}</td>
          <td>${methodLabel}</td>
          <td><span class="status-tag">REDACTED</span></td>
        </tr>
      `;
    });

    if (pipelineRes.detectedRegions.length === 0) {
      tableRows = `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No sensitive PII or faces detected.</td></tr>`;
    }

    const tableFooter = `</tbody></table>`;
    const tableContainer = document.createElement('div');
    tableContainer.innerHTML = tableHeader + tableRows + tableFooter;
    debugPanel.appendChild(tableContainer);

    // Stage 6: Completion
    addStatus('🎉 [6/6] Pipeline & Action Execution Complete!');
    updateBadgeState('ready', 'Ready');

  } catch (err) {
    clearInterval(timerInterval);
    console.error('[Run Agent Pipeline Error]:', err);
    updateBadgeState('error', 'Error');

    const errDiv = document.createElement('div');
    errDiv.id = 'error-message';
    errDiv.textContent = `❌ Execution Error: ${err.message}`;
    debugPanel.appendChild(errDiv);

  } finally {
    runBtn.disabled = false;
  }
});
