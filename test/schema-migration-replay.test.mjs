/**
 * Guards the ONE thing test/_d1-sqlite.mjs cannot guard about itself: that its
 * hand-maintained migration replay list still describes the migrations on disk.
 *
 * BACKGROUND
 * `schema.sql` is a snapshot -- its own header says "Generated from the live
 * database on 2026-05-27 (faithful mirror)". Regenerating it needs a Cloudflare
 * API token, so between regenerations it drifts behind `scripts/migrations/`.
 * Loading it verbatim gives a database WITHOUT email_verification.token, and
 * POST /api/auth/signup 500s on its INSERT. _d1-sqlite.mjs works around that by
 * replaying a short list of post-snapshot migrations on top.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT
 * A replay list is silent about migrations nobody has looked at. Land a new
 * rrm-auth migration, forget the list, and every test in the suite keeps
 * passing against a schema that is missing the column the deployed code writes
 * to. The bug then surfaces to whoever next touches that endpoint, as a
 * mysterious 500 in a green suite -- exactly how the signup case was found.
 *
 * So the invariant here is a PARTITION, not a list: every `.sql` file under
 * scripts/migrations/ must appear in exactly one of POST_SNAPSHOT_MIGRATIONS
 * (replayed) or MIGRATIONS_NOT_REPLAYED (with a written reason). A new
 * migration belongs to neither until someone decides, so the suite fails by
 * name and tells them.
 *
 * WHAT THIS TEST CANNOT DISTINGUISH
 *  - Whether a migration was actually APPLIED to production. It reads files,
 *    not Cloudflare. A migration replayed here but never applied live makes the
 *    harness schema optimistic; that judgement stays with the written reason.
 *  - Whether a `.mjs` migration (scripts/migrations/*.mjs) changed data shape.
 *    Those are data backfills, not DDL, and never affect the built schema, so
 *    the partition scans `.sql` only.
 *  - Semantic equivalence between schema.sql and live rrm-auth. If someone
 *    changes a column IN PLACE on live without writing a migration file, there
 *    is no file to notice and this test stays green.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  sqliteD1,
  POST_SNAPSHOT_MIGRATIONS,
  MIGRATIONS_NOT_REPLAYED,
} from './_d1-sqlite.mjs';

const MIGRATIONS_DIR = new URL('../scripts/migrations/', import.meta.url);
const SCHEMA_PATH = new URL('../schema.sql', import.meta.url);

const onDisk = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const replayed = new Set(POST_SNAPSHOT_MIGRATIONS);
const notReplayed = new Set(Object.keys(MIGRATIONS_NOT_REPLAYED));

/** DDL objects a migration file introduces, read off its own text. */
function declaredObjects(sql) {
  const tables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)]
    .map((m) => m[1]);
  const columns = [...sql.matchAll(/ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+["'`]?(\w+)["'`]?/gi)]
    .map((m) => ({ table: m[1], column: m[2] }));
  const indexes = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)]
    .map((m) => m[1]);
  return { tables, columns, indexes };
}

function readMigration(name) {
  return readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');
}

/** A database loaded with schema.sql ONLY -- no replay. The "before" picture. */
function snapshotOnlyDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

function columnNames(db, table) {
  return db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((r) => r.name);
}

