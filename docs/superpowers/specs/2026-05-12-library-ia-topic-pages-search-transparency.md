# Library IA Redesign — Topic Pages + Search Transparency

**Status:** Spec (pre-implementation)
**Date:** 2026-05-12
**Author:** Brian / Claude (Opus 4.7)
**Validated against:** 5 Haiku UX simulations (Sarah/PCOS patient, Maria/NaPro-curious, Alex/endo researcher, Dr. Liu/clinician, Jess/Gen Z visitor)
**Supersedes:** N/A
**Related:** Atlas homepage redesign (commit `371c79f`, branch `claude/library-homepage-atlas-redesign`)

---

## TL;DR

The atlas homepage shipped two days ago looks like it offers two ways to find content (search box vs. topic tiles) but they are actually the same affordance with cosmetic differences — both seed a global Pagefind query and overlay results on top of the page. 5 of 5 Haiku UX participants conflated them, and 3 of 5 abandoned the site or downgraded their trust as a result. This spec defines:

1. **Real topic pages** at `/library/topics/[slug]/` — clicking a tile *navigates*, not searches.
2. **Search transparency** — results grouped by content type with explicit bucket headers (Research, Commentary, FAQs, Glossary, Courses, Guides), so visitors can see what they're actually searching across.
3. **Count consistency** — the number on a tile equals the number on the topic page equals the number returned by an exact-topic search.
4. **Patient-track affordance** — surface a "New here? Start with What is RRM" entry above the atlas on `/library/`, plus FAQ surfacing for patient-language queries.
5. **Journal trust signal** — open question: how to contextualize *Journal of Restorative Reproductive Medicine* (independent journal, not in-house) so clinicians don't pattern-match it as captured advocacy.

Builds on the atlas redesign; does not re-do it.

---

## Problem (Evidence)

5 Haiku-driven persona walkthroughs of the current state (commit `371c79f` of `claude/library-homepage-atlas-redesign`). Each persona had a clinical info-seeking task and was asked to narrate friction in plain language.

### Problem 1 — Topic tiles are mislabeled

Tiles look like categories. They behave like search seeds. Clicking *Endometriosis* → `?topic=Endometriosis` → SearchBar drops the string into its input → Pagefind runs a query → results overlay covers the tiles.

**Evidence:** 5/5 participants expected a category page after clicking a tile. 0/5 understood what actually happens. Maria: *"Did I click the wrong thing? Did the filter reset?"* Alex (savvy patient): *"topic grid disappeared then reappeared. This feels like broken UX."*

### Problem 2 — Search box and topic tiles indistinguishable

Same UI metaphor (rounded surface, clickable affordance) used for two different operations.

**Evidence:** Sarah: *"they look like they do the same thing"*; Maria: *"feel like the same thing but one is a search and one is a filter"*; Alex: confused which one she invoked.

### Problem 3 — Count discrepancy destroys trust

