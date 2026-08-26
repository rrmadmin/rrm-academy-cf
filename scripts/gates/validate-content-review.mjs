#!/usr/bin/env node
/**
 * Content review sign-off gates.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-24 seven comparison guides went live on rrmacademy.org without the
 * clinical review they were built to wait for. They were published off a branch
 * literally named `held/compare-and-method-guides`, by a session that read
 * "these pages exist in a branch and 404 on the live site" as a DEFECT TO
 * REPAIR rather than as content being deliberately withheld. Its own commit
 * message said so: "finished and 404 on the live site ... the 7 pages that are
 * genuinely missing". The same commit also declined to bring over
 * `ssot/citation-ledger.json` and `scripts/gates/validate-citations.mjs`,
 * calling the gate "its own decision" -- so it shipped the content while
 * deliberately leaving behind the gate that branch had built for that content.
 *
 * A later audit of the six survivors found 174 uncited numeric or outcome
 * claims, 78 statements affirming or normalising IVF, IUI or donor pathways,
 * and one outright miscitation. The seventh was deleted outright.
 *
 * Nothing stopped any of it. `held/` is a naming convention, not an enforced
 * state, and no check anywhere asked whether a human had read the page.
 *
 * WHAT THIS GATE ASSERTS
 * ----------------------
 * A guide registered in `ssot/guides.json` carries a review sign-off, and that
 * sign-off is not stale relative to the content it signed off on.
 *
 * The second half is the load-bearing one. A one-time "reviewed by" byline is
 * satisfied forever by a review that happened before three rewrites. Comparing
 * `reviewed_at` against the content file's last commit date means editing a
 * page after sign-off re-opens the sign-off, which is the actual guarantee a
 * reader of the byline believes they are getting.
 *
 * SCHEMA -- extends the `reviewer` block that already exists in guides.json:
 *
 *   "reviewer": { "name": "Dr. Naomi Whittaker, MD", "reviewed_at": "2026-08-25" }
 *
 * `name` already drives the rendered "Reviewed by" byline. `reviewed_at` is the
 * addition, and it is a date the reviewer asserts, not a timestamp a script
 * stamps: a gate that stamped its own sign-off would certify nothing.
 *
 * Usage:
 *   node scripts/gates/validate-content-review.mjs
 *   node scripts/gates/validate-content-review.mjs --gate CR2
 *   node scripts/gates/validate-content-review.mjs --json
 *   node scripts/gates/validate-content-review.mjs --quick   # skip git staleness
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const PROJECT_ROOT = process.env.CONTENT_REVIEW_GATE_ROOT
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m';

/**
 * Guides that were already live when this gate landed (2026-08-25) and have no
 * recorded sign-off. Grandfathered so the gate can be switched on today without
 * a flag day, and DELIBERATELY not hidden: this list is the review queue. Every
 * entry needs a 30+ char reason, and CR0 FAILS on an entry whose slug is no
 * longer registered, so the list cannot rot into cover for a new page.
 *
 * Remove a slug from here by adding `reviewed_at` to its reviewer block.
 */
export const UNREVIEWED_AT_GATE_LANDING = {
  'billings-ovulation-method': 'FABM method guide, live since 2026-06-17 behind an under-review notice. Pre-dates this gate.',
  'boston-cross-check': 'FABM method guide, live since 2026-06-17 behind an under-review notice. Pre-dates this gate.',
  'marquette-model': 'FABM method guide, live since 2026-06-17 behind an under-review notice. Pre-dates this gate.',
  'sympto-thermal-method': 'FABM method guide, live since 2026-06-17 behind an under-review notice. Pre-dates this gate.',
  'twoday-method': 'FABM method guide, live since 2026-06-17 behind an under-review notice. Pre-dates this gate.',
  'common-questions-about-rrm': 'Long-standing pillar page, live well before this gate existed. Needs a dated sign-off.',
  'creighton-model': 'Long-standing method pillar, live well before this gate existed. Needs a dated sign-off.',
  'endometriosis': 'Condition pillar, live well before this gate existed. Needs a dated sign-off.',
  'endometritis': 'Condition pillar, live well before this gate existed. Needs a dated sign-off.',
  'miscarriage': 'Condition pillar, live well before this gate existed. Needs a dated sign-off.',
  'naprotechnology': 'Method pillar, live well before this gate existed. Needs a dated sign-off.',
  'neofertility': 'Method pillar, live well before this gate existed. Needs a dated sign-off.',
  'pcos': 'Condition pillar, live well before this gate existed. Needs a dated sign-off.',
  'rrm-care-team': 'Practice-model guide, live well before this gate existed. Needs a dated sign-off.',
  'what-is-rrm': 'Foundational pillar, live well before this gate existed. Needs a dated sign-off.',
};

/** Reviewers whose sign-off counts on clinical content. */
/**
 * Guides that DO name a reviewer but predate the `reviewed_at` field. These were
 * genuinely read by the named clinician; nobody recorded when. They are split
 * from the never-reviewed list on purpose: conflating "read, date not captured"
 * with "nobody has read this" would be the same flattening that let seven
 * unread pages ship. Backfilling a date means ASKING the reviewer, not guessing
 * from git; a gate whose own records were invented certifies nothing.
 *
 * Same rules as the other list: 30+ char reason, CR0 fails a stale slug, and
 * closed to new pages.
 */
