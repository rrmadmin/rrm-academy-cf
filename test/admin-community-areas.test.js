/**
 * functions/api/admin/community/areas.js -- admin CRUD for STUC Action Areas.
 *
 * An action area is the unit members join, volunteer to lead, and file impact
 * against. This endpoint is the only way one is created, renamed, re-slugged,
 * archived, destroyed, or handed to a new owner, so what it writes IS the
 * subsystem's state. Three things follow, and they set the shape of this file:
 *
 *  1. THE AUTHORIZATION LINE IS THE PRODUCT. `user.role !== 'superadmin' &&
 *     user.role !== 'admin'` is repeated in all three handlers. Asserting that
 *     an admin is accepted proves nothing; every test below that matters proves
 *     a NON-admin is refused, and one of them drives the real
 *     admin/_middleware.js with a real session cookie so the rejection is the
 *     deployed chain's, not a hand-built `data.user`.
 *
 *  2. A WRITE IS ONLY PROVEN BY READING THE ROW BACK. `{ok: true}` is what the
 *     handler says; `SELECT ... FROM action_area` is what happened. Every
 *     mutation here is asserted against the database, and the DELETE tests
 *     assert what became of the CHILDREN, because foreign keys are disabled to
 *     match D1 and child cleanup is nothing but endpoint discipline.
 *
 *  3. OWNERSHIP IS TWO TABLES. `action_area.owner_user_id` is what
 *     /api/community/areas renders; `area_membership.role` is what
 *     /api/community/memberships renders. A reassignment that moves one and not
 *     the other looks like a clean write and reads to the rest of the product as
 *     a user who still owns the area. Those tests call the real consumer
 *     endpoints (with the real requireMember gate, unstubbed) rather than
 *     asserting on this endpoint's own return value.
 *
 * WHAT IS STILL FAKED
 *  - Analytics Engine is a stub; log payloads are asserted only where named.
 *  - Concurrency is scripted through the harness `interleave` hook. It proves
 *    the handler's behaviour GIVEN a writer landed at that point, not that the
 *    real race window is that wide.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, parseResponse } from './_helpers.js';
import { insertSession, insertWixSubscription } from './_d1-sqlite.mjs';
import {
  communityD1, insertUser, insertArea, insertProject, insertImpact,
  insertOwnershipRequest, insertAreaMembership, insertProjectMembership,
} from './_community-schema.mjs';

const areas = await import('../functions/api/admin/community/areas.js');
const adminMiddleware = await import('../functions/api/admin/_middleware.js');
const communityMemberships = await import('../functions/api/community/memberships.js');
const communityAreas = await import('../functions/api/community/areas.js');

const SUPER = { id: 'u_super', role: 'superadmin' };
const ADMIN = { id: 'u_admin', role: 'admin' };
const MOD = { id: 'u_mod', role: 'mod' };
const MEMBER = { id: 'u_member', role: 'member' };
const FUTURE = Math.floor(Date.now() / 1000) + 86400;

function seededDb(seed, opts = {}) {
  return communityD1({
    ...opts,
    seed(sqlite) {
      insertUser(sqlite, { id: SUPER.id, email: 'super@example.com', role: 'superadmin', name: 'Super' });
      insertUser(sqlite, { id: ADMIN.id, email: 'admin@example.com', role: 'admin', name: 'Admin' });
      insertUser(sqlite, { id: MOD.id, email: 'mod@example.com', role: 'mod', name: 'Mod' });
      insertUser(sqlite, { id: MEMBER.id, email: 'member@example.com', role: 'member', name: 'Member' });
      if (seed) seed(sqlite);
    },
  });
}

/** Invokes a handler the way CF Pages does: context.data.user is pre-populated. */
function call(handler, { db, user = SUPER, body, rawBody, env } = {}) {
  const opts = rawBody !== undefined ? { rawBody } : (body !== undefined ? { body } : {});
  return handler({
    request: mockRequest('POST', { url: 'https://rrmacademy.org/api/admin/community/areas', ...opts }),
    env: env || mockEnv({ DB: db }),
    data: user ? { user } : {},
  });
}

const post = (o) => call(areas.onRequestPost, o);
const put = (o) => call(areas.onRequestPut, o);
const del = (o) => call(areas.onRequestDelete, o);

const row = (db, id) => db._sqlite.prepare('SELECT * FROM action_area WHERE id = ?').get(id);
/** node:sqlite rows carry a null prototype, which deepStrictEqual refuses to match. */
const rows = (db, sql, ...args) => db._sqlite.prepare(sql).all(...args).map((r) => ({ ...r }));
const memberships = (db, areaId) =>
  rows(db, 'SELECT user_id, role FROM area_membership WHERE area_id = ? ORDER BY user_id', areaId);

/** Creates an area through the endpoint and returns the id it minted. */
async function createArea(db, body) {
  const { status, body: out } = await parseResponse(await post({ db, body }));
  assert.equal(status, 201, `create failed: ${JSON.stringify(out)}`);
  return out.id;
}

// ---------------------------------------------------------------------------

