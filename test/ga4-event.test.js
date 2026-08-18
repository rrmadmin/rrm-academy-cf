/**
 * Unit tests for sendGA4Event (functions/api/_ga4.js) on the conversion branch,
 * the one taken when the caller passes no client_id/session_id overrides and
 * attribution comes straight from buildSourceParams().
 * Run with: node --test test/ga4-event.test.js
 *
 * Stubs globalThis.fetch the way test/track-endpoint.test.js does so the
 * Measurement Protocol payload can be asserted without a network call.
 * sendGA4Event awaits its own fetch, so there is no waitUntil to drain here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sendGA4Event } from '../functions/api/_ga4.js';
import { mockRequest, mockEnv } from './_helpers.js';

function makeFetchStub() {
  const state = { callCount: 0, bodies: [] };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('google-analytics.com')) {
      state.callCount++;
      try { state.bodies.push(JSON.parse(init.body)); } catch { state.bodies.push(null); }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    if (original) return original(url);
    return new Response('', { status: 200 });
  };
  const restore = () => { globalThis.fetch = original; };
  return { state, restore };
}

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
    const { restore, state } = makeFetchStub();
    try {
      const request = makeRequest(
        'https://rrmacademy.org/?utm_source=partner_news&utm_medium=email' +
        '&utm_campaign=aug&utm_term=jane.doe%40example.com'
      );
      await sendGA4Event(mockEnv(), request, 'generate_lead', { lead_source: 'newsletter' });
      assert.equal(state.bodies.length, 1, 'exactly one Measurement Protocol call');
      const p = state.bodies[0].events[0].params;
      assert.ok(!('utm_term' in p), 'an email address in utm_term must never reach GA4');
      assert.equal(p.utm_source, 'partner_news');
      assert.equal(p.utm_campaign, 'aug');
      assert.equal(p.lead_source, 'newsletter');
    } finally { restore(); }
  });

  it('drops a phone number stamped into utm_content and keeps the rest of the set', async () => {
    const { restore, state } = makeFetchStub();
    try {
      const request = makeRequest(
        'https://rrmacademy.org/?utm_source=partner_news&utm_medium=email' +
        '&utm_campaign=aug&utm_content=555-123-4567'
      );
      await sendGA4Event(mockEnv(), request, 'generate_lead', { lead_source: 'newsletter' });
      assert.equal(state.bodies.length, 1, 'exactly one Measurement Protocol call');
      const p = state.bodies[0].events[0].params;
      assert.ok(!('utm_content' in p), 'a phone number in utm_content must never reach GA4');
      assert.equal(p.utm_source, 'partner_news');
      assert.equal(p.utm_medium, 'email');
      assert.equal(p.utm_campaign, 'aug');
      assert.equal(p.lead_source, 'newsletter');
    } finally { restore(); }
  });
});
