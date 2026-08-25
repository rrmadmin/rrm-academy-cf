# Old Admin: Content

## Purpose

Content-performance dashboard pulling GA4 traffic metrics (page views, users, sessions, duration, bounce rate) overall and broken down by content category (Library / Courses / Community / Blog / Guides / Other), plus top-pages and top-referrers tables.

## API endpoints the page calls

- `GET /api/admin/content?period=7d|28d|90d` (default `28d`) -- returns the full report payload for the selected window.

## Data model

- **External API**: GA4 Data API, via `functions/api/admin/_ga4.js` helpers `getAccessToken(env)` (OAuth from `env.GA4_OAUTH_CREDS`) and `runReport(accessToken, propertyId, requestBody)` against `env.GA4_PROPERTY_ID`. Three parallel GA4 reports are run per request:
  - Top pages: `screenPageViews`, `totalUsers`, `averageSessionDuration` by `pagePath`, top 30 by views.
  - Top referrers: `sessions`, `totalUsers` by `sessionSource`, top 15 by sessions.
  - Overview: `screenPageViews`, `totalUsers`, `sessions`, `averageSessionDuration`, `bounceRate` (no dimension, single aggregate row).
- **KV**: `env.COMMUNITY_KV`, cache key `admin:content:<period>`, TTL 3600s. Cache read/write failures are non-fatal (fall through to a live GA4 fetch; a cache-write failure never discards a successfully-fetched report).
- **No D1 usage.**
- **Category classification** (done in the endpoint from the top-pages result, by path prefix): `/library/*` -> library, `/courses/*` -> courses, `/community/*` -> community, `/commentary/*` or `/blog/*` -> blog, a hardcoded guide-path list (`/naprotechnology`, `/what-is-rrm`, `/femm`, `/neofertility`, `/glossary`, `/common-questions-about-rrm`, `/guides`) -> guides, everything else -> other.
- **Key fields surfaced**: summary (`pageViews`, `users`, `sessions`, `avgSessionDuration`, `bounceRate`), `categories` (view totals per bucket), `pages[]` (`path`, `views`, `users`, `avgDuration`), `referrers[]` (`source`, `sessions`, `users`), `fetchedAt` timestamp.

## Actions available in the UI

- **Period select** (7 / 28 / 90 days): reloads the report for the chosen window.
- **Refresh button**: re-fetches (subject to the KV cache; a fresh fetch happens once the cached copy expires or KV is unavailable).
- **Logout button**: standard session logout.

This page is read-only -- no writes, no mutating actions.

## Auth level required

Superadmin (session cookie, `requireSuperAdmin` in `functions/api/admin/content.js`). `functions/api/admin/_middleware.js` only best-effort populates `context.data.user`/`session` -- each endpoint enforces its own auth.

## Port status

NOT PORTED -- reference for a future backoffice surface
