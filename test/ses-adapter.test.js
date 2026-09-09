/**
 * functions/api/_ses.js as an ADAPTER over vendor/mail.
 *
 * The SigV4 block and the MIME builder moved into the package; what is tested
 * here is the seam: the purpose mapping, the exemption the newsletter path
 * claims, the lane the log row records, and the fact that every export kept
 * its old signature so thirty-odd call sites did not have to change.
 *
 * Both rails are intercepted at globalThis.fetch, the same place
 * test/mail-lanes.js intercepts them, because aws4fetch signs and then calls
 * the global and the Cloudflare rail calls it directly.
 *
 * SINCE 2026-09-09 THE DEFAULT RAIL IS CLOUDFLARE. Every sender in this repo
 * is on @mail.rrmacademy.org, the onboarded Email Sending subdomain, so the
 * lane rule resolves cf_rrm for them without a line changing at any call
 * site. SES is reachable two ways and only two: the apex from addresses (the
 * newsletter exemption's hello@rrmacademy.org above all) and the adapter's
 * `fallback: 'ses'`, which takes the SES leg when Cloudflare answers a 5xx or
 * nothing at all. A 4xx never falls back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockDB } from './_helpers.js';
import {
  sendEmail,
  sendRawEmail,
  sanitizeHeader,
  insertEmailLog,
  logEmailFailure,
} from '../functions/api/_ses.js';
import { resolveLane } from '../vendor/mail/index.js';

/**
 * Captures every SES call and answers with a MessageId.
 *
 * aws4fetch SIGNS into a Request and calls the global with that one argument,
 * so the payload is read off the Request body, not off an `init` that is not
 * there. Reading `init.body` finds null and every assertion about the payload
 * then passes vacuously, which is how a stub stops testing anything.
 */
