// test/donor-gift.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordDonorGift, recomputeContactRollups, giftFromCheckoutSession, deriveStage } from '../functions/api/billing/_donor-gift.js';

/** Minimal scriptable D1 stub: records every prepared SQL + binds, returns scripted results in order. */
function fakeDb(script = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      const next = script[i++] || {};
      return {
        bind(...args) { call.binds = args; return this; },
        async run() { return { meta: { changes: next.changes ?? 1 } }; },
        async first() { return next.row ?? null; },
        async all() { return { results: next.rows ?? [] }; },
      };
    },
  };
}

const GIFT = {
  email: 'Donor@Example.com', displayName: 'Jane Donor', amountCents: 1900,
  source: 'stripe', sourceId: 'pi_123', entity: 'foundation', kind: 'one_time',
  occurredAt: '2026-06-11T12:00:00.000Z',
};

const AGG_ROW = { donated_cents: 1900, first_gift_at: GIFT.occurredAt, last_gift_at: GIFT.occurredAt, gift_count: 1, last_recurring_at: null };

/** Scripted results for the happy path: insert, contact upsert, agg select, contact update, backlink. */
const FRESH_SCRIPT = () => [
  { changes: 1 },          // INSERT donor_gift
  { changes: 1 },          // INSERT contact ON CONFLICT DO UPDATE
  { row: { ...AGG_ROW } }, // aggregate SELECT
  { changes: 1 },          // UPDATE contact
  { changes: 1 },          // UPDATE donor_gift contact backlink
];

describe('recordDonorGift', () => {
  it('inserts gift, upserts contact, recomputes rollups', async () => {
    const db = fakeDb(FRESH_SCRIPT());
    const res = await recordDonorGift(db, GIFT);
    assert.equal(res.recorded, true);
    assert.match(db.calls[0].sql, /INSERT INTO donor_gift/);
    assert.match(db.calls[0].sql, /ON CONFLICT\(source, source_id\) DO NOTHING/);
    assert.equal(db.calls[0].binds[1], 'donor@example.com');     // lowercased email
    assert.match(db.calls[1].sql, /ON CONFLICT\(email\) DO UPDATE SET/);
    assert.match(db.calls[1].sql, /COALESCE\(NULLIF\(excluded\.first_name, ''\), first_name\)/); // fills empty names, never overwrites
    assert.match(db.calls[2].sql, /refunded_at IS NULL/);        // rollup aggregates exclude refunds
    assert.match(db.calls[2].sql, /kind IN \('one_time','recurring','membership'\)/); // ...and course purchases
    assert.match(db.calls[3].sql, /UPDATE contact SET/);
    assert.match(db.calls[3].sql, /COLLATE NOCASE/);
    assert.match(db.calls[4].sql, /UPDATE donor_gift SET contact_id/);
  });

  it('converts cents to dollars and derives donor_stage on the contact update', async () => {
    const db = fakeDb(FRESH_SCRIPT());
    await recordDonorGift(db, GIFT);
    assert.equal(db.calls[3].binds[0], 19);           // 1900 cents -> 19 dollars
    assert.equal(db.calls[3].binds[4], 'first_time'); // donor_stage from deriveStage
  });

  it('normalizes occurred_at to ISO T+Z before insert', async () => {
    const db = fakeDb(FRESH_SCRIPT());
    await recordDonorGift(db, { ...GIFT, occurredAt: '2026-06-11T12:00:00+02:00' });
    assert.equal(db.calls[0].binds[10], '2026-06-11T10:00:00.000Z');
  });

  it('treats space-separated occurred_at as UTC regardless of machine timezone', async () => {
    const db = fakeDb(FRESH_SCRIPT());
    await recordDonorGift(db, { ...GIFT, occurredAt: '2026-06-11 12:00:00' });
    assert.equal(db.calls[0].binds[10], '2026-06-11T12:00:00.000Z');
  });

  it('recomputes rollups on the duplicate path (webhook retry heals stale rollups) without a contact insert', async () => {
    const db = fakeDb([
      { changes: 0 },          // INSERT donor_gift hits ON CONFLICT
      { row: { ...AGG_ROW } }, // aggregate SELECT
      { changes: 1 },          // UPDATE contact
      { changes: 1 },          // UPDATE donor_gift contact backlink
    ]);
    const res = await recordDonorGift(db, GIFT);
    assert.deepEqual(res, { recorded: false, reason: 'duplicate' });
    assert.equal(db.calls.length, 4);
    assert.match(db.calls[1].sql, /SELECT/);
    assert.match(db.calls[1].sql, /refunded_at IS NULL/);
    assert.match(db.calls[2].sql, /UPDATE contact SET/);
    assert.match(db.calls[3].sql, /UPDATE donor_gift SET contact_id/);
    assert.ok(!db.calls.some((c) => /INSERT INTO contact/.test(c.sql))); // no contact insert on duplicates
  });

  it('rejects missing email, bad amount, missing source id, bad date without touching db', async () => {
    const db = fakeDb();
    assert.equal((await recordDonorGift(db, { ...GIFT, email: '' })).reason, 'no_email');
    assert.equal((await recordDonorGift(db, { ...GIFT, amountCents: 0 })).reason, 'non_positive_amount');
    assert.equal((await recordDonorGift(db, { ...GIFT, sourceId: undefined })).reason, 'no_source_id');
    assert.equal((await recordDonorGift(db, { ...GIFT, occurredAt: 'not-a-date' })).reason, 'bad_occurred_at');
    assert.equal(db.calls.length, 0);
  });
});

