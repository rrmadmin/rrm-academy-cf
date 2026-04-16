# NLWeb Integration -- RRM Academy

**Date:** 2026-04-16
**Status:** Proposed
**Goal:** Ship `/ask` conversational AI layer on rrmacademy.org, gated behind free account signup, using Cloudflare AI Search + NLWeb Worker template + Workers AI.

## Locked decisions

| Decision | Choice |
|----------|--------|
| LLM backing | Workers AI (cheapest model that passes eval) |
| Data source | CF AI Search crawler, Rendered Sites option |
| Placement | Dedicated `/ask` page only (no homepage widget, no library replacement) |
| Auth | Gated behind free account signup; reuse existing RRM Academy auth |
| Library search | UNCHANGED. NLWeb is a sibling, not a replacement. Library search stays as the researcher tool |
| Timeline | Quick release. Skip fork/customization for v1 |

## Architecture

```
User -> rrmacademy.org/ask (Astro page, auth-gated)
     -> Chat UI POSTs /api/ask (CF Pages Function)
     -> /api/ask: validate session, rate-limit (KV), log (AE)
     -> Proxies to AI Search public /chat/completions
        (OpenAI-compatible; AI Search handles retrieval + Workers AI)
     -> Answer + citations returned to /api/ask
     -> UI renders answer + cited library links
```

Single origin for users. Auth + rate limit + logging centralized in `/api/ask`. **ADR (2026-04-16):** skipped the NLWeb Worker intermediate for v1. AI Search's managed public endpoint already exposes an OpenAI-compatible `/chat/completions` that handles retrieval + LLM synthesis end-to-end. A NLWeb Worker layer adds a second Worker to operate, requires a compat_date bump on the production Pages project (current is `2025-01-01`; `ai_search` binding needs `>=2026-03-27`), and offers no v1 feature we need. Authorized-hosts + our `/api/ask` auth gate cover access control without a shared secret. If later phases need prompt customization, D1 feed, or MCP exposure, the Worker hop can be added without touching the UI.

## Workstreams

### WS1 -- CF AI Search instance + secret provisioning (COMPLETE 2026-04-16)
- [x] Create AI Search instance in CF dashboard, data source = Website
- [x] URL: `https://rrmacademy.org`, Rendered Sites crawler enabled
- [x] Exclusions in crawler:
  - `/account/*`, `/admin/*`, `/dev/*`
  - `/login`, `/signup`, `/forgot-password`, `/reset-password`
  - `/donate/thank-you`
  - `/courses/*/*/*` (lesson steps, already noindex)
  - `/api/*`
- [x] Enable Public URL; authorized hosts = `rrmacademy.org`, `www.rrmacademy.org`; rate limit = 120 req/60s
- [x] Public endpoints live:
  - `https://383a8638-22b4-46c2-823d-1d42dbcb2bf3.search.ai.cloudflare.com/chat/completions` (OpenAI-compatible)
  - `/search` (raw retrieval) and `/mcp` (agent) also enabled
- [x] **Secret storage:**
  - 1Password Automation vault, item `NLWeb Search URL` (field: `credential`) = base URL
  - CF Pages secret `NLWEB_SEARCH_URL` bound to `rrm-academy` project
- [x] Initial crawl running (33 indexed, ~3270 queued at WS1 completion)
- ~~Hit NLWeb Worker `/ask` with shared secret~~ N/A -- no NLWeb Worker in v1 architecture

