# Citation Verifier v2: Multi-API Cascade

## Problem

v1 uses Perplexity as the final fallback for citations that NCBI/CrossRef/HTTP can't verify. Perplexity is non-deterministic -- the same URL returns REAL on one run and FAKE on the next. This makes CI gating unreliable.

Additionally, v1 only checks existence ("does this PMID resolve?"), not accuracy ("does the returned paper match the citation text?"). A hallucinated citation that swaps one real paper for another passes v1.

## Solution

Replace Perplexity with a deterministic multi-API cascade. Add metadata validation. Add retraction checking.

## Architecture

```
Citation extracted from markdown
        |
        v
  Classify (PMID / DOI / PMC / URL / text-only ref)
        |
        +---> PMID -----> NCBI E-utilities (ground truth)
        |                    |
        +---> DOI ------> CrossRef API (ground truth)
        |                    |
        +---> PMC ------> NCBI PMC API
        |                    |
        |   All above also check:
        |     - Semantic Scholar (200M+ papers, free API key)
        |     - OpenAlex (240M+ works, free)
        |     - Europe PMC (biomedical focus)
        |
        +---> URL ------> HTTP GET (title extraction, soft-404 detection)
        |
        +---> Text ref --> Fuzzy search OpenAlex + Semantic Scholar
        |     ("Author et al., Year")
        |
        v
  Metadata validation (title/author/year match citation text?)
        |
        v
  Retraction check (CrossRef retraction metadata)
        |
        v
  PASS / FAIL / WARN
```

## Phases

### Phase 1: Multi-API parallel cascade (eliminate non-determinism)

Replace the single-API-then-Perplexity approach with parallel queries to multiple authoritative APIs.

**For PMIDs:**
- NCBI E-utilities (primary, authoritative)
- Europe PMC (secondary, also authoritative for biomedical)
- Semantic Scholar (tertiary, lookup by PMID)

**For DOIs:**
- CrossRef (primary, authoritative)
- doi.org HEAD (fallback for non-CrossRef registries)
- Semantic Scholar (tertiary)
- OpenAlex (tertiary)

**For PMC IDs:**
- NCBI PMC API (primary)
- Europe PMC (secondary)

**For plain URLs:**
- HTTP GET with title extraction + soft-404 detection (unchanged from v1)
- No Perplexity fallback needed

**For text-only refs ("Author et al., Year"):**
- OpenAlex bibliographic search (author + year + partial title)
- Semantic Scholar search
- Fuzzy string matching (70%+ similarity threshold)

**Verification logic:** A citation passes if ANY API confirms it exists. This is the key improvement -- 5 independent sources eliminates non-determinism.

**Files:**
- Rewrite `scripts/verify-citations.mjs`
- No new dependencies (all APIs are free REST endpoints)

**API keys needed:**
- Semantic Scholar: free key from semanticscholar.org/product/api (optional, increases rate limit)
- OpenAlex: free key from openalex.org (required as of Feb 2026, but free)
- NCBI: free key from ncbi.nlm.nih.gov/account (optional, increases from 3 to 10 req/sec)

### Phase 2: Metadata validation (catch mismatched citations)

When a PMID/DOI resolves, compare the returned metadata against the citation text in the markdown.

**What to compare:**
- Title similarity (fuzzy match, 60%+ threshold)
- First author surname match
- Publication year match
- Journal name similarity (fuzzy, 50%+ threshold -- journal names vary)

**Classification:**
- All match: PASS
- Exists but metadata mismatch: WARN ("Citation exists but title/author doesn't match")
- Does not exist: FAIL

**Example this catches:**
The Kim DOI that I replaced with the wrong PMC article. The PMID resolved, but the title "Uterine Perforation as a Complication..." didn't match the citation text "Incarcerated Omentum With Tamponade Effect...". Phase 2 would flag this as WARN.

**For non-journal URLs (same principle):**
A hallucinated URL to a real domain (e.g. dailywire.com/news/fake-slug) may return 200 with a generic page. Three checks catch this:
1. Title-vs-anchor-text match: markdown links have anchor text `[article about X](url)`. Fetch the page title and compare to the anchor text. If unrelated, the specific article was hallucinated even though the domain is real.
2. Redirect detection: if the final URL after redirects differs significantly from the requested URL (e.g. redirects to homepage or search), the specific page doesn't exist.
3. Content-length sanity: a real article has substantial HTML. A generic "no results" or stub page is typically much shorter.

