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
