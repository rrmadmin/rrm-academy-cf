/**
 * functions/api/community/{ban,unban,flags}.js -- the STUC moderation surface.
 *
 * These three endpoints take privileges away from people, and both failure
 * directions are bad: a ban that does not bite leaves an abuser posting, and a
 * ban an ordinary member can trigger is a denial of service against members.
 * Until this file existed, no test had ever imported any of them.
 *
 * WHY THE REAL SQLITE ENGINE (test/_d1-sqlite.mjs) AND NOT mockDB()
 * -----------------------------------------------------------------
 * Every load-bearing claim here is a claim about STORED STATE READ BACK BY
 * DIFFERENT SQL than the SQL that wrote it:
 *   - ban.js writes `UPDATE user SET blocked = 1` and deletes the session rows;
 *     the refusal is decided much later by validateSession's JOIN of `session`
 *     to `user`, inside requireMember. A canned mock would let a test "prove" a
 *     ban while nothing was stored and nothing was re-read.
 *   - ban.js does its whole cascade in a single db.batch(), so "the ban rolled
 *     back when D1 threw mid-write" is a transaction claim, not a call-shape
 *     claim.
 *   - flags.js leans on the UNIQUE(user_id, target_type, target_id) index
 *     declared in schema.sql: the duplicate 409 and the ON CONFLICT ... DO
 *     UPDATE ... RETURNING id upsert are both decided by the engine.
 *   - flags.js GET builds its IN (...) placeholder lists from the rows it just
 *     read, and joins them back to `user`. Under substring matching those joins
 *     return whatever the fixture declared.
 *
 * requireMember is NEVER stubbed here. It is the canonical membership gate the
 * whole product delegates to; stubbing it is how you get 100% coverage of a
 * broken gate. Ban refusal is asserted through the real gate AND through two
 * real endpoints (community/posts GET and flags POST).
 *
 * WHAT IS STILL FAKED
 *  - SES, KV and R2 are stubs (_helpers.js / inline objects). The database is not.
 *  - `datetime('now')` is the machine clock; nothing here pins a calendar date.
 *  - "D1 threw" is a scripted throw via the harness `interleave` hook, because
 *    node:sqlite cannot produce a D1 network error. What that proves is the
 *    handler's behaviour on a mid-statement failure, not D1's failure modes.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse, drainWaitUntil, stubExternalFetch,
} from './_helpers.js';
import { sqliteD1, insertUser, insertSession, insertLabel } from './_d1-sqlite.mjs';

const ban = await import('../functions/api/community/ban.js');
const unban = await import('../functions/api/community/unban.js');
const flags = await import('../functions/api/community/flags.js');
const posts = await import('../functions/api/community/posts.js');
const communityShared = await import('../functions/api/community/_shared.js');

const FUTURE = Math.floor(Date.now() / 1000) + 86400;

/**
 * `member` deliberately carries no `name`, so displayName() has to fall back to
 * first + last initial -- that string is rendered into the moderator email and
 * into the flag queue, so it is asserted rather than assumed.
 */
const USERS = {
  super: { id: 'u_super', email: 'super@example.com', role: 'superadmin', name: 'Sam Super' },
  admin: { id: 'u_admin', email: 'admin@example.com', role: 'admin', name: 'Ada Admin' },
  admin2: { id: 'u_admin2', email: 'admin2@example.com', role: 'admin', name: 'Abe Admin' },
  mod: { id: 'u_mod', email: 'mod@example.com', role: 'mod', name: 'Mo Mod' },
  member: { id: 'u_member', email: 'member@example.com', role: 'member', first_name: 'Mia', last_name: 'Member' },
  member2: { id: 'u_member2', email: 'member2@example.com', role: 'member', name: 'Max Member' },
  outsider: { id: 'u_outsider', email: 'outsider@example.com', role: 'member', name: 'Otto Outsider' },
};

/** Members with no Stripe customer and no Wix row need the maintained allowlist to pass requireMember. */
const GRANDFATHERED = new Set(['member', 'member2']);

const ALL = Object.keys(USERS);
const RAW = Object.fromEntries(ALL.map((k) => [k, `sess-${k}`]));

const LONG_BODY = 'A'.repeat(260);

