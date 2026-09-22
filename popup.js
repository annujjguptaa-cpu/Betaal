/* popup.js */

let selectedPerformanceMode = 'balanced';
let pendingInterventions = [];
let pausedLoopState = null;

// DOM Elements
let runBtn, compareBtn, goalInput, goalError, statusList, debugPanel, liveTimerEl, stateBadge, redactionToggle;

function updateBadgeState(state, text) {
  if (!stateBadge) stateBadge = document.getElementById('state-badge');
  if (!stateBadge) return;

  stateBadge.className = 'badge ' + state;
  stateBadge.textContent = text || (state.charAt(0).toUpperCase() + state.slice(1));
}

// =========================================================================
// POPUP INITIALIZATION & REACTIVE STATE REHYDRATION (Prompt 71)
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  runBtn = document.getElementById('run-agent-btn');
  compareBtn = document.getElementById('compare-modes-btn');
  goalInput = document.getElementById('goal-input');
  goalError = document.getElementById('goal-error');
  statusList = document.getElementById('status-list');
  debugPanel = document.getElementById('debug-panel');
  liveTimerEl = document.getElementById('live-timer');
  stateBadge = document.getElementById('state-badge');
  redactionToggle = document.getElementById('redaction-toggle');

  // Redaction toggle change listener
  if (redactionToggle) {
    const toggleStatusText = document.getElementById('toggle-status-text');
    const toggleWarning = document.getElementById('toggle-warning-msg');
    redactionToggle.addEventListener('change', () => {
      if (redactionToggle.checked) {
        if (toggleStatusText) {
          toggleStatusText.textContent = 'Redaction: ON';
          toggleStatusText.className = 'toggle-label on';
        }
        if (toggleWarning) toggleWarning.style.display = 'none';
      } else {
        if (toggleStatusText) {
          toggleStatusText.textContent = 'Redaction: OFF';
          toggleStatusText.className = 'toggle-label off';
        }
        if (toggleWarning) toggleWarning.style.display = 'block';
      }
    });
  }

  // Segmented Control Event Handler
  const segmentedBtns = document.querySelectorAll('.segmented-btn');
  const policy = await getPolicy();
  selectedPerformanceMode = policy.performanceMode || 'balanced';

  segmentedBtns.forEach((btn) => {
    const mode = btn.getAttribute('data-mode');
    if (mode === selectedPerformanceMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }

    btn.addEventListener('click', async () => {
      segmentedBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPerformanceMode = mode;
      console.log(`[Performance Mode Switch]: Switched to ${selectedPerformanceMode.toUpperCase()} mode.`);

      // Persist to policy storage
      const currentPolicy = await getPolicy();
      currentPolicy.performanceMode = selectedPerformanceMode;
      await savePolicy(currentPolicy);
    });
  });

  if (compareBtn) {
    compareBtn.addEventListener('click', runModeComparison);
  }

  // Bind Main Run Agent Button
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      triggerAgentLoop();
    });
  }

  // Model Cache Clear Button (Prompt 72)
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  const cacheStatusMsg = document.getElementById('cache-status-msg');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
      clearAllModelCaches();
      if (cacheStatusMsg) {
        cacheStatusMsg.textContent = '✅ All model session caches successfully cleared!';
        cacheStatusMsg.style.display = 'block';
        setTimeout(() => { cacheStatusMsg.style.display = 'none'; }, 3000);
      }
    });
  }

  // Tab Switching Handler
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabContents.forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(targetTabId);
      if (targetContent) targetContent.classList.add('active');

      if (targetTabId === 'vault-tab') renderVaultTab();
      if (targetTabId === 'notifications-tab') renderNotificationsTab();
      if (targetTabId === 'policy-tab') renderPolicyTab();
      if (targetTabId === 'profile-tab') renderProfileTab();
    });
  });

  // Fetch initial background loop state upon opening popup (Prompt 71)
  await syncWithBackgroundLoopState();

  renderVaultTab();
  renderNotificationsTab();
  renderPolicyTab();
  renderProfileTab();
  wireProfileTab();  // Wire save/clear handlers once on load
});

// =========================================================================
// REACTIVE LISTENER FOR BACKGROUND LOOP EVENTS (Prompts 70, 71, 78, 79, 80)
// =========================================================================

browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'LOOP_STATE_UPDATE') {
    applyLoopStateToUI(message.state);
  }
  // Prompt 78 & 79: Live feed item update — render single card as it arrives
  if (message.type === 'FEED_UPDATE') {
    if (message.activityFeed) {
      renderActivityFeed(message.activityFeed);
    }
  }
});

async function syncWithBackgroundLoopState() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'GET_LOOP_STATE' });
    if (res && res.success && res.state) {
      applyLoopStateToUI(res.state);
      // Prompt 78: Replay full feed history when popup is (re)opened mid-task
      if (res.state.activityFeed && res.state.activityFeed.length > 0) {
        renderActivityFeed(res.state.activityFeed);
      }
    }
  } catch (err) {
    console.warn('[Popup] Failed to sync background loop state:', err);
  }
}

