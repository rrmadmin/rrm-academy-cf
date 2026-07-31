/**
 * The PUBLIC read surface of the STUC Action Areas hub, plus the second shared
 * helper the whole subsystem delegates to:
 *
 *   functions/api/community/_areas-shared.js  (validateAreaId, isSafeUrl,
 *                                              resolveActiveAreaIdBySlug)
 *   functions/api/community/areas.js          GET  /api/community/areas
 *   functions/api/community/projects.js       GET  /api/community/projects
 *   functions/api/community/impact.js         GET  /api/community/impact
 *
 * WHY A REAL SQLITE ENGINE
 * Every behaviour worth asserting here is decided by the SQL, not by JavaScript:
 *   - areas.js counts projects through a FILTERED LEFT JOIN
 *     (`p.status NOT IN ('archived','done')`) so a zero-project area still
 *     returns 0 rather than dropping out, and runs a correlated subquery for
 *     memberCount;
 *   - projects.js enforces G-AREA-7 with an INNER JOIN to an active parent area,
 *     which is the only thing stopping a project under an archived area from
 *     appearing publicly, and orders `pinned DESC, sort_order, created_at DESC`;
 *   - resolveActiveAreaIdBySlug resolves `slug = ? COLLATE NOCASE AND
 *     status = 'active'`;
 *   - impact.js filters `substr(occurred_on, 1, 7) = ?`.
 * A substring-matching mock returns whatever the test declared for each of
 * those, so "the archived area's project is hidden" would restate the fixture
 * instead of testing the JOIN. These run on node:sqlite loaded with the
 * committed schema plus the root action-area migrations
 * (test/_community-sqlite.mjs).
 *
 * WHAT IS STILL FAKED
 *  - Analytics Engine is the mockEnv stub, so log() executes but its payload is
 *    asserted only where a test says so.
 *  - impact.js's month window is real wall-clock code. The DST/timezone test
 *    below freezes Date via node:test mock.timers to put UTC and America/New_York
 *    in DIFFERENT months; that proves the JS-side computation, not that D1's own
 *    strftime would have been wrong (the comment in impact.js is the record of
 *    why it is not used).
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { insertUser, insertSession } from './_d1-sqlite.mjs';
import { communityD1, insertArea, insertProject, insertImpact } from './_community-sqlite.mjs';
import {
  validateAreaId, isSafeUrl, resolveActiveAreaIdBySlug,
} from '../functions/api/community/_areas-shared.js';

const areas = await import('../functions/api/community/areas.js');
const projects = await import('../functions/api/community/projects.js');
const impact = await import('../functions/api/community/impact.js');

const USER = 'u_reader';
const RAW = 'raw-session-reader';
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86400;

function ctx(db, { url = 'https://rrmacademy.org/api/community/areas', raw = null } = {}) {
  return {
    request: mockRequest('GET', { url, headers: raw ? { Cookie: `session=${raw}` } : {} }),
    env: mockEnv({ DB: db }),
    waitUntil: mockWaitUntil(),
  };
}

/** ctx with an explicitly absent DB binding, for the misconfiguration branch. */
function ctxNoDb(url = 'https://rrmacademy.org/api/community/areas') {
  return { request: mockRequest('GET', { url }), env: mockEnv({ DB: undefined }), waitUntil: mockWaitUntil() };
}

async function withReader(db) {
  insertUser(db._sqlite, { id: USER, email: 'reader@example.com' });
  await insertSession(db._sqlite, { rawId: RAW, userId: USER, expiresAt: FUTURE });
  return db;
}

// ---------------------------------------------------------------------------
// _areas-shared.js, directly
// ---------------------------------------------------------------------------

