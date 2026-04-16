# Unified Email Event Log -- Design Spec (v2, post-review)

> Admin visibility into all email activity across RRM Academy. One table, one page, full lifecycle.
> Reviewed by 4-agent /arise swarm (2026-03-17). All findings addressed.

## Problem

Email sends are a black box. Transactional emails (survey, auth, contact, billing) have zero tracking. Newsletter emails have tracking spread across `newsletter_event` and `newsletter_send` tables but no admin UI. Brian cannot see what's being sent, to whom, or whether it's landing.

## Solution

### D1 Table: `email_log`

Single table capturing every email lifecycle event.

```sql
CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,           -- send, delivered, bounced, opened, clicked, unsubscribed, complained, failed
  email TEXT NOT NULL,            -- recipient address (always lowercase)
  category TEXT NOT NULL,         -- transactional | newsletter
  source TEXT NOT NULL,           -- granular per-send label (see Source Labels below)
  subject TEXT,                   -- email subject line (null for non-send events)
  detail TEXT,                    -- click URL, bounce reason, error message, SES message ID
  send_id TEXT,                   -- newsletter send campaign ID (null for transactional, null for bounce/open/click)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Composite indexes for common query patterns (not single-column)
CREATE INDEX idx_email_log_email ON email_log(email COLLATE NOCASE, created_at DESC);
CREATE INDEX idx_email_log_cat_created ON email_log(category, created_at DESC);
CREATE INDEX idx_email_log_source_created ON email_log(source, created_at DESC);
CREATE INDEX idx_email_log_event ON email_log(event);
```

**Design notes:**
- `email` is always normalized to lowercase in `logEmailEvent()` before INSERT.
- Dropped standalone `category` index (only 2 values, useless alone). Covered by composite.
- `send_id` will be NULL for bounce/open/click events because SNS/pixel handlers don't have the app-level send ID. Correlation uses email + time range, not send_id join.
- Retention: 90 days. Added to `admin/cleanup.js` daily cron (see below).

### Source Labels

Multi-send handlers use distinct source labels per email type:

| Handler | Source Label | Recipient |
|---------|-------------|-----------|
| `contact/submit.js` (admin notification) | `contact/notify` | administrator@ |
| `contact/submit.js` (user confirmation) | `contact/confirm` | submitter |
| `billing/_webhook-checkout.js` (course) | `billing/checkout-course` | buyer |
| `billing/_webhook-checkout.js` (STUC welcome) | `billing/checkout-membership` | buyer |
| `billing/_webhook-checkout.js` (account setup) | `billing/checkout-account` | buyer |
| `billing/_webhook-subscription.js` (cancel) | `billing/subscription-cancel` | subscriber |
| `billing/_webhook-invoice.js` (payment failed) | `billing/invoice-failed` | subscriber |
| `survey/submit.js` (D1 failure alert) | `survey/d1-alert` | administrator@ |
| `survey/request.js` | `survey/request` | user |
| `auth/signup.js` | `auth/signup` | user |
| `auth/forgot-password.js` | `auth/forgot-password` | user |
| `auth/resend-verification.js` | `auth/resend-verification` | user |
| `pdf/request.js` | `pdf/request` | user |
| `community/_email.js` (new post) | `community/new-post` | N members (fan-out) |
| `community/_email.js` (reply) | `community/reply` | 1 recipient |
| `community/flags.js` (mod alert) | `community/flag-notify` | N mods (fan-out) |
| `newsletter/send.js` | `newsletter/send` | subscriber |

### Logging Architecture

**Core change: modify `sendEmail()` and `sendRawEmail()` in `_ses.js`.**

Instead of adding a separate `logEmailEvent` wrapper that callers invoke, modify the two send functions to accept optional logging params and handle logging internally. This is the transparent approach -- callers pass `{ db, waitUntil, source, category }` alongside existing params, and the function logs success/failure before returning.

