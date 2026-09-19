let selectedPerformanceMode = 'balanced';

// Segmented Control Event Handler
document.addEventListener('DOMContentLoaded', async () => {
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

  const compareBtn = document.getElementById('compare-modes-btn');
  if (compareBtn) {
    compareBtn.addEventListener('click', runModeComparison);
  }
});

// Run Mode Comparison Handler (Runs same screenshot through Fast, Balanced, Accurate sequentially)
async function runModeComparison() {
  const compareBtn = document.getElementById('compare-modes-btn');
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

    // Save active mode to restore after comparison
    const originalMode = selectedPerformanceMode;

    // Run Fast Mode
    const policyFast = await getPolicy();
    policyFast.performanceMode = 'fast';
    await savePolicy(policyFast);
    const fastRes = await processScreenshot(captureRes.dataUrl, domStructure, currentTabUrl);

    // Run Balanced Mode
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

    // Determine fastest mode latency and max detections
    const minLatency = Math.min(...modesData.map(m => m.data.timing.total));
    const maxDetections = Math.max(...modesData.map(m => m.data.counts.detected));

    // Render 3-Column Comparison View
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

// Main Agent Loop Execution
document.getElementById('run-agent-btn').addEventListener('click', async () => {
  startAgentLoop();
});

async function startAgentLoop(resumeAction = null) {
  const runBtn = document.getElementById('run-agent-btn');
  const debugPanel = document.getElementById('debug-panel');
  const statusList = document.getElementById('status-list');

  const goalInput = document.getElementById('goal-input');
  const goalError = document.getElementById('goal-error');
  const goal = goalInput ? goalInput.value.trim() : '';

  if (!goal) {
    if (goalError) goalError.style.display = 'block';
    return;
  } else {
    if (goalError) goalError.style.display = 'none';
  }

  const isRedactionEnabled = redactionToggle.checked;

  runBtn.disabled = true;
  updateBadgeState('running', 'Running Loop...');
  debugPanel.innerHTML = '';
  statusList.innerHTML = '';

  const addStatus = (msg) => {
    const p = document.createElement('div');
    p.textContent = msg;
    statusList.appendChild(p);
  };

  const MAX_ITERATIONS = 15;
  let iterationCount = 0;
  let consecutiveFailures = 0;
  let lastSelector = null;
  const actionsTaken = [];
  let finalOutcome = 'completed';
  let totalPiiCount = 0;
  let totalFaceCount = 0;
  let currentTabUrl = 'Unknown Site';

  startTime = performance.now();

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) currentTabUrl = tabs[0].url || 'Unknown Site';

    // If resuming approved intervention action
    if (resumeAction) {
      addStatus(`▶️ Resuming approved action: [${resumeAction.action}] on "${resumeAction.selector}"`);
      const execRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'EXECUTE_ACTION', action: resumeAction });
      if (!execRes || !execRes.success) {
        throw new Error(execRes ? execRes.error : 'Execution failed upon resumption.');
      }
      actionsTaken.push(`[Approved & Executed] ${resumeAction.action} on ${resumeAction.selector}`);
    }

    while (iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      addStatus(`\n🔄 --- Agent Loop Iteration ${iterationCount}/${MAX_ITERATIONS} ---`);

      // Stage 1: Capture Screen
      addStatus('⏳ Capturing tab screenshot...');
      const captureRes = await browser.runtime.sendMessage({ type: 'CAPTURE_SCREEN' });

      if (!captureRes || !captureRes.success) {
        const errMsg = captureRes ? captureRes.error : 'Failed to capture tab screenshot.';
        if (errMsg.includes('security reasons') || errMsg.includes('cannot be captured')) {
          throw new Error('🔒 Restricted Page: This page type (e.g., settings, internal extension, or webstore) cannot be captured for security reasons.');
        }
        throw new Error(errMsg);
      }

      // Stage 2: Extract DOM Structure
      addStatus('⏳ Fetching page DOM structure...');
      let domStructure = [];
      try {
        const domRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM_STRUCTURE' });
        domStructure = (domRes && domRes.success) ? domRes.domStructure : [];
      } catch (connErr) {
        addStatus('⚠️ Content script not ready on page. Attempting auto-injection...');
        try {
          await browser.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['extension/browser-polyfill.js', 'extension/action-executor.js', 'content.js']
          });
          const retryDomRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM_STRUCTURE' });
          domStructure = (retryDomRes && retryDomRes.success) ? retryDomRes.domStructure : [];
        } catch (injectErr) {
          throw new Error('Please refresh the webpage tab once to connect Betaal to this page.');
        }
      }

      // Stage 3: Process Privacy Pipeline (Dual OCR + DOM Field Inspection + Effective Policy)
      addStatus('⏳ Running local vision redaction pipeline...');
      const pipelineRes = await processScreenshot(captureRes.dataUrl, domStructure, currentTabUrl);
      totalPiiCount = Math.max(totalPiiCount, pipelineRes.counts.piiFields);
      totalFaceCount = Math.max(totalFaceCount, pipelineRes.counts.faces);
      const payloadImage = isRedactionEnabled ? pipelineRes.redactedImage : pipelineRes.originalImage;

      // Render Live Timing & Policy Counts Breakdown Telemetry
      const tEl = document.getElementById('live-timer');
      if (tEl) {
        tEl.innerHTML = `⏱️ <b>Timing Breakdown (${(pipelineRes.performanceMode || 'balanced').toUpperCase()} Mode):</b><br>` +
          `Classify: ${pipelineRes.timing.classification}ms | ` +
          `PII Detection: ${pipelineRes.timing.piiDetection}ms | Face Detection: ${pipelineRes.timing.faceDetection}ms | ` +
          `Redaction: ${pipelineRes.timing.redaction}ms<br>` +
          `📊 <b>Policy Tally:</b> ${pipelineRes.counts.detected} detected, ${pipelineRes.counts.redacted} redacted, ${pipelineRes.counts.skipped} skipped by policy`;
      }

      // Render Side-by-Side Thumbnails (Original vs Redacted View)
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

      // Wire Click-to-Zoom Modal
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

      // Stage 4: Call Backend VLM
      addStatus('⏳ Querying Backend VLM server...');
      let actionResponse = await sendToBackend(payloadImage, goal, domStructure);

      // Check Human Intervention Rules
      const interventionCheck = needsHumanIntervention(actionResponse, {
        consecutiveFailures,
        actionHistory: actionsTaken,
        domStructure
      });

      if (interventionCheck.needed) {
        addStatus(`⚠️ Intervention Triggered: ${interventionCheck.reason}`);
        updateBadgeState('error', 'Paused for Approval');

        // Notify Background & Add Pending Notification
        await browser.runtime.sendMessage({
          type: 'SHOW_INTERVENTION_NOTIFICATION',
          reason: interventionCheck.reason
        });

        pendingInterventions.unshift({
          id: 'notif_' + Date.now(),
          reason: interventionCheck.reason,
          siteUrl: currentTabUrl,
          action: actionResponse,
          status: 'pending'
        });

        pausedLoopState = { action: actionResponse, goal };
        renderNotificationsTab();
        finalOutcome = 'paused';

        // Log to Vault as paused
        await saveToVault({
          timestamp: new Date().toISOString(),
          siteUrl: currentTabUrl,
          piiCount: totalPiiCount,
          faceCount: totalFaceCount,
          detectedCount: pipelineRes.counts.detected,
          redactedCount: pipelineRes.counts.redacted,
          skippedCount: pipelineRes.counts.skipped,
          performanceMode: pipelineRes.performanceMode,
          policySnapshot: pipelineRes.policySnapshot,
          actionsTaken,
          outcome: 'paused'
        });
        renderVaultTab();

        return; // Pause execution loop for user intervention
      }

      // Stage 5: Execute Action with Selector Fallback & Retry (Up to 2 Retries)
      let retryAttempts = 0;
      let actionExecuted = false;

      while (retryAttempts <= 2 && !actionExecuted) {
        addStatus(`⏳ Executing action [${actionResponse.action}] on selector "${actionResponse.selector}"...`);
        const execRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'EXECUTE_ACTION', action: actionResponse });

        if (execRes && execRes.success) {
          actionExecuted = true;
          consecutiveFailures = 0;
          lastSelector = actionResponse.selector;
          actionsTaken.push(`${actionResponse.action} on ${actionResponse.selector}`);
          addStatus(`✅ Action successfully executed.`);
        } else if (execRes && execRes.selectorNotFound && retryAttempts < 2) {
          retryAttempts++;
          consecutiveFailures++;
          addStatus(`⚠️ Selector "${actionResponse.selector}" not found. Re-prompting VLM backend (Retry ${retryAttempts}/2)...`);
          
          const correctionGoal = `${goal}\n\nThe selector [${actionResponse.selector}] does not exist on this page. Here is the exact list of available elements:\n${JSON.stringify(domStructure)}\nChoose a selector ONLY from this list.`;
          actionResponse = await sendToBackend(payloadImage, correctionGoal, domStructure);
        } else {
          // Exceeded retries or unhandled execution failure
          throw new Error("I couldn't find the right element on this page, please complete this step manually.");
        }
      }

      // Check if action was marked final by VLM
      if (actionResponse.final) {
        addStatus('🎉 Task marked as complete by VLM!');
        break;
      }
    }

    if (iterationCount >= MAX_ITERATIONS) {
      addStatus(`⚠️ Safety Cap Reached: Maximum of ${MAX_ITERATIONS} iterations reached.`);
      finalOutcome = 'stopped';
    }

    updateBadgeState('ready', 'Completed');
    addStatus('🎉 Agent loop finished successfully.');

    // Save final entry to Vault
    await saveToVault({
      timestamp: new Date().toISOString(),
      siteUrl: currentTabUrl,
      piiCount: totalPiiCount,
      faceCount: totalFaceCount,
      detectedCount: pipelineRes ? pipelineRes.counts.detected : totalPiiCount + totalFaceCount,
      redactedCount: pipelineRes ? pipelineRes.counts.redacted : totalPiiCount + totalFaceCount,
      skippedCount: pipelineRes ? pipelineRes.counts.skipped : 0,
      performanceMode: pipelineRes ? pipelineRes.performanceMode : 'balanced',
      policySnapshot: pipelineRes ? pipelineRes.policySnapshot : {},
      actionsTaken,
      outcome: finalOutcome
    });
    renderVaultTab();

  } catch (err) {
    console.error('[Agent Loop Error]:', err);
    updateBadgeState('error', 'Error');
    const errDiv = document.createElement('div');
    errDiv.id = 'error-message';
    errDiv.textContent = `❌ Execution Stopped: ${err.message}`;
    debugPanel.appendChild(errDiv);
  } finally {
    runBtn.disabled = false;
  }
}

