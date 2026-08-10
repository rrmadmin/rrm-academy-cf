#!/usr/bin/env node
/**
 * validate-payment-pipeline.mjs — Deterministic proof-gate runner for the
 * payment-handling surface (Stripe webhooks + checkout + billing endpoints).
 *
 * Built 2026-05-07 in response to /arise-intel finding: payment surface
 * (stripe-webhook.js + create-checkout.js + billing/*) accumulated 41 findings
 * across 13 distinct /arise runs. Code is currently clean -- gates encode
 * the bug classes that have repeatedly surfaced so future regressions trip
 * deterministically instead of waiting for the next /arise pass.
 *
 * Gates run as static analysis (regex + AST-light heuristics). No live D1
 * or Stripe calls; safe to run in pre-commit + CI.
 *
 * Usage:
 *   node scripts/gates/validate-payment-pipeline.mjs            # all 5 gates
 *   node scripts/gates/validate-payment-pipeline.mjs --gate PG1 # specific gate
 *   node scripts/gates/validate-payment-pipeline.mjs --json     # machine-readable
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored (file missing, etc.)
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------- ANSI ----------------------------------------------------------
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m', DIM = '\x1b[2m';

// ---------- Files under guard --------------------------------------------
// The payment surface is ENUMERATED FROM DISK, never hand-listed. Until
// 2026-08-10 this was a literal 15-entry array introduced by "Adding a new
// payment endpoint? Add it here." -- four files already sitting in
// functions/api/billing/ had never been added, including _donor-gift.js, which
// computes and INSERTs amount_cents, and supporter-badge.js, a public endpoint.
// Every one of them was invisible to PG2 and PG3 while the runner reported "all
// payment-pipeline gates passed". An allowlist is a hole in the shape of
// whatever nobody thought of; the drift check is the gate.
//
// Coverage = every module under functions/api/billing/ + the named money-path
// files that live outside it, minus EXCLUDED. PG0 enforces the accounting.

const BILLING_DIR = 'functions/api/billing';

// Money-path files outside the billing directory. Named because no directory at
// the functions/api root means "payment"; PG0 fails if one stops existing.
const TOP_LEVEL_PAYMENT_FILES = [
  'functions/api/stripe-webhook.js',
  'functions/api/create-checkout.js',
  'functions/api/fund-progress.js',
  'functions/api/fund-supporters.js',
];

// Extensions whose contents the PG2/PG3 source checks understand. A billing
// module written in anything else is NOT silently dropped -- PG0 fails on it.
const SCANNED_EXT = ['.js', '.mjs', '.ts'];

// Non-module files allowed to sit in the billing directory unscanned.
const UNSCANNABLE_EXT = ['.md', '.sql', '.json', '.txt'];

// Files inside the payment surface deliberately NOT gated. Key = repo-relative
// path, value = why, in >= EXCLUDED_MIN_REASON characters.
//
// EXCLUDED IS EMPTY, and PG0 says so out loud: every module in the billing
// directory is gated today, including the four the old array had missed. PG0
// fails on any key that no longer exists on disk, so this cannot rot into
// permanent cover for a real gap.
const EXCLUDED = {};
const EXCLUDED_MIN_REASON = 40;

// Coverage must always contain these. This is what keeps EXCLUDED a documented
// exception rather than an escape hatch: excluding a core money file fails PG0
// instead of quietly shrinking the surface every other gate scans.
const COVERAGE_SENTINELS = [
  'functions/api/stripe-webhook.js',
  'functions/api/create-checkout.js',
  'functions/api/billing/_webhook-checkout.js',
  'functions/api/billing/_webhook-subscription.js',
  'functions/api/billing/_webhook-refund.js',
  'functions/api/billing/_shared.js',
  'functions/api/billing/_donor-gift.js',
  'functions/api/billing/_supporter-gift.js',
];

// Anti-vacuity floor: a broken walk (directory renamed, permissions, a bad
// filter) must fail rather than report success over an empty surface.
// 15 billing modules on disk 2026-08-10.
const MIN_BILLING_MODULES = 14;

const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]s$/;

/**
 * Walk BILLING_DIR recursively. Returns repo-relative paths split into
 * modules (scannable), unscannable (known non-module extensions), and
 * unclassified (everything else -- a PG0 failure, because a .cjs/.jsx/.mts
 * billing module dropped by the extension filter is exactly the silent hole
 * the hand-maintained array already produced once).
 */
