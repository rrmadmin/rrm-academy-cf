/**
 * GET /api/admin/content
 * Returns content performance metrics from GA4 for the admin dashboard.
 * Requires superadmin session auth.
 *
 * Query params:
 *   ?period=7d|28d|90d (default: 28d)
 */
import { json, requireSuperAdmin } from '../auth/_shared.js';

const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_TTL = 3600;

export async function onRequestGet({ request, env }) {
  try {
    // Session-based admin auth
    const auth = await requireSuperAdmin(request, env.DB);
    if (auth instanceof Response) return auth;

    if (!env.GA4_OAUTH_CREDS || !env.GA4_PROPERTY_ID) {
      return json({ ok: false, error: 'GA4 not configured' }, 500);
    }

    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '28d';
    const periodMap = { '7d': '7daysAgo', '28d': '28daysAgo', '90d': '90daysAgo' };
    const startDate = periodMap[period] || '28daysAgo';

    const cacheKey = `admin:content:${period}`;
    if (env.COMMUNITY_KV) {
      const cached = await env.COMMUNITY_KV.get(cacheKey, 'json');
      if (cached) return json({ ok: true, data: cached, cached: true });
    }

    const accessToken = await getAccessToken(env);
    const propertyId = env.GA4_PROPERTY_ID;

    const [topPages, topReferrers, overview] = await Promise.all([
      runReport(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'averageSessionDuration' }],
        dimensions: [{ name: 'pagePath' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 30,
      }),
      runReport(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        dimensions: [{ name: 'sessionSource' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      }),
      runReport(accessToken, propertyId, {
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
      }),
    ]);

    // Parse overview
    const ov = overview.rows?.[0]?.metricValues || [];
    const summaryMetrics = {
      pageViews: parseInt(ov[0]?.value || '0', 10),
      users: parseInt(ov[1]?.value || '0', 10),
      sessions: parseInt(ov[2]?.value || '0', 10),
      avgSessionDuration: parseFloat(ov[3]?.value || '0'),
      bounceRate: parseFloat(ov[4]?.value || '0'),
    };

    // Parse top pages
    const pages = (topPages.rows || []).map(row => ({
      path: row.dimensionValues[0].value,
      views: parseInt(row.metricValues[0].value, 10),
      users: parseInt(row.metricValues[1].value, 10),
      avgDuration: parseFloat(row.metricValues[2].value),
    }));

    // Categorize pages
    const categories = { library: 0, courses: 0, community: 0, blog: 0, other: 0 };
    for (const p of pages) {
      if (p.path.startsWith('/library/')) categories.library += p.views;
      else if (p.path.startsWith('/courses/')) categories.courses += p.views;
      else if (p.path.startsWith('/community/')) categories.community += p.views;
      else if (p.path.startsWith('/commentary/') || p.path.startsWith('/blog/')) categories.blog += p.views;
      else categories.other += p.views;
    }

    // Parse referrers
    const referrers = (topReferrers.rows || []).map(row => ({
      source: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value, 10),
      users: parseInt(row.metricValues[1].value, 10),
    }));

    const report = {
      summary: summaryMetrics,
      categories,
      pages,
      referrers,
      fetchedAt: new Date().toISOString(),
    };

    if (env.COMMUNITY_KV) {
      await env.COMMUNITY_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: CACHE_TTL });
    }

    return json({ ok: true, data: report, cached: false });
  } catch (err) {
    console.error('Content API error:', err.message);
    return json({ ok: false, error: 'Failed to fetch content data' }, 502);
  }
}

async function getAccessToken(env) {
  const creds = JSON.parse(env.GA4_OAUTH_CREDS);
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
  const data = await resp.json();
  return data.access_token;
}

async function runReport(accessToken, propertyId, body) {
  const resp = await fetch(`${GA4_DATA_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': 'rrm-academy',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`GA4 report failed: ${resp.status}`);
  return resp.json();
}
