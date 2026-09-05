/**
 * functions/api/community/_email.js -- the STUC notification mailer.
 *
 * THE FAILURE THAT MATTERS
 * This module decides who receives a private-community notification. The
 * expensive bug is not "no email went out", it is "an email about one member's
 * post went to somebody who is not in the club". So the recipient assertions
 * below are set equality against the SES payloads -- who WAS mailed and who was
 * NOT -- never "a send happened".
 *
 * WHY A REAL ENGINE
 * The roster is chosen by STUC_MEMBER_WHERE, a predicate made of a correlated
 * EXISTS over wix_subscription, an IN over user_label, a COALESCE recency guard
 * and a `ws.email = u.email COLLATE NOCASE` column-to-column comparison. A
 * substring-matching mock returns whatever roster the test declared, which
 * would make every "this person was excluded" assertion a restatement of the
 * fixture. Everything here runs on node:sqlite loaded with the committed
 * rrm-auth schema (test/_d1-sqlite.mjs), so the predicate actually decides.
 *
 * WHAT IS FAKED, AND WHAT THAT CANNOT DISTINGUISH
 *  1. SES. stubExternalFetch routes email.<region>.amazonaws.com, so aws4fetch
 *     really signs a real Request and the assertions read the JSON body the
 *     handler built. Nothing here proves SES accepts it, nor that a real
 *     mailbox renders the HTML as intended.
 *  2. The 1800 ms inter-batch pause is COLLAPSED: globalThis.setTimeout is
 *     replaced for the duration of the pacing suites so a 1800 ms callback
 *     fires on the next tick, and the delay VALUES are asserted instead of
 *     waited on. That proves the trickle's shape (batch size, batch count,
 *     ordering, pause between batches); it does not prove 1800 ms is under
 *     SES's rate cap. scripts/gates/validate-email-trickle.mjs holds the
 *     structural half of that invariant.
 *  3. Intl is deliberately made to throw in two tests to reach the defensive
 *     catches around date formatting. That proves the fallback branch, not
 *     that any real ICU build fails there.
 *  4. Analytics Engine and KV are the mockEnv / mockKVJson stubs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockKVJson, stubExternalFetch } from './_helpers.js';
import { sqliteD1, insertUser, insertWixSubscription, insertLabel } from './_d1-sqlite.mjs';

const {
  notifyNewPost, notifyEventShareLink, notifyReply, notifyCommentAlert,
} = await import('../functions/api/community/_email.js');

const STUC_LABEL = 'Save the Uterus Club \u{1F3F7}\u{FE0F}';
const BRIAN_ID = '301eb55c3f388e65f3f42b14e635dc7a';
const NAOMI_ID = '710134def83240b7b47b22a9c9579c0c';
const NAOMI_PERSONAL = 'naomimwhittaker@gmail.com';
const BATCH_DELAY_MS = 1800;

// --------------------------------------------------------------- seeding ---

/**
 * Adds a user plus whatever membership evidence makes STUC_MEMBER_WHERE true.
 * `kind` is the ONLY thing that should decide eligibility, which is what the
 * roster tests below are checking.
 */
function addUser(sqlite, { id, email, kind = 'wix', firstName = null, optOut = 0, blocked = 0, role = 'member' }) {
  insertUser(sqlite, {
    id, email, role, blocked,
    first_name: firstName,
    community_email_opt_out: optOut,
    stripe_customer_id: kind === 'stripe' ? `cus_${id}` : null,
  });
  if (kind === 'wix') insertWixSubscription(sqlite, { email, user_id: id });
  if (kind === 'wix-stale') {
    insertWixSubscription(sqlite, {
      email, user_id: id,
      next_expected_at: new Date(Date.now() - 60 * 86400e3).toISOString(),
      last_order_at: new Date(Date.now() - 120 * 86400e3).toISOString(),
    });
  }
  if (kind === 'grandfather') insertLabel(sqlite, id, 'STUC Legacy Grandfather');
  if (kind === 'stripe') insertLabel(sqlite, id, STUC_LABEL);
  return { id, email };
}

function db(seed) {
  return sqliteD1({ seed });
}

