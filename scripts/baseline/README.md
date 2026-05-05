# Baseline scripts (Phase 1 of /arise whole-site plan)

These scripts capture HTTP/visual/schema/search/GSC behavior so post-fix regressions
are detectable instead of speculated. They are run once at the start of each /arise
sweep cycle; later phases re-run them and diff against the prior baseline.

## Usage

```bash
BL=~/iCode/.arise-baselines/$(date +%Y-%m-%d)
mkdir -p "$BL"/{http,schema,search,visual,gsc}

node scripts/baseline/http.mjs "$BL/http/http-baseline.json"
node scripts/baseline/schema.mjs "$BL/schema/jsonld-baseline.json"

# search needs top-queries.tsv first (D1 query in manifest)
node scripts/baseline/search.mjs "$BL/search/top-queries.tsv" "$BL/search/search-baseline.json"

node scripts/baseline/visual.mjs "$BL/visual"
python3 scripts/baseline/gsc.py > "$BL/gsc/gsc-top-200.json"
```

Scripts are idempotent. Output goes to `~/iCode/.arise-baselines/YYYY-MM-DD/` (outside the repo).
The repo only tracks `docs/baselines/YYYY-MM-DD/manifest.json` (a small JSON pointer).

## Phase 1 baseline: 2026-05-05

Tag: `arise-sweep-2026-05-05-baseline`
Manifest: `docs/baselines/2026-05-05/manifest.json`

Captured 11 layers: build, test, D1, agent-surface, HTTP (55 URLs), schema (18 pages, 36 JSON-LD blocks),
search (50 queries), visual (28 pages × 2 viewports), AE (7-day telemetry), GSC (top 200 pages),
plus the manifest itself.

## Diff strategy

Fast diff (after every fix): re-run http.mjs + agent-surface curls + D1 row counts; compare with the
locked baseline. Any drift = investigate before merging the fix.

Deep diff (per fix wave): re-run everything; use `scripts/diff-baseline.mjs` (Phase 5, TODO) to
surface differences across visual, search ranking, and JSON-LD shape.
