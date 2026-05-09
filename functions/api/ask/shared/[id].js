/**
 * GET /api/ask/shared/:id  — public read of a single shared Q&A
 *
 * No auth required. Rate limited per IP: 60/min.
 * CRITICAL: never returns user_id or any user-identifying data.
 */
import { json, optionsResponse, checkRateLimit } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const ID_RE = /^[0-9a-f]{32}$/;

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil, params }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const allowed = await checkRateLimit(env, 'ask_shared:' + ip, 60, 60);
    if (!allowed) return json({ ok: false, error: 'rate_limited' }, 429);

    const id = params?.id || '';
    if (!ID_RE.test(id)) return json({ ok: false, error: 'not_found' }, 404);

    const row = await db.prepare(
      'SELECT id, question, answer, citations_json, created_at FROM ask_saved WHERE id = ?'
    ).bind(id).first();

    if (!row) return json({ ok: false, error: 'not_found' }, 404);

    let citations = [];
    try { citations = JSON.parse(row.citations_json); } catch { /* leave empty */ }

    return json({
      ok: true,
      item: {
        id: row.id,
        question: row.question,
        answer: row.answer,
        citations,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    log(env, waitUntil, 'ask', 'shared_get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
