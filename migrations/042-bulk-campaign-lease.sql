-- 042-bulk-campaign-lease.sql
-- The bulk rail's per-campaign send lease -- additive migration on rrm-auth (D1).
--
-- WHY
-- Two --send runs of the same bulk campaign, started a minute apart, both read
-- the same head of the cohort. The already-sent guard is a LIKE against
-- email_log.source and a recipient only lands there AFTER SES accepts their
-- message, so everything the first run has not reached yet is still eligible
-- for the second. The pacing (1.5 s per message, 50 per page) makes that window
-- wide rather than theoretical: one operator and a retried terminal can deliver
-- the same letter twice to most of a page, and nothing bounded it.
--
-- These two columns are what the lease is made of. functions/api/newsletter/
-- send.js's bulk path writes campaign and updated_at when a page starts, and
-- refuses a second invocation (409 bulk_run_in_progress) while another row for
-- the same campaign is still 'sending' with a stamp inside the lease window
-- (BULK_LEASE_SECONDS = 180). A page that ends stamps a terminal status
-- ('sent', 'partial' or 'failed'), so the caller's own next page is never
-- refused by the page before it, and an abandoned page expires on its own.
--
-- ADDITIVE ONLY: two nullable columns plus one index. campaign is NULL on every
-- legacy newsletter_send row and on every row the legacy path writes, which is
-- correct: the lease is the bulk lane's, and the legacy path has its own
-- sendId-scoped resume.
--
-- NOT RE-RUNNABLE: SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS, so a
-- second run of the two ALTERs errors with "duplicate column name". That is the
-- intended signal that the migration already applied; the index is IF NOT EXISTS.
--
-- ROLLBACK: the columns are additive and the values are operational state, not
-- a record of anything only they hold, so the revert is a value revert:
--   UPDATE newsletter_send SET campaign = NULL, updated_at = NULL;
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/042-bulk-campaign-lease.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/042-bulk-campaign-lease.sql

ALTER TABLE newsletter_send ADD COLUMN campaign TEXT;
ALTER TABLE newsletter_send ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_nl_send_campaign_lease ON newsletter_send(campaign, status, updated_at);
