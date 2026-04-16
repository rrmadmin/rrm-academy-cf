-- Add signup_source column to user table for NLWeb /ask conversion tracking
-- Values: 'ask', 'course', 'community', 'donation', 'direct', or NULL for pre-migration users
-- Rollback: ALTER TABLE user DROP COLUMN signup_source;
ALTER TABLE user ADD COLUMN signup_source TEXT;
