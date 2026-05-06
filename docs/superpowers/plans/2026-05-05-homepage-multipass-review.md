# Homepage Multi-Pass Review Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the audit-then-apply pipeline for `rrmacademy.org/` (homepage) producing a Brian-approved set of edits via 4 parallel audits and 1 Gianna apply, then verify live.

**Architecture:** 5-wave pipeline plus Wave preflight gate. Audits read-only. Apply gated on preview deploy. Auto-merge fires only on green gates.

**Tech Stack:** Claude Code Task tool for agent dispatch, Bash for orchestration glue, git for branch isolation, CF Pages for preview deploy, GH Actions auto-merge for production push.

**Reference:** Full design at `docs/superpowers/specs/2026-05-05-homepage-multipass-review-design.md`. When the spec and plan disagree, the spec wins.

---

## File Structure

| File | Action |
|---|---|
| this file | Plan |
| `docs/audits/2026-05-05-homepage-multipass-context.md` | Run context (Task 1) |
| `docs/audits/2026-05-05-homepage-aeo-seo-geo.md` | Wave 1 output |
| `docs/audits/2026-05-05-homepage-messaging-grammar.md` | Wave 2 output |
| `docs/audits/2026-05-05-homepage-internal-linking.md` | Wave 3 output |
| `docs/audits/2026-05-05-homepage-voc.md` | Wave 4 output |
| `docs/audits/2026-05-05-homepage-apply-sheet.md` | Persisted Apply Sheet (Task 4) |
| `docs/audits/2026-05-05-homepage-proof-gates.sh` | Per-row gate script (Task 7) |
| `docs/audits/2026-05-05-homepage-multipass-final-report.md` | Final report (Task 12) |
| `src/pages/index.astro` | Modified by Wave 5 ONLY |

Branch: `claude/homepage-multipass-2026-05-05-<HHMM>` (created in Task 1).

---

## Tasks

### Task 1: Initialize execution context

**Files:**
- Read: `docs/superpowers/specs/2026-05-05-homepage-multipass-review-design.md`
- Create: `docs/audits/2026-05-05-homepage-multipass-context.md`

- [ ] **Step 1: Compute HHMM + branch name**

```bash
HHMM=$(date +%H%M)
BRANCH="claude/homepage-multipass-2026-05-05-$HHMM"
```

- [ ] **Step 2: Pre-creation collision check**

```bash
git ls-remote --heads origin 'claude/homepage-multipass-2026-05-05*'
```

If any matching branch exists, surface to Brian: `DELETE-PRIOR / RESUME-PRIOR <branch> / NEW-SUFFIX / ABORT`. Default on no-response: ABORT.

- [ ] **Step 3: Pin BASE_SHA from main**

```bash
git fetch origin main
BASE_SHA=$(git rev-parse origin/main)
```

- [ ] **Step 4: Create execution branch**

```bash
git checkout -B "$BRANCH" "$BASE_SHA"
```

- [ ] **Step 5: Write context file + commit**

`docs/audits/2026-05-05-homepage-multipass-context.md`:
```
RUN_TIMESTAMP: <HHMM>
BASE_SHA: <sha>
BRANCH: <branch>
SPEC: docs/superpowers/specs/2026-05-05-homepage-multipass-review-design.md
HOMEPAGE_PATH: src/pages/index.astro
HOMEPAGE_LINE_COUNT: <wc -l output>
```

```bash
git add docs/audits/2026-05-05-homepage-multipass-context.md
git commit -m "init: homepage multipass run context ($HHMM)"
```

### Task 2: Dispatch waves 1-4 in parallel

**Files:**
- Read: spec §Wave 1, §Wave 2, §Wave 3, §Wave 4
- Read: `src/pages/index.astro`
- Create (by sub-agents): 4 audit `.md` files in `docs/audits/`

- [ ] **Step 1: Compose 4 agent briefs**

Each brief inlines the spec section verbatim plus:
- Source file path: `src/pages/index.astro`
- Output file path: `docs/audits/2026-05-05-homepage-<wave-slug>.md`
- Apply Sheet row schema (composite wave-id, normalized `action_type` enum, line-range MANDATORY, `excerpt`, `suggested_fix`, `override_note`)
- Top-N caps: Wave 1 = 30, Wave 2 = 60 (20+20+20), Wave 3 = 20, Wave 4 = 30
- Read-only constraint: agent writes only to its audit file; no source modification
- BASE_SHA: `<from Task 1>` (so all audits reference same source state)

