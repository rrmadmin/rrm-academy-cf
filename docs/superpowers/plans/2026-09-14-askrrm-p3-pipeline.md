# AskRRM P3 Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single combined `/ask` call with the real pipeline: rewrite, retrieve at depth, rerank, generate, cite-or-refuse, fact-check, live citation resolve. Add `/retrieve` and `/resolve` to `rrm-ai-search`, put the whole thing behind `feature:ask_pipeline_v3`, bound it with a wall-clock budget, and emit SSE stage events the page can show.

**Architecture:** `rrm-ai-search` gains two read-only routes: `/retrieve` returns full chunk text (not the 280-character snippet `/search` truncates to) and `/resolve` answers published, retracted, excluded or not found for a list of URLs. `functions/api/ask/_engine.js` grows a nine-step pipeline with a 40-second total budget and per-step sub-budgets; the steps that share the last 4 seconds degrade rather than blow the total. The flag `feature:ask_pipeline_v3` in `COMMUNITY_KV` chooses the new path; anything other than `on` keeps the P2 combined call.

**Tech Stack:** Cloudflare Workers, Workers AI (`@cf/meta/llama-3.1-8b-instruct` for rewrite, `@cf/baai/bge-reranker-base` for rerank, Llama 3.3 70B for generation), `rrm-library-worker` `/check-facts` and `/related` over agent scope, D1, SSE.

**Spec:** `docs/superpowers/specs/2026-09-14-askrrm-engine-design.md` (sections 5 steps 1 to 8, 5a `/retrieve` and `/resolve`, the pipeline time budget, 14 step 3; proof gates G3, G10)

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
| rrm-ai-search | `src/index.js` | MODIFY. `POST /retrieve`, `POST /resolve`. |
| rrm-ai-search | `test/retrieve-resolve.test.mjs` | CREATE. |
| rrm-academy-cf | `functions/api/ask/_pipeline.js` | CREATE. Rewrite, rerank, fact-check, resolve, related, and the budget clock. Pure functions plus thin fetch wrappers, so each is testable alone. |
| rrm-academy-cf | `functions/api/ask/_engine.js` | MODIFY. `answer()` branches on the flag and runs the pipeline. |
| rrm-academy-cf | `functions/api/ask.js` | MODIFY. SSE stage events. |
| rrm-academy-cf | `src/pages/ask.astro` | MODIFY. Consume stage events; consume the error map. |
| rrm-academy-cf | `test/ask-pipeline.test.js` | CREATE. |

---

## Part A: rrm-ai-search

### Task 1: POST /retrieve and POST /resolve

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`, `README.md`
- Test: `/Users/brian/iCode/projects/rrm-ai-search/test/retrieve-resolve.test.mjs`

**Interfaces:**
- Consumes: the existing `hybridSearch`, `resolveItems`, `itemExists`, `itemUrl`, `bucketFromKey`, `authorized`, `readBody`, `logEvent`.
- Produces:
  - `POST /retrieve`, bearer. Request `{ query: string (2 to 500), top_k?: number (1 to 20, default 12), filters?: object }`. Response `200 { chunks: [{ key, text, type, slug, score }], retrieval_ms }`. FULL chunk text, never a snippet.
  - `POST /resolve`, bearer. Request `{ urls: string[] (1 to 50) }`. Response `200 { resolved: [{ url, status }] }` with `status` in `published | retracted | excluded | not_found`.
  - `export const RETRIEVE_MAX_TOP_K = 20` and `export const RESOLVE_MAX_URLS = 50`.

- [ ] **Step 1: Write the failing test**

Create `test/retrieve-resolve.test.mjs`:

```js
/**
 * /retrieve exists because /search truncates every chunk to 280 characters,
 * which is fine for a search result list and useless as model context: the
 * model cannot answer from a snippet it was not given.
 *
 * /resolve exists for citations step 5 did not already vouch for, chiefly the
 * ones fact-check attaches and the ones carried in from a thread.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { RETRIEVE_MAX_TOP_K, RESOLVE_MAX_URLS } from '../src/index.js';

const AUTH = 'test-worker-auth';
const post = (path, body) => new Request(`https://internal${path}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${AUTH}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const LONG = 'x'.repeat(4000);

function env({ chunks = null, articles = [], posts = [], faqs = [], glossary = [] } = {}) {
  const rows = { articles, posts, faqs, glossary };
  const table = (sql) => (sql.includes('FROM articles') ? 'articles' : sql.includes('FROM posts') ? 'posts' : sql.includes('FROM faq ') || sql.includes('FROM faq\n') ? 'faqs' : 'glossary');
  return {
    AI_SEARCH_WORKER_AUTH: AUTH,
    EVENTS: { writeDataPoint() {} },
    ASK_KB: {
      async search() {
        return { chunks: chunks || [{ item: { key: '/library/example.md', metadata: { type: 'article' } }, text: LONG, score: 0.9 }] };
      },
    },
    LIBRARY_DB: { prepare: (sql) => ({ bind: () => ({ all: async () => ({ results: rows[table(sql)] || [] }) }) }) },
    AUTH_DB: { prepare: (sql) => ({ bind: () => ({ all: async () => ({ results: rows[table(sql)] || [] }) }) }) },
  };
}

test('retrieve returns FULL chunk text, not a 280 character snippet', async () => {
  const e = env({ articles: [{ slug: 'example', title: 'Example' }] });
  const res = await worker.fetch(post('/retrieve', { query: 'what is rrm' }), e, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.chunks.length, 1);
  assert.equal(body.chunks[0].text.length, 4000, 'chunk text was truncated');
  assert.equal(body.chunks[0].key, '/library/example.md');
  assert.equal(body.chunks[0].type, 'article');
  assert.equal(body.chunks[0].slug, 'example');
  assert.equal(typeof body.retrieval_ms, 'number');
});

test('retrieve drops a chunk whose page we cannot prove is live', async () => {
  // No article row resolves, so itemExists is false and the chunk is not served
  // as grounding. Same gate /ask and /search already apply.
  const res = await worker.fetch(post('/retrieve', { query: 'what is rrm' }), env({}), {});
  assert.deepEqual((await res.json()).chunks, []);
});

test('retrieve clamps top_k to 20 and refuses a bad query', async () => {
  assert.equal(RETRIEVE_MAX_TOP_K, 20);
  const e = env({ articles: [{ slug: 'example', title: 'Example' }] });
  const ok = await worker.fetch(post('/retrieve', { query: 'valid', top_k: 999 }), e, {});
  assert.equal(ok.status, 200);
  assert.equal((await worker.fetch(post('/retrieve', { query: 'x' }), e, {})).status, 400);
  assert.equal((await worker.fetch(post('/retrieve', {}), e, {})).status, 400);
});

test('resolve reports published for a live article and not_found for an unknown url', async () => {
  const e = env({ articles: [{ slug: 'example', title: 'Example' }] });
  const res = await worker.fetch(post('/resolve', {
    urls: ['https://rrmacademy.org/library/example/', 'https://rrmacademy.org/library/nope/'],
  }), e, {});
  assert.equal(res.status, 200);
  const { resolved } = await res.json();
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].status, 'published');
  assert.equal(resolved[1].status, 'not_found');
});

test('resolve refuses an empty list and a list over the cap', async () => {
  const e = env();
  assert.equal((await worker.fetch(post('/resolve', { urls: [] }), e, {})).status, 400);
  const many = Array.from({ length: RESOLVE_MAX_URLS + 1 }, (_, i) => `https://rrmacademy.org/library/a${i}/`);
  assert.equal((await worker.fetch(post('/resolve', { urls: many }), e, {})).status, 400);
});

test('both routes refuse without the bearer', async () => {
  const bare = (p) => new Request(`https://internal${p}`, { method: 'POST', body: '{}' });
  assert.equal((await worker.fetch(bare('/retrieve'), env(), {})).status, 401);
  assert.equal((await worker.fetch(bare('/resolve'), env(), {})).status, 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && node --test test/retrieve-resolve.test.mjs`
Expected: FAIL. Neither export exists and both routes answer 404.

- [ ] **Step 3: Implement both routes**

In `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`, add above `handleSearch`:

```js
export const RETRIEVE_MAX_TOP_K = 20;
export const RESOLVE_MAX_URLS = 50;

/**
 * POST /retrieve -- retrieval for the engine, with FULL chunk text.
 *
 * /search truncates every chunk to 280 characters, which is right for a result
 * list and wrong for model context: the model cannot answer from text it was
 * never given. The public /search shape is deliberately unchanged and stays
 * exactly as the page's own search box expects it.
 *
 * Same existence gate as /ask and /search: a chunk whose page we cannot prove
 * is live is dropped, never served as grounding. A citation to a 404 is
 * indistinguishable from a hallucinated source on a medical-education site.
 */
