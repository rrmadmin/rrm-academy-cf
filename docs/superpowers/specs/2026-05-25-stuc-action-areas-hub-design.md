# STUC Action Areas Hub — Design Spec

**Date:** 2026-05-25 (revised same day after `/arise --deep` spec trace — 20 findings folded in)
**Status:** Design approved at brainstorm; deep-traced + hardened; ready for implementation plan
**Project:** rrm-academy-cf
**Author:** Brian (with Claude)
**Scope:** `/community/` hub redesign — make the "do tank" operating model visible. Adds Action Areas, an Active Projects bulletin, a monthly-impact strip, and consolidates the existing feed into one chat-styled stream with area filters.
**Out of scope for v1:** Per-area dedicated chat rooms (deferred to Phase 2), live video calls (separate spec: `2026-05-16-cloudflare-realtime-stuc-design.md`), the public join/landing page at `/save-the-uterus-club/` (untouched).

## Revision log

- **2026-05-25 v1** — initial design, approved at brainstorm.
- **2026-05-25 v2** — `/arise --deep` spec trace (5 Opus tracers incl. SCHEMA-MIGRATION) returned 2 CRITICAL + 6 HIGH + 9 MEDIUM + 2 LOW + 1 NOTE. All folded in. The load-bearing structural changes:
  1. **Middleware carve-out** (CRITICAL #1): the live `functions/_middleware.js` 302-redirects all logged-out `/community/*` to `/login/` before any render — the v1 "logged-out recruiting surface" was impossible. Now in scope, with an explicit public-path list and the guard-invariant change called out.
  2. **Schema baseline corrected** (HIGH #3): `schema.sql`'s `community_post` DDL is drifted from live prod (missing `title`, `body`, `slug`, `og_image_url`). §Current state now reflects live; G-AREA-6 validates against live `PRAGMA table_info`, not the file.
  3. **Archive is now a propagating state transition** (HIGH #8): all child reads resolve through an active-parent join; `project.status` gains `archived`.
  4. **Response shape decided** (HIGH #4): new endpoints return `{ ok: true, results }` to match existing community siblings + hub JS (NOT the generic `{ results }` standard — deliberate, documented divergence from CLAUDE.md coding-standard #5).
  5. Migration pinned to `024`; membership read-back + leave endpoints added; enum CHECK constraints, `isSafeUrl(workspace_url)`, ET month boundary, owner-resolution-as-separate-UPDATE all added.
- **2026-05-27 v3** — Sparse-state display gating added (Brian's call). With ~36 members and a handful of projects, showing raw counts advertises sparseness. The hub now leads with mission + invitation and only reveals counts once they cross a "looks healthy" floor; the numbers reappear automatically as the club grows, no later code change. APIs still compute the counts; only the public display is gated. See §Sparse-state display gating and G-AREA-12.

---

## Source of truth

This redesign is driven by **New Recording 129** (2026-05-22), a 3-minute voice memo between Brian and Dr. Naomi Whittaker. The other recent transcripts (05-12 STUC Networking Call, 05-13 "Strategic Blueprint") are about clinical/policy topics and a broader women's-health-movement vision respectively — neither is the redesign source.

## Goal

Right now Save the Uterus Club reads as a **lecture-driven think tank**: members see monthly webinars and a Twitter-style feed, but can't answer the only two questions that matter:

1. **Where do I fit?**
2. **What can I do?**

Naomi's intended identity is a **"do tank"** — members self-sort into advocacy groups, action groups, research ownership, and project teams. The page *is* the operating model made visible. The soft launch already exposed the gap (a core member, Victoria, was the retention warning signal) before a hard launch. Without a coherent public architecture, energy stays trapped in conversation; with one, members self-sort into workstreams and projects grow organically.

## The core insight that shaped v1

The initiative is **not** failing on interest. It is **underdefined** because the operating model has never been made legible. The fix is a clear front door: categories, owners, active projects, sign-up paths, and collaboration spaces — surfaced on the hub itself.

## Decisions locked in during brainstorming

| Decision | Value | Rationale |
|---|---|---|
| Naming | **Action Areas** | Do-tank framing. Public-facing, clickable categories. |
| Internal structure | Action Areas roll up into ~4 strategic **buckets** with owners: `research`, `advocacy`, `education`, `community` | Internal org spine without exposing bucket jargon. Research → Bailey, Patient Advocacy → owner TBC. |
| Conversation model | **One living hub, structure layered on top.** Do NOT fragment the stream into 5 area channels. | ~36 members across 5 channels = every channel looks dead. |
| Area "channels" | **Filter pills on the one stream**, not separate rooms | Do-tank structure AND visible life on one page. |
| Per-area dedicated rooms | **Deferred to Phase 2** | Area detail page shows that area's *filtered slice* of the same stream. |
| Chat-style restyle | **Phase 1**, as ONE consolidated stream | Core "feels like a chat not a Twitter feed" ask. |
| Logged-out experience | Public browses hub **structure** (areas + projects + impact); **live conversation + Join are members-only**. **Requires a `_middleware.js` carve-out** (see §Auth & gating). | The structure is the recruiting surface. Without the carve-out, logged-out visitors are 302'd to login (CRITICAL #1). |
| Impact Rollup (Phase 1) | **Owner-curated entries only.** "Auto-counted tagged events" moved to **Phase 2** (no computable source exists in v1 — see §Impact rollup). | Avoids shipping an unbuildable half. |
| Non-destructive | Existing `community_post` / feed keeps working; posts gain an optional `area_id`; nothing dropped | The current feed is live with real posts. Migration is additive only. |
| Response shape | New endpoints return `{ ok: true, results }` (match existing community siblings + hub JS), NOT the generic `{ results }` standard | Deliberate divergence from CLAUDE.md coding-standard #5; standard #1 (match siblings) wins here. |

## Current state (being built on)

- Hub at `/community/` (`src/pages/community/index.astro`, ~86 KB). Siblings: `/community/events`, `/community/members`, `/community/post/[id]`.
- **`functions/_middleware.js:300-306`** puts `/community` (exact) and every `/community/*` path in `needsAuth` → unauthenticated requests get a 302 to `/login/`. This is also a **guarded file** (security invariant: *"`_middleware.js` must protect `/community`"*).
- D1 `rrm-auth` community tables. **`schema.sql` was regenerated from the live database on 2026-05-25** and now faithfully mirrors all 59 `rrm-auth` tables (it was previously a stale 27-table early snapshot — `community_post`'s `title`/`body`/`content`/`slug`/`og_image_url` columns had been added out-of-band with no migration file; only `channel` came via migration `003`). Live `community_post` columns:
  `community_post(id, author_id, type, title, body, pinned, event_date, event_link, resource_url, created_at, updated_at, channel, content, slug, og_image_url)`.
  Indexes: `idx_community_post_type(type)`, `idx_community_post_pinned(pinned, created_at)`, `idx_community_post_channel(channel, created_at)`, `idx_community_post_slug` (UNIQUE, `slug COLLATE NOCASE WHERE slug IS NOT NULL`).
- API under `functions/api/community/`: all endpoints return `{ ok: true, ... }` / `{ ok: false, error }`. Shared: `_shared.js` (`requireMember()` — gates on `user.blocked` + `email_verified = 1`), `_email.js`. `posts.js` validates URLs via `isSafeUrl()` (http/https only).
- **`functions/api/admin/_middleware.js` does NOT enforce auth** — it best-effort populates `context.data.user`; each admin handler self-checks role. Gold-standard sibling: `functions/api/admin/faqs/[id].js`.
- Membership gating choke points: `functions/_middleware.js` (page-level redirect) + `requireMember()` (API-level).

## Auth & gating (NEW — resolves CRITICAL #1)

The v1 design assumed `requireMember()` was the only gate. It is not — `_middleware.js` redirects the whole page before SSR. To make the logged-out recruiting surface real:

- **`functions/_middleware.js` is in scope.** Remove `/community` (exact) and `/community/areas` + `/community/areas/*` from the `needsAuth` predicate (both the line-186 block and the line-300 block). Keep `/community/events`, `/community/members`, `/community/post/*`, and the live-stream API gated.
- **Security guard:** `_middleware.js` is hash-guarded and carries the invariant *"`_middleware.js` must protect `/account` and `/community`"*. Re-scope the invariant to `/community/events`, `/community/members`, `/community/post` (the genuinely member-only sub-paths) and run `npm run guard:update`. Document the change in the commit.
- **Logged-out data source:** the hub's structure (Action Areas row, Active Projects rail, This Month strip) renders **server-side at build time OR via public GET endpoints** (`/api/community/areas`, `/projects`, `/impact` — all public per §Endpoints). The **live conversation stream + composer + Join buttons** remain members-only: the page renders a "Join to see the conversation" gate in the stream slot for logged-out/non-member visitors, and the stream/compose/join APIs enforce `requireMember()`.

## Hub layout (v1)

`/community/` top to bottom:

```
┌ "This Month" impact strip      curated proof of monthly impact
┌ Action Areas row               compact cards: icon · name · project count   ← "where do I fit"
┌ Active Projects rail           in-progress · [Join] · [Open workspace]      ← "what can I do"
└ Live Conversation              ONE chat-style stream (members-only),
                                  composer on top, area filter pills,
                                  each post shows an area chip
```

- **Default stream view = everything together** (All pills active). The `?area=` filter narrows to posts tagged with that area; untagged (NULL-area) posts always show under "All".
- Logged-out visitors see impact strip + Action Areas row + Active Projects rail; the stream slot shows the join gate.
- **Zero-active-areas state:** when `action_area` has no active rows (pre-seed, or all archived), the areas row, projects rail, filter pills, AND per-post area chips all suppress — the page renders the **verbatim legacy feed**. The stream restyle (chat-style consolidation) is independent of area existence and ships regardless; only the area-dependent furniture (pills, chips, rails) is gated on active areas.

## Sparse-state display gating (v3)

Distinct from the zero-active-areas fallback above: even with active areas, the early-stage counts are small enough that displaying them reads as "dead." The principle is **lead with mission and invitation, reveal a number only when it flatters**. Gating is purely a display concern — every endpoint still computes and returns the real counts (members and internal/admin views use them); the hub just withholds the *display* below each floor. Floors are constants (single source, easy to tune as the club grows), not hardcoded at call sites.

| Element | Below floor (display) | Floor | At/above floor |
|---|---|---|---|
| Per-area **project count** on Action Area cards | hide the number; show a "Get involved →" CTA | **≥ 3 projects** | render "N projects" |
| **Active Projects rail** | render projects as named *opportunities* (no count header); suppress the rail entirely at 0 active projects | n/a (qualitative) | unchanged |
| **"This Month" impact strip** | suppress (no single-item strip) | **≥ 2 curated entries** in the ET month | render the strip |
| **Member counts** (anywhere public) | never displayed | **≥ 100 members** | only then consider surfacing |

Notes:
- The floors apply to the **public + member hub display**. The `/api/community/areas`, `/projects`, and `/impact` endpoints return real counts regardless; the hub template (and any future admin view) decides whether to render them.
- This composes with the zero-active-areas fallback: zero areas → legacy feed; some areas but sub-floor counts → areas/projects render with qualitative framing, numbers hidden.
- Floors are tunable; revisit when membership/projects materially grow.

## Surfaces (Astro, on rrmacademy.org)

| Route | File | Notes |
|---|---|---|
| `functions/_middleware.js` | (modified) | Carve `/community` + `/community/areas/*` out of `needsAuth`; re-scope guard invariant; `guard:update`. |
| `/community/` | `src/pages/community/index.astro` (modified) | Impact strip + Action Areas row + Active Projects rail above the consolidated stream; pills + chips; logged-out join gate in the stream slot. |
| `/community/areas/[slug]` | `src/pages/community/areas/[...slug].astro` (new) | Area detail: projects + impact + a filtered slice of the same stream. **Archived-area slug → 404** (consistent with `/areas` listing active only). `noindex` until the area has min content (mirror the `word_count` thin-page pattern — open item). |
| `/community/post/[id]` | existing | Post shows its area chip only when the chip's area resolves to an `active` area. |

## Data model

One additive migration on D1 `rrm-auth`: **`migrations/024-stuc-action-areas.sql`** (re-confirm `ls migrations/ | tail -1` at plan time — `022` is taken; the realtime STUC spec also targets a number, coordinate). New tables + one nullable column on `community_post`. **Before this migration**, reconcile `schema.sql`'s `community_post` DDL to live prod (add `title`, `body`, `slug`, `og_image_url`) in the same PR so the mirror stops lying.

**FK note:** D1 does not run `PRAGMA foreign_keys = ON`. Every `REFERENCES` below is **decorative** — referential integrity is enforced at the app layer (validators) and at read time (active-parent joins), never by the DB. Do not rely on FK enforcement anywhere.

```sql
CREATE TABLE IF NOT EXISTS action_area (
    id            TEXT PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    tagline       TEXT,
    description   TEXT,
    icon          TEXT,
    bucket        TEXT NOT NULL CHECK (bucket IN ('research','advocacy','education','community')),
    owner_user_id TEXT REFERENCES user(id),       -- NULL until resolved to a real user.id
    sort_order    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project (
    id            TEXT PRIMARY KEY,
    area_id       TEXT NOT NULL REFERENCES action_area(id),
    slug          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    title         TEXT NOT NULL,
    summary       TEXT,
    description   TEXT,
    status        TEXT NOT NULL DEFAULT 'recruiting'
                  CHECK (status IN ('recruiting','in_progress','paused','done','archived')),
    owner_user_id TEXT REFERENCES user(id),
    workspace_url TEXT,                            -- http/https only, validated via isSafeUrl() on write
    pinned        INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS area_membership (
    user_id   TEXT NOT NULL REFERENCES user(id),
    area_id   TEXT NOT NULL REFERENCES action_area(id),
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','lead','owner')),
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, area_id)
);

CREATE TABLE IF NOT EXISTS project_membership (
    user_id    TEXT NOT NULL REFERENCES user(id),
    project_id TEXT NOT NULL REFERENCES project(id),
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','lead','owner')),
    joined_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS impact_entry (
    id          TEXT PRIMARY KEY,
    area_id     TEXT REFERENCES action_area(id),
    project_id  TEXT REFERENCES project(id),
    kind        TEXT NOT NULL CHECK (kind IN ('webinar','research','advocacy','legal','milestone')),
    title       TEXT NOT NULL,
    detail      TEXT,
    occurred_on TEXT NOT NULL,                     -- ISO 8601 date
    created_by  TEXT REFERENCES user(id),
    created_at  TEXT DEFAULT (datetime('now'))
);

-- additive column on the existing feed table; nothing dropped
ALTER TABLE community_post ADD COLUMN area_id TEXT REFERENCES action_area(id);

CREATE INDEX IF NOT EXISTS idx_action_area_status     ON action_area(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_area           ON project(area_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_status         ON project(status, pinned, sort_order);
CREATE INDEX IF NOT EXISTS idx_area_membership_area   ON area_membership(area_id);
CREATE INDEX IF NOT EXISTS idx_area_membership_user   ON area_membership(user_id);     -- "my areas" lookup
CREATE INDEX IF NOT EXISTS idx_project_membership_p   ON project_membership(project_id);
CREATE INDEX IF NOT EXISTS idx_project_membership_u   ON project_membership(user_id);  -- "my projects" lookup
CREATE INDEX IF NOT EXISTS idx_impact_area            ON impact_entry(area_id, occurred_on);
-- per-area pill filter only (NOT the default All-stream query, which uses idx_community_post_channel)
CREATE INDEX IF NOT EXISTS idx_community_post_area     ON community_post(area_id, created_at) WHERE area_id IS NOT NULL;
```

**SQL discipline & invariants:**
- `slug` UNIQUE columns carry `COLLATE NOCASE`. **Reserved-slug blocklist** for `action_area.slug` AND `project.slug`: `areas`, `events`, `members`, `post` (avoid shadowing existing `/community/*` routes). All slug resolution is **table-scoped** (an area and a project may not be resolved by a shared slug-keyed map — query the specific table).
- Enums use `CHECK (… IN (…))` — the one constraint class D1 actually enforces (FKs are inert). Endpoints also allowlist-validate before write.
- Membership INSERTs are idempotent: `ON CONFLICT (user_id, area_id) DO NOTHING` / `(user_id, project_id) DO NOTHING`. The endpoint returns whether a row was newly created (`meta.changes`) so the UI can distinguish "joined now" from "already a member".
- `area_id` on `community_post` is nullable. The **"All" stream query has no area predicate** (so NULL-area posts always appear); the `?area=` predicate (`AND p.area_id = ?`) is appended **only when the param is present and resolves to an active area**.
- **Active-parent resolution (the integrity backbone, since FKs are inert):** every read path that surfaces a child of an area — the projects rail, per-post area chips, area-filtered queries, impact strip — resolves through `LEFT JOIN action_area a ON a.id = <child>.area_id AND a.status='active'` and treats a NULL/archived/missing parent as **untagged** (post still shows under All; chip drops). This makes the "every `area_id` is NULL or references an existing active area" invariant robust without depending on cleanup batches.
- D1 does not honor `ON DELETE CASCADE`. **Archiving is a status flip** (`action_area.status='archived'`, and the area's projects flip to `project.status='archived'` in the same `db.batch()`). A **hard delete** (admin, rare) must run an explicit `db.batch()`: delete `project_membership` for the area's projects → delete `project` → delete `area_membership` → delete `impact_entry` → set `community_post.area_id = NULL` where it matched → delete `action_area`. Hard **project** delete: `db.batch()` delete `project_membership` → null `impact_entry.project_id` → delete `project`.
- Dates stored ISO 8601 only. "This month" windows computed in **America/New_York** (see §Impact rollup) per the standing ET reporting rule.

## Endpoints (`functions/api/community/` and `functions/api/admin/community/`)

All endpoints return the **community-sibling shape `{ ok: true, ... }` / `{ ok: false, error: 'code' }`** (match `posts.js`/`members.js`/`status.js` and the hub JS that branches on `data.ok` — NOT the generic `{ results }` standard). Read siblings first. Dispatch the **`coder` agent** — do not hand-write endpoint code.

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/community/areas` | GET | public | Active areas + per-area project count via a **single `LEFT JOIN project … GROUP BY action_area.id`** (zero-project areas still render with count 0). When the caller is authenticated, include `isMember` per area. **The count is always returned; the hub display-gates it per §Sparse-state display gating (G-AREA-12).** |
| `/api/community/projects` | GET | public | Projects, `JOIN action_area … WHERE action_area.status='active'`. Filterable `?area=`/`?status=`. Include `isMember` when authed. |
| `/api/community/memberships` | GET | member | The caller's `area_membership` + `project_membership` (drives "Joined ✓" state on cold load). |
| `/api/community/areas/join` | POST | member | `area_membership` upsert `ON CONFLICT DO NOTHING`; returns `{ ok:true, joined:<bool from meta.changes>, alreadyMember:<bool> }`. Rejects archived areas (400). |
| `/api/community/areas/leave` | POST | member | Delete the caller's `area_membership` row. |
| `/api/community/projects/join` | POST | member | `project_membership` upsert `ON CONFLICT DO NOTHING`; same return shape. Rejects archived/done projects (400). |
| `/api/community/projects/leave` | POST | member | Delete the caller's `project_membership` row. |
| `/api/community/impact` | GET | public | "This Month" curated `impact_entry` rows for the current month **computed in America/New_York**. (Auto-counted events = Phase 2.) |
| `/api/admin/community/areas` | POST/PUT/DELETE | admin | Area CRUD. DELETE = **archive flip + child propagation** (`db.batch()`: flip area + its projects to `archived`). Role check per the `functions/api/admin/faqs/[id].js` pattern (admin `_middleware.js` does NOT enforce). |
| `/api/admin/community/projects` | POST/PUT/DELETE | admin | Project CRUD. DELETE = **archive flip** (`status='archived'`). Hard delete (separate flag) runs the `project_membership`/`impact_entry` cleanup batch. |
| `/api/admin/community/impact` | POST/PUT/DELETE | admin | Impact entry CRUD. |
| `/api/community/posts` (existing) | GET/POST | member | GET: add `?area=<slug>` filter — resolve to an **active** `action_area.id` (reuse `validateAreaId()`); unknown/archived → fall through to All (documented). Add `areaId` to the row mapper. POST: accept optional `area_id`, validate it exists **AND** `status='active'` (G-AREA-3); bad/archived → 400 (`{ ok:false, error:'invalid_area_id' }`, host-file shape). Add `areaId` to the POST response so the optimistic chip renders. |

**Validation helpers** (in `functions/api/community/_shared.js`, kept DRY): `validateAreaId(env, id)` (exists + active) used by `posts.js` POST and all admin write paths that carry an `area_id`/`project_id`; `isSafeUrl(workspace_url)` (http/https only) on project write — reject otherwise (400); render `workspace_url` with `rel="noopener" target="_blank"` + HTML-escape.

Standard rules: missing binding → 503, never silent 200. Public endpoints touching billed services get IP rate limiting (none here do).

## Seed data

Seed migration creates the initial Action Areas from Recording 129. **Owner resolution is a separate idempotent UPDATE, never part of the DO-NOTHING insert:**

1. `INSERT … ON CONFLICT (slug) DO NOTHING` the areas with `owner_user_id = NULL`.
2. For each known owner, run `UPDATE action_area SET owner_user_id = (SELECT id FROM user WHERE … ) WHERE slug = ? AND owner_user_id IS NULL` — only when the name resolves to **exactly one** verified `user.id`. If it resolves to 0 or >1 rows, leave NULL and log. Never store a display-name string in `owner_user_id`.

| Action Area | Bucket | Owner |
|---|---|---|
| Research | research | Bailey (resolve to user.id) |
| Patient Advocacy | advocacy | TBC (seed NULL until known) |
| Education | education | TBC |
| Community | community | TBC |

Re-running the seed after an owner finally registers requires the standalone UPDATE (step 2) — the `ON CONFLICT DO NOTHING` insert will not backfill it.

## Impact rollup

- **Phase 1 = owner-curated `impact_entry` rows only.** `/impact` returns curated rows whose `occurred_on` falls in the current month **in America/New_York** (compute the `YYYY-MM` window after applying the ET offset — D1's `strftime('now')` is UTC and would flip a month early for ~4-5 evening ET hours at each boundary).
- **"Auto-counted tagged events" is Phase 2.** There is no computable source in v1: `community_post` has no `kind`/completed signal, and `type='event'` `event_date` is a *future* schedule, not an occurred count. Defining the count source is a Phase 2 task.

## Phases

- **Phase 1 (this spec):** middleware carve-out + schema reconcile + migration (tables, `community_post.area_id`, CHECK enums, indexes), hub redesign (impact strip + areas row + projects rail + consolidated chat-style stream with pills/chips + logged-out join gate), area detail pages, member join/leave + memberships read, staff CRUD with archive propagation, curated impact, seed with owner-resolution UPDATE.
- **Phase 2 (deferred):** per-area dedicated channel views (only if volume justifies); auto-counted impact analytics; project workspace provisioning automation.

## Files changed (inventory — for the implementation plan)

- **Schema baseline:** DONE 2026-05-25 — `schema.sql` regenerated from live (`rrm-auth`, 59 tables, 108 indexes), so the mirror is now authoritative for fresh provisioning + the `/arise` R3 UNIQUE-constraint reference. (Separate, optional: a `migrations/`-replay-from-scratch path would still lack the out-of-band `community_post` columns — only matters if anyone provisions a brand-new DB via migration replay rather than `--file=schema.sql`; not blocking this work.)
- **New migration:** `migrations/024-stuc-action-areas.sql` (tables + `community_post.area_id` + CHECK enums + indexes). Re-confirm the number at plan time.
- **Schema mirror:** after the migration applies, regenerate `schema.sql` from live again (same one-liner in the file header) so it stays faithful.
- **Middleware:** `functions/_middleware.js` (carve-out) + `npm run guard:update` + guard-invariant re-scope.
- **New endpoints:** `functions/api/community/{areas,projects,memberships,impact}.js`, `functions/api/community/areas/{join,leave}.js`, `functions/api/community/projects/{join,leave}.js`; `functions/api/admin/community/{areas,projects,impact}.js`.
- **Modified:** `functions/api/community/posts.js` (accept + validate `area_id`, add `areaId` to mapper + response, `?area=` filter). **Coordinate with the realtime STUC spec** — it also modifies the `posts.js` DELETE handler (`stuc_meeting` cleanup). Whoever lands second reads the current `posts.js:612` batch and produces ONE combined cleanup; do not append blindly. `posts.js` is a guarded file.
- **Modified:** `functions/api/community/_shared.js` (`validateAreaId()`, reuse `isSafeUrl()`).
- **New page:** `src/pages/community/areas/[...slug].astro` (archived slug → 404).
- **Modified page:** `src/pages/community/index.astro` (impact strip, areas row, projects rail, stream restyle + pills + chips + logged-out join gate).
- **Security guard:** new files under `functions/api/admin/` + the `_middleware.js` change require `guard-manifest.json` review + `npm run guard:update`. New admin endpoints join the guarded set.
- **Design:** read `docs/design/design-system.json` before any hub CSS; existing tokens only.

## Rollout

- Reconcile migration → additive feature migration (no data loss; existing feed untouched).
- **Pre-apply check:** run `SELECT name FROM sqlite_master WHERE type='table'` against live `rrm-auth` and confirm none of `action_area`/`project`/`area_membership`/`project_membership`/`impact_entry` exist (`CREATE TABLE IF NOT EXISTS` would silently no-op against a pre-existing `project` — generic name, real collision risk).
- Feature degrades gracefully: area furniture (pills/chips/rails) renders only when `action_area` has active rows; otherwise the verbatim legacy feed.
- **Rollback contract:** rollback = leave `community_post.area_id` in place (nullable, inert) and disable the feature via the empty-`action_area` server check; **never `DROP COLUMN`**. If a hard drop is ever required, `DROP INDEX idx_community_post_area` first, then `ALTER TABLE community_post DROP COLUMN area_id`. New tables are trivially droppable.
- Standard `claude/` branch → CI auto-build + merge. Verify hub render in claude-in-chrome at desktop + mobile (393×852), **logged-out and logged-in**, before done.

## Proof gates (to formalize in the implementation plan)

| Gate | Asserts |
|---|---|
| G-AREA-1 | The default "All" stream query has NO `area_id` predicate (NULL-area posts always included); the `?area=` predicate is conditional. |
| G-AREA-2 | Area + project join INSERTs are idempotent (`ON CONFLICT DO NOTHING`); double-join returns success with `joined:false`, not 500. |
| G-AREA-3 | `area_id` on a new post is validated to exist **AND** be `status='active'`; bad/archived → 400. Same check in `validateAreaId()`. |
| G-AREA-4 | Logged-out GET of `/community/` returns 200 and renders structure (areas/projects/impact); the stream slot shows the join gate (NOT a 302 to /login). Requires the `_middleware.js` carve-out. |
| G-AREA-5 | Admin endpoints replicate the `functions/api/admin/faqs/[id].js` role check (admin `_middleware` does not enforce); member endpoints go through `requireMember()`. |
| G-AREA-6 | Migration is additive: live `community_post` (via `PRAGMA table_info`, NOT `schema.sql`) retains all existing columns + rows; no DROP. |
| G-AREA-7 | All child read paths (projects rail, post chips, `?area=` filter, impact) resolve through `LEFT JOIN action_area … AND status='active'`; an archived/missing parent renders as untagged (no row drop from All). |
| G-AREA-8 | Every non-null `action_area.owner_user_id` / `project.owner_user_id` matches a `user.id`; owners are resolved via the standalone UPDATE, never stored as name strings. |
| G-AREA-9 | All enum columns (`bucket`, both `status` enums, `kind`, `role`) carry `CHECK (… IN (…))`; endpoints allowlist-validate before write. |
| G-AREA-10 | New endpoints return `{ ok: true, … }`/`{ ok: false, error }` (sibling shape), not `{ results }`; hub JS branching on `data.ok` works. |
| G-AREA-11 | "This Month" window is computed in America/New_York (not UTC). |
| G-AREA-12 | Sparse-state display gating: the hub hides per-area project counts below 3, the impact strip below 2 curated entries, and member counts below 100 (see §Sparse-state display gating). APIs still return the real counts; only the hub display is gated, via tunable floor constants in one place. |

## Open items for the implementation plan

1. Confirm the final Action Area set, taglines, icons, and real owner user IDs (Recording 129 firmly names Research → Bailey; Patient Advocacy owner TBC).
2. Decide the indexability of area detail pages (likely `noindex` until a min-content threshold, mirroring `word_count`).
3. Workspace URL handling: open in new tab (`rel="noopener"`); confirm whether Google Group/Doc links need access provisioning on join.
4. Whether `/save-the-uterus-club/` landing copy should point to Action Areas as the "what you'll do" proof (separate copy task, mockup-gated).
5. Coordinate migration number + `posts.js` DELETE-handler edit sequencing with the realtime STUC spec owner.
6. Phase 2: define the "auto-counted tagged events" source query for the impact strip.
