# /ask v2 — Rebuild on CF AI Search Agent Primitive

**Date:** 2026-04-20
**Status:** Plan (not yet executing)
**Replaces:** `2026-04-16-nlweb-integration.md`
**Owner:** Brian
**Blast radius:** Customer-facing `/ask` endpoint. Ship behind feature flag, rollback = flip flag.

## Goal

Rebuild the `/ask` conversational layer on Cloudflare's new **AI Search agent primitive** (`ai_search_namespaces` binding, announced 2026-04-16, evolution of AutoRAG). Gain hybrid BM25 + vector retrieval, richer metadata boosting, and per-tenant provisioning pattern that whittaker.ai will reuse.

Ship without breaking the live `/ask` page, without regressing AEO baseline, and without touching the UI.

## Today (what's live)

- AutoRAG instance `rrm-academy-ask` (account `ecf2c5bc8b5ebd634bcb587b3890910a`, rendered-site crawl over rrmacademy.org).
- Public OpenAI-compatible endpoint at `https://383a8638-22b4-46c2-823d-1d42dbcb2bf3.search.ai.cloudflare.com/chat/completions`.
- `functions/api/ask.js` — session auth, blocked check, KV rate limit (20/day), input validation, `AbortSignal.timeout(28000)`, AE logging + D1 `rrm-analytics` search-query logging, editorial system prompt inline.
- `src/pages/ask.astro` — unchanged UI, Cmd+Enter submit, markdown, citations.
- Generator: Llama 3.3 70B.
- Secret: `NLWEB_SEARCH_URL` on CF Pages `rrm-academy` project.
- Known gaps: cold-start latency up to 15s, CF Pages `_headers` 4xx→200 corruption (workaround in ask.astro).

## Why rebuild now

1. **Hybrid retrieval fixes exact-term drift.** Queries like "NaProTechnology", "CA-125", "recXXX" IDs, drug names, and protocol acronyms currently drift because pure-vector misses exact strings. BM25 via the new primitive matches them directly.
2. **Programmatic corpus control.** `uploadAndPoll()` lets us feed library articles with rich metadata (year, authors, domain, rrm_relevance, status) instead of relying on HTML crawl. Lets us boost fresh/high-relevance articles. Lets us exclude draft or retracted records surgically.
3. **Unlocks whittaker.ai per-practice.** Paid tier allows 5,000 instances per account. The binding supports runtime `create()`. Once the shape is proven on `/ask`, whittaker.ai provisions one namespace per clinic at deploy.
4. **Better observability.** First-party binding returns structured results the Worker owns — no parsing OpenAI-shaped responses, no brittle `choices[0].message.citations || context || []` extraction.

## Non-goals

- **Do not redesign `src/pages/ask.astro`.** UI stays identical.
- **Do not change the response contract.** `{ answer, citations }` shape preserved — citations remain `{ url, title }`.
- **Do not touch `/search` (Pagefind) or `/api/search/semantic` (Vectorize).** Separate systems, separate plan if we unify later.
- **Do not alter rate limits, auth, or logging.** Keep 20/day KV limit, session + blocked check, D1 `rrm-analytics` writes, AE `worker_events` writes.
- **Do not ship whittaker.ai changes in this plan.** Prove the pattern here first.

## Architecture decision — retrieval + generation split

The old instance exposed `/chat/completions` (retrieval + generation bundled). The new primitive's `search()` returns retrieved chunks; generation is caller-owned.

**Decision:** split them. Retrieve via `env.ASK_KB.search({...})`, then run generation via `env.AI.run(model, { messages: [...] })` with the retrieved chunks injected into the prompt.

**Why split:**
- Swap generation models independently (Llama 3.3 70B → Kimi K2.5 → future) without re-indexing.
- System prompt (editorial rules) stays plain-text and greppable in the repo, not stapled to a service URL.
- Citation extraction is deterministic from `search()` results, not parsed out of a model response.
- Matches the Agents SDK pattern used in `agentic-inbox` and future rrm-mcp tools.

**Trade-off:** two round trips instead of one. Mitigated by: search is fast (<500ms typically), Workers AI is colocated.

## Data-loading strategy

**Revised 2026-04-20 post-spike** based on real corpus inspection (`articles.json`: 3,021 records) and the Phase 0.5 experiments:

**Key shape (locked):** `/library/<slug>-<recid>.md` — `.md` extension REQUIRED (server uses it for content-type inference; non-suffixed keys fail with `unable_to_determine_file_content_type`). Length cap ~150 chars (confirmed: 121 works, 171 fails). Unicode (`ü`, `ł`, `α`, `μ`) round-trips exactly. 87 production slugs exceed 100 chars — of those, any over ~140 needs a shorter key scheme (hash-suffix fallback stored in D1).

**Custom metadata schema (locked on 5 fields — the cap):**
```json
[
  {"field_name":"type","data_type":"text"},
  {"field_name":"year","data_type":"number"},
  {"field_name":"topic_primary","data_type":"text"},
  {"field_name":"rrm_relevance","data_type":"number"},
  {"field_name":"is_open_access","data_type":"boolean"}
]
```

Reasoning: `domain` and `rrm_relevance` as envisioned in the original plan **do not exist in the production corpus** (`articles.json` shows `domain: ""` on 3,021/3,021 and `rrmRelevance: null` on 3,021/3,021). The real taxonomy is `topics` (array, populated on 2,979/3,021). CF does not accept array metadata values — arrays fail with `invalid_metadata_format`. The workaround is pick-a-primary: `topic_primary = topics[0]` and rely on vector recall for the rest, OR explode per topic (corpus × 2-3). **Decision: topic_primary in metadata, full topic array in the chunk text body so BM25 still matches.** `rrm_relevance` sourced from rrm-cli's D1 `knowledge.rrm_relevance` (not the empty Airtable column) — backfill script required before Phase 1 day 1. `url` and `title` are NOT in metadata (5-field cap busts): URL is derivable from `key` (we set `key = URL path`), title is looked up from D1 by parsed recid at citation-render time.

