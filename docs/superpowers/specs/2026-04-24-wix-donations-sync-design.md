# Wix Donations Sync → /account — Design

**Date:** 2026-04-24
**Author:** Claude (with Brian)
**Status:** Draft — awaiting review
**Fishing-trip reports:** `/tmp/wix-fishing-report.md`, `/tmp/airtable-wix-ledger-report.md`

---

## Problem

Victoria Bergin donated monthly via Wix (Save the Uterus Club, $9/mo, 8 cycles, last payment 2026-04-23). She logged into her rrmacademy.org account and saw:

- "You don't have an active membership" on /account
- No donation history

`/api/billing/status.js` only queries Stripe. It has zero knowledge of Wix donations. Community gate (`requireMember`) has a grandfathered `Save the Uterus Club 🏷️` label bypass, but that label came from a one-time Wix import months ago and is not kept current — and it doesn't help /account anyway.

This hits every donor who gave through Wix and then tries to see their account.

## Goal

Mirror Wix donation data into D1 so /account can render:

1. Active membership card (tier, status, next expected donation date) for recurring donors
2. Unified donation history (Wix + Stripe, sorted by date)
3. Graceful "contact us to manage your recurring donation" path (Wix has no customer portal URL)

Same data also powers `requireMember` in community.

## Scope

**In scope:**

- New D1 tables: `wix_subscription`, `wix_payment` in `rrm-auth`
- New scheduled Worker that pulls Wix eCom orders and upserts into D1
- One-time backfill run on deploy
- `/api/billing/status.js` extended to read Wix data when Stripe is empty
- `community/_shared.js requireMember` extended to honor active Wix subscriptions (in addition to existing label bypass)
- `/account` UI: unified donation list + "Manage your recurring donation" link (mailto)

**Scope note (revised 2026-04-24 after discussion with Brian):** Webhook-driven sync with a 6-hour fallback cron is **in scope**. The Wix App at `manage.wix.com/apps/50242798-fa4f-43a6-96cd-787f490d2b87` already has a registered public key (1Password `346mczoiqhbppe4x2sxsopbot4`) used to verify signed webhook JWTs. The 6-hour cron is kept as the safety net for missed webhook deliveries.

**Out of scope:**

