importScripts('extension/browser-polyfill.js');

console.log('Betaal background loaded');

function isRestrictedUrl(url) {
  if (!url) return false;
  const restrictedPatterns = [
    /^chrome:\/\//i,
    /^chrome-extension:\/\//i,
    /^about:/i,
    /^https?:\/\/chromewebstore\.google\.com/i,
    /^https?:\/\/chrome\.google\.com\/webstore/i,
    /^edge:\/\//i,
    /^moz-extension:\/\//i
  ];
  return restrictedPatterns.some(pattern => pattern.test(url));
}

let pendingInterventionsCount = 0;

function setPendingBadgeCount(count) {
  pendingInterventionsCount = count;
  const chromeApi = typeof chrome !== 'undefined' ? chrome : {};
  const actionApi = chromeApi.action || chromeApi.browserAction;
  if (actionApi) {
    if (count > 0) {
      actionApi.setBadgeText({ text: String(count) });
      actionApi.setBadgeBackgroundColor({ color: '#ef4444' });
    } else {
      actionApi.setBadgeText({ text: '' });
    }
  }
}

function showInterventionNotification(reason) {
  setPendingBadgeCount(pendingInterventionsCount + 1);

  const chromeApi = typeof chrome !== 'undefined' ? chrome : {};
  if (chromeApi.notifications) {
    chromeApi.notifications.create('betaal_intervention_' + Date.now(), {
      type: 'basic',
      iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSU5EUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      title: 'Betaal needs your input',
      message: reason || 'Human approval required before proceeding.',
      priority: 2
    });
  }
}

// Notification click listener
const chromeApi = typeof chrome !== 'undefined' ? chrome : {};
if (chromeApi.notifications && chromeApi.notifications.onClicked) {
  chromeApi.notifications.onClicked.addListener((notificationId) => {
    if (chromeApi.action && chromeApi.action.openPopup) {
      chromeApi.action.openPopup().catch(() => {});
    }
  });
}

// =========================================================================
// AGENT LOOP STATE & RUNNING-STATE LOCK (Prompts 69, 70, 71)
// =========================================================================

let agentLoopState = {
  isLocked: false,            // Prompt 70: Running-state lock
  status: 'ready',            // 'ready' | 'running' | 'paused' | 'error' | 'stopped' | 'busy'
  statusText: 'Ready',
  goal: '',
  redactionEnabled: true,
  iterationCount: 0,
  maxIterations: 15,
  actionsTaken: [],
  consecutiveFailures: 0,
  lastSelector: null,
  logs: [],
  pendingInterventions: [],
  pausedAction: null,
  activeTabId: null,
  activeTabUrl: 'Unknown Site',
  lastPipelineResult: null,
  domStabilityMs: 0
};

/**
 * Broadcasts loop state updates to any open popup views.
 */
function broadcastLoopState() {
  try {
    browser.runtime.sendMessage({
      type: 'LOOP_STATE_UPDATE',
      state: agentLoopState
    }).catch(() => {
      // Expected error if popup is closed
    });
  } catch (e) {}
}

function addLoopLog(msg) {
  agentLoopState.logs.push(msg);
  broadcastLoopState();
}

function updateLoopStatus(status, statusText) {
  agentLoopState.status = status;
  agentLoopState.statusText = statusText;
  broadcastLoopState();
}

// =========================================================================
// NAVIGATION LISTENER & CONTENT SCRIPT LIVENESS (Prompt 69)
// =========================================================================

let navigationWaiters = {};

if (chromeApi.webNavigation && chromeApi.webNavigation.onCompleted) {
  chromeApi.webNavigation.onCompleted.addListener((details) => {
    // Top-level frame navigation only
    if (details.frameId === 0 && navigationWaiters[details.tabId]) {
      console.log(`[Background] Full navigation detected on tab ${details.tabId} to ${details.url}`);
      const resolver = navigationWaiters[details.tabId];
      delete navigationWaiters[details.tabId];
      resolver(details.url);
    }
  });
}

/**
 * Waits for a full page navigation to complete on the target tab if one is occurring.
 * Returns true if navigation occurred and was completed, false if timed out.
 */
function waitForNavigation(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let timeoutTimer = null;
    navigationWaiters[tabId] = (newUrl) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve({ navigated: true, newUrl });
    };

    timeoutTimer = setTimeout(() => {
      delete navigationWaiters[tabId];
      resolve({ navigated: false });
    }, timeoutMs);
  });
}

