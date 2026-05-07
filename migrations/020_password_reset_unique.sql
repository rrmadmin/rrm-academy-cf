-- Migration 020: Add UNIQUE constraint on password_reset(user_id, purpose)
-- Prevents concurrent forgot-password requests from leaving two valid reset tokens
-- for the same user. With this index, INSERT OR REPLACE in forgot-password.js
-- is atomic: the old token is replaced, never two live tokens for the same (user, purpose).
--
-- Purpose values: 'reset' (forgot-password, 1hr TTL), 'welcome' (Stripe onboarding, 7d TTL).
-- Both are now enforced unique per user, which is correct — one active token per purpose.
--
-- Safe to apply on existing data: password_reset(user_id, purpose) was already cleaned
-- via DELETE+INSERT batch in forgot-password.js, so duplicates should not exist in practice.

CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_user_purpose
  ON password_reset (user_id, purpose);
