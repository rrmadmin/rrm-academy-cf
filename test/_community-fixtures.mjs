/**
 * Shared fixtures for the member-authored content core:
 * functions/api/community/{posts,comments,reactions}.js.
 *
 * WHY A REAL SQLITE ENGINE
 * Everything these three endpoints decide is decided by the database:
 *   - authorship authorization compares a stored `author_id` to the session
 *     user, so a canned row proves nothing about whose content was touched;
 *   - the reaction toggle is `DELETE ... ; if (changes === 0) INSERT ... ON
 *     CONFLICT DO NOTHING`, and `meta.changes` is an engine value;
 *   - post deletion is a six-statement `db.batch()` whose statements 2 and 4
 *     read `community_comment` through a subselect that statement 5 then
 *     deletes from, so the ORDER of a real transaction is the whole bug;
 *   - the slug uniqueness path leans on `idx_community_post_slug`, a UNIQUE
 *     index over `slug COLLATE NOCASE`;
 *   - the feed's pinned-first / created_at-DESC ordering, its LIMIT, and its
 *     `before` cursor are SQL, not JavaScript.
 * So these run on test/_d1-sqlite.mjs (node:sqlite loaded with the committed
 * schema.sql), never on the substring-matching mockDB().
 *
 * THE ONE SCHEMA GAP, AND WHY IT IS PATCHED HERE
 * `schema.sql` is a snapshot dated 2026-05-27. `migrations/025-stuc-action-
 * areas.sql` landed after it (its own pre-apply collision check is dated
 * 2026-05-29) and adds the `action_area` table plus the nullable
 * `community_post.area_id` column that posts.js both writes on create and
 * filters on in the feed. _d1-sqlite.mjs only replays `scripts/migrations/`,
 * a different directory, so the harness schema is missing both.
 *
 * This module replays the REAL committed DDL file off disk rather than
 * declaring a hand-written column: an invented `area_id TEXT` would be a
 * guess, and a guess is exactly what the harness header warns about. The
 * evidence that 025 is live: functions/api/community/areas.js,
 * areas/join.js, areas/leave.js, projects.js and the admin half all query
 * these tables in deployed code, and posts.js names `area_id` in its INSERT
 * column list -- an INSERT that would 500 on every create if the column did
 * not exist in production.
 *
 * WHAT THESE FIXTURES STILL CANNOT PROVE
 *  - That 025 is applied to live rrm-auth. This reads a file, not Cloudflare.
 *  - Anything outside the database: SES is stubbed via stubExternalFetch, KV
 *    is the in-memory stub, R2 is a recording stub.
 *  - Concurrency. Two isolates never truly interleave; the write races below
 *    are scripted through sqliteD1's `interleave` hook, which is a stand-in
 *    for a concurrent writer, not proof the real window is that wide.
 */
import { readFileSync } from 'node:fs';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

/**
 * The committed action-areas DDL, read off disk so this fixture can never
 * describe a schema the repo does not actually carry.
 */
export const ACTION_AREAS_DDL = readFileSync(
  new URL('../migrations/025-stuc-action-areas.sql', import.meta.url),
  'utf8',
);

// Session cookie values. `insertSession` stores the SHA-256 of these, exactly
// as login.js does, so validateSession's hashed lookup is the one under test.
export const RAW = {
  admin: 'sess-community-admin',
  mod: 'sess-community-mod',
  memberA: 'sess-community-member-a',
  memberB: 'sess-community-member-b',
  nonmember: 'sess-community-nonmember',
  unverified: 'sess-community-unverified',
  blocked: 'sess-community-blocked',
};

export const USERS = {
  admin: 'u_com_admin',
  mod: 'u_com_mod',
  memberA: 'u_com_member_a',
  memberB: 'u_com_member_b',
  nonmember: 'u_com_nonmember',
  unverified: 'u_com_unverified',
  blocked: 'u_com_blocked',
};

const FUTURE = Math.floor(Date.now() / 1000) + 86400;

/** The deliberately-maintained allowlist label requireMember honours. */
export const GRANDFATHER_LABEL = 'STUC Legacy Grandfather';

export const AREA_ACTIVE = 'area_research';
export const AREA_ARCHIVED = 'area_retired';

