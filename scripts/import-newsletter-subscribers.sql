-- HISTORICAL ONE-SHOT: do not re-run.
-- Original purpose: seed newsletter_subscriber from the legacy `user` table
-- based on user_label tags (donor / student / stuc).
-- The current production import path is scripts/import-newsletter-subscribers.mjs,
-- which sources contacts from the CRM `contact` table (ELV-tagged), filters
-- out wix:unsubscribed / email:bounced contacts, and uses a CASCADE-safe FK
-- pattern. Two known issues in this archived SQL (do not "fix" -- file is
-- preserved verbatim for historical context):
--   1. PK reuse: u.id is written as newsletter_subscriber.id (would collide
--      with any subsequent mjs-driven import which mints fresh UUIDs).
--   2. json_group_array(CASE … ELSE NULL) produces "[null]" for users with no
--      matching label tags. NULL must be filtered BEFORE json_group_array.
-- If a future operator needs the user-table -> newsletter_subscriber seeding
-- pattern, port it into a new .mjs script using crypto.randomUUID() for ids
-- and a NULL-filtered subselect for segments.

-- Import D1 users into newsletter_subscriber table.
-- Segments based on user_label: donor, student, stuc.
-- Run: npx wrangler d1 execute rrm-auth --remote --file=scripts/import-newsletter-subscribers.sql

INSERT OR IGNORE INTO newsletter_subscriber (id, email, name, status, segments, source, user_id)
SELECT
  u.id,
  u.email,
  COALESCE(u.name, NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '')),
  'active',
  (
    SELECT json_group_array(
      CASE
        WHEN ul.label LIKE '%donor%' THEN 'donor'
        WHEN ul.label LIKE '%student%' THEN 'student'
        WHEN ul.label LIKE '%Save the Uterus%' THEN 'stuc'
        ELSE NULL
      END
    )
    FROM user_label ul
    WHERE ul.user_id = u.id
    AND (ul.label LIKE '%donor%' OR ul.label LIKE '%student%' OR ul.label LIKE '%Save the Uterus%')
  ),
  'import',
  u.id
FROM user u
WHERE u.blocked = 0
  AND u.email NOT LIKE '%test%'
  AND u.email NOT LIKE '%example%'
  AND u.email_verified = 1;
