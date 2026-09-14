# AskRRM Engine: Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each plan task-by-task. Read this INDEX first, then the spec, then the one plan you are executing.

**Goal:** Fix and increase the power of the existing RRM Academy Ask AI, API-first, on a shoestring, without changing who it is for.

**Spec:** `docs/superpowers/specs/2026-09-14-askrrm-engine-design.md`

**Ledger (private, do not copy from):** `~/iCode/projects/rrm-knowledge-harness/ask-eval/2026-09-14-phase1-ledger.md`. 357 questions, 22 P0, 26 P1, 2 P2 confirmed. Its clinical answer text never travels into any repo; the golden set references its findings by question number only.

## Global Constraints

These are repeated verbatim at the head of every plan. Every task's requirements implicitly include them.

- Workers AI only at runtime, no paid API keys.
- Caps free 3 a day and member 20 a day unchanged.
- Wrangler pin `npx wrangler@4.62.0` for Pages; the pinned local wrangler for `rrm-ai-search`.
- Never edit `compatibility_date` by hand.
- Commit messages built in a file and passed with `-F`, never a long `-m`, ending with the two attribution lines `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH`.
- Every new file gets a census rule in `scripts/quality/lib/census-rules.mjs`.
- American English, no em dashes in any copy or code comment.
- Write-endpoint conformance: `validateBody`, the `json` helper, report rows via the vendored `report` package with blob1 = worker name and blob4 in `ok|error|slow|start|warn`.
- The pre-commit arise-scan hook stays on.

---

## 1. Order, and what each plan touches

Execute in order. Each plan ends with something live and provable; none of them is safe to start before its predecessor has deployed and its proof gates have passed.

| # | Plan | Repos touched | Ends when |
|---|---|---|---|
| P1 | `2026-09-14-askrrm-p1-fix-wave.md` | `rrm-academy-cf` | Golden set green against the eval worker, **zero safety-lens P0** |
| P2 | `2026-09-14-askrrm-p2-engine.md` | `rrm-ai-search` (first), then `rrm-academy-cf` | G1, G2, G3, G9, G13 pass live; free tier real; v1 deleted |
| P3 | `2026-09-14-askrrm-p3-pipeline.md` | `rrm-ai-search` (first), then `rrm-academy-cf` | Golden set green with `feature:ask_pipeline_v3` on; G10 passes |
| P4 | `2026-09-14-askrrm-p4-coverage.md` | `rrm-library-worker`, `rrm-ai-search`, `rrm-academy-cf` | G14 passes on the live namespace; G6 measured against the Phase 1 baseline |
| P5 | `2026-09-14-askrrm-p5-threads-feedback-trust.md` | `rrm-academy-cf` | G5, G11 pass; G7's write half proved |
| P6 | `2026-09-14-askrrm-p6-spend-and-ci.md` | `rrm-observatory`, `rrm-academy-cf`, `rrm-ai-search` | G4 watched failing then green; G7's digest half; G8, G12 |

**Why P2 orders `rrm-ai-search` first, and P3 and P4 too.** In each of those plans the Pages side CALLS something the Worker must already be serving: the `AskQuotaCounter` class and `/generate` in P2, `/retrieve` and `/resolve` in P3, the `guides/` bucket in P4. Land and deploy the Worker half, confirm its binding check, and only then start the Pages half. The reverse order puts a Pages deploy in production calling a route that answers 404.

**Two facts about P4 that determine when it can run.** It needs P3 shipped, because `/retrieve` is what surfaces a guide chunk in the first place; and its `rrm-library-worker` half is a change in a repo neither of the other two owns, so that task carries its own deploy and its own human checkpoint.

---

## 2. Deploy posture, per repo

Three repos, three completely different deploy mechanics. Getting this wrong is how a "deployed" change sits in a preview nobody reads.

### rrm-ai-search

