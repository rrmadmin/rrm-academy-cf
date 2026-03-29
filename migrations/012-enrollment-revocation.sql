-- Enrollment revocation support
-- Applied to D1 database: rrm-auth
-- Run: wrangler d1 execute rrm-auth --file=migrations/012-enrollment-revocation.sql
--
-- Enables soft revocation when a charge is fully refunded via Stripe.
-- All active-enrollment queries must filter AND revoked_at IS NULL.

ALTER TABLE enrollment ADD COLUMN revoked_at TEXT;
