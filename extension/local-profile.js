/* extension/local-profile.js — Prompt 82
 *
 * PRIVACY CONTRACT: This file ONLY reads/writes chrome.storage.local.
 * It MUST NOT be imported or referenced from network.js, llm-prompt.js,
 * or any file that constructs/sends network requests.
 *
 * Supported profile keys:
 *   fullName | email | phone | aadhaar | pan | passport |
 *   address | pinCode | dateOfBirth | bankAccount
 */

const LOCAL_PROFILE_KEY = 'localProfile';

/** Keys that map to real sensitive identity fields. */
const PROFILE_FIELD_KEYS = [
  'fullName',
  'email',
  'phone',
  'aadhaar',
  'pan',
  'passport',
  'address',
  'pinCode',
  'dateOfBirth',
  'bankAccount',
];

/**
 * Returns the full profile object from local storage, or {} if not set.
 * @returns {Promise<Object>}
 */
async function getProfile() {
  try {
    const result = await chrome.storage.local.get([LOCAL_PROFILE_KEY]);
    return result[LOCAL_PROFILE_KEY] || {};
  } catch (e) {
    console.warn('[LocalProfile] Failed to read profile:', e);
    return {};
  }
}

/**
 * Returns the value for a single profile key, or null if not set.
 * This is called at action-execution time — never at network-call time.
 * @param {string} key — one of PROFILE_FIELD_KEYS
 * @returns {Promise<string|null>}
 */
async function getProfileValue(key) {
  if (!key) return null;

  // Key normalizer / alias map for VLM variations
  const normalizeKey = (inputKey) => {
    const k = String(inputKey).trim().toLowerCase().replace(/[-_]/g, '');
    if (['fullname', 'name', 'personname', 'givenname', 'surname'].includes(k)) return 'fullName';
    if (['email', 'emailaddress', 'mail'].includes(k)) return 'email';
    if (['phone', 'phonenumber', 'mobile', 'cell', 'tel'].includes(k)) return 'phone';
    if (['aadhaar', 'aadhaarnumber', 'uid'].includes(k)) return 'aadhaar';
    if (['pan', 'pannumber'].includes(k)) return 'pan';
    if (['passport', 'passportnumber'].includes(k)) return 'passport';
    if (['address', 'street', 'city'].includes(k)) return 'address';
    if (['pincode', 'pin', 'zip', 'zipcode', 'postalcode'].includes(k)) return 'pinCode';
    if (['dateofbirth', 'dob', 'birthdate', 'birth'].includes(k)) return 'dateOfBirth';
    if (['bankaccount', 'accountnumber', 'ifsc', 'bank'].includes(k)) return 'bankAccount';
    return inputKey;
  };

  const canonKey = normalizeKey(key);

  if (!PROFILE_FIELD_KEYS.includes(canonKey)) {
    console.warn(`[LocalProfile] Unknown profile key requested: "${key}" (normalized: "${canonKey}")`);
    return null;
  }
  const profile = await getProfile();
  return profile[canonKey] != null && String(profile[canonKey]).trim() !== '' ? String(profile[canonKey]).trim() : null;
}

/**
 * Saves (merges) the given partial profile into local storage.
 * Only keys listed in PROFILE_FIELD_KEYS are persisted.
 * @param {Object} partial
 * @returns {Promise<void>}
 */
async function saveProfile(partial) {
  const current = await getProfile();
  const updated = { ...current };
  for (const key of PROFILE_FIELD_KEYS) {
    if (partial[key] !== undefined && partial[key] !== null) {
      updated[key] = String(partial[key]).trim();
    }
  }
  await chrome.storage.local.set({ [LOCAL_PROFILE_KEY]: updated });
}

/**
 * Clears all profile data from local storage.
 * @returns {Promise<void>}
 */
async function clearProfile() {
  await chrome.storage.local.remove([LOCAL_PROFILE_KEY]);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getProfile, getProfileValue, saveProfile, clearProfile, PROFILE_FIELD_KEYS, LOCAL_PROFILE_KEY };
}
