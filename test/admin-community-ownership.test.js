/**
 * functions/api/admin/community/ownership.js -- the admin queue that grants
 * ownership of an action area to a volunteer.
 *
 * This is the privilege-granting endpoint of the subsystem. Approving a request
 * writes `action_area.owner_user_id` and `area_membership.role = 'owner'`, and
 * those two columns are what four other endpoints read to decide what a user may
 * do:
 *
 *     action_area.owner_user_id  ->  GET  /api/community/areas          (ownerUserId, ownerName)
 *                                ->  POST /api/community/areas/leave    (owner_cannot_leave)
 *                                ->  POST /api/community/areas/volunteer(area_has_owner)
 *     area_membership.role       ->  GET  /api/community/memberships     (role: 'owner')
 *
 * So a test that stopped at `{ok: true, action: 'approve'}` would prove nothing
 * about whether ownership was actually conferred. Every approval test below
 * finishes by calling those real consumer endpoints, through the real
 * requireMember gate, unstubbed, with a real session cookie and a real
 * subscription row. Stubbing the gate is how you get 100% coverage of a broken
 * gate.
 *
 * Three things this file holds that the endpoint's own responses cannot show:
 *   - the approve path is ATOMIC. The claim UPDATE, the membership, the
 *     decision and the auto-reject of rival requests are one db.batch(), so a
 *     failure anywhere leaves no trace and the request stays retryable. The
 *     claim used to sit outside the batch: a batch failure then left the area
 *     owned with the request still pending, and every retry 409'd forever.
 *   - approve refuses a volunteer whose account is gone, with the same
 *     `owner_user_not_found` the sibling endpoint (admin/community/areas.js
 *     PUT) answers. It used to point owner_user_id at a deleted user.
 *   - the pending queue LEFT JOINs `user`. This queue is the only surface a
 *     pending request appears on, so an inner join made a request whose user
 *     row was deleted undecidable and permanently pending.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, parseResponse } from './_helpers.js';
import { insertSession, insertWixSubscription } from './_d1-sqlite.mjs';
import {
  communityD1, insertUser, insertArea, insertOwnershipRequest, insertAreaMembership,
} from './_community-schema.mjs';

const ownership = await import('../functions/api/admin/community/ownership.js');
const adminAreas = await import('../functions/api/admin/community/areas.js');
const adminMiddleware = await import('../functions/api/admin/_middleware.js');
const communityAreas = await import('../functions/api/community/areas.js');
const communityMemberships = await import('../functions/api/community/memberships.js');
const communityLeave = await import('../functions/api/community/areas/leave.js');
const communityVolunteer = await import('../functions/api/community/areas/volunteer.js');

const SUPER = { id: 'u_super', role: 'superadmin' };
const ADMIN = { id: 'u_admin', role: 'admin' };
const MOD = { id: 'u_mod', role: 'mod' };
const VOLUNTEER = { id: 'u_vol', role: 'member' };
const RIVAL = { id: 'u_rival', role: 'member' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const AREA = 'area_open';

/**
 * Both member fixtures are real STUC members: verified email, an active Wix
 * subscription, and a session cookie. requireMember therefore admits them for
 * real when the consumer endpoints are called.
 */
function seededDb(seed, opts = {}) {
  const db = communityD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: SUPER.id, email: 'super@example.com', role: 'superadmin', name: 'Super' });
      insertUser(sqlite, { id: ADMIN.id, email: 'admin@example.com', role: 'admin', name: 'Admin' });
      insertUser(sqlite, { id: MOD.id, email: 'mod@example.com', role: 'mod', name: 'Mod' });
      insertUser(sqlite, { id: VOLUNTEER.id, email: 'vol@example.com', role: 'member', name: 'Vol Unteer' });
      insertUser(sqlite, { id: RIVAL.id, email: 'rival@example.com', role: 'member', name: 'Rival' });
      insertWixSubscription(sqlite, { email: 'vol@example.com', user_id: VOLUNTEER.id });
      insertWixSubscription(sqlite, { email: 'rival@example.com', user_id: RIVAL.id });
      insertArea(sqlite, { id: AREA, slug: 'open-area', name: 'Open Area', bucket: 'research' });
      if (seed) seed(sqlite);
    },
  });
  return db;
}

