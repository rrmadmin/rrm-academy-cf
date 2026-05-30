# STUC Action Areas Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STATUS: EXECUTION AUTHORIZED for Phases 1-7 (2026-05-29).** Brian confirmed: Action Area launch set = the 4 buckets, spec-default floors, build now and seed last. **Phase 8 (seed) remains BLOCKED** pending Naomi's final Action Area copy + non-Research owner `user.id`s (D0-1/D0-2 content). Read the Execution Addendum below before starting any task — it supersedes stale anchors in the prep-plan body (migration number, `_middleware.js` line numbers, `posts.js` DELETE line, `isSafeUrl` location).

## Execution Addendum (2026-05-29) — Phase 0 resolution + verified drift corrections

A 6-agent verification sweep ran the v3 spec against current `main` (2026-05-29). The Phase 0 answers and corrections below are **authoritative wherever they conflict with the prep-plan body**.

**Phase 0 — resolved:**
- **D0-1 (Action Area set):** Launch with the **4 buckets as the Action Areas** — Research, Patient Advocacy, Education, Community. Taglines/icons drafted for Brian's review (not Naomi-blocking). Finer-grained nested areas deferred.
- **D0-2 (Owners):** Research → Bailey (resolve to her verified `user.id`); Patient Advocacy / Education / Community → seed `NULL` until Naomi names them.
- **D0-3 (Floors):** Spec defaults confirmed — project count ≥ 3, impact strip ≥ 2 entries/ET-month, member counts ≥ 100.
- **D0-6 (Migration number):** **025** (NOT 024 — `024-p0-community-stripe-indexes.sql` already landed). Seed migration = **026**. Re-run `ls migrations/ | sort | tail` at apply time to confirm 025 still free.
- **D0-7 (Parallel session):** OPEN — confirm the other CC instance (STUC/community lane) is parked before Phase 2/5/6 touch `_middleware.js` / `posts.js` / `community/index.astro`. This work runs in an isolated worktree off `origin/main`.
- **D0-4 / D0-5 / D0-8:** unchanged; resolve by their phase.

**Verified drift corrections (supersede the body):**
1. **Migration = 025, seed = 026** (everywhere the body says 024 / 025-seed).
2. **`_middleware.js` line anchors are stale.** The `needsAuth` predicate is at **lines 317-322** (line 320 matches `/community` exact + `/community/*`), NOT ~300. The body's "~line 186" is a DIFFERENT matcher — the AI-bot Analytics-Engine suppression list inside `sendAiBotEvent()` at **lines 184-189**, NOT auth. The carve-out edits **only 317-322**. SEPARATE decision (recommend yes): also drop `/community` + `/community/areas` from the AE suppression list (184-189) so the now-public pages get crawl analytics.
3. **Guard `/community` invariant is a loose substring check** (`scripts/guard.mjs` ~170-191: `middleware.includes('/community')`). It will NOT trip on the carve-out (the literal string survives elsewhere) and gives ZERO behavioral protection. Re-scoping the comment is cosmetic — the real protection is a new **e2e test** asserting logged-out `/community/` → 200 while `/community/events|members|post/*` → 302. Add it in Phase 2.
4. **`posts.js` DELETE batch is at lines 675-682** (`_handleDelete`, handler 636-698), NOT 612. **Action Areas adds NO deletes to that batch** (it relies on active-parent JOINs at read time and only nulls `area_id` on a rare admin hard-delete via the separate admin endpoints). The ONLY edit to that batch is realtime-STUC's `stuc_meeting` cleanup. Realtime is unbuilt; if it lands first its deletes go BEFORE the final `DELETE FROM community_post` inside the existing `db.batch()`. Coordination risk LOW (disjoint tables). Phase 5 here adds only `?area=` GET filter + POST `area_id` validation + `areaId` mapper — it does NOT touch the DELETE batch.
5. **`isSafeUrl()` is posts.js-local (lines 28-35), NOT a `_shared.js` export.** Phase 3.1 must HOIST it into `_shared.js` (alongside the new `validateAreaId`), then re-import from `posts.js`. Do not assume it is already shared.
6. **Live D1 collision pre-check (Phase 1.1) needs CF auth.** Wrangler is unauthenticated in subagents and 1P token sourcing is classifier-blocked there; run the `SELECT name FROM sqlite_master … IN ('action_area','project',…)` from the main interactive session (token via 1P) BEFORE writing/applying the migration. `schema.sql` (regenerated from live 2026-05-27, 60 tables) shows none of the 5 tables and no `community_post.area_id`, but the generic `project` name still demands the live check.

