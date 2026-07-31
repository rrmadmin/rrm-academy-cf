/**
 * The two authorization guards that decide whether an /api/admin/* request is
 * allowed to carry a user, and that NOTHING in the suite was holding.
 *
 *   functions/api/auth/_shared.js   validateSession -- the session expiry gate
 *   functions/api/admin/_middleware.js            -- its own `!user.blocked` arm
 *
 * Both were confirmed by mutation against the full 1653-test suite before this
 * file existed:
 *
 *   `if (now >= row.expires_at)` -> `if (false)`      SURVIVED (0 failures)
 *   `if (user && !user.blocked)` -> `if (user)`       SURVIVED (0 failures)
 *
 * The first means an EXPIRED SESSION BEING HONOURED would have shipped green:
 * no test anywhere in the repository pinned session expiry. The second is the
 * middleware's own blocked-user arm.
 *
 * WHY THE MIDDLEWARE ARM LOOKS DEAD AND IS NOT
 * --------------------------------------------
 * validateSession refuses a blocked user before the middleware ever runs its
 * own check (`if (row.blocked) return null`, _shared.js), reading `u.blocked`
 * off a JOIN against the same user row. So on a single consistent snapshot the
 * middleware's `!user.blocked` cannot fire, and the existing glossary-admin
 * "blocked superadmin -> 401" tests are in fact pinning validateSession, not
 * the middleware. Under mutation they behave identically: deleting EITHER guard
 * alone still yields 401, which is precisely why neither mutant died.
 *
 * The middleware arm is reachable on the path the two reads do not share: the
 * user is blocked BETWEEN validateSession's JOIN read and the middleware's own
 * `SELECT ... FROM user WHERE id = ?`. That is a real production window -- a
 * superadmin blocking an abusive account that has an admin request in flight --
 * and it is the only thing the middleware arm actually defends. It is pinned
 * here through _d1-sqlite.mjs's `interleave` hook, which exists for exactly
 * this (its own header: "a scripted stand-in for a concurrent writer"). The
 * write is a real UPDATE against the real engine; `interleave` only decides
 * WHEN it lands.
 *
 * The distant invariant the middleware leans on -- validateSession refusing a
 * blocked user -- is pinned here too, by name, so the dependency is stated in
 * one place rather than inferred across two files.
 *
 * BOUNDARY DISCIPLINE
 * -------------------
 * The expiry tests hit `now === expires_at` EXACTLY, not a comfortable value
 * either side. `>=` and `>` differ only on that single second, so a fixture
 * that used "an hour ago" and "a day from now" would leave the off-by-one
 * alive. Date.now() is stubbed to a fixed instant so the boundary is exact
 * rather than racing the clock.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';
import { faultyDb } from './_glossary-fixtures.mjs';
import { validateSession, getSessionIdFromCookie } from '../functions/api/auth/_shared.js';

const adminMiddleware = await import('../functions/api/admin/_middleware.js');
const glossaryTerms = await import('../functions/api/admin/glossary/terms/index.js');

/** A fixed instant, so `now === expires_at` is a value we choose, not a race. */
const NOW_S = 1_800_000_000; // 2027-01-15T08:00:00Z
const NOW_MS = NOW_S * 1000;

/** The middleware's own user read, distinct from validateSession's JOIN. */
const MIDDLEWARE_USER_READ = 'FROM user WHERE id = ?';
/** validateSession's read. Named so ordering assertions say what they mean. */
const SESSION_JOIN_READ = 'FROM session s';

function adminRequest(cookie) {
  return mockRequest('GET', {
    url: 'https://rrmacademy.org/api/admin/glossary/terms',
    headers: cookie ? { Cookie: `session=${cookie}` } : {},
  });
}

// ============================================================ session expiry

