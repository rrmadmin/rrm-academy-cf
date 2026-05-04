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

  const refnum = context.params?.refnum;
  const parsed = parseInt(refnum, 10);
  if (!refnum || isNaN(parsed) || parsed < 1) {
    return json({ ok: false, error: 'Invalid refnum' }, 400);
  }

  try {
    const row = await env.DB.prepare(
      'SELECT * FROM glossary_reference WHERE ref_num = ?'
    ).bind(parsed).first();

    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, data: row });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'ref_get_error', 'error', err.message, 0, 500);
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

  const refnum = context.params?.refnum;
  const parsed = parseInt(refnum, 10);
  if (!refnum || isNaN(parsed) || parsed < 1) {
    return json({ ok: false, error: 'Invalid refnum' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (body.anchor_text !== undefined) {
    if (typeof body.anchor_text !== 'string' || !body.anchor_text.trim()) {
      return json({ ok: false, error: 'anchor_text_required' }, 400);
    }
    if (body.anchor_text.length > 1000) {
      return json({ ok: false, error: 'anchor_text_too_long' }, 400);
    }
  }
  if (body.url !== undefined) {
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return json({ ok: false, error: 'url_required' }, 400);
    }
    if (body.url.length > 1000) {
      return json({ ok: false, error: 'url_too_long' }, 400);
    }
  }
  if (body.journal !== undefined && typeof body.journal === 'string' && body.journal.length > 500) {
    return json({ ok: false, error: 'journal_too_long' }, 400);
  }
  if (body.publisher !== undefined && typeof body.publisher === 'string' && body.publisher.length > 500) {
    return json({ ok: false, error: 'publisher_too_long' }, 400);
  }

  const FIELD_MAP = {
    anchor_text: 'anchor_text',
    url: 'url',
    journal: 'journal',
    publisher: 'publisher',
  };

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

  bindings.push(parsed);

  try {
    const result = await env.DB.prepare(
      `UPDATE glossary_reference SET ${setClauses.join(', ')} WHERE ref_num = ?`
    ).bind(...bindings).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    const row = await env.DB.prepare('SELECT * FROM glossary_reference WHERE ref_num = ?').bind(parsed).first();
    return json({ ok: true, data: row });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'ref_update_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env, waitUntil } = context;

  const user = context.data?.user;
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const refnum = context.params?.refnum;
  const parsed = parseInt(refnum, 10);
  if (!refnum || isNaN(parsed) || parsed < 1) {
    return json({ ok: false, error: 'Invalid refnum' }, 400);
  }

  try {
    const existing = await env.DB.prepare(
      'SELECT ref_num FROM glossary_reference WHERE ref_num = ?'
    ).bind(parsed).first();

    if (!existing) return json({ ok: false, error: 'not_found' }, 404);

    const pattern1 = `%#ref-${parsed}"%`;
    const pattern2 = `%#ref-${parsed}'%`;
    const { results: citing } = await env.DB.prepare(
      "SELECT slug FROM glossary_term WHERE body_html LIKE ?1 OR body_html LIKE ?2"
    ).bind(pattern1, pattern2).all();

    if (citing && citing.length > 0) {
      return json({
        ok: false,
        error: 'ref_in_use',
        detail: { citing_slugs: citing.map(r => r.slug) },
      }, 409);
    }

    await env.DB.prepare('DELETE FROM glossary_reference WHERE ref_num = ?').bind(parsed).run();
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-glossary', 'ref_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
