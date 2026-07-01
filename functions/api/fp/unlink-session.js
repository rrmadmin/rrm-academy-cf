/**
 * POST /api/fp/unlink-session: mint the fingerprint-worker USER_JWT for "Forget my devices".
 *
 * The logged-in member's browser cannot sign a USER_JWT itself, so this endpoint
 * validates the session, mints a short-lived (120s) Ed25519 JWT whose `sub` is the
 * member's user id (the SAME id fireFpLink() binds via POST /link) and returns it
 * as the `rrm_session` cookie scoped to `.rrmacademy.org`. The browser then calls
 * POST https://fp.rrmacademy.org/unlink (credentials:'include'), which verifies the
 * JWT against USER_JWT_PUB_CURRENT and retires that member's device links.
 *
 * Contract (must match rrm-fingerprint-worker/src/lib/jwt.js + routes/unlink.js):
 *   - cookie name: rrm_session
 *   - header.alg: EdDSA
 *   - payload.sub: user id (string, 1..64 chars); payload.exp: unix seconds, > now
 *   - signature: Ed25519 over `${headerB64}.${payloadB64}`, base64url
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit,
} from '../auth/_shared.js';
import { log } from '../_log.js';

const JWT_TTL_S = 120;

function base64urlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(str) {
  return base64urlFromBytes(new TextEncoder().encode(str));
}

function pkcs8DerFromPem(pem) {
  // Strip PEM armor lines generically (the BEGIN/END delimiters) then whitespace.
  const body = pem
    .replace(/-{5}[^-]+-{5}/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);
    if (!env.FP_USER_JWT_PRIVATE_KEY) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const user = await db.prepare(
      'SELECT id, blocked FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found' }, 401);
    if (user.blocked) return json({ ok: false, error: 'Account suspended' }, 403);

    if (!await checkRateLimit(env, `fp-unlink-session:${session.userId}`, 10, 900)) {
      return json({ ok: false, error: 'Too many attempts. Please try again later.' }, 429);
    }

    const userId = String(session.userId);
    const now = Math.floor(Date.now() / 1000);
    const headerB64 = base64urlFromString(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
    const payloadB64 = base64urlFromString(JSON.stringify({ sub: userId, iat: now, exp: now + JWT_TTL_S }));
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

    let jwt;
    try {
      const key = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8DerFromPem(env.FP_USER_JWT_PRIVATE_KEY),
        { name: 'Ed25519' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('Ed25519', key, signingInput);
      jwt = `${headerB64}.${payloadB64}.${base64urlFromBytes(new Uint8Array(sig))}`;
    } catch (err) {
      log(env, waitUntil, 'account', 'fp_unlink_session_sign_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    const cookie = `rrm_session=${jwt}; Domain=.rrmacademy.org; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${JWT_TTL_S}`;
    log(env, waitUntil, 'account', 'fp_unlink_session_ok', 'ok', session.userId, 0, 200);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  } catch (err) {
    log(env, waitUntil, 'account', 'fp_unlink_session_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