```js
// New signature (backwards-compatible -- logging params optional)
export async function sendEmail(env, { from, to, subject, html, text, replyTo, log: logOpts }) {
  // ... existing SES send logic ...
  // Parse response to extract messageId (instead of returning raw Response)
  const data = await res.json();

  // Log success (best-effort, never throws)
  if (logOpts?.db) {
    try {
      await logOpts.db.prepare(
        "INSERT INTO email_log (event, email, category, source, subject, detail) VALUES ('send', ?, ?, ?, ?, ?)"
      ).bind(to.toLowerCase(), logOpts.category, logOpts.source, subject, data.MessageId).run();
    } catch (_) { /* logging is best-effort */ }
  }

  return { messageId: data.MessageId };
}
```

**Key design decisions:**
1. **`sendEmail` returns `{ messageId }` instead of raw Response.** No current caller reads the response body, so this is safe. Enables message ID logging.
2. **Logging is best-effort.** `email_log` INSERT failures are caught and swallowed. A failed log must never crash the handler or prevent email delivery.
3. **Failure logging happens in the catch block.** When `sendEmail` throws (SES error), the caller's catch block calls a standalone `logEmailFailure(db, { email, source, category, subject, error })` helper. This works with fire-and-forget patterns (`waitUntil + .catch`) because the failure is logged before the error propagates.
4. **`sendEmailSafe` in `_webhook-shared.js`** gets `source` as a new parameter. It calls `logEmailFailure` in its internal catch block since it swallows errors.

**Fire-and-forget callers (signup.js, community):**
```js
// Before: waitUntil(sendEmail(...).catch(() => {}))
// After:
waitUntil(
  sendEmail(env, { ...emailOpts, log: { db: env.DB, source: 'auth/signup', category: 'transactional' } })
    .catch(err => logEmailFailure(env.DB, { email, source: 'auth/signup', category: 'transactional', subject, error: err.message }))
);
```
The `.catch` now logs the failure before swallowing. Both success and failure paths produce an `email_log` entry.

**Community fan-out:** `notifyNewPost` sends N emails via `Promise.all`. Each `sendEmail` call logs inline (best-effort). No special batching needed -- D1 handles concurrent writes and logging is inside `waitUntil` so it doesn't block the response.

**Newsletter tracking handlers (open, click, bounce, unsubscribe):**

| Handler | Has email? | Has send_id? | Approach |
|---------|-----------|-------------|----------|
| `bounce.js` | Yes (from SNS) | No | Log with email, send_id = NULL |
| `unsubscribe.js` | Yes (from query param) | No | Log with email |
| `open.js` | No (only subscriberId) | Yes | Extra D1 read to resolve email, inside waitUntil |
| `click.js` | No (only subscriberId) | Yes | Extra D1 read to resolve email, inside waitUntil |

For open/click, the email lookup is: `SELECT email FROM newsletter_subscriber WHERE id = ?`. This runs inside `waitUntil` (fire-and-forget), so it doesn't delay the pixel response or redirect.

**Dual-write atomicity:** Newsletter handlers that write to both `newsletter_event` and `email_log` use `db.batch()` to wrap both INSERTs in a single transaction.

### API Endpoint: `GET /api/admin/email`

Session-based super_admin auth via `requireSuperAdmin` (matches `admin/content.js` pattern). Import `json` and `optionsResponse` from `auth/_shared.js`.

**Must export `onRequestOptions`** returning `optionsResponse()` for CORS preflight.

**`logEmailEvent()` is an internal helper with no auth.** It's called from already-authenticated endpoints. It must not perform its own auth checks.

**Query params:**
- `event` -- filter by event type (comma-separated). Allowlist: `send, delivered, bounced, opened, clicked, unsubscribed, complained, failed`
- `category` -- `transactional` | `newsletter`. Allowlist enforced.
- `source` -- filter by source label
- `email` -- search by recipient. Parameterized LIKE with `%`/`_` escaping + `COLLATE NOCASE`. Max 200 chars.
- `from` / `to` -- date range (ISO dates). Default: last 28 days when omitted.
- `sort` -- Allowlisted columns only: `created_at` (default), `event`, `email`, `category`, `source`. Never interpolated into SQL.
- `order` -- `asc` | `desc` (default: `desc`). Allowlisted.
- `page` -- pagination (default: 1)
- `limit` -- per page (default: 50, max: 200)
- `view` -- `log` (default) | `recipient` | `stats`