async function handleRetrieve(request, env) {
  const body = await readBody(request);
  if (!body || typeof body.query !== 'string' || body.query.length < 2 || body.query.length > 500) {
    return json({ error: 'invalid_input' }, 400);
  }
  const topK = Number.isInteger(body.top_k) && body.top_k > 0
    ? Math.min(body.top_k, RETRIEVE_MAX_TOP_K)
    : SEARCH_TOP_K;
  const filters = sanitizeFilters(body.filters);
  const queryHash = await hashShort(body.query);
  const start = Date.now();

  let retrieval;
  try {
    retrieval = await hybridSearch(env, body.query, { filters });
  } catch (e) {
    logEvent(env, 'retrieve_error', 502, { messageHash: queryHash, durationMs: Date.now() - start, errorMessage: e?.message });
    return json({ error: 'retrieval_error' }, 502);
  }

  const raw = (retrieval.result?.chunks || []).slice(0, topK);
  const seen = new Set();
  const staged = [];
  for (const chunk of raw) {
    const key = chunk?.item?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    staged.push(chunk);
  }
  const itemMap = await resolveItems(env, [...seen]);
  const chunks = staged
    .filter((c) => itemExists(itemMap.get(c.item.key)))
    .map((c) => {
      const key = c.item.key;
      const item = itemMap.get(key);
      const bucket = bucketFromKey(key);
      return {
        key,
        text: c.text || '',
        type: item?.sourceType || bucket?.sourceType || null,
        slug: item?.fullSlug || bucket?.slug || null,
        score: typeof c.score === 'number' ? c.score : null,
        url: itemUrl(key, item),
        title: item?.title || null,
      };
    });

  logEvent(env, 'retrieve', 200, { messageHash: queryHash, durationMs: Date.now() - start, retrievalMs: retrieval.retrievalMs });
  return json({ chunks, retrieval_ms: retrieval.retrievalMs });
}

/**
 * POST /resolve -- is this URL still a live page?
 *
 * /generate already vouched for the primary reranked set through resolveItems,
 * so this route exists for the citations that step did NOT vouch for: the ones
 * fact-check attaches, and the ones carried in from an earlier turn in a
 * thread. A dead one is dropped by the caller, and if that empties the list the
 * caller's cite-or-refuse fires.
 */
