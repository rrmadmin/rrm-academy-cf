# Old Admin Dashboard -- Reference Snapshot

This directory is a reference snapshot of the OLD `rrmacademy.org/admin` dashboard (`src/pages/admin/*.astro` + `functions/api/admin/*`), captured 2026-08-25 immediately before its deletion. The deletion follows Brian's 2026-08-21 decision to replace it with `rrm-backoffice` (admin.rrmacademy.org), recorded as "Decision 2026-08-21" in the rrm-backoffice project plan. The old admin surface stayed live in parallel with rrm-backoffice through the C1-C6 converge build; this snapshot exists so the un-ported pages (backlinks, campaign-report, community, content, email, partners, seo, and the `/admin/` landing redirect) aren't lost when the source is removed, and so anyone building a future backoffice surface for them has the data model and UI actions on hand without digging through git history.

## Pages

| Page | Purpose | Port status |
|------|---------|-------------|
| [backlinks](backlinks.md) | Inbound backlink inventory (status, dofollow, Domain Rating) sourced from the `rrm-backlinks` Worker | NOT PORTED |
| [campaign-report](campaign-report.md) | Visitor cohort report for a tagged `utm_campaign` link, joined to member identity where known | NOT PORTED |
| [community](community.md) | Approval queue for member requests to own an ownerless Community Action Area | NOT PORTED |
| [content](content.md) | GA4 content-performance dashboard (page views by category, top pages/referrers) | NOT PORTED |
| [conversions](conversions.md) | GA4 conversion funnel metrics (signups, leads, checkouts, purchases) | ported to rrm-backoffice (/conversions) |
| [dm-queue](dm-queue.md) | Human approval queue for LLM-drafted Instagram DM/comment replies (rrm-dm-agent) | ported to rrm-backoffice as a tile only (dm-queue tile in standup-home /); full queue-management page NOT PORTED |
| [email](email.md) | Deliverability, broadcast performance, and list-health dashboard with event log and drill-downs | NOT PORTED |
| [enrollments](enrollments.md) | Course enrollment totals, per-course breakdown, recent-enrollments list | ported to rrm-backoffice (/enrollments) |
| [index](index.md) | Bare redirect from `/admin/` to a specific sub-page, no logic of its own | NOT PORTED (was the /admin landing redirect) |
| [membership](membership.md) | Unified monthly STUC + Foundation donations + Academy revenue report | ported to rrm-backoffice (/membership) |
| [partners](partners.md) | Educational Partner application review: approve, reject, revoke | NOT PORTED |
| [revenue](revenue.md) | Stripe-derived revenue dashboard (MRR, donations, subscriptions, churn, tier breakdown) | ported to rrm-backoffice (/revenue) |
| [seo](seo.md) | GSC traffic KPIs, keyword rank tracking, SEO alerts, embedded Observatory panel | NOT PORTED |

## Handlers kept after deletion

The old `/admin` page tree (`src/pages/admin/`) and its session-gated UI handlers were removed, but a subset of `functions/api/admin/` handlers stayed because they serve non-UI, machine-to-machine callers unrelated to the dashboard itself:

- **`cleanup.js`** -- prunes expired sessions/password-resets/email-verifications from D1. Bearer `ADMIN_API_SECRET` auth, not session-gated. Consumer: the rrm-observatory daily cron.
- **`seo.js`** -- also serves as the Google OAuth redirect URI target consumed by rrm-seo-monitor's auth flow, independent of the deleted `/admin/seo/` UI page.
- **`courses/`** (`index.js`, `[id].js`, `[id]/`, `_shared.js`) -- course CRUD API. Consumers: the `/courses-update` and `/recording-to-course` skills.
- **`faqs/`** (`index.js`, `[id].js`, `[id]/`) -- FAQ CRUD API. Consumer: the readability-rewrite-batch publish step.
- **`ecosystem.js`** -- returns/accepts the ecosystem SSOT JSON from D1 `system_config`, Bearer `ADMIN_API_SECRET` auth. Consumer: `scripts/sync-ecosystem.mjs`.
- **`_middleware.js`** -- best-effort session population for `/api/admin/*` (sets `context.data.user`/`session` from a valid cookie; does not enforce auth itself, each endpoint checks its own requirement). Kept because the surviving handlers above sit under the same route tree; the Bearer-token handlers (`cleanup.js`, `ecosystem.js`, `seo.js`) ignore its output entirely, while `courses/` and `faqs/` rely on it for session-based admin auth.

Handlers not in this kept list (`backlinks.js`, `campaign-report.js`, `community/*`, `content.js`, `conversions.js`, `dm-queue.js` + `dm-queue/[id].js`, `email.js`, `enrollments.js`, `membership-report.js` + `_membership-metrics.js`, `partners/*`, `revenue.js`, `search-queries.js`, `wix-migration-*.js`, `_ga4.js`) were UI-only and removed with the pages that called them, or (search-queries.js, wix-migration-*.js) were already orphaned before this deletion.