function applyLoopStateToUI(state) {
  if (!state) return;

  // Sync goal if present
  if (goalInput && state.goal && !goalInput.value) {
    goalInput.value = state.goal;
  }

  // Sync state badge
  if (state.isLocked) {
    updateBadgeState('running', 'Running Loop...');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Agent Busy...';
    }
  } else if (state.status === 'paused') {
    updateBadgeState('error', 'Paused for Approval');
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Agent';
    }
  } else if (state.status === 'error') {
    updateBadgeState('error', 'Error');
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Agent';
    }
  } else {
    updateBadgeState('ready', state.statusText || 'Ready');
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Agent';
    }
  }

  // Sync Logs (hidden, available for debugging)
  if (statusList && Array.isArray(state.logs)) {
    statusList.innerHTML = state.logs.map(log => `<div>${log}</div>`).join('');
  }

  // Sync Pending Interventions
  if (Array.isArray(state.pendingInterventions)) {
    pendingInterventions = state.pendingInterventions;
    renderNotificationsTab();
  }

  // Prompt 79: Update feed progress bar
  const feedProgressBar = document.getElementById('feed-progress-bar');
  const feedProgressText = document.getElementById('feed-progress-text');
  const feedProgressRate = document.getElementById('feed-progress-rate');
  if (feedProgressBar && state.iterationCount > 0) {
    feedProgressBar.style.display = 'flex';
    const stepLabel = state.isLocked
      ? `Step ${state.iterationCount} of ${state.maxIterations || 15} — Running`
      : state.status === 'paused'
      ? `Step ${state.iterationCount} — ⚠️ Awaiting Approval`
      : state.status === 'error'
      ? `Step ${state.iterationCount} — ❌ Error`
      : `Step ${state.iterationCount} of ${state.maxIterations || 15} — ${state.statusText || 'Complete'}`;
    if (feedProgressText) feedProgressText.textContent = stepLabel;
    if (feedProgressRate && state.domStabilityMs) {
      const pacingText = state.pacingDelayMs ? ` · ${state.pacingDelayMs}ms pacing` : '';
      feedProgressRate.textContent = `DOM: ${state.domStabilityMs}ms${pacingText}`;
    }
  }

  // Sync DOM stability & pacing timing display if present (Prompts 68 & 76)
  if (liveTimerEl && (state.domStabilityMs || state.pacingDelayMs)) {
    liveTimerEl.style.display = 'block';
    const pacingText = state.pacingDelayMs ? ` | Pacing Delay: ${state.pacingDelayMs}ms` : '';
    const domText = state.domStabilityMs ? `DOM Stability: ${state.domStabilityMs}ms` : 'DOM: settled';
    liveTimerEl.innerHTML = `⏱️ <b>Loop Telemetry:</b> ${domText}${pacingText} | Iteration: ${state.iterationCount || 0}/${state.maxIterations || 15}`;
  }
}

// =========================================================================
// RUN AGENT TRIGGER (Prompts 68-71)
// =========================================================================

async function triggerAgentLoop(resumeAction = null) {
  const goal = goalInput ? goalInput.value.trim() : '';

  if (!goal) {
    if (goalError) goalError.style.display = 'block';
    return;
  } else {
    if (goalError) goalError.style.display = 'none';
  }

  const isRedactionEnabled = redactionToggle ? redactionToggle.checked : true;

  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = 'Agent Busy...';
  }
  updateBadgeState('running', 'Starting Loop...');
  if (debugPanel) debugPanel.innerHTML = '';
  if (statusList) statusList.innerHTML = '<div>⏳ Launching background agent loop...</div>';

  try {
    // Check if pipeline pre-run is needed for active tab preview
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTabUrl = tabs && tabs[0] ? (tabs[0].url || 'Unknown') : 'global';
    
    // Capture and execute local privacy pipeline in popup so live visual thumbnails & timing are generated
    const cap = await browser.runtime.sendMessage({ type: 'CAPTURE_SCREEN' });
    if (cap && cap.success) {
      let domStructure = [];
      try {
        const dRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM_STRUCTURE' });
        domStructure = (dRes && dRes.success) ? dRes.domStructure : [];
      } catch (e) {}

      const pipelineRes = await processScreenshot(cap.dataUrl, domStructure, currentTabUrl);

      // Render side-by-side thumbnails & detection table
      renderPipelineArtifacts(pipelineRes);

      // Forward pipeline result to background
      await browser.runtime.sendMessage({
        type: 'STEP_PIPELINE_DONE',
        pipelineRes
      });
    }

    // Send START_LOOP to background script (Prompt 70 & 71)
    const startRes = await browser.runtime.sendMessage({
      type: 'START_LOOP',
      goal,
      redactionEnabled: isRedactionEnabled,
      resumeAction
    });

    if (startRes && !startRes.success) {
      if (startRes.isLocked) {
        updateBadgeState('busy', 'Agent Busy');
        if (statusList) statusList.innerHTML += '<div style="color:#f59e0b;">⚠️ Agent is currently busy executing another iteration. Request queued/ignored.</div>';
      } else {
        throw new Error(startRes.error || 'Failed to start agent loop in background.');
      }
    }
  } catch (err) {
    console.error('[TriggerAgentLoop Error]:', err);
    updateBadgeState('error', 'Error');
    if (statusList) statusList.innerHTML += `<div style="color:#ef4444;">❌ Error: ${err.message}</div>`;
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Agent';
    }
  }
}

// =========================================================================
// ACTIVITY FEED RENDERER (Prompts 78, 79, 80)
// =========================================================================

function getFeedIcon(status) {
  switch (status) {
    case 'completed':      return '✅';
    case 'running':        return '<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span>';
    case 'paused':         return '🔔';
    case 'approved':       return '▶️';
    case 'stopped':        return '🛑';
    case 'user-corrected': return '✏️';
    default:               return '🔹';
  }
}

