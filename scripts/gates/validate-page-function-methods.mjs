#!/usr/bin/env node
/**
 * Page-function HTTP method gates.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-25 the STUC event invite pages would not render a link card on X.
 * Every OG surface was correct: `twitter:card` was `summary_large_image`, the
 * image URLs were absolute HTTPS and returned valid 1200x630 PNGs, the tags sat
 * at byte ~5100 so no crawler truncation reached them, robots.txt allowed the
 * crawler on both page and image, and there was no bot challenge. GET returned
 * 200. HEAD returned 404.
 *
 * `functions/events/[slug].js` exported only `onRequestGet`, so Cloudflare Pages
 * had no handler for HEAD on that route and fell through to 404. Link-preview
 * crawlers commonly probe with HEAD before fetching, and a 404 there ends the
 * unfurl before a single tag is read.
 *
 * Nothing caught it. Not a test, not a lint, not a deploy check, not an /arise
 * run. The page was a clean 200 in every browser, so the defect was invisible
 * from the outside and only showed up as "the image doesn't work on X".
 *
 * SCOPE
 * -----
 * Shareable page surfaces: HTML-serving route modules under `functions/`,
 * EXCLUDING `functions/api/**`. API endpoints are reached programmatically or
 * by redirect, nobody posts a link to one, and forcing HEAD on them would be
 * scope creep with real risk (some carry side effects on GET).
 *
 * A module is in scope when it is a CF Pages route (not `_`-prefixed, not
 * inside a `_`-prefixed directory) and it serves something a link-preview
 * crawler fetches: HTML (`text/html`) or an image (`image/...`). The image half
 * is not padding. A crawler probes the og:image URL as well as the page, so an
 * image route that 404s HEAD breaks the card just as completely as a page that
 * does. The first draft of this gate scoped to HTML only and immediately lost
 * `functions/og/[[path]].js`, the single most card-critical route on the site.
 * Enumeration is from disk, never a hand-maintained list: the payment gates
 * learned that lesson when four money-path files sat invisible to PG2/PG3 for
 * months while the runner printed "all gates passed".
 *
 * ANSWERING HEAD means exporting either `onRequest` (a catch-all, which serves
 * every verb) or `onRequestHead`. Delegating HEAD to GET is only safe when the
 * GET handler is read-only; the gate cannot prove that, so the comment on each
 * delegation should say why it holds.
 *
 * Usage:
 *   node scripts/gates/validate-page-function-methods.mjs
 *   node scripts/gates/validate-page-function-methods.mjs --gate HM1
 *   node scripts/gates/validate-page-function-methods.mjs --json
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = process.env.PAGE_FN_GATE_ROOT
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m';

/**
 * Routes deliberately outside the gate. Key: repo-relative path.
 * Value: reason, 40+ characters, checked by HM0. HM0 also FAILS on an entry
 * whose file no longer exists, so this map cannot rot into cover for real drift.
 */
const EXCLUDED = {
  'functions/save-the-uterus-club/migrate.js':
    'Tokenized magic-link landing for the STUC Wix-to-Stripe migration, not a shareable URL. Each link is bound to one member and one token, it is never posted publicly, and it deliberately should not unfurl a preview of a private account action.',
};

/**
 * Routes that MUST stay in coverage. If one of these ever falls out of the
 * enumeration, the scan has silently narrowed and the gate is worth less than
 * it looks. Same anti-vacuity idea as the payment gates' COVERAGE_SENTINELS.
 */
const COVERAGE_SENTINELS = [
  'functions/events/[slug].js',
  'functions/og/[[path]].js',
];

/** Enumeration floor. Below this the scan has broken, not the repo shrunk. */
const MIN_IN_SCOPE = 3;

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const gateIdx = argv.indexOf('--gate');
const ONLY_GATE = gateIdx >= 0 ? argv[gateIdx + 1] : null;

const gateResults = [];
let totalFailures = 0;

const pass = (msg) => ({ ok: true, msg });
const fail = (msg) => ({ ok: false, msg });
const warn = (msg) => ({ ok: null, msg });

function printLine(r) {
  if (JSON_MODE) return;
  const icon = r.ok === true ? `${GREEN}PASS${RESET}`
             : r.ok === false ? `${RED}FAIL${RESET}`
             : `${YELLOW}WARN${RESET}`;
  console.log(`  ${icon}  ${r.msg}`);
}

function runGate(id, name, fn) {
  if (ONLY_GATE && ONLY_GATE !== id) return;
  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);
  let results;
  try {
    results = fn();
  } catch (err) {
    const r = fail(`Gate runner error: ${err.message}`);
    printLine(r);
    gateResults.push({ id, name, pass: false, items: [r] });
    totalFailures++;
    return;
  }
  if (!Array.isArray(results)) results = [results];
  const ok = results.every((r) => r.ok !== false);
  for (const r of results) printLine(r);
  gateResults.push({ id, name, pass: ok, items: results });
  if (!ok) totalFailures++;
}

// ---------- Enumeration ---------------------------------------------------
function walk(dir, out = []) {
  const abs = join(PROJECT_ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs)) {
    const relPath = `${dir}/${entry}`;
    const full = join(PROJECT_ROOT, relPath);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith('_')) continue;          // helper dir, not routes
      if (relPath === 'functions/api') continue;     // API surface, out of scope
      walk(relPath, out);
    } else if (/\.(js|mjs|ts)$/.test(entry) && !entry.startsWith('_')) {
      out.push(relPath);
    }
  }
  return out;
}

