---
title: Glossary Spoke Pages (Per-Term URLs)
date: 2026-04-19
status: approved
audit_basis: 2026-04-19 GO-WITH-CONDITIONS verdict
expected_lift: ~550 clicks/90d conservative, 800-1200/mo upside
estimated_effort: ~20 hours
depends_on: []
blocks: [glossary-tier-b-rollout, glossary-ctr-snippet-optimization]
decisions:
  q1_url_format: trailing slash (/glossary/<slug>/) -- approved 2026-04-19
  q2_pillar_definedtermset: mixed (Tier A -> spokes, Tier B -> anchors) -- approved 2026-04-19
  q3_library_rail_target: internal /library/<id>/ same tab -- approved 2026-04-19
---

# Glossary Spoke Pages (Per-Term URLs)

> **For agentic workers:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

> **Coordination:** All file changes under `functions/api/` MUST go through the `coder` agent. All glossary content edits MUST route through the `/glossary-update` skill (D1 is SSOT). All Gianna-written prose MUST pass her 14 proof gates.

---

## 1. Goal + Non-Goals

**Goal.** Ship 36 indexable per-term spoke pages at `/glossary/<slug>/` for the highest-value glossary terms. Each spoke is a Cleveland-Clinic-shaped definition page (definition first, schema-rich, enrichment-railed past 300 visible words) so it (a) ranks for `[term] definition` queries currently failing on the anchored pillar, and (b) becomes citable by Perplexity / ChatGPT / Google AI Overviews. Anchored URLs (`/glossary/#slug`) get 0% AI citation rate per the audit; discrete URLs are the unlock.

**Non-goals (v1).**
- **Tier B/C terms.** 123 of 159 terms (76%) lack body length or query demand to clear the 120-word safe threshold. They stay on the pillar as anchors. Tier B rollout is gated on Tier A 60-day metrics.
- **AI Q&A widgets, "Ask Naomi about this term", related-question generators.** Not in v1.
- **MedicalProcedure / MedicalCondition schema where domain is uncertain.** Use `DefinedTerm` + `MedicalWebPage` only. Adding `MedicalCondition` requires clinical-domain confidence we don't have for terms like "body literacy" or "comprehensive evaluation".
- **Pillar removal.** `/glossary/` stays. It converts from a single mega-article to a `CollectionPage` index that links out to the spokes (and keeps anchored term bodies for backwards-compat with existing inbound anchored links).
- **Term body rewrites.** Spokes render existing `body_html` from D1 verbatim. Voice/copy edits are out of scope and route through `/glossary-update` + Gianna in a separate plan.
- **Sitemap chunk for the legacy library tier-split system.** New spokes piggyback on the existing `@astrojs/sitemap` integration; no parallel tier system.

---

## 2. Architecture

```
D1 (rrm-auth, glossary_term)              ← SSOT, 159 published terms
   │  GET /api/glossary/terms (LIBRARY_BUILD_TOKEN)
   ▼
fetch-glossary-data.mjs (existing)         ← unchanged
   ▼
src/data/glossary.json (existing)          ← terms[], references[], abbreviations[]
   │
   │  + (new build-time enrichment step)
   ▼
fetch-glossary-related.mjs (NEW)           ← reads glossary.json + GSC CSV +
   │                                         queries Vectorize REST + D1 read endpoints
   ▼
src/data/glossary-spoke-meta.json (NEW)    ← per-spoke: tier flag, related_faqs[],
                                              related_articles[], sibling_terms[],
                                              ref_subset[]
   ▼
Astro build:
   src/pages/glossary/[slug].astro        ← getStaticPaths filters tier === 'A'
   src/pages/glossary/index.astro          ← pillar, modified to CollectionPage schema
   src/pages/sitemap-glossary.xml.ts       ← (NOT NEEDED -- @astrojs/sitemap auto-includes)
   ▼
CF Pages deploy
   ▼
rrm-router 301: /commentary/glossary-of-restorative-reproductive-medicine-rrm/ → /glossary/
```

**Build-time vs request-time.**
- Spokes are statically generated. No CF Pages Function on `/glossary/<slug>/` paths.
- All enrichment data fetched at build via `fetch-glossary-related.mjs` (new). Vectorize calls happen during build (CI), not per request. Spokes ship as pure HTML.
- `_routes.json` (currently scopes Function execution) needs no change because spoke paths are static.

