/**
 * functions/api/community/_shared.js -- the CANONICAL community membership gate.
 *
 * WHY THIS FILE IS PINNED HARDEST
 * requireMember() is the single decision every other endpoint on this product
 * delegates to. It sorts a caller into exactly one of four tiers -- staff,
 * member, authenticated-non-member, anonymous -- and every join/leave/roster/
 * notification handler in functions/api/community/ trusts that answer without
 * re-deriving it. If requireMember is wrong, every gate in the product is wrong
 * at once, and the direction of the wrongness is asymmetric: a gate that fails
 * CLOSED locks a paying member out of a forum, while a gate that fails OPEN
 * hands the members-only surface to anyone with a stale cookie. So the tests
 * below assert the DIRECTION explicitly rather than just "some Response came
 * back": every degradation case names the tier it must fall to.
 *
 * WHY A REAL SQLITE ENGINE
 * The membership decision is mostly SQL, and the hard parts are exactly the
 * parts a substring-matching mock cannot model:
 *   - the recency guard
 *     `COALESCE(next_expected_at, datetime(last_order_at,'+31 days')) >= datetime('now','-7 days')`
 *     which is the ONLY thing separating a live Wix subscriber from a lapsed one
 *     whose 'active' row froze when it fell out of the Wix feed;
 *   - `migration_status NOT IN (...)`, which excludes members who already moved
 *     to Stripe so they are not counted twice;
 *   - `email = ? COLLATE NOCASE` against a column that schema.sql declares
 *     COLLATE NOCASE.
 * Under test/_helpers.js mockDB each of those would hand back whatever row the
 * test declared, so "this lapsed subscriber is refused" would be a restatement
 * of the fixture rather than a fact about the query. Everything here runs on
 * node:sqlite loaded with the committed schema (test/_community-sqlite.mjs).
 *
 * WHAT IS STILL FAKED, AND WHAT THAT CANNOT DISTINGUISH
 *  - Stripe is test/_helpers.js stubExternalFetch. These tests prove what
 *    requireMember does GIVEN a subscription list; they cannot prove Stripe
 *    returns that list for a real customer.
 *  - COMMUNITY_KV is mockKVJson(). The production binding honours
 *    get(key,'json'); the plain mockKV() stub does not, which is why the cache
 *    tests below use mockKVJson and say so.
 *  - Two branches (a user row vanishing mid-request, and a user being blocked
 *    mid-request) are unreachable through a single-threaded caller, because
 *    validateSession JOINs `user` and refuses blocked rows before requireMember
 *    ever looks. They are reached here with the harness `interleave` hook, a
 *    scripted stand-in for a concurrent writer. That proves the branch behaves
 *    as written; it does not prove the real race window has that shape.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mockRequest, mockEnv, mockKVJson, parseResponse, stubExternalFetch, stripeRoutes,
} from './_helpers.js';
import {
  insertUser, insertWixSubscription, insertLabel, insertSession, schemaCollation,
} from './_d1-sqlite.mjs';
import { communityD1 } from './_community-sqlite.mjs';
import {
  requireMember, displayName, tierFromLabel, roleAtLeast,
  TIER_DISPLAY, TIER_LABEL_MAP, STUC_MEMBER_WHERE,
  canCreateType, canEditPost, canDeletePost, canPin, canDeleteComment,
  canResolveFlag, canManageRoles, canSetRole,
} from '../functions/api/community/_shared.js';

const USER = 'u_ada';
const RAW = 'raw-session-cookie-ada';
const EMAIL = 'ada@example.com';
const FUTURE = Math.floor(Date.now() / 1000) + 30 * 86400;
const PAST = Math.floor(Date.now() / 1000) - 3600;

const DAY_MS = 86400e3;
const daysFromNow = (n) => new Date(Date.now() + n * DAY_MS).toISOString();

/** Route every Stripe call through a per-test handler so one test can make it fail. */
let stripeHandler;
let net;
before(() => { net = stubExternalFetch({ stripe: (call) => stripeHandler(call) }); });
after(() => { net.restore(); });

function subsList(data) {
  return stripeRoutes({ '/v1/subscriptions': { object: 'list', data, has_more: false } });
}

