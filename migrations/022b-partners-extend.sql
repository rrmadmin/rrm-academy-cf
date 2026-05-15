-- Migration 022b: extend partners table for paid tiers + badge widget (D41 + ALTERs)
-- Idempotency: each ALTER ADD COLUMN is run via a wrapper that catches
--              "duplicate column name" errors (handled by apply-migration-022.sh).
-- The CHECK rebuild via table-recreation only proceeds if the existing
--              CHECK predicate is missing any of the new states.

ALTER TABLE partners ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE partners ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE partners ADD COLUMN badge_token TEXT;
ALTER TABLE partners ADD COLUMN tier_revision INTEGER DEFAULT 0;
ALTER TABLE partners ADD COLUMN active_since TEXT;
ALTER TABLE partners ADD COLUMN expires_at TEXT;
ALTER TABLE partners ADD COLUMN stripe_session_id TEXT;
ALTER TABLE partners ADD COLUMN stripe_session_expires_at TEXT;

-- UNIQUE on badge_token (added separately so the ADD COLUMN doesn't fail on null-existing rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_badge_token ON partners(badge_token) WHERE badge_token IS NOT NULL;
