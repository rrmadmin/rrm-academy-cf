# Save the Uterus Club — Wix Donor UX

**Date:** 2026-04-28
**Status:** Spec (revised after `/arise --deep` review — 7 CRITICAL, 14 HIGH findings folded in)
**Project:** rrm-academy-cf
**Related specs:**
- `2026-04-24-wix-donations-sync-design.md` (companion: Wix→D1 sync worker, in-flight)
- `2026-03-10-webhook-decomposition-design.md` (existing Stripe webhook architecture)

## Problem

Save the Uterus Club has two billing systems running side-by-side: legacy Wix donations (still active for most existing donors) and the new Stripe Checkout flow (live for new joiners). Backend reconciliation works — `wix_subscription` mirror table feeds the community gate, webhook handoff exists, admin migration endpoint ships. **The UX layer for already-Wix-paying donors is the weakest part of the system.** A logged-in Wix donor today encounters:

- A 404 dead-end if she clicks "Upgrade" on `/save-the-uterus-club/` (the button routes to `/api/billing/portal` which 404s without `stripe_customer_id`).
- No "Migrate to Stripe" call-to-action anywhere in the app — migration is email-campaign-only, and the email itself relies on her copying her donation email correctly.
- No self-serve cancel — only a "email support@" instruction.
- No defense against logged-in checkout creating a parallel Stripe sub when her CF account email differs from her Wix donation email.
- "Legacy platform" wording on `/account` that subtly tells her she's on a deprecated path.

These donors fund the work. The current UX treats them like an engineering edge case. This spec fixes that.

## Direction

**(B) Soft, dismissable, non-blocking migration.** The donor sees herself as a member, not as a person who needs to do migration housekeeping. A gentle one-time prompt explains the switch. She can ignore it forever and stay on Wix. Every action (upgrade, downgrade, cancel) works without requiring migration first — but the actions that require Stripe (upgrade/downgrade) auto-migrate her invisibly via Checkout.

## Decisions

| Choice | Decision |
|--------|----------|
| Tier change for Wix donors | Auto-migrate via Stripe Checkout, no disclosure step |
| Cancel flow | Self-serve with optional reason field (Naomi-voiced) |
| Language framing | No "legacy / Wix / system" wording; donor-facing copy is platform-agnostic |
| Migration prompt placement | Top banner above `/account` membership card |
| Banner copy voice | Naomi-voiced ("Thank you for being a member. We'd love to move your donation…") |
| Cancel modal voice | Naomi-voiced ("Thank you for everything you've given. We read every word.") |
| STUC page identity for logged-in members | Member-first layout: "You're in" status card on top, marketing content below |
| Double-charge bridge | Stripe `subscription_data.trial_end` = `wix_subscription.next_expected_at`. $0 today, first new charge on existing renewal date. |
| Email-mismatch defense | 4 layers: (1) signed magic link with email-binding interstitial, (2) /account empty-state help text, (3) server-side checkout linkage by `wix_sub_id` OR email, (4) admin reconciliation endpoint |
| Off-amount donor migration | Banner detects `amount_cents NOT IN {900,1900,9900}`; routes through inline disclosure (mirrors email outreach offAmountBlock copy) before Checkout. Stripe `price_data` with the donor's existing custom amount. No silent downgrades. |

## Invariants

The migration system is a small state machine. Implementation MUST uphold:

- **INV-1.** A donor has at most ONE active billing source (Wix XOR Stripe). Never both, never neither (when active).
- **INV-2.** `migration_status` transitions are monotonic forward: `pending → stripe_active → migrated → fully_exited`. No backward transitions. (`fully_exited` is the new terminal name; the existing `wix_cancelled` state is renamed — see "State machine" below.)
- **INV-3.** A Stripe sub linked via `metadata.wix_subscription_id` SHARES the donor identity (CF user) of the Wix sub. Enforced by the magic-link interstitial's email-binding assertion.
- **INV-4.** `cancellation_request.resolved_at IS NOT NULL` ⟺ the underlying source subscription is canceled OR the donor has reactivated.
- **INV-5.** Banner-show predicate: `source==='wix' AND migration_status==='pending' AND cancel_requested_at IS NULL AND migration_handoff_started_at IS NULL AND !dismissed`.
- **INV-6.** `trial_end` is always `> now() + 86400` AND `< now() + 730*86400`. If `next_expected_at` falls outside this window, omit `trial_end` and surface to admin (donor pays today; spec calls this out in copy).
- **INV-7.** `wix_subscription.stripe_subscription_id` is non-null ⟺ `migration_status ∈ {stripe_active, migrated, fully_exited}`.
- **INV-8.** User identity (CF `user.id`, `user.email`) is stable across migration. No new user row is created during handoff.
- **INV-9.** webhook_event dedup spans the migration write AND the admin notification side-effect. Duplicate Stripe `event.id` = idempotent no-op for both.
- **INV-10.** At most one unresolved `cancellation_request` row per `wix_subscription_id`. Enforced by partial UNIQUE INDEX.

