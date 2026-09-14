// zz-ask-eval-delete-me: unmetered eval path for the /ask review. Mirrors the v2
// branch of functions/api/ask.js exactly (same prompt, same upstream call, same
// archive row) minus session, rate limit and SSE. Bearer-guarded; delete when
// the review closes.
import { SYSTEM_PROMPT } from '../../../functions/api/_ask_prompt.js';

const FALLBACK = "I don't have information from the RRM Library that directly addresses this question. Try rephrasing, or browse [/library/](https://rrmacademy.org/library/) for related research.";

async function sha16(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/ask') return json({ error: 'not_found' }, 404);
    if (!env.EVAL_TOKEN || !env.AI_SEARCH_WORKER_AUTH) return json({ error: 'misconfigured' }, 503);
    const auth = request.headers.get('authorization') || '';
    if (!timingSafeEqual(auth, `Bearer ${env.EVAL_TOKEN}`)) return json({ error: 'unauthorized' }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 500) : '';
    const tag = typeof body?.tag === 'string' ? body.tag.slice(0, 64) : null;
    if (!message) return json({ error: 'empty_message' }, 400);

    const start = Date.now();
    let upstream;
    try {
      upstream = await env.AI_SEARCH.fetch('https://internal/ask', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.AI_SEARCH_WORKER_AUTH}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, editorialPrompt: SYSTEM_PROMPT }),
        signal: AbortSignal.timeout(28000),
      });
    } catch (e) {
      return json({ error: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'upstream_timeout' : 'upstream_error', detail: e.message }, 504);
    }
    if (!upstream.ok) return json({ error: 'upstream_error', status: upstream.status }, 502);
    let data;
    try { data = await upstream.json(); } catch { return json({ error: 'upstream_parse' }, 502); }
    if (typeof data?.answer !== 'string') return json({ error: 'upstream_no_answer' }, 502);

    const model = data.model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
    const fallback = data.answer.length === 0;
    const answer = fallback ? FALLBACK : data.answer;
    const citations = Array.isArray(data.citations)
      ? data.citations.filter(c => c && typeof c.url === 'string').map(c => (c.title ? { url: c.url, title: c.title } : { url: c.url }))
      : [];
    const usage = data.usage || null;
    const duration_ms = Date.now() - start;

    let ask_answer_id = null, archive_error = null;
    try {
      const r = await env.ANALYTICS_DB.prepare(
        `INSERT INTO ask_answer
           (search_log_id, source, query, answer, citations_json, fallback, model, prompt_hash, tokens_in, tokens_out, duration_ms, user_id, ip_hash, eval_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(null, 'eval', message, answer, JSON.stringify(citations), fallback ? 1 : 0, model, await sha16(SYSTEM_PROMPT),
        usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, duration_ms, null, null, tag).run();
      ask_answer_id = r?.meta?.last_row_id ?? null;
    } catch (e) { archive_error = String(e?.message || e); }

    return json({ answer, citations, fallback, model, usage, duration_ms, retrieved_chunks_count: data.retrieved_chunks_count ?? null, ask_answer_id, archive_error });
  },
};