/** Builds the rrm-auth + action-areas harness with one user and one live session. */
async function seeded({ user = {}, extra, interleave, expiresAt = FUTURE } = {}) {
  const db = communityD1({
    seed(sqlite) {
      insertUser(sqlite, { id: USER, email: EMAIL, ...user });
      if (extra) extra(sqlite);
    },
    interleave,
  });
  await insertSession(db._sqlite, { rawId: RAW, userId: USER, expiresAt });
  return db;
}

const req = (raw) => mockRequest('GET', { headers: raw ? { Cookie: `session=${raw}` } : {} });

/**
 * Calls the gate and reports which WAY it went. Every assertion below names one
 * of `granted` / `denied`, so a test can never pass by getting "some answer".
 */
async function gate(db, { raw = RAW, env } = {}) {
  const result = await requireMember(req(raw), env ?? mockEnv({ DB: db }));
  if (result instanceof Response) return { denied: await parseResponse(result), granted: null };
  return { granted: result, denied: null };
}

// ---------------------------------------------------------------------------
// The four tiers
// ---------------------------------------------------------------------------

describe('requireMember -- tier resolution', () => {
  it('ANONYMOUS: no session cookie at all resolves to 401, never to a member object', async () => {
    const db = await seeded();
    const { granted, denied } = await gate(db, { raw: null });
    db.close();
    assert.equal(granted, null, 'a request with no cookie must NOT be granted membership');
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error, 'Not authenticated');
  });

  it('AUTHENTICATED-NON-MEMBER: a verified user with no subscription of any kind gets 403, not 401 and not access', async () => {
    stripeHandler = subsList([]);
    const db = await seeded();
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    // 403 not 401 is the distinction that matters: the client renders "join"
    // rather than "log in", and the caller IS authenticated.
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Membership required');
  });

  it('MEMBER: an explicit legacy grandfather label grants tier=member with no payment lookup at all', async () => {
    const db = await seeded({ extra: (s) => insertLabel(s, USER, 'STUC Legacy Grandfather') });
    stripeHandler = () => { throw new Error('Stripe must not be consulted on the grandfather path'); };
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(denied, null);
    assert.equal(granted.tier, 'member');
    assert.equal(granted.user.id, USER);
    assert.equal(granted.session.userId, USER);
  });

  it('STAFF: a mod is staff even with an unverified email and no subscription whatsoever', async () => {
    const db = await seeded({ user: { role: 'mod', email_verified: 0 } });
    stripeHandler = () => { throw new Error('Stripe must not be consulted for staff'); };
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(denied, null);
    assert.equal(granted.tier, 'staff', 'staff bypasses both the email-verified gate and the subscription check');
  });

  it('STAFF: admin and superadmin resolve to staff; a plain member role does not', async () => {
    for (const role of ['mod', 'admin', 'superadmin']) {
      const db = await seeded({ user: { role } });
      const { granted } = await gate(db);
      db.close();
      assert.equal(granted.tier, 'staff', `${role} should be staff`);
    }
    // The negative half: 'member' must fall through to the payment checks.
    stripeHandler = subsList([]);
    const db = await seeded({ user: { role: 'member' } });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 403, 'role=member is NOT staff and must be subscription-checked');
  });

  it('roleAtLeast is re-exported from the gate module and orders the four roles', () => {
    assert.equal(roleAtLeast('member', 'mod'), false);
    assert.equal(roleAtLeast('mod', 'mod'), true);
    assert.equal(roleAtLeast('admin', 'mod'), true);
    assert.equal(roleAtLeast('superadmin', 'admin'), true);
    assert.equal(roleAtLeast('admin', 'superadmin'), false);
    assert.equal(roleAtLeast('member', 'nonsense'), false);
  });
});

// ---------------------------------------------------------------------------
// Failure direction: every degradation must land on a LESS privileged tier
// ---------------------------------------------------------------------------

