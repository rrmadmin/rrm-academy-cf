# Membership Report: Dashboard + Monthly Email

Date: 2026-07-17
Status: approved design, pre-implementation
Audience: Brian + Naomi (plain language throughout, per RRMF board-doc register: nontechnical, organized by function)

## Purpose

One unified membership/supporter picture across the three streams -- STUC memberships, RRMF donations, RRMA course purchases -- served two ways from a single computation:

1. A live dashboard at `/admin/membership/` on rrmacademy.org (admin-gated).
2. A plain-language monthly email on the 1st, 8 AM ET, to administrator@rrmacademy.org + Naomi, sent by rrm-observatory.

Numbers must be incapable of disagreeing between the two surfaces: both render the same JSON from the same endpoint.

## Architecture

```
rrm-auth D1 (user, user_label, wix_subscription, donor_gift)     Stripe API (read-only key)
        \                                                          /
         GET /api/admin/membership-report   (rrm-academy-cf, NEW)
            |                                        |
   /admin/membership/ dashboard page       rrm-observatory monthly cron (1st, 8 AM ET)
   (rrm-academy-cf, NEW, live fetch)       fetch w/ ADMIN_API_SECRET -> HTML email via SES
                                           To: administrator@ + Naomi, link to dashboard
```

## Component 1: `GET /api/admin/membership-report` (rrm-academy-cf)

- **Auth:** admin session (`roleAtLeast('admin')` via existing `functions/api/auth/_shared.js` patterns) OR `Authorization: Bearer ADMIN_API_SECRET` (existing machine-caller pattern used by the observatory's daily cleanup POST). Match sibling admin endpoints exactly.
- **Data sources:** D1 `rrm-auth` (bindings already present) + Stripe REST with the read-only restricted key. No new secrets in rrm-academy-cf beyond what siblings already use; if the Stripe key is not currently bound to Pages functions, bind the existing read-only restricted key (never the `sk_live_` checkout key) as a new secret.
- **Response JSON (schema is a test-asserted contract):**

```json
{
  "generated_at": "ISO",
  "month": "2026-07",
  "headline": {
    "total_supporters": 0,
    "recurring_monthly_cents": 0,
    "delta_vs_prior_month_cents": 0
  },
  "stuc": {
    "active_by_tier": {"member": 0, "hero": 0, "superhero": 0},
    "monthly_cents": 0,
    "wix_count": 0, "stripe_count": 0,
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

- **Membership definitions (reuse, do not re-derive):**
  - STUC roster = `STUC_MEMBER_WHERE` (`functions/api/community/_shared.js`), split Wix vs Stripe exactly as the community code does. Tier from `TIER_LABEL_MAP` / `wix_subscription.tier`.
  - Dropout watchlist predicates are the ones shipped 2026-07-16 in rrm-observatory: voided-invoice-on-active-sub (`latest_invoice` expanded, status `void|uncollectible`, `amount_paid=0`, skip `subscription_create` at $0), `past_due|unpaid` subs, and the 45-day lapse / 14-day-grace-keyed-on-sub-start scan. Port the predicates into this endpoint (small pure functions with a cross-reference comment; rrm-academy-cf and rrm-observatory are separate repos, so duplication with a pointer is accepted).
  - `known_paused` = the same allowlist (currently Victoria Bergin), annotated, never a dropout.
  - Foundation vs Academy vs STUC classification from `donor_gift.entity` + `donor_gift.kind` (`membership`=STUC, `course`=Academy, else Foundation), `refunded_at IS NULL`.
- **Trend:** 12 monthly buckets from `donor_gift` (`occurred_at`), computed in one grouped query per stream, not N queries.
- **Degradation:** if Stripe is unreachable, set `stuc.stripe_unavailable=true`, omit Stripe-side counts/watchlist kinds that need Stripe, and still return 200 with everything D1-derived. Never a whole-report 500 for a partial source failure. D1 failure = 500 (nothing meaningful to render).
- **Performance:** one Stripe list call per status set with `expand[]=data.customer&expand[]=data.latest_invoice` (mirror the observatory's donors.js), batched D1 statements. Target < 5s.

## Component 2: `/admin/membership/` dashboard page (rrm-academy-cf)

- Astro page (or functions-served HTML matching however sibling admin pages are built -- read siblings first, follow the existing admin-page pattern exactly).
- Renders the JSON plain-language for Naomi: headline stat tiles; three stream sections; action list ("what needs a person, one instruction each"); joined/left lists; watchlist with the reason spelled out ("their July payment was voided but the subscription is still open -- cancel it in Stripe"); 12-month trend as simple inline SVG bars (no chart library).
- Register: plain language, no SQL/infra vocabulary, statuses as sentences. No em dashes. No serif fonts. Site design system (STYLE-GUIDE.md) -- polish within existing admin patterns, not a new design register.
- Responsive by construction (viewport meta, fluid grids, table-wrap); verified at 393x852 before done.
- Empty/degraded states render honestly ("Stripe data unavailable this refresh").

## Component 3: Monthly email (rrm-observatory)

- New cron `0 12 1 * *` (8 AM ET on the 1st) + an on-demand trigger route for canary sends (match the existing `/api/digest` on-demand pattern).
- Fetches the endpoint with `ADMIN_API_SECRET` (same rail as the daily cleanup POST). Renders the same JSON as a plain-language HTML email: headline, three sections, action list, dashboard link. Subject: `Membership report -- <Month Year>`.
- Recipients: administrator@rrmacademy.org + Naomi. Naomi is added ONLY after the first real send is verified against hand-checked numbers (rollout gate below). Sent via the existing SES rail (`notify.js`); this is an internal report, not a member-facing communication, so the Workspace-lane rule does not apply.
- Failure: if the fetch or render fails, send a one-line failure notice email instead of silently skipping (observatory never-silent convention). No Telegram.

## Setup steps

1. Naomi's rrmacademy.org account raised to admin tier (one-time, verify she can load the page).
2. Stripe read-only key bound to rrm-academy-cf Pages functions if not already present.
3. Observatory: no new secrets (ADMIN_API_SECRET + SES already bound).

## Proof gates

- G1: endpoint JSON schema asserted by a repo test (shape + required keys + cents-integer types).
- G2: endpoint auth -- unauthenticated and non-admin-session requests get 401/403; bearer works.
- G3: dashboard screenshot at 393x852 and desktop, both reviewed, before "done".
- G4: canary email to administrator@ only, eyeballed by Brian.
- G5: first month's numbers cross-checked against an independent hand computation (baseline exists: 2026-07-16 audit -- $478/mo confirmed external, Wix $433 + Stripe $45, Clarke excluded, Victoria paused) before Naomi is added to recipients.
- G6: Stripe-unreachable path exercised (mock/fault injection) -- report still 200, both surfaces render the gap.

## Out of scope (explicit)

- Event attendance (Meet attendance reports are not in D1; future addition).
- PayPal recurring subscriptions (finance-sync ledger dormant; one-time PayPal gifts already in `donor_gift` are included).
- Any member-facing surface, any write operations, any Stripe mutation.
- Historical Wix payment backfill beyond what `donor_gift`/`wix_payment` already hold.
