/**
 * GET /api/community/impact — curated impact entries for the current calendar month (ET)
 *
 * PUBLIC. Returns impact_entry rows whose occurred_on falls in the current month
 * as measured in America/New_York (G-AREA-11).
 *
 * Why JS for the month window instead of D1 strftime:
 * D1's strftime('now') is UTC. At e.g. 11:30 PM ET on Jan 31st, UTC is already
 * Feb 1st, so strftime would return February and the January entries would disappear
 * an hour early. We compute the ET YYYY-MM string in JS and pass it as a query param.
 *
 * Response: { ok: true, impact: [...] }
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

/**
 * Return the current YYYY-MM string in America/New_York.
 * Uses Intl.DateTimeFormat to handle DST transitions correctly.
 *
 * @returns {string} e.g. "2026-05"
 */
function currentEtYearMonth() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  return `${year}-${month}`;
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 503);

    // Compute the current ET month window in JS (G-AREA-11)
    const etYearMonth = currentEtYearMonth();

    let impact;
    try {
      const result = await db.prepare(`
        SELECT
          i.id,
          i.area_id,
          i.project_id,
          i.kind,
          i.title,
          i.detail,
          i.occurred_on,
          i.created_at
        FROM impact_entry i
        WHERE substr(i.occurred_on, 1, 7) = ?
        ORDER BY i.occurred_on DESC
      `).bind(etYearMonth).all();
      impact = result.results;
    } catch (err) {
      log(env, waitUntil, 'community', 'impact_error', 'error', `DB query: ${err.message}`, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }

    const mapped = impact.map(i => ({
      id: i.id,
      areaId: i.area_id || null,
      projectId: i.project_id || null,
      kind: i.kind,
      title: i.title,
      detail: i.detail || null,
      occurredOn: i.occurred_on,
      createdAt: i.created_at,
    }));

    return json({ ok: true, impact: mapped });
  } catch (err) {
    log(env, waitUntil, 'community', 'impact_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
