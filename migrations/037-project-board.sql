-- 037-project-board.sql
-- Operational project board (rrm-backoffice /projects, component projects-board)
-- -- additive migration on rrm-auth (D1).
--
-- WHY
-- The RRM Backoffice writes one table per generated view it renders; this is
-- the canonical home for the DDL because rrm-auth has ONE migration history
-- (this repo). rrm-backoffice vendors a read-only copy of this file under
-- schema/037-project-board.sql (the same precedent 033-admin-audit.sql set,
-- and the one fsp-admin's schema/0017-project-items.sql follows for fsp-crm).
--
-- THIS TABLE IS A GENERATED VIEW AND NOT A SOURCE OF TRUTH, which is the one
-- fact that governs every other decision below. The document of record is
-- `board/board.config.mjs` + `board/workstreams/*.mjs` in the rrm-backoffice
-- working tree -- plain data modules, committed, one file per workstream.
-- `tools/board-sync/sync.mjs` reads them and REPLACES this table's rows for
-- one workstream at a time. Everything that follows from that:
--   * No column here is ever hand-edited. `functions/api/projects.js` exposes
--     no PATCH and no DELETE over this table -- an edit made here would be
--     silently overwritten by the next sync, and the operator would have no
--     way to see that it had been. The edit goes in the config file, and the
--     sync runs again.
--   * A row's identity is `item_key`, not `id`. The key is
--     `<workstream>:<id>`, where `<id>` is the stable per-workstream string
--     the config module names each item with -- so the same item carries the
--     same key across syncs, and a title can be reworded freely without
--     anything losing track of which item it is. UNIQUE, so two workstreams
--     can never mint one key and a rename can never quietly fork an item in
--     two.
--   * `synced_at` carries NO DEFAULT on purpose. The writer stamps one value
--     for a whole replace, so every row of one sync agrees to the second and
--     "when did this workstream last sync" is answerable by reading any of
--     its rows. A column default would be evaluated per statement instead,
--     which is the one thing that would make that question un-answerable.
--
-- AUTOINCREMENT IS LOAD-BEARING HERE, unlike on a table nothing ever
-- replaces wholesale. Every sync deletes a workstream's rows and inserts the
-- new set, so without it SQLite would hand the fresh rows the ids the deleted
-- ones just gave up, and an admin_audit row or a copied link naming id 41
-- would come to mean a different item than it did an hour ago. With it, an id
-- is spent once and a stale reference resolves to nothing rather than to
-- somebody else's work.
--
-- NO CHECK CONSTRAINTS ON THE VOCABULARIES, and there are three of them
-- (`kind` is Milestone or Task; `stage` is one of seven; `confidence` is one
-- of five -- see tools/board-sync/sync.mjs and functions/api/projects.js,
-- which hold the one copy each). Same posture 0017's `lane`/`stage`/`timing`
-- take: the writer enforces the vocabulary, the schema holds text. A new
-- stage should cost a constant in two files, never a table rebuild against a
-- live database.
--
-- `deadline` AND `start` ARE TEXT 'YYYY-MM-DD', PAIRED OR NULL. A `start`
-- with no `deadline` would draw half a timeline bar, and a `start` after its
-- `deadline` would draw one running backwards; both the sync tool and the API
-- refuse the pair rather than store a bar this table cannot draw. NULL
-- rather than '' so "undated" is one value and sorts as one.
--
-- ADDITIVE ONLY. One new table + one new index; no existing table or column
-- changes. Re-running is safe: every statement is guarded with IF NOT EXISTS.
--
-- REVERT is `DROP TABLE project_board_items;` ALONE -- SQLite drops
-- idx_project_board_workstream automatically when its table is dropped, so a
-- second `DROP INDEX` statement would throw `no such index` against an
-- index that is already gone. The revert loses nothing that is not
-- regenerable: the config modules are the source, and re-applying this
-- migration and re-running the sync rebuilds every row. That is the whole
-- point of the table being a view. (It does lose the id sequence, so any
-- admin_audit row naming a project_board_items id predates the drop and
-- cannot be resolved after it -- the audit rows this table's writer produces
-- file under entity `project_board_items` with row_id sentinel `0` (never
-- null) and name the workstream inside the diff itself, for exactly that
-- reason: the whole-table replace is one change to one workstream, not N
-- row edits.)
--
-- Apply (by hand; no runner):
--   npx wrangler d1 execute rrm-auth --local  --file=migrations/037-project-board.sql
--   npx wrangler d1 execute rrm-auth --remote --file=migrations/037-project-board.sql

CREATE TABLE IF NOT EXISTS project_board_items (
  -- Never reused: see the AUTOINCREMENT note above.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The workstream this item belongs to. The unit of a sync is one
  -- workstream: a replace deletes and rewrites exactly this workstream's rows
  -- and never touches another's, so one stale clone cannot empty another
  -- workstream's board.
  workstream TEXT NOT NULL,
  -- The stable sync key, `<workstream>:<id>`. This is the row's identity;
  -- `id` is only its storage. UNIQUE across the whole table, so a
  -- workstream-slug typo that would have filed one workstream's item under
  -- another is a refusal rather than a duplicate.
  item_key TEXT NOT NULL UNIQUE,
  -- 'Milestone' or 'Task'. Free text; the writer holds the vocabulary.
  kind TEXT NOT NULL,
  -- The item's own title.
  title TEXT NOT NULL,
  -- Free text, workstream-defined grouping within its own board (not a
  -- cross-workstream vocabulary the way `stage` and `confidence` are).
  lane TEXT,
  -- Done | In motion | Ready | Waiting | Blocked | Date-locked | Target.
  -- Free text, as above.
  stage TEXT,
  -- YYYY-MM-DD, or NULL for an item that has no date yet.
  deadline TEXT,
  -- YYYY-MM-DD. NULL whenever `deadline` is NULL: the pair draws a bar, and
  -- half a bar is worse than a point.
  start TEXT,
  -- Confirmed | Estimated | Gated | Recurring | Unknown: how much to trust
  -- the two dates above. Free text, as above.
  confidence TEXT,
  -- Free prose giving the operational context a title alone cannot carry.
  note TEXT,
  -- An optional link out (a board, a doc, a tracker row).
  url TEXT,
  -- When this row was last written by a sync, an ISO 8601 UTC instant
  -- ('2026-08-26T19:43:00.000Z', new Date().toISOString()). Stamped by the
  -- writer, one value per replace, and deliberately without a column
  -- default -- see the header. ISO rather than datetime('now')'s
  -- 'YYYY-MM-DD HH:MM:SS' because the writer is a Node CLI outside this
  -- database, and the two shapes still compare correctly against each other
  -- as plain TEXT (both are zero-padded and sort chronologically).
  synced_at TEXT NOT NULL
);

-- The natural read: one workstream's board, and the cross-workstream grouped
-- read the /projects page renders by default.
CREATE INDEX IF NOT EXISTS idx_project_board_workstream ON project_board_items(workstream);