function stubSes({ status = 200, body = '{"MessageId":"ses-adapter-1"}' } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const isRequest = input && typeof input === 'object' && typeof input.text === 'function';
    const url = isRequest || (input && typeof input === 'object' && input.url) ? input.url : String(input);
    const raw = init?.body ?? (isRequest ? await input.text() : null);
    calls.push({ url, payload: raw ? JSON.parse(raw) : null });
    return new Response(body, { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/**
 * Captures every Cloudflare Email Sending call and answers a queued send.
 *
 * A real queued send answers `success: true` with all three result arrays
 * empty and `message_id` the only evidence it left, so that is what this
 * returns; asserting on `delivered` would be asserting on something the live
 * endpoint does not send.
 */
function stubCf({ status = 200, body = { success: true, errors: [], result: { message_id: 'cf-adapter-1' } } } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const isRequest = input && typeof input === 'object' && typeof input.text === 'function';
    const url = isRequest || (input && typeof input === 'object' && input.url) ? input.url : String(input);
    const raw = init?.body ?? (isRequest ? await input.text() : null);
    calls.push({ url, payload: raw ? JSON.parse(raw) : null });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/**
 * Cloudflare first, SES second: what the adapter's `fallback: 'ses'` is for.
 * The first call is answered by `cf`, every later one by `ses`, which is the
 * shape of a Cloudflare outage during the watched week.
 */
function stubCfThenSes({ cfStatus = 503, sesBody = '{"MessageId":"ses-fallback-1"}' } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const isRequest = input && typeof input === 'object' && typeof input.text === 'function';
    const url = isRequest || (input && typeof input === 'object' && input.url) ? input.url : String(input);
    const raw = init?.body ?? (isRequest ? await input.text() : null);
    const rail = url.includes('/email/sending/send') ? 'cf' : 'ses';
    calls.push({ rail, url, payload: raw ? JSON.parse(raw) : null });
    if (rail === 'cf') return new Response('{"success":false,"errors":[{"message":"upstream"}]}', { status: cfStatus });
    return new Response(sesBody, { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function emailLogRows(db) {
  return db._calls.filter((c) => c.sql.includes('INSERT INTO email_log'));
}

// ---------------------------------------------------------------------------
// The exports, unchanged.
// ---------------------------------------------------------------------------

test('sanitizeHeader still THROWS, because callers use it as validation', () => {
  // _mail-lanes.js composes its own Workspace MIME with this. The package
  // strips instead; both behaviours are wanted, for different jobs.
  assert.throws(() => sanitizeHeader('Subject\r\nBcc: attacker@example.com'), /illegal control/);
  assert.throws(() => sanitizeHeader('nul\x00byte'), /illegal control/);
  assert.equal(sanitizeHeader('a plain subject'), 'a plain subject');
  assert.equal(sanitizeHeader('x'.repeat(1200)).length, 998);
});

test('insertEmailLog and logEmailFailure still write the nine-column row', async () => {
  const db = mockDB();
  await insertEmailLog(db, {
    event: 'send', email: 'A@B.C', category: 'transactional', source: 's',
    subject: 'subj', detail: 'd', send_id: 'i', ses_message_id: 'i', lane: 'ses_rrm',
  });
  const [row] = emailLogRows(db);
  assert.equal(row.bound[0], 'send');
  assert.equal(row.bound[1], 'a@b.c', 'the address is lowercased on the way in');
  assert.equal(row.bound[8], 'ses_rrm');

  const db2 = mockDB();
  await logEmailFailure(db2, { email: 'x@y.z', category: 'transactional', source: 's', subject: 't', detail: 'boom' });
  assert.equal(emailLogRows(db2)[0].bound[0], 'failed');
});

// ---------------------------------------------------------------------------
// Transactional: the ordinary path, unchanged in every visible way.
// ---------------------------------------------------------------------------

test('a transactional send reaches the Cloudflare rail and logs lane cf_rrm', async () => {
  const db = mockDB();
  const env = mockEnv({ DB: db });
  const stub = stubCf();
  try {
    const r = await sendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to: 'user@example.com',
      subject: 'Confirm your email',
      html: '<p>hi</p>',
      log: { db, category: 'transactional', source: 'auth/signup' },
    });
    assert.equal(r.messageId, 'cf-adapter-1');
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0].url, /\/email\/sending\/send$/);
    // The proven payload sends a BARE address, and html alone still gets a
    // derived text alternative, because a message with no text part is the
    // message most likely to be filed as bulk.
    assert.equal(stub.calls[0].payload.from, 'accounts@mail.rrmacademy.org');
    assert.equal(stub.calls[0].payload.to, 'user@example.com');
    assert.ok(stub.calls[0].payload.text, 'html alone still ships a text alternative');

    const [row] = emailLogRows(db);
    assert.equal(row.bound[0], 'send');
    assert.equal(row.bound[2], 'transactional', "the caller's own category, not the package's purpose");
    assert.equal(row.bound[3], 'auth/signup');
    assert.equal(row.bound[8], 'cf_rrm');
    assert.equal(row.bound[7], null, 'ses_message_id stays null on a Cloudflare send');
  } finally { stub.restore(); }
});

test('an apex from address still rides SES, which is the one-sender-at-a-time lever', async () => {
  const db = mockDB();
  const env = mockEnv({ DB: db });
  const stub = stubSes();
  try {
    const r = await sendEmail(env, {
      from: 'RRM Academy <receipts@rrmacademy.org>',
      to: 'user@example.com',
      subject: 'Your receipt',
      html: '<p>hi</p>',
      log: { db, category: 'transactional', source: 'billing/receipt' },
    });
    assert.equal(r.messageId, 'ses-adapter-1');
    assert.ok(stub.calls[0].payload.Content.Simple, 'no custom headers means Simple, not Raw');
    assert.equal(emailLogRows(db)[0].bound[8], 'ses_rrm');
  } finally { stub.restore(); }
});

test('a Cloudflare 5xx falls back to SES and records which rail it came from', async () => {
  const db = mockDB();
  const env = mockEnv({ DB: db });
  const stub = stubCfThenSes();
  try {
    const r = await sendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to: 'user@example.com',
      subject: 'Confirm your email',
      text: 'hi',
      log: { db, category: 'transactional', source: 'auth/signup' },
    });
    assert.equal(r.messageId, 'ses-fallback-1');
    assert.deepEqual(stub.calls.map((c) => c.rail), ['cf', 'ses'], 'Cloudflare first, then the SES leg');
    assert.equal(emailLogRows(db)[0].bound[8], 'ses_rrm', 'the row records the rail that actually sent');
  } finally { stub.restore(); }
});

test('a send failure is a THROW, which is what every call site catches', async () => {
  const env = mockEnv();
  // 400, not 500: a 4xx is a request the far side will refuse identically
  // tomorrow, so it must NOT reach SES over the fallback. Sending it there
  // would deliver a message the newer rail deliberately would not.
  const stub = stubCfThenSes({ cfStatus: 400 });
  try {
    await assert.rejects(
      () => sendEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: 'user@example.com',
        subject: 's',
        text: 't',
      }),
      /SES request failed \(cf-email-error, status 400\)/,
    );
    assert.deepEqual(stub.calls.map((c) => c.rail), ['cf'], 'a 4xx never falls back');
  } finally { stub.restore(); }
});

