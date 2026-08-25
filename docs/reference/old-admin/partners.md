# Old Admin: Partners

Source: `src/pages/admin/partners.astro` + `functions/api/admin/partners/index.js` + `functions/api/admin/partners/[id].js`

## Purpose

Admin dashboard for reviewing and actioning Educational Partner (clinic) applications: approve, reject, or revoke, with counts by status and three status-bucketed tables.

## API endpoints

- `GET /api/admin/partners[?status=pending|active|rejected|revoked]` -- list partner applications, optionally filtered by status
- `POST /api/admin/partners/:id` -- body `{ action: 'approve'|'reject'|'revoke', reason?: string }` -- state-transition action on a single partner record

## Data model

D1 table: `partners`. Columns read/written: `id, name, slug, site_url, country, city, provider_name, provider_credential, provider_directory_id, blurb, affirmations (JSON), contact_email, tier, status, notes, created_at, approved_at, revoked_at`.

State machine (enforced by `[id].js`):
- `approve`: requires current status `pending` -> `active`, sets `approved_at`
- `reject`: requires current status `pending` -> `rejected`, appends a dated reason line to `notes`
- `revoke`: requires current status `active` -> `revoked`, sets `revoked_at`, appends a dated reason line to `notes`

Any other transition is refused `409 invalid_state_transition`. `reject`/`revoke` require a non-empty `reason` (max 500 chars).

**External API**: on successful action, dynamically imports `functions/api/partners/_emails.js` and fires one of `sendPartnerWelcomeEmail` / `sendPartnerRejectionEmail` / `sendPartnerRevocationEmail` (best-effort; email failure is logged but does not fail the request or roll back the D1 update).

## Actions available in the UI

- **Refresh** button -- reloads the partner list.
- **Approve** (pending rows) -- confirm dialog, then `POST` `{action:'approve'}`; sends welcome email.
- **Reject** (pending rows) -- prompts for a reason, then `POST` `{action:'reject', reason}`; sends rejection email.
- **Revoke** (active rows) -- prompts for a reason, then `POST` `{action:'revoke', reason}`; sends revocation email.
- **Logout** button -- `POST /api/auth/logout`, redirects to `/login/`.

Three tables render from one fetched list, bucketed client-side by status: Pending Review (with Approve/Reject actions), Active (with Revoke action), Rejected & Revoked (read-only, shows notes).

## Auth level

Superadmin only. Both `index.js` and `[id].js` call `requireSuperAdmin(request, env.DB)` -- strict superadmin role, no carve-out. `functions/api/admin/_middleware.js` only best-effort populates the session; it does not enforce auth. The client-side script redirects to `/login/?redirect=/admin/partners/` on a 401/403 from the list call.

## Port status

NOT PORTED -- reference for a future backoffice surface
