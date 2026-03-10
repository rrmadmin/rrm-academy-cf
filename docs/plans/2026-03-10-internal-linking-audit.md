# Internal Linking Audit -- rrmacademy.org

**Date**: 2026-03-10
**Method**: Source code analysis of all page templates, components (Header, Footer), and dynamic route files
**Structure Score**: 7/10

---

## Current State

**Note**: `/what-is-rrm/` is intentionally 302'd to `/faqs/what-is-restorative-reproductive-medicine-rrm/`. It is not a separate indexable page. All "What is RRM?" links correctly resolve to the FAQ version.

### Navigation Links

**Desktop header** (4 items): Library, Commentary, Courses, Join Us (CTA)
**Mobile nav** (9 items): FAQ, Courses, Commentary, What is RRM?, Library, Endo Survey, About, Join Us, Contact
**Footer** (11 items): FAQ, Courses, Commentary, What is RRM?, Library, Endo Survey, Account, About, Donate, Join Us, Contact + 3 legal pages

Desktop nav is significantly sparser than mobile. Several important pages only reachable via mobile nav or footer.

### Page-Level Inbound Links (excluding global nav)

| Page | Contextual Inbound Sources | Assessment |
|------|---------------------------|------------|
| `/library/` | Homepage (x3), About, Commentary hub, Donate | Well-linked |
| `/courses/` | Homepage (x2), About, FAQ hub, FAQ detail CTAs, Commentary hub | Well-linked |
| `/commentary/` | Homepage | Light |
| `/faqs/` (hub) | None outside global nav | Light |
| `/faqs/what-is-...-rrm/` | About, Homepage, common-questions page, 302 from /what-is-rrm/ | Adequate |
| `/endo-survey/` | Commentary hub CTA | Light |
| `/save-the-uterus-club/` | About | Light |
| `/donate/` | About | Light |
| `/about/` | None outside global nav | Light |
| `/contact/` | Courses FAQ, Donate | Adequate |
| `/common-questions-about-rrm/` | 302 -> `/faqs/` | Handled |

---

## Critical Issues

### 1. Commentary post template links only to other commentary posts

The template has a breadcrumb to `/commentary/` and a "More from this series" section showing up to 3 related posts (matched by Content Pillar via `getRelatedPosts` in `blog.ts`). Both are working on live pages.

However, all template-generated links stay within `/commentary/`. No cross-section links to courses, library, endo survey, or other site areas. Posts like "RRM Explained" have 18 external links and zero internal links in their Airtable content -- the only internal links come from the template's related posts section.

**Possible improvement**: Add a small cross-section CTA after the related posts:
- `/courses/` or a relevant course
- `/endo-survey/` (conditionally, for endo-related posts)
- `/library/`

This is a minor improvement, not a critical gap. The related posts section already provides meaningful internal linking.

### 3. Library article template -- adequate, minor improvement possible

**Not a dead end.** Verified live: library article pages include breadcrumb, topic tag links (filtered library views), and related article links. The template handles internal linking well already.

**Minor improvement**: Could add a single CTA link to `/commentary/` or `/courses/` since all outbound links stay within `/library/`. Low priority.

### 4. FAQ detail template lacks cross-links

`faqs/[...slug].astro` has breadcrumbs + CTA block (courses, library). No related FAQ cross-links.

**Fix**: Add a "Related questions" section with 2-3 other FAQ links.

### 5. `/about/` missing from desktop nav

Only accessible via mobile nav and footer. Important for E-E-A-T trust signals.

---

## Anchor Text Assessment (7/10)

**Good**:
- Homepage uses descriptive anchors: "Restorative Reproductive Medicine", "endometriosis", "natural conception"
- About page CTAs are descriptive

**Needs improvement**:
- `/library/` almost always anchored as "Research Library" or "library" -- no variety
- Commentary hub uses generic "View all posts"

---

## Implementation Plan

### Phase 1: Quick Fixes

| # | Task | Pages Affected | Effort |
|---|------|---------------|--------|
| 1 | Add cross-section CTA to commentary post template (courses, library, endo survey) | ~30 posts | Small |
| 2 | Add related-questions section to FAQ detail template | ~25 FAQs | Medium |

### Phase 2: Navigation Changes

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 5 | Add `/about/` to desktop nav | Medium -- E-E-A-T | Small |
| 6 | Consider dropdown/mega-menu mirroring mobile nav structure | High -- exposes full site | Medium-Large |

### Phase 3: Contextual Link Enrichment

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 7 | Cross-link commentary posts to specific library articles in Airtable Markdown | Medium -- bidirectional authority | Ongoing |
| 8 | Add `/save-the-uterus-club/` links in commentary CTA blocks and course pages | Low-Medium | Small |
| 9 | Add more contextual links to `/endo-survey/` from relevant pages | Medium | Small |

### Phase 4: Monitoring

- Re-crawl after Phase 1-2 to verify orphan count = 0
- Monitor commentary post exit rates after CTA block addition

---

## Biggest Wins (effort vs. impact)

1. **Cross-section CTA on commentary posts** -- Related posts already link within `/commentary/`, but no links out to courses/library/survey. Small template addition across ~30 posts.
2. **FAQ cross-links** -- Related questions section connects ~25 FAQ pages to each other. Medium effort.

Both library articles and commentary posts already have related-content linking (topic tags + related articles/posts). The gaps are smaller than initially assessed -- mostly cross-section links and nav visibility. No orphan pages exist (the `/common-questions-about-rrm/` page is already 302'd to `/faqs/`).
