/**
 * A D1-shaped database backed by a REAL SQLite engine (node:sqlite), built from
 * the repo's committed `schema.sql`.
 *
 * WHY THIS EXISTS
 * ---------------
 * test/_helpers.js `mockDB()` matches SQL by substring and hands back canned
 * rows. It models placeholder-level `COLLATE NOCASE` (added 2026-07-28) but it
 * cannot model anything the SQL engine actually decides:
 *   - column-level collation declared in the schema
 *     (`donor_gift.email TEXT NOT NULL COLLATE NOCASE`)
 *   - collation on a column-to-column comparison with no placeholder at all
 *     (`ws.email = u.email COLLATE NOCASE` inside STUC_MEMBER_WHERE)
 *   - UNIQUE indexes, including the functional `idx_user_email_nocase`
 *   - joins, subselects, GROUP BY/HAVING, datetime()/strftime()
 * Every membership-report collation site is one of those shapes, so under
 * mockDB every assertion about them is decorative.
 *
 * This harness runs the statement. `schema.sql` is the generated mirror of the
 * live rrm-auth database ("Generated from the live database on 2026-05-27
 * (faithful mirror)"), so the collations under test are PRODUCTION collations,
 * not collations this file invented. That distinction is the whole point: three
 * of the email columns are declared `COLLATE NOCASE` and `user.email` is not,
 * and a test that guessed differently would prove the wrong thing.
 *
 * WHAT THIS FAKE CANNOT DISTINGUISH (read before trusting a green run)
 * -------------------------------------------------------------------
 *  1. Schema drift SINCE 2026-05-27. `schema.sql` is a snapshot, not a live
 *     read. A migration that changed a column collation without regenerating
 *     the file would leave these tests green and wrong. `schemaCollation()`
 *     below is exported so a test can assert the collation it depends on, which
 *     at least turns silent drift into a named failure.
 *  2. D1-vs-SQLite engine differences: D1's ~100KB statement cap, its bigint
 *     handling, its network errors, and its batch atomicity guarantees. A test
 *     that needs "D1 threw" should still use a throwing stub.
 *  3. Concurrency. SQLite here is one synchronous connection; two "isolates"
 *     never truly interleave. Races are simulated explicitly via the `interleave`
 *     option, which is a scripted stand-in for a concurrent writer, not proof
 *     that the real race window is what the test says it is.
 *  4. Anything outside the database: Stripe, SES, KV, Turnstile. Those still
 *     come from _helpers.js.
 *  5. Foreign keys are deliberately DISABLED to match D1 (see newDb() below), so
 *     nothing here proves a referential-integrity guarantee. Orphan rows are
 *     writable, exactly as they are in production; the explicit child-cleanup
 *     discipline the endpoints follow is what actually holds that line.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA_PATH = new URL('../schema.sql', import.meta.url);

/**
 * schema.sql is a snapshot ("Generated from the live database on 2026-05-27"),
 * so anything migrated into rrm-auth AFTER that date is missing from it. These
 * are replayed on top, in order, to reach the shape the deployed code writes to.
 *
 * Membership rule: an entry belongs here only if (a) its target database is
 * rrm-auth and (b) it has actually been applied to production. Migrations
 * targeting rrm-survey / rrm-library / rrm-survey-symptoms do not belong.
 *
 * A FILE HEADER IS NOT A DEPLOYMENT RECORD. Membership turns on what live
 * rrm-auth actually contains, which is settled by querying it:
 *   wrangler d1 execute rrm-auth --remote \
 *     --command "SELECT name FROM pragma_table_info('email_log')"
 * 2026-06-28-email-event.sql sat in the exclusion list on the strength of its
 * own "DRAFT / HELD. Do NOT apply" header. That header is stale: the live
 * query on 2026-07-31 returns email_log columns id, event, email, category,
 * source, subject, detail, send_id, ses_message_id, the email_event table
 * exists, and email_log holds 1728 rows with 937 written since 2026-06-28.
 * The migration is applied. Excluding it left the harness BEHIND production,
 * so insertEmailLog()'s eight-column INSERT failed in tests only and read as a
 * production outage that was never happening.
 *
 * Discovered the hard way: without the token column, POST /api/auth/signup 500s
 * on its INSERT INTO email_verification -- a green suite over a stale schema
 * would have been the exact failure mode this harness exists to prevent.
 *
 * When schema.sql is regenerated, entries here become no-ops (SQLite reports
 * "duplicate column name", which the loader swallows for ALTER ... ADD COLUMN
 * only). Prune them then.
 */
