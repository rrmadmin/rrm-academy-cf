/**
 * Shared runtime gate for published step renditions (spec 3.3). Prefixed with _
 * so CF Pages never treats it as a route handler.
 *
 * Owns the trust anchor (3.3.1), the gate matrix (3.3.2) and the step-lock for
 * BOTH runtime read paths -- the JSON rendition endpoint and the gated audio
 * byte stream -- so the two can never drift: the owning course is resolved from
 * course_step.course_id via a live D1 JOIN, content is released only when
 * rendition + step + course are all status='published', and a caller-supplied
 * courseId is never trusted.
 *
 * Returns { row, courseId } on pass, or { denied: Response } carrying the
 * caller-ready refusal. Draft / archived / missing collapse into one
 * indistinguishable 404 rendition_not_available (3.3.3).
 */
import { json, generateId } from '../auth/_shared.js';
import { requireMember } from '../community/_shared.js';

export async function resolvePublishedRendition({ request, env, session, stepId, format }) {
  const db = env.DB;

  // Trust-anchor JOIN (spec 3.3.1). Statuses checked in JS so draft /
  // archived / missing are indistinguishable in the response.
  const row = await db.prepare(`
      SELECT r.content_json, r.status AS rendition_status, r.word_count,
             s.course_id, s.status AS step_status,
             c.status AS course_status, c.access_type, c.is_free, c.settings_json
      FROM step_rendition r
      JOIN course_step s ON s.id = r.step_id
      JOIN course c ON c.id = s.course_id
      WHERE r.step_id = ?1 AND r.format = ?2
    `).bind(stepId, format).first();

  if (
    !row ||
    row.rendition_status !== 'published' ||
    row.step_status !== 'published' ||
    row.course_status !== 'published'
  ) {
    return { denied: json({ ok: false, error: 'rendition_not_available' }, 404) };
  }

  const courseId = row.course_id;

  if (row.access_type === 'members') {
    // Live membership re-check; membership IS the grant (mirrors stream/token.js).
    const memberResult = await requireMember(request, env);
    if (memberResult instanceof Response) return { denied: memberResult };
  } else if (!Number(row.is_free)) {
    // Paid course: active enrollment in the RESOLVED course required.
    if (session.role === 'superadmin') {
      await db.prepare(
        'INSERT INTO enrollment (id, user_id, course_id) VALUES (?, ?, ?)' +
        ' ON CONFLICT(user_id, course_id) DO UPDATE SET revoked_at = NULL'
      ).bind(generateId(), session.userId, courseId).run();
    }
    const enrollment = await db.prepare(
      'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ? AND revoked_at IS NULL'
    ).bind(session.userId, courseId).first();
    if (!enrollment) return { denied: json({ ok: false, error: 'Not enrolled' }, 403) };
  }
  // Free course: session is enough (stream/token.js all-free precedent,
  // intentional divergence from quiz.js documented in spec 3.3.2).

  // Step-lock from LIVE D1 ordering (published steps only).
  let settings = null;
  if (row.settings_json) {
    try { settings = JSON.parse(row.settings_json); } catch { settings = null; }
  }
  if (settings?.stepOrder === 'fixed') {
    const { results: ordered } = await db.prepare(`
        SELECT s.id FROM course_step s
        JOIN course_section sec ON sec.id = s.section_id
        WHERE s.course_id = ? AND s.status = 'published'
        ORDER BY sec.sort_order ASC, s.sort_order ASC
      `).bind(courseId).all();
    const ids = (ordered || []).map((r) => r.id);
    const idx = ids.indexOf(stepId);
    if (idx > 0) {
      const prevStepId = ids[idx - 1];
      const prev = await db.prepare(
        'SELECT completed FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?'
      ).bind(session.userId, courseId, prevStepId).first();
      if (!prev?.completed) {
        return { denied: json({ ok: false, error: 'Previous step not completed' }, 403) };
      }
    }
  }

  return { row, courseId };
}
