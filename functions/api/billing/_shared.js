/**
 * Billing-cluster-wide infrastructure helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * Exports:
 *   getStripeClient(env)               -- configured Stripe client (throws if key missing)
 *   requireWebhookConfig(env)          -- validates STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
 *   dedupWebhookEvent(db, id, ...)     -- two-phase dedup; returns { skip, response?, processedAt? }
 *   markWebhookEventCompleted(db, id)  -- UPDATE completed_at after sub-handler success
 *   rollbackWebhookDedup(db, id, processedAt, ...) -- DELETE on 5xx so Stripe can retry,
 *                                       scoped to the delivery that claimed processedAt
 *   json                               -- barrel re-export from auth/_shared.js
 *
 * Two-phase dedup contract (migration 023):
 *   INSERT writes event_id + processed_at; completed_at stays NULL until handler succeeds.
 *   On duplicate, SELECT completed_at:
 *     - NOT NULL -> safe skip (200)
 *     - NULL and row is fresh (<60s) -> in-flight (500 forces Stripe retry)
 *     - NULL and row is stale (>=60s) -> prior attempt almost certainly crashed (handlers finish
 *       well under 60s); delete + reinsert the row and reprocess (handlers are idempotent)
 */
import Stripe from 'stripe';
import { json, STRIPE_API_VERSION } from '../auth/_shared.js';
import { log } from '../_log.js';

export { json };

const WEBHOOK_INFLIGHT_TTL_SECONDS = 60;

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
 * Two-phase idempotency guard.
 * INSERT writes event_id (processed_at default; completed_at NULL = in-flight).
 *
 * Returns:
 *   { skip: false, processedAt }                   -- new event, OR stale crashed-attempt reprocess; caller proceeds + must call markWebhookEventCompleted on success, and must
 *                                                      pass processedAt through to rollbackWebhookDedup on failure so the rollback only removes the delivery it claimed
 *   { skip: true,  response: <Response 200> }      -- duplicate completed; safe skip
 *   { skip: true,  response: <Response 500> }      -- duplicate in-flight; force Stripe retry
 *   { skip: false, error: <Response 500> }         -- DB error; caller returns error
 */
export async function dedupWebhookEvent(db, eventId, env, waitUntil) {
  try {
    const insertNowSec = Math.floor(Date.now() / 1000);
    const ins = await db.prepare('INSERT OR IGNORE INTO webhook_event (event_id, processed_at) VALUES (?, ?)').bind(eventId, insertNowSec).run();
    if (ins.meta.changes === 0) {
      const row = await db.prepare('SELECT completed_at, processed_at FROM webhook_event WHERE event_id = ?').bind(eventId).first();
      if (!row) {
        return { skip: false, processedAt: insertNowSec };
      }
      if (row.completed_at !== null && row.completed_at !== undefined) {
        log(env, waitUntil, 'billing', 'webhook_duplicate', 'skipped', `${eventId} (completed)`);
        return {
          skip: true,
          response: new Response(JSON.stringify({ ok: true, skipped: true, completed: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        };
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const ageSec = nowSec - (row.processed_at || 0);
      if (ageSec >= WEBHOOK_INFLIGHT_TTL_SECONDS) {
        // Never completed and past the in-flight TTL: Pages Function handlers finish well under
        // 60s, so this is almost certainly a crashed prior attempt (isolate OOM / CPU timeout /
        // uncaught rejection) whose rollback never ran. Reprocess instead of assuming completed --
        // handlers are idempotent, but silently ack'ing here would permanently drop the event's
        // side effects with no re-drive.
        log(env, waitUntil, 'billing', 'webhook_duplicate', 'reprocess', `${eventId} (stale-${ageSec}s, crashed-retry)`);
        const del = await db
          .prepare('DELETE FROM webhook_event WHERE event_id = ? AND completed_at IS NULL AND processed_at <= ?')
          .bind(eventId, nowSec - WEBHOOK_INFLIGHT_TTL_SECONDS)
          .run();
        if (del.meta.changes === 0) {
          log(env, waitUntil, 'billing', 'webhook_in_flight', 'skipped', `${eventId} (lost-reclaim-race)`);
          return {
            skip: true,
            response: new Response(JSON.stringify({ ok: false, error: 'in-flight' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          };
        }
        const reins = await db.prepare('INSERT OR IGNORE INTO webhook_event (event_id, processed_at) VALUES (?, ?)').bind(eventId, nowSec).run();
        if (reins.meta.changes === 0) {
          log(env, waitUntil, 'billing', 'webhook_in_flight', 'skipped', `${eventId} (lost-reclaim-race)`);
          return {
            skip: true,
            response: new Response(JSON.stringify({ ok: false, error: 'in-flight' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          };
        }
        return { skip: false, processedAt: nowSec };
      }
      log(env, waitUntil, 'billing', 'webhook_in_flight', 'skipped', `${eventId} (age-${ageSec}s)`);
      return {
        skip: true,
        response: new Response(JSON.stringify({ ok: false, error: 'in-flight' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      };
    }
    return { skip: false, processedAt: insertNowSec };
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
 * Mark a webhook event as completed (Phase 2 of the two-phase envelope).
 * Logs failures but never throws. If UPDATE fails, the row stays with completed_at=NULL;
 * Stripe retries will see in-flight (within TTL) or stale (after TTL) -- both safe responses.
 */
export async function markWebhookEventCompleted(db, eventId, env, waitUntil) {
  try {
    await db.prepare('UPDATE webhook_event SET completed_at = unixepoch() WHERE event_id = ?').bind(eventId).run();
  } catch (_markErr) { // arise-ignore silent-catch -- best-effort Phase 2 marker; callers must not throw on failure. Failed mark leaves completed_at=NULL; Stripe retry will see in-flight (within 60s TTL) or stale (after TTL). Both responses are correct -- no data loss path.
    log(env, waitUntil, 'billing', 'mark_completed_fail', 'error', `${eventId}: ${_markErr.message}`);
  }
}

/**
 * Delete the dedup row so Stripe can retry on 5xx sub-handler failures.
 * Scoped to the delivery that claimed processedAt and never completed, so a
 * late rollback for a delivery that lost the in-flight TTL race cannot erase
 * a row a newer, already-completed redelivery owns. If nothing matches, a
 * newer delivery owns the event -- log and no-op, do not delete blind.
 * Logs errors but does not throw.
 */
export async function rollbackWebhookDedup(db, eventId, processedAt, env, waitUntil) {
  try {
    const del = await db
      .prepare('DELETE FROM webhook_event WHERE event_id = ? AND processed_at = ? AND completed_at IS NULL')
      .bind(eventId, processedAt)
      .run();
    if (del.meta.changes === 0) {
      log(env, waitUntil, 'billing', 'dedup_rollback_noop', 'warn', `${eventId} (owned by a newer delivery)`);
    }
  } catch (_delErr) {
    log(env, waitUntil, 'billing', 'dedup_cleanup_fail', 'error', `${eventId}: ${_delErr.message}`);
  }
}
