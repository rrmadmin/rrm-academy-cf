# /naprotechnology/ Guide Page -- Design Spec

**Date:** 2026-03-12
**Status:** Draft
**Goal:** Create a comprehensive, SEO/GEO/AEO-optimized guide page at `/naprotechnology/` that captures the NaPro search cluster (6,596 impressions/month, 100 distinct queries) and serves as the canonical NaPro education page on rrmacademy.org.

---

## Problem

RRM Academy ranks pos 2.2 for "naprotechnology" but has no dedicated NaPro page. Traffic scatters across commentary articles, FAQ answers, and course pages. Meanwhile, 2,200+ monthly impressions for "napro doctor near me" variants have no landing target. The existing naproebook.com (4-page PDF, 9 facts) is outdated and lives off-domain.

## Source Material (Do Not Hallucinate)

All clinical content must be sourced from these verified documents. No external claims, no invented statistics.

| Source | What to pull | Location |
|--------|-------------|----------|
| **naproebook.com PDF** | 9-fact structure, condition-treatment table, "who is NaPro for" list, 3-step flow | `~/Downloads/9 Facts About NaPro...pdf` |
| **what-is-rrm pillar** (unpublished) | IVF comparison table, IVF evidence gap section, success rate data (Boyle 2025, Sanchez-Mendez 2025), NaPro history, Creighton Model explanation, charting methods table, condition treatment approaches, provider finding section, cost comparison | `src/pages/what-is-rrm/index.astro` |
| **FAQ F04** | NaProTECHNOLOGY + Creighton Model definition | Airtable Published Answer |
| **FAQ F05** | In-body conception definition | Airtable Published Answer |
| **FAQ F14** | "Do I need to be Catholic" answer | Airtable Published Answer |
| **FAQ F20** | Success rates (Boyle 2025 41% LBR, Sanchez-Mendez 2025 n=1,310, adjusted cumulative 50-62%) | Airtable Published Answer |
| **FAQ F02** | RRM vs IVF comparison language | Airtable Published Answer |
| **FAQ F16** | Cost comparison data | Airtable Published Answer |
| **Commentary** | NaPro surgery article (top page, 12K impressions) | `/commentary/naprotechnology-surgery-...` |

**Rules:**
- Every stat must trace to one of these sources
- Success rate data uses Boyle 2025 and Sanchez-Mendez 2025, NOT the old Hilgers/Pope Paul VI data from the ebook
- IVF comparison uses balanced language from what-is-rrm, not the adversarial framing from the ebook
- Letrozole for PCOS: do NOT assert as NaPro standard without Naomi review (flagged)
- Always mention Creighton alongside NaPro at least once (they are two halves of one system)

## Content Outline

Sections mapped to GSC search demand clusters.

### 1. What is NaProTechnology?
**Target queries:** "naprotechnology" (1,084 imp, pos 2.2), "napro meaning" (52 imp), "how does naprotechnology work" (12 imp), "napro technology" (134 imp)

**Content:**
- Opening definition: NaProTECHNOLOGY (Natural Procreative Technology) is a medical system that uses the Creighton Model FertilityCare System to diagnose and treat reproductive disorders by working with the natural cycle
- Creighton + NaPro as two halves: CrMS provides the diagnostic data, NaPro provides the medical/surgical treatment framework
- The 3-step flow from the ebook: Chart your cycle, Get a diagnosis, Receive treatment
- Brief history: Hilgers at Creighton University (1976), Pope Paul VI Institute (1985), IIRRM formalization (2000)
- Source: what-is-rrm sections "What Is RRM?", "A Brief History", FAQ F04

### 2. How NaPro Works
**Target queries:** "what is a napro doctor" (362 imp, pos 1.7), "napro doctor meaning" (81 imp), "napro fertility treatment" (24 imp)

**Content:**
- Daily charting: simple observations of cervical mucus, bleeding patterns (a few minutes per day, from ebook Fact 2)
- Provider reads the chart like a cardiologist reads an EKG (from what-is-rrm)
- Targeted diagnostics timed to cycle: hormone panels at Peak+3/5/7/9/11, ultrasound series, HSG/SIS
- Both partners evaluated (couple-centered model)
- Source: what-is-rrm "How RRM Diagnosis Works", FAQ F08, ebook Facts 2 + 5

### 3. Conditions NaPro Treats
**Target queries:** "naprotechnology endometriosis" (49 imp, pos 1.2), "napro infertility" (8 imp), "napro fertility" (353 imp, pos 3.0)

**Content:**
- Condition list from ebook Fact 4 (infertility, endometriosis, PCOS, RPL, ovarian cysts, irregular bleeding, etc.)
- Condition-treatment table updated from ebook Fact 6, with corrections:
  - PCOS: remove "ovarian wedge resection", note that letrozole is international guideline first-line (FLAG: confirm with Naomi for NaPro-specific positioning)
  - Endometriosis: excision, not ablation
  - PPD: bio-identical progesterone
