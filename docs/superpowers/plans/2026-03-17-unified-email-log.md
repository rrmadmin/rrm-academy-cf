# Unified Email Event Log Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Brian direct admin visibility into every email sent, opened, clicked, bounced, and unsubscribed across the entire RRM Academy platform.

**Architecture:** Single `email_log` D1 table logged from `_ses.js` (transparent to callers). Admin endpoint at `/api/admin/email` with three views (log, recipient, stats). Astro admin page at `/admin/email/`. Newsletter race condition bugs fixed alongside.

**Tech Stack:** D1 (SQLite), CF Pages Functions, Astro static page, vanilla JS client

**Spec:** `docs/superpowers/specs/2026-03-17-unified-email-log-design.md`

---

### Task 1: D1 Migration + Newsletter Dedup Constraint

**Files:**
- Create: `migrations/011-email-log.sql`

- [ ] **Step 1: Create migration file**

```sql
-- migrations/011-email-log.sql

-- Unified email event log
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

-- Fix newsletter open/click race conditions (dedup constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_event_dedup
  ON newsletter_event(send_id, subscriber_id, event);
```

- [ ] **Step 2: Run migration on remote D1**

```bash
cd ~/iCode/projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --file=migrations/011-email-log.sql
```

Expected: Tables and indexes created. The UNIQUE index on `newsletter_event` may warn about existing duplicates -- if so, deduplicate first:
```sql
DELETE FROM newsletter_event WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM newsletter_event GROUP BY send_id, subscriber_id, event
);
```
Then re-run the UNIQUE index creation.

- [ ] **Step 3: Commit**

```bash
git add migrations/011-email-log.sql
git commit -m "migration: add email_log table and newsletter_event dedup index"
```

---

### Task 2: Modify `_ses.js` -- Transparent Logging + Return `{ messageId }`

**Files:**
- Modify: `functions/api/_ses.js` (GUARDED)

Read `_ses.js` fully before editing. This is the chokepoint for all email sends.

- [ ] **Step 1: Add `logEmailFailure` export and modify `sendEmail` return value**

Change `sendEmail` to:
1. Accept optional `log` property in the options object: `{ db, source, category }`
2. Parse the SES response body and return `{ messageId }` instead of raw Response
3. On success, INSERT a `send` event into `email_log` (best-effort, caught)
4. Export a standalone `logEmailFailure(db, opts)` for callers to use in `.catch()` blocks

```js
// At the end of sendEmail, replace:
//   return res;
// With:

const data = await res.json();
const messageId = data.MessageId || null;

// Best-effort logging (never throws)
if (log?.db && log?.source) {
  const recipient = Array.isArray(to) ? to[0] : to;
  try {
    await log.db.prepare(
      "INSERT INTO email_log (event, email, category, source, subject, detail) VALUES ('send', ?, ?, ?, ?, ?)"
    ).bind(
      recipient.toLowerCase(),
      log.category || 'transactional',
      log.source,
      subject,
      messageId
    ).run();
  } catch (_) { /* logging is best-effort */ }
}

return { messageId };
```

Apply the same pattern to `sendRawEmail`:
1. Accept optional `log` property
2. Parse response, extract MessageId
3. Log on success (best-effort)
4. Return `{ messageId }`

Note: `sendRawEmail` callers (only `newsletter/send.js`) will need the return value updated.

Add the failure logger export:

```js
/**
 * Log a failed email send to email_log. Best-effort, never throws.
 * Call this in .catch() blocks for fire-and-forget senders.
 */
export async function logEmailFailure(db, { email, source, category, subject, error }) {
  if (!db) return;
  try {
    await db.prepare(
      "INSERT INTO email_log (event, email, category, source, subject, detail) VALUES ('failed', ?, ?, ?, ?, ?)"
    ).bind(
      (email || '').toLowerCase(),
      category || 'transactional',
      source || 'unknown',
      subject || null,
      (error || '').substring(0, 500)
    ).run();
  } catch (_) { /* best-effort */ }
}
```

- [ ] **Step 2: Verify no current caller reads the Response body**

