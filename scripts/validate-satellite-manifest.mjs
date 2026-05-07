#!/usr/bin/env node
// Audits scripts/.satellite-paths.txt against this repo's git history.
// Each entry MUST have at least one historical commit that touched the path
// (i.e. the path was once present and was deliberately moved to the satellite).
//
// Catches the /arise --deep finding #9 class: manifest entries that reference
// paths which never existed in cf history (e.g., aspirational typo'd paths
// that the guard cannot detect because there's no orphan to compare against).
//
// Run on demand: `node scripts/validate-satellite-manifest.mjs`
// CI hook: optional — wire into merge.yml if the manifest is edited often.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const manifest = resolve(__dirname, '.satellite-paths.txt');

if (!existsSync(manifest)) {
  console.error(`FAIL: ${manifest} missing`);
  process.exit(1);
}

const paths = readFileSync(manifest, 'utf8')
  .replace(/^﻿/, '')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

if (paths.length === 0) {
  console.error('FAIL: manifest empty');
  process.exit(1);
}

const aspirational = [];
const historical = [];

for (const p of paths) {
  const target = p.replace(/\/$/, '');
  let logOut;
  try {
    logOut = execSync(`git log --all --oneline -- ${JSON.stringify(target)}`, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    logOut = '';
  }
  if (logOut) {
    historical.push({ path: p, commits: logOut.split('\n').length });
  } else {
    aspirational.push(p);
  }
}

console.log(`Audit: ${paths.length} manifest entries`);
console.log(`  ${historical.length} have cf history (legitimately moved)`);
console.log(`  ${aspirational.length} have NO cf history (aspirational / typo'd)`);

if (historical.length) {
  console.log('\nHistorical entries (sample):');
  for (const { path, commits } of historical.slice(0, 5)) {
    console.log(`  ${path}  (${commits} commit(s))`);
  }
}

if (aspirational.length) {
  console.error('\nAspirational entries (NO cf history found):');
  for (const p of aspirational) console.error(`  - ${p}`);
  console.error('\nThese entries cannot detect re-introduction by an exact-path match because');
  console.error('the original path was never in cf. Either:');
  console.error('  (a) verify the path is correct (spelling, capitalization, trailing slash);');
  console.error('  (b) document them as "aspirational-block" (intent is to prevent FUTURE');
  console.error('      introduction even though they were never here);');
  console.error('  (c) remove from manifest if not load-bearing.');
  process.exit(2);
}

console.log('\nPASS: every manifest entry has cf git history.');
