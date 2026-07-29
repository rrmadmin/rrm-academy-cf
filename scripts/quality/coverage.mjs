#!/usr/bin/env node
/**
 * Full-surface coverage instrument + ARMED floor gate.
 *
 * Runs c8 over the FULL npm-test suite (same file list as package.json
 * "test") with --all across the entire first-party executable surface
 * (census-rules.mjs SURFACE_ROOTS): functions/**, scripts/**, src/lib,
 * src/scripts, src/integrations, src/pages/*.ts, src/data/*.ts.
 *
 * History: until 2026-07-28 this script scoped --include to src/lib/** only
 * and reported 23.22% lines over a 6,175-line denominator. That number was
 * optimistic in the worst way: node:test only loads what tests import, and
 * the un-included 74k lines (every deployed CF Pages Function, every CI
 * gate) were ABSENT from the report rather than zero. The full-surface
 * truth on arming day: 16.5% lines overall, 21.1% over PRODUCT-CODE.
 *
 * Exit policy (this is a GATE, not a report):
 *   1. Test failures fail the run (exit 1).
 *   2. Missing coverage-final.json fails the run (exit 1).
 *   3. Surface drift vs the committed census (new/removed/unclassifiable
 *      files) fails the run (exit 1) — classify the file in
 *      lib/census-rules.mjs and regenerate the census.
 *   4. PRODUCT-CODE line coverage below the census floor
 *      (coverage-census.json _gate.floor_lines_pct) fails the run (exit 1).
 *      The floor may only move UP (ratchet); it was armed at the measured
 *      floor rounded down, per the coverage-hardening program rules.
 *
 * Usage: node scripts/quality/coverage.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { enumerateSurface, classify, C8_INCLUDE, C8_EXCLUDE } from './lib/census-rules.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'reports', 'quality', 'coverage');
const JSON_REPORT = resolve(OUT, 'coverage-final.json');
const SUMMARY_REPORT = resolve(OUT, 'coverage-summary.json');
const CENSUS = resolve(ROOT, 'scripts', 'quality', 'coverage-census.json');

/**
 * Derive the test-file list from package.json's "test" script so this
 * instrument can never drift from what `npm test` actually runs.
 * Supports the two shapes that script uses: literal paths and dir/*.ext globs.
 */
async function testFilesFromPackageJson() {
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts?.test ?? '';
  const tokens = script.split(/\s+/).filter(t => t && !t.startsWith('-') && t !== 'node' && t !== '--test');
  const out = [];
  for (const tok of tokens) {
    if (!tok.includes('*')) { out.push(tok); continue; }
    const dir = dirname(tok);
    const pattern = basename(tok); // e.g. *.test.js
    const suffix = pattern.replace(/^\*/, '');
    const entries = (await readdir(resolve(ROOT, dir))).sort();
    for (const e of entries) if (e.endsWith(suffix)) out.push(`${dir}/${e}`);
  }
  if (out.length === 0) throw new Error('parsed zero test files from package.json "test" script');
  return out;
}

await mkdir(OUT, { recursive: true });

const args = [
  'c8',
  '--reporter=json',
  '--reporter=json-summary',
  '--reporter=html',
  '--reporter=text-summary',
  '--report-dir', OUT,
  ...C8_INCLUDE.flatMap(g => ['--include', g]),
  ...C8_EXCLUDE.flatMap(g => ['--exclude', g]),
  '--all',
  'node', '--experimental-strip-types', '--test', ...await testFilesFromPackageJson(),
];

console.log(`[coverage] running: npx c8 --all over ${C8_INCLUDE.length} include globs (full surface)`);
const code = await new Promise((res) => {
  const child = spawn('npx', args, { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', res);
});

if (code !== 0) {
  console.error(`[coverage] FAIL: test suite exited ${code}. A gate cannot arm on a red suite.`);
  process.exit(1);
}

let summary;
try {
  summary = JSON.parse(await readFile(SUMMARY_REPORT, 'utf8'));
  await readFile(JSON_REPORT); // existence check
} catch {
  console.error(`[coverage] FATAL: coverage report missing/unreadable at ${OUT}. c8 crashed or wrote nowhere.`);
  process.exit(1);
}

// ---- Census-driven floor gate ----
let census;
try {
  census = JSON.parse(await readFile(CENSUS, 'utf8'));
} catch {
  console.error(`[coverage] FATAL: committed census missing at ${CENSUS}. Run: node scripts/quality/census.mjs`);
  process.exit(1);
}

const surface = await enumerateSurface(ROOT);
const committed = new Map((census.files ?? []).map(f => [f.file, f.category]));
const problems = [];
for (const rel of surface) {
  const c = classify(rel);
  if (!c) { problems.push(`UNCLASSIFIED surface file: ${rel} (add a rule/override in scripts/quality/lib/census-rules.mjs)`); continue; }
  if (!committed.has(rel)) problems.push(`file not in committed census: ${rel} (regenerate: node scripts/quality/census.mjs)`);
  else if (committed.get(rel) !== c.category) problems.push(`census category drift for ${rel}: committed=${committed.get(rel)} rules=${c.category}`);
  const abs = resolve(ROOT, rel);
  if (!summary[abs]) problems.push(`surface file ABSENT from c8 report despite --all: ${rel} (include globs drifted)`);
}
const surfaceSet = new Set(surface);
for (const f of committed.keys()) {
  if (!surfaceSet.has(f)) problems.push(`stale census entry (file gone): ${f} (regenerate: node scripts/quality/census.mjs)`);
}
if (problems.length > 0) {
  console.error('[coverage] FAIL: census/surface drift:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

let productLines = 0, productCovered = 0;
for (const rel of surface) {
  if (classify(rel).category !== 'PRODUCT-CODE') continue;
  const s = summary[resolve(ROOT, rel)];
  productLines += s.lines.total;
  productCovered += s.lines.covered;
}
const productPct = 100 * productCovered / productLines;
const floor = census._gate?.floor_lines_pct;
if (typeof floor !== 'number') {
  console.error('[coverage] FATAL: census _gate.floor_lines_pct missing/not a number.');
  process.exit(1);
}

const total = summary.total?.lines;
console.log(`[coverage] full surface: ${total.covered}/${total.total} lines = ${total.pct}%`);
console.log(`[coverage] PRODUCT-CODE: ${productCovered}/${productLines} lines = ${productPct.toFixed(2)}% (floor ${floor}%)`);
if (productPct < floor) {
  console.error(`[coverage] FAIL: PRODUCT-CODE line coverage ${productPct.toFixed(2)}% is below the armed floor ${floor}%.`);
  console.error('[coverage] The floor only ratchets up. Add tests; never lower the floor.');
  process.exit(1);
}
console.log('[coverage] PASS: floor gate holds.');