**Implementation:**
- Extract citation text from surrounding markdown (regex for the numbered reference pattern)
- For URLs, also extract anchor text from `[text](url)` markdown pattern
- Compare against API-returned metadata using string similarity (Dice coefficient or Levenshtein ratio)
- No external dependencies needed -- string similarity can be implemented in ~20 lines

### Phase 3: Retraction checking

CrossRef includes Retraction Watch data since Sept 2023. When a DOI resolves, check if the paper has been retracted.

**How:**
- CrossRef `/works/{doi}` response includes `update-to` array
- If any entry has `type: "retraction"`, the paper is retracted
- Also check `relation.is-retracted-by` field

**Classification:**
- Paper exists and not retracted: PASS
- Paper exists but retracted: FAIL ("This paper has been retracted")
- Paper exists, has correction/erratum: WARN

**Implementation:**
- Add retraction check to the existing CrossRef response parsing
- ~15 lines of additional code

### Phase 4: Process guardrail (prevent the root cause)

The technical verifier catches fake citations after they're written. But the root cause is Claude Code inserting citations from memory.

**Add to methodology notes and CLAUDE.md:**
- Never insert academic citations from model knowledge
- Citations must come from: Perplexity research, the RRM Library (Airtable), or Brian
- When a post needs references, research them first via Perplexity, then insert verified ones
- If asked to "add citations" to existing content, research each one live before inserting

## CI Integration

Same as v1, updated for reliability:

```yaml
# Single blog publish (hard gate)
- name: Verify blog citations
  if: ${{ github.event.client_payload.record_id }}
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  run: node scripts/verify-citations.mjs --record "${{ github.event.client_payload.record_id }}"

# Full rebuild (advisory)
- name: Verify all blog citations (full rebuild)
  if: ${{ !github.event.client_payload.record_id && !github.event.client_payload.article_id }}
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  run: node scripts/verify-citations.mjs
  continue-on-error: true
```

OPENROUTER_API_KEY can be removed once Perplexity is dropped (Phase 1 complete).

## Output Format (v2)

```
--- Post Title ---
    12 citation(s) to verify, 2 internal (skipped)
    PASS  PMID 40188588  [NCBI + Semantic Scholar]
          "Hormonal contraceptives during adolescence..." (Horm Behav, 2025)
    PASS  DOI 10.3390/diagnostics13020331  [CrossRef]
          "Uterine Perforation as a Complication..." (Diagnostics, 2023)
    WARN  DOI 10.14740/jmc1713w  [CrossRef]
          Exists but title mismatch: expected "Incarcerated Omentum...", got "Different Paper..."
    FAIL  PMID 99999999  [NCBI + Europe PMC + Semantic Scholar]
          Not found in any database
    FAIL  DOI 10.9999/fake  [CrossRef + OpenAlex]
          Not found. RETRACTED papers also checked.
    PASS  https://www.dailywire.com/news/...  [HTTP 200]
          "The Pill Revolt — Why Millennial Women Like Me..."
```

## Estimated Effort

| Phase | Scope | Effort |
|-------|-------|--------|
| Phase 1 | Multi-API cascade | ~200 lines rewrite |
| Phase 2 | Metadata validation | ~80 lines added |
| Phase 3 | Retraction checking | ~20 lines added |
| Phase 4 | Process guardrail | Methodology note + CLAUDE.md edit |

Total: single session. Phases 1-3 are code. Phase 4 is documentation.

## Dependencies

All free, no paid services:
- NCBI E-utilities (no key required, key recommended)
- CrossRef REST API (no key, polite pool via User-Agent email)
- Semantic Scholar API (free key for higher rate limit)
- OpenAlex API (free key required)
- Europe PMC (no key)
- Node.js fetch (built-in, no npm dependencies)

## What We're NOT Doing

- Semantic claim verification ("does the cited paper support the claim?") -- too heavyweight for CI, requires full-text access + LLM inference
- Installing Hallucinator or RefChecker -- they're designed for PDF/LaTeX academic papers, not markdown blog content. Easier to build our own with the same API cascade pattern
- Real-time verification during content generation -- post-hoc CI gate is sufficient
