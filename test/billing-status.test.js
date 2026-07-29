/**
 * EXECUTED tests for GET /api/billing/status (functions/api/billing/status.js).
 *
 * These replace a source-text assertion in test/billing-source-invariants.test.js
 * that was named for a subscription-status invariant but only proved that the
 * strings 'displayable', 'active', 'trialing', 'past_due' and 'incomplete'
 * appeared somewhere in the file. Every one of those strings survives a rewrite
 * that hands a canceled subscription back to the account page, which is the
 * regression the test was written for. The endpoint is reachable -- a session
 * row, a user row and a stubbed Stripe list are all it needs -- so the property
 * is asserted on the response now, not on the file.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockDB, mockWaitUntil, parseResponse, stubExternalFetch, stripeRoutes, randomIp } from './_helpers.js';

const { onRequestGet } = await import('../functions/api/billing/status.js');

let net;
before(() => { net = stubExternalFetch(); });
after(() => { net.restore(); });

const FAR_FUTURE = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

function sub(status, overrides = {}) {
  return {
    id: `sub_${status}`,
    status,
    current_period_end: FAR_FUTURE,
    cancel_at_period_end: false,
    metadata: {},
    items: { data: [{ price: { id: 'price_member', nickname: status } }] },
    ...overrides,
  };
}

/**
 * Session + user rows, no Wix rows. Both wix_subscription lookups are keyed
 * ahead of the generic ones because mockDB returns the first substring match in
 * insertion order.
 */
function statusDb(extra = {}) {
  return mockDB({
    'FROM session s': { first: { id: 'sess_hashed', user_id: 'usr_1', expires_at: FAR_FUTURE, blocked: 0, role: 'member' } },
    'SELECT stripe_customer_id, email FROM user': { first: { stripe_customer_id: 'cus_1', email: 'ada@example.com' } },
    'FROM wix_subscription': { first: null },
    'FROM wix_payment': { all: { results: [] } },
    ...extra,
  });
}

async function getStatus(subscriptions, { charges = [] } = {}) {
  const stub = stubExternalFetch({
    stripe: stripeRoutes({
      '/v1/subscriptions': { object: 'list', data: subscriptions, has_more: false },
      '/v1/charges': { object: 'list', data: charges, has_more: false },
    }),
  });
  try {
    const db = statusDb();
    const response = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/billing/status',
        headers: { Cookie: 'session=sess_plaintext', 'CF-Connecting-IP': randomIp() },
      }),
      env: mockEnv({ DB: db, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_MEMBER: 'price_member' }),
      waitUntil: mockWaitUntil(),
    });
    return await parseResponse(response);
  } finally {
    stub.restore();
  }
}

describe('billing/status -- which subscription the account page is shown', () => {
  it('reports no subscription when every subscription Stripe returns is terminal', async () => {
    for (const terminal of ['canceled', 'incomplete_expired', 'unpaid']) {
      const parsed = await getStatus([sub(terminal)]);
      assert.equal(parsed.status, 200);
      assert.equal(
        parsed.body.subscription, null,
        `a ${terminal} subscription must not be presented as the member's current one`
      );
    }
  });

  it('picks the live subscription even when a terminal one is listed first', async () => {
    // Stripe lists newest-first, so a member who cancelled and resubscribed has
    // the dead row at data[0]. Falling back to data[0] showed them as canceled
    // while they were paying.
    const parsed = await getStatus([sub('canceled'), sub('active')]);
    assert.equal(parsed.body.subscription?.status, 'active');
    assert.equal(parsed.body.subscription.source, 'stripe');
    assert.equal(parsed.body.subscription.tier, 'member');
  });

  it('shows each live status the account page knows how to render', async () => {
    for (const status of ['active', 'trialing', 'past_due', 'incomplete']) {
      const parsed = await getStatus([sub(status)]);
      assert.equal(parsed.body.subscription?.status, status, `${status} must be displayed, not swallowed`);
    }
  });

  it('reports no subscription at all when Stripe returns an empty list', async () => {
    const parsed = await getStatus([]);
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.subscription, null);
  });
});
