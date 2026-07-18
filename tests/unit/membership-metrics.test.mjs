import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthBoundsET, validateMonthParam, partitionRoster, invoiceDropout,
  isDunningDropout, parseDbTs, subStartEpochMs, computeLapsed, centsInt, assembleReport,
  anticipatedRenewalsCents,
  KNOWN_PAUSED, LAPSE_MAX_DAYS, NEW_MEMBER_GRACE_DAYS,
} from '../../functions/api/admin/_membership-metrics.js';

test('monthBoundsET returns ET-anchored UTC boundaries (EDT month)', () => {
  const b = monthBoundsET('2026-07');
  // July 1 00:00 ET (EDT, -4) = 04:00 UTC; Aug 1 00:00 EDT = 04:00 UTC.
  assert.equal(b.startUtc, '2026-07-01T04:00:00.000Z');
  assert.equal(b.endUtc, '2026-08-01T04:00:00.000Z');
  assert.equal(b.prevStartUtc, '2026-06-01T04:00:00.000Z');
  assert.equal(b.prevEndUtc, b.startUtc);
  assert.equal(b.label, '2026-07');
});

test('monthBoundsET handles the EST->EDT boundary month (Jan, -5)', () => {
  const b = monthBoundsET('2026-01');
  assert.equal(b.startUtc, '2026-01-01T05:00:00.000Z'); // EST offset -5
  assert.equal(b.endUtc, '2026-02-01T05:00:00.000Z');
});

test('validateMonthParam defaults to current ET month when raw is null', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  assert.equal(validateMonthParam(null, now), '2026-07');
});

test('validateMonthParam rejects malformed, future, and >24-months-back', () => {
  const now = Date.parse('2026-07-15T12:00:00Z');
  assert.equal(validateMonthParam('2026-13', now), null);
  assert.equal(validateMonthParam('garbage', now), null);
  assert.equal(validateMonthParam('2026-08', now), null);       // future
  assert.equal(validateMonthParam('2024-06', now), null);       // 25 months back
  assert.equal(validateMonthParam('2024-07', now), '2024-07');  // exactly 24 back OK
});

test('partitionRoster is mutually exclusive with staff>legacy>stripe>wix precedence', () => {
  const rows = [
    { role: 'superadmin', has_stripe: 1, has_legacy: 0, has_wix: 1 }, // staff wins
    { role: 'member', has_stripe: 0, has_legacy: 1, has_wix: 1 },     // legacy wins over wix
    { role: 'member', has_stripe: 1, has_legacy: 0, has_wix: 1 },     // stripe wins over wix (mid-migration)
    { role: 'member', has_stripe: 0, has_legacy: 0, has_wix: 1 },     // wix
  ];
  const p = partitionRoster(rows);
  assert.equal(p.staff_count, 1);
  assert.equal(p.legacy_count, 1);
  assert.equal(p.stripe_count, 1);
  assert.equal(p.wix_count, 1);
  // Partition invariant (spec, test-asserted):
  assert.equal(p.wix_count + p.stripe_count + p.legacy_count + p.staff_count, p.rosterTotal);
  assert.equal(p.rosterTotal, rows.length);
});

test('invoiceDropout matches voided/uncollectible with nothing paid, skips $0 create', () => {
  assert.equal(invoiceDropout({ latest_invoice: { status: 'void', amount_paid: 0 } }), true);
  assert.equal(invoiceDropout({ latest_invoice: { status: 'uncollectible', amount_paid: 0 } }), true);
  assert.equal(invoiceDropout({ latest_invoice: 'in_123' }), false); // unexpanded string = healthy
  assert.equal(invoiceDropout({ latest_invoice: { status: 'paid', amount_paid: 900 } }), false);
  assert.equal(invoiceDropout({ latest_invoice: { status: 'void', amount_paid: 0, billing_reason: 'subscription_create', amount_due: 0 } }), false);
});

test('isDunningDropout flags past_due and unpaid only', () => {
  assert.equal(isDunningDropout({ status: 'past_due' }), true);
  assert.equal(isDunningDropout({ status: 'unpaid' }), true);
  assert.equal(isDunningDropout({ status: 'active' }), false);
});

