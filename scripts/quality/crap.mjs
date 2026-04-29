#!/usr/bin/env node
/**
 * Join coverage + complexity, compute CRAP per function,
 * emit reports/quality/crap.json and reports/quality/crap.md.
 *
 * c8 with --all produces synthetic `(empty-report)` fnMap entries for files
 * that were never imported during tests. For those files, every function
 * reported by ESLint is treated as coverage=0 (accurate: the test suite
 * didn't touch it). Files with real fnMap entries are matched by (file, name)
 * exact, falling back to line ±2 for anonymous functions.
 *
 * Usage: node scripts/quality/crap.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { loadCoverage } from './lib/load-coverage.mjs';
import { loadComplexity } from './lib/load-complexity.mjs';
import { crap, bandFor } from './lib/crap-calc.mjs';
import { mdTable, fmt, pct } from './lib/render-markdown.mjs';
import { isUntouched } from './lib/coverage-helpers.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT_DIR = resolve(ROOT, 'reports', 'quality');

/**
 * Pure join function: takes coverageByFile + complexityByFile maps and
 * produces the unsorted CRAP records list. Exported for testing.
 *
 * @param {Record<string, Array<{name:string,line:number,coverage:number}>>} coverageByFile
 * @param {Record<string, Array<{name:string,line:number,cc:number}>>} complexityByFile
 * @param {string} [rootPath] - root for relative-path normalization
 * @returns {Array<{file,name,line,complexity,coverage,crap,band,note?}>}
 */
export function joinCrap(coverageByFile, complexityByFile, rootPath = ROOT) {
  const records = [];
  const files = new Set([...Object.keys(coverageByFile), ...Object.keys(complexityByFile)]);

  for (const absPath of files) {
    const covEntries = coverageByFile[absPath] ?? [];
    const ccEntries = complexityByFile[absPath] ?? [];
    const untouched = isUntouched(covEntries);
    const matched = new Set();

    for (const cc of ccEntries) {
      let coverage;
      let resolvedName = cc.name;
      if (untouched) {
        // c8 saw this file but tests never imported it: 0% coverage for every fn.
        coverage = 0;
      } else {
        // Prefer (file, name) exact match where name is non-anonymous; fall back
        // to line ±2 for true anonymous functions.
        let covIdx = -1;
        if (cc.name && cc.name !== '<anonymous>') {
          covIdx = covEntries.findIndex((c, i) =>
            !matched.has(i) && c.name === cc.name
          );
        }
        if (covIdx === -1) {
          covIdx = covEntries.findIndex((c, i) =>
            !matched.has(i) && Math.abs(c.line - cc.line) <= 2
          );
        }
        if (covIdx >= 0) {
          matched.add(covIdx);
          coverage = covEntries[covIdx].coverage;
          // Prefer c8's real name if ESLint reported anonymous (per #8).
          if ((!cc.name || cc.name === '<anonymous>') && covEntries[covIdx].name && covEntries[covIdx].name !== '<anonymous>') {
            resolvedName = covEntries[covIdx].name;
          }
        } else {
          coverage = 0;
        }
      }
      const score = crap(cc.cc, coverage);
      records.push({
        file: relative(rootPath, absPath),
        name: resolvedName,
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
          file: relative(rootPath, absPath),
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

  return records;
}

// Only execute the side-effecting CLI body when this file is run directly.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await mkdir(OUT_DIR, { recursive: true });

  const [coverageByFile, complexityByFile] = await Promise.all([
    loadCoverage(),
    loadComplexity(),
  ]);

  const records = joinCrap(coverageByFile, complexityByFile, ROOT);

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
}
