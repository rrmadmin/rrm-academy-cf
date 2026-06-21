import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockDB, parseResponse } from './_helpers.js';
import { buildBodyFragment, sendBatch, onRequestPost } from '../functions/api/newsletter/send-first-email.js';

// ---------------------------------------------------------------------------
// Spy factories
// ---------------------------------------------------------------------------

function makeSesSpy() {
  const calls = [];
  return {
    sendEmail: async (_env, opts) => { calls.push(opts); },
    calls,
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
  it('dry-run-no-send: sends to two subscribers and returns correct sentCount', async () => {
    const ses = makeSesSpy();
    const template = makeTemplateSpy();

    const db = mockDB({});
    const env = mockEnv({ NEWSLETTER_SECRET: 'secret' });

    const subscribers = [
      { id: 'sub-1', email: 'a@example.com' },
      { id: 'sub-2', email: 'b@example.com' },
    ];

    const { sentCount } = await sendBatch({
      db,
      ses,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers,
      body: '<p>Hello</p>',
      subject: 'Welcome to RRM Academy',
      sendId: 'send-uuid-123',
    });

    assert.equal(sentCount, 2);
    assert.equal(ses.calls.length, 2);
    assert.equal(ses.calls[0].to, 'a@example.com');
    assert.equal(ses.calls[1].to, 'b@example.com');
    assert.equal(ses.calls[0].from, '"Naomi Whittaker" <newsletter@mail.rrmacademy.org>');
  });

  it('skips-inactive: a per-recipient SES throw is logged and counted as error, not propagated', async () => {
    const throwingSes = {
      sendEmail: async () => { throw new Error('SES down'); },
      calls: [],
    };
    const template = makeTemplateSpy();

    const logs = [];
    const env = mockEnv({
      NEWSLETTER_SECRET: 'secret',
      EVENTS: { writeDataPoint(d) { logs.push(d); } },
    });

    const db = mockDB({});

    const { sentCount, errors } = await sendBatch({
      db,
      ses: throwingSes,
      template,
      env,
      waitUntil: nullWaitUntil,
      subscribers: [{ id: 'sub-1', email: 'x@example.com' }],
      body: '<p>Hello</p>',
      subject: 'Welcome',
      sendId: 'send-xyz',
    });

    assert.equal(sentCount, 0, 'no successful sends on SES error');
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
    const sesCalls = [];
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
    assert.equal(sesCalls.length, 0, 'no emails sent when no post exists');
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

    // The rendered HTML wraps rrmacademy.org links for click tracking, so the slug
    // appears URL-encoded in the r= parameter; assert on the encoded slug.
    assert.ok(
      body.sample.html.includes('finding-the-root-cause'),
      'html sample must include the commentary slug (in click-tracking URL)'
    );
    assert.ok(
      body.sample.html.includes('Finding the Root Cause'),
      'html sample must include the post title as link text'
    );
    // _template.js text fallback strips all HTML tags (href values are lost), so
    // the title appears as plain text -- the slug lives only in the html sample.
    assert.ok(
      body.sample.text.includes('Finding the Root Cause'),
      'text fallback must include the post title'
    );
  });

  it('skips-inactive: recipients not found as active in DB are silently dropped', async () => {
    // Only sub-2 is active; sub-1 is not in the active result set
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
});
