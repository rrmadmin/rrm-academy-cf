-- scripts/migrate-glossary-to-d1.sql
-- Glossary tables for rrm-auth D1 (follows FAQ pattern)
-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-glossary-to-d1.sql

-- Main glossary term table
CREATE TABLE IF NOT EXISTS glossary_term (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    part TEXT NOT NULL CHECK(part IN ('I','II','III','IV','V','VI','VII','VIII')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    body_html TEXT NOT NULL,
    abbreviation TEXT,
    pillar_link TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    word_count INTEGER,                          -- HTML-stripped count of body_html; drives noindex on /glossary/<slug> (< 30 = thin)
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_glossary_term_status ON glossary_term(status);
CREATE INDEX IF NOT EXISTS idx_glossary_term_part ON glossary_term(part);
CREATE INDEX IF NOT EXISTS idx_glossary_term_sort ON glossary_term(part, sort_order);
CREATE INDEX IF NOT EXISTS idx_glossary_term_abbr ON glossary_term(abbreviation) WHERE abbreviation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_glossary_term_word_count ON glossary_term(word_count);

-- References table (per-page numbered citations)
CREATE TABLE IF NOT EXISTS glossary_reference (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_num INTEGER UNIQUE NOT NULL,
    anchor_text TEXT NOT NULL,
    url TEXT NOT NULL,
    publisher TEXT,
    journal TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_glossary_reference_num ON glossary_reference(ref_num);

-- Abbreviations quick-reference table (flat abbreviation -> full-term lookup).
-- Some abbreviations have a corresponding glossary_term (term_slug links to it);
-- others do not (e.g. RMT, RIF, AAFCP) and remain as orphan quick-ref entries.
-- Not a FK — D1 does not honor CASCADE/SET NULL. Kept as plain TEXT column.
CREATE TABLE IF NOT EXISTS glossary_abbreviation (
    abbreviation TEXT PRIMARY KEY COLLATE NOCASE,
    full_term TEXT NOT NULL,
    term_slug TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_glossary_abbreviation_sort ON glossary_abbreviation(sort_order);
