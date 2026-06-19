// scripts/augment-og-index.mjs
//
// POST-build augmentation of src/data/og-index.json. Runs in the `postbuild`
// npm lifecycle hook (after `astro build`, before the CF Pages deploy bundles
// functions/og/[[path]].js). Makes every STATIC page its own source of truth
// for its OG card: walks dist/**/index.html, reads each page's real rendered
// <title> + <meta name="description"> + its /og/<slug>.png slug, and writes
// { title, description } into og-index.json for that slug.
//
// Why this exists: build-og-index.mjs seeds OG cards from a hand-written
// STATIC_PAGES dict that DRIFTS from the actual pages (e.g. /providers/ became
// the fundraiser but its card still rendered the old directory hub). Deriving
// the card from the rendered page kills that drift class permanently and gives
// every page -- including ones never registered in STATIC_PAGES -- a real card
// instead of the generic branded fallback.
//
// SKIPPED (left to their richer, lean, or SSOT-owned entries from
// build-og-index.mjs):
//   - high-cardinality content: slugs prefixed library- / commentary- /
//     faqs- / courses- / glossary- (descriptions are deliberately dropped to
//     keep the Pages Function bundle cold-start fast) and providers- detail
//     slugs (rendered as the dedicated provider card with badges).
//   - pillar guides (slugs from ssot/guides.json): og_title / og_description
//     are SEO-tuned in the SSOT and may intentionally differ from <title>.
//
// CI-fallback: if dist/ or og-index.json is absent, warn and exit 0 so a
// partial build never hard-fails here.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const OG_INDEX_PATH = join(ROOT, 'src', 'data', 'og-index.json');
const GUIDES_PATH = join(ROOT, 'ssot', 'guides.json');

// Content prefixes whose entries build-og-index.mjs owns (lean title-only or
// dedicated provider-card layout). Never overwrite these from dist.
const SKIP_PREFIXES = ['library-', 'commentary-', 'faqs-', 'courses-', 'glossary-', 'providers-'];

// Top-level dist dirs not worth descending into: high-cardinality content
// (covered by build-og-index), build assets, and Pagefind. Pruning them keeps
// the walk fast and avoids touching the thousands of content HTML files.
const PRUNE_DIRS = new Set([
  'library', 'commentary', 'faqs', 'courses', 'glossary',
  'pagefind', 'images', 'downloads',
]);

const MAX_TITLE_LEN = 180;
const MAX_DESC_LEN = 240;

function clamp(s, max) {
  if (!s || typeof s !== 'string') return s;
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join('') + '…';
}

// Decode the HTML entities Astro emits in <title> text and attribute values.
// Numeric + hex first, then named, then &amp; last so "&amp;#39;" can't
// double-decode into a stray quote.
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  let t = decodeEntities(m[1]);
  // Strip the " | RRM Academy" brand suffix BaseLayout appends to short titles;
  // the card never needs the brand (the purple band already says RRM Academy).
  t = t.replace(/\s*\|\s*RRM Academy\s*$/i, '').trim();
  return t || null;
}

function extractDescription(html) {
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']\s*\/?>/i);
  if (!m) return null;
  const d = decodeEntities(m[1]);
  return d || null;
}

// Pull the convention OG slug out of the page's own og:image URL
// (.../og/<slug>.png?v=...). Returns null for pages using a custom (non-/og/)
// image -- those don't want a generated card.
function extractOgSlug(html) {
  const m = html.match(/property=["']og:image["']\s+content=["'][^"']*\/og\/([^"'?]+)\.png/i);
  return m ? m[1] : null;
}

function shouldSkipSlug(slug, pillarSet) {
  if (pillarSet.has(slug)) return true;
  for (const p of SKIP_PREFIXES) if (slug.startsWith(p)) return true;
  return false;
}

// Collect every index.html under dist, pruning the heavy/irrelevant dirs and
// anything starting with '_' (Astro build assets, the worker bundle).
function collectHtmlFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name.startsWith('_')) continue;
      if (dir === DIST && PRUNE_DIRS.has(e.name)) continue;
      collectHtmlFiles(join(dir, e.name), out);
    } else if (e.isFile() && e.name === 'index.html') {
      out.push(join(dir, e.name));
    }
  }
}

function main() {
  if (!existsSync(DIST)) {
    console.warn('[augment-og-index] WARN: dist/ not found — skipped (CI fallback / no build yet).');
    return;
  }
  if (!existsSync(OG_INDEX_PATH)) {
    console.warn('[augment-og-index] WARN: og-index.json not found — run build-og-index.mjs first. Skipped.');
    return;
  }

  const index = JSON.parse(readFileSync(OG_INDEX_PATH, 'utf-8'));

  let pillarSet = new Set();
  try {
    const guides = JSON.parse(readFileSync(GUIDES_PATH, 'utf-8'));
    pillarSet = new Set((guides.guides || []).map((g) => g.slug));
  } catch (err) {
    console.warn(`[augment-og-index] WARN: could not load pillar slugs (${err.message}); pillars will be overwritten from dist.`);
  }

  const files = [];
  collectHtmlFiles(DIST, files);

  let added = 0, changed = 0, unchanged = 0, skipped = 0, noslug = 0;
  const changes = [];

  for (const file of files) {
    const html = readFileSync(file, 'utf-8');
    const slug = extractOgSlug(html);
    if (!slug) { noslug += 1; continue; }
    if (shouldSkipSlug(slug, pillarSet)) { skipped += 1; continue; }

    const title = extractTitle(html);
    if (!title) { continue; } // a page with no <title> shouldn't happen; leave any existing entry

    const description = extractDescription(html);
    const entry = { title: clamp(title, MAX_TITLE_LEN) };
    if (description) entry.description = clamp(description, MAX_DESC_LEN);

    const prev = index[slug];
    if (!prev) {
      added += 1;
      changes.push(`  + ${slug}: "${entry.title}"`);
    } else if (prev.title !== entry.title || (prev.description || '') !== (entry.description || '') || prev.kind) {
      changed += 1;
      changes.push(`  ~ ${slug}: "${prev.title || '(none)'}"${prev.kind ? ` [was kind:${prev.kind}]` : ''} -> "${entry.title}"`);
    } else {
      unchanged += 1;
      continue;
    }
    index[slug] = entry;
  }

  writeFileSync(OG_INDEX_PATH, JSON.stringify(index));

  console.log(
    `[augment-og-index] scanned ${files.length} pages: ` +
    `${added} added, ${changed} changed, ${unchanged} unchanged, ` +
    `${skipped} skipped (content/pillar), ${noslug} no-/og/-slug.`
  );
  if (changes.length) {
    console.log('[augment-og-index] static OG cards now derived from the page itself:');
    for (const line of changes.slice(0, 200)) console.log(line);
    if (changes.length > 200) console.log(`  ... and ${changes.length - 200} more`);
  }
}

main();
