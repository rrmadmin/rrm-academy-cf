# Membership Report: Dashboard + Monthly Email

Date: 2026-07-17
Status: approved design, pre-implementation
Audience: Brian + Naomi (plain language throughout, per RRMF board-doc register: nontechnical, organized by function)

## Purpose

One unified membership/supporter picture across the three streams -- STUC memberships, RRMF donations, RRMA course purchases -- served two ways from a single computation:

1. A live dashboard at `/admin/membership/` on rrmacademy.org (admin-gated).
2. A plain-language monthly email on the 1st (12:30 UTC; 8:30 AM EDT / 7:30 AM EST) covering the just-completed month, to administrator@rrmacademy.org + Naomi, sent by rrm-observatory.

Numbers must be incapable of disagreeing between the two surfaces: both render the same JSON from the same endpoint.

## Architecture

```
rrm-auth D1 (user, user_label, wix_subscription, donor_gift)     Stripe API (read-only key)
        \                                                          /
         GET /api/admin/membership-report   (rrm-academy-cf, NEW)
            |                                        |
   /admin/membership/ dashboard page       rrm-observatory monthly cron (1st, 8 AM ET)
   (rrm-academy-cf, NEW, live fetch)       fetch ?month=<prior> w/ ADMIN_API_SECRET -> HTML email via SES
                                           To: administrator@ + Naomi (no agent@ Cc), link to dashboard
```

## Component 1: `GET /api/admin/membership-report` (rrm-academy-cf)

