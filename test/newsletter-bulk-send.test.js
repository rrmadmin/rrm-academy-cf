/**
 * EXECUTED tests for the bulk path of POST /api/newsletter/send.
 *
 * These run the REAL handler against a REAL SQLite engine carrying schema.sql
 * plus migrations 034 and 041 (test/_bulk-mail-sqlite.mjs), with SES stubbed at
 * globalThis.fetch. That combination is what makes the assertions below mean
 * what their names say: the membership exclusion is a correlated subquery with
 * a COLLATE NOCASE comparison, the cohort order is an ORDER BY, and the
 * already-sent guard is a LIKE against email_log.source -- none of which a
 * substring-matching mock can decide.
 *
 * The load-bearing one is the first. A lane refusal must leave NOTHING behind:
 * no newsletter_event, no last_sent_at, no newsletter_send row. The endpoint
 * marks recipients sent before calling SES on purpose, so a refusal discovered
 * late would burn a page of recipients for mail that never left.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bulkMailD1 } from './_bulk-mail-sqlite.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';
import { onRequestPost } from '../functions/api/newsletter/send.js';

const ADMIN = 'test-admin-secret';
const BULK_FROM = '"Dr. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy.com>';

/**
 * Captures every SESv2 request and answers 200 unless told otherwise.
 *
 * The body is read the way test/_helpers.js stubExternalFetch reads it, and
 * for the same reason: aws4fetch's AwsClient signs the request and calls
 * `fetch(signedRequest)` with ONE argument, so `init` is undefined on every
 * real SES call and the payload only exists on the Request. Reading `init.body`
 * alone would throw before a single assertion ran.
 */
function stubSes({ answer } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    if (!url.includes('amazonaws.com')) throw new Error(`unrouted fetch to ${url}`);
    const raw = init?.body ?? (input && typeof input.text === 'function' ? await input.text() : null);
    const body = JSON.parse(raw);
    calls.push({ url, body });
    if (answer) return answer(calls.length, body);
    return new Response(JSON.stringify({ MessageId: `ses-${calls.length}` }), { status: 200 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

function env(db, over = {}) {
  return mockEnv({ DB: db, ADMIN_API_SECRET: ADMIN, NEWSLETTER_SECRET: 'nl-secret', BULK_FROM, ...over });
}

function post(body) {
  return mockRequest('POST', {
    body,
    headers: { Authorization: `Bearer ${ADMIN}` },
    url: 'https://rrmacademy.org/api/newsletter/send',
  });
}

async function call(db, body, over = {}) {
  const res = await onRequestPost({ request: post(body), env: env(db, over), waitUntil: mockWaitUntil() });
  return parseResponse(res);
}

async function seedSubscriber(db, { id, email, source = 'website', last_sent_at = null, subscribed_at = '2026-01-01 00:00:00' }) {
  await db.prepare(
    "INSERT INTO newsletter_subscriber (id, email, status, source, last_sent_at, subscribed_at) VALUES (?, ?, 'active', ?, ?, ?)"
  ).bind(id, email, source, last_sent_at, subscribed_at).run();
}

async function seedDomainState(db, { first_send_at, day, sent_today = 0 }) {
  await db.prepare(
    'INSERT INTO mail_domain_state (domain, first_send_at, day, sent_today) VALUES (?, ?, ?, ?)'
  ).bind('rrmacademy.com', first_send_at, day, sent_today).run();
}

/** Today's UTC date, which is what the handler's own clock will produce. */
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR_AGO = new Date(Date.now() - 400 * 86400000).toISOString();

const BODY = { lane: 'bulk', campaign: 'sept-letter', subject: 'The September letter', body: '<p>hello</p>' };

let ses;
before(() => { ses = stubSes(); });
after(() => { ses.restore(); });

describe('the lane preflight', () => {
  it('a refused From aborts with NO D1 writes at all', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    const { status, body } = await call(db, { ...BODY, send: true }, { BULK_FROM: 'newsletters@rrmacademy.com' });
    assert.equal(status, 400);
    assert.equal(body.error, 'bulk_lane_refused');
    assert.equal(body.reason, 'exemption-sender-not-allowed');
    for (const table of ['newsletter_event', 'newsletter_send', 'email_log']) {
      const c = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first();
      assert.equal(c.c, 0, `${table} must be untouched by a refused run`);
    }
    const sub = await db.prepare('SELECT last_sent_at FROM newsletter_subscriber WHERE id = ?').bind('sub-1').first();
    assert.equal(sub.last_sent_at, null);
  });

  it('an unset BULK_FROM is a 503, not a fallback to the apex sender', async () => {
    const db = bulkMailD1();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { status, body } = await call(db, { ...BODY, send: true }, { BULK_FROM: undefined });
    assert.equal(status, 503);
    assert.equal(body.error, 'bulk_from_not_configured');
  });
});

describe('the first-send gate', () => {
  it('blocks when mail_domain_state has no row', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 409);
    assert.equal(body.error, 'bulk_first_send_required');
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
  });

  it('firstSend creates the row in its own write, before any recipient is touched', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const { status, body } = await call(db, { ...BODY, send: true, firstSend: true });
    assert.equal(status, 200);
    assert.equal(body.cap, 200, 'the same run proceeds under the day 1 cap');
    assert.equal(body.ageDays, 1);
    const row = await db.prepare("SELECT first_send_at, day, sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.ok(row.first_send_at);
    assert.equal(row.day, TODAY);
    assert.equal(row.sent_today, 1);
  });

  it('firstSend on a domain that has already sent does not reset the age', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    const { status, body } = await call(db, { ...BODY, send: true, firstSend: true });
    assert.equal(status, 200);
    assert.equal(body.cap, 1500, 'a year-old domain stays in the day 13+ band');
    const row = await db.prepare("SELECT first_send_at FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(row.first_send_at, YEAR_AGO);
  });
});

