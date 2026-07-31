#!/usr/bin/env node
/**
 * Coverage census generator.
 *
 * Enumerates the full first-party executable surface (census-rules.mjs),
 * classifies every file, joins the c8 full-surface coverage report
 * (reports/quality/coverage/coverage-final.json — run
 * `node scripts/quality/coverage.mjs` first, or pass --coverage-dir), computes
 * a CRAP ranking (ESLint cyclomatic complexity x uncovered fraction) over
 * PRODUCT-CODE files, and writes scripts/quality/coverage-census.json.
 *
 * The census JSON is COMMITTED. The coverage gate (coverage.mjs) fails when
 * the enumerated surface drifts from the committed census — adding a source
 * file without re-running this generator (i.e. without classifying the file)
 * breaks the build, by design.
 *
 * Usage: node scripts/quality/census.mjs [--coverage-dir <dir>] [--check]
 *   --check: verify the committed census matches what would be generated
 *            (file list + categories only; measured numbers are a snapshot
 *            and may drift). Exit 1 on mismatch.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { enumerateSurface, classify, CATEGORIES } from './lib/census-rules.mjs';
import { loadCoverage } from './lib/load-coverage.mjs';
import { crap } from './lib/crap-calc.mjs';
import { isUntouched } from './lib/coverage-helpers.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(ROOT, 'scripts', 'quality', 'coverage-census.json');

/**
 * The armed PRODUCT-CODE line-coverage floor, in percent.
 *
 * RULE: arm at the MEASURED floor rounded DOWN, and only ever move it UP.
 * Never set a number that is red on arrival, and never lower it to make a
 * branch pass. Every change here must record the measurement it came from and
 * be proven to bite (one point above the new floor exits 1, the floor exits 0).
 *
 * History:
 *   20  2026-07-28  armed at the first full-surface measurement, 20.65%.
 *   25  2026-07-28  raised after the tranche-1 coverage drive (survey path,
 *                   Stripe checkout webhook executed instead of grepped, four
 *                   dead gate tests wired, FABM quiz engine). Measured 25.30%.
 *   26  2026-07-29  raised after the tranche-2 drive (auth login/signup,
 *                   community membership gate + roster, admin membership
 *                   report, donor rollups and the webhook dedup envelope, all
 *                   executed against a real SQLite engine loaded with the
 *                   committed schema -- test/_d1-sqlite.mjs). Measured 26.28%.
 *   28  2026-07-29  raised after the tranche-3 drive, which targeted five
 *                   PRODUCT surfaces that sat below this repo-wide floor while
 *                   the gate itself was green: training analytics (0 -> 98.6%),
 *                   the library render surface (0 -> 67.4%), the FABM quiz API
 *                   (3.5 -> 100%), and the course-platform enrolment/quiz path.
 *                   Measured 28.32%.
 *   28  2026-07-31  UNCHANGED after the tranche-4 drive, which closed three
 *                   product rows to 100% (training analytics, national survey
 *                   system, research library render surface). Measured 28.92%,
 *                   up from 28.17% on the same clean checkout. Rounded DOWN
 *                   that is still 28, and arming 29 would be red on arrival by
 *                   0.08 points (51 more covered lines), so the ratchet does
 *                   not advance on this tranche. Recorded rather than skipped:
 *                   a measurement that moved without moving the armed integer
 *                   is still the evidence the next raise is argued from.
 *   29  2026-07-31  raised after the tranche-4 glossary-admin drive. All six
 *                   CF Pages Functions behind rrmacademy.org/glossary/ admin
 *                   CRUD went 0 -> 100% lines: terms/index.js, terms/[id].js,
 *                   refs/index.js, refs/[refnum].js, abbreviations/index.js,
 *                   abbreviations/[abbr].js. 367 tests against a real SQLite
 *                   engine loaded with the committed schema
 *                   (test/_d1-sqlite.mjs), because the load-bearing behaviour
 *                   is decided by the database: NOCASE primary keys and unique
 *                   slugs turning duplicates into 409s, COALESCE(MAX(..))+1
 *                   auto-numbering, and the abbreviation unlink that runs on a
 *                   BINARY column under an explicit COLLATE. Measured 29.93%
 *                   (19344/64640) on the branch before it was merged with main.
 *                   Re-measured 29.78% (19268/64704) after merging main and
 *                   adding the session/authorization guard pins; still rounds
 *                   down to 29, so the floor does not move. The two numbers
 *                   differ for two reasons, both accounted for below.
 *   29  2026-07-31  UNCHANGED after the tranche-4 public-read drive: the
 *                   public glossary build surface
 *                   (functions/api/glossary/terms.js), /api/articles,
 *                   /api/articles/bulk and the shared _map-article.js mapper,
 *                   all 0 -> 100% lines. On its own branch this drive moved
 *                   the aggregate 28.19 -> 28.99 (28.97 after merging main),
 *                   a real +0.80pp, and it armed 28.9 to record a gain the
 *                   integer scale cannot express. MERGED, THAT NUMBER DOES
 *                   NOT APPLY: the glossary-admin tranche had already raised
 *                   the floor to 29 and the merged tree measures well above
 *                   it, so arming 28.9 here would move the ratchet DOWN. The
 *                   floor stays 29 at this commit and is armed at the final
 *                   merged measurement in the commit that closes the tranche.
 *                   What IS adopted from this drive is the one-decimal scale
 *                   itself, which that closing floor uses.
 *
 *                   Its warning is kept because it generalizes: a change that
 *                   ADDS product files without tests can push the aggregate
 *                   under the floor even though no test was deleted. That is
 *                   the ratchet working, not a bug -- fix it by testing the
 *                   new surface, never by lowering this. The specific case it
 *                   cited, endo-quiz/download.js landing uncovered and leaving
 *                   main red on its own gate, was resolved by the tranche-4
 *                   closes drive, which covered that file and regenerated the
 *                   census; main is green as of this merge.
 *   29  2026-07-31  UNCHANGED after the tranche-4 PDF/blog/FAQ drive: the
 *                   guide-PDF magic-link mint and redeem path, the blog build
 *                   feed, and the whole FAQ admin surface plus its public
 *                   read. Ten files to 100% lines, five of which were absent
 *                   from the default report entirely rather than merely low.
 *                   Measured 29.30% on its own branch. Merged it does not set
 *                   the floor, because the floor is already 29 and the merged
 *                   tree measures far above it; the closing commit arms the
 *                   final number.
 *
 *                   This drive also corrected test/_d1-sqlite.mjs. The
 *                   harness had excluded 2026-06-28-email-event.sql from
 *                   replay on the strength of the migration's own
 *                   "STATUS: DRAFT / HELD. Do NOT apply" header, recording
 *                   that it was "never applied to production". Querying live
 *                   rrm-auth settles it the other way: email_log carries
 *                   ses_message_id, the email_event table exists, and
 *                   email_log holds 1728 rows with 937 written since
 *                   2026-06-28. The migration IS applied. A FILE HEADER IS
 *                   NOT A DEPLOYMENT RECORD, and excluding it left the
 *                   harness behind production, which made an eight-column
 *                   insertEmailLog() INSERT fail in tests only and read as a
 *                   production email outage that was never happening.
 * 32.4 2026-07-31  RAISED to close tranche 4, after all four branches landed
 *                   in sequence (#104 closes, #102 glossary-admin, #101
 *                   glossary-public, #103 PDF/blog/FAQ). Measured 32.43%
 *                   (21042/64887) on merged main, rounded DOWN on the
 *                   one-decimal scale #101 introduced.
 *
 *                   THE FOUR BRANCH FLOORS WERE NEVER COMPARABLE AND WERE
 *                   NOT MAXED. Each measured its own tranche alone against a
 *                   shared denominator: 28.92, 29.78, 28.97, 29.30. Merged,
 *                   the coverage sets are cumulative, so the true floor sits
 *                   above all of them. Taking the max would have armed 29.7
 *                   and left most of a proven tranche unratcheted.
 *
 *                   Bite proven both ways on merged main, and this entry is
 *                   part of what is measured: census.mjs is itself
 *                   PRODUCT-CODE at 0% covered, so every comment line added
 *                   here enlarges the denominator it reports.
 * 33.4 2026-07-31  RAISED by the tranche-5 moderation drive. The STUC
 *                   moderation surface -- community/flags.js, ban.js and
 *                   unban.js -- went from ABSENT-FROM-THE-REPORT (never
 *                   imported by any test, which reads as 0 but is not the
 *                   same thing) to 100% lines on all three, exercised against
 *                   a real SQLite engine loaded with the committed schema.
 *                   Measured 33.46% (21713/64887) on a clean checkout of this
 *                   branch, rounded DOWN on the one-decimal scale.
 *
 *                   The endpoints were picked because a canned mock cannot
 *                   test them at all: "the ban bites" is a claim about a row
 *                   written by ban.js and re-read much later by a DIFFERENT
 *                   query inside requireMember, and the flag duplicate/upsert
 *                   path is decided by the UNIQUE index in schema.sql. The
 *                   ban refusal is asserted through the real requireMember and
 *                   through two real endpoints, never a stub.
 *
 * 26.5 2026-07-31  LOWERED, AND THE OLD NUMBER WAS WRONG RATHER THAN THE
 *                   COVERAGE HAVING REGRESSED. This is the one move the ratchet
 *                   rule does not cover, so it is spelled out. Not one test was
 *                   deleted and not one line stopped being covered; the
 *                   DENOMINATOR was corrected.
 *
 *                   functions/api/auth/_disposable-domains.js is an
 *                   auto-generated Set of 5197 disposable-email domains, 5202
 *                   lines of string literals with no functions and no branches.
 *                   It was classified PRODUCT-CODE by the catch-all
 *                   /^functions\// rule and scored 5202/5202 = 100% for the sole
 *                   reason that _email-validate.js imports it. At 5202 lines it
 *                   was 8.02% of the entire 64887-line PRODUCT-CODE denominator,
 *                   ALL of it counted as covered, contributing nothing to the
 *                   question this metric exists to answer. It has been
 *                   reclassified GENERATED (see the override in
 *                   lib/census-rules.mjs for the full written justification).
 *
 *                   BECAUSE THOSE LINES COUNTED AS COVERED, REMOVING THEM FROM
 *                   BOTH SIDES LOWERS THE HEADLINE: 21042/64887 = 32.43%
 *                   becomes 15840/59685 = 26.54%, a drop of 5.89 points. Every
 *                   PRODUCT-CODE percentage this program has reported was
 *                   inflated by roughly that much, including the 32.4 the floor
 *                   was armed against and the four tranche floors above. The old
 *                   headline is NOT preserved: a floor defended by a padded
 *                   denominator protects nothing, and re-arming at 32.4 over the
 *                   corrected denominator would demand 19358 covered lines the
 *                   suite has never had.
 *
 *                   Armed at 26.5, the corrected measurement rounded DOWN. The
 *                   ratchet still only moves up FROM HERE; this entry is the
 *                   record of the one-time correction it moves up from.
 *
 *                   THE MECHANISM USED HERE IS ALSO AN ATTACK ON THE METRIC.
 *                   Reclassifying a file out of PRODUCT-CODE raises the
 *                   percentage whenever the file is worse-covered than the
 *                   average, with no test written. That is exactly the lever
 *                   this entry pulls, which is why it was only acceptable in the
 *                   direction that COST coverage. A reclassification that
 *                   shrinks the denominator and RAISES the number deserves the
 *                   same scrutiny as lowering the floor; see the PR that landed
 *                   this for the guard suggested to make that visible.
 *
 *                   Swept for siblings at the same time: no other generated or
 *                   vendored data table is sitting in the PRODUCT-CODE
 *                   denominator counted covered by a bare import.
 *                   src/lib/infographic/wordmark.mjs is generated but is 11
 *                   lines and exports a real exercised function;
 *                   scripts/ssot-postbuild.mjs matched a grep for "vendored"
 *                   only in prose about a CI fallback and sits at 0%, so it
 *                   inflates nothing.
 *
 * 27.6 2026-07-31  EVENTS AND LEARNING COLLABORATIVES TRANCHE, LANE 1 OF 6
 *                   (moderation: flags, ban, unban). RE-ARMED ON THE CORRECTED
 *                   DENOMINATOR, which is why this reads 27.6 and not the 33.4
 *                   the lane branch itself armed.
 *
 *                   Every lane in this tranche was branched, measured and armed
 *                   BEFORE the 26.5 correction above landed, so each one carries
 *                   a floor computed over the padded 64887-line denominator:
 *                   33.4 here, and 34.7 / 34.8 / others on the sibling lanes.
 *                   Those numbers are not reachable over the corrected 59754-line
 *                   denominator and re-arming at them would leave the gate red on
 *                   arrival, which the ratchet rule forbids. Each lane is
 *                   therefore re-armed at ITS OWN post-merge measurement rounded
 *                   DOWN as it lands. The ratchet is intact: it moves up from
 *                   26.5 with every lane, it just moves up from the honest
 *                   baseline rather than the inflated one.
 *
 *                   Measured 27.63% (16511/59754) on the merge commit, in a
 *                   clean checkout with the gitignored src/data/*.json absent,
 *                   the way CI measures. See the note directly below: with those
 *                   data files present the same tree reads 27.77%, so the census
 *                   is regenerated without them.
 *
 * 34.7 2026-07-31  RAISED by the tranche-5 community-content drive. The
 *                  member-authored content core went 0 -> 100% lines:
 *                  community/posts.js (747 lines, the largest
 *                  never-executed file in the repo), community/comments.js
 *                  (324) and community/reactions.js (110). 272 tests against
 *                  a real SQLite engine loaded with the committed schema
 *                  (test/_d1-sqlite.mjs), because every load-bearing decision
 *                  on this surface is the database's: pinned-first ordering
 *                  under a created_at cursor, the UNIQUE NOCASE slug index,
 *                  meta.changes driving the reaction toggle, and the
 *                  order-dependent six-statement delete batch.
 *                  Measured 34.80% (22580/64887) on a CLEAN checkout, up from
 *                  32.43% on the same denominator. Rounded DOWN on the
 *                  one-decimal scale the true 34.7989% is 34.7, not 34.8, so
 *                  34.7 is what is armed; 34.8 was verified RED (exit 1) and
 *                  34.7 GREEN (exit 0) on this branch.
 *
 *                  Measured on a branch, and per the tranche-4 note above a
 *                  branch floor is not comparable with a sibling's. It is
 *                  safe to arm anyway because this branch adds no product
 *                  file: the denominator is byte-identical to main's 64887,
 *                  and merged coverage sets are cumulative, so merged main
 *                  can only measure higher.
 *
 * 29.7 2026-07-31  TRANCHE LANE 2 OF 6 (posts, comments, reactions).
 *                   Re-armed on the corrected denominator: the lane branch
 *                   armed 34.7, measured over the padded 64887-line
 *                   PRODUCT-CODE denominator before #110 reclassified the 5202
 *                   generated lines of _disposable-domains.js out of it. That
 *                   number is not reachable over the corrected denominator, so
 *                   arming it would leave the gate red on arrival, which the
 *                   ratchet rule forbids. See the 27.6 entry above for the full
 *                   statement of how this tranche re-arms.
 *
 *                   Measured 29.73% (17784/59816) on the merge commit, in a
 *                   clean checkout with the gitignored src/data/*.json absent,
 *                   the way CI measures. The ratchet moved UP: 27.6 on
 *                   main before this merge, 29.7 after it.
 *
 * 34.1 2026-07-31  RAISED on the tranche-5 EVENTS-AND-LEARNING-COLLABORATIVES
 *                   membership lane (quality/coverage-ev-membership). The STUC
 *                   community membership gate and its join/leave surface: all
 *                   fourteen files to 100% lines and 100% functions, 1364/1364,
 *                   thirteen of which were sitting at zero.
 *
 *                   Measured 34.11% (22146/64920) against a 32.4 floor, in a
 *                   clean checkout with no fetched src/data/glossary.json, so
 *                   the number is the one CI reproduces. Rounded DOWN to 34.1
 *                   and bite-proven both ways on this branch.
 *
 *                   THIS IS A BRANCH FLOOR, NOT A TRANCHE FLOOR. The other
 *                   tranche-5 lanes measure their own surfaces against the same
 *                   denominator, so their numbers and this one are not
 *                   comparable and taking the max at merge would under-arm the
 *                   ratchet exactly as the tranche-4 entry above records.
 *                   Re-measure on merged main and arm THAT number.
 *
 *                   THE ONE THING THIS DRIVE HAD TO ADD TO THE HARNESS, and
 *                   why: the action-areas tables (action_area, project,
 *                   area_membership, project_membership, impact_entry,
 *                   area_ownership_request, community_post.area_id) are in
 *                   NEITHER schema.sql NOR the POST_SNAPSHOT_MIGRATIONS replay
 *                   list. Their DDL lives in the ROOT migrations/ directory
 *                   (025, 027), which the replay list does not read and
 *                   test/schema-migration-replay.test.mjs does not scan, and
 *                   025's own header records its pre-apply check running
 *                   against live rrm-auth on 2026-05-29, two days AFTER the
 *                   schema.sql snapshot. So the default harness cannot even
 *                   PREPARE a statement on this product. test/_community-sqlite.mjs
 *                   composes the snapshot with those two files; _d1-sqlite.mjs
 *                   gained one line, `export const SCHEMA_SQL`, so it could.
 *
 * 31.4 2026-07-31  TRANCHE LANE 3 OF 6 (the requireMember gate and the
 *                   join/leave surface, 14 files to 100%).
 *                   Re-armed on the corrected denominator: the lane branch
 *                   armed 34.1, measured over the padded 64887-line
 *                   PRODUCT-CODE denominator before #110 reclassified the 5202
 *                   generated lines of _disposable-domains.js out of it. See
 *                   the 27.6 entry above for the full statement of how this
 *                   tranche re-arms.
 *
 *                   Measured 31.42% (18807/59863) on the merge commit, in a
 *                   clean checkout with the gitignored src/data/*.json absent,
 *                   the way CI measures. The ratchet moved UP: 29.7 on
 *                   main before this merge, 31.4 after it.
 *
 * 34.8 2026-07-31  RAISED by the tranche-5 community-administration drive. The
 *                  four admin CRUD endpoints behind the STUC Action Areas hub
 *                  went 0 -> 100% lines, branches and functions:
 *                  admin/community/{projects,areas,impact,ownership}.js, 1135
 *                  lines that no test had ever imported. Measured 34.82%
 *                  (22596/64887) on a clean checkout, up from 32.43%
 *                  (21042/64887) on the same checkout before the drive.
 *
 *                  The gain is larger than the 1135 lines targeted because
 *                  the tests call the CONSUMERS rather than asserting on the
 *                  admin handlers' own return values: community/areas.js,
 *                  community/projects.js, community/memberships.js,
 *                  community/areas/{join,leave,volunteer}.js and the real
 *                  requireMember gate all execute as a side effect of proving
 *                  that an ownership grant is actually conferred.
 *
 *                  THE HARNESS WAS BLIND TO THIS ENTIRE SUBSYSTEM. schema.sql
 *                  contains no action_area, project, area_membership,
 *                  project_membership, impact_entry or area_ownership_request,
 *                  and community_post has no area_id: those objects were
 *                  created by migrations/025 and /027, which live in the
 *                  REPO-ROOT migrations/ directory, not scripts/migrations/.
 *                  test/schema-migration-replay.test.mjs partitions
 *                  scripts/migrations/ only, so a root migration is named by
 *                  neither half of its partition, and _d1-sqlite.mjs resolves
 *                  POST_SNAPSHOT_MIGRATIONS against scripts/migrations/, so it
 *                  cannot list one. test/_community-schema.mjs composes the
 *                  missing DDL on top of the snapshot; see its header.
 *
 * 33.2 2026-07-31  TRANCHE LANE 4 OF 6 (community administration CRUD).
 *                   Re-armed on the corrected denominator: the lane branch
 *                   armed 34.8, measured over the padded 64887-line
 *                   PRODUCT-CODE denominator before #110 reclassified the 5202
 *                   generated lines of _disposable-domains.js out of it. The
 *                   lane's own PR body anticipated exactly this, noting the
 *                   floor was armed at that branch's isolated measurement and
 *                   that the true post-merge floor would have to be set by
 *                   whoever sequenced the tranche. See the 27.6 entry above.
 *
 *                   Measured 33.29% (19942/59907) on the merge commit, in a
 *                   clean checkout with the gitignored src/data/*.json absent,
 *                   the way CI measures. The ratchet moved UP: 31.4 on
 *                   main before this merge, 33.2 after it.
 *
 * MEASURE IN A CLEAN CHECKOUT, THE WAY CI DOES.
 * `src/data/glossary.json` is GITIGNORED and is never present in CI (the
 * workflow runs `npm ci` then `npm test`; there is no fetch-all step). The
 * audit-glossary-links smoke test in test/glossary-link-classifier.test.js
 * skips itself when that file is missing, and scripts/audit-glossary-links.mjs
 * then measures 0/101 instead of 81/101. So a measurement taken in a working
 * copy that has fetched data reads ~0.12 points HIGHER than the number the
 * gate actually sees. Regenerate the census from a clean checkout, or the
 * committed snapshot records coverage CI cannot reproduce.
 *   with fetched glossary.json:    19349/64704 = 29.90%
 *   clean checkout (what CI sees): 19268/64704 = 29.78%   <- the census below
 * The rest is main's functions/api/endo-quiz/download.js (789d734d), which
 * added 45 uncovered lines to the denominator, against +5 covered here.
 *
 * A REPO-WIDE FLOOR CAN HIDE A PRODUCT AT ZERO. That is what tranche 3 found:
 * this number was green at 26 while five separate product surfaces measured
 * 0-18%. The floor is a ratchet on the aggregate, not evidence that any
 * particular surface is tested. Read the per-product view
 * (tools/coverage-portfolio/status.mjs) before concluding a product is covered.
 */