describe('requireMember -- an invalid session degrades to anonymous, never to member', () => {
  it('an EXPIRED session is refused with 401 rather than honoured', async () => {
    const db = await seeded({ expiresAt: PAST });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null, 'an expired session must not grant membership');
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error, 'Not authenticated');
  });

  it('a session id that matches no row is refused with 401', async () => {
    const db = await seeded();
    const { granted, denied } = await gate(db, { raw: 'not-a-real-session-id' });
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 401);
  });

  it('a BLOCKED user is refused: validateSession rejects first, so the caller lands on 401 anonymous', async () => {
    const db = await seeded({ user: { blocked: 1 } });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null, 'a blocked account must never be granted membership');
    assert.equal(denied.status, 401);
  });

  it('a user blocked BETWEEN session validation and the user read gets 403 Account suspended', async () => {
    // Unreachable single-threaded (validateSession refuses blocked rows), so a
    // scripted concurrent writer stands in: an admin blocking the account while
    // the request is in flight. Asserts the branch degrades, not escalates.
    const db = await seeded({
      interleave({ sql, db: sqlite }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) {
          sqlite.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run(USER);
        }
      },
    });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Account suspended');
  });

  it('a user row deleted mid-request gets 401 User not found', async () => {
    const db = await seeded({
      interleave({ sql, db: sqlite }) {
        if (sql.includes('stripe_customer_id, avatar_url, blocked, email_verified FROM user')) {
          sqlite.prepare('DELETE FROM user WHERE id = ?').run(USER);
        }
      },
    });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 401);
    assert.equal(denied.body.error, 'User not found');
  });

  it('an UNVERIFIED email blocks a non-staff caller at 403 with the resend copy', async () => {
    const db = await seeded({ user: { email_verified: 0 } });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 403);
    assert.match(denied.body.error, /verify your email/i);
  });

  it('a missing DB binding is a 500, not an implicit grant', async () => {
    const result = await requireMember(req(RAW), mockEnv({ DB: undefined }));
    assert.ok(result instanceof Response);
    const { status, body } = await parseResponse(result);
    assert.equal(status, 500);
    assert.equal(body.error, 'Server misconfigured');
  });
});

// ---------------------------------------------------------------------------
// Lapsed membership: the recency guard is the whole point
// ---------------------------------------------------------------------------

describe('requireMember -- Wix subscription recency', () => {
  const wixUser = (rest) => ({ extra: (s) => insertWixSubscription(s, { email: EMAIL, ...rest }) });

  it('the harness is holding a real column collation, not one the test invented', () => {
    assert.equal(schemaCollation('wix_subscription', 'email'), 'NOCASE');
  });

  it('a genuinely active recent subscriber is a member at the row tier', async () => {
    const db = await seeded(wixUser({ tier: 'hero' }));
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(denied, null);
    assert.equal(granted.tier, 'hero');
  });

  it('a Wix row with an empty tier falls back to the member default', async () => {
    // The `wixSub.tier || 'member'` default arm: schema.sql declares
    // wix_subscription.tier NOT NULL with no CHECK, so a literal NULL is
    // un-storable (the harness raises the constraint, which is the point of
    // running a real engine) but an empty string the sync worker wrote is not.
    // That is the reachable shape of this default, so that is what is tested.
    const db = await seeded(wixUser({ tier: '' }));
    const { granted } = await gate(db);
    db.close();
    assert.equal(granted.tier, 'member');
  });

  it('LAPSED: status is still active but next_expected_at is long past, so the row does NOT grant access', async () => {
    stripeHandler = subsList([]);
    const db = await seeded(wixUser({ tier: 'hero', next_expected_at: daysFromNow(-120) }));
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null, 'a frozen stale active row must not keep granting membership');
    assert.equal(denied.status, 403);
  });

  it('the grace window is real: a payment 3 days overdue still counts, 30 days does not', async () => {
    const inGrace = await seeded(wixUser({ next_expected_at: daysFromNow(-3) }));
    const okRes = await gate(inGrace);
    inGrace.close();
    assert.equal(okRes.granted?.tier, 'member', 'inside the ~7 day grace the member keeps access');

    stripeHandler = subsList([]);
    const outOfGrace = await seeded(wixUser({ next_expected_at: daysFromNow(-30) }));
    const badRes = await gate(outOfGrace);
    outOfGrace.close();
    assert.equal(badRes.granted, null, 'past the grace the same row must stop granting access');
  });

  it('with next_expected_at NULL the COALESCE falls back to last_order_at + 31 days', async () => {
    const recent = await seeded(wixUser({ next_expected_at: null, last_order_at: daysFromNow(-10) }));
    const okRes = await gate(recent);
    recent.close();
    assert.equal(okRes.granted?.tier, 'member', 'ordered 10 days ago: +31d window is still open');

    stripeHandler = subsList([]);
    const stale = await seeded(wixUser({ next_expected_at: null, last_order_at: daysFromNow(-90) }));
    const badRes = await gate(stale);
    stale.close();
    assert.equal(badRes.granted, null, 'ordered 90 days ago: the +31d window closed');
  });

  it('a cancelled Wix row does not grant access', async () => {
    stripeHandler = subsList([]);
    const db = await seeded(wixUser({ status: 'cancelled' }));
    const { granted } = await gate(db);
    db.close();
    assert.equal(granted, null);
  });

  it('a member already migrated to Stripe is excluded from the Wix path (no double count)', async () => {
    for (const migration_status of ['stripe_active', 'migrated', 'fully_exited']) {
      stripeHandler = subsList([]);
      const db = await seeded(wixUser({ migration_status }));
      const { granted } = await gate(db);
      db.close();
      assert.equal(granted, null, `migration_status=${migration_status} must not grant via Wix`);
    }
  });

  it('the Wix email match is case-insensitive, so a mixed-case signup still resolves', async () => {
    const db = await seeded({
      user: { email: 'Ada@Example.COM' },
      extra: (s) => insertWixSubscription(s, { email: 'ada@example.com', tier: 'superhero' }),
    });
    const { granted } = await gate(db);
    db.close();
    assert.equal(granted.tier, 'superhero');
  });
});

