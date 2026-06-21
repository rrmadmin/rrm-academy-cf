/**
 * Unit tests for the cross-device /link helper at functions/api/_fp-link.js
 *
 * Covers:
 *   1. Deterministic signing for a fixed key + ts + nonce (exact hex pin).
 *   2. Round-trip against the worker's verify logic (verifyLinkHmac replicated
 *      from rrm-fingerprint-worker/src/lib/hmac.js) -- proves the signature this
 *      helper emits actually verifies on the worker side, byte-for-byte.
 *   3. Cookie-absent early return (no rrm_vid -> no fetch).
 *   4. Invalid rrm_vid shape early return (no fetch).
 *   5. Missing LINK_HMAC_KEY_CURRENT early return (no fetch, no throw).
 *   6. Best-effort: a fetch rejection never throws to the caller.
 *
 * Run with: node --test test/fp-link.test.js
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fireFpLink } from '../functions/api/_fp-link.js';

// --- Worker-side verify, replicated verbatim from src/lib/hmac.js ------------
// If this drifts from the worker, the round-trip test fails -- which is exactly
// the contract we want to defend.

function parseSignatureHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const pairs = headerValue.split(',').map(p => p.trim());
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) return null;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 't') {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
      out.t = n;
    } else if (key === 'v1') {
      if (!/^[0-9a-f]{64}$/.test(value)) return null;
      out.v1 = value;
    }
  }
  if (!out.t || !out.v1) return null;
  return out;
}

async function hmacSha256Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyLinkHmac(signatureHeader, rawBodyText, keyCurrent, keyPrevious, freshnessSeconds = 60) {
  const validKey = (k) => typeof k === 'string' && k.length >= 32;
  if (!validKey(keyCurrent) && !validKey(keyPrevious)) {
    return { ok: false, reason: 'missing_key' };
  }
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed_header' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > freshnessSeconds) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const signingString = `${parsed.t}.${rawBodyText}`;
  if (validKey(keyCurrent)) {
    const expectedCurrent = await hmacSha256Hex(keyCurrent, signingString);
    if (constantTimeEqual(expectedCurrent, parsed.v1)) return { ok: true, ts: parsed.t };
  }
  if (validKey(keyPrevious)) {
    const expectedPrev = await hmacSha256Hex(keyPrevious, signingString);
    if (constantTimeEqual(expectedPrev, parsed.v1)) return { ok: true, ts: parsed.t };
  }
  return { ok: false, reason: 'signature_mismatch' };
}

// Worker-side input validators (src/lib/ulid.js + validate.js) replicated so
// the round-trip test asserts the full acceptance contract, not just the HMAC.
const isValidVisitorId = (v) => typeof v === 'string' && v.length === 28 && /^v_[0-9A-HJKMNP-TV-Z]{26}$/.test(v);
const isValidUserId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isValidNonceHex = (v) => typeof v === 'string' && v.length === 32 && /^[0-9a-f]{32}$/.test(v);

// --- Test harness -----------------------------------------------------------

function makeRequest(cookie) {
  const headers = new Map();
  if (cookie != null) headers.set('cookie', cookie);
  return {
    headers: {
      get(name) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

const KEY = 'k'.repeat(64); // 64-char key, matches the provisioned secret length
const FIXED_TS = 1750000000;
const FIXED_NONCE_BYTES = Uint8Array.from({ length: 16 }, (_, i) => i);
const FIXED_NONCE_HEX = '000102030405060708090a0b0c0d0e0f';
const VALID_VISITOR = 'v_0123456789ABCDEFGHJKMNPQRS'; // 28 chars, Crockford base32
const USER_ID = 'user_abc123';

let captured;
let realFetch;
let realNow;
let realGetRandomValues;

beforeEach(() => {
  captured = [];
  realFetch = globalThis.fetch;
  realNow = Date.now;
  realGetRandomValues = crypto.getRandomValues.bind(crypto);

  globalThis.fetch = async (url, init) => {
    captured.push({ url, init });
    return new Response(null, { status: 204 });
  };
  Date.now = () => FIXED_TS * 1000;
  // Deterministic nonce: fill with the fixed byte sequence.
  crypto.getRandomValues = (arr) => {
    arr.set(FIXED_NONCE_BYTES.subarray(0, arr.length));
    return arr;
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  crypto.getRandomValues = realGetRandomValues;
});

describe('fp-link: deterministic signing', () => {
  it('produces the exact pinned HMAC hex for a fixed key + ts + nonce', async () => {
    await fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });

    assert.equal(captured.length, 1, 'exactly one POST fired');
    const { url, init } = captured[0];
    assert.equal(url, 'https://fp.rrmacademy.org/link');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');

    const expectedBody = JSON.stringify({
      visitor_id: VALID_VISITOR,
      user_id: USER_ID,
      ts: FIXED_TS,
      nonce: FIXED_NONCE_HEX,
    });
    assert.equal(init.body, expectedBody, 'body is the canonical JSON, serialized once');

    const EXPECTED_MAC = 'd34ac2427b4049b94c112353b1dfdfd296aa4760c5ef1b0993ad7f56877267c1';
    assert.equal(init.headers['X-RRM-Signature'], `t=${FIXED_TS},v1=${EXPECTED_MAC}`);
  });

  it('signs the EXACT bytes that are sent (sig matches over init.body, not a re-serialization)', async () => {
    await fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    const { init } = captured[0];
    const m = init.headers['X-RRM-Signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    assert.ok(m, 'signature header is well-formed');
    const recomputed = await hmacSha256Hex(KEY, `${m[1]}.${init.body}`);
    assert.equal(recomputed, m[2], 'HMAC is computed over the literal wire body bytes');
  });
});

describe('fp-link: round-trips against the worker verify contract', () => {
  it('the emitted signature verifies via the worker verifyLinkHmac (current key)', async () => {
    await fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    const { init } = captured[0];

    const result = await verifyLinkHmac(init.headers['X-RRM-Signature'], init.body, KEY, null);
    assert.equal(result.ok, true, 'worker accepts the signature');
    assert.equal(result.ts, FIXED_TS);
  });

  it('the body satisfies every worker field validator', async () => {
    await fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    const body = JSON.parse(captured[0].init.body);
    assert.ok(isValidVisitorId(body.visitor_id), 'visitor_id shape accepted by worker');
    assert.ok(isValidUserId(body.user_id), 'user_id shape accepted by worker');
    assert.ok(isValidNonceHex(body.nonce), 'nonce shape accepted by worker');
  });

  it('worker rejects a tampered body (proves integrity binding)', async () => {
    await fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    const { init } = captured[0];
    const tampered = init.body.replace(USER_ID, 'attacker_id');
    const result = await verifyLinkHmac(init.headers['X-RRM-Signature'], tampered, KEY, null);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'signature_mismatch');
  });

  it('non-numeric userId is coerced to string and still round-trips', async () => {
    await fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: 12345 });
    const { init } = captured[0];
    const body = JSON.parse(init.body);
    assert.equal(body.user_id, '12345');
    assert.ok(isValidUserId(body.user_id));
    const result = await verifyLinkHmac(init.headers['X-RRM-Signature'], init.body, KEY, null);
    assert.equal(result.ok, true);
  });
});

describe('fp-link: early returns (no-op, never fires)', () => {
  it('no rrm_vid cookie -> no fetch', async () => {
    await fireFpLink({ request: makeRequest(null), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    assert.equal(captured.length, 0);
  });

  it('other cookies but no rrm_vid -> no fetch', async () => {
    await fireFpLink({ request: makeRequest('session=abc; rrm_auth=1'), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    assert.equal(captured.length, 0);
  });

  it('malformed rrm_vid (wrong shape) -> no fetch', async () => {
    await fireFpLink({ request: makeRequest('rrm_vid=not-a-valid-visitor-id'), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    assert.equal(captured.length, 0);
  });

  it('rrm_vid with a lowercase-only ULID body (violates Crockford) -> no fetch', async () => {
    // 'i','l','o','u' are excluded from the Crockford alphabet; force a reject.
    await fireFpLink({ request: makeRequest('rrm_vid=v_iiiiiiiiiiiiiiiiiiiiiiiiii'), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    assert.equal(captured.length, 0);
  });

  it('missing LINK_HMAC_KEY_CURRENT -> no fetch, no throw', async () => {
    await assert.doesNotReject(
      fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: {}, userId: USER_ID }),
    );
    assert.equal(captured.length, 0);
  });
});

describe('fp-link: best-effort (never throws to caller)', () => {
  it('swallows a fetch network error', async () => {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await assert.doesNotReject(
      fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID }),
    );
  });

  it('returns a resolved promise (safe to pass to waitUntil)', async () => {
    const p = fireFpLink({ request: makeRequest(`rrm_vid=${VALID_VISITOR}`), env: { LINK_HMAC_KEY_CURRENT: KEY }, userId: USER_ID });
    assert.ok(p instanceof Promise);
    await assert.doesNotReject(p);
  });
});