```bash
cd ~/iCode/projects/rrm-academy-cf
grep -rn "sendEmail\|sendRawEmail" functions/api/ | grep -v "import\|from.*_ses" | grep -v "//\|log\|console"
```

Confirm no caller does `const body = await sendEmail(...); body.json()` or similar. All callers either discard the return or just `await` it.

- [ ] **Step 3: Commit**

```bash
git add functions/api/_ses.js
git commit -m "feat: add email_log transparency to sendEmail/sendRawEmail"
```

---

### Task 3: Update `sendEmailSafe` in Billing Webhook Shared

**Files:**
- Modify: `functions/api/billing/_webhook-shared.js` (GUARDED)

- [ ] **Step 1: Add `source` parameter and internal logging**

Read the file first. Current signature: `sendEmailSafe(env, waitUntil, { to, subject, text })`.

New signature: `sendEmailSafe(env, waitUntil, { to, subject, text, source })`.

In the success path, the `sendEmail` call now includes `log` opts. In the catch block, call `logEmailFailure`:

```js
import { sendEmail as sesSendEmail, logEmailFailure } from '../_ses.js';

export async function sendEmailSafe(env, waitUntil, { to, subject, text, source }) {
  const src = source || 'billing/unknown';
  try {
    await sesSendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to,
      subject,
      text,
      log: { db: env.DB, source: src, category: 'transactional' },
    });
  } catch (err) {
    log(env, waitUntil, 'billing', 'email_send_fail', 'error', `${to}: ${err.message}`);
    await logEmailFailure(env.DB, { email: to, source: src, category: 'transactional', subject, error: err.message });
  }
}
```

- [ ] **Step 2: Update all `sendEmailSafe` callers with source labels**

Read each file, add the `source` property:

| File | Source label |
|------|-------------|
| `billing/_webhook-checkout.js` (course enrollment) | `billing/checkout-course` |
| `billing/_webhook-checkout.js` (STUC welcome) | `billing/checkout-membership` |
| `billing/_webhook-checkout.js` (account setup) | `billing/checkout-account` |
| `billing/_webhook-subscription.js` (cancel) | `billing/subscription-cancel` |
| `billing/_webhook-invoice.js` (payment failed) | `billing/invoice-failed` |

- [ ] **Step 3: Commit**

```bash
git add functions/api/billing/_webhook-shared.js functions/api/billing/_webhook-checkout.js functions/api/billing/_webhook-subscription.js functions/api/billing/_webhook-invoice.js
git commit -m "feat: add email logging to billing webhook email sends"
```

---

### Task 4: Update Transactional Email Callers

**Files:**
- Modify: `functions/api/auth/signup.js` (GUARDED)
- Modify: `functions/api/auth/forgot-password.js` (GUARDED)
- Modify: `functions/api/auth/resend-verification.js`
- Modify: `functions/api/contact/submit.js`
- Modify: `functions/api/survey/request.js` (GUARDED)
- Modify: `functions/api/survey/submit.js` (GUARDED)
- Modify: `functions/api/pdf/request.js` (GUARDED)

Read each file before editing. For each `sendEmail` call, add the `log` property.

- [ ] **Step 1: Update auth endpoints**

For `signup.js` (fire-and-forget pattern -- uses `waitUntil` + `.catch`):
```js
import { sendEmail, logEmailFailure } from '../_ses.js';

// Replace the existing waitUntil(sendEmail(...).catch(() => {})) with:
waitUntil(
  sendEmail(env, {
    from: 'RRM Academy <accounts@mail.rrmacademy.org>',
    to: email,
    subject: 'Verify your RRM Academy account',
    html: buildVerifyHtml(verifyUrl),
    log: { db: env.DB, source: 'auth/signup', category: 'transactional' },
  }).catch(err => logEmailFailure(env.DB, {
    email, source: 'auth/signup', category: 'transactional',
    subject: 'Verify your RRM Academy account', error: err.message,
  }))
);
```

For `forgot-password.js` and `resend-verification.js` (blocking await pattern):
```js
await sendEmail(env, {
  // ... existing params ...
  log: { db: env.DB, source: 'auth/forgot-password', category: 'transactional' },
});
```
These already have try/catch. Add `logEmailFailure` in the catch block.