async function handleResolve(request, env) {
  const body = await readBody(request);
  if (!body || !Array.isArray(body.urls) || body.urls.length === 0 || body.urls.length > RESOLVE_MAX_URLS) {
    return json({ error: 'invalid_input' }, 400);
  }
  const start = Date.now();

  // Map each URL back to a corpus key so resolveItems can answer for it. A URL
  // shape the corpus has no key for is not_found: we cannot prove it is live,
  // and unprovable is the same as dead for a citation.
  const keyByUrl = new Map();
  for (const url of body.urls) {
    if (typeof url !== 'string' || url.length > 500) continue;
    let path = null;
    try { path = new URL(url).pathname.replace(/\/$/, ''); } catch { continue; }
    const anchor = url.includes('#') ? url.split('#')[1] : null;
    if (path === '/glossary' && anchor) keyByUrl.set(url, `/glossary/${anchor}.md`);
    else if (/^\/(library|commentary|faqs|glossary|guides)\//.test(path)) keyByUrl.set(url, `${path}.md`);
    else if (/^\/[a-z][a-z0-9-]*$/.test(path)) keyByUrl.set(url, `${path}.md`);
  }

  const itemMap = await resolveItems(env, [...new Set(keyByUrl.values())]);
  const resolved = body.urls.map((url) => {
    const key = keyByUrl.get(url);
    if (!key) return { url, status: 'not_found' };
    const item = itemMap.get(key);
    if (!item) return { url, status: 'not_found' };
    // resolveItems sets a title iff a live, published, non-retracted, non-excluded
    // page exists. It cannot currently distinguish retracted from excluded from
    // simply absent, so everything that fails the predicate reports not_found and
    // the caller drops it either way. The three-way split stays in the response
    // shape for when the worker can tell them apart.
    return { url, status: itemExists(item) ? 'published' : 'not_found' };
  });

  logEvent(env, 'resolve', 200, { messageHash: String(body.urls.length), durationMs: Date.now() - start });
  return json({ resolved });
}
```

In `handlers.fetch`, add above the `/search` line:

```js
    if (url.pathname === '/retrieve') return handleRetrieve(request, env);
    if (url.pathname === '/resolve') return handleResolve(request, env);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && npm test`
Expected: PASS.

- [ ] **Step 5: Update the README and commit**

Add the two routes to the `## Endpoints` list, with the `/search` snippet note stated explicitly, then:

```bash
cd /Users/brian/iCode/projects/rrm-ai-search
cat > /tmp/askrrm-p3-t1.msg <<'MSG'
feat(ask): POST /retrieve and POST /resolve

/retrieve returns full chunk text. /search truncates to 280 characters, which is
right for a result list and useless as model context, so the engine gets its own
route rather than a widened public one. /resolve answers whether a URL is still
a live page, for the citations that generation did not already vouch for: the
ones fact-check attaches and the ones carried in from a thread.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add src/index.js test/retrieve-resolve.test.mjs README.md
git commit -F /tmp/askrrm-p3-t1.msg
```

- [ ] **Step 6: Deploy (Brian's go required)**

**HUMAN CHECKPOINT.** Then `npm run deploy` with the Phase 2 token, as in P2 Task 2 Step 7.

---

## Part B: rrm-academy-cf

### Task 2: Pipeline primitives and the budget clock

**Files:**
- Create: `functions/api/ask/_pipeline.js`
- Test: `test/ask-pipeline.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks at module level.
- Produces:
  - `budget(totalMs) -> { left(): number, spend(ms): void, allow(wantMs): boolean, elapsed(): number }`
  - `STEP_BUDGETS = { rewrite: 4000, retrieve: 6000, rerank: 4000, generate: 22000, tail: 4000 }` and `TOTAL_BUDGET_MS = 40000`
  - `acceptRewrite(original, candidate) -> { query: string, fallback: boolean }`
  - `async rewriteQuery({ message, turns, env, budget }) -> { query, fallback }`
  - `async rerankChunks({ query, chunks, env, budget, topN = 8 }) -> chunk[]`
  - `extractNumericSentences(answer) -> string[]`
  - `async checkFacts({ answer, env, budget }) -> { unverified: string[], factCheckError: boolean, facts: Citation[] }`
  - `async resolveCitations({ citations, env, budget }) -> Citation[]`
  - `async relatedFor({ citation, env, budget }) -> Citation[]`
  - `THIN_RETRIEVAL_THRESHOLD = 3`

- [ ] **Step 1: Write the failing test**

Create `test/ask-pipeline.test.js`:

```js
/**
 * The pipeline primitives. Each is a pure function or a thin fetch wrapper so
 * it can be tested alone; the engine is the only thing that knows their order.
 *
 * The budget is the load-bearing piece: every step that can be skipped must
 * DEGRADE and mark the row, never blow the total. The answer ships.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  budget, TOTAL_BUDGET_MS, STEP_BUDGETS, THIN_RETRIEVAL_THRESHOLD,
  acceptRewrite, rewriteQuery, rerankChunks, extractNumericSentences, checkFacts, resolveCitations, relatedFor,
} from '../functions/api/ask/_pipeline.js';

describe('budget', () => {
  it('reports what is left and refuses a step that does not fit', () => {
    const b = budget(1000);
    b.spend(900);
    assert.equal(b.allow(50), true);
    assert.equal(b.allow(500), false);
    assert.ok(b.left() <= 100);
  });
  it('the step budgets fit inside the total', () => {
    const sum = STEP_BUDGETS.rewrite + STEP_BUDGETS.retrieve + STEP_BUDGETS.rerank + STEP_BUDGETS.generate + STEP_BUDGETS.tail;
    assert.equal(sum, TOTAL_BUDGET_MS);
  });
});

describe('acceptRewrite', () => {
  const orig = 'pcos and progesterone what does rrm say';
  it('accepts a plausible rewrite', () => {
    const r = acceptRewrite(orig, 'What does RRM say about PCOS and progesterone?');
    assert.equal(r.fallback, false);
    assert.match(r.query, /PCOS/);
  });
  it('falls back on an empty rewrite', () => {
    assert.deepEqual(acceptRewrite(orig, ''), { query: orig, fallback: true });
  });
  it('falls back on a rewrite over 500 characters', () => {
    assert.equal(acceptRewrite(orig, 'x'.repeat(501)).fallback, true);
  });
  it('falls back on a rewrite containing a newline', () => {
    assert.equal(acceptRewrite(orig, 'One line\nTwo line').fallback, true);
  });
  it('falls back when the rewrite changes script', () => {
    assert.equal(acceptRewrite(orig, 'PCOS とプロゲステロン').fallback, true);
  });
  it('falls back on a null or non-string rewrite', () => {
    assert.equal(acceptRewrite(orig, null).fallback, true);
    assert.equal(acceptRewrite(orig, 42).fallback, true);
  });
});

describe('rewriteQuery', () => {
  const env = (response) => ({ AI: { async run() { return { response }; } } });
  it('skips the model entirely for an already-formed question', async () => {
    let called = false;
    const e = { AI: { async run() { called = true; return { response: 'x' }; } } };
    const long = 'What does the library say about excision surgery compared with ablation?';
    const r = await rewriteQuery({ message: long, turns: [], env: e, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(called, false, 'a question mark and over 40 characters means no rewrite is needed');
    assert.equal(r.query, long);
    assert.equal(r.fallback, false);
  });
  it('rewrites a fragment', async () => {
    const r = await rewriteQuery({ message: 'pcos progest', turns: [], env: env('What does RRM say about PCOS and progesterone?'), budget: budget(TOTAL_BUDGET_MS) });
    assert.match(r.query, /PCOS/);
    assert.equal(r.fallback, false);
  });
  it('falls back to the original when the model throws', async () => {
    const e = { AI: { async run() { throw new Error('down'); } } };
    const r = await rewriteQuery({ message: 'pcos progest', turns: [], env: e, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(r.query, 'pcos progest');
    assert.equal(r.fallback, true);
  });
  it('falls back when there is no budget left', async () => {
    let called = false;
    const e = { AI: { async run() { called = true; return { response: 'x' }; } } };
    const b = budget(TOTAL_BUDGET_MS); b.spend(TOTAL_BUDGET_MS);
    const r = await rewriteQuery({ message: 'pcos progest', turns: [], env: e, budget: b });
    assert.equal(called, false);
    assert.equal(r.fallback, true);
  });
});

describe('rerankChunks', () => {
  const chunks = Array.from({ length: 12 }, (_, i) => ({ key: `/library/a${i}.md`, text: `chunk ${i}` }));
  it('returns the top 8 in reranker order', async () => {
    const env = { AI: { async run(_m, { contexts }) { return { response: contexts.map((_, i) => ({ id: contexts.length - 1 - i, score: i / 100 })) }; } } };
    const out = await rerankChunks({ query: 'q', chunks, env, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(out.length, 8);
    assert.equal(out[0].key, '/library/a11.md', 'highest scoring chunk must come first');
  });
  it('degrades to the first 8 retrieved when the reranker fails', async () => {
    const env = { AI: { async run() { throw new Error('reranker down'); } } };
    const out = await rerankChunks({ query: 'q', chunks, env, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(out.length, 8);
    assert.equal(out[0].key, '/library/a0.md');
  });
  it('returns everything when there are fewer than eight chunks', async () => {
    const env = { AI: { async run() { throw new Error('x'); } } };
    const out = await rerankChunks({ query: 'q', chunks: chunks.slice(0, 3), env, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(out.length, 3);
  });
});

describe('extractNumericSentences', () => {
  it('picks sentences carrying a number with a unit or percent', () => {
    const out = extractNumericSentences('RRM helps many people. About 78% conceived within 24 months. Charting is useful.');
    assert.equal(out.length, 1);
    assert.match(out[0], /78%/);
  });
  it('ignores a bare number with no unit', () => {
    assert.deepEqual(extractNumericSentences('There were 200 patients in the room.'), []);
  });
});

describe('checkFacts', () => {
  const answer = 'About 78% conceived within 24 months.';
  const goodEnv = (payload) => ({
    LIBRARY_WORKER_URL: 'https://lib.example',
    LIBRARY_AGENT_TOKEN: 'tok',
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });

  it('marks nothing unverified when the claim is confirmed', async () => {
    const r = await checkFacts({ answer, env: goodEnv({ claims_found: 1, verified: 1, warnings: [], errors: [], passed: true }), budget: budget(TOTAL_BUDGET_MS) });
    assert.deepEqual(r.unverified, []);
    assert.equal(r.factCheckError, false);
  });

  it('marks the sentence unverified when nothing matched', async () => {
    const r = await checkFacts({ answer, env: goodEnv({ claims_found: 1, verified: 0, warnings: [], errors: [], passed: true }), budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(r.unverified.length, 1);
    assert.equal(r.factCheckError, false);
  });

  it('G10: a non-2xx marks EVERY numeric claim unverified and sets factCheckError', async () => {
    const env = { LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok', fetchImpl: async () => new Response('{}', { status: 500 }) };
    const r = await checkFacts({ answer, env, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(r.unverified.length, 1, 'a failed check must never read as verified');
    assert.equal(r.factCheckError, true);
  });

  it('G10: a throw does the same', async () => {
    const env = { LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok', fetchImpl: async () => { throw new Error('timeout'); } };
    const r = await checkFacts({ answer, env, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(r.factCheckError, true);
    assert.equal(r.unverified.length, 1);
  });

  it('a missing secret is a service_unavailable throw, never a silent skip', async () => {
    await assert.rejects(
      () => checkFacts({ answer, env: { fetchImpl: async () => new Response('{}') }, budget: budget(TOTAL_BUDGET_MS) }),
      (e) => e.errorCode === 'service_unavailable',
    );
  });

  it('skips and marks error when the tail budget is gone', async () => {
    const b = budget(TOTAL_BUDGET_MS); b.spend(TOTAL_BUDGET_MS);
    const r = await checkFacts({ answer, env: goodEnv({ verified: 1 }), budget: b });
    assert.equal(r.factCheckError, true);
    assert.equal(r.unverified.length, 1);
  });
});

describe('resolveCitations', () => {
  const cites = [
    { url: 'https://rrmacademy.org/library/live/', title: 'Live', type: 'article', slug: 'live' },
    { url: 'https://rrmacademy.org/library/dead/', title: 'Dead', type: 'article', slug: 'dead' },
  ];
  it('drops a citation the worker says is not live', async () => {
    const env = {
      AI_SEARCH: { async fetch() { return new Response(JSON.stringify({ resolved: [
        { url: cites[0].url, status: 'published' }, { url: cites[1].url, status: 'not_found' },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } },
      AI_SEARCH_WORKER_AUTH: 'tok',
    };
    const out = await resolveCitations({ citations: cites, env, budget: budget(TOTAL_BUDGET_MS) });
    assert.equal(out.length, 1);
    assert.equal(out[0].url, cites[0].url);
  });
  it('keeps the list unchanged when the resolve call itself fails', async () => {
    // Dropping every citation on a resolver outage would turn an outage into a
    // refusal. The cite-or-refuse gate already ran on these; leave them.
    const env = { AI_SEARCH: { async fetch() { throw new Error('down'); } }, AI_SEARCH_WORKER_AUTH: 'tok' };
    assert.equal((await resolveCitations({ citations: cites, env, budget: budget(TOTAL_BUDGET_MS) })).length, 2);
  });
});

describe('relatedFor', () => {
  const cite = { url: 'https://rrmacademy.org/library/x/', title: 'X', type: 'article', slug: 'x' };
  it('returns up to four related records', async () => {
    const env = {
      LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok',
      fetchImpl: async () => new Response(JSON.stringify({ related: Array.from({ length: 9 }, (_, i) => ({ type: 'article', slug: `r${i}`, title: `R${i}` })) }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
    assert.equal((await relatedFor({ citation: cite, env, budget: budget(TOTAL_BUDGET_MS) })).length, 4);
  });
  it('a non-2xx leaves the list empty and never blocks the answer', async () => {
    const env = { LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok', fetchImpl: async () => new Response('{}', { status: 404 }) };
    assert.deepEqual(await relatedFor({ citation: cite, env, budget: budget(TOTAL_BUDGET_MS) }), []);
  });
});

it('THIN_RETRIEVAL_THRESHOLD is three, matching editorial rule 13', () => {
  assert.equal(THIN_RETRIEVAL_THRESHOLD, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-pipeline.test.js`
Expected: FAIL with `Cannot find module .../functions/api/ask/_pipeline.js`

- [ ] **Step 3: Write the module**

Create `functions/api/ask/_pipeline.js`:

```js
/**
 * AskRRM pipeline primitives.
 *
 * Each export is a pure function or a thin, injectable fetch wrapper. The
 * ENGINE knows their order; none of them knows about any other. That is what
 * lets every one of them be tested alone, including the degraded paths, which
 * are the ones that actually matter here.
 *
 * THE BUDGET IS THE POINT. Total wall time is 40 seconds. Rewrite, retrieve,
 * rerank and generate take 4, 6, 4 and 22; fact-check, resolve and related
 * share the last 4. A step that cannot fit in what is LEFT is skipped and
 * marked on the archived row, never allowed to blow the total. The answer
 * ships. Archiving is exempt: it runs in waitUntil.
 *
 * `env.fetchImpl` is an injection seam for the tests. Production leaves it
 * unset and the module uses global fetch.
 */

export const TOTAL_BUDGET_MS = 40000;
export const STEP_BUDGETS = { rewrite: 4000, retrieve: 6000, rerank: 4000, generate: 22000, tail: 4000 };
export const THIN_RETRIEVAL_THRESHOLD = 3;

const REWRITE_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const RERANK_MODEL = '@cf/baai/bge-reranker-base';
const RERANK_TOP_N = 8;
const MAX_REWRITE_CHARS = 500;
const MAX_RELATED = 4;

export function budget(totalMs = TOTAL_BUDGET_MS) {
  const started = Date.now();
  let extra = 0;
  return {
    elapsed: () => (Date.now() - started) + extra,
    left() { return Math.max(0, totalMs - this.elapsed()); },
    spend(ms) { extra += ms; },
    allow(wantMs) { return this.left() >= wantMs; },
  };
}

function doFetch(env, url, init) {
  const f = env?.fetchImpl || fetch;
  return f(url, init);
}

function libraryEnv(env) {
  if (!env?.LIBRARY_WORKER_URL || !env?.LIBRARY_AGENT_TOKEN) {
    // A missing secret is a deployment fault, not a reason to answer as if the
    // check had run and passed. 503, never a silent skip.
    throw Object.assign(new Error('service_unavailable'), { httpStatus: 503, errorCode: 'service_unavailable' });
  }
  return { base: String(env.LIBRARY_WORKER_URL).replace(/\/$/, ''), token: env.LIBRARY_AGENT_TOKEN };
}

/** Very rough script class, enough to tell "same alphabet" from "different one". */
function scriptOf(s) {
  if (/[぀-ヿ一-鿿]/.test(s)) return 'cjk';
  if (/[Ѐ-ӿ]/.test(s)) return 'cyrillic';
  if (/[؀-ۿ]/.test(s)) return 'arabic';
  return 'latin';
}

/**
 * The rewrite is ACCEPTED only if it is 1 to 500 characters, in the same script
 * as the input, and carries no newline. Otherwise the original message is used
 * and the row records rewrite_fallback = 1. A rewrite is a convenience; a bad
 * one silently changing the question is not.
 */
export function acceptRewrite(original, candidate) {
  if (typeof candidate !== 'string') return { query: original, fallback: true };
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_REWRITE_CHARS) return { query: original, fallback: true };
  if (/[\n\r]/.test(candidate)) return { query: original, fallback: true };
  if (scriptOf(trimmed) !== scriptOf(original)) return { query: original, fallback: true };
  return { query: trimmed, fallback: false };
}

export async function rewriteQuery({ message, turns = [], env, budget: b }) {
  // Already a full question: no model call, no cost, no risk of a bad rewrite.
  if (message.trim().endsWith('?') && message.trim().length > 40) {
    return { query: message, fallback: false };
  }
  if (!b.allow(STEP_BUDGETS.rewrite) || !env?.AI) return { query: message, fallback: true };

  const context = turns.slice(-3).map((t) => `Q: ${t.question}`).join('\n');
  const system = 'Rewrite the user text as one complete question in the same language. Fix typos. Do not answer it. Do not add information. Reply with the question and nothing else.';
  const user = context ? `Earlier questions:\n${context}\n\nRewrite this: ${message}` : `Rewrite this: ${message}`;

  try {
    const resp = await env.AI.run(REWRITE_MODEL, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 128,
    });
    const candidate = typeof resp === 'string' ? resp : resp?.response;
    return acceptRewrite(message, candidate);
  } catch {
    return { query: message, fallback: true };
  }
}

