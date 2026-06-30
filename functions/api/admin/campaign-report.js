/**
 * GET /api/admin/campaign-report?campaign=event-broadcast
 *
 * Admin-only. Calls the fingerprint worker's HMAC-authed /report/campaign for
 * the cohort of visitors who arrived via a given utm_campaign, then resolves
 * each linked account (user_id) to a member name/email from rrm-auth. Returns
 * the cohort with their entry event + recent on-site page activity.
 *
 * Signing mirrors functions/api/_fp-link.js (LINK_HMAC_KEY_CURRENT, signs
 * `${ts}.${rawBody}`, header X-RRM-Signature: t=<ts>,v1=<hex>).
 */
import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';

const FP_REPORT_URL = 'https://fp.rrmacademy.org/report/campaign';

async function hmacSha256Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    // Session-based admin auth (returns a Response when unauthorized).
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.LINK_HMAC_KEY_CURRENT) {
      return json({ ok: false, error: 'Reporting not configured' }, 503);
    }

    const url = new URL(request.url);
    const campaign = (url.searchParams.get('campaign') || 'event-broadcast').trim().slice(0, 128);
    if (!campaign) return json({ ok: false, error: 'campaign required' }, 400);

    // Signed server-to-server call to the fingerprint worker.
    const ts = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ campaign });
    const mac = await hmacSha256Hex(env.LINK_HMAC_KEY_CURRENT, `${ts}.${rawBody}`);

    let fpData;
    try {
      const res = await fetch(FP_REPORT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RRM-Signature': `t=${ts},v1=${mac}`,
        },
        body: rawBody,
      });
      if (!res.ok) return json({ ok: false, error: `report service ${res.status}` }, 502);
      fpData = await res.json();
    } catch {
      return json({ ok: false, error: 'report service unreachable' }, 502);
    }
    if (!fpData || !fpData.ok) return json({ ok: false, error: 'report service error' }, 502);

    const cohort = Array.isArray(fpData.cohort) ? fpData.cohort : [];

    // Resolve linked user_ids -> member name/email (rrm-auth `user`).
    const userIds = [...new Set(cohort.map(c => c.user_id).filter(Boolean))];
    const memberById = {};
    if (userIds.length) {
      const ph = userIds.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT id, name, email FROM user WHERE id IN (${ph})`,
      ).bind(...userIds).all();
      for (const r of (rows.results || [])) {
        memberById[r.id] = { name: r.name || null, email: r.email || null };
      }
    }

    const enriched = cohort.map(c => ({
      visitor_id: c.visitor_id,
      user_id: c.user_id || null,
      member: c.user_id ? (memberById[c.user_id] || { name: null, email: null }) : null,
      arrival_ts: c.arrival_ts,
      entry_path: c.entry_path,
      referrer: c.referrer || null,
      utm_source: c.utm_source || null,
      utm_medium: c.utm_medium || null,
      page_count: c.page_count || 0,
      pages: Array.isArray(c.pages) ? c.pages : [],
    }));

    const linkedCount = enriched.filter(c => c.member).length;

    return json({
      ok: true,
      campaign,
      total: fpData.total || enriched.length,
      linked: linkedCount,
      truncated: !!fpData.truncated,
      cohort: enriched,
    });
  } catch {
    return json({ ok: false, error: 'internal error' }, 500);
  }
}