```bash
cd ~/iCode/projects/rrm-ai-search
PHASE2_ID=$(op item get "Cloudflare API Token - Phase 2 (account-scoped, 90d)" --vault Automation --format json | jq -r .id)
export CLOUDFLARE_API_TOKEN=$(op item get "$PHASE2_ID" --vault Automation --fields credential --reveal)
GH_TOKEN=$(gh auth token -u rrmadmin) npm run deploy
```

`npm run deploy` runs the unit suite, deploys through the **locally pinned wrangler** in `devDependencies`, and then queries the Cloudflare bindings API to assert every required binding is live with the right type. **Never `wrangler deploy` by hand and never `npx wrangler@4.62.0` here:** 4.62 silently drops `[[ai_search_namespaces]]` as an unknown field, uploads the worker without `ASK_KB`, and reports success, after which `/ask` returns `retrieval_error`. That has already happened once. The **Phase 2 account-scoped** token is required; the default full-access token lacks AI Search Write and fails with error 10000. The 1Password title contains parentheses, so resolve it by id, never by `op read`. From P6 onward, `GH_TOKEN` also fires the golden-set dispatch; without it the deploy still succeeds and says what it could not do.

New bindings this programme adds to `scripts/deploy.mjs`'s `REQUIRED_BINDINGS`: `ASK_QUOTA` (`durable_object_namespace`, P2).

### rrm-academy-cf

Push to `main`. `.github/workflows/deploy.yml` builds and deploys to CF Pages. The push trigger is path-filtered and **`functions/**` is in the list**, so every plan's Pages changes trigger it. There is no manual Pages deploy in this programme.

```bash
git push origin main
gh run watch --exit-status
```

The data deploy-guard floors (`MIN_COUNTS`, `MAX_DROP`, `ABSOLUTE_FLOOR` in `deploy.yml`) are unaffected by anything here: no plan touches the five data sources.

### The eval worker

By hand, from its own directory, with the pinned Pages wrangler:

```bash
cd ~/iCode/projects/rrm-academy-cf/scripts/ask-eval/worker
npx wrangler@4.62.0 deploy
```

**It must be redeployed after any change to `functions/api/_ask_prompt.js` or `functions/api/ask/**`,** because it imports those files at build time. A golden-set run against a stale eval worker measures the previous prompt and reports green on a regression. P1 Task 6, P2 Task 6 and P3 all say this at the point it matters; it is repeated here because it is the single easiest thing in this programme to forget.

### rrm-library-worker and rrm-observatory

Each by its own repo's runbook. `rrm-observatory` deploys with `npx wrangler deploy` from its root, after `npm test`, `node tools/check-manifest-validates.mjs` and `node tools/check-spec-manifest-parity.mjs` are all green; the parity check HARD FAILS if a new daemon has no row in the fleet spec.

---

## 3. Human checkpoints

Nothing in this programme deploys itself. Every checkpoint below is Brian's, and an executing agent stops and asks.

| # | When | What Brian decides |
|---|---|---|
| H1 | P1 Task 6, before `git push origin main` | Deploy go for the prompt and `ask.js` fix wave |
| H2 | P2 Task 2 Step 7 | Deploy go for `rrm-ai-search`: the DO class plus `/generate` |
| H3 | P2 Task 6 Step 3 | Deploy go for the Pages half: thin `ask.js`, real free tier, v1 deleted |
| H4 | P3 Task 1 Step 6 | Deploy go for `rrm-ai-search`: `/retrieve` plus `/resolve` |
| H5 | P3 Task 4 Step 6 | Deploy go for the Pages half, with the pipeline flag still OFF |
| H6 | P3 Task 4 Step 7 | **The flag flip.** `feature:ask_pipeline_v3 = on`, only after the golden set is green with it on. One `kv key delete` is the rollback |
| H7 | **P4 Task 1, before any P4 code** | **The reconcile dry run.** Read the three counts and decide whether glossary is already indexed. No P4 code is written before this |
| H8 | P4 Task 2 Step 6 | Deploy go for `rrm-library-worker` |
| H9 | P4 Task 3 Step 4 | Deploy go for `rrm-ai-search`: the guides bucket |
| H10 | P5 Task 5 Step 3 | Deploy go for threads, feedback and the trust surface |
| H11 | P6 Task 2 Step 9 | Deploy go for `rrm-observatory` |
| H12 | P6 Task 3 Step 2 | Deploy go for the digest lines |
| H13 | P6 Task 5 Step 6 | Arm `ask-spend`: set `quarantineUntil: null` after the seven-day soak |

