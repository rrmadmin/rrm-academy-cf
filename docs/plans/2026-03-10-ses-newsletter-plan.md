# SES Newsletter System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Buttondown with a self-hosted newsletter system on D1 + SES. Gmail-plain email style, open/click tracking, RSS-triggered auto-sends, SNS bounce handling.

**Architecture:** Newsletter subscribers live in D1 (same database as users). Sends go through the existing `_ses.js` helper with added headers for unsubscribe and tracking. A cron-triggered Worker checks the RSS feed for new posts and dispatches sends. SNS webhooks handle bounces/complaints. Open/click tracking uses lightweight redirect endpoints logged to Analytics Engine.

**Tech Stack:** D1, SES (v2 API via aws4fetch), CF Pages Functions, Analytics Engine, SNS webhooks

**Design constraint:** Emails must look like plain Gmail messages -- system fonts, no header images, no footer grids, no social icons. Just text with 1-3 links and a small footer. Any images are inline, not designed.

---

## File Structure

```
functions/api/
  _ses.js                          # MODIFY: add sendRawEmail for custom headers (List-Unsubscribe)
  newsletter/
    subscribe.js                   # MODIFY: replace Buttondown with D1 insert
    unsubscribe.js                 # CREATE: one-click + link unsubscribe handler
    send.js                        # CREATE: admin-authed paginated send endpoint
    open.js                        # CREATE: 1x1 pixel tracking endpoint
    click.js                       # CREATE: click redirect tracking endpoint
    bounce.js                      # CREATE: SNS bounce/complaint webhook (secret-gated)
    _template.js                   # CREATE: plain HTML email renderer
    _tracking.js                   # CREATE: URL wrapping + pixel generation helpers + shared HMAC

schema.sql                         # MODIFY: add newsletter tables
migrations/005-newsletter.sql      # CREATE: D1 migration for newsletter tables
```

**Key design decisions:**
- **SES Raw format** for newsletter sends (required for List-Unsubscribe headers). Transactional emails keep Simple format.
- **Paginated send** to handle CF Pages 100-second timeout: send.js processes a page of subscribers and returns a cursor. n8n loops until done.
- **Bounce webhook** gated by `NEWSLETTER_BOUNCE_SECRET` query param (simpler than SNS signature verification, equally secure).
- **Click tracking** only redirects to `rrmacademy.org` (blocks open redirects). External links are not wrapped.
- **Shared HMAC** function lives in `_tracking.js`, imported by `unsubscribe.js` (no duplication).
- **Plain text fallback** uses original body (pre-tracking-wrap) so plain text readers don't see tracking URLs.
- **Parameterized queries everywhere** -- no string interpolation in SQL (cursor, filters all use `?` binds).
- **SQL LIMIT on subscriber pages** -- each invocation fetches PAGE_SIZE+1 rows max, not the full subscriber list.
- **`Precedence: bulk`** header on all newsletter sends to suppress auto-replies.

---

## Chunk 1: D1 Schema + Subscribe Endpoint

### Task 1: D1 Newsletter Schema

**Files:**
- Create: `migrations/005-newsletter.sql`
- Modify: `schema.sql` (append new tables)

- [ ] **Step 1: Write the migration SQL**

```sql
-- migrations/005-newsletter.sql
-- Newsletter system tables (SES-based, replaces Buttondown)

CREATE TABLE IF NOT EXISTS newsletter_subscriber (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'active',  -- active | unsubscribed | bounced | complained
    segments TEXT DEFAULT '[]',             -- JSON array: ["donor","student","stuc"]
    source TEXT DEFAULT 'website',          -- website | import | admin
    subscribed_at TEXT DEFAULT (datetime('now')),
    unsubscribed_at TEXT,
    bounce_count INTEGER DEFAULT 0,
    last_sent_at TEXT,
    last_opened_at TEXT,
    last_clicked_at TEXT,
    user_id TEXT REFERENCES user(id) ON DELETE SET NULL  -- optional link to site user
);

CREATE INDEX IF NOT EXISTS idx_nl_subscriber_status ON newsletter_subscriber(status);
CREATE INDEX IF NOT EXISTS idx_nl_subscriber_user ON newsletter_subscriber(user_id);
-- Note: email column already has implicit unique index from UNIQUE constraint

CREATE TABLE IF NOT EXISTS newsletter_send (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text_body TEXT,
    segment_filter TEXT,              -- JSON: null = all, or ["stuc","donor"]
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | sending | sent | failed
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    bounce_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT,
    commentary_slug TEXT              -- if triggered by RSS, link to the post
);

CREATE INDEX IF NOT EXISTS idx_nl_send_status ON newsletter_send(status);

CREATE TABLE IF NOT EXISTS newsletter_event (
    id INTEGER PRIMARY KEY,
    send_id TEXT NOT NULL REFERENCES newsletter_send(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL REFERENCES newsletter_subscriber(id) ON DELETE CASCADE,
    event TEXT NOT NULL,               -- sent | delivered | opened | clicked | bounced | complained
    detail TEXT,                       -- click URL, bounce reason, etc.
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nl_event_send ON newsletter_event(send_id);
CREATE INDEX IF NOT EXISTS idx_nl_event_subscriber ON newsletter_event(subscriber_id);
```

- [ ] **Step 2: Append tables to schema.sql**

Add the same tables to the end of `schema.sql` under a `-- Newsletter System (SES-based)` comment.

- [ ] **Step 3: Apply migration to production D1**

```bash
cd ~/iCode/projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --file=migrations/005-newsletter.sql
```

Expected: `OK` with no errors.

- [ ] **Step 4: Commit**

