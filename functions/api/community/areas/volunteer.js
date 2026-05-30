/**
 * POST   /api/community/areas/volunteer — volunteer to lead an ownerless area
 * DELETE /api/community/areas/volunteer — withdraw own pending volunteer request
 *
 * POST body:   { areaId: string, message?: string }
 * DELETE body: { areaId: string }
 *
 * POST response:   { ok: true, status: 'pending' }
 * DELETE response: { ok: true, withdrawn: boolean }
 */
import { json, optionsResponse, generateId } from '../../auth/_shared.js';
import { log } from '../../_log.js';
import { requireMember } from '../_shared.js';
import { validateAreaId } from '../_areas-shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const db = env.DB;
    if (!db) return json({ ok: false, error: 'service_unavailable' }, 503);

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ ok: false, error: 'invalid_payload' }, 400);
    }

    const { areaId, message } = body;

    if (!areaId || typeof areaId !== 'string' || areaId.length > 100) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }

    if (message !== undefined && message !== null) {
      if (typeof message !== 'string') {
        return json({ ok: false, error: 'invalid_message' }, 400);
      }
      if (message.length > 500) {
        return json({ ok: false, error: 'invalid_message' }, 400);
      }
    }

    let valid;
    try {
      valid = await validateAreaId(env, areaId);
    } catch (err) {
      log(env, waitUntil, 'community', 'area_volunteer_error', 'error', `validateAreaId: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    if (!valid) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }

    let areaRow;
    try {
      areaRow = await db.prepare(
        'SELECT owner_user_id FROM action_area WHERE id = ?'
      ).bind(areaId).first();
    } catch (err) {
      log(env, waitUntil, 'community', 'area_volunteer_error', 'error', `area lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    if (areaRow && areaRow.owner_user_id !== null && areaRow.owner_user_id !== undefined) {
      return json({ ok: false, error: 'area_has_owner' }, 409);
    }

    const id = generateId();

    try {
      await db.prepare(
        `INSERT INTO area_ownership_request (id, area_id, user_id, status, message)
         VALUES (?, ?, ?, 'pending', ?)
         ON CONFLICT(area_id, user_id) DO UPDATE SET
           status = 'pending',
           message = excluded.message,
           created_at = datetime('now'),
           decided_at = NULL,
           decided_by = NULL`
      ).bind(id, areaId, user.id, message ?? null).run();
    } catch (err) {
      log(env, waitUntil, 'community', 'area_volunteer_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    return json({ ok: true, status: 'pending' });
  } catch (err) {
    log(env, waitUntil, 'community', 'area_volunteer_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}

export async function onRequestDelete({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const db = env.DB;
    if (!db) return json({ ok: false, error: 'service_unavailable' }, 503);

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ ok: false, error: 'invalid_payload' }, 400);
    }

    const { areaId } = body;

    if (!areaId || typeof areaId !== 'string' || areaId.length > 100) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }

    let result;
    try {
      result = await db.prepare(
        `UPDATE area_ownership_request
         SET status = 'withdrawn', decided_at = datetime('now')
         WHERE area_id = ? AND user_id = ? AND status = 'pending'`
      ).bind(areaId, user.id).run();
    } catch (err) {
      log(env, waitUntil, 'community', 'area_volunteer_withdraw_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    return json({ ok: true, withdrawn: result.meta.changes > 0 });
  } catch (err) {
    log(env, waitUntil, 'community', 'area_volunteer_withdraw_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
