# Homepage Multi-Pass Review, Design Spec

**Date:** 2026-05-05
**Target:** `src/pages/index.astro` (rrmacademy.org/, 859 lines)
**Status:** Draft for Brian approval

## Goal

A coordinated AEO/SEO/GEO + Gianna messaging+grammar + internal linking + VOC review of the RRM Academy homepage, executed as four parallel read-only audits feeding one consolidated apply pass via Gianna. Single edit pass prevents the cross-pass collision that would happen if four agents tried to edit the same paragraphs in series.

## Architecture

Audit-then-apply pipeline. Five waves total, plus an explicit Wave preflight between audits and Apply Sheet.

```
Wave 1 (parallel)        rrma-seo-operator   -> docs/audits/2026-05-05-homepage-aeo-seo-geo.md
Wave 2 (parallel)        gianna (audit mode) -> docs/audits/2026-05-05-homepage-messaging-grammar.md
Wave 3 (parallel)        general-purpose     -> docs/audits/2026-05-05-homepage-internal-linking.md
Wave 4 (parallel)        general-purpose     -> docs/audits/2026-05-05-homepage-voc.md

[Wave preflight: orchestrator confirms all 4 audit files exist, are non-empty,
 contain expected sections. On failure: prompt Brian RETRY / SKIP-AND-PROCEED / ABORT.]

[Orchestrator collates into Apply Sheet -> Brian APPLY/DEFER/DROP per row]

[Approved Apply Sheet committed to docs/audits/2026-05-05-homepage-apply-sheet.md]

Wave 5 (sequential)      gianna (apply mode) -> single Edit batch + commit
Verify (preview + post-deploy)  em-dash count, grep checks, AEO probe, link 200 spot-checks
```

### Wave preflight gate

Between audits and Apply Sheet construction, the orchestrator MUST verify all four audit files exist, are non-empty, and contain the structural sections specified per wave. On any failure, surface this prompt to Brian verbatim:

```
Wave preflight: Wave N (<wave name>) is missing or malformed.
  Detected: <which file failed and why>
Choose: RETRY (re-dispatch Wave N) | SKIP-AND-PROCEED (continue with N-1 audits) | ABORT
```

Default disposition on no response: ABORT. Do not silently proceed with three audits.

## Branch + Commit Strategy

**Branch naming.** Branch is `claude/homepage-multipass-2026-05-05-HHMM` where HHMM is the local-time start of the orchestrator run (e.g., `claude/homepage-multipass-2026-05-05-1430`). Date-only names collide on same-day re-runs.

**Pre-creation collision check.** Orchestrator runs `git ls-remote --heads origin 'claude/homepage-multipass-2026-05-05*'` before branch creation. If any matching branch exists, surface this prompt:

```
Prior homepage-multipass branch detected: <branch list>
Choose: DELETE-PRIOR (force-delete and start fresh) | RESUME-PRIOR <branch> | NEW-SUFFIX (auto-add HHMM) | ABORT
```

**Auto-merge interaction.** Per `feedback-rrm-academy-cf-auto-merge.md`: any commit on `claude/*` that is main+1 fast-forwards `main` within minutes. This spec treats that as the operating reality and adapts:

- Audit-only commits (the four `docs/audits/*.md` files) ARE allowed to auto-merge to main; they are read-only doc additions and pose no live-site risk.
- The Wave 5 apply commit (the only commit that touches `src/pages/index.astro`) MUST pass the preview-deploy proof gates BEFORE the auto-merge fires. See §Pre-Merge Gate below.
- Brian's approved Apply Sheet (`docs/audits/2026-05-05-homepage-apply-sheet.md`) is committed BEFORE Wave 5 dispatches, so Gianna reads from a persisted artifact instead of an ephemeral chat message.

**Pre-Merge Gate.** Because rrm-academy-cf auto-FFs main, the orchestrator gates the Wave 5 apply commit on a CF Pages preview deploy:

1. Push the apply commit to a non-`claude/*` branch first (e.g., `preview/homepage-multipass-<HHMM>`). This branch does not auto-merge.
2. Wait for CF Pages preview deploy. Run all proof gates against the preview URL.
3. On preview-green, fast-forward the `claude/homepage-multipass-2026-05-05-HHMM` branch to the same SHA. Auto-merge fires; main goes live.
4. On preview-red, do not push to the `claude/*` branch. Surface remediation prompt (see §Post-Deploy Proof Gates).

