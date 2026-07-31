/**
 * functions/api/community/reactions.js -- the emoji reaction toggle.
 *
 * Small file, two sharp edges, and both of them are decided by the database
 * rather than by JavaScript:
 *
 *  1. IDEMPOTENCY. POST is a toggle implemented as "DELETE the row; if the
 *     engine reports zero changes, INSERT ... ON CONFLICT DO NOTHING". Whether
 *     a second reaction creates a second row is therefore a question about
 *     `meta.changes` and about the composite PRIMARY KEY
 *     (user_id, target_type, target_id, emoji). A canned mock answers both of
 *     those with whatever the test declared, which makes "reacting twice does
 *     not duplicate" a restatement of the fixture. Every assertion below reads
 *     the STORED ROWS back, never the response body alone.
 *
 *  2. The DELETE endpoint does NOT re-validate targetType or emoji against the
 *     allowlists POST enforces. That asymmetry is asserted rather than assumed,
 *     because it is the difference between "un-react is a no-op on junk input"
 *     and "un-react deletes something it should not".
 *
 * Runs on test/_d1-sqlite.mjs (real SQLite, committed schema). The membership
 * gate is the real requireMember from _shared.js, reached through a real
 * session cookie -- never stubbed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse } from './_helpers.js';
import {
  communityDb, insertPost, insertComment, insertReaction,
  readReactions, throwingOn, RAW, USERS,
} from './_community-fixtures.mjs';

const reactions = await import('../functions/api/community/reactions.js');

const URL_ = 'https://rrmacademy.org/api/community/reactions';
const HEART = '❤️';
const CLAP = '\u{1F44F}';
const CRY = '\u{1F622}';

const POST_A = 'p_react_a';
const COMMENT_A = 'c_react_a';

function ctx(db, { who = 'memberA', body, env: envOverrides = {}, method = 'POST' } = {}) {
  return {
    request: mockRequest(method, {
      url: URL_,
      headers: who ? { Cookie: `session=${RAW[who]}` } : {},
      body,
    }),
    env: mockEnv({ DB: db, ...envOverrides }),
    waitUntil: mockWaitUntil(),
  };
}

const react = (db, opts) => reactions.onRequestPost(ctx(db, { ...opts, method: 'POST' }));
const unreact = (db, opts) => reactions.onRequestDelete(ctx(db, { ...opts, method: 'DELETE' }));

let db;
beforeEach(async () => {
  db = await communityDb((sqlite) => {
    insertPost(sqlite, { id: POST_A });
    insertComment(sqlite, { id: COMMENT_A, postId: POST_A });
  });
});
afterEach(() => { db.close(); });

describe('OPTIONS /api/community/reactions', () => {
  it('answers the CORS preflight with 204 and the locked-down origin', async () => {
    const res = await reactions.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('POST /api/community/reactions -- the membership gate', () => {
  it('401s with no session cookie at all', async () => {
    const { status, body } = await parseResponse(await react(db, { who: null, body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.deepEqual(readReactions(db), [], 'an anonymous request must not write a reaction');
  });

  it('403s a signed-in user with no membership of any kind', async () => {
    const { status, body } = await parseResponse(await react(db, { who: 'nonmember', body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 403);
    assert.equal(body.error, 'Membership required');
    assert.deepEqual(readReactions(db), []);
  });

  it('403s a member whose email is not verified, before any write', async () => {
    const { status, body } = await parseResponse(await react(db, { who: 'unverified', body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 403);
    assert.match(body.error, /verify your email/i);
    assert.deepEqual(readReactions(db), []);
  });

  it('rejects a blocked member -- as 401, because validateSession drops blocked users before requireMember sees them', async () => {
    // Documented on purpose. requireMember has an explicit
    // `if (user.blocked) return 403 Account suspended` branch, but
    // validateSession() already returns null for a blocked user, so through a
    // session cookie the observable answer is 401 and that 403 arm is
    // unreachable. Asserting 403 here would assert a response this endpoint
    // cannot produce.
    const { status, body } = await parseResponse(await react(db, { who: 'blocked', body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('500s when the DB binding is absent, without touching the request body', async () => {
    const { status, body } = await parseResponse(await react(db, { env: { DB: undefined }, body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('lets staff through the gate with no subscription at all', async () => {
    const { status, body } = await parseResponse(await react(db, { who: 'mod', body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 201);
    assert.equal(body.action, 'added');
    assert.equal(readReactions(db).length, 1);
  });
});

describe('POST /api/community/reactions -- rate limiting', () => {
  it('429s once the per-user hourly bucket is already full', async () => {
    const kv = mockKV();
    await kv.put(`rl:reactions:${USERS.memberA}`, JSON.stringify({ count: 60, start: Math.floor(Date.now() / 1000) }));
    const { status, body } = await parseResponse(await react(db, {
      env: { COMMUNITY_KV: kv },
      body: { targetType: 'post', targetId: POST_A, emoji: HEART },
    }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.deepEqual(readReactions(db), [], 'a rate-limited request must not write');
  });

  it('429s fail-CLOSED when the KV binding is missing entirely', async () => {
    const { status, body } = await parseResponse(await react(db, {
      env: { COMMUNITY_KV: undefined },
      body: { targetType: 'post', targetId: POST_A, emoji: HEART },
    }));
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
  });
});

describe('POST /api/community/reactions -- input validation', () => {
  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await react(db, { body: undefined }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s on a JSON array payload', async () => {
    const { status, body } = await parseResponse(await react(db, { body: [{ targetType: 'post' }] }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400s on a null payload', async () => {
    const { status, body } = await parseResponse(await react(db, { body: null }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  for (const missing of ['targetType', 'targetId', 'emoji']) {
    it(`400s when ${missing} is absent`, async () => {
      const payload = { targetType: 'post', targetId: POST_A, emoji: HEART };
      delete payload[missing];
      const { status, body } = await parseResponse(await react(db, { body: payload }));
      assert.equal(status, 400);
      assert.equal(body.error, 'targetType, targetId, and emoji required');
    });
  }

  it('400s when targetId is not a string', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: 12345, emoji: HEART } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid targetId');
  });

  it('400s when targetId is longer than 100 characters', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: 'x'.repeat(101), emoji: HEART } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid targetId');
  });

  it('accepts a targetId of exactly 100 characters (the boundary is inclusive)', async () => {
    const id = 'x'.repeat(100);
    db._sqlite.prepare("INSERT INTO community_post (id, author_id, type, title) VALUES (?, ?, 'discussion', 't')").run(id, USERS.memberA);
    const { status } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: id, emoji: HEART } }));
    assert.equal(status, 201);
  });

  it('400s on a target type outside the post/comment allowlist', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'user', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid target type');
  });

  it('400s on an emoji outside the three-emoji allowlist', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: '\u{1F4A9}' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid emoji');
    assert.deepEqual(readReactions(db), []);
  });

  it('accepts each of the three allowed emoji and stores them as distinct rows', async () => {
    for (const emoji of [HEART, CLAP, CRY]) {
      const { status } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: POST_A, emoji } }));
      assert.equal(status, 201);
    }
    assert.deepEqual(
      readReactions(db, { targetType: 'post', targetId: POST_A }).map((r) => r.emoji).sort(),
      [HEART, CLAP, CRY].sort(),
    );
  });

  it('404s when the post does not exist, and writes nothing', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: 'p_missing', emoji: HEART } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
    assert.deepEqual(readReactions(db), []);
  });

  it('404s when the comment does not exist, and writes nothing', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'comment', targetId: 'c_missing', emoji: HEART } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Comment not found');
    assert.deepEqual(readReactions(db), []);
  });

  it('does not accept a comment id as a post target (existence is checked against the right table)', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: COMMENT_A, emoji: HEART } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'Post not found');
  });
});

describe('POST /api/community/reactions -- the toggle, asserted on stored rows', () => {
  it('adds a row on the first reaction and returns 201 added', async () => {
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 201);
    assert.deepEqual(body, { ok: true, action: 'added' });
    const rows = readReactions(db, { targetType: 'post', targetId: POST_A });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, USERS.memberA);
    assert.equal(rows[0].emoji, HEART);
  });

  it('reacting twice REMOVES rather than duplicating -- zero rows remain', async () => {
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    const { status, body } = await parseResponse(await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, action: 'removed' });
    assert.deepEqual(readReactions(db, { targetType: 'post', targetId: POST_A }), [],
      'the second reaction must remove the row, not add a second one');
  });

  it('a third reaction adds it back -- the toggle is stable across cycles', async () => {
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    assert.equal(readReactions(db, { targetType: 'post', targetId: POST_A }).length, 1);
  });

  it('one user removing does not remove another user\'s identical reaction', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: POST_A, emoji: HEART });
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });   // A adds
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });   // A removes
    const rows = readReactions(db, { targetType: 'post', targetId: POST_A });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, USERS.memberB, 'B\'s reaction must survive A\'s toggle');
  });

  it('reactions on a post and on a comment with the same emoji are independent rows', async () => {
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    await react(db, { body: { targetType: 'comment', targetId: COMMENT_A, emoji: HEART } });
    assert.equal(readReactions(db).length, 2);
    await react(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    const rows = readReactions(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target_type, 'comment');
  });

  it('ON CONFLICT DO NOTHING absorbs a concurrent insert landing between the DELETE and the INSERT', async () => {
    // The only way the INSERT can hit its own conflict clause: the DELETE
    // reports zero changes (no row), and another writer inserts the identical
    // primary key before this request's INSERT runs. Scripted through the
    // harness `interleave` hook, which is a stand-in for a concurrent isolate,
    // not proof of the real race window. What it does prove is the outcome:
    // exactly one row, and a 201, rather than a thrown UNIQUE constraint.
    let raced = false;
    const racy = await communityDb(
      (sqlite) => { insertPost(sqlite, { id: POST_A }); },
      {
        interleave({ sql, db: sqlite }) {
          if (raced || !sql.includes('INSERT INTO community_reaction')) return;
          raced = true;
          sqlite.prepare(
            'INSERT INTO community_reaction (user_id, target_type, target_id, emoji) VALUES (?, ?, ?, ?)'
          ).run(USERS.memberA, 'post', POST_A, HEART);
        },
      },
    );
    try {
      const { status, body } = await parseResponse(await react(racy, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
      assert.equal(status, 201);
      assert.equal(body.action, 'added');
      assert.equal(readReactions(racy, { targetType: 'post', targetId: POST_A }).length, 1,
        'the conflicting concurrent insert must not produce a duplicate row');
      assert.ok(raced, 'the interleave hook must actually have fired');
    } finally {
      racy.close();
    }
  });

  it('500s generically when D1 throws mid-write, leaking nothing', async () => {
    const broken = throwingOn(db, 'INSERT INTO community_reaction');
    const { status, body } = await parseResponse(await react(broken, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
    assert.ok(!JSON.stringify(body).includes('D1_DOWN'), 'the driver message must not reach the client');
  });

  it('500s when the existence check itself throws', async () => {
    const broken = throwingOn(db, 'SELECT id FROM community_post');
    const { status, body } = await parseResponse(await react(broken, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
  });
});

describe('DELETE /api/community/reactions -- explicit un-react', () => {
  it('401s with no session, and leaves the row in place', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: HEART });
    const { status } = await parseResponse(await unreact(db, { who: null, body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 401);
    assert.equal(readReactions(db).length, 1);
  });

  it('403s a non-member, and leaves the row in place', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: HEART });
    const { status } = await parseResponse(await unreact(db, { who: 'nonmember', body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 403);
    assert.equal(readReactions(db).length, 1);
  });

  it('500s when the DB binding is absent', async () => {
    const { status, body } = await parseResponse(await unreact(db, { env: { DB: undefined }, body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('400s on a body that is not JSON', async () => {
    const { status, body } = await parseResponse(await unreact(db, { body: undefined }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s on an array payload', async () => {
    const { status, body } = await parseResponse(await unreact(db, { body: [] }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400s on a null payload', async () => {
    const { status, body } = await parseResponse(await unreact(db, { body: null }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  for (const missing of ['targetType', 'targetId', 'emoji']) {
    it(`400s when ${missing} is absent`, async () => {
      const payload = { targetType: 'post', targetId: POST_A, emoji: HEART };
      delete payload[missing];
      const { status, body } = await parseResponse(await unreact(db, { body: payload }));
      assert.equal(status, 400);
      assert.equal(body.error, 'targetType, targetId, and emoji required');
    });
  }

  it('400s when targetId is not a string', async () => {
    const { status, body } = await parseResponse(await unreact(db, { body: { targetType: 'post', targetId: {}, emoji: HEART } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid targetId');
  });

  it('400s when targetId exceeds 100 characters', async () => {
    const { status, body } = await parseResponse(await unreact(db, { body: { targetType: 'post', targetId: 'y'.repeat(101), emoji: HEART } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid targetId');
  });

  it('actually removes the caller\'s row', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: HEART });
    const { status, body } = await parseResponse(await unreact(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(readReactions(db), [], 'the row must actually be gone');
  });

  it('scopes the delete to the caller -- another member\'s identical reaction survives', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberB, targetType: 'post', targetId: POST_A, emoji: HEART });
    await unreact(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    const rows = readReactions(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, USERS.memberB);
  });

  it('scopes the delete to the named emoji -- the caller\'s other reactions survive', async () => {
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: HEART });
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: CLAP });
    await unreact(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } });
    assert.deepEqual(readReactions(db).map((r) => r.emoji), [CLAP]);
  });

  it('answers 200 for a reaction that was never there, and stores nothing', async () => {
    const { status, body } = await parseResponse(await unreact(db, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(readReactions(db), []);
  });

  it('does not re-validate targetType or emoji the way POST does, and deletes nothing on junk input', async () => {
    // Asserted rather than assumed: DELETE skips both allowlists. That is safe
    // only because the statement is scoped to user_id + an exact type/emoji
    // match, so an unrecognised value can only ever match zero rows. The
    // assertion is that it matches zero rows, not that it is rejected.
    insertReaction(db._sqlite, { userId: USERS.memberA, targetType: 'post', targetId: POST_A, emoji: HEART });
    const { status } = await parseResponse(await unreact(db, { body: { targetType: 'user', targetId: POST_A, emoji: '\u{1F4A9}' } }));
    assert.equal(status, 200);
    assert.equal(readReactions(db).length, 1, 'a junk type/emoji pair must not delete a real row');
  });

  it('500s generically when D1 throws on the delete', async () => {
    const broken = throwingOn(db, 'DELETE FROM community_reaction');
    const { status, body } = await parseResponse(await unreact(broken, { body: { targetType: 'post', targetId: POST_A, emoji: HEART } }));
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false, error: 'Internal error' });
  });
});
