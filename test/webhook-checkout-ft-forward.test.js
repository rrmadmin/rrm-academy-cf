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

describe('webhook purchase triggers the Google Ads value upload', () => {
  // DONATION_CONVERSION_ACTION_ID is still the 'PENDING_TASK_9' placeholder
  // (Task 9's create-value-actions.py has not been run against the live Ads
  // account yet), so sendGoogleAdsValueConversion's placeholder guard makes
  // this call a logged no-op -- zero Data Manager ingest calls, not one.
  // Once Brian runs the script and the real id is frozen into
  // _google-ads.js, this assertion should flip to 1 (see
  // test/google-ads-conversion.test.js for direct coverage of both the
  // no-op-on-placeholder and real-upload-with-a-real-id paths).
  it('a donation with gclid_last metadata is a no-op while the donation action id is still PENDING_TASK_9', async (t) => {
    const original = globalThis.fetch;
    const ingestCalls = [];
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('oauth2.googleapis.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.stub' }) };
      if (url.includes('datamanager.googleapis.com')) {
        ingestCalls.push(input);
        return { ok: true, status: 200, text: async () => '{}' };
      }
      throw new Error(`unrouted request to ${url}`);
    };
    t.after(() => { globalThis.fetch = original; });

    const db = ledgerD1();
    try {
      const env = mockEnv({
        DB: db, CONVERSION_LEDGER: '1',
        GOOGLE_ADS_CLIENT_ID: 'id', GOOGLE_ADS_CLIENT_SECRET: 'secret', GOOGLE_ADS_REFRESH_TOKEN: 'token',
        AWS_ACCESS_KEY_ID: undefined, AWS_SECRET_ACCESS_KEY: undefined,
      });
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

      assert.equal(ingestCalls.length, 0);
    } finally { db.close(); }
  });
});
