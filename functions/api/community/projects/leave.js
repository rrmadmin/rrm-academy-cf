/**
 * POST /api/community/projects/leave
 *
 * Leave a project. Idempotent: leaving a non-joined project is a no-op
 * that still returns { ok: true }.
 *
 * Body: { projectId: string }
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

    const { projectId } = body;
    if (!projectId || typeof projectId !== 'string' || projectId.length > 100) {
      return json({ ok: false, error: 'invalid_project_id' }, 400);
    }

    try {
      await db.prepare(
        'DELETE FROM project_membership WHERE user_id = ? AND project_id = ?'
      ).bind(user.id, projectId).run();
    } catch (err) {
      log(env, waitUntil, 'community', 'project_leave_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'community', 'project_leave_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
