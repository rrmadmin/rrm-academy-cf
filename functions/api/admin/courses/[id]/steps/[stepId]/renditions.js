/**
 * Admin CRUD for step renditions (spec 3.4).
 *   GET    /api/admin/courses/:id/steps/:stepId/renditions          list all formats (any status)
 *   PUT    /api/admin/courses/:id/steps/:stepId/renditions          upsert one format
 *   DELETE /api/admin/courses/:id/steps/:stepId/renditions?format=  delete one format
 *
 * PUT body: { format, content, status?, source? }. Upsert is idempotent
 * (ON CONFLICT(step_id, format) DO UPDATE) so generation re-runs are safe.
 * Guards: ownership chain, VALID_FORMATS/VALID_STATUSES, per-format shape +
 * size caps, content_empty, reading sanitization + word_count, and the
 * cert-quiz 409 refusal on DELETE / archive of a quiz rendition.
 */
import { json, optionsResponse } from '../../../../../auth/_shared.js';
import { log } from '../../../../../_log.js';
import { sanitizeHtml, computeWordCount } from '../../../../../courses/_sanitize.js';

const VALID_FORMATS = new Set(['reading', 'flashcards', 'quiz', 'audio']);
const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

// Per-format byte caps on serialized content (spec 3.2). Reading sits under
// D1's ~100KB single-statement limit with headroom.
const SIZE_CAPS = { reading: 80000, flashcards: 32000, quiz: 32000, audio: 1000 };

export function onRequestOptions() {
  return optionsResponse();
}

function requireAdmin(context) {
  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }
  return null;
}

function validateParams(context) {
  const courseId = context.params?.id;
  const stepId = context.params?.stepId;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) return null;
  if (!stepId || typeof stepId !== 'string' || stepId.length > 100) return null;
  return { courseId, stepId };
}

async function stepInCourse(db, stepId, courseId) {
  return db.prepare(
    'SELECT id FROM course_step WHERE id = ? AND course_id = ?'
  ).bind(stepId, courseId).first();
}

async function certQuizRef(db, stepId) {
  return db.prepare(
    'SELECT id FROM course WHERE certificate_quiz_step_id = ?'
  ).bind(stepId).first();
}

function mapRendition(r) {
  let content = null;
  try { content = JSON.parse(r.content_json); } catch { /* malformed stored JSON, omit */ }
  const out = {
    stepId: r.step_id,
    format: r.format,
    status: r.status,
    content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.source != null) out.source = r.source;
  if (r.word_count != null) out.wordCount = r.word_count;
  if (r.duration_seconds != null) out.duration = r.duration_seconds;
  return out;
}

/**
 * Validate + normalize content for a format.
 * Returns { error } on rejection, or { content, wordCount, durationSeconds }.
 */
function validateContent(format, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { error: 'invalid_content' };
  }
  if (format === 'reading') {
    if (typeof content.html !== 'string' || !content.html.trim()) return { error: 'content_empty' };
    const html = sanitizeHtml(content.html);
    if (!html.trim()) return { error: 'content_empty' };
    return { content: { html }, wordCount: computeWordCount(html), durationSeconds: null };
  }
  if (format === 'flashcards') {
    if (!Array.isArray(content.cards)) return { error: 'invalid_content' };
    if (content.cards.length === 0) return { error: 'content_empty' };
    for (const card of content.cards) {
      if (!card || typeof card !== 'object') return { error: 'invalid_content' };
      if (typeof card.front !== 'string' || !card.front.trim() || card.front.length > 2000) return { error: 'invalid_content' };
      if (typeof card.back !== 'string' || !card.back.trim() || card.back.length > 4000) return { error: 'invalid_content' };
      if (card.source_claim_id !== undefined && (typeof card.source_claim_id !== 'string' || card.source_claim_id.length > 100)) return { error: 'invalid_content' };
    }
    return { content: { cards: content.cards }, wordCount: null, durationSeconds: null };
  }
  if (format === 'quiz') {
    if (!['quiz', 'questionnaire'].includes(content.type)) return { error: 'invalid_content' };
    if (!Array.isArray(content.questions)) return { error: 'invalid_content' };
    if (content.questions.length === 0) return { error: 'content_empty' };
    if (content.passingScore != null && (!Number.isInteger(content.passingScore) || content.passingScore < 0 || content.passingScore > 100)) {
      return { error: 'invalid_content' };
    }
    for (const q of content.questions) {
      if (!q || typeof q !== 'object') return { error: 'invalid_content' };
      if (typeof q.id !== 'string' || !q.id || typeof q.text !== 'string' || !q.text) return { error: 'invalid_content' };
      if (content.type === 'quiz') {
        if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every((o) => typeof o === 'string')) return { error: 'invalid_content' };
        if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) return { error: 'invalid_content' };
      } else {
        if (!['likert', 'freetext', 'multiselect'].includes(q.type)) return { error: 'invalid_content' };
        if (q.type === 'multiselect' && (!Array.isArray(q.options) || q.options.length === 0)) return { error: 'invalid_content' };
      }
    }
    return { content, wordCount: null, durationSeconds: null };
  }
  // audio: metadata only.
  if (typeof content.r2_key !== 'string' || !/^courses\/audio\/[a-z0-9][a-z0-9-]*\.mp3$/.test(content.r2_key)) return { error: 'invalid_content' };
  if (content.voice !== undefined && (typeof content.voice !== 'string' || content.voice.length > 100)) return { error: 'invalid_content' };
  if (content.duration_seconds !== undefined && (!Number.isInteger(content.duration_seconds) || content.duration_seconds < 0 || content.duration_seconds > 86400)) return { error: 'invalid_content' };
  return { content, wordCount: null, durationSeconds: content.duration_seconds ?? null };
}

