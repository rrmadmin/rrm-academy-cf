#!/usr/bin/env node
/**
 * validate-email-verification.mjs — Deterministic proof-gate for the magic-link
 * email-verification flow (functions/api/auth/{signup,resend-verification,verify-email}.js).
 *
 * Replaces validate-verify-code-length.mjs (2026-06-20). That gate guarded the
 * signup verify-code <input maxlength> against the emailed code length; the move
 * to link-only verification removed the typed-code box, so the failure mode it
 * guarded no longer exists. These checks guard the magic-link's load-bearing
 * invariants instead:
 *
 *   EV1  Both senders mint a STRONG link token: `const token = generateToken()`
 *        with NO `.slice()` truncation. A sliced/short token would be brute-
 *        forceable because the magic link is validated by token alone (no
 *        session), so this is the security-critical invariant.
 *   EV2  verify-email.js exposes the magic-link entry point: it exports
 *        onRequestGet (the side-effect-free confirm page).
 *   EV3  verify-email.js consumes the token atomically and single-use:
 *        a `DELETE FROM email_verification WHERE token = ?` is present.
 *
 * Usage:
 *   node scripts/gates/validate-email-verification.mjs          # all gates
 *   node scripts/gates/validate-email-verification.mjs --json
 *
 * Exit codes: 0 pass · 1 a gate failed · 2 runner errored (an anchor is missing)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

const GREEN = '\x1b[32m', RED = '\x1b[31m', BOLD = '\x1b[1m', RESET = '\x1b[0m', DIM = '\x1b[2m';

const SIGNUP_JS = 'functions/api/auth/signup.js';
const RESEND_JS = 'functions/api/auth/resend-verification.js';
const VERIFY_JS = 'functions/api/auth/verify-email.js';

const JSON_MODE = process.argv.slice(2).includes('--json');

function read(rel) {
  const full = join(PROJECT_ROOT, rel);
  if (!existsSync(full)) throw new Error(`anchor file missing: ${rel}`);
  return readFileSync(full, 'utf8');
}

// A strong token is `const token = generateToken()` with NO `.slice(...)` after it.
function mintsStrongToken(src) {
  const re = /\btoken\s*=\s*generateToken\(\)(\s*\.slice\([^)]*\))?/;
  const m = src.match(re);
  if (!m) return { ok: false, reason: 'no `token = generateToken()` assignment found' };
  if (m[1]) return { ok: false, reason: `link token is truncated by ${m[1].trim()} — must be the full 64-hex token` };
  return { ok: true };
}

const results = [];
const rec = (id, ok, message) => results.push({ id, ok, message });

try {
  const signupSrc = read(SIGNUP_JS);
  const resendSrc = read(RESEND_JS);
  const verifySrc = read(VERIFY_JS);

  // EV1 — strong token at both senders.
  const s = mintsStrongToken(signupSrc);
  const r = mintsStrongToken(resendSrc);
  if (s.ok && r.ok) {
    rec('EV1', true, 'signup.js + resend-verification.js mint the full-strength magic-link token');
  } else {
    const parts = [];
    if (!s.ok) parts.push(`${SIGNUP_JS}: ${s.reason}`);
    if (!r.ok) parts.push(`${RESEND_JS}: ${r.reason}`);
    rec('EV1', false, `weak/absent link token — ${parts.join('; ')}`);
  }

  // EV2 — magic-link GET entry point exists.
  rec('EV2', /export\s+async\s+function\s+onRequestGet\b/.test(verifySrc),
    /export\s+async\s+function\s+onRequestGet\b/.test(verifySrc)
      ? 'verify-email.js exposes onRequestGet (confirm page)'
      : `${VERIFY_JS} is missing onRequestGet — the magic-link entry point is gone`);

  // EV3 — single-use atomic consume keyed on the token.
  const consumes = /DELETE\s+FROM\s+email_verification\s+WHERE\s+token\s*=\s*\?/i.test(verifySrc);
  rec('EV3', consumes,
    consumes
      ? 'verify-email.js consumes the token atomically (DELETE ... WHERE token = ?)'
      : `${VERIFY_JS} does not single-use-consume by token — replay risk`);
} catch (err) {
  if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
  else console.error(`${RED}${BOLD}email-verification gate ERRORED${RESET}: ${err.message}`);
  process.exit(2);
}

const failures = results.filter((x) => !x.ok);

if (JSON_MODE) {
  console.log(JSON.stringify({ ok: failures.length === 0, results }, null, 2));
} else {
  console.log(`\n${BOLD}magic-link email verification${RESET} ${DIM}(strong token · GET entry · single-use consume)${RESET}`);
  for (const x of results) {
    console.log(`  ${x.ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}  ${BOLD}${x.id}${RESET}  ${x.message}`);
  }
  console.log(
    failures.length === 0
      ? `\n  ${GREEN}All email-verification gates passed.${RESET}\n`
      : `\n  ${RED}${failures.length} gate(s) failed.${RESET} Fix the invariant above (bypass pre-commit only with --no-verify).\n`
  );
}

process.exit(failures.length === 0 ? 0 : 1);
