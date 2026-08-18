/**
 * Unit tests for sendGA4Event (functions/api/_ga4.js) on the conversion branch,
 * the one taken when the caller passes no client_id/session_id overrides and
 * attribution comes straight from buildSourceParams().
 * Run with: node --test test/ga4-event.test.js
 *
 * Uses stubExternalFetch() so the Measurement Protocol payload can be read off
 * its parsed `ga4` view and an unrouted host throws instead of reaching the
 * network. sendGA4Event awaits its own fetch, so there is no waitUntil to drain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sendGA4Event } from '../functions/api/_ga4.js';
import { mockRequest, mockEnv, stubExternalFetch } from './_helpers.js';

function makeRequest(entryUrl) {
  return mockRequest('POST', {
    headers: {
      'CF-Connecting-IP': '203.0.113.5',
      'User-Agent': 'test',
      Cookie: 'entry_ref=; entry_url=' + encodeURIComponent(entryUrl),
    },
    url: 'https://rrmacademy.org/api/newsletter/subscribe',
  });
}

describe('sendGA4Event -- PII screen on server-derived attribution', () => {
  it('drops an email address stamped into utm_term by an external newsletter', async () => {
    const fetchStub = stubExternalFetch();
    try {
      const request = makeRequest(
        'https://rrmacademy.org/?utm_source=partner_news&utm_medium=email' +
        '&utm_campaign=aug&utm_term=jane.doe%40example.com'
      );
      await sendGA4Event(mockEnv(), request, 'generate_lead', { lead_source: 'newsletter' });
      assert.equal(fetchStub.ga4.length, 1, 'exactly one Measurement Protocol call');
      const p = fetchStub.ga4[0].body.events[0].params;
      assert.ok(!('utm_term' in p), 'an email address in utm_term must never reach GA4');
      assert.equal(p.utm_source, 'partner_news');
      assert.equal(p.utm_campaign, 'aug');
      assert.equal(p.lead_source, 'newsletter');
      // session_id survives the screen only because it is a number.
      // deriveSessionId returns a uint32 and roughly 77% of that value space is
      // a 10-digit run, which is exactly the phone shape the screen drops, so
      // stringifying it would silently strip session_id off most server
      // conversion events with no other test noticing.
      assert.ok('session_id' in p, 'session_id must survive the screen');
      assert.equal(typeof p.session_id, 'number', 'session_id must stay a number: a stringified 10-digit uint32 matches the phone shape');
    } finally { fetchStub.restore(); }
  });

  it('drops a phone number stamped into utm_content and keeps the rest of the set', async () => {
    const fetchStub = stubExternalFetch();
    try {
      const request = makeRequest(
        'https://rrmacademy.org/?utm_source=partner_news&utm_medium=email' +
        '&utm_campaign=aug&utm_content=555-123-4567'
      );
      await sendGA4Event(mockEnv(), request, 'generate_lead', { lead_source: 'newsletter' });
      assert.equal(fetchStub.ga4.length, 1, 'exactly one Measurement Protocol call');
      const p = fetchStub.ga4[0].body.events[0].params;
      assert.ok(!('utm_content' in p), 'a phone number in utm_content must never reach GA4');
      assert.equal(p.utm_source, 'partner_news');
      assert.equal(p.utm_medium, 'email');
      assert.equal(p.utm_campaign, 'aug');
      assert.equal(p.lead_source, 'newsletter');
      assert.equal(typeof p.session_id, 'number', 'session_id must stay a number: a stringified 10-digit uint32 matches the phone shape');
    } finally { fetchStub.restore(); }
  });
});
