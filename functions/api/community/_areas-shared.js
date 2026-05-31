/**
 * Shared helpers for the STUC Action Areas subsystem.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Lane-contention note (Addendum #5 from the action-areas implementation plan):
 * Another Claude instance owns _shared.js during this phase. isSafeUrl() is
 * intentionally duplicated from posts.js's local copy until lane contention
 * resolves and consolidation into _shared.js can be committed safely.
 */

/**
 * Validate that a row exists in `action_area` with `status = 'active'`.
 * Returns true if active, false if missing or inactive.
 * Used by future write paths before accepting an area_id from user input.
 *
 * @param {D1Database} env.DB
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function validateAreaId(env, id) {
  const db = env.DB;
  if (!db) return false;
  const row = await db.prepare(
    "SELECT 1 FROM action_area WHERE id = ? AND status = 'active'"
  ).bind(id).first();
  return !!row;
}

/**
 * Duplicated from posts.js (local copy) — see lane-contention note above.
 * Returns true only for http: and https: URLs.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolve the `id` of the active area with the given slug (COLLATE NOCASE).
 * Returns null if no active area matches.
 *
 * @param {D1Database} env.DB
 * @param {string} slug
 * @returns {Promise<string|null>}
 */
export async function resolveActiveAreaIdBySlug(env, slug) {
  const db = env.DB;
  if (!db) return null;
  const row = await db.prepare(
    "SELECT id FROM action_area WHERE slug = ? COLLATE NOCASE AND status = 'active'"
  ).bind(slug).first();
  return row ? row.id : null;
}
