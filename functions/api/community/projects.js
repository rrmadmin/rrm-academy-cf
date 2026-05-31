/**
 * GET /api/community/projects — list action area projects
 *
 * PUBLIC. Returns project rows that JOIN to an active parent action_area.
 * A project whose area is archived or missing does NOT appear (G-AREA-7).
 *
 * Optional filters:
 *   ?area=<slug>   — filter by area slug (resolved via resolveActiveAreaIdBySlug;
 *                    unknown or archived slug returns empty list, not 400)
 *   ?status=<val>  — filter by project status; must be one of the allowlist or 400
 *
 * Includes isMember per project when a valid session is present.
 * Order: pinned DESC, sort_order, created_at DESC.
 *
 * Response: { ok: true, projects: [...] }
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { log } from '../_log.js';
import { resolveActiveAreaIdBySlug } from './_areas-shared.js';

const VALID_PROJECT_STATUSES = new Set(['recruiting', 'in_progress', 'paused', 'done']);

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 503);

    const url = new URL(request.url);

    // Validate ?status filter
    const statusParam = url.searchParams.get('status');
    if (statusParam !== null) {
      if (!VALID_PROJECT_STATUSES.has(statusParam)) {
        return json({ ok: false, error: 'invalid_status' }, 400);
      }
    }

    // Validate ?area slug (length cap)
    const areaSlugParam = url.searchParams.get('area');
    if (areaSlugParam !== null) {
      if (typeof areaSlugParam !== 'string' || areaSlugParam.length > 100) {
        return json({ ok: false, error: 'invalid_area' }, 400);
      }
    }

    // Optional session — do NOT require membership (public endpoint)
    const sessionId = getSessionIdFromCookie(request);
    const session = sessionId ? await validateSession(db, sessionId) : null;
    const userId = session ? session.userId : null;

    // Resolve area filter — unknown/archived slug returns empty list per spec
    let areaIdFilter = null;
    let areaSlugNoMatch = false;
    if (areaSlugParam) {
      try {
        areaIdFilter = await resolveActiveAreaIdBySlug(env, areaSlugParam);
      } catch (err) {
        log(env, waitUntil, 'community', 'projects_error', 'error', `area lookup: ${err.message}`, 0, 500);
        return json({ ok: false, error: 'Internal error' }, 500);
      }
      if (!areaIdFilter) {
        areaSlugNoMatch = true;
      }
    }

    // Unknown/archived slug: return empty list (documented behavior, not an error)
    if (areaSlugNoMatch) {
      return json({ ok: true, projects: [] });
    }

    // Build query — always JOIN to active area (G-AREA-7)
    const params = [];
    let whereClause = "WHERE a.status = 'active'";

    if (areaIdFilter) {
      whereClause += ' AND p.area_id = ?';
      params.push(areaIdFilter);
    }

    if (statusParam) {
      whereClause += ' AND p.status = ?';
      params.push(statusParam);
    } else {
      whereClause += " AND p.status != 'archived'";
    }

    let projects;
    try {
      const result = await db.prepare(`
        SELECT
          p.id,
          p.area_id,
          a.slug AS area_slug,
          a.name AS area_name,
          p.slug,
          p.title,
          p.summary,
          p.description,
          p.status,
          p.pinned,
          p.sort_order,
          p.owner_user_id,
          p.workspace_url,
          p.created_at,
          p.updated_at
        FROM project p
        JOIN action_area a ON a.id = p.area_id
        ${whereClause}
        ORDER BY p.pinned DESC, p.sort_order, p.created_at DESC
      `).bind(...params).all();
      projects = result.results;
    } catch (err) {
      log(env, waitUntil, 'community', 'projects_error', 'error', `DB query: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    // If authenticated, fetch isMember per project
    let membershipSet = new Set();
    if (userId && projects.length > 0) {
      try {
        const memResult = await db.prepare(
          'SELECT project_id FROM project_membership WHERE user_id = ?'
        ).bind(userId).all();
        for (const row of memResult.results) {
          membershipSet.add(row.project_id);
        }
      } catch (err) {
        // Non-fatal: log and continue without membership data
        log(env, waitUntil, 'community', 'projects_membership_error', 'error', err.message, 0, 0);
      }
    }

    const mapped = projects.map(p => ({
      id: p.id,
      areaId: p.area_id,
      areaSlug: p.area_slug,
      areaName: p.area_name,
      slug: p.slug,
      title: p.title,
      summary: p.summary || null,
      description: p.description || null,
      status: p.status,
      pinned: !!p.pinned,
      sortOrder: p.sort_order,
      ownerUserId: p.owner_user_id || null,
      workspaceUrl: p.workspace_url || null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      ...(userId !== null ? { isMember: membershipSet.has(p.id) } : {}),
    }));

    return json({ ok: true, projects: mapped });
  } catch (err) {
    log(env, waitUntil, 'community', 'projects_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
