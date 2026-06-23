import { TEMPLATES, ICONS, DIRECTIONS, POLARITIES, EYEBROW_MAX, ABSOLUTIST_TOKENS, CAPTION_MAX } from './types.mjs';

const PMID_RE = /^\d+$/;
const DOI_RE = /^10\.\d{4,}\/\S+$/;
const DASH_RE = /[–—]/;

export function hasDashBan(str) {
  return typeof str === 'string' && DASH_RE.test(str);
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validUrl(v) {
  try { new URL(v); return true; } catch { return false; }
}

function collectStrings(spec) {
  const out = [];
  for (const k of ['eyebrow', 'value', 'label', 'unit', 'caption', 'share_caption']) {
    if (typeof spec[k] === 'string') out.push(spec[k]);
  }
  if (spec.source) for (const k of ['label']) if (typeof spec.source[k] === 'string') out.push(spec.source[k]);
  if (Array.isArray(spec.bars)) for (const b of spec.bars) if (b && typeof b.name === 'string') out.push(b.name);
  return out;
}

export function validateSpec(spec) {
  const errors = [];
  const push = (m) => errors.push(m);

  if (!spec || typeof spec !== 'object') return { valid: false, errors: ['spec must be an object'] };
  if (!TEMPLATES.includes(spec.template)) push(`unknown template: ${spec.template}`);
  if (!nonEmpty(spec.eyebrow)) push('eyebrow required');
  else if (spec.eyebrow.length > EYEBROW_MAX) push(`eyebrow over ${EYEBROW_MAX} chars`);

  // source: at least one non-empty, well-formed identifier + a label
  const src = spec.source || {};
  if (!nonEmpty(src.label)) push('source.label required');
  const pmidOk = nonEmpty(src.pmid) && PMID_RE.test(src.pmid.trim());
  const doiOk = nonEmpty(src.doi) && DOI_RE.test(src.doi.trim());
  const urlOk = nonEmpty(src.url) && validUrl(src.url.trim());
  if (nonEmpty(src.pmid) && !pmidOk) push('source.pmid malformed');
  if (nonEmpty(src.doi) && !doiOk) push('source.doi malformed');
  if (nonEmpty(src.url) && !urlOk) push('source.url malformed');
  if (!(pmidOk || doiOk || urlOk)) push('source needs one of a valid pmid/doi/url');

  // dash ban on every string field
  for (const s of collectStrings(spec)) if (hasDashBan(s)) push('em or en dash not allowed');

  // share_caption governance
  if (nonEmpty(spec.share_caption)) {
    const c = spec.share_caption.trim();
    if (c.length > CAPTION_MAX) push(`share_caption over ${CAPTION_MAX} chars`);
    if (/^yes\b/i.test(c)) push('share_caption must not lead with "Yes"');
    const low = c.toLowerCase();
    if (ABSOLUTIST_TOKENS.some((t) => low.includes(t))) push('share_caption contains a banned absolutist token');
  }

  // icon (optional) applies to single + ratio pictographs
  if (spec.icon !== undefined && !ICONS.includes(spec.icon)) push(`icon must be one of ${ICONS.join('/')}`);

  // per-template invariants
  if (spec.template === 'single') {
    if (!nonEmpty(spec.value)) push('single.value required');
    if (!nonEmpty(spec.label)) push('single.label required');
  } else if (spec.template === 'correction') {
    if (!nonEmpty(spec.was)) push('correction.was required (the prior/assumed value to strike out)');
    if (!nonEmpty(spec.value)) push('correction.value required (the corrected value)');
    if (!nonEmpty(spec.label)) push('correction.label required');
  } else if (spec.template === 'delta') {
    if (!nonEmpty(spec.value)) push('delta.value required');
    if (!nonEmpty(spec.label)) push('delta.label required');
    if (!DIRECTIONS.includes(spec.direction)) push('delta.direction required');
    if (!POLARITIES.includes(spec.polarity)) push('delta.polarity required');
  } else if (spec.template === 'bars') {
    if (!nonEmpty(spec.unit)) push('bars.unit required');
    if (!nonEmpty(spec.caption)) push('bars.caption required');
    const bars = spec.bars;
    if (!Array.isArray(bars) || bars.length < 2 || bars.length > 3) push('bars needs 2 or 3 entries');
    else {
      const heroes = bars.filter((b) => b && b.hero === true).length;
      if (heroes !== 1) push('bars needs exactly one hero');
      for (const b of bars) {
        if (!b || !nonEmpty(b.name)) push('bar.name required');
        if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) push('bar.value must be finite and >= 0');
        if (spec.unit === '%' && typeof b.value === 'number' && b.value > 100) push('bar.value must be <= 100 when unit is %');
      }
    }
  } else if (spec.template === 'ratio') {
    if (!nonEmpty(spec.label)) push('ratio.label required');
    const n = spec.numerator, d = spec.denominator;
    if (!Number.isInteger(d) || d < 1 || d > 20) push('denominator must be an integer in [1, 20]');
    if (!Number.isInteger(n) || n < 0 || (Number.isInteger(d) && n > d)) push('numerator must be an integer in [0, denominator]');
  }

  return { valid: errors.length === 0, errors };
}
