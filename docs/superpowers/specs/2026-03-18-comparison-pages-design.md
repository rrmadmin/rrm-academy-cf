# Comparison Pages Design Spec

## Goal

Build a reusable comparison page template and the first page (RRM vs IVF) to capture long-tail "vs" and "best/alternative" search queries. Each page targets a specific query cluster, is optimized for AI citation (AEO/GEO), and funnels readers to courses and (eventually) the provider directory.

## Architecture

Comparison pages are standalone Astro pages under `/compare/`. Each page is an individual `.astro` file (not data-driven) because content is unique per page -- unlike library articles, each comparison has bespoke structure and argumentation. A shared set of components provides visual consistency.

**Note:** Uses `/compare/` (not `/compare/`) to align with the content expansion plan (`docs/superpowers/specs/2026-03-16-content-expansion-crosslink-design.md`). This spec supersedes the data-driven `comparisons.json` approach from that plan -- standalone `.astro` files give better editorial control for pages that are individually authored.

### URL Structure

- Pattern: `/compare/{slug}/`
- Index: `/compare/` (card grid listing all comparison pages)
- First page: `/compare/rrm-vs-ivf/`
- Breadcrumbs: Home > Compare > [Page Title]

### Sitemap

Add `/compare/` and all comparison detail pages to `sitemap-0.xml`.

## Page Structure

Every element exists because AI systems cite it or Google rewards it. Ordered by position on page:

### 1. Breadcrumbs

`Home > Compare > RRM vs IVF`

BreadcrumbList schema. AI systems use breadcrumbs to understand page hierarchy.

### 2. H1 -- Question-format

Example: "RRM vs IVF: How Do They Compare?"

Matches the search query directly. AI systems preferentially cite pages whose H1 matches the user's question.

### 3. Key Takeaways Box

4-5 bullet points summarizing the comparison. Each bullet is a complete, self-contained, citable statement with the subject named.

Example bullets:
- "Restorative Reproductive Medicine (RRM) diagnoses and treats the underlying cause of infertility, while IVF bypasses it to achieve pregnancy directly."
- "A 2025 study of 1,310 couples found a 52.8% cumulative live birth rate with NaProTechnology over 24 months of treatment."

This is the #1 element AI systems quote. Must be readable without any surrounding context.

### 4. Author Byline

Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI. Person schema. E-E-A-T signal.

### 5. Comparison Table

Structured side-by-side HTML `<table>` (semantic, not CSS grid -- parsers extract `<table>` reliably).

| Dimension | RRM | IVF |
|-----------|-----|-----|
| Philosophy | Diagnose and treat the cause | Bypass the cause |
| Typical cost | A fraction of IVF | $15,000-$30,000 per cycle; $40,000-$60,000+ total |
| Success metric | Cumulative live birth rate over 24 months | Per-cycle live birth rate |
| Reported success | 52.8% cumulative at 24 months (Boyle 2025) | ~30% per cycle (HFEA) |
| After failed IVF | Comparable outcomes to another IVF cycle | Declining returns per cycle |
| Surgical training | Fertility-focused (NaPro fellowship) | Minimal surgical requirements |
| Risks | Standard medical/surgical risks | OHSS, multiple pregnancy, prematurity |
| Long-term health | Treats underlying condition | Underlying condition unaddressed |
| Insurance | Often codeable as diagnostic/treatment | Varies by state mandate |

AI models extract specific cells to answer specific questions ("What does IVF cost vs RRM?").

### 6. Content Sections (3-5 sections, 400-800 words each)

Each section H2 is a question people actually search:
- "What is the difference between RRM and IVF?"
- "How do success rates compare?"
- "What are the risks of IVF compared to RRM?"
- "How much does RRM cost compared to IVF?"
- "Who is RRM for?"

**Section format:**
- Bold lead sentence: a complete citable statement (includes "RRM" as subject so AI snippets have context)
- Body: evidence-based comparison grounded in Naomi's transcript + rrm-cli studies
- Inline citations: numbered, linked to library articles (e.g., "Boyle et al., 2025 [1]")
- Stat callout blocks for key numbers (rendered as `<aside>` elements that AI parsers extract independently)

### 7. FAQ Section

5-7 questions with FAQPage schema. Targets "People Also Ask" and AI follow-up questions.

Each answer: 80-120 words (sweet spot for schema answers and AI citation).

Questions for RRM vs IVF page:
- "Is RRM as effective as IVF?"
- "How much does RRM cost compared to IVF?"
- "Can RRM work after failed IVF?"
- "What is the success rate of NaProTechnology?"
- "Is RRM covered by insurance?"
- "Do I need to be religious to use RRM?"
- "How long does RRM treatment take?"

Three-tier FAQ model (matching existing site pattern): `schemaAnswer` (JSON-LD, 80-120 words), `basicAnswer` (on page), expandable detail.

### 8. CTA Cards

A slot that holds 1-2 CTA cards:

