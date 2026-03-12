# Living SEO Report Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand rrm-seo-monitor Worker into a full data collection engine and replace `/admin/seo/` with a living analytics dashboard.

**Architecture:** Single Worker expansion. New collector modules (CF Analytics, GSC, Serper) feed daily snapshots into KV. Three cron triggers handle spike detection (30m), daily collection (06:00 UTC), and weekly crawl (Sat 14:00). Admin page in rrm-academy-cf consumes data via existing proxy pattern.

**Tech Stack:** Cloudflare Workers (vanilla JS, no build step), KV storage, CF Analytics GraphQL, Google OAuth 2.0, Serper.dev API, AWS SES (aws4fetch), Astro 5.3 (admin page)

**Spec:** `docs/superpowers/specs/2026-03-12-living-seo-report-design.md`

**Repos:**
- `~/iCode/projects/rrm-seo-monitor/` (Worker -- most of the work)
- `~/iCode/projects/rrm-academy-cf/` (admin page + proxy)

---

## File Map

### rrm-seo-monitor (Worker)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/index.js` | Modify | Add 3-way cron dispatch, new API routes |
| `src/collectors/cloudflare.js` | Create | CF Analytics GraphQL queries (traffic, per-path pageviews) |
| `src/collectors/gsc.js` | Create | GSC API client + OAuth token refresh |
| `src/collectors/serper.js` | Create | Serper.dev SERP position tracking |
| `src/oauth.js` | Create | Google OAuth consent + callback handlers |
| `src/spike.js` | Create | Spike detection: query CF, compare vs rolling average, dedup |
| `src/alerts.js` | Create | Alert CRUD (KV-backed), dismiss logic |
| `src/email.js` | Create | SES email: daily report HTML + spike alert + plain text fallback |
| `src/report.js` | Create | Assemble `/api/report` response from KV data |
| `src/keywords.js` | Create | Keyword config CRUD with tier caps |
| `wrangler.toml` | Modify | Add `*/30 * * * *` cron trigger |

### rrm-academy-cf (Admin page + proxy)

| File | Action | Responsibility |
|------|--------|---------------|
| `functions/api/admin/seo.js` | Modify | Add `onRequestPut`, `onRequestPost`, new action routing |
| `src/pages/admin/seo.astro` | Rewrite | Living dashboard replacing health-check-only page |

---

## Chunk 1: Data Collectors

### Task 1: CF Analytics GraphQL Collector

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/collectors/cloudflare.js`

This module queries the CF Analytics GraphQL API for zone-level traffic data and per-path pageview breakdowns.

- [ ] **Step 1: Create the collector module**

```js
// src/collectors/cloudflare.js

const CF_GQL = 'https://api.cloudflare.com/client/v4/graphql';

/**
 * Query CF Analytics for daily traffic summary.
 * Uses httpRequests1dGroups for aggregate KPIs.
 * @param {Object} env - Worker env with CF_API_TOKEN, CF_ZONE_ID
 * @param {string} date - YYYY-MM-DD
 * @returns {{ visitors, pageviews, cacheRate, requests, statusCodes }}
 */
export async function fetchDailyTraffic(env, date) {
  const query = `query {
    viewer {
      zones(filter: { zoneTag: "${env.CF_ZONE_ID}" }) {
        httpRequests1dGroups(
          filter: { date: "${date}" }
          limit: 1
        ) {
          sum { requests, pageViews, cachedRequests }
          uniq { uniques }
        }
      }
    }
  }`;

  const resp = await fetch(CF_GQL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    throw new Error(`CF Analytics API ${resp.status}: ${await resp.text()}`);
  }

  const json = await resp.json();
  const groups = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
  if (!groups || groups.length === 0) {
    return { visitors: 0, pageviews: 0, cacheRate: 0, requests: 0 };
  }

  const day = groups[0];
  const requests = day.sum.requests || 0;
  const cached = day.sum.cachedRequests || 0;

  return {
    visitors: day.uniq.uniques || 0,
    pageviews: day.sum.pageViews || 0,
    cacheRate: requests > 0 ? cached / requests : 0,
    requests,
  };
}

/**
 * Query per-path pageviews for a time window.
 * Uses httpRequestsAdaptiveGroups for spike detection.
 * @param {Object} env
 * @param {string} start - ISO datetime
 * @param {string} end - ISO datetime
 * @returns {Array<{ path, views }>}
 */
export async function fetchPathPageviews(env, start, end) {
  const query = `query {
    viewer {
      zones(filter: { zoneTag: "${env.CF_ZONE_ID}" }) {
        httpRequestsAdaptiveGroups(
          filter: {
            datetime_geq: "${start}"
            datetime_leq: "${end}"
            requestSource: "eyeball"
            clientRequestHTTPMethodIn: ["GET"]
            edgeResponseStatus: 200
          }
          limit: 100
          orderBy: [count_DESC]
        ) {
          count
          dimensions { clientRequestPath }
        }
      }
    }
  }`;

  const resp = await fetch(CF_GQL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    throw new Error(`CF Analytics API ${resp.status}: ${await resp.text()}`);
  }

  const json = await resp.json();
  const groups = json.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];

  return groups.map(g => ({
    path: g.dimensions.clientRequestPath,
    views: g.count,
  }));
}
```

- [ ] **Step 2: Smoke test via wrangler dev**

Wire a temporary test route in `src/index.js` to verify the collector works:

```js
// Add temporarily after the /health route in src/index.js
if (url.pathname === '/api/test/cf' && request.method === 'GET') {
  if (!auth(request, env)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { fetchDailyTraffic } = await import('./collectors/cloudflare.js');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const data = await fetchDailyTraffic(env, yesterday);
  return Response.json(data);
}
```

Run: `cd ~/iCode/projects/rrm-seo-monitor && npx wrangler dev --remote`
Test: `curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/test/cf`
Expected: JSON with `visitors`, `pageviews`, `cacheRate`, `requests` fields.

- [ ] **Step 3: Remove test route, commit**

Remove the `/api/test/cf` route from index.js.

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/collectors/cloudflare.js
git commit -m "feat: add CF Analytics GraphQL collector"
```

---

### Task 2: Serper SERP Tracking Collector

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/collectors/serper.js`

- [ ] **Step 1: Create the Serper collector module**

```js
// src/collectors/serper.js

const SERPER_API = 'https://google.serper.dev/search';

/**
 * Track SERP position for a list of keywords.
 * @param {Object} env - Worker env with SERPER_API_KEY
 * @param {Array<{ keyword, tier }>} keywords
 * @param {string} targetDomain - e.g. 'rrmacademy.org'
 * @returns {Array<{ keyword, tier, position, url, features }>}
 */
export async function trackKeywords(env, keywords, targetDomain = 'rrmacademy.org') {
  if (!env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY not configured');
  }

  const results = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    // 1s delay between calls to avoid rate limiting (spec: ~15 Active at 1s each)
    if (i > 0) await new Promise(r => setTimeout(r, 1000));
    try {
      const resp = await fetch(SERPER_API, {
        method: 'POST',
        headers: {
          'X-API-KEY': env.SERPER_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: kw.keyword, gl: 'us', hl: 'en', num: 20 }),
      });

      if (!resp.ok) {
        results.push({ keyword: kw.keyword, tier: kw.tier, position: null, url: null, features: [], error: `HTTP ${resp.status}` });
        continue;
      }

      const data = await resp.json();
      const entry = parseSerperResult(data, targetDomain, kw);
      results.push(entry);
    } catch (err) {
      results.push({ keyword: kw.keyword, tier: kw.tier, position: null, url: null, features: [], error: err.message });
    }
  }

  return results;
}

