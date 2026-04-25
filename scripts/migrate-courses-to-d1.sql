-- scripts/migrate-courses-to-d1.sql
-- Course tables for rrm-auth D1 (Phase 3 of publish path D1 migration; follows posts + faqs)
-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-courses-to-d1.sql

CREATE TABLE IF NOT EXISTS course (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    title TEXT NOT NULL,
    description TEXT,
    short_description TEXT,
    image_url TEXT,
    image_alt TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0,
    stripe_price_id TEXT,
    is_free INTEGER NOT NULL DEFAULT 0,
    has_certificate INTEGER NOT NULL DEFAULT 0,
    certificate_quiz_step_id TEXT,
    self_paced INTEGER NOT NULL DEFAULT 1,
    access_type TEXT NOT NULL DEFAULT 'public' CHECK(access_type IN ('public', 'private')),
    coming_soon INTEGER NOT NULL DEFAULT 0,
    participants INTEGER NOT NULL DEFAULT 0,
    instructors_json TEXT,
    includes_json TEXT,
    included_in_json TEXT,
    settings_json TEXT,
    seo_json TEXT,
    faqs_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_course_status ON course(status);
CREATE INDEX IF NOT EXISTS idx_course_sort ON course(sort_order);

CREATE TABLE IF NOT EXISTS course_section (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_course_section_course ON course_section(course_id, sort_order);

CREATE TABLE IF NOT EXISTS course_step (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES course_section(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('video', 'article', 'quiz')),
    stream_uid TEXT,
    duration_seconds INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    attachments_json TEXT,
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_course_step_section ON course_step(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_course_step_course ON course_step(course_id);
CREATE INDEX IF NOT EXISTS idx_course_step_status ON course_step(status);