/**
 * A community database: committed schema.sql + the committed action-areas
 * migration + the seven-role cast every one of these endpoints is gated on.
 *
 * The two `member` roles both reach requireMember through the GRANDFATHER
 * allowlist rather than Stripe. That is a real production path (off-D1 Wix
 * Pricing Plan payers), and choosing it keeps the membership gate genuinely
 * executed -- never stubbed -- without any test in this surface depending on
 * a Stripe response. `nonmember` deliberately has no label, no subscription
 * and no stripe_customer_id, so requireMember answers 403 from its own logic.
 *
 * @param {(sqlite: import('node:sqlite').DatabaseSync) => void} [seed]
 * @param {object} [opts] forwarded to sqliteD1 (notably `interleave`)
 */
export async function communityDb(seed, opts = {}) {
  const db = sqliteD1({
    ...opts,
    seed(sqlite) {
      sqlite.exec(ACTION_AREAS_DDL);

      insertUser(sqlite, { id: USERS.admin, email: 'admin@example.com', role: 'superadmin', name: 'Ada Admin' });
      insertUser(sqlite, { id: USERS.mod, email: 'mod@example.com', role: 'mod', name: 'Moe Mod' });
      insertUser(sqlite, { id: USERS.memberA, email: 'a@example.com', role: 'member', name: 'Alice A' });
      insertUser(sqlite, { id: USERS.memberB, email: 'b@example.com', role: 'member', name: 'Bob B' });
      insertUser(sqlite, { id: USERS.nonmember, email: 'none@example.com', role: 'member', name: 'Nona None' });
      insertUser(sqlite, { id: USERS.unverified, email: 'unver@example.com', role: 'member', name: 'Uma Unverified', email_verified: 0 });
      insertUser(sqlite, { id: USERS.blocked, email: 'blocked@example.com', role: 'member', name: 'Baz Blocked', blocked: 1 });

      for (const id of [USERS.memberA, USERS.memberB, USERS.unverified, USERS.blocked]) {
        sqlite.prepare('INSERT INTO user_label (user_id, label) VALUES (?, ?)').run(id, GRANDFATHER_LABEL);
      }

      sqlite.prepare(
        "INSERT INTO action_area (id, slug, name, bucket, status) VALUES (?, ?, ?, 'research', 'active')"
      ).run(AREA_ACTIVE, 'research', 'Research');
      sqlite.prepare(
        "INSERT INTO action_area (id, slug, name, bucket, status) VALUES (?, ?, ?, 'advocacy', 'archived')"
      ).run(AREA_ARCHIVED, 'retired', 'Retired');

      if (seed) seed(sqlite);
    },
  });

  for (const who of Object.keys(RAW)) {
    await insertSession(db._sqlite, { rawId: RAW[who], userId: USERS[who], expiresAt: FUTURE });
  }
  return db;
}

