# Search Relevance Boost: RRM Relevance + Sentiment Penalty

**Date:** 2026-03-20
**Status:** Draft
**Scope:** SearchBar.astro RRF fusion, library article template, Pagefind meta

## Problem

Library search ranks results by three signals: Pagefind full-text score, Vectorize semantic similarity, and recency. None of these know whether an article is core RRM research or a peripheral study. A 2012 review paper with keyword-dense search terms outranks a 2020 excision surgery outcomes paper by an RRM surgeon. The 5 hostile/critical articles (misinformation) rank equally with supportive research.

## Decision

Add two new RRF signals using data already in articles.json:

1. **RRM Relevance boost** -- additive 4th RRF term based on `rrmRelevance` field (99% coverage)
2. **Sentiment penalty** -- small negative adjustment for critical/hostile articles only (5 articles)

RRM Academy's own content (commentary, FAQs, courses, pillar guides) gets automatic max relevance since it's authored by Dr. Whittaker for this site.

## Design

### 1. Expose `rrmRelevance` and `sentiment` to Pagefind

**File:** `src/pages/library/[...slug].astro`

Add two hidden `data-pagefind-meta` spans alongside the existing `type:Research` span:

```html
<span data-pagefind-meta="type:Research" style="display:none"></span>
{article.rrmRelevance && <span data-pagefind-meta={`rrmRelevance:${article.rrmRelevance}`} style="display:none"></span>}
{article.sentiment && <span data-pagefind-meta={`sentiment:${article.sentiment}`} style="display:none"></span>}
```

Only emit meta spans when the value is non-empty. This avoids Pagefind storing empty strings vs undefined inconsistently. The fusion code treats absent meta the same as empty (neutral default).

No changes needed for commentary/FAQ/course/guide templates -- they already emit `type:Article`, `type:FAQ`, `type:Course`, `type:Guide`. The fusion code infers max relevance from type.

### 2. RRM Relevance boost in RRF fusion

**File:** `src/components/SearchBar.astro` (inside `doSearch`, after recency boost)

New 4th RRF signal. Maps `rrmRelevance` to a virtual rank, scored with its own K constant.

```
Relevance mapping:
  type = Article|FAQ|Course|Guide  -> rank 0  (own content, max boost)
  rrmRelevance = "5 - Core RRM"   -> rank 0
  rrmRelevance = "4 - Highly Relevant" -> rank 10
  rrmRelevance = "3 - Relevant"   -> rank 25
  rrmRelevance = "2 - Peripheral" -> rank 45
  rrmRelevance = "1 - Not RRM"    -> rank 60
  missing/empty                    -> rank 30  (neutral default)
```

Constants:
- `RELEVANCE_K = 25` (smaller than RRF_K=60, so relevance is a strong signal)
- Score: `1 / (RELEVANCE_K + relevanceRank)`

Expected boost values:
| Category | Rank | Boost |
|----------|------|-------|
| Own content / Core RRM | 0 | +0.040 |
| Highly Relevant | 10 | +0.029 |
| Relevant | 25 | +0.020 |
| Missing | 30 | +0.018 |
| Peripheral | 45 | +0.014 |
| Not RRM | 60 | +0.012 |

The gap between Core RRM and Not RRM (+0.028) is large enough to reorder results that are close in Pagefind/semantic score. Combined with recency, a 2020 Core RRM paper would score ~+0.062 in boost signals alone vs ~+0.027 for a 2012 Not RRM paper -- a 2.3x advantage before Pagefind/semantic even factor in.

**Implementation:** Read from `entry.data.meta.rrmRelevance` and `entry.data.meta.sentiment` in the same `for (var rKey in fusedMap)` loop where recency is applied. The meta fields come from Pagefind's `result.data()` return value. For results synthesized from semantic-only (created in the else block at ~line 486), these meta fields will be undefined -- handled by the "missing/empty" default.

### 3. Sentiment penalty

Applied in the same loop as relevance boost. Only penalizes critical/hostile:

```
Sentiment adjustment:
  "hostile"  -> score -= 0.02
  "critical" -> score -= 0.01
  all others -> no adjustment
```

This pushes the 5 hostile/critical articles below neutral/supportive articles at the same relevance level, without affecting the 99.8% of articles that are neutral or supportive. The penalty is subtractive, not a separate RRF term -- simpler and sufficient given the tiny count.

### 4. Data flow

```
articles.json (has rrmRelevance, sentiment)
  -> Astro build -> library/[slug] pages with data-pagefind-meta
  -> Pagefind indexes meta fields
  -> SearchBar.astro reads meta from Pagefind result.data()
  -> RRF fusion applies relevance boost + sentiment penalty
  -> Results sorted by combined score
```

No Vectorize changes. No Airtable changes. No new API endpoints.

### 5. Semantic-only and late-arriving results

Semantic results (from Vectorize) don't have Pagefind metadata. When a result appears in semantic-only (not in Pagefind), there's no `rrmRelevance` to read. These get the "missing" default (rank 30, boost +0.018) -- neutral, neither penalized nor boosted.

Results that appear in **both** Pagefind and Vectorize DO have Pagefind metadata. The relevance/sentiment boost applies to them normally via the fusedMap loop.

**Late-arriving semantic addenda** (results that arrive after the 300ms timeout, appended at ~line 545) are second-class: they're appended unsorted and don't go through the RRF fusion loop. These do NOT get relevance/sentiment adjustments. This is acceptable -- they're already lower-priority results that missed the main ranking window.

### 6. What this does NOT do

- Does not change Pagefind indexing weights (title=10, authors=5, etc.)
- Does not change the semantic search endpoint
- Does not change the non-English penalty
- Does not add any new data fetching or API calls
- Does not require re-embedding the Vectorize index

## Files changed

| File | Change |
|------|--------|
| `src/pages/library/[...slug].astro` | Add 2 `data-pagefind-meta` spans |
| `src/components/SearchBar.astro` | Add relevance boost + sentiment penalty in RRF fusion |

## Testing

- Search "endometriosis" -- Core RRM papers (Yeung, Boyle) should rank above generic reviews (Burney 2012)
- Search "NaProTechnology" -- Core RRM and own content should dominate
- Search "PCOS treatment" -- Relevant articles should outrank peripheral ones
- Hostile articles should appear but below neutral/supportive results for the same query
- Verify commentary/FAQ/course results still surface with strong ranking
