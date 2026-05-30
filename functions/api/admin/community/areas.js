/**
 * POST   /api/admin/community/areas   — create action area
 * PUT    /api/admin/community/areas   — update action area
 * DELETE /api/admin/community/areas   — archive (or hard-delete) action area
 *
 * Auth: session + superadmin or admin role (self-checked; admin/_middleware.js is best-effort only).
 */
import { json, optionsResponse, generateId } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_BUCKETS = new Set(['research', 'advocacy', 'education', 'community']);
const VALID_STATUSES = new Set(['active', 'archived']);
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

// --- POST: create area ---

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

  const { name, slug: rawSlug, bucket, tagline, description, icon, sort_order, owner_user_id } = body;

  if (!name || typeof name !== 'string') return json({ ok: false, error: 'name_required' }, 400);
  if (name.trim().length === 0) return json({ ok: false, error: 'name_required' }, 400);
  if (name.length > 100) return json({ ok: false, error: 'name_too_long' }, 400);

  if (!rawSlug || typeof rawSlug !== 'string') return json({ ok: false, error: 'slug_required' }, 400);
  const slug = slugify(rawSlug);
  if (!slug) return json({ ok: false, error: 'invalid_slug' }, 400);
  if (RESERVED_SLUGS.has(slug)) return json({ ok: false, error: 'slug_reserved' }, 400);

  if (!bucket || !VALID_BUCKETS.has(bucket)) return json({ ok: false, error: 'invalid_bucket' }, 400);

  if (tagline !== undefined && tagline !== null) {
    if (typeof tagline !== 'string') return json({ ok: false, error: 'invalid_tagline' }, 400);
    if (tagline.length > 200) return json({ ok: false, error: 'tagline_too_long' }, 400);
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') return json({ ok: false, error: 'invalid_description' }, 400);
    if (description.length > 2000) return json({ ok: false, error: 'description_too_long' }, 400);
  }
  if (icon !== undefined && icon !== null) {
    if (typeof icon !== 'string') return json({ ok: false, error: 'invalid_icon' }, 400);
    if (icon.length > 100) return json({ ok: false, error: 'icon_too_long' }, 400);
  }
  if (sort_order !== undefined && sort_order !== null) {
    if (typeof sort_order !== 'number') return json({ ok: false, error: 'invalid_sort_order' }, 400);
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
      log(env, waitUntil, 'admin-community', 'area_create_error', 'error', `owner lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  }

  const id = generateId();
  const finalSortOrder = (typeof sort_order === 'number') ? sort_order : 0;

  try {
    await db.prepare(
      'INSERT INTO action_area(id, slug, name, tagline, description, icon, bucket, owner_user_id, sort_order, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, slug, name.trim(),
      tagline ?? null, description ?? null, icon ?? null,
      bucket, resolvedOwnerId, finalSortOrder, 'active'
    ).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-community', 'area_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true, id }, 201);
}

// --- PUT: update area ---

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

  const { id, name, slug: rawSlug, bucket, tagline, description, icon, sort_order, status, owner_user_id } = body;
  if (!id || typeof id !== 'string' || id.length > 100) return json({ ok: false, error: 'id_required' }, 400);

  const setClauses = [];
  const bindings = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) return json({ ok: false, error: 'name_required' }, 400);
    if (name.length > 100) return json({ ok: false, error: 'name_too_long' }, 400);
    setClauses.push('name = ?'); bindings.push(name.trim());
  }

  if (rawSlug !== undefined) {
    if (typeof rawSlug !== 'string') return json({ ok: false, error: 'invalid_slug' }, 400);
    const slug = slugify(rawSlug);
    if (!slug) return json({ ok: false, error: 'invalid_slug' }, 400);
    if (RESERVED_SLUGS.has(slug)) return json({ ok: false, error: 'slug_reserved' }, 400);
    try {
      const collision = await db.prepare(
        'SELECT 1 FROM action_area WHERE slug = ? COLLATE NOCASE AND id != ?'
      ).bind(slug, id).first();
      if (collision) return json({ ok: false, error: 'slug_already_exists' }, 409);
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'area_update_error', 'error', `slug check: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    setClauses.push('slug = ?'); bindings.push(slug);
  }

  if (bucket !== undefined) {
    if (!VALID_BUCKETS.has(bucket)) return json({ ok: false, error: 'invalid_bucket' }, 400);
    setClauses.push('bucket = ?'); bindings.push(bucket);
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) return json({ ok: false, error: 'invalid_status' }, 400);
    setClauses.push('status = ?'); bindings.push(status);
  }

  if (tagline !== undefined) {
    if (tagline !== null) {
      if (typeof tagline !== 'string') return json({ ok: false, error: 'invalid_tagline' }, 400);
      if (tagline.length > 200) return json({ ok: false, error: 'tagline_too_long' }, 400);
    }
    setClauses.push('tagline = ?'); bindings.push(tagline ?? null);
  }

  if (description !== undefined) {
    if (description !== null) {
      if (typeof description !== 'string') return json({ ok: false, error: 'invalid_description' }, 400);
      if (description.length > 2000) return json({ ok: false, error: 'description_too_long' }, 400);
    }
    setClauses.push('description = ?'); bindings.push(description ?? null);
  }

  if (icon !== undefined) {
    if (icon !== null) {
      if (typeof icon !== 'string') return json({ ok: false, error: 'invalid_icon' }, 400);
      if (icon.length > 100) return json({ ok: false, error: 'icon_too_long' }, 400);
    }
    setClauses.push('icon = ?'); bindings.push(icon ?? null);
  }

  if (sort_order !== undefined) {
    if (sort_order !== null && typeof sort_order !== 'number') {
      return json({ ok: false, error: 'invalid_sort_order' }, 400);
    }
    setClauses.push('sort_order = ?'); bindings.push(sort_order ?? 0);
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
        log(env, waitUntil, 'admin-community', 'area_update_error', 'error', `owner lookup: ${err.message}`, 0, 500);
        return json({ ok: false, error: 'internal_error' }, 500);
      }
    }
    setClauses.push('owner_user_id = ?'); bindings.push(owner_user_id ?? null);
  }

  if (setClauses.length === 0) return json({ ok: false, error: 'no_fields_provided' }, 400);

  setClauses.push("updated_at = datetime('now')");
  bindings.push(id);

  try {
    const result = await db.prepare(
      `UPDATE action_area SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();
    if (result.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-community', 'area_update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true });
}

// --- DELETE: archive or hard-delete area ---

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
    const existing = await db.prepare('SELECT id FROM action_area WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'not_found' }, 404);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'area_delete_error', 'error', `lookup: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  if (hard === 1 || hard === true) {
    // Hard-delete: remove all children then the area itself (D1 CASCADE is inert)
    // Order: project_membership -> project -> area_membership -> impact_entry -> community_post.area_id null -> action_area
    try {
      await db.batch([
        db.prepare('DELETE FROM project_membership WHERE project_id IN (SELECT id FROM project WHERE area_id = ?)').bind(id),
        db.prepare('DELETE FROM project WHERE area_id = ?').bind(id),
        db.prepare('DELETE FROM area_membership WHERE area_id = ?').bind(id),
        db.prepare('DELETE FROM impact_entry WHERE area_id = ?').bind(id),
        db.prepare('UPDATE community_post SET area_id = NULL WHERE area_id = ?').bind(id),
        db.prepare('DELETE FROM action_area WHERE id = ?').bind(id),
      ]);
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'area_delete_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    return json({ ok: true });
  }

  // Soft-delete: archive the area + propagate to child projects (G-AREA-7)
  try {
    await db.batch([
      db.prepare("UPDATE action_area SET status = 'archived', updated_at = datetime('now') WHERE id = ?").bind(id),
      db.prepare("UPDATE project SET status = 'archived', updated_at = datetime('now') WHERE area_id = ?").bind(id),
    ]);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'area_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true });
}
