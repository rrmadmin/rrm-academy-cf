/**
 * The DDL for the STUC Action Areas subsystem, which `schema.sql` does not have.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `test/_d1-sqlite.mjs` builds its database from `schema.sql` plus a replay list
 * of files under `scripts/migrations/`. Neither source contains `action_area`,
 * `project`, `area_membership`, `project_membership`, `impact_entry`,
 * `area_ownership_request`, or `community_post.area_id`. Confirmed, not assumed:
 *
 *     grep -c action_area schema.sql          -> 0
 *     grep -c area_id     (community_post DDL) -> 0
 *
 * Those objects were created by `migrations/025-stuc-action-areas.sql` and
 * `migrations/027-stuc-ownership-requests.sql`, which live in the REPO-ROOT
 * `migrations/` directory, not `scripts/migrations/`. `schema.sql`'s own header
 * dates it 2026-05-27; migration 025 records its live pre-apply collision check
 * on 2026-05-29. The snapshot is simply older than the subsystem.
 *
 * The consequence is not cosmetic. Two guards that exist precisely to catch this
 * both look the other way:
 *   - `test/schema-migration-replay.test.mjs` partitions `scripts/migrations/`
 *     only, so a root-`migrations/` file belongs to neither half of its
 *     partition and is never named.
 *   - `_d1-sqlite.mjs`'s POST_SNAPSHOT_MIGRATIONS resolves names against
 *     `../scripts/migrations/`, so a root migration cannot be listed there
 *     without changing the path it resolves.
 * A test that reached for `action_area` under the stock harness would fail with
 * "no such table" and read as a broken test rather than as a stale schema.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 *  1. That live rrm-auth matches these two files. They are the committed
 *     intent; regenerating `schema.sql` is what would settle it. If someone
 *     altered the live tables in place, nothing here notices.
 *  2. Foreign keys. `sqliteD1()` disables them to match D1, so every
 *     `REFERENCES` below is as decorative here as it is in production. The
 *     endpoints' explicit `db.batch()` child cleanup is the only thing holding
 *     referential integrity, which is exactly what the DELETE tests exercise.
 *
 * `026-stuc-action-areas-seed.sql` is deliberately NOT replayed: it is data, not
 * DDL, and its eleven seeded areas would silently become the fixture of every
 * test that counted rows.
 */
import { readFileSync } from 'node:fs';
import { sqliteD1, insertUser, POST_SNAPSHOT_MIGRATIONS } from './_d1-sqlite.mjs';

/** Repo-root migrations that carry Action Areas DDL, in apply order. */
export const ROOT_MIGRATIONS = [
  '025-stuc-action-areas.sql',
  '027-stuc-ownership-requests.sql',
];

function read(url) {
  return readFileSync(url, 'utf8');
}

/**
 * `schema.sql` + the post-snapshot replay list + the Action Areas migrations.
 *
 * POST_SNAPSHOT_MIGRATIONS is imported rather than restated so this composition
 * cannot drift away from the one `_d1-sqlite.mjs` applies by default.
 *
 * @returns {string} DDL to hand to `sqliteD1({ schemaSql })`
 */
export function communitySchemaSql() {
  let sql = read(new URL('../schema.sql', import.meta.url));
  for (const name of POST_SNAPSHOT_MIGRATIONS) {
    sql += '\n' + read(new URL(`../scripts/migrations/${name}`, import.meta.url));
  }
  for (const name of ROOT_MIGRATIONS) {
    sql += '\n' + read(new URL(`../migrations/${name}`, import.meta.url));
  }
  return sql;
}

/**
 * `sqliteD1()` over the composed schema. Same options, same D1-shaped return.
 *
 * @param {object} [opts]
 * @param {(db: import('node:sqlite').DatabaseSync) => void} [opts.seed]
 * @param {(call: {sql: string, bindings: any[], db: any}) => void} [opts.interleave]
 */
export function communityD1({ seed, interleave } = {}) {
  return sqliteD1({ seed, interleave, schemaSql: communitySchemaSql() });
}

// ------------------------------------------------------------------ seeds ---
//
// Rows are written with explicit column lists rather than through the endpoints
// so a fixture can express states the endpoints refuse to create (an archived
// area, an owner_user_id pointing at a deleted user, a stale membership row).
// That is the point: several of the behaviours under test only appear once the
// database is already in a shape one endpoint produced and another must survive.

/** Minimal valid `action_area` row. Defaults to an ownerless active area. */
export function insertArea(sqlite, { id, slug = id, name = id, ...rest }) {
  const row = {
    id, slug, name, tagline: null, description: null, icon: null,
    bucket: 'research', owner_user_id: null, sort_order: 0, status: 'active',
    ...rest,
  };
  const cols = Object.keys(row);
  sqlite.prepare(`INSERT INTO action_area (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `project` row. */
export function insertProject(sqlite, { id, areaId, slug = id, title = id, ...rest }) {
  const row = {
    id, area_id: areaId, slug, title, summary: null, description: null,
    status: 'recruiting', owner_user_id: null, workspace_url: null,
    pinned: 0, sort_order: 0,
    ...rest,
  };
  const cols = Object.keys(row);
  sqlite.prepare(`INSERT INTO project (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `impact_entry` row. */
export function insertImpact(sqlite, { id, areaId = null, projectId = null, ...rest }) {
  const row = {
    id, area_id: areaId, project_id: projectId, kind: 'milestone',
    title: id, detail: null, occurred_on: '2026-01-01', created_by: null,
    ...rest,
  };
  const cols = Object.keys(row);
  sqlite.prepare(`INSERT INTO impact_entry (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `area_ownership_request` row. */
export function insertOwnershipRequest(sqlite, { id, areaId, userId, ...rest }) {
  const row = {
    id, area_id: areaId, user_id: userId, status: 'pending',
    message: null, decided_at: null, decided_by: null,
    ...rest,
  };
  const cols = Object.keys(row);
  sqlite.prepare(`INSERT INTO area_ownership_request (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

export function insertAreaMembership(sqlite, { userId, areaId, role = 'member' }) {
  sqlite.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)')
    .run(userId, areaId, role);
}

export function insertProjectMembership(sqlite, { userId, projectId, role = 'member' }) {
  sqlite.prepare('INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, ?)')
    .run(userId, projectId, role);
}

export { insertUser };
