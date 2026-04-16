# Guide PDF Download Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build email-gated PDF downloads for pillar guide pages, fully dormant until a per-guide `enabled` flag is flipped.

**Architecture:** D1 `pdf_token` table stores single-use 24hr tokens; `POST /api/pdf/request` mints and emails them; `GET /api/pdf/redeem` validates and streams the PDF from private R2. A static Astro component renders the capture form (or a one-click button for logged-in users) only when enabled.

**Tech Stack:** CF Pages Functions, D1 (SQLite), R2, AWS SES, Astro 5, Cloudflare Turnstile

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `migrations/008-pdf-tokens.sql` | Create | D1 table + indexes |
| `functions/api/_guide-pdfs.js` | Create | Per-guide config (enabled flag, r2Key, title, pagePath) |
| `functions/api/pdf/request.js` | Create | Token mint + email send |
| `functions/api/pdf/redeem.js` | Create | Token validate + R2 stream |
| `functions/api/admin/cleanup.js` | Modify | Add pdf_token pruning |
| `src/components/PdfDownload.astro` | Create | Email capture / one-click UI |
| `src/pages/naprotechnology/index.astro` | Modify | Add `<PdfDownload slug="naprotechnology" />` |
| `src/pages/what-is-rrm/index.astro` | Modify | Add `<PdfDownload slug="what-is-rrm" />` |
| `src/pages/guides/index.astro` | Modify | Show `notfound` error notice |

---

## Chunk 1: Foundation

### Task 1: D1 Migration

**Files:**
- Create: `migrations/008-pdf-tokens.sql`

- [ ] **Step 1: Verify migration number**

```bash
ls projects/rrm-academy-cf/migrations/
```
Expected: `007-survey-token-claims.sql` is the latest. If a `008-*.sql` exists, increment to `009`.

- [ ] **Step 2: Create migration file**

`migrations/008-pdf-tokens.sql`:
```sql
CREATE TABLE pdf_token (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL,
  guide_slug TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_pdf_token_token ON pdf_token(token);
CREATE INDEX idx_pdf_token_email_slug ON pdf_token(email, guide_slug);
```

- [ ] **Step 3: Run migration against remote D1**

```bash
cd projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --file=migrations/008-pdf-tokens.sql
```
Expected output: `Executed 3 commands` (CREATE TABLE + 2 CREATE INDEX). If you see `table already exists`, stop and investigate before proceeding.

- [ ] **Step 4: Verify table exists**

```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name='pdf_token';"
```
Expected: one row with `name = pdf_token`.

- [ ] **Step 5: Commit**

```bash
git add migrations/008-pdf-tokens.sql
git commit -m "feat: add pdf_token D1 migration"
```

---

### Task 2: Guide PDF Config

**Files:**
- Create: `functions/api/_guide-pdfs.js`

- [ ] **Step 1: Create config file**

