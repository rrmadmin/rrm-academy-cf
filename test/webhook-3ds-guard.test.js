/**
 * Source-pattern regression tests for the 3DS-incomplete guard (Bug #11).
 * Run with: node --test test/webhook-3ds-guard.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
  'utf8'
);

describe('webhook-checkout 3DS-incomplete guard (Bug #11)', () => {
  it('imports Stripe + STRIPE_API_VERSION', () => {
    assert.ok(/import\s+Stripe\s+from\s+'stripe'/.test(source), 'Must import Stripe');
    assert.ok(/STRIPE_API_VERSION/.test(source), 'Must reference STRIPE_API_VERSION');
  });

  it('retrieves the subscription before migration UPDATE', () => {
    assert.ok(
      /stripe\.subscriptions\.retrieve\(session\.subscription\)/.test(source),
      'Must call stripe.subscriptions.retrieve before flipping migration_status'
    );
  });

  it('checks sub status is active or trialing before UPDATE', () => {
    assert.ok(
      /'active'/.test(source) && /'trialing'/.test(source),
      'Must check for both active and trialing statuses'
    );
  });

  it('clears lock on incomplete sub (donor can retry)', () => {
    const lockClearMatch = /UPDATE\s+wix_subscription\s+SET\s+migration_handoff_started_at\s*=\s*NULL[\s\S]{0,200}WHERE\s+wix_subscription_id\s*=\s*\?\s+AND\s+stripe_subscription_id\s+IS\s+NULL/i;
    assert.ok(
      lockClearMatch.test(source),
      'Must clear migration_handoff_started_at when sub is not yet active'
    );
  });

  it('logs stripe-sub-not-ready AE event on incomplete sub', () => {
    assert.ok(
      /'stripe-sub-not-ready'/.test(source),
      'Must emit stripe-sub-not-ready AE event when sub status is not active/trialing'
    );
  });

  it('logs stripe-retrieve-error AE event on Stripe API failure', () => {
    assert.ok(
      /'stripe-retrieve-error'/.test(source),
      'Must emit stripe-retrieve-error AE event when Stripe retrieve throws'
    );
  });

  it('still flips migration_status when sub is active', () => {
    assert.ok(
      /migration_status\s*=\s*'stripe_active'/.test(source),
      'Active-sub path must still flip migration_status to stripe_active'
    );
  });

  it('fails closed on Stripe API error (does NOT flip migration_status)', () => {
    assert.ok(
      /stripeSubStatus\s*=\s*'unknown'/.test(source),
      'Stripe API errors must fail closed (set status to unknown which skips UPDATE)'
    );
  });
});