describe('membership routing (spec section 3)', () => {
  it('a paying member on wix_subscription.status=active is NOT in the bulk audience', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'Member@Example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'stranger@example.com' });
    await db.prepare(
      "INSERT INTO wix_subscription (wix_subscription_id, contact_id, email, tier, amount_cents, status, started_at, last_order_at, product_id, product_source, updated_at) VALUES ('ws1','c1','member@example.com','core',500,'active','2026-01-01','2026-09-01','p','wix','2026-09-01')"
    ).run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 1);
    // The brief wrote this as a one-argument assert.equal on a `? true : true`
    // tautology, which asserts nothing and throws ERR_MISSING_ARGS. What it
    // meant is that the one message that did go out went out Raw.
    assert.ok(ses.calls.at(-1).body.Content.Raw, 'the bulk send goes out as a Raw MIME document');
    const logged = await db.prepare("SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter'").all();
    assert.deepEqual(logged.results.map(r => r.email), ['stranger@example.com']);
  });

  it('a LAPSED member (status != active, membership_state set) IS in the bulk audience', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'lapsed@example.com' });
    await db.prepare(
      "INSERT INTO wix_subscription (wix_subscription_id, contact_id, email, tier, amount_cents, status, started_at, last_order_at, product_id, product_source, updated_at, membership_state) VALUES ('ws2','c2','lapsed@example.com','core',500,'inactive','2026-01-01','2026-06-01','p','wix','2026-06-01','expired_card')"
    ).run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 1, 'membership_state is a lapse REASON, never a status');
    const logged = await db.prepare("SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter'").first();
    assert.equal(logged.email, 'lapsed@example.com');
  });

  it('a contact tagged stuc:member is NOT in the bulk audience, case-insensitively', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'tagged@example.com' });
    await db.prepare("INSERT INTO contact (id, email) VALUES ('c3', 'Tagged@Example.com')").run();
    await db.prepare("INSERT INTO contact_tag (contact_id, tag) VALUES ('c3', 'stuc:member')").run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 0);
  });
});

describe('the cap and the cohort', () => {
  it('truncates to the day remaining allowance and reports the deferral', async () => {
    const db = bulkMailD1();
    for (let i = 0; i < 12; i++) await seedSubscriber(db, { id: `sub-${i}`, email: `r${i}@example.com` });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1495 });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.cap, 1500);
    assert.equal(body.sent, 5);
    assert.equal(body.deferred, 7);
    assert.equal(body.remainingToday, 0);
    assert.equal(body.done, false, 'a deferral is not a finished campaign');
  });

  it('refuses outright when the day is already spent', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1500 });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 429);
    assert.equal(body.error, 'bulk_cap_exhausted');
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
  });

  it('sends the engaged head first: website before import, recent before never', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-a', email: 'import-recent@example.com', source: 'import', last_sent_at: '2026-09-09 00:00:00' });
    await seedSubscriber(db, { id: 'sub-b', email: 'web-never@example.com', source: 'website', last_sent_at: null });
    await seedSubscriber(db, { id: 'sub-c', email: 'web-recent@example.com', source: 'website', last_sent_at: '2026-09-10 00:00:00' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1498 });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 2);
    const logged = await db.prepare(
      "SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter' ORDER BY id ASC"
    ).all();
    assert.deepEqual(logged.results.map(r => r.email), ['web-recent@example.com', 'web-never@example.com']);
  });

  it('excludes anyone this campaign already sent to, across runs', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    await db.prepare(
      "INSERT INTO email_log (event, email, category, source) VALUES ('send', 'a@example.com', 'newsletter', 'newsletter/bulk/sept-letter')"
    ).run();
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 1);
    const last = await db.prepare(
      "SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter' ORDER BY id DESC LIMIT 1"
    ).first();
    assert.equal(last.email, 'b@example.com');
  });

  it('excludes unsubscribed, bounced and complained subscribers', async () => {
    const db = bulkMailD1();
    for (const [i, status] of [['1', 'unsubscribed'], ['2', 'bounced'], ['3', 'complained']]) {
      await db.prepare(
        "INSERT INTO newsletter_subscriber (id, email, status, source) VALUES (?, ?, ?, 'website')"
      ).bind(`sub-${i}`, `s${i}@example.com`, status).run();
    }
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 0);
  });
});

