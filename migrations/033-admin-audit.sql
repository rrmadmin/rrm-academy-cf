-- 033-admin-audit.sql
-- Admin audit trail for the RRM Backoffice (admin.rrmacademy.org, repo rrmadmin/rrm-backoffice) -- additive migration on rrm-auth (D1).
--
-- WHY
-- The RRM Backoffice writes one row per operator mutation. This is the
-- canonical home for the DDL because rrm-auth has ONE migration history
-- (this repo); rrm-backoffice vendors a read-only copy of this file under
-- schema/. No other repo may fork this table's definition.
--
-- ADDITIVE ONLY: one table + two indexes, IF NOT EXISTS throughout so
-- re-running this file is a no-op. Nothing is dropped or altered.
--
-- FK NOTE: no foreign key. actor is an Access email, not a row in the user
-- table, so there is nothing to reference.
--
-- COLUMN NOTES
-- id: the writer's request id (UUID).
-- before_json / after_json: JSON text, capped per field by the writer at
--   8192 bytes. When a value would exceed the cap the writer stores
--   {"_truncated":true,"length":N,"head":"..."} instead of the full value.
--
-- ROLLBACK: DROP TABLE admin_audit is safe only until the first surface
-- writes to it (rrm-backoffice C3, the audit() implementation). After that
-- point this table is never dropped.
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/033-admin-audit.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/033-admin-audit.sql

CREATE TABLE IF NOT EXISTS admin_audit (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  row_id      TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_entity_row ON admin_audit(entity, row_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);
