/**
 * EXECUTED tests for the SQL case-sensitivity guards that decide IDENTITY.
 *
 * Every query in this repo that resolves a person by email address is one
 * mis-collated comparison away from treating `Ada@Example.com` and
 * `ada@example.com` as two different people. The consequences are not cosmetic:
 * a duplicate account gets created, a paying member is locked out of login, a
 * member vanishes from the roster, a donor's gifts stop rolling up.
 *
 * These tests run the real endpoints against a REAL SQLite engine loaded with
 * the repo's committed `schema.sql` (test/_d1-sqlite.mjs). That matters twice
 * over:
 *
 *  1. The previous harness (mockDB) matched SQL by substring and returned canned
 *     rows, so no assertion about collation could fail for the reason its name
 *     gave. Column-level collation, `ws.email = u.email COLLATE NOCASE` inside a
 *     correlated subquery, and the functional UNIQUE index `idx_user_email_nocase`
 *     are all invisible to a substring matcher.
 *
 *  2. Case-insensitivity at these sites comes from TWO different places, and
 *     schema.sql says which one applies where:
 *       - `user.email` is BINARY (plus a separate UNIQUE index on
 *         `email COLLATE NOCASE`). At those sites the QUERY-LEVEL
 *         `COLLATE NOCASE` is load-bearing: delete it and the person is gone.
 *       - `wix_subscription.email`, `wix_payment.email`, `donor_gift.email`,
 *         `contact.email` and `course_waitlist.email` are declared
 *         `COLLATE NOCASE` at the COLUMN. SQLite resolves a comparison using the
 *         left operand's column collation when no explicit COLLATE is present,
 *         so at those sites the query clause is redundant belt-and-braces and
 *         the COLUMN is what is actually holding identity together.
 *     Each test below names which of the two it holds, and asserts the schema
 *     fact it depends on so a migration that changes a collation fails here by
 *     name instead of silently reopening the bug.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  sqliteD1, schemaCollation, insertUser, insertWixSubscription,
  insertDonorGift, insertContact, insertWaitlist, insertLabel, insertSession,
} from './_d1-sqlite.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, randomIp } from './_helpers.js';
import { hashPassword } from '../functions/api/auth/_shared.js';

const login = await import('../functions/api/auth/login.js');
const signup = await import('../functions/api/auth/signup.js');
const members = await import('../functions/api/community/members.js');
const donorGift = await import('../functions/api/billing/_donor-gift.js');

let net;
before(() => { net = stubExternalFetch(); });
after(() => { net.restore(); });

const HOUR = 3600;
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 30 * 24 * HOUR;
const PASSWORD = 'correct-horse-battery-staple';
let PASSWORD_HASH;
before(async () => { PASSWORD_HASH = await hashPassword(PASSWORD); });

const rows = (db, sql, ...args) => db._sqlite.prepare(sql).all(...args);
const one = (db, sql, ...args) => db._sqlite.prepare(sql).get(...args);

// ============================================================ provenance ===

describe('collation provenance -- which layer holds each site', () => {
  it('user.email is BINARY, so every `WHERE email = ? COLLATE NOCASE` on it is load-bearing', () => {
    assert.equal(
      schemaCollation('user', 'email'), 'BINARY',
      'If user.email ever becomes COLLATE NOCASE the auth-path clauses stop being the thing under test, '
      + 'and the tests below stop proving what they claim. Update them deliberately, do not just re-green.'
    );
  });

  it('the payment/CRM email columns are NOCASE, so the COLUMN holds those sites', () => {
    for (const table of ['wix_subscription', 'wix_payment', 'donor_gift', 'contact', 'course_waitlist']) {
      assert.equal(
        schemaCollation(table, 'email'), 'NOCASE',
        `${table}.email lost its COLLATE NOCASE. The query-level clauses at those sites are redundant `
        + 'belt-and-braces and will NOT save you -- the column is the guard.'
      );
    }
  });
});

// ================================================================= login ===

/**
 * A mixed-case stored address is not hypothetical here: the Wix import wrote
 * addresses as the member typed them, and login lowercases before querying.
 */
