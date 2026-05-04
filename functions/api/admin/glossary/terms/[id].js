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

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 150) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  try {
    const row = await env.DB.prepare('SELECT * FROM glossary_term WHERE id = ?').bind(id).first();
    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, data: row });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'term_get_error', 'error', err.message, 0, 500);
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

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 150) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (body.slug !== undefined) {
    return json({ ok: false, error: 'slug_immutable_use_recreate' }, 400);
  }

  const FIELD_MAP = {
    name: 'name',
    part: 'part',
    sort_order: 'sort_order',
    body_html: 'body_html',
    abbreviation: 'abbreviation',
    pillar_link: 'pillar_link',
    status: 'status',
  };

  const KNOWN_KEYS = new Set([...Object.keys(FIELD_MAP), 'slug']);
  const unknown = Object.keys(body).filter(k => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) {
    return json({ ok: false, error: 'unknown_fields', detail: { unknown } }, 400);
  }

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return json({ ok: false, error: 'name_required' }, 400);
    }
    if (body.name.length > 300) {
      return json({ ok: false, error: 'name_too_long' }, 400);
    }
  }
  if (body.part !== undefined && !VALID_PARTS.has(body.part)) {
    return json({ ok: false, error: 'invalid_part' }, 400);
  }
  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }
  if (body.body_html !== undefined) {
    if (typeof body.body_html !== 'string' || !body.body_html.trim()) {
      return json({ ok: false, error: 'body_html_required' }, 400);
    }
    if (body.body_html.length > 200000) {
      return json({ ok: false, error: 'body_html_too_long' }, 400);
    }
  }
  if (body.abbreviation !== undefined && typeof body.abbreviation === 'string' && body.abbreviation.length > 100) {
    return json({ ok: false, error: 'abbreviation_too_long' }, 400);
  }
  if (body.pillar_link !== undefined && body.pillar_link !== null && body.pillar_link !== '') {
    if (typeof body.pillar_link !== 'string') {
      return json({ ok: false, error: 'pillar_link_invalid_type' }, 400);
    }
    if (!body.pillar_link.startsWith('/') || body.pillar_link.startsWith('//')) {
      return json({ ok: false, error: 'pillar_link_must_be_relative' }, 400);
    }
    if (body.pillar_link.length > 500) {
      return json({ ok: false, error: 'pillar_link_too_long' }, 400);
    }
  }
  if (body.sort_order !== undefined && (!Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 10000)) {
    return json({ ok: false, error: 'sort_order_invalid' }, 400);
  }

  const setClauses = [];
  const bindings = [];

  for (const [bodyKey, colName] of Object.entries(FIELD_MAP)) {
    if (body[bodyKey] !== undefined) {
      setClauses.push(`${colName} = ?`);
      bindings.push(body[bodyKey]);
    }
  }

  if (setClauses.length === 0) {
    return json({ ok: false, error: 'no_fields_provided' }, 400);
  }

  setClauses.push("updated_at = datetime('now')");
  bindings.push(id);

  try {
    const result = await env.DB.prepare(
      `UPDATE glossary_term SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    const row = await env.DB.prepare('SELECT * FROM glossary_term WHERE id = ?').bind(id).first();
    return json({ ok: true, data: row });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'term_update_error', 'error', err.message, 0, 500);
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

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 150) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  try {
    const existing = await env.DB.prepare('SELECT id, slug FROM glossary_term WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'not_found' }, 404);

    const citePattern1 = `%href="#${existing.slug}"%`;
    const citePattern2 = `%href='#${existing.slug}'%`;
    const { results: citing } = await env.DB.prepare(
      "SELECT slug FROM glossary_term WHERE id != ? AND (body_html LIKE ?2 OR body_html LIKE ?3)"
    ).bind(id, citePattern1, citePattern2).all();
    if (citing && citing.length > 0) {
      return json({ ok: false, error: 'term_in_use', detail: { citing_slugs: citing.map(r => r.slug) } }, 409);
    }

    await env.DB.batch([
      env.DB.prepare('UPDATE glossary_abbreviation SET term_slug = NULL WHERE term_slug = ? COLLATE NOCASE').bind(existing.slug),
      env.DB.prepare('DELETE FROM glossary_term WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'term_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
