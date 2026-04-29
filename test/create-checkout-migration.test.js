import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../functions/api/create-checkout.js', import.meta.url),
  'utf8'
);

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

  it('off-amount detection returns 412 with structured response', () => {
    assert.ok(
      /'off_amount'/.test(source),
      'Must have off_amount error code'
    );
    assert.ok(
      /standard_tiers/.test(source),
      'Off-amount response must include standard_tiers list'
    );
    assert.ok(
      /\bstatus:\s*412\b/.test(source) || /\b412\b[^,]*'off_amount'/.test(source) || /json\(\s*\{[^}]*'off_amount'[\s\S]*?\}\s*,\s*412\s*\)/.test(source),
      'off_amount must use HTTP 412'
    );
    assert.ok(
      /STANDARD_CENTS|standardCents|standard_cents/.test(source),
      'Must define a standard cents set ({900, 1900, 9900})'
    );
  });

  it('off-amount accepts acknowledge_off_amount=true and uses price_data', () => {
    assert.ok(
      /acknowledge_off_amount/.test(source),
      'Must check body.acknowledge_off_amount to bypass off_amount block'
    );
    assert.ok(
      /price_data/.test(source),
      'Off-amount accepted path must use Stripe price_data ad-hoc pricing'
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
  });
});