- [ ] **Step 2: Update contact, survey, and PDF endpoints**

For `contact/submit.js` -- TWO sends, distinct sources:
- Admin notification: `source: 'contact/notify'`
- User confirmation: `source: 'contact/confirm'`

For `survey/request.js`: `source: 'survey/request'`
For `survey/submit.js` (D1 failure alert to admin): `source: 'survey/d1-alert'`
For `pdf/request.js`: `source: 'pdf/request'`

- [ ] **Step 3: Commit**

```bash
git add functions/api/auth/signup.js functions/api/auth/forgot-password.js functions/api/auth/resend-verification.js functions/api/contact/submit.js functions/api/survey/request.js functions/api/survey/submit.js functions/api/pdf/request.js
git commit -m "feat: add email logging to transactional email callers"
```

---

### Task 5: Update Community Email Notifications

**Files:**
- Modify: `functions/api/community/_email.js`
- Modify: `functions/api/community/flags.js`

- [ ] **Step 1: Update `_email.js` signatures and add logging**

Add `waitUntil` to `notifyNewPost` and `notifyReply` signatures (callers already have access). Add `log` opts to each `sendEmail` call.

`notifyNewPost`: source `community/new-post`, category `transactional`
`notifyReply`: source `community/reply`, category `transactional`

Also wrap `notifyReply`'s `sendEmail` in try/catch (existing bug -- currently throws unhandled).

- [ ] **Step 2: Update callers in `posts.js` and `comments.js` to pass `waitUntil`**

Read `functions/api/community/posts.js` and `comments.js` to verify they have `waitUntil` available in their handler context. Add it to `notifyNewPost`/`notifyReply` calls.

- [ ] **Step 3: Update `flags.js`**

Source: `community/flag-notify`, category `transactional`.

- [ ] **Step 4: Commit**

```bash
git add functions/api/community/_email.js functions/api/community/flags.js functions/api/community/posts.js functions/api/community/comments.js
git commit -m "feat: add email logging to community notifications"
```

---

### Task 6: Update Newsletter Send + Fix Segmented Total

**Files:**
- Modify: `functions/api/newsletter/send.js`

- [ ] **Step 1: Add log opts to `sendRawEmail` calls**

Source: `newsletter/send`, category: `newsletter`. The `sendRawEmail` call already runs in a batch loop. Add log opts.

- [ ] **Step 2: Fix segmented send total_recipients**

Replace the `totalRecipients` block (lines 60-72):

```js
let totalRecipients = 0;
if (!segments || segments.length === 0) {
  const countResult = await db.prepare(
    "SELECT COUNT(*) as c FROM newsletter_subscriber WHERE status = 'active'"
  ).first();
  totalRecipients = countResult.c;
} else {
  // Count matching subscribers for segmented sends
  const allSubs = await db.prepare(
    "SELECT segments FROM newsletter_subscriber WHERE status = 'active'"
  ).all();
  totalRecipients = allSubs.results.filter(sub => {
    const subSegs = JSON.parse(sub.segments || '[]');
    return segments.some(seg => subSegs.includes(seg));
  }).length;
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/send.js
git commit -m "feat: add email logging to newsletter send + fix segmented total_recipients"
```

---

### Task 7: Fix Newsletter Open/Click Race Conditions + Add email_log

**Files:**
- Modify: `functions/api/newsletter/open.js`
- Modify: `functions/api/newsletter/click.js`

- [ ] **Step 1: Fix `open.js` race condition and add email_log**

Replace the SELECT-then-INSERT dedup with `INSERT OR IGNORE` + check `result.changes`:

