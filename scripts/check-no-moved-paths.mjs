#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const orphans = paths.filter(p => existsSync(resolve(repoRoot, p)));

if (orphans.length) {
  console.error('FAIL: paths moved to rrm-academy-internal satellite have reappeared in rrm-academy-cf:');
  for (const p of orphans) console.error(`  - ${p}`);
  console.error('\nFix: remove these paths from the working tree. The satellite repo is the SSOT.');
  process.exit(1);
}

console.log(`PASS: ${paths.length} satellite-managed paths absent from working tree`);
