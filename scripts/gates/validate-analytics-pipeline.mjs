#!/usr/bin/env node
/**
 * validate-analytics-pipeline.mjs — Deterministic proof-gate runner for the
 * client analytics pipeline (functions/api/track.js + _track-events.js +
 * _ga4-source.js + src/scripts/track*.ts).
 *
 * Built 2026-05-15 as part of the Zaraz → first-party analytics migration.
 * Each gate encodes a bug class the spec defends against; static checks only,
 * safe to run in pre-commit + CI.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html §16
 *
 * Usage:
 *   node scripts/gates/validate-analytics-pipeline.mjs            # all gates
 *   node scripts/gates/validate-analytics-pipeline.mjs --gate AG3 # one gate
 *   node scripts/gates/validate-analytics-pipeline.mjs --json     # machine-readable
 *   node scripts/gates/validate-analytics-pipeline.mjs --quick    # skip bundle-size gate (no build)
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------- ANSI ----------------------------------------------------------
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m', DIM = '\x1b[2m';

// ---------- Files under guard --------------------------------------------
const TRACK_ENDPOINT = 'functions/api/track.js';
const TRACK_EVENTS = 'functions/api/_track-events.js';
const GA4_SOURCE = 'functions/api/_ga4-source.js';
const GA4 = 'functions/api/_ga4.js';
const MIDDLEWARE = 'functions/_middleware.js';
const CLIENT_HELPER = 'src/scripts/track.ts';
const CLIENT_AUTO = 'src/scripts/track-auto.ts';

// Files we scan for static call sites
const SRC_SCAN_GLOBS = ['src/**/*.astro', 'src/**/*.ts', 'src/**/*.js'];
const FUNCTIONS_SCAN_GLOBS = ['functions/**/*.js'];

// Server-side conversion events: MUST NOT be in ALLOWED_CLIENT_EVENTS (AG3)
const SERVER_ONLY_EVENTS = [
  'page_view',
  'sign_up',
  'signup_from_ask',
  'generate_lead',
  'begin_checkout',
  'purchase',
];

// Required PII regex terms (AG5)
const PII_TERMS = ['email', 'user', 'name', 'password', 'token', 'cookie', 'address', 'phone', 'ssn'];

// Conversion list per spec §15.3 (AG10).
// Phase 1 conversions are already wired server-side; missing call site = FAIL.
// Phase 2 conversions are instrumented client-side as part of Phase 2; missing
// call site = WARN (expected during Phase 1 → 2 rollout). Move from PHASE_2
// to PHASE_1 as instrumentation lands.
const PHASE_1_CONVERSIONS = [
  'sign_up',
  'generate_lead',
  'begin_checkout',
  'purchase',
  'scroll_depth', // qualified at depth=100 in the dashboard
];
const PHASE_2_CONVERSIONS = [
  'pdf_download',
  'copy_citation',
  'video_complete',
];

// Third-party analytics origins that must NOT appear as script sources or fetch targets (AG7)
// Exception: _ga4.js may reference www.google-analytics.com (the MP endpoint we proxy through).
const FORBIDDEN_TP_ORIGINS = [
  'googletagmanager.com',
  'stats.g.doubleclick.net',
  'connect.facebook.net',
  'analytics.ahrefs.com', // ahrefs--bot-analytics Worker is server-side; should not appear in src
];
const GA_SERVER_ENDPOINT_HOST = 'www.google-analytics.com';
// Files allowed to reference the GA4 Measurement Protocol endpoint directly.
// Both are server-side relays (Workers/middleware), neither exposes browser →
// google-analytics.com traffic — keeping the rule first-party even when the
// MP endpoint is named.
const GA_SERVER_ENDPOINT_ALLOWED_FILES = [GA4, MIDDLEWARE];

// CSP must NOT contain these origins (AG8)
const FORBIDDEN_CSP_ORIGINS = [
  'googletagmanager.com',
  'analytics.google.com',
  'stats.g.doubleclick.net',
  'connect.facebook.net',
];