```js
// Inside waitUntil block:
const subRow = await env.DB.prepare(
  "SELECT email FROM newsletter_subscriber WHERE id = ?"
).bind(subscriberId).first();
const recipientEmail = subRow?.email || '';

const result = await env.DB.prepare(
  "INSERT OR IGNORE INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'opened')"
).bind(sendId, subscriberId).run();

if (result.changes > 0) {
  await env.DB.batch([
    env.DB.prepare("UPDATE newsletter_send SET open_count = open_count + 1 WHERE id = ?").bind(sendId),
    env.DB.prepare("UPDATE newsletter_subscriber SET last_opened_at = datetime('now') WHERE id = ?").bind(subscriberId),
    env.DB.prepare(
      "INSERT INTO email_log (event, email, category, source, send_id) VALUES ('opened', ?, 'newsletter', 'newsletter/open', ?)"
    ).bind(recipientEmail.toLowerCase(), sendId),
  ]);
}
```

- [ ] **Step 2: Fix `click.js` race condition and add email_log**

Same pattern: `INSERT OR IGNORE` + `result.changes > 0`:

```js
const subRow = await env.DB.prepare(
  "SELECT email FROM newsletter_subscriber WHERE id = ?"
).bind(subscriberId).first();
const recipientEmail = subRow?.email || '';

const results = await env.DB.batch([
  env.DB.prepare(
    "INSERT OR IGNORE INTO newsletter_event (send_id, subscriber_id, event, detail) VALUES (?, ?, 'clicked', ?)"
  ).bind(sendId, subscriberId, dest),
  env.DB.prepare("UPDATE newsletter_subscriber SET last_clicked_at = datetime('now') WHERE id = ?").bind(subscriberId),
]);

if (results[0].changes > 0) {
  await env.DB.batch([
    env.DB.prepare("UPDATE newsletter_send SET click_count = click_count + 1 WHERE id = ?").bind(sendId),
    env.DB.prepare(
      "INSERT INTO email_log (event, email, category, source, detail, send_id) VALUES ('clicked', ?, 'newsletter', 'newsletter/click', ?, ?)"
    ).bind(recipientEmail.toLowerCase(), dest, sendId),
  ]);
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/open.js functions/api/newsletter/click.js
git commit -m "fix: race conditions in open/click tracking + add email_log"
```

---

### Task 8: Update Newsletter Bounce + Unsubscribe with email_log

**Files:**
- Modify: `functions/api/newsletter/bounce.js`
- Modify: `functions/api/newsletter/unsubscribe.js`

- [ ] **Step 1: Add email_log inserts to `bounce.js`**

Read the file first. For each event type (Bounce, Complaint, Delivery), add an `email_log` INSERT using `db.batch()` alongside existing writes:

- Bounce: `event: 'bounced'`, `detail: bounce type + diagnostic code`
- Complaint: `event: 'complained'`
- Delivery: `event: 'delivered'`

All use `category: 'newsletter'`, `source: 'ses/bounce-webhook'`.

`send_id` will be NULL (not available from SNS notification).

- [ ] **Step 2: Add email_log insert to `unsubscribe.js`**

After the existing status UPDATE, add:

```js
await env.DB.prepare(
  "INSERT INTO email_log (event, email, category, source) VALUES ('unsubscribed', ?, 'newsletter', 'newsletter/unsubscribe')"
).bind(email.toLowerCase()).run();
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/bounce.js functions/api/newsletter/unsubscribe.js
git commit -m "feat: add email_log to bounce/complaint/delivery/unsubscribe handlers"
```

---

### Task 9: Add Cleanup Rule

**Files:**
- Modify: `functions/api/admin/cleanup.js` (GUARDED)

- [ ] **Step 1: Add email_log retention**

Read the file. Add after the existing `newsletter_event` cleanup:

```js
// Prune email_log older than 90 days
const emailLog = await db.prepare(
  "DELETE FROM email_log WHERE created_at < datetime('now', '-90 days')"
).run();
```

Add `email_log: emailLog.changes` to the `pruned` response object.

- [ ] **Step 2: Commit**

```bash
git add functions/api/admin/cleanup.js
git commit -m "feat: add email_log 90-day retention to daily cleanup"
```

---

### Task 10: Admin API Endpoint

**Files:**
- Create: `functions/api/admin/email.js`

