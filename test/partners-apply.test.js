/**
 * functions/api/partners/apply.js -- guard-order ordering test.
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
import { onRequestPost, onRequestOptions } from '../functions/api/partners/apply.js';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, randomIp } from './_helpers.js';

describe('POST /api/partners/apply -- CORS preflight', () => {
  it('answers OPTIONS with 204', async () => {
    const res = await onRequestOptions();
    assert.equal(res.status, 204);
  });
});

describe('POST /api/partners/apply -- guard order', () => {
  it('checks the rate limit before the DB configuration guard', async () => {
    // Order matters: a misconfigured account must not become an unmetered
    // endpoint that answers 503 as fast as it is asked.
    const ip = randomIp();
    const env = mockEnv({ DB: undefined });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const waitUntil = mockWaitUntil();
      const res = await onRequestPost({
        request: mockRequest('POST', { headers: { 'CF-Connecting-IP': ip } }),
        env,
        waitUntil,
      });
      statuses.push((await parseResponse(res)).status);
    }
    assert.deepEqual(statuses, [503, 503, 503, 503, 503]);

    const waitUntil = mockWaitUntil();
    const res = await onRequestPost({
      request: mockRequest('POST', { headers: { 'CF-Connecting-IP': ip } }),
      env,
      waitUntil,
    });
    const parsed = await parseResponse(res);
    assert.equal(parsed.status, 429, 'the 6th attempt from one IP must be rate-limited even while misconfigured');
    assert.equal(parsed.body.error, 'rate_limited');
  });
});
