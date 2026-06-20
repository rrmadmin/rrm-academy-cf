#!/usr/bin/env node
/**
 * validate-verify-code-length.mjs — Deterministic proof-gate runner that keeps
 * the signup email-verification <input maxlength> coupled to the length of the
 * code the backend actually emails.
 *
 * Born 2026-06-20 after a blocked-signup contact-form bug report. An /arise
 * --deep entropy remediation (593ccd6e, 2026-06-01) lengthened the emailed
 * verification code from 8 to 12 chars at BOTH generators
 * (functions/api/auth/signup.js + resend-verification.js) but left the frontend
 * input at maxlength="8" (src/pages/signup.astro). The browser silently
 * truncated every emailed code to 8 chars; verify-email.js does an exact full
 * string match, so verification failed for every email-path signup for ~18 days.
 *
 * Gates:
 *   VC1  Both backend generators emit the SAME code length N
 *        (signup.js and resend-verification.js must agree — a partial bump
 *        would re-create a silent divergence on the resend path only).
 *   VC2  The signup verify-code input's maxlength M is >= N, so the box can
 *        hold the whole code. M === N is the healthy, intentional state and is
 *        reported as such; M > N passes (the box is merely roomier than needed).
 *
 * Usage:
 *   node scripts/gates/validate-verify-code-length.mjs          # all gates
 *   node scripts/gates/validate-verify-code-length.mjs --json
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored (an anchor file/pattern is missing)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m', DIM = '\x1b[2m';

const SIGNUP_JS = 'functions/api/auth/signup.js';
const RESEND_JS = 'functions/api/auth/resend-verification.js';
const SIGNUP_ASTRO = 'src/pages/signup.astro';

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');

function read(rel) {
  const full = join(PROJECT_ROOT, rel);
  if (!existsSync(full)) throw new Error(`anchor file missing: ${rel}`);
  return readFileSync(full, 'utf8');
}

// Collect every `generateToken().slice(0, N)` length declared in a file.
function codeLengths(src, rel) {
  const re = /generateToken\(\)\.slice\(\s*0\s*,\s*(\d+)\s*\)/g;
  const lens = [];
  let m;
  while ((m = re.exec(src)) !== null) lens.push(Number(m[1]));
  if (lens.length === 0) {
    throw new Error(`no generateToken().slice(0, N) found in ${rel} — generator shape changed; gate anchor broken`);
  }
  return lens;
}

// Extract the verify-code input's maxlength (attribute order-independent).
function verifyInputMaxlength(src) {
  const tag = src.match(/<input\b[^>]*\bid=["']verify-code["'][^>]*>/);
  if (!tag) return { found: false, maxlength: null };
  const ml = tag[0].match(/\bmaxlength=["'](\d+)["']/);
  return { found: true, maxlength: ml ? Number(ml[1]) : null };
}

const results = [];
function record(id, ok, message) {
  results.push({ id, ok, message });
}

try {
  const signupLens = codeLengths(read(SIGNUP_JS), SIGNUP_JS);
  const resendLens = codeLengths(read(RESEND_JS), RESEND_JS);
  const allLens = [...signupLens, ...resendLens];
  const backendMax = Math.max(...allLens);
  const backendAgree = new Set(allLens).size === 1;

  // VC1 — both generators agree.
  if (backendAgree) {
    record('VC1', true, `both generators emit ${backendMax}-char codes`);
  } else {
    record('VC1', false,
      `generators disagree on code length: ${SIGNUP_JS}=${signupLens.join(',')} ` +
      `${RESEND_JS}=${resendLens.join(',')} — bump BOTH together`);
  }

  // VC2 — input box holds the whole code.
  const input = verifyInputMaxlength(read(SIGNUP_ASTRO));
  if (!input.found) {
    record('VC2', false,
      `verify-code input not found in ${SIGNUP_ASTRO} (looked for <input id="verify-code">) — anchor broken`);
  } else if (input.maxlength === null) {
    // Uncapped input trivially holds any code — safe, but flag the unintended
    // shape so a deletion of the cap is a conscious choice, not a silent drift.
    record('VC2', true,
      `verify-code input is uncapped (no maxlength) — holds the ${backendMax}-char code, but set maxlength="${backendMax}" to make the coupling explicit`);
  } else if (input.maxlength < backendMax) {
    record('VC2', false,
      `verify-code input maxlength="${input.maxlength}" < ${backendMax}-char emitted code — the box truncates the code and verification fails. Set maxlength="${backendMax}".`);
  } else if (input.maxlength === backendMax) {
    record('VC2', true, `verify-code input maxlength="${input.maxlength}" matches the ${backendMax}-char code`);
  } else {
    record('VC2', true, `verify-code input maxlength="${input.maxlength}" >= ${backendMax}-char code (roomier than needed, ok)`);
  }
} catch (err) {
  if (JSON_MODE) {
    console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
  } else {
    console.error(`${RED}${BOLD}verify-code-length gate ERRORED${RESET}: ${err.message}`);
  }
  process.exit(2);
}

const failures = results.filter((r) => !r.ok);

if (JSON_MODE) {
  console.log(JSON.stringify({ ok: failures.length === 0, results }, null, 2));
} else {
  console.log(`\n${BOLD}verify-code length coupling${RESET} ${DIM}(emailed code must fit the signup input)${RESET}`);
  for (const r of results) {
    const tag = r.ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`  ${tag}  ${BOLD}${r.id}${RESET}  ${r.message}`);
  }
  if (failures.length === 0) {
    console.log(`\n  ${GREEN}All verify-code coupling gates passed.${RESET}\n`);
  } else {
    console.log(`\n  ${RED}${failures.length} gate(s) failed.${RESET} Fix the coupling above (bypass pre-commit only with --no-verify).\n`);
  }
}

process.exit(failures.length === 0 ? 0 : 1);
