# Old Admin: Revenue (`/admin/revenue/`)

## Purpose

Shows Stripe-derived revenue metrics (MRR, period revenue, donations, subscription revenue, cancellations, churn, tier breakdown, daily timeline) for a selectable time window.

## API endpoints the page calls

- `GET /api/admin/revenue?period=7d|28d|90d` (`functions/api/admin/revenue.js`)
- `POST /api/auth/logout` (shared logout button, not revenue-specific)

## Data model

- **Stripe** (via `stripe` SDK, `env.STRIPE_SECRET_KEY`):
  - `stripe.subscriptions.list({status: 'active'|'trialing'})` -- auto-paginated, computes MRR (annual prices normalized to monthly), per-tier counts/MRR via `tierFromPriceOrAmount()` against an allowlist (`member`, `hero`, `superhero`, else `other`)
  - `stripe.subscriptions.search({query: "status:'canceled' AND canceled_at>=..."})` -- cancelled count in period
  - `stripe.charges.list({created: {gte: periodStart}, expand: ['data.payment_intent']})` -- auto-paginated; net of refunds; split into donations / courses / subscription-invoice charges via `charge.invoice` presence and `payment_intent.metadata.type === 'course'`
- **KV** (`env.COMMUNITY_KV`): 15-minute cache keyed `admin:revenue:${period}`. Cache read/write both non-fatal on error (falls through to live Stripe fetch; write uses `waitUntil`).
- **Aggregates surfaced**: `mrr`, `totalActiveSubs`, `tierCounts`/`tierMrr` (member/hero/superhero/other), `unknownPriced` (line items with no `unit_amount`), `donations {count,total}`, `courses {count,total}`, `subscriptionRevenue`, `subscriptionCharges`, `cancelledCount`, `totalRevenue`, `timeline` (per-day donations/courses/subscriptions/total), `fetchedAt`.

## Actions available in the UI

- Period selector (`7d`/`28d`/`90d`) -- re-fetches on change
- Refresh button -- re-fetches current period
- No write actions; this page is read-only against Stripe data (no D1 writes, no POST/PUT to the revenue endpoint itself)

## Auth level required

Superadmin, session-based (`requireSuperAdmin(request, env.DB)` inside `functions/api/admin/revenue.js`; `functions/api/admin/_middleware.js` best-effort populates `context.data.user`/`session` from the session cookie but does not itself enforce auth -- each endpoint enforces its own check).

## Port status

ported to rrm-backoffice (/revenue)
