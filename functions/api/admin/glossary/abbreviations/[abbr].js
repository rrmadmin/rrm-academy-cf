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

  const abbr = context.params?.abbr;
  if (!abbr || typeof abbr !== 'string' || abbr.length > 100) {
    return json({ ok: false, error: 'Invalid abbr' }, 400);
  }

  const decoded = decodeURIComponent(abbr);

  try {
    const row = await env.DB.prepare(
      'SELECT * FROM glossary_abbreviation WHERE abbreviation = ? COLLATE NOCASE'
    ).bind(decoded).first();

    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, data: row });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'abbr_get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const abbr = context.params?.abbr;
  if (!abbr || typeof abbr !== 'string' || abbr.length > 100) {
    return json({ ok: false, error: 'Invalid abbr' }, 400);
  }

  const decoded = decodeURIComponent(abbr);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const FIELD_MAP = {
    full_term: 'full_term',
    term_slug: 'term_slug',
    sort_order: 'sort_order',
  };

  const KNOWN_KEYS = new Set(Object.keys(FIELD_MAP));
  const unknown = Object.keys(body).filter(k => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) {
    return json({ ok: false, error: 'unknown_fields', detail: { unknown } }, 400);
  }

  if (body.full_term !== undefined) {
    if (typeof body.full_term !== 'string' || !body.full_term.trim()) {
      return json({ ok: false, error: 'full_term_required' }, 400);
    }
    if (body.full_term.length > 500) {
      return json({ ok: false, error: 'full_term_too_long' }, 400);
    }
  }
  if (body.term_slug !== undefined && body.term_slug !== null && typeof body.term_slug === 'string' && body.term_slug.length > 100) {
    return json({ ok: false, error: 'term_slug_too_long' }, 400);
  }
  if (body.sort_order !== undefined && (!Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 10000)) {
    return json({ ok: false, error: 'sort_order_invalid' }, 400);
  }

  const normalizedTermSlug = body.term_slug !== undefined
    ? ((typeof body.term_slug === 'string' && body.term_slug.trim()) ? body.term_slug.trim() : null)
    : undefined;

  if (normalizedTermSlug !== undefined && normalizedTermSlug !== null) {
    try {
      const exists = await env.DB.prepare(
        'SELECT 1 FROM glossary_term WHERE slug = ? COLLATE NOCASE'
      ).bind(normalizedTermSlug).first();
      if (!exists) return json({ ok: false, error: 'term_slug_not_found' }, 400);
    } catch (err) {
      log(env, waitUntil, 'admin-glossary', 'abbr_term_slug_check_error', 'error', err.message, 0, 500);
      return json({ ok: false, error: 'Internal error' }, 500);
    }
  }

  const setClauses = [];
  const bindings = [];

  for (const [bodyKey, colName] of Object.entries(FIELD_MAP)) {
    if (body[bodyKey] !== undefined) {
      const value = bodyKey === 'term_slug' ? normalizedTermSlug : body[bodyKey];
      setClauses.push(`${colName} = ?`);
      bindings.push(value);
    }
  }

  if (setClauses.length === 0) {
    return json({ ok: false, error: 'no_fields_provided' }, 400);
  }

  bindings.push(decoded);

  try {
    const result = await env.DB.prepare(
      `UPDATE glossary_abbreviation SET ${setClauses.join(', ')} WHERE abbreviation = ? COLLATE NOCASE`
    ).bind(...bindings).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    const row = await env.DB.prepare(
      'SELECT * FROM glossary_abbreviation WHERE abbreviation = ? COLLATE NOCASE'
    ).bind(decoded).first();
    return json({ ok: true, data: row });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'abbr_update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const abbr = context.params?.abbr;
  if (!abbr || typeof abbr !== 'string' || abbr.length > 100) {
    return json({ ok: false, error: 'Invalid abbr' }, 400);
  }

  const decoded = decodeURIComponent(abbr);

  try {
    const result = await env.DB.prepare(
      'DELETE FROM glossary_abbreviation WHERE abbreviation = ? COLLATE NOCASE'
    ).bind(decoded).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'abbr_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
