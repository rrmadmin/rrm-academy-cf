/**
 * PATCH /api/community/roles  — update a user's role (admin+ only)
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { roleAtLeast, canManageRoles, canSetRole } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPatch({ request, env }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const assigner = await db.prepare('SELECT id, role FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!assigner || !canManageRoles(assigner.role)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { userId, role } = body;
    if (!userId || !role) return json({ ok: false, error: 'userId and role required' }, 400);

    const validRoles = ['member', 'mod', 'admin', 'superadmin'];
    if (!validRoles.includes(role)) {
      return json({ ok: false, error: 'Invalid role' }, 400);
    }

    if (!canSetRole(assigner.role, role)) {
      return json({ ok: false, error: 'Cannot assign this role' }, 403);
    }

    // Prevent demoting yourself from superadmin
    if (userId === assigner.id && assigner.role === 'superadmin' && role !== 'superadmin') {
      return json({ ok: false, error: 'Cannot demote yourself from superadmin' }, 403);
    }

    const target = await db.prepare('SELECT id, role FROM user WHERE id = ?').bind(userId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);

    // Admins can't change superadmin users
    if (target.role === 'superadmin' && assigner.role !== 'superadmin') {
      return json({ ok: false, error: 'Cannot modify superadmin' }, 403);
    }

    await db.prepare("UPDATE user SET role = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(role, userId).run();

    return json({ ok: true, userId, role });
  } catch (err) {
    console.error('community roles error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