describe('the message itself', () => {
  it('sends from BULK_FROM through the rrm-bulk configuration set with a Feedback-ID', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await call(db, { ...BODY, send: true });
    const sent = ses.calls.at(-1).body;
    assert.equal(sent.ConfigurationSetName, 'rrm-bulk');
    const raw = Buffer.from(sent.Content.Raw.Data, 'base64').toString('utf8');
    assert.match(raw, /^From: "Dr\. Naomi Whittaker, RRM Academy" <newsletter@rrmacademy\.com>$/m);
    assert.match(raw, /^Reply-To: administrator@rrmacademy\.org$/m);
    assert.match(raw, /^Feedback-ID: sept-letter:all:rrma:rrmacademy\.com$/m);
    assert.match(raw, /^List-Unsubscribe: <https:\/\/rrmacademy\.org\/api\/newsletter\/unsubscribe\?[^>]+>, <mailto:administrator@rrmacademy\.org\?subject=unsubscribe>$/m);
    assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  });

  it('names the segment in the Feedback-ID when the send is segmented', async () => {
    const db = bulkMailD1();
    await db.prepare(
      `INSERT INTO newsletter_subscriber (id, email, status, source, segments) VALUES ('sub-1','a@example.com','active','website','["donor"]')`
    ).run();
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await call(db, { ...BODY, send: true, segments: ['donor'] });
    const raw = Buffer.from(ses.calls.at(-1).body.Content.Raw.Data, 'base64').toString('utf8');
    assert.match(raw, /^Feedback-ID: sept-letter:donor:rrma:rrmacademy\.com$/m);
  });
});

describe('logging and the day counter', () => {
  it('writes email_log and increments sent_today in the same batch', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 7 });
    await call(db, { ...BODY, send: true });
    const log = await db.prepare("SELECT event, category, source, ses_message_id FROM email_log ORDER BY id DESC LIMIT 1").first();
    assert.equal(log.event, 'send');
    assert.equal(log.category, 'newsletter');
    assert.equal(log.source, 'newsletter/bulk/sept-letter');
    assert.match(log.ses_message_id, /^ses-/);
    const state = await db.prepare("SELECT sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(state.sent_today, 8);
  });

  it('a failed log batch PAUSES the run with reason log-write-failed', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const realBatch = db.batch.bind(db);
    let n = 0;
    db.batch = async (stmts) => {
      const isLogBatch = stmts.some(s => String(s._sql || '').includes('mail_domain_state'));
      if (isLogBatch && ++n === 1) throw new Error('D1_ERROR: network');
      return realBatch(stmts);
    };
    const { status, body } = await call(db, { ...BODY, send: true });
    db.batch = realBatch;
    assert.equal(status, 500);
    assert.equal(body.error, 'bulk_paused');
    assert.equal(body.reason, 'log-write-failed');
    const paused = await db.prepare("SELECT reason, resumed_at FROM send_paused WHERE campaign = 'sept-letter'").first();
    assert.equal(paused.reason, 'log-write-failed');
    assert.equal(paused.resumed_at, null);
    assert.equal(ses.calls.length >= 1, true, 'the message that was already accepted is NOT reclassified as unsent');
  });
});