describe('admin/community/areas -- authorization', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  const HANDLERS = [
    ['POST', areas.onRequestPost],
    ['PUT', areas.onRequestPut],
    ['DELETE', areas.onRequestDelete],
  ];

  for (const [name, handler] of HANDLERS) {
    it(`${name} 401s when no session populated context.data.user`, async () => {
      const { status, body } = await parseResponse(await call(handler, { db, user: null, body: {} }));
      assert.equal(status, 401);
      assert.equal(body.error, 'Unauthorized');
    });

    it(`${name} 403s an authenticated ORDINARY MEMBER`, async () => {
      // The whole point of the endpoint. A member with a perfectly valid
      // session must not be able to reach the body of the handler at all.
      const { status, body } = await parseResponse(await call(handler, {
        db, user: MEMBER, body: { name: 'X', slug: 'x', bucket: 'research' },
      }));
      assert.equal(status, 403);
      assert.equal(body.error, 'Forbidden');
    });

    it(`${name} 403s a MOD -- staff elsewhere, not staff here`, async () => {
      // community/_shared.js requireMember() treats 'mod' as staff and lets it
      // bypass the subscription gate entirely. This endpoint does NOT use
      // roleAtLeast(): it name-checks superadmin/admin, so a mod is refused.
      // Pinned because the two gates disagree by construction, and a future
      // "consistency" edit toward roleAtLeast(role, 'mod') would silently hand
      // area CRUD to moderators.
      const { status } = await parseResponse(await call(handler, { db, user: MOD, body: {} }));
      assert.equal(status, 403);
    });

    it(`${name} accepts both superadmin and admin`, async () => {
      // Proven by absence of 401/403, not by success: the bodies here are
      // deliberately invalid so the assertion cannot pass on a handler that
      // stopped writing.
      for (const user of [SUPER, ADMIN]) {
        const { status } = await parseResponse(await call(handler, { db, user, body: {} }));
        assert.ok(status !== 401 && status !== 403, `${user.role} was refused with ${status}`);
      }
    });

    it(`${name} 503s when the DB binding is absent`, async () => {
      const { status, body } = await parseResponse(await call(handler, {
        db: undefined, env: mockEnv({ DB: undefined }), body: {},
      }));
      assert.equal(status, 503);
      assert.equal(body.error, 'service_unavailable');
    });
  }

  it('refuses a real member session end-to-end through admin/_middleware.js', async () => {
    // No hand-built context.data.user anywhere in this test. The middleware
    // reads the cookie, validates the session, loads the row, and populates
    // context.data; the endpoint then decides. If the middleware ever started
    // enforcing, or stopped populating, this is the test that notices.
    await insertSession(db._sqlite, { rawId: 'sess-member', userId: MEMBER.id, expiresAt: FUTURE });
    const context = {
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/community/areas',
        headers: { Cookie: 'session=sess-member' },
        body: { name: 'Sneaky', slug: 'sneaky', bucket: 'research' },
      }),
      env: mockEnv({ DB: db }),
      next: () => areas.onRequestPost(context),
    };
    const { status, body } = await parseResponse(await adminMiddleware.onRequest(context));
    assert.equal(status, 403);
    assert.equal(body.error, 'Forbidden');
    assert.equal(context.data.user.role, 'member', 'middleware did not populate the session user');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM action_area').get().c, 0,
      'a refused request still created an area');
  });

  it('admits a real superadmin session end-to-end through admin/_middleware.js', async () => {
    await insertSession(db._sqlite, { rawId: 'sess-super', userId: SUPER.id, expiresAt: FUTURE });
    const context = {
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/community/areas',
        headers: { Cookie: 'session=sess-super' },
        body: { name: 'Real', slug: 'real', bucket: 'research' },
      }),
      env: mockEnv({ DB: db }),
      next: () => areas.onRequestPost(context),
    };
    const { status } = await parseResponse(await adminMiddleware.onRequest(context));
    assert.equal(status, 201);
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM action_area').get().c, 1);
  });

  it('OPTIONS preflight answers 204 with the locked-down origin', () => {
    const res = areas.onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

// ---------------------------------------------------------------------------

describe('POST admin/community/areas -- body and field validation', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  it('400s invalid_json on a body that does not parse', async () => {
    const { status, body } = await parseResponse(await post({ db, rawBody: '{not json' }));
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_json');
  });

  it('400s invalid_payload on a JSON array, null, or scalar', async () => {
    for (const payload of [[], null, 'string', 42]) {
      const { status, body } = await parseResponse(await post({ db, rawBody: JSON.stringify(payload) }));
      assert.equal(status, 400, `payload ${JSON.stringify(payload)}`);
      assert.equal(body.error, 'invalid_payload');
    }
  });

  const BAD = [
    ['name_required', {}],
    ['name_required', { name: 42, slug: 's', bucket: 'research' }],
    ['name_required', { name: '   ', slug: 's', bucket: 'research' }],
    ['name_too_long', { name: 'n'.repeat(101), slug: 's', bucket: 'research' }],
    ['slug_required', { name: 'N' }],
    ['slug_required', { name: 'N', slug: 7 }],
    ['invalid_slug', { name: 'N', slug: '!!!', bucket: 'research' }],
    ['slug_reserved', { name: 'N', slug: 'areas', bucket: 'research' }],
    ['slug_reserved', { name: 'N', slug: 'events', bucket: 'research' }],
    ['slug_reserved', { name: 'N', slug: 'members', bucket: 'research' }],
    ['slug_reserved', { name: 'N', slug: 'post', bucket: 'research' }],
    ['invalid_bucket', { name: 'N', slug: 's' }],
    ['invalid_bucket', { name: 'N', slug: 's', bucket: 'fundraising' }],
    ['invalid_tagline', { name: 'N', slug: 's', bucket: 'research', tagline: 5 }],
    ['tagline_too_long', { name: 'N', slug: 's', bucket: 'research', tagline: 't'.repeat(201) }],
    ['invalid_description', { name: 'N', slug: 's', bucket: 'research', description: {} }],
    ['description_too_long', { name: 'N', slug: 's', bucket: 'research', description: 'd'.repeat(2001) }],
    ['invalid_icon', { name: 'N', slug: 's', bucket: 'research', icon: 1 }],
    ['icon_too_long', { name: 'N', slug: 's', bucket: 'research', icon: 'i'.repeat(101) }],
    ['invalid_sort_order', { name: 'N', slug: 's', bucket: 'research', sort_order: '3' }],
    ['invalid_owner_user_id', { name: 'N', slug: 's', bucket: 'research', owner_user_id: 9 }],
    ['invalid_owner_user_id', { name: 'N', slug: 's', bucket: 'research', owner_user_id: 'u'.repeat(101) }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const res = await parseResponse(await post({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM action_area').get().c, 0,
        'a rejected payload still wrote a row');
    });
  }

  it('accepts every bucket the CHECK constraint allows', async () => {
    for (const bucket of ['research', 'advocacy', 'education', 'community']) {
      const id = await createArea(db, { name: bucket, slug: `b-${bucket}`, bucket });
      assert.equal(row(db, id).bucket, bucket);
    }
  });

  it('400s owner_user_not_found for an owner id with no user row', async () => {
    const { status, body } = await parseResponse(await post({
      db, body: { name: 'N', slug: 's', bucket: 'research', owner_user_id: 'u_ghost' },
    }));
    assert.equal(status, 400);
    assert.equal(body.error, 'owner_user_not_found');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM action_area').get().c, 0);
  });

  it('500s generically when the owner lookup itself fails', async () => {
    db._sqlite.exec('DROP TABLE user');
    const { status, body } = await parseResponse(await post({
      db, body: { name: 'N', slug: 's', bucket: 'research', owner_user_id: MEMBER.id },
    }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(!JSON.stringify(body).includes('no such table'), 'SQL error text reached the client');
  });
});

describe('POST admin/community/areas -- the row it writes', () => {
  let db;
  beforeEach(() => { db = seededDb(); });

  it('stores every field, trims the name, slugifies the slug, defaults status to active', async () => {
    const id = await createArea(db, {
      name: '  Endometriosis Research  ',
      slug: 'Endo  Research!!',
      bucket: 'research',
      tagline: 'A tagline',
      description: 'A description',
      icon: 'microscope',
      sort_order: 7,
    });
    const stored = row(db, id);
    assert.equal(stored.name, 'Endometriosis Research', 'name was not trimmed');
    assert.equal(stored.slug, 'endo-research', 'slugify did not lowercase + collapse to single hyphens');
    assert.equal(stored.bucket, 'research');
    assert.equal(stored.tagline, 'A tagline');
    assert.equal(stored.description, 'A description');
    assert.equal(stored.icon, 'microscope');
    assert.equal(stored.sort_order, 7);
    assert.equal(stored.status, 'active');
    assert.equal(stored.owner_user_id, null);
  });

  it('defaults the optional columns to NULL and sort_order to 0', async () => {
    const stored = row(db, await createArea(db, { name: 'Bare', slug: 'bare', bucket: 'community' }));
    assert.equal(stored.tagline, null);
    assert.equal(stored.description, null);
    assert.equal(stored.icon, null);
    assert.equal(stored.sort_order, 0);
  });

  it('stores an explicit null for the optional columns rather than the string "null"', async () => {
    const stored = row(db, await createArea(db, {
      name: 'Nulls', slug: 'nulls', bucket: 'community',
      tagline: null, description: null, icon: null, sort_order: null, owner_user_id: null,
    }));
    assert.equal(stored.tagline, null);
    assert.equal(stored.description, null);
    assert.equal(stored.icon, null);
    assert.equal(stored.sort_order, 0, 'a null sort_order should fall back to the 0 default');
  });

  it('truncates a slug at 100 characters', async () => {
    const stored = row(db, await createArea(db, { name: 'Long', slug: 'a'.repeat(250), bucket: 'research' }));
    assert.equal(stored.slug.length, 100);
  });

  it('mints a 32-hex id rather than accepting one from the body', async () => {
    const { body } = await parseResponse(await post({
      db, body: { name: 'N', slug: 'n', bucket: 'research', id: 'attacker-chosen' },
    }));
    assert.match(body.id, /^[0-9a-f]{32}$/);
    assert.equal(row(db, 'attacker-chosen'), undefined);
  });

  it('creates the owner membership row alongside the area', async () => {
    const id = await createArea(db, { name: 'Owned', slug: 'owned', bucket: 'research', owner_user_id: MEMBER.id });
    assert.equal(row(db, id).owner_user_id, MEMBER.id);
    assert.deepEqual(memberships(db, id), [{ user_id: MEMBER.id, role: 'owner' }]);
  });

  it('the create-path membership upsert PROMOTES a colliding row, the only state its ON CONFLICT can reach', async () => {
    // On create the area id is minted by generateId() inside this same
    // request, so (user_id, area_id) cannot collide through any ordinary
    // sequence and the `ON CONFLICT ... DO UPDATE SET role = 'owner'` clause
    // is unreachable defensive code. Left alone it is an equivalent mutant:
    // DO NOTHING and DO UPDATE produce identical databases, so no assertion
    // about the create path can tell them apart.
    //
    // Reaching it needs a writer landing between the area INSERT and the
    // membership INSERT of the same batch, which is scripted here. What is
    // proven is the clause's behaviour given that collision, not that the
    // collision is reachable in production.
    let mintedId = null;
    const raced = communityD1({
      seed(s) {
        insertUser(s, { id: SUPER.id, email: 'super@example.com', role: 'superadmin' });
        insertUser(s, { id: MEMBER.id, email: 'member@example.com', role: 'member' });
      },
      interleave({ sql, bindings, db: sqlite }) {
        if (/^INSERT INTO action_area\(/.test(sql)) mintedId = bindings[0];
        if (mintedId && /^\s*INSERT INTO area_membership/.test(sql)) {
          sqlite.prepare("INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, 'member')")
            .run(MEMBER.id, mintedId);
        }
      },
    });
    const id = await createArea(raced, { name: 'Owned', slug: 'owned', bucket: 'research', owner_user_id: MEMBER.id });
    assert.equal(id, mintedId, 'the interleave never observed the minted id');
    assert.deepEqual(memberships(raced, id), [{ user_id: MEMBER.id, role: 'owner' }],
      'the create-path ON CONFLICT left the colliding row at role=member');
    raced.close();
  });

  it('409s slug_already_exists on a duplicate slug, case-insensitively', async () => {
    await createArea(db, { name: 'First', slug: 'shared-slug', bucket: 'research' });
    const { status, body } = await parseResponse(await post({
      db, body: { name: 'Second', slug: 'SHARED-SLUG', bucket: 'research' },
    }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM action_area').get().c, 1);
  });

  it('500s generically, and logs, when the insert fails for any other reason', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await post({
      db, env, body: { name: 'N', slug: 'n', bucket: 'research' },
    }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('area_create_error')), 'the failure was not logged');
    assert.ok(!JSON.stringify(body).includes('no such table'));
  });
});

// ---------------------------------------------------------------------------

describe('PUT admin/community/areas', () => {
  let db;
  const AREA = 'a1';
  beforeEach(() => {
    db = seededDb((s) => {
      insertArea(s, { id: AREA, slug: 'alpha', name: 'Alpha', bucket: 'research', tagline: 'old', sort_order: 1 });
      insertArea(s, { id: 'a2', slug: 'beta', name: 'Beta', bucket: 'advocacy' });
    });
  });

  it('400s invalid_json / invalid_payload before touching the database', async () => {
    assert.equal((await parseResponse(await put({ db, rawBody: 'nope' }))).body.error, 'invalid_json');
    assert.equal((await parseResponse(await put({ db, rawBody: '[]' }))).body.error, 'invalid_payload');
  });

  const BAD = [
    ['id_required', {}],
    ['id_required', { id: 5 }],
    ['id_required', { id: 'x'.repeat(101) }],
    ['name_required', { id: 'a1', name: 3 }],
    ['name_required', { id: 'a1', name: '  ' }],
    ['name_too_long', { id: 'a1', name: 'n'.repeat(101) }],
    ['invalid_slug', { id: 'a1', slug: 9 }],
    ['invalid_slug', { id: 'a1', slug: '***' }],
    ['slug_reserved', { id: 'a1', slug: 'members' }],
    ['invalid_bucket', { id: 'a1', bucket: 'nope' }],
    ['invalid_status', { id: 'a1', status: 'deleted' }],
    ['invalid_tagline', { id: 'a1', tagline: 1 }],
    ['tagline_too_long', { id: 'a1', tagline: 't'.repeat(201) }],
    ['invalid_description', { id: 'a1', description: [] }],
    ['description_too_long', { id: 'a1', description: 'd'.repeat(2001) }],
    ['invalid_icon', { id: 'a1', icon: 2 }],
    ['icon_too_long', { id: 'a1', icon: 'i'.repeat(101) }],
    ['invalid_sort_order', { id: 'a1', sort_order: 'high' }],
    ['invalid_owner_user_id', { id: 'a1', owner_user_id: 3 }],
    ['invalid_owner_user_id', { id: 'a1', owner_user_id: 'u'.repeat(101) }],
    ['no_fields_provided', { id: 'a1' }],
  ];

  for (const [error, body] of BAD) {
    it(`400s ${error} for ${JSON.stringify(body).slice(0, 72)}`, async () => {
      const before = row(db, AREA);
      const res = await parseResponse(await put({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, error);
      assert.deepEqual(row(db, AREA), before, 'a rejected update still mutated the row');
    });
  }

  it('updates only the fields present in the body', async () => {
    const { status } = await parseResponse(await put({ db, body: { id: AREA, name: '  Renamed  ', icon: 'flask' } }));
    assert.equal(status, 200);
    const stored = row(db, AREA);
    assert.equal(stored.name, 'Renamed');
    assert.equal(stored.icon, 'flask');
    assert.equal(stored.slug, 'alpha', 'an absent slug was rewritten');
    assert.equal(stored.tagline, 'old', 'an absent tagline was rewritten');
    assert.equal(stored.bucket, 'research');
  });

  it('writes every settable column, including explicit nulls and status', async () => {
    const { status } = await parseResponse(await put({
      db,
      body: {
        id: AREA, name: 'New', slug: 'New Slug', bucket: 'education', status: 'archived',
        tagline: null, description: 'desc', icon: null, sort_order: 12, owner_user_id: null,
      },
    }));
    assert.equal(status, 200);
    const stored = row(db, AREA);
    assert.equal(stored.name, 'New');
    assert.equal(stored.slug, 'new-slug');
    assert.equal(stored.bucket, 'education');
    assert.equal(stored.status, 'archived');
    assert.equal(stored.tagline, null);
    assert.equal(stored.description, 'desc');
    assert.equal(stored.icon, null);
    assert.equal(stored.sort_order, 12);
    assert.equal(stored.owner_user_id, null);
  });

  it('clears every nullable column when the body sends explicit nulls', async () => {
    db._sqlite.prepare("UPDATE action_area SET description = 'was here', icon = 'was here' WHERE id = ?").run(AREA);
    const { status } = await parseResponse(await put({
      db, body: { id: AREA, tagline: null, description: null, icon: null },
    }));
    assert.equal(status, 200);
    const stored = row(db, AREA);
    assert.equal(stored.tagline, null);
    assert.equal(stored.description, null);
    assert.equal(stored.icon, null);
  });

  it('coerces a null sort_order to 0 rather than storing NULL in a NOT NULL column', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: AREA, sort_order: null } }))).status, 200);
    assert.equal(row(db, AREA).sort_order, 0);
  });

  it('stamps updated_at on every successful update', async () => {
    db._sqlite.prepare("UPDATE action_area SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(AREA);
    await parseResponse(await put({ db, body: { id: AREA, name: 'Touched' } }));
    assert.notEqual(row(db, AREA).updated_at, '2020-01-01 00:00:00');
  });

  it('404s an id that matches no row, and writes nothing', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: 'a_missing', name: 'Ghost' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(db._sqlite.prepare('SELECT COUNT(*) c FROM action_area').get().c, 2);
  });

  it('409s slug_already_exists when another area already holds the slug (NOCASE)', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: AREA, slug: 'BETA' } }));
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    assert.equal(row(db, AREA).slug, 'alpha');
  });

  it('allows an area to keep its own slug (the collision check excludes itself)', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: AREA, slug: 'alpha', name: 'Same slug' } }))).status, 200);
    assert.equal(row(db, AREA).slug, 'alpha');
  });

  it('500s when the slug collision check itself fails', async () => {
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await put({ db, body: { id: AREA, slug: 'gamma' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });

  it('409s when a concurrent writer takes the slug between the check and the UPDATE', async () => {
    // The pre-check passes, then somebody else claims the slug. Only the
    // UNIQUE constraint is left to catch it, and the catch must translate that
    // into 409 rather than a 500. Scripted, not raced: see the file header.
    let fired = false;
    const raced = communityD1({
      seed(s) {
        insertUser(s, { id: SUPER.id, email: 'super@example.com', role: 'superadmin' });
        insertArea(s, { id: AREA, slug: 'alpha', name: 'Alpha', bucket: 'research' });
      },
      interleave({ sql, db: sqlite }) {
        if (!fired && /^\s*UPDATE action_area SET/.test(sql)) {
          fired = true;
          insertArea(sqlite, { id: 'squatter', slug: 'gamma', name: 'Squatter', bucket: 'research' });
        }
      },
    });
    const { status, body } = await parseResponse(await put({ db: raced, body: { id: AREA, slug: 'gamma' } }));
    assert.ok(fired, 'the interleave never fired -- the UPDATE shape changed');
    assert.equal(status, 409);
    assert.equal(body.error, 'slug_already_exists');
    raced.close();
  });

  it('500s generically, and logs, when the UPDATE fails for any other reason', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await put({ db, env, body: { id: AREA, name: 'Boom' } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('area_update_error')));
  });

  it('400s owner_user_not_found rather than pointing the area at a nonexistent user', async () => {
    const { status, body } = await parseResponse(await put({ db, body: { id: AREA, owner_user_id: 'u_ghost' } }));
    assert.equal(status, 400);
    assert.equal(body.error, 'owner_user_not_found');
    assert.equal(row(db, AREA).owner_user_id, null, 'the area was pointed at a user that does not exist');
    assert.equal(memberships(db, AREA).length, 0);
  });

  it('500s when the owner existence check fails', async () => {
    db._sqlite.exec('DROP TABLE user');
    const { status, body } = await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });
});

