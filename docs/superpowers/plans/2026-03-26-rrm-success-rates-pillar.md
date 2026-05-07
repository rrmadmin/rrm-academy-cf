# RRM Success Rates Pillar Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/rrm-success-rates/` pillar page synthesizing 13 published RRM outcomes studies into a narrative evidence page with interactive study table, FAQ schema, and IVF comparison section.

**Architecture:** Single Astro page at `src/pages/rrm-success-rates/index.astro` following the exact pattern of `/naprotechnology/` (BaseLayout, JSON-LD, BackToTop, PdfDownload). Content is static HTML with scoped styles. No new components except the study comparison table (inline, not extracted). All citations link to existing `/library/[slug]` pages.

**Tech Stack:** Astro 5.3, CSS custom properties (design system), JSON-LD structured data, FAQPage schema

**Spec:** `docs/superpowers/specs/2026-03-26-rrm-success-rates-pillar-design.md`

**Required reading before starting:**
- `STYLE-GUIDE.md` (design tokens, typography, spacing)
- `src/pages/naprotechnology/index.astro` (reference pillar page pattern)
- `src/pages/what-is-rrm/index.astro` (reference for Key Takeaways box, TOC, citation pattern)
- `src/pages/guides/index.astro` (guides index to update)

---

### Task 1: Create page file with JSON-LD schema

**Files:**
- Create: `src/pages/rrm-success-rates/index.astro`

This task creates the file with all frontmatter (imports, JSON-LD schema blocks, breadcrumb schema, FAQ schema) and the BaseLayout wrapper. No body content yet.

- [ ] **Step 1: Read reference files**

Read these files to understand exact patterns:
```
src/pages/naprotechnology/index.astro (full file)
src/pages/what-is-rrm/index.astro (lines 1-220 for schema pattern)
src/layouts/BaseLayout.astro (lines 1-30 for prop interface)
```

- [ ] **Step 2: Create the page file with schema frontmatter**

Create `src/pages/rrm-success-rates/index.astro` with:
- Imports: `BaseLayout`, `BackToTop`, `PdfDownload`
- `pageSchema`: `@type: ['Article', 'MedicalWebPage']` with all fields matching naprotechnology pattern
  - headline: "RRM Success Rates: What the Research Shows"
  - description: "Peer-reviewed RRM research reports live birth rates of 32% to 66%. Data from 13 studies across 8 countries. See how RRM compares to IVF."
  - datePublished: "2026-03-26"
  - wordCount: 5000 (estimate, update after content)
  - articleSection array matching the 8 sections from spec
  - hasPart array with anchor URLs for each section
  - citation array with all 13 studies as ScholarlyArticle
  - author: Dr. Whittaker `@id` reference (copy from naprotechnology)
  - publisher: RRM Academy `@id` reference
  - about: `@type: MedicalTherapy`, name: "Restorative Reproductive Medicine"
- `breadcrumbSchema`: Home > Guides > RRM Success Rates
- `faqSchema`: FAQPage with 7 questions from spec (schemaAnswer text for each, 1-2 sentences)
- BaseLayout wrapper with title, description, canonicalUrl, jsonLd props

- [ ] **Step 3: Verify the file parses**

Run: `cd ~/iCode/projects/rrm-academy-cf && npx astro check 2>&1 | tail -20`
Expected: No errors for the new file (warnings OK)

- [ ] **Step 4: Commit**

```bash
git add src/pages/rrm-success-rates/index.astro
git commit -m "feat: add rrm-success-rates pillar page skeleton with JSON-LD schema"
```

---

### Task 2: Write content -- Recognition section, Key Takeaways, and TOC

**Files:**
- Modify: `src/pages/rrm-success-rates/index.astro`

**Required reading before writing content:**
- Run `rrm-cli search "RRM success rates" --intent=voice --full --limit=5` to get voice/framing reference
- Read `docs/superpowers/specs/2026-03-26-rrm-success-rates-pillar-design.md` sections 1-2
- Read `docs/marketing/audience-personas.md` for Exhausted Patient and Values-Driven Couple messaging

**Editorial rules (read ALL feedback memories before writing):**
- Never use em dashes
- Never recommend IVF
- "Unexplained" often means "uninvestigated"
- Frame RRM vs IVF as "a different approach to a different question"
- Use rrm-cli as SSOT for stats -- do not cite from memory

This task adds the page body HTML inside the BaseLayout: mobile TOC (details/summary), desktop sticky TOC (nav), and the first two content sections.

