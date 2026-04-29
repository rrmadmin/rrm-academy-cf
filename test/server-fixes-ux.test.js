import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const createCheckout = readFileSync(
  new URL('../functions/api/create-checkout.js', import.meta.url),
  'utf8'
);
const webhook = readFileSync(
  new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
  'utf8'
);

describe('create-checkout: off-amount check before lock (Bug A)', () => {
  it('STANDARD_CENTS check appears before atomic lock UPDATE', () => {
    const standardIdx = createCheckout.indexOf('STANDARD_CENTS');
    // The SQL UPDATE is split across string-concatenation literals; search for the
    // unique "SET migration_handoff_started_at = strftime" phrase which only exists
    // in the lock UPDATE and cannot appear anywhere else in the file.
    const lockIdx = createCheckout.indexOf("SET migration_handoff_started_at = strftime");
    assert.ok(standardIdx > 0, 'STANDARD_CENTS must be defined');
    assert.ok(lockIdx > 0, 'Atomic lock UPDATE (SET migration_handoff_started_at) must exist');
    assert.ok(
      standardIdx < lockIdx,
      'Off-amount check (STANDARD_CENTS) must appear before atomic lock UPDATE so 412 does not hold a 15-min lock'
    );
  });

  it('off_amount 412 is returned before lock acquisition', () => {
    const offAmountIdx = createCheckout.indexOf("'off_amount'");
    const lockIdx = createCheckout.indexOf("SET migration_handoff_started_at = strftime");
    assert.ok(offAmountIdx > 0, '412 off_amount return must exist');
    assert.ok(lockIdx > 0, 'Atomic lock UPDATE must exist');
    assert.ok(
      offAmountIdx < lockIdx,
      'Returning 412 off_amount must happen before the lock UPDATE'
    );
  });
});

describe('webhook-checkout: migration-aware welcome email (Bug B)', () => {
  it('detects wix_subscription_id metadata in welcome email block', () => {
    assert.ok(
      /session\.metadata\?\.wix_subscription_id/.test(webhook),
      'Webhook must read session.metadata.wix_subscription_id to detect migration donors'
    );
  });

  it('migration email body uses different subject than new-member welcome', () => {
    assert.ok(
      /Welcome to the Save the Uterus Club/.test(webhook),
      'New-member welcome subject must remain'
    );
    assert.ok(
      /switch.*complete|donation switch/i.test(webhook),
      'Migration email subject must be present'
    );
  });

  it('migration email avoids new-member onboarding list', () => {
    const migrationMarkerIdx = webhook.search(/switch.*complete|donation switch/i);
    assert.ok(migrationMarkerIdx > 0, 'Migration email must exist');
    const window = webhook.slice(migrationMarkerIdx, migrationMarkerIdx + 1200);
    assert.ok(
      !/1\.\s*Join the member group/.test(window),
      'Migration email body should not include "1. Join the member group" onboarding'
    );
  });

  it('migration email reassures against double-charge', () => {
    assert.ok(
      /double-charged|won.t be double|both charges|two charges/i.test(webhook),
      'Migration email must reassure donor about double-charge'
    );
  });

  it('migration email mentions Wix sub will be cancelled within 24h', () => {
    assert.ok(
      /cancel.*previous.*Wix.*24|24 hours/i.test(webhook),
      'Migration email must state Wix sub cancellation timing'
    );
  });
});
