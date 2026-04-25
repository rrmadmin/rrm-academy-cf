#!/usr/bin/env node
/**
 * Run Stryker mutation testing scoped to src/lib/**.
 * Emits HTML + JSON to reports/quality/mutation/.
 *
 * Abort policy (lights-off safety):
 *   - Hard wall-clock cap of 15 minutes (MUTATION_TIMEOUT_MS).
 *   - On timeout: SIGTERM Stryker, then SIGKILL after 5s grace.
 *   - Writes reports/quality/mutation/TIMED_OUT marker so dashboard can note it.
 *   - Exits 2 on timeout (distinct from 0 = ok, 1 = crash).
 *
 * Override with env: MUTATION_TIMEOUT_MS=1800000 node scripts/quality/mutation.mjs
 *
 * Usage: node scripts/quality/mutation.mjs
 *
 * Note: mutation testing is slow; budget 2–10 minutes for first run on 16 files.
 * Also note: mutation scores are only meaningful once tests exercise src/lib/.
 * For a pure instrumentation baseline, expect ~100% survival (no tests import
 * src/lib/ yet — that's the baseline signal).
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const MUT_DIR = resolve(ROOT, 'reports', 'quality', 'mutation');
const TIMEOUT_MS = Number(process.env.MUTATION_TIMEOUT_MS ?? 15 * 60 * 1000);

await mkdir(MUT_DIR, { recursive: true });
await unlink(resolve(MUT_DIR, 'TIMED_OUT')).catch(() => {});

const child = spawn('npx', ['stryker', 'run', 'stryker.conf.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});

let timedOut = false;
const killTimer = setTimeout(() => {
  timedOut = true;
  console.error(`\n[mutation] TIMEOUT after ${TIMEOUT_MS}ms — killing Stryker`);
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 5000).unref();
}, TIMEOUT_MS);
killTimer.unref();

child.on('exit', async (code) => {
  clearTimeout(killTimer);
  if (timedOut) {
    await writeFile(resolve(MUT_DIR, 'TIMED_OUT'), `Timed out after ${TIMEOUT_MS}ms at ${new Date().toISOString()}\n`);
    await rm(resolve(ROOT, '.stryker-tmp'), { recursive: true, force: true }).catch(() => {});
    process.exit(2);
  }
  // Stryker exits non-zero if mutation score under threshold; we don't set
  // a threshold, so any non-timeout exit is fine.
  process.exit(code ?? 0);
});
