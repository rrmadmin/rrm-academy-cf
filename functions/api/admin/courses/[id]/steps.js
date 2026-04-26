import { json, optionsResponse } from '../../../auth/_shared.js';
import { log } from '../../../_log.js';

const VALID_STATUSES = new Set(['draft', 'published', 'archived']);
const VALID_TYPES = new Set(['video', 'article', 'quiz']);
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

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

export async function onRequestPost(context) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { id, sectionId, title, type, streamUid, duration, attachments, status } = body;

  if (typeof id !== 'string' || !id.trim()) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (id.length > 80) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (!ID_PATTERN.test(id)) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  if (typeof sectionId !== 'string' || !sectionId.trim()) {
    return json({ ok: false, error: 'invalid_section_id' }, 400);
  }
  if (sectionId.length > 100) {
    return json({ ok: false, error: 'invalid_section_id' }, 400);
  }

  if (typeof title !== 'string' || !title.trim()) {
    return json({ ok: false, error: 'invalid_title' }, 400);
  }
  if (title.length > 200) {
    return json({ ok: false, error: 'invalid_title' }, 400);
  }

  if (!VALID_TYPES.has(type)) {
    return json({ ok: false, error: 'invalid_type' }, 400);
  }

  if (type === 'video') {
    if (!streamUid || typeof streamUid !== 'string' || !streamUid.trim()) {
      return json({ ok: false, error: 'stream_uid_required_for_video' }, 400);
    }
    if (streamUid.length > 64) {
      return json({ ok: false, error: 'stream_uid_required_for_video' }, 400);
    }
  } else {
    if (streamUid != null) {
      return json({ ok: false, error: 'stream_uid_only_for_video' }, 400);
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

  const resolvedStatus = status ?? 'published';
  if (!VALID_STATUSES.has(resolvedStatus)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  try {
    const course = await env.DB.prepare(
      'SELECT id FROM course WHERE id = ?'
    ).bind(courseId).first();
    if (!course) {
      return json({ ok: false, error: 'course_not_found' }, 404);
    }

    const section = await env.DB.prepare(
      'SELECT id FROM course_section WHERE id = ? AND course_id = ?'
    ).bind(sectionId, courseId).first();
    if (!section) {
      return json({ ok: false, error: 'section_not_found' }, 404);
    }

    const maxRow = await env.DB.prepare(
      'SELECT MAX(sort_order) AS max_order FROM course_step WHERE section_id = ?'
    ).bind(sectionId).first();
    const resolvedSortOrder = (maxRow?.max_order ?? -1) + 1;

    try {
      await env.DB.prepare(
        `INSERT INTO course_step (id, section_id, course_id, title, type, stream_uid, duration_seconds, sort_order, attachments_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id.trim(),
        sectionId,
        courseId,
        title.trim(),
        type,
        type === 'video' ? streamUid.trim() : null,
        (duration !== undefined && duration !== null) ? duration : null,
        resolvedSortOrder,
        (attachments !== undefined && attachments !== null) ? JSON.stringify(attachments) : null,
        resolvedStatus
      ).run();
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return json({ ok: false, error: 'step_id_already_exists' }, 409);
      }
      throw err;
    }

    const row = await env.DB.prepare(
      'SELECT * FROM course_step WHERE id = ?'
    ).bind(id.trim()).first();

    return json({ ok: true, data: mapStep(row) }, 201);
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'step_create_error', 'error', err.message, 0, 500);
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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { sectionId, order } = body;

  if (typeof sectionId !== 'string' || !sectionId.trim()) {
    return json({ ok: false, error: 'invalid_section_id' }, 400);
  }
  if (sectionId.length > 100) {
    return json({ ok: false, error: 'invalid_section_id' }, 400);
  }

  if (!Array.isArray(order)) {
    return json({ ok: false, error: 'incomplete_order' }, 400);
  }
  for (const item of order) {
    if (typeof item !== 'string' || !item.trim()) {
      return json({ ok: false, error: 'invalid_id' }, 400);
    }
  }

  try {
    const course = await env.DB.prepare(
      'SELECT id FROM course WHERE id = ?'
    ).bind(courseId).first();
    if (!course) {
      return json({ ok: false, error: 'course_not_found' }, 404);
    }

    const section = await env.DB.prepare(
      'SELECT id FROM course_section WHERE id = ? AND course_id = ?'
    ).bind(sectionId, courseId).first();
    if (!section) {
      return json({ ok: false, error: 'section_not_found' }, 404);
    }

    const { results: existing } = await env.DB.prepare(
      'SELECT id FROM course_step WHERE section_id = ?'
    ).bind(sectionId).all();

    const existingIds = new Set((existing || []).map(r => r.id));

    if (order.length !== existingIds.size) {
      return json({ ok: false, error: 'incomplete_order' }, 400);
    }

    for (const stepId of order) {
      if (!existingIds.has(stepId)) {
        return json({ ok: false, error: 'incomplete_order' }, 400);
      }
    }

    const statements = order.map((stepId, index) =>
      env.DB.prepare(
        "UPDATE course_step SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND section_id = ?"
      ).bind(index, stepId, sectionId)
    );

    await env.DB.batch(statements);

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'step_reorder_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
