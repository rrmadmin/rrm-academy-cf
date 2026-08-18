/**
 * functions/api/events/register.js -- email-gated registration for a FREE
 * Save the Uterus Club event.
 *
 * WHY A REAL ENGINE
 * -----------------
 * Same reasoning as test/courses-waitlist.test.js, which this endpoint mirrors:
 * every claim worth making is about a ROW. The registration upsert is
 * `ON CONFLICT(post_id, email) DO UPDATE SET user_id = COALESCE(...)`, and the
 * `email TEXT COLLATE NOCASE` + `UNIQUE(post_id, email COLLATE NOCASE)` pair is
 * what makes a differently-cased repeat a resend rather than a second row. A
 * substring mock models none of that. Everything below runs on node:sqlite with
 * the committed schema plus the committed migrations/032 DDL, read off disk.
 *
 * WHY THE EMAIL IS ASSERTED THROUGH THE SES CALL
 * ----------------------------------------------
 * The joining link is allowed in exactly one place: the sent message. The way to
 * prove that is to read what actually went to the mail transport and, separately,
 * to read the response body and the analytics blobs and show the link is NOT in
 * them. stubExternalFetch already routes amazonaws.com, so the assertion is over
 * the real SESv2 payload sendTransactionalEmail built, not over a spy on our own
 * function. A test that stubbed the module boundary would be asserting the stub.
 *
 * WHAT IS STILL FAKED
 *  - Turnstile, EmailListVerify, GA4 and SES are the stubExternalFetch router.
 *  - KV is the in-memory mockKV, so the rate limits are counter behaviour inside
 *    one isolate, not a global limit.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse, stubExternalFetch,
  drainWaitUntil, randomIp,
} from './_helpers.js';
import { sqliteD1, insertUser } from './_d1-sqlite.mjs';

const register = await import('../functions/api/events/register.js');

const MIGRATION_025 = readFileSync(new URL('../migrations/025-stuc-action-areas.sql', import.meta.url), 'utf8');
const MIGRATION_032 = readFileSync(new URL('../migrations/032-free-events.sql', import.meta.url), 'utf8');

const AUTHOR = 'u_evt_author';
const MEMBER = 'u_evt_member';
const MEET_URL = 'https://meet.google.com/gat-eded-xyz';
const DIAL = 'Phone: +1 555-020-1111';
const PIN = 'PIN: 445566';
const SLUG = 'free-endo-call';
const POST_ID = 'post_free_1';

const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

const CONTENT = [
  'Endometriosis, Start to Finish',
  'A free public call. Bring your questions.',
  `Google Meet link: ${MEET_URL}`,
  DIAL,
  PIN,
].join('\n\n');

function insertEvent(sqlite, over = {}) {
  const row = {
    id: POST_ID,
    author_id: AUTHOR,
    type: 'event',
    title: 'Endometriosis, Start to Finish',
    content: CONTENT,
    channel: 'stuc',
    slug: SLUG,
    event_date: inHours(48),
    event_link: MEET_URL,
    speaker: 'Dr. Naomi Whittaker',
    is_free: 1,
    ...over,
  };
  const cols = Object.keys(row);
  sqlite.prepare(
    `INSERT INTO community_post (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

async function seededDb(extra, opts = {}) {
  return sqliteD1({
    ...opts,
    seed(sqlite) {
      sqlite.exec(MIGRATION_025);
      sqlite.exec(MIGRATION_032);
      insertUser(sqlite, { id: AUTHOR, email: 'staff@rrmacademy.org', role: 'admin' });
      insertUser(sqlite, { id: MEMBER, email: 'member@example.com', first_name: 'Mia' });
      insertEvent(sqlite);
      if (extra) extra(sqlite);
    },
  });
}

const registrations = (db) => db._sqlite.prepare('SELECT * FROM event_registration ORDER BY email').all();
const subscribers = (db) => db._sqlite.prepare('SELECT * FROM newsletter_subscriber ORDER BY email').all();
const emailLog = (db) => db._sqlite.prepare('SELECT * FROM email_log ORDER BY rowid').all();

const makeEnv = (db, over = {}) => mockEnv({ DB: db, COMMUNITY_KV: mockKV(), ...over });

function request(body, { session, ip } = {}) {
  const headers = { 'CF-Connecting-IP': ip || randomIp() };
  if (session) headers.Cookie = `session=${session}`;
  return mockRequest('POST', {
    url: 'https://rrmacademy.org/api/events/register',
    headers,
    ...(typeof body === 'string' ? { rawBody: body } : { body }),
  });
}

async function submit(env, body, opts = {}) {
  const waitUntil = mockWaitUntil();
  const res = await register.onRequestPost({ request: request(body, opts), env, waitUntil });
  await drainWaitUntil(waitUntil);
  return { ...(await parseResponse(res)), waitUntil };
}

/** The SESv2 request bodies the endpoint produced, decoded. */
function sentMail(net) {
  return net.ses.map((c) => {
    const payload = typeof c.body === 'string' ? JSON.parse(c.body) : c.body;
    const simple = payload.Content.Simple;
    return {
      from: payload.FromEmailAddress,
      to: payload.Destination.ToAddresses,
      replyTo: payload.ReplyToAddresses,
      subject: simple.Subject.Data,
      html: simple.Body.Html?.Data ?? '',
      text: simple.Body.Text?.Data ?? '',
    };
  });
}

