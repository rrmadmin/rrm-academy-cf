/**
 * The join/leave state machine of the STUC Action Areas hub:
 *
 *   functions/api/community/areas/join.js      POST /api/community/areas/join
 *   functions/api/community/areas/leave.js     POST /api/community/areas/leave
 *   functions/api/community/projects/join.js   POST /api/community/projects/join
 *   functions/api/community/projects/leave.js  POST /api/community/projects/leave
 *
 * TESTED AS ONE MACHINE, NOT FOUR ENDPOINTS
 * Join and leave only mean anything relative to each other, and the failures
 * that matter are sequence failures: a second join that writes a second row, a
 * second leave that errors or resurrects the membership, a leave that removes
 * somebody else's row. So every assertion below reads the STORED area_membership
 * / project_membership rows back out of the database rather than trusting the
 * JSON the handler chose to return. A handler can return {joined:true} while
 * storing nothing, and under a canned mock that is indistinguishable from
 * success -- which is precisely why this file runs on node:sqlite loaded with
 * the committed schema plus the root action-area migrations.
 *
 * The idempotency contracts are also engine-level facts, not code-level ones:
 * `ON CONFLICT(user_id, area_id) DO NOTHING` needs the composite PRIMARY KEY
 * from migrations/025 to fire at all, and `result.meta.changes` is what SQLite
 * reports, not what a fixture declares.
 *
 * THE GATE IS NOT STUBBED
 * requireMember comes from _shared.js unmodified and is exercised through every
 * endpoint. Stubbing it would give 100% coverage of these four files over a gate
 * that could be broken. The member fixture below carries the explicit legacy
 * grandfather label, so the gate resolves it through its real SQL path with no
 * Stripe traffic at all; the outsider fixture is a verified account with no
 * membership of any kind and must be refused by every one of the four.
 *
 * WHAT IS STILL FAKED
 *  - Analytics Engine is the mockEnv stub.
 *  - Each handler's `if (!db) return 503` is DEAD CODE: requireMember reads the
 *    same env.DB one line earlier and answers 500 first. The tests say so and
 *    assert the 500, rather than asserting a 503 these endpoints cannot emit.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { insertUser, insertLabel, insertSession } from './_d1-sqlite.mjs';
import {
  communityD1, insertArea, insertProject, areaMemberships, projectMemberships,
} from './_community-sqlite.mjs';

const areaJoin = await import('../functions/api/community/areas/join.js');
const areaLeave = await import('../functions/api/community/areas/leave.js');
const projectJoin = await import('../functions/api/community/projects/join.js');
const projectLeave = await import('../functions/api/community/projects/leave.js');

const MEMBER = 'u_member';
const MEMBER2 = 'u_member2';
const OUTSIDER = 'u_outsider';
const RAW = { [MEMBER]: 'raw-member', [MEMBER2]: 'raw-member-2', [OUTSIDER]: 'raw-outsider' };
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86400;

/**
 * Two paying members (via the grandfather allowlist, so the gate resolves them
 * without touching Stripe), one authenticated non-member, and a fixed set of
 * areas and projects covering every joinability state.
 */
async function harness({ seed, interleave } = {}) {
  const db = communityD1({
    seed(s) {
      for (const id of [MEMBER, MEMBER2]) {
        insertUser(s, { id, email: `${id}@example.com` });
        insertLabel(s, id, 'STUC Legacy Grandfather');
      }
      insertUser(s, { id: OUTSIDER, email: 'outsider@example.com' });

      insertArea(s, { id: 'a_open', slug: 'open' });
      insertArea(s, { id: 'a_owned', slug: 'owned', owner_user_id: MEMBER });
      insertArea(s, { id: 'a_gone', slug: 'gone', status: 'archived' });

      insertProject(s, { id: 'p_open', slug: 'open-project', areaId: 'a_open' });
      insertProject(s, { id: 'p_owned', slug: 'owned-project', areaId: 'a_open', owner_user_id: MEMBER });
      insertProject(s, { id: 'p_done', slug: 'done-project', areaId: 'a_open', status: 'done' });
      insertProject(s, { id: 'p_arch', slug: 'arch-project', areaId: 'a_open', status: 'archived' });
      insertProject(s, { id: 'p_orphan', slug: 'orphan-project', areaId: 'a_gone' });

      if (seed) seed(s);
    },
    interleave,
  });
  for (const id of [MEMBER, MEMBER2, OUTSIDER]) {
    await insertSession(db._sqlite, { rawId: RAW[id], userId: id, expiresAt: FUTURE });
  }
  return db;
}

