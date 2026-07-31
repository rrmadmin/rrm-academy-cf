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
const ARMED_FLOOR_PCT = 29;

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
const surveyAgg = agg(files.filter(f => f.file.startsWith('functions/api/survey/')));
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
    files_absent_from_default_report: files.filter(f => !f.present).length,
    files_present_in_default_report: files.filter(f => f.present).length,
    highest_stakes_slice: {
      slice: 'national survey intake/submit path (functions/api/survey/)',
      files: files.filter(f => f.file.startsWith('functions/api/survey/')).map(f => `${f.file} ${f.covered}/${f.lines} (${f.pct}%)`),
      state: `${surveyAgg.covered}/${surveyAgg.lines} lines (${surveyAgg.pct}%). Executed suites: test/survey-request.test.js, test/survey-submit.test.js, test/survey-endpoints.test.js. The two load-bearing invariants are asserted by running the handlers against SEPARATE fake databases: identity (email + rec_id) lands only in SURVEY_DB while symptoms land only in SURVEY_SYMPTOMS_DB with no address in the SQL or any bound value; and a failed symptom write deletes the D1 token claim and restores the original KV token record so the participant can resubmit.`,
    },
  },
  _followup_estimate_hours: {
    'PRODUCT-CODE functions/api (survey path + Stripe webhook cluster + identity path + training analytics + FABM quiz API DONE)': 'survey/ is at 100%; the billing webhook cluster is executed rather than grepped (test/_json-module-hook.mjs made the module graph importable); tranche 2 put the identity path (auth login/signup, community membership gate + roster, admin membership-report, donor rollups, webhook dedup) on a real SQLite engine loaded with the committed schema (test/_d1-sqlite.mjs); and tranche 3 did the same for the five PRODUCT surfaces that were sitting under a green repo-wide floor -- training analytics (courses/progress.js 100%, admin/enrollments.js 96.7%), the FABM quiz API (quiz/request.js, quiz/event.js, courses/quiz.js, courses/_quiz-content.js all 100%, on a SURVEY_DB harness built from the committed rrm-survey migrations), and library/deploy-record.js 100%. Remaining: ~120 endpoint files still absent from any test, 85-115h to ~80% lines. Next worst by CRAP: functions/api/billing/_webhook-subscription.js and functions/api/create-checkout.js',
    'PRODUCT-CODE known gap: scripts/build-library-feed.mjs (0%, 75 lines)': 'The last zero in the library render surface. Its input and output paths are derived from import.meta.url (PROJECT_ROOT = the repo), not from cwd or argv, so it cannot be pointed at a fixture: running it under test either reads the real 32MB gitignored src/data/articles.json and rewrites public/library-feed.jsonl, or -- on a clean CI checkout where that file does not exist -- takes the existsSync early-exit and covers nothing. Covering it needs a production change (inject the two paths), which was judged out of scope for a test-only tranche. Sibling scripts/gates/verify-library-curation.mjs reads CWD-relative and is at 100% without any production change.',
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
