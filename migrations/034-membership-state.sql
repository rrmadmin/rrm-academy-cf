-- 034-membership-state.sql
-- Why a membership lapsed, persisted next to the Wix subscription roster -- additive migration on rrm-auth (D1).
--
-- WHY
-- wix_subscription.status is binary (active | inactive) and the reason is
-- discarded, so a card that expired, a member who cancelled, and a rail that
-- silently stopped billing are indistinguishable in D1. The re-subscribe email
-- copy differs per case, so the reason has to be stored, not inferred later.
-- Vocabulary SSOT: rrm-wix-stuc-sync/docs/membership-state.json (v1), derived
-- by rrm-wix-stuc-sync/src/membership-state.js; handoff
-- rrm-wix-stuc-sync/docs/handoffs/2026-08-21-lapse-reason-handoff.md.
--
-- This repo is the canonical home for the DDL because rrm-auth has ONE
-- migration history (this repo). rrm-wix-stuc-sync writes the columns;
-- rrm-backoffice reads them and falls back to status when they are NULL.
--
-- ADDITIVE ONLY: three nullable columns plus one index. Existing readers are
-- untouched; status stays the gating field other code depends on.
--
-- NOT RE-RUNNABLE: SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS, so a
-- second run of the three ALTERs errors with "duplicate column name". That is
-- the intended signal that the migration already applied; the index is
-- IF NOT EXISTS.
--
-- COLUMN NOTES
-- membership_state: one code from docs/membership-state.json precedence.
-- lapse_detail: the raw rail code, <= 64 chars (expired_card, PAYMENT_FAILURE).
-- lapsed_at: ISO timestamp of when the state left active (TEXT, matching the
--   sibling TEXT date columns on this table; cancel_requested_at is the
--   pre-existing INTEGER-epoch exception and is not touched here).
--
-- ROLLBACK: the columns are additive and every value is re-derivable, so the
-- named revert is a value revert, not a schema one:
--   UPDATE wix_subscription SET membership_state=NULL, lapse_detail=NULL, lapsed_at=NULL;
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/034-membership-state.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/034-membership-state.sql

ALTER TABLE wix_subscription ADD COLUMN membership_state TEXT;
ALTER TABLE wix_subscription ADD COLUMN lapse_detail TEXT;
ALTER TABLE wix_subscription ADD COLUMN lapsed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_wix_subscription_state ON wix_subscription(membership_state);