const ARMED_FLOOR_PCT = 33.2;

const argv = process.argv.slice(2);
const covDirIdx = argv.indexOf('--coverage-dir');
const COV_DIR = covDirIdx !== -1 ? resolve(argv[covDirIdx + 1]) : resolve(ROOT, 'reports', 'quality', 'coverage');
const CHECK = argv.includes('--check');

// ---- 1. Enumerate + classify ----
const surface = await enumerateSurface(ROOT);
const unclassified = [];
const files = [];
for (const rel of surface) {
  const c = classify(rel);
  if (!c) { unclassified.push(rel); continue; }
  files.push({ file: rel, category: c.category, reason: c.reason });
}
if (unclassified.length > 0) {
  console.error('[census] FATAL: unclassified surface files (add a rule or override in census-rules.mjs):');
  for (const f of unclassified) console.error('  - ' + f);
  process.exit(1);
}

// ---- 2. Join coverage ----
const summaryPath = resolve(COV_DIR, 'coverage-summary.json');
const finalPath = resolve(COV_DIR, 'coverage-final.json');
let summary, covByFile;
try {
  summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  covByFile = await loadCoverage(finalPath);
} catch (err) {
  console.error(`[census] FATAL: cannot read coverage report in ${COV_DIR} — run node scripts/quality/coverage.mjs first (${err.message})`);
  process.exit(1);
}

