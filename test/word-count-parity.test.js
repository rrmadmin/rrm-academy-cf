/**
 * Parity test for computeWordCount between rrm-academy-cf's backfill script
 * and rrm-library-worker's runtime helper.
 *
 * Two copies exist on purpose (the script runs under Node CLI, the worker
 * runs in CF Workers). Both must produce identical output for every input,
 * or thin-page detection (noindex below word_count < 30) drifts.
 *
 * Run: node --test test/word-count-parity.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { computeWordCount as scriptCompute } from '../scripts/compute-word-counts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '../../rrm-library-worker/src/word-count.js');

/**
 * Load worker's computeWordCount via vm sandbox so we don't need a sibling
 * import path. Returns null if worker repo not present.
 */
function loadWorkerCompute() {
  if (!existsSync(WORKER_PATH)) return null;
  const src = readFileSync(WORKER_PATH, 'utf-8');
  // Strip the `export` keyword so the function lives in module scope, then
  // expose it via a trailing assignment to a sandbox slot.
  const stripped = src.replace(/export\s+function/g, 'function');
  const sandbox = { module: {}, exports: {}, fn: null };
  vm.createContext(sandbox);
  vm.runInContext(stripped + '\nfn = computeWordCount;', sandbox);
  return sandbox.fn;
}

const workerCompute = loadWorkerCompute();

// Inputs both algorithms must agree on. [input, options]
const CASES = [
  // Null/undefined/empty
  [null, undefined],
  [undefined, undefined],
  ['', undefined],
  ['   ', undefined],
  // Plain text
  ['hello', undefined],
  ['hello world', undefined],
  ['hello\nworld', undefined],
  // HTML stripping
  ['<p>hello</p>', { stripHtml: true }],
  ['<p>P&amp;C</p>', { stripHtml: true }],
  ["<a href='x'>link</a> text", { stripHtml: true }],
  ['hello <b>world</b>', { stripHtml: true }],
  ['&nbsp;&amp;&ndash;', { stripHtml: true }],
  // Edge cases
  ['a-b-c', undefined],
  ['1 2 3', undefined],
  ['  multiple   spaces  ', undefined],
  ['<p>hello', { stripHtml: true }],   // unclosed tag
  // Non-string inputs (defense-in-depth)
  [42, undefined],
  [true, undefined],
  [{ toString: () => 'tricked' }, undefined],
  [['a', 'b'], undefined],
];

test('parity: backfill script vs worker computeWordCount', { skip: !workerCompute ? 'worker repo not present at ../rrm-library-worker' : false }, () => {
  for (const [input, opts] of CASES) {
    const scriptVal = scriptCompute(input, opts);
    const workerVal = workerCompute(input, opts);
    assert.equal(
      scriptVal,
      workerVal,
      `parity drift for input=${JSON.stringify(input)} opts=${JSON.stringify(opts)}: ` +
      `script=${scriptVal} worker=${workerVal}`
    );
  }
});

// Anchor tests that lock the specific behaviors fixed by the audit (entity
// strip uses empty string, non-string returns 0). These run even when the
// worker repo isn't present so the script's contract is asserted standalone.
test('script: HTML entity strip yields empty (P&amp;C reads as 1 word)', () => {
  assert.equal(scriptCompute('<p>P&amp;C</p>', { stripHtml: true }), 1);
});

test('script: non-string input returns 0', () => {
  assert.equal(scriptCompute(42), 0);
  assert.equal(scriptCompute(true), 0);
  assert.equal(scriptCompute({}), 0);
  assert.equal(scriptCompute([]), 0);
});

test('script: null/undefined/empty returns 0', () => {
  assert.equal(scriptCompute(null), 0);
  assert.equal(scriptCompute(undefined), 0);
  assert.equal(scriptCompute(''), 0);
  assert.equal(scriptCompute('   '), 0);
});
