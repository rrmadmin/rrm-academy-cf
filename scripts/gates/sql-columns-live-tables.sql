-- ============================================================================
-- sql-columns-live-tables.sql
--
-- DDL for tables that EXIST in live D1 `rrm-auth` but have no DDL anywhere in
-- this repository: not in schema.sql (the 2026-05-27 generated mirror), not in
-- scripts/migrations/, not in the root migrations/ directory.
--
-- Read ONLY by scripts/gates/validate-sql-columns.mjs, which builds an
-- in-memory SQLite database and PREPAREs every static SQL string in the repo
-- against it. Without these tables the gate could not tell "this endpoint
-- queries a table that does not exist" from "this endpoint queries a table the
-- committed mirror never captured", and would have to skip both.
--
-- PROVENANCE: pulled verbatim on 2026-07-31 from live rrm-auth with
--   npx wrangler d1 execute rrm-auth --remote --json --command \
--     "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND tbl_name IN (...)"
-- The `-- none | drafted | sent | expired` style comments are the live DDL's
-- own; they came back in the sqlite_master text and are preserved verbatim so
-- a future re-pull diffs cleanly.
--
-- WHY THE dm_* TABLES ARE HERE, SPECIFICALLY
-- An adversarial verifier reading only schema.sql + scripts/migrations/
-- reported functions/api/admin/dm-queue.js and dm-queue/[id].js as querying
-- five nonexistent tables and recommended deleting the endpoints. They are not
-- nonexistent: dm_draft, dm_thread, dm_message, dm_comment and dm_send_log are
-- all present in live rrm-auth with the shapes below. This is the same stale-
-- mirror trap as email_log.ses_message_id: the snapshot lagged production, and
-- the deployed code was right. Nothing was deleted.
--
-- MAINTENANCE: this file is a MIRROR, never a migration. Do not apply it to any
-- database. When a table here gains real committed DDL (a migration file), drop
-- it from this file and let the migration be the source. When live gains a
-- table the repo never declares, add it here WITH its provenance line, or the
-- gate will fail on the first statement that touches it -- which is the point.
-- ============================================================================

-- ---------------------------------------------------------------- dm queue --
-- Instagram DM / comment approval queue. Consumers:
--   functions/api/admin/dm-queue.js, functions/api/admin/dm-queue/[id].js
-- Written by the (separate) rrm-dm-agent worker; no DDL was ever committed here.

CREATE TABLE IF NOT EXISTS dm_thread (
  igsid            TEXT PRIMARY KEY,
  first_seen       TEXT NOT NULL DEFAULT (datetime('now')),
  last_inbound_at  TEXT,
  last_outbound_at TEXT,
  last_intent      TEXT,
  needs_human      INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'open',
  suppressed       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dm_message (
  mid              TEXT PRIMARY KEY,
  thread_igsid     TEXT NOT NULL,
  direction        TEXT NOT NULL,               -- 'in' | 'out' | 'echo'
  text             TEXT,
  attachments_json TEXT,
  intent           TEXT,
  is_ack           INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_comment (
  comment_id             TEXT PRIMARY KEY,
  media_id               TEXT,
  from_id                TEXT,
  from_username          TEXT,
  text                   TEXT,
  parent_id              TEXT,
  private_reply_state    TEXT NOT NULL DEFAULT 'none',  -- none | drafted | sent | expired
  reply_window_expires_at TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_draft (
  id                TEXT PRIMARY KEY,
  thread_igsid      TEXT NOT NULL,
  source            TEXT NOT NULL,              -- 'dm' | 'comment'
  source_ref        TEXT,                       -- comment_id when source='comment'
  tier              TEXT NOT NULL,              -- 't1' | 't2'
  intent            TEXT,
  draft_text        TEXT NOT NULL,
  final_text        TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  window_expires_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at        TEXT,
  decided_by        TEXT
);

CREATE TABLE IF NOT EXISTS dm_send_log (
  id              TEXT PRIMARY KEY,
  draft_id        TEXT,
  thread_igsid    TEXT,
  target          TEXT NOT NULL,                -- 'dm' | 'comment_private_reply'
  meta_message_id TEXT,
  status          TEXT NOT NULL,                -- 'sent' | 'failed'
  error_detail    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dm_draft_status ON dm_draft (status, window_expires_at);
CREATE INDEX IF NOT EXISTS idx_dm_draft_thread ON dm_draft (thread_igsid, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_message_thread ON dm_message (thread_igsid, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_send_log_created ON dm_send_log (created_at);

-- ------------------------------------------------------ legacy + ledger ----

-- Thinkific order history imported 2026-06-05 from the dissolved RRM Academy LLC.
CREATE TABLE IF NOT EXISTS legacy_thinkific_order (
  order_id INTEGER PRIMARY KEY,
  order_number INTEGER,
  site TEXT,
  student TEXT,
  email TEXT,
  thinkific_user_id INTEGER,
  order_date TEXT,
  value_cents INTEGER,
  status TEXT,
  payment_method TEXT,
  product TEXT,
  promotion TEXT,
  coupon_code TEXT,
  application_fee_cents INTEGER,
  referral TEXT,
  instructors TEXT,
  is_masterclass INTEGER,
  source_entity TEXT DEFAULT 'RRM Academy LLC (dissolved)',
  source_platform TEXT DEFAULT 'thinkific',
  imported_at TEXT DEFAULT '2026-06-05'
);

-- Idempotency ledger for Wix subscription/payment admin notifications.
CREATE TABLE IF NOT EXISTS wix_notify_ledger (
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, entity_id)
);