test('missing SES credentials still throw before anything is attempted', async () => {
  const stub = stubSes();
  try {
    await assert.rejects(
      () => sendEmail({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' }, {
        from: 'x@mail.rrmacademy.org', to: 'a@b.c', subject: 's', text: 't',
      }),
      /AWS SES credentials not configured/,
    );
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

test('a send with no log db writes no row and still sends', async () => {
  const env = mockEnv();
  const stub = stubCf();
  try {
    const r = await sendEmail(env, {
      from: 'RRM Academy <alerts@mail.rrmacademy.org>',
      to: 'administrator@rrmacademy.org',
      subject: 's',
      text: 't',
      purpose: 'system',
    });
    assert.equal(r.messageId, 'cf-adapter-1');
    assert.equal(stub.calls.length, 1);
  } finally { stub.restore(); }
});

// ---------------------------------------------------------------------------
// The purpose mapping, which is the whole of the adapter's judgement.
// ---------------------------------------------------------------------------

test("the _google-ads alert is purpose 'system', which rides cf_rrm from the mail subdomain", () => {
  assert.equal(
    resolveLane({ entity: 'rrma', purpose: 'system', from: 'RRM Academy <alerts@mail.rrmacademy.org>' }),
    'cf_rrm',
  );
  // The same purpose from the apex is the SES half of the same rule.
  assert.equal(
    resolveLane({ entity: 'rrma', purpose: 'system', from: 'RRM Academy <alerts@rrmacademy.org>' }),
    'ses_rrm',
  );
});

test('an unrecognised log category falls back to transactional rather than refusing', async () => {
  const db = mockDB();
  const env = mockEnv({ DB: db });
  const stub = stubCf();
  try {
    // 'receipt' is a real package purpose, but this adapter does not map it:
    // an unknown category must not turn a working send into a refusal.
    const r = await sendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to: 'user@example.com',
      subject: 's',
      text: 't',
      log: { db, category: 'receipt', source: 'billing/webhook' },
    });
    assert.equal(r.messageId, 'cf-adapter-1');
    assert.equal(emailLogRows(db)[0].bound[2], 'receipt', 'the row still records what the caller called it');
  } finally { stub.restore(); }
});

// ---------------------------------------------------------------------------
// The newsletter, which is the exemption's reason for existing. Proved by
// unit test and NEVER by sending one.
// ---------------------------------------------------------------------------

test('a newsletter send claims the newsletter-blast exemption and resolves ses_rrm', () => {
  // The rule the adapter depends on, asserted against the package directly:
  // without the exemption this exact message is refused to the Workspace lane.
  const msg = {
    entity: 'rrma',
    purpose: 'newsletter',
    from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
  };
  assert.throws(() => resolveLane(msg), /workspace-lane-only/);
  assert.equal(resolveLane({ ...msg, exemption: 'newsletter-blast' }), 'ses_rrm');
});

test('sendRawEmail passes exemption newsletter-blast and goes out as Raw MIME', async () => {
  const db = mockDB();
  const env = mockEnv({ DB: db });
  const stub = stubSes();
  try {
    const r = await sendRawEmail(env, {
      from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
      to: 'member@example.com',
      subject: 'The September letter',
      html: '<p>hi</p>',
      text: 'hi',
      headers: { 'List-Unsubscribe': '<https://rrmacademy.org/unsub>' },
      replyTo: 'community@rrmacademy.org',
      configurationSet: 'rrm-email',
      log: { db, source: 'newsletter/send', category: 'newsletter' },
    });
    assert.equal(r.messageId, 'ses-adapter-1');

    const payload = stub.calls[0].payload;
    assert.ok(payload.Content.Raw, 'custom headers switch the rail to Raw');
    assert.equal(payload.ConfigurationSetName, 'rrm-email');
    const mime = atob(payload.Content.Raw.Data);
    assert.match(mime, /^List-Unsubscribe: <https:\/\/rrmacademy\.org\/unsub>$/m);
    assert.match(mime, /^Precedence: bulk$/m);
    assert.match(mime, /^Reply-To: community@rrmacademy\.org$/m);

    // The log row names the exemption, because a list send reaching SES at all
    // is the thing a reader of email_log needs to be able to account for.
    const [row] = emailLogRows(db);
    assert.equal(row.bound[2], 'newsletter');
    assert.equal(row.bound[3], 'newsletter/send (newsletter-blast)');
    assert.equal(row.bound[8], 'ses_rrm');
  } finally { stub.restore(); }
});

test('a newsletter send from an address the exemption does not cover is REFUSED', async () => {
  const db = mockDB();
  const env = mockEnv({ DB: db });
  const stub = stubSes();
  try {
    await assert.rejects(
      () => sendRawEmail(env, {
        from: '"Save the Uterus Club" <community@rrmacademy.org>',
        to: 'member@example.com',
        subject: 's',
        html: '<p>hi</p>',
        headers: { 'List-Unsubscribe': '<https://rrmacademy.org/unsub>' },
        log: { db, source: 'newsletter/send', category: 'newsletter' },
      }),
      /exemption-sender-not-allowed/,
    );
    assert.equal(stub.calls.length, 0, 'a refused send never reaches SES');
  } finally { stub.restore(); }
});

test('sendRawEmail refuses a headerless call rather than silently sending Simple', async () => {
  const env = mockEnv();
  const stub = stubSes();
  try {
    await assert.rejects(
      () => sendRawEmail(env, {
        from: '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>',
        to: 'member@example.com',
        subject: 's',
        html: '<p>hi</p>',
      }),
      /requires headers/,
    );
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); }
});

