/**
 * Falsification harness for validate-email-trickle.mjs (ET1-ET4).
 *
 * The gate keeps STUC member-roster broadcasts paced. It was born 2026-06-29
 * when notifyNewPost fired all ~46 SES sends at once via
 * Promise.allSettled(members.results.map(...)), risking send-rate-cap failures
 * and poor deliverability. Until 2026-09-18 the gate had no test, so an edit
 * weakening any of its four checks produced a green run.
 *
 * This is the easiest of the untested gates to falsify, and it is worth saying
 * why: the gate ALREADY carries the seam. EMAIL_TRICKLE_FILE exists precisely
 * so the gate can be pointed at a fixture, and its own comment says so ("only
 * so the gate itself can be tested against blast/neutered fixtures"). Nobody
 * had used it. Every test below plants the exact regression its check exists to
 * catch and asserts the gate goes RED and names the check id.
 *
 * Fixtures are COPIES of the real functions/api/community/_email.js, mutated
 * one regression at a time. A hand-built stub would have to satisfy four
 * checks across two brace-matched function bodies and would rot the first time
 * the real file moved; a copy is green by construction, so a gate that fails
 * everything cannot be mistaken for a working one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(GATE_DIR, 'validate-email-trickle.mjs');
const REAL = join(GATE_DIR, '..', '..', 'functions', 'api', 'community', '_email.js');

/** A copy of the real _email.js in a temp file, optionally patched. */
function fixture(patch = (s) => s) {
  const root = mkdtempSync(join(tmpdir(), 'email-trickle-gate-'));
  const file = join(root, '_email.js');
  writeFileSync(file, patch(readFileSync(REAL, 'utf8')));
  return { root, file };
}

/** Replace `find` with `repl`, asserting the anchor existed (a silent no-op
 *  patch is how a mutation test goes green while proving nothing). */
function swap(src, find, repl) {
  assert.ok(src.includes(find), `fixture anchor ${JSON.stringify(find.slice(0, 60))} missing from _email.js`);
  return src.split(find).join(repl);
}

function run(file) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json'],
      { env: { ...process.env, EMAIL_TRICKLE_FILE: file }, encoding: 'utf8' });
    return { code: 0, ...JSON.parse(out) };
  } catch (err) {
    let parsed = {};
    try { parsed = JSON.parse(err.stdout || '{}'); } catch { /* non-JSON exit */ }
    return { code: err.status, raw: `${err.stdout ?? ''}${err.stderr ?? ''}`, ...parsed };
  }
}

const failed = (r, id) => (r.checks || []).find((c) => c.id === id && !c.pass);
const passed = (r, id) => (r.checks || []).find((c) => c.id === id && c.pass);

/** Assert the gate failed, and failed on the check we planted for. */
function expectRed(file, id) {
  const r = run(file);
  assert.equal(r.code, 1, `expected the gate to fail:\n${JSON.stringify(r, null, 2)}`);
  assert.ok(failed(r, id), `expected ${id} to fail; got: ${JSON.stringify(r.checks)}`);
  return r;
}