`functions/api/_guide-pdfs.js`:
```js
// Per-guide PDF configuration.
// To activate a guide: set enabled: true, upload the PDF to R2, deploy.
// r2Key: path within the rrm-assets R2 bucket.
// pagePath: used by /api/pdf/redeem to redirect errors back to the guide page.
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

- [ ] **Step 2: Commit**

```bash
git add functions/api/_guide-pdfs.js
git commit -m "feat: add guide PDF config"
```

---

### Task 3: Add PDF Token Cleanup to Admin Endpoint

**Files:**
- Modify: `functions/api/admin/cleanup.js`

- [ ] **Step 1: Read the current file**

Read `functions/api/admin/cleanup.js` in full to understand the existing structure before modifying.

- [ ] **Step 2: Add pdf_token pruning**

After the existing DELETE statements (sessions, resets, verifications, webhook events), add:

```js
// Delete pdf_tokens more than 2 days past expiry (expired + 1-day grace)
const pdfTokens = await db.prepare(
  'DELETE FROM pdf_token WHERE expires_at < ?'
).bind(now - 86400).run();
```

Add `pdf_tokens: pdfTokens.meta.changes` to the `pruned` object in the response.

Also update the `total` calculation on line 39 (currently sums 5 fields):
```js
// Before:
const total = result.pruned.sessions + result.pruned.password_resets + result.pruned.email_verifications + result.pruned.webhook_events + result.pruned.newsletter_events;
// After:
const total = result.pruned.sessions + result.pruned.password_resets + result.pruned.email_verifications + result.pruned.webhook_events + result.pruned.newsletter_events + result.pruned.pdf_tokens;
```

- [ ] **Step 3: Verify the response shape still matches existing shape**

The `pruned` object should now include all existing keys plus `pdf_tokens`. The `ok: true` wrapper and the `total` log line must be preserved.

- [ ] **Step 4: Commit**

```bash
git add functions/api/admin/cleanup.js
git commit -m "feat: prune expired pdf_tokens in cleanup endpoint"
```

---

## Chunk 2: API Endpoints

> **MANDATORY:** All steps in this chunk must be executed via the `coder` subagent (`subagent_type: "coder"`). Do not write endpoint code directly. Dispatch coder with the full task description below.

### Task 4: Request Endpoint

**Files:**
- Create: `functions/api/pdf/request.js`

- [ ] **Step 1: Dispatch coder agent**

Dispatch `coder` subagent with this exact task:

---
**Coder task:**

Create `functions/api/pdf/request.js` in the rrm-academy-cf project.

Read these siblings first (they define the patterns you must match):
- `functions/api/survey/request.js`
- `functions/api/contact/submit.js`
- `functions/api/newsletter/subscribe.js`
- `functions/api/auth/_shared.js` (for: `json`, `optionsResponse`, `checkRateLimit`, `verifyTurnstile`, `isValidEmail`, `SITE_URL`)
- `functions/api/_elv.js`
- `functions/api/_ses.js`
- `functions/api/auth/_email-validate.js`
- `functions/api/_guide-pdfs.js` (the config file just created)

The endpoint handles `POST /api/pdf/request`. Here is the full logic:

```
OPTIONS → return optionsResponse()

Parse body: { guide_slug, turnstileToken?, email? }

1. Validate guide_slug:
   - Import GUIDE_PDFS from './_guide-pdfs.js'
   - If !GUIDE_PDFS[guide_slug] or !GUIDE_PDFS[guide_slug].enabled:
     return json({ ok: false, error: 'Not found.' }, 404)

2. Rate limit (in-memory, per-isolate):
   - ip = request.headers.get('cf-connecting-ip') || 'unknown'
   - if (!checkRateLimit(`pdf:${ip}`)):
     return json({ ok: false, error: 'Too many requests. Please try again later.' }, 429)

3. Resolve email:
   - loggedIn = !!(request.data?.user?.email)
   - if (loggedIn): email = request.data.user.email (already validated at signup, skip Turnstile + ELV)
   - else:
     - email = (body.email || '').trim().toLowerCase()
     - if (!isValidEmail(email)): return json({ ok: false, error: 'Valid email is required.' }, 400)
     - const emailCheck = await validateEmail(email)
       if (!emailCheck.valid): return json({ ok: false, error: emailCheck.error }, 400)
     - Verify Turnstile: const ok = await verifyTurnstile(env.CF_TURNSTILE_SECRET, body.turnstileToken, ip)
       if (!ok): return json({ ok: false, error: 'Spam check failed. Please try again.' }, 403)
     - ELV: const elv = await verifyAndTagEmail(email, env, { source: 'pdf-download' })
       if (elv.blocked): return json({ ok: false, error: elv.reason }, 422)

4. Check for existing valid token (reuse to avoid duplicates):
   const existing = await env.DB.prepare(
     'SELECT token FROM pdf_token WHERE email = ? AND guide_slug = ? AND expires_at > unixepoch() AND used_at IS NULL LIMIT 1'
   ).bind(email, guide_slug).first()
   let token = existing?.token

5. If no existing token, mint new one:
   if (!token) {
     token = crypto.randomUUID()
     await env.DB.prepare(
       'INSERT INTO pdf_token (token, email, guide_slug, expires_at) VALUES (?, ?, ?, unixepoch() + 86400)'
     ).bind(token, email, guide_slug).run()
   }

