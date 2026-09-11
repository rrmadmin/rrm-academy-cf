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

  it('a membership that starts AFTER the cohort is built is caught by the per-recipient recheck', async () => {
    const db = bulkMailD1();
    // Cohort order (subscribed_at tied) falls back to s.id ASC, so sub-1
    // sends first and sub-2 second -- the send loop for sub-1 is where the
    // membership is made active, exactly like a real concurrent signup.
    await seedSubscriber(db, { id: 'sub-1', email: 'first@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'second@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });

    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls += 1;
      if (calls === 1) {
        await db.prepare(
          `INSERT INTO wix_subscription (wix_subscription_id, contact_id, email, tier, amount_cents, status, started_at, last_order_at, product_id, product_source, updated_at)
           VALUES ('ws-race','c-race','second@example.com','core',500,'active','2026-09-11','2026-09-11','p','wix','2026-09-11')`
        ).run();
      }
      const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
      const raw = init?.body ?? (input && typeof input.text === 'function' ? await input.text() : null);
      JSON.parse(raw);
      return new Response(JSON.stringify({ MessageId: `race-${calls}` }), { status: 200 });
    };
    let body;
    try {
      ({ body } = await call(db, { ...BODY, send: true }));
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(body.sent, 1, 'only the first recipient, the one still eligible when SES was actually called, is sent');
    const logged = await db.prepare("SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter'").all();
    assert.deepEqual(logged.results.map((r) => r.email), ['first@example.com']);
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

  it('sends at most BULK_PAGE_SIZE per invocation and leaves the rest to the caller loop', async () => {
    // 52 eligible recipients under a 1500 cap. The day's allowance is not the
    // binding constraint here, the per-invocation page is: one call cannot pace
    // 1500 messages inside a Function's budget, so it sends 50 and answers
    // done:false with the other 2 deferred for the next call.
    const db = bulkMailD1();
    for (let i = 0; i < 52; i++) {
      await seedSubscriber(db, { id: `sub-${String(i).padStart(3, '0')}`, email: `p${i}@example.com` });
    }
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    // Collapse the inter-send pacing for this one test. 49 real 1.5 s waits is
    // 74 s of wall clock on every `npm test`, and the pacing is not what this
    // test is about; the other cases in this file leave it alone, so the real
    // BULK_PACING_MS still runs.
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
    let body;
    try {
      ({ body } = await call(db, { ...BODY, send: true }));
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    assert.equal(body.sent, 50);
    assert.equal(body.deferred, 2);
    assert.equal(body.done, false, 'the caller loops while deferred > 0');
    assert.equal(body.remainingToday, 1450, 'the day still has room; the PAGE was the limit');
  });

  it('the day allowance still wins when it is smaller than the page', async () => {
    const db = bulkMailD1();
    for (let i = 0; i < 20; i++) await seedSubscriber(db, { id: `sub-${i}`, email: `q${i}@example.com` });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 1497 });
    const { body } = await call(db, { ...BODY, send: true });
    assert.equal(body.sent, 3);
    assert.equal(body.remainingToday, 0);
    assert.equal(body.deferred, 17);
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

  // A stub that fails db.prepare().run() ONLY for statements matching `match`,
  // by SQL substring, on the Nth call (1-based) that matches. Used to isolate
  // the email_log write from the day-counter write, which are now two
  // separate statements rather than one batch (I8).
  function failNthMatchingRun(db, match, n = 1) {
    const realPrepare = db.prepare.bind(db);
    let seen = 0;
    db.prepare = (sql) => {
      const stmt = realPrepare(sql);
      if (!sql.includes(match)) return stmt;
      return {
        ...stmt,
        bind(...args) {
          const bound = realPrepare(sql).bind(...args);
          return {
            ...bound,
            async run() {
              seen += 1;
              if (seen === n) throw new Error('D1_ERROR: network');
              return bound.run();
            },
          };
        },
      };
    };
    return () => { db.prepare = realPrepare; };
  }

  it('a failed email_log write PAUSES the run and names the recipient, with no retry', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const restore = failNthMatchingRun(db, 'INSERT INTO email_log');
    const before = ses.calls.length;
    const { status, body } = await call(db, { ...BODY, send: true });
    restore();
    assert.equal(status, 500);
    assert.equal(body.error, 'bulk_paused');
    assert.equal(body.reason, 'log-write-failed');
    assert.equal(
      body.detail, 'email_log write failed; read send_paused.detail',
      'the driver error string stays in D1; the response says where to read it',
    );
    const paused = await db.prepare("SELECT reason, detail, resumed_at FROM send_paused WHERE campaign = 'sept-letter'").first();
    assert.equal(paused.reason, 'log-write-failed');
    assert.equal(paused.resumed_at, null);
    assert.match(paused.detail, /D1_ERROR: network/, 'the raw driver message IS recorded, D1 side');
    assert.match(
      paused.detail, /DELIVERED BUT UNLOGGED: a@example\.com/,
      'the human needs to know who may be mailed twice on resume -- named immediately, no retry to complicate it',
    );
    const logged = await db.prepare("SELECT COUNT(*) AS c FROM email_log WHERE source = 'newsletter/bulk/sept-letter'").first();
    assert.equal(logged.c, 0, 'no email_log row exists, which is exactly why the recipient is named');
    // The day counter is never reached -- the email_log write is first, and it
    // failed, so this message was already delivered but the counter never ran.
    const state = await db.prepare("SELECT sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(state.sent_today, 0);
    assert.equal(
      ses.calls.length - before, 1,
      'the message that was already accepted is NOT reclassified as unsent',
    );
  });

  it('a failed day-counter write does NOT pause the run: the email_log row already exists', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 5 });
    const restore = failNthMatchingRun(db, 'UPDATE mail_domain_state');
    const { status, body } = await call(db, { ...BODY, send: true });
    restore();
    assert.equal(status, 200, 'a lost count of one is not a reason to stop an already-delivered send');
    assert.equal(body.ok, true);
    assert.equal(body.sent, 1);
    const logged = await db.prepare(
      "SELECT email, ses_message_id FROM email_log WHERE source = 'newsletter/bulk/sept-letter'"
    ).all();
    assert.deepEqual(logged.results.map(r => r.email), ['a@example.com'],
      'the email_log row -- the already-sent guard -- is written before the counter and survives its failure');
    const paused = await db.prepare("SELECT COUNT(*) AS c FROM send_paused").first();
    assert.equal(paused.c, 0, 'a counter failure is a warn, never a pause');
    // The counter write itself failed, so sent_today is exactly what it was
    // seeded at: the count really is lost by one, as documented.
    const state = await db.prepare("SELECT sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.equal(state.sent_today, 5);
  });

  it('the day counter follows the clock at EACH send, not the page-start clock (I8: crossing midnight mid-page)', async () => {
    const db = bulkMailD1();
    for (let i = 0; i < 5; i++) await seedSubscriber(db, { id: `sub-${i}`, email: `m${i}@example.com` });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: '2026-09-11', sent_today: 10 });

    // A MONOTONIC fake clock, not a fixed script of exact call indices: other
    // code in the send path (unsubscribeHeaders' quarterly-bucket calc) also
    // reads `new Date()`, so pinning this test to an exact call count would
    // make it fragile to unrelated changes. Starting 60s before midnight and
    // advancing 20s on every no-arg `new Date()` guarantees midnight is
    // crossed well before the run ends (five recipients is easily enough
    // calls), without this test needing to know exactly which call is which.
    const RealDate = globalThis.Date;
    let cursor = RealDate.parse('2026-09-11T23:59:00.000Z');
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) { super(cursor); cursor += 20_000; }
        else { super(...args); }
      }
    }
    FakeDate.now = RealDate.now.bind(RealDate);
    FakeDate.parse = RealDate.parse.bind(RealDate);
    globalThis.Date = FakeDate;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);

    let body;
    try {
      ({ body } = await call(db, { ...BODY, send: true }));
    } finally {
      globalThis.Date = RealDate;
      globalThis.setTimeout = realSetTimeout;
    }

    assert.equal(body.sent, 5);
    const state = await db.prepare("SELECT day, sent_today FROM mail_domain_state WHERE domain = 'rrmacademy.com'").first();
    assert.notEqual(state.day, '2026-09-11', 'the counter follows the clock across midnight, not the page-start day');
    assert.ok(
      state.sent_today < 10,
      `sent_today (${state.sent_today}) must have RESET when the day rolled over, not kept incrementing the old day's count past 10`,
    );
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
    assert.equal(
      body.action, 'read the reason, then re-run with --resume',
      'the breaker 423 carries the same action hint the open-pause 423 does (I7)',
    );
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

