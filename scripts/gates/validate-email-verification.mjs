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
// EMAIL_VERIFY_GATE_ROOT lets a falsification harness point this gate at a
// fixture tree. Unset in CI and pre-commit, where it scans the real repo. Same
// convention as PAYMENT_GATE_ROOT / ANALYTICS_GATE_ROOT / CONTENT_REVIEW_GATE_ROOT.
//
// Added 2026-09-18 so this gate could be harnessed at all. It guards a
// magic-link token against truncation and replay, and it had never been watched
// fail: an edit weakening any of the three checks produced a green run.
const PROJECT_ROOT = process.env.EMAIL_VERIFY_GATE_ROOT || resolve(__dirname, '../..');

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
// EVERY assignment must be strong, not just the first.
//
// This used to be src.match(), which returns the FIRST match only, so a file
// with a strong mint followed by a weak one passed while the weak token was
// the one that could reach the link. Latent rather than live when found on
// 2026-09-18 (each file had exactly one assignment), and fixed the same day
// because "latent" here means one refactor away from a brute-forceable magic
// link that no gate would report.
function mintsStrongToken(src) {
  const re = /\btoken\s*=\s*generateToken\(\)(\s*\.slice\([^)]*\))?/gu;
  const all = [...src.matchAll(re)];
  if (all.length === 0) return { ok: false, reason: 'no `token = generateToken()` assignment found' };
  const sliced = all.filter((m) => m[1]);
  if (sliced.length > 0) {
    const which = all.length > 1 ? ` (${sliced.length} of ${all.length} assignments)` : '';
    return {
      ok: false,
      reason: `link token is truncated by ${sliced.map((m) => m[1].trim()).join(', ')}${which} -- must be the full 64-hex token`,
    };
  }
  return { ok: true, count: all.length };
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
  // The consume must be keyed on the token AND bounded by expiry.
  //
  // This used to require only the prefix up to `token = ?`, so dropping
  // `AND expires_at > ?` kept EV3 green while every expired magic link became
  // valid forever. Single-use was still enforced, which is why it went
  // unnoticed: the weaker property (a link never expires) has no visible
  // symptom until someone uses an old one. Found and fixed 2026-09-18 while
  // harnessing this gate.
  //
  // Matched as two independent conditions rather than one rigid SQL string, so
  // reordering the clauses or adding a third does not false-fail.
  const consumeStmt = verifySrc.match(
    /DELETE\s+FROM\s+email_verification\s+WHERE\s+[^'"`;]*/iu,
  );
  const consumeText = consumeStmt ? consumeStmt[0] : '';
  const keyedOnToken = /\btoken\s*=\s*\?/iu.test(consumeText);
  const boundedByExpiry = /\bexpires_at\s*>\s*\?/iu.test(consumeText);
  const consumes = keyedOnToken && boundedByExpiry;
  // The two failures are different defects and must not share a message: one
  // is replay, the other is a link that never expires.
  let ev3msg;
  if (consumes) {
    ev3msg = 'verify-email.js consumes the token atomically and only while unexpired '
      + '(DELETE ... WHERE token = ? AND expires_at > ?)';
  } else if (!keyedOnToken) {
    ev3msg = `${VERIFY_JS} does not single-use-consume by token -- replay risk`;
  } else {
    ev3msg = `${VERIFY_JS} consumes by token but does NOT bound the consume by expires_at `
      + '-- an expired magic link stays valid forever';
  }
  rec('EV3', consumes, ev3msg);
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