describe('_areas-shared.js validateAreaId', () => {
  const seeded = () => communityD1({
    seed(s) {
      insertArea(s, { id: 'a_live', slug: 'live' });
      insertArea(s, { id: 'a_dead', slug: 'dead', status: 'archived' });
    },
  });

  it('returns true only for an area that exists AND is active', async () => {
    const db = seeded();
    assert.equal(await validateAreaId({ DB: db }, 'a_live'), true);
    assert.equal(await validateAreaId({ DB: db }, 'a_dead'), false, 'archived areas are not writable targets');
    assert.equal(await validateAreaId({ DB: db }, 'a_missing'), false);
    db.close();
  });

  it('returns false rather than throwing when the DB binding is absent', async () => {
    assert.equal(await validateAreaId({}, 'a_live'), false);
    assert.equal(await validateAreaId({ DB: null }, 'a_live'), false);
  });
});

describe('_areas-shared.js resolveActiveAreaIdBySlug', () => {
  const seeded = () => communityD1({
    seed(s) {
      insertArea(s, { id: 'a_live', slug: 'endo-research' });
      insertArea(s, { id: 'a_dead', slug: 'retired-thing', status: 'archived' });
    },
  });

  it('resolves an active slug case-insensitively', async () => {
    const db = seeded();
    assert.equal(await resolveActiveAreaIdBySlug({ DB: db }, 'endo-research'), 'a_live');
    assert.equal(await resolveActiveAreaIdBySlug({ DB: db }, 'ENDO-Research'), 'a_live', 'slug is COLLATE NOCASE');
    db.close();
  });

  it('returns null for an archived slug and for an unknown slug', async () => {
    const db = seeded();
    assert.equal(await resolveActiveAreaIdBySlug({ DB: db }, 'retired-thing'), null);
    assert.equal(await resolveActiveAreaIdBySlug({ DB: db }, 'never-existed'), null);
    db.close();
  });

  it('returns null rather than throwing when the DB binding is absent', async () => {
    assert.equal(await resolveActiveAreaIdBySlug({}, 'endo-research'), null);
  });
});

