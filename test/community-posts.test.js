/**
 * functions/api/community/posts.js -- the member-authored feed.
 *
 * 747 lines carrying five concerns at once: a filtered/paginated list, a
 * single-post read by id or by event slug, create, edit/pin, and delete. Every
 * one of them is untrusted input written by one member and rendered to others,
 * and almost every decision worth asserting is made by the database rather than
 * by JavaScript:
 *
 *  - ORDERING AND PAGINATION are SQL: `ORDER BY p.pinned DESC, p.created_at
 *    DESC LIMIT ?` with a `created_at < ?` cursor that also forces `pinned = 0`.
 *    A canned mock returns rows in whatever order the fixture listed them, so
 *    an ordering assertion against one is a restatement of the fixture. The
 *    pagination tests below deliberately include the EXACT-MULTIPLE case, where
 *    the final page is completely full: a full final page is the only shape
 *    that distinguishes a correct end-of-feed from a wrong one, and a fixture
 *    that always ends on a partial page cannot tell them apart.
 *  - SLUG UNIQUENESS is `idx_community_post_slug`, a UNIQUE index over
 *    `slug COLLATE NOCASE`. Both the pre-check and the UNIQUE-constraint catch
 *    that backstops it are exercised, the second through a scripted concurrent
 *    writer.
 *  - THE DELETE is a six-statement `db.batch()` whose statements 2 and 4 read
 *    `community_comment` through a subselect that statement 5 then deletes
 *    from. The source carries an ORDER MATTERS comment about exactly this. The
 *    orphan assertions read the child tables back after the fact, which is the
 *    only way that comment can be shown to be true.
 *  - AUTHORSHIP (the IDOR case): canEditPost / canDeletePost compare a STORED
 *    author_id to the session user. Every negative case re-reads the row.
 *
 * Runs on test/_d1-sqlite.mjs (real SQLite, committed schema + the committed
 * action-areas migration). The membership gate is the real requireMember from
 * _shared.js reached through a real session cookie -- never stubbed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse,
  stubExternalFetch, drainWaitUntil,
} from './_helpers.js';
import {
  communityDb, insertPost, insertComment, insertReaction, insertFlag,
  readPost, readReactions, readFlags, throwingOn, resultlessOn, mockR2,
  RAW, USERS, AREA_ACTIVE,
} from './_community-fixtures.mjs';

const posts = await import('../functions/api/community/posts.js');

const URL_ = 'https://rrmacademy.org/api/community/posts';
const HEART = '❤️';
const CLAP = '\u{1F44F}';

const day = (n) => new Date(Date.now() + n * 86400e3).toISOString();

/** Silences notifyNewPost's member blast by pre-arming its 15-minute cooldown. */
function cooledKv() {
  const kv = mockKV();
  kv.put('community:last_post_email', String(Date.now()));
  return kv;
}

function ctx(db, { who = 'memberA', body, url = URL_, env: envOverrides = {}, method = 'POST', waitUntil = mockWaitUntil() } = {}) {
  return {
    request: mockRequest(method, {
      url,
      headers: who ? { Cookie: `session=${RAW[who]}` } : {},
      body,
    }),
    env: mockEnv({ DB: db, COMMUNITY_KV: cooledKv(), ...envOverrides }),
    waitUntil,
  };
}

const list = (db, opts) => posts.onRequestGet(ctx(db, { ...opts, method: 'GET' }));
const create = (db, opts) => posts.onRequestPost(ctx(db, { ...opts, method: 'POST' }));
const patch = (db, opts) => posts.onRequestPatch(ctx(db, { ...opts, method: 'PATCH' }));
const remove = (db, opts) => posts.onRequestDelete(ctx(db, { ...opts, method: 'DELETE' }));

let db;
let fetchStub;
beforeEach(async () => {
  fetchStub = stubExternalFetch();
  db = await communityDb();
});
afterEach(() => { fetchStub.restore(); db.close(); });

