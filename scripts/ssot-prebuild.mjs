#!/usr/bin/env node
/**
 * SSOT prebuild for rrm-academy-cf.
 *
 * Mirrors the neofertility-ie pattern. Always regenerates
 * src/generated/ssot-schema.json so Astro layouts can import fresh
 * Organization / Person / WebSite JSON-LD at build time.
 *
 * SITE_SSOT_ENABLED:
 *   "0" (default) — schema snapshot ONLY; agent-native surfaces skipped.
 *   "1"           — also emit public/llms.txt, llms-full.txt, agents.md,
 *                   .well-known/agent-card.json via ssot-emit.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TOOL_ROOT = resolve(PROJECT_ROOT, '../../tools/site-ssot');

const raw = process.env.SITE_SSOT_ENABLED;
const flag = raw === undefined ? '0' : raw;
if (flag !== '0' && flag !== '1') {
  console.error(`[ssot-prebuild] FATAL: SITE_SSOT_ENABLED must be "0" or "1" (got ${JSON.stringify(raw)})`);
  process.exit(1);
}

const generatedDir = resolve(PROJECT_ROOT, 'src/generated');
mkdirSync(generatedDir, { recursive: true });
const schemaWriter = resolve(TOOL_ROOT, 'bin/ssot-emit-schema.mjs');
if (!existsSync(schemaWriter)) {
  console.error(`[ssot-prebuild] FATAL: ssot-emit-schema.mjs not found at ${schemaWriter}`);
  process.exit(1);
}
const schemaOut = resolve(generatedDir, 'ssot-schema.json');
const sres = spawnSync('node', [schemaWriter, '--project', PROJECT_ROOT, '--out', schemaOut], {
  stdio: 'inherit',
  env: process.env,
});
if (sres.status !== 0) {
  console.error(`[ssot-prebuild] FATAL: ssot-emit-schema exited ${sres.status}`);
  process.exit(sres.status || 1);
}

if (flag === '0') {
  console.log(`[ssot-prebuild] SITE_SSOT_ENABLED=0 — agent-native surfaces skipped (schema snapshot regenerated)`);
  const cleanupPaths = [
    'public/llms.txt',
    'public/llms-full.txt',
    'public/agents.md',
    'public/.well-known/agent-card.json',
    'public/schemamap.xml',
    'public/.ssot-stage',
  ];
  let cleaned = 0;
  for (const rel of cleanupPaths) {
    const full = resolve(PROJECT_ROOT, rel);
    try {
      rmSync(full, { recursive: true, force: true });
      cleaned++;
    } catch {
      // no-op
    }
  }
  if (cleaned > 0) {
    console.log(`[ssot-prebuild]   (cleaned ${cleaned} stale agent-surface outputs)`);
  }
  process.exit(0);
}

console.log(`[ssot-prebuild] SITE_SSOT_ENABLED=1 — emitting agent-native surfaces`);
const ssotEmit = resolve(TOOL_ROOT, 'bin/ssot-emit.mjs');
const res = spawnSync('node', [ssotEmit, '--project', PROJECT_ROOT], {
  stdio: 'inherit',
  env: process.env,
});
if (res.status !== 0) {
  console.error(`[ssot-prebuild] FATAL: ssot-emit exited ${res.status}`);
  process.exit(res.status || 1);
}
console.log('[ssot-prebuild] complete');