function loginDb(seedExtra) {
  return sqliteD1({
    seed(s) {
      insertUser(s, {
        id: 'usr_ada', email: 'Ada@Example.COM', hashed_password: PASSWORD_HASH,
        name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace', role: 'member',
      });
      if (seedExtra) seedExtra(s);
    },
  });
}

async function postLogin(db, email, password = PASSWORD) {
  const stub = stubExternalFetch();
  try {
    const response = await login.onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/auth/login',
        body: { email, password, turnstileToken: 'tok' },
        headers: { 'CF-Connecting-IP': randomIp() },
      }),
      env: mockEnv({ DB: db }),
      waitUntil: mockWaitUntil(),
    });
    return { ...await parseResponse(response), cookies: response.headers.getSetCookie() };
  } finally {
    stub.restore();
  }
}

describe('auth/login.js:58 -- the login lookup itself (query clause on a BINARY column)', () => {
  it('lets a member in whose stored address differs from what they typed only in case', async () => {
    const db = loginDb();
    const parsed = await postLogin(db, 'ada@example.com');

    assert.equal(parsed.status, 200, `a case-mismatched member was locked out: ${JSON.stringify(parsed.body)}`);
    assert.equal(parsed.body.user.id, 'usr_ada');
    assert.equal(parsed.body.user.email, 'Ada@Example.COM', 'the response echoes the STORED address, not the typed one');
    assert.equal(
      rows(db, 'SELECT id FROM session WHERE user_id = ?', 'usr_ada').length, 1,
      'a successful login must land a session row for the resolved account'
    );
    assert.ok(
      parsed.cookies.some((c) => c.startsWith('session=')),
      `no session cookie issued: ${JSON.stringify(parsed.cookies)}`
    );
    db.close();
  });

  it('still refuses the wrong password for that same case-mismatched address', async () => {
    const db = loginDb();
    const parsed = await postLogin(db, 'ADA@EXAMPLE.COM', 'not-the-password');
    assert.equal(parsed.status, 401);
    assert.equal(parsed.body.error, 'Invalid email or password.');
    assert.equal(rows(db, 'SELECT id FROM session').length, 0, 'a failed login must not mint a session');
    db.close();
  });

  it('does not resolve a genuinely different address', async () => {
    const db = loginDb();
    const parsed = await postLogin(db, 'adam@example.com');
    assert.equal(parsed.status, 401, 'NOCASE must not degrade into a fuzzy match');
    db.close();
  });
});

describe('auth/_shared.js:515 -- the course_waitlist claim (COLUMN collation)', () => {
  it('claims a waitlist row whose stored address differs in case from the account', async () => {
    assert.equal(schemaCollation('course_waitlist', 'email'), 'NOCASE');
    const db = loginDb((s) => {
      insertWaitlist(s, { email: 'ADA@example.com', courseId: 'masterclass-endo-surgery' });
      insertWaitlist(s, { email: 'someone.else@example.com', courseId: 'masterclass-endo-surgery' });
    });

    const parsed = await postLogin(db, 'ada@example.com');
    assert.equal(parsed.status, 200);

    const claimed = one(db, 'SELECT user_id FROM course_waitlist WHERE email = ?', 'ADA@example.com');
    assert.equal(claimed.user_id, 'usr_ada', 'the waitlist row was orphaned by a case difference');
    const other = one(db, 'SELECT user_id FROM course_waitlist WHERE email = ?', 'someone.else@example.com');
    assert.equal(other.user_id, null, 'the backfill must claim only this account\'s rows');
    db.close();
  });

  it('leaves an already-claimed waitlist row alone', async () => {
    const db = loginDb((s) => {
      insertUser(s, { id: 'usr_other', email: 'other@example.com', hashed_password: '' });
      insertWaitlist(s, { email: 'Ada@Example.com', courseId: 'c1', userId: 'usr_other' });
    });
    await postLogin(db, 'ada@example.com');
    const row = one(db, 'SELECT user_id FROM course_waitlist WHERE course_id = ?', 'c1');
    assert.equal(row.user_id, 'usr_other', 'the backfill is idempotent: user_id IS NULL only');
    db.close();
  });
});

// ================================================================ signup ===