describe('OPTIONS /api/community/posts', () => {
  it('answers the CORS preflight with 204 and the locked-down origin', async () => {
    const res = await posts.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ----------------------------------------------------------------- GET -----

describe('GET /api/community/posts -- the membership gate', () => {
  it('401s with no session cookie', async () => {
    const { status, body } = await parseResponse(await list(db, { who: null }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('403s a signed-in user with no membership', async () => {
    const { status, body } = await parseResponse(await list(db, { who: 'nonmember' }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
  });

  it('403s a member whose email is not verified', async () => {
    const { status, body } = await parseResponse(await list(db, { who: 'unverified' }));
    assert.equal(status, 403);
    assert.match(body.error, /verify your email/i);
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await list(db, { env: { DB: undefined } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('500s generically when the request URL cannot be parsed', async () => {
    const { status, body } = await parseResponse(await list(db, { url: 'not-a-url' }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
  });

  it('500s generically when the feed query throws, leaking nothing', async () => {
    const broken = throwingOn(db, 'FROM community_post p');
    const { status, body } = await parseResponse(await list(broken));
    assert.equal(status, 500);
    assert.ok(!JSON.stringify(body).includes('D1_DOWN'));
  });
});

describe('GET /api/community/posts?id= -- a single post', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p1', authorId: USERS.memberA, content: 'the body', createdAt: '2026-03-01 09:00:00' });
    insertPost(db._sqlite, { id: 'p_arch', authorId: USERS.admin, channel: 'members' });
  });

  it('400s when id is longer than 100 characters', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?id=${'x'.repeat(101)}` }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid id');
  });

  it('404s for an id that does not exist', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?id=p_nope` }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });

  it('returns the post with author, reactions and ownership resolved', async () => {
    insertComment(db._sqlite, { id: 'c1', postId: 'p1' });
    insertComment(db._sqlite, { id: 'c2', postId: 'p1' });
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: 'p1', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: 'p1', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: 'p1', emoji: CLAP });

    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?id=p1` }));
    assert.equal(status, 200);
    assert.equal(body.post.id, 'p1');
    assert.equal(body.post.body, 'the body');
    assert.equal(body.post.commentCount, 2);
    assert.deepEqual(body.post.reactions, { [HEART]: 2, [CLAP]: 1 });
    assert.deepEqual(body.post.myReactions, [HEART]);
    assert.equal(body.post.isOwn, true);
    assert.equal(body.post.authorName, 'Alice A');
    assert.equal(body.post.pinned, false);
  });

  it('reports isOwn false, and only the viewer\'s own reactions, for another member', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: 'p1', emoji: HEART });
    const { body } = await parseResponse(await list(db, { who: 'memberB', url: `${URL_}?id=p1` }));
    assert.equal(body.post.isOwn, false);
    assert.deepEqual(body.post.myReactions, []);
    assert.deepEqual(body.post.reactions, { [HEART]: 1 });
  });

  it('403s an ordinary member reading a post in an archive channel', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?id=p_arch` }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
  });

  it('403s a MOD on an archive-channel post -- the bar is admin, not mod', async () => {
    const { status } = await parseResponse(await list(db, { who: 'mod', url: `${URL_}?id=p_arch` }));
    assert.equal(status, 403);
  });

  it('lets an admin read an archive-channel post', async () => {
    const { status, body } = await parseResponse(await list(db, { who: 'admin', url: `${URL_}?id=p_arch` }));
    assert.equal(status, 200);
    assert.equal(body.post.id, 'p_arch');
  });

  it('falls back to displayName() when the author row has no name', async () => {
    db._sqlite.prepare('UPDATE user SET name = NULL, first_name = ?, last_name = ? WHERE id = ?')
      .run('Alice', 'Anderson', USERS.memberA);
    const { body } = await parseResponse(await list(db, { url: `${URL_}?id=p1` }));
    assert.equal(body.post.authorName, 'Alice A.');
  });

  it('merges legacy title+body when the content column is empty, and degrades cleanly', async () => {
    // postContent() is the compatibility shim over the pre-`content` schema.
    // All four of its arms are reachable from stored rows, so all four are pinned.
    insertPost(db._sqlite, { id: 'p_legacy', content: null, title: 'Legacy title', body: 'Legacy body' });
    insertPost(db._sqlite, { id: 'p_title_only', content: null, title: 'Only a title', body: null });
    insertPost(db._sqlite, { id: 'p_body_only', content: null, title: '', body: 'Only a body' });
    insertPost(db._sqlite, { id: 'p_empty', content: null, title: '', body: null });

    const merged = await parseResponse(await list(db, { url: `${URL_}?id=p_legacy` }));
    assert.equal(merged.body.post.body, 'Legacy title\n\nLegacy body');
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?id=p_title_only` }))).body.post.body, 'Only a title');
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?id=p_body_only` }))).body.post.body, 'Only a body');
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?id=p_empty` }))).body.post.body, '');
  });
});

describe('GET /api/community/posts?slug= -- the public event landing lookup', () => {
  beforeEach(() => {
    insertPost(db._sqlite, {
      id: 'p_ev', type: 'event', slug: 'live-call-may', authorId: USERS.admin,
      eventDate: day(3), eventLink: 'https://meet.example.com/x', speaker: 'Dr. Whittaker',
      ogImageUrl: '/api/assets/community/live-call.webp', content: 'Join us',
    });
    insertPost(db._sqlite, { id: 'p_disc', type: 'discussion', slug: 'not-an-event' });
  });

  it('400s when slug is longer than 100 characters', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?slug=${'x'.repeat(101)}` }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid slug');
  });

  it('resolves an event by slug, case-insensitively, with its event fields', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?slug=LIVE-CALL-MAY` }));
    assert.equal(status, 200);
    assert.equal(body.post.id, 'p_ev');
    assert.equal(body.post.slug, 'live-call-may');
    assert.equal(body.post.speaker, 'Dr. Whittaker');
    assert.equal(body.post.ogImageUrl, '/api/assets/community/live-call.webp');
    assert.equal(body.post.eventLink, 'https://meet.example.com/x');
  });

  it('404s on a slug that belongs to a non-event post -- the lookup is type-scoped', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?slug=not-an-event` }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });

  it('prefers id over slug when both are supplied', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?id=p_disc&slug=live-call-may` }));
    assert.equal(body.post.id, 'p_disc');
  });
});

describe('GET /api/community/posts -- the feed, ordering and pagination', () => {
  // Six unpinned posts, one minute apart, plus one pinned post that is OLDER
  // than all of them: the only fixture shape in which "pinned first" and
  // "newest first" disagree, so the ORDER BY is genuinely under test.
  beforeEach(() => {
    for (let i = 1; i <= 6; i++) {
      insertPost(db._sqlite, { id: `f${i}`, content: `post ${i}`, createdAt: `2026-04-01 10:0${i}:00` });
    }
    insertPost(db._sqlite, { id: 'f_pin', content: 'pinned', pinned: 1, createdAt: '2026-01-01 00:00:00' });
  });

  it('puts pinned posts first even when they are the oldest rows', async () => {
    const { body } = await parseResponse(await list(db));
    assert.equal(body.posts[0].id, 'f_pin');
    assert.equal(body.posts[0].pinned, true);
    assert.deepEqual(body.posts.slice(1).map((p) => p.id), ['f6', 'f5', 'f4', 'f3', 'f2', 'f1']);
  });

  it('paginates on an EXACT MULTIPLE of the page size -- the final page is FULL and the page after it is empty', async () => {
    // The shape that actually distinguishes a correct end-of-feed from a wrong
    // one. Six unpinned rows at limit=3 gives two completely full pages; a
    // fixture that ended on a partial page could not tell "the feed ended"
    // from "the cursor was off by one".
    const page1 = await parseResponse(await list(db, { url: `${URL_}?limit=3` }));
    assert.deepEqual(page1.body.posts.map((p) => p.id), ['f_pin', 'f6', 'f5']);

    // The cursor excludes pinned rows by construction, so page 2 is the next
    // three unpinned posts, and it is FULL.
    const cursor1 = page1.body.posts.at(-1).createdAt;
    const page2 = await parseResponse(await list(db, { url: `${URL_}?limit=3&before=${encodeURIComponent(cursor1)}` }));
    assert.deepEqual(page2.body.posts.map((p) => p.id), ['f4', 'f3', 'f2']);
    assert.equal(page2.body.posts.length, 3, 'the final page is completely full');

    const cursor2 = page2.body.posts.at(-1).createdAt;
    const page3 = await parseResponse(await list(db, { url: `${URL_}?limit=3&before=${encodeURIComponent(cursor2)}` }));
    assert.deepEqual(page3.body.posts.map((p) => p.id), ['f1']);

    const cursor3 = page3.body.posts.at(-1).createdAt;
    const page4 = await parseResponse(await list(db, { url: `${URL_}?limit=3&before=${encodeURIComponent(cursor3)}` }));
    assert.deepEqual(page4.body.posts, [], 'the page past the end is empty, not a repeat of the last page');
  });

  it('never repeats the pinned post on a later page -- the cursor forces pinned = 0', async () => {
    const page2 = await parseResponse(await list(db, { url: `${URL_}?limit=3&before=2026-04-01 10:05:00` }));
    assert.ok(!page2.body.posts.some((p) => p.id === 'f_pin'));
  });

  it('clamps limit: over 50 -> 50, non-numeric -> 20, zero -> 20, negative -> 1', async () => {
    for (let i = 7; i <= 60; i++) {
      insertPost(db._sqlite, { id: `g${i}`, createdAt: `2026-04-02 ${String(i % 24).padStart(2, '0')}:00:00` });
    }
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?limit=999` }))).body.posts.length, 50);
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?limit=abc` }))).body.posts.length, 20);
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?limit=0` }))).body.posts.length, 20);
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?limit=-5` }))).body.posts.length, 1);
    assert.equal((await parseResponse(await list(db, { url: `${URL_}?limit=4` }))).body.posts.length, 4);
  });

  it('filters by type', async () => {
    insertPost(db._sqlite, { id: 'r1', type: 'resource', resourceUrl: 'https://example.com/paper' });
    const { body } = await parseResponse(await list(db, { url: `${URL_}?type=resource` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['r1']);
    assert.equal(body.posts[0].resourceUrl, 'https://example.com/paper');
  });

  it('returns an empty list, and no reaction lookup, when nothing matches', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?type=announcement` }));
    assert.deepEqual(body.posts, []);
  });

  it('aggregates reactions across the page and scopes myReactions to the caller', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: 'f6', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: 'f6', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: 'f5', emoji: CLAP });
    const { body } = await parseResponse(await list(db, { who: 'memberA' }));
    const byId = Object.fromEntries(body.posts.map((p) => [p.id, p]));
    assert.deepEqual(byId.f6.reactions, { [HEART]: 2 });
    assert.deepEqual(byId.f6.myReactions, [HEART]);
    assert.deepEqual(byId.f5.reactions, { [CLAP]: 1 });
    assert.deepEqual(byId.f5.myReactions, []);
    assert.deepEqual(byId.f4.reactions, {});
  });

  it('counts comments per post via the aggregate join, zero included', async () => {
    insertComment(db._sqlite, { id: 'cc1', postId: 'f6' });
    insertComment(db._sqlite, { id: 'cc2', postId: 'f6' });
    const { body } = await parseResponse(await list(db));
    const byId = Object.fromEntries(body.posts.map((p) => [p.id, p]));
    assert.equal(byId.f6.commentCount, 2);
    assert.equal(byId.f5.commentCount, 0);
  });

  it('reports the author tier from the label join', async () => {
    db._sqlite.prepare('INSERT INTO user_label (user_id, label) VALUES (?, ?)').run(USERS.memberA, 'Uterus Super Hero 🦸‍♀️');
    const { body } = await parseResponse(await list(db));
    assert.equal(body.posts[0].authorTier, 'superhero');
  });

  it('falls back to displayName() in the feed too, not only on the single-post read', async () => {
    db._sqlite.prepare('UPDATE user SET name = NULL, first_name = ?, last_name = NULL WHERE id = ?')
      .run('Alice', USERS.memberA);
    const { body } = await parseResponse(await list(db));
    assert.equal(body.posts[0].authorName, 'Alice');
  });
});

