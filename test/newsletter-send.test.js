import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockDB, mockWaitUntil, parseResponse, stubExternalFetch } from './_helpers.js';
import { onRequestPost } from '../functions/api/newsletter/send.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds N active subscribers. When `failPrefix` is set, every even-indexed
 * subscriber's email is stamped with the prefix so a keyed SES override can
 * decide per-recipient success/failure deterministically (dispatch order
 * inside a Promise.allSettled batch isn't guaranteed, so keying off the
 * decoded "To:" header rather than call order keeps the test robust).
 */
function makeSubscribers(n, { failPrefix = null } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const idx = i + 1;
    const bad = failPrefix && idx % 2 === 0;
    return {
      id: `sub-${String(idx).padStart(3, '0')}`,
      email: bad ? `${failPrefix}${idx}@example.com` : `ok-${idx}@example.com`,
      name: null,
      segments: null,
    };
  });
}

function newsletterDb(subscribers) {
  return mockDB({
    'COUNT(*) as c FROM newsletter_subscriber': { first: { c: subscribers.length } },
    'SELECT id, email, name, segments FROM newsletter_subscriber': { all: { results: subscribers } },
    "SELECT status FROM newsletter_subscriber WHERE id = ?": { first: { status: 'active' } },
  });
}

/** Decodes the base64 SESv2 Raw MIME payload of an SES stub call back to text. */
function decodeRaw(call) {
  const b64 = call.body?.Content?.Raw?.Data;
  if (!b64) return '';
  return Buffer.from(b64, 'base64').toString('utf8');
}

function decodeToAddress(call) {
  const raw = decodeRaw(call);
  const m = raw.match(/^To: (.+)$/m);
  return m ? m[1].trim() : null;
}

function noop() {}
const nullWaitUntil = noop;