function parseSerperResult(data, targetDomain, kw) {
  const features = [];
  if (data.answerBox) features.push('featured_snippet');
  if (data.peopleAlsoAsk) features.push('paa');
  if (data.knowledgeGraph) features.push('knowledge_panel');

  const organic = data.organic || [];
  for (let i = 0; i < organic.length; i++) {
    const result = organic[i];
    if (result.link && result.link.includes(targetDomain)) {
      return {
        keyword: kw.keyword,
        tier: kw.tier,
        position: i + 1,
        url: (() => { try { return new URL(result.link).pathname; } catch { return result.link; } })(),
        features,
      };
    }
  }

  // Not found in top results
  return {
    keyword: kw.keyword,
    tier: kw.tier,
    position: null,
    url: null,
    features,
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/collectors/serper.js
git commit -m "feat: add Serper.dev SERP tracking collector"
```

---

### Task 3: GSC Collector + OAuth Token Management

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/collectors/gsc.js`
- Create: `~/iCode/projects/rrm-seo-monitor/src/oauth.js`

- [ ] **Step 1: Create the OAuth module**

```js
// src/oauth.js

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly';
const REDIRECT_URI = 'https://rrmacademy.org/api/admin/seo?action=google-callback';

/**
 * Build the Google OAuth consent URL.
 * @param {Object} env - GOOGLE_CLIENT_ID
 * @returns {string} OAuth consent URL
 */
export function buildConsentUrl(env) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

/**
 * Exchange authorization code for tokens. Store refresh token in KV.
 * @param {Object} env - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASELINES (KV)
 * @param {string} code - Authorization code from callback
 * @returns {{ success: boolean, error?: string }}
 */
export async function exchangeCode(env, code) {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { success: false, error: `Token exchange failed: ${resp.status} ${text}` };
  }

  const tokens = await resp.json();
  if (!tokens.refresh_token) {
    return { success: false, error: 'No refresh_token in response (consent may not have been granted)' };
  }

  await env.BASELINES.put('gsc:refresh_token', tokens.refresh_token);
  return { success: true };
}

/**
 * Get a fresh access token using the stored refresh token.
 * @param {Object} env
 * @returns {string|null} access token or null if unavailable
 */
export async function getAccessToken(env) {
  const refreshToken = await env.BASELINES.get('gsc:refresh_token');
  if (!refreshToken) return null;

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) return null;

  const tokens = await resp.json();
  return tokens.access_token || null;
}
```

- [ ] **Step 2: Create the GSC collector module**

```js
// src/collectors/gsc.js

import { getAccessToken } from '../oauth.js';

const GSC_API = 'https://www.googleapis.com/webmasters/v3';
const SITE_URL = 'https://rrmacademy.org/';

/**
 * Fetch GSC search analytics for a date range.
 * Returns KPIs + top queries + top pages.
 * @param {Object} env
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {{ clicks, impressions, ctr, position, topQueries, topPages } | null}
 */
export async function fetchGSCData(env, startDate, endDate) {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return null;

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'x-goog-user-project': 'rrm-academy',
  };

  const encodedSite = encodeURIComponent(SITE_URL);

  // Aggregate KPIs
  const aggResp = await fetch(
    `${GSC_API}/sites/${encodedSite}/searchAnalytics/query`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: [],
        rowLimit: 1,
      }),
    }
  );

  if (!aggResp.ok) {
    throw new Error(`GSC aggregate query failed: ${aggResp.status}`);
  }

  const aggData = await aggResp.json();
  const agg = aggData.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  // Top queries
  let topQueries = [];
  try {
    const queryResp = await fetch(
      `${GSC_API}/sites/${encodedSite}/searchAnalytics/query`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: 25,
          dimensionFilterGroups: [],
        }),
      }
    );

    if (queryResp.ok) {
      const queryData = await queryResp.json();
      topQueries = (queryData.rows || []).map(r => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
      }));
    }
  } catch { /* top queries are best-effort */ }

  // Top pages
  let topPages = [];
  try {
    const pageResp = await fetch(
      `${GSC_API}/sites/${encodedSite}/searchAnalytics/query`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit: 25,
        }),
      }
    );

    if (!pageResp.ok) return { clicks: agg.clicks, impressions: agg.impressions, ctr: Math.round(agg.ctr * 1000) / 1000, position: Math.round(agg.position * 10) / 10, topQueries, topPages };
    const pageData = await pageResp.json();
    topPages = (pageData.rows || []).map(r => {
    let path;
    try { path = new URL(r.keys[0]).pathname; } catch { path = r.keys[0]; }
    return {
      path,
      clicks: r.clicks,
      impressions: r.impressions,
    };
  });
  } catch { /* top pages are best-effort */ }

  return {
    clicks: agg.clicks,
    impressions: agg.impressions,
    ctr: Math.round(agg.ctr * 1000) / 1000,
    position: Math.round(agg.position * 10) / 10,
    topQueries,
    topPages,
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/oauth.js src/collectors/gsc.js
git commit -m "feat: add GSC collector with OAuth token management"
```

---

### Task 4: Keyword Config CRUD

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/keywords.js`

- [ ] **Step 1: Create the keywords module**

```js
// src/keywords.js

const MAX_ACTIVE = 15;
const MAX_WATCHLIST = 30;

const DEFAULT_KEYWORDS = [
  { keyword: 'restorative reproductive medicine', tier: 'active' },
  { keyword: 'naprotechnology courses', tier: 'active' },
  { keyword: 'rrm academy', tier: 'active' },
  { keyword: 'napro technology', tier: 'active' },
  { keyword: 'fertility awareness methods education', tier: 'active' },
  { keyword: 'restorative reproductive medicine training', tier: 'active' },
  { keyword: 'rrm physician training', tier: 'active' },
  { keyword: 'natural fertility treatment', tier: 'active' },
];

/**
 * Get keyword config from KV. Returns defaults if none stored.
 * @param {Object} env - BASELINES KV binding
 * @returns {Array<{ keyword, tier }>}
 */
export async function getKeywords(env) {
  const raw = await env.BASELINES.get('keywords:config');
  if (!raw) return DEFAULT_KEYWORDS;
  try {
    return JSON.parse(raw);
  } catch {
    return DEFAULT_KEYWORDS;
  }
}

/**
 * Update keyword config in KV. Validates tier caps.
 * @param {Object} env
 * @param {Array<{ keyword, tier }>} keywords
 * @returns {{ ok: boolean, error?: string, keywords?: Array }}
 */
export async function updateKeywords(env, keywords) {
  if (!Array.isArray(keywords)) {
    return { ok: false, error: 'Keywords must be an array' };
  }

  // Validate structure
  for (const kw of keywords) {
    if (!kw.keyword || typeof kw.keyword !== 'string' || kw.keyword.length > 200) {
      return { ok: false, error: `Invalid keyword entry (must be string, max 200 chars): ${JSON.stringify(kw).slice(0, 100)}` };
    }
    if (kw.tier !== 'active' && kw.tier !== 'watchlist') {
      return { ok: false, error: `Invalid tier "${kw.tier}" for keyword "${kw.keyword}". Must be "active" or "watchlist"` };
    }
  }

  // Deduplicate by keyword (case-insensitive)
  const seen = new Set();
  const deduped = keywords.filter(kw => {
    const key = kw.keyword.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const active = deduped.filter(k => k.tier === 'active');
  const watchlist = deduped.filter(k => k.tier === 'watchlist');

  if (active.length > MAX_ACTIVE) {
    return { ok: false, error: `Active keywords capped at ${MAX_ACTIVE}. Got ${active.length}` };
  }
  if (watchlist.length > MAX_WATCHLIST) {
    return { ok: false, error: `Watchlist keywords capped at ${MAX_WATCHLIST}. Got ${watchlist.length}` };
  }

  await env.BASELINES.put('keywords:config', JSON.stringify(deduped));
  return { ok: true, keywords: deduped };
}

/**
 * Filter keywords by tier.
 */
export function filterByTier(keywords, tier) {
  return keywords.filter(k => k.tier === tier);
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/keywords.js
git commit -m "feat: add keyword config CRUD with tier caps"
```

---

## Chunk 2: Detection & Alerting

### Task 5: Spike Detection Module

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/spike.js`

- [ ] **Step 1: Create the spike detection module**

```js
// src/spike.js

import { fetchPathPageviews } from './collectors/cloudflare.js';

const SPIKE_THRESHOLD = 3; // 3x baseline
const DEDUP_HOURS = 6;

/**
 * Run spike detection. Compare current 30-min window vs 7-day rolling average.
 * @param {Object} env - CF_API_TOKEN, CF_ZONE_ID, BASELINES
 * @returns {Array<{ path, currentViews, baseline, ratio }>} spikes detected
 */
export async function detectSpikes(env) {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

  // Get current window pageviews
  const current = await fetchPathPageviews(env, windowStart, windowEnd);
  if (current.length === 0) return [];

  // Build current hour key for spike storage
  const hourKey = `spike:${now.toISOString().slice(0, 13)}`; // spike:2026-03-12T08
  await env.BASELINES.put(hourKey, JSON.stringify(current), { expirationTtl: 604800 });

  // Load 7 days of spike data to compute rolling averages
  const averages = await computeRollingAverages(env, now);
  if (Object.keys(averages).length === 0) return [];

  // Compare current vs averages
  const spikes = [];
  for (const page of current) {
    const avg = averages[page.path];
    if (!avg || avg < 5) continue; // ignore very low traffic paths (noise)

    const ratio = page.views / avg;
    if (ratio >= SPIKE_THRESHOLD) {
      spikes.push({
        path: page.path,
        currentViews: page.views,
        baseline: Math.round(avg),
        ratio: Math.round(ratio * 10) / 10,
      });
    }
  }

  // Dedup: filter out paths alerted in last DEDUP_HOURS
  return await dedup(env, spikes, now);
}

async function computeRollingAverages(env, now) {
  const counts = {};
  const totals = {};

  // Check last 7 days * 48 half-hours = 336 possible keys
  // But we only need the same time-of-day window for fair comparison
  // Simplification: average ALL stored spike data per path over 7 days
  const promises = [];
  for (let d = 1; d <= 7; d++) {
    const day = new Date(now.getTime() - d * 86400000);
    const dayStr = day.toISOString().slice(0, 10);
    // Read the same hour from previous days
    const hourStr = now.toISOString().slice(11, 13);
    const key = `spike:${dayStr}T${hourStr}`;
    promises.push(env.BASELINES.get(key).then(v => ({ key, v })));
  }

  const results = await Promise.all(promises);
  for (const { v } of results) {
    if (!v) continue;
    try {
      const pages = JSON.parse(v);
      for (const page of pages) {
        totals[page.path] = (totals[page.path] || 0) + page.views;
        counts[page.path] = (counts[page.path] || 0) + 1;
      }
    } catch { /* skip corrupted */ }
  }

  const averages = {};
  for (const [path, total] of Object.entries(totals)) {
    averages[path] = total / counts[path];
  }
  return averages;
}

async function dedup(env, spikes, now) {
  if (spikes.length === 0) return [];

  const raw = await env.BASELINES.get('spike:dedup');
  let recent = {};
  if (raw) {
    try { recent = JSON.parse(raw); } catch { recent = {}; }
  }

  // Clean expired entries
  const cutoff = now.getTime() - DEDUP_HOURS * 3600000;
  for (const [path, ts] of Object.entries(recent)) {
    if (ts < cutoff) delete recent[path];
  }

  // Filter and mark
  const novel = spikes.filter(s => !recent[s.path]);
  for (const s of novel) {
    recent[s.path] = now.getTime();
  }

  await env.BASELINES.put('spike:dedup', JSON.stringify(recent), { expirationTtl: 86400 });
  return novel;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/spike.js
git commit -m "feat: add spike detection with rolling average + dedup"
```

---

### Task 6: Alert System

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/alerts.js`

- [ ] **Step 1: Create the alerts module**

```js
// src/alerts.js

/**
 * Get all active alerts.
 * @param {Object} env - BASELINES KV binding
 * @returns {Array<{ id, type, message, timestamp, data }>}
 */
export async function getAlerts(env) {
  const raw = await env.BASELINES.get('alerts:active');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Add an alert. Deduplicates by ID.
 * @param {Object} env
 * @param {{ id, type, message, data }} alert
 */
export async function addAlert(env, alert) {
  const alerts = await getAlerts(env);
  const existing = alerts.findIndex(a => a.id === alert.id);
  if (existing !== -1) {
    alerts[existing] = { ...alert, timestamp: new Date().toISOString() };
  } else {
    alerts.push({ ...alert, timestamp: new Date().toISOString() });
  }
  await env.BASELINES.put('alerts:active', JSON.stringify(alerts));
}

/**
 * Add spike alerts in bulk.
 * @param {Object} env
 * @param {Array<{ path, currentViews, baseline, ratio }>} spikes
 */
export async function addSpikeAlerts(env, spikes) {
  for (const spike of spikes) {
    const pathSlug = spike.path.replace(/\//g, '-').replace(/^-|-$/g, '');
    await addAlert(env, {
      id: `spike-${new Date().toISOString().slice(0, 13)}-${pathSlug}`,
      type: 'spike',
      message: `Traffic spike on ${spike.path}: ${spike.currentViews} views (${spike.ratio}x baseline)`,
      data: spike,
    });
  }
}

/**
 * Dismiss an alert by ID.
 * @param {Object} env
 * @param {string} alertId
 * @returns {{ ok: boolean }}
 */
export async function dismissAlert(env, alertId) {
  const alerts = await getAlerts(env);
  const filtered = alerts.filter(a => a.id !== alertId);
  await env.BASELINES.put('alerts:active', JSON.stringify(filtered));
  return { ok: true, remaining: filtered.length };
}

/**
 * Remove alerts older than maxAge (ms). Called during daily collection.
 * @param {Object} env
 * @param {number} maxAgeMs - default 48 hours
 */
export async function pruneAlerts(env, maxAgeMs = 48 * 3600000) {
  const alerts = await getAlerts(env);
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const active = alerts.filter(a => a.timestamp > cutoff);
  await env.BASELINES.put('alerts:active', JSON.stringify(active));
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/alerts.js
git commit -m "feat: add KV-backed alert system with dedup and pruning"
```

---

### Task 7: SES Email Module

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/email.js`

Read the observatory's SES pattern first: `~/iCode/projects/rrm-observatory/src/notify.js`

- [ ] **Step 1: Install aws4fetch dependency**

```bash
cd ~/iCode/projects/rrm-seo-monitor
npm install aws4fetch
```

Expected: `aws4fetch` added to `package.json` dependencies. Wrangler bundles node_modules at deploy time (same pattern as rrm-observatory).

- [ ] **Step 2: Create the SES email module**

```js
// src/email.js

import { AwsClient } from 'aws4fetch';

const SENDER = 'SEO Monitor <seo@mail.rrmacademy.org>';
const RECIPIENT = 'administrator@rrmacademy.org';

function getAwsClient(env) {
  return new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_SES_REGION || 'us-east-1',
    service: 'ses',
  });
}

/**
 * Send the daily SEO report email.
 * @param {Object} env
 * @param {Object} snapshot - full daily snapshot data
 * @returns {{ sent: boolean, reason?: string }}
 */
export async function sendDailyReport(env, snapshot) {
  if (!env.AWS_ACCESS_KEY_ID) return { sent: false, reason: 'SES not configured' };

  const subject = `SEO Report - ${snapshot.date}`;
  const html = renderDailyReportHtml(snapshot);
  const text = renderDailyReportText(snapshot);

  return sendEmail(env, subject, html, text);
}

/**
 * Send a spike alert email.
 * @param {Object} env
 * @param {Array<{ path, currentViews, baseline, ratio }>} spikes
 * @returns {{ sent: boolean, reason?: string }}
 */
export async function sendSpikeAlert(env, spikes) {
  if (!env.AWS_ACCESS_KEY_ID) return { sent: false, reason: 'SES not configured' };
  if (spikes.length === 0) return { sent: false, reason: 'no spikes' };

  const subject = `Traffic Spike Alert - ${spikes.length} page(s)`;
  const html = renderSpikeHtml(spikes);
  const text = renderSpikeText(spikes);

  return sendEmail(env, subject, html, text);
}

async function sendEmail(env, subject, html, text) {
  const client = getAwsClient(env);
  const region = env.AWS_SES_REGION || 'us-east-1';

  try {
    const resp = await client.fetch(
      `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FromEmailAddress: SENDER,
          Destination: { ToAddresses: [RECIPIENT] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      return { sent: false, reason: `SES ${resp.status}: ${errText.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// --- Helpers ---

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- HTML Renderers ---

function renderDailyReportHtml(snap) {
  const gsc = snap.gsc || {};
  const kws = snap.keywords || [];
  const health = snap.health || { checks: [] };

  const delta = (v) => {
    if (v == null || v === 0) return '<span style="color:#636261">flat</span>';
    const pct = (v * 100).toFixed(1);
    const color = v > 0 ? '#2D8A4E' : '#C53030';
    const sign = v > 0 ? '+' : '';
    return `<span style="color:${color};font-weight:600">${sign}${pct}%</span>`;
  };

  const kwRows = kws.slice(0, 25).map(k => {
    const pos = k.position != null ? k.position : '--';
    const chg = k.change != null ? (k.change > 0 ? `+${k.change}` : k.change) : '--';
    const chgColor = k.change > 0 ? '#2D8A4E' : k.change < 0 ? '#C53030' : '#636261';
    return `<tr><td style="padding:6px 12px;border-top:1px solid #E8E5E0">${esc(k.keyword)}</td><td style="padding:6px 12px;text-align:right;border-top:1px solid #E8E5E0">${pos}</td><td style="padding:6px 12px;text-align:right;border-top:1px solid #E8E5E0;color:${chgColor};font-weight:600">${chg}</td></tr>`;
  }).join('');

  const healthDots = health.checks.map(c => {
    const color = c.ok ? '#2D8A4E' : '#C53030';
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${c.name}: ${c.detail}`;
  }).join('<br>');

  return `
<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;background:#FAF8F5;padding:24px">
  <div style="background:#3D2A32;color:#C9A8B2;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:600">RRM Academy - SEO Report</div>
  <div style="background:#fff;padding:20px;border:1px solid #D9D3CC;border-top:none;border-radius:0 0 8px 8px">
    <h2 style="font-family:'Cormorant Garamond',Georgia,serif;margin:0 0 4px;color:#1A1918;font-size:20px">Daily SEO Report</h2>
    <p style="color:#636261;font-size:12px;margin:0 0 20px">${snap.date}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr style="background:#F9F8F6">
        <td style="padding:12px;text-align:center;font-size:11px;color:#636261">Clicks</td>
        <td style="padding:12px;text-align:center;font-size:11px;color:#636261">Impressions</td>
        <td style="padding:12px;text-align:center;font-size:11px;color:#636261">CTR</td>
        <td style="padding:12px;text-align:center;font-size:11px;color:#636261">Position</td>
        <td style="padding:12px;text-align:center;font-size:11px;color:#636261">Visitors</td>
      </tr>
      <tr>
        <td style="padding:8px;text-align:center;font-size:18px;font-weight:700">${gsc.clicks ?? '--'}<br>${delta(gsc.clicksDelta)}</td>
        <td style="padding:8px;text-align:center;font-size:18px;font-weight:700">${formatNum(gsc.impressions)}<br>${delta(gsc.impressionsDelta)}</td>
        <td style="padding:8px;text-align:center;font-size:18px;font-weight:700">${gsc.ctr != null ? (gsc.ctr * 100).toFixed(1) + '%' : '--'}<br>${delta(gsc.ctrDelta)}</td>
        <td style="padding:8px;text-align:center;font-size:18px;font-weight:700">${gsc.position ?? '--'}<br>${delta(gsc.positionDelta)}</td>
        <td style="padding:8px;text-align:center;font-size:18px;font-weight:700">${formatNum(snap.traffic?.visitors)}<br>--</td>
      </tr>
    </table>
    ${kwRows ? `<h3 style="font-size:13px;color:#636261;margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px">Keyword Rankings</h3><table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="background:#F9F8F6"><th style="padding:6px 12px;text-align:left">Keyword</th><th style="padding:6px 12px;text-align:right">Pos</th><th style="padding:6px 12px;text-align:right">Chg</th></tr>${kwRows}</table>` : ''}
    <h3 style="font-size:13px;color:#636261;margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px">Site Health</h3>
    <div style="font-size:12px;line-height:2">${healthDots}</div>
  </div>
</div>`;
}

function renderDailyReportText(snap) {
  const gsc = snap.gsc || {};
  const lines = [
    `SEO REPORT - ${snap.date}`,
    '',
    `Clicks: ${gsc.clicks ?? '--'}  |  Impressions: ${formatNum(gsc.impressions)}  |  CTR: ${gsc.ctr != null ? (gsc.ctr * 100).toFixed(1) + '%' : '--'}  |  Position: ${gsc.position ?? '--'}`,
    '',
    'KEYWORD RANKINGS',
    ...(snap.keywords || []).slice(0, 25).map(k =>
      `  ${k.keyword}: pos ${k.position ?? '--'} (${k.change > 0 ? '+' : ''}${k.change ?? '--'})`
    ),
    '',
    'HEALTH',
    ...(snap.health?.checks || []).map(c => `  ${c.ok ? 'OK' : 'FAIL'} ${c.name}: ${c.detail}`),
  ];
  return lines.join('\n');
}

function renderSpikeHtml(spikes) {
  const rows = spikes.map(s =>
    `<tr><td style="padding:8px 12px;border-top:1px solid #E8E5E0">${esc(s.path)}</td><td style="padding:8px 12px;text-align:right;border-top:1px solid #E8E5E0">${s.currentViews}</td><td style="padding:8px 12px;text-align:right;border-top:1px solid #E8E5E0">${s.baseline}</td><td style="padding:8px 12px;text-align:right;border-top:1px solid #E8E5E0;color:#C53030;font-weight:700">${s.ratio}x</td></tr>`
  ).join('');

  return `
<div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <div style="background:#C53030;color:#fff;padding:12px 20px;border-radius:8px 8px 0 0;font-size:14px;font-weight:600">Traffic Spike Alert</div>
  <div style="background:#fff;padding:20px;border:1px solid #D9D3CC;border-top:none;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr style="background:#F9F8F6"><th style="padding:6px 12px;text-align:left">Page</th><th style="padding:6px 12px;text-align:right">Current</th><th style="padding:6px 12px;text-align:right">Baseline</th><th style="padding:6px 12px;text-align:right">Spike</th></tr>
      ${rows}
    </table>
  </div>
</div>`;
}

function renderSpikeText(spikes) {
  const lines = ['TRAFFIC SPIKE ALERT', ''];
  for (const s of spikes) {
    lines.push(`  ${s.path}: ${s.currentViews} views (baseline: ${s.baseline}, ${s.ratio}x)`);
  }
  return lines.join('\n');
}

function formatNum(n) {
  if (n == null) return '--';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/email.js
git commit -m "feat: add SES email module (daily report + spike alerts)"
```

---

### Task 8: Report Assembly

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/report.js`

- [ ] **Step 1: Create the report module**

```js
// src/report.js

import { getAlerts } from './alerts.js';

/**
 * Assemble the full /api/report response from KV.
 * @param {Object} env - BASELINES KV
 * @returns {Object} Report payload matching spec response shape
 */
export async function assembleReport(env) {
  const [snapshotRaw, sparklinesRaw, alerts, lastResults] = await Promise.all([
    findLatestSnapshot(env),
    env.BASELINES.get('sparklines'),
    getAlerts(env),
    env.BASELINES.get('last_results'),
  ]);

  let snapshot = null;
  if (snapshotRaw) {
    try { snapshot = JSON.parse(snapshotRaw); } catch { /* skip */ }
  }

  // Worker health info
  const gscToken = await env.BASELINES.get('gsc:refresh_token');
  const worker = {
    lastDaily: snapshot?.timestamp || null,
    lastSpike: null, // filled by spike detection logging
    lastWeekly: null, // filled by weekly cron logging
    kvDays: snapshot ? await countSnapshotDays(env) : 0,
    gscConnected: !!gscToken,
  };

  // Read worker timestamps from KV
  const [lastSpikeTs, lastWeeklyTs] = await Promise.all([
    env.BASELINES.get('worker:lastSpike'),
    env.BASELINES.get('worker:lastWeekly'),
  ]);
  worker.lastSpike = lastSpikeTs || null;
  worker.lastWeekly = lastWeeklyTs || null;

  return {
    snapshot: snapshot || { date: null, traffic: null, gsc: null, keywords: [], health: null },
    sparklines: (() => { try { return sparklinesRaw ? JSON.parse(sparklinesRaw) : { clicks: [], impressions: [], ctr: [], position: [], visitors: [] }; } catch { return { clicks: [], impressions: [], ctr: [], position: [], visitors: [] }; } })(),
    alerts,
    worker,
  };
}

async function findLatestSnapshot(env) {
  // Try today, then yesterday. Returns the raw JSON string (avoids double KV read).
  const today = new Date().toISOString().slice(0, 10);
  const todayVal = await env.BASELINES.get(`snapshot:${today}`);
  if (todayVal) return todayVal;

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return await env.BASELINES.get(`snapshot:${yesterday}`);
}

async function countSnapshotDays(env) {
  // KV list with prefix to count stored days
  const list = await env.BASELINES.list({ prefix: 'snapshot:' });
  return list.keys.length;
}

/**
 * Build and store a daily snapshot.
 * @param {Object} data - { date, traffic, gsc, keywords, health }
 * @param {Object} env
 */
export async function storeSnapshot(env, data) {
  const key = `snapshot:${data.date}`;
  await env.BASELINES.put(key, JSON.stringify(data), { expirationTtl: 7776000 });

  // Update sparklines
  await updateSparklines(env, data);
}

async function updateSparklines(env, data) {
  const raw = await env.BASELINES.get('sparklines');
  let sparklines;
  try {
    sparklines = raw ? JSON.parse(raw) : { clicks: [], impressions: [], ctr: [], position: [], visitors: [] };
  } catch {
    sparklines = { clicks: [], impressions: [], ctr: [], position: [], visitors: [] };
  }

  const push = (arr, val) => {
    arr.push(val);
    if (arr.length > 90) arr.shift();
    return arr;
  };

  const gsc = data.gsc || {};
  push(sparklines.clicks, gsc.clicks ?? 0);
  push(sparklines.impressions, gsc.impressions ?? 0);
  push(sparklines.ctr, gsc.ctr ?? 0);
  push(sparklines.position, gsc.position ?? 0);
  push(sparklines.visitors, data.traffic?.visitors ?? 0);

  await env.BASELINES.put('sparklines', JSON.stringify(sparklines));
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/report.js
git commit -m "feat: add report assembly + snapshot storage with sparklines"
```

---

## Chunk 3: Worker Integration

### Task 9: Rewrite `index.js` -- API Routes + 3-Way Cron Dispatch

**Files:**
- Modify: `~/iCode/projects/rrm-seo-monitor/src/index.js`

This is the most critical task. The existing `index.js` needs new API routes and a 3-way cron dispatch. Preserve all existing routes and behavior.

- [ ] **Step 1: Read the current index.js to confirm no drift from what we reviewed**

```bash
cd ~/iCode/projects/rrm-seo-monitor
cat src/index.js
```

- [ ] **Step 2: Rewrite index.js**

Key changes:
- Import new modules
- Add `/api/report`, `/api/keywords`, `/api/alerts`, `/api/auth/google` routes
- Split `scheduled()` into 3 paths: spike (`*/30`), daily (`0 6`), weekly (`0 14 * * 6`)
- Preserve existing `/api/check`, `/api/baseline`, `/api/crawl` routes unchanged

```js
// src/index.js

import { runAllChecks } from './checks.js';
import { sendTelegram, formatDailyAlert, formatWeeklyDigest } from './telegram.js';
import { runBrokenLinkCrawl, formatCrawlAlert, formatCrawlDigest } from './crawler.js';
import { fetchDailyTraffic } from './collectors/cloudflare.js';
import { fetchGSCData } from './collectors/gsc.js';
import { trackKeywords } from './collectors/serper.js';
import { buildConsentUrl, exchangeCode } from './oauth.js';
import { detectSpikes } from './spike.js';
import { getAlerts, addAlert, addSpikeAlerts, dismissAlert, pruneAlerts } from './alerts.js';
import { sendDailyReport, sendSpikeAlert } from './email.js';
import { assembleReport, storeSnapshot } from './report.js';
import { getKeywords, updateKeywords, filterByTier } from './keywords.js';

function log(env, ctx, event, action, status, detail, duration, httpStatus) {
  if (!env.EVENTS) return;
  ctx.waitUntil(env.EVENTS.writeDataPoint({
    blobs: ['rrm-seo-monitor', event, action, status, (detail || '').slice(0, 200)],
    doubles: [duration || 0, 1, httpStatus || 0],
    indexes: [action],
  }));
}

function auth(request, env) {
  if (!env.SEO_MONITOR_API_TOKEN) return false;
  const header = request.headers.get('Authorization') || '';
  return header === `Bearer ${env.SEO_MONITOR_API_TOKEN}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- Public ---
    if (path === '/health') {
      return Response.json({ ok: true, worker: 'rrm-seo-monitor' });
    }

    // --- Auth required for all /api/* ---
    if (path.startsWith('/api/') && !path.startsWith('/api/auth/google')) {
      if (!auth(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // --- Existing routes (unchanged) ---
    if (path === '/api/check' && method === 'GET') {
      const results = await runAllChecks(env);
      log(env, ctx, 'api', 'check', results.ok ? 'pass' : 'fail', `${results.checks.length} checks`);
      return Response.json(results);
    }

    if (path === '/api/baseline' && method === 'GET') {
      const keys = ['sitemap_count', 'robots_hash', 'last_results'];
      const entries = {};
      for (const key of keys) {
        entries[key] = await env.BASELINES.get(key);
      }
      return Response.json(entries);
    }

    if (path === '/api/baseline' && method === 'PUT') {
      try {
        const body = await request.json();
        for (const [key, value] of Object.entries(body)) {
          if (value === null) {
            await env.BASELINES.delete(key);
          } else {
            await env.BASELINES.put(key, String(value));
          }
        }
        log(env, ctx, 'api', 'baseline_update', 'ok', Object.keys(body).join(','));
        return Response.json({ ok: true, updated: Object.keys(body) });
      } catch (err) {
        return Response.json({ error: `Invalid JSON: ${err.message}` }, { status: 400 });
      }
    }

    if (path === '/api/crawl' && method === 'GET') {
      const cached = await env.BASELINES.get('last_crawl');
      if (cached) return Response.json(JSON.parse(cached));
      return Response.json({ error: 'No crawl results yet' }, { status: 404 });
    }

    if (path === '/api/crawl' && method === 'POST') {
      const crawlResult = await runBrokenLinkCrawl();
      await env.BASELINES.put('last_crawl', JSON.stringify(crawlResult));
      log(env, ctx, 'cron', 'crawl', crawlResult.broken_internal.length > 0 ? 'fail' : 'pass',
        `pages=${crawlResult.pages_crawled}, broken_internal=${crawlResult.broken_internal.length}`);
      return Response.json(crawlResult);
    }

    // --- New routes ---

    // Report
    if (path === '/api/report' && method === 'GET') {
      try {
        const report = await assembleReport(env);
        return Response.json(report);
      } catch (err) {
        log(env, ctx, 'api', 'report', 'fail', err.message);
        return Response.json({ error: 'Failed to assemble report' }, { status: 500 });
      }
    }

    // Keywords
    if (path === '/api/keywords' && method === 'GET') {
      const keywords = await getKeywords(env);
      return Response.json({ keywords });
    }

    if (path === '/api/keywords' && method === 'PUT') {
      try {
        const body = await request.json();
        const result = await updateKeywords(env, body.keywords);
        if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
        return Response.json(result);
      } catch (err) {
        return Response.json({ error: `Invalid JSON: ${err.message}` }, { status: 400 });
      }
    }

    // Alerts
    if (path === '/api/alerts' && method === 'GET') {
      const alerts = await getAlerts(env);
      return Response.json({ alerts });
    }

    if (path === '/api/alerts/dismiss' && method === 'POST') {
      try {
        const body = await request.json();
        if (!body.id) return Response.json({ error: 'Missing alert id' }, { status: 400 });
        const result = await dismissAlert(env, body.id);
        return Response.json(result);
      } catch (err) {
        return Response.json({ error: `Invalid JSON: ${err.message}` }, { status: 400 });
      }
    }

    // Google OAuth (no Bearer auth -- uses Google's own auth)
    if (path === '/api/auth/google' && method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID) {
        return Response.json({ error: 'Google OAuth not configured' }, { status: 503 });
      }
      const consentUrl = buildConsentUrl(env);
      return Response.redirect(consentUrl, 302);
    }

    if (path === '/api/auth/google/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) {
        return Response.json({ error: 'Missing authorization code' }, { status: 400 });
      }
      try {
        const result = await exchangeCode(env, code);
        if (!result.success) {
          return Response.json({ error: result.error }, { status: 500 });
        }
        // Redirect back to dashboard on success
        return new Response(null, {
          status: 302,
          headers: { 'Location': 'https://rrmacademy.org/admin/seo' },
        });
      } catch (err) {
        return Response.json({ error: `OAuth failed: ${err.message}` }, { status: 500 });
      }
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron;

    // --- Spike detection (every 30 min) ---
    if (cron === '*/30 * * * *') {
      try {
        const spikes = await detectSpikes(env);
        ctx.waitUntil(env.BASELINES.put('worker:lastSpike', new Date().toISOString()));

        if (spikes.length > 0) {
          await addSpikeAlerts(env, spikes);
          const emailResult = await sendSpikeAlert(env, spikes);
          log(env, ctx, 'cron', 'spike_alert', 'alert',
            `${spikes.length} spike(s), email=${emailResult.sent}`);
        } else {
          log(env, ctx, 'cron', 'spike_check', 'pass', 'no spikes');
        }
      } catch (err) {
        log(env, ctx, 'cron', 'spike_error', 'fail', err.message);
      }
      return;
    }

    // --- Weekly crawl + digest (Saturday 14:00 UTC) ---
    if (cron === '0 14 * * 6') {
      const results = await runAllChecks(env);
      ctx.waitUntil(env.BASELINES.put('last_results', JSON.stringify(results)));
      ctx.waitUntil(env.BASELINES.put('worker:lastWeekly', new Date().toISOString()));

      // Crawl
      let crawlResult = null;
      try {
        crawlResult = await runBrokenLinkCrawl();
        ctx.waitUntil(env.BASELINES.put('last_crawl', JSON.stringify(crawlResult)));
      } catch (err) {
        log(env, ctx, 'cron', 'crawl_error', 'fail', err.message);
      }

      // Track watchlist keywords
      try {
        const keywords = await getKeywords(env);
        const watchlist = filterByTier(keywords, 'watchlist');
        if (watchlist.length > 0) {
          await trackKeywords(env, watchlist);
          // Results stored in next daily snapshot
        }
      } catch (err) {
        log(env, ctx, 'cron', 'watchlist_error', 'fail', err.message);
      }

      // Digest
      let digest = formatWeeklyDigest(results);
      if (crawlResult) {
        digest += '\n' + formatCrawlDigest(crawlResult);
      }
      const sent = await sendTelegram(env, digest);
      log(env, ctx, 'cron', 'weekly_digest', results.ok ? 'pass' : 'fail', `sent=${sent.sent}`);

      // Alert on broken internal links
      if (crawlResult) {
        const crawlAlert = formatCrawlAlert(crawlResult);
        if (crawlAlert) {
          await sendTelegram(env, crawlAlert);
          log(env, ctx, 'cron', 'crawl_alert', 'fail',
            `internal=${crawlResult.broken_internal.length}, external=${crawlResult.broken_external.length}`);
        }
      }
      return;
    }

    // --- Daily collection (06:00 UTC) ---
    if (cron === '0 6 * * *') {
      const start = Date.now();
      ctx.waitUntil(env.BASELINES.put('worker:lastDaily', new Date().toISOString()));
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

      // Run health checks
      const health = await runAllChecks(env);
      ctx.waitUntil(env.BASELINES.put('last_results', JSON.stringify(health)));

      // Daily alert on health failure (existing behavior)
      if (!health.ok) {
        const alert = formatDailyAlert(health);
        if (alert) await sendTelegram(env, alert);
      }

      // Collect CF traffic (yesterday, since today is incomplete)
      let traffic = null;
      try {
        traffic = await fetchDailyTraffic(env, yesterday);
      } catch (err) {
        log(env, ctx, 'cron', 'cf_traffic_error', 'fail', err.message);
      }

      // Collect GSC data (7-day window ending yesterday)
      let gsc = null;
      try {
        gsc = await fetchGSCData(env, weekAgo, yesterday);

        // Compute WoW deltas
        if (gsc) {
          const prevWeekStart = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
          const prevWeekEnd = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
          try {
            const prevGsc = await fetchGSCData(env, prevWeekStart, prevWeekEnd);
            if (prevGsc) {
              gsc.clicksDelta = prevGsc.clicks > 0 ? (gsc.clicks - prevGsc.clicks) / prevGsc.clicks : 0;
              gsc.impressionsDelta = prevGsc.impressions > 0 ? (gsc.impressions - prevGsc.impressions) / prevGsc.impressions : 0;
              gsc.ctrDelta = prevGsc.ctr > 0 ? (gsc.ctr - prevGsc.ctr) / prevGsc.ctr : 0;
              gsc.positionDelta = gsc.position - prevGsc.position;
            }
          } catch { /* WoW delta is best-effort */ }
        }
      } catch (err) {
        log(env, ctx, 'cron', 'gsc_error', 'fail', err.message);
        if (err.message.includes('401') || err.message.includes('403')) {
          await addAlert(env, { id: 'gsc-disconnected', type: 'warning', message: 'GSC disconnected -- re-authenticate', data: {} });
        }
      }

      // Track active keywords
      let keywords = [];
      try {
        const kwConfig = await getKeywords(env);
        const active = filterByTier(kwConfig, 'active');
        if (active.length > 0) {
          const current = await trackKeywords(env, active);

          // Compute position changes vs previous snapshot
          const prevSnap = await env.BASELINES.get(`snapshot:${yesterday}`);
          let prevKeywords = [];
          if (prevSnap) {
            try { prevKeywords = JSON.parse(prevSnap).keywords || []; } catch { /* skip */ }
          }

          keywords = current.map(k => {
            const prev = prevKeywords.find(p => p.keyword === k.keyword);
            return {
              ...k,
              change: prev && prev.position != null && k.position != null
                ? prev.position - k.position  // positive = improved
                : null,
            };
          });
        }
      } catch (err) {
        log(env, ctx, 'cron', 'serper_error', 'fail', err.message);
      }

      // Assemble and store snapshot
      const snapshot = {
        date: today,
        timestamp: new Date().toISOString(),
        traffic,
        gsc,
        keywords,
        health: { ok: health.ok, checks: health.checks },
      };

      try {
        await storeSnapshot(env, snapshot);
      } catch (err) {
        log(env, ctx, 'cron', 'snapshot_error', 'fail', err.message);
      }

      // Prune old alerts
      await pruneAlerts(env);

      // Send daily email report
      try {
        const emailResult = await sendDailyReport(env, snapshot);
        log(env, ctx, 'cron', 'daily_email', emailResult.sent ? 'pass' : 'fail',
          emailResult.reason || 'sent');
      } catch (err) {
        log(env, ctx, 'cron', 'email_error', 'fail', err.message);
      }

      log(env, ctx, 'cron', 'daily_collection', health.ok ? 'pass' : 'fail',
        `duration=${Date.now() - start}ms`);
      return;
    }

    // Fallback for unknown cron (should not happen)
    log(env, ctx, 'cron', 'unknown_cron', 'warn', `cron=${cron}`);
  },
};
```

- [ ] **Step 3: Verify no syntax errors**

```bash
cd ~/iCode/projects/rrm-seo-monitor
node -c src/index.js
```

Expected: no output (clean parse).

- [ ] **Step 4: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add src/index.js
git commit -m "feat: rewrite index.js with 3-way cron dispatch + new API routes"
```

---

### Task 10: Update `wrangler.toml`

**Files:**
- Modify: `~/iCode/projects/rrm-seo-monitor/wrangler.toml`

- [ ] **Step 1: Add the spike detection cron trigger and node_compat**

Change:
```toml
[triggers]
crons = ["0 6 * * *", "0 14 * * 6"]
```

To:
```toml
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["*/30 * * * *", "0 6 * * *", "0 14 * * 6"]
```

`nodejs_compat` flag is needed for `aws4fetch` import (`node_compat = true` is deprecated in Wrangler v3+).

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add wrangler.toml
git commit -m "feat: add spike detection cron + nodejs_compat for aws4fetch"
```

---

### Task 11: Provision Secrets + Deploy Worker

- [ ] **Step 1: Create Serper.dev account and get API key**

Sign up at https://serper.dev, grab the API key. Store in 1Password:
```bash
op item create --vault Automation --category 'API Credential' --title 'Serper.dev API Key' 'credential=<key>'
```

- [ ] **Step 2: Set up Google OAuth credentials**

In Google Cloud Console (`rrm-academy` project):
1. APIs & Services > Credentials > Create OAuth 2.0 Client ID
2. Application type: Web application
3. Authorized redirect URI: `https://rrmacademy.org/api/admin/seo?action=google-callback`
4. Copy Client ID and Client Secret

Store in 1Password:
```bash
op item create --vault Automation --category 'API Credential' --title 'RRM SEO Monitor Google OAuth' 'client_id=<id>' 'client_secret=<secret>'
```

- [ ] **Step 3: Push secrets to Worker**

```bash
cd ~/iCode/projects/rrm-seo-monitor

# Serper
echo "<key>" | npx wrangler secret put SERPER_API_KEY

# CF Analytics (reuse existing account API token or create scoped one)
echo "<token>" | npx wrangler secret put CF_API_TOKEN
echo "<zone_id>" | npx wrangler secret put CF_ZONE_ID

# Google OAuth
echo "<client_id>" | npx wrangler secret put GOOGLE_CLIENT_ID
echo "<client_secret>" | npx wrangler secret put GOOGLE_CLIENT_SECRET

# SES (same creds as observatory)
# First verify field names (1Password items can have non-standard field names):
source ~/.zshrc
op item get 'AWS SES Credentials' --vault Automation --format json | jq '.fields[].label'
# Then use the correct field names from the output:
op read 'op://Automation/AWS SES Credentials/access_key_id' | npx wrangler secret put AWS_ACCESS_KEY_ID
op read 'op://Automation/AWS SES Credentials/secret_access_key' | npx wrangler secret put AWS_SECRET_ACCESS_KEY
echo "us-east-1" | npx wrangler secret put AWS_SES_REGION
```

- [ ] **Step 4: Deploy**

```bash
cd ~/iCode/projects/rrm-seo-monitor
npx wrangler deploy
```

- [ ] **Step 5: Smoke test deployed Worker**

First, get the API token:
```bash
# Read the SEO monitor token (same one used in rrm-academy-cf as SEO_MONITOR_API_TOKEN)
export TOKEN=$(op read 'op://Automation/SEO Monitor API Token/credential')
```

Then test:
```bash
# Health (no auth needed)
curl https://rrm-seo-monitor.administrator-cloudflare.workers.dev/health
# Expected: {"ok":true,"worker":"rrm-seo-monitor"}

# Report (should return empty/default data)
curl -H "Authorization: Bearer $TOKEN" \
  https://rrm-seo-monitor.administrator-cloudflare.workers.dev/api/report
# Expected: {"snapshot":{"date":null,...},"sparklines":{...},"alerts":[],"worker":{...}}

# Keywords (should return defaults)
curl -H "Authorization: Bearer $TOKEN" \
  https://rrm-seo-monitor.administrator-cloudflare.workers.dev/api/keywords
# Expected: {"keywords":[{"keyword":"restorative reproductive medicine","tier":"active"},...]}
```

- [ ] **Step 6: Seed initial keyword config**

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://rrm-seo-monitor.administrator-cloudflare.workers.dev/api/keywords \
  -d '{"keywords":[{"keyword":"restorative reproductive medicine","tier":"active"},{"keyword":"naprotechnology courses","tier":"active"},{"keyword":"rrm academy","tier":"active"},{"keyword":"napro technology","tier":"active"},{"keyword":"fertility awareness methods education","tier":"active"},{"keyword":"restorative reproductive medicine training","tier":"active"},{"keyword":"rrm physician training","tier":"active"},{"keyword":"natural fertility treatment","tier":"active"}]}'
```

---

## Chunk 4: Admin Dashboard

### Task 12: Expand Admin Proxy

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/functions/api/admin/seo.js`

**IMPORTANT:** Use the `coder` agent for this task (mandatory for `functions/api/` changes per project rules).

- [ ] **Step 1: Read sibling files for patterns**

Read all files in `functions/api/admin/` to match patterns.

- [ ] **Step 2: Add `onRequestPut` and `onRequestPost` handlers**

Add to existing `seo.js`:

```js
// After the existing onRequestGet, add:

export async function onRequestPut(context) {
  const { request, env } = context;
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
  if (!env.SEO_MONITOR_API_TOKEN) return json({ error: 'SEO service not configured' }, 503);

  const baseUrl = 'https://rrm-seo-monitor.administrator-cloudflare.workers.dev';
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'keywords') {
    try {
      const body = await request.text();
      const resp = await fetch(`${baseUrl}/api/keywords`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.SEO_MONITOR_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = await resp.json();
      return json(data, resp.status);
    } catch {
      return json({ error: 'SEO service unavailable' }, 502);
    }
  }

  return json({ error: `Unknown PUT action: ${action}` }, 400);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
  if (!env.SEO_MONITOR_API_TOKEN) return json({ error: 'SEO service not configured' }, 503);

  const baseUrl = 'https://rrm-seo-monitor.administrator-cloudflare.workers.dev';
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'dismiss') {
    try {
      const body = await request.text();
      const resp = await fetch(`${baseUrl}/api/alerts/dismiss`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SEO_MONITOR_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = await resp.json();
      return json(data, resp.status);
    } catch {
      return json({ error: 'SEO service unavailable' }, 502);
    }
  }

  return json({ error: `Unknown POST action: ${action}` }, 400);
}
```

And add new GET actions to the existing `onRequestGet` switch:

```js
case 'report':
  workerUrl = `${baseUrl}/api/report`;
  break;

case 'history':
  workerUrl = `${baseUrl}/api/report/history`;
  break;

case 'keywords':
  workerUrl = `${baseUrl}/api/keywords`;
  break;

case 'alerts':
  workerUrl = `${baseUrl}/api/alerts`;
  break;

case 'google-auth':
  workerUrl = `${baseUrl}/api/auth/google`;
  break;

case 'google-callback': {
  const code = url.searchParams.get('code');
  const cbUrl = `${baseUrl}/api/auth/google/callback?code=${encodeURIComponent(code || '')}`;
  try {
    const resp = await fetch(cbUrl, { headers: workerHeaders, redirect: 'manual' });
    if (resp.status === 302) {
      return new Response(null, { status: 302, headers: { Location: '/admin/seo' } });
    }
    const data = await resp.json();
    return json(data, resp.status);
  } catch {
    return json({ error: 'OAuth callback failed' }, 502);
  }
}
```

- [ ] **Step 3: Run security guard**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run guard:update
npm run guard
```

- [ ] **Step 4: Commit**

```bash
git add functions/api/admin/seo.js scripts/guard-manifest.json
git commit -m "feat: expand admin SEO proxy with report/keywords/alerts/OAuth routes"
```

---

### Task 13: Rewrite Admin Dashboard Page

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/src/pages/admin/seo.astro`

Read `STYLE-GUIDE.md` before this task. Use existing admin palette variables.

- [ ] **Step 1: Read current seo.astro and STYLE-GUIDE.md**

```bash
cat src/pages/admin/seo.astro
cat STYLE-GUIDE.md
```

- [ ] **Step 2: Rewrite seo.astro as the living dashboard**

The page is a static Astro page that fetches data client-side via `fetch('/api/admin/seo?action=report')`. All rendering is client-side JS since data loads after auth.

**Read first:**
- Spec response shape: `docs/superpowers/specs/2026-03-12-living-seo-report-design.md` lines 68-99 (the `/api/report` JSON contract)
- Design tokens: `docs/superpowers/specs/2026-03-12-living-seo-report-design.md` lines 233-244
- Current admin page: `src/pages/admin/seo.astro` (preserve the admin bar pattern)
- `STYLE-GUIDE.md` for design system variables

**Important:** The current `seo.astro` has an Observatory/Worker Health section with activity tables and alert cards. Preserve that data display as the "Worker Health" card in the new layout. Do not drop it.

**Data source:** Single `fetch('/api/admin/seo?action=report')` returns the full report payload. All rendering is client-side JS since the page loads after auth.

**Field-to-UI mapping (from spec response shape):**

| UI Section | JSON path | Rendering |
|-----------|-----------|-----------|
| KPI: Clicks | `snapshot.gsc.clicks` + `snapshot.gsc.clicksDelta` | Large number + WoW delta (green/red) |
| KPI: Impressions | `snapshot.gsc.impressions` + `snapshot.gsc.impressionsDelta` | Same pattern |
| KPI: CTR | `snapshot.gsc.ctr` + `snapshot.gsc.ctrDelta` | Percentage format |
| KPI: Position | `snapshot.gsc.position` + `snapshot.gsc.positionDelta` | Lower is better (invert color) |
| KPI: Visitors | `snapshot.traffic.visitors` | CF Analytics estimate |
| Sparklines | `sparklines.clicks[]`, etc. | Inline SVG polyline, 90 data points, 120x32px. Simple: map values to y-coordinates within viewBox |
| Keyword table | `snapshot.keywords[]` | `.keyword`, `.position`, `.change` (positive=green), `.features[]` as badges, `.tier` as A/W badge |
| Top Pages | `snapshot.traffic.topPages[]` (from GSC) | `.path`, `.clicks`, `.impressions`. Show 3 rows + "View all" |
| Top Queries | `snapshot.traffic.topQueries[]` (from GSC) | `.query`, `.clicks`, `.position`. Show 3 rows + "View all" |
| Traffic Alerts | `alerts[]` where `type='spike'` | `.data.path`, `.data.currentViews`, `.data.ratio`. Dismiss button |
| Site Health | `snapshot.health.checks[]` | Green/red dot + `.name` + `.detail` |
| Worker Health | `worker.lastDaily`, `.lastSpike`, `.lastWeekly`, `.kvDays`, `.gscConnected` | Timestamps (relative "2h ago"), GSC status with "Connect" button if false |
| Bell icon | `alerts[]` | Red dot if `alerts.length > 0`. Click opens dropdown listing alerts with dismiss buttons |

**Edit Keywords modal:**
- Fetch current keywords: `fetch('/api/admin/seo?action=keywords')`
- Display two lists: Active (max 15) and Watchlist (max 30) with count remaining
- Each row: text input + tier toggle (A/W) + delete button
- "Add keyword" button at bottom of each list
- Save: `PUT /api/admin/seo?action=keywords` with `{ keywords: [...] }`
- Show validation errors from the API response

**CSS approach:**
- Use `<style>` block with CSS custom properties matching design tokens
- Mobile breakpoint: `@media (max-width: 768px)` for stacked layout
- KPI strip: flexbox row on desktop, CSS grid 3x2 on mobile
- Three-column: `display: grid; grid-template-columns: 1fr 1fr 1fr` on desktop, single column on mobile
- On mobile: Traffic Alerts moves above Keyword Rankings (most actionable first). Top Pages/Queries hidden behind "View all"

**JS approach:**
- Single `fetchReport()` function on page load
- Renders all sections from the report JSON
- `refreshReport()` for the Refresh button
- `toggleKeywordModal()` for edit keywords
- `dismissAlert(id)` for bell icon alerts -- `POST /api/admin/seo?action=dismiss` with `{ id }`
- `renderSparkline(container, data)` -- creates an inline SVG polyline
- "View all" toggles expand inline (no navigation), showing up to 25 items from the already-loaded data

**Note:** This file will be ~500-700 lines. That's acceptable for a single admin page with inline JS. Do not split into components -- admin pages in this project are self-contained Astro pages.

- [ ] **Step 3: Test locally**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run build
```

The page should build without errors. Full testing requires the running Worker with data.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/seo.astro
git commit -m "feat: rewrite admin SEO page as living analytics dashboard"
```

---

### Task 14: End-to-End Smoke Test + Deploy

- [ ] **Step 1: Trigger a manual daily collection on the Worker**

Use wrangler to trigger the daily cron manually:

```bash
cd ~/iCode/projects/rrm-seo-monitor
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://rrm-seo-monitor.administrator-cloudflare.workers.dev/api/check
```

Alternatively, wait for the 06:00 UTC cron or temporarily change it to run sooner.

- [ ] **Step 2: Connect GSC**

Visit `https://rrmacademy.org/admin/seo` and click "Connect GSC". Complete the Google OAuth flow. Verify the dashboard shows "GSC connected" in Worker Health.

- [ ] **Step 3: Verify dashboard loads with real data**

After the first daily collection has run:
1. Visit `/admin/seo`
2. Confirm KPI strip shows real numbers
3. Confirm keyword rankings show positions
4. Confirm health checks show status dots
5. Test bell icon -- should show alerts if any exist
6. Test "Edit keywords" modal -- add/remove a test keyword
7. Test "Refresh" button
8. Test mobile layout (resize browser or use device toolbar)

- [ ] **Step 4: Verify email delivery**

Check `administrator@rrmacademy.org` for:
1. Daily SEO report email (after 06:00 UTC cron runs)
2. If a spike was detected, verify spike alert email

- [ ] **Step 5: Deploy rrm-academy-cf**

```bash
cd ~/iCode/projects/rrm-academy-cf
git push origin main
```

GitHub Actions will build and deploy to CF Pages.

- [ ] **Step 6: Final production verification**

Visit `https://rrmacademy.org/admin/seo` and confirm everything works on the live site.
