#!/usr/bin/env node
// scripts/regen-agent-skills-digests.mjs
// Recompute SHA256 digests for every SKILL.md referenced in
// public/.well-known/agent-skills/index.json and rewrite the index.
//
// Run after any SKILL.md edit. Or wire as a pre-commit hook.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX_PATH = join(ROOT, 'public/.well-known/agent-skills/index.json');

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
let updates = 0;

for (const skill of index.skills) {
  const skillPath = join(ROOT, 'public', skill.url.replace(/^\//, ''));
  const buf = readFileSync(skillPath);
  const newDigest = `sha256:${createHash('sha256').update(buf).digest('hex')}`;
  if (skill.digest !== newDigest) {
    console.log(`  update ${skill.name}: ${skill.digest.slice(0, 18)}... -> ${newDigest.slice(0, 18)}...`);
    skill.digest = newDigest;
    updates++;
  } else {
    console.log(`  ok     ${skill.name}: ${newDigest.slice(0, 18)}...`);
  }
}

if (updates > 0) {
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(`\nWrote ${updates} digest update(s) to ${INDEX_PATH.replace(ROOT + '/', '')}`);
} else {
  console.log('\nNo updates needed.');
}
