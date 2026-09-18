/**
 * Falsification harness for validate-email-verification.mjs (EV1-EV3).
 *
 * This gate guards the highest-consequence assertion in scripts/gates: a
 * magic-link token against truncation (EV1) and against replay (EV3). The link
 * is validated by token ALONE, with no session, so a short token is
 * brute-forceable and a non-consumed token is reusable forever.
 *
 * Until 2026-09-18 it had no test and no root override, so an edit weakening
 * any of the three checks produced a green run and nothing would have noticed.
 * EMAIL_VERIFY_GATE_ROOT was added in the same change as this file, purely so
 * the gate could be pointed at a fixture.
 *
 * Fixtures are COPIES of the real functions/api/auth tree, mutated one
 * regression at a time. A hand-built stub would have to satisfy three checks
 * across three files and would rot the first time a handler moved; a copy is
 * green by construction, so a gate that fails everything cannot be mistaken
 * for a working one.
 *
 * Two real weaknesses surfaced while writing this and are pinned as
 * failing-state tests rather than fixed, because each is a gate change:
 * EV1 only inspects the FIRST token assignment in a file, and EV3 does not
 * require the expiry condition that the live code actually carries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(GATE_DIR, 'validate-email-verification.mjs');
const REPO = join(GATE_DIR, '..', '..');

const SIGNUP = 'functions/api/auth/signup.js';
const RESEND = 'functions/api/auth/resend-verification.js';
const VERIFY = 'functions/api/auth/verify-email.js';

/** A copy of the real auth surface in a temp tree. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'email-verify-gate-'));
  mkdirSync(join(root, 'functions/api'), { recursive: true });
  cpSync(join(REPO, 'functions/api/auth'), join(root, 'functions/api/auth'), { recursive: true });
  return root;
}

const clean = (root) => rmSync(root, { recursive: true, force: true });
const readF = (root, rel) => readFileSync(join(root, rel), 'utf8');

/** Replace `find` with `repl` in a fixture file, asserting the anchor existed.
 *  A silent no-op patch is how a mutation test goes green proving nothing. */
function patch(root, rel, find, repl) {
  const src = readF(root, rel);
  assert.ok(src.includes(find), `fixture anchor ${JSON.stringify(find.slice(0, 60))} missing from ${rel}`);
  writeFileSync(join(root, rel), src.split(find).join(repl));
}

function run(root) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json'],
      { env: { ...process.env, EMAIL_VERIFY_GATE_ROOT: root }, encoding: 'utf8' });
    return { code: 0, ...JSON.parse(out) };
  } catch (err) {
    let parsed = {};
    try { parsed = JSON.parse(err.stdout || '{}'); } catch { /* non-JSON exit */ }
    return { code: err.status, raw: `${err.stdout ?? ''}${err.stderr ?? ''}`, ...parsed };
  }
}

const got = (r, id) => (r.results || []).find((x) => x.id === id);

/** Assert the gate failed, on the check we planted for, with a named reason. */
function expectRed(root, id, pattern) {
  const r = run(root);
  assert.equal(r.code, 1, `expected the gate to fail:\n${JSON.stringify(r, null, 2)}`);
  const hit = got(r, id);
  assert.ok(hit && !hit.ok, `expected ${id} to fail; got ${JSON.stringify(r.results)}`);
  if (pattern) assert.match(hit.message, pattern, `${id} must NAME the problem; got: ${hit.message}`);
  return r;
}

test('the pristine auth surface passes all three gates', () => {
  // If this is the only red test here, the real repo is broken, not this
  // harness. It also proves the fixture copy is faithful, which every mutation
  // below depends on.
  const root = fixture();
  try {
    const r = run(root);
    assert.equal(r.code, 0, JSON.stringify(r, null, 2));
    assert.equal(r.ok, true);
    for (const id of ['EV1', 'EV2', 'EV3']) assert.ok(got(r, id)?.ok, `${id} should pass`);
    assert.equal(r.results.length, 3, 'exactly three gates run; a fourth means this file is out of date');
  } finally { clean(root); }
});

test('EMAIL_VERIFY_GATE_ROOT actually redirects the gate (the seam works)', () => {
  // Without this, every mutation below could be silently reading the REAL repo
  // and passing for the wrong reason. Proven by pointing the gate at a tree
  // that cannot possibly pass.
  const root = mkdtempSync(join(tmpdir(), 'email-verify-gate-'));
  try {
    const r = run(root);
    assert.equal(r.code, 2, 'an empty tree must ERROR, not pass; if it passes, the override is ignored');
    assert.match(r.error ?? r.raw ?? '', /anchor file missing/u);
  } finally { clean(root); }
});

// ---- EV1: the token must not be truncated -------------------------------