function buildFeedCardHTML(item) {
  const icon = getFeedIcon(item.status);
  const stepLabel = item.maxIterations
    ? `Step ${item.stepIndex} of ${item.maxIterations}`
    : `Step ${item.stepIndex}`;

  // Detection count meta string
  const counts = item.detectionCounts || {};
  const metaDetection = counts.detected !== undefined
    ? `${counts.detected} detected · ${counts.redacted || 0} redacted · ${counts.skipped || 0} skipped`
    : '';

  // Timing string from pipeline result
  const timing = item.timing;
  const metaTiming = timing
    ? `PII: ${timing.piiDetection}ms · Face: ${timing.faceDetection}ms · Redact: ${timing.redaction}ms`
    : '';

  // Inline action buttons (Prompts 80 & 81) — only for paused steps
  const inlineActions = item.status === 'paused' && item.interventionId ? `
    <div class="feed-inline-actions">
      <div style="font-size:0.72rem;color:#f59e0b;margin-bottom:6px;width:100%;">
        ⚠️ Approval required: <b>${item.subtitle}</b>
      </div>
      <button class="feed-inline-btn feed-approve-btn" data-id="${item.interventionId}">✅ Approve &amp; Continue</button>
      <button class="feed-inline-btn feed-stop-btn" data-id="${item.interventionId}">🛑 Stop Here</button>
    </div>
    <div class="feed-correction-row">
      <div class="feed-correction-label">✏️ Or tell it what to do instead:</div>
      <div class="feed-correction-input-row">
        <input
          type="text"
          class="feed-correction-input"
          data-intervention-id="${item.interventionId}"
          placeholder="e.g. Click the Sign In button instead..."
        />
        <button class="feed-correction-submit" data-intervention-id="${item.interventionId}">Send</button>
      </div>
    </div>` : '';

  // Expandable Details (Prompt 79) — thumbnails + timing inside <details>
  const thumbsHTML = (item.originalImage && item.redactedImage) ? `
    <div class="thumbnails-row" style="margin-bottom:8px;">
      <div class="thumb-card" style="max-width:50%;">
        <span>Original</span>
        <img src="${item.originalImage}" class="feed-step-thumb" data-src="${item.originalImage}" style="cursor:zoom-in;" />
      </div>
      <div class="thumb-card" style="max-width:50%;">
        <span>Redacted</span>
        <img src="${item.redactedImage}" class="feed-step-thumb" data-src="${item.redactedImage}" style="cursor:zoom-in;" />
      </div>
    </div>` : '';

  const detailsBody = (thumbsHTML || metaTiming) ? `
    <details class="feed-details-toggle">
      <summary>🔍 Step Details</summary>
      <div class="feed-details-body">
        ${thumbsHTML}
        ${metaTiming ? `<div style="font-size:0.7rem;color:#64748b;margin-top:4px;">${metaTiming}</div>` : ''}
        ${item.detectionSummary ? `<div style="font-size:0.7rem;color:#94a3b8;margin-top:4px;">🛡️ ${item.detectionSummary}</div>` : ''}
      </div>
    </details>` : '';

  return `
    <div class="feed-card ${item.status}" data-step-id="${item.id}">
      <div class="feed-card-header">
        <span class="feed-icon">${icon}</span>
        <div class="feed-card-content">
          <div class="feed-card-title">${item.title}</div>
          ${item.reasoning ? `<div class="feed-card-reasoning">${item.reasoning}</div>` : ''}
          <div class="feed-card-meta">
            <span>${stepLabel}</span>
            <span style="color:#475569;">${metaDetection}</span>
          </div>
        </div>
      </div>
      ${inlineActions}
      ${detailsBody}
    </div>`;
}

function renderActivityFeed(feedItems) {
  const container = document.getElementById('activity-feed-container');
  if (!container || !Array.isArray(feedItems)) return;

  // Re-render all cards (idempotent — safe to call on every update)
  container.innerHTML = feedItems.map(buildFeedCardHTML).join('');

  // Wire inline approve/stop buttons (Prompt 80)
  container.querySelectorAll('.feed-approve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      window.approveIntervention(id);
    });
  });
  container.querySelectorAll('.feed-stop-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      window.stopIntervention(id);
    });
  });

  // Prompt 81: Wire correction input submit (button click + Enter key)
  const submitCorrection = (interventionId, inputEl) => {
    const text = inputEl.value.trim();
    if (!text) {
      inputEl.focus();
      inputEl.style.borderColor = '#ef4444';
      setTimeout(() => { inputEl.style.borderColor = ''; }, 1200);
      return;
    }
    // Disable to prevent double-submit
    inputEl.disabled = true;
    const submitBtn = inputEl.parentElement.querySelector('.feed-correction-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳';
    }
    // Replace the whole correction row with a "sent" confirmation
    const correctionRow = inputEl.closest('.feed-correction-row');
    if (correctionRow) {
      correctionRow.innerHTML = `<div style="font-size:0.72rem;color:#a78bfa;padding:4px 0;">✏️ Correction sent: "<em>${text.replace(/</g,'&lt;')}</em>"</div>`;
    }
    // Also collapse the approve/stop buttons so the card reads clearly
    const inlineActions = inputEl.closest('.feed-card')?.querySelector('.feed-inline-actions');
    if (inlineActions) {
      inlineActions.innerHTML = `<div style="font-size:0.72rem;color:#a78bfa;padding:2px 0;">Redirecting agent with your instruction…</div>`;
    }
    window.sendUserCorrection(interventionId, text);
  };

  container.querySelectorAll('.feed-correction-submit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-intervention-id');
      const input = btn.parentElement.querySelector('.feed-correction-input');
      if (input) submitCorrection(id, input);
    });
  });

  container.querySelectorAll('.feed-correction-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const id = input.getAttribute('data-intervention-id');
        submitCorrection(id, input);
      }
    });
  });

  // Wire per-step thumbnail zoom into the shared modal
  const modal = document.getElementById('image-modal');
  const modalImg = document.getElementById('modal-img');
  container.querySelectorAll('.feed-step-thumb').forEach(img => {
    img.addEventListener('click', () => {
      if (modal && modalImg) {
        modalImg.src = img.getAttribute('data-src');
        modal.style.display = 'flex';
      }
    });
  });

  // Auto-scroll to the last item so live updates are always visible
  container.scrollTop = container.scrollHeight;
}

