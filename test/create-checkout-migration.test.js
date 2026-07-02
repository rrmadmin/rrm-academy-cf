import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Union of create-checkout.js + billing/_migration-handoff.js — the migration SQL
// and lock/clamp/validation logic was extracted to the helper module on
// 2026-05-15 (Tier 2 billing refactor). Greps that previously hit create-checkout.js
// inline are now satisfied by either file.
const source =
  readFileSync(new URL('../functions/api/create-checkout.js', import.meta.url), 'utf8') +
  '\n' +
  readFileSync(new URL('../functions/api/billing/_migration-handoff.js', import.meta.url), 'utf8');

describe('create-checkout migration handoff (Phase 3.1)', () => {
  it('feature flag gates migration logic', () => {
    assert.ok(
      source.includes('STUC_MIGRATION_UX_V2'),
      'Migration flow must be gated by STUC_MIGRATION_UX_V2 feature flag'
    );
  });

  it('Layer 3 SQL uses wix_subscription_id (not id) and email fallback with COLLATE NOCASE', () => {
    assert.ok(
      /WHERE\s*\(?\s*wix_subscription_id\s*=\s*\?\s*OR\s+email\s*=\s*\?\s*COLLATE\s+NOCASE/i.test(source),
      'Layer 3 lookup must be: WHERE (wix_subscription_id = ? OR email = ? COLLATE NOCASE)'
    );
    assert.ok(
      /ORDER BY started_at DESC/i.test(source),
      'Layer 3 lookup must ORDER BY started_at DESC'
    );
    assert.ok(
      /migration_status\s*=\s*'pending'/.test(source),
      'Layer 3 lookup must filter migration_status=pending'
    );
  });

  it('atomic write-lock with 15-min TTL', () => {
    assert.ok(
      /UPDATE\s+wix_subscription[\s\S]*SET\s+migration_handoff_started_at\s*=\s*strftime\('%s','now'\)/i.test(source),
      'Atomic lock must set migration_handoff_started_at via strftime'
    );
    assert.ok(
      /migration_handoff_started_at\s+IS\s+NULL[\s\S]*OR\s+migration_handoff_started_at\s*<\s*strftime\('%s','now'\)\s*-\s*900/i.test(source),
      'Lock predicate must allow override when handoff is NULL or older than 900s (15min)'
    );
  });

  it('returns 409 migration_in_progress when lock held', () => {
    assert.ok(
      /'migration_in_progress'/.test(source),
      'Must return migration_in_progress error code when lock active'
    );
    assert.ok(
      /\bstatus:\s*409\b/.test(source) || /\b409\b[^,]*'migration_in_progress'/.test(source) || /'migration_in_progress'[^)]*\),\s*409\s*\)/.test(source) || /json\(\s*\{[^}]*'migration_in_progress'[^}]*\}\s*,\s*409\s*\)/.test(source),
      'migration_in_progress must use HTTP 409'
    );
  });

  it('off-amount detection returns 409 with structured response', () => {
    assert.ok(
      /'off_amount'/.test(source),
      'Must have off_amount error code'
    );
    assert.ok(
      /standard_tiers/.test(source),
      'Off-amount response must include standard_tiers list'
    );
    // Off-amount became a hard, permanent refusal (no acknowledge escape
    // hatch) since all 52 live wix_subscription rows are 900/1900/9900 cents.
    // validateOffAmount() (in _migration-handoff.js) returns the inline
    // {... 'off_amount' ...} body; create-checkout.js wraps it as
    // `return json(offAmountBody, 409)`.
    assert.ok(
      /json\(\s*offAmountBody\s*,\s*409\s*\)/.test(source),
      'off_amount must use HTTP 409'
    );
    assert.ok(
      !/\b412\b/.test(source),
      'Old 412 off_amount status must be retired'
    );
    assert.ok(
      /STANDARD_CENTS|standardCents|standard_cents/.test(source),
      'Must define a standard cents set ({900, 1900, 9900})'
    );
  });

  it('off-amount is a hard refusal -- no acknowledge_off_amount escape hatch, no ad-hoc Stripe price', () => {
    assert.ok(
      !/acknowledge_off_amount/.test(source),
      'acknowledge_off_amount flow must be removed -- off-amount is always refused (dead code for a scenario that cannot occur)'
    );
    assert.ok(
      !/useCustomAmount/.test(source),
      'useCustomAmount branch must be removed from create-checkout.js'
    );
    assert.ok(
      /administrator@rrmacademy\.org/.test(source),
      'Refusal message must direct the donor to contact administrator@rrmacademy.org'
    );
    assert.ok(
      /isCustomAmount/.test(source),
      'isCustomAmount() must still gate the refusal in billing/_migration-handoff.js'
    );
  });

  it('trial_end clamp validates range (now+86400, now+730*86400)', () => {
    assert.ok(
      /next_expected_at/.test(source),
      'Must read wix_subscription.next_expected_at for trial_end'
    );
    assert.ok(
      /86400/.test(source) && /730/.test(source),
      'trial_end clamp must reference 86400 (1 day) and 730 (~2 years)'
    );
    assert.ok(
      /Number\.isFinite|isFinite/.test(source),
      'trial_end candidate must be finite-checked'
    );
  });

  it('logs trial-end-out-of-range AE event with EVENTS binding', () => {
    assert.ok(
      /env\.EVENTS\?\.writeDataPoint|env\.EVENTS\.writeDataPoint/.test(source),
      'AE binding is env.EVENTS (not WORKER_EVENTS)'
    );
    assert.ok(
      /'trial-end-out-of-range'/.test(source),
      'Must emit trial-end-out-of-range AE event when clamp fails'
    );
  });

  it('writes migration metadata onto Stripe session', () => {
    assert.ok(
      /wix_subscription_id\s*:\s*\w+\.wix_subscription_id|wix_subscription_id\s*:\s*wixLookup\.wix_subscription_id/.test(source),
      'Stripe session.metadata must carry wix_subscription_id from the matched row'
    );
    assert.ok(
      /'migration_handoff'\s*:\s*'true'|migration_handoff\s*:\s*'true'/.test(source),
      'Stripe session.metadata must include migration_handoff: "true"'
    );
  });

  it('logs cold-checkout AE event when no wix_sub matches', () => {
    assert.ok(
      /'cold-checkout'/.test(source) || /'stuc-migration-cold-checkout'/.test(source),
      'Must emit cold-checkout AE event when Layer 3 returns no row'
    );
  });

  it('no stale plan-isms', () => {
    assert.ok(
      !/wixLookup\.id\b/.test(source),
      "Must use wixLookup.wix_subscription_id, never wixLookup.id"
    );
    assert.ok(
      !/env\.WORKER_EVENTS/.test(source),
      "Must use env.EVENTS, never env.WORKER_EVENTS"
    );
    assert.ok(
      !/STUC_PRODUCT_ID/.test(source),
      "STUC_PRODUCT_ID was only used by the removed price_data branch; must not linger as dead code"
    );
  });
});

