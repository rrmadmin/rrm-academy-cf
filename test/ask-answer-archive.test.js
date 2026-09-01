/**
 * functions/api/ask.js x functions/api/_search_log.js -- POST /api/ask
 * archiving its answer into the new `ask_answer` table (ANALYTICS_DB /
 * rrm-analytics), linked back to the `search_log` row for that same call.
 *
 * WHY THIS IS ITS OWN FILE
 * `env.DB` (session + user) is the real rrm-auth SQLite harness so
 * requireMember and validateSession run for real. `env.ANALYTICS_DB` is a
 * separate D1 database (rrm-analytics) with no committed harness of its own
 * -- schema.sql mirrors rrm-auth only -- so this file carries a small
 * purpose-built fake that records every INSERT it receives and can be told
 * to throw on the ask_answer insert specifically, to prove the fail-open
 * path without touching the response.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const { onRequestPost } = await import('../functions/api/ask.js');

const URL_ = 'https://rrmacademy.org/api/ask';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const RAW_SESSION = 'sess-ask-answer-archive';
const USER_ID = 'u_ask_archive_mod';

async function authDb() {
  const db = sqliteD1({
    seed(sqlite) {
      insertUser(sqlite, { id: USER_ID, email: 'mod-ask@example.com', role: 'mod', name: 'Moe Mod' });
    },
  });
  await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER_ID, expiresAt: FUTURE });
  return db;
}

/** In-memory KV covering the rate-limit counter ask.js reads/writes. */
function fakeKV() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

/**
 * Purpose-built fake for env.ANALYTICS_DB. Records every prepared statement
 * that actually runs, and can be told to throw only on the ask_answer INSERT
 * so the search_log write still succeeds -- the shape logAskAnswer's fail-open
 * catch is built for.
 */
function fakeAnalyticsDB({ failAskAnswer = false } = {}) {
  const calls = [];
  let nextId = 1;
  return {
    calls,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) { bound = args; return this; },
        async run() {
          if (sql.includes('INSERT INTO ask_answer') && failAskAnswer) {
            throw new Error('simulated ask_answer insert failure');
          }
          const id = nextId++;
          calls.push({ sql, bound, id });
          return { success: true, meta: { last_row_id: id, changes: 1 } };
        },
      };
    },
  };
}

function fakeEvents() {
  const points = [];
  return {
    points,
    writeDataPoint(dp) { points.push(dp); },
  };
}