function enumerateBillingSurface() {
  const out = { modules: [], unscannable: [], unclassified: [], error: null };
  const abs = join(PROJECT_ROOT, BILLING_DIR);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = relative(PROJECT_ROOT, p);
      if (TEST_FILE_RE.test(e.name)) continue;
      const ext = extname(e.name);
      if (SCANNED_EXT.includes(ext)) out.modules.push(rel);
      else if (UNSCANNABLE_EXT.includes(ext)) out.unscannable.push(rel);
      else out.unclassified.push(rel);
    }
  };
  try { walk(abs); } catch (err) { out.error = err.message; }
  out.modules.sort(); out.unscannable.sort(); out.unclassified.sort();
  return out;
}

const BILLING_SCAN = enumerateBillingSurface();

// All files that handle money, subscription state, or payment auth.
const PAYMENT_FILES = [...TOP_LEVEL_PAYMENT_FILES, ...BILLING_SCAN.modules]
  .filter((f) => !(f in EXCLUDED));

// Webhook entrypoint (must implement signature verify + dedup envelope)
const WEBHOOK_ENTRY = 'functions/api/stripe-webhook.js';

// Sub-handler modules dispatched by the entrypoint. Derived from the same scan
// so a new _webhook-*.js is dedup-purity and atomicity checked the day it lands.
const NOT_A_WEBHOOK_HANDLER = {
  'functions/api/billing/_webhook-shared.js':
    'Shared helper imported BY the handlers (sendEmailSafe et al), not a Stripe event handler the entrypoint dispatches to.',
};

// Sub-handler files (must NOT re-implement dedup; parent handles it)
const WEBHOOK_HANDLERS = BILLING_SCAN.modules.filter((f) =>
  /\/_webhook-[^/]+$/.test(f) && !(f in NOT_A_WEBHOOK_HANDLER) && !(f in EXCLUDED));

// ---------- CLI -----------------------------------------------------------
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const gateIdx = argv.indexOf('--gate');
const ONLY_GATE = gateIdx >= 0 ? argv[gateIdx + 1] : null;

// ---------- State ---------------------------------------------------------
const gateResults = [];
let totalFailures = 0;

function pass(msg) { return { ok: true, msg }; }
function fail(msg) { return { ok: false, msg }; }
function warn(msg) { return { ok: null, msg }; }

function printLine(r) {
  if (JSON_MODE) return;
  const icon = r.ok === true ? `${GREEN}✓${RESET}` :
               r.ok === false ? `${RED}✗${RESET}` :
               `${YELLOW}~${RESET}`;
  console.log(`  ${icon} ${r.msg}`);
}

function printGateHeader(id, name) {
  if (!JSON_MODE) console.log(`\n${BOLD}Gate ${id}: ${name}${RESET}`);
}

function runGate(id, name, fn) {
  if (ONLY_GATE && ONLY_GATE !== id) return;
  printGateHeader(id, name);
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
  const gatePassed = results.every((r) => r.ok !== false);
  for (const r of results) printLine(r);
  gateResults.push({ id, name, pass: gatePassed, items: results });
  if (!gatePassed) totalFailures++;
}