**Goal:** Turn `/community/` from a lecture-driven feed into a "do tank" hub where Save the Uterus Club members self-sort into Action Areas and projects, with the early-stage small numbers hidden behind growth thresholds.

**Architecture:** Additive D1 migration (5 new tables + one nullable `community_post.area_id`) on `rrm-auth`; a `_middleware.js` carve-out so the hub structure is a logged-out recruiting surface while live conversation stays members-only; new public + member + admin community endpoints (sibling `{ ok, ... }` shape); the existing `community/index.astro` hub restyled into one consolidated chat-style stream with Action Areas furniture layered on top; display of counts gated behind "looks healthy" floors.

**Tech Stack:** Astro (static pages on rrmacademy.org) + Cloudflare Pages Functions + D1 (`rrm-auth`). No new dependencies. Endpoint code dispatched through the `coder` agent per spec.

**Source spec:** `docs/superpowers/specs/2026-05-25-stuc-action-areas-hub-design.md` (v3). Read it in full before executing. This plan sequences that spec; the spec is authoritative on contracts and proof gates.

---

## Phase 0 — Decisions Required Before Execution (design NOT locked)

These are decisions, not code tasks. Resolve each with Brian (and Naomi where noted) and record the answer back into the spec before starting Phase 1. Tasks that depend on a decision name it explicitly.

- [ ] **D0-1 — Action Area set + copy.** Final list of Action Areas with `name`, `slug`, `tagline`, `icon`, `bucket` (one of research/advocacy/education/community), `sort_order`. Spec firmly names only **Research** (bucket research). Source: Recording 129 + Naomi. Blocks: Phase 8 seed.
- [ ] **D0-2 — Owners.** Real `user.id` for each area owner. Firm: **Research → Bailey** (resolve to her verified `user.id`). Patient Advocacy / Education / Community owners TBC — seed `NULL` until known. Blocks: Phase 8 seed owner-resolution UPDATE.
- [ ] **D0-3 — Sparse-state floors.** Spec v3 proposes: project count shown at ≥3, impact strip at ≥2 entries/month, member counts at ≥100. Confirm or adjust. These become the floor constants in Phase 6. (Tunable later, but pick the launch values.)
- [ ] **D0-4 — Area detail page indexability.** `noindex` until a min-content threshold (mirror the `word_count` thin-page pattern), or always-index? Affects Phase 7.
- [ ] **D0-5 — Workspace URL handling.** Do project `workspace_url` links (Google Group/Doc) need access provisioning when a member joins, or are they open links? v1 assumes open links opened with `rel="noopener" target="_blank"`. Confirm. Affects Phase 4 + 6.
- [ ] **D0-6 — Migration number + `posts.js` DELETE coordination.** Confirm `024` is free at execution time (`ls migrations/ | tail -1`; currently `023`). The realtime-STUC plan (`docs/superpowers/plans/2026-05-17-cloudflare-realtime-stuc-implementation.md`) also targets a migration number AND edits the `posts.js` DELETE handler (`stuc_meeting` cleanup). Whoever lands second must read the current `posts.js` batch and produce ONE combined cleanup. Decide ordering.
- [ ] **D0-7 — Parallel session parked.** This work hits `community/index.astro`, `posts.js`, `_middleware.js`, `schema.sql`, and adds a migration — all high-collision with the other Claude instance that owns the STUC/community lane. Confirm that session is parked before Phase 1.
- [ ] **D0-8 — `/save-the-uterus-club/` landing copy** (optional, separate, mockup-gated): should the public join page point at Action Areas as the "what you'll do" proof? Out of scope for this plan unless Brian wants it folded in.

**Gate:** do not proceed past Phase 0 until D0-1, D0-2, D0-3, D0-6, D0-7 are answered. D0-4, D0-5, D0-8 can be resolved by the time their phase runs.

---

## File Structure / Inventory