// Tab Switching Handler
document.addEventListener('DOMContentLoaded', async () => {
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
    });
  });

  renderVaultTab();
  renderNotificationsTab();
  renderPolicyTab();
});

// Vault Tab Rendering with Policy Snapshot Expander
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
    const actionsSummary = entry.actionsTaken.length > 0 ? entry.actionsTaken.join(' ➔ ') : 'No actions';
    const badgeColor = entry.outcome === 'completed' ? '#4ade80' : (entry.outcome === 'paused' ? '#38bdf8' : '#f87171');
    const perfMode = (entry.performanceMode || 'balanced').toUpperCase();

    // Render snapshot rules summary safely (no raw PII)
    const snapshotRules = entry.policySnapshot || {};
    const rulesList = Object.entries(snapshotRules).map(([rule, cfg]) => {
      const state = cfg.enabled ? `<span style="color:#4ade80;">ON (${cfg.method || 'blackfill'})</span>` : `<span style="color:#f87171;">OFF (Skipped)</span>`;
      return `${rule}: ${state}`;
    }).join(' | ') || 'Default Policy';

    return `
      <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: #f8fafc; font-size: 0.82rem;">${entry.siteUrl}</span>
          <span style="font-size: 0.7rem; color: ${badgeColor}; font-weight: bold; text-transform: uppercase;">${entry.outcome}</span>
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 4px;">
          ${timeStr} | Mode: <b style="color:#38bdf8;">${perfMode}</b> | Redacted: ${entry.redactedCount || entry.piiCount || 0} | Skipped: ${entry.skippedCount || 0}
        </div>
        <div style="font-size: 0.75rem; color: #cbd5e1; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          Actions: ${actionsSummary}
        </div>
        
        <!-- Expandable Policy Used Section -->
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

// Notifications Tab Rendering
function renderNotificationsTab() {
  const pendingContainer = document.getElementById('pending-notifications-list');
  const resolvedContainer = document.getElementById('resolved-notifications-list');
  if (!pendingContainer || !resolvedContainer) return;

  const pendingItems = pendingInterventions.filter((item) => item.status === 'pending');
  const resolvedItems = pendingInterventions.filter((item) => item.status !== 'pending');

  // Update badge count in background
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

    // Attach event listeners safely without relying on inline onclick (CSP safe)
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

// Global Intervention Decision Functions
window.approveIntervention = async function (id) {
  const item = pendingInterventions.find((i) => i.id === id);
  if (item) {
    item.status = 'approved';
    
    // Clear badge count since pending is resolved
    browser.runtime.sendMessage({ type: 'UPDATE_BADGE_COUNT', count: 0 }).catch(() => {});
    
    // Switch UI back to Live View tab so status is visible
    const liveViewBtn = document.querySelector('[data-tab="live-view-tab"]');
    if (liveViewBtn) liveViewBtn.click();
    
    renderNotificationsTab();
    
    const targetAction = item.action || (pausedLoopState ? pausedLoopState.action : null);
    if (targetAction) {
      startAgentLoop(targetAction);
    }
  }
};

window.stopIntervention = async function (id) {
  const item = pendingInterventions.find((i) => i.id === id);
  if (item) {
    item.status = 'stopped';

    // Clear badge count
    browser.runtime.sendMessage({ type: 'UPDATE_BADGE_COUNT', count: 0 }).catch(() => {});
    renderNotificationsTab();

    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTabUrl = tabs && tabs[0] ? tabs[0].url : 'Unknown Site';

    await saveToVault({
      timestamp: new Date().toISOString(),
      siteUrl: currentTabUrl,
      piiCount: 0,
      faceCount: 0,
      actionsTaken: ['Stopped by user intervention'],
      outcome: 'stopped'
    });
    renderVaultTab();
    updateBadgeState('ready', 'Stopped');
  }
};

// Policy Tab Settings UI Wiring
async function renderPolicyTab() {
  const rulesTbody = document.getElementById('policy-rules-tbody');
  const chipsContainer = document.getElementById('override-chips-container');
  const perfSelect = document.getElementById('perf-mode-select');
  const activeHostnameEl = document.getElementById('policy-active-hostname');
  const overrideBadgeEl = document.getElementById('policy-override-badge');

  if (!rulesTbody) return;

  // Active Site Banner
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTabUrl = tabs && tabs[0] ? tabs[0].url : 'global';
  const effectivePolicy = await getEffectivePolicy(currentTabUrl);

  if (activeHostnameEl) activeHostnameEl.textContent = effectivePolicy.hostname;
  if (overrideBadgeEl) {
    overrideBadgeEl.style.display = effectivePolicy.hasOverride ? 'inline-block' : 'none';
  }

  // Load Policy Configuration
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

  // Render Rules Table
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

  // Render Site Override Chips
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
