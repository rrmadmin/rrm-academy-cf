# Old Admin: Campaign Report

## Purpose

Reporting page showing the visitor cohort who arrived via a tagged `utm_campaign` link (e.g. the STUC member broadcast tag `event-broadcast`), with each visitor's linked member identity (where known) and their on-site page activity after arrival.

## API endpoints the page calls

- `GET /api/admin/campaign-report?campaign=<name>` -- returns the enriched arrival cohort for the given campaign. Default campaign value on first load: `event-broadcast`.

## Data model

- **External API**: `fp.rrmacademy.org/report/campaign` (the RRM fingerprint Worker), called server-to-server with an HMAC-signed request (`X-RRM-Signature: t=<ts>,v1=<hex>`, signed with `env.LINK_HMAC_KEY_CURRENT` over `${ts}.${rawBody}`, mirroring `functions/api/_fp-link.js`). Supplies the raw cohort: `visitor_id`, `user_id`, `arrival_ts`, `entry_path`, `referrer`, `utm_source`, `utm_medium`, `page_count`, `pages[]`, plus `total` and `truncated` flags.
- **D1 (rrm-auth)**: `user` table, queried by the returned `user_id` set to resolve each linked visitor to a member `name`/`email`. No writes.
- **Key fields surfaced per row**: member name/email (or "anonymous visitor"), arrival timestamp, entry page path, traffic source (utm_source/utm_medium, or referrer hostname, or "direct"), page count with an expandable list of visited paths + timestamps.
- **Summary line**: total arrivals, count linked to a member, and a "showing the most recent N" note when the Worker reports `truncated`.

## Actions available in the UI

- **Campaign text input + Load button** (or Enter key): fetches the report for the entered campaign name. No write actions -- this page is read-only.
- **Per-row "N pages" toggle**: expands/collapses the list of visited paths client-side, no API call.

## Auth level required

Superadmin (session cookie, `requireSuperAdmin` in `functions/api/admin/campaign-report.js`). `functions/api/admin/_middleware.js` only best-effort populates `context.data.user`/`session` -- each endpoint enforces its own auth.

## Port status

NOT PORTED -- reference for a future backoffice surface
