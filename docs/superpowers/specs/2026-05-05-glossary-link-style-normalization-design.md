# Glossary Inline Link Style Normalization

**Date:** 2026-05-05 (revised after /arise --deep, v2)
**Author:** Brian (with Claude)
**Status:** Spec, post-/arise revision, awaiting approval

## Problem

`/glossary/` term bodies (D1 `glossary_term.body_html`, 196 published rows) ship inline `<a>` markup that bypasses the site's established class-based link variants. Result: a single rendered glossary page mixes three visually inconsistent inline-link looks within one paragraph.

The CSS system itself is intentional and token-driven (five variants at established line numbers in `src/styles/global.css`). The drift is in content.

**Empirically verified drift** (counts from `src/data/glossary.json`, 196 published terms, computed at spec authoring time; the implementation re-verifies before applying):

| Pattern | Count | Renders today as | Should render as |
|---|---|---|---|
| `<sup><a href="#ref-N">N</a></sup>` (inside `<sup>` but the `<sup>` lacks `class="cite-ref"`) | **227 of 227** citations (100%) | Inline-baseline accent-underlined number — bare `<sup>` has no rule attached, so the inner `<a>` falls through to the default prose-link styling and the surrounding `<sup>` only provides minimal superscript baseline-shift | Variant 3: small accent-color superscript with no underline by default (the canonical citation look) |
| `<a href="#term-slug">…</a>` (in-page anchor missing `class="gloss-xref"`) | **138 of 751** (~18%) | Variant 1 (bold accent-underlined prose link) — competes with surrounding text | Variant 2 (inherit color + light purple 1px underline) — soft, doesn't fight prose |

The original v1 of this spec said "227 of 227 are bare `<a href="#ref-N">N</a>` with no `<sup class="cite-ref">` wrapper." That phrasing was imprecise: the citations DO have `<sup>` wrappers; they're just missing the class. The transform that fixes them is therefore "add `cite-ref` to the existing `<sup>`," not "wrap a bare `<a>` in a new `<sup>`." This distinction matters for Phase 3 Transform B (rewritten below).

## Goals

1. Bring D1 term bodies into compliance with the canonical inline-link system.
2. Document the canonical inline-link variants in `STYLE-GUIDE.md` so the system is checkable, not tribal.
3. Add a CI guard that prevents future term commits from re-introducing the drift, without wedging unrelated deploys.
4. Apply the change atomically (transactional, rollback-safe, race-protected against concurrent edits).

## Non-Goals

- Changing the CSS variants. Five inline-link variants in `global.css` are intentional and stay.
- Touching content surfaces other than `glossary_term.body_html`. Pillar guides, commentary, library, FAQs, courses are out of scope; tracked as a follow-up backlog item rather than left as a vague "addressable separately."
- Adding new inline-link variants beyond the existing five.
- Changing external link `target`/`rel` attributes.
- Editing the `glossary_reference` or `glossary_abbreviation` D1 tables.
- Static-page citation in `src/pages/glossary/index.astro` (the pillar lead paragraph hardcodes a `<sup><a href="#ref-1">1</a></sup>` near line 285). After Phase 4, this will be the only un-normalized citation visible on `/glossary/`. Tracked as a follow-up item; a one-line edit to the static page added to the `claude/glossary-toc-cleanup` branch (or the next docs-only branch) is sufficient. Out of scope for this spec to keep the SQL-mutation work atomic.

## Canonical inline-link variants (the system, for reference)

| # | Selector | Color | Underline | Use |
|---|---|---|---|---|
| 1 | `p a, li a, .prose a, blockquote a` (`global.css:501`) | `--accent` | yes, 2px offset | External sources, pillar-guide links, any non-glossary-internal inline link |
| 2 | `.prose a.gloss-xref` (`global.css:1129`) | `inherit` (hover → `--accent`) | yes, 1px, `--purple-200` | Linking to another glossary term inside a term body |
| 3 | `.cite-ref a` (`global.css:1615`) | `--accent` | no (hover yes) | Inline `<sup>` numbers pointing to the references list |
| 4 | `.term-spoke-link a` (`global.css:1159`) | `--text-tertiary` (hover → `--accent`) | no, border on hover | "Open full entry →" beneath each term |
| 5 | `.references .ref-backlink` (`global.css:1650`) | `--accent` | no | ↩ in references list |