### WS2 -- `/api/ask` proxy endpoint (2-3 hrs) -- MANDATORY `coder` agent
- [ ] Create `functions/api/ask.js` (coder agent reads all sibling endpoints in `functions/api/` first per CLAUDE.md)
- [ ] Method gate: POST only; OPTIONS for CORS preflight
- [ ] Auth check: valid session required via `requireUser` / middleware (`context.data.user`); 401 if unauth
- [ ] Blocked user check (R1): `if (user.blocked) return 403`
- [ ] Rate limit via `COMMUNITY_KV`: key `ask:rate:{userId}:{YYYY-MM-DD}`, 20/day, TTL ~48h. 429 at cap
- [ ] Input validation: JSON body, `message` string, trim, max 500 chars, min 2 chars; type check; reject non-object body
- [ ] Read `env.NLWEB_SEARCH_URL` (503 with `{error:'service_unavailable'}` if missing -- no silent success)
- [ ] POST to `${NLWEB_SEARCH_URL}/chat/completions` with JSON body `{ messages: [{role:'user', content: message}], stream: false }`. Wrap in try/catch; 15s AbortSignal.timeout
- [ ] Response shape: `{ answer: string, citations: Array<{title,url}> }` on success; `{ error: 'code' }` with correct HTTP status on failure. Never leak `err.message`
- [ ] AE logging via `env.EVENTS.writeDataPoint({ blobs: ['rrm-academy','ask','query', String(status), sha256(message).slice(0,16), sha256(userId).slice(0,16)], doubles: [durationMs, 1, status], indexes: ['ask'] })`. **Never** wrap in `waitUntil()` -- `writeDataPoint()` returns void synchronously (see CLAUDE.md AE gotcha)
- [ ] CORS: import `CORS_HEADERS` from `functions/api/auth/_shared.js`; apply to all responses including errors
- [ ] **After code ready:** run `npm run guard:update` to regenerate `guard-manifest.json` with the new `ask.js` hash; stage `guard-manifest.json` by name in the same commit

### WS3 -- `/ask` Astro page (3-4 hrs)
- [ ] Create `src/pages/ask.astro`
- [ ] Auth gate in `functions/_middleware.js`: unauth -> redirect to `/signup?next=/ask`
- [ ] Minimal chat UI:
  - Session-scoped history (no persistence v1)
  - Input, submit-on-enter
  - "Asking..." loading state
  - Answer card with source citations as links
  - Footer: "AI-generated. Verify against cited sources."
- [ ] Style: reuse existing design system; no new tokens
- [ ] Frontmatter: `noindex`
- [ ] Link from auth'd user dropdown in Header (not public nav)
- [ ] STYLE-GUIDE.md compliance before commit

### WS4 -- Signup flow + conversion tracking (2-3 hrs)
- [ ] Confirm signup page honors `?next=` param (test post-signup redirect)
- [ ] If `next=/ask`, signup page shows "Create a free account to ask RRM Academy anything"
- [ ] **D1 migration:** create `scripts/migrate-add-signup-source.sql`:
  ```sql
  -- Add signup_source column to users table
  -- Rollback: ALTER TABLE users DROP COLUMN signup_source;
  ALTER TABLE users ADD COLUMN signup_source TEXT;
  ```
- [ ] Execute: `wrangler d1 execute rrm-auth --remote --file=scripts/migrate-add-signup-source.sql`
- [ ] Confirm with: `wrangler d1 execute rrm-auth --remote --command="SELECT sql FROM sqlite_master WHERE name='users'"`
- [ ] Signup handler (`functions/api/auth/signup.js` or equiv): write `signup_source` from `?next=/ask` -> `'ask'`, else derive from referrer / default `'direct'`
- [ ] GA4 event via existing helper: `sendGA4Event(env, request, 'signup_from_ask', { source: 'ask' })` from `functions/api/_ga4.js`. Confirm `GA4_MEASUREMENT_ID` + `GA4_API_SECRET` already bound as CF Pages secrets before this step begins
- [ ] Fire standard `sign_up` event with `source=<value>` param for all signups (backup attribution)
- [ ] Add `signup_source` breakdown to admin enrollments dashboard (count by source, last 30 days)
- [ ] Daily signup-by-source line in rrm-observatory digest

### WS4b -- Welcome email for /ask signups (1 hr, scoped for v1)
**v1 scope:** single transactional welcome email sent inline at signup (same pattern as existing verify-email send in `signup.js`). No drip sequence -- there is no email worker / queue infrastructure in the codebase and building one is out of scope.
- [ ] In signup handler, when `signup_source=='ask'`, send `welcome-ask` email via SES (inline, not queued)
- [ ] Email content: "You're in. Ask anything." -- links back to /ask, sets expectation that it's AI-generated, short
- [ ] Draft copy via `gianna-copywriter` during execution (not plan time)
- [ ] Log to `email_log` table per existing pattern
- [ ] **Deferred to Phase 2:** multi-email drip sequence (Email 2 +2 days library pitch, Email 3 +5 days pillar/STUC). Requires new email worker or CF Queue infrastructure

