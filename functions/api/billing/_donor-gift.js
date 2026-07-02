/**
 * Donor data layer (Phase 1). Prefixed with _ so CF Pages doesn't treat it as a route.
 * donor_gift is a CRM mirror, never accounting truth: the Foundation Google Sheet
 * ledger remains the 990 SSOT.
 *
 * Exports:
 *   recordDonorGift(db, gift)                      -- idempotent insert + contact rollup recompute
 *   recomputeContactRollups(db, email)             -- rollup recompute from donor_gift (derived state)
 *   giftFromCheckoutSession(session, epoch, env?, waitUntil?)  -- map Stripe checkout.session.completed
 *                                                     -> gift (or null; missing payment_intent skips --
 *                                                     the rrm-observatory daemon owns cs_-keyed sweep)
 *   deriveStage(aggregates, nowMs)                 -- donor_stage from per-email aggregates
 *   MAJOR_DONOR_DOLLARS, RECURRING_LAPSE_DAYS      -- stage thresholds
 *
 * ORDERING: the donor_gift backfill (incl. legacy total_donated snapshot rows) MUST
 * complete before this writer goes live; recompute derives total_donated solely from
 * donor_gift and would clobber legacy history otherwise.
 *
 * Writer conventions are pinned in migrations/030-donor-gift.sql and are binding.
 * The rrm-observatory daemon `donor-gift-feed` duplicates the insert + stage rules
 * (cross-repo, cannot import). Keep MAJOR_DONOR_DOLLARS / RECURRING_LAPSE_DAYS in sync.
 */

import { log } from '../_log.js';

export const MAJOR_DONOR_DOLLARS = 500;
export const RECURRING_LAPSE_DAYS = 45;

/** Stage from per-email aggregates. Aggregates exclude kind='course' and refunded rows. */
export function deriveStage({ giftCount, donatedCents, lastRecurringAt }, nowMs = Date.now()) {
  if (donatedCents >= MAJOR_DONOR_DOLLARS * 100) return 'major';
  if (lastRecurringAt) {
    const lapsed = nowMs - Date.parse(lastRecurringAt) > RECURRING_LAPSE_DAYS * 86400e3;
    return lapsed ? 'lapsed' : 'recurring';
  }
  return giftCount >= 2 ? 'repeat' : 'first_time';
}

/**
 * Map a Stripe checkout.session.completed donation to a gift, or null if not a one-time
 * donation. `env`/`waitUntil` are optional and used only to log the payment_intent-missing
 * skip (see below) to Analytics Engine; callers that omit them simply skip silently.
 */
