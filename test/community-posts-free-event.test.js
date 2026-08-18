/**
 * functions/api/community/posts.js -- the `isFree` flag on an event post.
 *
 * WHY THIS IS ITS OWN FILE, AND WHY IT ASSERTS ON THE STORED ROW
 * -------------------------------------------------------------
 * `is_free` is not a display preference. It is the single value that decides
 * whether /events/<slug> shows an anonymous visitor an email capture, and
 * therefore whether POST /api/events/register will hand that visitor the joining
 * link. So the claims worth making are (a) what is STORED, read back from the
 * row rather than echoed from the response, and (b) that the two GET projections
 * report it, because the admin UI decides what to show from those.
 *
 * The harness is the shared community fixture: real SQLite, committed schema
 * plus the committed migrations 025 and 032 read off disk, and the real
 * requireMember gate reached through a real session cookie.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse, stubExternalFetch,
} from './_helpers.js';
import { communityDb, insertPost, RAW } from './_community-fixtures.mjs';

const posts = await import('../functions/api/community/posts.js');

const URL_ = 'https://rrmacademy.org/api/community/posts';
const FUTURE = new Date(Date.now() + 7 * 86400e3).toISOString();

/** Silences notifyNewPost's member blast by pre-arming its 15-minute cooldown. */
function cooledKv() {
  const kv = mockKV();
  kv.put('community:last_post_email', String(Date.now()));
  return kv;
}

function ctx(db, { who = 'admin', body, url = URL_, method = 'POST' } = {}) {
  return {
    request: mockRequest(method, { url, headers: { Cookie: `session=${RAW[who]}` }, body }),
    env: mockEnv({ DB: db, COMMUNITY_KV: cooledKv() }),
    waitUntil: mockWaitUntil(),
  };
}

const create = (db, opts) => posts.onRequestPost(ctx(db, { ...opts, method: 'POST' }));
const read = (db, opts) => posts.onRequestGet(ctx(db, { ...opts, method: 'GET' }));

const storedIsFree = (db, id) =>
  db._sqlite.prepare('SELECT is_free FROM community_post WHERE id = ?').get(id).is_free;

const EVENT = {
  type: 'event',
  title: 'Free Public Call',
  body: 'Come and bring your questions.',
  eventDate: FUTURE,
  eventLink: 'https://meet.google.com/gat-eded-xyz',
};

let db;
let fetchStub;
beforeEach(async () => {
  fetchStub = stubExternalFetch();
  db = await communityDb();
});
afterEach(() => { fetchStub.restore(); db.close(); });

describe('POST /api/community/posts -- isFree on an event', () => {
  it('persists isFree: true as 1 and returns it', async () => {
    const { status, body } = await parseResponse(await create(db, { body: { ...EVENT, isFree: true } }));

    assert.equal(status, 201);
    assert.equal(body.post.isFree, true);
    assert.equal(storedIsFree(db, body.post.id), 1, 'the row is what /events/<slug> reads, not the response');
  });

  it('defaults to members-only when isFree is absent', async () => {
    const { status, body } = await parseResponse(await create(db, { body: EVENT }));

    assert.equal(status, 201);
    assert.equal(body.post.isFree, false);
    assert.equal(storedIsFree(db, body.post.id), 0, 'silence must never mean free');
  });

  it('treats an explicit false and an explicit null as members-only', async () => {
    for (const isFree of [false, null]) {
      const { body } = await parseResponse(await create(db, { body: { ...EVENT, isFree, slug: `call-${String(isFree)}` } }));
      assert.equal(body.post.isFree, false, JSON.stringify(isFree));
      assert.equal(storedIsFree(db, body.post.id), 0);
    }
  });

  /**
   * A truthy non-boolean is REFUSED rather than coerced. Coercion here would let
   * a caller send `isFree: "no"` and open the event, which is the wrong direction
   * for the one flag that governs who can obtain the joining link.
   */
  it('400s on a non-boolean isFree, and writes nothing', async () => {
    for (const isFree of ['true', 1, 0, 'no', {}, []]) {
      const { status, body } = await parseResponse(await create(db, { body: { ...EVENT, isFree } }));
      assert.equal(status, 400, JSON.stringify(isFree));
      assert.equal(body.error, 'invalid_is_free');
    }
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('400s when a non-event asks to be free', async () => {
    const { status, body } = await parseResponse(await create(db, {
      body: { type: 'announcement', title: 'Notice', body: 'Something', isFree: true },
    }));
    assert.equal(status, 400);
    assert.equal(body.error, 'is_free_event_only');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) AS n FROM community_post').get().n, 0);
  });

  it('accepts isFree: false on a non-event, since it changes nothing', async () => {
    const { status, body } = await parseResponse(await create(db, {
      body: { type: 'announcement', title: 'Notice', body: 'Something', isFree: false },
    }));
    assert.equal(status, 201);
    assert.equal(body.post.isFree, false);
  });
});

describe('GET /api/community/posts -- isFree in both projections', () => {
  beforeEach(() => {
    insertPost(db._sqlite, {
      id: 'p_free', type: 'event', title: 'Free Call', slug: 'free-call',
      eventDate: FUTURE, eventLink: 'https://meet.google.com/aaa-bbbb-ccc', isFree: 1,
    });
    insertPost(db._sqlite, {
      id: 'p_paid', type: 'event', title: 'Members Call', slug: 'members-call',
      eventDate: FUTURE, eventLink: 'https://meet.google.com/ddd-eeee-fff', isFree: 0,
    });
  });

  it('the single-post read by id reports isFree as a boolean', async () => {
    const free = await parseResponse(await read(db, { url: `${URL_}?id=p_free` }));
    const paid = await parseResponse(await read(db, { url: `${URL_}?id=p_paid` }));

    assert.equal(free.body.post.isFree, true);
    assert.equal(paid.body.post.isFree, false);
  });

  it('the single-post read by slug reports isFree', async () => {
    const { body } = await parseResponse(await read(db, { url: `${URL_}?slug=free-call` }));
    assert.equal(body.post.isFree, true);
  });

  it('the event list reports isFree on every row', async () => {
    const { body } = await parseResponse(await read(db, { url: `${URL_}?type=event` }));
    const byId = Object.fromEntries(body.posts.map((p) => [p.id, p.isFree]));

    assert.equal(byId.p_free, true);
    assert.equal(byId.p_paid, false);
  });
});