6. Upsert newsletter_subscriber (segment merge in JS, CAN-SPAM safe):
   const sub = await env.DB.prepare(
     'SELECT id, status, segments FROM newsletter_subscriber WHERE email = ?'
   ).bind(email).first()
   const newSeg = `pdf-${guide_slug}`
   if (sub) {
     // Do NOT flip unsubscribed → active (CAN-SPAM). Only update segments.
     const segs = JSON.parse(sub.segments || '[]') || []
     if (!segs.includes(newSeg)) segs.push(newSeg)
     await env.DB.prepare(
       'UPDATE newsletter_subscriber SET segments = ? WHERE id = ?'
     ).bind(JSON.stringify(segs), sub.id).run()
   } else {
     const subId = crypto.randomUUID()
     await env.DB.prepare(
       "INSERT INTO newsletter_subscriber (id, email, status, source, subscribed_at, segments) VALUES (?, ?, 'active', 'pdf-download', unixepoch(), ?)"
     ).bind(subId, email, JSON.stringify([newSeg])).run()
   }

7. Upsert contact CRM:
   await env.DB.prepare(
     'INSERT INTO contact (email, source, created_at, updated_at) VALUES (?, \'pdf-download\', unixepoch(), unixepoch()) ON CONFLICT(email) DO UPDATE SET updated_at = unixepoch()'
   ).bind(email).run()

8. Send email via sendEmail():
   const guideTitle = GUIDE_PDFS[guide_slug].title
   const redeemUrl = `${SITE_URL}/api/pdf/redeem?token=${token}`
   await sendEmail(env, {
     to: email,
     subject: `Your ${guideTitle} — Download Link Inside`,
     html: `
       <p>Here's your link to download <strong>${guideTitle}</strong>.</p>
       <p><a href="${redeemUrl}" style="...">Download PDF</a></p>
       <p>This link expires in 24 hours and can only be used once.</p>
       <p style="color:#888;font-size:12px;">You're receiving this because you subscribed to RRM Academy updates.</p>
     `,
     text: `Download ${guideTitle}: ${redeemUrl}\n\nThis link expires in 24 hours and can only be used once.`,
   })

9. Return json({ ok: true })
```

Wrap steps 4–9 in a try/catch. On catch: log the error and return `json({ ok: false, error: 'service_unavailable' }, 503)`.

**Response shape:** Use `{ ok: true }` on success and `{ ok: false, error: '...' }` on error — matching the actual codebase pattern (`contact/submit.js`, `survey/request.js`, `newsletter/subscribe.js`). The spec incorrectly says `{ success: true }`; ignore that and use `{ ok: true }` to be consistent with all existing endpoints.

CORS: all responses use the `json()` helper from `_shared.js` which includes CORS headers automatically.

---

- [ ] **Step 2: Verify the created file follows all 5 coding standards**

The coder agent will self-validate. After it returns, confirm:
1. Every external call (D1, SES, ELV) is wrapped in try/catch
2. No naked 200s on failure
3. All inputs validated (guide_slug, email)
4. Response shape is `{ ok: true/false }` consistently
5. No hardcoded secrets

- [ ] **Step 3: Commit**

```bash
git add functions/api/pdf/request.js
git commit -m "feat: add /api/pdf/request endpoint"
```

---

### Task 5: Redeem Endpoint

**Files:**
- Create: `functions/api/pdf/redeem.js`

- [ ] **Step 1: Dispatch coder agent**

Dispatch `coder` subagent with this exact task:

---
**Coder task:**

Create `functions/api/pdf/redeem.js` in the rrm-academy-cf project.

Read these siblings first:
- `functions/api/pdf/request.js` (just created — must match its patterns)
- `functions/api/survey/validate.js` (token validation pattern)
- `functions/api/auth/_shared.js`
- `functions/api/_guide-pdfs.js`

The endpoint handles `GET /api/pdf/redeem?token=<uuid>`.

This endpoint does NOT return JSON — it either redirects or streams a binary response. Do not use `json()` for the success path.

Full logic:

```
1. token = new URL(request.url).searchParams.get('token')
   if (!token): return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302)

2. Look up token in D1:
   const row = await env.DB.prepare(
     'SELECT * FROM pdf_token WHERE token = ?'
   ).bind(token).first()

3. if (!row): return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302)

4. const guideConfig = GUIDE_PDFS[row.guide_slug]
   const pagePath = guideConfig?.pagePath || '/guides/'

5. if (row.expires_at < Math.floor(Date.now() / 1000)):
     return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=expired`, 302)

6. if (row.used_at):
     return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=used`, 302)

