-- scripts/reset-glossary-data.sql
-- DESTRUCTIVE: Wipes all glossary data. Run only when you intend to re-seed from source.
-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/reset-glossary-data.sql
--
-- After this, run scripts/migrate-glossary-data.sql to repopulate from source.
-- Admin CRUD edits in D1 will be LOST. There is no backup.

DELETE FROM glossary_term;
DELETE FROM glossary_reference;
DELETE FROM sqlite_sequence WHERE name IN ('glossary_reference');
