/**
 * POST /api/community/areas/join
 *
 * Join a STUC action area. Idempotent: a double-join returns success with
 * joined=false, alreadyMember=true (G-AREA-2).
 *
 * Body: { areaId: string }
 * Response: { ok: true, joined: boolean, alreadyMember: boolean }
 */
import { json, optionsResponse } from '../../auth/_shared.js';
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

    const { areaId } = body;
    if (!areaId || typeof areaId !== 'string' || areaId.length > 100) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }

    let valid;
    try {
      valid = await validateAreaId(env, areaId);
    } catch (err) {
      log(env, waitUntil, 'community', 'area_join_error', 'error', `validateAreaId: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
    if (!valid) {
      return json({ ok: false, error: 'invalid_area_id' }, 400);
    }

    let result;
    try {
      result = await db.prepare(
        "INSERT INTO area_membership(user_id, area_id, role) VALUES(?, ?, 'member') ON CONFLICT(user_id, area_id) DO NOTHING"
      ).bind(user.id, areaId).run();
    } catch (err) {
      log(env, waitUntil, 'community', 'area_join_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    const joined = result.meta.changes > 0;
    return json({ ok: true, joined, alreadyMember: !joined });
  } catch (err) {
    log(env, waitUntil, 'community', 'area_join_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