const VALID = { slug: SLUG, email: 'signup@example.com', turnstileToken: 'tok' };

describe('POST /api/events/register -- refusals', () => {
  let db; let net; let env;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch();
    env = makeEnv(db);
  });
  afterEach(() => { net.restore(); db.close(); });

  it('OPTIONS answers the CORS preflight', async () => {
    assert.equal((await register.onRequestOptions()).status, 204);
  });

  it('503 when the DB binding is missing', async () => {
    const { status, body } = await submit(makeEnv(undefined, { DB: undefined }), VALID);
    assert.equal(status, 503);
    assert.equal(body.error, 'service_unavailable');
  });

  it('503 when Turnstile is not configured', async () => {
    const { status } = await submit(makeEnv(db, { CF_TURNSTILE_SECRET: undefined }), VALID);
    assert.equal(status, 503);
    assert.equal(registrations(db).length, 0);
  });

  it('400 on a body that is not JSON', async () => {
    const { status, body } = await submit(env, 'nope');
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_json');
  });

  it('400 with a field-named message on each missing or malformed field', async () => {
    const cases = [
      [{ email: 'a@example.com', turnstileToken: 't' }, 'slug is required'],
      [{ slug: SLUG, turnstileToken: 't' }, 'email is required'],
      [{ slug: SLUG, email: 'a@example.com' }, 'turnstileToken is required'],
      [{ slug: SLUG, email: 'not-an-email', turnstileToken: 't' }, 'email must be a valid email address'],
    ];
    for (const [payload, message] of cases) {
      const { status, body } = await submit(env, payload);
      assert.equal(status, 400, JSON.stringify(payload));
      assert.equal(body.error, message);
    }
    assert.equal(registrations(db).length, 0);
  });

  it('404 for a slug that does not exist', async () => {
    const { status, body } = await submit(env, { ...VALID, slug: 'no-such-call' });
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(net.calls.length, 0, 'no Turnstile or mailbox-verification credits on an unknown slug');
  });

  it('404 for a members-only event, indistinguishable from one that does not exist', async () => {
    const paid = await seededDb((s) => insertEvent(s, { id: 'post_paid', slug: 'members-only-call', is_free: 0 }));
    const { status, body } = await submit(makeEnv(paid), { ...VALID, slug: 'members-only-call' });
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found', 'a members-only event must not be enumerable as "exists but not free"');
    assert.equal(registrations(paid).length, 0);
    paid.close();
  });

  it('404 for a free event outside the stuc channel', async () => {
    const other = await seededDb((s) => insertEvent(s, { id: 'post_other', slug: 'members-channel-call', channel: 'members' }));
    const { status } = await submit(makeEnv(other), { ...VALID, slug: 'members-channel-call' });
    assert.equal(status, 404);
    other.close();
  });

  it('400 event_ended once the call is more than an hour past', async () => {
    const past = await seededDb((s) => insertEvent(s, { id: 'post_past', slug: 'yesterday-call', event_date: inHours(-3) }));
    const { status, body } = await submit(makeEnv(past), { ...VALID, slug: 'yesterday-call' });
    assert.equal(status, 400);
    assert.equal(body.error, 'event_ended');
    assert.equal(registrations(past).length, 0);
    past.close();
  });

  it('a call that started 30 minutes ago is still joinable', async () => {
    const running = await seededDb((s) => insertEvent(s, { id: 'post_now', slug: 'in-progress-call', event_date: inHours(-0.5) }));
    const { status } = await submit(makeEnv(running), { ...VALID, slug: 'in-progress-call' });
    assert.equal(status, 200, 'the grace window is an hour, so a late arrival still gets the link');
    assert.equal(registrations(running).length, 1);
    running.close();
  });

  it('403 when Turnstile rejects the token', async () => {
    net.restore();
    net = stubExternalFetch({ turnstile: () => ({ ok: true, json: async () => ({ success: false }) }) });
    const { status, body } = await submit(env, VALID);
    assert.equal(status, 403);
    assert.equal(body.error, 'spam_check_failed');
    assert.equal(registrations(db).length, 0);
  });

  it('400 when the mailbox is rejected by verification, and nothing is sent', async () => {
    net.restore();
    net = stubExternalFetch({ elv: () => ({ ok: true, text: async () => 'disposable' }) });
    const { status, body } = await submit(env, VALID);
    assert.equal(status, 400);
    assert.equal(body.error, 'email_rejected');
    assert.equal(registrations(db).length, 0);
    assert.equal(net.ses.length, 0, 'a rejected mailbox must never be mailed the link');
  });

  it('the honeypot answers 200, stores nothing, and sends nothing', async () => {
    const events = [];
    const hpEnv = makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } });
    const { status, body } = await submit(hpEnv, { ...VALID, website: 'https://spam.example' });

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true }, 'a bot must not be able to tell it was caught');
    assert.equal(registrations(db).length, 0);
    assert.equal(net.calls.length, 0, 'the honeypot short-circuits before every external call');
    assert.ok(events.some((e) => e.blobs.includes('register_honeypot')));
  });

  it('a missing KV binding fails CLOSED at the first limit', async () => {
    const { status, body } = await submit(makeEnv(db, { COMMUNITY_KV: undefined }), VALID);
    assert.equal(status, 429);
    assert.equal(body.error, 'rate_limited');
    assert.equal(registrations(db).length, 0);
  });

  it('the 3rd signup for one address is served and the 4th is refused', async () => {
    const email = 'repeat@example.com';
    for (let i = 1; i <= 3; i++) {
      const { status } = await submit(env, { ...VALID, email }, { ip: `198.51.100.${10 + i}` });
      assert.equal(status, 200, `signup ${i} must be served`);
    }
    const fourth = await submit(env, { ...VALID, email }, { ip: '198.51.100.99' });
    assert.equal(fourth.status, 429);
    assert.equal(registrations(db).length, 1, 'three accepted resends are still one registration');
  });
});

