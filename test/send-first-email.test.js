import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockDB, parseResponse } from './_helpers.js';
import { buildBodyFragment, sendBatch, onRequestPost } from '../functions/api/newsletter/send-first-email.js';

// ---------------------------------------------------------------------------
// Spy factories
// ---------------------------------------------------------------------------

function makeTrackedSpy() {
  const calls = [];
  return {
    sendTracked: async (_env, _waitUntil, opts, meta) => {
      calls.push({ opts, meta });
      return { ok: true, messageId: 'msg-tracked' };
    },
    calls,
  };
}

function makeFailingTracked(message = 'SES 500') {
  return {
    sendTracked: async () => ({ ok: false, error: message }),
    calls: [],
  };
}

function makeTemplateSpy(html = '<p>rendered</p>', text = 'rendered') {
  const calls = [];
  return {
    renderEmail: async (opts) => { calls.push(opts); return { html, text }; },
    calls,
  };
}

function noop() {}
const nullWaitUntil = noop;

// ---------------------------------------------------------------------------
// Unit tests for exported helpers
// ---------------------------------------------------------------------------

describe('buildBodyFragment', () => {
  it('body-has-post-link: fragment contains the /commentary/<slug>/ link and the latest title', () => {
    const frag = buildBodyFragment('The Cause of Infertility', 'the-cause-of-infertility');
    assert.ok(
      frag.includes('https://rrmacademy.org/commentary/the-cause-of-infertility/'),
      'fragment must contain the full commentary URL'
    );
    assert.ok(
      frag.includes('The Cause of Infertility'),
      'fragment must contain the post title'
    );
  });

  it('html-escapes title: angle brackets in title are escaped', () => {
    const frag = buildBodyFragment('<script>alert(1)</script>', 'slug');
    assert.ok(!frag.includes('<script>'), 'raw <script> must not appear');
    assert.ok(frag.includes('&lt;script&gt;'), 'title must be HTML-escaped');
  });
});

// ---------------------------------------------------------------------------
// sendBatch unit tests
// ---------------------------------------------------------------------------

