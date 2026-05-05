/**
 * Transforms applied to a single term's bodyHtml.
 *
 * Returns the new bodyHtml string, OR null if any anchor in the body
 * triggered a manual-review:* action (caller should skip the term entirely).
 *
 * Transforms are surgical: only anchor classes and <sup> wrappers are
 * mutated. Non-anchor markup is preserved through node-html-parser
 * round-trip (cosmetic serializer normalization is acceptable per spec
 * preservation rules).
 *
 * Two-pass design: first classify all anchors. If ANY is manual-review:*,
 * return null without applying any mutation. Only if every anchor is
 * auto-fixable does the second pass apply changes — preventing partial
 * mutation of a term.
 */
import { parse } from 'node-html-parser';
import { classifyAnchor, hasClassToken } from './glossary-link-classifier.mjs';

/**
 * Apply normalization transforms to a single term body.
 *
 * @param {string} bodyHtml  - raw HTML from glossary_term.body_html
 * @param {object} opts
 * @param {Set<string>} opts.knownTermSlugs - lowercased term slugs (caller's Set)
 * @param {Set<string>} opts.sectionIds     - page-section anchor IDs (caller's Set)
 * @returns {string|null} mutated HTML, or null if any anchor needs manual review
 */
export function applyTransforms(bodyHtml, { knownTermSlugs, sectionIds }) {
  const root = parse(bodyHtml);
  const anchors = root.querySelectorAll('a');

  // First pass: classify everything. If any is manual-review, bail entirely.
  const classifications = anchors.map(a => ({
    anchor: a,
    action: classifyAnchor({
      href: a.getAttribute('href'),
      classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      parentTagName: a.parentNode?.tagName?.toLowerCase() || null,
      parentClassList: (a.parentNode?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean),
      knownTermSlugs,
      sectionIds,
    }),
  }));

  for (const { action } of classifications) {
    if (action.startsWith('manual-review:')) return null;
  }

  // Second pass: apply mutations using word-boundary (split-and-set) semantics.
  for (const { anchor, action } of classifications) {
    switch (action) {
      case 'noop':
      case 'mailto-or-tel':
      case 'external':
      case 'pillar-or-onsite':
        // No mutation needed.
        break;

      case 'add-gloss-xref': {
        // Add 'gloss-xref' to anchor's class list.
        // Split-and-set: never uses substring includes(); guards against
        // false-skip on 'my-gloss-xref-fake' or 'gloss-xref-extended'.
        const tokens = (anchor.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!tokens.includes('gloss-xref')) tokens.push('gloss-xref');
        anchor.setAttribute('class', tokens.join(' '));
        break;
      }

      case 'add-cite-ref-class-to-sup': {
        // Parent is an existing <sup>; add 'cite-ref' to its class list.
        // Same word-boundary semantics as add-gloss-xref.
        const sup = anchor.parentNode;
        const tokens = (sup.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        if (!tokens.includes('cite-ref')) tokens.push('cite-ref');
        sup.setAttribute('class', tokens.join(' '));
        break;
      }

      case 'wrap-cite-ref': {
        // Truly bare <a href="#ref-N"> with no <sup> parent.
        // Wrap it in a new <sup class="cite-ref">.
        // Uses node-html-parser's replaceWith() — not regex string manipulation.
        const newHtml = `<sup class="cite-ref">${anchor.outerHTML}</sup>`;
        anchor.replaceWith(parse(newHtml).firstChild);
        break;
      }

      default:
        // Should not be reached (manual-review caught in first pass).
        break;
    }
  }

  return root.toString();
}
