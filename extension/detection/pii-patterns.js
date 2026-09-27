/* extension/detection/pii-patterns.js
 *
 * Universal, generalized PII Pattern Classifier for Indian & Global Identity Portals.
 * Detects Aadhaar, Phone, PAN, EPIC Voter ID, Driving License, Enrolment ID, Passport,
 * Email, Date of Birth, Address tokens, and generic multi-digit sensitive numbers.
 */

const AADHAAR_REGEX     = /\b[2-9]\d{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/;
const PHONE_REGEX       = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;
const PAN_REGEX         = /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/;
const EPIC_REGEX        = /\b[A-Z]{3}\d{7}\b/;
const DL_REGEX          = /\b[A-Z]{2}[-\s]?\d{2}[-\s]?\d{11,13}\b/;
const ENROLMENT_REGEX   = /\b\d{4}[\s-]?\d{5}[\s-]?\d{5}\b/;
const PASSPORT_REGEX    = /\b[A-Z][0-9]{7}\b/;
const EMAIL_REGEX       = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const DOB_REGEX         = /\b(?:0[1-9]|[12][0-9]|3[01])[\/\.-](?:0[1-9]|1[012])[\/\.-](?:19|20)\d{2}\b/;

const ADDRESS_KEYWORDS = [
  'Road', 'Street', 'Sector', 'Nagar', 'Colony', 'Pin Code', 'District', 'MG Road',
  'Marg', 'Gali', 'Block', 'Floor', 'House', 'Flat', 'Village', 'Dist', 'Tehsil',
  'State', 'Pincode', 'VPO', 'PO', 'PS', 'Bhavan', 'Bhawan', 'Near', 'Opp', 'Behind',
  'R/O', 'S/O', 'D/O', 'W/O', 'Father', 'Husband', 'Mother', 'Guardian', 'Applicant',
  'Address', 'Location', 'City', 'Mohalla', 'Landmark'
];

const GENERIC_DIGIT_ID_REGEX = /\b(?!\.?\d+\.\d+)(?![₹$\u20B9]\s*\d+)\d[\d\s-]{7,}\d\b/;

/**
 * Classifies input text into PII types or returns null if no match.
 * @param {string} text 
 * @returns {string|null}
 */
function classifyPII(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return null;

  if (AADHAAR_REGEX.test(trimmed)) return 'aadhaar';
  if (PHONE_REGEX.test(trimmed)) return 'phone';
  if (PAN_REGEX.test(trimmed)) return 'pan';
  if (EPIC_REGEX.test(trimmed)) return 'epic';
  if (DL_REGEX.test(trimmed)) return 'driving-license';
  if (ENROLMENT_REGEX.test(trimmed)) return 'enrolment-id';
  if (PASSPORT_REGEX.test(trimmed)) return 'passport';
  if (EMAIL_REGEX.test(trimmed)) return 'email';
  if (DOB_REGEX.test(trimmed)) return 'dob';

  const lower = trimmed.toLowerCase();
  const hasAddressKeyword = ADDRESS_KEYWORDS.some(keyword =>
    lower.includes(keyword.toLowerCase())
  );
  if (hasAddressKeyword) return 'address';

  // Currency / decimal guard
  if (/[₹$\u20B9]|\./.test(trimmed)) {
    return null;
  }

  // Count total digits in sequence
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
    EPIC_REGEX,
    DL_REGEX,
    ENROLMENT_REGEX,
    PASSPORT_REGEX,
    EMAIL_REGEX,
    DOB_REGEX,
    ADDRESS_KEYWORDS,
    classifyPII
  };
}
