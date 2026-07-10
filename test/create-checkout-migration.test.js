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

// getStripeClient() (billing/_shared.js) constructs a real `stripe` npm client
// with no injection point, and there is no global-fetch Stripe mock harness
// in this test suite (unlike track-endpoint.test.js's GA4 fetch stub) --
// so true behavior assertions ("sendGA4Event was NOT called for a canary
// request", "sessions.expire WAS called") cannot be made without structural
// work (injectable Stripe client / fetch-transport mock). These tests assert
// the source-level contract instead, matching this file's established
// grep-based style for the rest of the migration-handoff logic above.
describe('create-checkout: canary branch skips GA4 + self-expires the session', () => {
  it('both begin_checkout waitUntil(sendGA4Event(...)) calls are gated on !isCanary', () => {
    const matches = [...source.matchAll(/if\s*\(\s*!isCanary\s*\)\s*\{\s*waitUntil\(sendGA4Event\(/g)];
    assert.equal(
      matches.length, 2,
      'Both the payment-mode and subscription-mode begin_checkout GA4 calls must be wrapped in `if (!isCanary) { ... }`'
    );
  });

  it('both checkout-session metadata blocks merge canary: "1" without clobbering existing keys', () => {
    const matches = [...source.matchAll(/\.\.\.\(isCanary\s*&&\s*\{\s*canary:\s*'1'\s*\}\)/g)];
    assert.equal(
      matches.length, 2,
      'Both sessionParams.metadata blocks must spread ...(isCanary && { canary: \'1\' }) onto existing metadata'
    );
  });

  it('both checkout-session metadata blocks spread prior metadata before adding canary', () => {
    // The canary spread must appear inside a metadata object literal that also
    // spreads prior keys (...sessionParams.metadata or ...migrationMetadata/ga_*
    // fields) -- i.e. it merges, it does not replace.
    const metadataBlocks = [...source.matchAll(/metadata\s*=\s*\{([\s\S]*?)\n\s*\};/g)].map((m) => m[1]);
    const canaryBlocks = metadataBlocks.filter((b) => /canary:\s*'1'/.test(b));
    assert.equal(canaryBlocks.length, 2, 'Expected exactly 2 metadata object literals containing the canary key');
    for (const block of canaryBlocks) {
      assert.ok(
        /ga_client_id/.test(block),
        'canary metadata block must sit alongside the existing ga_* attribution keys, not replace them'
      );
    }
  });

  it('both isCanary branches call stripe.checkout.sessions.expire via waitUntil with a log-and-continue catch', () => {
    const matches = [
      ...source.matchAll(
        /if\s*\(\s*isCanary\s*\)\s*\{\s*waitUntil\(stripe\.checkout\.sessions\.expire\(checkoutSession\.id\)\.catch\(err\s*=>\s*\{\s*log\(/g
      ),
    ];
    assert.equal(
      matches.length, 2,
      'Both mode branches must waitUntil(stripe.checkout.sessions.expire(checkoutSession.id).catch(err => { log(...) }))'
    );
  });

  it('the sessions.expire catch never throws to the client (no rethrow) and does not appear inside the JSON response', () => {
    assert.ok(
      !/return\s+json\([^)]*stripe\.checkout\.sessions\.expire/.test(source),
      'sessions.expire must not be composed into the returned response value'
    );
  });

  it('the response value is prepared before the canary expire waitUntil fires, and is what gets returned', () => {
    const responseBlocks = [
      ...source.matchAll(
        /const response = json\(\{ ok: true, url: checkoutSession\.url \}\);\s*\n\s*if \(isCanary\) \{\s*\n\s*waitUntil\(stripe\.checkout\.sessions\.expire/g
      ),
    ];
    assert.equal(
      responseBlocks.length, 2,
      'response must be constructed via json(...) before the isCanary expire branch, and the same `response` must be returned'
    );
    assert.equal(
      (source.match(/return response;/g) || []).length, 2,
      'both mode branches must return the prepared `response` variable'
    );
  });
});
