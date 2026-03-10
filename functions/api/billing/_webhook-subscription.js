/**
 * Handlers for Stripe subscription webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * - customer.subscription.updated: notify user on past_due
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

  // Notify user when subscription goes past_due (payment retry failing)
  if (sub.status === 'past_due' && env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, sub.customer, env, waitUntil);
    if (email) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Action needed: update your payment method',
        text: [
          'Hi there,',
          '',
          'We were unable to process your most recent payment for your Save the Uterus Club membership.',
          '',
          'Please update your payment method to keep your membership active:',
          `${SITE_URL}/account`,
          '',
          `If you have questions, reply to this email or contact us at ${SITE_URL}/contact`,
          '',
          'RRM Academy',
          'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'past_due_notified', 'ok', email);
    }
  }

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

  // Send cancellation confirmation email
  if (env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, sub.customer, env, waitUntil);
    if (email) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Your Save the Uterus Club membership has ended',
        text: [
          'Hi there,',
          '',
          'Your Save the Uterus Club membership has been cancelled.',
          '',
          'You still have access to any courses you purchased separately.',
          '',
          'If you\'d like to rejoin, you can do so anytime at:',
          `${SITE_URL}/save-the-uterus-club`,
          '',
          'Thank you for supporting evidence-based reproductive health.',
          '',
          'RRM Academy',
          'A project of the RRM Foundation \u2014 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'cancellation_email_sent', 'ok', email);
    }
  }

  return null;
}
