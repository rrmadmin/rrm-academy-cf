# Living SEO Report -- Design Spec

**Date:** 2026-03-12
**Status:** Draft
**Project:** rrm-seo-monitor + rrm-academy-cf

## Problem

The current `/admin/seo/` page shows 7 pass/fail health checks. It tells you if something is broken but nothing about how the site is performing. There is no visibility into traffic trends, keyword rankings, search console data, or traffic spikes without leaving the admin dashboard and checking multiple external tools.

## Solution

Expand the seo-monitor Worker into a full data collection engine and replace the `/admin/seo/` page with a living report that surfaces real analytics data, updated daily.

## Data Sources

All free or free-tier. No Ahrefs dependency.

| Source | What it provides | Auth |
|--------|-----------------|------|
| CF Analytics GraphQL | Traffic, pageviews, cache rate, status codes, per-path breakdowns | CF API token (existing) |
| Google Search Console API | Clicks, impressions, CTR, position, top queries, top pages | OAuth (new, refresh token in KV) |
| SERP API (Serper.dev) | SERP position tracking for tracked keywords, SERP feature detection. 2,500 free searches/month. Fallback: Brave Search API ($5/1K requests, $5 monthly credit) | API key |
| Google Autocomplete | Keyword discovery (related queries, trending). Phase 2 stretch goal -- undocumented endpoint, unreliable from Worker IPs | None |
| Existing health checks | 7 site health checks (pages, sitemap, robots, llms.txt, schema, backlinks, headers) | N/A |

## Architecture

### Single Worker (seo-monitor)

The existing `rrm-seo-monitor` Worker expands to handle all data collection. No new Workers, no n8n dependency, no external orchestration.

```
Data Sources ──► seo-monitor Worker ──► KV Storage
                   │  3 cron triggers        │
                   │  API endpoints           │
                   ▼                          ▼
              Alerts (SES/Telegram)    /admin/seo/ page
```

### Cron Triggers (3 total, fits Workers Paid limit)

| Cron | Schedule | What |
|------|----------|------|
| Spike detection | `*/30 * * * *` | CF Analytics `httpRequestsAdaptiveGroups` for per-path pageviews (last 30 minutes -- accepts ~15-min data lag, catches spikes within ~45 min). Compare vs 7-day rolling average. Alert if any page exceeds 3x baseline. 48 invocations/day. Does NOT run health checks or send daily reports -- isolated path |
| Daily collection | `0 6 * * *` | Full data pull: CF Analytics, GSC, Serper SERP tracking (Active keywords). Store snapshot. Send daily email report via SES |
| Weekly crawl + digest | `0 14 * * 6` | Broken link crawl + Serper SERP tracking (Watchlist keywords). Weekly email digest |

**Cron isolation:** Each cron path is independent. When `*/30` fires at 06:00 UTC (same minute as daily), CF Workers fires them as separate invocations. The `scheduled()` handler routes by `event.cron` string match -- spike detection never runs health checks or sends the daily report.

**CPU budget note:** Daily cron runs health checks + CF Analytics + GSC + Serper keyword loop + SES email. With 15 Active keywords at 1s delay each, wall time approaches 20s. If this nears the 30s Workers Paid CPU limit, split keyword checks across spike detection invocations (piggyback 2-3 keywords per 30-min cycle throughout the day).

### KV Storage Schema

All data stored in the existing `BASELINES` KV namespace.

| Key pattern | Contents | Retention |
|-------------|----------|-----------|
| `snapshot:{YYYY-MM-DD}` | Full daily snapshot (traffic, GSC, keywords, health). Target: <500 KB per snapshot. `expirationTtl: 7776000` (90 days) | 90 days |
| `sparklines` | Rolling 90-day array of daily KPI values (clicks, impressions, CTR, position, visitors). Updated by daily cron. Single key read instead of 30+ snapshot reads | Overwritten |
| `spike:{YYYY-MM-DD-HH}` | Per-path pageview data for spike comparison. `expirationTtl: 604800` (7 days) | 7 days (rolling) |
| `keywords:config` | Keyword list with tiers (Active/Watchlist) | Persistent |
| `gsc:refresh_token` | Google OAuth refresh token | Persistent |
| `last_results` | Most recent check results (existing) | Overwritten |
| `last_crawl` | Most recent crawl results (existing) | Overwritten |
| `alerts:active` | Currently active alerts for bell icon | Overwritten |

