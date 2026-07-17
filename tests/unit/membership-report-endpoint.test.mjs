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