/**
 * Sends a lightweight PING message to verify content script responsiveness (Prompt 69).
 * Expects { success: true, pong: true } back within 3 seconds.
 */
async function verifyContentScriptLiveness(tabId, timeoutMs = 3000) {
  const pingPromise = new Promise(async (resolve, reject) => {
    try {
      const res = await browser.tabs.sendMessage(tabId, { type: 'PING' });
      if (res && res.pong) {
        resolve(true);
      } else {
        resolve(false);
      }
    } catch (err) {
      resolve(false);
    }
  });

  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const isAlive = await Promise.race([pingPromise, timeoutPromise]);

  if (!isAlive) {
    // Attempt auto-injection fallback once
    try {
      console.log('[Background] Content script unpinned/unresponsive, attempting re-injection...');
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['extension/browser-polyfill.js', 'extension/action-executor.js', 'content.js']
      });
      // Re-test PING
      const retryRes = await browser.tabs.sendMessage(tabId, { type: 'PING' });
      return !!(retryRes && retryRes.pong);
    } catch (injectErr) {
      console.warn('[Background] Injection failed:', injectErr);
      return false;
    }
  }

  return true;
}

// =========================================================================
// BACKGROUND MESSAGE DISPATCHER (Prompts 68-72)
// =========================================================================

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    // Prompt 70 & 71: Get canonical background loop state
    if (message.type === 'GET_LOOP_STATE') {
      return { success: true, state: agentLoopState };
    }

    // Prompt 70 & 71: Start / Trigger loop from popup
    if (message.type === 'START_LOOP') {
      if (agentLoopState.isLocked) {
        console.warn('[Background Loop] Trigger ignored: Agent loop is already running (isLocked = true).');
        return { success: false, error: 'Agent is already busy running a task.', isLocked: true };
      }
      // Start in background without blocking response
      runBackgroundAgentLoop(message.goal, message.redactionEnabled, message.resumeAction);
      return { success: true, started: true };
    }

    // Prompt 71: Approve intervention
    if (message.type === 'APPROVE_INTERVENTION') {
      const id = message.id;
      const item = agentLoopState.pendingInterventions.find((i) => i.id === id);
      if (item) {
        item.status = 'approved';
        setPendingBadgeCount(0);
        broadcastLoopState();
        const actionToResume = item.action || agentLoopState.pausedAction;
        runBackgroundAgentLoop(agentLoopState.goal, agentLoopState.redactionEnabled, actionToResume);
      }
      return { success: true };
    }

    // Prompt 71: Stop intervention
    if (message.type === 'STOP_INTERVENTION') {
      const id = message.id;
      const item = agentLoopState.pendingInterventions.find((i) => i.id === id);
      if (item) {
        item.status = 'stopped';
        setPendingBadgeCount(0);
        agentLoopState.status = 'stopped';
        agentLoopState.statusText = 'Stopped';
        agentLoopState.isLocked = false;
        broadcastLoopState();
      }
      return { success: true };
    }

    // Prompt 71: Update pipeline result from popup runner
    if (message.type === 'STEP_PIPELINE_DONE') {
      agentLoopState.lastPipelineResult = message.pipelineRes;
      broadcastLoopState();
      return { success: true };
    }

    // Prompt 71: Set loop status directly
    if (message.type === 'SET_LOOP_STATE') {
      if (message.state) {
        Object.assign(agentLoopState, message.state);
        broadcastLoopState();
      }
      return { success: true };
    }

    if (message.type === 'SHOW_INTERVENTION_NOTIFICATION') {
      showInterventionNotification(message.reason);
      return { success: true, count: pendingInterventionsCount };
    }

    if (message.type === 'UPDATE_BADGE_COUNT') {
      setPendingBadgeCount(message.count || 0);
      return { success: true };
    }

    if (message.type === 'CAPTURE_SCREEN') {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];

      if (activeTab && isRestrictedUrl(activeTab.url)) {
        return { success: false, error: 'This page type cannot be captured for security reasons.' };
      }

      try {
        const dataUrl = await browser.tabs.captureVisibleTab(null, { format: 'png' });
        return { success: true, dataUrl: dataUrl };
      } catch (capErr) {
        if (activeTab && isRestrictedUrl(activeTab.url)) {
          return { success: false, error: 'This page type cannot be captured for security reasons.' };
        }
        return { success: false, error: capErr.message || 'Failed to capture screenshot.' };
      }
    }
  } catch (err) {
    console.error('[Background Message Error]:', err);
    return { success: false, error: err.message };
  }
});

