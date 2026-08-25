/**
 * EXECUTED tests for functions/api/billing/_webhook-checkout.js.
 *
 * handleCheckoutCompleted is CRAP #1 in this repo: cyclomatic complexity 210,
 * 1,039 lines, 41 prior /arise findings, 0 lines covered. It decides whether a
 * paying customer gets an account, an enrollment, a membership welcome, a
 * donation record and a revenue event -- and it was only ever asserted on as
 * source text, because the module could not be imported under node --test (see
 * test/_json-module-hook.mjs).
 *
 * Everything below calls the real handler with a real Stripe-shaped session and
 * asserts on what it wrote or sent. The courses catalogue is the deterministic
 * fixture from the module hook, so the same ids exist locally and in CI.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockDB, mockWaitUntil, parseResponse, stubExternalFetch, stripeRoutes, drainWaitUntil } from './_helpers.js';
import { sqliteD1, insertUser } from './_d1-sqlite.mjs';

const checkout = await import('../functions/api/billing/_webhook-checkout.js');
const { handleCheckoutCompleted, handleCheckoutExpired, buildDonationAdminNotice, buildStucAdminNotice, isMigrationHandoffSession } = checkout;

let net;
before(() => { net = stubExternalFetch(); });
after(() => { net.restore(); });

const CREATED = 1738000000;

function session(overrides = {}) {
  return {
    id: 'cs_test_session',
    mode: 'payment',
    customer: 'cus_test_1',
    customer_details: { email: 'buyer@example.com', name: 'Ada Lovelace' },
    amount_total: 5000,
    payment_intent: 'pi_test_1',
    metadata: {},
    ...overrides,
  };
}

const evt = (sessionObject) => ({ id: 'evt_1', type: 'checkout.session.completed', created: CREATED, data: { object: sessionObject } });

function ctxFor(sessionObject, { dbMap = {}, env: envOverrides = {} } = {}) {
  const db = mockDB(dbMap);
  const env = mockEnv({ DB: db, STRIPE_SECRET_KEY: 'sk_test_x', ...envOverrides });
  return {
    db,
    env,
    waitUntil: mockWaitUntil(),
    request: mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook', headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
    event: evt(sessionObject),
  };
}

async function run(ctx, stub = net) {
  const before = stub.calls.length;
  const result = await handleCheckoutCompleted(ctx.db, ctx.event, ctx.env, ctx.request, ctx.waitUntil);
  await drainWaitUntil(ctx.waitUntil);
  ctx.sent = stub.calls.slice(before).filter(c => c.service === 'ses');
  ctx.ga4 = stub.calls.slice(before).filter(c => c.service === 'ga4');
  ctx.stripeCalls = stub.calls.slice(before).filter(c => c.service === 'stripe');
  return result;
}

/**
 * Installs a nested fetch stub that ALSO answers api.stripe.com. Nesting works
 * because stubExternalFetch captures whatever fetch is installed when it is
 * created, so restore() puts the file-level stub back.
 */
function withStripe(routes, extra = {}) {
  return stubExternalFetch({ stripe: stripeRoutes(routes), ...extra });
}

const stmts = (ctx, needle) => ctx.db._calls.filter(c => c.sql.includes(needle));
const mailTo = (ctx, subjectPart) => ctx.sent.find(c => (c.body?.Content?.Simple?.Subject?.Data || '').includes(subjectPart));

// ------------------------------------------------------- pure builders ----

describe('_webhook-checkout -- notice builders', () => {
  it('builds a donation notice from the mapped gift, not from the raw session', () => {
    const gift = { amountCents: 25000, displayName: 'Ada Lovelace', email: 'ada@example.com', sourceId: 'pi_9', occurredAt: '2026-07-28T00:00:00.000Z' };
    const notice = buildDonationAdminNotice(session({ metadata: { campaign: 'provider-directory' } }), gift);
    assert.equal(notice.subject, 'New donation: $250.00 - Ada Lovelace [provider-directory]');
    assert.match(notice.text, /Amount: {9}\$250\.00/);
    assert.match(notice.text, /Payment intent: pi_9/);
  });

  it('falls back to the email, then to (unknown), when no donor name is set', () => {
    const base = { amountCents: 1000, sourceId: 'pi_1', occurredAt: '2026-07-28T00:00:00.000Z' };
    assert.match(buildDonationAdminNotice(session(), { ...base, email: 'ada@example.com' }).subject, /- ada@example\.com$/);
    assert.match(buildDonationAdminNotice(session(), base).subject, /- \(unknown\)$/);
  });

  it('caps a hostile campaign tag at 60 characters', () => {
    const notice = buildDonationAdminNotice(
      session({ metadata: { campaign: 'x'.repeat(200) } }),
      { amountCents: 100, displayName: 'A', sourceId: 'pi_1', occurredAt: '2026-07-28T00:00:00.000Z' }
    );
    assert.ok(notice.subject.includes(`[${'x'.repeat(60)}]`));
    assert.ok(!notice.subject.includes('x'.repeat(61)));
  });

  it('uses the tier fallback price when Stripe has not billed the first invoice yet', () => {
    // Trial-clamped migration checkouts arrive with amount_total 0, which would
    // otherwise report a $0.00/mo membership to the administrator.
    assert.match(buildStucAdminNotice(session({ amount_total: 0 }), 'hero', 'Uterus Hero').subject, /\$19\.00\/mo\)$/);
    assert.match(buildStucAdminNotice(session({ amount_total: 9900 }), 'superhero', 'Super Hero').subject, /\$99\.00\/mo\)$/);
    assert.match(buildStucAdminNotice(session({ amount_total: null }), 'member', 'Member').subject, /\$9\.00\/mo\)$/);
  });

  it('strips CR/LF out of the member address so it cannot inject a mail header', () => {
    const notice = buildStucAdminNotice(
      session({ customer_details: { email: 'Evil@Example.COM\r\nBcc: victim@example.com', name: 'x'.repeat(500) } }),
      'member', 'Member'
    );
    assert.ok(!/[\r\n]/.test(notice.subject));
    assert.ok(notice.subject.includes('evil@example.combcc: victim@example.com') === false || !notice.subject.includes('\n'));
    assert.ok(notice.text.split('\n').find(l => l.startsWith('Member name:')).length <= 'Member name:  '.length + 200);
  });

  it('recognises a migration handoff by either discriminator', () => {
    assert.equal(isMigrationHandoffSession(session({ metadata: { migration_handoff: 'true' } })), true);
    assert.equal(isMigrationHandoffSession(session({ metadata: { wix_subscription_id: 'wxs_abc-123' } })), true);
    assert.equal(isMigrationHandoffSession(session({ metadata: { wix_subscription_id: 'not-a-wix-id' } })), false);
    assert.equal(isMigrationHandoffSession(session()), false);
    assert.equal(isMigrationHandoffSession(undefined), false);
  });
});

// --------------------------------------------------- account resolution ---

