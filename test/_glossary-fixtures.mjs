/**
 * Fixtures shared by the three glossary-admin test files.
 *
 * The six endpoints under test are the WRITE PATH for patient-facing glossary
 * content, so every assertion about a mutation is made by reading the row back
 * out of a real SQLite engine (test/_d1-sqlite.mjs), never off a canned mock.
 * mockDB() would happily report `changes: 1` for a DELETE that stored nothing,
 * which is precisely the class of vacuous assertion these files avoid.
 *
 * What is still faked, and why each fake is the right one:
 *  - `faultyDb` is a throwing stub layered OVER the real engine. "D1 threw
 *    mid-write" is an engine/network condition SQLite will not produce on
 *    demand, and _d1-sqlite.mjs's own header says a test that needs it should
 *    use a throwing stub. Only the statement the test names throws; every other
 *    statement still runs for real, so the handler reaches the failure through
 *    its real control flow rather than through a mock that fails everything.
 *  - `nullResultsDb` exists for one narrow purpose: the `results || []` fallback
 *    in each list handler. A real .all() always yields an array, so that arm is
 *    unreachable through the engine and would otherwise be permanently uncovered
 *    defensive code.
 *  - `recordingEvents` replaces Analytics Engine so an error path can be pinned
 *    to the specific action name it logs. Without it, "the catch block ran" is
 *    indistinguishable between the four catch blocks in a file.
 */
import { sqliteD1 } from './_d1-sqlite.mjs';

/** Both roles the endpoints accept, plus two they must refuse. */
export const SUPERADMIN = { id: 'u_super', email: 'super@example.com', role: 'superadmin', blocked: 0 };
export const ADMIN = { id: 'u_admin', email: 'admin@example.com', role: 'admin', blocked: 0 };
export const MEMBER = { id: 'u_member', email: 'member@example.com', role: 'member', blocked: 0 };
export const EDITOR = { id: 'u_editor', email: 'editor@example.com', role: 'editor', blocked: 0 };

/** Builds the D1-shaped harness; `seed` receives the raw node:sqlite handle. */
export function glossaryDb(seed) {
  return sqliteD1({ seed });
}

