/**
 * GET /api/community/areas — list active action areas
 *
 * PUBLIC. Returns all action_area rows with status='active', ordered by sort_order.
 * Each area includes projectCount (via LEFT JOIN, so zero-project areas return 0).
 * When a valid session is present, each area also includes isMember (boolean).
 * Display gating (e.g. hiding zero-project areas) is the hub's responsibility —
 * this API always returns the real count (G-AREA-12).
 *
 * Response: { ok: true, areas: [...] }
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../auth/_shared.js';
import { log } from '../_log.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 503);

    // Optional session — do NOT require membership (public endpoint)
    const sessionId = getSessionIdFromCookie(request);
    const session = sessionId ? await validateSession(db, sessionId) : null;
    const userId = session ? session.userId : null;

    let areas;
    try {
      const result = await db.prepare(`
        SELECT
          a.id,
          a.slug,
          a.name,
          a.tagline,
          a.description,
          a.icon,
          a.owner_user_id,
          a.sort_order,
          a.created_at,
          COUNT(p.id) AS projectCount,
          uo.name AS owner_name
        FROM action_area a
        LEFT JOIN project p ON p.area_id = a.id AND p.status NOT IN ('archived')
        LEFT JOIN user uo ON uo.id = a.owner_user_id
        WHERE a.status = 'active'
        GROUP BY a.id
        ORDER BY a.sort_order
      `).all();
      areas = result.results;
    } catch (err) {
      log(env, waitUntil, 'community', 'areas_error', 'error', `DB query: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    // If authenticated, fetch isMember per area
    let membershipSet = new Set();
    if (userId) {
      try {
        const memResult = await db.prepare(
          'SELECT area_id FROM area_membership WHERE user_id = ?'
        ).bind(userId).all();
        for (const row of memResult.results) {
          membershipSet.add(row.area_id);
        }
      } catch (err) {
        // Non-fatal: log and continue without membership data
        log(env, waitUntil, 'community', 'areas_membership_error', 'error', err.message, 0, 0);
      }
    }

    const mapped = areas.map(a => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      tagline: a.tagline || null,
      description: a.description || null,
      icon: a.icon || null,
      ownerUserId: a.owner_user_id || null,
      ownerName: a.owner_name || null,
      sortOrder: a.sort_order,
      projectCount: a.projectCount,
      createdAt: a.created_at,
      ...(userId !== null ? { isMember: membershipSet.has(a.id) } : {}),
    }));

    return json({ ok: true, areas: mapped });
  } catch (err) {
    log(env, waitUntil, 'community', 'areas_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