// Bundle size budgets (AG11), in bytes (minified+gzipped — Astro's hashed output)
const BUNDLE_BUDGET_TRACK = 2048;       // src/scripts/track.ts
const BUNDLE_BUDGET_TRACK_AUTO = 3584;  // src/scripts/track-auto.ts

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const QUICK_MODE = argv.includes('--quick');
const gateIdx = argv.indexOf('--gate');
const ONLY_GATE = gateIdx >= 0 ? argv[gateIdx + 1] : null;

// ---------- State ---------------------------------------------------------
const gateResults = [];
let totalFailures = 0;
let totalWarnings = 0;

const pass = (msg) => ({ ok: true, msg });
const fail = (msg) => ({ ok: false, msg });
const warn = (msg) => ({ ok: null, msg });

const read = (rel) => {
  const full = join(PROJECT_ROOT, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
};

const exists = (rel) => existsSync(join(PROJECT_ROOT, rel));

// Walk src/ and functions/ collecting all source files (no node_modules etc.)
function walkSource(rootRel, exts) {
  const root = join(PROJECT_ROOT, rootRel);
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = execSync(`ls -1 "${dir}"`, { encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (exts.some((e) => name.endsWith(e))) {
        out.push(full.slice(PROJECT_ROOT.length + 1));
      }
    }
  }
  return out;
}

function printLine(r) {
  if (JSON_MODE) return;
  const icon = r.ok === true ? `${GREEN}✓${RESET}` :
               r.ok === false ? `${RED}✗${RESET}` :
               `${YELLOW}~${RESET}`;
  console.log(`  ${icon} ${r.msg}`);
}

function runGate(id, name, fn) {
  if (ONLY_GATE && ONLY_GATE !== id) return;
  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);
  let results;
  try {
    results = fn();
  } catch (err) {
    const r = fail(`Gate runner error: ${err.message}`);
    if (!JSON_MODE) printLine(r);
    gateResults.push({ id, name, pass: false, items: [r] });
    totalFailures++;
    return;
  }
  if (!Array.isArray(results)) results = [results];
  const gateFails = results.filter((r) => r.ok === false).length;
  const gateWarns = results.filter((r) => r.ok === null).length;
  for (const r of results) printLine(r);
  gateResults.push({ id, name, pass: gateFails === 0, items: results });
  if (gateFails > 0) totalFailures++;
  totalWarnings += gateWarns;
}