// =========================================================================
// AGENTIC EXECUTION LOOP IN BACKGROUND SCRIPT (Prompt 71)
// =========================================================================

async function runBackgroundAgentLoop(goal, redactionEnabled = true, resumeAction = null) {
  // Prompt 70: Running-state lock check
  if (agentLoopState.isLocked) {
    console.warn('[Background] Blocked overlapping loop start attempt.');
    return;
  }

  // Acquire Lock
  agentLoopState.isLocked = true;
  agentLoopState.status = 'running';
  agentLoopState.statusText = 'Running Loop...';
  agentLoopState.goal = goal;
  agentLoopState.redactionEnabled = redactionEnabled;

  if (!resumeAction) {
    agentLoopState.iterationCount = 0;
    agentLoopState.consecutiveFailures = 0;
    agentLoopState.lastSelector = null;
    agentLoopState.actionsTaken = [];
    agentLoopState.logs = [];
    agentLoopState.pausedAction = null;
  }

  broadcastLoopState();

  const BACKEND_URL = 'http://localhost:3000';

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0]) {
      throw new Error('No active browser tab found.');
    }

    let activeTab = tabs[0];
    agentLoopState.activeTabId = activeTab.id;
    agentLoopState.activeTabUrl = activeTab.url || 'Unknown Site';

    // If resuming an approved intervention action
    if (resumeAction) {
      addLoopLog(`▶️ Resuming approved action: [${resumeAction.action}] on "${resumeAction.selector}"`);
      
      // Execute the approved action on the page
      const execRes = await browser.tabs.sendMessage(activeTab.id, {
        type: 'EXECUTE_ACTION',
        action: resumeAction
      });

      if (!execRes || !execRes.success) {
        throw new Error(execRes ? execRes.error : 'Execution failed upon resumption.');
      }
      agentLoopState.actionsTaken.push(`[Approved & Executed] ${resumeAction.action} on ${resumeAction.selector}`);

      // Prompt 68: Wait for DOM stability after resumed action
      addLoopLog('⏳ Waiting for DOM stability after action execution...');
      try {
        const domWaitRes = await browser.tabs.sendMessage(activeTab.id, {
          type: 'WAIT_FOR_DOM_STABLE',
          timeoutMs: 2000,
          quietMs: 300
        });
        if (domWaitRes && typeof domWaitRes.waitedMs === 'number') {
          agentLoopState.domStabilityMs = domWaitRes.waitedMs;
          addLoopLog(`⏱️ DOM stabilized in ${domWaitRes.waitedMs}ms (timeout=${domWaitRes.timedOut ? 'yes' : 'no'}).`);
        }
      } catch (e) {}

      agentLoopState.pausedAction = null;
    }

    while (agentLoopState.iterationCount < agentLoopState.maxIterations) {
      agentLoopState.iterationCount++;
      addLoopLog(`\n🔄 --- Agent Loop Iteration ${agentLoopState.iterationCount}/${agentLoopState.maxIterations} ---`);

      // Prompt 69: Verify content script liveness before capture
      const isContentAlive = await verifyContentScriptLiveness(activeTab.id, 3000);
      if (!isContentAlive) {
        // Content script didn't respond within 3 seconds
        throw new Error("Content script unresponsive after navigation. Please refresh or verify page.");
      }

      // Stage 1: Capture Screen
      addLoopLog('⏳ Capturing tab screenshot...');
      if (isRestrictedUrl(activeTab.url)) {
        throw new Error('🔒 Restricted Page: This page type cannot be captured for security reasons.');
      }

      let dataUrl = null;
      try {
        dataUrl = await browser.tabs.captureVisibleTab(null, { format: 'png' });
      } catch (capErr) {
        throw new Error('Failed to capture tab screenshot: ' + capErr.message);
      }

      // Stage 2: Extract DOM Structure
      addLoopLog('⏳ Fetching page DOM structure...');
      let domStructure = [];
      try {
        const domRes = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_DOM_STRUCTURE' });
        domStructure = (domRes && domRes.success) ? domRes.domStructure : [];
      } catch (domErr) {
        addLoopLog('⚠️ Content script not ready on page. Attempting auto-injection...');
        await browser.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['extension/browser-polyfill.js', 'extension/action-executor.js', 'content.js']
        });
        const retryDom = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_DOM_STRUCTURE' });
        domStructure = (retryDom && retryDom.success) ? retryDom.domStructure : [];
      }

      // Stage 3: Send Redacted Context to Backend VLM
      // Note: If popup is open, popup runs full local canvas pipeline and provides cached result
      // In background, send payload to backend
      addLoopLog('⏳ Querying Backend VLM server at ' + BACKEND_URL + '...');

      let payloadImage = dataUrl;
      if (agentLoopState.lastPipelineResult && agentLoopState.lastPipelineResult.redactedImage && agentLoopState.redactionEnabled) {
        payloadImage = agentLoopState.lastPipelineResult.redactedImage;
      }

      const backendResponse = await fetch(`${BACKEND_URL}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: agentLoopState.goal,
          redactedImage: payloadImage,
          domStructure
        })
      });

      if (!backendResponse.ok) {
        let errDetails = `Server HTTP ${backendResponse.status}`;
        try {
          const errData = await backendResponse.json();
          if (errData.error) errDetails = errData.error;
        } catch (e) {}
        throw new Error(`Backend server error: ${errDetails}`);
      }

      let actionResponse = await backendResponse.json();

      // Stage 4: Check Human Intervention Rules
      const interventionCheck = checkIntervention(actionResponse, {
        consecutiveFailures: agentLoopState.consecutiveFailures,
        actionHistory: agentLoopState.actionsTaken,
        domStructure
      });

      if (interventionCheck.needed) {
        addLoopLog(`⚠️ Intervention Triggered: ${interventionCheck.reason}`);
        updateLoopStatus('paused', 'Paused for Approval');

        // Trigger notification
        showInterventionNotification(interventionCheck.reason);

        agentLoopState.pendingInterventions.unshift({
          id: 'notif_' + Date.now(),
          reason: interventionCheck.reason,
          siteUrl: agentLoopState.activeTabUrl,
          action: actionResponse,
          status: 'pending'
        });

        agentLoopState.pausedAction = actionResponse;

        // Save paused record in vault
        await appendVaultEntry({
          timestamp: new Date().toISOString(),
          siteUrl: agentLoopState.activeTabUrl,
          actionsTaken: agentLoopState.actionsTaken,
          outcome: 'paused'
        });

        // Prompt 70: Release lock on intervention pause so user can resume/approve cleanly
        agentLoopState.isLocked = false;
        broadcastLoopState();
        return; // Pause execution loop
      }

      // Stage 5: Execute Action with Selector Fallback & Retry (Up to 2 Retries)
      let retryAttempts = 0;
      let actionExecuted = false;

      while (retryAttempts <= 2 && !actionExecuted) {
        addLoopLog(`⏳ Executing action [${actionResponse.action}] on selector "${actionResponse.selector}"...`);
        
        let execRes = null;
        try {
          execRes = await browser.tabs.sendMessage(activeTab.id, {
            type: 'EXECUTE_ACTION',
            action: actionResponse
          });
        } catch (execErr) {
          // If execution message failed, page may be navigating (Prompt 69)
          console.log('[Background] Action triggered navigation or context shift...');
          execRes = { success: true };
        }

        if (execRes && execRes.success) {
          actionExecuted = true;
          agentLoopState.consecutiveFailures = 0;
          agentLoopState.lastSelector = actionResponse.selector;
          agentLoopState.actionsTaken.push(`${actionResponse.action} on ${actionResponse.selector}`);
          addLoopLog(`✅ Action successfully executed.`);

          // Prompt 68: Wait for DOM stability after action execution before next loop re-capture
          addLoopLog('⏳ Waiting for DOM stability before next capture (quiet window: 300ms)...');
          try {
            const domWaitRes = await browser.tabs.sendMessage(activeTab.id, {
              type: 'WAIT_FOR_DOM_STABLE',
              timeoutMs: 2000,
              quietMs: 300
            });
            if (domWaitRes && typeof domWaitRes.waitedMs === 'number') {
              agentLoopState.domStabilityMs = domWaitRes.waitedMs;
              addLoopLog(`⏱️ DOM stability reached in ${domWaitRes.waitedMs}ms (timeout=${domWaitRes.timedOut ? 'yes' : 'no'}).`);
            }
          } catch (e) {}

        } else if (execRes && execRes.selectorNotFound && retryAttempts < 2) {
          retryAttempts++;
          agentLoopState.consecutiveFailures++;
          addLoopLog(`⚠️ Selector "${actionResponse.selector}" not found. Re-prompting VLM backend (Retry ${retryAttempts}/2)...`);
          
          const correctionGoal = `${agentLoopState.goal}\n\nThe selector [${actionResponse.selector}] does not exist on this page. Available elements:\n${JSON.stringify(domStructure)}\nChoose a selector ONLY from this list.`;
          
          const retryBackend = await fetch(`${BACKEND_URL}/act`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              goal: correctionGoal,
              redactedImage: payloadImage,
              domStructure
            })
          });
          actionResponse = await retryBackend.json();
        } else {
          throw new Error("I couldn't find the right element on this page, please complete this step manually.");
        }
      }

      // Check if action was marked final by VLM
      if (actionResponse.final) {
        addLoopLog('🎉 Task marked as complete by VLM!');
        break;
      }
    }

    let finalOutcome = 'completed';
    if (agentLoopState.iterationCount >= agentLoopState.maxIterations) {
      addLoopLog(`⚠️ Safety Cap Reached: Maximum of ${agentLoopState.maxIterations} iterations reached.`);
      finalOutcome = 'stopped';
    }

    updateLoopStatus('ready', finalOutcome === 'completed' ? 'Completed' : 'Stopped');
    addLoopLog('🎉 Agent loop finished successfully.');

    // Save final entry to Vault
    await appendVaultEntry({
      timestamp: new Date().toISOString(),
      siteUrl: agentLoopState.activeTabUrl,
      actionsTaken: agentLoopState.actionsTaken,
      outcome: finalOutcome
    });

  } catch (err) {
    console.error('[Background Loop Error]:', err);
    updateLoopStatus('error', 'Error');
    addLoopLog(`❌ Execution Stopped: ${err.message}`);

    // If content script was unresponsive or error requires human assistance
    showInterventionNotification(`Error in agent loop: ${err.message}`);
  } finally {
    // Prompt 70: Release running-state lock in ALL exit paths (success, error, or cap reached)
    agentLoopState.isLocked = false;
    broadcastLoopState();
    console.log('[Background Loop] Running-state lock released. Agent Ready.');
  }
}

// In-worker intervention check helper
function checkIntervention(action, context = {}) {
  if (!action) return { needed: false, reason: null };
  const consecutiveFailures = context.consecutiveFailures || 0;
  const domStructure = context.domStructure || [];

  if (action.final === true) {
    return {
      needed: true,
      reason: `Final action detected ("${action.action}" on "${action.selector}"). Human confirmation required before submitting or concluding task.`
    };
  }

  if (consecutiveFailures >= 2) {
    return {
      needed: true,
      reason: `Action failed ${consecutiveFailures} consecutive times on selector "${action.selector}". Manual assistance needed.`
    };
  }

  if (typeof action.confidence === 'number' && action.confidence < 0.6) {
    return {
      needed: true,
      reason: `VLM confidence level is low (${Math.round(action.confidence * 100)}% < 60%). Human approval required.`
    };
  }

  const targetsFileInput = domStructure.some(el => {
    const isTarget = (el.id && `#${el.id}` === action.selector) || (el.className && `.${el.className}` === action.selector);
    return isTarget && el.tag === 'input' && el.type === 'file';
  });

  if (targetsFileInput) {
    return {
      needed: true,
      reason: `Action targets a file upload input ("${action.selector}"). Human intervention required for file selection.`
    };
  }

  return { needed: false, reason: null };
}

async function appendVaultEntry(entry) {
  try {
    const data = await browser.storage.local.get(['vault']);
    const currentVault = Array.isArray(data.vault) ? data.vault : [];
    const vaultEntry = {
      id: 'vault_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: entry.timestamp || new Date().toISOString(),
      siteUrl: entry.siteUrl || 'Unknown Site',
      actionsTaken: entry.actionsTaken || [],
      outcome: entry.outcome || 'completed'
    };
    currentVault.unshift(vaultEntry);
    await browser.storage.local.set({ vault: currentVault });
  } catch (e) {
    console.warn('[Background] Failed to save vault entry:', e);
  }
}
