-- migrations/017-stuc-wix-donor-ux.sql
-- STUC Wix→Stripe donor UX: cancellation_request table + 5 wix_subscription columns.
-- Spec: docs/superpowers/specs/2026-04-28-stuc-wix-donor-ux-design.md
-- Plan: docs/superpowers/plans/2026-04-28-stuc-wix-donor-ux.md (Phase 1, Task 1.1)
--
-- Run:
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/017-stuc-wix-donor-ux.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/017-stuc-wix-donor-ux.sql
--
-- Why these columns:
--   cancel_requested_at         — INV-3: blocks duplicate cancel requests; surfaces banner state
--   cancel_reason               — donor's optional Naomi-voiced "we read every word" feedback
--   migration_handoff_started_at — atomic write-lock with 15-min TTL preventing duplicate Stripe
--                                  subs from a donor who clicks "Switch over" twice; cleared on
--                                  successful checkout.completed by webhook
--   admin_notified_at           — first admin email after cancel; gates Sweep 1 throttle
--   last_admin_notification_at  — most-recent re-send; lets cron sweep throttle to 24h cadence
--
-- Why cancellation_request: separate table (not a wix_subscription column) because cancellation
-- is per-source (wix OR stripe). A donor with both can request cancel of one without affecting
-- the other. Index keeps "outstanding" lookup O(1).
--
-- Resolution model: rows are resolved manually by Brian after confirming the cancel in the
-- Stripe or Wix dashboard. There is no automated cron resolver. To resolve a row:
--   UPDATE cancellation_request SET resolved_at = unixepoch(), resolved_by = 'admin'
--   WHERE id = '<row_id>';
-- A future Wave 3 admin endpoint (/api/admin/cancellation-requests) may add list + resolve UI.

CREATE TABLE IF NOT EXISTS cancellation_request (
  id                          TEXT PRIMARY KEY,
  user_id                     TEXT NOT NULL,
  email                       TEXT NOT NULL COLLATE NOCASE,
  source                      TEXT NOT NULL CHECK(source IN ('wix','stripe')),
  source_subscription_id      TEXT NOT NULL,
  reason                      TEXT CHECK(reason IS NULL OR length(reason) <= 2000),
  requested_at                INTEGER NOT NULL,
  resolved_at                 INTEGER,
  resolved_by                 TEXT,
  last_admin_notification_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cancellation_request_unresolved
  ON cancellation_request(resolved_at) WHERE resolved_at IS NULL;

-- Outstanding-uniqueness: a single source subscription can only have ONE open cancel request at
-- a time. New request after a resolved one is fine (donor reactivated, then cancelled again).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cancellation_request_outstanding_uniq
  ON cancellation_request(source_subscription_id) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cancellation_request_user
  ON cancellation_request(user_id);

CREATE INDEX IF NOT EXISTS idx_cancellation_request_email
  ON cancellation_request(email);

-- wix_subscription column additions. ALTER TABLE in D1/SQLite cannot use IF NOT EXISTS on
-- columns. These will fail on re-run — that's expected; migration is one-shot. To re-run after
-- schema verification, drop the failing ADD COLUMN line.
ALTER TABLE wix_subscription ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN cancel_reason TEXT
  CHECK(cancel_reason IS NULL OR length(cancel_reason) <= 2000);
ALTER TABLE wix_subscription ADD COLUMN migration_handoff_started_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN admin_notified_at INTEGER;
ALTER TABLE wix_subscription ADD COLUMN last_admin_notification_at INTEGER;
