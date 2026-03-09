#!/bin/bash
# Quick unpublish a blog post by record ID.
# Sets Airtable status to "Review" and triggers a full site rebuild.
#
# Usage:
#   ./scripts/unpublish-post.sh recXXXXXXXXXX
#   ./scripts/unpublish-post.sh              # defaults to endo post

set -euo pipefail

RECORD_ID="${1:-rec4Xdip2J41iV5s2}"
BASE_ID="app1CKV1heL0qH2Oz"
TABLE_ID="tblS8q3XHj6mhwxvl"
TOKEN="$(op read 'op://Automation/OpenClaw Airtable PAT/credential')"

echo "Unpublishing record: $RECORD_ID"

# 1. Get current status and title
CURRENT=$(curl -s "https://api.airtable.com/v0/$BASE_ID/$TABLE_ID/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN")

TITLE=$(echo "$CURRENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['fields'].get('Title','?'))")
STATUS=$(echo "$CURRENT" | python3 -c "import sys,json; print(json.load(sys.stdin)['fields'].get('Status','?'))")

echo "  Title:  $TITLE"
echo "  Status: $STATUS"

if [ "$STATUS" != "Published" ]; then
  echo "  Already not published (status: $STATUS). Triggering rebuild anyway."
fi

# 2. Set status to Review
curl -s -X PATCH "https://api.airtable.com/v0/$BASE_ID/$TABLE_ID/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"Status":"Review"}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('  Airtable:', 'OK' if r.get('id') else 'FAILED')"

# 3. Trigger full rebuild
echo "  Triggering rebuild..."
gh workflow run "Build & Deploy" --repo rrmadmin/rrm-academy-cf

echo "Done. Post will be removed from site when build completes (~2 min)."
echo "Monitor: gh run list --repo rrmadmin/rrm-academy-cf --limit 1"
