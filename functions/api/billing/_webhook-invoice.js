/**
 * Handler for Stripe invoice.payment_failed webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
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
export async function handlePaymentFailed(db, event, env, request, waitUntil) {
  const invoice = event.data.object;
  log(env, waitUntil, 'billing', 'payment_failed', 'error', `${invoice.id} customer=${invoice.customer}`);

  // Email user about the failed payment
  if (env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, invoice.customer, env, waitUntil);
    if (email) {
      await sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Payment failed for your RRM Academy membership',
        text: [
          'Hi there,',
          '',
          'Your most recent membership payment could not be processed.',
          '',
          'Stripe will automatically retry, but you can update your payment method now:',
          `${SITE_URL}/account`,
          '',
          'If your payment method is not updated, your membership may be cancelled.',
          '',
          `If you have questions, contact us at ${SITE_URL}/contact`,
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      });
      log(env, waitUntil, 'billing', 'payment_failed_notified', 'ok', email);
    }
  }

  return null;
}
