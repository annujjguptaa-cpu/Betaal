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

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
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


