/**
 * REFERENCE ONLY -- do not import this file.
 *
 * Canonical endpoint pattern for CF Pages Functions.
 * Copy this when creating new endpoints. Derived from /arise-intel analysis
 * of 35 sibling-divergence bugs across 11 /arise runs (2026-03-10).
 *
 * Conventions enforced:
 * 1. Import json, optionsResponse from auth/_shared.js (never define locally)
 * 2. Import log from _log.js
 * 3. Export onRequestOptions -> optionsResponse()
 * 4. Export onRequest[Method] with outer try/catch
 * 5. Inner handler: DB check -> auth -> validate input -> business logic -> json response
 * 6. Never leak err.message to client (generic error string only)
 * 7. Wrap external service calls (Stripe, SES, fetch) in try/catch
 */

// --- Example: authenticated POST endpoint ---

// DELETE THIS LINE: import { json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit } from './auth/_shared.js';
// DELETE THIS LINE: import { log } from './_log.js';

/*
export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handlePost(request, env, waitUntil);
  } catch (err) {
    log(env, waitUntil, 'DOMAIN', 'ACTION_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handlePost(request, env, waitUntil) {
  // 1. Check required bindings
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  // 2. Authenticate (skip for public endpoints)
  const session = await validateSession(db, getSessionIdFromCookie(request));
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  // 3. Rate limit (for endpoints that create resources or send email)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!checkRateLimit(`action:${ip}`)) {
    return json({ ok: false, error: 'Too many requests' }, 429);
  }

  // 4. Parse and validate input
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { fieldA, fieldB } = body;
  if (typeof fieldA !== 'string' || fieldA.length > 200) {
    return json({ ok: false, error: 'Invalid fieldA' }, 400);
  }

  // 5. Business logic
  // ...

  // 6. External service calls -- always wrap in try/catch
  // try {
  //   await stripe.subscriptions.list({ ... });
  // } catch (err) {
  //   log(env, waitUntil, 'DOMAIN', 'stripe_error', 'error', err.message, 0, 502);
  //   return json({ ok: false, error: 'Payment service unavailable' }, 502);
  // }

  // 7. Return structured response
  return json({ ok: true, data: {} });
}
*/
