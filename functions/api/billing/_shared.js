/**
 * Billing-cluster-wide infrastructure helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * Exports:
 *   getStripeClient(env)            -- configured Stripe client (throws if key missing)
 *   requireWebhookConfig(env)       -- validates STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
 *   dedupWebhookEvent(db, id, ...) -- INSERT OR IGNORE dedup; returns { skip, response? }
 *   rollbackWebhookDedup(db, id)   -- DELETE on 5xx so Stripe can retry
 *   json                            -- barrel re-export from auth/_shared.js
 */
import Stripe from 'stripe';
import { json, STRIPE_API_VERSION } from '../auth/_shared.js';
import { log } from '../_log.js';

export { json };

/**
 * Return a configured Stripe client.
 * Throws if STRIPE_SECRET_KEY is missing -- caller must handle.
 */
export function getStripeClient(env) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not set');
  }
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });
}

/**
 * Validate that both Stripe env vars are present.
 * Returns { ok: true } on success, { ok: false, response: <Response 500> } on failure.
 */
export function requireWebhookConfig(env) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: 'Webhook not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true };
}

/**
 * Idempotency guard: INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?).
 *
 * Returns:
 *   { skip: true,  response: <Response 200> }  -- duplicate; caller must return response
 *   { skip: false }                             -- new event; caller continues
 *   { skip: false, error: <Response 500> }      -- DB error; caller must return error
 */
export async function dedupWebhookEvent(db, eventId, env, waitUntil) {
  try {
    const ins = await db.prepare('INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)').bind(eventId).run();
    if (ins.meta.changes === 0) {
      log(env, waitUntil, 'billing', 'webhook_duplicate', 'skipped', eventId);
      return {
        skip: true,
        response: new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }
    return { skip: false };
  } catch (_e) {
    log(env, waitUntil, 'billing', 'dedup_check_fail', 'error', _e.message, 0, 500);
    return {
      skip: false,
      error: new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
}

/**
 * Delete the dedup row so Stripe can retry on 5xx sub-handler failures.
 * Logs errors but does not throw.
 */
export async function rollbackWebhookDedup(db, eventId, env, waitUntil) {
  try {
    await db.prepare('DELETE FROM webhook_event WHERE event_id = ?').bind(eventId).run();
  } catch (_delErr) {
    log(env, waitUntil, 'billing', 'dedup_cleanup_fail', 'error', `${eventId}: ${_delErr.message}`);
  }
}
