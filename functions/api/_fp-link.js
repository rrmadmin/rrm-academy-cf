/**
 * Cross-device /link firing helper for the fingerprint worker.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * After a successful login / signup / Google login, if the request carried a
 * valid rrm_vid visitor cookie, this fires a best-effort, HMAC-signed,
 * server-to-server POST to https://fp.rrmacademy.org/link to bind that visitor
 * cookie to the authenticated user account.
 *
 * Contract (must match rrm-fingerprint-worker/src/lib/{hmac,validate,ulid}.js
 * byte-for-byte):
 *   - HMAC-SHA256 over `${ts}.${rawBody}` where rawBody is the EXACT wire bytes
 *     sent as the request body (never re-serialized JSON).
 *   - Header: X-RRM-Signature: t=<unix-seconds>,v1=<64-char-lowercase-hex>
 *   - visitor_id matches /^v_[0-9A-HJKMNP-TV-Z]{26}$/ (28 chars)
 *   - nonce is 32 lowercase hex chars
 *   - freshness window is 60s (server enforces abs(now - ts) <= 60)
 *
 * NEVER blocks or fails the auth response: the caller passes the returned
 * promise to waitUntil, and the whole body is wrapped so it never throws.
 * The worker returns 409 when the visitor row has not landed yet; that is an
 * expected best-effort miss and is swallowed.
 *
 * Usage (fire-and-forget, after the session is minted):
 *   waitUntil(fireFpLink({ request, env, userId: user.id }));
 */

const FP_LINK_URL = 'https://fp.rrmacademy.org/link';
const VISITOR_ID_RE = /^v_[0-9A-HJKMNP-TV-Z]{26}$/;

function getVisitorIdFromCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)rrm_vid=([^;]+)/);
  return match ? match[1] : null;
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

export async function fireFpLink({ request, env, userId }) {
  try {
    const visitorId = getVisitorIdFromCookie(request);
    if (!visitorId || !VISITOR_ID_RE.test(visitorId)) return;
    if (!env.LINK_HMAC_KEY_CURRENT) return;

    const ts = Math.floor(Date.now() / 1000);
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = [...nonceBytes].map(b => b.toString(16).padStart(2, '0')).join('');

    const rawBody = JSON.stringify({
      visitor_id: visitorId,
      user_id: String(userId),
      ts,
      nonce,
    });
    const mac = await hmacSha256Hex(env.LINK_HMAC_KEY_CURRENT, `${ts}.${rawBody}`);
    const sig = `t=${ts},v1=${mac}`;

    await fetch(FP_LINK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RRM-Signature': sig,
      },
      body: rawBody,
    });
  } catch { // arise-ignore silent-catch -- best-effort cross-device link; a /link failure must NEVER affect the auth response
    // Intentionally swallowed: caller passes this to waitUntil and must not throw.
  }
}
