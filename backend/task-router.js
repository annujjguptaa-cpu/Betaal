/* backend/task-router.js
 *
 * Deterministic Task Router — bypasses the LLM for known multi-step portal workflows.
 * Matches the goal against known patterns, then inspects the live DOM to return the
 * exact correct next action — no model hallucination possible.
 *
 * Supported task patterns:
 *   1. IRCTC train search (NDLS ↔ BCT etc.)
 *   2. India Post consignment tracking
 *   3. Parivahan / Sarathi driving license
 *   4. ECI voter roll search (EPIC)
 *   5. UIDAI Aadhaar enrolment status
 */

/**
 * Try to match the goal to a known task and return the deterministic next action.
 * Returns null if no known pattern matches (LLM fallback will handle it).
 *
 * @param {string} goal
 * @param {Array<Object>} dom  - live DOM from content.js
 * @returns {{ action, selector, value, valueSource, reasoning, final, confidence } | null}
 */
function routeTask(goal, dom) {
  if (!goal || !Array.isArray(dom)) return null;
  const g = goal.toLowerCase();

  // ─────────────────────────────────────────────────────────
  // TASK 1 — IRCTC Train Search
  // ─────────────────────────────────────────────────────────
  if (/irctc|train|ndls|bct|mmct|rajdhani|shatabdi/.test(g) || /search.*train|train.*between|trains.*from/.test(g)) {
    return handleIRCTC(goal, dom);
  }

  // ─────────────────────────────────────────────────────────
  // TASK 2 — India Post Consignment Tracking
  // ─────────────────────────────────────────────────────────
  if (/india post|consignment|parcel|tracking|track.*delivery|delivery.*status/.test(g)) {
    return handleIndiaPost(goal, dom);
  }

  // ─────────────────────────────────────────────────────────
  // TASK 3 — Parivahan / Driving License
  // ─────────────────────────────────────────────────────────
  if (/driving licen|parivahan|sarathi|dl renewal|dl services|driving license/.test(g)) {
    return handleParivahan(goal, dom);
  }

  // ─────────────────────────────────────────────────────────
  // TASK 4 — ECI Voter / Electoral Roll
  // ─────────────────────────────────────────────────────────
  if (/voter|electoral|epic|eci|nvsp|voter.*roll|voter.*card/.test(g)) {
    return handleECI(goal, dom);
  }

  // ─────────────────────────────────────────────────────────
  // TASK 5 — UIDAI Aadhaar Enrolment Status
  // ─────────────────────────────────────────────────────────
  if (/aadhaar|uidai|enrolment|enrollment|aadhar status/.test(g)) {
    return handleUIDAI(goal, dom);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Find the first DOM element matching one of the given attribute patterns */
function findEl(dom, matchers) {
  for (const item of dom) {
    const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.className]
      .map(s => (s || '').toLowerCase()).join(' ');
    for (const m of matchers) {
      if (typeof m === 'string' ? hay.includes(m) : m.test(hay)) {
        return item;
      }
    }
  }
  return null;
}

/** True if the element exists and its liveValue is non-empty */
function isFilled(el) {
  return el && el.liveValue && el.liveValue.trim().length > 0;
}

/** Extract a station code or name from the goal string */
function extractStations(goal) {
  // "trains between NDLS and BCT" / "from NDLS to BCT"
  let origin = null, dest = null;

  const betweenMatch = goal.match(/between\s+([A-Za-z0-9\s]+?)\s+and\s+([A-Za-z0-9\s]+?)(?:\s+for|\s+on|\s*$)/i);
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

/** Extract a date for tomorrow formatted as DD/MM/YYYY */
function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 1: IRCTC
// Step order: fill From → fill To → set Date → click Search
// ─────────────────────────────────────────────────────────────────────────────
function handleIRCTC(goal, dom) {
  const { origin, dest } = extractStations(goal);

  // Origin field — look for "from", "origin", "stn" in empty inputs
  const fromEl = findEl(dom, ['from', 'origin', 'source station', 'boarding', 'from station']);
  const toEl   = findEl(dom, ['to', 'destination', 'to station', 'arrival']);
  const dateEl = findEl(dom, ['journey date', 'date of journey', 'travel date', 'departure date', 'date', 'jrny date']);
  const searchBtn = findEl(dom, ['search', 'find trains', 'get trains', 'check availability']);

  // Step 1: Fill "From" if empty
  if (fromEl && !isFilled(fromEl) && origin) {
    return {
      action: 'type',
      selector: fromEl.selector,
      value: origin,
      valueSource: null,
      reasoning: `Typing origin station code "${origin}" into the From/Origin field. Must fill this before searching.`,
      final: false,
      confidence: 0.99
    };
  }

  // Step 2: Fill "To" if empty (origin is already filled)
  if (toEl && !isFilled(toEl) && dest) {
    return {
      action: 'type',
      selector: toEl.selector,
      value: dest,
      valueSource: null,
      reasoning: `Typing destination station code "${dest}" into the To/Destination field.`,
      final: false,
      confidence: 0.99
    };
  }

  // Step 3: Set date if empty
  if (dateEl && !isFilled(dateEl)) {
    return {
      action: 'type',
      selector: dateEl.selector,
      value: tomorrowDate(),
      valueSource: null,
      reasoning: `Setting journey date to tomorrow: ${tomorrowDate()}.`,
      final: false,
      confidence: 0.98
    };
  }

  // Step 4: Click Search
  if (searchBtn) {
    return {
      action: 'click',
      selector: searchBtn.selector,
      value: null,
      valueSource: null,
      reasoning: `Origin and destination are filled. Clicking Search to find trains.`,
      final: true,
      confidence: 0.99
    };
  }

  return null; // fallback to LLM if page structure is unexpected
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: India Post Tracking
// Step order: type consignment ID → solve captcha (skip) → click track/search
// ─────────────────────────────────────────────────────────────────────────────
function handleIndiaPost(goal, dom) {
  // Extract consignment code from goal
  const codeMatch = goal.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/i)    // EY567991513IN pattern
    || goal.match(/consignment\s+id[:\s]+([A-Za-z0-9]+)/i)
    || goal.match(/id[:\s]+([A-Za-z0-9]{10,25})\b/i);
  const code = codeMatch ? codeMatch[1].toUpperCase() : null;

  // Find consignment input — NOT radio button, NOT article checkbox
  const consignmentInput = dom.find(item => {
    if (item.tag !== 'input') return false;
    if (['radio', 'checkbox', 'submit', 'button', 'hidden'].includes(item.type)) return false;
    const hay = [item.id, item.name, item.placeholder, item.ariaLabel, item.text, item.className]
      .map(s => (s || '').toLowerCase()).join(' ');
    return /consign|article|tracking|awb|barcode|number|track/i.test(hay);
  });

  // If consignment input found and not yet filled
  if (consignmentInput && !isFilled(consignmentInput) && code) {
    return {
      action: 'type',
      selector: consignmentInput.selector,
      value: code,
      valueSource: null,
      reasoning: `Typing consignment tracking ID "${code}" into the consignment number input (not radio button).`,
      final: false,
      confidence: 0.99
    };
  }

  // Captcha field — pause for user
  const captchaInput = findEl(dom, ['captcha', 'security code', 'evaluate', 'expression', 'verify']);
  if (captchaInput && !isFilled(captchaInput)) {
    // We cannot solve captcha — signal to loop to pause
    return {
      action: 'type',
      selector: captchaInput.selector,
      value: '__CAPTCHA_REQUIRED__',
      valueSource: null,
      reasoning: `Captcha input detected. Agent cannot solve visual captcha — user must type the captcha answer manually.`,
      final: false,
      confidence: 0.99
    };
  }

  // Click the track/search button
  const trackBtn = findEl(dom, ['track', 'search', 'evaluate', 'submit', 'go', 'check']);
  if (trackBtn) {
    return {
      action: 'click',
      selector: trackBtn.selector,
      value: null,
      valueSource: null,
      reasoning: `Consignment ID filled. Clicking Track/Search button to fetch delivery status.`,
      final: true,
      confidence: 0.99
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 3: Parivahan — Driving License
// Step order: select state → click DL service → fill DL number → fill DOB → submit
// ─────────────────────────────────────────────────────────────────────────────
function handleParivahan(goal, dom) {
  // State dropdown
  const stateSelect = findEl(dom, ['state', 'select state', 'choose state', 'rto state']);
  if (stateSelect && stateSelect.tag === 'select' && !isFilled(stateSelect)) {
    return {
      action: 'click',
      selector: stateSelect.selector,
      value: null,
      valueSource: null,
      reasoning: `Opening state dropdown to select your state before proceeding to DL services.`,
      final: false,
      confidence: 0.97
    };
  }

  // DL Number input
  const dlInput = findEl(dom, ['driving licence', 'driving license', 'dl number', 'licence number', 'dl no', 'license no']);
  if (dlInput && !isFilled(dlInput)) {
    return {
      action: 'type',
      selector: dlInput.selector,
      value: null,
      valueSource: 'drivingLicense',
      reasoning: `Filling Driving License number from local profile — never sent over network.`,
      final: false,
      confidence: 0.99
    };
  }

  // Date of Birth input
  const dobInput = findEl(dom, ['date of birth', 'dob', 'd.o.b', 'birth date', 'born']);
  if (dobInput && !isFilled(dobInput)) {
    return {
      action: 'type',
      selector: dobInput.selector,
      value: null,
      valueSource: 'dateOfBirth',
      reasoning: `Filling Date of Birth from local profile — never sent over network.`,
      final: false,
      confidence: 0.99
    };
  }

  // Submit
  const submitBtn = findEl(dom, ['get dl details', 'proceed', 'continue', 'submit', 'verify']);
  if (submitBtn) {
    return {
      action: 'click',
      selector: submitBtn.selector,
      value: null,
      valueSource: null,
      reasoning: `DL number and DOB filled. Clicking submit to fetch DL details.`,
      final: true,
      confidence: 0.99
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 4: ECI Voter / Electoral Roll Search
// Step order: click "Search by EPIC" tab → select state → fill EPIC → fill captcha → click Search
// ─────────────────────────────────────────────────────────────────────────────
function handleECI(goal, dom) {
  // EPIC tab
  const epicTab = findEl(dom, ['search by epic', 'epic number', 'epic no', 'voter id']);
  if (epicTab && (epicTab.tag === 'button' || epicTab.tag === 'a' || epicTab.role === 'tab')) {
    return {
      action: 'click',
      selector: epicTab.selector,
      value: null,
      valueSource: null,
      reasoning: `Clicking "Search by EPIC" tab to search by Voter ID card number.`,
      final: false,
      confidence: 0.98
    };
  }

  // State dropdown
  const stateSelect = findEl(dom, ['select state', 'state', 'choose state']);
  if (stateSelect && stateSelect.tag === 'select' && !isFilled(stateSelect)) {
    return {
      action: 'click',
      selector: stateSelect.selector,
      value: null,
      valueSource: null,
      reasoning: `Opening state dropdown before EPIC search.`,
      final: false,
      confidence: 0.97
    };
  }

  // EPIC number input
  const epicInput = findEl(dom, ['epic', 'voter id', 'voter card', 'epic no', 'voter number', 'elector']);
  if (epicInput && epicInput.tag === 'input' && !isFilled(epicInput)) {
    return {
      action: 'type',
      selector: epicInput.selector,
      value: null,
      valueSource: 'epic',
      reasoning: `Filling EPIC/Voter ID from local profile — never sent over network.`,
      final: false,
      confidence: 0.99
    };
  }

  // Captcha
  const captchaInput = findEl(dom, ['captcha', 'security code', 'verification code', 'verify']);
  if (captchaInput && !isFilled(captchaInput)) {
    return {
      action: 'type',
      selector: captchaInput.selector,
      value: '__CAPTCHA_REQUIRED__',
      valueSource: null,
      reasoning: `Captcha required. Agent paused — user must type captcha manually.`,
      final: false,
      confidence: 0.99
    };
  }

  // Search button
  const searchBtn = findEl(dom, ['search', 'find', 'submit', 'go']);
  if (searchBtn) {
    return {
      action: 'click',
      selector: searchBtn.selector,
      value: null,
      valueSource: null,
      reasoning: `EPIC number filled. Clicking Search to look up voter details.`,
      final: true,
      confidence: 0.99
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 5: UIDAI Aadhaar Enrolment Status
// Step order: fill enrolment ID → fill captcha → click submit
// ─────────────────────────────────────────────────────────────────────────────
function handleUIDAI(goal, dom) {
  // Extract 14-digit enrolment ID from goal if present
  const enrolMatch = goal.match(/\b(\d{4}[\s\/]?\d{5}[\s\/]?\d{5})\b/) // 14-digit
    || goal.match(/enrolment\s+id[:\s]+(\d[\d\s\/]+)/i)
    || goal.match(/\b(\d{14})\b/);
  const enrolId = enrolMatch ? enrolMatch[1].replace(/[\s\/]/g, '') : null;

  // Enrolment ID input
  const enrolInput = findEl(dom, ['enrolment', 'enrollment', 'srn', 'urn', 'eid', 'enrolment id', 'reference']);
  if (enrolInput && !isFilled(enrolInput)) {
    return {
      action: 'type',
      selector: enrolInput.selector,
      value: enrolId,
      valueSource: enrolId ? null : 'enrolmentId',
      reasoning: `Typing Aadhaar Enrolment ID "${enrolId || '(from profile)'}" into the enrolment status input.`,
      final: false,
      confidence: 0.99
    };
  }

  // Captcha
  const captchaInput = findEl(dom, ['captcha', 'security code', 'verification', 'text in image']);
  if (captchaInput && !isFilled(captchaInput)) {
    return {
      action: 'type',
      selector: captchaInput.selector,
      value: '__CAPTCHA_REQUIRED__',
      valueSource: null,
      reasoning: `Captcha required. Agent paused — user must type captcha manually.`,
      final: false,
      confidence: 0.99
    };
  }

  // Submit
  const submitBtn = findEl(dom, ['submit', 'check status', 'get status', 'verify', 'proceed']);
  if (submitBtn) {
    return {
      action: 'click',
      selector: submitBtn.selector,
      value: null,
      valueSource: null,
      reasoning: `Enrolment ID filled. Clicking Submit to check Aadhaar status.`,
      final: true,
      confidence: 0.99
    };
  }

  return null;
}

module.exports = { routeTask };
