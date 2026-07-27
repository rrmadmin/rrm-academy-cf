/**
 * Admin notification hooks in _webhook-checkout.js: one-time donation + new STUC member.
 * Run with: node --test test/webhook-checkout-admin-notify.test.js
 *
 * The donation discriminator is tested behaviorally against the real
 * giftFromCheckoutSession mapper, which is exactly what the donation hook is gated on.
 * The hooks themselves are asserted at source level (same approach as
 * webhook-checkout-metadata.test.js): _webhook-checkout.js imports courses/_shared.js,
 * which needs the build-generated src/data/courses.json, so the unit-test CI job
 * (npm ci + npm test, no fetch-data) cannot import the module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { giftFromCheckoutSession } from '../functions/api/billing/_donor-gift.js';

const source = readFileSync(
  new URL('../functions/api/billing/_webhook-checkout.js', import.meta.url),
  'utf8'
);
const checkoutSource = readFileSync(
  new URL('../functions/api/create-checkout.js', import.meta.url),
  'utf8'
);

/** Slice a hook block out of the source by its leading comment marker. */
function hookBlock(marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `hook block "${marker}" must exist`);
  const end = source.indexOf('\n\n', start);
  return source.slice(start, end === -1 ? source.length : end);
}

const donationHook = hookBlock('// Admin notify: one-time donation.');
const stucHook = hookBlock('// Admin notify: new STUC member.');

describe('donation admin notify -- discriminator agrees with donor_gift', () => {
  const base = {
    id: 'cs_test_1',
    mode: 'payment',
    payment_intent: 'pi_test_1',
    amount_total: 5000,
    customer_details: { email: 'jane@example.com', name: 'Jane Example' },
  };

  it('one-time donation (no metadata.type) maps to a gift, so the notify fires', () => {
    const gift = giftFromCheckoutSession({ ...base }, 1750000000);
    assert.ok(gift, 'donation session must map to a gift');
    assert.equal(gift.amountCents, 5000);
    assert.equal(gift.sourceId, 'pi_test_1');
  });

  it('explicit metadata.type=donation maps to a gift', () => {
    const gift = giftFromCheckoutSession({ ...base, metadata: { type: 'donation' } }, 1750000000);
    assert.ok(gift, 'metadata.type=donation must map to a gift');
  });

  it('course purchase is excluded, so no donation notify fires', () => {
    const gift = giftFromCheckoutSession(
      { ...base, metadata: { type: 'course', courseId: 'endo-101' } },
      1750000000
    );
    assert.equal(gift, null, 'course purchases must not count as donations');
  });

  it('subscription checkout is excluded from the donation notify', () => {
    const gift = giftFromCheckoutSession(
      { ...base, mode: 'subscription', metadata: { tier: 'hero' } },
      1750000000
    );
    assert.equal(gift, null, 'subscription sessions must not count as donations');
  });

  it('payment without payment_intent is left to the pi_-keyed daemon (no notify)', () => {
    const gift = giftFromCheckoutSession({ ...base, payment_intent: null }, 1750000000);
    assert.equal(gift, null, 'missing payment_intent must not produce a gift');
  });

  it('the notify hook is gated on the same donorGift value as the CRM row', () => {
    assert.ok(
      /if\s*\(donorGift\)\s*\{[\s\S]{0,400}buildDonationAdminNotice\(session,\s*donorGift\)/.test(source),
      'donation notify must reuse the donorGift produced by giftFromCheckoutSession'
    );
    assert.equal(
      (source.match(/giftFromCheckoutSession\(/g) || []).length,
      1,
      'giftFromCheckoutSession must be called exactly once (single shared discriminator)'
    );
  });

  it('sends with the donation-admin-notify meta contract', () => {
    assert.ok(/source:\s*'billing\/donation-admin-notify'/.test(donationHook));
    assert.ok(/component:\s*'donation_admin_notify'/.test(donationHook));
    assert.ok(/category:\s*'transactional'/.test(donationHook));
  });
});

describe('STUC admin notify -- migration handoffs are skipped', () => {
  it('create-checkout marks migration checkouts with migration_handoff=true', () => {
    assert.ok(
      /migration_handoff:\s*'true'/.test(checkoutSource),
      'create-checkout.js must set metadata.migration_handoff on migration checkouts'
    );
  });

  it('the predicate branches on that exact flag plus the wix_subscription_id shape', () => {
    assert.ok(
      /meta\.migration_handoff === 'true'/.test(source),
      'isMigrationHandoffSession must read metadata.migration_handoff'
    );
    assert.ok(
      /meta\.wix_subscription_id[\s\S]{0,120}\/\^wxs_\[a-z0-9_-\]\+\$\/i/.test(source),
      'isMigrationHandoffSession must also accept the wix_subscription_id shape'
    );
  });

  it('the member notify is wrapped in the skip branch', () => {
    assert.ok(
      /if\s*\(!isMigrationHandoffSession\(session\)\)\s*\{[\s\S]{0,400}buildStucAdminNotice\(/.test(source),
      'STUC notify must be inside if (!isMigrationHandoffSession(session))'
    );
  });

  it('falls back to the standard tier price when Stripe has not billed yet', () => {
    assert.ok(
      /STUC_TIER_MONTHLY_CENTS = \{ member: 900, hero: 1900, superhero: 9900 \}/.test(source),
      'tier fallback must be member 900 / hero 1900 / superhero 9900 cents'
    );
  });

  it('sends with the stuc-admin-notify meta contract', () => {
    assert.ok(/source:\s*'billing\/stuc-admin-notify'/.test(stucHook));
    assert.ok(/component:\s*'stuc_admin_notify'/.test(stucHook));
    assert.ok(/category:\s*'transactional'/.test(stucHook));
  });
});

describe('admin notify -- fail-open and transport', () => {
  it('both notifies are fire-and-forget with a catch, never awaited', () => {
    for (const [name, block] of [['donation', donationHook], ['stuc', stucHook]]) {
      assert.ok(
        /waitUntil\(sendTracked\(/.test(block),
        `${name} notify must be wrapped in waitUntil()`
      );
      assert.ok(
        /\}\)\.catch\(\(\) => \{\}\)\);/.test(block),
        `${name} notify must end with .catch(() => {}) so a send failure cannot reject`
      );
      assert.ok(
        !/await sendTracked/.test(block),
        `${name} notify must not be awaited (webhook result must not depend on it)`
      );
    }
  });

  it('both notifies use the shared sendTracked wrapper (email_log + alerting)', () => {
    assert.ok(
      /import \{ sendTracked \} from '\.\.\/newsletter\/_mail\.js';/.test(source),
      'must import sendTracked from ../newsletter/_mail.js'
    );
  });

  it('plain text only, from accounts@, to administrator@', () => {
    for (const [name, block] of [['donation', donationHook], ['stuc', stucHook]]) {
      assert.ok(
        /from: 'RRM Academy <accounts@mail\.rrmacademy\.org>'/.test(block),
        `${name} notify must send from accounts@mail.rrmacademy.org`
      );
      assert.ok(
        /to: 'administrator@rrmacademy\.org'/.test(block),
        `${name} notify must send to administrator@rrmacademy.org`
      );
      assert.ok(!/\bhtml:/.test(block), `${name} notify must be plain text only`);
    }
  });

  it('keeps donor PII out of Analytics Engine and console', () => {
    for (const [name, block] of [['donation', donationHook], ['stuc', stucHook]]) {
      assert.ok(
        !/writeDataPoint|console\.(log|error|warn)/.test(block),
        `${name} notify must not write donor identity to AE or console`
      );
    }
  });
});
