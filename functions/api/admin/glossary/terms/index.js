import { json, optionsResponse } from '../../../auth/_shared.js';
import { log } from '../../../_log.js';

const VALID_PARTS = new Set(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']);
const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

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
      'SELECT id, slug, name, part, sort_order, status FROM glossary_term ORDER BY part ASC, sort_order ASC'
    ).all();

    return json({ ok: true, results: results || [] });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'terms_list_error', 'error', err.message, 0, 500);
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

  const { slug, name, part, sort_order, body_html, abbreviation, pillar_link, status } = body;

  if (typeof slug !== 'string' || !slug.trim()) {
    return json({ ok: false, error: 'slug_required' }, 400);
  }
  if (slug.length > 100) {
    return json({ ok: false, error: 'slug_too_long' }, 400);
  }

  if (typeof name !== 'string' || !name.trim()) {
    return json({ ok: false, error: 'name_required' }, 400);
  }
  if (name.length > 300) {
    return json({ ok: false, error: 'name_too_long' }, 400);
  }

  if (typeof part !== 'string' || !VALID_PARTS.has(part)) {
    return json({ ok: false, error: 'invalid_part' }, 400);
  }

  if (body_html !== undefined && typeof body_html === 'string' && body_html.length > 200000) {
    return json({ ok: false, error: 'body_html_too_long' }, 400);
  }
  if (abbreviation !== undefined && typeof abbreviation === 'string' && abbreviation.length > 100) {
    return json({ ok: false, error: 'abbreviation_too_long' }, 400);
  }
  if (pillar_link !== undefined && typeof pillar_link === 'string' && pillar_link.length > 500) {
    return json({ ok: false, error: 'pillar_link_too_long' }, 400);
  }

  const resolvedStatus = status ?? 'draft';
  if (!VALID_STATUSES.has(resolvedStatus)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  const resolvedSortOrder = typeof sort_order === 'number' ? sort_order : 0;
  const id = 'term_' + slug.trim();

  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO glossary_term (id, slug, name, part, sort_order, body_html, abbreviation, pillar_link, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      slug.trim(),
      name.trim(),
      part,
      resolvedSortOrder,
      body_html ?? null,
      abbreviation ?? null,
      pillar_link ?? null,
      resolvedStatus
    ).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'term_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  try {
    const row = await env.DB.prepare('SELECT * FROM glossary_term WHERE id = ?').bind(id).first();
    return json({ ok: true, data: row, created: true }, 201);
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'term_create_fetch_error', 'error', err.message, 0, 500);
    return json({ ok: true, data: { id, slug: slug.trim(), name: name.trim(), part, status: resolvedStatus }, created: true }, 201);
  }
}