describe('create-checkout: Wix frequency guard', () => {
  it('lookupPendingWixMigration SELECTs frequency', () => {
    assert.ok(
      /SELECT[\s\S]*?\bfrequency\b[\s\S]*?FROM wix_subscription/i.test(source),
      'lookupPendingWixMigration must SELECT frequency so non-MONTH rows can be refused'
    );
  });

  it('refuses any non-MONTH wix_subscription row with a structured 409', () => {
    assert.ok(
      /'unsupported_frequency'/.test(source),
      'Must have an unsupported_frequency refusal error code'
    );
    assert.ok(
      /wixLookup\.frequency\s*===\s*'MONTH'/.test(source),
      'validateFrequency must gate on wixLookup.frequency === MONTH'
    );
    assert.ok(
      /json\(\s*frequencyBody\s*,\s*409\s*\)/.test(source),
      'Non-MONTH refusal must use HTTP 409'
    );
    assert.ok(
      /administrator@rrmacademy\.org/.test(source),
      'Frequency refusal message must direct the donor to contact administrator@rrmacademy.org'
    );
  });
});

describe('create-checkout: canary token constant-time compare', () => {
  it('uses constantTimeEqual, not a direct === comparison, for the canary token', () => {
    assert.ok(
      /constantTimeEqual\(/.test(source),
      'Canary token comparison must use constantTimeEqual to avoid a timing side-channel'
    );
    assert.ok(
      !/canaryToken\s*===\s*env\.CANARY_SECRET/.test(source),
      'Must not use a direct === comparison for canaryToken'
    );
  });
});
