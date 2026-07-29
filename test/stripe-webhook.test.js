/**
 * EXECUTED tests for POST /api/stripe-webhook (functions/api/stripe-webhook.js)
 * and the two-phase dedup envelope in functions/api/billing/_shared.js.
 *
 * HISTORY. Until 2026-07-28 this file read stripe-webhook.js and its sub-handlers
 * with readFileSync and asserted on source TEXT. Every assertion passed while the
 * dispatcher, the dedup envelope and handleCheckoutCompleted (CRAP #1: cyclomatic
 * complexity 210, 41 prior /arise findings) all reported 0% line coverage. The
 * suite looked like it covered the payment surface and covered none of it.
 *
 * The reason it was written that way was real: the module graph could not be
 * imported under `node --test` (see test/_json-module-hook.mjs). With that
 * blocker removed, everything below runs the actual handler:
 *   - signatures are REAL HMAC-SHA256 Stripe signatures verified by the real
 *     stripe SDK, so a tampered body or a stale timestamp is rejected for the
 *     same reason it would be in production;
 *   - webhook_event is a working in-memory table with the real two-phase
 *     columns, so replay, in-flight and crashed-attempt reclaim are exercised
 *     rather than described.
 *
 * The source-level assertions that remain justified live in
 * test/billing-source-invariants.test.js, each with its reason.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import './_json-module-hook.mjs';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch, stripeRoutes } from './_helpers.js';

const { onRequestPost } = await import('../functions/api/stripe-webhook.js');

const WEBHOOK_SECRET = 'whsec_test_secret';
const nowSec = () => Math.floor(Date.now() / 1000);

// The refund handler mails the administrator on a successful revocation. Without
// this the suite makes a real request to AWS SES on every run (it did, once,
// during development -- SES answered 403 and nothing failed). stubExternalFetch
// throws on any host it does not route, so a new egress path fails loudly.
let net;
before(() => { net = stubExternalFetch(); });
after(() => { net.restore(); });

/**
 * An in-memory `webhook_event` table with the real two-phase columns, plus
 * pass-through defaults for every other statement. Using a real table (rather
 * than a canned response per SQL substring) is what lets the reclaim path --
 * DELETE, re-INSERT, reprocess -- be exercised end to end.
 */
