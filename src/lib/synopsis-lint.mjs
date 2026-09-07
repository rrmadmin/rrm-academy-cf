// Deterministic pre-publish lint for a library synopsis (articles.insights).
// Encodes memory library-synopsis-standard + the leakage classes found in the
// 2026-09-06 review of the first three live synopses (arm/denominator drift,
// surname-as-agent, British spelling, lab values, drug protocols, length and
// reading-grade spread). Pure function, no I/O. Findings: { level, rule, where, detail }.

export const REQUIRED_KEYS = ['title', 'tldr', 'key_findings', 'clinical_implications', 'methodology', 'rrm_context'];

export const LIMITS = {
  titleMin: 50,
  titleMax: 70,
  keyFindingsMax: 5,
  keyFindingWordsMax: 32,
  words: { tldr: 60, clinical_implications: 90, methodology: 70, rrm_context: 90 },
  grade: { tldr: 10, clinical_implications: 12, methodology: 12, rrm_context: 12 },
  sentenceWordsMax: 26,
};

const ABSOLUTIST = ['always', 'never', 'guarantee', 'guaranteed', 'cure', 'cures', 'miracle', 'non-negotiable', 'every patient', 'all patients', 'all women', 'no one', 'nobody'];
const JARGON = [
  ['idiopathic', 'unexplained'], ['cumulative pregnancy rate', 'how many got pregnant'], ['cumulative live birth', 'how many had a baby'],
  ['assisted reproductive technology', 'IVF'], [/\bART\b/, 'IVF'], ['subfertil', 'trouble getting pregnant'], ['fecundab', 'chance of pregnancy'],
  ['physiolog', 'the body\'s'], ['etiolog', 'cause'], ['pathophysiolog', 'what goes wrong'], ['multivariate', 'adjusted'], ['oligomenorrh', 'irregular periods'],
  ['anovulat', 'not ovulating'], ['nullipar', 'no prior births'], ['gravid', 'pregnant'], ['in vivo', ''], ['primary outcome', 'main result'],
];
const BRITISH = ['oestradiol', 'oestrogen', 'foetal', 'foetus', 'haemorrhage', 'anaemia', 'programme', 'centre', 'favour', 'behaviour', 'colour', 'tumour', 'paediatric', 'gynaecolog', 'oedema', 'faecal', 'labour', 'fertilisation', 'ovulation induction programme', 'randomised', 'organisation', 'analysed', 'hospitalised', 'minimise', 'optimise', 'utilise', 'characterised', 'recognised'];
const UNITS = /\b\d+(?:[.,]\d+)?\s?(?:pmol\/l|ng\/ml|ng\/dl|miu\/ml|iu\/l|iu\/ml|nmol\/l|mg\/dl|mg|mcg|µg|ug|mIU|pg\/ml|units? daily|per day|twice daily|bid|tid)\b/i;
const DRUGS = ['clomiphene', 'clomid', 'letrozole', 'femara', 'metformin', 'dexamethasone', 'naltrexone', 'hcg trigger', 'gonadotropin', 'menopur', 'follistim', 'gonal', 'cabergoline', 'bromocriptine', 'levothyroxine', 'dhea', 'coq10', 'melatonin', 'aspirin', 'heparin', 'enoxaparin', 'prednisone', 'antibiotic'];
const FUNNEL = [/\bdr\.?\s+whittaker\b/i, /\bwhittaker\b/i, /\bour (clinic|practice|office)\b/i, /\b(book|schedule) (a|an|your) (visit|consult|appointment)\b/i, /\bcontact us\b/i, /\bwork with (a|an|our) (napro|restorative)/i];
const SURNAME_AGENT = /\b(?:Dr\.?|Doctor)\s+[A-Z][a-z]+(?:'s)?\s+(?:treated|treats|found|reports|reported|recommends|recommended|used|uses|prescribed|prescribes|achieved|showed|shows|protocol|approach|method)\b/;
const RRM_LABELS = [['fertility specialist', 'IVF doctor (REI)'], ['fertility subspecialist', 'IVF doctor (REI)'], ['reproductive endocrinologist', 'IVF doctor (reproductive endocrinologist) on first mention']];
const AI_TELLS = ['delve', 'it is important to note', "it's important to note", 'in conclusion', 'landscape', 'tapestry', 'game-changer', 'game changer', 'paradigm shift', 'underscores', 'testament to', 'navigate the', 'crucial to understand'];
const DENOMINATOR = /\b(out of|of \d|in \d|among|who (?:started|used|tried|charted|had|were|got|conceived|reached))\b/i;

function words(t) { return String(t || '').trim().split(/\s+/).filter(Boolean); }
function sentences(t) { return String(t || '').split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0); }
function syllables(w) { const m = w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g); return Math.max(1, m ? m.length : 1); }
export function fkGrade(t) {
  const w = words(t); if (w.length === 0) return 0;
  const s = Math.max(1, sentences(t).length);
  const syl = w.reduce((a, x) => a + syllables(x), 0);
  return Math.round((0.39 * (w.length / s) + 11.8 * (syl / w.length) - 15.59) * 10) / 10;
}

