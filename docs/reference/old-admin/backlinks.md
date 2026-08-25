# Old Admin: Backlinks

## Purpose

Dashboard for reviewing and re-checking the site's inbound backlink inventory (status, dofollow state, Domain Rating) sourced from the standalone `rrm-backlinks` Worker.

## API endpoints the page calls

- `POST /api/admin/backlinks` -- single action-routed proxy endpoint. Body: `{ action, params }`. Actions used by the UI: `summary`, `list` (optional `status` filter), `check` (re-check one link by `id`). The handler also supports `verify` and `top` actions (not called by this page's UI).

## Data model

- **External API**: `rrm-backlinks` Worker (`env.BACKLINKS_WORKER_URL`, Bearer `env.BACKLINKS_API_TOKEN`). This endpoint is a pure proxy -- it holds no D1 table of its own and does not touch D1.
- **Worker routes proxied**: `GET /health` (verify), `GET /api/backlinks/summary`, `GET /api/backlinks` (list, filterable by `status`/`domain`/`source`), `GET /api/backlinks/changes`, `GET /api/backlinks/top`, `POST /api/check/:id` (re-check).
- **Key fields surfaced per backlink**: `referring_url`, `referring_domain`, `target_path`, `status` (`live` / `dead` / `nofollow_changed` / `unchecked` / `timeout`), `domain_rating`, `is_dofollow`, `last_checked`.
- **Summary aggregates**: `total`, `by_status.live`, `by_status.dead`, `dofollow_count`.

## Actions available in the UI

- **Status filter dropdown**: re-runs `list` with a `status` param (All / Live / Dead / Nofollow Changed / Unchecked / Timeout).
- **Refresh button**: reloads summary + list.
- **Column header click**: client-side sort only, no API call.
- **Check button (per row)**: POSTs `check` action for that backlink's `id`, triggering the Worker to re-verify the link live, then reloads the list.
- **Logout button**: standard session logout, redirects to `/login/`.

## Auth level required

Superadmin (session cookie, `requireSuperAdmin` in `functions/api/admin/backlinks.js`). `functions/api/admin/_middleware.js` only best-effort populates `context.data.user`/`session` from the cookie -- it does not itself enforce auth; each endpoint (including this one) does its own `requireSuperAdmin` check.

## Port status

NOT PORTED -- reference for a future backoffice surface
