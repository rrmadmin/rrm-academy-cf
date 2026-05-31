/**
 * POST   /api/admin/community/projects   — create project
 * PUT    /api/admin/community/projects   — update project
 * DELETE /api/admin/community/projects   — archive (or hard-delete) project
 *
 * Auth: session + superadmin or admin role (self-checked; admin/_middleware.js is best-effort only).
 */
import { json, optionsResponse, generateId } from '../../auth/_shared.js';
import { log } from '../../_log.js';
import { validateAreaId, isSafeUrl } from '../../community/_areas-shared.js';

const VALID_PROJECT_STATUSES = new Set(['recruiting', 'in_progress', 'paused', 'done', 'archived']);
const RESERVED_SLUGS = new Set(['areas', 'events', 'members', 'post']);

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function onRequestOptions() {
  return optionsResponse();
}

// --- POST: create project ---

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

  const {
    title, slug: rawSlug, area_id, status: statusParam,
    summary, description, owner_user_id, workspace_url,
    pinned, sort_order,
  } = body;

  if (!title || typeof title !== 'string') return json({ ok: false, error: 'title_required' }, 400);
  if (title.trim().length === 0) return json({ ok: false, error: 'title_required' }, 400);
  if (title.length > 200) return json({ ok: false, error: 'title_too_long' }, 400);

  if (!rawSlug || typeof rawSlug !== 'string') return json({ ok: false, error: 'slug_required' }, 400);
  const slug = slugify(rawSlug);
  if (!slug) return json({ ok: false, error: 'invalid_slug' }, 400);
  if (RESERVED_SLUGS.has(slug)) return json({ ok: false, error: 'slug_reserved' }, 400);

  if (!area_id || typeof area_id !== 'string' || area_id.length > 100) {
    return json({ ok: false, error: 'area_id_required' }, 400);
  }
  let areaValid;
  try {
    areaValid = await validateAreaId(env, area_id);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'project_create_error', 'error', `area lookup: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
  if (!areaValid) return json({ ok: false, error: 'invalid_area_id' }, 400);

  const status = statusParam || 'recruiting';
  if (!VALID_PROJECT_STATUSES.has(status)) return json({ ok: false, error: 'invalid_status' }, 400);

  if (summary !== undefined && summary !== null) {
    if (typeof summary !== 'string') return json({ ok: false, error: 'invalid_summary' }, 400);
    if (summary.length > 500) return json({ ok: false, error: 'summary_too_long' }, 400);
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') return json({ ok: false, error: 'invalid_description' }, 400);
    if (description.length > 5000) return json({ ok: false, error: 'description_too_long' }, 400);
  }
  if (sort_order !== undefined && sort_order !== null) {
    if (typeof sort_order !== 'number') return json({ ok: false, error: 'invalid_sort_order' }, 400);
  }

  if (workspace_url !== undefined && workspace_url !== null) {
    if (typeof workspace_url !== 'string') return json({ ok: false, error: 'invalid_workspace_url' }, 400);
    if (workspace_url.length > 2000) return json({ ok: false, error: 'workspace_url_too_long' }, 400);
    if (!isSafeUrl(workspace_url)) return json({ ok: false, error: 'invalid_workspace_url' }, 400);
  }

  let resolvedOwnerId = null;
  if (owner_user_id !== undefined && owner_user_id !== null) {
    if (typeof owner_user_id !== 'string' || owner_user_id.length > 100) {
      return json({ ok: false, error: 'invalid_owner_user_id' }, 400);
    }
    try {
      const ownerRow = await db.prepare('SELECT id FROM user WHERE id = ?').bind(owner_user_id).first();
      if (!ownerRow) return json({ ok: false, error: 'owner_user_not_found' }, 400);
      resolvedOwnerId = owner_user_id;
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'project_create_error', 'error', `owner lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  }

  const id = generateId();
  const finalPinned = pinned ? 1 : 0;
  const finalSortOrder = (typeof sort_order === 'number') ? sort_order : 0;

  try {
    const insertProject = db.prepare(
      'INSERT INTO project(id, area_id, slug, title, summary, description, status, owner_user_id, workspace_url, pinned, sort_order) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, area_id, slug, title.trim(),
      summary ?? null, description ?? null, status,
      resolvedOwnerId, workspace_url ?? null,
      finalPinned, finalSortOrder
    );
    if (resolvedOwnerId) {
      await db.batch([
        insertProject,
        db.prepare(
          "INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, 'owner') ON CONFLICT(user_id, project_id) DO UPDATE SET role = 'owner'"
        ).bind(resolvedOwnerId, id),
      ]);
    } else {
      await insertProject.run();
    }
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-community', 'project_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true, id }, 201);
}