// ---------------------------------------------------------------------------
// Infrastructure failure paths
// ---------------------------------------------------------------------------

describe('requireMember -- degraded infrastructure', () => {
  /** Makes the ACTIVE-subscriber lookup throw, leaving the "any row" lookup working. */
  const wixThrows = ({ sql }) => {
    if (sql.includes('SELECT tier FROM wix_subscription')) throw new Error('D1 unavailable');
  };

  it('a failed Wix lookup for a user with no Stripe customer returns 503 retryable, not a silent denial', async () => {
    const db = await seeded({ interleave: wixThrows });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 503, 'an infrastructure failure must not masquerade as "not a member"');
    assert.match(denied.body.error, /temporarily unavailable/i);
  });

  it('a failed Wix lookup for a user WITH a Stripe customer still falls through to Stripe', async () => {
    stripeHandler = subsList([{ id: 'sub_1', status: 'active', metadata: {}, items: { data: [{ price: { id: 'p', unit_amount: 900 } }] } }]);
    const db = await seeded({ user: { stripe_customer_id: 'cus_ada' }, interleave: wixThrows });
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(denied, null);
    assert.equal(granted.tier, 'member');
  });

  it('a missing STRIPE_SECRET_KEY is a 500 server-configuration error, not a grant', async () => {
    const db = await seeded();
    const { granted, denied } = await gate(db, {
      env: mockEnv({ DB: db, STRIPE_SECRET_KEY: undefined }),
    });
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 500);
    assert.equal(denied.body.error, 'Server configuration error');
  });

  it('a user with a Wix row under this email but no live sub gets the account-linking copy', async () => {
    const db = await seeded({
      extra: (s) => insertWixSubscription(s, { email: EMAIL, status: 'cancelled' }),
    });
    stripeHandler = () => { throw new Error('Stripe must not be reached without a customer id'); };
    const { granted, denied } = await gate(db);
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 403);
    assert.match(denied.body.error, /can't find an active membership tied to ada@example\.com/);
    assert.match(denied.body.error, /administrator@rrmacademy\.org/);
  });
});

// ---------------------------------------------------------------------------
// Stripe path + KV cache
// ---------------------------------------------------------------------------

