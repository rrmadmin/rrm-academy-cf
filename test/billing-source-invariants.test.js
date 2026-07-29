/**
 * The source-level assertions that survived the 2026-07-28 conversion of
 * test/stripe-webhook.test.js from readFileSync-and-grep to real execution.
 *
 * Everything that COULD be executed now is, in test/stripe-webhook.test.js and
 * test/webhook-checkout-exec.test.js. What is left here is the residue where
 * execution genuinely cannot pin the property, and each entry says why. Do not
 * grow this file: a new entry needs a written reason execution is impossible,
 * not just that executing it would be work.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('billing invariants -- unreachable branch', () => {
  it('the dedup rollback is gated on 5xx, not 4xx', () => {
    // REASON EXECUTION CANNOT PIN THIS: every sub-handler under
    // functions/api/billing/ returns null or a 500, so the
    // `result.status < 500 -> markWebhookEventCompleted` arm cannot be reached
    // from any real event. The threshold still matters -- with `>= 400` a
    // permanent client-side failure would delete the dedup row and Stripe would
    // retry it forever. When a handler starts returning a 4xx, delete this and
    // assert the behaviour in stripe-webhook.test.js instead.
    const source = read('../functions/api/stripe-webhook.js');
    assert.ok(source.includes('result.status >= 500'), 'rollback must be gated on 5xx');
    assert.ok(!source.includes('result.status >= 400'), 'the retired >= 400 threshold must stay retired');
  });
});

describe('billing invariants -- cross-file sweeps', () => {
  it('every enrollment read under functions/api/courses filters revoked_at IS NULL', () => {
    // REASON EXECUTION CANNOT PIN THIS: the property is about the ABSENCE of an
    // unfiltered query in any file, present or future. Executing the endpoints
    // that exist proves nothing about the next one someone adds.
    const dir = new URL('../functions/api/courses/', import.meta.url).pathname;
    let checked = 0;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const query of source.match(/FROM enrollment[\s\S]*?(?:\.first|\.all|\.run)\(\)/g) || []) {
        if (query.includes('INSERT')) continue;
        checked++;
        assert.ok(query.includes('revoked_at IS NULL'), `${file}: unfiltered enrollment read:\n${query.slice(0, 200)}`);
      }
    }
    assert.ok(checked > 0, 'the sweep matched no enrollment queries at all -- the regex has rotted');
  });
});

describe('billing invariants -- endpoints outside the executed surface', () => {
  it('the duplicate-subscription guard paginates and includes incomplete subs', () => {
    // REASON EXECUTION CANNOT PIN THIS HERE: findBlockingActiveSubscription
    // lives in the create-checkout path, whose whole body is live Stripe API
    // traffic. Executing it means mocking multi-page subscriptions.list, i.e.
    // asserting on the mock. Kept as a shape guard for the 2026-06-01
    // double-billing regression until create-checkout gets its own tranche.
    const source = read('../functions/api/billing/_migration-handoff.js');
    assert.ok(source.includes("s.status === 'incomplete'"), 'the blocking check must include incomplete');
    assert.ok(
      /for await\s*\([^)]*stripe\.subscriptions\.list/.test(source),
      'the blocking check must paginate via for-await over subscriptions.list'
    );
    assert.ok(!/existing\.data\.find\(/.test(source), 'single-page .data.find is the pagination-bypass regression');
    assert.ok(source.includes("blocking.status === 'incomplete'"), 'incomplete needs its own message');
    assert.ok(source.includes('pending membership checkout'), 'the incomplete message must be user-readable');
  });

  // MOVED 2026-07-28: 'billing/status never presents a terminal subscription as
  // current' lived here and asserted that the strings 'displayable', 'active',
  // 'trialing', 'past_due' and 'incomplete' appeared in status.js. All five
  // survive a rewrite that hands a canceled subscription to the account page,
  // so the test could not fail for the reason its name gave. The stated reason
  // -- "status.js reads subscription state straight from the Stripe API" -- was
  // wrong: stubExternalFetch already answers the Stripe API. The invariant is
  // now asserted on the response in test/billing-status.test.js.

  it('create-checkout refuses a live deploy whose tier price IDs are unconfigured', () => {
    // REASON EXECUTION CANNOT PIN THIS HERE: create-checkout's body is Stripe
    // session creation. The guard replaced a dead `priceId.includes('_test_')`
    // check (Stripe price IDs are opaque and can never contain it) on
    // 2026-07-02; this holds the replacement in place.
    const source = read('../functions/api/create-checkout.js');
    assert.ok(!source.includes("priceId.includes('_test_')"), 'the dead _test_ substring check must stay retired');
    assert.ok(source.includes("STRIPE_SECRET_KEY.startsWith('sk_live_')"), 'the guard must gate on a live secret key');
    assert.ok(/Object\.entries\(priceMap\)\.find\(/.test(source), 'the guard must check every configured tier price');
    assert.ok(/error:\s*'Payments not configured'\s*\},\s*503\s*\)/.test(source), 'misconfiguration must 503, not proceed');
  });
});