**Pillar conversion.**
- Keep `/glossary/` as a navigable A-Z index. Switch primary schema from `Article + MedicalWebPage + DefinedTermSet` to `CollectionPage + DefinedTermSet`. Each `DefinedTerm` `@id` now points to `/glossary/<slug>/` (Tier A) instead of `/glossary/#slug`.
- Pillar's existing anchored term bodies stay rendered (no body_html move). This preserves: (a) inbound anchor links from external sites, (b) AEO secondary surface, (c) the A-Z UX. Tier A terms get a "Read full definition →" link next to the H3 pointing to the spoke.

---

## 3. File-by-File Delta

All paths absolute under `/Users/brian/iCode/projects/rrm-academy-cf/`.

| File | Change | Lines (est) |
|---|---|---|
| `src/pages/glossary/[slug].astro` | **CREATE** -- dynamic spoke route, getStaticPaths, schema graph, rails | 280 |
| `src/lib/glossary-related.ts` | **CREATE** -- typed helpers: `loadSpokeMeta(slug)`, `extractRefsFromBody(html, refNums)`, schema builders | 180 |
| `src/components/GlossarySpokeRails.astro` | **CREATE** -- 4 rails (FAQs / Library / Sibling Terms / References) | 220 |
| `src/lib/fetch-glossary-related.mjs` | **CREATE** -- build-time enrichment fetcher (Vectorize REST + D1 read + GSC CSV) | 320 |
| `src/data/glossary-spoke-meta.json` | **CREATE** (generated) -- per-spoke meta + tier flag | data file |
| `src/data/glossary-tier-a.json` | **CREATE** (generated) -- frozen list of 36 launch slugs (audit trail) | data file |
| `src/data/glossary-gsc-90d.csv` | **CREATE** (one-time, manual) -- GSC export (slug, impressions, clicks, ctr, position) | data file |
| `src/pages/glossary/index.astro` | **MODIFY** -- swap primary schema to `CollectionPage`, add "Read full definition" links on Tier A terms, leave anchored bodies intact | +60 / -10 |
| `src/data/.baselines.json` | **MODIFY** -- add `glossary.spokes: 36` minimum-record floor | +1 |
| `scripts/glossary-snapshot.mjs` | **MODIFY** -- add per-spoke validation: HTTP 200, schema parses, ≥300 visible words, breadcrumbs present | +120 |
| `package.json` | **MODIFY** -- add `npm run fetch-glossary-related`, `npm run snapshot:spokes` scripts | +2 |
| `.github/workflows/deploy.yml` | **MODIFY** -- add `fetch-glossary-related` step after `fetch-glossary` in fetch-all path; add `snapshot:spokes` post-deploy verification | +6 |
| `tests/glossary-spokes.spec.ts` | **CREATE** -- Playwright smoke: 5 random Tier A spokes return 200 + render H1 + render at least 3 of 4 rails | 80 |
| `~/iCode/projects/rrm-router/src/index.js` | **MODIFY** -- add 301: `/commentary/glossary-of-restorative-reproductive-medicine-rrm/` → `/glossary/` | +3 |
| `astro.config.mjs` | **NO CHANGE** -- existing `@astrojs/sitemap` filter accepts `/glossary/<slug>/` automatically (no exclusion match) |  |
| `functions/api/glossary/terms.js` | **NO CHANGE** -- existing endpoint already returns full term data |  |

**File count: 5 new + 5 modified + 2 generated + 1 router = under the 5-file-per-commit cap if split per task.**

---

## 4. Schema Strategy

Each spoke emits **four** JSON-LD blocks:

### 4a. DefinedTerm (primary)

```json
{
  "@context": "https://schema.org",
  "@type": "DefinedTerm",
  "@id": "https://rrmacademy.org/glossary/<slug>/#term",
  "name": "<term name>",
  "termCode": "<abbreviation if present>",
  "description": "<extractDescription(body_html), 600-800 chars>",
  "url": "https://rrmacademy.org/glossary/<slug>/",
  "inDefinedTermSet": "https://rrmacademy.org/glossary/#defined-term-set",
  "subjectOf": { "@id": "https://rrmacademy.org/glossary/<slug>/#webpage" }
}
```

### 4b. MedicalWebPage (page wrapper)

