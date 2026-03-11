-- Atomic token claim table to prevent double-submit race conditions.
-- Run: npx wrangler d1 execute rrm-survey --remote --file=migrations/007-survey-token-claims.sql

CREATE TABLE IF NOT EXISTS survey_token_claims (
    token TEXT PRIMARY KEY,
    claimed_at INTEGER NOT NULL
);
