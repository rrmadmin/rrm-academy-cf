/**
 * POST /api/community/projects/join
 *
 * Join a project. Rejects if the project is missing or status is 'archived'
 * or 'done'. Idempotent: double-join returns success with joined=false,
 * alreadyMember=true (G-AREA-2).
 *
 * Body: { projectId: string }
 * Response: { ok: true, joined: boolean, alreadyMember: boolean }
 */
import { json, optionsResponse } from '../../auth/_shared.js';
import { log } from '../../_log.js';
import { requireMember } from '../_shared.js';

const NOT_JOINABLE_STATUSES = new Set(['archived', 'done']);

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

    let project;
    try {
      project = await db.prepare(
        'SELECT id, status FROM project WHERE id = ?'
      ).bind(projectId).first();
    } catch (err) {
      log(env, waitUntil, 'community', 'project_join_error', 'error', `lookup: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    if (!project) {
      return json({ ok: false, error: 'project_not_joinable' }, 400);
    }
    if (NOT_JOINABLE_STATUSES.has(project.status)) {
      return json({ ok: false, error: 'project_not_joinable' }, 400);
    }

    let result;
    try {
      result = await db.prepare(
        "INSERT INTO project_membership(user_id, project_id, role) VALUES(?, ?, 'member') ON CONFLICT(user_id, project_id) DO NOTHING"
      ).bind(user.id, projectId).run();
    } catch (err) {
      log(env, waitUntil, 'community', 'project_join_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'internal_error' }, 500);
    }

    const joined = result.meta.changes > 0;
    return json({ ok: true, joined, alreadyMember: !joined });
  } catch (err) {
    log(env, waitUntil, 'community', 'project_join_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}
