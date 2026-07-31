/**
 * functions/api/account/mcp-keys/{index.js,[id].js} -- MCP API key issuance,
 * listing and revocation.
 *
 * WHY THIS FILE IS ADVERSARIAL RATHER THAN DESCRIPTIVE
 * This is credential issuance. Three properties decide whether the surface is
 * safe, and all three are only observable in the DATABASE, never in the
 * response body:
 *   1. the secret must land HASHED. The response returns the plaintext, so an
 *      endpoint that stored the plaintext would look identical from outside.
 *      Every mint test below reads mcp_api_key back and recomputes SHA-256 over
 *      the plaintext it was handed.
 *   2. the plaintext must be recoverable exactly ONCE, at mint. The list path is
 *      asserted to expose nothing but a 12-character prefix, and the secret tail
 *      is searched for in the serialized read body.
 *   3. revocation must be scoped to the owning account. The IDOR case (account A
 *      revoking or listing account B's key) is asserted on both endpoints, with
 *      the victim row re-read afterwards to prove it was untouched.
 * A canned mock would let all three "pass" while the code did the opposite, so
 * everything here runs on node:sqlite loaded with the committed schema
 * (test/_d1-sqlite.mjs), including the real UNIQUE index on key_hash.
 *
 * WHAT IS STILL FAKED
 *  - KV is the in-memory stub, so the 5-per-15-minutes create limit is proven
 *    against the same bucket arithmetic production runs, not against real KV
 *    latency or eventual consistency.
 *  - Analytics Engine is a capturing stub.
 *  - crypto.getRandomValues is the real Node WebCrypto, so key material is
 *    genuinely random; the collision path is forced by planting a conflicting
 *    key_hash row instead of by weakening the generator.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, mockKV } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const keys = await import('../functions/api/account/mcp-keys/index.js');
const keyById = await import('../functions/api/account/mcp-keys/[id].js');

const ALICE = 'u_alice';
const BOB = 'u_bob';
const RAW = { [ALICE]: 'raw-session-alice', [BOB]: 'raw-session-bob' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

async function seededDb({ seed, interleave } = {}) {
  const db = sqliteD1({
    interleave,
    seed(sqlite) {
      insertUser(sqlite, { id: ALICE, email: 'alice@example.com' });
      insertUser(sqlite, { id: BOB, email: 'bob@example.com' });
      if (seed) seed(sqlite);
    },
  });
  await Promise.all(Object.entries(RAW).map(([userId, rawId]) =>
    insertSession(db._sqlite, { rawId, userId, expiresAt: FUTURE })));
  return db;
}

function insertKey(sqlite, { id, userId, label = 'k', keyHash, keyPreview = 'rrma_mcp_aaa', createdAt = '2026-01-01 00:00:00', revokedAt = null, lastUsedAt = null }) {
  sqlite.prepare(
    'INSERT INTO mcp_api_key (id, user_id, label, key_hash, key_preview, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, label, keyHash ?? `hash_${id}`, keyPreview, createdAt, lastUsedAt, revokedAt);
}

const rows = (db, sql, ...args) => db._sqlite.prepare(sql).all(...args).map(r => ({ ...r }));
const one = (db, sql, ...args) => {
  const r = db._sqlite.prepare(sql).get(...args);
  return r === undefined ? null : { ...r };
};

const cookie = (userId) => ({ Cookie: `session=${RAW[userId]}` });

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function ctx(db, request, overrides = {}, params) {
  const events = [];
  const env = mockEnv({ DB: db, EVENTS: { writeDataPoint: (dp) => events.push(dp) }, ...overrides });
  return { request, env, waitUntil: mockWaitUntil(), events, params };
}

const listReq = (userId) => mockRequest('GET', {
  url: 'https://rrmacademy.org/api/account/mcp-keys',
  headers: userId ? cookie(userId) : {},
});
const createReq = (userId, body) => mockRequest('POST', {
  url: 'https://rrmacademy.org/api/account/mcp-keys',
  headers: userId ? cookie(userId) : {},
  body,
});
const rawCreateReq = (userId, rawBody) => mockRequest('POST', {
  url: 'https://rrmacademy.org/api/account/mcp-keys',
  headers: userId ? cookie(userId) : {},
  rawBody,
});
const revokeReq = (userId) => mockRequest('DELETE', {
  url: 'https://rrmacademy.org/api/account/mcp-keys/x',
  headers: userId ? cookie(userId) : {},
});

const deadDb = {
  prepare() {
    return {
      bind() { return this; },
      async first() { throw new Error('D1_ERROR: connection lost'); },
      async all() { throw new Error('D1_ERROR: connection lost'); },
      async run() { throw new Error('D1_ERROR: connection lost'); },
    };
  },
  async batch() { throw new Error('D1_ERROR: connection lost'); },
};

/** Mints one key through the real POST handler and returns its plaintext. */
async function mint(db, userId = ALICE, label = 'laptop', overrides = {}) {
  const res = await keys.onRequestPost(ctx(db, createReq(userId, { label }), overrides));
  const parsed = await parseResponse(res);
  assert.equal(parsed.status, 201, `mint failed: ${JSON.stringify(parsed.body)}`);
  return parsed.body;
}

