#!/usr/bin/env node
/**
 * Post-build structural invariants against dist/.
 *
 * Designed for BOTH fixture builds (scripts/build-fixture.mjs passes
 * --fixture, which lowers the total-page-count floor to what synthetic data
 * can produce) and real builds (higher floors). Everything else is identical
 * across modes.
 *
 * Invariants:
 *   V1  dist/index.html and dist/404.html exist and are > 5 KB
 *   V2  key static routes exist as directories with index.html
 *   V3  at least one JSON-LD <script type="application/ld+json"> block parses
 *       as valid JSON on /, one library article page, one commentary page
 *   V4  dist/pagefind/ exists with a non-empty index
 *   V5  sitemap-index.xml exists and is well-formed XML (fast-xml-parser)
 *   V6  total emitted page count >= floor (fixture: count of static .astro
 *       pages under src/pages as a heuristic; real: 3000+, since the library
 *       alone contributes >= 2500 articles)
 *
 * Usage: node scripts/verify-build-output.mjs [--fixture]
 * Exits non-zero with a list of failed invariants.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLValidator } from 'fast-xml-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const FIXTURE_MODE = process.argv.includes('--fixture');

const failures = [];
const notes = [];

function fail(id, msg) {
  failures.push(`${id}: ${msg}`);
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, visit);
    else visit(full, st);
  }
}

if (!existsSync(DIST)) {
  console.error('[verify-build-output] FAIL: dist/ does not exist');
  process.exit(1);
}

// --- V1: index + 404 non-trivial -------------------------------------------
for (const file of ['index.html', '404.html']) {
  const abs = join(DIST, file);
  if (!existsSync(abs)) {
    fail('V1', `dist/${file} missing`);
  } else if (statSync(abs).size <= 5 * 1024) {
    fail('V1', `dist/${file} is ${statSync(abs).size} bytes (expected > 5 KB)`);
  }
}

// --- V2: key static routes ---------------------------------------------------
const KEY_ROUTES = ['about', 'courses', 'library', 'glossary', 'commentary', 'faqs', 'guides', 'what-is-rrm'];
for (const route of KEY_ROUTES) {
  const abs = join(DIST, route, 'index.html');
  if (!existsSync(abs)) fail('V2', `dist/${route}/index.html missing`);
}

// --- V3: JSON-LD parses on /, one library page, one commentary page ---------
function firstContentPage(section, excludeDirs) {
  const base = join(DIST, section);
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => {
    const full = join(base, d);
    return statSync(full).isDirectory() && !excludeDirs.includes(d) && existsSync(join(full, 'index.html'));
  }).sort();
  return dirs.length > 0 ? join(base, dirs[0], 'index.html') : null;
}

function checkJsonLd(label, absPath) {
  if (!absPath || !existsSync(absPath)) {
    fail('V3', `${label}: no page found to check JSON-LD on`);
    return;
  }
  const html = readFileSync(absPath, 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (blocks.length === 0) {
    fail('V3', `${label} (${relative(DIST, absPath)}): no JSON-LD script blocks`);
    return;
  }
  let parsed = 0;
  for (const [, body] of blocks) {
    try {
      JSON.parse(body);
      parsed++;
    } catch {
      // counted below
    }
  }
  if (parsed === 0) {
    fail('V3', `${label} (${relative(DIST, absPath)}): ${blocks.length} JSON-LD block(s), none parse as JSON`);
  } else {
    notes.push(`V3 ${label}: ${parsed}/${blocks.length} JSON-LD blocks parse (${relative(DIST, absPath)})`);
  }
}

checkJsonLd('homepage', join(DIST, 'index.html'));
checkJsonLd('library article', firstContentPage('library', ['page', 'topics']));
checkJsonLd('commentary post', firstContentPage('commentary', ['page']));

// --- V4: pagefind index non-empty --------------------------------------------
const pagefindDir = join(DIST, 'pagefind');
if (!existsSync(pagefindDir)) {
  fail('V4', 'dist/pagefind/ missing');
} else {
  let files = 0;
  let bytes = 0;
  walk(pagefindDir, (_f, st) => {
    files++;
    bytes += st.size;
  });
  const entry = ['pagefind-entry.json'].find((f) => existsSync(join(pagefindDir, f)));
  if (!entry) fail('V4', 'dist/pagefind/pagefind-entry.json missing');
  if (files < 5 || bytes < 10 * 1024) {
    fail('V4', `dist/pagefind/ looks empty (${files} files, ${bytes} bytes)`);
  } else {
    notes.push(`V4 pagefind: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  }
}

// --- V5: sitemap exists and is well-formed XML -------------------------------
const sitemapCandidates = ['sitemap-index.xml', 'sitemap-0.xml', 'sitemap.xml'];
const sitemap = sitemapCandidates.map((f) => join(DIST, f)).find((f) => existsSync(f));
if (!sitemap) {
  fail('V5', `no sitemap found (looked for ${sitemapCandidates.join(', ')})`);
} else {
  const xml = readFileSync(sitemap, 'utf8');
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    fail('V5', `${relative(DIST, sitemap)} is not well-formed XML: ${valid.err?.msg ?? 'unknown error'}`);
  } else {
    notes.push(`V5 sitemap: ${relative(DIST, sitemap)} is well-formed XML`);
  }
}

// --- V6: page-count floor -----------------------------------------------------
let pageCount = 0;
walk(DIST, (f) => {
  if (f.endsWith('.html')) pageCount++;
});

// Fixture floor: every non-dynamic .astro page under src/pages should emit a
// page even with minimal data. Dynamic routes add more on top.
function countStaticAstroPages(dir) {
  let n = 0;
  walk(dir, (f) => {
    if (f.endsWith('.astro') && !relative(join(ROOT, 'src/pages'), f).includes('[')) n++;
  });
  return n;
}
const staticPageCount = countStaticAstroPages(join(ROOT, 'src', 'pages'));
const floor = FIXTURE_MODE ? staticPageCount : 3000;
if (pageCount < floor) {
  fail('V6', `emitted ${pageCount} HTML pages, floor is ${floor} (${FIXTURE_MODE ? 'fixture' : 'real'} mode)`);
} else {
  notes.push(`V6 pages: ${pageCount} HTML pages emitted (floor ${floor}, ${FIXTURE_MODE ? 'fixture' : 'real'} mode; ${staticPageCount} static .astro pages)`);
}

// --- Report -------------------------------------------------------------------
for (const n of notes) console.log(`[verify-build-output] ${n}`);
if (failures.length > 0) {
  console.error(`[verify-build-output] FAIL: ${failures.length} invariant(s) violated:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[verify-build-output] PASS: all invariants hold (${pageCount} pages).`);