const missingFromReport = [];
for (const f of files) {
  const abs = resolve(ROOT, f.file);
  const s = summary[abs];
  if (!s) { missingFromReport.push(f.file); continue; }
  const entries = covByFile[abs] ?? [];
  f.present = entries.length > 0 && !isUntouched(entries);
  f.lines = s.lines.total;
  f.covered = s.lines.covered;
  f.pct = s.lines.pct;
}
if (missingFromReport.length > 0) {
  console.error('[census] FATAL: surface files ABSENT from the c8 report even with --all (include globs drifted from census-rules SURFACE_ROOTS):');
  for (const f of missingFromReport) console.error('  - ' + f);
  process.exit(1);
}

// ---- 3. Aggregates ----
function agg(list) {
  let lines = 0, covered = 0;
  for (const f of list) { lines += f.lines; covered += f.covered; }
  return { files: list.length, lines, covered, pct: lines === 0 ? 100 : +(100 * covered / lines).toFixed(2) };
}
const byCategory = {};
for (const cat of Object.keys(CATEGORIES)) {
  byCategory[cat] = agg(files.filter(f => f.category === cat));
}
// The national survey system product is BOTH prefixes: the organic
// /endo-survey/ flow under survey/ and the Google Ads landing flow under
// endo-quiz/. Reporting only survey/ read 100% on 2026-07-29 while
// endo-quiz/request.js sat at 0/224 inside the same product.
const SURVEY_PRODUCT_PREFIXES = ['functions/api/survey/', 'functions/api/endo-quiz/'];
const inSurveyProduct = (f) => SURVEY_PRODUCT_PREFIXES.some(p => f.file.startsWith(p));
const surveyAgg = agg(files.filter(inSurveyProduct));
const product = files.filter(f => f.category === 'PRODUCT-CODE');
const productAgg = agg(product);
const fullAgg = agg(files);