All metadata values MUST be strings at the SDK level (verified: numeric values fail even when the schema declares `data_type: number`; server coerces strings on the way in). Phase 1 loader stringifies everything.

**Upload semantics (locked):** `key` is the primary key. Re-upload with the same key replaces content (verified: second upload's content appears in search; first doesn't). Same key → same item_id stays stable across uploads. `timestamp` in metadata does NOT advance on re-upload — if the loader needs a "last modified" signal, track it in D1 alongside a content hash. Deletes use `instance.items.delete(item_id)` — **takes item_id, not key** (key-based delete returns `item_not_found`). Phase 1 D1 table `ai_search_docs` must persist `key ↔ item_id` mapping for reconcile to work.

**Two sources into one instance:**

1. **Programmatic upload (primary)** — every published library article + published blog post + FAQ + glossary term + pillar page, uploaded via `uploadAndPoll()`. `key = /library/<slug>.md`, `/commentary/<slug>.md`, `/faqs/<slug>.md`, `/glossary/<slug>.md`, etc. Content is `# Title\n\n<frontmatter-stripped markdown body>` — YAML frontmatter is NOT parsed by the indexer (verified), so prepend any body-relevant metadata (topics array, authors, abstract) as inline prose so keyword search can match. Re-runs on every full deploy (not every push). Use `Promise.all` with concurrency 10 (~3.3s/doc parallel, ~19 min for 3,400 docs full rebuild; single-doc updates << 1s cold). Content hash stored in D1 `ai_search_docs` for delta-only uploads.