Use the `coder` agent for this task (it's in `functions/api/`).

- [ ] **Step 1: Create the endpoint**

Read `functions/api/admin/content.js` for the pattern. Create `email.js` with:

- `onRequestGet`: main handler with `requireSuperAdmin` auth
- `onRequestOptions`: CORS preflight via `optionsResponse()`
- Three views: `log` (default), `recipient`, `stats`
- Allowlisted `sort` columns: `created_at`, `event`, `email`, `category`, `source`
- Allowlisted `order`: `asc`, `desc`
- `email` search: parameterized LIKE with `%`/`_` escaping, `COLLATE NOCASE`
- `view=recipient` requires `email` param (400 if missing)
- `view=stats` defaults to last 28 days when `from`/`to` omitted
- All responses nested under `data` key: `{ ok: true, data: { ... } }`
- Validate `event`, `category` params against allowlists
- `limit` capped at 200

- [ ] **Step 2: Commit**

```bash
git add functions/api/admin/email.js
git commit -m "feat: add /api/admin/email endpoint with log, recipient, and stats views"
```

---

### Task 11: Admin Page

**Files:**
- Create: `src/pages/admin/email.astro`

- [ ] **Step 1: Create the admin page**

Read `src/pages/admin/seo.astro` for the layout pattern. Create `email.astro` with:

- `BaseLayout` with `noindex={true}`, `bodyClass="admin-page"`
- Admin nav bar matching existing admin pages (add "Email" to the nav links)
- Stat cards row: Sent, Delivered, Bounced, Opened, Clicked, Unsubscribed
- Filter row: event type dropdown, category dropdown, source dropdown, date range inputs, email search
- Results table: Time, Event, Recipient, Category, Source, Subject, Detail
- Clickable email addresses that switch to recipient profile view
- Pagination controls
- Client-side JS: fetch from `/api/admin/email`, handle filters, sorting, view switching
- Design system tokens only (no hardcoded colors/fonts)
- Session auth check (redirect to `/login` on 401)

- [ ] **Step 2: Update admin nav on other admin pages**

Add "Email" link to the admin nav bar in existing admin pages (`seo.astro`, and any others that share the nav).

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/email.astro src/pages/admin/seo.astro
git commit -m "feat: add /admin/email/ page with unified email event dashboard"
```

---

### Task 12: Guard Update + Final Verification

- [ ] **Step 1: Update guard manifest**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run guard:update
```

Expected: ALL CLEAR. 10 guarded files changed in this implementation.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Verify migration is applied**

```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT COUNT(*) as c FROM email_log"
```

Expected: `c: 0` (table exists, no rows yet).

- [ ] **Step 4: Final commit and push**

```bash
git add guard-manifest.json
git commit -m "chore: update guard manifest for email log changes"
git push origin main
```

- [ ] **Step 5: Smoke test**

After deploy completes:
1. Trigger a forgot-password email via the site UI
2. Check D1: `SELECT * FROM email_log ORDER BY id DESC LIMIT 5`
3. Visit `/admin/email/` while logged in as super_admin
4. Verify the email event appears in the dashboard

---

## Task Dependency Graph

```
Task 1 (migration) ─────────────────────────────────┐
                                                      │
Task 2 (_ses.js) ──┬── Task 3 (billing/shared) ──┐   │
                   │                               │   │
                   ├── Task 4 (transactional)      │   │
                   │                               │   │
                   ├── Task 5 (community)          ├── Task 12 (guard + verify)
                   │                               │   │
                   └── Task 6 (newsletter send)    │   │
                                                   │   │
Task 7 (open/click race fix) ─────────────────────┤   │
                                                   │   │
Task 8 (bounce/unsubscribe) ──────────────────────┤   │
                                                   │   │
Task 9 (cleanup) ─────────────────────────────────┤   │
                                                   │   │
Task 10 (API endpoint) ───────────────────────────┤   │
                                                   │   │
Task 11 (admin page) ─────────────────────────────┘   │
                                                      │
```

**Parallelizable:** Tasks 3-9 can all run in parallel after Task 2. Task 10 and 11 can run in parallel. Task 12 is sequential (last).

**Critical path:** Task 1 → Task 2 → Tasks 3-11 (parallel) → Task 12