function addPost(sqlite, { id, authorId, type = 'discussion', title = 'A post', body = null, slug = null, eventDate = null, speaker = null }) {
  sqlite.prepare(
    'INSERT INTO community_post (id, author_id, type, title, body, slug, event_date, speaker) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, authorId, type, title, body, slug, eventDate, speaker);
}

function addComment(sqlite, { id, postId, authorId, parentId = null, content = 'hi' }) {
  sqlite.prepare(
    'INSERT INTO community_comment (id, post_id, author_id, parent_id, content) VALUES (?, ?, ?, ?, ?)'
  ).run(id, postId, authorId, parentId, content);
}

// ------------------------------------------------------------ SES reading ---

const toAddresses = (stub) => stub.ses.map(c => c.body.Destination.ToAddresses).flat();
const senders = (stub) => stub.ses.map(c => c.body.FromEmailAddress);
const subjects = (stub) => stub.ses.map(c => c.body.Content.Simple.Subject.Data);
const htmlOf = (call) => call.body.Content.Simple.Body.Html.Data;
const textOf = (call) => call.body.Content.Simple.Body.Text.Data;
const forRecipient = (stub, email) => stub.ses.find(c => c.body.Destination.ToAddresses.includes(email));

function emailLogRows(harness) {
  return harness._sqlite.prepare('SELECT event, email, source, subject, detail FROM email_log ORDER BY id').all().map(r => ({ ...r }));
}

/**
 * Collapses only the trickle's own pause so the batching shape can be asserted
 * without spending real seconds. Every other timer is left alone.
 */
function collapseTrickleDelay(timeline) {
  const real = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = (fn, ms, ...rest) => {
    if (ms === BATCH_DELAY_MS) {
      delays.push(ms);
      if (timeline) timeline.push('pause');
      return real(fn, 0, ...rest);
    }
    return real(fn, ms, ...rest);
  };
  return { delays, restore() { globalThis.setTimeout = real; } };
}

function envFor(harness, overrides = {}) {
  const events = [];
  const kv = overrides.COMMUNITY_KV === undefined ? mockKVJson() : overrides.COMMUNITY_KV;
  const env = mockEnv({
    DB: harness,
    COMMUNITY_KV: kv,
    EVENTS: { writeDataPoint(d) { events.push(d); } },
    ...overrides,
    ...(overrides.COMMUNITY_KV === undefined ? { COMMUNITY_KV: kv } : {}),
  });
  env._events = events;
  return env;
}

// ================================================== notifyNewPost: roster ===

describe('_email.js notifyNewPost -- who is on the recipient list', () => {
  let harness, stub, clock;

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'u_wix', email: 'wix@example.com', kind: 'wix', firstName: 'Wanda' });
      addUser(s, { id: 'u_grand', email: 'grand@example.com', kind: 'grandfather' });
      addUser(s, { id: 'u_stripe', email: 'stripe@example.com', kind: 'stripe' });
      addUser(s, { id: 'u_mod', email: 'mod@example.com', kind: 'none', role: 'mod' });
      // Every one of the following must be absent from the send list.
      addUser(s, { id: 'u_optout', email: 'optout@example.com', kind: 'wix', optOut: 1 });
      addUser(s, { id: 'u_blocked', email: 'blocked@example.com', kind: 'wix', blocked: 1 });
      addUser(s, { id: 'u_lapsed', email: 'lapsed@example.com', kind: 'wix-stale' });
      addUser(s, { id: 'u_nobody', email: 'nobody@example.com', kind: 'none' });
      addUser(s, { id: 'u_stripe_nolabel', email: 'stripe-nolabel@example.com', kind: 'none' });
      // A Stripe customer with no STUC label: a payer for something else entirely.
      s.prepare('UPDATE user SET stripe_customer_id = ? WHERE id = ?').run('cus_other', 'u_stripe_nolabel');
    });
    stub = stubExternalFetch();
    clock = collapseTrickleDelay();
  });
  afterEach(() => { clock.restore(); stub.restore(); harness.close(); });

  it('mails every eligible member exactly once and nobody else', async () => {
    const env = envFor(harness);
    await notifyNewPost(env, harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');

    const got = toAddresses(stub).sort();
    assert.deepEqual(got, ['grand@example.com', 'mod@example.com', 'stripe@example.com', 'wix@example.com']);

    for (const excluded of [
      'author@example.com', 'optout@example.com', 'blocked@example.com',
      'lapsed@example.com', 'nobody@example.com', 'stripe-nolabel@example.com',
    ]) {
      assert.ok(!got.includes(excluded), `${excluded} must not receive community mail`);
    }
  });

  it('addresses each member individually -- one recipient per message, never a shared To list', async () => {
    await notifyNewPost(envFor(harness), harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
    assert.equal(stub.ses.length, 4);
    for (const call of stub.ses) {
      assert.equal(call.body.Destination.ToAddresses.length, 1,
        'batching members into one Destination would disclose the roster to every recipient');
    }
  });

  it('excludes the author even when the author is otherwise an eligible member', async () => {
    const solo = db((s) => {
      addUser(s, { id: 'u_self', email: 'self@example.com', kind: 'wix' });
    });
    try {
      await notifyNewPost(envFor(solo), solo, { id: 'p1', authorId: 'u_self', type: 'discussion' }, 'Self');
      assert.equal(stub.ses.length, 0, 'the only eligible member is the author, so nothing should send');
    } finally { solo.close(); }
  });

  it('sends nothing when the roster is empty', async () => {
    const empty = db(() => {});
    try {
      await notifyNewPost(envFor(empty), empty, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'X');
      assert.equal(stub.ses.length, 0);
    } finally { empty.close(); }
  });

  it('matches a Wix subscription that spells the address in a different case', async () => {
    const cased = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      insertUser(s, { id: 'u_case', email: 'Case@Example.com' });
      insertWixSubscription(s, { email: 'case@EXAMPLE.COM' });
    });
    try {
      await notifyNewPost(envFor(cased), cased, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'X');
      assert.deepEqual(toAddresses(stub), ['Case@Example.com'],
        'the roster predicate compares ws.email to u.email COLLATE NOCASE');
    } finally { cased.close(); }
  });
});

// ================================================ notifyNewPost: cooldown ===

describe('_email.js notifyNewPost -- the 15-minute cooldown marker', () => {
  let harness, stub, clock;

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'm1', email: 'm1@example.com', kind: 'wix' });
      addUser(s, { id: 'm2', email: 'm2@example.com', kind: 'wix' });
    });
    stub = stubExternalFetch();
    clock = collapseTrickleDelay();
  });
  afterEach(() => { clock.restore(); stub.restore(); harness.close(); });

  const post = { id: 'p1', authorId: 'u_author', type: 'discussion' };

  it('sends nothing when a blast went out less than 15 minutes ago', async () => {
    const kv = mockKVJson({ 'community:last_post_email': String(Date.now() - 60_000) });
    await notifyNewPost(envFor(harness, { COMMUNITY_KV: kv }), harness, post, 'Naomi');
    assert.equal(stub.ses.length, 0);
    assert.equal(harness._calls.length, 0, 'the cooldown must short-circuit before the roster query');
  });

  it('sends once the cooldown has elapsed', async () => {
    const kv = mockKVJson({ 'community:last_post_email': String(Date.now() - 16 * 60_000) });
    await notifyNewPost(envFor(harness, { COMMUNITY_KV: kv }), harness, post, 'Naomi');
    assert.equal(stub.ses.length, 2);
  });

  it('sends when there is no KV binding at all', async () => {
    await notifyNewPost(envFor(harness, { COMMUNITY_KV: null }), harness, post, 'Naomi');
    assert.equal(stub.ses.length, 2);
  });

  it('stamps the cooldown AFTER the sends, never before', async () => {
    const timeline = [];
    const local = collapseTrickleDelay(timeline);
    const sesStub = stubExternalFetch({
      ses: (call) => {
        timeline.push('send:' + call.body.Destination.ToAddresses[0]);
        return { ok: true, status: 200, json: async () => ({ MessageId: 'id' }), text: async () => '{}' };
      },
    });
    const base = mockKVJson();
    const kv = {
      puts: base.puts, deletes: base.deletes, read: base.read.bind(base),
      get: base.get.bind(base),
      async put(key, value, opts) { timeline.push('mark:' + key); return base.put(key, value, opts); },
      delete: base.delete.bind(base),
    };
    try {
      await notifyNewPost(envFor(harness, { COMMUNITY_KV: kv }), harness, post, 'Naomi');
    } finally { sesStub.restore(); local.restore(); }

    const markIndex = timeline.indexOf('mark:community:last_post_email');
    const lastSend = timeline.map((e, i) => (e.startsWith('send:') ? i : -1)).filter(i => i >= 0).pop();
    assert.ok(markIndex > lastSend,
      'stamping the cooldown before the sends would make a failed blast unretryable for 15 minutes');
    const marker = base.puts.find(p => p.key === 'community:last_post_email');
    assert.equal(marker.opts.expirationTtl, 900);
  });

  it('does NOT stamp the cooldown when fewer than half the sends succeeded, and says so', async () => {
    const sesStub = stubExternalFetch({
      ses: () => ({ ok: false, status: 454, text: async () => 'Throttling' }),
    });
    const kv = mockKVJson();
    const env = envFor(harness, { COMMUNITY_KV: kv });
    try {
      await notifyNewPost(env, harness, post, 'Naomi');
    } finally { sesStub.restore(); }

    assert.equal(kv.read('community:last_post_email'), null,
      'a failed blast must stay retryable, so the cooldown marker must not be written');
    const warn = env._events.find(e => e.blobs?.includes('notify_cooldown_skipped'));
    assert.ok(warn, 'the skipped cooldown must be logged');
  });

  it('stamps the cooldown when exactly half the sends succeeded (the >= boundary)', async () => {
    const sesStub = stubExternalFetch({
      ses: (call) => (call.body.Destination.ToAddresses[0] === 'm1@example.com'
        ? { ok: true, status: 200, json: async () => ({ MessageId: 'ok' }), text: async () => '{}' }
        : { ok: false, status: 400, text: async () => 'boom' }),
    });
    const kv = mockKVJson();
    try {
      await notifyNewPost(envFor(harness, { COMMUNITY_KV: kv }), harness, post, 'Naomi');
    } finally { sesStub.restore(); }
    assert.notEqual(kv.read('community:last_post_email'), null, '1 of 2 is >= 0.5 and must set the cooldown');
  });
});

