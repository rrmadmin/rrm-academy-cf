# Guide PDF Download — Design Spec

**Date:** 2026-03-14
**Status:** Approved

## Overview

Email-gated PDF downloads for pillar guide pages. User enters email, receives a 24-hour single-use magic link via SES, clicks to download. Email is simultaneously opted into the newsletter. System is fully built but off by default — each guide is enabled independently via a config file when its PDF is ready.

---

## Data Layer

### Config file: `functions/api/_guide-pdfs.js`

Lives in `functions/` so it is available at runtime in CF Pages Functions. Astro guide pages import the same file at build time via a relative path (`../../functions/api/_guide-pdfs.js` from `src/components/`). **Note:** this import is depth-sensitive — if `PdfDownload.astro` is ever moved, the path must be updated. Check `tsconfig.json` for a project-root alias before implementing; use one if available.

```js
export const GUIDE_PDFS = {
  'naprotechnology': {
    enabled: false,
    r2Key: 'guide-pdfs/naprotechnology.pdf',
    title: 'The Complete NaProTechnology Guide',
    pagePath: '/naprotechnology/',
  },
  'what-is-rrm': {
    enabled: false,
    r2Key: 'guide-pdfs/what-is-rrm.pdf',
    title: 'What Is Restorative Reproductive Medicine?',
    pagePath: '/what-is-rrm/',
  },
};
```

`pagePath` is used by the redeem endpoint to redirect errors to the correct guide page.

Flipping `enabled: true` and redeploying is the only action needed to activate a guide's PDF download.

### D1 migration: `migrations/008-pdf-tokens.sql`

> **Note:** Verify the next available migration number before creating this file. As of spec date, `007-survey-token-claims.sql` is the latest — so `008` is correct. Increment if another migration was added since.

```sql
CREATE TABLE pdf_token (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL,
  guide_slug TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,   -- unix timestamp (created_at + 86400)
  used_at    INTEGER,            -- set on first redemption
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_pdf_token_token ON pdf_token(token);
CREATE INDEX idx_pdf_token_email_slug ON pdf_token(email, guide_slug);
```

**One-time setup:** Run before first deploy: `npx wrangler d1 execute rrm-auth --remote --file=migrations/008-pdf-tokens.sql`

### Expired token cleanup

Add expired token pruning to the existing `functions/api/admin/cleanup.js` endpoint:

```js
await env.DB.prepare(
  `DELETE FROM pdf_token WHERE expires_at < unixepoch() - 86400`
).run();
```

Deletes tokens more than 2 days old (expired + one day grace).

### R2 storage

PDFs stored in the existing `rrm-assets` R2 bucket (binding: `env.R2_ASSETS`, confirmed in `wrangler.toml`) under `guide-pdfs/<slug>.pdf`. Bucket remains private.

**Delivery:** The redeem endpoint streams the PDF directly through the CF Pages Function using `env.R2_ASSETS.get(r2Key)`. No presigned URLs — CF R2 Worker bindings do not expose a presigned URL primitive; streaming is the correct pattern.

---

## API Endpoints

### `POST /api/pdf/request`

**Location:** `functions/api/pdf/request.js`

**Request body:** `{ guide_slug, turnstileToken, email? }` — `email` is omitted when the user is logged in (resolved from session server-side).

**Steps:**
1. Validate `guide_slug` against `GUIDE_PDFS` — return `404` if not found or `enabled: false`
2. Rate limit: 3 requests per IP per hour, global across all guides (KV key: `pdf:ratelimit:${ip}`). Applies to both logged-in and logged-out paths.
3. **Resolve email:**
   - If `request.data.user` is set (session injected by middleware): use `request.data.user.email`. Skip ELV (already validated at signup). Skip Turnstile verification.
   - Otherwise: require `email` and `turnstileToken` in body. Verify Turnstile via `verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip)`. Run ELV validation via `_elv.js`.