async function postSignup(db, email) {
  const stub = stubExternalFetch();
  try {
    const response = await signup.onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/auth/signup',
        body: {
          firstName: 'Impostor', lastName: 'Signup', email,
          password: 'a-brand-new-password-99', turnstileToken: 'tok',
        },
        headers: { 'CF-Connecting-IP': randomIp() },
      }),
      env: mockEnv({ DB: db }),
      waitUntil: mockWaitUntil(),
    });
    return { ...await parseResponse(response), cookies: response.headers.getSetCookie() };
  } finally {
    stub.restore();
  }
}

describe('auth/signup.js:136 -- the duplicate-account check (query clause on a BINARY column)', () => {
  /**
   * What this clause is actually for. The ACCOUNT is protected twice over: if
   * the check misses, the INSERT still hits `idx_user_email_nocase` and the
   * batch-catch answers the same silent 201. What is NOT protected twice is the
   * CRM. Missing the check sends the flow on to `verifyAndTagEmail`, whose
   * `INSERT INTO contact ... ON CONFLICT(email) DO UPDATE` overwrites the real
   * member's name with whatever the impostor typed -- which is the reason the
   * check sits BEFORE ELV in the source, in its own comment.
   */
  it('refuses to create a second account, and leaves the real member\'s CRM row alone', async () => {
    const db = sqliteD1({
      seed(s) {
        insertUser(s, {
          id: 'usr_ada', email: 'Ada@Example.COM', hashed_password: PASSWORD_HASH,
          name: 'Ada Lovelace', first_name: 'Ada', last_name: 'Lovelace',
        });
        insertContact(s, { id: 'c_ada', email: 'Ada@Example.COM', first_name: 'Ada', last_name: 'Lovelace' });
      },
    });

    const parsed = await postSignup(db, 'ada@example.com');

    // Anti-enumeration: the collision answers 201 like a real signup would.
    assert.equal(parsed.status, 201, `collision path errored instead of answering silently: ${JSON.stringify(parsed.body)}`);
    assert.deepEqual(parsed.body, { ok: true, emailVerificationRequired: true });

    const all = rows(db, 'SELECT id, email, first_name FROM user');
    assert.equal(all.length, 1, `a duplicate account was created: ${JSON.stringify(all)}`);
    assert.equal(all[0].id, 'usr_ada');
    assert.equal(all[0].email, 'Ada@Example.COM', 'the stored address must not be rewritten by the collision');
    assert.equal(all[0].first_name, 'Ada', "the impostor's name must not overwrite the real account");
    assert.equal(rows(db, 'SELECT id FROM email_verification').length, 0, 'no verification token for a collision');

    const contact = one(db, 'SELECT first_name, last_name FROM contact WHERE id = ?', 'c_ada');
    assert.equal(contact.first_name, 'Ada', 'the impostor overwrote the real member\'s CRM first name');
    assert.equal(contact.last_name, 'Lovelace', 'the impostor overwrote the real member\'s CRM last name');
    assert.equal(
      rows(db, 'SELECT tag FROM contact_tag WHERE contact_id = ?', 'c_ada').length, 0,
      'a collision must not reach the ELV tagging write at all'
    );
    db.close();
  });

  it('the fake session issued on collision belongs to no real account', async () => {
    const db = sqliteD1({
      seed(s) { insertUser(s, { id: 'usr_ada', email: 'Ada@Example.COM', hashed_password: PASSWORD_HASH }); },
    });
    const parsed = await postSignup(db, 'ADA@example.com');
    assert.equal(parsed.status, 201);
    assert.ok(
      parsed.cookies.some((c) => c.startsWith('session=')),
      'the decoy cookie must still be set, or a probing client can tell a collision from a real signup'
    );
    assert.equal(rows(db, 'SELECT id FROM session').length, 0, 'the decoy must not be backed by a session row');
    db.close();
  });

  it('a genuinely new address still creates exactly one account', async () => {
    const db = sqliteD1({
      seed(s) { insertUser(s, { id: 'usr_ada', email: 'Ada@Example.COM', hashed_password: PASSWORD_HASH }); },
    });
    const parsed = await postSignup(db, 'grace@example.com');
    assert.equal(parsed.status, 201);
    const all = rows(db, 'SELECT id, email FROM user ORDER BY email');
    assert.equal(all.length, 2, 'the collision guard must not swallow a real signup');
    assert.ok(all.some((r) => r.email === 'grace@example.com'));
    db.close();
  });
});

