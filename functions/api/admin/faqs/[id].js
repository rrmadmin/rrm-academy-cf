import { json, optionsResponse } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_CATEGORIES = new Set(['Foundational', 'Condition-Specific', 'Common Concerns']);
const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

function slugify(text) {
  return text.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function onRequestOptions() {
  return optionsResponse();
}

function groupById(rows, key) {
  const map = {};
  for (const row of rows) {
    const k = row[key];
    if (!map[k]) map[k] = [];
    map[k].push(row);
  }
  return map;
}

function mapRow(r, refs, resources) {
  return {
    id: r.id,
    faqId: r.faq_code,
    slug: r.slug,
    question: r.question,
    basicAnswer: r.basic_answer,
    schemaAnswer: r.schema_answer,
    publishedAnswer: r.published_answer,
    category: r.category,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    sortOrder: r.sort_order,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    evidence: (resources || []).map(r => ({ id: r.id, title: r.title, url: r.url, sortOrder: r.sort_order })),
    libraryRefs: (refs || []).map(r => ({ articleId: r.article_id, label: r.label, sortOrder: r.sort_order })),
  };
}

async function fetchWithRefs(db, id) {
  const [row, { results: refs }, { results: resources }] = await Promise.all([
    db.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first(),
    db.prepare('SELECT * FROM faq_library_ref WHERE faq_id = ? ORDER BY sort_order ASC').bind(id).all(),
    db.prepare('SELECT * FROM faq_resource WHERE faq_id = ? ORDER BY sort_order ASC').bind(id).all(),
  ]);

  if (!row) return null;
  return mapRow(row, refs || [], resources || []);
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
  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  try {
    const data = await fetchWithRefs(env.DB, id);
    if (!data) return json({ ok: false, error: 'not_found' }, 404);
    return json({ ok: true, data });
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'get_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env, waitUntil } = context;

  const authHeader = request.headers.get('Authorization') || '';
  let bearerAuthed = false;

  if (authHeader.startsWith('Bearer ')) {
    if (!env.ADMIN_API_SECRET) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }
    const expected = `Bearer ${env.ADMIN_API_SECRET}`;
    const authBytes = new TextEncoder().encode(authHeader);
    const expectedBytes = new TextEncoder().encode(expected);
    let mismatch = authBytes.length !== expectedBytes.length ? 1 : 0;
    const len = Math.min(authBytes.length, expectedBytes.length);
    for (let i = 0; i < len; i++) {
      mismatch |= authBytes[i] ^ expectedBytes[i];
    }
    if (mismatch !== 0) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }
    bearerAuthed = true;
  }

  if (!bearerAuthed) {
    const user = context.data?.user;
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    if (user.role !== 'superadmin' && user.role !== 'admin') {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
  }

  if (!env.DB) {
    return json({ ok: false, error: 'Server misconfigured' }, 503);
  }

  const id = context.params?.id;
  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const FIELD_MAP = {
    question: 'question',
    category: 'category',
    basicAnswer: 'basic_answer',
    schemaAnswer: 'schema_answer',
    publishedAnswer: 'published_answer',
    seoTitle: 'seo_title',
    seoDescription: 'seo_description',
    sortOrder: 'sort_order',
    status: 'status',
    faqCode: 'faq_code',
  };

  if (body.basicAnswer !== undefined && typeof body.basicAnswer === 'string' && body.basicAnswer.length > 50000) {
    return json({ ok: false, error: 'basicAnswer_too_long' }, 400);
  }
  if (body.schemaAnswer !== undefined && typeof body.schemaAnswer === 'string' && body.schemaAnswer.length > 5000) {
    return json({ ok: false, error: 'schemaAnswer_too_long' }, 400);
  }
  if (body.publishedAnswer !== undefined && typeof body.publishedAnswer === 'string' && body.publishedAnswer.length > 100000) {
    return json({ ok: false, error: 'publishedAnswer_too_long' }, 400);
  }
  if (body.seoTitle !== undefined && typeof body.seoTitle === 'string' && body.seoTitle.length > 200) {
    return json({ ok: false, error: 'seoTitle_too_long' }, 400);
  }
  if (body.seoDescription !== undefined && typeof body.seoDescription === 'string' && body.seoDescription.length > 500) {
    return json({ ok: false, error: 'seoDescription_too_long' }, 400);
  }
  if (body.faqCode !== undefined && typeof body.faqCode === 'string' && body.faqCode.length > 50) {
    return json({ ok: false, error: 'faqCode_too_long' }, 400);
  }
  if (body.category !== undefined && !VALID_CATEGORIES.has(body.category)) {
    return json({ ok: false, error: 'invalid_category' }, 400);
  }
  if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }
  if (body.question !== undefined) {
    if (typeof body.question !== 'string' || !body.question.trim()) {
      return json({ ok: false, error: 'question_required' }, 400);
    }
    if (body.question.length > 500) {
      return json({ ok: false, error: 'question_too_long' }, 400);
    }
  }

  const setClauses = [];
  const bindings = [];

  for (const [bodyKey, colName] of Object.entries(FIELD_MAP)) {
    if (body[bodyKey] !== undefined) {
      setClauses.push(`${colName} = ?`);
      bindings.push(body[bodyKey]);
    }
  }

  if (body.question !== undefined && typeof body.question === 'string') {
    setClauses.push('slug = ?');
    bindings.push(slugify(body.question.trim()));
  }

  if (setClauses.length === 0) {
    return json({ ok: false, error: 'no_fields_provided' }, 400);
  }

  setClauses.push("updated_at = datetime('now')");
  bindings.push(id);

  try {
    const result = await env.DB.prepare(
      `UPDATE faq SET ${setClauses.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }

    const data = await fetchWithRefs(env.DB, id);
    return json({ ok: true, data });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-faq', 'update_error', 'error', err.message, 0, 500);
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
  if (!id || typeof id !== 'string' || id.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  try {
    const existing = await env.DB.prepare('SELECT id FROM faq WHERE id = ?').bind(id).first();
    if (!existing) return json({ ok: false, error: 'not_found' }, 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM faq_library_ref WHERE faq_id = ?').bind(id),
      env.DB.prepare('DELETE FROM faq_resource WHERE faq_id = ?').bind(id),
      env.DB.prepare('DELETE FROM faq WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
