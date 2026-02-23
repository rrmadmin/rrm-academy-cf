/**
 * POST /api/stripe-webhook
 * Receives Stripe webhook events and processes them.
 *
 * Events handled:
 *   - checkout.session.completed  → link stripe_customer_id to D1 user
 *   - customer.subscription.updated → (logged, no action needed — Stripe is source of truth)
 *   - customer.subscription.deleted → (logged)
 *   - invoice.payment_failed       → (logged)
 *
 * No CORS headers — this is a server-to-server endpoint called by Stripe.
 * Uses constructEventAsync for CF Workers (async Web Crypto API).
 */
import Stripe from 'stripe';

export async function onRequestPost({ request, env }) {
  const stripeKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return new Response('Webhook not configured', { status: 500 });
  }

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2024-12-18.acacia',
  });

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const db = env.DB;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer;
      if (!customerId || !db) break;

      // Try to link Stripe customer to D1 user
      // Priority 1: client_reference_id (D1 user ID set during checkout)
      if (session.client_reference_id) {
        await db.prepare(
          'UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(customerId, session.client_reference_id).run();
        console.log(`Linked Stripe ${customerId} to user ${session.client_reference_id} (by ID)`);
        break;
      }

      // Priority 2: email match
      const email = session.customer_details?.email || session.customer_email;
      if (email) {
        const result = await db.prepare(
          'UPDATE user SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE email = ? AND stripe_customer_id IS NULL'
        ).bind(customerId, email.toLowerCase()).run();
        if (result.meta?.changes > 0) {
          console.log(`Linked Stripe ${customerId} to user by email ${email}`);
        }
      }
      break;
    }

    case 'customer.subscription.updated':
      console.log(`Subscription updated: ${event.data.object.id}, status: ${event.data.object.status}`);
      break;

    case 'customer.subscription.deleted':
      console.log(`Subscription deleted: ${event.data.object.id}`);
      break;

    case 'invoice.payment_failed':
      console.log(`Payment failed for invoice: ${event.data.object.id}, customer: ${event.data.object.customer}`);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
