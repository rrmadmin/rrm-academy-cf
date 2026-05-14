import { json, optionsResponse } from '../../../auth/_shared.js';
import { log } from '../../../_log.js';

export function onRequestOptions() {
  return optionsResponse();
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

  const faqId = context.params?.id;
  if (!faqId || typeof faqId !== 'string' || faqId.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ ok: false, error: 'Invalid payload' }, 400);

  const { articleId, label, sortOrder } = body;

  if (typeof articleId !== 'string' || !articleId.trim()) {
    return json({ ok: false, error: 'articleId_required' }, 400);
  }
  if (articleId.length > 100) {
    return json({ ok: false, error: 'articleId_too_long' }, 400);
  }

  const resolvedSortOrder = typeof sortOrder === 'number' ? sortOrder : 0;

  try {
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO faq_library_ref (faq_id, article_id, label, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(faqId, articleId.trim(), label ?? null, resolvedSortOrder).run();

    const status = result.meta.changes > 0 ? 201 : 200;
    return json({ ok: true, created: result.meta.changes > 0 }, status);
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'library_ref_add_error', 'error', err.message, 0, 500);
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

  const faqId = context.params?.id;
  if (!faqId || typeof faqId !== 'string' || faqId.length > 100) {
    return json({ ok: false, error: 'Invalid id' }, 400);
  }

  const articleId = new URL(request.url).searchParams.get('articleId');
  if (!articleId || typeof articleId !== 'string' || articleId.length > 100) {
    return json({ ok: false, error: 'articleId_required' }, 400);
  }

  try {
    const result = await env.DB.prepare(
      'DELETE FROM faq_library_ref WHERE faq_id = ? AND article_id = ?'
    ).bind(faqId, articleId).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'library_ref_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
