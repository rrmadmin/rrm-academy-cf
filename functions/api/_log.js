// Structured event logging via Analytics Engine (non-blocking).
// Usage: import { log } from './_log.js';
//        log(env, waitUntil, 'auth', 'login_success', 'ok', userId, duration);
//        // With extras (positions 6+):
//        log(env, waitUntil, 'contact', 'submit_ok', 'ok', userId, duration, 200, ['stuc-billing', 'card']);
//
// PRIV-02: detail/extras are scrubbed of email addresses before they reach
// Analytics Engine (long-retention telemetry). Redaction is SYNCHRONOUS on
// purpose: every call site is fire-and-forget (never awaited), so log() must
// not suspend before writeDataPoint or the event can be dropped once the
// response returns. A global match also catches emails embedded mid-string.
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

function redactPii(value) {
  return (value == null ? '' : value).toString().slice(0, 200).replace(EMAIL_PATTERN, '[redacted-email]');
}

export function log(env, waitUntil, event, action, status, detail, duration, httpStatus, extras) {
  if (!env.EVENTS) return;
  const safeDetail = redactPii(detail);
  const safeExtras = Array.isArray(extras)
    ? extras.map(v => redactPii(v == null ? '' : v))
    : [];
  // writeDataPoint is fire-and-forget (returns void, not a Promise).
  // Call directly -- waitUntil(void) throws in Pages Functions.
  env.EVENTS.writeDataPoint({
    blobs: ['rrm-academy', event, action, status, safeDetail, ...safeExtras],
    doubles: [duration || 0, 1, httpStatus || 0],
    indexes: [action],
  });
}
