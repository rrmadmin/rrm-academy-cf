/**
 * GET    /api/courses/comments?courseId=&stepId=  — list comments for a lesson
 * POST   /api/courses/comments                    — create a comment (enrolled users only)
 * PATCH  /api/courses/comments                    — edit own comment (author only)
 * DELETE /api/courses/comments                    — delete own comment (admin/superadmin may delete any)
 *
 * Comments support one level of threading via parent_id.
 * All endpoints require authentication.
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, generateId, roleAtLeast,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { isValidStep, getCourse } from './_shared.js';
import { requireMember } from '../community/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET: list comments for a step ---

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const courseId = url.searchParams.get('courseId');
    const stepId = url.searchParams.get('stepId');
    if (!courseId || !stepId) {
      return json({ ok: false, error: 'courseId and stepId required' }, 400);
    }
    if (!isValidStep(courseId, stepId)) {
      return json({ ok: false, error: 'Invalid step' }, 400);
    }

    // Verify enrolled
    const enrollment = await db.prepare(
      'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
    ).bind(session.userId, courseId).first();
    if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

    // Fetch all comments for this step, joined with user name
    const rows = await db.prepare(`
      SELECT c.id, c.user_id, c.content, c.parent_id, c.created_at, c.updated_at,
             u.name as user_name, u.first_name, u.last_name
      FROM lesson_comment c
      LEFT JOIN user u ON u.id = c.user_id
      WHERE c.course_id = ? AND c.step_id = ?
      ORDER BY c.created_at ASC
      LIMIT 200
    `).bind(courseId, stepId).all();

    // Build threaded structure: top-level comments with nested replies
    const topLevel = [];
    const repliesMap = new Map();

    for (const row of rows.results) {
      const comment = {
        id: row.id,
        userId: row.user_id,
        content: row.content,
        parentId: row.parent_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        userName: row.user_name || displayName(row.first_name, row.last_name) || 'Student',
        isOwn: row.user_id === session.userId,
      };

      if (!row.parent_id) {
        comment.replies = [];
        topLevel.push(comment);
      } else {
        if (!repliesMap.has(row.parent_id)) repliesMap.set(row.parent_id, []);
        repliesMap.get(row.parent_id).push(comment);
      }
    }

    // Attach replies to their parents
    for (const comment of topLevel) {
      comment.replies = repliesMap.get(comment.id) || [];
    }

    return json({ ok: true, comments: topLevel, count: rows.results.length });
  } catch (err) {
    log(env, waitUntil, 'courses', 'course_comment_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST: create a comment ---

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { courseId, stepId, content, parentId } = body;
    if (!courseId || !stepId) {
      return json({ ok: false, error: 'courseId and stepId required' }, 400);
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return json({ ok: false, error: 'content required' }, 400);
    }
    if (content.length > 2000) {
      return json({ ok: false, error: 'Comment too long (max 2000 chars)' }, 400);
    }
    if (!isValidStep(courseId, stepId)) {
      return json({ ok: false, error: 'Invalid step' }, 400);
    }

    // Verify enrolled
    const enrollment = await db.prepare(
      'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
    ).bind(session.userId, courseId).first();
    if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

    // Members-only courses: re-verify active membership before allowing writes
    const commentCourse = getCourse(courseId);
    if (commentCourse?.accessType === 'members') {
      const memberResult = await requireMember(request, env);
      if (memberResult instanceof Response) return memberResult;
    }

    // If replying, verify parent comment exists and belongs to this step
    if (parentId) {
      const parent = await db.prepare(
        'SELECT id FROM lesson_comment WHERE id = ? AND course_id = ? AND step_id = ? AND parent_id IS NULL'
      ).bind(parentId, courseId, stepId).first();
      if (!parent) return json({ ok: false, error: 'Parent comment not found' }, 400);
    }

    const id = generateId();
    const sanitizedContent = content.trim();

    await db.prepare(`
      INSERT INTO lesson_comment (id, user_id, course_id, step_id, content, parent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, session.userId, courseId, stepId, sanitizedContent, parentId || null).run();

    // Fetch the user's display name for the response
    const user = await db.prepare('SELECT name, first_name, last_name FROM user WHERE id = ?')
      .bind(session.userId).first();

    return json({
      ok: true,
      comment: {
        id,
        userId: session.userId,
        content: sanitizedContent,
        parentId: parentId || null,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        userName: user?.name || displayName(user?.first_name, user?.last_name) || 'Student',
        isOwn: true,
        replies: [],
      },
    }, 201);
  } catch (err) {
    log(env, waitUntil, 'courses', 'course_comment_error', 'error', `POST: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- PATCH: edit own comment ---

export async function onRequestPatch({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { commentId, content } = body;
    if (!commentId || typeof commentId !== 'string' || commentId.length > 100) {
      return json({ ok: false, error: 'commentId required' }, 400);
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return json({ ok: false, error: 'content required' }, 400);
    }
    if (content.length > 2000) {
      return json({ ok: false, error: 'Comment too long (max 2000 chars)' }, 400);
    }

    const comment = await db.prepare(
      'SELECT id, user_id, course_id FROM lesson_comment WHERE id = ?'
    ).bind(commentId).first();
    if (!comment) return json({ ok: false, error: 'Comment not found' }, 404);

    // Author-only edit (mirrors community/comments.js PATCH: admins may delete, not edit)
    if (comment.user_id !== session.userId) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    // Same gate as GET/POST: active enrollment (+ membership for members-only courses)
    const enrollment = await db.prepare(
      'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
    ).bind(session.userId, comment.course_id).first();
    if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

    const patchCourse = getCourse(comment.course_id);
    if (patchCourse?.accessType === 'members') {
      const memberResult = await requireMember(request, env);
      if (memberResult instanceof Response) return memberResult;
    }

    const result = await db.prepare(
      "UPDATE lesson_comment SET content = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
    ).bind(content.trim(), commentId, session.userId).run();
    if (result.meta?.changes === 0) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'courses', 'course_comment_error', 'error', `PATCH: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- DELETE: remove a comment (author, or admin/superadmin for any) ---

export async function onRequestDelete({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { commentId } = body;
    if (!commentId || typeof commentId !== 'string' || commentId.length > 100) {
      return json({ ok: false, error: 'commentId required' }, 400);
    }

    const comment = await db.prepare(
      'SELECT id, user_id, course_id FROM lesson_comment WHERE id = ?'
    ).bind(commentId).first();
    if (!comment) return json({ ok: false, error: 'Comment not found' }, 404);

    // Admins/superadmins may moderate any comment without an enrollment row
    // (mirrors community/comments.js canDeleteComment). Everyone else: own
    // comments only, gated exactly like GET/POST.
    const isStaff = roleAtLeast(session.role, 'admin');
    if (!isStaff) {
      if (comment.user_id !== session.userId) {
        return json({ ok: false, error: 'Not authorized' }, 403);
      }
      const enrollment = await db.prepare(
        'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
      ).bind(session.userId, comment.course_id).first();
      if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

      const deleteCourse = getCourse(comment.course_id);
      if (deleteCourse?.accessType === 'members') {
        const memberResult = await requireMember(request, env);
        if (memberResult instanceof Response) return memberResult;
      }
    }

    // Delete replies + the comment atomically. ON DELETE CASCADE is inert in
    // D1, so child cleanup is explicit. Threading is one level deep (POST only
    // allows replying to top-level comments), so parent_id = ? covers all
    // descendants.
    await db.batch([
      db.prepare('DELETE FROM lesson_comment WHERE parent_id = ?').bind(commentId),
      db.prepare('DELETE FROM lesson_comment WHERE id = ?').bind(commentId),
    ]);

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'courses', 'course_comment_error', 'error', `DELETE: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

function displayName(first, last) {
  if (first && last) return `${first} ${last.charAt(0)}.`;
  if (first) return first;
  if (last) return last;
  return null;
}
