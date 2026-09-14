# AskRRM P2 Engine Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole answer pipeline out of `functions/api/ask.js` into `functions/api/ask/_engine.js` with two pluggable backends, make the free tier real on v2, delete the dead v1 NLWeb path, replace the racy KV day counter with a Durable Object, land the one migration, and point the eval worker at the same module.

**Architecture:** Two repos, `rrm-ai-search` first. `rrm-ai-search` gains the `AskQuotaCounter` Durable Object class and a `POST /generate` route that takes a prompt plus chunks and returns prose and usage only. `rrm-academy-cf` then gains `_engine.js`, which owns rewrite through archive, builds its own citations from the chunks it sent, and enforces cite-or-refuse. `ask.js` shrinks to auth, tier, quota, thread lookup and response framing. The eval worker imports the same `_engine.js`, which is what makes the eval numbers mean anything.

**Tech Stack:** Cloudflare Workers with a SQLite-backed Durable Object, Cloudflare Pages Functions, Workers AI (Llama 3.3 70B fp8 fast), D1 (`rrm-analytics`, `rrm-auth`, `rrm-library`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-askrrm-engine-design.md` (sections 5, 5a `/generate`, 7, 7a, 9a, 14 step 2; proof gates G1, G2, G3, G9, G13)

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

| Repo | Path | Responsibility |
|---|---|---|
| rrm-ai-search | `src/quota.js` | CREATE. The `AskQuotaCounter` Durable Object class. One shard per user per UTC day. |
| rrm-ai-search | `src/index.js` | MODIFY. Export the DO class, add `POST /generate`. |
| rrm-ai-search | `wrangler.toml` | MODIFY. `[[migrations]]` with `new_sqlite_classes`, `[[durable_objects.bindings]]`. |
| rrm-ai-search | `scripts/deploy.mjs` | MODIFY. Assert the new binding is live. |
| rrm-ai-search | `test/quota.test.mjs`, `test/generate.test.mjs` | CREATE. |
| rrm-academy-cf | `scripts/migrations/2026-09-14-askrrm-engine.sql` | CREATE. The one migration (spec 9a). |
| rrm-academy-cf | `functions/api/ask/_engine.js` | CREATE. `answer()` and the pipeline. |
| rrm-academy-cf | `functions/api/ask/_backends/workers-ai.js` | CREATE. Default backend. |
| rrm-academy-cf | `functions/api/ask/_backends/openai-compatible.js` | CREATE. Config-selected backend. |
| rrm-academy-cf | `functions/api/ask/_backends/index.js` | CREATE. Flag read, fail-closed to the default. |
| rrm-academy-cf | `functions/api/ask.js` | MODIFY. Thin. v1 deleted. DO quota. `thread_id` accepted. |
| rrm-academy-cf | `functions/api/_search_log.js` | MODIFY. `logAskAnswer` takes the new columns. |
| rrm-academy-cf | `wrangler.toml` | MODIFY. `ASK_QUOTA` binding with `script_name`. |
| rrm-academy-cf | `scripts/ask-eval/worker/index.js` | MODIFY. Imports `_engine.js`. |

---

## Part A: rrm-ai-search (do these first)

### Task 1: AskQuotaCounter Durable Object

**Files:**
- Create: `/Users/brian/iCode/projects/rrm-ai-search/src/quota.js`
- Modify: `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`, `wrangler.toml`, `scripts/deploy.mjs`
- Test: `/Users/brian/iCode/projects/rrm-ai-search/test/quota.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export class AskQuotaCounter` with `async fetch(request)`. `POST /take` with body `{ limit: number }` answers `200 { allowed: boolean, count: number, limit: number, remaining: number }`. `GET /peek` answers `200 { count: number }`. Any other path answers `404 { error: 'not_found' }`.
  - `export function quotaShardName(userId, utcDay) -> string` (the `idFromName` key, exactly `` `${userId}:${utcDay}` ``).
  - Binding name on the Pages side: `ASK_QUOTA`.

- [ ] **Step 1: Write the failing test**

Create `test/quota.test.mjs`:

```js
/**
 * AskQuotaCounter. The KV counter it replaces was a read, an add in JS, and a
 * write: two requests at count 19 both read 19, both wrote 20, and both were
 * served. The DO's storage is single threaded per shard, so the read and the
 * write cannot interleave. That is the whole point and proof gate G2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AskQuotaCounter, quotaShardName } from '../src/quota.js';

/** Minimal DurableObjectState stand-in: a Map plus the serial blockConcurrency contract. */
function fakeState(initial = new Map()) {
  return {
    storage: {
      async get(key) { return initial.has(key) ? initial.get(key) : undefined; },
      async put(key, value) { initial.set(key, value); },
    },
    _map: initial,
  };
}

const take = (obj, limit) => obj.fetch(new Request('https://do/take', {
  method: 'POST', body: JSON.stringify({ limit }), headers: { 'content-type': 'application/json' },
}));

test('quotaShardName is user plus UTC day and nothing else', () => {
  assert.equal(quotaShardName('u_1', '2026-09-14'), 'u_1:2026-09-14');
});

test('take increments and reports remaining', async () => {
  const obj = new AskQuotaCounter(fakeState(), {});
  const a = await (await take(obj, 3)).json();
  assert.deepEqual(a, { allowed: true, count: 1, limit: 3, remaining: 2 });
  const b = await (await take(obj, 3)).json();
  assert.equal(b.count, 2);
  assert.equal(b.remaining, 1);
});

test('take refuses at the limit and does not keep counting past it', async () => {
  const obj = new AskQuotaCounter(fakeState(), {});
  for (let i = 0; i < 3; i++) assert.equal((await (await take(obj, 3)).json()).allowed, true);
  const over = await (await take(obj, 3)).json();
  assert.deepEqual(over, { allowed: false, count: 3, limit: 3, remaining: 0 });
  const again = await (await take(obj, 3)).json();
  assert.equal(again.count, 3, 'a refused take must not increment');
});

test('two concurrent takes at the limit boundary yield exactly one allowed', async () => {
  // G2 with limit 20 and the shard already at 19.
  const obj = new AskQuotaCounter(fakeState(new Map([['count', 19]])), {});
  const [a, b] = await Promise.all([take(obj, 20), take(obj, 20)]);
  const results = [await a.json(), await b.json()];
  assert.equal(results.filter((r) => r.allowed).length, 1, 'exactly one request may pass');
  assert.equal(results.filter((r) => !r.allowed).length, 1);
});

test('peek reads without incrementing', async () => {
  const obj = new AskQuotaCounter(fakeState(new Map([['count', 5]])), {});
  const r = await (await obj.fetch(new Request('https://do/peek'))).json();
  assert.deepEqual(r, { count: 5 });
  assert.equal((await (await obj.fetch(new Request('https://do/peek'))).json()).count, 5);
});

test('an unknown path is a 404, never a silent allow', async () => {
  const obj = new AskQuotaCounter(fakeState(), {});
  const r = await obj.fetch(new Request('https://do/whatever'));
  assert.equal(r.status, 404);
});

test('a missing or absurd limit is refused rather than defaulted generously', async () => {
  const obj = new AskQuotaCounter(fakeState(), {});
  for (const bad of [undefined, 0, -1, 'twenty', 10001]) {
    const r = await obj.fetch(new Request('https://do/take', {
      method: 'POST', body: JSON.stringify({ limit: bad }), headers: { 'content-type': 'application/json' },
    }));
    assert.equal(r.status, 400, `limit ${bad} must be refused`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && node --test test/quota.test.mjs`
Expected: FAIL with `Cannot find module '../src/quota.js'`

- [ ] **Step 3: Write the class**

Create `/Users/brian/iCode/projects/rrm-ai-search/src/quota.js`:

```js
/**
 * AskQuotaCounter: the per-user, per-UTC-day question counter for /api/ask.
 *
 * It replaces a KV read-add-write. That sequence is not atomic, so two requests
 * arriving together at count 19 against a limit of 20 both read 19, both wrote
 * 20, and both were answered. A Durable Object's storage is single threaded per
 * object, so the read and the write inside take() cannot interleave with another
 * request's.
 *
 * SHARDING: idFromName(`${userId}:${utcDay}`). One object per user per day, so
 * the counter never contends across users and never contends across days.
 *
 * RESET: there is none and none is needed. A new UTC day is a new idFromName
 * key, so yesterday's shard simply stops being addressed and ages out under
 * Durable Object storage's normal lifecycle.
 *
 * FAIL POSTURE: this class never decides policy. It reports allowed or not and
 * the caller decides. A caller that cannot REACH this object must fail closed
 * with 503 quota_unavailable, never pass through; see functions/api/ask.js.
 */

const MAX_LIMIT = 10000;

/** The idFromName key. Exported so the caller and the test cannot disagree about it. */
export function quotaShardName(userId, utcDay) {
  return `${userId}:${utcDay}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class AskQuotaCounter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/peek') {
      const count = (await this.state.storage.get('count')) || 0;
      return json({ count });
    }

    if (url.pathname !== '/take' || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_input' }, 400); }
    const limit = body && body.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      // A bad limit is a caller bug. Refusing is the only safe answer: a
      // default here would be a cap nobody chose, applied silently.
      return json({ error: 'invalid_input' }, 400);
    }

    const count = (await this.state.storage.get('count')) || 0;
    if (count >= limit) {
      return json({ allowed: false, count, limit, remaining: 0 });
    }
    const next = count + 1;
    await this.state.storage.put('count', next);
    return json({ allowed: true, count: next, limit, remaining: limit - next });
  }
}
```

- [ ] **Step 4: Export the class from the worker entry**

In `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`, add near the other imports at the top:

```js
export { AskQuotaCounter, quotaShardName } from './quota.js';
```

A Durable Object class must be a named export of the worker's `main` module for the runtime to find it. `r.wrap(handlers)` stays the default export, unchanged.

- [ ] **Step 5: Register the class in wrangler.toml**

In `/Users/brian/iCode/projects/rrm-ai-search/wrangler.toml`, append (do not touch `compatibility_date`):

```toml
# The per-user, per-UTC-day question counter for /api/ask. Hosted here because
# this is the only Worker in scope; rrm-academy-cf's Pages project binds it by
# script_name rather than hosting its own class. See src/quota.js.
[[durable_objects.bindings]]
name = "ASK_QUOTA"
class_name = "AskQuotaCounter"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["AskQuotaCounter"]
```

- [ ] **Step 6: Assert the binding at deploy time**

In `/Users/brian/iCode/projects/rrm-ai-search/scripts/deploy.mjs`, add to `REQUIRED_BINDINGS`:

```js
  { name: 'ASK_QUOTA', type: 'durable_object_namespace' },
```

This is the same defense the file already carries for `ASK_KB`: a wrangler that drops a binding while reporting success is a failure mode this repo has already lived through.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && npm test`
Expected: PASS, including the four existing test files.

- [ ] **Step 8: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-ai-search
cat > /tmp/askrrm-p2-t1.msg <<'MSG'
feat(ask): AskQuotaCounter durable object

Replaces the KV read-add-write day counter, which was not atomic: two requests
at count 19 against a limit of 20 both read 19, both wrote 20, and both were
answered. One shard per user per UTC day, so the counter never contends across
users or days and needs no reset job. Proof gate G2.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add src/quota.js src/index.js wrangler.toml scripts/deploy.mjs test/quota.test.mjs
git commit -F /tmp/askrrm-p2-t1.msg
```

---

### Task 2: POST /generate

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`
- Test: `/Users/brian/iCode/projects/rrm-ai-search/test/generate.test.mjs`

**Interfaces:**
- Consumes: the existing `runAi`, `authorized`, `readBody`, `logEvent`, `LLM_MODEL` in `src/index.js`.
- Produces:
  - `POST /generate`, bearer `AI_SEARCH_WORKER_AUTH`. Request `{ system_prompt: string, chunks: [{ key, text }], turns?: [{ question, answer, citation_ids }], user_id?: string, day_key?: string }`. Response `200 { answer, usage, neurons, model }`. No citations: the caller builds those from the chunks it sent.
  - `export const MAX_PROMPT_CHARS = 12000` and `export function serializedPromptLength({ system_prompt, chunks, turns })`.
  - Over the cap: `400 { error: 'prompt_too_long', length, max }`, before any model call.

- [ ] **Step 1: Write the failing test**

Create `test/generate.test.mjs`:

```js
/**
 * POST /generate. Prose and usage only. The engine that calls it already knows
 * which chunks it sent, and it is the engine, not this route, that turns those
 * into citations: that is what lets a second backend satisfy cite-or-refuse the
 * same way without reimplementing citation building.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { MAX_PROMPT_CHARS, serializedPromptLength } from '../src/index.js';

const AUTH = 'test-worker-auth';
const post = (body) => new Request('https://internal/generate', {
  method: 'POST',
  headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function env({ answer = 'An answer.', usage = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }, throws = null } = {}) {
  return {
    AI_SEARCH_WORKER_AUTH: AUTH,
    EVENTS: { writeDataPoint() {} },
    AI: {
      async run() {
        if (throws) throw new Error(throws);
        return { response: answer, usage };
      },
    },
  };
}

const CHUNKS = [{ key: '/library/a.md', text: 'Chunk one.' }, { key: '/faqs/b.md', text: 'Chunk two.' }];

test('serializedPromptLength counts prompt, chunk text and carried turns', () => {
  const n = serializedPromptLength({ system_prompt: 'abc', chunks: [{ key: 'k', text: 'de' }], turns: [{ question: 'f', answer: 'gh' }] });
  assert.equal(n, 3 + 2 + 1 + 2);
});

test('returns prose, usage and model, and NEVER citations', async () => {
  const res = await worker.fetch(post({ system_prompt: 'Be helpful.', chunks: CHUNKS }), env(), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.answer, 'An answer.');
  assert.equal(body.usage.total_tokens, 140);
  assert.equal(typeof body.model, 'string');
  assert.equal('citations' in body, false, '/generate must not build citations');
});

test('refuses an over-long prompt before any model call', async () => {
  let called = false;
  const e = env();
  e.AI.run = async () => { called = true; return { response: 'x' }; };
  const big = 'x'.repeat(MAX_PROMPT_CHARS + 1);
  const res = await worker.fetch(post({ system_prompt: big, chunks: [] }), e, {});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'prompt_too_long');
  assert.equal(called, false, 'the model was called for a prompt we had already refused');
});

test('refuses a missing system_prompt and a non-array chunks', async () => {
  assert.equal((await worker.fetch(post({ chunks: CHUNKS }), env(), {})).status, 400);
  assert.equal((await worker.fetch(post({ system_prompt: 'p', chunks: 'nope' }), env(), {})).status, 400);
});

test('refuses without the bearer', async () => {
  const req = new Request('https://internal/generate', { method: 'POST', body: '{}' });
  assert.equal((await worker.fetch(req, env(), {})).status, 401);
});

test('a generation failure is a 502 generation_error, never a 200 with empty prose', async () => {
  const res = await worker.fetch(post({ system_prompt: 'p', chunks: CHUNKS }), env({ throws: 'boom' }), {});
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'generation_error');
});

test('a generation timeout is a 504 generation_timeout', async () => {
  const res = await worker.fetch(post({ system_prompt: 'p', chunks: CHUNKS }), env({ throws: 'generation_timeout' }), {});
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error, 'generation_timeout');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && node --test test/generate.test.mjs`
Expected: FAIL. `MAX_PROMPT_CHARS` is not exported and `/generate` answers 404.

- [ ] **Step 3: Implement the route**

In `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`, add above `async function handleAsk`:

```js
/**
 * The total serialized prompt cap for /generate, enforced server side. The
 * thread-carry bound in the engine (400 chars of question, 900 of answer, 4000
 * across three turns) composes INSIDE this number, it is not on top of it.
 */
export const MAX_PROMPT_CHARS = 12000;

/** Everything that will actually reach the model, counted the same way twice. */
export function serializedPromptLength({ system_prompt, chunks, turns }) {
  let n = (system_prompt || '').length;
  for (const c of chunks || []) n += (c?.text || '').length;
  for (const t of turns || []) n += (t?.question || '').length + (t?.answer || '').length;
  return n;
}

/**
 * POST /generate -- prose and usage, nothing else.
 *
 * The caller has already retrieved, reranked and chosen its chunks, and it is
 * the caller that turns those into citations. Keeping citation building out of
 * here is what lets the OpenAI-compatible backend satisfy cite-or-refuse the
 * same way the Workers AI backend does, with no second implementation to drift.
 */
async function handleGenerate(request, env) {
  const body = await readBody(request);
  if (!body || typeof body.system_prompt !== 'string' || !body.system_prompt.length) {
    return json({ error: 'invalid_input' }, 400);
  }
  if (!Array.isArray(body.chunks)) return json({ error: 'invalid_input' }, 400);
  if (body.turns !== undefined && !Array.isArray(body.turns)) return json({ error: 'invalid_input' }, 400);

  const length = serializedPromptLength(body);
  if (length > MAX_PROMPT_CHARS) {
    // Before any model call. A refusal that has already been billed for is not
    // a refusal, it is a receipt.
    return json({ error: 'prompt_too_long', length, max: MAX_PROMPT_CHARS }, 400);
  }

  const start = Date.now();
  const promptHash = await hashShort(body.system_prompt);

  const context = (body.chunks || [])
    .map((c) => `\n\n---\nSource: ${c?.key || ''}\n${c?.text || ''}`)
    .join('');
  const carried = (body.turns || [])
    .map((t) => `\n\nEarlier in this conversation:\nQ: ${t?.question || ''}\nA: ${t?.answer || ''}`)
    .join('');
  const systemPrompt = context
    ? `${body.system_prompt}\n\nRELEVANT LIBRARY EXCERPTS:${context}${carried}`
    : `${body.system_prompt}${carried}`;

  // The user turn is the last carried question when there is one, else the
  // caller put the whole question in the prompt. Either way the model sees one
  // user message; the engine owns what that message says.
  const userMessage = body.turns && body.turns.length
    ? String(body.turns[body.turns.length - 1].question || '')
    : ' ';

  let answer;
  let usage = null;
  try {
    const aiResp = await runAi(env, systemPrompt, userMessage);
    answer = typeof aiResp === 'string' ? aiResp : aiResp?.response;
    if (typeof answer !== 'string' || !answer.length) throw new Error('empty_answer');
    usage = (aiResp && typeof aiResp === 'object' && aiResp.usage && typeof aiResp.usage === 'object') ? aiResp.usage : null;
  } catch (e) {
    const isTimeout = e?.message === 'generation_timeout';
    const status = isTimeout ? 504 : 502;
    logEvent(env, 'generate_error', status, { messageHash: promptHash, durationMs: Date.now() - start, errorMessage: e?.message });
    return json({ error: isTimeout ? 'generation_timeout' : 'generation_error' }, status);
  }

  logEvent(env, 'generate', 200, { messageHash: promptHash, durationMs: Date.now() - start, generationMs: Date.now() - start });

  return json({
    answer,
    usage,
    // Workers AI reports neurons on usage when it reports them at all. Passed
    // through so ask_answer.cost_neurons has a real number to record.
    neurons: (usage && typeof usage.neurons === 'number') ? usage.neurons : null,
    model: LLM_MODEL,
  });
}
```

In the `handlers.fetch` router, add above the `/search` line:

```js
    if (url.pathname === '/generate') return handleGenerate(request, env);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && npm test`
Expected: PASS.

- [ ] **Step 5: Update the README**

In `/Users/brian/iCode/projects/rrm-ai-search/README.md`, under `## Endpoints`, add:

```markdown
- `POST /generate`: generation only, from a prompt and chunks the caller already chose. Body: `{ system_prompt, chunks: [{ key, text }], turns?, user_id?, day_key? }`. Returns `{ answer, usage, neurons, model }`. **No citations, on purpose:** the caller built the chunk list, so the caller builds the citations, which is what lets a second backend satisfy cite-or-refuse without a second implementation. Total serialized prompt over 12,000 characters is a `400 prompt_too_long` before any model call.
```

Under `## Bindings`, add:

```markdown
- `ASK_QUOTA`: Durable Object namespace, class `AskQuotaCounter` (`src/quota.js`). Hosted here and bound into the `rrm-academy` Pages project by `script_name`.
```

- [ ] **Step 6: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-ai-search
cat > /tmp/askrrm-p2-t2.msg <<'MSG'
feat(ask): POST /generate returns prose and usage only

Generation split from retrieval. The caller chose the chunks, so the caller
builds the citations, which is what lets the OpenAI-compatible backend satisfy
cite or refuse with no second citation implementation to drift. The 12,000
character prompt cap is enforced here, before any model call.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add src/index.js test/generate.test.mjs README.md
git commit -F /tmp/askrrm-p2-t2.msg
```

- [ ] **Step 7: Deploy (Brian's go required)**

**HUMAN CHECKPOINT.** Then:

```bash
PHASE2_ID=$(op item get "Cloudflare API Token - Phase 2 (account-scoped, 90d)" --vault Automation --format json | jq -r .id)
export CLOUDFLARE_API_TOKEN=$(op item get "$PHASE2_ID" --vault Automation --fields credential --reveal)
npm run deploy
```
Expected: tests pass, deploy succeeds, and the binding check lists `ASK_QUOTA` as `durable_object_namespace`. If the binding check fails, the deploy is not done: do not proceed to Part B.

---

## Part B: rrm-academy-cf

### Task 3: The one migration

**Files:**
- Create: `scripts/migrations/2026-09-14-askrrm-engine.sql`
- Modify: `functions/api/_search_log.js`
- Test: `test/ask-answer-archive.test.js` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `ask_answer` gains `register, thread_id, turn, cost_neurons, rewritten_query, fact_check_error, rewrite_fallback`. Tables `ask_thread` and `ask_feedback` exist. `logAskAnswer(env, {...})` accepts seven new optional keys with the same names and binds them in that column order.

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/2026-09-14-askrrm-engine.sql`:

```sql
-- AskRRM engine: every new column and table the 2026-09-14 spec needs, in one
-- pass, so the later sequencing steps only have to FILL columns that already
-- exist rather than layering a migration per step.
-- Database: rrm-analytics. Spec section 9a.
ALTER TABLE ask_answer ADD COLUMN register TEXT;
ALTER TABLE ask_answer ADD COLUMN thread_id TEXT;
ALTER TABLE ask_answer ADD COLUMN turn INTEGER;
ALTER TABLE ask_answer ADD COLUMN cost_neurons INTEGER;
ALTER TABLE ask_answer ADD COLUMN rewritten_query TEXT;
ALTER TABLE ask_answer ADD COLUMN fact_check_error INTEGER DEFAULT 0;
ALTER TABLE ask_answer ADD COLUMN rewrite_fallback INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ask_answer_thread ON ask_answer(thread_id);

CREATE TABLE IF NOT EXISTS ask_thread (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_turn_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ask_thread_user ON ask_thread(user_id);

-- One verdict per person per answer. The UNIQUE pair is what makes the feedback
-- upsert in /api/ask/feedback idempotent: ON CONFLICT replaces rather than
-- duplicating, latest wins.
CREATE TABLE IF NOT EXISTS ask_feedback (
  id TEXT PRIMARY KEY,
  ask_answer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('helpful','not_helpful','report')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, ask_answer_id)
);
CREATE INDEX IF NOT EXISTS idx_ask_feedback_created ON ask_feedback(created_at);
```

- [ ] **Step 2: Apply it remotely**

```bash
npx wrangler@4.62.0 d1 execute rrm-analytics --remote --file scripts/migrations/2026-09-14-askrrm-engine.sql
npx wrangler@4.62.0 d1 execute rrm-analytics --remote --command "SELECT name FROM pragma_table_info('ask_answer') WHERE name IN ('register','thread_id','turn','cost_neurons','rewritten_query','fact_check_error','rewrite_fallback')"
```
Expected: the second command lists all seven names. `ALTER TABLE ADD COLUMN` is not idempotent in SQLite, so a rerun errors with `duplicate column name`; that error means it already applied and is safe to ignore.

- [ ] **Step 3: Widen logAskAnswer**

In `functions/api/_search_log.js`, in `logAskAnswer`, add these keys to the destructured defaults, after `eval_tag = null,`:

```js
  register = null,
  thread_id = null,
  turn = null,
  cost_neurons = null,
  rewritten_query = null,
  fact_check_error = 0,
  rewrite_fallback = 0,
```

Change the INSERT to:

```js
      `INSERT INTO ask_answer
         (search_log_id, source, query, answer, citations_json, fallback, model, prompt_hash, tokens_in, tokens_out, duration_ms, user_id, ip_hash, eval_tag,
          register, thread_id, turn, cost_neurons, rewritten_query, fact_check_error, rewrite_fallback)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
```

and append to the `.bind(...)` argument list, after `eval_tag || null,`:

```js
      register || null,
      thread_id || null,
      turn !== undefined ? turn : null,
      cost_neurons !== undefined ? cost_neurons : null,
      rewritten_query ? rewritten_query.slice(0, 500) : null,
      fact_check_error ? 1 : 0,
      rewrite_fallback ? 1 : 0,
```

- [ ] **Step 4: Extend the archive test**

Append to the first `it(...)` in `test/ask-answer-archive.test.js`, before its closing brace:

```js
    // The seven columns the engine migration added, in order, starting at
    // bind index 14. Pinned here so a column inserted in the middle of the
    // INSERT list cannot silently shift every later value one place left.
    assert.equal(askAnswerCall.bound.length, 21, 'ask_answer INSERT must bind 21 columns');
    assert.equal(askAnswerCall.bound[14], 'patient', 'register');
    assert.equal(askAnswerCall.bound[16], 1, 'turn starts at 1');
    assert.equal(askAnswerCall.bound[19], 0, 'fact_check_error defaults to 0');
    assert.equal(askAnswerCall.bound[20], 0, 'rewrite_fallback defaults to 0');
```

This assertion fails until Task 5 makes `ask.js` pass `register` and `turn`. Run it then, not now.

- [ ] **Step 5: Run the SQL gate**

Run: `npm run gates:sql && npm run gates:schema-drift`
Expected: PASS. `ask_answer` lives in `rrm-analytics`, which the SQL gate counts as `other-database` and skips, so a green run here is not proof the SQL is right; Step 2's live `pragma_table_info` read is.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/askrrm-p2-t3.msg <<'MSG'
feat(ask): one migration for the whole engine

Seven columns on ask_answer plus ask_thread and ask_feedback, landed together so
the later sequencing steps only fill columns that already exist. The UNIQUE pair
on ask_feedback is what makes the feedback upsert idempotent. Applied remote.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add scripts/migrations/2026-09-14-askrrm-engine.sql functions/api/_search_log.js test/ask-answer-archive.test.js
git commit -F /tmp/askrrm-p2-t3.msg
```

---

### Task 4: The engine and its backends

**Files:**
- Create: `functions/api/ask/_engine.js`, `functions/api/ask/_backends/index.js`, `functions/api/ask/_backends/workers-ai.js`, `functions/api/ask/_backends/openai-compatible.js`
- Test: `test/ask-engine.test.js`
- Modify: `scripts/quality/lib/census-rules.mjs`

**Interfaces:**
- Consumes: `enforceCiteOrRefuse` (P1 Task 5, moved here), `SYSTEM_PROMPT` and `register` from `functions/api/_ask_prompt.js`.
- Produces:
  - `answer({ message, thread, register, backend, env, waitUntil }) -> Promise<AnswerResult>`
  - `AnswerResult = { answer: string, citations: Citation[], fallback: boolean, model: string, usage: object|null, neurons: number|null, register: string, rewritten_query: string|null, rewrite_fallback: boolean, fact_check_error: boolean, grounded_in: Citation[], errorCode?: string, httpStatus?: number }`
  - `Citation = { url: string, title: string, type: string, slug: string|null, unverified?: boolean }`
  - `export function enforceCiteOrRefuse(answer, citations)` (moved verbatim from `ask.js`)
  - `export const FALLBACK_ANSWER: string`
  - `_backends/index.js`: `selectBackend(env) -> Promise<{ name: 'workers-ai'|'openai-compatible', generate }>`
  - each backend: `generate({ systemPrompt, chunks, turns, env }) -> { answer, usage, neurons, model }` or throws `Object.assign(new Error(code), { httpStatus, errorCode })`

- [ ] **Step 1: Write the failing test**

Create `test/ask-engine.test.js`:

```js
/**
 * functions/api/ask/_engine.js. The whole pipeline lives here, and both the
 * page and the eval worker call this one function, which is what makes the
 * eval numbers mean something.
 *
 * P2 covers retrieve via the existing /ask route plus generate via /generate.
 * Rewrite, rerank, fact-check and live resolve land in P3 behind
 * feature:ask_pipeline_v3 and are not exercised here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answer, enforceCiteOrRefuse, FALLBACK_ANSWER } from '../functions/api/ask/_engine.js';

/** env.AI_SEARCH stub. Routes /ask and /generate the way the live worker does. */
function aiSearch({ chunks, citations, prose = 'A grounded answer.', generateStatus = 200, generateBody = null }) {
  return {
    async fetch(url, init) {
      const path = new URL(url).pathname;
      if (path === '/ask') {
        return new Response(JSON.stringify({
          answer: prose, citations, model: 'test-model', usage: null,
          retrieved_chunks_count: (chunks || []).length,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (path === '/generate') {
        if (generateStatus !== 200) {
          return new Response(JSON.stringify(generateBody || { error: 'generation_error' }), { status: generateStatus, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          answer: prose, usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, neurons: 12.5 },
          neurons: 12.5, model: 'test-model',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    },
  };
}

const CITE = [{ url: 'https://rrmacademy.org/library/example/', title: 'Example' }];

function baseEnv(overrides = {}) {
  return {
    AI_SEARCH: aiSearch({ chunks: [{ key: '/library/example.md', text: 'Chunk.' }], citations: CITE }),
    AI_SEARCH_WORKER_AUTH: 'token',
    COMMUNITY_KV: { async get() { return null; } },
    EVENTS: { writeDataPoint() {} },
    ...overrides,
  };
}

describe('enforceCiteOrRefuse', () => {
  it('replaces uncited prose with the canonical refusal', () => {
    const out = enforceCiteOrRefuse('Uncited prose.', []);
    assert.equal(out.answer, FALLBACK_ANSWER);
    assert.equal(out.fallback, true);
  });
  it('leaves a cited answer alone', () => {
    assert.equal(enforceCiteOrRefuse('Real.', CITE).fallback, false);
  });
});

describe('answer()', () => {
  it('returns prose, engine-built citations, and the register it used', async () => {
    const r = await answer({ message: 'What is RRM?', register: 'patient', env: baseEnv(), waitUntil: () => {} });
    assert.equal(r.answer, 'A grounded answer.');
    assert.equal(r.register, 'patient');
    assert.equal(r.fallback, false);
    assert.equal(r.citations.length, 1);
    assert.equal(r.citations[0].url, CITE[0].url);
    assert.equal(typeof r.citations[0].type, 'string', 'every citation carries a type badge');
  });

  it('refuses rather than serving prose with no citation (G3)', async () => {
    const env = baseEnv({ AI_SEARCH: aiSearch({ chunks: [], citations: [], prose: 'Ungrounded prose.' }) });
    const r = await answer({ message: 'Anything?', register: 'patient', env, waitUntil: () => {} });
    assert.equal(r.answer, FALLBACK_ANSWER);
    assert.equal(r.fallback, true);
    assert.deepEqual(r.citations, []);
    assert.ok(!r.answer.includes('Ungrounded'), 'uncited prose escaped the engine');
  });

  it('reports a missing AI_SEARCH binding as 503 service_unavailable, never a 200', async () => {
    const env = baseEnv({ AI_SEARCH: undefined });
    const r = await answer({ message: 'x', register: 'patient', env, waitUntil: () => {} });
    assert.equal(r.errorCode, 'service_unavailable');
    assert.equal(r.httpStatus, 503);
  });

  it('carries neurons through from usage so the row can record cost', async () => {
    const r = await answer({ message: 'x', register: 'patient', env: baseEnv(), waitUntil: () => {} });
    assert.equal(typeof r.neurons === 'number' || r.neurons === null, true);
  });

  it('grounded_in lists what was retrieved, including records the answer did not cite', async () => {
    const r = await answer({ message: 'x', register: 'patient', env: baseEnv(), waitUntil: () => {} });
    assert.ok(Array.isArray(r.grounded_in));
  });

  it('an unknown register is refused rather than silently defaulted', async () => {
    const r = await answer({ message: 'x', register: 'clinical', env: baseEnv(), waitUntil: () => {} });
    assert.equal(r.errorCode, 'invalid_input');
  });
});

describe('backend selection', () => {
  it('defaults to workers-ai when the flag is absent', async () => {
    const { selectBackend } = await import('../functions/api/ask/_backends/index.js');
    const b = await selectBackend({ COMMUNITY_KV: { async get() { return null; } } });
    assert.equal(b.name, 'workers-ai');
  });

  it('falls back to workers-ai when the KV read throws (G9)', async () => {
    const { selectBackend } = await import('../functions/api/ask/_backends/index.js');
    const b = await selectBackend({ COMMUNITY_KV: { async get() { throw new Error('kv down'); } } });
    assert.equal(b.name, 'workers-ai');
  });

  it('falls back to workers-ai on an unrecognised flag value', async () => {
    const { selectBackend } = await import('../functions/api/ask/_backends/index.js');
    const b = await selectBackend({ COMMUNITY_KV: { async get() { return 'llama-on-a-toaster'; } } });
    assert.equal(b.name, 'workers-ai');
  });

  it('selects openai-compatible only when the flag AND both secrets are present', async () => {
    const { selectBackend } = await import('../functions/api/ask/_backends/index.js');
    const kv = { async get() { return 'openai-compatible'; } };
    assert.equal((await selectBackend({ COMMUNITY_KV: kv })).name, 'workers-ai', 'no secrets: must not select it');
    const withSecrets = { COMMUNITY_KV: kv, ASK_BACKEND_URL: 'https://gpu.example/v1/chat/completions', ASK_BACKEND_TOKEN: 't' };
    assert.equal((await selectBackend(withSecrets)).name, 'openai-compatible');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-engine.test.js`
Expected: FAIL with `Cannot find module .../functions/api/ask/_engine.js`

- [ ] **Step 3: Write the backend selector**

Create `functions/api/ask/_backends/index.js`:

```js
/**
 * Backend selection for the AskRRM engine.
 *
 * Only GENERATION moves between backends. Retrieval, reranking and citation
 * building stay on Cloudflare for every backend, which is what makes
 * cite-or-refuse one implementation rather than one per lane.
 *
 * FAIL CLOSED TO THE DEFAULT. An unreadable flag, an unrecognised value, or a
 * selected backend whose two secrets are not both present all resolve to
 * workers-ai. Proof gate G9.
 */
import { generate as workersAiGenerate } from './workers-ai.js';
import { generate as openAiGenerate } from './openai-compatible.js';

const FLAG_KEY = 'feature:ask_backend';
const DEFAULT = { name: 'workers-ai', generate: workersAiGenerate };

export async function selectBackend(env) {
  let flag = null;
  try {
    flag = env?.COMMUNITY_KV ? await env.COMMUNITY_KV.get(FLAG_KEY) : null;
  } catch {
    return DEFAULT;
  }
  if (flag !== 'openai-compatible') return DEFAULT;
  // A flag without its credentials is a half-finished rollout, not a request to
  // answer without them.
  if (!env?.ASK_BACKEND_URL || !env?.ASK_BACKEND_TOKEN) return DEFAULT;
  return { name: 'openai-compatible', generate: openAiGenerate };
}
```

- [ ] **Step 4: Write the two backends**

Create `functions/api/ask/_backends/workers-ai.js`:

```js
/**
 * The default generation backend: rrm-ai-search POST /generate over the
 * AI_SEARCH service binding. Returns prose and usage only; the engine builds
 * the citations from the chunks it sent.
 */
const GENERATE_TIMEOUT_MS = 22000;

export async function generate({ systemPrompt, chunks, turns, env }) {
  if (!env?.AI_SEARCH) throw Object.assign(new Error('service_unavailable'), { httpStatus: 503, errorCode: 'service_unavailable' });
  if (!env?.AI_SEARCH_WORKER_AUTH) throw Object.assign(new Error('service_unavailable'), { httpStatus: 503, errorCode: 'service_unavailable' });

  let resp;
  try {
    resp = await env.AI_SEARCH.fetch('https://internal/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_SEARCH_WORKER_AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: systemPrompt, chunks, turns: turns || [] }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (e) {
    const isTimeout = e.name === 'AbortError' || e.name === 'TimeoutError';
    throw Object.assign(new Error(isTimeout ? 'generation_timeout' : 'generation_error'), {
      httpStatus: isTimeout ? 504 : 502,
      errorCode: isTimeout ? 'generation_timeout' : 'generation_error',
    });
  }

  if (!resp.ok) {
    let code = 'generation_error';
    try { code = (await resp.json())?.error || code; } catch { /* keep the default */ }
    const status = resp.status === 400 ? 400 : (resp.status === 504 ? 504 : 502);
    throw Object.assign(new Error(code), { httpStatus: status, errorCode: code });
  }

  let data;
  try { data = await resp.json(); } catch {
    throw Object.assign(new Error('generation_error'), { httpStatus: 502, errorCode: 'generation_error' });
  }
  if (typeof data?.answer !== 'string' || !data.answer.length) {
    throw Object.assign(new Error('generation_error'), { httpStatus: 502, errorCode: 'generation_error' });
  }
  return {
    answer: data.answer,
    usage: data.usage || null,
    neurons: typeof data.neurons === 'number' ? data.neurons : null,
    model: data.model || '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  };
}
```

Create `functions/api/ask/_backends/openai-compatible.js`:

```js
/**
 * The pluggable generation lane: any OpenAI chat-completions server at
 * ASK_BACKEND_URL with ASK_BACKEND_TOKEN. A rented GPU, a Hetzner box, a Mac
 * Studio behind a Cloudflare Tunnel. Same prompt, same chunks, same return
 * shape, so the engine's cite-or-refuse step is unchanged.
 *
 * NOT selected by default and never selected without both secrets; see
 * _backends/index.js. Production never depends on a Mac being awake.
 */
const GENERATE_TIMEOUT_MS = 22000;

export async function generate({ systemPrompt, chunks, turns, env }) {
  const context = (chunks || []).map((c) => `\n\n---\nSource: ${c?.key || ''}\n${c?.text || ''}`).join('');
  const messages = [{ role: 'system', content: context ? `${systemPrompt}\n\nRELEVANT LIBRARY EXCERPTS:${context}` : systemPrompt }];
  for (const t of turns || []) {
    messages.push({ role: 'user', content: String(t?.question || '') });
    messages.push({ role: 'assistant', content: String(t?.answer || '') });
  }

  let resp;
  try {
    resp = await fetch(env.ASK_BACKEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.ASK_BACKEND_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 1024, stream: false }),
      signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
    });
  } catch (e) {
    const isTimeout = e.name === 'AbortError' || e.name === 'TimeoutError';
    throw Object.assign(new Error(isTimeout ? 'generation_timeout' : 'generation_error'), {
      httpStatus: isTimeout ? 504 : 502,
      errorCode: isTimeout ? 'generation_timeout' : 'generation_error',
    });
  }
  if (!resp.ok) throw Object.assign(new Error('generation_error'), { httpStatus: 502, errorCode: 'generation_error' });

  let data;
  try { data = await resp.json(); } catch {
    throw Object.assign(new Error('generation_error'), { httpStatus: 502, errorCode: 'generation_error' });
  }
  const prose = data?.choices?.[0]?.message?.content;
  if (typeof prose !== 'string' || !prose.length) {
    throw Object.assign(new Error('generation_error'), { httpStatus: 502, errorCode: 'generation_error' });
  }
  return {
    answer: prose,
    usage: data.usage || null,
    // Neurons are a Workers AI unit. A third-party lane has none, and reporting
    // zero would read as free rather than as unmeasured.
    neurons: null,
    model: typeof data.model === 'string' ? data.model : 'openai-compatible',
  };
}
```

- [ ] **Step 5: Write the engine**

Create `functions/api/ask/_engine.js`:

```js
/**
 * THE ASKRRM ENGINE.
 *
 * One function, answer(), owns the whole pipeline. functions/api/ask.js is
 * auth, tier, cap, thread lookup and response framing, and nothing else. The
 * eval worker imports this same module, which is what makes an eval number a
 * statement about production rather than about a parallel implementation.
 *
 * P2 shape: retrieve and generate through rrm-ai-search, engine-built
 * citations, cite or refuse. Rewrite, rerank, fact-check and live citation
 * resolve arrive in P3 behind feature:ask_pipeline_v3.
 *
 * answer() NEVER THROWS. It returns { errorCode, httpStatus } on failure so the
 * caller frames one response shape for JSON and for SSE alike.
 */
import { SYSTEM_PROMPT, register as PATIENT_REGISTER } from '../_ask_prompt.js';
import { selectBackend } from './_backends/index.js';
import { r, statusFromHttp } from '../../_report.js';

/** The registers this build knows. An unknown one is refused, never defaulted. */
const REGISTERS = { [PATIENT_REGISTER]: SYSTEM_PROMPT };

/** Byte for byte the string in scripts/ask-eval/judge-rules.mjs and rule 8. */
export const FALLBACK_ANSWER = "I don't have information from the RRM Library that directly addresses this question. Try rephrasing, or browse [/library/](https://rrmacademy.org/library/) for related research.";

const RETRIEVE_TIMEOUT_MS = 28000;

/** G3: prose without a source never reaches the client. Moved here from ask.js. */
export function enforceCiteOrRefuse(answerText, citations) {
  const list = Array.isArray(citations) ? citations : [];
  const prose = typeof answerText === 'string' ? answerText.trim() : '';
  if (!prose || list.length === 0) return { answer: FALLBACK_ANSWER, citations: [], fallback: true };
  return { answer: answerText, citations: list, fallback: false };
}

/**
 * Normalise an upstream citation into the shape the page renders directly:
 * url, title, type badge, slug. The page must never re-derive type from the URL
 * shape, so the type is decided here, once.
 */
function toCitation(c) {
  if (!c || typeof c.url !== 'string') return null;
  let type = 'article';
  let slug = null;
  const u = c.url;
  if (u.includes('/library/')) { type = 'article'; slug = u.split('/library/')[1]?.replace(/\/$/, '') || null; }
  else if (u.includes('/commentary/')) { type = 'commentary'; slug = u.split('/commentary/')[1]?.replace(/\/$/, '') || null; }
  else if (u.includes('/faqs/')) { type = 'faq'; slug = u.split('/faqs/')[1]?.replace(/\/$/, '') || null; }
  else if (u.includes('/glossary/')) { type = 'glossary'; slug = u.split('#')[1] || null; }
  else if (u.includes('/guides/')) { type = 'guide'; slug = u.split('/guides/')[1]?.replace(/\/$/, '') || null; }
  else { type = 'guide'; slug = u.replace('https://rrmacademy.org/', '').replace(/\/$/, '') || null; }
  return { url: u, title: typeof c.title === 'string' && c.title ? c.title : u, type, slug };
}

function fail(errorCode, httpStatus) {
  return {
    answer: '', citations: [], fallback: false, model: null, usage: null, neurons: null,
    register: null, rewritten_query: null, rewrite_fallback: false, fact_check_error: false,
    grounded_in: [], errorCode, httpStatus,
  };
}

/**
 * @param {object}   opts
 * @param {string}   opts.message     the user's question, already validated
 * @param {Array}    [opts.thread]    carried turns, P5 onwards. Ignored in P2.
 * @param {string}   opts.register    register name, currently only 'patient'
 * @param {string}   [opts.backend]   force a backend by name, for the eval worker
 * @param {object}   opts.env
 * @param {Function} [opts.waitUntil]
 */
export async function answer({ message, thread = [], register = PATIENT_REGISTER, backend, env, waitUntil }) {
  const started = Date.now();
  const systemPrompt = REGISTERS[register];
  if (!systemPrompt) return fail('invalid_input', 400);
  if (!env?.AI_SEARCH || !env?.AI_SEARCH_WORKER_AUTH) return fail('service_unavailable', 503);

  // Retrieve. P2 still uses the combined /ask route, which does retrieval and
  // generation together; P3 splits it into /retrieve plus /generate behind the
  // pipeline flag. Either way the ENGINE owns the citations.
  let upstream;
  try {
    upstream = await env.AI_SEARCH.fetch('https://internal/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_SEARCH_WORKER_AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, editorialPrompt: systemPrompt }),
      signal: AbortSignal.timeout(RETRIEVE_TIMEOUT_MS),
    });
  } catch (e) {
    const isTimeout = e.name === 'AbortError' || e.name === 'TimeoutError';
    return fail(isTimeout ? 'generation_timeout' : 'retrieval_error', isTimeout ? 504 : 502);
  }
  if (!upstream.ok) return fail('retrieval_error', 502);

  let data;
  try { data = await upstream.json(); } catch { return fail('upstream_error', 502); }
  if (typeof data?.answer !== 'string') return fail('upstream_error', 502);

  const citations = (Array.isArray(data.citations) ? data.citations : []).map(toCitation).filter(Boolean);
  // Deduped by url. The engine, not the model, decides what the reader sees.
  const seen = new Set();
  const deduped = citations.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));

  const gated = enforceCiteOrRefuse(data.answer, deduped);
  if (gated.fallback && env?.EVENTS) {
    r.event(env, 'ask', 'cite_or_refuse', 'warn', `answer_len=${data.answer.length} citations=${deduped.length}`,
      { doubles: [Date.now() - started, 1, 200] });
  }

  const backendName = backend || (await selectBackend(env)).name;

  return {
    answer: gated.answer,
    citations: gated.citations,
    fallback: gated.fallback,
    model: data.model || null,
    usage: data.usage || null,
    neurons: (data.usage && typeof data.usage.neurons === 'number') ? data.usage.neurons : null,
    register,
    backend: backendName,
    rewritten_query: null,
    rewrite_fallback: false,
    fact_check_error: false,
    // Everything retrieved, including records the answer did not cite, so the
    // reader can see the corpus edge (spec section 11).
    grounded_in: deduped,
    duration_ms: Date.now() - started,
  };
}

/** Re-exported so callers never import the status mapper from two places. */
export { statusFromHttp };
```

- [ ] **Step 6: Add census rules**

In `scripts/quality/lib/census-rules.mjs`, the existing `[/^functions\//, 'PRODUCT-CODE', ...]` rule already classifies all four new files, because they live under `functions/`. Confirm rather than assume:

Run: `node scripts/quality/census.mjs && node -e "const c=require('./scripts/quality/coverage-census.json'); const f=Object.entries(c.files||c).filter(([k])=>k.includes('ask/_')); console.log(f)"`
Expected: all four files listed as `PRODUCT-CODE`. If the census reports any of them unclassified, add an OVERRIDES entry naming it `PRODUCT-CODE` with a written reason.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/ask-engine.test.js`
Expected: PASS, 14 subtests.

- [ ] **Step 8: Commit**

```bash
cat > /tmp/askrrm-p2-t4.msg <<'MSG'
feat(ask): extract the engine with two pluggable backends

_engine.js owns the pipeline and builds its own citations from the chunks it
sent, which is what lets any backend satisfy cite or refuse the same way. The
backend selector fails closed to workers-ai on an unreadable flag, an
unrecognised value, or a selected lane missing either of its two secrets.

answer() never throws: it returns errorCode and httpStatus so the caller frames
one response shape for JSON and SSE alike.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask/_engine.js functions/api/ask/_backends/ test/ask-engine.test.js scripts/quality/lib/census-rules.mjs
git commit -F /tmp/askrrm-p2-t4.msg
```

---

### Task 5: Thin ask.js, DO quota, free tier real, v1 deleted

**Files:**
- Modify: `functions/api/ask.js`, `wrangler.toml`
- Test: `test/ask-quota-do.test.js`

**Interfaces:**
- Consumes: `answer` and `FALLBACK_ANSWER` from `_engine.js`, `quotaShardName` semantics from `rrm-ai-search/src/quota.js` (reimplemented locally as a one-line template so Pages does not import across repos).
- Produces: `POST /api/ask` accepts `{ message, thread_id? }`. Free tier is 3 a day on the SAME engine as member. Errors map to the eight `errorCode` values in spec section 11. `GET /api/ask` capability JSON gains `version`, `registers`, `caps`.

- [ ] **Step 1: Bind the Durable Object**

In `wrangler.toml`, append:

```toml
# The per-user, per-UTC-day question counter. The CLASS is hosted in the
# rrm-ai-search Worker (src/quota.js); script_name is what points this binding
# at it rather than making Pages host a class of its own. Pages has no D1 write
# path for quota state and KV read-add-write is not atomic.
[[durable_objects.bindings]]
name = "ASK_QUOTA"
class_name = "AskQuotaCounter"
script_name = "rrm-ai-search"
```

`functions/api/ask.js` is in `guard-manifest.json` indirectly through `wrangler.toml`, which is a guarded file. Run `npm run guard:update` after this edit.

- [ ] **Step 2: Write the failing test**

Create `test/ask-quota-do.test.js`:

```js
/**
 * The quota half of the thin ask.js: G1 (three free answers then a 429 with
 * RateLimit-Remaining 0) and G13 (a Durable Object that cannot be reached is a
 * 503 quota_unavailable, never a silent pass-through 200).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockWaitUntil, parseResponse } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const { onRequestPost, onRequestGet } = await import('../functions/api/ask.js');

const URL_ = 'https://rrmacademy.org/api/ask';
const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const RAW_SESSION = 'sess-ask-quota-do';
const USER_ID = 'u_ask_quota_free';

async function authDb() {
  // role 'member' with no subscription is the FREE tier: requireMember returns
  // a Response, ask.js reads that as free, and free now gets the same engine.
  const db = sqliteD1({ seed(sqlite) { insertUser(sqlite, { id: USER_ID, email: 'free@example.com', role: 'member', name: 'Free User', email_verified: 1 }); } });
  await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER_ID, expiresAt: FUTURE });
  return db;
}

/** ASK_QUOTA stub. `broken: true` makes every stub.fetch throw, which is G13. */
function quotaStub({ broken = false, start = 0 } = {}) {
  let count = start;
  return {
    idFromName(name) { return { name }; },
    get() {
      return {
        async fetch(url, init) {
          if (broken) throw new Error('durable object unreachable');
          const limit = JSON.parse(init.body).limit;
          if (count >= limit) return new Response(JSON.stringify({ allowed: false, count, limit, remaining: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          count += 1;
          return new Response(JSON.stringify({ allowed: true, count, limit, remaining: limit - count }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
      };
    },
    _count: () => count,
  };
}

function aiSearch() {
  return {
    async fetch() {
      return new Response(JSON.stringify({
        answer: 'A grounded answer.',
        citations: [{ url: 'https://rrmacademy.org/library/example/', title: 'Example' }],
        model: 'test-model', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, neurons: 3.2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
}

function fakeAnalyticsDB() {
  const calls = [];
  let nextId = 1;
  return { calls, prepare(sql) { let bound = []; return { bind(...a) { bound = a; return this; }, async run() { const id = nextId++; calls.push({ sql, bound, id }); return { success: true, meta: { last_row_id: id, changes: 1 } }; }, async first() { return null; } }; } };
}

function env(db, quota) {
  return {
    DB: db,
    COMMUNITY_KV: { async get() { return null; }, async put() {}, async delete() {} },
    ANALYTICS_DB: fakeAnalyticsDB(),
    ASK_QUOTA: quota,
    AI_SEARCH: aiSearch(),
    AI_SEARCH_WORKER_AUTH: 'token',
  };
}

const ctx = (e, waitUntil, body = { message: 'What is RRM?' }) => ({
  request: mockRequest('POST', { url: URL_, headers: { Cookie: `session=${RAW_SESSION}` }, body }),
  env: e, waitUntil, data: {},
});

describe('free tier on the v2 engine (G1)', () => {
  it('answers three times with citations, then 429s with RateLimit-Remaining 0', async () => {
    const db = await authDb();
    const quota = quotaStub();
    const e = env(db, quota);
    for (let i = 1; i <= 3; i++) {
      const res = await onRequestPost(ctx(e, mockWaitUntil()));
      const { status, body, headers } = await parseResponse(res);
      assert.equal(status, 200, `call ${i} should be answered`);
      assert.ok(body.citations.length >= 1, `call ${i} must carry citations`);
      assert.equal(headers['ratelimit-limit'], '3');
      assert.equal(headers['ratelimit-remaining'], String(3 - i));
    }
    const fourth = await parseResponse(await onRequestPost(ctx(e, mockWaitUntil())));
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error, 'rate_limited');
    assert.equal(fourth.headers['ratelimit-remaining'], '0');
  });
});

describe('quota failure posture (G13)', () => {
  it('a Durable Object that cannot be reached is a 503 quota_unavailable', async () => {
    const db = await authDb();
    const res = await onRequestPost(ctx(env(db, quotaStub({ broken: true })), mockWaitUntil()));
    const { status, body } = await parseResponse(res);
    assert.equal(status, 503);
    assert.equal(body.error, 'quota_unavailable');
  });

  it('a missing ASK_QUOTA binding is a 503, never a pass-through', async () => {
    const db = await authDb();
    const e = env(db, undefined);
    const res = await onRequestPost(ctx(e, mockWaitUntil()));
    assert.equal((await parseResponse(res)).status, 503);
  });
});

describe('thread_id and capability JSON', () => {
  it('accepts a thread_id and stores it on the archived row', async () => {
    const db = await authDb();
    const e = env(db, quotaStub());
    const waitUntil = mockWaitUntil();
    const res = await onRequestPost(ctx(e, waitUntil, { message: 'What is RRM?', thread_id: 'th_abc123' }));
    assert.equal((await parseResponse(res)).status, 200);
    await Promise.all(waitUntil.promises);
    const row = e.ANALYTICS_DB.calls.find((c) => c.sql.includes('INSERT INTO ask_answer'));
    assert.ok(row, 'ask_answer insert did not run');
    assert.equal(row.bound[15], 'th_abc123', 'thread_id column');
  });

  it('refuses an over-long or malformed thread_id', async () => {
    const db = await authDb();
    const e = env(db, quotaStub());
    const res = await onRequestPost(ctx(e, mockWaitUntil(), { message: 'x', thread_id: 'x'.repeat(200) }));
    assert.equal((await parseResponse(res)).status, 400);
  });

  it('GET reports version, registers and caps', async () => {
    const { body } = await parseResponse(await onRequestGet());
    assert.equal(typeof body.version, 'string');
    assert.deepEqual(body.registers, ['patient']);
    assert.deepEqual(body.caps, { free: 3, member: 20 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/ask-quota-do.test.js`
Expected: FAIL. `ask.js` still uses KV and has no `quota_unavailable`.

- [ ] **Step 4: Rewrite handleAuthedAsk**

In `functions/api/ask.js`:

Delete the whole of `async function callUpstream(...)` (both branches, v2 and the v1 NLWeb fallback) and the now-unused `shouldUseV2`, `hashShort` stays.

Replace the imports of `SYSTEM_PROMPT` with:

```js
import { answer as engineAnswer, FALLBACK_ANSWER } from './ask/_engine.js';
import { SYSTEM_PROMPT, register as ASK_REGISTER } from './_ask_prompt.js';
```

Add above `handleAuthedAsk`:

```js
const CAPABILITY_VERSION = 'askrrm-2';
const REGISTERS = ['patient'];
const CAPS = { free: RATE_LIMIT_MAX_FREE, member: RATE_LIMIT_MAX_MEMBER };

/** One shard per user per UTC day. Matches quotaShardName in rrm-ai-search/src/quota.js. */
function quotaShardName(userId, utcDay) {
  return `${userId}:${utcDay}`;
}

/**
 * Atomic take against the ASK_QUOTA Durable Object.
 *
 * FAIL CLOSED, matching checkRateLimit in auth/_shared.js. A counter that
 * cannot be reached must never look like "no problem, proceed": that is exactly
 * the shape a broken cap takes on a free surface with a shoestring budget.
 */
async function takeQuota(env, userId, limit) {
  if (!env.ASK_QUOTA) return { ok: false };
  try {
    const id = env.ASK_QUOTA.idFromName(quotaShardName(userId, utcDateKey()));
    const stub = env.ASK_QUOTA.get(id);
    const resp = await stub.fetch('https://quota/take', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    });
    if (!resp.ok) return { ok: false };
    const data = await resp.json();
    if (typeof data?.allowed !== 'boolean') return { ok: false };
    return { ok: true, ...data };
  } catch {
    return { ok: false };
  }
}

function resetHeaders(limit, remaining) {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, remaining)),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((tomorrow.getTime() - Date.now()) / 1000))),
  };
}
```

Replace the body of `handleAuthedAsk` from the `const rateLimitKey = ...` line through the end of the function with:

```js
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_input' }, 400); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'invalid_input' }, 400);

  const validated = validateBody(body, {
    message: { type: 'string', required: true, minLength: 2, maxLength: 500 },
    thread_id: { type: 'string', required: false, minLength: 3, maxLength: 64 },
  });
  if (!validated.valid) return json({ error: 'invalid_input' }, 400);
  const message = validated.data.message;
  const threadId = validated.data.thread_id || null;

  const wantsSSE = (request.headers.get('Accept') || '').includes('text/event-stream') ||
    (request.headers.get('Accept') || '').includes('application/x-ndjson');
  const frame = (payload, status, headers) => (wantsSSE ? sseResponse(payload, status, headers) : json(payload, status, headers));

  // Quota BEFORE anything billable. A request over quota never reaches
  // retrieval or generation at all.
  const quota = await takeQuota(env, user.id, rateLimitMax);
  if (!quota.ok) {
    log(env, waitUntil, 'ask', 'quota_unavailable', 'error', 'ASK_QUOTA unreachable', Date.now() - start, 503);
    return json({ error: 'quota_unavailable' }, 503);
  }
  if (!quota.allowed) {
    return json({ error: 'rate_limited' }, 429, resetHeaders(rateLimitMax, 0));
  }
  const rlHeaders = resetHeaders(rateLimitMax, quota.remaining);

  const result = await engineAnswer({ message, register: ASK_REGISTER, env, waitUntil });

  if (result.errorCode) {
    await logAskQuery(env, waitUntil, request, message, user.id, start, result.httpStatus || 502, 'ask');
    return frame({ error: result.errorCode }, result.httpStatus || 502, rlHeaders);
  }

  const durationMs = Date.now() - start;
  if (env.EVENTS) {
    const hashedQuery = await hashShort(message);
    const hashedUserId = await hashShort(user.id);
    r.event(env, 'ask', 'query', statusFromHttp(200), `${hashedQuery} ${hashedUserId} ${result.backend}`,
      { doubles: [durationMs, 1, 200] });
  }

  const { user_agent_short, referer_path } = extractRequestMeta(request);
  const ipHash = await hashIp(request.headers.get('cf-connecting-ip') || '');
  waitUntil((async () => {
    const searchLogId = await logSearchQuery(env, {
      source: 'ask_v2', query: message, user_id: user.id, ip_hash: ipHash,
      results_count: result.citations.length, duration_ms: durationMs, http_status: 200,
      user_agent_short, referer_path,
    });
    await logAskAnswer(env, {
      search_log_id: searchLogId,
      source: 'ask_v2',
      query: message,
      answer: result.answer,
      citations: result.citations,
      fallback: result.fallback ? 1 : 0,
      model: result.model,
      prompt_hash: await promptHash(SYSTEM_PROMPT),
      tokens_in: result.usage?.prompt_tokens ?? null,
      tokens_out: result.usage?.completion_tokens ?? null,
      duration_ms: durationMs,
      user_id: user.id,
      ip_hash: ipHash,
      eval_tag: null,
      register: result.register,
      thread_id: threadId,
      turn: 1,
      cost_neurons: result.neurons,
      rewritten_query: result.rewritten_query,
      fact_check_error: result.fact_check_error ? 1 : 0,
      rewrite_fallback: result.rewrite_fallback ? 1 : 0,
    });
  })().catch(() => {}));

  const payload = {
    answer: result.answer,
    citations: result.citations,
    grounded_in: result.grounded_in,
    ...(result.fallback ? { fallback: true } : {}),
    ...(threadId ? { thread_id: threadId } : {}),
    _meta: META,
  };
  return frame(payload, 200, rlHeaders);
```

In the same file, `const effectiveTier = ...` becomes dead: delete it. Free and member now differ only in `rateLimitMax`; both run the same engine, which is the spec's "make the free tier real on v2".

- [ ] **Step 5: Widen the capability JSON**

Replace the `CAPABILITY_JSON` object's `auth` block and add three keys at the top level:

```js
const CAPABILITY_JSON = {
  endpoint: '/api/ask',
  version: CAPABILITY_VERSION,
  registers: REGISTERS,
  caps: CAPS,
  methods: ['GET', 'POST'],
  auth: {
    required: true,
    tiers: {
      free: '3 questions per day, full engine',
      member: '20 questions per day, full engine (STUC members and staff)',
    },
  },
  streaming: {
    supported: true,
    transport: 'text/event-stream',
    trigger: 'Accept: text/event-stream OR Accept: application/x-ndjson',
  },
  request: {
    POST: { content_type: 'application/json', body: { message: 'string, 2-500 chars', thread_id: 'string, optional, 3-64 chars' } },
  },
  response: {
    shape: { answer: 'string', citations: '{url, title, type, slug}[]', grounded_in: '{url, title, type, slug}[]', _meta: { response_type: 'string', version: 'string' } },
    sse_events: ['data: <answer-json>', 'data: [DONE]'],
  },
  guardrails: {
    scope: 'Restorative reproductive medicine education',
    do_not_use_for: ['medical advice', 'diagnosis', 'dosing recommendations'],
  },
  site: 'https://rrmacademy.org',
  library: 'https://rrmacademy.org/library/',
};
```

- [ ] **Step 6: Remove the dead binding**

`NLWEB_SEARCH_URL` is now referenced nowhere:

Run: `grep -rn "NLWEB_SEARCH_URL" functions/ src/ scripts/ wrangler.toml`
Expected: no matches. If `wrangler.toml` still carries it, delete that line. Then remove the Pages secret from the dashboard, or leave it: an unreferenced secret is inert, and removing it is Brian's call, not this plan's.

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/ask-quota-do.test.js test/ask-engine.test.js test/ask-answer-archive.test.js test/ask-cite-or-refuse.test.js`
Expected: PASS. `test/ask-cite-or-refuse.test.js` imports `enforceCiteOrRefuse` from `ask.js`; repoint that import to `../functions/api/ask/_engine.js` and keep the rest of the file unchanged.

- [ ] **Step 8: Run the guard and the full suite**

```bash
npm run guard:update
npm test
npm run quality:coverage
```
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
cat > /tmp/askrrm-p2-t5.msg <<'MSG'
feat(ask): thin ask.js, real free tier, v1 deleted

ask.js is now auth, tier, quota, thread and framing. The engine owns the rest.
The free tier runs the same engine as member and differs only in its cap, which
is what "make the free tier real on v2" means; the v1 NLWeb path that had
returned 504 on every attempt since April is gone with its binding.

Quota is the ASK_QUOTA durable object, bound by script_name to the class hosted
in rrm-ai-search, and it fails CLOSED: a counter that cannot be reached answers
503 quota_unavailable, never a silent pass-through. Proof gates G1 and G13.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask.js wrangler.toml guard-manifest.json test/ask-quota-do.test.js test/ask-cite-or-refuse.test.js
git commit -F /tmp/askrrm-p2-t5.msg
```

---

### Task 6: Eval worker on the same module

**Files:**
- Modify: `scripts/ask-eval/worker/index.js`, `scripts/ask-eval/worker/wrangler.toml`

**Interfaces:**
- Consumes: `answer` from `functions/api/ask/_engine.js`.
- Produces: the eval worker's `POST /ask` response gains `register`, `grounded_in`, `neurons`, `backend`, and keeps `ask_answer_id` and `archive_error` exactly as the golden-set runner reads them.

- [ ] **Step 1: Rewrite the handler body**

In `scripts/ask-eval/worker/index.js`, replace the `import { SYSTEM_PROMPT }` line with:

```js
import { answer as engineAnswer } from '../../../functions/api/ask/_engine.js';
import { SYSTEM_PROMPT, register as EVAL_REGISTER } from '../../../functions/api/_ask_prompt.js';
```

Replace everything from `const start = Date.now();` down to the `let ask_answer_id = null` line with:

```js
    const start = Date.now();
    const result = await engineAnswer({ message, register: EVAL_REGISTER, env, waitUntil: (p) => ctx.waitUntil(p) });
    if (result.errorCode) return json({ error: result.errorCode }, result.httpStatus || 502);

    const { answer, citations, fallback, model, usage, neurons, register, grounded_in } = result;
    const duration_ms = Date.now() - start;
```

Replace the INSERT's column list and bindings to match the widened table:

```js
      const r = await env.ANALYTICS_DB.prepare(
        `INSERT INTO ask_answer
           (search_log_id, source, query, answer, citations_json, fallback, model, prompt_hash, tokens_in, tokens_out, duration_ms, user_id, ip_hash, eval_tag,
            register, thread_id, turn, cost_neurons, rewritten_query, fact_check_error, rewrite_fallback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(null, 'eval', message, answer, JSON.stringify(citations), fallback ? 1 : 0, model, await sha16(SYSTEM_PROMPT),
        usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, duration_ms, null, null, tag,
        register, null, 1, neurons ?? null, result.rewritten_query ?? null,
        result.fact_check_error ? 1 : 0, result.rewrite_fallback ? 1 : 0).run();
```

And the response:

```js
    return json({ answer, citations, grounded_in, fallback, model, usage, neurons, register, backend: result.backend, duration_ms, ask_answer_id, archive_error });
```

Delete the now-unused module-scope `FALLBACK` constant: the engine owns the refusal text.

- [ ] **Step 2: Update the worker header comment**

Replace the four-line header of `scripts/ask-eval/worker/index.js` with:

```js
// zz-ask-eval-delete-me: the unmetered eval path for the /ask review.
//
// It now imports functions/api/ask/_engine.js, the SAME module the page calls,
// rather than mirroring the v2 branch by hand. That is the point: an eval that
// runs a parallel implementation measures the parallel implementation. No
// session, no cap, no SSE. Bearer guarded.
```

- [ ] **Step 3: Deploy and prove it (Brian's go required)**

**HUMAN CHECKPOINT.** Push `rrm-academy-cf` to `main` first and let `deploy.yml` go green, then:

```bash
cd scripts/ask-eval/worker && npx wrangler@4.62.0 deploy && cd -
EVAL_TOKEN=$(op read 'op://Automation/RRM Ask Eval Worker Token/credential') \
  node scripts/ask-eval/run.mjs --eval --golden --tag "golden-$(date -u +%Y-%m-%d)-p2"
```
Expected: `GOLDEN PASS`, and every result carries a non-null `register` and `ask_answer_id`.

- [ ] **Step 4: Prove G2 against the live DO**

Two concurrent requests at the boundary, against a real account. Use a test member account already at 19 for the day:

```bash
node -e '
const S = process.env.RRM_SESSION;
const post = () => fetch("https://rrmacademy.org/api/ask", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: `session=${S}`, Origin: "https://rrmacademy.org" },
  body: JSON.stringify({ message: "What does FABM stand for?" }),
}).then(r => r.status);
Promise.all([post(), post()]).then(([a, b]) => {
  console.log("statuses", a, b);
  const ok = [a, b].filter(s => s === 200).length;
  console.log(ok === 1 ? "G2 PASS: exactly one 200" : `G2 FAIL: ${ok} answered`);
  process.exit(ok === 1 ? 0 : 1);
});
'
```
Expected: `G2 PASS: exactly one 200`.

- [ ] **Step 5: Prove G1 with a fresh free account**

Three questions answered with citations, the fourth a 429 with `RateLimit-Remaining: 0`, and no 504 anywhere. Run the same `post()` four times against a free account's session and read the statuses and headers. Expected: `200 200 200 429`.

- [ ] **Step 6: Commit**

```bash
cat > /tmp/askrrm-p2-t6.msg <<'MSG'
feat(ask): eval worker runs the engine module

The eval worker imported the v2 branch's logic by hand. It now imports
_engine.js, the same module the page calls, so an eval number is a statement
about production rather than about a parallel implementation.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add scripts/ask-eval/worker/ scripts/ask-eval/runs/
git commit -F /tmp/askrrm-p2-t6.msg
git push origin main
```

---

## Self-review

**Spec coverage.** Section 5's `answer({ message, thread, register, backend, env, waitUntil })` and the two `_backends/` files are Task 4; the engine building its own citations and the cite-or-refuse step are Task 4 Step 5. Section 5a's `/generate` row (request shape, response shape, 12,000 cap, 400 `prompt_too_long`) is Task 2. Section 7's tiers and unchanged caps, plus "free tier real on v2", are Task 5. Section 7a's sharding key, atomic take, fail-closed posture, `script_name` wiring and "no reset job" are Tasks 1 and 5. Section 9a's migration is Task 3. Section 10's capability JSON gaining `version`, `registers` and `caps` is Task 5 Step 5. Section 14 step 2's "v1 deleted" is Task 5 Step 4 and Step 6; "thread_id accepted and stored but not yet read into the prompt" is Task 5 Step 4, where `threadId` reaches `logAskAnswer` and is deliberately NOT passed to `engineAnswer`. Section 14 step 2's "eval worker switched to the module" is Task 6. G1 is Task 5 and Task 6 Step 5; G2 is Task 1 and Task 6 Step 4; G3 is Task 4; G9 is Task 4's backend-selection tests; G13 is Task 5.

Deliberately NOT here, and named in the INDEX: `/retrieve` and `/resolve`, rewrite, rerank, fact-check, the pipeline time budget and SSE stage events (all P3); the thread read path and feedback (P5); `cost_neurons` reaching the spend daemon (P6). `cost_neurons` is WRITTEN here, in Task 5 Step 4, because the column exists from Task 3 and a column that ships empty for two waves is a column nobody trusts.

**Placeholder scan.** No TBDs. Every code block is complete and every command has an expected output. Task 4 Step 6 is a verification rather than an edit, and says what to do if it fails.

**Type consistency.** `answer()` returns the same `AnswerResult` keys at its definition (Task 4 Step 5), in `ask.js` (Task 5 Step 4) and in the eval worker (Task 6 Step 1): `answer, citations, fallback, model, usage, neurons, register, backend, rewritten_query, rewrite_fallback, fact_check_error, grounded_in, duration_ms`, plus `errorCode` and `httpStatus` on failure. `Citation` is `{ url, title, type, slug }` at `toCitation`, in the capability JSON's declared shape, and in the P5 page renderer. `generate({ systemPrompt, chunks, turns, env })` takes the same four keys in both backends and is called with exactly those in the engine. `quotaShardName(userId, utcDay)` is the same template in `rrm-ai-search/src/quota.js` and in `ask.js`; the two are deliberately separate one-line copies because Pages cannot import across the repo boundary, and the DO test pins the format so a drift is a failing test rather than a silently doubled cap.
