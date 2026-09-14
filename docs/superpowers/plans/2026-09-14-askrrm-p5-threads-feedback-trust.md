# AskRRM Threads, Feedback and Trust Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make follow-ups work (thread_id now READ, not just stored), let a reader say whether an answer helped, and put the trust surface on the page: typed citations, a grounded-in panel, unverified marks, related records, feedback buttons and the full error map.

**Architecture:** The migration from P2 already created `ask_thread` and `ask_feedback` and added `thread_id` and `turn` to `ask_answer`, so no schema work happens here. `functions/api/ask.js` gains thread creation and lookup; the engine gains a bounded thread-carry function; two new routes appear under `/api/ask/`; `src/pages/ask.astro` renders what the engine already returns.

**Tech Stack:** Cloudflare Pages Functions, D1 (`rrm-analytics`), vanilla browser JS in the Astro page, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-askrrm-engine-design.md` (sections 9, 10, 11, 14 step 5; proof gates G5, G7, G11)

## Global Constraints

Every task's requirements implicitly include this section.

- Workers AI only at runtime, no paid API keys.
- Caps free 3 a day and member 20 a day unchanged.
- Wrangler pin `npx wrangler@4.62.0` for Pages; the pinned local wrangler for `rrm-ai-search`.
- Never edit `compatibility_date` by hand.
- Commit messages built in a file and passed with `-F`, never a long `-m`, ending with the two attribution lines `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH`.
- Every new file gets a census rule in `scripts/quality/lib/census-rules.mjs`.
- American English, no em dashes in any copy or code comment.
- Write-endpoint conformance: `validateBody`, the `json` helper, report rows via the vendored `report` package with blob1 = worker name and blob4 in `ok|error|slow|start|warn`.
- The pre-commit arise-scan hook stays on.

## File Structure

| Path | Responsibility |
|---|---|
| `functions/api/ask/_thread.js` | CREATE. Truncation bounds, thread create, thread read. Pure functions plus D1 helpers. |
| `functions/api/ask/thread/[id].js` | CREATE. `GET /api/ask/thread/:id`, owner-gated. |
| `functions/api/ask/feedback.js` | CREATE. `POST /api/ask/feedback`, owner-gated, upsert. |
| `functions/api/ask.js` | MODIFY. Create or resume a thread, carry turns into the engine, store `turn`. |
| `functions/api/ask/_engine.js` | MODIFY. Accept and bound the thread. |
| `src/pages/ask.astro` | MODIFY. The trust surface. |
| `test/ask-thread.test.js`, `test/ask-feedback.test.js` | CREATE. |

---

### Task 1: Thread bounds and the read path

**Files:**
- Create: `functions/api/ask/_thread.js`, `functions/api/ask/thread/[id].js`
- Test: `test/ask-thread.test.js`

**Interfaces:**
- Consumes: `json`, `optionsResponse`, `getSessionIdFromCookie`, `validateSession`, `generateId` from `functions/api/auth/_shared.js`.
- Produces:
  - `MAX_TURN_QUESTION = 400`, `MAX_TURN_ANSWER = 900`, `MAX_THREAD_CHARS = 4000`, `MAX_TURNS = 3`
  - `boundTurns(turns) -> Turn[]` where `Turn = { question: string, answer: string, citation_ids: string[] }`
  - `async createThread(env, userId) -> string` (the new thread id, `th_` plus 24 hex)
  - `async loadThread(env, threadId, userId) -> { id, turns: Turn[], nextTurn: number } | null` (null when absent OR owned by someone else, so a foreign id is indistinguishable from a missing one)
  - `async touchThread(env, threadId)`

- [ ] **Step 1: Write the failing test**

Create `test/ask-thread.test.js`:

```js
/**
 * Thread bounds and the read path.
 *
 * G11 is a UNIT test on the truncation function, not only an integration
 * probe: three full-length turns must never be able to produce a /generate
 * prompt over 12,000 characters, and the way to know that is to feed the
 * function the worst case and measure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';
import {
  boundTurns, MAX_TURN_QUESTION, MAX_TURN_ANSWER, MAX_THREAD_CHARS, MAX_TURNS,
  createThread, loadThread,
} from '../functions/api/ask/_thread.js';

describe('boundTurns (G11)', () => {
  const fat = (n) => ({ question: 'q'.repeat(2000), answer: 'a'.repeat(9000), citation_ids: [`c${n}`], extra: 'ignored' });

  it('keeps at most three turns, the most recent', () => {
    const out = boundTurns([fat(1), fat(2), fat(3), fat(4), fat(5)]);
    assert.equal(out.length, MAX_TURNS);
    assert.deepEqual(out[out.length - 1].citation_ids, ['c5']);
  });

  it('truncates each turn to 400 question and 900 answer characters', () => {
    const [t] = boundTurns([fat(1)]);
    assert.equal(t.question.length, MAX_TURN_QUESTION);
    assert.equal(t.answer.length, MAX_TURN_ANSWER);
  });

  it('the total carried text never exceeds 4000 characters', () => {
    const out = boundTurns([fat(1), fat(2), fat(3)]);
    const total = out.reduce((n, t) => n + t.question.length + t.answer.length, 0);
    assert.ok(total <= MAX_THREAD_CHARS, `carried ${total} characters, cap is ${MAX_THREAD_CHARS}`);
  });

  it('carries citations by ID only, never re-serialized text', () => {
    const [t] = boundTurns([{ question: 'q', answer: 'a', citation_ids: ['x'], citations: [{ url: 'u', title: 'long title text' }] }]);
    assert.deepEqual(Object.keys(t).sort(), ['answer', 'citation_ids', 'question']);
    assert.deepEqual(t.citation_ids, ['x']);
  });

  it('never throws on junk', () => {
    assert.deepEqual(boundTurns(null), []);
    assert.deepEqual(boundTurns([null, undefined, 42]), []);
    assert.deepEqual(boundTurns([{}])[0], { question: '', answer: '', citation_ids: [] });
  });
});

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const OWNER = 'u_thread_owner';
const OTHER = 'u_thread_other';
const S_OWNER = 'sess-thread-owner';
const S_OTHER = 'sess-thread-other';

async function authDb() {
  const db = sqliteD1({ seed(s) {
    insertUser(s, { id: OWNER, email: 'owner@example.com', role: 'member', name: 'O', email_verified: 1 });
    insertUser(s, { id: OTHER, email: 'other@example.com', role: 'member', name: 'X', email_verified: 1 });
  } });
  await insertSession(db._sqlite, { rawId: S_OWNER, userId: OWNER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: S_OTHER, userId: OTHER, expiresAt: FUTURE });
  return db;
}

/** In-memory stand-in for ANALYTICS_DB: ask_thread plus ask_answer. */
function analyticsDb() {
  const threads = new Map();
  const answers = [];
  return {
    threads, answers,
    prepare(sql) {
      let bound = [];
      return {
        bind(...a) { bound = a; return this; },
        async run() {
          if (sql.includes('INSERT INTO ask_thread')) threads.set(bound[0], { id: bound[0], user_id: bound[1] });
          if (sql.includes('UPDATE ask_thread')) { /* touch */ }
          if (sql.includes('INSERT INTO ask_answer')) answers.push(bound);
          return { success: true, meta: { last_row_id: answers.length, changes: 1 } };
        },
        async first() {
          if (sql.includes('FROM ask_thread')) return threads.get(bound[0]) || null;
          return null;
        },
        async all() {
          if (sql.includes('FROM ask_answer')) {
            return { results: answers.filter((b) => b[15] === bound[0]).map((b, i) => ({ id: i + 1, query: b[2], answer: b[3], citations_json: b[4], turn: b[16] })) };
          }
          return { results: [] };
        },
      };
    },
  };
}

