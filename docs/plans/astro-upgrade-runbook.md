# Astro (and dependency) Upgrade Runbook

> Durable process for upgrading Astro and other build-critical dependencies without
> breaking production. Built 2026-07-05 alongside the 5.18.2 → 6.4.8 upgrade. This
> file is the referenced target from `.github/dependabot.yml`.

## Why this exists

A framework major used to be a research project each time. This runbook + the
hermetic build harness + the `build-verify` CI gate turn it into a
merge-a-green-PR operation: every upgrade is **proven to build before it can reach
`main`**.

## The three standing pieces (already on main)

1. **`npm run build:fixture`** (`scripts/build-fixture.mjs`) — runs the FULL
   production build chain (all pre-build scripts + `astro build` + pagefind +
   postbuild hooks) against synthetic fixtures in `scripts/fixtures/`, with **no
   secrets and no network**. Stages fixtures only for the 5 gitignored D1 data
   files that are absent, pads them to production floors so every build guard
   stays armed, and restores any tracked file the chain rewrites (try/finally, so
   `git status` ends as it started). Green here == the site builds.
2. **`scripts/verify-build-output.mjs`** — post-build structural invariants on
   `dist/` (key routes exist, JSON-LD parses, pagefind index present, sitemap XML
   well-formed, page-count floors). Runs at the end of `build:fixture`.
3. **`.github/workflows/build-verify.yml`** — runs on EVERY PR; an in-job diff
   gate limits the heavy `build:fixture` run to PRs touching the dependency/build-config
   surface (`package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`,
   or the harness files), everything else reports green in seconds. It IS a
   **required status check** as of 2026-07-05 via the `main: build-verify required`
   repository ruleset (bypass actors: RRM Admin Automation app for merge.yml's
   direct pushes, plus repository admins). A red build blocks merge — including
   Dependabot PRs.

## Node version coupling (the #1 foot-gun)

Astro majors raise the minimum Node. **Bump CI Node BEFORE the framework**, in its
own PR, and confirm the current framework still builds on the new Node first. Node
is pinned in **four** workflows: `deploy.yml`, `merge.yml`, `ai-search-refresh.yml`,
`ai-search-reconcile.yml`. If the framework upgrade lands on `main` before the Node
bump, the production deploy runs the new framework on the old Node and fails.

## Step-by-step (next time, e.g. 6 → 7)

Prereqs: run on the Node version the target major requires (`npm view astro@^N
engines`). Never `npm install astro@latest` — it may jump multiple majors; pin the
exact `^N.x` range.

1. **Read the upgrade guide** at `https://docs.astro.build/en/guides/upgrade-to/vN/`.
   For every breaking change, grep this repo to classify AFFECTED (file:line) vs
   NOT (why). As of v6 the repo used: no content collections, no `Astro.glob`, no
   `astro:assets`, no custom Vite config, two `astro:build:done` integrations
   (`src/integrations/library-sitemaps.mjs`, `agent-md-surfaces.mjs`), and a config
   with `output:'static'`, `trailingSlash:'always'`, `build.format:'directory'`,
   `build.inlineStylesheets:'always'`, sitemap `filter`/`serialize`. Re-verify each
   still holds.
2. **Green baseline first:** `npm run build:fixture` must pass on the CURRENT
   version before touching anything. Never upgrade on a red baseline.
3. **Bump CI Node** (if the major requires it) in the four workflows above — its
   own manual-merge PR (workflow files can't auto-merge; C3 guard refuses). Merge it
   first.
4. **Install pinned versions** (framework + its integrations together — sitemap
   declares no peerDeps, so npm won't auto-bump it; do it explicitly):
   `npm install astro@^N.x @astrojs/sitemap@^X @lucide/astro@^Y @astrojs/check@^Z`.
   Check integration compat with `npm view <pkg> peerDependencies`.
5. **Type baseline:** run `npx astro check` RAW. Confirm the output still ends with
   an "N errors" summary line — `scripts/check-types.mjs` parses `/(\d+)\s+error/`
   and **silently false-passes** if the format changed. If intact, re-baseline with
   `node scripts/check-types.mjs --update` (the count will shift; that's expected).
   If the format changed, stop and reconcile the parser first.
6. **Acceptance gate:** `npm run build:fixture` GREEN, page count ≈ pre-upgrade
   baseline (±a couple). Diagnose any failure against the guide; fix config/code
   minimally. Never weaken the harness or its invariants to force a pass.
7. **Bundle gate:** `npm run gates:analytics` — AG11 caps the tracked JS bundles
   (Vite majors change chunking). Report actual sizes.
8. **Tests:** `npm test` stays green (baseline 700 tests / 694 pass / 6 skip).
9. **Land it** as a manual-merge PR (framework majors deserve human review). Put it
   on a **non-`claude/**` branch** so the auto-merge pipeline doesn't fire, and mark
   the merge-order dependency on the Node PR loudly. Once the Node PR is on main,
   `build-verify` runs on the upgrade PR automatically — merge on green.

## Known behavioral output changes to eyeball post-deploy

- **v6:** multiple `<style>`/`<script>` blocks now render in declaration order (v5
  reversed them). Can flip CSS-cascade ties on pages with >1 `<style>` block —
  glossary index, community post, MobileSearchModal, lesson player, library index,
  community areas, AppShellChrome, admin pages. Build-verify can't catch visual
  regressions; do a preview-deploy visual pass on these. Fix is an explicit
  specificity bump.
- Hashed filenames, scoped-class hashes, and the `generator` meta tag change every
  upgrade — that's noise, not regression. A structural diff must normalize them.

## Dependabot posture (`.github/dependabot.yml`)

- Astro + `@astrojs/*` + `@lucide/astro` grouped into one weekly PR (lockstep).
- Minor/patch for everything else batched weekly; other majors stay individual PRs.
- **Astro majors are excluded** from auto-PRs — they arrive deliberately via this
  runbook, not as a surprise PR.
- GitHub Actions updates grouped weekly.

## History

- **2026-07-05:** 5.18.2 → 6.4.8 (+ sitemap 3.7.3, lucide 1.23, check 0.9.9).
  Cleared 6 Dependabot advisories. Zero config/source changes. Node 20→22.
  PRs: harness (merged), Node/gate (#72), upgrade (#73).
