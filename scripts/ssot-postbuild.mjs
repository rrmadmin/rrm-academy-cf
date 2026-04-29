#!/usr/bin/env node
/**
 * SSOT postbuild for rrm-academy-cf.
 *
 * Runs after astro build to emit public/schemamap.xml via the site-ssot tool,
 * then runs the standards-gate stub.
 *
 * CI fallback: when ../../tools/site-ssot/ isn't present (the tool lives at
 * ~/iCode/tools/site-ssot/ on Brian's local machine but isn't vendored into
 * this repo), skip the schemamap emit gracefully so the deploy can proceed.
 * Mirrors the same pattern used in scripts/ssot-prebuild.mjs.
 *
 * Restore full behavior by vendoring tools/site-ssot/ into the repo or
 * publishing it as an npm package.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TOOL_ROOT = resolve(PROJECT_ROOT, '../../tools/site-ssot');

const schemamap = resolve(TOOL_ROOT, 'bin/ssot-schemamap.mjs');
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

// standards-gate is a stub (pending Phase 9 per package.json comment); just echo.
console.log('standards-gate: pending Phase 9');
