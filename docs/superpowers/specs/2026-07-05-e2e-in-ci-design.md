# End-to-End Tests in CI - Design Spec

**Date:** 2026-07-05
**Status:** Draft (pre-merge; PR open, held for Brian)
**Scope:** rrm-academy-cf - new `.github/workflows/e2e.yml`, new `playwright.ci.config.ts`, new `tests/e2e/ci-smoke.spec.ts`. Reuses the existing `tests/e2e/*` Playwright suite and `@playwright/test` devDependency. Touches no existing workflow, no auth/billing/stripe function, no build script.
**Author:** Claude Code

---

## 1. Problem and starting state

The repo already ships a 14-file Playwright suite under `tests/e2e/`, a `playwright.config.js`
(baseURL `https://rrmacademy.org`), and `test:e2e` / `test:e2e:mobile` npm scripts. What is
missing is CI: `grep -rn e2e .github/workflows/` returns nothing. The suite runs only when a
human remembers to run it locally. Every spec header says the same thing: "Not wired into CI
(deploy.yml runs no e2e); this is a local + post-deploy regression aid."

The result is that regressions the suite was written to catch (the library-pagination bug that
recurred across 3+ sessions, the mobile-overflow bug that recurred across 33+ sessions, the
anonymous-caller gating of auth/billing/course APIs) have no automated tripwire. This spec wires
a curated, read-only subset of that suite into CI.

The deliverable is CI plumbing plus three small gap-filling assertions, not a new test framework.

## 2. Decision (a): target server architecture

**Chosen: production-URL smoke tests against `https://rrmacademy.org`, running only a read-only,
non-mutating subset.**

Three options were considered:

### Option A - Production-URL smoke (CHOSEN)

Hit the live deployed site. No build, no secrets, no bindings.

- **Pros:** exercises the *real* deployed artifact end to end (Astro output + the CF Pages
  Functions runtime + real D1 reads + the rrm-router edge layer + CDN cache). Zero build cost, so
  the job finishes in a few minutes. No secrets in the workflow. The existing prod-default specs
  (`library-search`, `library-pagination`, `contact-form`, `renditions`, and the boundary specs
  via their `*_E2E_BASE` env vars) were authored for exactly this target.
- **Cons:** it validates the currently-live site, not an un-merged PR's changes (acceptable: this
  is a smoke/post-deploy tripwire, not a pre-merge build gate; `build-verify.yml` already guards
  the build surface pre-merge). It cannot safely cover mutating flows (signup, checkout, progress
  writes) because those would write to production D1 / mint Stripe sessions. We scope those out
  (see decision b).
- **Data-mutation risk:** driven to zero by construction. Every included assertion is a GET, an
  anonymous-rejection check (401/400/404), or a page render. The boundary specs already carry a
  "PROD-SAFETY CONTRACT (hard): zero mutating success paths" annotation, verified against endpoint
  source. No test signs up, logs in, checks out, or writes.

### Option B - CI-built local preview (`npm run build` + `wrangler pages dev dist`)

Build the site in CI and test a local preview.

- **Pros:** tests the PR's own changes pre-merge; hermetic; could exercise mutating flows against
  ephemeral state.
- **Cons that rule it out here:**
  1. The full build chain (`enrich-glossary`, `build-og-index`, `generate-page-dates`,
     `build-library-feed`, `ssot-prebuild`, `astro build`, `pagefind`, `build-infographic-assets`)
     plus a real data fetch is heavy (minutes) and the data fetch needs `LIBRARY_BUILD_TOKEN` and
     hits production read APIs. `build:fixture` sidesteps the token with synthetic data, but then
     the site content is fake and search/library-record journeys assert against fixtures, not the
     real corpus.
  2. **The gating journeys do not actually work under a bare `wrangler pages dev dist`.** The
     `/api/*` Functions bind D1/KV/Stripe. Without those bindings the handlers throw 500 before
     reaching the 401 rejection path, so "gated content actually gates" would test the wrong thing.
     The real anonymous-rejection boundary only exists against the deployed environment.
  3. Higher flake surface (build + browser + local server + port races) for a v1 that needs a clean
     track record before it can be trusted.
- This is the architecture the task flags as necessary *if* we needed authenticated signup/login
  coverage. We deliberately do not (see decision b), so this cost is not warranted.

### Option C - CF Pages preview-deployment URL

Test a per-PR preview URL.

