/**
 * Coverage census: surface enumeration + classification rules.
 *
 * Single source of truth for (a) WHAT counts as first-party executable
 * surface in this repo and (b) WHICH coverage instrument applies to each
 * file. Consumed by:
 *   - scripts/quality/census.mjs   (writes scripts/quality/coverage-census.json)
 *   - scripts/quality/coverage.mjs (the armed gate: computes the PRODUCT-CODE
 *     line percentage against the census floor and fails the run below it)
 *
 * Categories (see CATEGORIES below). The core discipline, learned the hard
 * way across rrm-ehr / rrm-registry-hub / rrm-library-worker:
 *   1. ABSENT-FROM-REPORT is not ZERO — c8 runs with --all so every surface
 *      file appears in the denominator by name.
 *   2. A file is either PRODUCT-CODE (inside the gated denominator) or it is
 *      excluded WITH A WRITTEN REASON here. Never silently.
 *   3. Adding a surface file without classifying it fails the gate.
 */
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const CATEGORIES = {
  'PRODUCT-CODE': 'Deployed or deploy-chain code whose defects ship to users: CF Pages Functions (every route + _helper under functions/), build-time data fetchers and shared logic (src/lib), client bundles (src/scripts), Astro build integrations, and the CI gate/guard/build scripts that decide whether a deploy is allowed. This is the gated denominator. Uncovered PRODUCT-CODE is debt, listed so it is visible and countable, never argued away.',
  'CONTENT-TEMPLATE': 'Files where line coverage is the wrong instrument because they are content, data constants, or scaffolding: reference-only endpoint templates (header forbids importing), typed data constants consumed by Astro templates, and Astro endpoint modules (*.md.ts / rss.xml.ts) that only execute inside the Astro build container. Their correctness instruments are the build itself, verify-build-output, the data deploy-guard floors, and the e2e suite.',
  'E2E-DRIVER': 'Operator tools and post-deploy checks whose whole body is live-platform I/O against the deployed stack (live D1, R2, KV, Vectorize, GA4 Admin, CF AI Search, ELV, Playwright against the live site). Line-covering them means mocking the platform they exist to exercise, which converts a real integration check into a mock-shaped unit test that proves nothing. The correctness instrument is the run.',
  'GENERATED': 'Machine-generated constant tables committed as .js/.ts (plus src/generated/*, src/data/*.json build artifacts, which are gitignored or non-JS and so never enumerated). A generated data table has NO BRANCHES TO EXERCISE: it is a literal, its every line executes on import, and a test that imports it scores 100% while asserting nothing about behaviour. Line coverage over it is not a weak measurement, it is a measurement of the wrong thing, and because such a table is counted covered it inflates BOTH sides of the PRODUCT-CODE ratio and pushes the headline percentage up without a single assertion behind it. Their correctness instrument is regeneration from the upstream source plus the behaviour of the code that CONSUMES them (which stays PRODUCT-CODE and must be tested).',
  'ONE-OFF': 'One-shot migrations, backfills, import/send campaigns, cover-image batches, and local operator helpers that run by hand, never in CI and never on deploy. Kept as the written record of an operation already performed (or a local creative tool). Covering them would pin the shape of a finished operation.',
};

/** Directories walked (recursively) + extension filter per root. */
const SURFACE_ROOTS = [
  { dir: 'functions', exts: ['.js', '.mjs', '.ts'] },
  { dir: 'scripts', exts: ['.js', '.mjs', '.ts'] },
  { dir: 'src/lib', exts: ['.js', '.mjs', '.ts', '.mts'] },
  { dir: 'src/scripts', exts: ['.js', '.mjs', '.ts', '.mts'] },
  { dir: 'src/integrations', exts: ['.js', '.mjs', '.ts'] },
  { dir: 'src/pages', exts: ['.ts', '.mts'] }, // Astro endpoint modules only; .astro is template surface
  { dir: 'src/data', exts: ['.ts'] }, // typed data constants; JSON build artifacts are not executable surface
];

const TEST_FILE = /\.(test|spec)\.(js|mjs|ts|mts)$/;

