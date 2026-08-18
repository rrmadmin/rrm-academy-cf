/**
 * functions/api/events/remind.js -- the day-of reminder sweep for FREE
 * Save the Uterus Club events.
 *
 * WHAT THIS ENDPOINT IS, AND WHY EACH CLAIM IS ABOUT A ROW
 * -------------------------------------------------------
 * It is a bearer-authenticated pull, driven by an external scheduler, that
 * re-sends the joining-link email to every registration with
 * `reminder_sent_at IS NULL` for every free event starting in the next 12 hours.
 * Three things decide whether it behaves: the WINDOW (a SQL BETWEEN over
 * event_date), the SELECTION (`reminder_sent_at IS NULL`), and the STAMP that
 * makes it idempotent. All three are database facts, so this runs on node:sqlite
 * with the committed migrations/032 DDL read off disk, and every assertion reads
 * rows or reads the SES payload the send actually produced.
 *
 * THE SHAPE THAT MATTERS MOST
 * ---------------------------
 * An unconfigured deploy must be INERT. EVENTS_REMIND_KEY unset means 503 and
 * zero sends, never an open endpoint that anyone can use to make the site email
 * its registrants. That is the first test below, and it is the one whose failure
 * would be worst.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mockRequest, mockEnv, mockKV, mockWaitUntil, parseResponse, stubExternalFetch, drainWaitUntil,
} from './_helpers.js';
import { sqliteD1, insertUser } from './_d1-sqlite.mjs';

const remind = await import('../functions/api/events/remind.js');

const MIGRATION_025 = readFileSync(new URL('../migrations/025-stuc-action-areas.sql', import.meta.url), 'utf8');
const MIGRATION_032 = readFileSync(new URL('../migrations/032-free-events.sql', import.meta.url), 'utf8');

const KEY = 'remind-key-under-test';
const AUTHOR = 'u_rem_author';
const MEET_URL = 'https://meet.google.com/gat-eded-xyz';

const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();

function insertEvent(sqlite, over = {}) {
  const row = {
    id: 'post_today',
    author_id: AUTHOR,
    type: 'event',
    title: 'Endometriosis, Start to Finish',
    content: 'Endometriosis, Start to Finish\n\nA free public call.',
    channel: 'stuc',
    slug: 'todays-call',
    event_date: inHours(4),
    event_link: MEET_URL,
    speaker: null,
    is_free: 1,
    ...over,
  };
  const cols = Object.keys(row);
  sqlite.prepare(
    `INSERT INTO community_post (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

function insertRegistration(sqlite, { id, postId = 'post_today', email, userId = null, reminderSentAt = null }) {
  sqlite.prepare(
    'INSERT INTO event_registration (id, post_id, email, user_id, reminder_sent_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, postId, email, userId, reminderSentAt);
}

async function seededDb(extra, opts = {}) {
  return sqliteD1({
    ...opts,
    seed(sqlite) {
      sqlite.exec(MIGRATION_025);
      sqlite.exec(MIGRATION_032);
      insertUser(sqlite, { id: AUTHOR, email: 'staff@rrmacademy.org', role: 'admin' });
      insertEvent(sqlite);
      if (extra) extra(sqlite);
    },
  });
}

const registrations = (db) => db._sqlite.prepare('SELECT * FROM event_registration ORDER BY id').all();
const makeEnv = (db, over = {}) => mockEnv({ DB: db, COMMUNITY_KV: mockKV(), EVENTS_REMIND_KEY: KEY, ...over });

async function sweep(env, { auth = `Bearer ${KEY}` } = {}) {
  const headers = auth === null ? {} : { Authorization: auth };
  const waitUntil = mockWaitUntil();
  const res = await remind.onRequestGet({
    request: mockRequest('GET', { url: 'https://rrmacademy.org/api/events/remind', headers }),
    env,
    waitUntil,
  });
  await drainWaitUntil(waitUntil);
  return parseResponse(res);
}

function recipients(net) {
  return net.ses
    .map((c) => (typeof c.body === 'string' ? JSON.parse(c.body) : c.body))
    .map((p) => p.Destination.ToAddresses[0]);
}

describe('GET /api/events/remind -- the gate', () => {
  let db; let net;

  beforeEach(async () => {
    db = await seededDb((s) => insertRegistration(s, { id: 'r1', email: 'one@example.com' }));
    net = stubExternalFetch();
  });
  afterEach(() => { net.restore(); db.close(); });

  it('503s and sends NOTHING when the secret is unset', async () => {
    const { status, body } = await sweep(makeEnv(db, { EVENTS_REMIND_KEY: undefined }));
    assert.equal(status, 503);
    assert.equal(body.error, 'not_configured');
    assert.equal(net.ses.length, 0, 'an unconfigured deploy must be inert, never open');
    assert.equal(registrations(db)[0].reminder_sent_at, null);
  });

  it('503s when the DB binding is missing', async () => {
    const { status } = await sweep(makeEnv(db, { DB: undefined }));
    assert.equal(status, 503);
  });

  it('401s on a missing, malformed, wrong-length and wrong-value bearer', async () => {
    for (const auth of [null, KEY, 'Bearer ', 'Bearer short', `Bearer ${'x'.repeat(KEY.length)}`, 'Basic abc']) {
      const { status, body } = await sweep(makeEnv(db), { auth });
      assert.equal(status, 401, JSON.stringify(auth));
      assert.equal(body.error, 'unauthorized');
    }
    assert.equal(net.ses.length, 0);
  });

  it('accepts the correct bearer', async () => {
    const { status, body } = await sweep(makeEnv(db));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

describe('GET /api/events/remind -- who gets a reminder', () => {
  let net;
  beforeEach(() => { net = stubExternalFetch(); });
  afterEach(() => net.restore());

  it('sends to every un-reminded registration and stamps each one', async () => {
    const db = await seededDb((s) => {
      insertRegistration(s, { id: 'r1', email: 'one@example.com' });
      insertRegistration(s, { id: 'r2', email: 'two@example.com' });
    });
    const { status, body } = await sweep(makeEnv(db));

    assert.equal(status, 200);
    assert.equal(body.sent, 2);
    assert.equal(body.failed, 0);
    assert.deepEqual(recipients(net).sort(), ['one@example.com', 'two@example.com']);
    assert.ok(registrations(db).every((r) => r.reminder_sent_at));
    db.close();
  });

  it('is idempotent: a second sweep sends nothing', async () => {
    const db = await seededDb((s) => insertRegistration(s, { id: 'r1', email: 'one@example.com' }));
    await sweep(makeEnv(db));
    const before = net.ses.length;
    const { body } = await sweep(makeEnv(db));

    assert.equal(body.sent, 0, 'reminder_sent_at is what makes an hourly driver safe');
    assert.equal(net.ses.length, before);
    db.close();
  });

  it('skips a registration that was already reminded', async () => {
    const db = await seededDb((s) => {
      insertRegistration(s, { id: 'r1', email: 'done@example.com', reminderSentAt: '2026-01-01 00:00:00' });
      insertRegistration(s, { id: 'r2', email: 'pending@example.com' });
    });
    const { body } = await sweep(makeEnv(db));

    assert.equal(body.sent, 1);
    assert.deepEqual(recipients(net), ['pending@example.com']);
    db.close();
  });

  it('ignores an event outside the 12-hour window, in both directions', async () => {
    const db = await seededDb((s) => {
      insertEvent(s, { id: 'post_tomorrow', slug: 'tomorrow-call', event_date: inHours(30) });
      insertEvent(s, { id: 'post_gone', slug: 'gone-call', event_date: inHours(-2) });
      insertRegistration(s, { id: 'r_far', postId: 'post_tomorrow', email: 'far@example.com' });
      insertRegistration(s, { id: 'r_past', postId: 'post_gone', email: 'past@example.com' });
    });
    const { body } = await sweep(makeEnv(db));

    // The fixture's own event (+4h) IS in the window and has no registrations,
    // so the sweep sees one event and sends nothing.
    assert.equal(body.events, 1, 'only the in-window event is selected');
    assert.equal(body.sent, 0);
    assert.equal(net.ses.length, 0);
    assert.ok(
      registrations(db).every((r) => r.reminder_sent_at === null),
      'an out-of-window registration must not be stamped',
    );
    db.close();
  });

  it('ignores a members-only event even when it is starting today', async () => {
    const db = await seededDb((s) => {
      insertEvent(s, { id: 'post_paid', slug: 'paid-call', event_date: inHours(3), is_free: 0 });
      insertRegistration(s, { id: 'r_paid', postId: 'post_paid', email: 'paid@example.com' });
    });
    const { body } = await sweep(makeEnv(db));

    assert.equal(body.events, 1, 'only the free event is in scope');
    assert.deepEqual(recipients(net), []);
    db.close();
  });

  it('a failed send leaves reminder_sent_at NULL so the next run retries', async () => {
    net.restore();
    net = stubExternalFetch({ ses: () => ({ ok: false, status: 500, text: async () => 'SES down' }) });
    const db = await seededDb((s) => insertRegistration(s, { id: 'r1', email: 'one@example.com' }));

    const { status, body } = await sweep(makeEnv(db));

    assert.equal(status, 200, 'one bad recipient does not fail the sweep');
    assert.equal(body.sent, 0);
    assert.equal(body.failed, 1);
    assert.equal(registrations(db)[0].reminder_sent_at, null);
    db.close();
  });
});

describe('GET /api/events/remind -- the message', () => {
  let net;
  beforeEach(() => { net = stubExternalFetch(); });
  afterEach(() => net.restore());

  it('uses the Today subject and carries the joining link', async () => {
    const db = await seededDb((s) => insertRegistration(s, { id: 'r1', email: 'one@example.com' }));
    await sweep(makeEnv(db));

    const payload = typeof net.ses[0].body === 'string' ? JSON.parse(net.ses[0].body) : net.ses[0].body;
    const simple = payload.Content.Simple;
    assert.equal(simple.Subject.Data, 'Today: Endometriosis, Start to Finish');
    assert.equal(payload.FromEmailAddress, '"Dr. Naomi Whittaker" <community@rrmacademy.org>');
    assert.match(simple.Body.Html.Data, new RegExp(`<a href="${MEET_URL}">`));
    assert.match(simple.Body.Html.Data, /Today is the day/);
    assert.ok(!/\bSTUC\b/.test(simple.Body.Html.Data), 'copy never abbreviates the club name');
    db.close();
  });

  it('the response body carries counts only, never the link', async () => {
    const db = await seededDb((s) => insertRegistration(s, { id: 'r1', email: 'one@example.com' }));
    const { body } = await sweep(makeEnv(db));

    assert.deepEqual(Object.keys(body).sort(), ['capped', 'events', 'failed', 'ok', 'sent']);
    assert.ok(!JSON.stringify(body).includes('meet.google.com'));
    assert.ok(!JSON.stringify(body).includes('one@example.com'), 'no recipient addresses in the response');
    db.close();
  });
});
