/**
 * Handlers for Stripe subscription webhook events.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * - customer.subscription.created: sync STUC tier label if eligible
 * - customer.subscription.updated: sync STUC tier label (handles portal upgrades/downgrades)
 * - customer.subscription.deleted: remove STUC bare label + all three tier labels
 */
import { SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { getEmailByStripeCustomer, sendEmailSafe } from './_webhook-shared.js';
import { TIER_LABELS, LABEL_FOR_TIER, tierFromPriceOrAmount } from '../community/_shared.js';

const STUC_PRODUCT_ID = 'prod_U1VCTgB3uBP0KX';
const STUC_LABEL = 'Save the Uterus Club 🏷️';
const STUC_MEMBER_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * Remove the bare STUC label AND all three tier labels for a user.
 * Called on terminal statuses and subscription.deleted.
 * Idempotent: DELETEs are no-ops when rows are already absent.
 * Wix-era grandfather members have no Stripe sub so their labels are untouched
 * (this function is only reachable via a Stripe subscription event).
 */
async function maybeRemoveStucLabel(db, sub, env, waitUntil) {
  const isStucProduct = (sub.items?.data || []).some(
    item => item.price?.product === STUC_PRODUCT_ID
  );
  if (!isStucProduct) return;

  const user = await db.prepare('SELECT id FROM user WHERE stripe_customer_id = ?')
    .bind(sub.customer).first();
  if (!user) {
    log(env, waitUntil, 'billing', 'stuc_label_remove_no_user', 'warn',
      `stripe_customer_id=${sub.customer} sub=${sub.id} -- no user row`);
    return;
  }

  const allLabels = [STUC_LABEL, ...TIER_LABELS];
  await db.batch(
    allLabels.map(label =>
      db.prepare('DELETE FROM user_label WHERE user_id = ? AND label = ?')
        .bind(user.id, label)
    )
  );
  log(env, waitUntil, 'billing', 'stuc_label_removed', 'ok',
    `user=${user.id} sub=${sub.id} status=${sub.status}`);
}

/**
 * For an active STUC subscription, derive the tier and sync the user_label rows:
 *   - INSERT OR IGNORE the matching tier label
 *   - DELETE the other two tier labels (handles portal upgrades/downgrades)
 *   - INSERT OR IGNORE the bare STUC label (for legacy access checks)
 *
 * All three mutations run as a batch so partial-write risk is minimised.
 */
async function maybeSyncStucTierLabel(db, sub, env, waitUntil) {
  const isStucProduct = (sub.items?.data || []).some(
    item => item.price?.product === STUC_PRODUCT_ID
  );
  if (!isStucProduct) return;
  if (!STUC_MEMBER_STATUSES.includes(sub.status)) return;

  const user = await db.prepare('SELECT id FROM user WHERE stripe_customer_id = ?')
    .bind(sub.customer).first();
  if (!user) {
    log(env, waitUntil, 'billing', 'stuc_label_no_user', 'warn',
      `stripe_customer_id=${sub.customer} sub=${sub.id} -- no user row`);
    return;
  }

  const tier = tierFromPriceOrAmount(sub, env);
  const tierLabel = LABEL_FOR_TIER[tier];
  const otherTierLabels = TIER_LABELS.filter(l => l !== tierLabel);

  await db.batch([
    db.prepare('INSERT OR IGNORE INTO user_label (user_id, label) VALUES (?, ?)')
      .bind(user.id, STUC_LABEL),
    db.prepare('INSERT OR IGNORE INTO user_label (user_id, label) VALUES (?, ?)')
      .bind(user.id, tierLabel),
    ...otherTierLabels.map(label =>
      db.prepare('DELETE FROM user_label WHERE user_id = ? AND label = ?')
        .bind(user.id, label)
    ),
  ]);
  log(env, waitUntil, 'billing', 'stuc_tier_label_synced', 'ok',
    `user=${user.id} sub=${sub.id} status=${sub.status} tier=${tier}`);
}

/**
 * @param {D1Database} db
 * @param {Stripe.Event} event
 * @param {Object} env
 * @param {Request} request
 * @param {Function} waitUntil
 * @returns {null}
 */
export async function handleSubscriptionCreated(db, event, env, request, waitUntil) {
  const sub = event.data.object;
  log(env, waitUntil, 'billing', 'subscription_created', 'ok', `${sub.id} status=${sub.status}`);

  try {
    await maybeSyncStucTierLabel(db, sub, env, waitUntil);
  } catch (err) {
    log(env, waitUntil, 'billing', 'stuc_label_fail', 'error',
      `sub=${sub.id}: ${err.message}`);
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
export async function handleSubscriptionUpdated(db, event, env, request, waitUntil) {
  const sub = event.data.object;
  log(env, waitUntil, 'billing', 'subscription_updated', 'ok', `${sub.id} status=${sub.status}`);

  const TERMINAL_STATUSES = ['canceled', 'incomplete_expired', 'unpaid'];

  if (TERMINAL_STATUSES.includes(sub.status)) {
    try {
      await maybeRemoveStucLabel(db, sub, env, waitUntil);
    } catch (err) {
      log(env, waitUntil, 'billing', 'stuc_label_remove_fail', 'error',
        `sub=${sub.id}: ${err.message}`);
    }
  } else {
    try {
      await maybeSyncStucTierLabel(db, sub, env, waitUntil);
    } catch (err) {
      log(env, waitUntil, 'billing', 'stuc_label_fail', 'error',
        `sub=${sub.id}: ${err.message}`);
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

  try {
    await maybeRemoveStucLabel(db, sub, env, waitUntil);
  } catch (err) {
    log(env, waitUntil, 'billing', 'stuc_label_remove_fail', 'error',
      `sub=${sub.id}: ${err.message}`);
  }

  // Send cancellation confirmation email
  if (env.AWS_ACCESS_KEY_ID) {
    const email = await getEmailByStripeCustomer(db, sub.customer, env, waitUntil);
    if (email) {
      log(env, waitUntil, 'billing', 'cancellation_email_queued', 'ok', email);
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
      }).then(() => {
        log(env, waitUntil, 'billing', 'cancellation_email_sent', 'ok', email);
      }).catch(() => {}));
    }
  } else {
    log(env, waitUntil, 'billing', 'cancellation_email_skipped_no_ses', 'warn',
      'AWS_ACCESS_KEY_ID missing; cancellation email not sent', 0, 0);
  }

  return null;
}