Every implementation file edit must be traceable to the invariant it upholds.

## Architecture

### Surfaces touched

| File | Change |
|------|--------|
| `src/pages/account/index.astro` | Add migration banner above billing card. Member-first card layout for Wix donors with working buttons. Empty-state help text. Reactivate button wired to new endpoint. |
| `src/pages/save-the-uterus-club/index.astro` | Member-first layout for logged-in members. Tier change buttons route to migrating Checkout. Off-amount donors get inline disclosure before Checkout. |
| `functions/save-the-uterus-club/migrate.js` | **New Pages Function (NOT static page).** Server-side: validate HMAC token (constant-time), check `migration_status='pending'`, render email-binding interstitial. Static Astro page can't post server-validated tokens to a Stripe redirect; this MUST be a Function. |
| `functions/api/create-checkout.js` | Accept optional `wix_sub_id` body parameter. New code path: lookup by `(id = ? OR email = ? COLLATE NOCASE)` ORDER BY started_at DESC. Off-amount handling. Atomic write-lock via `migration_handoff_started_at`. |
| `functions/api/billing/_webhook-checkout.js` | **Metadata-first pseudocode (mandatory):** if `session.metadata?.wix_subscription_id` present, look up by id and use that path; else fall back to existing email-match. No double-write. |
| `functions/api/billing/_webhook-subscription.js` | Rename `migration_status='wix_cancelled'` writes to `'fully_exited'`. Update existing dashboard query in `wix-migration-status.js` to match. |
| `functions/api/billing/cancel.js` | **New.** Records donor cancel intent. Server re-derives `source` (does NOT trust body); requires active source row; validates reason (≤2000 chars). Source='wix' writes `cancellation_request` + emails admin via durable retry. Source='stripe' calls Stripe API. |
| `functions/api/billing/reactivate.js` | **New.** Defines the Reactivate UI button's backing endpoint. Source='wix': clear `cancel_requested_at`, mark `cancellation_request.resolved_at=now, resolved_by='donor_reactivated'`, email admin "DO NOT cancel". Source='stripe': call `stripe.subscriptions.update(sub_id, { cancel_at_period_end: false })`, resolve cancellation_request. |
| `functions/api/billing/status.js` | Surface `migration_status`, `cancel_requested_at`, `amount_cents` on the subscription payload. Override Wix-vs-Stripe priority when Stripe sub is in terminal-failure state (`incomplete_expired`) so banner can re-show. |
| `functions/api/admin/wix-migration-email.js` | Replace plain-text email link with HMAC-signed magic-link URL. Token signed with `MIGRATION_TOKEN_SECRET`. |
| `functions/api/admin/wix-migration-link.js` | **In-scope (was deferred). New endpoint.** Admin Bearer auth. Manually links a `wix_subscription` to a CF `user.id` for confirmed mismatched-email donors. Audit logged. |
| `functions/api/admin/cleanup.js` | Existing daily 5 AM UTC cron. Extended with two new sweeps: (a) unresolved `cancellation_request` re-email at >48h, (b) un-notified migrations (`migration_status='stripe_active' AND admin_notified_at IS NULL`) re-email. Idempotent via `last_admin_notification_at`. |
| `rrm-wix-sync/src/sync.js` | Webhook handler for Wix `SUBSCRIPTION_CANCELLED` events MUST set `status='cancelled'` explicitly. Cron path also adds: rows with `migration_status='stripe_active' AND status='inactive' AND last_order_at < now-60d` flip to `migrated`. |
| `rrm-wix-sync/src/status.js` | Extend `deriveStatus()` to return `'cancelled'` when an explicit Wix cancellation flag is observed. |
| D1 schema | New `cancellation_request` table. New columns on `wix_subscription`: `cancel_requested_at`, `cancel_reason`, `migration_handoff_started_at`, `admin_notified_at`, `last_admin_notification_at`. |
| Security guard manifest | All new + edited `functions/api/billing/*` and `functions/save-the-uterus-club/migrate.js` added; run `npm run guard:update` post-implementation. |