// ---- 4. CRAP ranking over PRODUCT-CODE ----
const complexityRules = { complexity: ['warn', { max: 1 }] };
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.js', '**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module' }, rules: complexityRules },
    { files: ['**/*.ts', '**/*.mts'], languageOptions: { parser: (await import('@typescript-eslint/parser')).default, ecmaVersion: 2024, sourceType: 'module' }, rules: complexityRules },
  ],
});
const lintResults = await eslint.lintFiles(product.map(f => f.file));
const crapRecords = [];
for (const r of lintResults) {
  const rel = r.filePath.replace(ROOT + '/', '');
  const meta = product.find(f => f.file === rel);
  if (!meta) continue;
  const covEntries = covByFile[r.filePath] ?? [];
  const untouched = !meta.present;
  for (const m of r.messages) {
    if (m.ruleId !== 'complexity') continue;
    const ccMatch = m.message.match(/complexity of (\d+)/);
    if (!ccMatch) continue;
    const cc = Number(ccMatch[1]);
    const nameMatch = m.message.match(/^(?:Function|Method|Arrow function|Async function|Async arrow function|Generator function|Async method|Static method|Getter|Setter|Constructor|Class (?:static block|field initializer))(?: '([^']+)')?/);
    const name = nameMatch?.[1] ?? '<anonymous>';
    let coverage = 0;
    if (!untouched) {
      // nearest real coverage entry by line (±2), else name match, else 0
      let best = covEntries.find(c => c.name === name && Math.abs(c.line - m.line) <= 2);
      if (!best) best = covEntries.find(c => Math.abs(c.line - m.line) <= 2);
      if (!best && name !== '<anonymous>') best = covEntries.find(c => c.name === name);
      coverage = best ? best.coverage : 0;
    }
    crapRecords.push({ file: rel, fn: name, line: m.line, cc, coverage: +coverage.toFixed(2), crap: +crap(cc, coverage).toFixed(1) });
  }
}
crapRecords.sort((a, b) => b.crap - a.crap);
const crapTop = crapRecords.slice(0, 30);
// per-file rollup: worst function CRAP + total
const perFileCrap = new Map();
for (const rec of crapRecords) {
  const cur = perFileCrap.get(rec.file) ?? { file: rec.file, worst: 0, total: 0, fns: 0 };
  cur.worst = Math.max(cur.worst, rec.crap);
  cur.total += rec.crap;
  cur.fns += 1;
  perFileCrap.set(rec.file, cur);
}
const crapFilesTop = [...perFileCrap.values()].sort((a, b) => b.total - a.total).slice(0, 20)
  .map(f => ({ ...f, total: +f.total.toFixed(0), worst: +f.worst.toFixed(0) }));

