# Search Rebuild — /library first, /ask follows

**Date:** 2026-04-20
**Status:** Plan (not yet executing)
**Replaces:** `2026-04-16-nlweb-integration.md`
**Owner:** Brian
**Sequencing decision:** Pivoted 2026-04-20 — /library search leads (evidence-backed pain), /ask v2 follows (opportunistic, near-free once namespace is live).
**Blast radius:** /library search bar (449 queries / 14 days) then /ask (3 queries / 14 days). Both ship behind independent feature flags; rollback = flip flag.

## Evidence — why this order

Pulled `rrm-analytics.search_log` for the last 14 days (2026-04-20):

| Source | Volume | Avg latency | Avg results | Errors |
|--------|--------|-------------|-------------|--------|
| semantic (Vectorize) | 449 | 359 ms | 5.8 | 0 |
| pagefind (client) | 411 | n/a | 10.0 | 0 |
| ask | 3 | 22190 ms | n/a | 0 |

**User signal:** Brian reports intermittent miss on /library ("semantic isn't quite smart enough — I can tell"). Query log confirms the shape of his pain — short exact-term queries where pure vector drifts:

- `thyroid` searched 3× (capped at 5 results each time — same user returning, not finding it)
- `whittaker` searched 2× (name query — Vectorize returns semantic neighbors, not exact byline matches)
- `levothyroxine`, `isthmocele`, `short follicular phase`, `cyst` — all at the k=5 cap, meaning "enough returned" not "good returned"
- `/ask` saw 3 queries in 2 weeks — not yet a source of user pain, only Naomi has surfaced tuning asks (captured below)

The primitive's hybrid retrieval (BM25 + vector + optional cross-encoder reranker) is designed for exactly this class of miss. Premise is evidence-backed on /library; /ask v2 rides along once the corpus + binding are proven.

## Goal

Unify /ask and /library search onto Cloudflare's AI Search agent primitive (`ai_search_namespaces` binding, released 2026-04-16, evolution of AutoRAG). One namespace, one corpus, two consumers. Fix exact-term drift on /library. Inherit the same upgrade on /ask with no extra corpus work. Replace the separate `scripts/embed-library-ci.mjs` embedding CI step with one `uploadAndPoll()` loader.

**Hard cost constraint:** generation stays on Workers AI (Llama 3.3 70B today, swap to Kimi K2.5 only if the RRM guardrail harness justifies it). No Sonnet, no Anthropic API for /ask. Retrieval is the only paid-beta layer, and CF AI Search is free during beta with 30-day billing notice.

## Non-goals

- Do not redesign `src/pages/ask.astro` or the SearchBar visual shell (polish lands in Wave 2 Phase 8, separately flagged).
- Do not change response contracts. `{ answer, citations }` for /ask, `{ results: [...] }` for /library (with one added optional `feedback_token` field for the miss button).
- Do not remove Pagefind — client-side type-ahead stays, it wins on latency and offline.
- Do not touch rate limits, auth, or D1 logging. Preserve exactly.
- Do not ship whittaker.ai per-practice in this plan. Prove the pattern here first.
- Do not introduce Sonnet or any off-platform LLM. Workers AI only.

## Wave 1 — /library semantic replacement (pain is here)

### Architecture

Replace `functions/api/search/semantic.js` (Vectorize-backed) with `functions/api/search/library.js` (AI Search namespace). SearchBar.astro still fuses via Reciprocal Rank Fusion; the semantic leg swaps engine underneath.

Namespace: `rrm-academy-search` (single instance, hybrid index: BM25 + vector, Porter tokenizer for natural-language corpus, cross-encoder reranker evaluated in Phase 3).

Consumers:

| Consumer | Endpoint | Operation | Response |
|----------|---------|-----------|----------|
| /library SearchBar | `/api/search/library` | `search()` | `{ results, feedback_token }` |
| /ask (Wave 2) | `/api/ask` | `search()` + `AI.run()` | `{ answer, citations }` |