**Spoke-page selector caveat:** Variant 2's selector requires a `.prose` ancestor. The pillar `/glossary/` page wraps content in `<article class="prose">` (verified at `index.astro:279`). Spoke pages `/glossary/<slug>/` MUST also wrap `<GlossaryTerm>` content in a `.prose` container, or the selector silently fails on spokes. Implementation step 0a verifies the spoke template before any Phase 3 work begins; if missing, the implementer adds the wrapper as part of Phase 1.

## Implementation

### Phase 0 — Pre-flight verification (before any code)

1. **Confirm spoke wrapper.** Read `src/pages/glossary/[slug].astro` (or whatever spoke template exists). Confirm `<GlossaryTerm>` renders inside an ancestor with `class="prose"`. If missing, the implementer adds it as a one-line edit during Phase 1.
2. **Re-verify drift counts** against current `src/data/glossary.json` using the audit script (Phase 2). If counts differ from the spec's `227 / 138`, log the new numbers and proceed; the transforms operate on whatever drift exists.
3. **Confirm the sanitizer's role.** `src/lib/fetch-glossary-data.mjs` runs each term body through `sanitizeHtml` (`src/lib/html-sanitize.mjs`) on every fetch. The implementer reads both files before drafting transforms so the round-trip semantics are clear (sanitizer collapses whitespace runs, strips empty `<p>`, escapes attribute values, but is class-preserving — verified at file read time).
4. **Confirm `node-html-parser` is acceptable.** Read its release notes/issues for known bugs in attribute round-trip and self-closing tags. If material concerns exist, switch to `parse5`. Default: `node-html-parser` (lighter dep). Either way, add `package.json` to Files Touched.

### Phase 1 — Document the system

`STYLE-GUIDE.md` already has a `## Links` section. Phase 1 **replaces that section** (does not append) with a new section listing all five variants per the table above, plus the spoke-page caveat. Token names cross-reference `docs/design/design-system.json`. The replacement preserves any unrelated content elsewhere in `STYLE-GUIDE.md`.

### Phase 2 — Audit script (read-only)

`scripts/audit-glossary-links.mjs`. Inputs:
- `--data <path>` (default `src/data/glossary.json`)
- `--from-d1` (boolean; if set, reads live D1 via `wrangler d1 execute rrm-auth --remote --command "SELECT id, slug, body_html, status FROM glossary_term"` instead of the local JSON; ALL statuses, not just published)
- `--out <path>` (default stdout)

The audit imports its classifier from a shared module (see Phase 2a) so audit, normalizer, and CI guard cannot diverge.

For each `<a>` element in each term's body, the classifier returns one of these `action` values (the closed enum):

| Action | Trigger |
|---|---|
| `noop` | Anchor already matches its expected variant (correct class/wrapper) |
| `add-gloss-xref` | In-page anchor to a known glossary term, missing `gloss-xref` class |
| `add-cite-ref-class-to-sup` | `#ref-\d+` anchor inside an existing `<sup>` that lacks `cite-ref` class |
| `wrap-cite-ref` | `#ref-\d+` anchor with no `<sup>` parent (truly bare; today this count is zero but supported for future-proofing) |
| `manual-review:section-anchor` | Href targets a known page-section ID (`#references`, `#abbreviations`, `#overview`, plus the 8 part section IDs `#core-rrm-principles`, `#fertility-awareness`, `#clinical-approaches`, `#diagnostic-tools`, `#surgical-techniques`, `#conditions`, `#overlapping-disciplines`, `#broader-framework`); MUST NOT auto-receive `gloss-xref`, but stays variant 1 (default prose) |
| `manual-review:broken-target` | In-page anchor whose target slug does not exist in `glossary_term.slug` (case-insensitive lookup matching D1 `COLLATE NOCASE`) AND is not in the section-anchor allowlist |
| `manual-review:multi-cite` | `#ref-7,8` (comma-separated multi-cite). Operator splits manually |
| `manual-review:zero-padded` | `#ref-007` (leading zero). Operator un-pads manually |
| `manual-review:non-canonical-citation` | `#cite-N` (alternate form named in v1 spec but not in real corpus). Audit reports; if any found, operator decides between drop-from-classifier and dual-support before Phase 3 runs |
| `manual-review:malformed-href` | `href=""`, `href="#"`, `href="javascript:..."`, `href="#term?param=..."`, missing `href` |
| `mailto-or-tel` | `href="mailto:..."` or `href="tel:..."` — variant 1, no transform |
| `external` | `href="https?://..."` — variant 1, no transform |
| `pillar-or-onsite` | `href="/..."` — variant 1, no transform |