describe('_webhook-checkout -- account linkage', () => {
  it('links the Stripe customer to a logged-in user by client_reference_id', async () => {
    const ctx = ctxFor(session({ client_reference_id: 'usr_42' }));
    assert.equal(await run(ctx), null);
    const link = stmts(ctx, 'UPDATE user SET stripe_customer_id')[0];
    assert.ok(link);
    assert.deepEqual(link.bound, ['cus_test_1', 'usr_42', 'cus_test_1']);
    assert.ok(link.sql.includes('stripe_customer_id IS NULL OR stripe_customer_id = ?'), 'the link must not clobber a different customer');
    assert.equal(stmts(ctx, 'INSERT OR IGNORE INTO user').length, 0, 'a logged-in checkout must not create an account');
  });

  it('normalizes a mixed-case, padded address before looking the account up', async () => {
    const ctx = ctxFor(session({ customer_details: { email: '  Buyer@Example.COM  ', name: 'Ada' } }));
    await run(ctx);
    const lookup = stmts(ctx, 'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email')[0];
    assert.ok(lookup);
    assert.deepEqual(lookup.bound, ['buyer@example.com']);
    assert.ok(lookup.sql.includes('COLLATE NOCASE'));
  });

  it('links an anonymous checkout to an existing account that has no Stripe id yet', async () => {
    const ctx = ctxFor(session(), {
      dbMap: { 'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email': { first: { id: 'usr_7', stripe_customer_id: null } } },
    });
    await run(ctx);
    const link = stmts(ctx, 'UPDATE user SET stripe_customer_id')[0];
    assert.deepEqual(link.bound, ['cus_test_1', 'usr_7']);
    assert.equal(stmts(ctx, 'INSERT OR IGNORE INTO user').length, 0);
  });

  // A Wix-era imported row carries name/first_name/last_name = ''. Before
  // 2026-08-24 this path linked the Stripe id and returned, so a paying member
  // stayed permanently nameless and every email addressed them as nobody.
  it('backfills a blank existing account from the name Stripe collected', async () => {
    const ctx = ctxFor(session(), {
      dbMap: {
        'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email': {
          first: { id: 'usr_7', stripe_customer_id: null, name: '', first_name: '', last_name: '' },
        },
      },
    });
    await run(ctx);
    const backfill = stmts(ctx, 'UPDATE user SET name = ?')[0];
    assert.ok(backfill, 'a blank row must take the checkout name');
    assert.deepEqual(backfill.bound, ['Ada Lovelace', 'Ada', 'Lovelace', 'usr_7']);
    assert.ok(backfill.sql.includes("COALESCE(TRIM(name), '') = ''"), 'the write must re-check blankness in SQL');
    assert.equal(stmts(ctx, 'INSERT OR IGNORE INTO user').length, 0);
  });

  it('leaves an existing name alone', async () => {
    const ctx = ctxFor(session(), {
      dbMap: {
        'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email': {
          first: { id: 'usr_7', stripe_customer_id: null, name: 'Augusta King', first_name: 'Augusta', last_name: 'King' },
        },
      },
    });
    await run(ctx);
    assert.equal(stmts(ctx, 'UPDATE user SET name = ?').length, 0, 'a named account must not be renamed by a checkout');
    assert.ok(stmts(ctx, 'UPDATE user SET stripe_customer_id')[0], 'the Stripe link still happens');
  });

  // derivedFirstName falls back to the email local part. That is an acceptable
  // seed for a brand-new row, but stamping "Elainelucier" onto a real account
  // is worse than leaving it blank -- emails address people by first_name.
  it('does not stamp the email-derived guess on an existing account', async () => {
    const ctx = ctxFor(session({ customer_details: { email: 'elainelucier@example.com', name: null } }), {
      dbMap: {
        'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email': {
          first: { id: 'usr_7', stripe_customer_id: null, name: '', first_name: '', last_name: '' },
        },
      },
    });
    await run(ctx);
    assert.equal(stmts(ctx, 'UPDATE user SET name = ?').length, 0, 'no Stripe name means no backfill');
  });

  it('alerts the administrator instead of overwriting a different linked customer', async () => {
    const ctx = ctxFor(session(), {
      dbMap: { 'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email': { first: { id: 'usr_7', stripe_customer_id: 'cus_OTHER' } } },
    });
    await run(ctx);
    assert.equal(stmts(ctx, 'UPDATE user SET stripe_customer_id').length, 0, 'the existing link must be left alone');
    const alert = mailTo(ctx, 'Stripe customer mismatch');
    assert.ok(alert, `expected a mismatch alert, sent: ${ctx.sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
    assert.deepEqual(alert.body.Destination.ToAddresses, ['administrator@rrmacademy.org']);
    assert.match(alert.body.Content.Simple.Body.Text.Data, /Linked customer: {3}cus_OTHER/);
  });

  it('creates an account for a first-time anonymous buyer and mails a 7-day set-password link', async () => {
    const ctx = ctxFor(session());
    await run(ctx);
    const insert = stmts(ctx, 'INSERT OR IGNORE INTO user')[0];
    assert.ok(insert, 'a new account must be created');
    const [, email, name, firstName, lastName, customerId] = insert.bound;
    assert.equal(email, 'buyer@example.com');
    assert.equal(name, 'Ada Lovelace');
    assert.equal(firstName, 'Ada');
    assert.equal(lastName, 'Lovelace');
    assert.equal(customerId, 'cus_test_1');
    assert.ok(insert.sql.includes("'member'"), 'auto-created accounts get the member role');

    const token = stmts(ctx, 'INSERT INTO password_reset')[0];
    assert.ok(token, 'a welcome token must be minted');
    assert.ok(token.sql.includes("'welcome'"), 'the token purpose must be welcome, not reset');
    assert.ok(token.sql.includes('ON CONFLICT(user_id, purpose)'), 'a re-drive must upsert, not error');
    const ttlSeconds = token.bound[3] - Math.floor(Date.now() / 1000);
    assert.ok(Math.abs(ttlSeconds - 7 * 24 * 3600) < 60, `welcome token TTL was ${ttlSeconds}s, expected 7 days`);

    const welcome = mailTo(ctx, 'Your RRM Academy account is ready');
    assert.ok(welcome);
    assert.match(welcome.body.Content.Simple.Body.Text.Data, /https:\/\/rrmacademy\.org\/reset-password\/\?token=[0-9a-f]{64}/);
  });

  it('derives a name from the address local part when Stripe supplies none', async () => {
    const ctx = ctxFor(session({ customer_details: { email: 'ada.byron@example.com', name: '' } }));
    await run(ctx);
    const [, , name, firstName, lastName] = stmts(ctx, 'INSERT OR IGNORE INTO user')[0].bound;
    assert.equal(name, null, 'an empty Stripe name must be stored as NULL, not ""');
    assert.equal(firstName, 'Ada');
    assert.equal(lastName, 'Byron');
  });

  it('truncates a hostile 500-character name to 200 characters', async () => {
    const ctx = ctxFor(session({ customer_details: { email: 'long@example.com', name: 'N'.repeat(500) } }));
    await run(ctx);
    const [, , name, firstName] = stmts(ctx, 'INSERT OR IGNORE INTO user')[0].bound;
    assert.equal(name.length, 200);
    assert.ok(firstName.length <= 100);
  });

  it('links to the winner of a concurrent account creation instead of failing', async () => {
    const ctx = ctxFor(session(), { dbMap: { 'INSERT OR IGNORE INTO user': { run: { success: true, meta: { changes: 0 } } } } });
    await run(ctx);
    const heal = stmts(ctx, 'UPDATE user SET stripe_customer_id = COALESCE')[0];
    assert.ok(heal, 'the losing writer must link by email in one atomic UPDATE');
    assert.deepEqual(heal.bound, ['cus_test_1', 'buyer@example.com', 'cus_test_1']);
    // The case-insensitivity of this UPDATE is NOT asserted here. It used to be,
    // as `heal.sql.includes('COLLATE NOCASE')` -- a string check that passes for
    // a query that has the words in a comment, and that cannot fail for the
    // reason its name gives. It is asserted by running the statement against a
    // real SQLite engine in the executed race test at the bottom of this file.
  });

  it('alerts the administrator when a concurrent race orphans a Stripe customer', async () => {
    const ctx = ctxFor(session(), {
      dbMap: {
        'INSERT OR IGNORE INTO user': { run: { success: true, meta: { changes: 0 } } },
        'UPDATE user SET stripe_customer_id = COALESCE': { run: { success: true, meta: { changes: 0 } } },
      },
    });
    await run(ctx);
    const alert = mailTo(ctx, 'Orphaned Stripe customer');
    assert.ok(alert, `expected an orphan alert, sent: ${ctx.sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
    assert.match(alert.body.Content.Simple.Body.Text.Data, /Orphaned customer: cus_test_1/);
  });

  it('skips account work entirely when Stripe sends no address', async () => {
    const ctx = ctxFor(session({ customer_details: { email: '', name: '' }, customer_email: null }));
    assert.equal(await run(ctx), null);
    assert.equal(stmts(ctx, 'FROM user').length, 0);
    assert.equal(stmts(ctx, 'INSERT OR IGNORE INTO user').length, 0);
  });

  it('answers 500 so Stripe retries when the account link fails outright', async () => {
    const ctx = ctxFor(session(), { dbMap: { 'SELECT id, stripe_customer_id, name, first_name, last_name FROM user WHERE email': { throws: 'D1_ERROR: database is locked' } } });
    const result = await run(ctx);
    const parsed = await parseResponse(result);
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'Account linkage failed' });
    assert.ok(!JSON.stringify(parsed.body).includes('database is locked'), 'internal detail must not leak');
  });

  it('does not create an account or mail a welcome when SES is unconfigured', async () => {
    const ctx = ctxFor(session(), { env: { AWS_ACCESS_KEY_ID: undefined } });
    await run(ctx);
    assert.ok(stmts(ctx, 'INSERT OR IGNORE INTO user')[0], 'the account is still created');
    assert.equal(stmts(ctx, 'INSERT INTO password_reset').length, 0, 'no token is minted that could never be delivered');
    assert.equal(ctx.sent.length, 0);
  });
});