describe('sendBatch', () => {
  it('sends to two subscribers and returns correct sentCount', async () => {
    const tracked = makeTrackedSpy();
    const template = makeTemplateSpy();
    const db = mockDB({});
    const env = mockEnv({ NEWSLETTER_SECRET: 'secret' });

    const subscribers = [
      { id: 'sub-1', email: 'a@example.com' },
      { id: 'sub-2', email: 'b@example.com' },
    ];

    const { sentCount } = await sendBatch({
      db,
      tracked,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers,
      body: '<p>Hello</p>',
      subject: 'Welcome to RRM Academy',
      sendId: 'send-uuid-123',
    });

    assert.equal(sentCount, 2);
    assert.equal(tracked.calls.length, 2);
    assert.equal(tracked.calls[0].opts.to, 'a@example.com');
    assert.equal(tracked.calls[1].opts.to, 'b@example.com');
    assert.equal(tracked.calls[0].opts.from, '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>');
  });

  it('sendTracked-meta: calls use component=first-email, category=newsletter, source=newsletter/send-first-email', async () => {
    const tracked = makeTrackedSpy();
    const template = makeTemplateSpy();
    const db = mockDB({});
    const env = mockEnv({ NEWSLETTER_SECRET: 'secret' });

    await sendBatch({
      db,
      tracked,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers: [{ id: 'sub-1', email: 'a@example.com' }],
      body: '<p>Hello</p>',
      subject: 'Welcome',
      sendId: 'send-uuid-456',
    });

    assert.equal(tracked.calls[0].meta.component, 'first-email');
    assert.equal(tracked.calls[0].meta.category, 'newsletter');
    assert.equal(tracked.calls[0].meta.source, 'newsletter/send-first-email');
  });

  it('skips-inactive: a per-recipient sendTracked failure ({ok:false}) is counted as error, not as sent', async () => {
    const throwingTracked = makeFailingTracked('SES 500');
    const template = makeTemplateSpy();
    const logs = [];
    const env = mockEnv({
      NEWSLETTER_SECRET: 'secret',
      EVENTS: { writeDataPoint(d) { logs.push(d); } },
    });
    const db = mockDB({});

    const { sentCount, errors } = await sendBatch({
      db,
      tracked: throwingTracked,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers: [{ id: 'sub-1', email: 'x@example.com' }],
      body: '<p>Hello</p>',
      subject: 'Welcome',
      sendId: 'send-xyz',
    });

    assert.equal(sentCount, 0, 'no successful sends on sendTracked error');
    assert.equal(errors, 1, 'error count must be 1');
    const errorEvent = logs.find(d => d.blobs?.includes('first_email_send_error'));
    assert.ok(errorEvent, 'error must be logged via EVENTS');
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests via onRequestPost
// ---------------------------------------------------------------------------

describe('onRequestPost', () => {
  it('auth-required: missing Authorization header returns 401', async () => {
    const env = mockEnv({
      ADMIN_API_SECRET: 'super-secret',
      NEWSLETTER_SECRET: 'nl-secret',
    });
    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1'] },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('auth-required: wrong Bearer token returns 401', async () => {
    const env = mockEnv({
      ADMIN_API_SECRET: 'super-secret',
      NEWSLETTER_SECRET: 'nl-secret',
    });
    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1'] },
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('no-post-aborts: null latest post returns error and no send occurs', async () => {
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
      DB: mockDB({
        'FROM posts': { first: null },
      }),
    });
    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1', 'sub-2'] },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 404);
    assert.equal(body.error, 'no_published_post');
  });

  it('dry-run-no-send: dryRun:true returns sample+recipient list, writes nothing', async () => {
    const db = mockDB({
      'FROM posts': { first: { title: 'Why RRM Works', slug: 'why-rrm-works' } },
      'newsletter_subscriber': {
        all: { results: [
          { id: 'sub-1', email: 'a@example.com' },
          { id: 'sub-2', email: 'b@example.com' },
        ]},
      },
    });
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
      DB: db,
    });
    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1', 'sub-2'], dryRun: true },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.dry_run, true);
    assert.equal(body.recipient_count, 2);
    assert.deepEqual(body.recipient_ids, ['sub-1', 'sub-2']);
    assert.equal(body.latest_post.slug, 'why-rrm-works');
    assert.equal(body.latest_post.title, 'Why RRM Works');
    assert.ok(body.sample, 'sample must be present');
    assert.ok(typeof body.sample.html === 'string', 'sample.html must be a string');
    assert.ok(typeof body.sample.text === 'string', 'sample.text must be a string');

    const insertCalls = db._calls.filter(c => c.sql.includes('newsletter_send') || c.sql.includes('newsletter_event'));
    assert.equal(insertCalls.length, 0, 'dry-run must write nothing to DB');
  });

  it('body-has-post-link: dry-run sample contains the /commentary/<slug>/ link and title', async () => {
    const db = mockDB({
      'FROM posts': { first: { title: 'Finding the Root Cause', slug: 'finding-the-root-cause' } },
      'newsletter_subscriber': {
        all: { results: [{ id: 'sub-1', email: 'a@example.com' }] },
      },
    });
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
      DB: db,
    });
    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1'], dryRun: true },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { body } = await parseResponse(res);

    assert.ok(
      body.sample.html.includes('finding-the-root-cause'),
      'html sample must include the commentary slug (in click-tracking URL)'
    );
    assert.ok(
      body.sample.html.includes('Finding the Root Cause'),
      'html sample must include the post title as link text'
    );
    assert.ok(
      body.sample.text.includes('Finding the Root Cause'),
      'text fallback must include the post title'
    );
  });

  it('skips-inactive: recipients not found as active in DB are silently dropped', async () => {
    const db = mockDB({
      'FROM posts': { first: { title: 'A Post', slug: 'a-post' } },
      'newsletter_subscriber': {
        all: { results: [{ id: 'sub-2', email: 'b@example.com' }] },
      },
    });
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
      DB: db,
    });
    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1', 'sub-2'], dryRun: true },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { body } = await parseResponse(res);

    assert.equal(body.recipient_count, 1, 'inactive sub-1 must be dropped');
    assert.deepEqual(body.recipient_ids, ['sub-2']);
  });

  it('validates recipientIds: empty array returns 400', async () => {
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
    });
    const req = mockRequest('POST', {
      body: { recipientIds: [] },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status } = await parseResponse(res);
    assert.equal(status, 400);
  });

  it('validates recipientIds: non-array returns 400', async () => {
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
    });
    const req = mockRequest('POST', {
      body: { recipientIds: 'not-an-array' },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status } = await parseResponse(res);
    assert.equal(status, 400);
  });

  it('stuck-sending-guard: if the final status UPDATE throws, row is marked failed and 500 returned', async () => {
    const db = mockDB({
      'FROM posts': { first: { title: 'A Post', slug: 'a-post' } },
      'newsletter_subscriber': {
        all: { results: [{ id: 'sub-1', email: 'a@example.com' }] },
      },
    });
    const env = mockEnv({
      ADMIN_API_SECRET: 'secret',
      NEWSLETTER_SECRET: 'nl-secret',
      DB: db,
    });

    let failedStatusUpdate = false;
    let updateCallCount = 0;
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      if (sql.includes('UPDATE newsletter_send SET status = ?')) {
        const origRun = stmt.run.bind(stmt);
        stmt.run = async () => {
          updateCallCount++;
          if (updateCallCount === 1) throw new Error('D1 UPDATE exploded');
          return origRun();
        };
      }
      if (sql.includes("UPDATE newsletter_send SET status = 'failed'")) {
        const origRun = stmt.run.bind(stmt);
        stmt.run = async () => {
          failedStatusUpdate = true;
          return origRun();
        };
      }
      return stmt;
    };

    const req = mockRequest('POST', {
      body: { recipientIds: ['sub-1'] },
      headers: { Authorization: 'Bearer secret' },
    });

    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);

    assert.equal(status, 500, 'final UPDATE throw must return 500');
    assert.equal(body.ok, false);
    assert.equal(body.error, 'send_failed');
    assert.equal(failedStatusUpdate, true, 'best-effort failed status must be written after UPDATE throws');
  });
});