test('the pristine _email.js passes all four checks', () => {
  // If this is the only red test here, the real file is broken, not this
  // harness. It also proves the fixture copy is faithful, which every mutation
  // below depends on.
  const { root, file } = fixture();
  try {
    const r = run(file);
    assert.equal(r.code, 0, JSON.stringify(r, null, 2));
    assert.equal(r.ok, true);
    for (const id of ['ET1', 'ET2', 'ET3', 'ET4']) assert.ok(passed(r, id), `${id} should pass`);
    assert.equal(r.checks.length, 4, 'exactly four checks run; a fifth means this file is out of date');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('EMAIL_TRICKLE_FILE actually redirects the gate (the seam works)', () => {
  // Without this, every mutation below could be silently reading the REAL file
  // and passing for the wrong reason. Proven by pointing the gate at a file
  // that cannot possibly pass.
  const root = mkdtempSync(join(tmpdir(), 'email-trickle-gate-'));
  const file = join(root, '_email.js');
  try {
    writeFileSync(file, '// nothing here at all\n');
    const r = run(file);
    assert.equal(r.code, 1, 'an empty file must not pass; if it does, the env override is ignored');
    assert.ok(failed(r, 'ET1'), 'ET1 must report notifyNewPost missing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET1 THE REGRESSION: the 2026-06-29 blast shape fails', () => {
  // The original defect, verbatim in shape: the roster mapped straight into
  // Promise.allSettled inside notifyNewPost.
  const { root, file } = fixture((s) => swap(s,
    'await sendBroadcastTrickle(',
    'await Promise.allSettled(members.results.map(m => sendEmail(env, { to: m.email }))); await sendBroadcastTrickle('));
  try {
    const r = expectRed(file, 'ET1');
    assert.match(r.checks.find((c) => c.id === 'ET1').detail, /route the roster send through sendBroadcastTrickle/u,
      'the failure must tell the operator what to do');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET1: the non-settled Promise.all spelling fails too', () => {
  // allSettled was the original, but Promise.all is the likelier rewrite and
  // the (Settled)? group is what covers it. Testing only allSettled would let
  // a Promise.all regression through.
  const { root, file } = fixture((s) => swap(s,
    'await sendBroadcastTrickle(',
    'await Promise.all(members.results.map(m => sendEmail(env, { to: m.email }))); await sendBroadcastTrickle('));
  try { expectRed(file, 'ET1'); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET2 THE REGRESSION: dropping the delegation fails, even with no Promise.all', () => {
  // The subtler half. A rewrite that loops the roster with a bare `for await`
  // and sends inline has no Promise.all at all, so ET1 stays green; ET2 is the
  // only thing that notices the helper is gone.
  const { root, file } = fixture((s) => swap(s,
    'await sendBroadcastTrickle(',
    'await sendEachInline('));
  try {
    const r = expectRed(file, 'ET2');
    assert.ok(passed(r, 'ET1'), 'ET1 is blind to this shape, which is exactly why ET2 exists');
    assert.match(r.checks.find((c) => c.id === 'ET2').detail, /never calls sendBroadcastTrickle/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET3 THE REGRESSION: a helper that no longer delays fails', () => {
  // Remove the inter-batch wait and the helper still batches, still looks like
  // a trickle, and sends all batches back to back. This is the mutation most
  // likely to be made by someone "simplifying" the helper.
  const { root, file } = fixture((s) => swap(s,
    'await new Promise(resolve => setTimeout(resolve, BROADCAST_BATCH_DELAY_MS));',
    '/* delay removed */'));
  try {
    const r = expectRed(file, 'ET3');
    assert.match(r.checks.find((c) => c.id === 'ET3').detail, /setTimeout:false/u,
      'the detail must name which of the three ingredients is missing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET3: a helper that no longer batches fails', () => {
  // The other direction: keep the delay, drop the slice, and every recipient
  // goes in one batch with a pointless pause at the end.
  const { root, file } = fixture((s) => swap(s,
    'const batch = recipients.slice(i, i + BROADCAST_BATCH_SIZE);',
    'const batch = recipients;'));
  try {
    const r = expectRed(file, 'ET3');
    assert.match(r.checks.find((c) => c.id === 'ET3').detail, /slice:false/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET3: deleting the helper entirely fails, and says so rather than passing vacuously', () => {
  // The vacuity direction. If extractFn returning null were read as "nothing
  // to check", removing the helper would be the easiest possible bypass.
  const { root, file } = fixture((s) => swap(s,
    'async function sendBroadcastTrickle(', 'async function sendBroadcastTrickleRenamed('));
  try {
    const r = expectRed(file, 'ET3');
    assert.match(r.checks.find((c) => c.id === 'ET3').detail, /not found/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET4 THE REGRESSION: a batch size large enough to be a blast fails', () => {
  // 500 is a trickle on paper and a blast in practice. The 1..25 bound is what
  // stops the pacing being turned off while every other check stays green.
  const { root, file } = fixture((s) => swap(s,
    'const BROADCAST_BATCH_SIZE = 5;', 'const BROADCAST_BATCH_SIZE = 500;'));
  try {
    const r = expectRed(file, 'ET4');
    for (const id of ['ET1', 'ET2', 'ET3']) {
      assert.ok(passed(r, id), `${id} cannot see a widened batch size; ET4 is the only guard`);
    }
    assert.match(r.checks.find((c) => c.id === 'ET4').detail, /BROADCAST_BATCH_SIZE=500/u,
      'the detail must show the offending value, not just that it was wrong');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET4: a zero delay fails, because a batched blast is still a blast', () => {
  const { root, file } = fixture((s) => swap(s,
    'const BROADCAST_BATCH_DELAY_MS = 1800;', 'const BROADCAST_BATCH_DELAY_MS = 0;'));
  try {
    const r = expectRed(file, 'ET4');
    assert.match(r.checks.find((c) => c.id === 'ET4').detail, /BROADCAST_BATCH_DELAY_MS=0/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET4: a DELETED constant fails rather than reading as absent-and-fine', () => {
  // null is not a passing value. Deleting the constant is a likelier edit than
  // setting it to something silly, and a `size > 0` style check written
  // without a null guard would let it through.
  for (const konst of ['const BROADCAST_BATCH_SIZE = 5;', 'const BROADCAST_BATCH_DELAY_MS = 1800;']) {
    const { root, file } = fixture((s) => swap(s, konst, '/* constant deleted */'));
    try {
      const r = expectRed(file, 'ET4');
      assert.match(r.checks.find((c) => c.id === 'ET4').detail, /=null/u,
        'a missing constant must be reported as null, not silently tolerated');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('THE REGRESSION: a PREFIXED constant name does NOT satisfy ET4', () => {
  // This test used to assert the opposite, as an honest record of a live
  // weakness: ET4's patterns were /BROADCAST_BATCH_SIZE\s*=\s*(\d+)/ with no
  // leading \b, so any identifier ENDING in that name matched and the value
  // read belonged to a constant the helper does not use. Renaming the real
  // constant turned the pacing off at runtime with a green gate, and
  // ET1-ET3 cannot see it either.
  //
  // Found 2026-09-18 by this very fixture: it was written to prove ET4 would
  // fail on a rename, and instead watched it pass. \b was added to both
  // patterns the same day; this now asserts the refusal.
  for (const konst of ['BROADCAST_BATCH_SIZE = 5;', 'BROADCAST_BATCH_DELAY_MS = 1800;']) {
    const { root, file } = fixture((s) => swap(s, `const ${konst}`, `const RENAMED_${konst}`));
    try {
      const r = expectRed(file, 'ET4');
      assert.match(r.checks.find((c) => c.id === 'ET4').detail, /=null/u,
        'a renamed constant must read as absent, not as whatever the prefixed one holds');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('ET4 still matches the real constant, so \\b did not break the ordinary case', () => {
  // The other direction. A \b in the wrong place would make ET4 read null for
  // the genuine declaration and fail every run, which is the shape of fix
  // that gets reverted rather than debugged.
  const { root, file } = fixture();
  try {
    const r = run(file);
    assert.equal(r.code, 0);
    assert.match(r.checks.find((c) => c.id === 'ET4').detail,
      /BROADCAST_BATCH_SIZE=5 BROADCAST_BATCH_DELAY_MS=1800/u,
      'the real values must still be read exactly');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET4 reads the constant even when it is the first thing on a line or file', () => {
  // \b is satisfied by a line start as well as by whitespace, but that is
  // worth pinning rather than assuming: a pattern anchored on \s instead
  // would silently miss a declaration at position 0.
  const root = mkdtempSync(join(tmpdir(), 'email-trickle-gate-'));
  const file = join(root, '_email.js');
  try {
    writeFileSync(file, `BROADCAST_BATCH_SIZE = 5;\nBROADCAST_BATCH_DELAY_MS = 1800;\n`
      + readFileSync(REAL, 'utf8')
        .replace('const BROADCAST_BATCH_SIZE = 5;', '')
        .replace('const BROADCAST_BATCH_DELAY_MS = 1800;', ''));
    const r = run(file);
    assert.match(r.checks.find((c) => c.id === 'ET4').detail,
      /BROADCAST_BATCH_SIZE=5 BROADCAST_BATCH_DELAY_MS=1800/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ET4 boundary: 25 passes and 26 fails, so the bound is the stated one', () => {
  // An off-by-one here is invisible in normal use. Both sides asserted, since
  // a bound that rejected everything would satisfy the failure test above.
  const { root: r1, file: f1 } = fixture((s) => swap(s, 'BROADCAST_BATCH_SIZE = 5;', 'BROADCAST_BATCH_SIZE = 25;'));
  try { assert.equal(run(f1).code, 0, '25 is inside the documented 1..25 bound'); } finally { rmSync(r1, { recursive: true, force: true }); }
  const { root: r2, file: f2 } = fixture((s) => swap(s, 'BROADCAST_BATCH_SIZE = 5;', 'BROADCAST_BATCH_SIZE = 26;'));
  try { expectRed(f2, 'ET4'); } finally { rmSync(r2, { recursive: true, force: true }); }
});

test('the brace matcher is not fooled by a destructured signature', () => {
  // extractFn skips the parameter list before looking for the body, because
  // sendBroadcastTrickle's signature ends in `{ from, subject, replyTo, log }`.
  // A matcher that grabbed the FIRST { would capture the param object, find no
  // for-loop in it, and fail ET3 on correct code -- a false positive that would
  // get the gate deleted. Proven by adding another destructured parameter.
  const { root, file } = fixture((s) => swap(s,
    'async function sendBroadcastTrickle(env, recipients, buildEmail, { from, subject, replyTo, log }) {',
    'async function sendBroadcastTrickle(env, recipients, buildEmail, { from, subject, replyTo, log }, { extra } = {}) {'));
  try {
    const r = run(file);
    assert.equal(r.code, 0, `a destructured signature must not break the matcher:\n${JSON.stringify(r, null, 2)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable file exits 2, distinct from a failed check', () => {
  // 2 means "I could not look", 1 means "I looked and it is wrong".
  const r = run(join(tmpdir(), 'definitely-absent-email-file.js'));
  assert.equal(r.code, 2);
  assert.match(r.raw ?? '', /cannot read/u);
});

test('SCOPE, pinned deliberately: the gate guards notifyNewPost and nothing else', () => {
  // Measured 2026-09-18: _email.js has three other bare Promise.all sites,
  // and all three are correct today because their recipient lists are small
  // and fixed -- notifyEventShareLink sends to a one-address constant, and
  // notifyCommentAlert to a comma-separated env var of operators. Neither
  // touches the member roster, so neither needs pacing.
  //
  // What this test records is that the gate would not NOTICE if that changed.
  // A future edit pointing notifyEventShareLink at the roster gets a green
  // ET1-ET4, because ET1 only brace-matches notifyNewPost. This is the gate's
  // calibration, not a bug to fix in a harness: widening it to every function
  // in the file would fail on the three correct call sites above.
  const src = readFileSync(REAL, 'utf8');
  for (const fn of ['notifyEventShareLink', 'notifyCommentAlert']) {
    assert.match(src, new RegExp(`function ${fn}\\b`, 'u'), `${fn} still exists`);
  }
  // The small fixed lists that make those sites safe. If either assertion goes
  // red, that function's audience has changed and it now needs the trickle.
  assert.match(src, /const EVENT_SHARE_LINK_RECIPIENTS = \[[^\]]*\]/u,
    'notifyEventShareLink must keep a hardcoded recipient constant');
  assert.match(src, /env\.COMMUNITY_COMMENT_ALERT_TO/u,
    'notifyCommentAlert must keep reading an operator env var, not a roster query');
  // And the gate really does scope to notifyNewPost: a blast planted in
  // another function is invisible to it.
  const { root, file } = fixture((s) => swap(s,
    'await Promise.all(emailPromises);',
    'await Promise.all(emailPromises); /* a roster blast here would pass */'));
  try {
    assert.equal(run(file).code, 0, 'confirms the scope limit stated above');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