async function withSessions(db) {
  await insertSession(db._sqlite, { rawId: 'sess-vol', userId: VOLUNTEER.id, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: 'sess-rival', userId: RIVAL.id, expiresAt: FUTURE });
  return db;
}

function call(handler, { db, user = SUPER, body, rawBody, env, method = 'POST' } = {}) {
  const opts = rawBody !== undefined ? { rawBody } : (body !== undefined ? { body } : {});
  return handler({
    request: mockRequest(method, { url: 'https://rrmacademy.org/api/admin/community/ownership', ...opts }),
    env: env || mockEnv({ DB: db }),
    data: user ? { user } : {},
  });
}

const get = (o) => call(ownership.onRequestGet, { method: 'GET', ...o });
const post = (o) => call(ownership.onRequestPost, o);

const area = (db, id = AREA) => db._sqlite.prepare('SELECT * FROM action_area WHERE id = ?').get(id);
const request = (db, id) => db._sqlite.prepare('SELECT * FROM area_ownership_request WHERE id = ?').get(id);
const rows = (db, sql, ...args) => db._sqlite.prepare(sql).all(...args).map((r) => ({ ...r }));
const memberships = (db, areaId = AREA) =>
  rows(db, 'SELECT user_id, role FROM area_membership WHERE area_id = ? ORDER BY user_id', areaId);

/** Calls a member-gated consumer endpoint with a real session cookie. */
function asMember(handler, { db, cookie, body }) {
  return handler({
    request: mockRequest(body === undefined ? 'GET' : 'POST', {
      url: 'https://rrmacademy.org/api/community/x',
      headers: { Cookie: `session=${cookie}` },
      ...(body === undefined ? {} : { body }),
    }),
    env: mockEnv({ DB: db }),
  });
}

// ---------------------------------------------------------------------------