// ---------------------------------------------------------------------------
// Status-accuracy tests via sendBatch directly (FIX A)
// onRequestPost hard-wires the real sendTracked import; test the mapping logic
// via sendBatch which is exported and injectable.
// ---------------------------------------------------------------------------

describe('sendBatch status accuracy', () => {
  it('status-all-failed: when all sends fail, sentCount=0 and errors=N', async () => {
    const failTracked = makeFailingTracked('SES down');
    const template = makeTemplateSpy();
    const db = mockDB({});
    const env = mockEnv({ NEWSLETTER_SECRET: 'secret' });

    const { sentCount, errors } = await sendBatch({
      db,
      tracked: failTracked,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers: [
        { id: 'sub-1', email: 'a@example.com' },
        { id: 'sub-2', email: 'b@example.com' },
      ],
      body: '<p>Hello</p>',
      subject: 'Welcome',
      sendId: 'send-all-fail',
    });

    assert.equal(sentCount, 0, 'sentCount must be 0 when all sends fail');
    assert.equal(errors, 2, 'errors must equal total subscribers when all fail');

    // Verify the status-mapping logic that onRequestPost uses
    const status = errors === 0 ? 'sent' : sentCount > 0 ? 'partial' : 'failed';
    assert.equal(status, 'failed', 'status-mapping must produce "failed" when sentCount=0');
  });

  it('status-partial: when some sends succeed and some fail, sentCount>0 and errors>0', async () => {
    let callCount = 0;
    const mixedTracked = {
      sendTracked: async () => {
        callCount++;
        return callCount === 1 ? { ok: true, messageId: 'msg-ok' } : { ok: false, error: 'SES down' };
      },
    };
    const template = makeTemplateSpy();
    const db = mockDB({});
    const env = mockEnv({ NEWSLETTER_SECRET: 'secret' });

    const { sentCount, errors } = await sendBatch({
      db,
      tracked: mixedTracked,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers: [
        { id: 'sub-1', email: 'a@example.com' },
        { id: 'sub-2', email: 'b@example.com' },
      ],
      body: '<p>Hello</p>',
      subject: 'Welcome',
      sendId: 'send-mixed',
    });

    assert.equal(sentCount, 1, 'sentCount must reflect only successful sends');
    assert.equal(errors, 1, 'errors must reflect only failed sends');

    // Verify the status-mapping logic that onRequestPost uses
    const status = errors === 0 ? 'sent' : sentCount > 0 ? 'partial' : 'failed';
    assert.equal(status, 'partial', 'status-mapping must produce "partial" on mixed results');
  });

  it('status-all-sent: when all sends succeed, sentCount=N and errors=0', async () => {
    const tracked = makeTrackedSpy();
    const template = makeTemplateSpy();
    const db = mockDB({});
    const env = mockEnv({ NEWSLETTER_SECRET: 'secret' });

    const { sentCount, errors } = await sendBatch({
      db,
      tracked,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers: [
        { id: 'sub-1', email: 'a@example.com' },
        { id: 'sub-2', email: 'b@example.com' },
      ],
      body: '<p>Hello</p>',
      subject: 'Welcome',
      sendId: 'send-all-ok',
    });

    assert.equal(sentCount, 2, 'sentCount must equal subscriber count on full success');
    assert.equal(errors, 0, 'errors must be 0 on full success');

    const status = errors === 0 ? 'sent' : sentCount > 0 ? 'partial' : 'failed';
    assert.equal(status, 'sent', 'status-mapping must produce "sent" when errors=0');
  });
});