function scanText(where, text, out, { isTitle = false, isTldr = false } = {}) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  if (t.includes('—')) out.push({ level: 'FAIL', rule: 'em-dash', where, detail: 'em dash present' });
  if (/^\s*yes\b/i.test(t)) out.push({ level: 'FAIL', rule: 'leading-yes', where, detail: 'opens with Yes' });
  for (const a of ABSOLUTIST) if (new RegExp(`\\b${a.replace(/[-/]/g, '\\$&')}\\b`, 'i').test(t)) out.push({ level: 'FAIL', rule: 'absolutist', where, detail: a });
  for (const b of BRITISH) if (lower.includes(b)) out.push({ level: 'FAIL', rule: 'british-spelling', where, detail: b });
  if (UNITS.test(t)) out.push({ level: 'FAIL', rule: 'lab-value-or-dose', where, detail: t.match(UNITS)[0] });
  for (const d of DRUGS) if (new RegExp(`\\b${d}\\b`, 'i').test(t)) out.push({ level: 'WARN', rule: 'drug-name', where, detail: d });
  for (const f of FUNNEL) if (f.test(t)) out.push({ level: 'FAIL', rule: 'patient-funnel', where, detail: t.match(f)[0] });
  if (SURNAME_AGENT.test(t)) out.push({ level: 'FAIL', rule: 'surname-as-agent', where, detail: t.match(SURNAME_AGENT)[0] });
  for (const a of AI_TELLS) if (lower.includes(a)) out.push({ level: 'WARN', rule: 'ai-tell', where, detail: a });
  // memory feedback-rei-is-ivf-doctor: REIs are "IVF doctors" in RRMA copy; the source term may appear only as a gloss.
  for (const [needle, want] of RRM_LABELS) if (lower.includes(needle) && !lower.includes('ivf doctor')) out.push({ level: 'WARN', rule: 'rrm-label', where, detail: `${needle} -> ${want}` });
  for (const [needle, plain] of JARGON) {
    const hit = needle instanceof RegExp ? needle.test(t) : lower.includes(needle);
    if (hit) out.push({ level: isTldr || isTitle ? 'FAIL' : 'WARN', rule: 'jargon', where, detail: `${needle instanceof RegExp ? needle.source : needle}${plain ? ` -> ${plain}` : ''}` });
  }
  for (const s of sentences(t)) {
    const n = words(s).length;
    if (n > LIMITS.sentenceWordsMax) out.push({ level: 'WARN', rule: 'long-sentence', where, detail: `${n} words` });
  }
}

