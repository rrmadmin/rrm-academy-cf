-- Magic-link email verification (2026-06-20)
-- Adds a strong single-use URL token to email_verification so a click-link can
-- verify an email without a session or a typed code. The short `code` column is
-- retained (NOT NULL) but no longer surfaced in the UI; the token is the path.
-- Additive + nullable: existing rows keep NULL, safe to leave in place on revert.
ALTER TABLE email_verification ADD COLUMN token TEXT;
CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification(token);