/** POSTs a JSON body as `who` (null = anonymous), returns { status, body }. */
async function post(handler, db, { body, rawBody, who = MEMBER, url = 'https://rrmacademy.org/api/community/x' } = {}) {
  const headers = who ? { Cookie: `session=${RAW[who]}` } : {};
  const request = rawBody !== undefined
    ? mockRequest('POST', { rawBody, headers, url })
    : mockRequest('POST', { body, headers, url });
  return parseResponse(await handler({ request, env: mockEnv({ DB: db }), waitUntil: mockWaitUntil() }));
}

const areaRows = (db, user = MEMBER) => areaMemberships(db, user);
const projectRows = (db, user = MEMBER) => projectMemberships(db, user);

// ---------------------------------------------------------------------------
// Shared shape: the gate, the body validators, the OPTIONS preflight
// ---------------------------------------------------------------------------

const SURFACES = [
  { name: 'areas/join', handler: () => areaJoin.onRequestPost, options: () => areaJoin.onRequestOptions, key: 'areaId', bad: 'invalid_area_id', ok: { areaId: 'a_open' } },
  { name: 'areas/leave', handler: () => areaLeave.onRequestPost, options: () => areaLeave.onRequestOptions, key: 'areaId', bad: 'invalid_area_id', ok: { areaId: 'a_open' } },
  { name: 'projects/join', handler: () => projectJoin.onRequestPost, options: () => projectJoin.onRequestOptions, key: 'projectId', bad: 'invalid_project_id', ok: { projectId: 'p_open' } },
  { name: 'projects/leave', handler: () => projectLeave.onRequestPost, options: () => projectLeave.onRequestOptions, key: 'projectId', bad: 'invalid_project_id', ok: { projectId: 'p_open' } },
];

