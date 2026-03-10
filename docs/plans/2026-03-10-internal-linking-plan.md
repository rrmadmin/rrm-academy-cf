# Internal Linking Plan -- rrmacademy.org

Created: 2026-03-10
Method: Source code analysis + live page verification
Structure Score: 7/10

---

## Corrections from Live Verification

Initial source-code-only analysis overstated the problem. These were wrong:

| Initial Claim | Reality |
|---------------|---------|
| `/common-questions-about-rrm/` is an orphan page | Already 302'd to `/faqs/`. Handled. |
| `/what-is-rrm/` is an under-linked pillar page | Already 302'd to FAQ version. Intentional temporary redirect. Not a separate indexable page. |
| Commentary post template is a "dead end" | Template has breadcrumb + "More from this series" (up to 3 related posts matched by Content Pillar). Working on live pages. |
| Library article template is a "dead end" | Template has breadcrumb + topic tag links + related article links (4 articles by topic/journal overlap). Well-linked within its section. |

Source code review alone was misleading. The related posts logic (`getRelatedPosts`) and library topic/related-article rendering weren't obvious from grepping `href="/"` patterns in the templates.

---

## What's Working Well

- **Library articles (3,200+ pages):** Breadcrumb, topic tag filter links, related article links. Good internal linking.
- **Commentary posts (~30 pages):** Breadcrumb, "More from this series" (up to 3 related posts via Content Pillar match). Some posts also have inline internal links from Airtable Markdown.
- **FAQ detail pages (~25 pages):** Breadcrumb, CTA block linking to courses and library. Library references section links to supporting articles.
- **Homepage:** Links to library (x3), courses (x2), specific FAQ, specific courses, Naomi spotlight.
- **About page:** Links to library, courses, STUC, Naomi spotlight, FAQ slug.
- **What-is-RRM content (lives at FAQ slug):** Extensive outbound links to courses, library, commentary, endo survey, contact, donate, specific library articles.
- **No orphan pages:** Both `/common-questions-about-rrm/` and `/what-is-rrm/` are 302'd.

---

## Real Gaps

### 1. Commentary posts only link within /commentary/

The "More from this series" section connects commentary posts to each other. But the template adds zero cross-section links to courses, library, or endo survey. Posts that lack inline internal links in their Airtable Markdown (like "RRM Explained" -- 18 external links, zero internal) rely entirely on the related posts section.

**Fix:** Small CTA block after related posts with links to `/courses/`, `/library/`, and conditionally `/endo-survey/`.

### 2. FAQ detail pages don't cross-link to other FAQs

Each FAQ stands alone. No "Related questions" section connecting them to each other.

**Fix:** Add 2-3 related FAQ links per page (match by category).

### 3. Desktop nav is sparse (4 items vs 9+ on mobile)

Desktop hides: About, FAQ, Endo Survey. Mobile nav already has a good Education/Help grouping. `/about/` is particularly important for E-E-A-T signals.

**Fix:** Add About to desktop nav at minimum. Consider dropdown mirroring mobile structure.

### 4. Several pages have light contextual (non-nav) inbound links

| Page | Contextual Sources (outside header/footer) |
|------|---------------------------------------------|
| /commentary/ | Homepage (1 link) |
| /faqs/ hub | None |
| /endo-survey/ | Commentary hub CTA only |
| /donate/ | About page only |
| /save-the-uterus-club/ | About page only |
| /about/ | None |

These pages get traffic through global nav but have few contextual body links pointing to them from other pages.

---

## Hub-and-Spoke Clusters

### Cluster 1: Endometriosis (strongest topic, most content)

**Hub:** `/faqs/what-conditions-does-rrm-address/`

| Type | Pages |
|------|-------|
| Commentary | why-does-endometriosis-happen, uterine-isthmocele-csection-scar-restorative-care, understanding-endometriosis-early-diagnosis, nine-years-too-long-rrm-endo-symptom-survey, endometriosis-medical-trauma-resources |
| Courses | masterclass-in-endometriosis-and-surgery, long-term-endometriosis-management |
| Tool | /endo-survey/ |
| Library | /library/?topic=Endometriosis |

Links to add:
- Each endo commentary post links to endo courses + endo survey + library topic filter
- Endo survey page links to "Nine Years Too Long" post + endo courses
- Course landing pages link to supporting commentary posts + library filter
- Hub FAQ links to all spokes

### Cluster 2: Infertility & Conception

**Hub:** `/faqs/how-is-rrm-different-from-ivf-iui/`

| Type | Pages |
|------|-------|
| Commentary | secondary-infertility-csection-fertility-case-study, napro-surgery-restorative-approach |
| Courses | rrm-vs-ivf |
| FAQs | what-are-success-rates-for-napro-rrm, how-much-does-rrm-napro-cost-vs-ivf, does-insurance-cover-napro-rrm, how-long-before-pregnancy, how-does-rrm-handle-male-factor, what-does-natural-conception-mean, how-does-rrm-approach-recurrent-miscarriage, does-fertility-fall-off-cliff-at-35 |
| Library | /library/?topic=Infertility |

### Cluster 3: What is RRM? (foundational, entry-point)

**Hub:** `/faqs/what-is-restorative-reproductive-medicine-rrm/`

| Type | Pages |
|------|-------|
| Pages | /what-is-rrm/ (302s to this hub), /common-questions-about-rrm (302s to /faqs/), /about/ |
| Commentary | rrm-explained-answers-true-healing, glossary-restorative-reproductive-medicine |
| Courses | rrm-vs-ivf |
| FAQs | what-is-naprotechnology-creighton-model, is-rrm-evidence-based, why-havent-i-heard-of-rrm, do-i-need-to-be-catholic |
| Library | /library/ (general) |

