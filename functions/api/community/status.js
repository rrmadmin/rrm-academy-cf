/**
 * GET /api/community/status — check community access
 * Returns: { ok, access, user? { name, role, tier } }
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, clearAuthHintCookie,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember, displayName } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

// Hint-cookie drift recovery: when JS sent the optimistic hint but the server
// finds no valid session, clear the hint so subsequent navigations short-circuit.
function hasHintCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  return /(?:^|;\s*)rrm_auth=1/.test(cookie);
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Quick session check first
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) {
      const driftHeaders = hasHintCookie(request) ? { 'Set-Cookie': clearAuthHintCookie() } : {};
      return json({ ok: true, access: 'anonymous' }, 200, driftHeaders);
    }

    // Full membership check
    const auth = await requireMember(request, env);
    if (auth instanceof Response) {
      const user = await db.prepare('SELECT name, first_name, last_name, role, avatar_url, blocked FROM user WHERE id = ?')
        .bind(session.userId).first();
      if (user?.blocked) {
        const driftHeaders = hasHintCookie(request) ? { 'Set-Cookie': clearAuthHintCookie() } : {};
        return json({ ok: true, access: 'anonymous' }, 200, driftHeaders);
      }
      return json({
        ok: true,
        access: 'registered',
        user: { name: displayName(user || {}), role: user?.role || 'member', avatarUrl: user?.avatar_url || null },
      });
    }

    // Fetch email opt-out preference
    const optOutRow = await db.prepare('SELECT community_email_opt_out FROM user WHERE id = ?')
      .bind(auth.user.id).first();

    return json({
      ok: true,
      access: 'member',
      user: {
        id: auth.user.id,
        name: displayName(auth.user),
        role: auth.user.role,
        tier: auth.tier,
        avatarUrl: auth.user.avatar_url || null,
      },
      emailOptOut: !!(optOutRow && optOutRow.community_email_opt_out),
    });
  } catch (err) {
    log(env, waitUntil, 'community', 'status_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