- **Auth:** admin session (`roleAtLeast('admin')`) OR `Authorization: Bearer ADMIN_API_SECRET` (existing machine-caller pattern used by the observatory's daily cleanup POST). NOTE: this deliberately diverges from sibling dashboard endpoints (which are `requireSuperAdmin`) because Naomi is the audience and must NOT need superadmin. See the middleware carve-out below -- the page gate and endpoint gate must agree at `admin`.
- **Middleware carve-out (required, decided):** `functions/_middleware.js` gates ALL `/admin/*` pages at superadmin. Add an explicit exemption lowering exactly `/admin/membership/` (page) to `roleAtLeast('admin')`; the endpoint uses the same threshold. `_middleware.js` is a guarded file: the edit requires `npm run guard:update` and re-review of the middleware invariant (must still protect `/account` + `/community`, and every OTHER `/admin/*` path stays superadmin -- add a test asserting both). Naomi is raised to `admin` tier only (NOT superadmin -- that would grant bans/revenue/course CRUD).
- **Month parameter:** `?month=YYYY-MM` selects the reporting period for all `*_this_month` / `joined` / `left` fields (validated, max 24 months back). Default = current calendar month (live dashboard). The monthly email explicitly requests the just-completed month. Point-in-time sections (`active_by_tier`, `recurring_monthly_cents`, `watchlist`) are always as-of `generated_at` regardless of `month`. Month boundaries are computed in America/New_York (convert before bucketing); state this in the G1 contract.
- **Cache:** response carries `Cache-Control: no-store` (member PII; siblings omit it -- do not copy that gap).
- **Data sources:** D1 `rrm-auth` (bindings already present) + Stripe REST with the read-only restricted key. No new secrets in rrm-academy-cf beyond what siblings already use; if the Stripe key is not currently bound to Pages functions, bind the existing read-only restricted key (never the `sk_live_` checkout key) as a new secret.
- **Response JSON (schema is a test-asserted contract):**

```json
{
  "generated_at": "ISO",
  "month": "2026-07",
  "headline": {
    "total_supporters": 0,
    "recurring_monthly_cents": 0,
    "delta_vs_prior_month_cents": 0,
    "degraded": false
  },
  "stuc": {
    "active_by_tier": {"member": 0, "hero": 0, "superhero": 0},
    "monthly_cents": 0,
    "wix_count": 0, "stripe_count": 0, "legacy_count": 0, "staff_count": 0,
    "joined_this_month": [{"name": "", "email": "", "tier": "", "joined_at": ""}],
    "left_this_month": [{"name": "", "email": "", "reason": ""}],
    "watchlist": [{"name": "", "email": "", "kind": "voided_invoice|past_due|lapsed_payment", "action": ""}],
    "known_paused": [{"name": "", "note": ""}],
    "stripe_unavailable": false
  },
  "foundation": {
    "one_time_this_month_cents": 0, "recurring_this_month_cents": 0,
    "ytd_cents": 0,
    "new_recurring": [], "lapsed_recurring": [],
    "ppgf_this_month_cents": 0
  },
  "academy": {
    "course_purchases_this_month": 0, "course_revenue_this_month_cents": 0,
    "ytd_purchases": 0, "ytd_cents": 0
  },
  "actions": [{"text": "", "who": "Brian|Naomi", "source": ""}],
  "trend": [{"month": "2025-08", "stuc_cents": 0, "foundation_cents": 0, "academy_cents": 0}]
}
```

- **Membership definitions:**
  - STUC roster access = `STUC_MEMBER_WHERE` (`functions/api/community/_shared.js`), but COUNTS and REVENUE use only the paying branches (active Wix sub; Stripe label + customer). Staff (`role IN mod/admin/superadmin`) and `STUC Legacy Grandfather` members are reported as separate annotated lines (`staff_count`, `legacy_count` -- "complimentary"), never in supporter totals or `active_by_tier` -- otherwise promoting Naomi to admin (Setup step 1) would inflate the report's own headline. Wix-vs-Stripe split rule (the community code has none -- define it here): a member matching BOTH branches (mid-migration) counts as Stripe. Invariant, test-asserted: `wix_count + stripe_count + legacy_count + staff_count` = roster total. Tier from `TIER_LABEL_MAP` / `wix_subscription.tier`.
  - `headline.total_supporters` = distinct lowercase emails across (paying STUC roster) UNION (non-refunded `donor_gift` givers in the reporting month) UNION (course buyers in the reporting month) -- one human counts once. `delta_vs_prior_month_cents` compares current roster MRR against PRIOR-MONTH REALIZED MEMBERSHIP RECEIPTS (no historical MRR snapshot exists); the basis is disclosed in `headline.delta_basis = "prior_month_membership_receipts"` and renderers must phrase it as "vs last month's membership receipts". Both definitions are part of the G1 contract and the G5 hand check.
  - `foundation.new_recurring` = donors whose first-ever non-refunded `kind='recurring'` foundation gift falls in the reporting month; `lapsed_recurring` = recurring foundation donors whose most recent such gift is >45 days old as of month end (same 45-day threshold as the STUC lapse scan). Both LIMIT 50.
  - `joined_this_month` / `left_this_month` derive from subscription lifecycle (Wix `wix_subscription.started_at` / status transitions; Stripe sub `start_date` / canceled or voided), NOT from `donor_gift` (which lags its sources by up to a day).
  - Dropout watchlist predicates are the ones shipped 2026-07-16 in rrm-observatory: voided-invoice-on-active-sub (`latest_invoice` expanded, status `void|uncollectible`, `amount_paid=0`, skip `subscription_create` at $0), `past_due|unpaid` subs, and the 45-day lapse / 14-day-grace-keyed-on-sub-start scan. Port the predicates into this endpoint (small pure functions with a cross-reference comment; rrm-academy-cf and rrm-observatory are separate repos, so duplication with a pointer is accepted).
  - `known_paused` = the same allowlist (currently Victoria Bergin), annotated, never a dropout.
  - Foundation vs Academy vs STUC classification from `donor_gift.entity` + `donor_gift.kind` (`membership`=STUC, `course`=Academy, else Foundation), `refunded_at IS NULL`.
- **Trend:** 12 monthly buckets from `donor_gift` (`occurred_at`), computed in one grouped query per stream, not N queries.
- **Degradation:** if Stripe is unreachable, set `stuc.stripe_unavailable=true` AND `headline.degraded=true`, omit Stripe-side counts/watchlist kinds that need Stripe, null the delta (a partial headline must never render as a real drop against the $478 baseline), and still return 200 with everything D1-derived. Both surfaces label the headline as partial when degraded. Never a whole-report 500 for a partial source failure. D1 failure = 500 (nothing meaningful to render).
- **Refund caveat (stated, accepted):** `refunded_at` is stamped by Stripe paths only (webhook + observatory sweep). Wix/PayPal refunds are rare and handled by manual D1 update; G5 reviewers should know a hand check can differ for this reason.
- **Performance:** one Stripe list call per status set with `expand[]=data.customer&expand[]=data.latest_invoice` (mirror the observatory's donors.js), batched D1 statements. Target < 5s.

## Component 2: `/admin/membership/` dashboard page (rrm-academy-cf)

- Astro page (or functions-served HTML matching however sibling admin pages are built -- read siblings first, follow the existing admin-page pattern exactly).
- Renders the JSON plain-language for Naomi: headline stat tiles; three stream sections; action list ("what needs a person, one instruction each"); joined/left lists; watchlist with the reason spelled out ("their July payment was voided but the subscription is still open -- cancel it in Stripe"); 12-month trend as simple inline SVG bars (no chart library).
- Register: plain language, no SQL/infra vocabulary, statuses as sentences. No em dashes. No serif fonts. Site design system (STYLE-GUIDE.md) -- polish within existing admin patterns, not a new design register.
- Responsive by construction (viewport meta, fluid grids, table-wrap); verified at 393x852 before done.
- Empty/degraded states render honestly ("Stripe data unavailable this refresh").

## Component 3: Monthly email (rrm-observatory)

- New cron `30 12 1 * *` -- 12:30 UTC on the 1st (8:30 AM EDT / 7:30 AM EST; fixed-UTC cron does not shift with DST, same accepted skew as the daily digest). Deliberately AFTER the 12:00 daily donor-gift-feed sweep so month-end gifts have landed; state this ordering dependency in the wrangler.toml comment.
- **Scheduler wiring (required):** `src/index.js scheduled()` branches on exact `event.cron` strings and routes unrecognized crons to the daemon catch-all -- adding the cron to wrangler.toml alone is a silent no-op. Add a named `isMonthlyMembership` branch (mirroring the `isCleanup` fetch pattern) included in the handled set. Plus an on-demand trigger route for canary sends (match the `/api/digest` on-demand pattern).
- Fetches the endpoint with `ADMIN_API_SECRET`, explicitly requesting `?month=<just-completed month>` (an Aug 1 send reports July). Renders the JSON as a plain-language HTML email: headline, three sections, action list, dashboard link. Email HTML is inline-styled / table-based (Gmail strips style tags). Subject: `Membership report -- <Month Year>`.
- **Recipients:** `notify.js sendNotification` hardcodes To administrator@ and Cc agent@whittaker.ai -- extend it with an options arg (`{to, cc}`) defaulting to current behavior. This report sends To administrator@ + Naomi with the agent@whittaker.ai Cc DROPPED (member PII + finance figures must not flow to the agentic inbox). Naomi is added ONLY after the first real send is verified against hand-checked numbers (rollout gate below). SES is correct here (internal report, not member-facing; Workspace-lane rule does not apply).
- Failure: if the fetch or render fails, send a one-line failure notice email instead of silently skipping (observatory never-silent convention). No Telegram.

## Setup steps

1. Middleware carve-out for `/admin/membership/` at `roleAtLeast('admin')` (guarded file: `guard:update` + invariant re-review + the new gate tests).
2. Naomi's rrmacademy.org account raised to admin tier -- NOT superadmin (one-time; verify she can load the page AND that she still cannot load any other `/admin/*` page).
3. Stripe read-only key bound to rrm-academy-cf Pages functions if not already present.
4. Observatory: no new secrets (ADMIN_API_SECRET + SES already bound); `notify.js` recipient-options change.

## Proof gates

- G1: endpoint JSON schema asserted by a repo test (shape + required keys + cents-integer types + `?month=` behavior + roster-partition invariant + `total_supporters` dedup definition).
- G2: auth -- unauthenticated and sub-admin-session requests get 401/403 on BOTH the endpoint and the page; bearer works; every other `/admin/*` page still requires superadmin (middleware invariant test); `Cache-Control: no-store` present.
- G3: dashboard screenshot at 393x852 and desktop, both reviewed, before "done".
- G4: canary email to administrator@ only, eyeballed by Brian.
- G5: first month's numbers cross-checked against an independent hand computation (baseline exists: 2026-07-16 audit -- $478/mo confirmed external, Wix $433 + Stripe $45, Clarke excluded, Victoria paused) before Naomi is added to recipients.
- G6: Stripe-unreachable path exercised (mock/fault injection) -- report still 200, `headline.degraded=true`, delta nulled, both surfaces label the headline partial.

## Out of scope (explicit)

- Event attendance (Meet attendance reports are not in D1; future addition).
- PayPal recurring subscriptions (finance-sync ledger dormant; one-time PayPal gifts already in `donor_gift` are included).
- Any member-facing surface, any write operations, any Stripe mutation.
- Historical Wix payment backfill beyond what `donor_gift`/`wix_payment` already hold.
