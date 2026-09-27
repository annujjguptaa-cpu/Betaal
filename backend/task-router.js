/* backend/task-router.js
 *
 * Deterministic Task Router — bypasses the LLM for known multi-step portal workflows.
 * Inspects live DOM liveValues to determine exactly which step to execute next.
 *
 * Supported task patterns:
 *   1. IRCTC train search
 *   2. India Post consignment tracking
 *   3. Parivahan / Sarathi driving license
 *   4. ECI voter roll search (EPIC)
 *   5. UIDAI Aadhaar enrolment status
 */

/**
 * @param {string} goal
 * @param {Array<Object>} dom  - live DOM from content.js (with liveValue, tag, selector, etc.)
 * @param {Object} [context]   - optional context from background loop (e.g. captchaSolved)
 * @returns {{ action, selector, value, valueSource, reasoning, final, confidence } | null}
 */
function routeTask(goal, dom, context = {}) {
  if (!goal || !Array.isArray(dom)) return null;
  const ctx = context || {};
  const g = goal.toLowerCase();

  if (/irctc|train|ndls|bct|mmct|rajdhani|shatabdi|search.*train|train.*between|trains.*from/.test(g)) {
    return handleIRCTC(goal, dom, ctx);
  }
  if (/india post|consignment|parcel|tracking|track.*delivery|delivery.*status/.test(g)) {
    return handleIndiaPost(goal, dom, ctx);
  }
  if (/driving licen|parivahan|sarathi|dl renewal|dl services|driving license/.test(g)) {
    return handleParivahan(goal, dom, ctx);
  }
  if (/voter|electoral|epic|eci|nvsp|voter.*roll|voter.*card/.test(g)) {
    return handleECI(goal, dom, ctx);
  }
  if (/aadhaar|uidai|enrolment|enrollment|aadhar status/.test(g)) {
    return handleUIDAI(goal, dom, ctx);
  }
  if (/digilocker|locker|issued document|fetch.*document|download.*pdf|download.*aadhaar|download.*license|download.*marksheet/.test(g)) {
    return handleDigiLocker(goal, dom, ctx);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find element matching one of the matchers across ALL DOM items.
 * Matcher can be a string (substring) or regex tested against joined attribute hay.
 */
function findEl(dom, matchers, tagFilter = null) {
  for (const item of dom) {
    if (tagFilter && !tagFilter.includes(item.tag)) continue;
    const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.className]
      .map(s => (s || '').toLowerCase()).join(' ');
    for (const m of matchers) {
      if (typeof m === 'string' ? hay.includes(m) : m.test(hay)) return item;
    }
  }
  return null;
}

/**
 * Find ONLY text-input or textarea elements (never buttons, radios, links, etc.)
 */
function findInputEl(dom, matchers) {
  const INPUT_TYPES = ['text', 'search', 'tel', 'email', 'number', 'date', 'password', ''];
  for (const item of dom) {
    if (item.tag !== 'input' && item.tag !== 'textarea') continue;
    if (!INPUT_TYPES.includes((item.type || '').toLowerCase())) continue;
    const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.className]
      .map(s => (s || '').toLowerCase()).join(' ');
    for (const m of matchers) {
      if (typeof m === 'string' ? hay.includes(m) : m.test(hay)) return item;
    }
  }
  return null;
}

/** Find elements with specific ARIA role (options in autocomplete dropdowns, tabs, etc.) */
function findRoleEl(dom, role, textHints) {
  for (const item of dom) {
    if ((item.role || '').toLowerCase() !== role) continue;
    if (!textHints || textHints.length === 0) return item;
    const hay = (item.text || item.ariaLabel || '').toLowerCase();
    for (const hint of textHints) {
      if (typeof hint === 'string' ? hay.includes(hint.toLowerCase()) : hint.test(hay)) return item;
    }
  }
  return null;
}

/** True if element has a non-empty current value */
function isFilled(el) {
  return el && el.liveValue && el.liveValue.trim().length > 0;
}

