-- 041-bulk-mail-rail.sql
-- Warm-up state for the bulk mail rail on rrmacademy.com -- additive migration on rrm-auth (D1).
--
-- WHY
-- The 2026-09-06 to 09-08 invite drip put a 0.55% user-reported spam day on
-- rrmacademy.org in Google Postmaster Tools, above the 0.3% policy line, and
-- flipped the domain's Compliance status to "Needs work". Every send as
-- rrmacademy.org shares that verdict, transactional mail included. The rail
-- built on top of these two tables moves multi-thousand sends onto a separate
-- registrable domain under a ramp table, a per-day counter and a circuit
-- breaker, so a bad cohort can cost at most one day's cap and then stops.
-- Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md sections 5.1 and 5.5.
--
-- mail_domain_state: ONE ROW PER SENDING DOMAIN, and the row's ABSENCE is
-- load-bearing. A missing row means the domain has never sent, and the policy
-- BLOCKS rather than computing a "days since first send" against a row that
-- does not exist. Only the CLI's --first-send flag creates it, in its own D1
-- write before any recipient is touched.
--
-- sent_today is keyed on `day`, a UTC calendar date, and is the ONLY source of
-- the day's spend. It is deliberately NOT recounted from email_log, because
-- insertEmailLog() in functions/api/_ses.js swallows D1 failures on purpose (a
-- logging failure must never turn into a bounced SES send), so a cap that
-- recounted email_log after SES had already accepted could undercount and let
-- a rerun exceed the ramp cap. The counter is incremented in the SAME db.batch()
-- as the email_log insert for each send, and a failure of that batch pauses the
-- run with reason 'log-write-failed' rather than being swallowed.
--
-- send_paused: an OPEN row (resumed_at IS NULL) is a stop. A paused run resumes
-- only by a human passing --resume after reading the reason; nothing in the
-- request path clears it. Rows are kept after resume as the campaign's history,
-- which is why resumed_at is a nullable column rather than a delete.
--
-- ADDITIVE ONLY: two new tables and one index. No existing reader is touched.
--
-- RE-RUNNABLE: every statement is IF NOT EXISTS.
--
-- ROLLBACK: DROP TABLE send_paused; DROP TABLE mail_domain_state;
--   Both are derived operational state, not a record of anything only they hold:
--   the sends themselves are in email_log and email_event.
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/041-bulk-mail-rail.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/041-bulk-mail-rail.sql

CREATE TABLE IF NOT EXISTS mail_domain_state (
  domain         TEXT PRIMARY KEY,          -- 'rrmacademy.com'
  first_send_at  TEXT,                      -- ISO 8601 UTC; set once, by --first-send
  day            TEXT,                      -- UTC calendar date 'YYYY-MM-DD' that sent_today counts
  sent_today     INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS send_paused (
  id          TEXT PRIMARY KEY,             -- crypto.randomUUID()
  campaign    TEXT NOT NULL,                -- the campaign key, e.g. 'sept-letter'
  reason      TEXT NOT NULL,                -- complaint-rate | bounce-rate | log-write-failed
  detail      TEXT,                         -- the numbers behind the reason, <= 500 chars
  paused_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resumed_at  TEXT                          -- NULL while the pause stands
);

CREATE INDEX IF NOT EXISTS idx_send_paused_open ON send_paused(campaign, resumed_at);