export const UNDATED_AT_GATE_LANDING = {
  'femm': 'Reviewed by Erin Kay, DO and carries her byline. Review date never recorded; ask her to confirm it.',
  'glossary': 'Reviewed by Dr. Naomi Whittaker and carries her byline. Review date never recorded; ask her to confirm it.',
  'art-registries-and-codes': 'Reviewed by Dr. Naomi Whittaker and carries her byline. Review date never recorded; ask her to confirm it.',
  'isthmocele': 'Reviewed by Dr. Naomi Whittaker and carries her byline. Review date never recorded; ask her to confirm it.',
  'rrm-success-rates': 'Reviewed by Dr. Naomi Whittaker and carries her byline. Review date never recorded; ask her to confirm it.',
  'fertility-awareness-methods-compared': 'Reviewed by Dr. Naomi Whittaker and carries her byline. Review date never recorded; ask her to confirm it.',
  'fertility-preserving-surgery': 'Reviewed by Dr. Naomi Whittaker and carries her byline. Review date never recorded; ask her to confirm it.',
};

export const CLINICAL_REVIEWERS = [
  'Dr. Naomi Whittaker, MD',
  'Naomi Whittaker, MD',
  'Erin Kay, DO',
];

const MIN_GUIDES = 15;

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const QUICK = argv.includes('--quick');
const gateIdx = argv.indexOf('--gate');
const ONLY_GATE = gateIdx >= 0 ? argv[gateIdx + 1] : null;

const gateResults = [];
let totalFailures = 0;
const pass = (msg) => ({ ok: true, msg });
const fail = (msg) => ({ ok: false, msg });
const warn = (msg) => ({ ok: null, msg });

function printLine(r) {
  if (JSON_MODE) return;
  const icon = r.ok === true ? `${GREEN}PASS${RESET}` : r.ok === false ? `${RED}FAIL${RESET}` : `${YELLOW}WARN${RESET}`;
  console.log(`  ${icon}  ${r.msg}`);
}
function runGate(id, name, fn) {
  if (ONLY_GATE && ONLY_GATE !== id) return;
  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);
  let results;
  try { results = fn(); }
  catch (err) {
    const r = fail(`Gate runner error: ${err.message}`);
    printLine(r); gateResults.push({ id, name, pass: false, items: [r] }); totalFailures++; return;
  }
  if (!Array.isArray(results)) results = [results];
  const ok = results.every((r) => r.ok !== false);
  for (const r of results) printLine(r);
  gateResults.push({ id, name, pass: ok, items: results });
  if (!ok) totalFailures++;
}

// ---------- Load ----------------------------------------------------------
export function loadGuides() {
  const p = join(PROJECT_ROOT, 'ssot/guides.json');
  if (!existsSync(p)) return [];
  const d = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(d.guides) ? d.guides : [];
}
const GUIDES = loadGuides();

/** The file whose edits should re-open a sign-off: the content SSOT if there is
 *  one, otherwise the page component. */
export function contentSourceOf(g) {
  const data = `src/data/${g.slug}.json`;
  if (existsSync(join(PROJECT_ROOT, data))) return data;
  if (g.file && existsSync(join(PROJECT_ROOT, `src/pages/${g.file}`))) return `src/pages/${g.file}`;
  return null;
}

/** Last commit date for a path, or null when git cannot answer. */
export function lastCommitISO(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel],
      { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch { return null; }
}

export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ---------- CR0 -----------------------------------------------------------
export function gateCR0() {
  const r = [];
  if (GUIDES.length < MIN_GUIDES) {
    r.push(fail(`only ${GUIDES.length} guides read from ssot/guides.json, floor ${MIN_GUIDES} — the registry failed to load, the repo did not shrink`));
    return r;
  }
  r.push(pass(`${GUIDES.length} guides read from ssot/guides.json (floor ${MIN_GUIDES})`));

  const slugs = new Set(GUIDES.map((g) => g.slug));
  for (const [listName, list] of [['UNREVIEWED_AT_GATE_LANDING', UNREVIEWED_AT_GATE_LANDING],
                                  ['UNDATED_AT_GATE_LANDING', UNDATED_AT_GATE_LANDING]]) {
    for (const [slug, why] of Object.entries(list)) {
      if (!slugs.has(slug)) {
        r.push(fail(`${listName} names "${slug}", which is not a registered guide — stale grandfather entry, remove it`));
      } else if (!why || why.length < 30) {
        r.push(fail(`${listName}["${slug}"] reason is ${why ? why.length : 0} chars, needs 30+`));
      }
    }
  }
  const both = Object.keys(UNREVIEWED_AT_GATE_LANDING).filter((s) => s in UNDATED_AT_GATE_LANDING);
  if (both.length) r.push(fail(`slug(s) in BOTH grandfather lists, which is contradictory: ${both.join(', ')}`));
  r.push(pass(`${Object.keys(UNREVIEWED_AT_GATE_LANDING).length} never-reviewed + ${Object.keys(UNDATED_AT_GATE_LANDING).length} reviewed-but-undated, each with a reason — these two lists are the review queue, not an exemption`));
  return r;
}