function baseEnv(overrides = {}) {
  return mockEnv({
    ADMIN_API_SECRET: 'secret',
    NEWSLETTER_SECRET: 'nl-secret',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Auth + validation (mirrors send-first-email.js's sibling coverage)
// ---------------------------------------------------------------------------

describe('onRequestPost - auth & validation', () => {
  it('auth-required: missing Authorization header returns 401', async () => {
    const env = baseEnv({ DB: newsletterDb([]) });
    const req = mockRequest('POST', { body: { subject: 'Hi', body: '<p>hi</p>' } });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('auth-required: wrong Bearer token returns 401', async () => {
    const env = baseEnv({ DB: newsletterDb([]) });
    const req = mockRequest('POST', {
      body: { subject: 'Hi', body: '<p>hi</p>' },
      headers: { Authorization: 'Bearer wrong' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('validates body: empty subject returns 400', async () => {
    const env = baseEnv({ DB: newsletterDb([]) });
    const req = mockRequest('POST', {
      body: { subject: '   ', body: '<p>hi</p>' },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status } = await parseResponse(res);
    assert.equal(status, 400);
  });

  it('validates cursor: malformed cursor returns 400', async () => {
    const env = baseEnv({ DB: newsletterDb([]) });
    const req = mockRequest('POST', {
      body: { subject: 'Hi', body: '<p>hi</p>', cursor: 'not valid!' },
      headers: { Authorization: 'Bearer secret' },
    });
    const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_cursor');
  });
});

// ---------------------------------------------------------------------------
// Happy path: correct SES configuration set + reply-to (Fix 1 + Fix 3)
// ---------------------------------------------------------------------------

describe('onRequestPost - happy path', () => {
  it('sends to all active subscribers using the real rrm-email config set + community reply-to', async () => {
    const subscribers = makeSubscribers(2);
    const db = newsletterDb(subscribers);
    const env = baseEnv({ DB: db });
    const stub = stubExternalFetch();

    try {
      const req = mockRequest('POST', {
        body: { subject: 'Hello', body: '<p>Hello world</p>' },
        headers: { Authorization: 'Bearer secret' },
      });
      const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
      const { status, body } = await parseResponse(res);

      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.done, true);
      assert.equal(body.sent, 2);

      assert.equal(stub.ses.length, 2, 'both subscribers must have hit SES');
      for (const call of stub.ses) {
        assert.equal(
          call.body.ConfigurationSetName,
          'rrm-email',
          'configurationSet must be the SES config set that actually exists (rrm-email, not rrm-newsletter)'
        );
        const raw = decodeRaw(call);
        assert.match(raw, /^Reply-To: community@rrmacademy\.org$/m, 'raw MIME must carry a Reply-To: community@rrmacademy.org header');
      }
    } finally {
      stub.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker (Fix 2): systemic SES failure must abort, not mark
// thousands of subscribers phantom-sent while delivering nothing.
// ---------------------------------------------------------------------------

describe('onRequestPost - circuit breaker on systemic SES failure', () => {
  it('aborts after the first batch when 100% of attempted sends fail', async () => {
    const subscribers = makeSubscribers(15); // more than one BATCH_SIZE (10)
    const db = newsletterDb(subscribers);
    const env = baseEnv({ DB: db });
    const stub = stubExternalFetch({
      ses: () => ({ ok: false, status: 400, text: async () => 'Configuration set <rrm-newsletter> does not exist' }),
    });

    try {
      const req = mockRequest('POST', {
        body: { subject: 'Hello', body: '<p>Hello world</p>' },
        headers: { Authorization: 'Bearer secret' },
      });
      const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
      const { status, body } = await parseResponse(res);

      assert.equal(status, 502);
      assert.equal(body.ok, false);
      assert.equal(body.error, 'ses_systemic_failure');
      assert.match(body.sesError, /does not exist/);
      assert.ok(body.sendId, 'sendId must be returned so the row can be inspected');
      assert.equal(body.sent, 0);

      assert.equal(
        stub.ses.length,
        10,
        'only the first batch (BATCH_SIZE=10) may be attempted -- the remaining 5 recipients must never be touched'
      );

      const failedStatusUpdate = db._calls.find(
        c => c.sql.includes("UPDATE newsletter_send SET status = 'failed'") && c.bound[0] === body.sendId
      );
      assert.ok(failedStatusUpdate, 'newsletter_send row must be marked failed on abort');

      const sentEventInserts = db._calls.filter(c => c.sql.includes("INSERT INTO newsletter_event") && c.sql.includes("'sent'"));
      assert.equal(sentEventInserts.length, 10, 'phantom sent rows must be bounded to the one failed batch, not all 15 recipients');
    } finally {
      stub.restore();
    }
  });

  it('aborts on a sustained ~50% failure rate once the minimum sample is reached, even without a literal 100% first batch', async () => {
    const subscribers = makeSubscribers(40, { failPrefix: 'bad-' }); // 4 batches' worth if unbounded
    const db = newsletterDb(subscribers);
    const env = baseEnv({ DB: db });
    const stub = stubExternalFetch({
      ses: (call) => {
        const to = decodeToAddress(call) || '';
        if (to.includes('bad-')) {
          return { ok: false, status: 400, text: async () => 'Email address is not verified' };
        }
        return { ok: true, status: 200, json: async () => ({ MessageId: 'mock-ses-message-id' }), text: async () => '{}' };
      },
    });

    try {
      const req = mockRequest('POST', {
        body: { subject: 'Hello', body: '<p>Hello world</p>' },
        headers: { Authorization: 'Bearer secret' },
      });
      const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
      const { status, body } = await parseResponse(res);

      assert.equal(status, 502);
      assert.equal(body.ok, false);
      assert.equal(body.error, 'ses_systemic_failure');
      assert.equal(body.sent, 10, 'the 10 non-"bad-" recipients across the first two batches must still count as sent');

      assert.equal(
        stub.ses.length,
        20,
        'must abort after 2 batches (20 attempts, 50% failure) instead of continuing through all 40 recipients'
      );
    } finally {
      stub.restore();
    }
  });

  it('does not abort when failures are isolated (below both thresholds)', async () => {
    const subscribers = makeSubscribers(10);
    const db = newsletterDb(subscribers);
    const env = baseEnv({ DB: db });
    let calls = 0;
    const stub = stubExternalFetch({
      ses: () => {
        calls++;
        // Exactly one of ten fails -- an isolated bad address, not a systemic problem.
        if (calls === 1) return { ok: false, status: 400, text: async () => 'MessageRejected' };
        return { ok: true, status: 200, json: async () => ({ MessageId: 'mock-ses-message-id' }), text: async () => '{}' };
      },
    });

    try {
      const req = mockRequest('POST', {
        body: { subject: 'Hello', body: '<p>Hello world</p>' },
        headers: { Authorization: 'Bearer secret' },
      });
      const res = await onRequestPost({ request: req, env, waitUntil: nullWaitUntil });
      const { status, body } = await parseResponse(res);

      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.sent, 9, 'one isolated failure must not trip the circuit breaker');
      assert.equal(stub.ses.length, 10, 'all 10 recipients in the single batch must still be attempted');
    } finally {
      stub.restore();
    }
  });
});
