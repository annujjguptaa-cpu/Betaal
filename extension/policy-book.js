/* extension/policy-book.js */

const DEFAULT_POLICY = {
  rules: {
    aadhaar: { enabled: true, method: 'blackfill' },
    phone: { enabled: true, method: 'blackfill' },
    address: { enabled: true, method: 'blackfill' },
    email: { enabled: true, method: 'blackfill' },
    pan: { enabled: true, method: 'blackfill' },
    possibleIdNumber: { enabled: true, method: 'blackfill' },
    faces: { enabled: true, method: 'blur' }
  },
  siteOverrides: {},
  performanceMode: 'balanced' // 'fast' | 'balanced' | 'accurate'
};

/**
 * Normalizes hostnames from full URLs or plain host strings.
 * @param {string} url 
 * @returns {string} Hostname or fallback string
 */
function extractHostname(url) {
  if (!url || typeof url !== 'string') return 'global';
  try {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
      const parsed = new URL(url);
      return parsed.hostname || parsed.pathname.split('/').pop() || 'global';
    }
    return url.trim().toLowerCase();
  } catch (e) {
    return url.trim().toLowerCase();
  }
}

/**
 * Reads the current Policy Book configuration from browser storage (or returns default).
 * @returns {Promise<Object>}
 */
async function getPolicy() {
  try {
    const chromeApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local) {
      return JSON.parse(JSON.stringify(DEFAULT_POLICY));
    }
    const data = await chromeApi.storage.local.get(['policy']);
    if (data && data.policy) {
      return {
        rules: { ...DEFAULT_POLICY.rules, ...(data.policy.rules || {}) },
        siteOverrides: data.policy.siteOverrides || {},
        performanceMode: data.policy.performanceMode || 'balanced'
      };
    }
    return JSON.parse(JSON.stringify(DEFAULT_POLICY));
  } catch (err) {
    console.warn('[PolicyBook] Storage fetch error, returning default policy:', err);
    return JSON.parse(JSON.stringify(DEFAULT_POLICY));
  }
}

/**
 * Saves the given policy object to chrome.storage.local under the 'policy' key.
 * @param {Object} policy 
 * @returns {Promise<Object>} Saved policy object
 */
async function savePolicy(policy) {
  try {
    const chromeApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    const cleanPolicy = {
      rules: policy.rules || DEFAULT_POLICY.rules,
      siteOverrides: policy.siteOverrides || {},
      performanceMode: policy.performanceMode || 'balanced'
    };
    if (chromeApi && chromeApi.storage && chromeApi.storage.local) {
      await chromeApi.storage.local.set({ policy: cleanPolicy });
    }
    return cleanPolicy;
  } catch (err) {
    console.error('[PolicyBook] Storage save error:', err);
    return policy;
  }
}

/**
 * Merges base policy rules with matching site-specific overrides for a target site URL.
 * @param {string} siteUrl 
 * @returns {Promise<{
 *   rules: Object,
 *   hostname: string,
 *   performanceMode: string,
 *   hasOverride: boolean
 * }>}
 */
async function getEffectivePolicy(siteUrl) {
  const policy = await getPolicy();
  const hostname = extractHostname(siteUrl);

  const baseRules = JSON.parse(JSON.stringify(policy.rules));
  let hasOverride = false;

  if (hostname && policy.siteOverrides && policy.siteOverrides[hostname]) {
    const siteRules = policy.siteOverrides[hostname];
    hasOverride = true;
    for (const key of Object.keys(siteRules)) {
      if (baseRules[key]) {
        baseRules[key] = {
          enabled: typeof siteRules[key].enabled === 'boolean' ? siteRules[key].enabled : baseRules[key].enabled,
          method: siteRules[key].method || baseRules[key].method
        };
      }
    }
  }

  return {
    rules: baseRules,
    hostname,
    performanceMode: policy.performanceMode || 'balanced',
    hasOverride
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_POLICY,
    extractHostname,
    getPolicy,
    savePolicy,
    getEffectivePolicy
  };
}
