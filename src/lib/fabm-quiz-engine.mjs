// FABM quiz shared engine. Pure logic + data extracted verbatim from the
// pre-split single-page quiz, so the /start/ wizard and /results/ page compute
// identical matches. No DOM at import time; browser globals (crypto,
// sessionStorage, navigator) are touched only inside called functions.
/* eslint-disable */

export const QUESTIONS = [
  {
    id: "goal",
    q: "What is your main goal right now?",
    options: [
      { v: "avoid", label: "Avoid pregnancy", icon: "calendar" },
      { v: "conceive", label: "Trying to conceive", icon: "pregnant" },
      {
        v: "health",
        label: "Understand my cycles or reproductive health",
        icon: "female-reproductive_system",
      },
    ],
  },
  {
    id: "cycles",
    q: "How regular are your cycles?",
    options: [
      { v: "regular", label: "Usually 26 to 32 days and predictable", icon: "calendar" },
      { v: "irregular", label: "Irregular or hard to predict", icon: "question-circle" },
      { v: "vary", label: "I have not really tracked them", icon: "question-mark" },
    ],
  },
  {
    id: "postpartum",
    q: "Have you given birth in the past year, or are you currently breastfeeding?",
    options: [
      { v: "yes", label: "Yes", icon: "baby-0306m" },
      { v: "no", label: "No", icon: "no" },
    ],
  },
  {
    id: "offbc",
    q: "Have you recently come off hormonal birth control (pill, IUD, implant, or shot)?",
    options: [
      { v: "yes", label: "Yes, within the last few months", icon: "family-planning" },
      { v: "no", label: "No", icon: "no" },
    ],
  },
  {
    id: "effort",
    q: "How much daily tracking are you up for?",
    options: [
      { v: "simplest", label: "Keep it as simple as possible", icon: "low-bars" },
      { v: "moderate", label: "A quick daily check is fine", icon: "medium-bars" },
      { v: "detailed", label: "I am happy to chart in detail", icon: "high-bars" },
    ],
  },
  {
    id: "femtech",
    q: "Do you currently use any cycle-tracking app or device?",
    options: [
      { v: "app", label: "Yes, an app (like Flo, Clue, or Natural Cycles)", icon: "mobile" },
      {
        v: "wearable",
        label: "Yes, a wearable or device (like Oura or Tempdrop)",
        icon: "pulse-oximeter",
      },
      { v: "none", label: "No, not right now", icon: "no" },
    ],
  },
  {
    id: "device",
    q: "How do you feel about using a device or test strips?",
    options: [
      { v: "none", label: "I would rather use no devices at all", icon: "no" },
      { v: "thermometer", label: "A simple thermometer is fine", icon: "thermometer" },
      {
        v: "monitor",
        label: "An electronic monitor or test strips are fine",
        icon: "blood-pressure_monitor",
      },
    ],
  },
  {
    id: "budget",
    q: "What about the cost of tools or test strips?",
    options: [
      { v: "lowest", label: "I want the lowest cost possible", icon: "coins" },
      { v: "some", label: "Some ongoing cost is fine", icon: "money-bag" },
    ],
  },
  {
    id: "clinical",
    q: "Would you like your chart to be read by a doctor to look for a cycle or fertility problem?",
    options: [
      { v: "yes", label: "Yes, that matters to me", icon: "stethoscope" },
      { v: "no", label: "No, I just want family planning", icon: "home" },
    ],
  },
];

