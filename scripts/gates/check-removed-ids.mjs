#!/usr/bin/env node
// Pre-commit gate: when a commit removes an `id="X"` from a shared component
// or layout file, grep the rest of the repo for getElementById/querySelector
// references to that ID. If any consumer file still references it, block the
// commit (bypass: git commit --no-verify).
//
// Closes the gap that almost bit us when removing #saved-link and
// #desktop-ask-btn from Header.astro — those IDs were referenced from
// src/pages/library/saved.astro and src/pages/library/[...slug].astro.
// We got lucky because the consumers used null-safe `if (link)` guards;
// next time we might not.
//
// Scope: only watches removals from src/components/ and src/layouts/ —
// IDs inside src/pages/ are typically self-contained (the same file owns
// both the element and the script that touches it).

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const WATCHED_DIR_PREFIXES = ['src/components/', 'src/layouts/'];
const SEARCH_DIRS = ['src/', 'functions/', 'public/'];

function getStagedDiff() {
  try {
    return execSync('git diff --cached -U0 --diff-filter=AMRD', {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function isWatchedPath(p) {
  return WATCHED_DIR_PREFIXES.some((prefix) => p.startsWith(prefix));
}

// Parse `git diff --cached -U0` output into per-file removed-line lists.
function parseDiff(diff) {
  const perFile = new Map();
  let currentFile = null;
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      if (!perFile.has(currentFile)) perFile.set(currentFile, []);
    } else if (line.startsWith('--- a/') || line.startsWith('+++ /dev/null')) {
      // skip
    } else if (currentFile && line.startsWith('-') && !line.startsWith('---')) {
      perFile.get(currentFile).push(line.slice(1));
    }
  }
  return perFile;
}

const ID_PATTERN = /\bid=["']([a-zA-Z][a-zA-Z0-9_-]*)["']/g;

function extractRemovedIds(removedLines) {
  const ids = new Set();
  for (const line of removedLines) {
    let m;
    ID_PATTERN.lastIndex = 0;
    while ((m = ID_PATTERN.exec(line)) !== null) {
      ids.add(m[1]);
    }
  }
  return ids;
}

// Check whether the ID still exists somewhere on the + side of the same file
// (rename / restructure case). If it does, the consumers are still fine.
function idStillPresentInAddedLines(diff, file, id) {
  const lines = diff.split('\n');
  let currentFile = null;
  for (const line of lines) {
    if (line.startsWith('+++ b/')) currentFile = line.slice(6);
    else if (line.startsWith('--- a/') || line.startsWith('+++ /dev/null')) currentFile = null;
    else if (currentFile === file && line.startsWith('+') && !line.startsWith('+++')) {
      if (line.includes(`id="${id}"`) || line.includes(`id='${id}'`)) return true;
    }
  }
  return false;
}

// Also check whether the id is present anywhere in the file's CURRENT state
// (e.g., it was moved within the same file).
function idStillPresentInFile(file, id) {
  if (!existsSync(file)) return false;
  try {
    const content = readFileSync(file, 'utf8');
    return content.includes(`id="${id}"`) || content.includes(`id='${id}'`);
  } catch {
    return false;
  }
}

function grepConsumers(id, excludeFile) {
  // Each variant is its own -e pattern so we don't have to combine ' and " in
  // a single shell-quoted regex (which is unparseable). spawnSync with array
  // args bypasses shell entirely.
  const patterns = [
    `getElementById\\(['"\`]${id}['"\`]\\)`,
    `querySelector\\(['"\`]#${id}['"\`]\\)`,
    `querySelectorAll\\(['"\`]#${id}['"\`]\\)`,
  ];
  const args = [
    '-rEl',
    '--include=*.js',
    '--include=*.ts',
    '--include=*.astro',
    '--include=*.mjs',
  ];
  for (const p of patterns) {
    args.push('-e', p);
  }
  args.push(...SEARCH_DIRS);

  const result = spawnSync('grep', args, { encoding: 'utf8' });
  // grep exit 1 means "no matches" — that's fine, returns empty array.
  if (result.status !== 0 && result.status !== 1) return [];
  return (result.stdout || '')
    .split('\n')
    .filter(Boolean)
    .filter((f) => f !== excludeFile);
}

function main() {
  const diff = getStagedDiff();
  if (!diff) return 0;

  const perFile = parseDiff(diff);
  const offenders = [];

  for (const [file, removedLines] of perFile.entries()) {
    if (!isWatchedPath(file)) continue;
    const removedIds = extractRemovedIds(removedLines);
    for (const id of removedIds) {
      // Skip if the ID is still in the file (rename / reorder)
      if (idStillPresentInAddedLines(diff, file, id)) continue;
      if (idStillPresentInFile(file, id)) continue;

      const consumers = grepConsumers(id, file);
      if (consumers.length > 0) {
        offenders.push({ file, id, consumers });
      }
    }
  }

  if (offenders.length === 0) {
    console.log('\x1b[32m✓\x1b[0m No removed-ID/consumer-mismatch detected.');
    return 0;
  }

  console.error('');
  console.error('\x1b[31m✗ removed-ID/consumer-mismatch detected\x1b[0m');
  console.error('');
  for (const { file, id, consumers } of offenders) {
    console.error(`  Removed \x1b[33mid="${id}"\x1b[0m from ${file}`);
    console.error(`  Still referenced from:`);
    for (const c of consumers) console.error(`    - ${c}`);
    console.error('');
  }
  console.error('Either:');
  console.error('  - Re-add the id to the shared component, OR');
  console.error('  - Remove/update the consumer references first, OR');
  console.error('  - Bypass if intentional: git commit --no-verify');
  console.error('');
  return 1;
}

process.exit(main());