// --- Final fix wave ------------------------------------------------------
// I3 the first-send gate must not swallow the first dry run, I4 --resume must
// not re-trip the breaker it just cleared, I6 two concurrent --send runs of one
// campaign must not both mail the same head of the cohort.

describe('the first-send gate and the dry run (I3)', () => {
  it('a dry run with NO mail_domain_state row reports under the day 1 cap instead of 409ing', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    const before = ses.calls.length;
    const { status, body } = await call(db, BODY);
    assert.equal(status, 200, 'the first thing an operator does is ask for the report');
    assert.equal(body.dryRun, true);
    assert.equal(body.firstSendRequired, true);
    assert.equal(body.cap, 200, 'the day 1 cap, which is what the real run will get');
    assert.equal(body.ageDays, 1);
    assert.equal(body.remainingToday, 200);
    assert.equal(body.audience, 2, 'the audience is reported, which is the point of the report');
    assert.equal(body.wouldSend, 2);
    assert.equal(body.deferred, 0);
    assert.deepEqual(body.head, ['a@example.com', 'b@example.com']);
    assert.match(body.note, /--first-send/);
    assert.equal(ses.calls.length, before, 'a dry run is still a dry run');
    const row = await db.prepare("SELECT COUNT(*) AS c FROM mail_domain_state").first();
    assert.equal(row.c, 0, 'the report does not create the first-send row');
  });

  it('a real send with no row is still refused 409 until --first-send is passed', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 409);
    assert.equal(body.error, 'bulk_first_send_required');
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
  });
});