test('subStartEpochMs: start_date wins over created, seconds -> ms, missing both -> NaN', () => {
  assert.equal(subStartEpochMs({ start_date: 1751328000, created: 1700000000 }), 1751328000000);
  assert.equal(subStartEpochMs({ created: 1700000000 }), 1700000000000);
  assert.ok(Number.isNaN(subStartEpochMs({})));
  assert.ok(Number.isNaN(subStartEpochMs(undefined)));
});

test('parseDbTs normalizes ISO and SQLite space formats', () => {
  assert.equal(parseDbTs('2026-07-01T00:00:00.000Z'), Date.parse('2026-07-01T00:00:00.000Z'));
  assert.equal(parseDbTs('2026-07-01 00:00:00'), Date.parse('2026-07-01T00:00:00Z'));
  assert.ok(Number.isNaN(parseDbTs('')));
});

test('computeLapsed flags >45d gifts, respects grace + KNOWN_PAUSED', () => {
  const now = Date.parse('2026-07-16T12:00:00Z');
  const giftRows = [
    { email: 'lapsed@x.com', last_gift_at: '2026-05-01T00:00:00Z', created_at: '2025-01-01 00:00:00' }, // 76d -> flag
    { email: 'fresh@x.com', last_gift_at: '2026-07-10T00:00:00Z', created_at: '2025-01-01 00:00:00' },  // recent -> ok
    { email: 'vjgbergin@gmail.com', last_gift_at: '2026-01-01T00:00:00Z', created_at: '2025-01-01 00:00:00' }, // paused -> skip
    { email: 'newnogift@x.com', last_gift_at: null, created_at: '2026-07-14 00:00:00' }, // within 14d grace -> ok
    { email: 'oldnogift@x.com', last_gift_at: null, created_at: '2025-01-01 00:00:00' }, // no gift, past grace -> flag
  ];
  const flagged = computeLapsed({ giftRows, subStartByEmail: new Map(), nowMs: now });
  const emails = flagged.map(f => f.email).sort();
  assert.deepEqual(emails, ['lapsed@x.com', 'oldnogift@x.com']);
  assert.ok(KNOWN_PAUSED.some((e) => e.email === 'vjgbergin@gmail.com' && e.name === 'Victoria Bergin'));
});

test('computeLapsed suppresses >45d flag when a newer Stripe sub is within grace', () => {
  const now = Date.parse('2026-07-16T12:00:00Z');
  const giftRows = [{ email: 'resub@x.com', last_gift_at: '2026-05-01T00:00:00Z', created_at: '2024-01-01 00:00:00' }];
  const subStartByEmail = new Map([['resub@x.com', Date.parse('2026-07-10T00:00:00Z')]]);
  const flagged = computeLapsed({ giftRows, subStartByEmail, nowMs: now });
  assert.equal(flagged.length, 0);
});

