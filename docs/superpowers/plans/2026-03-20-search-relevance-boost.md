# Search Relevance Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RRM relevance boosting and hostile/critical sentiment penalty to library search ranking.

**Architecture:** Two changes -- expose `rrmRelevance` and `sentiment` as Pagefind meta on article pages, then consume those fields in the RRF fusion loop in SearchBar.astro alongside the existing recency boost.

**Tech Stack:** Astro templates, Pagefind `data-pagefind-meta`, client-side JS in SearchBar.astro

**Spec:** `docs/superpowers/specs/2026-03-20-search-relevance-boost-design.md`

---

### Task 1: Add Pagefind meta spans to article template

**Files:**
- Modify: `src/pages/library/[...slug].astro:174` (after the existing `type:Research` meta span)

- [ ] **Step 1: Add rrmRelevance and sentiment meta spans**

After line 174 (`<span data-pagefind-meta="type:Research" ...>`), add:

```astro
{article.rrmRelevance && <span data-pagefind-meta={`rrmRelevance:${article.rrmRelevance}`} style="display:none"></span>}
{article.sentiment && <span data-pagefind-meta={`sentiment:${article.sentiment}`} style="display:none"></span>}
```

Only emits when value is non-empty (truthy guard). Empty/missing values produce no span -- the fusion code handles absent meta as neutral default.

- [ ] **Step 2: Verify the data fields exist**

Run: `node -e "import('fs').then(f => { const a = JSON.parse(f.readFileSync('./src/data/articles.json','utf8')); const s = a.find(x => x.rrmRelevance === '5 - Core RRM'); console.log(s.title, '|', s.rrmRelevance, '|', s.sentiment); })"`

Expected: An article title with `5 - Core RRM` and a sentiment value (likely `supportive` or `neutral`).

- [ ] **Step 3: Build and spot-check a rendered article page**

Run: `npm run build 2>&1 | tail -5`

Then check the output for a known Core RRM article:

Run: `grep 'rrmRelevance' dist/library/natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa/index.html | head -3`

Expected: `data-pagefind-meta="rrmRelevance:5 - Core RRM"` appears in the HTML.

- [ ] **Step 4: Commit**

```bash
git add src/pages/library/[...slug].astro
git commit -m "feat: expose rrmRelevance and sentiment as Pagefind meta on article pages"
```

---

### Task 2: Add relevance boost and sentiment penalty to RRF fusion

**Files:**
- Modify: `src/components/SearchBar.astro:516` (after the recency boost loop, before the sort)

- [ ] **Step 1: Add relevance boost block**

After line 516 (end of recency boost loop, `}`), before line 518 (`// Sort by fused RRF score descending`), insert:

```javascript
      // RRM Relevance boost: 4th RRF signal based on rrmRelevance field.
      // Own content (Article/FAQ/Course/Guide) and Core RRM get max boost.
      // Tiebreaker strength (K=50) -- won't override strong keyword matches.
      var RELEVANCE_K = 50;
      var _relevanceMap = { '5 - Core RRM': 0, '4 - Highly Relevant': 10, '3 - Relevant': 25, '2 - Peripheral': 45, '1 - Not RRM': 60 };
      var _ownContentTypes = { 'Article': 1, 'FAQ': 1, 'Course': 1, 'Guide': 1 };
      for (var rlKey in fusedMap) {
        var rlEntry = fusedMap[rlKey];
        var rlMeta = rlEntry.data.meta || {};
        var rlRank = 30;
        if (_ownContentTypes[rlMeta.type]) {
          rlRank = 0;
        } else if (rlMeta.rrmRelevance && _relevanceMap[rlMeta.rrmRelevance] !== undefined) {
          rlRank = _relevanceMap[rlMeta.rrmRelevance];
        }
        rlEntry.score += 1 / (RELEVANCE_K + rlRank);

        // Sentiment penalty: demote hostile/critical articles
        var rlSentiment = rlMeta.sentiment;
        if (rlSentiment === 'hostile') rlEntry.score -= 0.02;
        else if (rlSentiment === 'critical') rlEntry.score -= 0.01;
      }
```

Key details:
- `_ownContentTypes` lookup is O(1), not string comparison chain
- `_relevanceMap` uses exact string values from Airtable (verified: `"5 - Core RRM"`, `"4 - Highly Relevant"`, etc.)
- `!== undefined` check handles the case where rrmRelevance has a value not in the map (falls through to default rank 30)
- Sentiment uses direct string comparison -- only 2 penalty values to check
- Loop variable names prefixed `rl` to avoid collision with existing `rKey`/`entry` in recency loop

- [ ] **Step 2: Run the existing e2e tests**

Run: `npx playwright test`

Expected: 60/60 pass. This change only affects search result ordering, not page structure or navigation.

- [ ] **Step 3: Commit**

```bash
git add src/components/SearchBar.astro
git commit -m "feat: add RRM relevance boost and sentiment penalty to search ranking"
```

---

### Task 3: Build, deploy, and verify

- [ ] **Step 1: Run guard**

Run: `npm run guard`

Expected: ALL CLEAR. Neither modified file is hash-guarded (SearchBar is not in the manifest; the article template is not guarded).

- [ ] **Step 2: Run full e2e suite**

Run: `npx playwright test`

Expected: 60/60 pass.

- [ ] **Step 3: Push to deploy**

Run: `git push origin main`

This triggers a full rebuild (code change = Pagefind re-indexes all pages with the new meta spans).

- [ ] **Step 4: Verify search ranking on live site after deploy**

Wait ~3 minutes for deploy, then test in a clean browser:

1. Search "endometriosis" -- Dr. Whittaker's commentary should be #1 (type=Article, max boost). Burney 2012 should drop below recent Core RRM papers.
2. Search "NaProTechnology" -- Hilgers and Boyle papers (Core RRM) should dominate top results.
3. Search "PCOS treatment" -- check that results are a mix of relevant articles, not just the most keyword-dense.

---

### Task 4: Update spec status

- [ ] **Step 1: Mark spec as implemented**

Change line 4 of `docs/superpowers/specs/2026-03-20-search-relevance-boost-design.md` from `**Status:** Draft` to `**Status:** Implemented`.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-03-20-search-relevance-boost-design.md
git commit -m "docs: mark search relevance boost spec as implemented"
```
