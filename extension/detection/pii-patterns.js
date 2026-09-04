/* extension/detection/pii-patterns.js */

const AADHAAR_REGEX = /\b[2-9]\d{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/;
const PHONE_REGEX = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;
const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const ADDRESS_KEYWORDS = ['Road', 'Street', 'Sector', 'Nagar', 'Colony', 'Pin Code', 'District', 'MG Road'];

// Scope Limitation Note: Specific formats (SSN, passport numbers, etc.) beyond India are not individually pattern-matched, only caught by this generic fallback — this is a stated scope limitation, not a bug.
const GENERIC_DIGIT_ID_REGEX = /\b(?!\.?\d+\.\d+)(?![₹$\u20B9]\s*\d+)\d[\d\s-]{7,}\d\b/;

/**
 * Classifies input text into PII types or returns null if no match.
 * @param {string} text 
 * @returns {'aadhaar' | 'phone' | 'pan' | 'email' | 'address' | 'possible-id-number' | null}
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

  // Generic fallback pattern: 9+ digits (optionally spaced/dashed)
  // Check currency formatting or decimal point guards first
  if (/[₹$\u20B9]|\./.test(trimmed)) {
    // If text contains currency symbols or decimal points (e.g. product price '199999.00' or '₹199999'), exclude
    return null;
  }

  // Count total digits in the sequence
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 9 && GENERIC_DIGIT_ID_REGEX.test(trimmed)) {
    return 'possible-id-number';
  }

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
