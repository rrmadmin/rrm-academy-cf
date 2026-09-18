/**
 * GET /api/account/oauth-identity?areq=<signed authorization request>
 *
 * The one hop in the rrm-mcp OAuth flow that can see the RRM Academy session
 * cookie. Verifies the areq blob rrm-mcp signed, requires a live session, and
 * hands back a short-lived identity assertion bound to that exact areq.
 *
 * There is no caller-supplied redirect target: the browser always goes to
 * MCP_ORIGIN, a fixed environment value, so this endpoint cannot be turned
 * into an open redirect by anyone who can mint a URL. MCP_ORIGIN has no
 * fallback: a missing MCP_ORIGIN joins the same fail-closed guard as a
 * missing OAUTH_GRANT_SECRET, because a silent default here would be exactly
 * the kind of caller-invisible redirect target this endpoint exists to
 * avoid, not a convenience worth keeping.
 *
 * Both blobs this endpoint handles carry a `typ` discriminator (`areq` in,
 * `grant` out). An incoming blob that verifies but is not typed `areq` (a
 * replayed `grant`, or a blob missing `typ` entirely) is refused the same way
 * a bad signature is: a 400 with no information about which check failed.
 */
import { getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { verifyBlob, signBlob, sha256Hex, randomId } from './_oauth-blob.js';
import { log } from '../_log.js';

const GRANT_TTL_S = 300;

function redirect(location, status = 302) {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function bad(message, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db || !env.OAUTH_GRANT_SECRET || !env.MCP_ORIGIN) return bad('server_misconfigured', 503);

    const url = new URL(request.url);
    const areq = url.searchParams.get('areq') || '';
    const nowS = Math.floor(Date.now() / 1000);
    const payload = await verifyBlob(areq, env.OAUTH_GRANT_SECRET, nowS);
    if (!payload || payload.typ !== 'areq') return bad('bad_request');

    const self = `/api/account/oauth-identity?areq=${encodeURIComponent(areq)}`;
    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return redirect(`/login/?redirect=${encodeURIComponent(self)}`);

    const user = await db.prepare('SELECT id, email, blocked FROM user WHERE id = ?').bind(session.userId).first();
    if (!user || user.blocked) return redirect(`/login/?redirect=${encodeURIComponent(self)}`);

    const grant = await signBlob(
      {
        v: 1,
        typ: 'grant',
        areq_hash: await sha256Hex(areq),
        sub: user.id,
        email: user.email,
        jti: randomId(16),
        exp: nowS + GRANT_TTL_S,
      },
      env.OAUTH_GRANT_SECRET,
    );

    log(env, waitUntil, 'account', 'oauth_identity_issued', 'ok', user.id, 0, 302);
    const target = `${env.MCP_ORIGIN}/oauth/authorize?areq=${encodeURIComponent(areq)}&grant=${encodeURIComponent(grant)}`;
    return redirect(target);
  } catch (err) {
    log(env, waitUntil, 'account', 'oauth_identity_error', 'error', err.message, 0, 500);
    return bad('internal_error');
  }
}