describe('requireMember -- Stripe verification', () => {
  const withCustomer = { user: { stripe_customer_id: 'cus_ada' } };
  const sub = (status, unit_amount) => ({
    id: `sub_${status}`, status, metadata: {},
    items: { data: [{ price: { id: 'price_x', unit_amount } }] },
  });

  it('an active subscription grants membership at the amount-derived tier and warms the KV cache', async () => {
    stripeHandler = subsList([sub('active', 9900)]);
    const kv = mockKVJson();
    const db = await seeded(withCustomer);
    const { granted } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: kv }) });
    db.close();
    assert.equal(granted.tier, 'superhero');
    assert.equal(kv.puts.length, 1);
    assert.equal(kv.puts[0].key, `member_sub:${USER}`);
    assert.deepEqual(JSON.parse(kv.puts[0].value), { tier: 'superhero' });
    assert.equal(kv.puts[0].opts.expirationTtl, 300);
  });

  it('trialing and past_due both count as live subscriptions', async () => {
    for (const status of ['trialing', 'past_due']) {
      stripeHandler = subsList([sub(status, 2500)]);
      const db = await seeded(withCustomer);
      const { granted } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: mockKVJson() }) });
      db.close();
      assert.equal(granted?.tier, 'hero', `${status} should be honoured`);
    }
  });

  it('a customer whose only subscriptions are canceled is refused with 403', async () => {
    stripeHandler = subsList([sub('canceled', 9900), sub('incomplete_expired', 9900)]);
    const db = await seeded(withCustomer);
    const { granted, denied } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: mockKVJson() }) });
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'Membership required');
  });

  it('a KV cache HIT returns the cached tier and does not call Stripe at all', async () => {
    const kv = mockKVJson({ [`member_sub:${USER}`]: { tier: 'hero' } });
    stripeHandler = () => { throw new Error('Stripe must not be called on a cache hit'); };
    const db = await seeded(withCustomer);
    const { granted } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: kv }) });
    db.close();
    assert.equal(granted.tier, 'hero');
    assert.equal(kv.puts.length, 0, 'a cache hit must not rewrite the cache');
  });

  it('a KV read failure is non-fatal and falls through to Stripe', async () => {
    stripeHandler = subsList([sub('active', 900)]);
    const kv = {
      async get() { throw new Error('KV read failed'); },
      async put() { throw new Error('KV write failed'); },
    };
    const db = await seeded(withCustomer);
    const { granted, denied } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: kv }) });
    db.close();
    assert.equal(denied, null, 'a KV outage must not lock members out');
    assert.equal(granted.tier, 'member');
  });

  it('with no COMMUNITY_KV binding at all the gate still resolves from Stripe', async () => {
    stripeHandler = subsList([sub('active', 2500)]);
    const db = await seeded(withCustomer);
    const { granted } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: undefined }) });
    db.close();
    assert.equal(granted.tier, 'hero');
  });

  it('an unreachable Stripe returns 503 retryable rather than denying membership', async () => {
    stripeHandler = () => { throw new Error('connection reset'); };
    const db = await seeded(withCustomer);
    const { granted, denied } = await gate(db, { env: mockEnv({ DB: db, COMMUNITY_KV: mockKVJson() }) });
    db.close();
    assert.equal(granted, null);
    assert.equal(denied.status, 503);
    assert.match(denied.body.error, /Unable to verify membership/);
  });
});

// ---------------------------------------------------------------------------
// The shared SQL predicate the roster and the auto-emailer both use
// ---------------------------------------------------------------------------