### WS5 -- Evaluation (2-3 hrs) -- BLOCKING GATE

Reuse existing corpora. All gates must pass before merge.

- [ ] **AEO retrieval**: run 25 queries, score vs 64% baseline. TARGET: >= 64%
- [ ] **FAQ fidelity**: run 15 FAQ questions, compare to `publishedAnswer`. TARGET: >= 12/15 acceptable
- [ ] **Guardrail compliance**: 20 answers through `/check` endpoint. TARGET: 0 violations (HARD)
- [ ] **Editorial voice**: 5 answers checked for IVF legitimization, secular framing, em dashes, "Phil". TARGET: 0 violations (HARD)
- [ ] **Unexplained infertility reframe**: when a user query contains "unexplained infertility", the answer must NOT treat it as a legitimate final diagnosis -- it must reframe the RRM view (often undiagnosed, not truly unexplained; underlying conditions like endo/PCOS/sperm/thyroid/progesterone are commonly missed). TONE RULE: meet the user where they are. Do not scold, correct harshly, or open with "actually your diagnosis is wrong". Acknowledge their framing, then gently introduce the RRM lens. TARGET: 0 violations of the reframe rule; 0 violations of the tone rule (HARD). Test with 3 seed queries that include the phrase
- [ ] **Citation accuracy**: 10 cited library URLs must (a) return 200, (b) contain the claim attributed. TARGET: 10/10 (HARD)
- [ ] **Latency**: p50 < 3s, p95 < 6s
- [ ] **Cost per query**: record and project to 100 q/day, 1000 q/day

If any HARD gate fails: stop. Decide (a) retune model/prompt, (b) upgrade to Claude via AI Gateway (contingency below), or (c) ship with stronger disclaimer. Soft-gate failure (AEO, FAQ fidelity): document and ship with "beta" label.

#### Claude fallback contingency (triggered by eval failure)
If Workers AI flunks HARD gates or scores noticeably below baseline on AEO:
- [ ] Set up CF AI Gateway in front of Anthropic API (gives us caching, rate limit, logging)
- [ ] Configure NLWeb Worker to route LLM calls through AI Gateway
- [ ] Model: `claude-haiku-4-5` first (cost), upgrade to `claude-sonnet-4-6` if quality still off
- [ ] Secret: `ANTHROPIC_API_KEY` from 1Password (already have "OpenClaw Anthropic API")
- [ ] Re-run full WS5 eval suite with Claude
- [ ] Compare cost/query: Workers AI ($0) vs Haiku (~$0.001/q) vs Sonnet (~$0.01/q)
- [ ] Tighten rate limit if switching to Sonnet (20/day might become 10/day)
- [ ] Update plan status to "shipped with Claude fallback" in WS6

### WS6 -- Ship (1 hr)
- [ ] PR to main, CI green (deploy guard baselines)
- [ ] Merge, watch deploy
- [ ] Prod smoke test: signup -> redirect -> /ask -> ask -> answer -> rate limit at 21st query
- [ ] Update `docs/rrm-academy-ecosystem.json`
- [ ] Update D1 `system_config`
- [ ] Telegram ship notification via rrm-observatory

### WS7 -- Post-ship monitoring (ongoing)
- [ ] Daily top-10 queries digest via rrm-observatory
- [ ] Weekly guardrail violation scan (should be 0)
- [ ] NLWeb -> library click-through rate
- [ ] Daily cost check
- [ ] Escalate to Phase 2 (fork + Claude + D1 feed) if quality degrades or volume outgrows Workers AI

## Files touched

