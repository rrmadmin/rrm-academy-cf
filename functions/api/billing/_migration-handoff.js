/**
 * Wix→Stripe STUC subscription migration state primitives.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 *
 * Exports:
 *   lookupPendingWixMigration(db, { wixSubId, userEmail, env })
 *   validateOffAmount(wixLookup)
 *   validateFrequency(wixLookup)
 *   isCustomAmount(wixLookup)
 *   acquireMigrationHandoffLock(db, wixSubscriptionId, env, waitUntil)
 *   clampTrialEnd(wixLookup, env)
 *   findBlockingActiveSubscription(stripe, stripeCustomerId, env, waitUntil)
 *
 * All 52 live wix_subscription rows are exactly 900/1900/9900 cents, all
 * MONTH frequency (Brian-confirmed, verified in live D1). Off-amount and
 * non-monthly rows are permanent refusals, not a UX flow -- see
 * validateOffAmount() and validateFrequency().
 */
import { json } from '../auth/_shared.js';
import { log } from '../_log.js';

/**
 * Look up a pending Wix subscription for this user.
 *
 * - If STUC_MIGRATION_UX_V2 is not 'true', returns null immediately.
 * - If both wixSubId and userEmail are provided, uses OR-clause.
 * - Logs to AE on DB error; returns null on error (fail-open for lookup).
 *
 * @returns {Object|null} wix_subscription row or null
 */
export async function lookupPendingWixMigration(db, { wixSubId, userEmail, env }) {
  const stucV2 = env.STUC_MIGRATION_UX_V2 === 'true';
  if (!stucV2 || !db || (!wixSubId && !userEmail)) return null;

  try {
    let wixQuery;
    if (wixSubId && userEmail) {
      wixQuery = db.prepare(
        "SELECT wix_subscription_id, tier, amount_cents, frequency, next_expected_at, status, migration_status, email " +
        "FROM wix_subscription " +
        "WHERE (wix_subscription_id = ? OR email = ? COLLATE NOCASE) " +
        "  AND status = 'active' " +
        "  AND migration_status = 'pending' " +
        "ORDER BY started_at DESC " +
        "LIMIT 1"
      ).bind(wixSubId, userEmail);
    } else if (wixSubId) {
      wixQuery = db.prepare(
        "SELECT wix_subscription_id, tier, amount_cents, frequency, next_expected_at, status, migration_status, email " +
        "FROM wix_subscription " +
        "WHERE wix_subscription_id = ? " +
        "  AND status = 'active' " +
        "  AND migration_status = 'pending' " +
        "ORDER BY started_at DESC " +
        "LIMIT 1"
      ).bind(wixSubId);
    } else {
      wixQuery = db.prepare(
        "SELECT wix_subscription_id, tier, amount_cents, frequency, next_expected_at, status, migration_status, email " +
        "FROM wix_subscription " +
        "WHERE email = ? COLLATE NOCASE " +
        "  AND status = 'active' " +
        "  AND migration_status = 'pending' " +
        "ORDER BY started_at DESC " +
        "LIMIT 1"
      ).bind(userEmail);
    }
    return await wixQuery.first();
  } catch {
    env.EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', 'lookup-error', '', ''],
      indexes: ['stuc-migration-lookup-error'],
    });
    return null;
  }
}

/**
 * Standard STUC price points (cents). Amounts outside this set are "off-amount".
 */
const STANDARD_CENTS = new Set([900, 1900, 9900]);

/**
 * Derive whether a non-standard amount is in use.
 */
export function isCustomAmount(wixLookup) {
  return !STANDARD_CENTS.has(wixLookup.amount_cents);
}

/**
 * Off-amount rows are a permanent, hard refusal -- no custom-amount migration
 * path exists (all 52 live wix_subscription rows are 900/1900/9900 cents;
 * an off-amount row is a data anomaly, never a legitimate donor state). We
 * never build an ad-hoc Stripe price for one.
 *
 * Returns null if the amount is standard.
 * Returns the 409 response body object (not a Response) if the caller must reject.
 * Caller pattern: const offResp = validateOffAmount(wixLookup); if (offResp) return json(offResp, 409);
 */
export function validateOffAmount(wixLookup) {
  if (!isCustomAmount(wixLookup)) return null;
  return {
    ok: false,
    error: 'off_amount',
    amount_cents: wixLookup.amount_cents,
    message: 'This membership amount requires manual assistance to migrate. Please contact administrator@rrmacademy.org.',
    standard_tiers: [
      { tier: 'member',    amount_cents: 900 },
      { tier: 'hero',      amount_cents: 1900 },
      { tier: 'superhero', amount_cents: 9900 },
    ],
  };
}