test('EV1 THE REGRESSION: a sliced token in signup.js fails and names the slice', () => {
  // The security-critical one. The magic link is validated by token alone, so
  // a truncated token is brute-forceable.
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();', 'const token = generateToken().slice(0, 8);');
    const r = expectRed(root, 'EV1', /truncated by \.slice\(0, 8\)/u);
    assert.match(got(r, 'EV1').message, /signup\.js/u, 'and which file');
  } finally { clean(root); }
});

test('EV1: a sliced token in resend-verification.js fails too', () => {
  // Both senders mint a link. Guarding only signup would leave the resend path
  // free to mint a weak token, and resend is the path a user hits when the
  // first link fails, so it is if anything more exposed.
  const root = fixture();
  try {
    patch(root, RESEND, 'const token = generateToken();', 'const token = generateToken().slice(0, 12);');
    expectRed(root, 'EV1', /resend-verification\.js.*truncated/su);
  } finally { clean(root); }
});

test('EV1: BOTH files sliced reports both, not just the first', () => {
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();', 'const token = generateToken().slice(0, 8);');
    patch(root, RESEND, 'const token = generateToken();', 'const token = generateToken().slice(0, 8);');
    const r = expectRed(root, 'EV1');
    assert.match(got(r, 'EV1').message, /signup\.js/u);
    assert.match(got(r, 'EV1').message, /resend-verification\.js/u);
  } finally { clean(root); }
});

test('EV1 FAILS CLOSED: an absent assignment is a failure, not a skip', () => {
  // The vacuity direction. If "no assignment found" were treated as nothing to
  // check, deleting or renaming the mint would be the easiest possible bypass.
  // Note the regex is case-sensitive and word-bounded, so renaming to
  // `verificationToken` also lands here -- which is the right answer: a gate
  // that cannot find the thing it guards must not pass.
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();', 'const verificationToken = generateToken();');
    expectRed(root, 'EV1', /no `token = generateToken\(\)` assignment found/u);
  } finally { clean(root); }
});

test('EV1: an unrelated slice elsewhere in the file is not a false positive', () => {
  // The regex must anchor on the token assignment, not on any .slice() in the
  // file. A gate that fires on ordinary string handling gets deleted.
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();',
      'const token = generateToken();\n    const short = String(email).slice(0, 4);');
    const r = run(root);
    assert.equal(r.code, 0, `an unrelated slice must not trip EV1:\n${JSON.stringify(r.results)}`);
  } finally { clean(root); }
});

test('THE REGRESSION: a weak SECOND assignment fails, not just the first', () => {
  // This test used to assert the opposite. mintsStrongToken used src.match(),
  // which returns the FIRST match only, so a file with a strong mint followed
  // by a weak one passed while the weak token was the one that could reach the
  // link. Latent when found on 2026-09-18 (each file had exactly one
  // assignment) and fixed the same day, because "latent" there meant one
  // refactor away from a brute-forceable magic link that no gate would report.
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();',
      'const token = generateToken();\n    if (retry) { const token = generateToken().slice(0, 6); }');
    const r = expectRed(root, 'EV1', /truncated by \.slice\(0, 6\)/u);
    assert.match(got(r, 'EV1').message, /2 assignments/u,
      'the failure must say how many assignments were inspected, or "first only" is indistinguishable from "all"');
  } finally { clean(root); }
});

test('EV1 counts EVERY assignment, so a strong second mint is not a false positive', () => {
  // The other direction. A file may legitimately mint more than one token; the
  // rule is that every one is full strength, not that there is exactly one.
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();',
      'const token = generateToken();\n    if (retry) { const token = generateToken(); }');
    const r = run(root);
    assert.equal(r.code, 0, `two strong assignments must pass:\n${JSON.stringify(r.results)}`);
  } finally { clean(root); }
});

// ---- EV2: the magic-link entry point must exist -------------------------

test('EV2 THE REGRESSION: losing onRequestGet fails and says the entry point is gone', () => {
  const root = fixture();
  try {
    patch(root, VERIFY, 'export async function onRequestGet(', 'async function onRequestGetInternal(');
    expectRed(root, 'EV2', /missing onRequestGet.*entry point is gone/su);
  } finally { clean(root); }
});

test('EV2: a POST-only handler does not satisfy the GET entry point', () => {
  // A magic link is followed by the browser as a GET. Renaming the export to
  // onRequestPost keeps the file exporting something and still breaks every
  // link in every email already sent.
  const root = fixture();
  try {
    patch(root, VERIFY, 'export async function onRequestGet(', 'export async function onRequestPost(');
    expectRed(root, 'EV2');
  } finally { clean(root); }
});

// ---- EV3: the token must be consumed, once ------------------------------

