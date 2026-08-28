/**
 * GET /api/courses/rendition?stepId=&format=
 *
 * Runtime read path for step renditions (spec 3.3). Trust anchor (3.3.1),
 * gate matrix (3.3.2) and step-lock live in _rendition-access.js, shared
 * verbatim with the audio byte path (audio.js) so the two cannot drift:
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
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { resolvePublishedRendition } from './_rendition-access.js';

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

    const gate = await resolvePublishedRendition({ request, env, session, stepId, format });
    if (gate.denied) return gate.denied;
    const row = gate.row;

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
