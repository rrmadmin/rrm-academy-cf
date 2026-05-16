#!/usr/bin/env bash
# Apply migration 022 (provider directory) idempotently.
# Per PRD §11 Phase 0: ALTER ADD COLUMN cannot use IF NOT EXISTS in SQLite,
# so we wrap each ALTER in a try-pattern (continue on "duplicate column").
# The CHECK rebuild is skipped if existing predicate already covers target.

set -euo pipefail

DB="${DB:-rrm-auth}"
TARGET="${1:-local}"  # local | remote

if [[ "$TARGET" != "local" && "$TARGET" != "remote" ]]; then
  echo "Usage: $0 [local|remote]" >&2
  exit 2
fi

WRANGLER_FLAG="--$TARGET"
echo "Applying migration 022 to D1 '$DB' ($TARGET)..."

# Phase A: CREATE TABLEs (file 022, all IF NOT EXISTS -> idempotent)
echo "==> 022 (10 CREATE TABLE)"
npx wrangler d1 execute "$DB" $WRANGLER_FLAG --file=migrations/022-provider-directory.sql

# Phase B: ALTER partners (file 022b, run one ALTER at a time, skip duplicates)
echo "==> 022b (partners ALTER ADD COLUMNs)"
# Split file into individual statements and run each in a tolerant loop.
grep -E '^ALTER TABLE partners ADD COLUMN' migrations/022b-partners-extend.sql | while read -r stmt; do
  echo "  -> $stmt"
  if ! npx wrangler d1 execute "$DB" $WRANGLER_FLAG --command "$stmt" 2>&1 | tee /tmp/wrangler-alter.out | grep -q 'Executed'; then
    if grep -q 'duplicate column name' /tmp/wrangler-alter.out; then
      echo "     (skip: column already exists)"
    else
      echo "     FAIL on '$stmt'" >&2
      cat /tmp/wrangler-alter.out >&2
      exit 1
    fi
  fi
done
# Apply the UNIQUE INDEX (CREATE INDEX IF NOT EXISTS is idempotent)
npx wrangler d1 execute "$DB" $WRANGLER_FLAG --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_badge_token ON partners(badge_token) WHERE badge_token IS NOT NULL;"

# Phase C: CHECK rebuild - skip if existing predicate already covers target
echo "==> 022c (partners CHECK rebuild guard)"
WRANGLER_OUT=$(npx wrangler d1 execute "$DB" $WRANGLER_FLAG --command "SELECT sql FROM sqlite_master WHERE name='partners';" 2>&1)
WRANGLER_RC=$?
EXISTING_SCHEMA=$(echo "$WRANGLER_OUT" | tr -d '\n')
if [ $WRANGLER_RC -ne 0 ] || ! echo "$EXISTING_SCHEMA" | grep -qE 'CREATE TABLE.*partners'; then
  echo "FAIL: could not read partners schema (wrangler rc=$WRANGLER_RC)" >&2
  echo "$WRANGLER_OUT" >&2
  exit 1
fi
if echo "$EXISTING_SCHEMA" | grep -q "awaiting_payment"; then
  echo "  -> existing CHECK already includes paid-tier states; skipping rebuild"
else
  echo "  -> rebuilding partners CHECK constraint"
  # Strip BEGIN/COMMIT (D1 rejects raw transactions per feedback-d1-rejects-raw-transactions.md)
  grep -v -E '^(BEGIN TRANSACTION|COMMIT);?$' migrations/022c-partners-check-rebuild.sql > /tmp/022c-stripped.sql
  npx wrangler d1 execute "$DB" $WRANGLER_FLAG --file=/tmp/022c-stripped.sql
fi

# Phase D: DROP practitioner (LAST, destructive)
echo "==> 022d (DROP practitioner)"
npx wrangler d1 execute "$DB" $WRANGLER_FLAG --file=migrations/022d-drop-practitioner.sql

echo "OK: migration 022 applied to $TARGET"
