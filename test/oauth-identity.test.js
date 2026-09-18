/**
 * functions/api/account/oauth-identity.js -- the session-gated hop in the
 * rrm-mcp OAuth flow. The session cookie is host-only for rrmacademy.org, so
 * mcp.rrmacademy.org can never read it; this endpoint is the only place the
 * user's identity is established, and it hands rrm-mcp a signed assertion.
 *
 * Adversarial, not descriptive: the properties that matter are that an
 * anonymous visitor is sent to login rather than issued an assertion, that a
 * blocked user or an expired session is treated the same as no session at
 * all, that an areq blob this deployment did not sign is refused, that a
 * blob typed as something other than `areq` (including a replayed `grant`)
 * is refused the same way a bad signature is, that the redirect target is a
 * fixed origin rather than anything the caller supplied, that the grant this
 * endpoint issues is genuinely bound to the exact areq it was issued for
 * (not just "some" grant), and that a missing MCP_ORIGIN fails closed exactly
 * like a missing OAUTH_GRANT_SECRET rather than falling back to a guess.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';
import { signBlob, verifyBlob, sha256Hex } from '../functions/api/account/_oauth-blob.js';

const SECRET = 'test-grant-secret-0123456789';
const USER = 'u_alice';
const EMAIL = 'alice@example.com';
const RAW_SESSION = 'raw-session-alice';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const PAST = Math.floor(Date.now() / 1000) - 3600;

const mod = await import('../functions/api/account/oauth-identity.js');

async function seeded({ blocked = false } = {}) {
  const db = sqliteD1({ seed: (s) => insertUser(s, { id: USER, email: EMAIL, blocked: blocked ? 1 : 0 }) });
  await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER, expiresAt: FUTURE });
  return db;
}

async function areq({ state = 'st' } = {}) {
  return signBlob(
    {
      v: 1,
      typ: 'areq',
      client_id: 'c1',
      redirect_uri: 'https://example.com/cb',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      scope: 'public',
      state,
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    SECRET,
  );
}

function env(db, overrides = {}) {
  return mockEnv({ DB: db, OAUTH_GRANT_SECRET: SECRET, MCP_ORIGIN: 'https://mcp.rrmacademy.org', ...overrides });
}

function get(url, { db, headers, envOverrides } = {}) {
  return mod.onRequestGet({
    request: mockRequest('GET', { url, headers }),
    env: env(db, envOverrides),
    waitUntil: mockWaitUntil(),
  });
}

describe('GET /api/account/oauth-identity', () => {
  it('sends an anonymous visitor to login and comes back to itself', async () => {
    const db = await seeded();
    const blob = await areq();
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}`, { db });
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location');
    assert.ok(loc.startsWith('/login/?redirect='), loc);
    assert.ok(decodeURIComponent(loc).includes('/api/account/oauth-identity?areq='), loc);
  });

  it('issues a grant bound to the exact areq for a signed-in user', async () => {
    const db = await seeded();
    const blob = await areq();
    const nowS = Math.floor(Date.now() / 1000);
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('Location'));
    assert.equal(loc.origin, 'https://mcp.rrmacademy.org');
    assert.equal(loc.pathname, '/oauth/authorize');
    assert.equal(loc.searchParams.get('areq'), blob);
    const grantToken = loc.searchParams.get('grant');
    assert.ok(grantToken);

    const grant = await verifyBlob(grantToken, SECRET, nowS);
    assert.ok(grant, 'the grant this endpoint just issued must verify against the same secret');
    assert.equal(grant.typ, 'grant');
    assert.equal(grant.sub, USER);
    assert.equal(grant.email, EMAIL);
    assert.equal(grant.areq_hash, await sha256Hex(blob));
    assert.ok(grant.exp <= nowS + 300, `grant.exp ${grant.exp} must be at most 300s out from ${nowS}`);
  });

  it('binds the areq_hash to the areq actually sent, not to some fixed value', async () => {
    const db = await seeded();
    const first = await areq({ state: 'state-one' });
    const second = await areq({ state: 'state-two' });
    const nowS = Math.floor(Date.now() / 1000);

    const resFirst = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(first)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });
    const resSecond = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(second)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });

    const grantFirst = await verifyBlob(new URL(resFirst.headers.get('Location')).searchParams.get('grant'), SECRET, nowS);
    const grantSecond = await verifyBlob(new URL(resSecond.headers.get('Location')).searchParams.get('grant'), SECRET, nowS);

    assert.equal(grantFirst.areq_hash, await sha256Hex(first));
    assert.equal(grantSecond.areq_hash, await sha256Hex(second));
    assert.notEqual(grantFirst.areq_hash, grantSecond.areq_hash, 'two different areqs must not collapse to the same areq_hash');
  });

  it('refuses an areq signed with another secret', async () => {
    const db = await seeded();
    const foreign = await signBlob({ v: 1, typ: 'areq', client_id: 'c1', exp: Math.floor(Date.now() / 1000) + 600 }, 'not-our-secret');
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(foreign)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });
    assert.equal(res.status, 400);
  });

  it('refuses a blob typed as a grant instead of an areq', async () => {
    const db = await seeded();
    const wrongTyp = await signBlob(
      { v: 1, typ: 'grant', client_id: 'c1', exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    );
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(wrongTyp)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });
    assert.equal(res.status, 400);
  });

  it("a blocked user's valid session lands on login, never a grant", async () => {
    const db = await seeded({ blocked: true });
    const blob = await areq();
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location');
    assert.ok(loc.startsWith('/login/?redirect='), loc);
  });

  it('an expired session lands on login, never a grant', async () => {
    const db = sqliteD1({ seed: (s) => insertUser(s, { id: USER, email: EMAIL }) });
    await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER, expiresAt: PAST });
    const blob = await areq();
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` },
    });
    assert.equal(res.status, 302);
    const loc = res.headers.get('Location');
    assert.ok(loc.startsWith('/login/?redirect='), loc);
  });

  it('answers 503 server_misconfigured when MCP_ORIGIN is missing, with no fallback origin', async () => {
    const db = await seeded();
    const blob = await areq();
    const res = await get(`https://rrmacademy.org/api/account/oauth-identity?areq=${encodeURIComponent(blob)}`, {
      db, headers: { Cookie: `session=${RAW_SESSION}` }, envOverrides: { MCP_ORIGIN: undefined },
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(body, { ok: false, error: 'server_misconfigured' });
  });

  it('answers 503 server_misconfigured when OAUTH_GRANT_SECRET is missing', async () => {
    const db = await seeded();
    const res = await get('https://rrmacademy.org/api/account/oauth-identity?areq=whatever', {
      db, envOverrides: { OAUTH_GRANT_SECRET: undefined },
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.deepEqual(body, { ok: false, error: 'server_misconfigured' });
  });
});
