# Page Templatization Design

> Pixel-level page conformance via Astro layout components + CI proof gate.

**Date:** 2026-03-21
**Status:** Approved (not executing yet)

---

## Problem

55 .astro pages, 1 base layout (`BaseLayout.astro`), no intermediate layouts. Each page type has its own inline HTML/CSS with SEO infrastructure copy-pasted and drifting. No automated conformance checking beyond `verify-templates.mjs` (42 tests, pillar-focused). New pages risk shipping without schema, breadcrumbs, or Pagefind attributes.

## Solution

1. **15 intermediate Astro layouts** between BaseLayout and pages, one per page type
2. **61-check CI proof gate** (`verify-seo.mjs`) that audits built HTML output
3. **Incremental migration** with mobile-first e2e baseline snapshots

---

## 1. Layout Hierarchy

```
BaseLayout.astro (exists, unchanged)
├── PillarLayout.astro          [Full SEO + Full AEO/GEO]
│   └── 6 pages: /naprotechnology, /what-is-rrm, /femm, /neofertility,
│       /glossary, /common-questions-about-rrm
├── ComparisonLayout.astro      [Full SEO + Full AEO/GEO]
│   └── /compare/{slug}/ (RRM vs IVF + 9 more planned)
├── FaqHubLayout.astro          [Full SEO + Full AEO/GEO]
│   └── /faqs
├── FaqDetailLayout.astro       [Full SEO + Full AEO/GEO]
│   └── /faqs/{slug}
├── LibraryDetailLayout.astro   [Full SEO + Partial AEO/GEO]
│   └── /library/{slug}
├── CourseDetailLayout.astro    [Full SEO + Partial AEO/GEO]
│   └── /courses/{slug}
├── CommentaryDetailLayout.astro [Full SEO, no AEO/GEO]
│   └── /commentary/{slug}
├── HubLayout.astro             [Full SEO, no AEO/GEO]
│   └── /library, /library/page/{n}, /commentary, /commentary/page/{n},
│       /courses (library keeps custom hero via named slot;
│       pagination pages are hub variants)
├── SurveyLandingLayout.astro   [Full SEO, no AEO/GEO]
│   └── /endo-survey, (future: /pcos-survey, etc.)
├── SurveyFormLayout.astro      [Minimal -- noindex]
│   └── /endo-survey/take, (future: /pcos-survey/take, etc.)
├── ThankYouLayout.astro        [Minimal -- noindex]
│   └── /donate/thank-you, /save-the-uterus-club/thank-you,
│       (future post-conversion pages)
├── ToolLayout.astro            [Configurable index/noindex]
│   └── /ivf-success-calculator, (future calculators/tools)
├── AuthLayout.astro            [Minimal -- noindex]
│   └── /login, /signup, /forgot-password, /reset-password
├── AdminLayout.astro           [Minimal -- noindex]
│   └── /admin/*
└── LegalLayout.astro           [Full SEO, no AEO/GEO]
    └── /terms-of-use, /privacy-policy, /medical-disclaimer
```