```bash
git add migrations/005-newsletter.sql schema.sql
git commit -m "feat: add newsletter D1 schema (subscribers, sends, events)"
```

---

### Task 2: Rewrite Subscribe Endpoint (D1 instead of Buttondown)

**Files:**
- Modify: `functions/api/newsletter/subscribe.js`

The existing endpoint validates Turnstile, then calls Buttondown API. Replace the Buttondown section with a D1 insert into `newsletter_subscriber`. Keep Turnstile, honeypot, email validation, GA4 event, and `user.newsletter_opt_in` update.

- [ ] **Step 1: Rewrite subscribe.js**

Replace the Buttondown API call (lines 77-105) with:

```js
// Check for existing subscriber
const existing = await env.DB.prepare(
  'SELECT id, status FROM newsletter_subscriber WHERE email = ?'
).bind(email).first();

if (existing) {
  if (existing.status === 'active') {
    return json({ ok: true, message: 'You are already subscribed.' });
  }
  // Re-activate unsubscribed/bounced subscriber
  await env.DB.prepare(
    "UPDATE newsletter_subscriber SET status = 'active', unsubscribed_at = NULL, bounce_count = 0 WHERE id = ?"
  ).bind(existing.id).run();
  return json({ ok: true, message: 'You are subscribed!' });
}

// Create new subscriber
const id = crypto.randomUUID();
await env.DB.prepare(
  "INSERT INTO newsletter_subscriber (id, email, source) VALUES (?, ?, 'website')"
).bind(id, email).run();
```

Also:
- Remove the `BUTTONDOWN_API_KEY` check at the top (replace with `DB` check)
- Remove the `buttondown_error` log references
- Remove the local `CORS_HEADERS` constant and `json()` function
- Import `json`, `optionsResponse` from `../auth/_shared.js` (match codebase pattern)
- Replace `onRequestOptions` with: `export async function onRequestOptions() { return optionsResponse(); }`
- Keep the `user.newsletter_opt_in` D1 update (lines 107-116)
- Keep GA4 event (line 119)

- [ ] **Step 2: Verify subscribe works locally**

```bash
npx wrangler pages dev dist -- --d1 DB=rrm-auth
# In another terminal:
curl -X POST http://localhost:8788/api/newsletter/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com"}'
```

Expected: `{"ok":true,"message":"You are subscribed!"}`

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/subscribe.js
git commit -m "feat: replace Buttondown with D1 subscriber storage"
```

---

### Task 3: Unsubscribe Endpoint

**Files:**
- Create: `functions/api/newsletter/unsubscribe.js`

Must support two flows:
1. **One-click (RFC 8058):** `POST /api/newsletter/unsubscribe` with `List-Unsubscribe=One-Click` header. Gmail/Yahoo send a POST with the subscriber token. Return 200.
2. **Link click:** `GET /api/newsletter/unsubscribe?t={token}` renders a confirmation page.

Token is an HMAC-SHA256 of the subscriber email using `NEWSLETTER_SECRET` env var.

- [ ] **Step 1: Write unsubscribe.js**

```js
/**
 * Newsletter unsubscribe handler.
 * GET: renders confirmation page (link from email footer)
 * POST: one-click unsubscribe (RFC 8058, called by Gmail/Yahoo)
 */
import { log } from '../_log.js';
import { hmacToken } from './_tracking.js';

async function unsubscribe(db, email, waitUntil, env) {
  await db.prepare(
    "UPDATE newsletter_subscriber SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE email = ? AND status = 'active'"
  ).bind(email).run();
  // Sync user table opt-in flag
  await db.prepare(
    "UPDATE user SET newsletter_opt_in = 0 WHERE email = ? COLLATE NOCASE"
  ).bind(email).run();
  log(env, waitUntil, 'newsletter', 'unsubscribe', 'ok', email, 0, 200);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const email = url.searchParams.get('e') || '';

  if (!token || !email || !env.NEWSLETTER_SECRET) {
    return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } });
  }

  const expected = await hmacToken(email, env.NEWSLETTER_SECRET);
  if (token !== expected) {
    return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } });
  }

  await unsubscribe(env.DB, email, waitUntil, env);

  return new Response(`<!DOCTYPE html>
<html><head><title>Unsubscribed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;color:#333;}
a{color:#725e7e;}</style></head>
<body><h1>You've been unsubscribed</h1>
<p>You won't receive any more emails from RRM Academy.</p>
<p>Changed your mind? <a href="https://rrmacademy.org/">Visit RRM Academy</a> and re-subscribe from the footer.</p>
</body></html>`, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  // RFC 8058 one-click: Gmail/Yahoo POST with form-encoded body
  const url = new URL(request.url);
  const email = url.searchParams.get('e') || '';
  const token = url.searchParams.get('t') || '';

  if (!email || !token || !env.NEWSLETTER_SECRET) {
    return new Response('', { status: 400 });
  }

  const expected = await hmacToken(email, env.NEWSLETTER_SECRET);
  if (token !== expected) {
    return new Response('', { status: 400 });
  }

  await unsubscribe(env.DB, email, waitUntil, env);
  return new Response('', { status: 200 });
}
```

- [ ] **Step 2: Generate NEWSLETTER_SECRET and add to CF Pages**

```bash
# Generate a random 32-byte secret
openssl rand -hex 32
# Add to CF Pages environment variables via dashboard or:
npx wrangler pages secret put NEWSLETTER_SECRET --project-name rrm-academy
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/unsubscribe.js
git commit -m "feat: add newsletter unsubscribe endpoint (RFC 8058 one-click + link)"
```

---

## Chunk 2: Tracking + Email Template

### Task 4: Open Tracking Endpoint

**Files:**
- Create: `functions/api/newsletter/open.js`

Returns a 1x1 transparent GIF. Logs the open event to Analytics Engine and D1.

- [ ] **Step 1: Write open.js**

```js
/**
 * GET /api/newsletter/open?s={sendId}&u={subscriberId}
 * Returns 1x1 transparent GIF, logs open event.
 */
