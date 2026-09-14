# AskRRM engine design

Date: 2026-09-14. Author: Claude, with Brian's decisions recorded inline. Status: draft for Brian's review.

## 1. What this is

AskRRM is the RRM Academy conversational research layer, today served at `/ask` by `functions/api/ask.js` over the `rrm-ai-search` Worker. This spec fixes it and makes it more capable without changing who it is for. The audience this round is the existing one: registered accounts and STUC members, in the patient register. Verified clinicians, composite tools, connector OAuth and a mobile shell are named as later waves in section 12 and are out of scope here.

Brian's framing (2026-09-14): "I primarily want to fix and increase the power of the existing RRM Ask AI." Usage was kept low on purpose because the surface is free and the budget is a shoestring. It is also the seed of a future mobile app, AskRRM, so the work is API-first.

## 2. Verified state on 2026-09-14

- Two model paths. The v2 path (`AI_SEARCH` service binding, Llama 3.3 70B fp8 fast over the `rrm-academy-search` AI Search namespace, `SEARCH_TOP_K = 12`) serves STUC members and staff at 20 a day. The v1 path (NLWeb proxy) serves free accounts at 3 a day and has returned 504 `upstream_timeout` on every attempt since 2026-04-28. The free tier is dead.
- 32 v2 answers served in total before the archive existed. Since PR #138 every 200 writes an `ask_answer` row in D1 `rrm-analytics` (schema in `scripts/migrations/2026-09-01-ask-answer.sql`).
- The eval worker `zz-ask-eval-delete-me` was deleted 2026-09-09 as a zero-traffic surface before the review ran. Rebuilt in git at `scripts/ask-eval/worker/` and redeployed 2026-09-14. Phase 1 of the adversarial review (`docs/plans/2026-09-01-rrm-ai-adversarial-review.md`) is running against it as this spec is written.
- No feedback control, no eval gate, no thread state, no cost line. Caps: 500 char message, 1024 output tokens, per-user UTC day key in KV (non-atomic increment).
- Real traffic shape (65 submissions, 50 unique): 62% carry no question mark, typos are structural, 4 exchanges were follow-ups that make no sense alone, 18 bounced off the 401 wall and were resent.
- Corpus in the namespace: articles, FAQs, posts, pillars. Glossary terms and guides are not carried by the live refresh path (`rrm-library-worker` `/index/batch`) as of this writing; run its `--reconcile` dry run before shipping section 8 to confirm whether glossary is already partially present via `bucketFromKey`'s existing glossary route. Textbook chapters, transcripts and every excluded type stay out (agent-scope 403, EXCLUDED_TYPES).
- Users: 4,047 `member` role rows, 2 admin, 2 superadmin, 1 mod. The `user` table has no profession, NPI or country column.

## 3. Decisions recorded

| Decision | Brian's answer (2026-09-14) |
|---|---|
| What "more power" means | Answer quality, capability, coverage and trust surface, all four |
| Budget | Under $10 a month all in, because it is not advertised yet; asked whether a local Mac Studio could serve answers |
| Free tier | Make it real on V2 at 3 a day; delete the v1 path |
| Clinicians | NPI-verified clinician mode is a later wave; IIRRM-verified clinicians are wanted as a partnership |
| Mobile | API-first, no app code this round |
| Follow-ups | Short thread, last 3 turns carried, retrieval rerun each turn |
| Model policy | Workers AI only at runtime, no paid API keys (standing rule from 2026-09-07) |

On the Mac Studio: technically viable (Qwen 3 32B under Ollama or MLX behind a Cloudflare Tunnel) and not needed for cost. A typical answer is about 1,500 input and 400 output tokens, around a tenth of a cent on Workers AI, so ten dollars is roughly 7,000 answers a month against 32 served ever. The engine gets a pluggable backend so a local or rented GPU is a config change later; production never depends on a Mac being awake.

## 4. Architecture

