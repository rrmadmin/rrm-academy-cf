// test/ga4-source.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, extractUtm, deriveSessionId, buildSourceParams } from '../functions/api/_ga4-source.js';

describe('classifySource', () => {
  it('returns direct for empty referrer', () => {
    const result = classifySource('');
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)', entry_category: 'direct', entry_platform: 'direct' });
  });

  it('returns direct for null referrer', () => {
    const result = classifySource(null);
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)', entry_category: 'direct', entry_platform: 'direct' });
  });

  it('classifies google.com as organic', () => {
    const result = classifySource('https://www.google.com/search?q=rrm');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic', entry_category: 'organic', entry_platform: 'google' });
  });

  it('classifies google.co.uk as organic', () => {
    const result = classifySource('https://www.google.co.uk/');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic', entry_category: 'organic', entry_platform: 'google' });
  });

  it('classifies bing.com as organic (not AI)', () => {
    const result = classifySource('https://www.bing.com/search?q=napro');
    assert.deepStrictEqual(result, { source: 'bing', medium: 'organic', entry_category: 'organic', entry_platform: 'bing' });
  });

  it('classifies duckduckgo.com as organic', () => {
    const result = classifySource('https://duckduckgo.com/?q=rrm');
    assert.deepStrictEqual(result, { source: 'duckduckgo', medium: 'organic', entry_category: 'organic', entry_platform: 'duckduckgo' });
  });

  it('classifies instagram.com as social', () => {
    const result = classifySource('https://l.instagram.com/something');
    assert.deepStrictEqual(result, { source: 'instagram', medium: 'social', entry_category: 'social', entry_platform: 'instagram' });
  });

  it('classifies facebook.com as social', () => {
    const result = classifySource('https://l.facebook.com/l.php?u=...');
    assert.deepStrictEqual(result, { source: 'facebook', medium: 'social', entry_category: 'social', entry_platform: 'facebook' });
  });

  it('classifies linkedin.com as social', () => {
    const result = classifySource('https://www.linkedin.com/feed');
    assert.deepStrictEqual(result, { source: 'linkedin', medium: 'social', entry_category: 'social', entry_platform: 'linkedin' });
  });

  it('classifies twitter/x as social', () => {
    const result = classifySource('https://t.co/abc123');
    assert.deepStrictEqual(result, { source: 'twitter', medium: 'social', entry_category: 'social', entry_platform: 'twitter' });
  });

  it('classifies unknown referrer as referral', () => {
    const result = classifySource('https://somesite.com/page');
    assert.deepStrictEqual(result, { source: 'somesite.com', medium: 'referral', entry_category: 'referral', entry_platform: 'somesite.com' });
  });

  it('ignores self-referrals from rrmacademy.org', () => {
    const result = classifySource('https://rrmacademy.org/library/some-article');
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)', entry_category: 'direct', entry_platform: 'direct' });
  });

  it('classifies yahoo as organic', () => {
    const result = classifySource('https://search.yahoo.com/search?p=rrm');
    assert.deepStrictEqual(result, { source: 'yahoo', medium: 'organic', entry_category: 'organic', entry_platform: 'yahoo' });
  });

  it('does NOT classify mail.google.com as organic', () => {
    const result = classifySource('https://mail.google.com/mail/');
    assert.deepStrictEqual(result, { source: 'mail.google.com', medium: 'referral', entry_category: 'referral', entry_platform: 'mail.google.com' });
  });

  it('does NOT classify docs.google.com as organic', () => {
    const result = classifySource('https://docs.google.com/document/d/123');
    assert.deepStrictEqual(result, { source: 'docs.google.com', medium: 'referral', entry_category: 'referral', entry_platform: 'docs.google.com' });
  });

  it('classifies bare google.com as organic', () => {
    const result = classifySource('https://google.com/');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic', entry_category: 'organic', entry_platform: 'google' });
  });

  it('classifies chatgpt.com as AI agent', () => {
    const result = classifySource('https://chatgpt.com/');
    assert.deepStrictEqual(result, { source: 'chatgpt', medium: 'ai', entry_category: 'ai', entry_platform: 'chatgpt' });
  });

  it('classifies perplexity.ai as AI agent', () => {
    const result = classifySource('https://perplexity.ai/search?q=rrm');
    assert.deepStrictEqual(result, { source: 'perplexity', medium: 'ai', entry_category: 'ai', entry_platform: 'perplexity' });
  });

  it('classifies bing.com/chat as copilot (AI), not bing (organic)', () => {
    const result = classifySource('https://www.bing.com/chat');
    assert.deepStrictEqual(result, { source: 'copilot', medium: 'ai', entry_category: 'ai', entry_platform: 'copilot' });
  });

  it('classifies claude.ai as AI agent', () => {
    const result = classifySource('https://claude.ai/');
    assert.deepStrictEqual(result, { source: 'claude', medium: 'ai', entry_category: 'ai', entry_platform: 'claude' });
  });
});

