-- Practitioner directory: NaPro/RRM medical consultants from external lists.
-- Separate from contact CRM (no email required, different entity type).
-- Run: npx wrangler d1 execute rrm-auth --remote --file=migrations/009-practitioner-directory.sql

CREATE TABLE IF NOT EXISTS practitioner (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    credentials TEXT,
    specialty TEXT,
    certification_code TEXT,
    certification_name TEXT,
    is_fellow INTEGER DEFAULT 0,
    is_collaborating INTEGER DEFAULT 0,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'USA',
    phone TEXT,
    email TEXT,
    website TEXT,
    practice_name TEXT,
    source TEXT NOT NULL,
    source_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_practitioner_state ON practitioner(state);
CREATE INDEX IF NOT EXISTS idx_practitioner_country ON practitioner(country);
CREATE INDEX IF NOT EXISTS idx_practitioner_source ON practitioner(source);
CREATE INDEX IF NOT EXISTS idx_practitioner_certification ON practitioner(certification_code);
