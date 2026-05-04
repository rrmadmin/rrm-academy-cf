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

  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  const RESERVED_SLUGS = new Set([
    'overview', 'abbreviations', 'references', 'key-takeaways',
    'core-rrm-principles', 'fertility-awareness', 'clinical-approaches',
    'diagnostic-tools', 'surgical-techniques', 'conditions',
    'overlapping-disciplines', 'broader-framework',
  ]);
  const trimmedSlug = slug.trim();
  if (!SLUG_RE.test(trimmedSlug)) {
    return json({ ok: false, error: 'invalid_slug_format' }, 400);
  }
  if (trimmedSlug.startsWith('ref-')) {
    return json({ ok: false, error: 'slug_reserved_ref_prefix' }, 400);
  }
  if (RESERVED_SLUGS.has(trimmedSlug)) {
    return json({ ok: false, error: 'slug_reserved' }, 400);
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

  if (typeof body_html !== 'string' || !body_html.trim()) {
    return json({ ok: false, error: 'body_html_required' }, 400);
  }
  if (body_html.length > 200000) {
    return json({ ok: false, error: 'body_html_too_long' }, 400);
  }
  if (abbreviation !== undefined && typeof abbreviation === 'string' && abbreviation.length > 100) {
    return json({ ok: false, error: 'abbreviation_too_long' }, 400);
  }
  if (pillar_link !== undefined && pillar_link !== null && pillar_link !== '') {
    if (typeof pillar_link !== 'string') {
      return json({ ok: false, error: 'pillar_link_invalid_type' }, 400);
    }
    if (!pillar_link.startsWith('/') || pillar_link.startsWith('//')) {
      return json({ ok: false, error: 'pillar_link_must_be_relative' }, 400);
    }
    if (pillar_link.length > 500) {
      return json({ ok: false, error: 'pillar_link_too_long' }, 400);
    }
  }

  const resolvedStatus = status ?? 'draft';
  if (!VALID_STATUSES.has(resolvedStatus)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  if (sort_order !== undefined && (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 10000)) {
    return json({ ok: false, error: 'sort_order_invalid' }, 400);
  }
  const resolvedSortOrder = typeof sort_order === 'number' ? sort_order : 0;
  const id = 'term_' + trimmedSlug.toLowerCase();

  try {
    const row = await env.DB.prepare(
      `INSERT OR IGNORE INTO glossary_term (id, slug, name, part, sort_order, body_html, abbreviation, pillar_link, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(
      id,
      trimmedSlug.toLowerCase(),
      name.trim(),
      part,
      resolvedSortOrder,
      body_html ?? null,
      abbreviation ?? null,
      pillar_link !== undefined && pillar_link !== null && pillar_link !== '' ? pillar_link : null,
      resolvedStatus
    ).first();

    if (!row) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    return json({ ok: true, data: row, created: true }, 201);
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'term_create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