import { log } from '../_log.js';

// 1x1 transparent GIF (43 bytes)
const PIXEL = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,
  0x80,0x00,0x00,0xff,0xff,0xff,0x00,0x00,0x00,0x21,
  0xf9,0x04,0x01,0x00,0x00,0x00,0x00,0x2c,0x00,0x00,
  0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,
  0x01,0x00,0x3b
]);

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const sendId = url.searchParams.get('s');
  const subscriberId = url.searchParams.get('u');

  if (sendId && subscriberId && env.DB) {
    // Fire-and-forget: don't block the pixel response
    const work = (async () => {
      try {
        // Dedupe: only count first open per subscriber per send
        const existing = await env.DB.prepare(
          "SELECT 1 FROM newsletter_event WHERE send_id = ? AND subscriber_id = ? AND event = 'opened' LIMIT 1"
        ).bind(sendId, subscriberId).first();
        if (!existing) {
          await env.DB.prepare(
            "INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'opened')"
          ).bind(sendId, subscriberId).run();
          await env.DB.prepare(
            "UPDATE newsletter_send SET open_count = open_count + 1 WHERE id = ?"
          ).bind(sendId).run();
          await env.DB.prepare(
            "UPDATE newsletter_subscriber SET last_opened_at = datetime('now') WHERE id = ?"
          ).bind(subscriberId).run();
        }
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'open_track_error', 'error', err.message, 0, 0);
      }
    })();
    waitUntil(work);
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Expires': '0',
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/newsletter/open.js
git commit -m "feat: add newsletter open tracking pixel endpoint"
```

---

### Task 5: Click Tracking Endpoint

**Files:**
- Create: `functions/api/newsletter/click.js`

Logs the click, 302 redirects to the destination URL.

- [ ] **Step 1: Write click.js**

```js
/**
 * GET /api/newsletter/click?s={sendId}&u={subscriberId}&r={destinationUrl}
 * Logs click event, 302 redirects to destination.
 */
import { log } from '../_log.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const sendId = url.searchParams.get('s');
  const subscriberId = url.searchParams.get('u');
  const dest = url.searchParams.get('r');

  if (!dest) {
    return new Response('Missing redirect URL', { status: 400 });
  }

  // Validate destination is our own domain (prevent open redirect attacks)
  try {
    const destUrl = new URL(dest);
    if (destUrl.hostname !== 'rrmacademy.org') {
      return new Response('Redirect blocked: external URL', { status: 400 });
    }
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }

  if (sendId && subscriberId && env.DB) {
    const work = (async () => {
      try {
        await env.DB.prepare(
          "INSERT INTO newsletter_event (send_id, subscriber_id, event, detail) VALUES (?, ?, 'clicked', ?)"
        ).bind(sendId, subscriberId, dest).run();
        // Dedupe click count: only increment once per subscriber per send
        const clickCount = await env.DB.prepare(
          "SELECT COUNT(*) as c FROM newsletter_event WHERE send_id = ? AND subscriber_id = ? AND event = 'clicked'"
        ).bind(sendId, subscriberId).first();
        if (clickCount && clickCount.c === 1) {
          await env.DB.prepare(
            "UPDATE newsletter_send SET click_count = click_count + 1 WHERE id = ?"
          ).bind(sendId).run();
        }
        await env.DB.prepare(
          "UPDATE newsletter_subscriber SET last_clicked_at = datetime('now') WHERE id = ?"
        ).bind(subscriberId).run();
      } catch (err) {
        log(env, waitUntil, 'newsletter', 'click_track_error', 'error', err.message, 0, 0);
      }
    })();
    waitUntil(work);
  }

  return Response.redirect(dest, 302);
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/newsletter/click.js
git commit -m "feat: add newsletter click tracking redirect endpoint"
```

---

### Task 6: Email Template + Tracking Helpers

**Files:**
- Create: `functions/api/newsletter/_template.js`
- Create: `functions/api/newsletter/_tracking.js`

- [ ] **Step 1: Write _tracking.js**

Helpers to generate tracking URLs and unsubscribe links.

```js
/**
 * Newsletter tracking URL helpers.
 * Wraps links for click tracking, generates open pixel and unsubscribe URLs.
 */
import { SITE_URL } from '../auth/_shared.js';