2. **Site crawl (secondary) — DEFERRED TO A SEPARATE INSTANCE.** Phase 0.5 confirmed upload works on a crawler-typed instance but did NOT test crawler + upload simultaneously indexed. Rather than risk it, we provision two instances: `rrm-academy-search-articles` (upload-only, schema above) + `rrm-academy-search-site` (web-crawler of rrmacademy.org, no custom schema). Query-time: use `namespace.search({ instance_ids: [both] })` (CF's documented cross-instance primitive). This also sidesteps the mutate-type immutability problem — each instance has one purpose, no mixing.

Corpus size target: ~3,021 articles + ~25 FAQs + ~132 glossary terms + ~48 commentary posts + ~7 pillar pages ≈ 3,233 docs. Within the 500k-file hybrid ceiling with room for growth.

## Model choice

| Model | Pros | Cons |
|-------|------|------|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (current) | Known-good, stable on RRM content, generous context | No tool-calling surface, older |
| `@cf/moonshotai/kimi-k2.5` (what agentic-inbox uses) | Newer, fast, good for structured output | Less tested on RRM editorial prompt |

**Recommendation:** keep Llama 3.3 70B for v2 launch. Swap later only if guardrail harness shows Kimi matches or exceeds Llama on the RRM 31-query harness. Model swap is a one-line change post-split.

## Implementation phases

### Phase 0 — Spike (complete, 2026-04-20)

See "Phase 0 + 0.5 Spike Results" section below. 14 experiments run, plan locked.

### Phase 1 — Corpus loader + provisioning (1-2 days)

Two production instances on namespace `rrm-academy-search`:

**1a. Provisioning script** `scripts/ai-search-provision.mjs` (idempotent, checked into CI):
- Creates namespace `rrm-academy-search` if absent.
- Creates `rrm-academy-search-articles` instance with `hybrid_search_enabled: true` (type defaults to built-in-storage). PUTs the 5-field schema (`type`, `year`, `topic_primary`, `rrm_relevance`, `is_open_access`) via REST.
- Creates `rrm-academy-search-site` instance with `type: "web-crawler"`, `source: "rrmacademy.org"`, `hybrid_search_enabled: true`. Leaves `enable: false` for initial deploy (site crawl added in a follow-up tick once upload-only is green in production).
- Uses `CLOUDFLARE_API_TOKEN` from CF Pages env (token needs `AI Search Write`). Verifies `custom_metadata` round-trip after PUT.

**1b. D1 tracker table** `ai_search_docs` in `rrm-auth`:
```sql
CREATE TABLE ai_search_docs (
  key TEXT PRIMARY KEY COLLATE NOCASE,     -- /library/<slug>.md etc
  item_id TEXT NOT NULL,                    -- for items.delete(item_id)
  instance_id TEXT NOT NULL,                -- rrm-academy-search-articles (always, for now)
  content_hash TEXT NOT NULL,               -- sha256 of body+metadata
  source_type TEXT NOT NULL,                -- 'article' | 'post' | 'faq' | 'glossary' | 'pillar'
  full_slug TEXT,                           -- unsplit slug when key was truncated to fit <=140
  indexed_at TEXT NOT NULL,                 -- ISO
  last_seen_at TEXT NOT NULL                -- ISO; bumped every run even if skipped
);
CREATE INDEX idx_ai_search_docs_source_type ON ai_search_docs(source_type);
```

**1c. Corpus loader** `scripts/ai-search-corpus-upload.mjs`:
- Reads `src/data/articles.json` + `posts.json` + `faqs.json` + `glossary.json` + pillar-page constants.
- For each record: build `key` (`/library/<slug>.md` etc; if length > 140, truncate slug to 120 and append sha8 of full slug, store full slug in `ai_search_docs.full_slug`).
- Body: `# <title>\n\n` + full topic array as inline prose (`Topics: a, b, c.`) + abstract/content with frontmatter stripped. No YAML frontmatter in body.
- Metadata (`{ metadata: {...} }` third arg, all values stringified): `type`, `year: String(year ?? "0")` (0-sentinel for 7 articles with null year), `topic_primary: String(topics[0] ?? "")`, `rrm_relevance: String(rrmRelevance)` **from rrm-cli D1 knowledge.rrm_relevance — Airtable column is null, backfill into articles.json before first run**, `is_open_access: isOpenAccess ? "true" : "false"`.
- Skip logic: compute `content_hash`; if `D1.get(key).content_hash === new_hash`, skip (bump `last_seen_at`).
- Upload in batches of 10 via `Promise.all` (~3.3s/doc parallel). Store `{key, item_id, content_hash}` in D1 post-upload.
- Reconcile: find `ai_search_docs` rows where `last_seen_at < run_started_at` — these are orphans. Dry-run default; `--execute --max-delete 50` to actually call `instance.items.delete(item_id)` and `DELETE FROM ai_search_docs WHERE key = ?`.
- Run modes: `--full-rebuild` (on cache-miss deploys), `--single-record key=...` (dispatched from single-record CI).

**1d. CI wiring:**
- `fetch-all` continues to produce JSON. A new post-fetch step runs the loader before `astro build`.
- Pinned wrangler `>= 4.84.0` in `package.json` devDeps (ai_search_namespaces binding required).
- On push-only deploys (data unchanged), loader short-circuits because every hash matches.

### Phase 2 — Dedicated Worker `rrm-ai-search` + service binding (1-2 days)

New repo or subdirectory under rrm-academy-cf: `workers/rrm-ai-search/`.

**Worker `rrm-ai-search`:**
- `wrangler.toml` has the namespace binding:
  ```toml
  [[ai_search_namespaces]]
  binding = "ASK_KB"
  namespace = "rrm-academy-search"
  ```
- Exposes two endpoints, each accepts POST JSON from service binding callers:
  - `POST /ask` — `{ message: string, editorialPrompt: string }` → calls `env.ASK_KB.search({query:message, ai_search_options:{instance_ids:["rrm-academy-search-articles","rrm-academy-search-site"]}})`, then `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [...] })` with retrieved chunks as context. Returns `{ answer, citations, retrieved_chunks_count, retrieval_ms, generation_ms }`.
  - `POST /search` — `{ query: string, filters?: object, top_k?: number }` → hybrid retrieval only, returns the raw chunks mapped to `{url, title, snippet, score, type}` shape.
- Owns `AI_SEARCH_WORKER_AUTH` shared secret, checks it on every invocation.
- Logs AE `worker-events` dataset (hyphen variant, standalone Worker naming).

**Pages Functions changes (`functions/api/ask.js`, `functions/api/search/semantic.js`):**
- Add service binding in `wrangler.toml`:
  ```toml
  [[services]]
  binding = "AI_SEARCH"
  service = "rrm-ai-search"
  ```
- Dispatch the **coder agent** (mandatory for `functions/api/` edits). Brief:
  - Read siblings in `functions/api/` before writing (R6).
  - Add `AI_SEARCH` to env guards: `if (!env.AI_SEARCH) return json({ error: 'service_unavailable' }, 503)`.
  - Replace `fetch(NLWEB_SEARCH_URL)` in ask.js with `env.AI_SEARCH.fetch("https://internal/ask", {method:"POST", headers:{authorization:`Bearer ${env.AI_SEARCH_WORKER_AUTH}`}, body:JSON.stringify({message, editorialPrompt: SYSTEM_PROMPT})})`. Same try/catch, same 504-on-timeout, no err.message to client.
  - Similarly replace Vectorize embed+query in semantic.js with `env.AI_SEARCH.fetch("https://internal/search", ...)`.
  - Preserve `{ answer, citations }` shape (ask.astro untouched), `{ results }` shape (SearchBar untouched).
  - Preserve D1 `rrm-analytics` + AE logging identically.
- System prompt moves to `functions/api/_ask_prompt.js` so both Pages function AND the Worker import the same text (via worker bundler). Add to `guard-manifest.json`.

**KV-backed rollout flag (not env var, per arise-intel on deploy-propagation):**
- Key `feature:search_v2` in `COMMUNITY_KV`, values `"off"` / `"admin"` / `"all"`. `_middleware.js` reads it once per request and stamps `request.cf.data.searchV2` so downstream endpoints don't re-read.
- `"off"`: ask.js / semantic.js fall through to the legacy NLWeb / Vectorize path. `"admin"`: only users with `is_admin` get v2. `"all"`: everyone.
- Flip via admin endpoint — no deploy required. Survives Worker import crash because middleware is separate from the Pages function bundle.

### Phase 3 — Side-by-side eval (half day)

- Run `scripts/aeo-check.py` 25-query baseline against both v1 and v2, tag output.
- Run `test-guardrails.js` 31-query harness against v2. Compare to 87% v1 baseline.
- Manual smoke: 10 hand-picked queries including exact-string targets ("CA-125", "NaProTechnology", "recXXX lookups", "Hilgers protocol", "Creighton Model"), each tested on v1 and v2, citations compared.
- Deliverable: eval table in this doc under "Eval results". Go/no-go criteria:
  - AEO ≥ v1 baseline (6/25) — regress = no-go.
  - Guardrail ≥ 87% — regress = no-go.
  - Citation URL validity 100% (no 404s from v2 citations) — any broken URL = no-go.
  - P50 latency ≤ current; P95 ≤ 20s — breach = tune before rollout.

### Phase 4 — Feature-flag rollout

- Set KV `feature:search_v2 = "admin"` in `COMMUNITY_KV`. `_middleware.js` gates v2 only for `user.is_admin`.
- 24h observation: D1 `search_queries` source tagged `ask_v2` + `library_v2`, AE queries filtered by event.
- Health-based rollout check: 5xx rate < 2%, P95 < 1s retrieval + < 15s total, results-count median within 30% of v1. Any breach → flip flag back to `"off"`, investigate.
- Set KV `feature:search_v2 = "all"` for all authenticated users.
- 48h observation with same health checks.
- Remove the flag read + v1 code path; set KV to `"off"` permanently (record in memory that flag key is now unused).

### Phase 5 — Retire v1

- Delete `NLWEB_SEARCH_URL` secret from CF Pages.
- Decommission AutoRAG instance `rrm-academy-ask` (or leave it dormant — free during beta anyway, kept as escape hatch for 2 weeks).
- Remove 1Password item "NLWeb Search URL" after 30 days.
- Update memory `nlweb-ask-project.md` → rewrite as `ask-v2-project.md`.
- Update `CLAUDE.md` AI Search Instance row.

## Proof gates / acceptance

Every phase must satisfy:

- **P1 — Binding guards.** Pages Functions: `if (!env.AI_SEARCH) return json({ error: 'service_unavailable' }, 503)`. Worker: `if (!env.ASK_KB) return json({error:'service_unavailable'},503)`. No silent 200.
- **P2 — Fetch/try-catch.** Pages Function: `env.AI_SEARCH.fetch()` wrapped. Worker: both `.search()` and `.AI.run()` wrapped; upstream timeout preserved; no err.message leaked.
- **P3 — Response shape stable.** Returns `{ answer: string, citations: Array<{url, title?}> }`. ask.astro untouched. `/api/search/semantic` continues to return `{ results }`; SearchBar.astro untouched.
- **P4 — Logging parity.** Every v2 call writes to `rrm-analytics.search_queries` with `source='ask'` (unchanged) or `source='ask_v2'` during rollout, then back to `'ask'`. AE writeDataPoint preserved, not wrapped in waitUntil.
- **P5 — Editorial rules enforced.** System prompt imported from `_ask_prompt.js` (both Pages ask.js and the Worker bundle import the same file); grep for the IVF reframe phrase must return hits in both paths.
- **P6 — Rate limit preserved.** Same KV key pattern (`ask:rate:${user.id}:${utcDateKey()}`), same cap, same 48h TTL. Rate limit stays in Pages ask.js (before the service-binding call).
- **P7 — Guard manifest.** `_ask_prompt.js` + new Pages changes hash-registered via `npm run guard:update`.
- **P8 — arise-scan clean.** Run `arise-scan --json --files functions/api/ask.js functions/api/search/semantic.js functions/api/_ask_prompt.js workers/rrm-ai-search/src/index.js`; zero findings on silent-failure / unwrapped-await / error-leak rules.
- **P9 — Coder agent sibling check.** Agent reports sibling patterns matched in same directory for Pages Function edits.
- **P10 — E2E live check.** After cutover, real HTTP POST to `/api/ask` returns valid answer + ≥1 citation with reachable URL. Real GET to `/api/search/semantic?q=CA-125` returns the target article at rank 1.
- **P11 — D1 idempotency.** `ai_search_docs.item_id` is populated for every indexed `key`. Reconcile dry-run shows zero orphans immediately after a full-rebuild run.
- **P12 — Key-length fallback.** Any article with canonical slug > 140 chars has `ai_search_docs.full_slug` set and a truncated+hashed key. Spot-check 3 production records with long slugs post-rebuild.
- **P13 — Metadata type fidelity.** For a sample of 10 indexed docs, `item.metadata` returned by `search()` shows `year` as number, `is_open_access` as boolean, `type` and `topic_primary` as strings. Schema coercion verified end-to-end.

## Rollback

- **Pre-cutover:** flip KV `feature:search_v2` to `"off"`. Traffic reverts to v1 path on next request (~60s KV propagation). No deploy needed. Survives v2 Worker import crash because middleware gate is separate from the Worker bundle.
- **Post-cutover:** revert the commit that removed the v1 path; redeploy. `NLWEB_SEARCH_URL` secret stays in place for 2 weeks minimum after Phase 5 exactly for this reason. Vectorize index + embed-library-ci.mjs stays live for the same 2-week dormant window as a dual-escape hatch for /library.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| ~~`ai_search_namespaces` not supported in CF Pages Functions~~ | **Confirmed** | Dedicated `rrm-ai-search` Worker + service binding locked as the architecture. |
| Hybrid retrieval returns different result shape than expected | **Resolved** | Shape captured in Phase 0.5 Q2; destructure target locked. |
| Corpus upload exceeds beta-free tier | Low | 3,233 docs well under 100k ceiling; billing alarm on AI Search spend. |
| Cold-start latency higher than current | Medium | Monitor AE `duration_ms` by percentile. 28s timeout ceiling unchanged. Service-binding hop adds ~5-15ms. |
| Kimi/Llama drift from editorial rules under hybrid retrieval | Medium | Guardrail harness 87% must hold as go-gate in Phase 3. |
| Billing surprise post-beta | Low | CF has 30-day notice before billing. Budget alarm on Workers AI + AI Search spend. |
| Crawler instance enable wipes / shadows upload-instance items | Low | Two-instance design: crawler is a separate instance. First enable of `rrm-academy-search-site` will be tick-gated and watched. |
| Key length > 140 chars for some slugs | **Confirmed** | Loader truncates + appends sha8; D1 `full_slug` column preserves the original. |
| `rrm_relevance` column empty in Airtable | **Confirmed** | Backfill from rrm-cli D1 `knowledge.rrm_relevance` before Phase 1 day 1. Blocks Phase 1 start until done. |
| Whittaker.ai pattern assumption wrong | Low | Scoped out of this plan. Proved separately after v2 ships. |

## Open questions — all resolved in Phase 0 + 0.5 (see Spike Results section)

1. ~~Does `ai_search_namespaces` binding work inside CF Pages Functions, or Workers only?~~ — Workers only. Pivot locked.
2. ~~What's the actual result shape of `search()` — metadata fields returned, score, rank, chunk text?~~ — Captured. See Q2 section.
3. Does `uploadAndPoll()` accept markdown with frontmatter, or does it strip? Metadata goes via the third-argument object regardless?
4. Can we configure one instance with **both** programmatic upload **and** site crawl, or do they conflict?
5. Is there a first-party streaming response (SSE) on the binding, or is generation always caller-owned? (Probably caller-owned given the split architecture anyway.)

## Not doing (explicit)

- Not introducing CF Workers AI function calling / tools surface.
- Not adding conversation history or chat memory (ask.astro is single-turn by design).
- Not changing the 20/day limit to a paid tier override.
- Not streaming the answer (current `stream: false` stays).
- Not modifying the signup flow, welcome-ask email, or `signup_source` capture.

## Links

- CF blog: `blog.cloudflare.com/ai-search-agent-primitive/` (2026-04-16)
- Memory: `cf-ai-search-agent-primitive.md`
- v1 plan: `2026-04-16-nlweb-integration.md`
- Current code: `functions/api/ask.js`, `src/pages/ask.astro`
- Guardrail harness: `projects/neofertility-ie/scripts/test-guardrails.js` + RRM 31-query set
- AEO baseline: `projects/neofertility-ie/scripts/aeo-check.py` (currently 6/25 on /ask)

---

## Phase 0 + 0.5 Spike Results (2026-04-20)

**Scope of evidence base.** This section supersedes an earlier draft that drew conclusions from too few tests. A /arise --deep pass surfaced 25 findings against the first draft (4 CRITICAL, 6 HIGH, 11 MEDIUM, 4 LOW); the Phase 0.5 run resolved 24 of them with real data. Remaining gap is noted under "Still untested."

All experiments ran against namespace `ask-spike` in CF account `ecf2c5bc8b5ebd634bcb587b3890910a` with instances `spike-basic` (built-in storage + 4-field schema + hybrid enabled), `spike-realkey` (no schema, for key-charset tests), `spike-bd` (boolean/datetime schema), `spike-evo` (schema-evolution test), and `spike-crawler` (web-crawler type, never enabled). Harness at `~/iCode/scratch/ai-search-spike/worker/index.js` (Worker endpoints `/e1-reupload` through `/e13-schema-evolution` plus `/e1b`, `/e2b`, `/e3b` follow-ups). Wrangler 4.84.0. Token scoped to AI Search Write + Workers Scripts Write + Workers AI Write + Pages Write + Account Settings Read, IP-locked, auto-expires 2026-05-05.

**Overall verdict:** GO, with plan edits applied in this commit. The central premise of the rebuild -- hybrid BM25 fixes exact-term drift -- was verified directly against `"CA-125"`, `"recXXXABC123"`, and `"DHEA sulfate"` (all rank-1 retrieval). No killswitch. One architectural fork (dedicated Worker + service binding for Pages), one metadata-schema design change (topic_primary replacing empty `domain`/`rrm_relevance` fields that do not actually exist in the corpus), one operational requirement (D1 `ai_search_docs` table persists `key ↔ item_id` for delete by ID).

### Q1. Binding works in Pages Functions? -- **NO (verified via CF API, not just wrangler).**

Wrangler 4.84.0 rejects `ai_search_namespaces` in a Pages `wrangler.toml`:

```
Configuration file for Pages projects does not support "ai_search_namespaces"
```

This is NOT just a wrangler schema issue. The CF Pages REST API itself does not accept the binding key. Dump of `GET /accounts/{id}/pages/projects/rrm-academy` → `deployment_configs.production` keys: `[ai_bindings, analytics_engine_datasets, compatibility_date, compatibility_flags, d1_databases, env_vars, fail_open, kv_namespaces, r2_buckets, usage_model, vectorize_bindings]`. Attempted `PATCH` with `{"deployment_configs":{"production":{"ai_search_namespaces":{...}}}}` on a throwaway test project returned HTTP 200 but silently dropped the field from the stored config. Same for trying `ai_search` / `ai_search_instances` / `ai_search_bindings`. The Pages dashboard UI won't offer it either (UI is API-driven).

**Pivot (locked):** The new retrieval + generation layer lives in a standalone Worker `rrm-ai-search` bound into the `rrm-academy` Pages project via a service binding:

```toml
# rrm-academy/wrangler.toml (Pages project)
[[services]]
binding = "AI_SEARCH"
service = "rrm-ai-search"
```

Pages Functions call `context.env.AI_SEARCH.fetch(...)`. The Worker internally holds the `ai_search_namespaces` binding and owns the `search()` + `AI.run()` calls. Adds ~5-15ms intra-colo hop (well under 300ms budget). Same pattern applies to `/api/search/library` — both Pages functions proxy through the same Worker.

### Q2. Search result shape -- captured.

```jsonc
{
  "search_query": "CA-125",
  "chunks": [
    {
      "id": "<chunk-hash>",
      "type": "text",
      "score": 1,                     // RRF-fused, observed 0..1
      "text": "<chunk text; includes any YAML frontmatter verbatim if not stripped>",
      "item": {
        "key": "<exact key passed to uploadAndPoll>",
        "timestamp": 1776717900000,   // ms since epoch; does NOT advance on re-upload
        "metadata": { "type": "article", "year": 2024, "rrm_relevance": 5 }  // omitted entirely when empty
      },
      "scoring_details": {
        "vector_score": 0.4263,
        "keyword_score": 1.018,
        "vector_rank": 1,
        "keyword_rank": 1,
        "fusion_method": "rrf"
        // Note: reranker/summarization default OFF; reranking_score only present if reranking: true
      }
    }
  ],
  "hybrid_meta": {
    "search_methods": ["vector", "keyword"],
    "vector_result_count": 2,
    "keyword_result_count": 2
  }
}
```

**Destructure target for Phase 2:**

```js
const citations = r.chunks.map(c => ({
  url: c.item.key,                    // key IS the URL path — see locked scheme in Data-loading
  title: titleFromD1(parseRecId(c.item.key)),
  snippet: c.text,
  score: c.score,
  type: c.item.metadata?.type,
}));
```

**Caveats captured from experiments:**
- Chunk `text` includes YAML frontmatter verbatim if you upload it. Phase 1 loader strips frontmatter.
- `item.metadata` is `undefined` (not `null` / `{}`) for docs with no custom metadata.
- `scoring_details.reranking_score` is absent when the instance has `reranking: false` (default). If we enable reranker in a later phase, expect extra fields — re-verify shape then.
- `hybrid_meta.search_methods` tells you which half of the hybrid actually contributed. On some queries only vector runs (query doesn't tokenize to anything the BM25 index has); on others only keyword. Both empty → zero results.

### Q3. Metadata via `uploadAndPoll(filename, content, options)` -- confirmed empirically.

**Shape:** third arg is `{ metadata: {...} }`. All values MUST be strings at the SDK level, regardless of declared schema type. Verified directly:

| Input | Result |
|-------|--------|
| `{ metadata: { year: 2024 } }` (numeric) before schema declared | `invalid_metadata_format` |
| `{ metadata: { year: 2024 } }` (numeric) **after** `data_type:number` schema declared | still `invalid_metadata_format` |
| `{ metadata: { year: "2024" } }` (string) after schema declared | uploads, returned as `"year": 2024` (server coerced) |
| `{ topics: ["a", "b"] }` (array) | `invalid_metadata_format` (no array data_type) |
| `{ metadata: { is_oa: true } }` (real boolean) | `invalid_metadata_format` |
| `{ metadata: { is_oa: "true" } }` (boolean as string) | uploads, returned as `"is_oa": true` |
| `{ metadata: { published_at: "2024-01-15T00:00:00Z" } }` (ISO-8601 string) | uploads, returned as `1705276800000` (unix ms) |
| `{ metadata: { published_at: "1705276800" } }` (unix-seconds string) | uploads, returned as `1705276800` (seconds preserved) |
| `{ metadata: { published_at: 1705276800 } }` (raw number) | `invalid_metadata_format` |
| Markdown with YAML frontmatter only, no third arg | uploads, no custom metadata attached |

**Rules for Phase 1 loader (locked):**
1. PUT the `custom_metadata` schema on the instance BEFORE first upload.
   ```
   PUT /accounts/{acct}/ai-search/namespaces/{ns}/instances/{id}
   { "custom_metadata": [
       {"field_name":"type","data_type":"text"},
       {"field_name":"year","data_type":"number"},
       {"field_name":"topic_primary","data_type":"text"},
       {"field_name":"rrm_relevance","data_type":"number"},
       {"field_name":"is_open_access","data_type":"boolean"}
   ]}
   ```
   Use `field_name` / `data_type` (REST API shape), NOT `name` / `type`. Schema expansion verified safe: added a 3rd field to a 2-field schema, prior uploads retained their metadata unchanged. So we can add a 6th field later by replacing a less-useful one — though we're already at the 5-field cap.
2. All `metadata:` values are strings. The loader does `String(year)`, `String(rrm_relevance)`, `is_open_access ? "true" : "false"`.
3. Strip YAML frontmatter from markdown body (`gray-matter`) before upload. Store the parsed fields in the `metadata:` object, not in the body.
4. Datetime fields (if added later): prefer ISO-8601 strings; server converts to unix ms. Do not mix ISO and unix-seconds formats in one schema — the server preserves the incoming form, which causes cross-doc comparison drift.

### Q4. Filter semantics -- confirmed, earlier "$gte variance" was a phantom.

Envelope: `{ ai_search_options: { retrieval: { filters: {...} } } }`. Operators: `$eq` (also implicit), `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`. Multiple conditions at the top level are implicit AND.

**Determinism check:** ran `{ year: {"$gte": 2024} }` against `"endometriosis fertility thyroid"` five times back-to-back. All five returned IDENTICAL key sets `[doc-article-1.md, e8-exact-terms.md, v-opts_string_vals.md]`. The earlier draft's "`$gte` mixed results" flag was an artifact of comparing two different spike tests with different queries (and different active search modes) — not real non-determinism. Striking that hazard from the plan.

**Missing-field behavior (verified on spike-basic, which contains docs both with and without the filtered field):**

| Operator | Doc missing the filtered field |
|----------|--------------------------------|
| `type: "article"` (implicit eq) | excluded ✓ |
| `type: {"$eq": "article"}` | excluded ✓ |
| `type: {"$in": ["faq","post"]}` | excluded ✓ |
| `type: {"$ne": "post"}` | **INCLUDED** (missing ≠ post) |
| `type: {"$nin": ["post"]}` | **INCLUDED** |
| `year: {"$gte": 2024}` | excluded (deterministic) |

**Phase 7 facet rule (simplified):** prefer `$eq` and `$in` for faceted UI filters. `$ne` / `$nin` include missing-field docs — use them intentionally or pair with a presence guard (e.g. `{"type":{"$in":["article"]}, "topic_primary":{"$ne":"excluded"}}`).

**Unknown / experimental operators (all tested):**

| Filter | Result |
|--------|--------|
| `{ "$or": [{type:"article"}, {type:"faq"}] }` (top-level) | **hard fail** — `Invalid input` |
| `{ type: {"$or": ["article","faq"]} }` (at-field) | returns 0 results silently |
| `{ type: {"$regex": "art"} }` | returns 0 results silently |
| `{ type: {"$exists": true} }` | returns 0 results silently |
| `{ type: {} }` (empty operator object) | returns 0 results silently |
| `{ foo_bar_nonexistent: "anything" }` (undeclared field) | returns 0 results silently |
| `{ folder: "" }` (built-in metadata field) | works, filters on built-in folder |

**Important:** silent-zero-result on invalid filters is a testability hazard. Phase 7 facet UI code should reject unknown operators client-side before sending, else users see a blank list with no error.

### Q5. One instance fed by both uploadAndPoll + site-crawl? -- **VERDICT CHANGED: provision two instances instead.**

Upload path does work on a crawler-typed instance (`source_id: "builtin"` on the uploaded doc), but the crawler was never run in the spike (enable requires ownership verification and can't be safely tested without touching rrmacademy.org DNS). Two unknowns remain:
1. Does enabling the crawler wipe / interleave / shadow-duplicate builtin items?
2. Is the ownership verification re-checked on every crawl tick, or just at enable time?

Rather than leave Phase 1 exposed to either unknown, **the locked plan provisions two instances**:
- `rrm-academy-search-articles` — built-in storage, hybrid, 5-field schema. Uploaded corpus (articles + posts + FAQs + glossary + pillars).
- `rrm-academy-search-site` — web-crawler type, source `rrmacademy.org`. Crawled pages only, no custom schema.

Query time: `env.ASK_KB.search({ query, ai_search_options: { instance_ids: ["rrm-academy-search-articles", "rrm-academy-search-site"] } })`. Cross-instance search is a documented primitive and surfaces a unified ranked list. Cost: two instances count against the 5,000-instance account cap (fine — we have 4,998 remaining). Benefit: clean separation, no immutability traps, no upload-path conflict if the crawler changes behavior.

**Instance `type` / `source` are immutable after creation** — a `PUT` with `{type:...,source:...}` on an existing instance returns HTTP 200 but silently ignores the field change (verified). Two-instance design avoids this constraint entirely.

### Q8. Exact-term match (the rebuild's central premise) -- VERIFIED.

Uploaded a doc containing the literal strings `"CA-125"`, `"NaProTechnology"`, `"recXXXABC123"`, `"DHEA sulfate"`. Queried each:

| Query | Rank on target doc | keyword_score | vector_score | Methods |
|-------|---------------------|--------------:|-------------:|---------|
| `CA-125` | **1** | 1.018 | 0.4263 | vector + keyword |
| `CA 125` (no hyphen) | **1** | 3.054 | 0.4430 | vector + keyword |
| `ca-125` (lowercase) | **1** | 1.018 | 0.4263 | vector + keyword |
| `NaProTechnology` (camelcase) | **3** | 0.604 | -- | vector + keyword |
| `napro technology` (space-separated) | **not found** | -- | -- | vector only |
| `recXXXABC123` | **2** | 1.018 | -- | vector + keyword |
| `DHEA sulfate` | **1** | 3.054 | 0.5018 | vector + keyword |

**Take:** BM25 exact-term match works, AND the tokenizer is smart about hyphens and case (both `CA-125` and `CA 125` and `ca-125` hit rank 1). BUT `"NaProTechnology"` (camelcase, no separator) does NOT match `"napro technology"` (space-separated). Tokenizer only splits on whitespace + punctuation — it does not decamelcase. Phase 1 loader mitigates by normalizing in body prose: write both `NaProTechnology (NaPro technology)` so either form hits.

### Q: Re-upload and delete semantics (new coverage — was CRITICAL gap in the first draft)

**Re-upload (same key, different content):**
- Same `key` always returns the same `item_id` across uploads (upsert by key).
- Content DOES replace — second upload's body appears in search, first upload's body is gone. Verified with uniquely-tokened content `"alpha bravo"` (v1) and `"delta echo foxtrot"` (v2): after replacement, only `"delta echo"` text appears in search chunks.
- `item.timestamp` does NOT advance on re-upload (stays at first upload time). Do NOT use `item.timestamp` as a "last modified" signal. Track hash + last-updated in D1 `ai_search_docs` externally.

**Delete:**
- Method is `instance.items.delete(item_id)` — takes **item_id**, not key. `instance.items.delete(key)` returns `AiSearchNotFoundError: item_not_found`.
- Works, returns empty 200. Search immediately excludes the item.
- **Phase 1 must persist `key → item_id` in D1 `ai_search_docs`** at upload time so the reconcile pass can delete by ID.

**Items prototype introspection:** `Object.getOwnPropertyNames(Object.getPrototypeOf(instance.items))` returns only `[then, catch, finally, constructor]` because `items` is a Promise-like RPC proxy. Available methods discovered by trial: `uploadAndPoll`, `list`, `delete`. `remove`, `destroy`, `del` all return `"The RPC receiver does not implement the method"`.

### Q: Key charset / length (new coverage)

All real-corpus key patterns tested against `spike-realkey` with the critical `.md` extension:

| Key | Length | Result |
|-----|-------:|--------|
| `/library/short-slug-rec123.md` | 29 | OK |
| `/library/using-anti-müllerian-hormone-…-recABC123.md` | 93 | OK (unicode preserved) |
| `/library/od-eugeniki-do-procedury-zapłodnienia-in-vitro-recDEF456.md` | 68 | OK |
| `/library/test-with-parens-(2024)-recGHI789.md` | 45 | OK |
| `/library/aaa…-recLONG1.md` | 121 | OK |
| `/library/aaa…-recLONG2.md` | 171 | `filename_exceeds_maximum_length` |
| `/library/aaa…-recLONG3.md` | 221 | fails |
| `/library/aaa…-recLONG4.md` | 271 | fails |

- **`.md` extension is REQUIRED** — without it, uploads fail with `unable_to_determine_file_content_type` (verified; server sniffs extension for MIME).
- **Max key length ≈ 150 chars** (121 works, 171 fails; exact cutoff not bisected). Production corpus has 87 slugs > 100 chars; subset over 140 needs a shorter scheme. **Phase 1 fallback:** if `key.length > 140`, truncate slug and append a content hash: `/library/<slug-truncated-to-120>-<recid>-<sha8>.md`. Store the full slug in D1 so citation URLs reconstruct correctly.
- **Unicode round-trips exactly.** `ü`, `ł`, diacritics preserved byte-for-byte in `item.key`.
- **Slashes, parens, hyphens all OK.** Key charset is permissive as long as the extension is present.

### Q: Concurrency and throughput (new coverage)

`Promise.all` of 10 `uploadAndPoll` calls → all succeed. 10 docs in 33.4 seconds wall-clock, i.e. 3.3s per doc parallel vs ~5s per doc serial. Sub-linear speedup but real. Extrapolated: 3,400 docs at 10-way concurrency → ~19 minutes for full rebuild. Single-doc deploys (delta path) are <5s each. Good enough for both CI full rebuild and per-article single-record dispatch.

No rate-limit errors observed. Higher concurrency untested.

### Instance config notes (locked defaults for production instances)

Creation POST body for each production instance:

```json
{
  "id": "rrm-academy-search-articles",
  "hybrid_search_enabled": true
}
```

Then the `PUT /custom_metadata` call with the 5-field schema. Defaults we accept as-is: embedding_model `@cf/qwen/qwen3-embedding-0.6b`, chunk_size 1024, chunk_overlap 10, score_threshold 0.4, max_num_results 10, fusion_method `rrf`, keyword_tokenizer `porter`, keyword_match_mode `and`. `reranking` / `rewrite_query` / `summarization` stay off for v2 launch (each one adds a CF AI call per query).

### Wrangler version gate

Wrangler 4.84.0 confirmed working. 4.62.0 confirmed broken (silently drops the binding with an "Unexpected fields found in top-level field" warning at deploy; runtime `env.ASK_KB` is undefined). Intermediate versions 4.63-4.83 untested — 4.84 is a known-good floor, not a proven minimum. CI pin: `>= 4.84.0` until bisected otherwise.

### Still untested (out of scope for Phase 0.5, documented for Phase 1+ work)

- **Crawler actually running.** Two-instance design avoids this being a blocker, but the `rrm-academy-search-site` instance will need its first enable to be watched carefully.
- **Reranker / summarization.** Both default off. If enabled later, re-verify result shape.
- **Higher concurrency.** 10-way works cleanly; 50-way / 100-way may hit an undocumented rate limit.
- **Schema shrinking.** Verified schema can be EXPANDED non-destructively. Not verified whether removing a field via PUT also works.
- **search() with `messages: [...]`.** Phase 2's split architecture uses `search({query:string})` only — multi-turn message input untested.
- **Mutating instance `type` via PATCH or a full-config-echo PUT.** Declared immutable based on partial-PUT behavior; not disproven but also not necessary for current plan.

### What this means for the plan

- **Phase 1 (corpus loader):** GREEN. Spec updated in "Data-loading strategy". Add to the loader: PUT schema first, stringify all metadata, `key = URL path` with `.md` + length fallback, strip frontmatter, persist `key ↔ item_id ↔ content_hash` in D1, 10-way parallel upload, poll `status: completed` before treating a doc as live.
- **Phase 2 (new endpoint):** PIVOT LOCKED. Build standalone Worker `rrm-ai-search` with the namespace binding; bind it into rrm-academy Pages via `[[services]]`. Pages Functions (ask.js, semantic.js) call it. Coder agent dispatch + sibling-match applies.
- **Phase 3 (eval):** GREEN. The guardrail harness (31 queries, 87% go-gate) holds; $gte determinism finding means flakiness risk drops.
- **Phase 4 (rollout):** GREEN. KV-flag + service-binding-proxy rollout unchanged.
- **Phase 7 (facets):** GREEN with simplified rule. Use `$eq` / `$in`. `$ne` / `$nin` include missing-field docs (use intentionally). Invalid operators silently return empty — client-side validation required.

### Spike cleanup

- Namespace `ask-spike` → delete after any follow-up experiments. Contains 5 instances, ~40 test docs.
- Worker `ai-search-spike-worker.administrator-cloudflare.workers.dev` → delete with `wrangler delete` when done.
- Temporary CF token `ai-search-spike-2026-04-20-v2` → auto-expires 2026-05-05, or revoke via One-Punch-Man-Token earlier.
- Scratch dir `~/iCode/scratch/ai-search-spike/` → keep for re-running scenarios; referenced from this plan.

