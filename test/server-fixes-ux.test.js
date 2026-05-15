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
// Tier 2 billing refactor on 2026-05-15 extracted the off-amount + lock + clamp
// logic to billing/_migration-handoff.js. The Bug A ordering tests now check
// (a) the helper module places validateOffAmount() before acquireMigrationHandoffLock()
// and (b) create-checkout.js calls validateOffAmount before acquireMigrationHandoffLock.
const migrationHandoff = readFileSync(
  new URL('../functions/api/billing/_migration-handoff.js', import.meta.url),
  'utf8'
);

describe('create-checkout: off-amount check before lock (Bug A)', () => {
  it('STANDARD_CENTS check appears before atomic lock UPDATE', () => {
    const standardIdx = migrationHandoff.indexOf('STANDARD_CENTS');
    const lockIdx = migrationHandoff.indexOf("SET migration_handoff_started_at = strftime");
    assert.ok(standardIdx > 0, 'STANDARD_CENTS must be defined in _migration-handoff.js');
    assert.ok(lockIdx > 0, 'Atomic lock UPDATE (SET migration_handoff_started_at) must exist in _migration-handoff.js');
    assert.ok(
      standardIdx < lockIdx,
      'Off-amount check (STANDARD_CENTS) must appear before atomic lock UPDATE so 412 does not hold a 15-min lock'
    );
    // Caller invariant: validateOffAmount is called before acquireMigrationHandoffLock
    const callerValidateIdx = createCheckout.indexOf('validateOffAmount');
    const callerLockIdx = createCheckout.indexOf('acquireMigrationHandoffLock');
    assert.ok(callerValidateIdx > 0, 'create-checkout must call validateOffAmount');
    assert.ok(callerLockIdx > 0, 'create-checkout must call acquireMigrationHandoffLock');
    assert.ok(
      callerValidateIdx < callerLockIdx,
      'create-checkout must invoke validateOffAmount before acquireMigrationHandoffLock'
    );
  });

  it('off_amount 412 is returned before lock acquisition', () => {
    const offAmountIdx = migrationHandoff.indexOf("'off_amount'");
    const lockIdx = migrationHandoff.indexOf("SET migration_handoff_started_at = strftime");
    assert.ok(offAmountIdx > 0, '412 off_amount return must exist in _migration-handoff.js');
    assert.ok(lockIdx > 0, 'Atomic lock UPDATE must exist in _migration-handoff.js');
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