describe('--resume and the breaker (I4)', () => {
  /** Real trailing rows: sends and complaints the breaker actually reads. */
  async function seedTrailingWindow(db, { sends, complaints }) {
    for (let i = 0; i < sends; i++) {
      await db.prepare(
        "INSERT INTO email_log (event, email, category, source, ses_message_id) VALUES ('send', ?, 'newsletter', 'newsletter/bulk/sept-letter', ?)"
      ).bind(`t${i}@example.com`, `tmsg-${i}`).run();
    }
    for (let i = 0; i < complaints; i++) {
      await db.prepare(
        "INSERT INTO email_event (id, ses_message_id, event_type, email, ts) VALUES (?, ?, 'complaint', ?, ?)"
      ).bind(`tev-${i}`, `tmsg-${i}`, `t${i}@example.com`, new Date().toISOString()).run();
    }
  }

  it('resume sends the page and writes no new pause; the next run without resume re-trips', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedSubscriber(db, { id: 'sub-y', email: 'after@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailingWindow(db, { sends: 1000, complaints: 3 });
    await db.prepare(
      "INSERT INTO send_paused (id, campaign, reason, detail) VALUES ('sp-r1','sept-letter','complaint-rate','1000 sent, 3 complaints')"
    ).run();

    const before = ses.calls.length;
    const resumed = await call(db, { ...BODY, send: true, resume: true });
    assert.equal(resumed.status, 200, 'the breaker the human just cleared must not re-trip on the same window');
    assert.equal(resumed.body.sent, 2);
    assert.equal(ses.calls.length - before, 2, 'the page actually went out');
    assert.match(resumed.body.breaker_overridden, /complaints/, 'the override is on the response, not silent');
    // Two rows now: the original human-read pause, stamped resumed by gate 4,
    // AND a second 'breaker-overridden' row the breaker gate itself writes,
    // immediately stamped resumed -- the audit trail of WHO overrode WHAT.
    const pauses = await db.prepare('SELECT id, reason, resumed_at FROM send_paused').all();
    assert.equal(pauses.results.length, 2, 'the override itself is recorded, not just the human pause it cleared');
    const cleared = pauses.results.find((r) => r.id === 'sp-r1');
    const override = pauses.results.find((r) => r.id !== 'sp-r1');
    assert.equal(cleared.reason, 'complaint-rate');
    assert.ok(cleared.resumed_at, 'the cleared pause is stamped resumed');
    assert.equal(override.reason, 'breaker-overridden');
    assert.ok(override.resumed_at, 'the override row is inserted already-resumed');

    // The override bought one invocation. The next call re-evaluates.
    await seedSubscriber(db, { id: 'sub-z', email: 'third@example.com' });
    const again = await call(db, { ...BODY, send: true });
    assert.equal(again.status, 423);
    assert.equal(again.body.error, 'bulk_paused');
    assert.equal(again.body.reason, 'complaint-rate');
    const after = await db.prepare("SELECT COUNT(*) AS c FROM send_paused WHERE resumed_at IS NULL").first();
    assert.equal(after.c, 1, 'the re-evaluation writes its own open pause');
  });

  it('resuming a NON-breaker pause does not override the breaker: 423 with a NEW breaker pause', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailingWindow(db, { sends: 1000, complaints: 3 });
    await db.prepare(
      "INSERT INTO send_paused (id, campaign, reason, detail) VALUES ('sp-r2','sept-letter','log-write-failed','a D1 blip')"
    ).run();
    const before = ses.calls.length;
    const { status, body } = await call(db, { ...BODY, send: true, resume: true });
    assert.equal(status, 423, 'a resumed log-write-failed pause has nothing to do with the breaker verdict');
    assert.equal(body.error, 'bulk_paused');
    assert.equal(body.reason, 'complaint-rate');
    assert.equal(ses.calls.length, before, 'not one message went out');
    const pauses = await db.prepare(
      "SELECT reason, resumed_at FROM send_paused WHERE campaign = 'sept-letter'"
    ).all();
    assert.equal(pauses.results.length, 2);
    const cleared = pauses.results.find((r) => r.reason === 'log-write-failed');
    const fresh = pauses.results.find((r) => r.reason === 'complaint-rate');
    assert.ok(cleared, 'the original log-write-failed pause is still there');
    assert.ok(cleared.resumed_at, 'gate 4 still clears whatever pause was open');
    assert.ok(fresh, 'the breaker writes its OWN pause');
    assert.equal(fresh.resumed_at, null, 'the breaker pause it writes is still open');
  });

  it('resume with no open pause at all still 423s the tripped breaker', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-x', email: 'next@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedTrailingWindow(db, { sends: 1000, complaints: 3 });
    const { status, body } = await call(db, { ...BODY, send: true, resume: true });
    assert.equal(status, 423, 'resume with nothing to clear overrides nothing');
    assert.equal(body.reason, 'complaint-rate');
  });
});

