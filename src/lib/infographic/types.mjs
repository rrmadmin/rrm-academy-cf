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
 * @property {'single'|'delta'|'bars'|'ratio'} template
 * @property {string} eyebrow
 * @property {InfographicSource} source
 * @property {string} [value]
 * @property {string} [label]
 * @property {'up'|'down'} [direction]
 * @property {'favorable'|'unfavorable'|'neutral'} [polarity]
 * @property {string} [unit]
 * @property {string} [caption]
 * @property {BarEntry[]} [bars]
 * @property {number} [numerator]
 * @property {number} [denominator]
 */

export const TEMPLATES = ['single', 'delta', 'bars', 'ratio'];
export const DIRECTIONS = ['up', 'down'];
export const POLARITIES = ['favorable', 'unfavorable', 'neutral'];
export const EYEBROW_MAX = 28;