**The free-tier flip is H3, and it is not a flag.** There is no `feature:ask_free_v2` key. The free tier becomes real the moment the thin `ask.js` ships, because that commit deletes the branch that sent free users to the dead v1 path and leaves free and member differing only in their cap. The rollback is a revert, not a KV write, which is exactly why H3 is its own checkpoint and why G1 is proved on a live free account immediately after it.

---

## 4. Cross-plan interface table

Every route, secret, binding, column and function name that two or more plans share, with its exact shape. A plan's executor sees only their own plan; this table is how they learn what the neighbours produce and consume.

### 4.1 Routes

| Route | Repo | Produced by | Consumed by | Exact shape |
|---|---|---|---|---|
| `POST /generate` | rrm-ai-search | P2 T2 | P2 T4 (`workers-ai.js`), P3 T3 | req `{ system_prompt: string, chunks: [{ key, text }], turns?: [{ question, answer, citation_ids }], user_id?, day_key? }` → `200 { answer: string, usage: object\|null, neurons: number\|null, model: string }`. Serialized length over 12000 → `400 { error: 'prompt_too_long', length, max }`, before any model call. Bearer `AI_SEARCH_WORKER_AUTH` |
| `POST /retrieve` | rrm-ai-search | P3 T1 | P3 T3 | req `{ query: string 2..500, top_k?: 1..20 (default 12), filters?: object }` → `200 { chunks: [{ key, text, type, slug, score, url, title }], retrieval_ms: number }`. FULL chunk text. Bearer |
| `POST /resolve` | rrm-ai-search | P3 T1 | P3 T2 (`resolveCitations`) | req `{ urls: string[] 1..50 }` → `200 { resolved: [{ url, status: 'published'\|'retracted'\|'excluded'\|'not_found' }] }`. Bearer |
| `POST /ask` | rrm-ai-search | pre-existing | P2 T4 (the non-pipeline branch) | unchanged. Deleted from the engine's path once the pipeline flag is permanently on; until then both exist |
| `POST /search` | rrm-ai-search | pre-existing | the page's search box | **unchanged, deliberately.** Its 280-character snippet is right for a result list and is why `/retrieve` exists separately |
| `POST /ask` (eval worker) | rrm-academy-cf | pre-existing, rewritten P2 T6 | `run.mjs` | → `{ answer, citations, grounded_in, fallback, model, usage, neurons, register, backend, duration_ms, ask_answer_id, archive_error }`. `ask_answer_id` and `archive_error` are what G12 reads |
| `POST /judge` (eval worker) | rrm-academy-cf | P6 T4 | `judge-llm.mjs` `workersAiCaller` | req `{ system, user, temperature?, max_tokens? }` → `200 { response: string }`. Bearer `EVAL_TOKEN`. Combined prompt over 20000 → 400 |
| `POST /api/ask` | rrm-academy-cf | P2 T5, extended P3 T4 and P5 T2 | the page, `run.mjs` | req `{ message: string 2..500, thread_id?: string 3..64 }` → `200 { answer, citations, grounded_in, unverified, related, ask_answer_id?, thread_id?, fallback?, _meta }`. SSE by `Accept`. `RateLimit-*` on both |
| `GET /api/ask` | rrm-academy-cf | P2 T5, extended P5 T5 | clients | capability JSON with `version`, `registers`, `caps`, `routes`, `response.shape` |
| `POST /api/ask/feedback` | rrm-academy-cf | P5 T3 | the page | req `{ ask_answer_id: number, verdict: 'helpful'\|'not_helpful'\|'report', note?: string ≤500 }` → `200 { ok: true, verdict }`. Owner-gated; eval rows 403 |
| `GET /api/ask/thread/:id` | rrm-academy-cf | P5 T1 | resume | → `200 { thread_id, turns: Turn[], next_turn }`. Foreign or missing → 404, indistinguishably |
| `POST /check-facts` | rrm-library-worker | pre-existing | P3 T2 `checkFacts` | req `{ text: string ≤50000 }` → `{ claims_found, verified, warnings: [{ claim, context, severity, fact_id, correct, source, note }], errors: [...], passed }`. Bearer `LIBRARY_AGENT_TOKEN`, agent scope |
| `GET /related` | rrm-library-worker | pre-existing | P3 T2 `relatedFor` | `?type=&slug=&depth=&limit=&filter_type=` → `{ related: [{ type, slug, title, ... }] }`. Bearer, agent scope. 404 when the source is not found |
| `POST /index/batch` | rrm-library-worker | pre-existing, extended P4 T2 | the corpus refresh caller | body is an array of ≤50 `{ type, record }`. `type` gains `'guide'` in P4 |
| `POST /index/reconcile` | rrm-library-worker | pre-existing | P4 T1 and T4 | report-only, mutates nothing but one audit row |
| `repository_dispatch` `ask-golden-set` | GitHub | P6 T5 (sent by `rrm-ai-search/scripts/deploy.mjs`) | P6 T5 (`ask-golden-set.yml`) | `POST /repos/rrmadmin/rrm-academy-cf/dispatches`, `{ event_type: 'ask-golden-set', client_payload: { worker, at } }` |

