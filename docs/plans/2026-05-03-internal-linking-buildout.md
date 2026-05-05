# Internal Linking Buildout -- rrmacademy.org

Created: 2026-05-03
Author: SEO Operator
Inputs: 2026-03-10 internal-linking-plan.md (status check); 2026-05-03 glossary-as-internal-link-hub.md (refinement); live source review of `src/lib/blog.ts`, `src/lib/faq.ts`, `src/lib/airtable.ts`, `src/lib/courses.ts`, all four content templates, the five pillar pages, the homepage, and the Header/Footer.
Scope: planning only. No template code changes.

## Executive summary

1. **Three of four "related items" surfaces actually work; one is a paper tiger.** Library uses weighted topic+searchTerms+journal scoring (good). FAQ uses category match (decent). Commentary uses contentPillar exact-match (passable, only 7 distinct pillars across 18 posts). Courses has a `relatedCourses` field, but `relatedCourses` is `null` for ALL 10 courses in `src/data/courses.json`. The "Related courses" card at line 579 of `[slug].astro` is dead in production today. Only the `includes`/`includedIn` pair (masterclass-endo + long-term-endo) renders anything.
2. **Cross-section linking is still the biggest gap from March.** Commentary template still has zero links to courses/library/endo-survey. Course template still has zero "Background reading" commentary block. Library template still has zero "Commentary on this topic". All three were proposed March 10 and none shipped.
3. **Pillar outbound coverage is uneven.** `/naprotechnology/` and `/what-is-rrm/` are well-linked (4-6 FAQs, 1+ commentary, 1+ course, 3-7 library articles each). `/femm/`, `/neofertility/`, and `/glossary/` are under-linked (0-1 commentary, 1 course CTA, 0 FAQs, generic `/library/` only). Glossary is the worst: zero contextual body links to any other section.
4. **Anchor variety is weakest for `/commentary/` and `/endo-survey/`.** Commentary has only two anchor patterns site-wide ("Commentary", "commentaries"). Endo survey is anchored "Take the Endo Self-Survey" or "Endometriosis Self-Survey" four times each, with no descriptive variants like "see if your symptoms match endometriosis".
5. **Glossary-as-hub is the highest-leverage new build.** The glossary already has a 132-row D1 SSOT and zero inbound contextual links from other content types. Inverting the link graph (glossary terms list outbound courses/library/FAQs/tools) rescues a high-authority page from orphan status, gives every term genuine "discussed in" context, and decouples editorial copy from cross-link decisions. This should be Quick Win #1 ahead of the cross-section CTA.

---

## 0. Citation policy (decided 2026-05-03; revised 2026-05-05)

This rule set governs every linking decision below and supersedes anything in the March 10 plan that contradicts it. The 2026-05-05 revision splits linking into two surface classes (body vs discovery) because the harm model is different in each — see "Two surface classes" below.

**Reference content** (evergreen, cite-able by AI search and search engines without expiry risk):
- Library articles
- Courses
- FAQs
- Glossary
- Pillar guides (`/naprotechnology/`, `/what-is-rrm/`, `/femm/`, `/neofertility/`, `/glossary/`)

**Editorial content** (timely, opinion, perishable):
- Commentary

**Tools** (interactive surfaces):
- `/ask/` (AI search; supports prewritten queries via `?q=`)
- `/endo-survey/`
- Future tools (more coming)

### Two surface classes

The 2026-05-03 policy treated all linking the same. The 2026-05-05 revision splits it into two classes because the harm model is different:

- **Body class** — inline anchors inside body prose, "Sources", "References", "Read more", "Background reading", "Cited in" lists, `<cite>` markers, and any link the *author* embeds while writing. This is where AEO erosion happens: a reference page asserting "this commentary supports my point" ties evergreen authority to a piece of dated opinion, and the page ages with the commentary it cites.
- **Discovery class** — machine-derived backlink rails rendered structurally below the body. "Discussed in", "Where this appears", "Featured in", "Mentioned in", "Related reading". These are not citations; they're a navigation surface that says "here is the corpus that talks about this term/topic." The page above the rail does not change as commentary ages — only the inventory below it does, and only via the mention graph that the build script computes.

The discovery class is allowed to surface commentary because (a) the link is structural, not editorial, (b) the term/article above it does not change as commentary ages, and (c) it gives the reader a natural wayfinding exit toward editorial coverage that they would otherwise never discover from a reference page.

### Who can cite whom — body class

| From → To (body) | Glossary | Library | FAQ | Course | Commentary | Tools | Pillars |
|-----------|----------|---------|-----|--------|------------|-------|---------|
| **Courses** | yes | yes | yes | yes (related) | **NO** | n/a yet | yes |
| **Library** | yes | yes (related) | yes | yes | **NO** | n/a yet | yes |
| **FAQ** | yes | yes (refs) | yes (related) | yes | **NO** | n/a yet | yes |
| **Glossary** | n/a | yes | yes | yes | **NO** | yes | yes |
| **Commentary** | yes | yes | yes | yes | yes (related) | yes | yes |
| **Pillars** | yes | yes | yes | yes | **NO** | yes | yes |

### Who can surface whom — discovery class

