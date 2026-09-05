import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mockRequest, mockEnv, mockWaitUntil, parseResponse, drainWaitUntil, stubExternalFetch, stripeRoutes,
} from './_helpers.js';

const { onRequestPost } = await import('../functions/api/create-checkout.js');

// Builds an rrm_ft cookie exactly the way BaseLayout.astro's writer does --
// see test/ga4-source.test.js's ftCookie() for the wire-format rationale.
function ftCookie(fields) {
  const parts = Object.keys(fields).map((key) => key + '=' + encodeURIComponent(fields[key]));
  return 'rrm_ft=' + parts.join('&');
}

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
  it('both begin_checkout waitUntil(sendGA4Event(...)) calls are gated on !isCanary && !isBotRequest(request)', () => {
    const matches = [
      ...source.matchAll(/if\s*\(\s*!isCanary\s*&&\s*!isBotRequest\(request\)\s*\)\s*\{\s*waitUntil\(sendGA4Event\(/g),
    ];
    assert.equal(
      matches.length, 2,
      'Both the payment-mode and subscription-mode begin_checkout GA4 calls must be wrapped in `if (!isCanary && !isBotRequest(request)) { ... }`'
    );
  });

  it('imports isBotRequest from ./_bot.js, mirroring track.js', () => {
    const checkoutSource = readFileSync(new URL('../functions/api/create-checkout.js', import.meta.url), 'utf8');
    assert.ok(
      /import\s*\{\s*isBotRequest\s*\}\s*from\s*['"]\.\/_bot\.js['"]/.test(checkoutSource),
      'create-checkout.js must import isBotRequest from ./_bot.js, matching the import style already used by track.js'
    );
  });

  it('all four canary metadata spreads (2 top-level sessionParams.metadata + 2 nested payment_intent_data/subscription_data.metadata) merge canary: "1" without clobbering existing keys', () => {
    const matches = [...source.matchAll(/\.\.\.\(isCanary\s*&&\s*\{\s*canary:\s*'1'\s*\}\)/g)];
    assert.equal(
      matches.length, 4,
      'sessionParams.metadata (both modes) AND payment_intent_data.metadata / subscription_data.metadata must all spread ...(isCanary && { canary: \'1\' }) onto existing metadata'
    );
  });

  it('payment_intent_data.metadata and subscription_data.metadata (nested, per-mode) also carry the canary tag downstream', () => {
    assert.ok(
      /payment_intent_data = \{[\s\S]*?metadata: \{ type: 'donation', \.\.\.ftMetadata, \.\.\.\(campaign && \{ campaign \}\), \.\.\.\(isCanary && \{ canary: '1' \}\) \}/.test(source),
      'sessionParams.payment_intent_data.metadata must merge ...(isCanary && { canary: \'1\' }) alongside the existing donation/campaign keys'
    );
    assert.ok(
      /subscription_data = \{[\s\S]*?metadata: \{ tier: effectiveTier, \.\.\.migrationMetadata, \.\.\.ftMetadata, \.\.\.\(isCanary && \{ canary: '1' \}\) \}/.test(source),
      'sessionParams.subscription_data.metadata must merge ...(isCanary && { canary: \'1\' }) alongside the existing tier/migrationMetadata keys'
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

describe('create-checkout: canary requests never touch the Wix migration handoff', () => {
  it('wixLookup short-circuits to null when isCanary, so lookupPendingWixMigration is never called for a canary probe', () => {
    assert.ok(
      /const wixLookup = isCanary \? null : await lookupPendingWixMigration\(/.test(source),
      'wixLookup must resolve to null directly for canary requests instead of calling lookupPendingWixMigration -- ' +
      'a canary session self-expires immediately, so the completion webhook that releases acquireMigrationHandoffLock() can never arrive'
    );
  });

  it('the cold-checkout Analytics Engine write is also gated on !isCanary', () => {
    assert.ok(
      /else if\s*\(\s*stucV2\s*&&\s*!isCanary\s*\)\s*\{/.test(source),
      'the stucV2 cold-checkout writeDataPoint branch must additionally check !isCanary so canary probes never inject synthetic \'anon\' rows into the migration-funnel dataset'
    );
  });
});

describe('create-checkout: every checkout session collects a name', () => {
  // The STUC join flow has no name field of our own -- the tier buttons hand
  // straight off to Stripe Checkout, so customer_details.name is the only source
  // of a member's name. On the 'auto' default Stripe renders the cardholder-name
  // field for card payers but not for Link/wallet payers, and on 2026-08-24 a Link
  // payer joined with email + ZIP only and landed in D1 with no name at all.
  const checkoutSource = readFileSync(new URL('../functions/api/create-checkout.js', import.meta.url), 'utf8');
  const subscriptionBranch = checkoutSource.slice(
    checkoutSource.indexOf("mode: 'subscription',"),
    checkoutSource.indexOf('sessionParams.subscription_data')
  );

  it('isolates a non-empty subscription sessionParams block to assert against', () => {
    assert.ok(subscriptionBranch.length > 100, 'the slice markers must still bracket the subscription session params');
    assert.ok(!subscriptionBranch.includes("mode: 'payment'"), 'the slice must not bleed into the donation branch');
  });

  it("sets billing_address_collection: 'required' so every payment method is asked for a name", () => {
    assert.ok(
      /billing_address_collection:\s*'required'/.test(subscriptionBranch),
      "the subscription checkout must require the billing address -- without it Stripe asks Link and wallet payers for no name, " +
      'and the member lands in D1 nameless'
    );
  });
});

describe('create-checkout: the donation session collects a donor name', () => {
  // Same defect class as the subscription session. A Link or wallet donor is
  // never shown the card block's name field, so customer_details.name is null,
  // donor_gift.display_name lands empty and the admin email reads
  // "Donor name: (not set)". Before 2026-08-25 only the provider-directory
  // campaign required the billing address; every other donation did not.
  const checkoutSource = readFileSync(new URL('../functions/api/create-checkout.js', import.meta.url), 'utf8');
  const donationBranch = checkoutSource.slice(
    checkoutSource.indexOf("mode: 'payment',"),
    checkoutSource.indexOf('sessionParams.payment_intent_data')
  );
  const providerDirectoryBlock = checkoutSource.slice(
    checkoutSource.indexOf("if (campaign === 'provider-directory') {"),
    checkoutSource.indexOf('let checkoutSession;')
  );

  it('isolates a non-empty donation sessionParams block to assert against', () => {
    assert.ok(donationBranch.length > 100, 'the slice markers must still bracket the donation session params');
    assert.ok(!donationBranch.includes("mode: 'subscription'"), 'the slice must not bleed into the subscription branch');
    assert.ok(providerDirectoryBlock.length > 50, 'the provider-directory slice markers must still bracket that block');
  });

  it("sets billing_address_collection: 'required' on the base donation session", () => {
    assert.ok(
      /billing_address_collection:\s*'required'/.test(donationBranch),
      'every donation must require the billing address, not just the provider-directory campaign -- ' +
      'otherwise a Link donor produces a nameless donor_gift row'
    );
  });

  it('does not re-set billing_address_collection inside the provider-directory campaign block', () => {
    assert.ok(
      !/billing_address_collection\s*=/.test(providerDirectoryBlock),
      'the campaign block must layer phone + custom_fields on top of the unconditional setting, not restate it -- ' +
      'a second assignment is where the two copies drift apart'
    );
  });
});

describe('create-checkout first-touch attribution metadata (Phase 3.1)', () => {
  it('imports parseFirstTouch and parseGclidCookie from _ga4-source.js', () => {
    assert.match(source, /import\s*\{[^}]*parseFirstTouch[^}]*parseGclidCookie[^}]*\}\s*from\s*'\.\/\_ga4-source\.js'|import\s*\{[^}]*parseGclidCookie[^}]*parseFirstTouch[^}]*\}\s*from\s*'\.\/_ga4-source\.js'/);
  });

  it('reads the Cookie header directly, not the POST body, for first-touch data', () => {
    assert.match(source, /const cookieHeader = request\.headers\.get\('Cookie'\)/);
    assert.match(source, /parseFirstTouch\(cookieHeader\)/);
    assert.match(source, /parseGclidCookie\(cookieHeader\)/);
  });

  it('caps every ft_* and gclid_last metadata value at 500 chars', () => {
    assert.match(source, /ft_source\.slice\(0,\s*500\)/);
    assert.match(source, /gclid_last:\s*gclidLast\.slice\(0,\s*500\)/);
  });

  it('donation payment_intent_data.metadata carries ftMetadata', () => {
    const donationIntentBlock = source.slice(
      source.indexOf('sessionParams.payment_intent_data = {'),
      source.indexOf('sessionParams.payment_intent_data = {') + 400
    );
    assert.match(donationIntentBlock, /\.\.\.ftMetadata/);
  });

  it('subscription_data.metadata carries ftMetadata', () => {
    const subDataBlock = source.slice(
      source.indexOf('sessionParams.subscription_data = {'),
      source.indexOf('sessionParams.subscription_data = {') + 300
    );
    assert.match(subDataBlock, /\.\.\.ftMetadata/);
  });
});

// EXECUTED behavioral tests: the two describe blocks above only prove the
// source contains the right regex shapes. Neither actually runs
// onRequestPost, so neither can catch a real leak -- ft_term is never even
// parsed into ft_* metadata (parseFirstTouch has no 't' mapping), so the
// static "caps every ft_* value at 500 chars" assertion above would stay
// green even if an email-shaped utm_term somehow reached Stripe. These tests
// run the real handler with a real (stubbed-network) Stripe client and walk
// every metadata value the request would actually send.
describe('create-checkout first-touch attribution metadata -- EXECUTED', () => {
  let net;

  function stubStripe(overrides = {}) {
    return stubExternalFetch({
      stripe: stripeRoutes({
        '/v1/checkout/sessions': { id: 'cs_test_ft_exec', url: 'https://checkout.stripe.com/c/pay/cs_test_ft_exec' },
        ...overrides,
      }),
    });
  }

  function walkNoEmailShape(form) {
    for (const [key, value] of form.entries()) {
      if (!key.includes('metadata')) continue;
      assert.ok(
        !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(value),
        `metadata value for ${key} contains an email shape: ${value}`
      );
    }
  }

  it('donation: an email-shaped rrm_ft.t never reaches Stripe metadata, and a clean ft_campaign does', async () => {
    net = stubStripe();
    try {
      const cookie = ftCookie({ s: 'google', m: 'cpc', c: 'q3_push', t: 'jane@example.com' });
      const request = mockRequest('POST', {
        url: 'https://rrmacademy.org/api/create-checkout',
        headers: { Cookie: cookie, 'CF-Connecting-IP': '203.0.113.5' },
        body: { mode: 'payment', amount: 2500 },
      });
      const waitUntil = mockWaitUntil();
      const env = mockEnv();
      const res = await onRequestPost({ request, env, waitUntil });
      await drainWaitUntil(waitUntil);
      const { status, body } = await parseResponse(res);
      assert.equal(status, 200, JSON.stringify(body));

      const call = net.calls.find((c) => c.service === 'stripe');
      assert.ok(call, 'a Stripe checkout session must be created');
      const form = new URLSearchParams(call.body);

      assert.equal(form.get('metadata[ft_campaign]'), 'q3_push');
      assert.equal(form.get('payment_intent_data[metadata][ft_campaign]'), 'q3_push');
      walkNoEmailShape(form);
    } finally {
      net.restore();
    }
  });

  it('subscription: an email-shaped rrm_ft.t never reaches Stripe metadata, and a clean ft_campaign does', async () => {
    net = stubStripe();
    try {
      const cookie = ftCookie({ s: 'google', m: 'cpc', c: 'q3_push', t: 'jane@example.com' });
      const request = mockRequest('POST', {
        url: 'https://rrmacademy.org/api/create-checkout',
        headers: { Cookie: cookie, 'CF-Connecting-IP': '203.0.113.6' },
        body: { mode: 'subscription', tier: 'member' },
      });
      const waitUntil = mockWaitUntil();
      const env = mockEnv({ STRIPE_PRICE_MEMBER: 'price_test_member' });
      const res = await onRequestPost({ request, env, waitUntil });
      await drainWaitUntil(waitUntil);
      const { status, body } = await parseResponse(res);
      assert.equal(status, 200, JSON.stringify(body));

      const call = net.calls.find((c) => c.service === 'stripe');
      assert.ok(call, 'a Stripe checkout session must be created');
      const form = new URLSearchParams(call.body);

      assert.equal(form.get('metadata[ft_campaign]'), 'q3_push');
      assert.equal(form.get('subscription_data[metadata][ft_campaign]'), 'q3_push');
      walkNoEmailShape(form);
    } finally {
      net.restore();
    }
  });
});