// =============================================== notifyNewPost: failures ===

describe('_email.js notifyNewPost -- per-recipient failure accounting', () => {
  let harness, clock;

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      for (let i = 1; i <= 4; i++) addUser(s, { id: `m${i}`, email: `m${i}@example.com`, kind: 'wix' });
    });
    clock = collapseTrickleDelay();
  });
  afterEach(() => { clock.restore(); harness.close(); });

  it('logs the failure against the recipient that actually failed, not a neighbour', async () => {
    const doomed = 'm3@example.com';
    const stub = stubExternalFetch({
      ses: (call) => (call.body.Destination.ToAddresses[0] === doomed
        ? { ok: false, status: 400, text: async () => 'Address rejected' }
        : { ok: true, status: 200, json: async () => ({ MessageId: 'mid' }), text: async () => '{}' }),
    });
    const env = envFor(harness);
    try {
      await notifyNewPost(env, harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
    } finally { stub.restore(); }

    const failures = emailLogRows(harness).filter(r => r.event === 'failed');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].email, doomed,
      'results[i] must correspond to recipients[i]; an off-by-one here blames the wrong member');
    assert.equal(failures[0].source, 'community/new-post');
    const sent = emailLogRows(harness).filter(r => r.event === 'send').map(r => r.email).sort();
    assert.deepEqual(sent, ['m1@example.com', 'm2@example.com', 'm4@example.com']);
  });

  it('reports total / succeeded / failed counts to Analytics Engine', async () => {
    const stub = stubExternalFetch({
      ses: (call) => (call.body.Destination.ToAddresses[0] === 'm2@example.com'
        ? { ok: false, status: 400, text: async () => 'nope' }
        : { ok: true, status: 200, json: async () => ({ MessageId: 'mid' }), text: async () => '{}' }),
    });
    const env = envFor(harness);
    try {
      await notifyNewPost(env, harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
    } finally { stub.restore(); }
    const point = env._events.find(e => e.blobs?.includes('stuc_blast_result'));
    assert.ok(point);
    assert.deepEqual(point.doubles, [4, 3, 1]);
    assert.equal(point.blobs[3], 'p1', 'the post id must be on the datapoint');
  });

  it('completes without an EVENTS binding', async () => {
    const stub = stubExternalFetch();
    try {
      await notifyNewPost(mockEnv({ DB: harness, COMMUNITY_KV: mockKVJson(), EVENTS: null }), harness,
        { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
      assert.equal(stub.ses.length, 4);
    } finally { stub.restore(); }
  });
});

// ================================================= notifyNewPost: pacing ===

describe('_email.js notifyNewPost -- the send is a paced trickle, not a burst', () => {
  it('sends in batches of five with one pause between batches, in roster order', async () => {
    const harness = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      for (let i = 1; i <= 12; i++) addUser(s, { id: `m${i}`, email: `m${String(i).padStart(2, '0')}@example.com`, kind: 'wix' });
    });
    const timeline = [];
    const clock = collapseTrickleDelay(timeline);
    const stub = stubExternalFetch({
      ses: (call) => {
        timeline.push('send');
        return { ok: true, status: 200, json: async () => ({ MessageId: 'mid' }), text: async () => '{}' };
      },
    });
    try {
      await notifyNewPost(envFor(harness), harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
    } finally { stub.restore(); clock.restore(); harness.close(); }

    assert.equal(stub.ses.length, 12);
    assert.deepEqual(clock.delays, [BATCH_DELAY_MS, BATCH_DELAY_MS],
      'twelve recipients is three batches, so exactly two inter-batch pauses');
    // 5 sends, pause, 5 sends, pause, 2 sends.
    const shape = timeline.reduce((acc, e) => {
      if (e === 'pause') acc.push(0);
      else acc[acc.length - 1] += 1;
      return acc;
    }, [0]);
    assert.deepEqual(shape, [5, 5, 2], 'the trickle must not fire the whole roster concurrently');
  });

  it('makes no pause at all when the roster fits in a single batch', async () => {
    const harness = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      for (let i = 1; i <= 5; i++) addUser(s, { id: `m${i}`, email: `m${i}@example.com`, kind: 'wix' });
    });
    const clock = collapseTrickleDelay();
    const stub = stubExternalFetch();
    try {
      await notifyNewPost(envFor(harness), harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
    } finally { stub.restore(); clock.restore(); harness.close(); }
    assert.deepEqual(clock.delays, []);
  });

  it('warns when the roster query comes back at the 5000-row LIMIT', async () => {
    const harness = db((s) => {
      addUser(s, { id: 'u_author', email: 'author@example.com', kind: 'staff', role: 'admin' });
      const insert = s.prepare('INSERT INTO user (id, email, hashed_password, role, blocked, community_email_opt_out) VALUES (?, ?, \'\', \'member\', 0, 0)');
      const label = s.prepare('INSERT INTO user_label (user_id, label) VALUES (?, ?)');
      s.exec('BEGIN');
      for (let i = 0; i < 5000; i++) {
        insert.run(`bulk${i}`, `bulk${i}@example.com`);
        label.run(`bulk${i}`, 'STUC Legacy Grandfather');
      }
      s.exec('COMMIT');
    });
    const clock = collapseTrickleDelay();
    const stub = stubExternalFetch();
    const env = envFor(harness);
    try {
      await notifyNewPost(env, harness, { id: 'p1', authorId: 'u_author', type: 'discussion' }, 'Naomi');
    } finally { stub.restore(); clock.restore(); harness.close(); }

    const warn = env._events.find(e => e.blobs?.includes('notify_roster_cap_hit'));
    assert.ok(warn, 'hitting the LIMIT silently would mean members past row 5000 never hear about a post');
    assert.equal(stub.ses.length, 5000);
    assert.deepEqual(clock.delays.length, 999, '5000 recipients in batches of five is 999 pauses');
  });
});

// ============================================ notifyNewPost: discussion ===