For Wave 4 specifically:
- Loaded VOC sources: `rrm-voc/endo-masterclass.md`, `audience-personas.md`, `adversary-personas.md`, `endo-masterclass-buyer-motivations.md`, `projects/neofertility-ie/docs/briefs/about-brief.md` + `treatment-brief.md` + `pricing-brief.md` (Michelle persona), `projects/neofertility-ie/docs/voice-tone-analysis.md`
- Inline regex snapshot from `feedback-michelle-scope-legitimization.md` at audit time
- Mandatory MICHELLE-WARMTH tag on every warmth-addition recommendation regardless of regex
- VOC-gap recs default to BACKLOG disposition

- [ ] **Step 2: Dispatch all 4 in single message**

Use 4 Agent tool calls in one message:
- Wave 1: `subagent_type: "rrma-seo-operator"`
- Wave 2: `subagent_type: "gianna-copywriter"` in audit mode
- Wave 3: `subagent_type: "general-purpose"` with `internal-linking-optimizer` skill loaded
- Wave 4: `subagent_type: "general-purpose"` with `rrm-voc` skill loaded + Michelle docs

- [ ] **Step 3: Wait for all 4 returns**

Each agent returns a brief summary. Actual artifact: the audit `.md` file written to disk.

### Task 3: Wave preflight gate

**Files:**
- Verify: 4 audit files exist + non-empty + structurally valid

- [ ] **Step 1: Existence + non-empty check**

```bash
for slug in aeo-seo-geo messaging-grammar internal-linking voc; do
  path="docs/audits/2026-05-05-homepage-$slug.md"
  if [ ! -s "$path" ]; then
    echo "MISSING: $path"
    PREFLIGHT_FAIL=1
  fi
done
```

- [ ] **Step 2: Structural check**

For each audit, grep required sections:
- Wave 1: `Findings table`, `Schema audit`, `Pages-clean`
- Wave 2: `must-fix`, `should-fix`, `consider`
- Wave 3: `Recommendations table`
- Wave 4: `VOC alignment`, `MICHELLE-WARMTH`

- [ ] **Step 3: On preflight fail, surface to Brian**

Surface this prompt verbatim:
```
Wave preflight: Wave N (<wave name>) is missing or malformed.
  Detected: <which file failed and why>
Choose: RETRY (re-dispatch Wave N) | SKIP-AND-PROCEED (continue with N-1 audits) | ABORT
```

Default on no-response: ABORT. Do not silently proceed.

- [ ] **Step 4: Commit audit files**

```bash
git add docs/audits/2026-05-05-homepage-{aeo-seo-geo,messaging-grammar,internal-linking,voc}.md
git commit -m "audit: 4-wave homepage review (preflight green)"
```

### Task 4: Build Apply Sheet

**Files:**
- Read: 4 audit `.md` files
- Create: `docs/audits/2026-05-05-homepage-apply-sheet.md`

- [ ] **Step 1: Parse each audit's findings into structured rows**

Per spec §Apply Sheet schema. Synthesize composite wave-id (W1-N, W2-must-fix-N, etc.) where the audit didn't emit one. Map native verbs → normalized `action_type`.

- [ ] **Step 2: Dedupe**

Merge rows with same line range + same primary issue category into one row with `waves: [W1, W2, ...]` attribution. Auto-flag as multi-wave consensus (typically suggests AUTO-APPLY).

- [ ] **Step 3: Conflict-check**

For each row pair, compute conflict via:
- (a) line-range overlap
- (b) section-heading overlap
- (c) opposing action verbs within 50-line proximity (e.g., DELETE ↔ REWRITE on same span; ADD ↔ TRIM in same section)

Tag conflicting pairs.

- [ ] **Step 4: Apply default dispositions**

- All MICHELLE-WARMTH rows → suggest DEFER (default)
- All VOC-gap rows → suggest BACKLOG (default)
- Multi-wave consensus rows → suggest APPLY
- Conflicting rows → suggest pairwise resolution
- Unmentioned rows → DEFER

- [ ] **Step 5: Cap per wave**

W1=30, W2=60, W3=20, W4=30. Bulk-handle low-severity via category groupings (e.g., `BULK-APPLY alt-text` for all alt-text fixes).

- [ ] **Step 6: Write Apply Sheet markdown**

Format per spec §Apply Sheet schema. Include preamble: totals, conflict warnings, bulk shortcuts, strict ruling format reminder.

### Task 5: Brian review gate

**Files:**
- Read: `docs/audits/2026-05-05-homepage-apply-sheet.md`

