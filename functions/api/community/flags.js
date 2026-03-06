/**
 * POST   /api/community/flags   -- create a flag (any member)
 * GET    /api/community/flags   -- list pending flags (mod+ only)
 * PATCH  /api/community/flags   -- resolve/dismiss a flag (admin+ only)
 */
import { json, optionsResponse, generateId, SITE_URL } from '../auth/_shared.js';
import { requireMember, roleAtLeast, canResolveFlag, displayName } from './_shared.js';
import { sendEmail } from '../_ses.js';

const VALID_REASONS = ['inappropriate', 'spam', 'harassment', 'other'];

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

    const { targetType, targetId, reason, note } = body;

    if (!targetType || !['post', 'comment'].includes(targetType)) {
      return json({ ok: false, error: 'Invalid targetType' }, 400);
    }
    if (!targetId) return json({ ok: false, error: 'targetId required' }, 400);
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
      'SELECT id FROM community_flag WHERE user_id = ? AND target_type = ? AND target_id = ?'
    ).bind(user.id, targetType, targetId).first();
    if (existing) {
      return json({ ok: false, error: 'You have already flagged this content' }, 409);
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
      console.error('Failed to send flag notification email:', err.message);
    }

    return json({ ok: true, flagId: id }, 201);
  } catch (err) {
    console.error('community flags POST error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!roleAtLeast(user.role, 'mod')) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';

    const db = env.DB;
    const rows = await db.prepare(`
      SELECT f.*, u.name as reporter_name, u.first_name as reporter_first_name, u.last_name as reporter_last_name
      FROM community_flag f
      JOIN user u ON u.id = f.user_id
      WHERE f.status = ?
      ORDER BY f.created_at DESC
      LIMIT 50
    `).bind(status).all();

    const flags = [];
    for (const f of rows.results) {
      let contentPreview = '';
      let contentAuthor = '';
      if (f.target_type === 'post') {
        const post = await db.prepare('SELECT title, body, author_id FROM community_post WHERE id = ?').bind(f.target_id).first();
        if (post) {
          contentPreview = post.title + (post.body ? ': ' + post.body.slice(0, 100) : '');
          const author = await db.prepare('SELECT name, first_name, last_name FROM user WHERE id = ?').bind(post.author_id).first();
          contentAuthor = author ? (author.name || displayName(author)) : 'Unknown';
        }
      } else {
        const comment = await db.prepare('SELECT content, author_id FROM community_comment WHERE id = ?').bind(f.target_id).first();
        if (comment) {
          contentPreview = comment.content.slice(0, 200);
          const author = await db.prepare('SELECT name, first_name, last_name FROM user WHERE id = ?').bind(comment.author_id).first();
          contentAuthor = author ? (author.name || displayName(author)) : 'Unknown';
        }
      }

      flags.push({
        id: f.id,
        reporterName: f.reporter_name || displayName({ first_name: f.reporter_first_name, last_name: f.reporter_last_name }),
        targetType: f.target_type,
        targetId: f.target_id,
        reason: f.reason,
        note: f.note,
        status: f.status,
        contentPreview,
        contentAuthor,
        createdAt: f.created_at,
      });
    }

    return json({ ok: true, flags });
  } catch (err) {
    console.error('community flags GET error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
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

    const { flagId, status } = body;
    if (!flagId) return json({ ok: false, error: 'flagId required' }, 400);
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
    console.error('community flags PATCH error:', err.message, err.stack);
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
    const post = await db.prepare('SELECT title, body FROM community_post WHERE id = ?').bind(targetId).first();
    if (post) contentPreview = post.title + (post.body ? ': ' + post.body.slice(0, 100) : '');
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
  const html = `
    <p><strong>${reporterName}</strong> flagged a ${targetType} as <strong>${reason}</strong>.</p>
    ${note ? `<p>Note: ${note}</p>` : ''}
    <p>Content preview:<br><em>${contentPreview || '(unable to load preview)'}</em></p>
    <p><a href="${link}">View in community</a></p>
  `;
  const text = `${reporterName} flagged a ${targetType} as ${reason}.\n${note ? `Note: ${note}\n` : ''}Content: ${contentPreview || '(unable to load)'}\nView: ${link}`;

  await sendEmail(env, {
    from: 'noreply@rrmacademy.org',
    to: mods.results.map(m => m.email),
    subject,
    html,
    text,
  });
}
