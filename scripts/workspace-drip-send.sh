#!/bin/zsh
# Lane A drip: approved copy, from "Dr. Naomi Whittaker" <community@rrmacademy.org>,
# via VA draft -> va-send.sh. One message per recipient, paced. Hardened per the
# 2026-07-11 three-lens review:
#   - no || fallback on the dedup grep (a fully-sent log previously resurrected
#     the FULL roster and would have double-sent all 41)
#   - mkdir lock so two concurrent sessions can't both walk the roster
#   - preflight on all input files + sha256 of the approved body recorded
#   - exclusions from D1 email_log (unsubscribed/bounced/complained + already
#     sent by this campaign) on top of the local sent log
#   - pacing sleep on EVERY path (failures no longer rip through the list)
#   - gog/va-send stderr captured to the run log; orphan drafts deleted on fail
#   - each successful send inserted into D1 email_log (house rule), best-effort
# NOTE: the 2026-07-10 campaign is COMPLETE (41/41). Inputs were moved to Trash;
# preflight will refuse to run unless a new roster/body is staged deliberately.
set -u
ROSTER=/tmp/laneA-roster.csv
SENTLOG=$HOME/iCode/.run-log/fertility-rule-drip.sent
RUNLOG=$HOME/iCode/.run-log/fertility-rule-drip.run.log
TXT=/tmp/approved-B.txt
HTML=/tmp/approved-B.html
SUBJ='Help shape what fertility benefits cover, by July 13'
SRC=fertility-rule-drip
DELAY=50
ACCT=virtualassistant@rrmacademy.org

mkdir -p "$(dirname "$SENTLOG")"; touch "$SENTLOG"

# --- observation layer (house rule mail-components-logging-observation):
# push-alert failures to Telegram -- a channel independent of email. Best-effort.
TG_TOKEN=$(op read 'op://Automation/RRM n8n Notifications telegram/password' 2>/dev/null || true)
TG_CHAT=8444326757
tg_alert() {
  [ -n "$TG_TOKEN" ] || return 0
  curl -sS -m 10 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
    -d chat_id="$TG_CHAT" --data-urlencode text="[drip:$SRC] $1" >/dev/null 2>&1 || true
}

# --- concurrency lock (macOS has no flock; mkdir is atomic)
LOCK=/tmp/${SRC}.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another drip is already running (lock: $LOCK) -- refusing"; exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

# --- preflight: inputs must exist and be non-empty (all live in volatile /tmp)
for f in "$ROSTER" "$TXT" "$HTML"; do
  [ -s "$f" ] || { echo "PREFLIGHT FAIL: missing/empty $f"; exit 1; }
done
echo "body sha256: $(shasum -a 256 "$TXT" "$HTML" | awk '{print $1}' | tr '\n' ' ')" | tee -a "$RUNLOG"

# --- D1 exclusions: opt-outs/bounces/complaints + already-sent for this campaign
export CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-$(op read 'op://Automation/CF - D1 Operator - account/credential')}
export CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-ecf2c5bc8b5ebd634bcb587b3890910a}
EXCL=$(npx --prefix "$HOME/iCode/projects/rrm-academy-cf" wrangler d1 execute rrm-auth --remote --json --command \
  "SELECT DISTINCT lower(email) e FROM email_log WHERE (event IN ('unsubscribed','bounced','complained') OR (event='sent' AND source='$SRC')) AND email LIKE '%@%'" 2>/dev/null \
  | python3 -c "import sys,json
try:
    for r in json.load(sys.stdin)[0]['results']: print(r['e'])
except Exception: pass")
if [ -z "$EXCL" ]; then
  echo "WARN: D1 exclusion query returned nothing (network/token?) -- relying on local sent log only" | tee -a "$RUNLOG"
fi

# --- recipients = roster minus local sent log minus D1 exclusions.
# grep -v exits 1 when NOTHING is left -- that is idempotent success, not error.
ALL=$(tail -n +2 "$ROSTER" | cut -d, -f1 | sed '/^$/d' | tr '[:upper:]' '[:lower:]' | sort -u)
RECIPS=$(printf '%s\n' "$ALL" | grep -vxF -f "$SENTLOG" || true)
if [ -n "$EXCL" ]; then
  RECIPS=$(printf '%s\n' "$RECIPS" | grep -vxF -f <(printf '%s\n' "$EXCL") || true)
fi
TOTAL=$(printf '%s\n' "$RECIPS" | sed '/^$/d' | wc -l | tr -d ' ')
echo "drip: $TOTAL to send (local sent log: $(wc -l < "$SENTLOG" | tr -d ' '), D1 exclusions: $(printf '%s\n' "$EXCL" | sed '/^$/d' | wc -l | tr -d ' ')), ${DELAY}s apart" | tee -a "$RUNLOG"

i=0
for EM in ${(f)RECIPS}; do
  [ -z "$EM" ] && continue
  i=$((i+1))
  # re-check the sent log per recipient (another process may have appended)
  grep -qxF "$EM" "$SENTLOG" && { echo "[$i/$TOTAL] skip (already sent) $EM"; continue; }

  DID=$(gog -a "$ACCT" --gmail-no-send -j gmail drafts create \
    --from community@rrmacademy.org --to "$EM" --subject "$SUBJ" \
    --body-file "$TXT" --body-html-file "$HTML" 2>>"$RUNLOG" \
    | python3 -c "import sys,json
try:
    d=json.load(sys.stdin); print(d.get('id') or d.get('draftId') or (d.get('draft') or {}).get('id',''))
except Exception: pass" 2>>"$RUNLOG")

  if [ -z "$DID" ]; then
    echo "[$i/$TOTAL] DRAFT-FAIL $EM (see $RUNLOG)" | tee -a "$RUNLOG"
    tg_alert "DRAFT-FAIL $EM ($i/$TOTAL)"
    sleep $DELAY   # pace failures too -- systematic failure must not rip through the list
    continue
  fi

  if bash ~/.claude/skills/gmail/scripts/va-send.sh "$DID" >>"$RUNLOG" 2>&1; then
    echo "$EM" >> "$SENTLOG"
    echo "[$i/$TOTAL] sent -> $EM"
    # house rule: record the send in D1 email_log (best-effort, never fatal)
    npx --prefix "$HOME/iCode/projects/rrm-academy-cf" wrangler d1 execute rrm-auth --remote --command \
      "INSERT INTO email_log (event,email,category,source,subject,detail) VALUES ('sent','${EM//\'/\'\'}','campaign','$SRC','${SUBJ//\'/\'\'}','workspace-lane draft $DID')" \
      >/dev/null 2>>"$RUNLOG" || echo "  WARN sent-but-unlogged-in-D1 $EM" | tee -a "$RUNLOG"
  else
    RC=$?
    echo "[$i/$TOTAL] SEND-FAIL (rc=$RC) $EM draft=$DID (see $RUNLOG)" | tee -a "$RUNLOG"
    tg_alert "SEND-FAIL rc=$RC $EM ($i/$TOTAL)"
    # clean up the orphan draft so a later manual "send all drafts" can't blast it
    gog -a "$ACCT" --gmail-no-send gmail drafts delete "$DID" >>"$RUNLOG" 2>&1 \
      || echo "  WARN orphan draft left: $DID for $EM" | tee -a "$RUNLOG"
  fi
  [ $i -lt $TOTAL ] && sleep $DELAY
done
echo "DRIP COMPLETE: $(wc -l < "$SENTLOG" | tr -d ' ') total in sent log ($SENTLOG); run log: $RUNLOG"
