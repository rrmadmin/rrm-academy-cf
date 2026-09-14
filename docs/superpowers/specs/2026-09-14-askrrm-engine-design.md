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
- Corpus in the namespace: articles, FAQs, posts, pillars. Glossary terms and guides are not uploaded. Textbook chapters, transcripts and every excluded type stay out (agent-scope 403, EXCLUDED_TYPES).
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
/ask page  ──►  POST /api/ask  ──►  functions/api/ask/_engine.js  ──►  rrm-ai-search (/search, /generate)
  (Astro)         (thin: auth,        rewrite → retrieve → rerank →        Workers AI: llama 3.3 70B
                   tier, cap,          generate → cite-or-refuse →          bge reranker, bge embeddings
                   thread, SSE)        fact-check → archive → related
                                              │
                                              ├─► D1 rrm-analytics: ask_answer (+ register, thread_id, cost_neurons, rewritten_query)
                                              ├─► D1 rrm-analytics: ask_feedback (new)
                                              ├─► rrm-library-worker /check-facts, /related (agent bearer)
                                              └─► Analytics Engine: worker-events rows via the report package
eval worker (scripts/ask-eval/worker) ──► same _engine.js, no user, no cap, source = eval
```

Everything the page can do is a JSON endpoint under `/api/ask/*` with session cookie auth today and a bearer option reserved (section 10). A native client later calls the same routes.

## 5. Engine module

`functions/api/ask/_engine.js` exports one function, `answer({ message, thread, register, backend, env, waitUntil })`, and owns the whole pipeline. `ask.js` shrinks to auth, tier, cap, thread lookup and response framing. The eval worker imports the same module, which is what makes the eval numbers mean something.

Backends live in `functions/api/ask/_backends/`:

- `workers-ai.js` (default): calls a new `rrm-ai-search` route `POST /generate` that takes the prompt and the reranked chunks the engine already chose and returns answer, citations, usage and neurons. The existing `/ask` route (retrieve and generate in one call) stays until the pipeline flag flips, then is removed.
- `openai-compatible.js`: POSTs a chat completion to `ASK_BACKEND_URL` with `ASK_BACKEND_TOKEN`, with the same prompt and chunks. Retrieval and reranking stay on Cloudflare for both backends; only generation moves. This is the Mac Studio, Hetzner or any hosted model lane. Selected by the KV flag `feature:ask_backend`, default `workers-ai`, fail-closed to the default on any misread.

The v1 NLWeb branch and its `NLWEB_SEARCH_URL` binding are deleted.

### Pipeline steps

1. **Rewrite.** One cheap Workers AI call (`@cf/meta/llama-3.1-8b-instruct`) turns fragments, typos and mid-sentence input into one full question in the same language, with the thread's last 3 turns as context. The original and the rewrite are both archived. Skipped when the input already ends in a question mark and is over 40 characters.
2. **Retrieve.** `rrm-ai-search` `/search` with `top_k = 20` on the rewritten question.
3. **Rerank.** `@cf/baai/bge-reranker-base` scores the 20 chunks against the rewritten question; the top 8 become context. Reranker cost is neurons, inside the budget.
4. **Generate.** The register prompt plus the 8 chunks plus the last 3 turns go to the backend. `max_tokens` stays 1024.
5. **Cite-or-refuse.** An answer that carries no citation resolving to a published record is replaced by the refusal text and archived with `fallback = 1`. Prose without a source is never served.
6. **Fact-check.** Sentences containing a number with a unit or percent are sent to `/check-facts` on the library worker. A match attaches the fact as a citation. A miss marks the sentence `unverified` in the citations JSON and the page renders the mark. This is a check, not a rewrite.
7. **Citations resolve live.** Each citation URL is checked against D1 (published, not retracted, not excluded) at answer time. A dead citation is dropped, and if that empties the list, step 5 applies.
8. **Related.** `/related` on the library worker returns up to 4 guides or records for the top citation, no model call.
9. **Archive.** One `ask_answer` row with the new columns; one `worker-events` row.

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

## 8. Coverage

`scripts/ai-search-corpus-upload.mjs` adds two types to the namespace: glossary terms (D1 `rrm-auth` glossary, published only) and guides (pillar companions and the neofertility guide pages). Attributes carry `type` so retrieval can filter. Fallback rate becomes a tracked metric in the digest with a target under 10% on the golden set.

## 9. Threads

Table `ask_thread` in `rrm-analytics`: `id`, `user_id`, `created_at`, `last_turn_at`. `ask_answer` gains `thread_id` and `turn`. `POST /api/ask` accepts an optional `thread_id`; a missing or foreign id starts a new thread. The engine sends the last 3 turns (question and answer text, citations by id) with the new question. Threads expire from the page after 24 hours; rows are kept for the review.

## 10. API surface (API-first)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ask` | POST | session | answer; body `{ message, thread_id? }`; JSON or SSE by Accept |
| `/api/ask/feedback` | POST | session | `{ ask_answer_id, verdict: helpful|not_helpful|report, note? }` |
| `/api/ask/thread/:id` | GET | session, owner | turns for resume |
| `/api/ask/saved` | existing | session | unchanged |
| `/api/ask/sandbox` | existing | none | canned response for client integration |
| `/api/ask` | GET | none | capability JSON, gains `version`, `registers`, `caps` |

Every response carries `RateLimit-Limit` and `RateLimit-Remaining` on JSON and SSE alike. A bearer-token variant of session auth is reserved for the app wave and not built now; the routes are designed so adding it touches `_shared.js` only.

## 11. Trust surface on the page

- Citations render as title, type badge (article, FAQ, guide, glossary, fact) and a link, in the order the model used them.
- A "grounded in" disclosure under the answer lists the retrieved records by title, including ones the answer did not cite, so the reader sees the corpus edge.
- Unverified figures carry a small mark with the words "not in our verified facts".
- Feedback control on every answer: helpful, not helpful, report. Report writes a row that the observatory digest lists within seven days.
- Related guides and records under the answer.
- Copy stays in the site's voice: no absolutist medical claims, escalation lines unchanged, no dosing or protocol detail beyond what the cited record says.

## 12. Later waves, named so the engine does not have to change

1. **Verified clinician register.** Table `clinician_verification` (`user_id`, `method` in npi|iirrm|manual, `identifier`, `name_match`, `taxonomy`, `country`, `status` in pending|verified|rejected, `verified_at`, `verified_by`). NPI path is self-serve through NPPES with a last-name match and a clinician taxonomy allowlist, one NPI per account. **IIRRM path is a partnership Brian wants:** IIRRM holds its roster, so verification is a member code or a roster email match that IIRRM controls, never a list we copy. IIRRM members would see the clinical register and citations plus a usage view for their board; RRM Academy gets verified clinicians outside the NPI world. No outreach until the patient Ask is fixed and measured (Brian's standing rule on partner asks). Manual path is a review queue in rrm-backoffice for everyone else. The clinical prompt is a second register file; caps 30 a day.
2. **Composite tools on the page.** `lookup_stat`, `draft_check`, `clinical_lookup`, `rebut` from the knowledge-harness wave-two spec, surfaced as answer actions.
3. **Connector OAuth** on rrm-mcp so a clinician's own Perplexity, ChatGPT or Claude calls RRM.
4. **AskRRM app shell.** PWA first, bearer auth on the same routes.

## 13. Regression gate and review

- Golden set: the 12 start-here questions plus every P0 and P1 from the Phase 1 ledger, as fixtures in `scripts/ask-eval/golden/`. A CI job runs them against the eval worker on any change to `functions/api/ask/**`, `functions/api/_ask_prompt.js`, `scripts/ai-search-corpus-upload.mjs`, or an `rrm-ai-search` deploy, judges with the three-lens rubric, and fails on a new P0 or on a prompt that reintroduces a rule break.
- Phases 2 and 3 of the review (citation fidelity, security) run before the engine ships; their findings land in the same fix wave.
- Quarterly full-bank rerun, ledger diffed.

## 14. Sequencing

1. Phase 1 ledger lands (running). Fix wave on the current `ask.js` and prompt. Deploy. Rerun golden set.
2. Engine extraction with the Workers AI backend, v1 deleted, free tier real, Durable Object counter. Eval worker switched to the module. Deploy.
3. Rewrite, retrieval depth, rerank, cite-or-refuse, live citation resolve. Deploy behind `feature:ask_pipeline_v3`, flipped after the golden set passes.
4. Coverage upload (glossary, guides). Namespace refresh.
5. Threads, feedback, related, trust surface on the page, capability JSON.
6. Fact-check pass and unverified marks.
7. Spend daemon and digest section.

Each step is one PR with its own tests, and steps 3 to 6 each run the golden set before merge.

## 15. Proof gates

- G1 free account gets a 200 with citations three times, then a 429 with `RateLimit-Remaining: 0`; no 504 in a 100-request soak.
- G2 two concurrent requests at count 19 produce exactly one 200.
- G3 an answer with zero resolvable citations never reaches the client as prose (unit test on the engine and a live probe with a planted nonsense query).
- G4 golden set green; a prompt edit that adds an em dash or drops rule 3 turns CI red.
- G5 a follow-up that only makes sense in thread is answered correctly with `thread_id`, and answered with the "cannot answer from this thread" line without it.
- G6 fallback rate on the bank drops from the Phase 1 baseline after the coverage upload, measured on the same run tag.
- G7 a "report" click appears in the next weekly digest.
- G8 the spend daemon warns when a fixture month is seeded past $8.
- G9 switching `feature:ask_backend` to a stub OpenAI-compatible server answers through it, and an unreadable flag falls back to Workers AI.

## 16. Out of scope this round

Clinician verification and register, composite tools, OAuth, mobile shell, ads, CME, EHR, any private-corpus access, provider-directory answers, the ask page's visual redesign, `rrm-mcp`.