// ---------------------------------------------------------------- OPTIONS ---

describe('OPTIONS on the MCP key endpoints', () => {
  it('collection preflight is 204 with the locked origin', async () => {
    const res = await keys.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('item preflight is 204 with the locked origin', async () => {
    const res = await keyById.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// --------------------------------------------------------- POST (issuance) ---

describe('POST /api/account/mcp-keys -- the secret never lands in plaintext', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('stores SHA-256 of the key, and the stored row does not contain the secret', async () => {
    const body = await mint(db);
    const stored = one(db, 'SELECT * FROM mcp_api_key WHERE id = ?', body.id);

    assert.ok(stored, 'the key row must actually exist');
    assert.equal(stored.key_hash, await sha256Hex(body.plaintext));
    assert.notEqual(stored.key_hash, body.plaintext);

    // The stored row may legitimately carry a 12-char display prefix; it must
    // carry nothing beyond that. Search the whole serialized row for the tail.
    const secretTail = body.plaintext.slice(12);
    assert.ok(secretTail.length >= 36, 'the tail under test must be most of the secret');
    assert.ok(!JSON.stringify(stored).includes(secretTail),
      'the entropy portion of the key must not be recoverable from the row');
    assert.ok(!JSON.stringify(stored).includes(body.plaintext));
  });

  it('mints a well-formed prefixed key and a matching 12-character preview', async () => {
    const body = await mint(db);
    assert.match(body.plaintext, /^rrma_mcp_[0-9a-f]{48}$/);
    assert.match(body.id, /^mcpkey_[0-9a-f]{24}$/);
    assert.equal(body.key_preview, body.plaintext.slice(0, 12));
    assert.equal(body.key_preview.length, 12);
    assert.equal(one(db, 'SELECT key_preview FROM mcp_api_key WHERE id = ?', body.id).key_preview, body.key_preview);
  });

  it('returns 201 with the label and a created_at, owned by the session user', async () => {
    const body = await mint(db, ALICE, '  MacBook  ');
    assert.equal(body.ok, true);
    assert.equal(body.label, 'MacBook', 'label is trimmed before storage');
    assert.match(body.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(one(db, 'SELECT user_id FROM mcp_api_key WHERE id = ?', body.id).user_id, ALICE);
  });

  it('ignores any user_id supplied in the body -- ownership comes from the session', async () => {
    const res = await keys.onRequestPost(ctx(db, createReq(ALICE, { label: 'x', user_id: BOB, userId: BOB })));
    const { body } = await parseResponse(res);
    assert.equal(one(db, 'SELECT user_id FROM mcp_api_key WHERE id = ?', body.id).user_id, ALICE);
    assert.equal(rows(db, 'SELECT id FROM mcp_api_key WHERE user_id = ?', BOB).length, 0);
  });

  it('gives every mint distinct key material', async () => {
    const a = await mint(db, ALICE, 'one');
    const b = await mint(db, ALICE, 'two');
    assert.notEqual(a.plaintext, b.plaintext);
    assert.notEqual(a.id, b.id);
    assert.equal(rows(db, 'SELECT DISTINCT key_hash FROM mcp_api_key').length, 2);
  });

  it('records an mcp_key_created event', async () => {
    const c = ctx(db, createReq(ALICE, { label: 'x' }));
    await keys.onRequestPost(c);
    const ev = c.events.find(e => e.blobs[2] === 'mcp_key_created');
    assert.ok(ev, 'expected an mcp_key_created event');
    assert.equal(ev.blobs[3], 'ok');
    assert.equal(ev.blobs[4], ALICE);
  });
});

describe('POST /api/account/mcp-keys -- gating and validation', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  const post = async (body, userId = ALICE, overrides) =>
    parseResponse(await keys.onRequestPost(ctx(db, createReq(userId, body), overrides)));

  it('returns 500 when the DB binding is missing, never a silent 200', async () => {
    const { status, body } = await post({ label: 'x' }, ALICE, { DB: undefined });
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  });

  it('rejects an anonymous caller with 401 and mints nothing', async () => {
    const { status, body } = await post({ label: 'x' }, null);
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.equal(rows(db, 'SELECT id FROM mcp_api_key').length, 0);
  });

  it('401s when the account row disappears between session validation and the user read', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('SELECT id, blocked FROM user')) return;
        fired = true;
        sqlite.prepare('DELETE FROM user WHERE id = ?').run(ALICE);
      },
    });
    const { status, body } = await parseResponse(await keys.onRequestPost(ctx(raced, createReq(ALICE, { label: 'x' }))));
    assert.equal(status, 401);
    assert.equal(body.error, 'User not found');
    assert.equal(rows(raced, 'SELECT id FROM mcp_api_key').length, 0);
    raced.close();
  });

  it('403s and mints nothing when the account is suspended mid-request', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('SELECT id, blocked FROM user')) return;
        fired = true;
        sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(ALICE);
      },
    });
    const { status, body } = await parseResponse(await keys.onRequestPost(ctx(raced, createReq(ALICE, { label: 'x' }))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Account suspended');
    assert.equal(rows(raced, 'SELECT id FROM mcp_api_key').length, 0);
    raced.close();
  });

  it('FAIL-CLOSED: a missing KV binding denies issuance rather than skipping the limit', async () => {
    const { status, body } = await post({ label: 'x' }, ALICE, { COMMUNITY_KV: undefined });
    assert.equal(status, 429);
    assert.equal(body.error, 'Too many attempts. Please try again later.');
    assert.equal(rows(db, 'SELECT id FROM mcp_api_key').length, 0);
  });

  it('rate-limits issuance to 5 per window, per account, before any body parsing', async () => {
    const kv = mockKV();
    for (let i = 0; i < 5; i++) {
      const res = await keys.onRequestPost(ctx(db, createReq(ALICE, { label: `k${i}` }), { COMMUNITY_KV: kv }));
      assert.equal((await parseResponse(res)).status, 201, `mint ${i} should succeed`);
    }
    const sixth = await parseResponse(await keys.onRequestPost(ctx(db, createReq(ALICE, { label: 'k5' }), { COMMUNITY_KV: kv })));
    assert.equal(sixth.status, 429);
    assert.equal(rows(db, 'SELECT id FROM mcp_api_key').length, 5);

    // The bucket is scoped to the account: Bob is unaffected by Alice's spend.
    const bob = await parseResponse(await keys.onRequestPost(ctx(db, createReq(BOB, { label: 'bob' }), { COMMUNITY_KV: kv })));
    assert.equal(bob.status, 201);
  });

  it('rejects a malformed JSON body', async () => {
    const { status, body } = await parseResponse(await keys.onRequestPost(ctx(db, rawCreateReq(ALICE, '{oops'))));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('rejects array and null bodies', async () => {
    assert.equal((await post([{ label: 'x' }])).body.error, 'Invalid payload');
    const { body } = await parseResponse(await keys.onRequestPost(ctx(db, rawCreateReq(ALICE, 'null'))));
    assert.equal(body.error, 'Invalid payload');
  });

  it('requires a non-empty string label', async () => {
    assert.equal((await post({})).body.error, 'label_required');
    assert.equal((await post({ label: 42 })).body.error, 'label_required');
    assert.equal((await post({ label: '   ' })).body.error, 'label_required');
    assert.equal(rows(db, 'SELECT id FROM mcp_api_key').length, 0);
  });

  it('caps the label at 60 characters and accepts exactly 60', async () => {
    const over = await post({ label: 'a'.repeat(61) });
    assert.equal(over.status, 400);
    assert.equal(over.body.error, 'label_too_long');

    const at = await post({ label: 'b'.repeat(60) });
    assert.equal(at.status, 201);
    assert.equal(one(db, 'SELECT length(label) AS n FROM mcp_api_key').n, 60);
  });

  it('refuses a sixth ACTIVE key with 409, counting only unrevoked rows', async () => {
    for (let i = 0; i < 5; i++) insertKey(db._sqlite, { id: `k${i}`, userId: ALICE });
    const { status, body } = await post({ label: 'sixth' });
    assert.equal(status, 409);
    assert.equal(body.error, 'max_keys_reached');
    assert.equal(rows(db, 'SELECT id FROM mcp_api_key WHERE user_id = ?', ALICE).length, 5);
  });

  it('lets a revoked key free up a slot', async () => {
    for (let i = 0; i < 4; i++) insertKey(db._sqlite, { id: `k${i}`, userId: ALICE });
    insertKey(db._sqlite, { id: 'k-revoked', userId: ALICE, revokedAt: '2026-02-01 00:00:00' });
    const { status } = await post({ label: 'replacement' });
    assert.equal(status, 201);
  });

  it('counts the cap per account, not globally', async () => {
    for (let i = 0; i < 5; i++) insertKey(db._sqlite, { id: `bob${i}`, userId: BOB });
    const { status } = await post({ label: 'alice-first' }, ALICE);
    assert.equal(status, 201);
  });

  it('409s on a key_hash collision instead of overwriting the existing key', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql, bindings, db: sqlite }) => {
        if (fired || !sql.includes('INSERT INTO mcp_api_key')) return;
        fired = true;
        // Plant a row holding the exact hash the handler is about to write.
        sqlite.prepare('INSERT INTO mcp_api_key (id, user_id, label, key_hash, key_preview) VALUES (?, ?, ?, ?, ?)')
          .run('mcpkey_squatter', BOB, 'squatter', bindings[3], 'rrma_mcp_zzz');
      },
    });
    const { status, body } = await parseResponse(await keys.onRequestPost(ctx(raced, createReq(ALICE, { label: 'x' }))));
    assert.equal(status, 409);
    assert.equal(body.error, 'key_collision');
    assert.equal(body.plaintext, undefined, 'a failed mint must not hand back key material');
    assert.equal(rows(raced, 'SELECT id FROM mcp_api_key WHERE user_id = ?', ALICE).length, 0);
    assert.equal(one(raced, 'SELECT user_id FROM mcp_api_key WHERE id = ?', 'mcpkey_squatter').user_id, BOB);
    raced.close();
  });

  it('rethrows a non-UNIQUE write failure as a 500 and logs it', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql }) => {
        if (fired || !sql.includes('INSERT INTO mcp_api_key')) return;
        fired = true;
        throw new Error('D1_ERROR: disk full');
      },
    });
    const c = ctx(raced, createReq(ALICE, { label: 'x' }));
    const { status, body } = await parseResponse(await keys.onRequestPost(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'mcp_key_create_error'));
    assert.equal(rows(raced, 'SELECT id FROM mcp_api_key').length, 0);
    raced.close();
  });

  it('survives a thrown value that carries no message', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql }) => {
        if (fired || !sql.includes('INSERT INTO mcp_api_key')) return;
        fired = true;
        throw 'bare string failure';
      },
    });
    const { status, body } = await parseResponse(await keys.onRequestPost(ctx(raced, createReq(ALICE, { label: 'x' }))));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    raced.close();
  });

  it('returns 500 and logs when D1 is unreachable', async () => {
    const c = ctx(db, createReq(ALICE, { label: 'x' }), { DB: deadDb });
    const { status } = await parseResponse(await keys.onRequestPost(c));
    assert.equal(status, 500);
    assert.ok(c.events.find(e => e.blobs[2] === 'mcp_key_create_error'));
  });
});