export const METHODS = {
  sdm: {
    name: "Standard Days Method",
    learn: "https://irh.org/",
    icon: "calendar",
    blurb: "a simple calendar method for predictable cycles",
  },
  twoday: {
    name: "TwoDay Method",
    learn: "https://irh.org/",
    icon: "blood-drop",
    blurb: "a simple daily check of cervical secretions",
  },
  billings: {
    name: "Billings Ovulation Method",
    learn: "https://www.woomb.org/",
    icon: "blood-drop",
    blurb: "a device-free method that reads cervical mucus",
  },
  creighton: {
    name: "Creighton Model FertilityCare System",
    learn: "https://www.fertilitycare.org/",
    icon: "female-reproductive_system",
    blurb: "a standardized mucus chart that doubles as a clinical record for NaProTechnology",
  },
  femm: {
    name: "FEMM",
    learn: "/femm/",
    icon: "stethoscope",
    blurb: "a cervical-mucus method with optional hormone tracking and a medical-management focus",
  },
  sensiplan: {
    name: "Sympto-Thermal Method (Sensiplan)",
    learn: "https://ccli.org/",
    icon: "thermometer",
    blurb: "a double-check of cervical mucus and waking temperature",
  },
  marquette: {
    name: "Marquette Model",
    learn: "https://www.marquette.edu/natural-family-planning/",
    icon: "blood-pressure_monitor",
    blurb: "an electronic monitor that reads your hormones",
  },
};

export const RULES = {
  goal: {
    conceive: {
      billings: 2,
      creighton: 2,
      femm: 1,
      sensiplan: 2,
      marquette: 2,
      sdm: -1,
      twoday: -1,
    },
    health: { creighton: 2, femm: 1, marquette: 1, sensiplan: 1, billings: 1, sdm: -1, twoday: -1 },
    avoid: { sdm: 1, twoday: 1 },
  },
  cycles: {
    regular: { sdm: 2, twoday: 1 },
    irregular: {
      sdm: -4,
      twoday: -1,
      billings: 2,
      creighton: 2,
      femm: 1,
      sensiplan: 1,
      marquette: 2,
    },
    vary: { sdm: -3, twoday: -1, billings: 1, creighton: 1, femm: 1, marquette: 2 },
  },
  postpartum: {
    yes: { sdm: -3, twoday: -1, marquette: 2, billings: 1, creighton: 1, femm: 1, sensiplan: -1 },
    no: {},
  },
  offbc: {
    yes: { sdm: -2, billings: 1, creighton: 1, femm: 1, sensiplan: 1, marquette: 1 },
    no: {},
  },
  effort: {
    simplest: { sdm: 3, twoday: 3, billings: -1, creighton: -3, femm: -3, sensiplan: -3 },
    moderate: { twoday: 1, billings: 1, femm: 2, marquette: 1 },
    detailed: { creighton: 2, sensiplan: 2, femm: 0, billings: 1 },
  },
  femtech: { app: { femm: 2 }, wearable: { sensiplan: 1 }, none: {} },
  device: {
    none: { billings: 2, creighton: 2, femm: 1, sdm: 1, twoday: 1, sensiplan: -2, marquette: -3 },
    thermometer: { sensiplan: 3, billings: 1 },
    monitor: { marquette: 3, sensiplan: 1, femm: 1 },
  },
  budget: {
    lowest: { sdm: 1, twoday: 1, billings: 1, creighton: 1, femm: 1, marquette: -6 },
    some: { marquette: 1 },
  },
  clinical: {
    yes: { creighton: 3, femm: 2, marquette: 1, sensiplan: 1, billings: 1, sdm: -2, twoday: -2 },
    no: {},
  },
};

export const RULES_VERSION = "v3-2026-07-02";

export const ACCESS_ORDER = ["twoday", "sdm", "billings", "creighton", "femm", "sensiplan", "marquette"];
export function tiebreakKey(m) {
  return ACCESS_ORDER.indexOf(m);
}

export const WHY_CLAUSES = {
  goal: {
    avoid: "you want to avoid pregnancy",
    conceive: "you are trying to conceive",
    health: "you want to understand your reproductive health",
  },
  cycles: {
    regular: "your cycles are usually regular",
    irregular: "your cycles are not always predictable",
    vary: "you are still getting to know your cycles",
  },
  postpartum: {
    yes: "you are postpartum or breastfeeding",
    no: "your cycles have settled into a typical pattern",
  },
  offbc: {
    yes: "you recently stopped hormonal birth control",
    no: "your cycles reflect your natural hormones",
  },
  effort: {
    simplest: "you want to keep tracking simple",
    moderate: "a quick daily check suits you",
    detailed: "you are happy to chart in detail",
  },
  femtech: {
    app: "you already use a cycle-tracking app",
    wearable: "you already use a wearable or device",
    none: "you are choosing your tools fresh",
  },
  device: {
    none: "you prefer no devices",
    thermometer: "you are fine using a simple thermometer",
    monitor: "you are comfortable with a monitor",
  },
  budget: {
    lowest: "you want the lowest cost possible",
    some: "some ongoing cost is fine",
  },
  clinical: {
    yes: "you want a doctor to be able to read your chart",
    no: "you want a straightforward family-planning method",
  },
};

