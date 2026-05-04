/**
 * Tests for POST /api/contact/submit (functions/api/contact/submit.js)
 * Run with: node --test test/contact-submit.test.js
 *
 * Stubs all external fetch (Turnstile, DNS MX, ELV, SES) for happy-path tests.
 * Asserts:
 *   - new category enum validation (valid + invalid + missing default)
 *   - new category_source enum validation
 *   - subject prefix construction (delegated to _subject.js -- light coverage here)
 *   - honeypot returns 200 silently
 *   - missing category defaults to 'other' (deploy back-compat)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/contact/submit.js';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

function stubFetchSuccess() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    // aws4fetch passes a Request object; extract the URL string from it
    const u = (url && typeof url === 'object' && url.url) ? url.url : String(url);
    if (u.includes('siteverify')) return { ok: true, json: async () => ({ success: true }) };
    if (u.includes('cloudflare-dns.com') && u.includes('type=MX')) return { ok: true, json: async () => ({ Answer: [{ data: 'mx.example.com' }] }) };
    if (u.includes('cloudflare-dns.com') && u.includes('type=A')) return { ok: true, json: async () => ({ Answer: [{ data: '1.2.3.4' }] }) };
    if (u.includes('emaillistverify.com')) return { ok: true, text: async () => 'ok' };
    if (u.includes('amazonaws.com')) {
      return { ok: true, status: 200, json: async () => ({ MessageId: 'mock-message-id' }), text: async () => '{}' };
    }
    return original ? original(url, opts) : new Response('', { status: 200 });
  };
  return () => { globalThis.fetch = original; };
}

function makeBody(overrides = {}) {
  return {
    name: 'Alice Tester',
    email: 'alice@example.com',
    message: 'Hello, this is a test message that is long enough.',
    category: 'course',
    category_source: 'card',
    turnstileToken: 'tok-' + Math.random(),
    website: '',
    ...overrides,
  };
}

function makeContext(bodyOverrides = {}) {
  const ip = randomIp();
  return {
    request: mockRequest('POST', {
      body: makeBody(bodyOverrides),
      headers: { 'CF-Connecting-IP': ip },
    }),
    env: mockEnv(),
    waitUntil: mockWaitUntil(),
    data: {},
  };
}

describe('contact-submit -- category enum', () => {
  it('accepts a valid category', async () => {
    const restore = stubFetchSuccess();
    try {
      const ctx = makeContext({ category: 'stuc-billing' });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.body.ok, true, JSON.stringify(parsed.body));
    } finally { restore(); }
  });

  it('rejects an invalid category', async () => {
    const restore = stubFetchSuccess();
    try {
      const ctx = makeContext({ category: 'bogus' });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.ok, false);
      assert.match(String(parsed.body.error), /category/i);
    } finally { restore(); }
  });

  it('defaults missing category to "other" (back-compat for cached pages)', async () => {
    const restore = stubFetchSuccess();
    try {
      const body = makeBody();
      delete body.category;
      delete body.category_source;
      const ctx = {
        request: mockRequest('POST', {
          body,
          headers: { 'CF-Connecting-IP': randomIp() },
        }),
        env: mockEnv(),
        waitUntil: mockWaitUntil(),
        data: {},
      };
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.body.ok, true, JSON.stringify(parsed.body));
    } finally { restore(); }
  });

  it('rejects an invalid category_source', async () => {
    const restore = stubFetchSuccess();
    try {
      const ctx = makeContext({ category_source: 'bogus-source' });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 400);
    } finally { restore(); }
  });

  it('honeypot returns 200 silently regardless of category', async () => {
    const restore = stubFetchSuccess();
    try {
      const ctx = makeContext({ website: 'spam', category: 'bogus' });
      const res = await onRequestPost(ctx);
      const parsed = await parseResponse(res);
      assert.equal(parsed.status, 200);
      assert.equal(parsed.body.ok, true);
    } finally { restore(); }
  });
});

describe('contact-submit -- subject prefix', () => {
  it('email subject includes [Contact][CATEGORY] prefix', async () => {
    const restore = stubFetchSuccess();
    try {
      let capturedSubject = null;
      const afterStub = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        // aws4fetch passes a Request object; get URL from it
        const u = (url && typeof url === 'object' && url.url) ? url.url : String(url);
        if (u.includes('amazonaws.com')) {
          // The SES v2 API sends JSON body; capture subject from admin notification only
          if (capturedSubject === null && url && typeof url === 'object' && url.json) {
            try {
              const payload = await url.clone().json();
              const toAddresses = payload?.Destination?.ToAddresses || [];
              if (toAddresses.some(a => a.includes('administrator'))) {
                capturedSubject = payload?.Content?.Simple?.Subject?.Data || null;
              }
            } catch { /* ignore */ }
          }
          return { ok: true, status: 200, json: async () => ({ MessageId: 'mock-message-id' }), text: async () => '{}' };
        }
        return afterStub(url, opts);
      };
      try {
        const ctx = makeContext({ category: 'bug', message: 'Found a typo on /about/' });
        await onRequestPost(ctx);
        assert.match(capturedSubject || '', /^\[Contact\]\[BUG\]/);
      } finally {
        globalThis.fetch = afterStub;
      }
    } finally { restore(); }
  });
});