### State machine

```
                 (donor signs up via banner/STUC)
[null] ────────────► [pending] ─────────► [stripe_active]
                          │                      │
                  (donor cancels Wix)             │ (admin cancels Wix sub
                          │                      │  in Wix admin)
                          ▼                      ▼
                  [pending+cancel_requested]   [migrated]
                          │                      │
                          ▼                      │ (donor cancels Stripe;
                  (admin cancels Wix)            │  cancel_at_period_end fires;
                          │                      │  Stripe sub.deleted)
                          ▼                      ▼
                  [terminal: cancelled         [fully_exited]
                   only, no migration]
```

`stripe_active` and `migrated` differ by Wix-side state: `stripe_active` means handoff happened, Wix not yet cancelled. `migrated` means both. `fully_exited` means donor has departed the Stripe sub too.

### Data flow — happy-path Wix→Stripe migration

```
Mary (Wix Hero, $19/mo, next charge May 12)
  │
  ├─ /account loads
  │   └─ /api/billing/status returns sub.source='wix', migration_status='pending',
  │       cancel_requested_at=null, amount_cents=1900
  │       Banner predicate (INV-5) passes → banner renders
  │
  ├─ Clicks "Switch over"
  │   └─ POST /api/create-checkout { mode: 'subscription', tier: 'hero' }
  │       ├─ Layer 3 lookup: SELECT id, tier, next_expected_at, amount_cents
  │       │     FROM wix_subscription
  │       │     WHERE (id = ? OR email = ? COLLATE NOCASE)
  │       │       AND status = 'active'
  │       │       AND migration_status = 'pending'
  │       │     ORDER BY started_at DESC LIMIT 1
  │       ├─ Atomic lock with 15-min TTL recovery:
  │       │     UPDATE wix_subscription
  │       │     SET migration_handoff_started_at = strftime('%s','now')
  │       │     WHERE id = ?
  │       │       AND (migration_handoff_started_at IS NULL
  │       │            OR migration_handoff_started_at < strftime('%s','now') - 900)
  │       │     RETURNING changes()
  │       │     If 0 changes → return 409 "Migration already in progress, check
  │       │       your account in a moment." Donor's prior Checkout tab still
  │       │       open will reconcile or expire naturally.
  │       ├─ Validate trial_end: clamp to (now+86400, now+730*86400)
  │       │     If next_expected_at outside window → omit trial_end, log AE,
  │       │     email admin "stuck wix-sync for {email}"
  │       ├─ Off-amount check: if amount_cents NOT IN {900,1900,9900},
  │       │     return 412 "off_amount" → frontend shows disclosure modal,
  │       │     donor confirms → second POST with tier OR { custom_amount_cents }
  │       │     Stripe Checkout uses price_data ad-hoc.
  │       ├─ Creates Stripe Checkout Session:
  │       │     - customer_email = userEmail
  │       │     - line_items[].price = STRIPE_PRICE_HERO (or price_data for custom)
  │       │     - subscription_data.trial_end = clamped(next_expected_at)
  │       │     - metadata.wix_subscription_id = wxs_abc123
  │       │     - metadata.migration_handoff = "true"
  │       └─ Returns checkout URL
  │
  ├─ Stripe Checkout
  │   ├─ Shows: "$0 today. $19/month starts May 12, 2026."
  │   └─ Donor enters card, completes
  │
  ├─ Webhook checkout.session.completed
  │   └─ _webhook-checkout.js
  │       ├─ webhook_event dedup (existing): INSERT OR IGNORE → if exists, 200 skip
  │       ├─ if (session.metadata?.wix_subscription_id) {
  │       │     // METADATA-FIRST PATH (mandatory)
  │       │     UPDATE wix_subscription
  │       │       SET migration_status='stripe_active',
  │       │           stripe_subscription_id=?,
  │       │           stripe_active_at=datetime('now'),
  │       │           migration_handoff_started_at=NULL
  │       │       WHERE id=? AND stripe_subscription_id IS NULL
  │       │     return; // do NOT also run email-match path
  │       │   } else {
  │       │     // legacy email-match fallback (existing code)
  │       │   }
  │       ├─ Updates user.stripe_customer_id
  │       ├─ Emails admin: "Cancel Mary's Wix sub before May 12"
  │       │     UPDATE wix_subscription SET admin_notified_at=datetime('now')
  │       │     If SES throws: log, return 5xx so Stripe retries
  │       │     (admin_notified_at remains NULL → cron picks up later)
  │       └─ Returns 200
  │
  └─ Redirected to /account?migrated=1
      ├─ Toast: "Switched! Your next donation is May 12 as scheduled."
      └─ Banner gone. Card now shows source='stripe' with working portal button.

[Async: Brian cancels Wix sub in Wix admin]
  │
  └─ Wix webhook fires SUBSCRIPTION_CANCELLED → rrm-wix-sync handler
      └─ Updates wix_subscription.status = 'cancelled' (explicit, NOT via deriveStatus)
      └─ Sync.js post-update: if migration_status='stripe_active' AND
          stripe_subscription_id IS NOT NULL → flip to 'migrated'.
```