describe('join/leave -- the membership gate is enforced identically on all four', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  for (const s of SURFACES) {
    it(`${s.name} OPTIONS answers 204 with the locked-down CORS origin`, async () => {
      const res = await s.options()();
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
    });

    it(`${s.name} refuses an anonymous caller with 401 and writes nothing`, async () => {
      const { status, body } = await post(s.handler(), db, { body: s.ok, who: null });
      assert.equal(status, 401);
      assert.equal(body.error, 'Not authenticated');
      assert.deepEqual(areaRows(db), []);
      assert.deepEqual(projectRows(db), []);
    });

    it(`${s.name} refuses an authenticated NON-member with 403 and writes nothing`, async () => {
      const { status, body } = await post(s.handler(), db, { body: s.ok, who: OUTSIDER });
      assert.equal(status, 403);
      assert.equal(body.error, 'Membership required');
      assert.deepEqual(areaRows(db, OUTSIDER), []);
      assert.deepEqual(projectRows(db, OUTSIDER), []);
      assert.equal(db._calls.filter(c => /INSERT INTO (area|project)_membership/.test(c.sql)).length, 0);
    });

    it(`${s.name} 400s a malformed JSON body`, async () => {
      const { status, body } = await post(s.handler(), db, { rawBody: '{not json' });
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_json');
    });

    it(`${s.name} 400s a body that is not a JSON object`, async () => {
      for (const rawBody of ['null', '[]', '"a string"', '7']) {
        const { status, body } = await post(s.handler(), db, { rawBody });
        assert.equal(status, 400, `body ${rawBody} should be refused`);
        assert.equal(body.error, 'invalid_payload');
      }
    });

    it(`${s.name} 400s a missing, non-string, empty or over-long ${s.key}`, async () => {
      const cases = [{}, { [s.key]: 42 }, { [s.key]: '' }, { [s.key]: null }, { [s.key]: { id: 'x' } }, { [s.key]: 'x'.repeat(101) }];
      for (const body of cases) {
        const res = await post(s.handler(), db, { body });
        assert.equal(res.status, 400, `${JSON.stringify(body)} should be refused`);
        assert.equal(res.body.error, s.bad);
      }
    });

    it(`${s.name} 500s when the DB binding is absent -- its own 503 branch is unreachable`, async () => {
      // requireMember(request, env) reads the same env.DB one line earlier and
      // answers 500 "Server misconfigured", so the `if (!db) return 503
      // service_unavailable` below it can never run. Asserting 503 here would
      // assert a response this endpoint cannot produce.
      const res = await parseResponse(await s.handler()({
        request: mockRequest('POST', { body: s.ok, headers: { Cookie: `session=${RAW[MEMBER]}` } }),
        env: mockEnv({ DB: undefined }),
        waitUntil: mockWaitUntil(),
      }));
      assert.equal(res.status, 500);
      assert.equal(res.body.error, 'Server misconfigured');
    });
  }

  it('a 100-character id is accepted by the length cap (the bound is inclusive)', async () => {
    const id = 'a'.repeat(100);
    const withLongId = await harness({ seed: (s) => insertArea(s, { id, slug: 'long-id-area' }) });
    const { status, body } = await post(areaJoin.onRequestPost, withLongId, { body: { areaId: id } });
    assert.equal(status, 200);
    assert.equal(body.joined, true);
    assert.deepEqual(areaRows(withLongId).map(r => r.area_id), [id]);
    withLongId.close();
  });

  it('the length cap refuses a 101-character id that REALLY EXISTS, so the cap is doing the work', async () => {
    // Distinguishing test. With a nonsense over-long id the cap and the
    // existence check both answer invalid_area_id, so removing the cap changes
    // nothing observable. Here the row exists and is joinable on every other
    // axis: only the cap can refuse it.
    const longAreaId = 'a'.repeat(101);
    const longProjectId = 'p'.repeat(101);
    const db2 = await harness({
      seed(s) {
        insertArea(s, { id: longAreaId, slug: 'over-cap-area' });
        insertProject(s, { id: longProjectId, slug: 'over-cap-project', areaId: 'a_open' });
      },
    });

    const joinArea = await post(areaJoin.onRequestPost, db2, { body: { areaId: longAreaId } });
    assert.equal(joinArea.status, 400);
    assert.equal(joinArea.body.error, 'invalid_area_id');

    const joinProject = await post(projectJoin.onRequestPost, db2, { body: { projectId: longProjectId } });
    assert.equal(joinProject.status, 400);
    assert.equal(joinProject.body.error, 'invalid_project_id');

    assert.deepEqual(areaRows(db2), [], 'nothing stored despite the area being live and active');
    assert.deepEqual(projectRows(db2), [], 'nothing stored despite the project being live and recruiting');
    db2.close();
  });

  it('the length cap on LEAVE protects an existing over-cap membership row from deletion', async () => {
    const longAreaId = 'a'.repeat(101);
    const longProjectId = 'p'.repeat(101);
    const db2 = await harness({
      seed(s) {
        insertArea(s, { id: longAreaId, slug: 'over-cap-area' });
        insertProject(s, { id: longProjectId, slug: 'over-cap-project', areaId: 'a_open' });
        s.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(MEMBER, longAreaId, 'member');
        s.prepare('INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, ?)').run(MEMBER, longProjectId, 'member');
      },
    });

    assert.equal((await post(areaLeave.onRequestPost, db2, { body: { areaId: longAreaId } })).status, 400);
    assert.equal((await post(projectLeave.onRequestPost, db2, { body: { projectId: longProjectId } })).status, 400);

    assert.deepEqual(areaRows(db2).map(r => r.area_id), [longAreaId], 'a refused request must not have deleted the row');
    assert.deepEqual(projectRows(db2).map(r => r.project_id), [longProjectId]);
    db2.close();
  });
});

// ---------------------------------------------------------------------------
// areas: join -> join -> leave -> leave
// ---------------------------------------------------------------------------