**Manual-review handling:** any `manual-review:*` action emits an entry to `/tmp/glossary-link-manual-review.<timestamp>.txt` with `{termSlug, anchorOffset, hrefValue, htmlSnippet, reason}`. Phase 3 SKIPS these anchors (does NOT auto-class them) and refuses to emit SQL for any term that contains a `manual-review:*` anchor. Operator must resolve all manual-review entries (typically by editing the term body via the `/glossary-update` skill Workflow A) before Phase 3 emits a non-empty SQL file. Phase 5 CI guard treats any `manual-review:*` finding as a hard fail equal to a missing class — this prevents broken-anchor + class-correct = invisible regressions.

Audit exits 0 always (read-only, never blocks). The audit's JSON output is `{ summary: {actionCounts, termCount}, perAnchor: [...] }`.

### Phase 2a — Shared classifier module

`scripts/lib/glossary-link-classifier.mjs`. Single source of truth for the classifier function used by audit, normalizer, and CI guard. Exports `classifyAnchor({attrs, parentTagName, parentClassList, knownTermSlugs})` returning one of the closed enum values above.

This is mandatory; audit/normalizer/check duplicating the logic is forbidden (mirrors the G3 enum-sync gate pattern in `scripts/gates/validate-fact-pipeline.mjs`).

### Phase 3 — Normalizer (emit SQL only; does NOT call wrangler)

`scripts/normalize-glossary-links.mjs`. Inputs:
- `--from-d1` (boolean; if set, reads live D1 directly. **Default: true.** Reading from `src/data/glossary.json` is supported but discouraged because of stale-data and sanitizer-round-trip race conditions surfaced by /arise.)
- `--limit N` (process only first N terms after stratified sampling: at least one term per `action` category. If a category has zero matches, skip it. Used for review of representative cases, not the first-by-sortOrder.)
- `--apply` (default false; when false, prints unified diffs to stdout and exits with a clear final line. When true, writes timestamped SQL files.)
- `--out-dir <path>` (default `/tmp`; SQL files written here as `glossary-link-normalize.<timestamp>.NNN.sql` for chunked apply.)

**Sanity assertion at startup:** if reading from JSON, assert `firstTerm.bodyHtml !== undefined` and bail loudly if the field name has drifted (camelCase JSON vs snake_case D1 SSOT — see field name policy below).

**Field name policy:** in JS code reading `glossary.json`, always use `term.bodyHtml` (camelCase). In SQL referencing the D1 column, always use `body_html` (snake_case). Spec text follows the same convention.

**Transforms (single decision tree, evaluated most-specific first):**

For each `<a>` element in each term's body:

```
let action = classifyAnchor({attrs, parentTagName, parentClassList, knownTermSlugs});

switch (action) {
  case 'noop':
  case 'mailto-or-tel':
  case 'external':
  case 'pillar-or-onsite':
    /* leave the anchor unchanged */
    break;

  case 'add-gloss-xref':
    /* add 'gloss-xref' to the anchor's class list using word-boundary
       check to avoid false skip on 'my-gloss-xref-fake' or
       'gloss-xref-extended'. Implementation: split on whitespace,
       Set.add('gloss-xref'), join. Idempotent. */
    addClassToken(anchor, 'gloss-xref');
    break;

  case 'add-cite-ref-class-to-sup':
    /* parent is <sup>; add 'cite-ref' to its class list using the
       same word-boundary semantics. Idempotent. */
    addClassToken(anchor.parent, 'cite-ref');
    break;

  case 'wrap-cite-ref':
    /* truly bare <a href="#ref-N">; wrap it in a new <sup class="cite-ref">. */
    wrapAnchorInSup(anchor, 'cite-ref');
    break;

  /* All manual-review:* actions cause the term to be REJECTED entirely
     for this run (no SQL emitted for that term until the operator
     resolves it via skill Workflow A). */
  default:
    rejectTerm(termSlug, action);
}
```

The class-token check uses a real word-boundary helper (split-and-set or the equivalent of DOMTokenList semantics), never a substring `.includes()` check.

**Word-boundary class check:** `hasToken(classAttr, token) === classAttr.split(/\s+/).filter(Boolean).includes(token)`. Same helper for the parent-class check on `<sup>`.

**Preservation rules (revised — drops the unenforceable "byte-for-byte" claim):**

