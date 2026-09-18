/**
 * Falsification harness for the gate that demands every gate have a harness.
 *
 * It would be absurd for this one to be the untested gate, and the absurdity
 * is the point: the defect it exists to prevent is a gate nobody has watched
 * fail. So each check below plants the exact shape it must refuse and asserts
 * it goes RED, and each one was proven by weakening the corresponding
 * assertion in the gate and confirming this file caught it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'validate-gates-have-tests.mjs');

/**
 * A fixture repo: a scripts/gates directory holding exactly the files named.
 * `gates` are gate basenames, `tested` the subset that also get a .test.mjs,
 * `exemptions` the JSON written to gates-without-tests.json (omit for none).
 *
 * The gate itself is copied in, because it demands a test of every gate
 * including itself and a fixture without it would be testing a different
 * question than the real repo asks.
 */
function fixture({ gates = [], tested = [], exemptions = undefined, rawExemptions = undefined }) {
  const root = mkdtempSync(join(tmpdir(), 'gates-have-tests-'));
  const dir = join(root, 'scripts/gates');
  mkdirSync(dir, { recursive: true });

  for (const g of ['validate-gates-have-tests', ...gates]) {
    writeFileSync(join(dir, `${g}.mjs`), '// fixture gate\n');
  }
  for (const g of ['validate-gates-have-tests', ...tested]) {
    writeFileSync(join(dir, `${g}.test.mjs`), '// fixture harness\n');
  }
  if (rawExemptions !== undefined) {
    writeFileSync(join(dir, 'gates-without-tests.json'), rawExemptions);
  } else if (exemptions !== undefined) {
    writeFileSync(join(dir, 'gates-without-tests.json'), JSON.stringify({ gates: exemptions }, null, 2));
  }
  return root;
}

function run(root) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json'],
      { env: { ...process.env, GATES_TEST_GATE_ROOT: root }, encoding: 'utf8' });
    return { code: 0, ...JSON.parse(out) };
  } catch (err) {
    let parsed = {};
    try { parsed = JSON.parse(err.stdout || '{}'); } catch { /* non-JSON exit */ }
    return { code: err.status, raw: `${err.stdout ?? ''}${err.stderr ?? ''}`, ...parsed };
  }
}

const REASON = 'no harness yet: this gate reads the live D1 and a fixture tree cannot stand in for it';

