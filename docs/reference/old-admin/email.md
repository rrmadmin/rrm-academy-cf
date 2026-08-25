# Old Admin: Email Observatory

Source: `src/pages/admin/email.astro` (1694 lines) + `functions/api/admin/email.js`

## Purpose

Deliverability, broadcast performance, and list-health dashboard covering all transactional and newsletter mail, with a filterable/sortable event log and drill-down drawers for per-broadcast cohorts and per-recipient timelines.

## API endpoints the page calls

Single endpoint, `GET /api/admin/email`, dispatched by a `view` query param (read-only, no POST/PUT/DELETE anywhere on this page):

- `?view=summary&from=&to=` -- KPI cards, send-volume chart, new-subscriber chart, deliverability gauges, list health, top sources.
- `?view=broadcasts` -- campaign breakdown table (per newsletter send).
- `?view=log&from=&to=&page=&sort=&order=&limit=&event=&category=&source=&email=` -- paginated/sortable/filterable event log.
- `?view=cohort&type=&from=&to=&page=&limit=&send_id=` -- recipient list for a given event type (delivery/bounce/complaint/open/click), optionally scoped to one broadcast. Powers the drawer opened by clicking a rate cell.
- `?view=recipient&email=` -- per-recipient timeline + summary stats. Powers the drawer opened by clicking a recipient email.

## Data model

D1 `rrm-auth` tables, all reads:
- `email_log` -- transactional/newsletter/campaign send + failure events (`event` in `send`, `failed`). Fields used: id, event, email, category, source, subject, detail, send_id, created_at.
- `email_event` -- SES delivery/bounce/complaint/open/click/reject feed (`event_type`). Explicitly documented as "held/empty" until the SES event feed is wired -- all queries against it are empty-safe (COALESCE to 0/[]), so the page never errors, it just shows zeros.
- `newsletter_subscriber` -- list composition (active/unsubscribed/bounced/complained/total), organic vs. `source='import'` unsubscribes and new-subscriber counts.
- `newsletter_send` -- one row per broadcast (subject, sent_at, status, total_recipients, sent_count, open_count, click_count, bounce_count), joined with correlated `email_event` subqueries for delivered/complained.
- `newsletter_event` -- pixel-tracked opens/clicks (`event` in `opened`/`clicked`), merged into engagement totals alongside `email_event`.

Key aggregates per view:
- **summary**: 12 parallel queries -> list health, sends totals (transactional/newsletter/campaign) + by-day + by-source (top 12), deliverability totals + by-day (bounce_rate, complaint_rate), engagement (opens/clicks combined from email_event + newsletter_event, `tracked` flag = true once email_event has any open/click rows), subscribers-by-day.
- **broadcasts**: one query per `newsletter_send` row with computed open_rate/click_rate.
- **log**: UNION ALL of `email_log` (event/failed side) and `email_event` (delivery/bounce/complaint/open/click/reject side), filtered/sorted/paginated (max limit 200; email filter is a `LIKE` prefix match, COLLATE NOCASE, `%`/`_` escaped).
- **cohort**: `email_event` rows for one `event_type`, optionally scoped to one `send_id`, paginated (max limit 200).
- **recipient**: UNION of `email_log` + `email_event` for one email (COLLATE NOCASE), plus summary counts (total_sent, delivered, opens, clicks, bounces, complained-from-`newsletter_subscriber.status`) and first_seen/last_activity spanning both tables.

## Actions available in the UI

All read/filter actions, no data mutation:
- **Period segmented control** (7d/30d/90d/1y) -- re-runs summary + log.
- **Send-volume and new-subscriber charts** -- rendered client-side (no chart library dependency noted beyond inline SVG/canvas primitives).
- **Event log filters**: event type, category, source text, email prefix -- **Apply** button re-fetches `view=log`.
- **Sortable log columns**: Time, Event, Recipient, Source (click header to sort/reorder).
- **Log pagination**: Prev/Next buttons.
- **Campaign breakdown row cells** (Open/Click/Bounce/Complaint counts) -- clicking opens the cohort drawer (`view=cohort`) scoped to that broadcast's `send_id`.
- **Recipient email links** -- clicking opens the recipient drawer (`view=recipient`).
- **Export CSV** button inside the cohort drawer -- client-side CSV export of the currently loaded cohort rows (email, ts, bounce_type, feedback_type, link_url, detail); no server call.
- **Logout** button (shared with all admin pages).

## Auth level required

Superadmin session auth (`requireSuperAdmin`) on the single `GET` handler for every view. Same best-effort session middleware as the other admin pages.

## Port status

NOT PORTED -- reference for a future backoffice surface