- [ ] **Step 1: Read the what-is-rrm TOC and Key Takeaways HTML pattern**

Read `src/pages/what-is-rrm/index.astro` lines 350-420 for exact TOC HTML structure and lines 410-420 for the `<aside class="tldr">` pattern.

- [ ] **Step 2: Add the article-layout wrapper, mobile TOC, desktop TOC, and sections 1-2**

Inside the BaseLayout, add:
- `<div class="page-wrapper"><div class="container container--narrow">`
- Breadcrumb nav (inline JSON-LD script + visible breadcrumb)
- Mobile TOC: `<details class="mobile-toc">` with all 8 section links
- `<div class="article-layout">` containing desktop `<nav class="toc">` and `<article class="prose">`
- Section 1 (Recognition): H1, 1-2 empathetic sentences, bridge to evidence. No stats.
- Section 2 (Key Takeaways): `<aside class="tldr">` with 5 bold-lead bullet points from spec. Each stat has `<sup>` citation links.

All citation superscripts use `<sup><a href="#ref-N" id="cite-N">N</a></sup>` pattern matching what-is-rrm.

- [ ] **Step 3: Verify page renders**

Run: `cd ~/iCode/projects/rrm-academy-cf && npx astro build 2>&1 | grep -E "error|rrm-success" | head -10`
Expected: Page builds without errors

- [ ] **Step 4: Commit**

```bash
git add src/pages/rrm-success-rates/index.astro
git commit -m "feat: add recognition section, key takeaways, and TOC to rrm-success-rates"
```

---

### Task 3: Write content -- Evidence narrative sections (3a-3e)

**Files:**
- Modify: `src/pages/rrm-success-rates/index.astro`

**Required reading:**
- Run these rrm-cli commands to get accurate stats for each study:
  ```
  rrm-cli get article "natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa" --full
  rrm-cli get article "outcomes-from-treatment-of-infertility-with-natural-procreative-technology-in-an-recj7cwubt4vlyfjl" --full
  rrm-cli get article "natural-procreative-technology-for-infertility-and-recurrent-miscarriage-outcome-recmv6gf3xlcbt6ny" --full
  rrm-cli get article "healthy-singleton-pregnancies-from-restorative-reproductive-medicine-rrm-after-f-recior3akxtg2a6ya" --full
  rrm-cli get article "comprehensive-diagnostic-and-therapeutic-approach-to-male-factor-infertility-aime-8decfdf8" --full
  rrm-cli get article "restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd" --full
  rrm-cli get article "stratification-of-fertility-potential-according-to-cervical-mucus-symptoms-achie-recy9fpzmcvrv1x8z" --full
  ```
- Also read full text from R2 for key studies when extracting age-stratified or subgroup data:
  ```
  cd ~/iCode/projects/rrm-library-worker
  npx wrangler r2 object get rrm-assets/library/fulltext/<ARTICLE_ID>.md --pipe | head -c 10000
  ```

This is the largest task. Write 5 subsections, each weaving 2-3 studies into a patient-facing narrative with superscript citations.

- [ ] **Step 1: Write section 3a "Does RRM work for infertility?"**

Add `<h2 id="does-rrm-work">Does RRM Work for Infertility?</h2>` and 3-4 paragraphs synthesizing Sanchez-Mendez (1,310, 62.1%), JABFM (1,072, 52.8%), Canada (108, 66%), iNEST (834, 57%), Ukraine (282, 73.6%). Emphasize international replication. Each stat gets a superscript citation.

- [ ] **Step 2: Write section 3b "What if I've already tried IVF?"**

Add `<h2 id="after-ivf">What if I've Already Tried IVF?</h2>` and 2-3 paragraphs. Anchored by de Groot/Boyle 2018 (403, 32.1%, 92% full-term). Reference Andrology prior-ART subgroup (36%). Frame per VOC: "a different approach to a different question."

- [ ] **Step 3: Write section 3c "Does age matter?"**

Add `<h2 id="age">Does Age Matter?</h2>` and 2-3 paragraphs. Pull age-stratified data from Sanchez-Mendez and Andrology full texts. Be honest about over-40 limitations. Counter clock anxiety per VOC.

- [ ] **Step 4: Write section 3d "What about male factor infertility?"**

Add `<h2 id="male-factor">What About Male Factor Infertility?</h2>` and 2-3 paragraphs. Anchored by Grande/Andrology 2025 (87% treatable, idiopathic reduced to 8%, 40.9% pregnancy).

