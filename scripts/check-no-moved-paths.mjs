#!/usr/bin/env node
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
  console.error('FAIL: manifest empty — guard cannot run vacuously');
  process.exit(1);
}

for (const p of paths) {
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('..')) {
    console.error(`FAIL: manifest contains malformed path '${p}' — must be repo-relative, no leading slash, no '..'`);
    process.exit(1);
  }
}

const orphans = new Set(paths.filter(p => existsSync(resolve(repoRoot, p))));

let trackedLower = null;
try {
  trackedLower = new Set(
    execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(t => t.toLowerCase())
  );
} catch {
  trackedLower = null;
}

if (trackedLower) {
  for (const p of paths) {
    const needle = p.replace(/\/$/, '').toLowerCase();
    if (trackedLower.has(needle)) {
      orphans.add(p);
      continue;
    }
    const dirNeedle = needle + '/';
    for (const t of trackedLower) {
      if (t.startsWith(dirNeedle)) {
        orphans.add(p);
        break;
      }
    }
  }
}

if (orphans.size) {
  console.error('FAIL: paths moved to rrm-academy-internal satellite have reappeared in rrm-academy-cf:');
  for (const p of orphans) console.error(`  - ${p}`);
  console.error('\nFix: remove these paths from the working tree. The satellite repo is the SSOT.');
  process.exit(1);
}

const note = trackedLower ? '' : ' (note: case-insensitive git ls-files check skipped — not in a git work tree)';
console.log(`PASS: ${paths.length} satellite-managed paths absent from working tree${note}`);
