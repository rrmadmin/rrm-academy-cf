-- scripts/migrate-faqs-to-d1.sql
-- FAQ tables for rrm-auth D1 (Phase 1 of publish path D1 migration)
-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-to-d1.sql

CREATE TABLE IF NOT EXISTS faq (
    id TEXT PRIMARY KEY,
    faq_code TEXT,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    question TEXT NOT NULL,
    basic_answer TEXT,
    schema_answer TEXT,
    published_answer TEXT,
    category TEXT NOT NULL,
    seo_title TEXT,
    seo_description TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_status ON faq(status);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(category);

CREATE TABLE IF NOT EXISTS faq_library_ref (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    label TEXT,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_library_ref_faq ON faq_library_ref(faq_id);

CREATE TABLE IF NOT EXISTS faq_resource (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, url)
);

CREATE INDEX IF NOT EXISTS idx_faq_resource_faq ON faq_resource(faq_id);