export const POST_SNAPSHOT_MIGRATIONS = [
  '2026-05-27-community-post-speaker.sql',
  '2026-06-20-email-verification-token.sql',
  '2026-06-28-email-event.sql',
];

/**
 * The other half of the same decision: every migration file that is NOT
 * replayed, with the written reason it is not.
 *
 * Why both halves are declared instead of just the replay list: a replay list
 * on its own is silent about a migration nobody has looked at. A NEW rrm-auth
 * migration would land, no entry anywhere, and the harness would keep building
 * a schema that is missing the column the deployed code writes to -- the exact
 * shape of the signup 500 above, rediscovered by whoever happens to touch that
 * endpoint next.
 *
 * test/schema-migration-replay.test.mjs holds the invariant: every `.sql` file
 * under scripts/migrations/ appears in EXACTLY ONE of these two structures. Add
 * a migration and the suite fails by name until you decide which it is, so the
 * next person is told rather than surprised.
 *
 * @type {Record<string, string>} filename -> reason it is not replayed
 */
export const MIGRATIONS_NOT_REPLAYED = {
  '2026-05-19-word-count-rrm-auth.sql':
    'Targets rrm-auth but predates the 2026-05-27 snapshot, so glossary_term.word_count and its index are already inside schema.sql. Replaying would be a duplicate-column no-op.',
  '2026-05-19-word-count-rrm-library.sql':
    'Targets the rrm-library database, not rrm-auth. schema.sql mirrors rrm-auth only; the library schema lives in projects/rrm-cli/schema/d1-library.sql.',
  '2026-06-01-google-id-unique.sql':
    'Targets rrm-auth. Applied to production, but its UNIQUE index on user(google_id) is already present in schema.sql (see idx_user_google_id_unique). Replaying is a no-op guarded by IF NOT EXISTS.',
  '2026-06-13-quiz-result.sql':
    'Targets the rrm-survey database (binding SURVEY_DB), not rrm-auth. Loaded separately by test/_survey-sqlite.mjs, which builds the SURVEY_DB harness from these files.',
  '2026-06-26-survey-symptoms.sql':
    'Targets the rrm-survey-symptoms database (binding SURVEY_SYMPTOMS_DB), not rrm-auth. Loaded separately by test/_survey-sqlite.mjs symptomsD1(), which builds the SURVEY_SYMPTOMS_DB harness from this file.',
  '2026-07-02-quiz-events-and-rules-version.sql':
    'Targets the rrm-survey database (binding SURVEY_DB), not rrm-auth. Loaded by test/_survey-sqlite.mjs alongside the quiz_result migration.',
  'ai-search-docs.sql':
    'Targets rrm-auth, applied 2026-04-28, well before the snapshot. The ai_search_docs table was subsequently DROPPED (see the schema.sql comment block); replaying it would resurrect a retired table.',
};

function buildSchemaSql() {
  let sql = readFileSync(SCHEMA_PATH, 'utf8');
  for (const name of POST_SNAPSHOT_MIGRATIONS) {
    sql += '\n' + readFileSync(new URL(`../scripts/migrations/${name}`, import.meta.url), 'utf8');
  }
  return sql;
}

const SCHEMA_SQL = buildSchemaSql();

/**
 * Executes the schema, tolerating ONLY the "already added" error an
 * ALTER TABLE ADD COLUMN raises once schema.sql catches up with a replayed
 * migration. Every other DDL error is a real problem and is rethrown.
 */
function applySchema(db, schemaSql = SCHEMA_SQL) {
  try {
    db.exec(schemaSql);
    return;
  } catch {
    // Fall through to statement-at-a-time so the duplicate-column case can be
    // isolated instead of aborting the whole file.
  }
  for (const raw of schemaSql.split(/;\s*(?:\r?\n|$)/)) {
    const stmt = raw.trim();
    if (!stmt || /^--/.test(stmt) && !/\n/.test(stmt)) continue;
    try {
      db.exec(stmt + ';');
    } catch (err) {
      if (/duplicate column name/i.test(err.message)) continue;
      throw new Error(`schema load failed on:\n${stmt.slice(0, 200)}\n${err.message}`);
    }
  }
}