- [ ] **Step 5: Write section 3e "How long does it take?"**

Add `<h2 id="timeline">How Long Does It Take?</h2>` and 2-3 paragraphs. Boyle JRRM 12 months average. Marshell 77% within 6 months, 92.5% within 12. Compare to IVF timelines.

- [ ] **Step 6: Verify all citation anchors match reference list IDs**

Check that every `href="#ref-N"` in the narrative sections has a corresponding `id="ref-N"` that will be added in Task 5. Keep a running list of references 1-13.

- [ ] **Step 7: Commit**

```bash
git add src/pages/rrm-success-rates/index.astro
git commit -m "feat: add evidence narrative sections (3a-3e) to rrm-success-rates"
```

---

### Task 4: Write content -- Study comparison table, IVF comparison section, STORRM section

**Files:**
- Modify: `src/pages/rrm-success-rates/index.astro`

- [ ] **Step 1: Add the study comparison table (section 4)**

Add `<h2 id="study-table">Study Comparison Table</h2>` followed by a responsive HTML table. Columns: Study, Year, Country, N, Mean Female Age, Prior ART %, Mean Duration Trying, Outcome Metric, Rate, Journal. All 10 outcomes studies as rows (not the 2 ART risk studies or STORRM).

Each study name in the table links to its library detail page: `<a href="/library/[slug]">Study Name</a>`.

Use `<div class="table-responsive">` wrapper for horizontal scroll on mobile. Apply existing table styles from STYLE-GUIDE.md.

Populate every cell from rrm-cli data. Do NOT leave any cell as "N/A" if the data exists in the full text. Read R2 full texts to fill gaps.

- [ ] **Step 2: Add the IVF comparison section (section 5)**

Add `<h2 id="rrm-vs-ivf">How RRM Compares to IVF</h2>`. Frame per spec: "A different approach to a different question."

Write as a comparison table or side-by-side layout with 5 rows:
- Live birth rates
- Multiple pregnancy rates
- Preterm birth risk
- Cost
- Diagnostic value

Cite Sanders BMC 2022 and Stanford BJOG 2016 for the ART risk data. Use IVF per-cycle stats already cited in `/what-is-rrm/`.

- [ ] **Step 3: Add the STORRM section (section 6)**

Add `<h2 id="storrm">About the STORRM Registry</h2>`. 1-2 paragraphs explaining the ongoing international registry at University of Utah. Link to IIRRM STORRM page (`https://iirrm.org/STORRM`).

- [ ] **Step 4: Commit**

```bash
git add src/pages/rrm-success-rates/index.astro
git commit -m "feat: add study table, IVF comparison, and STORRM sections"
```

---

### Task 5: Write content -- FAQ section and References

**Files:**
- Modify: `src/pages/rrm-success-rates/index.astro`

- [ ] **Step 1: Add the FAQ section (section 7)**

Add `<h2 id="faq">Frequently Asked Questions</h2>`. 7 question/answer pairs matching the faqSchema defined in Task 1. Use the three-tier pattern:
- Full answer visible on page (paragraph with citations)
- `schemaAnswer` already in JSON-LD (Task 1)
- Wrap each Q&A in the same HTML pattern as `/naprotechnology/#faq`

Read the naprotechnology FAQ HTML to match the exact markup (likely `<div class="faq-item">` with `<h3>` question and `<div class="faq-answer">` body).

- [ ] **Step 2: Add the References section (section 8)**

Add `<h2 id="references">References</h2>`. Numbered list of all 13 studies in Vancouver citation format. Each reference has an `id="ref-N"` matching the superscript links. Each links to the library detail page.

Get Vancouver citations from rrm-cli:
```
rrm-cli get article "<slug>" --full | jq -r '.vancouver_citation'
```

For the 3 newly ingested articles that may not have Vancouver citations yet, construct manually from metadata.

- [ ] **Step 3: Add BackToTop and PdfDownload components**

After the closing `</article>`, add:
```astro
<BackToTop />
<PdfDownload title="RRM Success Rates" slug="rrm-success-rates" />
```

Match the exact placement from naprotechnology/index.astro.

- [ ] **Step 4: Verify all ref-N anchors match citations**

Grep the file for all `href="#ref-` and `id="ref-` to ensure 1:1 mapping. No orphaned citations.

- [ ] **Step 5: Commit**