function seedContent(sqlite) {
  const post = (id, authorId, title, body, content, og) => sqlite.prepare(
    'INSERT INTO community_post (id, author_id, type, title, body, content, channel, og_image_url, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, authorId, 'discussion', title, body, content, 'stuc', og, '2026-01-01T00:00:00Z');

  post('p_long', 'u_member2', 'Long post', null, LONG_BODY, 'https://rrmacademy.org/api/assets/community/og-long.png');
  post('p_legacy', 'u_member2', 'Legacy title', 'Legacy body', null, 'https://cdn.example.com/not-an-asset.png');
  post('p_titleonly', 'u_member', 'Only title', null, null, null);
  post('p_bodyonly', 'u_member2', '', 'Only body', null, null);
  post('p_empty', 'u_member2', '', null, null, null);

  sqlite.prepare(
    'INSERT INTO community_comment (id, post_id, author_id, content, created_at) VALUES (?,?,?,?,?)'
  ).run('c_1', 'p_long', 'u_member2', 'A comment worth reporting', '2026-01-02T00:00:00Z');
  // Authored by the user with no `name`, so the queue has to derive a display name.
  sqlite.prepare(
    'INSERT INTO community_comment (id, post_id, author_id, content, created_at) VALUES (?,?,?,?,?)'
  ).run('c_2', 'p_legacy', 'u_member', 'A nameless author comment', '2026-01-03T00:00:00Z');
}

function seedFlag(sqlite, { id, userId, targetType = 'post', targetId, reason = 'spam', note = null, status = 'pending', createdAt = '2026-02-01T00:00:00Z' }) {
  sqlite.prepare(
    'INSERT INTO community_flag (id, user_id, target_type, target_id, reason, note, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, userId, targetType, targetId, reason, note, status, createdAt);
}

async function seededDb({ seed, interleave, users = ALL } = {}) {
  const db = sqliteD1({
    interleave,
    seed(sqlite) {
      for (const key of users) {
        insertUser(sqlite, USERS[key]);
        if (GRANDFATHERED.has(key)) insertLabel(sqlite, USERS[key].id, 'STUC Legacy Grandfather');
      }
      if (seed) seed(sqlite);
    },
  });
  for (const key of users) {
    await insertSession(db._sqlite, { rawId: RAW[key], userId: USERS[key].id, expiresAt: FUTURE });
  }
  return db;
}

/** Throws out of the harness the instant a matching statement is about to run. */
function throwOn(pattern, message = 'D1 connection lost') {
  return ({ sql }) => { if (pattern.test(sql)) throw new Error(message); };
}

/** Lands a concurrent DELETE in the instant before a matching statement runs. */
function deleteWhen(pattern, deleteSql) {
  let fired = false;
  return ({ sql, db }) => {
    if (fired || !pattern.test(sql)) return;
    fired = true;
    db.exec(deleteSql);
  };
}

function eventRecorder() {
  const points = [];
  return { points, writeDataPoint(p) { points.push(p); } };
}

function actionsOf(env) {
  return env.EVENTS.points.map((p) => p.blobs[2]);
}

function detailsOf(env) {
  return env.EVENTS.points.map((p) => p.blobs[4]);
}

function envFor(db, extra = {}) {
  return mockEnv({ DB: db, EVENTS: eventRecorder(), ...extra });
}

let net;
let openWaitUntils;

beforeEach(() => {
  net = stubExternalFetch();
  openWaitUntils = [];
});

afterEach(async () => {
  // Drain BEFORE restoring: notifyMods() is handed to waitUntil, so an undrained
  // promise would otherwise reach the real network after the stub came down.
  for (const w of openWaitUntils) await drainWaitUntil(w);
  net.restore();
});

function trackWaitUntil() {
  const w = mockWaitUntil();
  openWaitUntils.push(w);
  return w;
}

function cookiesFor(who) {
  return who ? { Cookie: `session=${RAW[who]}` } : {};
}

function banPost(db, { who = 'admin', body, rawBody, env = envFor(db), waitUntil = trackWaitUntil(), cookie } = {}) {
  return ban.onRequestPost({
    request: mockRequest('POST', {
      body, rawBody,
      url: 'https://rrmacademy.org/api/community/ban',
      headers: cookie ? { Cookie: cookie } : cookiesFor(who),
    }),
    env,
    waitUntil,
  });
}

function unbanPost(db, { who = 'admin', body, rawBody, env = envFor(db), waitUntil = trackWaitUntil(), cookie } = {}) {
  return unban.onRequestPost({
    request: mockRequest('POST', {
      body, rawBody,
      url: 'https://rrmacademy.org/api/community/unban',
      headers: cookie ? { Cookie: cookie } : cookiesFor(who),
    }),
    env,
    waitUntil,
  });
}

function flagPost(db, { who = 'member', body, rawBody, env = envFor(db), waitUntil = trackWaitUntil(), cookie } = {}) {
  return flags.onRequestPost({
    request: mockRequest('POST', {
      body, rawBody,
      url: 'https://rrmacademy.org/api/community/flags',
      headers: cookie ? { Cookie: cookie } : cookiesFor(who),
    }),
    env,
    waitUntil,
  });
}

function flagGet(db, { who = 'mod', query = '', env = envFor(db), waitUntil = trackWaitUntil() } = {}) {
  return flags.onRequestGet({
    request: mockRequest('GET', {
      url: `https://rrmacademy.org/api/community/flags${query}`,
      headers: cookiesFor(who),
    }),
    env,
    waitUntil,
  });
}

function flagPatch(db, { who = 'admin', body, rawBody, env = envFor(db), waitUntil = trackWaitUntil() } = {}) {
  return flags.onRequestPatch({
    request: mockRequest('PATCH', {
      body, rawBody,
      url: 'https://rrmacademy.org/api/community/flags',
      headers: cookiesFor(who),
    }),
    env,
    waitUntil,
  });
}

function row(db, sql, ...binds) {
  return db._sqlite.prepare(sql).get(...binds) ?? null;
}

function rows(db, sql, ...binds) {
  return db._sqlite.prepare(sql).all(...binds);
}

function blockedFlag(db, id) {
  return row(db, 'SELECT blocked FROM user WHERE id = ?', id)?.blocked;
}

function sessionCount(db, id) {
  return row(db, 'SELECT COUNT(*) AS n FROM session WHERE user_id = ?', id).n;
}

// ===========================================================================
// ban.js -- who may ban
// ===========================================================================

describe('POST /api/community/ban -- who may ban', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  it('rejects an anonymous caller with 401 and leaves the target unbanned', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: null, body: { userId: 'u_member2' } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.equal(blockedFlag(db, 'u_member2'), 0);
  });

  it('rejects an ORDINARY MEMBER with 403 and stores nothing', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'member', body: { userId: 'u_member2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(blockedFlag(db, 'u_member2'), 0, 'an ordinary member banned somebody');
    assert.equal(sessionCount(db, 'u_member2'), 1, 'an ordinary member destroyed another member session');
  });

  it('rejects a MOD with 403 -- moderation of content is not moderation of accounts', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'mod', body: { userId: 'u_member2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(blockedFlag(db, 'u_member2'), 0);
  });

  it('rejects an authenticated NON-member with 403 before it ever reaches the admin check', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'outsider', body: { userId: 'u_member2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(blockedFlag(db, 'u_member2'), 0);
  });

  it('accepts an admin', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'admin', body: { userId: 'u_member2' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(blockedFlag(db, 'u_member2'), 1);
  });

  it('accepts a superadmin', async () => {
    const { status } = await parseResponse(await banPost(db, { who: 'super', body: { userId: 'u_member2' } }));
    assert.equal(status, 200);
    assert.equal(blockedFlag(db, 'u_member2'), 1);
  });

  it('answers OPTIONS with a 204 CORS preflight', async () => {
    const res = await ban.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ===========================================================================
// ban.js -- request validation and target selection
// ===========================================================================

describe('POST /api/community/ban -- payload and target', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await banPost(db, { rawBody: '{not json' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  for (const [label, rawBody] of [['null', 'null'], ['an array', '["u_member2"]'], ['a bare string', '"u_member2"']]) {
    it(`400s when the body is ${label}`, async () => {
      const { status, body } = await parseResponse(await banPost(db, { rawBody }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid payload');
    });
  }

  it('400s when userId is missing', async () => {
    const { status, body } = await parseResponse(await banPost(db, { body: { deleteContent: true } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'userId required');
  });

  it('404s for a userId that does not exist', async () => {
    const { status, body } = await parseResponse(await banPost(db, { body: { userId: 'u_ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'User not found');
  });

  it('409s on an idempotent replay of a ban that already landed', async () => {
    assert.equal((await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }))).status, 200);
    const { status, body } = await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'User is already banned');
    assert.equal(blockedFlag(db, 'u_member2'), 1);
  });

  it('refuses SELF-BAN: an admin cannot ban themselves', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'admin', body: { userId: 'u_admin' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Cannot ban yourself');
    assert.equal(blockedFlag(db, 'u_admin'), 0);
    assert.equal(sessionCount(db, 'u_admin'), 1, 'the self-ban attempt destroyed the admin own session');
  });

  it('refuses ADMIN-BAN: one admin cannot ban another admin', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'admin', body: { userId: 'u_admin2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Cannot ban an admin');
    assert.equal(blockedFlag(db, 'u_admin2'), 0);
  });

  it('refuses to let an admin ban a superadmin', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'admin', body: { userId: 'u_super' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Cannot ban an admin');
    assert.equal(blockedFlag(db, 'u_super'), 0);
  });

  it('refuses to let a superadmin ban an admin either -- the guard is role-based, not rank-based', async () => {
    const { status, body } = await parseResponse(await banPost(db, { who: 'super', body: { userId: 'u_admin' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Cannot ban an admin');
    assert.equal(blockedFlag(db, 'u_admin'), 0);
  });

  it('DOES let an admin ban a MOD -- pinned as current behaviour, mod is below the guard', async () => {
    const { status } = await parseResponse(await banPost(db, { who: 'admin', body: { userId: 'u_mod' } }));
    assert.equal(status, 200);
    assert.equal(blockedFlag(db, 'u_mod'), 1);
    assert.equal(sessionCount(db, 'u_mod'), 0);
  });
});

// ===========================================================================
// ban.js -- the cascade
// ===========================================================================

describe('POST /api/community/ban -- what the ban actually writes', () => {
  let db;

  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        seedContent(sqlite);
        sqlite.prepare('INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?,?,?,?)')
          .run('u_member2', 'post', 'p_titleonly', '❤️');
        sqlite.prepare('INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?,?,?,?)')
          .run('u_member', 'post', 'p_long', '\u{1F44F}');
        sqlite.prepare('INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?,?,?,?)')
          .run('u_member', 'comment', 'c_1', '\u{1F622}');
        sqlite.prepare('INSERT INTO community_comment (id, post_id, author_id, content) VALUES (?,?,?,?)')
          .run('c_reply', 'p_long', 'u_member', 'Someone else replying under the banned post');
        seedFlag(sqlite, { id: 'f_by_target', userId: 'u_member2', targetId: 'p_titleonly' });
        seedFlag(sqlite, { id: 'f_on_target_post', userId: 'u_member', targetId: 'p_long' });
        seedFlag(sqlite, { id: 'f_on_target_comment', userId: 'u_member', targetType: 'comment', targetId: 'c_1' });
      },
    });
  });

  it('sets blocked and destroys every live session, so the ban survives the current request', async () => {
    assert.equal(sessionCount(db, 'u_member2'), 1);
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(blockedFlag(db, 'u_member2'), 1);
    assert.equal(sessionCount(db, 'u_member2'), 0);
  });

  it('erases the banned account own reactions and its own filed reports', async () => {
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(rows(db, "SELECT 1 FROM community_reaction WHERE user_id = 'u_member2'").length, 0);
    assert.equal(row(db, "SELECT 1 FROM community_flag WHERE id = 'f_by_target'"), null);
  });

  it('leaves the banned account content standing when deleteContent is not asked for', async () => {
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(rows(db, "SELECT 1 FROM community_post WHERE author_id = 'u_member2'").length, 4);
    assert.ok(row(db, "SELECT 1 FROM community_comment WHERE id = 'c_1'"));
    assert.ok(row(db, "SELECT 1 FROM community_flag WHERE id = 'f_on_target_post'"));
  });

  it('deleteContent removes posts, comments, replies under them, and every flag and reaction pointing at them', async () => {
    const { status } = await parseResponse(await banPost(db, { body: { userId: 'u_member2', deleteContent: true } }));
    assert.equal(status, 200);
    assert.equal(rows(db, "SELECT 1 FROM community_post WHERE author_id = 'u_member2'").length, 0);
    assert.equal(row(db, "SELECT 1 FROM community_comment WHERE id = 'c_1'"), null);
    assert.equal(row(db, "SELECT 1 FROM community_comment WHERE id = 'c_reply'"), null,
      'a third-party reply was orphaned under a deleted post');
    assert.equal(row(db, "SELECT 1 FROM community_flag WHERE id = 'f_on_target_post'"), null);
    assert.equal(row(db, "SELECT 1 FROM community_flag WHERE id = 'f_on_target_comment'"), null);
    assert.equal(rows(db, "SELECT 1 FROM community_reaction WHERE target_id IN ('p_long','c_1')").length, 0);
    // A post by somebody else is untouched.
    assert.ok(row(db, "SELECT 1 FROM community_post WHERE id = 'p_titleonly'"));
  });

  it('queues the R2 objects behind the deleted posts and skips URLs that are not asset routes', async () => {
    const deleted = [];
    const waitUntil = trackWaitUntil();
    const env = envFor(db, { R2_ASSETS: { async delete(key) { deleted.push(key); } } });
    const { status } = await parseResponse(await banPost(db, { body: { userId: 'u_member2', deleteContent: true }, env, waitUntil }));
    assert.equal(status, 200);
    await drainWaitUntil(waitUntil);
    assert.deepEqual(deleted, ['community/og-long.png'],
      'the non-asset CDN URL was treated as an R2 key, or the asset key was missed');
  });

  it('logs r2_cleanup_failed when the object delete rejects, without failing the ban', async () => {
    const waitUntil = trackWaitUntil();
    const env = envFor(db, { R2_ASSETS: { async delete() { throw new Error('R2 unavailable'); } } });
    const { status } = await parseResponse(await banPost(db, { body: { userId: 'u_member2', deleteContent: true }, env, waitUntil }));
    assert.equal(status, 200);
    assert.equal(blockedFlag(db, 'u_member2'), 1);
    await drainWaitUntil(waitUntil);
    assert.ok(actionsOf(env).includes('r2_cleanup_failed'), 'the R2 failure was swallowed silently');
    assert.ok(detailsOf(env).some((d) => d === 'ban: R2 unavailable'));
  });

  it('never touches R2 when deleteContent is not set, even though the posts carry asset URLs', async () => {
    const deleted = [];
    const waitUntil = trackWaitUntil();
    const env = envFor(db, { R2_ASSETS: { async delete(key) { deleted.push(key); } } });
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' }, env, waitUntil }));
    await drainWaitUntil(waitUntil);
    assert.deepEqual(deleted, []);
  });

  it('rolls the whole ban back and answers 500 when D1 fails part-way through the batch', async () => {
    const failing = await seededDb({ seed: seedContent, interleave: throwOn(/DELETE FROM session/) });
    const env = envFor(failing);
    const { status, body } = await parseResponse(await banPost(failing, { body: { userId: 'u_member2' }, env }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.equal(blockedFlag(failing, 'u_member2'), 0, 'the UPDATE survived a rolled-back batch');
    assert.equal(sessionCount(failing, 'u_member2'), 1);
    assert.ok(actionsOf(env).includes('ban_error'));
    assert.ok(detailsOf(env).includes('D1 connection lost'));
  });
});

// ===========================================================================
// The ban has to BITE -- proven through the canonical gate and real endpoints
// ===========================================================================

describe('a ban bites, and an unban restores', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  const gate = (who, database = db) => communityShared.requireMember(
    mockRequest('GET', { headers: cookiesFor(who) }),
    envFor(database),
  );

  const feed = (who, database = db) => posts.onRequestGet({
    request: mockRequest('GET', { url: 'https://rrmacademy.org/api/community/posts', headers: cookiesFor(who) }),
    env: envFor(database),
    waitUntil: trackWaitUntil(),
  });

  it('lets the member through the canonical gate and the community feed BEFORE the ban', async () => {
    const auth = await gate('member2');
    assert.ok(!(auth instanceof Response), 'the gate refused an unbanned member');
    assert.equal(auth.user.id, 'u_member2');
    assert.equal(auth.tier, 'member');
    const { status, body } = await parseResponse(await feed('member2'));
    assert.equal(status, 200);
    assert.ok(body.posts.length > 0);
  });

  it('refuses the banned user at requireMember itself', async () => {
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    const res = await gate('member2');
    assert.ok(res instanceof Response, 'requireMember returned an auth context for a banned user');
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    // Pinned as-is: validateSession() drops blocked users before requireMember's
    // own `if (user.blocked)` branch is ever reached, so the caller sees
    // "Not authenticated", never "Account suspended".
    assert.equal(body.error, 'Not authenticated');
  });

  it('keeps refusing even when the banned user holds a session minted after the ban', async () => {
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    await insertSession(db._sqlite, { rawId: RAW.member2, userId: 'u_member2', expiresAt: FUTURE });
    assert.equal(sessionCount(db, 'u_member2'), 1, 'the replacement session was not stored');

    const res = await gate('member2');
    assert.ok(res instanceof Response);
    assert.equal((await parseResponse(res)).status, 401,
      'the ban only worked because the sessions were deleted; the blocked flag is not biting');
  });

  it('refuses the banned user at a real content endpoint (community feed)', async () => {
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    await insertSession(db._sqlite, { rawId: RAW.member2, userId: 'u_member2', expiresAt: FUTURE });
    const { status, body } = await parseResponse(await feed('member2'));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('refuses the banned user at a real write endpoint (flag creation)', async () => {
    await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }));
    await insertSession(db._sqlite, { rawId: RAW.member2, userId: 'u_member2', expiresAt: FUTURE });
    const { status } = await parseResponse(await flagPost(db, { who: 'member2', body: { targetType: 'post', targetId: 'p_titleonly', reason: 'spam' } }));
    assert.equal(status, 401);
    assert.equal(rows(db, "SELECT 1 FROM community_flag WHERE user_id = 'u_member2'").length, 0);
  });

  it('round-trips: ban, refused everywhere, unban, restored everywhere', async () => {
    assert.equal((await parseResponse(await banPost(db, { body: { userId: 'u_member2' } }))).status, 200);
    await insertSession(db._sqlite, { rawId: RAW.member2, userId: 'u_member2', expiresAt: FUTURE });
    assert.ok((await gate('member2')) instanceof Response);
    assert.equal((await parseResponse(await feed('member2'))).status, 401);

    const { status, body } = await parseResponse(await unbanPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(blockedFlag(db, 'u_member2'), 0);

    const auth = await gate('member2');
    assert.ok(!(auth instanceof Response), 'the unbanned member is still refused by the gate');
    assert.equal(auth.user.id, 'u_member2');
    assert.equal((await parseResponse(await feed('member2'))).status, 200);
    assert.equal((await parseResponse(await flagPost(db, {
      who: 'member2', body: { targetType: 'post', targetId: 'p_titleonly', reason: 'spam' },
    }))).status, 201);
  });
});

// ===========================================================================
// unban.js
// ===========================================================================

describe('POST /api/community/unban', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        seedContent(sqlite);
        sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run('u_member2');
      },
    });
  });

  it('rejects an anonymous caller with 401 and leaves the ban in place', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { who: null, body: { userId: 'u_member2' } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.equal(blockedFlag(db, 'u_member2'), 1);
  });

  it('rejects an ORDINARY MEMBER with 403 and leaves the ban in place', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { who: 'member', body: { userId: 'u_member2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(blockedFlag(db, 'u_member2'), 1, 'an ordinary member lifted a ban');
  });

  it('rejects a MOD with 403', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { who: 'mod', body: { userId: 'u_member2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(blockedFlag(db, 'u_member2'), 1);
  });

  it('rejects an authenticated NON-member with 403', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { who: 'outsider', body: { userId: 'u_member2' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(blockedFlag(db, 'u_member2'), 1);
  });

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { rawBody: 'nope' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  for (const [label, rawBody] of [['null', 'null'], ['an array', '[]'], ['a number', '7']]) {
    it(`400s when the body is ${label}`, async () => {
      const { status, body } = await parseResponse(await unbanPost(db, { rawBody }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid payload');
    });
  }

  it('400s when userId is missing', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { body: {} }));
    assert.equal(status, 400);
    assert.equal(body.error, 'userId required');
  });

  it('404s for a userId that does not exist', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { body: { userId: 'u_ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'User not found');
  });

  it('409s when the target is not banned, and does not rewrite the row', async () => {
    const { status, body } = await parseResponse(await unbanPost(db, { body: { userId: 'u_member' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'User is not banned');
    assert.equal(blockedFlag(db, 'u_member'), 0);
  });

  it('409s on an idempotent replay of an unban that already landed', async () => {
    assert.equal((await parseResponse(await unbanPost(db, { body: { userId: 'u_member2' } }))).status, 200);
    const { status, body } = await parseResponse(await unbanPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'User is not banned');
  });

  it('clears the flag but does NOT restore the destroyed sessions -- the user must sign in again', async () => {
    db._sqlite.prepare('DELETE FROM session WHERE user_id = ?').run('u_member2');
    const { status } = await parseResponse(await unbanPost(db, { body: { userId: 'u_member2' } }));
    assert.equal(status, 200);
    assert.equal(blockedFlag(db, 'u_member2'), 0);
    assert.equal(sessionCount(db, 'u_member2'), 0);
  });

  it('500s and leaves the ban standing when D1 fails on the write', async () => {
    const failing = await seededDb({
      seed(sqlite) {
        sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run('u_member2');
      },
      interleave: throwOn(/UPDATE user SET blocked = 0/),
    });
    const env = envFor(failing);
    const { status, body } = await parseResponse(await unbanPost(failing, { body: { userId: 'u_member2' }, env }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.equal(blockedFlag(failing, 'u_member2'), 1);
    assert.ok(actionsOf(env).includes('unban_error'));
  });

  it('answers OPTIONS with a 204 CORS preflight', async () => {
    const res = await unban.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
  });
});

// ===========================================================================
// flags.js -- POST (who may flag)
// ===========================================================================

describe('POST /api/community/flags -- who may flag', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  const VALID = { targetType: 'post', targetId: 'p_long', reason: 'harassment' };

  it('401s an anonymous caller and stores nothing', async () => {
    const { status, body } = await parseResponse(await flagPost(db, { who: null, body: VALID }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.equal(rows(db, 'SELECT 1 FROM community_flag').length, 0);
  });

  it('403s an authenticated NON-member and stores nothing', async () => {
    const { status, body } = await parseResponse(await flagPost(db, { who: 'outsider', body: VALID }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(rows(db, 'SELECT 1 FROM community_flag').length, 0);
  });

  it('lets any paid-up member flag', async () => {
    const { status, body } = await parseResponse(await flagPost(db, { who: 'member', body: VALID }));
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    const stored = row(db, 'SELECT * FROM community_flag WHERE id = ?', body.flagId);
    assert.ok(stored, 'the endpoint answered 201 for a flag it never stored');
    assert.equal(stored.user_id, 'u_member');
    assert.equal(stored.target_type, 'post');
    assert.equal(stored.target_id, 'p_long');
    assert.equal(stored.reason, 'harassment');
    assert.equal(stored.status, 'pending');
  });

  it('lets staff flag too', async () => {
    const { status } = await parseResponse(await flagPost(db, { who: 'mod', body: VALID }));
    assert.equal(status, 201);
    assert.equal(row(db, "SELECT user_id FROM community_flag WHERE user_id = 'u_mod'").user_id, 'u_mod');
  });

  it('429s once the hourly budget of 10 flags is spent, and stores nothing further', async () => {
    const kv = mockKV();
    const targets = ['p_long', 'p_legacy', 'p_titleonly', 'p_bodyonly', 'p_empty'];
    let accepted = 0;
    for (let i = 0; i < 12; i++) {
      const res = await flagPost(db, {
        who: 'member',
        env: envFor(db, { COMMUNITY_KV: kv }),
        // Rotate target and reason so the 409 duplicate guard never fires first.
        body: { targetType: 'post', targetId: targets[i % targets.length], reason: 'spam' },
      });
      const { status } = await parseResponse(res);
      if (status === 201) accepted++;
      if (i >= 10) {
        assert.equal(status, 429, `request ${i + 1} was not rate limited`);
      }
    }
    assert.equal(accepted, 5, 'the budget accounting changed shape');
    assert.equal(rows(db, "SELECT 1 FROM community_flag WHERE user_id = 'u_member'").length, 5);
  });

  it('429s fail-CLOSED when the KV binding is missing entirely', async () => {
    const { status, body } = await parseResponse(await flagPost(db, { who: 'member', body: VALID, env: envFor(db, { COMMUNITY_KV: null }) }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(rows(db, 'SELECT 1 FROM community_flag').length, 0);
  });

  it('answers OPTIONS with a 204 CORS preflight', async () => {
    const res = await flags.onRequestOptions();
    assert.equal(res.status, 204);
  });
});

// ===========================================================================
// flags.js -- POST validation and target existence
// ===========================================================================

describe('POST /api/community/flags -- payload and target', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  const bad = async (body, rawBody) => parseResponse(await flagPost(db, { who: 'member', body, rawBody }));

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await bad(undefined, '{');
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  for (const [label, rawBody] of [['null', 'null'], ['an array', '[]'], ['a string', '"x"']]) {
    it(`400s when the body is ${label}`, async () => {
      const { status, body } = await bad(undefined, rawBody);
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid payload');
    });
  }

  for (const [label, targetType] of [['missing', undefined], ['unknown', 'user'], ['empty', '']]) {
    it(`400s on a ${label} targetType`, async () => {
      const { status, body } = await bad({ targetType, targetId: 'p_long', reason: 'spam' });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid targetType');
    });
  }

  for (const [label, targetId] of [['missing', undefined], ['non-string', 12345], ['over 100 chars', 'p'.repeat(101)]]) {
    it(`400s on a ${label} targetId`, async () => {
      const { status, body } = await bad({ targetType: 'post', targetId, reason: 'spam' });
      assert.equal(status, 400);
      assert.equal(body.error, 'targetId required');
    });
  }

  for (const [label, reason] of [['missing', undefined], ['off the allowlist', 'because-i-said-so']]) {
    it(`400s on a ${label} reason`, async () => {
      const { status, body } = await bad({ targetType: 'post', targetId: 'p_long', reason });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid reason');
    });
  }

  for (const reason of ['inappropriate', 'spam', 'harassment', 'other']) {
    it(`accepts the allowlisted reason "${reason}"`, async () => {
      const { status } = await parseResponse(await flagPost(db, {
        who: 'member', body: { targetType: 'post', targetId: 'p_long', reason },
      }));
      assert.equal(status, 201);
    });
  }

  it('400s on a note over 500 characters', async () => {
    const { status, body } = await bad({ targetType: 'post', targetId: 'p_long', reason: 'spam', note: 'n'.repeat(501) });
    assert.equal(status, 400);
    assert.equal(body.error, 'Note too long (max 500 chars)');
    assert.equal(rows(db, 'SELECT 1 FROM community_flag').length, 0);
  });

  it('accepts a note of exactly 500 characters and stores it trimmed', async () => {
    const note = ` ${'n'.repeat(498)} `;
    const { status, body } = await parseResponse(await flagPost(db, {
      who: 'member', body: { targetType: 'post', targetId: 'p_long', reason: 'spam', note },
    }));
    assert.equal(status, 201);
    assert.equal(row(db, 'SELECT note FROM community_flag WHERE id = ?', body.flagId).note, 'n'.repeat(498));
  });

  it('stores a whitespace-only note as NULL rather than as blank text', async () => {
    const { status, body } = await parseResponse(await flagPost(db, {
      who: 'member', body: { targetType: 'post', targetId: 'p_long', reason: 'spam', note: '   ' },
    }));
    assert.equal(status, 201);
    assert.equal(row(db, 'SELECT note FROM community_flag WHERE id = ?', body.flagId).note, null);
  });

  it('404s when the flagged POST does not exist, and stores nothing', async () => {
    const { status, body } = await bad({ targetType: 'post', targetId: 'p_ghost', reason: 'spam' });
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
    assert.equal(rows(db, 'SELECT 1 FROM community_flag').length, 0);
  });

  it('404s when the flagged COMMENT does not exist, and stores nothing', async () => {
    const { status, body } = await bad({ targetType: 'comment', targetId: 'c_ghost', reason: 'spam' });
    assert.equal(status, 404);
    assert.equal(body.error, 'Comment not found');
    assert.equal(rows(db, 'SELECT 1 FROM community_flag').length, 0);
  });

  it('flags a comment as well as a post', async () => {
    const { status, body } = await parseResponse(await flagPost(db, {
      who: 'member', body: { targetType: 'comment', targetId: 'c_1', reason: 'other' },
    }));
    assert.equal(status, 201);
    const stored = row(db, 'SELECT * FROM community_flag WHERE id = ?', body.flagId);
    assert.equal(stored.target_type, 'comment');
    assert.equal(stored.target_id, 'c_1');
  });

  it('500s and stores nothing when D1 fails on the insert', async () => {
    const failing = await seededDb({ seed: seedContent, interleave: throwOn(/INSERT INTO community_flag/) });
    const env = envFor(failing);
    const { status, body } = await parseResponse(await flagPost(failing, {
      who: 'member', body: { targetType: 'post', targetId: 'p_long', reason: 'spam' }, env,
    }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.equal(rows(failing, 'SELECT 1 FROM community_flag').length, 0);
    assert.ok(actionsOf(env).includes('flag_error'));
    assert.ok(detailsOf(env).some((d) => d.startsWith('POST: ')));
  });
});

// ===========================================================================
// flags.js -- POST duplicate handling (the state machine)
// ===========================================================================

describe('POST /api/community/flags -- double-flagging', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  const flag = (who, extra = {}) => flagPost(db, {
    who, body: { targetType: 'post', targetId: 'p_long', reason: 'spam', ...extra },
  });

  it('409s when the SAME user re-flags the SAME content while the first report is pending', async () => {
    const first = await parseResponse(await flag('member'));
    assert.equal(first.status, 201);

    const second = await parseResponse(await flag('member', { reason: 'harassment' }));
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'You have already flagged this content');

    const stored = rows(db, "SELECT * FROM community_flag WHERE target_id = 'p_long'");
    assert.equal(stored.length, 1, 'the duplicate was stored anyway');
    assert.equal(stored[0].reason, 'spam', 'the rejected duplicate still overwrote the original reason');
  });

  it('lets a DIFFERENT user flag the same content -- the unique key is per reporter', async () => {
    assert.equal((await parseResponse(await flag('member'))).status, 201);
    assert.equal((await parseResponse(await flag('member2'))).status, 201);
    assert.equal(rows(db, "SELECT 1 FROM community_flag WHERE target_id = 'p_long'").length, 2);
  });

  it('upserts in place when the same user re-flags content whose earlier report was resolved', async () => {
    db._sqlite.prepare(
      "INSERT INTO community_flag (id, user_id, target_type, target_id, reason, note, status) VALUES (?,?,?,?,?,?,?)"
    ).run('f_old', 'u_member', 'post', 'p_long', 'spam', 'first pass', 'resolved');

    const { status, body } = await parseResponse(await flag('member', { reason: 'harassment', note: 'it is back' }));
    assert.equal(status, 201);
    assert.equal(body.flagId, 'f_old', 'the upsert minted a second row instead of updating in place');

    const stored = rows(db, "SELECT * FROM community_flag WHERE target_id = 'p_long'");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].reason, 'harassment');
    assert.equal(stored[0].note, 'it is back');
    // Pinned as current behaviour, and it is the sharp edge of this state
    // machine: the ON CONFLICT clause updates reason and note only, so a
    // re-report of previously-resolved content stays out of the pending queue.
    assert.equal(stored[0].status, 'resolved');
  });

  it('does the same for a dismissed report', async () => {
    db._sqlite.prepare(
      "INSERT INTO community_flag (id, user_id, target_type, target_id, reason, note, status) VALUES (?,?,?,?,?,?,?)"
    ).run('f_dismissed', 'u_member', 'post', 'p_long', 'other', null, 'dismissed');

    const { status, body } = await parseResponse(await flag('member', { reason: 'spam' }));
    assert.equal(status, 201);
    assert.equal(body.flagId, 'f_dismissed');
    assert.equal(row(db, "SELECT status FROM community_flag WHERE id = 'f_dismissed'").status, 'dismissed');
  });
});

// ===========================================================================
// flags.js -- the moderator notification
// ===========================================================================

describe('POST /api/community/flags -- moderator notification', () => {
  let db;
  beforeEach(async () => { db = await seededDb({ seed: seedContent }); });

  async function flagAndDrain(body, { who = 'member', database = db, env } = {}) {
    const waitUntil = mockWaitUntil();
    const useEnv = env ?? envFor(database);
    const res = await parseResponse(await flagPost(database, { who, body, env: useEnv, waitUntil }));
    await drainWaitUntil(waitUntil);
    return { res, env: useEnv, waitUntil };
  }

  it('emails every mod, admin and superadmin exactly once, and nobody else', async () => {
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' });
    const recipients = net.ses.map((c) => c.body.Destination.ToAddresses[0]).sort();
    assert.deepEqual(recipients, ['admin2@example.com', 'admin@example.com', 'mod@example.com', 'super@example.com']);
  });

  it('skips blocked staff -- a banned moderator stops receiving the queue', async () => {
    db._sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run('u_mod');
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' });
    const recipients = net.ses.map((c) => c.body.Destination.ToAddresses[0]);
    assert.ok(!recipients.includes('mod@example.com'));
    assert.equal(recipients.length, 3);
  });

  it('sends nothing at all when the community has no staff', async () => {
    const staffless = await seededDb({ users: ['member', 'member2'], seed: seedContent });
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' }, { database: staffless });
    assert.equal(net.ses.length, 0);
  });

  it('names the reporter by display name, states the reason, and truncates the preview to 200 chars', async () => {
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'harassment' });
    const send = net.ses[0];
    assert.equal(send.body.Content.Simple.Subject.Data, '[STUC] Content flagged: harassment');
    assert.equal(send.body.FromEmailAddress, 'RRM Academy Alerts <alerts@mail.rrmacademy.org>');
    const html = send.body.Content.Simple.Body.Html.Data;
    const text = send.body.Content.Simple.Body.Text.Data;
    assert.match(html, /<strong>Mia M\.<\/strong> flagged a post as <strong>harassment<\/strong>/);
    assert.match(text, /^Mia M\. flagged a post as harassment\./);
    assert.ok(html.includes('A'.repeat(200)));
    assert.ok(!html.includes('A'.repeat(201)), 'the content preview was not truncated at 200 characters');
    assert.match(html, /href="https:\/\/rrmacademy\.org\/community\/post\/p_long\/"/);
  });

  it('falls back to the legacy title + body pair when a post has no merged content', async () => {
    await flagAndDrain({ targetType: 'post', targetId: 'p_legacy', reason: 'spam' });
    const text = net.ses[0].body.Content.Simple.Body.Text.Data;
    assert.match(text, /Content: Legacy title\n\nLegacy body/);
  });

  it('links a flagged comment to its parent post, not to the comment id', async () => {
    await flagAndDrain({ targetType: 'comment', targetId: 'c_1', reason: 'other' });
    const html = net.ses[0].body.Content.Simple.Body.Html.Data;
    assert.match(html, /flagged a comment as <strong>other<\/strong>/);
    assert.match(html, /href="https:\/\/rrmacademy\.org\/community\/post\/p_long\/"/);
    assert.ok(html.includes('A comment worth reporting'));
  });

  it('omits the note paragraph when no note was supplied', async () => {
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' });
    const send = net.ses[0];
    assert.ok(!send.body.Content.Simple.Body.Html.Data.includes('<p>Note:'));
    assert.ok(!send.body.Content.Simple.Body.Text.Data.includes('Note:'));
  });

  it('ESCAPES the reporter-supplied note -- a flag note cannot inject HTML into the moderator inbox', async () => {
    await flagAndDrain({
      targetType: 'post', targetId: 'p_long', reason: 'spam',
      note: `<script>alert("x")</script> & 'quote'`,
    });
    const html = net.ses[0].body.Content.Simple.Body.Html.Data;
    assert.ok(!html.includes('<script>'), 'raw script tag reached the moderator email');
    assert.match(html, /<p>Note: &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;quote&#39;<\/p>/);
    // The plain-text part is not escaped, by design; pinned so a change is noticed.
    assert.ok(net.ses[0].body.Content.Simple.Body.Text.Data.includes('<script>alert("x")</script>'));
  });

  // A moderator deleting the reported item in the window between the flag INSERT
  // and the notification render. Scripted through the harness `interleave` hook,
  // which fires immediately before the statement it names.
  it('says so when the flagged post vanished before the notification rendered', async () => {
    const racing = await seededDb({
      seed: seedContent,
      interleave: deleteWhen(/SELECT title, body, content FROM community_post/, "DELETE FROM community_post WHERE id = 'p_long'"),
    });
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' }, { database: racing });
    const html = net.ses[0].body.Content.Simple.Body.Html.Data;
    assert.match(html, /<em>\(unable to load preview\)<\/em>/);
    assert.match(net.ses[0].body.Content.Simple.Body.Text.Data, /Content: \(unable to load\)/);
  });

  it('says so when the flagged comment vanished before the notification rendered', async () => {
    const racing = await seededDb({
      seed: seedContent,
      interleave: deleteWhen(/SELECT content, post_id FROM community_comment/, "DELETE FROM community_comment WHERE id = 'c_1'"),
    });
    await flagAndDrain({ targetType: 'comment', targetId: 'c_1', reason: 'spam' }, { database: racing });
    const html = net.ses[0].body.Content.Simple.Body.Html.Data;
    assert.match(html, /<em>\(unable to load preview\)<\/em>/);
    // With no comment row there is no parent post id, so the link falls back to the comment id.
    assert.match(html, /community\/post\/c_1\//);
  });

  it('records the send in email_log so the moderator queue has a delivery trail', async () => {
    await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' });
    const logged = rows(db, "SELECT * FROM email_log WHERE source = 'community/flag-notify'");
    assert.equal(logged.length, 4);
    assert.equal(logged[0].category, 'transactional');
    assert.equal(logged[0].event, 'send');
  });

  it('still answers 201 and keeps the stored flag when SES rejects every send', async () => {
    net.restore();
    net = stubExternalFetch({ ses: () => { throw new Error('SES down'); } });
    const { res } = await flagAndDrain({ targetType: 'post', targetId: 'p_long', reason: 'spam' });
    assert.equal(res.status, 201);
    assert.ok(row(db, 'SELECT 1 FROM community_flag WHERE id = ?', res.body.flagId));
  });

  it('still answers 201 and logs flag_error when the notification query itself throws', async () => {
    const failing = await seededDb({
      seed: seedContent,
      interleave: throwOn(/SELECT email FROM user WHERE role IN/),
    });
    const env = envFor(failing);
    const { res } = await flagAndDrain(
      { targetType: 'post', targetId: 'p_long', reason: 'spam' },
      { database: failing, env },
    );
    assert.equal(res.status, 201);
    assert.ok(row(failing, 'SELECT 1 FROM community_flag WHERE id = ?', res.body.flagId),
      'a notification failure lost the flag');
    assert.ok(actionsOf(env).includes('flag_error'));
    assert.ok(detailsOf(env).some((d) => d === 'notification: D1 connection lost'));
    assert.equal(net.ses.length, 0);
  });
});

// ===========================================================================
// flags.js -- GET (the moderation queue)
// ===========================================================================

describe('GET /api/community/flags -- the queue', () => {
  let db;

  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        seedContent(sqlite);
        seedFlag(sqlite, { id: 'f_post', userId: 'u_member', targetId: 'p_long', reason: 'harassment', note: 'please look', createdAt: '2026-02-03T00:00:00Z' });
        seedFlag(sqlite, { id: 'f_comment', userId: 'u_member2', targetType: 'comment', targetId: 'c_1', reason: 'spam', createdAt: '2026-02-02T00:00:00Z' });
        seedFlag(sqlite, { id: 'f_ghost', userId: 'u_member', targetId: 'p_ghost', reason: 'other', createdAt: '2026-02-01T00:00:00Z' });
        seedFlag(sqlite, { id: 'f_done', userId: 'u_member2', targetId: 'p_legacy', reason: 'spam', status: 'resolved' });
        seedFlag(sqlite, { id: 'f_nope', userId: 'u_mod', targetId: 'p_titleonly', reason: 'spam', status: 'dismissed' });
      },
    });
  });

  it('401s an anonymous caller', async () => {
    const { status, body } = await parseResponse(await flagGet(db, { who: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('403s an ORDINARY MEMBER -- the queue names reporters and is not member-readable', async () => {
    const { status, body } = await parseResponse(await flagGet(db, { who: 'member' }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(body.flags, undefined);
  });

  it('403s an authenticated NON-member', async () => {
    const { status, body } = await parseResponse(await flagGet(db, { who: 'outsider' }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
  });

  it('serves mods, admins and superadmins', async () => {
    for (const who of ['mod', 'admin', 'super']) {
      const { status, body } = await parseResponse(await flagGet(db, { who }));
      assert.equal(status, 200, `${who} was refused the queue`);
      assert.deepEqual(body.flags.map((f) => f.id), ['f_post', 'f_comment', 'f_ghost']);
    }
  });

  it('defaults to pending, newest first', async () => {
    const { body } = await parseResponse(await flagGet(db));
    assert.deepEqual(body.flags.map((f) => f.id), ['f_post', 'f_comment', 'f_ghost']);
    assert.ok(body.flags.every((f) => f.status === 'pending'));
  });

  it('serves the resolved and dismissed archives on request', async () => {
    const resolved = await parseResponse(await flagGet(db, { query: '?status=resolved' }));
    assert.deepEqual(resolved.body.flags.map((f) => f.id), ['f_done']);
    const dismissed = await parseResponse(await flagGet(db, { query: '?status=dismissed' }));
    assert.deepEqual(dismissed.body.flags.map((f) => f.id), ['f_nope']);
  });

  it('falls back to pending for a status outside the allowlist rather than returning everything', async () => {
    const { body } = await parseResponse(await flagGet(db, { query: '?status=all' }));
    assert.deepEqual(body.flags.map((f) => f.id), ['f_post', 'f_comment', 'f_ghost']);
  });

  it('hydrates a flagged post with a truncated preview and the CONTENT AUTHOR, not the reporter', async () => {
    const { body } = await parseResponse(await flagGet(db));
    const f = body.flags.find((x) => x.id === 'f_post');
    assert.equal(f.targetType, 'post');
    assert.equal(f.targetId, 'p_long');
    assert.equal(f.reason, 'harassment');
    assert.equal(f.note, 'please look');
    assert.equal(f.contentPreview.length, 200);
    assert.equal(f.contentAuthor, 'Max Member');
    assert.equal(f.reporterName, 'Mia M.');
    assert.equal(f.createdAt, '2026-02-03T00:00:00Z');
  });

  it('hydrates a flagged comment from the comment table', async () => {
    const { body } = await parseResponse(await flagGet(db));
    const f = body.flags.find((x) => x.id === 'f_comment');
    assert.equal(f.contentPreview, 'A comment worth reporting');
    assert.equal(f.contentAuthor, 'Max Member');
    assert.equal(f.reporterName, 'Max Member');
  });

  it('keeps a flag whose target is already gone, marked Unknown rather than dropped', async () => {
    const { body } = await parseResponse(await flagGet(db));
    const f = body.flags.find((x) => x.id === 'f_ghost');
    assert.equal(f.contentPreview, '');
    assert.equal(f.contentAuthor, 'Unknown');
  });

  it('derives the content author display name when the author row has no name', async () => {
    db._sqlite.exec('DELETE FROM community_flag');
    seedFlag(db._sqlite, { id: 'f_noname_post', userId: 'u_member2', targetId: 'p_titleonly', createdAt: '2026-04-02T00:00:00Z' });
    seedFlag(db._sqlite, { id: 'f_noname_comment', userId: 'u_member2', targetType: 'comment', targetId: 'c_2', createdAt: '2026-04-01T00:00:00Z' });
    const { body } = await parseResponse(await flagGet(db));
    assert.deepEqual(body.flags.map((f) => f.contentAuthor), ['Mia M.', 'Mia M.']);
    assert.deepEqual(body.flags.map((f) => f.contentPreview), ['Only title', 'A nameless author comment']);
  });

  it('previews legacy title+body posts, body-only posts, and empty posts without crashing', async () => {
    db._sqlite.exec('DELETE FROM community_flag');
    seedFlag(db._sqlite, { id: 'f_a', userId: 'u_member', targetId: 'p_legacy', createdAt: '2026-03-03T00:00:00Z' });
    seedFlag(db._sqlite, { id: 'f_b', userId: 'u_member', targetId: 'p_bodyonly', createdAt: '2026-03-02T00:00:00Z' });
    seedFlag(db._sqlite, { id: 'f_c', userId: 'u_member', targetId: 'p_empty', createdAt: '2026-03-01T00:00:00Z' });
    const { body } = await parseResponse(await flagGet(db));
    const byId = Object.fromEntries(body.flags.map((f) => [f.id, f.contentPreview]));
    assert.equal(byId.f_a, 'Legacy title\n\nLegacy body');
    assert.equal(byId.f_b, 'Only body');
    assert.equal(byId.f_c, '');
  });

  it('returns an empty queue rather than an error when nothing is pending', async () => {
    db._sqlite.exec('DELETE FROM community_flag');
    const { status, body } = await parseResponse(await flagGet(db));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, flags: [] });
  });

  it('500s when D1 fails on the queue read', async () => {
    const failing = await seededDb({ seed: seedContent, interleave: throwOn(/reporter_first_name/) });
    const env = envFor(failing);
    const { status, body } = await parseResponse(await flagGet(failing, { env }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.ok(detailsOf(env).some((d) => d.startsWith('GET: ')));
  });
});

// ===========================================================================
// flags.js -- PATCH (resolve / dismiss)
// ===========================================================================

describe('PATCH /api/community/flags -- resolving', () => {
  let db;

  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        seedContent(sqlite);
        seedFlag(sqlite, { id: 'f_open', userId: 'u_member', targetId: 'p_long', note: 'please look' });
      },
    });
  });

  it('401s an anonymous caller and leaves the flag pending', async () => {
    const { status } = await parseResponse(await flagPatch(db, { who: null, body: { flagId: 'f_open', status: 'resolved' } }));
    assert.equal(status, 401);
    assert.equal(row(db, "SELECT status FROM community_flag WHERE id = 'f_open'").status, 'pending');
  });

  it('403s an ORDINARY MEMBER and leaves the flag pending', async () => {
    const { status, body } = await parseResponse(await flagPatch(db, { who: 'member', body: { flagId: 'f_open', status: 'dismissed' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(row(db, "SELECT status FROM community_flag WHERE id = 'f_open'").status, 'pending');
  });

  it('403s a MOD -- a mod may READ the queue but may not close a report', async () => {
    const { status, body } = await parseResponse(await flagPatch(db, { who: 'mod', body: { flagId: 'f_open', status: 'resolved' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(row(db, "SELECT status FROM community_flag WHERE id = 'f_open'").status, 'pending');
  });

  it('403s an authenticated NON-member', async () => {
    const { status, body } = await parseResponse(await flagPatch(db, { who: 'outsider', body: { flagId: 'f_open', status: 'resolved' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
  });

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await flagPatch(db, { rawBody: 'oops' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  for (const [label, rawBody] of [['null', 'null'], ['an array', '[]'], ['a string', '"f_open"']]) {
    it(`400s when the body is ${label}`, async () => {
      const { status, body } = await parseResponse(await flagPatch(db, { rawBody }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid payload');
    });
  }

  for (const [label, flagId] of [['missing', undefined], ['non-string', 99], ['over 100 chars', 'f'.repeat(101)]]) {
    it(`400s on a ${label} flagId`, async () => {
      const { status, body } = await parseResponse(await flagPatch(db, { body: { flagId, status: 'resolved' } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'flagId required');
    });
  }

  for (const [label, status] of [['missing', undefined], ['pending', 'pending'], ['invented', 'escalated']]) {
    it(`400s on a ${label} status`, async () => {
      const res = await parseResponse(await flagPatch(db, { body: { flagId: 'f_open', status } }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'status must be resolved or dismissed');
      assert.equal(row(db, "SELECT status FROM community_flag WHERE id = 'f_open'").status, 'pending');
    });
  }

  it('404s for a flagId that does not exist', async () => {
    const { status, body } = await parseResponse(await flagPatch(db, { body: { flagId: 'f_ghost', status: 'resolved' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Flag not found');
  });

  for (const target of ['resolved', 'dismissed']) {
    it(`records who closed the report and when, on ${target}`, async () => {
      const { status, body } = await parseResponse(await flagPatch(db, { who: 'admin', body: { flagId: 'f_open', status: target } }));
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true });
      const stored = row(db, "SELECT * FROM community_flag WHERE id = 'f_open'");
      assert.equal(stored.status, target);
      assert.equal(stored.resolved_by, 'u_admin');
      assert.match(stored.resolved_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.equal(stored.note, 'please look', 'closing the report rewrote the reporter note');
    });
  }

  it('lets a superadmin close a report too', async () => {
    const { status } = await parseResponse(await flagPatch(db, { who: 'super', body: { flagId: 'f_open', status: 'resolved' } }));
    assert.equal(status, 200);
    assert.equal(row(db, "SELECT resolved_by FROM community_flag WHERE id = 'f_open'").resolved_by, 'u_super');
  });

  it('drops a closed report out of the pending queue', async () => {
    await parseResponse(await flagPatch(db, { body: { flagId: 'f_open', status: 'dismissed' } }));
    const { body } = await parseResponse(await flagGet(db));
    assert.deepEqual(body.flags, []);
    const { body: archive } = await parseResponse(await flagGet(db, { query: '?status=dismissed' }));
    assert.deepEqual(archive.flags.map((f) => f.id), ['f_open']);
  });

  it('reassigns an already-closed report rather than 409ing -- pinned as current behaviour', async () => {
    await parseResponse(await flagPatch(db, { who: 'admin', body: { flagId: 'f_open', status: 'resolved' } }));
    const { status } = await parseResponse(await flagPatch(db, { who: 'super', body: { flagId: 'f_open', status: 'dismissed' } }));
    assert.equal(status, 200);
    const stored = row(db, "SELECT * FROM community_flag WHERE id = 'f_open'");
    assert.equal(stored.status, 'dismissed');
    assert.equal(stored.resolved_by, 'u_super');
  });

  it('500s and leaves the flag pending when D1 fails on the update', async () => {
    const failing = await seededDb({
      seed(sqlite) {
        seedContent(sqlite);
        seedFlag(sqlite, { id: 'f_open', userId: 'u_member', targetId: 'p_long' });
      },
      interleave: throwOn(/UPDATE community_flag SET status/),
    });
    const env = envFor(failing);
    const { status, body } = await parseResponse(await flagPatch(failing, { body: { flagId: 'f_open', status: 'resolved' }, env }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.equal(row(failing, "SELECT status FROM community_flag WHERE id = 'f_open'").status, 'pending');
    assert.ok(detailsOf(env).some((d) => d.startsWith('PATCH: ')));
  });
});
