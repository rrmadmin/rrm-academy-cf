import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execution cannot pin create-checkout.js -- its whole body is live Stripe
// API calls (see billing-source-invariants.test.js). These asserts pin the
// STUC join-denylist wiring the same way the rest of the migration-handoff
// logic is pinned: source-grep against the real file.
const source = readFileSync(new URL('../functions/api/create-checkout.js', import.meta.url), 'utf8');
const denylistSource = readFileSync(new URL('../functions/api/billing/_join-denylist.js', import.meta.url), 'utf8');

const subscriptionBranch = source.slice(
  source.indexOf("if (mode === 'subscription') {"),
  source.indexOf('// --- Wix migration: validate optional wix_sub_id input ---')
);
const donationBranch = source.slice(
  source.indexOf("if (mode === 'payment') {"),
  source.indexOf('const cents = Number(amount);')
);

describe('create-checkout -- STUC join denylist', () => {
  it('imports the denylist helpers', () => {
    assert.match(source, /import\s*\{[^}]*isJoinDenied[^}]*\}\s*from\s*'\.\/billing\/_join-denylist\.js'/);
  });

  it('checks isJoinDenied before any Wix lookup or lock acquisition in the subscription branch', () => {
    assert.ok(subscriptionBranch.includes('isJoinDenied(userEmail)'),
      'subscription branch must check isJoinDenied(userEmail) before the Wix migration lookup');
  });

  it('refuses a denied subscriber with the byte-identical generic 503 body used for Stripe failures', () => {
    const stripeFailureBody = "return json({ ok: false, error: 'Payment service temporarily unavailable. Please try again.' }, 503);";
    const occurrences = source.split(stripeFailureBody).length - 1;
    assert.ok(occurrences >= 3,
      'the exact 503 body must be reused (Stripe checkout-create failure, subscription denylist refusal, payment denylist refusal)');
    assert.ok(subscriptionBranch.includes(stripeFailureBody));
  });

  it('never puts the raw denied email in the analytics blob or log message', () => {
    assert.ok(!/blobs:\s*\[[^\]]*userEmail/.test(subscriptionBranch),
      'the EVENTS datapoint must not carry the raw email -- use userId or a masked email');
    assert.ok(subscriptionBranch.includes('maskEmailForLog(userEmail)'),
      'the log() call must mask the email when no userId is available');
  });

  it('does not touch the donation branch when there is no STUC context', () => {
    assert.ok(donationBranch.includes('isStucContextRequest('),
      'the donation branch must gate the denylist check on STUC context, never refuse a plain donation');
    assert.ok(donationBranch.includes('isJoinDenied(userEmail) && stucContext'),
      'a denied donor must only be refused when the checkout is STUC-context');
  });

  it('stamps stuc_context on the session metadata for every STUC-context donation, not only denied ones', () => {
    assert.match(source, /stuc_context:\s*'1'/, 'metadata must carry stuc_context so the webhook can see it later');
  });
});

describe('_join-denylist -- pure functions', () => {
  it('isJoinDenied is case- and whitespace-insensitive and null-safe', async () => {
    const { isJoinDenied } = await import('../functions/api/billing/_join-denylist.js');
    assert.equal(isJoinDenied('drduane@factsaboutfertility.org'), true);
    assert.equal(isJoinDenied('  Drduane@FactsAboutFertility.ORG  '), true);
    assert.equal(isJoinDenied('someoneelse@example.com'), false);
    assert.equal(isJoinDenied(null), false);
    assert.equal(isJoinDenied(undefined), false);
    assert.equal(isJoinDenied(''), false);
  });

  it('isStucContextRequest recognizes the STUC page via entry_url, entry_referrer or campaign', async () => {
    const { isStucContextRequest } = await import('../functions/api/billing/_join-denylist.js');
    const req = new Request('https://rrmacademy.org/api/create-checkout', { method: 'POST' });
    assert.equal(isStucContextRequest(req, 'https://rrmacademy.org/save-the-uterus-club/', '', ''), true);
    assert.equal(isStucContextRequest(req, '', 'https://rrmacademy.org/save-the-uterus-club/', ''), true);
    assert.equal(isStucContextRequest(req, '', '', 'stuc'), true);
    assert.equal(isStucContextRequest(req, 'https://rrmacademy.org/donate/', '', ''), false);
  });

  it('maskEmailForLog never returns the full address', async () => {
    const { maskEmailForLog } = await import('../functions/api/billing/_join-denylist.js');
    const masked = maskEmailForLog('drduane@factsaboutfertility.org');
    assert.ok(masked.startsWith('drd'));
    assert.ok(masked.includes('@factsaboutfertility.org'));
    assert.ok(!masked.includes('drduane@'));
  });

  it('the module comment never names the person or the reason', () => {
    assert.ok(!/duane/i.test(denylistSource.split('\n').slice(0, 6).join('\n')),
      'the top-of-file comment must stay generic');
  });
});
