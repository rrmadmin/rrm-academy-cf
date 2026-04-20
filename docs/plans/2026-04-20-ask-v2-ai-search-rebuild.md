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

Two sources into a single namespace instance:

1. **Programmatic upload (primary)** — For every published library article, upload a derived markdown doc:
   ```
   title, authors, year, domain, rrm_relevance, abstract, URL
   + body if fulltext linked
   ```
   Metadata fields on each upload: `type=article`, `year`, `rrm_relevance`, `domain`, `status=published`. Enables `boost_by: [{ field: "rrm_relevance", direction: "desc" }]` and `{ field: "year", direction: "desc" }` at query time. Re-runs on every full deploy (not every push — too expensive). Use `uploadAndPoll()` batches, resume-safe by content hash stored alongside in D1 `ai_search_docs` table.

2. **Site crawl (secondary)** — Let the namespace also crawl rrmacademy.org for pages we don't load programmatically (commentary, FAQs, pillar guides, glossary). Same site-crawl toggle the old AutoRAG used.

Corpus size target: ~3,200 articles + ~20 FAQs + ~132 glossary terms + ~48 commentary posts + ~7 pillar pages ≈ 3,400 docs. Well within the 500k-file hybrid ceiling.

## Model choice

| Model | Pros | Cons |
|-------|------|------|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (current) | Known-good, stable on RRM content, generous context | No tool-calling surface, older |
| `@cf/moonshotai/kimi-k2.5` (what agentic-inbox uses) | Newer, fast, good for structured output | Less tested on RRM editorial prompt |

**Recommendation:** keep Llama 3.3 70B for v2 launch. Swap later only if guardrail harness shows Kimi matches or exceeds Llama on the RRM 31-query harness. Model swap is a one-line change post-split.

## Implementation phases

### Phase 0 — Spike (1-2 hours, no user impact)

- Create throwaway namespace `ask-spike` in the CF dashboard.
- Verify `ai_search_namespaces` binding works inside a CF Pages Function (not just a standalone Worker). If Pages Functions don't support it yet, the whole plan stops and we pivot to a dedicated Worker with service binding.
- Run `uploadAndPoll()` against 3 sample docs. Query with `search()`. Confirm the result shape, citation fields, and metadata boost behavior.
- Deliverable: one-paragraph finding in this doc under "Spike results".

### Phase 1 — Corpus loader script (1 day)

- `scripts/ask-corpus-upload.mjs` — standalone Node script.
- Reads `src/data/articles.json`, filters `status === 'published'`, emits a derived markdown per article with frontmatter metadata.
- Reads hash log from D1 `ai_search_docs` table (new), skips unchanged docs.
- Uses `@cloudflare/ai` client or raw REST `uploadAndPoll` endpoint with account API token.
- Logs progress + writes hash + namespace doc_id into D1 for idempotency.
- Manual run first; later hooked into `deploy.yml` after green deploys.

### Phase 2 — New endpoint `/api/ask` v2 (behind flag)

- Dispatch the **coder agent** (mandatory for `functions/api/` edits per project rules). Brief includes:
  - Read siblings in `functions/api/` before writing (R6).
  - Preserve the 503-on-missing-binding, try/catch-around-fetch, `{ answer, citations }` contract, no err.message to client.
  - Use `context.env.ASK_KB` binding for search.
  - Use `context.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', ...)` for generation.
  - Inject retrieved chunks into the user turn before the model call.
  - Preserve D1 `rrm-analytics` logging + AE `worker_events` logging identically.
  - Flag `ASK_V2_ENABLED` (env var): when falsy, fall through to current NLWeb path; when truthy, use the new path.
- System prompt moves to `functions/api/_ask_prompt.js` so it's imported, not duplicated.
- Add `scripts/guard.mjs` entry for the new shared prompt file (editorial rules are security-adjacent — protect against silent tampering).

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

- Flip `ASK_V2_ENABLED=true` for admin user(s) only (gate on `user.is_admin` inside ask.js).
- 24h observation: D1 `search_queries` source tagged `ask_v2`, AE queries filtered by event.
- Flip to all authenticated users.
- 48h observation.
- Remove the flag and the v1 code path.

### Phase 5 — Retire v1

- Delete `NLWEB_SEARCH_URL` secret from CF Pages.
- Decommission AutoRAG instance `rrm-academy-ask` (or leave it dormant — free during beta anyway, kept as escape hatch for 2 weeks).
- Remove 1Password item "NLWeb Search URL" after 30 days.
- Update memory `nlweb-ask-project.md` → rewrite as `ask-v2-project.md`.
- Update `CLAUDE.md` AI Search Instance row.

## Proof gates / acceptance

Every phase must satisfy:

- **P1 — Binding guard.** `if (!env.ASK_KB) return json({ error: 'service_unavailable' }, 503);` present. No silent 200.
- **P2 — Fetch/try-catch.** Both `.search()` and `.AI.run()` wrapped; upstream timeout preserved; no err.message leaked.
- **P3 — Response shape stable.** Returns `{ answer: string, citations: Array<{url, title?}> }`. ask.astro untouched.
- **P4 — Logging parity.** Every v2 call writes to `rrm-analytics.search_queries` with `source='ask'` (unchanged) or `source='ask_v2'` during rollout, then back to `'ask'`. AE writeDataPoint preserved, not wrapped in waitUntil.
- **P5 — Editorial rules enforced.** System prompt imported from `_ask_prompt.js`; grep for the IVF reframe phrase must return hits in both v2 code paths.
- **P6 — Rate limit preserved.** Same KV key pattern (`ask:rate:${user.id}:${utcDateKey()}`), same cap, same 48h TTL.
- **P7 — Guard manifest.** `_ask_prompt.js` hash-registered via `npm run guard:update`.
- **P8 — arise-scan clean.** Run `arise-scan --json --files functions/api/ask.js functions/api/_ask_prompt.js`; zero findings on silent-failure / unwrapped-await / error-leak rules.
- **P9 — Coder agent sibling check.** Agent reports sibling patterns matched in same directory.
- **P10 — E2E live check.** After cutover, real HTTP POST to `/api/ask` returns valid answer + ≥1 citation with reachable URL.

## Rollback

- **Pre-cutover:** flip `ASK_V2_ENABLED=false`. Traffic reverts to v1 path on next request. No deploy needed.
- **Post-cutover:** revert the commit that removed the v1 path; redeploy. `NLWEB_SEARCH_URL` secret stays in place for 2 weeks minimum after Phase 5 exactly for this reason.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `ai_search_namespaces` not supported in CF Pages Functions | Medium | Phase 0 spike. Fallback: dedicated Worker with service binding from Pages. |
| Hybrid retrieval returns different result shape than expected | Low | Phase 0 verifies result shape. Citation extractor is deterministic. |
| Corpus upload exceeds free tier during spike | Low | 3,400 docs well under 100k free-tier ceiling; beta pricing = free. |
| Cold-start latency higher than current | Medium | Monitor AE duration_ms by percentile. 28s timeout ceiling unchanged. |
| Kimi/Llama drift from editorial rules under hybrid retrieval | Medium | Guardrail harness 87% must hold as go-gate in Phase 3. |
| Billing surprise post-beta | Low | CF has 30-day notice before billing. Budget alarm on Workers AI spend. |
| Whittaker.ai pattern assumption wrong | Low | Scoped out of this plan. Proved separately after v2 ships. |

## Open questions (resolve during Phase 0)

1. Does `ai_search_namespaces` binding work inside CF Pages Functions, or Workers only?
2. What's the actual result shape of `search()` — metadata fields returned, score, rank, chunk text?
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