// ============================================================= community ===

const SESSION_COOKIE = 'session=raw-session-token';

async function communityDb(seed) {
  let handle;
  const db = sqliteD1({ seed(s) { handle = s; seed(s); } });
  await insertSession(handle, { rawId: 'raw-session-token', userId: 'usr_ada', expiresAt: FAR_FUTURE });
  return db;
}

async function getMembers(db, env = {}) {
  const stub = stubExternalFetch();
  try {
    const response = await members.onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/community/members',
        headers: { Cookie: SESSION_COOKIE, 'CF-Connecting-IP': randomIp() },
      }),
      env: mockEnv({ DB: db, STRIPE_SECRET_KEY: 'sk_test_x', COMMUNITY_KV: null, ...env }),
      waitUntil: mockWaitUntil(),
    });
    return await parseResponse(response);
  } finally {
    stub.restore();
  }
}

describe('community/_shared.js -- the membership gate and the roster (COLUMN collation)', () => {
  it('lets a Wix member in and lists them, when the subscription row spells their address differently (:167 + :267)', async () => {
    const db = await communityDb((s) => {
      insertUser(s, { id: 'usr_ada', email: 'ada@example.com', name: 'Ada Lovelace', email_verified: 1 });
      insertWixSubscription(s, { email: 'Ada@Example.COM', tier: 'hero', amount_cents: 1900 });
    });

    const parsed = await getMembers(db);

    // :167 -- requireMember's wix_subscription probe resolved the account.
    assert.equal(parsed.status, 200, `the paying member was refused: ${JSON.stringify(parsed.body)}`);
    // :267 -- STUC_MEMBER_WHERE's `ws.email = u.email COLLATE NOCASE` kept them
    // in the roster. This is a column-to-column comparison with no placeholder,
    // which no substring-matching mock can model at all.
    assert.equal(parsed.body.members.length, 1, 'the member is silently missing from the roster');
    assert.equal(parsed.body.members[0].id, 'usr_ada');
    db.close();
  });

  it('refuses, and says which address it looked under, when only a lapsed Wix row matches (:191)', async () => {
    const db = await communityDb((s) => {
      insertUser(s, { id: 'usr_ada', email: 'ada@example.com', email_verified: 1 });
      insertWixSubscription(s, { email: 'ADA@EXAMPLE.COM', status: 'canceled' });
    });

    const parsed = await getMembers(db);

    assert.equal(parsed.status, 403);
    assert.match(
      parsed.body.error, /can't find an active membership tied to ada@example\.com/,
      'the "we found a lapsed row under this address" branch is what tells a real ex-member what to do; '
      + 'a case-sensitive probe drops them to the generic "Membership required" dead end'
    );
    db.close();
  });

  it('gives the generic refusal when no Wix row exists under any spelling', async () => {
    const db = await communityDb((s) => {
      insertUser(s, { id: 'usr_ada', email: 'ada@example.com', email_verified: 1 });
      insertWixSubscription(s, { email: 'someone.else@example.com', status: 'canceled' });
    });
    const parsed = await getMembers(db);
    assert.equal(parsed.status, 403);
    assert.equal(parsed.body.error, 'Membership required');
    db.close();
  });

  it('a stale active Wix row does not grant access even when the address matches', async () => {
    const db = await communityDb((s) => {
      insertUser(s, { id: 'usr_ada', email: 'ada@example.com', email_verified: 1 });
      insertWixSubscription(s, {
        email: 'Ada@Example.COM', status: 'active',
        next_expected_at: new Date(Date.now() - 60 * 86400e3).toISOString(),
        last_order_at: new Date(Date.now() - 120 * 86400e3).toISOString(),
      });
    });
    const parsed = await getMembers(db);
    assert.equal(parsed.status, 403, 'the COALESCE recency guard must still bite under NOCASE');
    db.close();
  });
});

const daysAgo = (n) => new Date(Date.now() - n * 86400e3).toISOString();