describe('_email.js notifyNewPost -- a discussion post', () => {
  let harness, stub, clock;
  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: BRIAN_ID, email: 'brian@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: NAOMI_ID, email: 'naomi@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'u_other', email: 'other@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'm_named', email: 'named@example.com', kind: 'wix', firstName: '  Wanda  ' });
      addUser(s, { id: 'm_anon', email: 'anon@example.com', kind: 'wix' });
    });
    stub = stubExternalFetch();
    clock = collapseTrickleDelay();
  });
  afterEach(() => { clock.restore(); stub.restore(); harness.close(); });

  const send = (authorId, authorName) =>
    notifyNewPost(envFor(harness), harness, { id: 'p1', authorId, type: 'discussion' }, authorName);

  // The no-name greeting moved from a bare "Hi," to "Hi there," on 2026-08-25
  // when every sender was pointed at the shared _greeting.js helper. 2,476 of
  // 4,037 user rows have no name, so this is ordinary copy for most of the
  // list, and it should not read as a truncated personalization.
  it('greets a member by first name, and reads as ordinary copy without one', async () => {
    await send('u_other', 'Naomi');
    assert.match(htmlOf(forRecipient(stub, 'named@example.com')), /<p>Hi Wanda,<\/p>/);
    assert.match(textOf(forRecipient(stub, 'named@example.com')), /^Hi Wanda,/);
    assert.match(htmlOf(forRecipient(stub, 'anon@example.com')), /<p>Hi there,<\/p>/);
    assert.match(textOf(forRecipient(stub, 'anon@example.com')), /^Hi there,/);
  });

  it('links to the post and says who posted', async () => {
    await send('u_other', 'Naomi');
    const call = forRecipient(stub, 'anon@example.com');
    assert.equal(call.body.Content.Simple.Subject.Data, 'Naomi posted in Save the Uterus Club');
    assert.match(htmlOf(call), /href="https:\/\/rrmacademy\.org\/community\/post\/p1"/);
    assert.match(textOf(call), /View: https:\/\/rrmacademy\.org\/community\/post\/p1/);
    assert.equal(call.body.ReplyToAddresses[0], 'administrator@rrmacademy.org');
  });

  it('uses the mapped personal sender for a known author id', async () => {
    await send(BRIAN_ID, 'Brian Whittaker');
    assert.deepEqual([...new Set(senders(stub))], ['"Brian Whittaker" <brian@rrmacademy.org>']);
  });

  it('uses the mapped personal sender for the other known author id', async () => {
    await send(NAOMI_ID, 'Dr. Naomi Whittaker');
    assert.deepEqual([...new Set(senders(stub))], ['"Dr. Naomi Whittaker" <naomi@rrmacademy.org>']);
  });

  it('builds a display sender from an unmapped author name', async () => {
    await send('u_other', 'Jane Doe');
    assert.deepEqual([...new Set(senders(stub))], ['"Jane Doe" <community@rrmacademy.org>']);
  });

  it('falls back to the club name when the author name is missing', async () => {
    await send('u_other', null);
    assert.deepEqual([...new Set(senders(stub))], ['"Save the Uterus Club" <community@rrmacademy.org>']);
    assert.match(htmlOf(stub.ses[0]), /<p><strong><\/strong> posted in the Save the Uterus Club community\.<\/p>/);
  });

  it('strips header-injection characters out of the sender display name', async () => {
    await send('u_other', 'Eve" <evil@attacker.test>, x\r\nBcc: victim@example.com');
    const from = senders(stub)[0];
    assert.ok(!/[\r\n]/.test(from), 'CR/LF must never survive into a From header');
    // The sanitizer removes the SYNTAX, not the text: what is left cannot close
    // the quoted display name, open a second angle-addr, or start a new header.
    const displayName = /^"([^"]*)" <community@rrmacademy\.org>$/.exec(from);
    assert.ok(displayName, `From is not a single well-formed mailbox: ${from}`);
    assert.ok(!/["<>,;:\\()[\]]/.test(displayName[1]),
      'no RFC 5322 special may survive inside the quoted display name');
    assert.equal(from.split('<').length, 2, 'exactly one angle-addr may appear');
    assert.equal(from, '"Eve evil@attacker.test xBcc victim@example.com" <community@rrmacademy.org>');
  });

  it('clamps a very long sender display name', async () => {
    await send('u_other', 'N'.repeat(200));
    const from = senders(stub)[0];
    assert.equal(from, `"${'N'.repeat(76)}" <community@rrmacademy.org>`);
  });

  it('escapes the author name where it lands in the HTML body', async () => {
    await send('u_other', 'A&B <script>alert(1)</script>');
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('<script>'), 'author-authored text must not become markup in the mail body');
    assert.match(html, /A&amp;B &lt;script&gt;/);
    assert.match(textOf(stub.ses[0]), /A&B <script>alert\(1\)<\/script> posted/,
      'the plain-text part carries the raw name, which is correct for text/plain');
  });

  it('flattens CR, LF and tabs out of the subject line and clamps it to 200 characters', async () => {
    await send('u_other', 'Line1\r\nBcc: victim@example.com\tTabbed   ' + 'z'.repeat(300));
    const subject = subjects(stub)[0];
    assert.ok(!/[\r\n\t]/.test(subject), 'a subject header must not carry control characters');
    assert.equal(subject.length, 200);
    assert.match(subject, /^Line1 Bcc: victim@example\.com Tabbed z+$/);
  });
});

// ================================================= notifyNewPost: events ===