// ---------------------------------------------------------------------------

describe('PUT admin/community/areas -- ownership is two tables', () => {
  let db;
  const AREA = 'a1';
  beforeEach(() => {
    db = seededDb((s) => insertArea(s, { id: AREA, slug: 'alpha', name: 'Alpha', bucket: 'research' }));
  });

  it('assigning an owner writes BOTH action_area.owner_user_id and the owner membership', async () => {
    assert.equal((await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }))).status, 200);
    assert.equal(row(db, AREA).owner_user_id, MEMBER.id);
    assert.deepEqual(memberships(db, AREA), [{ user_id: MEMBER.id, role: 'owner' }]);
  });

  it('promotes an existing plain membership to owner instead of failing on the primary key', async () => {
    insertAreaMembership(db._sqlite, { userId: MEMBER.id, areaId: AREA, role: 'member' });
    assert.equal((await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }))).status, 200);
    assert.deepEqual(memberships(db, AREA), [{ user_id: MEMBER.id, role: 'owner' }]);
  });

  it('reassigning ownership DEMOTES the previous owner -- exactly one area_membership holds owner', async () => {
    // Reassignment is a transfer, not an addition: the handler moves
    // action_area.owner_user_id, demotes whoever held role='owner' on the area,
    // and promotes the new owner, all in one batch. Two owner rows is the
    // defect this asserts is gone.
    //
    // The ex-owner is demoted to 'member', not deleted -- losing the lead does
    // not eject you from the area. The memberCount assertion two tests below is
    // the other half of that decision.
    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }));
    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: ADMIN.id } }));

    assert.equal(row(db, AREA).owner_user_id, ADMIN.id, 'the canonical owner column did move');
    assert.deepEqual(memberships(db, AREA), [
      { user_id: ADMIN.id, role: 'owner' },
      { user_id: MEMBER.id, role: 'member' },
    ], 'the previous owner still holds role=owner -- the demote did not land');
  });

  it('the demoted owner reads as a plain member from GET /api/community/memberships', async () => {
    // The real consumer, with the real requireMember gate (not stubbed): the
    // demoted user is a genuine STUC member with an active Wix subscription and
    // a valid session, so requireMember admits them and the response below is
    // the one the community UI renders its owner controls from. It must no
    // longer offer them owner controls for an area they do not own.
    insertWixSubscription(db._sqlite, { email: 'member@example.com', user_id: MEMBER.id });
    await insertSession(db._sqlite, { rawId: 'sess-demoted', userId: MEMBER.id, expiresAt: FUTURE });

    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }));
    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: ADMIN.id } }));

    const res = await communityMemberships.onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/community/memberships',
        headers: { Cookie: 'session=sess-demoted' },
      }),
      env: mockEnv({ DB: db }),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200, `requireMember refused the fixture member: ${JSON.stringify(body)}`);
    assert.deepEqual(body.areas, [{ areaId: AREA, role: 'member' }],
      'a user who owns nothing is still told by the API that they own this area');
  });

  it('the public areas list agrees with the memberships view about who owns it', async () => {
    // Same database, same moment: /api/community/areas reads
    // action_area.owner_user_id and /api/community/memberships (above) reads
    // area_membership.role. Both now name the new owner. The two disagreeing
    // was the whole finding.
    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }));
    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: ADMIN.id } }));

    const { body } = await parseResponse(await communityAreas.onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/community/areas' }),
      env: mockEnv({ DB: db }),
    }));
    assert.equal(body.areas.length, 1);
    assert.equal(body.areas[0].ownerUserId, ADMIN.id);
    assert.equal(body.areas[0].ownerName, 'Admin');
    assert.equal(body.areas[0].memberCount, 2,
      'the demote removed the ex-owner from the area instead of dropping them to member');
  });

  it('PINS A DEFECT: clearing owner_user_id to null leaves the ex-owner membership at role owner', async () => {
    // `newOwnerId` is only truthy for a non-null owner, so releasing an area
    // takes the single-statement path and the membership upsert never runs.
    // The area ends up ownerless while one member still holds role='owner'.
    await parseResponse(await put({ db, body: { id: AREA, owner_user_id: MEMBER.id } }));
    const { status } = await parseResponse(await put({ db, body: { id: AREA, owner_user_id: null } }));
    assert.equal(status, 200);
    assert.equal(row(db, AREA).owner_user_id, null, 'the area was not released');
    assert.deepEqual(memberships(db, AREA), [{ user_id: MEMBER.id, role: 'owner' }],
      'CURRENT behaviour: an ownerless area still carries a membership row claiming ownership');
  });

  it('a 404 update that carries an owner writes NOTHING for the missing area', async () => {
    // The membership statements used to be unconditional, so the UPDATE matched
    // nothing (answered 404) while the INSERT still created a row saying this
    // user owns an area that does not exist. Foreign keys are inert in D1 and a
    // batch that SUCCEEDED does not roll back, so nothing else would have
    // caught it. Both membership statements now carry
    // `EXISTS (SELECT 1 FROM action_area WHERE id = ?)`.
    const { status, body } = await parseResponse(await put({
      db, body: { id: 'a_missing', owner_user_id: MEMBER.id },
    }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.deepEqual(memberships(db, 'a_missing'), [],
      'a 404 response left an orphan area_membership row behind');
  });

  it('a 404 update does not touch a pre-existing orphan membership either', async () => {
    // The demote statement is gated on the same EXISTS as the insert. An orphan
    // row left over from the old behaviour is not silently rewritten by a
    // request that the handler is about to answer 404.
    insertAreaMembership(db._sqlite, { userId: MEMBER.id, areaId: 'a_missing', role: 'owner' });
    const { status } = await parseResponse(await put({
      db, body: { id: 'a_missing', owner_user_id: ADMIN.id },
    }));
    assert.equal(status, 404);
    assert.deepEqual(memberships(db, 'a_missing'), [{ user_id: MEMBER.id, role: 'owner' }],
      'a 404 response rewrote membership rows for an area that does not exist');
  });
});