describe('GET /api/community/posts -- channels', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_stuc', channel: 'stuc', content: 'open' });
    insertPost(db._sqlite, { id: 'p_members', channel: 'members', content: 'archived members' });
    insertPost(db._sqlite, { id: 'p_master', channel: 'masterclass', content: 'archived masterclass' });
  });

  it('defaults to the stuc channel and never leaks archive posts into it', async () => {
    const { body } = await parseResponse(await list(db));
    assert.deepEqual(body.posts.map((p) => p.id), ['p_stuc']);
  });

  it('falls back to stuc when the channel parameter is not in the allowlist', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?channel=hackers` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['p_stuc']);
  });

  it('403s an ordinary member asking for an archive channel', async () => {
    for (const channel of ['members', 'masterclass']) {
      const { status, body } = await parseResponse(await list(db, { url: `${URL_}?channel=${channel}` }));
      assert.equal(status, 403);
      assert.equal(body.error, 'Not authorized for this channel');
    }
  });

  it('serves the archive channels to an admin', async () => {
    const { body } = await parseResponse(await list(db, { who: 'admin', url: `${URL_}?channel=masterclass` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['p_master']);
  });
});

describe('GET /api/community/posts -- the action-area filter', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_area', areaId: AREA_ACTIVE, content: 'in an area', createdAt: '2026-05-01 10:00:00' });
    insertPost(db._sqlite, { id: 'p_noarea', content: 'no area', createdAt: '2026-05-01 11:00:00' });
  });

  it('400s when the area slug is longer than 100 characters', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?area=${'x'.repeat(101)}` }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_area');
  });

  it('filters the feed to an active area', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?area=research` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['p_area']);
    assert.equal(body.posts[0].areaId, AREA_ACTIVE);
  });

  it('falls through to the All stream for an ARCHIVED area slug (G-AREA-1)', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?area=retired` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['p_noarea', 'p_area']);
  });

  it('falls through to the All stream for an unknown area slug', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?area=does-not-exist` }));
    assert.equal(body.posts.length, 2);
  });

  it('treats an empty area parameter as present-but-unresolvable, not as absent', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?area=` }));
    assert.equal(status, 200);
    assert.equal(body.posts.length, 2);
  });
});

