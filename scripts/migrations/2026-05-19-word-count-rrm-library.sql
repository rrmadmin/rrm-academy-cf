-- 2026-05-19 word_count index for rrm-library.articles
--
-- The `articles.word_count` column already exists in the canonical schema
-- (see ~/iCode/projects/rrm-cli/schema/d1-library.sql, around line 71, added
-- 2026-03-23). This migration only adds the index used by thin-page detection
-- (noindex WHERE word_count < 30 on /library/<slug>).
--
-- ALTER TABLE was intentionally dropped: SQLite ADD COLUMN is non-idempotent
-- and would abort the whole file with "duplicate column name". wrangler's
-- per-file abort semantics mean any subsequent statements would not execute.
--
-- Run:
--   wrangler d1 execute rrm-library --remote \
--     --file=scripts/migrations/2026-05-19-word-count-rrm-library.sql

CREATE INDEX IF NOT EXISTS idx_articles_word_count ON articles(word_count);
