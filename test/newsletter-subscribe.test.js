/**
 * functions/api/newsletter/subscribe.js -- guard-order ordering test.
 *
 * No dedicated test file existed for this endpoint before this change. This
 * file is scoped to the house guard-order rule (rate limit FIRST, then
 * config/env guards, then body parse, then Turnstile verify) mirroring the
 * pattern established in test/endo-quiz-start.test.js and
 * test/quiz-request.test.js -- it is not a full behavioral suite for the
 * endpoint.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestOptions } from '../functions/api/newsletter/subscribe.js';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

describe('POST /api/newsletter/subscribe -- CORS preflight', () => {
  it('answers OPTIONS with 204', async () => {
    const res = await onRequestOptions();
    assert.equal(res.status, 204);
  });
});

describe('POST /api/newsletter/subscribe -- guard order', () => {
  it('checks the rate limit before the DB configuration guard', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 500 as fast as it is asked.
    const ip = randomIp();
    const env = mockEnv({ DB: undefined });
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const waitUntil = mockWaitUntil();
      const res = await onRequestPost({
        request: mockRequest('POST', { headers: { 'CF-Connecting-IP': ip } }),
        env,
        waitUntil,
      });
      statuses.push((await parseResponse(res)).status);
    }
    assert.deepEqual(statuses, Array(10).fill(500));

    const waitUntil = mockWaitUntil();
    const res = await onRequestPost({
      request: mockRequest('POST', { headers: { 'CF-Connecting-IP': ip } }),
      env,
      waitUntil,
    });
    const parsed = await parseResponse(res);
    assert.equal(parsed.status, 429, 'the 11th attempt from one IP must be rate-limited even while misconfigured');
    assert.equal(parsed.body.ok, false);
  });
});

// --------------------------------------------------- first-name collection ---
//
// The form collected email only until 2026-08-25, so newsletter_subscriber.name
// went unwritten on every website signup and 3,266 active subscribers had no
// name to greet. These assert the endpoint half of that fix.

import { mockDB, stubExternalFetch, drainWaitUntil } from './_helpers.js';

const subscribeCtx = (body, { dbMap = {} } = {}) => {
  const db = mockDB(dbMap);
  return {
    db,
    request: mockRequest('POST', { body, headers: { 'CF-Connecting-IP': randomIp() } }),
    env: mockEnv({ DB: db }),
    waitUntil: mockWaitUntil(),
  };
};
const calls = (ctx, needle) => ctx.db._calls.filter(c => c.sql.includes(needle));

describe('POST /api/newsletter/subscribe -- first name is required', () => {
  it('refuses a body with no firstName, before spending a Turnstile or ELV call', async () => {
    const net = stubExternalFetch();
    try {
      const ctx = subscribeCtx({ email: 'reader@example.com' });
      const parsed = await parseResponse(await onRequestPost(ctx));
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'First name is required.');
      assert.equal(net.calls.length, 0, 'name validation must run before any billed external call');
    } finally {
      net.restore();
    }
  });

  it('refuses a whitespace-only firstName', async () => {
    const net = stubExternalFetch();
    try {
      const ctx = subscribeCtx({ email: 'reader@example.com', firstName: '   ' });
      const parsed = await parseResponse(await onRequestPost(ctx));
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'First name is required.');
    } finally {
      net.restore();
    }
  });

  it('writes the trimmed name onto the new subscriber row', async () => {
    const net = stubExternalFetch();
    try {
      const ctx = subscribeCtx({ email: 'reader@example.com', firstName: '  Ada  ', turnstileToken: 't' });
      const parsed = await parseResponse(await onRequestPost(ctx));
      await drainWaitUntil(ctx.waitUntil);
      assert.equal(parsed.status, 200);
      const insert = calls(ctx, 'INSERT INTO newsletter_subscriber')[0];
      assert.ok(insert, 'a new subscriber row must be inserted');
      assert.ok(insert.sql.includes('name'), 'the INSERT must carry the name column');
      assert.equal(insert.bound[2], 'Ada', 'the name is stored trimmed');
    } finally {
      net.restore();
    }
  });

  it('seeds the name onto a blank user row without renaming one that has a name', async () => {
    const net = stubExternalFetch();
    try {
      const ctx = subscribeCtx({ email: 'reader@example.com', firstName: 'Ada', turnstileToken: 't' });
      await parseResponse(await onRequestPost(ctx));
      await drainWaitUntil(ctx.waitUntil);
      const upd = calls(ctx, 'UPDATE user SET newsletter_opt_in')[0];
      assert.ok(upd, 'the opt-in UPDATE must still run');
      assert.deepEqual(upd.bound, ['Ada', 'Ada', 'reader@example.com']);
      assert.ok(upd.sql.includes('first_name = CASE WHEN'), 'the name write must be conditional, not unconditional');
      assert.ok(
        upd.sql.includes("TRIM(COALESCE(first_name, '')) = ''") && upd.sql.includes("TRIM(COALESCE(last_name, '')) = ''"),
        'the guard must require every name column to be blank before writing'
      );
      assert.ok(upd.sql.includes('COLLATE NOCASE'), 'the email match must be case-insensitive');
    } finally {
      net.restore();
    }
  });

  it('does not rename a returning subscriber who already has a name on file', async () => {
    const net = stubExternalFetch();
    try {
      const ctx = subscribeCtx(
        { email: 'reader@example.com', firstName: 'Ada', turnstileToken: 't' },
        { dbMap: { 'SELECT id, status, name FROM newsletter_subscriber': { first: { id: 'sub_1', status: 'unsubscribed', name: 'Augusta' } } } }
      );
      await parseResponse(await onRequestPost(ctx));
      await drainWaitUntil(ctx.waitUntil);
      const react = calls(ctx, "UPDATE newsletter_subscriber SET status = 'active'")[0];
      assert.ok(react, 'the re-activation must run');
      assert.ok(
        react.sql.includes('COALESCE(NULLIF(TRIM(COALESCE(name'),
        'a re-subscribe must keep the stored name rather than overwrite it'
      );
    } finally {
      net.restore();
    }
  });
});