// ---- 5. Assemble census ----
const census = {
  _note: 'Every first-party executable file (census-rules.mjs SURFACE_ROOTS) is accounted for here, and scripts/quality/coverage.mjs FAILS its run if the enumerated surface drifts from this file or a new file matches no classification rule. A file is either PRODUCT-CODE (inside the gated coverage denominator) or excluded below with a category and written reason — never silently. Regenerate with: node scripts/quality/coverage.mjs && node scripts/quality/census.mjs',
  _generated: new Date().toISOString().slice(0, 10),
  _categories: CATEGORIES,
  _gate: {
    scope: 'PRODUCT-CODE',
    metric: 'c8 line coverage with --all (every surface file in the denominator)',
    floor_lines_pct: ARMED_FLOOR_PCT,
    ratchet_rule: 'The floor may only move UP. Arm at the measured floor rounded down; never arm a number that is red on arrival. Raise it after a coverage drive lands, by editing this value to the new measured floor rounded down.',
  },
  _measured: {
    date: new Date().toISOString().slice(0, 10),
    instrument: 'node scripts/quality/coverage.mjs (c8 --all over the full surface; full npm-test suite)',
    full_surface: fullAgg,
    by_category: byCategory,
    product_code: productAgg,
    // ABSENT and ZERO are different conditions and this instrument must not
    // blur them. Under `c8 --all` NOTHING on the surface is absent -- the gate
    // fails the run if a surface file is missing from the report. These two
    // counts split the report into files with executed lines and files sitting
    // at zero. The older key names said "absent from default report", which
    // read as "not in the report at all" and put that false claim into a PR
    // body. Renamed 2026-07-31; nothing consumes these but humans.
    files_at_zero_in_full_report: files.filter(f => !f.present).length,
    files_executed_in_full_report: files.filter(f => f.present).length,
    highest_stakes_slice: {
      slice: 'national survey system (functions/api/survey/ + functions/api/endo-quiz/)',
      files: files.filter(inSurveyProduct).map(f => `${f.file} ${f.covered}/${f.lines} (${f.pct}%)`),
      state: `${surveyAgg.covered}/${surveyAgg.lines} lines (${surveyAgg.pct}%). Executed suites: test/survey-request.test.js, test/survey-submit.test.js, test/survey-endpoints.test.js, test/endo-quiz-request.test.js, test/endo-quiz-download.test.js. The two load-bearing invariants are asserted by running the handlers against SEPARATE databases: identity (email + rec_id) lands only in SURVEY_DB while symptoms land only in SURVEY_SYMPTOMS_DB with no address in the SQL or any bound value; and a failed symptom write deletes the D1 token claim and restores the original KV token record so the participant can resubmit. The endo-quiz (Google Ads) half runs on real SQLite engines built from the committed rrm-survey-symptoms migration, and asserts the same split plus the asymmetry either side of it: a failed symptom write is a 500 with no identity row, a failed identity write still counts the submission and alerts an administrator by rec_id.`,
    },
  },
  _line_exclusions: [
    {
      file: 'functions/api/admin/enrollments.js',
      lines: 'the `if (!env.DB) return 503 Database unavailable` guard',
      mechanism: 'c8 ignore start/stop in the source, next to the same explanation',
      reason: 'UNREACHABLE, and kept as defence in depth rather than deleted. onRequestGet calls requireSuperAdmin(request, env.DB) first, and functions/api/auth/_shared.js answers `if (!db) return 500 Server misconfigured` before doing anything else, so control cannot arrive at the 503 with a falsy env.DB. Proven by execution in test/admin-enrollments.test.js ("500s when the DB binding is absent"), which asserts the 500 the endpoint actually produces; a test asserting 503 would have been asserting a response this endpoint cannot return, and reaching it would have required an env object that lies about its own bindings. Delete the ignore hints, not the guard, if requireSuperAdmin ever stops checking its db argument.',
    },
  ],
  _followup_estimate_hours: {
    'PRODUCT-CODE functions/api (survey path + Stripe webhook cluster + identity path + training analytics + FABM quiz API + endo-quiz DONE)': 'survey/ is at 100%; the billing webhook cluster is executed rather than grepped (test/_json-module-hook.mjs made the module graph importable); tranche 2 put the identity path (auth login/signup, community membership gate + roster, admin membership-report, donor rollups, webhook dedup) on a real SQLite engine loaded with the committed schema (test/_d1-sqlite.mjs); tranche 3 did the same for the five PRODUCT surfaces that were sitting under a green repo-wide floor -- training analytics (courses/progress.js 100%, admin/enrollments.js 96.7%), the FABM quiz API (quiz/request.js, quiz/event.js, courses/quiz.js, courses/_quiz-content.js all 100%, on a SURVEY_DB harness built from the committed rrm-survey migrations), and library/deploy-record.js 100%; and tranche 4 closed the endo-quiz half of the national survey system (request.js 0 -> 100% and download.js 0 -> 100%, on separate SURVEY_DB and SURVEY_SYMPTOMS_DB engines) plus the last two lines of admin/enrollments.js. Remaining: ~120 endpoint files still absent from any test, 85-115h to ~80% lines. Next worst by CRAP: functions/api/billing/_webhook-subscription.js and functions/api/create-checkout.js',
    'PRODUCT-CODE CLOSED in tranche 4: scripts/build-library-feed.mjs (was 0%, 75 lines)': 'Was the last zero in the library render surface, and was recorded here as not coverable as written: both paths were resolved at module scope from import.meta.url, so importing it read the real 32MB gitignored src/data/articles.json and rewrote public/library-feed.jsonl, and on a clean CI checkout it took the existsSync early-exit and covered nothing. Closed 2026-07-31 by the smallest production change that removes the obstacle -- buildLibraryFeed({articlesPath, outPath, logger}) defaulting to the same two constants, main() for the CLI -- verified by rebuilding the real 4053-record feed and diffing it byte for byte against what main produced (identical, sha256 0edf193c193bafa9297abff7567ccf52fd22265ce1c639d0fbe0e795fd0fb4ae). Now 154/154 lines, 100% branches, with the CLI entry exercised as a real subprocess.',
    'PRODUCT-CODE scripts (gates, guards, fact pipeline, build chain)': '35-50h; start with guard.mjs + verify-citations.mjs + the fact-pipeline promote/extract pair (top CRAP offenders), pure-logic extraction first',
    'PRODUCT-CODE src/lib + src/scripts + src/integrations': '18-25h; fetchers have a dry-run mode that makes them testable without live endpoints',
    'CONTENT-TEMPLATE / E2E-DRIVER / ONE-OFF / GENERATED': '0h by design — wrong instrument; correctness held by builds, deploy-guard floors, and live runs',
  },
  crap_top_functions: crapTop,
  crap_top_files: crapFilesTop,
  files,
};

