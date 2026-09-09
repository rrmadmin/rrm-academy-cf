/**
 * console-kit's drift gate, run as a test so it cannot be forgotten.
 *
 * scripts/check-kit.mjs compares every file kit.lock.json records against the
 * sha the last `console-kit sync` wrote. What it proves is that nobody has
 * locally edited a vendored file since that sync -- the silent failure that
 * let byte-identical copies of the same sender drift apart across the estate
 * in the first place. It cannot tell you the kit has moved on; only
 * `console-kit check`, run from the kit repo, can.
 *
 * A red here has exactly two honest exits: revert the local edit, or make the
 * change IN THE KIT (~/iCode/projects/console-kit) and re-sync. Hand-editing
 * kit.lock.json to match a local edit is the failure this exists to make loud.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('every vendored console-kit file matches kit.lock.json', () => {
  let output;
  try {
    output = execFileSync(process.execPath, [resolve(ROOT, 'scripts/check-kit.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    assert.fail(`check-kit reported drift:\n${err.stdout || ''}${err.stderr || ''}`);
  }
  assert.match(output, /check-kit: OK/);
});
