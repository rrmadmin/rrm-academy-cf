-- migrations/030-donor-gift.sql
-- Donor data layer Phase 1 (spec: ~/iCode/docs/superpowers/specs/2026-06-11-donor-management-automation-design.md (outside this repo)).
-- donor_gift is a CRM mirror of per-donor giving history. It is NOT accounting
-- truth: the RRM Foundation Google Sheet ledger remains the 990 SSOT.
--
-- Conventions (binding on ALL writers: webhook helper, daemon, backfill):
--   occurred_at  UTC ISO-8601 with 'T' and 'Z' (new Date(x).toISOString()); writers
--                MUST normalize before insert -- mixed formats break lexicographic
--                ordering and recency queries.
--   source_id    stripe = payment_intent id (fallback: any per-payment-unique id --
--                charge id in API sweeps, checkout session id in the webhook; NEVER
--                subscription id), wix = wix_order_id, paypal = transaction_id,
--                manual = caller-chosen deterministic id (re-runs must not duplicate).
--   inserts      use INSERT ... ON CONFLICT(source, source_id) DO NOTHING, not bare
--                INSERT OR IGNORE: dedupe stays silent but NOT NULL / CHECK
--                violations must throw, not vanish.
--   ppgf         1 = PayPal Giving Fund gift (PPGF sends its own receipts; receipt
--                queries must exclude ppgf=1 rows to honor the no-double-receipt rule).
--   receipt_year is the UTC year of occurred_at (CRM convention, not accounting truth).
--   contact_id   intentionally NO foreign key: backfill may insert gifts before the
--                contact row exists; email (COLLATE NOCASE) is the canonical join key.
--
-- Run:
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/030-donor-gift.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/030-donor-gift.sql

CREATE TABLE IF NOT EXISTS donor_gift (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL COLLATE NOCASE,
  display_name  TEXT,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  source        TEXT NOT NULL CHECK(source IN ('stripe','wix','paypal','manual')),
  source_id     TEXT NOT NULL,
  entity        TEXT NOT NULL DEFAULT 'foundation' CHECK(entity IN ('foundation','academy')),
  kind          TEXT NOT NULL DEFAULT 'one_time' CHECK(kind IN ('one_time','recurring','membership','course')),
  ppgf          INTEGER NOT NULL DEFAULT 0,
  occurred_at   TEXT NOT NULL,
  receipt_year  INTEGER,
  receipted_at  TEXT,
  contact_id    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_donor_gift_email ON donor_gift(email);
CREATE INDEX IF NOT EXISTS idx_donor_gift_occurred ON donor_gift(occurred_at);
CREATE INDEX IF NOT EXISTS idx_donor_gift_receipt_year ON donor_gift(receipt_year);

ALTER TABLE contact ADD COLUMN first_gift_at TEXT;
ALTER TABLE contact ADD COLUMN last_gift_at TEXT;
ALTER TABLE contact ADD COLUMN gift_count INTEGER DEFAULT 0;
ALTER TABLE contact ADD COLUMN donor_stage TEXT;

-- Refund policy: refunded gifts keep their row (audit), get refunded_at stamped, and
-- are excluded from rollups + receipts (queries filter refunded_at IS NULL).
ALTER TABLE donor_gift ADD COLUMN refunded_at TEXT;
