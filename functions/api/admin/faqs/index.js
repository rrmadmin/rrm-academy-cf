import { json, optionsResponse, generateId } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_CATEGORIES = new Set(['Foundational', 'Condition-Specific', 'Common Concerns']);
const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

export function onRequestOptions() {
  return optionsResponse();
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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
    const { results: rows } = await env.DB.prepare(
      'SELECT * FROM faq ORDER BY sort_order ASC'
    ).all();

    const { results: allRefs } = await env.DB.prepare(
      'SELECT * FROM faq_library_ref ORDER BY sort_order ASC'
    ).all();

    const { results: allResources } = await env.DB.prepare(
      'SELECT * FROM faq_resource ORDER BY sort_order ASC'
    ).all();

    const refsByFaqId = groupById(allRefs || [], 'faq_id');
    const resourcesByFaqId = groupById(allResources || [], 'faq_id');

    const mapped = (rows || []).map(row =>
      mapRow(row, refsByFaqId[row.id] || [], resourcesByFaqId[row.id] || [])
    );

    return json({ ok: true, results: mapped });
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'list_error', 'error', err.message, 0, 500);
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

  const { question, category, basicAnswer, schemaAnswer, publishedAnswer, seoTitle, seoDescription, sortOrder, status, faqCode } = body;

  if (typeof question !== 'string' || !question.trim()) {
    return json({ ok: false, error: 'question_required' }, 400);
  }
  if (question.length > 500) {
    return json({ ok: false, error: 'question_too_long' }, 400);
  }

  if (basicAnswer !== undefined && typeof basicAnswer === 'string' && basicAnswer.length > 50000) {
    return json({ ok: false, error: 'basicAnswer_too_long' }, 400);
  }
  if (schemaAnswer !== undefined && typeof schemaAnswer === 'string' && schemaAnswer.length > 5000) {
    return json({ ok: false, error: 'schemaAnswer_too_long' }, 400);
  }
  if (publishedAnswer !== undefined && typeof publishedAnswer === 'string' && publishedAnswer.length > 100000) {
    return json({ ok: false, error: 'publishedAnswer_too_long' }, 400);
  }
  if (seoTitle !== undefined && typeof seoTitle === 'string' && seoTitle.length > 200) {
    return json({ ok: false, error: 'seoTitle_too_long' }, 400);
  }
  if (seoDescription !== undefined && typeof seoDescription === 'string' && seoDescription.length > 500) {
    return json({ ok: false, error: 'seoDescription_too_long' }, 400);
  }
  if (body.faqCode !== undefined && typeof body.faqCode === 'string' && body.faqCode.length > 50) {
    return json({ ok: false, error: 'faqCode_too_long' }, 400);
  }

  if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) {
    return json({ ok: false, error: 'invalid_category' }, 400);
  }

  const resolvedStatus = status ?? 'draft';
  if (!VALID_STATUSES.has(resolvedStatus)) {
    return json({ ok: false, error: 'invalid_status' }, 400);
  }

  const id = 'faq_' + generateId();
  const slug = slugify(question.trim());
  const resolvedSortOrder = typeof sortOrder === 'number' ? sortOrder : 0;

  try {
    await env.DB.prepare(
      `INSERT INTO faq (id, faq_code, slug, question, basic_answer, schema_answer, published_answer, category, seo_title, seo_description, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      faqCode ?? null,
      slug,
      question.trim(),
      basicAnswer ?? null,
      schemaAnswer ?? null,
      publishedAnswer ?? null,
      category,
      seoTitle ?? null,
      seoDescription ?? null,
      resolvedSortOrder,
      resolvedStatus
    ).run();
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return json({ ok: false, error: 'slug_already_exists' }, 409);
    }
    log(env, waitUntil, 'admin-faq', 'create_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }

  try {
    const row = await env.DB.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first();
    return json({ ok: true, data: mapRow(row, [], []) }, 201);
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'create_fetch_error', 'error', err.message, 0, 500);
    return json({ ok: true, data: { id, slug, question: question.trim(), category, status: resolvedStatus } }, 201);
  }
}
