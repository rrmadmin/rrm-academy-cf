/**
 * Glossary structural snapshot check.
 *
 * Validates that the rendered /glossary/ page is internally consistent:
 *   - Term count matches src/data/glossary.json
 *   - Reference count matches glossary.json
 *   - Every term anchor (id="<slug>") exists
 *   - Every reference anchor (id="ref-<N>") exists
 *   - Every <sup><a href="#ref-N"> resolves to an existing ref anchor
 *   - Every <a href="#slug"> cross-ref inside a term body resolves to an existing term anchor
 *   - No em dashes in glossary main content (Header.astro mobile-nav comment excluded)
 *   - Page is not the static 404
 *   - JSON-LD DefinedTermSet parses + has matching term count
 *
 * Catches the common failure modes: D1 row deleted but body still cites it;
 * cross-ref typo; static 404 served at /glossary/ path; ref renumber gap.
 *
 * Usage:
 *   node scripts/glossary-snapshot.mjs                         # check dist/glossary/index.html
 *   node scripts/glossary-snapshot.mjs --live                  # check https://rrmacademy.org/glossary/
 *   GLOSSARY_URL=https://staging.example/glossary/ node ...    # custom URL
 *
 * Exits non-zero on any failure for CI integration.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const useLive = process.argv.includes('--live') || !!process.env.GLOSSARY_URL;
const liveUrl = process.env.GLOSSARY_URL || 'https://rrmacademy.org/glossary/';

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/glossary.json'), 'utf-8'));
const expectedTerms = data.terms.length;
const expectedRefs = data.references.length;

let html;
if (useLive) {
  console.log(`Fetching ${liveUrl}`);
  const res = await fetch(liveUrl);
  if (!res.ok) {
    console.error(`FAIL: GET ${liveUrl} returned ${res.status}`);
    process.exit(1);
  }
  html = await res.text();
} else {
  const distPath = join(ROOT, 'dist/glossary/index.html');
  if (!existsSync(distPath)) {
    console.error(`FAIL: ${distPath} not found. Run \`npm run build\` first or use --live.`);
    process.exit(1);
  }
  html = readFileSync(distPath, 'utf-8');
}

const failures = [];
function fail(msg) { failures.push(msg); }
function pass(msg) { console.log(`  PASS: ${msg}`); }

// 1. Static 404 detection
if (html.includes('Page Not Found')) {
  fail('Page contains "Page Not Found" — likely served the static 404 page at /glossary/');
} else {
  pass('Page is not the static 404');
}

// 2. Term anchor count
const termAnchors = [...html.matchAll(/<h3 id="([^"]+)"/g)].map(m => m[1]);
if (termAnchors.length !== expectedTerms) {
  fail(`Term anchor count mismatch: rendered ${termAnchors.length}, expected ${expectedTerms} from glossary.json`);
} else {
  pass(`Term anchors: ${termAnchors.length}`);
}
const termSet = new Set(termAnchors);

// 3. Reference anchor count
const refAnchors = [...html.matchAll(/<li id="ref-(\d+)"/g)].map(m => parseInt(m[1]));
if (refAnchors.length !== expectedRefs) {
  fail(`Reference anchor count mismatch: rendered ${refAnchors.length}, expected ${expectedRefs}`);
} else {
  pass(`Reference anchors: ${refAnchors.length}`);
}
const refSet = new Set(refAnchors);

// 4. <sup> citation resolution: every #ref-N in body must have a matching ref anchor
const citationRefs = [...html.matchAll(/<sup[^>]*>\s*<a[^>]*href="#ref-(\d+)"/g)].map(m => parseInt(m[1]));
const brokenCites = citationRefs.filter(n => !refSet.has(n));
if (brokenCites.length > 0) {
  fail(`Broken citations: ${brokenCites.length} <sup> markers point to non-existent ref-N (${[...new Set(brokenCites)].slice(0, 5).join(', ')}${brokenCites.length > 5 ? '...' : ''})`);
} else {
  pass(`Citation links resolve (${citationRefs.length} total <sup> markers)`);
}

// 5. Cross-ref resolution: every <a href="#slug"> inside body content must point to an existing term anchor
//    (skip TOC links and ref backlinks — those have their own targets)
const crossRefs = [...html.matchAll(/<a[^>]*href="#([a-z0-9\-]+)"/g)].map(m => m[1]);
// Filter to ones that look like glossary slugs (i.e. exist in termSet OR fail = unresolved cross-ref)
// Whitelist non-term anchors (TOC sections, abbreviations section, references section)
// Mirrors the PARTS[].id values in src/pages/glossary/index.astro plus aux sections.
const sectionAnchors = new Set([
  'overview', 'abbreviations', 'references', 'key-takeaways',
  'core-rrm-principles', 'fertility-awareness', 'clinical-approaches',
  'diagnostic-tools', 'surgical-techniques', 'conditions',
  'overlapping-disciplines', 'broader-framework',
]);
const refLinks = new Set(refAnchors.map(n => `ref-${n}`));
const broken = crossRefs.filter(s => !termSet.has(s) && !sectionAnchors.has(s) && !refLinks.has(s) && !s.startsWith('ref-'));
if (broken.length > 0) {
  fail(`Broken cross-refs: ${broken.length} <a href="#..."> point to non-existent anchors (${[...new Set(broken)].slice(0, 8).join(', ')}${broken.length > 8 ? '...' : ''})`);
} else {
  pass(`Cross-references resolve (${crossRefs.length} total internal anchors)`);
}

// 6. Em dash sweep in <main> content (excludes header/footer comments and nav)
const mainMatch = html.match(/<main[^>]*>([\s\S]+?)<\/main>/);
const mainContent = mainMatch ? mainMatch[1] : html;
const emDashCount = (mainContent.match(/—/g) || []).length + (mainContent.match(/&mdash;/g) || []).length;
if (emDashCount > 0) {
  fail(`Em dashes in glossary main content: ${emDashCount}`);
} else {
  pass('No em dashes in glossary content');
}

// 7. JSON-LD DefinedTermSet validation
const ldMatch = html.match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"DefinedTermSet"[\s\S]+?\})<\/script>/);
if (!ldMatch) {
  fail('DefinedTermSet JSON-LD block not found');
} else {
  try {
    const ld = JSON.parse(ldMatch[1]);
    const ldTermCount = (ld.hasDefinedTerm || []).length;
    if (ldTermCount !== expectedTerms) {
      fail(`DefinedTermSet term count mismatch: ${ldTermCount} in schema vs ${expectedTerms} expected`);
    } else {
      pass(`DefinedTermSet schema: ${ldTermCount} terms`);
    }
    // Check every term @id resolves to an existing term anchor
    const ldSlugs = (ld.hasDefinedTerm || []).map(t => (t['@id'] || '').split('#')[1]).filter(Boolean);
    const orphanLdSlugs = ldSlugs.filter(s => !termSet.has(s));
    if (orphanLdSlugs.length > 0) {
      fail(`Schema @id orphans: ${orphanLdSlugs.length} DefinedTerm @ids don't match any rendered term anchor (${orphanLdSlugs.slice(0, 5).join(', ')})`);
    } else {
      pass('All DefinedTerm @ids resolve to rendered anchors');
    }
  } catch (err) {
    fail(`DefinedTermSet JSON-LD parse error: ${err.message}`);
  }
}

console.log('');
if (failures.length === 0) {
  console.log(`OK: glossary snapshot passes (${expectedTerms} terms, ${expectedRefs} refs)`);
  process.exit(0);
} else {
  console.error(`FAIL: ${failures.length} snapshot check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
