/**
 * The member-only read/write surface that sits directly on top of the gate:
 *
 *   functions/api/community/status.js         GET   /api/community/status
 *   functions/api/community/memberships.js    GET   /api/community/memberships
 *   functions/api/community/notifications.js  PATCH /api/community/notifications
 *   functions/api/community/members.js        GET   /api/community/members
 *
 * WHY THESE FOUR TOGETHER
 * They are the endpoints whose entire job is to REPORT the gate's answer, or to
 * act on it. status.js is the one every page load calls, and it is the only file
 * in the product that translates requireMember's four tiers into the three-value
 * `access` field the client renders from: anonymous / registered / member. A
 * mistake there is visible on every page at once, and it is the exact place a
 * gate failure would present as "everyone is a member".
 *
 * WHY A REAL SQLITE ENGINE
 * memberships.js and members.js are pure SQL projections -- three per-user reads
 * and one roster query built on the shared STUC_MEMBER_WHERE predicate with a
 * UNION ALL subquery for last-activity. status.js reads community_email_opt_out
 * off a column that defaults to 0. None of that is assertable against canned
 * rows. notifications.js's whole contract is that the stored column changes, so
 * every assertion reads it back.
 *
 * THE GATE IS NOT STUBBED. requireMember is the real one throughout.
 *
 * WHAT IS STILL FAKED
 *  - Analytics Engine is the mockEnv stub.
 *  - status.js has two branches that no single-threaded caller can reach,
 *    because validateSession already refuses a blocked user and already JOINs
 *    `user`: the `user?.blocked -> anonymous` arm and the `displayName(user || {})`
 *    fallback. Both are reached with the harness `interleave` hook, a scripted
 *    stand-in for a concurrent admin action landing mid-request. That proves the
 *    branch behaves as written, not that the real race window has that shape.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, stripeRoutes,
} from './_helpers.js';
import { insertUser, insertLabel, insertSession } from './_d1-sqlite.mjs';
import { communityD1, insertArea, insertProject } from './_community-sqlite.mjs';

const status = await import('../functions/api/community/status.js');
const memberships = await import('../functions/api/community/memberships.js');
const notifications = await import('../functions/api/community/notifications.js');
const members = await import('../functions/api/community/members.js');

const MEMBER = 'u_member';
const OTHER = 'u_other';
const OUTSIDER = 'u_outsider';
const STAFF = 'u_staff';
const RAW = {
  [MEMBER]: 'raw-member', [OTHER]: 'raw-other',
  [OUTSIDER]: 'raw-outsider', [STAFF]: 'raw-staff',
};
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86400;

async function harness({ seed, interleave } = {}) {
  const db = communityD1({
    seed(s) {
      for (const id of [MEMBER, OTHER]) {
        insertUser(s, { id, email: `${id}@example.com`, name: `Name ${id}` });
        insertLabel(s, id, 'STUC Legacy Grandfather');
      }
      insertUser(s, { id: OUTSIDER, email: 'outsider@example.com' });
      insertUser(s, { id: STAFF, email: 'staff@example.com', role: 'admin', name: 'Staff Person' });
      if (seed) seed(s);
    },
    interleave,
  });
  for (const id of [MEMBER, OTHER, OUTSIDER, STAFF]) {
    await insertSession(db._sqlite, { rawId: RAW[id], userId: id, expiresAt: FUTURE });
  }
  return db;
}

function ctx(db, { who = MEMBER, cookie, method = 'GET', body, rawBody, url = 'https://rrmacademy.org/api/community/x' } = {}) {
  const header = cookie !== undefined ? cookie : (who ? `session=${RAW[who]}` : null);
  const headers = header ? { Cookie: header } : {};
  const request = rawBody !== undefined
    ? mockRequest(method, { rawBody, headers, url })
    : mockRequest(method, { body, headers, url });
  return { request, env: mockEnv({ DB: db }), waitUntil: mockWaitUntil() };
}

// ---------------------------------------------------------------------------
// GET /api/community/status
// ---------------------------------------------------------------------------

describe('GET /api/community/status', () => {
  let db;
  beforeEach(async () => { db = await harness(); });

  it('OPTIONS preflight answers 204', async () => {
    assert.equal((await status.onRequestOptions()).status, 204);
  });

  it('500s when the DB binding is absent', async () => {
    const { status: code, body } = await parseResponse(
      await status.onRequestGet({ request: mockRequest('GET', {}), env: mockEnv({ DB: undefined }), waitUntil: mockWaitUntil() })
    );
    assert.equal(code, 500);
    assert.equal(body.error, 'Server misconfigured');
  });

  it('reports anonymous for a caller with no session, and sets no cookie when no hint was sent', async () => {
    const res = await status.onRequestGet(ctx(db, { who: null }));
    const { status: code, body, headers } = await parseResponse(res);
    assert.equal(code, 200);
    assert.deepEqual(body, { ok: true, access: 'anonymous' });
    assert.equal(headers['set-cookie'], undefined, 'no hint cookie was sent, so none needs clearing');
  });

  it('clears a STALE auth-hint cookie when the session behind it is gone (drift recovery)', async () => {
    const res = await status.onRequestGet(ctx(db, { cookie: 'rrm_auth=1' }));
    const { body, headers } = await parseResponse(res);
    assert.equal(body.access, 'anonymous');
    assert.match(headers['set-cookie'], /^rrm_auth=;/, 'the stale hint must be actively cleared');
    assert.match(headers['set-cookie'], /Max-Age=0/);
  });

  it('an EXPIRED session degrades to anonymous, not to member', async () => {
    const expired = await harness();
    await insertSession(expired._sqlite, { rawId: 'raw-expired', userId: MEMBER, expiresAt: Math.floor(Date.now() / 1000) - 60 });
    const { body } = await parseResponse(await status.onRequestGet(ctx(expired, { cookie: 'session=raw-expired' })));
    expired.close();
    assert.equal(body.access, 'anonymous');
  });

  it('reports REGISTERED for a signed-in non-member, with a display name and role but no tier', async () => {
    const { status: code, body } = await parseResponse(await status.onRequestGet(ctx(db, { who: OUTSIDER })));
    assert.equal(code, 200);
    assert.equal(body.access, 'registered');
    assert.equal(body.user.role, 'member');
    assert.equal(body.user.name, 'Member', 'the outsider fixture has no name, so displayName falls all the way through');
    assert.equal(body.user.avatarUrl, null);
    assert.equal(body.user.tier, undefined, 'a non-member has no tier');
  });

  it('reports MEMBER with the resolved tier and the stored email opt-out', async () => {
    const { body } = await parseResponse(await status.onRequestGet(ctx(db, { who: MEMBER })));
    assert.equal(body.access, 'member');
    assert.equal(body.user.id, MEMBER);
    assert.equal(body.user.name, `Name ${MEMBER}`);
    assert.equal(body.user.role, 'member');
    assert.equal(body.user.tier, 'member');
    assert.equal(body.emailOptOut, false, 'the column defaults to 0');
  });

  it('reflects an opted-out member, and passes the avatar url through', async () => {
    const opted = await harness({
      seed(s) {
        s.prepare('UPDATE user SET community_email_opt_out = 1, avatar_url = ? WHERE id = ?')
          .run('https://cdn.example/a.png', MEMBER);
      },
    });
    const { body } = await parseResponse(await status.onRequestGet(ctx(opted, { who: MEMBER })));
    opted.close();
    assert.equal(body.emailOptOut, true);
    assert.equal(body.user.avatarUrl, 'https://cdn.example/a.png');
  });

  it('reports MEMBER with tier=staff for an admin', async () => {
    const { body } = await parseResponse(await status.onRequestGet(ctx(db, { who: STAFF })));
    assert.equal(body.access, 'member');
    assert.equal(body.user.tier, 'staff');
    assert.equal(body.user.role, 'admin');
  });

  it('a user blocked mid-request is reported as ANONYMOUS, never as registered or member', async () => {
    // Unreachable single-threaded: validateSession refuses blocked users, so the
    // first check in status.js would already have answered anonymous. Here an
    // admin blocks the account between status.js's own validateSession and
    // requireMember's user read. The assertion is the failure DIRECTION.
    const racing = await harness({
      interleave({ sql, db: sqlite }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) {
          sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(MEMBER);
        }
      },
    });
    const res = await status.onRequestGet(ctx(racing, { cookie: `session=${RAW[MEMBER]}; rrm_auth=1` }));
    const { body, headers } = await parseResponse(res);
    racing.close();
    assert.deepEqual(body, { ok: true, access: 'anonymous' }, 'a blocked account must degrade, not stay registered');
    assert.match(headers['set-cookie'], /^rrm_auth=;/, 'the hint cookie is cleared on the way down too');
  });

  it('the same mid-request block with NO hint cookie sets no cookie at all', async () => {
    const racing = await harness({
      interleave({ sql, db: sqlite }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) {
          sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(MEMBER);
        }
      },
    });
    const { body, headers } = await parseResponse(await status.onRequestGet(ctx(racing, { who: MEMBER })));
    racing.close();
    assert.equal(body.access, 'anonymous');
    assert.equal(headers['set-cookie'], undefined, 'nothing to clear when the client never claimed a session');
  });

  it('falls back to a generic registered identity when the user row vanishes mid-request', async () => {
    // Reaches the `displayName(user || {})` / `user?.role || 'member'` /
    // `user?.avatar_url || null` default arms: requireMember has already refused
    // the outsider, and the row is gone by the time status.js reads it itself.
    const racing = await harness({
      interleave({ sql, db: sqlite }) {
        if (sql.includes('SELECT name, first_name, last_name, role, avatar_url, blocked FROM user')) {
          sqlite.prepare('DELETE FROM user WHERE id = ?').run(OUTSIDER);
        }
      },
    });
    const { body } = await parseResponse(await status.onRequestGet(ctx(racing, { who: OUTSIDER })));
    racing.close();
    assert.equal(body.access, 'registered');
    assert.deepEqual(body.user, { name: 'Member', role: 'member', avatarUrl: null });
  });

  it('500s when the session lookup itself throws', async () => {
    const failing = await harness({
      interleave({ sql }) { if (sql.includes('FROM session s')) throw new Error('D1 down'); },
    });
    const { status: code, body } = await parseResponse(await status.onRequestGet(ctx(failing, { who: MEMBER })));
    failing.close();
    assert.equal(code, 500);
    assert.equal(body.error, 'Internal error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/community/memberships
// ---------------------------------------------------------------------------

describe('GET /api/community/memberships', () => {
  function seedGraph(s) {
    insertArea(s, { id: 'a1', slug: 'one' });
    insertArea(s, { id: 'a2', slug: 'two' });
    insertProject(s, { id: 'p1', slug: 'p-one', areaId: 'a1' });
    insertProject(s, { id: 'p2', slug: 'p-two', areaId: 'a2' });

    s.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(MEMBER, 'a1', 'lead');
    s.prepare('INSERT INTO area_membership (user_id, area_id, role) VALUES (?, ?, ?)').run(OTHER, 'a2', 'member');
    s.prepare('INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, ?)').run(MEMBER, 'p1', 'member');
    s.prepare('INSERT INTO project_membership (user_id, project_id, role) VALUES (?, ?, ?)').run(OTHER, 'p2', 'owner');
    s.prepare("INSERT INTO area_ownership_request (id, area_id, user_id, status) VALUES (?, ?, ?, 'pending')").run('r1', 'a2', MEMBER);
    s.prepare("INSERT INTO area_ownership_request (id, area_id, user_id, status) VALUES (?, ?, ?, 'rejected')").run('r2', 'a1', MEMBER);
    s.prepare("INSERT INTO area_ownership_request (id, area_id, user_id, status) VALUES (?, ?, ?, 'pending')").run('r3', 'a1', OTHER);
  }

  it('OPTIONS preflight answers 204', async () => {
    assert.equal((await memberships.onRequestOptions()).status, 204);
  });

  it('401s an anonymous caller and 403s an authenticated non-member', async () => {
    const db = await harness();
    assert.equal((await parseResponse(await memberships.onRequestGet(ctx(db, { who: null })))).status, 401);
    assert.equal((await parseResponse(await memberships.onRequestGet(ctx(db, { who: OUTSIDER })))).status, 403);
    db.close();
  });

  it('returns only the CALLER\'s areas, projects and pending ownership requests', async () => {
    const db = await harness({ seed: seedGraph });
    const { status: code, body } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 200);
    assert.deepEqual(body.areas, [{ areaId: 'a1', role: 'lead' }]);
    assert.deepEqual(body.projects, [{ projectId: 'p1', role: 'member' }]);
    assert.deepEqual(body.pendingOwnership, ['a2'], 'only pending requests appear; the rejected one does not');
  });

  it('a different member sees their OWN graph, never the first member\'s', async () => {
    const db = await harness({ seed: seedGraph });
    const { body } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: OTHER })));
    db.close();
    assert.deepEqual(body.areas, [{ areaId: 'a2', role: 'member' }]);
    assert.deepEqual(body.projects, [{ projectId: 'p2', role: 'owner' }]);
    assert.deepEqual(body.pendingOwnership, ['a1']);
  });

  it('a member with no memberships gets three empty arrays, not an error', async () => {
    const db = await harness();
    const { status: code, body } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 200);
    assert.deepEqual(body, { ok: true, areas: [], projects: [], pendingOwnership: [] });
  });

  it('500s when the area query fails', async () => {
    const db = await harness({
      interleave({ sql }) { if (sql.includes('SELECT area_id, role FROM area_membership')) throw new Error('D1 down'); },
    });
    const { status: code, body } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 500);
    assert.equal(body.error, 'Internal error');
  });

  it('500s when the project query fails', async () => {
    const db = await harness({
      interleave({ sql }) { if (sql.includes('SELECT project_id, role FROM project_membership')) throw new Error('D1 down'); },
    });
    const { status: code } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 500);
  });

  it('500s when the pending-ownership query fails', async () => {
    const db = await harness({
      interleave({ sql }) { if (sql.includes('FROM area_ownership_request')) throw new Error('D1 down'); },
    });
    const { status: code } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 500);
  });

  it('500s from the outer catch when the membership gate itself throws', async () => {
    const db = await harness({
      interleave({ sql }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) throw new Error('D1 down');
      },
    });
    const { status: code, body } = await parseResponse(await memberships.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 500);
    assert.equal(body.error, 'Internal error');
  });

  it('500s when the DB binding is absent -- the endpoint\'s own 500 branch sits behind requireMember\'s', async () => {
    const { status: code, body } = await parseResponse(await memberships.onRequestGet({
      request: mockRequest('GET', { headers: { Cookie: `session=${RAW[MEMBER]}` } }),
      env: mockEnv({ DB: undefined }),
      waitUntil: mockWaitUntil(),
    }));
    assert.equal(code, 500);
    assert.equal(body.error, 'Server misconfigured');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/community/notifications
// ---------------------------------------------------------------------------

describe('PATCH /api/community/notifications', () => {
  const patch = (db, opts) => notifications.onRequestPatch(ctx(db, { method: 'PATCH', ...opts }));
  const storedOptOut = (db, user = MEMBER) =>
    db._sqlite.prepare('SELECT community_email_opt_out AS v FROM user WHERE id = ?').get(user).v;

  it('OPTIONS preflight answers 204', async () => {
    assert.equal((await notifications.onRequestOptions()).status, 204);
  });

  it('401s an anonymous caller and 403s an authenticated non-member, writing nothing', async () => {
    const db = await harness();
    assert.equal((await parseResponse(await patch(db, { who: null, body: { emailOptOut: true } }))).status, 401);
    assert.equal((await parseResponse(await patch(db, { who: OUTSIDER, body: { emailOptOut: true } }))).status, 403);
    assert.equal(storedOptOut(db, OUTSIDER), 0, 'a refused request must not have written the column');
    db.close();
  });

  it('400s a malformed JSON body', async () => {
    const db = await harness();
    const { status: code, body } = await parseResponse(await patch(db, { rawBody: '{nope' }));
    db.close();
    assert.equal(code, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s a body that is not a JSON object', async () => {
    const db = await harness();
    for (const rawBody of ['null', '[]', '"s"', '1']) {
      const { status: code, body } = await parseResponse(await patch(db, { rawBody }));
      assert.equal(code, 400, `body ${rawBody} should be refused`);
      assert.equal(body.error, 'Invalid payload');
    }
    db.close();
  });

  it('400s a non-boolean emailOptOut, including the truthy strings a form would send', async () => {
    const db = await harness();
    for (const emailOptOut of [undefined, 'true', 1, 0, null, {}]) {
      const { status: code, body } = await parseResponse(await patch(db, { body: { emailOptOut } }));
      assert.equal(code, 400, `${JSON.stringify(emailOptOut)} should be refused`);
      assert.equal(body.error, 'emailOptOut must be boolean');
    }
    assert.equal(storedOptOut(db), 0);
    db.close();
  });

  it('true stores 1 and false stores 0, and the response echoes what was stored', async () => {
    const db = await harness();
    const on = await parseResponse(await patch(db, { body: { emailOptOut: true } }));
    assert.deepEqual(on.body, { ok: true, emailOptOut: true });
    assert.equal(storedOptOut(db), 1, 'the boolean is coerced to the INTEGER the column declares');

    const off = await parseResponse(await patch(db, { body: { emailOptOut: false } }));
    assert.deepEqual(off.body, { ok: true, emailOptOut: false });
    assert.equal(storedOptOut(db), 0);
    db.close();
  });

  it('writes only the CALLER\'s row, taking the user id from the session and never the body', async () => {
    const db = await harness();
    await patch(db, { who: MEMBER, body: { emailOptOut: true, userId: OTHER, id: OTHER } });
    assert.equal(storedOptOut(db, MEMBER), 1);
    assert.equal(storedOptOut(db, OTHER), 0, 'a userId in the body must not redirect the write');
    db.close();
  });

  it('500s when the UPDATE fails', async () => {
    const db = await harness({
      interleave({ sql }) { if (sql.includes('UPDATE user SET community_email_opt_out')) throw new Error('D1 down'); },
    });
    const { status: code, body } = await parseResponse(await patch(db, { body: { emailOptOut: true } }));
    db.close();
    assert.equal(code, 500);
    assert.equal(body.error, 'Internal error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/community/members
// ---------------------------------------------------------------------------

describe('GET /api/community/members', () => {
  it('OPTIONS preflight answers 204', async () => {
    assert.equal((await members.onRequestOptions()).status, 204);
  });

  it('401s an anonymous caller and 403s an authenticated non-member', async () => {
    const db = await harness();
    assert.equal((await parseResponse(await members.onRequestGet(ctx(db, { who: null })))).status, 401);
    assert.equal((await parseResponse(await members.onRequestGet(ctx(db, { who: OUTSIDER })))).status, 403);
    db.close();
  });

  it('maps tier labels and achievement labels onto the roster, de-duplicating aliases', async () => {
    const db = await harness({
      seed(s) {
        insertLabel(s, MEMBER, 'Uterus Hero \u{1F496}');
        insertLabel(s, MEMBER, 'Donor \u{1F44F}');
        // Two spellings of the SAME course label collapse to one display badge.
        insertLabel(s, MEMBER, 'Masterclass in Endometriosis & Surgery');
        insertLabel(s, MEMBER, 'Masterclass in Endometriosis and Surgery');
        insertLabel(s, MEMBER, 'Some Unmapped Label');
      },
    });
    const { status: code, body } = await parseResponse(await members.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 200);
    const me = body.members.find(m => m.id === MEMBER);
    assert.equal(me.tier, 'hero');
    assert.deepEqual(me.achievements.slice().sort(), ['Donor', 'Endo Masterclass']);
    assert.ok(!me.achievements.includes('Some Unmapped Label'), 'an unmapped label is not a badge');
  });

  it('a member with no labels at all reports a null tier and no achievements', async () => {
    const db = await harness();
    const { body } = await parseResponse(await members.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    const me = body.members.find(m => m.id === MEMBER);
    assert.equal(me.tier, null);
    assert.deepEqual(me.achievements, []);
    assert.equal(me.avatarUrl, null);
  });

  it('falls back to displayName when the stored name is empty, and reports last activity', async () => {
    const db = await harness({
      seed(s) {
        s.prepare('UPDATE user SET name = NULL, first_name = ?, last_name = ? WHERE id = ?')
          .run('Ada', 'Lovelace', MEMBER);
        s.prepare("INSERT INTO community_post (id, author_id, type, title, created_at) VALUES ('cp1', ?, 'discussion', 'Hi', '2026-06-01T00:00:00Z')").run(MEMBER);
        s.prepare("INSERT INTO community_post (id, author_id, type, title, created_at) VALUES ('cp2', ?, 'discussion', 'Older', '2026-01-01T00:00:00Z')").run(MEMBER);
        s.prepare("INSERT INTO community_comment (id, post_id, author_id, content, created_at) VALUES ('cc1', 'cp1', ?, 'Nice', '2026-07-01T00:00:00Z')").run(MEMBER);
      },
    });
    const { body } = await parseResponse(await members.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    const me = body.members.find(m => m.id === MEMBER);
    assert.equal(me.name, 'Ada L.');
    assert.equal(me.lastActive, '2026-07-01T00:00:00Z', 'the newest of posts AND comments wins');
    assert.equal(typeof me.joinedAt, 'string');
  });

  it('never lists a non-member, even one holding a course achievement label', async () => {
    const db = await harness({
      seed(s) { insertLabel(s, OUTSIDER, 'Donor \u{1F44F}'); },
    });
    const { body } = await parseResponse(await members.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.deepEqual(body.members.map(m => m.id).sort(), [MEMBER, OTHER, STAFF].sort());
  });

  it('returns an EMPTY roster for a Stripe-only member the roster predicate does not admit', async () => {
    // Not a contrived shape: requireMember grants access off a live Stripe
    // subscription alone, while STUC_MEMBER_WHERE additionally demands the
    // 'Save the Uterus Club' label. A paying member whose label write never
    // landed therefore passes the gate and then sees nobody, including
    // themselves. This is the only route into the early empty-list return, and
    // it is a real divergence between the two predicates, not a fixture trick.
    const net = stubExternalFetch({
      stripe: stripeRoutes({
        '/v1/subscriptions': {
          object: 'list', has_more: false,
          data: [{ id: 'sub_1', status: 'active', metadata: {}, items: { data: [{ price: { id: 'p', unit_amount: 900 } }] } }],
        },
      }),
    });
    const db = communityD1({
      seed(s) { insertUser(s, { id: 'u_stripe_only', email: 'so@example.com', stripe_customer_id: 'cus_so' }); },
    });
    await insertSession(db._sqlite, { rawId: 'raw-stripe-only', userId: 'u_stripe_only', expiresAt: FUTURE });

    const { status: code, body } = await parseResponse(await members.onRequestGet({
      request: mockRequest('GET', { headers: { Cookie: 'session=raw-stripe-only' } }),
      env: mockEnv({ DB: db }),
      waitUntil: mockWaitUntil(),
    }));
    db.close();
    net.restore();
    assert.equal(code, 200);
    assert.deepEqual(body, { ok: true, members: [] });
  });

  it('500s when the roster query fails', async () => {
    const db = await harness({
      interleave({ sql }) { if (sql.includes('SELECT DISTINCT u.id')) throw new Error('D1 down'); },
    });
    const { status: code, body } = await parseResponse(await members.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 500);
    assert.equal(body.error, 'Internal error');
  });

  it('500s when the label query fails', async () => {
    const db = await harness({
      interleave({ sql }) { if (sql.includes('FROM user_label ul')) throw new Error('D1 down'); },
    });
    const { status: code } = await parseResponse(await members.onRequestGet(ctx(db, { who: MEMBER })));
    db.close();
    assert.equal(code, 500);
  });
});