if (CHECK) {
  let committed;
  try { committed = JSON.parse(await readFile(OUT, 'utf8')); }
  catch { console.error('[census] --check: no committed census at ' + OUT); process.exit(1); }
  const want = new Map(files.map(f => [f.file, f.category]));
  const have = new Map((committed.files ?? []).map(f => [f.file, f.category]));
  const problems = [];
  for (const [f, cat] of want) {
    if (!have.has(f)) problems.push(`missing from committed census: ${f}`);
    else if (have.get(f) !== cat) problems.push(`category drift for ${f}: committed=${have.get(f)} rules=${cat}`);
  }
  for (const f of have.keys()) if (!want.has(f)) problems.push(`stale entry (file gone): ${f}`);
  if (problems.length > 0) {
    console.error('[census] --check FAILED:');
    for (const p of problems) console.error('  - ' + p);
    console.error('[census] regenerate: node scripts/quality/coverage.mjs && node scripts/quality/census.mjs');
    process.exit(1);
  }
  console.log(`[census] --check OK: ${files.length} files, categories match committed census.`);
  process.exit(0);
}

await writeFile(OUT, JSON.stringify(census, null, 1) + '\n');
console.log(`[census] wrote ${OUT}`);
console.log(`[census] surface: ${fullAgg.files} files, ${fullAgg.lines} lines, ${fullAgg.pct}% covered`);
for (const [cat, a] of Object.entries(byCategory)) {
  console.log(`[census]   ${cat.padEnd(18)} ${String(a.files).padStart(3)} files ${String(a.lines).padStart(6)} lines ${String(a.pct).padStart(6)}%`);
}
console.log(`[census] PRODUCT-CODE (gated): ${productAgg.covered}/${productAgg.lines} = ${productAgg.pct}%`);
