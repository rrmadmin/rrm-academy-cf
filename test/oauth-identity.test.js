/**
 * functions/api/account/oauth-identity.js -- the session-gated hop in the
 * rrm-mcp OAuth flow. The session cookie is host-only for rrmacademy.org, so
 * mcp.rrmacademy.org can never read it; this endpoint is the only place the
 * user's identity is established, and it hands rrm-mcp a signed assertion.
 *
 * Adversarial, not descriptive: the properties that matter are that an
 * anonymous visitor is sent to login rather than issued an assertion, that an
 * areq blob this deployment did not sign is refused, that a blob typed as
 * something other than `areq` (including a replayed `grant`) is refused the
 * same way a bad signature is, and that the redirect target is a fixed origin
 * rather than anything the caller supplied.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';
import { signBlob } from '../functions/api/account/_oauth-blob.js';

const SECRET = 'test-grant-secret-0123456789';
const USER = 'u_alice';
const RAW_SESSION = 'raw-session-alice';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const mod = await import('../functions/api/account/oauth-identity.js');

async function seeded() {
  const db = sqliteD1({ seed: (s) => insertUser(s, { id: USER, email: 'alice@example.com' }) });
  await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER, expiresAt: FUTURE });
  return db;
}

async function areq() {
  return signBlob(
    {
      v: 1,
      typ: 'areq',
      client_id: 'c1',
      redirect_uri: 'https://example.com/cb',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      scope: 'public',
      state: 'st',
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    SECRET,
  );
}

function env(db) {
  return mockEnv({ DB: db, OAUTH_GRANT_SECRET: SECRET, MCP_ORIGIN: 'https://mcp.rrmacademy.org' });
}

describe('GET /api/account/oauth-identity', () => {
  it('sends an anonymous visitor to login and comes back to itself', async () => {
    const db = await seeded();
    const blob = await areq();
    const res = await mod.onRequestGet({
      request: mockRequest('GET', { url: `https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}` }),
      env: env(db), waitUntil: mockWaitUntil(),
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location');
    assert.ok(loc.startsWith('/login/?redirect='), loc);
    assert.ok(decodeURIComponent(loc).includes('/api/account/oauth-identity?areq='), loc);
  });

  it('issues a grant bound to the areq for a signed-in user', async () => {
    const db = await seeded();
    const blob = await areq();
    const res = await mod.onRequestGet({
      request: mockRequest('GET', {
        url: `https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}`,
        headers: { Cookie: `session=${RAW_SESSION}` },
      }),
      env: env(db), waitUntil: mockWaitUntil(),
    });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('Location'));
    assert.equal(loc.origin, 'https://mcp.rrmacademy.org');
    assert.equal(loc.pathname, '/oauth/authorize');
    assert.equal(loc.searchParams.get('areq'), blob);
    assert.ok(loc.searchParams.get('grant'));
  });

  it('refuses an areq signed with another secret', async () => {
    const db = await seeded();
    const foreign = await signBlob({ v: 1, typ: 'areq', client_id: 'c1', exp: Math.floor(Date.now() / 1000) + 600 }, 'not-our-secret');
    const res = await mod.onRequestGet({
      request: mockRequest('GET', {
        url: `https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(foreign)}`,
        headers: { Cookie: `session=${RAW_SESSION}` },
      }),
      env: env(db), waitUntil: mockWaitUntil(),
    });
    assert.equal(res.status, 400);
  });

  it('refuses a blob typed as a grant instead of an areq', async () => {
    const db = await seeded();
    const wrongTyp = await signBlob(
      { v: 1, typ: 'grant', client_id: 'c1', exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    );
    const res = await mod.onRequestGet({
      request: mockRequest('GET', {
        url: `https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(wrongTyp)}`,
        headers: { Cookie: `session=${RAW_SESSION}` },
      }),
      env: env(db), waitUntil: mockWaitUntil(),
    });
    assert.equal(res.status, 400);
  });
});
