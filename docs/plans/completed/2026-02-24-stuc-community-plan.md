# STUC Community Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a member-only community into the RRM Academy Astro site, replacing the Wix Groups dependency for Save the Uterus Club.

**Architecture:** Static Astro pages (shells) + CF Pages Functions (API) + D1 (storage). Same patterns as courses/account. Subscription-gated via Stripe billing check. Feature ships live but Wix URLs stay unchanged until manual cutover.

**Tech Stack:** Astro SSG, CF Pages Functions, D1 (SQLite), Stripe API (subscription check), existing auth system (session cookies)

**Design doc:** `docs/plans/2026-02-24-stuc-community-design.md`

---

## Task 1: D1 Schema — Community Tables

**Files:**
- Modify: `schema.sql` (append community tables)

**Step 1: Add community tables to schema.sql**

Append after the lesson_comment indexes (line 87):

```sql
-- Phase 8: Community (Save the Uterus Club)

CREATE TABLE IF NOT EXISTS community_post (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES user(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    pinned INTEGER DEFAULT 0,
    event_date TEXT,
    event_link TEXT,
    resource_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_comment (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES community_post(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES user(id),
    parent_id TEXT REFERENCES community_comment(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS community_reaction (
    user_id TEXT NOT NULL REFERENCES user(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, target_type, target_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_community_post_type ON community_post(type);
CREATE INDEX IF NOT EXISTS idx_community_post_pinned ON community_post(pinned, created_at);
CREATE INDEX IF NOT EXISTS idx_community_comment_post ON community_comment(post_id);
CREATE INDEX IF NOT EXISTS idx_community_reaction_target ON community_reaction(target_type, target_id);
```

**Step 2: Apply to remote D1**

```bash
npx wrangler d1 execute rrm-auth --remote --file=schema.sql
```

Verify the tables exist:
```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'community%'"
```

Expected: `community_post`, `community_comment`, `community_reaction`

**Step 3: Set roles for Brian, Naomi, Lorraine**

```bash
npx wrangler d1 execute rrm-auth --remote --command="UPDATE user SET role = 'superadmin' WHERE email = 'brian@rrmacademy.org'"
npx wrangler d1 execute rrm-auth --remote --command="UPDATE user SET role = 'admin' WHERE email = 'naomi@rrmacademy.org'"
npx wrangler d1 execute rrm-auth --remote --command="UPDATE user SET role = 'mod' WHERE email = 'lorraine@rrmacademy.org'"
```

Verify:
```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT email, role FROM user WHERE role != 'member'"
```

**Step 4: Commit**

```bash
git add schema.sql
git commit -m "schema: add community tables for STUC member board"
```

---

## Task 2: Community Shared Helpers

**Files:**
- Create: `functions/api/community/_shared.js`

This file provides `requireMember()` (auth + subscription check) and permission helpers used by all community endpoints.

**Step 1: Create the shared module**