describe('_email.js notifyNewPost -- an event post', () => {
  let harness, stub, clock;
  // 2026-08-05T01:00:00Z is a WEDNESDAY in UTC and a TUESDAY (9:00 PM) in New York.
  const TUESDAY_NIGHT_ET = '2026-08-05T01:00:00.000Z';

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: BRIAN_ID, email: 'brian@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'm1', email: 'm1@example.com', kind: 'wix', firstName: 'Wanda' });
    });
    stub = stubExternalFetch();
    clock = collapseTrickleDelay();
  });
  afterEach(() => { clock.restore(); stub.restore(); harness.close(); });

  const sendEvent = (post) =>
    notifyNewPost(envFor(harness), harness, { id: 'p1', authorId: BRIAN_ID, type: 'event', ...post }, 'Brian Whittaker');

  it('always sends from Dr. Naomi Whittaker, whichever admin created the event', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET });
    assert.equal(senders(stub)[0], '"Dr. Naomi Whittaker" <community@rrmacademy.org>',
      'an event blast is the face of the club, not the operator who posted it');
  });

  it('puts the Eastern weekday in the subject, not the UTC one', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
    assert.equal(new Date(TUESDAY_NIGHT_ET).getUTCDay(), 3, 'the fixture really is a Wednesday in UTC');
  });

  it('appends the speaker to the subject when there is one', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, speaker: '  Dr. Jane Roe  ' });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A with Dr. Jane Roe');
    assert.match(htmlOf(stub.ses[0]), /<p>With <strong>Dr\. Jane Roe<\/strong><\/p>/);
    assert.match(textOf(stub.ses[0]), /With Dr\. Jane Roe/);
  });

  it('ignores a non-string speaker', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, speaker: 12345 });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
    assert.ok(!htmlOf(stub.ses[0]).includes('With <strong>'));
  });

  it('does not double the club prefix when the title already starts with it', async () => {
    await sendEvent({ title: 'Save the Uterus Club: Endo Q&A', event_date: TUESDAY_NIGHT_ET });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
  });

  it('falls back to a generic title when the title is nothing but the prefix', async () => {
    await sendEvent({ title: 'Save the Uterus Club', event_date: TUESDAY_NIGHT_ET });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: New Save the Uterus Club event');
  });

  it('falls back to a generic title when there is no title at all', async () => {
    await sendEvent({ title: '', event_date: TUESDAY_NIGHT_ET });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: New Save the Uterus Club event');
    assert.match(htmlOf(stub.ses[0]), /<strong>New Save the Uterus Club event<\/strong>/);
  });

  it('drops the weekday from subject and opener when there is no event date', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: null });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event: Endo Q&A');
    assert.match(htmlOf(stub.ses[0]), /Our next Save the Uterus Club live call is coming up, and you are invited\./);
    assert.ok(!htmlOf(stub.ses[0]).includes('<p>When:'), 'no date means no When line');
  });

  it('drops the weekday when the event date is unparseable', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: 'not-a-date' });
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event: Endo Q&A');
    assert.ok(!htmlOf(stub.ses[0]).includes('<p>When:'));
  });

  it('renders a Eastern-time When line and a dated opener', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET });
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /<p>When: Tuesday, August 4[^<]*Eastern<\/p>/);
    assert.match(html, /live call is this Tuesday, August 4[^<]*Eastern, and you are invited\./);
    assert.match(textOf(stub.ses[0]), /When: Tuesday, August 4/);
  });

  it('greets each member by name and links to the gated post', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET });
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /<p>Hi Wanda,<\/p>/);
    assert.match(html, /Sign in to the community to view the link and join\./);
    assert.match(html, /href="https:\/\/rrmacademy\.org\/community\/post\/p1"/);
  });

  it('keeps the Meet link, the "Join Google Meet" line and the dial-in out of the teaser', async () => {
    await sendEvent({
      title: 'Endo Q&A',
      event_date: TUESDAY_NIGHT_ET,
      body: [
        'We will cover surgical options.',
        'Join Google Meet: click below',
        'https://meet.google.com/abc-defg-hij',
        'Phone: +1 555-000-1111 PIN: 123456#',
        'Bring questions.',
      ].join('\n'),
    });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('meet.google.com'), 'the Meet URL must never ride in the notification preview');
    assert.ok(!html.includes('555-000-1111'), 'the dial-in must never ride in the notification preview');
    assert.ok(!html.includes('PIN'));
    assert.match(html, /We will cover surgical options\. Bring questions\./);
  });

  it('flattens flyer image markdown and unwraps link markdown in the teaser', async () => {
    await sendEvent({
      title: 'Endo Q&A',
      event_date: TUESDAY_NIGHT_ET,
      body: '![flyer](https://cdn.example.com/flyer.png) See the [full agenda](https://example.com/agenda) first.',
    });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('cdn.example.com'), 'the image URL must not leak into the teaser');
    assert.ok(!html.includes('example.com/agenda'), 'the link target must not leak into the teaser');
    assert.match(html, /See the full agenda first\./);
  });

  it('truncates a long teaser at 250 characters with an ellipsis', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, body: 'w'.repeat(400) });
    const html = htmlOf(stub.ses[0]);
    const teaser = /<p>(w+…)<\/p>/.exec(html);
    assert.ok(teaser, 'expected a truncated teaser paragraph');
    assert.equal(teaser[1].length, 251, '250 characters plus the ellipsis');
  });

  it('emits no teaser paragraph when the body is empty or scrubs to nothing', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, body: '' });
    assert.ok(!/<p>[^<]*…<\/p>/.test(htmlOf(stub.ses[0])));
    const before = stub.ses.length;
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, body: 'https://meet.google.com/abc-defg-hij' });
    const html = htmlOf(stub.ses[before]);
    assert.ok(!html.includes('meet.google.com'));
    assert.match(html, /<strong>Endo Q&amp;A<\/strong><\/p>\s*<p>When:/, 'nothing should sit between the title and the date');
  });

  it('strips HTML out of a body that contains markup', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, body: '<b>Bold</b> and <img src=x onerror=alert(1)> more' });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('onerror'), 'member-authored markup must not survive into the mail body');
    assert.match(html, /<p>Bold and more<\/p>/);
  });

  it('escapes the event title where it lands in the HTML body', async () => {
    await sendEvent({ title: 'Q&A <script>alert(1)</script>', event_date: TUESDAY_NIGHT_ET });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('<script>'));
    assert.match(html, /Q&amp;A &lt;script&gt;/);
  });

  it('ignores a non-string body', async () => {
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, body: { not: 'a string' } });
    assert.equal(stub.ses.length, 1);
    assert.ok(!htmlOf(stub.ses[0]).includes('[object Object]'));
  });
});

// ============================= notifyNewPost: near vs far event phrasing ===

describe('_email.js notifyNewPost -- near vs far event phrasing', () => {
  let harness, stub, clock;
  // 2026-08-05T01:00:00Z is Tuesday, August 4 (9:00 PM) in America/New_York --
  // same fixture as the "an event post" suite above. `now` values below use
  // T12:00:00Z so the ET calendar date matches the UTC calendar date, keeping
  // the day-diff arithmetic easy to reason about in the test itself.
  const TUESDAY_NIGHT_ET = '2026-08-05T01:00:00.000Z';

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: BRIAN_ID, email: 'brian@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'm1', email: 'm1@example.com', kind: 'wix', firstName: 'Wanda' });
    });
    stub = stubExternalFetch();
    clock = collapseTrickleDelay();
  });
  afterEach(() => { clock.restore(); stub.restore(); harness.close(); });

  const sendEvent = (post, now) =>
    notifyNewPost(envFor(harness), harness, { id: 'p1', authorId: BRIAN_ID, type: 'event', ...post }, 'Brian Whittaker', now);

  it('keeps "this Tuesday" phrasing when the event is a few days out', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z').getTime(); // 3 days before, ET
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, now);
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
    assert.match(htmlOf(stub.ses[0]), /live call is this Tuesday, August 4[^<]*Eastern, and you are invited\./);
  });

  it('keeps "this Tuesday" phrasing for a same-day event (0 days out)', async () => {
    const now = new Date('2026-08-04T12:00:00.000Z').getTime(); // same ET calendar day
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, now);
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
  });

  it('keeps "this Tuesday" phrasing at the 6-days-out boundary (still near)', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z').getTime(); // 6 days before, ET
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, now);
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
    assert.match(htmlOf(stub.ses[0]), /live call is this Tuesday, August 4/);
  });

  it('switches to "Tuesday, August 4" phrasing at the exact 7-days-out boundary', async () => {
    const now = new Date('2026-07-28T12:00:00.000Z').getTime(); // exactly 7 days before, ET
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, now);
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event Tuesday, August 4: Endo Q&A');
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /live call is Tuesday, August 4[^<]*Eastern, and you are invited\./);
    assert.ok(!/is this Tuesday/.test(html), 'a 7-day-out event must not say "this Tuesday"');
    assert.ok(!/on Tuesday/.test(html), 'far phrasing must not add "on" either');
  });

  it('uses "Tuesday, August 4" phrasing for an event two weeks out', async () => {
    const now = new Date('2026-07-21T12:00:00.000Z').getTime(); // 14 days before, ET
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, speaker: 'Dr. Jane Roe' }, now);
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event Tuesday, August 4: Endo Q&A with Dr. Jane Roe');
    assert.match(htmlOf(stub.ses[0]), /Our next Save the Uterus Club live call is Tuesday, August 4[^<]*Eastern, and you are invited\./);
  });

  it('keeps "this Tuesday" phrasing for a past event date (unchanged fallback)', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z').getTime(); // 16 days AFTER the event
    await sendEvent({ title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, now);
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
    assert.match(htmlOf(stub.ses[0]), /live call is this Tuesday, August 4/);
  });
});

