-- 2026-05-19 word_count column for thin-page detection
--
-- Adds a `word_count INTEGER` column + index on two D1 databases that back
-- content pages on rrmacademy.org. Drives programmatic noindex for thin pages
-- (currently library/[...slug].astro hardcodes `abstract.trim().length < 30`;
-- after backfill, the template reads `article.word_count < 30` instead).
--
-- Reusable for any D1-backed content surface (future glossary detail pages,
-- providers, etc.). See `scripts/compute-word-counts.mjs` for the backfill.
--
-- Run order (D1 is two separate databases -- both ALTERs must run):
--   1) wrangler d1 execute rrm-library --remote --file=scripts/migrations/2026-05-19-word-count.sql
--      NOTE: `articles.word_count` already exists in rrm-library per
--      projects/rrm-cli/schema/d1-library.sql (line ~71). If the ALTER fails
--      with "duplicate column name", that's expected -- skip to the CREATE INDEX
--      statement below (split this file or run the index command standalone).
--   2) wrangler d1 execute rrm-auth --remote --file=scripts/migrations/2026-05-19-word-count.sql
--      (only the glossary_term half applies here; the articles ALTER will no-op
--      because that table doesn't exist in rrm-auth -- error is harmless when
--      split-running, but cleanest is to run each half against its own DB.)
--
-- SQLite ALTER TABLE ADD COLUMN is non-destructive: existing rows get NULL.
-- The backfill script computes + writes word_count idempotently.

-- =====================================================================
-- rrm-library.articles  (run against: wrangler d1 execute rrm-library --remote)
-- =====================================================================

-- The column already exists in rrm-cli/schema/d1-library.sql. The line below
-- is here for any forked/local D1 that pre-dates the schema bump. Comment out
-- if the column is already present on the target DB.
ALTER TABLE articles ADD COLUMN word_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_articles_word_count ON articles(word_count);

-- =====================================================================
-- rrm-auth.glossary_term  (run against: wrangler d1 execute rrm-auth --remote)
-- =====================================================================

ALTER TABLE glossary_term ADD COLUMN word_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_glossary_term_word_count ON glossary_term(word_count);