test('assembleReport emits the full schema with integer cents and partition invariant', () => {
  const rep = assembleReport({
    generatedAt: '2026-08-01T12:30:00.000Z',
    month: '2026-07',
    rosterRows: [
      { role: 'member', has_stripe: 1, has_legacy: 0, has_wix: 0, tier: 'member', monthly_cents: 900 },
      { role: 'member', has_stripe: 0, has_legacy: 0, has_wix: 1, tier: 'superhero', monthly_cents: 9900 },
      // Staff row with nonzero monthly_cents: must NOT leak into revenue totals.
      { role: 'admin', has_stripe: 0, has_legacy: 0, has_wix: 0, tier: null, monthly_cents: 9900 },
      // Legacy (complimentary) row with nonzero monthly_cents: counts in
      // legacy_count only, never in revenue or active_by_tier.
      { role: 'member', has_stripe: 0, has_legacy: 1, has_wix: 0, tier: 'member', monthly_cents: 900 },
    ],
    priorRecurringCents: 9900,
    supporterEmails: ['a@x.com', 'A@x.com', 'b@x.com'],
    joined: [{ name: 'A', email: 'a@x.com', tier: 'member', joined_at: '2026-07-05T00:00:00Z' }],
    left: [{ name: 'B', email: 'b@x.com', reason: 'canceled' }],
    watchlist: [{ name: 'C', email: 'c@x.com', kind: 'voided_invoice', action: 'Cancel the subscription in Stripe.' }],
    knownPaused: [{ name: 'Victoria Bergin', note: 'paused / comped' }],
    foundation: { one_time_this_month_cents: 5000, recurring_this_month_cents: 2500, ytd_cents: 120000, new_recurring: [], lapsed_recurring: [], ppgf_this_month_cents: 1000 },
    academy: { course_purchases_this_month: 2, course_revenue_this_month_cents: 20000, ytd_purchases: 9, ytd_cents: 90000 },
    actions: [{ text: 'Follow up with C', who: 'Naomi', source: 'watchlist' }],
    trend: [{ month: '2025-08', stuc_cents: 100, foundation_cents: 200, academy_cents: 0 }],
    mom: {
      receipts_this_month_cents: 39700,
      receipts_prior_month_cents: 56800,
      receipts_anticipated_cents: 48000,
      supporters_this_month: 39,
      supporters_prior_month: 41,
      month_in_progress: true,
    },
    stripeUnavailable: false,
  });
  // required top-level keys
  for (const k of ['generated_at','month','headline','stuc','foundation','academy','actions','trend']) {
    assert.ok(k in rep, `missing key ${k}`);
  }
  // total_supporters dedups lowercased email (a@x.com == A@x.com) -> 2 distinct
  assert.equal(rep.headline.total_supporters, 2);
  // recurring_monthly_cents = paying branches only (900 + 9900), integer.
  // The staff row (9900) and legacy row (900) carry nonzero monthly_cents but
  // must not leak into the total.
  assert.equal(rep.headline.recurring_monthly_cents, 10800);
  assert.ok(Number.isInteger(rep.headline.recurring_monthly_cents));
  assert.equal(rep.headline.delta_vs_prior_month_cents, 10800 - 9900);
  assert.equal(rep.headline.delta_basis, 'prior_month_membership_receipts');
  assert.equal(rep.headline.degraded, false);
  // partition invariant on the response: stripe=1, wix=1, staff=1, legacy=1
  const s = rep.stuc;
  assert.equal(s.stripe_count, 1);
  assert.equal(s.wix_count, 1);
  assert.equal(s.staff_count, 1);
  assert.equal(s.legacy_count, 1);
  assert.equal(s.wix_count + s.stripe_count + s.legacy_count + s.staff_count, 4);
  // active_by_tier counts paying branches only: legacy 'member' row excluded
  assert.equal(s.active_by_tier.member, 1);
  assert.equal(s.active_by_tier.superhero, 1);
  assert.equal(s.active_by_tier.hero, 0);
  assert.equal(s.monthly_cents, 10800);
  assert.ok(Number.isInteger(s.monthly_cents));
  // Month-over-month block: like-for-like receipts (same series both months),
  // integer cents, date-aware anticipation, and the in-progress flag.
  assert.equal(rep.headline.mom.receipts_this_month_cents, 39700);
  assert.equal(rep.headline.mom.receipts_prior_month_cents, 56800);
  assert.equal(rep.headline.mom.receipts_anticipated_cents, 48000);
  assert.equal(rep.headline.mom.supporters_this_month, 39);
  assert.equal(rep.headline.mom.supporters_prior_month, 41);
  assert.equal(rep.headline.mom.month_in_progress, true);
  assert.ok(Number.isInteger(rep.headline.mom.receipts_this_month_cents));
});

test('assembleReport mom: completed month nulls anticipated and carries month_in_progress false', () => {
  const rep = assembleReport({
    generatedAt: '2026-08-01T12:30:00.000Z', month: '2026-07',
    rosterRows: [], priorRecurringCents: 0, supporterEmails: [], joined: [], left: [],
    watchlist: [], knownPaused: [],
    foundation: { one_time_this_month_cents: 0, recurring_this_month_cents: 0, ytd_cents: 0, new_recurring: [], lapsed_recurring: [], ppgf_this_month_cents: 0 },
    academy: { course_purchases_this_month: 0, course_revenue_this_month_cents: 0, ytd_purchases: 0, ytd_cents: 0 },
    actions: [], trend: [],
    mom: {
      receipts_this_month_cents: 56800,
      receipts_prior_month_cents: 40600,
      receipts_anticipated_cents: null,
      supporters_this_month: 41,
      supporters_prior_month: 38,
      month_in_progress: false,
    },
    stripeUnavailable: false,
  });
  assert.equal(rep.headline.mom.month_in_progress, false);
  assert.equal(rep.headline.mom.receipts_anticipated_cents, null);
  assert.equal(rep.headline.mom.receipts_this_month_cents, 56800);
  assert.equal(rep.headline.mom.supporters_prior_month, 38);
});

