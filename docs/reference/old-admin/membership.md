# Old Admin: Membership

Source: `src/pages/admin/membership.astro` + `functions/api/admin/membership-report.js` + `functions/api/admin/_membership-metrics.js`

## Purpose

Unified monthly membership/supporter report combining Save the Uterus Club (STUC), RRM Foundation donations, and RRM Academy course revenue, with month-over-month deltas, joined/left/watchlist rosters, and "needs a person" action items -- read only.

## API endpoints

- `GET /api/admin/membership-report[?month=YYYY-MM]` -- single call, returns the full report payload (headline, stuc, foundation, academy, actions, 12-month trend). `month` optional, defaults to current ET month; must be within the last 24 months or the request is rejected.

## Data model

**D1 (`env.DB`, rrm-auth-style tables), primary source, hard dependency (failure = 500):**
- `user` (roster: role, stripe_customer_id, staff detection via role IN mod/admin/superadmin)
- `user_label` (STUC label membership, "STUC Legacy Grandfather" complimentary flag)
- `wix_subscription` (legacy Wix-billed STUC members: status, tier, amount_cents, frequency, started_at/updated_at, next_expected_at/last_order_at)
- `donor_gift` (unified gift ledger: `kind` one_time/recurring/membership/course, `entity` foundation, `ppgf` flag, `amount_cents`, `occurred_at`, `refunded_at`, `display_name`, `email`) -- source for monthly/YTD aggregates, new/lapsed recurring donors, 12-month trend, and month-over-month receipts

**Stripe (soft dependency via `STRIPE_RESTRICTED_KEY`, failure = degraded report, never a 500):**
- `stripe.subscriptions.list` across statuses active/past_due/unpaid/canceled (expanded customer + latest_invoice) -- feeds live tier/amount for Stripe-billed STUC members, joined/left-this-month detection, watchlist (voided invoice, past-due/dunning), and anticipated-renewal revenue estimate. Capped at `MAX_PAGES` (10) x 100 records per status; sets `stripeTruncated` flag if exceeded.

**Key aggregates surfaced:**
- Headline: total_supporters, recurring_monthly_cents, delta_vs_prior_month_cents, month-over-month receipts (this/prior/anticipated), degraded flag
- STUC: active_by_tier (member/hero/superhero), wix/stripe/legacy/staff counts, joined/left this month, watchlist, known-paused allowlist
- Foundation: one-time/recurring this month, YTD, PayPal Giving Fund (ppgf) this month, new recurring donors, lapsed recurring donors (45+ day threshold)
- Academy: course purchases + revenue this month and YTD
- 12-month trend (stuc/foundation/academy cents by month)
- Actions list: who (Brian/Naomi) + what, generated from watchlist entries, truncation warning, and lapsed-donor outreach prompts

`_membership-metrics.js` is a pure-function helper module (no network/bindings): ET month-boundary math, roster partitioning (staff > legacy > stripe > wix precedence), Stripe dropout/dunning predicates, lapse-scan logic, anticipated-renewal calculation, and the final response-shape assembler (`assembleReport`).

## Actions available in the UI

- **Refresh** button -- reloads the report.
- **Logout** button -- `POST /api/auth/logout`, redirects to `/login/`.

No write/mutation actions -- entirely read-only; all "actions" surfaced are informational prompts for a human (Brian/Naomi) to act on outside the tool.

## Auth level

**Special carve-out, not plain superadmin.** `membership-report.js`'s `requireAdminOrBearer()` accepts either:
1. **Bearer token**: `Authorization: Bearer <ADMIN_API_SECRET>` (constant-time compare) -- machine caller (the rrm-observatory cron), treated as role `admin`.
2. **Session cookie, role >= `admin`** via `roleAtLeast(session.role, 'admin')` -- this admits the `admin` role itself, not just `superadmin`. This is looser than the plain-superadmin gate used by `enrollments.js` and the `partners` endpoints.

`functions/api/admin/_middleware.js` does not enforce auth itself (best-effort session population only; each endpoint checks). The client-side script redirects to `/login/?redirect=/admin/membership/` on a 401/403 response.

## Port status

ported to rrm-backoffice (/membership)
