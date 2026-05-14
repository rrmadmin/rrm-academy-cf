/**
 * POST /api/stripe-webhook
 * Receives Stripe webhook events and processes them.
 *
 * Events handled:
 *   - checkout.session.completed      -> billing/_webhook-checkout.js
 *   - customer.subscription.updated   -> billing/_webhook-subscription.js
 *   - customer.subscription.deleted   -> billing/_webhook-subscription.js
 *   - invoice.payment_failed          -> billing/_webhook-invoice.js
 *
 * No CORS headers -- this is a server-to-server endpoint called by Stripe.
 * Uses constructEventAsync for CF Workers (async Web Crypto API).
 *
 * NOTE: Billing status (/api/billing/status) queries Stripe directly, so
 * subscription state is always fresh in the UI without needing D1 sync.
 */
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from './auth/_shared.js';
import { handleCheckoutCompleted, handleCheckoutExpired } from './billing/_webhook-checkout.js';
import { handleSubscriptionUpdated, handleSubscriptionDeleted } from './billing/_webhook-subscription.js';
import { handlePaymentFailed } from './billing/_webhook-invoice.js';
import { log } from './_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handleWebhook(request, env, waitUntil);
  } catch (err) {
    console.error('Unhandled webhook error:', err.message, err.stack);
    log(env, waitUntil, 'billing', 'webhook_error', 'error', err.message, 0, 500);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleWebhook(request, env, waitUntil) {
  const stripeKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'Webhook not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    log(env, waitUntil, 'billing', 'webhook_sig_fail', 'error', err.message, 0, 400);
    return new Response(JSON.stringify({ ok: false, error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = env.DB;
  if (!db) {
    console.error('DB binding missing -- cannot process webhook event');
    log(env, waitUntil, 'billing', 'webhook_no_db', 'error', event.id, 0, 500);
    return new Response(JSON.stringify({ ok: false, error: 'DB not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Deduplicate: skip events already processed (Stripe retries send same event.id)
  try {
    const ins = await db.prepare('INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)').bind(event.id).run();
    if (ins.meta.changes === 0) {
      log(env, waitUntil, 'billing', 'webhook_duplicate', 'skipped', event.id);
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (_e) {
    log(env, waitUntil, 'billing', 'dedup_check_fail', 'error', _e.message, 0, 500);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Dispatch to per-event handler. Handlers return Response (to short-circuit) or null (200).
  let result = null;
  switch (event.type) {
    case 'checkout.session.completed':
      result = await handleCheckoutCompleted(db, event, env, request, waitUntil);
      break;
    case 'checkout.session.expired':
      result = await handleCheckoutExpired(db, event, env, waitUntil);
      break;
    case 'customer.subscription.updated':
      result = await handleSubscriptionUpdated(db, event, env, request, waitUntil);
      break;
    case 'customer.subscription.deleted':
      result = await handleSubscriptionDeleted(db, event, env, request, waitUntil);
      break;
    case 'invoice.payment_failed':
      result = await handlePaymentFailed(db, event, env, request, waitUntil);
      break;
    case 'charge.refunded': {
      const charge = event.data.object;
      log(env, waitUntil, 'billing', 'charge_refunded', 'ok',
        `charge=${charge.id} customer=${charge.customer || 'none'} amount=${charge.amount_refunded}`);

      // Only revoke on full refund (charge.refunded === true). Partial refunds keep access.
      if (charge.refunded && charge.payment_intent) {
        try {
          const revoked = await db.prepare(
            "UPDATE enrollment SET revoked_at = datetime('now') WHERE stripe_payment_intent = ? AND revoked_at IS NULL"
          ).bind(charge.payment_intent).run();
          if (revoked.meta.changes > 0) {
            log(env, waitUntil, 'billing', 'enrollment_revoked', 'ok',
              `payment_intent=${charge.payment_intent} rows=${revoked.meta.changes}`);
            if (env.AWS_ACCESS_KEY_ID) {
              const { sendEmailSafe } = await import('./billing/_webhook-shared.js');
              waitUntil(sendEmailSafe(env, waitUntil, {
                to: 'administrator@rrmacademy.org',
                subject: `Enrollment revoked: charge ${charge.id} refunded`,
                source: 'billing/refund-revoke',
                text: [
                  'A charge was fully refunded and the associated enrollment has been revoked.',
                  '',
                  `Charge:              ${charge.id}`,
                  `Payment Intent:      ${charge.payment_intent}`,
                  `Customer:            ${charge.customer || 'none'}`,
                  `Amount refunded:     $${(charge.amount_refunded / 100).toFixed(2)}`,
                  `Enrollments revoked: ${revoked.meta.changes}`,
                  '',
                  'If this was a mistake, the student can be re-enrolled manually.',
                ].join('\n'),
              }).catch(() => {}));
            }
          }
        } catch (revokeErr) {
          log(env, waitUntil, 'billing', 'enrollment_revoke_fail', 'error',
            `payment_intent=${charge.payment_intent}: ${revokeErr.message}`, 0, 500);
          // Set result to 500 so dispatcher rolls back dedup row; Stripe retries.
          result = new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      break;
    }
    default:
      log(env, waitUntil, 'billing', 'webhook_unhandled', 'skipped', event.type);
  }

  if (result) {
    if (result.status >= 500) {
      try {
        await db.prepare('DELETE FROM webhook_event WHERE event_id = ?').bind(event.id).run();
      } catch (_delErr) {
        log(env, waitUntil, 'billing', 'dedup_cleanup_fail', 'error', `${event.id}: ${_delErr.message}`);
      }
    }
    return result;
  }

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
