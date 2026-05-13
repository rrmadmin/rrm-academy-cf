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
import { existsSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TOOL_ROOT = resolve(PROJECT_ROOT, '../../tools/site-ssot');

// CI fallback: if the site-ssot tool isn't present (e.g. GitHub Actions runner
// where ~/iCode/tools/site-ssot/ doesn't exist), emit a minimal schema snapshot
// from the local ssot/*.json + src/data/team.json. Skip agent-surfaces emission;
// the static-overrides/ copy step still runs at the end. Restore full behavior
// once the tool is vendored or published.
function emitFallbackSchema(generatedDir) {
  const schemaOut = resolve(generatedDir, 'ssot-schema.json');
  const org = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'ssot/organization.json'), 'utf8'));
  const site = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'ssot/site.json'), 'utf8'));
  let team = { members: [] };
  try {
    team = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'src/data/team.json'), 'utf8'));
  } catch {
    // team.json optional; people array stays empty
  }
  const orgTypes = Array.isArray(org.types) && org.types.length ? org.types : ['Organization'];
  const stub = {
    organization: {
      '@type': orgTypes,
      '@id': org['@id'] || `${site.url}/#organization`,
      name: site.name || org.legal_name || 'RRM Academy',
      url: site.url || 'https://rrmacademy.org',
      sameAs: Array.isArray(org.same_as) ? org.same_as : [],
    },
    website: {
      '@type': 'WebSite',
      '@id': `${site.url || 'https://rrmacademy.org'}/#website`,
      name: site.name || 'RRM Academy',
      url: site.url || 'https://rrmacademy.org',
      description: site.description || '',
    },
    people: (team.members || []).map((m) => ({
      '@type': 'Person',
      '@id': m.ssot_id || `${site.url || 'https://rrmacademy.org'}/#${(m.given_name || '').toLowerCase()}-${(m.family_name || '').toLowerCase()}`,
      name: m.name || `${m.given_name || ''} ${m.family_name || ''}`.trim(),
    })).filter((p) => p['@id'] && p.name),
  };
  writeFileSync(schemaOut, JSON.stringify(stub, null, 2));
  console.log(`[ssot-prebuild] CI fallback: wrote minimal schema to ${schemaOut} (${stub.people.length} people)`);
}

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
const toolMissing = !existsSync(schemaWriter);
if (toolMissing) {
  console.warn(`[ssot-prebuild] WARN: ssot-emit-schema.mjs not found at ${schemaWriter} — using CI fallback`);
  emitFallbackSchema(generatedDir);
} else {
  const schemaOut = resolve(generatedDir, 'ssot-schema.json');
  const sres = spawnSync('node', [schemaWriter, '--project', PROJECT_ROOT, '--out', schemaOut], {
    stdio: 'inherit',
    env: process.env,
  });
  if (sres.status !== 0) {
    console.error(`[ssot-prebuild] FATAL: ssot-emit-schema exited ${sres.status}`);
    process.exit(sres.status || 1);
  }
}

if (flag === '0') {
  console.log(`[ssot-prebuild] SITE_SSOT_ENABLED=0 — agent-native surfaces skipped (schema snapshot regenerated)`);
  const cleanupPaths = [
    'public/llms.txt',
    'public/llms-full.txt',
    'public/library/llms.txt',
    'public/courses/llms.txt',
    'public/faqs/llms.txt',
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
    } catch (err) {
      // Cleanup is best-effort; rmSync force:true already swallows ENOENT.
      // Log permission / EBUSY / EPERM so a stale public/llms.txt that
      // survives a flag flip leaves a diagnostic trail in CI logs instead
      // of vanishing silently.
      console.warn(`[ssot-prebuild] cleanup failed for ${rel}: ${err.message}`);
    }
  }
  if (cleaned > 0) {
    console.log(`[ssot-prebuild]   (cleaned ${cleaned} stale agent-surface outputs)`);
  }
  process.exit(0);
}

if (toolMissing) {
  console.log(`[ssot-prebuild] SITE_SSOT_ENABLED=1 — agent-native emit skipped (tool missing in this environment)`);
} else {
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
}

// Phase 0a-bis: restore static llms.txt + llms-full.txt from snapshots in
// public/_static/. The current ssot-emit llms emitters produce output that is
// materially worse than the hand-curated static versions until Gianna fills
// the TBD-GIANNA prose placeholders in ssot/agent-surfaces.json.
//
// 2026-05-05: extended to mirror sectional llms.txt files for orank.ai
// "Modular llms.txt per product area" agent-readiness check. Each sectional
// file installs into the matching public/{section}/llms.txt path.
const STATIC_RESTORES = [
  ['static-overrides/llms.txt', 'public/llms.txt'],
  ['static-overrides/llms-full.txt', 'public/llms-full.txt'],
  ['static-overrides/library-llms.txt', 'public/library/llms.txt'],
  ['static-overrides/courses-llms.txt', 'public/courses/llms.txt'],
  ['static-overrides/faqs-llms.txt', 'public/faqs/llms.txt'],
];
let restored = 0;
for (const [from, to] of STATIC_RESTORES) {
  const fromAbs = resolve(PROJECT_ROOT, from);
  const toAbs = resolve(PROJECT_ROOT, to);
  if (existsSync(fromAbs)) {
    mkdirSync(dirname(toAbs), { recursive: true });
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