describe('GET /api/community/posts?type=event -- the event ordering', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'e_soon', type: 'event', eventDate: day(1), content: 'soon' });
    insertPost(db._sqlite, { id: 'e_later', type: 'event', eventDate: day(5), content: 'later' });
    insertPost(db._sqlite, { id: 'e_recent', type: 'event', eventDate: day(-1), content: 'recent past' });
    insertPost(db._sqlite, { id: 'e_old', type: 'event', eventDate: day(-9), content: 'old past' });
  });

  it('lists upcoming events soonest-first, then past events most-recent-first', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?type=event` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['e_soon', 'e_later', 'e_recent', 'e_old']);
  });

  it('honours the before cursor against event_date, not created_at', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?type=event&before=${encodeURIComponent(day(0))}` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['e_recent', 'e_old']);
  });

  it('honours limit on the event stream', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?type=event&limit=2` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['e_soon', 'e_later']);
  });

  it('filters events by action area', async () => {
    db._sqlite.prepare('UPDATE community_post SET area_id = ? WHERE id = ?').run(AREA_ACTIVE, 'e_later');
    const { body } = await parseResponse(await list(db, { url: `${URL_}?type=event&area=research` }));
    assert.deepEqual(body.posts.map((p) => p.id), ['e_later']);
  });

  it('403s an ordinary member asking for events on an archive channel', async () => {
    const { status } = await parseResponse(await list(db, { url: `${URL_}?type=event&channel=members` }));
    assert.equal(status, 403);
  });
});

// ---------------------------------------------------------------- POST -----

describe('POST /api/community/posts -- gate, rate limit and payload shape', () => {
  const discussion = () => ({ type: 'discussion', body: 'Hello everyone' });

  it('401s with no session and stores nothing', async () => {
    const { status } = await parseResponse(await create(db, { who: null, body: discussion() }));
    assert.equal(status, 401);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('403s a non-member and stores nothing', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'nonmember', body: discussion() }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await create(db, { env: { DB: undefined }, body: discussion() }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('429s when the 10-per-hour bucket is already full, before touching the database', async () => {
    const kv = cooledKv();
    await kv.put(`rl:posts:${USERS.memberA}`, JSON.stringify({ count: 10, start: Math.floor(Date.now() / 1000) }));
    const { status, body } = await parseResponse(await create(db, { env: { COMMUNITY_KV: kv }, body: discussion() }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('400s on a body that is not JSON, an array, or null', async () => {
    assert.equal((await parseResponse(await create(db, { body: undefined }))).body.error, 'Invalid JSON');
    assert.equal((await parseResponse(await create(db, { body: [discussion()] }))).body.error, 'Invalid payload');
    assert.equal((await parseResponse(await create(db, { body: null }))).body.error, 'Invalid payload');
  });
});

describe('POST /api/community/posts -- channel and type authorization', () => {
  it('400s on a channel outside the allowlist', async () => {
    const { status, body } = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', channel: 'hackers' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid channel');
  });

  it('403s an ordinary member posting to an archive channel', async () => {
    const { status, body } = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', channel: 'members' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
  });

  it('403s a MOD posting to an archive channel -- the bar is admin', async () => {
    const { status } = await parseResponse(await create(db, { who: 'mod', body: { type: 'discussion', body: 'hi', channel: 'members' } }));
    assert.equal(status, 403);
  });

  it('lets an admin post to an archive channel, and stores the channel', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'admin', body: { type: 'discussion', body: 'staff note', channel: 'masterclass' } }));
    assert.equal(status, 201);
    assert.equal(readPost(db, body.post.id).channel, 'masterclass');
  });

  it('400s when the type is missing or not one of the four', async () => {
    for (const type of [undefined, '', 'rant', 42]) {
      const { status, body } = await parseResponse(await create(db, { body: { type, body: 'hi' } }));
      assert.equal(status, 400, `type=${String(type)}`);
      assert.equal(body.error, 'Invalid post type');
    }
  });

  it('403s an ordinary member creating a staff-only type, and stores nothing', async () => {
    for (const type of ['announcement', 'resource']) {
      const { status, body } = await parseResponse(await create(db, { body: { type, body: 'hi' } }));
      assert.equal(status, 403, type);
      assert.equal(body.error, 'Not authorized for this post type');
    }
    const { status } = await parseResponse(await create(db, { body: { type: 'event', body: 'hi', eventDate: day(1), eventLink: 'https://x.example/y' } }));
    assert.equal(status, 403);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('403s a MOD creating a staff-only type -- canCreateType requires admin', async () => {
    const { status } = await parseResponse(await create(db, { who: 'mod', body: { type: 'announcement', body: 'hi' } }));
    assert.equal(status, 403);
  });

  it('lets an admin create an announcement', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'admin', body: { type: 'announcement', body: 'Read this' } }));
    assert.equal(status, 201);
    assert.equal(readPost(db, body.post.id).type, 'announcement');
  });
});

describe('POST /api/community/posts -- field validation', () => {
  it('400s on a non-string title and on a title over 200 characters', async () => {
    for (const title of [{}, 'x'.repeat(201)]) {
      const { status, body } = await parseResponse(await create(db, { body: { type: 'discussion', title, body: 'hi' } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_title');
    }
  });

  it('accepts an explicit null title', async () => {
    const { status } = await parseResponse(await create(db, { body: { type: 'discussion', title: null, body: 'hi' } }));
    assert.equal(status, 201);
  });

  it('400s on an empty, whitespace-only, non-string or missing body', async () => {
    for (const postBody of [undefined, '', '   \n ', 42]) {
      const { status, body } = await parseResponse(await create(db, { body: { type: 'discussion', body: postBody } }));
      assert.equal(status, 400, JSON.stringify(postBody));
      assert.equal(body.error, 'Post cannot be empty');
    }
  });

  it('400s on a body over 10000 characters, and accepts exactly 10000', async () => {
    const over = await parseResponse(await create(db, { body: { type: 'discussion', body: 'z'.repeat(10001) } }));
    assert.equal(over.status, 400);
    assert.equal(over.body.error, 'Post too long (max 10000 chars)');

    const at = await parseResponse(await create(db, { body: { type: 'discussion', body: 'z'.repeat(10000) } }));
    assert.equal(at.status, 201);
    assert.equal(readPost(db, at.body.post.id).content.length, 10000);
  });

  it('400s an event with no date and an event with no link', async () => {
    const noDate = await parseResponse(await create(db, { who: 'admin', body: { type: 'event', body: 'hi', eventLink: 'https://x.example/y' } }));
    assert.equal(noDate.status, 400);
    assert.equal(noDate.body.error, 'Event date required');

    const noLink = await parseResponse(await create(db, { who: 'admin', body: { type: 'event', body: 'hi', eventDate: day(1) } }));
    assert.equal(noLink.status, 400);
    assert.equal(noLink.body.error, 'Event link required');
  });

  it('rejects a non-http(s) event link and a non-http(s) resource URL', async () => {
    const evil = 'javascript:alert(1)';
    const ev = await parseResponse(await create(db, { who: 'admin', body: { type: 'event', body: 'hi', eventDate: day(1), eventLink: evil } }));
    assert.equal(ev.status, 400);
    assert.equal(ev.body.error, 'Event link must be an http or https URL');

    const res = await parseResponse(await create(db, { who: 'admin', body: { type: 'resource', body: 'hi', resourceUrl: 'ftp://files.example/x' } }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Resource URL must be an http or https URL');

    const notAUrl = await parseResponse(await create(db, { who: 'admin', body: { type: 'resource', body: 'hi', resourceUrl: 'not a url at all' } }));
    assert.equal(notAUrl.status, 400);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('accepts a plain http resource URL', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'admin', body: { type: 'resource', body: 'hi', resourceUrl: 'http://example.com/a' } }));
    assert.equal(status, 201);
    assert.equal(readPost(db, body.post.id).resource_url, 'http://example.com/a');
  });

  it('400s on a non-string speaker, an empty speaker and a speaker over 200 characters', async () => {
    for (const speaker of [7, '   ', 'x'.repeat(201)]) {
      const { status, body } = await parseResponse(await create(db, { who: 'admin', body: { type: 'discussion', body: 'hi', speaker } }));
      assert.equal(status, 400, JSON.stringify(speaker));
      assert.equal(body.error, 'invalid_speaker');
    }
  });

  it('trims and stores a speaker, and treats explicit null as absent', async () => {
    const withSpeaker = await parseResponse(await create(db, { who: 'admin', body: { type: 'discussion', body: 'hi', speaker: '  Dr. Boyle  ' } }));
    assert.equal(readPost(db, withSpeaker.body.post.id).speaker, 'Dr. Boyle');

    const nullSpeaker = await parseResponse(await create(db, { who: 'admin', body: { type: 'discussion', body: 'hi', speaker: null } }));
    assert.equal(readPost(db, nullSpeaker.body.post.id).speaker, null);
  });

  it('400s on a non-string area_id, an over-long area_id, and an area that is not active', async () => {
    for (const area_id of [7, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', area_id } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_area_id');
    }
    const archived = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', area_id: 'area_retired' } }));
    assert.equal(archived.status, 400);
    assert.equal(archived.body.error, 'invalid_area_id');

    const missing = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', area_id: 'area_nope' } }));
    assert.equal(missing.status, 400);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('stores a valid active area_id, and treats explicit null as absent', async () => {
    const withArea = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', area_id: AREA_ACTIVE } }));
    assert.equal(readPost(db, withArea.body.post.id).area_id, AREA_ACTIVE);
    assert.equal(withArea.body.post.areaId, AREA_ACTIVE);

    const noArea = await parseResponse(await create(db, { body: { type: 'discussion', body: 'hi', area_id: null } }));
    assert.equal(readPost(db, noArea.body.post.id).area_id, null);
  });
});

describe('POST /api/community/posts -- the write, verified by reading the row back', () => {
  it('stores a discussion authored by the session user, trimmed, with a derived title', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'memberB', body: { type: 'discussion', body: '  A thought about charting.  ' } }));
    assert.equal(status, 201);

    const stored = readPost(db, body.post.id);
    assert.equal(stored.author_id, USERS.memberB, 'the author is the session user, never the request body');
    assert.equal(stored.content, 'A thought about charting.');
    assert.equal(stored.title, 'A thought about charting.', 'title is derived from the first 200 chars of the body');
    assert.equal(stored.channel, 'stuc');
    assert.equal(stored.pinned, 0);
    assert.equal(stored.slug, null, 'only events get a slug');
    assert.equal(body.post.isOwn, true);
    assert.equal(body.post.authorName, 'Bob B');
  });

  it('truncates the derived title at 200 characters without truncating the stored body', async () => {
    const long = 'w'.repeat(500);
    const { body } = await parseResponse(await create(db, { body: { type: 'discussion', body: long } }));
    const stored = readPost(db, body.post.id);
    assert.equal(stored.title.length, 200);
    assert.equal(stored.content.length, 500);
  });

  it('prepends an event title to the stored content and keeps it as the row title', async () => {
    const { body } = await parseResponse(await create(db, {
      who: 'admin',
      body: { type: 'event', title: '  Live call  ', body: '  Join us at 8.  ', eventDate: day(2), eventLink: 'https://meet.example.com/abc' },
    }));
    const stored = readPost(db, body.post.id);
    assert.equal(stored.title, 'Live call');
    assert.equal(stored.content, 'Live call\n\nJoin us at 8.');
    assert.equal(stored.event_date, body.post.eventDate);
    assert.equal(stored.event_link, 'https://meet.example.com/abc');
  });

  it('does not prepend when the event title is whitespace only', async () => {
    const { body } = await parseResponse(await create(db, {
      who: 'admin',
      body: { type: 'event', title: '   ', body: 'Just a body', eventDate: day(2), eventLink: 'https://meet.example.com/abc' },
    }));
    const stored = readPost(db, body.post.id);
    assert.equal(stored.content, 'Just a body');
    assert.equal(stored.title, 'Just a body');
  });

  it('500s generically when the INSERT throws for a reason that is not a UNIQUE conflict', async () => {
    const broken = throwingOn(db, 'INSERT INTO community_post');
    const { status, body } = await parseResponse(await create(broken, { body: { type: 'discussion', body: 'hi' } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
  });
});

describe('POST /api/community/posts -- event slug minting', () => {
  const event = (over = {}) => ({
    type: 'event', body: 'Body text here', eventDate: day(2),
    eventLink: 'https://meet.example.com/abc', ...over,
  });

  it('derives the slug from the title', async () => {
    const { body } = await parseResponse(await create(db, { who: 'admin', body: event({ title: "Naomi's Live Q&A -- May" }) }));
    assert.equal(readPost(db, body.post.id).slug, 'naomis-live-q-a-may');
  });

  it('derives the slug from the first 60 characters of the body when no title is given', async () => {
    const { body } = await parseResponse(await create(db, { who: 'admin', body: event({ body: 'A very long body that will be cut off well before the end of this sentence' }) }));
    assert.equal(readPost(db, body.post.id).slug, 'a-very-long-body-that-will-be-cut-off-well-before-the-end-of');
  });

  it('accepts an explicit slug and normalises it', async () => {
    const { body } = await parseResponse(await create(db, { who: 'admin', body: event({ slug: '  My CUSTOM Slug!!  ' }) }));
    assert.equal(readPost(db, body.post.id).slug, 'my-custom-slug');
  });

  it('400s on a non-string slug and a slug over 100 characters', async () => {
    for (const slug of [9, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await create(db, { who: 'admin', body: event({ slug }) }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid slug');
    }
  });

  it('400s when nothing sluggable can be derived', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'admin', body: event({ title: '!!! ??? ***' }) }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Could not generate a valid slug from title');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('appends -2, then -3, on collision -- checked case-insensitively', async () => {
    await create(db, { who: 'admin', body: event({ title: 'Live Call' }) });
    const second = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'LIVE call' }) }));
    assert.equal(readPost(db, second.body.post.id).slug, 'live-call-2');
    const third = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'live CALL' }) }));
    assert.equal(readPost(db, third.body.post.id).slug, 'live-call-3');
  });

  it('reuses a freed number rather than always climbing', async () => {
    for (const slug of ['live-call', 'live-call-3']) {
      insertPost(db._sqlite, { id: `seed_${slug}`, type: 'event', slug, authorId: USERS.admin });
    }
    const { body } = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'Live Call' }) }));
    assert.equal(readPost(db, body.post.id).slug, 'live-call-2');
  });

  it('409s once every numbered variant from 2 to 99 is taken', async () => {
    insertPost(db._sqlite, { id: 'seed_base', type: 'event', slug: 'live-call', authorId: USERS.admin });
    for (let i = 2; i <= 99; i++) {
      insertPost(db._sqlite, { id: `seed_${i}`, type: 'event', slug: `live-call-${i}`, authorId: USERS.admin });
    }
    const { status, body } = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'Live Call' }) }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_conflict');
  });

  it('409s rather than 500s when a concurrent writer takes the slug between the check and the INSERT', async () => {
    // The pre-check is not a lock. `idx_community_post_slug` is the actual
    // guarantee, and the UNIQUE-constraint catch is what turns it into a 409
    // instead of a leaked driver error. Scripted with the interleave hook,
    // which stands in for another isolate.
    let raced = false;
    const racy = await communityDb(undefined, {
      interleave({ sql, db: sqlite }) {
        if (raced || !sql.includes('INSERT INTO community_post')) return;
        raced = true;
        sqlite.prepare("INSERT INTO community_post (id, author_id, type, title, slug) VALUES ('race', ?, 'event', 't', 'live-call')")
          .run(USERS.admin);
      },
    });
    try {
      const { status, body } = await parseResponse(await create(racy, { who: 'admin', body: event({ title: 'Live Call' }) }));
      assert.equal(status, 409);
      assert.equal(body.error, 'slug_conflict');
      assert.ok(raced);
      assert.equal(racy._sqlite.prepare("SELECT COUNT(*) AS n FROM community_post WHERE slug = 'live-call'").get().n, 1);
    } finally {
      racy.close();
    }
  });

  it('still numbers the variant when the driver returns no results array at all', async () => {
    // `variants.results || []` guards a shape node:sqlite never produces, so it
    // needs a driver-shape stub to reach. The assertion is that the numbering
    // degrades to "assume nothing is taken" rather than throwing on undefined.
    insertPost(db._sqlite, { id: 'seed_base', type: 'event', slug: 'live-call', authorId: USERS.admin });
    const odd = resultlessOn(db, 'SELECT slug FROM community_post WHERE slug LIKE');
    const { status, body } = await parseResponse(await create(odd, { who: 'admin', body: event({ title: 'Live Call' }) }));
    assert.equal(status, 201);
    assert.equal(readPost(db, body.post.id).slug, 'live-call-2');
  });

  it('400s on a non-string or over-long og_image_url, and on a non-http(s) one', async () => {
    for (const ogImageUrl of [9, 'x'.repeat(2001)]) {
      const { status, body } = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'A', ogImageUrl }) }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid og_image_url');
    }
    const evil = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'A', ogImageUrl: 'javascript:alert(1)' }) }));
    assert.equal(evil.status, 400);
    assert.equal(evil.body.error, 'og_image_url must be http/https or a community asset path');
  });

  it('accepts an absolute https og_image_url and a relative community asset path', async () => {
    const abs = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'A', ogImageUrl: 'https://cdn.example/a.png' }) }));
    assert.equal(readPost(db, abs.body.post.id).og_image_url, 'https://cdn.example/a.png');

    const rel = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'B', ogImageUrl: '/api/assets/community/b.webp' }) }));
    assert.equal(readPost(db, rel.body.post.id).og_image_url, '/api/assets/community/b.webp');
  });

  it('treats an explicit null og_image_url as absent', async () => {
    const { body } = await parseResponse(await create(db, { who: 'admin', body: event({ title: 'C', ogImageUrl: null }) }));
    assert.equal(readPost(db, body.post.id).og_image_url, null);
  });
});

describe('POST /api/community/posts -- the fire-and-forget notifications', () => {
  it('emails the STUC roster on a new post, excluding the author', async () => {
    const waitUntil = mockWaitUntil();
    await create(db, { who: 'memberA', waitUntil, env: { COMMUNITY_KV: mockKV() }, body: { type: 'discussion', body: 'Hello club' } });
    await drainWaitUntil(waitUntil);
    const to = fetchStub.ses.map((c) => c.body.Destination.ToAddresses[0]).sort();
    assert.deepEqual(to, ['admin@example.com', 'b@example.com', 'mod@example.com', 'unver@example.com']);
    assert.ok(!to.includes('a@example.com'), 'the author is never emailed about their own post');
  });

  it('honours the 15-minute cooldown and sends nothing when it is already armed', async () => {
    const waitUntil = mockWaitUntil();
    await create(db, { waitUntil, body: { type: 'discussion', body: 'Hello club' } });
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 0);
  });

  it('emails the share link when an event post is created with a slug', async () => {
    const waitUntil = mockWaitUntil();
    await create(db, {
      who: 'admin', waitUntil,
      body: { type: 'event', title: 'Live call', body: 'Join us', eventDate: day(2), eventLink: 'https://meet.example.com/abc' },
    });
    await drainWaitUntil(waitUntil);
    const shareMails = fetchStub.ses.filter((c) => c.body.Destination.ToAddresses[0] === 'naomimwhittaker@gmail.com');
    assert.equal(shareMails.length, 1);
    assert.match(shareMails[0].body.Content.Simple.Body.Html.Data, /\/events\/live-call\//);
  });

  it('still returns 201 and keeps the post when the SHARE-LINK notification rejects', async () => {
    // Reaching this guard needs a specific shape, and the reason is worth
    // stating rather than hiding behind a stub. notifyEventShareLink() wraps
    // its own sendEmail() call in `.catch(err => console.error(..., err.message))`,
    // so every ordinary failure -- missing SES credentials, a network error, a
    // non-2xx from SES -- is absorbed inside the helper and the outer guard in
    // posts.js never runs. The one thing that inner handler cannot absorb is a
    // rejection value it cannot read `.message` off, because reading it is what
    // throws. So the stub below rejects the SES response body with a non-Error,
    // which is the narrowest way to make the helper itself reject.
    //
    // The contrived part is the rejection VALUE. The property under test is
    // not: a member's post must survive any failure of a fire-and-forget
    // notification, and that failure must surface as a logged warning rather
    // than an unhandled rejection that takes the isolate down.
    fetchStub.restore();
    fetchStub = stubExternalFetch({
      ses: () => ({ ok: true, status: 200, text: async () => '{}', json: async () => { throw null; } }),
    });
    const waitUntil = mockWaitUntil();
    const { status, body } = await parseResponse(await create(db, {
      who: 'admin', waitUntil,
      body: { type: 'event', title: 'Live call', body: 'Join us', eventDate: day(2), eventLink: 'https://meet.example.com/abc' },
    }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 201);
    const stored = readPost(db, body.post.id);
    assert.equal(stored.slug, 'live-call', 'the event post is stored in full despite the failed notification');
    assert.equal(stored.event_link, 'https://meet.example.com/abc');
  });

  it('still returns 201 and keeps the post when the roster notification throws', async () => {
    // The notification is fire-and-forget with its own .catch. A member's post
    // must not be lost because a mailing-list query failed.
    const broken = throwingOn(db, 'SELECT DISTINCT u.email');
    const waitUntil = mockWaitUntil();
    const { status, body } = await parseResponse(await create(broken, {
      waitUntil, env: { COMMUNITY_KV: mockKV() }, body: { type: 'discussion', body: 'Still stored' },
    }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 201);
    assert.equal(readPost(db, body.post.id).content, 'Still stored');
    assert.equal(fetchStub.ses.length, 0);
  });
});

// --------------------------------------------------------------- PATCH -----

describe('PATCH /api/community/posts -- gate and payload shape', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_mine', authorId: USERS.memberA, content: 'original A' });
  });

  it('401s with no session, and leaves the row untouched', async () => {
    const { status } = await parseResponse(await patch(db, { who: null, body: { postId: 'p_mine', body: 'x' } }));
    assert.equal(status, 401);
    assert.equal(readPost(db, 'p_mine').content, 'original A');
  });

  it('403s a non-member', async () => {
    const { status } = await parseResponse(await patch(db, { who: 'nonmember', body: { postId: 'p_mine', body: 'x' } }));
    assert.equal(status, 403);
    assert.equal(readPost(db, 'p_mine').content, 'original A');
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await patch(db, { env: { DB: undefined }, body: { postId: 'p_mine', body: 'x' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a body that is not JSON, an array, or null', async () => {
    assert.equal((await parseResponse(await patch(db, { body: undefined }))).body.error, 'Invalid JSON');
    assert.equal((await parseResponse(await patch(db, { body: [] }))).body.error, 'Invalid payload');
    assert.equal((await parseResponse(await patch(db, { body: null }))).body.error, 'Invalid payload');
  });

  it('400s when postId is missing, non-string, or over 100 characters', async () => {
    for (const postId of [undefined, 4, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await patch(db, { body: { postId, body: 'x' } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'postId required');
    }
  });

  it('400s on a non-string title and a title over 200 characters', async () => {
    for (const title of [{}, 'x'.repeat(201)]) {
      const { status, body } = await parseResponse(await patch(db, { body: { postId: 'p_mine', title, body: 'x' } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_title');
    }
  });

  it('404s for a post that does not exist', async () => {
    const { status, body } = await parseResponse(await patch(db, { body: { postId: 'p_nope', body: 'x' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });

  it('400s when nothing in the payload maps to a column', async () => {
    const { status, body } = await parseResponse(await patch(db, { body: { postId: 'p_mine', title: 'ignored' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Nothing to update');
  });

  it('500s generically when the UPDATE throws for a reason that is not a UNIQUE conflict', async () => {
    const broken = throwingOn(db, 'UPDATE community_post SET');
    const { status, body } = await parseResponse(await patch(broken, { body: { postId: 'p_mine', body: 'edited' } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.equal(readPost(db, 'p_mine').content, 'original A');
  });
});

describe('PATCH /api/community/posts -- who may edit what', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_mine', authorId: USERS.memberA, content: 'original A' });
    insertPost(db._sqlite, { id: 'p_theirs', authorId: USERS.memberB, content: 'original B' });
    insertPost(db._sqlite, { id: 'p_arch', authorId: USERS.memberA, channel: 'members', content: 'archived' });
  });

  it('REFUSES member B editing member A\'s post -- the IDOR case', async () => {
    const { status, body } = await parseResponse(await patch(db, { who: 'memberB', body: { postId: 'p_mine', body: 'hijacked' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(readPost(db, 'p_mine').content, 'original A', 'A\'s post must be byte-identical after B\'s attempt');
  });

  it('lets the author edit their own post, trimmed', async () => {
    const { status, body } = await parseResponse(await patch(db, { body: { postId: 'p_mine', body: '  revised  ' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(readPost(db, 'p_mine').content, 'revised');
    assert.match(readPost(db, 'p_mine').updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(readPost(db, 'p_theirs').content, 'original B', 'no other row is touched');
  });

  it('lets an admin edit another member\'s post -- moderation is the documented exception', async () => {
    const { status } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_mine', body: 'moderated' } }));
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_mine').content, 'moderated');
  });

  it('REFUSES a MOD editing another member\'s post -- canEditPost requires admin', async () => {
    const { status } = await parseResponse(await patch(db, { who: 'mod', body: { postId: 'p_mine', body: 'modded' } }));
    assert.equal(status, 403);
    assert.equal(readPost(db, 'p_mine').content, 'original A');
  });

  it('403s the author editing their own post once it sits in an archive channel', async () => {
    const { status, body } = await parseResponse(await patch(db, { body: { postId: 'p_arch', body: 'edited' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
    assert.equal(readPost(db, 'p_arch').content, 'archived');
  });

  it('lets an admin edit an archive-channel post', async () => {
    const { status } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_arch', body: 'staff edit' } }));
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_arch').content, 'staff edit');
  });

  it('403s an ordinary member trying to pin, and stores nothing', async () => {
    const { status, body } = await parseResponse(await patch(db, { body: { postId: 'p_mine', pinned: true } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(readPost(db, 'p_mine').pinned, 0);
  });

  it('lets a MOD pin and unpin any post -- pinning is the one mod-level power here', async () => {
    const pin = await parseResponse(await patch(db, { who: 'mod', body: { postId: 'p_mine', pinned: true } }));
    assert.equal(pin.status, 200);
    assert.equal(readPost(db, 'p_mine').pinned, 1);

    await patch(db, { who: 'mod', body: { postId: 'p_mine', pinned: false } });
    assert.equal(readPost(db, 'p_mine').pinned, 0);
  });

  it('lets a mod pin without also granting them a body edit in the same request', async () => {
    const { status } = await parseResponse(await patch(db, { who: 'mod', body: { postId: 'p_mine', pinned: true, body: 'sneaky edit' } }));
    assert.equal(status, 403);
    assert.equal(readPost(db, 'p_mine').pinned, 0, 'the pin must not land either -- the request is refused whole');
    assert.equal(readPost(db, 'p_mine').content, 'original A');
  });
});

describe('PATCH /api/community/posts -- field-by-field edits', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_mine', authorId: USERS.memberA, content: 'original A' });
    insertPost(db._sqlite, {
      id: 'p_ev', type: 'event', authorId: USERS.admin, title: 'Live call',
      slug: 'live-call', eventDate: day(2), eventLink: 'https://meet.example.com/a',
      ogImageUrl: '/api/assets/community/old.webp', content: 'Join us',
    });
  });

  it('400s on an empty body edit and on one over 10000 characters', async () => {
    const empty = await parseResponse(await patch(db, { body: { postId: 'p_mine', body: '   ' } }));
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'Post cannot be empty');

    const long = await parseResponse(await patch(db, { body: { postId: 'p_mine', body: 'z'.repeat(10001) } }));
    assert.equal(long.status, 400);
    assert.equal(long.body.error, 'Post too long');
    assert.equal(readPost(db, 'p_mine').content, 'original A');
  });

  it('updates event_date, event_link and resource_url, and rejects unsafe URLs', async () => {
    const newDate = day(9);
    const ok = await parseResponse(await patch(db, {
      who: 'admin',
      body: { postId: 'p_ev', eventDate: newDate, eventLink: 'https://meet.example.com/b', resourceUrl: 'https://example.com/paper' },
    }));
    assert.equal(ok.status, 200);
    const stored = readPost(db, 'p_ev');
    assert.equal(stored.event_date, newDate);
    assert.equal(stored.event_link, 'https://meet.example.com/b');
    assert.equal(stored.resource_url, 'https://example.com/paper');

    const badLink = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', eventLink: 'javascript:alert(1)' } }));
    assert.equal(badLink.status, 400);
    assert.equal(badLink.body.error, 'Event link must be an http or https URL');

    const badRes = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', resourceUrl: 'ftp://x/y' } }));
    assert.equal(badRes.status, 400);
    assert.equal(readPost(db, 'p_ev').event_link, 'https://meet.example.com/b', 'a rejected field leaves the row alone');
  });

  it('accepts explicit nulls for event_link and resource_url without running the URL check', async () => {
    const { status } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', eventLink: null, resourceUrl: null } }));
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_ev').event_link, null);
    assert.equal(readPost(db, 'p_ev').resource_url, null);
  });

  it('400s when slug or og_image_url is sent for a post that is not an event', async () => {
    for (const field of [{ slug: 'x' }, { ogImageUrl: 'https://cdn.example/a.png' }]) {
      const { status, body } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_mine', ...field } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'slug_and_og_image_event_only');
    }
    assert.equal(readPost(db, 'p_mine').slug, null);
  });

  it('normalises a new slug, clears it on null, and rejects a bad one', async () => {
    const renamed = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', slug: '  New SLUG!!  ' } }));
    assert.equal(renamed.status, 200);
    assert.equal(readPost(db, 'p_ev').slug, 'new-slug');

    const cleared = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', slug: null } }));
    assert.equal(cleared.status, 200);
    assert.equal(readPost(db, 'p_ev').slug, null);

    for (const slug of [7, 'x'.repeat(101), '!!!']) {
      const { status, body } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', slug } }));
      assert.equal(status, 400, JSON.stringify(slug));
      assert.equal(body.error, 'Invalid slug');
    }
  });

  it('409s when the new slug collides with another post, and 200s when it "collides" with itself', async () => {
    insertPost(db._sqlite, { id: 'p_other', type: 'event', slug: 'taken', authorId: USERS.admin });
    const conflict = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', slug: 'TAKEN' } }));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'slug_conflict');
    assert.equal(readPost(db, 'p_ev').slug, 'live-call');

    const self = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', slug: 'live-call' } }));
    assert.equal(self.status, 200, 'a post may keep its own slug');
  });

  it('409s rather than 500s when a concurrent writer takes the slug between the check and the UPDATE', async () => {
    let raced = false;
    const racy = await communityDb(
      (sqlite) => {
        insertPost(sqlite, { id: 'p_ev', type: 'event', authorId: USERS.admin, slug: 'live-call', title: 'Live call' });
      },
      {
        interleave({ sql, db: sqlite }) {
          if (raced || !sql.includes('UPDATE community_post SET')) return;
          raced = true;
          sqlite.prepare("INSERT INTO community_post (id, author_id, type, title, slug) VALUES ('race', ?, 'event', 't', 'renamed')")
            .run(USERS.admin);
        },
      },
    );
    try {
      const { status, body } = await parseResponse(await patch(racy, { who: 'admin', body: { postId: 'p_ev', slug: 'renamed' } }));
      assert.equal(status, 409);
      assert.equal(body.error, 'slug_conflict');
      assert.ok(raced);
    } finally {
      racy.close();
    }
  });

  it('validates og_image_url the same way create does, and clears it on null', async () => {
    for (const ogImageUrl of [9, 'x'.repeat(2001)]) {
      const { status, body } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', ogImageUrl } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid og_image_url');
    }
    const evil = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', ogImageUrl: 'javascript:alert(1)' } }));
    assert.equal(evil.status, 400);
    assert.equal(evil.body.error, 'og_image_url must be http/https or a community asset path');

    const cleared = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', ogImageUrl: null } }));
    assert.equal(cleared.status, 200);
    assert.equal(readPost(db, 'p_ev').og_image_url, null);
  });

  it('validates the speaker the same way create does, and clears it on null', async () => {
    // Recorded, not hidden: the `patchedSpeakerValue` expression a few lines
    // below the validator carries a third arm,
    // `typeof reqSpeaker === 'string' ? reqSpeaker.trim() : null`, whose null
    // side is unreachable. A non-string speaker has already returned 400 by
    // then, so by the time that expression runs reqSpeaker can only be
    // undefined, null, or a validated string. It is the one branch in this file
    // no request can reach, and a test that pretended otherwise would be
    // asserting a response the endpoint cannot produce.
    for (const speaker of [7, '  ', 'x'.repeat(201)]) {
      const { status, body } = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', speaker } }));
      assert.equal(status, 400, JSON.stringify(speaker));
      assert.equal(body.error, 'invalid_speaker');
    }
    const set = await parseResponse(await patch(db, { who: 'admin', body: { postId: 'p_ev', speaker: '  Dr. Boyle  ' } }));
    assert.equal(set.status, 200);
    assert.equal(readPost(db, 'p_ev').speaker, 'Dr. Boyle');

    await patch(db, { who: 'admin', body: { postId: 'p_ev', speaker: null } });
    assert.equal(readPost(db, 'p_ev').speaker, null);
  });
});

describe('PATCH /api/community/posts -- R2 cleanup and the share-link notification', () => {
  beforeEach(() => {
    insertPost(db._sqlite, {
      id: 'p_ev', type: 'event', authorId: USERS.admin, title: 'Live call',
      slug: 'live-call', eventDate: day(2), eventLink: 'https://meet.example.com/a',
      ogImageUrl: '/api/assets/community/old.webp', content: 'Join us',
    });
  });

  it('deletes the superseded R2 object when the og image is replaced', async () => {
    const r2 = mockR2();
    const waitUntil = mockWaitUntil();
    const { status } = await parseResponse(await patch(db, {
      who: 'admin', waitUntil, env: { R2_ASSETS: r2 },
      body: { postId: 'p_ev', ogImageUrl: '/api/assets/community/new.webp' },
    }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 200);
    assert.deepEqual(r2.deleted, ['community/old.webp']);
    assert.equal(readPost(db, 'p_ev').og_image_url, '/api/assets/community/new.webp');
  });

  it('deletes the superseded R2 object when the og image is cleared to null', async () => {
    const r2 = mockR2();
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, env: { R2_ASSETS: r2 }, body: { postId: 'p_ev', ogImageUrl: null } });
    await drainWaitUntil(waitUntil);
    assert.deepEqual(r2.deleted, ['community/old.webp']);
  });

  it('does not delete anything when the og image is set to the value it already had', async () => {
    const r2 = mockR2();
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, env: { R2_ASSETS: r2 }, body: { postId: 'p_ev', ogImageUrl: '/api/assets/community/old.webp' } });
    await drainWaitUntil(waitUntil);
    assert.deepEqual(r2.deleted, []);
  });

  it('does not delete an externally hosted og image -- only /api/assets/ paths map to an R2 key', async () => {
    db._sqlite.prepare('UPDATE community_post SET og_image_url = ? WHERE id = ?').run('https://cdn.example/x.png', 'p_ev');
    const r2 = mockR2();
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, env: { R2_ASSETS: r2 }, body: { postId: 'p_ev', ogImageUrl: null } });
    await drainWaitUntil(waitUntil);
    assert.deepEqual(r2.deleted, []);
  });

  it('skips R2 cleanup entirely when the bucket binding is absent, and still updates the row', async () => {
    const waitUntil = mockWaitUntil();
    const { status } = await parseResponse(await patch(db, {
      who: 'admin', waitUntil, env: { R2_ASSETS: undefined },
      body: { postId: 'p_ev', ogImageUrl: '/api/assets/community/new.webp' },
    }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_ev').og_image_url, '/api/assets/community/new.webp');
  });

  it('survives an R2 delete that rejects -- the row edit still stands', async () => {
    const r2 = mockR2({ failWith: 'R2 unavailable' });
    const waitUntil = mockWaitUntil();
    const { status } = await parseResponse(await patch(db, {
      who: 'admin', waitUntil, env: { R2_ASSETS: r2 },
      body: { postId: 'p_ev', ogImageUrl: '/api/assets/community/new.webp' },
    }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 200);
    assert.deepEqual(r2.deleted, ['community/old.webp']);
    assert.equal(readPost(db, 'p_ev').og_image_url, '/api/assets/community/new.webp');
  });

  it('emails the share link when an event gains its FIRST slug via PATCH', async () => {
    db._sqlite.prepare('UPDATE community_post SET slug = NULL WHERE id = ?').run('p_ev');
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, body: { postId: 'p_ev', slug: 'first-slug' } });
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 1);
    assert.match(fetchStub.ses[0].body.Content.Simple.Body.Html.Data, /\/events\/first-slug\//);
  });

  it('does NOT re-email when an event that already had a slug is renamed', async () => {
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, body: { postId: 'p_ev', slug: 'renamed' } });
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 0);
  });

  it('carries the in-flight body, event date and speaker into the share-link email rather than the stale row', async () => {
    db._sqlite.prepare('UPDATE community_post SET slug = NULL WHERE id = ?').run('p_ev');
    const waitUntil = mockWaitUntil();
    await patch(db, {
      who: 'admin', waitUntil,
      body: { postId: 'p_ev', slug: 'first-slug', body: 'Updated body', speaker: 'Dr. Boyle', eventDate: day(4) },
    });
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 1);
    assert.match(fetchStub.ses[0].body.Content.Simple.Body.Html.Data, /Dr\. Boyle/);
  });

  it('uses the stored speaker and event date when the patch does not change them', async () => {
    db._sqlite.prepare('UPDATE community_post SET slug = NULL, speaker = ? WHERE id = ?').run('Stored Speaker', 'p_ev');
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, body: { postId: 'p_ev', slug: 'first-slug' } });
    await drainWaitUntil(waitUntil);
    assert.match(fetchStub.ses[0].body.Content.Simple.Body.Html.Data, /Stored Speaker/);
  });

  it('keeps the slug edit when the share-link notification rejects', async () => {
    // Same narrow mechanism as the create-side case, and for the same reason:
    // notifyEventShareLink absorbs every readable error internally, so the
    // only way to observe posts.js's own guard is a rejection value whose
    // `.message` cannot be read. The property under test is that a failed
    // fire-and-forget notification never rolls back or masks the edit.
    db._sqlite.prepare('UPDATE community_post SET slug = NULL WHERE id = ?').run('p_ev');
    fetchStub.restore();
    fetchStub = stubExternalFetch({
      ses: () => ({ ok: true, status: 200, text: async () => '{}', json: async () => { throw null; } }),
    });
    const waitUntil = mockWaitUntil();
    const { status } = await parseResponse(await patch(db, { who: 'admin', waitUntil, body: { postId: 'p_ev', slug: 'first-slug' } }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_ev').slug, 'first-slug');
  });

  it('sends the share link for a legacy event row with an empty title and no content', async () => {
    // The pre-`content` schema left rows with title = '' and content = NULL,
    // and both feed into the share-link payload. This pins the two fallbacks
    // that keep such a row from emailing "undefined" out to a real inbox.
    insertPost(db._sqlite, { id: 'p_legacy_ev', type: 'event', authorId: USERS.admin, title: '', content: null, body: null, eventDate: day(3) });
    const waitUntil = mockWaitUntil();
    const { status } = await parseResponse(await patch(db, { who: 'admin', waitUntil, body: { postId: 'p_legacy_ev', slug: 'legacy-event' } }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 200);
    assert.equal(fetchStub.ses.length, 1);
    const html = fetchStub.ses[0].body.Content.Simple.Body.Html.Data;
    assert.match(html, /new Save the Uterus Club event/, 'an empty title falls back to the generic label');
    assert.ok(!html.includes('undefined'), 'no undefined ever reaches a member inbox');
  });

  it('does not fire the share-link notification for a non-event post gaining a slug-shaped edit', async () => {
    insertPost(db._sqlite, { id: 'p_disc', authorId: USERS.admin, content: 'discussion' });
    const waitUntil = mockWaitUntil();
    await patch(db, { who: 'admin', waitUntil, body: { postId: 'p_disc', body: 'edited' } });
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 0);
  });
});

// -------------------------------------------------------------- DELETE -----

describe('DELETE /api/community/posts -- authorization', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_mine', authorId: USERS.memberA, content: 'original A' });
    insertPost(db._sqlite, { id: 'p_arch', authorId: USERS.memberA, channel: 'members' });
  });

  it('401s with no session, and leaves the post in place', async () => {
    const { status } = await parseResponse(await remove(db, { who: null, body: { postId: 'p_mine' } }));
    assert.equal(status, 401);
    assert.ok(readPost(db, 'p_mine'));
  });

  it('403s a non-member', async () => {
    const { status } = await parseResponse(await remove(db, { who: 'nonmember', body: { postId: 'p_mine' } }));
    assert.equal(status, 403);
    assert.ok(readPost(db, 'p_mine'));
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await remove(db, { env: { DB: undefined }, body: { postId: 'p_mine' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a body that is not JSON, an array, or null', async () => {
    assert.equal((await parseResponse(await remove(db, { body: undefined }))).body.error, 'Invalid JSON');
    assert.equal((await parseResponse(await remove(db, { body: [] }))).body.error, 'Invalid payload');
    assert.equal((await parseResponse(await remove(db, { body: null }))).body.error, 'Invalid payload');
  });

  it('400s when postId is missing, non-string, or over 100 characters', async () => {
    for (const postId of [undefined, 4, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await remove(db, { body: { postId } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'postId required');
    }
  });

  it('404s for a post that does not exist', async () => {
    const { status, body } = await parseResponse(await remove(db, { body: { postId: 'p_nope' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });

  it('403s an ordinary member deleting their own post once it sits in an archive channel', async () => {
    const { status, body } = await parseResponse(await remove(db, { body: { postId: 'p_arch' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
    assert.ok(readPost(db, 'p_arch'));
  });

  it('lets an admin delete an archive-channel post', async () => {
    const { status } = await parseResponse(await remove(db, { who: 'admin', body: { postId: 'p_arch' } }));
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_arch'), null);
  });

  it('REFUSES member B deleting member A\'s post -- the IDOR case', async () => {
    const { status, body } = await parseResponse(await remove(db, { who: 'memberB', body: { postId: 'p_mine' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(readPost(db, 'p_mine').content, 'original A', 'A\'s post must survive B\'s attempt');
  });

  it('REFUSES a MOD deleting another member\'s post -- canDeletePost requires admin', async () => {
    const { status } = await parseResponse(await remove(db, { who: 'mod', body: { postId: 'p_mine' } }));
    assert.equal(status, 403);
    assert.ok(readPost(db, 'p_mine'));
  });

  it('lets the author delete their own post', async () => {
    const { status, body } = await parseResponse(await remove(db, { body: { postId: 'p_mine' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(readPost(db, 'p_mine'), null);
  });

  it('500s generically when the cleanup batch throws, and deletes nothing', async () => {
    const broken = throwingOn(db, 'DELETE FROM community_post');
    const { status, body } = await parseResponse(await remove(broken, { body: { postId: 'p_mine' } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.ok(readPost(db, 'p_mine'), 'a failed batch is a rollback, not a partial delete');
  });
});

describe('DELETE /api/community/posts -- the six-statement cleanup', () => {
  beforeEach(() => {
    insertPost(db._sqlite, { id: 'p_del', authorId: USERS.memberA });
    insertPost(db._sqlite, { id: 'p_keep', authorId: USERS.memberA });

    insertComment(db._sqlite, { id: 'c_del1', postId: 'p_del' });
    insertComment(db._sqlite, { id: 'c_del2', postId: 'p_del', parentId: 'c_del1' });
    insertComment(db._sqlite, { id: 'c_keep', postId: 'p_keep' });

    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: 'p_del', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'comment', targetId: 'c_del1', emoji: CLAP });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'comment', targetId: 'c_del2', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: 'p_keep', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'comment', targetId: 'c_keep', emoji: HEART });

    insertFlag(db._sqlite, { id: 'f_post', targetType: 'post', targetId: 'p_del' });
    insertFlag(db._sqlite, { id: 'f_comment', targetType: 'comment', targetId: 'c_del1' });
    insertFlag(db._sqlite, { id: 'f_keep_post', targetType: 'post', targetId: 'p_keep' });
    insertFlag(db._sqlite, { id: 'f_keep_comment', targetType: 'comment', targetId: 'c_keep' });
  });

  it('removes the post, its comments, and every reaction and flag hanging off both -- no orphans', async () => {
    // The ORDER MATTERS comment in the source says the comment-child flag and
    // reaction cleanups must run BEFORE the comments are deleted, because their
    // subselects read community_comment inside the same transaction. These
    // assertions are what makes that comment checkable rather than aspirational.
    const { status } = await parseResponse(await remove(db, { body: { postId: 'p_del' } }));
    assert.equal(status, 200);

    assert.equal(readPost(db, 'p_del'), null);
    assert.equal(db._sqlite.prepare("SELECT COUNT(*) AS n FROM community_comment WHERE post_id = 'p_del'").get().n, 0);
    assert.deepEqual(
      readReactions(db).map((r) => `${r.target_type}:${r.target_id}`).sort(),
      ['comment:c_keep', 'post:p_keep'],
      'the deleted post\'s comment reactions must not be orphaned',
    );
    assert.deepEqual(readFlags(db).map((f) => f.id), ['f_keep_comment', 'f_keep_post']);
    assert.ok(readPost(db, 'p_keep'), 'the unrelated post and its children survive');
  });

  it('deletes the R2 object behind a community-hosted og image', async () => {
    db._sqlite.prepare('UPDATE community_post SET og_image_url = ? WHERE id = ?').run('/api/assets/community/card.webp', 'p_del');
    const r2 = mockR2();
    const waitUntil = mockWaitUntil();
    await remove(db, { waitUntil, env: { R2_ASSETS: r2 }, body: { postId: 'p_del' } });
    await drainWaitUntil(waitUntil);
    assert.deepEqual(r2.deleted, ['community/card.webp']);
  });

  it('leaves an externally hosted og image alone -- there is no R2 key to delete', async () => {
    db._sqlite.prepare('UPDATE community_post SET og_image_url = ? WHERE id = ?').run('https://cdn.example/x.png', 'p_del');
    const r2 = mockR2();
    const waitUntil = mockWaitUntil();
    await remove(db, { waitUntil, env: { R2_ASSETS: r2 }, body: { postId: 'p_del' } });
    await drainWaitUntil(waitUntil);
    assert.deepEqual(r2.deleted, []);
  });

  it('still deletes the post when the R2 binding is absent', async () => {
    db._sqlite.prepare('UPDATE community_post SET og_image_url = ? WHERE id = ?').run('/api/assets/community/card.webp', 'p_del');
    const { status } = await parseResponse(await remove(db, { env: { R2_ASSETS: undefined }, body: { postId: 'p_del' } }));
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_del'), null);
  });

  it('still deletes the post when the R2 delete rejects', async () => {
    db._sqlite.prepare('UPDATE community_post SET og_image_url = ? WHERE id = ?').run('/api/assets/community/card.webp', 'p_del');
    const r2 = mockR2({ failWith: 'R2 unavailable' });
    const waitUntil = mockWaitUntil();
    const { status } = await parseResponse(await remove(db, { waitUntil, env: { R2_ASSETS: r2 }, body: { postId: 'p_del' } }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 200);
    assert.equal(readPost(db, 'p_del'), null);
    assert.deepEqual(r2.deleted, ['community/card.webp']);
  });
});