- **Ruled out:** this repo does not use the CF Pages Git integration. Deploys go GitHub Actions ->
  `wrangler pages deploy` (direct upload), so no per-PR preview URL is minted to target. Worse,
  CF Pages preview deployments share the *production* Functions bindings (same D1), so a mutating
  test against a preview would write to prod data. This raises mutation risk instead of lowering it.

### Why A is safe here specifically

"Gated content actually gates" is covered as an **anonymous-rejection** property (a logged-out
caller gets 401/403 and no write happens), which is inherently read-only and is the highest-value
half of the auth story. We do not attempt authenticated happy-path coverage against prod. If Brian
later wants authenticated end-to-end coverage (real login -> enroll -> progress), that is the
trigger to stand up Option B with a dedicated synthetic account and seeded D1, tracked as a
follow-up. It is out of scope for this v1.

## 3. Decision (b): which journeys are e2e-critical

Small, high-value, and read-only. The CI config's `testMatch` pins exactly this set:

| # | Journey | Spec | Why it is critical | Safety |
|---|---------|------|--------------------|--------|
| 1 | Homepage renders with nav | `ci-smoke.spec.ts` (new) | "Is the site up" + primary nav present. Nothing covered it before. | GET |
| 2 | A library record page renders | `ci-smoke.spec.ts` (new) | The library is the core product surface; navigate landing -> first record -> assert content. | GET |
| 3 | 404 page behavior | `ci-smoke.spec.ts` (new) | A bad path must return status 404 and the recovery UI (search box + suggested links). | GET |
| 4 | Search returns results | `library-search.spec.js` | Pagefind is load-bearing for discovery; the search box + result count + own-content surfacing. | GET |
| 5 | Library landing + pagination | `library-pagination.spec.js` | The pagination bug recurred 3+ sessions with no automated guard. | GET |
| 6 | Auth APIs reject anonymous callers | `auth-boundary.spec.ts` | "Gated content actually gates" for accounts. | anon-reject |
| 7 | Billing APIs reject anonymous callers | `billing-boundary.spec.ts` | Money-movement gating; invalid input rejected before any Stripe session is minted. | anon-reject |
| 8 | Course APIs reject anonymous callers | `course-player.spec.ts` | Paid course content gating (enroll/progress/quiz/certificate/stream-token). | anon-reject |
| 9 | Rendition + quiz APIs 401 anonymous | `renditions.spec.ts` | Rendition endpoints must not leak content or validation to logged-out callers. | anon-reject |
| 10 | Contact page renders | `contact-form.spec.js` | The contact surface (category enum, care-referral notice) is a frequent-edit page. | GET |

**Explicitly excluded from CI (with reason), so the signal stays clean:**

- `app-shell.spec.ts`, `track-smoke.spec.ts` - hardcoded to `http://localhost:4321` (astro dev).
  They belong to Option B (local preview) and the app-shell is gated on production `PUBLIC_SHELL_ROUTES`.
- `app-shell-visual.spec.ts` - pixel screenshot baselines are not committed, so a CI run would fail
  or auto-pass with no baseline. Visual regression is a separate track.
- `community-auth.spec.ts`, `mobile-responsive.spec.js`, `fund-thermo.spec.ts`,
  `policymaker-read-access.spec.ts` - all prod-safe and easy to add once the core set has a track
  record. `mobile-responsive` wants the mobile Playwright projects; `policymaker` self-skips without
  `PM_VERIFY_SLUG`. Held back only to keep the v1 set tight and low-flake.

**Read-only enforcement mechanism.** The boundary specs read their base URL from
`AUTH_E2E_BASE` / `BILLING_E2E_BASE` / `COURSES_E2E_BASE` (default `localhost:8788`). The workflow
sets all three plus `E2E_BASE_URL` to `https://rrmacademy.org`, so every spec resolves to prod and
every assertion is a GET or an anonymous-rejection. No spec in the set has a mutating success path.

## 4. Decision (c): triggers

`e2e.yml` fires on four triggers, each with a purpose:

1. **`workflow_run` on "Build & Deploy" completed (post-deploy smoke).** The primary trigger.
   After a deploy to main lands, smoke the live site. Cannot block the deploy (it runs *after*).
   `concurrency: e2e-postdeploy` with `cancel-in-progress: true` debounces the burst of
   content-publish `repository_dispatch` deploys (blog/faq/course/glossary publishes each deploy)
   down to one smoke run.
2. **`schedule` nightly (07:17 UTC).** Catches drift with no deploy: a dependency shift, a CDN or
   router change, or prod rot. This is the tripwire that fires even on quiet days.
