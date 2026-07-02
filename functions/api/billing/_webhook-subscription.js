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
import { getStripeClient } from './_shared.js';
import { TIER_LABELS, LABEL_FOR_TIER, TIER_LABEL_MAP, tierFromPriceOrAmount } from '../community/_shared.js';

const STUC_PRODUCT_ID = 'prod_U1VCTgB3uBP0KX';
const STUC_LABEL = 'Save the Uterus Club 🏷️';
const STUC_MEMBER_STATUSES = ['active', 'trialing', 'past_due'];
const VALID_TIER_NAMES = new Set(Object.values(TIER_LABEL_MAP));

/**
 * True when a subscription is a STUC subscription -- either a standard
 * fixed-price sub (product match) or a custom-amount migration sub built
 * with price_data (ad-hoc product; identified instead via the tier metadata
 * create-checkout always stamps onto subscription_data for STUC checkouts).
 */
function isStucSubscription(sub) {
  const isStucProduct = (sub.items?.data || []).some(
    item => item.price?.product === STUC_PRODUCT_ID
  );
  if (isStucProduct) return true;
  return VALID_TIER_NAMES.has(sub.metadata?.tier);
}

/**
 * True when the customer has another subscription (besides `sub`) that still
 * confers STUC membership, or an active/migrating Wix subscription for the
 * same user -- i.e. removing labels for `sub` would incorrectly drop a still-
 * paying member. Fails open to "no other membership found" (false = proceed
 * with removal) on any lookup error so a Stripe/D1 outage doesn't strand
 * labels forever; the surviving subscription's own webhook events will
 * eventually re-sync labels regardless.
 */
async function hasOtherActiveMembership(db, sub, userId, env, waitUntil) {
  try {
    const stripe = getStripeClient(env);
    const subs = await stripe.subscriptions.list({ customer: sub.customer, status: 'all', limit: 20 });
    const otherActive = (subs.data || []).some(
      other => other.id !== sub.id && STUC_MEMBER_STATUSES.includes(other.status)
    );
    if (otherActive) return true;
  } catch (err) {
    log(env, waitUntil, 'billing', 'stuc_label_other_sub_check_fail', 'warn',
      `sub=${sub.id}: ${err.message}`);
  }

  try {
    const wixRow = await db.prepare(
      "SELECT wix_subscription_id FROM wix_subscription " +
      "WHERE user_id = ? AND status = 'active' AND migration_status = 'pending' LIMIT 1"
    ).bind(userId).first();
    if (wixRow) return true;
  } catch (err) {
    log(env, waitUntil, 'billing', 'stuc_label_wix_row_check_fail', 'warn',
      `sub=${sub.id}: ${err.message}`);
  }

  return false;
}

/**
 * Remove the bare STUC label AND all three tier labels for a user.
 * Called on terminal statuses and subscription.deleted.
 * Idempotent: DELETEs are no-ops when rows are already absent.
 * Wix-era grandfather members have no Stripe sub so their labels are untouched
 * (this function is only reachable via a Stripe subscription event).
 * Skips removal when the same user has another active membership source
 * (another active/trialing/past_due Stripe sub, or a pending-migration Wix
 * row) so cancelling a duplicate/old sub doesn't strip a still-paying member.
 */
