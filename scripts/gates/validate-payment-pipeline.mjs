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
 *   node scripts/gates/validate-payment-pipeline.mjs            # all 4 gates
 *   node scripts/gates/validate-payment-pipeline.mjs --gate PG1 # specific gate
 *   node scripts/gates/validate-payment-pipeline.mjs --json     # machine-readable
 *
 * Exit codes:
 *   0  all gates pass
 *   1  at least one gate failed
 *   2  gate runner itself errored (file missing, etc.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------- ANSI ----------------------------------------------------------
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m', RESET = '\x1b[0m', DIM = '\x1b[2m';

// ---------- Files under guard --------------------------------------------
// All files that handle money, subscription state, or payment auth.
// Adding a new payment endpoint? Add it here.
const PAYMENT_FILES = [
  'functions/api/stripe-webhook.js',
  'functions/api/create-checkout.js',
  'functions/api/billing/_webhook-checkout.js',
  'functions/api/billing/_webhook-subscription.js',
  'functions/api/billing/_webhook-invoice.js',
  'functions/api/billing/_webhook-shared.js',
  'functions/api/billing/_migration-token.js',
  'functions/api/billing/checkout-account.js',
  'functions/api/billing/portal.js',
  'functions/api/billing/status.js',
];

// Webhook entrypoint (must implement signature verify + dedup envelope)
const WEBHOOK_ENTRY = 'functions/api/stripe-webhook.js';

// Sub-handler files (must NOT re-implement dedup; parent handles it)
const WEBHOOK_HANDLERS = [
  'functions/api/billing/_webhook-checkout.js',
  'functions/api/billing/_webhook-subscription.js',
  'functions/api/billing/_webhook-invoice.js',
];

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

// ---------- Gate PG1: Stripe webhook signature + dedup discipline ----------
// Class of bugs prevented:
//   - missing or wrong signature verify (constructEvent vs constructEventAsync)
//   - missing event dedup (Stripe retries replay event.id; double-processing
//     causes duplicate enrollments / welcome emails / contact rows)
//   - dedup row not rolled back on 5xx (subsequent retry skipped as duplicate
//     even though prior attempt failed)
function gatePG1() {
  const results = [];
  const src = read(WEBHOOK_ENTRY);
  if (!src) return [fail(`${WEBHOOK_ENTRY} not found`)];

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

  // c) INSERT OR IGNORE INTO webhook_event before dispatch
  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+webhook_event/i.test(src)) {
    results.push(pass(`uses INSERT OR IGNORE INTO webhook_event for dedup`));
  } else {
    results.push(fail(`${WEBHOOK_ENTRY} must INSERT OR IGNORE INTO webhook_event before dispatching to handler (Stripe retries replay event.id)`));
  }

  // d) DELETE FROM webhook_event on 5xx (rollback so retry can re-process)
  if (/DELETE\s+FROM\s+webhook_event/i.test(src)) {
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