describe('admin/community/ownership -- authorization', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  const HANDLERS = [
    ['GET', ownership.onRequestGet],
    ['POST', ownership.onRequestPost],
  ];

  for (const [name, handler] of HANDLERS) {
    it(`${name} 401s when no session populated context.data.user`, async () => {
      const { status, body } = await parseResponse(await call(handler, { db, user: null, body: {} }));
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
    });

    it(`${name} 403s an authenticated ORDINARY MEMBER`, async () => {
      // A member may VOLUNTEER for ownership; only staff may grant it. This
      // line is the difference between the two.
      const { status, body } = await parseResponse(await call(handler, {
        db, user: VOLUNTEER, body: { id: 'r1', action: 'approve' },
      }));
      assert.equal(status, 403);
      assert.equal(body.error, 'Forbidden');
    });

    it(`${name} 403s a MOD -- moderators cannot grant area ownership`, async () => {
      const { status } = await parseResponse(await call(handler, {
        db, user: MOD, body: { id: 'r1', action: 'approve' },
      }));
      assert.equal(status, 403);
    });

    it(`${name} lets superadmin and admin past the gate`, async () => {
      for (const user of [SUPER, ADMIN]) {
        const { status } = await parseResponse(await call(handler, { db, user, body: {} }));
        assert.ok(status !== 401 && status !== 403, `${user.role} was refused with ${status}`);
      }
    });

    it(`${name} 503s when the DB binding is absent`, async () => {
      const { status, body } = await parseResponse(await call(handler, {
        env: mockEnv({ DB: undefined }), body: {},
      }));
      assert.equal(status, 503);
      assert.equal(body.error, 'service_unavailable');
    });
  }

  it('a member cannot approve their OWN request even with a real session', async () => {
    // The IDOR shape that matters here: the volunteer owns the request row, so
    // an ownership check keyed on "is this yours" would let them through. The
    // gate is role, not ownership.
    insertOwnershipRequest(db._sqlite, { id: 'r_self', areaId: AREA, userId: VOLUNTEER.id });
    await insertSession(db._sqlite, { rawId: 'sess-vol', userId: VOLUNTEER.id, expiresAt: FUTURE });

    const context = {
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/community/ownership',
        headers: { Cookie: 'session=sess-vol' },
        body: { id: 'r_self', action: 'approve' },
      }),
      env: mockEnv({ DB: db }),
      next: () => ownership.onRequestPost(context),
    };
    const { status, body } = await parseResponse(await adminMiddleware.onRequest(context));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(area(db).owner_user_id, null, 'a member granted themselves ownership');
    assert.equal(request(db, 'r_self').status, 'pending');
  });

  it('OPTIONS preflight answers 204 with the locked-down origin', () => {
    const res = ownership.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ---------------------------------------------------------------------------

describe('GET admin/community/ownership -- the pending queue', () => {
  it('returns an empty list rather than an error when nothing is pending', async () => {
    const db = seededDb();
    const { status, body } = await parseResponse(await get({ db }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, requests: [] });
    db.close();
  });

  it('projects every field the admin UI renders, oldest request first', async () => {
    const db = seededDb((s) => {
      insertOwnershipRequest(s, {
        id: 'r_new', areaId: AREA, userId: RIVAL.id, message: 'Pick me', created_at: '2026-05-02 00:00:00',
      });
      insertOwnershipRequest(s, {
        id: 'r_old', areaId: AREA, userId: VOLUNTEER.id, message: null, created_at: '2026-05-01 00:00:00',
      });
    });
    const { status, body } = await parseResponse(await get({ db }));
    assert.equal(status, 200);
    assert.deepEqual(body.requests.map((r) => r.id), ['r_old', 'r_new'], 'ORDER BY created_at ASC not honoured');
    assert.deepEqual(body.requests[0], {
      id: 'r_old',
      areaId: AREA,
      areaName: 'Open Area',
      areaSlug: 'open-area',
      areaHasOwner: false,
      userId: VOLUNTEER.id,
      userName: 'Vol Unteer',
      userEmail: 'vol@example.com',
      message: null,
      createdAt: '2026-05-01 00:00:00',
    });
    assert.equal(body.requests[1].message, 'Pick me');
    db.close();
  });

  it('reports areaHasOwner true once the area is claimed', async () => {
    const db = seededDb((s) => {
      s.prepare('UPDATE action_area SET owner_user_id = ? WHERE id = ?').run(ADMIN.id, AREA);
      insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id });
    });
    const { body } = await parseResponse(await get({ db }));
    assert.equal(body.requests[0].areaHasOwner, true);
    db.close();
  });

  it('coerces an empty-string message to null', async () => {
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id, message: '' }));
    const { body } = await parseResponse(await get({ db }));
    assert.equal(body.requests[0].message, null);
    db.close();
  });

  it('hides requests that are not pending', async () => {
    const db = seededDb((s) => {
      insertOwnershipRequest(s, { id: 'r_pending', areaId: AREA, userId: VOLUNTEER.id, status: 'pending' });
      insertArea(s, { id: 'a2', slug: 'a-two', name: 'Two', bucket: 'advocacy' });
      insertArea(s, { id: 'a3', slug: 'a-three', name: 'Three', bucket: 'advocacy' });
      insertArea(s, { id: 'a4', slug: 'a-four', name: 'Four', bucket: 'advocacy' });
      insertOwnershipRequest(s, { id: 'r_appr', areaId: 'a2', userId: VOLUNTEER.id, status: 'approved' });
      insertOwnershipRequest(s, { id: 'r_rej', areaId: 'a3', userId: VOLUNTEER.id, status: 'rejected' });
      insertOwnershipRequest(s, { id: 'r_wd', areaId: 'a4', userId: VOLUNTEER.id, status: 'withdrawn' });
    });
    const { body } = await parseResponse(await get({ db }));
    assert.deepEqual(body.requests.map((r) => r.id), ['r_pending']);
    db.close();
  });

  it('hides pending requests whose area has been archived', async () => {
    const db = seededDb((s) => {
      insertArea(s, { id: 'a_dead', slug: 'dead', name: 'Dead', bucket: 'research', status: 'archived' });
      insertOwnershipRequest(s, { id: 'r_live', areaId: AREA, userId: VOLUNTEER.id });
      insertOwnershipRequest(s, { id: 'r_dead', areaId: 'a_dead', userId: RIVAL.id });
    });
    const { body } = await parseResponse(await get({ db }));
    assert.deepEqual(body.requests.map((r) => r.id), ['r_live']);
    db.close();
  });

  it('still lists a request whose user row is gone -- the JOIN to user is LEFT', async () => {
    // The queue is the ONLY surface these rows appear on. An inner join dropped
    // them, so the request could never be decided and stayed pending forever:
    // blocking nothing, visible nowhere, accumulating. It is listed with null
    // name and email, which the admin table already renders as "--".
    const db = seededDb((s) => {
      insertOwnershipRequest(s, { id: 'r_orphan', areaId: AREA, userId: 'u_deleted' });
      insertOwnershipRequest(s, { id: 'r_ok', areaId: AREA, userId: VOLUNTEER.id });
    });
    const { body } = await parseResponse(await get({ db }));
    assert.deepEqual(body.requests.map((r) => r.id).sort(), ['r_ok', 'r_orphan']);
    const orphan = body.requests.find((r) => r.id === 'r_orphan');
    assert.equal(orphan.userId, 'u_deleted', 'the request still names the user it was filed by');
    assert.equal(orphan.userName, null);
    assert.equal(orphan.userEmail, null);
    assert.equal(orphan.areaName, 'Open Area', 'the area side of the join was collateral damage');
    db.close();
  });

  it('a moderator can dismiss the orphaned request, and it leaves the queue', async () => {
    // Surfacing it is only half a fix. Reject touches nothing but
    // area_ownership_request, so it works on a request whose user is gone --
    // which is what makes the row reachable instead of permanently stuck.
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r_orphan', areaId: AREA, userId: 'u_deleted' }));
    assert.deepEqual((await parseResponse(await get({ db }))).body.requests.map((r) => r.id), ['r_orphan'],
      'the moderator cannot dismiss what the queue never shows them');
    const { status } = await parseResponse(await post({ db, body: { id: 'r_orphan', action: 'reject' } }));
    assert.equal(status, 200);
    assert.equal(
      db._sqlite.prepare("SELECT status FROM area_ownership_request WHERE id = 'r_orphan'").get().status,
      'rejected', 'the request could not be cleared',
    );
    assert.deepEqual((await parseResponse(await get({ db }))).body.requests, []);
    db.close();
  });

  it('500s generically, and logs, when the queue query fails', async () => {
    const db = seededDb();
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE area_ownership_request');
    const { status, body } = await parseResponse(await get({ db, env }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('ownership_list_error')));
    assert.ok(!JSON.stringify(body).includes('no such table'), 'SQL error text reached the client');
    db.close();
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/ownership -- request validation', () => {
  let db;
  beforeEach(() => {
    db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
  });

  it('400s invalid_json / invalid_payload', async () => {
    assert.equal((await parseResponse(await post({ db, rawBody: '{' }))).body.error, 'invalid_json');
    for (const raw of ['[]', 'null', '"x"', '1']) {
      assert.equal((await parseResponse(await post({ db, rawBody: raw }))).body.error, 'invalid_payload', raw);
    }
  });

  const BAD = [
    ['id_required', {}],
    ['id_required', { id: '', action: 'approve' }],
    ['id_required', { id: 12, action: 'approve' }],
    ['id_required', { id: 'x'.repeat(101), action: 'approve' }],
    ['invalid_action', { id: 'r1' }],
    ['invalid_action', { id: 'r1', action: 'delete' }],
    ['invalid_action', { id: 'r1', action: 'APPROVE' }],
    ['invalid_action', { id: 'r1', action: true }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const res = await parseResponse(await post({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.equal(area(db).owner_user_id, null, 'a rejected payload still granted ownership');
      assert.equal(request(db, 'r1').status, 'pending');
    });
  }

  it('404s a request id that matches no row', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r_ghost', action: 'approve' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('409s not_pending for a request that was already decided', async () => {
    for (const status of ['approved', 'rejected', 'withdrawn']) {
      const fresh = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id, status }));
      const res = await parseResponse(await post({ db: fresh, body: { id: 'r1', action: 'approve' } }));
      assert.equal(res.status, 409, `status ${status}`);
      assert.equal(res.body.error, 'not_pending');
      assert.equal(area(fresh).owner_user_id, null);
      fresh.close();
    }
  });

  it('500s when the request lookup itself fails', async () => {
    db._sqlite.exec('DROP TABLE area_ownership_request');
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/ownership -- reject', () => {
  let db;
  beforeEach(() => {
    db = seededDb((s) => {
      insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id });
      insertOwnershipRequest(s, { id: 'r2', areaId: AREA, userId: RIVAL.id });
    });
  });

  it('marks the request rejected, stamps the decider, and grants nothing', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r1', action: 'reject' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, action: 'reject' });

    const decided = request(db, 'r1');
    assert.equal(decided.status, 'rejected');
    assert.equal(decided.decided_by, SUPER.id);
    assert.ok(decided.decided_at, 'decided_at was not stamped');

    assert.equal(area(db).owner_user_id, null, 'a rejection granted ownership');
    assert.deepEqual(memberships(db), [], 'a rejection created a membership');
    assert.equal(request(db, 'r2').status, 'pending', 'a rejection decided a sibling request');
  });

  it('attributes the decision to the acting admin, not the volunteer', async () => {
    await parseResponse(await post({ db, user: ADMIN, body: { id: 'r1', action: 'reject' } }));
    assert.equal(request(db, 'r1').decided_by, ADMIN.id);
  });

  it('409s not_pending on a second reject of the same request', async () => {
    assert.equal((await parseResponse(await post({ db, body: { id: 'r1', action: 'reject' } }))).status, 200);
    const replay = await parseResponse(await post({ db, body: { id: 'r1', action: 'reject' } }));
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, 'not_pending');
  });

  it('500s, and logs, when the reject UPDATE fails', async () => {
    // The request lookup has to succeed and the UPDATE has to fail, so the
    // table is dropped between them.
    let fired = false;
    const raced = seededDb(
      (s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }),
      {
        interleave({ sql, db: sqlite }) {
          if (!fired && /UPDATE area_ownership_request\s+SET status = 'rejected'/.test(sql)) {
            fired = true;
            sqlite.exec('DROP TABLE area_ownership_request');
          }
        },
      },
    );
    const events = [];
    const env = mockEnv({ DB: raced });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    const { status, body } = await parseResponse(await post({ db: raced, env, body: { id: 'r1', action: 'reject' } }));
    assert.ok(fired, 'the interleave never fired -- the reject UPDATE shape changed');
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('ownership_decide_error')));
    raced.close();
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/ownership -- approve refusals', () => {
  it('404s when the area referenced by the request has been deleted', async () => {
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: 'area_gone', userId: VOLUNTEER.id }));
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(request(db, 'r1').status, 'pending');
    db.close();
  });

  it('409s area_archived rather than granting ownership of a dead area', async () => {
    const db = seededDb((s) => {
      s.prepare("UPDATE action_area SET status = 'archived' WHERE id = ?").run(AREA);
      insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id });
    });
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'area_archived');
    assert.equal(area(db).owner_user_id, null);
    assert.deepEqual(memberships(db), []);
    db.close();
  });

  it('409s area_already_owned when the area already has an owner', async () => {
    const db = seededDb((s) => {
      s.prepare('UPDATE action_area SET owner_user_id = ? WHERE id = ?').run(ADMIN.id, AREA);
      insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id });
    });
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'area_already_owned');
    assert.equal(area(db).owner_user_id, ADMIN.id, 'an existing owner was displaced');
    db.close();
  });

  it('409s when a concurrent approve claims the area between the SELECT and the UPDATE', async () => {
    // The `WHERE owner_user_id IS NULL` guard on the claim is the real fence;
    // the SELECT above it is only an early exit. This drives the window the
    // fence exists for: the read says ownerless, then someone claims it.
    let fired = false;
    const raced = seededDb(
      (s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }),
      {
        interleave({ sql, db: sqlite }) {
          if (!fired && /UPDATE action_area\s+SET owner_user_id = \?/.test(sql)) {
            fired = true;
            sqlite.prepare('UPDATE action_area SET owner_user_id = ? WHERE id = ?').run(RIVAL.id, AREA);
          }
        },
      },
    );
    const { status, body } = await parseResponse(await post({ db: raced, body: { id: 'r1', action: 'approve' } }));
    assert.ok(fired, 'the interleave never fired -- the claim UPDATE shape changed');
    assert.equal(status, 409);
    assert.equal(body.error, 'area_already_owned');
    assert.equal(area(raced).owner_user_id, RIVAL.id, 'the losing approve overwrote the winner');
    assert.deepEqual(memberships(raced), [], 'the losing approve still wrote an owner membership');
    assert.equal(request(raced, 'r1').status, 'pending', 'the losing request was marked decided');
    raced.close();
  });

  it('500s when the area lookup fails', async () => {
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    db.close();
  });

  it('500s, and logs, when the claim UPDATE fails', async () => {
    let fired = false;
    const raced = seededDb(
      (s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }),
      {
        interleave({ sql, db: sqlite }) {
          if (!fired && /UPDATE action_area\s+SET owner_user_id = \?/.test(sql)) {
            fired = true;
            sqlite.exec('DROP TABLE action_area');
          }
        },
      },
    );
    const events = [];
    const env = mockEnv({ DB: raced });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    const { status, body } = await parseResponse(await post({ db: raced, env, body: { id: 'r1', action: 'approve' } }));
    assert.ok(fired);
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('ownership_decide_error')));
    raced.close();
  });

  it('the approve is atomic -- a failed batch leaves the area ownerless and the request retryable', async () => {
    // The claim UPDATE used to be issued OUTSIDE the batch, so by the time the
    // batch (membership + decision + auto-reject) ran, ownership had already
    // been granted; a throw in the batch answered 500 and rolled back nothing
    // that already landed. The area ended up owned by a user with no owner
    // membership, the request that granted it stayed 'pending', and every retry
    // hit `area_already_owned` -- the request could never be cleared again.
    //
    // The claim now sits inside the same batch, so the 500 leaves no trace.
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE area_membership');

    const { status, body } = await parseResponse(await post({ db, env, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('ownership_decide_error')));

    assert.equal(area(db).owner_user_id, null, 'the 500 still granted ownership');
    assert.equal(request(db, 'r1').status, 'pending', 'the request was decided by a failed approval');

    // The retry reaches the same failure, NOT a 409 on the handler's own
    // half-finished write: once area_membership is back the approval can land.
    const retry = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(retry.status, 500, 'the retry 409d on state the failed approve left behind');
    assert.equal(retry.body.error, 'internal_error');
    db.close();
  });

  it('a retry after the transient failure clears succeeds and grants ownership', async () => {
    // The point of the rollback: nothing about the failed attempt blocks the
    // next one. Same request row, same area, once the batch can run.
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
    // A trigger fails the membership INSERT on a live schema, so the batch
    // throws for a reason that later goes away.
    db._sqlite.exec("CREATE TRIGGER once BEFORE INSERT ON area_membership BEGIN SELECT RAISE(ABORT, 'transient'); END");
    assert.equal((await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }))).status, 500);
    assert.equal(area(db).owner_user_id, null, 'the failed attempt left the claim behind');
    assert.equal(request(db, 'r1').status, 'pending');
    db._sqlite.exec('DROP TRIGGER once');

    const retry = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(retry.status, 200, `the retry was blocked by the failed attempt: ${JSON.stringify(retry.body)}`);
    assert.equal(area(db).owner_user_id, VOLUNTEER.id);
    assert.deepEqual(memberships(db), [{ user_id: VOLUNTEER.id, role: 'owner' }]);
    assert.equal(request(db, 'r1').status, 'approved');
    db.close();
  });

  it('refuses to approve a volunteer whose account is gone, like the areas.js sibling', async () => {
    // areas.js PUT answers 400 owner_user_not_found for exactly this move. This
    // endpoint used to take user_id straight off the request row and write it,
    // so a deleted account ended up owning an area: /api/community/areas
    // rendered ownerName null over a non-null ownerUserId, and nobody could
    // volunteer for the area again because it read as owned.
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
    db._sqlite.prepare('DELETE FROM user WHERE id = ?').run(VOLUNTEER.id);

    const { status, body: refusal } = await parseResponse(await post({ db, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 400, 'approving a deleted volunteer still succeeds');
    assert.equal(refusal.error, 'owner_user_not_found');
    assert.equal(area(db).owner_user_id, null, 'owner_user_id points at a user row that does not exist');
    assert.deepEqual(memberships(db), []);
    assert.equal(request(db, 'r1').status, 'pending', 'the refused request was decided anyway');

    const { body } = await parseResponse(await communityAreas.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/community/areas' }),
      env: mockEnv({ DB: db }),
    }));
    assert.equal(body.areas[0].ownerUserId, null);
    assert.equal(body.areas[0].ownerName, null, 'an area owned by nobody, displayed as owned');

    // The sibling endpoint refuses the same assignment the same way.
    const viaAreas = await parseResponse(await adminAreas.onRequestPut({
      request: mockRequest('PUT', {
        url: 'https://rrmacademy.org/api/admin/community/areas',
        body: { id: AREA, owner_user_id: VOLUNTEER.id },
      }),
      env: mockEnv({ DB: db }),
      data: { user: SUPER },
    }));
    assert.equal(viaAreas.status, 400);
    assert.equal(viaAreas.body.error, 'owner_user_not_found');
    db.close();
  });

  it('500s, and logs, when the volunteer existence check fails', async () => {
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE user');
    const { status, body } = await parseResponse(await post({ db, env, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('ownership_decide_error')));
    assert.equal(area(db).owner_user_id, null, 'the failed check still granted ownership');
    db.close();
  });

  it('500s, and logs, when the approve batch fails for a reason other than a missing table', async () => {
    const db = seededDb((s) => insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: VOLUNTEER.id }));
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    // A CHECK-violating role makes the membership INSERT throw without
    // removing the table, so the batch fails on a live schema.
    db._sqlite.exec("CREATE TRIGGER block_owner BEFORE INSERT ON area_membership BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    const { status, body } = await parseResponse(await post({ db, env, body: { id: 'r1', action: 'approve' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('ownership_decide_error')));
    assert.ok(!JSON.stringify(body).includes('blocked'), 'the raw SQL error reached the client');
    db.close();
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/ownership -- approve, and what it confers', () => {
  let db;
  beforeEach(async () => {
    db = seededDb((s) => {
      insertOwnershipRequest(s, { id: 'r_win', areaId: AREA, userId: VOLUNTEER.id, message: 'I can lead this' });
      insertOwnershipRequest(s, { id: 'r_lose', areaId: AREA, userId: RIVAL.id });
      insertArea(s, { id: 'a_other', slug: 'other', name: 'Other', bucket: 'advocacy' });
      insertOwnershipRequest(s, { id: 'r_elsewhere', areaId: 'a_other', userId: RIVAL.id });
    });
    await withSessions(db);
  });

  it('writes owner_user_id, the owner membership, and the decision in one approval', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, action: 'approve' });

    assert.equal(area(db).owner_user_id, VOLUNTEER.id);
    assert.deepEqual(memberships(db), [{ user_id: VOLUNTEER.id, role: 'owner' }]);

    const won = request(db, 'r_win');
    assert.equal(won.status, 'approved');
    assert.equal(won.decided_by, SUPER.id);
    assert.ok(won.decided_at);
  });

  it('auto-rejects the other pending requests for the SAME area and leaves other areas alone', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const lost = request(db, 'r_lose');
    assert.equal(lost.status, 'rejected');
    assert.equal(lost.decided_by, SUPER.id);
    assert.ok(lost.decided_at);
    assert.equal(request(db, 'r_elsewhere').status, 'pending',
      'a pending request for a different area was auto-rejected');
  });

  it('does not re-decide an already-settled request for the same area', async () => {
    const withSettled = seededDb((s) => {
      insertOwnershipRequest(s, { id: 'r_win', areaId: AREA, userId: VOLUNTEER.id });
      insertOwnershipRequest(s, {
        id: 'r_old', areaId: AREA, userId: RIVAL.id, status: 'withdrawn', decided_at: '2026-01-01 00:00:00',
      });
    });
    await parseResponse(await post({ db: withSettled, body: { id: 'r_win', action: 'approve' } }));
    const old = request(withSettled, 'r_old');
    assert.equal(old.status, 'withdrawn', 'a withdrawn request was flipped to rejected');
    assert.equal(old.decided_at, '2026-01-01 00:00:00');
    withSettled.close();
  });

  it('promotes an existing plain membership rather than failing on the primary key', async () => {
    insertAreaMembership(db._sqlite, { userId: VOLUNTEER.id, areaId: AREA, role: 'member' });
    assert.equal((await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }))).status, 200);
    assert.deepEqual(memberships(db), [{ user_id: VOLUNTEER.id, role: 'owner' }]);
  });

  it('the grant is visible in GET /api/community/areas', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const { body } = await parseResponse(await communityAreas.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/community/areas' }),
      env: mockEnv({ DB: db }),
    }));
    const claimed = body.areas.find((a) => a.id === AREA);
    assert.equal(claimed.ownerUserId, VOLUNTEER.id);
    assert.equal(claimed.ownerName, 'Vol Unteer');
    assert.equal(claimed.memberCount, 1);
  });

  it('the grant is visible to the new owner through the real requireMember gate', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const { status, body } = await parseResponse(
      await asMember(communityMemberships.onRequestGet, { db, cookie: 'sess-vol' }),
    );
    assert.equal(status, 200, `requireMember refused the new owner: ${JSON.stringify(body)}`);
    assert.deepEqual(body.areas, [{ areaId: AREA, role: 'owner' }]);
    assert.deepEqual(body.pendingOwnership, [], 'the approved request is still reported as pending');
  });

  it('the losing rival is no longer told their request is pending', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const { body } = await parseResponse(
      await asMember(communityMemberships.onRequestGet, { db, cookie: 'sess-rival' }),
    );
    assert.deepEqual(body.pendingOwnership, ['a_other'], 'the auto-rejected request still reads as pending');
  });

  it('the new owner can no longer leave the area', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const { status, body } = await parseResponse(await asMember(communityLeave.onRequestPost, {
      db, cookie: 'sess-vol', body: { areaId: AREA },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'owner_cannot_leave');
    assert.deepEqual(memberships(db), [{ user_id: VOLUNTEER.id, role: 'owner' }]);
  });

  it('nobody else can volunteer for the area once it is owned', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const { status, body } = await parseResponse(await asMember(communityVolunteer.onRequestPost, {
      db, cookie: 'sess-rival', body: { areaId: AREA, message: 'Let me try' },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'area_has_owner');
  });

  it('before the approval, the same rival CAN volunteer -- the refusal is caused by the grant', async () => {
    // The control for the test above. Without it, a 409 from any other cause
    // would read as proof that ownership was conferred.
    const { status, body } = await parseResponse(await asMember(communityVolunteer.onRequestPost, {
      db, cookie: 'sess-rival', body: { areaId: AREA, message: 'Let me try' },
    }));
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.status, 'pending');
  });

  it('the approved request leaves the admin queue', async () => {
    await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    const { body } = await parseResponse(await get({ db }));
    assert.deepEqual(body.requests.map((r) => r.id), ['r_elsewhere']);
  });

  it('a replayed approve is refused, and does not double-write', async () => {
    assert.equal((await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }))).status, 200);
    const replay = await parseResponse(await post({ db, body: { id: 'r_win', action: 'approve' } }));
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, 'not_pending');
    assert.equal(area(db).owner_user_id, VOLUNTEER.id);
    assert.deepEqual(memberships(db), [{ user_id: VOLUNTEER.id, role: 'owner' }]);
  });
});
