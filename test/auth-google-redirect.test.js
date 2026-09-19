/**
 * Tests for GET /api/auth/google (functions/api/auth/google.js), redirect leg.
 * Run with: node --test test/auth-google-redirect.test.js
 *
 * The Google leg carries the return path back in a cookie, base64 encoded.
 * A browser drops a cookie whose name plus value passes about 4 KB, and a
 * dropped cookie surfaces at the callback as a CSRF failure, after the user
 * has already signed in with Google. So this leg refuses an over-budget
 * return path up front rather than quietly rewriting it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/auth/google.js';

const ENV = { GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-secret' };

function get(redirect) {
  const u = new URL('https://rrmacademy.org/api/auth/google');
  if (redirect !== undefined) u.searchParams.set('redirect', redirect);
  return onRequestGet({ env: ENV, request: new Request(u, { method: 'GET' }) });
}

/** The longest return path that still fits the cookie budget, from the measured ceiling. */
const CARRIED = `/api/account/oauth-identity?areq=${'A'.repeat(2700)}`;
const TOO_LONG = `/api/account/oauth-identity?areq=${'A'.repeat(3700)}`;

describe('GET /api/auth/google -- return path carrying', () => {
  it('carries a 2.7 KB return path in both the state and the cookie', async () => {
    const res = await get(CARRIED);
    assert.equal(res.status, 302);
    const cookie = res.headers.get('Set-Cookie');
    assert.ok(cookie.startsWith('oauth_state='), 'sets the CSRF state cookie');
    assert.ok(cookie.split(';')[0].length <= 3800, 'cookie name plus value stays inside the budget');
    const state = new URL(res.headers.get('Location')).searchParams.get('state');
    const b64 = state.slice(state.indexOf(':') + 1);
    assert.equal(atob(b64), CARRIED, 'the state carries the exact return path');
  });

  it('refuses an over-budget return path loudly instead of rewriting it', async () => {
    const res = await get(TOO_LONG);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://rrmacademy.org/login/?error=redirect_too_long');
    assert.equal(res.headers.get('Set-Cookie'), null, 'no half-sized cookie is set');
  });

  it('still falls back to /account/ for an unsafe return path', async () => {
    for (const bad of ['//evil.example', 'https://evil.example/x']) {
      const res = await get(bad);
      const state = new URL(res.headers.get('Location')).searchParams.get('state');
      assert.equal(atob(state.slice(state.indexOf(':') + 1)), '/account/', `${bad} must not survive`);
    }
  });
});