describe('extractUtm', () => {
  it('returns empty object for URL with no UTM params', () => {
    const result = extractUtm('https://rrmacademy.org/library/');
    assert.deepStrictEqual(result, {});
  });

  it('extracts utm_source', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_source=newsletter');
    assert.deepStrictEqual(result, { utm_source: 'newsletter' });
  });

  it('extracts all UTM params', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_source=ig&utm_medium=social&utm_campaign=spring2026');
    assert.deepStrictEqual(result, {
      utm_source: 'ig',
      utm_medium: 'social',
      utm_campaign: 'spring2026',
    });
  });

  it('extracts utm_content and utm_term', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_source=google&utm_content=cta&utm_term=napro');
    assert.deepStrictEqual(result, {
      utm_source: 'google',
      utm_content: 'cta',
      utm_term: 'napro',
    });
  });

  it('ignores non-UTM params', () => {
    const result = extractUtm('https://rrmacademy.org/?page=2&utm_source=test&sort=date');
    assert.deepStrictEqual(result, { utm_source: 'test' });
  });
});

describe('deriveSessionId', () => {
  it('returns a positive integer', async () => {
    const id = await deriveSessionId('abc123client', '2026-03-09');
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);
    assert.ok(Number.isInteger(id));
  });

  it('returns same value for same client + date', async () => {
    const a = await deriveSessionId('abc123client', '2026-03-09');
    const b = await deriveSessionId('abc123client', '2026-03-09');
    assert.equal(a, b);
  });

  it('returns different value for different dates', async () => {
    const a = await deriveSessionId('abc123client', '2026-03-09');
    const b = await deriveSessionId('abc123client', '2026-03-10');
    assert.notEqual(a, b);
  });

  it('returns different value for different clients', async () => {
    const a = await deriveSessionId('client1', '2026-03-09');
    const b = await deriveSessionId('client2', '2026-03-09');
    assert.notEqual(a, b);
  });
});

describe('source metadata round-trip (checkout -> webhook)', () => {
  it('extractUtm + classifySource produce values that override in sendGA4Event', () => {
    // Simulates: user arrives from Instagram with UTM params
    const referrer = 'https://l.instagram.com/something';
    const url = 'https://rrmacademy.org/donate?utm_source=ig_bio&utm_medium=social&utm_campaign=spring2026';

    const { source, medium } = classifySource(referrer);
    const utmParams = extractUtm(url);

    // UTM params take priority over referrer
    const gaSource = utmParams.utm_source || source;
    const gaMedium = utmParams.utm_medium || medium;

    assert.equal(gaSource, 'ig_bio');
    assert.equal(gaMedium, 'social');

    // Without UTMs, falls back to referrer
    const url2 = 'https://rrmacademy.org/donate';
    const utmParams2 = extractUtm(url2);
    const gaSource2 = utmParams2.utm_source || source;
    const gaMedium2 = utmParams2.utm_medium || medium;

    assert.equal(gaSource2, 'instagram');
    assert.equal(gaMedium2, 'social');
  });
});

describe('buildSourceParams cookie-based attribution', () => {
  // Helper: fake a Request with headers
  function fakeRequest(headers = {}) {
    return {
      url: 'https://rrmacademy.org/api/auth/signup',
      headers: {
        get(name) { return headers[name] || null; },
      },
    };
  }

  it('uses entry_ref cookie over Referer header for source classification', async () => {
    const req = fakeRequest({
      // Referer is self-referral (API call from the site)
      'Referer': 'https://rrmacademy.org/signup',
      // Cookie carries the original external referrer
      'Cookie': 'entry_ref=' + encodeURIComponent('https://l.instagram.com/something') + '; session=abc',
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.utm_source, 'instagram');
    assert.equal(params.utm_medium, 'social');
  });

  it('uses entry_url cookie for UTM extraction', async () => {
    const req = fakeRequest({
      'Referer': 'https://rrmacademy.org/donate',
      'Cookie': 'entry_ref=' + encodeURIComponent('https://www.google.com/') +
                '; entry_url=' + encodeURIComponent('https://rrmacademy.org/?utm_source=gads&utm_medium=cpc&utm_campaign=spring'),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.utm_source, 'gads');
    assert.equal(params.utm_medium, 'cpc');
    assert.equal(params.utm_campaign, 'spring');
  });

  it('falls back to Referer header when no cookies present', async () => {
    const req = fakeRequest({
      'Referer': 'https://www.bing.com/search?q=rrm',
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.utm_source, 'bing');
    assert.equal(params.utm_medium, 'organic');
  });

  it('returns direct when no cookies and self-referral', async () => {
    const req = fakeRequest({
      'Referer': 'https://rrmacademy.org/library',
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.utm_source, '(direct)');
    assert.equal(params.utm_medium, '(none)');
  });
});
