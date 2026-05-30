/**
 * GET  /api/admin/community/ownership — list pending ownership requests
 * POST /api/admin/community/ownership — approve or reject a request
 *
 * Auth: session + superadmin or admin role (self-checked; admin/_middleware.js is best-effort only).
 *
 * GET response:  { ok: true, requests: [{id, areaId, areaName, areaSlug, areaHasOwner, userId, userName, userEmail, message, createdAt}] }
 * POST body:     { id: string, action: 'approve' | 'reject' }
 * POST response: { ok: true, action: 'approve' | 'reject' }
 */
import { json, optionsResponse } from '../../auth/_shared.js';
import { log } from '../../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'service_unavailable' }, 503);

  let rows;
  try {
    const result = await db.prepare(
      `SELECT
         r.id,
         r.area_id,
         r.user_id,
         r.message,
         r.created_at,
         a.name AS area_name,
         a.slug AS area_slug,
         a.owner_user_id AS area_owner_user_id,
         u.name AS user_name,
         u.email AS user_email
       FROM area_ownership_request r
       JOIN action_area a ON a.id = r.area_id
       JOIN user u ON u.id = r.user_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC`
    ).all();
    rows = result.results;
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'ownership_list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({
    ok: true,
    requests: rows.map(r => ({
      id: r.id,
      areaId: r.area_id,
      areaName: r.area_name,
      areaSlug: r.area_slug,
      areaHasOwner: !!r.area_owner_user_id,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      message: r.message || null,
      createdAt: r.created_at,
    })),
  });
}

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

  const { id, action } = body;

  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'id_required' }, 400);
  }
  if (action !== 'approve' && action !== 'reject') {
    return json({ ok: false, error: 'invalid_action' }, 400);
  }

  let requestRow;
  try {
    requestRow = await db.prepare(
      'SELECT area_id, user_id, status FROM area_ownership_request WHERE id = ?'
    ).bind(id).first();
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'ownership_decide_error', 'error', `request lookup: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  if (!requestRow) return json({ ok: false, error: 'not_found' }, 404);
  if (requestRow.status !== 'pending') return json({ ok: false, error: 'not_pending' }, 409);

  const { area_id: areaId, user_id: volunteerId } = requestRow;

  if (action === 'reject') {
    try {
      await db.prepare(
        `UPDATE area_ownership_request
         SET status = 'rejected', decided_at = datetime('now'), decided_by = ?
         WHERE id = ? AND status = 'pending'`
      ).bind(user.id, id).run();
    } catch (err) {
      log(env, waitUntil, 'admin-community', 'ownership_decide_error', 'error', `reject: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    return json({ ok: true, action: 'reject' });
  }

  // action === 'approve'
  let areaRow;
  try {
    areaRow = await db.prepare(
      'SELECT owner_user_id FROM action_area WHERE id = ?'
    ).bind(areaId).first();
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'ownership_decide_error', 'error', `area lookup: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  if (areaRow && areaRow.owner_user_id !== null && areaRow.owner_user_id !== undefined) {
    return json({ ok: false, error: 'area_already_owned' }, 409);
  }

  try {
    await db.batch([
      db.prepare(
        `UPDATE action_area
         SET owner_user_id = ?, updated_at = datetime('now')
         WHERE id = ? AND owner_user_id IS NULL`
      ).bind(volunteerId, areaId),
      db.prepare(
        `INSERT INTO area_membership (user_id, area_id, role)
         VALUES (?, ?, 'owner')
         ON CONFLICT(user_id, area_id) DO UPDATE SET role = 'owner'`
      ).bind(volunteerId, areaId),
      db.prepare(
        `UPDATE area_ownership_request
         SET status = 'approved', decided_at = datetime('now'), decided_by = ?
         WHERE id = ?`
      ).bind(user.id, id),
      db.prepare(
        `UPDATE area_ownership_request
         SET status = 'rejected', decided_at = datetime('now'), decided_by = ?
         WHERE area_id = ? AND status = 'pending' AND id != ?`
      ).bind(user.id, areaId, id),
    ]);
  } catch (err) {
    log(env, waitUntil, 'admin-community', 'ownership_decide_error', 'error', `approve batch: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }

  return json({ ok: true, action: 'approve' });
}