```
/ask page  ──►  POST /api/ask  ──►  functions/api/ask/_engine.js  ──►  rrm-ai-search (/retrieve, /generate, /resolve)
  (Astro)         (thin: auth,        rewrite → retrieve → rerank →        Workers AI: llama 3.3 70B
                   tier, cap,          generate → cite-or-refuse →          bge reranker, bge embeddings
                   thread, SSE)        fact-check → archive → related       ASK_QUOTA Durable Object (day counter)
                                              │
                                              ├─► D1 rrm-analytics: ask_answer (+ register, thread_id, turn, cost_neurons, rewritten_query, fact_check_error, rewrite_fallback)
                                              ├─► D1 rrm-analytics: ask_thread, ask_feedback (new)
                                              ├─► rrm-library-worker /check-facts, /related (LIBRARY_AGENT_TOKEN bearer)
                                              └─► Analytics Engine: worker-events rows via the report package
eval worker (scripts/ask-eval/worker) ──► same _engine.js, no user, no cap, source = eval
```

Everything the page can do is a JSON endpoint under `/api/ask/*` with session cookie auth today and a bearer option reserved (section 10). A native client later calls the same routes. The Durable Object class (`AskQuotaCounter`) and the new `/retrieve` and `/resolve` routes live in `rrm-ai-search`, the only Worker in scope this round, Pages has no D1 write path of its own for quota or citation state.

## 5. Engine module

`functions/api/ask/_engine.js` exports one function, `answer({ message, thread, register, backend, env, waitUntil })`, and owns the whole pipeline. `ask.js` shrinks to auth, tier, cap, thread lookup and response framing. The eval worker imports the same module, which is what makes the eval numbers mean something.

Backends live in `functions/api/ask/_backends/`:

- `workers-ai.js` (default): calls a new `rrm-ai-search` route `POST /generate` (see 5a) that takes the prompt and the reranked chunks the engine already chose and returns prose and usage only. The engine, not the backend, builds citations from the chunks it sent (see the cite-or-refuse step below), this is what lets any backend, including the OpenAI-compatible one, satisfy cite-or-refuse the same way. The existing `/ask` route (retrieve and generate in one call) stays until the pipeline flag flips, then is removed.
- `openai-compatible.js`: POSTs a chat completion to `ASK_BACKEND_URL` with `ASK_BACKEND_TOKEN`, with the same prompt and chunks, returning prose and usage in the same shape. Retrieval, reranking and citation-building stay on Cloudflare for both backends; only generation moves. This is the Mac Studio, Hetzner or any hosted model lane. Selected by the KV flag `feature:ask_backend`, default `workers-ai`, fail-closed to the default on any misread.

The v1 NLWeb branch and its `NLWEB_SEARCH_URL` binding are deleted.

### Pipeline steps

