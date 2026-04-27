# Fact Pipeline Gates

Deterministic proof-gate runner for the canonical facts extraction pipeline.
Prevents the bug classes found in commit 70958c2 (/arise --deep, 13 bugs).

## Usage

```
npm run gates            # all 5 gates (includes D1 network query)
npm run gates:check      # G1-G4 only — fast, no network (pre-commit)
node scripts/gates/validate-fact-pipeline.mjs --gate G1
node scripts/gates/validate-fact-pipeline.mjs --json
```

## Gates

### G1: Schema Self-Consistency

Reads `scripts/lib/canonical-facts-schema.mjs`. For each entity:

- Every tradition value in the matcher is in `ALLOWED_TRADITIONS`.
- Slug-named entities accept their corresponding tradition (e.g. `creighton` entity
  must accept `'creighton'`). This is the exact class of bug that dropped 724 Creighton
  facts: the matcher only accepted `'fabm'` instead of `'creighton'`.
- Every value in `ALLOWED_TRADITIONS` is accepted by at least one entity (no stranded
  traditions).

### G2: SSOT Integrity

For each `docs/fact-check/*-canonical-facts.json` (plus neofertility-ie):

- `_meta.record_count == facts.length`
- All fact IDs match expected formats (rec-prefixed, chapter-slug-prefixed, legacy curator IDs)
- All `source_id` fields are non-empty
- All `tradition` arrays are non-empty and contain only `ALLOWED_TRADITIONS` values
- All facts have `verified >= 1`
- All facts route correctly via their entity's `matches()` function

### G3: Validator-Prompt Enum Sync

Compares `ALLOWED_CATEGORIES` and `ALLOWED_CLAIM_TYPES` Sets in the validator scripts
against the `"category"` and `"claim_type"` enum values in the system prompts.
Fails if they diverge — adding a new category to the prompt without updating the
validator (or vice versa) is a silent data-loss bug.

### G4: Orchestrator Exit Codes (static)

Reads source of each orchestrator script. Asserts that when a `failed` array is
non-empty, the script calls `process.exit(<non-zero>)`. Silent zero-exit on failures
means CI passes while facts are silently dropped.

### G5: D1↔SSOT Reconciliation (network-dependent)

Queries D1 `rrm-library.facts` for each entity's tradition filter. Compares the
count to `_meta.record_count` in the SSOT JSON. Fails if delta > 2. This is the
gate that would have caught the Creighton bug after build (D1 had 1,016 creighton-tagged
facts, SSOT contained only 292 — a 724-record delta).

Skipped with `--quick` flag.

## Pre-commit trigger

The pre-commit hook runs `npm run gates:check` (G1-G4, no network) when any of these
files change:

- `scripts/lib/canonical-facts-schema.mjs`
- `scripts/extract-article-facts.mjs`
- `scripts/extract-chapter-facts.mjs`
- `scripts/promote-article-facts.mjs`
- `scripts/promote-chapter-facts.mjs`
- `scripts/build-canonical-facts.mjs`
- `scripts/article-extraction/system-prompt.md`
- `scripts/chapter-extraction/system-prompt.md`
