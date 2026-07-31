/**
 * functions/api/admin/community/projects.js -- admin CRUD for the projects
 * that live inside an action area.
 *
 * Read alongside test/admin-community-areas.test.js: these two endpoints are
 * near-identical twins (the same 22-line slugify, the same RESERVED_SLUGS set,
 * the same owner/membership batch, the same catch-UNIQUE-as-409), and the
 * places they DIVERGE are where the bugs are. Each divergence this file found is
 * pinned by a named test rather than left to a reviewer to notice:
 *
 *   - parent validation: a project may only be created in an ACTIVE area
 *     (validateAreaId filters status='active'), while the third sibling,
 *     impact.js, accepts an archived area for the same column;
 *   - hard delete: this endpoint PRESERVES impact entries by NULLing
 *     impact_entry.project_id, while areas.js DELETES impact rows outright;
 *   - soft delete: this endpoint re-checks meta.changes after an existence
 *     check that already passed, which is dead code on any single request and
 *     a genuine race fence on two. The test drives the race.
 *
 * Everything else follows the discipline stated in the areas test header:
 * authorization is proven by REFUSAL, mutations are proven by reading the row
 * back, and DELETE is proven by what happened to the children, because foreign
 * keys are disabled to match D1.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, parseResponse } from './_helpers.js';
import { insertSession } from './_d1-sqlite.mjs';
import {
  communityD1, insertUser, insertArea, insertProject, insertImpact, insertProjectMembership,
} from './_community-schema.mjs';

const projects = await import('../functions/api/admin/community/projects.js');
const adminMiddleware = await import('../functions/api/admin/_middleware.js');
const communityProjects = await import('../functions/api/community/projects.js');

const SUPER = { id: 'u_super', role: 'superadmin' };
const ADMIN = { id: 'u_admin', role: 'admin' };
const MOD = { id: 'u_mod', role: 'mod' };
const MEMBER = { id: 'u_member', role: 'member' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

const AREA = 'area_live';
const DEAD_AREA = 'area_archived';

function seededDb(seed, opts = {}) {
  return communityD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: SUPER.id, email: 'super@example.com', role: 'superadmin', name: 'Super' });
      insertUser(sqlite, { id: ADMIN.id, email: 'admin@example.com', role: 'admin', name: 'Admin' });
      insertUser(sqlite, { id: MOD.id, email: 'mod@example.com', role: 'mod', name: 'Mod' });
      insertUser(sqlite, { id: MEMBER.id, email: 'member@example.com', role: 'member', name: 'Member' });
      insertArea(sqlite, { id: AREA, slug: 'live-area', name: 'Live Area', bucket: 'research' });
      insertArea(sqlite, { id: DEAD_AREA, slug: 'dead-area', name: 'Dead Area', bucket: 'research', status: 'archived' });
      if (seed) seed(sqlite);
    },
  });
}

function call(handler, { db, user = SUPER, body, rawBody, env } = {}) {
  const opts = rawBody !== undefined ? { rawBody } : (body !== undefined ? { body } : {});
  return handler({
    request: mockRequest('POST', { url: 'https://rrmacademy.org/api/admin/community/projects', ...opts }),
    env: env || mockEnv({ DB: db }),
    data: user ? { user } : {},
  });
}

const post = (o) => call(projects.onRequestPost, o);
const put = (o) => call(projects.onRequestPut, o);
const del = (o) => call(projects.onRequestDelete, o);

const row = (db, id) => db._sqlite.prepare('SELECT * FROM project WHERE id = ?').get(id);
const rows = (db, sql, ...args) => db._sqlite.prepare(sql).all(...args).map((r) => ({ ...r }));
const memberships = (db, projectId) =>
  rows(db, 'SELECT user_id, role FROM project_membership WHERE project_id = ? ORDER BY user_id', projectId);
const count = (db, sql, ...args) => db._sqlite.prepare(sql).get(...args).c;

const VALID = { title: 'A Project', slug: 'a-project', area_id: AREA };

async function createProject(db, body) {
  const { status, body: out } = await parseResponse(await post({ db, body }));
  assert.equal(status, 201, `create failed: ${JSON.stringify(out)}`);
  return out.id;
}

// ---------------------------------------------------------------------------

describe('admin/community/projects -- authorization', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  const HANDLERS = [
    ['POST', projects.onRequestPost],
    ['PUT', projects.onRequestPut],
    ['DELETE', projects.onRequestDelete],
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
      assert.equal(count(db, 'SELECT COUNT(*) c FROM project'), 0);
    });

    it(`${name} 403s a MOD -- staff for requireMember, not staff for admin CRUD`, async () => {
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
        url: 'https://rrmacademy.org/api/admin/community/projects',
        headers: { Cookie: 'session=sess-member' },
        body: VALID,
      }),
      env: mockEnv({ DB: db }),
      next: () => projects.onRequestPost(context),
    };
    const { status, body } = await parseResponse(await adminMiddleware.onRequest(context));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project'), 0);
  });

  it('OPTIONS preflight answers 204 with the locked-down origin', () => {
    const res = projects.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/projects -- validation', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  it('400s invalid_json on a body that does not parse', async () => {
    const { status, body } = await parseResponse(await post({ db, rawBody: '{oops' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_json');
  });

  it('400s invalid_payload on an array, null, or scalar body', async () => {
    for (const payload of [[], null, '"str"', '3']) {
      const raw = Array.isArray(payload) ? '[]' : payload === null ? 'null' : payload;
      const { status, body } = await parseResponse(await post({ db, rawBody: raw }));
      assert.equal(status, 400, `payload ${raw}`);
      assert.equal(body.error, 'invalid_payload');
    }
  });

  const BAD = [
    ['title_required', {}],
    ['title_required', { title: 12, slug: 's', area_id: AREA }],
    ['title_required', { title: '\t \n', slug: 's', area_id: AREA }],
    ['title_too_long', { title: 't'.repeat(201), slug: 's', area_id: AREA }],
    ['slug_required', { title: 'T' }],
    ['slug_required', { title: 'T', slug: false }],
    ['invalid_slug', { title: 'T', slug: '###', area_id: AREA }],
    ['slug_reserved', { title: 'T', slug: 'areas', area_id: AREA }],
    ['slug_reserved', { title: 'T', slug: 'post', area_id: AREA }],
    ['area_id_required', { title: 'T', slug: 's' }],
    ['area_id_required', { title: 'T', slug: 's', area_id: 5 }],
    ['area_id_required', { title: 'T', slug: 's', area_id: 'a'.repeat(101) }],
    ['invalid_status', { ...VALID, status: 'shipped' }],
    ['invalid_summary', { ...VALID, summary: 3 }],
    ['summary_too_long', { ...VALID, summary: 's'.repeat(501) }],
    ['invalid_description', { ...VALID, description: [] }],
    ['description_too_long', { ...VALID, description: 'd'.repeat(5001) }],
    ['invalid_sort_order', { ...VALID, sort_order: '2' }],
    ['invalid_workspace_url', { ...VALID, workspace_url: 42 }],
    ['workspace_url_too_long', { ...VALID, workspace_url: `https://x.test/${'p'.repeat(2000)}` }],
    ['invalid_owner_user_id', { ...VALID, owner_user_id: {} }],
    ['invalid_owner_user_id', { ...VALID, owner_user_id: 'u'.repeat(101) }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const res = await parseResponse(await post({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.equal(count(db, 'SELECT COUNT(*) c FROM project'), 0, 'a rejected payload still wrote a row');
    });
  }

  it('400s invalid_area_id for an area that does not exist', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, area_id: 'area_ghost' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_area_id');
  });

  it('400s invalid_area_id for an ARCHIVED area -- validateAreaId filters status=active', async () => {
    // The contrast that matters: admin/community/impact.js validates the same
    // column with a bare `SELECT id FROM action_area WHERE id = ?` and will
    // happily attach to this archived area. Two siblings, same foreign key,
    // different rule.
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, area_id: DEAD_AREA } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_area_id');
  });

  it('500s when the area lookup itself fails', async () => {
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await post({ db, body: VALID }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(!JSON.stringify(body).includes('no such table'));
  });

  it('rejects every workspace_url scheme that is not http or https', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://files.test/x', 'not a url', '//evil.test']) {
      const { status, body } = await parseResponse(await post({
        db, body: { ...VALID, slug: `s-${Math.random().toString(36).slice(2)}`, workspace_url: url },
      }));
      assert.equal(status, 400, `accepted ${url}`);
      assert.equal(body.error, 'invalid_workspace_url');
    }
  });

  it('accepts an http and an https workspace_url', async () => {
    for (const [i, url] of ['http://notion.test/board', 'https://notion.test/board'].entries()) {
      const id = await createProject(db, { ...VALID, slug: `ws-${i}`, workspace_url: url });
      assert.equal(row(db, id).workspace_url, url);
    }
  });

  it('400s owner_user_not_found rather than storing a dangling owner', async () => {
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, owner_user_id: 'u_ghost' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'owner_user_not_found');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project'), 0);
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project_membership'), 0);
  });

  it('500s when the owner lookup itself fails', async () => {
    db._sqlite.exec('DROP TABLE user');
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, owner_user_id: MEMBER.id } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });
});

describe('POST admin/community/projects -- the row it writes', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  it('stores every field, trims the title, slugifies the slug', async () => {
    const id = await createProject(db, {
      title: '  Registry Build  ',
      slug: 'Registry   BUILD!',
      area_id: AREA,
      status: 'in_progress',
      summary: 'A summary',
      description: 'A description',
      workspace_url: 'https://workspace.test/x',
      pinned: true,
      sort_order: 4,
    });
    const stored = row(db, id);
    assert.equal(stored.title, 'Registry Build');
    assert.equal(stored.slug, 'registry-build');
    assert.equal(stored.area_id, AREA);
    assert.equal(stored.status, 'in_progress');
    assert.equal(stored.summary, 'A summary');
    assert.equal(stored.description, 'A description');
    assert.equal(stored.workspace_url, 'https://workspace.test/x');
    assert.equal(stored.pinned, 1);
    assert.equal(stored.sort_order, 4);
  });

  it('defaults status to recruiting, pinned to 0, sort_order to 0 and the rest to NULL', async () => {
    const stored = row(db, await createProject(db, VALID));
    assert.equal(stored.status, 'recruiting');
    assert.equal(stored.pinned, 0);
    assert.equal(stored.sort_order, 0);
    assert.equal(stored.summary, null);
    assert.equal(stored.description, null);
    assert.equal(stored.workspace_url, null);
    assert.equal(stored.owner_user_id, null);
  });

  it('stores explicit nulls, and a null sort_order becomes 0', async () => {
    const stored = row(db, await createProject(db, {
      ...VALID, slug: 'nulls', summary: null, description: null,
      workspace_url: null, owner_user_id: null, sort_order: null,
    }));
    assert.equal(stored.summary, null);
    assert.equal(stored.description, null);
    assert.equal(stored.workspace_url, null);
    assert.equal(stored.sort_order, 0);
  });

  it('accepts every status the CHECK constraint allows', async () => {
    for (const status of ['recruiting', 'in_progress', 'paused', 'done', 'archived']) {
      const id = await createProject(db, { ...VALID, slug: `st-${status}`, status });
      assert.equal(row(db, id).status, status);
    }
  });

  it('coerces any truthy pinned value to 1 and any falsy one to 0', async () => {
    assert.equal(row(db, await createProject(db, { ...VALID, slug: 'p-a', pinned: 'yes' })).pinned, 1);
    assert.equal(row(db, await createProject(db, { ...VALID, slug: 'p-b', pinned: 0 })).pinned, 0);
    assert.equal(row(db, await createProject(db, { ...VALID, slug: 'p-c', pinned: null })).pinned, 0);
  });

  it('mints a 32-hex id rather than accepting one from the body', async () => {
    const { body } = await parseResponse(await post({ db, body: { ...VALID, id: 'chosen-by-caller' } }));
    assert.match(body.id, /^[0-9a-f]{32}$/);
    assert.equal(row(db, 'chosen-by-caller'), undefined);
  });

  it('creates the owner membership row alongside the project', async () => {
    const id = await createProject(db, { ...VALID, owner_user_id: MEMBER.id });
    assert.equal(row(db, id).owner_user_id, MEMBER.id);
    assert.deepEqual(memberships(db, id), [{ user_id: MEMBER.id, role: 'owner' }]);
  });

  it('the create-path membership upsert PROMOTES a colliding row, the only state its ON CONFLICT can reach', async () => {
    // Same construction as the areas twin, for the same reason: the project id
    // is minted inside the request, so on create the ON CONFLICT clause is
    // unreachable defensive code and DO NOTHING would be indistinguishable
    // from DO UPDATE without scripting the collision.
    let mintedId = null;
    const raced = seededDb(undefined, {
      interleave({ sql, bindings, db: sqlite }) {
        if (/^INSERT INTO project\(/.test(sql)) mintedId = bindings[0];
        if (mintedId && /^\s*INSERT INTO project_membership/.test(sql)) {
          sqlite.prepare("INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, 'member')")
            .run(MEMBER.id, mintedId);
        }
      },
    });
    const id = await createProject(raced, { ...VALID, owner_user_id: MEMBER.id });
    assert.equal(id, mintedId, 'the interleave never observed the minted id');
    assert.deepEqual(memberships(raced, id), [{ user_id: MEMBER.id, role: 'owner' }],
      'the create-path ON CONFLICT left the colliding row at role=member');
    raced.close();
  });

  it('409s slug_already_exists on a duplicate slug, case-insensitively', async () => {
    await createProject(db, VALID);
    const { status, body } = await parseResponse(await post({ db, body: { ...VALID, slug: 'A-PROJECT' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project'), 1);
  });

  it('500s generically, and logs, when the insert fails for any other reason', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE project');
    const { status, body } = await parseResponse(await post({ db, env, body: VALID }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('project_create_error')));
    assert.ok(!JSON.stringify(body).includes('no such table'));
  });

  it('the new project is immediately visible to GET /api/community/projects', async () => {
    // The consumer, not the handler's own return value. This is the query the
    // hub renders from, and it INNER JOINs action_area, so a project written
    // with a bad area_id would silently vanish from the product.
    const id = await createProject(db, { ...VALID, summary: 'Visible' });
    const { status, body } = await parseResponse(await communityProjects.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/community/projects' }),
      env: mockEnv({ DB: db }),
    }));
    assert.equal(status, 200);
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].id, id);
    assert.equal(body.projects[0].areaSlug, 'live-area');
    assert.equal(body.projects[0].summary, 'Visible');
  });
});

// ---------------------------------------------------------------------------

describe('PUT admin/community/projects', () => {
  let db;
  const P = 'p1';
  beforeEach(() => {
    db = seededDb((s) => {
      insertProject(s, { id: P, areaId: AREA, slug: 'alpha', title: 'Alpha', summary: 'old', sort_order: 1 });
      insertProject(s, { id: 'p2', areaId: AREA, slug: 'beta', title: 'Beta' });
    });
  });

  it('400s invalid_json / invalid_payload before touching the database', async () => {
    assert.equal((await parseResponse(await put({ db, rawBody: '}' }))).body.error, 'invalid_json');
    assert.equal((await parseResponse(await put({ db, rawBody: '[1]' }))).body.error, 'invalid_payload');
  });

  const BAD = [
    ['id_required', {}],
    ['id_required', { id: 0 }],
    ['id_required', { id: 'x'.repeat(101) }],
    ['title_required', { id: 'p1', title: 5 }],
    ['title_required', { id: 'p1', title: '   ' }],
    ['title_too_long', { id: 'p1', title: 't'.repeat(201) }],
    ['invalid_slug', { id: 'p1', slug: 5 }],
    ['invalid_slug', { id: 'p1', slug: '@@@' }],
    ['slug_reserved', { id: 'p1', slug: 'events' }],
    ['invalid_area_id', { id: 'p1', area_id: '' }],
    ['invalid_area_id', { id: 'p1', area_id: 7 }],
    ['invalid_area_id', { id: 'p1', area_id: 'a'.repeat(101) }],
    ['invalid_status', { id: 'p1', status: 'cancelled' }],
    ['invalid_summary', { id: 'p1', summary: 1 }],
    ['summary_too_long', { id: 'p1', summary: 's'.repeat(501) }],
    ['invalid_description', { id: 'p1', description: 1 }],
    ['description_too_long', { id: 'p1', description: 'd'.repeat(5001) }],
    ['invalid_workspace_url', { id: 'p1', workspace_url: 1 }],
    ['workspace_url_too_long', { id: 'p1', workspace_url: `https://x.test/${'p'.repeat(2000)}` }],
    ['invalid_workspace_url', { id: 'p1', workspace_url: 'javascript:alert(1)' }],
    ['invalid_owner_user_id', { id: 'p1', owner_user_id: 1 }],
    ['invalid_owner_user_id', { id: 'p1', owner_user_id: 'u'.repeat(101) }],
    ['invalid_sort_order', { id: 'p1', sort_order: 'first' }],
    ['no_fields_provided', { id: 'p1' }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const before = row(db, P);
      const res = await parseResponse(await put({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.deepEqual(row(db, P), before, 'a rejected update still mutated the row');
    });
  }

  it('updates only the fields present in the body', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: P, title: '  Renamed  ' } }))).status, 200);
    const stored = row(db, P);
    assert.equal(stored.title, 'Renamed');
    assert.equal(stored.slug, 'alpha', 'an absent slug was rewritten');
    assert.equal(stored.summary, 'old', 'an absent summary was rewritten');
  });

  it('writes every settable column in one request', async () => {
    assert.equal((await parseResponse(await put({
      db,
      body: {
        id: P, title: 'New', slug: 'New Slug', area_id: AREA, status: 'done',
        summary: 'sum', description: 'desc', workspace_url: 'https://ws.test/a',
        pinned: 1, sort_order: 9,
      },
    }))).status, 200);
    const stored = row(db, P);
    assert.equal(stored.title, 'New');
    assert.equal(stored.slug, 'new-slug');
    assert.equal(stored.status, 'done');
    assert.equal(stored.summary, 'sum');
    assert.equal(stored.description, 'desc');
    assert.equal(stored.workspace_url, 'https://ws.test/a');
    assert.equal(stored.pinned, 1);
    assert.equal(stored.sort_order, 9);
  });

  it('clears the nullable columns on explicit nulls and coerces sort_order null to 0', async () => {
    db._sqlite.prepare("UPDATE project SET description = 'd', workspace_url = 'https://x.test' WHERE id = ?").run(P);
    assert.equal((await parseResponse(await put({
      db, body: { id: P, summary: null, description: null, workspace_url: null, sort_order: null, pinned: false },
    }))).status, 200);
    const stored = row(db, P);
    assert.equal(stored.summary, null);
    assert.equal(stored.description, null);
    assert.equal(stored.workspace_url, null);
    assert.equal(stored.sort_order, 0);
    assert.equal(stored.pinned, 0);
  });

  it('moves a project to another ACTIVE area but refuses an archived or missing one', async () => {
    insertArea(db._sqlite, { id: 'area_two', slug: 'area-two', name: 'Two', bucket: 'advocacy' });
    assert.equal((await parseResponse(await put({ db, body: { id: P, area_id: 'area_two' } }))).status, 200);
    assert.equal(row(db, P).area_id, 'area_two');

    for (const areaId of [DEAD_AREA, 'area_ghost']) {
      const { status, body } = await parseResponse(await put({ db, body: { id: P, area_id: areaId } }));
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_area_id');
      assert.equal(row(db, P).area_id, 'area_two', 'a refused move still changed the parent');
    }
  });

  it('500s when the area lookup on update fails', async () => {
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await put({ db, body: { id: P, area_id: AREA } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });

  it('stamps updated_at on every successful update', async () => {
    db._sqlite.prepare("UPDATE project SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(P);
    await parseResponse(await put({ db, body: { id: P, title: 'Touched' } }));
    assert.notEqual(row(db, P).updated_at, '2020-01-01 00:00:00');
  });

  it('404s an id that matches no row', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: 'p_missing', title: 'Ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('409s slug_already_exists when a sibling project holds the slug (NOCASE)', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: P, slug: 'BETA' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(row(db, P).slug, 'alpha');
  });

  it('allows a project to keep its own slug', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: P, slug: 'alpha', title: 'Same' } }))).status, 200);
    assert.equal(row(db, P).slug, 'alpha');
  });

  it('500s when the slug collision check itself fails', async () => {
    db._sqlite.exec('DROP TABLE project');
    const { status, body } = await parseResponse(await put({ db, body: { id: P, slug: 'gamma' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });

  it('409s when a concurrent writer takes the slug between the check and the UPDATE', async () => {
    let fired = false;
    const raced = seededDb(
      (s) => insertProject(s, { id: P, areaId: AREA, slug: 'alpha', title: 'Alpha' }),
      {
        interleave({ sql, db: sqlite }) {
          if (!fired && /^\s*UPDATE project SET/.test(sql)) {
            fired = true;
            insertProject(sqlite, { id: 'squatter', areaId: AREA, slug: 'gamma', title: 'Squatter' });
          }
        },
      },
    );
    const { status, body } = await parseResponse(await put({ db: raced, body: { id: P, slug: 'gamma' } }));
    assert.ok(fired, 'the interleave never fired -- the UPDATE shape changed');
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    raced.close();
  });

  it('500s generically, and logs, when the UPDATE fails for any other reason', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE project');
    const { status, body } = await parseResponse(await put({ db, env, body: { id: P, title: 'Boom' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('project_update_error')));
  });

  it('400s owner_user_not_found rather than pointing the project at a nonexistent user', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: P, owner_user_id: 'u_ghost' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'owner_user_not_found');
    assert.equal(row(db, P).owner_user_id, null);
    assert.equal(memberships(db, P).length, 0);
  });

  it('500s when the owner existence check fails', async () => {
    db._sqlite.exec('DROP TABLE user');
    const { status, body } = await parseResponse(await put({ db, body: { id: P, owner_user_id: MEMBER.id } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });
});

// ---------------------------------------------------------------------------

describe('PUT admin/community/projects -- ownership reassignment', () => {
  let db;
  const P = 'p1';
  beforeEach(() => {
    db = seededDb((s) => insertProject(s, { id: P, areaId: AREA, slug: 'alpha', title: 'Alpha' }));
  });

  it('assigning an owner writes both project.owner_user_id and the owner membership', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: P, owner_user_id: MEMBER.id } }))).status, 200);
    assert.equal(row(db, P).owner_user_id, MEMBER.id);
    assert.deepEqual(memberships(db, P), [{ user_id: MEMBER.id, role: 'owner' }]);
  });

  it('promotes an existing plain membership to owner rather than failing on the primary key', async () => {
    insertProjectMembership(db._sqlite, { userId: MEMBER.id, projectId: P, role: 'member' });
    assert.equal((await parseResponse(await put({ db, body: { id: P, owner_user_id: MEMBER.id } }))).status, 200);
    assert.deepEqual(memberships(db, P), [{ user_id: MEMBER.id, role: 'owner' }]);
  });

  it('reassignment demotes the previous owner -- exactly one project_membership holds owner', async () => {
    // The twin of the areas.js fix, kept in step with it: the handler demotes
    // the old owner to 'member' in the same batch that promotes the new one.
    // Two rows claiming ownership was the defect.
    await parseResponse(await put({ db, body: { id: P, owner_user_id: MEMBER.id } }));
    await parseResponse(await put({ db, body: { id: P, owner_user_id: ADMIN.id } }));
    assert.equal(row(db, P).owner_user_id, ADMIN.id);
    assert.deepEqual(memberships(db, P), [
      { user_id: ADMIN.id, role: 'owner' },
      { user_id: MEMBER.id, role: 'member' },
    ], 'the previous owner still holds role=owner -- the demote did not land');
  });

  it('PINS A DEFECT: releasing ownership to null leaves the ex-owner membership at role owner', async () => {
    await parseResponse(await put({ db, body: { id: P, owner_user_id: MEMBER.id } }));
    assert.equal((await parseResponse(await put({ db, body: { id: P, owner_user_id: null } }))).status, 200);
    assert.equal(row(db, P).owner_user_id, null);
    assert.deepEqual(memberships(db, P), [{ user_id: MEMBER.id, role: 'owner' }],
      'CURRENT behaviour: an ownerless project still carries an owner membership row');
  });

  it('a 404 update that carries an owner writes NOTHING for the missing project', async () => {
    const { status } = await parseResponse(await put({ db, body: { id: 'p_missing', owner_user_id: MEMBER.id } }));
    assert.equal(status, 404);
    assert.deepEqual(memberships(db, 'p_missing'), [],
      'a 404 response left an orphan project_membership row behind');
  });

  it('a 404 update does not touch a pre-existing orphan membership either', async () => {
    // The demote carries the same EXISTS gate as the insert, so a request the
    // handler is about to answer 404 cannot quietly rewrite leftover rows.
    insertProjectMembership(db._sqlite, { userId: MEMBER.id, projectId: 'p_missing', role: 'owner' });
    const { status } = await parseResponse(await put({ db, body: { id: 'p_missing', owner_user_id: ADMIN.id } }));
    assert.equal(status, 404);
    assert.deepEqual(memberships(db, 'p_missing'), [{ user_id: MEMBER.id, role: 'owner' }],
      'a 404 response rewrote membership rows for a project that does not exist');
  });
});

// ---------------------------------------------------------------------------

describe('DELETE admin/community/projects', () => {
  let db;
  const P = 'p1';
  const OTHER = 'p2';

  beforeEach(() => {
    db = seededDb((s) => {
      insertProject(s, { id: P, areaId: AREA, slug: 'alpha', title: 'Alpha', owner_user_id: MEMBER.id });
      insertProject(s, { id: OTHER, areaId: AREA, slug: 'beta', title: 'Beta' });
      insertProjectMembership(s, { userId: MEMBER.id, projectId: P, role: 'owner' });
      insertProjectMembership(s, { userId: ADMIN.id, projectId: P, role: 'member' });
      insertProjectMembership(s, { userId: MEMBER.id, projectId: OTHER, role: 'member' });
      insertImpact(s, { id: 'i_p1', areaId: AREA, projectId: P, title: 'From p1' });
      insertImpact(s, { id: 'i_p2', areaId: AREA, projectId: OTHER, title: 'From p2' });
      insertImpact(s, { id: 'i_area', areaId: AREA, projectId: null, title: 'Area only' });
    });
  });

  it('400s invalid_json / invalid_payload / id_required', async () => {
    assert.equal((await parseResponse(await del({ db, rawBody: 'x' }))).body.error, 'invalid_json');
    assert.equal((await parseResponse(await del({ db, rawBody: '[]' }))).body.error, 'invalid_payload');
    for (const body of [{}, { id: 1 }, { id: 'x'.repeat(101) }]) {
      const res = await parseResponse(await del({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'id_required');
    }
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project'), 2);
  });

  it('404s an id that matches no project', async () => {
    const { status, body } = await parseResponse(await del({ db, body: { id: 'p_missing' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('500s when the existence lookup fails', async () => {
    db._sqlite.exec('DROP TABLE project');
    const { status, body } = await parseResponse(await del({ db, body: { id: P } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });

  it('soft-delete archives the project and leaves every child row alone', async () => {
    const { status } = await parseResponse(await del({ db, body: { id: P } }));
    assert.equal(status, 200);
    assert.equal(row(db, P).status, 'archived');
    assert.equal(row(db, OTHER).status, 'recruiting', 'a sibling project was archived too');
    assert.equal(count(db, 'SELECT COUNT(*) c FROM project_membership WHERE project_id = ?', P), 2);
    assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry WHERE project_id = ?', P), 1);
    assert.equal(row(db, P).owner_user_id, MEMBER.id);
  });

  it('the archived project disappears from the default GET /api/community/projects view', async () => {
    await parseResponse(await del({ db, body: { id: P } }));
    const { body } = await parseResponse(await communityProjects.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/community/projects' }),
      env: mockEnv({ DB: db }),
    }));
    assert.deepEqual(body.projects.map((p) => p.id), [OTHER]);
  });

  it('404s the soft delete when the row vanishes between the existence check and the UPDATE', async () => {
    // On a single request this `meta.changes === 0` re-check is unreachable --
    // the SELECT two lines above already proved the row exists. It becomes
    // live only when a concurrent writer removes the row in between, which is
    // what makes it a race fence rather than dead code. Scripted, not raced.
    let fired = false;
    const raced = seededDb(
      (s) => insertProject(s, { id: P, areaId: AREA, slug: 'alpha', title: 'Alpha' }),
      {
        interleave({ sql, db: sqlite }) {
          if (!fired && /^\s*UPDATE project SET status = 'archived'/.test(sql)) {
            fired = true;
            sqlite.prepare('DELETE FROM project WHERE id = ?').run(P);
          }
        },
      },
    );
    const { status, body } = await parseResponse(await del({ db: raced, body: { id: P } }));
    assert.ok(fired, 'the interleave never fired -- the soft-delete UPDATE shape changed');
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    raced.close();
  });

  it('500s, and logs, when the soft delete fails', async () => {
    // The existence SELECT has to survive and the UPDATE has to fail, so the
    // table is dropped between them. Dropping it up front would trip the
    // lookup's own catch instead, which is a different branch (tested above).
    let dropped = false;
    const raced = seededDb(
      (s) => insertProject(s, { id: P, areaId: AREA, slug: 'alpha', title: 'Alpha' }),
      {
        interleave({ sql, db: sqlite }) {
          if (!dropped && /^\s*UPDATE project SET status = 'archived'/.test(sql)) {
            dropped = true;
            sqlite.exec('DROP TABLE project');
          }
        },
      },
    );
    const events = [];
    const env = mockEnv({ DB: raced });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    const { status, body } = await parseResponse(await del({ db: raced, env, body: { id: P } }));
    assert.ok(dropped, 'the interleave never fired -- the soft-delete UPDATE shape changed');
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('project_delete_error')));
    raced.close();
  });

  for (const hard of [1, true]) {
    it(`hard-delete (hard: ${JSON.stringify(hard)}) removes the project, its memberships, and PRESERVES its impact entries`, async () => {
      const { status } = await parseResponse(await del({ db, body: { id: P, hard } }));
      assert.equal(status, 200);

      assert.equal(row(db, P), undefined);
      assert.ok(row(db, OTHER), 'a sibling project was destroyed');
      assert.deepEqual(
        rows(db, 'SELECT project_id FROM project_membership ORDER BY project_id'),
        [{ project_id: OTHER }],
      );

      // The divergence from areas.js: impact rows SURVIVE, detached.
      assert.equal(count(db, 'SELECT COUNT(*) c FROM impact_entry'), 3, 'impact entries were destroyed');
      const detached = db._sqlite.prepare("SELECT area_id, project_id FROM impact_entry WHERE id = 'i_p1'").get();
      assert.equal(detached.project_id, null, 'the deleted project was left referenced by its impact entry');
      assert.equal(detached.area_id, AREA, 'the impact entry lost its area as well');
      assert.equal(
        db._sqlite.prepare("SELECT project_id FROM impact_entry WHERE id = 'i_p2'").get().project_id,
        OTHER, "a sibling project's impact entry was detached too",
      );
    });
  }

  it('500s, and logs, when the hard-delete batch fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE project_membership');
    const { status, body } = await parseResponse(await del({ db, env, body: { id: P, hard: true } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('project_delete_error')));
    assert.ok(row(db, P), 'the failed batch still destroyed the project');
  });

  it('treats a non-canonical truthy hard flag as a SOFT delete', async () => {
    for (const hard of ['1', 'true', 2]) {
      const fresh = seededDb((s) => insertProject(s, { id: 'p_soft', areaId: AREA, slug: 'soft', title: 'Soft' }));
      const { status } = await parseResponse(await del({ db: fresh, body: { id: 'p_soft', hard } }));
      assert.equal(status, 200);
      assert.equal(fresh._sqlite.prepare("SELECT status FROM project WHERE id = 'p_soft'").get().status, 'archived',
        `hard: ${JSON.stringify(hard)} performed a hard delete`);
      fresh.close();
    }
  });
});
