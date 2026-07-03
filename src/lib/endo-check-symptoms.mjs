// Endo-check (Google Ads landing flow) symptom list + scoring engine.
// Scoped to /endo-check/ only. Deliberately duplicated (not imported) from the
// organic /endo-survey/ flow, which is off-limits for edits -- its magic-link
// flow must keep working untouched. Symptom text and point values are copied
// verbatim from that flow so the underlying clinical content matches exactly;
// only the delivery mechanism (no magic link, no PII co-mingling) differs.
/* eslint-disable */

export const HANDOFF_KEY = 'endo-check-handoff';
export const RESULT_VERSION = 'v1-2026-07-03';

export const TIER1 = [
  'Vomiting with menstruation',
  'Recurrent tail-end brown bleeding lasting 3 days or more',
  'ER visits for pain related to menstruation',
  'Pain during sex (deep penetration) or debilitating pain afterward',
  'Severe pain (8+/10) during or leading up to menstruation',
  'Menses pain interferes with daily activities',
  'Stabbing rectal pain',
  'Pain radiating to back or legs during menstruation',
  'Raw, stabbing, or achy lower abdominal pain with menstruation',
  'Heating pad provides pain relief',
  'Need to curl into fetal position during painful episodes',
  'Severe cramping',
  'Birth control fails to help with pain',
  'OTC medications fail to provide relief',
  'Infertility (especially unexplained) with above symptoms',
];

export const TIER2 = [
  'Chronic bladder discomfort with urination',
  'Chronic frequent urination',
  'Heavy menstrual bleeding and even iron deficiency',
  'Infertility without any other symptoms',
  'Infertility with history of painful periods at menarche',
  'Low quality or quantity of cervical mucus',
  'Symptoms or diagnosis of IBS',
  'Symptoms or diagnosis of IC',
  'Severe abdominal bloating during or before menstruation',
  'Migraines',
  'Short menstrual cycles (short luteal phases)',
  'Severe PMS',
  'Chronic constipation',
  'Consistent 1-2 days of tail-end brown bleeding',
  'Diagnosis of LUF syndrome',
];

export const TIER3 = [
  'Fatigue',
  'Nickel sensitivity',
  'Skin reactions or sensitivities',
  'Easy bruising',
  'Family history of endometriosis',
  'Personal history of autoimmune conditions',
];

export const MAX_SCORE = { tier1: TIER1.length * 3, tier2: TIER2.length * 2, tier3: TIER3.length * 1 };
MAX_SCORE.total = MAX_SCORE.tier1 + MAX_SCORE.tier2 + MAX_SCORE.tier3;

export function computeScore(selected) {
  const t1 = Array.isArray(selected?.tier1) ? selected.tier1 : [];
  const t2 = Array.isArray(selected?.tier2) ? selected.tier2 : [];
  const t3 = Array.isArray(selected?.tier3) ? selected.tier3 : [];
  const tier1 = t1.length * 3;
  const tier2 = t2.length * 2;
  const tier3 = t3.length * 1;
  return { tier1, tier2, tier3, total: tier1 + tier2 + tier3 };
}

// Band thresholds mirror the organic survey's interpretation logic, but the
// copy below is rewritten for ad-facing compliance: third-person org voice,
// no first-person clinician narration, no diagnostic or absolutist claims.
export function getBand(score, counts) {
  const t1Count = counts?.tier1 || 0;
  if (score.total === 0) return 'none';
  if (t1Count >= 5) return 'high';
  if (t1Count >= 1 || score.total >= 15) return 'moderate';
  return 'low';
}

export function getInterpretationText(band, score) {
  switch (band) {
    case 'high':
      return `Your responses include a strong pattern of symptoms often associated with endometriosis, with a score of ${score.total} out of ${MAX_SCORE.total}. This is not a diagnosis -- only surgery can confirm endometriosis -- but a pattern like this is one that a provider experienced in endometriosis care would typically want to evaluate further.`;
    case 'moderate':
      return `Your responses include symptoms associated with endometriosis across more than one category, with a score of ${score.total} out of ${MAX_SCORE.total}. This is not a diagnosis, but this pattern may be worth discussing with a healthcare provider experienced in endometriosis.`;
    case 'low':
      return `Your responses include a few symptoms that research associates with endometriosis, with a score of ${score.total} out of ${MAX_SCORE.total}. Even a small number of these symptoms can be worth mentioning at your next appointment, especially if they affect your daily life.`;
    default:
      return `Your responses did not include symptoms commonly associated with endometriosis in this self-check (score: 0 out of ${MAX_SCORE.total}). If you are still experiencing symptoms that concern you, consider discussing them with a healthcare provider.`;
  }
}

export function getBandLabel(band) {
  switch (band) {
    case 'high': return 'Strong symptom pattern';
    case 'moderate': return 'Notable symptom pattern';
    case 'low': return 'A few symptoms to note';
    default: return 'No strong pattern reported';
  }
}