4. Return `400` if neither session nor email is present.
5. Check for existing valid token: `SELECT token FROM pdf_token WHERE email = ? AND guide_slug = ? AND expires_at > unixepoch() AND used_at IS NULL LIMIT 1`. If found, reuse it and skip the insert.
6. If no valid token: insert new token (32-byte `crypto.getRandomValues` hex, `expires_at = unixepoch() + 86400`)
7. Upsert `newsletter_subscriber` — handle segment merge in JS to avoid SQLite JSON function complexity:
   ```js
   const existing = await env.DB.prepare(
     `SELECT id, status, segments FROM newsletter_subscriber WHERE email = ?`
   ).bind(email).first();

   if (existing) {
     // segments may be NULL in DB; '[]' fallback handles null/empty string but NOT
     // the string literal 'null' — verify subscribe.js stores '[]' or NULL, never 'null'
     const segs = JSON.parse(existing.segments || '[]') || [];
     const newSeg = `pdf-${guide_slug}`;
     if (!segs.includes(newSeg)) segs.push(newSeg);

     // Do NOT re-subscribe someone who explicitly unsubscribed (CAN-SPAM).
     // They receive the PDF email (transactional) but their newsletter status stays unchanged.
     await env.DB.prepare(
       `UPDATE newsletter_subscriber SET segments = ? WHERE id = ?`
     ).bind(JSON.stringify(segs), existing.id).run();
   } else {
     await env.DB.prepare(
       `INSERT INTO newsletter_subscriber (email, status, source, subscribed_at, segments)
        VALUES (?, 'active', 'pdf-download', unixepoch(), ?)`
     ).bind(email, JSON.stringify([`pdf-${guide_slug}`])).run();
   }
   ```
   **Re-subscribe decision:** If `existing.status === 'unsubscribed'`, the token is still issued and the magic-link email is still sent (it's a transactional email, not marketing). The `newsletter_subscriber` status is intentionally left unchanged. Do not flip `unsubscribed` → `active` on a PDF download.
8. Upsert `contact` CRM record:
   ```sql
   INSERT INTO contact (email, source, created_at, updated_at)
   VALUES (?, 'pdf-download', unixepoch(), unixepoch())
   ON CONFLICT(email) DO UPDATE SET updated_at = unixepoch()
   ```
   (schema: `migrations/006-contact-crm.sql`)
9. Send SES email with token (see Email Template below)
10. Return `{ ok: true }` — always (never reveal whether email or token already existed)

**Error responses:**
- `400` — missing fields
- `422` — ELV hard bounce
- `429` — rate limited
- `404` — guide slug not found or PDF not enabled

### `GET /api/pdf/redeem`

**Location:** `functions/api/pdf/redeem.js`

**Query params:** `?token=<hex>`

**Steps:**
1. Look up token: `SELECT * FROM pdf_token WHERE token = ?`
2. If not found → redirect to `/guides/?pdf_error=notfound` (see note in `/guides/` section below)
3. If `expires_at < unixepoch()` → redirect to `GUIDE_PDFS[guide_slug].pagePath + '?pdf_error=expired'`
4. If `used_at IS NOT NULL` → redirect to `GUIDE_PDFS[guide_slug].pagePath + '?pdf_error=used'`
5. Mark used via conditional UPDATE (handles race):
   ```sql
   UPDATE pdf_token SET used_at = unixepoch() WHERE token = ? AND used_at IS NULL
   ```
   Check `meta.changes === 1`. If `0`, another request won the race → redirect to `<pagePath>?pdf_error=used`
6. Look up `r2Key` from `GUIDE_PDFS[guide_slug].r2Key`. **Known behavior:** the `enabled` flag is not re-checked at redemption time. A token issued while `enabled: true` remains redeemable even if `enabled` is later set to `false`. Disabling a guide after tokens are in-flight will not revoke outstanding links. This is acceptable — the 24-hour TTL bounds the window.
7. Fetch PDF from R2: `const obj = await env.R2_ASSETS.get(r2Key)`
8. If `obj` is null (file not yet uploaded):
   - Restore token: `UPDATE pdf_token SET used_at = NULL WHERE token = ?`
   - Redirect to `<pagePath>?pdf_error=unavailable`
   - **Note:** Narrow race window between step 5 and restoration. Acceptable — PDF-not-uploaded is operator error; user can re-request.
9. Stream response:
   ```js
   return new Response(obj.body, {
     headers: {
       'Content-Type': 'application/pdf',
       'Content-Disposition': `attachment; filename="${guide_slug}.pdf"`,
       'Content-Length': String(obj.size),
       'Cache-Control': 'private, no-store',
     }
   });
   ```
   `Cache-Control: private, no-store` prevents CF edge caching of token-gated content. `Content-Length` from `obj.size` enables browser download progress indicator.

---

## Frontend Component

### `src/components/PdfDownload.astro`

**Props:** `{ slug: string }`

Imports `GUIDE_PDFS` from `../../functions/api/_guide-pdfs.js`. Checks `GUIDE_PDFS[slug]?.enabled` at build time. If `false` or not found, renders nothing.

If `enabled: true`, renders an email capture card using existing design tokens (`.form-input`, `.btn--primary`, `.form-group`, `.card`).

The component checks `/api/auth/session` on load (client-side JS). It renders in one of two modes:

**Logged-in mode** (session found):
```
┌─────────────────────────────────────────────┐
│  Download this guide as a PDF               │
│                                             │
│  [?pdf_error message here if present]       │
│                                             │
│  [Send PDF to my email     ]                │
│   (sends to account email, no input shown)  │
│                                             │
│  Success: "Check your inbox. The link       │
│  expires in 24 hours."                      │
└─────────────────────────────────────────────┘
```

**Logged-out mode** (no session):
```
┌─────────────────────────────────────────────┐
│  Download this guide as a PDF               │
│  Enter your email and we'll send you a      │
│  download link — valid for 24 hours.        │
│                                             │
│  [?pdf_error message here if present]       │
│                                             │
│  [email input field          ] [Download]   │
│  [Turnstile widget — hidden]                │
│                                             │
│  Success: "Check your inbox. The link       │
│  expires in 24 hours."                      │
└─────────────────────────────────────────────┘
```

**Initial render:** Component renders in logged-out mode by default (static). On load, JS checks session and upgrades to logged-in mode if applicable. This avoids layout shift issues — the logged-in mode is simpler (no input field), so the card shrinks rather than grows.

Component reads `?pdf_error` from its own page URL on load:

| `pdf_error` value | Message |
|---|---|
| `expired` | "That download link has expired. Enter your email to get a new one." |
| `used` | "That link has already been used. Enter your email to get a new one." |
| `notfound` | "That link is invalid. Enter your email to get a new one." |
| `unavailable` | "The PDF isn't available yet. Try again soon." |

### `/guides/index.astro` — `notfound` error handling

When the redeem endpoint cannot find a token, it does not know which guide the link was for, so it redirects to `/guides/?pdf_error=notfound`. The `/guides/` index page should check for this param and render a brief inline notice:

> "That download link is invalid or has expired. Find your guide below and request a new link."

This prevents the error from silently disappearing.

### Integration into guide pages

Add `<PdfDownload slug="naprotechnology" />` near the bottom of each guide page's content, above any footer CTA section.

---

## Email Template

**Subject:** Your [Guide Title] — Download Link Inside

**Body:**
- "Here's your link to download [Guide Title]."
- CTA button: "Download PDF" → `https://rrmacademy.org/api/pdf/redeem?token=xxx`
- "This link expires in 24 hours and can only be used once."
- Footer: "You're receiving this because you subscribed to RRM Academy updates."

Sent via existing `sendEmail()` in `_ses.js`.

---

## Security

| Concern | Mitigation |
|---|---|
| Token brute-force | 32-byte random hex (2^256 space); index-only lookup |
| PDF direct access | R2 bucket private; streamed through Function only |
| Token replay | Conditional `UPDATE ... WHERE used_at IS NULL`; `meta.changes` check |
| CDN/edge caching of gated content | `Cache-Control: private, no-store` on stream response |
| Email spam/abuse | ELV + Turnstile (`env.CF_TURNSTILE_SECRET`) + 3/hr IP rate limit |
| PDF not yet uploaded | R2 null → token restored, user gets `unavailable` message |

---

## Infrastructure Requirements

**Existing — no changes needed:**
- `env.CF_TURNSTILE_SECRET` — already in wrangler secrets
- `env.R2_ASSETS` / `rrm-assets` — confirmed binding in wrangler.toml
- SES env vars — already configured
- KV rate limiting — already configured

**New:**
- `migrations/008-pdf-tokens.sql` — run once before first deploy
- `functions/api/_guide-pdfs.js` — new config file; not a candidate for guard manifest (no auth/billing logic)
- `functions/api/pdf/request.js` + `functions/api/pdf/redeem.js` — new endpoints; no guard changes needed (these are not auth/billing files — `guard:update` re-hashes existing manifest entries, it does not auto-add new files)

**Implementation rule:** All `functions/api/` code must be written via the `coder` subagent (`subagent_type: "coder"`). Do not write endpoint code directly.

---

## Activation Checklist

**One-time (first deployment):**
1. Verify next available migration number (currently `008`)
2. Run `npx wrangler d1 execute rrm-auth --remote --file=migrations/008-pdf-tokens.sql`
3. Commit and deploy (all guides have `enabled: false` — endpoints are live but dormant)

**Per-guide (when PDF is ready):**
1. Upload PDF to R2 bucket `rrm-assets`: key = `guide-pdfs/<slug>.pdf`
2. Set `enabled: true` for that slug in `functions/api/_guide-pdfs.js`
3. Update `title` if needed
4. Deploy

---

## Out of Scope

- Re-download without re-entering email (no account required)
- PDF versioning / invalidating existing tokens on PDF update
- Download conversion rate analytics (can add later via AE)
- Admin UI for token management
