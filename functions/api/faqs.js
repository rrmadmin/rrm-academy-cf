/**
 * GET /api/faqs - Serve FAQ data from D1.
 *
 * Auth: Bearer LIBRARY_BUILD_TOKEN (build-time fetch only, not public).
 *
 * Query params:
 *   ?id=faq_xxx  - single FAQ by ID (any status, for preview/rebuild)
 *   (none)       - all published FAQs, sorted by sort_order ASC
 */
import { json, optionsResponse } from './auth/_shared.js';
import { log } from './_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.LIBRARY_BUILD_TOKEN) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.LIBRARY_BUILD_TOKEN}`) {
      return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    if (!env.DB) {
      return json({ ok: false, error: 'Server misconfigured' }, 503);
    }

    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (id !== null) {
      if (typeof id !== 'string' || id.length > 100) {
        return json({ ok: false, error: 'Invalid id' }, 400);
      }

      const [row, { results: refs }, { results: resources }] = await Promise.all([
        env.DB.prepare('SELECT * FROM faq WHERE id = ?').bind(id).first(),
        env.DB.prepare('SELECT * FROM faq_library_ref WHERE faq_id = ? ORDER BY sort_order ASC').bind(id).all(),
        env.DB.prepare('SELECT * FROM faq_resource WHERE faq_id = ? ORDER BY sort_order ASC').bind(id).all(),
      ]);

      if (!row) {
        return json({ ok: false, error: 'not_found' }, 404);
      }

      return json({ ok: true, data: mapRow(row, refs || [], resources || []) });
    }

    const { results: rows } = await env.DB.prepare(
      "SELECT * FROM faq WHERE status = 'published' ORDER BY sort_order ASC"
    ).all();

    if (!rows || rows.length === 0) {
      return json({ ok: true, results: [] });
    }

    const faqIds = rows.map(r => r.id);
    const placeholders = faqIds.map(() => '?').join(', ');

    const [{ results: allRefs }, { results: allResources }] = await Promise.all([
      env.DB.prepare(`SELECT * FROM faq_library_ref WHERE faq_id IN (${placeholders}) ORDER BY sort_order ASC`).bind(...faqIds).all(),
      env.DB.prepare(`SELECT * FROM faq_resource WHERE faq_id IN (${placeholders}) ORDER BY sort_order ASC`).bind(...faqIds).all(),
    ]);

    const refsByFaqId = groupById(allRefs || [], 'faq_id');
    const resourcesByFaqId = groupById(allResources || [], 'faq_id');

    const mapped = (rows || []).map(row =>
      mapRow(row, refsByFaqId[row.id] || [], resourcesByFaqId[row.id] || [])
    );

    return json({ ok: true, results: mapped });
  } catch (err) {
    log(env, waitUntil, 'faq', 'list_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
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
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    evidence: (resources || []).map(r => ({ title: r.title, url: r.url, sortOrder: r.sort_order })),
    libraryRefs: (refs || []).map(r => ({ articleId: r.article_id, label: r.label, sortOrder: r.sort_order })),
  };
}
