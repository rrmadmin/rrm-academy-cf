// Spec types for synopsis infographics. JSDoc only; no runtime types.

/**
 * @typedef {Object} InfographicSource
 * @property {string} label
 * @property {string} [pmid]
 * @property {string} [doi]
 * @property {string} [url]
 */

/**
 * @typedef {Object} BarEntry
 * @property {string} name
 * @property {number} value
 * @property {boolean} [hero]
 */

/**
 * @typedef {Object} InfographicSpec
 * @property {'single'|'delta'|'bars'|'ratio'|'correction'|'figures'} template
 * @property {string} eyebrow
 * @property {InfographicSource} source
 * @property {string} [value]
 * @property {string} [label]
 * @property {'up'|'down'} [direction]
 * @property {'favorable'|'unfavorable'|'neutral'} [polarity]
 * @property {string} [unit]
 * @property {string} [caption]
 * @property {string} [share_caption]
 * @property {BarEntry[]} [bars]
 * @property {BarEntry[]} [rows]  figures template: 2-3 groups, value = percent of people (0-100), one hero
 * @property {number} [numerator]
 * @property {number} [denominator]
 * @property {'woman'|'man'|'couple'} [icon]
 * @property {string} [was]
 * @property {string} [wasLabel]   correction: small caption above the struck value ("Before RRM")
 * @property {string} [valueLabel] correction: small caption above the hero ("After RRM")
 * @property {string} [headline]
 * @property {string} [subhead]
 */

export const TEMPLATES = ['single', 'delta', 'bars', 'ratio', 'correction', 'figures'];
// People-pictograph figure for single + ratio. Matches the population the stat describes.
export const ICONS = ['woman', 'man', 'couple'];
export const DIRECTIONS = ['up', 'down'];
export const POLARITIES = ['favorable', 'unfavorable', 'neutral'];
export const EYEBROW_MAX = 28;

// Editorial guardrails for the share caption (memory: feedback-no-absolutist-patient-copy,
// feedback-no-hard-yes-fertility-faqs).
export const ABSOLUTIST_TOKENS = ['non-negotiable', 'guaranteed', 'guarantee', 'always works', 'never fails', 'cure', 'miracle', 'most never'];
export const CAPTION_MAX = 240;
