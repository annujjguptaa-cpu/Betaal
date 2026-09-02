console.log('Betaal background loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'CAPTURE_SCREEN') {
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else if (!dataUrl) {
          sendResponse({ success: false, error: 'No data URL returned' });
        } else {
          sendResponse({ success: true, dataUrl: dataUrl });
        }
      });
      return true; // Keep channel open for async response
    }
  } catch (err) {
    console.error('[Background Message Error]:', err);
    sendResponse({ success: false, error: err.message });
    return true;
  }
});


