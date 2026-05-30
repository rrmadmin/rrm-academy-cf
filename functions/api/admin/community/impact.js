/**
 * POST   /api/admin/community/impact   — create impact entry
 * PUT    /api/admin/community/impact   — update impact entry
 * DELETE /api/admin/community/impact   — hard-delete impact entry
 *
 * Auth: session + superadmin or admin role (self-checked; admin/_middleware.js is best-effort only).
 * Impact entries have no children so DELETE is always a hard delete.
 */
import { json, optionsResponse, generateId } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_KINDS = new Set(['webinar', 'research', 'advocacy', 'legal', 'milestone']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function onRequestOptions() {
  return optionsResponse();
}

// --- POST: create impact entry ---

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'service_unavailable' }, 503);

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_payload' }, 400);
  }

  const { kind, title, occurred_on, detail, area_id, project_id } = body;

  if (!kind || !VALID_KINDS.has(kind)) return json({ ok: false, error: 'invalid_kind' }, 400);

  if (!title || typeof title !== 'string') return json({ ok: false, error: 'title_required' }, 400);
  if (title.trim().length === 0) return json({ ok: false, error: 'title_required' }, 400);
  if (title.length > 200) return json({ ok: false, error: 'title_too_long' }, 400);

  if (!occurred_on || typeof occurred_on !== 'string') return json({ ok: false, error: 'occurred_on_required' }, 400);
  if (!ISO_DATE_RE.test(occurred_on)) return json({ ok: false, error: 'invalid_occurred_on' }, 400);

  if (detail !== undefined && detail !== null) {
    if (typeof detail !== 'string') return json({ ok: false, error: 'invalid_detail' }, 400);
    if (detail.length > 2000) return json({ ok: false, error: 'detail_too_long' }, 400);
  }

  let resolvedAreaId = null;
  if (area_id !== undefined && area_id !== null) {
    if (typeof area_id !== 'string' || area_id.length > 100) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }
    try {
      const areaRow = await db.prepare('SELECT id FROM action_area WHERE id = ?').bind(area_id).first();
      if (!areaRow) return json({ ok: false, error: 'area_not_found' }, 400);
      resolvedAreaId = area_id;
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'impact_create_error', 'error', `area lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  }

  let resolvedProjectId = null;
  if (project_id !== undefined && project_id !== null) {
    if (typeof project_id !== 'string' || project_id.length > 100) {
      return json({ ok: false, error: 'invalid_project_id' }, 400);
    }
    try {
      const projectRow = await db.prepare('SELECT id FROM project WHERE id = ?').bind(project_id).first();
      if (!projectRow) return json({ ok: false, error: 'project_not_found' }, 400);
      resolvedProjectId = project_id;
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'impact_create_error', 'error', `project lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  }

  const id = generateId();

  try {
    await db.prepare(
      'INSERT INTO impact_entry(id, area_id, project_id, kind, title, detail, occurred_on, created_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, resolvedAreaId, resolvedProjectId,
      kind, title.trim(), detail ?? null,
      occurred_on, user.id
    ).run();
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'impact_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true, id }, 201);
}

// --- PUT: update impact entry ---

export async function onRequestPut(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'service_unavailable' }, 503);

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_payload' }, 400);
  }

  const { id, kind, title, occurred_on, detail, area_id, project_id } = body;
  if (!id || typeof id !== 'string' || id.length > 100) return json({ ok: false, error: 'id_required' }, 400);

  const setClauses = [];
  const bindings = [];

  if (kind !== undefined) {
    if (!VALID_KINDS.has(kind)) return json({ ok: false, error: 'invalid_kind' }, 400);
    setClauses.push('kind = ?'); bindings.push(kind);
  }

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) return json({ ok: false, error: 'title_required' }, 400);
    if (title.length > 200) return json({ ok: false, error: 'title_too_long' }, 400);
    setClauses.push('title = ?'); bindings.push(title.trim());
  }

  if (occurred_on !== undefined) {
    if (typeof occurred_on !== 'string' || !ISO_DATE_RE.test(occurred_on)) {
      return json({ ok: false, error: 'invalid_occurred_on' }, 400);
    }
    setClauses.push('occurred_on = ?'); bindings.push(occurred_on);
  }

  if (detail !== undefined) {
    if (detail !== null) {
      if (typeof detail !== 'string') return json({ ok: false, error: 'invalid_detail' }, 400);
      if (detail.length > 2000) return json({ ok: false, error: 'detail_too_long' }, 400);
    }
    setClauses.push('detail = ?'); bindings.push(detail ?? null);
  }

  if (area_id !== undefined) {
    if (area_id !== null) {
      if (typeof area_id !== 'string' || area_id.length > 100) {
        return json({ ok: false, error: 'invalid_area_id' }, 400);
      }
      try {
        const areaRow = await db.prepare('SELECT id FROM action_area WHERE id = ?').bind(area_id).first();
        if (!areaRow) return json({ ok: false, error: 'area_not_found' }, 400);
      } catch (err) {
        log(env, waitUntil, 'admin-community', 'impact_update_error', 'error', `area lookup: ${err.message}`, 0, 500);
        return json({ ok: false, error: 'internal_error' }, 500);
      }
    }
    setClauses.push('area_id = ?'); bindings.push(area_id ?? null);
  }

  if (project_id !== undefined) {
    if (project_id !== null) {
      if (typeof project_id !== 'string' || project_id.length > 100) {
        return json({ ok: false, error: 'invalid_project_id' }, 400);
      }
      try {
        const projectRow = await db.prepare('SELECT id FROM project WHERE id = ?').bind(project_id).first();
        if (!projectRow) return json({ ok: false, error: 'project_not_found' }, 400);
      } catch (err) {
        log(env, waitUntil, 'admin-community', 'impact_update_error', 'error', `project lookup: ${err.message}`, 0, 500);
        return json({ ok: false, error: 'internal_error' }, 500);
      }
    }
    setClauses.push('project_id = ?'); bindings.push(project_id ?? null);
  }

  if (setClauses.length === 0) return json({ ok: false, error: 'no_fields_provided' }, 400);

  bindings.push(id);

  try {
    const result = await db.prepare(
      `UPDATE impact_entry SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();
    if (result.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'impact_update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true });
}

// --- DELETE: hard-delete impact entry (no children) ---

export async function onRequestDelete(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'service_unavailable' }, 503);

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ ok: false, error: 'invalid_payload' }, 400);
  }

  const { id } = body;
  if (!id || typeof id !== 'string' || id.length > 100) return json({ ok: false, error: 'id_required' }, 400);

  try {
    const result = await db.prepare('DELETE FROM impact_entry WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'impact_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true });
}
