/**
 * Handler for Stripe charge.refunded webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
import { sendEmailSafe } from './_webhook-shared.js';
import { log } from '../_log.js';

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Function} waitUntil
 * @returns {Response|null}
 */
export async function handleChargeRefunded(db, event, env, waitUntil) {
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
      // Return 500 so dispatcher rolls back dedup row; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return null;
}
