# Old Admin: Landing (`/admin/`)

## Purpose

Bare redirect from the `/admin/` root to a specific admin sub-page; not a dashboard of its own.

## API endpoints the page calls

None. The entire file is:

```astro
---
return Astro.redirect('/admin/backlinks/');
---
```

`Astro.redirect('/admin/backlinks/')` fires server-side at build/request time -- no client JS, no fetch calls.

## Data model

None.

## Actions available in the UI

None, redirect only.

## Auth level required

None enforced by this file itself (it's a static redirect). The destination, `/admin/backlinks/`, and every other `/admin/*` page sit behind the superadmin session gate enforced at each API endpoint (see `functions/api/admin/_middleware.js`, which best-effort-populates session/user but does not itself block access -- individual API handlers return 401/403 and the client-side pages then redirect to `/login/`).

## Port status

NOT PORTED -- reference for a future backoffice surface (was the /admin landing redirect)
