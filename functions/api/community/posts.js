/**
 * GET    /api/community/posts?type=&before=&limit=&channel=  — list posts
 * GET    /api/community/posts?id=                             — single post by ID
 * GET    /api/community/posts?slug=                           — single event post by slug
 * POST   /api/community/posts                                 — create post
 * PATCH  /api/community/posts                                 — edit / pin
 * DELETE /api/community/posts                                 — delete post
 */
import { json, optionsResponse, generateId } from '../auth/_shared.js';
import { log } from '../_log.js';
import {
  requireMember, displayName, canCreateType, canEditPost, canDeletePost, canPin, roleAtLeast,
  tierFromLabel, TIER_LABELS,
} from './_shared.js';
import { notifyNewPost } from './_email.js';

const VALID_CHANNELS = ['stuc', 'members', 'masterclass'];

// Merged content field with fallback to legacy title+body
function postContent(r) {
  if (r.content) return r.content;
  if (r.title && r.body) return r.title + '\n\n' + r.body;
  return r.title || r.body || '';
}
const ARCHIVE_CHANNELS = ['members', 'masterclass'];

function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isOgImageUrlSafe(url) {
  if (isSafeUrl(url)) return true;
  return url.startsWith('/api/assets/community/');
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/'/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET: list posts ---

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const url = new URL(request.url);
    const db = env.DB;
    const tierPlaceholders = TIER_LABELS.map(() => '?').join(', ');

    // Single post by ID or slug
    const singleId = url.searchParams.get('id');
    const singleSlug = url.searchParams.get('slug');
    if (singleId || singleSlug) {
      let row;
      if (singleId) {
        if (typeof singleId !== 'string' || singleId.length > 100) return json({ ok: false, error: 'Invalid id' }, 400);
        row = await db.prepare(`
          SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
            (SELECT ul.label FROM user_label ul WHERE ul.user_id = p.author_id AND ul.label IN (${tierPlaceholders}) LIMIT 1) as author_tier_label,
            (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
          FROM community_post p
          JOIN user u ON u.id = p.author_id
          WHERE p.id = ?
        `).bind(...TIER_LABELS, singleId).first();
      } else {
        if (typeof singleSlug !== 'string' || singleSlug.length > 100) return json({ ok: false, error: 'Invalid slug' }, 400);
        row = await db.prepare(`
          SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
            (SELECT ul.label FROM user_label ul WHERE ul.user_id = p.author_id AND ul.label IN (${tierPlaceholders}) LIMIT 1) as author_tier_label,
            (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
          FROM community_post p
          JOIN user u ON u.id = p.author_id
          WHERE p.slug = ? COLLATE NOCASE AND p.type = 'event'
        `).bind(...TIER_LABELS, singleSlug).first();
      }

      if (!row) return json({ ok: false, error: 'Post not found' }, 404);

      if (row.channel !== 'stuc' && !roleAtLeast(user.role, 'admin')) {
        return json({ ok: false, error: 'Not authorized for this channel' }, 403);
      }

      const targetId = row.id;

      // Reactions
      const reactions = await db.prepare(`
        SELECT emoji, COUNT(*) as count FROM community_reaction
        WHERE target_type = 'post' AND target_id = ? GROUP BY emoji
      `).bind(targetId).all();
      const reactionMap = {};
      for (const r of reactions.results) reactionMap[r.emoji] = r.count;

      const mine = await db.prepare(`
        SELECT emoji FROM community_reaction
        WHERE target_type = 'post' AND target_id = ? AND user_id = ?
      `).bind(targetId, user.id).all();
      const myReactions = mine.results.map(r => r.emoji);

      return json({ ok: true, post: {
        id: row.id, type: row.type, body: postContent(row),
        pinned: !!row.pinned, eventDate: row.event_date, eventLink: row.event_link,
        resourceUrl: row.resource_url, createdAt: row.created_at, updatedAt: row.updated_at,
        slug: row.slug || null, ogImageUrl: row.og_image_url || null,
        authorId: row.author_id, authorName: row.author_name || displayName(row),
        authorRole: row.author_role, authorAvatar: row.author_avatar || null,
        authorTier: tierFromLabel(row.author_tier_label), commentCount: row.comment_count,
        reactions: reactionMap, myReactions, isOwn: row.author_id === user.id,
      }});
    }

    const type = url.searchParams.get('type');
    const before = url.searchParams.get('before');
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50));
    const channelParam = url.searchParams.get('channel') || 'stuc';
    const channel = VALID_CHANNELS.includes(channelParam) ? channelParam : 'stuc';

    // Archive channels are admin-only
    if (channel !== 'stuc' && !roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized for this channel' }, 403);
    }

    let sql, params;

    if (type === 'event') {
      // Events: upcoming first (ASC), then past (DESC)
      const now = new Date().toISOString();
      let eventWhere = "WHERE p.type = 'event' AND p.channel = ?";
      params = [...TIER_LABELS, channel];
      if (before) {
        eventWhere += ' AND p.event_date < ?';
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
      body: postContent(r),
      pinned: !!r.pinned,
      eventDate: r.event_date,
      eventLink: r.event_link,
      resourceUrl: r.resource_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      slug: r.slug || null,
      ogImageUrl: r.og_image_url || null,
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
    log(env, waitUntil, 'community', 'post_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST: create post ---

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

    const { type, title, body: postBody, eventDate, eventLink, resourceUrl, channel: reqChannel, slug: reqSlug, ogImageUrl: reqOgImageUrl } = body;

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
    if (!postBody || typeof postBody !== 'string' || postBody.trim().length === 0) {
      return json({ ok: false, error: 'Post cannot be empty' }, 400);
    }
    if (postBody.length > 10000) {
      return json({ ok: false, error: 'Post too long (max 10000 chars)' }, 400);
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

    // For events, prepend title to content if provided separately
    const contentToStore = (type === 'event' && title && typeof title === 'string' && title.trim())
      ? title.trim() + '\n\n' + postBody.trim()
      : postBody.trim();

    // Slug and ogImageUrl for event posts
    let finalSlug = null;
    let finalOgImageUrl = null;
    if (type === 'event') {
      if (reqOgImageUrl !== undefined && reqOgImageUrl !== null) {
        if (typeof reqOgImageUrl !== 'string' || reqOgImageUrl.length > 2000) {
          return json({ ok: false, error: 'Invalid og_image_url' }, 400);
        }
        if (!isOgImageUrlSafe(reqOgImageUrl)) {
          return json({ ok: false, error: 'og_image_url must be http/https or a community asset path' }, 400);
        }
        finalOgImageUrl = reqOgImageUrl;
      }

      // Determine candidate slug
      let candidateBase;
      if (reqSlug !== undefined && reqSlug !== null) {
        if (typeof reqSlug !== 'string' || reqSlug.length > 100) {
          return json({ ok: false, error: 'Invalid slug' }, 400);
        }
        candidateBase = slugify(reqSlug);
      } else {
        const slugSource = (title && typeof title === 'string' && title.trim())
          ? title.trim()
          : postBody.trim().slice(0, 60);
        candidateBase = slugify(slugSource);
      }

      if (!candidateBase) {
        return json({ ok: false, error: 'Could not generate a valid slug from title' }, 400);
      }

      // Uniqueness check: one round-trip for exact match, then one for numbered variants
      let candidate = candidateBase;
      const exactCollision = await db.prepare(
        'SELECT 1 FROM community_post WHERE slug = ? COLLATE NOCASE'
      ).bind(candidate).first();

      if (exactCollision) {
        const variants = await db.prepare(
          'SELECT slug FROM community_post WHERE slug LIKE ? COLLATE NOCASE'
        ).bind(candidateBase + '-%').all();
        const used = new Set();
        for (const row of (variants.results || [])) {
          const m = row.slug.match(/-(\d+)$/);
          if (m) used.add(parseInt(m[1], 10));
        }
        let found = false;
        for (let i = 2; i <= 99; i++) {
          if (!used.has(i)) { candidate = candidateBase + '-' + i; found = true; break; }
        }
        if (!found) {
          return json({ ok: false, error: 'slug_conflict' }, 409);
        }
      }
      finalSlug = candidate;
    }

    const titleForInsert = (type === 'event' && title && typeof title === 'string' && title.trim())
      ? title.trim()
      : postBody.trim().slice(0, 200);

    try {
      await db.prepare(`
        INSERT INTO community_post (id, author_id, type, title, content, event_date, event_link, resource_url, channel, slug, og_image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, user.id, type, titleForInsert, contentToStore,
        eventDate || null, eventLink || null, resourceUrl || null, channel,
        finalSlug, finalOgImageUrl
      ).run();
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return json({ ok: false, error: 'slug_conflict' }, 409);
      }
      throw err;
    }

    // Send email notification (fire-and-forget)
    try {
      await notifyNewPost(env, db, {
        id, type, title: (title && typeof title === 'string') ? title.trim() : null,
        body: contentToStore, authorId: user.id, event_date: eventDate || null,
      }, displayName(user));
    } catch (err) {
      log(env, waitUntil, 'community', 'post_error', 'error', `notification: ${err.message}`, 0, 0);
    }

    return json({
      ok: true,
      post: {
        id, type, body: contentToStore,
        pinned: false, eventDate, eventLink, resourceUrl,
        slug: finalSlug, ogImageUrl: finalOgImageUrl,
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
    log(env, waitUntil, 'community', 'post_error', 'error', `POST: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- PATCH: edit / pin ---

export async function onRequestPatch({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { postId, title, body: postBody, eventDate, eventLink, resourceUrl, pinned, slug: reqSlug, ogImageUrl: reqOgImageUrl } = body;
    if (!postId || typeof postId !== 'string' || postId.length > 100) return json({ ok: false, error: 'postId required' }, 400);

    const db = env.DB;
    const post = await db.prepare('SELECT * FROM community_post WHERE id = ?').bind(postId).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

    // Pin/unpin — mod+ only
    if (pinned !== undefined) {
      if (!canPin(user.role)) return json({ ok: false, error: 'Not authorized' }, 403);
    }

    const hasBodyEdits = postBody !== undefined || eventDate !== undefined || eventLink !== undefined || resourceUrl !== undefined || reqSlug !== undefined || reqOgImageUrl !== undefined;

    if (hasBodyEdits) {
      if (ARCHIVE_CHANNELS.includes(post.channel) && !roleAtLeast(user.role, 'admin')) {
        return json({ ok: false, error: 'Not authorized for this channel' }, 403);
      }
      if (!canEditPost(user.role, user.id, post)) {
        return json({ ok: false, error: 'Not authorized' }, 403);
      }
    }

    const updates = [];
    const values = [];

    if (pinned !== undefined) {
      updates.push('pinned = ?'); values.push(pinned ? 1 : 0);
    }

    if (postBody !== undefined) {
      if (postBody.trim().length === 0) return json({ ok: false, error: 'Post cannot be empty' }, 400);
      if (postBody.length > 10000) return json({ ok: false, error: 'Post too long' }, 400);
      updates.push('content = ?'); values.push(postBody.trim());
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

    if (reqSlug !== undefined) {
      if (reqSlug === null) {
        updates.push('slug = ?'); values.push(null);
      } else {
        if (typeof reqSlug !== 'string' || reqSlug.length > 100) {
          return json({ ok: false, error: 'Invalid slug' }, 400);
        }
        const newSlug = slugify(reqSlug);
        if (!newSlug) return json({ ok: false, error: 'Invalid slug' }, 400);
        // Uniqueness check — exclude the current post
        const collision = await db.prepare(
          'SELECT 1 FROM community_post WHERE slug = ? COLLATE NOCASE AND id != ?'
        ).bind(newSlug, postId).first();
        if (collision) return json({ ok: false, error: 'slug_conflict' }, 409);
        updates.push('slug = ?'); values.push(newSlug);
      }
    }

    if (reqOgImageUrl !== undefined) {
      if (reqOgImageUrl === null) {
        updates.push('og_image_url = ?'); values.push(null);
      } else {
        if (typeof reqOgImageUrl !== 'string' || reqOgImageUrl.length > 2000) {
          return json({ ok: false, error: 'Invalid og_image_url' }, 400);
        }
        if (!isOgImageUrlSafe(reqOgImageUrl)) {
          return json({ ok: false, error: 'og_image_url must be http/https or a community asset path' }, 400);
        }
        updates.push('og_image_url = ?'); values.push(reqOgImageUrl);
      }
    }

    if (!updates.length) return json({ ok: false, error: 'Nothing to update' }, 400);

    updates.push("updated_at = datetime('now')");
    values.push(postId);

    const oldOgImageUrl = post.og_image_url;

    try {
      await db.prepare(`UPDATE community_post SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...values).run();
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return json({ ok: false, error: 'slug_conflict' }, 409);
      }
      throw err;
    }

    if (reqOgImageUrl !== undefined && env.R2_ASSETS && oldOgImageUrl && oldOgImageUrl !== reqOgImageUrl) {
      const match = oldOgImageUrl.match(/\/api\/assets\/(.+)$/);
      if (match) {
        waitUntil(env.R2_ASSETS.delete(match[1]).catch((err) => {
          log(env, waitUntil, 'community', 'r2_cleanup_failed', 'error', err.message);
        }));
      }
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'post_error', 'error', `PATCH: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- DELETE ---

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

    const { postId } = body;
    if (!postId || typeof postId !== 'string' || postId.length > 100) return json({ ok: false, error: 'postId required' }, 400);

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

    // Manually clean reactions, flags, and comments -- D1 CASCADE is inert
    // ORDER MATTERS: comment-children flag/reaction cleanup (statements 2 and 4) MUST run
    // BEFORE `DELETE FROM community_comment` (statement 5) because D1 batch executes
    // statements serially within a transaction -- subselects in later statements see earlier
    // statements' writes. If `community_comment` rows are deleted first, the comment-flag
    // and comment-reaction subselects against `community_comment` return empty and those
    // child rows are orphaned.
    await db.batch([
      db.prepare("DELETE FROM community_flag WHERE target_type = 'post' AND target_id = ?").bind(postId),
      db.prepare("DELETE FROM community_flag WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE post_id = ?)").bind(postId),
      db.prepare("DELETE FROM community_reaction WHERE target_type = 'post' AND target_id = ?").bind(postId),
      db.prepare("DELETE FROM community_reaction WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE post_id = ?)").bind(postId),
      db.prepare('DELETE FROM community_comment WHERE post_id = ?').bind(postId),
      db.prepare('DELETE FROM community_post WHERE id = ?').bind(postId),
    ]);

    if (post.og_image_url && env.R2_ASSETS) {
      const match = post.og_image_url.match(/\/api\/assets\/(.+)$/);
      if (match) {
        waitUntil(env.R2_ASSETS.delete(match[1]).catch((err) => {
          log(env, waitUntil, 'community', 'r2_cleanup_failed', 'error', err.message);
        }));
      }
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'post_error', 'error', `DELETE: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