1. **Rewrite.** One cheap Workers AI call (`@cf/meta/llama-3.1-8b-instruct`) turns fragments, typos and mid-sentence input into one full question in the same language, with the thread's last 3 turns as context (bound, see section 9). The original and the rewrite are both archived. Skipped when the input already ends in a question mark and is over 40 characters. **Fallback rule:** the rewrite is accepted only if it is 1 to 500 characters, in the same script as the input, and contains no newline; otherwise the engine uses the original message and sets `rewrite_fallback = 1` on the archived row. The rewrite is never shown to the user, only the original or the model's answer.
2. **Retrieve.** `rrm-ai-search` `POST /retrieve` (bearer, see 5a) with `top_k` up to 20 on the rewritten question, returning full chunk text plus key, type, slug and score, not the 280-character snippet `/search` returns. The public `/search` shape is unchanged and stays for the page's own search box.
3. **Rerank.** `@cf/baai/bge-reranker-base` scores the retrieved chunks against the rewritten question; the top 8 become context. Reranker cost is neurons, inside the budget.
4. **Generate.** The register prompt plus the 8 chunks plus the last 3 bounded turns go to the backend via `POST /generate` (see 5a). `max_tokens` stays 1024. Total prompt length is capped at 12,000 characters, enforced server-side in `/generate`; a request over the cap gets a 400 `prompt_too_long` before any model call.
5. **Cite-or-refuse.** The engine builds citations from the reranked chunks it sent to generation, `{ url, title, type, slug }` per chunk actually used, deduped by key (the shape `/search` already fills in via `resolveItems`/`itemUrl`/`bucketFromKey`; the engine reuses those helpers through the same D1-backed lookups, not a hand-rolled title guess). An answer that carries no citation is replaced by the refusal text and archived with `fallback = 1`. Prose without a source is never served, on any backend.
6. **Fact-check.** Sentences containing a number with a unit or percent are sent to `/check-facts` on the library worker over `LIBRARY_AGENT_TOKEN` (see the library worker note under 5a). A match attaches the fact as a citation. A miss marks the sentence `unverified` in the citations JSON. **Failure mode:** any non-2xx response or a timeout marks every extracted numeric claim `unverified` (never silently trusted) and sets `fact_check_error = 1` on the archived row. This is a check, not a rewrite.
7. **Citations resolve live.** Each citation URL, including ones added by fact-check or carried in from the thread, is checked via `rrm-ai-search` `POST /resolve` (bearer; new route, backed by the same `LIBRARY_DB`/`AUTH_DB` bindings the Worker already holds) against published/retracted/excluded state. `/generate` already runs `resolveItems` for the primary reranked set as part of step 5, so `/resolve` exists specifically for citations that step 5 didn't already vouch for. A dead citation is dropped, and if that empties the list, step 5's refusal applies.
8. **Related.** `/related` on the library worker, over the same `LIBRARY_AGENT_TOKEN` bearer as step 6, returns up to 4 guides or records for the top citation (type and slug from the citation object), no model call. A non-2xx answer leaves the related list empty and is logged; it never blocks the answer.
9. **Archive.** One `ask_answer` row with the new columns (migration in 9a); one `worker-events` row. Archiving always runs in `waitUntil` regardless of the pipeline time budget (see below) so a slow request still leaves a record.

**Pipeline time budget.** Total wall time is capped at 40 seconds: rewrite 4s, retrieve 6s, rerank 4s, generate 22s, and fact-check + resolve + related share the remaining 4s. Any step that can't fit in what's left of that shared 4s is skipped and marked on the row (`fact_check_error`, an empty related list) rather than blowing the total budget, the answer still ships. Archive always runs in `waitUntil` and is exempt from the budget. The SSE response emits a `stage` event at the start of each step so the page can show progress (retrieving, thinking, checking facts) instead of a silent wait until the full answer lands.

### 5a. rrm-ai-search routes

Three routes, all bearer-guarded with `AI_SEARCH_WORKER_AUTH` (or, for `/generate`'s quota check, the caller's own session identity passed through), all in `rrm-ai-search/src/index.js`. `/search` is unchanged and stays public-shaped for the page's own search box; it is not reused for the engine's retrieval because its 280-character snippet truncation loses the text the model needs to answer from.

| Route | Method | Auth | Request | Response |
|---|---|---|---|---|
| `POST /retrieve` | POST | bearer | `{ query, top_k? (<=20), filters? }` | `{ chunks: [{ key, text, type, slug, score }], retrieval_ms }`, full chunk text, not a snippet |
| `POST /generate` | POST | bearer | `{ system_prompt, chunks: [{ key, text }], turns?: [{ question, answer, citation_ids }], user_id, day_key }` (total serialized prompt over 12,000 chars → 400 `prompt_too_long`) | `{ answer, usage, neurons, model }`, no citations; the caller (the engine) builds those from the chunks it sent |
| `POST /resolve` | POST | bearer | `{ urls: string[] }` | `{ resolved: [{ url, status: "published" \| "retracted" \| "excluded" \| "not_found" }] }`, backed by `LIBRARY_DB` + `AUTH_DB`, the same D1 bindings the Worker already holds |

