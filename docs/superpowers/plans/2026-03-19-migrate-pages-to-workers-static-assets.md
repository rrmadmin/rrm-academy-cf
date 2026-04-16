# Migrate CF Pages to Workers with Static Assets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the CF Pages trailing-slash/empty-body bug permanently by migrating from CF Pages to Workers with Static Assets, which has explicit `html_handling` configuration.

**Architecture:** Replace `wrangler pages deploy` with `wrangler deploy` using `[assets]` config. Compile `functions/` folder into a single Worker entry point that handles API routes + middleware. Static assets served by CF's asset handler with `html_handling = "force-trailing-slash"`. The rrm-router Worker continues to sit in front via service binding (now pointing to the new Worker instead of CF Pages).

**Tech Stack:** Cloudflare Workers, Wrangler, Astro 5 (static output unchanged), D1, KV, R2, Vectorize, AI, Analytics Engine

**Risk level:** High. This touches deploy pipeline, routing, auth middleware, all 81 API endpoints. Requires careful staging and rollback plan.

---

## Context for the Implementing Engineer

### Why this migration

CF Pages converts its internal trailing-slash 301 redirects to HTTP 200 with empty body. This is a platform behavior with no configuration to disable it. It causes blank pages when users visit URLs without trailing slashes (e.g., `/login` instead of `/login/`). We currently work around this with a redirect in the rrm-router Worker, but the proper fix is to use Workers with Static Assets, which has `html_handling: "force-trailing-slash"` that issues proper 307 redirects.

### Current architecture

```
Internet -> CF DNS -> rrm-router Worker (service binding) -> CF Pages (rrm-academy)
                                                              |-- static assets (dist/)
                                                              |-- Pages Functions (functions/)
                                                              |-- _headers, _redirects
```

### Target architecture

```
Internet -> CF DNS -> rrm-router Worker (service binding) -> Worker with Static Assets (rrm-academy-worker)
                                                              |-- static assets (dist/)
                                                              |-- compiled Worker (middleware + API routes)
                                                              |-- _headers (static assets only)
```

### Key differences (CF Pages vs Workers with Static Assets)

| Feature | CF Pages | Workers with Static Assets |
|---------|----------|---------------------------|
| Trailing slash | Platform-controlled, buggy | `html_handling` config |
| Functions | Folder-based routing (`functions/api/auth/login.js`) | Compiled into single Worker entry point |
| Middleware | `functions/_middleware.js` (auto-invoked) | `run_worker_first = true` + manual routing |
| `_headers` | Applied to ALL responses (including internal redirects) | Applied to static assets ONLY (not Worker responses) |
| `_redirects` | Applied before Functions | Supported natively |
| Deploy command | `wrangler pages deploy dist` | `wrangler deploy` |
| Service binding | Automatic (`ASTRO_SITE`) | Must update rrm-router binding |
| Bindings (D1, KV, R2, etc.) | Declared in wrangler.toml | Same syntax, slightly different section |
| Secrets | CF Pages secrets (dashboard) | Worker secrets (`wrangler secret put`) |
| Preview URLs | Automatic per-branch | `preview_urls = true` in config |

### Files involved

**Modify:**
- `wrangler.toml` -- Replace `pages_build_output_dir` with `[assets]` config
- `.github/workflows/deploy.yml` -- Change `pages deploy` to `deploy`
- `functions/_middleware.js` -- Becomes the Worker entry point's request handler
- `scripts/guard.mjs` -- Update if deploy command checks change
- `~/iCode/projects/rrm-router/wrangler.toml` -- Update service binding name
- `~/iCode/projects/rrm-router/src/index.js` -- Remove trailing-slash redirect (no longer needed)

**Create:**
- `src/worker/index.js` -- Worker entry point (routes requests to API handlers or static assets)
- `.assetsignore` -- Exclude non-asset files from upload

**Keep unchanged:**
- All 81 files in `functions/api/` -- Logic stays the same, just imported differently
- `src/` (Astro) -- Build output unchanged
- `public/_headers` -- Still works for static assets
- `public/_redirects` -- Still supported natively

### Critical constraints