- [ ] **Step 1: Present Apply Sheet inline + commit it**

```bash
git add docs/audits/2026-05-05-homepage-apply-sheet.md
git commit -m "build: homepage Apply Sheet ready for review"
git push origin "$BRANCH"
```

Render Apply Sheet inline in chat with totals + conflict warnings + this ruling format:
```
W1-3: APPLY
W2-must-fix-1: APPLY (note: "only delete the em-dash, do not rewrite sentence")
W3-7: DEFER
W4-michelle-warmth-2: APPLY
BULK-DEFER all alt-text: DEFER
... etc
```

- [ ] **Step 2: Wait for Brian's rulings**

Required to proceed. Auto mode does not bypass this gate.

- [ ] **Step 3: Parse rulings**

Strict per-row parser. On any deviation (free-form, ranges, conditional), re-prompt with parse failure surfaced. Bulk shortcuts: `BULK-APPLY <category>` and `BULK-DEFER <category>` only with category enumerated. Bulk APPLY does NOT satisfy MICHELLE-WARMTH (per spec M1).

- [ ] **Step 4: Apply default dispositions**

For unmentioned rows: DEFER. MICHELLE-WARMTH unmentioned: DEFER (mandatory). BACKLOG: stays BACKLOG unless explicit `APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS`.

- [ ] **Step 5: Empty-Apply-Sheet short-circuit**

If `count(APPLY rows) == 0`, skip Tasks 6-11; emit "No actionable findings" report and stop. Per spec H11.

- [ ] **Step 6: Re-snapshot legitimization regex**

Per spec M2: re-read `feedback-michelle-scope-legitimization.md` from current memory. Re-run against the audit's MICHELLE-WARMTH rows. Any new match → re-tag or DROP and notify Brian.

- [ ] **Step 7: Commit resolved Apply Sheet**

```bash
git add docs/audits/2026-05-05-homepage-apply-sheet.md
git commit -m "rule: Brian's Apply Sheet rulings applied"
```

### Task 6: Build Gianna apply brief

**Files:**
- Read: resolved Apply Sheet
- Create (in-memory): brief for Gianna agent dispatch

- [ ] **Step 1: Filter to APPLY rows**

Includes regular APPLY + APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS.

- [ ] **Step 2: Split into prose + schema batches**

Schema batch: rows with `action_type` ∈ {ADD-SCHEMA, MODIFY-SCHEMA, REWRITE-SCHEMA}.
Prose batch: everything else.

- [ ] **Step 3: Apply canonical edit order within each batch**

1. DELETEs descending line number
2. REWRITEs descending line number
3. TRIMs descending line number
4. ADDs descending line number

Schema batch runs LAST after all prose edits complete.

- [ ] **Step 4: Construct Gianna brief**

For each row: id, native_action, action_type, location (line-range + section), excerpt, suggested_fix, override_note, 30-char anchor strategy reminder, BASE_SHA pin.

Hard constraints (from spec §Wave 5):
- Em-dash count = 0 in body prose (entity forms covered; en-dash banned in body, allowed in numeric ranges)
- Legitimization regex from `feedback-michelle-scope-legitimization.md` applies to OUTPUT (not just recs)
- No new claims, no new sections (relaxed only for APPLY-WITH-RELAXED rows)
- Preserve `<sup>` and JSON-LD blocks intact (em-dash count excludes these regions)
- Only `src/pages/index.astro` modified
- Each Edit must include >=30-char leading + >=30-char trailing context for stable anchoring
- Re-grep before each Edit; abort on BASE_SHA drift

### Task 7: Generate proof-gates.sh

**Files:**
- Read: resolved Apply Sheet
- Create: `docs/audits/2026-05-05-homepage-proof-gates.sh`

- [ ] **Step 1: Per-row assertions**

For each APPLY row, emit a deterministic assertion:
- ADD-PROSE: `grep -F "<new prose snippet>"` returns 1+
- ADD-LINK: `grep -F 'href="<new href>"'` returns 1+
- REWRITE-PROSE: `grep -vF "<old>"` AND `grep -F "<new>"` both pass
- DELETE-PROSE: `grep -F "<deleted>"` returns 0
- ADD-SCHEMA: JSON-LD field presence via `jq` after extraction
- RE-ANCHOR: `grep -F "<new anchor text>"` returns 1+
- RETARGET: `grep -F 'href="<new href>"'` returns 1+

- [ ] **Step 2: Append global gates**

