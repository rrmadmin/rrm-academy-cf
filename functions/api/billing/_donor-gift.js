/**
 * Donor data layer (Phase 1). Prefixed with _ so CF Pages doesn't treat it as a route.
 * donor_gift is a CRM mirror, never accounting truth: the Foundation Google Sheet
 * ledger remains the 990 SSOT.
 *
 * Exports:
 *   recordDonorGift(db, gift)                      -- idempotent insert + contact rollup recompute
 *   giftFromCheckoutSession(session, epoch)        -- map Stripe checkout.session.completed -> gift (or null)
 *   deriveStage(aggregates, nowMs)                 -- donor_stage from per-email aggregates
 *   MAJOR_DONOR_DOLLARS, RECURRING_LAPSE_DAYS      -- stage thresholds
 *
 * Writer conventions are pinned in migrations/030-donor-gift.sql and are binding.
 * The rrm-observatory daemon `donor-gift-feed` duplicates the insert + stage rules
 * (cross-repo, cannot import). Keep MAJOR_DONOR_DOLLARS / RECURRING_LAPSE_DAYS in sync.
 */

export const MAJOR_DONOR_DOLLARS = 500;
export const RECURRING_LAPSE_DAYS = 45;

/** Stage from per-email aggregates. donatedCents excludes kind='course' and refunded rows. */
export function deriveStage({ giftCount, donatedCents, lastRecurringAt }, nowMs = Date.now()) {
  if (donatedCents >= MAJOR_DONOR_DOLLARS * 100) return 'major';
  if (lastRecurringAt) {
    const lapsed = nowMs - Date.parse(lastRecurringAt) > RECURRING_LAPSE_DAYS * 86400e3;
    return lapsed ? 'lapsed' : 'recurring';
  }
  return giftCount >= 2 ? 'repeat' : 'first_time';
}

/** Map a Stripe checkout.session.completed donation to a gift, or null if not a one-time donation. */
export function giftFromCheckoutSession(session, eventCreatedEpoch) {
  if (session.mode !== 'payment') return null;
  const type = session.metadata?.type;
  if (type && type !== 'donation') return null; // mirrors the GA4 donation branch (_webhook-checkout.js)
  return {
    email: session.customer_details?.email || session.customer_email || '',
    displayName: session.customer_details?.name || '',
    amountCents: session.amount_total || 0,
    source: 'stripe',
    sourceId: String(session.payment_intent || session.id),
    entity: 'foundation',
    kind: 'one_time',
    ppgf: 0,
    occurredAt: new Date((eventCreatedEpoch || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
}

const AGGREGATE_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN kind IN ('one_time','recurring','membership') THEN amount_cents ELSE 0 END), 0) AS donated_cents,
    MIN(occurred_at) AS first_gift_at,
    MAX(occurred_at) AS last_gift_at,
    COUNT(*) AS gift_count,
    MAX(CASE WHEN kind IN ('recurring','membership') THEN occurred_at END) AS last_recurring_at
  FROM donor_gift WHERE email = ? COLLATE NOCASE AND refunded_at IS NULL`;

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
  const email = String(gift.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { recorded: false, reason: 'no_email' };
  const amountCents = Math.round(Number(gift.amountCents) || 0);
  if (amountCents <= 0) return { recorded: false, reason: 'non_positive_amount' };
  const occurredMs = Date.parse(gift.occurredAt);
  if (!Number.isFinite(occurredMs)) return { recorded: false, reason: 'bad_occurred_at' };
  const occurredAt = new Date(occurredMs).toISOString();

  const id = 'dg_' + crypto.randomUUID();
  const ins = await db.prepare(
    `INSERT INTO donor_gift
       (id, email, display_name, amount_cents, currency, source, source_id, entity, kind, ppgf, occurred_at, receipt_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(strftime('%Y', ?) AS INTEGER))
     ON CONFLICT(source, source_id) DO NOTHING`
  ).bind(
    id, email, gift.displayName || null, amountCents, gift.currency || 'USD',
    gift.source, String(gift.sourceId), gift.entity || 'foundation', gift.kind || 'one_time',
    gift.ppgf ? 1 : 0, occurredAt, occurredAt
  ).run();
  if (ins.meta.changes === 0) return { recorded: false, reason: 'duplicate' };

  const [first = '', ...restName] = String(gift.displayName || '').trim().split(/\s+/);
  await db.prepare(
    `INSERT INTO contact (id, email, first_name, last_name, source, first_seen_at)
     VALUES (?, ?, ?, ?, 'donor-gift', ?)
     ON CONFLICT(email) DO NOTHING`
  ).bind(crypto.randomUUID(), email, first, restName.join(' '), occurredAt).run();

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
    `UPDATE donor_gift SET contact_id = (SELECT id FROM contact WHERE email = ? COLLATE NOCASE) WHERE id = ?`
  ).bind(email, id).run();

  return { recorded: true, id };
}