test('THE REAL REPO SATISFIES THIS GATE (the only test here that is not a fixture)', () => {
  // Everything else in this file drives the gate over a temp tree, which proves
  // the gate works and proves nothing about rrm-academy-cf. This one runs it
  // with NO root override, against scripts/gates as it actually stands, and is
  // what makes the gate enforcing rather than merely present -- `npm test`
  // already globs scripts/gates/*.test.mjs, so a new untested gate turns the
  // suite red here without a workflow edit.
  //
  // A failure means one of two things and the output says which: a gate was
  // added with neither a harness nor an entry in gates-without-tests.json, or
  // an entry there has gone stale because its gate gained a test or was
  // renamed. The fix is never to widen the list.
  const out = execFileSync(process.execPath, [GATE, '--json'], { encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.equal(r.failures, 0, `the real scripts/gates directory does not satisfy this gate:\n${out}`);
  assert.ok(r.gates >= 20, `expected the real gate directory, found only ${r.gates} gates — is the root override leaking?`);
  assert.equal(r.tested + r.exempt, r.gates,
    'every gate must be either tested or exempt, with nothing unaccounted for');
});

test('a gate with a test and no exemptions passes', () => {
  const root = fixture({ gates: ['validate-alpha'], tested: ['validate-alpha'] });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.equal(r.failures, 0);
    assert.equal(r.gates, 2, 'the gate counts itself');
    assert.equal(r.tested, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a new gate with no test and no exemption fails, and is named', () => {
  const root = fixture({ gates: ['validate-brand-new'] });
  try {
    const r = run(root);
    assert.equal(r.code, 1, 'a gate born without a test must not pass');
    assert.ok(r.items.some((i) => i.ok === false && /validate-brand-new\.mjs/u.test(i.msg)),
      'the failing item must name the gate, or the operator cannot act on it');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a written exemption of sufficient length is accepted, and reads as neither pass nor fail', () => {
  const root = fixture({ gates: ['validate-legacy'], exemptions: { 'validate-legacy.mjs': REASON } });
  try {
    const r = run(root);
    assert.equal(r.code, 0);
    assert.equal(r.exempt, 1);
    const row = r.items.find((i) => /validate-legacy\.mjs exempt/u.test(i.msg));
    assert.ok(row, 'the exemption is reported');
    assert.equal(row.ok, null, 'an exemption is a warn, not a pass: it must not read as coverage');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a one-word exemption reason fails: writing nothing down is not an exemption', () => {
  const root = fixture({ gates: ['validate-lazy'], exemptions: { 'validate-lazy.mjs': 'later' } });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.ok(r.items.some((i) => i.ok === false && /under 40 characters/u.test(i.msg)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a stale exemption fails once the gate gains a test', () => {
  // The list may only shrink. This is the carve-out-rot check PG0 runs on its
  // own NOT_A_WEBHOOK_HANDLER entries: an exemption that outlives its reason
  // stops describing the repo and starts describing its own history.
  const root = fixture({
    gates: ['validate-caught-up'], tested: ['validate-caught-up'],
    exemptions: { 'validate-caught-up.mjs': REASON },
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1, 'an exemption for a gate that now has a test must fail');
    assert.ok(r.items.some((i) => i.ok === false && /still exempts .*but it now HAS a test/u.test(i.msg)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an exemption naming a gate that no longer exists fails, so renames cannot hide', () => {
  const root = fixture({ gates: ['validate-alpha'], tested: ['validate-alpha'],
    exemptions: { 'validate-deleted.mjs': REASON } });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.ok(r.items.some((i) => i.ok === false && /not a gate in this directory/u.test(i.msg)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable exemptions file FAILS rather than reading as no exemptions', () => {
  // The fail-open reading would exempt every gate in the repo at once, which
  // is the defect class this gate belongs to. Asserted on the raw output
  // because this path exits before the JSON report is built.
  //
  // EVERY GATE HERE IS TESTED, deliberately. The first version of this fixture
  // left validate-alpha untested, so the gate exited 1 on the missing-test
  // check and this test's `code === 1` passed for the wrong reason -- it went
  // green even with the exit replaced by `return {}`. Proven decoration on
  // 2026-09-18 and fixed by removing every OTHER reason to fail, so the
  // unreadable file is the only thing that can produce a non-zero exit.
  const root = fixture({ gates: ['validate-alpha'], tested: ['validate-alpha'], rawExemptions: '{ this is not json' });
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.raw ?? '', /not readable JSON/u);
    assert.match(r.raw ?? '', /must never be read as "no exemptions"/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: the summary row never credits a written reason that does not exist', () => {
  // The original row read "<n> exempt with written reasons" for every untested
  // gate whether or not any reason existed, and was a hardcoded pass. Run
  // against the real repo on 2026-09-18 it printed a GREEN row claiming 15
  // written reasons against an exemption list that did not exist yet — the
  // gate's own defect class, in the gate. One untested gate, no exemptions:
  // the row must count it as unexplained and must not read as a pass.
  const root = fixture({ gates: ['validate-bare'] });
  try {
    const r = run(root);
    const row = r.items.find((i) => /of \d+ gates have a test/u.test(i.msg));
    assert.ok(row, 'the summary row is still printed');
    assert.equal(row.ok, false, 'a gate with neither a test nor a reason must not summarise as a pass');
    assert.match(row.msg, /0 exempt with a written reason/u);
    assert.match(row.msg, /1 with NEITHER/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the summary row passes, and says so accurately, once the gate IS exempt', () => {
  // The other direction: the row must still go green for a real exemption, or
  // the list would be useless and the fix above would just be a blanket fail.
  const root = fixture({ gates: ['validate-bare'], exemptions: { 'validate-bare.mjs': REASON } });
  try {
    const r = run(root);
    const row = r.items.find((i) => /of \d+ gates have a test/u.test(i.msg));
    assert.equal(row.ok, true);
    assert.match(row.msg, /1 exempt with a written reason/u);
    assert.doesNotMatch(row.msg, /NEITHER/u);
    assert.equal(r.code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a .test.mjs file is never itself counted as a gate needing a test', () => {
  // Otherwise every harness written would demand a harness, and the gate
  // would be unsatisfiable by construction.
  const root = fixture({ gates: ['validate-alpha'], tested: ['validate-alpha'] });
  try {
    const r = run(root);
    assert.equal(r.gates, 2, 'two gates, not four: the .test.mjs files are not gates');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