```js
/**
 * Shared community helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import Stripe from 'stripe';
import {
  json, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';

// --- Role hierarchy ---

const ROLES = ['member', 'mod', 'admin', 'superadmin'];

export function roleAtLeast(userRole, minRole) {
  return ROLES.indexOf(userRole) >= ROLES.indexOf(minRole);
}

// --- Post type permissions ---

const STAFF_ONLY_TYPES = ['announcement', 'event', 'resource'];

export function canCreateType(role, type) {
  if (STAFF_ONLY_TYPES.includes(type)) return roleAtLeast(role, 'admin');
  return true; // anyone can create 'discussion'
}

export function canEditPost(role, userId, post) {
  if (roleAtLeast(role, 'admin')) return true;
  return userId === post.author_id;
}

export function canDeletePost(role, userId, post) {
  if (roleAtLeast(role, 'admin')) return true;
  return userId === post.author_id;
}

export function canPin(role) {
  return roleAtLeast(role, 'mod');
}

export function canDeleteComment(role, userId, comment) {
  if (roleAtLeast(role, 'mod')) return true;
  return userId === comment.author_id;
}

export function canManageRoles(role) {
  return roleAtLeast(role, 'admin');
}

export function canSetRole(assignerRole, targetRole) {
  if (targetRole === 'superadmin') return assignerRole === 'superadmin';
  return roleAtLeast(assignerRole, 'admin');
}

// --- Membership gate ---

/**
 * Validates session + active STUC subscription.
 * Returns { user, tier, session } or a Response (401/403/500).
 */
export async function requireMember(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  const user = await db.prepare(
    'SELECT id, email, name, first_name, last_name, role, stripe_customer_id FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return json({ ok: false, error: 'User not found' }, 401);

  // Staff bypass subscription check — they always have access
  if (roleAtLeast(user.role, 'mod')) {
    return { user, tier: 'staff', session };
  }

  // Members need an active subscription
  if (!user.stripe_customer_id || !env.STRIPE_SECRET_KEY) {
    return json({ ok: false, error: 'Membership required' }, 403);
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: '2024-12-18.acacia',
  });

  const subs = await stripe.subscriptions.list({
    customer: user.stripe_customer_id,
    status: 'active',
    limit: 1,
  });

  if (!subs.data.length) {
    return json({ ok: false, error: 'Membership required' }, 403);
  }

  const priceToTier = {};
  if (env.STRIPE_PRICE_MEMBER) priceToTier[env.STRIPE_PRICE_MEMBER] = 'member';
  if (env.STRIPE_PRICE_HERO) priceToTier[env.STRIPE_PRICE_HERO] = 'hero';
  if (env.STRIPE_PRICE_SUPERHERO) priceToTier[env.STRIPE_PRICE_SUPERHERO] = 'superhero';

  const price = subs.data[0].items.data[0]?.price;
  const tier = priceToTier[price?.id] || 'member';

  return { user, tier, session };
}

// --- Display name helper ---

export function displayName(user) {
  if (user.name) return user.name;
  if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name.charAt(0)}.`;
  if (user.first_name) return user.first_name;
  return 'Member';
}
```

**Step 2: Commit**

```bash
git add functions/api/community/_shared.js
git commit -m "feat: community shared helpers — requireMember, role permissions"
```

---

## Task 3: Posts API

**Files:**
- Create: `functions/api/community/posts.js`

Handles GET (list, paginated), POST (create), PATCH (edit/pin), DELETE.

**Step 1: Create the posts endpoint**

Reference pattern: `functions/api/courses/comments.js` for structure.

```js
/**
 * GET    /api/community/posts?type=&before=&limit=  — list posts
 * POST   /api/community/posts                        — create post
 * PATCH  /api/community/posts                        — edit / pin
 * DELETE /api/community/posts                        — delete post
 */