test('EV3 THE REGRESSION: losing the DELETE means replay, and fails', () => {
  // Without a single-use consume, a leaked or forwarded link stays valid
  // indefinitely. This is the replay invariant.
  const root = fixture();
  try {
    patch(root, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?',
      'SELECT user_id FROM email_verification WHERE token = ? AND expires_at > ?');
    expectRed(root, 'EV3', /does not single-use-consume by token.*replay risk/su);
  } finally { clean(root); }
});

test('EV3: consuming by a DIFFERENT column does not count', () => {
  // A DELETE keyed on user_id rather than the token would delete every pending
  // link for that user, which is not the same guarantee and does not prove the
  // presented token was the one consumed. The file already contains such a
  // statement for cleanup, so EV3 must not be satisfied by it -- which is why
  // this test patches the token-keyed one away and expects red even though a
  // user_id-keyed DELETE remains.
  const root = fixture();
  try {
    patch(root, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?',
      'DELETE FROM email_verification WHERE user_id = ? AND expires_at > ?');
    const src = readF(root, VERIFY);
    assert.match(src, /DELETE FROM email_verification WHERE user_id = \?/u,
      'the cleanup statement is still present, which is the point of this test');
    expectRed(root, 'EV3', /replay risk/u);
  } finally { clean(root); }
});

test('THE REGRESSION: a consume with no EXPIRY bound fails', () => {
  // This test used to assert the opposite. EV3's pattern required only the
  // prefix up to `token = ?`, so dropping `AND expires_at > ?` kept it green
  // while every expired magic link became valid forever. Single-use was still
  // enforced, which is why it went unnoticed: a link that never expires has no
  // visible symptom until someone uses an old one.
  const root = fixture();
  try {
    patch(root, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?',
      'DELETE FROM email_verification WHERE token = ?');
    expectRed(root, 'EV3', /does NOT bound the consume by expires_at/u);
  } finally { clean(root); }
});

test('EV3 names WHICH of its two properties failed', () => {
  // Replay and never-expires are different defects with different fixes.
  // Sharing one message would send the reader at the wrong one.
  const noToken = fixture();
  try {
    patch(noToken, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?',
      'DELETE FROM email_verification WHERE user_id = ? AND expires_at > ?');
    expectRed(noToken, 'EV3', /replay risk/u);
  } finally { clean(noToken); }

  const noExpiry = fixture();
  try {
    patch(noExpiry, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?',
      'DELETE FROM email_verification WHERE token = ?');
    const r = expectRed(noExpiry, 'EV3', /stays valid forever/u);
    assert.doesNotMatch(got(r, 'EV3').message, /replay risk/u,
      'a missing expiry bound must not be reported as replay');
  } finally { clean(noExpiry); }
});

test('EV3 accepts the two conditions in either order, and tolerates a third', () => {
  // Matched as two independent conditions rather than one rigid SQL string, so
  // an ordinary rewrite of the statement does not false-fail the gate.
  for (const stmt of [
    'DELETE FROM email_verification WHERE expires_at > ? AND token = ?',
    'DELETE FROM email_verification WHERE token = ? AND expires_at > ? AND user_id = ?',
  ]) {
    const root = fixture();
    try {
      patch(root, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?', stmt);
      const r = run(root);
      assert.equal(r.code, 0, `${stmt} must satisfy EV3:\n${JSON.stringify(r.results)}`);
    } finally { clean(root); }
  }
});

// ---- the runner's own error path ----------------------------------------

test('a missing anchor file exits 2, distinct from a failed gate', () => {
  // 2 means "I could not look", 1 means "I looked and it is wrong". The
  // distinction matters here more than most: this repo's pre-commit hook
  // printed a specific content diagnosis for an exit 2 on 2026-09-18 and sent
  // an investigation at the wrong thing.
  const root = fixture();
  try {
    rmSync(join(root, VERIFY));
    const r = run(root);
    assert.equal(r.code, 2);
    assert.match(r.error ?? r.raw ?? '', /anchor file missing: functions\/api\/auth\/verify-email\.js/u);
  } finally { clean(root); }
});

test('each gate reports independently, so one failure does not mask another', () => {
  // All three broken at once must produce three failures. A runner that
  // short-circuited would hide two of them and turn one fix into three rounds.
  const root = fixture();
  try {
    patch(root, SIGNUP, 'const token = generateToken();', 'const token = generateToken().slice(0, 8);');
    patch(root, VERIFY, 'export async function onRequestGet(', 'export async function onRequestPut(');
    patch(root, VERIFY, 'DELETE FROM email_verification WHERE token = ? AND expires_at > ?',
      'SELECT 1 FROM email_verification WHERE token = ? AND expires_at > ?');
    const r = run(root);
    assert.equal(r.code, 1);
    assert.equal(r.results.filter((x) => !x.ok).length, 3, 'all three must be reported');
  } finally { clean(root); }
});
