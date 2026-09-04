/* extension/browser-polyfill.js */

(function () {
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));

  const isFirefox = typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined' && Boolean(browser.runtime.getURL);
  
  if (isFirefox) {
    // Firefox already provides native promise-based `browser` global
    if (!globalScope.browser) {
      globalScope.browser = browser;
    }
    return;
  }

  // For Chrome or other WebExtension environments without native browser global, create browser shim
  const chromeApi = typeof chrome !== 'undefined' ? chrome : {};

  globalScope.browser = {
    tabs: {
      query: function (queryInfo) {
        return new Promise((resolve, reject) => {
          chromeApi.tabs.query(queryInfo, (tabs) => {
            if (chromeApi.runtime && chromeApi.runtime.lastError) {
              return reject(new Error(chromeApi.runtime.lastError.message));
            }
            resolve(tabs);
          });
        });
      },
      sendMessage: function (tabId, message) {
        return new Promise((resolve, reject) => {
          chromeApi.tabs.sendMessage(tabId, message, (response) => {
            const err = chromeApi.runtime && chromeApi.runtime.lastError;
            if (err) {
              // Return object with error property for graceful handling in caller if channel failed
              return resolve({ success: false, error: err.message });
            }
            resolve(response);
          });
        });
      },
      captureVisibleTab: function (windowId, options) {
        return new Promise((resolve, reject) => {
          chromeApi.tabs.captureVisibleTab(windowId, options, (dataUrl) => {
            const err = chromeApi.runtime && chromeApi.runtime.lastError;
            if (err) {
              return reject(new Error(err.message));
            }
            if (!dataUrl) {
              return reject(new Error('No data URL returned'));
            }
            resolve(dataUrl);
          });
        });
      }
    },
    runtime: {
      sendMessage: function (message) {
        return new Promise((resolve, reject) => {
          chromeApi.runtime.sendMessage(message, (response) => {
            const err = chromeApi.runtime && chromeApi.runtime.lastError;
            if (err) {
              return resolve({ success: false, error: err.message });
            }
            resolve(response);
          });
        });
      },
      onMessage: {
        addListener: function (listener) {
          chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const result = listener(message, sender, sendResponse);
            if (result && typeof result.then === 'function') {
              result.then((res) => sendResponse(res)).catch((err) => sendResponse({ success: false, error: err.message }));
              return true;
            }
            return result;
          });
        }
      },
      lastError: chromeApi.runtime ? chromeApi.runtime.lastError : null
    },
    scripting: {
      executeScript: function (injection) {
        return new Promise((resolve, reject) => {
          if (!chromeApi.scripting) {
            return reject(new Error('scripting API not available'));
          }
          chromeApi.scripting.executeScript(injection, (results) => {
            const err = chromeApi.runtime && chromeApi.runtime.lastError;
            if (err) {
              return reject(new Error(err.message));
            }
            resolve(results);
          });
        });
      }
    },
    storage: {
      local: {
        get: function (keys) {
          return new Promise((resolve, reject) => {
            chromeApi.storage.local.get(keys, (items) => {
              const err = chromeApi.runtime && chromeApi.runtime.lastError;
              if (err) return reject(new Error(err.message));
              resolve(items);
            });
          });
        },
        set: function (items) {
          return new Promise((resolve, reject) => {
            chromeApi.storage.local.set(items, () => {
              const err = chromeApi.runtime && chromeApi.runtime.lastError;
              if (err) return reject(new Error(err.message));
              resolve();
            });
          });
        }
      }
    }
  };
})();
