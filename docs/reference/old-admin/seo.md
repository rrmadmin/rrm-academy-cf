# Old Admin: SEO Report (`/admin/seo/`)

## Purpose

Dashboard surfacing GSC (Google Search Console) traffic KPIs, keyword rank tracking, top pages/queries, SEO alerts, and an embedded Observatory health panel, all proxied through the `rrm-seo-monitor` and `rrm-observatory` Workers.

## API endpoints the page calls

All calls go through a single client-side `apiCall(action, opts)` helper hitting `/api/admin/seo?action=<action>`, plus one direct logout call. The page itself only ever calls `functions/api/admin/seo.js` -- it does NOT call `functions/api/admin/search-queries.js` or `functions/api/admin/ecosystem.js` (verified: no `fetch(` to either path anywhere in `seo.astro`; those are standalone Bearer-token endpoints unrelated to this page).

- `GET /api/admin/seo?action=report` -- main dashboard load (`fetchReport()`, called on page load and by the Refresh button)
- `GET /api/admin/seo?action=observatory` -- lazy-loaded when the Observatory panel is expanded, and by its own Refresh button
- `GET /api/admin/seo?action=google-auth` -- plain `<a href>` link shown when GSC is disconnected (not a fetch call); starts the OAuth consent flow
- `POST /api/admin/seo?action=dismiss` -- dismiss one alert, body `{id}`
- `PUT /api/admin/seo?action=keywords` -- save the edited keyword list, body `{keywords: [{keyword, tier}]}`
- `POST /api/auth/logout` -- shared logout button

The backend `functions/api/admin/seo.js` also implements `action=check`, `action=baseline`, `action=cached`, `action=history`, `action=keywords` (GET), `action=alerts`, and `action=google-callback`, none of which this page's client JS calls directly -- they exist for other consumers or were left over from an earlier version of the UI.

## Data model

- **`functions/api/admin/seo.js`** is a pure proxy/router: no D1 reads/writes of its own. Session-checks via `requireSuperAdmin`, then forwards to:
  - `rrm-seo-monitor` Worker (`https://rrm-seo-monitor.administrator-cloudflare.workers.dev`) for `/api/check`, `/api/baseline`, `/api/report`, `/api/report/history`, `/api/keywords`, `/api/alerts`, `/api/alerts/dismiss`, `/api/auth/google`, `/api/auth/google/callback` -- Bearer `env.SEO_MONITOR_API_TOKEN`
  - `rrm-observatory` Worker (`https://rrm-observatory.administrator-cloudflare.workers.dev/api/health`) for `action=observatory` -- Bearer `env.OBSERVATORY_API_TOKEN`
- The report response shape consumed client-side: `snapshot.gsc` (segments: core pages/library/commentary/branded/non-brand clicks+impressions, top pages, top queries), `snapshot.keywords` (tier `active`/`watch`, position, change, SERP features), `snapshot.health`, `sparklines`, `alerts[]`, `worker` (health/status of rrm-seo-monitor incl. `gscConnected`, `lastDaily`).
- **`functions/api/admin/search-queries.js`** (read separately per task instructions, not called by this page): queries `env.ANALYTICS_DB` (D1 `rrm-analytics`, table `search_log`) for site-search query logs (`ask`/`semantic`/`pagefind` sources). Views: `list`, `top`, `gaps` (zero-result queries), `users` (distinct user/IP/query counts). Auth is a standalone constant-time-compared `ADMIN_API_SECRET` Bearer token, NOT session-based -- a different auth mechanism than the rest of this page.
- **`functions/api/admin/ecosystem.js`** (checked per task instructions): also standalone, `ADMIN_API_SECRET` Bearer auth, reads the ecosystem SSOT JSON from D1 `system_config`. Not called by `seo.astro`.

## Actions available in the UI

- **Refresh** (top bar) -- re-fetches `action=report` and re-renders KPIs, segments, keywords, top pages/queries, alerts, health, worker status
- **Alert bell dropdown** -- lists alerts; each has a dismiss button -> `POST action=dismiss {id}`, removes it client-side on success
- **Edit keywords** modal -- add/remove/move keywords between `active` (max 15) and `watch` (max 30) tiers, Save -> `PUT action=keywords {keywords}`, then closes modal and re-fetches the report
- **Observatory panel** toggle -- expand/collapse; lazy-loads `action=observatory` on first expand; has its own Refresh button
- **GSC "Disconnected" link** -- plain link to `action=google-auth`, starts OAuth reconnect flow (server-side redirect handling in `google-callback` action)
- **Logout** button (shared admin-bar chrome)

## Auth level required

Superadmin, session-based (`requireSuperAdmin(request, env.DB)` in `functions/api/admin/seo.js`, all three HTTP methods). Note: `search-queries.js` and `ecosystem.js`, while living in the same directory, use a separate `ADMIN_API_SECRET` Bearer-token auth model and are not gated by session/superadmin at all.

## Port status

NOT PORTED -- reference for a future backoffice surface
