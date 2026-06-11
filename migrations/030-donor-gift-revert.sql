-- migrations/030-donor-gift-revert.sql
-- REVERT for 030-donor-gift.sql. Execute ONLY on migration-related failure before
-- the donor data layer ships, or with Brian's explicit approval after backfill
-- (post-backfill execution destroys donor history data).
DROP TABLE IF EXISTS donor_gift;
ALTER TABLE contact DROP COLUMN first_gift_at;
ALTER TABLE contact DROP COLUMN last_gift_at;
ALTER TABLE contact DROP COLUMN gift_count;
ALTER TABLE contact DROP COLUMN donor_stage;
