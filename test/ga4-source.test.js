// test/ga4-source.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, extractUtm, classifyPaid, deriveSessionId, buildSourceParams, parseFirstTouch } from '../functions/api/_ga4-source.js';

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

  it('clamps a captured value to the GA4 100-character parameter limit', () => {
    const long = 'a'.repeat(150);
    const result = extractUtm(`https://rrmacademy.org/?utm_campaign=${long}`);
    assert.equal(result.utm_campaign.length, 100);
    assert.equal(result.utm_campaign, 'a'.repeat(100));
  });

  it('leaves a value of exactly 100 characters unchanged', () => {
    const exact = 'b'.repeat(100);
    const result = extractUtm(`https://rrmacademy.org/?utm_campaign=${exact}`);
    assert.equal(result.utm_campaign, exact);
  });

  it('drops an email that straddles the 100-character clamp boundary', () => {
    const straddling = `${'x'.repeat(88)}jane.doe@example.com`;
    assert.equal(straddling.length, 108);
    const result = extractUtm(`https://rrmacademy.org/?utm_term=${straddling}`);
    assert.equal('utm_term' in result, false);
  });

  it('drops a 13-digit card-shaped value', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_content=1234567890123');
    assert.equal('utm_content' in result, false);
  });

  it('keeps a 12-digit value (below the card-shape band)', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_content=818477153915');
    assert.equal(result.utm_content, '818477153915');
  });
});

