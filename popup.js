/* popup.js */

let timerInterval = null;
let startTime = 0;
let pendingInterventions = [];
let pausedLoopState = null; // Stores state when agent loop pauses for human intervention

// Tab Switching Handler
document.addEventListener('DOMContentLoaded', () => {
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
    });
  });

  renderVaultTab();
  renderNotificationsTab();
});

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

if (redactionToggle) {
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

      // Stage 2: Process Privacy Pipeline
      addStatus('⏳ Running local vision redaction pipeline...');
      const pipelineRes = await processScreenshot(captureRes.dataUrl);
      totalPiiCount = Math.max(totalPiiCount, pipelineRes.counts.piiFields);
      totalFaceCount = Math.max(totalFaceCount, pipelineRes.counts.faces);
      const payloadImage = isRedactionEnabled ? pipelineRes.redactedImage : pipelineRes.originalImage;

      // Stage 3: Extract DOM
      addStatus('⏳ Fetching page DOM structure...');
      const domRes = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_DOM_STRUCTURE' });
      const domStructure = (domRes && domRes.success) ? domRes.domStructure : [];

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

// Vault Tab Rendering
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

    return `
      <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: #f8fafc; font-size: 0.82rem;">${entry.siteUrl}</span>
          <span style="font-size: 0.7rem; color: ${badgeColor}; font-weight: bold; text-transform: uppercase;">${entry.outcome}</span>
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-bottom: 6px;">${timeStr} | PII Redacted: ${entry.piiCount} | Faces: ${entry.faceCount}</div>
        <div style="font-size: 0.75rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Actions: ${actionsSummary}</div>
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
    resolvedContainer.innerHTML = resolvedItems.map((item) => `
      <div style="padding: 6px 0; border-bottom: 1px solid #334155;">
        <div style="font-size: 0.75rem; color: #cbd5e1;">Decision: <b style="color: ${item.status === 'approved' ? '#4ade80' : '#f87171'}">${item.status.toUpperCase()}</b></div>
        <div style="font-size: 0.7rem; color: #94a3b8;">${item.reason}</div>
      </div>
    `).join('');
  }
}

// Global Intervention Decision Functions
window.approveIntervention = async function (id) {
  const item = pendingInterventions.find((i) => i.id === id);
  if (item) {
    item.status = 'approved';
    
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
