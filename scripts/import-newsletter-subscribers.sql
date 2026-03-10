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