describe('_areas-shared.js isSafeUrl', () => {
  it('accepts http and https only', () => {
    assert.equal(isSafeUrl('https://example.org/board'), true);
    assert.equal(isSafeUrl('http://example.org/board'), true);
  });

  it('refuses script, data and file schemes, and anything unparseable', () => {
    assert.equal(isSafeUrl('javascript:alert(1)'), false);
    assert.equal(isSafeUrl('data:text/html;base64,PHNjcmlwdD4='), false);
    assert.equal(isSafeUrl('file:///etc/passwd'), false);
    assert.equal(isSafeUrl('ftp://example.org/x'), false);
    assert.equal(isSafeUrl('not a url'), false);
    assert.equal(isSafeUrl(''), false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/community/areas
// ---------------------------------------------------------------------------

describe('GET /api/community/areas', () => {
  it('OPTIONS preflight answers 204 with the locked-down CORS origin', async () => {
    const res = await areas.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });

  it('503s when the DB binding is absent instead of returning an empty list', async () => {
    const { status, body } = await parseResponse(await areas.onRequestGet(ctxNoDb()));
    assert.equal(status, 503);
    assert.equal(body.ok, false);
  });

  it('returns active areas in sort_order and omits archived ones entirely', async () => {
    const db = communityD1({
      seed(s) {
        insertArea(s, { id: 'a2', slug: 'second', name: 'Second', sort_order: 2 });
        insertArea(s, { id: 'a1', slug: 'first', name: 'First', sort_order: 1 });
        insertArea(s, { id: 'a9', slug: 'gone', name: 'Gone', sort_order: 0, status: 'archived' });
      },
    });
    const { status, body } = await parseResponse(await areas.onRequestGet(ctx(db)));
    db.close();
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.areas.map(a => a.slug), ['first', 'second']);
  });

  it('counts only LIVE projects, and reports 0 for an area with none (never drops the area)', async () => {
    const db = communityD1({
      seed(s) {
        insertArea(s, { id: 'a1', slug: 'busy', sort_order: 1 });
        insertArea(s, { id: 'a2', slug: 'empty', sort_order: 2 });
        insertProject(s, { id: 'p1', slug: 'p1', areaId: 'a1', status: 'recruiting' });
        insertProject(s, { id: 'p2', slug: 'p2', areaId: 'a1', status: 'in_progress' });
        insertProject(s, { id: 'p3', slug: 'p3', areaId: 'a1', status: 'archived' });
        insertProject(s, { id: 'p4', slug: 'p4', areaId: 'a1', status: 'done' });
      },
    });
    const { body } = await parseResponse(await areas.onRequestGet(ctx(db)));
    db.close();
    const [busy, empty] = body.areas;
    assert.equal(busy.projectCount, 2, "archived and done projects are excluded from the count");
    assert.equal(empty.projectCount, 0, 'a zero-project area still appears with a real 0 (G-AREA-12)');
  });

  it('reports memberCount from area_membership and resolves the owner display name', async () => {
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: 'u_owner', email: 'owner@example.com', name: 'Ada Lovelace' });
        insertUser(s, { id: 'u_a', email: 'a@example.com' });
        insertUser(s, { id: 'u_b', email: 'b@example.com' });
        insertArea(s, { id: 'a1', slug: 'owned', owner_user_id: 'u_owner', sort_order: 1 });
        insertArea(s, { id: 'a2', slug: 'ownerless', sort_order: 2 });
        for (const u of ['u_a', 'u_b']) {
          s.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(u, 'a1', 'member');
        }
      },
    });
    const { body } = await parseResponse(await areas.onRequestGet(ctx(db)));
    db.close();
    const [owned, ownerless] = body.areas;
    assert.equal(owned.memberCount, 2);
    assert.equal(owned.ownerUserId, 'u_owner');
    assert.equal(owned.ownerName, 'Ada Lovelace');
    assert.equal(ownerless.memberCount, 0);
    assert.equal(ownerless.ownerUserId, null, 'an ownerless area reports null, not undefined');
    assert.equal(ownerless.ownerName, null);
  });

  it('normalises empty optional columns to null and passes through populated ones', async () => {
    const db = communityD1({
      seed(s) {
        insertArea(s, { id: 'a1', slug: 'bare', sort_order: 1 });
        insertArea(s, {
          id: 'a2', slug: 'rich', sort_order: 2,
          tagline: 'Do the thing', description: 'Longer copy', icon: 'flask',
        });
      },
    });
    const { body } = await parseResponse(await areas.onRequestGet(ctx(db)));
    db.close();
    const [bare, rich] = body.areas;
    assert.deepEqual(
      { tagline: bare.tagline, description: bare.description, icon: bare.icon },
      { tagline: null, description: null, icon: null }
    );
    assert.equal(rich.tagline, 'Do the thing');
    assert.equal(rich.icon, 'flask');
    assert.equal(typeof bare.createdAt, 'string');
  });

  it('omits isMember entirely for an anonymous caller and includes it for a signed-in one', async () => {
    const db = await withReader(communityD1({
      seed(s) {
        insertArea(s, { id: 'a1', slug: 'joined', sort_order: 1 });
        insertArea(s, { id: 'a2', slug: 'not-joined', sort_order: 2 });
      },
    }));
    db._sqlite.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(USER, 'a1', 'member');

    const anon = await parseResponse(await areas.onRequestGet(ctx(db)));
    assert.ok(!('isMember' in anon.body.areas[0]), 'anonymous responses carry no membership field at all');

    const authed = await parseResponse(await areas.onRequestGet(ctx(db, { raw: RAW })));
    db.close();
    assert.deepEqual(authed.body.areas.map(a => [a.slug, a.isMember]), [['joined', true], ['not-joined', false]]);
  });

  it('a stale session cookie is treated as anonymous, not as a member of everything', async () => {
    const db = await withReader(communityD1({ seed: (s) => insertArea(s, { id: 'a1', slug: 'x' }) }));
    const { body } = await parseResponse(await areas.onRequestGet(ctx(db, { raw: 'garbage-session' })));
    db.close();
    assert.ok(!('isMember' in body.areas[0]));
  });

  it('500s when the area query itself fails', async () => {
    const db = communityD1({
      seed: (s) => insertArea(s, { id: 'a1', slug: 'x' }),
      interleave({ sql }) { if (sql.includes('FROM action_area a')) throw new Error('D1 down'); },
    });
    const { status, body } = await parseResponse(await areas.onRequestGet(ctx(db)));
    db.close();
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  });

  it('a failing membership lookup is NON-fatal: the areas still render, with isMember false', async () => {
    const db = await withReader(communityD1({ seed: (s) => insertArea(s, { id: 'a1', slug: 'x' }) }));
    db._sqlite.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(USER, 'a1', 'member');
    const failing = communityD1({
      seed(s) {
        insertUser(s, { id: USER, email: 'reader@example.com' });
        insertArea(s, { id: 'a1', slug: 'x' });
      },
      interleave({ sql }) {
        if (sql.includes('SELECT area_id FROM area_membership WHERE user_id')) throw new Error('D1 flake');
      },
    });
    await insertSession(failing._sqlite, { rawId: RAW, userId: USER, expiresAt: FUTURE });
    db.close();
    const { status, body } = await parseResponse(await areas.onRequestGet(ctx(failing, { raw: RAW })));
    failing.close();
    assert.equal(status, 200, 'a membership-lookup flake must not 500 the public hub');
    assert.equal(body.areas[0].isMember, false);
  });

  it('500s when the session lookup itself throws, rather than serving a partial page', async () => {
    const db = communityD1({
      seed: (s) => insertArea(s, { id: 'a1', slug: 'x' }),
      interleave({ sql }) { if (sql.includes('FROM session s')) throw new Error('D1 down'); },
    });
    const { status } = await parseResponse(await areas.onRequestGet(ctx(db, { raw: RAW })));
    db.close();
    assert.equal(status, 500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/community/projects
// ---------------------------------------------------------------------------

describe('GET /api/community/projects', () => {
  const URL_BASE = 'https://rrmacademy.org/api/community/projects';
  const pctx = (db, qs = '', raw = null) => ctx(db, { url: URL_BASE + qs, raw });

  function seededProjects() {
    return communityD1({
      seed(s) {
        insertArea(s, { id: 'a_live', slug: 'live-area', name: 'Live Area' });
        insertArea(s, { id: 'a_dead', slug: 'dead-area', status: 'archived' });
        insertProject(s, { id: 'p_pin', slug: 'pinned', areaId: 'a_live', pinned: 1, sort_order: 9 });
        insertProject(s, { id: 'p_a', slug: 'alpha', areaId: 'a_live', sort_order: 1 });
        insertProject(s, { id: 'p_b', slug: 'beta', areaId: 'a_live', sort_order: 2, status: 'in_progress' });
        insertProject(s, { id: 'p_arch', slug: 'archived-one', areaId: 'a_live', status: 'archived' });
        insertProject(s, { id: 'p_orphan', slug: 'orphan', areaId: 'a_dead' });
      },
    });
  }

  it('OPTIONS preflight answers 204', async () => {
    assert.equal((await projects.onRequestOptions()).status, 204);
  });

  it('503s when the DB binding is absent', async () => {
    const { status } = await parseResponse(await projects.onRequestGet(ctxNoDb(URL_BASE)));
    assert.equal(status, 503);
  });

  it('hides a project whose parent area is archived (G-AREA-7) and excludes archived projects by default', async () => {
    const db = seededProjects();
    const { body } = await parseResponse(await projects.onRequestGet(pctx(db)));
    db.close();
    const slugs = body.projects.map(p => p.slug);
    assert.ok(!slugs.includes('orphan'), 'a project under an archived area must not appear publicly');
    assert.ok(!slugs.includes('archived-one'), 'archived projects are excluded when no status filter is given');
  });

  it('orders pinned first, then sort_order, then newest created_at', async () => {
    const db = seededProjects();
    const { body } = await parseResponse(await projects.onRequestGet(pctx(db)));
    db.close();
    assert.deepEqual(body.projects.map(p => p.slug), ['pinned', 'alpha', 'beta']);
    assert.equal(body.projects[0].pinned, true, 'pinned is normalised from 0/1 to a boolean');
    assert.equal(body.projects[1].pinned, false);
  });

  it('denormalises the parent area slug and name onto every project', async () => {
    const db = seededProjects();
    const { body } = await parseResponse(await projects.onRequestGet(pctx(db)));
    db.close();
    assert.equal(body.projects[0].areaId, 'a_live');
    assert.equal(body.projects[0].areaSlug, 'live-area');
    assert.equal(body.projects[0].areaName, 'Live Area');
  });

  it('400s an unknown ?status value rather than silently returning everything', async () => {
    const db = seededProjects();
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, '?status=bogus')));
    db.close();
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_status');
  });

  it('a valid ?status filter selects exactly that status', async () => {
    const db = seededProjects();
    const live = await parseResponse(await projects.onRequestGet(pctx(db, '?status=in_progress')));
    assert.deepEqual(live.body.projects.map(p => p.slug), ['beta']);

    const recruiting = await parseResponse(await projects.onRequestGet(pctx(db, '?status=recruiting')));
    db.close();
    assert.deepEqual(recruiting.body.projects.map(p => p.slug), ['pinned', 'alpha']);
  });

  it('every status the schema allows is filterable EXCEPT archived, which the allowlist omits', async () => {
    // The project table's CHECK allows five statuses; VALID_PROJECT_STATUSES
    // lists four. 'archived' is deliberately absent, so there is no query string
    // that surfaces an archived project through this endpoint at all -- the
    // default exclusion cannot be argued around by naming the status.
    const db = seededProjects();
    for (const status of ['recruiting', 'in_progress', 'paused', 'done']) {
      const { status: code } = await parseResponse(await projects.onRequestGet(pctx(db, `?status=${status}`)));
      assert.equal(code, 200, `${status} should be an accepted filter`);
    }
    const { status: code, body } = await parseResponse(await projects.onRequestGet(pctx(db, '?status=archived')));
    db.close();
    assert.equal(code, 400);
    assert.equal(body.error, 'invalid_status');
  });

  it('an ?area slug over 100 characters is rejected as invalid input', async () => {
    const db = seededProjects();
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, `?area=${'x'.repeat(101)}`)));
    db.close();
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_area');
  });

  it('a 100-character ?area slug is accepted (the cap is inclusive) and simply matches nothing', async () => {
    const db = seededProjects();
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, `?area=${'x'.repeat(100)}`)));
    db.close();
    assert.equal(status, 200);
    assert.deepEqual(body.projects, []);
  });

  it('filters to one area when ?area names an active slug', async () => {
    const db = seededProjects();
    const { body } = await parseResponse(await projects.onRequestGet(pctx(db, '?area=live-area')));
    db.close();
    assert.deepEqual(body.projects.map(p => p.slug), ['pinned', 'alpha', 'beta']);
  });

  it('an archived ?area slug returns an EMPTY LIST, not a 400 and not its projects', async () => {
    const db = seededProjects();
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, '?area=dead-area')));
    db.close();
    assert.equal(status, 200, 'documented behaviour: unknown/archived slug is empty, not an error');
    assert.deepEqual(body.projects, []);
  });

  it('an unknown ?area slug returns an empty list', async () => {
    const db = seededProjects();
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, '?area=no-such-area')));
    db.close();
    assert.equal(status, 200);
    assert.deepEqual(body.projects, []);
  });

  it('500s when the area-slug resolution itself fails', async () => {
    const db = communityD1({
      seed: (s) => insertArea(s, { id: 'a1', slug: 'live-area' }),
      interleave({ sql }) { if (sql.includes('SELECT id FROM action_area WHERE slug')) throw new Error('D1 down'); },
    });
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, '?area=live-area')));
    db.close();
    assert.equal(status, 500);
    assert.equal(body.ok, false);
  });

  it('500s when the project query fails', async () => {
    const db = communityD1({
      seed: (s) => insertArea(s, { id: 'a1', slug: 'live-area' }),
      interleave({ sql }) { if (sql.includes('FROM project p')) throw new Error('D1 down'); },
    });
    const { status } = await parseResponse(await projects.onRequestGet(pctx(db)));
    db.close();
    assert.equal(status, 500);
  });

  it('omits isMember for anonymous callers and reports it per project for signed-in ones', async () => {
    const db = await withReader(seededProjects());
    db._sqlite.prepare('INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, ?)').run(USER, 'p_a', 'member');

    const anon = await parseResponse(await projects.onRequestGet(pctx(db)));
    assert.ok(!('isMember' in anon.body.projects[0]));

    const authed = await parseResponse(await projects.onRequestGet(pctx(db, '', RAW)));
    db.close();
    assert.deepEqual(
      authed.body.projects.map(p => [p.slug, p.isMember]),
      [['pinned', false], ['alpha', true], ['beta', false]]
    );
  });

  it('skips the membership query entirely when the filtered result is empty', async () => {
    const db = await withReader(seededProjects());
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, '?status=paused', RAW)));
    const membershipQueries = db._calls.filter(c => c.sql.includes('FROM project_membership'));
    db.close();
    assert.equal(status, 200);
    assert.deepEqual(body.projects, []);
    assert.equal(membershipQueries.length, 0, 'no projects means no reason to ask which ones you joined');
  });

  it('a failing membership lookup is NON-fatal: projects still render with isMember false', async () => {
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: USER, email: 'reader@example.com' });
        insertArea(s, { id: 'a_live', slug: 'live-area' });
        insertProject(s, { id: 'p_a', slug: 'alpha', areaId: 'a_live' });
      },
      interleave({ sql }) {
        if (sql.includes('SELECT project_id FROM project_membership')) throw new Error('D1 flake');
      },
    });
    await insertSession(db._sqlite, { rawId: RAW, userId: USER, expiresAt: FUTURE });
    const { status, body } = await parseResponse(await projects.onRequestGet(pctx(db, '', RAW)));
    db.close();
    assert.equal(status, 200);
    assert.equal(body.projects[0].isMember, false);
  });

  it('normalises empty optional project columns to null', async () => {
    const db = communityD1({
      seed(s) {
        insertArea(s, { id: 'a1', slug: 'live-area' });
        insertProject(s, { id: 'p1', slug: 'bare', areaId: 'a1' });
      },
    });
    const { body } = await parseResponse(await projects.onRequestGet(pctx(db)));
    db.close();
    const p = body.projects[0];
    assert.deepEqual(
      { summary: p.summary, description: p.description, ownerUserId: p.ownerUserId, workspaceUrl: p.workspaceUrl },
      { summary: null, description: null, ownerUserId: null, workspaceUrl: null }
    );
    assert.equal(p.status, 'recruiting');
    assert.equal(p.sortOrder, 0);
  });

  it('500s when the outer handler throws before any query runs (no URL to parse)', async () => {
    const broken = { request: { url: 'not a url', headers: { get: () => null } }, env: mockEnv({ DB: communityD1() }), waitUntil: mockWaitUntil() };
    const { status, body } = await parseResponse(await projects.onRequestGet(broken));
    broken.env.DB.close();
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/community/impact
// ---------------------------------------------------------------------------

describe('GET /api/community/impact', () => {
  const URL_IMPACT = 'https://rrmacademy.org/api/community/impact';

  it('OPTIONS preflight answers 204', async () => {
    assert.equal((await impact.onRequestOptions()).status, 204);
  });

  it('503s when the DB binding is absent', async () => {
    const { status } = await parseResponse(await impact.onRequestGet(ctxNoDb(URL_IMPACT)));
    assert.equal(status, 503);
  });

  it('returns only the current ET month, newest first, mapping optional columns to null', async (t) => {
    // 2026-06-15 12:00 UTC is unambiguously June in both zones.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00Z') });
    t.after(() => mock.timers.reset());

    const db = communityD1({
      seed(s) {
        insertImpact(s, { id: 'i_early', occurredOn: '2026-06-02', kind: 'webinar', title: 'Early' });
        insertImpact(s, { id: 'i_late', occurredOn: '2026-06-28', kind: 'research', title: 'Late', detail: 'Notes', area_id: null });
        insertImpact(s, { id: 'i_may', occurredOn: '2026-05-31', title: 'Last month' });
        insertImpact(s, { id: 'i_jul', occurredOn: '2026-07-01', title: 'Next month' });
      },
    });
    const { status, body } = await parseResponse(await impact.onRequestGet(ctx(db, { url: URL_IMPACT })));
    db.close();
    assert.equal(status, 200);
    assert.deepEqual(body.impact.map(i => i.id), ['i_late', 'i_early']);
    assert.equal(body.impact[0].detail, 'Notes');
    assert.equal(body.impact[1].detail, null);
    assert.equal(body.impact[1].areaId, null);
    assert.equal(body.impact[1].projectId, null);
    assert.equal(body.impact[1].kind, 'webinar');
  });

  it('links an entry to its area and project when those are set', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-06-15T12:00:00Z') });
    t.after(() => mock.timers.reset());

    const db = communityD1({
      seed(s) {
        insertArea(s, { id: 'a1', slug: 'x' });
        insertProject(s, { id: 'p1', slug: 'y', areaId: 'a1' });
        insertImpact(s, { id: 'i1', occurredOn: '2026-06-10', area_id: 'a1', project_id: 'p1' });
      },
    });
    const { body } = await parseResponse(await impact.onRequestGet(ctx(db, { url: URL_IMPACT })));
    db.close();
    assert.equal(body.impact[0].areaId, 'a1');
    assert.equal(body.impact[0].projectId, 'p1');
    assert.equal(body.impact[0].occurredOn, '2026-06-10');
  });

  it('uses the ET month, not the UTC one: 11:30 PM ET on Jan 31 still shows January', async (t) => {
    // 2026-02-01T04:30:00Z is 2026-01-31 23:30 in America/New_York (EST, UTC-5).
    // Using D1's UTC strftime here would return February and January's entries
    // would vanish an hour early. This is the bug impact.js's JS window exists
    // to prevent, so the assertion is that January is what comes back.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-02-01T04:30:00Z') });
    t.after(() => mock.timers.reset());

    const db = communityD1({
      seed(s) {
        insertImpact(s, { id: 'i_jan', occurredOn: '2026-01-31', title: 'January entry' });
        insertImpact(s, { id: 'i_feb', occurredOn: '2026-02-01', title: 'February entry' });
      },
    });
    const { body } = await parseResponse(await impact.onRequestGet(ctx(db, { url: URL_IMPACT })));
    db.close();
    assert.deepEqual(body.impact.map(i => i.id), ['i_jan']);
  });

  it('500s when the impact query fails', async () => {
    const db = communityD1({
      interleave({ sql }) { if (sql.includes('FROM impact_entry')) throw new Error('D1 down'); },
    });
    const { status, body } = await parseResponse(await impact.onRequestGet(ctx(db, { url: URL_IMPACT })));
    db.close();
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
  });

  it('500s when reading the DB binding itself throws', async () => {
    const env = mockEnv({});
    Object.defineProperty(env, 'DB', { get() { throw new Error('binding exploded'); } });
    const { status, body } = await parseResponse(
      await impact.onRequestGet({ request: mockRequest('GET', { url: URL_IMPACT }), env, waitUntil: mockWaitUntil() })
    );
    assert.equal(status, 500);
    assert.equal(body.error, 'Internal error');
  });
});
