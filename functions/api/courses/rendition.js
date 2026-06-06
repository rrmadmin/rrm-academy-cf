/**
 * GET /api/courses/rendition?stepId=&format=
 *
 * Runtime read path for step renditions (spec 3.3). Trust anchor (3.3.1):
 * the owning course is resolved from course_step.course_id via a live D1
 * JOIN; content is served ONLY when rendition + step + course are all
 * status='published'. Never trusts a caller-supplied courseId.
 *
 * Gate matrix (3.3.2): members -> requireMember(); paid -> active enrollment
 * in the resolved course; free -> session only. Affiliate/unknown stepIds
 * have no D1 row -> the indistinguishable 404.
 *
 * Error taxonomy (3.3.3): draft/archived/missing -> identical
 * 404 rendition_not_available; bad format -> 400 invalid_format;
 * content_json parse failure -> 500 server_error (logged internally).
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, generateId,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember } from '../community/_shared.js';

const VALID_FORMATS = new Set(['reading', 'flashcards', 'quiz', 'audio']);

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const stepId = url.searchParams.get('stepId');
    const format = url.searchParams.get('format');
    if (!stepId || typeof stepId !== 'string' || stepId.length > 100) {
      return json({ ok: false, error: 'invalid_step' }, 400);
    }
    if (!format || !VALID_FORMATS.has(format)) {
      return json({ ok: false, error: 'invalid_format' }, 400);
    }

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
      return json({ ok: false, error: 'rendition_not_available' }, 404);
    }

    const courseId = row.course_id;

    if (row.access_type === 'members') {
      // Live membership re-check; membership IS the grant (mirrors stream/token.js).
      const memberResult = await requireMember(request, env);
      if (memberResult instanceof Response) return memberResult;
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
      if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);
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
          return json({ ok: false, error: 'Previous step not completed' }, 403);
        }
      }
    }

    let content;
    try {
      content = JSON.parse(row.content_json);
    } catch (err) {
      log(env, waitUntil, 'courses', 'rendition_parse_error', 'error', `${stepId}/${format}: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'server_error' }, 500);
    }

    if (format === 'reading') {
      return json({ ok: true, format, html: content.html, wordCount: row.word_count ?? null });
    }
    if (format === 'flashcards') {
      return json({ ok: true, format, cards: content.cards });
    }
    if (format === 'quiz') {
      const safeQuestions = (content.questions || []).map((q) => {
        if (content.type === 'quiz') {
          const { correctIndex: _correctIndex, ...rest } = q;
          return rest;
        }
        return q;
      });
      return json({
        ok: true,
        format,
        quiz: {
          type: content.type,
          title: content.title,
          description: content.description,
          passingScore: content.passingScore,
          questions: safeQuestions,
        },
      });
    }
    // audio: metadata only, never r2_key (binary path is Phase 4).
    return json({ ok: true, format, duration: content.duration_seconds ?? null, voice: content.voice ?? null });
  } catch (err) {
    log(env, waitUntil, 'courses', 'rendition_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
