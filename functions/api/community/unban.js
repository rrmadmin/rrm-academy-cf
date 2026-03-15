/**
 * POST /api/community/unban -- unban a user (admin+ only)
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember, roleAtLeast } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { userId } = body;
    if (!userId) return json({ ok: false, error: 'userId required' }, 400);

    const db = env.DB;
    const target = await db.prepare('SELECT id, blocked FROM user WHERE id = ?').bind(userId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (!target.blocked) return json({ ok: false, error: 'User is not banned' }, 409);

    await db.prepare('UPDATE user SET blocked = 0 WHERE id = ?').bind(userId).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'unban_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
