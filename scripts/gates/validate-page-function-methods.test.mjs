/**
 * Falsification harness for the page-function HEAD gate.
 *
 * A gate nobody has watched go red is a decoration. These tests build throwaway
 * fixture repos, plant a defect in each, and assert the gate FAILS — including
 * the exact original defect (functions/events/[slug].js exporting only
 * onRequestGet, which 404'd HEAD and silently killed every X link card for the
 * STUC event invites on 2026-08-25).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'validate-page-function-methods.mjs');

/** Build a fixture repo; files is {relPath: contents}. Returns its root. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'pagefn-gate-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/** Run the gate against a fixture. Returns {code, out}. */
function run(root, args = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json', ...args], {
      env: { ...process.env, PAGE_FN_GATE_ROOT: root },
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const HTML_GET_ONLY = `
export async function onRequestGet({ params }) {
  return new Response('<html><head><meta property="og:image" content="x"></head></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
`;
const HTML_WITH_HEAD = HTML_GET_ONLY + `
export async function onRequestHead(ctx) { return onRequestGet(ctx); }
`;
const HTML_CATCH_ALL = `
export const onRequest = async () =>
  new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
`;
const IMAGE_GET_ONLY = `
export async function onRequestGet() {
  return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
}
`;
/**
 * Baseline fixture: a healthy repo. It carries BOTH coverage sentinels the gate
 * insists on (HM0 fails if either falls out of the enumeration) plus a filler
 * route so the MIN_IN_SCOPE floor is met. Each test then overrides exactly one
 * file, so a red result is attributable to the planted defect and nothing else.
 */
const FILLER = {
  'functions/a.js': HTML_CATCH_ALL,
  'functions/events/[slug].js': HTML_CATCH_ALL,
  'functions/og/[[path]].js': HTML_CATCH_ALL,
  // HM0 fails an EXCLUDED entry whose file has vanished, which is the check that
  // stops the exclusion list rotting into cover for real drift. Fixtures carry a
  // stub so that guard stays armed against the real repo without reddening tests.
  'functions/save-the-uterus-club/migrate.js': HTML_CATCH_ALL,
};

test('THE REGRESSION: a page route exporting only onRequestGet fails HM1', () => {
  const root = fixture({ ...FILLER, 'functions/events/[slug].js': HTML_GET_ONLY });
  const { code, out } = run(root);
  assert.equal(code, 1, 'gate must FAIL on the original defect');
  assert.match(out, /events\/\[slug\]\.js does not answer HEAD/);
  assert.match(out, /404 HEAD on this route while GET returns 200/);
  rmSync(root, { recursive: true, force: true });
});

test('the same route passes once onRequestHead is exported', () => {
  const root = fixture({ ...FILLER, 'functions/events/[slug].js': HTML_WITH_HEAD });
  const { code, out } = run(root);
  assert.equal(code, 0, `gate must PASS once fixed; got:\n${out}`);
  assert.match(out, /answers HEAD \(onRequestHead\)/);
  rmSync(root, { recursive: true, force: true });
});

test('a catch-all onRequest also satisfies HM1', () => {
  const root = fixture({ ...FILLER, 'functions/events/[slug].js': HTML_CATCH_ALL });
  assert.equal(run(root).code, 0);
  rmSync(root, { recursive: true, force: true });
});

test('IMAGE routes are in scope: an og-image route with no HEAD fails', () => {
  // The first draft of this gate scoped to text/html only and lost the OG image
  // route entirely, which is the one a card crawler fetches second.
  const root = fixture({ ...FILLER, 'functions/og/[[path]].js': IMAGE_GET_ONLY });
  const { code, out } = run(root);
  assert.equal(code, 1, 'an image route that cannot answer HEAD must fail');
  assert.match(out, /og\/\[\[path\]\]\.js does not answer HEAD/);
  rmSync(root, { recursive: true, force: true });
});

test('a comment mentioning onRequestHead does NOT satisfy the gate', () => {
  const root = fixture({
    ...FILLER,
    'functions/events/[slug].js':
      '// TODO: add onRequestHead here\n/* onRequestHead */\n' + HTML_GET_ONLY,
  });
  const { code, out } = run(root);
  assert.equal(code, 1, 'comment-stripping must prevent a docstring from faking compliance');
  assert.match(out, /does not answer HEAD/);
  rmSync(root, { recursive: true, force: true });
});

test('functions/api/** is out of scope and never fails the gate', () => {
  const root = fixture({ ...FILLER, 'functions/api/auth/google.js': HTML_GET_ONLY });
  assert.equal(run(root).code, 0, 'API endpoints are not shareable surfaces');
  rmSync(root, { recursive: true, force: true });
});

test('_-prefixed helpers and _-prefixed dirs are not treated as routes', () => {
  const root = fixture({
    ...FILLER,
    'functions/_middleware.js': HTML_GET_ONLY,
    'functions/events/_tracking.js': HTML_GET_ONLY,
  });
  assert.equal(run(root).code, 0);
  rmSync(root, { recursive: true, force: true });
});

test('ANTI-VACUITY: an empty scan fails HM2 rather than reporting success', () => {
  const root = fixture({ 'package.json': '{}' });
  const { code, out } = run(root);
  assert.equal(code, 1, 'a scan that checks nothing must not print OK');
  assert.match(out, /the scan has broken, not the repo shrunk|must not report success by checking nothing/);
  rmSync(root, { recursive: true, force: true });
});
