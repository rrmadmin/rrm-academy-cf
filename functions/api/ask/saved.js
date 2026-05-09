/**
 * GET    /api/ask/saved  — list saved Q&As for authenticated user
 * POST   /api/ask/saved  — save a Q&A
 * DELETE /api/ask/saved  — delete a saved Q&A by id
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession, generateId, checkRateLimit,
} from '../auth/_shared.js';
import { log } from '../_log.js';

const SHARE_BASE = 'https://rrmacademy.org/ask/s/';

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET /api/ask/saved ---
export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const { results } = await db.prepare(
      'SELECT id, question, answer, citations_json, created_at FROM ask_saved WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
    ).bind(session.userId).all();

    const items = results.map(r => {
      let citations = [];
      try { citations = JSON.parse(r.citations_json); } catch { /* leave empty */ }
      return {
        id: r.id,
        question: r.question,
        answer: r.answer,
        citations,
        created_at: r.created_at,
        share_url: SHARE_BASE + r.id,
      };
    });

    return json({ ok: true, items });
  } catch (err) {
    log(env, waitUntil, 'ask', 'saved_get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST /api/ask/saved ---
// Body: { question: string, answer: string, citations?: Array<{url, title}> }
export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const allowed = await checkRateLimit(env, 'ask_save:' + session.userId, 30, 3600);
    if (!allowed) return json({ ok: false, error: 'Rate limit exceeded' }, 429);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { question, answer, citations } = body;

    if (typeof question !== 'string') return json({ ok: false, error: 'question must be a string' }, 400);
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return json({ ok: false, error: 'question is required' }, 400);
    if (trimmedQuestion.length > 500) return json({ ok: false, error: 'question too long (max 500 chars)' }, 400);

    if (typeof answer !== 'string') return json({ ok: false, error: 'answer must be a string' }, 400);
    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) return json({ ok: false, error: 'answer is required' }, 400);
    if (trimmedAnswer.length > 12000) return json({ ok: false, error: 'answer too long (max 12000 chars)' }, 400);

    let validatedCitations = [];
    if (citations !== undefined && citations !== null) {
      if (!Array.isArray(citations)) return json({ ok: false, error: 'citations must be an array' }, 400);
      if (citations.length > 50) return json({ ok: false, error: 'too many citations (max 50)' }, 400);
      validatedCitations = citations
        .filter(c => c && typeof c === 'object')
        .map(c => {
          const out = {};
          if (typeof c.url === 'string') out.url = c.url.slice(0, 2000);
          if (typeof c.title === 'string') out.title = c.title.slice(0, 500);
          return out;
        });
    }

    const citationsJson = JSON.stringify(validatedCitations);
    if (citationsJson.length > 8000) return json({ ok: false, error: 'citations_json too large (max 8000 chars)' }, 400);

    const id = generateId();

    await db.prepare(
      'INSERT INTO ask_saved (id, user_id, question, answer, citations_json) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, session.userId, trimmedQuestion, trimmedAnswer, citationsJson).run();

    return json({ ok: true, id, share_url: SHARE_BASE + id });
  } catch (err) {
    log(env, waitUntil, 'ask', 'saved_post_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- DELETE /api/ask/saved ---
// Body: { id: string }
export async function onRequestDelete({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const session = await validateSession(db, getSessionIdFromCookie(request));
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

    const { id } = body;
    if (!id || typeof id !== 'string') return json({ ok: false, error: 'id required' }, 400);
    if (id.length > 32) return json({ ok: false, error: 'invalid id' }, 400);

    await db.prepare(
      'DELETE FROM ask_saved WHERE id = ? AND user_id = ?'
    ).bind(id, session.userId).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'ask', 'saved_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