// ------------------------------------------------------ course purchase ---

describe('_webhook-checkout -- course purchase', () => {
  const courseSession = (overrides = {}) => session({
    client_reference_id: 'usr_42',
    metadata: { type: 'course', courseId: 'test-course-basic' },
    ...overrides,
  });
  const enrollOk = { 'INSERT INTO enrollment': { run: { success: true, meta: { changes: 1 } } } };

  // A Link or wallet buyer completes checkout with customer_details.name = null
  // even though signup already told us who they are, so reading Stripe for the
  // greeting said "Hi there" to people whose name was sitting in the user row.
  it('greets a course buyer by the name on the account, not the one Stripe collected', async () => {
    const ctx = ctxFor(courseSession({ customer_details: { email: 'buyer@example.com', name: null } }), {
      dbMap: {
        ...enrollOk,
        'SELECT first_name, name FROM user WHERE email': { first: { first_name: 'Katura', name: 'Katura Smoker' } },
      },
    });
    await run(ctx);
    const mail = mailTo(ctx, 'Your course is ready');
    assert.ok(mail, 'the confirmation must still send');
    assert.match(mail.body.Content.Simple.Body.Text.Data, /^Hi Katura,/);
  });

  // Precedence, not just fallback. donor_gift showed the checkout name is the
  // PAYER's: five of 25 rows carried a different human than the account holder.
  // So when the two disagree the account has to win, and this is the assertion
  // that a "Stripe first, account second" ordering cannot pass.
  it('prefers the account name over a different name typed at checkout', async () => {
    const ctx = ctxFor(courseSession({ customer_details: { email: 'buyer@example.com', name: 'William Robson' } }), {
      dbMap: {
        ...enrollOk,
        'SELECT first_name, name FROM user WHERE email': { first: { first_name: 'Hannah', name: 'Hannah Whiting' } },
      },
    });
    await run(ctx);
    const text = mailTo(ctx, 'Your course is ready').body.Content.Simple.Body.Text.Data;
    assert.match(text, /^Hi Hannah,/);
    assert.ok(!/William/.test(text), 'the cardholder name must not be used to greet the account holder');
  });

  // ~2,476 user rows carry no name at all from the Wix-era import. The greeting
  // has to read as ordinary copy for them, not as a visible blank.
  it('greets a buyer we have never had a name for without leaving a hole', async () => {
    const ctx = ctxFor(courseSession({ customer_details: { email: 'buyer@example.com', name: null } }), {
      dbMap: {
        ...enrollOk,
        'SELECT first_name, name FROM user WHERE email': { first: { first_name: '', name: '' } },
      },
    });
    await run(ctx);
    const text = mailTo(ctx, 'Your course is ready').body.Content.Simple.Body.Text.Data;
    assert.match(text, /^Hi there,/);
    assert.ok(!/Hi ,|Hi undefined|Hi null/.test(text), 'no half-rendered greeting');
  });

  it('enrolls the buyer against the real payment intent and confirms by email', async () => {
    const ctx = ctxFor(courseSession(), { dbMap: enrollOk });
    assert.equal(await run(ctx), null);
    const enroll = ctx.db._calls.find(c => c.sql.includes('INSERT INTO enrollment'));
    assert.ok(enroll, 'an enrollment row must be written');
    assert.ok(enroll.sql.includes('ON CONFLICT(user_id, course_id)'), 'a redelivery must upsert, not duplicate');
    assert.ok(mailTo(ctx, 'Your course is ready'), 'the student must get a confirmation');
    assert.ok(mailTo(ctx, 'New enrollment'), 'the administrator must be notified');
  });

  it('reports the purchase to GA4 with the checkout identity, not the Stripe server identity', async () => {
    const ctx = ctxFor(courseSession({ metadata: { type: 'course', courseId: 'test-course-basic', ga_client_id: 'GA1.1.123.456', ga_session_id: '1738000000' } }), { dbMap: enrollOk });
    await run(ctx);
    const purchase = ctx.ga4.find(c => c.body.events[0].name === 'purchase');
    assert.ok(purchase);
    assert.equal(purchase.body.client_id, 'GA1.1.123.456');
    assert.equal(purchase.body.events[0].params.session_id, 1738000000);
    assert.equal(purchase.body.events[0].params.value, 50);
    assert.equal(purchase.body.events[0].params.transaction_id, 'pi_test_1');
    assert.deepEqual(purchase.body.events[0].params.items, [{ item_name: 'Course: test-course-basic' }]);
  });

  it('drops a non-numeric ga_session_id instead of reporting NaN to GA4', async () => {
    const ctx = ctxFor(courseSession({ metadata: { type: 'course', courseId: 'test-course-basic', ga_client_id: 'GA1.1.1.1', ga_session_id: 'not-a-number' } }), { dbMap: enrollOk });
    await run(ctx);
    const purchase = ctx.ga4.find(c => c.body.events[0].name === 'purchase');
    const sid = purchase.body.events[0].params.session_id;
    assert.ok(sid === undefined || Number.isFinite(sid), `session_id was ${sid}`);
    assert.ok(!JSON.stringify(purchase.body).includes('null,"session_id"'));
  });

  it('resolves an anonymous course buyer by address', async () => {
    const ctx = ctxFor(session({ metadata: { type: 'course', courseId: 'test-course-basic' } }), {
      dbMap: { 'SELECT id FROM user WHERE email': { stored: 'buyer@example.com', first: { id: 'usr_99' } }, ...enrollOk },
    });
    assert.equal(await run(ctx), null);
    const enroll = ctx.db._calls.find(c => c.sql.includes('INSERT INTO enrollment'));
    assert.equal(enroll.bound[1], 'usr_99');
  });

  it('enrolls an anonymous buyer whose stored address differs only in case', async () => {
    // The account was created with the address as the person typed it; Stripe
    // sends whatever they typed at checkout, and the handler lowercases before
    // binding. Only COLLATE NOCASE bridges the two. Drop it from the lookup and
    // a paying student silently gets no enrollment and a 500.
    const ctx = ctxFor(
      session({
        customer_details: { email: 'Buyer@Example.COM', name: 'Ada Lovelace' },
        metadata: { type: 'course', courseId: 'test-course-basic' },
      }),
      { dbMap: { 'SELECT id FROM user WHERE email': { stored: 'Buyer@Example.COM', first: { id: 'usr_99' } }, ...enrollOk } }
    );
    assert.equal(await run(ctx), null, 'a case-mismatched stored address must still resolve to the account');
    const lookup = ctx.db._calls.find(c => c.sql.includes('SELECT id FROM user WHERE email'));
    assert.deepEqual(lookup.bound, ['buyer@example.com'], 'the handler binds the lowercased address');
    const enroll = ctx.db._calls.find(c => c.sql.includes('INSERT INTO enrollment'));
    assert.ok(enroll, 'the buyer must be enrolled, not answered 500');
    assert.equal(enroll.bound[1], 'usr_99');
  });

  it('answers 500 when no account can be found for a course purchase', async () => {
    const ctx = ctxFor(session({ metadata: { type: 'course', courseId: 'test-course-basic' } }), {
      dbMap: { 'SELECT id FROM user WHERE email': { first: null } },
    });
    const parsed = await parseResponse(await run(ctx));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'No user account for course enrollment');
  });

  it('answers 500 for a course id that is not in the catalogue', async () => {
    const ctx = ctxFor(courseSession({ metadata: { type: 'course', courseId: 'course-that-does-not-exist' } }));
    const parsed = await parseResponse(await run(ctx));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Course not found');
    assert.equal(ctx.db._calls.filter(c => c.sql.includes('INSERT INTO enrollment')).length, 0);
  });

  it('answers 500 when the enrollment write throws', async () => {
    const ctx = ctxFor(courseSession(), { dbMap: { 'INSERT INTO enrollment': { throws: 'D1_ERROR: constraint' } } });
    const parsed = await parseResponse(await run(ctx));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Enrollment failed');
    assert.equal(ctx.sent.length, 0, 'no confirmation may be sent for an enrollment that did not land');
  });

  it('answers 500 when the enrollment batch reports a per-statement failure', async () => {
    // enrollUser returns false without throwing: the customer was charged and
    // the row never landed, so the event must be retried rather than confirmed.
    const ctx = ctxFor(courseSession(), { dbMap: { 'INSERT INTO enrollment': { run: { success: false } } } });
    const parsed = await parseResponse(await run(ctx));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Enrollment failed');
    assert.equal(ctx.ga4.length, 0, 'a failed enrollment must not report revenue');
  });

  it('answers 500 rather than enrolling when the payment intent cannot be resolved', async () => {
    // No payment_intent on the session means a retrieve is required; with no
    // Stripe key the client cannot be built. Enrolling anyway would store the
    // session id where the refund handler expects a pi_, so a full refund could
    // never revoke access.
    const ctx = ctxFor(courseSession({ payment_intent: null }), { dbMap: enrollOk, env: { STRIPE_SECRET_KEY: undefined } });
    const parsed = await parseResponse(await run(ctx));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Enrollment failed');
    assert.equal(ctx.db._calls.filter(c => c.sql.includes('INSERT INTO enrollment')).length, 0);
  });

  it('notifies the administrator even when SES credentials are missing for the student mail', async () => {
    const ctx = ctxFor(courseSession(), { dbMap: enrollOk, env: { AWS_ACCESS_KEY_ID: undefined } });
    assert.equal(await run(ctx), null);
    assert.equal(ctx.sent.length, 0);
    assert.ok(ctx.db._calls.find(c => c.sql.includes('INSERT INTO enrollment')), 'the enrollment still happens');
  });
});

