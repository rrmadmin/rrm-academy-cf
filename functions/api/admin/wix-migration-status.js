/**
 * GET /api/admin/wix-migration-status
 * Read-only observability dashboard for the Wix-to-Stripe migration.
 * Returns 5 sections: counts, needs_action, stragglers, lapsed,
 * post_migration_cancellations, and email_mismatches.
 *
 * Protected by ADMIN_API_SECRET Bearer token (constant-time compare).
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

const ROW_CAP = 50;

const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.start > RATE_WINDOW) rateLimitMap.delete(k);
    }
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.ADMIN_API_SECRET) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  const auth = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.ADMIN_API_SECRET}`;
  const authBytes = new TextEncoder().encode(auth);
  const expectedBytes = new TextEncoder().encode(expected);
  let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.min(authBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= authBytes[i] ^ expectedBytes[i];
  }
  if (mismatch !== 0) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'service_unavailable' }, 503);
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (isRateLimited(ip)) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const db = env.DB;

  try {
    const [
      countsRes,
      needsActionRes,
      stragglersRes,
      lapsedRes,
      postCancelRes,
    ] = await db.batch([
      db.prepare(
        "SELECT migration_status, COUNT(*) AS n FROM wix_subscription GROUP BY migration_status"
      ),
      db.prepare(
        "SELECT ws.wix_subscription_id, ws.email, ws.stripe_subscription_id, ws.updated_at " +
        "FROM wix_subscription ws " +
        "WHERE ws.migration_status='stripe_active' " +
        "  AND ws.status='active' " +
        "  AND ws.updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-72 hours') " +
        "ORDER BY ws.updated_at DESC " +
        "LIMIT ?"
      ).bind(ROW_CAP),
      db.prepare(
        "SELECT email, tier, amount_cents, migration_email_sent_at " +
        "FROM wix_subscription " +
        "WHERE migration_email_sent_at IS NOT NULL " +
        "  AND migration_status='pending' " +
        "  AND migration_email_sent_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-21 days') " +
        "ORDER BY migration_email_sent_at ASC " +
        "LIMIT ?"
      ).bind(ROW_CAP),
      db.prepare(
        "SELECT email, tier, amount_cents, last_order_at " +
        "FROM wix_subscription " +
        "WHERE status='cancelled' AND stripe_subscription_id IS NULL " +
        "  AND migration_status IN ('pending','declined') " +
        "ORDER BY last_order_at DESC " +
        "LIMIT ?"
      ).bind(ROW_CAP),
      db.prepare(
        "SELECT email, stripe_subscription_id, updated_at " +
        "FROM wix_subscription " +
        "WHERE migration_status='fully_exited' " +
        "  AND updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') " +
        "ORDER BY updated_at DESC " +
        "LIMIT ?"
      ).bind(ROW_CAP),
    ]);

    const counts = {};
    for (const row of countsRes.results || []) {
      counts[row.migration_status] = row.n;
    }

    let emailMismatches = [];
    if (env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_MEMBER && env.STRIPE_PRICE_HERO && env.STRIPE_PRICE_SUPERHERO) {
      try {
        const priceIds = [env.STRIPE_PRICE_MEMBER, env.STRIPE_PRICE_HERO, env.STRIPE_PRICE_SUPERHERO];
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;

        const migratedEmails = await db.prepare(
          "SELECT email FROM wix_subscription WHERE migration_status='migrated'"
        ).all();
        const migratedSet = new Set(
          (migratedEmails.results || []).map(r => r.email.toLowerCase())
        );

        for (const priceId of priceIds) {
          const stripeUrl = new URL('https://api.stripe.com/v1/subscriptions');
          stripeUrl.searchParams.set('status', 'active');
          stripeUrl.searchParams.set('price', priceId);
          stripeUrl.searchParams.set('created[gte]', String(thirtyDaysAgo));
          stripeUrl.searchParams.set('expand[]', 'data.customer');
          stripeUrl.searchParams.set('limit', '100');

          const stripeRes = await fetch(stripeUrl.toString(), {
            headers: {
              Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            },
          });

          if (!stripeRes.ok) {
            log(env, waitUntil, 'admin', 'wix_migration_stripe_fetch_fail', 'error',
              `price=${priceId} status=${stripeRes.status}`, 0, stripeRes.status);
            continue;
          }

          const stripeData = await stripeRes.json();
          for (const stripeSub of stripeData?.data || []) {
            const customerEmail = (
              stripeSub.customer?.email ||
              stripeSub.customer_email ||
              ''
            ).toLowerCase().trim();
            if (!customerEmail) continue;
            if (!migratedSet.has(customerEmail)) {
              emailMismatches.push({
                stripe_subscription_id: stripeSub.id,
                stripe_email: customerEmail,
                price_id: priceId,
                created: new Date(stripeSub.created * 1000).toISOString(),
              });
            }
          }
        }
      } catch (stripeErr) {
        log(env, waitUntil, 'admin', 'wix_migration_stripe_check_fail', 'error',
          stripeErr.message, 0, 500);
        emailMismatches = [{ error: 'stripe_check_failed' }];
      }
    }

    log(env, waitUntil, 'admin', 'wix_migration_status', 'ok', '', 0, 200);

    return json({
      ok: true,
      counts,
      needs_action: needsActionRes.results || [],
      stragglers: stragglersRes.results || [],
      lapsed: lapsedRes.results || [],
      post_migration_cancellations: postCancelRes.results || [],
      email_mismatches: emailMismatches,
    });
  } catch (err) {
    log(env, waitUntil, 'admin', 'wix_migration_status_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'query_failed' }, 500);
  }
}
