#!/usr/bin/env node

// Astro type-check wrapper with error baseline
// Fails CI only when NEW type errors are introduced.
// To update baseline after fixing errors: node scripts/check-types.mjs --update

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE_PATH = join(ROOT, 'scripts', 'type-check-baseline.json');
const UPDATE_MODE = process.argv.includes('--update');

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let output;
try {
  output = execSync('npx astro check', { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (err) {
  // astro check exits non-zero when there are errors
  output = (err.stdout || '') + (err.stderr || '');
}

// Parse error count from "Result (N files): \n- M errors"
const errorMatch = output.match(/(\d+)\s+error/);
const errorCount = errorMatch ? parseInt(errorMatch[1], 10) : 0;

if (UPDATE_MODE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ errors: errorCount, updated: new Date().toISOString() }, null, 2) + '\n');
  console.log(`${GREEN}Baseline updated: ${errorCount} errors${RESET}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.log(`${YELLOW}No baseline found. Run: node scripts/check-types.mjs --update${RESET}`);
  console.log(`Current errors: ${errorCount}`);
  process.exit(0);
}

const delta = errorCount - baseline.errors;

console.log(`${BOLD}Astro Type Check${RESET}`);
console.log(`  Baseline: ${baseline.errors} errors (set ${baseline.updated})`);
console.log(`  Current:  ${errorCount} errors`);

if (delta > 0) {
  console.log(`\n${RED}${BOLD}FAIL${RESET} — ${delta} new type error(s) introduced.`);
  console.log(`Fix them or update baseline: node scripts/check-types.mjs --update`);
  process.exit(1);
} else if (delta < 0) {
  console.log(`\n${GREEN}${Math.abs(delta)} error(s) fixed! Consider updating baseline: node scripts/check-types.mjs --update${RESET}`);
} else {
  console.log(`\n${GREEN}${BOLD}OK${RESET} — no new type errors.`);
}
