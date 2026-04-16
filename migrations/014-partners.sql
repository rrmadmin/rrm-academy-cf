-- 014-partners.sql
-- Educational Partners program: Friend tier MVP
-- See: docs/superpowers/specs/2026-04-16-educational-partners-program-design.md

CREATE TABLE IF NOT EXISTS partners (
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','revoked')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_partners_status ON partners(status);
CREATE INDEX IF NOT EXISTS idx_partners_slug ON partners(slug);
CREATE INDEX IF NOT EXISTS idx_partners_contact_email ON partners(contact_email);