// --- PUT: update project ---

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

  const {
    id, title, slug: rawSlug, area_id, status,
    summary, description, owner_user_id, workspace_url,
    pinned, sort_order,
  } = body;
  if (!id || typeof id !== 'string' || id.length > 100) return json({ ok: false, error: 'id_required' }, 400);

  const setClauses = [];
  const bindings = [];

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) return json({ ok: false, error: 'title_required' }, 400);
    if (title.length > 200) return json({ ok: false, error: 'title_too_long' }, 400);
    setClauses.push('title = ?'); bindings.push(title.trim());
  }

  if (rawSlug !== undefined) {
    if (typeof rawSlug !== 'string') return json({ ok: false, error: 'invalid_slug' }, 400);
    const slug = slugify(rawSlug);
    if (!slug) return json({ ok: false, error: 'invalid_slug' }, 400);
    if (RESERVED_SLUGS.has(slug)) return json({ ok: false, error: 'slug_reserved' }, 400);
    try {
      const collision = await db.prepare(
        'SELECT 1 FROM project WHERE slug = ? COLLATE NOCASE AND id != ?'
      ).bind(slug, id).first();
      if (collision) return json({ ok: false, error: 'slug_already_exists' }, 409);
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'project_update_error', 'error', `slug check: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    setClauses.push('slug = ?'); bindings.push(slug);
  }

  if (area_id !== undefined) {
    if (!area_id || typeof area_id !== 'string' || area_id.length > 100) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }
    let areaValid;
    try {
      areaValid = await validateAreaId(env, area_id);
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'project_update_error', 'error', `area lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    if (!areaValid) return json({ ok: false, error: 'invalid_area_id' }, 400);
    setClauses.push('area_id = ?'); bindings.push(area_id);
  }

  if (status !== undefined) {
    if (!VALID_PROJECT_STATUSES.has(status)) return json({ ok: false, error: 'invalid_status' }, 400);
    setClauses.push('status = ?'); bindings.push(status);
  }

  if (summary !== undefined) {
    if (summary !== null) {
      if (typeof summary !== 'string') return json({ ok: false, error: 'invalid_summary' }, 400);
      if (summary.length > 500) return json({ ok: false, error: 'summary_too_long' }, 400);
    }
    setClauses.push('summary = ?'); bindings.push(summary ?? null);
  }

  if (description !== undefined) {
    if (description !== null) {
      if (typeof description !== 'string') return json({ ok: false, error: 'invalid_description' }, 400);
      if (description.length > 5000) return json({ ok: false, error: 'description_too_long' }, 400);
    }
    setClauses.push('description = ?'); bindings.push(description ?? null);
  }

  if (workspace_url !== undefined) {
    if (workspace_url !== null) {
      if (typeof workspace_url !== 'string') return json({ ok: false, error: 'invalid_workspace_url' }, 400);
      if (workspace_url.length > 2000) return json({ ok: false, error: 'workspace_url_too_long' }, 400);
      if (!isSafeUrl(workspace_url)) return json({ ok: false, error: 'invalid_workspace_url' }, 400);
    }
    setClauses.push('workspace_url = ?'); bindings.push(workspace_url ?? null);
  }

  if (owner_user_id !== undefined) {
    if (owner_user_id !== null) {
      if (typeof owner_user_id !== 'string' || owner_user_id.length > 100) {
        return json({ ok: false, error: 'invalid_owner_user_id' }, 400);
      }
      try {
        const ownerRow = await db.prepare('SELECT id FROM user WHERE id = ?').bind(owner_user_id).first();
        if (!ownerRow) return json({ ok: false, error: 'owner_user_not_found' }, 400);
      } catch (err) {
        log(env, waitUntil, 'admin-community', 'project_update_error', 'error', `owner lookup: ${err.message}`, 0, 500);
        return json({ ok: false, error: 'internal_error' }, 500);
      }
    }
    setClauses.push('owner_user_id = ?'); bindings.push(owner_user_id ?? null);
  }

  if (pinned !== undefined) {
    setClauses.push('pinned = ?'); bindings.push(pinned ? 1 : 0);
  }

  if (sort_order !== undefined) {
    if (sort_order !== null && typeof sort_order !== 'number') {
      return json({ ok: false, error: 'invalid_sort_order' }, 400);
    }
    setClauses.push('sort_order = ?'); bindings.push(sort_order ?? 0);
  }

  if (setClauses.length === 0) return json({ ok: false, error: 'no_fields_provided' }, 400);

  setClauses.push("updated_at = datetime('now')");
  bindings.push(id);

  const newOwnerId = (owner_user_id !== undefined && owner_user_id !== null) ? owner_user_id : null;

  try {
    const updateProject = db.prepare(
      `UPDATE project SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings);
    let results;
    if (newOwnerId) {
      results = await db.batch([
        updateProject,
        db.prepare(
          "INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, 'owner') ON CONFLICT(user_id, project_id) DO UPDATE SET role = 'owner'"
        ).bind(newOwnerId, id),
      ]);
    } else {
      results = [await updateProject.run()];
    }
    if (results[0].meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-community', 'project_update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true });
}

// --- DELETE: archive or hard-delete project ---

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

  const { id, hard } = body;
  if (!id || typeof id !== 'string' || id.length > 100) return json({ ok: false, error: 'id_required' }, 400);

  try {
    const existing = await db.prepare('SELECT id FROM project WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'project_delete_error', 'error', `lookup: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  if (hard === 1 || hard === true) {
    // Hard-delete: null project_id on impact_entry, delete memberships, then project
    try {
      await db.batch([
        db.prepare('DELETE FROM project_membership WHERE project_id = ?').bind(id),
        db.prepare('UPDATE impact_entry SET project_id = NULL WHERE project_id = ?').bind(id),
        db.prepare('DELETE FROM project WHERE id = ?').bind(id),
      ]);
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'project_delete_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    return json({ ok: true });
  }

  // Soft-delete: archive the project
  try {
    const result = await db.prepare(
      "UPDATE project SET status = 'archived', updated_at = datetime('now') WHERE id = ?"
    ).bind(id).run();
    if (result.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'project_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true });
}
