/**
 * Falsification harness for the content review sign-off gate.
 *
 * The gate exists because seven guides shipped unread on 2026-08-24. These tests
 * plant that exact shape, and the other ways the gate could be fooled, and
 * assert it goes RED. A gate nobody has watched fail is a decoration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLINICIAN = 'Dr. Naomi Whittaker, MD';
const GATE = join(dirname(fileURLToPath(import.meta.url)), 'validate-content-review.mjs');
const { UNREVIEWED_AT_GATE_LANDING, UNDATED_AT_GATE_LANDING } = await import(GATE);

/**
 * The grandfathered slugs, registered exactly as the real repo has them, so a
 * should-pass fixture does not trip CR0's stale-entry check. Keeping this
 * derived from the gate's own constants means the two can never drift.
 */
const GRANDFATHERED = [
  ...Object.keys(UNREVIEWED_AT_GATE_LANDING).map((slug) => ({ slug, file: `${slug}/index.astro` })),
  ...Object.keys(UNDATED_AT_GATE_LANDING).map((slug) => ({ slug, file: `${slug}/index.astro`, reviewer: { name: CLINICIAN } })),
];

/** 15 filler guides so the MIN_GUIDES floor is met without touching the buckets. */
function filler(n = 16) {
  return Array.from({ length: n }, (_, i) => ({
    slug: `filler-${i}`, file: `filler-${i}/index.astro`, title: `Filler ${i}`,
    reviewer: { name: CLINICIAN, reviewed_at: '2020-01-01' },
  }));
}

function fixture(guides, extraFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'review-gate-'));
  mkdirSync(join(root, 'ssot'), { recursive: true });
  writeFileSync(join(root, 'ssot/guides.json'), JSON.stringify({ guides }, null, 1));
  for (const [rel, body] of Object.entries(extraFiles)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function run(root, args = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json', ...args],
      { env: { ...process.env, CONTENT_REVIEW_GATE_ROOT: root }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const clean = (root) => rmSync(root, { recursive: true, force: true });

test('THE REGRESSION: a new guide with no reviewer fails CR1', () => {
  const root = fixture([...filler(), { slug: 'ivf-alternatives', file: 'ivf-alternatives/index.astro', title: 'Alternatives to IVF' }]);
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 1, 'a guide nobody has read must not pass');
  assert.match(out, /ivf-alternatives has no review sign-off/);
  assert.match(out, /A guide does not go live unread/);
  clean(root);
});

test('a reviewer NAME without a date still fails for a new guide', () => {
  const root = fixture([...filler(), { slug: 'new-guide', file: 'x/index.astro', reviewer: { name: CLINICIAN } }]);
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 1, 'an undated byline is not a sign-off for a new page');
  assert.match(out, /no valid reviewed_at/);
  clean(root);
});

test('a malformed reviewed_at fails rather than being coerced', () => {
  for (const bad of ['yesterday', '2026-13-45', '08/25/2026', '', 20260825]) {
    const root = fixture([...filler(), { slug: 'new-guide', file: 'x/index.astro', reviewer: { name: CLINICIAN, reviewed_at: bad } }]);
    assert.equal(run(root, ['--quick']).code, 1, `reviewed_at ${JSON.stringify(bad)} must be rejected`);
    clean(root);
  }
});

test('a properly dated sign-off passes', () => {
  const root = fixture([...GRANDFATHERED, ...filler(), { slug: 'new-guide', file: 'x/index.astro', reviewer: { name: CLINICIAN, reviewed_at: '2026-08-25' } }]);
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 0, `should pass; got:\n${out}`);
  clean(root);
});

test('CR3: a non-clinician sign-off on clinical content fails', () => {
  const root = fixture([...filler(), { slug: 'new-guide', file: 'x/index.astro', reviewer: { name: 'Some Marketer', reviewed_at: '2026-08-25' } }]);
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 1);
  assert.match(out, /not in CLINICAL_REVIEWERS/);
  clean(root);
});

test('CR2 STALENESS: editing content after sign-off re-opens it', () => {
  // A real git repo, because CR2's whole point is comparing a sign-off date
  // against the content's last commit date.
  const root = fixture(
    [...filler(), { slug: 'aged', file: 'aged/index.astro', reviewer: { name: CLINICIAN, reviewed_at: '2001-01-01' } }],
    { 'src/data/aged.json': '{"body":"v1"}' },
  );
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 'T');
  git('add', '-A');
  git('commit', '-qm', 'content edited long after the 2001 sign-off');

  const { code, out } = run(root);
  assert.equal(code, 1, 'a sign-off older than the content it vouches for must fail');
  assert.match(out, /aged sign-off is STALE/);
  assert.match(out, /content changed after the review that vouches for it/);
  clean(root);
});

test('CR0: a grandfather entry naming an unregistered slug fails', () => {
  // 'pcos' is in UNREVIEWED_AT_GATE_LANDING; a registry without it means the
  // list has rotted and could be hiding a real gap.
  const root = fixture(filler());
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 1, 'the grandfather list must not rot into cover');
  assert.match(out, /is not a registered guide — stale grandfather entry/);
  clean(root);
});

test('ANTI-VACUITY: a registry that fails to load does not report success', () => {
  const root = fixture([{ slug: 'only-one', file: 'x/index.astro' }]);
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 1);
  assert.match(out, /the registry failed to load, the repo did not shrink/);
  clean(root);
});

// ---------------------------------------------------------------------------
// In-process tests, same rationale as the HEAD gate's: subprocess CLI tests
// above verify real entrypoint behavior, but c8 cannot instrument a subprocess.
// These call the exported functions directly against the real repo so the
// module shows up as covered PRODUCT-CODE, not a c8 blind spot.
import { gateCR0, gateCR1, gateCR2, gateCR3, loadGuides, contentSourceOf, isISODate }
  from './validate-content-review.mjs';

test('in-process: loadGuides() reads the real ssot/guides.json', () => {
  const guides = loadGuides();
  assert.ok(guides.length >= 15);
  assert.ok(guides.some((g) => g.slug === 'endometriosis'));
});

test('in-process: isISODate rejects everything a reviewer might mistype', () => {
  assert.ok(isISODate('2026-08-25'));
  for (const bad of ['yesterday', '2026-13-45', '08/25/2026', '', null, undefined, 20260825]) {
    assert.equal(isISODate(bad), false, `${JSON.stringify(bad)} must not pass as a date`);
  }
});

test('in-process: contentSourceOf() locates a real guide\'s content file', () => {
  const guides = loadGuides();
  const withData = guides.find((g) => g.slug === 'rrm-success-rates');
  assert.equal(contentSourceOf(withData), 'src/data/rrm-success-rates.json');
});

test('in-process: CR0-CR3 run clean against the real repo', () => {
  for (const fn of [gateCR0, gateCR1, gateCR2, gateCR3]) {
    const r = fn();
    const arr = Array.isArray(r) ? r : [r];
    assert.ok(arr.every((x) => x.ok !== false), `expected all-pass, got: ${JSON.stringify(arr.filter((x) => x.ok === false))}`);
  }
});