**Bespoke pages (no intermediate layout):**
/, /about, /donate, /contact, /save-the-uterus-club, /guides, /community/*, /community/archive/*, /account, /library/saved, /courses/{slug}/{stepId}, /404, /linkinbio, /linkinbio/jointhecall, /dev/*

**Deferred:** Provider directory layouts (project still evolving).

**Totals:** 15 layouts covering 35+ pages. 20 pages stay bespoke.

---

## 2. SEO/AEO/GEO Scoping

Not all pages should receive AEO/GEO optimization. Commentary is personal voice and should not be engineered for AI citation extraction.

| Page Type | SEO | AEO/GEO | Rationale |
|-----------|-----|---------|-----------|
| Pillar guides | Full | Full | Core authority content, designed to be cited |
| FAQ hub + detail | Full | Full | #1 AEO target -- question-answer format |
| Library detail | Full | Partial | Citation meta yes, AI should link not paraphrase |
| Course detail | Full | Partial | Schema yes, content is gated |
| Commentary detail | Full | **No** | Personal voice, editorial -- ranks in search, not for AI extraction |
| Library hub | Full | No | Index page |
| Commentary hub | Full | No | Listing page |
| Courses hub | Full | No | Catalog page |
| Marketing | Full | No | Conversion pages |
| Legal | Full | No | Trust signals only |
| Community | Minimal (noindex) | No | Membership-gated |
| Auth | Minimal (noindex) | No | Not indexed |
| Account | Minimal (noindex) | No | Not indexed |
| Admin | Minimal (noindex) | No | Not indexed |
| Utility | Minimal | No | One-offs |

---

## 3. Layout Responsibilities

### What the layout owns vs. what the page owns

| Concern | Layout | Page |
|---------|--------|------|
| JSON-LD schema | Constructed from props (type, structure, cross-refs) | Passes data via props (title, dates, sections, FAQ items) |
| Breadcrumbs | Built from page type + title prop | Nothing |
| TOC (pillar/comparison) | Auto-generated from articleSections[] prop | Passes section titles |
| Author byline | Renders from author prop (defaults to Whittaker) | Override author if different |
| Editorial notice | Rendered when editorialNotice={true} (default) | Set false to suppress |
| BackToTop | Always rendered (pillar/comparison) | Nothing |
| PdfDownload | Rendered when showPdfDownload={true} (default true) | Set false to suppress (e.g., /common-questions-about-rrm) |
| Pagefind attributes | data-pagefind-body, meta, ignore zones | Optional data-pagefind-weight on content elements |
| Page type meta tag | `<meta name="page-type" content="pillar">` | Nothing (layout knows its type) |
| Structural CSS | TOC, breadcrumbs, byline, section spacing, prose typography | Content-specific (custom tables, unique visual elements) |
| Noindex | Hardcoded for auth/admin/survey-form/thank-you | Configurable for tool pages |

### Design principles

- **Layouts construct, pages provide.** Pages pass data and content. Layouts build schema, meta tags, breadcrumbs, and structural chrome. A page cannot forget SEO infrastructure because it never touches it.
- **TypeScript interfaces enforce required props.** Missing title or datePublished fails at build time, not in production.
- **page-type meta tag enables proof gate.** Every layout injects `<meta name="page-type" content="...">`. verify-seo.mjs reads it to select the right check tier.
- **Structural CSS in layouts, content CSS in pages.** TOC, breadcrumbs, prose typography owned by layout. Custom tables, unique visuals stay in the page.
- **TOC auto-generated from props.** articleSections[] prop builds both the visible TOC and the hasPart schema. Single source of truth.
- **Editorial notice default-on.** editorialNotice defaults to true. Set false explicitly to suppress.
- **Pages must NOT inject JSON-LD in the default slot.** Layout handles all schema emission. PillarLayout passes the Article schema via BaseLayout's `jsonLd` prop and renders BreadcrumbList + FAQPage as additional `<script type="application/ld+json">` tags itself. This preserves the three-part structure without requiring pages to manage schema.

---

## 4. Slot Patterns

| Layout | Props (data) | Slots (content) |
|--------|-------------|-----------------|
| PillarLayout | title, description, canonicalUrl, datePublished, dateModified, wordCount, articleSections[], faqSchema[], editorialNotice?, showPdfDownload? | `default` (prose sections -- no JSON-LD here; layout emits all schema) |
| ComparisonLayout | title, description, canonicalUrl, datePublished, dateModified, wordCount, subjects[], faqSchema[] | `default` (comparison content) |
| FaqHubLayout | title, description, canonicalUrl, faqSchema[] | `default` (accordion list) |
| FaqDetailLayout | title, description, canonicalUrl, question, answer | `default` (full answer), `related` (related questions) |
| LibraryDetailLayout | article (full article object with citation data) | None (layout renders everything from article object) |
| CourseDetailLayout | course (full course object) | None (layout renders from course object) |
| CommentaryDetailLayout | post (full post object) | None (layout renders markdown from post object) |
| HubLayout | title, description, canonicalUrl, pageType | `default` (card grid/list), `hero` (optional custom hero for library) |
| SurveyLandingLayout | title, description, canonicalUrl, surveyName, ctaUrl | `default` (survey description + benefits) |
| SurveyFormLayout | title, surveyName, airtableConfig | `default` (question steps) |
| ThankYouLayout | title, message, ctaLabel?, ctaUrl? | None (fully prop-driven) |
| ToolLayout | title, description, canonicalUrl, noindex? | `default` (tool UI) |
| AuthLayout | title | `default` (form content) |
| AdminLayout | title | `default` (dashboard content) |
| LegalLayout | title, description, canonicalUrl, lastUpdated | `default` (legal prose) |

---

## 5. Proof Gate (verify-seo.mjs)

### Architecture

| Aspect | Detail |
|--------|--------|
| **Runs when** | Post-build in deploy.yml, after verify-templates.mjs and verify-citations.mjs |
| **Input** | dist/ folder (built HTML files) |
| **Page type detection** | Reads `<meta name="page-type">` from HTML. Falls back to path convention for bespoke pages |
| **Output** | JSON report + console summary. Per-page pass/warn/fail. Exit 0 (non-blocking) initially |
| **Blocking mode** | Future: exit 1 for pages not in previous build (new pages must pass). Existing pages warn-only |
| **Consolidation** | verify-seo.mjs subsumes most verify-templates.mjs checks. Eventually retire verify-templates.mjs |

### Tier 1 -- Universal (every indexed page) -- 22 checks

| Check | Validates |
|-------|-----------|
| `<title>` present + suffix | Non-empty; includes "RRM Academy" or starts with "RRM " |
| `<title>` length | 50-60 chars |
| `meta description` | Present, 150-160 chars, contains action verb |
| Canonical URL | Absolute, trailing slash, self-referencing |
| OG tags complete | og:title, og:description, og:image, og:url, og:type |
| OG image dimensions | og:image:width + og:image:height present |
| OG image file exists | Convention path resolves in build output |
| Twitter card | twitter:card (summary_large_image for content), twitter:title, twitter:image (.jpg not .webp) |
| JSON-LD present + valid | `<script type="application/ld+json">` exists and parses |
| Organization @id | JSON-LD references `#organization` cross-link |
| Single H1 | Exactly one `<h1>` |
| Heading hierarchy | No skipped levels (H1->H2->H3) |
| `lang="en"` | `<html lang="en">` |
| Viewport meta | `<meta name="viewport">` with width=device-width |
| Image alt text | Every `<img>` has non-empty `alt` (except decorative) |
| No broken internal links | Every `href` starting with `/` resolves to a built page |
| Trailing slash consistency | All internal hrefs end with `/` |
| HTTPS enforcement | No `http://` internal links |
| No duplicate meta | No duplicate name or property attributes |
| No duplicate IDs | No duplicate id attributes |
| Descriptive anchors | No "click here", "read more", "learn more" |
| Pagefind body marker | `data-pagefind-body` on main content container |

### Tier 2 -- Type-Specific Schema + Structure -- 18 checks

**Pillar guide (8 checks):**
- Schema: Article + MedicalWebPage
- Three-part JSON-LD (Article, BreadcrumbList, FAQPage in SEPARATE script tags)
- Author Person with @id (#naomi-whittaker), name, jobTitle, image, sameAs
- datePublished + dateModified ISO 8601; wordCount >= 1500
- hasPart sections: each H2 has corresponding WebPageElement with fragment URL
- Required components: BackToTop, editorial-notice (unless suppressed), TOC, author-byline, breadcrumb; PdfDownload unless showPdfDownload=false
- Citation anchor integrity: every inline [N] has matching id="ref-N"
- Pagefind meta: `data-pagefind-meta="type:Guide"`

**Commentary detail (3 checks):**
- BlogPosting + BreadcrumbList in @graph; breadcrumb = Home > Commentary > Title
- If author matches "Whittaker", full Person schema with @id, credentials, sameAs
- Cover image alt text equals post title

**Library detail (3 checks):**
- MedicalScholarlyArticle with Periodical > PublicationIssue > PublicationVolume nesting
- Highwire Press meta: citation_title, citation_author (1 per author), citation_date (YYYY/MM/DD)
- Pagefind weights: title(10), authors(5), searchTerms(4), year(2)

**Course detail (2 checks):**
- Course + Person + BreadcrumbList schema
- If course has FAQs, FAQPage schema present (never QAPage for FAQ content)

**FAQ detail (1 check):**
- FAQPage schema with single Question in mainEntity array (NEVER use QAPage -- see memory)

**Noindex pages (1 check):**
- `<meta name="robots" content="noindex, nofollow">` present on: admin/*, auth (login/signup/forgot-password/reset-password), survey form pages, thank-you pages

### Tier 3 -- AEO/GEO Signals -- 12 checks

Only fires on pillar guides + FAQ pages (full) and library/course detail (partial subset).

| Check | Applies to | Validates |
|-------|-----------|-----------|
| Query-mirror H2s | Pillar | H2s phrased as questions or complete statements, not labels |
| FAQ schema depth | FAQPage pages | acceptedAnswer.text >= 80 words per question |
| Person @id consistency | All authored | Whittaker uses #naomi-whittaker @id, never inline-only |
| Internal link minimum | Pillar, FAQ | >= 3 internal links in body (not nav/footer) |
| Cross-pillar links | Pillar | Links to >= 2 other pillar pages |
| Bold lead statements | Pillar | First `<strong>` per section is citable statement with topic keyword |
| Fresh date signal | Pillar | "Last updated" or dateModified visible on page |
| Citation density | Pillar | >= 1 citation per 500 words |
| Entity name expansion | Pillar, FAQ | First mention of acronyms uses full name |
| Organization sameAs | Homepage, about | Organization schema includes sameAs social URLs |
| Anchor text diversity | All indexed | <20% of internal anchors use exact keyword match |
| Related content present | Library, FAQ detail | >= 2 related content links in dedicated section |

### Tier 4 -- Asset Integrity -- 5 checks

| Check | Validates |
|-------|-----------|
| WebP format | All local `<img>` src files are .webp |
| Image file exists | Every local `<img src>` resolves in build output |
| _headers coverage | Each public/images/ subdirectory has a caching rule |
| Lazy loading | Non-hero images have loading="lazy"; hero images do NOT |
| Font preloads intact | 5 font preload links present (Cormorant 400/600, Inter 400/500/600) |

### Tier 5 -- Site-Level Integrity (once per build) -- 4 checks

| Check | Validates |
|-------|-----------|
| robots.txt syntax | Valid directives, AI crawler allowlist intact |
| sitemap-index.xml valid | Valid XML, absolute URLs, ISO 8601 lastmod |
| llms.txt present | File exists with version, scope disclaimers, citation format |
| Key pages exist | Critical pages built: /, /about, /library, /commentary, /courses, /faqs, /login, /signup, /donate, /contact, /naprotechnology, /what-is-rrm, /femm, /neofertility, /glossary, /common-questions-about-rrm |

---

## 6. Migration Strategy

### Process per page

```
1. Baseline: npx playwright test (capture pass count, all 3 viewports)
2. Baseline: screenshot page at 375px, 768px, 1280px (mobile-first)
3. Migrate page to new layout
4. Verify: npx playwright test (same pass count, all 3 viewports)
5. Verify: screenshot page at 375px, 768px, 1280px
6. Visual diff: compare before/after screenshots
7. Only proceed if steps 4-6 clean
```

### Order

1. **Build all 15 layouts** with TypeScript interfaces, no page changes yet
2. **Reference implementations** (one per layout type):
   - PillarLayout: /naprotechnology (most complex, best test)
   - AuthLayout: /login (simplest)
   - LegalLayout: /terms-of-use
   - AdminLayout: /admin/seo
   - HubLayout: /commentary
   - CommentaryDetailLayout: /commentary/[slug]
   - FaqHubLayout: /faqs
   - FaqDetailLayout: /faqs/[slug]
   - LibraryDetailLayout: /library/[slug]
   - CourseDetailLayout: /courses/[slug]
   - SurveyLandingLayout: /endo-survey
   - SurveyFormLayout: /endo-survey/take
   - ThankYouLayout: /donate/thank-you
   - ToolLayout: /ivf-success-calculator
   - ComparisonLayout: deferred (blocks on `feat/provider-detail-pages` merge; build layout interface early, reference implementation after merge)
3. **Playwright e2e per migration** -- mobile-first (375px), then 768px, then 1280px
4. **Sibling migration** -- remaining pages of each type, one at a time
5. **Build verify-seo.mjs** -- runs against all pages, non-blocking
6. **Retire verify-templates.mjs** -- once verify-seo.mjs covers all its checks

### Mobile-first e2e

The proof gate and migration verification run mobile viewport first (375px), then tablet (768px), then desktop (1280px). This matches the existing Playwright suite's 3 viewports.

Before migrating any page, the full Playwright suite (78 tests) runs as baseline. After migration, the same suite must produce identical pass counts. Any new failure = migration broke something.

### Route pattern note

`/faqs` is a top-level file (`src/pages/faqs.astro`), not a directory index. Migration to FaqHubLayout must preserve this route pattern -- do not move to `src/pages/faqs/index.astro` unless tested.

---

## 7. Non-Negotiable Preservations

These elements exist on the current site and must survive templatization. Regression on any of these is a defect.

1. BaseLayout title suffix logic (append `| RRM Academy` unless already present)
2. Canonical trailing-slash normalization
3. OG image convention (`/images/og/og-{slug}.png`)
4. Twitter image .webp to .jpg swap
5. Font preloading (5 specific weights via Vite ?url imports)
6. Three-part JSON-LD for pillar pages (separate script tags, not merged @graph)
7. Pagefind attributes (data-pagefind-body, meta, weight, ignore)
8. Highwire Press citation meta (exact field names + YYYY/MM/DD date format)
9. Markdown sanitization pipeline (commentary detail -- 10+ regex patterns)
10. RIS citation generation (library detail -- client-side JS)
11. Access/sentiment badges (library detail)
12. Structured abstract parsing (library detail)
13. Citation anchor integrity (inline [N] to id="ref-N")
14. Editorial notice on pillar pages (default-on)
15. Query-mirror headings (H2s as questions/claims, not labels)
16. sr-only class definition (exact clip rect values)
17. Design token usage (never hardcode colors/spacing)
18. robots.txt AI crawler allowlist
19. llms.txt scope disclaimers
20. _headers caching rules (no modifications)
