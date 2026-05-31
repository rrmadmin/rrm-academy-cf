-- 027-stuc-ownership-requests.sql
-- STUC Action Areas — member "volunteer to lead" requests (admin-approved ownership).
-- Plan: docs/superpowers/plans/2026-05-27-stuc-action-areas-hub-implementation.md (Phase 10)
--
-- Members can volunteer to lead an OWNERLESS active area. A request is filed here as
-- 'pending'; an admin approves exactly one, which sets action_area.owner_user_id +
-- area_membership(role='owner') and auto-rejects the other pending requests for that area.
--
-- ADDITIVE ONLY: 1 new table + 2 indexes. Nothing else changes.
-- FK NOTE: D1 does NOT enforce foreign keys — REFERENCES below are decorative; integrity
-- is enforced in the app layer (validators + active-parent checks). No CASCADE relied upon.
-- ROLLBACK (autonomous): DROP TABLE area_ownership_request (no other table references it).
--
-- IDEMPOTENT re-volunteer: UNIQUE(area_id, user_id) means one row per member per area; a
-- member who withdraws/was rejected and volunteers again UPSERTs the same row back to
-- 'pending' (see functions/api/community/areas/volunteer.js).

CREATE TABLE IF NOT EXISTS area_ownership_request (
    id          TEXT PRIMARY KEY,
    area_id     TEXT NOT NULL REFERENCES action_area(id),
    user_id     TEXT NOT NULL REFERENCES user(id),
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','withdrawn')),
    message     TEXT,                              -- optional "why me" note, capped app-side
    created_at  TEXT DEFAULT (datetime('now')),
    decided_at  TEXT,                              -- set when an admin approves/rejects
    decided_by  TEXT REFERENCES user(id),          -- admin user.id who decided
    UNIQUE (area_id, user_id)
);

-- Admin queue: pending-first lookups by area.
CREATE INDEX IF NOT EXISTS idx_aor_status_area ON area_ownership_request(status, area_id);
-- Member "my pending requests" lookup.
CREATE INDEX IF NOT EXISTS idx_aor_user ON area_ownership_request(user_id);
