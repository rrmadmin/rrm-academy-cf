/**
 * POST /api/stripe-webhook
 * Receives Stripe webhook events and processes them.
 *
 * Events handled:
 *   - checkout.session.completed      -> billing/_webhook-checkout.js
 *   - checkout.session.expired        -> billing/_webhook-checkout.js
 *   - customer.subscription.updated   -> billing/_webhook-subscription.js
 *   - customer.subscription.deleted   -> billing/_webhook-subscription.js
 *   - invoice.payment_failed          -> billing/_webhook-invoice.js
 *   - charge.refunded                 -> billing/_webhook-refund.js
 *
 * No CORS headers -- this is a server-to-server endpoint called by Stripe.
 * Uses constructEventAsync for CF Workers (async Web Crypto API).
 *
 * NOTE: Billing status (/api/billing/status) queries Stripe directly, so
 * subscription state is always fresh in the UI without needing D1 sync.
 */
import { handleCheckoutCompleted, handleCheckoutExpired } from './billing/_webhook-checkout.js';
import { handleSubscriptionUpdated, handleSubscriptionDeleted } from './billing/_webhook-subscription.js';
import { handlePaymentFailed } from './billing/_webhook-invoice.js';
import { handleChargeRefunded } from './billing/_webhook-refund.js';
import { getStripeClient, requireWebhookConfig, dedupWebhookEvent, markWebhookEventCompleted, rollbackWebhookDedup } from './billing/_shared.js';
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
  const cfg = requireWebhookConfig(env);
  if (!cfg.ok) return cfg.response;

  const stripe = getStripeClient(env);

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
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET);
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
  const dedup = await dedupWebhookEvent(db, event.id, env, waitUntil);
  if (dedup.skip) return dedup.response;
  if (dedup.error) return dedup.error;

  // Dispatch to per-event handler. Handlers return Response (to short-circuit) or null (200).
  let result = null;
  try {
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
      case 'charge.refunded':
        result = await handleChargeRefunded(db, event, env, waitUntil);
        break;
      default:
        log(env, waitUntil, 'billing', 'webhook_unhandled', 'skipped', event.type);
    }
  } catch (dispatchErr) {
    log(env, waitUntil, 'billing', 'webhook_dispatch_throw', 'error',
      `${event.id} (${event.type}): ${dispatchErr.message}`, 0, 500);
    await rollbackWebhookDedup(db, event.id, env, waitUntil);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (result) {
    if (result.status >= 500) {
      await rollbackWebhookDedup(db, event.id, env, waitUntil);
    } else {
      await markWebhookEventCompleted(db, event.id, env, waitUntil);
    }
    return result;
  }

  // Sub-handler returned null -> success. Mark completed (Phase 2) before 200.
  await markWebhookEventCompleted(db, event.id, env, waitUntil);

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