| From → To (discovery rail) | Glossary | Library | FAQ | Course | Commentary | Tools | Pillars |
|-----------|----------|---------|-----|--------|------------|-------|---------|
| **Courses** | yes | yes | yes | yes | **yes** | yes | yes |
| **Library** | yes | yes | yes | yes | **yes** | yes | yes |
| **FAQ** | yes | yes | yes | yes | **yes** | yes | yes |
| **Glossary** | n/a | yes | yes | yes | **yes** | yes | yes |
| **Commentary** | yes | yes | yes | yes | yes | yes | yes |
| **Pillars** | yes | yes | yes | yes | **yes** | yes | yes |

The only From→To row that ever shrinks is the body class. Discovery rails are symmetric.

**Tool-citation specifics for glossary:** each term may carry one or more prewritten `/ask/?q=<encoded-question>` URLs (e.g. on the "endometriosis" term: `/ask/?q=What+is+endometriosis%3F`) plus links to topical tools like `/endo-survey/`. As more tools come online, they slot into the same `tool` target type without a schema change.

**Why the asymmetry (body class):** reference content has to remain trustworthy and evergreen for AEO and search authority. Commentary is opinion and dated by nature. Reference material citing commentary inline erodes its citation value over time. Commentary is one-way out for body-class linking, never in.

**Why the symmetry (discovery class):** the harm model only fires when an author asserts a citation. A machine-derived "Discussed in" rail at the bottom of a reference page is wayfinding — it says "this term gets talked about over here," not "this commentary supports the definition above." The reference page itself stays evergreen because nothing in its body changes when the rail's inventory turns over.

### How to apply

| Action | Body class | Discovery class |
|---|---|---|
| Inserting a `<a href="/commentary/...">` mid-paragraph | NO from any reference type | n/a (not how discovery rails are built) |
| Adding a "Read more in our commentary" inline block | NO from any reference type | n/a |
| Adding a "Sources / References / Cited in" list to a glossary entry, library article, FAQ, course, or pillar | NO commentary entries | n/a |
| Building a "Discussed in" / "Where this appears" / "Featured in" rail at the bottom of a reference page | n/a | yes — pull from any other content type including commentary |
| Building a `glossary_term_link` row | only for body link types (course, library, faq, tool, ask, external) | yes for discovery surface; record `surface = 'discovery'` and target_type can include `commentary` and `pillar` |
| Building related-rail logic on a commentary page | n/a | pull from anywhere |

**Implications for this doc:**
- B1 (Glossary hub) — UPDATED. Body-class outbound types stay (course, library, faq, tool, ask, external). Discovery surface (the "Discussed in" rail at the bottom of every glossary spoke) gets `commentary` and `pillar` added.
- B4 (Course "Background reading" inline block) — STILL REJECTED for body class. Course descriptions cannot inline-cite commentary. A "Discussed in commentary" discovery rail at the bottom of a course detail page IS allowed if the underlying mention-graph supports it; deferred to a future B4'' item.
- B5 (Library "Commentary on this topic" inline block) — STILL REJECTED for body class. A "Discussed in commentary" discovery rail on library article spokes IS allowed; deferred to a future B5'' item.
- B3 (Commentary cross-section CTA) — KEEPS, can be made stronger (commentary may cite anything specific from body).
- B6 (Pillar enrichment) — CLARIFIED. Pillar bodies still cannot inline-cite commentary; existing Whittaker-spotlight links are about authorship, not editorial citation. A "Discussed in commentary" discovery rail on a pillar page IS allowed.

### Why future-you should not soften this further without re-asking

The original 2026-05-03 ban came from real AEO concerns: reference content citing dated opinion erodes its own authority over time. The 2026-05-05 revision relaxes only the discovery class because the discovery class doesn't trigger that harm — the page above the rail is unchanged, and the rail is machine-derived. If a future plan proposes letting authors embed commentary links inline in a glossary definition, library article body, FAQ answer, course description, or pillar narrative, do not accept it without re-asking Brian. The body/discovery split is the entire point of this revision.

---

## 1. Current state snapshot (live verification)

### Related-item logic per template (read at 2026-05-03)

| Template | File | Function | Logic | Quality |
|---------|------|----------|-------|---------|
| Commentary | `src/pages/commentary/[...slug].astro:24` | `getRelatedPosts(post, allPosts, 3)` from `src/lib/blog.ts:62` | Filter by exact `contentPillar` match, exclude self, slice first 3 (no scoring, no recency tiebreak) | Passable. 18 posts across 7 pillars means most posts find 1-3 matches. Random within pillar. |
| FAQ | `src/pages/faqs/[...slug].astro:38` | `getRelatedFaqs(faq, allFaqs, 5)` from `src/lib/faq.ts:74` | Filter by exact `category` match (3 categories), exclude self, slice first 5 (no scoring) | Decent. 25 FAQs across 3 broad categories means each FAQ gets 5 cousins. Match is coarse. |
| Library | `src/pages/library/[...slug].astro:27` | `getRelatedArticles(article, allArticles, 4)` from `src/lib/airtable.ts:78` | Weighted multi-signal: topics x3, searchTerms x1, same journal x2; score>0; recency tiebreak | Good. Topical relevance is real, not random. |
| Courses | `src/pages/courses/[slug].astro:295` | Direct `course.relatedCourses` map | Hand-curated slug array | **Dead.** All 10 courses have `relatedCourses: null` in `src/data/courses.json`. Block never renders. The only related-course UI that shows in production is the `includes`/`includedIn` pair (1 of 10 courses). |

