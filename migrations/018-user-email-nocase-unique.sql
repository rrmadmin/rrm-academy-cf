-- migrations/018-user-email-nocase-unique.sql
-- Adds a case-insensitive unique index on user.email to prevent concurrent
-- signups with mixed-case variants of the same address from both succeeding.
--
-- PRECHECK: Verify zero duplicate emails (case-insensitive) before applying.
-- Run this first:
--   npx wrangler d1 execute rrm-auth --remote --command "SELECT LOWER(email), COUNT(*) c FROM user GROUP BY LOWER(email) HAVING c > 1"
-- If any rows are returned, resolve duplicates before applying this migration.
--
-- Run:
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/018-user-email-nocase-unique.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/018-user-email-nocase-unique.sql

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_nocase ON user(email COLLATE NOCASE);
