/**
 * GET /api/community/memberships — caller's area and project memberships
 *
 * MEMBER-ONLY. Returns the authenticated caller's area_membership rows,
 * project_membership rows, and pending ownership volunteer requests.
 * user_id is always sourced from the session (Rule 9).
 *
 * Response: { ok: true, areas: [{areaId, role}], projects: [{projectId, role}], pendingOwnership: [areaId, ...] }
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;

    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 503);

    // user_id from session only — never from request (Rule 9)
    const userId = auth.user.id;

    let areaMemberships;
    let projectMemberships;
    let pendingOwnershipRows;

    try {
      const areaResult = await db.prepare(
        'SELECT area_id, role FROM area_membership WHERE user_id = ?'
      ).bind(userId).all();
      areaMemberships = areaResult.results;
    } catch (err) {
      log(env, waitUntil, 'community', 'memberships_error', 'error', `area query: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    try {
      const projectResult = await db.prepare(
        'SELECT project_id, role FROM project_membership WHERE user_id = ?'
      ).bind(userId).all();
      projectMemberships = projectResult.results;
    } catch (err) {
      log(env, waitUntil, 'community', 'memberships_error', 'error', `project query: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    try {
      const pendingResult = await db.prepare(
        "SELECT area_id FROM area_ownership_request WHERE user_id = ? AND status = 'pending'"
      ).bind(userId).all();
      pendingOwnershipRows = pendingResult.results;
    } catch (err) {
      log(env, waitUntil, 'community', 'memberships_error', 'error', `pending ownership query: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    return json({
      ok: true,
      areas: areaMemberships.map(r => ({ areaId: r.area_id, role: r.role })),
      projects: projectMemberships.map(r => ({ projectId: r.project_id, role: r.role })),
      pendingOwnership: pendingOwnershipRows.map(r => r.area_id),
    });
  } catch (err) {
    log(env, waitUntil, 'community', 'memberships_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
