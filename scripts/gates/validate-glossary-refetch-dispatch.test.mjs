// Gate: deploy.yml must honor a full-glossary refetch dispatch, and every run
// must save its own site-data cache entry.
//
// Defect 1 (2026-09-04): there was no payload shape that meant "refetch the
// whole glossary and nothing else". rrm-glossary-review needs one, because a
// per-slug dispatch is unsafe (defect 2).
//
// Defect 2 (pre-existing, bites the manual /glossary-update flow today):
// actions/cache never SAVES on an exact key hit, so with key
// `site-data-<date>` the second and later runs of a day restore the cache the
// FIRST run saved. A single-term splice on top of that stale glossary.json
// silently reverts every term applied in between.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = readFileSync(join(HERE, '..', '..', '.github', 'workflows', 'deploy.yml'), 'utf8');

function stepBlock(name) {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `deploy.yml has no step named "${name}"`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.indexOf('\n      - name: ');
  return next === -1 ? rest : rest.slice(0, next);
}

test('the site-data cache key is unique per run', () => {
  const block = stepBlock('Restore data cache');
  assert.match(block, /key: site-data-\$\{\{ steps\.date\.outputs\.date \}\}-\$\{\{ github\.run_id \}\}/);
});

test('the site-data cache falls back to the newest same-day entry, then any entry', () => {
  const block = stepBlock('Restore data cache');
  const keys = block
    .slice(block.indexOf('restore-keys:'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('site-data-'));
  assert.deepEqual(keys, [
    'site-data-${{ steps.date.outputs.date }}-',
    'site-data-',
  ]);
});

test('the glossary fetch step runs for a full-refetch dispatch', () => {
  const block = stepBlock('Fetch glossary (dispatch)');
  assert.match(block, /github\.event\.client_payload\.glossary_term_id \|\| github\.event\.client_payload\.glossary_refetch == 'all'/);
});

test('the glossary fetch step passes RECORD_ID only for a single-term dispatch', () => {
  const block = stepBlock('Fetch glossary (dispatch)');
  // Empty string is falsy in fetch-glossary-data.mjs, so an absent
  // glossary_term_id makes it run fetchAll(). That is the whole mechanism.
  assert.match(block, /RECORD_ID: \$\{\{ github\.event\.client_payload\.glossary_term_id \}\}/);
});

test('the term id list reaches the log through an env var, never interpolated into a command', () => {
  const block = stepBlock('Fetch glossary (dispatch)');
  assert.match(block, /GLOSSARY_TERM_IDS: \$\{\{ join\(github\.event\.client_payload\.glossary_term_ids, ' '\) \}\}/);
  const runBody = block.slice(block.indexOf('run: |'));
  assert.doesNotMatch(runBody, /\$\{\{/, 'no ${{ }} interpolation inside the run block (script injection)');
});

test('a full-refetch dispatch does not also trigger the seven-fetcher fetch-all', () => {
  const block = stepBlock('Fetch all data');
  assert.match(block, /!github\.event\.client_payload\.glossary_refetch/);
});