function webhookDb({ rows = new Map(), forceChanges = {}, fail = {}, firstRows = {} } = {}) {
  const calls = [];

  function forced(sql) {
    for (const [needle, changes] of Object.entries(forceChanges)) {
      if (sql.includes(needle)) return changes;
    }
    return undefined;
  }
  function maybeFail(sql) {
    for (const [needle, message] of Object.entries(fail)) {
      if (sql.includes(needle)) throw new Error(message);
    }
  }

  function makeStmt(sql) {
    let bound = [];
    return {
      _sql: sql,
      bind(...args) { bound = args; return this; },
      async first() {
        calls.push({ sql, bound, method: 'first' });
        maybeFail(sql);
        if (sql.includes('SELECT completed_at, processed_at FROM webhook_event')) {
          return rows.get(bound[0]) ?? null;
        }
        for (const [needle, value] of Object.entries(firstRows)) {
          if (sql.includes(needle)) return value;
        }
        return null;
      },
      async all() {
        calls.push({ sql, bound, method: 'all' });
        maybeFail(sql);
        return { results: [] };
      },
      async run() {
        calls.push({ sql, bound, method: 'run' });
        maybeFail(sql);
        const override = forced(sql);
        if (sql.includes('INSERT OR IGNORE INTO webhook_event')) {
          const changes = override ?? (rows.has(bound[0]) ? 0 : 1);
          if (changes === 1) rows.set(bound[0], { completed_at: null, processed_at: nowSec() });
          return { success: true, meta: { changes } };
        }
        if (sql.includes('UPDATE webhook_event SET completed_at')) {
          const row = rows.get(bound[0]);
          if (row) row.completed_at = nowSec();
          return { success: true, meta: { changes: override ?? (row ? 1 : 0) } };
        }
        if (sql.includes('DELETE FROM webhook_event')) {
          const existed = rows.delete(bound[0]);
          return { success: true, meta: { changes: override ?? (existed ? 1 : 0) } };
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  return {
    _calls: calls,
    _rows: rows,
    prepare: (sql) => makeStmt(sql),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) {
        calls.push({ sql: s._sql, bound: [], method: 'run(batch)' });
        out.push({ success: true, meta: { changes: 1 } });
      }
      return out;
    },
  };
}

/** Builds a request carrying a genuine Stripe signature header over the payload. */
function signedRequest(eventObject, { secret = WEBHOOK_SECRET, timestamp = nowSec(), v1, payload } = {}) {
  const body = payload ?? JSON.stringify(eventObject);
  const signature = v1 ?? createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return mockRequest('POST', {
    rawBody: body,
    url: 'https://rrmacademy.org/api/stripe-webhook',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
  });
}

let evtSeq = 0;
function event(type, object, { id = `evt_test_${++evtSeq}` } = {}) {
  return { id, type, created: nowSec(), api_version: '2024-12-18.acacia', data: { object } };
}

function makeCtx({ db = webhookDb(), env: envOverrides = {}, request } = {}) {
  const env = mockEnv({ DB: db, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, ...envOverrides });
  return { request, env, waitUntil: mockWaitUntil(), db };
}

const sqlOf = (db) => db._calls.map(c => c.sql);
const ran = (db, needle) => db._calls.filter(c => c.sql.includes(needle));

/**
 * The in-flight TTL in functions/api/billing/_shared.js. Not exported (it is an
 * internal tuning constant), so the boundary test restates it here; if the two
 * ever diverge the boundary assertions below fail loudly rather than silently
 * testing the wrong second.
 */
const INFLIGHT_TTL_SECONDS = 60;

/**
 * Runs `fn` with Date.now() pinned, so `nowSec() - processed_at` is EXACTLY the
 * age the fixture asks for. Without this a boundary test is a race: the real
 * clock can tick between building the row and the handler reading it, turning an
 * age of 60 into 61 and letting an off-by-one in the reclaim comparison survive
 * whenever the run straddles a second.
 */
async function atFrozenClock(fn) {
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  try {
    return await fn(Math.floor(frozen / 1000));
  } finally {
    Date.now = realNow;
  }
}

// ------------------------------------------------------------- config -----

describe('stripe-webhook -- configuration', () => {
  for (const missing of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
    it(`refuses with 500 when ${missing} is unset, before touching the dedup table`, async () => {
      const ctx = makeCtx({
        request: signedRequest(event('charge.refunded', { id: 'ch_1', refunded: false })),
        env: { [missing]: undefined },
      });
      const parsed = await parseResponse(await onRequestPost(ctx));
      assert.equal(parsed.status, 500);
      assert.deepEqual(parsed.body, { ok: false, error: 'Webhook not configured' });
      assert.equal(ctx.db._calls.length, 0);
    });
  }

  it('refuses with 500 when the D1 binding is missing', async () => {
    const ctx = makeCtx({
      request: signedRequest(event('charge.refunded', { id: 'ch_1', refunded: false })),
      env: { DB: undefined },
    });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'DB not configured' });
  });
});

// ---------------------------------------------------------- signature -----

