/**
 * Shared utilities for Stripe webhook event handlers.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
import { sendEmail as sesSendEmail } from '../_ses.js';
import { log } from '../_log.js';

/**
 * Look up a user's email by their Stripe customer ID.
 * Returns null if not found.
 */
export async function getEmailByStripeCustomer(db, stripeCustomerId, env, waitUntil) {
  if (!stripeCustomerId) return null;
  try {
    const row = await db.prepare('SELECT email FROM user WHERE stripe_customer_id = ?')
      .bind(stripeCustomerId).first();
    return row?.email || null;
  } catch (err) {
    log(env, waitUntil, 'billing', 'email_lookup_fail', 'error', `${stripeCustomerId}: ${err.message}`);
    return null;
  }
}

/**
 * Send a transactional email via SES.
 * Logs errors but does not throw -- email failure should not block webhook processing.
 */
export async function sendEmailSafe(env, waitUntil, { to, subject, text }) {
  try {
    await sesSendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to,
      subject,
      text,
    });
  } catch (err) {
    log(env, waitUntil, 'billing', 'email_send_fail', 'error', `${to}: ${err.message}`);
  }
}
