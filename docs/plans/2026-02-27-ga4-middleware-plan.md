# GA4 Server-Side Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fire GA4 `page_view` hits from `_middleware.js` using `ctx.waitUntil()` — zero client-side JS, zero added latency.

**Architecture:** CF Pages middleware intercepts every HTML page request and fires a GA4 Measurement Protocol v2 hit asynchronously after the response is sent. Client ID is a deterministic hash of IP + User-Agent (no cookies, GDPR-friendly). API routes and non-HTML requests are skipped.

**Tech Stack:** Cloudflare Pages Functions (Workers runtime), GA4 Measurement Protocol v2, SubtleCrypto (built into Workers), CF Pages secrets.

---

### Task 1: Add CF Pages secrets

**Files:**
- No code changes — CF dashboard only

**Step 1: Add secrets via Wrangler**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
echo "G-TSWRY7XLR0" | npx wrangler pages secret put GA4_MEASUREMENT_ID --project-name rrm-academy
op read 'op://Automation/<redacted>/credential' | npx wrangler pages secret put GA4_API_SECRET --project-name rrm-academy
```

Expected: `✨ Success! Uploaded secret GA4_MEASUREMENT_ID` (and same for API_SECRET)

**Step 2: Verify secrets exist**

```bash
npx wrangler pages secret list --project-name rrm-academy
```

Expected: Both `GA4_MEASUREMENT_ID` and `GA4_API_SECRET` appear in the list.

---

### Task 2: Add GA4 helper to `_middleware.js`

**Files:**
- Modify: `functions/_middleware.js`

**Step 1: Read current file**

Read `functions/_middleware.js` in full before making any changes.

**Step 2: Add the GA4 helper and integrate into `onRequest`**

Add the `sendPageView` helper function and call it from `onRequest`. The final file should look like this:

```js
/**
 * CF Pages Function middleware for RRM Academy.
 * Handles:
 * 1. Subdomain redirects (library.rrmacademy.org → rrmacademy.org/library)
 * 2. Auth protection for /account/* and /community/* routes
 * 3. GA4 server-side page_view tracking (fire-and-forget via waitUntil)
 *
 * NOTE: Old library slug redirects are handled by the rrm-router Worker,
 * not here (avoids loading the 500KB redirect map on every request).
 */
import { getSessionIdFromCookie, validateSession, sessionCookie } from './api/auth/_shared.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Derives a stable, anonymous client_id from IP + User-Agent.
 * No cookie, no PII stored — just a deterministic identifier per device.
 * Returns a 16-char hex string.
 */
async function getClientId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const raw = new TextEncoder().encode(`${ip}:${ua}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', raw);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Fires a GA4 page_view hit via Measurement Protocol.
 * Called with ctx.waitUntil() so it never blocks the response.
 */
async function sendPageView(request, env) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;

  const url = new URL(request.url);

  // Only fire for HTML page requests — skip API routes and assets
  if (url.pathname.startsWith('/api/')) return;
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return;

  try {
    const clientId = await getClientId(request);
    const payload = {
      client_id: clientId,
      events: [{
        name: 'page_view',
        params: {
          page_location: request.url,
          page_referrer: request.headers.get('Referer') || '',
        },
      }],
    };

    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // Silent — never let analytics failures affect the user
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Fire GA4 page_view asynchronously — does not block the response
  context.waitUntil(sendPageView(request, env));

  // 301 redirect: library.rrmacademy.org → rrmacademy.org/library
  if (url.hostname === 'library.rrmacademy.org') {
    const path = url.pathname.startsWith('/library') ? url.pathname : `/library${url.pathname}`;
    return Response.redirect(
      `https://rrmacademy.org${path}${url.search}`,
      301
    );
  }

  const needsAuth =
    url.pathname === '/account' || url.pathname.startsWith('/account/') ||
    url.pathname === '/community' || url.pathname.startsWith('/community/');

  if (needsAuth) {
    if (!env.DB) {
      return new Response('Service Unavailable', { status: 503 });
    }
    const sessionId = getSessionIdFromCookie(request);

    if (!sessionId) {
      return Response.redirect(`https://rrmacademy.org/login/?redirect=${encodeURIComponent(url.pathname)}`, 302);
    }

    const session = await validateSession(env.DB, sessionId);
    if (!session) {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `https://rrmacademy.org/login/?redirect=${encodeURIComponent(url.pathname)}`,
          'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        },
      });
    }

    const response = await context.next();
    if (session.renewed) {
      const newResponse = new Response(response.body, response);
      newResponse.headers.append('Set-Cookie', sessionCookie(session.id, session.expiresAt));
      return newResponse;
    }
    return response;
  }

  // Continue to static assets / functions
  return context.next();
}
```

**Step 3: Update the guard manifest**

`_middleware.js` is a guarded file. After saving changes, update the manifest:

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
npm run guard:update
```

Expected: outputs updated hash for `functions/_middleware.js`, no errors.

**Step 4: Verify guard passes**

```bash
npm run guard
```

Expected: all PASS, exit 0.

**Step 5: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add functions/_middleware.js guard-manifest.json
git commit -m "feat: add server-side GA4 page_view tracking via middleware waitUntil"
```

---

### Task 3: Deploy and verify

**Step 1: Push to deploy**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git push origin main
```

Expected: GitHub Actions picks up the push, CF Pages builds and deploys.

**Step 2: Check deployment succeeded**

Wait ~2 minutes, then:

```bash
curl -sI https://rrmacademy.org/ | grep -i "cf-ray\|x-content-type"
```

Expected: `cf-ray` header present (confirms CF is serving).

**Step 3: Verify GA4 is receiving hits**

In GA4 → RRM Academy (Cloudflare) → Admin → DebugView:
- Navigate to `https://rrmacademy.org/` in any browser
- Within ~30 seconds, a `page_view` event should appear in DebugView

> Note: DebugView only shows hits sent with `debug_mode: true`. For production verification, check GA4 Realtime report (Reports → Realtime) instead — page_view events appear within 1-2 minutes.

**Step 4: Verify no performance regression**

```bash
curl -w "TTFB: %{time_starttransfer}s\n" -o /dev/null -s https://rrmacademy.org/
```

Expected: TTFB well under 200ms (waitUntil does not add to this).

---

## Phase B — Conversion Events (future)

When ready, add to specific API handlers:

```js
// In create-checkout.js, after successful Stripe session creation:
context.waitUntil(sendGA4Event(request, env, 'begin_checkout', {
  currency: 'USD',
  value: amount,
}));

// In courses/enroll.js, after successful enrollment:
context.waitUntil(sendGA4Event(request, env, 'sign_up', {
  method: 'course_enrollment',
  course_slug: slug,
}));
```

Extract `sendGA4Event` as a shared helper in `functions/api/auth/_shared.js` at that point.
