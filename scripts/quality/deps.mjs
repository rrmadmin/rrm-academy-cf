#!/usr/bin/env node
/**
 * Run dependency-cruiser against src/lib with our config.
 * Writes reports/quality/deps.json. Exits 0 even on violations — this
 * is a baseline, not a gate.
 *
 * Usage: node scripts/quality/deps.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'reports', 'quality', 'deps.json');
await mkdir(resolve(ROOT, 'reports', 'quality'), { recursive: true });

const args = [
  'depcruise',
  '--config', '.dependency-cruiser.cjs',
  '--output-type', 'json',
  'src/lib',
];

console.log(`[deps] running: npx ${args.join(' ')}`);

const child = spawn('npx', args, { cwd: ROOT });
let stdout = '';
let stderr = '';
child.stdout.on('data', d => { stdout += d.toString(); });
child.stderr.on('data', d => { stderr += d.toString(); });

child.on('exit', async (code) => {
  if (stdout) {
    await writeFile(OUT, stdout);
    try {
      const report = JSON.parse(stdout);
      const violations = report.summary?.violations ?? [];
      console.log(`[deps] wrote ${OUT} — ${violations.length} violation(s)`);
      for (const v of violations) {
        console.log(`[deps]   ${v.rule?.severity ?? '?'} ${v.rule?.name ?? '?'}: ${v.from} -> ${v.to}`);
      }
    } catch {
      console.log(`[deps] wrote ${OUT} (parse skipped)`);
    }
  } else {
    console.error('[deps] no stdout captured from depcruise');
    if (stderr) console.error(stderr);
  }
  // Always exit 0 — baseline, not a gate.
  process.exit(0);
});