describe('POST /api/events/register -- what gets stored', () => {
  let db; let net; let env;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch();
    env = makeEnv(db);
  });
  afterEach(() => { net.restore(); db.close(); });

  it('stores the registration, a newsletter subscriber and a contact tag', async () => {
    const { status, body } = await submit(env, VALID);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    const [row] = registrations(db);
    assert.equal(row.post_id, POST_ID);
    assert.equal(row.email, 'signup@example.com');
    assert.equal(row.user_id, null, 'an anonymous registration carries no user id');
    assert.ok(row.link_sent_at, 'link_sent_at is stamped once the message is away');
    assert.equal(row.reminder_sent_at, null);

    const [sub] = subscribers(db);
    assert.equal(sub.status, 'active');
    assert.equal(sub.source, `event-${SLUG}`);
    assert.deepEqual(JSON.parse(sub.segments), [`event:${SLUG}`]);

    const tag = db._sqlite.prepare("SELECT * FROM contact_tag WHERE source = 'event'").get();
    assert.equal(tag.tag, `event:${SLUG}`);
  });

  it('reports a new registration to GA4 as a free_event lead', async () => {
    const events = [];
    await submit(makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } }), VALID);

    assert.equal(net.ga4.length, 1);
    const event = net.ga4[0].body.events[0];
    assert.equal(event.name, 'generate_lead');
    assert.equal(event.params.lead_source, 'free_event');
    assert.deepEqual(event.params.items, [{ item_name: `Event: ${SLUG}` }]);
    assert.ok(events.some((e) => e.blobs.includes('register_signup')));
  });

  it('an existing subscriber gains the segment without losing the ones they had', async () => {
    db._sqlite.prepare(
      "INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('n1', 'signup@example.com', 'unsubscribed', 'import', ?)"
    ).run(JSON.stringify(['general']));

    await submit(env, VALID);

    const [sub] = subscribers(db);
    assert.deepEqual(JSON.parse(sub.segments), ['general', `event:${SLUG}`]);
    assert.equal(sub.status, 'unsubscribed', 'registering for a call must not resurrect a newsletter unsubscribe');
  });

  it('a differently-cased address is the same person, and gets the link again', async () => {
    await submit(env, { ...VALID, email: 'Signup@Example.com' });
    await submit(env, { ...VALID, email: 'signup@example.com' });

    const rows = registrations(db);
    assert.equal(rows.length, 1, 'case must not create a second registration');
    assert.equal(net.ses.length, 2, 'a duplicate RESENDS -- someone who lost the email needs it back');
  });

  it('a repeat registration writes no second row and still returns ok', async () => {
    await submit(env, VALID);
    const first = registrations(db)[0].link_sent_at;
    const { status, body } = await submit(env, VALID);

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(registrations(db).length, 1);
    assert.ok(registrations(db)[0].link_sent_at >= first, 'link_sent_at tracks the LAST successful send');
  });
});