### Component breakdown

#### `/account` migration banner

- Renders only when INV-5 holds. The status payload exposes the four needed fields (`source`, `migration_status`, `cancel_requested_at`, `migration_handoff_started_at`); banner JS evaluates locally.
- Two CTAs: primary "Switch over", secondary × dismiss.
- Copy (locked): *"Thank you for being a Save the Uterus Club member. We'd love to move your donation to our new system — your next donation date stays the same, and you'll be able to manage it yourself from here."*
- Dismissal is local-only. Read via `localStorage.getItem('stuc_migrate_banner_dismissed_v1') === null` (presence-only, NOT truthy-check; corrupted/string-"false" values count as dismissed if present at all).
- Off-amount donor: banner JS reads `amount_cents`; if non-standard, the click triggers an inline confirmation modal first (mirror the email's offAmountBlock copy). Donor chooses standard tier OR confirms custom amount; second POST proceeds.

#### `/account` membership card (Wix donor variant)

- Identical visual to Stripe-donor card. No "legacy" wording.
- Buttons: "Change amount" (primary), "Cancel donation" (outline), **"Update card" (secondary, visible)**.
  - Wix donor "Update card" opens a small modal: *"You can switch over to update your card yourself, or email administrator@rrmacademy.org and we'll update it for you within 1 business day."* — two CTAs. (The earlier decision to hide this button breaks card-expiry recovery for non-migrating donors.)
- "Change amount" → routes to STUC page with `?action=change` (query is informational only; tier is never inferred from the URL).
- "Cancel donation" → opens cancel modal.

#### Cancel donation modal (both source=wix and source=stripe)

- Title: *"Cancel your monthly donation"*
- Body: *"Thank you for everything you've given to this work. Your community access continues through {next_charge_date}."*
- Optional textarea label: *"If you'd like to share why, we read every word"*. **Hard cap 2000 chars (server-validated).**
- Buttons: "Keep donating" (close modal), "Cancel donation" (destructive red, no second confirmation).
- Submit: POST `/api/billing/cancel` with NO `source` field. Server re-derives source by querying both Stripe (subscriptions.list active) and D1 (wix_subscription active); Stripe takes precedence if both exist (matches status.js).
  - Server-derived source='wix' → write `cancellation_request` row, mark `wix_subscription.cancel_requested_at` + `cancel_reason`, mark `cancellation_request.source_subscription_id = wix_subscription.id`, email admin pre-filled action item, set `last_admin_notification_at`.
  - Server-derived source='stripe' → call Stripe API with `cancel_at_period_end=true`; write `cancellation_request` row anyway (for the Reactivate flow).
  - If neither active source found → 409 "No active subscription" (frontend should refetch status).
- Both: instant toast "Got it. Your donation will end after {date}." Card flips to "Ending {date} · Reactivate" state.
- Banner is hidden client-side once cancel modal is submitted (matches INV-5).

#### Reactivate (`/api/billing/reactivate`)

- Donor clicks "Reactivate" on the post-cancel card state.
- Server re-derives source.
- Source='wix':
  - `UPDATE wix_subscription SET cancel_requested_at=NULL, cancel_reason=NULL WHERE id=?`
  - `UPDATE cancellation_request SET resolved_at=strftime('%s','now'), resolved_by='donor_reactivated' WHERE source_subscription_id=? AND resolved_at IS NULL`
  - Email admin: *"Mary reactivated — DO NOT cancel her Wix sub."*
  - If Brian already actioned the original cancel in Wix admin: row state will have `status='cancelled'`. Reactivate endpoint detects this; returns 410 Gone with message *"Your previous donation has already ended. Please switch over to our new system to start a new donation."* — frontend redirects to STUC page.
- Source='stripe':
  - `stripe.subscriptions.update(sub_id, { cancel_at_period_end: false })`
  - Resolve cancellation_request row.
- AE event `stuc-cancel-reactivated`.

#### `/save-the-uterus-club/` member-first layout (logged-in only)

- When `billing.subscription.status === 'active'` AND `cancel_requested_at IS NULL`, page hero shifts:
  - Top: "You're in" status card — tier name, $/month, next donation date, primary "Open community" button, secondary "Manage donation" link to /account.
  - Below: brief "more about the club" content (existing marketing prose, condensed).
  - Tier change is a quiet "Change tier" link inside the status card.
- When non-logged-in, no active sub, OR cancel_requested_at set: existing public marketing layout unchanged.

#### Magic-link migration Pages Function (`functions/save-the-uterus-club/migrate.js`)

This MUST be a Cloudflare Pages Function, NOT a static Astro page. Reasons: HMAC validation requires server secret access; the email-binding assertion requires server-side D1 read; both are pre-redirect gates.

**Token format:** `base64url(JSON{wix_sub_id: string, exp: integer-unix-seconds})` + `.` + `base64url(HMAC-SHA256)`.

**Validator pseudocode (explicit ordering required):**

```js
async function validateToken(token, secret) {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return { ok: false, reason: 'malformed' };

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  // (1) HMAC verify with constant-time compare (use auth/_shared.js helper)
  const expected = await hmacSign(payloadB64, secret);
  if (sigB64.length !== expected.length) return { ok: false, reason: 'forged' };
  if (!constantTimeEqual(sigB64, expected)) return { ok: false, reason: 'forged' };

  // (2) decode + type-check
  let payload;
  try { payload = JSON.parse(base64urlDecode(payloadB64)); }
  catch { return { ok: false, reason: 'malformed' }; }
  if (typeof payload.wix_sub_id !== 'string' ||
      !/^wxs_[a-z0-9_-]+$/.test(payload.wix_sub_id) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= 0) {
    return { ok: false, reason: 'malformed' };
  }

  // (3) expiry check
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, wix_sub_id: payload.wix_sub_id };
}
```

Each `reason` maps 1:1 to the AE telemetry index — `forged`, `expired`, `malformed` are distinguishable.

**Token use is reusable, NOT single-use** (no D1 burn on validate). This survives email-scanner pre-fetches (Mimecast, Microsoft Safe Links, Proofpoint). The replay/cross-user/scanner attacks are prevented by the click-to-confirm interstitial below, NOT by burning the token.

**Page flow (no JS auto-POST):**

1. GET `/save-the-uterus-club/migrate?t=<token>`.
2. Function validates token. On invalid → render fallback HTML with /account link + AE event `stuc-migration-token-invalid` indexed by `reason`.
3. Function reads `wix_subscription` by id. If row not found → 404 fallback. If `migration_status !== 'pending'` → render *"You've already switched over!"* with /account link (idempotent).
4. Function reads donor session. If unauthenticated → render *"Sign in to continue"* with login redirect that returns to this URL.
5. **Email-binding assertion (CRITICAL):** if `session.user.email !== wix_subscription.email COLLATE NOCASE`, render explicit interstitial:
   *"This link was sent to `{masked-wix-email}`. You're signed in as `{session-email}`. Please sign in with the matching email, or contact administrator@rrmacademy.org if you've changed your email."*
   Two buttons: "Sign in with another account" (logout + redirect back) and "Contact us". **No proceed-anyway path.** This kills cross-user replay.
6. Email matched → render confirmation interstitial:
   *"You're about to move your `{tier} ${amount}/mo` donation to our new system. Your next donation date stays the same: `{next_expected_at}`. Continue →"*
   Single button. Click triggers JS POST to `/api/create-checkout` with `{ wix_sub_id, mode: 'subscription' }`. **The button click defeats email-scanner pre-fetch** (scanners don't click).
7. POST creates Checkout session with metadata; client redirects to Stripe URL.
8. Webhook reconciles via metadata path.

**Auth gating:** add `/save-the-uterus-club/migrate` to `_middleware.js` paths that require session. Function returns 302 to `/login?next=...` if no session.

### Email-mismatch guard layers (now 4)

**Layer 1 — Magic link with email-binding interstitial.** (Above.) Eliminates email-copy errors AND cross-user replay AND scanner pre-fetch.

**Layer 2 — /account empty-state help text.** When `/api/billing/status` returns no active subscription, append: *"Donated with a different email? Tell us at administrator@rrmacademy.org."* `mailto:` link prefilled with subject "Existing donation linkage". Brian uses Layer 4 to reconcile.

**Layer 3 — Server-side checkout linkage.** In `create-checkout.js`, before creating any Stripe Checkout Session, run:

```sql
SELECT id, tier, next_expected_at, amount_cents, status, migration_status
FROM wix_subscription
WHERE (id = ? OR email = ? COLLATE NOCASE)
  AND status = 'active'
  AND migration_status = 'pending'
ORDER BY started_at DESC
LIMIT 1;
```

`?1` = `body.wix_sub_id` (NULL when not from magic-link path); `?2` = `userEmail`. The `(id = ? OR email = ? COLLATE NOCASE)` lets the magic-link path bind by id (covers mismatched email) AND the banner path bind by email. ORDER BY prevents arbitrary row selection on data-corruption duplicates.

If found: validate `trial_end`, set metadata, set atomic lock. If not found: proceed with normal Checkout (no trial). Logs AE `stuc-migration-cold-checkout` indexed by `email_mismatch=bool`.

**Layer 4 — Admin reconciliation endpoint** `POST /api/admin/wix-migration-link` (in-scope this spec). Bearer auth via `ADMIN_API_SECRET`. Body: `{ wix_subscription_id, user_id }`. Updates `wix_subscription.user_id`. Audit-logs to AE. Used by Brian to manually pair Sarah-style mismatched donors after Layer 2 mailto comes in.

### D1 schema additions

```sql
-- New table
CREATE TABLE cancellation_request (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('wix','stripe')),
  source_subscription_id TEXT NOT NULL,
  reason TEXT CHECK(length(reason) <= 2000),
  requested_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  last_admin_notification_at INTEGER
);
CREATE INDEX idx_cancellation_request_unresolved
  ON cancellation_request(resolved_at) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX idx_cancellation_request_outstanding_uniq
  ON cancellation_request(source_subscription_id) WHERE resolved_at IS NULL;

-- New columns on wix_subscription
ALTER TABLE wix_subscription ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN cancel_reason TEXT
  CHECK(cancel_reason IS NULL OR length(cancel_reason) <= 2000);
ALTER TABLE wix_subscription ADD COLUMN migration_handoff_started_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN admin_notified_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN last_admin_notification_at INTEGER;
```

`migration_handoff_started_at` is the atomic-lock column (15min TTL enforced in create-checkout). `admin_notified_at` is set by webhook after successful admin email. `last_admin_notification_at` is updated by both first-send and cron re-sends; cron uses it for nag throttling.

### Cron extensions (existing `/api/admin/cleanup`, 5 AM UTC daily)

Two new sweeps added to existing cleanup endpoint (do NOT spin up a new cron; CF Pages Functions can't natively schedule):

```js
// Sweep 1: re-email admin for unresolved cancellations >48h old, throttled to 1/day
const staleCancels = await db.prepare(`
  SELECT id, user_id, email, source, source_subscription_id, reason
  FROM cancellation_request
  WHERE resolved_at IS NULL
    AND requested_at < strftime('%s','now') - 172800
    AND (last_admin_notification_at IS NULL OR last_admin_notification_at < strftime('%s','now') - 86400)
`).all();
// for each: send admin email, UPDATE last_admin_notification_at = now

// Sweep 2: re-email admin for un-notified migrations
const unNotifiedMigrations = await db.prepare(`
  SELECT id, email, stripe_subscription_id
  FROM wix_subscription
  WHERE migration_status = 'stripe_active'
    AND admin_notified_at IS NULL
    AND stripe_active_at < strftime('%s','now') - 600
    AND (last_admin_notification_at IS NULL OR last_admin_notification_at < strftime('%s','now') - 86400)
`).all();
// for each: send admin email, UPDATE last_admin_notification_at = now AND admin_notified_at = now
```

### Error handling

- **Magic-link invalid:** Validator returns `{ok:false, reason: 'malformed'|'forged'|'expired'}`. Page renders friendly fallback. AE logs with `reason` index.
- **Magic-link valid but already migrated:** Page renders *"You've already switched over!"* with /account link. Idempotent.
- **Magic-link valid but session email mismatch:** Page renders the email-binding interstitial. Donor cannot proceed; must re-auth or contact admin.
- **Checkout fails or donor abandons:** No D1 state change beyond the lock column. Banner remains visible. `migration_handoff_started_at` is the only mutated field; the next Switch-over click after 15min naturally overwrites it (TTL semantics in the lock SQL above).
- **Checkout completes but webhook delayed:** status.js race. status.js prefers Stripe over Wix; the brief window where Stripe sub is still 'incomplete' and Wix is still 'active' resolves naturally as Stripe transitions to 'trialing'. If Stripe sub gets stuck in `incomplete_expired`, status.js re-surfaces Wix sub (override branch).
- **Webhook fires but `wix_subscription_id` metadata missing (legacy in-flight sessions):** Falls back to existing email-match path. Logged.
- **Webhook fires but admin email throws (SES down):** Webhook returns 5xx so Stripe retries. `admin_notified_at` remains NULL → daily cron Sweep 2 picks up. **No donor double-charge possible** because handoff DB write is durable; admin notification is the only async piece.
- **Cancel request submitted but admin doesn't action it:** Cron Sweep 1 re-emails. UI shows "Ending {date} · Reactivate" until next billing cycle confirms one way or the other.
- **Cancel request submitted for a sub that no longer exists** (stale frontend race): /api/billing/cancel returns 409, frontend refetches.
- **Reactivate submitted after admin already cancelled in Wix:** Endpoint detects `wix_subscription.status='cancelled'`; returns 410 Gone with message and STUC redirect.
- **Email mismatch + cold STUC click:** Layer 3 SQL returns 0 rows (no id, no email match). Stripe sub created cleanly with NO trial_end. Donor pays today + Wix sub still charges. Brian discovers via `/api/admin/wix-migration-status` dashboard (existing) AND a new daily AE alert when `stuc-migration-cold-checkout` events have `email_mismatch=true`. Brian uses Layer 4 to link.
- **Switch-over double-click race:** First POST sets `migration_handoff_started_at`. Second POST hits the atomic lock check, returns 409. UI shows *"Migration already in progress, check your account in a moment."*
- **Token type confusion:** Validator step 2 rejects with `reason='malformed'` if `wix_sub_id` is not a string-matching-pattern or `exp` is not `Number.isInteger > 0`.
- **HMAC timing attack:** Validator uses `constantTimeEqual` from `auth/_shared.js`. Length-mismatch returns immediately (length is not secret).

### Telemetry

All emit to `worker_events` AE dataset with `event='stuc-migration-*'`:

| Event | When | Indexes |
|-------|------|---------|
| `stuc-migration-banner-shown` | /account loads, banner renders | source=wix |
| `stuc-migration-banner-dismissed` | × clicked | -- |
| `stuc-migration-banner-clicked` | "Switch over" clicked | -- |
| `stuc-migration-checkout-started` | Stripe Checkout session created with migration metadata | wix_sub_id |
| `stuc-migration-completed` | Webhook flips to stripe_active | wix_sub_id |
| `stuc-migration-token-invalid` | Magic-link validation fails | reason=expired/forged/malformed |
| `stuc-migration-token-binding-mismatch` | Magic-link valid but session email != wix sub email | -- |
| `stuc-migration-cold-checkout` | New Stripe sub created without migration metadata | email_mismatch=bool |
| `stuc-migration-handoff-stuck` | Atomic lock 409 OR trial_end clamp triggered | reason |
| `stuc-cancel-requested` | Cancel modal submit | source=wix/stripe, reason_provided=bool |
| `stuc-cancel-reactivated` | Reactivate endpoint succeeds | source=wix/stripe |
| `stuc-admin-notify-retry` | Cron re-emails for stale cancel or un-notified migration | sweep=cancel/migration |

Brian gets weekly Telegram digest from `rrm-observatory` summarizing campaign progress AND any unresolved leakage.

### Testing

- **Unit (Vitest):** Magic-link token sign/verify roundtrip. Validator rejects forged + expired + malformed (each with correct reason). Type assertion on `exp` field. Constant-time compare. trial_end clamp boundary cases (past, near-future, far-future, NULL, malformed string). Off-amount detection.
- **Integration (Wrangler dev + Playwright):**
  - Logged-in Wix donor sees banner; click → Checkout opens with $0-today + correct trial_end + metadata.
  - Banner predicate respects `cancel_requested_at` (cancel + check banner gone).
  - Off-amount donor: banner click → confirmation modal appears before Checkout.
  - Webhook metadata-first path sets migration_status correctly. Email-match path is fallback only.
  - Cancel modal submit; toast; card flips state; admin email queued. Reason >2000 chars rejected with 400.
  - Reactivate flow (source=wix and source=stripe).
  - Magic-link landing: valid token (matched email) → confirmation interstitial → click → Checkout. Mismatched session email → binding interstitial, no proceed path. Already-migrated row → idempotent fallback. Forged token → reason=forged. Expired token → reason=expired.
  - Switch-over double-click: second POST returns 409.
  - Email-mismatch cold checkout: AE event fires with `email_mismatch=true`.
  - Cron sweeps: stale cancel → re-email. Un-notified migration → re-email. last_admin_notification_at throttling holds.
- **Manual smoke (Brian):** Run through full flow on staging with a test Wix sub (matched email + mismatched email). Verify the email-binding interstitial actually blocks the cross-user replay. Verify the off-amount disclosure surfaces.

## Open questions

None.

## Out of scope

- Wix-side cancellation automation beyond the explicit webhook handler (Brian still manually cancels in Wix admin for some flows until full bulk migration).
- Wix→Stripe full bulk migration (this spec enables donor-driven migration; bulk is a separate plan).
- New donor onboarding (already shipped, untouched).
- Mobile-specific layouts (will be tested but no special design).
- Replacing the 3 fixed Stripe price IDs with fully dynamic pricing (only off-amount migration uses `price_data` ad-hoc).

## Implementation phases

Each phase merges to main and ships behind feature flag `STUC_MIGRATION_UX_V2` (env bool) for safe rollback. Flag flipped on once Brian smoke-tests phases 1–8 end-to-end on staging.

1. **Schema + state machine.** New table, new columns, partial UNIQUE index. Rename `wix_cancelled` → `fully_exited` in `_webhook-subscription.js` AND `wix-migration-status.js` queries. Test idempotent migration on staging D1.
2. **Magic-link infrastructure.** `MIGRATION_TOKEN_SECRET` env var. Pages Function `functions/save-the-uterus-club/migrate.js` with validator + email-binding interstitial + idempotent migration check + auth gate. `_middleware.js` auth-gate addition. Unit + integration tests.
3. **Checkout migration linkage.** `create-checkout.js` accepts `wix_sub_id`, runs Layer 3 SQL with `(id = ? OR email = ?)` ORDER BY started_at, atomic write-lock, trial_end clamp, off-amount detection (returns 412 with structured response). `_webhook-checkout.js` metadata-first pseudocode.
4. **Cancel + Reactivate.** New `/api/billing/cancel` (server-derived source, length cap), `/api/billing/reactivate`. Modal UI. Reactivate button on /account.
5. **Banner + /account empty-state.** Visual layer on existing card; INV-5 predicate; "Update card" dual-surface modal; off-amount confirmation modal client-side.
6. **STUC member-first layout.** Page-state branching for logged-in members.
7. **Cron extensions.** Extend `/api/admin/cleanup` with the two new sweeps.
8. **Outreach email update + admin reconciliation.** `wix-migration-email.js` produces magic-link URLs. New `/api/admin/wix-migration-link` for Layer 4 reconciliation. Brian-side dashboard shows `email_mismatch=true` cold checkouts.
9. **Telemetry + observatory digest.** AE events; weekly digest update.
10. **wix-sync amendments (separate repo `rrm-wix-sync`).** Extend `deriveStatus` to surface explicit Wix cancellation. Sync.js cron pass for `stripe_active+inactive+stale → migrated`.

Phase 10 is in `rrm-wix-sync`, NOT `rrm-academy-cf` — coordinate cross-repo merge order so the academy-side state machine doesn't outrun the sync-worker side.