describe('stripe-webhook -- signature verification', () => {
  it('rejects a request with no stripe-signature header', async () => {
    const ctx = makeCtx({
      request: mockRequest('POST', {
        rawBody: JSON.stringify(event('charge.refunded', {})),
        url: 'https://rrmacademy.org/api/stripe-webhook',
      }),
    });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.deepEqual(parsed.body, { ok: false, error: 'Missing signature' });
    assert.equal(ctx.db._calls.length, 0);
  });

  it('rejects a forged signature', async () => {
    const ctx = makeCtx({ request: signedRequest(event('charge.refunded', { id: 'ch_1' }), { v1: 'f'.repeat(64) }) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.deepEqual(parsed.body, { ok: false, error: 'Invalid signature' });
    assert.equal(ctx.db._calls.length, 0, 'an unverified event must never be recorded as processed');
  });

  it('rejects a signature minted with a different webhook secret', async () => {
    const ctx = makeCtx({ request: signedRequest(event('charge.refunded', { id: 'ch_1' }), { secret: 'whsec_someone_elses' }) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'Invalid signature');
  });

  it('rejects a body swapped after signing (the signature covers the payload)', async () => {
    const real = event('charge.refunded', { id: 'ch_real', refunded: false });
    const tampered = JSON.stringify({ ...real, data: { object: { id: 'ch_attacker', refunded: true, payment_intent: 'pi_x', amount_refunded: 999900 } } });
    const ts = nowSec();
    const goodSig = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${JSON.stringify(real)}`).digest('hex');
    const ctx = makeCtx({ request: signedRequest(null, { payload: tampered, timestamp: ts, v1: goodSig }) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'Invalid signature');
    assert.equal(ran(ctx.db, 'UPDATE enrollment').length, 0, 'the forged refund must not have run');
  });

  it('rejects a replayed signature whose timestamp is outside the tolerance window', async () => {
    const ctx = makeCtx({ request: signedRequest(event('charge.refunded', { id: 'ch_1' }), { timestamp: nowSec() - 3600 }) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 400);
    assert.equal(parsed.body.error, 'Invalid signature');
  });

  it('accepts a correctly signed event and acknowledges it', async () => {
    const ctx = makeCtx({ request: signedRequest(event('charge.refunded', { id: 'ch_1', refunded: false })) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 200);
    assert.deepEqual(parsed.body, { received: true });
  });
});

// ----------------------------------------------------------- dispatch -----

describe('stripe-webhook -- dispatch', () => {
  it('acknowledges an unhandled event type without writing anything but the envelope', async () => {
    const db = webhookDb();
    const ctx = makeCtx({ db, request: signedRequest(event('customer.created', { id: 'cus_1' })) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 200);
    assert.deepEqual(parsed.body, { received: true });
    assert.ok(sqlOf(db).every(s => s.includes('webhook_event')), `unexpected writes: ${sqlOf(db)}`);
  });

  it('routes charge.refunded to the refund handler and soft-revokes the enrollment', async () => {
    const db = webhookDb();
    const ctx = makeCtx({ db, request: signedRequest(event('charge.refunded', { id: 'ch_9', refunded: true, payment_intent: 'pi_9', amount_refunded: 4900 })) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 200);
    const revoke = ran(db, 'UPDATE enrollment SET revoked_at')[0];
    assert.ok(revoke, 'the refund handler must have run');
    assert.deepEqual(revoke.bound, ['pi_9']);
    assert.ok(revoke.sql.includes('revoked_at IS NULL'), 'revocation must be idempotent');
    assert.ok(!sqlOf(db).some(s => s.includes('DELETE FROM enrollment')), 'enrollment is soft-revoked, never deleted');
  });

  it('leaves enrollment alone for a partial refund', async () => {
    const db = webhookDb();
    const ctx = makeCtx({ db, request: signedRequest(event('charge.refunded', { id: 'ch_10', refunded: false, payment_intent: 'pi_10', amount_refunded: 100 })) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    assert.equal(parsed.status, 200);
    assert.equal(ran(db, 'UPDATE enrollment').length, 0);
  });

  it('rolls the dedup row back and answers 500 when a handler THROWS', async () => {
    // data.object null makes the refund handler dereference null: an unhandled
    // handler error must not leave the event marked processed.
    const db = webhookDb();
    const evt = event('charge.refunded', null);
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'Internal error' });
    assert.equal(db._rows.has(evt.id), false, 'the dedup row must be gone so Stripe can retry');
    assert.equal(ran(db, 'UPDATE webhook_event SET completed_at').length, 0);
  });

  it('rolls the dedup row back and returns the handler response when a handler returns 5xx', async () => {
    const evt = event('charge.refunded', { id: 'ch_11', refunded: true, payment_intent: 'pi_11', amount_refunded: 4900 });
    const db = webhookDb({ fail: { 'UPDATE enrollment': 'D1_ERROR: database is locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(db._rows.has(evt.id), false, 'a 5xx must roll back so the retry re-runs the handler');
    assert.equal(ran(db, 'UPDATE webhook_event SET completed_at').length, 0);
  });

  it('still returns the handler 5xx when the rollback DELETE itself fails', async () => {
    const evt = event('charge.refunded', { id: 'ch_12', refunded: true, payment_intent: 'pi_12', amount_refunded: 100 });
    const db = webhookDb({ fail: { 'UPDATE enrollment': 'D1_ERROR', 'DELETE FROM webhook_event': 'D1_ERROR on delete' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500, 'a failed rollback must not escalate into an unhandled error');
  });

  it('answers 200 even when the phase-2 completed_at UPDATE fails', async () => {
    const evt = event('charge.refunded', { id: 'ch_13', refunded: false });
    const db = webhookDb({ fail: { 'UPDATE webhook_event SET completed_at': 'D1_ERROR on mark' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 200, 'a best-effort phase-2 marker must never fail the ack');
    assert.equal(ran(db, 'UPDATE webhook_event SET completed_at').length, 1);
  });
});

// --------------------------------------------------- idempotent replay ----

describe('stripe-webhook -- idempotent replay (two-phase dedup)', () => {
  it('processes a first delivery and marks it completed', async () => {
    const db = webhookDb();
    const evt = event('charge.refunded', { id: 'ch_20', refunded: false });
    await onRequestPost(makeCtx({ db, request: signedRequest(evt) }));
    assert.equal(ran(db, 'INSERT OR IGNORE INTO webhook_event').length, 1);
    assert.ok(db._rows.get(evt.id).completed_at, 'phase 2 must stamp completed_at');
  });

  it('skips a redelivery of an already-completed event without re-running the handler', async () => {
    const db = webhookDb();
    const evt = event('charge.refunded', { id: 'ch_21', refunded: true, payment_intent: 'pi_21', amount_refunded: 4900 });

    const first = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(first.status, 200);
    assert.equal(ran(db, 'UPDATE enrollment SET revoked_at').length, 1);

    const second = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true, skipped: true, completed: true });
    assert.equal(
      ran(db, 'UPDATE enrollment SET revoked_at').length, 1,
      'a replay must not re-run the side effects'
    );
  });

  it('forces a Stripe retry with 500 when a duplicate arrives while the first is still in flight', async () => {
    const evt = event('charge.refunded', { id: 'ch_22', refunded: false });
    const rows = new Map([[evt.id, { completed_at: null, processed_at: nowSec() - 5 }]]);
    const db = webhookDb({ rows });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'in-flight' });
    assert.equal(ran(db, 'DELETE FROM webhook_event').length, 0, 'an in-flight event must not be reclaimed');
  });

  it('reclaims and reprocesses a crashed attempt once the in-flight TTL has passed', async () => {
    const evt = event('charge.refunded', { id: 'ch_23', refunded: true, payment_intent: 'pi_23', amount_refunded: 4900 });
    // Never completed and older than the 60s TTL: the prior attempt died.
    // Silently acking here would drop the refund's side effects with no re-drive.
    const rows = new Map([[evt.id, { completed_at: null, processed_at: nowSec() - 300 }]]);
    const db = webhookDb({ rows });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 200);

    const reclaim = ran(db, 'processed_at <= ?')[0];
    assert.ok(reclaim, 'the stale row must be deleted with a guarded DELETE');
    assert.equal(reclaim.bound[0], evt.id);
    assert.ok(reclaim.sql.includes('completed_at IS NULL'), 'the reclaim must never delete a completed row');
    assert.equal(ran(db, 'INSERT OR IGNORE INTO webhook_event').length, 2, 'the row is re-inserted before reprocessing');
    assert.equal(ran(db, 'UPDATE enrollment SET revoked_at').length, 1, 'the handler must actually re-run');
    assert.ok(db._rows.get(evt.id).completed_at);
  });

  it('reclaims at exactly the in-flight TTL and holds the second before it', async () => {
    // 5s and 300s (the ages used above and below) sit far either side of the
    // 60s boundary, so they pass whether the comparison is `>=` or `>`. Only
    // the boundary second itself separates the two, and getting it wrong means
    // a crashed attempt is answered `in-flight` forever: Stripe retries at the
    // same age each time and the event is never re-driven.
    await atFrozenClock(async (now) => {
      const held = event('charge.refunded', { id: 'ch_ttl_a', refunded: false });
      const heldDb = webhookDb({ rows: new Map([[held.id, { completed_at: null, processed_at: now - (INFLIGHT_TTL_SECONDS - 1) }]]) });
      const heldRes = await parseResponse(await onRequestPost(makeCtx({ db: heldDb, request: signedRequest(held) })));
      assert.equal(heldRes.status, 500, `age ${INFLIGHT_TTL_SECONDS - 1}s is still in flight`);
      assert.deepEqual(heldRes.body, { ok: false, error: 'in-flight' });
      assert.equal(ran(heldDb, 'processed_at <= ?').length, 0, 'one second early must not reclaim');

      const due = event('charge.refunded', { id: 'ch_ttl_b', refunded: true, payment_intent: 'pi_ttl', amount_refunded: 4900 });
      const dueDb = webhookDb({ rows: new Map([[due.id, { completed_at: null, processed_at: now - INFLIGHT_TTL_SECONDS }]]) });
      const dueRes = await parseResponse(await onRequestPost(makeCtx({ db: dueDb, request: signedRequest(due) })));
      assert.equal(dueRes.status, 200, `age ${INFLIGHT_TTL_SECONDS}s is exactly the TTL and must reclaim`);
      assert.equal(ran(dueDb, 'processed_at <= ?').length, 1, 'the boundary row must be reclaimed with the guarded DELETE');
      assert.equal(ran(dueDb, 'UPDATE enrollment SET revoked_at').length, 1, 'and the handler must actually re-run');
    });
  });

  it('backs off with an in-flight 500 when it loses the reclaim race on the DELETE', async () => {
    const evt = event('charge.refunded', { id: 'ch_24', refunded: false });
    const rows = new Map([[evt.id, { completed_at: null, processed_at: nowSec() - 300 }]]);
    const db = webhookDb({ rows, forceChanges: { 'processed_at <= ?': 0 } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'in-flight' });
  });

  it('backs off with an in-flight 500 when it loses the reclaim race on the re-INSERT', async () => {
    const evt = event('charge.refunded', { id: 'ch_25', refunded: false });
    const rows = new Map([[evt.id, { completed_at: null, processed_at: nowSec() - 300 }]]);
    const db = webhookDb({ rows, forceChanges: { 'INSERT OR IGNORE INTO webhook_event': 0 } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'in-flight' });
  });

  it('proceeds when the duplicate INSERT reports 0 changes but no row can be read back', async () => {
    const evt = event('charge.refunded', { id: 'ch_26', refunded: false });
    const db = webhookDb({ forceChanges: { 'INSERT OR IGNORE INTO webhook_event': 0 } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 200, 'a phantom conflict must not wedge the event');
    assert.deepEqual(parsed.body, { received: true });
  });

  it('answers 500 without dispatching when the dedup INSERT itself errors', async () => {
    const evt = event('charge.refunded', { id: 'ch_27', refunded: true, payment_intent: 'pi_27', amount_refunded: 100 });
    const db = webhookDb({ fail: { 'INSERT OR IGNORE INTO webhook_event': 'D1_ERROR: no such table' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'Internal error' });
    assert.equal(ran(db, 'UPDATE enrollment').length, 0, 'no side effects without a dedup guarantee');
  });
});

// -------------------------------------------------- outermost error net ---

describe('stripe-webhook -- outermost handler', () => {
  it('answers a generic 500 when reading the request body throws', async () => {
    const request = mockRequest('POST', { rawBody: '{}', headers: { 'stripe-signature': 't=1,v1=abc' } });
    request.text = async () => { throw new Error('stream reset by peer'); };
    const parsed = await parseResponse(await onRequestPost(makeCtx({ request })));
    assert.equal(parsed.status, 500);
    assert.deepEqual(parsed.body, { ok: false, error: 'Internal error' });
    assert.ok(!JSON.stringify(parsed.body).includes('stream reset'), 'internal detail must not leak');
  });
});

// ------------------------------------------------- remaining event types --

describe('stripe-webhook -- subscription and invoice routing', () => {
  it('routes customer.subscription.created to the tier-label sync', async () => {
    const db = webhookDb({ firstRows: { 'SELECT id FROM user WHERE stripe_customer_id': { id: 'usr_1' } } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({
      db, request: signedRequest(event('customer.subscription.created', { id: 'sub_1', status: 'active', customer: 'cus_1', items: { data: [] }, metadata: { tier: 'hero' } })),
    })));
    assert.equal(parsed.status, 200);
    const labelWrites = ran(db, 'user_label');
    assert.ok(labelWrites.length > 0, 'an active STUC subscription must stamp the member labels');
    assert.ok(labelWrites.some(c => c.sql.includes('INSERT OR IGNORE INTO user_label')), 'labels are added idempotently');
    assert.ok(labelWrites.some(c => c.sql.includes('DELETE FROM user_label')), 'labels for other tiers are cleared');
  });

  it('routes a terminal customer.subscription.updated to the label-removal path', async () => {
    const db = webhookDb({ firstRows: { 'SELECT id FROM user WHERE stripe_customer_id': { id: 'usr_2' } } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({
      db, request: signedRequest(event('customer.subscription.updated', { id: 'sub_2', status: 'canceled', customer: 'cus_2', items: { data: [] }, metadata: { tier: 'hero' } })),
    })));
    assert.equal(parsed.status, 200);
    assert.ok(ran(db, 'DELETE FROM user_label').length > 0, 'a canceled subscription must lose its STUC labels');
    assert.equal(ran(db, 'INSERT OR IGNORE INTO user_label').length, 0, 'nothing is re-added on a terminal status');
  });

  it('rolls back and 500s when the label-removal query fails on a terminal update', async () => {
    const evt = event('customer.subscription.updated', { id: 'sub_3', status: 'canceled', customer: 'cus_3', items: { data: [] }, metadata: { tier: 'hero' } });
    const db = webhookDb({ fail: { 'SELECT id FROM user WHERE stripe_customer_id': 'D1_ERROR: locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(db._rows.has(evt.id), false, 'the dedup row must roll back so Stripe retries');
  });

  it('flags a migrated Wix row as fully exited on customer.subscription.deleted', async () => {
    const db = webhookDb();
    const parsed = await parseResponse(await onRequestPost(makeCtx({
      db, request: signedRequest(event('customer.subscription.deleted', { id: 'sub_4', status: 'canceled', customer: 'cus_4', items: { data: [] } })),
    })));
    assert.equal(parsed.status, 200);
    const exit = ran(db, "migration_status='fully_exited'")[0];
    assert.ok(exit, 'a deleted subscription must close out its migration row');
    assert.deepEqual(exit.bound, ['sub_4', 'sub_4']);
    assert.ok(exit.sql.includes("migration_status='migrated'"), 'only an already-migrated row may be closed out');
  });

  it('rolls back and 500s when the migration close-out write fails', async () => {
    const evt = event('customer.subscription.deleted', { id: 'sub_5', status: 'canceled', customer: 'cus_5', items: { data: [] } });
    const db = webhookDb({ fail: { "migration_status='fully_exited'": 'D1_ERROR: locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(db._rows.has(evt.id), false);
  });

  it('emails the member on invoice.payment_failed', async () => {
    const db = webhookDb({ firstRows: { 'SELECT email FROM user WHERE stripe_customer_id': { email: 'member@example.com' } } });
    const before = net.calls.length;
    const ctx = makeCtx({ db, request: signedRequest(event('invoice.payment_failed', { id: 'in_1', customer: 'cus_6' })) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    await Promise.allSettled(ctx.waitUntil.promises.slice());
    assert.equal(parsed.status, 200);
    const sent = net.calls.slice(before).filter(c => c.service === 'ses');
    const notice = sent.find(c => (c.body?.Content?.Simple?.Subject?.Data || '').includes('Payment failed'));
    assert.ok(notice, `expected a dunning email, sent: ${sent.map(c => c.body?.Content?.Simple?.Subject?.Data)}`);
    assert.deepEqual(notice.body.Destination.ToAddresses, ['member@example.com']);
  });

  it('rolls back and 500s when the invoice email lookup fails', async () => {
    const evt = event('invoice.payment_failed', { id: 'in_2', customer: 'cus_7' });
    const db = webhookDb({ fail: { 'SELECT email FROM user WHERE stripe_customer_id': 'D1_ERROR: locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(db._rows.has(evt.id), false);
  });

  it('sends nothing on invoice.payment_failed when SES is unconfigured', async () => {
    const db = webhookDb();
    const before = net.calls.length;
    const ctx = makeCtx({
      db,
      env: { AWS_ACCESS_KEY_ID: undefined },
      request: signedRequest(event('invoice.payment_failed', { id: 'in_3', customer: 'cus_8' })),
    });
    const parsed = await parseResponse(await onRequestPost(ctx));
    await Promise.allSettled(ctx.waitUntil.promises.slice());
    assert.equal(parsed.status, 200);
    assert.equal(net.calls.slice(before).filter(c => c.service === 'ses').length, 0);
    assert.equal(ran(db, 'SELECT email FROM user').length, 0, 'no lookup when there is no way to send');
  });
});

describe('stripe-webhook -- refund side effects beyond enrollment', () => {
  const refund = (id) => event('charge.refunded', { id, refunded: true, payment_intent: `pi_${id}`, amount_refunded: 25000, customer: 'cus_r' });

  it('drops the supporter recognition row and recomputes the donor rollups', async () => {
    const db = webhookDb({ firstRows: { 'UPDATE donor_gift SET refunded_at': { email: 'donor@example.com' } } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(refund('ch_30')) })));
    assert.equal(parsed.status, 200);
    assert.ok(ran(db, 'supporter_recognition').length > 0, 'a refunded gift must lose its public recognition');
    const gift = ran(db, 'UPDATE donor_gift SET refunded_at')[0];
    assert.ok(gift.sql.includes('refunded_at IS NULL'), 'the refund stamp must be idempotent');
    assert.ok(
      ran(db, 'COALESCE(SUM(amount_cents), 0) AS donated_cents').length > 0,
      'the contact rollups must be recomputed so the refunded gift stops counting'
    );
  });

  it('rolls back and 500s when the recognition removal fails', async () => {
    const evt = refund('ch_31');
    const db = webhookDb({ fail: { 'supporter_recognition': 'D1_ERROR: locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(db._rows.has(evt.id), false);
  });

  it('rolls back and 500s when the donor_gift refund stamp fails', async () => {
    const evt = refund('ch_32');
    const db = webhookDb({ fail: { 'UPDATE donor_gift SET refunded_at': 'D1_ERROR: locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(db._rows.has(evt.id), false);
  });
});

// ------------------------------------------------ checkout event routing --
//
// handleCheckoutCompleted has its own suite (webhook-checkout-exec.test.js).
// These exist because the DISPATCH arm is separate code: without them the two
// switch cases for the highest-value event in the system never execute, while
// v8 still attributes the enclosing block's count to them (caught by
// rrm-ehr/scripts/lint-coverage-honesty.mjs, 2026-07-28).

describe('stripe-webhook -- checkout event routing', () => {
  const completedSession = (overrides = {}) => ({
    id: 'cs_dispatch_1',
    mode: 'payment',
    customer: 'cus_dispatch',
    customer_details: { email: 'dispatch@example.com', name: 'Grace Hopper' },
    amount_total: 5000,
    payment_intent: 'pi_dispatch',
    metadata: {},
    ...overrides,
  });

  it('routes checkout.session.completed to the checkout handler', async () => {
    const db = webhookDb();
    const evt = event('checkout.session.completed', completedSession());
    const ctx = makeCtx({ db, request: signedRequest(evt) });
    const parsed = await parseResponse(await onRequestPost(ctx));
    await Promise.allSettled(ctx.waitUntil.promises.slice());
    assert.equal(parsed.status, 200);
    assert.ok(ran(db, 'INSERT OR IGNORE INTO user').length > 0, 'the checkout handler must have created the account');
    assert.ok(db._rows.get(evt.id).completed_at, 'a successful checkout must be marked completed');
  });

  it('rolls back the dedup row when the checkout handler returns its 500', async () => {
    const evt = event('checkout.session.completed', completedSession());
    const db = webhookDb({ fail: { 'SELECT id, stripe_customer_id FROM user': 'D1_ERROR: locked' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 500);
    assert.equal(parsed.body.error, 'Account linkage failed');
    assert.equal(db._rows.has(evt.id), false, 'a lost account link must be retried, not acknowledged');
  });

  it('routes checkout.session.expired to the migration-lock release', async () => {
    const db = webhookDb();
    const created = nowSec();
    const evt = event('checkout.session.expired', { id: 'cs_expired', created, metadata: { wix_subscription_id: 'wxs_dispatch1' } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({ db, request: signedRequest(evt) })));
    assert.equal(parsed.status, 200);
    const release = ran(db, 'SET migration_handoff_started_at = NULL')[0];
    assert.ok(release, 'an expired migration checkout must free the donor to retry');
    assert.deepEqual(release.bound, ['wxs_dispatch1', created]);
  });

  it('recognises a STUC subscription by its Stripe product, not only by metadata', async () => {
    // items.data is empty in most fixtures, which leaves the product-id arm of
    // isStucSubscription unexecuted; this drives it.
    const db = webhookDb({ firstRows: { 'SELECT id FROM user WHERE stripe_customer_id': { id: 'usr_prod' } } });
    const parsed = await parseResponse(await onRequestPost(makeCtx({
      db,
      request: signedRequest(event('customer.subscription.created', {
        id: 'sub_prod', status: 'active', customer: 'cus_prod', metadata: {},
        items: { data: [{ price: { product: 'prod_U1VCTgB3uBP0KX' } }] },
      })),
    })));
    assert.equal(parsed.status, 200);
    assert.ok(ran(db, 'INSERT OR IGNORE INTO user_label').length > 0, 'a product-matched STUC sub must be labelled');
  });
});

describe('stripe-webhook -- cancellation edge cases', () => {
  it('keeps the STUC labels when the customer still has another active membership', async () => {
    // Removing labels here would revoke community access from someone who is
    // still paying through a second subscription.
    const stub = stubExternalFetch({
      stripe: stripeRoutes({
        '/v1/subscriptions': { object: 'list', has_more: false, data: [{ id: 'sub_other', status: 'active' }, { id: 'sub_gone', status: 'canceled' }] },
      }),
    });
    try {
      const db = webhookDb({ firstRows: { 'SELECT id FROM user WHERE stripe_customer_id': { id: 'usr_multi' } } });
      const parsed = await parseResponse(await onRequestPost(makeCtx({
        db,
        request: signedRequest(event('customer.subscription.updated', {
          id: 'sub_gone', status: 'canceled', customer: 'cus_multi', items: { data: [] }, metadata: { tier: 'hero' },
        })),
      })));
      assert.equal(parsed.status, 200);
      assert.equal(ran(db, 'DELETE FROM user_label').length, 0, 'a still-paying member must keep their labels');
    } finally { stub.restore(); }
  });

  it('logs instead of sending when a subscription is deleted and SES is unconfigured', async () => {
    const db = webhookDb({ firstRows: { 'SELECT id FROM user WHERE stripe_customer_id': { id: 'usr_nomail' } } });
    const before = net.calls.length;
    const parsed = await parseResponse(await onRequestPost(makeCtx({
      db,
      env: { AWS_ACCESS_KEY_ID: undefined },
      request: signedRequest(event('customer.subscription.deleted', {
        id: 'sub_nomail', status: 'canceled', customer: 'cus_nomail', items: { data: [] }, metadata: { tier: 'hero' },
      })),
    })));
    assert.equal(parsed.status, 200);
    assert.equal(net.calls.slice(before).filter(c => c.service === 'ses').length, 0);
    assert.ok(ran(db, 'DELETE FROM user_label').length > 0, 'the labels still come off');
  });
});
