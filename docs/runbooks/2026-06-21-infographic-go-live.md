# Synopsis Infographics: go-live runbook (HELD)

Built lights-off on branch `claude/infographic-build` across three repos
(rrm-academy-cf, rrm-library-worker, rrm-cli). Everything below is HELD for
Brian. Nothing here ran during the build.

## What is already done (held, not deployed)

- rrm-academy-cf (worktree branch `claude/infographic-build`): renderer + validator + CLI + SVG gate + the `SynopsisInfographic` component wired into BOTH synopsis branches of `src/pages/library/[...slug].astro` + the `fetch-data.mjs` mapping + the `articles.infographic` type. Full build passes (4599 pages). Phase-1 test suite 37/37. Verified end to end against a fixture: a valid spec renders an inline `<svg role="img">` with crawlable `<text>` numerals under the synopsis title; an invalid spec FAILS the build.
- rrm-library-worker (branch `claude/infographic-build`): the D1 migration, the `/articles` projection gated by `infographic_approved`, and the admin `/infographic-result` write route. A guard-hashes refresh commit was needed for the new admin route in `ENDPOINT_SCOPES` (verified: only the `index.js` auth-gate hash changed).
- rrm-cli (branch `claude/infographic-build`): schema doc mirror.
- The `/rrm-infographic` skill (in the skills repo): propose, fail-closed verify-source, plus the repo export script (PNG + WebP + SVG).

## Go-live order (run only on Brian's go)

1. Merge the three repo branches via their normal PR ritual (rrm-library-worker uses the worktree + PR + `gh pr merge`; rrm-academy-cf uses the claude/* auto-merge).
2. Apply the D1 migration BEFORE the worker deploys:
   `npx wrangler d1 execute rrm-library --remote --file migrations/2026-06-21-add-infographic.sql`
3. Deploy rrm-library-worker (its landing ritual: token `op://.../CF - Worker Deploy - account`, then `GET /health` -> 200, `POST /publish` no-auth -> 401).
4. Deploy rrm-academy-cf (push to main triggers the GitHub Actions build + CF Pages deploy).
5. Per-article promotion (each infographic, operator-gated): run `/rrm-infographic` to propose + confirm + registry-verify a spec, then POST it to the worker:
   `POST /infographic-result { article_id, spec, approved: true }` with the `rrm_admin_` Bearer token. This sets `articles.infographic` + `infographic_approved = 1` for that one article.
6. Trigger a single-record rebuild of that article (`repository_dispatch` with `article_id`) so the static page bakes the infographic.
7. Verify on the immutable `<hash>.pages.dev` deployment URL, or purge the article URL via the cf-cache-purge path before checking the apex (apex HTML is edge-cached ~1h).

## Flags to re-confirm at review (security / gate touches during the lights-off build)

- rrm-library-worker `scripts/guard-hashes.json` was refreshed for the new `/infographic-result` admin route. Confirm the auth-gate manifest entry is intact and the new route is `['admin']`-scoped.
- rrm-academy-cf `scripts/type-check-baseline.json` was bumped 271 -> 275. This branch adds ZERO type errors; the delta is pre-existing origin/main drift since the 2026-05-31 baseline (all 275 errors are in untouched files: community/index.astro, the figma plugin, AudioPlayer.astro, etc.). Re-confirm before merge.

## Known design nuance (not a defect)

The infographic slot is rendered INSIDE the `{article.insights && (...)}` synopsis block (per the spec, "under the synopsis title"). So an article with `infographic_approved = 1` but no approved synopsis (`synopsis_approved = 0`, no `insights`) will NOT show its infographic, because the whole synopsis section is absent. If infographics should render independently of an approved synopsis, move the slot above the `insights` guard. Decide at go-live.

## Rollback

Revert the merges; set `infographic_approved = 0` for any promoted article (the component then renders nothing). The `infographic` column and route are inert when no row is approved.

## Phase 4: Static PNG delivery, retraction, rrm-router merge-back (HELD)

### Static asset delivery

At go-live the build emits static PNGs into `dist/infographic/<id>/<preset>.png` (square, portrait, story, card). These are served as CF Pages static files with no per-request compute. The four presets cover all share targets: 1:1 square, 4:5 portrait, 9:16 story, and 1.91:1 card (OG).

### Retraction and cache purge

On any `infographic_approved` reset or retraction (setting `infographic_approved = 0` in D1 via the worker admin route), a full static rebuild is required to drop the PNG files from `dist/`. After the rebuild redeploys, a `cf-cache-purge` of `/infographic/<id>/*` is also required. CF Pages serves these files with `s-maxage=86400` (24h) and `stale-while-revalidate=604800` (7d); without the purge, a retracted graphic can continue serving from the edge for up to a week.

### rrm-router go-live (separate repo, required before `/infographic/*` resolves at apex)

The `/infographic` route lives on the held branch `claude/infographic-build` in `/Users/brian/iCode/projects/rrm-router`. Until this branch is merged and deployed, the apex router proxies `/infographic/*` to Wix (returning a 404 or a Wix page), so the static PNGs are unreachable from the canonical domain even after rrm-academy-cf deploys.

Go-live steps for the router:

1. Merge `claude/infographic-build` into `main` in the rrm-router repo. The predeploy guard (`scripts/predeploy-guard.sh`) refuses any deploy from a non-`main` tree or a tree not matching `origin/main`, so the merge must land on `main` first.
2. From the router repo root, export the CF deploy token and run the sanctioned deploy path:
   ```
   export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/rrm-router CF Workers Deploy Token/credential')
   npm run deploy
   ```
   Do NOT run bare `npx wrangler deploy`; it bypasses the predeploy guard.
3. Confirm the `/infographic/<id>/card.png` URL resolves at the apex after deploy.

### rrm-academy-cf deploy and per-article promotion

The rrm-academy-cf deploy (static PNGs + the synopsis page share kit) and per-article `infographic_approved` promotion stay behind explicit go-live per the go-live order above. Do not promote any article spec until both rrm-academy-cf and the rrm-router route are live.