```bash
git add src/pages/rrm-success-rates/index.astro
git commit -m "feat: add FAQ, references, BackToTop, and PdfDownload to rrm-success-rates"
```

---

### Task 6: Add scoped styles

**Files:**
- Modify: `src/pages/rrm-success-rates/index.astro`

- [ ] **Step 1: Read STYLE-GUIDE.md**

Read the full file to understand available design tokens, typography scale, spacing, and component patterns.

- [ ] **Step 2: Add `<style>` block**

Copy the scoped style block from `src/pages/naprotechnology/index.astro` as the starting point. It already has styles for:
- `.page-wrapper`, `.container--narrow`
- `.article-layout` (two-column with sticky TOC)
- `.toc` (desktop sticky nav)
- `.mobile-toc` (details/summary)
- `.prose` (article body typography)
- `.tldr` (Key Takeaways box)
- `.faq-item` (FAQ accordion if used)
- Citation superscript styles
- Responsive breakpoints

Add new styles only for:
- `.table-responsive` wrapper (horizontal scroll on mobile)
- Study comparison table styling (striped rows, sticky header if needed)
- IVF comparison layout (side-by-side or table)

Use only CSS custom properties from the design system. Never hardcode colors, spacing, or fonts.

- [ ] **Step 3: Test responsive layout**

Run: `cd ~/iCode/projects/rrm-academy-cf && npx astro dev`
Check at 375px, 768px, and 1200px widths. Verify:
- Mobile TOC works (details/summary toggle)
- Desktop TOC sticks on scroll
- Study table scrolls horizontally on mobile
- Key Takeaways box doesn't overflow

- [ ] **Step 4: Commit**

```bash
git add src/pages/rrm-success-rates/index.astro
git commit -m "style: add scoped styles for rrm-success-rates pillar page"
```

---

### Task 7: Update guides index and cross-links

**Files:**
- Modify: `src/pages/guides/index.astro`

- [ ] **Step 1: Add the new guide to the guides array**

In `src/pages/guides/index.astro`, add to the `guides` array (insert after "What is Restorative Reproductive Medicine?" entry):

```javascript
{
  title: 'RRM Success Rates',
  href: '/rrm-success-rates/',
  description: 'Published outcomes data from 13 peer-reviewed studies across 8 countries. Live birth rates, age-stratified results, outcomes after failed IVF, and how RRM compares to IVF.',
  author: 'Dr. Naomi Whittaker',
  readTime: '22 min read',
},
```

- [ ] **Step 2: Verify guides page renders**

Run: `cd ~/iCode/projects/rrm-academy-cf && npx astro build 2>&1 | grep -E "error|guides" | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/pages/guides/index.astro
git commit -m "feat: add RRM Success Rates to guides index"
```

---

### Task 8: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

```bash
cd ~/iCode/projects/rrm-academy-cf
WORKER_AUTH_TOKEN=$(op read 'op://Automation/<redacted>/credential') \
AIRTABLE_PAT=$(op read 'op://Automation/<redacted>/credential') \
npm run build 2>&1 | tail -20
```

Expected: Build completes. New page generated at `dist/rrm-success-rates/index.html`.

- [ ] **Step 2: Verify the page exists in dist**

```bash
ls -la dist/rrm-success-rates/index.html
wc -c dist/rrm-success-rates/index.html
```

Expected: File exists, ~50KB+ (substantial content page).

- [ ] **Step 3: Check JSON-LD is valid**

```bash
grep -o '"@type"' dist/rrm-success-rates/index.html | wc -l
```

Expected: Multiple @type entries (Article, MedicalWebPage, FAQPage, BreadcrumbList, Person).

- [ ] **Step 4: Check all citation links resolve**

```bash
# Extract all /library/ hrefs and check they exist in articles.json
grep -oP 'href="/library/[^"]+' dist/rrm-success-rates/index.html | sort -u | while read href; do
  slug=$(echo "$href" | sed 's|href="/library/||')
  if grep -q "$slug" src/data/articles.json; then
    echo "OK: $slug"
  else
    echo "BROKEN: $slug"
  fi
done
```

Expected: All OK, no BROKEN.

- [ ] **Step 5: Run guard check**

```bash
npm run guard
```

Expected: Pass (new page doesn't touch guarded files).

- [ ] **Step 6: Commit all remaining changes and push**

```bash
git add -A
git status  # verify only expected files
git commit -m "feat: complete rrm-success-rates pillar page"
git push origin main
```

Deploy triggers automatically on push.