describe('POST /api/events/register -- the sent message is the ONLY place the link travels', () => {
  let db; let net; let env;

  beforeEach(async () => {
    db = await seededDb();
    net = stubExternalFetch();
    env = makeEnv(db);
  });
  afterEach(() => { net.restore(); db.close(); });

  it('sends from the club identity, replying to the administrator mailbox', async () => {
    await submit(env, VALID);
    const [mail] = sentMail(net);

    assert.equal(mail.from, '"Dr. Naomi Whittaker" <community@rrmacademy.org>');
    assert.deepEqual(mail.to, ['signup@example.com']);
    assert.deepEqual(mail.replyTo, ['administrator@rrmacademy.org']);
    assert.equal(mail.subject, 'Your link for Endometriosis, Start to Finish');
  });

  it('carries the joining link, the speaker, the dial-in and the PIN', async () => {
    await submit(env, VALID);
    const [mail] = sentMail(net);

    assert.match(mail.html, new RegExp(`<a href="${MEET_URL}">`), 'the link must be a real anchor');
    assert.match(mail.html, /<p>When: \w+day, /, 'the when-line is a paragraph, formatted Eastern');
    assert.match(mail.html, /Eastern<\/p>/);
    assert.match(mail.html, /<p>With Dr\. Naomi Whittaker<\/p>/);
    assert.ok(mail.html.includes(DIAL), 'a dial-in the author typed belongs in the email');
    assert.ok(mail.html.includes(PIN));
    assert.match(mail.html, /Add it to your calendar/);
    assert.match(mail.html, new RegExp(`href="https://rrmacademy.org/events/${SLUG}/"`));
    assert.match(mail.html, /P\.S\..*recording, transcript and notes from every call/);
    assert.match(mail.html, /href="https:\/\/rrmacademy\.org\/save-the-uterus-club"/);
    assert.ok(!mail.html.includes('<br>'), 'paragraphs, never <br>');
    assert.ok(mail.text.includes(MEET_URL), 'the plain-text part carries the link too');
  });

  it('says "Save the Uterus Club" in full, never the abbreviation', async () => {
    await submit(env, VALID);
    const [mail] = sentMail(net);
    assert.match(mail.html, /Save the Uterus Club/);
    assert.ok(!/\bSTUC\b/.test(mail.html), 'copy never abbreviates the club name');
    assert.ok(!/\bSTUC\b/.test(mail.text));
  });

  it('omits the with-line and the dial lines when the event has neither', async () => {
    const bare = await seededDb((s) => insertEvent(s, {
      id: 'post_bare', slug: 'bare-call', speaker: null,
      content: 'Bare Call\n\nJust the talk.',
    }));
    const bareNet = stubExternalFetch();
    await submit(makeEnv(bare), { ...VALID, slug: 'bare-call' });
    const [mail] = sentMail(bareNet);

    assert.ok(!mail.html.includes('<p>With '), 'no speaker, no with-line');
    assert.ok(!/Phone:|PIN:/.test(mail.html));
    assert.ok(mail.html.includes(MEET_URL), 'the link is still there');
    bareNet.restore();
    bare.close();
  });

  it('greets a signed-in registrant by first name', async () => {
    const withSession = await seededDb((s) => {
      s.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)')
        .run('legacy-plaintext-session', MEMBER, Math.floor(Date.now() / 1000) + 86400);
    });
    const sessionNet = stubExternalFetch();
    await submit(
      makeEnv(withSession),
      { ...VALID, email: 'member@example.com' },
      { session: 'legacy-plaintext-session' },
    );

    const [mail] = sentMail(sessionNet);
    assert.match(mail.html, /<p>Hi Mia,<\/p>/);
    assert.equal(registrations(withSession)[0].user_id, MEMBER, 'a matching session links the account');
    sessionNet.restore();
    withSession.close();
  });

  it('IDOR: a session is never bound to a foreign address', async () => {
    const withSession = await seededDb((s) => {
      s.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)')
        .run('legacy-plaintext-session', MEMBER, Math.floor(Date.now() / 1000) + 86400);
    });
    const idorNet = stubExternalFetch();
    await submit(makeEnv(withSession), { ...VALID, email: 'victim@example.com' }, { session: 'legacy-plaintext-session' });

    const [row] = registrations(withSession);
    assert.equal(row.email, 'victim@example.com');
    assert.equal(row.user_id, null);
    idorNet.restore();
    withSession.close();
  });

  it('the RESPONSE BODY, the email_log and the analytics blobs carry no link', async () => {
    const events = [];
    const { body } = await submit(makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } }), VALID);

    const serialized = JSON.stringify(body);
    assert.deepEqual(body, { ok: true }, 'the response says nothing but ok');
    assert.ok(!serialized.includes('meet.google.com'));

    for (const row of emailLog(db)) {
      const line = JSON.stringify(row);
      assert.ok(!line.includes('meet.google.com'), 'the email log records source and subject, never the body');
      assert.ok(!line.includes('445566'));
    }
    for (const point of events) {
      const line = JSON.stringify(point);
      assert.ok(!line.includes('meet.google.com'), 'an analytics blob must never carry the credential');
    }
    // The link IS logged as having been sent -- the record, not the credential.
    assert.ok(emailLog(db).some((r) => r.source === 'events/register' && r.event === 'send'));
  });

  it('a failing send is reported honestly and leaves link_sent_at unset', async () => {
    net.restore();
    net = stubExternalFetch({ ses: () => ({ ok: false, status: 500, text: async () => 'SES down' }) });
    const events = [];
    const { status, body } = await submit(makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } }), VALID);

    assert.equal(status, 500);
    assert.equal(body.error, 'send_failed');
    assert.equal(registrations(db).length, 1, 'the registration is real; only the message failed');
    assert.equal(registrations(db)[0].link_sent_at, null, 'never claim an inbox has a link in it');
    assert.ok(events.some((e) => e.blobs.includes('register_send_failed')));
  });
});

