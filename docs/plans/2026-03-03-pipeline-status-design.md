# Pipeline Status Command -- Design

## Problem

The pipeline simulator has snapshot, validate, dry-run, and report commands but no knowledge of the deploy chain. When you edit an FAQ in Airtable, you can't ask "will this auto-deploy?" without manually checking automations, the CF Worker, GitHub Actions, and CF Pages secrets.

## Solution

Add `npm run pipeline:status` that verifies the full deploy chain from Airtable to production, including the Library's 7-hop pipeline.

## Deploy Chains

### Library (7 hops)

```
Wiki (Add) table
  → Airtable automation creates BIFID shell
  → Enrichment pipeline (metadata + AI classification)
  → "Sync to RRM Library" = "Synced"
  → Green-to-yellow base sync
  → Yellowbase automation POSTs to CF Worker
  → CF Worker (/api/library/deploy-record) validates X-Deploy-Secret
  → CF Worker fires repository_dispatch to GitHub
  → GitHub Actions: fetch-all → build → deploy to CF Pages
```

### Blog / FAQs (2 hops)

```
Airtable automation (Status/Answer Status = Published)
  → repository_dispatch via gitPAT to GitHub
  → GitHub Actions: fetch-all → build → deploy to CF Pages
```

### Courses (0 hops)

No automation. Manual deploy only.

## Status Command Checks

| Check | Method | Graceful failure |
|-------|--------|-----------------|
| Data file counts | Read local src/data/*.json | Always available |
| Snapshot age | Read .pipeline/snapshots/latest/meta.json | "No snapshot" |
| deploy.yml config | Parse YAML for repository_dispatch types | File not found |
| CF Worker alive | POST to endpoint, expect 401 | Network error → skip |
| CF Pages secrets | wrangler pages secret list | wrangler not available → skip |
| GitHub Actions last run | gh api actions/runs | gh not available → skip |
| Enrichment counts | Airtable API (greenbase) | AIRTABLE_PAT not set → skip |
| Wiki queue | Airtable API (greenbase wiki table) | AIRTABLE_PAT not set → skip |
| Sync lag detection | Compare BIFID synced count vs articles.json | AIRTABLE_PAT not set → skip |

## Files Modified

- `scripts/pipeline.mjs` -- SOURCES registry + status() function
- `package.json` -- pipeline:status script
