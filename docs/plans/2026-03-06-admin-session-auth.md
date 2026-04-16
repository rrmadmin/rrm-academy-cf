# Admin Session Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static `ADMIN_TOKEN` Bearer auth on admin dashboards with the existing session-based auth system, requiring `superadmin` role.

**Architecture:** Move `roleAtLeast` and `ROLES` into `auth/_shared.js` (general auth concept). Add a `requireSuperAdmin()` helper that validates session cookie + checks role. Extend the middleware to protect `/admin/*` pages. Remove all client-side token logic from admin pages. Add `/admin/index.astro` as a redirect to `/admin/backlinks/`.

**Tech Stack:** CF Pages Functions, D1 sessions, Astro pages

---

### Task 1: Move `roleAtLeast` into `auth/_shared.js`

**Files:**
- Modify: `functions/api/auth/_shared.js`
- Modify: `functions/api/community/_shared.js`

**Step 1: Add ROLES and roleAtLeast to auth/_shared.js**

Add these exports at the end of `functions/api/auth/_shared.js` (before the Google OAuth helpers section):

```js
// --- Role hierarchy ---

const ROLES = ['member', 'mod', 'admin', 'superadmin'];

export function roleAtLeast(userRole, minRole) {
  return ROLES.indexOf(userRole) >= ROLES.indexOf(minRole);
}
```

**Step 2: Update community/_shared.js to import from auth/_shared.js**

Replace the local `ROLES` constant and `roleAtLeast` function in `functions/api/community/_shared.js` with:

```js
import {
  json, getSessionIdFromCookie, validateSession,
  STRIPE_API_VERSION,
  roleAtLeast,
} from '../auth/_shared.js';
```

Remove the local `ROLES` array and `roleAtLeast` function (lines 12-17 of community/_shared.js). Keep the re-export so any other files importing from community/_shared.js still work:

```js
export { roleAtLeast };
```

**Step 3: Commit**

```bash
git add functions/api/auth/_shared.js functions/api/community/_shared.js
git commit -m "refactor: move roleAtLeast to auth/_shared.js"
```

---

### Task 2: Add `requireSuperAdmin` helper to `auth/_shared.js`

**Files:**
- Modify: `functions/api/auth/_shared.js`

**Step 1: Add requireSuperAdmin function**

Add at the end of `functions/api/auth/_shared.js`:

```js
// --- Admin auth ---

/**
 * Validates session cookie and checks for superadmin role.
 * Returns { user, session } on success, or a Response (401/403/500) on failure.
 */
export async function requireSuperAdmin(request, db) {
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  const user = await db.prepare(
    'SELECT id, email, name, role FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return json({ ok: false, error: 'User not found' }, 401);

  if (!roleAtLeast(user.role, 'superadmin')) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }

  return { user, session };
}
```

**Step 2: Commit**

```bash
git add functions/api/auth/_shared.js
git commit -m "feat: add requireSuperAdmin auth helper"
```

---

### Task 3: Extend middleware to protect `/admin/*` pages

**Files:**
- Modify: `functions/_middleware.js`

**Step 1: Add admin route protection**

Import `roleAtLeast` at the top of `_middleware.js`:

```js
import { getSessionIdFromCookie, validateSession, sessionCookie, roleAtLeast } from './api/auth/_shared.js';
```

Add a new block after the `needsAuth` block (after line 125, before `return context.next()`). This handles the page-level redirect for `/admin/*` routes:

```js
  // Admin pages: require session + superadmin role
  const isAdminPage = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
  if (isAdminPage) {
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

    // Check role
    const user = await env.DB.prepare('SELECT role FROM user WHERE id = ?')
      .bind(session.userId).first();
    if (!user || !roleAtLeast(user.role, 'superadmin')) {
      return new Response('Forbidden', { status: 403 });
    }

    const response = await context.next();
    if (session.renewed) {
      const newResponse = new Response(response.body, response);
      newResponse.headers.append('Set-Cookie', sessionCookie(session.id, session.expiresAt));
      return newResponse;
    }
    return response;
  }
```

**Step 2: Commit**

```bash
git add functions/_middleware.js
git commit -m "feat: protect /admin/* routes with session + superadmin role"
```