**Library worker calls (steps 6 and 8).** `check-facts` and `related` on `rrm-library-worker` require agent scope. Two new secrets are added to the Pages project and to the eval worker: `LIBRARY_WORKER_URL` (the worker's base URL) and `LIBRARY_AGENT_TOKEN` (1Password Automation item "RRM Library Worker Agent Token", agent scope). Both callers read them from `env`; a missing secret answers 503 `service_unavailable` from the engine, never a silent skip. The eval worker's `wrangler.toml` gains no binding for this, only the two secrets, set with `wrangler secret put` at deploy.

The quota check (section 7a) happens in Pages before any of these routes are called, `functions/api/ask.js` holds its own `ASK_QUOTA` Durable Object binding pointed at the `rrm-ai-search` Worker, so a request over quota never reaches retrieval or generation at all.

## 6. Registers and prompts

One register this round, `patient`, which is the existing `SYSTEM_PROMPT` in `functions/api/_ask_prompt.js` with fixes from the Phase 1 ledger. The prompt file gains a `register` export and the engine takes the register name, so the clinical prompt in wave two is a second file, not a code change. The prompt hash is archived per answer as today.

Editorial rules 1 to 7 stay. Two additions after the review: the answer must name what it is grounded in when the retrieval was thin (fewer than 3 chunks above the rerank threshold), and a follow-up that cannot be answered from the thread's citations must say so instead of re-retrieving silently.

## 7. Tiers, caps and cost

| Tier | Who | Cap | Path |
|---|---|---|---|
| Free | registered, email verified | 3 a day | v2 engine |
| Member | STUC member or staff | 20 a day | v2 engine |
| Eval | eval worker bearer | none | v2 engine, source `eval` |

Caps are deliberately unchanged. The day key moves from KV read-increment to a Durable Object counter, which closes the race the review plan names (two concurrent requests at 19 both pass today).

Cost: every `ask_answer` row records `cost_neurons` from the backend's usage. A new observatory daemon `ask-spend` sums the month and warns at a projected $8, fails at $10. That is the budget guard, and the number is Brian's to raise.

### 7a. Quota counter

The Durable Object class `AskQuotaCounter` lives in the `rrm-ai-search` Worker (the only Worker in scope this round). Binding name `ASK_QUOTA`.

- **Sharding key:** `idFromName(`${userId}:${utcDay}`)`, one shard per user per UTC day, so the counter never contends across users or across days.
- **Behavior:** an atomic increment-and-check inside the DO's single-threaded storage, replacing the non-atomic KV read-increment. Matches the fail posture of `checkRateLimit` in `functions/api/auth/_shared.js`: **fail closed**. If the DO call itself errors (network, eviction, timeout), the request gets a 503 `quota_unavailable` rather than a silent pass-through, the review is explicit that a broken counter must never look like "no problem, proceed."
- **Wiring:** `functions/api/ask.js` (Pages) declares `[[durable_objects.bindings]]` with `name = "ASK_QUOTA"` and `script_name = "rrm-ai-search"` in its `wrangler.toml`, so Pages talks to the DO hosted in the Worker rather than hosting its own class. `rrm-ai-search`'s own `wrangler.toml` gains `[[migrations]]` with `new_sqlite_classes = ["AskQuotaCounter"]` to register the class.
- **Reset:** the shard's data is scoped to one UTC day by construction (a new day is a new `idFromName` key), so there is no explicit reset job, yesterday's shards simply stop being addressed and age out under Durable Object storage's normal lifecycle.

## 8. Coverage

`scripts/ai-search-corpus-upload.mjs` stays retired, it is not the live refresh path and this spec does not resurrect it. The live owner of corpus refresh is `rrm-library-worker` `POST /index/batch`; glossary and guide handling is added there, not in a standalone script. Two changes land together:

- `rrm-library-worker` gains a `guides/` prefix in its indexing pass (pillar companions and the neofertility guide pages), with a publish predicate so an unpublished or draft guide never enters the namespace.
- `rrm-ai-search`'s `bucketFromKey`, `itemUrl` and `resolveItems` (`src/index.js`) gain a `guides/` bucket matching the existing `library|commentary|faqs|glossary` pattern, so retrieved guide chunks resolve to a real title and URL instead of being silently dropped by the `itemExists` gate the way an unrecognized bucket is today.
- Glossary is already partially reachable via the existing `glossary` bucket in `bucketFromKey`; run `rrm-library-worker /index/batch --reconcile` (dry run) before this ships to learn what, if anything, is actually indexed today, per the section 2 correction above.

Attributes carry `type` so retrieval can filter. Fallback rate becomes a tracked metric in the digest with a target under 10% on the golden set.

## 9. Threads

Table `ask_thread` in `rrm-analytics`: `id`, `user_id`, `created_at`, `last_turn_at`. `ask_answer` gains `thread_id` and `turn`. Both land in the single migration described in section 9a, at sequencing step 2, `thread_id` is accepted on the request and stored from that step on, but is not actually read back into the prompt until step 5 (section 14), so the column exists well before the feature is wired up.

`POST /api/ask` accepts an optional `thread_id`; a missing or foreign id starts a new thread. The engine sends the last 3 turns (question and answer text, citations by id) with the new question, size-bounded so a long thread can't blow the generation prompt budget: each carried turn is truncated to 400 characters of question and 900 characters of answer, citations carried by id only (never re-serialized text), and the total carried thread text is capped at 4,000 characters across all 3 turns. This bound composes with the 12,000-character total prompt cap on `/generate` (section 5a), thread carry is one part of that budget, not on top of it. Threads expire from the page after 24 hours; rows are kept for the review.

### 9a. Migration

One migration, in `scripts/migrations/`, adds every new column and table this spec needs to `rrm-analytics` in a single pass, so later sequencing steps (14) only have to fill columns that already exist rather than layering migrations per step:

```sql
ALTER TABLE ask_answer ADD COLUMN register TEXT;
ALTER TABLE ask_answer ADD COLUMN thread_id TEXT;
ALTER TABLE ask_answer ADD COLUMN turn INTEGER;
ALTER TABLE ask_answer ADD COLUMN cost_neurons INTEGER;
ALTER TABLE ask_answer ADD COLUMN rewritten_query TEXT;
ALTER TABLE ask_answer ADD COLUMN fact_check_error INTEGER DEFAULT 0;
ALTER TABLE ask_answer ADD COLUMN rewrite_fallback INTEGER DEFAULT 0;

CREATE TABLE ask_thread (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_turn_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ask_thread_user ON ask_thread(user_id);

CREATE TABLE ask_feedback (
  id TEXT PRIMARY KEY,
  ask_answer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('helpful','not_helpful','report')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, ask_answer_id)
);
```

The `UNIQUE(user_id, ask_answer_id)` constraint is what makes the feedback upsert in section 10 idempotent, one verdict per user per answer, `ON CONFLICT` replaces rather than duplicates.

## 10. API surface (API-first)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ask` | POST | session | answer; body `{ message, thread_id? }`; JSON or SSE by Accept |
| `/api/ask/feedback` | POST | session, owner | `{ ask_answer_id, verdict: helpful|not_helpful|report, note? }` |
| `/api/ask/thread/:id` | GET | session, owner | turns for resume |
| `/api/ask/saved` | existing | session | unchanged |
| `/api/ask/sandbox` | existing | none | canned response for client integration |
| `/api/ask` | GET | none | capability JSON, gains `version`, `registers`, `caps` |

Every response carries `RateLimit-Limit` and `RateLimit-Remaining` on JSON and SSE alike. A bearer-token variant of session auth is reserved for the app wave and not built now; the routes are designed so adding it touches `_shared.js` only.

**Feedback ownership.** `/api/ask/feedback` checks `ask_answer.user_id = session.user.id` before accepting a verdict; eval-worker rows have no owning user and are refused with 403. `note` is capped at 500 characters. A repeat submission for the same `(user_id, ask_answer_id)` pair upserts via the `UNIQUE` constraint in section 9a rather than inserting a duplicate, one verdict per person per answer, latest wins.

## 11. Trust surface on the page

- Citations render as title, type badge (article, FAQ, guide, glossary, fact) and a link, in the order the model used them. The type badge and the link both come directly off the engine-built citation object `{ url, title, type, slug }` (section 5 step 5), the page never has to re-derive type from the URL shape.
- A "grounded in" disclosure under the answer lists the retrieved records by title, including ones the answer did not cite, so the reader sees the corpus edge.
- Unverified figures carry a small mark with the words "not in our verified facts".
- Feedback control on every answer: helpful, not helpful, report. Report writes a row that the observatory digest lists within seven days.
- Related guides and records under the answer.
- Copy stays in the site's voice: no absolutist medical claims, escalation lines unchanged, no dosing or protocol detail beyond what the cited record says.

**Error map.** Every `errorCode` the pipeline can emit gets copy on the page rather than a generic failure state:

| errorCode | Copy shown |
|---|---|
| `rate_limited` | "You've used your questions for today. Come back tomorrow, or browse the library." |
| `quota_unavailable` | "AskRRM is briefly unavailable. Try again in a minute." |
| `retrieval_error` | "We couldn't search the library just now. Try again in a minute." |
| `generation_timeout` | "That took too long to answer. Try a shorter or more specific question." |
| `generation_error` | "Something went wrong generating an answer. Try again." |
| `prompt_too_long` | "That thread has gotten long, start a new question." |
| `upstream_error` | "AskRRM is briefly unavailable. Try again in a minute." |
| `service_unavailable` | "AskRRM is briefly unavailable. Try again in a minute." |

## 12. Later waves, named so the engine does not have to change

1. **Verified clinician register.** Table `clinician_verification` (`user_id`, `method` in npi|iirrm|manual, `identifier`, `name_match`, `taxonomy`, `country`, `status` in pending|verified|rejected, `verified_at`, `verified_by`). NPI path is self-serve through NPPES with a last-name match and a clinician taxonomy allowlist, one NPI per account. **IIRRM path is a partnership Brian wants:** IIRRM holds its roster, so verification is a member code or a roster email match that IIRRM controls, never a list we copy. IIRRM members would see the clinical register and citations plus a usage view for their board; RRM Academy gets verified clinicians outside the NPI world. No outreach until the patient Ask is fixed and measured (Brian's standing rule on partner asks). Manual path is a review queue in rrm-backoffice for everyone else. The clinical prompt is a second register file; caps 30 a day.
2. **Composite tools on the page.** `lookup_stat`, `draft_check`, `clinical_lookup`, `rebut` from the knowledge-harness wave-two spec, surfaced as answer actions.
3. **Connector OAuth** on rrm-mcp so a clinician's own Perplexity, ChatGPT or Claude calls RRM.
4. **AskRRM app shell.** PWA first, bearer auth on the same routes.

## 13. Regression gate and review

- Golden set: the 12 start-here questions plus every P0 and P1 from the Phase 1 ledger, as fixtures in `scripts/ask-eval/golden/`. A CI job runs them against the eval worker on any change to `functions/api/ask/**`, `functions/api/_ask_prompt.js`, or an `rrm-ai-search` deploy (the retired `ai-search-corpus-upload.mjs` is not a trigger; the live coverage owner is `rrm-library-worker` `/index/batch`, section 8), judges with the three-lens rubric, and fails on a new P0 or on a prompt that reintroduces a rule break.
- **Judging is two-stage, not LLM-only.** Deterministic judges run first: em dash presence, rule-3 phrase check, citation count, exact match on refusal text. Only after those pass does the LLM lens run, at temperature 0 with 3 votes, failing on 2-of-3 agreement on a P0. This bounds the flake an LLM judge would otherwise introduce into a gate that blocks deploys. Cost: about 60 judge calls per run on Workers AI, inside the standing no-paid-keys rule.
- **Cross-repo wiring.** The golden set lives in `rrm-academy-cf` but the trigger also needs to fire on an `rrm-ai-search` deploy, a separate repo. `rrm-ai-search`'s deploy workflow sends a `repository_dispatch` event named `ask-golden-set` to `rrm-academy-cf`, which runs the same CI job. The eval worker's bearer token is stored as the `rrm-academy-cf` Actions secret `ASK_EVAL_TOKEN`.
- **Eval worker asserts archive succeeded.** The golden set run checks `archive_error IS NULL` on every `ask_answer` row it produces, not just the answer content, a run that answers correctly but silently fails to archive would otherwise report green while breaking the review's own data trail. The eval worker itself returns `archive_error` in its response for exactly this check to read.
- Phases 2 and 3 of the review (citation fidelity, security) run before the engine ships; their findings land in the same fix wave.
- Quarterly full-bank rerun, ledger diffed.

**Safety lens counts alone.** Phase 1 (2026-09-14, 357 questions: 22 P0, 26 P1, 2 P2 confirmed at 2 of 3) showed four emergency-escalation misses that only the clinical-safety lens can see, so they never reached 2 of 3. In the golden set and in every rerun, a P0 from the safety lens is confirmed on its own; the 2-of-3 rule applies to the editorial and citation lenses only.

## 14. Sequencing

1. Phase 1 ledger lands (running). Fix wave on the current `ask.js` and prompt. Deploy. Rerun golden set.
2. Engine extraction with the Workers AI backend, v1 deleted, free tier real, Durable Object counter (section 7a). Eval worker switched to the module. The migration in section 9a lands here, `thread_id` is accepted on `POST /api/ask` and stored on the row from this step, but is not yet read back into the generation prompt (that starts at step 5). Deploy.
3. Rewrite, retrieval depth (`/retrieve`, section 5a), rerank, cite-or-refuse (engine-built citations, section 5), live citation resolve (`/resolve`, section 5a). Deploy behind `feature:ask_pipeline_v3`, flipped after the golden set passes.
4. Coverage: `rrm-library-worker` `/index/batch` gains glossary and guide handling; `rrm-ai-search` gains the `guides/` bucket (section 8). Namespace refresh.
5. Threads (thread_id now read and carried into generation, bounded per section 9), feedback, related, trust surface on the page, capability JSON.
6. Fact-check pass and unverified marks.
7. Spend daemon and digest section.

Each step is one PR with its own tests, and steps 3 to 6 each run the golden set before merge.

## 15. Proof gates

- G1 free account gets a 200 with citations three times, then a 429 with `RateLimit-Remaining: 0`; no 504 in a 100-request soak.
- G2 two concurrent requests at count 19 produce exactly one 200 (proves the `AskQuotaCounter` DO closes the KV race).
- G3 an answer with zero resolvable citations never reaches the client as prose (unit test on the engine and a live probe with a planted nonsense query).
- G4 golden set green; a prompt edit that adds an em dash or drops rule 3 turns CI red.
- G5 a follow-up that only makes sense in thread is answered correctly with `thread_id`, and answered with the "cannot answer from this thread" line without it.
- G6 fallback rate on the bank drops from the Phase 1 baseline after the coverage upload, measured on the same run tag.
- G7 a "report" click appears in the next weekly digest.
- G8 the spend daemon warns when a fixture month is seeded past $8.
- G9 switching `feature:ask_backend` to a stub OpenAI-compatible server answers through it, and an unreadable flag falls back to Workers AI.
- G10 a sentence with a number that the library worker's `/check-facts` fails to verify is marked `unverified` in the citations JSON and renders the mark on the page; a `/check-facts` timeout or non-2xx marks every extracted numeric claim `unverified` and sets `fact_check_error = 1` on the archived row (never silently trusted as verified).
- G11 a thread carrying 3 full-length turns never produces a `/generate` prompt over 12,000 characters; each carried turn is truncated to 400/900 characters (question/answer) and the total carried text never exceeds 4,000 characters (unit test on the truncation function, not just an integration probe).
- G12 the golden-set eval run asserts `archive_error IS NULL` on every `ask_answer` row it produces, not only that the answer content passed judging.
- G13 the `ASK_QUOTA` Durable Object fails closed: when the DO call itself errors (simulated timeout/unreachable), the request returns 503 `quota_unavailable`, never a silent pass-through 200.
- G14 a retrieved guide chunk resolves to a real title and URL through `rrm-ai-search`'s `guides/` bucket and appears as a citation with `type: "guide"`, rather than being silently dropped by `itemExists` for an unrecognized bucket.

## 16. Out of scope this round

Clinician verification and register, composite tools, OAuth, mobile shell, ads, CME, EHR, any private-corpus access, provider-directory answers, the ask page's visual redesign, `rrm-mcp`.