```json
{
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  "@id": "https://rrmacademy.org/glossary/<slug>/#webpage",
  "url": "https://rrmacademy.org/glossary/<slug>/",
  "name": "<term> | RRM Glossary",
  "description": "<seo description, 120-160 chars>",
  "mainEntity": { "@id": "https://rrmacademy.org/glossary/<slug>/#term" },
  "isPartOf": { "@id": "https://rrmacademy.org/glossary/#defined-term-set" },
  "about": { "@type": "MedicalTherapy", "name": "Restorative Reproductive Medicine", "alternateName": "RRM" },
  "author": { "@id": "https://rrmacademy.org/#naomi-whittaker" },
  "publisher": { "@id": "https://rrmacademy.org/#organization" },
  "datePublished": "<term.createdAt>",
  "dateModified": "<term.updatedAt>",
  "inLanguage": "en-US",
  "specialty": { "@type": "MedicalSpecialty", "name": "Reproductive Medicine" }
}
```

### 4c. BreadcrumbList

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://rrmacademy.org/" },
    { "@type": "ListItem", "position": 2, "name": "Glossary", "item": "https://rrmacademy.org/glossary/" },
    { "@type": "ListItem", "position": 3, "name": "<term>", "item": "https://rrmacademy.org/glossary/<slug>/" }
  ]
}
```

### 4d. FAQPage (CONDITIONAL -- only if Related FAQs rail rendered with ≥1 item)

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "@id": "https://rrmacademy.org/glossary/<slug>/#faq",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "<faq.question>",
      "acceptedAnswer": { "@type": "Answer", "text": "<faq.schemaAnswer>" }
    }
  ]
}
```

**Pillar schema change:**

Replace `Article + MedicalWebPage` block with `CollectionPage`. KEEP existing `DefinedTermSet` (its `hasDefinedTerm[].url` and `@id` rewrite to point at spokes for Tier A, anchors for Tier B+).

```json
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": "https://rrmacademy.org/glossary/#collection",
  "name": "RRM Glossary",
  "url": "https://rrmacademy.org/glossary/",
  "description": "Comprehensive glossary of Restorative Reproductive Medicine terminology.",
  "isPartOf": { "@id": "https://rrmacademy.org/#website" },
  "about": { "@type": "MedicalTherapy", "name": "Restorative Reproductive Medicine" },
  "mainEntity": { "@id": "https://rrmacademy.org/glossary/#defined-term-set" },
  "hasPart": [/* one entry per Tier A spoke: { "@type":"WebPage","url":"/glossary/<slug>/","name":"<term>" } */]
}
```

---

## 5. Tier-A Term Selection