3. **`pull_request` paths-filtered to the e2e surface** (`tests/e2e/**`, `playwright*.config.*`,
   `.github/workflows/e2e.yml`). Validates the harness itself when someone edits a spec or the
   config, without running prod smoke on unrelated PRs. Informational only (see decision e).
4. **`workflow_dispatch`.** Manual run for on-demand verification.

**Post-deploy correctness note.** Apex HTML is edge-cached ~1h and content deploys can be preceded
by stale cache (memory `rrm-academy-content-deploy-edge-cache-purge`). The smoke set therefore
asserts only *deploy-invariant structure* (nav present, search works, gating holds, 404 shape),
never freshly-changed content values, so edge-cache lag cannot flake a post-deploy run.

## 5. Decision (d): flake mitigation and runtime budget

- **Config:** `playwright.ci.config.ts` sets `retries: 2` in CI, `workers: 2` (polite to prod and
  keeps request bursts under the per-IP rate limits the boundary specs note: login/signup/forgot/
  reset share 5-per-15-min), `timeout: 30_000`, `expect.timeout: 10_000`, `forbidOnly: true` in CI,
  `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`. A single `desktop-chrome` (chromium)
  project keeps the browser install to chromium only.
- **Rate-limit budget:** one CI run issues on the order of a dozen requests total across the
  boundary specs, well under the 5-per-15-min-per-endpoint limits; GitHub-hosted runner egress IPs
  vary run to run, so limits do not accumulate across runs. Retries could double a boundary probe;
  the specs keep 1-2 requests per endpoint precisely so a retry stays in budget.
- **Stable selectors:** structural (`header.site-header`, `nav.main-nav`, `.sr-count`, status codes),
  not content strings, so content churn does not flake the suite.
- **Runtime budget:** `timeout-minutes: 12` hard cap. Expected wall time a few minutes (chromium
  install with npm cache ~30s, tests ~1-3 min). npm dependency + Playwright browser caching keyed on
  `package-lock.json` cut cold-start.
- **Artifacts:** the HTML report + traces upload on failure for triage.

## 6. Decision (e): rollout - non-blocking by construction

- `e2e.yml` is its **own workflow file**, never referenced by the `main` repository ruleset's
  required status checks. The post-deploy and nightly runs cannot gate a merge or a deploy (they run
  after, or on a timer). A flake here can never brick the deploy pipeline.
- The `pull_request` trigger is informational: it is not a required check, so a red e2e run on a PR
  does not block that PR from merging (it surfaces harness breakage for a human to read).
- **Do not add this workflow to the branch ruleset's required checks until it has a green track
  record** (proposed: 2+ weeks of clean post-deploy + nightly runs). Only then consider promoting the
  post-deploy run to a release gate. This posture matches the repo's existing hardening notes.
- **Auto-merge interaction (expected):** `merge.yml` refuses to auto-merge any `claude/**` branch
  that touches `.github/workflows/` ("Block workflow-file changes on auto-merge"). So the PR that
  introduces `e2e.yml` will not auto-merge and its `merge.yml` run will fail at that guard by design;
  it waits for Brian's review. That failing `merge.yml` run also fires the Observatory failure ping
  (expected noise, non-blocking).

## 7. Files

| File | Status | Purpose |
|------|--------|---------|
| `docs/superpowers/specs/2026-07-05-e2e-in-ci-design.md` | new | this spec |
| `playwright.ci.config.ts` | new | CI-only Playwright config: pinned read-only `testMatch`, prod baseURL from env, CI retries/workers |
| `tests/e2e/ci-smoke.spec.ts` | new | homepage+nav, library record render, 404 behavior (the three uncovered gaps) |
| `.github/workflows/e2e.yml` | new | the CI workflow (4 triggers, non-blocking) |

No existing file is modified. `@playwright/test` is already a devDependency; no new dependency is
added.

## 8. Out of scope / follow-ups

- Authenticated happy-path coverage (login -> enroll -> progress -> quiz) needs Option B with a
  seeded synthetic account and D1. Tracked as a follow-up, gated on Brian's go.
- Mobile-viewport smoke (`mobile-responsive.spec.js` under the iPhone projects) and the deferred
  prod-safe specs (`community-auth`, `fund-thermo`, `policymaker-read-access`) are a one-line
  `testMatch` addition once the core set is green.
- Promoting the post-deploy run to a required release gate after the track record accrues.
