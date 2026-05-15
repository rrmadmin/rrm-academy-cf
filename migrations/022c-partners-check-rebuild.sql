-- Migration 022c: rebuild partners CHECK constraint to add paid-tier states (D41)
-- Existing CHECK: status IN ('pending','active','rejected','revoked')
-- Target CHECK:   status IN ('pending','awaiting_payment','active','grace','expired','cancelled','rejected','revoked')
-- SQLite cannot ALTER CHECK in place. Standard table-recreation pattern.
-- Column list matches live schema (PRAGMA verified 2026-05-15): 18 original + 8 from 022b.
--
-- IMPORTANT: every column attribute on the live partners table is preserved
-- here verbatim except for the status CHECK list.
--   - COLLATE NOCASE on name, slug, contact_email (critical: case-insensitive
--     lookups are relied upon by /api/admin/partners and auth code paths)
--   - UNIQUE on slug (column-level; mirrors live partners)
--   - tier CHECK + DEFAULT 'friend'
--   - created_at DEFAULT (datetime('now'))
--
-- BEGIN TRANSACTION / COMMIT lines are intentionally absent: D1 rejects raw
-- transaction markers in --file= mode. D1 treats each statement atomically.

CREATE TABLE partners_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  site_url TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT,
  provider_name TEXT NOT NULL,
  provider_credential TEXT NOT NULL,
  provider_directory_id TEXT,
  blurb TEXT,
  affirmations TEXT NOT NULL,
  contact_email TEXT NOT NULL COLLATE NOCASE,
  tier TEXT NOT NULL DEFAULT 'friend' CHECK (tier IN ('friend','partner','accredited')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','awaiting_payment','active','grace','expired','cancelled','rejected','revoked'
  )),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  revoked_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  badge_token TEXT,
  tier_revision INTEGER DEFAULT 0,
  active_since TEXT,
  expires_at TEXT,
  stripe_session_id TEXT,
  stripe_session_expires_at TEXT
);

INSERT INTO partners_new (
  id, name, slug, site_url, country, city, provider_name, provider_credential,
  provider_directory_id, blurb, affirmations, contact_email, tier, status,
  notes, created_at, approved_at, revoked_at,
  stripe_customer_id, stripe_subscription_id, badge_token, tier_revision,
  active_since, expires_at, stripe_session_id, stripe_session_expires_at
)
SELECT
  id, name, slug, site_url, country, city, provider_name, provider_credential,
  provider_directory_id, blurb, affirmations, contact_email, tier, status,
  notes, created_at, approved_at, revoked_at,
  stripe_customer_id, stripe_subscription_id, badge_token, tier_revision,
  active_since, expires_at, stripe_session_id, stripe_session_expires_at
FROM partners;

DROP TABLE partners;
ALTER TABLE partners_new RENAME TO partners;

CREATE INDEX IF NOT EXISTS idx_partners_slug ON partners(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_badge_token ON partners(badge_token) WHERE badge_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_tier ON partners(tier);
CREATE INDEX IF NOT EXISTS idx_partners_contact_email ON partners(contact_email);