**Card 1 (now):** Course CTA
- "This page summarizes the key differences. Dr. Whittaker covers the full evidence, including patient stories and surgical training comparisons, in a free video course."
- Links to `/courses/rrm-vs-ivf/`

**Card 2 (future, when provider directory launches):** Find a Provider
- "Ready to explore RRM? Find an RRM-trained provider near you."
- Links to `/providers/` (or whatever the directory URL becomes)

Not schema-marked (CTAs, not content).

### 9. Related Comparisons

Links to other comparison pages. Builds internal link cluster. Initially empty for the first page, populated as more pages are built.

### 10. Numbered References

Each citation links to the corresponding `rrmacademy.org/library/` article page. Internal link equity flows to the library. MedicalScholarlyArticle schema on library pages means AI systems can follow the citation chain.

### 11. Back-to-Top Component

Required on all pillar/guide/comparison pages per project convention.

## Schema Markup

Three separate `<script type="application/ld+json">` blocks (matching newer pillar page pattern, not `@graph`):

**Block 1: Article + MedicalWebPage**
```json
{
  "@context": "https://schema.org",
  "@type": ["Article", "MedicalWebPage"],
  "headline": "RRM vs IVF: How Do They Compare?",
  "author": {
    "@type": "Person",
    "name": "Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI",
    "jobTitle": "Board-Certified OBGYN, NaProTechnology Fellow",
    "@id": "https://rrmacademy.org/#naomi-whittaker",
    "url": "https://rrmacademy.org/commentary/rrm-spotlight-naomi-whittaker-md/"
  },
  "publisher": {
    "@type": "EducationalOrganization",
    "name": "RRM Academy",
    "url": "https://rrmacademy.org"
  },
  "mainEntityOfPage": "https://rrmacademy.org/compare/rrm-vs-ivf/",
  "datePublished": "...",
  "dateModified": "...",
  "wordCount": "...",
  "about": ["Restorative Reproductive Medicine", "In Vitro Fertilization", "Infertility Treatment"],
  "articleSection": ["Key Takeaways", "What is the difference...", "How do success rates compare?", "..."],
  "hasPart": [{ "@type": "WebPageElement", "name": "...", "url": "#section-id" }],
  "citation": ["... library article references ..."]
}
```

**Block 2: BreadcrumbList** (Home > Compare > Page Title)

**Block 3: FAQPage** (5-7 questions, 80-120 word answers)

Not using `ComparisonPage` or `ItemPage` -- not well-supported by Google or AI systems. `Article` + `MedicalWebPage` + `FAQPage` is the strongest combination, matching existing pillar pages.

## Content Source Pipeline

For each comparison page:

1. **Check transcript** -- Does Naomi address this topic? Use her framing, claims, metaphors as ground truth. Source: `docs/source-material/rrm-vs-art-transcript.txt` and `docs/source-material/rrm-vs-ivf-comparison-points.txt`
2. **Run rrm-cli** -- `rrm-cli search "topic" --intent=cite` to find the latest studies in the 3,200+ article library
3. **Cross-reference** -- Replace outdated citations with newer studies (e.g., Boyle 2025 replaces older NaPro outcome data), keep Naomi's framing
4. **Write via Gianna agent** -- Naomi's clinical voice, grounded in transcript + rrm-cli citations
5. **Run `rrm-cli check --file`** -- Editorial guardrail validation before publish

## Astro Implementation

### Files

**New components:**
- `src/components/ComparisonTable.astro` -- Side-by-side comparison table. Props: `rows` array of `{ dimension, optionA, optionB }`. Renders semantic `<table>`.
- `src/components/KeyTakeaways.astro` -- Styled box with bullet points. Props: `items` string array.
- `src/components/StatCallout.astro` -- Highlighted stat block as `<aside>`. Props: `stat`, `source`, `sourceUrl`. Follow card elevation pattern for styling.
- `src/components/PageCTA.astro` -- Generic CTA card. Props: `href`, `title`, `description`, `icon` (optional). Reusable for course CTA, provider directory CTA, or any future CTA.

**New pages:**
- `src/pages/compare/index.astro` -- Index page with card grid (CollectionPage + ItemList schema)
- `src/pages/compare/rrm-vs-ivf.astro` -- First comparison page

**Reused components:**
- `BaseLayout` (head, nav, footer) -- pass `ogType="article"` and `publishDate`
- `BackToTop`

**Not reused (inline instead):**
- Author byline: use the inline `<div class="author-byline">` pattern from existing pillar pages (not the simpler `AuthorByline` component, which is blog-card-level)
- Table of contents: use the inline `<details>` (mobile) + `<nav class="toc">` (sticky sidebar) pattern from existing pillar pages (no standalone `TableOfContents` component exists)
- References: use inline `<section id="references">` with `<sup><a href="#ref-N">N</a></sup>` inline citations, matching pillar page pattern