The normalizer parses each `bodyHtml` with `node-html-parser`, mutates only the relevant `<a>` and `<sup>` elements, and re-serializes. The serializer normalizes:
- attribute quoting to double quotes,
- attribute order to insertion order,
- void elements to HTML5 form (`<br>` not `<br/>`),
- whitespace inside open tags to single space,
- preserves text node content byte-for-byte (this IS guaranteed),
- preserves HTML entities as authored (does not re-encode `&amp;` or decode `&nbsp;`).

Acceptance is **semantic equivalence**, not byte equivalence. A round-trip regression test (Phase 6) asserts that `parse → serialize` (without mutation) produces output that differs from input only in the categories listed above. If it differs in any other way, the parser is rejected and `parse5` (or another) replaces it.

**Sample-of-N review:** `--limit N --apply` (suggested N=5) selects N terms by stratified sampling — one per `action` category produced by the audit, in this priority: `add-gloss-xref` → `add-cite-ref-class-to-sup` → `wrap-cite-ref` → terms with mixed actions → control (a `noop` term). If a category has no instances in current data, skip it.

**SQL emission with apostrophe escaping and CAS:**

The normalizer emits SQL of the form:

```sql
BEGIN TRANSACTION;
UPDATE glossary_term
SET body_html = '<NEW_BODY_WITH_QUOTES_DOUBLED>',
    updated_at = datetime('now')
WHERE slug = '<SLUG_WITH_QUOTES_DOUBLED>'
  AND body_html = '<OLD_BODY_WITH_QUOTES_DOUBLED>';
-- repeat per term
COMMIT;
```