// score() and buildWhy() take the answers object explicitly so both pages share
// one implementation (start page builds answers during the wizard; results page
// decodes them from the ?a= param). Logic is otherwise identical to the original.
export function score(answers) {
  const t = { sdm: 0, twoday: 0, billings: 0, creighton: 0, femm: 0, sensiplan: 0, marquette: 0 };
  Object.keys(answers).forEach(function (qid) {
    const d = (RULES[qid] || {})[answers[qid]] || {};
    Object.keys(d).forEach(function (m) {
      t[m] += d[m];
    });
  });
  const ranked = Object.keys(t).sort(function (a, b) {
    return t[b] !== t[a] ? t[b] - t[a] : tiebreakKey(a) - tiebreakKey(b);
  });
  return { primary: ranked[0], alternate: ranked[1], top: t[ranked[0]], second: t[ranked[1]] };
}

export function buildWhy(answers, primary) {
  const contribs = [];
  QUESTIONS.forEach(function (item, idx) {
    const qid = item.id;
    const val = answers[qid];
    if (!val) return;
    const delta = ((RULES[qid] || {})[val] || {})[primary] || 0;
    if (delta <= 0) return;
    const clause = (WHY_CLAUSES[qid] || {})[val];
    if (clause) contribs.push({ order: idx, delta: delta, clause: clause });
  });
  contribs.sort(function (a, b) {
    return b.delta !== a.delta ? b.delta - a.delta : a.order - b.order;
  });
  return contribs.slice(0, 3).map(function (c) {
    return c.clause;
  });
}

// Answer encoding for the cross-page URL handoff: one digit per question in
// QUESTIONS order, each the selected option's index. Fixed 9-digit string.
export function encodeAnswers(answers) {
  return QUESTIONS.map(function (item) {
    const idx = item.options.findIndex(function (o) {
      return o.v === answers[item.id];
    });
    return idx < 0 ? "" : String(idx);
  }).join("");
}

// Decode + validate: must be exactly QUESTIONS.length digits, each a valid
// option index for its question. Returns the answers map, or null if invalid.
export function decodeAnswers(code) {
  if (typeof code !== "string" || code.length !== QUESTIONS.length) return null;
  const out = {};
  for (let i = 0; i < QUESTIONS.length; i++) {
    const ch = code.charCodeAt(i);
    if (ch < 48 || ch > 57) return null;
    const idx = ch - 48;
    const opts = QUESTIONS[i].options;
    if (idx >= opts.length) return null;
    out[QUESTIONS[i].id] = opts[idx].v;
  }
  return out;
}

// Session id, sessionStorage-backed so a beacon fired on /start/ and one fired
// on /results/ share the same anonymous id. No PII, session-scoped.
const SID_KEY = "fabm-quiz-sid";
let sid = null;
export function ensureSid() {
  if (sid) return sid;
  try {
    const stored = sessionStorage.getItem(SID_KEY);
    if (stored) {
      sid = stored;
      return sid;
    }
  } catch (e) {}
  try {
    sid = crypto.randomUUID();
  } catch (e) {
    let s = "";
    for (let i = 0; i < 20; i++) {
      s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    }
    sid = "sid-" + s;
  }
  try {
    sessionStorage.setItem(SID_KEY, sid);
  } catch (e) {}
  return sid;
}

export function trackEvent(event, qid) {
  try {
    ensureSid();
    const payload = { sid: sid, event: event, rulesVersion: RULES_VERSION };
    if (qid) payload.qid = qid;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/quiz/event", body);
    } else {
      fetch("/api/quiz/event", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: body,
      });
    }
  } catch (e) {}
}
