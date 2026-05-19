-- 2026-05-19 word_count column + index for rrm-auth.glossary_term
--
-- RUN ONCE -- the ALTER TABLE ADD COLUMN below is non-idempotent. If you ever
-- need to re-run this file (e.g. on a fork or a fresh local D1), comment out
-- the ALTER statement first or wrangler will abort the whole file with
-- "duplicate column name" and the CREATE INDEX below will not execute.
--
-- Run:
--   wrangler d1 execute rrm-auth --remote \
--     --file=scripts/migrations/2026-05-19-word-count-rrm-auth.sql

ALTER TABLE glossary_term ADD COLUMN word_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_glossary_term_word_count ON glossary_term(word_count);