/**
 * Rerank the retrieved chunks and keep the top eight.
 *
 * DEGRADES rather than fails: a reranker outage means the first eight retrieved
 * become the context, which is exactly what the pipeline did before rerank
 * existed. A missing rerank is a quality loss, never an outage.
 */
export async function rerankChunks({ query, chunks, env, budget: b, topN = RERANK_TOP_N }) {
  const list = chunks || [];
  if (list.length <= topN) return list;
  if (!b.allow(STEP_BUDGETS.rerank) || !env?.AI) return list.slice(0, topN);
  try {
    const resp = await env.AI.run(RERANK_MODEL, { query, contexts: list.map((c) => ({ text: c.text || '' })) });
    const scored = (typeof resp === 'string' ? null : resp?.response) || [];
    if (!Array.isArray(scored) || scored.length === 0) return list.slice(0, topN);
    return scored
      .slice()
      .sort((a, z) => (z.score ?? 0) - (a.score ?? 0))
      .map((s) => list[s.id])
      .filter(Boolean)
      .slice(0, topN);
  } catch {
    return list.slice(0, topN);
  }
}

/** Sentences carrying a number bound to a percent or a unit. */
export function extractNumericSentences(answerText) {
  const text = typeof answerText === 'string' ? answerText : '';
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /\d+(?:\.\d+)?\s*(?:%|percent|mg|mcg|ml|iu|units?|months?|weeks?|days?|years?|fold|x)\b/i.test(s));
}

/**
 * Fact-check the numeric sentences against the library worker's curated facts.
 *
 * THIS IS A CHECK, NOT A REWRITE. It never edits the answer. A match attaches
 * the fact as a citation; a miss marks the sentence unverified.
 *
 * G10 failure mode: ANY non-2xx, throw, timeout, or exhausted budget marks
 * EVERY extracted numeric claim unverified and sets factCheckError. A check
 * that did not run must never read as a check that passed.
 */
