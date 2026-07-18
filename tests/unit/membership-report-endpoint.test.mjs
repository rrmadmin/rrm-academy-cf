import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../../functions/api/admin/membership-report.js';

function mockEnv(overrides = {}) {
  const d1Rows = overrides.d1Rows || { roster: [], donorAgg: [], trend: [], lapse: [] };
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (overrides.d1Throw) throw new Error('d1 down');
          if (/FROM wix_subscription|STUC_MEMBER_WHERE|has_stripe/.test(sql)) return { results: d1Rows.roster };
          if (/donor_gift/.test(sql)) return { results: d1Rows.donorAgg };
          return { results: [] };
        },
        async first() { return d1Rows.first || { c: 0 }; },
      };
    },
  };
  return { DB, ADMIN_API_SECRET: 'secret123', STRIPE_RESTRICTED_KEY: 'rk_test', ...overrides.env };
}

function req(url, headers = {}) { return new Request(url, { headers }); }

test('no auth -> 401', async () => {
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report'), env: mockEnv() });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('bearer wrong -> 401; correct -> 200 with no-store', async () => {
  const bad = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer nope' }), env: mockEnv() });
  assert.equal(bad.status, 401);
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  const ok = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: mockEnv() });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
});

test('bad month -> 400', async () => {
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report?month=2026-13', { Authorization: 'Bearer secret123' }), env: mockEnv() });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('stripe unreachable -> 200 degraded, delta null', async () => {
  globalThis.fetch = async () => { throw new Error('network'); };
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: mockEnv() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.headline.degraded, true);
  assert.equal(body.headline.delta_vs_prior_month_cents, null);
  assert.equal(body.stuc.stripe_unavailable, true);
  // mom is D1-derived, so it survives Stripe degradation as a well-formed block.
  assert.ok(body.headline.mom);
  assert.equal(typeof body.headline.mom.month_in_progress, 'boolean');
  assert.ok(Number.isInteger(body.headline.mom.receipts_this_month_cents));
});

function etMonthParts(offsetMonths = 0) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' });
  const p = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  let y = Number(p.year), m = Number(p.month) + offsetMonths;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function momMockEnv() {
  const curYm = etMonthParts(0);
  const priorYm = etMonthParts(-1);
  const trendRows = [
    { ym: priorYm, stuc_cents: 56800, foundation_cents: 0, academy_cents: 0 },
    { ym: curYm, stuc_cents: 39700, foundation_cents: 0, academy_cents: 0 },
  ];
  const momSupporters = [
    { email: 'donor1@x.com', bucket: 'this' },
    { email: 'donorp@x.com', bucket: 'prior' },
    { email: 'donor1@x.com', bucket: 'prior' },
  ];
  const roster = [{
    id: 'u1', email: 'roster@x.com', role: 'member', is_staff: 0,
    has_legacy: 0, has_stripe: 0, has_wix: 1, wix_tier: 'member', wix_amount_cents: 900,
  }];
  const wixAnticipate = [{
    email: 'roster@x.com', amount_cents: 900,
    next_renewal: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  }];
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (/frequency='MONTH'/.test(sql)) return { results: wixAnticipate };
          if (/CASE WHEN occurred_at >= \?2 THEN 'this'/.test(sql)) return { results: momSupporters };
          if (/strftime\('%Y-%m', occurred_at\) AS ym/.test(sql)) return { results: trendRows };
          if (/has_stripe/.test(sql)) return { results: roster };
          return { results: [] };
        },
        async first() { return { c: 0 }; },
      };
    },
  };
  return { DB, ADMIN_API_SECRET: 'secret123', STRIPE_RESTRICTED_KEY: 'rk_test' };
}

test('mom: current month is in progress, like-for-like receipts, roster union, anticipated present', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: momMockEnv() });
  assert.equal(res.status, 200);
  const body = await res.json();
  const mom = body.headline.mom;
  assert.equal(mom.month_in_progress, true);
  assert.equal(mom.receipts_this_month_cents, 39700);
  assert.equal(mom.receipts_prior_month_cents, 56800);
  // supporters_this_month = distinct donor_gift givers this month UNION paying
  // roster: {donor1@x.com} + {roster@x.com} = 2.
  assert.equal(mom.supporters_this_month, 2);
  assert.equal(mom.supporters_prior_month, 2);
  // in-progress month carries a date-aware anticipated estimate >= collected.
  assert.ok(Number.isInteger(mom.receipts_anticipated_cents));
  assert.ok(mom.receipts_anticipated_cents >= 39700);
});

test('mom: a completed past month is not in progress and has no anticipated value', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  const priorYm = etMonthParts(-1);
  const res = await onRequestGet({ request: req(`https://x/api/admin/membership-report?month=${priorYm}`, { Authorization: 'Bearer secret123' }), env: momMockEnv() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.headline.mom.month_in_progress, false);
  assert.equal(body.headline.mom.receipts_anticipated_cents, null);
  assert.equal(body.headline.mom.receipts_this_month_cents, 56800);
});

test('new_recurring and lapsed_recurring foundation donors land in the right arrays', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (/HAVING MIN\(d\.occurred_at\)/.test(sql)) {
            return { results: [{ email: 'new.donor@x.com', display_name: 'New Donor', amount_cents: 2500 }] };
          }
          if (/ORDER BY last_gift_at ASC/.test(sql)) {
            return { results: [{ email: 'lapsed.donor@x.com', display_name: 'Lapsed Donor', last_gift_at: '2020-01-01T00:00:00.000Z' }] };
          }
          if (/FROM wix_subscription|STUC_MEMBER_WHERE|has_stripe/.test(sql)) return { results: [] };
          if (/donor_gift/.test(sql)) return { results: [] };
          return { results: [] };
        },
        async first() { return { c: 0 }; },
      };
    },
  };
  const env = { DB, ADMIN_API_SECRET: 'secret123', STRIPE_RESTRICTED_KEY: 'rk_test' };
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.foundation.new_recurring.length, 1);
  assert.equal(body.foundation.new_recurring[0].email, 'new.donor@x.com');
  assert.equal(body.foundation.new_recurring[0].amount_cents, 2500);
  assert.equal(body.foundation.lapsed_recurring.length, 1);
  assert.equal(body.foundation.lapsed_recurring[0].email, 'lapsed.donor@x.com');
  assert.ok(body.foundation.lapsed_recurring[0].days_since_last > 45);
  assert.ok(body.actions.some((a) => a.who === 'Naomi' && a.what.includes('Lapsed Donor')));
});

test('d1 down -> 500', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  const res = await onRequestGet({ request: req('https://x/api/admin/membership-report', { Authorization: 'Bearer secret123' }), env: mockEnv({ d1Throw: true }) });
  assert.equal(res.status, 500);
});