const read = (rel) => {
  try { return readFileSync(join(PROJECT_ROOT, rel), 'utf8'); }
  catch { return null; }
};

/** Strip comments so a docstring mentioning text/html or onRequestHead cannot lie. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ALL_ROUTES = walk('functions');
const CRAWLER_FETCHED = /text\/html|image\/(png|jpe?g|webp|gif|svg\+xml)/;
const HTML_ROUTES = ALL_ROUTES.filter((f) => {
  const src = read(f);
  return src && CRAWLER_FETCHED.test(strip(src));
});
const IN_SCOPE = HTML_ROUTES.filter((f) => !(f in EXCLUDED));

/** Which method exports a module declares. */
function exportsOf(rel) {
  const src = read(rel);
  if (src === null) return null;
  const s = strip(src);
  const found = new Set();
  // export function onRequestX / export const onRequestX / export { onRequestX }
  for (const m of s.matchAll(/\bonRequest(Get|Post|Put|Patch|Delete|Head|Options)?\b/g)) {
    found.add(`onRequest${m[1] || ''}`);
  }
  return found;
}
const answersHead = (ex) => ex && (ex.has('onRequest') || ex.has('onRequestHead'));

// ---------- HM0 -----------------------------------------------------------
function gateHM0() {
  const r = [];
  r.push(pass(`enumerated ${ALL_ROUTES.length} route modules under functions/ (excluding functions/api/ and _-prefixed)`));

  if (HTML_ROUTES.length < MIN_IN_SCOPE) {
    r.push(fail(`only ${HTML_ROUTES.length} HTML-serving routes found, floor is ${MIN_IN_SCOPE} — the scan has broken, not the repo shrunk`));
  } else {
    r.push(pass(`${HTML_ROUTES.length} crawler-fetched routes found: HTML pages + image endpoints (floor ${MIN_IN_SCOPE})`));
  }

  for (const sentinel of COVERAGE_SENTINELS) {
    if (!HTML_ROUTES.includes(sentinel)) {
      r.push(fail(`coverage sentinel ${sentinel} dropped out of the enumeration — the scan narrowed silently`));
    } else {
      r.push(pass(`sentinel in coverage: ${sentinel}`));
    }
  }

  const exKeys = Object.keys(EXCLUDED);
  if (exKeys.length === 0) {
    r.push(pass('EXCLUDED is empty — every HTML page route is gated'));
  }
  for (const [k, why] of Object.entries(EXCLUDED)) {
    if (!existsSync(join(PROJECT_ROOT, k))) {
      r.push(fail(`EXCLUDED names ${k}, which no longer exists — stale exclusion, remove it`));
    } else if (!why || why.length < 40) {
      r.push(fail(`EXCLUDED[${k}] reason is ${why ? why.length : 0} chars, needs 40+ explaining why the route is not shareable`));
    } else {
      r.push(pass(`excluded with reason: ${k}`));
    }
  }
  return r;
}

// ---------- HM1 -----------------------------------------------------------
function gateHM1() {
  const r = [];
  for (const f of IN_SCOPE) {
    const ex = exportsOf(f);
    if (!ex) { r.push(fail(`${f} unreadable`)); continue; }
    if (answersHead(ex)) {
      const how = ex.has('onRequest') ? 'onRequest catch-all' : 'onRequestHead';
      r.push(pass(`${f} answers HEAD (${how})`));
    } else {
      const listed = [...ex].sort().join(', ') || 'none';
      r.push(fail(
        `${f} does not answer HEAD (exports: ${listed}). CF Pages will 404 HEAD on this route while GET returns 200, ` +
        `which silently breaks link previews. Export onRequestHead delegating to the GET handler when that handler is ` +
        `read-only, or convert to a catch-all onRequest.`));
    }
  }
  return r;
}

// ---------- HM2 -----------------------------------------------------------
function gateHM2() {
  const checked = IN_SCOPE.length;
  if (checked < MIN_IN_SCOPE) {
    return fail(`only ${checked} routes actually checked, floor ${MIN_IN_SCOPE} — a broken extractor must not report success by checking nothing`);
  }
  return pass(`${checked} routes checked, ${Object.keys(EXCLUDED).length} deliberately excluded`);
}

// ---------- Run -----------------------------------------------------------
runGate('HM0', 'Page-route enumeration integrity', gateHM0);
runGate('HM1', 'Every crawler-fetched route answers HEAD', gateHM1);
runGate('HM2', 'Coverage meta-assertion (anti-vacuity)', gateHM2);

if (JSON_MODE) {
  console.log(JSON.stringify({ pass: totalFailures === 0, failures: totalFailures, gates: gateResults }, null, 2));
} else {
  console.log('');
  console.log(totalFailures === 0
    ? `${GREEN}${BOLD}OK: all page-function method gates passed${RESET}`
    : `${RED}${BOLD}FAIL: ${totalFailures} gate(s) failed${RESET}`);
}
process.exit(totalFailures === 0 ? 0 : 1);
