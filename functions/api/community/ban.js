/**
 * POST /api/community/ban -- ban a user (admin+ only)
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

    const { userId, deleteContent } = body;
    if (!userId) return json({ ok: false, error: 'userId required' }, 400);

    const db = env.DB;

    const target = await db.prepare('SELECT id, role, blocked FROM user WHERE id = ?').bind(userId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.blocked) return json({ ok: false, error: 'User is already banned' }, 409);

    if (userId === user.id) {
      return json({ ok: false, error: 'Cannot ban yourself' }, 400);
    }

    if (roleAtLeast(target.role, 'admin')) {
      return json({ ok: false, error: 'Cannot ban an admin' }, 403);
    }

    const statements = [
      db.prepare('UPDATE user SET blocked = 1 WHERE id = ?').bind(userId),
      db.prepare('DELETE FROM session WHERE user_id = ?').bind(userId),
    ];

    statements.push(
      db.prepare('DELETE FROM community_reaction WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM community_flag WHERE user_id = ?').bind(userId),
    );

    if (deleteContent) {
      statements.push(
        db.prepare("DELETE FROM community_flag WHERE target_type = 'post' AND target_id IN (SELECT id FROM community_post WHERE author_id = ?)").bind(userId),
        db.prepare("DELETE FROM community_flag WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE author_id = ?)").bind(userId),
        db.prepare("DELETE FROM community_reaction WHERE target_type = 'post' AND target_id IN (SELECT id FROM community_post WHERE author_id = ?)").bind(userId),
        db.prepare("DELETE FROM community_reaction WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE author_id = ?)").bind(userId),
        db.prepare("DELETE FROM community_reaction WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE post_id IN (SELECT id FROM community_post WHERE author_id = ?))").bind(userId),
        db.prepare("DELETE FROM community_flag WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE post_id IN (SELECT id FROM community_post WHERE author_id = ?))").bind(userId),
        db.prepare("DELETE FROM community_comment WHERE post_id IN (SELECT id FROM community_post WHERE author_id = ?)").bind(userId),
        db.prepare('DELETE FROM community_comment WHERE author_id = ?').bind(userId),
        db.prepare('DELETE FROM community_post WHERE author_id = ?').bind(userId),
      );
    }

    let r2KeysToDelete = [];
    if (deleteContent && env.R2_ASSETS) {
      const ogRows = await db.prepare(
        "SELECT og_image_url FROM community_post WHERE author_id = ? AND og_image_url IS NOT NULL"
      ).bind(userId).all();
      for (const row of (ogRows.results || [])) {
        const match = row.og_image_url?.match(/\/api\/assets\/(.+)$/);
        if (match) r2KeysToDelete.push(match[1]);
      }
    }

    await db.batch(statements);

    if (r2KeysToDelete.length) {
      for (const key of r2KeysToDelete) {
        waitUntil(env.R2_ASSETS.delete(key).catch((err) => {
          log(env, waitUntil, 'community', 'r2_cleanup_failed', 'error', `ban: ${err.message}`);
        }));
      }
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'ban_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