Note: Both redirect pages already funnel into this cluster. The hub FAQ page itself has extensive outbound links. Main gap is inbound contextual links from other content types.

### Cluster 4: Postpartum & Hormones

**Hub:** `/courses/postpartum-depression-anxiety-restorative-approach/`

| Type | Pages |
|------|-------|
| Commentary | healing-postpartum-depression-anxiety-naturally |
| Courses | hormones-through-the-lifespan |
| FAQs | what-is-rrms-stance-on-thyroid-fertility, how-does-infertility-affect-mental-health |
| Library | /library/?topic=Hormones |

### Cluster 5: Physician Authority (E-E-A-T)

**Hub:** `/about/`

| Type | Pages |
|------|-------|
| Spotlights | rrm-spotlight-naomi-whittaker-md, rrm-spotlight-phil-boyle-md, rrm-spotlight-patrick-yeung-md |
| FAQs | how-do-i-find-an-rrm-clinician |
| Courses | (each taught by a spotlight physician) |

### Cluster 6: PCOS (thin -- needs content to strengthen)

**Hub:** `/faqs/is-letrozole-first-line-anovulatory-pcos-rrm/`

| Type | Pages |
|------|-------|
| Commentary | understanding-pcos-personal-journey |
| Library | /library/?topic=PCOS |
| GAP | No dedicated course |

---

## Template-Level Changes

These create cross-section links at scale. Each content type currently links within its own type but not across.

### 1. Commentary post template (`src/pages/commentary/[...slug].astro`)

Add cross-section CTA block after "More from this series":

| Section | Logic | Display |
|---------|-------|---------|
| **Cross-section CTA** | Static links to `/courses/`, `/library/`. Conditionally show `/endo-survey/` for endo-pillar posts | Small styled block with 2-3 links |

Note: The original plan proposed related research (3-5 library articles by keyword match) and related FAQs. Those are higher-effort. The CTA block alone closes the biggest gap -- commentary linking out to other sections at all.

### 2. FAQ template (`src/pages/faqs/[...slug].astro`)

| Change | Current | Proposed |
|--------|---------|----------|
| **Related questions** | None | 2-3 related FAQs matched by category |
| Course CTA | Generic `/courses/` | Specific course matched by FAQ category via mapping table |
| Library CTA | Generic `/library/` | Library topic filter URL matched by FAQ category |

### 3. Course landing page (`src/pages/courses/[slug].astro`)

| Section | Logic | Display |
|---------|-------|---------|
| **Background reading** | 2-3 commentary posts matched by topic | BlogCard list |
| **Supporting research** | Link to library topic filter | Styled link/button |

### 4. Library article template (`src/pages/library/[...slug].astro`)

| Section | Logic | Display |
|---------|-------|---------|
| **Commentary on this topic** | Match article topics to blog `contentPillar`. Show 2-3 posts | BlogCard list |

Lower priority -- library articles already have good within-section linking.

---

## Content Pillar to Topic Mapping

Powers the cross-content matching in templates above.

| Content Pillar (blog) | FAQ Category | Library Topic | Courses |
|----------------------|--------------|---------------|---------|
| Education - Endometriosis | Condition-Specific | Endometriosis | masterclass-in-endo, long-term-endo |
| Education - NaPro/RRM | Foundational | NaProTECHNOLOGY | rrm-vs-ivf, functional-lab-testing |
| Education - PCOS | Condition-Specific | PCOS | (none) |
| Education - Cycle Literacy | Foundational | Hormones & Cycle | hormones-through-lifespan, fertility-based-methods |
| Personal/Practice | (none) | (none) | (none) |
| Systems Critique | Common Concerns | (none) | (none) |
| Research Highlight | (all) | (all topics) | (none) |
| Empowerment | Common Concerns | (none) | (none) |

---

## Quick Wins (manual, no template changes)

### 1. Endo survey page (`/endo-survey/index.astro`)
Add contextual links:
- "Why we built this" -> `/commentary/nine-years-too-long-rrm-endo-symptom-survey/`
- "Learn about endometriosis" -> `/courses/masterclass-in-endometriosis-and-surgery/`
- "Research on endo" -> `/library/?topic=Endometriosis`

### 2. "Nine Years Too Long" post (Airtable Content field)
Ensure inline link to `/endo-survey/take`.

### 3. Desktop nav
Add `/about/` at minimum for E-E-A-T. Consider dropdown matching mobile Education/Help grouping.

---

## Priority Order

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 1 | Commentary template: cross-section CTA block | Medium (30 posts gain links to courses/library/survey) | Small |
| 2 | FAQ template: related questions + smart CTAs | Medium (25 FAQs cross-link + get targeted CTAs) | Medium |
| 3 | Desktop nav: add About | Medium (E-E-A-T) | Small |
| 4 | Quick wins (endo survey links, blog post link) | Low-Medium | Small |
| 5 | Course template: background reading + research link | Medium (10 courses) | Low |
| 6 | Library template: commentary section | Medium (3,200 articles) | Medium |
| 7 | Desktop nav: dropdown matching mobile structure | High (full site visible on desktop) | Medium-Large |

---

## Bottom Line

The site's internal linking is in better shape than a template-only review suggested. Library and commentary templates both have working related-content sections. The main gap is **cross-section linking**: commentary posts link to other commentary, library articles link to other library articles, but neither links across to courses, the endo survey, or each other. The desktop nav hiding half the site is the other notable issue.

The FAQ template's "Library references" section is the existing pattern to extend -- reuse that component approach for new cross-content sections.