// -------------------------------------------------- STUC subscriptions ----

describe('_webhook-checkout -- membership subscription', () => {
  const stucSession = (overrides = {}) => session({
    mode: 'subscription',
    subscription: 'sub_test_1',
    amount_total: 1900,
    payment_intent: null,
    metadata: { tier: 'hero' },
    ...overrides,
  });

  it('welcomes a new member and notifies the administrator', async () => {
    const ctx = ctxFor(stucSession());
    assert.equal(await run(ctx), null);
    const welcome = mailTo(ctx, 'Welcome to the Save the Uterus Club');
    assert.ok(welcome);
    assert.match(welcome.body.Content.Simple.Body.Text.Data, /you're now a Uterus Hero member/i);
    const adminNotice = mailTo(ctx, 'New STUC member');
    assert.ok(adminNotice, `sent: ${ctx.sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
    assert.match(adminNotice.body.Content.Simple.Subject.Data, /Uterus Hero \(\$19\.00\/mo\)/);
  });

  it('reports subscription revenue to GA4 against the subscription id', async () => {
    const ctx = ctxFor(stucSession());
    await run(ctx);
    const purchase = ctx.ga4.find(c => c.body.events[0].name === 'purchase');
    assert.ok(purchase);
    assert.equal(purchase.body.events[0].params.value, 19);
    assert.equal(purchase.body.events[0].params.transaction_id, 'sub_test_1');
    assert.deepEqual(purchase.body.events[0].params.items, [{ item_name: 'STUC Uterus Hero' }]);
  });

  it('reports the tier price when a trial-clamped checkout bills $0 up front', async () => {
    const ctx = ctxFor(stucSession({ amount_total: 0, metadata: { tier: 'superhero' } }));
    await run(ctx);
    const purchase = ctx.ga4.find(c => c.body.events[0].name === 'purchase');
    assert.equal(purchase.body.events[0].params.value, 99, 'a $0 first invoice must not report $0 revenue');
  });

  it('ignores an unknown tier entirely', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'platinum' } }));
    assert.equal(await run(ctx), null);
    // The account-creation welcome still goes out (that path is tier-agnostic);
    // nothing membership-shaped does, and no revenue is reported for a tier
    // with no known price.
    assert.equal(mailTo(ctx, 'Welcome to the Save the Uterus Club'), undefined);
    assert.equal(mailTo(ctx, 'New STUC member'), undefined);
    assert.equal(ctx.ga4.filter(c => c.body.events[0].name === 'purchase').length, 0);
  });

  it('does not send the new-member welcome or admin notice to a Wix migration handoff', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' } }), {
      dbMap: { 'FROM wix_subscription WHERE wix_subscription_id': { first: null } },
      env: { STRIPE_SECRET_KEY: undefined },
    });
    await run(ctx);
    assert.equal(mailTo(ctx, 'Welcome to the Save the Uterus Club'), undefined, 'a migrating donor is not a new member');
    assert.equal(mailTo(ctx, 'New STUC member'), undefined, 'the migration paths send their own admin mail');
  });

  it('tells a migrating donor the switch is in progress while the subscription is unconfirmed', async () => {
    // checkout.session.completed fires before 3DS confirms. Sending "complete"
    // here would be a false confirmation.
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' } }), {
      dbMap: { 'FROM wix_subscription WHERE wix_subscription_id': { first: null } },
      env: { STRIPE_SECRET_KEY: undefined },
    });
    await run(ctx);
    assert.ok(mailTo(ctx, 'Your donation switch is in progress'));
    assert.equal(mailTo(ctx, 'Your donation switch is complete'), undefined);
  });

  it('sends no status email at all when the completed session carries no subscription', async () => {
    const ctx = ctxFor(stucSession({ subscription: null, metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' } }), {
      dbMap: { 'FROM wix_subscription WHERE wix_subscription_id': { first: null } },
      env: { STRIPE_SECRET_KEY: undefined },
    });
    await run(ctx);
    assert.equal(mailTo(ctx, 'Your donation switch is in progress'), undefined, 'guessing pending would be a false notification');
    assert.equal(mailTo(ctx, 'Your donation switch is complete'), undefined);
  });

  it('defers the migration flip and releases the lock when the Stripe sub is not yet active', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' } }), {
      dbMap: {
        'FROM wix_subscription WHERE wix_subscription_id': { first: { email: 'donor@example.com', tier: 'hero', amount_cents: 1900, next_expected_at: null, stripe_subscription_id: null } },
      },
      env: { STRIPE_SECRET_KEY: undefined },
    });
    await run(ctx);
    const release = stmts(ctx, 'SET migration_handoff_started_at = NULL')[0];
    assert.ok(release, 'the lock must be released so the donor can retry');
    assert.ok(release.sql.includes('stripe_subscription_id IS NULL'));
    assert.equal(stmts(ctx, "migration_status='stripe_active'").length, 0, 'the flip must not happen on an unconfirmed sub');
    assert.equal(mailTo(ctx, 'cancel Wix sub'), undefined, 'admin must not be told to cancel Wix yet');
  });

  it('alerts the administrator when an already-migrated donor starts a second Stripe subscription', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' } }), {
      dbMap: {
        'FROM wix_subscription WHERE wix_subscription_id': { first: { email: 'donor@example.com', tier: 'hero', amount_cents: 1900, next_expected_at: null, stripe_subscription_id: 'sub_OTHER' } },
      },
      env: { STRIPE_SECRET_KEY: undefined },
    });
    await run(ctx);
    const alert = mailTo(ctx, 'duplicate Stripe sub');
    assert.ok(alert, `sent: ${ctx.sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
    assert.match(alert.body.Content.Simple.Body.Text.Data, /Existing Stripe sub: {4}sub_OTHER/);
  });

  it('stays silent when Stripe simply redelivers the same already-migrated event', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' } }), {
      dbMap: {
        'FROM wix_subscription WHERE wix_subscription_id': { first: { email: 'donor@example.com', tier: 'hero', amount_cents: 1900, next_expected_at: null, stripe_subscription_id: 'sub_test_1' } },
      },
      env: { STRIPE_SECRET_KEY: undefined },
    });
    await run(ctx);
    assert.equal(mailTo(ctx, 'duplicate Stripe sub'), undefined, 'a redelivery of the same sub is benign');
  });

  it('falls back to matching a cold checkout by address when no metadata token is present', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero' } }), {
      dbMap: {
        'SELECT wix_subscription_id, status FROM wix_subscription': { all: { results: [{ wix_subscription_id: 'wxs_legacy1', status: 'active' }] } },
        "SET migration_status='stripe_active'": { run: { success: true, meta: { changes: 1 } } },
      },
    });
    await run(ctx);
    const flip = stmts(ctx, "SET migration_status='stripe_active'")[0];
    assert.ok(flip, 'the legacy email-match path must still flip the row');
    assert.deepEqual(flip.bound, ['sub_test_1', 'cs_test_session', 'wxs_legacy1']);
    const notice = mailTo(ctx, 'cancel Wix sub');
    assert.ok(notice);
    assert.match(notice.body.Content.Simple.Body.Text.Data, /VERIFY FIRST in Stripe Dashboard/);
  });

  it('alerts on a duplicate when the email-match UPDATE matches no row', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero' } }), {
      dbMap: {
        'SELECT wix_subscription_id, status FROM wix_subscription': { all: { results: [{ wix_subscription_id: 'wxs_legacy1', status: 'active' }] } },
        "SET migration_status='stripe_active'": { run: { success: true, meta: { changes: 0 } } },
      },
    });
    await run(ctx);
    assert.ok(mailTo(ctx, 'duplicate Stripe sub'));
  });

  it('escalates by email when the email-match handoff throws', async () => {
    const ctx = ctxFor(stucSession({ metadata: { tier: 'hero' } }), {
      dbMap: { 'SELECT wix_subscription_id, status FROM wix_subscription': { throws: 'D1_ERROR: locked' } },
    });
    assert.equal(await run(ctx), null, 'a handoff failure must not fail the webhook');
    assert.ok(mailTo(ctx, 'migration handoff FAILED'), `sent: ${ctx.sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
  });
});

// --------------------------------------------------------- donations -----

describe('_webhook-checkout -- one-time donation', () => {
  it('records the gift, notifies the administrator and reports the revenue', async () => {
    const ctx = ctxFor(session({ amount_total: 25000, metadata: { type: 'donation' } }));
    assert.equal(await run(ctx), null);

    const gift = stmts(ctx, 'INSERT INTO donor_gift')[0];
    assert.ok(gift, 'the CRM mirror row must be written');
    assert.ok(gift.sql.includes('ON CONFLICT(source, source_id) DO NOTHING'), 'gift recording must be idempotent');
    assert.equal(gift.bound[1], 'buyer@example.com');
    assert.equal(gift.bound[3], 25000);
    assert.equal(gift.bound[6], 'pi_test_1');

    const notice = mailTo(ctx, 'New donation');
    assert.ok(notice);
    assert.match(notice.body.Content.Simple.Subject.Data, /\$250\.00 - Ada Lovelace/);

    const purchase = ctx.ga4.find(c => c.body.events[0].name === 'purchase');
    assert.equal(purchase.body.events[0].params.value, 250);
    assert.deepEqual(purchase.body.events[0].params.items, [{ item_name: 'Donation' }]);
  });

  it('leaves the gift to the payment-intent-keyed daemon when the session has no PI', async () => {
    const ctx = ctxFor(session({ payment_intent: null, metadata: { type: 'donation' } }));
    await run(ctx);
    assert.equal(stmts(ctx, 'INSERT INTO donor_gift').length, 0, 'recording under a cs_ id would double-count');
    assert.equal(mailTo(ctx, 'New donation'), undefined);
  });

  it('does not mirror a course payment into donor_gift', async () => {
    const ctx = ctxFor(session({ metadata: { type: 'course', courseId: 'test-course-basic' }, client_reference_id: 'usr_42' }), {
      dbMap: { 'INSERT INTO enrollment': { run: { success: true, meta: { changes: 1 } } } },
    });
    await run(ctx);
    assert.equal(stmts(ctx, 'INSERT INTO donor_gift').length, 0);
  });

  it('never fails the webhook when the CRM mirror write throws', async () => {
    const ctx = ctxFor(session({ metadata: { type: 'donation' } }), { dbMap: { 'INSERT INTO donor_gift': { throws: 'D1_ERROR: locked' } } });
    assert.equal(await run(ctx), null, 'the daily donor-gift sweep self-heals; the payment is already taken');
  });

  it('records a consented provider-directory supporter with a backfillable sequence sentinel', async () => {
    const ctx = ctxFor(session({
      metadata: { campaign: 'provider-directory' },
      custom_fields: [{ key: 'show_supporter', dropdown: { value: 'yes' } }],
    }), { env: { STRIPE_SECRET_KEY: undefined } });
    await run(ctx);
    const row = stmts(ctx, 'INSERT INTO supporter_recognition')[0];
    assert.ok(row, 'a consented gift must never be dropped because the Stripe count failed');
    assert.equal(row.bound[3], 0, 'an unavailable sequence writes the 0 sentinel');
    assert.equal(row.bound[2], 'Ada L.');
  });

  it('records nothing for a provider-directory gift without consent', async () => {
    const ctx = ctxFor(session({
      metadata: { campaign: 'provider-directory' },
      custom_fields: [{ key: 'show_supporter', dropdown: { value: 'no' } }],
    }));
    await run(ctx);
    assert.equal(stmts(ctx, 'INSERT INTO supporter_recognition').length, 0);
  });
});

// ------------------------------------------------------ expired session ---

describe('_webhook-checkout -- handleCheckoutExpired', () => {
  const expired = (metadata, created = CREATED) => ({
    id: 'evt_x', type: 'checkout.session.expired', created,
    data: { object: { id: 'cs_expired', created, metadata } },
  });

  it('ignores an expiry with no Wix migration token', async () => {
    const db = mockDB();
    assert.equal(await handleCheckoutExpired(db, expired({}), mockEnv({ DB: db }), mockWaitUntil()), null);
    assert.equal(db._calls.length, 0);
  });

  it('ignores an expiry whose token is not a Wix subscription id', async () => {
    const db = mockDB();
    assert.equal(await handleCheckoutExpired(db, expired({ wix_subscription_id: '../../etc/passwd' }), mockEnv({ DB: db }), mockWaitUntil()), null);
    assert.equal(db._calls.length, 0);
  });

  it('releases only a lock older than the expired session, so a newer checkout keeps its lock', async () => {
    const db = mockDB();
    const result = await handleCheckoutExpired(db, expired({ wix_subscription_id: 'wxs_abc123' }), mockEnv({ DB: db }), mockWaitUntil());
    assert.equal(result, null);
    const release = db._calls.find(c => c.sql.includes('SET migration_handoff_started_at = NULL'));
    assert.ok(release);
    assert.deepEqual(release.bound, ['wxs_abc123', CREATED]);
    assert.ok(release.sql.includes('migration_handoff_started_at <= ?'), 'a stale expiry must not clear a newer lock');
    assert.ok(release.sql.includes('stripe_subscription_id IS NULL'), 'a migrated row must never be touched');
  });

  it('answers 500 so Stripe retries when the lock release fails', async () => {
    const db = mockDB({ 'SET migration_handoff_started_at = NULL': { throws: 'D1_ERROR: locked' } });
    const result = await handleCheckoutExpired(db, expired({ wix_subscription_id: 'wxs_abc123' }), mockEnv({ DB: db }), mockWaitUntil());
    const parsed = await parseResponse(result);
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'Internal error' });
  });
});

// ------------------------------------------- narrow paths found by the ----
// coverage-honesty detector (lines reported covered that V8 said never ran).

describe('_webhook-checkout -- edited-email divergence warning', () => {
  it('warns when a logged-in buyer changes their address at the Stripe checkout', async () => {
    // The account link uses client_reference_id (pre-checkout identity) while
    // the confirmation goes to customer_details.email (the edited value). The
    // silent divergence is the risk, so it must reach telemetry.
    const events = [];
    const ctx = ctxFor(session({
      client_reference_id: 'usr_42',
      customer_email: 'before@example.com',
      customer_details: { email: 'after@example.com', name: 'Ada' },
    }), { env: { EVENTS: { writeDataPoint: (dp) => events.push(dp) } } });
    await run(ctx);
    const warn = events.find(e => e.blobs?.[2] === 'checkout_email_mismatch');
    assert.ok(warn, `expected a mismatch warning, got: ${events.map(e => e.blobs?.[2]).join(', ')}`);
    assert.equal(warn.blobs[3], 'warn');
    assert.match(warn.blobs[4], /client_ref=usr_42/);
  });

  it('stays quiet when the buyer did not change their address', async () => {
    const events = [];
    const ctx = ctxFor(session({
      client_reference_id: 'usr_42',
      customer_email: 'same@example.com',
      customer_details: { email: 'same@example.com', name: 'Ada' },
    }), { env: { EVENTS: { writeDataPoint: (dp) => events.push(dp) } } });
    await run(ctx);
    assert.equal(events.find(e => e.blobs?.[2] === 'checkout_email_mismatch'), undefined);
  });
});

describe('_webhook-checkout -- supporter sequence lookup', () => {
  it('still records the consented gift when the Stripe gift-count call fails', async () => {
    // With a Stripe key present the count is actually attempted (the previous
    // test only proved the no-key path); the network stub refuses it, which is
    // the same shape as a Stripe outage. A consented row must never be lost to
    // a failed count.
    const ctx = ctxFor(session({
      metadata: { campaign: 'provider-directory' },
      custom_fields: [{ key: 'show_supporter', dropdown: { value: 'yes' } }],
    }), { env: { STRIPE_SECRET_KEY: 'sk_test_present' } });
    await run(ctx);
    const row = stmts(ctx, 'INSERT INTO supporter_recognition')[0];
    assert.ok(row, 'a failed sequence count must not drop the recognition row');
    assert.equal(row.bound[3], 0, 'the 0 sentinel marks a backfillable sequence');
  });
});

// ------------------------------------- paths behind a live Stripe call ----
//
// Everything below needs the Stripe REST API to answer. Without a route these
// lines sit behind a throwing client and never execute, while v8 still
// attributes the enclosing block's count to them.

describe('_webhook-checkout -- resolving a deferred payment intent', () => {
  const courseSession = () => session({
    client_reference_id: 'usr_42',
    payment_intent: null,
    metadata: { type: 'course', courseId: 'test-course-basic' },
  });
  const enrollOk = { 'INSERT INTO enrollment': { run: { success: true, meta: { changes: 1 } } } };

  it('retrieves the session and enrolls against the resolved pi_, not the cs_ id', async () => {
    // An async payment method leaves payment_intent null on the completed
    // event. Storing session.id here would make the refund handler's
    // `stripe_payment_intent = charge.payment_intent` filter unmatchable, so a
    // fully refunded student would keep course access forever.
    const stub = withStripe({ '/v1/checkout/sessions/': { id: 'cs_test_session', object: 'checkout.session', payment_intent: 'pi_resolved_later' } });
    try {
      const ctx = ctxFor(courseSession(), { dbMap: enrollOk });
      assert.equal(await run(ctx, stub), null);
      const enroll = ctx.db._calls.find(c => c.sql.includes('INSERT INTO enrollment'));
      assert.equal(enroll.bound[3], 'pi_resolved_later');
      assert.ok(ctx.stripeCalls.length > 0, 'the session must actually have been retrieved');
    } finally { stub.restore(); }
  });

  it('falls back to the session id for a $0 checkout that never got a payment intent', async () => {
    const stub = withStripe({ '/v1/checkout/sessions/': { id: 'cs_test_session', object: 'checkout.session', payment_intent: null } });
    try {
      const ctx = ctxFor(courseSession(), { dbMap: enrollOk });
      assert.equal(await run(ctx, stub), null, 'a free enrollment must still succeed');
      const enroll = ctx.db._calls.find(c => c.sql.includes('INSERT INTO enrollment'));
      assert.equal(enroll.bound[3], 'cs_test_session', 'a $0 charge cannot be refunded, so the cs_ id is safe here');
    } finally { stub.restore(); }
  });
});

describe('_webhook-checkout -- STUC join denylist', () => {
  const DENIED_EMAIL = 'drduane@factsaboutfertility.org';

  function ctxWithEvents(sessionObject, opts = {}) {
    const eventCalls = [];
    const ctx = ctxFor(sessionObject, {
      ...opts,
      env: {
        ...opts.env,
        EVENTS: { writeDataPoint: (dp) => eventCalls.push(dp) },
      },
    });
    ctx.eventCalls = eventCalls;
    return ctx;
  }

  it('cancels the subscription, refunds the invoice payment_intent and skips account creation', async () => {
    const stub = withStripe({
      '/v1/subscriptions/sub_denied': {
        id: 'sub_denied', object: 'subscription', status: 'active',
        latest_invoice: { id: 'in_denied', payment_intent: 'pi_denied' },
      },
      '/v1/refunds': { id: 're_denied', payment_intent: 'pi_denied' },
    });
    try {
      const ctx = ctxWithEvents(session({
        mode: 'subscription',
        subscription: 'sub_denied',
        payment_intent: null,
        customer_details: { email: DENIED_EMAIL, name: 'D. Duane' },
        metadata: { tier: 'hero' },
      }));
      assert.equal(await run(ctx, stub), null, 'denylist path answers the normal 2xx acknowledgment shape');

      const subCalls = ctx.stripeCalls.filter(c => c.url.includes('/v1/subscriptions/sub_denied'));
      assert.ok(subCalls.length >= 2, 'must both retrieve (for the invoice) and cancel the subscription');
      const refundCall = ctx.stripeCalls.find(c => c.url.includes('/v1/refunds'));
      assert.ok(refundCall, 'must refund the payment_intent behind the subscription');

      assert.equal(stmts(ctx, 'INSERT INTO user').length, 0, 'a denied member must never get an account');
      assert.equal(stmts(ctx, 'UPDATE user SET stripe_customer_id').length, 0);
      assert.equal(ctx.sent.length, 0, 'no welcome or admin-notify email for a denied member');
      assert.equal(ctx.ga4.length, 0, 'no purchase event for a denylisted checkout');

      const cancelledEvent = ctx.eventCalls.find(dp => dp.indexes?.[0] === 'join-denylist-cancelled');
      assert.ok(cancelledEvent, 'must fire the join-denylist-cancelled analytics event');
      assert.ok(!JSON.stringify(cancelledEvent).includes(DENIED_EMAIL), 'the raw denied email must never reach analytics');
    } finally { stub.restore(); }
  });

  it('is idempotent when Stripe redelivers against an already-cancelled, already-refunded checkout', async () => {
    const stub = withStripe({
      '/v1/subscriptions/sub_denied2': (call) => {
        if (call.url.includes('/cancel')) {
          return new Response(JSON.stringify({ error: { message: 'This subscription has already been canceled.' } }), {
            status: 400, headers: { 'content-type': 'application/json' },
          });
        }
        return { id: 'sub_denied2', object: 'subscription', status: 'canceled', latest_invoice: { id: 'in_x', payment_intent: 'pi_denied2' } };
      },
      '/v1/refunds': () => new Response(JSON.stringify({ error: { message: 'Charge already refunded.' } }), {
        status: 400, headers: { 'content-type': 'application/json' },
      }),
    });
    try {
      const ctx = ctxWithEvents(session({
        mode: 'subscription',
        subscription: 'sub_denied2',
        payment_intent: null,
        customer_details: { email: DENIED_EMAIL, name: 'D. Duane' },
        metadata: { tier: 'hero' },
      }));
      assert.equal(await run(ctx, stub), null, 'a redelivered denylist webhook must not throw uncaught');
    } finally { stub.restore(); }
  });

  it('leaves an unrelated allowed member fully untouched', async () => {
    const ctx = ctxFor(session({
      mode: 'subscription', subscription: 'sub_allowed', payment_intent: null,
      customer_details: { email: 'member@example.com', name: 'A Member' },
      metadata: { tier: 'hero' },
    }));
    await run(ctx);
    assert.ok(mailTo(ctx, 'Welcome to the Save the Uterus Club'), 'a non-denied member must still get the welcome email');
  });

  it('refunds a STUC-context donation from the denied email and skips donor_gift', async () => {
    const stub = withStripe({ '/v1/refunds': { id: 're_donation', payment_intent: 'pi_stuc_donation' } });
    try {
      const ctx = ctxWithEvents(session({
        mode: 'payment',
        payment_intent: 'pi_stuc_donation',
        customer_details: { email: DENIED_EMAIL, name: 'D. Duane' },
        metadata: { type: 'donation', stuc_context: '1' },
      }));
      assert.equal(await run(ctx, stub), null);
      const refundCall = ctx.stripeCalls.find(c => c.url.includes('/v1/refunds'));
      assert.ok(refundCall, 'a STUC-context donation from a denied email must be refunded');
      assert.equal(stmts(ctx, 'INSERT INTO donor_gift').length, 0, 'no donor_gift row for a reversed STUC-context donation');
      assert.equal(ctx.sent.length, 0);
    } finally { stub.restore(); }
  });

  it('leaves a non-STUC donation from the denied email completely alone', async () => {
    const ctx = ctxFor(session({
      mode: 'payment',
      payment_intent: 'pi_plain_donation',
      customer_details: { email: DENIED_EMAIL, name: 'D. Duane' },
      metadata: { type: 'donation' },
    }));
    await run(ctx);
    const gift = stmts(ctx, 'INSERT INTO donor_gift')[0];
    assert.ok(gift, 'a plain (non-STUC-context) donation from the denied email must be recorded normally');
  });
});

describe('_webhook-checkout -- Wix migration handoff with a confirmed subscription', () => {
  const futureIso = new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10);
  const migrationSession = (overrides = {}) => session({
    mode: 'subscription',
    subscription: 'sub_migrated',
    amount_total: 1900,
    payment_intent: null,
    metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' },
    ...overrides,
  });
  const wixRow = (extra = {}) => ({
    'SELECT amount_cents, next_expected_at FROM wix_subscription': { first: { amount_cents: 1900, next_expected_at: futureIso, ...extra } },
    'SELECT email, tier, amount_cents, next_expected_at, stripe_subscription_id': {
      first: { email: 'donor@example.com', tier: 'hero', amount_cents: 1900, next_expected_at: futureIso, stripe_subscription_id: null, ...extra },
    },
  });
  const activeSub = { '/v1/subscriptions/sub_migrated': { id: 'sub_migrated', object: 'subscription', status: 'active' } };

  it('tells the donor the switch is complete, quoting their existing date and amount', async () => {
    const stub = withStripe(activeSub);
    try {
      const ctx = ctxFor(migrationSession(), { dbMap: wixRow() });
      assert.equal(await run(ctx, stub), null);
      const mail = mailTo(ctx, 'Your donation switch is complete');
      assert.ok(mail, `sent: ${ctx.sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
      const text = mail.body.Content.Simple.Body.Text.Data;
      assert.match(text, /at \$19\/month -- the same date and same amount you were already on/);
      assert.match(text, /You won't be double-charged/);
    } finally { stub.restore(); }
  });

  it('quotes a month-from-now date when the stored next charge date has already passed', async () => {
    const stub = withStripe(activeSub);
    try {
      const ctx = ctxFor(migrationSession(), { dbMap: wixRow({ next_expected_at: '2020-01-15' }) });
      await run(ctx, stub);
      const text = mailTo(ctx, 'Your donation switch is complete').body.Content.Simple.Body.Text.Data;
      assert.match(text, /going forward you'll be charged on the same day each month/);
    } finally { stub.restore(); }
  });

  it('flips the Wix row and asks the administrator to cancel, only after a confirmed send', async () => {
    const stub = withStripe(activeSub);
    try {
      const ctx = ctxFor(migrationSession(), { dbMap: wixRow() });
      await run(ctx, stub);

      const flip = stmts(ctx, "migration_status='stripe_active'")[0];
      assert.ok(flip, 'the migration must be recorded');
      assert.deepEqual(flip.bound, ['sub_migrated', 'cs_test_session', 'wxs_abc123']);
      assert.ok(flip.sql.includes('stripe_subscription_id IS NULL'), 'the flip must be idempotent under retry');

      const notice = mailTo(ctx, 'cancel Wix sub');
      assert.ok(notice);
      assert.match(notice.body.Content.Simple.Body.Text.Data, /VERIFY in Stripe Dashboard/);

      assert.ok(stmts(ctx, 'SET admin_notified_at').length > 0, 'a confirmed send marks the notify done');
    } finally { stub.restore(); }
  });

  it('leaves admin_notified_at unset when the administrator email fails, so the sweep retries', async () => {
    const stub = withStripe(activeSub, { ses: () => { throw new Error('SES unavailable'); } });
    try {
      const ctx = ctxFor(migrationSession(), { dbMap: wixRow() });
      assert.equal(await run(ctx, stub), null, 'a failed alert must not fail the webhook');
      assert.ok(stmts(ctx, "migration_status='stripe_active'").length > 0, 'the flip already succeeded');
      assert.equal(stmts(ctx, 'SET admin_notified_at').length, 0, 'marking notified after a failed send would lose the alert');
      const failLog = stmts(ctx, 'INSERT INTO email_log').filter(c => c.bound[0] === 'failed');
      assert.ok(failLog.length > 0, 'the failed alert must be recorded');
    } finally { stub.restore(); }
  });

  it('sends no cancel-Wix instruction when the flip loses the retry race', async () => {
    const stub = withStripe(activeSub);
    try {
      const ctx = ctxFor(migrationSession(), {
        dbMap: { ...wixRow(), "migration_status='stripe_active'": { run: { success: true, meta: { changes: 0 } } } },
      });
      await run(ctx, stub);
      assert.equal(mailTo(ctx, 'cancel Wix sub'), undefined, 'the winner of the race already sent it');
      assert.equal(stmts(ctx, 'SET admin_notified_at').length, 0);
    } finally { stub.restore(); }
  });

  it('still records the recognition sequence when Stripe can be reached', async () => {
    const stub = withStripe({
      '/v1/payment_intents/search': { object: 'search_result', has_more: false, data: [{ id: 'pi_a' }, { id: 'pi_b' }, { id: 'pi_c' }] },
    });
    try {
      const ctx = ctxFor(session({
        metadata: { campaign: 'provider-directory' },
        custom_fields: [{ key: 'show_supporter', dropdown: { value: 'yes' } }],
      }));
      await run(ctx, stub);
      const row = stmts(ctx, 'INSERT INTO supporter_recognition')[0];
      assert.ok(row);
      assert.equal(row.bound[3], 3, 'the supporter gets their real place in the campaign');
    } finally { stub.restore(); }
  });
});

describe('_webhook-checkout -- migration email with incomplete Wix data', () => {
  it('promises continuity without inventing a date or an amount', async () => {
    // A Wix row with no next charge date and no amount must still produce a
    // sendable email; the alternative arms of both ternaries are what run.
    const stub = withStripe({ '/v1/subscriptions/sub_migrated': { id: 'sub_migrated', object: 'subscription', status: 'trialing' } });
    try {
      const ctx = ctxFor(session({
        mode: 'subscription',
        subscription: 'sub_migrated',
        amount_total: 1900,
        payment_intent: null,
        metadata: { tier: 'hero', wix_subscription_id: 'wxs_abc123' },
      }), {
        dbMap: {
          'SELECT amount_cents, next_expected_at FROM wix_subscription': { first: { amount_cents: 0, next_expected_at: null } },
          'SELECT email, tier, amount_cents, next_expected_at, stripe_subscription_id': {
            first: { email: 'donor@example.com', tier: 'hero', amount_cents: null, next_expected_at: null, stripe_subscription_id: null },
          },
        },
      });
      await run(ctx, stub);

      const donorMail = mailTo(ctx, 'Your donation switch is complete');
      assert.ok(donorMail);
      const text = donorMail.body.Content.Simple.Body.Text.Data;
      assert.match(text, /Your donation will continue going forward\./);
      assert.ok(!/\$undefined|\$null|\$NaN/.test(text), `placeholder leaked into donor copy: ${text}`);
      assert.ok(!/processed on/.test(text), 'no date may be quoted when none is known');

      const adminMail = mailTo(ctx, 'cancel Wix sub');
      assert.ok(adminMail);
      const adminText = adminMail.body.Content.Simple.Body.Text.Data;
      assert.match(adminText, /Next charge: {4}their next scheduled donation date/);
      assert.match(adminText, /Amount: {9}\(unknown\)/);
    } finally { stub.restore(); }
  });
});

describe('_webhook-checkout -- supporter sequence via the list fallback', () => {
  it('counts campaign gifts by scanning payment intents when Stripe search is unavailable', async () => {
    // paymentIntents.search is an indexed endpoint that can be unavailable on
    // an account; the counter falls back to a filtered list scan.
    const stub = withStripe({
      '/v1/payment_intents/search': new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'search unavailable' } }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      ),
      '/v1/payment_intents': {
        object: 'list',
        has_more: false,
        data: [
          { id: 'pi_1', status: 'succeeded', metadata: { campaign: 'provider-directory' } },
          { id: 'pi_2', status: 'succeeded', metadata: { campaign: 'other-campaign' } },
          { id: 'pi_3', status: 'canceled', metadata: { campaign: 'provider-directory' } },
          { id: 'pi_4', status: 'succeeded', metadata: { campaign: 'provider-directory' } },
        ],
      },
    });
    try {
      const ctx = ctxFor(session({
        metadata: { campaign: 'provider-directory' },
        custom_fields: [{ key: 'show_supporter', dropdown: { value: 'yes' } }],
      }));
      await run(ctx, stub);
      const row = stmts(ctx, 'INSERT INTO supporter_recognition')[0];
      assert.ok(row);
      assert.equal(row.bound[3], 2, 'only succeeded gifts for THIS campaign count');
    } finally { stub.restore(); }
  });
});

