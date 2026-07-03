#!/usr/bin/env node
/**
 * scripts/gates/validate-guides-registry.mjs
 *
 * CI gate: assert that ssot/guides.json is the single source of truth for
 * every pillar surface, and that no consumer has snuck in a hardcoded pillar
 * list that bypasses the SSOT.
 *
 * What this gate proves:
 *   G1 SSOT integrity         every pillar in ssot/guides.json has the required fields and a real .astro file
 *   G2 No-drift-by-derivation each known consumer imports ssot/guides.json (greps for the import line)
 *   G3 No-hardcoded-bypass    each known consumer does NOT carry the legacy hardcoded list
 *   G4 Schema completeness    every pillar's slug appears in the in-page H2 articleSection JSON-LD (optional, warn only)
 *   G5 Router parity warning  ssot/guides.json slugs that aren't in rrm-router's ASTRO_ROUTES (separate repo) -- WARN not FAIL
 *
 * Exit codes:
 *   0 -- all gates pass
 *   1 -- any G1-G3 fails (drift detected)
 *
 * Run:
 *   node scripts/gates/validate-guides-registry.mjs
 *   node scripts/gates/validate-guides-registry.mjs --json
 *
 * Auto-fired by:
 *   - pre-commit hook on changes to ssot/guides.json or any consumer file
 *   - CI deploy workflow before astro build
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const SSOT_PATH = join(ROOT, 'ssot', 'guides.json');

// Each entry: { file, must_import (substring), must_not_match (regex array) }.
// must_not_match catches hardcoded pillar lists that bypass the SSOT. The
// regexes are intentionally specific to the pre-refactor patterns; new
// hardcoded surfaces would need their own regex.
const CONSUMERS = [
  {
    file: 'src/pages/guides/index.astro',
    must_import: "from '../../../ssot/guides.json'",
    must_not_match: [
      // Old guides[] array literal had specific signature: `const guides = [{`
      /^const\s+guides\s*=\s*\[\s*\{\s*$/m,
    ],
  },
  {
    file: 'src/integrations/library-sitemaps.mjs',
    must_import: "ssot', 'guides.json",
    must_not_match: [
      // Old GUIDE_PATHS literal: 9 entries inside an array
      /const\s+GUIDE_PATHS\s*=\s*\[\s*['"]\/what-is-rrm/,
    ],
  },
  {
    file: 'src/components/AppShellChrome.astro',
    must_import: "from '../../ssot/guides.json'",
    must_not_match: [
      // Old GUIDES_PATHS literal had 8 slash-pair entries
      /'\/what-is-rrm',\s*'\/what-is-rrm\/'/,
    ],
  },
  {
    file: 'src/layouts/BaseLayout.astro',
    must_import: "from '../../ssot/guides.json'",
    must_not_match: [
      // Old navigate_to_section enum had the inline pillar slugs
      /enum:\s*\[\s*'home',\s*'library'[^\]]*'naprotechnology'/,
      // Old map.<x> assignments
      /map\.naprotechnology\s*=\s*'\/naprotechnology\/'/,
    ],
  },
  {
    file: 'scripts/build-guides-data.mjs',
    must_import: "join(ROOT, 'ssot', 'guides.json')",
    must_not_match: [
      // Old GUIDES = [...] literal with file paths
      /\{\s*slug:\s*'art-registries-and-codes',\s*file:/,
    ],
  },
  {
    file: 'scripts/build-og-index.mjs',
    must_import: "join(ROOT, 'ssot', 'guides.json')",
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
  'category',
  'in_shell_guides_nav',
  // GuideLayout foundation fields (added 2026-06-08). reviewer is intentionally
  // NOT here: 9 pillars have no reviewer and gateG1 fails on `=== undefined`.
  'pageTitle',
  'pageDescription',
  'pageH1',
  'breadcrumbName',
  'authorId',
  'usesGuideLayout',
];

// G6 reverse check: a clinical pillar page must be REGISTERED (which is what gives
// it a per-page OG card via build-og-index + a sitemap entry + guides/nav surfacing).
// Any root-level page that emits MedicalWebPage/MedicalCondition schema is treated as
// a clinical pillar and MUST be in ssot/guides.json, UNLESS it is a known non-pillar
// clinical page (e.g. the endo survey landing). This closes the gap where a manually
// authored pillar page (bypassing the pillar-create skill) ships with the generic
// fallback OG card and no sitemap/guides presence.
const NON_PILLAR_CLINICAL = new Set([
  'endo-survey', // survey landing, emits clinical schema but is not a pillar guide
  'fertility-awareness-method-quiz', // quiz landing, emits clinical schema but is not a pillar guide
  'endo-check', // Google Ads landing variant of the endo survey, noindex, not a pillar guide
]);
const CLINICAL_SCHEMA_RE = /MedicalWebPage|MedicalCondition/;

function clinicalRootSlugs() {
  const pagesDir = join(ROOT, 'src', 'pages');
  const slugs = [];
  for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
    let file = null;
    let slug = null;
    if (entry.isDirectory()) {
      const p = join(pagesDir, entry.name, 'index.astro');
      if (existsSync(p)) { file = p; slug = entry.name; }
    } else if (entry.isFile() && entry.name.endsWith('.astro')) {
      file = join(pagesDir, entry.name);
      slug = entry.name.replace(/\.astro$/, '');
    }
    if (!file) continue;
    if (CLINICAL_SCHEMA_RE.test(readFileSync(file, 'utf-8'))) slugs.push(slug);
  }
  return slugs;
}

function gateG6(registry) {
  const issues = [];
  const registered = new Set((registry.guides || []).map((p) => p.slug));
  for (const slug of clinicalRootSlugs()) {
    if (!registered.has(slug) && !NON_PILLAR_CLINICAL.has(slug)) {
      issues.push(
        `G6 src/pages/${slug}/ emits clinical schema (MedicalWebPage/MedicalCondition) but is NOT in ssot/guides.json. ` +
        `It will fall back to the generic OG card and be absent from the sitemap/guides. ` +
        `Register it (pillar-create, or add a guides.json entry) or add '${slug}' to NON_PILLAR_CLINICAL.`,
      );
    }
  }
  return issues;
}

const IMPORT_PILLAR_RE = /^\s*import\s+GuideLayout\s+from\s+['"][^'"]*GuideLayout\.astro['"]/m;
const IMPORT_BASE_RE = /^\s*import\s+BaseLayout\s+from\s+['"][^'"]*BaseLayout\.astro['"]/m;
const USES_BASE_TAG_RE = /<BaseLayout[\s>]/;
const HANDROLLED_BREADCRUMB_RE = /['"]@type['"]\s*:\s*['"]BreadcrumbList['"]/;

export function gateG7(registry, readFile = (p) => readFileSync(p, 'utf-8')) {
  const issues = [];
  for (const p of registry.guides || []) {
    if (typeof p.usesGuideLayout !== 'boolean' || !p.file) continue; // gateG1 already flagged a missing flag/file
    const fullPath = join(ROOT, 'src', 'pages', p.file);
    let src;
    try { src = readFile(fullPath); } catch { continue; } // gateG1 already flagged a missing file
    const importsPillar = IMPORT_PILLAR_RE.test(src);
    if (p.usesGuideLayout) {
      if (!importsPillar) issues.push(`G7 ${p.slug}: usesGuideLayout:true -- page must import GuideLayout (does not import GuideLayout)`);
      if (IMPORT_BASE_RE.test(src) || USES_BASE_TAG_RE.test(src))
        issues.push(`G7 ${p.slug}: usesGuideLayout:true -- page must NOT import or use BaseLayout directly (GuideLayout wraps it)`);
      if (HANDROLLED_BREADCRUMB_RE.test(src))
        issues.push(`G7 ${p.slug}: usesGuideLayout:true but hand-rolls a BreadcrumbList literal (the layout owns it; @graph pages must delete the in-graph BreadcrumbList)`);
    } else if (importsPillar) {
      issues.push(`G7 ${p.slug}: usesGuideLayout:false -- page must NOT import GuideLayout (half-revert?)`);
    }
  }
  return issues;
}

function readPillars() {
  if (!existsSync(SSOT_PATH)) {
    throw new Error(`ssot/guides.json not found at ${SSOT_PATH}`);
  }
  return JSON.parse(readFileSync(SSOT_PATH, 'utf-8'));
}

function gateG1(registry) {
  const issues = [];
  if (!Array.isArray(registry.guides)) {
    issues.push('pillars must be an array');
    return issues;
  }
  const seenSlugs = new Set();
  for (const p of registry.guides) {
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
        issues.push(`G3 ${c.file}: hardcoded pillar list detected (regex: ${re}) -- derive from ssot/guides.json`);
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
  for (const p of registry.guides) {
    const expected = `'/${p.slug}',`;
    if (!routerSrc.includes(expected)) {
      warnings.push(`G5 rrm-router/src/index.js: ASTRO_ROUTES missing /${p.slug} (deploy needed via 'npx wrangler deploy' in ~/iCode/projects/rrm-router)`);
    }
  }
  return warnings;
}

// Only run the CLI block when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');

  try {
    const registry = readPillars();
    const g1 = gateG1(registry);
    const g23 = gateG2andG3();
    const g6 = gateG6(registry);
    const g7 = gateG7(registry);
    const g5 = gateG5(registry);
    const errors = [...g1, ...g23, ...g6, ...g7];

    if (jsonMode) {
      console.log(JSON.stringify({
        pass: errors.length === 0,
        errors,
        warnings: g5,
        pillar_count: registry.guides?.length ?? 0,
      }, null, 2));
    } else {
      console.log(`[validate-guides-registry] checking ${registry.guides?.length ?? 0} pillars against ${CONSUMERS.length} consumers`);
      if (errors.length === 0) {
        console.log('[validate-guides-registry] G1-G3 + G6 + G7 ALL CLEAR -- SSOT integrity + consumer derivation + no-hardcoded-bypass + clinical-page registration + GuideLayout enforcement');
      } else {
        console.error(`[validate-guides-registry] BLOCKED -- ${errors.length} issue(s):`);
        for (const e of errors) console.error(`  - ${e}`);
      }
      if (g5.length > 0) {
        console.warn(`[validate-guides-registry] G5 WARNINGS (router parity, non-blocking):`);
        for (const w of g5) console.warn(`  - ${w}`);
      }
    }

    process.exit(errors.length === 0 ? 0 : 1);
  } catch (err) {
    console.error(`[validate-guides-registry] FATAL: ${err.message}`);
    process.exit(1);
  }
}