import { json, optionsResponse, generateId } from '../auth/_shared.js';
import {
  requireMember, displayName, canCreateType, canEditPost, canDeletePost, canPin,
} from './_shared.js';

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

    const db = env.DB;
    let sql, params;

    if (type === 'event') {
      // Events: upcoming first (ASC), then past (DESC)
      const now = new Date().toISOString();
      sql = `
        SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role,
          (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
        FROM community_post p
        JOIN user u ON u.id = p.author_id
        WHERE p.type = 'event'
        ORDER BY
          CASE WHEN p.event_date >= ? THEN 0 ELSE 1 END,
          CASE WHEN p.event_date >= ? THEN p.event_date END ASC,
          CASE WHEN p.event_date < ? THEN p.event_date END DESC
        LIMIT ?
      `;
      params = [now, now, now, limit];
    } else {
      // All other types: pinned first, then by created_at DESC
      let whereClause = '';
      params = [];

      if (type) {
        whereClause += ' AND p.type = ?';
        params.push(type);
      }
      if (before) {
        whereClause += ' AND p.created_at < ?';
        params.push(before);
      }

      sql = `
        SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role,
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

    const { type, title, body: postBody, eventDate, eventLink, resourceUrl } = body;

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

    const id = generateId();
    const db = env.DB;

    await db.prepare(`
      INSERT INTO community_post (id, author_id, type, title, body, event_date, event_link, resource_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, user.id, type, title.trim(), postBody?.trim() || null,
      eventDate || null, eventLink || null, resourceUrl || null
    ).run();

    return json({
      ok: true,
      post: {
        id, type, title: title.trim(), body: postBody?.trim() || null,
        pinned: false, eventDate, eventLink, resourceUrl,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        authorId: user.id,
        authorName: displayName(user),
        authorRole: user.role,
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
    if (eventLink !== undefined) { updates.push('event_link = ?'); values.push(eventLink); }
    if (resourceUrl !== undefined) { updates.push('resource_url = ?'); values.push(resourceUrl); }

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

    if (!canDeletePost(user.role, user.id, post)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    // CASCADE deletes comments; manually clean reactions
    await db.batch([
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
```

**Step 2: Build to verify no syntax errors**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add functions/api/community/posts.js
git commit -m "feat: community posts API — CRUD with role-based permissions"
```

---

## Task 4: Comments API

**Files:**
- Create: `functions/api/community/comments.js`

Pattern: mirrors `functions/api/courses/comments.js` but with `requireMember` instead of enrollment check.

**Step 1: Create the comments endpoint**

```js
/**
 * GET    /api/community/comments?postId=  — list comments (threaded)
 * POST   /api/community/comments          — create comment / reply
 * DELETE /api/community/comments          — delete comment
 */
import { json, optionsResponse, generateId } from '../auth/_shared.js';
import { requireMember, displayName, canDeleteComment } from './_shared.js';

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
             u.name as author_name, u.first_name, u.last_name, u.role as author_role
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
    const post = await db.prepare('SELECT id FROM community_post WHERE id = ?').bind(postId).first();
    if (!post) return json({ ok: false, error: 'Post not found' }, 404);

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
```

**Step 2: Commit**

```bash
git add functions/api/community/comments.js
git commit -m "feat: community comments API — threaded replies with moderation"
```

---

## Task 5: Reactions API

**Files:**
- Create: `functions/api/community/reactions.js`

**Step 1: Create the reactions endpoint**

```js
/**
 * POST   /api/community/reactions  — toggle reaction (add if missing, remove if exists)
 * DELETE /api/community/reactions  — explicit remove
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember } from './_shared.js';

const ALLOWED_EMOJI = ['❤️', '👏', '🔥', '💡', '🙏', '😢'];

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

    // Toggle: check if exists, then add or remove
    const existing = await db.prepare(
      'SELECT rowid FROM community_reaction WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?'
    ).bind(user.id, targetType, targetId, emoji).first();

    if (existing) {
      await db.prepare(
        'DELETE FROM community_reaction WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?'
      ).bind(user.id, targetType, targetId, emoji).run();
      return json({ ok: true, action: 'removed' });
    }

    await db.prepare(
      'INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?, ?, ?, ?)'
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
```

**Step 2: Commit**

```bash
git add functions/api/community/reactions.js
git commit -m "feat: community reactions API — emoji toggle on posts and comments"
```

---

## Task 6: Roles API

**Files:**
- Create: `functions/api/community/roles.js`

**Step 1: Create the roles endpoint**

```js
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
```

**Step 2: Commit**

```bash
git add functions/api/community/roles.js
git commit -m "feat: community roles API — admin+ role management"
```

---

## Task 7: Membership Status API

**Files:**
- Create: `functions/api/community/status.js`

A lightweight endpoint the community pages call on load to check: is the user logged in, are they a member, what's their role? Used by the Astro shell to decide whether to show the feed or the gate page.

**Step 1: Create the status endpoint**

```js
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
      const user = await db.prepare('SELECT name, first_name, last_name, role FROM user WHERE id = ?')
        .bind(session.userId).first();
      return json({
        ok: true,
        access: 'registered',
        user: { name: displayName(user || {}), role: user?.role || 'member' },
      });
    }

    return json({
      ok: true,
      access: 'member',
      user: {
        id: auth.user.id,
        name: displayName(auth.user),
        role: auth.user.role,
        tier: auth.tier,
      },
    });
  } catch (err) {
    console.error('community status error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

**Step 2: Commit**

```bash
git add functions/api/community/status.js
git commit -m "feat: community status API — access check for page gating"
```

---

## Task 8: Middleware — Protect /community/*

**Files:**
- Modify: `functions/_middleware.js`

**Step 1: Add /community/* to the auth-protected routes**

Add a block after the `/account` protection (after line 51) that redirects unauthenticated users hitting `/community` to login:

```js
// Auth protection: /community/* requires a valid session
// Subscription check happens client-side via /api/community/status
if (url.pathname === '/community' || url.pathname.startsWith('/community/')) {
  if (!env.DB) {
    return new Response('Service Unavailable', { status: 503 });
  }
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  const sessionId = match ? match[1] : null;

  if (!sessionId) {
    return Response.redirect(`https://rrmacademy.org/login?redirect=${encodeURIComponent(url.pathname)}`, 302);
  }

  const session = await env.DB.prepare('SELECT expires_at FROM session WHERE id = ?')
    .bind(sessionId).first();
  const now = Math.floor(Date.now() / 1000);
  if (!session || now >= session.expires_at) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `https://rrmacademy.org/login?redirect=${encodeURIComponent(url.pathname)}`,
        'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      },
    });
  }
}
```

**Step 2: Build to verify**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add functions/_middleware.js
git commit -m "feat: protect /community/* routes with session middleware"
```

---

## Task 9: Community Main Page (`/community`)

**Files:**
- Create: `src/pages/community/index.astro`

Static Astro shell. Client-side JS checks `/api/community/status` on load — shows gate page (STUC pitch) for non-members, shows feed for members. All data fetched from `/api/community/posts`.

This is the largest file. It contains:
1. The gate page (non-member view)
2. The feed (member view) with filter tabs
3. Compose form (inline)
4. Post cards with reactions
5. All CSS
6. All client-side JS

**Reference patterns:**
- `src/pages/courses/[slug]/[stepId].astro` — for inline script + CSS + client-side fetch pattern
- `src/pages/account/index.astro` — for session-gated page shell

**Step 1: Create the page**

The full file is large (400+ lines). Key structure:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
---
<BaseLayout title="Community — Save the Uterus Club" description="Member community">

  <!-- Loading state -->
  <div id="community-loading" class="community-loading container">
    <p>Loading...</p>
  </div>

  <!-- Gate page (non-members) -->
  <div id="community-gate" class="community-gate container" style="display:none">
    <!-- STUC pitch + 3 tier cards + Instagram CTA for free users -->
  </div>

  <!-- Feed (members) -->
  <div id="community-feed" class="community-feed container" style="display:none">
    <div class="community-header">
      <h1>Save the Uterus Club</h1>
      <p id="community-welcome"></p>
    </div>
    <!-- Filter tabs -->
    <!-- Compose form -->
    <!-- Post list -->
    <!-- Load more button -->
  </div>

</BaseLayout>

<!-- Client-side JS -->
<script is:inline>
  // 1. Check /api/community/status
  // 2. Show gate or feed
  // 3. If feed: fetch /api/community/posts, render cards
  // 4. Handle compose, reactions, filter tabs, load-more
</script>

<style>
  /* Community-specific styles */
</style>
```

Implement the full page with:
- Gate page: hero with STUC description, 3 tier cards (matching `/save-the-uterus-club` pricing), Instagram CTA for free users
- Feed: filter tabs (All/Announcements/Events/Resources/Discussions), pinned posts at top, post cards with type badge + author + time-ago + body preview + reactions + comment count
- Compose: inline form at top (title + body for members, + type/event/resource fields for staff)
- Post cards: click to navigate to `/community/post/{id}`
- Reactions: emoji bar with toggle (match ALLOWED_EMOJI from API)
- Pagination: "Load more" button using cursor-based `?before=`

**Step 2: Build to verify**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/pages/community/index.astro
git commit -m "feat: community main page — feed, compose, gate, reactions"
```

---

## Task 10: Single Post Page (`/community/post/[id]`)

**Files:**
- Create: `src/pages/community/post/[id].astro`

Shows full post with markdown body, reactions, and threaded comments.

**Key features:**
- Full post body (rendered as text — no markdown library, just whitespace-pre-wrap for now)
- Reaction bar (same emoji set as feed)
- Threaded comments (one level deep, same pattern as lesson comments)
- Comment compose box
- Staff controls: edit, delete, pin/unpin buttons
- Back link to `/community`

**Step 1: Create the page**

Static Astro shell with `getStaticPaths` returning empty (dynamic route, CF Pages handles it). Client-side JS extracts post ID from URL, fetches from API.

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';

export function getStaticPaths() {
  return [{ params: { id: 'placeholder' } }];
}
---
```

Note: CF Pages handles dynamic routes for Functions. Since this is a static page that fetches data client-side, we need to generate it as a catch-all. Use `[...id].astro` if single `[id].astro` doesn't work with Astro's static build.

**Step 2: Build and verify**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/pages/community/post/
git commit -m "feat: single post page — full body, comments, reactions"
```

---

## Task 11: Events Page (`/community/events`)

**Files:**
- Create: `src/pages/community/events.astro`

Dedicated events view. Fetches `/api/community/posts?type=event`. Shows upcoming events with prominent date + Meet link, past events with recording link.

**Key features:**
- Upcoming section: date/time prominent, "Join Call" button (links to Google Meet), "Add to Google Calendar" link
- Past section: date, title, recording link (if resource_url set)
- Staff see "New Event" button that opens the compose form

The "Add to Google Calendar" link is a URL:
```
https://calendar.google.com/calendar/render?action=TEMPLATE&text={title}&dates={start}/{end}&details={body}
```

**Step 1: Create the page**

**Step 2: Build and verify**

**Step 3: Commit**

```bash
git add src/pages/community/events.astro
git commit -m "feat: events page — upcoming calls with Meet links, past recordings"
```

---

## Task 12: Navigation Updates

**Files:**
- Modify: `src/components/Header.astro` (lines 3-16 for desktop nav, lines 32-61 for mobile nav)
- Modify: `src/components/Footer.astro` (lines 4-18 for help links)

**Step 1: Add Community to desktop nav**

In `Header.astro`, add after the Courses entry in `navItems` (line 15):

```js
{ label: 'Community', href: '/community' },
```

**Step 2: Add Community to mobile nav**

In `mobileNavSections`, add to the Education items (after Endo Self-Survey, line 50):

```js
{ label: 'Community', href: '/community', icon: 'users' },
```

The `users` icon already exists in the `icons` object (line 28).

**Step 3: Add Community to footer**

In `Footer.astro`, add to `helpLinks` after "Join Us" (line 16):

```js
{ label: 'Community', href: '/community', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
```

**Step 4: Build and verify**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/components/Header.astro src/components/Footer.astro
git commit -m "feat: add Community to site navigation"
```

---

## Task 13: Wix Cutover Tags

**Files:**
- Modify: `src/pages/save-the-uterus-club/thank-you.astro` (lines 30, 39)
- Modify: `src/pages/linkinbio/jointhecall.astro` (lines 40, 45)
- Modify: `functions/api/stripe-webhook.js` (line 167)

**DO NOT change the Wix URLs yet.** Add `// STUC-CUTOVER:` comments with the replacement URLs next to each Wix reference.

**Step 1: Tag each Wix URL**

For each of the 5 Wix URLs, add a comment on the line above or inline:

```
// STUC-CUTOVER: replace with /community
// STUC-CUTOVER: replace with /community/events
```

**Step 2: Commit**

```bash
git add src/pages/save-the-uterus-club/thank-you.astro src/pages/linkinbio/jointhecall.astro functions/api/stripe-webhook.js
git commit -m "chore: tag Wix URLs for STUC cutover"
```

---

## Task 14: Build Verification + Final Push

**Step 1: Full build**

```bash
npm run build
```

Expected: clean build, page count increases by 3 (community index, events, post placeholder).

**Step 2: Manual smoke test checklist**

- [ ] `/community` renders (shows loading → gate or feed depending on auth)
- [ ] `/community/events` renders
- [ ] `/community/post/placeholder` renders
- [ ] Navigation shows Community link in header, footer, mobile nav
- [ ] No console errors
- [ ] Wix URLs unchanged in thank-you, jointhecall, webhook

**Step 3: Push**

```bash
git push
```

---

## Post-Deploy: Seed Content

Once deployed, seed the community with initial content via the API:

1. **Brian (superadmin)** creates a welcome announcement
2. **Brian** creates an upcoming event with the next live call date + Meet link
3. **Brian** creates a resource post linking to a past recording

This verifies the full flow end-to-end in production.

---

## Future: Cutover (When Brian Says "Flip It")

```bash
# Find all cutover tags
grep -rn 'STUC-CUTOVER' src/ functions/
# Replace each Wix URL with the tagged replacement
# Commit + push
```

Estimated time: 2 minutes.
