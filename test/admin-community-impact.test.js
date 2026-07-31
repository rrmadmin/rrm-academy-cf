/**
 * functions/api/admin/community/impact.js -- admin CRUD for impact entries, the
 * dated "here is what this area actually did" ledger.
 *
 * The third sibling of areas.js / projects.js, and the one that quietly plays by
 * different rules. Read with the other two open; each difference below is pinned
 * by a named test because none of them is written down anywhere else:
 *
 *   - PARENT VALIDATION IS WEAKER. projects.js checks its area through
 *     validateAreaId(), which requires status='active'. impact.js runs a bare
 *     `SELECT id FROM action_area WHERE id = ?`, so an impact entry may be filed
 *     against an ARCHIVED area that no longer accepts projects. Its project_id
 *     check is likewise status-blind.
 *   - THE ERROR CODE FOR THE SAME FAILURE DIFFERS. A missing parent area is
 *     `invalid_area_id` from projects.js and `area_not_found` from this file, so
 *     a client cannot handle "bad area" with one branch.
 *   - DELETE IS UNCONDITIONALLY HARD, with no existence pre-check: it leans on
 *     meta.changes for its 404 where both siblings SELECT first.
 *   - PUT DOES NOT STAMP updated_at. That one is CORRECT, not a divergence:
 *     impact_entry has no updated_at column (migrations/025), unlike
 *     action_area and project. Pinned so the next person who "fixes the
 *     inconsistency" gets a failing test instead of a 500 in production.
 *
 * The date field is validated by shape alone (`/^\d{4}-\d{2}-\d{2}$/`), never by
 * calendar validity, which is asserted rather than assumed below.
 *
 * Discipline as elsewhere: authorization proven by refusal, mutations proven by
 * reading the row back.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, parseResponse } from './_helpers.js';
import { insertSession } from './_d1-sqlite.mjs';
import {
  communityD1, insertUser, insertArea, insertProject, insertImpact,
} from './_community-schema.mjs';

const impact = await import('../functions/api/admin/community/impact.js');
const adminProjects = await import('../functions/api/admin/community/projects.js');
const adminMiddleware = await import('../functions/api/admin/_middleware.js');

const SUPER = { id: 'u_super', role: 'superadmin' };
const ADMIN = { id: 'u_admin', role: 'admin' };
const MOD = { id: 'u_mod', role: 'mod' };
const MEMBER = { id: 'u_member', role: 'member' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const AREA = 'area_live';
const DEAD_AREA = 'area_archived';
const PROJECT = 'proj_live';

function seededDb(seed, opts = {}) {
  return communityD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: SUPER.id, email: 'super@example.com', role: 'superadmin', name: 'Super' });
      insertUser(sqlite, { id: ADMIN.id, email: 'admin@example.com', role: 'admin', name: 'Admin' });
      insertUser(sqlite, { id: MOD.id, email: 'mod@example.com', role: 'mod', name: 'Mod' });
      insertUser(sqlite, { id: MEMBER.id, email: 'member@example.com', role: 'member', name: 'Member' });
      insertArea(sqlite, { id: AREA, slug: 'live-area', name: 'Live Area', bucket: 'research' });
      insertArea(sqlite, { id: DEAD_AREA, slug: 'dead-area', name: 'Dead', bucket: 'research', status: 'archived' });
      insertProject(sqlite, { id: PROJECT, areaId: AREA, slug: 'live-project', title: 'Live Project' });
      if (seed) seed(sqlite);
    },
  });
}

function call(handler, { db, user = SUPER, body, rawBody, env } = {}) {
  const opts = rawBody !== undefined ? { rawBody } : (body !== undefined ? { body } : {});
  return handler({
    request: mockRequest('POST', { url: 'https://rrmacademy.org/api/admin/community/impact', ...opts }),
    env: env || mockEnv({ DB: db }),
    data: user ? { user } : {},
  });
}

const post = (o) => call(impact.onRequestPost, o);
const put = (o) => call(impact.onRequestPut, o);
const del = (o) => call(impact.onRequestDelete, o);

const row = (db, id) => db._sqlite.prepare('SELECT * FROM impact_entry WHERE id = ?').get(id);
const count = (db, sql, ...args) => db._sqlite.prepare(sql).get(...args).c;

const VALID = { kind: 'milestone', title: 'Filed the brief', occurred_on: '2026-03-14' };

async function createEntry(db, body) {
  const { status, body: out } = await parseResponse(await post({ db, body }));
  assert.equal(status, 201, `create failed: ${JSON.stringify(out)}`);
  return out.id;
}

// ---------------------------------------------------------------------------

describe('admin/community/impact -- authorization', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  const HANDLERS = [
    ['POST', impact.onRequestPost],
    ['PUT', impact.onRequestPut],
    ['DELETE', impact.onRequestDelete],
  ];

  for (const [name, handler] of HANDLERS) {
    it(`${name} 401s when no session populated context.data.user`, async () => {
      const { status, body } = await parseResponse(await call(handler, { db, user: null, body: {} }));
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
    });

    it(`${name} 403s an authenticated ORDINARY MEMBER, and writes nothing`, async () => {
      const { status, body } = await parseResponse(await call(handler, { db, user: MEMBER, body: VALID }));
      assert.equal(status, 403);
      assert.equal(body.error, 'Forbidden');
      assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 0);
    });

    it(`${name} 403s a MOD`, async () => {
      const { status } = await parseResponse(await call(handler, { db, user: MOD, body: VALID }));
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

  it('refuses a real member session end-to-end through admin/_middleware.js', async () => {
    await insertSession(db._sqlite, { rawId: 'sess-member', userId: MEMBER.id, expiresAt: FUTURE });
    const context = {
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/community/impact',
        headers: { Cookie: 'session=sess-member' },
        body: VALID,
      }),
      env: mockEnv({ DB: db }),
      next: () => impact.onRequestPost(context),
    };
    const { status, body } = await parseResponse(await adminMiddleware.onRequest(context));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 0);
  });

  it('OPTIONS preflight answers 204 with the locked-down origin', () => {
    const res = impact.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/impact -- validation', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  it('400s invalid_json on a body that does not parse', async () => {
    const { status, body } = await parseResponse(await post({ db, rawBody: '{,' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_json');
  });

  it('400s invalid_payload on an array, null, or scalar body', async () => {
    for (const raw of ['[]', 'null', '"str"', '7']) {
      const { status, body } = await parseResponse(await post({ db, rawBody: raw }));
      assert.equal(status, 400, `payload ${raw}`);
      assert.equal(body.error, 'invalid_payload');
    }
  });

  const BAD = [
    ['invalid_kind', {}],
    ['invalid_kind', { kind: 'announcement', title: 'T', occurred_on: '2026-01-01' }],
    ['invalid_kind', { kind: 3, title: 'T', occurred_on: '2026-01-01' }],
    ['title_required', { kind: 'webinar' }],
    ['title_required', { kind: 'webinar', title: 9, occurred_on: '2026-01-01' }],
    ['title_required', { kind: 'webinar', title: '   ', occurred_on: '2026-01-01' }],
    ['title_too_long', { kind: 'webinar', title: 't'.repeat(201), occurred_on: '2026-01-01' }],
    ['occurred_on_required', { kind: 'webinar', title: 'T' }],
    ['occurred_on_required', { kind: 'webinar', title: 'T', occurred_on: 20260101 }],
    ['invalid_occurred_on', { kind: 'webinar', title: 'T', occurred_on: '14/03/2026' }],
    ['invalid_occurred_on', { kind: 'webinar', title: 'T', occurred_on: '2026-3-14' }],
    ['invalid_occurred_on', { kind: 'webinar', title: 'T', occurred_on: '2026-03-14T00:00:00Z' }],
    ['invalid_detail', { ...VALID, detail: 5 }],
    ['detail_too_long', { ...VALID, detail: 'd'.repeat(2001) }],
    ['invalid_area_id', { ...VALID, area_id: 5 }],
    ['invalid_area_id', { ...VALID, area_id: 'a'.repeat(101) }],
    ['invalid_project_id', { ...VALID, project_id: 5 }],
    ['invalid_project_id', { ...VALID, project_id: 'p'.repeat(101) }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const res = await parseResponse(await post({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 0, 'a rejected payload still wrote a row');
    });
  }

  it('accepts every kind the CHECK constraint allows', async () => {
    for (const kind of ['webinar', 'research', 'advocacy', 'legal', 'milestone']) {
      const id = await createEntry(db, { ...VALID, kind });
      assert.equal(row(db, id).kind, kind);
    }
  });

  it('validates occurred_on by SHAPE only -- an impossible calendar date is stored', async () => {
    // ISO_DATE_RE is /^\d{4}-\d{2}-\d{2}$/ with no Date parsing behind it, so
    // month 13 day 45 passes. Pinned as the deployed contract; the impact
    // timeline sorts on this column, and a nonsense value sorts, it does not
    // throw. Worth knowing before anyone treats occurred_on as trustworthy.
    const id = await createEntry(db, { ...VALID, occurred_on: '2026-13-45' });
    assert.equal(row(db, id).occurred_on, '2026-13-45');
  });

  it('400s area_not_found for an area that does not exist', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, area_id: 'area_ghost' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'area_not_found');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 0);
  });

  it('400s project_not_found for a project that does not exist', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, project_id: 'proj_ghost' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'project_not_found');
  });

  it('500s when the area lookup itself fails', async () => {
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, area_id: AREA } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(!JSON.stringify(body).includes('no such table'));
  });

  it('500s when the project lookup itself fails', async () => {
    db._sqlite.exec('DROP TABLE project');
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, project_id: PROJECT } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });

  it('PINS A DIVERGENCE: an ARCHIVED area is accepted here but refused by the projects sibling', async () => {
    // Same column, same database, same request shape, two answers. Both
    // endpoints are exercised in this one test so the divergence is asserted
    // rather than described.
    const id = await createEntry(db, { ...VALID, area_id: DEAD_AREA });
    assert.equal(row(db, id).area_id, DEAD_AREA, 'impact.js accepts an archived parent area');

    const { status, body } = await parseResponse(await adminProjects.onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/community/projects',
        body: { title: 'T', slug: 'blocked', area_id: DEAD_AREA },
      }),
      env: mockEnv({ DB: db }),
      data: { user: SUPER },
    }));
    assert.equal(status, 400, 'projects.js accepted an archived parent area');
    assert.equal(body.error, 'invalid_area_id',
      'and it names the same failure differently from impact.js area_not_found');
  });

  it('PINS A DIVERGENCE: an ARCHIVED project is accepted as a parent', async () => {
    db._sqlite.prepare("UPDATE project SET status = 'archived' WHERE id = ?").run(PROJECT);
    const id = await createEntry(db, { ...VALID, project_id: PROJECT });
    assert.equal(row(db, id).project_id, PROJECT);
  });
});

describe('POST admin/community/impact -- the row it writes', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  it('stores every field, trims the title, and attributes created_by to the SESSION user', async () => {
    const id = await createEntry(db, {
      kind: 'legal',
      title: '  Amicus filed  ',
      occurred_on: '2026-03-14',
      detail: 'Full detail',
      area_id: AREA,
      project_id: PROJECT,
    });
    const stored = row(db, id);
    assert.equal(stored.kind, 'legal');
    assert.equal(stored.title, 'Amicus filed');
    assert.equal(stored.occurred_on, '2026-03-14');
    assert.equal(stored.detail, 'Full detail');
    assert.equal(stored.area_id, AREA);
    assert.equal(stored.project_id, PROJECT);
    assert.equal(stored.created_by, SUPER.id);
  });

  it('ignores a created_by supplied in the body -- attribution comes from the session', async () => {
    // Rule 9: an identity column is bound from context.data.user, never from
    // the request. A body that names someone else must not be able to forge
    // authorship of an impact record.
    const id = await createEntry(db, { ...VALID, created_by: MEMBER.id, id: 'caller-chosen' });
    assert.equal(row(db, id).created_by, SUPER.id, 'created_by was taken from the request body');
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(row(db, 'caller-chosen'), undefined, 'the caller chose the primary key');
  });

  it('defaults detail, area_id and project_id to NULL', async () => {
    const stored = row(db, await createEntry(db, VALID));
    assert.equal(stored.detail, null);
    assert.equal(stored.area_id, null);
    assert.equal(stored.project_id, null);
  });

  it('stores explicit nulls as NULL', async () => {
    const stored = row(db, await createEntry(db, { ...VALID, detail: null, area_id: null, project_id: null }));
    assert.equal(stored.detail, null);
    assert.equal(stored.area_id, null);
    assert.equal(stored.project_id, null);
  });

  it('500s generically, and logs, when the insert fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE impact_entry');
    const { status, body } = await parseResponse(await post({ db, env, body: VALID }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('impact_create_error')));
    assert.ok(!JSON.stringify(body).includes('no such table'));
  });
});

// ---------------------------------------------------------------------------

describe('PUT admin/community/impact', () => {
  let db;
  const E = 'i1';
  beforeEach(() => {
    db = seededDb((s) => {
      insertImpact(s, {
        id: E, areaId: AREA, projectId: PROJECT, kind: 'webinar',
        title: 'Original', detail: 'orig detail', occurred_on: '2026-01-01', created_by: ADMIN.id,
      });
    });
  });

  it('400s invalid_json / invalid_payload before touching the database', async () => {
    assert.equal((await parseResponse(await put({ db, rawBody: ':' }))).body.error, 'invalid_json');
    assert.equal((await parseResponse(await put({ db, rawBody: '[]' }))).body.error, 'invalid_payload');
  });

  const BAD = [
    ['id_required', {}],
    ['id_required', { id: 1 }],
    ['id_required', { id: 'x'.repeat(101) }],
    ['invalid_kind', { id: 'i1', kind: 'newsletter' }],
    ['title_required', { id: 'i1', title: 4 }],
    ['title_required', { id: 'i1', title: ' ' }],
    ['title_too_long', { id: 'i1', title: 't'.repeat(201) }],
    ['invalid_occurred_on', { id: 'i1', occurred_on: 5 }],
    ['invalid_occurred_on', { id: 'i1', occurred_on: 'March 2026' }],
    ['invalid_detail', { id: 'i1', detail: 6 }],
    ['detail_too_long', { id: 'i1', detail: 'd'.repeat(2001) }],
    ['invalid_area_id', { id: 'i1', area_id: 6 }],
    ['invalid_area_id', { id: 'i1', area_id: 'a'.repeat(101) }],
    ['invalid_project_id', { id: 'i1', project_id: 6 }],
    ['invalid_project_id', { id: 'i1', project_id: 'p'.repeat(101) }],
    ['no_fields_provided', { id: 'i1' }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const before = row(db, E);
      const res = await parseResponse(await put({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.deepEqual(row(db, E), before, 'a rejected update still mutated the row');
    });
  }

  it('updates only the fields present in the body', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: E, title: '  Revised  ' } }))).status, 200);
    const stored = row(db, E);
    assert.equal(stored.title, 'Revised');
    assert.equal(stored.kind, 'webinar', 'an absent kind was rewritten');
    assert.equal(stored.detail, 'orig detail', 'an absent detail was rewritten');
    assert.equal(stored.occurred_on, '2026-01-01');
  });

  it('writes every settable column in one request', async () => {
    assert.equal((await parseResponse(await put({
      db,
      body: {
        id: E, kind: 'advocacy', title: 'New title', occurred_on: '2026-06-30',
        detail: 'New detail', area_id: DEAD_AREA, project_id: PROJECT,
      },
    }))).status, 200);
    const stored = row(db, E);
    assert.equal(stored.kind, 'advocacy');
    assert.equal(stored.title, 'New title');
    assert.equal(stored.occurred_on, '2026-06-30');
    assert.equal(stored.detail, 'New detail');
    assert.equal(stored.area_id, DEAD_AREA);
    assert.equal(stored.project_id, PROJECT);
  });

  it('detaches the entry from its parents on explicit nulls', async () => {
    assert.equal((await parseResponse(await put({
      db, body: { id: E, detail: null, area_id: null, project_id: null },
    }))).status, 200);
    const stored = row(db, E);
    assert.equal(stored.detail, null);
    assert.equal(stored.area_id, null);
    assert.equal(stored.project_id, null);
  });

  it('never rewrites created_by, even when the body asks', async () => {
    await parseResponse(await put({ db, body: { id: E, title: 'Reassigned', created_by: SUPER.id } }));
    assert.equal(row(db, E).created_by, ADMIN.id, 'authorship was rewritten from the request body');
  });

  it('400s area_not_found / project_not_found rather than storing a dangling parent', async () => {
    for (const [field, value, error] of [
      ['area_id', 'area_ghost', 'area_not_found'],
      ['project_id', 'proj_ghost', 'project_not_found'],
    ]) {
      const { status, body } = await parseResponse(await put({ db, body: { id: E, [field]: value } }));
      assert.equal(status, 400);
      assert.equal(body.error, error);
    }
    assert.equal(row(db, E).area_id, AREA);
    assert.equal(row(db, E).project_id, PROJECT);
  });

  it('500s when the area or project lookup on update fails', async () => {
    const areaDb = seededDb((s) => insertImpact(s, { id: E, areaId: AREA, title: 'x' }));
    areaDb._sqlite.exec('DROP TABLE action_area');
    assert.equal((await parseResponse(await put({ db: areaDb, body: { id: E, area_id: AREA } }))).status, 500);
    areaDb.close();

    const projDb = seededDb((s) => insertImpact(s, { id: E, areaId: AREA, title: 'x' }));
    projDb._sqlite.exec('DROP TABLE project');
    assert.equal((await parseResponse(await put({ db: projDb, body: { id: E, project_id: PROJECT } }))).status, 500);
    projDb.close();
  });

  it('404s an id that matches no entry', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: 'i_missing', title: 'Ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 1);
  });

  it('500s generically, and logs, when the UPDATE fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE impact_entry');
    const { status, body } = await parseResponse(await put({ db, env, body: { id: E, title: 'Boom' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('impact_update_error')));
  });

  it('does NOT stamp updated_at, because impact_entry has no such column', async () => {
    // Correct behaviour, not an omission: both siblings append
    // `updated_at = datetime('now')` to their SET list, and doing that here
    // would be a "no such column" 500 on every update. Asserted against the
    // schema itself so the reason survives the next consistency sweep.
    const columns = db._sqlite.prepare("SELECT name FROM pragma_table_info('impact_entry')").all().map((r) => r.name);
    assert.ok(columns.includes('created_at'));
    assert.ok(!columns.includes('updated_at'), 'impact_entry gained updated_at; the PUT should now stamp it');
    assert.equal((await parseResponse(await put({ db, body: { id: E, title: 'Fine' } }))).status, 200);
  });
});

// ---------------------------------------------------------------------------

describe('DELETE admin/community/impact', () => {
  let db;
  const E = 'i1';
  beforeEach(() => {
    db = seededDb((s) => {
      insertImpact(s, { id: E, areaId: AREA, projectId: PROJECT, title: 'Doomed' });
      insertImpact(s, { id: 'i2', areaId: AREA, title: 'Survivor' });
    });
  });

  it('400s invalid_json / invalid_payload / id_required', async () => {
    assert.equal((await parseResponse(await del({ db, rawBody: '#' }))).body.error, 'invalid_json');
    assert.equal((await parseResponse(await del({ db, rawBody: 'null' }))).body.error, 'invalid_payload');
    for (const body of [{}, { id: 2 }, { id: 'x'.repeat(101) }]) {
      const res = await parseResponse(await del({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'id_required');
    }
    assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 2);
  });

  it('hard-deletes the entry and leaves its siblings and parents intact', async () => {
    // The endpoint documents itself as always-hard because impact entries have
    // no children. That claim is what is checked: the parents must survive.
    const { status, body } = await parseResponse(await del({ db, body: { id: E } }));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(row(db, E), undefined);
    assert.ok(row(db, 'i2'), 'a sibling entry was deleted');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM action_area WHERE id = ?', AREA), 1, 'the parent area was deleted');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project WHERE id = ?', PROJECT), 1, 'the parent project was deleted');
  });

  it('404s an id that matches no entry, with no existence pre-check to distinguish it', async () => {
    // Both siblings SELECT first and answer 404 from that. This one issues the
    // DELETE and reads meta.changes, which reaches the same answer with one
    // fewer round trip. Pinned because the observable contract must match.
    const { status, body } = await parseResponse(await del({ db, body: { id: 'i_missing' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 2);
  });

  it('deleting the same entry twice is a 200 then a 404, not two 200s', async () => {
    assert.equal((await parseResponse(await del({ db, body: { id: E } }))).status, 200);
    assert.equal((await parseResponse(await del({ db, body: { id: E } }))).status, 404);
  });

  it('500s generically, and logs, when the DELETE fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE impact_entry');
    const { status, body } = await parseResponse(await del({ db, env, body: { id: E } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('impact_delete_error')));
    assert.ok(!JSON.stringify(body).includes('no such table'));
  });
});
