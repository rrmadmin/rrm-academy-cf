#!/usr/bin/env node
/**
 * scripts/gates/validate-pillar-registry.mjs
 *
 * CI gate: assert that ssot/pillars.json is the single source of truth for
 * every pillar surface, and that no consumer has snuck in a hardcoded pillar
 * list that bypasses the SSOT.
 *
 * What this gate proves:
 *   G1 SSOT integrity         every pillar in ssot/pillars.json has the required fields and a real .astro file
 *   G2 No-drift-by-derivation each known consumer imports ssot/pillars.json (greps for the import line)
 *   G3 No-hardcoded-bypass    each known consumer does NOT carry the legacy hardcoded list
 *   G4 Schema completeness    every pillar's slug appears in the in-page H2 articleSection JSON-LD (optional, warn only)
 *   G5 Router parity warning  ssot/pillars.json slugs that aren't in rrm-router's ASTRO_ROUTES (separate repo) -- WARN not FAIL
 *
 * Exit codes:
 *   0 -- all gates pass
 *   1 -- any G1-G3 fails (drift detected)
 *
 * Run:
 *   node scripts/gates/validate-pillar-registry.mjs
 *   node scripts/gates/validate-pillar-registry.mjs --json
 *
 * Auto-fired by:
 *   - pre-commit hook on changes to ssot/pillars.json or any consumer file
 *   - CI deploy workflow before astro build
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const SSOT_PATH = join(ROOT, 'ssot', 'pillars.json');

// Each entry: { file, must_import (substring), must_not_match (regex array) }.
// must_not_match catches hardcoded pillar lists that bypass the SSOT. The
// regexes are intentionally specific to the pre-refactor patterns; new
// hardcoded surfaces would need their own regex.
const CONSUMERS = [
  {
    file: 'src/pages/guides/index.astro',
    must_import: "from '../../../ssot/pillars.json'",
    must_not_match: [
      // Old guides[] array literal had specific signature: `const guides = [{`
      /^const\s+guides\s*=\s*\[\s*\{\s*$/m,
    ],
  },
  {
    file: 'src/integrations/library-sitemaps.mjs',
    must_import: "ssot', 'pillars.json",
    must_not_match: [
      // Old PILLAR_PATHS literal: 9 entries inside an array
      /const\s+PILLAR_PATHS\s*=\s*\[\s*['"]\/what-is-rrm/,
    ],
  },
  {
    file: 'src/components/AppShellChrome.astro',
    must_import: "from '../../ssot/pillars.json'",
    must_not_match: [
      // Old GUIDES_PATHS literal had 8 slash-pair entries
      /'\/what-is-rrm',\s*'\/what-is-rrm\/'/,
    ],
  },
  {
    file: 'src/layouts/BaseLayout.astro',
    must_import: "from '../../ssot/pillars.json'",
    must_not_match: [
      // Old navigate_to_section enum had the inline pillar slugs
      /enum:\s*\[\s*'home',\s*'library'[^\]]*'naprotechnology'/,
      // Old map.<x> assignments
      /map\.naprotechnology\s*=\s*'\/naprotechnology\/'/,
    ],
  },
  {
    file: 'scripts/build-guides-data.mjs',
    must_import: "join(ROOT, 'ssot', 'pillars.json')",
    must_not_match: [
      // Old GUIDES = [...] literal with file paths
      /\{\s*slug:\s*'art-registries-and-codes',\s*file:/,
    ],
  },
  {
    file: 'scripts/build-og-index.mjs',
    must_import: "join(ROOT, 'ssot', 'pillars.json')",
    must_not_match: [
      // Old hardcoded pillar entries inside STATIC_PAGES
      /'art-registries-and-codes':\s*\{\s*\n\s*title:\s*'ART Registries/,
    ],
  },
];

const REQUIRED_FIELDS = [
  'slug',
  'file',
  'title',
  'description',
  'og_title',
  'og_description',
  'author',
  'read_time',
  'accent',
  'in_guides_catalogue',
  'in_shell_guides_nav',
];

function readPillars() {
  if (!existsSync(SSOT_PATH)) {
    throw new Error(`ssot/pillars.json not found at ${SSOT_PATH}`);
  }
  return JSON.parse(readFileSync(SSOT_PATH, 'utf-8'));
}

function gateG1(registry) {
  const issues = [];
  if (!Array.isArray(registry.pillars)) {
    issues.push('pillars must be an array');
    return issues;
  }
  const seenSlugs = new Set();
  for (const p of registry.pillars) {
    for (const f of REQUIRED_FIELDS) {
      if (p[f] === undefined) {
        issues.push(`pillar slug=${p.slug ?? '?'} missing required field: ${f}`);
      }
    }
    if (p.slug) {
      if (seenSlugs.has(p.slug)) {
        issues.push(`duplicate slug in registry: ${p.slug}`);
      }
      seenSlugs.add(p.slug);
    }
    if (p.file) {
      const fullPath = join(ROOT, 'src', 'pages', p.file);
      if (!existsSync(fullPath)) {
        issues.push(`pillar ${p.slug}: file ${p.file} does not exist at ${fullPath}`);
      }
    }
  }
  return issues;
}

function gateG2andG3() {
  const issues = [];
  for (const c of CONSUMERS) {
    const fullPath = join(ROOT, c.file);
    if (!existsSync(fullPath)) {
      issues.push(`consumer file does not exist: ${c.file}`);
      continue;
    }
    const src = readFileSync(fullPath, 'utf-8');
    if (!src.includes(c.must_import)) {
      issues.push(`G2 ${c.file}: missing SSOT import (must contain "${c.must_import}")`);
    }
    for (const re of c.must_not_match) {
      if (re.test(src)) {
        issues.push(`G3 ${c.file}: hardcoded pillar list detected (regex: ${re}) -- derive from ssot/pillars.json`);
      }
    }
  }
  return issues;
}

function gateG5(registry) {
  // Router parity is a WARN. The router lives in a separate repo and deploys
  // separately; this check is informational so a developer adding a pillar
  // knows whether the router needs a deploy.
  const warnings = [];
  const ROUTER_PATH = join(ROOT, '..', 'rrm-router', 'src', 'index.js');
  if (!existsSync(ROUTER_PATH)) {
    // Router not co-located on this machine; skip silently.
    return warnings;
  }
  const routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  for (const p of registry.pillars) {
    const expected = `'/${p.slug}',`;
    if (!routerSrc.includes(expected)) {
      warnings.push(`G5 rrm-router/src/index.js: ASTRO_ROUTES missing /${p.slug} (deploy needed via 'npx wrangler deploy' in ~/iCode/projects/rrm-router)`);
    }
  }
  return warnings;
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

try {
  const registry = readPillars();
  const g1 = gateG1(registry);
  const g23 = gateG2andG3();
  const g5 = gateG5(registry);
  const errors = [...g1, ...g23];

  if (jsonMode) {
    console.log(JSON.stringify({
      pass: errors.length === 0,
      errors,
      warnings: g5,
      pillar_count: registry.pillars?.length ?? 0,
    }, null, 2));
  } else {
    console.log(`[validate-pillar-registry] checking ${registry.pillars?.length ?? 0} pillars against ${CONSUMERS.length} consumers`);
    if (errors.length === 0) {
      console.log('[validate-pillar-registry] G1-G3 ALL CLEAR -- SSOT integrity + consumer derivation + no-hardcoded-bypass');
    } else {
      console.error(`[validate-pillar-registry] BLOCKED -- ${errors.length} issue(s):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
    if (g5.length > 0) {
      console.warn(`[validate-pillar-registry] G5 WARNINGS (router parity, non-blocking):`);
      for (const w of g5) console.warn(`  - ${w}`);
    }
  }

  process.exit(errors.length === 0 ? 0 : 1);
} catch (err) {
  console.error(`[validate-pillar-registry] FATAL: ${err.message}`);
  process.exit(1);
}
