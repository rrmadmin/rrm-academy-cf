# Orank agent-readiness gap sweep

**Date:** 2026-05-21
**Trigger:** ora.ai scan of rrmacademy.org returned 78/100 (B), with 11 pts of Agent Integration gaps.
**Target:** 89/100 (A−).

## Current state (2026-05-21)

orank scan, layer breakdown:

| Layer | Score |
|---|---|
| Discovery | 15/41 |
| Identity | 76/88 |
| Auth & Access | 52/53 |
| Agent Integration | 47/63 |
| User Experience | 10/11 |
| **Total** | **78/100** |

Agent Integration gaps (the only layer this spec addresses):

| Gap | Pts | Classification |
|---|---|---|
| Webhook signature verification | 2 | Real — document inbound Stripe signing |
| RFC 9598 rate-limit headers | 2 | Real — `Retry-After` already on 429 in semantic search; missing canonical `RateLimit-*` |
| Multi-surface MCP coverage | 2 | Real but stretches scope — needs distinct second surface, not duplicate |
| Sandbox / test environment | 2 | Marginal — `?mode=sandbox` query param on `/api/ask` is the cheap legit version |
| Batch / bulk endpoint | 2 | Real — `/api/articles?ids=` |
| Function calling compat | 1 | Real — `list_articles` 200 schema is bare `object`, `health_check` is bare `string` |

Discovery (15/41) is the bigger structural deficit but out of scope here — orank weighting around AI search visibility / search engine presence, separate concern.

## Decisions

1. **All 6 fixes shipped, two waves.** Brian opted for the full A− target on 2026-05-21.
2. **Second MCP is the existing `rrm-library-worker`, not a new project.** Adding MCP JSON-RPC transport on top of `library.rrmacademy.org` gives a logically distinct surface (low-level CRUD over the library) versus `mcp.rrmacademy.org` (high-level RAG). Score-gaming would be a duplicate of the main MCP at a second URL; this avoids that.
3. **Wave 1 (this spec):** Fixes 1, 2, 4, 5, 6 + sandbox — single PR in `rrm-academy-cf`.
4. **Wave 2:** Second MCP surface — PR in `rrm-library-worker` + small companion PR in `rrm-academy-cf` to update discovery manifests.
5. **Webhook documentation, not code.** Stripe webhook handler at `functions/api/stripe-webhook.js` already verifies `stripe-signature`. Gap is the OpenAPI declaration; OpenAPI 3.1 supports a top-level `webhooks:` block for declaring incoming events.

## Wave 1 — files touched

### `public/openapi.json`

Schemas added to `components.schemas`:
- `ArticleList` — typed shape of `/api/articles` 200 response (results: ArticleSummary[], total, page, limit, has_more)
- `ArticleSummary` — single library article shape
- `HealthStatus` — typed shape of `/health` 200 response
- `StripeWebhookEvent` — minimal shape of Stripe event we accept
- `RateLimitHeaders` — reusable `$ref` for the three RFC 9598 headers (Limit/Remaining/Reset)
- `SandboxAskResponse` — typed shape of canned `?mode=sandbox` reply

Top-level additions:
- `webhooks:` block declaring inbound `stripeCheckoutCompleted` and `stripeSubscriptionUpdated` with `Stripe-Signature` HMAC verification described under `parameters` and `description`.

Operation-level changes:
- `/api/ask` POST: add `?mode` query param doc, add `headers:` block with three `RateLimit-*` keys on 200, 429.
- `/api/articles` GET: add `?ids` query param (comma-separated, max 50), add `headers:` block with `RateLimit-*` on 200, 429. Replace bare `object` response with `$ref: ArticleList`.
- `/health` GET: replace bare `string` response with `$ref: HealthStatus`.
- `/mcp` POST: add `headers:` block with `RateLimit-*` on 200, 429.

### `functions/api/_ratelimit-headers.js` (new)

Pure helper. Given `(env, key, max, windowS)`, reads the current bucket from `COMMUNITY_KV` *without* consuming a slot and returns an object `{ 'RateLimit-Limit': '...', 'RateLimit-Remaining': '...', 'RateLimit-Reset': '...' }` per RFC 9598 (the bare names, not `X-RateLimit-*`).

Returns an empty object on KV read failure rather than throwing — headers are optional metadata, never a hard requirement.

### `functions/api/articles.js`

- Wire `_ratelimit-headers.js` into the 200 and 429 responses.
- Add `?ids` handling: when present, validate comma-separated list (≤50 entries, each `/^[a-z0-9-]+$/i`), dedupe preserving first occurrence. Fan-out to `rrm-library-worker /article/{id}` (which exists) using `Promise.allSettled`. Each successful result mapped to the same `ArticleSummary` shape as the paginated response. Missing IDs returned in `not_found[]`. Cap fan-out concurrency at 10 in case worker upstream slows.

### `functions/api/ask.js` + handlers

- Wire `_ratelimit-headers.js` into the JSON + SSE 200 responses.
- Add `?mode=sandbox` short-circuit BEFORE the rate-limit check. Returns canned response (fixed text + 2 fake citations from `/llms.txt`). Sets header `X-Sandbox: true`. Skips both the upstream call and the search log so observability stays clean.

### `functions/mcp/index.js`

- Wire `_ratelimit-headers.js` into the JSON-RPC 200/429 responses. If the `/mcp` proxy currently no-ops on rate limiting, document that and emit headers reflecting "no limit" (`RateLimit-Limit: 100, RateLimit-Remaining: 100, RateLimit-Reset: 60`) so agents still get a self-throttle signal.

## Gates

- `npm run guard:agent-discovery` (42 invariants — article-count canon, OAuth flow consistency, SHA256 digests)
- Pre-commit chain: `lint-secrets`, `arise-scan-precommit`, `lint-cf-headers`
- CI Build & Deploy
- No `npm run guard:agent-skills:regen` needed (no SKILL.md touched)

## Verification (post-deploy)

```bash
# Rate-limit headers present
curl -sI https://rrmacademy.org/api/articles | grep -i ratelimit
curl -sI https://rrmacademy.org/api/ask | grep -i ratelimit

# Batch endpoint
curl -s 'https://rrmacademy.org/api/articles?ids=art-001,art-002' | jq '.results | length'

# Sandbox
curl -s 'https://rrmacademy.org/api/ask?mode=sandbox' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"message":"sandbox test"}'

# Rescan
curl -s -X POST https://ora.ai/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url":"rrmacademy.org"}' | jq '.score'
```

## Revert

Single PR per wave. `git revert <merge-sha>` on either wave is safe — no schema migrations, no state, no consumer dependencies that ratchet.

## Wave 2 outline (separate spec/plan)

- `rrm-library-worker` gets `/mcp` JSON-RPC handler. Tools: `library_status` (read-only stats), `library_search_full` (return full-text where R2-cached), `library_get_article` (by id/slug/pmid/doi).
- `rrm-academy-cf` updates `.well-known/mcp.json` + `agent-card.json` to declare both surfaces and `openapi.json` `servers:` to list `library.rrmacademy.org` alongside `mcp.rrmacademy.org`.
- `scripts/agent-discovery-check.mjs` may need a new invariant for "≥2 MCP surfaces declared." Audit during Wave 2.
