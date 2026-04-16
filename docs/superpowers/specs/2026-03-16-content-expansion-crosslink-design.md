# Content Expansion & Cross-Link Placement Design

## Summary

Strategic design for expanding rrmacademy.org with three new content types (research hubs, comparison pages, glossary v2 retrofit) and a comprehensive cross-link placement strategy across all 15 page types. Includes monetization alignment (STUC membership, future paid practitioner listings) and rules for CTA placement.

## Context

RRM Academy has 3,200+ library articles, 5 pillar guides, 37 FAQs, 6 courses, 30 commentary posts, a glossary, and a practitioner directory (in development). These content types exist in silos with limited cross-linking. The goal is to connect them into a topical authority graph that:

1. Dominates traditional search for RRM/NaPro/FABM queries
2. Gets cited by AI models (ChatGPT, Perplexity, Gemini, Claude)
3. Impresses practitioners who Google the site after cold outreach
4. Funnels engaged visitors to STUC membership

## Decisions

### What we're NOT building

- **Standalone condition pages.** The glossary already serves this function -- it defines terms and provides the RRM perspective. Condition pages would risk positioning the site as a "treatment website" rather than an education platform.
- **Standalone glossary detail pages.** Most terms have ~100 words of content. Thin pages hurt more than they help. The glossary stays a single authoritative page with anchor links.
- **Condition x city pages (now).** Deferred until the practitioner directory has 500+ medical-type practitioners with >50% telehealth data and a minimum of 3 practitioners per generated city page. The directory data quality gates this.

### What we ARE building

1. **Glossary v2 retrofit** -- upgrade all terms to definition + "RRM relevance" format. Single page, anchor links. Each condition/method/procedure term links out to related research hub, FAQs, and comparisons.

2. **Research hubs** (`/research/{topic}/`) -- the substantive per-topic pages. Naomi's editorial commentary on the research landscape + curated article collection from the library. These are the new "condition pages" but framed as research education, not treatment guidance. 10-15 hubs.

3. **Comparison pages** (`/compare/{slug}/`) -- evidence-based side-by-side analysis pages. High AEO citation potential. 4-10 pages.

### Monetization alignment

- **STUC membership** is the primary on-site conversion. Serves both patients and practitioners.
- **Paid practitioner listings** with SEO/AEO/GEO service is a future B2B revenue stream. Outreach-driven (cold email), not on-site sales.
- **The site does not sell.** It builds authority and trust. Monetization happens through relationships and outreach.
- **Strategic implication for cross-links:** Every connection between content types exists to make the site look authoritative when a practitioner evaluates it after receiving outreach. The topical authority graph IS the product.

## Content Type Inventory

All page types on the site that participate in the cross-link strategy:

| # | Page type | URL pattern | Status |
|---|-----------|-------------|--------|
| 1 | Homepage | `/` | Existing |
| 2 | Library article detail | `/library/{slug}/` | Existing |
| 3 | Library landing | `/library/` | Existing |
| 4 | Commentary post detail | `/commentary/{slug}/` | Existing |
| 5 | Commentary landing | `/commentary/` | Existing |
| 6 | FAQ detail | `/faqs/{slug}/` | Existing |
| 7 | FAQ landing | `/faqs/` | Existing |
| 8 | Course detail | `/courses/{slug}/` | Existing |
| 9 | Course catalog | `/courses/` | Existing |
| 10 | Pillar guides | `/{slug}/` (root) | Existing |
| 11 | Glossary | `/glossary/` | Existing, retrofitting |
| 12 | Find-a-Provider | `/find-a-provider/` | In development |
| 13 | Research hubs | `/research/{topic}/` | New |
| 14 | Comparison pages | `/compare/{slug}/` | New |
| 15 | Condition x city | `/find/{condition}/{city}/` | Deferred |

## Cross-Link Placement Zones

Three placement zones, each serving a different user intent:

### Zone 1: Inline (within editorial prose)

Natural contextual hyperlinks within body text. The link appears because the prose mentions the concept.

