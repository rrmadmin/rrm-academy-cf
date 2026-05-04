/**
 * Single source of truth for the /contact/ form category enum.
 *
 * Imported by:
 *   - src/pages/contact.astro      (form select fallback options + click handlers)
 *   - functions/api/contact/submit.js (server-side enum validation + label map)
 *
 * Enforced in sync with docs/personas/rrm-academy-personas.md by
 * scripts/check-persona-enum-sync.mjs (CI gate).
 *
 * Adding a new category:
 *   1. Add the enum value to CONTACT_CATEGORIES below.
 *   2. Add the label to CONTACT_CATEGORY_LABELS.
 *   3. Add the persona to docs/personas/rrm-academy-personas.md frontmatter
 *      with matching contact_form_category.
 *   4. Add UI surface (card or text-link) in src/pages/contact.astro.
 *   5. Run: node scripts/check-persona-enum-sync.mjs (must pass).
 *
 * @typedef {'course' | 'stuc-billing' | 'clinician-or-researcher' | 'speaking' | 'partnership' | 'donor-or-grants' | 'bug' | 'other'} ContactCategory
 * @typedef {'card' | 'text-link' | 'select' | 'hash' | 'default'} CategorySource
 */

export const CONTACT_CATEGORIES = [
  'course',
  'stuc-billing',
  'clinician-or-researcher',
  'speaking',
  'partnership',
  'donor-or-grants',
  'bug',
  'other',
];

export const CONTACT_CATEGORY_LABELS = {
  'course': 'Course question',
  'stuc-billing': 'Member or recurring donor',
  'clinician-or-researcher': 'Clinician or researcher',
  'speaking': 'Speaking or media',
  'partnership': 'Partnership or affiliate',
  'donor-or-grants': 'Donor or grants',
  'bug': 'Bug or accessibility',
  'other': 'Something else',
};

export const CATEGORY_SOURCES = ['card', 'text-link', 'select', 'hash', 'default'];

/**
 * Uppercase label used in the email subject prefix, e.g. [STUC-BILLING].
 * @param {ContactCategory} category
 * @returns {string}
 */
export function categorySubjectLabel(category) {
  return String(category).toUpperCase();
}

/**
 * @param {unknown} value
 * @returns {value is ContactCategory}
 */
export function isContactCategory(value) {
  return typeof value === 'string' && CONTACT_CATEGORIES.includes(value);
}

/**
 * @param {unknown} value
 * @returns {value is CategorySource}
 */
export function isCategorySource(value) {
  return typeof value === 'string' && CATEGORY_SOURCES.includes(value);
}
