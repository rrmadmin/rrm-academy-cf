# Measurement SSOT: which system answers which question

Date: 2026-07-09 (born from the GA4 audit, `~/iCode/.wip/ga4-audit-and-conversion-plan-2026-07-09.md`)
Scope: rrmacademy.org. GA4 property `526304690`, beacon-only (no gtag) since 2026-05-19.

Rule of use: answer each question from its system of record below. Do not reach for the GA4 native report first; several GA4 natives are permanently empty under this architecture (see Hard MP limits).

## System of record by question

| Question | System of record | Notes |
|---|---|---|
| Traffic volume / trends | GSC | GA4 page_view exists (thin beacon, restored 2026-06-23) but GSC is the trend truth |
| Acquisition / attribution | `entry_platform` / `entry_category` event params + `fp_event` referrers | GA4 native attribution is dead: sessionSource / sessionMedium / sessionDefaultChannelGroup are 100 percent "(not set)" / Unassigned |
| Revenue / donations / MRR | Stripe | GA4 `purchase` is an indicator only, never the number quoted |
| Ads compliance conversions | Data Manager gclid uploads | Never GA4 import |
| Signups / enrollments / leads | D1 `rrm-auth` tables (`user`, `enrollment`, `newsletter_subscriber`, ...) | GA4 `sign_up` / `generate_lead` usable as trend only |
| Email performance | `newsletter_event` + `email_log` (D1) | Never UTMs in email; arrivals = `newsletter_event` `event='clicked'` rows joined to `fp_event` by page path + time window |
| On-site search | `search_log` (rrm-analytics D1) | |
| Quiz funnels | `quiz_event` (rrm-survey D1) | |
| Visitor identity / cohorts | fp worker (fp.rrmacademy.org): `rrm_vid` cookie, `fp_visitor_link`, `/admin/campaign-report` | D1 tables `fp_event` / `fp_visitor` / `fp_visitor_link` |
| Session replay / UX | Clarity project `xcwba0naze` | Exclusion list + GPC gate apply |
| Behavior events (clicks, scroll, etc.) | GA4 beacon allowlist | Allowlist SSOT: `functions/api/_track-events.js`; relay: `POST /api/track` -> `functions/api/_ga4.js` |

## Hard MP limits (permanent under beacon-only)

| Limit | Effect |
|---|---|
| `session_start` / `first_visit` / `user_engagement` are reserved MP names; GA4 silently drops them | `newUsers` = 0 and `engagedSessions` = 0 in all GA4 reports |
| MP cannot set session traffic source | `sessionSource` / `sessionMedium` / `sessionDefaultChannelGroup` are 100 percent "(not set)" / Unassigned |

Compensation: `entry_platform` / `entry_category` params (first-touch `entry_ref` / `entry_url` cookies, `functions/api/_ga4-source.js`), the fp worker, GSC for traffic, Stripe for revenue.

## Synthetic traffic exclusion flag

MP has no automatic bot filtering. The one exclusion mechanism:

- Prober sends the `X-Canary-Token` header -> `isCanary` flag in `functions/api/create-checkout.js`.
- On the `isCanary` branch: GA4 fire suppressed, Stripe session expired, `metadata.canary=1` stamped.
- `/api/track` additionally carries a UA-regex bot drop.
- Any new prober MUST reuse this flag pattern; do not invent a second mechanism.

Context: before this fix the production canary (`scripts/canary.mjs`) fabricated ~2,750 of 2,758 `begin_checkout` events in 30 days and left ~91 open Stripe sessions/day.

## Decision log

| Date | Decision | Status |
|---|---|---|
| 2026-07-09 | `eventDataRetention` changed TWO_MONTHS -> 14 months | DONE |
| 2026-07-09 | Key-event roster pruned to `purchase`, `sign_up`, `generate_lead` (`ads_conversion_About_Us_1` deleted; `begin_checkout` / `copy_citation` / `video_complete` / `pdf_download` unmarked; `begin_checkout` re-marked after 7 clean days) | DONE |
| 2026-07-09 | Canary suppression (`X-Canary-Token` -> `isCanary`: GA4 suppressed, Stripe sessions expired) | DONE (this branch) |
| 2026-07-09 | Architecture: beacon-only (Option D) with fp worker + `entry_platform` as the attribution layer; one minimal gtag held as fallback with an explicit kill criterion | RECOMMENDED, PENDING Brian's ratification (audit decision queue item 2) |

## Pointers

- Spec: `docs/superpowers/specs/2026-05-15-client-analytics-spec.md` (amended 2026-07-09: hard MP limits, synthetic-traffic policy, allowlist annotations)
- Runbook: `docs/superpowers/plans/2026-05-15-phase3-phase4-analytics-runbook.html` (Phase 4 status ledger; sign-off REOPENED 2026-07-09)
- Audit: `~/iCode/.wip/ga4-audit-and-conversion-plan-2026-07-09.md`
- KPI scoreboard cadence: `rrm-academy-internal/plans/2026-06-26-12-month-seo-master-plan.md`