### 4.2 Secrets and configuration

| Name | Where it lives | Set in | Read by | Notes |
|---|---|---|---|---|
| `AI_SEARCH_WORKER_AUTH` | rrm-ai-search secret + rrm-academy-cf Pages secret | pre-existing | every route in 4.1 marked Bearer | shared; unchanged by this programme |
| `EVAL_TOKEN` | eval worker secret | pre-existing | `run.mjs`, `judge-llm.mjs` | 1P `RRM Ask Eval Worker Token` |
| `LIBRARY_WORKER_URL` | Pages secret AND eval worker secret | **P4** (used from P3) | P3 T2 `libraryEnv` | the library worker's base URL |
| `LIBRARY_AGENT_TOKEN` | Pages secret AND eval worker secret | **P4** (used from P3) | P3 T2 `libraryEnv` | 1P `RRM Library Worker Agent Token`, agent scope. **Absent = 503 `service_unavailable`, never a silent skip** |
| `ASK_BACKEND_URL`, `ASK_BACKEND_TOKEN` | Pages secrets | not set by any plan | P2 T4 `_backends/index.js` | the OpenAI-compatible lane. Selected ONLY when the flag says so AND both are present |
| `ASK_EVAL_TOKEN` | GitHub Actions secret on `rrmadmin/rrm-academy-cf` | P6 T5 | `ask-golden-set.yml` | same value as `EVAL_TOKEN`. Absent = the job FAILS |
| `GH_TOKEN` | environment, at deploy time | P6 T5 | `rrm-ai-search/scripts/deploy.mjs` | `gh auth token -u rrmadmin`. Absent = dispatch skipped, deploy still succeeds |
| `NLWEB_SEARCH_URL` | Pages secret | **DELETED in P2 T5** | nothing | the v1 path is gone |

**Order note on `LIBRARY_*`:** P3 writes the code that reads them and P4 is where the corpus work makes them matter, so they can be set at either point. Set them at H5, before the P3 Pages deploy, or the first fact-check attempt answers 503. `libraryEnv` throws rather than skipping precisely so that a missing secret is loud on the first request rather than silent for a whole wave.

### 4.3 Bindings

