#!/usr/bin/env node
/**
 * SSOT postbuild for rrm-academy-cf.
 *
 * Runs after astro build to emit public/schemamap.xml via the site-ssot tool,
 * then runs the standards-gate against dist/.
 *
 * CI fallback: when ../../tools/site-ssot/ or ../../tools/standards-gate/
 * isn't present (the tools live at ~/iCode/tools/* on Brian's local machine
 * but aren't vendored into this repo), skip that step gracefully so the
 * deploy can proceed. Mirrors the same pattern used in scripts/ssot-prebuild.mjs.
 *
 * Restore full behavior by vendoring tools/site-ssot/ + tools/standards-gate/
 * into the repo or publishing them as npm packages.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SITE_SSOT_ROOT = resolve(PROJECT_ROOT, '../../tools/site-ssot');
const STANDARDS_GATE_ROOT = resolve(PROJECT_ROOT, '../../tools/standards-gate');

const schemamap = resolve(SITE_SSOT_ROOT, 'bin/ssot-schemamap.mjs');
if (!existsSync(schemamap)) {
  console.warn(`[ssot-postbuild] WARN: ssot-schemamap.mjs not found at ${schemamap} — skipped (CI fallback)`);
} else {
  console.log('[ssot-postbuild] emitting schemamap.xml');
  const res = spawnSync('node', [schemamap, '--project', PROJECT_ROOT], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`[ssot-postbuild] FATAL: ssot-schemamap exited ${res.status}`);
    process.exit(res.status || 1);
  }
}

const standardsGate = resolve(STANDARDS_GATE_ROOT, 'run.mjs');
const distDir = resolve(PROJECT_ROOT, 'dist');
if (!existsSync(standardsGate)) {
  console.warn(`[ssot-postbuild] WARN: standards-gate not found at ${standardsGate} — skipped (CI fallback)`);
} else if (!existsSync(distDir)) {
  console.warn(`[ssot-postbuild] WARN: dist/ not found at ${distDir} — standards-gate skipped`);
} else {
  console.log('[ssot-postbuild] running standards-gate against dist/');
  const res = spawnSync('node', ['--max-old-space-size=8192', standardsGate, distDir], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`[ssot-postbuild] FATAL: standards-gate exited ${res.status}`);
    process.exit(res.status || 1);
  }
}