### `/api/report` Response Shape

```json
{
  "snapshot": {
    "date": "2026-03-12",
    "traffic": {
      "visitors": 1200, "pageviews": 4800, "cacheRate": 0.92,
      "topPages": [{ "path": "/library/", "clicks": 142, "impressions": 18200 }],
      "topQueries": [{ "query": "rrm academy", "clicks": 84, "position": 1.2 }]
    },
    "gsc": {
      "clicks": 558, "impressions": 62000, "ctr": 0.009, "position": 6.9,
      "clicksDelta": 0.12, "impressionsDelta": 0.08, "ctrDelta": 0, "positionDelta": -0.3
    },
    "keywords": [
      { "keyword": "restorative reproductive medicine", "tier": "active", "position": 3, "change": 2, "url": "/library/...", "features": ["paa"] }
    ],
    "health": { "ok": true, "checks": [{ "name": "pages", "ok": true, "detail": "..." }] }
  },
  "sparklines": {
    "clicks": [558, 542, 530], "impressions": [62000, 61200, 59800],
    "ctr": [0.009, 0.0089], "position": [6.9, 7.2], "visitors": [1200, 1150]
  },
  "alerts": [
    { "id": "spike-2026-03-12-08", "type": "spike", "page": "/library/endometriosis-...", "magnitude": 3.4, "timestamp": "..." }
  ],
  "worker": {
    "lastDaily": "2026-03-12T06:02:14Z", "lastSpike": "2026-03-12T07:30:01Z",
    "lastWeekly": "2026-03-08T14:01:22Z", "kvDays": 42, "gscConnected": true
  }
}
```

**Note:** "Visitors" comes from CF Analytics `uniq` field in `httpRequests1dGroups` -- this is an estimate, not exact.

### New API Endpoints

Added to existing seo-monitor Worker API (all Bearer auth).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/report` | Full dashboard data (latest snapshot + 30-day history for sparklines) |
| GET | `/api/report/history` | Paginated historical snapshots for drill-down |
| GET | `/api/keywords` | Current keyword config |
| PUT | `/api/keywords` | Update keyword list/tiers |
| GET | `/api/alerts` | Active alerts |
| POST | `/api/alerts/dismiss` | Dismiss an alert |
| GET | `/api/auth/google` | Redirect to Google OAuth consent |
| GET | `/api/auth/google/callback` | OAuth callback, store refresh token |

### Admin Page Proxy

The existing `functions/api/admin/seo.js` in rrm-academy-cf proxies to the seo-monitor Worker. It uses `?action=` query parameter routing with a switch statement.

**New actions (added to existing switch):**

| Action param | Method | Worker endpoint |
|-------------|--------|----------------|
| `report` | GET | `/api/report` |
| `history` | GET | `/api/report/history` |
| `keywords` | GET | `/api/keywords` |
| `keywords` | PUT | `/api/keywords` |
| `alerts` | GET | `/api/alerts` |
| `dismiss` | POST | `/api/alerts/dismiss` |
| `google-auth` | GET | `/api/auth/google` (redirect) |
| `google-callback` | GET | `/api/auth/google/callback` |

Keep `onRequestOptions` for CORS preflight. Add `onRequestPut` and `onRequestPost` handlers alongside existing `onRequestGet` (CF Pages Functions resolves method-specific handlers before catch-all, so CORS preflight is safe). Each handler reads `?action=` and routes accordingly.

The existing `cached` action is replaced by `report`. The old `check` and `baseline` actions remain for backward compatibility during transition.

## Google OAuth (GSC)

Direct OAuth in the Worker. No n8n relay.

1. One-time: Admin clicks "Connect GSC" on the dashboard, which hits `?action=google-auth` on the proxy
2. Proxy redirects to Worker's `/api/auth/google`, which builds the Google OAuth URL with `redirect_uri=https://rrmacademy.org/api/admin/seo?action=google-callback`
3. Google redirects back to the proxy with the auth code. Proxy forwards to Worker's `/api/auth/google/callback`
4. Worker exchanges code for refresh token, stores in KV as `gsc:refresh_token`
5. Daily cron uses refresh token to get access token, queries GSC API
6. If refresh token expires/fails, bell icon shows "GSC disconnected" alert