1. **Zero downtime.** The rrm-router service binding must be updated atomically with the new Worker deployment.
2. **All 23 secrets** must be migrated from CF Pages secrets to Worker secrets before first deploy.
3. **D1, KV, R2, Vectorize, AI, Analytics Engine** bindings must all be declared in the new wrangler.toml format.
4. **The 81 API endpoint files** use `onRequestGet`, `onRequestPost`, `onRequestOptions` exports (CF Pages Function convention). These need an adapter that maps URL paths to the right handler.
5. **`_middleware.js`** currently handles: subdomain redirects, auth gating for `/account/*` and `/community/*`, admin role checks, GA4 page_view tracking, `X-Robots-Tag` for `.pages.dev`, security headers. All of this must be preserved.
6. **Guard manifest** hashes will all change. Run `guard:update` after migration.
7. **E2e tests** (`npx playwright test`, 60 tests) must pass before AND after.
8. **Rollback plan:** Keep CF Pages project alive (don't delete). If migration fails, revert rrm-router service binding to point back to CF Pages.

---

## Tasks

### Task 1: Create staging branch and run baseline tests

**Files:**
- None modified yet

- [ ] **Step 1: Create branch**

```bash
git checkout main && git pull
git checkout -b feat/workers-static-assets
```

- [ ] **Step 2: Run baseline e2e tests**

Run: `npx playwright test`
Expected: 60 passed

- [ ] **Step 3: Run baseline guard**

Run: `npm run guard`
Expected: ALL CLEAR

- [ ] **Step 4: Document current secrets**

```bash
# List all CF Pages secrets (from dashboard or wrangler)
npx wrangler pages secret list --project-name rrm-academy
```

Save the list -- these all need to be migrated to Worker secrets.

- [ ] **Step 5: Commit baseline**

```bash
git commit --allow-empty -m "chore: start Workers with Static Assets migration"
```

---

### Task 2: Update wrangler.toml for Workers with Static Assets

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: Rewrite wrangler.toml**

Replace the entire file. Key changes:
- Remove `pages_build_output_dir`
- Add `[assets]` section with `html_handling = "force-trailing-slash"`
- Add `main` pointing to compiled Worker entry point
- Add `run_worker_first` for paths that need middleware (auth, API)
- Keep all existing bindings (D1, KV, R2, Vectorize, AI, Analytics Engine)

```toml
# RRM Academy -- Cloudflare Worker with Static Assets
# Migrated from CF Pages to fix trailing-slash redirect bug
# Deploy: npx wrangler deploy

name = "rrm-academy-worker"
main = "dist/worker/index.js"
compatibility_date = "2026-03-19"

[assets]
directory = "./dist/"
html_handling = "force-trailing-slash"
not_found_handling = "404-page"
binding = "ASSETS"
run_worker_first = true

[[kv_namespaces]]
binding = "SURVEY_TOKENS"
id = "ef52bc09f1b44b5f8e3367372be8d63d"

[[kv_namespaces]]
binding = "COMMUNITY_KV"
id = "63fed002ac2c46a08bf5217b5900a928"

[[d1_databases]]
binding = "DB"
database_name = "rrm-auth"
database_id = "22742c9c-77fa-4344-abda-7e7e8b0da9de"

[[d1_databases]]
binding = "SURVEY_DB"
database_name = "rrm-survey"
database_id = "55e8038c-d73c-4db3-8ed0-8a34694f360a"

[[r2_buckets]]
binding = "R2_ASSETS"
bucket_name = "rrm-assets"

[[vectorize]]
binding = "VECTORIZE"
index_name = "rrm-library-vectors"

[ai]
binding = "AI"

[[analytics_engine_datasets]]
binding = "EVENTS"
dataset = "worker_events"
```

- [ ] **Step 2: Create .assetsignore**

```
_worker.js
node_modules
.git
.DS_Store
```

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml .assetsignore
git commit -m "chore: update wrangler.toml for Workers with Static Assets"
```

---

### Task 3: Build the Worker entry point (API router + middleware)

This is the most complex task. The Worker entry point must:
1. Run middleware logic (auth gating, GA4 tracking, security headers) on every request
2. Route `/api/*` requests to the correct handler from `functions/api/`
3. Fall through to static assets via `env.ASSETS.fetch(request)` for everything else

**Files:**
- Create: `src/worker/index.js` -- Main Worker entry point
- Create: `src/worker/api-routes.js` -- Maps URL paths to handler imports
- Create: `scripts/compile-worker.mjs` -- Build script to bundle the Worker

**Design decision:** CF Pages Functions use file-path-based routing (`functions/api/auth/login.js` -> `POST /api/auth/login`). Workers don't have this. We need a routing layer that maps paths to handlers. Keep it simple -- a static map, not a framework.

- [ ] **Step 1: Write the API route map**

Create `src/worker/api-routes.js` that imports every handler from `functions/api/` and maps URL paths to them. This is mechanical -- one line per endpoint.

- [ ] **Step 2: Write the Worker entry point**

Create `src/worker/index.js` that:
- Imports the route map
- Runs middleware (ported from `functions/_middleware.js`)
- For `/api/*` paths: looks up handler, calls `onRequestGet`/`onRequestPost`/`onRequestOptions`
- For everything else: returns `env.ASSETS.fetch(request)` (static assets)
- Wraps responses with security headers

- [ ] **Step 3: Write the compile script**

Create `scripts/compile-worker.mjs` that uses esbuild to bundle `src/worker/index.js` + all `functions/api/` imports into a single `dist/worker/index.js`.

- [ ] **Step 4: Test compilation locally**

```bash
node scripts/compile-worker.mjs
ls -la dist/worker/index.js
```

Expected: File exists, reasonable size (~200-500KB)

- [ ] **Step 5: Test locally with wrangler dev**

```bash
npx wrangler dev
```

Test manually: `curl http://localhost:8787/api/auth/session`
Expected: JSON response (not 404)

- [ ] **Step 6: Commit**

```bash
git add src/worker/ scripts/compile-worker.mjs
git commit -m "feat: Worker entry point with API routing and middleware"
```

---

### Task 4: Migrate secrets

**Files:** None (dashboard/CLI operations)

- [ ] **Step 1: Export current CF Pages secrets list**

From the CF dashboard or `wrangler pages secret list`, document every secret.

- [ ] **Step 2: Set secrets on the new Worker**

```bash
# For each secret:
echo "VALUE" | npx wrangler secret put SECRET_NAME
```

Required secrets (from project CLAUDE.md):
- `AIRTABLE_PAT`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SES_REGION`
- `CF_TURNSTILE_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GA4_MEASUREMENT_ID`
- `GA4_API_SECRET`
- `ELV_API_KEY`
- `ADMIN_API_SECRET`
- `CANARY_SECRET`
- `STRIPE_PRICE_MEMBER`
- `STRIPE_PRICE_HERO`
- `STRIPE_PRICE_SUPERHERO`
- (any others found in Step 1)

- [ ] **Step 3: Verify secrets are set**

```bash
npx wrangler secret list
```

Expected: All secrets listed

---

### Task 5: Update deploy pipeline

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `package.json` (add compile-worker script)

- [ ] **Step 1: Add worker compile to build process**

In `package.json`, add:
```json
"compile-worker": "node scripts/compile-worker.mjs"
```

Update `build` script to include worker compilation:
```json
"build": "astro build && npx pagefind --site dist && npm run compile-worker"
```

- [ ] **Step 2: Update deploy command in GitHub Actions**

Change line 156 in `deploy.yml`:
```yaml
# Before:
command: pages deploy dist --project-name rrm-academy
# After:
command: deploy
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml package.json
git commit -m "chore: update deploy pipeline for Workers"
```

---

### Task 6: Update rrm-router service binding

**Files:**
- Modify: `~/iCode/projects/rrm-router/wrangler.toml`
- Modify: `~/iCode/projects/rrm-router/src/index.js`

- [ ] **Step 1: Update service binding in wrangler.toml**

Change the service binding to point to the new Worker:
```toml
# Before:
[[services]]
binding = "ASTRO_SITE"
service = "rrm-academy"

# After:
[[services]]
binding = "ASTRO_SITE"
service = "rrm-academy-worker"
```

- [ ] **Step 2: Remove trailing-slash redirect from router**

Remove the trailing-slash redirect block from `src/index.js` (lines 232-247). With `html_handling = "force-trailing-slash"`, the Worker handles this natively.

- [ ] **Step 3: Run router tests**

```bash
node test/router.test.js
```

Expected: All pass (update tests if trailing-slash test was added)

- [ ] **Step 4: DO NOT deploy yet** -- deploy router and academy worker together in Task 8.

- [ ] **Step 5: Commit**

```bash
git add wrangler.toml src/index.js test/router.test.js
git commit -m "chore: update service binding for Workers migration"
```

---

### Task 7: Clean up redundant workarounds

**Files:**
- Modify: `functions/_middleware.js` -- Remove htmlRedirect trailing-slash code and security header injection (now handled by Worker entry point)
- Modify: `functions/api/auth/google.js` -- Can revert htmlRedirect to simple Response.redirect (Worker handles headers correctly)
- Modify: `functions/api/auth/google-callback.js` -- Same

- [ ] **Step 1: Remove middleware trailing-slash redirect and security header injection**

The middleware's trailing-slash htmlRedirect block and the security header wrapper are no longer needed -- the Worker entry point and `html_handling` handle both.

- [ ] **Step 2: Simplify OAuth redirects**

The `htmlRedirect()` pattern in `google.js` and `google-callback.js` was a workaround for the `_headers` bug. With Workers, `Response.redirect()` works correctly. Revert to simple redirects.

- [ ] **Step 3: Run guard:update**

```bash
npm run guard:update
```

- [ ] **Step 4: Commit**

```bash
git add functions/ guard-manifest.json
git commit -m "chore: remove CF Pages trailing-slash workarounds"
```

---

### Task 8: Staged deployment

**This is the critical deployment sequence. Follow exactly.**

- [ ] **Step 1: Run full e2e test suite locally**

```bash
npx playwright test
```

Expected: 60 passed

- [ ] **Step 2: Deploy the new Worker (but don't update router yet)**

```bash
npx wrangler deploy
```

Verify it's accessible at its workers.dev subdomain.

- [ ] **Step 3: Test the Worker directly**

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}" "https://rrm-academy-worker.<subdomain>.workers.dev/"
curl -s -o /dev/null -w "%{http_code} %{size_download}" "https://rrm-academy-worker.<subdomain>.workers.dev/login"
curl -s -o /dev/null -w "%{http_code} %{size_download}" "https://rrm-academy-worker.<subdomain>.workers.dev/api/auth/session"
```

Expected: Homepage 200 with content, `/login` 307 redirect to `/login/`, `/api/auth/session` returns JSON.

- [ ] **Step 4: Full headless Chromium test against Worker directly**

Run the same 18-path Playwright test against the workers.dev URL before touching production.

- [ ] **Step 5: Deploy updated rrm-router**

```bash
cd ~/iCode/projects/rrm-router
npx wrangler deploy
```

This atomically switches production traffic to the new Worker.

- [ ] **Step 6: Verify production**

Run headless Chromium 18-path test against `https://rrmacademy.org`.

- [ ] **Step 7: Verify trailing slashes work natively**

```bash
curl -sI "https://rrmacademy.org/login" | head -5
```

Expected: `HTTP/2 307` with `location: /login/` (proper redirect, not 200 with empty body)

- [ ] **Step 8: Run full e2e suite against production**

```bash
npx playwright test
```

Expected: 60 passed

---

### Task 9: Rollback plan (if needed)

If anything breaks after Task 8:

- [ ] **Step 1: Revert rrm-router service binding**

```bash
cd ~/iCode/projects/rrm-router
# Revert wrangler.toml to point to "rrm-academy" (CF Pages)
npx wrangler deploy
```

This immediately restores CF Pages as the backend. The router trailing-slash redirect handles the old bug.

- [ ] **Step 2: Keep CF Pages project alive for 1 week after migration**

Do NOT delete the CF Pages project until the Worker has been stable for at least 7 days.

---

### Task 10: Post-migration cleanup

**After 7 days of stable production:**

- [ ] **Step 1: Update project CLAUDE.md**

Document the new architecture, deploy command, and binding changes.

- [ ] **Step 2: Update `~/iCode/CLAUDE.md`**

Update the CF infrastructure section to reflect Workers instead of Pages.

- [ ] **Step 3: Update memory**

Update `cf-pages-302-to-200.md` to note the migration resolved the root cause.

- [ ] **Step 4: Delete CF Pages project**

Only after 7+ days of stable production:
```bash
npx wrangler pages project delete rrm-academy
```

- [ ] **Step 5: Push all changes to main**

```bash
git checkout main
git merge feat/workers-static-assets
git push origin main
```
