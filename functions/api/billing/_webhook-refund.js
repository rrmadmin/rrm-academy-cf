/**
 * Handler for Stripe charge.refunded webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
import { sendEmailSafe } from './_webhook-shared.js';
import { log } from '../_log.js';
import { removeSupporterGift } from './_supporter-gift.js';
import { recomputeContactRollups } from './_donor-gift.js';

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

    try {
      await removeSupporterGift(db, { source: 'stripe', sourceId: charge.payment_intent });
      log(env, waitUntil, 'billing', 'supporter_recognition_removed', 'ok',
        `payment_intent=${charge.payment_intent}`);
    } catch (removeErr) {
      log(env, waitUntil, 'billing', 'supporter_recognition_remove_fail', 'error',
        `payment_intent=${charge.payment_intent}: ${removeErr.message}`, 0, 500);
      // Return 500 so dispatcher rolls back dedup row; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // CRM mirror: stamp refunded_at so total_donated/gift_count/donor_stage rollups drop
    // this gift. refunded_at IS NULL guard makes this idempotent on Stripe retries.
    // RETURNING email in the same statement avoids a read-then-write race.
    try {
      const refundedGift = await db.prepare(
        "UPDATE donor_gift SET refunded_at = datetime('now') " +
        "WHERE source = 'stripe' AND source_id = ? AND refunded_at IS NULL RETURNING email"
      ).bind(String(charge.payment_intent)).first();
      if (refundedGift?.email) {
        await recomputeContactRollups(db, refundedGift.email);
        log(env, waitUntil, 'billing', 'donor_gift_refunded', 'ok',
          `payment_intent=${charge.payment_intent}`);
      }
    } catch (giftRefundErr) {
      log(env, waitUntil, 'billing', 'donor_gift_refund_fail', 'error',
        `payment_intent=${charge.payment_intent}: ${giftRefundErr.message}`, 0, 500);
      // Return 500 so dispatcher rolls back dedup row; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return null;
}