/**
 * A database configured the way D1 configures one.
 *
 * node:sqlite turns foreign-key enforcement ON by default; D1 does NOT run
 * `PRAGMA foreign_keys = ON` per connection, which is why every ON DELETE
 * CASCADE in schema.sql is decorative and why the endpoints do explicit child
 * cleanup in db.batch() (CLAUDE.md, SQL discipline). Leaving enforcement on
 * would make this harness STRICTER than production: an orphan row that D1
 * accepts every day would be un-writable here, so a handler's behaviour on
 * orphan data could not be tested at all, and a missing explicit-cleanup bug
 * would be masked by an engine constraint production does not have.
 */
function newDb() {
  return new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
}

/** D1 accepts booleans and rejects undefined; node:sqlite rejects both. */
function coerce(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** node:sqlite rows have a null prototype, which trips deepEqual and spreads. */
function plain(row) {
  return row === undefined || row === null ? null : { ...row };
}

/**
 * Reads the collating sequence the LIVE-MIRRORED schema declares for a column.
 *
 * SQLite picks the collation of a binary comparison from, in order: an explicit
 * COLLATE operator, then the left operand's column collation, then the right
 * operand's. So a query-level `COLLATE NOCASE` is only load-bearing when the
 * column it compares is BINARY. Tests use this to say out loud which of the two
 * they are actually holding.
 *
 * @returns {'BINARY'|'NOCASE'|'RTRIM'}
 */
export function schemaCollation(table, column) {
  const db = newDb();
  applySchema(db);
  const rows = db.prepare(`SELECT name, "notnull" FROM pragma_table_info(?)`).all(table);
  if (!rows.some((r) => r.name === column)) {
    db.close();
    throw new Error(`schemaCollation: ${table}.${column} does not exist in schema.sql`);
  }
  // pragma_table_info does not expose collation, so read it off the DDL text.
  const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(table).sql;
  db.close();
  const decl = new RegExp(`(^|[\\s,(])${column}\\s+[^,)]*`, 'i').exec(ddl);
  if (!decl) throw new Error(`schemaCollation: could not locate ${table}.${column} in its DDL`);
  const collate = /\bCOLLATE\s+(BINARY|NOCASE|RTRIM)\b/i.exec(decl[0]);
  return collate ? collate[1].toUpperCase() : 'BINARY';
}

/**
 * Builds a D1-shaped binding over an in-memory SQLite database loaded with the
 * full committed schema.
 *
 * @param {object} [opts]
 * @param {(db: DatabaseSync) => void} [opts.seed] - runs once, after the schema
 *   is created, with the raw node:sqlite handle. Seed with INSERTs, not with
 *   canned query results.
 * @param {(call: {sql: string, bindings: any[], db: DatabaseSync}) => void} [opts.interleave]
 *   - called immediately BEFORE each statement executes. Use it to simulate a
 *   concurrent writer landing between two statements of the handler under test.
 * @param {string} [opts.schemaSql] - DDL to load INSTEAD of the rrm-auth
 *   snapshot. Only for a binding that is not rrm-auth: SURVEY_DB (rrm-survey)
 *   has no committed snapshot at all, so test/_survey-sqlite.mjs composes its
 *   DDL from the committed migration files and passes it here. Defaults to the
 *   rrm-auth snapshot plus POST_SNAPSHOT_MIGRATIONS.
 * @returns D1-like { prepare, batch, _calls, _sqlite, close }
 */
export function sqliteD1({ seed, interleave, schemaSql } = {}) {
  const sqlite = newDb();
  applySchema(sqlite, schemaSql);
  if (seed) seed(sqlite);

  const _calls = [];

  function exec(sql, bindings, method) {
    _calls.push({ sql, bound: bindings, method });
    if (interleave) interleave({ sql, bindings, db: sqlite });
    const stmt = sqlite.prepare(sql);
    const args = bindings.map(coerce);
    if (method === 'first') return plain(stmt.get(...args));
    if (method === 'all') {
      const results = stmt.all(...args).map((r) => ({ ...r }));
      return { results, success: true, meta: { changes: 0, rows_read: results.length } };
    }
    const info = stmt.run(...args);
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
        rows_written: Number(info.changes),
      },
    };
  }

  function makeStmt(sql) {
    return {
      _sql: sql,
      _bindings: [],
      bind(...args) { this._bindings = args; return this; },
      async first() { return exec(this._sql, this._bindings, 'first'); },
      async all() { return exec(this._sql, this._bindings, 'all'); },
      async run() { return exec(this._sql, this._bindings, 'run'); },
    };
  }

  return {
    _calls,
    _sqlite: sqlite,
    prepare(sql) { return makeStmt(sql); },
    /**
     * D1 batches run in an implicit transaction and return one result object per
     * statement, each carrying `.results` whether or not it selected rows --
     * membership-report's runReads() reads `res[i].results` off every entry.
     */
    async batch(stmts) {
      const out = [];
      sqlite.exec('BEGIN');
      try {
        for (const stmt of stmts) {
          const isRead = /^\s*(SELECT|WITH)\b/i.test(stmt._sql);
          out.push(isRead
            ? exec(stmt._sql, stmt._bindings, 'all')
            : { ...exec(stmt._sql, stmt._bindings, 'run'), results: [] });
        }
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return out;
    },
    close() { sqlite.close(); },
  };
}

