# AI Search Refresh — Decouple from Deploy Concurrency

**Status:** open
**Owner:** TBD
**Severity:** High (recurring deploy queue blockage)
**Filed:** 2026-05-05

## Problem

The `ai_search_refresh` job in `.github/workflows/deploy.yml` repeatedly hangs in `in_progress` state for 60+ minutes, holding the workflow's `concurrency: deploy / cancel-in-progress: false` lock and blocking every subsequent deploy until its job-level `timeout-minutes: 60` finally trips.

### Concrete incident (2026-05-05)

| Time (UTC) | Event |
|---|---|
| 17:10:23 | Build & Deploy run `25390924154` started (head `4f99e45`) |
| 17:47:02 | `deploy` job succeeded |
| 17:47:14 | `ai_search_refresh` started |
| 18:14:08 | First downstream merge to `main` (proofread fix `1fee84d`) — Build & Deploy queued behind `25390924154` |
| 18:14 → 18:42 | Three downstream Build & Deploy runs queue, supersede each other (only the latest queued run is kept), all sit pending |
| 18:42 (manual) | `gh run cancel 25390924154` issued; took ~5 min for the cancellation to propagate |
| 18:47 | Pending deploy `25395143706` finally picks up the lock and ships the proofread fix |
| 18:46:55 | New `ai_search_refresh` starts on `25395143706`. **Same hang pattern resumes.** |

End-state of `25390924154`: `deploy` SUCCESS, `ai_search_refresh` ran 55+ minutes before manual cancellation. End-state of `25395143706`: same shape — script never completed on its own.

## Root cause (two problems stacked)

### 1. Architectural: shared concurrency group

`deploy.yml` declares `concurrency: { group: deploy, cancel-in-progress: false }` at the workflow level. GitHub Actions holds the workflow's concurrency lock until **all jobs in the run complete** — including `ai_search_refresh`. With `cancel-in-progress: false`, downstream runs queue rather than cancel the stuck run. With multiple runs queuing, GitHub keeps only the latest pending run and cancels intermediates.

Result: a single hung `ai_search_refresh` blocks every deploy for up to 60 minutes (its timeout).

### 2. Script-level: bare fetch calls without timeout

`scripts/ai-search-corpus-upload.mjs` makes four bare `fetch()` calls (lines ~303, 374, 405, 429) with no `AbortController` or `signal`. Node's global fetch has no default timeout. If the CF API endpoint accepts the TCP connection but never returns a response (server-side stall, intermediate proxy hang, etc.), the request hangs indefinitely. The retry/backoff loop only triggers on response-level errors and is never reached.

The `POLL_TIMEOUT_MS = 60_000` constant gates the *outer* polling loop but does not bind individual fetch calls; if one `fetch` inside the loop hangs, the loop never advances.

## Fix specification

### Phase 1 — Decouple workflows (priority)

**Move `ai_search_refresh` into its own workflow file.** The deploy workflow's concurrency lock is then released when the deploy job finishes. AI search refresh runs on its own schedule with its own (cancellable) concurrency group.

#### Create `.github/workflows/ai-search-refresh.yml`

```yaml
name: AI Search Refresh

on:
  workflow_run:
    workflows: ["Build & Deploy"]
    types: [completed]

permissions:
  contents: read
  actions: read

# Newer refresh runs cancel older ones. A hung refresh from the previous deploy
# is automatically superseded by the next deploy's refresh — no manual cancel,
# no deploy queue blockage.
concurrency:
  group: ai-search-refresh
  cancel-in-progress: true

jobs:
  refresh:
    if: ${{ github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event != 'pull_request' }}
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Restore data files from upstream deploy
        uses: actions/download-artifact@v4
        with:
          name: site-data
          path: src/data
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload corpus to AI Search
        id: ai_search_upload
        if: ${{ env.AI_SEARCH_API_TOKEN != '' }}
        timeout-minutes: 25
        env:
          AI_SEARCH_API_TOKEN: ${{ secrets.AI_SEARCH_API_TOKEN }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.AI_SEARCH_API_TOKEN }}
          D1_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: node scripts/ai-search-corpus-upload.mjs
        continue-on-error: true

      - name: Surface AI Search loader status
        if: always() && steps.ai_search_upload.conclusion != 'skipped'
        run: |
          if [ "${{ steps.ai_search_upload.outcome }}" = "success" ]; then
            echo "::notice title=AI Search corpus loader OK::Phase 1 corpus refresh complete."
          else
            echo "::warning title=AI Search corpus loader ${{ steps.ai_search_upload.outcome }}::The /ask v2 corpus index did not fully refresh on this deploy (outcome=${{ steps.ai_search_upload.outcome }}). Index will catch up on the next run via hash-skip; weekly reconcile cron will still fire."
          fi
```