```bash
# Em-dash count: 0 (excluding JSON-LD + <sup>)
# Strip protected blocks first, then count
clean=$(echo "$B" | python3 -c "
import sys, re
html = sys.stdin.read()
html = re.sub(r'<script type=\"application/ld\\+json\">.*?</script>', '', html, flags=re.S)
html = re.sub(r'<sup[^>]*>.*?</sup>', '', html, flags=re.S)
print(html)
")
em=$(echo "$clean" | grep -oE '(—|&mdash;|&#8212;|&#x2014;)' | wc -l)
[ "$em" -eq 0 ] || echo "FAIL em-dash=$em"

# Internal links 200 with retry
for href in $(echo "$B" | grep -oE 'href="(/[^"]*|https://rrmacademy.org[^"]*)"' | sed 's/href="//;s/"//' | sort -u); do
  url="$href"
  [[ "$url" =~ ^/ ]] && url="https://rrmacademy.org$url"
  for i in 1 2 3; do
    status=$(curl -sIL -o /dev/null -w "%{http_code}" "$url")
    [ "$status" = "200" ] && break
    [[ "$status" =~ ^4 ]] && echo "STICKY $status $url" && break
    sleep 5
    [ "$i" = "3" ] && echo "FLAKY $status (3/3) $url"
  done
done

# JSON-LD parses
echo "$B" | python3 -c "
import sys, re, json
html = sys.stdin.read()
for m in re.finditer(r'<script type=\"application/ld\\+json\">(.*?)</script>', html, flags=re.S):
  try: json.loads(m.group(1))
  except Exception as e: print(f'FAIL JSON-LD parse: {e}'); sys.exit(1)
"

# Legitimization regex (snapshot from memory at gate-generation time)
LEGIT_REGEX='not (irrational|being heartless|being cruel|acting carelessly|bad advice)|...'
em_legit=$(echo "$B" | grep -E "$LEGIT_REGEX" | wc -l)
[ "$em_legit" -eq 0 ] || echo "FAIL legitimization=$em_legit"
```

- [ ] **Step 3: Make executable + commit**

```bash
chmod +x docs/audits/2026-05-05-homepage-proof-gates.sh
git add docs/audits/2026-05-05-homepage-proof-gates.sh
git commit -m "gate: per-row proof gates for homepage multipass"
```

### Task 8: Wave 5 dispatch (Gianna apply mode)

**Files:**
- Modify: `src/pages/index.astro` (only file)

- [ ] **Step 1: Verify BASE_SHA still matches main HEAD**

```bash
git fetch origin main
CURRENT_SHA=$(git rev-parse origin/main)
if [ "$CURRENT_SHA" != "$BASE_SHA" ]; then
  echo "DRIFT: main moved during pipeline. BASE=$BASE_SHA HEAD=$CURRENT_SHA"
  # Surface REBASE / ABORT prompt to Brian
fi
```

- [ ] **Step 2: Dispatch Gianna in apply mode**

Single Agent call with `subagent_type: "gianna-copywriter"` and the full brief from Task 6. Required outputs in agent return:
- Edit log with file:line context per Edit
- Em-dash count post-apply (must be 0)
- Final line count of `src/pages/index.astro`
- Schema-diff JSON if schema batch ran (before/after JSON-LD blocks)
- Single commit hash

- [ ] **Step 3: Mid-batch failure handling**

If Gianna reports any Edit failure:
1. `git checkout -- src/pages/index.astro` (revert WIP)
2. Surface to Brian: `RETRY / ABANDON-BATCH / SKIP-AND-CONTINUE`
3. No partial commits unless Brian explicitly chooses SKIP-AND-CONTINUE

- [ ] **Step 4: Verify single-commit invariant**

If Gianna produced multiple commits, fold via interactive rebase before push. If she produced 0 commits, treat as failure and re-dispatch.

### Task 9: Pre-merge gate (preview deploy)

**Files:**
- Push: `preview/homepage-multipass-<HHMM>` branch
- Verify: CF Pages preview URL

- [ ] **Step 1: Push apply commit to preview branch**

```bash
PREVIEW_BRANCH="preview/homepage-multipass-$HHMM"
git push origin "HEAD:$PREVIEW_BRANCH"
```

The `preview/*` namespace does NOT auto-merge.

- [ ] **Step 2: Wait for CF Pages preview deploy**

```bash
# Poll CF Pages API for branch deploy status
# Timeout: 300s
```

- [ ] **Step 3: Run proof gates against preview URL**

