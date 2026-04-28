/**
 * DELETE /api/account/mcp-keys/:id  — soft-revoke an MCP API key
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../../auth/_shared.js';
import { log } from '../../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestDelete({ request, params, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const user = await db.prepare(
      'SELECT id, blocked FROM user WHERE id = ?'
    ).bind(session.userId).first();
    if (!user) return json({ ok: false, error: 'User not found' }, 401);
    if (user.blocked) return json({ ok: false, error: 'Account suspended' }, 403);

    const keyId = params?.id;
    if (typeof keyId !== 'string' || !keyId || keyId.length > 64) {
      return json({ ok: false, error: 'invalid_key_id' }, 400);
    }

    // Look up the key — must belong to the session user (no IDOR)
    const existing = await db.prepare(
      'SELECT id, revoked_at FROM mcp_api_key WHERE id = ? AND user_id = ?'
    ).bind(keyId, session.userId).first();

    if (!existing) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    if (existing.revoked_at !== null && existing.revoked_at !== undefined) {
      return json({ ok: false, error: 'already_revoked' }, 410);
    }

    // Soft-revoke
    await db.prepare(
      `UPDATE mcp_api_key SET revoked_at = datetime('now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    ).bind(keyId, session.userId).run();

    // Re-fetch revoked_at to return the canonical value
    const updated = await db.prepare(
      'SELECT id, revoked_at FROM mcp_api_key WHERE id = ?'
    ).bind(keyId).first();

    log(env, waitUntil, 'account', 'mcp_key_revoked', 'ok', session.userId, 0, 200);

    return json({ ok: true, id: updated.id, revoked_at: updated.revoked_at });
  } catch (err) {
    log(env, waitUntil, 'account', 'mcp_key_revoke_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
