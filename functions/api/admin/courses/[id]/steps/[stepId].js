import { json, optionsResponse } from '../../../../auth/_shared.js';
import { log } from '../../../../_log.js';

const VALID_STATUSES = new Set(['draft', 'published', 'archived']);
const VALID_TYPES = new Set(['video', 'article', 'quiz']);

export function onRequestOptions() {
  return optionsResponse();
}

function mapStep(s) {
  const step = {
    id: s.id,
    courseId: s.course_id,
    sectionId: s.section_id,
    title: s.title,
    type: s.type,
    sortOrder: s.sort_order,
    status: s.status,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
  if (s.stream_uid != null) step.streamUid = s.stream_uid;
  if (s.duration_seconds != null) step.duration = s.duration_seconds;
  if (s.attachments_json != null) {
    try {
      const parsed = JSON.parse(s.attachments_json);
      if (Array.isArray(parsed) && parsed.length > 0) step.attachments = parsed;
    } catch {
      // malformed JSON stored — omit
    }
  }
  return step;
}

function validateAttachments(attachments) {
  if (!Array.isArray(attachments)) return false;
  for (const a of attachments) {
    if (!a || typeof a !== 'object') return false;
    if (typeof a.name !== 'string' || typeof a.url !== 'string') return false;
  }
  return true;
}

export async function onRequestGet(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const courseId = context.params?.id;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  const stepId = context.params?.stepId;
  if (!stepId || typeof stepId !== 'string' || stepId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  try {
    const row = await env.DB.prepare(
      'SELECT * FROM course_step WHERE id = ? AND course_id = ?'
    ).bind(stepId, courseId).first();
    if (!row) return json({ ok: false, error: 'step_not_found' }, 404);
    return json({ ok: true, data: mapStep(row) });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'step_get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const courseId = context.params?.id;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  const stepId = context.params?.stepId;
  if (!stepId || typeof stepId !== 'string' || stepId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  if (body.id !== undefined) {
    return json({ ok: false, error: 'cannot_change_id' }, 400);
  }
  if (body.course_id !== undefined || body.courseId !== undefined) {
    return json({ ok: false, error: 'cannot_change_course_id' }, 400);
  }
  if (body.section_id !== undefined || body.sectionId !== undefined) {
    return json({ ok: false, error: 'cannot_change_section_id' }, 400);
  }

  const { title, type, streamUid, duration, attachments, status } = body;

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return json({ ok: false, error: 'invalid_title' }, 400);
    }
    if (title.length > 200) {
      return json({ ok: false, error: 'invalid_title' }, 400);
    }
  }

  if (type !== undefined && !VALID_TYPES.has(type)) {
    return json({ ok: false, error: 'invalid_type' }, 400);
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      return json({ ok: false, error: 'invalid_status' }, 400);
    }
  }

  if (duration !== undefined && duration !== null) {
    if (!Number.isInteger(duration) || duration < 0 || duration > 86400) {
      return json({ ok: false, error: 'invalid_duration' }, 400);
    }
  }

  if (attachments !== undefined && attachments !== null) {
    if (!validateAttachments(attachments)) {
      return json({ ok: false, error: 'invalid_attachments' }, 400);
    }
  }

  try {
    const existing = await env.DB.prepare(
      'SELECT * FROM course_step WHERE id = ? AND course_id = ?'
    ).bind(stepId, courseId).first();
    if (!existing) {
      return json({ ok: false, error: 'step_not_found' }, 404);
    }

    const resolvedType = type !== undefined ? type : existing.type;

    if (resolvedType === 'video') {
      const resolvedStreamUid = streamUid !== undefined ? streamUid : existing.stream_uid;
      if (!resolvedStreamUid || typeof resolvedStreamUid !== 'string' || !resolvedStreamUid.trim()) {
        return json({ ok: false, error: 'stream_uid_required_for_video' }, 400);
      }
      if (resolvedStreamUid.length > 64) {
        return json({ ok: false, error: 'stream_uid_required_for_video' }, 400);
      }
    } else {
      if (streamUid != null) {
        return json({ ok: false, error: 'stream_uid_only_for_video' }, 400);
      }
    }

    if (status !== undefined && (status === 'draft' || status === 'archived')) {
      const certRef = await env.DB.prepare(
        'SELECT id FROM course WHERE certificate_quiz_step_id = ?'
      ).bind(stepId).first();
      if (certRef) {
        return json({
          ok: false,
          error: 'step_referenced_as_certificate_quiz',
          courseId: certRef.id,
        }, 409);
      }
    }

    const setClauses = [];
    const bindings = [];

    if (title !== undefined) {
      setClauses.push('title = ?');
      bindings.push(title.trim());
    }

    if (type !== undefined) {
      setClauses.push('type = ?');
      bindings.push(type);
      if (type === 'video') {
        const finalUid = (streamUid !== undefined && streamUid !== null) ? streamUid.trim() : existing.stream_uid;
        setClauses.push('stream_uid = ?');
        bindings.push(finalUid);
      } else {
        setClauses.push('stream_uid = ?');
        bindings.push(null);
      }
    } else if (streamUid !== undefined) {
      setClauses.push('stream_uid = ?');
      bindings.push(streamUid !== null ? streamUid.trim() : null);
    }

    if (duration !== undefined) {
      setClauses.push('duration_seconds = ?');
      bindings.push(duration !== null ? duration : null);
    }

    if (attachments !== undefined) {
      setClauses.push('attachments_json = ?');
      bindings.push(attachments !== null ? JSON.stringify(attachments) : null);
    }

    if (status !== undefined) {
      setClauses.push('status = ?');
      bindings.push(status);
    }

    if (setClauses.length === 0) {
      const row = await env.DB.prepare(
        'SELECT * FROM course_step WHERE id = ?'
      ).bind(stepId).first();
      return json({ ok: true, data: mapStep(row) });
    }

    setClauses.push("updated_at = datetime('now')");
    bindings.push(stepId);

    await env.DB.prepare(
      `UPDATE course_step SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();

    const row = await env.DB.prepare(
      'SELECT * FROM course_step WHERE id = ?'
    ).bind(stepId).first();

    return json({ ok: true, data: mapStep(row) });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'step_update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (!['superadmin', 'admin'].includes(user.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const courseId = context.params?.id;
  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  const stepId = context.params?.stepId;
  if (!stepId || typeof stepId !== 'string' || stepId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM course_step WHERE id = ? AND course_id = ?'
    ).bind(stepId, courseId).first();
    if (!existing) {
      return json({ ok: false, error: 'step_not_found' }, 404);
    }

    const certRef = await env.DB.prepare(
      'SELECT id FROM course WHERE certificate_quiz_step_id = ?'
    ).bind(stepId).first();
    if (certRef) {
      return json({
        ok: false,
        error: 'step_referenced_as_certificate_quiz',
        courseId: certRef.id,
      }, 409);
    }

    const [progressRow, quizRow, commentRow] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS cnt FROM step_progress WHERE step_id = ?').bind(stepId).first(),
      env.DB.prepare('SELECT COUNT(*) AS cnt FROM quiz_response WHERE step_id = ?').bind(stepId).first(),
      env.DB.prepare('SELECT COUNT(*) AS cnt FROM lesson_comment WHERE step_id = ?').bind(stepId).first(),
    ]);

    const progressCount = progressRow?.cnt ?? 0;
    const quizCount = quizRow?.cnt ?? 0;
    const commentCount = commentRow?.cnt ?? 0;

    if (progressCount > 0 || quizCount > 0 || commentCount > 0) {
      const tables = [];
      const counts = {};
      if (progressCount > 0) { tables.push('step_progress'); counts.step_progress = progressCount; }
      if (quizCount > 0) { tables.push('quiz_response'); counts.quiz_response = quizCount; }
      if (commentCount > 0) { tables.push('lesson_comment'); counts.lesson_comment = commentCount; }
      return json({ ok: false, error: 'references_exist', tables, counts }, 409);
    }

    await env.DB.prepare('DELETE FROM course_step WHERE id = ?').bind(stepId).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'step_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