describe('validateSession -- the session expiry gate, at the exact boundary', () => {
  let db;

  beforeEach(() => {
    db = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin' });
      },
    });
  });

  afterEach(() => db.close());

  /**
   * Date.now() is read twice inside validateSession (the expiry compare, then
   * the renewal expiry it writes), so it is stubbed rather than approximated.
   */
  function freezeClock(t) {
    t.mock.method(Date, 'now', () => NOW_MS);
  }

  it('refuses a session that expired one second ago', async (t) => {
    freezeClock(t);
    await insertSession(db._sqlite, { rawId: 'sess-past', userId: 'u_super', expiresAt: NOW_S - 1 });
    assert.equal(await validateSession(db, 'sess-past'), null);
  });

  it('refuses a session at the EXACT boundary: now === expires_at', async (t) => {
    freezeClock(t);
    await insertSession(db._sqlite, { rawId: 'sess-now', userId: 'u_super', expiresAt: NOW_S });
    // This is the assertion that separates `>=` from `>`. A fixture using a
    // comfortable "expired an hour ago" would pass under both.
    assert.equal(
      await validateSession(db, 'sess-now'),
      null,
      'expires_at === now must be treated as expired: the gate is >=, not >'
    );
  });

  it('accepts a session with one second left -- the tightest possible accept', async (t) => {
    freezeClock(t);
    await insertSession(db._sqlite, { rawId: 'sess-edge', userId: 'u_super', expiresAt: NOW_S + 1 });
    const session = await validateSession(db, 'sess-edge');
    assert.ok(session, 'one second before expiry must still validate');
    assert.equal(session.userId, 'u_super');
    // Inside the 15-day renewal threshold, so the accept path ran all the way
    // through, not just past the expiry compare.
    assert.equal(session.renewed, true);
  });

  it('does not renew a session that is nowhere near expiry', async (t) => {
    freezeClock(t);
    const far = NOW_S + 30 * 24 * 60 * 60;
    await insertSession(db._sqlite, { rawId: 'sess-fresh', userId: 'u_super', expiresAt: far });
    const session = await validateSession(db, 'sess-fresh');
    assert.ok(session);
    assert.equal(session.renewed, false);
    assert.equal(session.expiresAt, far);
  });

  it('leaves the expired row in place -- expiry is a read-side refusal, not a write', async (t) => {
    freezeClock(t);
    await insertSession(db._sqlite, { rawId: 'sess-past2', userId: 'u_super', expiresAt: NOW_S - 1 });
    const before = db._sqlite.prepare('SELECT COUNT(*) AS n FROM session').get().n;
    await validateSession(db, 'sess-past2');
    const after = db._sqlite.prepare('SELECT COUNT(*) AS n FROM session').get().n;
    assert.equal(after, before, 'the cron sweep owns cleanup; the hot path must not write');
    assert.ok(
      !db._calls.some((c) => /^\s*(DELETE|UPDATE)/i.test(c.sql)),
      'no DELETE or UPDATE may be issued while refusing an expired session'
    );
  });
});

describe('an expired session cannot reach an /api/admin/* handler', () => {
  it('an expired cookie answers 401, with no user populated', async (t) => {
    t.mock.method(Date, 'now', () => NOW_MS);
    const db = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin' });
      },
    });
    await insertSession(db._sqlite, { rawId: 'sess-expired', userId: 'u_super', expiresAt: NOW_S });

    const context = {
      request: adminRequest('sess-expired'),
      env: mockEnv({ DB: db }),
      params: {},
      data: {},
      waitUntil: mockWaitUntil(),
    };
    context.next = () => glossaryTerms.onRequestGet(context);
    const { status, body } = await parseResponse(await adminMiddleware.onRequest(context));

    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
    assert.equal(context.data.user, undefined);
    db.close();
  });
});

// ======================================================= blocked-user guards

describe('validateSession -- the blocked-user invariant admin/_middleware.js leans on', () => {
  it('returns null for a blocked user even with a live, unexpired session', async () => {
    const db = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_blocked', email: 'blocked@example.com', role: 'superadmin', blocked: 1 });
      },
    });
    const future = Math.floor(Date.now() / 1000) + 86400;
    await insertSession(db._sqlite, { rawId: 'sess-blocked', userId: 'u_blocked', expiresAt: future });

    assert.equal(
      await validateSession(db, 'sess-blocked'),
      null,
      'admin/_middleware.js only reaches its own blocked check when this returns a session'
    );
    db.close();
  });

  it('returns a session for the same user once unblocked -- the block is what refused it', async () => {
    const db = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_ok', email: 'ok@example.com', role: 'superadmin', blocked: 0 });
      },
    });
    const future = Math.floor(Date.now() / 1000) + 86400;
    await insertSession(db._sqlite, { rawId: 'sess-ok', userId: 'u_ok', expiresAt: future });

    const session = await validateSession(db, 'sess-ok');
    assert.ok(session);
    assert.equal(session.userId, 'u_ok');
    db.close();
  });
});

