-- migrations/019-password-reset-purpose.sql
-- Adds purpose column to password_reset so forgot-password flow does not
-- destroy 7-day welcome tokens generated for auto-created Stripe accounts.
--
-- Run:
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/019-password-reset-purpose.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/019-password-reset-purpose.sql
--
-- Existing rows default to 'reset'. New welcome tokens use purpose='welcome'.
-- forgot-password.js DELETE scoped to purpose='reset' preserves welcome tokens.

ALTER TABLE password_reset ADD COLUMN purpose TEXT NOT NULL DEFAULT 'reset';