If the preview-deploy infrastructure is unavailable or misbehaving, fall back to manual-merge-after-gates: Brian explicitly types `MERGE` in chat after seeing post-deploy gate output. Document which mode this run used in the commit message.

## Wave 1, AEO / SEO / GEO Audit (read-only)

**Agent:** `rrma-seo-operator`

**Scope:** Schema.org coverage + quality (FAQPage, EducationalOrganization, Person, OfferCatalog, WebSite/SearchAction; audit shape/depth); AEO snippet eligibility per H2 (deck-as-answer; FAQ vs body card alignment); GEO retrieval surface (llms.txt, agent-card, well-known endpoints, RRM/NaPro/FABM entity disambiguation); heading hierarchy; meta title/description vs GSC top queries; title-tag + OG-image variants; Naomi entity anchors (ORCID, NPI, sameAs); alt-text completeness; canonical URLs; internal anchor density + alignment from retrieval angle; 8K-token query coverage gap (5-10 queries not surfaced).

**Output structure:**
- Summary: total findings, severity counts, top 3 highest-leverage opportunities
- Findings table: `id` (W1-N format), `severity`, `location` (file:line-range + section heading; e.g., `src/pages/index.astro:142-148 / Hero`), `excerpt` (verbatim quoted text being addressed), `issue`, `suggested_fix` (the exact replacement or addition prose, OR a tight description if structural), `aeo_seo_geo_impact`, `native_action` (KEEP / TRIM / ADD / DELETE / REWRITE), `proposed_action_type` (mapped per §Apply Sheet schema)
- Top-N cap: maximum 30 findings. If the audit identifies more, retain the top 30 by leverage and list the residual count in the summary.
- Schema audit subsection
- Pages-clean subsection (sections reviewed with no findings)

**Read-only constraint:** absolutely no source modifications. The agent writes only to its audit file.

## Wave 2, Gianna Messaging + Grammar Audit (read-only)

**Agent:** `gianna-copywriter` in audit mode (not apply mode)

**Loaded context:**
- `rrm-voc` skill (endo-masterclass profile)
- `audience-personas.md` (8 personas, patient + clinician segments)
- `adversary-personas.md` (counter-personas)
- RRM editorial rules from CLAUDE.md hierarchy

**Scope:** voice vs Naomi's clinical-empathy register (per `pillar-proofread`); em-dash hunt (count = 0); grammar / typos / awkward phrasing / hedging / passive evasions; capitalization (NaProTechnology, RRM, FABM, FEMM, IIRRM, STORRM); RRM editorial rule violations (NaPro vs RRM distinction; never-recommend-IVF; no Hilgers protocols/dosings; "unexplained" -> "uninvestigated"; no "cure infertility"; cost claims specific or omitted); internal duplication (verbatim + paraphrase-on-adjacent-paragraphs deck-vs-body blind spot); section-opener sanity vs high-anxiety audience sequencing (Recognize -> Mirror -> Prove -> Explain -> Offer).

**Output structure:** mirrors the proofread report from `pillar-proofread` skill, with structural rigor for downstream Apply Sheet construction:
- Must-fix / should-fix / consider tiers
- Each finding emits: `id` (W2-must-fix-N / W2-should-fix-N / W2-consider-N), `tier`, `location` (file:line-range MANDATORY; section heading alone is NOT acceptable), `excerpt` (verbatim), `issue`, `suggested_fix` (the exact replacement prose), `proposed_action_type` (per §Apply Sheet schema)
- Top-N cap: maximum 20 must-fix + 20 should-fix + 20 consider. Residual count in summary.

**Read-only constraint:** Gianna writes only to her audit file. No source edits.

## Wave 3, Internal Linking Audit (read-only)

**Agent:** `general-purpose` with `internal-linking-optimizer` skill loaded