### Pillar page contextual link counts (body only, excluding header/footer/nav)

Counted by reading template source plus a live curl against `https://rrmacademy.org/<pillar>/`. "Outbound" is contextual `<a href="/...">` in body content. "Inbound" is other source files referencing the pillar URL.

| Pillar | Outbound to FAQs | Outbound to Courses | Outbound to Commentary | Outbound to Library | Outbound to Other Pillars | Inbound (source files) |
|--------|------------------|---------------------|------------------------|---------------------|---------------------------|------------------------|
| `/naprotechnology/` | 4 | 2 (1 specific + 1 generic) | 2 (Whittaker spotlight + naprotech-surgery commentary) | 7 specific articles + 1 generic | 0 | 6 |
| `/what-is-rrm/` | 2 | 4 generic | 2 (Whittaker spotlight + RRM Explained commentary) | 6 specific + 2 generic | 1 (glossary) | 5 |
| `/femm/` | 1 (FAQ index only) | 1 generic | 1 (Whittaker spotlight) | 1 generic | 2 (NaPro, NeoFertility) | 3 |
| `/neofertility/` | 0 | 2 generic | 1 (Whittaker spotlight) | 1 generic | 2 (NaPro, RRM) | 4 |
| `/glossary/` | 0 | 0 | 1 (Whittaker spotlight only) | 1 generic | 0 | 2 |

The ranking matches what would be expected from the page sizes and how recently they were rewritten (NaPro and What-is-RRM are the two oldest pillar guides; FEMM/NeoFertility/Glossary are newer and never received an outbound-linking pass).

### Desktop nav (current)

`src/components/Header.astro:5-14`: 4 desktop nav items.

```
Research Library | Commentary | Learn (dropdown: Guides, FAQs, Courses) | Join Us
```

`/about/` is NOT in desktop nav. Mobile nav has it under the "Help" group (`Header.astro:52-57`). Footer is unverified in this audit but worth confirming.

The original March plan flagged "Add About to desktop nav at minimum for E-E-A-T". Half-shipped: Learn dropdown was added; About was not.

### Homepage contextual outbound (`src/pages/index.astro`)

Counted: `/library/` (3 generic + 1 stat-card), `/courses/` (2 hero + 1 stat-card + 2 specific course slugs), `/commentary/` (1 generic + 1 Whittaker spotlight), `/faqs/what-is-rrm.../` (2 deep links into the RRM hub FAQ), `/about/` (0 contextual, only via footer/nav). No `/endo-survey/`, no `/donate/` body link, no STUC body link.

Homepage is a strong sender to library/courses/commentary; it does not contextually link to the survey or any pillar guide other than via the FAQ slug for what-is-RRM.

### Source: relatedCourses field is empty

```
masterclass-in-endometriosis-and-surgery -> relatedCourses=None  includes=[long-term-endometriosis-management]
neofertility-medical-training            -> relatedCourses=None  (affiliate, includes/includedIn null)
long-term-endometriosis-management       -> relatedCourses=None  includedIn=[masterclass-in-endometriosis-and-surgery]
postpartum-depression-anxiety            -> relatedCourses=None
rrm-vs-ivf                               -> relatedCourses=None
hormones-through-the-lifespan            -> relatedCourses=None
pelvic-floor-rehabilitation              -> relatedCourses=None
infertility-existential-trauma           -> relatedCourses=None
fertility-based-family-planning          -> relatedCourses=None
aip-diet-inflammation                    -> relatedCourses=None
```

The course template wires `course.relatedCourses` -> render block but the data layer never populates it. This is dead code in production.

---

## 2. Real gaps (still pending after March)

### G1. Course `relatedCourses` field is empty for all 10 courses (NEW finding, not in March plan)

Severity: medium. The "Related courses" UI exists at `src/pages/courses/[slug].astro:579-595` and never shows because no D1 row has `relatedCourses` set.

This is more impactful than the March plan's "Background reading" recommendation because it can be filled with a SQL UPDATE today (no template work) and the UI is already shipped.

### G2. Commentary cross-section CTA still missing

`src/pages/commentary/[...slug].astro:222-233` ends with "More from this series" + closing `</div>`. Zero links from commentary template to courses, library, FAQs, endo-survey.

Original March plan called for a "small CTA block after related posts with links to `/courses/`, `/library/`, and conditionally `/endo-survey/`". Not shipped.

### G3. Course "Background reading" block missing

`src/pages/courses/[slug].astro` has no commentary-cards block. Commentary posts that genuinely support a course (e.g. "Why Does Endometriosis Happen" -> Masterclass in Endo) never surface from the course detail page.

Original March plan called for "Background reading: 2-3 commentary posts matched by topic, BlogCard list". Not shipped.

### G4. Library "Commentary on this topic" block missing

`src/pages/library/[...slug].astro` ends related-articles + topic-tags block. Zero commentary surfaced from library articles.

