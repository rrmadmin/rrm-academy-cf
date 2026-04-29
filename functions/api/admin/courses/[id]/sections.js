import { json, optionsResponse } from '../../../auth/_shared.js';
import { log } from '../../../_log.js';

export function onRequestOptions() {
  return optionsResponse();
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

  const { id, title, sortOrder } = body;

  if (typeof id !== 'string' || !id.trim()) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (id.length > 80) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    return json({ ok: false, error: 'invalid_id' }, 400);
  }

  if (typeof title !== 'string' || !title.trim()) {
    return json({ ok: false, error: 'invalid_title' }, 400);
  }
  if (title.length > 200) {
    return json({ ok: false, error: 'invalid_title' }, 400);
  }

  if (sortOrder !== undefined && (!Number.isInteger(sortOrder))) {
    return json({ ok: false, error: 'invalid_sort_order' }, 400);
  }

  try {
    const course = await env.DB.prepare(
      'SELECT id FROM course WHERE id = ?'
    ).bind(courseId).first();
    if (!course) {
      return json({ ok: false, error: 'course_not_found' }, 404);
    }

    let resolvedSortOrder;
    if (sortOrder !== undefined) {
      resolvedSortOrder = sortOrder;
    } else {
      const maxRow = await env.DB.prepare(
        'SELECT MAX(sort_order) AS max_order FROM course_section WHERE course_id = ?'
      ).bind(courseId).first();
      resolvedSortOrder = (maxRow?.max_order ?? -1) + 1;
    }

    try {
      await env.DB.prepare(
        `INSERT INTO course_section (id, course_id, title, sort_order)
         VALUES (?, ?, ?, ?)`
      ).bind(id.trim(), courseId, title.trim(), resolvedSortOrder).run();
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint')) {
        return json({ ok: false, error: 'section_id_already_exists' }, 409);
      }
      throw err;
    }

    return json({
      ok: true,
      data: {
        id: id.trim(),
        courseId,
        title: title.trim(),
        sortOrder: resolvedSortOrder,
      },
    }, 201);
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'section_create_error', 'error', err.message, 0, 500);
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

  const { order } = body;

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

    const { results: existing } = await env.DB.prepare(
      'SELECT id FROM course_section WHERE course_id = ?'
    ).bind(courseId).all();

    const existingIds = new Set((existing || []).map(r => r.id));

    if (order.length !== existingIds.size) {
      return json({ ok: false, error: 'incomplete_order' }, 400);
    }

    for (const sectionId of order) {
      if (!existingIds.has(sectionId)) {
        return json({ ok: false, error: 'incomplete_order' }, 400);
      }
    }

    const statements = order.map((sectionId, index) =>
      env.DB.prepare(
        "UPDATE course_section SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND course_id = ?"
      ).bind(index, sectionId, courseId)
    );

    await env.DB.batch(statements);

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-courses', 'section_reorder_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
