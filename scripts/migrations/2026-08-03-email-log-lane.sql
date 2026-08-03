-- 2026-08-03 email_log.lane column for the M365/Workspace dual-lane email router
--
-- Target database: rrm-auth (D1 binding DB)
--
-- Adds the send-lane marker ('ses' | 'workspace') so email_log rows record
-- which transport actually carried a send. insertEmailLog() (functions/api/_ses.js)
-- binds 'ses' on every write that omits lane, so every row written after this
-- migration is populated by application code, not a SQL DEFAULT. Existing
-- rows are left NULL (all pre-Workspace sends were SES) -- no backfill needed.
--
-- Run ONCE before deploying functions/api/_mail-lanes.js and its call sites:
--   npx wrangler d1 execute rrm-auth --remote \
--     --file=scripts/migrations/2026-08-03-email-log-lane.sql

ALTER TABLE email_log ADD COLUMN lane TEXT;