#### Modify `.github/workflows/deploy.yml`

Remove lines 524-570 (the comment block + entire `ai_search_refresh:` job). The `Upload data files for AI Search refresh` artifact step in the `deploy` job (around line 423) **stays** — the new workflow downloads it via `run-id` cross-workflow.

Update the comment at line 417 from "AI Search corpus upload is a separate job (`ai_search_refresh` below)" to "AI Search corpus upload is a separate workflow (`.github/workflows/ai-search-refresh.yml`) — runs on workflow_run event after Build & Deploy success."

#### Gotchas

1. **Workflow file changes require `WORKFLOWS_PAT`.** Already wired into `merge.yml` (per `CLAUDE.md` "Git" section). No change needed.
2. **`workflow_run` triggers do NOT fire on workflow runs from PRs by default.** The `if:` filter excludes `pull_request` events explicitly to be safe.
3. **`actions: read` permission is required** to download artifacts from another workflow's run via `actions/download-artifact@v4` with `run-id` + `github-token`.
4. **Artifact retention is 1 day** (already set). Refresh must run within 24h of deploy or artifact is gone. With `workflow_run: completed` trigger this is fine — refresh fires within seconds of deploy completion.
5. **The `if: env.AI_SEARCH_API_TOKEN != ''` pattern** at the step level may evaluate before the step's `env` block is materialized in some edge cases. The current `deploy.yml` uses this pattern and it works there, so preserving it is safe; if it does fail closed, the result is "skip refresh on token-less environments" which is the desired behavior.
6. **No `repository_dispatch` or `workflow_dispatch` content publish should trigger AI Search refresh.** The `workflow_run` filter on `Build & Deploy` covers all three trigger types (push, repository_dispatch, workflow_dispatch) automatically — verify that single-record content publishes (Rose ingest, library worker dispatches) are still passing through the artifact upload step. They are: line 424's `if: ${{ !inputs.skip_fetch }}` only skips on the manual `workflow_dispatch` skip-fetch path.

### Phase 2 — Fix the underlying script hang (follow-up)

The architectural fix prevents AI search refresh from blocking deploys, but the script will still hang on individual runs (just no longer painfully). Independent fix:

Wrap the four bare `fetch()` calls in `scripts/ai-search-corpus-upload.mjs` (lines ~303, 374, 405, 429) with `AbortController` + per-request timeout:

```javascript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30_000); // per-request budget
try {
  const r = await fetch(url, { ...opts, signal: controller.signal });
  // existing logic
} finally {
  clearTimeout(timer);
}
```

Add a per-call timeout constant near the top of the script:

```javascript
const FETCH_TIMEOUT_MS = 30_000;  // hard cap per-request; script-level POLL_TIMEOUT_MS gates the outer loop
```

This is a separate PR. Do not bundle with Phase 1 — Phase 1 is the safe, fast win.

## Verification (Phase 1)

1. **Pre-merge:** confirm `workflow_run` syntax in the new workflow file by examining a known-working workflow_run example in the repo (e.g. any `*.yml` that uses `on: workflow_run:`).
2. **Post-merge, first deploy:**
   - Watch `Build & Deploy` complete normally — `deploy` job succeeds, no `ai_search_refresh` job in the run.
   - Confirm `AI Search Refresh` workflow fires automatically a few seconds later (look in Actions tab).
   - Confirm `ai-search-refresh` concurrency group has only ONE run at a time.
3. **Stress test:** push 2-3 trivial main commits in succession (e.g. via `gh workflow run "Build & Deploy"`), confirm:
   - Each deploy lands without queueing behind a prior `ai_search_refresh`.
   - Older `AI Search Refresh` runs are cancelled when newer ones start (look for `completed/cancelled` in the AI Search Refresh history).
4. **Hang-tolerance test:** if a refresh hangs (rare, but the underlying bug is still there until Phase 2), confirm that the next deploy is unaffected.

## Out of scope

- Reducing the deploy job's 15-min timeout
- Changing the `cancel-in-progress: false` policy on the deploy concurrency group (deploys SHOULD queue, not cancel each other)
- Anything in `scripts/ai-search-corpus-upload.mjs` (Phase 2 only)
- The `embed-library-ci.mjs` step in the deploy job (different vector store, different concurrency story)

## Files touched (Phase 1)

- `.github/workflows/ai-search-refresh.yml` (new)
- `.github/workflows/deploy.yml` (delete lines 524-570 + 1-line comment update)

## Branch / PR convention

`claude/ai-search-refresh-decouple` — auto-merges per project convention. Workflow file changes require `WORKFLOWS_PAT` (already configured in `merge.yml`).