/** Extract origin and destination station codes from goal */
function extractStations(goal) {
  let origin = null, dest = null;
  const betweenMatch = goal.match(/between\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)?)\s+and\s+([A-Za-z0-9]+)/i);
  if (betweenMatch) {
    origin = betweenMatch[1].trim().split(/\s+/)[0].toUpperCase();
    dest   = betweenMatch[2].trim().split(/\s+/)[0].toUpperCase();
  } else {
    const fromMatch = goal.match(/from\s+([A-Za-z0-9]+)\s+to\s+([A-Za-z0-9]+)/i);
    if (fromMatch) {
      origin = fromMatch[1].trim().toUpperCase();
      dest   = fromMatch[2].trim().toUpperCase();
    }
  }
  return { origin, dest };
}

/** Tomorrow's date as DD/MM/YYYY */
function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 1: IRCTC Train Search
// Sequence: type From → click From autocomplete option → type To → click To autocomplete
//           → set Date → click Search
// ─────────────────────────────────────────────────────────────────────────────
function handleIRCTC(goal, dom) {
  const { origin, dest } = extractStations(goal);

  // ── Strict field finders using precise aria-label / placeholder patterns ──
  // IRCTC labels: "Enter From station. Input is Mandatory." / "Enter To station."
  const fromEl = findInputEl(dom, [
    /enter\s+from\s+station/i,
    /from\s+station/i,
    /origin\s+station/i,
    /boarding\s+station/i,
    /from.*mandatory/i
  ]);

  const toEl = findInputEl(dom, [
    /enter\s+to\s+station/i,
    /to\s+station/i,
    /destination\s+station/i,
    /arrival\s+station/i,
    /to.*mandatory/i
  ]);

  const dateEl = findInputEl(dom, [
    /journey\s+date/i,
    /date\s+of\s+journey/i,
    /travel\s+date/i,
    /departure\s+date/i,
    /jrny.*date/i
  ]);

  // Autocomplete option elements (role="option") — appear after typing in a field
  const autocompleteOption = findRoleEl(dom, 'option', []) ||
    findEl(dom, [/autocomplete.*item|p-autocomplete-item|station.*option/i], ['li', 'span']) ||
    findEl(dom, ['.p-autocomplete-item', 'ui-autocomplete-item'], ['li']);

  // Search/Submit button (not an input — it's a real button)
  const searchBtn = findEl(dom, [
    /\bsearch\s+train/i,
    /find\s+train/i,
    /search\b/i,
    /get.*availability/i
  ], ['button', 'a', 'span']);

  // ── STEP 1: Type origin station if From field is empty ──
  if (fromEl && !isFilled(fromEl) && origin) {
    return mk('type', fromEl.selector, origin, null,
      `Typing origin station "${origin}" into From field (step 1 of 5).`, false, 0.99);
  }

  // ── STEP 2: Click autocomplete dropdown to confirm From station ──
  // After typing, IRCTC shows a dropdown — we must click it before moving to To
  if (fromEl && isFilled(fromEl) && autocompleteOption) {
    return mk('click', autocompleteOption.selector, null, null,
      `Clicking autocomplete suggestion to confirm origin station "${fromEl.liveValue}".`, false, 0.99);
  }

  // ── STEP 3: Type destination station if To field is empty ──
  if (toEl && !isFilled(toEl) && dest) {
    return mk('type', toEl.selector, dest, null,
      `Typing destination station "${dest}" into To field (step 3 of 5).`, false, 0.99);
  }

  // ── STEP 4: Click autocomplete to confirm To station ──
  if (toEl && isFilled(toEl) && autocompleteOption) {
    return mk('click', autocompleteOption.selector, null, null,
      `Clicking autocomplete suggestion to confirm destination station "${toEl.liveValue}".`, false, 0.99);
  }

  // ── STEP 5: Set journey date if empty ──
  if (dateEl && !isFilled(dateEl)) {
    return mk('type', dateEl.selector, tomorrowDate(), null,
      `Setting journey date to tomorrow: ${tomorrowDate()}.`, false, 0.98);
  }

  // ── STEP 6: Click Search ──
  if (searchBtn) {
    return mk('click', searchBtn.selector, null, null,
      `Origin and destination confirmed. Clicking Search to find trains.`, true, 0.99);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: India Post Consignment Tracking
// Sequence: type consignment ID → captcha (pause for user) → click Search/Evaluate
// Context: captchaSolved=true skips the pause and goes straight to clicking submit
// ─────────────────────────────────────────────────────────────────────────────
function handleIndiaPost(goal, dom, context = {}) {
  const codeMatch =
    goal.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/i) ||
    goal.match(/consignment\s*id[:\s]+([A-Za-z0-9]+)/i) ||
    goal.match(/id[:\s]+([A-Za-z0-9]{10,25})\b/i);
  const code = codeMatch ? codeMatch[1].toUpperCase() : null;

  // Find the text input for consignment — explicitly exclude radio/checkbox/submit
  const consignmentInput = dom.find(item => {
    if (item.tag !== 'input') return false;
    if (['radio','checkbox','submit','button','hidden','file','reset','image'].includes((item.type||'').toLowerCase())) return false;
    const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.className]
      .map(s=>(s||'').toLowerCase()).join(' ');
    return /consign|article\s*no|tracking|awb|barcode/i.test(hay);
  });

  // Step 1: Type consignment ID if field is empty
  if (consignmentInput && !isFilled(consignmentInput) && code) {
    return mk('type', consignmentInput.selector, code, null,
      `Typing consignment ID "${code}" into the Article/Consignment Number text input.`, false, 0.99);
  }

  // Helper to find India Post Track/Submit button (excluding refresh/reload buttons)
  const findIndiaPostSubmit = () => {
    return dom.find(item => {
      if (!['button', 'input', 'a'].includes(item.tag)) return false;
      const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.value, item.className]
        .map(s => (s || '').toLowerCase()).join(' ');

      // Strictly ignore captcha refresh / reset / reload buttons
      if (/refresh|reload|reset|captcha.*ref|ref.*captcha/i.test(hay)) return false;

      // Must match track / evaluate / search / submit
      return /track\s*now|evaluate|search|submit|\bgo\b|btnsearch/i.test(hay);
    });
  };

  // If captchaSolved=true, user has already solved the captcha → click submit immediately
  if (context.captchaSolved) {
    const submitBtn = findIndiaPostSubmit();
    if (submitBtn) {
      return mk('click', submitBtn.selector, null, null,
        `Captcha solved by user. Clicking Submit/Track to fetch delivery status.`, true, 0.99);
    }
  }

  // Step 2: Detect captcha field — ONLY if not yet filled
  const captchaInput = findInputEl(dom, [
    /captcha/i,
    /security\s*code/i,
    /evaluate.*expression/i,
    /enter.*image/i,
    /type.*characters/i,
    /verification\s*code/i
  ]);

  if (captchaInput && !isFilled(captchaInput)) {
    return mk('type', captchaInput.selector, '__CAPTCHA_REQUIRED__', null,
      `Captcha field detected and empty — user must solve it manually.`, false, 0.99);
  }

  // Step 3: Click submit/evaluate (captcha must be filled now)
  const submitBtn = findIndiaPostSubmit();
  if (submitBtn) {
    return mk('click', submitBtn.selector, null, null,
      `Consignment ID entered. Clicking Submit to fetch delivery status.`, true, 0.99);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 3: Parivahan — Driving License
// Only searches <input> elements for sensitive fields — never links or buttons
// ─────────────────────────────────────────────────────────────────────────────
function handleParivahan(goal, dom) {
  // State dropdown (actual <select> element)
  const stateSelect = dom.find(item =>
    item.tag === 'select' &&
    /state|rto/i.test([item.id,item.name,item.ariaLabel,item.placeholder].join(' '))
  );
  if (stateSelect && !isFilled(stateSelect)) {
    return mk('click', stateSelect.selector, null, null,
      `Opening state dropdown to select your state before DL services.`, false, 0.97);
  }

  // DL Number — MUST be an <input> element
  const dlInput = findInputEl(dom, [
    /driving\s*licen/i,
    /dl\s*no/i,
    /dl\s*number/i,
    /license\s*no/i,
    /licence\s*no/i,
    /license\s*number/i
  ]);
  if (dlInput && !isFilled(dlInput)) {
    return mk('type', dlInput.selector, null, 'drivingLicense',
      `Filling Driving License number from local profile.`, false, 0.99);
  }

  // Date of Birth — MUST be an <input> element
  const dobInput = findInputEl(dom, [
    /date\s*of\s*birth/i,
    /\bdob\b/i,
    /d\.o\.b/i,
    /birth\s*date/i
  ]);
  if (dobInput && !isFilled(dobInput)) {
    return mk('type', dobInput.selector, null, 'dateOfBirth',
      `Filling Date of Birth from local profile.`, false, 0.99);
  }

  // Submit button
  const submitBtn = findEl(dom, [
    /get\s*dl\s*details/i,
    /proceed/i,
    /continue/i,
    /submit/i,
    /verify/i
  ], ['button','input','a']);
  if (submitBtn) {
    return mk('click', submitBtn.selector, null, null,
      `DL number and DOB filled. Clicking submit.`, true, 0.99);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// TASK 4: ECI Electoral Roll Search
// ─────────────────────────────────────────────────────────────────────────────
function handleECI(goal, dom, context = {}) {
  // If on main landing page voters.eci.gov.in, click "Search in Electoral Roll" link/card
  const searchRollLink = findEl(dom, [/search\s+in\s+electoral\s+roll/i, /electoral\s+search/i], ['a', 'button', 'div']);
  if (searchRollLink && !dom.some(d => (d.id || d.name || d.placeholder || '').toLowerCase().includes('epic'))) {
    return mk('click', searchRollLink.selector, null, null,
      `Clicking "Search in Electoral Roll" link.`, false, 0.98);
  }

  // EPIC tab button (if not already active)
  const epicTab = findEl(dom, [/search\s*by\s*epic/i, /epic\s*number/i], ['button','a','li','div']);
  if (epicTab && (epicTab.tag === 'button' || epicTab.tag === 'a' || epicTab.role === 'tab')) {
    return mk('click', epicTab.selector, null, null,
      `Clicking "Search by EPIC" tab.`, false, 0.98);
  }

  // State <select> (if present and empty)
  const stateSelect = dom.find(item =>
    item.tag === 'select' &&
    /state/i.test([item.id,item.name,item.ariaLabel,item.placeholder].join(' '))
  );
  if (stateSelect && !isFilled(stateSelect)) {
    return mk('click', stateSelect.selector, null, null,
      `Opening state dropdown before EPIC search.`, false, 0.97);
  }

  // Extract EPIC from goal text if provided in prompt
  const epicMatch = goal.match(/\b([A-Z]{3}\d{7})\b/i) || goal.match(/epic[:\s]+([A-Za-z0-9]+)/i);
  const goalEpic = epicMatch ? epicMatch[1].toUpperCase() : null;

  // EPIC number input
  const epicInput = findInputEl(dom, [/epic/i, /voter\s*id/i, /voter\s*card/i, /elector/i]);
  if (epicInput && !isFilled(epicInput)) {
    return mk('type', epicInput.selector, goalEpic, goalEpic ? null : 'epic',
      `Filling EPIC Voter ID "${goalEpic || 'from profile'}".`, false, 0.99);
  }

  // Helper to find ECI Search button (excluding captcha refresh)
  const findEciSubmit = () => {
    return dom.find(item => {
      if (!['button', 'input', 'a'].includes(item.tag)) return false;
      const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.value, item.className]
        .map(s => (s || '').toLowerCase()).join(' ');
      if (/refresh|reload|reset|captcha.*ref/i.test(hay)) return false;
      return /\bsearch\b|find|submit/i.test(hay);
    });
  };

  // If captchaSolved=true, skip captcha pause and click submit
  if (context.captchaSolved) {
    const submitBtn = findEciSubmit();
    if (submitBtn) {
      return mk('click', submitBtn.selector, null, null,
        `Captcha solved by user. Clicking Search to find voter record.`, true, 0.99);
    }
  }

  // Captcha input
  const captchaInput = findInputEl(dom, [/captcha/i, /security\s*code/i, /verification/i]);
  if (captchaInput && !isFilled(captchaInput)) {
    return mk('type', captchaInput.selector, '__CAPTCHA_REQUIRED__', null,
      `Captcha required — user must solve it.`, false, 0.99);
  }

  const searchBtn = findEciSubmit();
  if (searchBtn) {
    return mk('click', searchBtn.selector, null, null,
      `EPIC filled. Clicking Search.`, true, 0.99);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 5: UIDAI Aadhaar Enrolment Status
// ─────────────────────────────────────────────────────────────────────────────
function handleUIDAI(goal, dom, context = {}) {
  const enrolMatch =
    goal.match(/\b(\d{14})\b/) ||
    goal.match(/enrolment\s*id[:\s]+([\d\s\/]+)/i);
  const enrolId = enrolMatch ? enrolMatch[1].replace(/[\s\/]/g,'') : null;

  const enrolInput = findInputEl(dom, [
    /enrol+ment/i,
    /\bsrn\b/i,
    /\burn\b/i,
    /\beid\b/i,
    /aadhaar.*id/i,
    /enrol.*id/i
  ]);
  if (enrolInput && !isFilled(enrolInput)) {
    return mk('type', enrolInput.selector, enrolId, enrolId ? null : 'enrolmentId',
      `Typing Aadhaar Enrolment ID "${enrolId||'from profile'}".`, false, 0.99);
  }

  const findUidaiSubmit = () => {
    return dom.find(item => {
      if (!['button', 'input', 'a'].includes(item.tag)) return false;
      const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.value, item.className]
        .map(s => (s || '').toLowerCase()).join(' ');
      if (/refresh|reload|reset|captcha.*ref/i.test(hay)) return false;
      return /submit|check.*status|get.*status|verify|proceed/i.test(hay);
    });
  };

  if (context.captchaSolved) {
    const submitBtn = findUidaiSubmit();
    if (submitBtn) return mk('click', submitBtn.selector, null, null,
      `Captcha solved. Clicking Submit to check status.`, true, 0.99);
  }

  const captchaInput = findInputEl(dom, [/captcha/i, /security\s*code/i, /text.*image/i]);
  if (captchaInput && !isFilled(captchaInput)) {
    return mk('type', captchaInput.selector, '__CAPTCHA_REQUIRED__', null,
      `Captcha required — user must solve it.`, false, 0.99);
  }

  const submitBtn = findUidaiSubmit();
  if (submitBtn) {
    return mk('click', submitBtn.selector, null, null,
      `Enrolment ID entered. Clicking Submit.`, true, 0.99);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 6: DigiLocker — Download Issued Documents / Fetch Documents
// ─────────────────────────────────────────────────────────────────────────────
function handleDigiLocker(goal, dom, context = {}) {
  const g = goal.toLowerCase();

  // 1. Detect DigiLocker OTP / PIN authentication prompt
  const otpInput = findInputEl(dom, [/otp/i, /pin/i, /security\s*code/i, /one\s*time\s*password/i]);
  if (otpInput && !isFilled(otpInput)) {
    return mk('type', otpInput.selector, '__CAPTCHA_REQUIRED__', null,
      `DigiLocker OTP / PIN input detected — user must enter the OTP/PIN manually in the browser.`, false, 0.99);
  }

  // 2. If user solved OTP / PIN intervention, click Verify / Submit OTP button
  if (context.captchaSolved) {
    const verifyBtn = findEl(dom, [/verify|submit|continue|sign\s*in|login/i], ['button', 'input', 'a']);
    if (verifyBtn) {
      return mk('click', verifyBtn.selector, null, null,
        `OTP entered by user. Clicking Verify / Submit to log into DigiLocker.`, false, 0.99);
    }
  }

  // 3. Check if we are already seeing document cards/rows (Aadhaar, Driving License, etc.)
  const hasDocumentCards = dom.some(item => {
    const text = (item.text || item.ariaLabel || item.id || item.className || '').toLowerCase();
    return /aadhaar|licen|marksheet|vehicle|registration|issued/i.test(text);
  });

  // Only click "Issued Documents" tab if no document cards are present yet
  if (!hasDocumentCards) {
    const issuedTab = findEl(dom, [/issued\s*documents/i, /issued\s*doc/i, /my\s*documents/i], ['a', 'button', 'li', 'span', 'div']);
    if (issuedTab) {
      return mk('click', issuedTab.selector, null, null,
        `Navigating to "Issued Documents" tab in DigiLocker.`, false, 0.98);
    }
  }

  // 4. Target specific document requested in goal (Aadhaar, Driving License, Marksheet, etc.)
  let targetKeyword = 'aadhaar';
  if (/license|dl\b/i.test(g)) targetKeyword = 'license';
  else if (/marksheet|class\s*10|class\s*12|cbse/i.test(g)) targetKeyword = 'marksheet';
  else if (/vehicle|rc\b|registration/i.test(g)) targetKeyword = 'registration';
  else if (/pan\b/i.test(g)) targetKeyword = 'pan';

  // Search for direct PDF download button or link for the target document
  const downloadPdfBtn = dom.find(item => {
    const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.className, item.href, item.title]
      .map(s => (s || '').toLowerCase()).join(' ');

    const isPdfOrDownload = /pdf|download|save|export|btn-pdf|icon-pdf|file-pdf|action-pdf/i.test(hay);
    if (!isPdfOrDownload) return false;

    return new RegExp(targetKeyword, 'i').test(hay) || /issued|document|card|file|aadhaar/i.test(hay);
  });

  if (downloadPdfBtn) {
    return mk('click', downloadPdfBtn.selector, null, null,
      `Clicking Download PDF button for ${targetKeyword.toUpperCase()} in DigiLocker.`, true, 0.99);
  }

  // DigiLocker 3-dots / action menu button next to the target document
  const actionMenuBtn = dom.find(item => {
    const hay = [item.id, item.name, item.ariaLabel, item.text, item.className, item.title]
      .map(s => (s || '').toLowerCase()).join(' ');
    const isMenuIcon = /dots|menu|option|ellipsis|more|action|dropdown/i.test(hay);
    return isMenuIcon && (new RegExp(targetKeyword, 'i').test(hay) || /aadhaar|doc/i.test(hay));
  });

  if (actionMenuBtn) {
    return mk('click', actionMenuBtn.selector, null, null,
      `Clicking document options menu for ${targetKeyword.toUpperCase()} in DigiLocker.`, false, 0.98);
  }

  // Fallback: Any PDF / Download link or button on the page
  const fallbackDownload = findEl(dom, [/pdf/i, /download/i, /get\s*pdf/i, /save/i], ['button', 'a', 'span', 'i', 'div']);
  if (fallbackDownload) {
    return mk('click', fallbackDownload.selector, null, null,
      `Clicking PDF Download button on DigiLocker page.`, true, 0.95);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY HELPER
// ─────────────────────────────────────────────────────────────────────────────
function mk(action, selector, value, valueSource, reasoning, final, confidence) {
  return { action, selector, value, valueSource, reasoning, final, confidence };
}

module.exports = { routeTask };