/** c8 --include globs matching SURFACE_ROOTS exactly (keep in lockstep). */
export const C8_INCLUDE = [
  'functions/**/*.js', 'functions/**/*.mjs', 'functions/**/*.ts',
  'scripts/**/*.js', 'scripts/**/*.mjs', 'scripts/**/*.ts',
  'src/lib/**/*.js', 'src/lib/**/*.mjs', 'src/lib/**/*.ts', 'src/lib/**/*.mts',
  'src/scripts/**/*.js', 'src/scripts/**/*.mjs', 'src/scripts/**/*.ts', 'src/scripts/**/*.mts',
  'src/integrations/**/*.js', 'src/integrations/**/*.mjs', 'src/integrations/**/*.ts',
  'src/pages/**/*.ts', 'src/pages/**/*.mts',
  'src/data/**/*.ts',
];
export const C8_EXCLUDE = ['test/**', 'tests/**', '**/*.test.*', '**/*.spec.*', '**/node_modules/**'];

/** Recursively enumerate the first-party executable surface. Returns sorted repo-relative paths. */
export async function enumerateSurface(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(relative(root, p));
    }
  }
  for (const { dir, exts } of SURFACE_ROOTS) {
    const before = out.length;
    await walk(join(root, dir));
    // filter this root's pickups by extension + test-file exclusion
    const picked = out.splice(before).filter(rel =>
      exts.some(x => rel.endsWith(x)) && !TEST_FILE.test(rel)
    );
    out.push(...picked);
  }
  return [...new Set(out)].sort();
}

/**
 * Exact-path overrides. Checked before RULES. Every entry carries its own reason.
 */
const OVERRIDES = new Map([
  ['functions/api/_endpoint-template.js', ['CONTENT-TEMPLATE', 'REFERENCE ONLY scaffold; its own header forbids importing it. Never routed (underscore prefix), never executed. The convention it encodes is enforced by review gate R6 + arise-scanner, not by line coverage.']],
  ['functions/api/auth/_disposable-domains.js', ['GENERATED', 'AUTO-GENERATED constant table: `export const DISPOSABLE_DOMAINS = new Set([...])`, 5197 domain string literals from disposable-email-domains/disposable-email-domains, its own header saying so. It has no functions, no branches, and no behaviour -- every one of its 5202 lines executes the moment anything imports it, so it scored 5202/5202 = 100% purely because functions/api/auth/_email-validate.js imports it. RECLASSIFIED 2026-07-31 because that 100% was inflating the gated headline: at 5202 lines it was 8.02% of the entire 64887-line PRODUCT-CODE denominator, ALL of it counted as covered, which is why removing it LOWERS the reported figure (32.43% -> 26.54%) rather than raising it. A generated constant table has no branches to exercise; covering it proves only that `new Set([...])` evaluates. What must stay tested is the CONSUMER -- _email-validate.js is PRODUCT-CODE and its lookup, normalisation and rejection behaviour is where the real defects live. Correctness instrument for the table itself: regeneration from upstream, not line coverage. If this file ever grows a function, reclassify it back.']],
  ['src/data/library-topics.ts', ['CONTENT-TEMPLATE', 'Typed data constant (library browse taxonomy) imported only by Astro templates. No branches to cover; drift is caught by the build + deploy-guard data floors.']],
  ['scripts/parse-glossary-to-seed.mjs', ['ONE-OFF', 'Archived one-shot migration parser from the pre-2026-04-18 monolithic glossary .astro. Throws on execute by design; kept for historical context (CLAUDE.md: DO NOT RUN).']],
  ['scripts/pipeline.mjs', ['ONE-OFF', 'Airtable pipeline simulator. Airtable is deprecated repo-wide (D1 is SSOT); kept as the record of the migration-era tooling.']],
  ['scripts/migrate-courses-to-d1.mjs', ['ONE-OFF', 'One-shot D1 seed (re-run requires --seed-mode-i-understand and clobbers admin edits). Its live-schema drift risk is held by the CS1/CS2 courses schema gates, not line coverage.']],
  ['scripts/backfill-donor-gifts.mjs', ['ONE-OFF', 'One-time donor_gift backfill against live Wix/Stripe/PayPal data; header says one-time. Record of a finished operation.']],
  ['scripts/update-campaign-snapshot.mjs', ['PRODUCT-CODE', 'Recurring cron refresh of the committed campaign snapshot; has unit tests (tests/unit/campaign-snapshot.test.mjs) over its pure shaping.']],
  ['scripts/regenerate-glossary-seed.mjs', ['ONE-OFF', 'Manual local regeneration of migrate-glossary-data.sql from glossary.json; run rarely, by hand, never in CI. Promote to PRODUCT-CODE if it regains routine use.']],
  ['scripts/glossary/rename-slugs.mjs', ['ONE-OFF', 'One-shot AEO slug-rename campaign across glossary tables; record of a finished rename.']],
  ['scripts/glossary/bulk-load-sources.mjs', ['E2E-DRIVER', 'Bulk-load of authoritative source definitions into live rrm-auth D1 from the External Sourcing Sheet; body is live D1 I/O.']],
  ['scripts/audit-glossary-links.mjs', ['PRODUCT-CODE', 'Local deterministic analysis of glossary.json link classes; unit-tested (glossary-link-classifier.test.js), 80% covered today.']],
  ['scripts/compute-word-counts.mjs', ['PRODUCT-CODE', 'Recurring thin-page backfill tool; pure word-count core is fixture-tested (compute-word-counts-fixture.test.js). The D1 I/O wrapper is the uncovered remainder.']],
  ['scripts/build-fixture.mjs', ['PRODUCT-CODE', 'Deterministic fixture builder used by the baseline capture chain (npm run build:fixture).']],
  ['functions/save-the-uterus-club/migrate.js', ['PRODUCT-CODE', 'Live routed endpoint (Wix migration-link redemption). Deployed product code despite the migration-flavored name.']],
]);

