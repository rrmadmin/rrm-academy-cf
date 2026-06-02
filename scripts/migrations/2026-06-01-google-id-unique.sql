-- 2026-06-01: enforce one user row per Google identity.
--
-- The returning-Google-user lookup in functions/api/auth/google-callback.js does
-- `SELECT ... WHERE google_id = ?` then `.first()`. Without a UNIQUE constraint,
-- two user rows could share a google_id and login would resolve to a
-- nondeterministic row; the existing `isGoogleIdCollision` recovery branch was
-- also dead code because the UNIQUE error it catches could never fire.
--
-- Partial index (WHERE google_id IS NOT NULL) so the many local accounts with a
-- NULL google_id are unaffected (multiple NULLs are allowed).
--
-- Pre-checked on prod 2026-06-01: 23 rows with google_id, 23 distinct -> no
-- duplicates, so the unique index applies cleanly. Source: /arise --deep auth
-- audit (OAuth hunter, P1).
--
-- The pre-existing non-unique idx_user_google_id is now redundant for non-null
-- lookups; left in place to keep this migration additive. Optional future cleanup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google_id_unique
  ON user(google_id) WHERE google_id IS NOT NULL;