// ---------- CR1: every guide has a sign-off -------------------------------
export function gateCR1() {
  const r = [];
  for (const g of GUIDES) {
    const neverReviewed = g.slug in UNREVIEWED_AT_GATE_LANDING;
    const undated = g.slug in UNDATED_AT_GATE_LANDING;
    const rev = g.reviewer;
    const has = rev && typeof rev === 'object' && rev.name && isISODate(rev.reviewed_at);
    if (has) {
      r.push(pass(`${g.slug} signed off by ${rev.name} on ${rev.reviewed_at}`));
    } else if (undated && rev && rev.name) {
      r.push(warn(`${g.slug} reviewed by ${rev.name}, date never recorded — backfill by asking the reviewer, never by guessing`));
    } else if (neverReviewed) {
      r.push(warn(`${g.slug} has no sign-off at all (grandfathered, pre-dates this gate — needs an actual review)`));
    } else {
      const detail = !rev ? 'no reviewer block'
        : !rev.name ? 'reviewer block has no name'
        : `reviewer "${rev.name}" has no valid reviewed_at (got ${JSON.stringify(rev.reviewed_at)})`;
      r.push(fail(
        `${g.slug} has no review sign-off (${detail}). A guide does not go live unread. ` +
        `Add "reviewer": { "name": "...", "reviewed_at": "YYYY-MM-DD" } to its ssot/guides.json entry once a ` +
        `clinician has actually read it. Do not add it to the grandfather list; that list is closed to new pages.`));
    }
  }
  return r;
}

// ---------- CR2: the sign-off is not stale --------------------------------
export function gateCR2() {
  if (QUICK) return warn('skipped in --quick mode (needs git history)');
  const r = [];
  let checked = 0;
  for (const g of GUIDES) {
    const rev = g.reviewer;
    if (!rev || !isISODate(rev.reviewed_at)) continue;   // CR1 owns that case
    const src = contentSourceOf(g);
    if (!src) { r.push(warn(`${g.slug} has a sign-off but no locatable content source to date it against`)); continue; }
    const edited = lastCommitISO(src);
    if (!edited) { r.push(warn(`${g.slug} git history unavailable for ${src} — staleness not checked`)); continue; }
    checked++;
    // Compare dates only. A same-day edit-then-review is the normal shape.
    const editedDay = edited.slice(0, 10);
    if (editedDay > rev.reviewed_at) {
      r.push(fail(
        `${g.slug} sign-off is STALE: reviewed ${rev.reviewed_at}, but ${src} was last edited ${editedDay}. ` +
        `The content changed after the review that vouches for it. Re-review and move reviewed_at forward, ` +
        `or revert the edit.`));
    } else {
      r.push(pass(`${g.slug} sign-off current (reviewed ${rev.reviewed_at} >= edited ${editedDay})`));
    }
  }
  if (checked === 0 && !QUICK) r.push(warn('no sign-offs were datable against git history — staleness is unverified this run'));
  return r;
}

// ---------- CR3: reviewer identity ----------------------------------------
export function gateCR3() {
  const r = [];
  for (const g of GUIDES) {
    const rev = g.reviewer;
    if (!rev || !rev.name) continue;
    if (CLINICAL_REVIEWERS.includes(rev.name)) {
      r.push(pass(`${g.slug} reviewer is a recognised clinician: ${rev.name}`));
    } else {
      r.push(fail(
        `${g.slug} reviewer "${rev.name}" is not in CLINICAL_REVIEWERS. Clinical guidance is signed off by a ` +
        `clinician, and the byline this drives tells patients exactly that. Add the person to CLINICAL_REVIEWERS ` +
        `if that is genuinely who reviewed it.`));
    }
  }
  if (r.length === 0) r.push(warn('no guide carries a reviewer name yet'));
  return r;
}

// ---------- Run -----------------------------------------------------------
// Importing this module for its constants (the test harness does) must not run
// the gates or call process.exit.
const INVOKED_DIRECTLY = process.argv[1] && process.argv[1].endsWith('validate-content-review.mjs');
if (!INVOKED_DIRECTLY) { /* imported for constants only */ }
else {
runGate('CR0', 'Registry + grandfather-list integrity', gateCR0);
runGate('CR1', 'Every registered guide carries a dated sign-off', gateCR1);
runGate('CR2', 'No sign-off is stale relative to its content', gateCR2);
runGate('CR3', 'Sign-off is by a recognised clinician', gateCR3);

if (JSON_MODE) {
  console.log(JSON.stringify({ pass: totalFailures === 0, failures: totalFailures, gates: gateResults }, null, 2));
} else {
  console.log('');
  console.log(totalFailures === 0
    ? `${GREEN}${BOLD}OK: all content review gates passed${RESET}`
    : `${RED}${BOLD}FAIL: ${totalFailures} gate(s) failed${RESET}`);
}
process.exit(totalFailures === 0 ? 0 : 1);
}
