/**
 * Tests that mixed-case bridge URLs 301 to canonical lowercase.
 * Run with: node --test test/middleware-bridge-canonical.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';
import { mockRequest, mockEnv } from './_helpers.js';

describe('middleware bridge-page canonical redirect', () => {
  it('redirects /Schedule-With-Dr-Whittaker/ to /schedule-with-dr-whittaker/', async () => {
    const req = mockRequest('GET', { url: 'https://rrmacademy.org/Schedule-With-Dr-Whittaker/' });
    const env = mockEnv();
    const ctx = { request: req, env, waitUntil: () => {}, next: async () => new Response('next-called', { status: 200 }), data: {} };
    const res = await onRequest(ctx);
    assert.equal(res.status, 301);
    assert.match(res.headers.get('location') || '', /\/schedule-with-dr-whittaker\//);
  });

  it('passes lowercase /schedule-with-dr-whittaker/ through unchanged', async () => {
    const req = mockRequest('GET', { url: 'https://rrmacademy.org/schedule-with-dr-whittaker/' });
    const env = mockEnv();
    let nextCalled = false;
    const ctx = { request: req, env, waitUntil: () => {}, next: async () => { nextCalled = true; return new Response('ok', { status: 200 }); }, data: {} };
    await onRequest(ctx);
    assert.equal(nextCalled, true);
  });
});
