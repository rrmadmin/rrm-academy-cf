# Page Templatization -- Implementation Plan

> Spec: `docs/superpowers/specs/2026-03-21-page-templatization-design.md`

**Status:** Not started
**Priority:** Queued

---

## Phase 1: Foundation (layouts + proof gate script)

### Step 1.1: Create layout files with TypeScript interfaces

Create all 15 layouts in `src/layouts/` with correct Props interfaces and BaseLayout wrapping. No page migrations yet -- just the layout files.

**Order** (simplest to most complex):
1. ThankYouLayout.astro (prop-driven, no slots)
2. LegalLayout.astro (slot + lastUpdated prop)
3. AuthLayout.astro (slot + noindex)
4. AdminLayout.astro (slot + noindex)
5. ToolLayout.astro (slot + configurable noindex)
6. SurveyFormLayout.astro (slot + noindex + airtableConfig)
7. SurveyLandingLayout.astro (slot + SEO props)
8. HubLayout.astro (default + hero slot, pageType prop)
9. FaqHubLayout.astro (slot + faqSchema)
10. FaqDetailLayout.astro (default + related slots, QA props)
11. CommentaryDetailLayout.astro (post object, markdown pipeline)
12. CourseDetailLayout.astro (course object)
13. LibraryDetailLayout.astro (article object, Highwire Press meta)
14. ComparisonLayout.astro (interface only -- reference implementation deferred until branch merge)
15. PillarLayout.astro (most complex: three-part JSON-LD, TOC, byline, editorial notice, back-to-top, PDF download)

Each layout must:
- Wrap BaseLayout with correct props
- Inject `<meta name="page-type" content="...">`
- Own all structural CSS for its type
- Emit correct JSON-LD schema from props
- Set data-pagefind-body and data-pagefind-ignore zones

### Step 1.2: Build verify-seo.mjs

Post-build script that reads dist/ HTML files and runs the 61-check proof gate.

- Read `<meta name="page-type">` to determine check tier
- Tier 1 (22 checks): all indexed pages
- Tier 2 (18 checks): type-specific schema validation
- Tier 3 (12 checks): AEO/GEO on pillar + FAQ only
- Tier 4 (5 checks): asset integrity
- Tier 5 (4 checks): site-level (once per build)
- Output: JSON report + console summary
- Exit 0 (non-blocking) initially
- Add `npm run verify:seo` script to package.json

### Step 1.3: Wire into CI

Add `verify-seo.mjs` to deploy.yml after verify-templates.mjs. Non-blocking (continue on failure, capture report as artifact).

---

## Phase 2: Reference Implementations (one page per layout)

For each layout, migrate ONE page. Process per page:

```
1. npx playwright test (baseline pass count, 3 viewports: 375/768/1280)
2. Screenshot page at 375px, 768px, 1280px
3. Migrate page to new layout
4. npx playwright test (verify same pass count)
5. Screenshot page at 375px, 768px, 1280px
6. Visual diff before/after
7. Run verify-seo.mjs on migrated page
8. Only proceed if steps 4-7 clean
```

**Reference pages:**
1. AuthLayout: /login
2. LegalLayout: /terms-of-use
3. AdminLayout: /admin/seo
4. ThankYouLayout: /donate/thank-you
5. ToolLayout: /ivf-success-calculator
6. SurveyLandingLayout: /endo-survey
7. SurveyFormLayout: /endo-survey/take
8. HubLayout: /commentary (then /commentary/page/[page])
9. FaqHubLayout: /faqs
10. FaqDetailLayout: /faqs/[slug]
11. CommentaryDetailLayout: /commentary/[slug]
12. LibraryDetailLayout: /library/[slug]
13. CourseDetailLayout: /courses/[slug]
14. PillarLayout: /naprotechnology
15. ComparisonLayout: deferred (blocks on feat/provider-detail-pages merge)

---

## Phase 3: Sibling Migrations

After each reference implementation passes, migrate remaining pages of that type:

- **Auth:** /signup, /forgot-password, /reset-password (3 pages)
- **Legal:** /privacy-policy, /medical-disclaimer (2 pages)
- **Admin:** remaining 5 admin pages
- **ThankYou:** /save-the-uterus-club/thank-you (1 page)
- **Hub:** /library, /library/page/[page], /courses (3 pages + pagination)
- **Pillar:** /what-is-rrm, /femm, /neofertility, /glossary, /common-questions-about-rrm (5 pages)

Same e2e baseline/verify process for each.

---

## Phase 4: Consolidation

- Flip verify-seo.mjs to blocking for new pages (exit 1 if a page not in previous build fails)
- Evaluate retiring verify-templates.mjs (once verify-seo.mjs covers all 42 of its checks)
- CSS audit: remove orphaned page-level styles that are now in layouts
- Document layout usage in CLAUDE.md and STYLE-GUIDE.md

---

## Dependencies

- ComparisonLayout reference implementation blocks on `feat/provider-detail-pages` branch merge
- Provider directory layouts deferred to separate project

## Risks

- **CSS specificity conflicts** during migration (scoped page styles vs layout styles). Mitigated by incremental migration + e2e.
- **Three-part JSON-LD mechanism** in PillarLayout is the most complex extraction. Start with simpler layouts to build confidence.
- **Pagination pages** share HubLayout but may have subtle differences. Test /library/page/2 and /commentary/page/2 explicitly.
