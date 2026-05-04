// Structured event logging via Analytics Engine (non-blocking).
// Usage: import { log } from './_log.js';
//        log(env, waitUntil, 'auth', 'login_success', 'ok', email, duration);
//        // With extras (positions 6+):
//        log(env, waitUntil, 'contact', 'submit_ok', 'ok', email, duration, 200, ['stuc-billing', 'card']);

export function log(env, waitUntil, event, action, status, detail, duration, httpStatus, extras) {
  if (!env.EVENTS) return;
  const baseBlobs = ['rrm-academy', event, action, status, (detail || '').slice(0, 200)];
  const extraBlobs = Array.isArray(extras) ? extras.map(v => String(v == null ? '' : v).slice(0, 200)) : [];
  // writeDataPoint is fire-and-forget (returns void, not a Promise).
  // Call directly -- waitUntil(void) throws in Pages Functions.
  env.EVENTS.writeDataPoint({
    blobs: [...baseBlobs, ...extraBlobs],
    doubles: [duration || 0, 1, httpStatus || 0],
    indexes: [action],
  });
}