Notes:
- All single quotes in `body_html` and `slug` doubled (`'` → `''`) per SQLite escaping rules. The skill's Workflow A already mandates this.
- The `AND body_html = '<OLD_BODY>'` clause is a compare-and-swap (CAS): if a concurrent edit changed the row's `body_html` between read-time and apply-time, the UPDATE matches zero rows (changes: 0) and the operator's stale write is silently dropped instead of clobbering the live edit. Phase 4 step 6 reconciles non-applied terms.
- Wrapped in `BEGIN TRANSACTION; ... COMMIT;` so a mid-batch failure rolls back the entire chunk.
- Output is **chunked**: at most 50 UPDATE statements per file. Files numbered `glossary-link-normalize.<timestamp>.001.sql`, `.002.sql`, etc. (D1's per-`--file=` request limit is undocumented but safely under 50 statements + transaction wrappers + ~5KB per body. ~196 / 50 ≈ 4 files.)
- Each file is independently transactional. A failure in chunk 002 leaves chunks 001 (committed) and 003+ (not yet applied) in a known recoverable state — easier than 196-statements-in-one-batch.

**Status filter:** the SQL operates on all rows regardless of `status`. Drafts and archived rows also need normalization or the next publish ships drift. Phase 4 step 4 verifies post-apply.

**Snapshot before apply:** Phase 3, on `--apply`, also writes `/tmp/glossary-link-snapshot.<timestamp>.json` containing `{slug, body_html}` for every term it intends to change (read from D1). This snapshot is the rollback artifact. Retain for 14 days after apply.

**Dry-run vs apply UX:**
- Dry-run output ends with: `DRY RUN COMPLETE. <N> terms would be modified across <M> chunks. Re-run with --apply to write SQL files.`
- Apply mode ends with: `APPLY-SQL EMITTED. Wrote <M> SQL chunks to /tmp/glossary-link-normalize.<timestamp>.NNN.sql plus snapshot at /tmp/glossary-link-snapshot.<timestamp>.json. NOT YET APPLIED TO D1. Run via /glossary-update skill Workflow H to commit.`

The flag name stays `--apply` (matches `audit/normalize/check` family). Output text disambiguates "emitted SQL" from "applied to D1."

### Phase 4 — Apply via `/glossary-update` skill Workflow H (NEW)

Phase 4 mandates extending the `/glossary-update` skill with a new Workflow H: "Apply normalizer-emitted SQL chunks." Spec rationale: existing workflows are single-term-Gianna-mediated edits or large-batch INSERTs (term additions). No existing workflow consumes external bulk-UPDATE SQL files. Phase 4 cannot rely on operator improvisation.

**Workflow H** in `~/.claude/skills/glossary-update/SKILL.md`:

1. **Pre-conditions (operator-asserted):**
   - Audit ran cleanly: `node scripts/audit-glossary-links.mjs --from-d1` reports 0 `manual-review:*` entries.
   - Snapshot file exists at the path printed by Phase 3.
   - Operator has eyeballed the `--limit 5 --apply` stratified-sample diffs.
2. **Verify SQL form:** for each chunk file, grep-check that every non-blank, non-comment line matches one of these regex anchors:
   - `^BEGIN TRANSACTION;$`
   - `^COMMIT;$`
   - `^UPDATE glossary_term$`
   - `^SET body_html = '.*', *updated_at = datetime\('now'\)$`
   - `^WHERE slug = '[a-z0-9'-]+'$` (note the doubled-apostrophe possibility for slugs)
   - `^  AND body_html = '.*';$`
   - `^-- .*$` (comments)
   No other forms allowed. Skill bails on any line that doesn't match.
3. **Apply chunks sequentially.** For each chunk file in order:
   - `wrangler d1 execute rrm-auth --remote --file=<chunk>` — captures `meta.changes` from the response.
   - Compare returned `changes` count against expected (number of UPDATE statements in the chunk).
   - If `changes < expected`, log the slug discrepancy: stale CAS dropped one or more updates. Skill prints `STALE: <slug>` for each and continues. (Operator reconciles later.)
   - If `changes == 0` for an entire chunk OR wrangler errors, abort and report the chunk number for retry. Earlier chunks already committed (their COMMIT ran) so D1 is in a partial state — see step 7 (rollback).
4. **Post-apply verification:** re-run audit against live D1 (`scripts/audit-glossary-links.mjs --from-d1`). Expect 0 mismatches AND 0 `manual-review:*`. If non-zero, log and surface to operator.
5. **Trigger ONE full rebuild deploy** via `gh api repos/rrmadmin/rrm-academy-cf/dispatches -f event_type='workflow_dispatch'` (the regular full-fetch path). This refreshes `glossary.json` and serves all 196 normalized terms simultaneously. The single-record dispatch path is explicitly NOT used (would serialize 196 sequential ~5min deploys ≈ 16h queue saturation).
6. **Stale-CAS reconciliation:** for any slug logged as STALE in step 3, the skill prints `RECONCILE: <slug> — concurrent edit during apply window. Re-run audit to confirm current state, then re-emit SQL for that single term via Workflow A.` Operator handles those one-by-one (typically <5 cases).
7. **Rollback (only if needed):** the snapshot file from Phase 3 step contains pre-apply `(slug, body_html)`. Skill's optional `--rollback /tmp/glossary-link-snapshot.<timestamp>.json` mode emits inverse UPDATE SQL chunks (same chunked + transactional shape) and applies them. Same pre-conditions, same form-verification.

The skill update lands FIRST, in its own commit, before Phase 4 runs. The Phase 4 commit references the skill update.

### Phase 5 — CI guard (lands in a SEPARATE PR after Phase 4 succeeds)

`scripts/check-glossary-link-classes.mjs`. Imports the classifier from `scripts/lib/glossary-link-classifier.mjs` (Phase 2a). Inputs: `--data <path>` (default `src/data/glossary.json`); reads from disk only — D1 reads are not viable in CI without secrets management overhead, and `glossary.json` post-`fetch-all` reflects D1 truth.

Fails the build with exit 1 if any term ships with:
- a `manual-review:*` finding (broken target, malformed href, multi-cite, etc.) — same severity as missing class.
- an `add-gloss-xref` finding (missing class).
- an `add-cite-ref-class-to-sup` or `wrap-cite-ref` finding (missing wrapper or class).

**Wired to `.github/workflows/deploy.yml`:** runs AFTER `Fetch all data` step (which regenerates `glossary.json` from D1) and BEFORE `Astro build`. Skipped if `inputs.skip_fetch=true` and no fetch step ran (in that case prints a `::warning::` line stating "skipped: glossary.json may be stale" rather than failing the build).

**Escape-hatch / baseline pattern:** the gate ships in two stages:
- **Stage A (warn-only):** initial PR adds the script + wires it as `continue-on-error: true` and prints findings as `::warning::` lines. Stage A merges immediately after Phase 4 verifies clean, so the warnings reflect "everything good" from day one.
- **Stage B (hard gate):** a follow-up PR flips `continue-on-error` to `false` once Stage A has shown 0 warnings on three consecutive deploys. This gives an early-warning channel before the gate ever blocks an unrelated deploy.

If at any point a future glossary edit reintroduces drift AND the gate is at Stage B, operator has three options:
1. Revert the bad edit in D1 via skill (quickest; usually a typo paste).
2. Fix the drift via `/glossary-update` Workflow A (proper fix).
3. As a circuit-breaker: temporarily flip `continue-on-error` to `true` in `deploy.yml`, ship the unrelated deploy, then fix the glossary edit. The flip itself is a small PR — auditable, reversible.

This is patterned after `scripts/type-check-baseline.json` (a separate baseline file ratchets the acceptable error count). For this gate, the baseline IS zero (post-Phase-4), so a literal baseline file isn't needed — any non-zero count is a regression.

### Phase 6 — Tests

`test/glossary-link-classifier.test.js` covers the shared classifier with fixtures for every `action` value plus boundary cases:
- bare in-page anchor, in-page anchor with existing `gloss-xref`, in-page anchor with `class="my-gloss-xref-fake"` (must NOT skip), in-page anchor with `class="gloss-xref-extended"` (must NOT skip).
- `<a href="#ref-7">7</a>` outside `<sup>`.
- `<sup><a href="#ref-7">7</a></sup>` (parent `<sup>` no class).
- `<sup class="cite-ref"><a href="#ref-7">7</a></sup>` (already correct).
- `<sup class="other-class"><a href="#ref-7">7</a></sup>` (parent `<sup>` with non-cite-ref class — must add cite-ref alongside).
- Section anchors: `#references`, `#abbreviations`, `#overview`, all 8 part section IDs.
- Broken target: `<a href="#nonexistent-term">…</a>`.
- Case-mismatched target: `<a href="#PROgesterone">` where slug is `progesterone` — case-insensitive match succeeds (D1 NOCASE), but the href is also normalized to lowercase by the transform.
- Multi-cite: `<a href="#ref-7,8">7,8</a>`.
- Zero-padded: `<a href="#ref-007">7</a>`.
- Non-canonical: `<a href="#cite-3">3</a>`.
- Malformed: `href=""`, `href="#"`, `href="javascript:alert(1)"`, missing `href`.
- Mailto/tel: `href="mailto:foo@bar.com"`, `href="tel:+15551234567"`.

Plus a round-trip preservation test: parse + serialize 10 sample term bodies (no mutation), assert diffs only in the allowed categories.

Plus an idempotency test: run normalizer twice, second run produces zero changes.

## Files touched

### New
- `docs/superpowers/specs/2026-05-05-glossary-link-style-normalization-design.md` (this file)
- `scripts/lib/glossary-link-classifier.mjs` (Phase 2a — shared classifier)
- `scripts/audit-glossary-links.mjs` (Phase 2)
- `scripts/normalize-glossary-links.mjs` (Phase 3 — dry-run + emit-SQL)
- `scripts/check-glossary-link-classes.mjs` (Phase 5 — CI gate)
- `test/glossary-link-classifier.test.js` (Phase 6 — unit tests for classifier + transforms + idempotency + round-trip)

### Modified
- `STYLE-GUIDE.md` — replace the existing `## Links` section with the five-variant table plus spoke-page caveat.
- `~/.claude/skills/glossary-update/SKILL.md` — add Workflow H "Apply normalizer-emitted SQL chunks" + optional `--rollback` mode. Skill update lands in a separate, earlier commit.
- `.github/workflows/deploy.yml` — wire `check-glossary-link-classes.mjs` as Stage A (warn-only with `continue-on-error: true`) initially; flip to Stage B (hard gate) in a follow-up PR after three clean deploys.
- `package.json` + `package-lock.json` — adds `node-html-parser` (~70KB build-time dep). NOT a runtime dep.
- `src/pages/glossary/[slug].astro` (or wherever the spoke template lives) — IF Phase 0 step 1 finds no `.prose` ancestor, add the wrapper. Otherwise no change.
- `glossary_term.body_html` D1 rows — ~196 row UPDATEs, applied via `/glossary-update` Workflow H, transactional per chunk, CAS-protected, snapshotted.

### NOT modified
- `src/styles/global.css` — the inline-link variants are correct.
- `src/components/GlossaryTerm.astro` — render path is correct.
- `src/pages/glossary/index.astro` — page template is correct re: link markup. (Concurrent branch `claude/glossary-toc-cleanup` edits TOC labels + section headings, NOT term-body markup; no merge conflict.)
- `src/lib/fetch-glossary-data.mjs` and `src/lib/html-sanitize.mjs` — sanitizer is class-preserving; fetch path is correct.
- Any other content surface (commentary, library, FAQs, courses, pillars). Tracked as backlog item: "audit non-glossary surfaces for the same drift class."

## Pre-implementation verification checklist

The implementer must complete Phase 0 and confirm each item below before any code lands:

1. Spoke template wraps `<GlossaryTerm>` in a `.prose` ancestor (or implementer fixes it as part of Phase 1).
2. Drift counts re-verified against current `src/data/glossary.json`. Spec text (counts) updated if drifted.
3. `src/lib/html-sanitize.mjs` is class-preserving (verified at file read).
4. `node-html-parser` round-trip on 10 sample bodies produces only allow-listed differences.
5. `~/.claude/skills/glossary-update/SKILL.md` Workflow H lands as an earlier commit before Phase 4 runs.
6. Phase 5 lands as Stage A (warn-only) AFTER Phase 4 has applied AND audit reports clean. Stage B (hard gate) lands later in a separate PR.
7. `glossary_term` slug case-insensitivity confirmed (D1 schema has `slug TEXT UNIQUE COLLATE NOCASE`).
8. The `wrangler d1 execute --file=` request size limit is empirically tested with a 50-statement chunk before applying live (any error → smaller chunks).

## Out of scope (named, not built)

- Audit of inline links on commentary / library / FAQs / courses / pillar guides.
- Editing the static-page citation in `src/pages/glossary/index.astro` line ~285. Tracked separately; one-line edit added to the `claude/glossary-toc-cleanup` branch (or next docs-only branch).
- Anchor-target integrity validation across glossary term renames over time. Phase 5 catches drift introduced by content edits to a single term, not drift introduced by renaming a referenced term elsewhere. Future work: extend Phase 5 (or create Phase 7) to validate every `gloss-xref` `href` resolves against the current `term.slug` set.
- Building admin UI for glossary editing.

## Open questions

None remaining — all v1 open questions resolved in v2:

- v1 OQ1 (DOM parser choice): default `node-html-parser`, fallback `parse5` based on Phase 0 round-trip test.
- v1 OQ2 (cross-reference target validation): mandatory; broken targets emit `manual-review:broken-target` and Phase 5 treats them as a hard fail.

## Success criteria

1. `STYLE-GUIDE.md ## Links` section replaced with the five-variant table + spoke-page caveat.
2. `scripts/audit-glossary-links.mjs` runs against current `glossary.json`, emits a JSON report with action counts, exits 0.
3. `scripts/normalize-glossary-links.mjs --limit 5 --apply` selects 5 terms via stratified sampling (≥1 per action category), produces SQL chunks at the printed paths, plus a snapshot file. Diff review on each shows correct transforms.
4. After full apply via `/glossary-update` Workflow H + a triggered full-rebuild deploy:
   - Re-running audit against live D1 reports 0 mismatches and 0 `manual-review:*`.
   - Live `/glossary/` page: every citation `[N]` renders as small accent-color superscript (variant 3); every cross-reference renders with soft inherit-color + light purple underline (variant 2). Pillar AND spoke routes verified.
5. `scripts/check-glossary-link-classes.mjs` exits 0 against post-apply `glossary.json`.
6. CI deploy workflow includes the gate as Stage A (warn-only) initially; flipped to Stage B (hard gate) after three clean deploys.
7. Re-running the normalizer is idempotent: second run reports 0 changes.
8. `test/glossary-link-classifier.test.js` covers all closed-enum action values plus boundary cases plus round-trip and idempotency.
9. `~/.claude/skills/glossary-update/SKILL.md` includes Workflow H with apply + rollback variants.
10. Snapshot file `/tmp/glossary-link-snapshot.<timestamp>.json` exists for 14 days post-apply (operator's responsibility to retain).
11. Pre-implementation verification checklist completed (7 items + sample-of-50 chunk size test).

## Risk and mitigation

| Risk | Mitigation |
|---|---|
| Bulk D1 update clobbers concurrent human edits | CAS clause `AND body_html = '<expected_pre>'` makes stale writes a no-op (changes: 0); skill reports STALE per-slug; operator reconciles via Workflow A. |
| Mid-batch failure leaves D1 split | Per-chunk `BEGIN…COMMIT` rolls back the failing chunk; earlier chunks already committed. Snapshot file enables full rollback via Workflow H `--rollback`. |
| `wrangler d1 execute --file=` request size limit | Chunked at ≤50 statements per file (~4 files for 196 rows); empirically tested in Phase 0. |
| node-html-parser non-byte-preserving | Spec drops the byte-for-byte invariant; round-trip preservation test asserts only allow-listed diffs; Phase 0 swaps to `parse5` if the round-trip fails. |
| Sanitizer rewriting after apply masks D1 truth | Audit and check both read post-sanitize `glossary.json` (the same surface render uses); D1-direct audit available via `--from-d1`. |
| CI gate wedges unrelated deploys | Stage A warn-only first; Stage B hard gate after three clean deploys; circuit-breaker via temporarily flipping `continue-on-error`. |
| 196 single-record dispatches saturate CI queue | Phase 4 mandates ONE full-rebuild dispatch, not per-row dispatches. |
| Spoke selector silent-fails (no `.prose` ancestor) | Phase 0 step 1 verifies + fixes if missing. |
| Audit/check classifier drift | Single shared `scripts/lib/glossary-link-classifier.mjs` module; CI test covers it. |
| Section-anchor false-tagging | Allowlist of 11 section IDs in classifier; emits `manual-review:section-anchor` not `add-gloss-xref`. |
| Concurrent operator runs normalizer twice | Idempotency: second run produces zero changes (verified by test). |
| `bodyHtml` vs `body_html` field-name confusion | Sanity assertion at script start; spec uses camelCase for JS/JSON, snake_case for SQL only. |

## Decisions log

- Bare-vs-`<sup>` distinction corrected from v1: 100% of citations are inside `<sup>` missing only the class. Transform B is "add `cite-ref` to existing `<sup>`," not "wrap a bare `<a>`." (/arise C1.)
- Skill integration explicit: NEW Workflow H added to `/glossary-update` SKILL.md before Phase 4 runs. (/arise H0.)
- Phase 5 ships in two stages: warn-only first, hard gate after three clean deploys. Avoids deploy deadlock. (/arise H2, H3.)
- Phase 4 mandates ONE full-rebuild dispatch, not 196 single-records. (/arise H4.)
- Bulk SQL wrapped in `BEGIN…COMMIT` per chunk, chunked at ≤50 statements, snapshotted before apply. (/arise H5, M5.)
- CAS clause (`AND body_html = '<expected>'`) protects against concurrent edits. (/arise H6.)
- Section anchors get explicit allowlist; emit `manual-review:section-anchor`. (/arise H7.)
- Single classifier module shared by audit/normalize/check; duplication forbidden. (/arise M5.)
- `bodyHtml` (camelCase JSON) vs `body_html` (snake_case D1) lock-down + sanity assertion. (/arise M2.)
- All transforms use word-boundary class checks, not substring `.includes()`. (/arise H9.)
- Manual-review queue has a defined triage path: emit to file, Phase 3 rejects affected terms, Phase 5 treats as hard fail. (/arise M1.)
- Phase 3 reads from D1 directly by default (not stale `glossary.json`). (/arise M3, H6.)
- Status filter dropped: normalizer mutates all rows regardless of `status`. (/arise M4.)
- Round-trip preservation test added; "byte-for-byte" claim dropped. (/arise H1, M8.)
- `<a href="#cite-N">` (alternate citation form) emits `manual-review:non-canonical-citation`; operator decides between drop-from-classifier and dual-support before Phase 3 runs. (/arise H8.)
- Multi-cite `#ref-7,8` and zero-padded `#ref-007` emit `manual-review:multi-cite` / `manual-review:zero-padded`. (/arise H9.)
- SQL apostrophe escaping mandatory + Phase 4 form-check uses regex match against the apostrophe-escaped form. (/arise H10.)
- Empty/`#`/`javascript:`/`mailto:`/`tel:` href branches enumerated explicitly in classifier. (/arise L2.)
- `--limit N` uses stratified sampling, not first-by-sortOrder. (/arise L3.)
- SQL output paths timestamped to avoid collision. (/arise L5.)
- Dry-run vs apply UX disambiguated with explicit final lines. (/arise L4, L7.)
- Static-page citation in `index.astro` line 285 explicitly listed in §Out of scope with backlog plan. (/arise L8.)
- Spoke-page selector caveat documented; Phase 0 step 1 verifies + fixes if needed. (/arise N4.)
- `node-html-parser` added to Files Touched. (/arise N2.)
- Cross-branch awareness with `claude/glossary-toc-cleanup` confirmed (no conflict). (/arise N5.)
- Idempotency test mandatory. (/arise N6.)