/** Inserts a `community_post` row directly, bypassing the endpoint. */
export function insertPost(sqlite, {
  id,
  authorId = USERS.memberA,
  type = 'discussion',
  title = 'Title',
  body = null,
  content = 'Body text',
  pinned = 0,
  eventDate = null,
  eventLink = null,
  resourceUrl = null,
  createdAt = '2026-01-01 00:00:00',
  updatedAt = '2026-01-01 00:00:00',
  channel = 'stuc',
  slug = null,
  ogImageUrl = null,
  speaker = null,
  areaId = null,
} = {}) {
  sqlite.prepare(`
    INSERT INTO community_post
      (id, author_id, type, title, body, pinned, event_date, event_link, resource_url,
       created_at, updated_at, channel, content, slug, og_image_url, speaker, area_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, authorId, type, title, body, pinned, eventDate, eventLink, resourceUrl,
    createdAt, updatedAt, channel, content, slug, ogImageUrl, speaker, areaId);
  return id;
}

/** Inserts a `community_comment` row directly, bypassing the endpoint. */
export function insertComment(sqlite, {
  id, postId, authorId = USERS.memberA, parentId = null,
  content = 'a comment', createdAt = '2026-01-01 00:00:00', updatedAt = null,
}) {
  sqlite.prepare(
    'INSERT INTO community_comment (id, post_id, author_id, parent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, postId, authorId, parentId, content, createdAt, updatedAt);
  return id;
}

/** Inserts a `community_reaction` row directly, bypassing the endpoint. */
export function insertReaction(sqlite, { userId, targetType, targetId, emoji }) {
  sqlite.prepare(
    'INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?, ?, ?, ?)'
  ).run(userId, targetType, targetId, emoji);
}

/** Inserts a `community_flag` row directly, bypassing the endpoint. */
export function insertFlag(sqlite, { id, userId = USERS.memberB, targetType, targetId, reason = 'spam' }) {
  sqlite.prepare(
    'INSERT INTO community_flag (id, user_id, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, targetType, targetId, reason);
}

/** Reads one `community_post` row back, as a plain object (null when absent). */
export function readPost(db, id) {
  const row = db._sqlite.prepare('SELECT * FROM community_post WHERE id = ?').get(id);
  return row ? { ...row } : null;
}

/** Reads one `community_comment` row back, as a plain object (null when absent). */
export function readComment(db, id) {
  const row = db._sqlite.prepare('SELECT * FROM community_comment WHERE id = ?').get(id);
  return row ? { ...row } : null;
}

/** Every stored reaction row, ordered, for assertions about idempotency. */
export function readReactions(db, { targetType, targetId } = {}) {
  const sql = targetType
    ? 'SELECT * FROM community_reaction WHERE target_type = ? AND target_id = ? ORDER BY user_id, emoji'
    : 'SELECT * FROM community_reaction ORDER BY target_type, target_id, user_id, emoji';
  const stmt = db._sqlite.prepare(sql);
  const rows = targetType ? stmt.all(targetType, targetId) : stmt.all();
  return rows.map((r) => ({ ...r }));
}

/** Every stored flag row, for post-delete child-cleanup assertions. */
export function readFlags(db) {
  return db._sqlite.prepare('SELECT * FROM community_flag ORDER BY id').all().map((r) => ({ ...r }));
}

/**
 * Wraps a D1-shaped binding so statements matching `needle` throw.
 *
 * The harness header is explicit that a test needing "D1 threw" should use a
 * throwing stub rather than the SQLite engine: node:sqlite cannot reproduce
 * D1's network errors, its statement-size cap, or a mid-batch failure. This
 * keeps the real engine for every other statement, so the handler reaches the
 * failure with genuine state behind it instead of an empty mock.
 *
 * @param {object} db a sqliteD1() binding
 * @param {string|RegExp} needle matched against the statement text
 * @param {string} [message]
 */
export function throwingOn(db, needle, message = 'D1_DOWN') {
  const hit = (sql) => (needle instanceof RegExp ? needle.test(sql) : sql.includes(needle));
  return {
    _sqlite: db._sqlite,
    _calls: db._calls,
    prepare(sql) {
      if (!hit(sql)) return db.prepare(sql);
      return {
        _sql: sql,
        _bindings: [],
        bind(...args) { this._bindings = args; return this; },
        async first() { throw new Error(message); },
        async all() { throw new Error(message); },
        async run() { throw new Error(message); },
      };
    },
    /**
     * A batch fails as a UNIT. D1 runs a batch in an implicit transaction, so
     * one bad statement rolls the whole thing back rather than leaving the
     * earlier writes committed -- which is exactly the property the delete
     * handlers rely on. Throwing per-statement here would model the opposite.
     */
    async batch(stmts) {
      if (stmts.some((s) => hit(s._sql))) throw new Error(message);
      return db.batch(stmts);
    },
    close() { return db.close(); },
  };
}

/**
 * Wraps a D1-shaped binding so `.all()` on statements matching `needle` comes
 * back WITHOUT a `results` key.
 *
 * node:sqlite always produces one, and so does D1 in every documented case, so
 * this shape cannot be produced by the real engine -- which is precisely why
 * the `|| []` defaults that guard against it are otherwise unreachable. Using a
 * driver-shape stub here is the same concession the harness header makes for
 * "D1 threw": some driver behaviours are not the engine's to reproduce.
 */
export function resultlessOn(db, needle) {
  const hit = (sql) => sql.includes(needle);
  return {
    _sqlite: db._sqlite,
    _calls: db._calls,
    prepare(sql) {
      const inner = db.prepare(sql);
      if (!hit(sql)) return inner;
      return {
        _sql: sql,
        _bindings: [],
        bind(...args) { inner.bind(...args); this._bindings = args; return this; },
        first() { return inner.first(); },
        async all() { await inner.all(); return { success: true }; },
        run() { return inner.run(); },
      };
    },
    batch(stmts) { return db.batch(stmts); },
    close() { return db.close(); },
  };
}

/** A recording R2 stub: `.deleted` collects every key the handler removes. */
export function mockR2({ failWith } = {}) {
  const deleted = [];
  return {
    deleted,
    async delete(key) {
      deleted.push(key);
      if (failWith) throw new Error(failWith);
    },
  };
}