// ------------------------------------------- executed concurrent-race link ---

/**
 * The concurrent-account-creation heal path (_webhook-checkout.js around the
 * `INSERT OR IGNORE INTO user` / `UPDATE user SET stripe_customer_id = COALESCE`
 * pair), run against a REAL SQLite database loaded with the committed schema.
 *
 * Reaching this branch needs the SELECT to miss and the INSERT to conflict --
 * i.e. a competing writer landing in between. mockDB can be told to answer
 * `changes: 0`, but it cannot enforce `idx_user_email_nocase`, so under mockDB
 * the conflict is asserted rather than caused, and the follow-up UPDATE's
 * collation is unobservable. Here the index does the rejecting and the UPDATE
 * either finds the winner's row or does not.
 */
describe('_webhook-checkout -- concurrent account creation, executed', () => {
  function raceCtx(storedEmail) {
    let planted = false;
    const db = sqliteD1({
      interleave({ sql, db: raw }) {
        if (planted || !sql.includes('INSERT OR IGNORE INTO user')) return;
        planted = true;
        // The winning isolate creates the account first, storing the address in
        // a DIFFERENT case than the one this checkout normalized to.
        insertUser(raw, { id: 'usr_winner', email: storedEmail, hashed_password: '' });
      },
    });
    const env = mockEnv({ DB: db, STRIPE_SECRET_KEY: 'sk_test_x' });
    return {
      db, env,
      waitUntil: mockWaitUntil(),
      request: mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook', headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
      event: evt(session()),
      plantedRef: () => planted,
    };
  }

  it('links the Stripe customer onto the winner\'s row even when the stored address differs in case', async () => {
    const ctx = raceCtx('BUYER@Example.com');
    await run(ctx);

    assert.ok(ctx.plantedRef(), 'the competing writer never fired -- the race was not reproduced');
    const users = ctx.db._sqlite.prepare('SELECT id, email, stripe_customer_id FROM user').all();
    assert.equal(users.length, 1, `the unique NOCASE index must reject the duplicate insert: ${JSON.stringify(users)}`);
    assert.equal(users[0].id, 'usr_winner');
    assert.equal(users[0].email, 'BUYER@Example.com', 'the winner\'s stored address must not be rewritten');
    assert.equal(
      users[0].stripe_customer_id, 'cus_test_1',
      'the paying customer was orphaned: the account exists but has no Stripe id, so their next login sees no membership'
    );
    assert.equal(mailTo(ctx, 'Orphaned Stripe customer'), undefined, 'a successful link must not alert the administrator');
  });

  it('alerts instead of clobbering when the winner is already linked to a different customer', async () => {
    let planted = false;
    const db = sqliteD1({
      interleave({ sql, db: raw }) {
        if (planted || !sql.includes('INSERT OR IGNORE INTO user')) return;
        planted = true;
        insertUser(raw, { id: 'usr_winner', email: 'Buyer@Example.com', hashed_password: '', stripe_customer_id: 'cus_OTHER' });
      },
    });
    const ctx = {
      db, env: mockEnv({ DB: db, STRIPE_SECRET_KEY: 'sk_test_x' }),
      waitUntil: mockWaitUntil(),
      request: mockRequest('POST', { url: 'https://rrmacademy.org/api/stripe-webhook', headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
      event: evt(session()),
    };
    await run(ctx);

    assert.ok(planted);
    const row = ctx.db._sqlite.prepare('SELECT stripe_customer_id FROM user WHERE id = ?').get('usr_winner');
    assert.equal(row.stripe_customer_id, 'cus_OTHER', 'COALESCE must never overwrite an existing link');
    const alert = mailTo(ctx, 'Orphaned Stripe customer');
    assert.ok(alert, 'an unlinkable customer must be surfaced, not swallowed');
    assert.match(alert.body.Content.Simple.Body.Text.Data, /Orphaned customer: cus_test_1/);
  });
});
