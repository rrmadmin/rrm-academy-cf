// Structured event logging via Analytics Engine (non-blocking).
// Usage: import { log } from './_log.js';
//        log(env, waitUntil, 'auth', 'login_success', 'ok', userId, duration);
//        // With extras (folded onto the detail):
//        log(env, waitUntil, 'contact', 'submit_ok', 'ok', userId, duration, 200, ['stuc-billing', 'card']);
//
// Since 2026-09-09 this is an adapter over the estate's vendored `report`
// package (`functions/_report.js`), not a hand-rolled writeDataPoint. The row
// it produces is unchanged in the columns anything reads:
//
//   blobs: ['rrm-academy', event, action, status, detail]
//   doubles: [duration, 1, httpStatus]
//   indexes: [action]
//
// Two things did change, both deliberately.
//
// STATUS. blob4 now always carries one of the five status words the
// observatory parses (see normalizeStatus). Nineteen call sites said
// 'skipped', 'warning', 'info', 'block' or 'reprocess'; those words now ride
// the front of the detail instead of sitting in the status column, where they
// made this repo's rows unreadable to workers-latency-error and to the
// worker-error-reporting deadman.
//
// EXTRAS. The optional trailing array used to become blobs 6 and 7. The
// package writes a five blob row, so extras are folded onto the end of the
// detail instead. Seven call sites pass them (google-ads click and conversion
// ids, and the contact form's category pair) and nothing in the observatory or
// in this repo has ever read blob6 or blob7 from worker_events, so folding
// them keeps every fact and loses only a column nobody queried.
//
// PRIV-02: detail/extras are scrubbed of email addresses before they reach
// Analytics Engine (long-retention telemetry). Redaction is SYNCHRONOUS on
// purpose: every call site is fire-and-forget (never awaited), so log() must
// not suspend before the write or the event can be dropped once the response
// returns. A global match also catches emails embedded mid-string.
import { r, normalizeStatus } from '../_report.js';

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

function redactPii(value) {
  return (value == null ? '' : value).toString().replace(EMAIL_PATTERN, '[redacted-email]').slice(0, 200);
}

export function log(env, waitUntil, event, action, status, detail, duration, httpStatus, extras) {
  if (!env || !env.EVENTS) return;
  const { status: safeStatus, note } = normalizeStatus(status);
  const safeExtras = Array.isArray(extras)
    ? extras.map(v => redactPii(v == null ? '' : v)).filter(Boolean)
    : [];
  const parts = [];
  if (note) parts.push(`${note}:`);
  const safeDetail = redactPii(detail);
  if (safeDetail) parts.push(safeDetail);
  for (const extra of safeExtras) parts.push(extra);
  // r.event is fire-and-forget and never throws; waitUntil(void) throws in
  // Pages Functions, so the parameter is kept for call-site compatibility and
  // deliberately unused.
  void waitUntil;
  r.event(env, event, action, safeStatus, parts.join(' '), {
    doubles: [duration || 0, 1, httpStatus || 0],
  });
}