**Scope:** outbound link inventory (target, anchor, surrounding context); anchor vs target alignment; orphan-opportunity detection for high-value terms (endometriosis, PCOS, NaProTechnology, NaPro, FEMM, FABM, RRM, Naomi Whittaker, excision surgery, cycle charting, unexplained infertility, recurrent miscarriage, ovulation, restorative reproductive medicine); pillar cluster cohesion (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/common-questions-about-rrm`, `/glossary/`, `/library/`, `/courses/`, `/faqs/`); over-linking (>2 inline per paragraph); broken / 404 / legacy anchors (live curl, see scope guard); anchor diversity (variants vs exact-match repetition); funnel correctness (CTA next-step destinations per persona).

**Live-curl scope guard.** The "live curl check on flagged links" is restricted to same-origin (`rrmacademy.org`) URLs. External links are flagged "verify manually" and reported without a curl. Same-origin curl is rate-limited to 1 req/sec; results are cached within the audit session to avoid re-curling.

**Output structure:**
- Link inventory table
- Orphan-opportunity table
- Recommendations table: `id` (W3-N), `severity`, `native_action` (ADD / RETARGET / REMOVE / RE-ANCHOR), `proposed_action_type` (per §Apply Sheet schema; ADD-LINK / RE-ANCHOR / RETARGET / DELETE-LINK), `location` (file:line-range MANDATORY), `excerpt` (the surrounding sentence containing the existing or target anchor), `current_anchor`, `current_target`, `suggested_fix` (proposed anchor + target combined), `rationale`, `persona served`
- Top-N cap: maximum 20 recommendations. Residual count in summary.

## Wave 4, VOC Audit (read-only, dual-VOC)

**Agent:** `general-purpose` with `rrm-voc` skill loaded

**Loaded VOC sources:**
- RRM Academy: `rrm-voc/endo-masterclass.md`, `audience-personas.md`, `adversary-personas.md`, `endo-masterclass-buyer-motivations.md`, raw CSV at `docs/marketing/endo-masterclass-intake-raw.csv`
- NeoFertility (Michelle persona): `projects/neofertility-ie/docs/briefs/about-brief.md`, `projects/neofertility-ie/docs/briefs/treatment-brief.md`, `projects/neofertility-ie/docs/briefs/pricing-brief.md` (each describes the Michelle avatar in detail), and `projects/neofertility-ie/docs/voice-tone-analysis.md`
- Memory: `feedback-michelle-scope-boundary.md`, `feedback-michelle-scope-legitimization.md`

**Michelle profile baseline (extracted):**
- 33-43, married, 1-7+ years trying to conceive
- Often post-failed-IVF or told donor-eggs-only
- Proactive researcher; late-funnel trust mode
- Comfort going to ANY OB/GYN: 1.1 / 5
- Concerns at homepage land: "is this real, credible, will I actually be helped here?"

**Scope:** per-section copy vs buyer emotional state; Recognize -> Mirror -> Prove -> Explain -> Offer arc; clinician-speak vs buyer-language slip points; VOC-gap detection (cost transparency, pathway clarity, "what happens at first appointment," timeline expectations, age/AMH framing, IVF-already-failed framing); high-anxiety-audience rule violations (stats-before-empathy, combative-against-IVF positioning, urgency manipulation).

**Critical scope guard (Michelle legitimization rule):**
The audit may identify spots where Michelle-avatar warmth would help, but recommendations must NOT include legitimization-as-warmth phrasing. Banned patterns from `feedback-michelle-scope-legitimization.md` (snapshotted verbatim into the audit file at audit time):

```
not (irrational|being heartless|being cruel|acting carelessly|bad advice)
(honest|logical|reasonable|sensible) (step|advice|option|logic|pathway)
within (that|their) paradigm
is not wrong to
real option
right option
not bad advice
```

The regex is a tripwire for known patterns. Semantic paraphrase (e.g., "your skepticism is well-grounded") passes the regex but is still a scope violation. Therefore:

- **MICHELLE-WARMTH tag (mandatory).** EVERY Wave 4 rec that ADDs prose addressing VOC tone, empathy, or buyer-state alignment MUST be tagged `MICHELLE-WARMTH`, regardless of regex match. Regex is necessary but not sufficient.
- **Default disposition: DEFER.** MICHELLE-WARMTH rows require row-level explicit `APPLY <row-id>`. Bulk commands (`APPLY all`, `BULK-APPLY warmth`) do NOT satisfy the requirement; silence and bulk default to DEFER.
- **VOC-gap recommendations** get default disposition `BACKLOG` (excluded from Wave 5 by default; Wave 5 forbids new sections/claims). To pull a VOC-gap row into Wave 5, Brian marks it `APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS`; orchestrator forwards the flag and Gianna relaxes the rule for that single row.
- **Regex re-snapshot.** Orchestrator re-runs CURRENT memory's regex over the audit's MICHELLE-WARMTH rows BEFORE Apply Sheet construction. Any new match (regex evolved between audit and apply) triggers re-tag or DROP with notification to Brian.

**Output structure:**
- Summary
- Regex snapshot (verbatim regex list used at audit time, with timestamp)
- Per-section VOC alignment table (section heading + line-range + buyer state expected + what page delivers + alignment verdict)
- VOC gap recommendations: `id` (W4-gap-N), `location` (file:line-range MANDATORY; sections converted to ranges), `excerpt`, `issue`, `suggested_fix`, `disposition` (BACKLOG default), `proposed_action_type`
- Michelle warmth recommendations: `id` (W4-warmth-N), `location` (line-range MANDATORY), `excerpt`, `issue`, `suggested_fix`, `disposition` (DEFER default), `proposed_action_type` (ADD-PROSE / REWRITE-PROSE)
- Top-N cap: 15 VOC-gap + 15 warmth. Residual in summary.

## Orchestrator Apply Sheet

After all 4 audits commit AND pass the Wave preflight gate, the orchestrator collates findings into a single Apply Sheet with a structured row schema.

### Row schema

Every row has the same columns regardless of source wave:

| Column | Description |
|---|---|
| `id` | Composite wave-id (e.g., `W1-3`, `W2-must-fix-1`, `W3-7`, `W4-warmth-2`, `W4-gap-4`). Globally unique. Waves 2 and 4 MUST emit synthesized ids; orchestrator does not retroactively assign. |
| `waves` | Array of attributing waves. Single-wave rows have one entry; dedup'd rows have multiple. |
| `severity` | `must-fix` / `should-fix` / `consider` (W2 native) or `high` / `medium` / `low` (W1/3/4), normalized. |
| `location` | `file:line-range + section`. Line-range MANDATORY (e.g., `src/pages/index.astro:142-148 / Hero`). Rows lacking line-range are rejected at preflight. |
| `excerpt` | Verbatim text from `src/pages/index.astro`. Required except for ADD-only rows where there is no pre-existing text (those use surrounding sentence as anchor). |
| `issue` | What is wrong, in audit voice. |
| `suggested_fix` | Exact replacement / addition prose / anchor href. Verbatim, ready to paste. |
| `action_type` | Normalized enum (see below). |
| `proposed_disposition` | `APPLY` / `DEFER` / `BACKLOG` / `NO-OP-RATIONALE`. |
| `conflict-check` | Flags overlapping rows. |
| `tags` | Multi-value: `MICHELLE-WARMTH`, `VOC-GAP`, `SCHEMA`, `LEGITIMIZATION-REGEX-HIT`. |
| `override_note` | Filled by Brian; forwarded verbatim to Gianna. |

### `action_type` enum

`ADD-PROSE`, `ADD-LINK`, `ADD-SCHEMA`, `DELETE-PROSE`, `DELETE-LINK`, `REWRITE-PROSE`, `REWRITE-SCHEMA`, `TRIM-PROSE`, `RE-ANCHOR`, `RETARGET`, `NO-OP-RATIONALE`. Schema-tagged action_types (`ADD-SCHEMA`, `REWRITE-SCHEMA`) auto-route to the schema sub-batch (see §Wave 5).

### Native-enum to action_type mapping

| Wave | Native | Maps to |
|---|---|---|
| W1 | KEEP / TRIM / ADD / DELETE / REWRITE | NO-OP / TRIM-PROSE / ADD-{PROSE,LINK,SCHEMA} / DELETE-{PROSE,LINK} / REWRITE-{PROSE,SCHEMA}. Audit specifies prose vs link vs schema. |
| W2 | must-fix / should-fix / consider | severity; action_type derived from `suggested_fix` shape (REWRITE-PROSE / TRIM-PROSE / DELETE-PROSE). |
| W3 | ADD / RETARGET / REMOVE / RE-ANCHOR | ADD-LINK / RETARGET / DELETE-LINK / RE-ANCHOR. |
| W4 | warmth / gap | ADD-PROSE or REWRITE-PROSE, auto-tagged `MICHELLE-WARMTH` (warmth) or `VOC-GAP` with default disposition `BACKLOG` (gap). |

### Dedup, conflict-check, ruling format

**Dedup (mandatory).** If two or more rows have the same line-range AND the same primary issue category (em-dash, capitalization, broken link, paraphrase dup), merge into one row with `waves: [W1, W2, ...]`. Merged rows are auto-flagged `multi-wave consensus` (AUTO-APPLY-recommended).

**Conflict-check (expanded).** Flags any two rows where: (a) line-ranges overlap, OR (b) section-heading values match, OR (c) opposing action verbs appear within 50 lines (e.g., `ADD-PROSE` at L298 + `DELETE-PROSE` at L280-285). On conflict, Brian must reduce to one merged APPLY row OR `APPLY` one + `DEFER` other. `APPLY both` is valid only if orchestrator mechanically verifies commutativity (no shared character ranges, no opposing verbs). Contradictory `APPLY both` is rejected.

**Brian's ruling format.** Strict per-row:

```
W1-3 APPLY
W1-4 DEFER
W2-must-fix-1 APPLY (note: keep first sentence intact)
W2-must-fix-2 DROP
W4-warmth-3 APPLY
```

Bulk shortcuts permitted only for explicitly enumerated, non-warmth categories: `BULK-APPLY <category>` and `BULK-DEFER <category>` where the orchestrator has listed category membership inline (e.g., "alt-text-fixes contains: W1-7, W1-8, W1-12"). MICHELLE-WARMTH rows are exempt from bulk: each requires a row-level explicit `APPLY <id>`.

Default disposition for unmentioned rows: DEFER. On any parse deviation (missing id, unrecognized keyword, ambiguous range), the orchestrator re-prompts Brian with the parse failure surfaced. No silent inference.

### Persisted artifact

After Brian's ruling and conflict resolution, orchestrator commits the resolved Apply Sheet to `docs/audits/2026-05-05-homepage-apply-sheet.md` BEFORE Wave 5 dispatch. Gianna reads from disk, not from chat. `override_note` preserved verbatim per row.

### Empty-Apply-Sheet short-circuit

If `count(APPLY rows after ruling) == 0`, orchestrator SKIPS Wave 5, emits "No actionable findings, homepage clean", commits the empty sheet for the audit trail, stops. Wave 5 is never dispatched on an empty sheet.

## Wave 5, Gianna Consolidated Apply

**Agent:** `gianna-copywriter` in apply mode.

**Inputs:** persisted Apply Sheet at `docs/audits/2026-05-05-homepage-apply-sheet.md` (APPLY rows only), `rrm-voc` skill, CLAUDE.md editorial hierarchy, pinned `BASE_SHA` (HEAD at Apply Sheet persistence time).

### Edit anchor strategy

Naive line-number re-grep fails when multiple edits hit the same paragraph. Mandated:

- Every Edit MUST use `old_string` with >=30 chars of leading context AND >=30 chars of trailing context. File:line citations are advisory only; success/failure depends on the text anchor.
- The Edit tool's `old_string` uniqueness is the primary safety net. If non-unique, expand context until unique; if expansion fails (truly identical paragraphs), Gianna refuses the Edit and surfaces a "non-unique anchor" failure.
- ADD-only rows (no pre-existing `excerpt`): anchor is the surrounding sentence pair (preceding + following), used as `old_string`; `new_string` contains both surrounding sentences plus the addition.

### Canonical edit order (deterministic)

1. `DELETE-PROSE` / `DELETE-LINK`, descending by line number.
2. `REWRITE-PROSE`, descending.
3. `TRIM-PROSE`, descending.
4. `ADD-PROSE` / `ADD-LINK` / `RE-ANCHOR` / `RETARGET`, descending.
5. Schema sub-batch (`ADD-SCHEMA`, `REWRITE-SCHEMA`) executes last with its own validation.

Reruns of the same Apply Sheet produce identical commits.

### Base-SHA pin and HEAD check

Before each Edit, Wave 5 verifies `git rev-parse HEAD == BASE_SHA`. On drift (concurrent commit, auto-FF interference), Wave 5 aborts immediately, runs `git checkout -- src/pages/index.astro`, surfaces a "base SHA drift" failure. Brian's choices: `REBASE-AND-RETRY` | `ABORT`. The orchestrator pauses any other agent dispatch on this branch for the duration of Wave 5; audit-only auto-merge is allowed before Wave 5 starts, not during.

### Schema sub-batch

After all prose edits, schema rows run with these pre-commit checks:

1. `node -e 'JSON.parse(...)'` per `<script type="application/ld+json">` block on the modified file. Any parse failure aborts and reverts.
2. `npm run ssot:validate` to confirm site-ssot prebuild assertions still hold.

Failure triggers `git checkout -- src/pages/index.astro` and surfaces remediation.

### Mid-batch failure rollback

On any Edit failure (anchor mismatch, non-unique, write error, schema parse fail):

1. `git checkout -- src/pages/index.astro` to restore pre-apply state.
2. Log row-id + reason.
3. Surface: `Wave 5 Edit <row-id> failed: <reason>. Working tree restored. Choose: RETRY | ABANDON-BATCH | SKIP-AND-CONTINUE`.

Default: ABANDON-BATCH. Partial commits only on explicit SKIP-AND-CONTINUE; commit message records `Skipped: <row-id> (<reason>)`.

### Constraints

- Only `src/pages/index.astro` modified.
- No new claims, no new sections, no scope creep, EXCEPT for rows tagged `APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS` (Wave 4 VOC-gap).
- Preserve `<sup>` citations and JSON-LD blocks intact unless the row explicitly addresses them.
- Em-dash count in working tree must be 0 BEFORE commit (regex from §Proof Gates against working-tree file).
- The Michelle legitimization regex (snapshotted in Wave 4) applies to the OUTPUT of every Edit, not just recommendations. Pre-commit: run regex against the full diff body. Any match aborts and reverts.
- Voice gates rerun after each batch.

### Dispatch failure handling

If Gianna fails to start (rate limit, agent error, network), retry with backoff: 60s, 240s, 600s. After the third failure, orchestrator commits `apply-pending.md` documenting the approved Apply Sheet status, notifies Brian "apply did not run". Re-running requires explicit re-dispatch against the persisted Apply Sheet.

### Output and commit message

Single commit on the staging branch (`preview/homepage-multipass-<HHMM>`):

```
Apply homepage multipass review (4 waves)

Wave 1 (AEO/SEO/GEO): X applied, Y deferred, Z dropped
Wave 2 (messaging+grammar): X applied, Y deferred, Z dropped
Wave 3 (internal linking): X applied, Y deferred, Z dropped
Wave 4 (VOC): X applied, Y deferred, Z dropped (W backlog)

Applied row ids: W1-3, W1-4, W2-must-fix-1, ...
Skipped (if any): <row-id> (<reason>)

Apply Sheet: docs/audits/2026-05-05-homepage-apply-sheet.md
Base SHA: <sha>
Mode: preview-gated | manual-merge-after-gates
```

All four waves listed unconditionally, even when X=Y=Z=0. After preview-deploy gates pass, the `claude/homepage-multipass-2026-05-05-HHMM` branch is fast-forwarded; auto-merge fires.

## Pre-Merge and Post-Deploy Proof Gates

These gates run TWICE: against the CF Pages preview-deploy URL BEFORE auto-merge fires (blocking pre-merge gate), and against the live URL after auto-merge ships (sanity post-deploy gate). The gate script is parameterized on `TARGET_URL`. Auto-merge predicate: `preview-deploy-green AND pre-merge-gates-green`. If preview infra unavailable, fall back to manual-merge-after-gates.

### Per-row proof gates (generated)

The orchestrator generates `docs/audits/2026-05-05-homepage-proof-gates.sh` during Wave 5. Each APPLY row produces a deterministic assertion: ADD-PROSE/ADD-LINK/ADD-SCHEMA gates check presence; DELETE-* gates check absence; REWRITE-* gates check both old-absent AND new-present; TRIM-PROSE checks trimmed-fragment present + removed-fragment absent; RE-ANCHOR/RETARGET check new-half present + old-half absent; NO-OP-RATIONALE has no assertion. JSON-LD field assertions go through `jq` against the extracted `<script type="application/ld+json">` block.

### Standard gates

```bash
TARGET_URL="${TARGET_URL:-https://rrmacademy.org/}"  # preview URL pre-merge, live URL post-deploy
B=$(curl -s "${TARGET_URL}?cb=$(date +%s)")

# Filter HTML to exclude JSON-LD and <sup> blocks for prose-level checks
B_FILTERED=$(echo "$B" | python3 -c '
import sys, re
src = sys.stdin.read()
src = re.sub(r"<script type=\"application/ld\+json\">.*?</script>", "", src, flags=re.DOTALL)
src = re.sub(r"<sup>.*?</sup>", "", src, flags=re.DOTALL)
sys.stdout.write(src)
')

# 1. Em-dash count must be 0. Catches U+2014 plus HTML entity forms.
EMDASH=$(echo "$B_FILTERED" | grep -oE "($(printf '\xe2\x80\x94')|&mdash;|&#8212;|&#x2014;)" | wc -l | tr -d ' ')
[ "$EMDASH" = "0" ] || echo "GATE FAIL: em-dash count $EMDASH"

# 1b. En-dash (U+2013) outside numeric ranges: must be 0 (advisory). Numeric ranges (33-43) allowed.
ENDASH=$(echo "$B_FILTERED" | grep -oE "[^0-9]–[^0-9]" | wc -l | tr -d ' ')
echo "en-dash outside numeric ranges: $ENDASH"

# 2. Per-row assertions
bash docs/audits/2026-05-05-homepage-proof-gates.sh "$TARGET_URL" || echo "GATE FAIL: per-row"

# 3. Page status 200
STATUS=$(curl -sI "$TARGET_URL" | head -1 | awk '{print $2}')
[ "$STATUS" = "200" ] || echo "GATE FAIL: page status $STATUS"

# 4. Internal links 200 check with retry-on-flake (3 attempts, 5s backoff for 5xx; 4xx is immediate fail)
echo "$B" | grep -oE 'href="(/[^"]*|https://rrmacademy.org[^"]*)"' | sort -u | while read href; do
  url=$(echo "$href" | sed 's|href="||;s|"||')
  [[ "$url" =~ ^/ ]] && url="https://rrmacademy.org$url"
  for attempt in 1 2 3; do
    status=$(curl -sIL -o /dev/null -w "%{http_code}" --max-time 10 "$url")
    case "$status" in
      2*|3*) break ;;
      4*) echo "STICKY $status $url"; break ;;
      5*) [ "$attempt" -lt 3 ] && sleep 5 || echo "FLAKY $status (3/3) $url" ;;
      *) [ "$attempt" -lt 3 ] && sleep 5 || echo "UNKNOWN $status (3/3) $url" ;;
    esac
  done
