/**
 * functions/api/community/comments.js -- member-authored replies.
 *
 * Untrusted input written by one member and rendered to every other member, so
 * the three things worth proving are all authorization or storage questions,
 * and every one of them is settled by the database:
 *
 *  - AUTHORSHIP (the IDOR case). PATCH is author-only; DELETE is author-OR-mod.
 *    Both compare a STORED author_id to the session user, so a test that hands
 *    back a canned comment row proves nothing about whose comment was touched.
 *    Every negative case below re-reads the row and asserts it is unchanged.
 *  - THE RECURSIVE DELETE. Deleting a comment runs a five-statement db.batch()
 *    in which statements 2 and 4 read `community_comment` through a subselect
 *    that statement 5 then deletes from. If the order were wrong, child flags
 *    and reactions would be orphaned silently. Only a real transaction on a
 *    real engine can show that, so the orphan assertions read the child tables
 *    back after the fact.
 *  - THE LOST-UPDATE GUARD. PATCH checks author_id, then runs an UPDATE that
 *    re-asserts `AND author_id = ?` and answers 403 when `meta.changes === 0`.
 *    That second check is only reachable if the row disappears between the two
 *    statements, which is scripted here through sqliteD1's `interleave` hook.
 *
 * Runs on test/_d1-sqlite.mjs (real SQLite, committed schema). The membership
 * gate is the real requireMember from _shared.js reached through a real session
 * cookie -- never stubbed, because stubbing the gate is how a suite reaches
 * 100% coverage of a broken gate.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse,
  stubExternalFetch, drainWaitUntil,
} from './_helpers.js';
import {
  communityDb, insertPost, insertComment, insertReaction, insertFlag,
  readComment, readReactions, readFlags, throwingOn, RAW, USERS,
} from './_community-fixtures.mjs';

const comments = await import('../functions/api/community/comments.js');

const URL_ = 'https://rrmacademy.org/api/community/comments';
const HEART = '❤️';
const CLAP = '\u{1F44F}';

const POST_A = 'p_com_a';          // authored by memberA, channel stuc
const POST_ARCHIVE = 'p_com_arch'; // channel members (archive)
const POST_ORPHANED = 'p_com_gone';

function ctx(db, { who = 'memberA', body, url = URL_, env: envOverrides = {}, method = 'POST', waitUntil = mockWaitUntil() } = {}) {
  const context = {
    request: mockRequest(method, {
      url,
      headers: who ? { Cookie: `session=${RAW[who]}` } : {},
      body,
    }),
    env: mockEnv({ DB: db, ...envOverrides }),
  };
  if (waitUntil !== null) context.waitUntil = waitUntil;
  return context;
}

const list = (db, opts) => comments.onRequestGet(ctx(db, { ...opts, method: 'GET' }));
const create = (db, opts) => comments.onRequestPost(ctx(db, { ...opts, method: 'POST' }));
const edit = (db, opts) => comments.onRequestPatch(ctx(db, { ...opts, method: 'PATCH' }));
const remove = (db, opts) => comments.onRequestDelete(ctx(db, { ...opts, method: 'DELETE' }));

let db;
let fetchStub;

beforeEach(async () => {
  fetchStub = stubExternalFetch();
  db = await communityDb((sqlite) => {
    insertPost(sqlite, { id: POST_A, authorId: USERS.memberA });
    insertPost(sqlite, { id: POST_ARCHIVE, authorId: USERS.admin, channel: 'members' });
  });
});
afterEach(() => { fetchStub.restore(); db.close(); });

describe('OPTIONS /api/community/comments', () => {
  it('answers the CORS preflight with 204 and the locked-down origin', async () => {
    const res = await comments.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /PATCH/);
  });
});

// ---------------------------------------------------------------- GET ------

describe('GET /api/community/comments -- the membership gate', () => {
  it('401s with no session cookie', async () => {
    const { status, body } = await parseResponse(await list(db, { who: null, url: `${URL_}?postId=${POST_A}` }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('403s a signed-in user with no membership', async () => {
    const { status, body } = await parseResponse(await list(db, { who: 'nonmember', url: `${URL_}?postId=${POST_A}` }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await list(db, { env: { DB: undefined }, url: `${URL_}?postId=${POST_A}` }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });
});

describe('GET /api/community/comments -- input and existence', () => {
  it('400s when postId is missing', async () => {
    const { status, body } = await parseResponse(await list(db, { url: URL_ }));
    assert.equal(status, 400);
    assert.equal(body.error, 'postId required');
  });

  it('400s when postId is longer than 100 characters', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?postId=${'x'.repeat(101)}` }));
    assert.equal(status, 400);
    assert.equal(body.error, 'postId required');
  });

  it('404s for a post that does not exist', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?postId=p_nope` }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });

  it('returns an empty thread, and count 0, for a post with no comments', async () => {
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, comments: [], count: 0 });
  });

  it('500s generically when the comment query throws', async () => {
    const broken = throwingOn(db, 'FROM community_comment c');
    const { status, body } = await parseResponse(await list(broken, { url: `${URL_}?postId=${POST_A}` }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
  });

  it('does NOT gate reads by channel -- an ordinary member can read an archive-channel thread', async () => {
    // Documented divergence, not an oversight to paper over: POST, PATCH and
    // DELETE all refuse a non-admin on an archive channel, and GET does not.
    // Archive channels are READ-ONLY for members, which is a different rule
    // from hidden. Asserting it here means a future change that silently adds
    // or removes the read gate fails by name.
    insertComment(db._sqlite, { id: 'c_arch', postId: POST_ARCHIVE, authorId: USERS.admin });
    const { status, body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_ARCHIVE}` }));
    assert.equal(status, 200);
    assert.equal(body.count, 1);
  });
});

describe('GET /api/community/comments -- the threaded projection', () => {
  beforeEach(() => {
    insertComment(db._sqlite, { id: 'c1', postId: POST_A, authorId: USERS.memberA, content: 'top one', createdAt: '2026-02-01 10:00:00' });
    insertComment(db._sqlite, { id: 'c2', postId: POST_A, authorId: USERS.memberB, content: 'top two', createdAt: '2026-02-01 11:00:00' });
    insertComment(db._sqlite, { id: 'r1', postId: POST_A, authorId: USERS.memberB, parentId: 'c1', content: 'reply one', createdAt: '2026-02-01 12:00:00', updatedAt: '2026-02-02 09:00:00' });
    insertComment(db._sqlite, { id: 'r2', postId: POST_A, authorId: USERS.memberA, parentId: 'c1', content: 'reply two', createdAt: '2026-02-01 13:00:00' });
  });

  it('nests replies under their parent and keeps top-level order by created_at ASC', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    assert.deepEqual(body.comments.map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(body.comments[0].replies.map((c) => c.id), ['r1', 'r2']);
    assert.deepEqual(body.comments[1].replies, [], 'a parent with no replies gets an empty array, not undefined');
    assert.equal(body.count, 4, 'count is every row, replies included');
  });

  it('marks isOwn per viewer, from the stored author_id', async () => {
    const asA = await parseResponse(await list(db, { who: 'memberA', url: `${URL_}?postId=${POST_A}` }));
    assert.deepEqual(asA.body.comments.map((c) => c.isOwn), [true, false]);
    const asB = await parseResponse(await list(db, { who: 'memberB', url: `${URL_}?postId=${POST_A}` }));
    assert.deepEqual(asB.body.comments.map((c) => c.isOwn), [false, true]);
  });

  it('surfaces updated_at as null when a comment has never been edited', async () => {
    const { body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    assert.equal(body.comments[0].updatedAt, null);
    assert.equal(body.comments[0].replies[0].updatedAt, '2026-02-02 09:00:00');
  });

  it('drops a reply whose parent belongs to a different post -- it is never silently promoted to top level', async () => {
    insertPost(db._sqlite, { id: 'p_other' });
    insertComment(db._sqlite, { id: 'c_other', postId: 'p_other' });
    insertComment(db._sqlite, { id: 'r_orphan', postId: POST_A, parentId: 'c_other', content: 'orphan', createdAt: '2026-02-01 14:00:00' });
    const { body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    assert.deepEqual(body.comments.map((c) => c.id), ['c1', 'c2']);
    const everyReply = body.comments.flatMap((c) => c.replies.map((r) => r.id));
    assert.ok(!everyReply.includes('r_orphan'), 'the orphan is not attached anywhere');
    assert.equal(body.count, 5, 'but it is still counted, because count is the raw row count');
  });

  it('falls back to displayName() when user.name is null', async () => {
    db._sqlite.prepare('UPDATE user SET name = NULL, first_name = ?, last_name = ? WHERE id = ?')
      .run('Alice', 'Anderson', USERS.memberA);
    const { body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    assert.equal(body.comments[0].authorName, 'Alice A.');
  });

  it('reports the author tier from the user_label join, and null for an unlabelled author', async () => {
    db._sqlite.prepare('INSERT INTO user_label (user_id, label) VALUES (?, ?)').run(USERS.memberA, 'Uterus Hero 💖');
    const { body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    assert.equal(body.comments[0].authorTier, 'hero');
    assert.equal(body.comments[1].authorTier, null);
  });

  it('aggregates reaction counts per comment and reports only the caller\'s own reactions', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'comment', targetId: 'c1', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'comment', targetId: 'c1', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'comment', targetId: 'r1', emoji: CLAP });
    const { body } = await parseResponse(await list(db, { who: 'memberA', url: `${URL_}?postId=${POST_A}` }));
    assert.deepEqual(body.comments[0].reactions, { [HEART]: 2 });
    assert.deepEqual(body.comments[0].myReactions, [HEART]);
    assert.deepEqual(body.comments[0].replies[0].reactions, { [CLAP]: 1 });
    assert.deepEqual(body.comments[0].replies[0].myReactions, [], 'B\'s clap is not reported as A\'s');
    assert.deepEqual(body.comments[1].reactions, {});
  });

  it('does not leak reactions from another post\'s comments (the join is scoped by post_id)', async () => {
    insertPost(db._sqlite, { id: 'p_other2' });
    insertComment(db._sqlite, { id: 'c_other2', postId: 'p_other2' });
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'comment', targetId: 'c_other2', emoji: HEART });
    const { body } = await parseResponse(await list(db, { url: `${URL_}?postId=${POST_A}` }));
    for (const c of body.comments) assert.deepEqual(c.reactions, {});
  });
});

// --------------------------------------------------------------- POST ------

describe('POST /api/community/comments -- gate, rate limit and validation', () => {
  const good = () => ({ postId: POST_A, content: 'hello there' });

  it('401s with no session and stores nothing', async () => {
    const { status } = await parseResponse(await create(db, { who: null, body: good() }));
    assert.equal(status, 401);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_comment').get().n, 0);
  });

  it('403s a non-member and stores nothing', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'nonmember', body: good() }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_comment').get().n, 0);
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await create(db, { env: { DB: undefined }, body: good() }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('429s when the 30-per-hour bucket is already full, before touching the database', async () => {
    const kv = mockKV();
    await kv.put(`rl:comments:${USERS.memberA}`, JSON.stringify({ count: 30, start: Math.floor(Date.now() / 1000) }));
    const { status, body } = await parseResponse(await create(db, { env: { COMMUNITY_KV: kv }, body: good() }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_comment').get().n, 0);
  });

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await create(db, { body: undefined }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s on an array payload', async () => {
    const { status, body } = await parseResponse(await create(db, { body: [good()] }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400s on a null payload', async () => {
    const { status, body } = await parseResponse(await create(db, { body: null }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400s when postId is missing, non-string, or over 100 characters', async () => {
    for (const postId of [undefined, 42, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await create(db, { body: { postId, content: 'hi' } }));
      assert.equal(status, 400, `postId=${String(postId).slice(0, 12)}`);
      assert.equal(body.error, 'postId required');
    }
  });

  it('400s when content is missing, non-string, or whitespace only', async () => {
    for (const content of [undefined, 7, '   \n\t  ']) {
      const { status, body } = await parseResponse(await create(db, { body: { postId: POST_A, content } }));
      assert.equal(status, 400, `content=${JSON.stringify(content)}`);
      assert.equal(body.error, 'Content required');
    }
  });

  it('400s when content exceeds 2000 characters, and accepts exactly 2000', async () => {
    const over = await parseResponse(await create(db, { body: { postId: POST_A, content: 'z'.repeat(2001) } }));
    assert.equal(over.status, 400);
    assert.equal(over.body.error, 'Comment too long (max 2000 chars)');

    const at = await parseResponse(await create(db, { body: { postId: POST_A, content: 'z'.repeat(2000) } }));
    assert.equal(at.status, 201);
    assert.equal(readComment(db, at.body.comment.id).content.length, 2000);
  });

  it('404s when the post does not exist', async () => {
    const { status, body } = await parseResponse(await create(db, { body: { postId: 'p_nope', content: 'hi' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });

  it('403s an ordinary member commenting on a non-stuc (archive) channel', async () => {
    const { status, body } = await parseResponse(await create(db, { body: { postId: POST_ARCHIVE, content: 'hi' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_comment').get().n, 0);
  });

  it('403s a MOD on an archive channel -- the bar here is admin, not mod', async () => {
    const { status } = await parseResponse(await create(db, { who: 'mod', body: { postId: POST_ARCHIVE, content: 'hi' } }));
    assert.equal(status, 403);
  });

  it('lets an admin comment on an archive channel, and stores the row', async () => {
    const { status, body } = await parseResponse(await create(db, { who: 'admin', body: { postId: POST_ARCHIVE, content: 'staff note' } }));
    assert.equal(status, 201);
    const stored = readComment(db, body.comment.id);
    assert.equal(stored.post_id, POST_ARCHIVE);
    assert.equal(stored.author_id, USERS.admin);
  });

  it('400s when parentId is a non-string or over 100 characters', async () => {
    for (const parentId of [99, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await create(db, { body: { postId: POST_A, content: 'hi', parentId } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid parentId');
    }
  });

  it('400s when the parent comment does not exist', async () => {
    const { status, body } = await parseResponse(await create(db, { body: { postId: POST_A, content: 'hi', parentId: 'c_nope' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Parent comment not found');
  });

  it('400s when the parent comment belongs to a different post', async () => {
    insertPost(db._sqlite, { id: 'p_elsewhere' });
    insertComment(db._sqlite, { id: 'c_elsewhere', postId: 'p_elsewhere' });
    const { status, body } = await parseResponse(await create(db, { body: { postId: POST_A, content: 'hi', parentId: 'c_elsewhere' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Parent comment not found');
  });

  it('400s when the parent is itself a reply -- the thread is capped at one level', async () => {
    insertComment(db._sqlite, { id: 'c_top', postId: POST_A });
    insertComment(db._sqlite, { id: 'c_reply', postId: POST_A, parentId: 'c_top' });
    const { status, body } = await parseResponse(await create(db, { body: { postId: POST_A, content: 'hi', parentId: 'c_reply' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Parent comment not found');
    assert.equal(db._sqlite.prepare("SELECT COUNT(*) AS n FROM community_comment WHERE parent_id = 'c_reply'").get().n, 0);
  });

  it('500s generically when the INSERT throws', async () => {
    const broken = throwingOn(db, 'INSERT INTO community_comment');
    const { status, body } = await parseResponse(await create(broken, { body: good() }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
  });
});

describe('POST /api/community/comments -- the write, verified by reading the row back', () => {
  it('stores a top-level comment with the session user as author, trimmed', async () => {
    const waitUntil = mockWaitUntil();
    const { status, body } = await parseResponse(await create(db, { who: 'memberB', waitUntil, body: { postId: POST_A, content: '  spaced out  ' } }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 201);

    const stored = readComment(db, body.comment.id);
    assert.equal(stored.post_id, POST_A);
    assert.equal(stored.author_id, USERS.memberB, 'the author is the session user, never the request body');
    assert.equal(stored.parent_id, null);
    assert.equal(stored.content, 'spaced out');
    assert.equal(stored.updated_at, null, 'a fresh comment has no updated_at');
    assert.equal(body.comment.isOwn, true);
    assert.deepEqual(body.comment.replies, []);
  });

  it('stores a reply against its parent', async () => {
    insertComment(db._sqlite, { id: 'c_parent', postId: POST_A, authorId: USERS.memberA });
    const waitUntil = mockWaitUntil();
    const { status, body } = await parseResponse(await create(db, { who: 'memberB', waitUntil, body: { postId: POST_A, content: 'a reply', parentId: 'c_parent' } }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 201);
    assert.equal(readComment(db, body.comment.id).parent_id, 'c_parent');
    assert.equal(body.comment.parentId, 'c_parent');
  });

  it('emails the POST author when someone else comments, via waitUntil', async () => {
    const waitUntil = mockWaitUntil();
    await create(db, { who: 'memberB', waitUntil, body: { postId: POST_A, content: 'nice post' } });
    assert.equal(waitUntil.promises.length, 1, 'the notification is deferred, not awaited inline');
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 1);
    assert.equal(fetchStub.ses[0].body.Destination.ToAddresses[0], 'a@example.com');
  });

  it('does not email you when you comment on your own post', async () => {
    const waitUntil = mockWaitUntil();
    await create(db, { who: 'memberA', waitUntil, body: { postId: POST_A, content: 'replying to myself' } });
    await drainWaitUntil(waitUntil);
    assert.equal(fetchStub.ses.length, 0);
  });

  it('swallows a notification failure -- the comment is still created and the response is still 201', async () => {
    // The notification is fire-and-forget with its own .catch. A member's
    // comment must not be lost because an email lookup failed.
    const broken = throwingOn(db, 'SELECT author_id FROM community_post');
    const waitUntil = mockWaitUntil();
    const { status, body } = await parseResponse(await create(broken, { who: 'memberB', waitUntil, body: { postId: POST_A, content: 'still stored' } }));
    await drainWaitUntil(waitUntil);
    assert.equal(status, 201);
    assert.equal(readComment(db, body.comment.id).content, 'still stored');
    assert.equal(fetchStub.ses.length, 0);
  });

  it('falls back to awaiting the notification inline when the runtime supplies no waitUntil', async () => {
    // Pages Functions always pass waitUntil; a direct invocation (and some
    // test harnesses) do not. The handler explicitly branches on that, and the
    // fallback must still both store the comment and send the email.
    const { status, body } = await parseResponse(await create(db, { who: 'memberB', waitUntil: null, body: { postId: POST_A, content: 'inline path' } }));
    assert.equal(status, 201);
    assert.equal(readComment(db, body.comment.id).content, 'inline path');
    assert.equal(fetchStub.ses.length, 1, 'the email was sent inline, not dropped');
  });

  it('swallows an inline notification failure on the no-waitUntil path too', async () => {
    const broken = throwingOn(db, 'SELECT author_id FROM community_post');
    const { status, body } = await parseResponse(await create(broken, { who: 'memberB', waitUntil: null, body: { postId: POST_A, content: 'inline but broken' } }));
    assert.equal(status, 201);
    assert.equal(readComment(db, body.comment.id).content, 'inline but broken');
  });
});

// -------------------------------------------------------------- PATCH ------

describe('PATCH /api/community/comments -- editing, and who may do it', () => {
  beforeEach(() => {
    insertComment(db._sqlite, { id: 'c_mine', postId: POST_A, authorId: USERS.memberA, content: 'original A' });
    insertComment(db._sqlite, { id: 'c_theirs', postId: POST_A, authorId: USERS.memberB, content: 'original B' });
    insertComment(db._sqlite, { id: 'c_arch', postId: POST_ARCHIVE, authorId: USERS.memberA, content: 'archived' });
  });

  it('401s with no session', async () => {
    const { status } = await parseResponse(await edit(db, { who: null, body: { commentId: 'c_mine', content: 'x' } }));
    assert.equal(status, 401);
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });

  it('403s a non-member', async () => {
    const { status } = await parseResponse(await edit(db, { who: 'nonmember', body: { commentId: 'c_mine', content: 'x' } }));
    assert.equal(status, 403);
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await edit(db, { env: { DB: undefined }, body: { commentId: 'c_mine', content: 'x' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a body that is not JSON, an array, or null', async () => {
    assert.equal((await parseResponse(await edit(db, { body: undefined }))).body.error, 'Invalid JSON');
    assert.equal((await parseResponse(await edit(db, { body: [] }))).body.error, 'Invalid payload');
    assert.equal((await parseResponse(await edit(db, { body: null }))).body.error, 'Invalid payload');
  });

  it('400s when commentId is missing, non-string, or over 100 characters', async () => {
    for (const commentId of [undefined, 5, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await edit(db, { body: { commentId, content: 'x' } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'commentId required');
    }
  });

  it('400s when content is missing, non-string, or whitespace only', async () => {
    for (const content of [undefined, 5, '  ']) {
      const { status, body } = await parseResponse(await edit(db, { body: { commentId: 'c_mine', content } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'Content required');
    }
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });

  it('400s when content exceeds 2000 characters', async () => {
    const { status, body } = await parseResponse(await edit(db, { body: { commentId: 'c_mine', content: 'z'.repeat(2001) } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Comment too long (max 2000 chars)');
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });

  it('404s for a comment that does not exist', async () => {
    const { status, body } = await parseResponse(await edit(db, { body: { commentId: 'c_nope', content: 'x' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Comment not found');
  });

  it('403s an ordinary member editing their own comment on an archive channel', async () => {
    const { status, body } = await parseResponse(await edit(db, { body: { commentId: 'c_arch', content: 'edited' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
    assert.equal(readComment(db, 'c_arch').content, 'archived');
  });

  it('REFUSES member B editing member A\'s comment -- the IDOR case', async () => {
    const { status, body } = await parseResponse(await edit(db, { who: 'memberB', body: { commentId: 'c_mine', content: 'hijacked' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(readComment(db, 'c_mine').content, 'original A', 'A\'s comment must be byte-identical after B\'s attempt');
    assert.equal(readComment(db, 'c_mine').updated_at, null, 'and must not even be stamped as edited');
  });

  it('REFUSES a mod editing another member\'s comment -- edit is author-only, unlike delete', async () => {
    const { status, body } = await parseResponse(await edit(db, { who: 'mod', body: { commentId: 'c_mine', content: 'modded' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });

  it('REFUSES a superadmin editing another member\'s comment', async () => {
    const { status } = await parseResponse(await edit(db, { who: 'admin', body: { commentId: 'c_mine', content: 'admined' } }));
    assert.equal(status, 403);
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });

  it('lets the author edit, trims the content, and stamps updated_at', async () => {
    const { status, body } = await parseResponse(await edit(db, { body: { commentId: 'c_mine', content: '  revised text  ' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    const stored = readComment(db, 'c_mine');
    assert.equal(stored.content, 'revised text');
    assert.match(stored.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(readComment(db, 'c_theirs').content, 'original B', 'no other row is touched');
  });

  it('403s when the row disappears between the ownership read and the UPDATE (lost-update guard)', async () => {
    // The UPDATE re-asserts `AND author_id = ?` and the handler answers 403 on
    // zero changes. That arm is only reachable through a concurrent writer, so
    // it is scripted with the harness interleave hook -- a stand-in for another
    // isolate, not proof of the real race window. Without it the branch is
    // dead code that no test could distinguish from a working guard.
    let deleted = false;
    const racy = await communityDb(
      (sqlite) => {
        insertPost(sqlite, { id: POST_A, authorId: USERS.memberA });
        insertComment(sqlite, { id: 'c_racy', postId: POST_A, authorId: USERS.memberA, content: 'original' });
      },
      {
        interleave({ sql, db: sqlite }) {
          if (deleted || !sql.includes('UPDATE community_comment SET content')) return;
          deleted = true;
          sqlite.prepare('DELETE FROM community_comment WHERE id = ?').run('c_racy');
        },
      },
    );
    try {
      const { status, body } = await parseResponse(await edit(racy, { body: { commentId: 'c_racy', content: 'too late' } }));
      assert.equal(status, 403);
      assert.equal(body.error, 'Not authorized');
      assert.ok(deleted, 'the interleave hook must actually have fired');
      assert.equal(readComment(racy, 'c_racy'), null);
    } finally {
      racy.close();
    }
  });

  it('500s generically when the UPDATE throws', async () => {
    const broken = throwingOn(db, 'UPDATE community_comment SET content');
    const { status, body } = await parseResponse(await edit(broken, { body: { commentId: 'c_mine', content: 'x' } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.equal(readComment(db, 'c_mine').content, 'original A');
  });
});

// ------------------------------------------------------------- DELETE ------

describe('DELETE /api/community/comments -- authorization', () => {
  beforeEach(() => {
    insertComment(db._sqlite, { id: 'c_mine', postId: POST_A, authorId: USERS.memberA, content: 'original A' });
    insertComment(db._sqlite, { id: 'c_arch', postId: POST_ARCHIVE, authorId: USERS.memberA });
  });

  it('401s with no session, and leaves the comment in place', async () => {
    const { status } = await parseResponse(await remove(db, { who: null, body: { commentId: 'c_mine' } }));
    assert.equal(status, 401);
    assert.ok(readComment(db, 'c_mine'));
  });

  it('403s a non-member', async () => {
    const { status } = await parseResponse(await remove(db, { who: 'nonmember', body: { commentId: 'c_mine' } }));
    assert.equal(status, 403);
    assert.ok(readComment(db, 'c_mine'));
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await remove(db, { env: { DB: undefined }, body: { commentId: 'c_mine' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a body that is not JSON, an array, or null', async () => {
    assert.equal((await parseResponse(await remove(db, { body: undefined }))).body.error, 'Invalid JSON');
    assert.equal((await parseResponse(await remove(db, { body: [] }))).body.error, 'Invalid payload');
    assert.equal((await parseResponse(await remove(db, { body: null }))).body.error, 'Invalid payload');
  });

  it('400s when commentId is missing, non-string, or over 100 characters', async () => {
    for (const commentId of [undefined, 5, 'x'.repeat(101)]) {
      const { status, body } = await parseResponse(await remove(db, { body: { commentId } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'commentId required');
    }
  });

  it('404s for a comment that does not exist', async () => {
    const { status, body } = await parseResponse(await remove(db, { body: { commentId: 'c_nope' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Comment not found');
  });

  it('403s an ordinary member deleting on an archive channel', async () => {
    const { status, body } = await parseResponse(await remove(db, { body: { commentId: 'c_arch' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized for this channel');
    assert.ok(readComment(db, 'c_arch'));
  });

  it('lets an admin delete on an archive channel', async () => {
    const { status } = await parseResponse(await remove(db, { who: 'admin', body: { commentId: 'c_arch' } }));
    assert.equal(status, 200);
    assert.equal(readComment(db, 'c_arch'), null);
  });

  it('REFUSES member B deleting member A\'s comment -- the IDOR case', async () => {
    const { status, body } = await parseResponse(await remove(db, { who: 'memberB', body: { commentId: 'c_mine' } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Not authorized');
    assert.equal(readComment(db, 'c_mine').content, 'original A', 'A\'s comment must survive B\'s attempt');
  });

  it('lets a MOD delete another member\'s comment -- moderation is the documented exception', async () => {
    const { status } = await parseResponse(await remove(db, { who: 'mod', body: { commentId: 'c_mine' } }));
    assert.equal(status, 200);
    assert.equal(readComment(db, 'c_mine'), null);
  });

  it('handles an orphan comment whose post row is already gone, without a channel check', async () => {
    insertComment(db._sqlite, { id: 'c_orphan', postId: 'p_vanished', authorId: USERS.memberA });
    const { status } = await parseResponse(await remove(db, { body: { commentId: 'c_orphan' } }));
    assert.equal(status, 200);
    assert.equal(readComment(db, 'c_orphan'), null);
  });

  it('500s generically when the cleanup batch throws, and nothing is deleted', async () => {
    const broken = throwingOn(db, 'WITH RECURSIVE descendants');
    const { status, body } = await parseResponse(await remove(broken, { body: { commentId: 'c_mine' } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.ok(readComment(db, 'c_mine'), 'a failed batch is a rollback, not a partial delete');
  });
});

describe('DELETE /api/community/comments -- the recursive cleanup', () => {
  beforeEach(() => {
    insertComment(db._sqlite, { id: 'c_top', postId: POST_A, authorId: USERS.memberA });
    insertComment(db._sqlite, { id: 'c_reply1', postId: POST_A, authorId: USERS.memberB, parentId: 'c_top' });
    insertComment(db._sqlite, { id: 'c_reply2', postId: POST_A, authorId: USERS.memberB, parentId: 'c_top' });
    insertComment(db._sqlite, { id: 'c_sibling', postId: POST_A, authorId: USERS.memberA });

    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'comment', targetId: 'c_top', emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'comment', targetId: 'c_reply1', emoji: CLAP });
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'comment', targetId: 'c_sibling', emoji: HEART });

    insertFlag(db._sqlite, { id: 'f_top', targetType: 'comment', targetId: 'c_top' });
    insertFlag(db._sqlite, { id: 'f_reply', targetType: 'comment', targetId: 'c_reply1' });
    insertFlag(db._sqlite, { id: 'f_sibling', targetType: 'comment', targetId: 'c_sibling' });
  });

  it('deletes the comment and every descendant, leaving siblings alone', async () => {
    const { status } = await parseResponse(await remove(db, { body: { commentId: 'c_top' } }));
    assert.equal(status, 200);
    assert.equal(readComment(db, 'c_top'), null);
    assert.equal(readComment(db, 'c_reply1'), null);
    assert.equal(readComment(db, 'c_reply2'), null);
    assert.ok(readComment(db, 'c_sibling'), 'an unrelated sibling thread survives');
  });

  it('removes reactions on the comment AND on its children -- no orphan rows', async () => {
    // The batch deletes child reactions (statement 4) BEFORE deleting the
    // comment rows (statement 5), because the child subselect reads
    // community_comment. Order-dependent, and only a real transaction shows it.
    await remove(db, { body: { commentId: 'c_top' } });
    const remaining = readReactions(db);
    assert.deepEqual(remaining.map((r) => r.target_id), ['c_sibling'],
      'the child comment\'s reaction must not be orphaned');
  });

  it('removes flags on the comment AND on its children -- no orphan rows', async () => {
    await remove(db, { body: { commentId: 'c_top' } });
    assert.deepEqual(readFlags(db).map((f) => f.id), ['f_sibling']);
  });

  it('deletes a grandchild too -- the recursive CTE is not one level deep', async () => {
    insertComment(db._sqlite, { id: 'c_grandchild', postId: POST_A, authorId: USERS.memberB, parentId: 'c_reply1' });
    await remove(db, { body: { commentId: 'c_top' } });
    assert.equal(readComment(db, 'c_grandchild'), null);
  });
});
