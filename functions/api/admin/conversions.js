/**
 * GET /api/admin/conversions
 * Returns GA4 conversion report data for the admin dashboard.
 * Requires ADMIN_API_SECRET header for auth.
 * Caches results in KV for 1 hour to avoid hitting GA4 rate limits.
 *
 * Query params:
 *   ?period=7d|28d|90d (default: 28d)
 */
import { json } from '../auth/_shared.js';

const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_TTL = 3600; // 1 hour

export async function onRequestGet({ request, env }) {
  // Auth check
  const authHeader = request.headers.get('X-Admin-Secret');
  if (!authHeader || authHeader !== env.ADMIN_API_SECRET) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!env.GA4_OAUTH_CREDS || !env.GA4_PROPERTY_ID) {
    return json({ ok: false, error: 'GA4 not configured' }, 500);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '28d';
  const periodMap = { '7d': '7daysAgo', '28d': '28daysAgo', '90d': '90daysAgo' };
  const startDate = periodMap[period] || '28daysAgo';

  // Check KV cache
  const cacheKey = `ga4:conversions:${period}`;
  if (env.COMMUNITY_KV) {
    const cached = await env.COMMUNITY_KV.get(cacheKey, 'json');
    if (cached) return json({ ok: true, data: cached, cached: true });
  }

  try {
    const accessToken = await getAccessToken(env);
    const report = await fetchReport(accessToken, env.GA4_PROPERTY_ID, startDate);

    // Cache in KV
    if (env.COMMUNITY_KV) {
      await env.COMMUNITY_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: CACHE_TTL });
    }

    return json({ ok: true, data: report, cached: false });
  } catch (err) {
    console.error('GA4 conversions error:', err.message);
    return json({ ok: false, error: 'Failed to fetch analytics' }, 502);
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
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token refresh failed: ${resp.status} ${err}`);
  }
  const data = await resp.json();
  return data.access_token;
}

async function fetchReport(accessToken, propertyId, startDate) {
  // Run two queries: summary metrics and daily time series
  const [summary, daily] = await Promise.all([
    runReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'totalUsers' },
      ],
      dimensions: [{ name: 'eventName' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['purchase', 'begin_checkout', 'sign_up', 'generate_lead', 'page_view'],
          },
        },
      },
    }),
    runReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [{ name: 'eventCount' }],
      dimensions: [{ name: 'date' }, { name: 'eventName' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['purchase', 'begin_checkout', 'sign_up', 'generate_lead', 'page_view'],
          },
        },
      },
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
  ]);

  // Parse summary into clean object
  const events = {};
  for (const row of summary.rows || []) {
    const name = row.dimensionValues[0].value;
    events[name] = {
      count: parseInt(row.metricValues[0].value, 10),
      users: parseInt(row.metricValues[1].value, 10),
    };
  }

  // Parse daily into array
  const dailyData = {};
  for (const row of daily.rows || []) {
    const date = row.dimensionValues[0].value;
    const event = row.dimensionValues[1].value;
    const count = parseInt(row.metricValues[0].value, 10);
    if (!dailyData[date]) dailyData[date] = {};
    dailyData[date][event] = count;
  }

  // Convert to sorted array
  const timeline = Object.entries(dailyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  return {
    period: startDate,
    events,
    timeline,
    fetchedAt: new Date().toISOString(),
  };
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
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GA4 report failed: ${resp.status} ${err}`);
  }
  return resp.json();
}