test('anticipatedRenewalsCents: in-window counts once, out-of-window zero, watchlist/paused excluded, stripe wins over wix', () => {
  const nowMs = Date.parse('2026-07-17T12:00:00Z');
  const monthEndMs = Date.parse('2026-08-01T04:00:00Z');
  // in-window renewal, counted once even if listed twice
  const inWindow = anticipatedRenewalsCents({
    candidates: [
      { email: 'a@x.com', amount_cents: 900, next_renewal_ms: Date.parse('2026-07-25T00:00:00Z'), source: 'wix' },
      { email: 'a@x.com', amount_cents: 900, next_renewal_ms: Date.parse('2026-07-26T00:00:00Z'), source: 'wix' },
    ],
    nowMs, monthEndMs, excludeEmails: new Set(),
  });
  assert.equal(inWindow, 900);
  // renewal after month end contributes nothing
  const outWindow = anticipatedRenewalsCents({
    candidates: [{ email: 'b@x.com', amount_cents: 4500, next_renewal_ms: Date.parse('2026-08-10T00:00:00Z'), source: 'stripe' }],
    nowMs, monthEndMs, excludeEmails: new Set(),
  });
  assert.equal(outWindow, 0);
  // a renewal already in the past (before now) contributes nothing
  const past = anticipatedRenewalsCents({
    candidates: [{ email: 'c@x.com', amount_cents: 4500, next_renewal_ms: Date.parse('2026-07-01T00:00:00Z'), source: 'wix' }],
    nowMs, monthEndMs, excludeEmails: new Set(),
  });
  assert.equal(past, 0);
  // watchlist / paused email excluded even though in-window
  const excluded = anticipatedRenewalsCents({
    candidates: [{ email: 'watch@x.com', amount_cents: 900, next_renewal_ms: Date.parse('2026-07-25T00:00:00Z'), source: 'stripe' }],
    nowMs, monthEndMs, excludeEmails: new Set(['watch@x.com']),
  });
  assert.equal(excluded, 0);
  // same email in both sources: Stripe amount wins (mid-migration precedence)
  const dedup = anticipatedRenewalsCents({
    candidates: [
      { email: 'd@x.com', amount_cents: 900, next_renewal_ms: Date.parse('2026-07-20T00:00:00Z'), source: 'wix' },
      { email: 'd@x.com', amount_cents: 4500, next_renewal_ms: Date.parse('2026-07-21T00:00:00Z'), source: 'stripe' },
    ],
    nowMs, monthEndMs, excludeEmails: new Set(),
  });
  assert.equal(dedup, 4500);
});

test('assembleReport degrades: stripeUnavailable nulls delta and flags degraded', () => {
  const rep = assembleReport({
    generatedAt: '2026-08-01T12:30:00.000Z', month: '2026-07',
    rosterRows: [], priorRecurringCents: 47800, supporterEmails: [], joined: [], left: [],
    watchlist: [], knownPaused: [],
    foundation: { one_time_this_month_cents: 0, recurring_this_month_cents: 0, ytd_cents: 0, new_recurring: [], lapsed_recurring: [], ppgf_this_month_cents: 0 },
    academy: { course_purchases_this_month: 0, course_revenue_this_month_cents: 0, ytd_purchases: 0, ytd_cents: 0 },
    actions: [], trend: [], stripeUnavailable: true,
  });
  assert.equal(rep.headline.degraded, true);
  assert.equal(rep.headline.delta_vs_prior_month_cents, null);
  assert.equal(rep.headline.delta_basis, 'prior_month_membership_receipts');
  assert.equal(rep.stuc.stripe_unavailable, true);
  // mom is D1-derived, so it is still a well-formed block when degraded.
  assert.equal(rep.headline.mom.receipts_this_month_cents, 0);
  assert.equal(rep.headline.mom.receipts_anticipated_cents, null);
  assert.equal(rep.headline.mom.month_in_progress, false);
});