---

### Task 4: Replace ADMIN_TOKEN in all 5 admin API functions

**Files:**
- Modify: `functions/api/admin/backlinks.js`
- Modify: `functions/api/admin/content.js`
- Modify: `functions/api/admin/conversions.js`
- Modify: `functions/api/admin/revenue.js`
- Modify: `functions/api/admin/seo.js`

For each file, replace the ADMIN_TOKEN Bearer check with a call to `requireSuperAdmin`.

**Step 1: Update `backlinks.js`**

Add import at the top:
```js
import { requireSuperAdmin } from '../auth/_shared.js';
```

Replace lines 18-31 (the auth block inside `onRequestPost`) with:
```js
export async function onRequestPost(context) {
  const { request, env } = context;

  // Session-based admin auth
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
```

Remove the local `json` helper function (lines 7-12) and import from `_shared.js` instead:
```js
import { json, requireSuperAdmin } from '../auth/_shared.js';
```

**Step 2: Update `content.js`**

Already imports `json` from `auth/_shared.js`. Add `requireSuperAdmin` to the import:
```js
import { json, requireSuperAdmin } from '../auth/_shared.js';
```

Replace lines 16-19 (the auth block) with:
```js
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
```

**Step 3: Update `conversions.js`**

Same pattern. Add `requireSuperAdmin` to the import:
```js
import { json, requireSuperAdmin } from '../auth/_shared.js';
```

Replace lines 18-25 (the auth block) with:
```js
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
```

**Step 4: Update `revenue.js`**

Add `requireSuperAdmin` to the import:
```js
import Stripe from 'stripe';
import { json, STRIPE_API_VERSION, requireSuperAdmin } from '../auth/_shared.js';
```

Replace lines 13-16 (the auth block) with:
```js
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
```

**Step 5: Update `seo.js`**

Replace the local `json` function (lines 7-14) with an import. Add `requireSuperAdmin` to the import:
```js
import { json, requireSuperAdmin } from '../auth/_shared.js';
```

Note: seo.js has custom CORS headers in its local `json` function. The `json` from `_shared.js` already includes `Access-Control-Allow-Origin: https://rrmacademy.org`, so this is fine. Also update `onRequestOptions` to use the standard CORS headers:
```js
import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}
```

Replace lines 31-41 (the auth block inside `onRequestGet`) with:
```js
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;
```

**Step 6: Commit**

```bash
git add functions/api/admin/backlinks.js functions/api/admin/content.js functions/api/admin/conversions.js functions/api/admin/revenue.js functions/api/admin/seo.js
git commit -m "feat: replace ADMIN_TOKEN with session auth in admin APIs"
```

---

### Task 5: Remove login gate from all 5 admin pages

**Files:**
- Modify: `src/pages/admin/backlinks.astro`
- Modify: `src/pages/admin/content.astro`
- Modify: `src/pages/admin/conversions.astro`
- Modify: `src/pages/admin/revenue.astro`
- Modify: `src/pages/admin/seo.astro`

For each file, apply these changes:

**Step 1: Remove the login gate HTML section**

Delete the entire `<section id="login-gate">` block from each file. This is the section with the token input and login button.

**Step 2: Remove `hidden` attribute from dashboard section**

Change `<section id="dashboard" ... hidden>` to `<section id="dashboard" ...>` (remove `hidden`).

**Step 3: Rewrite the JavaScript**

Remove all token-related JS code:
- `TOKEN_KEY`, `EXPIRY_KEY`, `TTL_MS` constants
- `getToken()`, `setToken()`, `clearToken()` functions
- `showLogin()`, `showDashboard()` functions
- `doLogin()` function and login event listeners
- The init block that checks `getToken()`

Replace the `apiCall` function pattern. Instead of sending a Bearer token, send the request with `credentials: 'include'` so the session cookie is sent:

For **backlinks.astro** (uses POST with action/params):
```js
async function apiCall(action, params) {
  params = params || {};
  var resp = await fetch('/api/admin/backlinks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: action, params: params }),
  });
  if (resp.status === 401 || resp.status === 403) { window.location.href = '/login/?redirect=/admin/backlinks/'; return; }
  var data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data;
}
```