// -------------------------------------------------------------- GET (list) ---

describe('GET /api/account/mcp-keys -- the secret is not recoverable after mint', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('exposes only the preview: the minted plaintext cannot be read back', async () => {
    const minted = await mint(db);
    const { status, body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))));

    assert.equal(status, 200);
    assert.equal(body.keys.length, 1);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(minted.plaintext), 'plaintext must not survive to the read path');
    assert.ok(!serialized.includes(minted.plaintext.slice(12)), 'the entropy tail must not be readable');
    assert.ok(!serialized.includes(await sha256Hex(minted.plaintext)), 'the hash must not be published either');
  });

  it('returns exactly the six display columns and no credential material', async () => {
    await mint(db);
    const { body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))));
    assert.deepEqual(Object.keys(body.keys[0]).sort(),
      ['created_at', 'id', 'key_preview', 'label', 'last_used_at', 'revoked_at']);
    assert.equal(body.keys[0].key_hash, undefined);
    assert.equal(body.keys[0].plaintext, undefined);
  });

  it('IDOR: a caller sees only their own keys', async () => {
    insertKey(db._sqlite, { id: 'alice-1', userId: ALICE, label: 'mine' });
    insertKey(db._sqlite, { id: 'bob-1', userId: BOB, label: 'not mine' });

    const { body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))));
    assert.deepEqual(body.keys.map(k => k.id), ['alice-1']);

    const bobBody = (await parseResponse(await keys.onRequestGet(ctx(db, listReq(BOB))))).body;
    assert.deepEqual(bobBody.keys.map(k => k.id), ['bob-1']);
  });

  it('sorts active keys first (newest first), then revoked ones', async () => {
    insertKey(db._sqlite, { id: 'active-old', userId: ALICE, createdAt: '2026-01-01 00:00:00' });
    insertKey(db._sqlite, { id: 'active-new', userId: ALICE, createdAt: '2026-03-01 00:00:00' });
    insertKey(db._sqlite, { id: 'revoked-newest', userId: ALICE, createdAt: '2026-06-01 00:00:00', revokedAt: '2026-06-02 00:00:00' });

    const { body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))));
    assert.deepEqual(body.keys.map(k => k.id), ['active-new', 'active-old', 'revoked-newest']);
    assert.equal(body.keys[2].revoked_at, '2026-06-02 00:00:00');
  });

  it('surfaces last_used_at when the MCP server has stamped it', async () => {
    insertKey(db._sqlite, { id: 'k1', userId: ALICE, lastUsedAt: '2026-07-01 12:00:00' });
    const { body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))));
    assert.equal(body.keys[0].last_used_at, '2026-07-01 12:00:00');
  });

  it('returns an empty list, not a 404, for an account with no keys', async () => {
    const { status, body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))));
    assert.equal(status, 200);
    assert.deepEqual(body.keys, []);
  });

  it('degrades to an empty list rather than 500 when the driver returns no results array', async () => {
    // D1 normally always hands back `results`. The `|| []` fallback in the
    // handler is the arm that keeps a driver-shape surprise from becoming a
    // 500 on an account page; wrap the real engine to produce exactly that.
    await mint(db);
    const shy = {
      prepare(sql) {
        const stmt = db.prepare(sql);
        if (!sql.includes('FROM mcp_api_key')) return stmt;
        return {
          bind(...args) { stmt.bind(...args); return this; },
          first: () => stmt.first(),
          run: () => stmt.run(),
          async all() { const r = await stmt.all(); return { ...r, results: undefined }; },
        };
      },
      batch: (stmts) => db.batch(stmts),
    };
    const { status, body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE), { DB: shy })));
    assert.equal(status, 200);
    assert.deepEqual(body.keys, []);
  });

  it('returns 500 when the DB binding is missing', async () => {
    const { status } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE), { DB: undefined })));
    assert.equal(status, 500);
  });

  it('rejects an anonymous caller with 401', async () => {
    const { status, body } = await parseResponse(await keys.onRequestGet(ctx(db, listReq(null))));
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
  });

  it('401s when the account row disappears mid-request', async () => {
    let fired = false;
    const raced = await seededDb({
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('SELECT id, blocked FROM user')) return;
        fired = true;
        sqlite.prepare('DELETE FROM user WHERE id = ?').run(ALICE);
      },
    });
    const { status, body } = await parseResponse(await keys.onRequestGet(ctx(raced, listReq(ALICE))));
    assert.equal(status, 401);
    assert.equal(body.error, 'User not found');
    raced.close();
  });

  it('403s for a suspended account', async () => {
    let fired = false;
    const raced = await seededDb({
      seed(sqlite) { insertKey(sqlite, { id: 'k1', userId: ALICE }); },
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('SELECT id, blocked FROM user')) return;
        fired = true;
        sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(ALICE);
      },
    });
    const { status, body } = await parseResponse(await keys.onRequestGet(ctx(raced, listReq(ALICE))));
    assert.equal(status, 403);
    assert.equal(body.error, 'Account suspended');
    raced.close();
  });

  it('returns 500 and logs when D1 throws', async () => {
    const c = ctx(db, listReq(ALICE), { DB: deadDb });
    const { status, body } = await parseResponse(await keys.onRequestGet(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'mcp_keys_list_error'));
  });
});

