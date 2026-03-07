/**
 * GET    /api/community/posts?type=&before=&limit=&channel=  — list posts
 * POST   /api/community/posts                                 — create post
 * PATCH  /api/community/posts                                 — edit / pin
 * DELETE /api/community/posts                                 — delete post
 */
import { json, optionsResponse, generateId } from '../auth/_shared.js';
import {
  requireMember, displayName, canCreateType, canEditPost, canDeletePost, canPin, roleAtLeast,
  tierFromLabel, TIER_LABELS,
} from './_shared.js';
import { notifyNewPost } from './_email.js';

const VALID_CHANNELS = ['stuc', 'members', 'masterclass'];
const ARCHIVE_CHANNELS = ['members', 'masterclass'];

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET: list posts ---

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const before = url.searchParams.get('before');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
    const channelParam = url.searchParams.get('channel') || 'stuc';
    const channel = VALID_CHANNELS.includes(channelParam) ? channelParam : 'stuc';

    // Archive channels are admin-only
    if (channel !== 'stuc' && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    const db = env.DB;
    let sql, params;

    const tierPlaceholders = TIER_LABELS.map(() => '?').join(', ');

    if (type === 'event') {
      // Events: upcoming first (ASC), then past (DESC)
      const now = new Date().toISOString();
      let eventWhere = "WHERE p.type = 'event' AND p.channel = ?";
      params = [...TIER_LABELS, channel];
      if (before) {
        eventWhere += ' AND p.created_at < ?';
        params.push(before);
      }
      sql = `
        SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
          (SELECT ul.label FROM user_label ul WHERE ul.user_id = p.author_id AND ul.label IN (${tierPlaceholders}) LIMIT 1) as author_tier_label,
          (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
        FROM community_post p
        JOIN user u ON u.id = p.author_id
        ${eventWhere}
        ORDER BY
          CASE WHEN p.event_date >= ? THEN 0 ELSE 1 END,
          CASE WHEN p.event_date >= ? THEN p.event_date END ASC,
          CASE WHEN p.event_date < ? THEN p.event_date END DESC
        LIMIT ?
      `;
      params.push(now, now, now, limit);
    } else {
      // All other types: pinned first, then by created_at DESC
      let whereClause = ' AND p.channel = ?';
      params = [...TIER_LABELS, channel];

      if (type) {
        whereClause += ' AND p.type = ?';
        params.push(type);
      }
      if (before) {
        whereClause += ' AND p.created_at < ? AND p.pinned = 0';
        params.push(before);
      }

      sql = `
        SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
          (SELECT ul.label FROM user_label ul WHERE ul.user_id = p.author_id AND ul.label IN (${tierPlaceholders}) LIMIT 1) as author_tier_label,
          (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
        FROM community_post p
        JOIN user u ON u.id = p.author_id
        WHERE 1=1 ${whereClause}
        ORDER BY p.pinned DESC, p.created_at DESC
        LIMIT ?
      `;
      params.push(limit);
    }

    const rows = await db.prepare(sql).bind(...params).all();

    // Fetch reaction counts for all posts in one query
    const postIds = rows.results.map(r => r.id);
    let reactionMap = {};
    let userReactions = {};
    if (postIds.length) {
      const placeholders = postIds.map(() => '?').join(',');

      const reactions = await db.prepare(`
        SELECT target_id, emoji, COUNT(*) as count
        FROM community_reaction
        WHERE target_type = 'post' AND target_id IN (${placeholders})
        GROUP BY target_id, emoji
      `).bind(...postIds).all();

      for (const r of reactions.results) {
        if (!reactionMap[r.target_id]) reactionMap[r.target_id] = {};
        reactionMap[r.target_id][r.emoji] = r.count;
      }

      // User's own reactions
      const mine = await db.prepare(`
        SELECT target_id, emoji
        FROM community_reaction
        WHERE target_type = 'post' AND target_id IN (${placeholders}) AND user_id = ?
      `).bind(...postIds, user.id).all();

      for (const r of mine.results) {
        if (!userReactions[r.target_id]) userReactions[r.target_id] = [];
        userReactions[r.target_id].push(r.emoji);
      }
    }

    const posts = rows.results.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      pinned: !!r.pinned,
      eventDate: r.event_date,
      eventLink: r.event_link,
      resourceUrl: r.resource_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      authorId: r.author_id,
      authorName: r.author_name || displayName(r),
      authorRole: r.author_role,
      authorAvatar: r.author_avatar || null,
      authorTier: tierFromLabel(r.author_tier_label),
      commentCount: r.comment_count,
      reactions: reactionMap[r.id] || {},
      myReactions: userReactions[r.id] || [],
      isOwn: r.author_id === user.id,
    }));

    return json({ ok: true, posts });
  } catch (err) {
    console.error('community posts GET error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST: create post ---

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { type, title, body: postBody, eventDate, eventLink, resourceUrl, channel: reqChannel } = body;

    // Validate channel
    const channel = reqChannel || 'stuc';
    if (!VALID_CHANNELS.includes(channel)) {
      return json({ ok: false, error: 'Invalid channel' }, 400);
    }
    // Non-admin users can only post to stuc
    if (channel !== 'stuc' && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    // Validate type
    const validTypes = ['discussion', 'announcement', 'event', 'resource'];
    if (!type || !validTypes.includes(type)) {
      return json({ ok: false, error: 'Invalid post type' }, 400);
    }
    if (!canCreateType(user.role, type)) {
      return json({ ok: false, error: 'Not authorized for this post type' }, 403);
    }

    // Validate fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return json({ ok: false, error: 'Title required' }, 400);
    }
    if (title.length > 200) {
      return json({ ok: false, error: 'Title too long (max 200 chars)' }, 400);
    }
    if (postBody && postBody.length > 10000) {
      return json({ ok: false, error: 'Body too long (max 10000 chars)' }, 400);
    }

    // Event-specific validation
    if (type === 'event') {
      if (!eventDate) return json({ ok: false, error: 'Event date required' }, 400);
      if (!eventLink) return json({ ok: false, error: 'Event link required' }, 400);
    }

    if (eventLink && !isSafeUrl(eventLink)) {
      return json({ ok: false, error: 'Event link must be an http or https URL' }, 400);
    }
    if (resourceUrl && !isSafeUrl(resourceUrl)) {
      return json({ ok: false, error: 'Resource URL must be an http or https URL' }, 400);
    }

    const id = generateId();
    const db = env.DB;

    await db.prepare(`
      INSERT INTO community_post (id, author_id, type, title, body, event_date, event_link, resource_url, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, user.id, type, title.trim(), postBody?.trim() || null,
      eventDate || null, eventLink || null, resourceUrl || null, channel
    ).run();

    // Send email notification (fire-and-forget)
    try {
      await notifyNewPost(env, db, {
        id, title: title.trim(), body: postBody?.trim() || null, authorId: user.id,
      }, displayName(user));
    } catch (err) {
      console.error('Failed to send new post notification:', err.message);
    }

    return json({
      ok: true,
      post: {
        id, type, title: title.trim(), body: postBody?.trim() || null,
        pinned: false, eventDate, eventLink, resourceUrl,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        authorId: user.id,
        authorName: displayName(user),
        authorRole: user.role,
        authorAvatar: user.avatar_url || null,
        authorTier: null,
        commentCount: 0,
        reactions: {},
        myReactions: [],
        isOwn: true,
      },
    }, 201);
  } catch (err) {
    console.error('community posts POST error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- PATCH: edit / pin ---

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { postId, title, body: postBody, eventDate, eventLink, resourceUrl, pinned } = body;
    if (!postId) return json({ ok: false, error: 'postId required' }, 400);

    const db = env.DB;
    const post = await db.prepare('SELECT * FROM community_post WHERE id = ?').bind(postId).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    // Pin/unpin — mod+ only
    if (pinned !== undefined) {
      if (!canPin(user.role)) return json({ ok: false, error: 'Not authorized' }, 403);
      await db.prepare('UPDATE community_post SET pinned = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .bind(pinned ? 1 : 0, postId).run();
      return json({ ok: true, pinned: !!pinned });
    }

    // Archive channels are read-only for non-admin users
    if (ARCHIVE_CHANNELS.includes(post.channel) && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    // Edit — author or admin+
    if (!canEditPost(user.role, user.id, post)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    const updates = [];
    const values = [];

    if (title !== undefined) {
      if (title.length > 200) return json({ ok: false, error: 'Title too long' }, 400);
      updates.push('title = ?'); values.push(title.trim());
    }
    if (postBody !== undefined) {
      if (postBody.length > 10000) return json({ ok: false, error: 'Body too long' }, 400);
      updates.push('body = ?'); values.push(postBody.trim());
    }
    if (eventDate !== undefined) { updates.push('event_date = ?'); values.push(eventDate); }
    if (eventLink !== undefined) {
      if (eventLink && !isSafeUrl(eventLink)) return json({ ok: false, error: 'Event link must be an http or https URL' }, 400);
      updates.push('event_link = ?'); values.push(eventLink);
    }
    if (resourceUrl !== undefined) {
      if (resourceUrl && !isSafeUrl(resourceUrl)) return json({ ok: false, error: 'Resource URL must be an http or https URL' }, 400);
      updates.push('resource_url = ?'); values.push(resourceUrl);
    }

    if (!updates.length) return json({ ok: false, error: 'Nothing to update' }, 400);

    updates.push("updated_at = datetime('now')");
    values.push(postId);

    await db.prepare(`UPDATE community_post SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values).run();

    return json({ ok: true });
  } catch (err) {
    console.error('community posts PATCH error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- DELETE ---

export async function onRequestDelete({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { postId } = body;
    if (!postId) return json({ ok: false, error: 'postId required' }, 400);

    const db = env.DB;
    const post = await db.prepare('SELECT * FROM community_post WHERE id = ?').bind(postId).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    // Archive channels are read-only for non-admin users
    if (ARCHIVE_CHANNELS.includes(post.channel) && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    if (!canDeletePost(user.role, user.id, post)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    // CASCADE deletes comments; manually clean reactions and flags
    await db.batch([
      db.prepare("DELETE FROM community_flag WHERE target_type = 'post' AND target_id = ?").bind(postId),
      db.prepare("DELETE FROM community_flag WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE post_id = ?)").bind(postId),
      db.prepare("DELETE FROM community_reaction WHERE target_type = 'post' AND target_id = ?").bind(postId),
      db.prepare("DELETE FROM community_reaction WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE post_id = ?)").bind(postId),
      db.prepare('DELETE FROM community_post WHERE id = ?').bind(postId),
    ]);

    return json({ ok: true });
  } catch (err) {
    console.error('community posts DELETE error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