// ============================================================
// Gate AG1: Endpoint contract
// ============================================================
function gateAG1() {
  const results = [];
  const src = read(TRACK_ENDPOINT);
  if (!src) return [fail(`${TRACK_ENDPOINT} not found — endpoint must exist`)];

  // a) imports
  const requiredImports = [
    { needle: /checkRateLimit/, label: 'checkRateLimit' },
    { needle: /sendGA4Event/, label: 'sendGA4Event' },
    { needle: /ALLOWED_CLIENT_EVENTS/, label: 'ALLOWED_CLIENT_EVENTS' },
    { needle: /REQUIRED_PARAMS/, label: 'REQUIRED_PARAMS' },
    { needle: /PII_REGEX/, label: 'PII_REGEX' },
  ];
  for (const { needle, label } of requiredImports) {
    if (needle.test(src)) results.push(pass(`imports/uses ${label}`));
    else results.push(fail(`${TRACK_ENDPOINT} must import/use ${label}`));
  }

  // b) handlers
  if (/export\s+(async\s+)?function\s+onRequestPost\b/.test(src)) {
    results.push(pass(`exports onRequestPost`));
  } else {
    results.push(fail(`${TRACK_ENDPOINT} must export onRequestPost`));
  }
  if (/export\s+(async\s+)?function\s+onRequestOptions\b|export\s+const\s+onRequestOptions/.test(src)) {
    results.push(pass(`exports onRequestOptions`));
  } else {
    results.push(fail(`${TRACK_ENDPOINT} must export onRequestOptions (CORS preflight)`));
  }

  // c) rate limit invocation
  if (/\bcheckRateLimit\s*\(/.test(src)) {
    results.push(pass(`invokes checkRateLimit() on POST`));
  } else {
    results.push(fail(`${TRACK_ENDPOINT} must invoke checkRateLimit() — endpoint is unauthenticated, must protect billed GA4 calls`));
  }

  // d) inline fetch to google-analytics.com is forbidden (use sendGA4Event)
  if (/fetch\s*\(\s*['"`].*google-analytics\.com/.test(src)) {
    results.push(fail(`${TRACK_ENDPOINT} contains an inline fetch to google-analytics.com — must use sendGA4Event() from _ga4.js instead`));
  } else {
    results.push(pass(`no inline GA4 endpoint fetch (delegates to sendGA4Event)`));
  }

  // e) 503 service_unavailable shape on missing env
  if (/'service_unavailable'/.test(src) || /"service_unavailable"/.test(src)) {
    results.push(pass(`returns 503 with service_unavailable code on missing env`));
  } else {
    results.push(fail(`${TRACK_ENDPOINT} should return { error: 'service_unavailable' } when GA4 env vars are missing (majority project pattern)`));
  }

  return results;
}

// ============================================================
// Gate AG2: Allowlist coverage (static literal track() calls)
// ============================================================
function gateAG2() {
  const results = [];
  const eventsSrc = read(TRACK_EVENTS);
  if (!eventsSrc) return [fail(`${TRACK_EVENTS} not found`)];

  // Extract ALLOWED_CLIENT_EVENTS literals
  const clientSetMatch = eventsSrc.match(/ALLOWED_CLIENT_EVENTS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!clientSetMatch) {
    return [fail(`${TRACK_EVENTS} must export ALLOWED_CLIENT_EVENTS = new Set([...])`)];
  }
  const allowedClient = new Set(
    [...clientSetMatch[1].matchAll(/['"]([a-z][a-z0-9_]{0,39})['"]/g)].map((m) => m[1]),
  );

  if (allowedClient.size === 0) {
    results.push(fail(`ALLOWED_CLIENT_EVENTS is empty — populate per spec §6.1`));
    return results;
  }
  results.push(pass(`ALLOWED_CLIENT_EVENTS contains ${allowedClient.size} events`));

  // Scan src/ for track('literal', …) call sites
  const files = walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']);
  const callPattern = /\btrack\s*\(\s*['"]([a-z][a-z0-9_]{0,39})['"]/g;
  let total = 0;
  let unknown = 0;
  for (const f of files) {
    // Skip the helper itself
    if (f === CLIENT_HELPER || f === CLIENT_AUTO) continue;
    const src = read(f);
    if (!src) continue;
    let m;
    while ((m = callPattern.exec(src)) !== null) {
      total++;
      const evt = m[1];
      if (!allowedClient.has(evt)) {
        unknown++;
        const lineNum = src.slice(0, m.index).split('\n').length;
        results.push(fail(`${f}:${lineNum} — track('${evt}', …) but '${evt}' is not in ALLOWED_CLIENT_EVENTS`));
      }
    }
  }
  if (total === 0) {
    results.push(warn(`no track() call sites found in src/ yet (Phase 2 instrumentation pending)`));
  } else if (unknown === 0) {
    results.push(pass(`all ${total} static track() call sites use allowlisted events`));
  }
  results.push(warn(`AG2 blind spot: dynamic event names from data-track-* attributes in track-auto.ts are not statically resolvable; runtime validation in /api/track catches those`));
  return results;
}

// ============================================================
// Gate AG3: Server/client event separation
// ============================================================
function gateAG3() {
  const results = [];
  const eventsSrc = read(TRACK_EVENTS);
  if (!eventsSrc) return [fail(`${TRACK_EVENTS} not found`)];

  const clientSetMatch = eventsSrc.match(/ALLOWED_CLIENT_EVENTS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!clientSetMatch) return [fail(`ALLOWED_CLIENT_EVENTS not defined`)];

  const allowedClient = new Set(
    [...clientSetMatch[1].matchAll(/['"]([a-z][a-z0-9_]{0,39})['"]/g)].map((m) => m[1]),
  );

  let leaks = 0;
  for (const evt of SERVER_ONLY_EVENTS) {
    if (allowedClient.has(evt)) {
      results.push(fail(`Server-only event '${evt}' must NOT appear in ALLOWED_CLIENT_EVENTS (prevents double-counting)`));
      leaks++;
    }
  }
  if (leaks === 0) {
    results.push(pass(`no server-only events in ALLOWED_CLIENT_EVENTS (${SERVER_ONLY_EVENTS.length} checked)`));
  }
  return results;
}

// ============================================================
// Gate AG4: Required params satisfied at static call sites
// ============================================================
function gateAG4() {
  const results = [];
  const eventsSrc = read(TRACK_EVENTS);
  if (!eventsSrc) return [fail(`${TRACK_EVENTS} not found`)];

  // Parse REQUIRED_PARAMS — accepts either object literal `{ event: [params] }`
  // OR Map literal `new Map([['event', ['params']], …])`. Both are valid; AG4
  // doesn't care about runtime shape as long as the event→params mapping is
  // statically readable from the source.
  let body;
  const objBlock = eventsSrc.match(/REQUIRED_PARAMS\s*=\s*\{([\s\S]*?)\n\}\s*;?/);
  const mapBlock = eventsSrc.match(/REQUIRED_PARAMS\s*=\s*new\s+Map\s*\(\s*\[([\s\S]*?)\]\s*\)\s*;?/);
  if (objBlock) {
    body = objBlock[1];
  } else if (mapBlock) {
    body = mapBlock[1];
  } else {
    return [fail(`${TRACK_EVENTS} must export REQUIRED_PARAMS as either an object literal { event: [params] } or new Map([[event, [params]], …])`)];
  }
  const required = {};
  // Object-literal entries:   'event_name': ['p1', 'p2']
  // Map-tuple entries:        ['event_name', ['p1', 'p2']]
  // Both reduce to: name string immediately followed by an array literal.
  const entryRe = /['"]([a-z][a-z0-9_]{0,39})['"]\s*(?::|,)\s*\[([^\]]*)\]/g;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    required[m[1]] = [...m[2].matchAll(/['"]([a-z][a-z0-9_]{0,39})['"]/g)].map((k) => k[1]);
  }

  const files = walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']);
  let total = 0;
  let bad = 0;
  // Match track('event', { key: value, ... })
  const callRe = /\btrack\s*\(\s*['"]([a-z][a-z0-9_]{0,39})['"]\s*,\s*\{([^}]{0,500})\}/g;
  for (const f of files) {
    if (f === CLIENT_HELPER || f === CLIENT_AUTO) continue;
    const src = read(f);
    if (!src) continue;
    let cm;
    while ((cm = callRe.exec(src)) !== null) {
      const evt = cm[1];
      const params = cm[2];
      const need = required[evt];
      if (!need || need.length === 0) continue;
      total++;
      const presentKeys = [...params.matchAll(/(?:^|[\s,{])([a-z][a-z0-9_]{0,39})\s*:/g)].map((x) => x[1]);
      const missing = need.filter((k) => !presentKeys.includes(k) && !params.includes(`...${k}`));
      if (missing.length > 0) {
        const lineNum = src.slice(0, cm.index).split('\n').length;
        results.push(fail(`${f}:${lineNum} — track('${evt}', …) missing required params: ${missing.join(', ')}`));
        bad++;
      }
    }
  }
  if (total === 0) {
    results.push(warn(`no track(literal, {literal-object}) call sites with required-params to check yet`));
  } else if (bad === 0) {
    results.push(pass(`all ${total} static call sites with required params satisfy them`));
  }
  return results;
}

// ============================================================
// Gate AG5: PII regex intact
// ============================================================
function gateAG5() {
  const results = [];
  const src = read(TRACK_EVENTS);
  if (!src) return [fail(`${TRACK_EVENTS} not found`)];

  const re = src.match(/PII_REGEX\s*=\s*\/([^\/]+)\/(\w*)/);
  if (!re) {
    return [fail(`${TRACK_EVENTS} must export PII_REGEX = /…/i`)];
  }
  const body = re[1];
  const flags = re[2] || '';
  if (!flags.includes('i')) {
    results.push(fail(`PII_REGEX must use case-insensitive flag /…/i`));
  } else {
    results.push(pass(`PII_REGEX uses case-insensitive flag`));
  }

  let missing = 0;
  for (const term of PII_TERMS) {
    if (!body.includes(term)) {
      results.push(fail(`PII_REGEX missing term: ${term}`));
      missing++;
    }
  }
  if (missing === 0) {
    results.push(pass(`PII_REGEX contains all required terms (${PII_TERMS.join(', ')})`));
  }
  return results;
}

// ============================================================
// Gate AG6: UTM convention (lowercase, underscores, ASCII)
// ============================================================
function gateAG6() {
  const results = [];
  const files = [
    ...walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']),
    ...walkSource('functions', ['.js']),
  ];
  // Match utm_*= up to next & or " or end. Capture key + value.
  // Look at value: must be lowercase letters, digits, underscore, dot, dash, hash, colon.
  const utmRe = /[?&]utm_[a-z_]+=([^"&\s)]{1,120})/g;
  let bad = 0;
  let total = 0;
  for (const f of files) {
    // Skip the spec doc itself and validator scripts (they reference UTMs in prose/regex)
    if (f.includes('analytics-pipeline') || f.includes('client-analytics-spec') ||
        f.endsWith('/track.ts') || f.endsWith('/track-auto.ts')) continue;
    const src = read(f);
    if (!src) continue;
    let m;
    while ((m = utmRe.exec(src)) !== null) {
      total++;
      const value = m[1];
      // Allow template-literal interpolations (${...}) — those resolve at runtime
      if (value.includes('${')) continue;
      // Reject uppercase, spaces, non-ASCII
      if (/[A-Z]/.test(value) || /\s/.test(value) || /[^\x00-\x7F]/.test(value)) {
        const lineNum = src.slice(0, m.index).split('\n').length;
        results.push(fail(`${f}:${lineNum} — UTM value '${value}' violates convention (lowercase + underscore + ASCII required per spec §15.7)`));
        bad++;
      }
    }
  }
  if (total === 0) {
    results.push(pass(`no UTM literals to validate (or none yet)`));
  } else if (bad === 0) {
    results.push(pass(`all ${total} UTM literals match the convention`));
  }
  return results;
}

// ============================================================
// Gate AG7: No third-party analytics scripts in src/ or functions/
// ============================================================
function gateAG7() {
  const results = [];
  const files = [
    ...walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']),
    ...walkSource('functions', ['.js']),
  ];

  let found = 0;
  for (const f of files) {
    // Skip the spec, the gate validator itself, and CSP-list documentation files
    if (f.includes('analytics-pipeline') || f.includes('client-analytics-spec')) continue;
    const src = read(f);
    if (!src) continue;
    for (const origin of FORBIDDEN_TP_ORIGINS) {
      const idx = src.indexOf(origin);
      if (idx !== -1) {
        // Allow within line comments documenting that the origin is forbidden
        const lineStart = src.lastIndexOf('\n', idx) + 1;
        const line = src.slice(lineStart, src.indexOf('\n', idx));
        if (/^\s*(\/\/|\*|#)/.test(line)) continue;
        // Allow in CSP value as "forbidden" documentation, but that should appear in middleware only and AG8 checks it.
        const lineNum = src.slice(0, idx).split('\n').length;
        results.push(fail(`${f}:${lineNum} — references forbidden third-party origin '${origin}'`));
        found++;
      }
    }
    // GA server endpoint: only _ga4.js + _middleware.js may reference it
    if (!GA_SERVER_ENDPOINT_ALLOWED_FILES.includes(f) && src.includes(GA_SERVER_ENDPOINT_HOST)) {
      const idx = src.indexOf(GA_SERVER_ENDPOINT_HOST);
      const lineStart = src.lastIndexOf('\n', idx) + 1;
      const line = src.slice(lineStart, src.indexOf('\n', idx));
      if (!/^\s*(\/\/|\*|#)/.test(line)) {
        const lineNum = src.slice(0, idx).split('\n').length;
        results.push(fail(`${f}:${lineNum} — references ${GA_SERVER_ENDPOINT_HOST} outside of allowed files (${GA_SERVER_ENDPOINT_ALLOWED_FILES.join(', ')}) — centralize via sendGA4Event`));
        found++;
      }
    }
  }
  if (found === 0) {
    results.push(pass(`no third-party analytics origins referenced in src/ or functions/`));
  }
  return results;
}

// ============================================================
// Gate AG8: CSP lockdown
// ============================================================
function gateAG8() {
  const results = [];
  const src = read(MIDDLEWARE);
  if (!src) return [fail(`${MIDDLEWARE} not found`)];
  // Locate CSP_VALUE constant body
  const cspMatch = src.match(/CSP_VALUE\s*=\s*['"`]([^'"`]+)['"`]/);
  if (!cspMatch) {
    return [warn(`${MIDDLEWARE} does not define CSP_VALUE as a string literal; skipping CSP origin check`)];
  }
  const csp = cspMatch[1];
  let bad = 0;
  for (const origin of FORBIDDEN_CSP_ORIGINS) {
    if (csp.includes(origin)) {
      results.push(fail(`CSP_VALUE in ${MIDDLEWARE} contains forbidden origin '${origin}'`));
      bad++;
    }
  }
  if (bad === 0) {
    results.push(pass(`CSP_VALUE excludes all ${FORBIDDEN_CSP_ORIGINS.length} forbidden origins`));
  }
  return results;
}

// ============================================================
// Gate AG9: Track helper exclusivity (no raw /api/track fetch/sendBeacon)
// ============================================================
function gateAG9() {
  const results = [];
  const files = walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']);
  let bad = 0;
  for (const f of files) {
    if (f === CLIENT_HELPER) continue; // the helper itself is the only allowed source
    const src = read(f);
    if (!src) continue;
    const rawFetch = /fetch\s*\(\s*['"`]\/api\/track\b/.test(src);
    const rawBeacon = /sendBeacon\s*\(\s*['"`]\/api\/track\b/.test(src);
    if (rawFetch) {
      results.push(fail(`${f} — raw fetch('/api/track') outside the helper; import { track } from '@scripts/track' instead`));
      bad++;
    }
    if (rawBeacon) {
      results.push(fail(`${f} — raw sendBeacon('/api/track') outside the helper; import { track } from '@scripts/track' instead`));
      bad++;
    }
  }
  if (bad === 0) {
    results.push(pass(`no raw /api/track emissions outside ${CLIENT_HELPER}`));
  }
  return results;
}

// ============================================================
// Gate AG10: Conversion completeness
// ============================================================
function gateAG10() {
  const results = [];
  const files = [
    ...walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']),
    ...walkSource('functions', ['.js']),
  ];
  const hasCallSite = (evt) => {
    const re = new RegExp(`(?:sendGA4Event\\s*\\([^,]+,[^,]+,\\s*['"]${evt}['"]|track\\s*\\(\\s*['"]${evt}['"])`);
    return files.some((f) => {
      const src = read(f);
      return src ? re.test(src) : false;
    });
  };
  // Phase 1 conversions MUST have a call site.
  for (const evt of PHASE_1_CONVERSIONS) {
    if (hasCallSite(evt)) {
      results.push(pass(`Phase 1 conversion '${evt}' has at least one call site`));
    } else {
      results.push(fail(`Phase 1 conversion '${evt}' has no call site (spec §15.3 marks it as a Key Event; either remove from spec or wire it up)`));
    }
  }
  // Phase 2 conversions get WARN during Phase 1 → 2 rollout.
  for (const evt of PHASE_2_CONVERSIONS) {
    if (hasCallSite(evt)) {
      results.push(pass(`Phase 2 conversion '${evt}' has at least one call site`));
    } else {
      results.push(warn(`Phase 2 conversion '${evt}' not yet instrumented — promote from PHASE_2_CONVERSIONS to PHASE_1_CONVERSIONS in the gate when wired`));
    }
  }
  return results;
}

// ============================================================
// Gate AG11: Bundle size
// ============================================================
function gateAG11() {
  if (QUICK_MODE) {
    return [warn(`bundle-size check skipped (--quick mode; run full gates in CI)`)];
  }
  const results = [];
  // Check the built bundles exist in dist/_astro/
  const distDir = join(PROJECT_ROOT, 'dist', '_astro');
  if (!existsSync(distDir)) {
    return [warn(`dist/_astro/ not found; run \`npm run build\` first to populate bundle artifacts`)];
  }
  // Find track.* and track-auto.* hashed bundles
  let entries;
  try {
    entries = execSync(`ls -1 "${distDir}"`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch (e) {
    return [warn(`could not list ${distDir}: ${e.message}`)];
  }
  const trackBundle = entries.find((n) => /^track\.[A-Za-z0-9_-]+\.js$/.test(n));
  const trackAutoBundle = entries.find((n) => /^track-auto\.[A-Za-z0-9_-]+\.js$/.test(n));

  const checkSize = (name, bundleName, budget) => {
    if (!bundleName) {
      results.push(warn(`${name} bundle not found in dist/_astro/ (not yet imported by any page?)`));
      return;
    }
    const full = join(distDir, bundleName);
    const sz = statSync(full).size;
    if (sz <= budget) {
      results.push(pass(`${name} bundle ${bundleName}: ${sz} bytes (budget ${budget})`));
    } else {
      results.push(fail(`${name} bundle ${bundleName}: ${sz} bytes EXCEEDS budget ${budget}`));
    }
  };
  checkSize('track.ts', trackBundle, BUNDLE_BUDGET_TRACK);
  checkSize('track-auto.ts', trackAutoBundle, BUNDLE_BUDGET_TRACK_AUTO);
  return results;
}

// ============================================================
// Gate AG12: Custom dimension parity (WARN-ONLY)
// ============================================================
function gateAG12() {
  const results = [];
  // Spec §15.2 custom dimensions — must appear as param NAMES somewhere
  const SPEC_DIMS = [
    'user_role',
    'entry_category',
    'entry_platform',
    'content_pillar',
    'device_type',
    'lead_source',
    'article_type',
    'email_type',
    'list_source',
    'engagement_tier',
    'cohort_date',
    'audience_type',
  ];
  const files = [
    ...walkSource('src', ['.astro', '.ts', '.tsx', '.js', '.mjs']),
    ...walkSource('functions', ['.js']),
  ];
  let absent = 0;
  for (const dim of SPEC_DIMS) {
    // Look for "dim_name:" or "dim_name =" or "'dim_name'" in source
    const re = new RegExp(`(?:['"\\\`]${dim}['"\\\`]|\\b${dim}\\s*[:=])`);
    const hit = files.some((f) => {
      const src = read(f);
      return src ? re.test(src) : false;
    });
    if (hit) {
      results.push(pass(`dimension '${dim}' appears in source`));
    } else {
      results.push(warn(`dimension '${dim}' not yet referenced — register in GA4 but no code emits it (Phase 2 may add)`));
      absent++;
    }
  }
  // AG12 is WARN-ONLY; do not fail. Surfaces drift, doesn't block deploy.
  return results;
}

// ============================================================
// Run all gates
// ============================================================
runGate('AG1', 'Endpoint contract', gateAG1);
runGate('AG2', 'Allowlist coverage', gateAG2);
runGate('AG3', 'Server/client event separation', gateAG3);
runGate('AG4', 'Required params satisfied', gateAG4);
runGate('AG5', 'PII regex intact', gateAG5);
runGate('AG6', 'UTM convention', gateAG6);
runGate('AG7', 'No third-party analytics scripts', gateAG7);
runGate('AG8', 'CSP lockdown', gateAG8);
runGate('AG9', 'Track helper exclusivity', gateAG9);
runGate('AG10', 'Conversion completeness', gateAG10);
runGate('AG11', 'Bundle size', gateAG11);
runGate('AG12', 'Custom dimension parity (warn-only)', gateAG12);

// ---------- Output --------------------------------------------------------
if (JSON_MODE) {
  console.log(JSON.stringify({
    pass: totalFailures === 0,
    failures: totalFailures,
    warnings: totalWarnings,
    gates: gateResults,
  }, null, 2));
} else {
  console.log('');
  if (totalFailures === 0) {
    console.log(`${GREEN}${BOLD}✓ All analytics-pipeline gates passed${RESET}${totalWarnings ? `  ${YELLOW}(${totalWarnings} warning${totalWarnings === 1 ? '' : 's'})${RESET}` : ''}`);
  } else {
    console.log(`${RED}${BOLD}✗ ${totalFailures} gate(s) failed${RESET}${totalWarnings ? `, ${YELLOW}${totalWarnings} warning${totalWarnings === 1 ? '' : 's'}${RESET}` : ''}`);
  }
}

process.exit(totalFailures === 0 ? 0 : 1);
