/**
 * POST   /api/community/reactions  — toggle reaction (add if missing, remove if exists)
 * DELETE /api/community/reactions  — explicit remove
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember } from './_shared.js';

const ALLOWED_EMOJI = ['❤️', '👏', '😢'];

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { targetType, targetId, emoji } = body;
    if (!targetType || !targetId || !emoji) {
      return json({ ok: false, error: 'targetType, targetId, and emoji required' }, 400);
    }
    if (typeof targetId !== 'string' || targetId.length > 100) {
      return json({ ok: false, error: 'Invalid targetId' }, 400);
    }
    if (!['post', 'comment'].includes(targetType)) {
      return json({ ok: false, error: 'Invalid target type' }, 400);
    }
    if (!ALLOWED_EMOJI.includes(emoji)) {
      return json({ ok: false, error: 'Invalid emoji' }, 400);
    }

    const db = env.DB;

    if (targetType === 'post') {
      const exists = await db.prepare('SELECT id FROM community_post WHERE id = ?').bind(targetId).first();
      if (!exists) return json({ ok: false, error: 'Post not found' }, 404);
    } else {
      const exists = await db.prepare('SELECT id FROM community_comment WHERE id = ?').bind(targetId).first();
      if (!exists) return json({ ok: false, error: 'Comment not found' }, 404);
    }

    // Atomic toggle: batch DELETE + conditional INSERT in one transaction
    const results = await db.batch([
      db.prepare(
        'DELETE FROM community_reaction WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?'
      ).bind(user.id, targetType, targetId, emoji),
      db.prepare(
        'INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, target_type, target_id, emoji) DO NOTHING'
      ).bind(user.id, targetType, targetId, emoji),
    ]);
    const deleted = (results[0]?.meta?.changes || 0) > 0;
    const inserted = (results[1]?.meta?.changes || 0) > 0;

    if (deleted && !inserted) return json({ ok: true, action: 'removed' });
    if (!deleted && inserted) return json({ ok: true, action: 'added' }, 201);
    return json({ ok: true, action: deleted ? 'removed' : 'added' });
  } catch (err) {
    log(env, waitUntil, 'community', 'reaction_error', 'error', `POST: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { targetType, targetId, emoji } = body;
    if (!targetType || !targetId || !emoji) {
      return json({ ok: false, error: 'targetType, targetId, and emoji required' }, 400);
    }
    if (typeof targetId !== 'string' || targetId.length > 100) {
      return json({ ok: false, error: 'Invalid targetId' }, 400);
    }

    const db = env.DB;
    await db.prepare(
      'DELETE FROM community_reaction WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?'
    ).bind(user.id, targetType, targetId, emoji).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'reaction_error', 'error', `DELETE: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