- Moving STUC checkout off Wix (that's the bigger strangler-fig migration; tracked separately)
- Migrating legacy Pricing Plans STUC subscriber (1 person, special-cased in backfill)
- Any admin dashboard for Wix donors (future)

## Data model

### `wix_subscription`

```sql
CREATE TABLE wix_subscription (
  wix_subscription_id  TEXT PRIMARY KEY,         -- lineItems[0].subscriptionInfo.id
  user_id              TEXT,                     -- nullable; filled by email match against user table
  contact_id           TEXT NOT NULL,            -- buyerInfo.contactId (Wix contact)
  email                TEXT NOT NULL COLLATE NOCASE,
  tier                 TEXT NOT NULL,            -- 'member' | 'hero' | 'superhero' (derived from contact label, fallback to amount)
  amount_cents         INTEGER NOT NULL,         -- recurring amount per cycle
  currency             TEXT NOT NULL DEFAULT 'USD',
  frequency            TEXT NOT NULL DEFAULT 'MONTH',
  status               TEXT NOT NULL,            -- 'active' | 'inactive' (derived from last_order_at)
  started_at           TEXT NOT NULL,            -- ISO 8601
  last_order_at        TEXT NOT NULL,
  next_expected_at     TEXT,                     -- last_order_at + 1 month (grace: +35d)
  cycle_count          INTEGER NOT NULL,         -- lineItems[0].subscriptionInfo.cycleNumber of most recent order
  auto_renewal         INTEGER NOT NULL DEFAULT 1,
  product_id           TEXT NOT NULL,            -- STUC product id or Pricing Plans plan id (legacy)
  product_source       TEXT NOT NULL,            -- 'stores' | 'pricing-plans'
  updated_at           TEXT NOT NULL             -- ISO 8601
);
CREATE INDEX idx_wix_sub_email ON wix_subscription(email);
CREATE INDEX idx_wix_sub_user ON wix_subscription(user_id);
CREATE INDEX idx_wix_sub_status ON wix_subscription(status);
```

### `wix_payment`

```sql
CREATE TABLE wix_payment (
  wix_order_id         TEXT PRIMARY KEY,         -- order.id (UUID)
  wix_order_number     TEXT NOT NULL,            -- order.number (e.g. "10333") — human-readable
  wix_subscription_id  TEXT,                     -- lineItems[0].subscriptionInfo.id (null for one-offs)
  user_id              TEXT,                     -- nullable; filled by email match
  contact_id           TEXT NOT NULL,
  email                TEXT NOT NULL COLLATE NOCASE,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'USD',
  paid_at              TEXT NOT NULL,            -- order.purchasedDate or ORDER_PAID activity
  payment_status       TEXT NOT NULL,            -- 'PAID' | 'REFUNDED' | etc. (passthrough from order.paymentStatus)
  receipt_id           TEXT,                     -- activities[].orderRefunded.receiptId if present, else null
  receipt_number       TEXT,                     -- activities[].receipt.displayNumber (e.g. "987317")
  product_name         TEXT NOT NULL,            -- lineItems[0].productName.original
  product_id           TEXT NOT NULL,
  is_donation          INTEGER NOT NULL DEFAULT 0, -- 1 if lineItems[0].itemType.custom == 'DONATION'
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_wix_pay_email ON wix_payment(email);
CREATE INDEX idx_wix_pay_user ON wix_payment(user_id);
CREATE INDEX idx_wix_pay_sub ON wix_payment(wix_subscription_id);
CREATE INDEX idx_wix_pay_paid_at ON wix_payment(paid_at);
```

### Why two tables and not one view-as-subscription

- Subscription state (active/inactive, tier, next expected date) needs to be queryable on its own without re-grouping rows every time the account page loads. Small overhead now pays for cleaner reads forever.
- Payment history needs its own row for every charge (Stripe UI precedent). Merging with `charges` from Stripe is straightforward.
- Join path from a user: `SELECT ... FROM wix_subscription WHERE user_id = ? OR email = ? COLLATE NOCASE` → one row. `SELECT ... FROM wix_payment WHERE (user_id = ? OR email = ? COLLATE NOCASE) ORDER BY paid_at DESC` → all charges.

## Sync worker

New Cloudflare Worker: `rrm-wix-sync` (separate from the stub `rrm-finance-sync`; we'll retire that worker after this one is stable).

**Location:** `~/iCode/projects/rrm-wix-sync/` (new repo, matching ecosystem pattern).

**Triggers:**

- Cron: `0 */6 * * *` (every 6 hours). 4 runs/day covers the case where a renewal hits in the morning and a donor logs in by afternoon. Not hourly — Wix API has no rate-limit headers we can observe, and 30 active subs × 4× daily is overkill enough without going to 24×.
- HTTP: `POST /sync?token=<ADMIN_API_SECRET>` for on-demand runs (backfill, testing).

**Flow per run:**

1. Paginate `POST /ecom/v1/orders/search` with `limit=100`, sorted by `createdDate` desc, **with cursor** — first run grabs all 333; subsequent runs can use an "only orders after last successful sync watermark" filter (`createdDate > ?`) to cut requests. Store the watermark in D1 `system_config`.
2. For each order:
   - Upsert into `wix_payment` (`INSERT ... ON CONFLICT(wix_order_id) DO UPDATE`).
   - If `lineItems[0].subscriptionInfo.id` present, track `(sub_id, order)` pair for step 3.
3. Group orders by `subscriptionInfo.id`. For each group:
   - `started_at` = min(paid_at), `last_order_at` = max(paid_at), `cycle_count` = max(cycleNumber)
   - `next_expected_at` = `last_order_at + 1 month`
   - `status` = `'active'` if `last_order_at > now - 35 days` (covers monthly cadence + grace period for failed-then-retried charges), else `'inactive'`
   - `tier` = lookup against tier mapping (see below)
   - Upsert into `wix_subscription`.
4. Email→user_id match pass:
   - `UPDATE wix_subscription SET user_id = (SELECT id FROM user WHERE email = wix_subscription.email COLLATE NOCASE) WHERE user_id IS NULL`
   - Same for `wix_payment`.
5. Log `wix_sync` event to Analytics Engine with `{orders_seen, orders_upserted, subs_upserted, users_linked, duration_ms}`.

**Tier derivation:**

- Primary: call `POST /contacts/v4/contacts/query` with `buyerInfo.contactId` filter once per unique contact, read `labelKeys` array.
  - `custom.uterus-super-hero` → `'superhero'`
  - `custom.uterus-hero` → `'hero'`
  - `custom.uterus-club-member` → `'member'`
- Fallback (no matching label): derive from `amount_cents` — ≥9900 → superhero, ≥1900 → hero, else member.
- **Gotcha:** contact labels lag first-payment automations by minutes. Tier may be `'member'` by fallback for the first run post-payment, then correct itself on next sync.

**Legacy Pricing Plans STUC subscriber (1 user):**

- One separate endpoint call: `POST /pricing-plans/v3/orders/query` with `planId = 0b5b8754-c649-4c10-b648-025499f3b175`.
- Synthesize a `wix_subscription` row with `product_source = 'pricing-plans'` and matching shape.
- Skip if empty. No payment history for this path; fine for now.

**Wix API auth:**

- Secret: Wix IST token from 1Password Automation vault → `wix.api.academy`.
- Worker secret: `WIX_IST_TOKEN`. Header: `Authorization: <token>` (bare, no `Bearer`).
- Site ID header: `wix-site-id: e15fd723-0b26-4e85-8ab3-e7b8d119089e`.
- Wrap every fetch in try/catch. 503 on upstream failure. Log `wix_sync_error` event.

**Backfill:**

- First deploy: worker runs immediately via `/sync` POST with `{full: true}` flag that disables the watermark filter. Expected ~333 order fetches (~4 paginated calls), ~51 contact label lookups.
- Verify Victoria shows up: `wrangler d1 execute rrm-auth --command "SELECT * FROM wix_subscription WHERE email = 'vjgbergin@gmail.com' COLLATE NOCASE"`.

## `/api/billing/status.js` changes

Extend to merge Wix:

```js
// After Stripe lookup (existing code):
const [wixSub, wixPayments] = await Promise.all([
  db.prepare(`
    SELECT tier, status, next_expected_at, amount_cents, auto_renewal
    FROM wix_subscription
    WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = 'active'
    ORDER BY started_at DESC LIMIT 1
  `).bind(session.userId, user.email).first(),
  db.prepare(`
    SELECT amount_cents, paid_at, wix_order_number, receipt_number, product_name
    FROM wix_payment
    WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND payment_status = 'PAID'
    ORDER BY paid_at DESC LIMIT 50
  `).bind(session.userId, user.email).all(),
]);

// If no Stripe subscription but a Wix subscription exists → surface it:
if (!subscription && wixSub) {
  subscription = {
    tier: wixSub.tier,
    status: wixSub.status,           // 'active'
    currentPeriodEnd: wixSub.next_expected_at ? toUnix(wixSub.next_expected_at) : null,
    cancelAtPeriodEnd: false,        // Wix auto_renewal is unreliable; never show cancel pending
    source: 'wix',                   // so UI can route "Manage Billing" correctly
    amount: wixSub.amount_cents,
  };
}

// Merge donations:
const wixDonations = (wixPayments.results || []).map(p => ({
  amount: p.amount_cents,
  date: toUnix(p.paid_at),
  receiptUrl: null,                  // Wix has no public receipt URL
  receiptNumber: p.receipt_number,   // display-only reference (e.g. "987317")
  source: 'wix',
}));
donations = [...donations, ...wixDonations].sort((a, b) => b.date - a.date);
```

**Response shape addition:** each `donation` / `subscription` gains a `source` field (`'stripe'` or `'wix'`). Backwards-compatible — existing Stripe-only consumers get `source: 'stripe'` and keep working.

## `community/_shared.js requireMember` changes

Add a third grandfather path after the existing `user_label` STUC check, before the Stripe subscription check:

```js
// Active Wix subscribers (new path)
const wixSub = await db.prepare(`
  SELECT tier FROM wix_subscription
  WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = 'active'
  LIMIT 1
`).bind(user.id, user.email).first();
if (wixSub) {
  return { user, tier: wixSub.tier || 'member', session };
}
```

Keep existing `Save the Uterus Club 🏷️` label check as a belt-and-suspenders legacy path. Retire it after this system is proven (3 month soak).

## /account UI changes

`src/pages/account/index.astro` lines ~134-160 (billing section) + client JS at ~464:

- When `subscription.source === 'wix'`: show membership card as normal but replace "Manage Billing" button with:

  > Your recurring donation is processed through our legacy platform. To update your card, change your amount, or cancel, email [support@rrmacademy.org](mailto:support@rrmacademy.org). We'll respond within 1 business day.

- Donation history list: render Wix rows identically to Stripe rows. No receipt link (Wix has no public URL); show `receipt_number` as plain text: "Receipt #987317" instead of a link.

No new components. Inline the Wix-specific copy in existing DOM.

## Deployment / safety

- New D1 tables via migration script: `scripts/migrate-wix-sync.sql`. Applied to remote via `wrangler d1 execute rrm-auth --remote --file=...`.
- Security guard: add `/api/billing/status.js`, `community/_shared.js`, and the new sync worker (if we add it to guard manifest) to `guard-manifest.json`. Run `npm run guard:update` after changes.
- CORS on status.js: unchanged (already locked to rrmacademy.org).
- Coder agent mandatory for all `functions/api/` changes per `CLAUDE.md`.
- No hard-coded tier labels in the sync worker — pull from `community/_shared.js` or mirror the mapping in a shared constants file.

## Testing plan

1. **Local schema check:** apply migration to a throwaway D1 db, insert synthetic rows, verify indexes.
2. **Sync worker dry run:** deploy to a preview env, hit `/sync` with Victoria's email-only filter, confirm her row appears in `wix_subscription` with `status='active'`, `tier='member'`, `cycle_count=8`.
3. **Status endpoint:** log in as Victoria (or a test account with her email if easier), call `/api/billing/status`, confirm response contains `subscription.source = 'wix'` and 8 donation rows.
4. **Community gate:** confirm Victoria can access /community without needing a legacy label.
5. **Full backfill:** run once, check counts: 51 subs upserted (30 active + 21 inactive + 1 Pricing Plans legacy = expected after grouping), ~333 payments upserted.
6. **Double-run idempotency:** run backfill a second time, assert counts don't grow and `updated_at` updates.
7. **Stripe-only users unaffected:** log in as a Stripe-only donor, confirm billing_status response is unchanged (no Wix rows returned, no `source` field confusion).
8. **Staff user:** confirm staff role still bypasses the gate regardless of Wix/Stripe state.

## Unknowns / gotchas

- **Wix API rate limits:** no headers expose them. We're at 6 calls/day + 51 contact lookups/day = ~100 requests/day, well under any reasonable limit. If we ever see 429, add exponential backoff.
- **Refunds:** current spec persists `payment_status` passthrough but doesn't handle the case where a subscription row should go inactive after a refund cascade. For now, status is purely cadence-derived. If a donor refunds and we need to retroactively flag `status='refunded'`, add a second derivation pass later.
- **Pricing Plans orphan (1 user):** we'll sync them but can't merge their payment history (different API shape). Their `wix_subscription` row will exist with `product_source='pricing-plans'` and no `wix_payment` rows. UI-side: their membership card shows but "Payment History" section shows "No history available" — acceptable for 1 user, we can patch later.
- **Email mismatch between Wix and RRM Academy account:** if a donor donated under `x@gmail.com` on Wix but signed up under `x+foo@gmail.com` on rrmacademy, we won't auto-link. Admin tool to manually link is a future add. For now: email match is exact (after COLLATE NOCASE); no plus-address normalization.
- **The stub `rrm-finance-sync` worker** remains in place but idle. After this worker proves out over 30 days, we can delete the stub repo.

## Open questions for Brian

1. **Worker repo name** — `rrm-wix-sync` ok, or prefer `rrm-wix-donations-sync` / something else?
2. **Sync cadence** — 6-hourly fine, or tighter (hourly) for better donor UX?
3. **"Manage donation" copy** — exact text ok above, or want it softer / different email address / route somewhere other than support@?
4. **Retire legacy STUC label** — in 90 days, after this soaks, safe to drop the `Save the Uterus Club 🏷️` bypass in `requireMember`?
5. **Backfill timing** — run immediately on first worker deploy, or stage overnight and verify counts before flipping `billing/status.js` to read Wix?