describe('the campaign lease (I6)', () => {
  async function seedLeaseHolder(db, { campaign = 'sept-letter', status = 'sending', ago = '0 minutes' } = {}) {
    await db.prepare(
      `INSERT INTO newsletter_send (id, subject, html, status, total_recipients, campaign, updated_at)
       VALUES ('ns-lease', 'held', '<p>held</p>', ?, 0, ?, datetime('now', ?))`
    ).bind(status, campaign, `-${ago}`).run();
  }

  it('a second --send inside the lease window is refused 409 and sends nothing', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedLeaseHolder(db);
    const before = ses.calls.length;
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 409);
    assert.equal(body.error, 'bulk_run_in_progress');
    assert.ok(body.retryAfterSeconds > 0 && body.retryAfterSeconds <= 180);
    assert.equal(ses.calls.length, before, 'not one duplicate message went out');
    const c = await db.prepare('SELECT COUNT(*) AS c FROM newsletter_event').first();
    assert.equal(c.c, 0);
  });

  it('a lease older than the window has expired, and the run proceeds', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedLeaseHolder(db, { ago: '4 minutes' });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 200);
    assert.equal(body.sent, 1);
  });

  it('a lease held 10 seconds ago is fresh: 409, and no second row is left behind (I9)', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedLeaseHolder(db, { ago: '10 seconds' });
    const before = ses.calls.length;
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 409);
    assert.equal(body.error, 'bulk_run_in_progress');
    assert.equal(ses.calls.length, before, 'not one message went out');
    const rows = await db.prepare("SELECT id, status FROM newsletter_send WHERE campaign = 'sept-letter'").all();
    assert.equal(rows.results.length, 1, 'the failed INSERT leaves no second row behind');
    assert.equal(rows.results[0].id, 'ns-lease');
    assert.equal(rows.results[0].status, 'sending', 'a FRESH holder is never flipped');
  });

  it('a lease held 4 minutes ago is stale: it is flipped to partial and the new run proceeds (I9)', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedLeaseHolder(db, { ago: '4 minutes' });
    const { status, body } = await call(db, { ...BODY, send: true });
    assert.equal(status, 200);
    assert.equal(body.sent, 1);
    const old = await db.prepare("SELECT status FROM newsletter_send WHERE id = 'ns-lease'").first();
    assert.equal(old.status, 'partial', 'the abandoned row is flipped so the unique index never wedges the campaign');
    // This page ran to completion (one recipient, done:true), so its OWN row
    // is already stamped 'sent' by the end of runBulkSend -- the assertion
    // that matters is that no row for this campaign was left 'sending'.
    const held = await db.prepare(
      "SELECT COUNT(*) AS c FROM newsletter_send WHERE campaign = 'sept-letter' AND status = 'sending'"
    ).first();
    assert.equal(held.c, 0, 'no row holds the lease once the page is done');
  });

  it('two concurrent --send calls of the same campaign: exactly one 200 and one 409, no recipient mailed twice (I9)', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedSubscriber(db, { id: 'sub-2', email: 'b@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    // Two calls, kicked off together with no await between them: node:sqlite's
    // async-but-internally-synchronous prepare/run/batch (test/_d1-sqlite.mjs)
    // means these interleave at await boundaries exactly like two isolates
    // racing the same D1 database would, and migration 043's UNIQUE INDEX is
    // what actually decides which one wins.
    const [a, b] = await Promise.all([
      call(db, { ...BODY, send: true }),
      call(db, { ...BODY, send: true }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one call sent, exactly one was refused');
    const winner = a.status === 200 ? a : b;
    assert.equal(winner.body.sent, 2, 'the winner mailed the whole page');
    const logged = await db.prepare(
      "SELECT email FROM email_log WHERE source = 'newsletter/bulk/sept-letter'"
    ).all();
    assert.deepEqual(
      logged.results.map((r) => r.email).sort(), ['a@example.com', 'b@example.com'],
      'each recipient appears exactly once, not twice',
    );
  });

  it('another campaign is not blocked by this one, and a dry run is never refused', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    await seedLeaseHolder(db);
    const other = await call(db, { ...BODY, campaign: 'oct-letter', send: true });
    assert.equal(other.status, 200);
    const dry = await call(db, BODY);
    assert.equal(dry.status, 200);
    assert.equal(dry.body.dryRun, true);
  });

  it('the caller loop is never refused by its own previous page', async () => {
    const db = bulkMailD1();
    for (let i = 0; i < 52; i++) {
      await seedSubscriber(db, { id: `sub-${String(i).padStart(3, '0')}`, email: `L${i}@example.com` });
    }
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY, sent_today: 0 });
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
    let first;
    let second;
    try {
      first = await call(db, { ...BODY, send: true });
      second = await call(db, { ...BODY, send: true });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    assert.equal(first.body.sent, 50);
    assert.equal(first.body.done, false);
    assert.equal(second.status, 200, 'the page before it released the lease when it ended');
    assert.equal(second.body.sent, 2);
    assert.equal(second.body.done, true);
    const held = await db.prepare(
      "SELECT COUNT(*) AS c FROM newsletter_send WHERE campaign = 'sept-letter' AND status = 'sending'"
    ).first();
    assert.equal(held.c, 0, 'no page leaves the lease held after it ends');
  });
});

