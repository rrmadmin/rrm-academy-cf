-- 039-first-touch-attribution.sql
-- First-touch attribution columns on the conversion ledger -- additive
-- migration on rrm-auth (D1). Converge component `first-touch-attribution`.
--
-- WHY
-- migrations/036-conversion-ledger.sql records only last-touch attribution
-- (entry_source/entry_category/utm_campaign, all derived from the CURRENT
-- request's referrer/UTM params). A visitor who arrives from a paid ad on
-- Monday and buys direct on Friday shows as a direct purchase, and the
-- click id that brought them is gone by the time they convert -- the 30-day
-- `gclid` cookie has already expired or been overwritten by an intervening
-- click. This migration adds the columns the first-touch cookie (`rrm_ft`,
-- 90-day, docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md
-- section 3.1) and the Stripe checkout/webhook flow bind into, so the
-- ledger's own person-level history stops resetting on every session.
--
-- PII CLASS (screen applied at the _ga4.js ledger boundary, same as every
-- other free-text column on this table)
-- ft_source, ft_medium, ft_campaign, ft_landing: free text, screened against
--   _track-events.js PII_VALUE_REGEX (email shape, formatted SSN/phone, bare
--   13-19 digit run) before the column is bound. A match writes NULL.
-- ft_at: an ISO-8601 timestamp derived from the cookie's `d` (epoch seconds)
--   field. Not free text; no screen applies. NULL when the cookie carried no
--   parseable `d`.
-- click_id: the visitor's FIRST paid click id (gclid/gbraid/wbraid), sourced
--   from rrm_ft's `g` field. Screened by ledgerSafeText like every other
--   free-text column -- it is opaque but visitor-supplied (arrives via a URL
--   query param an attacker fully controls), so it gets the full
--   PII_VALUE_REGEX screen including the digit-run branch, same as
--   ft_source/ft_medium/ft_campaign/ft_landing.
-- transaction_id: a Stripe payment_intent (`pi_...`) or subscription
--   (`sub_...`) id, or a Checkout Session id (`cs_...`) fallback. Opaque
--   platform identifier, not free text: exempt from the digit-run branch of
--   the PII screen the way session_id/client_id/user_id/dedup_key already
--   are (ledgerText, length cap only). A Stripe id can never collide with a
--   13-19 digit bare run (it is always prefixed with letters), but the
--   exemption is stated explicitly rather than relying on that never
--   changing.
--
-- ADDITIVE ONLY: seven nullable columns plus two indexes. Existing readers
-- (the backoffice /funnel page, this repo's own /api/funnel-adjacent code)
-- are untouched. Rows written before this migration keep NULL ft_*/click_id/
-- transaction_id; the funnel page's "earliest ledger row" first-touch method
-- remains the fallback for them (see section 5.2 of the spec, out of scope
-- for this plan).
--
-- NOT RE-RUNNABLE: SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS. A
-- second run of this file errors on the first ALTER with "duplicate column
-- name" and aborts before the remaining six ALTERs and two indexes run.
-- PARTIAL-APPLY RECOVERY: if a run fails partway, do NOT re-run this file.
-- Instead run PRAGMA table_info(conversion_event) against the target
-- database, compare against the seven column names above, and execute only
-- the remaining ALTER TABLE / CREATE INDEX statements one at a time by hand
-- (CREATE INDEX IF NOT EXISTS is always safe to re-run; a bare ALTER TABLE
-- ADD COLUMN is not).
--
-- ROLLBACK: additive and every value is re-derivable from Stripe/the cookie
-- on the next event for a still-active visitor, so a revert is a value
-- revert, not a schema one:
--   UPDATE conversion_event SET ft_source=NULL, ft_medium=NULL,
--     ft_campaign=NULL, ft_landing=NULL, ft_at=NULL, click_id=NULL,
--     transaction_id=NULL;
--
-- Apply (by hand; no runner). MUST run against remote BEFORE the code that
-- binds these columns (Task 5 of the first-touch-attribution plan) deploys:
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/039-first-touch-attribution.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/039-first-touch-attribution.sql
-- Verify: npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(conversion_event)"

ALTER TABLE conversion_event ADD COLUMN ft_source      TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_medium      TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_campaign    TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_landing     TEXT;
ALTER TABLE conversion_event ADD COLUMN ft_at          TEXT;   -- ISO, from d
ALTER TABLE conversion_event ADD COLUMN click_id       TEXT;   -- first-touch gclid/gbraid/wbraid, PII-screened
ALTER TABLE conversion_event ADD COLUMN transaction_id TEXT;   -- Stripe pi_/sub_/cs_ id, opaque: length-capped only, exempt from the digit-run PII screen

CREATE INDEX IF NOT EXISTS idx_conversion_event_ft ON conversion_event (ft_source, ft_medium, ft_campaign);
CREATE INDEX IF NOT EXISTS idx_conversion_event_transaction ON conversion_event (transaction_id);