// ---------------------------------------------------------------------------

describe('DELETE admin/community/areas', () => {
  let db;
  const AREA = 'a1';
  const OTHER = 'a2';

  beforeEach(() => {
    db = seededDb((s) => {
      insertArea(s, { id: AREA, slug: 'alpha', name: 'Alpha', bucket: 'research', owner_user_id: MEMBER.id });
      insertArea(s, { id: OTHER, slug: 'beta', name: 'Beta', bucket: 'advocacy' });
      insertProject(s, { id: 'p1', areaId: AREA, slug: 'p-one', title: 'P One' });
      insertProject(s, { id: 'p2', areaId: AREA, slug: 'p-two', title: 'P Two', status: 'in_progress' });
      insertProject(s, { id: 'p_other', areaId: OTHER, slug: 'p-other', title: 'Other' });
      insertProjectMembershipRows(s);
      insertAreaMembership(s, { userId: MEMBER.id, areaId: AREA, role: 'owner' });
      insertAreaMembership(s, { userId: ADMIN.id, areaId: AREA, role: 'member' });
      insertAreaMembership(s, { userId: MEMBER.id, areaId: OTHER, role: 'member' });
      insertOwnershipRequest(s, { id: 'r1', areaId: AREA, userId: ADMIN.id, status: 'pending' });
      insertOwnershipRequest(s, { id: 'r2', areaId: AREA, userId: MOD.id, status: 'rejected' });
      insertOwnershipRequest(s, { id: 'r3', areaId: OTHER, userId: ADMIN.id, status: 'pending' });
      insertImpact(s, { id: 'i_area', areaId: AREA, title: 'By area' });
      insertImpact(s, { id: 'i_other', areaId: OTHER, title: 'Elsewhere' });
      s.prepare("INSERT INTO community_post (id, author_id, type, title, area_id) VALUES ('post1', ?, 'discussion', 'Post', ?)")
        .run(MEMBER.id, AREA);
    });
  });

  function insertProjectMembershipRows(s) {
    insertProjectMembership(s, { userId: MEMBER.id, projectId: 'p1', role: 'owner' });
    insertProjectMembership(s, { userId: ADMIN.id, projectId: 'p2', role: 'member' });
    insertProjectMembership(s, { userId: MEMBER.id, projectId: 'p_other', role: 'member' });
  }

  const count = (sql, ...args) => db._sqlite.prepare(sql).get(...args).c;

  it('400s invalid_json / invalid_payload / id_required', async () => {
    assert.equal((await parseResponse(await del({ db, rawBody: '<' }))).body.error, 'invalid_json');
    assert.equal((await parseResponse(await del({ db, rawBody: 'null' }))).body.error, 'invalid_payload');
    for (const body of [{}, { id: 4 }, { id: 'x'.repeat(101) }]) {
      const res = await parseResponse(await del({ db, body }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'id_required');
    }
    assert.equal(count('SELECT COUNT(*) c FROM action_area'), 2);
  });

  it('404s an id that matches no area', async () => {
    const { status, body } = await parseResponse(await del({ db, body: { id: 'a_missing' } }));
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  it('500s when the existence lookup fails', async () => {
    db._sqlite.exec('DROP TABLE action_area');
    const { status, body } = await parseResponse(await del({ db, body: { id: AREA } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
  });

  it('soft-delete archives the area, cascades to its projects, and withdraws pending requests', async () => {
    const { status } = await parseResponse(await del({ db, body: { id: AREA } }));
    assert.equal(status, 200);

    assert.equal(row(db, AREA).status, 'archived');
    assert.equal(row(db, OTHER).status, 'active', 'a sibling area was archived too');

    assert.deepEqual(rows(db, 'SELECT id, status FROM project ORDER BY id'), [
      { id: 'p1', status: 'archived' },
      { id: 'p2', status: 'archived' },
      { id: 'p_other', status: 'recruiting' },
    ]);

    const requests = db._sqlite.prepare('SELECT id, status, decided_at FROM area_ownership_request ORDER BY id').all();
    assert.equal(requests.find((r) => r.id === 'r1').status, 'withdrawn');
    assert.ok(requests.find((r) => r.id === 'r1').decided_at, 'withdrawal did not stamp decided_at');
    assert.equal(requests.find((r) => r.id === 'r2').status, 'rejected', 'a settled request was re-decided');
    assert.equal(requests.find((r) => r.id === 'r3').status, 'pending', 'a sibling area request was withdrawn');
  });

  it('soft-delete keeps memberships, impact entries and posts -- it is reversible', async () => {
    await parseResponse(await del({ db, body: { id: AREA } }));
    assert.equal(count('SELECT COUNT(*) c FROM area_membership WHERE area_id = ?', AREA), 2);
    assert.equal(count('SELECT COUNT(*) c FROM impact_entry WHERE area_id = ?', AREA), 1);
    assert.equal(count('SELECT COUNT(*) c FROM community_post WHERE area_id = ?', AREA), 1);
    assert.equal(row(db, AREA).owner_user_id, MEMBER.id);
  });

  it('500s, and logs, when the soft-delete batch fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE area_ownership_request');
    const { status, body } = await parseResponse(await del({ db, env, body: { id: AREA } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('area_delete_error')));
    assert.equal(row(db, AREA).status, 'active', 'the failed batch was not rolled back');
  });

  for (const hard of [1, true]) {
    it(`hard-delete (hard: ${JSON.stringify(hard)}) removes the area and every child it claims to clean up`, async () => {
      const { status } = await parseResponse(await del({ db, body: { id: AREA, hard } }));
      assert.equal(status, 200);

      assert.equal(row(db, AREA), undefined);
      assert.ok(row(db, OTHER), 'a sibling area was destroyed');

      assert.deepEqual(rows(db, 'SELECT id FROM project ORDER BY id'), [{ id: 'p_other' }]);
      assert.deepEqual(
        rows(db, 'SELECT project_id FROM project_membership ORDER BY project_id'),
        [{ project_id: 'p_other' }],
        'memberships of the deleted projects survived',
      );
      assert.equal(count('SELECT COUNT(*) c FROM area_membership WHERE area_id = ?', AREA), 0);
      assert.equal(count('SELECT COUNT(*) c FROM area_membership WHERE area_id = ?', OTHER), 1);
      assert.equal(count('SELECT COUNT(*) c FROM area_ownership_request WHERE area_id = ?', AREA), 0);
      assert.equal(count('SELECT COUNT(*) c FROM area_ownership_request WHERE area_id = ?', OTHER), 1);
      assert.equal(count('SELECT COUNT(*) c FROM impact_entry WHERE id = ?', 'i_area'), 0);
      assert.equal(count('SELECT COUNT(*) c FROM impact_entry WHERE id = ?', 'i_other'), 1);

      const post = db._sqlite.prepare("SELECT area_id FROM community_post WHERE id = 'post1'").get();
      assert.equal(post.area_id, null, 'the post was deleted or left pointing at a dead area');
    });
  }

  it('PINS A DEFECT: hard-delete orphans impact entries that reference the area only through a project', async () => {
    // The cleanup batch deletes impact_entry BY AREA and deletes the child
    // projects, but never touches impact_entry.project_id. An entry filed
    // against a project rather than against the area therefore survives with a
    // project_id pointing at a row the same batch destroyed. Foreign keys are
    // inert in D1, so nothing rejects it.
    //
    // The sibling endpoint makes the OPPOSITE choice for the same column:
    // admin/community/projects.js DELETE runs
    // `UPDATE impact_entry SET project_id = NULL` before dropping a project.
    // Deleting an area therefore takes a code path that skips the cleanup its
    // own sibling performs.
    insertImpact(db._sqlite, { id: 'i_proj', areaId: null, projectId: 'p1', title: 'By project' });

    await parseResponse(await del({ db, body: { id: AREA, hard: 1 } }));

    const survivor = db._sqlite.prepare("SELECT area_id, project_id FROM impact_entry WHERE id = 'i_proj'").get();
    assert.equal(survivor.project_id, 'p1',
      'CURRENT behaviour: project_id still points at a project the same batch deleted');
    assert.equal(db._sqlite.prepare("SELECT COUNT(*) c FROM project WHERE id = 'p1'").get().c, 0,
      'the project it points at is genuinely gone');
  });

  it('500s, and logs, when the hard-delete batch fails', async () => {
    const events = [];
    const env = mockEnv({ DB: db });
    env.EVENTS = { writeDataPoint: (p) => events.push(p) };
    db._sqlite.exec('DROP TABLE project_membership');
    const { status, body } = await parseResponse(await del({ db, env, body: { id: AREA, hard: true } }));
    assert.equal(status, 500);
    assert.equal(body.error, 'internal_error');
    assert.ok(events.some((e) => e.blobs.includes('area_delete_error')));
    assert.ok(row(db, AREA), 'the failed batch still destroyed the area');
  });

  it('treats a non-canonical truthy hard flag as a SOFT delete', async () => {
    // `hard === 1 || hard === true` only. The string "1" and "true" -- what a
    // form post or a query-string admin client would send -- fall through to
    // the archive branch. Pinned so the fall-through is a decision, not a
    // surprise on the day someone switches the admin UI to form encoding.
    for (const hard of ['1', 'true', 'yes']) {
      const fresh = seededDb((s) => insertArea(s, { id: 'a_soft', slug: 'soft', name: 'Soft', bucket: 'research' }));
      const { status } = await parseResponse(await del({ db: fresh, body: { id: 'a_soft', hard } }));
      assert.equal(status, 200);
      assert.equal(fresh._sqlite.prepare("SELECT status FROM action_area WHERE id = 'a_soft'").get().status,
        'archived', `hard: ${JSON.stringify(hard)} performed a hard delete`);
      fresh.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('admin/community/areas -- PUT status=archived versus DELETE soft-archive', () => {
  it('PINS A DEFECT: PUT status=archived does NOT cascade, so it strands active projects under a dead area', async () => {
    // Two routes reach the same end state, and only one of them tidies up.
    // DELETE {id} archives the area, archives its projects, and withdraws
    // pending ownership requests. PUT {id, status:'archived'} archives the area
    // alone. /api/community/areas then stops listing the area (it filters
    // status='active') while /api/community/projects keeps listing its
    // projects, because that query joins action_area without filtering on the
    // area's status.
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: SUPER.id, email: 'super@example.com', role: 'superadmin' });
        insertArea(s, { id: 'a1', slug: 'alpha', name: 'Alpha', bucket: 'research' });
        insertProject(s, { id: 'p1', areaId: 'a1', slug: 'p-one', title: 'P One' });
        insertOwnershipRequest(s, { id: 'r1', areaId: 'a1', userId: SUPER.id, status: 'pending' });
      },
    });

    assert.equal((await parseResponse(await put({ db, body: { id: 'a1', status: 'archived' } }))).status, 200);

    assert.equal(db._sqlite.prepare("SELECT status FROM action_area WHERE id = 'a1'").get().status, 'archived');
    assert.equal(db._sqlite.prepare("SELECT status FROM project WHERE id = 'p1'").get().status, 'recruiting',
      'CURRENT behaviour: the child project stays active, unlike the DELETE soft-archive path');
    assert.equal(db._sqlite.prepare("SELECT status FROM area_ownership_request WHERE id = 'r1'").get().status,
      'pending', 'CURRENT behaviour: a pending ownership request stays open on an archived area');
    db.close();
  });
});
