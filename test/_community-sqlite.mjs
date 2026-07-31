/**
 * A D1-shaped rrm-auth binding that ALSO carries the STUC Action Areas tables.
 *
 * WHY THIS EXISTS
 * ---------------
 * test/_d1-sqlite.mjs builds rrm-auth from `schema.sql` ("Generated from the
 * live database on 2026-05-27") plus a replay list scoped to
 * `scripts/migrations/`. The action-areas surface is in NEITHER:
 *
 *   - Its DDL lives in the ROOT `migrations/` directory
 *     (025-stuc-action-areas.sql, 027-stuc-ownership-requests.sql), which the
 *     replay list does not read and test/schema-migration-replay.test.mjs does
 *     not scan.
 *   - 025's own header records the pre-apply collision check running against
 *     live rrm-auth on 2026-05-29, two days AFTER the snapshot was generated.
 *     So the snapshot predates the migration by construction and cannot
 *     contain action_area, project, area_membership, project_membership,
 *     impact_entry, or community_post.area_id.
 *
 * Load the plain harness and every statement in functions/api/community/areas*
 * and projects* fails to PREPARE with "no such table: action_area". Under
 * test/_helpers.js mockDB the same statements would "succeed" against canned
 * rows, which is the failure mode this whole harness family exists to refuse.
 *
 * WHAT THIS FAKE CANNOT DISTINGUISH (read before trusting a green run)
 * -------------------------------------------------------------------
 *  1. Whether live rrm-auth matches these two migration files. Nothing in the
 *     repo mirrors the post-2026-05-27 shape of these tables, and this harness
 *     cannot query Cloudflare. A column ALTERed onto live by hand leaves these
 *     tests green over the old shape. This is strictly weaker than the columns
 *     schema.sql covers, which at least came from a generated mirror.
 *  2. That the migrations were APPLIED at all. They are read as files. The
 *     endpoints under test are deployed and the hub is live, which is the
 *     evidence, not anything this file checks.
 *  3. Everything test/_d1-sqlite.mjs already lists: D1-vs-SQLite engine
 *     differences, the ~100KB statement cap, real concurrency, and every
 *     non-database service (Stripe, SES, KV).
 *
 * 026-stuc-action-areas-seed.sql is deliberately NOT loaded: it is production
 * seed CONTENT, not schema, and tests that leaned on it would be asserting
 * against whichever areas happened to ship rather than against the endpoint.
 * Seed explicitly with insertArea()/insertProject() instead.
 */
import { readFileSync } from 'node:fs';
import { sqliteD1, SCHEMA_SQL } from './_d1-sqlite.mjs';

/** Root-migrations files, in application order, that define the areas surface. */
export const ACTION_AREA_MIGRATIONS = [
  '025-stuc-action-areas.sql',
  '027-stuc-ownership-requests.sql',
];

export const COMMUNITY_SCHEMA_SQL =
  SCHEMA_SQL + '\n' +
  ACTION_AREA_MIGRATIONS
    .map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
    .join('\n');

/**
 * @param {object} [opts]
 * @param {(db: import('node:sqlite').DatabaseSync) => void} [opts.seed]
 * @param {(call: {sql: string, bindings: any[], db: any}) => void} [opts.interleave]
 * @returns D1-like binding suitable for env.DB on the community surface
 */
export function communityD1({ seed, interleave } = {}) {
  return sqliteD1({ seed, interleave, schemaSql: COMMUNITY_SCHEMA_SQL });
}

// ------------------------------------------------------------------ seeds ---

/** Minimal valid `action_area` row, defaulted to an active ownerless area. */
export function insertArea(db, { id, slug, ...rest }) {
  const row = {
    id, slug, name: `Area ${slug}`, tagline: null, description: null, icon: null,
    bucket: 'research', owner_user_id: null, sort_order: 0, status: 'active',
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
    ...rest,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO action_area (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `project` row, defaulted to a joinable recruiting project. */
export function insertProject(db, { id, slug, areaId, ...rest }) {
  const row = {
    id, area_id: areaId, slug, title: `Project ${slug}`, summary: null, description: null,
    status: 'recruiting', owner_user_id: null, workspace_url: null, pinned: 0, sort_order: 0,
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z',
    ...rest,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO project (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `impact_entry` row. */
export function insertImpact(db, { id, occurredOn, ...rest }) {
  const row = {
    id, area_id: null, project_id: null, kind: 'milestone', title: `Impact ${id}`,
    detail: null, occurred_on: occurredOn, created_by: null,
    created_at: '2026-06-01T00:00:00.000Z',
    ...rest,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO impact_entry (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** node:sqlite rows have a null prototype, which trips assert.deepEqual. */
const plainRows = (rows) => rows.map((r) => ({ ...r }));

/** Reads every area_membership row for a user, so a test can assert STORED state. */
export function areaMemberships(db, userId) {
  return plainRows(db._sqlite
    .prepare('SELECT area_id, role FROM area_membership WHERE user_id = ? ORDER BY area_id')
    .all(userId));
}

/** Reads every project_membership row for a user, so a test can assert STORED state. */
export function projectMemberships(db, userId) {
  return plainRows(db._sqlite
    .prepare('SELECT project_id, role FROM project_membership WHERE user_id = ? ORDER BY project_id')
    .all(userId));
}

/** Reads every ownership request for a user, so a test can assert STORED state. */
export function ownershipRequests(db, userId) {
  return plainRows(db._sqlite
    .prepare('SELECT id, area_id, status, message, decided_at, decided_by FROM area_ownership_request WHERE user_id = ? ORDER BY area_id')
    .all(userId));
}
