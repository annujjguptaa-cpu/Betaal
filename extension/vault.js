/* extension/vault.js */

/**
 * Saves a completed or paused agent execution run entry to chrome.storage.local.
 * Entries store metadata only (timestamps, site URLs, PII/face counts, action summaries).
 * NO raw screenshots or raw PII values are saved.
 * @param {Object} entry 
 * @returns {Promise<Array<Object>>} Updated vault list
 */
async function saveToVault(entry) {
  const vaultEntry = {
    id: 'vault_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    timestamp: entry.timestamp || new Date().toISOString(),
    siteUrl: entry.siteUrl || 'Unknown Site',
    piiCount: entry.piiCount || 0,
    faceCount: entry.faceCount || 0,
    actionsTaken: entry.actionsTaken || [],
    outcome: entry.outcome || 'completed' // 'completed' | 'paused' | 'stopped'
  };

  try {
    const data = await browser.storage.local.get(['vault']);
    const currentVault = Array.isArray(data.vault) ? data.vault : [];
    currentVault.unshift(vaultEntry); // Prepend for reverse-chronological order
    await browser.storage.local.set({ vault: currentVault });
    return currentVault;
  } catch (err) {
    console.error('[Vault] Save error:', err);
    return [];
  }
}

/**
 * Fetches all saved vault entries from chrome.storage.local.
 * @returns {Promise<Array<Object>>}
 */
async function getVaultEntries() {
  try {
    const data = await browser.storage.local.get(['vault']);
    return Array.isArray(data.vault) ? data.vault : [];
  } catch (err) {
    console.error('[Vault] Fetch error:', err);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { saveToVault, getVaultEntries };
}