**Redirect URI:** `https://rrmacademy.org/api/admin/seo?action=google-callback` -- registered in Google Cloud project `rrm-academy`. This keeps the OAuth flow on the production domain, not exposed Workers URLs.

Google Cloud project: `rrm-academy` (existing). Scopes: `webmasters.readonly`.

## Keyword Tracking

Two tiers, configurable from the admin page.

| Tier | Check frequency | Purpose |
|------|----------------|---------|
| Active | Daily (via Serper API) | Core keywords you're actively optimizing for |
| Watchlist | Weekly (Saturday crawl) | Keywords you're monitoring but not actively targeting |

Initial Active keywords (from existing seo-dashboard config): `restorative reproductive medicine`, `naprotechnology courses`, `rrm academy`, `napro technology`, `fertility awareness methods education`, `restorative reproductive medicine training`, `rrm physician training`, `natural fertility treatment`

Serper API: 1 request per keyword. Extracts position, URL, SERP features (featured snippet, PAA, knowledge panel). Returns structured JSON (no HTML parsing needed).

**Free tier:** Serper.dev offers 2,500 free searches/month. With 15 Active keywords daily (450/month) plus Watchlist weekly, this fits comfortably. **Cap Active keywords at 15, Watchlist at 30** to stay within the free tier. If Serper changes pricing, Brave Search API ($5/1K requests, $5 monthly credit) is the fallback.

## Spike Detection

Every 30 minutes via cron.

1. Query CF Analytics GraphQL `httpRequestsAdaptiveGroups` for per-path pageviews in the last 30 minutes (accepts ~15-min data lag -- spikes detected within ~45 min total, which is honest for a 30-min cron)
2. Compare each path against its 7-day rolling average for the same 30-minute time-of-day window
3. If any page exceeds 3x its baseline, trigger email alert via SES
4. Alert includes: page path, current views, baseline average, percentage increase
5. Dedup: don't re-alert for the same page within 6 hours

## Alerting

| Channel | When | Content |
|---------|------|---------|
| Email (SES) | Daily 06:00 UTC | Full report: KPIs, top pages, top queries, keyword rankings, health status. Top 25 in each category |
| Email (SES) | Traffic spike detected | Page path, spike magnitude, current vs baseline |
| Telegram | Problem detected | Health check failures, GSC disconnection, Worker errors |
| Bell icon | Actionable items | Red dot on bell in admin header. Dismissable. Persisted in KV |

SES sending: reuse the existing SES pattern from rrm-observatory (aws4fetch, `@mail.rrmacademy.org` sender). Recipient: `administrator@rrmacademy.org` (hardcoded, same as observatory alerts).

**Graceful degradation:** If Serper API is down/rate-limited during daily collection, keyword section shows last-known positions with a "stale" indicator. GSC failures show "GSC unavailable" with last-known data. Dashboard never shows empty sections -- always falls back to last successful data.

**Daily email format:** HTML email with inline styles (no external CSS -- email clients strip it). Mirrors the dashboard layout: KPI summary row, keyword changes table, top pages/queries tables, health status. Rendered server-side in the Worker using template literals. Plain text fallback for email clients that strip HTML.

## Admin Page Design

### Desktop (1440px)

Single-page dashboard replacing the current health-check-only page. All sections load from a single `/api/admin/seo` proxy call that returns the full report payload.

**Layout (top to bottom):**

