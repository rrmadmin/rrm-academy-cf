/**
 * functions/api/community/areas/volunteer.js -- the "volunteer to lead an
 * ownerless action area" request, and its withdrawal.
 *
 *   POST   /api/community/areas/volunteer   file or refresh a pending request
 *   DELETE /api/community/areas/volunteer   withdraw your own pending request
 *
 * WHY A REAL SQLITE ENGINE
 * The whole contract of this endpoint is one UPSERT and one conditional UPDATE,
 * and both are decided by the schema rather than by the handler:
 *   - `ON CONFLICT(area_id, user_id) DO UPDATE SET status='pending', ...,
 *     decided_at = NULL, decided_by = NULL` only fires because migrations/027
 *     declares UNIQUE(area_id, user_id). Without that constraint a member who
 *     withdrew and volunteered again would accumulate a SECOND row and appear
 *     twice in the admin queue, and the handler would look identical.
 *   - the withdrawal is `UPDATE ... WHERE area_id = ? AND user_id = ? AND
 *     status = 'pending'`, so `withdrawn` is SQLite's changes count. An already
 *     approved request must not be withdrawable, and that is a fact about the
 *     WHERE clause.
 * Under a canned mock both would return whatever the fixture declared. Every
 * assertion below reads the stored area_ownership_request rows back out.
 *
 * THE GATE IS NOT STUBBED: requireMember is the real one, exercised through both
 * methods. The member fixture carries the legacy grandfather label so the gate
 * resolves it through its own SQL with no Stripe traffic.
 *
 * WHAT IS STILL FAKED
 *  - Analytics Engine is the mockEnv stub.
 *  - `if (!db) return 503` is dead code in both handlers: requireMember reads
 *    the same env.DB first and answers 500. Asserted as 500, and said out loud.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { insertUser, insertLabel, insertSession } from './_d1-sqlite.mjs';
import { communityD1, insertArea, ownershipRequests } from './_community-sqlite.mjs';

const volunteer = await import('../functions/api/community/areas/volunteer.js');

const MEMBER = 'u_member';
const MEMBER2 = 'u_member2';
const OUTSIDER = 'u_outsider';
const RAW = { [MEMBER]: 'raw-member', [MEMBER2]: 'raw-member-2', [OUTSIDER]: 'raw-outsider' };
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86400;

async function harness({ seed, interleave } = {}) {
  const db = communityD1({
    seed(s) {
      for (const id of [MEMBER, MEMBER2]) {
        insertUser(s, { id, email: `${id}@example.com` });
        insertLabel(s, id, 'STUC Legacy Grandfather');
      }
      insertUser(s, { id: OUTSIDER, email: 'outsider@example.com' });
      insertUser(s, { id: 'u_lead', email: 'lead@example.com' });

      insertArea(s, { id: 'a_free', slug: 'ownerless' });
      insertArea(s, { id: 'a_free2', slug: 'ownerless-two' });
      insertArea(s, { id: 'a_taken', slug: 'has-owner', owner_user_id: 'u_lead' });
      insertArea(s, { id: 'a_gone', slug: 'archived-area', status: 'archived' });

      if (seed) seed(s);
    },
    interleave,
  });
  for (const id of [MEMBER, MEMBER2, OUTSIDER]) {
    await insertSession(db._sqlite, { rawId: RAW[id], userId: id, expiresAt: FUTURE });
  }
  return db;
}

async function call(method, db, { body, rawBody, who = MEMBER } = {}) {
  const handler = method === 'POST' ? volunteer.onRequestPost : volunteer.onRequestDelete;
  const headers = who ? { Cookie: `session=${RAW[who]}` } : {};
  const url = 'https://rrmacademy.org/api/community/areas/volunteer';
  const request = rawBody !== undefined
    ? mockRequest(method, { rawBody, headers, url })
    : mockRequest(method, { body, headers, url });
  return parseResponse(await handler({ request, env: mockEnv({ DB: db }), waitUntil: mockWaitUntil() }));
}

const requests = (db, user = MEMBER) => ownershipRequests(db, user);

// ---------------------------------------------------------------------------
// Shared shape across both methods
// ---------------------------------------------------------------------------

describe('areas/volunteer -- gate and body validation on both methods', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('OPTIONS preflight answers 204 with the locked-down CORS origin', async () => {
    const res = await volunteer.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  for (const method of ['POST', 'DELETE']) {
    it(`${method} refuses an anonymous caller with 401 and stores nothing`, async () => {
      const { status, body } = await call(method, db, { body: { areaId: 'a_free' }, who: null });
      assert.equal(status, 401);
      assert.equal(body.error, 'Not authenticated');
      assert.deepEqual(requests(db), []);
    });

    it(`${method} refuses an authenticated NON-member with 403 and stores nothing`, async () => {
      const { status, body } = await call(method, db, { body: { areaId: 'a_free' }, who: OUTSIDER });
      assert.equal(status, 403);
      assert.equal(body.error, 'Membership required');
      assert.deepEqual(requests(db, OUTSIDER), []);
    });

    it(`${method} 400s a malformed JSON body`, async () => {
      const { status, body } = await call(method, db, { rawBody: '{oops' });
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_json');
    });

    it(`${method} 400s a body that is not a JSON object`, async () => {
      for (const rawBody of ['null', '[]', '"str"', '3']) {
        const { status, body } = await call(method, db, { rawBody });
        assert.equal(status, 400, `body ${rawBody} should be refused`);
        assert.equal(body.error, 'invalid_payload');
      }
    });

    it(`${method} 400s a missing, non-string, empty or over-long areaId`, async () => {
      for (const body of [{}, { areaId: 7 }, { areaId: '' }, { areaId: null }, { areaId: ['a'] }, { areaId: 'x'.repeat(101) }]) {
        const res = await call(method, db, { body });
        assert.equal(res.status, 400, `${JSON.stringify(body)} should be refused`);
        assert.equal(res.body.error, 'invalid_area_id');
      }
    });

    it(`${method} 500s when the DB binding is absent -- its own 503 branch is unreachable`, async () => {
      // requireMember reads the same env.DB one line earlier and answers 500
      // "Server misconfigured", so the `if (!db) return 503` below it is dead.
      const handler = method === 'POST' ? volunteer.onRequestPost : volunteer.onRequestDelete;
      const { status, body } = await parseResponse(await handler({
        request: mockRequest(method, { body: { areaId: 'a_free' }, headers: { Cookie: `session=${RAW[MEMBER]}` } }),
        env: mockEnv({ DB: undefined }),
        waitUntil: mockWaitUntil(),
      }));
      assert.equal(status, 500);
      assert.equal(body.error, 'Server misconfigured');
    });

    it(`${method} 500s from the outer catch when the membership gate itself throws`, async () => {
      const failing = await harness({
        interleave({ sql }) {
          if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) throw new Error('D1 down');
        },
      });
      const { status, body } = await call(method, failing, { body: { areaId: 'a_free' } });
      assert.equal(status, 500);
      assert.equal(body.error, 'internal_error');
      failing.close();
    });
  }
});

// ---------------------------------------------------------------------------
// POST -- filing a request
// ---------------------------------------------------------------------------

describe('POST /api/community/areas/volunteer', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('stores a pending request with a generated id and the supplied message', async () => {
    const { status, body } = await call('POST', db, { body: { areaId: 'a_free', message: 'I run the endo journal club.' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, status: 'pending' });

    const rows = requests(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].area_id, 'a_free');
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].message, 'I run the endo journal club.');
    assert.equal(rows[0].decided_at, null);
    assert.equal(rows[0].decided_by, null);
    assert.match(rows[0].id, /^[0-9a-f]{32}$/, 'generateId() writes a 16-byte hex id');
  });

  it('an omitted message is stored as NULL, not as the string "undefined"', async () => {
    await call('POST', db, { body: { areaId: 'a_free' } });
    assert.equal(requests(db)[0].message, null, 'the `message ?? null` default arm');
  });

  it('an explicit null message is stored as NULL', async () => {
    await call('POST', db, { body: { areaId: 'a_free', message: null } });
    assert.equal(requests(db)[0].message, null);
  });

  it('a 500-character message is accepted; 501 is refused', async () => {
    const ok = await call('POST', db, { body: { areaId: 'a_free', message: 'm'.repeat(500) } });
    assert.equal(ok.status, 200);
    assert.equal(requests(db)[0].message.length, 500);

    const tooLong = await call('POST', db, { body: { areaId: 'a_free2', message: 'm'.repeat(501) } });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error, 'invalid_message');
    assert.equal(requests(db).length, 1, 'the refused request must not be stored');
  });

  it('a non-string message is refused', async () => {
    for (const message of [42, { text: 'hi' }, ['hi']]) {
      const { status, body } = await call('POST', db, { body: { areaId: 'a_free', message } });
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_message');
    }
    assert.deepEqual(requests(db), []);
  });

  it('the length cap refuses a 101-character areaId that REALLY EXISTS and is ownerless', async () => {
    // Distinguishing test: with a nonsense over-long id the cap and
    // validateAreaId both answer invalid_area_id, so dropping the cap would be
    // unobservable. This area is live, active and ownerless -- only the cap
    // refuses it, and nothing may be stored.
    const longId = 'a'.repeat(101);
    const db2 = await harness({ seed: (s) => insertArea(s, { id: longId, slug: 'over-cap' }) });
    const post = await call('POST', db2, { body: { areaId: longId } });
    assert.equal(post.status, 400);
    assert.equal(post.body.error, 'invalid_area_id');
    assert.deepEqual(requests(db2), []);
    db2.close();
  });

  it('refuses an archived area and an unknown area with invalid_area_id', async () => {
    for (const areaId of ['a_gone', 'a_never_existed']) {
      const { status, body } = await call('POST', db, { body: { areaId } });
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_area_id');
    }
    assert.deepEqual(requests(db), []);
  });

  it('refuses an area that already HAS an owner with 409, storing nothing', async () => {
    const { status, body } = await call('POST', db, { body: { areaId: 'a_taken' } });
    assert.equal(status, 409);
    assert.equal(body.error, 'area_has_owner');
    assert.deepEqual(requests(db), []);
  });

  it('RE-VOLUNTEERING after a withdrawal reuses the SAME row and resets the decision fields', async () => {
    await call('POST', db, { body: { areaId: 'a_free', message: 'first attempt' } });
    const originalId = requests(db)[0].id;

    // An admin rejects it, stamping the decision fields.
    db._sqlite.prepare(
      "UPDATE area_ownership_request SET status='rejected', decided_at='2026-06-01T00:00:00Z', decided_by='u_lead' WHERE id = ?"
    ).run(originalId);

    const { status, body } = await call('POST', db, { body: { areaId: 'a_free', message: 'second attempt' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, status: 'pending' });

    const rows = requests(db);
    assert.equal(rows.length, 1, 'UNIQUE(area_id, user_id) means one row per member per area, never two');
    assert.equal(rows[0].id, originalId, 'the UPSERT updates the existing row rather than minting a new id');
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].message, 'second attempt', 'excluded.message replaces the old note');
    assert.equal(rows[0].decided_at, null, 'a stale decision must not survive the re-volunteer');
    assert.equal(rows[0].decided_by, null);
  });

  it('two different members may both have a pending request on the same area', async () => {
    await call('POST', db, { body: { areaId: 'a_free' }, who: MEMBER });
    await call('POST', db, { body: { areaId: 'a_free' }, who: MEMBER2 });
    assert.equal(requests(db, MEMBER).length, 1);
    assert.equal(requests(db, MEMBER2).length, 1);
  });

  it('one member may hold pending requests on two different areas', async () => {
    await call('POST', db, { body: { areaId: 'a_free' } });
    await call('POST', db, { body: { areaId: 'a_free2' } });
    assert.deepEqual(requests(db).map(r => r.area_id), ['a_free', 'a_free2']);
  });

  it('500s when the area validation query fails, without storing', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('SELECT 1 FROM action_area WHERE id')) throw new Error('D1 down'); },
    });
    const { status, body } = await call('POST', failing, { body: { areaId: 'a_free' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.deepEqual(requests(failing), []);
    failing.close();
  });

  it('500s when the owner lookup fails, without storing', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('SELECT owner_user_id FROM action_area')) throw new Error('D1 down'); },
    });
    const { status, body } = await call('POST', failing, { body: { areaId: 'a_free' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.deepEqual(requests(failing), []);
    failing.close();
  });

  it('500s when the UPSERT itself fails', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('INSERT INTO area_ownership_request')) throw new Error('D1 down'); },
    });
    const { status, body } = await call('POST', failing, { body: { areaId: 'a_free' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });
});

// ---------------------------------------------------------------------------
// DELETE -- withdrawing a request
// ---------------------------------------------------------------------------

describe('DELETE /api/community/areas/volunteer', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('withdraws a pending request, stamping the status and decided_at', async () => {
    await call('POST', db, { body: { areaId: 'a_free', message: 'pick me' } });
    const { status, body } = await call('DELETE', db, { body: { areaId: 'a_free' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, withdrawn: true });

    const row = requests(db)[0];
    assert.equal(row.status, 'withdrawn');
    assert.ok(row.decided_at, 'decided_at is stamped so the admin queue can order it');
    assert.equal(row.message, 'pick me', 'withdrawal does not erase the note');
  });

  it('withdrawing TWICE reports withdrawn=false the second time and does not change the row again', async () => {
    await call('POST', db, { body: { areaId: 'a_free' } });
    await call('DELETE', db, { body: { areaId: 'a_free' } });
    const firstDecidedAt = requests(db)[0].decided_at;

    const second = await call('DELETE', db, { body: { areaId: 'a_free' } });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true, withdrawn: false });
    assert.equal(requests(db)[0].status, 'withdrawn');
    assert.equal(requests(db)[0].decided_at, firstDecidedAt, 'the second withdrawal must not re-stamp the row');
  });

  it('withdrawing when you never volunteered reports withdrawn=false rather than erroring', async () => {
    const { status, body } = await call('DELETE', db, { body: { areaId: 'a_free' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, withdrawn: false });
    assert.deepEqual(requests(db), []);
  });

  it('withdrawing against an area id that does not exist reports withdrawn=false', async () => {
    const { status, body } = await call('DELETE', db, { body: { areaId: 'a_never_existed' } });
    assert.equal(status, 200);
    assert.equal(body.withdrawn, false);
  });

  it('an APPROVED request cannot be withdrawn: the status filter refuses it', async () => {
    await call('POST', db, { body: { areaId: 'a_free' } });
    db._sqlite.prepare("UPDATE area_ownership_request SET status='approved' WHERE user_id = ?").run(MEMBER);

    const { status, body } = await call('DELETE', db, { body: { areaId: 'a_free' } });
    assert.equal(status, 200);
    assert.equal(body.withdrawn, false);
    assert.equal(requests(db)[0].status, 'approved', 'an approved ownership grant must not be self-revocable here');
  });

  it('withdrawal is scoped to the caller: another member request on the same area survives', async () => {
    await call('POST', db, { body: { areaId: 'a_free' }, who: MEMBER });
    await call('POST', db, { body: { areaId: 'a_free' }, who: MEMBER2 });
    await call('DELETE', db, { body: { areaId: 'a_free' }, who: MEMBER });

    assert.equal(requests(db, MEMBER)[0].status, 'withdrawn');
    assert.equal(requests(db, MEMBER2)[0].status, 'pending', 'one member withdrawing must not touch anybody else');
  });

  it('withdrawal is scoped to the area: a pending request on another area survives', async () => {
    await call('POST', db, { body: { areaId: 'a_free' } });
    await call('POST', db, { body: { areaId: 'a_free2' } });
    await call('DELETE', db, { body: { areaId: 'a_free' } });

    const byArea = Object.fromEntries(requests(db).map(r => [r.area_id, r.status]));
    assert.deepEqual(byArea, { a_free: 'withdrawn', a_free2: 'pending' });
  });

  it('500s when the withdrawal UPDATE fails', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('UPDATE area_ownership_request')) throw new Error('D1 down'); },
    });
    const { status, body } = await call('DELETE', failing, { body: { areaId: 'a_free' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });
});