**New files:**
- `migrations/025-stuc-action-areas.sql` — tables + `community_post.area_id` + CHECK enums + indexes (024 is taken; confirm 025 free at apply time).
- `migrations/026-stuc-action-areas-seed.sql` (or run via admin endpoints) — seed areas + owner-resolution UPDATE. Blocked on D0-1/D0-2 content (Naomi).
- `functions/api/community/areas.js` — GET public: active areas + gated project count.
- `functions/api/community/projects.js` — GET public: projects joined to active areas.
- `functions/api/community/memberships.js` — GET member: caller's area + project memberships.
- `functions/api/community/areas/join.js`, `functions/api/community/areas/leave.js` — POST member.
- `functions/api/community/projects/join.js`, `functions/api/community/projects/leave.js` — POST member.
- `functions/api/community/impact.js` — GET public: curated `impact_entry` for the current ET month.
- `functions/api/admin/community/areas.js`, `.../projects.js`, `.../impact.js` — admin CRUD, self-checked role (admin `_middleware.js` does not enforce).
- `src/pages/community/areas/[...slug].astro` — area detail page (archived slug → 404).
- `src/lib/stuc-display-floors.ts` (NEW, single source) — the sparse-state floor constants for D0-3.

**Modified files:**
- `functions/_middleware.js` — carve `/community` (exact) + `/community/areas` + `/community/areas/*` out of `needsAuth` (**lines 317-322 only**; the "~line-186" reference was the AE-suppression matcher at 184-189, see Addendum #2); optionally also drop them from the AE suppression list (184-189); re-scope the guard comment + add an e2e gating test (Addendum #3); `npm run guard:update`. **Hash-guarded file.**
- `functions/api/community/posts.js` — accept + validate optional `area_id` (exists AND active), `?area=` filter (no predicate on All), add `areaId` to mapper + POST response. **Hash-guarded file. Coordinate DELETE with realtime-STUC (D0-6).**
- `functions/api/community/_shared.js` — add `validateAreaId(env, id)` (exists + active); reuse `isSafeUrl()`.
- `src/pages/community/index.astro` (~86 KB) — impact strip + Action Areas row + Active Projects rail above a consolidated chat-style stream; filter pills; per-post area chips; logged-out join gate in the stream slot; sparse-state display gating from `stuc-display-floors`.
- `schema.sql` — reconcile `community_post` DDL to live BEFORE the migration (it should already be reconciled per spec §Files changed 2026-05-25 — verify), then regenerate from live AFTER the migration applies.
- `guard-manifest.json` — regenerate (`npm run guard:update`) after touching `_middleware.js` + `posts.js` + adding guarded admin endpoints.

---

## Phase 1 — Schema reconcile + additive migration

**Files:** `migrations/025-stuc-action-areas.sql` (create), `schema.sql` (verify/regenerate).

- [ ] **1.1 — Pre-apply collision check.** Run against live `rrm-auth`:
  `wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('action_area','project','area_membership','project_membership','impact_entry')"`
  Expected: zero rows. `CREATE TABLE IF NOT EXISTS` would silently no-op against a pre-existing generic `project` — abort if any exist.
- [ ] **1.2 — Confirm migration number** (`ls migrations/ | sort | tail -1`; expect `024-p0-community-stripe-indexes.sql`, use `025`).
- [ ] **1.3 — Write `migrations/025-stuc-action-areas.sql`** with the exact DDL from the spec §Data model (verbatim — the 5 `CREATE TABLE IF NOT EXISTS`, the `ALTER TABLE community_post ADD COLUMN area_id`, and all 9 indexes). Key invariants baked into the DDL: `slug … UNIQUE COLLATE NOCASE`, every enum a `CHECK (… IN (…))`, FKs are decorative (D1 ignores them).
- [ ] **1.4 — Apply to a local/preview D1 first**, then verify `PRAGMA table_info(community_post)` shows `area_id` added and all existing columns retained (G-AREA-6).
- [ ] **1.5 — Apply to remote** `rrm-auth` once verified.
- [ ] **1.6 — Regenerate `schema.sql` from live** (one-liner in the file header) so the mirror stays faithful. Commit migration + schema together.

**Proof gates this phase must satisfy:** G-AREA-6 (additive, no DROP, existing rows/columns retained), G-AREA-9 (all enum columns carry CHECK).

**Rollback contract:** never `DROP COLUMN`; disable via the empty-`action_area` server check. New tables are trivially droppable.

---

## Phase 2 — Middleware carve-out + guard re-scope

**Files:** `functions/_middleware.js` (modify, hash-guarded), `guard-manifest.json` (regenerate).

- [ ] **2.1 — Read the current `needsAuth` predicate** (lines **317-322**; line 320 matches `/community` exact + `/community/*`). Per Addendum #2, the older "~line-186" note is the AE-suppression matcher (184-189), NOT auth — do not edit it for the carve-out (decide the AE-list separately).
- [ ] **2.2 — Carve out the public paths:** `/community` (exact), `/community/areas`, `/community/areas/*` become public. KEEP gated: `/community/events`, `/community/members`, `/community/post/*`, and the live-stream/compose/join APIs.
- [ ] **2.3 — Re-scope the security-guard invariant.** The guard asserts `_middleware.js` must protect `/account` and `/community`. Re-scope the `/community` assertion to the genuinely member-only sub-paths (`/community/events`, `/community/members`, `/community/post`). Update `scripts/guard.mjs`'s Phase 2 check accordingly.
- [ ] **2.4 — `npm run guard:update`**, commit `_middleware.js` + `guard.mjs` (if changed) + `guard-manifest.json` together. Document the invariant change in the commit body.
- [ ] **2.5 — Verify G-AREA-4:** logged-out GET `/community/` returns 200 (not a 302 to `/login`). Defer the full render check to Phase 6.

**Proof gates:** G-AREA-4 (logged-out 200 on `/community/`), plus the security guard must stay green with the re-scoped invariant.

---

## Phase 3 — Read endpoints (public + member GETs)

**Files (create):** `functions/api/community/{areas,projects,memberships,impact}.js`. **Modify:** `functions/api/community/_shared.js` (`validateAreaId`).
**Dispatch the `coder` agent** — read `posts.js`/`members.js`/`status.js` siblings first; match the `{ ok: true, ... }` / `{ ok: false, error }` shape (G-AREA-10), NOT the generic `{ results }`.

- [ ] **3.1 — `_shared.js`: `validateAreaId(env, id)` + HOIST `isSafeUrl()`.** `validateAreaId` returns true only if the area exists AND `status='active'`; reused by `posts.js` POST and all admin writes carrying an `area_id`. Per Addendum #5, `isSafeUrl()` currently lives ONLY in `posts.js` (lines 28-35) — move it into `_shared.js` and re-import from `posts.js`, so areas/projects admin writes validate `workspace_url` from the shared helper.
- [ ] **3.2 — `GET /api/community/areas`** (public): active areas + per-area project count via a single `LEFT JOIN project … GROUP BY action_area.id` (zero-project areas render count 0). When authenticated, include `isMember` per area. Return the real count always (display gating is the hub's job, G-AREA-12).
- [ ] **3.3 — `GET /api/community/projects`** (public): `JOIN action_area … WHERE action_area.status='active'`; filterable `?area=` / `?status=`; include `isMember` when authed (active-parent resolution, G-AREA-7).
- [ ] **3.4 — `GET /api/community/memberships`** (member, `requireMember()`): caller's `area_membership` + `project_membership` rows (drives "Joined ✓" on cold load).
- [ ] **3.5 — `GET /api/community/impact`** (public): curated `impact_entry` whose `occurred_on` falls in the current month **computed in America/New_York** (apply ET offset before the `YYYY-MM` window — D1 `strftime('now')` is UTC and flips a month early for evening-ET boundary hours). G-AREA-11.
- [ ] **3.6 — Standard guards:** missing binding → 503 never silent 200; no billed services here so no rate limiting needed.

**Proof gates:** G-AREA-7 (active-parent joins), G-AREA-10 (sibling shape), G-AREA-11 (ET month).

---

## Phase 4 — Write endpoints (member join/leave + admin CRUD)

**Files (create):** `functions/api/community/areas/{join,leave}.js`, `functions/api/community/projects/{join,leave}.js`, `functions/api/admin/community/{areas,projects,impact}.js`. **`coder` agent.** New admin files are hash-guarded → `guard:update` at the end.

- [ ] **4.1 — `POST /api/community/areas/join`** (member): `area_membership` upsert `ON CONFLICT (user_id, area_id) DO NOTHING`; return `{ ok:true, joined:<meta.changes>0>, alreadyMember:<!joined> }`. Reject archived areas (400). G-AREA-2.
- [ ] **4.2 — `POST /api/community/areas/leave`** (member): delete the caller's `area_membership` row.
- [ ] **4.3 — `POST /api/community/projects/join`** (member): `project_membership` upsert `ON CONFLICT DO NOTHING`; same return shape. Reject archived/done projects (400).
- [ ] **4.4 — `POST /api/community/projects/leave`** (member): delete the caller's `project_membership` row.
- [ ] **4.5 — `POST/PUT/DELETE /api/admin/community/areas`** (admin): CRUD. Role check per `functions/api/admin/faqs/[id].js` (admin `_middleware` does NOT enforce). **DELETE = archive flip + child propagation** in ONE `db.batch()`: flip the area to `archived` AND its projects to `archived`. Hard delete (separate flag) runs the full cleanup batch from spec §SQL discipline. Validate `bucket`/`status` against allowlists; `isSafeUrl(workspace_url)`.
- [ ] **4.6 — `POST/PUT/DELETE /api/admin/community/projects`** (admin): CRUD; DELETE = `status='archived'` flip; hard delete runs `project_membership` + `impact_entry.project_id` null + `project` delete batch. Validate enums; `isSafeUrl(workspace_url)`.
- [ ] **4.7 — `POST/PUT/DELETE /api/admin/community/impact`** (admin): impact entry CRUD; validate `kind` enum + ISO `occurred_on`.
- [ ] **4.8 — `npm run guard:update`** for the new guarded admin files; commit with manifest.

**Proof gates:** G-AREA-2 (idempotent joins, double-join returns success not 500), G-AREA-5 (admin role self-check, member via requireMember), G-AREA-9 (enum allowlists), G-AREA-7 (archive propagation keeps children resolving as untagged).

---

## Phase 5 — `posts.js` area integration

**Files:** `functions/api/community/posts.js` (modify, hash-guarded). **Coordinate DELETE with realtime-STUC per D0-6.** `coder` agent.

- [ ] **5.1 — GET: add `?area=<slug>` filter.** Resolve to an active `action_area.id` via `validateAreaId`. The **All-stream query keeps NO area predicate** (NULL-area posts always appear, G-AREA-1); append `AND p.area_id = ?` only when `?area=` is present and resolves to an active area; unknown/archived → fall through to All (documented). Add `areaId` to the row mapper.
- [ ] **5.2 — POST: accept optional `area_id`**, validate exists AND active (`validateAreaId`, G-AREA-3); bad/archived → 400 `{ ok:false, error:'invalid_area_id' }` (host-file shape). Add `areaId` to the POST response for the optimistic chip.
- [ ] **5.3 — DELETE coordination (NO-OP for Action Areas):** per Addendum #4, Action Areas adds NO deletes to the `posts.js` DELETE batch (lines 675-682) — it relies on active-parent JOINs + nulls `area_id` only on admin hard-delete. Leave the DELETE batch untouched here. If realtime-STUC lands first, its `stuc_meeting` cleanup goes BEFORE the final `DELETE FROM community_post`; coordinate only then.
- [ ] **5.4 — `guard:update`** + commit with manifest.

**Proof gates:** G-AREA-1 (All has no area predicate), G-AREA-3 (post area_id validated active).

---

## Phase 6 — Hub page redesign + sparse-state gating

**Files:** `src/pages/community/index.astro` (modify, ~86 KB), `src/lib/stuc-display-floors.ts` (create). Read `docs/design/design-system.json` BEFORE any CSS — existing tokens only (the spacing scale skips `--space-7/9/11`; running `npm run design-tokens:audit` before push is mandatory — see memory `rrm-academy-cf-phantom-token-deploy-gate`).

- [ ] **6.1 — `stuc-display-floors.ts`:** export the floor constants from D0-3 (e.g. `PROJECT_COUNT_FLOOR = 3`, `IMPACT_STRIP_FLOOR = 2`, `MEMBER_COUNT_FLOOR = 100`). Single source; the hub imports these. (G-AREA-12 single-place requirement.)
- [ ] **6.2 — Impact strip** at top: render curated `/impact` rows only when count ≥ `IMPACT_STRIP_FLOOR`; else suppress entirely (no single-item strip).
- [ ] **6.3 — Action Areas row:** compact cards (icon · name · tagline). Show "N projects" only when N ≥ `PROJECT_COUNT_FLOOR`; below floor show a "Get involved →" CTA instead of the number.
- [ ] **6.4 — Active Projects rail:** render projects as named opportunities (no count header); suppress the rail at 0 active projects. `workspace_url` rendered `rel="noopener" target="_blank"`, HTML-escaped.
- [ ] **6.5 — Consolidated chat-style stream:** restyle the existing feed into ONE chat-style stream (composer on top), area filter pills, per-post area chip (chip shows only when its area resolves active, G-AREA-7). Default view = All (no predicate). Member counts never displayed below `MEMBER_COUNT_FLOOR`.
- [ ] **6.6 — Logged-out join gate:** for logged-out / non-member visitors, the stream slot renders a "Join to see the conversation" gate; structure (impact/areas/projects) renders from public GETs. Compose/join/stream APIs stay `requireMember()`.
- [ ] **6.7 — Zero-active-areas fallback:** when `action_area` has no active rows, suppress all area furniture (row, pills, chips, rail) and render the verbatim legacy feed; the chat restyle still ships.
- [ ] **6.8 — `npm run design-tokens:audit` (MUST pass)** + visual check deferred to Phase 9.

**Proof gates:** G-AREA-1, G-AREA-4 (logged-out render), G-AREA-7, G-AREA-12 (display gating + single-source floors).

---

## Phase 7 — Area detail page

**Files:** `src/pages/community/areas/[...slug].astro` (create).

- [ ] **7.1 — Render** one area's projects + impact + a filtered slice of the same stream (`?area=<slug>`). Archived/unknown slug → **404** (consistent with `/areas` listing active only).
- [ ] **7.2 — Indexability** per D0-4 (`noindex` until min content, mirroring `word_count`, or always-index).
- [ ] **7.3 — Reserved-slug safety:** area/project slugs are blocked from `areas`/`events`/`members`/`post` at write time (Phase 4 validation); confirm routing does not shadow existing `/community/*` routes.

**Proof gates:** active-parent resolution (G-AREA-7); reserved-slug blocklist (spec §SQL discipline).

---

## Phase 8 — Seed (BLOCKED on D0-1, D0-2)

**Files:** `migrations/026-stuc-action-areas-seed.sql` (or admin-endpoint seed). **BLOCKED on D0-1/D0-2 content (Naomi's final copy + non-Research owner user.ids).**

- [ ] **8.1 — Insert Action Areas** from D0-1 with `owner_user_id = NULL`: `INSERT … ON CONFLICT (slug) DO NOTHING`.
- [ ] **8.2 — Owner resolution as a SEPARATE idempotent UPDATE** (never part of the DO-NOTHING insert): for each known owner, `UPDATE action_area SET owner_user_id = (SELECT id FROM user WHERE …) WHERE slug = ? AND owner_user_id IS NULL` — only when the name resolves to **exactly one** verified `user.id`; 0 or >1 → leave NULL and log. Never store a display-name string. (G-AREA-8.)
- [ ] **8.3 — Re-run note:** after an owner later registers, re-running requires the standalone UPDATE (step 8.2); the DO-NOTHING insert won't backfill.

**Proof gates:** G-AREA-8 (owners are real user.ids via standalone UPDATE).

---

## Phase 9 — Verify + harden + deploy

- [ ] **9.1 — Proof-gate sweep:** confirm G-AREA-1 through G-AREA-12 (spec §Proof gates) each hold. Add the formal assertions to a test/e2e file where practical.
- [ ] **9.2 — `/arise --deep`** on the full changeset (auth + membership + D1 mutation surface → deep is the right default).
- [ ] **9.3 — Visual verify in claude-in-chrome at desktop + mobile (393×852), BOTH logged-out and logged-in.**
- [ ] **9.4 — `npm run design-tokens:audit`, `npm run check-types`, security guard green.**
- [ ] **9.5 — Deploy** via standard `claude/` branch → CI auto-build + merge. Verify the live hub renders both states. Confirm the migration applied to remote `rrm-auth` BEFORE the page deploy (or the page degrades to the zero-active-areas fallback gracefully).

---

## Self-review against the spec

- Spec coverage: middleware carve-out (P2), schema reconcile + migration (P1), all endpoints (P3/P4/P5), hub redesign + pills/chips/gate (P6), sparse-state gating v3 (P6 + `stuc-display-floors`), area detail (P7), seed + owner resolution (P8), proof gates G-AREA-1..12 (mapped per phase). Covered.
- Open items: D0-1..D0-8 capture the spec's six open items plus migration/posts.js coordination and the parallel-session collision.
- Deliberately NOT pre-written to keystroke level for each endpoint: the spec mandates dispatching the `coder` agent (reads siblings first), and the final endpoint bodies depend on D0 decisions (seed content, floors). Each endpoint task names its contract, auth, the critical query rule, and its proof gate — the `coder` agent fills the body against live siblings at execution time. This is intentional given the design is not yet locked.
