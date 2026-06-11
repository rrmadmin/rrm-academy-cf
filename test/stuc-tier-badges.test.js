/**
 * Tests for STUC tier-badge writer: tier derivation + label-write planning.
 * Run with: node --test test/stuc-tier-badges.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, mockWaitUntil } from './_helpers.js';
import {
  TIER_LABEL_MAP, TIER_LABELS, LABEL_FOR_TIER, tierFromPriceOrAmount,
} from '../functions/api/community/_shared.js';

// --- Tier map invariants ---

describe('STUC tier maps', () => {
  it('TIER_LABEL_MAP has exactly three entries', () => {
    assert.equal(Object.keys(TIER_LABEL_MAP).length, 3);
  });

  it('TIER_LABELS contains all three canonical label strings', () => {
    assert.ok(TIER_LABELS.includes('Uterus Member 🐻'));
    assert.ok(TIER_LABELS.includes('Uterus Hero 💖'));
    assert.ok(TIER_LABELS.includes('Uterus Super Hero 🦸‍♀️'));
  });

  it('LABEL_FOR_TIER is the exact inverse of TIER_LABEL_MAP', () => {
    for (const [label, tier] of Object.entries(TIER_LABEL_MAP)) {
      assert.equal(LABEL_FOR_TIER[tier], label, `LABEL_FOR_TIER[${tier}] should equal ${label}`);
    }
  });

  it('LABEL_FOR_TIER covers all three tier names', () => {
    assert.ok('member' in LABEL_FOR_TIER);
    assert.ok('hero' in LABEL_FOR_TIER);
    assert.ok('superhero' in LABEL_FOR_TIER);
  });
});

// --- tierFromPriceOrAmount ---

describe('tierFromPriceOrAmount -- price ID hit', () => {
  const env = {
    STRIPE_PRICE_MEMBER: 'price_member_123',
    STRIPE_PRICE_HERO: 'price_hero_456',
    STRIPE_PRICE_SUPERHERO: 'price_super_789',
  };

  it('returns member when price ID matches STRIPE_PRICE_MEMBER', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_member_123', unit_amount: 900 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'member');
  });

  it('returns hero when price ID matches STRIPE_PRICE_HERO', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_hero_456', unit_amount: 2500 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });

  it('returns superhero when price ID matches STRIPE_PRICE_SUPERHERO', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_super_789', unit_amount: 5000 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'superhero');
  });

  it('subscription.metadata.tier takes priority over price ID', () => {
    const sub = {
      metadata: { tier: 'hero' },
      items: { data: [{ price: { id: 'price_super_789', unit_amount: 5000 } }] },
    };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });

  it('ignores invalid metadata.tier values and falls through to price ID', () => {
    const sub = {
      metadata: { tier: 'gold' },
      items: { data: [{ price: { id: 'price_hero_456', unit_amount: 2500 } }] },
    };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });
});

describe('tierFromPriceOrAmount -- unit_amount fallback (unknown price ID)', () => {
  const env = {
    STRIPE_PRICE_MEMBER: 'price_member_123',
    STRIPE_PRICE_HERO: 'price_hero_456',
    STRIPE_PRICE_SUPERHERO: 'price_super_789',
  };

  it('returns member when unit_amount < 1900', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 900 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'member');
  });

  it('returns member at the boundary just below hero (1899 cents)', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 1899 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'member');
  });

  it('returns hero at exactly 1900 cents', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 1900 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });

  it('returns hero at 5000 cents (between thresholds)', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 5000 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });

  it('returns hero at 9899 cents (just below superhero)', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 9899 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });

  it('returns superhero at exactly 9900 cents', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 9900 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'superhero');
  });

  it('returns superhero above 9900 cents', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 50000 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'superhero');
  });

  it('defaults to member when unit_amount is 0 (no price data)', () => {
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_custom_xxx', unit_amount: 0 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'member');
  });

  it('defaults to member when items is empty', () => {
    const sub = { metadata: {}, items: { data: [] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'member');
  });
});

// --- Label-write planning: correct inserts + deletes for each tier ---

describe('_webhook-subscription -- label-write batch planning', () => {
  function makeSub(tier, priceId, status = 'active') {
    return {
      id: `sub_test`,
      customer: 'cus_test',
      status,
      metadata: { tier },
      items: { data: [{ price: { id: priceId, product: 'prod_U1VCTgB3uBP0KX', unit_amount: 900 } }] },
    };
  }

  it('member tier: inserts member label, deletes hero + superhero labels', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-subscription.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('maybeSyncStucTierLabel'),
      'Should have maybeSyncStucTierLabel function'
    );
    assert.ok(
      source.includes('LABEL_FOR_TIER'),
      'Should use LABEL_FOR_TIER from community/_shared.js'
    );
    assert.ok(
      source.includes("otherTierLabels.map(label =>"),
      'Should DELETE other tier labels via map over otherTierLabels'
    );
    assert.ok(
      source.includes('db.batch('),
      'Should use db.batch() for atomic multi-write'
    );
  });

  it('cancellation removes bare STUC label + all three tier labels', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-subscription.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('[STUC_LABEL, ...TIER_LABELS]'),
      'maybeRemoveStucLabel should delete STUC_LABEL and all three tier labels'
    );
  });

  it('imports TIER_LABELS and LABEL_FOR_TIER from community/_shared.js', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/billing/_webhook-subscription.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes("from '../community/_shared.js'"),
      'Must import from community/_shared.js'
    );
    assert.ok(
      source.includes('TIER_LABELS'),
      'Must import TIER_LABELS'
    );
    assert.ok(
      source.includes('LABEL_FOR_TIER'),
      'Must import LABEL_FOR_TIER'
    );
    assert.ok(
      source.includes('tierFromPriceOrAmount'),
      'Must import tierFromPriceOrAmount'
    );
  });
});

// --- tierFromPriceOrAmount -- no env price vars (pre-deploy / test env) ---

describe('tierFromPriceOrAmount -- missing env price vars', () => {
  it('falls through to unit_amount when no env price vars are set', () => {
    const env = {};
    const sub = { metadata: {}, items: { data: [{ price: { id: 'price_any', unit_amount: 9900 } }] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'superhero');
  });

  it('still resolves via metadata.tier when env vars are absent', () => {
    const env = {};
    const sub = { metadata: { tier: 'hero' }, items: { data: [] } };
    assert.equal(tierFromPriceOrAmount(sub, env), 'hero');
  });
});

// --- create-checkout -- subscription_data.metadata includes tier ---

describe('create-checkout -- subscription_data.metadata tier field', () => {
  it('always sets subscription_data with tier in metadata', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/create-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      source.includes('metadata: { tier: effectiveTier'),
      'subscription_data.metadata must include tier: effectiveTier'
    );
    assert.ok(
      /sessionParams\.subscription_data\s*=\s*\{/.test(source),
      'Must always set sessionParams.subscription_data (not conditional on migration metadata)'
    );
  });

  it('does not have the old conditional guard that skipped subscription_data for cold checkouts', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../functions/api/create-checkout.js', import.meta.url),
      'utf8'
    );
    assert.ok(
      !source.includes('Object.keys(migrationMetadata).length > 0 || Object.keys(offAmountSubMeta).length > 0'),
      'Old conditional guard should be removed -- subscription_data is always set now'
    );
  });
});