export function giftFromCheckoutSession(session, eventCreatedEpoch, env, waitUntil) {
  if (session.mode !== 'payment') return null;
  const type = session.metadata?.type;
  if (type && type !== 'donation') return null; // mirrors the GA4 donation branch (_webhook-checkout.js)
  if (!session.payment_intent) {
    // rrm-observatory's donor-gift-feed daemon keys donor_gift rows on payment_intent (pi_).
    // Falling back to the checkout session id (cs_) here would double-record the same
    // donation under a different source_id once the daemon sweeps the Stripe charge. Skip
    // and let the pi_-keyed daemon own it.
    if (env && waitUntil) {
      log(env, waitUntil, 'billing', 'donor_gift_record', 'skipped', `no_payment_intent session=${session.id}`);
    }
    return null;
  }
  return {
    email: session.customer_details?.email || session.customer_email || '',
    displayName: session.customer_details?.name || '',
    amountCents: session.amount_total || 0,
    source: 'stripe',
    sourceId: String(session.payment_intent),
    entity: 'foundation',
    kind: 'one_time',
    ppgf: 0,
    occurredAt: new Date((eventCreatedEpoch || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

/**
 * Normalize a timestamp to UTC ISO-8601, or null when unparseable. Space-separated
 * SQLite-style strings ('2026-06-11 12:00:00') are pinned to UTC before parsing:
 * V8's Date.parse treats them as LOCAL time, which would skew occurred_at by the
 * machine timezone.
 */
function toIsoUtc(value) {
  let s = value;
  if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
    s = value.replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(value) ? '' : 'Z');
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

const AGGREGATE_SQL = `
  SELECT
    COALESCE(SUM(amount_cents), 0) AS donated_cents,
    MIN(occurred_at) AS first_gift_at,
    MAX(occurred_at) AS last_gift_at,
    COUNT(*) AS gift_count,
    MAX(CASE WHEN kind IN ('recurring','membership') THEN occurred_at END) AS last_recurring_at
  FROM donor_gift
  WHERE email = ? COLLATE NOCASE AND refunded_at IS NULL
    AND kind IN ('one_time','recurring','membership')`;

/**
 * Recompute a contact's donor rollups from donor_gift (derived state, safe to
 * re-run any time), then backlink any donor_gift rows still missing contact_id.
 * Aggregates exclude kind='course' and refunded rows.
 */
export async function recomputeContactRollups(db, email) {
  const agg = await db.prepare(AGGREGATE_SQL).bind(email).first();
  const stage = deriveStage({
    giftCount: agg?.gift_count || 0,
    donatedCents: agg?.donated_cents || 0,
    lastRecurringAt: agg?.last_recurring_at || null,
  });
  await db.prepare(
    `UPDATE contact SET
       total_donated = ?, first_gift_at = ?, last_gift_at = ?, gift_count = ?, donor_stage = ?,
       updated_at = datetime('now')
     WHERE email = ? COLLATE NOCASE`
  ).bind((agg?.donated_cents || 0) / 100, agg?.first_gift_at || null, agg?.last_gift_at || null,
         agg?.gift_count || 0, stage, email).run();

  await db.prepare(
    `UPDATE donor_gift SET contact_id = (SELECT id FROM contact WHERE email = ? COLLATE NOCASE)
     WHERE email = ? COLLATE NOCASE AND contact_id IS NULL`
  ).bind(email, email).run();
}

/**
 * Idempotently record a gift and recompute the contact's donor rollups.
 * Returns { recorded, reason?|id? }; DB errors propagate to the caller, which must
 * not leak err.message to the client (sibling pattern: log + generic error response).
 *
 * Sequential statements (not db.batch) are intentional: the ON CONFLICT DO NOTHING
 * insert is the atomic dedupe gate; rollups are derived state recomputed from
 * donor_gift on every event and by the daily daemon, so a mid-sequence failure
 * self-heals on next run. (arise-ignore unbatched-writes)
 */
export async function recordDonorGift(db, gift) {
  const email = String(gift.email || '').trim().toLowerCase().slice(0, 320);
  if (!email || !email.includes('@')) return { recorded: false, reason: 'no_email' };
  const amountCents = Math.round(Number(gift.amountCents) || 0);
  if (amountCents <= 0) return { recorded: false, reason: 'non_positive_amount' };
  if (!gift.sourceId) return { recorded: false, reason: 'no_source_id' };
  const occurredAt = toIsoUtc(gift.occurredAt);
  if (!occurredAt) return { recorded: false, reason: 'bad_occurred_at' };
  const displayName = String(gift.displayName || '').trim().slice(0, 200);

  const id = 'dg_' + crypto.randomUUID();
  const ins = await db.prepare(
    `INSERT INTO donor_gift
       (id, email, display_name, amount_cents, currency, source, source_id, entity, kind, ppgf, occurred_at, receipt_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(strftime('%Y', ?) AS INTEGER))
     ON CONFLICT(source, source_id) DO NOTHING`
  ).bind(
    id, email, displayName || null, amountCents, gift.currency || 'USD',
    gift.source, String(gift.sourceId), gift.entity || 'foundation', gift.kind || 'one_time',
    gift.ppgf ? 1 : 0, occurredAt, occurredAt
  ).run();
  if (ins.meta.changes === 0) {
    // Stripe retries the webhook on prior 5xx: the gift row may exist while the
    // rollups from that interrupted run are stale. Recompute heals them.
    await recomputeContactRollups(db, email);
    return { recorded: false, reason: 'duplicate' };
  }

  const [first = '', ...restName] = displayName.split(/\s+/);
  await db.prepare(
    `INSERT INTO contact (id, email, first_name, last_name, source, first_seen_at)
     VALUES (?, ?, ?, ?, 'donor-gift', ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = COALESCE(NULLIF(excluded.first_name, ''), first_name),
       last_name = COALESCE(NULLIF(excluded.last_name, ''), last_name)`
  ).bind(crypto.randomUUID(), email, first, restName.join(' '), occurredAt).run();

  await recomputeContactRollups(db, email);

  return { recorded: true, id };
}
