# Design: Server-Side GA4 Analytics via CF Pages Middleware

**Date:** 2026-02-27
**Status:** Approved
**Scope:** GA4 pageview tracking with zero client-side JS impact

---

## Context

RRM Academy migrated from Wix to Cloudflare Pages. The old "Wix Website" GA4 property tracked client-side via gtag.js. The new approach:

- **New GA4 property:** "RRM Academy (Cloudflare)" — `G-TSWRY7XLR0`
- **Method:** GA4 Measurement Protocol v2 fired from `_middleware.js` using `ctx.waitUntil()`
- **Zero client-side JS** — no gtag.js, no dataLayer, no cookies
- **Non-blocking** — `waitUntil()` fires after the response is sent

---

## Architecture

### Where it lives

`functions/_middleware.js` — already runs on every CF Pages Functions request. We add a single fire-and-forget GA4 hit for HTML page requests only.

### What fires

A `page_view` event via `https://www.google-analytics.com/mp/collect`.

**Payload per hit:**
- `client_id` — stable hash of `IP + User-Agent` (no cookie, GDPR-friendly, deterministic per device)
- `page_location` — full URL
- `page_referrer` — from `Referer` header
- `user_agent` — from `User-Agent` header

### What does NOT fire

- API routes (`/api/*`)
- Static assets (non-HTML requests, detected via `Accept: text/html` header)
- CF Pages internal routes

### Future Phase B (conversions)

Add one `sendGA4Event()` call inside specific API handlers:
- `create-checkout.js` → `purchase` event
- `courses/enroll.js` → `sign_up` / custom enrollment event
- No middleware changes needed

---

## Implementation

### 1. CF Pages secrets (via Wrangler or CF dashboard)

```
GA4_MEASUREMENT_ID = G-TSWRY7XLR0
GA4_API_SECRET = <rotated 2026-05-05; live value in 1Password / CF Pages secret>
```

### 2. `_middleware.js` changes

Add a `sendPageView()` helper that:
1. Checks `Accept` header contains `text/html` (skip assets/API)
2. Skips `/api/*` paths explicitly
3. Builds `client_id` as `hex(sha256(ip + userAgent)).slice(0, 16)`
4. Posts to Measurement Protocol endpoint via `ctx.waitUntil(fetch(...))`
5. Never throws — wrapped in try/catch, silent on failure

### 3. Guard manifest update

`_middleware.js` is a guarded file. Run `npm run guard:update` after changes.

---

## GSC (already complete)

- Property: `https://rrmacademy.org/` — already verified via DNS TXT
- Sitemap: `sitemap-index.xml` submitted 2026-02-27
- Status: "Couldn't fetch" initially (normal — Google crawls async, resolves within hours)

---

## What this does NOT change

- `BaseLayout.astro` — no modifications
- No client-side JS added anywhere
- No cookies set
- No consent banner needed (server-side, no PII stored)
