#!/usr/bin/env node
// Citation-integrity proof gate for comparison/method guides.
//
// Polarity (supportive | neutral | critical, relative to the page's RRM-favorable
// thesis) is a semantic judgment made ONCE per source by reading the abstract and
// recorded in ssot/citation-ledger.json. This gate then enforces that ledger
// DETERMINISTICALLY on every build:
//   1. CATALOGUED  - every cited /library/ slug or PubMed PMID exists in the ledger
//                    (forces a human to verify + classify any new source before use).
//   2. AUTHOR      - the inline anchor's author surname matches the ledger
//                    (catches confabulated authors, e.g. "Bozhedomov" for Grande).
//   3. POLARITY    - a 'critical' source carries NO supportive framing word nearby
//                    (catches a skeptical review cited as a "flagship"/landmark win).
//
// Usage:  node scripts/gates/validate-citations.mjs            # report only
//         node scripts/gates/validate-citations.mjs --gate     # non-zero exit on any error
//         node scripts/gates/validate-citations.mjs --self-test# prove it catches the known bugs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ledger = JSON.parse(readFileSync(join(ROOT, 'ssot/citation-ledger.json'), 'utf8'));
const FRAMING = ledger.supportiveFramingWords.map((w) => w.toLowerCase());
const GENERIC = ledger.genericAnchors.map((w) => w.toLowerCase());
const WINDOW = 250;
const STRUCT_ARRAYS = ['studies', 'safety_comparators'];
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const authorMatches = (text, surname) => norm(text).includes(norm(surname));

const A_RE = /<a\b[^>]*?href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
function keyFor(href) {
  let m = href.match(/\/library\/([a-z0-9-]+)\/?/i);
  if (m) return m[1].toLowerCase();
  m = href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
  if (m) return m[1];
  return null; // external (hfea, internal nav) — not ledger-governed
}
function* strings(node, path = '') {
  if (typeof node === 'string') yield [path, node];
  else if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* strings(node[i], `${path}[${i}]`);
  else if (node && typeof node === 'object') for (const k of Object.keys(node)) yield* strings(node[k], path ? `${path}.${k}` : k);
}

function checkString(field, str, errors) {
  for (const m of str.matchAll(A_RE)) {
    const href = m[1];
    const anchor = m[2].replace(/<[^>]+>/g, '').trim();
    const key = keyFor(href);
    if (!key) continue; // skip internal-nav / external links
    const src = ledger.sources[key];
    if (!src) { errors.push(`UNCATALOGUED  ${field}: cited source "${key}" is not in citation-ledger.json (verify abstract + classify polarity before citing)`); continue; }
    const al = anchor.toLowerCase();
    const generic = GENERIC.some((g) => al.startsWith(g.trim()) || al === g.trim());
    // Only enforce author-match on author-year-style anchors ("Boyle et al., 2025");
    // descriptive anchors ("a long-life approach...") carry no author to check.
    const looksLikeCitation = /\b(19|20)\d{2}\b/.test(anchor) || /\bet al\b/i.test(anchor);
    if (looksLikeCitation && !generic && src.authors && !authorMatches(anchor, src.authors)) {
      errors.push(`AUTHOR        ${field}: anchor "${anchor}" does not match ledger author "${src.authors}" for ${key}`);
    }
    if (src.polarity === 'critical') {
      const i = m.index;
      const win = str.slice(Math.max(0, i - WINDOW), i + m[0].length + WINDOW).toLowerCase();
      const hit = FRAMING.find((w) => win.includes(w));
      if (hit) errors.push(`POLARITY      ${field}: critical source ${key} (${src.authors}) carries supportive framing "${hit}" nearby`);
    }
  }
}

function lintPage(slug) {
  const f = join(ROOT, 'src/data', `${slug}.json`);
  if (!existsSync(f)) return [`MISSING       src/data/${slug}.json not found`];
  const data = JSON.parse(readFileSync(f, 'utf8'));
  const errors = [];
  for (const [field, str] of strings(data)) if (str.includes('<a')) checkString(`${slug}:${field}`, str, errors);
  // Structured citation arrays (e.g. rrm-success-rates studies[]/safety_comparators[]).
  for (const arrName of STRUCT_ARRAYS) {
    const arr = data[arrName];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const key = (e.librarySlug || e.pmid || '').toString().toLowerCase();
      if (!key) continue;
      const src = ledger.sources[key] || (e.pmid ? ledger.sources[String(e.pmid)] : null);
      if (!src) { errors.push(`UNCATALOGUED  ${slug}:${arrName}: "${key}" not in citation-ledger.json`); continue; }
      if (e.authors && src.authors && !authorMatches(e.authors, src.authors)) {
        errors.push(`AUTHOR        ${slug}:${arrName}: "${e.authors}" does not match ledger author "${src.authors}" for ${key}`);
      }
      if (src.polarity === 'critical' && !(e.outcomeType === 'review' || e.excluded === true)) {
        errors.push(`POLARITY      ${slug}:${arrName}: critical source ${key} (${src.authors}) presented as a non-excluded outcome study (require outcomeType:review or excluded:true)`);
      }
    }
  }
  return errors;
}

function selfTest() {
  const bad1 = '<p>A 2026 systematic review provides the flagship summary: <a href="/library/the-effectiveness-and-safety-of-restorative-reproductive-medicine-rrm-compared-t-vrqg1wuo/">Ganci et al., 2026</a> the first flagship-journal systematic review of the field.</p>';
  const bad2 = '<p>(<a href="/library/comprehensive-diagnostic-and-therapeutic-approach-to-male-factor-infertility-8decfdf8/">Bozhedomov et al., 2025</a>)</p>';
  const e1 = []; checkString('selftest:ganci', bad1, e1);
  const e2 = []; checkString('selftest:author', bad2, e2);
  const caughtPolarity = e1.some((e) => e.startsWith('POLARITY'));
  const caughtAuthor = e2.some((e) => e.startsWith('AUTHOR'));
  console.log(`self-test polarity (Ganci-as-flagship): ${caughtPolarity ? 'CAUGHT' : 'MISSED'}`);
  console.log(`self-test author   (Bozhedomov/Grande): ${caughtAuthor ? 'CAUGHT' : 'MISSED'}`);
  if (!caughtPolarity || !caughtAuthor) { console.error('SELF-TEST FAILED'); process.exit(1); }
  console.log('self-test PASS - gate catches both known failure modes');
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) { selfTest(); process.exit(0); }

const all = [];
for (const slug of ledger.governedPages) all.push(...lintPage(slug));
if (all.length) {
  console.error(`citation gate FAIL - ${all.length} issue(s):`);
  for (const e of all) console.error('  ' + e);
  if (args.includes('--gate')) process.exit(1);
} else {
  const n = ledger.governedPages.length, s = Object.keys(ledger.sources).length;
  console.log(`citation gate PASS - ${n} governed page(s), ${s} classified source(s); all citations catalogued, authors match, no critical source carries supportive framing`);
}
