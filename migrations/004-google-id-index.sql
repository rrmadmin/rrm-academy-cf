-- Migration 004: Add index on user.google_id for Google OAuth lookups
CREATE INDEX IF NOT EXISTS idx_user_google_id ON user(google_id);
