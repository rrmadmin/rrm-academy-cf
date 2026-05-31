/**
 * POST /api/community/areas/leave
 *
 * Leave a STUC action area. Idempotent: leaving a non-joined area is a no-op
 * that still returns { ok: true }.
 *
 * Body: { areaId: string }
 * Response: { ok: true }
 */
import { json, optionsResponse } from '../../auth/_shared.js';
import { log } from '../../_log.js';
import { requireMember } from '../_shared.js';

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

    const { areaId } = body;
    if (!areaId || typeof areaId !== 'string' || areaId.length > 100) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }

    try {
      const area = await db.prepare(
        'SELECT owner_user_id FROM action_area WHERE id = ?'
      ).bind(areaId).first();
      if (area && area.owner_user_id === user.id) {
        return json({ ok: false, error: 'owner_cannot_leave' }, 409);
      }
    } catch (err) {
      log(env, waitUntil, 'community', 'area_leave_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    try {
      await db.prepare(
        'DELETE FROM area_membership WHERE user_id = ? AND area_id = ?'
      ).bind(user.id, areaId).run();
    } catch (err) {
      log(env, waitUntil, 'community', 'area_leave_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'area_leave_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
