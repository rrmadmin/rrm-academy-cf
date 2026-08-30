/**
 * scripts/verify-citations.mjs -- bot-blocking domain soft-pass.
 *
 * Regression for the rrm-physician-spotlight-phil-boyle-md single-record
 * dispatch (run 33292276691), which hard-failed on a link to
 * https://instagram.com/neofertilityireland: Instagram blocks CI's
 * datacenter IP (login wall / rate limit) even though the profile is real,
 * so the checker reported "Not found in any database" and blocked the
 * deploy. BOT_BLOCKING_DOMAINS decides these up front by hostname instead
 * of relying on a specific HTTP response, and isBotBlockingDomain() is the
 * pure predicate the checker consults before ever issuing the fetch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBotBlockingDomain, BOT_BLOCKING_DOMAINS } from '../scripts/verify-citations.mjs';

describe('verify-citations: bot-blocking domain allowlist', () => {
  it('soft-passes instagram.com (the actual failing citation)', () => {
    assert.equal(isBotBlockingDomain('https://instagram.com/neofertilityireland'), true);
  });

  it('soft-passes www.instagram.com', () => {
    assert.equal(isBotBlockingDomain('https://www.instagram.com/neofertilityireland'), true);
  });

  it('does not weaken checking for an ordinary domain', () => {
    assert.equal(isBotBlockingDomain('https://pubmed.ncbi.nlm.nih.gov/12345678'), false);
    assert.equal(isBotBlockingDomain('https://www.factsaboutfertility.org/'), false);
  });

  it('does not throw on a malformed URL', () => {
    assert.equal(isBotBlockingDomain('not-a-url'), false);
  });

  it('keeps the allowlist scoped to known bot-blockers, not a general skip list', () => {
    for (const domain of BOT_BLOCKING_DOMAINS) {
      assert.match(domain, /instagram\.com|facebook\.com|x\.com|twitter\.com|linkedin\.com/);
    }
  });
});
