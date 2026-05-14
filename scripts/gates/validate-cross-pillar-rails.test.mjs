import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRails } from './validate-cross-pillar-rails.mjs';

const LIVE_HTML = `<html><body><a class="audience-rail" href="/for-providers/">Are you a clinician?</a></body></html>`;
const INERT_HTML = `<html><body><span class="audience-rail audience-rail--inert" role="link" aria-disabled="true" data-rail-state="inert" data-future-href="/for-providers/">Are you a clinician?<span class="sr-only"> (coming soon)</span></span></body></html>`;
const LEFTOVER_HTML = `<html><body><a class="audience-rail" href="/for-providers/" data-future-href="/for-providers/">Are you a clinician?</a></body></html>`;

test('back-edit mode: live rail to target passes', () => {
  const r = checkRails(LIVE_HTML, { mode: 'back-edit', target: '/for-providers/' });
  assert.equal(r.ok, true);
});

test('back-edit mode: inert rail to target fails', () => {
  const r = checkRails(INERT_HTML, { mode: 'back-edit', target: '/for-providers/' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not converted to live/);
});

test('no-leftovers mode: clean live rail passes', () => {
  const r = checkRails(LIVE_HTML, { mode: 'no-leftovers' });
  assert.equal(r.ok, true);
});

test('no-leftovers mode: lone data-future-href fails', () => {
  const r = checkRails(LEFTOVER_HTML, { mode: 'no-leftovers' });
  assert.equal(r.ok, false);
  assert.match(r.error, /data-future-href/);
});

test('no-leftovers mode: inert rail (during Phase 1) fails by design', () => {
  // Use no-leftovers ONLY post-back-edit. Inert state has these attrs by design.
  const r = checkRails(INERT_HTML, { mode: 'no-leftovers' });
  assert.equal(r.ok, false);
});

test('new-ship mode: pillar contains live rail to already-shipped sibling', () => {
  const r = checkRails(LIVE_HTML, { mode: 'new-ship', sibling: '/for-providers/' });
  assert.equal(r.ok, true);
});

test('new-ship mode: pillar missing rail to sibling fails', () => {
  const r = checkRails('<html><body><p>no rail</p></body></html>', { mode: 'new-ship', sibling: '/getting-started/' });
  assert.equal(r.ok, false);
});

test('inverted (rollback) mode: inert rail present, live rail absent passes', () => {
  const r = checkRails(INERT_HTML, { mode: 'inverted', target: '/for-providers/' });
  assert.equal(r.ok, true);
});

test('inverted mode: live rail still present fails rollback verification', () => {
  const r = checkRails(LIVE_HTML, { mode: 'inverted', target: '/for-providers/' });
  assert.equal(r.ok, false);
});

// parseArgs regression tests (commit 5185d14 bugs)
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __filename = new URL(import.meta.url).pathname;
const SCRIPT = join(__filename, '..', 'validate-cross-pillar-rails.mjs');

test('CLI: bare unknown flag does not swallow --mode', () => {
  const fakeFile = join(tmpdir(), `cli-test-${Date.now()}.html`);
  writeFileSync(fakeFile, '<html><body><a class="audience-rail" href="/for-providers/">x</a></body></html>');
  try {
    const r = spawnSync('node', [SCRIPT, '--verbose', `--file=${fakeFile}`, '--mode=back-edit', '--target=/for-providers/'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `Expected exit 0 (ok); got ${r.status}. stderr: ${r.stderr}`);
  } finally {
    unlinkSync(fakeFile);
  }
});

test('CLI: --target= (empty value) does not swallow next argument', () => {
  const fakeFile = join(tmpdir(), `cli-test-${Date.now()}.html`);
  writeFileSync(fakeFile, '<html><body></body></html>');
  try {
    // --target= (empty), --mode=back-edit should still be parsed correctly
    const r = spawnSync('node', [SCRIPT, `--file=${fakeFile}`, '--target=', '--mode=back-edit'], { encoding: 'utf8' });
    // Empty target should fail with "back-edit mode requires --target" (because empty string is falsy in the back-edit branch)
    assert.equal(r.status, 1, `Expected exit 1 (fail). stderr: ${r.stderr}`);
    assert.match(r.stderr, /requires --target/);
  } finally {
    unlinkSync(fakeFile);
  }
});
