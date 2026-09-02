/* extension/detection/pii-patterns.js */

const AADHAAR_REGEX = /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/;
const PHONE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const ADDRESS_KEYWORDS = ['Road', 'Street', 'Sector', 'Nagar', 'Colony', 'Pin Code', 'District'];

/**
 * Classifies input text into PII types or returns null if no match.
 * @param {string} text 
 * @returns {'aadhaar' | 'phone' | 'pan' | 'email' | 'address' | null}
 */
function classifyPII(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (AADHAAR_REGEX.test(trimmed)) return 'aadhaar';
  if (PHONE_REGEX.test(trimmed)) return 'phone';
  if (PAN_REGEX.test(trimmed)) return 'pan';
  if (EMAIL_REGEX.test(trimmed)) return 'email';

  const hasAddressKeyword = ADDRESS_KEYWORDS.some(keyword =>
    trimmed.toLowerCase().includes(keyword.toLowerCase())
  );
  if (hasAddressKeyword) return 'address';

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AADHAAR_REGEX,
    PHONE_REGEX,
    PAN_REGEX,
    EMAIL_REGEX,
    ADDRESS_KEYWORDS,
    classifyPII
  };
}
