importScripts('extension/browser-polyfill.js');
importScripts('extension/rag-retrieval.js');

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
// AGENT LOOP STATE & RUNNING-STATE LOCK (Modules 69, 70, 71, 76)
// =========================================================================

// Module 76: Configurable human-like pacing delay range
const PACING_DELAY_MIN_MS = 400;
const PACING_DELAY_MAX_MS = 900;

let agentLoopState = {
  isLocked: false,            // Module 70: Running-state lock
  status: 'ready',            // 'ready' | 'running' | 'paused' | 'error' | 'stopped' | 'busy'
  statusText: 'Ready',
  goal: '',
  redactionEnabled: true,
  iterationCount: 0,
  maxIterations: 15,
  actionsTaken: [],
  activityFeed: [],           // Modules 78, 79, 80: Structured step summaries & replay history
  consecutiveFailures: 0,
  lastSelector: null,
  logs: [],
  pendingInterventions: [],
  pausedAction: null,
  activeTabId: null,
  activeTabUrl: 'Unknown Site',
  lastPipelineResult: null,
  domStabilityMs: 0,
  pacingDelayMs: 0            // Module 76: Recorded pacing delay before capture
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

/**
 * Broadcasts an individual feed item update (Module 78).
 */
function broadcastFeedUpdate(feedItem) {
  try {
    browser.runtime.sendMessage({
      type: 'FEED_UPDATE',
      feedItem,
      activityFeed: agentLoopState.activityFeed
    }).catch(() => {});
  } catch (e) {}
}

function addFeedItem(item) {
  // Check if step exists to update or append
  const existingIdx = agentLoopState.activityFeed.findIndex(f => f.stepIndex === item.stepIndex && f.status === 'running');
  if (existingIdx !== -1) {
    agentLoopState.activityFeed[existingIdx] = { ...agentLoopState.activityFeed[existingIdx], ...item };
    broadcastFeedUpdate(agentLoopState.activityFeed[existingIdx]);
  } else {
    agentLoopState.activityFeed.push(item);
    broadcastFeedUpdate(item);
  }
  broadcastLoopState();
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
// NAVIGATION LISTENER & CONTENT SCRIPT LIVENESS (Module 69)
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
 * Sends a lightweight PING message to verify content script responsiveness (Module 69).
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
// BACKGROUND MESSAGE DISPATCHER (Modules 68-72)
// =========================================================================

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    // Module 70 & 71: Get canonical background loop state
    if (message.type === 'GET_LOOP_STATE') {
      return { success: true, state: agentLoopState };
    }

    // Module 70 & 71: Start / Trigger loop from popup
    if (message.type === 'START_LOOP') {
      if (agentLoopState.isLocked) {
        console.warn('[Background Loop] Trigger ignored: Agent loop is already running (isLocked = true).');
        return { success: false, error: 'Agent is already busy running a task.', isLocked: true };
      }
      // Start in background without blocking response
      runBackgroundAgentLoop(message.goal, message.redactionEnabled, message.resumeAction);
      return { success: true, started: true };
    }

    // Module 71 & 80: Approve intervention
    if (message.type === 'APPROVE_INTERVENTION') {
      const id = message.id;
      const item = agentLoopState.pendingInterventions.find((i) => i.id === id);
      if (item) {
        item.status = 'approved';
        setPendingBadgeCount(0);
        // Module 80: Update corresponding feed card status if exists
        const feedCard = agentLoopState.activityFeed.find(f => f.interventionId === id || (f.status === 'paused' && f.action === item.action?.action));
        if (feedCard) {
          feedCard.status = 'approved';
          feedCard.subtitle = `Approved by user: Proceeding with [${feedCard.action}] on "${feedCard.selector}"`;
          broadcastFeedUpdate(feedCard);
        }
        broadcastLoopState();
        const actionToResume = item.action || agentLoopState.pausedAction;
        runBackgroundAgentLoop(agentLoopState.goal, agentLoopState.redactionEnabled, actionToResume);
      }
      return { success: true };
    }

    // Module 71 & 80: Stop intervention
    if (message.type === 'STOP_INTERVENTION') {
      const id = message.id;
      const item = agentLoopState.pendingInterventions.find((i) => i.id === id);
      if (item) {
        item.status = 'stopped';
        setPendingBadgeCount(0);
        agentLoopState.status = 'stopped';
        agentLoopState.statusText = 'Stopped';
        agentLoopState.isLocked = false;
        // Module 80: Update corresponding feed card status if exists
        const feedCard = agentLoopState.activityFeed.find(f => f.interventionId === id || (f.status === 'paused' && f.action === item.action?.action));
        if (feedCard) {
          feedCard.status = 'stopped';
          feedCard.subtitle = `Stopped by user: Execution halted at this step.`;
          broadcastFeedUpdate(feedCard);
        }
        broadcastLoopState();
      }
      return { success: true };
    }

    // Module 81: User sends a correction instruction on a paused step
    if (message.type === 'USER_CORRECTION') {
      const { interventionId, correctionText } = message;

      // Mark the intervention record
      const item = agentLoopState.pendingInterventions.find((i) => i.id === interventionId);
      if (item) item.status = 'user-corrected';
      setPendingBadgeCount(0);

      // Mark the paused feed card as user-corrected
      const pausedCard = agentLoopState.activityFeed.find(
        f => f.interventionId === interventionId || f.status === 'paused'
      );
      if (pausedCard) {
        pausedCard.status = 'user-corrected';
        pausedCard.subtitle = `User redirected: "${correctionText}"`;
        broadcastFeedUpdate(pausedCard);
      }

      // Run the user-corrected action asynchronously (don't block response)
      runUserCorrectedAction(interventionId, correctionText);
      return { success: true };
    }

    // Module 71: Update pipeline result from popup runner
    if (message.type === 'STEP_PIPELINE_DONE') {
      agentLoopState.lastPipelineResult = message.pipelineRes;
      broadcastLoopState();
      return { success: true };
    }

    // Module 71: Set loop status directly
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
// AGENTIC EXECUTION LOOP IN BACKGROUND SCRIPT (Module 71)
// =========================================================================

async function runBackgroundAgentLoop(goal, redactionEnabled = true, resumeAction = null) {
  // Module 70: Running-state lock check
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
    agentLoopState.activityFeed = []; // Reset feed for new task run
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

      // Module 78 & 80: Mark resumed feed item as completed
      const resumedFeedItem = {
        id: 'step_resumed_' + Date.now(),
        stepIndex: agentLoopState.iterationCount,
        maxIterations: agentLoopState.maxIterations,
        status: 'completed',
        action: resumeAction.action,
        selector: resumeAction.selector,
        title: `Executed approved [${resumeAction.action}] on "${resumeAction.selector}"`,
        subtitle: `User approved action: ${resumeAction.reasoning || 'Executed successfully.'}`,
        reasoning: resumeAction.reasoning || 'User approved human-in-the-loop action.',
        detectionCounts: agentLoopState.lastPipelineResult?.counts || null,
        timing: agentLoopState.lastPipelineResult?.timing || null,
        originalImage: agentLoopState.lastPipelineResult?.originalImage || null,
        redactedImage: agentLoopState.lastPipelineResult?.redactedImage || null,
        timestamp: new Date().toISOString()
      };
      addFeedItem(resumedFeedItem);

      // Module 68: Wait for DOM stability after resumed action
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

    // =========================================================================
    // Module 75: INITIAL SPA READINESS & DOM STRUCTURE STABILITY CHECK
    // =========================================================================
    if (agentLoopState.iterationCount === 0 && !resumeAction) {
      addLoopLog('⏳ Verifying initial page readiness (document.readyState)...');
      try {
        const readyCheck = await browser.tabs.sendMessage(activeTab.id, { type: 'CHECK_PAGE_READY' });
        if (readyCheck && !readyCheck.isComplete) {
          addLoopLog(`⏳ Page readyState is "${readyCheck.readyState}". Waiting for initial DOM stability...`);
          await browser.tabs.sendMessage(activeTab.id, {
            type: 'WAIT_FOR_DOM_STABLE',
            timeoutMs: 2500,
            quietMs: 400
          });
        }
      } catch (e) {
        // Content script will be verified in liveness step below
      }
    }

    while (agentLoopState.iterationCount < agentLoopState.maxIterations) {
      agentLoopState.iterationCount++;
      addLoopLog(`\n🔄 --- Agent Loop Iteration ${agentLoopState.iterationCount}/${agentLoopState.maxIterations} ---`);

      // =========================================================================
      // Module 76: PACING DELAY BEFORE CAPTURING SCREEN
      // Mimics human perceptual pause and allows in-flight UI transitions to settle
      // =========================================================================
      const pacingDelay = Math.floor(Math.random() * (PACING_DELAY_MAX_MS - PACING_DELAY_MIN_MS + 1)) + PACING_DELAY_MIN_MS;
      agentLoopState.pacingDelayMs = pacingDelay;
      addLoopLog(`⏱️ Applying pacing pause (${pacingDelay}ms) for visual settling...`);
      await new Promise(resolve => setTimeout(resolve, pacingDelay));

      // Module 69: Verify content script liveness before capture
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

      // Stage 2: Extract DOM Structure (with Module 75 sparse check)
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

      // Module 75: If DOM is sparse (< 2 interactive elements on SPA loading skeleton), wait 1000ms & re-fetch
      if (domStructure.length < 2) {
        addLoopLog('⏳ Sparse DOM detected (< 2 elements). Waiting 1000ms for SPA hydration...');
        await new Promise(r => setTimeout(r, 1000));
        try {
          const rehydratedDom = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_DOM_STRUCTURE' });
          if (rehydratedDom && rehydratedDom.success && rehydratedDom.domStructure.length > 0) {
            domStructure = rehydratedDom.domStructure;
            addLoopLog(`✅ DOM hydrated with ${domStructure.length} interactive elements.`);
          }
        } catch (e) {}
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

        // Module 78, 79, 80: Construct paused feed item card with inline intervention buttons
        const interventionId = 'notif_' + Date.now();
        const counts = agentLoopState.lastPipelineResult?.counts || { detected: 0, redacted: 0, skipped: 0 };
        const detectionSummary = `${counts.detected || 0} detected (${counts.redacted || 0} redacted, ${counts.skipped || 0} skipped)`;
        
        const pausedFeedItem = {
          id: 'step_' + agentLoopState.iterationCount + '_' + Date.now(),
          stepIndex: agentLoopState.iterationCount,
          maxIterations: agentLoopState.maxIterations,
          status: 'paused',
          action: actionResponse.action,
          selector: actionResponse.selector,
          title: `Paused: Approval Needed for [${actionResponse.action}] on "${actionResponse.selector}"`,
          subtitle: `Intervention: ${interventionCheck.reason}`,
          reasoning: actionResponse.reasoning || 'Action flagged by policy for user confirmation.',
          detectionSummary,
          detectionCounts: counts,
          timing: agentLoopState.lastPipelineResult?.timing || null,
          originalImage: agentLoopState.lastPipelineResult?.originalImage || null,
          redactedImage: agentLoopState.lastPipelineResult?.redactedImage || payloadImage,
          interventionId,
          timestamp: new Date().toISOString()
        };
        addFeedItem(pausedFeedItem);

        showInterventionNotification(interventionCheck.reason);

        agentLoopState.pendingInterventions.unshift({
          id: interventionId,
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

        // Module 70: Release lock on intervention pause so user can resume/approve cleanly
        agentLoopState.isLocked = false;
        broadcastLoopState();
        return; // Pause execution loop
      }

      // Add in-progress feed card before execution
      const inProgressFeedItem = {
        id: 'step_' + agentLoopState.iterationCount,
        stepIndex: agentLoopState.iterationCount,
        maxIterations: agentLoopState.maxIterations,
        status: 'running',
        action: actionResponse.action,
        selector: actionResponse.selector,
        title: `Executing [${actionResponse.action}] on "${actionResponse.selector}"`,
        subtitle: `In progress...`,
        reasoning: actionResponse.reasoning || '',
        detectionCounts: agentLoopState.lastPipelineResult?.counts || { detected: 0, redacted: 0, skipped: 0 },
        timing: agentLoopState.lastPipelineResult?.timing || null,
        originalImage: agentLoopState.lastPipelineResult?.originalImage || null,
        redactedImage: agentLoopState.lastPipelineResult?.redactedImage || payloadImage,
        timestamp: new Date().toISOString()
      };
      addFeedItem(inProgressFeedItem);

      // Stage 5: Execute Action with Selector Fallback & Retry (Up to 2 Retries)
      // Module 77: Proactive selector pre-validation before attempting execution
      let retryAttempts = 0;
      let actionExecuted = false;

      while (retryAttempts <= 2 && !actionExecuted) {
        // Module 77: Check if selector exists before attempting action
        if (actionResponse.selector && actionResponse.action !== 'wait') {
          addLoopLog(`🔍 Pre-validating selector "${actionResponse.selector}" exists in current DOM...`);
          let selectorCheck = { success: true, exists: true };
          try {
            selectorCheck = await browser.tabs.sendMessage(activeTab.id, {
              type: 'CHECK_SELECTOR',
              selector: actionResponse.selector
            });
          } catch (selErr) {
            selectorCheck = { success: false, exists: false };
          }

          if (!selectorCheck || !selectorCheck.exists) {
            if (retryAttempts < 2) {
              retryAttempts++;
              agentLoopState.consecutiveFailures++;
              addLoopLog(`⚠️ Pre-validation: Selector "${actionResponse.selector}" is missing from DOM. Re-prompting VLM backend (Retry ${retryAttempts}/2)...`);
              
              const freshDomRes = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_DOM_STRUCTURE' }).catch(() => ({}));
              const freshDom = (freshDomRes && freshDomRes.success) ? freshDomRes.domStructure : domStructure;

              const correctionGoal = `${agentLoopState.goal}\n\nThe selector [${actionResponse.selector}] does not exist on this page. Available elements:\n${JSON.stringify(freshDom)}\nChoose a selector ONLY from this list.`;
              
              const retryBackend = await fetch(`${BACKEND_URL}/act`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  goal: correctionGoal,
                  redactedImage: payloadImage,
                  domStructure: freshDom
                })
              });
              actionResponse = await retryBackend.json();
              continue; // Re-evaluate with new actionResponse
            } else {
              throw new Error("I couldn't find the right element on this page, please complete this step manually.");
            }
          }
        }

        addLoopLog(`⏳ Executing action [${actionResponse.action}] on selector "${actionResponse.selector}"...`);
        
        // Render Set-of-Marks overlay on the active tab so numbered bounding boxes and green chosen box appear
        try {
          await browser.tabs.sendMessage(activeTab.id, {
            type: 'RENDER_SOM_OVERLAY',
            domStructure,
            chosenSelector: actionResponse.selector,
            displayMs: 3000
          });
        } catch (somErr) {}

        let execRes = null;
        try {
          execRes = await browser.tabs.sendMessage(activeTab.id, {
            type: 'EXECUTE_ACTION',
            action: actionResponse
          });
        } catch (execErr) {
          // If execution message failed, page may be navigating (Module 69)
          console.log('[Background] Action triggered navigation or context shift...');
          execRes = { success: true };
        }

        if (execRes && execRes.success) {
          actionExecuted = true;
          agentLoopState.consecutiveFailures = 0;
          agentLoopState.lastSelector = actionResponse.selector;
          agentLoopState.actionsTaken.push(`${actionResponse.action} on ${actionResponse.selector}`);
          addLoopLog(`✅ Action successfully executed.`);

          // Module 78: Surface human-readable summary in feed
          const counts = agentLoopState.lastPipelineResult?.counts || { detected: 0, redacted: 0, skipped: 0 };
          const detectionSummary = `${counts.detected || 0} sensitive items detected (${counts.redacted || 0} redacted, ${counts.skipped || 0} skipped)`;

          // Module 84: Annotate whether the value came from local profile or VLM
          const valueResolution = execRes.valueResolution || null;
          const resolutionBadge = valueResolution === 'local-profile'
            ? ` 🔐 [Local Profile]`
            : valueResolution === 'vlm-provided'
            ? ` ☁️ [VLM-provided]`
            : '';

          let actionLabel = `Executed [${actionResponse.action}]`;
          if (actionResponse.action === 'click') actionLabel = `Clicked element "${actionResponse.selector}"`;
          else if (actionResponse.action === 'type') {
            const fieldLabel = actionResponse.valueSource
              ? `"${actionResponse.selector}" (profile: ${actionResponse.valueSource})`
              : `"${actionResponse.selector}"`;
            actionLabel = `Typed into ${fieldLabel}${resolutionBadge}`;
          }
          else if (actionResponse.action === 'scroll') actionLabel = `Scrolled "${actionResponse.selector}"`;

          const completedFeedItem = {
            id: 'step_' + agentLoopState.iterationCount,
            stepIndex: agentLoopState.iterationCount,
            maxIterations: agentLoopState.maxIterations,
            status: 'completed',
            action: actionResponse.action,
            selector: actionResponse.selector,
            title: actionLabel,
            subtitle: actionResponse.reasoning || `Action completed successfully. ${detectionSummary}`,
            reasoning: actionResponse.reasoning || 'Executed proposed step based on current page state.',
            detectionSummary,
            detectionCounts: counts,
            timing: agentLoopState.lastPipelineResult?.timing || null,
            originalImage: agentLoopState.lastPipelineResult?.originalImage || null,
            redactedImage: agentLoopState.lastPipelineResult?.redactedImage || payloadImage,
            timestamp: new Date().toISOString()
          };
          addFeedItem(completedFeedItem);

          // Module 68: Wait for DOM stability after action execution before next loop re-capture
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
          addLoopLog(`⚠️ Selector "${actionResponse.selector}" not found during execution. Re-prompting VLM backend (Retry ${retryAttempts}/2)...`);
          
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

    // Save final entry to Vault (Module 85/86: with domStructure for signature calculation)
    await appendVaultEntry({
      timestamp: new Date().toISOString(),
      siteUrl: agentLoopState.activeTabUrl,
      actionsTaken: agentLoopState.actionsTaken,
      domStructure: typeof domStructure !== 'undefined' ? domStructure : [],
      outcome: finalOutcome
    });

  } catch (err) {
    console.error('[Background Loop Error]:', err);
    updateLoopStatus('error', 'Error');
    addLoopLog(`❌ Execution Stopped: ${err.message}`);

    // If content script was unresponsive or error requires human assistance
    showInterventionNotification(`Error in agent loop: ${err.message}`);
  } finally {
    // Module 70: Release running-state lock in ALL exit paths (success, error, or cap reached)
    agentLoopState.isLocked = false;
    broadcastLoopState();
    console.log('[Background Loop] Running-state lock released. Agent Ready.');
  }
}

// =========================================================================
// Module 81: USER-CORRECTED ACTION RUNNER
// =========================================================================

async function runUserCorrectedAction(interventionId, correctionText) {
  if (agentLoopState.isLocked) {
    console.warn('[UserCorrection] Loop locked — correction deferred.');
    return;
  }
  agentLoopState.isLocked = true;
  updateLoopStatus('running', 'Processing your correction…');

  try {
    // Grab the active tab
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) throw new Error('No active tab found for user correction.');

    // Fetch current DOM
    let domStructure = [];
    try {
      const domRes = await browser.tabs.sendMessage(activeTab.id, { type: 'GET_DOM_STRUCTURE' });
      domStructure = (domRes && domRes.success) ? domRes.domStructure : [];
    } catch (_) {}

    // Capture a fresh screenshot for context
    let payloadImage = null;
    try {
      const dataUrl = await browser.tabs.captureVisibleTab(activeTab.windowId, { format: 'jpeg', quality: 80 });
      payloadImage = (agentLoopState.lastPipelineResult?.redactedImage && agentLoopState.redactionEnabled)
        ? agentLoopState.lastPipelineResult.redactedImage
        : dataUrl;
    } catch (_) {}

    // Build a correction-augmented goal string for the VLM
    const correctedGoal =
      `Original goal: ${agentLoopState.goal}\n\n` +
      `USER CORRECTION — Do NOT repeat the previous plan. Instead, follow this specific instruction now:\n` +
      `"${correctionText}"\n\n` +
      `Available DOM elements:\n${JSON.stringify(domStructure)}`;

    addLoopLog(`✏️ User correction received: "${correctionText}". Re-querying VLM…`);

    // Add an in-progress feed card for the correction step
    const correctionStepIndex = agentLoopState.iterationCount + 1;
    const correctionCardId = 'correction_' + Date.now();
    addFeedItem({
      id: correctionCardId,
      stepIndex: correctionStepIndex,
      maxIterations: agentLoopState.maxIterations,
      status: 'running',
      action: 'correction',
      selector: null,
      title: `✏️ User correction: "${correctionText}"`,
      subtitle: 'Querying VLM with your instruction…',
      reasoning: `User overrode the autonomous plan and instructed: "${correctionText}"`,
      detectionCounts: agentLoopState.lastPipelineResult?.counts || {},
      timing: null,
      originalImage: payloadImage,
      redactedImage: payloadImage,
      correctedByUser: true,
      timestamp: new Date().toISOString()
    });

    // Re-prompt the VLM with the correction
    const vlmRes = await fetch(`${BACKEND_URL}/act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: correctedGoal,
        redactedImage: payloadImage,
        domStructure
      })
    });

    if (!vlmRes.ok) {
      let errDetails = `HTTP ${vlmRes.status}`;
      try { const e = await vlmRes.json(); if (e.error) errDetails = e.error; } catch (_) {}
      throw new Error(`VLM error during correction: ${errDetails}`);
    }

    const actionResponse = await vlmRes.json();
    addLoopLog(`✅ Correction VLM response: [${actionResponse.action}] on "${actionResponse.selector}"`);

    // Execute the corrected action
    let execRes = null;
    try {
      execRes = await browser.tabs.sendMessage(activeTab.id, {
        type: 'EXECUTE_ACTION',
        action: actionResponse
      });
    } catch (_) {
      execRes = { success: true }; // Navigation may have been triggered
    }

    if (!execRes || !execRes.success) {
      throw new Error(`Corrected action execution failed on selector "${actionResponse.selector}"`);
    }

    agentLoopState.iterationCount = correctionStepIndex;
    agentLoopState.actionsTaken.push(`[user-corrected] ${actionResponse.action} on ${actionResponse.selector}`);

    let correctionActionLabel = `Executed [${actionResponse.action}]`;
    if (actionResponse.action === 'click') correctionActionLabel = `Clicked "${actionResponse.selector}"`;
    else if (actionResponse.action === 'type') correctionActionLabel = `Typed into "${actionResponse.selector}"`;
    else if (actionResponse.action === 'scroll') correctionActionLabel = `Scrolled "${actionResponse.selector}"`;

    // Update the running card → user-corrected + completed
    addFeedItem({
      id: correctionCardId,
      stepIndex: correctionStepIndex,
      maxIterations: agentLoopState.maxIterations,
      status: 'user-corrected',
      action: actionResponse.action,
      selector: actionResponse.selector,
      title: `✏️ ${correctionActionLabel} (user-directed)`,
      subtitle: `Based on your instruction: "${correctionText}"`,
      reasoning: actionResponse.reasoning || `User-directed correction executed successfully.`,
      detectionCounts: agentLoopState.lastPipelineResult?.counts || {},
      timing: agentLoopState.lastPipelineResult?.timing || null,
      originalImage: payloadImage,
      redactedImage: payloadImage,
      correctedByUser: true,
      correctionText,
      timestamp: new Date().toISOString()
    });

    addLoopLog(`✅ User correction executed. Resuming autonomous loop…`);

    // Save a distinct vault entry for the corrected step
    await appendVaultEntry({
      timestamp: new Date().toISOString(),
      siteUrl: agentLoopState.activeTabUrl,
      actionsTaken: agentLoopState.actionsTaken,
      outcome: 'user-corrected',
      correctionText,
      correctedByUser: true
    });

    updateLoopStatus('ready', 'Correction applied — ready for next step');

    // After executing the correction, continue the autonomous loop from the next iteration
    runBackgroundAgentLoop(agentLoopState.goal, agentLoopState.redactionEnabled, null);

  } catch (err) {
    console.error('[UserCorrection] Error:', err);
    addLoopLog(`❌ Correction failed: ${err.message}`);
    updateLoopStatus('error', 'Correction failed');
    agentLoopState.isLocked = false;
    broadcastLoopState();
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
      outcome: entry.outcome || 'completed',
      // Module 85/86: Store structural metadata signature for RAG retrieval
      structuralSignature: entry.structuralSignature || (typeof computeStructuralSignature === 'function' && entry.domStructure ? computeStructuralSignature(entry.domStructure) : null),
      // Module 81: Flag user-corrected steps distinctly in the vault
      ...(entry.correctedByUser ? {
        correctedByUser: true,
        correctionText: entry.correctionText || null
      } : {})
    };
    currentVault.unshift(vaultEntry);
    await browser.storage.local.set({ vault: currentVault });
  } catch (e) {
    console.warn('[Background] Failed to save vault entry:', e);
  }
}