**Page wrapper:**
- Wrap content in `<div class="page-wrapper" data-pagefind-body>` for Pagefind site search indexing
- Include `data-pagefind-meta` spans for type ("compare") and title

**Deferred:**
- PDF download: not included in v1. Can add later using existing `PdfDownload` component.
- Editorial notice: not needed for comparison pages (evidence-based analysis, not evolving editorial position).

### Styling

Use existing design system CSS custom properties. No new design tokens. Comparison table uses existing table styles. New components follow card elevation pattern (`box-shadow: var(--shadow-sm)`).

## RRM vs IVF Page -- Content Sources

### From Naomi's transcript (ground truth):
- Training comparison (REI vs NaPro fellowship surgical numbers)
- Selective HSG as RRM-unique procedure
- IUI evidence critique (not better than timed intercourse)
- IVF evidence critique (Dutch and British trials showing similar results to IUI)
- Patient stories and clinical experience
- The "all roads lead to IVF" framing

### From rrm-cli (newer studies):
- **Boyle et al., 2025** -- RRM outcomes compared to IVF, retrospective evaluation
- **Sanchez-Mendez et al., 2025** -- NaPro take-home-baby rate, 1,310 couples, 5-year cohort
- **Stanford et al., 2022** -- iNEST international evaluation

### From comparison points doc:
- Structured philosophical comparison (restore vs bypass)
- Efficacy metrics comparison (cumulative vs per-cycle)
- "RRM success after IVF failure" argument
- Long-term health implications
- Cost analysis framework

### Editorial guardrails (from project memory):
- Never recommend IVF
- Cost anchoring: IVF first ($40-60K), then RRM as "fraction of that"
- "Clinicians" not "physicians"
- Use "underlying condition" not "root cause" for NaPro content
- Don't frame RRM as merely an IVF alternative -- it's a full reproductive health discipline
- Don't self-undercut with performative honesty about evidence gaps

## Comparison Page Roadmap (Prioritized by Search Volume)

| Priority | Page | Target Queries | Est. Volume | Notes |
|----------|------|---------------|-------------|-------|
| 1 | `/compare/rrm-vs-ivf/` | "rrm vs ivf" | 140/mo | Template proof of concept. Ship first, validates infrastructure |
| 2 | `/compare/naprotechnology-vs-ivf/` | "naprotechnology vs ivf" | 2,900/mo | Ship within days of #1. 20x the volume, same template |
| 3 | `/compare/letrozole-vs-clomid/` | "letrozole vs clomid" | 18,100/mo | Highest volume on the list. RRM has a unique angle (underlying-cause framing) |
| 4 | `/compare/ivf-alternatives/` | "ivf alternatives", "best alternative to ivf" | 9,900/mo | Broadest capture page. Introduces RRM to people who've never heard of it |
| 5 | `/compare/best-treatment-for-endometriosis/` | "best treatment for endometriosis" | 5,400/mo | Connects to masterclass + endo survey |
| 6 | `/compare/best-pcos-treatment-for-pregnancy/` | "best pcos treatment for pregnancy" | 3,990/mo | PCOS is second-largest condition in library |
| 7 | `/compare/endometriosis-excision-vs-ablation/` | "excision surgery for endometriosis" | 2,880/mo | Naomi's surgical expertise is the differentiator |
| 8 | `/compare/creighton-model-vs-marquette/` | "creighton model vs marquette" | 980/mo | FABM comparison -- substantial content, not thin |
| 9 | `/compare/progesterone-for-recurrent-miscarriage/` | "progesterone for recurrent miscarriage" | 590/mo | Condition-specific, strong library backing |
| 10 | `/compare/femm-vs-creighton/` | "femm vs creighton" | 390/mo | Bridges existing pillar pages |

Build RRM vs IVF first (validates template). NaPro vs IVF ships within days -- same template, 20x the volume. Letrozole vs clomid is priority 3 because 18,100/mo is the single largest opportunity and RRM Academy offers a perspective no one else has (why are you prescribing either drug without diagnosing the underlying condition first?).

## Content Overlap with /what-is-rrm/

The `/what-is-rrm/` pillar page already has an "RRM vs. IVF: A Detailed Comparison" section with a comparison table, cost analysis, and success rates. Strategy:

- **Both pages coexist** with different angles. The pillar page section is a chapter within a comprehensive "What is RRM?" explainer. The comparison page is a focused, standalone analysis for people searching specifically for the comparison.
- **Cross-link:** The pillar page section links to `/compare/rrm-vs-ivf/` as "See our detailed comparison." The comparison page links back to `/what-is-rrm/` for readers who want the full RRM context.
- **No canonical conflict:** Different URLs, different H1s, different search intent. Google handles this fine.

## Nav Integration

Do not add "Compare" to main nav until 3+ pages exist. Until then, comparison pages are linked from:
- Pillar pages (contextual internal links within relevant sections)
- FAQ answers (where relevant)
- The `/guides/` page or a "Related Resources" section
- Homepage (once section is substantial)