```bash
PREVIEW_URL="<resolved CF Pages preview URL>"
B=$(curl -s "$PREVIEW_URL?cb=$(date +%s)")
bash docs/audits/2026-05-05-homepage-proof-gates.sh "$PREVIEW_URL"
```

- [ ] **Step 4: On red, per-gate disposition**

Per spec §Post-Deploy Proof Gates:
- Em-dash > 0: auto-revert (Brian confirms)
- Broken internal link: auto-revert (Brian confirms)
- AEO probe regression: notify-only (Brian decides patch / accept)
- JSON-LD parse fail: emergency revert (no Brian prompt)
- Legitimization match: auto-revert (Brian confirms)

If preview infrastructure unavailable: fall back to manual-merge mode. Brian types `MERGE` after seeing post-deploy gate output. Document mode in commit message.

### Task 10: FF claude/* branch + auto-merge

**Files:**
- Push: `claude/homepage-multipass-2026-05-05-<HHMM>` branch

- [ ] **Step 1: FF claude/* branch to apply commit SHA**

```bash
git push origin "HEAD:$BRANCH"
```

- [ ] **Step 2: Watch `Merge Claude Branches` workflow**

```bash
sleep 30
gh run list --branch "$BRANCH" --limit 3
```

If workflow didn't fire (per memory `feedback-push-event-silent-drop.md`), retrigger via empty commit + push.

- [ ] **Step 3: Watch `Build & Deploy` workflow**

Per `rrma-deploy` skill conventions. Wait for green.

### Task 11: Post-deploy verify

**Files:**
- Verify: live `https://rrmacademy.org/`

- [ ] **Step 1: Run proof gates against live URL**

```bash
B=$(curl -s "https://rrmacademy.org/?cb=$(date +%s)")
bash docs/audits/2026-05-05-homepage-proof-gates.sh "https://rrmacademy.org/"
```

- [ ] **Step 2: AEO probe**

Use `ai-surface-check` skill against the live page.

- [ ] **Step 3: Per-row APPLY verification**

For each APPLY row, confirm assertion passes against live HTML.

### Task 12: Final report + index entry

**Files:**
- Append: `~/iCode/projects/rrm-router/RRM Router PRD/.arise-index.json` (if exists; spec-review entry)
- Create: `docs/audits/2026-05-05-homepage-multipass-final-report.md`

- [ ] **Step 1: Compose final report**

Structure:
- Run timestamp + BASE_SHA + final commit SHA + branch name
- Per-wave finding counts
- Apply Sheet totals (APPLY / DEFER / DROP / BACKLOG / multi-wave-consensus)
- Wave 5 commit hash + edit log + per-row diff stats
- Pre-merge gate results
- Post-deploy verify results
- Per-row APPLY verification table
- Deferred items list (BACKLOG + DEFER, for future re-surface)
- Commit-message format per spec M12: all 4 waves listed unconditionally

- [ ] **Step 2: Commit + push final report**

```bash
git add docs/audits/2026-05-05-homepage-multipass-final-report.md
git commit -m "report: homepage multipass complete (run $HHMM)"
git push origin "$BRANCH"
```

---

## Stop conditions

Stop and surface to Brian if any of these fire:
- Branch collision detected (Task 1 Step 2): default ABORT
- Wave preflight failure (Task 3 Step 3): default ABORT
- Apply Sheet has zero APPLY rows after rulings (Task 5 Step 5): skip Wave 5, emit clean report
- BASE_SHA drift mid-pipeline (Task 8 Step 1): REBASE / ABORT
- Gianna mid-batch Edit failure (Task 8 Step 3): RETRY / ABANDON-BATCH / SKIP-AND-CONTINUE
- Pre-merge gate red (Task 9 Step 4): per-gate disposition
- Post-deploy verify red (Task 11): per-gate disposition
- Conflicting APPLY rows that fail commutativity check (Task 4): pairwise resolution required

## Single-pass commit history

This plan should produce these commits on `claude/homepage-multipass-2026-05-05-<HHMM>`:

1. `init: homepage multipass run context (<HHMM>)`
2. `audit: 4-wave homepage review (preflight green)`
3. `build: homepage Apply Sheet ready for review`
4. `rule: Brian's Apply Sheet rulings applied`
5. `gate: per-row proof gates for homepage multipass`
6. `apply: <Gianna's commit message per spec format>` (single commit, all approved edits)
7. `report: homepage multipass complete (run <HHMM>)`

Total: 7 commits. Auto-merge fires on commit 6 only (the apply commit), gated by Task 9 preview-deploy verification.