describe('admin/_middleware.js -- its OWN blocked check, on the one path that reaches it', () => {
  /**
   * Builds the harness with a concurrent `UPDATE user SET blocked = 1` scripted
   * to land immediately before the middleware's own user read -- i.e. AFTER
   * validateSession has already read blocked = 0 off its JOIN and returned a
   * session. Everything is a real statement against the real engine; the hook
   * only chooses the instant.
   */
  function raceDb() {
    let blockedDuringRace = false;
    const db = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin', blocked: 0 });
      },
      interleave: ({ sql, db: sqlite }) => {
        if (!blockedDuringRace && sql.includes(MIDDLEWARE_USER_READ)) {
          blockedDuringRace = true;
          sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run('u_super');
        }
      },
    });
    return db;
  }

  async function runMiddleware(db, next) {
    const context = {
      request: adminRequest('sess-super'),
      env: mockEnv({ DB: db }),
      params: {},
      data: {},
      waitUntil: mockWaitUntil(),
    };
    context.next = () => next(context);
    return { context, response: await adminMiddleware.onRequest(context) };
  }

  let db;
  beforeEach(async () => {
    db = raceDb();
    const future = Math.floor(Date.now() / 1000) + 86400;
    await insertSession(db._sqlite, { rawId: 'sess-super', userId: 'u_super', expiresAt: future });
  });

  afterEach(() => db.close());

  it('a user blocked between the session read and the user read is NOT populated', async () => {
    let seen = 'next-never-ran';
    const { context } = await runMiddleware(db, (ctx) => {
      seen = ctx.data.user;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    // Ordering is the whole claim: validateSession ran first and returned a
    // session (it saw blocked = 0), so the refusal below can only be the
    // middleware's own `!user.blocked` arm.
    const sessionReadIdx = db._calls.findIndex((c) => c.sql.includes(SESSION_JOIN_READ));
    const userReadIdx = db._calls.findIndex((c) => c.sql.includes(MIDDLEWARE_USER_READ));
    assert.ok(sessionReadIdx !== -1, 'validateSession must have run');
    assert.ok(userReadIdx > sessionReadIdx, 'the user read must follow the session read');
    assert.equal(db._sqlite.prepare('SELECT blocked FROM user WHERE id = ?').get('u_super').blocked, 1);

    assert.equal(seen, undefined, 'a blocked user must never be handed to the handler');
    assert.equal(context.data.user, undefined);
    assert.equal(context.data.session, undefined, 'the session must not be published either');
  });

  it('and the admin endpoint therefore answers 401, not 200, mid-race', async () => {
    const { response } = await runMiddleware(db, (ctx) => glossaryTerms.onRequestGet(ctx));
    const { status, body } = await parseResponse(response);
    assert.equal(status, 401, 'a superadmin blocked mid-request must not keep admin access');
    assert.equal(body.error, 'Unauthorized');
  });

  it('control: without the mid-race block the same session reaches the handler with a user', async () => {
    const clean = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin', blocked: 0 });
      },
    });
    const future = Math.floor(Date.now() / 1000) + 86400;
    await insertSession(clean._sqlite, { rawId: 'sess-super', userId: 'u_super', expiresAt: future });

    const context = {
      request: adminRequest('sess-super'),
      env: mockEnv({ DB: clean }),
      params: {},
      data: {},
      waitUntil: mockWaitUntil(),
    };
    let seen = null;
    context.next = () => {
      seen = context.data.user;
      return glossaryTerms.onRequestGet(context);
    };
    const { status } = await parseResponse(await adminMiddleware.onRequest(context));

    assert.equal(status, 200, 'the race is what refuses; the fixture itself must not');
    assert.equal(seen.id, 'u_super');
    assert.equal(seen.blocked, 0);
    assert.ok(context.data.session, 'the session is published alongside the user');
    clean.close();
  });
});

// ========================================================= fail-closed catch

describe('admin/_middleware.js -- the catch arm, which nothing had executed', () => {
  /**
   * The catch block was the last uncovered code in this file (lines 38-39 at
   * 41/43). It is the fail-closed contract: a D1 fault during authorization
   * must leave `context.data.user` undefined so the endpoint answers 401,
   * rather than rejecting the middleware promise and surfacing an edge error
   * on an admin route. Deleting the try/catch turns each case below from a
   * 401 into a thrown D1_ERROR.
   */
  async function withFault(on) {
    const real = sqliteD1({
      seed: (s) => {
        insertUser(s, { id: 'u_super', email: 'super@example.com', role: 'superadmin' });
      },
    });
    const future = Math.floor(Date.now() / 1000) + 86400;
    await insertSession(real._sqlite, { rawId: 'sess-super', userId: 'u_super', expiresAt: future });

    const context = {
      request: adminRequest('sess-super'),
      env: mockEnv({ DB: faultyDb(real, { on }) }),
      params: {},
      data: {},
      waitUntil: mockWaitUntil(),
    };
    context.next = () => glossaryTerms.onRequestGet(context);
    const parsed = await parseResponse(await adminMiddleware.onRequest(context));
    real.close();
    return { parsed, context };
  }

  it('a D1 fault on the session read fails CLOSED: 401, not a rejected promise', async () => {
    const { parsed, context } = await withFault(SESSION_JOIN_READ);
    assert.equal(parsed.status, 401);
    assert.equal(parsed.body.error, 'Unauthorized');
    assert.equal(context.data.user, undefined);
  });

  it('a D1 fault on the middleware user read also fails CLOSED', async () => {
    const { parsed, context } = await withFault(MIDDLEWARE_USER_READ);
    assert.equal(parsed.status, 401);
    assert.equal(parsed.body.error, 'Unauthorized');
    assert.equal(context.data.user, undefined);
  });
});

// ============================================================ cookie parsing

describe('getSessionIdFromCookie -- what the guards above are handed', () => {
  const read = (cookie) => getSessionIdFromCookie(mockRequest('GET', { headers: cookie === null ? {} : { Cookie: cookie } }));

  it('returns null with no Cookie header at all', () => {
    assert.equal(read(null), null);
  });

  it('reads the session cookie when it is the only one', () => {
    assert.equal(read('session=abc123'), 'abc123');
  });

  it('reads it from the middle of a cookie jar', () => {
    assert.equal(read('rrm_auth=1; session=abc123; other=x'), 'abc123');
  });

  it('does not match a cookie whose name merely ENDS with session', () => {
    assert.equal(read('fake_session=evil'), null, 'the boundary in the regex is load-bearing');
  });
});
