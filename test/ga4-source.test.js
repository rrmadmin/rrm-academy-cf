// test/ga4-source.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, extractUtm, deriveSessionId } from '../functions/api/_ga4-source.js';

describe('classifySource', () => {
  it('returns direct for empty referrer', () => {
    const result = classifySource('');
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)' });
  });

  it('returns direct for null referrer', () => {
    const result = classifySource(null);
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)' });
  });

  it('classifies google.com as organic', () => {
    const result = classifySource('https://www.google.com/search?q=rrm');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic' });
  });

  it('classifies google.co.uk as organic', () => {
    const result = classifySource('https://www.google.co.uk/');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic' });
  });

  it('classifies bing.com as organic', () => {
    const result = classifySource('https://www.bing.com/search?q=napro');
    assert.deepStrictEqual(result, { source: 'bing', medium: 'organic' });
  });

  it('classifies duckduckgo.com as organic', () => {
    const result = classifySource('https://duckduckgo.com/?q=rrm');
    assert.deepStrictEqual(result, { source: 'duckduckgo', medium: 'organic' });
  });

  it('classifies instagram.com as social', () => {
    const result = classifySource('https://l.instagram.com/something');
    assert.deepStrictEqual(result, { source: 'instagram', medium: 'social' });
  });

  it('classifies facebook.com as social', () => {
    const result = classifySource('https://l.facebook.com/l.php?u=...');
    assert.deepStrictEqual(result, { source: 'facebook', medium: 'social' });
  });

  it('classifies linkedin.com as social', () => {
    const result = classifySource('https://www.linkedin.com/feed');
    assert.deepStrictEqual(result, { source: 'linkedin', medium: 'social' });
  });

  it('classifies twitter/x as social', () => {
    const result = classifySource('https://t.co/abc123');
    assert.deepStrictEqual(result, { source: 'twitter', medium: 'social' });
  });

  it('classifies unknown referrer as referral', () => {
    const result = classifySource('https://somesite.com/page');
    assert.deepStrictEqual(result, { source: 'somesite.com', medium: 'referral' });
  });

  it('ignores self-referrals from rrmacademy.org', () => {
    const result = classifySource('https://rrmacademy.org/library/some-article');
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)' });
  });

  it('classifies yahoo as organic', () => {
    const result = classifySource('https://search.yahoo.com/search?p=rrm');
    assert.deepStrictEqual(result, { source: 'yahoo', medium: 'organic' });
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