- Feels editorial, not navigational
- Invisible to skim-readers (they won't notice unless reading)
- Best for: connecting related concepts, framework references, citations
- Rule: max 1 outbound link per paragraph. Never cluster links.

### Zone 2: Callout (mid-page CTA)

A styled card or box that intentionally interrupts the content flow. Used sparingly for high-intent conversion moments.

- Visually distinct from prose (background color, border, card treatment)
- Placed contextually after the content section that builds intent
- Best for: STUC membership nudge after high-value content
- Rule: max 1 callout per page. Soft framing ("Join the conversation"), never sales language.

### Zone 3: Below-content sections (after main content)

Dedicated sections with their own H2 headings, appearing after the main content body and before BackToTop/footer. Card grids or link lists.

- Separated by `border-top` from main content
- Serves browse-oriented visitors who finished reading and want more
- Best for: related articles, related FAQs, related research
- Rule: max 4 below-content sections per page. Each must have real value, not just "related" padding.

## Cross-Link Placement Rules Per Page Type

### 1. Homepage

| Destination | Zone | Notes |
|---|---|---|
| Pillar guides | inline | Existing. Natural prose references |
| Library | inline | Existing. "Research Library" section |
| Commentary | inline | Existing |
| Courses | inline | Existing CTA |
| FAQs | inline | Existing |
| Find-a-Provider | inline | NEW. Add to "You Are in the Right Place > For Patients" as a natural mention, not a callout. "...and a [practitioner directory](/find-a-provider/) to help you find care" |
| Research hubs | -- | Too granular for homepage |
| Comparisons | -- | Too granular |
| Glossary | -- | Too granular |
| STUC callout | -- | Homepage already has its own CTAs |

### 2. Library Article Detail

| Destination | Zone | Notes |
|---|---|---|
| Related articles | below (cards) | Existing. 4 ArticleCard grid |
| Research hub | inline (badge) | NEW. Small linked label near topic pills: "Part of [Topic] Research" linking to `/research/{topic}/`. Only if article's domain matches a hub |
| Commentary | below (list) | NEW. 1-2 related commentary posts if topic overlap exists. Below related articles. "Commentary on this topic" |
| Glossary | -- | Abstracts are scholarly text. Linking terms would be noisy |
| FAQs | -- | Wrong audience intent |
| Find-a-Provider | -- | Research page, not action page |
| Courses | -- | Wrong intent |
| Comparisons | -- | Tangential |
| STUC callout | -- | Authority page, no selling |

**Below-content section order:** Related Articles (existing) > Commentary on this topic (new, if exists)

### 3. Library Landing

| Destination | Zone | Notes |
|---|---|---|
| Research hubs | inline (upgrade topic pills) | UPGRADE. Currently 8 topic pills link to `?topic=X` filter. For topics with a research hub, link to `/research/{topic}/` instead. Keep filter links for topics without hubs |
| Everything else | -- | Landing is for search/browse. Keep clean |

### 4. Commentary Post Detail

| Destination | Zone | Notes |
|---|---|---|
| Related posts | below (cards) | Existing. "More from this series" |
| Library | inline | Existing pattern. Citations within prose |
| FAQs | inline | When referencing a common question |
| Pillar guides | inline | Framework references |
| Glossary | inline | When using a term worth defining. Sparingly |
| Research hubs | inline | "See our [endometriosis research collection](/research/endometriosis/)" |
| Comparisons | inline | If post discusses a comparison topic |
| Courses | below (card) | NEW. If post relates to a course topic, single course card below "More from this series" |
| Find-a-Provider | -- | Editorial content, not action |
| STUC callout | callout | NEW. After "More from this series": soft community CTA. "Continue the conversation -- STUC members discuss topics like this on live calls" |

**Below-content section order:** More from this series (existing) > Related Course (new, if exists) > STUC callout (new)

### 5. Commentary Landing

No cross-links. Clean post browse.

### 6. FAQ Detail

| Destination | Zone | Notes |
|---|---|---|
| Library articles | below (list) | Existing. "From the RRM Research Library" |
| Related FAQs | below (list) | Existing. "Related Questions" |
| Glossary | inline | 1-2 term links within the answer text. Only for terms the reader may not know |
| Research hub | inline | "Learn more in our [topic research collection](/research/{topic}/)" within answer |
| Commentary | below (link) | NEW. If Naomi wrote about this topic: single link below library refs |
| Comparisons | inline | If FAQ naturally references a comparison |
| Pillar guides | inline | Framework-level references |
| Find-a-Provider | inline | Only for FAQs about finding care. Natural mention, not a callout |
| Courses | inline | Existing "Ready to go deeper?" CTA links inline to courses + library. Not a separate section |
| STUC callout | callout | NEW. Replaces "Ready to go deeper?" as the final CTA. "Have more questions? STUC members get live Q&A with Dr. Whittaker" |

**Below-content section order:** From the Research Library (existing) > Commentary (new, if exists) > External Resources (existing) > Related Questions (existing) > STUC callout (new, replaces "Ready to go deeper?")

**Note:** "Ready to go deeper?" is removed when STUC callout is added -- they serve the same function (post-answer conversion). STUC callout subsumes it with better framing. 4 below-content sections + STUC.

### 7. FAQ Landing

No cross-links. Accordion browse.

### 8. Course Detail

| Destination | Zone | Notes |
|---|---|---|
| Library | below (list) | NEW. "Background Reading" -- 3-5 curated articles. Backlog item |
| Commentary | below (list) | NEW. "Related from Dr. Whittaker" -- 1-2 posts |
| FAQs | inline | Course pages already have FAQ sections |
| Everything else | -- | Course pages are about the course |

**Below-content section order:** Background Reading (new) > Related Commentary (new)

### 9. Course Catalog

No new cross-links.

### 10. Pillar Guides

| Destination | Zone | Notes |
|---|---|---|
| Library | inline | Existing |
| Commentary | inline | Existing |
| Courses | inline | Existing |
| FAQs | inline | Existing |
| Other pillar guides | inline | Existing |
| Glossary | inline | NEW. Term links: "...a process called [selective HSG](/glossary/#selective-hsg)..." |
| Research hubs | inline | NEW. "Our [endometriosis research collection](/research/endometriosis/) includes 191 peer-reviewed studies" |
| Comparisons | inline | NEW. "For a detailed comparison, see [excision vs ablation](/compare/excision-vs-ablation/)" |
| Find-a-Provider | inline | One natural mention per guide in the "finding care" or "next steps" section |
| STUC callout | callout | NEW. One per guide, placed in the concluding section. "Join clinicians and patients exploring RRM together" |

**Key rule:** Pillar guides are 100% inline + one callout. NO below-content card sections. They are editorial documents.

### 11. Glossary (v2 single page)

| Destination | Zone | Notes |
|---|---|---|
| Research hubs | inline | For condition/topic terms: "endometriosis" definition includes "Explore [endometriosis research](/research/endometriosis/)" |
| Pillar guides | inline | For framework terms: "NaProTechnology" links to `/naprotechnology/` |
| FAQs | inline | For terms with a related FAQ. "See: [Can RRM treat endometriosis?](/faqs/...)" |
| Comparisons | inline | For procedure terms: "excision surgery" links to `/compare/excision-vs-ablation/` |
| Library | inline | Sparingly. For terms with landmark studies |
| Find-a-Provider | -- | Reference page |
| Commentary | -- | Too tangential |
| Courses | -- | Too tangential |
| STUC callout | -- | Reference page, no selling |

**Key rule:** Glossary is a reference document. Max 1-2 outbound links per term. Links should feel like natural "learn more" pointers.

### 12. Find-a-Provider (all page types)

| Destination | Zone | Notes |
|---|---|---|
| Pillar guides | inline | Method explainer links on profiles |
| Courses | inline | For clinician visitors |
| FAQs | inline | "How do I find a provider?" on index page |
| Everything else | -- | Directory is action-oriented. Keep focused |
| STUC callout | -- | Provider directory is a free feature. No gate |

### 13. Research Hubs (NEW)

The richest cross-link page. Hub of the authority graph.

| Destination | Zone | Notes |
|---|---|---|
| Library articles | below (cards) | Main content. Featured picks (4-6 cards) + full filtered collection |
| Glossary | inline | Terms in Naomi's commentary link to glossary anchors |
| FAQs | below (list) | "Common Questions" -- 3-5 related FAQs |
| Commentary | below (list) | "Dr. Whittaker's Commentary" -- related posts |
| Comparisons | below (list) | "Related Comparisons" -- if they exist for this topic |
| Other research hubs | below (pills) | "Related Research Topics" -- small pill links |
| Pillar guides | inline | Framework references in commentary |
| Find-a-Provider | inline | One natural mention: "Find clinicians who work with [condition]" |
| Courses | inline | Only if a relevant course exists. Natural mention in commentary |
| STUC callout | callout | After Naomi's commentary, before article grid. "STUC members discuss this research on monthly live calls" |

**Below-content section order (after article grid):**
1. Common Questions (FAQ list)
2. Dr. Whittaker's Commentary (post list)
3. Related Comparisons (link list, if exists)
4. Related Research Topics (pill links)

### 14. Comparison Pages (NEW)

| Destination | Zone | Notes |
|---|---|---|
| Library articles | inline | Citations within comparison text |
| Research hubs | below (list) | "Explore the Research" -- links to hubs for both sides |
| FAQs | below (list) | Related questions |
| Glossary | inline | Terms used in comparison |
| Commentary | below (list) | If Naomi wrote about the topic |
| Other comparisons | below (list) | "Related Comparisons" |
| Pillar guides | inline | Framework references |
| Find-a-Provider | -- | Informational page |
| Courses | -- | Informational page |
| STUC callout | -- | Authority page, no selling |

**Below-content section order:**
1. Explore the Research (hub links)
2. Related Questions (FAQ list)
3. Related Comparisons (link list)
4. Dr. Whittaker's Commentary (if exists)

### 15. Condition x City (deferred)

| Destination | Zone | Notes |
|---|---|---|
| Practitioners | inline | The page IS practitioner cards |
| Research hub | below (link) | "Research on [condition]" |
| Glossary | inline | Condition term anchor in intro |
| FAQs | below (list) | 2-3 condition-related FAQs |
| Comparisons | below (link) | If relevant |
| Nearby cities | below (pills) | "Also in [State]" |
| Everything else | -- | Keep local pages focused |

## Summary Matrix

**I** = inline, **C** = callout, **B** = below-content, **--** = none

| Source ↓ / Dest → | Library | Commentary | FAQs | Courses | Pillar | Glossary | Res. Hub | Compare | Provider | STUC |
|---|---|---|---|---|---|---|---|---|---|---|
| **Homepage** | I | I | I | I | I | -- | -- | -- | I | -- |
| **Article detail** | B | B | -- | -- | -- | -- | I | -- | -- | -- |
| **Library landing** | -- | -- | -- | -- | -- | -- | I | -- | -- | -- |
| **Post detail** | I | B | I | B | I | I | I | I | -- | C |
| **Post landing** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| **FAQ detail** | B | B | B | I | I | I | I | I | I | C |
| **FAQ landing** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| **Course detail** | B | B | I | -- | -- | -- | -- | -- | -- | -- |
| **Course catalog** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| **Pillar guides** | I | I | I | I | I | I | I | I | I | C |
| **Glossary** | I | -- | I | -- | I | -- | I | I | -- | -- |
| **Provider** | -- | -- | I | I | I | -- | -- | -- | -- | -- |
| **Research hub** | B | B | B | I | I | I | B | B | I | C |
| **Comparison** | I | B | B | -- | I | I | B | B | -- | -- |
| **Cond x City** | -- | -- | B | -- | -- | I | B | B | I | -- |

## STUC Callout Rules

STUC membership CTA appears on exactly 4 page types: commentary posts, FAQ detail, pillar guides, research hubs.

**Framing rules:**
- Never use "subscribe", "buy", "purchase", or pricing language
- Always frame as community and conversation, not product
- Vary the message by context:
  - Commentary: "Continue the conversation -- STUC members discuss topics like this on live calls"
  - FAQ: "Have more questions? STUC members get live Q&A with Dr. Whittaker"
  - Pillar guide: "Join clinicians and patients exploring RRM together"
  - Research hub: "STUC members discuss this research on monthly live calls"
- Visual treatment: subtle card with light background (not the primary CTA purple). Border, not box-shadow. Should feel like an aside, not an advertisement.

## Below-Content Section Ordering Rules

When a page has multiple below-content sections, use this priority order:

1. Related primary content (related articles, related posts -- the same type)
2. Research/evidence (library refs, research hub links)
3. Commentary (Dr. Whittaker's posts on this topic)
4. Questions (related FAQs)
5. Comparisons (related comparison pages)
6. Related topics/terms (pills, tag links)
7. STUC callout (always last before BackToTop)

Max 4 below-content sections per page (not counting STUC callout). If a page would have more, cut the lowest-priority sections.

## Inline Link Density Rules

- Max 1 outbound cross-link per paragraph of prose
- Glossary anchor links don't count toward this limit (they're definitions, not navigation)
- Never cluster 3+ links in consecutive sentences
- Pillar guides and research hub commentary are the densest -- aim for 1 link per 2-3 paragraphs
- Library article detail gets zero inline links in the abstract (scholarly text, not our prose). The research hub badge is the only addition

## New Component Requirements

| Component | Purpose | Used by |
|---|---|---|
| `StucCallout.astro` | STUC membership CTA card. Props: `context` (commentary/faq/guide/research) for message variant | Commentary, FAQ, Pillar, Research hub |
| `ResearchHubBadge.astro` | Small inline badge linking article to its research hub. Props: `hubSlug`, `hubTitle`, `articleCount` | Library article detail |
| `ComparisonTable.astro` | Side-by-side evidence comparison with mobile stack layout | Comparison pages |
| `ResearchHubGrid.astro` | Filtered article grid with featured picks and full collection | Research hub pages |
| `CrossLinkSection.astro` | Reusable below-content section. Props: `heading`, `items[]`, `layout` (list/grid/pills) | All page types with below-content sections |

Existing components reused without modification: ArticleCard, BlogCard, TopicTag, BackToTop, Citation, BaseLayout.

## Research Hub Architecture

### Hub list

Based on library domain counts and search intent:

| Hub | Filter domains | Articles | Notes |
|---|---|---|---|
| Endometriosis | Endometriosis | 191 | Highest priority. Excision angle unique |
| PCOS | PCOS | 155 | Metabolic + hormonal |
| Infertility | Infertility | 384 | Core RRM differentiator |
| Pregnancy & Recurrent Loss | Pregnancy | 349 | NaPro progesterone protocol |
| NaProTECHNOLOGY | NaProTECHNOLOGY | 142 | Method-specific research |
| Fertility Awareness Methods | Fertility Awareness | 329 | Charting science |
| Male Factor | Andrology/Male Factor | 56 | Underserved |
| Surgery & Excision | Surgery | 139 | Surgical outcomes |
| Hormones & Cycle Science | Menstrual Cycle, Reproductive Endocrinology | 624 | Broadest hub |
| Perimenopause & Menopause | Perimenopause/Menopause | 105 | Growing demand |

### Research hub page structure

```
Breadcrumb: Home > Research > [Topic]
H1: "[Topic] Research"
Subtitle: "{count} peer-reviewed studies"

Naomi's commentary (200-400 words, editorial)
  [inline links to glossary terms, pillar guides, courses if relevant]
  [inline mention of Find-a-Provider if relevant]

STUC callout

Featured articles (4-6 ArticleCard, editorially selected)

Full article collection (ArticleCard grid, filtered by domain)
  [show-more or client-side pagination]

--- border-top ---
Below-content sections:
1. Common Questions (3-5 related FAQ links)
2. Dr. Whittaker's Commentary (1-3 related post links)
3. Related Comparisons (if exist)
4. Related Research Topics (pill links to other hubs)

BackToTop
```

Schema: CollectionPage + BreadcrumbList

### Data: research-hubs.json

```json
{
  "slug": "endometriosis",
  "title": "Endometriosis Research",
  "seoTitle": "Endometriosis Research",
  "metaDescription": "191 peer-reviewed studies on endometriosis: excision outcomes, diagnostic advances, fertility impact, and the restorative medicine approach.",
  "commentary": "<p>Naomi's editorial HTML</p>",
  "filterDomains": ["Endometriosis"],
  "filterTopicPrefixes": ["Endometriosis"],
  "featuredArticleSlugs": ["slug-1", "slug-2"],
  "relatedFaqSlugs": ["can-rrm-treat-endometriosis"],
  "relatedPostSlugs": ["commentary-post-slug"],
  "relatedComparisonSlugs": ["excision-vs-ablation"],
  "relatedHubSlugs": ["surgery-excision", "infertility"],
  "providerLink": "/find-a-provider/?method=napro",
  "publishedDate": "2026-04-01"
}
```

**Schema notes:**
- `seoTitle`: Do NOT include "| RRM Academy" suffix. BaseLayout appends it automatically.
- Article count and subtitle ("X peer-reviewed studies") are computed at build time from `filterDomains` matches against articles.json. Not stored.
- `relatedPostSlugs`: Curated list of commentary post slugs. Matched at build time against posts.json. Empty array if none.
- `providerLink`: URL with query params for the provider directory. Used for the inline "Find clinicians who work with [condition]" link.

## Comparison Page Architecture

### Comparison list (Phase 1)

| Comparison | AEO value |
|---|---|
| Excision vs ablation for endometriosis | Very high |
| NaProTechnology vs IVF for infertility | Very high |
| NaPro vs IVF for PCOS | High |
| NaPro vs IVF for recurrent miscarriage | High |

### Comparison editorial rules

Comparison pages compare evidence and outcomes. They are educational, not advisory.

- **Never recommend IVF** or include "When IVF May Be Appropriate" sections
- The IVF column presents data factually (success rates, cost, interventional burden) without endorsement
- The RRM column presents diagnostic depth, condition-specific outcomes, and evidence from the library
- **Cost uses anchoring:** IVF figure first ($40-60K), then RRM as "fraction of that." The "20x less" figure is hallucinated -- never use. Never lead with RRM dollar amounts
- **RCT absence** framed as funding structure, not evidence gap. Do not self-undercut with "to be fair, IVF has more data"
- **Use HFEA** (mandatory reporting) for IVF data, never SART/CDC (voluntary)
- No performative honesty, no self-undercutting evidence
- "Clinicians" not "physicians." REIs are IVF doctors, not RRM clinicians

### Comparison page structure

```
Breadcrumb: Home > Compare > [Title]
H1: comparison title
Hero summary (2-3 sentence citable paragraph)

ComparisonTable (side-by-side evidence grid)

Evidence narrative (editorial analysis, inline citations to library)
  [inline links to glossary terms, pillar guides]

FAQ section (2-3 Q&A pairs rendered on-page, native <details>)
  [drives FAQPage schema, provides citable Q&A content]

--- border-top ---
Below-content sections:
1. Explore the Research (research hub links for both sides)
2. Related Comparisons (other comparison links)
3. Dr. Whittaker's Commentary (if exists)

BackToTop
```

Schema: MedicalWebPage + Article + FAQPage + BreadcrumbList

**Note:** FAQPage schema requires visible Q&A content on the page. The `faqs` array in comparisons.json is rendered as an on-page accordion. `relatedFaqSlugs` are separate -- those are links to standalone FAQ detail pages in the below-content "Related Questions" section. Since the on-page FAQs and the below-content hub links give us 3 below-content sections (within the max-4 limit), we drop "Related Questions" as a separate below-content section -- the on-page FAQ accordion replaces it.

### Data: comparisons.json

```json
{
  "slug": "excision-vs-ablation",
  "title": "Excision Surgery vs Ablation for Endometriosis",
  "seoTitle": "Excision vs Ablation: What the Evidence Shows",
  "metaDescription": "Compare excision surgery and ablation for endometriosis. Evidence-based analysis of outcomes, recurrence, and fertility impact.",
  "heroSummary": "Citable 2-3 sentence summary",
  "approach1": { "name": "Excision Surgery", "description": "..." },
  "approach2": { "name": "Ablation", "description": "..." },
  "comparisonRows": [
    { "dimension": "Recurrence rate", "approach1": "Data", "approach2": "Data", "source": "PMID or slug" }
  ],
  "evidenceNarrative": "<p>Editorial HTML</p>",
  "faqs": [
    { "question": "...", "schemaAnswer": "80-120 words", "basicAnswer": "1-2 sentences" }
  ],
  "relatedHubSlugs": ["endometriosis", "surgery-excision"],
  "relatedComparisonSlugs": [],
  "relatedPostSlugs": [],
  "publishedDate": "2026-04-15"
}
```

**Schema notes:**
- `seoTitle`: Do NOT include "| RRM Academy" suffix. BaseLayout appends it automatically.
- `faqs`: Q&A pairs rendered on-page as `<details>` accordion. Drives FAQPage JSON-LD schema. These are page-embedded content, not links.
- `relatedPostSlugs`: Curated commentary posts for below-content section.

## Glossary v2 Retrofit

### Changes to existing glossary page

1. Every term gets the v2 format: definition (1-2 sentences) + "RRM relevance" paragraph (2-4 sentences)
2. Condition and method terms get inline links to research hubs, pillar guides, FAQs, comparisons (per glossary cross-link rules above)
3. Pure vocabulary terms (basal body temperature, luteinizing hormone) get definition + RRM relevance only, no outbound links
4. No structural changes to the page (stays single page with anchor links, TOC, same schema)

### Data: glossary-terms.json

Extract current terms from glossary.astro into structured JSON:

```json
{
  "slug": "endometriosis",
  "term": "Endometriosis",
  "definition": "A condition in which tissue similar to the uterine lining grows outside the uterus.",
  "rrmRelevance": "RRM clinicians treat endometriosis as an underlying condition requiring excision surgery rather than hormonal suppression. Cycle charting with the Creighton Model helps identify symptom patterns that guide surgical timing.",
  "category": "Key Conditions",
  "outboundLinks": {
    "researchHubSlugs": ["endometriosis"],
    "faqSlugs": ["can-rrm-treat-endometriosis"],
    "comparisonSlugs": ["excision-vs-ablation"],
    "pillarGuideSlugs": []
  }
}
```

The glossary page template reads this JSON and renders terms with their outbound links inline.

## Router Updates

Add to ASTRO_ROUTES in rrm-router:
- `/research`
- `/compare`

(`/glossary` already routed. `/find` deferred.)

## Implementation Phases

| Phase | What | Depends on | Effort |
|---|---|---|---|
| 1 | Glossary v2 retrofit | Nothing | Low. Data extraction + template update |
| 2 | Research hubs (4 hubs: endo, PCOS, infertility, pregnancy) | Phase 1 (glossary links) | Medium. Editorial content + template |
| 3 | Comparison pages (4 comparisons) | Phase 2 (hub cross-links) | Medium. Editorial content + template |
| 4 | Cross-link upgrades to existing pages | Phases 1-3 | Low. Template modifications |
| 5 | Remaining research hubs (6 more) | Phase 2 template | Low-Medium. Editorial only |
| 6 | Remaining comparisons (4-6 more) | Phase 3 template | Low-Medium. Editorial only |
| 7 | Condition x city pages | Provider directory maturity gate | Deferred |

Each phase ships independently.
