/**
 * Handler for Stripe invoice.payment_failed webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
import { SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { sendEmailSafe } from './_webhook-shared.js';

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
    let email;
    try {
      const row = await db.prepare('SELECT email FROM user WHERE stripe_customer_id = ?')
        .bind(invoice.customer).first();
      email = row?.email || null;
    } catch (err) {
      log(env, waitUntil, 'billing', 'email_lookup_fail', 'error', `${invoice.customer}: ${err.message}`);
      // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (email) {
      waitUntil(sendEmailSafe(env, waitUntil, {
        to: email,
        subject: 'Payment failed for your RRM Academy membership',
        source: 'billing/invoice-failed',
        text: [
          'Hi there,',
          '',
          'Your most recent membership payment could not be processed.',
          '',
          'Stripe will automatically retry, but you can update your payment method now:',
          `${SITE_URL}/account/`,
          '',
          'If your payment method is not updated, your membership may be cancelled.',
          '',
          `If you have questions, contact us at ${SITE_URL}/contact/`,
          '',
          'RRM Academy',
          'A project of the RRM Foundation -- 501(c)(3), EIN: 93-4594315',
        ].join('\n'),
      }).then(() => {
        log(env, waitUntil, 'billing', 'payment_failed_notified', 'ok', email);
      }).catch(() => {}));
    }
  }

  return null;
}