Original March plan called for "Commentary on this topic: Match article topics to blog `contentPillar`. Show 2-3 posts." Not shipped. March plan also flagged this as "lower priority" since library has good within-section linking.

### G5. Pillar pages /femm/, /neofertility/, /glossary/ are link-poor in body

NaProTechnology and What-is-RRM are well-linked (verified above). The other three pillar pages each link to <=1 specific commentary, 0-1 specific FAQs, and only generic `/library/`.

Each pillar should link to roughly 3 commentary posts, 2 courses, 5 FAQs, and 1 library topic filter per the implicit standard set by NaProTechnology/What-is-RRM. Glossary is the worst (0 of any).

This was implicit in the March plan's "Hub-and-Spoke Clusters" but never executed for FEMM, NeoFertility, or Glossary.

### G6. Glossary is an internal-link orphan AND a link sink (NEW finding)

The glossary index page (132 published terms) has only 2 inbound contextual links (`/femm/index.astro` and `/neofertility/index.astro` in body, plus `/what-is-rrm/index.astro:1336`). Zero outbound to anything beyond Whittaker spotlight + generic library button.

Worst, the page is a click-cost trap: each glossary URL like `/glossary/<slug>/` 301-redirects to `/glossary/#<slug>` (anchor scroll on a single page). Users land mid-page on a single term with no context for "what else does this site say about [term]". Today's `/glossary-as-internal-link-hub.md` plan addresses this; this buildout integrates it.

### G7. Desktop nav still missing /about/

March plan: "Add About to desktop nav at minimum (E-E-A-T)". Status: not shipped. Desktop has 4 items, `/about/` is mobile-only.

For a medical-education site, hiding the credentialed-physician page from desktop is an active E-E-A-T penalty.

### G8. /commentary/ hub and /endo-survey/ have light contextual inbound

`/commentary/` has 1 contextual inbound (homepage). `/endo-survey/` has 5, but 3 are from the same pillar cluster. Both rely too heavily on global nav.

### G9. /donate/ and /save-the-uterus-club/ inbound is sparse but contextual

`/donate/` is body-linked from About + 4 library funding-callout components, which is fine.
`/save-the-uterus-club/` is body-linked from About, donate, courses, account, community = 7 sources. That is sufficient.

These are NOT real gaps. Excluded from priority list.

---

## 3. Build-out proposal

### B1. Glossary-as-hub: outbound link table on every term

Refines `2026-05-03-glossary-as-internal-link-hub.md`.

**Schema (rrm-auth D1):**

```sql
CREATE TABLE IF NOT EXISTS glossary_term_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_slug TEXT NOT NULL COLLATE NOCASE,
    surface TEXT NOT NULL DEFAULT 'body' CHECK(surface IN ('body','discovery')),
    target_type TEXT NOT NULL CHECK(target_type IN ('course','library','faq','tool','ask','external','commentary','pillar')),
    target_id TEXT NOT NULL,           -- course.id, faq.id, articles.id; tool path; ask question text; commentary slug; pillar path; or external URL
    target_label TEXT,                  -- override, optional. Falls back to looked-up title or computed CTA.
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    -- Body-class rows must not target commentary or pillar (those are discovery-only).
    -- Pillar links inside body prose are still allowed inline; only the discovery rail records pillars in this table.
    CHECK (
        surface = 'discovery'
        OR target_type NOT IN ('commentary','pillar')
    )
);

CREATE INDEX IF NOT EXISTS idx_gtl_term_slug ON glossary_term_link(term_slug);
CREATE INDEX IF NOT EXISTS idx_gtl_target_type ON glossary_term_link(target_type);
CREATE INDEX IF NOT EXISTS idx_gtl_surface ON glossary_term_link(surface);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gtl_term_surface_target ON glossary_term_link(term_slug, surface, target_type, target_id);
```

Note: `commentary` and `pillar` may only appear when `surface = 'discovery'` (enforced by the table-level CHECK). Body-class linking from glossary stays restricted to course/library/faq/tool/ask/external per the section 0 policy. Not a true FK to `glossary_term.slug` (D1 does not enforce CASCADE; orphan deletes need cleanup in `/glossary-update` skill -- see project memory `feedback-d1-cascade-inert.md`).

**Target type semantics:**

| target_type | Allowed surface | target_id format | Render |
|-------------|-----------------|------------------|--------|
| `course` | body, discovery | course.id (e.g. `masterclass-in-endometriosis-and-surgery`) | `<a href="/courses/{slug}/">{course.title}</a>` |
| `library` | body, discovery | articles.id (`recXXX`) OR a topic filter URL (`/library/?topic=Endometriosis`) | article title or topic-filter label |
| `faq` | body, discovery | faq.id (e.g. `faq_what_conditions...`) | `<a href="/faqs/{slug}/">{faq.title}</a>` |
| `tool` | body, discovery | absolute path (e.g. `/endo-survey/`) | computed CTA from `target_label` (e.g. "Take the Endometriosis Self-Survey") |
| `ask` | body, discovery | natural-language question text (e.g. `What is endometriosis?`) | `<a href="/ask/?q={encodeURIComponent(target_id)}">Ask: {target_id}</a>` |
| `external` | body, discovery | absolute URL | `target_label` (required for external) |
| `commentary` | **discovery only** | post.slug (e.g. `the-rrm-research-library-just-got-better`) | `<a href="/commentary/{slug}/">{post.title}</a>` |
| `pillar` | **discovery only** | absolute pillar path (e.g. `/naprotechnology/`) | `<a href="{path}">{pillar title}</a>` |