describe('classifyPaid', () => {
  it('returns null for a URL with no query string', () => {
    assert.equal(classifyPaid('https://rrmacademy.org/endo-quiz/'), null);
  });

  it('returns null for organic-looking utm params', () => {
    assert.equal(classifyPaid('https://rrmacademy.org/?utm_source=newsletter&utm_medium=email'), null);
  });

  it('classifies a bare gclid as paid google cpc', () => {
    const result = classifyPaid('https://rrmacademy.org/?gclid=EAIaIQobChMI-test');
    assert.deepStrictEqual(result, {
      source: 'google',
      medium: 'cpc',
      entry_category: 'paid',
      entry_platform: 'google',
    });
  });

  it('maps gbraid and wbraid to google and msclkid to bing', () => {
    assert.equal(classifyPaid('https://rrmacademy.org/?gbraid=abc123').entry_platform, 'google');
    assert.equal(classifyPaid('https://rrmacademy.org/?wbraid=abc123').entry_platform, 'google');
    assert.equal(classifyPaid('https://rrmacademy.org/?msclkid=abc123').entry_platform, 'bing');
  });

  it('returns null for fbclid alone (Facebook appends it to organic clicks too)', () => {
    assert.equal(classifyPaid('https://rrmacademy.org/?fbclid=abc123'), null);
  });

  it('classifies a paid utm_medium with no click id', () => {
    const result = classifyPaid('https://rrmacademy.org/?utm_medium=cpc&utm_source=gads');
    assert.equal(result.entry_category, 'paid');
    assert.equal(result.entry_platform, 'gads');
    assert.equal(result.source, 'gads');
    assert.equal(result.medium, 'cpc');
  });

  it('lowercases utm_source when it becomes the platform', () => {
    const result = classifyPaid('https://rrmacademy.org/?utm_medium=paid_social&utm_source=Instagram');
    assert.equal(result.entry_category, 'paid');
    assert.equal(result.entry_platform, 'instagram');
    assert.equal(result.medium, 'paid_social');
  });

  it('accepts every GA4 paid medium spelling', () => {
    assert.equal(classifyPaid('https://rrmacademy.org/?utm_medium=ppc').entry_category, 'paid');
    assert.equal(classifyPaid('https://rrmacademy.org/?utm_medium=retargeting').entry_category, 'paid');
    assert.equal(classifyPaid('https://rrmacademy.org/?utm_medium=display_cpm').entry_category, 'paid');
  });

  it('falls back to (paid) when nothing names the platform', () => {
    const result = classifyPaid('https://rrmacademy.org/?utm_medium=cpc');
    assert.equal(result.entry_category, 'paid');
    assert.equal(result.entry_platform, null);
    assert.equal(result.source, '(paid)');
  });

  it('prefers the click id platform over a free-text utm_source', () => {
    const result = classifyPaid('https://rrmacademy.org/?gclid=abc123&utm_source=gads');
    assert.equal(result.entry_platform, 'google');
    assert.equal(result.source, 'gads');
  });

  it('returns null for an empty click id value', () => {
    assert.equal(classifyPaid('https://rrmacademy.org/?gclid='), null);
  });

  it('returns null for a malformed URL instead of throwing', () => {
    assert.equal(classifyPaid('not a url'), null);
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
    assert.equal(params.entry_category, 'paid');
    assert.equal(params.entry_platform, 'gads');
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

describe('buildSourceParams paid override', () => {
  // Helper: fake a Request with headers
  function fakeRequest(headers = {}) {
    return {
      url: 'https://rrmacademy.org/api/track',
      headers: {
        get(name) { return headers[name] || null; },
      },
    };
  }

  const AD_ENTRY_URL = 'https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc' +
    '&utm_campaign=google_ads_endometriosis_symptom_quiz_2026-q3' +
    '&utm_content=818477153915&gclid=EAIaIQobChMI-test';

  it('classifies a Google Ads landing with no referrer as paid', async () => {
    const req = fakeRequest({
      'Cookie': 'entry_ref=; entry_url=' + encodeURIComponent(AD_ENTRY_URL),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.entry_category, 'paid');
    assert.equal(params.entry_platform, 'google');
    assert.equal(params.utm_source, 'google');
    assert.equal(params.utm_medium, 'cpc');
    assert.equal(params.utm_campaign, 'google_ads_endometriosis_symptom_quiz_2026-q3');
    assert.equal(params.utm_content, '818477153915');
  });

  it('beats an organic google referrer', async () => {
    const req = fakeRequest({
      'Cookie': 'entry_ref=' + encodeURIComponent('https://www.google.com/') +
                '; entry_url=' + encodeURIComponent(AD_ENTRY_URL),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.entry_category, 'paid');
    assert.equal(params.entry_platform, 'google');
  });

  it('beats the email override and drops email_type', async () => {
    const entryUrl = 'https://rrmacademy.org/?utm_source=email&utm_medium=newsletter&gclid=abc123';
    const req = fakeRequest({
      'Cookie': 'entry_url=' + encodeURIComponent(entryUrl),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.entry_category, 'paid');
    assert.equal(params.entry_platform, 'google');
    assert.equal('email_type' in params, false);
  });

  it('leaves an fbclid social landing untouched', async () => {
    const req = fakeRequest({
      'Cookie': 'entry_ref=' + encodeURIComponent('https://l.instagram.com/something') +
                '; entry_url=' + encodeURIComponent('https://rrmacademy.org/?fbclid=abc'),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.entry_category, 'social');
    assert.equal(params.entry_platform, 'instagram');
  });

  it('keeps the referrer-derived platform when nothing names the ad platform', async () => {
    const req = fakeRequest({
      'Cookie': 'entry_ref=; entry_url=' + encodeURIComponent('https://rrmacademy.org/?utm_medium=cpc'),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.entry_category, 'paid');
    assert.equal(params.entry_platform, 'direct');
  });
});

// Builds an rrm_ft cookie exactly the way BaseLayout.astro's writer does:
// each field value individually encodeURIComponent-ed, joined with a raw
// (unencoded) '&', and the whole thing assigned as the cookie value with
// NO outer encode. This is the actual wire format parseFirstTouch parses --
// never wrap the joined body in an outer encodeURIComponent here, that
// models a cookie shape the writer never produces.
function ftCookie(fields) {
  const parts = Object.keys(fields).map((key) => key + '=' + encodeURIComponent(fields[key]));
  return 'rrm_ft=' + parts.join('&');
}

describe('parseFirstTouch', () => {
  it('returns null when the cookie is absent', () => {
    assert.equal(parseFirstTouch(''), null);
    assert.equal(parseFirstTouch('other_cookie=1'), null);
  });

  it('parses every field and derives ft_at as ISO from d', () => {
    const cookie = ftCookie({ s: 'google', m: 'cpc', c: 'q3_push', k: 'ad1', l: '/endo-quiz/', g: 'gEAIaIQtest', d: '1757030400' });
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_source, 'google');
    assert.equal(result.ft_medium, 'cpc');
    assert.equal(result.ft_campaign, 'q3_push');
    assert.equal(result.ft_content, 'ad1');
    assert.equal(result.ft_landing, '/endo-quiz/');
    assert.equal(result.click_id, 'EAIaIQtest');
    assert.equal(result.ft_at, new Date(1757030400 * 1000).toISOString());
  });

  it('strips the kind marker prefix from click_id, leaving only the value', () => {
    const cookie = ftCookie({ g: 'bBRAID_VALUE_HERE' });
    assert.equal(parseFirstTouch(cookie).click_id, 'BRAID_VALUE_HERE');
  });

  it('screens an email-shaped field to absent rather than passing it through', () => {
    const cookie = ftCookie({ s: 'google', k: 'someone@example.com' });
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_source, 'google');
    assert.equal('ft_content' in result, false);
  });

  it('screens a bare 13-19 digit run field to absent', () => {
    const cookie = ftCookie({ s: 'google', c: '1234567890123456' });
    const result = parseFirstTouch(cookie);
    assert.equal('ft_campaign' in result, false);
    assert.equal(result.ft_source, 'google');
  });

  it('returns null when every field was screened out', () => {
    const cookie = ftCookie({ k: 'someone@example.com' });
    assert.equal(parseFirstTouch(cookie), null);
  });

  it('caps a field at 100 chars', () => {
    const long = 'a'.repeat(150);
    const cookie = ftCookie({ s: long });
    assert.equal(parseFirstTouch(cookie).ft_source.length, 100);
  });

  it('an unparseable d leaves ft_at unset without discarding the rest', () => {
    const cookie = ftCookie({ s: 'google', d: 'not-a-number' });
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_source, 'google');
    assert.equal('ft_at' in result, false);
  });

  it('a literal % in utm_campaign round-trips intact (single decode, not double)', () => {
    const cookie = ftCookie({ c: '50%off' });
    assert.equal(parseFirstTouch(cookie).ft_campaign, '50%off');
  });

  it('a field whose encoded form contains %26 (an & inside a value) survives the split', () => {
    const cookie = ftCookie({ s: 'google', k: 'a&b', d: '1757030400' });
    const result = parseFirstTouch(cookie);
    assert.equal(result.ft_content, 'a&b');
    assert.equal(result.ft_source, 'google', 'the field after the embedded & is unaffected');
    assert.equal(result.ft_at, new Date(1757030400 * 1000).toISOString(), 'the field after the embedded & is unaffected');
  });
});

describe('buildSourceParams spreads first-touch attribution', () => {
  function fakeRequest(headers = {}) {
    return {
      url: 'https://rrmacademy.org/api/track',
      headers: { get(name) { return headers[name] || null; } },
    };
  }

  it('carries ft_* alongside last-touch utm_* without overwriting either', async () => {
    const req = fakeRequest({
      'Cookie': 'entry_url=' + encodeURIComponent('https://rrmacademy.org/?utm_source=organic_google&utm_campaign=today') +
        '; ' + ftCookie({ s: 'google', m: 'cpc', c: 'q3_push', d: '1757030400' }),
    });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal(params.utm_source, 'organic_google', 'last-touch utm_source is untouched');
    assert.equal(params.utm_campaign, 'today', 'last-touch utm_campaign is untouched');
    assert.equal(params.ft_source, 'google');
    assert.equal(params.ft_medium, 'cpc');
    assert.equal(params.ft_campaign, 'q3_push');
  });

  it('omits ft_* entirely when no rrm_ft cookie is present', async () => {
    const req = fakeRequest({ 'Cookie': 'entry_url=' + encodeURIComponent('https://rrmacademy.org/') });
    const params = await buildSourceParams(req, 'test-client-id');
    assert.equal('ft_source' in params, false);
  });
});
