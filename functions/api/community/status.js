/**
 * GET /api/community/status — check community access
 * Returns: { ok, access, user? { name, role, tier } }
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { requireMember, displayName } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    // Quick session check first
    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) {
      return json({ ok: true, access: 'anonymous' });
    }

    // Full membership check
    const auth = await requireMember(request, env);
    if (auth instanceof Response) {
      // Has session but no subscription
      const user = await db.prepare('SELECT name, first_name, last_name, role, avatar_url FROM user WHERE id = ?')
        .bind(session.userId).first();
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
    console.error('community status error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