7. Mark used (conditional UPDATE to handle race):
   const result = await env.DB.prepare(
     'UPDATE pdf_token SET used_at = unixepoch() WHERE token = ? AND used_at IS NULL'
   ).bind(token).run()
   if (result.meta.changes === 0):
     return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=used`, 302)

8. Known behavior: enabled flag is NOT re-checked here. Token issued while enabled=true
   remains redeemable even if the guide is later disabled. 24hr TTL bounds the window.

9. Fetch from R2:
   const obj = await env.R2_ASSETS.get(guideConfig.r2Key)

10. if (!obj):
    // Restore token so user can retry
    await env.DB.prepare(
      'UPDATE pdf_token SET used_at = NULL WHERE token = ?'
    ).bind(token).run()
    return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=unavailable`, 302)

11. Stream PDF:
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${row.guide_slug}.pdf"`,
        'Content-Length': String(obj.size),
        'Cache-Control': 'private, no-store',
      },
    })
```

Wrap steps 2–11 in try/catch. On catch: `return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302)`.

This endpoint only handles GET. No OPTIONS needed (no CORS — it's a same-origin redirect from email).

---

- [ ] **Step 2: Verify the created file**

Confirm:
1. All D1 and R2 calls wrapped in try/catch
2. No JSON response on success path — only redirect or binary stream
3. `Cache-Control: private, no-store` present on stream response
4. `meta.changes === 0` race condition handled

- [ ] **Step 3: Commit**

```bash
git add functions/api/pdf/redeem.js
git commit -m "feat: add /api/pdf/redeem endpoint"
```

---

### Task 6: Smoke Test Both Endpoints (pre-frontend)

Manual tests against the deployed site. Deploy first if needed (`git push origin main`).

- [ ] **Step 1: Test 404 on disabled guide**

```bash
curl -s -X POST https://rrmacademy.org/api/pdf/request \
  -H "Content-Type: application/json" \
  -d '{"guide_slug":"naprotechnology","email":"test@example.com","turnstileToken":"x"}' \
  | jq .
```
Expected: `{"ok":false,"error":"Not found."}` with status 404.

- [ ] **Step 2: Test 404 on unknown slug**

```bash
curl -s -X POST https://rrmacademy.org/api/pdf/request \
  -H "Content-Type: application/json" \
  -d '{"guide_slug":"fake-guide","email":"test@example.com","turnstileToken":"x"}' \
  | jq .
```
Expected: `{"ok":false,"error":"Not found."}` status 404.

- [ ] **Step 3: Test redeem with invalid token**

```bash
curl -v "https://rrmacademy.org/api/pdf/redeem?token=notreal" 2>&1 | grep "< location"
```
Expected: `location: https://rrmacademy.org/guides/?pdf_error=notfound`

- [ ] **Step 4: Test redeem with no token**

```bash
curl -v "https://rrmacademy.org/api/pdf/redeem" 2>&1 | grep "< location"
```
Expected: redirect to `/guides/?pdf_error=notfound`

---

## Chunk 3: Frontend

### Task 7: PdfDownload Astro Component

**Files:**
- Create: `src/components/PdfDownload.astro`

Before implementing, read these files to understand the existing patterns:
- `src/pages/contact.astro` — full Turnstile + form pattern
- `STYLE-GUIDE.md` sections 9 (Cards) and 10 (Forms)
- `src/pages/save-the-uterus-club/index.astro` — client-side session check pattern

- [ ] **Step 1: Read contact.astro for the exact Turnstile pattern before writing**

Read `src/pages/contact.astro` in full. The Turnstile implementation must match it exactly:
- Script tag: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer is:inline></script>`
- Widget ID stored in a var, initialized via `turnstile.render()` with a poll loop until the API is ready
- `turnstile.reset(widgetId)` then `turnstile.execute(widgetId)` on submit
- Token delivered via callback, not via a Promise wrapping execute

Also read `src/lib/turnstile.js` or `src/lib/turnstile.ts` to get the correct `TURNSTILE_SITE_KEY` import.

- [ ] **Step 2: Verify import path resolves**

From `src/components/`, the path `../../functions/api/_guide-pdfs.js` resolves to the project root `functions/api/_guide-pdfs.js`. Verify this is correct:

```bash
ls projects/rrm-academy-cf/functions/api/_guide-pdfs.js
```
Expected: file exists. If not, check the path.

No `tsconfig.json` path aliases exist — the relative path is the only option.

- [ ] **Step 3: Create the component**

`src/components/PdfDownload.astro`:

```astro
---
import { GUIDE_PDFS } from '../../functions/api/_guide-pdfs.js';
import { TURNSTILE_SITE_KEY } from '../lib/turnstile';