describe('_email.js notifyNewPost -- defensive date-formatting fallbacks', () => {
  let harness, stub, clock, realIntl;
  const TUESDAY_NIGHT_ET = '2026-08-05T01:00:00.000Z';

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: BRIAN_ID, email: 'brian@example.com', kind: 'staff', role: 'admin' });
      addUser(s, { id: 'm1', email: 'm1@example.com', kind: 'wix' });
    });
    stub = stubExternalFetch();
    clock = collapseTrickleDelay();
    realIntl = Intl.DateTimeFormat;
  });
  afterEach(() => { Intl.DateTimeFormat = realIntl; clock.restore(); stub.restore(); harness.close(); });

  it('falls back to the undated copy when every Intl format throws', async () => {
    Intl.DateTimeFormat = function () { throw new Error('ICU data unavailable'); };
    await notifyNewPost(envFor(harness), harness,
      { id: 'p1', authorId: BRIAN_ID, type: 'event', title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, 'Brian');
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event: Endo Q&A');
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /live call is coming up, and you are invited\./);
    assert.ok(!html.includes('<p>When:'), 'formatEventDate must degrade to no date line rather than throwing');
  });

  it('keeps the weekday but drops the time when only the time-only format throws', async () => {
    // The opener asks for a month/day/time format with NO weekday key; make just
    // that one fail so `weekday` still resolves and the inner catch is the branch
    // under test.
    Intl.DateTimeFormat = function (locale, options) {
      if (options && !options.weekday) throw new Error('pattern unavailable');
      return new realIntl(locale, options);
    };
    await notifyNewPost(envFor(harness), harness,
      { id: 'p1', authorId: BRIAN_ID, type: 'event', title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET }, 'Brian');
    assert.equal(subjects(stub)[0], 'Save the Uterus Club live event this Tuesday: Endo Q&A');
    assert.match(htmlOf(stub.ses[0]), /live call is this Tuesday, and you are invited\./);
  });
});

// ========================================================= share-link mail ===

describe('_email.js notifyEventShareLink', () => {
  let harness, stub;
  const TUESDAY_NIGHT_ET = '2026-08-05T01:00:00.000Z';

  beforeEach(() => { harness = db(() => {}); stub = stubExternalFetch(); });
  afterEach(() => { stub.restore(); harness.close(); });

  const notify = (post) => notifyEventShareLink(envFor(harness), harness, post);

  it('sends nothing for a non-event post', async () => {
    await notify({ id: 'p1', type: 'discussion', slug: 'x', title: 'T' });
    assert.equal(stub.ses.length, 0);
  });

  it('sends nothing and logs when the event has no slug', async () => {
    const env = envFor(harness);
    await notifyEventShareLink(env, harness, { id: 'p1', type: 'event', slug: null, title: 'T' });
    assert.equal(stub.ses.length, 0);
    assert.ok(env._events.find(e => e.blobs?.includes('share_link_skipped_no_slug')));
  });

  it('goes to exactly one recipient -- the operator, not the roster', async () => {
    await notify({ id: 'p1', type: 'event', slug: 'endo-qa', title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET });
    assert.deepEqual(toAddresses(stub), [NAOMI_PERSONAL],
      'the share-link mail carries an unreleased public URL; it must not fan out to members');
    assert.equal(senders(stub)[0], '"RRM Academy Events" <community@rrmacademy.org>');
    assert.equal(stub.ses[0].body.ReplyToAddresses[0], 'administrator@rrmacademy.org');
  });

  it('carries the public /events/<slug>/ link and the personal greeting', async () => {
    await notify({ id: 'p1', type: 'event', slug: 'endo-qa', title: 'Endo Q&A' });
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /<p>Hi Dr\. Whittaker,<\/p>/);
    assert.match(html, /href="https:\/\/rrmacademy\.org\/events\/endo-qa\/"/);
    assert.match(textOf(stub.ses[0]), /https:\/\/rrmacademy\.org\/events\/endo-qa\//);
  });

  it('names the event in the subject, and falls back when it is untitled', async () => {
    await notify({ id: 'p1', type: 'event', slug: 'endo-qa', title: 'Endo Q&A' });
    assert.equal(subjects(stub)[0], 'Shareable link ready: Endo Q&A');
    await notify({ id: 'p2', type: 'event', slug: 'untitled', title: '' });
    assert.equal(subjects(stub)[1], 'Shareable link ready: new Save the Uterus Club event');
    assert.match(htmlOf(stub.ses[1]), /<strong>new Save the Uterus Club event<\/strong>/);
  });

  it('includes the When and Speaker lines only when those fields exist', async () => {
    await notify({ id: 'p1', type: 'event', slug: 'a', title: 'A', event_date: TUESDAY_NIGHT_ET, speaker: ' Dr. Roe ' });
    const withBoth = htmlOf(stub.ses[0]);
    assert.match(withBoth, /<strong>When:<\/strong> Tuesday, August 4/);
    assert.match(withBoth, /<strong>Speaker:<\/strong> Dr\. Roe/);
    assert.match(textOf(stub.ses[0]), /Speaker: Dr\. Roe/);

    await notify({ id: 'p2', type: 'event', slug: 'b', title: 'B' });
    const withNeither = htmlOf(stub.ses[1]);
    assert.ok(!withNeither.includes('When:'));
    assert.ok(!withNeither.includes('Speaker:'));
  });

  it('composes a suggested caption from title, speaker and date', async () => {
    await notify({ id: 'p1', type: 'event', slug: 'a', title: 'Endo Q&A', event_date: TUESDAY_NIGHT_ET, speaker: 'Dr. Roe' });
    // The caption builder joins speaker and date with U+2014; the regex escapes it
    // so no literal em dash lives in this file.
    assert.match(textOf(stub.ses[0]), /Join us for "Endo Q&A" with Dr\. Roe \u2014 Tuesday, August 4[^\n]*\. Link in bio\./);
    await notify({ id: 'p2', type: 'event', slug: 'b', title: 'Plain' });
    assert.match(textOf(stub.ses[1]), /Join us for "Plain"\. Link in bio\./);
  });

  it('escapes the title and caption in the HTML part', async () => {
    await notify({ id: 'p1', type: 'event', slug: 'a', title: '<script>alert(1)</script> & more' });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/);
  });

  it('swallows a send failure instead of throwing at the caller', async () => {
    const failing = stubExternalFetch({ ses: () => ({ ok: false, status: 400, text: async () => 'SES down' }) });
    try {
      await assert.doesNotReject(() => notifyEventShareLink(envFor(harness), harness,
        { id: 'p1', type: 'event', slug: 'a', title: 'A' }));
    } finally { failing.restore(); }
  });
});

// ============================================================ reply mail ===

