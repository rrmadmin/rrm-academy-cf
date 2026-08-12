import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRenderGateIds, findMissingRenderGateIds, REQUIRED_IDS, TARGET_FILE,
} from '../scripts/check-render-gate-ids.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

test('both ids present - pass', () => {
  const html = `<script type="application/json" id="nf-known-pages">{}</script>
    <input id="nf-search-input" />`;
  const r = checkRenderGateIds(html);
  assert.equal(r.ok, true);
});

test('nf-known-pages removed - fail with downstream-consumer message', () => {
  const html = `<input id="nf-search-input" />`;
  const r = checkRenderGateIds(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /nf-known-pages/);
  assert.match(r.error, /isNotBuiltShell/);
});

test('nf-search-input removed - fail', () => {
  const html = `<script type="application/json" id="nf-known-pages">{}</script>`;
  const r = checkRenderGateIds(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /nf-search-input/);
});

test('both ids removed - fail listing both', () => {
  const r = checkRenderGateIds('<p>no ids here</p>');
  assert.equal(r.ok, false);
  assert.match(r.error, /nf-known-pages, nf-search-input/);
});

test('id renamed (e.g. nf-search-box) does not satisfy the gate', () => {
  const html = `<script type="application/json" id="nf-known-pages">{}</script>
    <input id="nf-search-box" />`;
  const missing = findMissingRenderGateIds(html);
  assert.deepEqual(missing, ['nf-search-input']);
});

test('single- or double-quoted id attributes both match', () => {
  const html = `<script id='nf-known-pages'>{}</script><input id='nf-search-input' />`;
  const r = checkRenderGateIds(html);
  assert.equal(r.ok, true);
});

test('REQUIRED_IDS matches the pair rrm-library-worker render-verify.js checks', () => {
  assert.deepEqual(REQUIRED_IDS, ['nf-known-pages', 'nf-search-input']);
});

test('the real src/pages/404.astro carries both ids today', () => {
  const html = readFileSync(resolve(REPO_ROOT, TARGET_FILE), 'utf8');
  const r = checkRenderGateIds(html);
  assert.equal(r.ok, true, r.error);
});