**Data source:** new join table; admin-curated via `/glossary-update` skill workflow extension.

**Build pipeline:** `scripts/fetch-glossary-data.mjs` joins `glossary_term_link` rows into each term, looks up titles from the existing 3 JSON caches (courses.json, faqs.json, articles.json) at build time, computes ask-URLs and tool-CTAs, and emits enriched `glossary.json` with per-term `outboundLinks: { course: [...], library: [...], faq: [...], tool: [...], ask: [...] }`.

**Mock render** (rendered inside each `.glossary-term` block on `/glossary/`):

```html
<details class="glossary-term-discussed-in">
  <summary>Explore "endometriosis" across RRM Academy</summary>
  <div class="discussed-grid">
    <div>
      <h4>Courses</h4>
      <ul>
        <li><a href="/courses/masterclass-in-endometriosis-and-surgery/">Masterclass in Endometriosis and Surgery</a></li>
        <li><a href="/courses/long-term-endometriosis-management/">Long-Term Endometriosis Management</a></li>
      </ul>
    </div>
    <div>
      <h4>FAQs</h4>
      <ul>
        <li><a href="/faqs/what-conditions-does-rrm-address/">What conditions does RRM address?</a></li>
      </ul>
    </div>
    <div>
      <h4>Research</h4>
      <ul>
        <li><a href="/library/?topic=Endometriosis">All endometriosis research (50+ articles)</a></li>
      </ul>
    </div>
    <div>
      <h4>Tools</h4>
      <ul>
        <li><a href="/endo-survey/">Take the Endometriosis Self-Survey</a></li>
        <li><a href="/ask/?q=What%20is%20endometriosis%3F">Ask the AI: What is endometriosis?</a></li>
      </ul>
    </div>
  </div>
</details>
```

`<details>` collapsed by default to keep the term scan-friendly; expanded for any term with 4+ links to flag as a hub.

**Effort:** M. Schema + seed + fetcher + render template + `/glossary-update` skill extension. ~2-3 sessions.

**Impact rationale:** Glossary becomes the canonical entity-disambiguation page for the site (each term answers "what is this" + "where else on this site is it discussed"). For AEO this is exactly the structure Perplexity/Sonar prefer. For UX it gives every glossary anchor a reason to exist beyond a definition. For SEO it converts a 132-term page into 132 implicit topic hubs without minting per-term landing pages. Reduces editorial pressure on long-form content (course descriptions, commentary bodies) to thread inline glossary links.

---

### B2. Course `relatedCourses` data fill (no template work)

The `relatedCourses` UI is shipped and dead because no D1 row populates the field. Fill it.

**Data source:** existing `course.relatedCourses` field, currently null on all 10 courses.

**Curation table (proposal, requires Brian sign-off):**

| Course | Suggested relatedCourses (slugs) |
|--------|----------------------------------|
| masterclass-in-endometriosis-and-surgery | postpartum-depression-anxiety, hormones-through-the-lifespan |
| long-term-endometriosis-management | aip-diet-inflammation, pelvic-floor-rehabilitation |
| postpartum-depression-anxiety | hormones-through-the-lifespan, fertility-based-family-planning |
| rrm-vs-ivf | hormones-through-the-lifespan, fertility-based-family-planning |
| hormones-through-the-lifespan | fertility-based-family-planning, aip-diet-inflammation |
| pelvic-floor-rehabilitation | masterclass-in-endometriosis-and-surgery, long-term-endometriosis-management |
| infertility-existential-trauma | rrm-vs-ivf, postpartum-depression-anxiety |
| fertility-based-family-planning | rrm-vs-ivf, hormones-through-the-lifespan |
| aip-diet-inflammation | long-term-endometriosis-management, hormones-through-the-lifespan |
| neofertility-medical-training | rrm-vs-ivf (only; affiliate, keep light) |

**Effort:** S. SQL UPDATE via `/courses-update` skill, then single-record dispatch x10.

**Impact rationale:** Activates an already-shipped UI block. Each course gets 2 in-section onward paths. Internal authority redistributes from masterclass-endo (the most-linked course) to thinner ones like `aip-diet-inflammation`.

---

### B3. Commentary cross-section CTA (March plan, still pending)

Per the citation policy in section 0, commentary is the only template that may cite ANY surface specifically. This block should therefore prefer specific destinations over generic index pages whenever a clean pillar-to-target mapping exists.

**Template change:** add a CTA block after `<section class="related-section">` in `src/pages/commentary/[...slug].astro:233`.

**Matching logic:** map `post.contentPillar` to a specific course + a specific FAQ + a library topic filter + an `/ask/` prewritten question. Fall back to generic index links when no mapping exists.