interface Props {
  slug: string;
}
const { slug } = Astro.props;
const guide = GUIDE_PDFS[slug];
if (!guide?.enabled) return;
---

<div class="pdf-download card" id="pdf-download-card" data-slug={slug}>
  <h3 class="pdf-download__title">Download this guide as a PDF</h3>
  <p class="pdf-download__desc" id="pdf-download-desc">
    Enter your email and we'll send you a download link — valid for 24 hours.
  </p>

  <div id="pdf-error-msg" class="pdf-download__error" style="display:none"></div>

  <form id="pdf-download-form" class="pdf-download__form">
    <div class="form-group" id="pdf-email-group">
      <div class="form-row">
        <input
          type="email"
          id="pdf-email"
          name="email"
          class="form-input"
          placeholder="your@email.com"
          autocomplete="email"
        />
        <button type="submit" class="btn btn--primary" id="pdf-submit-btn">
          Download
        </button>
      </div>
    </div>
    <div id="pdf-turnstile-container" data-sitekey={TURNSTILE_SITE_KEY}></div>
  </form>

  <div id="pdf-success" class="pdf-download__success" style="display:none">
    Check your inbox. The link expires in 24 hours.
  </div>
</div>

<!-- Turnstile: explicit render mode, matching contact.astro pattern exactly -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer is:inline></script>

<script>
  var pdfTurnstileWidgetId = null;
  var pdfTurnstileToken = '';
  var pdfLoggedIn = false;

  function initPdfTurnstile() {
    var container = document.getElementById('pdf-turnstile-container');
    if (!container || typeof turnstile === 'undefined') return;
    pdfTurnstileWidgetId = turnstile.render(container, {
      sitekey: container.dataset.sitekey,
      size: 'invisible',
      callback: function(token) { pdfTurnstileToken = token; },
      'error-callback': function() { pdfTurnstileToken = ''; },
      'expired-callback': function() { pdfTurnstileToken = ''; },
    });
  }

  // Poll until Turnstile API is ready (loaded async)
  var pdfTurnstileInterval = setInterval(function() {
    if (typeof turnstile !== 'undefined') {
      clearInterval(pdfTurnstileInterval);
      initPdfTurnstile();
    }
  }, 100);

  var card = document.getElementById('pdf-download-card');
  if (card) {
    var slug = card.dataset.slug;
    var form = document.getElementById('pdf-download-form');
    var emailGroup = document.getElementById('pdf-email-group');
    var submitBtn = document.getElementById('pdf-submit-btn');
    var errorMsg = document.getElementById('pdf-error-msg');
    var successMsg = document.getElementById('pdf-success');
    var desc = document.getElementById('pdf-download-desc');

    // Show error from ?pdf_error query param (user returned from failed redeem link)
    var params = new URLSearchParams(window.location.search);
    var pdfError = params.get('pdf_error');
    var errorMessages = {
      expired: 'That download link has expired. Enter your email to get a new one.',
      used: 'That link has already been used. Enter your email to get a new one.',
      notfound: 'That link is invalid. Enter your email to get a new one.',
      unavailable: 'The PDF isn\'t available yet. Try again soon.',
    };
    if (pdfError && errorMessages[pdfError]) {
      errorMsg.textContent = errorMessages[pdfError];
      errorMsg.style.display = '';
    }

    // Check session — upgrade to logged-in one-click mode if applicable
    fetch('/api/auth/session', { credentials: 'include' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (data && data.user) {
          pdfLoggedIn = true;
          if (emailGroup) emailGroup.style.display = 'none';
          if (desc) desc.style.display = 'none';
          if (submitBtn) submitBtn.textContent = 'Send PDF to my email';
          // No Turnstile needed for logged-in users
          var tsContainer = document.getElementById('pdf-turnstile-container');
          if (tsContainer) tsContainer.style.display = 'none';
        }
      })
      .catch(function() {}); // fail open — keep logged-out form visible

    // Form submit
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        errorMsg.style.display = 'none';
        submitBtn.disabled = true;
        var originalText = pdfLoggedIn ? 'Send PDF to my email' : 'Download';
        submitBtn.textContent = 'Sending\u2026';

        function doSubmit(turnstileToken) {
          var body = { guide_slug: slug };
          if (!pdfLoggedIn) {
            body.email = document.getElementById('pdf-email').value.trim();
            body.turnstileToken = turnstileToken;
          }

          fetch('/api/pdf/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.ok) {
                form.style.display = 'none';
                successMsg.style.display = '';
              } else {
                errorMsg.textContent = data.error || 'Something went wrong. Please try again.';
                errorMsg.style.display = '';
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                if (pdfTurnstileWidgetId !== null) {
                  turnstile.reset(pdfTurnstileWidgetId);
                }
              }
            })
            .catch(function() {
              errorMsg.textContent = 'Something went wrong. Please try again.';
              errorMsg.style.display = '';
              submitBtn.disabled = false;
              submitBtn.textContent = originalText;
            });
        }

        if (pdfLoggedIn) {
          doSubmit('');
        } else if (pdfTurnstileWidgetId !== null) {
          // Execute Turnstile challenge, token arrives via callback
          pdfTurnstileToken = '';
          turnstile.reset(pdfTurnstileWidgetId);
          turnstile.execute(pdfTurnstileWidgetId);
          // Poll for token (Turnstile callback is async)
          var tokenPoll = setInterval(function() {
            if (pdfTurnstileToken) {
              clearInterval(tokenPoll);
              doSubmit(pdfTurnstileToken);
            }
          }, 50);
          // Timeout after 10s
          setTimeout(function() {
            clearInterval(tokenPoll);
            if (!pdfTurnstileToken) {
              errorMsg.textContent = 'Spam check failed. Please try again.';
              errorMsg.style.display = '';
              submitBtn.disabled = false;
              submitBtn.textContent = originalText;
            }
          }, 10000);
        } else {
          // Turnstile not ready yet — try anyway (server will reject if invalid)
          doSubmit('');
        }
      });
    }
  }
