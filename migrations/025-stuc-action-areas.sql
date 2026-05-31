-- 025-stuc-action-areas.sql
-- STUC Action Areas hub — additive migration on rrm-auth (D1).
-- Spec: docs/superpowers/specs/2026-05-25-stuc-action-areas-hub-design.md (v3, §Data model)
-- Plan: docs/superpowers/plans/2026-05-27-stuc-action-areas-hub-implementation.md (Phase 1)
--
-- ADDITIVE ONLY: 5 new tables + one nullable column on the existing community_post feed
-- + 9 indexes. Nothing is dropped. Existing feed posts keep working (area_id defaults NULL).
--
-- Pre-apply collision check (Phase 1.1) PASSED against live rrm-auth on 2026-05-29:
--   SELECT name FROM sqlite_master WHERE type='table'
--     AND name IN ('action_area','project','area_membership','project_membership','impact_entry')
--   -> 0 rows. None of these table names pre-exist (the generic 'project' name was the
--      collision risk; confirmed clear). CREATE TABLE IF NOT EXISTS is therefore safe.
--
-- FK NOTE: D1 does NOT run PRAGMA foreign_keys = ON. Every REFERENCES below is DECORATIVE.
-- Referential integrity is enforced at the app layer (validators) and at read time
-- (active-parent LEFT JOINs). Do not rely on FK enforcement anywhere. ON DELETE CASCADE
-- would also be inert — none is declared; deletes are explicit db.batch() cleanups in code.
--
-- ROLLBACK (autonomous): NEVER DROP COLUMN community_post.area_id (leave nullable/inert).
-- To disable: drop the 5 tables + idx_community_post_area (see plan §Pre-execution contract);
-- the hub self-disables via the empty-action_area server check (zero active rows -> legacy feed).

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