### Phase 0 — Spike (1-2 hours, no user impact)

Verify in a throwaway Worker:

1. `ai_search_namespaces` binding works inside **CF Pages Functions**, not just standalone Workers. If Pages-only doesn't support it yet, fallback = dedicated Worker + service binding from Pages. This is the single biggest unknown.
2. Result shape from `search()` — what fields land, how citations surface, how score + rank appear.
3. `uploadAndPoll()` behavior with markdown + metadata object. Does frontmatter get stripped? Does metadata live inside the file or the third argument?
4. **Metadata filter semantics** — does `filter: { type: { $in: [...] } }` work, or is it post-query filtering? Upload 3 docs with `type=article|faq|post`, then query with a filter clause. Also test: what happens when a doc is missing a filter field — excluded or kept? (Supportive-reviewer note — highest-leverage Phase 0 check because Phase 8 facets depend on it.)
5. Can one instance be fed by both programmatic `uploadAndPoll()` AND site crawl without conflict?

Deliverable: one-paragraph "Spike results" appended here. Kill-switch: if Pages Functions don't support the binding and a service-bound Worker adds >300ms, stop and reassess.

### Phase 1 — Corpus loader (1 day)

`scripts/search-corpus-upload.mjs`:

- Reads `src/data/articles.json`, `posts.json`, `faqs.json`, `glossary.json`, `courses.json`, plus pillar pages.
- Emits one derived markdown per doc with rich metadata: `type`, `year`, `rrm_relevance`, `domain`, `authors[]`, `status`, `url`, `updated_at`.
- Hash log in new D1 table `ai_search_docs` (`doc_id, content_hash, uploaded_at, source_type`). Skip unchanged docs.
- **Reconcile pass** (supportive-reviewer #1): diff D1 published set against `ai_search_docs.doc_id`. Delete orphans via namespace delete API. Dry-run default, `--apply` flag to execute. Hard max-delete guard — refuses if >50 deletions in one run.
- **Idempotency** (P17 below): second run on unchanged source must produce zero mutations, zero hash writes.
- Runs manually for Phase 0-3 validation. Wired into `deploy.yml` only after Phase 5 cutover.

### Phase 2 — `/api/search/library` endpoint (1 day, flagged)

Dispatch **coder agent** (mandatory for `functions/api/` edits per project rules).

- New file: `functions/api/search/library.js`. Leaves `semantic.js` intact during flag window.
- `SEARCH_V2_ENABLED` gate via KV (`COMMUNITY_KV` key `feature:search_v2`) — **not env var**. Flips globally in <60s, no deploy needed. Middleware short-circuits on read, resilient to v2 module failing to load at boot (supportive-reviewer #5).
- Response contract: `{ results: Array<{ url, title, type, snippet, score, year?, domain?, rrm_relevance? }>, feedback_token: string }`. Preserve SearchBar RRF logic unchanged.
- IP rate limit preserved (20/min per cf-connecting-ip) in the new file.
- `boost_by` configurable per request via query params, default `[{ field: 'rrm_relevance', direction: 'desc' }, { field: 'year', direction: 'desc' }]`.
- Type filter: `?type=article|post|faq|glossary|course` → maps to namespace filter clause validated in Phase 0.
- AE logging: `event='library_search_v2'` — duration, result count, http status, reranker_used, boost_fields.
- D1 `rrm-analytics.search_log` writes with `source='semantic_v2'` during rollout, flipped to `'semantic'` at cutover (keep historical comparison clean).
- System rule: no `err.message` to client; structured `{ error: 'code' }` only; 503 on missing binding.

### Phase 3 — Side-by-side eval (half day)

Miss corpus built from 14-day search log (already have it). 20 queries covering:

- **Exact-term targets:** `thyroid`, `whittaker`, `levothyroxine`, `isthmocele`, `NaProTechnology`, `CA-125`, `Hilgers`, `Creighton`, `recXXX` IDs, PMID lookups.
- **Conceptual:** `short follicular phase`, `recurrent miscarriage testing`, `endo symptoms I missed`, `PCOS without weight gain`, `progesterone support in luteal phase`.
- **Type-scoped:** same query across `type=article` vs `type=faq`.

For each: run v1 (`semantic.js`) and v2 (`library.js`), capture top-5 results side by side. Score manually 1-5 on relevance. Record latency P50/P95.

**Reranker A/B** — same set, reranker on vs off. Keep on only if NDCG@3 improves ≥0.05 at ≤100ms extra latency.

Deliverable: eval table appended to this doc.

**Go/no-go gates:**
- Top-3 relevance median ≥ v1.
- P95 latency ≤ 600ms end-to-end (v1 is ~500ms after fusion).
- No citation URL regressions (every returned URL returns 200).
- Zero `snippet` field with HTML escape bugs.

### Phase 4 — Miss-button sidecar (half day, parallel with Phase 3)

Ship a "didn't find what I needed" signal on SearchBar regardless of engine, so we build an ongoing miss corpus from real usage.

- Schema: `ALTER TABLE search_log ADD COLUMN feedback TEXT;` (values: `miss`, `hit`, null). Or new table `search_feedback(log_id, feedback, created_at)` to avoid write-amplifying `search_log`. Pick via Phase 0 comment.
- Endpoint: `POST /api/search/feedback` with body `{ token, value: 'miss' | 'hit' }`. `token` is the `feedback_token` returned from `/api/search/library` and `/api/search/semantic` — HMAC-signed `{log_id, exp}`, 1-hour TTL.
- SearchBar UI: small "didn't find it?" button below results. Click → POST + visual confirmation. No modal, no form.
- Admin view: extend `/api/admin/search-queries` with `feedback` filter.

This ships independent of the engine swap. Works on v1, works on v2. Gives us a permanent diagnostic tool.

### Phase 5 — Rollout

- Flip KV `feature:search_v2=true` for admin user(s) only (check `user.is_admin` in `library.js`).
- 24h observation, **health-based abort** (supportive-reviewer #2):
  - Abort if `semantic_v2` 5xx rate >2%, OR P95 >1s, OR mean results_count drops >30% vs `semantic` baseline over any 1h window.
  - Gate is a query against `worker_events`, not eyeballing dashboards.
- Flip to all users. 48h observation under same gates.
- Remove flag + v1 code path.

### Phase 6 — Retire Vectorize

- 2 weeks after v2 cutover, with zero miss-rate regression.
- Delete `functions/api/search/semantic.js` (guarded file — run `npm run guard:update`).
- Delete `scripts/embed-library-ci.mjs`.
- Decommission Vectorize index `rrm-library-embeddings`.
- Update CLAUDE.md "Semantic Search" section.

### Phase 7 — SearchBar UX upgrade (1-2 days, engine-independent, separately flagged)

Ships independently of Waves. Gated on `SEARCHBAR_V2_ENABLED` KV flag.

- Facet chips: type, year range, domain, rrm_relevance tier. Map to query params (real re-query, bookmarkable URLs — P15 below).
- Result previews: 2-line snippet with matched-term highlighting via `<mark>` on the snippet field. Must escape HTML before wrapping (supportive-reviewer proof gate adjacent).
- Type badge + year + domain pill per result.
- "Did you mean": on zero results, show the reranker's top retrieval without filters.
- Keyboard: `/` focuses, `Esc` clears, arrow keys navigate.
- Empty state: "popular queries" from `search_log` top-N last-30d. Refreshes weekly.

Read `docs/design/design-system.json` before any styling.

## Wave 2 — /ask v2 (opportunistic, near-free after Wave 1)

Starts only after Wave 1 Phase 5 cutover is green. Reuses the already-loaded corpus in the same namespace.

### Architecture

Split retrieval from generation. Retrieve via `env.SEARCH_KB.search({...})`, generate via `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [...] })` with retrieved chunks in the user turn.

**Why split:** swap models without re-indexing, system prompt stays greppable in repo, citation extraction is deterministic. Trade-off: two round trips instead of one. Verified acceptable in Wave 1 Phase 3 latency numbers.

### Phase 8 — `/api/ask` v2 endpoint (1 day, flagged)

- Coder agent.
- `ASK_V2_ENABLED` KV flag.
- System prompt moves to `functions/api/_ask_prompt.js` (imported, not duplicated). Add to guard manifest.
- `functions/api/search/library.js` stays untouched — /ask calls the namespace directly via its own binding, not through the /library endpoint. Keeps the contracts clean.
- Preserve: 20/day KV rate limit, session + blocked check, D1 search_log write (`source='ask'`), AE writeDataPoint (direct, never `waitUntil`'d), `{ answer, citations }` response contract.

### Phase 9 — Naomi's /ask tuning backlog

(Brian to forward Naomi's specific observations — placeholder section for her input.)

Known candidates to capture once notes arrive:
- Editorial rule refinements in `_ask_prompt.js`
- Citation preference (library URLs only? specific journal tiers?)
- Tone calibration for specific query types (e.g. patient-facing vs clinician-facing)
- Answer length / structure preferences

Ship as targeted edits to `_ask_prompt.js`, each under a "Naomi tuning" commit prefix, each testable against a pinned query set she approves.

### Phase 10 — Generator model evaluation (half day, optional)

Only if Phase 8 data shows Llama 3.3 70B falls short on the RRM 31-query guardrail harness (currently 87% baseline).

- A/B: Llama 3.3 70B vs Kimi K2.5 on the harness + Naomi's pinned queries.
- Swap only if Kimi meets or beats Llama on harness AND Naomi approves tone.
- One-line change in `ask.js` post-split.
- Hard constraint: must stay on Workers AI. Sonnet is off the table until a revenue case justifies the per-query cost.

### Phase 11 — /ask v2 rollout + retire v1

Same pattern as Wave 1: admin → all → cutover → 2-week dormant rollback.

## Proof gates (applies across both waves unless scoped)

- **P1 — Binding guard.** Missing env/binding returns 503 JSON, never silent 200.
- **P2 — Fetch try/catch.** Every external call (namespace `search()`, `uploadAndPoll()`, `AI.run()`) wrapped. No `err.message` leaked.
- **P3 — Response shape stable.** `{ results }` for /library, `{ answer, citations }` for /ask. ask.astro + SearchBar untouched.
- **P4 — Logging parity.** `search_log` writes for every search + ask request.
- **P5 — Editorial rules enforced.** [**/ask only**] `_ask_prompt.js` imported; grep for IVF-reframe phrase returns hits.
- **P6 — Rate limit preserved.** Same KV key patterns, same caps, same TTLs.
- **P7 — Guard manifest.** New files hash-registered via `npm run guard:update`.
- **P8 — arise-scan clean.** Zero findings on `silent-failure`, `unwrapped-await`, `error-leak` for new files.
- **P9 — Coder agent sibling check.** Agent reports siblings read and patterns matched.
- **P10 — E2E live check post-cutover.** Real HTTP POST returns valid result + ≥1 reachable URL.
- **P11 — Type filter.** `?type=article` returns only articles; `?type=faq` returns only FAQs.
- **P12 — SearchBar fallback.** If /api/search/library errors, Pagefind still returns. No blank state.
- **P13 — Corpus completeness.** After loader run, namespace doc count ≥ v1 counts (articles ≥ 2500, posts ≥ 5, faqs ≥ 10, glossary ≥ 100).
- **P14 — Pagefind untouched.** SearchBar still loads Pagefind index on mount; JS-off keyword search still works.
- **P15 — Facet URLs bookmarkable.** Every facet combination produces a shareable URL (query-string state).
- **P16 — Citation URL shape-check at write time** (supportive-reviewer). Every extracted citation must match `^/library/rec[a-z0-9]+/?$` or `^https://rrmacademy\.org/`. Reject malformed, log `citation_malformed`.
- **P17 — Loader idempotency** (supportive-reviewer). Two consecutive runs on unchanged source produce zero namespace mutations and zero `ai_search_docs` writes.
- **P18 — Reconcile dry-run default.** `scripts/search-corpus-upload.mjs --reconcile` without `--apply` writes nothing.
- **P19 — KV rollback works when module fails to load** (supportive-reviewer). Test: intentionally break v2 import, confirm middleware short-circuit returns 503 with `Retry-After` before the v2 module initializes.

## Rollback

- Pre-cutover: `npx wrangler kv:key put --binding=COMMUNITY_KV feature:search_v2 false` — live globally in <60s.
- Post-cutover (v1 code still in repo): flip flag back, redeploy only if the middleware short-circuit is inadequate.
- After v1 deletion: revert commit, redeploy. Vectorize index stays dormant 2 weeks minimum as escape hatch.

## Risks

| Risk | Mitigation |
|------|-----------|
| `ai_search_namespaces` not supported in CF Pages Functions | Phase 0 spike. Fallback = dedicated Worker + service binding. |
| Metadata filter semantics not as expected | Phase 0 check #4. Phase 7 facets depend on it. |
| Corpus loader drifts away from D1 (retractions, archives) | Phase 1 reconcile pass with dry-run + max-delete guard. |
| Namespace fragmentation across future sites (whittaker.ai, neofertility.ie, IIRRM, lunira) | Explicitly scoped out. Revisit as a separate "multi-tenant search topology" plan after this ships. |
| Beta billing surprise | CF 30-day notice before billing. Add billing alarm on Workers AI spend. |
| Reranker cost at scale | Phase 3 A/B gates it on measured NDCG uplift, not vibes. |
| Kimi/Llama drift from editorial rules | Phase 10 guardrail harness gate. Default is "stay on Llama." |
| KV-flag rollback fails under import-time crash | P19 proof gate. Middleware short-circuit is a layer above the v2 module. |

## Not doing (explicit)

- Not introducing Sonnet, GPT, or any non-Workers-AI generator.
- Not adding conversation history to /ask.
- Not streaming /ask responses.
- Not modifying signup flow or welcome-ask email.
- Not building whittaker.ai per-clinic namespaces in this plan.
- Not unifying Pagefind onto the new primitive (separate decision post-cutover).

## Open questions (resolve in Phase 0)

1. Does `ai_search_namespaces` binding work inside CF Pages Functions?
2. Result shape from `search()` — metadata fields, score, rank, chunk text?
3. Does `uploadAndPoll()` accept markdown with frontmatter?
4. Does metadata filter support `$in` / substring / null handling?
5. Can one instance be fed by both `uploadAndPoll()` AND site crawl simultaneously?

## Links

- CF blog: `blog.cloudflare.com/ai-search-agent-primitive/` (2026-04-16)
- Memory: `cf-ai-search-agent-primitive.md`
- Superseded v1 plan: `2026-04-16-nlweb-integration.md`
- Current code: `functions/api/ask.js`, `functions/api/search/semantic.js`, `src/components/SearchBar.astro`
- 14-day query evidence: `rrm-analytics.search_log` pull 2026-04-20
- Supportive review: 2026-04-20 (supportive SWE)
- Contrarian review: 2026-04-20 (contrarian SWE)
- Guardrail harness: `projects/neofertility-ie/scripts/test-guardrails.js`
- AEO baseline: `projects/neofertility-ie/scripts/aeo-check.py`