</script>

<style>
  .pdf-download {
    margin-top: var(--space-10);
    padding: var(--space-6);
  }

  .pdf-download__title {
    font-size: var(--text-lg);
    font-weight: 600;
    margin-bottom: var(--space-2);
  }

  .pdf-download__desc {
    color: var(--text-secondary);
    margin-bottom: var(--space-5);
    font-size: var(--text-sm);
  }

  /* Error: border + text color only, matching contact.astro error pattern */
  .pdf-download__error {
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-error);
    color: var(--color-error);
    border-radius: var(--radius-md);
  }

  /* Success: neutral surface background */
  .pdf-download__success {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    padding: var(--space-4);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
  }

  .form-row {
    display: flex;
    gap: var(--space-3);
  }

  .form-row .form-input {
    flex: 1;
  }
</style>
```

> Note: Verify the `TURNSTILE_SITE_KEY` import path matches what `contact.astro` uses. If `contact.astro` imports from `../lib/turnstile`, use the same. If it uses a different path, match it.

- [ ] **Step 2: Verify design token usage**

Check that every color, spacing, and font reference uses a CSS custom property from STYLE-GUIDE.md. No hardcoded hex values.

- [ ] **Step 3: Commit**

```bash
git add src/components/PdfDownload.astro
git commit -m "feat: add PdfDownload component (dormant until enabled)"
```

---

### Task 8: Add Component to Guide Pages

**Files:**
- Modify: `src/pages/naprotechnology/index.astro`
- Modify: `src/pages/what-is-rrm/index.astro`

- [ ] **Step 1: Read both guide pages**

Read `src/pages/naprotechnology/index.astro` and `src/pages/what-is-rrm/index.astro` to identify the correct insertion point (bottom of content, above footer CTA or closing layout tag).

- [ ] **Step 2: Add import and component to naprotechnology**

Add to the frontmatter imports:
```js
import PdfDownload from '../../components/PdfDownload.astro';
```

Add component near the bottom of the page content, above any closing `</Layout>` or footer CTA section:
```astro
<PdfDownload slug="naprotechnology" />
```

- [ ] **Step 3: Add import and component to what-is-rrm**

Same pattern:
```js
import PdfDownload from '../../components/PdfDownload.astro';
```
```astro
<PdfDownload slug="what-is-rrm" />
```

- [ ] **Step 4: Verify build succeeds (component is dormant)**

```bash
cd projects/rrm-academy-cf
npm run build 2>&1 | tail -20
```
Expected: build completes with no errors. The component renders nothing (enabled: false), so no visible change.

- [ ] **Step 5: Commit**

```bash
git add src/pages/naprotechnology/index.astro src/pages/what-is-rrm/index.astro
git commit -m "feat: add PdfDownload slot to guide pages"
```

---

### Task 9: Add notfound Notice to /guides/ Index

**Files:**
- Modify: `src/pages/guides/index.astro`

When `/api/pdf/redeem` can't find a token (no guide_slug available to redirect to), it falls back to `/guides/?pdf_error=notfound`. Add a client-side notice there.

- [ ] **Step 1: Read the current guides/index.astro**

Read the full file to understand where to insert the notice — place it near the top of the page content, before the guides grid.

- [ ] **Step 2: Add the notice**

Add this `<div>` and `<script>` block at the top of the page content:

```astro
<div id="guides-pdf-error" style="display:none" class="guides-pdf-notice">
  That download link is invalid or has expired. Find your guide below and request a new link.