/** env.AI_SEARCH service binding stub answering the V2 shape ask.js expects. */
function fakeAiSearch({ answer = 'FABM stands for Fertility Awareness-Based Methods.' } = {}) {
  return {
    async fetch() {
      return new Response(JSON.stringify({
        answer,
        citations: [{ url: 'https://rrmacademy.org/library/example/', title: 'Example' }],
        model: 'test-model-v2',
        usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
}

function baseEnv({ DB, analyticsDb, events }) {
  return {
    DB,
    COMMUNITY_KV: fakeKV(),
    ANALYTICS_DB: analyticsDb,
    EVENTS: events,
    AI_SEARCH: fakeAiSearch(),
    AI_SEARCH_WORKER_AUTH: 'test-auth-token',
  };
}

function ctx({ env, waitUntil, data = { searchV2: 'all' } }) {
  return {
    request: mockRequest('POST', {
      url: URL_,
      headers: { Cookie: `session=${RAW_SESSION}` },
      body: { message: 'What does FABM stand for?' },
    }),
    env,
    waitUntil,
    data,
  };
}

describe('POST /api/ask archives the answer to ask_answer', () => {
  it('writes one ask_answer row linked to the search_log row, with usage/prompt_hash and no model/usage leak to the client', async () => {
    const db = await authDb();
    const analyticsDb = fakeAnalyticsDB();
    const events = fakeEvents();
    const waitUntil = mockWaitUntil();
    const env = baseEnv({ DB: db, analyticsDb, events });

    const response = await onRequestPost(ctx({ env, waitUntil }));
    const { status, body } = await parseResponse(response);
    assert.equal(status, 200);

    // Client-facing contract: no model/usage leak.
    assert.deepEqual(Object.keys(body).sort(), ['_meta', 'answer', 'citations']);
    assert.equal(body.answer, 'FABM stands for Fertility Awareness-Based Methods.');

    await Promise.all(waitUntil.promises);

    const searchLogCall = analyticsDb.calls.find((c) => c.sql.includes('INSERT INTO search_log'));
    const askAnswerCall = analyticsDb.calls.find((c) => c.sql.includes('INSERT INTO ask_answer'));
    assert.ok(searchLogCall, 'search_log insert did not run');
    assert.ok(askAnswerCall, 'ask_answer insert did not run');

    // ask_answer.search_log_id (bind index 0) must equal the id search_log's
    // own insert returned -- the link this feature exists to create.
    assert.equal(askAnswerCall.bound[0], searchLogCall.id);

    // source (index 1), query (index 2), answer (index 3) line up with the
    // same call.
    assert.equal(askAnswerCall.bound[1], 'ask_v2');
    assert.equal(askAnswerCall.bound[2], 'What does FABM stand for?');
    assert.equal(askAnswerCall.bound[3], 'FABM stands for Fertility Awareness-Based Methods.');

    // citations_json (index 4)
    assert.deepEqual(JSON.parse(askAnswerCall.bound[4]), [{ url: 'https://rrmacademy.org/library/example/', title: 'Example' }]);

    // fallback (index 5)
    assert.equal(askAnswerCall.bound[5], 0);

    // model (index 6)
    assert.equal(askAnswerCall.bound[6], 'test-model-v2');

    // prompt_hash (index 7): sha256 hex, first 16 chars.
    const promptHashBound = askAnswerCall.bound[7];
    assert.equal(typeof promptHashBound, 'string');
    assert.equal(promptHashBound.length, 16);
    assert.match(promptHashBound, /^[0-9a-f]{16}$/);

    // tokens_in / tokens_out (index 8/9) from upstream usage.
    assert.equal(askAnswerCall.bound[8], 42);
    assert.equal(askAnswerCall.bound[9], 17);

    // user_id (index 11) is the session user, not client-supplied.
    assert.equal(askAnswerCall.bound[11], USER_ID);

    const dropped = events.points.find((p) => p.blobs?.[2] === 'ask_answer_dropped' || p.blobs?.[2] === 'search_log_dropped');
    assert.equal(dropped, undefined, 'no AE drop event should fire on a clean write');
  });

  it('an ANALYTICS_DB failure on the ask_answer insert does not change the HTTP response, and emits ask_answer_dropped', async () => {
    const db = await authDb();
    const analyticsDb = fakeAnalyticsDB({ failAskAnswer: true });
    const events = fakeEvents();
    const waitUntil = mockWaitUntil();
    const env = baseEnv({ DB: db, analyticsDb, events });

    const response = await onRequestPost(ctx({ env, waitUntil }));
    const { status, body } = await parseResponse(response);
    assert.equal(status, 200);
    assert.equal(body.answer, 'FABM stands for Fertility Awareness-Based Methods.');
    assert.deepEqual(Object.keys(body).sort(), ['_meta', 'answer', 'citations']);

    await Promise.all(waitUntil.promises);

    // search_log still wrote fine; only ask_answer failed.
    assert.ok(analyticsDb.calls.some((c) => c.sql.includes('INSERT INTO search_log')));
    assert.ok(!analyticsDb.calls.some((c) => c.sql.includes('INSERT INTO ask_answer')));

    const dropped = events.points.find((p) => p.blobs?.[2] === 'ask_answer_dropped');
    assert.ok(dropped, 'expected an ask_answer_dropped Analytics Engine event');
    assert.equal(dropped.indexes?.[0], 'ask_answer_dropped');
  });

  it('client payload never carries model or usage keys, even on the SSE branch', async () => {
    const db = await authDb();
    const analyticsDb = fakeAnalyticsDB();
    const events = fakeEvents();
    const waitUntil = mockWaitUntil();
    const env = baseEnv({ DB: db, analyticsDb, events });

    const sseCtx = ctx({ env, waitUntil });
    sseCtx.request = mockRequest('POST', {
      url: URL_,
      headers: { Cookie: `session=${RAW_SESSION}`, Accept: 'text/event-stream' },
      body: { message: 'What does FABM stand for?' },
    });

    const response = await onRequestPost(sseCtx);
    assert.equal(response.status, 200);
    const text = await response.text();
    const dataLine = text.split('\n').find((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
    const payload = JSON.parse(dataLine.slice('data: '.length));
    assert.deepEqual(Object.keys(payload).sort(), ['_meta', 'answer', 'citations']);

    await Promise.all(waitUntil.promises);
  });
});