export async function onRequestGet(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { env, waitUntil } = context;
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 503);
  const params = validateParams(context);
  if (!params) return json({ ok: false, error: 'invalid_id' }, 400);
  try {
    const step = await stepInCourse(env.DB, params.stepId, params.courseId);
    if (!step) return json({ ok: false, error: 'step_not_found' }, 404);
    const { results } = await env.DB.prepare(
      'SELECT * FROM step_rendition WHERE step_id = ? ORDER BY format ASC'
    ).bind(params.stepId).all();
    return json({ ok: true, data: (results || []).map(mapRendition) });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'rendition_list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPut(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { request, env, waitUntil } = context;
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 503);
  const params = validateParams(context);
  if (!params) return json({ ok: false, error: 'invalid_id' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { format, content, status, source } = body;
  if (!VALID_FORMATS.has(format)) return json({ ok: false, error: 'invalid_format' }, 400);
  if (status !== undefined && !VALID_STATUSES.has(status)) return json({ ok: false, error: 'invalid_status' }, 400);
  if (source !== undefined && source !== null && (typeof source !== 'string' || source.length > 200)) {
    return json({ ok: false, error: 'invalid_source' }, 400);
  }

  const validated = validateContent(format, content);
  if (validated.error) return json({ ok: false, error: validated.error }, 400);

  const serialized = JSON.stringify(validated.content);
  if (serialized.length > SIZE_CAPS[format]) {
    return json({ ok: false, error: 'content_too_large' }, 400);
  }

  try {
    const step = await stepInCourse(env.DB, params.stepId, params.courseId);
    if (!step) return json({ ok: false, error: 'step_not_found' }, 404);

    // Cert-quiz protection: archiving / drafting the quiz rendition of a
    // cert-quiz step removes the content certificates depend on (spec 3.4).
    if (format === 'quiz' && (status === 'draft' || status === 'archived')) {
      const certRef = await certQuizRef(env.DB, params.stepId);
      if (certRef) {
        return json({ ok: false, error: 'step_referenced_as_certificate_quiz', courseId: certRef.id }, 409);
      }
    }

    await env.DB.prepare(`
      INSERT INTO step_rendition (step_id, format, content_json, status, source, word_count, duration_seconds, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))
      ON CONFLICT(step_id, format) DO UPDATE SET
        content_json = ?3,
        status = COALESCE(?8, step_rendition.status),
        source = COALESCE(?5, step_rendition.source),
        word_count = ?6,
        duration_seconds = ?7,
        updated_at = datetime('now')
    `).bind(
      params.stepId, format, serialized, status ?? 'draft', source ?? null,
      validated.wordCount, validated.durationSeconds, status ?? null,
    ).run();

    const row = await env.DB.prepare(
      'SELECT * FROM step_rendition WHERE step_id = ? AND format = ?'
    ).bind(params.stepId, format).first();
    return json({ ok: true, data: row ? mapRendition(row) : null });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'rendition_put_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const { request, env, waitUntil } = context;
  if (!env.DB) return json({ ok: false, error: 'Server misconfigured' }, 503);
  const params = validateParams(context);
  if (!params) return json({ ok: false, error: 'invalid_id' }, 400);

  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  if (!VALID_FORMATS.has(format)) return json({ ok: false, error: 'invalid_format' }, 400);

  try {
    const step = await stepInCourse(env.DB, params.stepId, params.courseId);
    if (!step) return json({ ok: false, error: 'step_not_found' }, 404);

    if (format === 'quiz') {
      const certRef = await certQuizRef(env.DB, params.stepId);
      if (certRef) {
        return json({ ok: false, error: 'step_referenced_as_certificate_quiz', courseId: certRef.id }, 409);
      }
    }

    // For audio, capture the R2 key before the row goes (spec 3.4 / R4).
    let r2Key = null;
    if (format === 'audio') {
      const row = await env.DB.prepare(
        'SELECT * FROM step_rendition WHERE step_id = ? AND format = ?'
      ).bind(params.stepId, format).first();
      if (row?.content_json) {
        try { r2Key = JSON.parse(row.content_json).r2_key ?? null; } catch { r2Key = null; }
      }
    }

    const result = await env.DB.prepare(
      'DELETE FROM step_rendition WHERE step_id = ? AND format = ?'
    ).bind(params.stepId, format).run();
    if (result.meta?.changes === 0) return json({ ok: false, error: 'rendition_not_found' }, 404);

    if (r2Key && env.R2_ASSETS) {
      try {
        await env.R2_ASSETS.delete(r2Key);
      } catch (err) {
        log(env, waitUntil, 'admin-courses', 'rendition_r2_delete_error', 'error', `${r2Key}: ${err.message}`, 0, 500);
      }
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'rendition_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