- Source: ebook Facts 4 + 6, what-is-rrm condition sections, FAQ F03

### 4. NaPro Surgery
**Target queries:** "napro surgeon" (369 imp, pos 1.6), "napro surgery" (112 imp, pos 2.7), "napro endometriosis surgery" (34 imp, pos 1.2), "napro surgeon near me" (161 imp, pos 1.4)

**Content:**
- NaPro surgical approach: excision-based, fertility-preserving
- What NaPro surgery addresses: endometriosis, fibroids, tubal disease, ovarian cysts, adhesions, isthmocele
- Brief mention of outcomes (link to commentary article for depth)
- CTA to masterclass course
- Source: NaPro surgery commentary article, what-is-rrm surgery sections

### 5. Who is NaPro For?
**Target queries:** various informational queries about whether NaPro applies

**Content:**
- The audience list from ebook Fact 3 (updated language)
- "Do I need to be Catholic?" answer (from FAQ F14)
- NaPro after failed IVF (from what-is-rrm: Boyle et al. 2022 case)
- Source: ebook Fact 3, FAQ F14, what-is-rrm "RRM After Failed IVF"

### 6. NaPro vs IVF
**Target queries:** "naprotechnology vs ivf" (75 imp, pos 1.6), "napro vs ivf" (27 imp, pos 1.3), "rrm vs ivf" (88 imp, pos 7.2), "napro vs fertility clinic for endo treatment" (10 imp)

**Content:**
- Updated comparison table from what-is-rrm (approach, diagnosis, cost, conception method, risks, success metrics)
- Balanced framing: "RRM is its own paradigm, not defined in opposition to IVF"
- Success rate comparison using current data:
  - NaPro/RRM: 26-41% crude LBR, 50-62% adjusted cumulative (Boyle 2025, Sanchez-Mendez 2025 n=1,310)
  - IVF: ~30% per fresh cycle (CDC data), declining per-retrieval since 2010
- Cost comparison: IVF costs $15K-$30K/cycle ($40-60K+ total); RRM treatments often covered by standard insurance. Do NOT use "20x" multiplier (hallucinated, not from Katz 2011)
- Do NOT use the old ebook Fact 8 chart (popepaulvi.com source)
- Source: what-is-rrm "RRM vs. IVF" section, FAQ F02, FAQ F20, FAQ F16

### 7. How to Find a NaPro Provider
**Target queries:** "napro doctor" (729 imp, pos 3.8), "napro doctor near me" (309 imp, pos 3.1), "napro fertility near me" (76 imp), "napro doctor [city]" (100+ imp across Houston, Dallas, Michigan, etc.), "list of napro doctors" (11 imp)

**Content:**
- IIRRM provider directory (primary)
- FertilityCare Centers of America (for Creighton instruction)
- Natural Womanhood directory
- Virtual/telehealth options for patients without local access
- What to ask when choosing a provider
- Source: what-is-rrm "How to Get Started" section, FAQ F15

### 8. Cost and Insurance
**Target queries:** maps to broader NaPro commercial intent

**Content:**
- Most NaPro treatments coded under standard insurance for diagnosed conditions
- Cost comparison vs IVF: anchoring (IVF $40-60K+ total, RRM a fraction). Do NOT use "20x" figure
- Source: FAQ F16, FAQ F17, what-is-rrm cost section

### 9. Frequently Asked Questions (inline)
**Content:**
- Pull schema answers from F04, F05, F14 as a compact FAQ section
- Schema markup: FAQPage with these Q&As
- "Is NaPro the same as RRM?" answer from what-is-rrm FAQ

---

## Schema Markup

```json
{
  "@context": "https://schema.org",
  "@type": ["MedicalWebPage", "Article"],
  "name": "What is NaProTechnology? A Complete Guide",
  "description": "...",
  "author": {
    "@type": "Person",
    "name": "Naomi Whittaker, MD",
    "jobTitle": "Board-Certified OBGYN, NaProTechnology Fellow"
  },
  "publisher": {
    "@type": "EducationalOrganization",
    "name": "RRM Academy"
  },
  "about": {
    "@type": "MedicalTherapy",
    "name": "NaProTechnology",
    "alternateName": "Natural Procreative Technology"
  },
  "hasPart": [
    { "@type": "WebPageElement", "name": "section anchor" }
  ],
  "citation": [
    { "@type": "ScholarlyArticle", "name": "...", "author": "..." }
  ]
}
```

**Separate JSON-LD blocks** (not merged into one graph):
- Block 1: `MedicalWebPage` with Article properties (main page schema)
- Block 2: `FAQPage` for the inline FAQ section (section 9) -- separate block to avoid Google validation issues per the QAPage lesson from 2026-03-09
- Block 3: `BreadcrumbList`: Home > NaProTechnology

## Page Structure