done

# 5. JSON-LD parse-cleanness (hard fail, emergency revert)
echo "$B" | python3 -c '
import sys, re, json
src = sys.stdin.read()
blocks = re.findall(r"<script type=\"application/ld\+json\">(.*?)</script>", src, flags=re.DOTALL)
ok = True
for i, blk in enumerate(blocks):
    try: json.loads(blk)
    except Exception as e:
        print(f"GATE FAIL: JSON-LD block {i}: {e}"); ok = False
sys.exit(0 if ok else 1)
' || echo "GATE FAIL: JSON-LD"

# 6. Michelle legitimization regex tripwire (delta from baseline)
echo "$B_FILTERED" | grep -oE "(not (irrational|being heartless|being cruel|acting carelessly|bad advice)|(honest|logical|reasonable|sensible) (step|advice|option|logic|pathway)|within (that|their) paradigm|is not wrong to|real option|right option|not bad advice)" | wc -l | tr -d ' '

# 7. AEO probe via aeo-checker skill (separate invocation, post-deploy only)
```

### Gate failure remediation

Each gate exits non-zero on violation. Orchestrator surfaces a numbered prompt to Brian; default disposition per gate:

| Gate | Default on failure |
|---|---|
| 1, 1b: em-dash / en-dash > 0 | auto-revert (Brian confirms) |
| 2: per-row assertion fail | auto-revert (Brian confirms) |
| 3: page status != 200 | auto-revert (Brian confirms) |
| 4: STICKY 4xx internal link | auto-revert (Brian confirms) |
| 4: FLAKY 5xx (3/3 retries) | notify-only (Brian decides) |
| 5: JSON-LD parse fail | emergency revert (no prompt; orchestrator reverts immediately and notifies) |
| 6: legitimization regex hit (new vs baseline) | auto-revert (Brian confirms) |
| 7: AEO probe regression | notify-only (Brian decides patch or accept) |

Auto-revert: orchestrator pushes a revert commit on the staging branch BEFORE auto-merge fires (pre-merge context) or on the apply branch (post-deploy context). Brian confirms `REVERT` | `PATCH` | `ACCEPT-AND-LOG`.

## File Plan

| File | Action |
|---|---|
| `docs/superpowers/specs/2026-05-05-homepage-multipass-review-design.md` | This file (created) |
| `docs/superpowers/plans/2026-05-05-homepage-multipass-review.md` | Created in next step (writing-plans) |
| `docs/audits/2026-05-05-homepage-aeo-seo-geo.md` | Created by Wave 1 |
| `docs/audits/2026-05-05-homepage-messaging-grammar.md` | Created by Wave 2 |
| `docs/audits/2026-05-05-homepage-internal-linking.md` | Created by Wave 3 |
| `docs/audits/2026-05-05-homepage-voc.md` | Created by Wave 4 |
| `docs/audits/2026-05-05-homepage-apply-sheet.md` | Created by orchestrator after Brian's ruling, before Wave 5 dispatch |
| `docs/audits/2026-05-05-homepage-proof-gates.sh` | Generated by orchestrator during Wave 5; per-row assertions |
| `src/pages/index.astro` | Modified by Wave 5 (only source file touched in apply) |

## Risk Mitigations

- **Audit-then-apply pattern:** prevents cross-pass collision on shared line ranges.
- **All audits read-only:** no source modification possible until Brian approves Apply Sheet.
- **Wave preflight gate:** orchestrator verifies all 4 audit files are present and structurally valid before Apply Sheet construction.
- **Single Gianna apply with anchor-based Edits:** text anchors with >=30 chars context, base-SHA pin, canonical edit order, mid-batch rollback. One commit, one blast radius, one revert path.
- **Pre-merge proof gates:** gates run against CF Pages preview-deploy URL BEFORE auto-merge fires. Bad changes never ship to live.
- **Michelle legitimization guard:** memorized scope-violation patterns + mandatory MICHELLE-WARMTH tagging on every Wave 4 warmth row + regex re-snapshot at Apply Sheet construction + post-Edit regex on diff body. Bulk APPLY does not satisfy warmth-row approval.
- **Sibling-pattern blind spot:** Wave 2 (Gianna audit) explicitly checks paraphrase-on-adjacent-paragraphs (per `pillar-proofread` skill).
- **Schema edits separated:** JSON-LD changes run as a sub-batch with `JSON.parse` and `npm run ssot:validate` pre-commit checks.
- **Branch isolation:** all work on `claude/homepage-multipass-2026-05-05-HHMM`; collision check before creation; staging branch (`preview/...`) gates the auto-merge.
- **Empty Apply Sheet short-circuit:** Wave 5 never dispatches on zero APPLY rows.
- **Per-row proof gate generation:** every APPLY row produces a deterministic post-deploy assertion in a generated bash script, so ADD/RE-ANCHOR/REWRITE rows cannot silently fail to materialize.

## Decomposition Decision

Single spec, single plan, single branch. Homepage is one file; all four passes converge on it. Decomposing further would force coordination overhead and increase the number of merge points.

## What Brian Sees

1. Four audit files (commit 1, may auto-merge to main; read-only docs)
2. One persisted Apply Sheet (commit 2; the decision artifact, with Brian's per-row dispositions)
3. One apply commit on the staging branch (commit 3, gated on preview-deploy + proof gates)
4. Auto-merge to main once gates are green (or manual `MERGE` if preview infra unavailable)
5. One post-deploy verification report

Total agent invocations: 4 audits in parallel + 1 apply + 1 verify = 6 sub-agent dispatches. Plus orchestrator-driven preflight, persistence, and gate steps that do not require sub-agent dispatch.
