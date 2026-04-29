#!/usr/bin/env node
/**
 * SSOT prebuild for rrm-academy-cf.
 *
 * Mirrors the neofertility-ie pattern. Always regenerates
 * src/generated/ssot-schema.json so Astro layouts can import fresh
 * Organization / Person / WebSite JSON-LD at build time.
 *
 * SITE_SSOT_ENABLED:
 *   "0"           — schema snapshot ONLY; agent-native surfaces skipped.
 *                   Cleans up any stale agent-surface artifacts.
 *   "1" (default) — emit public/agents.md and .well-known/agent-card.json from
 *                   ssot/agent-surfaces.json via ssot-emit. Then restore the
 *                   static llms.txt + llms-full.txt from git-tracked snapshots,
 *                   because the current emitter's llms output is materially
 *                   worse than the hand-curated static versions until Gianna
 *                   fills in the TBD-GIANNA prose placeholders in
 *                   ssot/agent-surfaces.json (Phase 0b).
 *
 * NOTE: Phase 0a-bis decision (2026-04-29). Static llms.txt + llms-full.txt
 * are sourced from `static-overrides/llms.txt` + `static-overrides/llms-full.txt`
 * (project root, NOT `public/`, so they don't deploy as duplicate URLs).
 * Once Gianna fills the SSOT prose, we remove the static restore step and let
 * ssot-emit fully own these files.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TOOL_ROOT = resolve(PROJECT_ROOT, '../../tools/site-ssot');

const raw = process.env.SITE_SSOT_ENABLED;
const flag = raw === undefined ? '1' : raw;
if (flag !== '0' && flag !== '1') {
  console.error(`[ssot-prebuild] FATAL: SITE_SSOT_ENABLED must be "0" or "1" (got ${JSON.stringify(raw)})`);
  process.exit(1);
}

// Phase 0a-bis: re-snapshot ssot/courses.json from src/data/courses.json
// (the D1-fetched + override-merged build artifact). Runs BEFORE schema +
// agent-surface emission so adds/removes/renames in D1 flow through to the
// SSOT and downstream agent-native surfaces in a single build.
const coursesSnapshotter = resolve(PROJECT_ROOT, 'scripts/ssot-courses-snapshot.mjs');
if (existsSync(coursesSnapshotter)) {
  const cres = spawnSync('node', [coursesSnapshotter], {
    stdio: 'inherit',
    env: process.env,
  });
  if (cres.status !== 0) {
    console.error(`[ssot-prebuild] FATAL: ssot-courses-snapshot exited ${cres.status}`);
    process.exit(cres.status || 1);
  }
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
  env: { ...process.env, SITE_SSOT_ENABLED: '1' },
});
if (res.status !== 0) {
  console.error(`[ssot-prebuild] FATAL: ssot-emit exited ${res.status}`);
  process.exit(res.status || 1);
}

// Phase 0a-bis: restore static llms.txt + llms-full.txt from snapshots in
// public/_static/. The current ssot-emit llms emitters produce output that is
// materially worse than the hand-curated static versions until Gianna fills
// the TBD-GIANNA prose placeholders in ssot/agent-surfaces.json.
const STATIC_RESTORES = [
  ['static-overrides/llms.txt', 'public/llms.txt'],
  ['static-overrides/llms-full.txt', 'public/llms-full.txt'],
];
let restored = 0;
for (const [from, to] of STATIC_RESTORES) {
  const fromAbs = resolve(PROJECT_ROOT, from);
  const toAbs = resolve(PROJECT_ROOT, to);
  if (existsSync(fromAbs)) {
    copyFileSync(fromAbs, toAbs);
    restored++;
  } else {
    console.error(`[ssot-prebuild] WARN: static snapshot missing at ${from}`);
  }
}
if (restored > 0) {
  console.log(`[ssot-prebuild]   (restored ${restored} static llms.txt snapshot(s))`);
}
console.log('[ssot-prebuild] complete');