describe('a deploy that outruns its own migrations (I8)', () => {
  it('a "no such table" on the mail_domain_state read is a named 503, not an unhandled 500', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.includes('FROM mail_domain_state WHERE domain')) {
        return { bind: () => ({ async first() { throw new Error('D1_ERROR: no such table: mail_domain_state'); } }) };
      }
      return realPrepare(sql);
    };
    let status;
    let body;
    try {
      ({ status, body } = await call(db, { ...BODY, send: true }));
    } finally {
      db.prepare = realPrepare;
    }
    assert.equal(status, 503);
    assert.equal(body.error, 'bulk_schema_not_migrated');
    assert.match(body.detail, /041-043/);
  });

  it('a "no such column" on the campaign lease SELECT is also a named 503', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    await seedDomainState(db, { first_send_at: YEAR_AGO, day: TODAY });
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.includes("FROM newsletter_send") && sql.includes("status = 'sending'")) {
        return { bind: () => ({ async first() { throw new Error('D1_ERROR: no such column: campaign'); } }) };
      }
      return realPrepare(sql);
    };
    let status;
    let body;
    try {
      ({ status, body } = await call(db, { ...BODY, send: true }));
    } finally {
      db.prepare = realPrepare;
    }
    assert.equal(status, 503);
    assert.equal(body.error, 'bulk_schema_not_migrated');
  });

  it('an unrelated D1 error is NOT swallowed into a 503 -- it still propagates', async () => {
    const db = bulkMailD1();
    await seedSubscriber(db, { id: 'sub-1', email: 'a@example.com' });
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.includes('FROM mail_domain_state WHERE domain')) {
        return { bind: () => ({ async first() { throw new Error('D1_ERROR: network timeout'); } }) };
      }
      return realPrepare(sql);
    };
    let threw = null;
    try {
      await call(db, { ...BODY, send: true });
    } catch (err) {
      threw = err;
    } finally {
      db.prepare = realPrepare;
    }
    assert.ok(threw, 'a non-schema D1 error is not caught and turned into a 503');
    assert.match(threw.message, /network timeout/);
  });
});
