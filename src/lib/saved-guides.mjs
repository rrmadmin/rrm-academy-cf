// Pillar path allowlist for the universal "save any page" feature, sourced from
// the pillar SSOT.
//
// Isolated from saved-url.mjs ON PURPOSE. saved-url.mjs is consumed by raw node
// (the migration script), wrangler 3.90's esbuild (Pages Functions), and Vite
// (the Astro client bundle). No single static JSON-import form works in all three
// (bare breaks raw node v25; `with { type: 'json' }` breaks wrangler 3.90's
// esbuild). This file is imported ONLY by bundler consumers (the API + the
// client) — never by raw node — so a bare JSON import is safe here: esbuild and
// Vite both inline JSON natively without an attribute.
//
// Pass GUIDE_PATHS into pageTypeFromUrl(url, GUIDE_PATHS) wherever pillar pages
// must resolve to type 'pillar'.
import pillarsData from '../../ssot/guides.json';

// Saveable pillar pages = pillars surfaced in the shell guides nav (own shell pages).
// Excludes glossary (it has its own /glossary/<slug>/ detail route).
export const GUIDE_PATHS = new Set(
  (pillarsData.guides || [])
    .filter((p) => p && p.in_shell_guides_nav)
    .map((p) => `/${String(p.slug).toLowerCase()}/`)
);