| Binding | On | Added by | Shape |
|---|---|---|---|
| `ASK_QUOTA` | rrm-ai-search (hosts the class) | P2 T1 | `[[durable_objects.bindings]] name = "ASK_QUOTA", class_name = "AskQuotaCounter"` + `[[migrations]] tag = "v1", new_sqlite_classes = ["AskQuotaCounter"]` |
| `ASK_QUOTA` | rrm-academy-cf Pages | P2 T5 | same, **plus `script_name = "rrm-ai-search"`**. Pages binds the class hosted in the Worker rather than hosting its own |
| `ANALYTICS_DB` | rrm-academy-cf Pages | pre-existing | D1 `rrm-analytics`, id `8967f69e-1213-411f-a4a9-5586889ad401` |
| `ANALYTICS_DB` | rrm-observatory | P6 T2 | same database, same id, read-only by convention and asserted by a SQL grep in the daemon's own test |
| `AI` | eval worker | P6 T4 | `[ai] binding = "AI"`, for the `/judge` route |
| `AUTH_DB`, `LIBRARY_DB`, `ASK_KB`, `AI`, `EVENTS` | rrm-ai-search | pre-existing | unchanged |

### 4.4 Feature flags (KV `COMMUNITY_KV` on rrm-academy-cf)

| Key | Values | Default when absent or unreadable | Read by |
|---|---|---|---|
| `feature:ask_backend` | `workers-ai` \| `openai-compatible` | `workers-ai` | P2 T4 `selectBackend` |
| `feature:ask_pipeline_v3` | `on` (exact) \| anything else | off | P3 T3 `pipelineEnabled` |
| `feature:search_v2` | pre-existing | unchanged | no longer read by `ask.js` after P2 T5 |

Both new flags **fail closed to the safe value on a KV read error**. A flag that turns itself on when KV is unhappy is not a flag.

### 4.5 Database columns

One migration, `scripts/migrations/2026-09-14-askrrm-engine.sql`, applied in **P2 T3**. Every later plan fills columns that already exist.

| Table.column | Type | Written by | Read by |
|---|---|---|---|
| `ask_answer.register` | TEXT | P2 T5, P2 T6 | the review |
| `ask_answer.thread_id` | TEXT | P2 T5 (stored), P5 T2 (meaningful) | P5 T1 `loadThread` |
| `ask_answer.turn` | INTEGER | P2 T5 (always 1), P5 T2 (`thread.nextTurn`) | P5 T1 `loadThread` |
| `ask_answer.cost_neurons` | INTEGER | P2 T5 | P6 T1, P6 T2 `ask-spend` |
| `ask_answer.rewritten_query` | TEXT | P3 T3 | the review |
| `ask_answer.fact_check_error` | INTEGER DEFAULT 0 | P3 T3 | the review, G10 |
| `ask_answer.rewrite_fallback` | INTEGER DEFAULT 0 | P3 T3 | the review |
| `ask_thread` (`id`, `user_id`, `created_at`, `last_turn_at`) | table | P5 T1 `createThread`, `touchThread` | P5 T1 `loadThread` |
| `ask_feedback` (`id`, `ask_answer_id`, `user_id`, `verdict`, `note`, `created_at`) | table, `UNIQUE(user_id, ask_answer_id)` | P5 T3 | P6 T3 digest |
| `retrieval_docs.source_type = 'guide'` | rows | P4 T2 | P4 T4 |

**`ask_answer.created_at` is written by `datetime('now')`, so it is `'YYYY-MM-DD HH:MM:SS'` and NOT ISO with a `T`.** Any month or day window predicate must compare in that format. A T-separated predicate matches nothing and reports a zero month forever, which is stated again in P6 T2 and asserted by that daemon's own test.

### 4.6 Function names shared across plans

