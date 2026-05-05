# Baseline scripts (Phase 1 of /arise whole-site plan)

These scripts capture HTTP/visual/schema/search/GSC/D1 behavior so post-fix regressions
are detectable instead of speculated. Run once at the start of each /arise sweep cycle;
later phases re-run them and diff against the prior baseline.

Storage convention: `~/iCode/.arise-baselines/YYYY-MM-DD/` (outside the repo).
The repo only tracks `docs/baselines/YYYY-MM-DD/manifest.json` (a small JSON pointer).

## Re-runnable layers

```bash
BL=~/iCode/.arise-baselines/$(date +%Y-%m-%d)
mkdir -p "$BL"/{build,test,d1,agent-surface,http,schema,search,visual,ae,gsc}

# Layers with re-runner scripts in this directory:
node scripts/baseline/http.mjs          "$BL/http/http-baseline.json"
node scripts/baseline/schema.mjs        "$BL/schema/jsonld-baseline.json"
node scripts/baseline/search.mjs        "$BL/search/top-queries.tsv" "$BL/search/search-baseline.json"
node scripts/baseline/visual.mjs        "$BL/visual"
python3 scripts/baseline/gsc.py         > "$BL/gsc/gsc-top-200.json"
bash scripts/baseline/d1-counts.sh      "$BL/d1"
bash scripts/baseline/agent-surface.sh  "$BL/agent-surface"

# Layers without dedicated scripts (re-run via the noted commands):
# build:  npm run build > "$BL/build/npm-build.txt"
#         npm run check-types > "$BL/build/check-types.txt"
#         arise-scan --json . > "$BL/build/arise-scan.json"
# test:   npm test > "$BL/test/unit.txt"
#         npx playwright test --reporter=json > "$BL/test/e2e.json"
# ae:     curl -X POST https://api.cloudflare.com/client/v4/accounts/<acct>/analytics_engine/sql
#         (queries by-dataset, by-path, by-functional-route, errors-7d -- see manifest.json)
```

## search baseline: top-queries provenance

`top-queries.tsv` is generated from D1 `rrm-analytics.search_log`. Re-generate before
each search baseline run:

```bash
CF_TOKEN=$(op read 'op://Automation/Cloudflare API Token - Claude Code Full Access/credential')
CLOUDFLARE_API_TOKEN="$CF_TOKEN" npx wrangler d1 execute rrm-analytics --remote --json \
  --command "SELECT query, COUNT(*) AS n FROM search_log
             WHERE user_agent_short NOT LIKE '%curl%'
               AND user_agent_short NOT LIKE '%bot%'
               AND query IS NOT NULL
               AND LENGTH(query) BETWEEN 3 AND 60
               AND query NOT LIKE '%>%'
             GROUP BY LOWER(query) ORDER BY n DESC LIMIT 50" \
  | jq -r '.[0].results[] | "\(.n)\t\(.query)"' > "$BL/search/top-queries.tsv"
```

## Phase 1 baseline: 2026-05-05

Tag: `arise-sweep-2026-05-05-baseline`
Manifest: `docs/baselines/2026-05-05/manifest.json`

Captured 11 layers: build, test, D1, agent-surface, HTTP (55 URLs), schema (18 pages,
36 JSON-LD blocks), search (50 queries), visual (28 pages × 2 viewports), AE (7-day
telemetry), GSC (top 200 pages), plus the manifest itself.

## Diff strategy

**Fast diff (after every fix):** re-run `http.mjs` + `agent-surface.sh` + `d1-counts.sh`;
compare with the locked baseline. Any drift = investigate before merging the fix.

**Deep diff (per fix wave):** re-run everything; use `scripts/diff-baseline.mjs` (Phase 5,
TODO) to surface differences across visual, search ranking, and JSON-LD shape.

**AE diff:** after every TIER A fix, re-query `by-functional-route` for last 4-24h and
compare error count to the locked baseline.

## Tag dereferencing

The git tag `arise-sweep-YYYY-MM-DD-baseline` is annotated. To get the underlying commit:

```bash
git rev-parse arise-sweep-YYYY-MM-DD-baseline^{}     # commit SHA
git cat-file -p arise-sweep-YYYY-MM-DD-baseline      # tag object (message + commit pointer)
```

The manifest's `git_commit` field is the commit that physically contains `manifest.json`
in the working tree -- i.e. the same SHA you get from `git rev-parse <tag>^{}`.
