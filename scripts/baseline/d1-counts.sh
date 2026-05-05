#!/usr/bin/env bash
# D1 row counts re-runner -- per-table COUNT(*) for the diff side of the regression check.
# Usage: scripts/baseline/d1-counts.sh <output-dir>
# Writes <output-dir>/{rrm-auth,rrm-survey,rrm-analytics}-counts.txt and -tables.json.
set -euo pipefail

OUT="${1:-$HOME/iCode/.arise-baselines/$(date +%Y-%m-%d)/d1}"
mkdir -p "$OUT"

CF_TOKEN="${CLOUDFLARE_API_TOKEN:-$(op read 'op://Automation/Cloudflare API Token - Claude Code Full Access/credential')}"
export CLOUDFLARE_API_TOKEN="$CF_TOKEN"

for db in rrm-auth rrm-survey rrm-analytics; do
  echo "[$db] table list..."
  npx wrangler d1 execute "$db" --remote --json \
    --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" \
    > "$OUT/${db}-tables.json"

  : > "$OUT/${db}-counts.txt"
  jq -r '.[0].results[].name' "$OUT/${db}-tables.json" \
    | grep -v '^sqlite_\|^_cf_KV$' \
    | while IFS= read -r t; do
        c=$(npx wrangler d1 execute "$db" --remote --json \
              --command "SELECT COUNT(*) AS c FROM \"$t\"" 2>/dev/null \
            | jq -r '.[0].results[0].c' 2>/dev/null)
        echo "$t: $c" >> "$OUT/${db}-counts.txt"
      done
  echo "[$db] $(wc -l < "$OUT/${db}-counts.txt") tables counted"
done
