/**
 * Execution test: a Stripe webhook purchase carries ft_* and click_id into the
 * conversion ledger from session.metadata ONLY -- the webhook request has
 * no browser cookies, so this proves the metadata replay (Task 6/7 of the
 * first-touch-attribution plan) is what lands the row, not an accidental
 * cookie fallback.
 *
 * Run: node --test test/webhook-checkout-ft-forward.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, drainWaitUntil, stubExternalFetch } from './_helpers.js';
import { sqliteD1, SCHEMA_SQL } from './_d1-sqlite.mjs';

const { handleCheckoutCompleted } = await import('../functions/api/billing/_webhook-checkout.js');

const LEDGER_SCHEMA_SQL =
  SCHEMA_SQL + '\n' +
  readFileSync(new URL('../migrations/036-conversion-ledger.sql', import.meta.url), 'utf8') + '\n' +
  readFileSync(new URL('../migrations/039-first-touch-attribution.sql', import.meta.url), 'utf8');

function ledgerD1() {
  return sqliteD1({ schemaSql: LEDGER_SCHEMA_SQL });
}

function purchaseRow(db) {
  return db._sqlite.prepare("SELECT * FROM conversion_event WHERE event = 'purchase' ORDER BY id DESC LIMIT 1").get();
}

let net;
before(() => { net = stubExternalFetch(); });
after(() => { net.restore(); });

describe('webhook purchase carries ft_* from Stripe metadata only', () => {
  it('a donation checkout.session.completed with ft_* metadata lands ft_* on the ledger row, with no cookies on the request', async () => {
    const db = ledgerD1();
    try {
      const env = mockEnv({ DB: db, CONVERSION_LEDGER: '1' });
      const waitUntil = mockWaitUntil();
      // No Cookie header at all -- Stripe's webhook request never carries one.
      const request = mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook' });
      const session = {
        id: 'cs_test_ft_forward',
        mode: 'payment',
        payment_intent: 'pi_test_ft_forward',
        amount_total: 2500,
        customer_details: { email: 'donor@example.com', name: 'Test Donor' },
        metadata: {
          type: 'donation',
          ga_source: 'google', ga_medium: 'cpc',
          ft_source: 'google', ft_medium: 'cpc', ft_campaign: 'q3_push',
          ft_landing: '/donate/', ft_at: '2026-09-01T00:00:00.000Z',
          click_id: 'EAIaIQtest',
        },
      };
      const event = { id: 'evt_test_ft_forward', created: Math.floor(Date.now() / 1000), data: { object: session } };

      await handleCheckoutCompleted(db, event, env, request, waitUntil);
      await drainWaitUntil(waitUntil);

      const row = purchaseRow(db);
      assert.ok(row, 'purchase row was not written');
      assert.equal(row.ft_source, 'google');
      assert.equal(row.ft_medium, 'cpc');
      assert.equal(row.ft_campaign, 'q3_push');
      assert.equal(row.ft_landing, '/donate/');
      assert.equal(row.click_id, 'EAIaIQtest');
      assert.equal(row.transaction_id, 'pi_test_ft_forward');
    } finally { db.close(); }
  });
});

// Routes globalThis.fetch by hostname for the Ads-upload tests below --
// captures {url, init} (not just the input) so a test can parse the ingest
// request body and assert on the actual payload, not merely a call count.
// Mirrors stubGoogleAdsFetch() in test/google-ads-conversion.test.js.
function stubGoogleAdsWebhookFetch() {
  const original = globalThis.fetch;
  const tokenCalls = [];
  const ingestCalls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('oauth2.googleapis.com')) {
      tokenCalls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.stub' }) };
    }
    if (url.includes('datamanager.googleapis.com')) {
      ingestCalls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ requestId: 'req-webhook-test' }), text: async () => '{}' };
    }
    throw new Error(`unrouted request to ${url}`);
  };
  return {
    tokenCalls,
    ingestCalls,
    restore() { globalThis.fetch = original; },
  };
}

function googleAdsWebhookEnv(db, overrides = {}) {
  return mockEnv({
    DB: db, CONVERSION_LEDGER: '1',
    GOOGLE_ADS_CLIENT_ID: 'id', GOOGLE_ADS_CLIENT_SECRET: 'secret', GOOGLE_ADS_REFRESH_TOKEN: 'token',
    AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined,
    ...overrides,
  });
}

describe('webhook purchase triggers the Google Ads value upload', () => {
  // DONATION_CONVERSION_ACTION_ID / STUC_PURCHASE_CONVERSION_ACTION_ID are
  // still Task 9's 'PENDING_TASK_9' placeholder (the live Ads account has no
  // matching conversion action yet). sendGoogleAdsValueConversion's
  // placeholder guard makes this call a logged no-op -- zero Data Manager
  // ingest calls, not one -- as long as neither env override below is set.
  it('a donation with gclid_last metadata is a no-op while the donation action id is still PENDING_TASK_9', async (t) => {
    const stub = stubGoogleAdsWebhookFetch();
    t.after(() => stub.restore());

    const db = ledgerD1();
    try {
      const env = googleAdsWebhookEnv(db);
      const waitUntil = mockWaitUntil();
      const request = mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook' });
      const session = {
        id: 'cs_test_ads_upload', mode: 'payment', payment_intent: 'pi_test_ads_upload', amount_total: 500,
        customer_details: { email: 'donor2@example.com', name: 'Test Donor Two' },
        metadata: { type: 'donation', gclid_last: 'gclidlast1234567890' },
      };
      const event = { id: 'evt_test_ads_upload', created: Math.floor(Date.now() / 1000), data: { object: session } };

      await handleCheckoutCompleted(db, event, env, request, waitUntil);
      await drainWaitUntil(waitUntil);

      assert.equal(stub.ingestCalls.length, 0);
    } finally { db.close(); }
  });

  // GOOGLE_ADS_DONATION_ACTION_ID / GOOGLE_ADS_STUC_ACTION_ID (resolveValueActionIds())
  // let a real action id be exercised end to end through the real webhook
  // handler -- clickId, branch-correct action id, value formula, and
  // orderId -- without waiting on Task 9's live ids to land in the constants.
  it('a real donation action id uploads gclid_last, the donation action id, the dollar value, and the payment_intent as orderId', async (t) => {
    const stub = stubGoogleAdsWebhookFetch();
    t.after(() => stub.restore());

    const db = ledgerD1();
    try {
      const env = googleAdsWebhookEnv(db, { GOOGLE_ADS_DONATION_ACTION_ID: '1111111111' });
      const waitUntil = mockWaitUntil();
      const request = mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook' });
      const session = {
        id: 'cs_test_ads_real_donation', mode: 'payment', payment_intent: 'pi_test_ads_real_donation', amount_total: 2500,
        customer_details: { email: 'donor3@example.com', name: 'Test Donor Three' },
        metadata: { type: 'donation', gclid_last: 'gclidlast1234567890' },
      };
      const event = { id: 'evt_test_ads_real_donation', created: Math.floor(Date.now() / 1000), data: { object: session } };

      await handleCheckoutCompleted(db, event, env, request, waitUntil);
      await drainWaitUntil(waitUntil);

      assert.equal(stub.ingestCalls.length, 1);
      const ingestBody = JSON.parse(stub.ingestCalls[0].init.body);
      assert.equal(ingestBody.destinations[0].productDestinationId, '1111111111');
      const uploadedEvent = ingestBody.events[0];
      assert.deepEqual(uploadedEvent.adIdentifiers, { gclid: 'gclidlast1234567890' });
      assert.equal(uploadedEvent.conversionValue, 25);
      assert.equal(uploadedEvent.currency, 'USD');
      assert.equal(uploadedEvent.transactionId, 'pi_test_ads_real_donation');
    } finally { db.close(); }
  });

  it('a real STUC action id uploads gclid_last, the STUC action id, the trial-fallback tier value, and the subscription id as orderId', async (t) => {
    const stub = stubGoogleAdsWebhookFetch();
    t.after(() => stub.restore());

    const db = ledgerD1();
    try {
      const env = googleAdsWebhookEnv(db, { GOOGLE_ADS_STUC_ACTION_ID: '2222222222' });
      const waitUntil = mockWaitUntil();
      const request = mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook' });
      const session = {
        // amount_total=0 exercises the trial-clamped-migration fallback
        // (stucTierCentsFallback.hero = 1900 -> $19.00), not the raw amount_total.
        id: 'cs_test_ads_real_stuc', mode: 'subscription', subscription: 'sub_test_ads_real_stuc',
        payment_intent: null, amount_total: 0,
        customer_details: { email: 'member3@example.com', name: 'Test Member Three' },
        metadata: { tier: 'hero', gclid_last: 'gclidlaststuc1234567' },
      };
      const event = { id: 'evt_test_ads_real_stuc', created: Math.floor(Date.now() / 1000), data: { object: session } };

      await handleCheckoutCompleted(db, event, env, request, waitUntil);
      await drainWaitUntil(waitUntil);

      assert.equal(stub.ingestCalls.length, 1);
      const ingestBody = JSON.parse(stub.ingestCalls[0].init.body);
      assert.equal(ingestBody.destinations[0].productDestinationId, '2222222222');
      const uploadedEvent = ingestBody.events[0];
      assert.deepEqual(uploadedEvent.adIdentifiers, { gclid: 'gclidlaststuc1234567' });
      assert.equal(uploadedEvent.conversionValue, 19);
      assert.equal(uploadedEvent.currency, 'USD');
      assert.equal(uploadedEvent.transactionId, 'sub_test_ads_real_stuc');
    } finally { db.close(); }
  });
});
