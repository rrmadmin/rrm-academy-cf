/**
 * Shared classifier for glossary inline-link normalization.
 *
 * Imported by:
 *   - scripts/audit-glossary-links.mjs
 *   - scripts/normalize-glossary-links.mjs (via lib/glossary-link-transforms.mjs)
 *   - scripts/check-glossary-link-classes.mjs
 *
 * Single source of truth — duplication is forbidden (see G3 pattern in
 * scripts/gates/validate-fact-pipeline.mjs).
 *
 * Returns one of the closed-enum action values listed in the
 * spec, §Phase 2 audit script.
 */

const REF_RE = /^#ref-(\d+)$/;
const REF_LOOSE_PREFIX_RE = /^#ref-/;
const CITE_RE = /^#cite-(\d+)$/;
const HASH_ONLY_RE = /^#$/;
const MULTI_CITE_RE = /^#ref-\d+,/;
const ZERO_PAD_REF_RE = /^#ref-0\d+$/;

/**
 * Word-boundary class check. NOT a substring includes() check.
 */
export function hasClassToken(classList, token) {
  return Array.isArray(classList) && classList.includes(token);
}

/**
 * @param {object} args
 * @param {string} args.href                         the <a>'s href attribute
 * @param {string[]} args.classList                  tokenized class attribute
 * @param {string|null} args.parentTagName           lowercase tag name of parent or null
 * @param {string[]} args.parentClassList            tokenized parent class
 * @param {Set<string>} args.knownTermSlugs          Set of lowercased glossary term slugs (caller's responsibility)
 * @param {Set<string>} args.sectionIds              page section anchors that must NOT get gloss-xref
 * @returns {string} action — one of the closed-enum values
 */
export function classifyAnchor({ href, classList, parentTagName, parentClassList, knownTermSlugs, sectionIds }) {
  if (href == null || href === '') return 'manual-review:malformed-href';
  if (HASH_ONLY_RE.test(href)) return 'manual-review:malformed-href';
  if (/^javascript:/i.test(href)) return 'manual-review:malformed-href';
  if (/^mailto:/i.test(href)) return 'mailto-or-tel';
  if (/^tel:/i.test(href)) return 'mailto-or-tel';
  if (/^https?:\/\//i.test(href)) return 'external';
  if (href.startsWith('/')) return 'pillar-or-onsite';

  // Anchor of some kind. From here, href starts with '#'.
  if (!href.startsWith('#')) return 'manual-review:malformed-href';

  // Citation forms first (most specific)
  if (ZERO_PAD_REF_RE.test(href)) return 'manual-review:zero-padded';
  if (MULTI_CITE_RE.test(href)) return 'manual-review:multi-cite';
  if (CITE_RE.test(href)) return 'manual-review:non-canonical-citation';

  if (REF_RE.test(href)) {
    // Strict ref-N citation. Decide based on parent.
    if (parentTagName === 'sup' && hasClassToken(parentClassList, 'cite-ref')) return 'noop';
    if (parentTagName === 'sup') return 'add-cite-ref-class-to-sup';
    return 'wrap-cite-ref';
  }

  // Loose ref-... that didn't match strict pattern (e.g., #ref-7-bad-suffix)
  if (REF_LOOSE_PREFIX_RE.test(href)) return 'manual-review:malformed-href';

  // In-page anchor that isn't a citation. Strip query/hash-fragment-with-slash if any.
  const targetSlug = href.slice(1).toLowerCase();
  if (targetSlug.includes('?') || targetSlug.includes('/')) return 'manual-review:malformed-href';

  if (sectionIds.has(targetSlug)) return 'manual-review:section-anchor';

  // Lookup against term slugs. Caller passes a Set of lowercased slugs.
  if (!knownTermSlugs.has(targetSlug)) return 'manual-review:broken-target';

  if (hasClassToken(classList, 'gloss-xref')) return 'noop';
  return 'add-gloss-xref';
}