// ---------------------------------------------------------------------------
// The refusal this whole package exists for, still standing in this repo.
// ---------------------------------------------------------------------------

test('RRM community and member mail is still refused to the Workspace lane', () => {
  assert.throws(
    () => resolveLane({ entity: 'rrma', purpose: 'community', from: 'community@rrmacademy.org' }),
    /workspace-lane-only/,
  );
  assert.throws(
    () => resolveLane({ entity: 'rrma', purpose: 'member', from: 'community@rrmacademy.org' }),
    /workspace-lane-only/,
  );
  // And the STUC exemption, which this repo does not use, is bound to that
  // one mailbox, so the name alone opens nothing.
  assert.equal(
    resolveLane({
      entity: 'rrma', purpose: 'member', from: 'community@rrmacademy.org', exemption: 'stuc-overdue-outreach',
    }),
    'ses_rrm',
  );
  assert.throws(
    () => resolveLane({
      entity: 'rrma', purpose: 'member', from: 'accounts@mail.rrmacademy.org', exemption: 'stuc-overdue-outreach',
    }),
    /exemption-sender-not-allowed/,
  );
});

test('an unknown exemption name refuses, it does not fall through', () => {
  assert.throws(
    () => resolveLane({
      entity: 'rrma', purpose: 'newsletter', from: 'hello@rrmacademy.org', exemption: 'fall-campaign',
    }),
    /unknown-exemption/,
  );
});