**`view=recipient` requires `email` param.** Returns 400 if missing.

**Response shapes (nested under `data` to match sibling admin endpoints):**

`view=log` (default): paginated event list
```json
{
  "ok": true,
  "data": {
    "events": [
      { "id": 1, "event": "send", "email": "user@example.com", "category": "transactional", "source": "survey/request", "subject": "Your Endometriosis Symptom Self-Survey", "detail": "ses-msg-id", "created_at": "2026-03-17T12:00:00Z" }
    ],
    "total": 847,
    "page": 1,
    "pages": 17
  }
}
```

`view=recipient&email=user@example.com`: all events for one recipient
```json
{
  "ok": true,
  "data": {
    "recipient": "user@example.com",
    "events": [],
    "summary": {
      "total_sent": 5,
      "opens": 3,
      "clicks": 1,
      "bounces": 0,
      "unsubscribed": false,
      "first_seen": "2026-03-10T...",
      "last_activity": "2026-03-17T..."
    }
  }
}
```

`view=stats`: aggregate dashboard data (defaults to last 28 days)
```json
{
  "ok": true,
  "data": {
    "period": { "from": "2026-03-01", "to": "2026-03-17" },
    "totals": {
      "sent": 77, "delivered": 72, "failed": 2, "bounced": 1, "opened": 45, "clicked": 12, "unsubscribed": 3, "complained": 0
    },
    "by_source": [
      { "source": "survey/request", "sent": 76, "failed": 1 }
    ],
    "by_day": [
      { "day": "2026-03-10", "sent": 7, "opened": 4 }
    ]
  }
}
```

**Scaling note:** Page-based pagination with COUNT(*) is fine at current scale (hundreds of rows). At >50K rows, consider cursor-based pagination and drop the total count, or cache with TTL.

### Admin Page: `/admin/email/`

Static Astro page with client-side JS fetching from `/api/admin/email`.

**Layout:**
- Top bar: stat cards (Sent, Delivered, Bounced, Opened, Clicked, Unsubscribed) for selected period
- Filter row: dropdowns for event type, category, source. Date range picker. Email search input.
- Main area: sortable table of events (columns: Time, Event, Recipient, Category, Source, Subject, Detail)
- Click any email address to switch to recipient profile view (timeline of all their events + summary stats)
- Pagination at bottom

**Styling:** Match existing admin pages. Use design system tokens. No external dependencies.

## What This Does NOT Do

- Does not replace `newsletter_event` or `newsletter_send` tables. Those continue to work for newsletter-specific logic (dedup, campaign stats). `email_log` is the unified read layer.
- Does not add SES configuration sets to transactional emails. That would require SNS topic setup for delivery/bounce notifications on transactional sends. Phase 2 if needed.
- Does not add open/click tracking to transactional emails. Only newsletter emails get pixel/link tracking. Transactional emails log the send event only.
- Does not sync with the contact CRM table. Separate concern.
- `send_id` will be NULL for bounce/open/click events. Correlation to newsletter campaigns uses email + time range, not FK join. SES message ID stored in `detail` enables correlation if needed.

## Retention

Add to `admin/cleanup.js` daily cron:
```sql
DELETE FROM email_log WHERE created_at < datetime('now', '-90 days')
```
Note: `cleanup.js` is GUARDED.

## Files Changed

