/**
 * POST   /api/community/reactions  — toggle reaction (add if missing, remove if exists)
 * DELETE /api/community/reactions  — explicit remove
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember } from './_shared.js';

const ALLOWED_EMOJI = ['❤️', '👏', '😢'];

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { targetType, targetId, emoji } = body;
    if (!targetType || !targetId || !emoji) {
      return json({ ok: false, error: 'targetType, targetId, and emoji required' }, 400);
    }
    if (!['post', 'comment'].includes(targetType)) {
      return json({ ok: false, error: 'Invalid target type' }, 400);
    }
    if (!ALLOWED_EMOJI.includes(emoji)) {
      return json({ ok: false, error: 'Invalid emoji' }, 400);
    }

    const db = env.DB;

    // Toggle: try to delete first; if nothing was deleted, insert
    const del = await db.prepare(
      'DELETE FROM community_reaction WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?'
    ).bind(user.id, targetType, targetId, emoji).run();

    if (del.meta.changes > 0) {
      return json({ ok: true, action: 'removed' });
    }

    await db.prepare(
      'INSERT OR IGNORE INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?, ?, ?, ?)'
    ).bind(user.id, targetType, targetId, emoji).run();

    return json({ ok: true, action: 'added' }, 201);
  } catch (err) {
    console.error('community reactions error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { targetType, targetId, emoji } = body;
    if (!targetType || !targetId || !emoji) {
      return json({ ok: false, error: 'targetType, targetId, and emoji required' }, 400);
    }

    const db = env.DB;
    await db.prepare(
      'DELETE FROM community_reaction WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?'
    ).bind(user.id, targetType, targetId, emoji).run();

    return json({ ok: true });
  } catch (err) {
    console.error('community reactions DELETE error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