For **content.astro**, **conversions.astro**, **revenue.astro** (use GET with query params):
```js
async function apiCall(params) {
  var qs = params ? '?' + new URLSearchParams(params).toString() : '';
  var resp = await fetch('/api/admin/content' + qs, {
    credentials: 'include',
  });
  if (resp.status === 401 || resp.status === 403) { window.location.href = '/login/?redirect=/admin/content/'; return; }
  var data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data;
}
```

(Adjust the endpoint path and redirect path per file: `/api/admin/revenue`, `/api/admin/conversions`, etc.)

For **seo.astro** (uses GET with `?action=` param):
```js
async function apiCall(action) {
  var resp = await fetch('/api/admin/seo?action=' + encodeURIComponent(action), {
    credentials: 'include',
  });
  if (resp.status === 401 || resp.status === 403) { window.location.href = '/login/?redirect=/admin/seo/'; return; }
  var data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Request failed');
  return data;
}
```

**Step 4: Update logout button behavior**

Change the logout button to call the existing logout endpoint and redirect:
```js
document.getElementById('logout-btn').addEventListener('click', async function() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/login/';
});
```

Note: Check if `/api/auth/logout` exists. If not, just redirect to `/login/` (the session will expire naturally, or they can clear the cookie).

**Step 5: Remove login-gate CSS**

Remove the `.bl-login-wrap` / login-gate CSS blocks from each file. Keep all dashboard styles.

**Step 6: Auto-load data on page load**

Since there's no login gate, each page should load its data immediately. Replace the init block with a direct call:

```js
// Init - load data immediately (middleware guarantees auth)
loadData();  // or loadSummary(); loadBacklinks(); etc. depending on the page
```

**Step 7: Commit**

```bash
git add src/pages/admin/backlinks.astro src/pages/admin/content.astro src/pages/admin/conversions.astro src/pages/admin/revenue.astro src/pages/admin/seo.astro
git commit -m "feat: remove token login gate from admin pages, use session cookie"
```

---

### Task 6: Create `/admin/index.astro` redirect page

**Files:**
- Create: `src/pages/admin/index.astro`

**Step 1: Create the redirect page**

```astro
---
// Middleware guarantees auth before this page renders.
// Redirect to the first admin dashboard.
return Astro.redirect('/admin/backlinks/');
---
```

**Step 2: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "feat: add /admin index page redirecting to backlinks"
```

---

### Task 7: Verify logout endpoint exists

**Files:**
- Check: `functions/api/auth/logout.js`

**Step 1: Check if logout endpoint exists**

Look for `functions/api/auth/logout.js`. If it exists and clears the session, no action needed.

If it doesn't exist, create it:

```js
import { getSessionIdFromCookie, invalidateSession, clearSessionCookie, json } from './_shared.js';

export async function onRequestPost({ request, env }) {
  const sessionId = getSessionIdFromCookie(request);
  if (sessionId && env.DB) {
    await invalidateSession(env.DB, sessionId);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
}
```

**Step 2: Commit (if created)**

```bash
git add functions/api/auth/logout.js
git commit -m "feat: add logout endpoint"
```

---

### Task 8: Verify Brian's user role in D1

**Step 1: Check role**

Use wrangler to query D1:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npx wrangler d1 execute rrm-academy --remote --command="SELECT id, email, role FROM user WHERE email = 'brianrwhittaker@gmail.com'"
```

If role is not `superadmin`, update it:
```bash
npx wrangler d1 execute rrm-academy --remote --command="UPDATE user SET role = 'superadmin' WHERE email = 'brianrwhittaker@gmail.com'"
```

**Step 2: No commit needed (data change, not code)**

---

### Task 9: Deploy and verify

**Step 1: Deploy**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && git push
```

CF Pages auto-deploys on push.

**Step 2: Verify**

1. Open `https://rrmacademy.org/admin` in Comet - should redirect to login if not logged in
2. Log in with brianrwhittaker@gmail.com via Google OAuth
3. After login, navigate to `/admin` - should redirect to `/admin/backlinks/`
4. Verify all 5 dashboards load data without any token prompt
5. Verify logout button works
6. Open `/admin/backlinks/` in an incognito window - should redirect to login
