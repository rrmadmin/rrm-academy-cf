-- AUTHCRYPTO-04: enforce google_id uniqueness so the OAuth collision handling
-- in functions/api/auth/google-callback.js has a real DB constraint to rely on
-- (previously the collision branch depended on a UNIQUE violation that could
-- never fire). Partial index excludes NULL and '' so the ~3,900 password-only
-- accounts (google_id NULL/empty) are unaffected.
-- Verified 2026-06-07 against prod rrm-auth: zero duplicate non-empty google_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_id_unique
  ON user(google_id)
  WHERE google_id IS NOT NULL AND google_id != '';