```ts
const COMMENTARY_PILLAR_TARGETS: Record<string, {
  course?: string; faq?: string; library?: string; ask?: string; tool?: string;
}> = {
  'Education - Endometriosis': {
    course:  '/courses/masterclass-in-endometriosis-and-surgery/',
    faq:     '/faqs/what-conditions-does-rrm-address/',
    library: '/library/?topic=Endometriosis',
    ask:     'What is the RRM approach to endometriosis?',
    tool:    '/endo-survey/',
  },
  'Education - NaPro/RRM': {
    course:  '/courses/rrm-vs-ivf/',
    faq:     '/faqs/what-is-restorative-reproductive-medicine-rrm/',
    library: '/library/?topic=NaProTECHNOLOGY',
    ask:     'How is RRM different from IVF?',
  },
  'Education - PCOS': {
    faq:     '/faqs/is-letrozole-first-line-anovulatory-pcos-rrm/',
    library: '/library/?topic=PCOS',
    ask:     'How does RRM treat PCOS?',
  },
  'Education - Cycle Literacy': {
    course:  '/courses/fertility-based-family-planning/',
    library: '/library/?topic=Fertility%20Awareness',
    ask:     'How do I chart my cycle?',
  },
  // Personal/Practice, Systems Critique, Empowerment fall back to generic
};
```

**Mock:**

```html
<section class="commentary-onward" aria-label="Continue learning">
  <h2 class="detail-heading">Keep going</h2>
  <ul class="onward-list">
    {targets.course && <li><a href={targets.course}>Take the related course</a></li>}
    {targets.faq    && <li><a href={targets.faq}>Read the answer in our FAQs</a></li>}
    {targets.library&& <li><a href={targets.library}>See the research</a></li>}
    {targets.tool   && <li><a href={targets.tool}>Use the tool</a></li>}
    {targets.ask    && <li><a href={`/ask/?q=${encodeURIComponent(targets.ask)}`}>Ask the AI: {targets.ask}</a></li>}
    {!targets.course && <li><a href="/courses/">Browse all courses</a></li>}
    {!targets.library && <li><a href="/library/">Search the Research Library</a></li>}
  </ul>
</section>
```

**Effort:** S-M. ~50 lines including the pillar map and styles.

**Impact rationale:** 18 commentary posts gain 3-5 specific cross-section links each (not just index pages). Distributes equity from commentary (currently a sink) to courses/library/FAQs/tools. Endo cluster gets a survey funnel. The `/ask/` prewritten link doubles as a discovery hook for the AI search surface.

---

### B4. Course "Background reading" block — REJECTED per citation policy

Original March 10 proposal was to surface 2-3 commentary posts per course matched by topic. Citation policy in section 0 forbids courses citing commentary. Block dropped from buildout.

