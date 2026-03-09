// Structured event logging via Analytics Engine (non-blocking).
// Usage: import { log } from './_log.js';
//        log(env, waitUntil, 'auth', 'login_success', 'ok', email, duration);

export function log(env, waitUntil, event, action, status, detail, duration, httpStatus) {
  if (!env.EVENTS) return;
  waitUntil(env.EVENTS.writeDataPoint({
    blobs: ['rrm-academy', event, action, status, (detail || '').slice(0, 200)],
    doubles: [duration || 0, 1, httpStatus || 0],
    indexes: [action],
  }));
}
