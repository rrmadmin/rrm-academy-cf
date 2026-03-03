/**
 * GET    /api/community/comments?postId=  — list comments (threaded)
 * POST   /api/community/comments          — create comment / reply
 * DELETE /api/community/comments          — delete comment
 */
import { json, optionsResponse, generateId } from '../auth/_shared.js';
import { requireMember, displayName, canDeleteComment, roleAtLeast } from './_shared.js';

const ARCHIVE_CHANNELS = ['members', 'masterclass'];

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const url = new URL(request.url);
    const postId = url.searchParams.get('postId');
    if (!postId) return json({ ok: false, error: 'postId required' }, 400);

    const db = env.DB;

    // Verify post exists
    const post = await db.prepare('SELECT id FROM community_post WHERE id = ?').bind(postId).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    const rows = await db.prepare(`
      SELECT c.id, c.author_id, c.content, c.parent_id, c.created_at,
             u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar
      FROM community_comment c
      JOIN user u ON u.id = c.author_id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).bind(postId).all();

    // Fetch reactions for all comments
    const commentIds = rows.results.map(r => r.id);
    let reactionMap = {};
    let userReactions = {};
    if (commentIds.length) {
      const placeholders = commentIds.map(() => '?').join(',');

      const reactions = await db.prepare(`
        SELECT target_id, emoji, COUNT(*) as count
        FROM community_reaction
        WHERE target_type = 'comment' AND target_id IN (${placeholders})
        GROUP BY target_id, emoji
      `).bind(...commentIds).all();

      for (const r of reactions.results) {
        if (!reactionMap[r.target_id]) reactionMap[r.target_id] = {};
        reactionMap[r.target_id][r.emoji] = r.count;
      }

      const mine = await db.prepare(`
        SELECT target_id, emoji
        FROM community_reaction
        WHERE target_type = 'comment' AND target_id IN (${placeholders}) AND user_id = ?
      `).bind(...commentIds, user.id).all();

      for (const r of mine.results) {
        if (!userReactions[r.target_id]) userReactions[r.target_id] = [];
        userReactions[r.target_id].push(r.emoji);
      }
    }

    // Build threaded structure
    const topLevel = [];
    const repliesMap = new Map();

    for (const row of rows.results) {
      const comment = {
        id: row.id,
        authorId: row.author_id,
        authorName: row.author_name || displayName(row),
        authorRole: row.author_role,
        authorAvatar: row.author_avatar || null,
        content: row.content,
        parentId: row.parent_id,
        createdAt: row.created_at,
        reactions: reactionMap[row.id] || {},
        myReactions: userReactions[row.id] || [],
        isOwn: row.author_id === user.id,
      };

      if (!row.parent_id) {
        comment.replies = [];
        topLevel.push(comment);
      } else {
        if (!repliesMap.has(row.parent_id)) repliesMap.set(row.parent_id, []);
        repliesMap.get(row.parent_id).push(comment);
      }
    }

    for (const comment of topLevel) {
      comment.replies = repliesMap.get(comment.id) || [];
    }

    return json({ ok: true, comments: topLevel, count: rows.results.length });
  } catch (err) {
    console.error('community comments GET error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
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

    const { postId, content, parentId } = body;
    if (!postId) return json({ ok: false, error: 'postId required' }, 400);
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return json({ ok: false, error: 'Content required' }, 400);
    }
    if (content.length > 2000) {
      return json({ ok: false, error: 'Comment too long (max 2000 chars)' }, 400);
    }

    const db = env.DB;

    // Verify post exists
    const post = await db.prepare('SELECT id, channel FROM community_post WHERE id = ?').bind(postId).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    // Archive channels are read-only for non-admin users
    if (post.channel !== 'stuc' && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    // If replying, verify parent exists and is top-level
    if (parentId) {
      const parent = await db.prepare(
        'SELECT id FROM community_comment WHERE id = ? AND post_id = ? AND parent_id IS NULL'
      ).bind(parentId, postId).first();
      if (!parent) return json({ ok: false, error: 'Parent comment not found' }, 400);
    }

    const id = generateId();
    await db.prepare(`
      INSERT INTO community_comment (id, post_id, author_id, parent_id, content)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, postId, user.id, parentId || null, content.trim()).run();

    return json({
      ok: true,
      comment: {
        id,
        authorId: user.id,
        authorName: displayName(user),
        authorRole: user.role,
        content: content.trim(),
        parentId: parentId || null,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        reactions: {},
        myReactions: [],
        isOwn: true,
        replies: [],
      },
    }, 201);
  } catch (err) {
    console.error('community comments POST error:', err.message, err.stack);
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

    const { commentId } = body;
    if (!commentId) return json({ ok: false, error: 'commentId required' }, 400);

    const db = env.DB;
    const comment = await db.prepare('SELECT * FROM community_comment WHERE id = ?').bind(commentId).first();
    if (!comment) return json({ ok: false, error: 'Comment not found' }, 404);

    // Archive channels are read-only for non-admin users
    const parentPost = await db.prepare('SELECT channel FROM community_post WHERE id = ?').bind(comment.post_id).first();
    if (parentPost && ARCHIVE_CHANNELS.includes(parentPost.channel) && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    if (!canDeleteComment(user.role, user.id, comment)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    await db.batch([
      db.prepare("DELETE FROM community_reaction WHERE target_type = 'comment' AND target_id = ?").bind(commentId),
      db.prepare('DELETE FROM community_comment WHERE parent_id = ?').bind(commentId),
      db.prepare('DELETE FROM community_comment WHERE id = ?').bind(commentId),
    ]);

    return json({ ok: true });
  } catch (err) {
    console.error('community comments DELETE error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