describe('STUC_MEMBER_WHERE -- executed, not inspected', () => {
  /** Runs the real predicate through SQLite and returns the ids it admits. */
  function admitted(db) {
    return db._sqlite
      .prepare(`SELECT u.id FROM user u WHERE ${STUC_MEMBER_WHERE} ORDER BY u.id`)
      .all()
      .map((r) => r.id);
  }

  it('admits staff, grandfathers, live Wix subscribers and labelled Stripe customers -- and nobody else', () => {
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: 'u_staff', email: 'mod@example.com', role: 'mod' });
        insertUser(s, { id: 'u_grandfather', email: 'gf@example.com' });
        insertLabel(s, 'u_grandfather', 'STUC Legacy Grandfather');
        insertUser(s, { id: 'u_wix_live', email: 'live@example.com' });
        insertWixSubscription(s, { email: 'live@example.com' });
        insertUser(s, { id: 'u_stripe', email: 'stripe@example.com', stripe_customer_id: 'cus_1' });
        insertLabel(s, 'u_stripe', 'Save the Uterus Club \u{1F3F7}\u{FE0F}');
        insertUser(s, { id: 'u_nobody', email: 'nobody@example.com' });
      },
    });
    const ids = admitted(db);
    db.close();
    assert.deepEqual(ids, ['u_grandfather', 'u_staff', 'u_stripe', 'u_wix_live']);
  });

  it('excludes a blocked user even when they are otherwise a live subscriber', () => {
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: 'u_blocked', email: 'blocked@example.com', blocked: 1 });
        insertWixSubscription(s, { email: 'blocked@example.com' });
      },
    });
    const ids = admitted(db);
    db.close();
    assert.deepEqual(ids, []);
  });

  it('excludes a stale frozen active Wix row, matching requireMember exactly', () => {
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: 'u_lapsed', email: 'lapsed@example.com' });
        insertWixSubscription(s, { email: 'lapsed@example.com', next_expected_at: daysFromNow(-120) });
      },
    });
    const ids = admitted(db);
    db.close();
    assert.deepEqual(ids, [], 'the roster predicate and the gate must agree on who lapsed');
  });

  it('excludes a Stripe customer who lacks the STUC label', () => {
    const db = communityD1({
      seed(s) {
        insertUser(s, { id: 'u_unlabelled', email: 'ul@example.com', stripe_customer_id: 'cus_2' });
      },
    });
    const ids = admitted(db);
    db.close();
    assert.deepEqual(ids, []);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers that the gate module also owns
// ---------------------------------------------------------------------------

describe('_shared.js pure helpers', () => {
  it('tierFromLabel maps the three canonical labels and refuses everything else', () => {
    assert.equal(tierFromLabel('Uterus Member \u{1F43B}'), 'member');
    assert.equal(tierFromLabel('Uterus Hero \u{1F496}'), 'hero');
    assert.equal(tierFromLabel('Uterus Super Hero \u{1F9B8}\u{200D}\u{2640}\u{FE0F}'), 'superhero');
    assert.equal(tierFromLabel('Donor \u{1F44F}'), null, 'a non-tier label is not a tier');
    assert.equal(tierFromLabel(null), null);
    assert.equal(tierFromLabel(''), null);
    assert.equal(tierFromLabel(undefined), null);
  });

  it('TIER_DISPLAY has a label for every tier TIER_LABEL_MAP can produce', () => {
    for (const tier of Object.values(TIER_LABEL_MAP)) {
      assert.equal(typeof TIER_DISPLAY[tier], 'string', `no display string for tier ${tier}`);
      assert.ok(TIER_DISPLAY[tier].length > 0);
    }
  });

  it('displayName prefers name, then first+last initial, then first, then Member', () => {
    assert.equal(displayName({ name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace' }), 'Ada Lovelace');
    assert.equal(displayName({ first_name: 'Ada', last_name: 'Lovelace' }), 'Ada L.');
    assert.equal(displayName({ first_name: 'Ada' }), 'Ada');
    assert.equal(displayName({ last_name: 'Lovelace' }), 'Member', 'a surname alone is not a display name');
    assert.equal(displayName({}), 'Member');
  });

  it('canCreateType reserves announcement/event/resource for admins and leaves discussion open', () => {
    for (const type of ['announcement', 'event', 'resource']) {
      assert.equal(canCreateType('member', type), false);
      assert.equal(canCreateType('mod', type), false, 'a mod is not an admin for staff-only post types');
      assert.equal(canCreateType('admin', type), true);
      assert.equal(canCreateType('superadmin', type), true);
    }
    assert.equal(canCreateType('member', 'discussion'), true);
  });

  it('canEditPost and canDeletePost allow the author or any admin, and nobody else', () => {
    const post = { author_id: 'u_author' };
    for (const fn of [canEditPost, canDeletePost]) {
      assert.equal(fn('member', 'u_author', post), true, 'the author may act on their own post');
      assert.equal(fn('member', 'u_other', post), false);
      assert.equal(fn('mod', 'u_other', post), false, 'a mod cannot edit or delete an arbitrary post');
      assert.equal(fn('admin', 'u_other', post), true);
    }
  });

  it('canPin is mod-and-up; canResolveFlag and canManageRoles are admin-and-up', () => {
    assert.equal(canPin('member'), false);
    assert.equal(canPin('mod'), true);
    assert.equal(canResolveFlag('mod'), false);
    assert.equal(canResolveFlag('admin'), true);
    assert.equal(canManageRoles('mod'), false);
    assert.equal(canManageRoles('admin'), true);
  });

  it('canDeleteComment allows the author or a mod, unlike posts which need an admin', () => {
    const comment = { author_id: 'u_author' };
    assert.equal(canDeleteComment('member', 'u_author', comment), true);
    assert.equal(canDeleteComment('member', 'u_other', comment), false);
    assert.equal(canDeleteComment('mod', 'u_other', comment), true);
  });

  it('canSetRole lets only a superadmin mint another superadmin', () => {
    assert.equal(canSetRole('admin', 'superadmin'), false);
    assert.equal(canSetRole('superadmin', 'superadmin'), true);
    assert.equal(canSetRole('admin', 'mod'), true);
    assert.equal(canSetRole('mod', 'member'), false);
  });
});
