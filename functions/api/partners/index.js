/**
 * GET /api/partners
 * Build-time read endpoint for the Educational Partners public directory.
 * Auth: Bearer LIBRARY_BUILD_TOKEN (same gate as /api/faqs).
 * Returns the PublicPartner subset -- admin-only fields stripped.
 */
import { json, optionsResponse, constantTimeEqual } from '../auth/_shared.js';
import { log } from '../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  if (!env.LIBRARY_BUILD_TOKEN) {
    return json({ error: 'service_unavailable' }, 503);
  }

  if (!env.DB) {
    return json({ error: 'service_unavailable' }, 503);
  }

  const auth = request.headers.get('Authorization');
  if (!constantTimeEqual(auth, `Bearer ${env.LIBRARY_BUILD_TOKEN}`)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let results;
  try {
    const { results: rows } = await env.DB.prepare(
      `SELECT id, name, slug, site_url, country, city, provider_name, provider_credential,
              provider_directory_id, blurb, approved_at
       FROM partners
       WHERE status = 'active' AND tier = 'friend'
       ORDER BY approved_at DESC`
    ).all();
    results = rows || [];
  } catch (err) {
    log(env, waitUntil, 'partners', 'list_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }

  return json({ ok: true, partners: results }, 200, { 'Cache-Control': 'no-store' });
}