/**
 * Non-MONTH rows are a permanent, hard refusal -- the migration flow only
 * knows how to hand off to a monthly Stripe subscription. Without this guard
 * an annual Wix donor could be silently re-billed monthly on Stripe.
 *
 * Returns null if frequency is 'MONTH'.
 * Returns the 409 response body object (not a Response) if the caller must reject.
 * Caller pattern: const freqResp = validateFrequency(wixLookup); if (freqResp) return json(freqResp, 409);
 */
export function validateFrequency(wixLookup) {
  if (wixLookup.frequency === 'MONTH') return null;
  return {
    ok: false,
    error: 'unsupported_frequency',
    frequency: wixLookup.frequency,
    message: 'This membership frequency requires manual assistance to migrate. Please contact administrator@rrmacademy.org.',
  };
}

/**
 * Atomic write-lock with 15-min TTL.
 *
 * Returns:
 *   { acquired: true }                                    -- lock acquired; caller continues
 *   { acquired: false, response: <Response 409> }         -- already locked; caller returns response
 *   { acquired: false, response: <Response 503> }         -- DB error; caller returns response
 */
export async function acquireMigrationHandoffLock(db, wixSubscriptionId, env, waitUntil) {
  let lockResult;
  try {
    lockResult = await db.prepare(
      "UPDATE wix_subscription " +
      "SET migration_handoff_started_at = strftime('%s','now') " +
      "WHERE wix_subscription_id = ? " +
      "  AND (migration_handoff_started_at IS NULL " +
      "       OR migration_handoff_started_at < strftime('%s','now') - 900)"
    ).bind(wixSubscriptionId).run();
  } catch (lockErr) {
    log(env, waitUntil, 'billing', 'migration_lock_acquire_fail', 'error', lockErr.message, 0, 503);
    return {
      acquired: false,
      response: json({ ok: false, error: 'Service temporarily unavailable. Please try again.' }, 503),
    };
  }
  if ((lockResult?.meta?.changes ?? 0) === 0) {
    return {
      acquired: false,
      response: json({ ok: false, error: 'migration_in_progress' }, 409),
    };
  }
  return { acquired: true };
}

/**
 * Clamp the trial_end candidate to a usable range (1 day to ~2 years from now).
 *
 * Returns:
 *   { trialEndUnix: <number|null>, outOfRange: <boolean> }
 */
export function clampTrialEnd(wixLookup, env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const trialEndCandidate = wixLookup.next_expected_at
    ? Math.floor(new Date(wixLookup.next_expected_at).getTime() / 1000)
    : null;

  if (
    Number.isFinite(trialEndCandidate) &&
    trialEndCandidate > nowSec + 86400 &&
    trialEndCandidate < nowSec + 730 * 86400
  ) {
    return { trialEndUnix: trialEndCandidate, outOfRange: false };
  }

  if (trialEndCandidate !== null) {
    env.EVENTS?.writeDataPoint({
      blobs: ['billing', 'stuc-migration', 'trial-end-out-of-range', wixLookup.wix_subscription_id, String(trialEndCandidate)],
      indexes: ['trial-end-out-of-range'],
    });
    return { trialEndUnix: null, outOfRange: true };
  }

  return { trialEndUnix: null, outOfRange: false };
}

/**
 * Check whether the Stripe customer already has a blocking subscription.
 *
 * Returns null if no blocker, or { response: <Response 409> } if blocked.
 * Throws-through for Stripe API errors so caller can wrap in try/catch with appropriate logging.
 */
export async function findBlockingActiveSubscription(stripe, stripeCustomerId, env, waitUntil) {
  if (!stripeCustomerId) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  let blocking = null;
  try {
    for await (const s of stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all', limit: 100 })) {
      if (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due' || s.status === 'incomplete') {
        blocking = s;
        break;
      }
      // Cancellation pending — sub still has access through current period
      if (s.cancel_at_period_end && s.current_period_end && s.current_period_end > nowSec) {
        blocking = s;
        break;
      }
    }
  } catch (err) {
    log(env, waitUntil, 'billing', 'subscriptions_list_error', 'error', `stripe subscriptions.list: ${err.message}`, 0, 503);
    return {
      response: json({ ok: false, error: 'Payment service temporarily unavailable. Please try again.' }, 503),
    };
  }

  if (!blocking) return null;

  const msg = blocking.status === 'past_due'
    ? 'You have a membership with a payment issue. Please update your payment method from your account page.'
    : blocking.status === 'incomplete'
      ? 'You have a pending membership checkout. Please complete or cancel it before starting a new one.'
      : 'You already have an active membership. You can change or cancel it from your account page.';
  return {
    response: json({ ok: false, error: msg, redirect: '/account/' }, 409),
  };
}