/** @returns {{ ok: boolean, findings: Array<{level:'FAIL'|'WARN', rule:string, where:string, detail:string}> }} */
export function lintSynopsis(insights) {
  const out = [];
  if (!insights || typeof insights !== 'object' || Array.isArray(insights)) {
    return { ok: false, findings: [{ level: 'FAIL', rule: 'shape', where: '$', detail: 'not an object' }] };
  }
  const keys = Object.keys(insights);
  for (const k of REQUIRED_KEYS) if (!(k in insights)) out.push({ level: 'FAIL', rule: 'missing-key', where: k, detail: 'required' });
  for (const k of keys) if (!REQUIRED_KEYS.includes(k)) out.push({ level: 'FAIL', rule: 'unknown-key', where: k, detail: k === 'clinical_relevance' ? 'legacy name, use clinical_implications' : 'not in schema' });

  const title = String(insights.title || '');
  if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) out.push({ level: title.length > LIMITS.titleMax + 10 || title.length < 30 ? 'FAIL' : 'WARN', rule: 'title-length', where: 'title', detail: `${title.length} chars, want ${LIMITS.titleMin}-${LIMITS.titleMax}` });
  if (title.includes(':')) out.push({ level: 'FAIL', rule: 'title-colon', where: 'title', detail: 'no colon wordplay' });
  if (/[?]$/.test(title)) out.push({ level: 'WARN', rule: 'title-question', where: 'title', detail: 'declarative wanted' });
  scanText('title', title, out, { isTitle: true });

  const tldr = String(insights.tldr || '');
  scanText('tldr', tldr, out, { isTldr: true });
  if (/\d/.test(title) && !DENOMINATOR.test(tldr)) {
    out.push({ level: 'FAIL', rule: 'title-number-needs-denominator', where: 'tldr', detail: 'title carries a number; tldr must name the population or denominator (out of / of N / among / who ...)' });
  }

  const kf = insights.key_findings;
  if (!Array.isArray(kf)) out.push({ level: 'FAIL', rule: 'key-findings-shape', where: 'key_findings', detail: 'must be an array' });
  else {
    if (kf.length > LIMITS.keyFindingsMax) out.push({ level: 'FAIL', rule: 'key-findings-count', where: 'key_findings', detail: `${kf.length} items, max ${LIMITS.keyFindingsMax}` });
    if (kf.length < 3) out.push({ level: 'WARN', rule: 'key-findings-count', where: 'key_findings', detail: `${kf.length} items, want 3-5` });
    kf.forEach((f, i) => {
      const n = words(f).length;
      if (n > LIMITS.keyFindingWordsMax) out.push({ level: 'FAIL', rule: 'key-finding-length', where: `key_findings[${i}]`, detail: `${n} words, max ${LIMITS.keyFindingWordsMax}` });
      scanText(`key_findings[${i}]`, f, out);
    });
  }

  for (const k of ['clinical_implications', 'methodology', 'rrm_context']) {
    const t = String(insights[k] || '');
    if (!t.trim()) { out.push({ level: k === 'clinical_implications' ? 'FAIL' : 'WARN', rule: 'empty-section', where: k, detail: 'empty' }); continue; }
    const n = words(t).length;
    if (n > LIMITS.words[k]) out.push({ level: n > LIMITS.words[k] * 1.5 ? 'FAIL' : 'WARN', rule: 'section-length', where: k, detail: `${n} words, max ${LIMITS.words[k]}` });
    scanText(k, t, out);
  }
  for (const k of Object.keys(LIMITS.grade)) {
    const t = String(insights[k] || ''); if (!t.trim()) continue;
    const g = fkGrade(t);
    if (g > LIMITS.grade[k]) out.push({ level: g > LIMITS.grade[k] + 3 ? 'FAIL' : 'WARN', rule: 'reading-grade', where: k, detail: `grade ${g}, ceiling ${LIMITS.grade[k]}` });
  }
  if (tldr && words(tldr).length > LIMITS.words.tldr) out.push({ level: 'FAIL', rule: 'section-length', where: 'tldr', detail: `${words(tldr).length} words, max ${LIMITS.words.tldr}` });

  // rrm_context must add something: fail if it is mostly the tldr restated.
  const rc = String(insights.rrm_context || '');
  if (rc && tldr) {
    const a = new Set(words(tldr.toLowerCase()).filter((w) => w.length > 4));
    const b = words(rc.toLowerCase()).filter((w) => w.length > 4);
    const overlap = b.length ? b.filter((w) => a.has(w)).length / b.length : 0;
    if (overlap > 0.5) out.push({ level: 'WARN', rule: 'rrm-context-restates-tldr', where: 'rrm_context', detail: `${Math.round(overlap * 100)}% word overlap with tldr` });
  }

  return { ok: !out.some((f) => f.level === 'FAIL'), findings: out };
}