**Selection criteria (audit-derived).**
1. `body_html` strips to ≥120 visible words, OR
2. GSC impressions in last 90d ≥20, OR
3. Forced inclusion (audit's known underperformers needing rescue)

**Forced inclusions** (5 terms): `restorative-reproductive-medicine`, `naprotechnology`, `creighton-model`, `isthmocele`, `endometriosis-deep-excision` (or whichever 5 the audit identified -- locked in `glossary-tier-a.json`).

**GSC source:** No GSC data in D1. Pull a one-time CSV via Search Console API (`scripts/pull-glossary-gsc.mjs`, NEW, deferred to ops, not in this plan's coder scope) and commit `src/data/glossary-gsc-90d.csv` with columns `slug,impressions,clicks,ctr,position`. Refreshes are manual; cadence = monthly. Selection script reads this CSV at build.

**Deterministic selection (pseudocode in `fetch-glossary-related.mjs`):**

```
forced = ['restorative-reproductive-medicine', 'naprotechnology', 'creighton-model',
          'isthmocele', 'endometriosis-deep-excision']  -- audit list, lock in JSON

terms = JSON.parse(glossary.json).terms.filter(t => t.status === 'published')
gsc = readCsv('src/data/glossary-gsc-90d.csv')  // {slug → impressions}

tierA = []
for term in terms:
    body_words = stripHtml(term.bodyHtml).split(/\s+/).length
    impressions = gsc[term.slug]?.impressions ?? 0
    if term.slug in forced:
        tierA.push({slug, reason: 'forced', body_words, impressions})
    elif body_words >= 120 and impressions >= 20:
        tierA.push({slug, reason: 'qualified', body_words, impressions})

tierA.sort by impressions desc
write src/data/glossary-tier-a.json
assert tierA.length >= 30  // hard fail if criteria yields under 30; audit promised 36
assert tierA.length <= 50  // hard fail if over 50; that's a Tier B mistake
```

**Audit trail:** `glossary-tier-a.json` is committed and reviewed at every change. Deploys reading a stale list is acceptable; selection drift requires a deliberate commit.

---

## 6. Enrichment Rails Spec

Each spoke renders 4 rails below the term body. Order: term body → rails → CTAs → footer. **Each spoke must clear ≥300 visible words rendered.** If a spoke fails the gate, it falls back to `noindex` and is logged (not deployed-blocking, but flagged to ops).

| Rail | Source | Query | Limit | Dedup | Empty-state |
|---|---|---|---|---|---|
| **Related FAQs** | D1 `faq` table via `/api/faqs` cached in `faqs.json` | Match `faq.tags ⊃ [slug]` OR `faq.related_glossary_terms ⊃ [slug]`; fallback: substring match `faq.question` against `term.name` | 3 | dedup by `faq.slug` | hide section entirely (don't render header) |
| **Related Library Articles** | Vectorize via `/api/search/semantic` (REST during build) | Embed query: `term.name + " " + first 200 chars(stripHtml(body_html))`; filter `score >= 0.55`; type filter: `article` | 3 | dedup by `article.id` | show static "Browse the [Research Library](/library/)" link |
| **Sibling Glossary Terms** | `glossary.json` graph | (a) other terms whose `body_html` contains `href="#<thisSlug>"` (incoming), (b) other terms `this.body_html` links to (outgoing), (c) same-Part neighbors by sortOrder ±2; merge, score by edge type (incoming=3, outgoing=2, neighbor=1), sort desc | 5 | dedup by slug; exclude self | show all same-Part terms (capped at 5) |
| **Filtered References** | `glossary.json.references` | Parse `body_html` for `href="#ref-N"`; extract unique N values; resolve to references[]; sort by refNum asc | unlimited (typically 2-6) | dedup by refNum | hide section entirely |

**Rail data shape (in `glossary-spoke-meta.json`):**

```json
{
  "<slug>": {
    "tier": "A",
    "tier_reason": "qualified",
    "body_words": 134,
    "rendered_words_estimate": 412,
    "related_faqs": [{"slug":"...","question":"...","basicAnswer":"..."}],
    "related_articles": [{"id":"recXXX","title":"...","authors":"...","year":2023,"score":0.71}],
    "sibling_terms": [{"slug":"...","name":"...","abbreviation":"..."}],
    "ref_subset": [1, 3, 14, 22]
  }
}
```

**Why pre-compute at build, not at runtime:** Vectorize REST calls cost AI tokens + latency. Computing once per build (≤36 calls × 1 deploy/day max) is cheap. Spokes ship as pure HTML, no Function dependency.

---

## 7. Anchor Link Migration

**Rule:** Author rule for new content -- use `/glossary/<slug>/` for all cross-refs to Tier A terms. Old anchored cross-refs (`href="#<slug>"`) on the pillar STAY as same-page jumps and continue to work.

**Where anchored links live today:**
- Inside term bodies on the pillar (14+ wired in prior session)
- Inside FAQs and commentary posts (untouched in v1)
- External backlinks (untouched, never edit)

**On spokes:**
- The spoke's own term body retains its existing `<a href="#refN">` for citation back-links (these resolve to the spoke's local references list, not the pillar).
- Cross-refs inside the spoke's term body that point to OTHER terms (e.g., `<a href="#endometriosis">`) get rewritten at render time to `/glossary/<slug>/` if target is Tier A, else left as `/glossary/#<slug>` (cross-page anchor). Implement in `glossary-related.ts:rewriteCrossRefs(bodyHtml, tierASlugs)`.

**On the pillar:**
- Add `<a class="spoke-link" href="/glossary/<slug>/">Read full definition →</a>` next to every Tier A `<h3>`. Render conditionally when `tier === 'A'`.
- Existing `<a href="#<slug>">` cross-refs inside other term bodies STAY (same-page anchor still works). DO NOT rewrite pillar cross-refs to spokes -- breaks UX for users on the A-Z reference page.

**Direct-hit redirects (`/glossary/#slug` → `/glossary/<slug>/`):** SKIP. The fragment never reaches the server, so a JS redirect would only fire after the pillar loads, defeating the SEO purpose. Inbound traffic to `/glossary/#slug` lands on the pillar (correct), and Tier A terms have the "Read full definition →" link above their definition. Acceptable.

**Forward-going Gianna rule:** When `/glossary-update` skill adds new terms, cross-refs to Tier A terms inside the new term's body should be authored as `/glossary/<slug>/`. Document in skill.

---

## 8. Build-Time vs Request-Time

| Concern | Decision | Why |
|---|---|---|
| Spoke HTML generation | Build-time via `getStaticPaths` | Spokes are static; no per-user content |
| Tier A selection | Build-time via `fetch-glossary-related.mjs` | Reads committed CSV + glossary.json; deterministic |
| Vectorize related-articles query | Build-time via REST | Avoid AI token cost per request; ≤36 queries per deploy is trivial |
| Related FAQs match | Build-time, reads `faqs.json` | Already in build; zero extra deps |
| Sibling terms | Build-time, in-memory graph | `glossary.json` already loaded; cheap |
| Reference filtering | Build-time, regex on `body_html` | Pure string ops |
| Cross-ref rewriting | Build-time, in `[slug].astro` render | Static decision per slug |

**No runtime Function calls.** `_routes.json` is unchanged. No new D1 reads at request time.

---

## 9. CI / Deploy Guard Updates

**`.baselines.json` additions:**

```json
{
  ...existing keys,
  "glossary.terms": 159,         // existing
  "glossary.references": 76,     // existing
  "glossary.abbreviations": 61,  // existing
  "glossary.tierA": 36           // NEW -- minimum spoke count
}
```

**Hardcoded floors in `deploy.yml`:** Add `glossary tier A spokes >= 30` (slack of 6 below 36 to allow CSV-driven contraction; under 30 = abort deploy).

**`scripts/glossary-snapshot.mjs` extensions:**

Add a `--spokes` flag. When set:
1. For each slug in `glossary-tier-a.json`:
   - Fetch `https://rrmacademy.org/glossary/<slug>/` (or read `dist/glossary/<slug>/index.html`)
   - Assert HTTP 200 (live mode) or file exists (build mode)
   - Assert `<h1>` count === 1
   - Assert at least 3 of 4 JSON-LD blocks present (DefinedTerm, MedicalWebPage, BreadcrumbList; FAQPage optional)
   - Assert visible word count ≥300
   - Assert breadcrumb anchor present
   - Assert canonical = `https://rrmacademy.org/glossary/<slug>/`
2. Aggregate failures into single non-zero exit

Wire two npm scripts:
- `npm run snapshot:spokes` (build mode)
- `npm run snapshot:spokes:live` (live mode, post-deploy)

**Playwright addition:** `tests/glossary-spokes.spec.ts` -- pick 5 random Tier A slugs from `glossary-tier-a.json`, navigate, assert H1 visible, assert 3+ rails render. Run as part of existing `npm test` suite.

**Deploy step ordering in `deploy.yml`:**
```
1. fetch-all (existing)
2. fetch-glossary-related (NEW -- depends on glossary.json + faqs.json + articles.json)
3. astro build (now generates spokes)
4. pagefind (existing)
5. snapshot:spokes (NEW -- build mode, blocks deploy on failure)
6. deploy to CF Pages
7. snapshot:spokes:live (NEW -- 30s after deploy completes, alert-only, doesn't block)
```

---

## 10. Rollout Sequence

Each step independently shippable. Each step ends with a verification gate. **Do not advance without passing PG and review.**

### Step 1 -- Dynamic route + helper + 1 hand-picked spoke

- [ ] Create `src/lib/glossary-related.ts` with stubs: `loadSpokeMeta`, `extractDescription`, `extractRefSubset`, `rewriteCrossRefs`, schema builders
- [ ] Create `src/pages/glossary/[slug].astro` with `getStaticPaths` filtering to a single hardcoded slug (`restorative-reproductive-medicine`) for smoke
- [ ] Render: breadcrumb, H1, term body (raw), references subset (no rails yet), 4 schema blocks
- [ ] Smoke test: `npm run build && curl -sI http://localhost:4321/glossary/restorative-reproductive-medicine/ | grep -i 'HTTP\|content-type'`
- [ ] Validate schema: paste built JSON-LD into Schema.org validator + Rich Results Test

**PG:** Page renders, exactly 1 H1, breadcrumb visible, 4 JSON-LD blocks parse, no console errors.

### Step 2 -- Enrichment rails on the smoke spoke

- [ ] Create `src/lib/fetch-glossary-related.mjs` with full logic for the smoke slug only (skip GSC CSV; use forced-inclusion path)
- [ ] Create `src/components/GlossarySpokeRails.astro`
- [ ] Wire rails into `[slug].astro` between term body and CTAs
- [ ] Run `npm run fetch-glossary-related` to generate `glossary-spoke-meta.json` (single entry)
- [ ] Build, verify rendered HTML contains: 3+ rails, ≥300 visible words

**PG:** Word count gate passes; all 4 rails render or empty-state correctly; FAQPage schema appears IFF related FAQs rail has items.

### Step 3 -- Schema validation pass

- [ ] Run Schema.org validator on smoke spoke HTML -- zero errors
- [ ] Run Rich Results Test (manual) -- DefinedTerm + BreadcrumbList recognized; FAQPage if applicable
- [ ] Run ClassySchema visualization -- all `@id` references resolve

**PG:** All validators green.

### Step 4 -- Full Tier A rollout

- [ ] Manually pull GSC CSV (90d glossary slugs) and commit to `src/data/glossary-gsc-90d.csv`
- [ ] Run `fetch-glossary-related.mjs` against full term set; verify `glossary-tier-a.json` contains 30-50 slugs (audit target: 36)
- [ ] Update `.baselines.json` (`glossary.tierA: <count>`)
- [ ] Update `[slug].astro` getStaticPaths to consume `glossary-tier-a.json`
- [ ] Build, run `npm run snapshot:spokes` -- all spokes pass
- [ ] Add `tests/glossary-spokes.spec.ts` Playwright smoke
- [ ] Run full `npx playwright test` -- 60+5 tests pass

**PG:** All 36 spokes ≥300 words, all schemas valid, Playwright green, baseline set.

### Step 5 -- Pillar conversion to CollectionPage

- [ ] Modify `src/pages/glossary/index.astro`:
  - Replace `pageSchema` with `CollectionPage`
  - Update `definedTermSetSchema.hasDefinedTerm[].url` and `@id` to point at `/glossary/<slug>/` for Tier A slugs
  - Add `<a class="spoke-link" href="/glossary/<slug>/">Read full definition →</a>` next to Tier A H3s
  - Add `hasPart[]` array of Tier A WebPage references
- [ ] Run `scripts/glossary-snapshot.mjs` on the modified pillar -- confirm structural integrity (term count, ref count, citation links)
- [ ] Build + curl verify pillar still renders correctly

**PG:** Pillar passes existing snapshot; new schema validates; spoke links visible on Tier A H3s.

### Step 6 -- Router 301

- [ ] In `~/iCode/projects/rrm-router/src/index.js`, add 301: `/commentary/glossary-of-restorative-reproductive-medicine-rrm/` → `/glossary/`
- [ ] `cd ~/iCode/projects/rrm-router && npx wrangler deploy`
- [ ] Verify: `curl -sI https://rrmacademy.org/commentary/glossary-of-restorative-reproductive-medicine-rrm/ | head -5` returns 301 with correct Location

**PG:** 301 hits, Location header correct.

### Step 7 -- Live smoke test

- [ ] Deploy to production via `gh workflow run "Build & Deploy"`
- [ ] Wait for deploy completion
- [ ] Run `npm run snapshot:spokes:live` -- all 36 spokes return 200, schema validates
- [ ] Spot-check 5 spokes manually in browser

**PG:** All 36 spokes live, schema valid, no console errors.

### Step 8 -- GSC submission

- [ ] In Search Console, no separate sitemap submission needed (auto-included in `sitemap-0.xml`)
- [ ] Use URL Inspection API to request indexing for all 36 spokes (rate limit: 200/day, batch script)
- [ ] Verify sitemap shows new URLs: `curl -s https://rrmacademy.org/sitemap-0.xml | grep glossary`

**PG:** All 36 in sitemap; index requests submitted.

### Step 9 -- 30/60/90 day metric checkpoints

Per audit:
- **Day 30:** Index coverage ≥90% (33+/36); GSC clicks vs baseline; AI citation hit-rate test (Perplexity 25-query battery)
- **Day 60:** GSC clicks ≥+200; AI citation rate ≥30% on Tier A definition queries; CTR ≥avg site CTR
- **Day 90:** GSC clicks ≥+550 (audit conservative target); evaluate Tier B promotion

**Hard fail (abort Tier B):** Any spoke gets manual `noindex` from Google's quality classifier within 60 days; OR aggregate clicks at Day 60 are NEGATIVE; OR Vectorize retrieval rank for `/glossary/` drops more than 1 position.

---

## 11. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Indexation surge triggers Google quality classifier; spokes flagged as thin | Medium | High | Mandatory ≥300-word gate; Tier A only; rich enrichment rails; FAQPage schema only when populated; use audit's competitor archetype (Cleveland Clinic shape) as visual benchmark |
| 2 | JSON-LD schema validation fails at scale (e.g. orphan `@id`) | Medium | Medium | `snapshot:spokes` validates per-spoke at build; `glossary-related.ts` schema builders are typed; smoke step validates against Schema.org validator before scale-up |
| 3 | Vectorize cold-start latency in build (CI timeout) | Low | Medium | 36 sequential Vectorize calls × ~200ms = ~10s. Well under timeout. Add `fetch-retry.mjs` wrapper. Cache results in `glossary-spoke-meta.json` (committed) so cache hit = zero calls |
| 4 | Internal link authority dilution (pillar → 36 spokes) | Low | Low | Spokes link back to pillar via breadcrumb + `inDefinedTermSet`; bidirectional sibling rail; pillar retains anchored bodies (no content move) |
| 5 | Router 301 chain conflicts (rrm-router runs BEFORE CF Pages) | Low | High | Test 301 immediately after deploy; check existing slug-redirects.js for conflicts; use single 301 (no chains); verify `curl -sIL` returns 200 at final hop |
| 6 | GSC CSV staleness (manual refresh cadence) | Medium | Low | Audit logs CSV `generated_at`; `fetch-glossary-related.mjs` warns if CSV >60d old; selection floor of 30 spokes prevents catastrophic shrinkage |
| 7 | Empty rails on a spoke render visible "empty" sections | Low | Medium | Empty-state behavior per rail (table in §6); rails component conditionally renders entire section |
| 8 | Pillar schema change breaks existing snapshot test | Medium | Low | Update `glossary-snapshot.mjs` in same commit; new `CollectionPage` schema documented in §4 |
| 9 | Tier A list churn breaks live URLs (term passes-then-fails criteria) | Low | High | `glossary-tier-a.json` is committed and reviewed; passing-then-failing requires deliberate commit; if a spoke must be removed, redirect to pillar with anchor (`/glossary/<slug>/` → `/glossary/#<slug>`) via router |
| 10 | Coder agent churn on `[slug].astro` (sibling pattern drift from `[...slug].astro` style) | Low | Low | Audit-reference: read `library/[...slug].astro` and `commentary/[...slug].astro` before writing; match patterns; arise-scanner runs as proof gate |

---

## 12. Success Metrics + Abort Criteria

**30-day:**
- Index coverage: ≥33/36 spokes indexed in GSC
- AI citation rate: re-run audit's 25-query AEO battery; expect Tier A definition queries to lift from 10% → 25%+
- No spike in 404s, soft-404s, or quality-classifier flags

**60-day:**
- GSC clicks: aggregate Tier A spoke clicks ≥+200 vs baseline (pillar-only)
- AI citation rate: ≥40% on Tier A definition queries (audit upper bound: 60%)
- CTR: spokes meet or exceed site average (~3.5%)

**90-day:**
- GSC clicks: ≥+550 (audit conservative); upside: 800-1,200/mo
- Tier B/C promotion decision: GO if all metrics green; HOLD if any 60-day metric red

**Hard abort triggers (any one halts Tier B and may revert spokes):**
- Any spoke receives manual quality-classifier noindex within 60 days
- Aggregate spoke clicks NEGATIVE vs baseline at Day 60
- Vectorize/Perplexity retrieval rank for `/glossary/` drops >1 position
- Spike in pillar bounce rate (>+10pp) suggesting users hit spokes and never return

**Revert procedure:** Remove `getStaticPaths` filter (yields zero spokes), revert pillar to `Article` schema, revert router 301. All in one PR. `git diff --stat` shows only the 8 files in §3.

---

## 13. Estimated Effort

| Step | Hours |
|---|---|
| 1. Dynamic route + helper + 1 spoke | 2.5 |
| 2. Enrichment rails on smoke spoke | 3.0 |
| 3. Schema validation pass | 1.0 |
| 4. Full Tier A rollout (36 spokes, baselines, Playwright) | 3.5 |
| 5. Pillar conversion to CollectionPage | 2.0 |
| 6. Router 301 | 0.5 |
| 7. Live smoke test | 1.0 |
| 8. GSC submission (script + manual review) | 1.5 |
| 9. Day-30 checkpoint review | 1.0 |
| **Pre-step: GSC CSV pull script (one-time)** | 1.5 |
| **Pre-step: Read sibling templates, design docs** | 1.0 |
| **Buffer (validation iteration, schema fixes)** | 2.5 |
| **Total** | **~21 hours** |

Within audit's 20-hour estimate (±5%).

---

## 14. Decisions (Resolved 2026-04-19)

All three blocking decisions confirmed by Brian. Plan status: **approved**.

### Q1. URL format -- trailing slash or no? **DECIDED: trailing slash**

`/glossary/<slug>/` confirmed. Matches Astro `trailingSlash: 'always'` and all existing dynamic routes (`/library/[slug]/`, `/commentary/[slug]/`, `/faqs/[slug]/`).

### Q2. DefinedTermSet on pillar -- mixed Tier-A-spokes / Tier-B-anchors? **DECIDED: mixed**

Tier A entries: `@id = /glossary/<slug>/#term`, `url = /glossary/<slug>/`. Tier B entries: `@id = /glossary/#<slug>`, `url = /glossary/#<slug>` (current behavior preserved). Preserves citable structured data on all 159 terms.

### Q3. Related Library Articles rail -- internal same-tab? **DECIDED: internal same-tab**

`/library/<id>/` same tab. Matches existing library card UX across the site.

---

## Appendix A: Tier A Selection SQL (Audit Reference)

GSC data is not in D1, so the selection runs in Node (`fetch-glossary-related.mjs`), not SQL. The conceptual SQL if we ever migrate GSC into D1:

```sql
-- Hypothetical, not run in v1
SELECT
  gt.slug,
  gt.name,
  LENGTH(REPLACE(REPLACE(gt.body_html, '<', ' <'), '>', '> ')) AS body_chars,
  COALESCE(gsc.impressions_90d, 0) AS impressions
FROM glossary_term gt
LEFT JOIN gsc_glossary_90d gsc ON gsc.slug = gt.slug COLLATE NOCASE
WHERE gt.status = 'published'
  AND (
    LENGTH(gt.body_html) >= 800  -- ~120 visible words after HTML strip
    OR COALESCE(gsc.impressions_90d, 0) >= 20
    OR gt.slug IN ('restorative-reproductive-medicine', 'naprotechnology',
                   'creighton-model', 'isthmocele', 'endometriosis-deep-excision')
  )
ORDER BY impressions DESC, body_chars DESC;
```

For v1, replicate this logic in JavaScript using the committed `glossary-gsc-90d.csv`.

---

## Appendix B: Sample Spoke URL Map (Generated at Build)

`src/data/glossary-tier-a.json` will look like:

```json
{
  "generatedAt": "2026-04-19T...",
  "gscSourceDate": "2026-04-15",
  "tierA": [
    {"slug":"restorative-reproductive-medicine","reason":"forced","body_words":98,"impressions":1200},
    {"slug":"naprotechnology","reason":"forced","body_words":110,"impressions":890},
    {"slug":"endometriosis","reason":"qualified","body_words":156,"impressions":340},
    ...
  ],
  "count": 36
}
```

---

## Appendix C: Memory Reference

The agent memory file `glossary-ref64-citation-mismatch.md` notes that `ref-64` has a slug-collision issue (Hilgers Ch6 CrMS reference points at unrelated 2020 food-processing paper, 404s live). This is **not blocking** for this plan but should be fixed in `glossary_reference` before any Tier A spoke that cites `#ref-64` ships. Verify at Step 4 by grepping `glossary-spoke-meta.json` for `ref_subset` containing `64`; if any spoke depends on it, fix the D1 row first via `/glossary-update` skill.