export async function hmacToken(email, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

export function trackClick(sendId, subscriberId, url) {
  return `${SITE_URL}/api/newsletter/click?s=${sendId}&u=${subscriberId}&r=${encodeURIComponent(url)}`;
}

export function trackOpen(sendId, subscriberId) {
  return `${SITE_URL}/api/newsletter/open?s=${sendId}&u=${subscriberId}`;
}

export async function unsubscribeUrl(email, secret) {
  const token = await hmacToken(email, secret);
  return `${SITE_URL}/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

export async function unsubscribeHeaders(email, secret) {
  const url = await unsubscribeUrl(email, secret);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
```

- [ ] **Step 2: Write _template.js**

Gmail-plain email renderer. System fonts, no images, no design. Looks like a forwarded email from a colleague.

```js
/**
 * Newsletter email template renderer.
 * Produces Gmail-plain HTML: system fonts, no header/footer graphics.
 */
import { trackClick, trackOpen, unsubscribeUrl } from './_tracking.js';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Wrap all <a href="..."> links in the body for click tracking.
 * Only wraps links pointing to rrmacademy.org (not unsubscribe or external).
 */
export function wrapLinks(html, sendId, subscriberId) {
  return html.replace(
    /href="(https:\/\/rrmacademy\.org\/[^"]+)"/g,
    (match, url) => `href="${trackClick(sendId, subscriberId, url)}"`
  );
}

/**
 * Render a newsletter email.
 * @param {object} opts
 * @param {string} opts.body - HTML body content (the message itself, already escaped if needed)
 * @param {string} opts.sendId
 * @param {string} opts.subscriberId
 * @param {string} opts.email - subscriber email (for unsubscribe token)
 * @param {string} opts.secret - NEWSLETTER_SECRET
 * @returns {Promise<{html: string, text: string}>}
 */
export async function renderEmail({ body, sendId, subscriberId, email, secret }) {
  const unsubLink = await unsubscribeUrl(email, secret);
  const pixel = trackOpen(sendId, subscriberId);
  const wrappedBody = wrapLinks(body, sendId, subscriberId);

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;line-height:1.6;">
${wrappedBody}
<p style="font-size:11px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
RRM Academy | 3401 Hartzdale Dr, Camp Hill PA 17011<br>
<a href="${unsubLink}" style="color:#999;">Unsubscribe</a>
</p>
<img src="${pixel}" width="1" height="1" style="display:none" alt="" />
</div>`;

  // Plain text fallback: use original body (not wrapped) so readers don't see tracking URLs
  const text = body.replace(/<[^>]+>/g, '').trim()
    + `\n\n---\nRRM Academy | 3401 Hartzdale Dr, Camp Hill PA 17011\nUnsubscribe: ${unsubLink}`;

  return { html, text };
}
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/_tracking.js functions/api/newsletter/_template.js
git commit -m "feat: add newsletter email template and tracking URL helpers"
```

---

## Chunk 3: Send Endpoint + SES Headers

### Task 7: Add Raw Email Support to _ses.js

**Files:**
- Modify: `functions/api/_ses.js`

The existing `sendEmail` uses SESv2 `SendEmail` with `Content.Simple` format. This format does **not** support custom headers like `List-Unsubscribe`. Newsletter emails must use `Content.Raw` format (construct full MIME message). We add a new `sendRawEmail` function rather than modifying the existing `sendEmail` (keeps transactional sends simple).

- [ ] **Step 1: Add sendRawEmail to _ses.js**

Append to `_ses.js`:

```js
/**
 * Send a raw MIME email via SESv2. Supports custom headers (List-Unsubscribe, etc.).
 * Used for newsletter sends. Transactional emails should use sendEmail() (Simple format).
 */
export async function sendRawEmail(env, { from, to, subject, html, text, replyTo, headers, configurationSet }) {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS SES credentials not configured');
  }
  const region = env.AWS_SES_REGION || 'us-east-1';
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region,
    service: 'ses',
  });

  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const toAddr = Array.isArray(to) ? to.join(', ') : to;

  const messageId = `<${crypto.randomUUID()}@mail.rrmacademy.org>`;

  let rawHeaders = [
    `From: ${from}`,
    `To: ${toAddr}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Precedence: bulk',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (replyTo) rawHeaders.push(`Reply-To: ${replyTo}`);
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      rawHeaders.push(`${name}: ${value}`);
    }
  }

  let body = rawHeaders.join('\r\n') + '\r\n\r\n';

  if (text) {
    body += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n`;
  }
  if (html) {
    body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n`;
  }
  body += `--${boundary}--\r\n`;

  // Base64 encode for SES Raw format (safe for non-ASCII via TextEncoder)
  const bytes = new TextEncoder().encode(body);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const rawData = btoa(binary);

  const payload = {
    Content: { Raw: { Data: rawData } },
  };
  if (configurationSet) {
    payload.ConfigurationSetName = configurationSet;
  }

  const res = await aws.fetch(
    `https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error('SES raw error:', res.status, errBody);
    throw new Error(`SES raw request failed (${res.status})`);
  }

  return res;
}
```

- [ ] **Step 2: Verify existing callers are unaffected**

The existing `sendEmail` function is untouched. `sendRawEmail` is additive only.

- [ ] **Step 3: Commit**

```bash
git add functions/api/_ses.js
git commit -m "feat: add sendRawEmail to SES helper for custom headers"
```

---

### Task 8: Admin Send Endpoint

**Files:**
- Create: `functions/api/newsletter/send.js`

Admin-authed endpoint that:
1. Creates or uses a `newsletter_send` record
2. Queries active subscribers (optionally filtered by segment)
3. Renders each email with tracking
4. Batches sends through SES with `List-Unsubscribe` headers
5. Updates send status and counts

- [ ] **Step 1: Write send.js**

**Pagination design:** CF Pages Functions have a 100-second execution limit. At ~9 sends/sec, one invocation handles ~80 recipients. For 4,000 subscribers, n8n loops ~50 calls. Each call returns `{ done, sendId, cursor, sent, remaining }`. n8n calls again with `sendId` + `cursor` until `done: true`.

```js
/**
 * POST /api/newsletter/send
 * Admin-only: send a newsletter to subscribers (paginated).
 *
 * Body: { subject, body, segments?, slug?, sendId?, cursor? }
 *   - subject: email subject line
 *   - body: HTML content (the message, Gmail-plain style)
 *   - segments: optional array of segment names to filter (null = all active)
 *   - slug: commentary slug (for RSS-triggered sends, stored for dedup)
 *   - sendId: existing send ID to continue a paginated send
 *   - cursor: subscriber ID to resume from (returned by previous call)
 */
