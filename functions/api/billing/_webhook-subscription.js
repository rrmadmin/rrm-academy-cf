/**
 * Handlers for Stripe subscription webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * - customer.subscription.updated: log status change (dunning handled by invoice.payment_failed)
 * - customer.subscription.deleted: send cancellation confirmation
 */
import { SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { getEmailByStripeCustomer, sendEmailSafe } from './_webhook-shared.js';

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {null}
 */
export async function handleSubscriptionUpdated(db, event, env, request, waitUntil) {
  const sub = event.data.object;
  log(env, waitUntil, 'billing', 'subscription_updated', 'ok', `${sub.id} status=${sub.status}`);

  return null;
}

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {null}
 */
export async function handleSubscriptionDeleted(db, event, env, request, waitUntil) {
  const sub = event.data.object;
  log(env, waitUntil, 'billing', 'subscription_deleted', 'ok', `${sub.id} customer=${sub.customer}`);

  try {
    await db.prepare(
      "UPDATE wix_subscription SET migration_status='fully_exited' " +
      "WHERE stripe_subscription_id=? AND migration_status='migrated'"
    ).bind(sub.id).run();
  } catch (cancelErr) {
    log(env, waitUntil, 'billing', 'migration_cancel_flag_fail', 'error',
      `${sub.id}: ${cancelErr.message}`);
    // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Send cancellation confirmation email
  if (env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, sub.customer, env, waitUntil);
    if (email) {
      waitUntil(sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your Save the Uterus Club membership has ended',
        source: 'billing/subscription-cancel',
        text: [
          'Hi there,',
          '',
          'Your Save the Uterus Club membership has been cancelled.',
          '',
          'You still have access to any courses you purchased separately.',
          '',
          'If you\'d like to rejoin, you can do so anytime at:',
          `${SITE_URL}/save-the-uterus-club/`,
          '',
          'Thank you for supporting evidence-based reproductive health.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      }).catch(() => {}));
      log(env, waitUntil, 'billing', 'cancellation_email_sent', 'ok', email);
    }
  }

  return null;
}