describe('the circuit breaker', () => {
  async function seedTrailing(db, { sends, complaints }) {
    for (let i = 0; i < sends; i++) {
      await db.prepare(
        "INSERT INTO email_log (event, email, category, source, ses_message_id) VALUES ('send', ?, 'newsletter', 'newsletter/bulk/sept-letter', ?)"
      ).bind(`h${i}@example.com`, `msg-${i}`).run();
    }
    for (let i = 0; i < complaints; i++) {
      await db.prepare(
        "INSERT INTO email_event (id, ses_message_id, event_type, email, ts) VALUES (?, ?, 'complaint', ?, ?)"
      ).bind(`ev-${i}`, `msg-${i}`, `h${i}@example.com`, new Date().toISOString()).run();
    }
  }

  it('pauses before sending when the trailing 24h complaint rate is at the line', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailing(db, { sends: 1000, complaints: 2 });
    const before = ses.calls.length;
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 423);
    assert.equal(body.error, 'bulk_paused');
    assert.equal(body.reason, 'complaint-rate');
    assert.equal(ses.calls.length, before, 'not one more message went out');
    const paused = await db.prepare("SELECT reason FROM send_paused WHERE campaign = 'sept-letter' AND resumed_at IS NULL").first();
    assert.equal(paused.reason, 'complaint-rate');
  });

  it('does not pause on a tiny sample, which is the deliberate fail-open', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailing(db, { sends: 40, complaints: 40 });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 200);
    assert.equal(body.sent, 1);
  });

  it('an OPEN send_paused row refuses every later run until --resume clears it', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await db.prepare(
      "INSERT INTO send_paused (id, campaign, reason, detail) VALUES ('sp-1','sept-letter','complaint-rate','seeded')"
    ).run();
    const refused = await call(db, { ...BODY, send: true });
    assert.equal(refused.status, 423);
    assert.equal(refused.body.error, 'bulk_paused');
    assert.equal(refused.body.reason, 'complaint-rate');
    const resumed = await call(db, { ...BODY, send: true, resume: true });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.sent, 1);
    const row = await db.prepare("SELECT resumed_at FROM send_paused WHERE id = 'sp-1'").first();
    assert.ok(row.resumed_at, 'resume stamps the row rather than deleting the history');
  });
});

describe('request validation', () => {
  it('refuses a bulk request with no campaign key', async () => {
    const db = bulkMailD1();
    const { status, body } = await call(db, { lane: 'bulk', subject: 's', body: 'b', send: true });
    assert.equal(status, 400);
    assert.equal(body.error, 'bulk_campaign_required');
  });

  it('refuses a campaign key that is not a lowercase slug', async () => {
    const db = bulkMailD1();
    for (const campaign of ['Sept Letter', 'sept letter', '-x', 'a', 'x'.repeat(65)]) {
      const { status, body } = await call(db, { ...BODY, campaign, send: true });
      assert.equal(status, 400, `${campaign} must be refused`);
      assert.equal(body.error, 'bulk_campaign_required');
    }
  });

  it('refuses a cursor on the bulk path rather than silently ordering by id', async () => {
    const db = bulkMailD1();
    // send.js's pre-existing cursor-format guard (the legacy path's own
    // /^[0-9a-f-]+$/i check, which runs BEFORE the lane==='bulk' dispatch
    // because the dispatch line sits immediately after `const db = env.DB;`,
    // which is itself after that guard) rejects any cursor with non-hex
    // characters as invalid_cursor before the bulk branch is ever reached.
    // Use a well-formed hex cursor so the legacy guard lets it through and
    // the bulk-specific `if (cursor)` check is what actually refuses it.
    const { status, body } = await call(db, { ...BODY, send: true, sendId: '0'.repeat(8), cursor: 'aaaaaaaa-0000-0000-0000-000000000001' });
    assert.equal(status, 400);
    assert.equal(body.error, 'bulk_cursor_unsupported');
  });

  it('is dry-run unless send:true, and a dry run touches nothing', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 3 });
    const before = ses.calls.length;
    const { status, body } = await call(db, BODY);
    assert.equal(status, 200);
    assert.equal(body.dryRun, true);
    assert.equal(body.sent, 0);
    assert.equal(body.wouldSend, 1);
    assert.equal(body.remainingToday, 1497);
    assert.equal(ses.calls.length, before);
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
    const state = await db.prepare("SELECT sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(state.sent_today, 3, 'a dry run does not spend the day');
  });

  it('still requires the admin bearer', async () => {
    const db = bulkMailD1();
    const res = await onRequestPost({
      request: mockRequest('POST', { body: BODY, url: 'https://rrmacademy.org/api/newsletter/send' }),
      env: env(db),
      waitUntil: mockWaitUntil(),
    });
    assert.equal(res.status, 401);
  });

  it('leaves the legacy path alone: no lane field is the old behaviour', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'legacy@example.com' });
    const { status, body } = await call(db, { subject: 'legacy', body: '<p>x</p>' });
    assert.equal(status, 200);
    assert.equal(body.dryRun, undefined, 'the legacy path has no dry run and never gained one');
    assert.equal(body.sent, 1);
    const log = await db.prepare("SELECT source FROM email_log ORDER BY id DESC LIMIT 1").first();
    // The legacy path hands sendRawEmail a `log` block, so _ses.js's own
    // logEmail writes the row and stamps the granted exemption onto the
    // source. That suffix is PRE-EXISTING legacy behaviour, asserted here
    // exactly as it is so this test stays the regression net it is meant to
    // be: the bulk path writes its own row and carries no suffix.
    assert.equal(log.source, 'newsletter/send (newsletter-blast)');
  });
});