export async function checkFacts({ answer, env, budget: b }) {
  const sentences = extractNumericSentences(answer);
  if (sentences.length === 0) return { unverified: [], factCheckError: false, facts: [] };

  const { base, token } = libraryEnv(env);
  if (!b.allow(500)) return { unverified: sentences, factCheckError: true, facts: [] };

  let data;
  try {
    const resp = await doFetch(env, `${base}/check-facts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentences.join(' ') }),
      signal: AbortSignal.timeout(Math.min(b.left(), STEP_BUDGETS.tail)),
    });
    if (!resp.ok) return { unverified: sentences, factCheckError: true, facts: [] };
    data = await resp.json();
  } catch {
    return { unverified: sentences, factCheckError: true, facts: [] };
  }

  const verified = Number(data?.verified) || 0;
  // The worker reports counts, not a per-sentence verdict, so a partial match
  // leaves the unmatched tail marked. Marking more than strictly necessary is
  // the safe direction: an unverified mark understates confidence, a missing
  // one overstates it.
  const unverified = verified >= sentences.length ? [] : sentences.slice(verified);
  const facts = (data?.warnings || []).concat(data?.errors || [])
    .filter((w) => w && w.source)
    .slice(0, 4)
    .map((w) => ({ url: `https://rrmacademy.org/library/${w.source}/`, title: String(w.correct || w.source).slice(0, 160), type: 'fact', slug: String(w.source) }));

  return { unverified, factCheckError: false, facts };
}

/**
 * Drop any citation the worker cannot prove is a live page.
 *
 * A failure of the resolver itself leaves the list UNCHANGED: cite-or-refuse
 * already ran on these, and dropping everything on a resolver outage would turn
 * an outage into a refusal.
 */
export async function resolveCitations({ citations, env, budget: b }) {
  const list = citations || [];
  if (list.length === 0) return list;
  if (!b.allow(500) || !env?.AI_SEARCH || !env?.AI_SEARCH_WORKER_AUTH) return list;
  try {
    const resp = await env.AI_SEARCH.fetch('https://internal/resolve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_SEARCH_WORKER_AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: list.map((c) => c.url).slice(0, 50) }),
      signal: AbortSignal.timeout(Math.min(b.left(), STEP_BUDGETS.tail)),
    });
    if (!resp.ok) return list;
    const data = await resp.json();
    const alive = new Set((data?.resolved || []).filter((r) => r.status === 'published').map((r) => r.url));
    return list.filter((c) => alive.has(c.url));
  } catch {
    return list;
  }
}

/**
 * Up to four related guides or records for the top citation. No model call.
 * A non-2xx leaves the list empty and never blocks the answer.
 */
export async function relatedFor({ citation, env, budget: b }) {
  if (!citation || !citation.type || !citation.slug) return [];
  if (!b.allow(300)) return [];
  let base;
  let token;
  try { ({ base, token } = libraryEnv(env)); } catch { return []; }
  try {
    const url = `${base}/related?type=${encodeURIComponent(citation.type)}&slug=${encodeURIComponent(citation.slug)}&limit=${MAX_RELATED}`;
    const resp = await doFetch(env, url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(Math.min(b.left(), STEP_BUDGETS.tail)),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data?.related || []).slice(0, MAX_RELATED).map((r) => ({
      url: `https://rrmacademy.org/library/${r.slug}/`,
      title: String(r.title || r.slug).slice(0, 200),
      type: String(r.type || 'article'),
      slug: String(r.slug),
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/ask-pipeline.test.js`
Expected: PASS, 27 subtests.

- [ ] **Step 5: Commit**

```bash
cat > /tmp/askrrm-p3-t2.msg <<'MSG'
feat(ask): pipeline primitives and the budget clock

Rewrite, rerank, fact-check, resolve and related as separately testable units,
plus the 40 second wall-clock budget they all consult. Every one degrades rather
than failing: a reranker outage means the first eight retrieved become the
context, a resolver outage leaves the citation list alone rather than turning an
outage into a refusal, and a fact-check that did not run marks every numeric
claim unverified rather than reading as a check that passed. That last one is
proof gate G10.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask/_pipeline.js test/ask-pipeline.test.js
git commit -F /tmp/askrrm-p3-t2.msg
```

---

### Task 3: Wire the pipeline into the engine behind the flag

**Files:**
- Modify: `functions/api/ask/_engine.js`
- Test: `test/ask-engine-v3.test.js`

**Interfaces:**
- Consumes: everything from Task 2, `/retrieve` and `/resolve` from Task 1.
- Produces: `answer()` gains `onStage` in its options. `AnswerResult` gains `unverified: string[]`, `related: Citation[]`, `stages: string[]`. `export async function pipelineEnabled(env) -> boolean` reads `feature:ask_pipeline_v3` from `COMMUNITY_KV`, true only on the exact value `on`, false on any read error.

- [ ] **Step 1: Write the failing test**

Create `test/ask-engine-v3.test.js`:

```js
/**
 * The engine on the v3 pipeline. The flag is the seam: anything other than the
 * exact string "on" keeps the P2 combined call, and a KV read that throws is
 * off, not on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answer, pipelineEnabled, FALLBACK_ANSWER } from '../functions/api/ask/_engine.js';

const CHUNK = (i) => ({ key: `/library/a${i}.md`, text: `Chunk ${i} text.`, type: 'article', slug: `a${i}`, score: 1 - i / 100, url: `https://rrmacademy.org/library/a${i}/`, title: `A${i}` });

function aiSearch({ chunks = [CHUNK(0), CHUNK(1), CHUNK(2)], prose = 'A grounded answer with 78% in it.', resolveAll = true } = {}) {
  return {
    async fetch(url) {
      const p = new URL(url).pathname;
      if (p === '/retrieve') return new Response(JSON.stringify({ chunks, retrieval_ms: 12 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (p === '/generate') return new Response(JSON.stringify({ answer: prose, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, neurons: 9 }, neurons: 9, model: 'm' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (p === '/resolve') return new Response(JSON.stringify({ resolved: chunks.map((c) => ({ url: c.url, status: resolveAll ? 'published' : 'not_found' })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 404 });
    },
  };
}

const kv = (value) => ({ async get() { if (value instanceof Error) throw value; return value; } });

function env(over = {}) {
  return {
    AI_SEARCH: aiSearch(), AI_SEARCH_WORKER_AUTH: 'tok',
    AI: { async run() { return { response: 'What does the library say?' }; } },
    COMMUNITY_KV: kv('on'),
    LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok',
    fetchImpl: async () => new Response(JSON.stringify({ claims_found: 1, verified: 1, warnings: [], errors: [], passed: true, related: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    EVENTS: { writeDataPoint() {} },
    ...over,
  };
}

describe('pipelineEnabled', () => {
  it('is true only for the exact value on', async () => {
    assert.equal(await pipelineEnabled({ COMMUNITY_KV: kv('on') }), true);
    assert.equal(await pipelineEnabled({ COMMUNITY_KV: kv('ON') }), false);
    assert.equal(await pipelineEnabled({ COMMUNITY_KV: kv('all') }), false);
    assert.equal(await pipelineEnabled({ COMMUNITY_KV: kv(null) }), false);
  });
  it('is false when the KV read throws', async () => {
    assert.equal(await pipelineEnabled({ COMMUNITY_KV: kv(new Error('kv down')) }), false);
  });
  it('is false with no KV binding at all', async () => {
    assert.equal(await pipelineEnabled({}), false);
  });
});

describe('answer() on the v3 pipeline', () => {
  it('emits a stage event per step, in order', async () => {
    const seen = [];
    const r = await answer({ message: 'pcos progest', register: 'patient', env: env(), waitUntil: () => {}, onStage: (s) => seen.push(s) });
    assert.deepEqual(seen.slice(0, 5), ['rewriting', 'retrieving', 'reranking', 'thinking', 'checking']);
    assert.deepEqual(r.stages, seen);
  });

  it('archives the rewritten query alongside the original', async () => {
    const r = await answer({ message: 'pcos progest', register: 'patient', env: env(), waitUntil: () => {} });
    assert.equal(r.rewritten_query, 'What does the library say?');
    assert.equal(r.rewrite_fallback, false);
  });

  it('refuses when live resolve empties the citation list (G3 through step 7)', async () => {
    const e = env({ AI_SEARCH: aiSearch({ resolveAll: false }) });
    const r = await answer({ message: 'pcos progest', register: 'patient', env: e, waitUntil: () => {} });
    assert.equal(r.answer, FALLBACK_ANSWER);
    assert.equal(r.fallback, true);
    assert.deepEqual(r.citations, []);
  });

  it('marks an unverified numeric claim and sets fact_check_error on a failed check', async () => {
    const e = env({ fetchImpl: async () => new Response('{}', { status: 500 }) });
    const r = await answer({ message: 'pcos progest', register: 'patient', env: e, waitUntil: () => {} });
    assert.equal(r.fact_check_error, true);
    assert.equal(r.unverified.length, 1);
  });

  it('a retrieval failure is retrieval_error, not a 200 with no citations', async () => {
    const e = env({ AI_SEARCH: { async fetch() { return new Response('{}', { status: 502 }); } } });
    const r = await answer({ message: 'pcos progest', register: 'patient', env: e, waitUntil: () => {} });
    assert.equal(r.errorCode, 'retrieval_error');
  });

  it('a prompt_too_long from /generate surfaces as prompt_too_long, not generation_error', async () => {
    const e = env({ AI_SEARCH: {
      async fetch(url) {
        const p = new URL(url).pathname;
        if (p === '/retrieve') return new Response(JSON.stringify({ chunks: [CHUNK(0)], retrieval_ms: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify({ error: 'prompt_too_long' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      },
    } });
    const r = await answer({ message: 'pcos progest', register: 'patient', env: e, waitUntil: () => {} });
    assert.equal(r.errorCode, 'prompt_too_long');
    assert.equal(r.httpStatus, 400);
  });

  it('the flag off keeps the P2 combined call and emits no stage events', async () => {
    const combined = {
      async fetch(url) {
        assert.equal(new URL(url).pathname, '/ask', 'flag off must not call /retrieve');
        return new Response(JSON.stringify({ answer: 'Old path.', citations: [{ url: 'https://rrmacademy.org/library/a0/', title: 'A0' }], model: 'm' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    };
    const seen = [];
    const r = await answer({ message: 'x', register: 'patient', env: env({ COMMUNITY_KV: kv(null), AI_SEARCH: combined }), waitUntil: () => {}, onStage: (s) => seen.push(s) });
    assert.equal(r.answer, 'Old path.');
    assert.deepEqual(seen, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-engine-v3.test.js`
Expected: FAIL. `pipelineEnabled` is not exported.

- [ ] **Step 3: Implement the branch**

In `functions/api/ask/_engine.js`, add these imports at the top:

```js
import {
  budget, TOTAL_BUDGET_MS, STEP_BUDGETS, THIN_RETRIEVAL_THRESHOLD,
  rewriteQuery, rerankChunks, checkFacts, resolveCitations, relatedFor,
} from './_pipeline.js';
```

Add above `answer`:

```js
const PIPELINE_FLAG = 'feature:ask_pipeline_v3';

/**
 * The v3 pipeline flag. True only on the exact value "on"; a read error, an
 * absent binding, and any other value are all off. A flag that turns itself on
 * when KV is unhappy is not a flag.
 */
export async function pipelineEnabled(env) {
  try {
    if (!env?.COMMUNITY_KV) return false;
    return (await env.COMMUNITY_KV.get(PIPELINE_FLAG)) === 'on';
  } catch {
    return false;
  }
}

/**
 * Steps 1 to 8 of the spec. The budget is consulted before every step that can
 * be skipped, and a skipped step is MARKED on the returned row rather than
 * quietly omitted.
 */
async function runPipeline({ message, thread, register, systemPrompt, env, onStage }) {
  const b = budget(TOTAL_BUDGET_MS);
  const stages = [];
  const stage = (name) => { stages.push(name); if (typeof onStage === 'function') onStage(name); };

  // 1. Rewrite.
  stage('rewriting');
  const { query, fallback: rewriteFallback } = await rewriteQuery({ message, turns: thread, env, budget: b });

  // 2. Retrieve, at depth, with full chunk text.
  stage('retrieving');
  let chunks = [];
  try {
    const resp = await env.AI_SEARCH.fetch('https://internal/retrieve', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_SEARCH_WORKER_AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: 20 }),
      signal: AbortSignal.timeout(STEP_BUDGETS.retrieve),
    });
    if (!resp.ok) return fail('retrieval_error', 502);
    chunks = (await resp.json())?.chunks || [];
  } catch {
    return fail('retrieval_error', 502);
  }

  // 3. Rerank to the top 8.
  stage('reranking');
  const top = await rerankChunks({ query, chunks, env, budget: b });

  // 4. Generate.
  stage('thinking');
  const backend = await selectBackend(env);
  const turns = (thread || []).slice(-3);
  let gen;
  try {
    gen = await backend.generate({
      systemPrompt: top.length < THIN_RETRIEVAL_THRESHOLD
        ? `${systemPrompt}\n\nRETRIEVAL WAS THIN: you were given only ${top.length} excerpt${top.length === 1 ? '' : 's'}. Editorial rule 13 applies: name what the answer rests on before answering.`
        : systemPrompt,
      chunks: top.map((c) => ({ key: c.key, text: c.text })),
      turns: turns.concat([{ question: query, answer: '' }]),
      env,
    });
  } catch (e) {
    return fail(e.errorCode || 'generation_error', e.httpStatus || 502);
  }

  // 5. Cite or refuse, from the chunks WE sent.
  const built = top.map((c) => ({ url: c.url, title: c.title || c.url, type: c.type || 'article', slug: c.slug || null }));
  let gated = enforceCiteOrRefuse(gen.answer, built);

  // 6. Fact-check.
  stage('checking');
  let unverified = [];
  let factCheckError = false;
  let factCitations = [];
  if (!gated.fallback) {
    try {
      const fc = await checkFacts({ answer: gated.answer, env, budget: b });
      unverified = fc.unverified;
      factCheckError = fc.factCheckError;
      factCitations = fc.facts;
    } catch (e) {
      if (e.errorCode === 'service_unavailable') return fail('service_unavailable', 503);
      factCheckError = true;
    }
  }

  // 7. Resolve every citation live, including the ones fact-check attached.
  const withFacts = gated.citations.concat(factCitations);
  const alive = await resolveCitations({ citations: withFacts, env, budget: b });
  gated = enforceCiteOrRefuse(gated.fallback ? gated.answer : gen.answer, alive);

  // 8. Related, for the top citation. Never blocks.
  const related = gated.citations.length ? await relatedFor({ citation: gated.citations[0], env, budget: b }) : [];

  return {
    answer: gated.answer,
    citations: gated.citations,
    fallback: gated.fallback,
    model: gen.model,
    usage: gen.usage,
    neurons: gen.neurons,
    register,
    backend: backend.name,
    rewritten_query: rewriteFallback ? null : query,
    rewrite_fallback: rewriteFallback,
    fact_check_error: factCheckError,
    unverified,
    related,
    grounded_in: built,
    stages,
    duration_ms: b.elapsed(),
  };
}
```

Then at the top of `answer()`, after the register and binding checks, add:

```js
  if (await pipelineEnabled(env)) {
    return runPipeline({ message, thread, register, systemPrompt, env, onStage });
  }
```

and add `onStage` to `answer`'s destructured options. In the P2 combined-call return, add `unverified: [], related: [], stages: []` so both branches return the same keys.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/ask-engine-v3.test.js test/ask-engine.test.js test/ask-pipeline.test.js`
Expected: PASS.

```bash
cat > /tmp/askrrm-p3-t3.msg <<'MSG'
feat(ask): the v3 pipeline behind feature:ask_pipeline_v3

Rewrite, retrieve at depth, rerank to eight, generate, cite or refuse from the
chunks we sent, fact check, resolve every citation live, then related. The flag
is true only on the exact value "on": a read error and an absent binding are
both off, because a flag that turns itself on when KV is unhappy is not a flag.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask/_engine.js test/ask-engine-v3.test.js
git commit -F /tmp/askrrm-p3-t3.msg
```

---

### Task 4: SSE stage events and the page

**Files:**
- Modify: `functions/api/ask.js`, `src/pages/ask.astro`
- Test: `test/ask-sse-stages.test.js`

**Interfaces:**
- Consumes: `answer({ ..., onStage })` from Task 3.
- Produces: on an SSE request, `/api/ask` emits `data: {"stage":"retrieving"}` lines before the final `data: <answer-json>` and `data: [DONE]`. `sseStream(handler, headers)` replaces the one-shot `sseResponse` for the answer path; `sseResponse` stays for error framing.

- [ ] **Step 1: Write the failing test**

Create `test/ask-sse-stages.test.js`:

```js
/**
 * SSE stage events. Without them the page shows a spinner for up to forty
 * seconds and the reader cannot tell a slow answer from a dead one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockWaitUntil } from './_helpers.js';
import { sqliteD1, insertUser, insertSession } from './_d1-sqlite.mjs';

const { onRequestPost } = await import('../functions/api/ask.js');

const FUTURE = Math.floor(Date.now() / 1000) + 86400;
const RAW_SESSION = 'sess-ask-sse-stages';
const USER_ID = 'u_ask_sse';

async function authDb() {
  const db = sqliteD1({ seed(s) { insertUser(s, { id: USER_ID, email: 'sse@example.com', role: 'mod', name: 'S' }); } });
  await insertSession(db._sqlite, { rawId: RAW_SESSION, userId: USER_ID, expiresAt: FUTURE });
  return db;
}

function quotaStub() {
  let n = 0;
  return { idFromName: (name) => ({ name }), get: () => ({ async fetch(_u, init) { const limit = JSON.parse(init.body).limit; n += 1; return new Response(JSON.stringify({ allowed: n <= limit, count: n, limit, remaining: Math.max(0, limit - n) }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } }) };
}

const CHUNK = { key: '/library/a.md', text: 'T', type: 'article', slug: 'a', url: 'https://rrmacademy.org/library/a/', title: 'A' };

function aiSearch() {
  return { async fetch(url) {
    const p = new URL(url).pathname;
    if (p === '/retrieve') return new Response(JSON.stringify({ chunks: [CHUNK], retrieval_ms: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (p === '/generate') return new Response(JSON.stringify({ answer: 'Prose.', usage: null, neurons: null, model: 'm' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (p === '/resolve') return new Response(JSON.stringify({ resolved: [{ url: CHUNK.url, status: 'published' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('{}', { status: 404 });
  } };
}

describe('SSE stage events', () => {
  it('emits one stage line per step before the answer and [DONE]', async () => {
    const db = await authDb();
    const env = {
      DB: db,
      COMMUNITY_KV: { async get(k) { return k === 'feature:ask_pipeline_v3' ? 'on' : null; }, async put() {}, async delete() {} },
      ANALYTICS_DB: { prepare: () => ({ bind: () => ({ async run() { return { success: true, meta: { last_row_id: 1 } }; } }) }) },
      ASK_QUOTA: quotaStub(),
      AI_SEARCH: aiSearch(), AI_SEARCH_WORKER_AUTH: 'tok',
      AI: { async run() { return { response: 'What does the library say about this topic exactly?' }; } },
      LIBRARY_WORKER_URL: 'https://lib.example', LIBRARY_AGENT_TOKEN: 'tok',
      fetchImpl: async () => new Response(JSON.stringify({ claims_found: 0, verified: 0, warnings: [], errors: [], passed: true, related: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    };
    const res = await onRequestPost({
      request: mockRequest('POST', { url: 'https://rrmacademy.org/api/ask', headers: { Cookie: `session=${RAW_SESSION}`, Accept: 'text/event-stream' }, body: { message: 'pcos progest' } }),
      env, waitUntil: mockWaitUntil(), data: {},
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Content-Type') || '', /text\/event-stream/);
    const text = await res.text();
    const payloads = text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
    const stages = payloads.filter((p) => p !== '[DONE]').map((p) => { try { return JSON.parse(p); } catch { return null; } }).filter((o) => o && o.stage).map((o) => o.stage);
    assert.deepEqual(stages, ['rewriting', 'retrieving', 'reranking', 'thinking', 'checking']);
    assert.equal(payloads[payloads.length - 1], '[DONE]');
    const final = JSON.parse(payloads[payloads.length - 2]);
    assert.equal(final.answer, 'Prose.');
    assert.equal(final.citations.length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ask-sse-stages.test.js`
Expected: FAIL. The response body carries only the one-shot payload.

- [ ] **Step 3: Implement the stream**

In `functions/api/ask.js`, add beside `sseResponse`:

```js
/**
 * A real SSE stream, so the page can show progress instead of a silent wait
 * that is indistinguishable from a hang. `run(emit)` is called with a function
 * that writes one `data:` line; it resolves with the final payload.
 *
 * sseResponse (the one-shot form) stays: an error has nothing to stream.
 */
function sseStream(run, headers = {}) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (obj) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

  (async () => {
    try {
      await writer.write(enc.encode('retry: 60000\n\n'));
      const payload = await run((stage) => { write({ stage }).catch(() => {}); });
      await write(payload);
    } catch {
      await write({ error: 'upstream_error' }).catch(() => {});
    } finally {
      await writer.write(enc.encode('data: [DONE]\n\n')).catch(() => {});
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
      'Access-Control-Allow-Credentials': 'true',
      ...headers,
    },
  });
}
```

In `handleAuthedAsk`, replace the single `const result = await engineAnswer(...)` plus the framing at the end with a branch:

```js
  if (wantsSSE) {
    return sseStream(async (emitStage) => {
      const result = await engineAnswer({ message, register: ASK_REGISTER, env, waitUntil, onStage: emitStage });
      if (result.errorCode) return { error: result.errorCode };
      archive(result);
      return buildPayload(result);
    }, rlHeaders);
  }
  const result = await engineAnswer({ message, register: ASK_REGISTER, env, waitUntil });
  if (result.errorCode) {
    await logAskQuery(env, waitUntil, request, message, user.id, start, result.httpStatus || 502, 'ask');
    return json({ error: result.errorCode }, result.httpStatus || 502, rlHeaders);
  }
  archive(result);
  return json(buildPayload(result), 200, rlHeaders);
```

Extract the archive block and the payload block from P2 Task 5 Step 4 into two local closures defined just above this branch, so both paths use one copy:

```js
  const buildPayload = (result) => ({
    answer: result.answer,
    citations: result.citations,
    grounded_in: result.grounded_in,
    unverified: result.unverified || [],
    related: result.related || [],
    ...(result.fallback ? { fallback: true } : {}),
    ...(threadId ? { thread_id: threadId } : {}),
    _meta: META,
  });

  const archive = (result) => { /* the exact waitUntil block from P2 Task 5 Step 4 */ };
```

- [ ] **Step 4: Teach the page the stages and the error map**

In `src/pages/ask.astro`, inside the IIFE, add above `runAsk`:

```js
      // Spec section 11. Every errorCode the pipeline can emit gets copy, so a
      // reader never sees a generic failure state for a specific, explicable
      // problem.
      var ERROR_COPY = {
        rate_limited: 'You have used your questions for today. Come back tomorrow, or browse the library.',
        quota_unavailable: 'AskRRM is briefly unavailable. Try again in a minute.',
        retrieval_error: 'We could not search the library just now. Try again in a minute.',
        generation_timeout: 'That took too long to answer. Try a shorter or more specific question.',
        generation_error: 'Something went wrong generating an answer. Try again.',
        prompt_too_long: 'That thread has gotten long, start a new question.',
        upstream_error: 'AskRRM is briefly unavailable. Try again in a minute.',
        service_unavailable: 'AskRRM is briefly unavailable. Try again in a minute.'
      };

      var STAGE_COPY = {
        rewriting: 'Reading your question',
        retrieving: 'Searching the library',
        reranking: 'Choosing the best sources',
        thinking: 'Writing the answer',
        checking: 'Checking the figures'
      };

      function setLoadingStage(loader, stage) {
        var body = loader.querySelector('.ask-msg__body');
        if (!body) return;
        var label = STAGE_COPY[stage];
        if (!label) return;
        body.innerHTML = '<span class="ask-stage">' + escapeHtml(label) + '</span> <span class="ask-dots"><span></span><span></span><span></span></span>';
      }
```

Change the `fetch('/api/ask', ...)` call to request SSE and read the stream:

```js
        fetch('/api/ask', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify({ message: message }),
        })
          .then(function (r) {
            if ((r.headers.get('content-type') || '').indexOf('text/event-stream') === -1) {
              return r.json().then(function (data) { return { status: r.status, data: data }; });
            }
            return readSse(r, function (stage) { setLoadingStage(loader, stage); })
              .then(function (data) { return { status: r.status, data: data }; });
          })
```

And add the reader beside `runAsk`:

```js
      // Reads the SSE body, calling onStage for every {stage} line and
      // resolving with the last non-stage payload. A browser with no
      // ReadableStream support falls back to reading the whole body as text,
      // which yields the same final payload with no progress.
      function readSse(response, onStage) {
        if (!response.body || !response.body.getReader) {
          return response.text().then(function (text) { return lastPayload(text); });
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        var last = null;
        function pump() {
          return reader.read().then(function (res) {
            buf += res.value ? decoder.decode(res.value, { stream: true }) : '';
            var lines = buf.split('\n');
            buf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              if (line.indexOf('data: ') !== 0) continue;
              var raw = line.slice(6);
              if (raw === '[DONE]') continue;
              var obj = null;
              try { obj = JSON.parse(raw); } catch (e) { continue; }
              if (obj && obj.stage) { onStage(obj.stage); continue; }
              last = obj;
            }
            if (res.done) return last;
            return pump();
          });
        }
        return pump();
      }

      function lastPayload(text) {
        var lines = text.split('\n').filter(function (l) { return l.indexOf('data: ') === 0; });
        for (var i = lines.length - 1; i >= 0; i--) {
          var raw = lines[i].slice(6);
          if (raw === '[DONE]') continue;
          try {
            var obj = JSON.parse(raw);
            if (!obj.stage) return obj;
          } catch (e) { /* keep looking */ }
        }
        return null;
      }
```

Replace the chain of `else if (d.error === ...)` branches with one lookup:

```js
            } else if (d.error === 'unauthorized' || res.status === 401) {
              // unchanged: this branch opens the auth modal
            } else if (d.error && ERROR_COPY[d.error]) {
              appendError(ERROR_COPY[d.error]);
            } else {
              appendError('Something went wrong. Please try again.');
            }
```

Add the stage style to the page's `<style>` block:

```css
  .ask-stage { color: var(--color-text-muted); font-size: var(--font-size-sm); }
```

- [ ] **Step 5: Run the gates**

```bash
node --test test/ask-sse-stages.test.js
npm run design-tokens:check
npm test
npm run quality:coverage
```
Expected: all PASS. If `--color-text-muted` is not in `docs/design/design-system.json`, pick the token that IS there rather than inventing one.

- [ ] **Step 6: Commit and deploy (Brian's go required)**

```bash
cat > /tmp/askrrm-p3-t4.msg <<'MSG'
feat(ask): SSE stage events and the full error map

The page showed one spinner for up to forty seconds, which is indistinguishable
from a hang. It now shows what the engine is doing, stage by stage, and every
errorCode the pipeline can emit has its own copy instead of a generic failure.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add functions/api/ask.js src/pages/ask.astro test/ask-sse-stages.test.js
git commit -F /tmp/askrrm-p3-t4.msg
git push origin main
```

- [ ] **Step 7: Run the golden set with the flag OFF, then flip it**

**HUMAN CHECKPOINT: Brian flips the flag, after the golden set is green.**

```bash
# Still on the P2 path: proves the deploy changed nothing for live users.
EVAL_TOKEN=$(op read 'op://Automation/RRM Ask Eval Worker Token/credential') \
  node scripts/ask-eval/run.mjs --eval --golden --tag "golden-$(date -u +%Y-%m-%d)-p3-off"

# Turn the pipeline on for the eval worker only is NOT possible: the flag is a
# single KV key shared with the page. So flip it, rerun, and be ready to flip
# back in one command.
npx wrangler@4.62.0 kv key put --binding COMMUNITY_KV feature:ask_pipeline_v3 on --remote
EVAL_TOKEN=$(op read 'op://Automation/RRM Ask Eval Worker Token/credential') \
  node scripts/ask-eval/run.mjs --eval --golden --tag "golden-$(date -u +%Y-%m-%d)-p3-on"
```
Expected: `GOLDEN PASS` on both. If the second run is not green:

```bash
npx wrangler@4.62.0 kv key delete --binding COMMUNITY_KV feature:ask_pipeline_v3 --remote
```
That single delete is the rollback, and it takes effect on the next request.

---

## Self-review

**Spec coverage.** Step 1 rewrite with the exact acceptance rule (1 to 500 characters, same script, no newline, `rewrite_fallback = 1` otherwise, never shown to the user, skipped for a question over 40 characters ending in `?`) is Task 2's `acceptRewrite` and `rewriteQuery`. Step 2 retrieve at `top_k` up to 20 with full chunk text and the unchanged `/search` shape is Task 1. Step 3 rerank with `bge-reranker-base` to the top 8 is Task 2's `rerankChunks`. Step 4 generate with the 12,000 cap is P2 Task 2 plus Task 3's call. Step 5 cite-or-refuse from the engine's own chunks is Task 3. Step 6 fact-check with the G10 failure mode is Task 2's `checkFacts`. Step 7 live resolve is Task 1's `/resolve` plus Task 2's `resolveCitations`. Step 8 related, up to 4, never blocking, is `relatedFor`. The pipeline time budget (4, 6, 4, 22, 4 sharing) and "archive always runs in waitUntil, exempt from the budget" are Task 2's `budget` plus Task 3's use of it; archiving stays in `waitUntil` in `ask.js`, untouched. SSE stage events are Task 4. `feature:ask_pipeline_v3` is Task 3. The section 11 error map is Task 4 Step 4. Section 14 step 3's "deploy behind the flag, flipped after the golden set passes" is Task 4 Step 7. G10 is Task 2's two failure tests plus Task 3's; G3 through step 7 is Task 3's resolve-empties-the-list test.

Deliberately elsewhere: `LIBRARY_AGENT_TOKEN` and `LIBRARY_WORKER_URL` are READ here but SET as secrets in P4, where the library-worker half of the work lives; the INDEX names that ordering, and Task 2's `libraryEnv` throws 503 rather than skipping if they are absent, so a missing secret is loud on the first request rather than silent for a wave.

**Placeholder scan.** One structural instruction rather than a paste, in Task 4 Step 3: `archive` is "the exact waitUntil block from P2 Task 5 Step 4". That is a move, not a fill-in, and naming the source is more reliable than a second copy that can drift from the first. Everything else is complete code.

**Type consistency.** `budget()` is constructed with `budget(TOTAL_BUDGET_MS)` and passed as the option key `budget` in every pipeline function; each destructures it as `budget: b` so the shadowing is explicit. `Citation` stays `{ url, title, type, slug }` from `/retrieve`'s chunk shape through `relatedFor`'s output and into the page. `checkFacts` returns `{ unverified, factCheckError, facts }` at its definition and is read with exactly those keys in `runPipeline`. `AnswerResult` gains `unverified`, `related` and `stages` in BOTH branches of `answer()`, so a caller never has to know which path ran.