describe('POST /api/community/areas/join', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('stores a membership row at role=member and reports joined', async () => {
    const { status, body } = await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, joined: true, alreadyMember: false });
    assert.deepEqual(areaRows(db), [{ area_id: 'a_open', role: 'member' }]);
  });

  it('a SECOND join is idempotent: alreadyMember, and still exactly ONE stored row', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    const second = await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true, joined: false, alreadyMember: true });
    assert.deepEqual(areaRows(db), [{ area_id: 'a_open', role: 'member' }], 'the double join must not double-write');
  });

  it('a re-join does NOT reset an elevated role back to member', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    db._sqlite.prepare("UPDATE area_membership SET role = 'lead' WHERE user_id = ? AND area_id = ?").run(MEMBER, 'a_open');
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.deepEqual(areaRows(db), [{ area_id: 'a_open', role: 'lead' }], 'DO NOTHING must not clobber the stored role');
  });

  it('two members joining the same area each get their own row', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' }, who: MEMBER });
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' }, who: MEMBER2 });
    assert.deepEqual(areaRows(db, MEMBER).map(r => r.area_id), ['a_open']);
    assert.deepEqual(areaRows(db, MEMBER2).map(r => r.area_id), ['a_open']);
  });

  it('refuses an ARCHIVED area and an unknown area with 400, storing nothing', async () => {
    for (const areaId of ['a_gone', 'a_never_existed']) {
      const { status, body } = await post(areaJoin.onRequestPost, db, { body: { areaId } });
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_area_id');
    }
    assert.deepEqual(areaRows(db), []);
  });

  it('500s when the area validation query fails, without writing', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes("SELECT 1 FROM action_area WHERE id")) throw new Error('D1 down'); },
    });
    const { status, body } = await post(areaJoin.onRequestPost, failing, { body: { areaId: 'a_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.deepEqual(areaRows(failing), []);
    failing.close();
  });

  it('500s when the INSERT itself fails', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('INSERT INTO area_membership')) throw new Error('D1 down'); },
    });
    const { status, body } = await post(areaJoin.onRequestPost, failing, { body: { areaId: 'a_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });

  it('500s from the outer catch when the membership gate itself throws', async () => {
    const failing = await harness({
      interleave({ sql }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) throw new Error('D1 down');
      },
    });
    const { status, body } = await post(areaJoin.onRequestPost, failing, { body: { areaId: 'a_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });
});

describe('POST /api/community/areas/leave', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('removes the stored row after a join', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.equal(areaRows(db).length, 1);
    const { status, body } = await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(areaRows(db), [], 'the membership row must actually be gone');
  });

  it('leaving TWICE is a no-op that neither errors nor resurrects the membership', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } });
    const second = await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true });
    assert.deepEqual(areaRows(db), []);
  });

  it('leaving an area you never joined succeeds and changes nothing', async () => {
    const { status, body } = await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(areaRows(db), []);
  });

  it('leaving an area id that does not exist at all succeeds without a lookup failure', async () => {
    const { status } = await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_never_existed' } });
    assert.equal(status, 200);
  });

  it('leaving is scoped to the caller: another member in the same area keeps their row', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' }, who: MEMBER });
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' }, who: MEMBER2 });
    await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' }, who: MEMBER });
    assert.deepEqual(areaRows(db, MEMBER), []);
    assert.deepEqual(areaRows(db, MEMBER2), [{ area_id: 'a_open', role: 'member' }],
      'one member leaving must not remove anybody else');
  });

  it('the OWNER of an area cannot leave it: 409, and the membership row survives', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_owned' } });
    const { status, body } = await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_owned' } });
    assert.equal(status, 409);
    assert.equal(body.error, 'owner_cannot_leave');
    assert.deepEqual(areaRows(db), [{ area_id: 'a_owned', role: 'member' }],
      'a refused leave must not delete the row anyway');
  });

  it('a NON-owner can leave an owned area', async () => {
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_owned' }, who: MEMBER2 });
    const { status } = await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_owned' }, who: MEMBER2 });
    assert.equal(status, 200);
    assert.deepEqual(areaRows(db, MEMBER2), []);
  });

  it('500s when the owner lookup fails, without deleting anything', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('SELECT owner_user_id FROM action_area')) throw new Error('D1 down'); },
    });
    failing._sqlite.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(MEMBER, 'a_open', 'member');
    const { status, body } = await post(areaLeave.onRequestPost, failing, { body: { areaId: 'a_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.equal(areaRows(failing).length, 1, 'a failed lookup must not fall through to the DELETE');
    failing.close();
  });

  it('500s when the DELETE itself fails', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('DELETE FROM area_membership')) throw new Error('D1 down'); },
    });
    const { status, body } = await post(areaLeave.onRequestPost, failing, { body: { areaId: 'a_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });

  it('500s from the outer catch when the membership gate itself throws', async () => {
    const failing = await harness({
      interleave({ sql }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) throw new Error('D1 down');
      },
    });
    const { status, body } = await post(areaLeave.onRequestPost, failing, { body: { areaId: 'a_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });
});

// ---------------------------------------------------------------------------
// projects: join -> join -> leave -> leave
// ---------------------------------------------------------------------------

describe('POST /api/community/projects/join', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('stores a membership row at role=member and reports joined', async () => {
    const { status, body } = await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, joined: true, alreadyMember: false });
    assert.deepEqual(projectRows(db), [{ project_id: 'p_open', role: 'member' }]);
  });

  it('a SECOND join is idempotent: alreadyMember, and still exactly ONE stored row', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    const second = await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    assert.deepEqual(second.body, { ok: true, joined: false, alreadyMember: true });
    assert.deepEqual(projectRows(db), [{ project_id: 'p_open', role: 'member' }]);
  });

  it('a re-join does NOT reset an elevated role back to member', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    db._sqlite.prepare("UPDATE project_membership SET role = 'owner' WHERE user_id = ? AND project_id = ?").run(MEMBER, 'p_open');
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    assert.deepEqual(projectRows(db), [{ project_id: 'p_open', role: 'owner' }]);
  });

  it('refuses a done, an archived and a missing project with project_not_joinable', async () => {
    for (const projectId of ['p_done', 'p_arch', 'p_never_existed']) {
      const { status, body } = await post(projectJoin.onRequestPost, db, { body: { projectId } });
      assert.equal(status, 400, `${projectId} should not be joinable`);
      assert.equal(body.error, 'project_not_joinable');
    }
    assert.deepEqual(projectRows(db), []);
  });

  it('paused and in_progress projects ARE joinable', async () => {
    const extra = await harness({
      seed(s) {
        insertProject(s, { id: 'p_paused', slug: 'paused-project', areaId: 'a_open', status: 'paused' });
        insertProject(s, { id: 'p_wip', slug: 'wip-project', areaId: 'a_open', status: 'in_progress' });
      },
    });
    for (const projectId of ['p_paused', 'p_wip']) {
      const { status } = await post(projectJoin.onRequestPost, extra, { body: { projectId } });
      assert.equal(status, 200, `${projectId} should be joinable`);
    }
    assert.deepEqual(projectRows(extra).map(r => r.project_id), ['p_paused', 'p_wip']);
    extra.close();
  });

  it('a project under an ARCHIVED area is still joinable by id -- the handler checks only project.status', async () => {
    // Documented, not endorsed. GET /api/community/projects hides p_orphan
    // because it INNER JOINs an active area (G-AREA-7), but join.js looks only
    // at the project row, so a client holding a stale id can still join it. The
    // stored row proves the endpoint's actual behaviour rather than the one the
    // listing endpoint implies.
    const { status, body } = await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_orphan' } });
    assert.equal(status, 200);
    assert.equal(body.joined, true);
    assert.deepEqual(projectRows(db), [{ project_id: 'p_orphan', role: 'member' }]);
  });

  it('500s when the project lookup fails, without writing', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('SELECT id, status FROM project')) throw new Error('D1 down'); },
    });
    const { status, body } = await post(projectJoin.onRequestPost, failing, { body: { projectId: 'p_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.deepEqual(projectRows(failing), []);
    failing.close();
  });

  it('500s when the INSERT itself fails', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('INSERT INTO project_membership')) throw new Error('D1 down'); },
    });
    const { status, body } = await post(projectJoin.onRequestPost, failing, { body: { projectId: 'p_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });

  it('500s from the outer catch when the membership gate itself throws', async () => {
    const failing = await harness({
      interleave({ sql }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) throw new Error('D1 down');
      },
    });
    const { status } = await post(projectJoin.onRequestPost, failing, { body: { projectId: 'p_open' } });
    assert.equal(status, 500);
    failing.close();
  });
});