function renderPipelineArtifacts(pipelineRes) {
  if (!debugPanel || !pipelineRes) return;

  // Render timing breakdown telemetry (Prompt 68 + 72)
  if (liveTimerEl) {
    liveTimerEl.style.display = 'block';
    liveTimerEl.innerHTML = `⏱️ <b>Timing Breakdown (${(pipelineRes.performanceMode || 'balanced').toUpperCase()} Mode):</b><br>` +
      `Classify: ${pipelineRes.timing.classification}ms | ` +
      `PII Detection: ${pipelineRes.timing.piiDetection}ms | Face Detection: ${pipelineRes.timing.faceDetection}ms | ` +
      `Redaction: ${pipelineRes.timing.redaction}ms<br>` +
      `📊 <b>Policy Tally:</b> ${pipelineRes.counts.detected} detected, ${pipelineRes.counts.redacted} redacted, ${pipelineRes.counts.skipped} skipped`;
  }

  // Render side-by-side thumbnails
  let thumbRow = debugPanel.querySelector('.thumbnails-row');
  if (!thumbRow) {
    thumbRow = document.createElement('div');
    thumbRow.className = 'thumbnails-row';
    debugPanel.insertBefore(thumbRow, debugPanel.firstChild);
  }
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

  // Wire Modal Zoom
  const modal = document.getElementById('image-modal');
  const modalImg = document.getElementById('modal-img');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const openZoom = (src) => {
    if (modalImg && modal) {
      modalImg.src = src;
      modal.style.display = 'flex';
    }
  };
  const thumbOrigEl = document.getElementById('thumb-orig');
  const thumbRedEl = document.getElementById('thumb-redacted');
  if (thumbOrigEl) thumbOrigEl.addEventListener('click', () => openZoom(pipelineRes.originalImage));
  if (thumbRedEl) thumbRedEl.addEventListener('click', () => openZoom(pipelineRes.redactedImage));
  if (closeModalBtn) closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  // Render Degradation Notes banner if any detector failed gracefully (Prompt 73)
  let notesBanner = debugPanel.querySelector('.degradation-notes-banner');
  if (pipelineRes.degradationNotes && pipelineRes.degradationNotes.length > 0) {
    if (!notesBanner) {
      notesBanner = document.createElement('div');
      notesBanner.className = 'degradation-notes-banner';
      debugPanel.insertBefore(notesBanner, debugPanel.firstChild);
    }
    notesBanner.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; color: #fca5a5; font-size: 0.8rem;">
        <div style="font-weight: 700; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span>⚠️</span> <span>Pipeline Partial Degradation Notice:</span>
        </div>
        <ul style="margin: 0; padding-left: 18px;">
          ${pipelineRes.degradationNotes.map(n => `<li>${n}</li>`).join('')}
        </ul>
      </div>
    `;
  } else if (notesBanner) {
    notesBanner.remove();
  }

  // Render Redacted PII Audit Table
  let tableContainer = debugPanel.querySelector('.detection-table-container');
  if (!tableContainer) {
    tableContainer = document.createElement('div');
    tableContainer.className = 'detection-table-container';
    debugPanel.appendChild(tableContainer);
  }

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
      case 'possible-id-number': return 'Possible ID Number';
      case 'face': return 'User Face Region';
      default: return 'Sensitive Region';
    }
  };

  pipelineRes.detectedRegions.forEach((region) => {
    const safeLabel = formatSafeType(region.type);
    const safeText = region.type === 'face' ? '[Face Detection Box]' : `${safeLabel} [HIDDEN]`;
    const methodLabel = region.method === 'blur' ? 'Irreversible Pixelation' : 'Solid Blackfill';
    const isEnabled = region.enabled !== false;
    const statusHtml = isEnabled
      ? `<span class="status-tag">REDACTED</span>`
      : `<span style="font-weight:600; color:#f87171;">SKIPPED BY POLICY</span>`;

    tableRows += `
      <tr>
        <td><b>${safeLabel}</b></td>
        <td>${safeText}</td>
        <td>${methodLabel}</td>
        <td>${statusHtml}</td>
      </tr>
    `;
  });

  if (pipelineRes.detectedRegions.length === 0) {
    tableRows = `<tr><td colspan="4" style="text-align:center; color:#94a3b8;">No sensitive PII or faces detected.</td></tr>`;
  }

  tableContainer.innerHTML = tableHeader + tableRows + `</tbody></table>`;
}

// =========================================================================
// RUN MODE COMPARISON (Prompt 72 session timing comparison)
// =========================================================================

async function runModeComparison() {
  if (!compareBtn) return;
  const container = document.getElementById('mode-comparison-container');
  if (!container) return;

  compareBtn.disabled = true;
  compareBtn.textContent = '⏳ Comparing...';
  container.style.display = 'block';
  container.innerHTML = `<div style="color:#38bdf8; font-size:0.8rem; text-align:center; padding:12px; background:#1e293b; border-radius:6px;">⏳ Capturing screenshot & running sequential comparison across Fast, Balanced, and Accurate modes...</div>`;

  try {
    const captureRes = await browser.runtime.sendMessage({ type: 'CAPTURE_SCREEN' });
    if (!captureRes || !captureRes.success) {
      throw new Error(captureRes ? captureRes.error : 'Failed to capture screenshot for comparison.');
    }

    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTabUrl = tabs && tabs[0] ? tabs[0].url : 'global';
    let domStructure = [];
    try {
      const domRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM_STRUCTURE' });
      domStructure = (domRes && domRes.success) ? domRes.domStructure : [];
    } catch (e) {}

    const originalMode = selectedPerformanceMode;

    // Run Fast Mode
    const policyFast = await getPolicy();
    policyFast.performanceMode = 'fast';
    await savePolicy(policyFast);
    const fastRes = await processScreenshot(captureRes.dataUrl, domStructure, currentTabUrl);

    // Run Balanced Mode (benefits from session caching across all model types - Prompt 72)
    const policyBal = await getPolicy();
    policyBal.performanceMode = 'balanced';
    await savePolicy(policyBal);
    const balRes = await processScreenshot(captureRes.dataUrl, domStructure, currentTabUrl);

    // Run Accurate Mode
    const policyAcc = await getPolicy();
    policyAcc.performanceMode = 'accurate';
    await savePolicy(policyAcc);
    const accRes = await processScreenshot(captureRes.dataUrl, domStructure, currentTabUrl);

    // Restore original mode
    const policyRestore = await getPolicy();
    policyRestore.performanceMode = originalMode;
    await savePolicy(policyRestore);

    const modesData = [
      { name: 'Fast Mode', mode: 'fast', data: fastRes },
      { name: 'Balanced Mode', mode: 'balanced', data: balRes },
      { name: 'Accurate Mode', mode: 'accurate', data: accRes }
    ];

    const minLatency = Math.min(...modesData.map(m => m.data.timing.total));
    const maxDetections = Math.max(...modesData.map(m => m.data.counts.detected));

    container.innerHTML = `
      <div style="background:#1e293b; border:1px solid #38bdf8; border-radius:6px; padding:10px;">
        <h3 style="font-size:0.85rem; color:#38bdf8; margin-bottom:8px; text-align:center;">⚡ Live Performance Mode Comparison</h3>
        <div style="display:flex; gap:8px;">
          ${modesData.map(m => {
            const isFastest = m.data.timing.total === minLatency;
            const isMostAccurate = m.data.counts.detected === maxDetections;
            const badgeHtml = isFastest
              ? `<span style="background:#22c55e; color:white; font-size:0.65rem; padding:2px 4px; border-radius:4px; font-weight:bold; display:block; margin-bottom:4px;">⚡ FASTEST</span>`
              : (isMostAccurate ? `<span style="background:#a855f7; color:white; font-size:0.65rem; padding:2px 4px; border-radius:4px; font-weight:bold; display:block; margin-bottom:4px;">🎯 MOST DETECTIONS</span>` : '');

            return `
              <div style="flex:1; background:#0f172a; border:1px solid #334155; border-radius:4px; padding:6px; text-align:center;">
                ${badgeHtml}
                <div style="font-weight:bold; color:#f8fafc; font-size:0.75rem;">${m.name}</div>
                <div style="font-size:0.7rem; color:#94a3b8; margin:2px 0;">Latency: <b style="color:#38bdf8;">${m.data.timing.total}ms</b></div>
                <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:4px;">Detected: <b style="color:#4ade80;">${m.data.counts.detected}</b> (Redacted: ${m.data.counts.redacted})</div>
                <img src="${m.data.redactedImage}" style="width:100%; height:auto; border-radius:3px; border:1px solid #334155; cursor:pointer;" onclick="document.getElementById('modal-img').src='${m.data.redactedImage}'; document.getElementById('image-modal').style.display='flex';" />
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

  } catch (err) {
    container.innerHTML = `<div style="color:#ef4444; font-size:0.75rem; padding:8px; background:#450a0a; border-radius:4px;">❌ Comparison error: ${err.message}</div>`;
  } finally {
    compareBtn.disabled = false;
    compareBtn.textContent = '⚡ Compare Modes';
  }
}

// =========================================================================
// VAULT TAB RENDERING
// =========================================================================

async function renderVaultTab() {
  const vaultListContainer = document.getElementById('vault-list');
  if (!vaultListContainer) return;

  const entries = await getVaultEntries();

  if (!entries || entries.length === 0) {
    vaultListContainer.innerHTML = `<p style="color: #94a3b8; text-align: center; margin-top: 16px;">No activity recorded in Vault yet.</p>`;
    return;
  }

  vaultListContainer.innerHTML = entries.map((entry) => {
    const timeStr = new Date(entry.timestamp).toLocaleString();
    const actionsSummary = (entry.actionsTaken && entry.actionsTaken.length > 0) ? entry.actionsTaken.join(' ➔ ') : 'No actions';

    // Prompt 81: Distinct badge for user-corrected steps
    let badgeColor = '#4ade80'; // completed
    let outcomeBadge = entry.outcome;
    if (entry.outcome === 'paused') { badgeColor = '#38bdf8'; }
    else if (entry.outcome === 'user-corrected') { badgeColor = '#a78bfa'; outcomeBadge = '✏️ user-corrected'; }
    else if (entry.outcome !== 'completed') { badgeColor = '#f87171'; }

    const perfMode = (entry.performanceMode || 'balanced').toUpperCase();

    const snapshotRules = entry.policySnapshot || {};
    const rulesList = Object.entries(snapshotRules).map(([rule, cfg]) => {
      const state = cfg.enabled ? `<span style="color:#4ade80;">ON (${cfg.method || 'blackfill'})</span>` : `<span style="color:#f87171;">OFF (Skipped)</span>`;
      return `${rule}: ${state}`;
    }).join(' | ') || 'Default Policy';

    // Prompt 81: Show correction text if present
    const correctionRow = entry.correctedByUser && entry.correctionText
      ? `<div style="font-size:0.72rem;color:#a78bfa;margin-bottom:4px;">✏️ User instruction: "<em>${entry.correctionText.replace(/</g,'&lt;')}</em>"</div>`
      : '';

    return `
      <div style="background-color: #1e293b; border: 1px solid ${entry.correctedByUser ? '#7c3aed' : '#334155'}; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: #f8fafc; font-size: 0.82rem;">${entry.siteUrl}</span>
          <span style="font-size: 0.7rem; color: ${badgeColor}; font-weight: bold; text-transform: uppercase;">${outcomeBadge}</span>
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px;">
          ${timeStr} | Mode: <b style="color:#38bdf8;">${perfMode}</b> | Redacted: ${entry.redactedCount || entry.piiCount || 0} | Skipped: ${entry.skippedCount || 0}
        </div>
        ${correctionRow}
        <div style="font-size: 0.75rem; color: #cbd5e1; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          Actions: ${actionsSummary}
        </div>
        
        <details style="font-size: 0.7rem; color: #94a3b8; background: #0f172a; padding: 4px 8px; border-radius: 4px; border: 1px solid #334155;">
          <summary style="cursor: pointer; font-weight: bold; color: #38bdf8;">📜 Policy Used Snapshot</summary>
          <div style="margin-top: 4px; line-height: 1.4; word-break: break-word;">
            ${rulesList}
          </div>
        </details>
      </div>
    `;
  }).join('');
}

// =========================================================================
// NOTIFICATIONS TAB RENDERING (Prompt 71 - Background Linked)
// =========================================================================

function renderNotificationsTab() {
  const pendingContainer = document.getElementById('pending-notifications-list');
  const resolvedContainer = document.getElementById('resolved-notifications-list');
  if (!pendingContainer || !resolvedContainer) return;

  const pendingItems = pendingInterventions.filter((item) => item.status === 'pending');
  const resolvedItems = pendingInterventions.filter((item) => item.status !== 'pending');

  browser.runtime.sendMessage({ type: 'UPDATE_BADGE_COUNT', count: pendingItems.length }).catch(() => {});

  if (pendingItems.length === 0) {
    pendingContainer.innerHTML = `<p style="color: #94a3b8; font-size: 0.8rem; text-align: center; margin-top: 12px;">No pending interventions.</p>`;
  } else {
    pendingContainer.innerHTML = pendingItems.map((item) => `
      <div style="background-color: #1e293b; border: 1px solid #ef4444; border-radius: 6px; padding: 10px; margin-bottom: 10px;">
        <div style="font-size: 0.8rem; font-weight: bold; color: #fca5a5; margin-bottom: 4px;">⚠️ Input Required</div>
        <div style="font-size: 0.75rem; color: #f8fafc; margin-bottom: 6px;">${item.reason}</div>
        <div style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 8px;">Target Page: ${item.siteUrl}</div>
        <div style="display: flex; gap: 8px;">
          <button class="approve-btn" data-id="${item.id}" style="flex: 1; padding: 6px; background-color: #22c55e; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Approve & Continue</button>
          <button class="stop-btn" data-id="${item.id}" style="flex: 1; padding: 6px; background-color: #ef4444; color: white; border: none; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">Stop Here</button>
        </div>
      </div>
    `).join('');

    pendingContainer.querySelectorAll('.approve-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        approveIntervention(id);
      });
    });

    pendingContainer.querySelectorAll('.stop-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        stopIntervention(id);
      });
    });
  }

  if (resolvedItems.length === 0) {
    resolvedContainer.innerHTML = `<p style="color: #64748b; font-size: 0.75rem;">No recent decisions.</p>`;
  } else {
    resolvedContainer.innerHTML = `
      <div style="display: flex; justify-content: flex-end; margin-bottom: 4px;">
        <button id="clear-resolved-btn" style="background: none; border: none; color: #ef4444; font-size: 0.7rem; cursor: pointer;">Clear Decisions History</button>
      </div>
    ` + resolvedItems.map((item) => `
      <div style="padding: 6px 0; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 0.75rem; color: #cbd5e1;">Decision: <b style="color: ${item.status === 'approved' ? '#4ade80' : '#f87171'}">${item.status.toUpperCase()}</b></div>
          <div style="font-size: 0.7rem; color: #94a3b8;">${item.reason}</div>
        </div>
        <button class="delete-notif-btn" data-id="${item.id}" style="background: transparent; border: none; color: #64748b; font-size: 0.75rem; cursor: pointer; padding: 2px 6px;">✕</button>
      </div>
    `).join('');

    const clearBtn = document.getElementById('clear-resolved-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        pendingInterventions = pendingInterventions.filter((i) => i.status === 'pending');
        renderNotificationsTab();
      });
    }

    resolvedContainer.querySelectorAll('.delete-notif-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        pendingInterventions = pendingInterventions.filter((i) => i.id !== id);
        renderNotificationsTab();
      });
    });
  }
}

// Global Intervention Decision Functions (Prompts 71 & 80)
window.approveIntervention = async function (id) {
  const item = pendingInterventions.find((i) => i.id === id);
  if (item) {
    item.status = 'approved';
    browser.runtime.sendMessage({ type: 'APPROVE_INTERVENTION', id }).catch(() => {});

    // Prompt 80: Immediately update the feed card in-place (before background responds)
    // Background will also broadcast a FEED_UPDATE, but this ensures instant UI response
    const feedContainer = document.getElementById('activity-feed-container');
    if (feedContainer) {
      const card = feedContainer.querySelector(`[data-step-id*="${id}"], .feed-card.paused`);
      if (card) {
        card.classList.remove('paused');
        card.classList.add('approved');
        const inlineActions = card.querySelector('.feed-inline-actions');
        if (inlineActions) {
          inlineActions.innerHTML = `<div style="font-size:0.75rem;color:#4ade80;padding:4px 0;">▶️ Approved — resuming task...</div>`;
        }
      }
    }

    // Prompt 80: Keep notifications tab in sync
    renderNotificationsTab();

    // Switch to live view so user sees the resumed loop
    const liveViewBtn = document.querySelector('[data-tab="live-view-tab"]');
    if (liveViewBtn) liveViewBtn.click();
  }
};

window.stopIntervention = async function (id) {
  const item = pendingInterventions.find((i) => i.id === id);
  if (item) {
    item.status = 'stopped';
    browser.runtime.sendMessage({ type: 'STOP_INTERVENTION', id }).catch(() => {});

    // Prompt 80: Immediately update the feed card in-place
    const feedContainer = document.getElementById('activity-feed-container');
    if (feedContainer) {
      const card = feedContainer.querySelector(`[data-step-id*="${id}"], .feed-card.paused`);
      if (card) {
        card.classList.remove('paused');
        card.classList.add('stopped');
        const inlineActions = card.querySelector('.feed-inline-actions');
        if (inlineActions) {
          inlineActions.innerHTML = `<div style="font-size:0.75rem;color:#f87171;padding:4px 0;">🛑 Stopped by user — task halted.</div>`;
        }
      }
    }

    // Prompt 80: Keep notifications tab in sync
    renderNotificationsTab();
    updateBadgeState('ready', 'Stopped');
  }
};

// Prompt 81: User sends a correction instruction on a paused step
window.sendUserCorrection = async function (interventionId, correctionText) {
  // Mark local intervention as 'user-corrected' so notifications tab reflects it
  const item = pendingInterventions.find((i) => i.id === interventionId);
  if (item) item.status = 'user-corrected';

  try {
    await browser.runtime.sendMessage({
      type: 'USER_CORRECTION',
      interventionId,
      correctionText,
    });
  } catch (err) {
    console.error('[Popup] Failed to send USER_CORRECTION:', err);
  }

  // Switch to live view so the user sees the redirected loop
  const liveViewBtn = document.querySelector('[data-tab="live-view-tab"]');
  if (liveViewBtn) liveViewBtn.click();

  renderNotificationsTab();
};

// =========================================================================
// PROFILE TAB (Prompt 82) — Local Identity Store, Never Leaves the Device
// =========================================================================

const PROFILE_FIELD_MAP = {
  fullName:    'pf-fullName',
  email:       'pf-email',
  phone:       'pf-phone',
  aadhaar:     'pf-aadhaar',
  pan:         'pf-pan',
  passport:    'pf-passport',
  address:     'pf-address',
  pinCode:     'pf-pinCode',
  dateOfBirth: 'pf-dateOfBirth',
  bankAccount: 'pf-bankAccount',
};

async function renderProfileTab() {
  // Load current saved values and populate the form fields
  try {
    const res = await browser.storage.local.get(['localProfile']);
    const profile = res.localProfile || {};
    for (const [key, inputId] of Object.entries(PROFILE_FIELD_MAP)) {
      const el = document.getElementById(inputId);
      if (el && profile[key] != null) el.value = profile[key];
    }
  } catch (e) {
    console.warn('[ProfileTab] Failed to load profile:', e);
  }
}

function wireProfileTab() {
  const form = document.getElementById('profile-form');
  const saveMsg = document.getElementById('profile-save-msg');
  const clearBtn = document.getElementById('profile-clear-btn');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const partial = {};
    for (const [key, inputId] of Object.entries(PROFILE_FIELD_MAP)) {
      const el = document.getElementById(inputId);
      if (el && el.value.trim()) partial[key] = el.value.trim();
    }
    try {
      // Save via the API exposed by local-profile.js (already loaded as a script)
      if (typeof saveProfile === 'function') {
        await saveProfile(partial);
      } else {
        // Fallback: write directly to storage
        const existing = (await browser.storage.local.get(['localProfile'])).localProfile || {};
        await browser.storage.local.set({ localProfile: { ...existing, ...partial } });
      }
      if (saveMsg) {
        saveMsg.textContent = '✅ Profile saved locally.';
        saveMsg.style.display = 'block';
        setTimeout(() => { saveMsg.style.display = 'none'; }, 2500);
      }
    } catch (err) {
      if (saveMsg) {
        saveMsg.textContent = '❌ Save failed: ' + err.message;
        saveMsg.style.color = '#ef4444';
        saveMsg.style.display = 'block';
      }
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Clear all saved profile data?')) return;
      await browser.storage.local.remove(['localProfile']);
      for (const inputId of Object.values(PROFILE_FIELD_MAP)) {
        const el = document.getElementById(inputId);
        if (el) el.value = '';
      }
      if (saveMsg) {
        saveMsg.textContent = '🗑 Profile cleared.';
        saveMsg.style.color = '#94a3b8';
        saveMsg.style.display = 'block';
        setTimeout(() => { saveMsg.style.display = 'none'; }, 2000);
      }
    });
  }
}

// =========================================================================
// POLICY TAB SETTINGS UI WIRING
// =========================================================================

async function renderPolicyTab() {
  const rulesTbody = document.getElementById('policy-rules-tbody');
  const chipsContainer = document.getElementById('override-chips-container');
  const perfSelect = document.getElementById('perf-mode-select');
  const activeHostnameEl = document.getElementById('policy-active-hostname');
  const overrideBadgeEl = document.getElementById('policy-override-badge');

  if (!rulesTbody) return;

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTabUrl = tabs && tabs[0] ? tabs[0].url : 'global';
  const effectivePolicy = await getEffectivePolicy(currentTabUrl);

  if (activeHostnameEl) activeHostnameEl.textContent = effectivePolicy.hostname;
  if (overrideBadgeEl) {
    overrideBadgeEl.style.display = effectivePolicy.hasOverride ? 'inline-block' : 'none';
  }

  const policy = await getPolicy();
  if (perfSelect) perfSelect.value = policy.performanceMode || 'balanced';

  const categoryLabels = {
    aadhaar: 'Aadhaar Number',
    phone: 'Phone Number',
    address: 'Address Text',
    email: 'Email Address',
    pan: 'PAN Card Number',
    possibleIdNumber: 'Possible ID (9+ Digits)',
    faces: 'User Face Biometrics'
  };

  rulesTbody.innerHTML = Object.keys(categoryLabels).map((key) => {
    const rule = policy.rules[key] || { enabled: true, method: key === 'faces' ? 'blur' : 'blackfill' };
    const label = categoryLabels[key];
    const isChecked = rule.enabled ? 'checked' : '';
    const methodSelect = key === 'faces'
      ? `<span style="font-size:0.75rem; color:#94a3b8;">Blur (Pixelation)</span>`
      : `<select class="policy-method-select" data-key="${key}" style="padding: 2px 4px; background:#0f172a; color:#f8fafc; border:1px solid #334155; border-radius:4px; font-size:0.75rem;">
           <option value="blackfill" ${rule.method === 'blackfill' ? 'selected' : ''}>Solid Blackfill</option>
           <option value="blur" ${rule.method === 'blur' ? 'selected' : ''}>Irreversible Blur</option>
         </select>`;

    return `
      <tr style="border-bottom: 1px solid #334155;">
        <td style="padding: 6px 0; color:#f8fafc;"><b>${label}</b></td>
        <td style="text-align: center;">
          <input type="checkbox" class="policy-enable-toggle" data-key="${key}" ${isChecked}>
        </td>
        <td>${methodSelect}</td>
      </tr>
    `;
  }).join('');

  const overrides = policy.siteOverrides || {};
  const overrideKeys = Object.keys(overrides);

  if (chipsContainer) {
    if (overrideKeys.length === 0) {
      chipsContainer.innerHTML = `<span style="font-size:0.75rem; color:#64748b;">No site-specific overrides added yet.</span>`;
    } else {
      chipsContainer.innerHTML = overrideKeys.map((host) => `
        <span style="font-size:0.75rem; background:#334155; color:#38bdf8; padding:3px 8px; border-radius:12px; display:inline-flex; align-items:center; gap:6px;">
          ${host}
          <button class="remove-chip-btn" data-host="${host}" style="background:transparent; border:none; color:#f87171; cursor:pointer; font-weight:bold; padding:0;">✕</button>
        </span>
      `).join('');
    }
  }

  // Bind Rule Toggles
  document.querySelectorAll('.policy-enable-toggle').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const key = e.target.getAttribute('data-key');
      const current = await getPolicy();
      current.rules[key].enabled = e.target.checked;
      await savePolicy(current);
      renderPolicyTab();
    });
  });

  // Bind Method Selects
  document.querySelectorAll('.policy-method-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const key = e.target.getAttribute('data-key');
      const current = await getPolicy();
      current.rules[key].method = e.target.value;
      await savePolicy(current);
      renderPolicyTab();
    });
  });

  // Bind Performance Mode Selector
  if (perfSelect) {
    perfSelect.addEventListener('change', async (e) => {
      const current = await getPolicy();
      current.performanceMode = e.target.value;
      await savePolicy(current);
    });
  }

  // Bind Add Override Button
  const addBtn = document.getElementById('add-override-btn');
  const hostInput = document.getElementById('override-hostname-input');
  if (addBtn && hostInput) {
    addBtn.onclick = async () => {
      const hostVal = hostInput.value.trim().toLowerCase();
      if (!hostVal) return;
      const current = await getPolicy();
      current.siteOverrides[hostVal] = {
        address: { enabled: false, method: 'blackfill' }
      };
      await savePolicy(current);
      hostInput.value = '';
      renderPolicyTab();
    };
  }

  // Bind Remove Override Chips
  document.querySelectorAll('.remove-chip-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const host = e.target.getAttribute('data-host');
      const current = await getPolicy();
      if (current.siteOverrides && current.siteOverrides[host]) {
        delete current.siteOverrides[host];
        await savePolicy(current);
        renderPolicyTab();
      }
    });
  });
}