describe('createThread and loadThread', () => {
  it('creates a th_ prefixed id owned by the caller', async () => {
    const env = { ANALYTICS_DB: analyticsDb() };
    const id = await createThread(env, OWNER);
    assert.match(id, /^th_[0-9a-f]{24}$/);
    assert.equal(env.ANALYTICS_DB.threads.get(id).user_id, OWNER);
  });

  it('a foreign thread id loads as null, indistinguishable from a missing one', async () => {
    const env = { ANALYTICS_DB: analyticsDb() };
    const id = await createThread(env, OWNER);
    assert.equal(await loadThread(env, id, OTHER), null);
    assert.equal(await loadThread(env, 'th_000000000000000000000000', OWNER), null);
  });

  it('loads the owner’s turns and reports the next turn number', async () => {
    const env = { ANALYTICS_DB: analyticsDb() };
    const id = await createThread(env, OWNER);
    const t = await loadThread(env, id, OWNER);
    assert.equal(t.id, id);
    assert.deepEqual(t.turns, []);
    assert.equal(t.nextTurn, 1);
  });
});

describe('GET /api/ask/thread/:id', () => {
  it('404s a thread owned by someone else', async () => {
    const { onRequestGet } = await import('../functions/api/ask/thread/[id].js');
    const db = await authDb();
    const env = { DB: db, ANALYTICS_DB: analyticsDb() };
    const id = await createThread(env, OWNER);
    const res = await onRequestGet({
      request: mockRequest('GET', { url: `https://rrmacademy.org/api/ask/thread/${id}`, headers: { Cookie: `session=${S_OTHER}` } }),
      env, params: { id }, waitUntil: mockWaitUntil(),
    });
    assert.equal((await parseResponse(res)).status, 404);
  });

  it('401s with no session', async () => {
    const { onRequestGet } = await import('../functions/api/ask/thread/[id].js');
    const db = await authDb();
    const res = await onRequestGet({
      request: mockRequest('GET', { url: 'https://rrmacademy.org/api/ask/thread/th_x' }),
      env: { DB: db, ANALYTICS_DB: analyticsDb() }, params: { id: 'th_x' }, waitUntil: mockWaitUntil(),
    });
    assert.equal((await parseResponse(res)).status, 401);
  });

  it('returns the owner’s turns', async () => {
    const { onRequestGet } = await import('../functions/api/ask/thread/[id].js');
    const db = await authDb();
    const env = { DB: db, ANALYTICS_DB: analyticsDb() };
    const id = await createThread(env, OWNER);
    const res = await onRequestGet({
      request: mockRequest('GET', { url: `https://rrmacademy.org/api/ask/thread/${id}`, headers: { Cookie: `session=${S_OWNER}` } }),
      env, params: { id }, waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.equal(body.thread_id, id);
    assert.ok(Array.isArray(body.turns));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-thread.test.js`
Expected: FAIL with `Cannot find module .../functions/api/ask/_thread.js`

- [ ] **Step 3: Write _thread.js**

Create `functions/api/ask/_thread.js`:

```js
/**
 * Thread state for AskRRM.
 *
 * WHY THE BOUNDS ARE THE INTERESTING PART. /generate refuses a serialized
 * prompt over 12,000 characters, and the thread carry composes INSIDE that
 * number, not on top of it. Three unbounded turns of a 500-character question
 * and a 1024-token answer would eat the budget on their own and turn every
 * fourth question in a conversation into a 400. So: 3 turns, 400 characters of
 * question, 900 of answer, and a hard 4,000-character total across all three.
 * Citations travel as IDS, never as re-serialized text.
 *
 * Ownership: loadThread returns null for a thread owned by someone else, the
 * same answer it gives for a thread that does not exist. A caller cannot tell
 * the two apart, which is the point.
 */
import { generateId } from '../auth/_shared.js';

export const MAX_TURNS = 3;
export const MAX_TURN_QUESTION = 400;
export const MAX_TURN_ANSWER = 900;
export const MAX_THREAD_CHARS = 4000;

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Bound a list of turns to what may be carried into a generation prompt.
 * Newest-last, oldest dropped first, and the total cap is applied after the
 * per-field truncation so the worst case is measurable rather than assumed.
 */
export function boundTurns(turns) {
  const list = Array.isArray(turns) ? turns.filter((t) => t && typeof t === 'object') : [];
  const recent = list.slice(-MAX_TURNS).map((t) => ({
    question: str(t.question).slice(0, MAX_TURN_QUESTION),
    answer: str(t.answer).slice(0, MAX_TURN_ANSWER),
    citation_ids: Array.isArray(t.citation_ids) ? t.citation_ids.map(String).slice(0, 8) : [],
  }));

  // Total cap. Drop whole turns from the front rather than cutting a sentence
  // in half: half a carried answer reads as a model that forgot, which is
  // worse than a model that was not told.
  let total = recent.reduce((n, t) => n + t.question.length + t.answer.length, 0);
  while (total > MAX_THREAD_CHARS && recent.length > 1) {
    const gone = recent.shift();
    total -= gone.question.length + gone.answer.length;
  }
  if (total > MAX_THREAD_CHARS && recent.length === 1) {
    const t = recent[0];
    const room = Math.max(0, MAX_THREAD_CHARS - t.question.length);
    t.answer = t.answer.slice(0, room);
  }
  return recent;
}

export async function createThread(env, userId) {
  const id = `th_${generateId().replace(/[^0-9a-f]/gi, '').toLowerCase().slice(0, 24).padEnd(24, '0')}`;
  await env.ANALYTICS_DB.prepare(
    'INSERT INTO ask_thread (id, user_id) VALUES (?, ?)'
  ).bind(id, userId).run();
  return id;
}

export async function touchThread(env, threadId) {
  try {
    await env.ANALYTICS_DB.prepare(
      "UPDATE ask_thread SET last_turn_at = datetime('now') WHERE id = ?"
    ).bind(threadId).run();
  } catch {
    // A missed touch costs an expiry sweep an hour of accuracy. It must never
    // cost the reader their answer.
  }
}

/**
 * @returns {{ id: string, turns: Array, nextTurn: number } | null}
 *   null when the thread is absent OR owned by another user.
 */
export async function loadThread(env, threadId, userId) {
  if (!env?.ANALYTICS_DB || typeof threadId !== 'string' || !threadId) return null;
  let row;
  try {
    row = await env.ANALYTICS_DB.prepare(
      'SELECT id, user_id FROM ask_thread WHERE id = ?'
    ).bind(threadId).first();
  } catch {
    return null;
  }
  if (!row || row.user_id !== userId) return null;

  let results = [];
  try {
    const out = await env.ANALYTICS_DB.prepare(
      'SELECT id, query, answer, citations_json, turn FROM ask_answer WHERE thread_id = ? ORDER BY turn ASC LIMIT 20'
    ).bind(threadId).all();
    results = out?.results || [];
  } catch {
    results = [];
  }

  const turns = results.map((r) => {
    let ids = [];
    try { ids = (JSON.parse(r.citations_json || '[]') || []).map((c) => c.slug || c.url).filter(Boolean); } catch { ids = []; }
    return { question: r.query, answer: r.answer, citation_ids: ids };
  });
  const nextTurn = results.length ? (Number(results[results.length - 1].turn) || results.length) + 1 : 1;
  return { id: row.id, turns, nextTurn };
}
```

- [ ] **Step 4: Write the read route**

Create `functions/api/ask/thread/[id].js`:

```js
/**
 * GET /api/ask/thread/:id -- the turns of one thread, for resume.
 *
 * Owner-gated, and a thread owned by someone else answers 404, exactly as a
 * missing one does. Read siblings before changing this: functions/api/ask/saved.js
 * is the closest neighbour and this file matches its auth shape.
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession } from '../../auth/_shared.js';
import { log } from '../../_log.js';
import { loadThread } from '../_thread.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, params, waitUntil }) {
  try {
    if (!env?.DB || !env?.ANALYTICS_DB) return json({ error: 'service_unavailable' }, 503);

    const session = await validateSession(env.DB, getSessionIdFromCookie(request));
    if (!session) return json({ error: 'unauthorized' }, 401);

    const id = typeof params?.id === 'string' ? params.id : '';
    if (!id || id.length > 64) return json({ error: 'invalid_input' }, 400);

    const thread = await loadThread(env, id, session.userId);
    if (!thread) return json({ error: 'not_found' }, 404);

    return json({ thread_id: thread.id, turns: thread.turns, next_turn: thread.nextTurn });
  } catch (err) {
    log(env, waitUntil, 'ask', 'thread_get_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}

/** HEAD is answered by the GET handler above; this route serves JSON, not a page. */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'GET') return onRequestGet(context);
  return json({ error: 'method_not_allowed' }, 405);
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/ask-thread.test.js`
Expected: PASS, 11 subtests.

```bash
cat > /tmp/askrrm-p5-t1.msg <<'MSG'
feat(ask): thread bounds and the resume read path

Three turns, 400 characters of question, 900 of answer, and a hard 4000
character total, because the thread carry composes inside the 12,000 character
prompt cap rather than on top of it: unbounded, three turns would eat the budget
on their own and turn every fourth question in a conversation into a 400. Whole
turns are dropped from the front rather than a sentence being cut in half, since
half a carried answer reads as a model that forgot. Proof gate G11.

A thread owned by someone else answers 404, exactly as a missing one does.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask/_thread.js functions/api/ask/thread/ test/ask-thread.test.js
git commit -F /tmp/askrrm-p5-t1.msg
```

---

### Task 2: Carry the thread into generation

**Files:**
- Modify: `functions/api/ask.js`, `functions/api/ask/_engine.js`
- Test: `test/ask-thread-carry.test.js`

**Interfaces:**
- Consumes: `boundTurns`, `createThread`, `loadThread`, `touchThread` (Task 1).
- Produces: `POST /api/ask` with a valid owned `thread_id` carries the last three bounded turns into `/generate` and archives `turn = nextTurn`. With no `thread_id`, a new thread is created and returned in the payload as `thread_id`. The engine applies `boundTurns` again, defensively, so a caller that skipped it cannot blow the prompt.

- [ ] **Step 1: Write the failing test**

Create `test/ask-thread-carry.test.js`:

```js
/**
 * G5: a follow-up that only makes sense in thread is answered correctly WITH a
 * thread_id, and answered with the "cannot answer from this thread" refusal
 * WITHOUT one. The second half is editorial rule 14, and the only way to see it
 * is to look at what actually reached /generate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answer } from '../functions/api/ask/_engine.js';
import { MAX_THREAD_CHARS } from '../functions/api/ask/_thread.js';

const CHUNK = { key: '/library/a.md', text: 'T'.repeat(200), type: 'article', slug: 'a', url: 'https://rrmacademy.org/library/a/', title: 'A' };

/** Captures the body /generate actually received. */
function recordingAiSearch(sink) {
  return { async fetch(url, init) {
    const p = new URL(url).pathname;
    if (p === '/retrieve') return new Response(JSON.stringify({ chunks: [CHUNK], retrieval_ms: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (p === '/generate') {
      sink.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ answer: 'Prose.', usage: null, neurons: null, model: 'm' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (p === '/resolve') return new Response(JSON.stringify({ resolved: [{ url: CHUNK.url, status: 'published' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('{}', { status: 404 });
  } };
}

function env(sink) {
  return {
    AI_SEARCH: recordingAiSearch(sink), AI_SEARCH_WORKER_AUTH: 'tok',
    AI: { async run() { return { response: 'What does the library say about this exact topic?' }; } },
    COMMUNITY_KV: { async get(k) { return k === 'feature:ask_pipeline_v3' ? 'on' : null; } },
    LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok',
    fetchImpl: async () => new Response(JSON.stringify({ claims_found: 0, verified: 0, warnings: [], errors: [], passed: true, related: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    EVENTS: { writeDataPoint() {} },
  };
}

describe('thread carry into /generate', () => {
  it('sends the last three turns and no more', async () => {
    const sink = [];
    const thread = Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}`, citation_ids: [`c${i}`] }));
    await answer({ message: 'and what about surgery?', thread, register: 'patient', env: env(sink), waitUntil: () => {} });
    const sent = sink[0].turns;
    // Three carried turns plus the current question, which the engine appends.
    assert.equal(sent.length, 4);
    assert.equal(sent[0].question, 'Q3');
    assert.equal(sent[2].question, 'Q5');
  });

  it('bounds an oversized thread even when the caller did not', async () => {
    const sink = [];
    const fat = Array.from({ length: 3 }, () => ({ question: 'q'.repeat(5000), answer: 'a'.repeat(9000), citation_ids: [] }));
    await answer({ message: 'follow up', thread: fat, register: 'patient', env: env(sink), waitUntil: () => {} });
    const carried = sink[0].turns.slice(0, -1);
    const total = carried.reduce((n, t) => n + t.question.length + t.answer.length, 0);
    assert.ok(total <= MAX_THREAD_CHARS, `engine carried ${total} characters past the ${MAX_THREAD_CHARS} cap`);
  });

  it('carries citation ids only, never citation text', async () => {
    const sink = [];
    const thread = [{ question: 'Q', answer: 'A', citation_ids: ['slug-one'], citations: [{ url: 'https://x', title: 'a very long title indeed' }] }];
    await answer({ message: 'follow up', thread, register: 'patient', env: env(sink), waitUntil: () => {} });
    const body = JSON.stringify(sink[0]);
    assert.ok(!body.includes('a very long title indeed'), 'citation text was re-serialized into the prompt');
    assert.ok(body.includes('slug-one'));
  });

  it('with no thread, the prompt carries only the current question', async () => {
    const sink = [];
    await answer({ message: 'a standalone question about charting?', register: 'patient', env: env(sink), waitUntil: () => {} });
    assert.equal(sink[0].turns.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-thread-carry.test.js`
Expected: FAIL. The engine slices the thread with a bare `slice(-3)` and does not bound it.

- [ ] **Step 3: Bound the thread in the engine**

In `functions/api/ask/_engine.js`, import:

```js
import { boundTurns } from './_thread.js';
```

In `runPipeline`, replace `const turns = (thread || []).slice(-3);` with:

```js
  // Bounded again here, deliberately. ask.js bounds before it calls, and a
  // caller that skipped it, including the eval worker and any future API
  // client, must not be able to blow the prompt budget from outside.
  const turns = boundTurns(thread);
```

- [ ] **Step 4: Create or resume the thread in ask.js**

In `functions/api/ask.js`, import:

```js
import { createThread, loadThread, touchThread, boundTurns } from './ask/_thread.js';
```

After the `validateBody` block, replace the bare `const threadId = validated.data.thread_id || null;` with:

```js
  // A missing or FOREIGN thread id starts a new thread. Not an error: a shared
  // link, an expired thread and a typo all land here, and none of them is worth
  // refusing a question over.
  let thread = validated.data.thread_id ? await loadThread(env, validated.data.thread_id, user.id) : null;
  if (!thread) {
    try {
      const fresh = await createThread(env, user.id);
      thread = { id: fresh, turns: [], nextTurn: 1 };
    } catch (err) {
      // A thread is a convenience. Losing it must not cost the answer.
      log(env, waitUntil, 'ask', 'thread_create_failed', 'warn', err.message, 0, 200);
      thread = { id: null, turns: [], nextTurn: 1 };
    }
  }
  const threadId = thread.id;
  const carried = boundTurns(thread.turns);
```

Pass the thread into the engine, in both the SSE and JSON branches:

```js
      const result = await engineAnswer({ message, thread: carried, register: ASK_REGISTER, env, waitUntil, onStage: emitStage });
```

In the `archive` closure, change `turn: 1,` to `turn: thread.nextTurn,` and add the touch to the same `waitUntil` block:

```js
    if (threadId) waitUntil(touchThread(env, threadId));
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test test/ask-thread-carry.test.js test/ask-quota-do.test.js test/ask-engine-v3.test.js`
Expected: PASS.

```bash
cat > /tmp/askrrm-p5-t2.msg <<'MSG'
feat(ask): read the thread into generation

thread_id has been accepted and stored since P2; it is now read. A missing or
foreign id starts a new thread rather than refusing the question, because a
shared link, an expired thread and a typo all land there and none is worth
refusing over. The engine bounds the carry again itself, so a caller that
skipped it cannot blow the prompt budget from outside.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask.js functions/api/ask/_engine.js test/ask-thread-carry.test.js
git commit -F /tmp/askrrm-p5-t2.msg
```

---

### Task 3: Feedback endpoint

**Files:**
- Create: `functions/api/ask/feedback.js`
- Test: `test/ask-feedback.test.js`

**Interfaces:**
- Consumes: `json`, `optionsResponse`, `getSessionIdFromCookie`, `validateSession`, `checkRateLimit`, `generateId`; `validateBody` from `functions/api/_validate.js`.
- Produces: `POST /api/ask/feedback`, body `{ ask_answer_id: number|string, verdict: 'helpful'|'not_helpful'|'report', note?: string }`. Owner-gated against `ask_answer.user_id`. Eval rows (user_id NULL) answer 403. `note` capped at 500. Repeat submissions upsert on the `UNIQUE(user_id, ask_answer_id)` pair.

- [ ] **Step 1: Write the failing test**

Create `test/ask-feedback.test.js`:

```js
/**
 * POST /api/ask/feedback.
 *
 * The ownership check is the whole security surface here: without it, any
 * signed-in user could write a verdict onto any answer, including the eval
 * worker's rows, and the "report" queue the digest reads would be writable by
 * anyone with an account.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockWaitUntil, parseResponse, mockKV } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const { onRequestPost } = await import('../functions/api/ask/feedback.js');

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const OWNER = 'u_fb_owner';
const OTHER = 'u_fb_other';
const S_OWNER = 'sess-fb-owner';
const S_OTHER = 'sess-fb-other';

async function authDb() {
  const db = sqliteD1({ seed(s) {
    insertUser(s, { id: OWNER, email: 'fbowner@example.com', role: 'member', name: 'O', email_verified: 1 });
    insertUser(s, { id: OTHER, email: 'fbother@example.com', role: 'member', name: 'X', email_verified: 1 });
  } });
  await insertSession(db._sqlite, { rawId: S_OWNER, userId: OWNER, expiresAt: FUTURE });
  await insertSession(db._sqlite, { rawId: S_OTHER, userId: OTHER, expiresAt: FUTURE });
  return db;
}

/** ask_answer rows: 1 owned by OWNER, 2 an eval row with no owner. */
function analyticsDb() {
  const writes = [];
  const owners = new Map([[1, OWNER], [2, null]]);
  return {
    writes,
    prepare(sql) {
      let bound = [];
      return {
        bind(...a) { bound = a; return this; },
        async first() {
          if (sql.includes('FROM ask_answer')) {
            const id = Number(bound[0]);
            return owners.has(id) ? { id, user_id: owners.get(id) } : null;
          }
          return null;
        },
        async run() { writes.push({ sql, bound }); return { success: true, meta: { changes: 1 } }; },
      };
    },
  };
}

function env(db, adb) {
  return { DB: db, ANALYTICS_DB: adb, COMMUNITY_KV: mockKV() };
}

const ctx = (e, session, body) => ({
  request: mockRequest('POST', { url: 'https://rrmacademy.org/api/ask/feedback', headers: { Cookie: `session=${session}` }, body }),
  env: e, waitUntil: mockWaitUntil(),
});

describe('POST /api/ask/feedback', () => {
  it('accepts a verdict on the caller’s own answer', async () => {
    const e = env(await authDb(), analyticsDb());
    const { status, body } = await parseResponse(await onRequestPost(ctx(e, S_OWNER, { ask_answer_id: 1, verdict: 'helpful' })));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const w = e.ANALYTICS_DB.writes.find((x) => x.sql.includes('ask_feedback'));
    assert.ok(w, 'no ask_feedback write');
    assert.ok(w.sql.includes('ON CONFLICT'), 'the write must upsert, not insert');
  });

  it('403s a verdict on someone else’s answer', async () => {
    const e = env(await authDb(), analyticsDb());
    assert.equal((await parseResponse(await onRequestPost(ctx(e, S_OTHER, { ask_answer_id: 1, verdict: 'report' })))).status, 403);
    assert.equal(e.ANALYTICS_DB.writes.length, 0, 'nothing may be written on a refusal');
  });

  it('403s a verdict on an eval row, which has no owning user', async () => {
    const e = env(await authDb(), analyticsDb());
    assert.equal((await parseResponse(await onRequestPost(ctx(e, S_OWNER, { ask_answer_id: 2, verdict: 'helpful' })))).status, 403);
  });

  it('404s an ask_answer_id that does not exist', async () => {
    const e = env(await authDb(), analyticsDb());
    assert.equal((await parseResponse(await onRequestPost(ctx(e, S_OWNER, { ask_answer_id: 999, verdict: 'helpful' })))).status, 404);
  });

  it('400s an unknown verdict', async () => {
    const e = env(await authDb(), analyticsDb());
    assert.equal((await parseResponse(await onRequestPost(ctx(e, S_OWNER, { ask_answer_id: 1, verdict: 'amazing' })))).status, 400);
  });

  it('caps the note at 500 characters', async () => {
    const e = env(await authDb(), analyticsDb());
    assert.equal((await parseResponse(await onRequestPost(ctx(e, S_OWNER, { ask_answer_id: 1, verdict: 'report', note: 'n'.repeat(501) })))).status, 400);
  });

  it('401s with no session', async () => {
    const e = env(await authDb(), analyticsDb());
    const res = await onRequestPost({
      request: mockRequest('POST', { url: 'https://rrmacademy.org/api/ask/feedback', body: { ask_answer_id: 1, verdict: 'helpful' } }),
      env: e, waitUntil: mockWaitUntil(),
    });
    assert.equal((await parseResponse(res)).status, 401);
  });

  it('503s with no ANALYTICS_DB binding rather than returning a cheerful 200', async () => {
    const e = { DB: await authDb(), COMMUNITY_KV: mockKV() };
    assert.equal((await parseResponse(await onRequestPost(ctx(e, S_OWNER, { ask_answer_id: 1, verdict: 'helpful' })))).status, 503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-feedback.test.js`
Expected: FAIL with `Cannot find module .../functions/api/ask/feedback.js`

- [ ] **Step 3: Write the endpoint**

Create `functions/api/ask/feedback.js`:

```js
/**
 * POST /api/ask/feedback -- helpful, not helpful, or report, on one answer.
 *
 * OWNERSHIP IS THE SECURITY SURFACE. Without the check below, any signed-in
 * user could write a verdict onto any answer, including the eval worker's rows,
 * and the "report" queue the weekly digest reads would be writable by anyone
 * with an account. The owner is read from ask_answer.user_id and compared to
 * the SESSION user, never to anything in the request body.
 *
 * Eval rows carry a NULL user_id and are refused with 403: there is no person
 * whose opinion that row could be.
 *
 * The write upserts on the UNIQUE(user_id, ask_answer_id) pair from the P2
 * migration. One verdict per person per answer, latest wins.
 */
import { json, optionsResponse, getSessionIdFromCookie, validateSession, checkRateLimit, generateId } from '../auth/_shared.js';
import { validateBody } from '../_validate.js';
import { log } from '../_log.js';

const VERDICTS = ['helpful', 'not_helpful', 'report'];

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    if (!env?.DB) return json({ error: 'service_unavailable' }, 503);
    if (!env?.ANALYTICS_DB) return json({ error: 'service_unavailable' }, 503);

    const session = await validateSession(env.DB, getSessionIdFromCookie(request));
    if (!session) return json({ error: 'unauthorized' }, 401);

    const allowed = await checkRateLimit(env, `ask_feedback:${session.userId}`, 60, 3600);
    if (!allowed) return json({ error: 'rate_limited' }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_input' }, 400); }

    const validated = validateBody(body, {
      ask_answer_id: { type: 'number', required: true, min: 1 },
      verdict: { type: 'enum', required: true, values: VERDICTS },
      note: { type: 'string', required: false, maxLength: 500 },
    });
    if (!validated.valid) return json({ error: 'invalid_input' }, 400);
    const { ask_answer_id: askAnswerId, verdict, note } = validated.data;

    const row = await env.ANALYTICS_DB.prepare(
      'SELECT id, user_id FROM ask_answer WHERE id = ?'
    ).bind(askAnswerId).first();
    if (!row) return json({ error: 'not_found' }, 404);
    if (!row.user_id || row.user_id !== session.userId) return json({ error: 'forbidden' }, 403);

    await env.ANALYTICS_DB.prepare(
      `INSERT INTO ask_feedback (id, ask_answer_id, user_id, verdict, note)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, ask_answer_id)
       DO UPDATE SET verdict = excluded.verdict, note = excluded.note, created_at = datetime('now')`
    ).bind(generateId(), String(askAnswerId), session.userId, verdict, note || null).run();

    return json({ ok: true, verdict });
  } catch (err) {
    log(env, waitUntil, 'ask', 'feedback_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return onRequestOptions();
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
```

- [ ] **Step 4: Run tests, gates, and commit**

```bash
node --test test/ask-feedback.test.js
npm run gates:sql
npx arise-scan --json --files functions/api/ask/feedback.js functions/api/ask/thread/[id].js
```
Expected: tests PASS, gates PASS, scanner reports no findings.

```bash
cat > /tmp/askrrm-p5-t3.msg <<'MSG'
feat(ask): feedback endpoint with ownership

helpful, not helpful, report. The owner is read from ask_answer.user_id and
compared to the session user, never to anything in the body: without that check
any signed-in user could write a verdict onto any answer and the report queue
the digest reads would be writable by anyone with an account. Eval rows carry no
owning user and are refused. The write upserts on the unique pair, so one person
gets one verdict per answer and the latest wins.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask/feedback.js test/ask-feedback.test.js
git commit -F /tmp/askrrm-p5-t3.msg
```

---

### Task 4: The trust surface on the page

**Files:**
- Modify: `src/pages/ask.astro`
- Test: none automated beyond the render check below. This is browser UI; the instrument is the rendered page.

**Interfaces:**
- Consumes: the `/api/ask` payload from P3: `{ answer, citations, grounded_in, unverified, related, fallback?, thread_id?, _meta }`; `POST /api/ask/feedback`.
- Produces: rendered citations with type badges, a collapsible grounded-in panel, unverified marks, a related list, three feedback buttons per answer, and `thread_id` carried on every follow-up in the session.

- [ ] **Step 1: Render typed citations**

Replace `renderCitations` with:

```js
      var TYPE_LABEL = { article: 'Article', commentary: 'Commentary', faq: 'FAQ', glossary: 'Glossary', guide: 'Guide', fact: 'Verified fact' };

      function renderCitations(list) {
        if (!list || !list.length) return '';
        var items = list.map(function (c) {
          var url = c.url || '#';
          var title = c.title || url;
          var label = TYPE_LABEL[c.type] || 'Source';
          return '<li><span class="ask-badge ask-badge--' + escapeHtml(c.type || 'source') + '">' + escapeHtml(label) + '</span>' +
            '<a href="' + escapeHtml(url) + '" rel="noopener">' + escapeHtml(title) + '</a></li>';
        }).join('');
        return '<ul class="ask-citations">' + items + '</ul>';
      }
```

- [ ] **Step 2: Render the grounded-in panel, the unverified marks and related**

Add beside it:

```js
      // "Grounded in" lists what was RETRIEVED, including records the answer
      // did not cite. That is the point: it shows the reader the corpus edge,
      // which a citation list alone cannot.
      function renderGroundedIn(groundedIn, citations) {
        if (!groundedIn || groundedIn.length === 0) return '';
        var cited = {};
        (citations || []).forEach(function (c) { cited[c.url] = true; });
        var items = groundedIn.map(function (g) {
          var mark = cited[g.url] ? '' : ' <span class="ask-grounded__uncited">not cited</span>';
          return '<li><a href="' + escapeHtml(g.url || '#') + '" rel="noopener">' + escapeHtml(g.title || g.url) + '</a>' + mark + '</li>';
        }).join('');
        return '<details class="ask-grounded"><summary>Grounded in ' + groundedIn.length + ' record' + (groundedIn.length === 1 ? '' : 's') + '</summary><ul>' + items + '</ul></details>';
      }

      // A figure the library worker could not confirm gets a mark, in the
      // words the spec fixes: "not in our verified facts". It marks the
      // SENTENCE, not the whole answer, so the reader can see which number.
      function markUnverified(html, unverified) {
        if (!unverified || unverified.length === 0) return html;
        var out = html;
        unverified.forEach(function (sentence) {
          var needle = escapeHtml(sentence);
          if (out.indexOf(needle) === -1) return;
          out = out.replace(needle, needle + ' <span class="ask-unverified" title="not in our verified facts">not in our verified facts</span>');
        });
        return out;
      }

      function renderRelated(list) {
        if (!list || !list.length) return '';
        var items = list.map(function (rrec) {
          return '<li><a href="' + escapeHtml(rrec.url || '#') + '" rel="noopener">' + escapeHtml(rrec.title || rrec.url) + '</a></li>';
        }).join('');
        return '<div class="ask-related"><h3>Related</h3><ul>' + items + '</ul></div>';
      }
```

- [ ] **Step 3: Extend appendMessage and the actions row**

Change `appendMessage(role, text, citations)` to `appendMessage(role, text, data)` where `data` is the whole payload, and build the assistant body as:

```js
        if (role === 'assistant') {
          body = '<div class="ask-msg__body">' + markUnverified(bodyHtml, data && data.unverified) + '</div>';
          body += renderCitations(data && data.citations);
          body += renderGroundedIn(data && data.grounded_in, data && data.citations);
          body += renderRelated(data && data.related);
          body += renderActions();
        }
```

and stash the answer id for the feedback buttons:

```js
          wrap.dataset.askAnswerId = (data && data.ask_answer_id) || '';
```

In `renderActions()`, append the three buttons:

```js
          '<button type="button" class="ask-action" data-fb="helpful">Helpful</button>' +
          '<button type="button" class="ask-action" data-fb="not_helpful">Not helpful</button>' +
          '<button type="button" class="ask-action ask-action--report" data-fb="report">Report</button>'
```

Every call site of `appendMessage('assistant', ...)` passes the payload object instead of `d.citations`.

- [ ] **Step 4: Wire the feedback click**

In the existing `thread.addEventListener('click', ...)` handler, add a branch:

```js
        var fbBtn = e.target.closest('[data-fb]');
        if (fbBtn) {
          var msgEl = fbBtn.closest('.ask-msg');
          var answerId = msgEl && msgEl.dataset.askAnswerId;
          if (!answerId) { fbBtn.textContent = 'Not available'; return; }
          fbBtn.disabled = true;
          fetch('/api/ask/feedback', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ask_answer_id: Number(answerId), verdict: fbBtn.getAttribute('data-fb') }),
          })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              var group = msgEl.querySelectorAll('[data-fb]');
              for (var i = 0; i < group.length; i++) group[i].disabled = true;
              fbBtn.textContent = d && d.ok ? 'Thank you' : 'Could not save';
            })
            .catch(function () { fbBtn.disabled = false; fbBtn.textContent = 'Try again'; });
          return;
        }
```

- [ ] **Step 5: Carry the thread**

Add a module-scope `var currentThreadId = null;` beside `lastQuestion`. In `runAsk`, send it and keep what comes back:

```js
          body: JSON.stringify(currentThreadId ? { message: message, thread_id: currentThreadId } : { message: message }),
```

and in the success branch, before `appendMessage`:

```js
              if (d.thread_id) currentThreadId = d.thread_id;
```

The "New question" affordance clears it: add a small button beside the composer whose click sets `currentThreadId = null` and empties the thread element.

- [ ] **Step 6: Return ask_answer_id to the client**

The feedback buttons need an id the archive write produces. In `functions/api/ask.js`, the archive runs in `waitUntil` AFTER the response, so the id is not available in time. Change `archive` to run the two inserts BEFORE building the payload on the JSON path, and keep `waitUntil` only for the touch:

```js
  const archived = await archive(result); // returns { askAnswerId } or {} on failure
  return json({ ...buildPayload(result), ...(archived.askAnswerId ? { ask_answer_id: archived.askAnswerId } : {}) }, 200, rlHeaders);
```

`archive` keeps its own try/catch and returns `{}` on any failure, so an analytics outage still serves the answer, now without feedback buttons rather than with broken ones. On the SSE path the same applies, inside the stream closure.

This is a DELIBERATE move of work back onto the hot path, and it costs one D1 insert of latency. The alternative is a second round trip from the page to look the id up, which costs more and can fail separately.

- [ ] **Step 7: Style the new elements**

Add to the page's `<style>` block, using only tokens that exist in `docs/design/design-system.json` (read it first, do not guess a token name):

```css
  .ask-badge { display: inline-block; font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.04em; padding: 0.1em 0.5em; border-radius: var(--radius-sm); background: var(--color-surface-alt); color: var(--color-text-muted); margin-right: var(--space-2); }
  .ask-grounded { margin-top: var(--space-3); font-size: var(--font-size-sm); }
  .ask-grounded__uncited { color: var(--color-text-muted); font-size: var(--font-size-xs); }
  .ask-unverified { font-size: var(--font-size-xs); color: var(--color-text-muted); border-bottom: 1px dotted currentColor; }
  .ask-related { margin-top: var(--space-4); }
  .ask-related h3 { font-size: var(--font-size-sm); margin-bottom: var(--space-2); }
```

- [ ] **Step 8: Verify in a browser, not by grep**

```bash
npm run build
npx wrangler pages dev dist
```
Open `http://localhost:8788/ask/` in claude-in-chrome, sign in, ask a question, and confirm by SCREENSHOT: type badges render, the grounded-in panel opens, an unverified mark appears when one is returned, the related list renders, and all three feedback buttons disable together after a click. A 200 from curl is not evidence that any of this rendered.

Then check the phone width: resize to 400px and confirm nothing overflows horizontally.

- [ ] **Step 9: Run the gates and commit**

```bash
npm run design-tokens:check
npm run guard
npm test
npm run quality:coverage
```
Expected: all PASS.

```bash
cat > /tmp/askrrm-p5-t4.msg <<'MSG'
feat(ask): the trust surface

Citations carry a type badge that comes off the engine-built citation object,
so the page never re-derives a type from a URL shape. A grounded-in panel lists
what was retrieved INCLUDING records the answer did not cite, which is the only
way a reader can see the corpus edge. Unverified figures are marked on the
sentence, in the words the spec fixes. Three feedback buttons per answer, and
every errorCode has its own copy.

The archive write moved onto the hot path so the response can carry
ask_answer_id: the alternative was a second round trip from the page to look it
up, which costs more and can fail separately. An analytics outage now serves the
answer without feedback buttons rather than with broken ones.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add src/pages/ask.astro functions/api/ask.js
git commit -F /tmp/askrrm-p5-t4.msg
```

---

### Task 5: Capability JSON and the proofs

**Files:**
- Modify: `functions/api/ask.js`, `docs/architecture/api-inventory.md`

**Interfaces:**
- Produces: `GET /api/ask` lists the two new routes and the payload's new fields.

- [ ] **Step 1: Extend the capability JSON**

In `CAPABILITY_JSON`, change `response.shape` and add a `routes` block:

```js
  routes: {
    'POST /api/ask': 'answer; body { message, thread_id? }; JSON or SSE by Accept',
    'POST /api/ask/feedback': 'body { ask_answer_id, verdict: helpful|not_helpful|report, note? }; session, owner only',
    'GET /api/ask/thread/:id': 'turns for resume; session, owner only',
    'GET /api/ask/saved': 'saved answers; unchanged',
    'GET /api/ask/sandbox': 'canned response for client integration; no auth',
  },
  response: {
    shape: {
      answer: 'string',
      citations: '{url, title, type, slug}[]',
      grounded_in: '{url, title, type, slug}[]',
      unverified: 'string[] (sentences not matched against verified facts)',
      related: '{url, title, type, slug}[]',
      ask_answer_id: 'number, present when the archive write succeeded',
      thread_id: 'string',
      _meta: { response_type: 'string', version: 'string' },
    },
    sse_events: ['data: {"stage":"..."}', 'data: <answer-json>', 'data: [DONE]'],
  },
```

- [ ] **Step 2: Add the rows to the API inventory**

In `docs/architecture/api-inventory.md`, add one row each for `POST /api/ask/feedback` and `GET /api/ask/thread/:id`, matching the file's existing column shape.

- [ ] **Step 3: Deploy (Brian's go required) and prove G5 and G7**

**HUMAN CHECKPOINT**, then push, then:

G5, both halves, against the live surface with a member session:

```bash
node -e '
const S = process.env.RRM_SESSION;
const ask = (body) => fetch("https://rrmacademy.org/api/ask", {
  method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: `session=${S}`, Origin: "https://rrmacademy.org" },
  body: JSON.stringify(body),
}).then(r => r.json());
(async () => {
  const first = await ask({ message: "How is endometriosis treated in RRM?" });
  console.log("turn 1 thread:", first.thread_id, first.citations.length, "citations");
  const follow = await ask({ message: "and what about recurrence after that?", thread_id: first.thread_id });
  console.log("turn 2 WITH thread:", follow.answer.slice(0, 120));
  const alone = await ask({ message: "and what about recurrence after that?" });
  console.log("turn 2 WITHOUT thread:", alone.answer.slice(0, 160));
})();
'
```
Expected: the WITH-thread answer is about endometriosis recurrence and carries citations. The WITHOUT-thread answer says it cannot answer from this conversation, per editorial rule 14. Read both by eye: this half of G5 is a judgement, not a string match.

G7: click Report on an answer on the live page, then confirm the row landed:

```bash
npx wrangler@4.62.0 d1 execute rrm-analytics --remote --command \
  "SELECT id, ask_answer_id, verdict, created_at FROM ask_feedback WHERE verdict = 'report' ORDER BY created_at DESC LIMIT 5"
```
Expected: the click's row. The digest half of G7 (it appears in the weekly digest within seven days) is P6.

- [ ] **Step 4: Rerun the golden set and commit**

```bash
EVAL_TOKEN=$(op read 'op://Automation/RRM Ask Eval Worker Token/credential') \
  node scripts/ask-eval/run.mjs --eval --golden --tag "golden-$(date -u +%Y-%m-%d)-p5"
```
Expected: `GOLDEN PASS`.

```bash
cat > /tmp/askrrm-p5-t5.msg <<'MSG'
feat(ask): capability JSON lists the thread and feedback routes

Plus the payload's new fields. An API-first surface that does not describe its
own routes is API-first in name only.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask.js docs/architecture/api-inventory.md scripts/ask-eval/runs/
git commit -F /tmp/askrrm-p5-t5.msg
git push origin main
```

---

## Self-review

**Spec coverage.** Section 9's `ask_thread` table is used here (created in P2); "the last 3 turns, question and answer text, citations by id", the 400 and 900 truncations and the 4,000-character total are Task 1's `boundTurns`, asserted in three tests; "a missing or foreign id starts a new thread" is Task 2 Step 4; "threads expire from the page after 24 hours, rows are kept" is the page's own `currentThreadId` lifetime plus `touchThread`, and no sweep is added because the spec says rows are kept. Section 10's three new or changed routes are Tasks 1, 3 and 5; "every response carries RateLimit-Limit and RateLimit-Remaining on JSON and SSE alike" was done in P2 and is unchanged here; "a bearer variant is reserved and not built" is honored by not building it. Section 10's feedback-ownership paragraph, the 500-character note cap, and the upsert are Task 3. Section 11's six bullets are Task 4: typed citations off the citation object rather than re-derived from the URL, the grounded-in disclosure including uncited records, the "not in our verified facts" mark in those exact words, the three feedback controls, related, and the error map (landed in P3 Task 4 and unchanged here). Section 14 step 5 is this whole plan. G5 is Task 5 Step 3; G7's write half is Task 5 Step 3 and its digest half is P6; G11 is Task 1's unit tests plus Task 2's defensive bound.

**Placeholder scan.** Task 4 is UI and says so: its instrument is a screenshot at two widths, not a grep, and Step 8 says exactly what to look at. Step 7's CSS says to read the design-system SSOT before using a token rather than trusting the names written there, which is the repo's standing rule.

**Type consistency.** `Turn = { question, answer, citation_ids }` is the same three keys in `boundTurns`, in `loadThread`'s mapping, in the `/generate` body, and in the `GET /api/ask/thread/:id` response. `loadThread` returns `{ id, turns, nextTurn }` and every reader uses those names. `Citation = { url, title, type, slug }` is unchanged from P2 and is what `renderCitations`, `renderGroundedIn` and `renderRelated` all read. `ask_answer_id` is a number in the request body, validated as `{ type: 'number', min: 1 }`, and the page sends `Number(answerId)` to match; `ask_feedback.ask_answer_id` is TEXT in the migration and the insert binds `String(askAnswerId)`, which is deliberate and stated at the call site.
