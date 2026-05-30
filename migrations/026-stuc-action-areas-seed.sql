-- 026-stuc-action-areas-seed.sql
-- STUC Action Areas SEED — the initial Action Areas (the joinable do-tank units).
-- Spec: docs/superpowers/specs/2026-05-25-stuc-action-areas-hub-design.md (§Seed data)
-- Plan: docs/superpowers/plans/2026-05-27-stuc-action-areas-hub-implementation.md (Phase 8)
--
-- SET RATIONALE: Naomi reviewed the original 4-area draft (2026-05-30, thread
-- 19e78d2cc0aee33a) and asked for a finer-grained set: split Education into
-- Medical / FABM / Holistic, add Nutrition, add Social Media, add a Practitioner
-- Network (experts/healers/midwives/doulas), add Innovation, and split funding into
-- Money & Fundraising (small donors) vs Sponsorship (big companies). Brian approved
-- seeding this expanded set now (taglines provisional, editable via admin CRUD).
--
-- BUCKET NOTE: the action_area.bucket CHECK only allows
-- ('research','advocacy','education','community'). bucket is INTERNAL-ONLY — it is not
-- displayed or used for UI grouping anywhere in the render path — so the two funding
-- areas are filed under existing buckets (Money & Fundraising -> community,
-- Sponsorship -> advocacy) rather than rebuilding the table for a 5th bucket. If a true
-- 'fundraising' bucket is ever wanted (e.g. bucket-grouped display), widen the CHECK in a
-- follow-up rebuild migration; nothing user-facing depends on it today.
--
-- STATUS: NOT YET APPLIED at author time. Apply (controller, interactively, like 025):
--   wrangler d1 execute rrm-auth --remote --file=migrations/026-stuc-action-areas-seed.sql
-- Seeding only writes data into the (deployed-later) hub's tables; it is invisible on the
-- live site until the branch deploys at go-live. Taglines/copy still route to Naomi for
-- final wording; admin edits won't be clobbered (insert is DO NOTHING).
--
-- IDEMPOTENT: INSERT ... ON CONFLICT(slug) DO NOTHING. Re-running won't duplicate or
-- clobber admin edits. Owner resolution is a SEPARATE idempotent UPDATE (below) — never
-- part of the DO-NOTHING insert, and only when a name resolves to EXACTLY ONE user.id.
-- Slugs avoid the reserved blocklist (areas/events/members/post). Readable ids are stable
-- so future project rows can reference them.

INSERT INTO action_area (id, slug, name, tagline, icon, bucket, sort_order, status, owner_user_id) VALUES
  ('area-research',            'research',            'Research',             'Turn clinical questions into published evidence.',                  '🔬', 'research',   1,  'active', NULL),
  ('area-innovation',          'innovation',          'Innovation',           'Build the tools and ideas that move restorative care forward.',     '💡', 'research',   2,  'active', NULL),
  ('area-patient-advocacy',    'patient-advocacy',    'Patient Advocacy',     'Change policy, access, and the public conversation.',               '🤝', 'advocacy',   3,  'active', NULL),
  ('area-social-media',        'social-media',        'Social Media',         'Meet patients where they are and grow the conversation online.',    '📣', 'advocacy',   4,  'active', NULL),
  ('area-medical-education',   'medical-education',   'Medical Education',     'Train the clinicians who deliver restorative care.',                '🩺', 'education',  5,  'active', NULL),
  ('area-fabm-education',      'fabm-education',      'FABM Education',        'Teach the charting skills that put patients in charge of their cycles.', '📊', 'education', 6,  'active', NULL),
  ('area-holistic-education',  'holistic-education',  'Holistic Education',    'Connect whole-body health to fertility in plain language.',         '🌿', 'education',  7,  'active', NULL),
  ('area-nutrition',           'nutrition',           'Nutrition',            'Make food and lifestyle part of every fertility plan.',             '🥗', 'education',  8,  'active', NULL),
  ('area-practitioner-network','practitioner-network','Practitioner Network', 'Connect the experts, healers, midwives, and doulas patients rely on.', '👥', 'community', 9,  'active', NULL),
  ('area-community',           'community',           'Community',            'Welcome new members and keep the club alive between calls.',        '🌱', 'community', 10,  'active', NULL),
  ('area-fundraising',         'fundraising',         'Money & Fundraising',  'Power the mission with grassroots support from members like you.',  '💵', 'community', 11,  'active', NULL),
  ('area-sponsorship',         'sponsorship',         'Sponsorship',          'Partner with companies that want to back restorative medicine.',    '🏢', 'advocacy',  12,  'active', NULL)
ON CONFLICT(slug) DO NOTHING;

-- ── Owner resolution (run AFTER the inserts, AFTER a real user.id is known) ──
-- Resolve ONLY when the lookup returns exactly one verified user.id; otherwise leave NULL
-- and log. Never store a display-name string in owner_user_id. (G-AREA-8.)
-- Naomi has NOT yet supplied Bailey's signup email or named owners for the other areas,
-- so every owner_user_id stays NULL for now. Fill in the verified email, then uncomment:
--
-- UPDATE action_area
--   SET owner_user_id = (SELECT id FROM user WHERE email = '<bailey-email>' COLLATE NOCASE)
--   WHERE slug = 'research'
--     AND owner_user_id IS NULL
--     AND (SELECT COUNT(*) FROM user WHERE email = '<bailey-email>' COLLATE NOCASE) = 1;
--
-- Other area owners (Advocacy / Education / Community / Fundraising / etc.): TBC — leave
-- NULL until Naomi names them, then add one analogous UPDATE per area (same exactly-one
-- match guard).