| File | Change | Notes |
|------|--------|-------|
| `functions/api/_ses.js` | Modify `sendEmail`/`sendRawEmail` to accept log opts, return `{ messageId }`, add `logEmailFailure` export | GUARDED |
| `functions/api/admin/email.js` | New endpoint | NEW |
| `src/pages/admin/email.astro` | New admin page | NEW |
| `functions/api/newsletter/bounce.js` | Add email_log insert via db.batch() |  |
| `functions/api/newsletter/open.js` | Add email_log insert + subscriber email lookup via db.batch() | Fix race condition (#21) |
| `functions/api/newsletter/click.js` | Add email_log insert + subscriber email lookup via db.batch() | Fix race condition (#22) |
| `functions/api/newsletter/unsubscribe.js` | Add email_log insert |  |
| `functions/api/newsletter/send.js` | Pass log opts to sendRawEmail | Fix segmented send total_recipients (#23) |
| `functions/api/auth/signup.js` | Pass log opts + catch-then-log pattern | GUARDED |
| `functions/api/auth/forgot-password.js` | Pass log opts | GUARDED |
| `functions/api/auth/resend-verification.js` | Pass log opts |  |
| `functions/api/contact/submit.js` | Pass log opts with distinct sources (contact/notify, contact/confirm) |  |
| `functions/api/survey/request.js` | Pass log opts | GUARDED |
| `functions/api/survey/submit.js` | Pass log opts (source: survey/d1-alert) | GUARDED |
| `functions/api/pdf/request.js` | Pass log opts | GUARDED |
| `functions/api/community/_email.js` | Pass log opts; add `waitUntil` param to notifyNewPost/notifyReply signatures |  |
| `functions/api/community/flags.js` | Pass log opts |  |
| `functions/api/billing/_webhook-checkout.js` | Pass distinct sources to sendEmailSafe | GUARDED |
| `functions/api/billing/_webhook-subscription.js` | Pass source to sendEmailSafe | GUARDED |
| `functions/api/billing/_webhook-invoice.js` | Pass source to sendEmailSafe | GUARDED |
| `functions/api/billing/_webhook-shared.js` | Add `source` param to sendEmailSafe, log success/failure internally | GUARDED |
| `functions/api/admin/cleanup.js` | Add email_log retention (90 days) | GUARDED |
| D1 migration `011-email-log.sql` | CREATE TABLE + indexes |  |

**Total: 23 files (2 new, 21 modified). 10 are GUARDED -- run `npm run guard:update` after all changes, include `guard-manifest.json` in commit.**

## Migration

```sql
-- migrations/011-email-log.sql
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  subject TEXT,
  detail TEXT,
  send_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(email COLLATE NOCASE, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_cat_created ON email_log(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_source_created ON email_log(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_event ON email_log(event);
```

## Bug Fixes (included)

Three existing bugs found by Gemini during spec review:

1. **`newsletter/click.js` race condition:** INSERT then SELECT COUNT for dedup isn't atomic. Two concurrent clicks both skip the increment. Fix: `INSERT OR IGNORE` with UNIQUE constraint, check `result.changes > 0`. Requires adding UNIQUE constraint on `(send_id, subscriber_id, event, detail)` to `newsletter_event`.

2. **`newsletter/open.js` race condition:** SELECT then INSERT for dedup isn't atomic. Two concurrent opens both increment. Fix: `INSERT OR IGNORE` with UNIQUE constraint, check `result.changes > 0`. Same UNIQUE constraint as above.

3. **`newsletter/send.js` segmented send total:** `totalRecipients` only calculated for unsegmented sends. Segmented sends have `total_recipients = 0`. Fix: calculate count for segmented sends by filtering on segment match.

**Additional migration for race condition fixes:**
```sql
-- Add to 011-email-log.sql or separate migration
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_event_dedup
  ON newsletter_event(send_id, subscriber_id, event);
```
Note: `detail` excluded from unique index -- multiple clicks to different URLs from same subscriber are valid.

## Implementation Notes

- The `newsletter_send.bounce_count` bug (never incremented) is NOT fixable without a SES message ID to send_id mapping. Deferred. Campaign-level bounce counts can be derived from `email_log` in the admin UI instead.
- `community/_email.js` functions (`notifyNewPost`, `notifyReply`) need `waitUntil` added to their signatures. Callers (`posts.js`, `comments.js`) already have access to `waitUntil`.
- `notifyReply` in `community/_email.js` has no try/catch on `sendEmail` (existing bug). Wrap it to match `notifyNewPost`'s `.catch()` pattern.