describe('schema.sql migration replay list is self-checking', () => {
  it('every migration on disk is either replayed or explicitly not replayed', () => {
    const unaccounted = onDisk.filter((f) => !replayed.has(f) && !notReplayed.has(f));
    assert.deepEqual(
      unaccounted,
      [],
      `New migration(s) landed with no disposition: ${unaccounted.join(', ')}.\n` +
      'test/_d1-sqlite.mjs builds the test database from the 2026-05-27 schema.sql snapshot\n' +
      'plus a replay list, so a post-snapshot rrm-auth migration that is not replayed leaves\n' +
      'the harness one column behind the deployed code. Decide, in test/_d1-sqlite.mjs:\n' +
      '  - targets rrm-auth AND applied to production AFTER 2026-05-27 -> add to POST_SNAPSHOT_MIGRATIONS\n' +
      '  - anything else (different DB, pre-snapshot, draft/held) -> add to MIGRATIONS_NOT_REPLAYED with the reason'
    );
  });

  it('no migration is in both lists', () => {
    const both = onDisk.filter((f) => replayed.has(f) && notReplayed.has(f));
    assert.deepEqual(both, [], `Contradictory disposition for: ${both.join(', ')}`);
  });

  it('neither list references a migration that no longer exists', () => {
    const present = new Set(onDisk);
    const stale = [...replayed, ...notReplayed].filter((f) => !present.has(f)).sort();
    assert.deepEqual(
      stale,
      [],
      `Stale entries in test/_d1-sqlite.mjs referencing deleted files: ${stale.join(', ')}`
    );
  });

  it('POST_SNAPSHOT_MIGRATIONS has no duplicates (each would apply twice)', () => {
    assert.equal(POST_SNAPSHOT_MIGRATIONS.length, replayed.size);
  });

  it('every not-replayed migration carries a substantive written reason', () => {
    const thin = Object.entries(MIGRATIONS_NOT_REPLAYED)
      .filter(([, reason]) => typeof reason !== 'string' || reason.trim().length < 40)
      .map(([file]) => file);
    assert.deepEqual(
      thin,
      [],
      `These exclusions need a real reason, not a placeholder: ${thin.join(', ')}`
    );
  });

  it('every DDL object the replayed migrations declare is present in the built schema', () => {
    const db = sqliteD1();
    const missing = [];
    for (const name of POST_SNAPSHOT_MIGRATIONS) {
      const { tables, columns, indexes } = declaredObjects(readMigration(name));
      for (const t of tables) {
        if (columnNames(db._sqlite, t).length === 0) missing.push(`${name}: table ${t}`);
      }
      for (const { table, column } of columns) {
        if (!columnNames(db._sqlite, table).includes(column)) missing.push(`${name}: ${table}.${column}`);
      }
      for (const idx of indexes) {
        const row = db._sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?").get(idx);
        if (!row) missing.push(`${name}: index ${idx}`);
      }
    }
    db.close();
    assert.deepEqual(
      missing,
      [],
      `Replay ran but these objects are absent from the harness schema: ${missing.join(', ')}.\n` +
      'applySchema() swallows "duplicate column name" and nothing else, so this means the\n' +
      'replayed file failed for some other reason or declares something it does not create.'
    );
  });

  it('each replayed migration is still load-bearing (prune it once schema.sql catches up)', () => {
    const snapshot = snapshotOnlyDb();
    const redundant = [];
    for (const name of POST_SNAPSHOT_MIGRATIONS) {
      const { tables, columns, indexes } = declaredObjects(readMigration(name));
      const alreadyThere =
        tables.every((t) => columnNames(snapshot, t).length > 0) &&
        columns.every(({ table, column }) => columnNames(snapshot, table).includes(column)) &&
        indexes.every((i) => !!snapshot.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?").get(i));
      const declaresSomething = tables.length + columns.length + indexes.length > 0;
      if (declaresSomething && alreadyThere) redundant.push(name);
    }
    snapshot.close();
    assert.deepEqual(
      redundant,
      [],
      `schema.sql has caught up with: ${redundant.join(', ')}.\n` +
      'Remove them from POST_SNAPSHOT_MIGRATIONS in test/_d1-sqlite.mjs and move them to\n' +
      'MIGRATIONS_NOT_REPLAYED with "already in the snapshot" as the reason. Leaving a caught-up\n' +
      'entry in the replay list is how the list rots into something nobody trusts.'
    );
  });

  it('the specific drift that broke signup is reproduced: token is absent from the raw snapshot and present after replay', () => {
    const snapshot = snapshotOnlyDb();
    const beforeReplay = columnNames(snapshot, 'email_verification');
    snapshot.close();

    const db = sqliteD1();
    const afterReplay = columnNames(db._sqlite, 'email_verification');
    db.close();

    assert.ok(
      beforeReplay.includes('code'),
      'email_verification should exist in schema.sql -- the snapshot itself looks wrong'
    );
    assert.equal(
      beforeReplay.includes('token'), false,
      'schema.sql now has email_verification.token; regenerate the replay-list dispositions'
    );
    assert.ok(
      afterReplay.includes('token'),
      'the replay is supposed to add email_verification.token -- POST /api/auth/signup INSERTs into it'
    );
  });
});
