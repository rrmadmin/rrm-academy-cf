/**
 * GET /api/admin/partners
 * Admin list endpoint for Educational Partner applications.
 * Requires superadmin session auth.
 *
 * Query params:
 *   ?status=pending|awaiting_payment|active|grace|expired|cancelled|rejected|revoked
 *   (optional; omit for all)
 */
import { json, optionsResponse, requireSuperAdmin } from '../../auth/_shared.js';
import { log } from '../../_log.js';

const VALID_STATUSES = new Set(['pending', 'awaiting_payment', 'active', 'grace', 'expired', 'cancelled', 'rejected', 'revoked']);

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.DB) {
      return json({ error: 'service_unavailable' }, 503);
    }

    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');

    if (statusParam !== null && !VALID_STATUSES.has(statusParam)) {
      return json({ error: 'invalid_status' }, 400);
    }

    let rows;
    try {
      const query = statusParam
        ? `SELECT id, name, slug, site_url, country, city, provider_name, provider_credential,
                  provider_directory_id, blurb, affirmations, contact_email, tier, status,
                  notes, created_at, approved_at, revoked_at
           FROM partners
           WHERE status = ?
           ORDER BY created_at DESC`
        : `SELECT id, name, slug, site_url, country, city, provider_name, provider_credential,
                  provider_directory_id, blurb, affirmations, contact_email, tier, status,
                  notes, created_at, approved_at, revoked_at
           FROM partners
           ORDER BY created_at DESC`;

      const { results } = statusParam
        ? await env.DB.prepare(query).bind(statusParam).all()
        : await env.DB.prepare(query).all();

      rows = results || [];
    } catch (err) {
      log(env, null, 'admin', 'partners_list_error', 'error', err.message, 0, 500);
      return json({ error: 'internal_error' }, 500);
    }

    const partners = rows.map(row => {
      let affirmations = null;
      if (row.affirmations) {
        try {
          affirmations = JSON.parse(row.affirmations);
        } catch {
          affirmations = null;
        }
      }
      return { ...row, affirmations };
    });

    return json({ ok: true, partners }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    log(env, null, 'admin', 'partners_list_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}
