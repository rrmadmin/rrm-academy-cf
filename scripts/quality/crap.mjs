#!/usr/bin/env node
/**
 * Join coverage + complexity, compute CRAP per function,
 * emit reports/quality/crap.json and reports/quality/crap.md.
 *
 * c8 with --all produces synthetic `(empty-report)` fnMap entries for files
 * that were never imported during tests. For those files, every function
 * reported by ESLint is treated as coverage=0 (accurate: the test suite
 * didn't touch it). Files with real fnMap entries are matched by line ±2.
 *
 * Usage: node scripts/quality/crap.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { loadCoverage } from './lib/load-coverage.mjs';
import { loadComplexity } from './lib/load-complexity.mjs';
import { crap, bandFor } from './lib/crap-calc.mjs';
import { mdTable, fmt, pct } from './lib/render-markdown.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT_DIR = resolve(ROOT, 'reports', 'quality');

await mkdir(OUT_DIR, { recursive: true });

const [coverageByFile, complexityByFile] = await Promise.all([
  loadCoverage(),
  loadComplexity(),
]);

/** A file is "untouched" if its only fnMap entry is c8's synthetic placeholder. */
function isUntouched(covEntries) {
  return covEntries.length === 1 && covEntries[0].name === '(empty-report)';
}

const records = [];
const files = new Set([...Object.keys(coverageByFile), ...Object.keys(complexityByFile)]);

for (const absPath of files) {
  const covEntries = coverageByFile[absPath] ?? [];
  const ccEntries = complexityByFile[absPath] ?? [];
  const untouched = isUntouched(covEntries);
  const matched = new Set();

  for (const cc of ccEntries) {
    let coverage;
    if (untouched) {
      // c8 saw this file but tests never imported it: 0% coverage for every fn.
      coverage = 0;
    } else {
      // Match by line (±2 tolerance) — names across c8 and ESLint can differ.
      const covIdx = covEntries.findIndex((c, i) =>
        !matched.has(i) && Math.abs(c.line - cc.line) <= 2
      );
      if (covIdx >= 0) {
        matched.add(covIdx);
        coverage = covEntries[covIdx].coverage;
      } else {
        coverage = 0;
      }
    }
    const score = crap(cc.cc, coverage);
    records.push({
      file: relative(ROOT, absPath),
      name: cc.name,
      line: cc.line,
      complexity: cc.cc,
      coverage,
      crap: score,
      band: bandFor(score),
    });
  }

  // Include coverage-only entries (real functions ESLint didn't report) as CC=1.
  // Skip synthetic `(empty-report)` entries — not real functions.
  if (!untouched) {
    for (let i = 0; i < covEntries.length; i += 1) {
      if (matched.has(i)) continue;
      const cov = covEntries[i];
      if (cov.name === '(empty-report)') continue;
      const score = crap(1, cov.coverage);
      records.push({
        file: relative(ROOT, absPath),
        name: cov.name,
        line: cov.line,
        complexity: 1,
        coverage: cov.coverage,
        crap: score,
        band: bandFor(score),
        note: 'cc-missing',
      });
    }
  }
}

// Deterministic sort: CRAP desc, then file asc, then line asc (for ties).
records.sort((a, b) => {
  if (b.crap !== a.crap) return b.crap - a.crap;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
});

await writeFile(
  resolve(OUT_DIR, 'crap.json'),
  JSON.stringify({ records }, null, 2),
);

// Markdown report
const byBand = { danger: 0, acceptable: 0, healthy: 0 };
for (const r of records) byBand[r.band] += 1;

const dangerList = records.filter(r => r.band === 'danger');

const md = [
  '# CRAP Report — src/lib',
  '',
  `**Total functions:** ${records.length}`,
  `**Healthy (≤5):** ${byBand.healthy}`,
  `**Acceptable (5–30):** ${byBand.acceptable}`,
  `**Danger (>30):** ${byBand.danger}`,
  '',
  '## Danger band (CRAP > 30)',
  '',
  dangerList.length === 0
    ? '_None — every function is within acceptable bounds._'
    : mdTable(
        ['File', 'Function', 'Line', 'CC', 'Cov', 'CRAP'],
        dangerList.map(r => [r.file, r.name, r.line, r.complexity, pct(r.coverage), fmt(r.crap, 1)]),
      ),
  '',
  '## All functions (sorted by CRAP desc)',
  '',
  mdTable(
    ['File', 'Function', 'Line', 'CC', 'Cov', 'CRAP', 'Band'],
    records.map(r => [r.file, r.name, r.line, r.complexity, pct(r.coverage), fmt(r.crap, 1), r.band]),
  ),
  '',
].join('\n');

await writeFile(resolve(OUT_DIR, 'crap.md'), md);
console.log(`[crap] wrote ${records.length} function records`);
console.log(`[crap]   healthy:    ${byBand.healthy}`);
console.log(`[crap]   acceptable: ${byBand.acceptable}`);
console.log(`[crap]   danger:     ${byBand.danger}`);
