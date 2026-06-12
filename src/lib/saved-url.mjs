// Shared helpers for the universal "save any page" feature (spec:
// docs/superpowers/specs/2026-05-24-universal-saved-pages-design.md).
//
// SINGLE SOURCE imported by BOTH:
//   - the server: functions/api/saved.js (CF Pages Function — validation + type derive)
//   - the client: the app-shell save toggle + /saved/ view (Astro-bundled <script>)
// Pure, no runtime deps beyond the pillar SSOT. Keep it dependency-free so both the
// Workers bundle and the browser bundle can include it. (INV-1 / Root 1: one minter.)

// NOTE: this module is intentionally JSON-free so it loads unchanged under raw
// node (the migration script), wrangler 3.90's esbuild (Pages Functions deploy),
// AND Vite (the Astro client bundle). A static JSON import can't satisfy all
// three: bare breaks raw node v25 (needs an import attribute), `with { type:
// 'json' }` breaks wrangler 3.90's older esbuild. The pillar allowlist therefore
// lives in saved-guides.mjs (bundler-only consumers) and is passed into
// pageTypeFromUrl. See its header for the full rationale.

// Closed enum of saved types. 'guide' is intentionally absent: guides live only at the
// /guides/ index (no /guides/<slug> detail pages), so a saved "guide" doesn't exist.
export const SAVED_TYPES = ['article', 'commentary', 'faq', 'glossary', 'pillar'];

/**
 * Canonicalize a path into a saved-item url: lowercase, leading + exactly one trailing
 * slash, collapsed internal slashes, no scheme, no '..'. Returns null if the result is
 * not a valid same-origin saveable path shape.
 *
 * Used by the toggle (location.pathname), the API validator, and the migration mapping
 * so all three mint byte-identical urls (the D1 PK + client dedupe rely on this).
 */
export function canonicalSaveUrl(path) {
  if (typeof path !== 'string' || !path) return null;
  let p = path.split(/[?#]/)[0].trim().toLowerCase();
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/{2,}/g, '/'); // collapse '//' (incl. protocol-relative leading '//')
  if (!p.endsWith('/')) p += '/';
  if (p.indexOf('..') !== -1) return null;
  // one-or-more non-empty segments from the safe class; no empty segment => no '//'
  if (!/^(?:\/[a-z0-9_-]+)+\/$/.test(p)) return null;
  return p;
}

/**
 * Derive the saved `type` from a path, or null when the page is NOT saveable
 * (index pages, pagination, /library/saved/, non-workspace paths). Detail-path
 * matchers require exactly one non-reserved segment after the section prefix.
 *
 * Server-authoritative: the API derives type from the url and ignores the client's
 * advisory `type` (INV-4).
 *
 * @param {string} path
 * @param {Set<string>} [pillarPaths] Canonical pillar urls (from saved-guides.mjs).
 *   Pass it in bundler contexts (API, client) so pillar pages resolve to 'pillar'.
 *   Omit in JSON-free contexts (the migration, which only ever maps /library/ urls
 *   and so never needs pillar detection).
 */
export function pageTypeFromUrl(path, pillarPaths) {
  const u = canonicalSaveUrl(path);
  if (!u) return null;
  if (/^\/library\/(?!page\/|saved\/)[a-z0-9_-]+\/$/.test(u)) return 'article';
  if (/^\/commentary\/(?!page\/)[a-z0-9_-]+\/$/.test(u)) return 'commentary';
  if (/^\/faqs\/(?!page\/)[a-z0-9_-]+\/$/.test(u)) return 'faq';
  if (/^\/glossary\/(?!page\/)[a-z0-9_-]+\/$/.test(u)) return 'glossary';
  if (pillarPaths && pillarPaths.has(u)) return 'pillar';
  return null;
}
