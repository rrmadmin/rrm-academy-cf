#!/usr/bin/env node
/**
 * arise-hotspot-guard: pre-commit guard for files that /arise-intel flags as
 * chronic bug magnets.
 *
 * Tier 1 (FROZEN): blocks the commit unless the commit message contains
 *   [unfreeze:<filename>] explicitly acknowledging the edit.
 * Tier 2 (Decomposition watchlist): warns but allows. Prints nudge to run
 *   /arise --deep.
 * Tier 3 (Mandatory --deep per commit): warns but allows.
 *
 * Install: `bash scripts/install-arise-hooks.sh`
 * Manual run: `node scripts/arise-hotspot-guard.mjs`
 *
 * Source of truth for tiers: /arise-intel output and
 * ~/.claude/skills/arise/SKILL.md "Hotspot Files" section.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const TIER_1_FROZEN = [
  'public/reports/neofertility/configurator/index.html', // whittaker-ai (133 findings)
  'functions/api/configurator.js',                       // whittaker-ai (75 findings)
];

const TIER_2_DECOMP = [
  'src/commands/sync-remote.js',             // rrm-cli (26)
  'functions/api/stripe-webhook.js',         // rrm-academy-cf (24)
  'src/index.js',                            // rrm-library-worker (22)
];

const TIER_3_DEEP = [
  'scripts/tb-tag-backfill/apply-categories.mjs',
  'src/routes/migrate-id.js',
  'depersonalize.js',
  'src/commands/sync.js',
  'src/db/relationships.js',
  'functions/api/create-checkout.js',
  'semantic.js',
  'functions/api/billing/_webhook-checkout.js',
  'PetScene.swift',
  'functions/_middleware.js',
  'functions/api/auth/_shared.js',
  'functions/api/survey/submit.js',
];

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getCommitMessage() {
  // During a commit hook, the message is in .git/COMMIT_EDITMSG
  const path = '.git/COMMIT_EDITMSG';
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function matchTier(file, tier) {
  return tier.some(t => file === t || file.endsWith('/' + t));
}

const staged = getStagedFiles();
if (!staged.length) process.exit(0);

const msg = getCommitMessage();

const tier1Hits = staged.filter(f => matchTier(f, TIER_1_FROZEN));
const tier2Hits = staged.filter(f => matchTier(f, TIER_2_DECOMP));
const tier3Hits = staged.filter(f => matchTier(f, TIER_3_DEEP));

let blocked = false;

if (tier1Hits.length) {
  const missing = tier1Hits.filter(f => {
    const base = f.split('/').pop();
    return !msg.includes(`[unfreeze:${base}]`) && !msg.includes(`[unfreeze:${f}]`);
  });
  if (missing.length) {
    console.error('');
    console.error('\x1b[31m==== /arise TIER 1 FROZEN HOTSPOT ====\x1b[0m');
    for (const f of missing) {
      console.error(`\x1b[31m  BLOCKED:\x1b[0m ${f}`);
    }
    console.error('');
    console.error('These files are FROZEN per /arise-intel (100+ findings each).');
    console.error('Architectural refactor is recommended instead of incremental edits.');
    console.error('');
    console.error('To proceed anyway, add one of these tokens to your commit message:');
    for (const f of missing) {
      const base = f.split('/').pop();
      console.error(`  [unfreeze:${base}]`);
    }
    console.error('');
    blocked = true;
  }
}

if (tier2Hits.length) {
  console.error('\x1b[33m==== /arise TIER 2 DECOMPOSITION WATCHLIST ====\x1b[0m');
  for (const f of tier2Hits) {
    console.error(`\x1b[33m  WARN:\x1b[0m ${f} is approaching Tier 1 (20+ findings).`);
  }
  console.error('Run /arise --deep before commit. Consider structural refactor.');
  console.error('');
}

if (tier3Hits.length) {
  console.error('\x1b[36m==== /arise TIER 3 HOTSPOT ====\x1b[0m');
  for (const f of tier3Hits) {
    console.error(`\x1b[36m  NUDGE:\x1b[0m ${f} is a chronic hotspot (10+ findings).`);
  }
  console.error('Consider /arise --deep before commit.');
  console.error('');
}

if (blocked) process.exit(1);
process.exit(0);