| File | Action |
|------|--------|
| `src/pages/ask.astro` | NEW |
| `functions/api/ask.js` | NEW |
| `functions/_middleware.js` | EDIT (auth gate for `/ask`) |
| `scripts/guard.mjs` | EDIT (hash `ask.js`) |
| `src/components/Header.astro` | EDIT (auth'd user menu link) |
| `src/pages/signup.astro` | EDIT (next-param copy) |
| `functions/api/auth/signup.js` (or equiv) | EDIT (write `signup_source`, fire GA4 event, send `welcome-ask` email inline) |
| `scripts/migrate-add-signup-source.sql` | NEW (D1 migration artifact) |
| `functions/api/admin/enrollments.js` (or equiv) | EDIT (source breakdown, last 30 days) |
| `docs/rrm-academy-ecosystem.json` | EDIT (add NLWeb node) |
| `robots.txt` | EDIT (disallow `/ask?*`) |

## Proof gates before merge

1. WS5 HARD gates all pass (guardrails, voice, citations, unexplained-infertility reframe)
2. `coder` agent used for `functions/api/ask.js` -- mandatory per CLAUDE.md. Siblings in `functions/api/` read before writing
3. STYLE-GUIDE.md compliance on `ask.astro`
4. `npm run guard:update` run after `ask.js` edits; `guard-manifest.json` staged in same commit
5. `/arise` pass specifically targeting `functions/api/ask.js` (session validation + KV rate limit + external fetch = top-4 recurring bug category)
6. D1 migration applied + verified before merge (`SELECT sql FROM sqlite_master WHERE name='users'` shows new column)
7. CF Pages secret `NLWEB_SEARCH_URL` bound (verified via `wrangler pages secret list`) before first `/api/ask` call
8. Live smoke test post-deploy

## Out of scope for v1
- MCP endpoint exposure (later phase; may supersede rrm-mcp)
- Custom system prompt / editorial guardrail injection
- Post-processing fact-check via `/check-facts`
- Direct D1 data source (crawl is good enough for v1)
- Homepage widget or library-page link-through
- Streaming response UI
- Conversation persistence across sessions
- Anonymous/unauthenticated access

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Workers AI quality poor on niche medical content | Bad UX, reputation | WS5 eval gate blocks ship; Claude fallback via AI Gateway |
| Crawl freshness lag (new articles invisible hours/days) | Minor UX gap | Accept v1; Phase 2 direct D1 feed if user-visible |
| Hallucinated citations | Editorial risk | HARD gate on 10/10 citation accuracy; disclaimer on page |
| Cost spike from abuse | Surprise bill | Auth gate + 20/day/user rate limit |
| NLWeb Worker template changes upstream | Breakage | Proxy pattern isolates backend; swap if needed |
| User dissatisfaction with Workers AI quality | Signup churn | Beta label + feedback mechanism (simple mailto or hidden form) |

## Rollback

**Soft rollback (stop user exposure, keep code):**
- Remove `/ask` link from Header -> page unreachable via UI
- Set `/api/ask` to return 503 with friendly message -> chat breaks gracefully
- No deploy or git action required for link removal beyond standard PR

**Hard rollback (revert the merge):**
```bash
# Note merge SHA immediately after WS6 merges; store in team Telegram
git revert <merge-SHA> --no-edit
git push origin main
# CF Pages auto-deploys the revert commit
# If auto-deploy fails or needs manual redeploy:
wrangler pages deploy dist --project-name rrm-academy --commit-dirty=false
```

**D1 rollback (only if migration caused an issue):**
```bash
wrangler d1 execute rrm-auth --remote --command="ALTER TABLE users DROP COLUMN signup_source"
```

**CF AI Search instance:** leave running on idle (no user harm, idle cost only). Delete only if abandoning the feature entirely.

## Estimated effort
- WS1: 1-2 hrs (now includes secret provisioning)
- WS2: 2-3 hrs (now includes guard manifest update)
- WS3: 3-4 hrs
- WS4: 2-3 hrs (source tracking, GA4 event, D1 migration)
- WS4b: 1 hr (single welcome email inline, descoped from drip)
- WS5: 2-3 hrs (+2-3 hrs if Claude fallback path triggered)
- WS6: 1 hr
- **Total: 12-17 hrs** (add ~3 hrs for Claude fallback if needed)

Ship target: 2-3 working days including eval.

## Open before execution
None. All decisions locked. Ready for `brian` agent review + execute.
