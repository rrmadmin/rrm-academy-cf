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

  const { title, url, sortOrder } = body;

  if (typeof title !== 'string' || !title.trim()) {
    return json({ ok: false, error: 'title_required' }, 400);
  }
  if (title.length > 500) {
    return json({ ok: false, error: 'title_too_long' }, 400);
  }
  if (typeof url !== 'string' || !url.trim()) {
    return json({ ok: false, error: 'url_required' }, 400);
  }
  if (url.length > 500) {
    return json({ ok: false, error: 'url_too_long' }, 400);
  }

  const resolvedSortOrder = typeof sortOrder === 'number' ? sortOrder : 0;

  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO faq_resource (faq_id, title, url, sort_order) VALUES (?, ?, ?, ?)'
    ).bind(faqId, title.trim(), url.trim(), resolvedSortOrder).run();

    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'resource_add_error', 'error', err.message, 0, 500);
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

  const resourceId = new URL(request.url).searchParams.get('resourceId');
  if (!resourceId || typeof resourceId !== 'string' || resourceId.length > 100) {
    return json({ ok: false, error: 'resourceId_required' }, 400);
  }

  try {
    const result = await env.DB.prepare(
      'DELETE FROM faq_resource WHERE id = ? AND faq_id = ?'
    ).bind(resourceId, faqId).run();

    if (result.meta.changes === 0) {
      return json({ ok: false, error: 'not_found' }, 404);
    }
    return json({ ok: true });
  } catch (err) {
    log(env, waitUntil, 'admin-faq', 'resource_delete_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
