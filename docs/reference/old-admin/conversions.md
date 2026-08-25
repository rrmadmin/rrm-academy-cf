# Old Admin: Conversions

Source: `src/pages/admin/conversions.astro` + `functions/api/admin/conversions.js` + `functions/api/admin/_ga4.js`

## Purpose

Shows GA4 conversion funnel metrics (page views, signups, leads, checkouts, purchases) as daily totals, rate cards, a daily breakdown table, and a by-source breakdown table, over a selectable period.

## API endpoints the page calls

- `GET /api/admin/conversions?period=7d|28d|90d` (default `28d`) -- the only endpoint. No write actions.

## Data model

- **External API**: GA4 Data API (`analyticsdata.googleapis.com/v1beta`), via OAuth refresh-token flow (`_ga4.js` `getAccessToken()` exchanges `env.GA4_OAUTH_CREDS` for a bearer token, then `runReport()` POSTs `:runReport`).
- **Env required**: `GA4_OAUTH_CREDS` (JSON: client_id/client_secret/refresh_token), `GA4_PROPERTY_ID`. Returns 500 `GA4 not configured` if either is missing.
- **KV cache**: `COMMUNITY_KV`, key `ga4:conversions:<period>`, TTL 3600s (1 hour). Cache read is non-fatal (falls through to live fetch on KV error); cache write is non-fatal (via `waitUntil`, failure discarded).
- Three GA4 reports run in parallel per request:
  1. **Summary**: `eventCount` + `totalUsers` by `eventName`, filtered to `purchase, begin_checkout, sign_up, generate_lead, page_view`.
  2. **Daily timeline**: same event filter, dimensioned by `date` + `eventName`, ordered by date.
  3. **By source**: same event filter, dimensioned by `sessionSource` + `eventName`, `eventCount`/`totalUsers`, ordered by eventCount desc, limit 100.
- Response shape surfaced to the page: `{ period, events: {eventName: {count, users}}, timeline: [{date, page_view, sign_up, generate_lead, begin_checkout, purchase}], sources: [{source, views, signups, leads, checkouts, purchases}], fetchedAt }`.

## Actions available in the UI

- **Period selector** (7d/28d/90d dropdown) -- re-fetches on change.
- **Refresh button** -- re-fetches current period.
- No forms, no writes. Purely a read-only dashboard.

## Auth level required

Superadmin session auth (`requireSuperAdmin(request, env.DB)` in the handler). Session gate itself is best-effort in `functions/api/admin/_middleware.js` (populates `context.data.user`/`session` from a valid cookie, does not enforce); each endpoint enforces its own auth, and this one requires superadmin specifically.

## Port status

ported to rrm-backoffice (/conversions)
