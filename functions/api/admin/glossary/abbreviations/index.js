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
      'SELECT abbreviation, full_term, term_slug, sort_order FROM glossary_abbreviation ORDER BY sort_order ASC'
    ).all();

    return json({ ok: true, results: results || [] });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'abbrs_list_error', 'error', err.message, 0, 500);
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

  const { abbreviation, full_term, term_slug, sort_order } = body;

  if (typeof abbreviation !== 'string' || !abbreviation.trim()) {
    return json({ ok: false, error: 'abbreviation_required' }, 400);
  }
  if (abbreviation.length > 100) {
    return json({ ok: false, error: 'abbreviation_too_long' }, 400);
  }

  if (typeof full_term !== 'string' || !full_term.trim()) {
    return json({ ok: false, error: 'full_term_required' }, 400);
  }
  if (full_term.length > 500) {
    return json({ ok: false, error: 'full_term_too_long' }, 400);
  }

  if (term_slug !== undefined && term_slug !== null && typeof term_slug === 'string' && term_slug.length > 100) {
    return json({ ok: false, error: 'term_slug_too_long' }, 400);
  }

  if (sort_order !== undefined && (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 10000)) {
    return json({ ok: false, error: 'sort_order_invalid' }, 400);
  }
  const resolvedSortOrder = typeof sort_order === 'number' ? sort_order : 0;

  const normalizedTermSlug = (typeof term_slug === 'string' && term_slug.trim()) ? term_slug.trim() : null;
  if (normalizedTermSlug !== null) {
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

  try {
    const row = await env.DB.prepare(
      'INSERT OR IGNORE INTO glossary_abbreviation (abbreviation, full_term, term_slug, sort_order) VALUES (?, ?, ?, ?) RETURNING *'
    ).bind(abbreviation.trim(), full_term.trim(), normalizedTermSlug, resolvedSortOrder).first();

    if (!row) {
      return json({ ok: false, error: 'abbreviation_already_exists' }, 409);
    }
    return json({ ok: true, data: row, created: true }, 201);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'abbreviation_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-glossary', 'abbr_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