| Symbol | Module | Signature | Produced | Consumed |
|---|---|---|---|---|
| `answer` | `functions/api/ask/_engine.js` | `({ message, thread, register, backend, env, waitUntil, onStage }) -> Promise<AnswerResult>`. Never throws | P2 T4 | P2 T5, P2 T6, P3 T3, P5 T2 |
| `AnswerResult` | same | `{ answer, citations, fallback, model, usage, neurons, register, backend, rewritten_query, rewrite_fallback, fact_check_error, unverified, related, grounded_in, stages, duration_ms }` plus `{ errorCode, httpStatus }` on failure | P2 T4, extended P3 T3 | everywhere |
| `Citation` | same | `{ url: string, title: string, type: 'article'\|'commentary'\|'faq'\|'glossary'\|'guide'\|'fact', slug: string\|null }` | P2 T4 `toCitation` | P3, P5 T4 page renderer |
| `enforceCiteOrRefuse` | `_engine.js` (P1: `ask.js`) | `(answer, citations) -> { answer, citations, fallback }` | P1 T5, **moved** P2 T4 | P3 T3 |
| `FALLBACK_ANSWER` / `REFUSAL_TEXT` | `_engine.js` / `judge-rules.mjs` | the same string, byte for byte, also inside prompt rule 8 | P1 T1, P1 T4, P2 T4 | `test/ask-prompt-rules.test.js` asserts all three agree |
| `ESCALATION_LINE` | `judge-rules.mjs` | the same string, also inside prompt rule 9 | P1 T1, P1 T4 | same test |
| `judgeRules` | `scripts/ask-eval/judge-rules.mjs` | `({ answer, citations, fallback, expectations }) -> { pass, findings: Finding[] }`, `Finding = { id, pass, severity, lens, detail }` | P1 T1 | P1 T3 runner, P6 T5 CI |
| `judgeAnswer` | `scripts/ask-eval/judge-llm.mjs` | `({ question, answer, citations, expectations, callModel, votes }) -> { p0, p1, votesByLens }`, findings `{ lens, severity, reason }` | P6 T4 | P6 T4 runner |
| `loadGoldenSet` | `scripts/ask-eval/golden/load.mjs` | `(bankPath, goldenPath) -> { version, questions }`; **throws** on an id the bank does not carry | P1 T2 | P1 T3, P6 T5 |
| `selectBackend` | `functions/api/ask/_backends/index.js` | `(env) -> Promise<{ name, generate }>`, fails closed to `workers-ai` | P2 T4 | P3 T3 |
| `generate` | `_backends/workers-ai.js`, `_backends/openai-compatible.js` | `({ systemPrompt, chunks, turns, env }) -> { answer, usage, neurons, model }`, or throws with `{ httpStatus, errorCode }` | P2 T4 | P3 T3 |
| `budget` | `functions/api/ask/_pipeline.js` | `(totalMs) -> { left, spend, allow, elapsed }` | P3 T2 | P3 T3 |
| `boundTurns` | `functions/api/ask/_thread.js` | `(turns) -> Turn[]`, `Turn = { question ≤400, answer ≤900, citation_ids }`, ≤3 turns, ≤4000 chars total | P5 T1 | P5 T2 (`ask.js` AND defensively in the engine) |
| `loadThread` / `createThread` / `touchThread` | same | `(env, threadId, userId) -> { id, turns, nextTurn } \| null` / `(env, userId) -> string` / `(env, threadId) -> void` | P5 T1 | P5 T2, P5 T1 route |
| `quotaShardName` | `rrm-ai-search/src/quota.js` AND `functions/api/ask.js` | `(userId, utcDay) -> \`${userId}:${utcDay}\`` | P2 T1, P2 T5 | **two deliberate one-line copies**: Pages cannot import across the repo boundary. The DO test pins the format, so a drift is a failing test rather than a silently doubled cap |
| `bucketFromKey` / `itemUrl` / `resolveItems` / `itemExists` | `rrm-ai-search/src/index.js` | pre-existing; gain a `guides` bucket | P4 T3 | P3 T1 `/retrieve` and `/resolve` |
| `buildDoc` | `rrm-library-worker/src/indexer/build-doc.js` | `(type, record) -> { key, fullSlug, sourceType, in_vectorize, in_autorag, autorag }`; gains `type === 'guide'`, prefix `/guides/` | P4 T2 | P4 T4 |

### 4.7 Error codes, one vocabulary

Emitted by the engine, framed by `ask.js`, rendered by the page's `ERROR_COPY` map (P3 T4). A code added anywhere must be added to the map in the same change, or the reader gets the generic failure state for a specific, explicable problem.

