/**
 * POST   /api/community/flags   -- create a flag (any member)
 * GET    /api/community/flags   -- list pending flags (mod+ only)
 * PATCH  /api/community/flags   -- resolve/dismiss a flag (admin+ only)
 */
import { json, optionsResponse, generateId, SITE_URL } from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember, roleAtLeast, canResolveFlag, displayName } from './_shared.js';
import { sendEmail } from '../_ses.js';

const VALID_REASONS = ['inappropriate', 'spam', 'harassment', 'other'];
const VALID_STATUSES = ['pending', 'resolved', 'dismissed'];

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

    const { targetType, targetId, reason, note } = body;

    if (!targetType || !['post', 'comment'].includes(targetType)) {
      return json({ ok: false, error: 'Invalid targetType' }, 400);
    }
    if (!targetId || typeof targetId !== 'string' || targetId.length > 100) return json({ ok: false, error: 'targetId required' }, 400);
    if (!reason || !VALID_REASONS.includes(reason)) {
      return json({ ok: false, error: 'Invalid reason' }, 400);
    }
    if (note && note.length > 500) {
      return json({ ok: false, error: 'Note too long (max 500 chars)' }, 400);
    }

    const db = env.DB;

    // Verify target exists
    if (targetType === 'post') {
      const post = await db.prepare('SELECT id FROM community_post WHERE id = ?').bind(targetId).first();
      if (!post) return json({ ok: false, error: 'Post not found' }, 404);
    } else {
      const comment = await db.prepare('SELECT id FROM community_comment WHERE id = ?').bind(targetId).first();
      if (!comment) return json({ ok: false, error: 'Comment not found' }, 404);
    }

    // Check for duplicate flag
    const existing = await db.prepare(
      'SELECT id, status FROM community_flag WHERE user_id = ? AND target_type = ? AND target_id = ?'
    ).bind(user.id, targetType, targetId).first();
    if (existing) {
      if (existing.status === 'pending') {
        return json({ ok: false, error: 'You have already flagged this content' }, 409);
      }
      await db.prepare(
        "UPDATE community_flag SET status = 'pending', reason = ?, note = ?, resolved_by = NULL, resolved_at = NULL WHERE id = ?"
      ).bind(reason, note?.trim() || null, existing.id).run();
      return json({ ok: true, flagId: existing.id }, 200);
    }

    const id = generateId();
    await db.prepare(`
      INSERT INTO community_flag (id, user_id, target_type, target_id, reason, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, user.id, targetType, targetId, reason, note?.trim() || null).run();

    // Send email notification to all mod+ users
    try {
      await notifyMods(env, db, user, targetType, targetId, reason, note);
    } catch (err) {
      log(env, waitUntil, 'community', 'flag_error', 'error', `notification: ${err.message}`, 0, 0);
    }

    return json({ ok: true, flagId: id }, 201);
  } catch (err) {
    log(env, waitUntil, 'community', 'flag_error', 'error', `POST: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!roleAtLeast(user.role, 'mod')) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status') || 'pending';
    const status = VALID_STATUSES.includes(statusParam) ? statusParam : 'pending';

    const db = env.DB;
    const rows = await db.prepare(`
      SELECT f.*, u.name as reporter_name, u.first_name as reporter_first_name, u.last_name as reporter_last_name
      FROM community_flag f
      JOIN user u ON u.id = f.user_id
      WHERE f.status = ?
      ORDER BY f.created_at DESC
      LIMIT 50
    `).bind(status).all();

    // Batch-fetch flagged content to avoid N+1 queries
    const postIds = rows.results.filter(f => f.target_type === 'post').map(f => f.target_id);
    const commentIds = rows.results.filter(f => f.target_type === 'comment').map(f => f.target_id);

    const postMap = {};
    const commentMap = {};

    if (postIds.length) {
      const ph = postIds.map(() => '?').join(',');
      const posts = await db.prepare(`
        SELECT p.id, p.title, p.body, p.content, p.author_id, u.name as author_name, u.first_name, u.last_name
        FROM community_post p
        JOIN user u ON u.id = p.author_id
        WHERE p.id IN (${ph})
      `).bind(...postIds).all();
      for (const p of posts.results) {
        const text = p.content || (p.title && p.body ? p.title + '\n\n' + p.body : p.title || p.body || '');
        postMap[p.id] = {
          preview: text.slice(0, 200),
          author: p.author_name || displayName(p),
        };
      }
    }

    if (commentIds.length) {
      const ph = commentIds.map(() => '?').join(',');
      const comments = await db.prepare(`
        SELECT c.id, c.content, c.author_id, u.name as author_name, u.first_name, u.last_name
        FROM community_comment c
        JOIN user u ON u.id = c.author_id
        WHERE c.id IN (${ph})
      `).bind(...commentIds).all();
      for (const c of comments.results) {
        commentMap[c.id] = {
          preview: c.content.slice(0, 200),
          author: c.author_name || displayName(c),
        };
      }
    }

    const flags = rows.results.map(f => {
      const lookup = f.target_type === 'post' ? postMap[f.target_id] : commentMap[f.target_id];
      return {
        id: f.id,
        reporterName: f.reporter_name || displayName({ first_name: f.reporter_first_name, last_name: f.reporter_last_name }),
        targetType: f.target_type,
        targetId: f.target_id,
        reason: f.reason,
        note: f.note,
        status: f.status,
        contentPreview: lookup?.preview || '',
        contentAuthor: lookup?.author || 'Unknown',
        createdAt: f.created_at,
      };
    });

    return json({ ok: true, flags });
  } catch (err) {
    log(env, waitUntil, 'community', 'flag_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPatch({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!canResolveFlag(user.role)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { flagId, status } = body;
    if (!flagId || typeof flagId !== 'string' || flagId.length > 100) return json({ ok: false, error: 'flagId required' }, 400);
    if (!status || !['resolved', 'dismissed'].includes(status)) {
      return json({ ok: false, error: 'status must be resolved or dismissed' }, 400);
    }

    const db = env.DB;
    const flag = await db.prepare('SELECT * FROM community_flag WHERE id = ?').bind(flagId).first();
    if (!flag) return json({ ok: false, error: 'Flag not found' }, 404);

    await db.prepare(
      "UPDATE community_flag SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?"
    ).bind(status, user.id, flagId).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'flag_error', 'error', `PATCH: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function notifyMods(env, db, reporter, targetType, targetId, reason, note) {
  const mods = await db.prepare(
    "SELECT email FROM user WHERE role IN ('mod', 'admin', 'superadmin') AND blocked = 0"
  ).all();

  if (!mods.results.length) return;

  let contentPreview = '';
  let postId = targetId;
  if (targetType === 'post') {
    const post = await db.prepare('SELECT title, body, content FROM community_post WHERE id = ?').bind(targetId).first();
    if (post) {
      const text = post.content || (post.title && post.body ? post.title + '\n\n' + post.body : post.title || post.body || '');
      contentPreview = text.slice(0, 200);
    }
  } else {
    const comment = await db.prepare('SELECT content, post_id FROM community_comment WHERE id = ?').bind(targetId).first();
    if (comment) {
      contentPreview = comment.content.slice(0, 200);
      postId = comment.post_id;
    }
  }

  const reporterName = displayName(reporter);
  const link = `${SITE_URL}/community/post/${postId}/`;

  const subject = `[STUC] Content flagged: ${reason}`;
  const safeReporter = escapeHtml(reporterName);
  const safeReason = escapeHtml(reason);
  const safeNote = escapeHtml(note);
  const safePreview = escapeHtml(contentPreview);
  const html = `
    <p><strong>${safeReporter}</strong> flagged a ${targetType} as <strong>${safeReason}</strong>.</p>
    ${safeNote ? `<p>Note: ${safeNote}</p>` : ''}
    <p>Content preview:<br><em>${safePreview || '(unable to load preview)'}</em></p>
    <p><a href="${link}">View in community</a></p>
  `;
  const text = `${reporterName} flagged a ${targetType} as ${reason}.\n${note ? `Note: ${note}\n` : ''}Content: ${contentPreview || '(unable to load)'}\nView: ${link}`;

  const emailPromises = mods.results.map(m =>
    sendEmail(env, { from: 'noreply@mail.rrmacademy.org', to: m.email, subject, html, text, log: { db, source: 'community/flag-notify', category: 'transactional' } })
      .catch(err => console.error(`Failed to email ${m.email}:`, err.message))
  );
  await Promise.all(emailPromises);
}
