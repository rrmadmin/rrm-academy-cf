# Old Admin: Community

## Purpose

Admin queue for deciding member volunteer requests to own an ownerless Community "Action Area" (approve promotes the volunteer to area owner + lead and auto-declines competing volunteers for that area; decline just rejects the request).

## API endpoints the page calls

The `.astro` page itself only calls the ownership endpoints:
- `GET /api/admin/community/ownership` -- lists pending ownership requests (joined to area + volunteer user).
- `POST /api/admin/community/ownership` -- body `{ id, action: 'approve' | 'reject' }`, decides one request.

Three sibling handlers exist under `functions/api/admin/community/` but have **no UI on this page** (no fetch call sites in `community.astro`); they are documented here because they sit in the same directory and share the same auth model, likely intended for a fuller admin community-management surface that was never built out on the frontend:
- `POST/PUT/DELETE /api/admin/community/areas` -- create/update/archive-or-hard-delete an Action Area.
- `POST/PUT/DELETE /api/admin/community/impact` -- create/update/delete an impact-entry record (no children, so DELETE is always hard).
- `POST/PUT/DELETE /api/admin/community/projects` -- create/update/archive-or-hard-delete a Project under an Area.

## Data model

D1 (`rrm-auth`), no external APIs.

- **`action_area`**: `id`, `slug` (unique, reserved slugs `areas`/`events`/`members`/`post` blocked), `name`, `tagline`, `description`, `icon`, `bucket` (`research`/`advocacy`/`education`/`community`), `owner_user_id`, `sort_order`, `status` (`active`/`archived`).
- **`area_ownership_request`**: `id`, `area_id`, `user_id` (volunteer), `message`, `status` (`pending`/`approved`/`rejected`/`withdrawn`), `created_at`, `decided_at`, `decided_by`. Listed via a LEFT JOIN to `user` (a request survives even if the volunteer's user row was later deleted -- shows as "--").
- **`area_membership`**: `(user_id, area_id, role)`, role `owner`/`member`. Approving a request UPSERTs the volunteer as `owner` and demotes any prior owner to `member`.
- **`project`**: `id`, `area_id`, `slug`, `title`, `summary`, `description`, `status` (`recruiting`/`in_progress`/`paused`/`done`/`archived`), `owner_user_id`, `workspace_url`, `pinned`, `sort_order`.
- **`project_membership`**: `(user_id, project_id, role)`, same owner-transfer pattern as `area_membership`.
- **`impact_entry`**: `id`, `area_id` (nullable), `project_id` (nullable), `kind` (`webinar`/`research`/`advocacy`/`legal`/`milestone`), `title`, `detail`, `occurred_on` (ISO date), `created_by`.
- **`community_post`**: only touched incidentally -- `area_id` is nulled out on hard-delete of an area.

Ownership approval and area/project owner-reassignment are all done inside `db.batch()` transactions gated on existence checks (`EXISTS (SELECT 1 FROM ...)`), specifically to avoid the half-committed-write race described in the code comments (an approve that loses a race writes nothing rather than leaving an area owned but the request still pending).

## Actions available in the UI

- **Refresh button**: reloads the pending-requests table.
- **Approve button (per row)**: POSTs `{ action: 'approve' }` -- claims area ownership for the volunteer (fails 409 `area_already_owned` if already claimed, 400 `owner_user_not_found` if the volunteer's account was deleted since filing), auto-rejects other pending requests for the same area.
- **Decline button (per row)**: POSTs `{ action: 'reject' }` -- marks the request rejected.
- **Logout button**: standard session logout.

(The areas/impact/projects CRUD endpoints have no corresponding buttons/forms on this page -- listed above for completeness only.)

## Auth level required

Admin or superadmin (all four `functions/api/admin/community/*.js` handlers self-check `user.role === 'superadmin' || user.role === 'admin'`, more permissive than the straight-superadmin gate used by backlinks/campaign-report/content). `functions/api/admin/_middleware.js` only best-effort populates `context.data.user` -- each endpoint enforces its own auth.

## Port status

NOT PORTED -- reference for a future backoffice surface