`rate_limited` · `quota_unavailable` · `retrieval_error` · `generation_timeout` · `generation_error` · `prompt_too_long` · `upstream_error` · `service_unavailable` · `invalid_input` · `unauthorized` · `forbidden` · `not_found`

---

## 5. Proof gates, and the plan that closes each

| Gate | Closed by | How |
|---|---|---|
| G1 free account: three 200s with citations, then 429 with `RateLimit-Remaining: 0`, no 504 | P2 T5, proved P2 T6 S5 | unit test plus a live free session |
| G2 two concurrent requests at 19 produce exactly one 200 | P2 T1, proved P2 T6 S4 | DO unit test plus a live concurrent probe |
| G3 zero-citation prose never reaches the client | P1 T5, moved P2 T4, extended P3 T3 | `enforceCiteOrRefuse` unit tests plus a planted nonsense query |
| G4 golden set green; an em dash or a dropped rule 3 turns CI red | P1 T1 + P1 T4 (the checks), P6 T5 (the job) | **two watched failures on a throwaway branch**, then green |
| G5 a follow-up answers correctly with `thread_id` and refuses without | P5 T5 S3 | live probe, read by eye |
| G6 fallback rate drops from the Phase 1 baseline on the same run tag | P4 T5 | `fallback-rate.mjs`, reading fallback AND zero-citation together |
| G7 a report click appears in the next weekly digest | P5 T5 S3 (write), P6 T3 (digest) | live click then a digest read |
| G8 the spend daemon warns past a fixture month of 8 USD | P6 T2 | unit test. Production rows are never seeded with fake spend |
| G9 a stub OpenAI-compatible server answers; an unreadable flag falls back | P2 T4 | four `selectBackend` tests |
| G10 an unverifiable figure is marked `unverified`; a failed check marks every claim and sets `fact_check_error` | P3 T2, P3 T3 | four `checkFacts` tests plus an engine test |
| G11 three full-length turns never exceed the prompt cap | P5 T1 | **unit test on the truncation function**, not only an integration probe |
| G12 the golden run asserts `archive_error IS NULL` on every row | P1 T6 S6 (by hand), P6 T4 S5 (in the runner) | the runner exits non-zero |
| G13 an unreachable quota DO is a 503, never a pass-through 200 | P2 T5 | two tests: a throwing stub and an absent binding |
| G14 a guide chunk resolves to a real title and URL and cites as `type: "guide"` | P4 T3 (unit), P4 T4 S3 (live) | `chunksToCitations` test plus a live `/retrieve` probe |

---

## 6. What is deliberately NOT in any plan

Out of scope per spec section 16, and named here so nobody adds them on the way past: clinician verification and the clinical register, composite tools on the page, connector OAuth on `rrm-mcp`, the mobile shell, ads, CME, EHR, any private-corpus access, provider-directory answers, and the ask page's visual redesign.

Also deliberately absent: `scripts/ai-search-corpus-upload.mjs` stays retired and no plan resurrects it; the bearer-token variant of session auth is designed for and not built; and no plan seeds fake rows into `ask_answer`, because that table is the archive the whole review depends on.

---

## 7. Spec requirements with no task, for Brian

Two, both small, both named where they occur:

1. **Section 13 says "`rrm-ai-search`'s deploy workflow sends a `repository_dispatch`".** That repo has no `.github` directory and no CI: it deploys by hand through `npm run deploy`. P6 T5 puts the dispatch in `scripts/deploy.mjs` at the moment the binding verification succeeds, which is the same moment in the same process. If the repo gains a deploy workflow later, the call moves up into it unchanged.

2. **Section 13 says "the 12 start-here questions".** The `/ask` page's empty state carries NINE starter questions (three categories of three), and `run.mjs`'s documented default run is `--limit 12`, the first twelve of the bank. P1 T2 takes the second reading and seeds the golden set with `q001` to `q012`. If Brian meant the page's nine plus three others, the manifest is three lines to change and `load.mjs` will refuse any id the bank does not carry, so the mistake cannot go quiet.