function read(rel) {
  const full = join(PROJECT_ROOT, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

// ---------- Gate PG0: Payment surface enumeration ---------------------------
// Class of bugs prevented: a money-path file that no gate ever reads. Every
// other gate in this runner is only as good as the file list it walks, so the
// list itself needs a gate. A file under functions/api/billing must end up
// either COVERED or EXCLUDED-with-a-reason; there is no third bucket, and the
// enumeration cannot silently collapse to nothing.
function gatePG0() {
  const results = [];

  // a) The walk itself must have worked, and must find a plausible surface.
  if (BILLING_SCAN.error) {
    return [fail(`could not enumerate ${BILLING_DIR}: ${BILLING_SCAN.error}`)];
  }
  if (BILLING_SCAN.modules.length < MIN_BILLING_MODULES) {
    results.push(fail(
      `${BILLING_DIR} enumerated only ${BILLING_SCAN.modules.length} modules, below floor ${MIN_BILLING_MODULES}: ` +
      `the walk or the extension filter is broken; a gate runner must not report success over an empty surface`));
  } else {
    results.push(pass(
      `enumerated ${BILLING_SCAN.modules.length} modules from ${BILLING_DIR} (floor ${MIN_BILLING_MODULES}), ` +
      `${PAYMENT_FILES.length} payment files under guard`));
  }

  // b) No file in the billing directory may fall outside both buckets.
  for (const f of BILLING_SCAN.unclassified) {
    results.push(fail(
      `${f}: in ${BILLING_DIR} but neither scannable (${SCANNED_EXT.join(', ')}) nor a known non-module ` +
      `(${UNSCANNABLE_EXT.join(', ')}); add its extension to SCANNED_EXT so the gates read it, or to UNSCANNABLE_EXT`));
  }
  if (BILLING_SCAN.unclassified.length === 0) {
    results.push(pass(`every file in ${BILLING_DIR} is classified (no unreadable module types)`));
  }

  // c) Named money-path files outside the billing directory must still exist.
  let missingNamed = 0;
  for (const f of TOP_LEVEL_PAYMENT_FILES) {
    if (!existsSync(join(PROJECT_ROOT, f))) {
      results.push(fail(`${f} listed in TOP_LEVEL_PAYMENT_FILES but not on disk (moved or renamed; update the list)`));
      missingNamed++;
    }
  }
  if (missingNamed === 0) {
    results.push(pass(`all ${TOP_LEVEL_PAYMENT_FILES.length} named top-level payment files present`));
  }

  // d) EXCLUDED hygiene: no rot, and every opt-out carries a real reason.
  const excludedKeys = Object.keys(EXCLUDED);
  let excludedProblems = 0;
  for (const [f, reason] of Object.entries(EXCLUDED)) {
    if (!existsSync(join(PROJECT_ROOT, f))) {
      results.push(fail(`EXCLUDED['${f}'] does not exist on disk: stale exclusion, delete the entry`));
      excludedProblems++;
    }
    if (typeof reason !== 'string' || reason.trim().length < EXCLUDED_MIN_REASON) {
      results.push(fail(
        `EXCLUDED['${f}'] needs a written reason of at least ${EXCLUDED_MIN_REASON} characters ` +
        `explaining why this money-path file needs no gating`));
      excludedProblems++;
    }
  }
  if (excludedProblems === 0) {
    results.push(pass(excludedKeys.length === 0
      ? `EXCLUDED is empty: every module in ${BILLING_DIR} is gated`
      : `${excludedKeys.length} EXCLUDED entr${excludedKeys.length === 1 ? 'y' : 'ies'}, each present on disk with a written reason`));
  }

  // e) Same rot check for the webhook-handler carve-out.
  let carveProblems = 0;
  for (const [f, reason] of Object.entries(NOT_A_WEBHOOK_HANDLER)) {
    if (!existsSync(join(PROJECT_ROOT, f))) {
      results.push(fail(`NOT_A_WEBHOOK_HANDLER['${f}'] does not exist on disk: stale carve-out, delete the entry`));
      carveProblems++;
    }
    if (typeof reason !== 'string' || reason.trim().length < EXCLUDED_MIN_REASON) {
      results.push(fail(`NOT_A_WEBHOOK_HANDLER['${f}'] needs a written reason of at least ${EXCLUDED_MIN_REASON} characters`));
      carveProblems++;
    }
  }
  if (carveProblems === 0) {
    results.push(pass(`${WEBHOOK_HANDLERS.length} webhook sub-handlers derived from the scan (carve-outs verified)`));
  }

  // f) Sentinels: excluding a core money file fails here rather than silently
  //    shrinking the surface PG2/PG3 walk.
  const covered = new Set(PAYMENT_FILES);
  let missingSentinels = 0;
  for (const f of COVERAGE_SENTINELS) {
    if (!covered.has(f)) {
      results.push(fail(
        `${f} is a payment-surface sentinel but is not covered: it was excluded, renamed, or the enumeration missed it. ` +
        `Coverage must never drop this file.`));
      missingSentinels++;
    }
  }
  if (missingSentinels === 0) {
    results.push(pass(`all ${COVERAGE_SENTINELS.length} coverage sentinels present in the guarded set`));
  }

  return results;
}

// ---------- Gate PG1: Stripe webhook signature + dedup discipline ----------
// Class of bugs prevented:
//   - missing or wrong signature verify (constructEvent vs constructEventAsync)
//   - missing event dedup (Stripe retries replay event.id; double-processing
//     causes duplicate enrollments / welcome emails / contact rows)
//   - dedup row not rolled back on 5xx (subsequent retry skipped as duplicate
//     even though prior attempt failed)
// Billing cluster shared helper -- dedup SQL may live here after 2026-05-15 decomposition
const WEBHOOK_SHARED = 'functions/api/billing/_shared.js';

function gatePG1() {
  const results = [];
  const src = read(WEBHOOK_ENTRY);
  if (!src) return [fail(`${WEBHOOK_ENTRY} not found`)];

  // For dedup SQL checks (c + d): also scan billing/_shared.js since the
  // 2026-05-15 decomposition extracted INSERT OR IGNORE / DELETE FROM webhook_event
  // into dedupWebhookEvent() + rollbackWebhookDedup() helpers there.
  const sharedSrc = read(WEBHOOK_SHARED) || '';
  const dedupSurface = src + sharedSrc;

  // a) stripe-signature header read
  if (/request\.headers\.get\(\s*['"]stripe-signature['"]\s*\)/.test(src)) {
    results.push(pass(`reads stripe-signature header`));
  } else {
    results.push(fail(`${WEBHOOK_ENTRY} must read 'stripe-signature' header from request`));
  }

  // b) constructEventAsync (NOT constructEvent — sync version uses Node crypto, breaks on Workers)
  if (/stripe\.webhooks\.constructEventAsync\(/.test(src)) {
    results.push(pass(`uses constructEventAsync (Workers-compatible)`));
  } else {
    results.push(fail(`${WEBHOOK_ENTRY} must use stripe.webhooks.constructEventAsync (NOT constructEvent — sync version breaks on CF Workers)`));
  }
  if (/stripe\.webhooks\.constructEvent\b(?!Async)/.test(src)) {
    results.push(fail(`${WEBHOOK_ENTRY} contains stripe.webhooks.constructEvent (sync) — replace with constructEventAsync`));
  }

  // c) INSERT OR IGNORE INTO webhook_event before dispatch (may live in billing/_shared.js)
  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+webhook_event/i.test(dedupSurface)) {
    results.push(pass(`uses INSERT OR IGNORE INTO webhook_event for dedup`));
  } else {
    results.push(fail(`${WEBHOOK_ENTRY} must INSERT OR IGNORE INTO webhook_event before dispatching to handler (Stripe retries replay event.id)`));
  }

  // d) DELETE FROM webhook_event on 5xx (rollback so retry can re-process) (may live in billing/_shared.js)
  if (/DELETE\s+FROM\s+webhook_event/i.test(dedupSurface)) {
    results.push(pass(`rolls back webhook_event on 5xx (allows Stripe retry to re-process)`));
  } else {
    results.push(fail(`${WEBHOOK_ENTRY} must DELETE FROM webhook_event when sub-handler returns 5xx, otherwise transient failures become permanent`));
  }

  // e) Sub-handlers MUST NOT re-implement dedup (parent owns it; double-dedup
  //    creates a deadlock where parent inserts, child also inserts and skips,
  //    breaking idempotent retry logic).
  for (const handler of WEBHOOK_HANDLERS) {
    const hsrc = read(handler);
    if (!hsrc) {
      results.push(warn(`${handler} not found (skipping dedup-purity check)`));
      continue;
    }
    if (/INSERT\s+OR\s+IGNORE\s+INTO\s+webhook_event/i.test(hsrc)) {
      results.push(fail(`${handler} re-implements webhook_event dedup — only ${WEBHOOK_ENTRY} should own this. Move to parent.`));
    }
  }
  if (results.filter(r => r.msg.includes('re-implements webhook_event dedup')).length === 0) {
    results.push(pass(`no sub-handler re-implements webhook_event dedup`));
  }

  return results;
}

// ---------- Gate PG2: No err.message leak in client-bound responses --------
// Class prevented: internal stack traces / DB error details leaked to attackers.
// err.message inside log(...) is OK (server-side). Inside JSON.stringify({...})
// is NOT.
//
// Detection: find each JSON.stringify( open paren in the source, walk the
// character stream from that position tracking paren depth, capture the span
// up to the matching close. Check that span for err.message / error.message.
// Cap span length at 2KB to avoid runaway matches on malformed source.
function gatePG2() {
  const results = [];
  let foundLeaks = 0;
  const MARKER = 'JSON.stringify(';
  const MAX_SPAN = 2048;
  const LEAK_RE = /\b(err|error)\.message\b/;

  for (const f of PAYMENT_FILES) {
    const src = read(f);
    if (!src) continue;

    let pos = 0;
    while ((pos = src.indexOf(MARKER, pos)) !== -1) {
      const argStart = pos + MARKER.length;
      let depth = 1;  // we just consumed the opening paren of JSON.stringify(
      let end = argStart;
      const limit = Math.min(argStart + MAX_SPAN, src.length);
      for (; end < limit && depth > 0; end++) {
        const ch = src[end];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      const span = src.slice(argStart, end);
      if (LEAK_RE.test(span)) {
        // Compute line number of pos
        const lineNum = src.slice(0, pos).split('\n').length;
        results.push(fail(`${f}:${lineNum} — err.message inside JSON.stringify(...) (leaks internal error to client)`));
        foundLeaks++;
      }
      pos = end;  // continue past this stringify
    }
  }

  if (foundLeaks === 0) {
    results.push(pass(`no err.message leaked inside JSON.stringify across ${PAYMENT_FILES.length} payment files`));
  }
  return results;
}

// ---------- Gate PG3: Enrollment revocation discipline ---------------------
// Class prevented: refund-handling that DELETEs enrollment (loses audit trail)
// or query that reads enrollment without filtering revoked_at IS NULL (grants
// access to revoked students).
function gatePG3() {
  const results = [];
  const PAYMENT_FILE_PATHS = PAYMENT_FILES;

  // a) DELETE FROM enrollment must NEVER appear in payment files
  let foundDeletes = 0;
  for (const f of PAYMENT_FILE_PATHS) {
    const src = read(f);
    if (!src) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (/DELETE\s+FROM\s+enrollment\b/i.test(line) && !/^\s*\/\//.test(line) && !/^\s*\*/.test(line)) {
        results.push(fail(`${f}:${i+1} — DELETE FROM enrollment forbidden (use UPDATE SET revoked_at instead)`));
        foundDeletes++;
      }
    });
  }
  if (foundDeletes === 0) {
    results.push(pass(`no DELETE FROM enrollment in payment files`));
  }

  // b) Every SELECT/UPDATE-where on enrollment must include revoked_at IS NULL
  //    (or be the UPDATE that sets revoked_at itself)
  let missingFilters = 0;
  for (const f of PAYMENT_FILE_PATHS) {
    const src = read(f);
    if (!src) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // skip line-comments
      if (/^\s*(\/\/|\*)/.test(line)) return;
      // FROM enrollment (SELECT context)
      if (/\bFROM\s+enrollment\b/i.test(line)) {
        // check this line + next 6 lines for revoked_at IS NULL
        const window = lines.slice(i, Math.min(i + 6, lines.length)).join('\n');
        // Allow it if the window also contains UPDATE enrollment SET revoked_at (the revocation write itself)
        if (!/revoked_at\s+IS\s+NULL/i.test(window) &&
            !/UPDATE\s+enrollment\s+SET\s+revoked_at/i.test(window)) {
          results.push(fail(`${f}:${i+1} — FROM enrollment without revoked_at IS NULL filter (grants access to revoked students)`));
          missingFilters++;
        }
      }
    });
  }
  if (missingFilters === 0) {
    results.push(pass(`every FROM enrollment in payment files filters revoked_at IS NULL`));
  }

  return results;
}

// ---------- Gate PG4: Multi-table writes use db.batch() ---------------------
// Class prevented: webhook handlers that do user INSERT then enrollment INSERT
// then contact INSERT in 3 separate .run() calls. If the second one fails,
// the user record is orphaned without an enrollment, breaking the
// idempotent-retry envelope (Stripe retries find user already exists, skip
// the entire dedup, never get to enrollment creation).
//
// Heuristic: flag handler files where >= 3 sequential .run() calls appear
// without a db.batch([...]).run() pattern wrapping them.
//
// This is calibrated as a WARN (yellow ~), not a hard FAIL — there are
// legitimate cases (logging failures, fire-and-forget cleanup) where
// sequential .run()s are fine. The signal is "this file deserves a
// hand-review" not "this file is broken."
function gatePG4() {
  const results = [];

  for (const f of WEBHOOK_HANDLERS) {
    const src = read(f);
    if (!src) continue;

    // Strip comments to avoid false positives in docstrings
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    const runCalls = (stripped.match(/\.run\s*\(\s*\)/g) || []).length;
    const batchCalls = (stripped.match(/db\.batch\s*\(/g) || []).length;
    const firstCalls = (stripped.match(/\.first\s*\(/g) || []).length;

    // If there are batch calls, that's good signal the author knows the pattern.
    // Heuristic: warn if .run() count > 4 and batchCalls === 0.
    if (runCalls >= 5 && batchCalls === 0) {
      results.push(warn(`${f} has ${runCalls} sequential .run() calls and zero db.batch() — review for atomicity (multi-table writes that should be transactional)`));
    } else if (runCalls === 0) {
      results.push(pass(`${f} no D1 mutations (read-only or delegating)`));
    } else {
      const detail = batchCalls > 0
        ? `${runCalls} .run(), ${batchCalls} db.batch()`
        : `${runCalls} .run() (under threshold)`;
      results.push(pass(`${f} atomicity acceptable (${detail})`));
    }
  }

  return results;
}

// ---------- Run -----------------------------------------------------------
runGate('PG0', 'Payment surface enumeration (no ungated money-path file)', gatePG0);
runGate('PG1', 'Stripe webhook signature + dedup discipline', gatePG1);
runGate('PG2', 'No err.message leak in client-bound responses', gatePG2);
runGate('PG3', 'Enrollment revocation discipline', gatePG3);
runGate('PG4', 'Multi-table writes use db.batch() (heuristic)', gatePG4);

// ---------- Output --------------------------------------------------------
if (JSON_MODE) {
  console.log(JSON.stringify({
    pass: totalFailures === 0,
    failures: totalFailures,
    gates: gateResults,
  }, null, 2));
} else {
  console.log('');
  if (totalFailures === 0) {
    console.log(`${GREEN}${BOLD}✓ All payment-pipeline gates passed${RESET}`);
  } else {
    console.log(`${RED}${BOLD}✗ ${totalFailures} gate(s) failed${RESET}`);
  }
}

process.exit(totalFailures === 0 ? 0 : 1);
