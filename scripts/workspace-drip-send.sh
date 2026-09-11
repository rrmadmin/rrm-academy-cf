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
# The paths keep their exact previous values when nothing is set, and are
# overridable ONLY so test/workspace-drip-cap.test.mjs can drive the cap gate
# over its own fixture rosters instead of writing the live /tmp inputs a staged
# campaign uses. No default, and no behaviour, changes.
ROSTER=${ROSTER:-/tmp/laneA-roster.csv}
SENTLOG=${SENTLOG:-$HOME/iCode/.run-log/fertility-rule-drip.sent}
RUNLOG=${RUNLOG:-$HOME/iCode/.run-log/fertility-rule-drip.run.log}
TXT=${TXT:-/tmp/approved-B.txt}
HTML=${HTML:-/tmp/approved-B.html}
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
LOCK=${LOCK:-/tmp/${SRC}.lock}
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another drip is already running (lock: $LOCK) -- refusing"; exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

# --- preflight: inputs must exist and be non-empty (all live in volatile /tmp)
for f in "$ROSTER" "$TXT" "$HTML"; do
  [ -s "$f" ] || { echo "PREFLIGHT FAIL: missing/empty $f"; exit 1; }
done
echo "body sha256: $(shasum -a 256 "$TXT" "$HTML" | awk '{print $1}' | tr '\n' ' ')" | tee -a "$RUNLOG"

# --- THE WARM LANE'S 300 CAP, SELF-ENFORCED (spec section 6).
# This drip IS the Warm lane, and the cap is the lane's, not the wrapper's: run
# straight from a shell rather than under tools/mail-cap/send-cap.sh and nothing
# else counts the roster. The count below derives the drip's OWN recipient set,
# the same way the roster is read further down, so the number gated is the
# number mailed. The refusal is send-cap.sh's, verbatim in substance: it names
# the bulk rail and the command, because an operator with a 3,000-name list
# needs to be told where the run belongs, not merely stopped.
CAP_RUN_LOG_DIR="${MAIL_CAP_RUN_LOG_DIR:-$HOME/iCode/.run-log/mail-cap}"
mkdir -p "$CAP_RUN_LOG_DIR" 2>/dev/null || true
cap_log_line() {
  printf '%s\t%s\tcount=%s\tmax=%s\tfile=%s\tcmd=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${MAIL_CAP_MAX:-300}" "$ROSTER" "workspace-drip-send.sh" \
    >> "$CAP_RUN_LOG_DIR/send-cap.log" 2>/dev/null || true
}

# A non-numeric MAIL_CAP_MAX is REFUSED, never treated as "no cap": an arithmetic
# comparison against '3OO' errors, and a cap that fails open is not a cap.
case "${MAIL_CAP_MAX:-300}" in
  ''|*[!0-9]*)
    echo "REFUSED: MAIL_CAP_MAX is not a number: '${MAIL_CAP_MAX:-300}'" >&2
    echo "Unset it for the default of 300, or set it to digits only." >&2
    cap_log_line refused 0
    exit 2
    ;;
esac

# The lowercase fold is not cosmetic: the real recipient set below folds case
# before `sort -u`, so Ada@x.com and ada@x.com are ONE recipient there. A cap
# pipeline without the fold counts two, and would refuse a roster the drip would
# have sent inside the cap. Gate what is sent, not what is typed.
CAP_COUNT=$(tail -n +2 "$ROSTER" | cut -d, -f1 | sed '/^$/d' | tr '[:upper:]' '[:lower:]' | sort -u | wc -l | tr -d ' ')
if [ "$CAP_COUNT" -gt "${MAIL_CAP_MAX:-300}" ]; then
  cat >&2 <<MSG
REFUSED: $CAP_COUNT recipients is over the Warm lane cap of ${MAIL_CAP_MAX:-300}.

The Warm lane is a personal Workspace send, reserved for paying STUC members.
A run this size belongs on the BULK RAIL, which sends as
newsletter@rrmacademy.com through SES under a warm-up ramp, a daily cap and a
complaint circuit breaker:

  cd ~/iCode/projects/rrm-academy-cf
  node scripts/bulk-send.mjs --campaign <key> --subject <file> --body <file>

That is a dry run. It prints the audience after exclusions, today's remaining
cap and the cohort head before anything is sent.
MSG
  cap_log_line refused "$CAP_COUNT"
  exit 2
fi
cap_log_line allowed "$CAP_COUNT"

# DRIP_DRY_RUN=1 stops here, having proved the cap and nothing else. It exists
# for the test that drives this script over a 301-row and a 300-row roster: the
# drip has no other dry-run switch, and a cap gate nobody has watched refuse is
# a decoration.
if [ "${DRIP_DRY_RUN:-0}" = "1" ]; then
  echo "DRIP_DRY_RUN: cap check passed at $CAP_COUNT recipients; nothing was sent"
  exit 0
fi

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