describe('_email.js notifyReply', () => {
  let harness, stub;

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: 'u_postauthor', email: 'postauthor@example.com', kind: 'wix', firstName: 'Pat' });
      addUser(s, { id: 'u_commentauthor', email: 'commentauthor@example.com', kind: 'wix' });
      addUser(s, { id: 'u_replier', email: 'replier@example.com', kind: 'wix' });
      addUser(s, { id: 'u_optout', email: 'optout@example.com', kind: 'wix', optOut: 1 });
      addUser(s, { id: 'u_blocked', email: 'blockedauthor@example.com', kind: 'wix', blocked: 1 });
      addPost(s, { id: 'p1', authorId: 'u_postauthor' });
      addPost(s, { id: 'p_optout', authorId: 'u_optout' });
      addPost(s, { id: 'p_blocked', authorId: 'u_blocked' });
      addComment(s, { id: 'c1', postId: 'p1', authorId: 'u_commentauthor' });
      addComment(s, { id: 'c_self', postId: 'p1', authorId: 'u_replier' });
    });
    stub = stubExternalFetch();
  });
  afterEach(() => { stub.restore(); harness.close(); });

  const reply = (postId, parentId, content = 'Thanks, that helps.') =>
    notifyReply(envFor(harness), harness, postId, parentId, 'u_replier', 'Robin', content);

  it('notifies the POST author when there is no parent comment', async () => {
    await reply('p1', null);
    assert.deepEqual(toAddresses(stub), ['postauthor@example.com']);
    assert.equal(subjects(stub)[0], 'Robin replied to your post in Save the Uterus Club');
    assert.match(htmlOf(stub.ses[0]), /replied to your post:/);
  });

  it('notifies the COMMENT author when a parent comment is given, not the post author', async () => {
    await reply('p1', 'c1');
    assert.deepEqual(toAddresses(stub), ['commentauthor@example.com'],
      'a threaded reply must reach the person replied to, not the thread starter');
    assert.equal(subjects(stub)[0], 'Robin replied to your comment in Save the Uterus Club');
  });

  it('sends nothing when the parent comment does not exist', async () => {
    await reply('p1', 'c_missing');
    assert.equal(stub.ses.length, 0);
  });

  it('sends nothing when the post does not exist', async () => {
    await reply('p_missing', null);
    assert.equal(stub.ses.length, 0);
  });

  it('never emails someone about their own reply', async () => {
    await reply('p1', 'c_self');
    assert.equal(stub.ses.length, 0);
  });

  it('respects the community email opt-out', async () => {
    await reply('p_optout', null);
    assert.equal(stub.ses.length, 0);
  });

  it('does not email a blocked account', async () => {
    await reply('p_blocked', null);
    assert.equal(stub.ses.length, 0, 'the recipient lookup filters blocked = 0');
  });

  it('greets by first name when there is one, and reads as ordinary copy when there is not', async () => {
    await reply('p1', null);
    assert.match(htmlOf(stub.ses[0]), /<p>Hi Pat,<\/p>/);
    await reply('p1', 'c1');
    assert.match(htmlOf(stub.ses[1]), /<p>Hi there,<\/p>/);
  });

  it('quotes the first 200 characters and marks longer replies as truncated', async () => {
    await reply('p1', null, 'x'.repeat(200));
    assert.ok(!/x{200}\.\.\./.test(htmlOf(stub.ses[0])), 'exactly 200 characters is not truncated');
    await reply('p1', null, 'y'.repeat(201));
    const quote = /<blockquote[^>]*>(y+)(\.\.\.)?<\/blockquote>/.exec(htmlOf(stub.ses[1]));
    assert.equal(quote[1].length, 200);
    assert.equal(quote[2], '...');
  });

  it('escapes the replier name and the quoted reply in the HTML part', async () => {
    await reply('p1', null, '<img src=x onerror=alert(1)>');
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('<img'), 'member-authored reply text must not become markup');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it('sends from the replier identity and links back to the community', async () => {
    await notifyReply(envFor(harness), harness, 'p1', null, BRIAN_ID, 'Brian Whittaker', 'hi');
    assert.equal(senders(stub)[0], '"Brian Whittaker" <brian@rrmacademy.org>');
    assert.match(htmlOf(stub.ses[0]), /href="https:\/\/rrmacademy\.org\/community\/"/);
    assert.match(textOf(stub.ses[0]), /View: https:\/\/rrmacademy\.org\/community\//);
  });

  it('records the send in email_log under the reply source', async () => {
    await reply('p1', null);
    const rows = emailLogRows(harness).filter(r => r.source === 'community/reply');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'send');
    assert.equal(rows[0].email, 'postauthor@example.com');
  });

  it('swallows a send failure instead of throwing at the caller', async () => {
    const failing = stubExternalFetch({ ses: () => ({ ok: false, status: 400, text: async () => 'SES down' }) });
    try {
      await assert.doesNotReject(() => reply('p1', null));
    } finally { failing.restore(); }
  });
});

/**
 * _email.js notifyCommentAlert -- the operator alert on every new STUC comment.
 *
 * THE FAILURE THAT MATTERS
 * Two things, and both are about WHO gets mail. (1) The alert list is an env
 * var, so an unset var must send to nobody rather than defaulting to someone;
 * (2) the commenter must never be alerted about her own comment, which is the
 * live case here because the sole configured recipient is also a club admin who
 * comments. Both assertions below are set equality over the SES payloads.
 *
 * WHAT IS FAKED
 * SES, via stubExternalFetch, exactly as the notifyReply suite above. The
 * workspace-lane pin is asserted once against a local Gmail/OAuth fetch router
 * (stubExternalFetch deliberately routes neither host); the lane's own fallback
 * and no-secrets behavior live in test/mail-lanes.test.js.
 */