1. **Admin bar** -- existing nav (Backlinks, Conversions, Content, SEO Report, Revenue)
2. **Header row** -- "SEO Report" title, last-updated timestamp, bell icon with red notification dot, Refresh button, date range selector (7d/30d/90d)
3. **KPI strip** -- single compact row: Clicks | Impressions | CTR | Position | Visitors. Each shows value + WoW delta with color coding (green positive, red negative)
4. **Keyword Rankings** -- full-width table. Columns: Tier badge (A/W), Keyword, Position, Change, SERP Features. "Edit keywords" button
5. **Three-column row** -- Top Pages (path, clicks, impressions) | Top Queries (query, clicks, position) | Traffic Alerts (page, views, delta %). Each with 3 rows + "View all" link
6. **Two-column row** -- Site Health (status dots + values) | Worker Health (cron status, KV usage, OAuth status)

### Mobile (390px)

Stacked single-column layout. Same data, reordered for mobile priority.

1. **Admin bar** -- logo + hamburger menu
2. **Header** -- title, bell icon, refresh button
3. **KPI grid** -- 3x2 card grid (each card: label, large value, delta)
4. **Traffic Alerts** -- first on mobile (most actionable)
5. **Keyword Rankings** -- compact table (Keyword, POS, CHG columns)
6. **Site Health** -- full-width card list
7. **Worker Health** -- full-width card list

Top Pages and Top Queries move behind "View all" drill-down on mobile to reduce scroll depth.

### Drill-down Views

"View all" links expand to full paginated tables showing top 25 items. Rendered client-side from the same API payload (no additional fetch). Back button returns to dashboard.

### Edit Keywords UI

"Edit keywords" button opens a modal overlay with two lists (Active/Watchlist). Each keyword row: text input + delete button. Tier toggle (A/W) to move between lists. "Add keyword" button at bottom of each list. Save triggers PUT to `?action=keywords`. Active capped at 15, Watchlist at 30 (Serper free tier budget). Client-side validation shows count remaining. No separate page.

### Design Tokens

Uses existing admin palette from rrm-academy-cf:

- Page background: `#FAF8F5`
- Surface: `#FFFFFF`
- Admin bar: `#3D2A32`
- Rose accent: `#8A606E` / `#C9A8B2` / `#F0E5E9`
- Border: `#D9D3CC`
- Success: `#2D8A4E`
- Warning: `#D4840A`
- Error: `#C53030`
- Typography: Inter (data), Cormorant Garamond (headings)

## New Secrets Required

| Secret | Worker | Purpose |
|--------|--------|---------|
| `SERPER_API_KEY` | seo-monitor | Serper.dev API for SERP tracking (fallback: Brave Search API) |
| `CF_API_TOKEN` | seo-monitor | CF Analytics GraphQL (zone:analytics:read) |
| `CF_ZONE_ID` | seo-monitor | Zone ID for rrmacademy.org |
| `GOOGLE_CLIENT_ID` | seo-monitor | GSC OAuth |
| `GOOGLE_CLIENT_SECRET` | seo-monitor | GSC OAuth |
| `AWS_ACCESS_KEY_ID` | seo-monitor | SES email sending |
| `AWS_SECRET_ACCESS_KEY` | seo-monitor | SES email sending |
| `AWS_SES_REGION` | seo-monitor | SES region |

## What Does NOT Change

- The 7 existing health checks remain as-is
- The broken link crawler remains as-is
- The weekly Telegram digest remains as-is
- The existing KV keys (`last_results`, `last_crawl`, `sitemap_count`, `robots_hash`) stay
- The admin proxy pattern (`functions/api/admin/seo.js`) stays the same, just routes more paths

## Success Criteria

1. Daily email report arrives by 06:15 UTC with real data
2. Traffic spike on any page triggers email alert within 30 minutes
3. Keyword position changes visible on dashboard within 24 hours
4. GSC data (clicks, impressions, CTR, position) shown on dashboard
5. Bell icon shows actionable alerts, dismissable
6. All data persists 90 days for trend analysis
7. No external paid dependencies (no Ahrefs, no third-party dashboards)