// ------------------------------------------------------------------ seeds ---

/** Minimal valid `user` row. `email` is stored VERBATIM -- case included. */
export function insertUser(db, { id, email, ...rest }) {
  const row = {
    id, email, email_verified: 1, hashed_password: '', name: null,
    first_name: null, last_name: null, google_id: null, blocked: 0,
    stripe_customer_id: null, role: 'member', created_at: '2026-01-01T00:00:00.000Z',
    ...rest,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO user (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `wix_subscription` row, defaulted to a genuinely active sub. */
export function insertWixSubscription(db, { email, ...rest }) {
  const nowIso = new Date().toISOString();
  const soon = new Date(Date.now() + 20 * 86400e3).toISOString();
  const row = {
    wix_subscription_id: `wsub_${Math.random().toString(36).slice(2)}`,
    user_id: null, contact_id: 'wc_1', email, tier: 'member', amount_cents: 900,
    currency: 'USD', frequency: 'MONTH', status: 'active', started_at: nowIso,
    last_order_at: nowIso, next_expected_at: soon, cycle_count: 1, auto_renewal: 1,
    product_id: 'stuc', product_source: 'stores', updated_at: nowIso,
    migration_status: 'pending',
    ...rest,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO wix_subscription (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `donor_gift` row. */
export function insertDonorGift(db, { email, ...rest }) {
  const row = {
    id: `dg_${Math.random().toString(36).slice(2)}`,
    email, display_name: null, amount_cents: 2500, currency: 'USD',
    source: 'stripe', source_id: `pi_${Math.random().toString(36).slice(2)}`,
    entity: 'foundation', kind: 'one_time', ppgf: 0,
    occurred_at: new Date().toISOString(), receipt_year: 2026,
    contact_id: null, refunded_at: null,
    ...rest,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO donor_gift (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `contact` row. */
export function insertContact(db, { id, email, ...rest }) {
  const row = { id, email, first_name: null, last_name: null, source: 'test', ...rest };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO contact (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
  return row;
}

/** Minimal valid `course_waitlist` row. */
export function insertWaitlist(db, { email, courseId, userId = null }) {
  db.prepare('INSERT INTO course_waitlist (id, course_id, email, user_id) VALUES (?, ?, ?, ?)')
    .run(`cw_${Math.random().toString(36).slice(2)}`, courseId, email, userId);
}

export function insertLabel(db, userId, label) {
  db.prepare('INSERT INTO user_label (user_id, label) VALUES (?, ?)').run(userId, label);
}

/** Inserts a session row keyed by the SHA-256 of the raw cookie value. */
export async function insertSession(db, { rawId, userId, expiresAt }) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawId));
  const hashed = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  db.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)').run(hashed, userId, expiresAt);
  return hashed;
}