describe('POST /api/events/register -- database failures', () => {
  let net;
  beforeEach(() => { net = stubExternalFetch(); });
  afterEach(() => net.restore());

  it('a failing event lookup is a logged 500, not an unhandled rejection', async () => {
    const events = [];
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes("AND is_free = 1")) throw new Error('D1_ERROR: lookup failed');
      },
    });
    const { status, body } = await submit(makeEnv(db, { EVENTS: { writeDataPoint: (p) => events.push(p) } }), VALID);
    assert.equal(status, 500);
    assert.equal(body.error, 'server_error');
    assert.ok(events.some((e) => e.blobs.includes('register_lookup_error')));
    db.close();
  });

  it('the write batch is atomic: a later statement failing rolls the registration back', async () => {
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes('INSERT INTO newsletter_subscriber')) throw new Error('D1_ERROR: second statement failed');
      },
    });
    const { status } = await submit(makeEnv(db), VALID);
    assert.equal(status, 500);
    assert.equal(registrations(db).length, 0, 'no half-written registration may survive');
    assert.equal(net.ses.length, 0, 'and nothing may be sent for a registration that does not exist');
    db.close();
  });

  it('a failing newsletter lookup falls through to the insert path', async () => {
    const db = await seededDb(undefined, {
      interleave({ sql }) {
        if (sql.includes('SELECT id, status, segments FROM newsletter_subscriber')) {
          throw new Error('D1_ERROR: newsletter read failed');
        }
      },
    });
    const { status } = await submit(makeEnv(db), VALID);
    assert.equal(status, 200);
    assert.equal(subscribers(db).length, 1);
    db.close();
  });
});