import { log } from '../_log.js';
import { sendRawEmail } from '../_ses.js';
import { renderEmail } from './_template.js';
import { unsubscribeHeaders } from './_tracking.js';

const PAGE_SIZE = 80;           // subscribers per invocation
const BATCH_SIZE = 10;          // concurrent sends per batch
const BATCH_DELAY_MS = 500;     // pause between batches; 10 concurrent + network latency keeps us under SES 14/sec

export async function onRequestPost({ request, env, waitUntil }) {
  // Admin auth
  const auth = request.headers.get('Authorization');
  if (!env.ADMIN_API_SECRET || auth !== `Bearer ${env.ADMIN_API_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!env.NEWSLETTER_SECRET) {
    return Response.json({ ok: false, error: 'NEWSLETTER_SECRET not configured' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { subject, body: htmlBody, segments, slug, sendId: existingSendId, cursor } = body;
  if (!subject || !htmlBody) {
    return Response.json({ ok: false, error: 'subject and body are required' }, { status: 400 });
  }

  const db = env.DB;

  // Create or resume send record
  let sendId = existingSendId;
  if (!sendId) {
    sendId = crypto.randomUUID();

    // Count total recipients upfront (only on first call)
    const countResult = await db.prepare(
      "SELECT COUNT(*) as c FROM newsletter_subscriber WHERE status = 'active'"
    ).first();
    let totalRecipients = countResult.c;
    // Segment filtering adjusts count in JS (segments stored as JSON, not queryable in SQL)
    if (segments && segments.length > 0) {
      const allSubs = (await db.prepare(
        "SELECT segments FROM newsletter_subscriber WHERE status = 'active'"
      ).all()).results;
      totalRecipients = allSubs.filter(sub => {
        const subSegments = JSON.parse(sub.segments || '[]');
        return segments.some(seg => subSegments.includes(seg));
      }).length;
    }

    await db.prepare(
      "INSERT INTO newsletter_send (id, subject, html, segment_filter, status, total_recipients, commentary_slug) VALUES (?, ?, ?, ?, 'sending', ?, ?)"
    ).bind(sendId, subject, htmlBody, segments ? JSON.stringify(segments) : null, totalRecipients, slug || null).run();
  } else {
    await db.prepare("UPDATE newsletter_send SET status = 'sending' WHERE id = ?").bind(sendId).run();
  }

  // Query active subscribers, paginated by ID with LIMIT (parameterized, no string interpolation)
  // Fetch PAGE_SIZE * 2 to allow for segment filtering + already-sent exclusion, then slice
  const fetchLimit = PAGE_SIZE * 2 + 1;
  const params = [];
  let query = "SELECT id, email, name, segments FROM newsletter_subscriber WHERE status = 'active'";
  if (cursor) { query += ' AND id > ?'; params.push(cursor); }
  query += ' ORDER BY id ASC LIMIT ?';
  params.push(fetchLimit);
  const subscribers = (await db.prepare(query).bind(...params).all()).results;

  // Filter by segment if requested
  let recipients = subscribers;
  if (segments && segments.length > 0) {
    recipients = subscribers.filter(sub => {
      const subSegments = JSON.parse(sub.segments || '[]');
      return segments.some(seg => subSegments.includes(seg));
    });
  }

  // Exclude already-sent subscribers (handles resume after crash mid-page)
  // Scope to cursor range to avoid unbounded query
  const sentQuery = cursor
    ? "SELECT subscriber_id FROM newsletter_event WHERE send_id = ? AND event = 'sent' AND subscriber_id > ?"
    : "SELECT subscriber_id FROM newsletter_event WHERE send_id = ? AND event = 'sent'";
  const sentParams = cursor ? [sendId, cursor] : [sendId];
  const alreadySent = (await db.prepare(sentQuery).bind(...sentParams).all()).results.map(r => r.subscriber_id);
  const sentSet = new Set(alreadySent);
  recipients = recipients.filter(r => !sentSet.has(r.id));

  // Take only PAGE_SIZE for this invocation
  const page = recipients.slice(0, PAGE_SIZE);
  // hasMore: true if we fetched a full batch (more rows likely exist) or filtered recipients exceed PAGE_SIZE
  const hasMore = subscribers.length >= fetchLimit || recipients.length > PAGE_SIZE;

  // Send in batches
  let sentCount = 0;
  for (let i = 0; i < page.length; i += BATCH_SIZE) {
    const batch = page.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (sub) => {
        const { html, text } = await renderEmail({
          body: htmlBody,
          sendId,
          subscriberId: sub.id,
          email: sub.email,
          secret: env.NEWSLETTER_SECRET,
        });

        const headers = await unsubscribeHeaders(sub.email, env.NEWSLETTER_SECRET);

        await sendRawEmail(env, {
          from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
          to: sub.email,
          subject,
          html,
          text,
          headers,
          configurationSet: 'rrm-newsletter',
        });

        // Record sent event
        await db.prepare(
          "INSERT INTO newsletter_event (send_id, subscriber_id, event) VALUES (?, ?, 'sent')"
        ).bind(sendId, sub.id).run();

        await db.prepare(
          "UPDATE newsletter_subscriber SET last_sent_at = datetime('now') WHERE id = ?"
        ).bind(sub.id).run();

        return sub.id;
      })
    );

    sentCount += results.filter(r => r.status === 'fulfilled').length;

    // Log failures
    results.filter(r => r.status === 'rejected').forEach(r => {
      log(env, waitUntil, 'newsletter', 'send_error', 'error', r.reason?.message || 'unknown', 0, 0);
    });

    // Rate limit delay between batches
    if (i + BATCH_SIZE < page.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Update running sent_count
  await db.prepare(
    "UPDATE newsletter_send SET sent_count = sent_count + ? WHERE id = ?"
  ).bind(sentCount, sendId).run();

  // If no more recipients, mark as sent
  if (!hasMore) {
    await db.prepare(
      "UPDATE newsletter_send SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    ).bind(sendId).run();
    log(env, waitUntil, 'newsletter', 'send_complete', 'ok', `send ${sendId} complete`, 0, 200);
  }

  const nextCursor = page.length > 0 ? page[page.length - 1].id : null;

  return Response.json({
    ok: true,
    done: !hasMore,
    sendId,
    cursor: hasMore ? nextCursor : null,
    sent: sentCount,
    remaining: hasMore ? recipients.length - PAGE_SIZE : 0,
  });
}
```

- [ ] **Step 2: Verify SES from address is verified**

`newsletter@mail.rrmacademy.org` needs to be a verified sender in SES. Since the whole `mail.rrmacademy.org` domain is verified, any address under it works. Confirm:

```bash
aws ses list-identities --region us-east-1
# Should include mail.rrmacademy.org
```

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/send.js
git commit -m "feat: add admin newsletter send endpoint with batched SES delivery"
```

---

## Chunk 4: Bounce Webhook + RSS Watcher + Cleanup

### Task 9: SNS Bounce/Complaint Webhook

**Files:**
- Create: `functions/api/newsletter/bounce.js`

SES sends bounce/complaint notifications to an SNS topic. SNS calls this endpoint. Must handle:
1. **SNS subscription confirmation** (first call after creating the subscription)
2. **Bounce notifications** -- mark subscriber as bounced
3. **Complaint notifications** -- mark subscriber as complained

- [ ] **Step 1: Write bounce.js**

```js
/**
 * POST /api/newsletter/bounce?secret={NEWSLETTER_BOUNCE_SECRET}
 * SNS webhook for SES bounce and complaint notifications.
 * Gated by query param secret (set when creating the SNS subscription).
 */
import { log } from '../_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  // Auth: shared secret in query param (configured in SNS subscription URL)
  const url = new URL(request.url);
  if (!env.NEWSLETTER_BOUNCE_SECRET || url.searchParams.get('secret') !== env.NEWSLETTER_BOUNCE_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // SNS subscription confirmation
  if (payload.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
    // Validate that SubscribeURL points to AWS (prevent SSRF)
    try {
      const subUrl = new URL(payload.SubscribeURL);
      if (!subUrl.hostname.endsWith('.amazonaws.com')) {
        log(env, waitUntil, 'newsletter', 'sns_confirm_blocked', 'error', subUrl.hostname, 0, 400);
        return new Response('Invalid SubscribeURL', { status: 400 });
      }
    } catch {
      return new Response('Invalid SubscribeURL', { status: 400 });
    }
    await fetch(payload.SubscribeURL);
    log(env, waitUntil, 'newsletter', 'sns_confirmed', 'ok', payload.TopicArn || '', 0, 200);
    return new Response('OK', { status: 200 });
  }

  // SNS notification
  if (payload.Type !== 'Notification') {
    return new Response('OK', { status: 200 });
  }

  let message;
  try {
    message = JSON.parse(payload.Message);
  } catch {
    return new Response('OK', { status: 200 });
  }

  const db = env.DB;
  const notifType = message.notificationType || message.eventType;

  if (notifType === 'Bounce') {
    const bounceType = message.bounce?.bounceType;
    const recipients = message.bounce?.bouncedRecipients || [];
    for (const r of recipients) {
      const email = r.emailAddress?.toLowerCase();
      if (!email) continue;

      if (bounceType === 'Permanent') {
        await db.prepare(
          "UPDATE newsletter_subscriber SET status = 'bounced', bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE"
        ).bind(email).run();
      } else {
        // Soft bounce: increment count, suppress after 3
        await db.prepare(
          "UPDATE newsletter_subscriber SET bounce_count = bounce_count + 1 WHERE email = ? COLLATE NOCASE"
        ).bind(email).run();
        const sub = await db.prepare(
          "SELECT bounce_count FROM newsletter_subscriber WHERE email = ? COLLATE NOCASE"
        ).bind(email).first();
        if (sub && sub.bounce_count >= 3) {
          await db.prepare(
            "UPDATE newsletter_subscriber SET status = 'bounced' WHERE email = ? COLLATE NOCASE"
          ).bind(email).run();
        }
      }
      log(env, waitUntil, 'newsletter', 'bounce', bounceType === 'Permanent' ? 'error' : 'warn', email, 0, 0);
    }
  }

  if (notifType === 'Complaint') {
    const recipients = message.complaint?.complainedRecipients || [];
    for (const r of recipients) {
      const email = r.emailAddress?.toLowerCase();
      if (!email) continue;
      await db.prepare(
        "UPDATE newsletter_subscriber SET status = 'complained' WHERE email = ? COLLATE NOCASE"
      ).bind(email).run();
      log(env, waitUntil, 'newsletter', 'complaint', 'error', email, 0, 0);
    }
  }

  if (notifType === 'Delivery') {
    // Log delivery for deliverability tracking (sent != delivered)
    const recipients = message.delivery?.recipients || [];
    for (const email of recipients) {
      log(env, waitUntil, 'newsletter', 'delivered', 'ok', email.toLowerCase(), 0, 200);
    }
  }

  return new Response('OK', { status: 200 });
}
```

- [ ] **Step 2: Set up AWS SNS topic + subscription**

```bash
# Create SNS topic for SES notifications
aws sns create-topic --name rrm-ses-notifications --region us-east-1

# Subscribe our webhook endpoint
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:690119402957:rrm-ses-notifications \
  --protocol https \
  --notification-endpoint 'https://rrmacademy.org/api/newsletter/bounce?secret={NEWSLETTER_BOUNCE_SECRET}' \
  --region us-east-1

# Configure SES to send bounces + complaints to the topic
# (Done in SES console: Configuration Sets > Event destinations, or via CLI)
aws sesv2 create-configuration-set --configuration-set-name rrm-newsletter --region us-east-1

aws sesv2 create-configuration-set-event-destination \
  --configuration-set-name rrm-newsletter \
  --event-destination-name newsletter-events \
  --event-destination '{
    "SnsDestination": {
      "TopicArn": "arn:aws:sns:us-east-1:690119402957:rrm-ses-notifications"
    },
    "MatchingEventTypes": ["BOUNCE", "COMPLAINT", "DELIVERY"],
    "Enabled": true
  }' \
  --region us-east-1
```

Then update `_ses.js` to include the configuration set name in newsletter sends (add `ConfigurationSetName: 'rrm-newsletter'` to the payload when `headers` are present -- this distinguishes newsletter sends from transactional).

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/bounce.js
git commit -m "feat: add SNS bounce/complaint webhook for newsletter"
```

---

### Task 10: RSS Watcher (Commentary Auto-Send)

**Files:**
- Create: `functions/api/newsletter/rss-check.js` (cron-triggered)

This runs on a schedule (daily or on deploy webhook). It:
1. Fetches `/commentary/rss.xml`
2. Compares against the last sent commentary slug in `newsletter_send`
3. If new posts exist, triggers a send

Since CF Pages Functions don't support cron triggers, this will be called by n8n on a schedule (like the existing Down Detector pattern).

- [ ] **Step 1: Write rss-check.js**

```js
/**
 * POST /api/newsletter/rss-check
 * Called by n8n cron. Checks RSS feed for new commentary posts.
 * If a new post exists that hasn't been sent, triggers a newsletter send.
 */
import { log } from '../_log.js';

export async function onRequestPost({ request, env, waitUntil }) {
  const auth = request.headers.get('Authorization');
  if (!env.ADMIN_API_SECRET || auth !== `Bearer ${env.ADMIN_API_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch RSS feed
  let rssText;
  try {
    const rssResp = await fetch('https://rrmacademy.org/commentary/rss.xml');
    if (!rssResp.ok) throw new Error(`RSS fetch failed: ${rssResp.status}`);
    rssText = await rssResp.text();
  } catch (err) {
    log(env, waitUntil, 'newsletter', 'rss_fetch_error', 'error', err.message, 0, 0);
    return Response.json({ ok: false, error: 'RSS fetch failed' }, { status: 502 });
  }

  // Extract first item (most recent post)
  const titleMatch = rssText.match(/<item>\s*<title><!\[CDATA\[(.*?)\]\]><\/title>/);
  const linkMatch = rssText.match(/<item>\s*<title>.*?<\/title>\s*<link>(.*?)<\/link>/s);
  const descMatch = rssText.match(/<item>.*?<description><!\[CDATA\[(.*?)\]\]><\/description>/s);

  if (!titleMatch || !linkMatch) {
    return Response.json({ ok: true, action: 'no_posts' });
  }

  const postTitle = titleMatch[1];
  const postUrl = linkMatch[1];
  const postExcerpt = descMatch ? descMatch[1] : '';
  const slug = postUrl.replace('https://rrmacademy.org/commentary/', '').replace(/\/$/, '');

  // Check if we already sent this post
  const existing = await env.DB.prepare(
    "SELECT id FROM newsletter_send WHERE commentary_slug = ? LIMIT 1"
  ).bind(slug).first();

  if (existing) {
    return Response.json({ ok: true, action: 'already_sent', slug });
  }

  // Build Gmail-plain email body
  const emailBody = `
<p>We just published something you might find useful:</p>
<p><strong><a href="${postUrl}" style="color:#725e7e;">${postTitle}</a></strong></p>
${postExcerpt ? `<p style="color:#555;">${postExcerpt}</p>` : ''}
<p>- Naomi</p>
`.trim();

  // Return the send payload for n8n to call /api/newsletter/send in a loop
  // (Don't self-fetch: CF Pages Functions share the 100s timeout budget)
  log(env, waitUntil, 'newsletter', 'rss_new_post', 'ok', slug, 0, 200);

  return Response.json({
    ok: true,
    action: 'new_post',
    slug,
    subject: postTitle,
    body: emailBody,
  });
}
```

- [ ] **Step 2: Create n8n workflow**

Create a new n8n workflow "Newsletter RSS Check + Send" that:
- Runs daily at 10 AM ET (14:00 UTC)
- Step 1: `POST /api/newsletter/rss-check` with ADMIN_API_SECRET
- Step 2: If response `action === 'new_post'`, loop `POST /api/newsletter/send` with `{ subject, body, slug, sendId, cursor }` until response `done === true`
- Step 3: Telegram notification on success/failure via @rrm_n8n_notification_bot
- The loop pattern: first call creates the send (no sendId/cursor, includes slug from rss-check response), subsequent calls pass `sendId` + `cursor` from previous response. `slug` is stored in `newsletter_send.commentary_slug` for dedup on next rss-check run

- [ ] **Step 3: Commit**

```bash
git add functions/api/newsletter/rss-check.js
git commit -m "feat: add RSS watcher for auto-sending commentary newsletters"
```

---

### Task 11: Subscriber Import Script

**Files:**
- Create: `scripts/import-newsletter-subscribers.mjs`

One-time script to import existing D1 users into `newsletter_subscriber` table. Maps `user_label` data to segments.

- [ ] **Step 1: Write import script**

```js
#!/usr/bin/env node
/**
 * Import D1 users into newsletter_subscriber table.
 * Segments based on user_label: donor, student, stuc.
 *
 * Usage: npx wrangler d1 execute rrm-auth --remote --command "..."
 *   (or run the SQL directly)
 *
 * This generates SQL to run against production D1.
 */

// Run this SQL against production D1:
const SQL = `
INSERT OR IGNORE INTO newsletter_subscriber (id, email, name, status, segments, source, user_id)
SELECT
  u.id,
  u.email,
  COALESCE(u.name, u.first_name || ' ' || u.last_name),
  'active',
  (
    SELECT json_group_array(
      CASE
        WHEN ul.label LIKE '%donor%' THEN 'donor'
        WHEN ul.label LIKE '%student%' THEN 'student'
        WHEN ul.label LIKE '%Save the Uterus%' THEN 'stuc'
        ELSE NULL
      END
    )
    FROM user_label ul
    WHERE ul.user_id = u.id
    AND (ul.label LIKE '%donor%' OR ul.label LIKE '%student%' OR ul.label LIKE '%Save the Uterus%')
  ),
  'import',
  u.id
FROM user u
WHERE u.blocked = 0
  AND u.email NOT LIKE '%test%'
  AND u.email NOT LIKE '%example%'
  AND u.email_verified = 1;
`;

console.log('Run this SQL against production D1:');
console.log('npx wrangler d1 execute rrm-auth --remote --command "' + SQL.replace(/\n/g, ' ').replace(/"/g, '\\"') + '"');
console.log('\nOr save to a file and run:');
console.log('npx wrangler d1 execute rrm-auth --remote --file=scripts/import-newsletter-subscribers.sql');
```

- [ ] **Step 2: Also save as .sql for direct execution**

Save the SQL as `scripts/import-newsletter-subscribers.sql` for easier execution.

- [ ] **Step 3: Run the import**

```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/import-newsletter-subscribers.sql
```

- [ ] **Step 4: Verify import count**

```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT status, COUNT(*) FROM newsletter_subscriber GROUP BY status"
```

Expected: ~3,900+ active subscribers.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-newsletter-subscribers.mjs scripts/import-newsletter-subscribers.sql
git commit -m "feat: add newsletter subscriber import from D1 users"
```

---

### Task 12: Cleanup + Backlog Update

- [ ] **Step 1: Remove BUTTONDOWN_API_KEY from CF Pages env vars**

Via dashboard or:
```bash
npx wrangler pages secret delete BUTTONDOWN_API_KEY --project-name rrm-academy
```

- [ ] **Step 2: Update NewsletterSignup.astro JSDoc comment**

Change line 3 from "submits to Buttondown via API" to "submits to D1 newsletter subscriber list".

- [ ] **Step 3: Add newsletter cleanup to admin/cleanup.js**

Add to the existing cleanup endpoint:

```js
// Prune newsletter events older than 90 days
const ninetyDaysAgo = now - 90 * 86400;
const nlEvents = await db.prepare(
  "DELETE FROM newsletter_event WHERE created_at < datetime(?, 'unixepoch')"
).bind(ninetyDaysAgo).run();
```

Add `newsletter_events: nlEvents.meta.changes` to the result object.

- [ ] **Step 4: Update privacy policy**

In `src/pages/privacy-policy.astro`, section 4.2: replace "email marketing (Buttondown)" with "email delivery (Amazon SES)". SES now handles both transactional and marketing email. Remove Buttondown as a named processor.

- [ ] **Step 5: Update backlog**

In `docs/plans/backlog.md`, update the Email Marketing (Phase 4) section:
- Mark subscriber import as DONE
- Mark RSS-to-email as DONE
- Remove Buttondown references
- Note that domain warmup, DMARC tightening, and CAN-SPAM address are still needed

- [ ] **Step 6: Run security guard update (subscribe.js is likely guarded)**

```bash
npm run guard:update
```

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete SES newsletter system, retire Buttondown"
```

---

## Environment Variables Summary

| Variable | Where | Value |
|----------|-------|-------|
| `NEWSLETTER_SECRET` | CF Pages secret | `openssl rand -hex 32` (HMAC for unsubscribe tokens) |
| `NEWSLETTER_BOUNCE_SECRET` | CF Pages secret | `openssl rand -hex 32` (query param for SNS webhook auth) |
| `ADMIN_API_SECRET` | CF Pages secret | Already exists |
| `AWS_ACCESS_KEY_ID` | CF Pages secret | Already exists |
| `AWS_SECRET_ACCESS_KEY` | CF Pages secret | Already exists |
| `BUTTONDOWN_API_KEY` | CF Pages secret | **DELETE after migration** |

## AWS Resources to Create

| Resource | Purpose |
|----------|---------|
| SNS Topic `rrm-ses-notifications` | Receives SES bounce/complaint events |
| SNS Subscription (HTTPS) | Forwards to `/api/newsletter/bounce` |
| SES Configuration Set `rrm-newsletter` | Routes newsletter events to SNS |

## n8n Workflow to Create

| Workflow | Schedule | What |
|----------|----------|------|
| Newsletter RSS Check + Send | Daily 10 AM ET | RSS check -> paginated send loop -> Telegram notification |