/**
 * Ordered classification rules; first match wins. Each rule: [regex, category, reason].
 * A surface file matching NO rule and NO override is a gate failure — classify it.
 */
const RULES = [
  // ---- scripts: one-shot migrations / imports / campaigns / cover batches ----
  [/^scripts\/migrations\//, 'ONE-OFF', 'SQL/data migration runner for a specific dated migration; record of a finished operation.'],
  [/^scripts\/migrate-.*\.mjs$/, 'ONE-OFF', 'One-shot data migration (Airtable-to-D1 / Wix asset era); already executed, kept as the record.'],
  [/^scripts\/import-(wix|stuc)-.*\.mjs$/, 'ONE-OFF', 'Historical one-shot import from the retired Wix platform.'],
  [/^scripts\/make-.*\.mjs$/, 'ONE-OFF', 'One-shot commentary/cover image batch for a named post or date; finished creative operation.'],
  [/^scripts\/(insert-pakiz-d1|stage-pakiz-local|fix-crm-typo-emails|populate-avatars|upload-stuc-recordings|install-gitleaks-hook)\.mjs$/, 'ONE-OFF', 'One-shot local operation (data insert, staging helper, CRM fix, avatar backfill, recording upload, hook install); record of a finished operation.'],
  [/^scripts\/(femtech-ab-send|fertility-rule-comment-send)\.mjs$/, 'ONE-OFF', 'One-off email trickle-send campaign (its own header says one-off); re-covering a finished send would prove nothing.'],
  [/^scripts\/(gen-image|stylize-from-photo|cover-add-title)\.mjs$/, 'ONE-OFF', 'Local creative operator tool; body is external image-AI API I/O plus sharp compositing, run by hand per asset, never in CI.'],

  // ---- scripts: live-platform drivers / post-deploy checks / operator I/O tools ----
  [/^scripts\/(canary|qa-pre-deploy|qa-post-deploy|smoke-course-landings|test-gated-content|verify-membership-mobile|verify-mobile-hamburger|verify-search-expand|screenshot-badges)\.mjs$/, 'E2E-DRIVER', 'Post-deploy/live-site check (HTTP or Playwright against the deployed stack); the correctness instrument is the run.'],
  [/^scripts\/red-team-ask\//, 'E2E-DRIVER', 'Adversarial probe battery driven against the live /ask endpoint.'],
  [/^scripts\/(embed-library|embed-library-ci|ai-search-corpus-upload|ai-search-provision|submit-indexnow|rebuild-dedupe-index)\.mjs$/, 'E2E-DRIVER', 'Body is live Vectorize/AI-Search/IndexNow/KV I/O against the deployed platform.'],
  [/^scripts\/ga4-.*\.mjs$/, 'E2E-DRIVER', 'Live GA4 Admin API configuration driver.'],
  [/^scripts\/(verify-crm-elv|validate-crm-emails|segment-newsletter|import-newsletter-subscribers|sync-ecosystem|snapshot-data|restore-snapshot|ssot-courses-snapshot|glossary-snapshot|enrich-progress|clean-content|normalize-glossary-links|seed-glossary-abbreviations|audit-author-coverage|audit-commentary|audit-textbook-fact-coverage)\.mjs$/, 'E2E-DRIVER', 'Operator tool whose body is live D1/R2/ELV I/O (audits, snapshots, content cleanup, CRM verification) against production data.'],

  // ---- scripts: CI gates / guards / deploy-chain build steps => product code ----
  [/^scripts\/gates\//, 'PRODUCT-CODE', 'Deterministic CI/pre-commit proof gate; it decides whether deploys are allowed and must itself be trustworthy.'],
  [/^scripts\/quality\//, 'PRODUCT-CODE', 'The quality instrument itself (coverage/CRAP/mutation/census). A measurement tool that is wrong is worse than no tool; its pure logic is unit-testable.'],
  [/^scripts\/lib\//, 'PRODUCT-CODE', 'Shared library code imported by pipeline scripts and gates.'],
  [/^scripts\/baseline\//, 'PRODUCT-CODE', 'Baseline capture/diff gate (npm run baseline:diff:hard) used to hold rendered-output regressions.'],
  [/^scripts\/css-audit\//, 'PRODUCT-CODE', 'CSS audit gate (npm run css-audit:gate) in the deploy chain.'],
  [/^scripts\/(guard|guard-ios-zoom|arise-hotspot-guard|agent-discovery-check|check-canonical-lockdown|check-types|check-bridge-links|check-persona-enum-sync|check-no-moved-paths|check-glossary-link-classes|check-suggest-coverage|check-render-gate-ids|generate-design-tokens|audit-design-tokens|verify-citations|verify-templates|verify-build-output|validate-satellite-manifest|emit-schemamap-fallback)\.mjs$/, 'PRODUCT-CODE', 'Deploy-blocking guard/check: runs in CI or pre-commit and gates what ships.'],
  [/^scripts\/(build-og-index|augment-og-index|generate-page-dates|build-library-feed|build-guides-data|build-guide-reviews|build-infographic-assets|sync-library-count|regen-agent-skills-digests|ssot-prebuild|ssot-postbuild|build-providers)\.mjs$/, 'PRODUCT-CODE', 'Build-chain step inside npm run build / postbuild; its output ships on every deploy.'],
  [/^scripts\/(build-canonical-facts|extract-article-facts|extract-chapter-facts|promote-article-facts|promote-chapter-facts|harmonize-facts|apply-harmonization)\.mjs$/, 'PRODUCT-CODE', 'Canonical-facts pipeline: recurring content product code with a known burned failure class (70958c2 dropped 724 facts); G1-G5 gates hold schema drift but the promotion/merge logic itself belongs in the tested denominator.'],
  [/^scripts\/(infographic-export|infographic-render)\.mjs$/, 'PRODUCT-CODE', 'Infographic pipeline entry points; unit-tested (infographic-*.test.js).'],

  // ---- functions/: everything deployed ----
  [/^functions\//, 'PRODUCT-CODE', 'CF Pages Function (routed endpoint, middleware, or _-prefixed shared helper). Deployed on every push; defects ship directly to users.'],

  // ---- src ----
  [/^src\/lib\//, 'PRODUCT-CODE', 'Build-time data fetcher / shared logic. Feeds every deploy (fetch-all -> src/data -> astro build); silent failure here is a data-loss deploy.'],
  [/^src\/scripts\//, 'PRODUCT-CODE', 'Client-side browser bundle (analytics, saved, fund thermometer). Ships to every visitor; AG11 holds size, tests must hold behavior.'],
  [/^src\/integrations\//, 'PRODUCT-CODE', 'Astro build integration (sitemaps, agent-md surfaces); runs on every build, its output ships.'],
  [/^src\/pages\/.*\.(ts|mts)$/, 'CONTENT-TEMPLATE', 'Astro endpoint module (*.md.ts / rss.xml.ts): executes only inside the Astro build container (astro:content et al). Instruments: the build itself, verify-build-output, standards gate, e2e.'],
];

/** Classify one repo-relative surface path. Returns { category, reason } or null. */
export function classify(rel) {
  const o = OVERRIDES.get(rel);
  if (o) return { category: o[0], reason: o[1] };
  for (const [re, category, reason] of RULES) {
    if (re.test(rel)) return { category, reason };
  }
  return null;
}
