// test/donor-gift.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordDonorGift, giftFromCheckoutSession, deriveStage } from '../functions/api/billing/_donor-gift.js';

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

describe('recordDonorGift', () => {
  it('inserts gift, upserts contact, recomputes rollups', async () => {
    const db = fakeDb([
      { changes: 1 },                                            // INSERT donor_gift
      { changes: 1 },                                            // INSERT contact ON CONFLICT DO NOTHING
      { row: { donated_cents: 1900, first_gift_at: GIFT.occurredAt, last_gift_at: GIFT.occurredAt, gift_count: 1, last_recurring_at: null } },
      { changes: 1 },                                            // UPDATE contact
      { changes: 1 },                                            // UPDATE donor_gift contact link
    ]);
    const res = await recordDonorGift(db, GIFT);
    assert.equal(res.recorded, true);
    assert.match(db.calls[0].sql, /INSERT INTO donor_gift/);
    assert.match(db.calls[0].sql, /ON CONFLICT\(source, source_id\) DO NOTHING/);
    assert.equal(db.calls[0].binds[1], 'donor@example.com');     // lowercased email
    assert.match(db.calls[1].sql, /ON CONFLICT\(email\) DO NOTHING/);
    assert.match(db.calls[2].sql, /refunded_at IS NULL/);        // rollup aggregates exclude refunds
    assert.match(db.calls[3].sql, /UPDATE contact SET/);
    assert.match(db.calls[3].sql, /COLLATE NOCASE/);
  });

  it('normalizes occurred_at to ISO T+Z before insert', async () => {
    const db = fakeDb([{ changes: 1 }, { changes: 1 }, { row: { donated_cents: 1900, gift_count: 1, first_gift_at: 'x', last_gift_at: 'x', last_recurring_at: null } }, { changes: 1 }, { changes: 1 }]);
    await recordDonorGift(db, { ...GIFT, occurredAt: '2026-06-11T12:00:00+02:00' });
    const bound = db.calls[0].binds[10];
    assert.equal(bound, '2026-06-11T10:00:00.000Z');
  });

  it('stops after duplicate gift (no contact writes)', async () => {
    const db = fakeDb([{ changes: 0 }]);
    const res = await recordDonorGift(db, GIFT);
    assert.deepEqual(res, { recorded: false, reason: 'duplicate' });
    assert.equal(db.calls.length, 1);
  });

  it('rejects missing email, bad amount, bad date without touching db', async () => {
    const db = fakeDb();
    assert.equal((await recordDonorGift(db, { ...GIFT, email: '' })).reason, 'no_email');
    assert.equal((await recordDonorGift(db, { ...GIFT, amountCents: 0 })).reason, 'non_positive_amount');
    assert.equal((await recordDonorGift(db, { ...GIFT, occurredAt: 'not-a-date' })).reason, 'bad_occurred_at');
    assert.equal(db.calls.length, 0);
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
