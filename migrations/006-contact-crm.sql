-- CRM contact tables: unified contact record across all historical sources.
-- Run: npx wrangler d1 execute rrm-auth --remote --file=migrations/006-contact-crm.sql

CREATE TABLE IF NOT EXISTS contact (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    ig_handle TEXT,
    region TEXT,
    source TEXT,
    landing_page TEXT,
    first_seen_at TEXT,
    total_spent REAL DEFAULT 0,
    total_donated REAL DEFAULT 0,
    accepts_marketing INTEGER DEFAULT 0,
    notes TEXT,
    user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    stripe_customer_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_user ON contact(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_source ON contact(source);
CREATE INDEX IF NOT EXISTS idx_contact_first_seen ON contact(first_seen_at);

CREATE TABLE IF NOT EXISTS contact_tag (
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(contact_id, tag)
);

CREATE TABLE IF NOT EXISTS contact_address (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    line1 TEXT,
    line2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_address_contact ON contact_address(contact_id);
