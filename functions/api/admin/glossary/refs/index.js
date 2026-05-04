import { json, optionsResponse } from '../../../auth/_shared.js';
import { log } from '../../../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT ref_num, anchor_text, url, journal, publisher FROM glossary_reference ORDER BY ref_num ASC'
    ).all();

    return json({ ok: true, results: results || [] });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'refs_list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { ref_num, anchor_text, url, journal, publisher } = body;

  let resolvedRefNum;
  if (ref_num === undefined) {
    try {
      const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(ref_num), 0) AS m FROM glossary_reference').first();
      resolvedRefNum = (maxRow?.m ?? 0) + 1;
    } catch (err) {
      log(env, waitUntil, 'admin-glossary', 'ref_num_compute_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }
  } else {
    if (typeof ref_num !== 'number' || !Number.isInteger(ref_num) || ref_num < 1 || ref_num > 10000) {
      return json({ ok: false, error: 'invalid_ref_num' }, 400);
    }
    resolvedRefNum = ref_num;
  }

  if (typeof anchor_text !== 'string' || !anchor_text.trim()) {
    return json({ ok: false, error: 'anchor_text_required' }, 400);
  }
  if (anchor_text.length > 1000) {
    return json({ ok: false, error: 'anchor_text_too_long' }, 400);
  }

  if (typeof url !== 'string' || !url.trim()) {
    return json({ ok: false, error: 'url_required' }, 400);
  }
  if (url.length > 1000) {
    return json({ ok: false, error: 'url_too_long' }, 400);
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return json({ ok: false, error: 'url_invalid_scheme' }, 400);
    }
  } catch {
    return json({ ok: false, error: 'url_malformed' }, 400);
  }

  if (journal !== undefined && typeof journal === 'string' && journal.length > 500) {
    return json({ ok: false, error: 'journal_too_long' }, 400);
  }
  if (publisher !== undefined && typeof publisher === 'string' && publisher.length > 500) {
    return json({ ok: false, error: 'publisher_too_long' }, 400);
  }

  try {
    const row = await env.DB.prepare(
      'INSERT OR IGNORE INTO glossary_reference (ref_num, anchor_text, url, journal, publisher) VALUES (?, ?, ?, ?, ?) RETURNING *'
    ).bind(resolvedRefNum, anchor_text.trim(), url.trim(), journal ?? null, publisher ?? null).first();

    if (!row) {
      return json({ ok: false, error: 'ref_num_already_exists' }, 409);
    }
    return json({ ok: true, data: row, created: true }, 201);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'ref_num_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-glossary', 'ref_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