export function insertTerm(sqlite, {
  id,
  slug,
  name = 'A Term',
  part = 'I',
  sort_order = 1,
  body_html = '<p>Definition body.</p>',
  abbreviation = null,
  pillar_link = null,
  status = 'published',
  word_count = 2,
} = {}) {
  sqlite.prepare(
    `INSERT INTO glossary_term (id, slug, name, part, sort_order, body_html, abbreviation, pillar_link, status, word_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, slug, name, part, sort_order, body_html, abbreviation, pillar_link, status, word_count);
  return { id, slug, name, part, sort_order, body_html, status };
}

export function insertRef(sqlite, {
  ref_num,
  anchor_text = 'Smith 2020',
  url = 'https://example.org/paper',
  publisher = null,
  journal = null,
} = {}) {
  sqlite.prepare(
    'INSERT INTO glossary_reference (ref_num, anchor_text, url, publisher, journal) VALUES (?, ?, ?, ?, ?)'
  ).run(ref_num, anchor_text, url, publisher, journal);
  return { ref_num, anchor_text, url, publisher, journal };
}

export function insertAbbr(sqlite, {
  abbreviation,
  full_term = 'Spelled Out',
  term_slug = null,
  sort_order = 1,
} = {}) {
  sqlite.prepare(
    'INSERT INTO glossary_abbreviation (abbreviation, full_term, term_slug, sort_order) VALUES (?, ?, ?, ?)'
  ).run(abbreviation, full_term, term_slug, sort_order);
  return { abbreviation, full_term, term_slug, sort_order };
}

// ------------------------------------------------------------- read-backs ---

export function readTerm(db, id) {
  const row = db._sqlite.prepare('SELECT * FROM glossary_term WHERE id = ?').get(id);
  return row ? { ...row } : null;
}

export function readRef(db, refNum) {
  const row = db._sqlite.prepare('SELECT * FROM glossary_reference WHERE ref_num = ?').get(refNum);
  return row ? { ...row } : null;
}

/** Deliberately BINARY: proves a NOCASE write actually landed on the right row. */
export function readAbbrExact(db, abbreviation) {
  const row = db._sqlite.prepare('SELECT * FROM glossary_abbreviation WHERE abbreviation = ? COLLATE BINARY').get(abbreviation);
  return row ? { ...row } : null;
}

export function countRows(db, table) {
  return db._sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

// -------------------------------------------------------- fault injection ---

function matchesSql(sql, on) {
  const needles = Array.isArray(on) ? on : [on];
  return needles.some((n) => sql.includes(n));
}

/**
 * Wraps a real harness so that only statements whose SQL contains `on` throw.
 * `batch` throws when ANY statement in it matches, which is how D1 surfaces a
 * failed batch: the whole implicit transaction rejects.
 */
export function faultyDb(real, { on, message = 'D1_ERROR: network connection lost' } = {}) {
  const thrower = (sql) => ({
    _sql: sql,
    _bindings: [],
    bind(...args) { this._bindings = args; return this; },
    async first() { throw new Error(message); },
    async all() { throw new Error(message); },
    async run() { throw new Error(message); },
  });
  return {
    _sqlite: real._sqlite,
    prepare(sql) { return matchesSql(sql, on) ? thrower(sql) : real.prepare(sql); },
    async batch(stmts) {
      if (stmts.some((s) => matchesSql(s._sql, on))) throw new Error(message);
      return real.batch(stmts);
    },
  };
}

/** A statement whose thrown Error carries no `message` at all. */
export function messagelessThrowDb() {
  return {
    prepare() {
      return {
        _sql: '',
        bind() { return this; },
        async first() { throw Object.assign(new Error(), { message: undefined }); },
        async all() { throw Object.assign(new Error(), { message: undefined }); },
        async run() { throw Object.assign(new Error(), { message: undefined }); },
      };
    },
    async batch() { throw Object.assign(new Error(), { message: undefined }); },
  };
}

/**
 * Wraps a real harness so ONE named query answers `.all()` with an object that
 * carries no `results` key. D1's driver always returns an array, so this is the
 * only way to execute a handler's `results || []` fallback and prove it degrades
 * to an empty list instead of throwing on `.map`.
 */
export function resultlessDb(real, { on } = {}) {
  return {
    _sqlite: real._sqlite,
    prepare(sql) {
      if (!matchesSql(sql, on)) return real.prepare(sql);
      const inner = real.prepare(sql);
      return {
        _sql: sql,
        bind(...args) { inner.bind(...args); return this; },
        async first() { return inner.first(); },
        async all() { await inner.all(); return {}; },
        async run() { return inner.run(); },
      };
    },
    batch(stmts) { return real.batch(stmts); },
  };
}

/**
 * Wraps a real harness so ONE named query answers `.first()` with null while
 * every other statement runs for real. Aggregates such as
 * `SELECT COALESCE(MAX(sort_order),0)+1 AS next` always yield a row on a real
 * engine, so this is the only way to execute the `?? 1` fallback that guards
 * against a driver handing back nothing.
 */
export function firstlessDb(real, { on } = {}) {
  return {
    _sqlite: real._sqlite,
    prepare(sql) {
      if (!matchesSql(sql, on)) return real.prepare(sql);
      const inner = real.prepare(sql);
      return {
        _sql: sql,
        bind(...args) { inner.bind(...args); return this; },
        async first() { await inner.first(); return null; },
        async all() { return inner.all(); },
        async run() { return inner.run(); },
      };
    },
    batch(stmts) { return real.batch(stmts); },
  };
}

/** Answers `.all()` with an object that has no `results` key. */
export function nullResultsDb() {
  return {
    prepare() {
      return {
        _sql: '',
        bind() { return this; },
        async all() { return {}; },
        async first() { return null; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
    },
    async batch() { return []; },
  };
}

// ------------------------------------------------------------ telemetry ------

/** Analytics Engine stand-in that keeps every data point for assertion. */
export function recordingEvents() {
  const points = [];
  return {
    points,
    /** The `action` blob, which is what distinguishes one catch block from another. */
    get actions() { return points.map((p) => p.blobs[2]); },
    writeDataPoint(point) { points.push(point); },
  };
}
