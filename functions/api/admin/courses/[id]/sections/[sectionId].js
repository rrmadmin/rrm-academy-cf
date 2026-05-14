import { json, optionsResponse } from '../../../../auth/_shared.js';
import { log } from '../../../../_log.js';

export function onRequestOptions() {
  return optionsResponse();
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
  const sectionId = context.params?.sectionId;

  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (!sectionId || typeof sectionId !== 'string' || sectionId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  try {
    const [section, { results: steps }] = await Promise.all([
      env.DB.prepare(
        'SELECT * FROM course_section WHERE id = ? AND course_id = ?'
      ).bind(sectionId, courseId).first(),
      env.DB.prepare(
        'SELECT * FROM course_step WHERE section_id = ? ORDER BY sort_order ASC'
      ).bind(sectionId).all(),
    ]);

    if (!section) {
      return json({ ok: false, error: 'section_not_found' }, 404);
    }

    return json({
      ok: true,
      data: {
        id: section.id,
        courseId: section.course_id,
        title: section.title,
        sortOrder: section.sort_order,
        createdAt: section.created_at,
        updatedAt: section.updated_at,
        steps: (steps || []).map(s => ({
          id: s.id,
          title: s.title,
          type: s.type,
          sortOrder: s.sort_order,
          status: s.status,
          streamUid: s.stream_uid ?? null,
          durationSeconds: s.duration_seconds ?? null,
        })),
      },
    });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'section_get_error', 'error', err.message, 0, 500);
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
  const sectionId = context.params?.sectionId;

  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (!sectionId || typeof sectionId !== 'string' || sectionId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  if ('id' in body) {
    return json({ ok: false, error: 'cannot_change_id' }, 400);
  }
  if ('course_id' in body || 'courseId' in body) {
    return json({ ok: false, error: 'cannot_change_course_id' }, 400);
  }

  const { title } = body;

  if (title === undefined) {
    return json({ ok: false, error: 'no_fields_provided' }, 400);
  }

  if (typeof title !== 'string' || !title.trim()) {
    return json({ ok: false, error: 'invalid_title' }, 400);
  }
  if (title.length > 200) {
    return json({ ok: false, error: 'invalid_title' }, 400);
  }

  try {
    const result = await env.DB.prepare(
      "UPDATE course_section SET title = ?, updated_at = datetime('now') WHERE id = ? AND course_id = ?"
    ).bind(title.trim(), sectionId, courseId).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'section_not_found' }, 404);
    }

    const section = await env.DB.prepare(
      'SELECT * FROM course_section WHERE id = ?'
    ).bind(sectionId).first();

    return json({
      ok: true,
      data: {
        id: section.id,
        courseId: section.course_id,
        title: section.title,
        sortOrder: section.sort_order,
        createdAt: section.created_at,
        updatedAt: section.updated_at,
      },
    });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'section_update_error', 'error', err.message, 0, 500);
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
  const sectionId = context.params?.sectionId;

  if (!courseId || typeof courseId !== 'string' || courseId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (!sectionId || typeof sectionId !== 'string' || sectionId.length > 100) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  try {
    const section = await env.DB.prepare(
      'SELECT id FROM course_section WHERE id = ? AND course_id = ?'
    ).bind(sectionId, courseId).first();

    if (!section) {
      return json({ ok: false, error: 'section_not_found' }, 404);
    }

    const { results: steps } = await env.DB.prepare(
      'SELECT id FROM course_step WHERE section_id = ?'
    ).bind(sectionId).all();

    const stepIds = (steps || []).map(s => s.id);

    if (stepIds.length > 0) {
      const placeholders = stepIds.map(() => '?').join(', ');
      const refChecks = await Promise.all([
        env.DB.prepare(
          `SELECT DISTINCT step_id FROM step_progress WHERE step_id IN (${placeholders})`
        ).bind(...stepIds).all(),
        env.DB.prepare(
          `SELECT DISTINCT step_id FROM quiz_response WHERE step_id IN (${placeholders})`
        ).bind(...stepIds).all(),
        env.DB.prepare(
          `SELECT DISTINCT step_id FROM lesson_comment WHERE step_id IN (${placeholders})`
        ).bind(...stepIds).all(),
      ]);

      const referencedStepIds = new Set();
      for (const { results } of refChecks) {
        for (const row of (results || [])) {
          referencedStepIds.add(row.step_id);
        }
      }

      if (referencedStepIds.size > 0) {
        return json({
          ok: false,
          error: 'references_exist',
          stepIds: [...referencedStepIds],
        }, 409);
      }
    }

    const stepDeleteResult = await env.DB.prepare(
      'DELETE FROM course_step WHERE section_id = ?' +
      ' AND NOT EXISTS (SELECT 1 FROM step_progress WHERE step_id IN (SELECT id FROM course_step WHERE section_id = ?))' +
      ' AND NOT EXISTS (SELECT 1 FROM quiz_response WHERE step_id IN (SELECT id FROM course_step WHERE section_id = ?))' +
      ' AND NOT EXISTS (SELECT 1 FROM lesson_comment WHERE step_id IN (SELECT id FROM course_step WHERE section_id = ?))'
    ).bind(sectionId, sectionId, sectionId, sectionId).run();

    if (stepIds.length > 0 && stepDeleteResult.meta.changes === 0) {
      return json({ ok: false, error: 'references_exist', stepIds }, 409);
    }

    await env.DB.prepare('DELETE FROM course_section WHERE id = ?').bind(sectionId).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'section_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