async function maybeRemoveStucLabel(db, sub, env, waitUntil) {
  if (!isStucSubscription(sub)) return null;

  const user = await db.prepare('SELECT id FROM user WHERE stripe_customer_id = ?')
    .bind(sub.customer).first();
  if (!user) {
    log(env, waitUntil, 'billing', 'stuc_label_remove_no_user', 'warn',
      `stripe_customer_id=${sub.customer} sub=${sub.id} -- no user row`);
    return null;
  }

  if (await hasOtherActiveMembership(db, sub, user.id, env, waitUntil)) {
    log(env, waitUntil, 'billing', 'stuc_label_remove_skipped_other_membership', 'ok',
      `user=${user.id} sub=${sub.id} status=${sub.status} -- another active membership found`);
    return user.id;
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
  return user.id;
}

/**
 * Best-effort invalidation of requireMember's `member_sub:${userId}` KV memoization
 * (300s TTL, community/_shared.js) so a terminal subscription status is reflected
 * immediately instead of after the cache naturally expires. Never blocks the webhook.
 */
function invalidateMemberCache(env, waitUntil, userId) {
  if (!userId || !env.COMMUNITY_KV) return;
  waitUntil(env.COMMUNITY_KV.delete(`member_sub:${userId}`).catch(() => {}));
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
  if (!isStucSubscription(sub)) return;
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
 * Deferred migration handoff (Phase 7 cron Sweep 2 gap-filler -- that cron was never
 * built; this closes the gap at the event level instead).
 *
 * _webhook-checkout.js's metadata-first handoff (handleCheckoutCompleted) defers the
 * migration flip when the Stripe subscription is still 3DS-pending/incomplete at
 * checkout.session.completed time ("metadata_handoff_deferred" there) -- the donor's
 * card needed extra confirmation the sub wasn't active yet. When that same
 * subscription later transitions to 'active'/'trialing' here, complete the handoff:
 * mirrors that handler's atomic UPDATE + admin "cancel Wix sub" email exactly.
 *
 * The `stripe_subscription_id IS NULL` guard on the UPDATE makes Stripe retries and
 * duplicate `customer.subscription.updated` events no-ops.
 */
async function maybeCompleteMigrationHandoff(db, sub, env, waitUntil) {
  if (sub.status !== 'active' && sub.status !== 'trialing') return;

  const wixSubIdMeta = sub.metadata?.wix_subscription_id || null;
  if (!wixSubIdMeta || typeof wixSubIdMeta !== 'string' || !/^wxs_[a-z0-9_-]+$/i.test(wixSubIdMeta)) return;

  const wixRow = await db.prepare(
    "SELECT email, tier, amount_cents, next_expected_at, stripe_subscription_id " +
    "FROM wix_subscription WHERE wix_subscription_id = ?"
  ).bind(wixSubIdMeta).first();

  if (!wixRow) {
    log(env, waitUntil, 'billing', 'migration_sweep_row_missing', 'warn',
      `${wixSubIdMeta} sub=${sub.id} -- no wix_subscription row`);
    return;
  }
  if (wixRow.stripe_subscription_id) {
    // Already migrated -- benign no-op (metadata path or an earlier sweep beat us).
    return;
  }

  // Atomic UPDATE filtered by stripe_subscription_id IS NULL gives idempotency
  // even without the pre-check above (defense in depth against retry race), mirroring
  // the metadata-handoff UPDATE in _webhook-checkout.js.
  const upd = await db.prepare(
    "UPDATE wix_subscription " +
    "SET migration_status='stripe_active', " +
    "    stripe_subscription_id=?, " +
    "    migration_handoff_started_at=NULL, " +
    "    migration_notes=COALESCE(migration_notes,'') || " +
    "      strftime('%Y-%m-%dT%H:%M:%fZ','now') || ' sweep2-handoff sub=' || ? || char(10), " +
    "    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
    "WHERE wix_subscription_id=? AND stripe_subscription_id IS NULL"
  ).bind(sub.id, sub.id, wixSubIdMeta).run();

  if ((upd.meta?.changes ?? 0) === 0) {
    // Lost the race (already migrated by another event). No-op.
    return;
  }

  log(env, waitUntil, 'billing', 'migration_sweep_flip', 'ok', `${wixSubIdMeta} -> ${sub.id}`);

  if (!env.AWS_ACCESS_KEY_ID) {
    log(env, waitUntil, 'billing', 'migration_sweep_email_skipped_no_ses', 'warn',
      'AWS_ACCESS_KEY_ID missing; cancel-Wix-sub email not sent', 0, 0);
    return;
  }

  const donorEmail = (wixRow.email || '').toLowerCase().trim().replace(/[\r\n]/g, '');
  const nextChargeDate = wixRow.next_expected_at
    ? new Date(wixRow.next_expected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'their next scheduled donation date';

  waitUntil(sendEmailSafe(env, waitUntil, {
    to: 'administrator@rrmacademy.org',
    subject: `STUC migration: cancel Wix sub for ${donorEmail || wixSubIdMeta}`,
    source: 'billing/migration-sweep2',
    text:
`${donorEmail || '(unknown email)'}'s Stripe subscription for the Wix -> Stripe migration became active after an initial 3DS-pending delay.

Wix sub:        ${wixSubIdMeta}
Stripe sub:     ${sub.id}
Tier:           ${wixRow.tier}
Amount:         ${(() => { const n = Number(wixRow.amount_cents); return (Number.isFinite(n) && n > 0) ? `$${(n / 100).toFixed(2)}/mo` : '(unknown)'; })()}
Next charge:    ${nextChargeDate}

VERIFY in Stripe Dashboard that the sub status is 'active', then cancel the Wix sub
within 24 hours to prevent double-billing.

Wix Dashboard -> Subscriptions -> Cancel immediately (NOT end-of-cycle).`,
  }).catch(() => {}));
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
    // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
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

  // Any status outside STUC_MEMBER_STATUSES (terminal statuses like 'canceled'/
  // 'incomplete_expired'/'unpaid', and non-terminal-but-non-paying statuses like
  // 'paused') must not keep STUC labels; only member statuses re-sync them.
  if (!STUC_MEMBER_STATUSES.includes(sub.status)) {
    try {
      const userId = await maybeRemoveStucLabel(db, sub, env, waitUntil);
      invalidateMemberCache(env, waitUntil, userId);
    } catch (err) {
      log(env, waitUntil, 'billing', 'stuc_label_remove_fail', 'error',
        `sub=${sub.id}: ${err.message}`);
      // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    try {
      await maybeSyncStucTierLabel(db, sub, env, waitUntil);
    } catch (err) {
      log(env, waitUntil, 'billing', 'stuc_label_fail', 'error',
        `sub=${sub.id}: ${err.message}`);
      // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      await maybeCompleteMigrationHandoff(db, sub, env, waitUntil);
    } catch (err) {
      log(env, waitUntil, 'billing', 'migration_sweep_fail', 'error',
        `sub=${sub.id}: ${err.message}`);
      // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
      return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
      "UPDATE wix_subscription " +
      "SET migration_status='fully_exited', " +
      "    migration_notes=COALESCE(migration_notes,'') || " +
      "      strftime('%Y-%m-%dT%H:%M:%fZ','now') || ' subscription-deleted sub=' || ? || char(10), " +
      "    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
      "WHERE stripe_subscription_id=? AND migration_status='migrated'"
    ).bind(sub.id, sub.id).run();
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
    const userId = await maybeRemoveStucLabel(db, sub, env, waitUntil);
    invalidateMemberCache(env, waitUntil, userId);
  } catch (err) {
    log(env, waitUntil, 'billing', 'stuc_label_remove_fail', 'error',
      `sub=${sub.id}: ${err.message}`);
    // Return 500 so dispatcher rolls back webhook_event dedup; Stripe retries.
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Send cancellation confirmation email -- only for STUC subscriptions,
  // matching the isStucSubscription gate on the label helpers above.
  if (isStucSubscription(sub) && env.AWS_ACCESS_KEY_ID) {
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
  } else if (isStucSubscription(sub)) {
    log(env, waitUntil, 'billing', 'cancellation_email_skipped_no_ses', 'warn',
      'AWS_ACCESS_KEY_ID missing; cancellation email not sent', 0, 0);
  }

  return null;
}