describe('recomputeContactRollups', () => {
  it('updates contact from the aggregate row and backlinks unlinked gifts', async () => {
    const db = fakeDb([
      { row: { donated_cents: 60000, first_gift_at: '2025-01-01T00:00:00.000Z', last_gift_at: '2026-06-01T00:00:00.000Z', gift_count: 3, last_recurring_at: null } },
      { changes: 1 },
      { changes: 1 },
    ]);
    await recomputeContactRollups(db, 'donor@example.com');
    assert.match(db.calls[0].sql, /kind IN \('one_time','recurring','membership'\)/);
    assert.match(db.calls[0].sql, /refunded_at IS NULL/);
    assert.deepEqual(db.calls[0].binds, ['donor@example.com']);
    assert.match(db.calls[1].sql, /UPDATE contact SET/);
    assert.deepEqual(db.calls[1].binds, [600, '2025-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', 3, 'major', 'donor@example.com']);
    assert.match(db.calls[2].sql, /UPDATE donor_gift SET contact_id/);
    assert.match(db.calls[2].sql, /contact_id IS NULL/);
    assert.deepEqual(db.calls[2].binds, ['donor@example.com', 'donor@example.com']);
  });
});

describe('giftFromCheckoutSession', () => {
  const base = {
    mode: 'payment', amount_total: 2500, payment_intent: 'pi_abc', id: 'cs_1',
    customer_details: { email: 'a@b.com', name: 'A B' }, metadata: { type: 'donation' },
  };
  it('maps a donation session', () => {
    const g = giftFromCheckoutSession(base, 1760000000);
    assert.equal(g.source, 'stripe');
    assert.equal(g.sourceId, 'pi_abc');
    assert.equal(g.amountCents, 2500);
    assert.equal(g.kind, 'one_time');
    assert.equal(g.occurredAt, new Date(1760000000 * 1000).toISOString());
  });
  it('skips recording when payment_intent is null (pi_-only dedup; daemon owns the sweep, 2026-07-02)', () => {
    const g = giftFromCheckoutSession({ ...base, payment_intent: null }, 1760000000);
    assert.equal(g, null);
  });
  it('treats missing metadata.type in payment mode as donation (matches GA4 branch)', () => {
    assert.ok(giftFromCheckoutSession({ ...base, metadata: {} }, 1760000000));
  });
  it('returns null for course and subscription sessions', () => {
    assert.equal(giftFromCheckoutSession({ ...base, metadata: { type: 'course' } }, 1), null);
    assert.equal(giftFromCheckoutSession({ ...base, mode: 'subscription' }, 1), null);
  });
});

describe('deriveStage', () => {
  const now = Date.now();
  it('major beats everything at >= $500', () => {
    assert.equal(deriveStage({ giftCount: 1, donatedCents: 50000, lastRecurringAt: null }, now), 'major');
  });
  it('recurring when a membership gift landed within 45 days', () => {
    const recent = new Date(now - 10 * 86400e3).toISOString();
    assert.equal(deriveStage({ giftCount: 3, donatedCents: 2700, lastRecurringAt: recent }, now), 'recurring');
  });
  it('lapsed when last recurring gift is older than 45 days', () => {
    const old = new Date(now - 60 * 86400e3).toISOString();
    assert.equal(deriveStage({ giftCount: 3, donatedCents: 2700, lastRecurringAt: old }, now), 'lapsed');
  });
  it('first_time then repeat for one-time donors', () => {
    assert.equal(deriveStage({ giftCount: 1, donatedCents: 500, lastRecurringAt: null }, now), 'first_time');
    assert.equal(deriveStage({ giftCount: 2, donatedCents: 1000, lastRecurringAt: null }, now), 'repeat');
  });
});