</div>

<script>
  const notice = document.getElementById('guides-pdf-error');
  if (notice && new URLSearchParams(window.location.search).get('pdf_error') === 'notfound') {
    notice.style.display = '';
  }
</script>
```

Add minimal style:
```astro
<style>
  .guides-pdf-notice {
    padding: var(--space-3) var(--space-4);
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-6);
  }
</style>
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/guides/index.astro
git commit -m "feat: show notfound notice on guides page for invalid pdf tokens"
```

---

### Task 10: Deploy and Final Smoke Test

- [ ] **Step 1: Push to main**

```bash
git push origin main
```
Wait for GitHub Actions build to complete (~3-4 min). Monitor: `gh run watch`.

- [ ] **Step 2: Verify endpoints are live (all guides still disabled)**

```bash
# Should 404 — guide is disabled
curl -s -o /dev/null -w "%{http_code}" -X POST https://rrmacademy.org/api/pdf/request \
  -H "Content-Type: application/json" \
  -d '{"guide_slug":"naprotechnology","email":"test@example.com","turnstileToken":"x"}'
# Expected: 404

# Should redirect to /guides/?pdf_error=notfound
curl -s -o /dev/null -w "%{http_code}" "https://rrmacademy.org/api/pdf/redeem?token=abc"
# Expected: 302
```

- [ ] **Step 3: Activate one guide for a real end-to-end test**

> This step requires a test PDF. Use any PDF file. Upload to R2, enable the guide, deploy, test, then disable again.

Upload PDF to R2:
```bash
npx wrangler r2 object put rrm-assets/guide-pdfs/naprotechnology.pdf --file=/path/to/test.pdf
```

Enable in config:
```js
// In functions/api/_guide-pdfs.js, temporarily:
'naprotechnology': { enabled: true, ... }
```

Deploy:
```bash
git add functions/api/_guide-pdfs.js
git commit -m "test: temporarily enable naprotechnology pdf for smoke test"
git push origin main
```

- [ ] **Step 4: Full flow test**

1. Visit `https://rrmacademy.org/naprotechnology/` — verify the PDF download card appears
2. Submit your email address
3. Check inbox for the magic link email
4. Click the link — verify PDF downloads
5. Click the link again — verify redirect to `/naprotechnology/?pdf_error=used`
6. Visit `https://rrmacademy.org/naprotechnology/?pdf_error=expired` — verify error message shows
7. Visit `https://rrmacademy.org/guides/?pdf_error=notfound` — verify notice shows

- [ ] **Step 5: Re-disable after testing**

```js
// In functions/api/_guide-pdfs.js:
'naprotechnology': { enabled: false, ... }
```

```bash
git add functions/api/_guide-pdfs.js
git commit -m "chore: disable naprotechnology pdf (not ready yet)"
git push origin main
```

---

## Activation Reference (when PDFs are ready)

```bash
# 1. Upload PDF
npx wrangler r2 object put rrm-assets/guide-pdfs/<slug>.pdf --file=./path/to/<slug>.pdf

# 2. Enable in config
# Edit functions/api/_guide-pdfs.js: set enabled: true for <slug>

# 3. Deploy
git add functions/api/_guide-pdfs.js
git commit -m "feat: enable PDF download for <slug>"
git push origin main
```