describe('_email.js notifyCommentAlert', () => {
  const ALERT_TO = NAOMI_PERSONAL;
  let harness, stub;

  beforeEach(() => {
    harness = db((s) => {
      addUser(s, { id: 'u_talker', email: 'talker@example.com', kind: 'wix' });
      addUser(s, { id: NAOMI_ID, email: NAOMI_PERSONAL, kind: 'wix', role: 'admin' });
      addPost(s, { id: 'p_alert', authorId: 'u_talker', title: 'Cycle charting basics' });
      addPost(s, { id: 'p_alert_event', authorId: 'u_talker', type: 'event', title: 'March live call', slug: 'march-live-call' });
      // community_post.title is NOT NULL, so the empty-title case is '' (or blanks), never null.
      addPost(s, { id: 'p_alert_untitled', authorId: 'u_talker', title: '   ' });
    });
    stub = stubExternalFetch();
  });
  afterEach(() => { stub.restore(); harness.close(); });

  const alert = (overrides = {}, envOverrides = {}) =>
    notifyCommentAlert(
      envFor(harness, { COMMUNITY_COMMENT_ALERT_TO: ALERT_TO, ...envOverrides }),
      harness,
      {
        postId: 'p_alert',
        commentId: 'c_alert',
        commenterId: 'u_talker',
        commenterName: 'Robin',
        content: 'This finally made the mucus observations click for me.',
        ...overrides,
      }
    );

  it('mails every configured recipient exactly once', async () => {
    await alert({}, { COMMUNITY_COMMENT_ALERT_TO: `${ALERT_TO}, second@example.com` });
    assert.deepEqual(toAddresses(stub).sort(), ['naomimwhittaker@gmail.com', 'second@example.com']);
  });

  it('trims, lowercases and de-duplicates the configured list', async () => {
    await alert({}, { COMMUNITY_COMMENT_ALERT_TO: '  Naomimwhittaker@Gmail.com , naomimwhittaker@gmail.com ,,  ' });
    assert.deepEqual(toAddresses(stub), ['naomimwhittaker@gmail.com']);
  });

  it('sends nothing when COMMUNITY_COMMENT_ALERT_TO is unset', async () => {
    await notifyCommentAlert(envFor(harness), harness, {
      postId: 'p_alert', commentId: 'c1', commenterId: 'u_talker', commenterName: 'Robin', content: 'hi',
    });
    assert.deepEqual(toAddresses(stub), []);
  });

  it('sends nothing when COMMUNITY_COMMENT_ALERT_TO is empty or only separators', async () => {
    await alert({}, { COMMUNITY_COMMENT_ALERT_TO: '' });
    await alert({}, { COMMUNITY_COMMENT_ALERT_TO: ' , , ' });
    assert.deepEqual(toAddresses(stub), []);
  });

  it('never alerts the commenter about her own comment', async () => {
    await alert({ commenterId: NAOMI_ID, commenterName: 'Dr. Naomi Whittaker' });
    assert.deepEqual(toAddresses(stub), [], 'the sole recipient authored the comment');
  });

  it('still alerts the other recipients when one of them is the commenter', async () => {
    await alert(
      { commenterId: NAOMI_ID, commenterName: 'Dr. Naomi Whittaker' },
      { COMMUNITY_COMMENT_ALERT_TO: `${ALERT_TO},cohost@example.com` }
    );
    assert.deepEqual(toAddresses(stub), ['cohost@example.com']);
  });

  it('matches the commenter address case-insensitively', async () => {
    await alert({ commenterId: NAOMI_ID }, { COMMUNITY_COMMENT_ALERT_TO: 'NAOMIMWHITTAKER@GMAIL.COM' });
    assert.deepEqual(toAddresses(stub), []);
  });

  it('subject names the commenter and the post title', async () => {
    await alert();
    assert.equal(subjects(stub)[0], 'New STUC comment from Robin on "Cycle charting basics"');
  });

  it('sends the FULL comment text, not a truncated preview', async () => {
    const long = 'x'.repeat(600) + ' END';
    await alert({ content: long });
    assert.match(textOf(stub.ses[0]), /x{600} END/);
    assert.match(htmlOf(stub.ses[0]), /x{600} END/);
    assert.ok(!htmlOf(stub.ses[0]).includes('...'), 'the alert must never elide the comment');
  });

  it('escapes member-authored comment text and the commenter name', async () => {
    await alert({ commenterName: '<b>Robin</b>', content: '<img src=x onerror=alert(1)>' });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('<img'), 'comment text must not become markup');
    assert.ok(!html.includes('<b>Robin</b>'), 'the commenter name must not become markup');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it('links the post at its per-post URL and always offers the community reply link', async () => {
    await alert();
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /href="https:\/\/rrmacademy\.org\/community\/post\/p_alert">Cycle charting basics<\/a>/);
    assert.match(html, /href="https:\/\/rrmacademy\.org\/community\/">Reply in the community</);
    assert.match(textOf(stub.ses[0]), /https:\/\/rrmacademy\.org\/community\/post\/p_alert/);
    assert.match(textOf(stub.ses[0]), /Reply in the community: https:\/\/rrmacademy\.org\/community\//);
  });

  it('links an EVENT post by id too -- slug is an event-only column and must not steer the link', async () => {
    await alert({ postId: 'p_alert_event' });
    const html = htmlOf(stub.ses[0]);
    assert.match(html, /href="https:\/\/rrmacademy\.org\/community\/post\/p_alert_event">March live call<\/a>/);
    assert.ok(!html.includes('/events/'), 'the alert links the club thread, never the public event page');
  });

  it('still sends, titled "a post", when the post row is missing', async () => {
    await alert({ postId: 'p_does_not_exist' });
    assert.deepEqual(toAddresses(stub), [ALERT_TO]);
    assert.equal(subjects(stub)[0], 'New STUC comment from Robin on "a post"');
    // The link is built from the id we were handed, so it survives a missing row.
    assert.match(htmlOf(stub.ses[0]), /href="https:\/\/rrmacademy\.org\/community\/post\/p_does_not_exist">a post<\/a>/);
  });

  it('escapes a postId carrying quote characters instead of breaking out of the href', async () => {
    await alert({ postId: 'p" onmouseover="alert(1)' });
    const html = htmlOf(stub.ses[0]);
    assert.ok(!html.includes('onmouseover="alert(1)"'), 'a hostile id must not escape the href attribute');
    assert.match(html, /&quot; onmouseover=&quot;/);
  });

  it('titles a blank-titled post "a post" rather than an empty quote', async () => {
    await alert({ postId: 'p_alert_untitled' });
    assert.equal(subjects(stub)[0], 'New STUC comment from Robin on "a post"');
  });

  it('sends from the Save the Uterus Club identity and records the alert source in email_log', async () => {
    await alert();
    assert.equal(senders(stub)[0], '"Save the Uterus Club" <community@rrmacademy.org>');
    const rows = emailLogRows(harness).filter(r => r.source === 'community/comment-alert');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'send');
    assert.equal(rows[0].email, ALERT_TO);
  });

  it('swallows a send failure instead of throwing at the caller', async () => {
    const failing = stubExternalFetch({ ses: () => ({ ok: false, status: 400, text: async () => 'SES down' }) });
    try {
      await assert.doesNotReject(() => alert());
    } finally { failing.restore(); }
  });

  it('pins the Workspace lane: a Gmail recipient goes via the Gmail API with no MX lookup', async () => {
    // stubExternalFetch routes neither googleapis host, so this test supplies
    // its own router; the point is that lane:'workspace' reached the mailer.
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (input, init) => {
      const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
      seen.push(url);
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      if (url.includes('gmail.googleapis.com')) {
        return { ok: true, json: async () => ({ id: 'gmail-alert-1' }) };
      }
      throw new Error(`unrouted request to ${url}`);
    };
    try {
      await notifyCommentAlert(
        envFor(harness, {
          COMMUNITY_COMMENT_ALERT_TO: ALERT_TO,
          GOG_CLIENT_ID: 'cid', GOG_CLIENT_SECRET: 'secret', VA_GMAIL_REFRESH_TOKEN: 'refresh',
        }),
        harness,
        { postId: 'p_alert', commentId: 'c1', commenterId: 'u_talker', commenterName: 'Robin', content: 'hi' }
      );
      assert.equal(seen.filter(u => u.includes('cloudflare-dns.com')).length, 0, 'the pinned lane must skip the MX sniff');
      assert.equal(seen.filter(u => u.includes('gmail.googleapis.com')).length, 1);
      assert.equal(seen.filter(u => u.includes('amazonaws.com')).length, 0, 'a successful Gmail send must not also hit SES');
      const rows = emailLogRows(harness).filter(r => r.source === 'community/comment-alert');
      assert.equal(rows[0].detail, 'gmail:gmail-alert-1');
    } finally { globalThis.fetch = original; }
  });
});