describe('POST /api/community/projects/leave', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('removes the stored row after a join', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    const { status, body } = await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_open' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.deepEqual(projectRows(db), []);
  });

  it('leaving TWICE is a no-op that neither errors nor resurrects the membership', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_open' } });
    const second = await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_open' } });
    assert.equal(second.status, 200);
    assert.deepEqual(projectRows(db), []);
  });

  it('leaving a project you never joined succeeds and changes nothing', async () => {
    const { status } = await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_open' } });
    assert.equal(status, 200);
    assert.deepEqual(projectRows(db), []);
  });

  it('leaving a project id that does not exist at all succeeds', async () => {
    const { status } = await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_never_existed' } });
    assert.equal(status, 200);
  });

  it('leaving is scoped to the caller: another member in the same project keeps their row', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' }, who: MEMBER });
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' }, who: MEMBER2 });
    await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_open' }, who: MEMBER });
    assert.deepEqual(projectRows(db, MEMBER), []);
    assert.deepEqual(projectRows(db, MEMBER2), [{ project_id: 'p_open', role: 'member' }]);
  });

  it('the OWNER of a project cannot leave it: 409, and the membership row survives', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_owned' } });
    const { status, body } = await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_owned' } });
    assert.equal(status, 409);
    assert.equal(body.error, 'owner_cannot_leave');
    assert.deepEqual(projectRows(db), [{ project_id: 'p_owned', role: 'member' }]);
  });

  it('a NON-owner can leave an owned project', async () => {
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_owned' }, who: MEMBER2 });
    const { status } = await post(projectLeave.onRequestPost, db, { body: { projectId: 'p_owned' }, who: MEMBER2 });
    assert.equal(status, 200);
    assert.deepEqual(projectRows(db, MEMBER2), []);
  });

  it('500s when the owner lookup fails, without deleting anything', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('SELECT owner_user_id FROM project')) throw new Error('D1 down'); },
    });
    failing._sqlite.prepare('INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, ?)').run(MEMBER, 'p_open', 'member');
    const { status, body } = await post(projectLeave.onRequestPost, failing, { body: { projectId: 'p_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.equal(projectRows(failing).length, 1);
    failing.close();
  });

  it('500s when the DELETE itself fails', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('DELETE FROM project_membership')) throw new Error('D1 down'); },
    });
    const { status, body } = await post(projectLeave.onRequestPost, failing, { body: { projectId: 'p_open' } });
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    failing.close();
  });

  it('500s from the outer catch when the membership gate itself throws', async () => {
    const failing = await harness({
      interleave({ sql }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) throw new Error('D1 down');
      },
    });
    const { status } = await post(projectLeave.onRequestPost, failing, { body: { projectId: 'p_open' } });
    assert.equal(status, 500);
    failing.close();
  });
});

// ---------------------------------------------------------------------------
// The machine end to end
// ---------------------------------------------------------------------------

describe('join/leave -- full cycle across areas and projects', () => {
  it('join, re-join, leave, re-leave, re-join lands on exactly one row each time it should', async () => {
    const db = await harness();
    const seq = [];
    const snapshot = () => seq.push(areaRows(db).length);

    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } }); snapshot();
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } }); snapshot();
    await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } }); snapshot();
    await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } }); snapshot();
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } }); snapshot();

    assert.deepEqual(seq, [1, 1, 0, 0, 1]);
    db.close();
  });

  it('area membership and project membership are independent stores', async () => {
    const db = await harness();
    await post(areaJoin.onRequestPost, db, { body: { areaId: 'a_open' } });
    await post(projectJoin.onRequestPost, db, { body: { projectId: 'p_open' } });
    await post(areaLeave.onRequestPost, db, { body: { areaId: 'a_open' } });

    assert.deepEqual(areaRows(db), [], 'left the area');
    assert.deepEqual(projectRows(db), [{ project_id: 'p_open', role: 'member' }],
      'leaving an area must not silently drop project memberships under it');
    db.close();
  });
});