**Replacement (B4'): Course → glossary + library topic filter block.** Each course detail page can carry a small "Define and dig deeper" block linking to:
- 3-5 glossary terms covered by the course (curated per-course in a `course.glossary_terms` field, similar to `course.relatedCourses`)
- 1 library topic filter URL

This keeps the citation direction inside the policy. Effort S-M. Schema add: `course.glossary_terms TEXT` (JSON array of glossary slugs). Render after Related courses. Defer until B1 ships so the underlying `glossary_term_link` table is already proven; can be a derived view (terms whose `glossary_term_link` rows reference this course).

---

### B5. Library "Commentary on this topic" block — REJECTED per citation policy

Original March 10 proposal was to surface 2 commentary posts per library article matched by topic. Citation policy in section 0 forbids library articles citing commentary. Block dropped from buildout.

**No replacement.** Library articles already have strong in-section linking (related articles + topic-tag filters) and the FAQ-references column when applicable. Adding a "Discussed in our courses" block is possible but low leverage; library readers tend to be researchers, not course shoppers. Defer indefinitely.

---

### B6. Pillar outbound enrichment for /femm/, /neofertility/, /glossary/

**This is content work, not template work.** No data source change. Three pages get a dedicated /pillar-edit pass to add inline contextual links.

Pillar bodies are reference content per the policy in section 0; do not add new commentary citations. Existing Whittaker-spotlight links are about page authorship and remain.

**Acceptance per pillar (matches NaProTechnology / What-is-RRM benchmark, ex-commentary):**
- 5 FAQs (specific slugs)
- 2 courses (1 specific + 1 generic acceptable)
- 5+ specific library articles + 1 library topic filter (`/library/?topic=...`)
- 3-5 glossary anchors threaded through body where useful
- 1-2 prewritten `/ask/?q=...` links seeded into the page (the pillar is itself a great landing for AI search discovery)

Glossary is the hardest case because it is structurally a definition list. Recommendation: use the B1 "Discussed in" block (B1 above) instead of trying to thread inline links into definitions. B6 for glossary collapses into B1.

**Effort:** M per pillar (FEMM, NeoFertility). L for glossary if attempted as inline; falls to S if handled via B1.

**Impact rationale:** Brings the three weakest pillars up to the link-density of the two strongest. Each pillar is the canonical entry point for its method; inbound link equity flowing in deserves matching outbound.

---

### B7. Add /about/ to desktop nav (March plan, still pending)

**Template change:** `src/components/Header.astro:5-14`. Add `{ label: 'About', href: '/about/' }` to `navItems`. Probably swap "Join Us" position (auth-resolved) so the About entry feels primary.

**Effort:** S. <10 lines.

**Impact rationale:** E-E-A-T. The credentialed-physician About page is currently desktop-invisible. Knowledge panels and AI tools that crawl primary nav miss it.

---

### B8. Improve commentary inbound contextual links — REVISED per citation policy

The policy in section 0 forbids reference content (courses, library, FAQs, glossary, pillars) from citing commentary. That removes B4, B5, and the pillar pathway from this gap.

The remaining legitimate inbound paths to commentary are:
- `/commentary/` hub (already strong)
- `/about/` page (editorial-team context, allowed because the About page is itself editorial framing)
- Homepage (already does Whittaker spotlight; one more specific slug allowed)
- Other commentary posts (already strong via "More from this series")
- External backlinks (out of scope here)

Quick wins compatible with the policy:
- `/about/` adds 2-3 specific Whittaker commentary posts ("Recent perspectives from our editorial lead")
- Homepage adds 1 specific commentary slug below the existing Whittaker spotlight (Brian's call which post)

**Effort:** S. Small inline edits to about.astro and index.astro.

**Impact rationale:** Brings every commentary post inbound from at least the editorial pages, not only from `/commentary/`. Does not violate the asymmetric policy.

---

### B9. Cross-section CTA on FAQ template (refinement to existing)

The FAQ template ALREADY has a strong outbound CTA at lines 159-170 (pillar-specific via `PILLAR_CTA_MAP` plus library). Verified. The March plan called this out as needed; it shipped.

Recommendation: extend `PILLAR_CTA_MAP` to surface a SECOND link to a topical course alongside the pillar CTA. Today FAQ templates pick pillar OR generic courses; never both.

```ts
// faq.ts -- add an optional course slug per FAQ code
export const FAQ_COURSE_MAP: Record<string, string> = {
  C01: 'masterclass-in-endometriosis-and-surgery',  // endometriosis FAQs
  // etc.
};
```

**Effort:** S. Map + 1 template tweak.

**Impact rationale:** Each FAQ becomes a 3-button CTA (pillar + course + library) instead of 2. Marginal, but worth it.

---

## 4. Anchor text inventory + variety recommendations

Current anchors per top destination (from grep across `src/pages` and `src/components`):

### `/library/`

Today: `Browse the RRM Research Library`, `Browse the Research Library`, `Access the Research Library`, `Browse 3,000+ Studies`, `Research Library: 3,000+ Articles`, `research library`, `Research Library`, `RRM Academy Research Library`, `RRM Research Library`. Decent variety.

Add: `Search the literature`, `Find the studies`, `Open the library`, `See peer-reviewed evidence`.

### `/courses/`

Today: `Explore our courses`, `Explore Courses`, `Explore Free Courses`, `Browse Courses`, `Courses`, `RRM Academy`, `RRM Academy courses`, `Self-paced online courses`. Mostly button-flavored.

Add: `Take an RRM course`, `Self-paced clinical training`, `Patient-and-clinician courses`, `Continue learning`.

### `/commentary/`

Today: only `Commentary` and `commentaries`. THIN. Two anchors site-wide.

Add: `Dr. Whittaker's commentary`, `clinical perspectives`, `case-by-case writing from RRM clinicians`, `Read the commentary`, `Recent posts from RRM clinicians`.

### `/endo-survey/`

Today: `Take the Endo Self-Survey` (twice), `Endometriosis Self-Survey`, `Request a new link`. Repetitive.

Add: `See if your symptoms match endometriosis`, `Self-screen for endo`, `Five-minute endometriosis check`, `RRM symptom self-assessment`.

### `/about/`

Today: `RRM Academy`, `About page`, `Dr. Naomi Whittaker`, `Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI`. Good variety; the credentialed long-form anchor is a strong E-E-A-T signal worth preserving in formal contexts.

Add: `Who we are`, `RRM Academy editorial team`, `Our medical editorial lead`.

---

## 5. Priority order

| # | Task | Tag | Effort | Why first/last |
|---|------|-----|--------|----------------|
| 1 | B7. Add /about/ to desktop nav | Quick Win | S | E-E-A-T. 5-line PR. Should have shipped in March. |
| 2 | B2. Fill `course.relatedCourses` for 10 courses | Quick Win | S | UI already shipped + dead. SQL UPDATE only. Activates 10 dead blocks. |
| 3 | B3. Commentary cross-section CTA (with specific pillar map + `/ask/` seeds) | Quick Win | S-M | Closes commentary-as-sink gap. Doubles as discovery channel into AI search. |
| 4 | B6 (FEMM + NeoFertility). Pillar enrichment, ex-commentary | Quick Win | M | Bring weak pillars up to benchmark using FAQ + library + glossary + course + `/ask/` (no commentary). |
| 5 | B1. Glossary-as-hub | Big Bet | M-L | Schema + fetcher + `/glossary-update` extension + curation of 25+ terms. Highest long-term leverage; new tool/ask target types make this future-proof. |
| 6 | B9. FAQ pillar-plus-course map | Medium Lift | S | Extends existing FAQ CTA with a course CTA. Small win. |
| 7 | B8. Inbound contextual links to commentary (about + homepage only) | Medium Lift | S | Policy-compliant inbound paths: editorial pages only. |
| 8 | B4'. Course "Define and dig deeper" (glossary terms + library topic) | Medium Lift | S-M | Replaces the rejected B4. Pairs naturally with B1 since the same `glossary_term_link` rows can be queried in reverse. |
| 9 | Anchor variety pass site-wide | Medium Lift | S-M | Apply variants from section 4 across templates and pillar bodies. Best done in parallel with B6. |

Dropped from buildout per policy in section 0:
- B4 (Course "Background reading" — replaced by B4')
- B5 (Library "Commentary on this topic" — no replacement)

Re-ranked vs March plan: B1 (glossary hub) is new and now Big Bet #5. B7 (about-in-nav) and B2 (course data fill) are new top-of-list because they are 1-day wins. B3 (commentary CTA) keeps March's #1 spot but is now stronger because it surfaces specific destinations and seeds `/ask/` queries. The two library-related items from March drop out entirely.

---

## 6. Open questions for Brian

Answered 2026-05-03 by Brian: questions 2, 3, and the broad citation rule are decided in section 0 above. What remains:

1. **Glossary hub presentation.** Collapsed `<details>` per term, or always-visible right-rail per term, or new per-term landing pages at `/glossary/<slug>/`? The 8 existing `/glossary/<slug>/` → `/glossary/#<slug>` redirects in `rrm-router` complicate the per-term landing decision. Pick one. Recommendation: collapsed `<details>` for now, defer per-term landing pages until usage data shows it is worth the migration.

2. **Course `relatedCourses` curation.** Dispatch to a subagent for a rigorous topical-clustering pass across the 10 courses, or accept the B2 table as a starting point and tweak via `/courses-update` after deploy?

3. **Glossary term-link curation cap.** Aim for 25 terms with 3+ links each (criterion in glossary-as-hub plan), or aim for all 132 terms with at least 1 link? Recommendation: start with the 25 most-trafficked terms by GSC impressions plus the terms that match top library topics (Endometriosis, Infertility, PCOS, Cervical Mucus, Fertility Awareness). Defer the long tail.

4. **`/ask/` prewritten question UX.** Land on `/ask/?q=...` with the query pre-filled and auto-submit, or pre-fill and let the user click "Ask"? Auto-submit feels stronger for AEO ("the page literally answered the question") but auto-submit costs an inference per landing. Recommendation: prefill + manual submit by default; revisit if `/ask/` discovery becomes the load-bearing channel.

5. **Desktop nav change risk.** Adding /about/ shifts the nav from 4 to 5 items. Header.astro layout may need spacing adjustments (nav comments mention desktop is "intentionally sparse"). Confirm: 5 items is fine, or should /save-the-uterus-club/ ("Join Us") move to footer-only as a tradeoff?

6. **Tools registry.** B1 introduces a `tool` target type pointing at `/endo-survey/` and B3 seeds `/ask/?q=...`. As more tools come online (you mentioned "soon-ish"), do you want a small `tools` registry JSON in `src/data/tools.json` so the link surfaces (B1, B3, B6, B8) all read from the same canonical list, instead of hard-coding paths in each template? Recommendation: yes, mint it when tool #3 lands (premature today with only 2).

---

## Appendix: Files referenced (read during this audit)

| Path | What |
|------|------|
| `src/lib/blog.ts:62-72` | `getRelatedPosts` |
| `src/lib/faq.ts:74-78` | `getRelatedFaqs` |
| `src/lib/faq.ts:90-127` | `PILLAR_CTA_MAP` |
| `src/lib/airtable.ts:78-111` | `getRelatedArticles` (weighted scoring) |
| `src/lib/courses.ts` | Course type def; no related-course helper |
| `src/pages/commentary/[...slug].astro:222-233` | "More from this series" block (no cross-section CTA) |
| `src/pages/faqs/[...slug].astro:142-170` | "Related Questions" + pillar/library CTAs |
| `src/pages/library/[...slug].astro:493-506` | Related articles block (no commentary block) |
| `src/pages/courses/[slug].astro:288-297` | includes / includedIn / relatedCourses (last is dead) |
| `src/pages/courses/[slug].astro:579-595` | Related courses UI (dead -- no D1 source) |
| `src/components/Header.astro:5-58` | Desktop and mobile nav (About is mobile-only) |
| `src/data/courses.json` | Confirmed: all 10 courses have `relatedCourses: null` |
| `src/data/posts.json` | Confirmed: 18 posts across 7 contentPillar values |
| `src/data/articles.json` | Confirmed: 3,636 articles, top 10 topics dominated by Reproductive Endocrinology, Infertility, Endometriosis |
| `scripts/migrate-glossary-to-d1.sql` | Glossary schema (no link table yet) |
| Live curl `https://rrmacademy.org/naprotechnology/` | Confirmed body outbound link counts match source review |
| Live curl `https://rrmacademy.org/glossary/` | Confirmed glossary has zero contextual outbound to other content sections |
| `docs/plans/2026-03-10-internal-linking-plan.md` | March plan -- which items shipped, which did not |
| `docs/plans/2026-05-03-glossary-as-internal-link-hub.md` | Today's hub-model direction -- integrated as B1 |