// The admin/membership-report.js identity-join coverage moved out with the
// handler itself (old-admin-offline, 2026-08-25): the report now lives in
// rrm-backoffice functions/api/membership.js, whose own suite carries the
// email-collation matrix (test/money-d1.test.js).

// ============================================================ donor gift ===

describe('billing/_donor-gift.js -- donor rollups (COLUMN collation)', () => {
  it('aggregates gifts stored under a different case than the incoming one (:94)', async () => {
    const db = sqliteD1({
      seed(s) {
        insertContact(s, { id: 'c_erin', email: 'Erin@Example.COM' });
        insertDonorGift(s, { email: 'ERIN@example.com', amount_cents: 30000, source_id: 'pi_old_1', occurred_at: daysAgo(200) });
        insertDonorGift(s, { email: 'Erin@Example.COM', amount_cents: 25000, source_id: 'pi_old_2', occurred_at: daysAgo(100) });
      },
    });

    const result = await donorGift.recordDonorGift(db, {
      email: 'erin@example.com', displayName: 'Erin Donor', amountCents: 10000,
      source: 'stripe', sourceId: 'pi_new', entity: 'foundation', kind: 'one_time',
      occurredAt: new Date().toISOString(),
    });
    assert.equal(result.recorded, true);

    const contact = one(db, 'SELECT total_donated, gift_count, donor_stage, first_gift_at FROM contact WHERE id = ?', 'c_erin');
    // 30000 + 25000 + 10000 cents = $650. A case-sensitive aggregate would see
    // only the new $100 gift and demote a major donor to first_time.
    assert.equal(contact.total_donated, 650, `rollup lost prior gifts: $${contact.total_donated}`);
    assert.equal(contact.gift_count, 3);
    assert.equal(contact.donor_stage, 'major', 'a $650 lifetime donor must be staged major');
    assert.ok(contact.first_gift_at.startsWith(daysAgo(200).slice(0, 10)), 'first_gift_at must reach the oldest gift');
    db.close();
  });

  it('backlinks every gift row to the contact regardless of stored case (:113/:118/:119)', async () => {
    const db = sqliteD1({
      seed(s) {
        insertContact(s, { id: 'c_erin', email: 'Erin@Example.COM' });
        insertDonorGift(s, { email: 'ERIN@example.com', amount_cents: 5000, source_id: 'pi_a' });
        insertDonorGift(s, { email: 'erin@EXAMPLE.com', amount_cents: 5000, source_id: 'pi_b' });
        insertDonorGift(s, { email: 'someone.else@example.com', amount_cents: 5000, source_id: 'pi_c' });
      },
    });

    await donorGift.recomputeContactRollups(db, 'erin@example.com');

    const linked = rows(db, 'SELECT email, contact_id FROM donor_gift ORDER BY source_id');
    assert.equal(linked[0].contact_id, 'c_erin', 'ERIN@example.com was left unlinked');
    assert.equal(linked[1].contact_id, 'c_erin', 'erin@EXAMPLE.com was left unlinked');
    assert.equal(linked[2].contact_id, null, 'a different donor must not be swept into this contact');
    db.close();
  });

  it('a duplicate redelivery still heals stale rollups without double-counting', async () => {
    const db = sqliteD1({
      seed(s) {
        insertContact(s, { id: 'c_erin', email: 'Erin@Example.COM' });
        insertDonorGift(s, { email: 'ERIN@example.com', amount_cents: 4000, source: 'stripe', source_id: 'pi_dupe' });
      },
    });

    const result = await donorGift.recordDonorGift(db, {
      email: 'erin@example.com', amountCents: 4000, source: 'stripe',
      sourceId: 'pi_dupe', occurredAt: new Date().toISOString(),
    });

    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'duplicate');
    assert.equal(rows(db, 'SELECT id FROM donor_gift').length, 1, 'the redelivery must not insert a second row');
    const contact = one(db, 'SELECT total_donated, gift_count FROM contact WHERE id = ?', 'c_erin');
    assert.equal(contact.total_donated, 40, 'the interrupted run\'s stale rollup must still be healed');
    assert.equal(contact.gift_count, 1);
    db.close();
  });
});
