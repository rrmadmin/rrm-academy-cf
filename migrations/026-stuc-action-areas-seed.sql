-- 026-stuc-action-areas-seed.sql
-- STUC Action Areas SEED — the initial 4 Action Areas (= the strategic buckets).
-- Spec: docs/superpowers/specs/2026-05-25-stuc-action-areas-hub-design.md (§Seed data)
-- Plan: docs/superpowers/plans/2026-05-27-stuc-action-areas-hub-implementation.md (Phase 8)
--
-- ⚠️ STATUS: DRAFT — NOT APPLIED. Phase 8 is HUMAN-GATED.
-- The taglines/icons below are PROPOSED (drawn from the v3 mockup) for Brian + Naomi to
-- review/edit. Owners beyond Research are unset. DO NOT apply to remote rrm-auth until:
--   (1) Naomi confirms the final Action Area set + taglines + icons (D0-1), and
--   (2) the real owner user.ids are known (D0-2: Research → Bailey; others TBC).
-- Apply (controller, interactively, like migration 025):
--   wrangler d1 execute rrm-auth --remote --file=migrations/026-stuc-action-areas-seed.sql
--
-- IDEMPOTENT: INSERT ... ON CONFLICT(slug) DO NOTHING. Re-running won't duplicate or
-- clobber admin edits. Owner resolution is a SEPARATE idempotent UPDATE (below) — never
-- part of the DO-NOTHING insert, and only when a name resolves to EXACTLY ONE user.id.
-- Slugs avoid the reserved blocklist (areas/events/members/post). Readable ids are stable
-- so future project rows can reference them.

INSERT INTO action_area (id, slug, name, tagline, icon, bucket, sort_order, status, owner_user_id) VALUES
  ('area-research',         'research',         'Research',         'Turn clinical questions into published evidence.',                 '🔬', 'research',   1, 'active', NULL),
  ('area-patient-advocacy', 'patient-advocacy', 'Patient Advocacy', 'Change policy, access, and the public conversation.',              '🤝', 'advocacy',   2, 'active', NULL),
  ('area-education',        'education',        'Education',        'Build the courses, talks, and explainers patients actually find.', '📚', 'education',  3, 'active', NULL),
  ('area-community',        'community',        'Community',        'Welcome new members and keep the club alive between calls.',       '🌱', 'community',  4, 'active', NULL)
ON CONFLICT(slug) DO NOTHING;

-- ── Owner resolution (run AFTER the inserts, AFTER Bailey's user.id is known) ──
-- Resolve ONLY when the lookup returns exactly one verified user.id; otherwise leave NULL
-- and log. Never store a display-name string in owner_user_id. (G-AREA-8.)
-- Fill in Bailey's verified email, then uncomment:
--
-- UPDATE action_area
--   SET owner_user_id = (SELECT id FROM user WHERE email = '<bailey-email>' COLLATE NOCASE)
--   WHERE slug = 'research'
--     AND owner_user_id IS NULL
--     AND (SELECT COUNT(*) FROM user WHERE email = '<bailey-email>' COLLATE NOCASE) = 1;
--
-- Patient Advocacy / Education / Community owners: TBC — leave NULL until Naomi names them,
-- then add one analogous UPDATE per area (same exactly-one-match guard).
