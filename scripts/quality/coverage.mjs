#!/usr/bin/env node
/**
 * Run c8 over the existing node:test suite, scoped to src/lib/**.
 * Writes HTML + JSON reports to reports/quality/coverage/.
 *
 * Exit policy:
 *   - Tests may fail (existing test/ directory includes functions/api tests
 *     that import things not on this branch; their failure is not our concern
 *     here). We tolerate non-zero c8 exit ONLY if coverage-final.json landed.
 *   - If the JSON report is absent after the run, something went catastrophically
 *     wrong (c8 itself crashed, wrong Node version, etc.). Exit 1 with a clear
 *     error so the dashboard shows a failure rather than stale data.
 *
 * Usage: node scripts/quality/coverage.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function globTestFiles() {
  const dir = resolve(ROOT, 'test');
  const entries = await readdir(dir);
  return entries.filter(f => f.endsWith('.test.js')).map(f => `test/${f}`);
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'reports', 'quality', 'coverage');
const JSON_REPORT = resolve(OUT, 'coverage-final.json');

await mkdir(OUT, { recursive: true });

const args = [
  'c8',
  '--reporter=json',
  '--reporter=html',
  '--reporter=text-summary',
  '--report-dir', OUT,
  '--include', 'src/lib/**',
  '--exclude', 'test/**',
  '--all',
  'node', '--test', ...await globTestFiles(),
];

console.log(`[coverage] running: npx ${args.join(' ')}`);
const child = spawn('npx', args, { cwd: ROOT, stdio: 'inherit' });
child.on('exit', async (code) => {
  try {
    await access(JSON_REPORT);
    if (code !== 0) {
      console.warn(`[coverage] tests exited ${code} but coverage-final.json landed — continuing.`);
    }
    process.exit(0);
  } catch {
    console.error(`[coverage] FATAL: coverage-final.json missing at ${JSON_REPORT}`);
    console.error(`[coverage] c8 child exited ${code} and produced no JSON. See logs above.`);
    process.exit(1);
  }
});