Tile shows *"Endometriosis · 259 articles"* (article-count via topic-string prefix). Search overlay shows *"RESEARCH 45"* (Pagefind result-count for keyword "Endometriosis", which excludes articles where the topic is present but the keyword isn't densely repeated in indexed text). Both numbers are correct under their respective definitions, but the discrepancy is silent.

**Evidence:** 3/5 participants flagged the mismatch. Alex: *"The inconsistency suggests either: (1) the site doesn't know its own data, or (2) there's hidden filtering I'm not seeing. Either way, I don't trust the counts."* Dr. Liu independently flagged the same suspicion.

### Problem 4 — Search results scope is invisible

Pagefind indexes all content types (articles + commentary + FAQs + glossary + courses + guides). The overlay shows `RESEARCH N` as a section header, then mixes other content types into the same view without clear labeling.

**Evidence:** Maria: *"is RESEARCH 45 — wait, only 45 — that seems low for a 'largest collection'?"* Jess: *"I'm not 100% sure if it searches just the library or the whole site."* Visitors can't tell if a result is an article or a glossary term.

### Problem 5 — Patient track is missing

Atlas page assumes the visitor knows what RRM is, can read journal abstracts, and is OK landing on a peer-reviewed-research view as their first contact with the site.

**Evidence:** Sarah (PCOS patient): *"This is a research database for doctors, not for regular people."* Jess (Gen Z): *"Still don't know what RRM stands for, and that's a red flag for trust. Close tab."* Both bounced.

### Problem 6 — JRRM credibility risk

*Journal of Restorative Reproductive Medicine* is an independent peer-reviewed journal, but the name overlap with the site brand (rrmacademy.org) triggers clinician suspicion of in-house advocacy publication.

**Evidence:** Dr. Liu specifically flagged this as the single tipping signal: *"The 'Journal of Restorative Reproductive Medicine' appearing twice on the first page of results... that journal is not in mainstream citation databases."* (His characterization of it as "in-house" is incorrect, but the perception risk is real and recurring.)

---

## Goals

- **G1:** Topic tile → dedicated `/library/topics/[slug]/` page with a clear back path. Tile click = navigation, not search.
- **G2:** Search results visibly grouped by content type with bucket headers and counts. One search, transparent scope.
- **G3:** Tile count equals topic-page count equals exact-topic-search count. Single source of truth.
- **G4:** First-time visitors find a "What is RRM" entry path within 5 seconds of landing on `/library/`.
- **G5:** Library-page search and global header search remain visually + behaviorally identical (one model to learn). Cross-content scope is communicated, not hidden.
- **G6:** JRRM and similar perception-risk journals get a one-line "About this journal" disclosure surface (filter chip tooltip or sidebar entry on the journal-filter list) so clinicians can resolve their pattern-match concern in one click.

## Non-goals

- Splitting the search into a library-scoped vs site-scoped search. (Two searches would worsen the spaghetti.)
- Removing the atlas. The 9-tile homepage stays.
- Redesigning the commentary or FAQ surfaces.
- Editorial changes to article taxonomy. Topic strings stay hierarchical.

---

## IA Model

```
                                    ┌──────────────────────────────┐
                                    │ /library/         (atlas)    │
                                    │  hero + search                │
                                    │  9 topic tiles                │
                                    │  recently published           │
                                    │  + NEW "New here?" affordance │
                                    └──────────┬───────────────────┘
                                               │
                            ┌──────────────────┼──────────────────┐
                            │                  │                  │
                            ▼                  ▼                  ▼
         ┌────────────────────────┐  ┌──────────────────┐  ┌──────────────────┐
         │ /library/topics/       │  │ Search overlay   │  │ /library/page/1/ │
         │  index of topics       │  │ grouped buckets  │  │ all articles     │
         └─────────┬──────────────┘  │  Articles N      │  │ sidebar filters  │
                   │                 │  Commentary N    │  │ (Mockup C)       │
                   ▼                 │  FAQs N          │  └──────────────────┘
         ┌────────────────────────┐  │  Glossary N      │
         │ /library/topics/[slug]/│  │  Guides N        │
         │  pre-filtered cards    │  │  Courses N       │
         │  sidebar filters       │  └──────────────────┘
         │  pagination            │
         └────────────────────────┘
```

**Two distinct affordances, two distinct outcomes:**

| Affordance | Trigger | Destination | Content |
|---|---|---|---|
| Search box | typing → Enter | overlay results, in-page | all content types, grouped buckets |
| Topic tile | click | new page `/library/topics/[slug]/` | only articles tagged that topic, paginated, filterable |

The atlas homepage hosts both. They no longer collide.

---

## Page-by-page changes

### 1. `/library/` (atlas homepage)

**Keep:** 9 topic tiles, recently-published row, counts strip, search bar component.

**Add:**
- A "New here?" affordance ABOVE the atlas hero, full-width strip:
  ```
  ╭───────────────────────────────────────────────────────────────╮
  │ ✦  New to restorative reproductive medicine?                  │
  │    Start with our patient guide → /what-is-rrm/               │
  ╰───────────────────────────────────────────────────────────────╯
  ```
  Dismissible. Stays for visitors without a session cookie.
- One line under the search input:
  *"Searches articles, commentary, FAQs, and the glossary across the academy."*

**Change:**
- Topic tile `href` changes from `?topic=NAME` → `/library/topics/SLUG/` where SLUG is the kebab-cased canonical topic label.
  - `match: ['Endometriosis']` → `/library/topics/endometriosis/`
  - `match: ['Menstrual Cycle']` → `/library/topics/menstrual-cycle/`
  - `match: ['Contraception/Comparison']` → `/library/topics/contraception-comparison/`
- Tile **count** stays the same (article count from build-time aggregation against `t.match`). This is the canonical count from now on.

**Keep `?topic=X` working** as a router-level 301 redirect to `/library/topics/SLUG/` so existing inbound links don't break.

### 2. NEW: `/library/topics/` (topic index)

A spartan index. Same atlas-style grid, no other content. 21 tiles (one per top-level topic segment in the corpus), not just the 9 curated on the homepage. Visual rule: tiles for the 9 curated stay highlighted; remaining 12 are quieter.

**Breadcrumb:** Research Library › Topics

### 3. NEW: `/library/topics/[slug].astro` (topic page)

`getStaticPaths()` returns one entry per unique top-level topic segment (21 today, will fluctuate as the library grows). Each page renders:

- **Hero:** Topic name (Cormorant 2-2.5rem), topic descriptor (`t.desc` from the existing TOPICS array on `/library/`), article count, last-updated.
- **Sidebar filters (Mockup C v2 pattern):** year range, sub-topic (the next-level-down segments like *Endometriosis > Surgery > Excision*), journal, access.
- **Card grid:** Cards inherit the homepage `.recent-card` style (with small topic-color dot in top-left). 50 cards per page, paginated.
- **Mobile:** bottom-sheet filter drawer.

**URL semantics:**
- Slug = kebab-cased data label, not display label. `/library/topics/menstrual-cycle/` (matches data) NOT `/library/topics/hormones-and-cycle/` (display label).
- Display label can still appear in the H1 ("Hormones & Cycle") via the same display→data alias map used on `/library/`.

**Schema.org:** `CollectionPage` with `about` pointing to a `MedicalCondition` / `MedicalProcedure` where applicable. Improves AEO grouping.

### 4. `/library/page/[page]/` (all articles)

Adopt Mockup C v2 layout: sidebar filters + card grid using the `.recent-card` pattern. Removes the current ArticleCard list (with abstracts + hierarchical chips) which Haiku Alex called *"density that is noise rather than signal."*

Already drafted as `docs/mockups/library-redesign/all-c-filters.html`. Implementation TBD.

### 5. SearchBar (component)

Group results by content type, in this order:

```
┌─ Research articles (45)
│  Cards 1–5, "Show all 45 →"
├─ Commentary (3)
│  Title + author + 1-line excerpt
├─ FAQs (1)
│  Question + 1-line answer
├─ Glossary (2)
│  Term chip(s)
├─ Guides (1)
│  Card with H1 + dek
└─ Courses (0 — hide section)
```

Each bucket is its own `<section>` with its own H3 (visually = .section-label / eyebrow pattern). Empty buckets hide entirely. The "Show all N →" link in the Research bucket navigates to `/library/page/1/?q=QUERY` with the search prefilled — so the user can drill into article-only results.

**Behavioral change:** if `?topic=X` is in the URL on first load, redirect to `/library/topics/<slug>/`. (Bridges existing topic-tile links until the next deploy.)

---

## Count canonicalization (G3)

**Canonical count = "articles where any topic field starts with the data label (case-insensitive)."** This is what the homepage tiles compute today. Adopt as the single source of truth.

Pagefind search results count ≠ canonical count by design. Mitigations:

1. **Don't surface search counts as "topic counts."** If a user types "Endometriosis" in the search box, the overlay shows `Research articles (45)` — and that's correct for the search query, not for the topic taxonomy.
2. **Topic page H1 shows canonical count:** "Endometriosis — 259 articles." Visitor sees the same number they saw on the tile.
3. **Search overlay never displays a tile-style count for a topic.** Topic concepts only appear under "Refine by topic" inside the overlay, where they link to the topic page (not a sub-query).

This resolves the 259/45 trust break without changing the underlying indexing.

---

## JRRM journal disclosure (G6)

Three options on the table, pick one:

**Option A — Journal filter chip tooltip.** On topic pages and `/library/page/1/`, the journal-filter sidebar list shows journals alphabetically. Each row gets a small "ⓘ" affordance. Tap → tooltip: *"Journal of Restorative Reproductive Medicine is an independent peer-reviewed journal launched 2024 by [publisher]. Not affiliated with RRM Academy."*

Pros: surfaces only when a user is filtering by journal (active interest).
Cons: invisible to first-time browsers.

**Option B — Inline byline disclosure on article cards.** Every card displaying "JRRM" as a journal gets a (mini-info) icon. Hovering reveals the same text. Visible everywhere, low ink.

Pros: catches Dr. Liu-class visitors who scan card metadata. Cons: visual clutter on every card.

**Option C — "About our sources" page linked from the counts strip.** A `/library/about-sources/` page explains the indexing methodology, lists the top-cited journals with one-line context for each, and discloses the relationship (or lack thereof) with publisher orgs.

Pros: defensible documentation, easy to maintain. Cons: requires user click; doesn't address in-the-moment skepticism.

**Recommendation:** A + C. Filter chip tooltip handles the in-the-moment trust question for users who are filtering, and the "About our sources" page answers it for everyone who follows up.

---

## Phased implementation

### Phase 1 (this PR — `claude/library-ia-topic-pages`)
- Add `src/pages/library/topics/[slug].astro` with `getStaticPaths()` returning the 21 top-segment slugs.
- Add `src/pages/library/topics/index.astro` (topic index).
- Update homepage `TOPICS` array: tile href → `/library/topics/SLUG/`.
- Add router rule: `/library/?topic=X` → 301 `/library/topics/SLUG/`.
- Add `rrm-router` entry: `/library/topics/` to `ASTRO_ROUTES`.
- Wire the canonical topic count to the topic page H1.
- Add the "Searches articles, commentary, FAQs, and the glossary" subline under SearchBar on `/library/`.
- Add "New here?" affordance above the atlas hero.
- Acceptance: every topic tile click lands on a real page (no overlay); page H1 count == tile count.

### Phase 2 (separate PR — `claude/library-search-buckets`)
- Modify SearchBar overlay markup to group results by content type with explicit section headers.
- Empty buckets hide. Research bucket has "Show all N →" link to `/library/page/1/?q=QUERY`.
- Acceptance: each search result is visibly tagged with its source type; bucket counts sum to total.

### Phase 3 (separate PR — `claude/library-page-c-filters`)
- Port Mockup C v2 to `src/pages/library/page/[page].astro`.
- Sidebar filters: year range, journal, access, sub-topic.
- Bottom-sheet drawer on mobile.
- Acceptance: 24 e2e tests still pass; mobile filter sheet opens/closes; filter combinations update the URL and the result count.

### Phase 4 (separate PR — `claude/library-sources-disclosure`)
- Build `/library/about-sources/` page.
- Add journal-filter tooltip with publisher attribution.
- Acceptance: clicking ⓘ on a journal name shows the tooltip; tapping "About our sources" from the homepage counts strip lands on the page.

---

## Proof gates / acceptance criteria

**G-T1** Every topic tile on `/library/` navigates to a real page (not a query string). Manual check: 9 clicks land on 9 distinct URLs under `/library/topics/`.

**G-T2** Topic page count == tile count. Build-time assertion in `scripts/check-topic-counts.mjs`: read TOPICS array, compute canonical count, assert equals the count rendered in the topic page H1.

**G-T3** Search bucket headers all present when a query has hits in mixed content types. e2e: search `"endometriosis"`, assert presence of `Research articles`, `Commentary`, `FAQs`, `Glossary` headers.

**G-T4** `?topic=X` redirects 301 to `/library/topics/SLUG/`. e2e: `GET /library/?topic=Endometriosis` returns 301 with location `/library/topics/endometriosis/`.

**G-T5** Mobile bottom-sheet filter on `/library/page/1/` opens via the filter button. e2e: `iphone-se` viewport, click "Filters", assert sheet visible.

**G-T6** "About our sources" page links from the counts strip on `/library/`. e2e: assert `<a href="/library/about-sources/">` present in the counts strip.

**G-T7** Type check baseline holds (≤ 254 errors). Security guard passes.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Build-time `getStaticPaths` for 21 topics * paginated card grids inflates `dist/` size and deploy time | Medium | Medium | Cap topic-page card grid at 50/page; cap pagination depth to first 10 pages per topic; defer deeper pages to dynamic Pagefind queries |
| Re-classification of articles will shift tile counts and topic-page counts post-launch | High | Low | Build-time computation re-runs on every deploy; counts auto-update. Annotate the spec to flag the dependency. |
| `?topic=X` redirects break inbound search-engine traffic during the transition | Low | Medium | 301s preserve SEO; rrm-router handles the redirect at the edge (no roundtrip to Astro) |
| Bucket grouping in SearchBar overlay slows down Pagefind result rendering | Low | Low | Pagefind already returns results with content-type metadata; grouping is a CSS/template change, not a query change |
| "New here?" affordance creates new responsibility for `/what-is-rrm/` to be a great patient entry | Medium | Low | Existing pillar guide is already designed for this audience |
| Patient-track copy on the homepage adds new copy that hasn't been Brian-approved | High | Medium | Treat as draft; Brian signs off explicitly before merge |

---

## Open questions

1. **What about topic-aliasing for AEO?** The 9 curated tiles include display-label aliases (e.g., "Hormones & Cycle" → "Menstrual Cycle"). Topic pages will use canonical slugs. Do we want a `301 /library/topics/hormones-and-cycle/ → /library/topics/menstrual-cycle/` redirect to preserve external links that used the display label?

2. **What lives at `/library/topics/`?** Just the 21 topic tiles (atlas-style), or also a sub-navigation to *next-level* segments like "Endometriosis > Surgery", "Endometriosis > Disease Classification", etc.? The latter is much more work but unlocks navigability into clinical sub-areas without typing.

3. **Should the homepage tiles continue to be a curated 9, or expand to all 21?** The Haiku run didn't surface this — but if patients are filtering for "Bone Health" (240 articles) or "Andrology" (121 articles) and don't see those on the homepage, they may bounce. Counter-argument: 9 tiles is a single-tap mobile experience; 21 isn't.

4. **What does the cards-by-content-type icon system look like?** Currently the atlas uses 4 accent colors (purple/rose/sage/sand) for the 9 tiles. Search-overlay buckets will need *6* content-type indicators (Articles, Commentary, FAQs, Glossary, Guides, Courses) — these should be visually distinct from the topic-tile palette to avoid color overload. Probably icons + grayscale, not new accent colors.

---

## Appendix — Haiku UX session findings (full)

Sessions captured 2026-05-12 against `claude/library-homepage-atlas-redesign` commit `371c79f`. Each persona walked through 3 screenshots: `state-home.jpg` (atlas), `state-topic-search-overlay.jpg` (post-topic-click), `state-all-articles-current.jpg` (View all →).

| Persona | Outcome | Single most-damaging finding |
|---|---|---|
| Sarah (PCOS patient) | Bounced | "This is a research database for doctors, not for regular people." |
| Maria (NaPro-curious) | Inconclusive, would keep Googling | Tile said NaPro, results page didn't filter; she ended up on unfiltered all-articles |
| Alex (endo researcher) | Won't bookmark | Modal-over-tiles ambiguity + 259/45 count mismatch destroyed trust |
| Dr. Liu (clinician) | "I'd be cautious" | JRRM journal name pattern-matched as in-house advocacy publication |
| Jess (Gen Z visitor) | Closed tab | No "What is RRM?" entry; couldn't form a mental model in 90 seconds |

Synthesis: 4 of 5 lost trust or bounced. The 5th (Sarah) didn't bounce but downgraded her impression of who the site is for.

---