- **Target length:** 3,000-4,000 words (substantial but not as long as the 15K what-is-rrm pillar)
- **Table of contents:** Sticky left sidebar on desktop (same pattern as what-is-rrm), collapses to top-of-page TOC on mobile
- **All sections render open** (no accordions -- guide pages should be fully crawlable and scannable)
- **Tables** (condition-treatment, IVF comparison): horizontal scroll on mobile with `overflow-x: auto` wrapper, same pattern as what-is-rrm tables
- **Author attribution:** Naomi Whittaker, MD (she is the NaPro fellowship-trained expert, this is her domain)

## Content Cannibalization with /what-is-rrm/

`/what-is-rrm/` is intentionally unpublished and may remain so. If it eventually publishes:
- `/naprotechnology/` targets NaPro-specific queries ("naprotechnology", "napro doctor", "napro vs ivf")
- `/what-is-rrm/` targets RRM umbrella queries ("restorative reproductive medicine", "what is rrm", "rrm vs ivf")
- NaPro is one approach within RRM (alongside NeoFertility, FEMM Medical Management). The guide makes this distinction in section 1
- Cross-link: /naprotechnology/ links to /what-is-rrm/ when it publishes, and vice versa
- No overlap risk while /what-is-rrm/ remains unpublished

## Internal Linking Strategy

**From the guide:**
- Section 3 (Conditions) links to relevant FAQ detail pages and condition FAQs when published
- Section 4 (Surgery) links to NaPro surgery commentary article and masterclass course
- Section 6 (vs IVF) links to RRM vs IVF course
- Section 7 (Find Provider) links to IIRRM directory (external), FAQ F15
- Section 9 (FAQ) links to FAQ detail pages

**To the guide (update existing pages):**
- FAQ F04 published answer: add link to /naprotechnology/
- FAQ F14: add link to /naprotechnology/
- NaPro surgery commentary: add link to /naprotechnology/
- Header nav: no change (guide discoverable via search + internal links)
- Sitemap: auto-included

## SEO/AEO Optimization

- **Title tag:** "What is NaProTechnology? Complete Guide to Natural Procreative Technology"
- **Meta description:** "NaProTechnology uses the Creighton Model to diagnose and treat infertility, endometriosis, and PCOS. Learn how NaPro works, find a provider, compare costs." (~150 chars)
- **H1:** "NaProTechnology: A Complete Guide" (or similar, keyword-first)
- **Each section opens with a direct-answer sentence** (citable by AI)
- **Schema markup** as described above
- **Table of contents** with anchor links (matches what-is-rrm pattern)
- **lastmod** in sitemap set to publish date

## Technical Implementation

- **File:** `src/pages/naprotechnology/index.astro`
- **Layout:** `BaseLayout.astro` (same as other guide pages)
- **Body class:** `page-guide` or `page-naprotechnology`
- **Breadcrumbs:** reuse existing breadcrumb pattern from FAQ detail pages
- **No data fetches:** content is static, authored in the .astro file (same as what-is-rrm)
- **Router:** add `/naprotechnology/` to ASTRO_ROUTES in rrm-router if not already caught by wildcard

## Content Ownership

- **Brian/Naomi write the content.** Claude does not author clinical claims
- **Claude builds the page infrastructure:** .astro file, schema markup, breadcrumbs, internal links, SEO meta, sitemap inclusion
- **Gianna agent** can draft sections from source material for Brian's review, but all medical claims require human verification before publish
- **Flagged for Naomi:** PCOS treatment positioning (letrozole as NaPro standard vs international guideline standard)

## "Near Me" Strategy (v1)

V1 links to external directories only (IIRRM, FertilityCare Centers of America, Natural Womanhood). No local schema or curated provider list. This captures the 2,200 imp/month "near me" cluster without building infrastructure we can't maintain. Section 7 content frames the directories as the authoritative sources, includes "what to ask when choosing a provider" guidance, and mentions virtual/telehealth for patients without local access.

**External link monitoring:** Provider directory URLs (iirrm.org, fertilitycare.org, naturalwomanhood.org) should be added to the broken link crawler allowlist in rrm-seo-monitor so we catch directory moves or dead links.

## Decisions

1. **Ebook PDF:** Rebuild with updated content (current success rates, corrected treatments, balanced IVF framing) but keep the existing color palette. Old PDF is superseded but the format stays as a lead magnet on this page. New PDF sources from the same verified material as the guide page.
2. **whatisnapro.com:** Legacy ebook domain, still active in Cloudflare (1.3k DNS queries). Superseded by /naprotechnology/ on rrmacademy.org. Redirect TBD separately from this spec.

## Success Metrics

- Capture "naprotechnology" pos 1 (currently pos 2.2)
- Capture "napro" queries currently going to commentary (1,521 imp at pos 7.3)
- Increase CTR on NaPro queries from current 0.5-0.7% to 3%+ via dedicated landing page
- Appear in AI answers for "what is naprotechnology" queries