// ------------------------------------------------------ DELETE (revocation) ---

describe('DELETE /api/account/mcp-keys/:id -- revocation', () => {
  let db;
  beforeEach(async () => {
    db = await seededDb({
      seed(sqlite) {
        insertKey(sqlite, { id: 'alice-key', userId: ALICE, label: 'laptop' });
        insertKey(sqlite, { id: 'bob-key', userId: BOB, label: 'bob laptop' });
      },
    });
  });
  afterEach(() => db.close());

  const revoke = async (id, userId = ALICE, overrides) =>
    parseResponse(await keyById.onRequestDelete(ctx(db, revokeReq(userId), overrides, id === undefined ? undefined : { id })));

  it('soft-revokes the owner\'s key: the row survives with revoked_at stamped', async () => {
    const { status, body } = await revoke('alice-key');
    assert.equal(status, 200);
    assert.equal(body.id, 'alice-key');

    const stored = one(db, 'SELECT id, revoked_at FROM mcp_api_key WHERE id = ?', 'alice-key');
    assert.ok(stored, 'revocation is a soft delete, the row must remain');
    assert.notEqual(stored.revoked_at, null);
    assert.equal(body.revoked_at, stored.revoked_at, 'the response echoes the stored value');
  });

  it('the revoked key no longer counts as active', async () => {
    await revoke('alice-key');
    assert.equal(one(db, 'SELECT COUNT(*) AS n FROM mcp_api_key WHERE user_id = ? AND revoked_at IS NULL', ALICE).n, 0);
  });

  it('IDOR: account A cannot revoke account B\'s key -- 404, and B\'s key stays active', async () => {
    const { status, body } = await revoke('bob-key', ALICE);
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(one(db, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', 'bob-key').revoked_at, null,
      'the victim key must remain usable');
  });

  it('404s on a key id that does not exist', async () => {
    const { status, body } = await revoke('mcpkey_nope');
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('410s on a replayed revocation and does not restamp revoked_at', async () => {
    await revoke('alice-key');
    const first = one(db, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', 'alice-key').revoked_at;

    const { status, body } = await revoke('alice-key');
    assert.equal(status, 410);
    assert.equal(body.error, 'already_revoked');
    assert.equal(one(db, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', 'alice-key').revoked_at, first);
  });

  it('returns 500 when the DB binding is missing', async () => {
    const { status } = await revoke('alice-key', ALICE, { DB: undefined });
    assert.equal(status, 500);
  });

  it('rejects an anonymous caller with 401 and revokes nothing', async () => {
    const { status, body } = await revoke('alice-key', null);
    assert.equal(status, 401);
    assert.equal(body.error, 'Not authenticated');
    assert.equal(one(db, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', 'alice-key').revoked_at, null);
  });

  it('rejects a missing, non-string, empty or oversized key id', async () => {
    assert.equal((await revoke(undefined)).body.error, 'invalid_key_id');
    assert.equal((await revoke(12345)).body.error, 'invalid_key_id');
    assert.equal((await revoke('')).body.error, 'invalid_key_id');
    assert.equal((await revoke('a'.repeat(65))).body.error, 'invalid_key_id');
    assert.equal((await revoke('a'.repeat(64))).status, 404, 'exactly 64 is accepted, then simply not found');
  });

  it('401s when the account row disappears mid-request', async () => {
    let fired = false;
    const raced = await seededDb({
      seed(sqlite) { insertKey(sqlite, { id: 'alice-key', userId: ALICE }); },
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('SELECT id, blocked FROM user')) return;
        fired = true;
        sqlite.prepare('DELETE FROM user WHERE id = ?').run(ALICE);
      },
    });
    const { status, body } = await parseResponse(await keyById.onRequestDelete(
      ctx(raced, revokeReq(ALICE), {}, { id: 'alice-key' })));
    assert.equal(status, 401);
    assert.equal(body.error, 'User not found');
    assert.equal(one(raced, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', 'alice-key').revoked_at, null);
    raced.close();
  });

  it('403s and revokes nothing for a suspended account', async () => {
    let fired = false;
    const raced = await seededDb({
      seed(sqlite) { insertKey(sqlite, { id: 'alice-key', userId: ALICE }); },
      interleave: ({ sql, db: sqlite }) => {
        if (fired || !sql.includes('SELECT id, blocked FROM user')) return;
        fired = true;
        sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(ALICE);
      },
    });
    const { status, body } = await parseResponse(await keyById.onRequestDelete(
      ctx(raced, revokeReq(ALICE), {}, { id: 'alice-key' })));
    assert.equal(status, 403);
    assert.equal(body.error, 'Account suspended');
    assert.equal(one(raced, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', 'alice-key').revoked_at, null);
    raced.close();
  });

  it('records an mcp_key_revoked event', async () => {
    const c = ctx(db, revokeReq(ALICE), {}, { id: 'alice-key' });
    await keyById.onRequestDelete(c);
    const ev = c.events.find(e => e.blobs[2] === 'mcp_key_revoked');
    assert.ok(ev, 'expected an mcp_key_revoked event');
    assert.equal(ev.blobs[4], ALICE);
  });

  it('returns 500 and logs when D1 throws', async () => {
    const c = ctx(db, revokeReq(ALICE), { DB: deadDb }, { id: 'alice-key' });
    const { status, body } = await parseResponse(await keyById.onRequestDelete(c));
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
    assert.ok(c.events.find(e => e.blobs[2] === 'mcp_key_revoke_error'));
  });
});

// --------------------------------------------------- mint / revoke round trip ---

describe('MCP key lifecycle end to end', () => {
  let db;
  beforeEach(async () => { db = await seededDb(); });
  afterEach(() => db.close());

  it('mint -> list -> revoke -> list, with the secret readable exactly once', async () => {
    const minted = await mint(db, ALICE, 'agent');

    const afterMint = (await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))))).body;
    assert.equal(afterMint.keys[0].revoked_at, null);
    assert.ok(!JSON.stringify(afterMint).includes(minted.plaintext));

    const revoked = await parseResponse(await keyById.onRequestDelete(
      ctx(db, revokeReq(ALICE), {}, { id: minted.id })));
    assert.equal(revoked.status, 200);

    const afterRevoke = (await parseResponse(await keys.onRequestGet(ctx(db, listReq(ALICE))))).body;
    assert.equal(afterRevoke.keys.length, 1);
    assert.notEqual(afterRevoke.keys[0].revoked_at, null);
    assert.ok(!JSON.stringify(afterRevoke).includes(minted.plaintext));
  });

  it('Bob cannot revoke the key Alice just minted', async () => {
    const minted = await mint(db, ALICE, 'agent');
    const { status } = await parseResponse(await keyById.onRequestDelete(
      ctx(db, revokeReq(BOB), {}, { id: minted.id })));
    assert.equal(status, 404);
    assert.equal(one(db, 'SELECT revoked_at FROM mcp_api_key WHERE id = ?', minted.id).revoked_at, null);
  });
});
