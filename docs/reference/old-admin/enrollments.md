# Old Admin: Enrollments

Source: `src/pages/admin/enrollments.astro` + `functions/api/admin/enrollments.js`

## Purpose

Read-only dashboard showing course enrollment totals, per-course breakdown, and a paginated recent-enrollments list.

## API endpoints

- `GET /api/admin/enrollments?view=summary` -- totals + by-course breakdown + signup sources
- `GET /api/admin/enrollments?view=list&page=<n>&limit=<n>&course_id=<id>` -- paginated recent enrollments (default page 1, limit 50, max 200)

## Data model

D1 table: `enrollment` (joined to `user` for name/email). Filters every query on `revoked_at IS NULL`.

- **Summary totals**: `COUNT(*)` total enrollments, `COUNT(DISTINCT user_id)` unique students, last-30-day and last-7-day counts (via `datetime('now', '-N days')`).
- **By-course breakdown**: per `course_id` -- total, last_30d, last_7d, `completed` (count where `completed_at IS NOT NULL`), `paid` (count where `stripe_payment_intent IS NOT NULL`). Ordered by total DESC.
- **Signup sources**: `user.signup_source` grouped and counted for users created in the last 30 days (returned in the summary payload but not rendered by the page UI).
- **List**: `enrollment` joined to `user`, columns `id, course_id, enrolled_at, stripe_payment_intent, completed_at, email, name`. Optional `course_id` filter. Ordered `enrolled_at DESC`.

No external APIs (Stripe, etc.) are called directly -- `stripe_payment_intent` is read from D1 only, used to badge a row "Paid" vs "Free".

## Actions available in the UI

- **Refresh** button -- reloads summary + list.
- **Course filter dropdown + Apply** -- filters the recent-enrollments list by `course_id`, resets to page 1.
- **Prev / Next pagination** -- paginates the recent-enrollments list.
- **Logout** button -- `POST /api/auth/logout`, redirects to `/login/`.

No write/mutation actions -- the page and its API are entirely read-only.

## Auth level

Superadmin only. `enrollments.js` calls `requireSuperAdmin(request, env.DB)` -- strict superadmin role, no carve-out for lower admin roles. `functions/api/admin/_middleware.js` only best-effort populates `context.data.user`/`session` from the cookie; it does not enforce auth itself (each endpoint checks). Unauthenticated/insufficient-role requests get a 401/403 from `requireSuperAdmin`, and the client-side script redirects to `/login/?redirect=/admin/enrollments/` on either status.

## Port status

ported to rrm-backoffice (/enrollments)
