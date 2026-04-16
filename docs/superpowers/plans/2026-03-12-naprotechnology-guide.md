# NaProTechnology Guide Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the page infrastructure for `/naprotechnology/` -- a guide page that captures the NaPro search cluster (6,596 impressions/month, 100 queries). Brian/Naomi write the clinical content; this plan builds the scaffold, schema, routing, and internal links.

**Architecture:** Static Astro page following the exact same pattern as `/what-is-rrm/index.astro` (BaseLayout, sticky TOC sidebar, `.article-layout` grid, `.table-wrap` tables). Three separate JSON-LD blocks (MedicalWebPage, FAQPage, BreadcrumbList) instead of the `@graph` approach used in what-is-rrm. Content placeholders marked with `<!-- CONTENT: section-name -->` for Brian/Naomi to fill.

**Tech Stack:** Astro 5.3, BaseLayout, global.css (existing styles), rrm-router (ASTRO_ROUTES)

**Spec:** `docs/superpowers/specs/2026-03-12-naprotechnology-guide-design.md`

---

## Chunk 1: Page Scaffold and Schema

### Task 1: Create page file with frontmatter and JSON-LD

**Files:**
- Create: `src/pages/naprotechnology/index.astro`
- Reference: `src/pages/what-is-rrm/index.astro` (pattern to follow)
- Reference: `src/layouts/BaseLayout.astro` (props interface)

- [ ] **Step 1: Create the page with JSON-LD blocks**

The page needs three separate JSON-LD blocks per the spec (not `@graph`). BaseLayout's `jsonLd` prop handles block 1. Blocks 2-3 go as inline `<script>` tags in the page body (valid per schema.org spec).

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

// Block 1: MedicalWebPage + Article (injected via BaseLayout jsonLd prop)
const pageSchema = {
  '@context': 'https://schema.org',
  '@type': ['Article', 'MedicalWebPage'],
  headline: 'What is NaProTechnology? A Complete Guide to Natural Procreative Technology',
  description: 'NaProTechnology uses the Creighton Model to diagnose and treat infertility, endometriosis, and PCOS. Learn how NaPro works, find a provider, compare costs.',
  image: 'https://rrmacademy.org/images/og-default.png',
  author: {
    '@type': 'Person',
    '@id': 'https://rrmacademy.org/#naomi-whittaker',
    name: 'Naomi Whittaker, MD',
    jobTitle: 'Board-Certified OBGYN, NaProTechnology Fellow',
  },
  publisher: {
    '@type': 'EducationalOrganization',
    '@id': 'https://rrmacademy.org/#organization',
    name: 'RRM Academy',
  },
  datePublished: '2026-03-12',
  dateModified: '2026-03-12',
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': 'https://rrmacademy.org/naprotechnology/',
  },
  about: {
    '@type': 'MedicalTherapy',
    name: 'NaProTechnology',
    alternateName: 'Natural Procreative Technology',
  },
  articleSection: [
    'What is NaProTechnology?',
    'How NaProTechnology Works',
    'Conditions NaPro Treats',
    'NaPro Surgery',
    'Who is NaPro For?',
    'NaPro vs IVF',
    'How to Find a NaPro Provider',
    'Cost and Insurance',
    'Frequently Asked Questions',
    'References',
  ],
  hasPart: [
    { '@type': 'WebPageElement', name: 'What is NaProTechnology?', url: 'https://rrmacademy.org/naprotechnology/#what-is-naprotechnology' },
    { '@type': 'WebPageElement', name: 'How NaProTechnology Works', url: 'https://rrmacademy.org/naprotechnology/#how-napro-works' },
    { '@type': 'WebPageElement', name: 'Conditions NaPro Treats', url: 'https://rrmacademy.org/naprotechnology/#conditions' },
    { '@type': 'WebPageElement', name: 'NaPro Surgery', url: 'https://rrmacademy.org/naprotechnology/#napro-surgery' },
    { '@type': 'WebPageElement', name: 'Who is NaPro For?', url: 'https://rrmacademy.org/naprotechnology/#who-is-napro-for' },
    { '@type': 'WebPageElement', name: 'NaPro vs IVF', url: 'https://rrmacademy.org/naprotechnology/#napro-vs-ivf' },
    { '@type': 'WebPageElement', name: 'How to Find a NaPro Provider', url: 'https://rrmacademy.org/naprotechnology/#find-provider' },
    { '@type': 'WebPageElement', name: 'Cost and Insurance', url: 'https://rrmacademy.org/naprotechnology/#cost-insurance' },
    { '@type': 'WebPageElement', name: 'Frequently Asked Questions', url: 'https://rrmacademy.org/naprotechnology/#faq' },
    { '@type': 'WebPageElement', name: 'References', url: 'https://rrmacademy.org/naprotechnology/#references' },
  ],
  citation: [
    {
      '@type': 'ScholarlyArticle',
      name: 'RRM Outcomes Compared to IVF for the Treatment of Infertility',
      author: 'Boyle P, Toth A, Minjeur M, Turczynski C',
      datePublished: '2025',
      isPartOf: { '@type': 'Periodical', name: 'Journal of Restorative Reproductive Medicine' },
    },
    {
      '@type': 'ScholarlyArticle',
      name: 'Natural Procreative Technology (NaProTechnology) for Infertility: Take-Home Baby Rate and Clinical Outcomes in a 5-Year Single-Center Cohort of 1,310 Couples',
      author: 'Sanchez-Mendez JI, et al.',
      datePublished: '2025',
      isPartOf: { '@type': 'Periodical', name: 'Frontiers in Reproductive Health' },
    },
  ],
};

// Block 2: BreadcrumbList (inline in page body)
const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rrmacademy.org/' },
    { '@type': 'ListItem', position: 2, name: 'NaProTechnology', item: 'https://rrmacademy.org/naprotechnology/' },
  ],
};

// Block 3: FAQPage -- OMITTED from scaffold commit.
// Add this block in Chunk 3 (Task 5 Step 3) when FAQ content is finalized.
// Placeholder text in JSON-LD would fail Google Rich Results validation.
// Structure when added:
// const faqSchema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [...] };
const faqSchema = null; // Set to object in Chunk 3
---
```

- [ ] **Step 2: Add the page HTML structure**

Below the frontmatter, add the full page shell. This follows the exact pattern from `what-is-rrm/index.astro`:

```astro
<BaseLayout
  title="What is NaProTechnology? Complete Guide to Natural Procreative Technology"
  description="NaProTechnology uses the Creighton Model to diagnose and treat infertility, endometriosis, and PCOS. Learn how NaPro works, find a provider, compare costs."
  canonicalUrl="https://rrmacademy.org/naprotechnology/"
  ogType="article"
  publishDate="2026-03-12"
  jsonLd={pageSchema}
>
  <!-- Separate JSON-LD blocks (not @graph) per spec -->
  <script type="application/ld+json" set:html={JSON.stringify(breadcrumbSchema)} />
  {faqSchema && (
    <script type="application/ld+json" set:html={JSON.stringify(faqSchema)} />
  )}

  <div class="page-wrapper" data-pagefind-body>
    <span data-pagefind-meta="type:Guide" style="display:none"></span>
    <span data-pagefind-meta="title:What is NaProTechnology? A Complete Guide" style="display:none"></span>
    <div class="container">

      <!-- Breadcrumb -->
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true"> &rsaquo; </span>
        <span>NaProTechnology</span>
      </nav>

      <h1>NaProTechnology: A Complete Guide</h1>

      <p class="author-byline">
        By <strong><a href="/commentary/rrm-spotlight-naomi-whittaker-md/">Naomi Whittaker, MD</a></strong>, Board-Certified OBGYN and NaProTechnology Fellow
        <br><time datetime="2026-03-12">Last updated March 2026</time>
      </p>

      <!-- Mobile TOC -->
      <details class="toc-mobile">
        <summary>On this page</summary>
        <ol>
          <li><a href="#what-is-naprotechnology">What is NaProTechnology?</a></li>
          <li><a href="#how-napro-works">How NaProTechnology Works</a></li>
          <li><a href="#conditions">Conditions NaPro Treats</a></li>
          <li><a href="#napro-surgery">NaPro Surgery</a></li>
          <li><a href="#who-is-napro-for">Who is NaPro For?</a></li>
          <li><a href="#napro-vs-ivf">NaPro vs IVF</a></li>
          <li><a href="#find-provider">How to Find a NaPro Provider</a></li>
          <li><a href="#cost-insurance">Cost and Insurance</a></li>
          <li><a href="#faq">Frequently Asked Questions</a></li>
          <li><a href="#references">References</a></li>
        </ol>
      </details>

      <!-- Article layout: sidebar TOC + main content -->
      <div class="article-layout">

        <!-- Desktop TOC (sticky sidebar, 1024px+) -->
        <nav class="toc" aria-label="Table of contents">
          <p class="toc-heading">On this page</p>
          <ol>
            <li><a href="#what-is-naprotechnology">What is NaProTechnology?</a></li>
            <li><a href="#how-napro-works">How NaProTechnology Works</a></li>
            <li><a href="#conditions">Conditions NaPro Treats</a></li>
            <li><a href="#napro-surgery">NaPro Surgery</a></li>
            <li><a href="#who-is-napro-for">Who is NaPro For?</a></li>
            <li><a href="#napro-vs-ivf">NaPro vs IVF</a></li>
            <li><a href="#find-provider">How to Find a NaPro Provider</a></li>
            <li><a href="#cost-insurance">Cost and Insurance</a></li>
            <li><a href="#faq">Frequently Asked Questions</a></li>
          </ol>
        </nav>

        <!-- Main content -->
        <article class="prose">

          <!-- Section 1: What is NaProTechnology? -->
          <section id="what-is-naprotechnology">
            <h2>What is NaProTechnology?</h2>
            <!-- CONTENT: opening-definition -->
            <!-- Source: what-is-rrm "What Is RRM?" + "A Brief History", FAQ F04, ebook Facts 1-2 -->
            <!-- Must mention Creighton Model alongside NaPro (two halves of one system) -->
            <!-- Include: 3-step flow from ebook (Chart, Diagnose, Treat) -->
            <!-- Include: brief history (Hilgers, Creighton 1976, PPVI 1985, IIRRM 2000) -->
            <!-- CROSS-LINK: when /what-is-rrm/ publishes, add "NaPro is one approach within the broader field of RRM" with link -->
          </section>

          <!-- Section 2: How NaProTechnology Works -->
          <section id="how-napro-works">
            <h2>How NaProTechnology Works</h2>
            <!-- CONTENT: how-napro-works -->
            <!-- Source: what-is-rrm "How RRM Diagnosis Works", FAQ F08, ebook Facts 2 + 5 -->
            <!-- Include: daily charting, provider reads chart like EKG, targeted diagnostics -->
            <!-- Include: both partners evaluated (couple-centered model) -->
          </section>

          <!-- Section 3: Conditions NaPro Treats -->
          <section id="conditions">
            <h2>Conditions NaPro Treats</h2>
            <!-- CONTENT: conditions-list + conditions-treatment-table -->
            <!-- Source: ebook Facts 4 + 6, what-is-rrm condition sections, FAQ F03 -->
            <!-- Table goes in .table-wrap div for mobile scroll -->
            <!-- PCOS: remove "ovarian wedge resection" from ebook. FLAG: letrozole positioning needs Naomi review -->
            <!-- Endometriosis: excision, not ablation -->
            <!-- PPD: bio-identical progesterone -->
            <!-- LINK: condition FAQs when published (e.g. /faqs/endometriosis-treatment/) -->
            <!-- LINK: relevant FAQ detail pages (/faqs/what-conditions-does-rrm-treat/) -->

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Condition</th>
                    <th>NaPro Approach</th>
                  </tr>
                </thead>
                <tbody>
                  <!-- CONTENT: condition-treatment-rows -->
                </tbody>
              </table>
            </div>
          </section>

          <!-- Section 4: NaPro Surgery -->
          <section id="napro-surgery">
            <h2>NaPro Surgery</h2>
            <!-- CONTENT: napro-surgery -->
            <!-- Source: NaPro surgery commentary article, what-is-rrm surgery sections -->
            <!-- Include: excision-based, fertility-preserving -->
            <!-- LINK: /commentary/naprotechnology-surgery-... (NaPro surgery commentary) -->
            <!-- LINK: /courses/[masterclass-slug]/ (masterclass course CTA) -->
          </section>

          <!-- Section 5: Who is NaPro For? -->
          <section id="who-is-napro-for">
            <h2>Who is NaPro For?</h2>
            <!-- CONTENT: who-is-napro-for -->
            <!-- Source: ebook Fact 3, FAQ F14, what-is-rrm "RRM After Failed IVF" -->
            <!-- Include: audience list from ebook (updated language) -->
            <!-- Include: "Do I need to be Catholic?" (no) -->
            <!-- Include: NaPro after failed IVF (Boyle et al. 2022 case) -->
          </section>

          <!-- Section 6: NaPro vs IVF -->
          <section id="napro-vs-ivf">
            <h2>NaPro vs IVF</h2>
            <!-- CONTENT: napro-vs-ivf -->
            <!-- Source: what-is-rrm "RRM vs. IVF", FAQ F02, FAQ F20, FAQ F16 -->
            <!-- Balanced framing: "RRM is its own paradigm, not defined in opposition to IVF" -->
            <!-- Do NOT use old ebook Fact 8 chart (popepaulvi.com source) -->
            <!-- LINK: /courses/[rrm-vs-ivf-slug]/ (RRM vs IVF course) -->

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>NaProTechnology</th>
                    <th>IVF</th>
                  </tr>
                </thead>
                <tbody>
                  <!-- CONTENT: comparison-table-rows -->
                  <!-- Success rates: NaPro 26-41% crude LBR, 50-62% adjusted cumulative (Boyle 2025, Sanchez-Mendez 2025 n=1,310) -->
                  <!-- IVF: ~30% per fresh cycle (CDC data) -->
                  <!-- Cost: IVF costs $15K-$30K/cycle ($40-60K+ total). RRM treatments often covered by standard insurance. Do NOT use "20x" multiplier (hallucinated) -->
                </tbody>
              </table>
            </div>
          </section>

          <!-- Section 7: How to Find a NaPro Provider -->
          <section id="find-provider">
            <h2>How to Find a NaPro Provider</h2>
            <!-- CONTENT: find-provider -->
            <!-- Source: what-is-rrm "How to Get Started", FAQ F15 -->
            <!-- V1: external directory links only (no local provider schema) -->
            <!-- LINK: iirrm.org provider directory (external, primary) -->
            <!-- LINK: fertilitycare.org (external, Creighton instruction) -->
            <!-- LINK: naturalwomanhood.org (external, directory) -->
            <!-- LINK: /faqs/[F15-slug]/ (FAQ on finding a provider) -->
            <!-- Virtual/telehealth options -->
            <!-- "What to ask when choosing a provider" guidance -->
          </section>

          <!-- Section 8: Cost and Insurance -->
          <section id="cost-insurance">
            <h2>Cost and Insurance</h2>
            <!-- CONTENT: cost-insurance -->
            <!-- Source: FAQ F16, FAQ F17, what-is-rrm cost section -->
            <!-- Most NaPro treatments coded under standard insurance -->
            <!-- Cost comparison vs IVF: anchoring (IVF $40-60K+ total, RRM a fraction). Do NOT use "20x" figure -->
          </section>

          <!-- Section 9: Frequently Asked Questions -->
          <section id="faq">
            <h2>Frequently Asked Questions</h2>
            <!-- CONTENT: faq-section -->
            <!-- Pull from: F04, F05, F14 published answers -->
            <!-- Include: "Is NaPro the same as RRM?" from what-is-rrm -->
            <!-- These Q&As must match the FAQPage schema block (added in Chunk 3) -->
            <!-- LINK: /faqs/[F04-slug]/, /faqs/[F05-slug]/, /faqs/[F14-slug]/ (FAQ detail pages) -->

            <dl class="faq-list">
              <!-- CONTENT: faq-items as dt/dd pairs -->
            </dl>
          </section>

          <!-- Section 10: References -->
          <section id="references">
            <h2>References</h2>
            <!-- Numbered reference list. Each entry links to the article's external URL (DOI/PubMed). -->
            <!-- Inline citations in body sections use <sup><a href="#ref-N">N</a></sup> linking to /library/[slug]/ -->
            <!-- This section uses <a id="ref-N"> anchors so inline sups can link down here too -->
            <!-- Known articles to cite (all in RRM Library): -->
            <!-- ref-1: Boyle 2025 (RRM outcomes vs IVF) - used in sections 6, 5 -->
            <!-- ref-2: Sanchez-Mendez 2025 (NaPro 1,310 couples) - used in section 6 -->
            <!-- ref-3: Katz 2011 (cost comparison 20x) - used in sections 6, 8 -->
            <!-- ref-4: Boyle et al. 2022 (NaPro after 16 years infertility) - used in section 5 -->
            <!-- Additional refs TBD during content drafting -->
            <ol class="references">
              <!-- CONTENT: reference-items -->
              <!-- Format: <li id="ref-N"><a href="/library/[slug]/">[Author] ([Year])</a>. Title. <em>Journal</em>. <a href="https://doi.org/...">[DOI]</a></li> -->
            </ol>
          </section>

        </article>
      </div>
    </div>
  </div>
</BaseLayout>

<style>
  /* Page-specific styles -- most styling comes from global.css (.article-layout, .toc, .breadcrumb, .table-wrap, .prose) */
  /* .author-byline inherits from global.css (same pattern as what-is-rrm) */

  .references {
    font-size: 0.875rem;
    line-height: 1.7;
    color: var(--text-secondary);
  }

  .references li {
    margin-bottom: var(--space-3);
  }

  .faq-list dt {
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--text-primary);
    margin-top: var(--space-6);
    margin-bottom: var(--space-2);
  }

  .faq-list dd {
    margin-left: 0;
    color: var(--text-secondary);
    line-height: 1.7;
    margin-bottom: var(--space-4);
  }
</style>
```

- [ ] **Step 3: Verify local build**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build`
Expected: Build succeeds. Page generated at `dist/naprotechnology/index.html`.

- [ ] **Step 4: Commit scaffold**

```bash
git add src/pages/naprotechnology/index.astro
git commit -m "feat: add /naprotechnology/ guide page scaffold

Infrastructure for NaPro guide page. Content placeholders for
Brian/Naomi to fill. Three separate JSON-LD blocks (MedicalWebPage,
FAQPage, BreadcrumbList). Sticky TOC sidebar, mobile TOC, comparison
tables, FAQ section.
"
```

---

### Task 2: Add route to rrm-router

**Files:**
- Modify: `~/iCode/projects/rrm-router/src/index.js:73` (after `/what-is-rrm` line)
- Reference: `~/iCode/projects/rrm-router/test/router.test.js`

- [ ] **Step 1: Add `/naprotechnology` to ASTRO_ROUTES**

In `~/iCode/projects/rrm-router/src/index.js`, add after line 74 (`'/common-questions-about-rrm'`):

```js
  '/naprotechnology',       // SEO — NaPro guide page
```

- [ ] **Step 2: Run router tests**

Run: `cd /Users/brian/iCode/projects/rrm-router && node test/router.test.js`
Expected: All tests pass. The new route is picked up by the `shouldRouteToAstro` function automatically.

- [ ] **Step 3: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-router
git add src/index.js
git commit -m "feat: add /naprotechnology route to ASTRO_ROUTES

Routes NaPro guide page traffic to Astro instead of Wix proxy.
"
```

- [ ] **Step 4: Deploy router**

Run: `cd /Users/brian/iCode/projects/rrm-router && npx wrangler deploy`
Expected: Worker deployed. Route active immediately.

**Note:** Deploy the router AFTER the Astro site deploys with the new page, or visitors will get a 404 from the Astro side. Sequence: push rrm-academy-cf to main first, wait for CF Pages deploy, then deploy router.

---

## Chunk 2: Internal Linking and SEO Monitor

### Task 3: Update internal links pointing TO the guide

**Files:**
- Modify: `src/pages/faqs/[...slug].astro` (add contextual link to /naprotechnology/ for NaPro-related FAQs)
- Reference: Published FAQ slugs that should link to the guide (F04, F14)

- [ ] **Step 1: Identify link insertion points**

Read these files to find where to add contextual links:
- `src/pages/faqs/[...slug].astro` -- check if there's a "Related" or "Learn more" section
- The NaPro surgery commentary post -- check its slug and template

The spec says to update:
- FAQ F04 published answer: add link to /naprotechnology/
- FAQ F14 published answer: add link to /naprotechnology/
- NaPro surgery commentary: add link to /naprotechnology/

**Important:** FAQ and commentary content lives in Airtable, not in source files. These link additions must be made in Airtable (Content field for blog, publishedAnswer for FAQs), then a rebuild triggered. This is a manual Brian task, not a code change.

- [ ] **Step 2: Document the Airtable updates needed**

Create a checklist for Brian in the spec or as a comment. The changes are:
1. FAQ F04 (What is NaProTechnology?): Add "Read our complete [NaProTechnology guide](/naprotechnology/) for more detail." to publishedAnswer
2. FAQ F14 (Do I need to be Catholic?): Add "Learn more in our [NaProTechnology guide](/naprotechnology/#who-is-napro-for)." to publishedAnswer
3. NaPro surgery commentary: Add "For a broader overview of NaProTechnology, see our [complete NaPro guide](/naprotechnology/)." near the end

- [ ] **Step 3: Commit documentation update**

If the checklist was added to the spec file:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add docs/superpowers/specs/2026-03-12-naprotechnology-guide-design.md
git commit -m "docs: add internal linking checklist for NaPro guide

Airtable content updates needed after guide publishes: FAQ F04, F14,
and NaPro surgery commentary.
"
```

---

### Task 4: Add provider directory URLs to SEO monitor allowlist

**Files:**
- Modify: `~/iCode/projects/rrm-seo-monitor/src/crawler.js` (external allowlist)

- [ ] **Step 1: Read the crawler allowlist**

Read `~/iCode/projects/rrm-seo-monitor/src/crawler.js` and find the external domain allowlist. The guide links to three external directories that should be monitored for broken links:
- `iirrm.org` (IIRRM provider directory)
- `fertilitycare.org` (FertilityCare Centers of America)
- `naturalwomanhood.org` (Natural Womanhood directory)

- [ ] **Step 2: Add domains to allowlist**

Add the three domains to the external allowlist array if not already present.

- [ ] **Step 3: Commit**

```bash
cd /Users/brian/iCode/projects/rrm-seo-monitor
git add src/crawler.js
git commit -m "feat: add NaPro provider directory domains to crawl allowlist

Monitor iirrm.org, fertilitycare.org, naturalwomanhood.org for broken
links from the /naprotechnology/ guide page.
"
```

---

## Chunk 3: Content Drafting (Gianna Agent)

### Task 5: Draft guide content from source material

**This task uses the Gianna copywriting agent.** It drafts content from verified source material for Brian's review. Brian/Naomi make all final editorial decisions.

**Files:**
- Create: `docs/content-drafts/naprotechnology-guide-draft.md`
- Reference (read-only): `src/pages/what-is-rrm/index.astro` (source material for sections 1-8)
- Reference (read-only): `~/Downloads/9 Facts About NaPro...pdf` (ebook source material)
- Reference (read-only): Airtable FAQ published answers (F02, F04, F05, F14, F16, F20)

- [ ] **Step 1: Draft sections 1-9 from source material**

Dispatch the Gianna copywriting agent with this prompt:
- Draft all 9 sections + References section of the /naprotechnology/ guide using ONLY the source material listed in the spec
- Every stat must trace to a named source (Boyle 2025, Sanchez-Mendez 2025, Katz 2011, etc.)
- **Citation pattern:** Inline citations link to the RRM Academy library page: `<sup><a href="/library/[slug]/">N</a></sup>`. The References section lists the same articles with external URLs (DOI/PubMed). Look up article slugs in `src/data/articles.json` during drafting
- Use balanced IVF comparison language from what-is-rrm, not adversarial framing from the ebook
- Do NOT use old ebook success rate data (popepaulvi.com source)
- Do NOT assert letrozole as NaPro standard (flagged for Naomi review)
- Mention Creighton Model alongside NaPro at least once
- Target 3,000-4,000 words total
- Each section opens with a direct-answer sentence (citable by AI)
- Mark any claim that needs Naomi verification with `[VERIFY]`

- [ ] **Step 2: Brian reviews the draft**

Brian reviews `docs/content-drafts/naprotechnology-guide-draft.md` and makes editorial decisions. This is a human gate -- do not proceed to Step 3 without Brian's approval.

- [ ] **Step 3: Integrate approved content into the page**

Replace `<!-- CONTENT: ... -->` placeholders in `src/pages/naprotechnology/index.astro` with Brian-approved content. Also fill in the FAQPage schema `text` fields with the finalized FAQ answers.

- [ ] **Step 4: Update wordCount and dateModified in schema**

After content is finalized, update `pageSchema` in the frontmatter:
- Add `wordCount: XXXX` (actual word count)
- Update `dateModified` if different from `datePublished`

- [ ] **Step 5: Final build and verify**

Run: `cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build`
Expected: Build succeeds. Check `dist/naprotechnology/index.html` for correct schema, TOC links, table rendering.

- [ ] **Step 6: Commit content**

```bash
git add src/pages/naprotechnology/index.astro
git commit -m "feat: add reviewed content to NaPro guide page

Content drafted by Gianna, reviewed and approved by Brian.
All stats sourced from Boyle 2025, Sanchez-Mendez 2025, Katz 2011.
"
```

---

## Chunk 4: Deploy and Verify

### Task 6: Deploy and post-deploy verification

- [ ] **Step 1: Push rrm-academy-cf to main**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git push origin main
```

Wait for GitHub Actions build to complete successfully.

- [ ] **Step 2: Deploy router (after site deploy completes)**

```bash
cd /Users/brian/iCode/projects/rrm-router
npx wrangler deploy
```

- [ ] **Step 3: Verify live page**

Check: `https://rrmacademy.org/naprotechnology/`
- Page loads with correct content
- TOC links scroll to correct sections
- Tables render with horizontal scroll on mobile
- Breadcrumb shows: Home > NaProTechnology

- [ ] **Step 4: Validate schema markup**

Use Google Rich Results Test or Schema Markup Validator against the live URL.
Check for:
- Three separate JSON-LD blocks detected (not merged)
- MedicalWebPage block validates
- FAQPage block validates (no QAPage errors)
- BreadcrumbList block validates

- [ ] **Step 5: Verify sitemap inclusion**

Check that `/naprotechnology/` appears in the sitemap:
```bash
curl -s https://rrmacademy.org/sitemap-0.xml | grep naprotechnology
```
Expected: `<loc>https://rrmacademy.org/naprotechnology/</loc>` with correct lastmod.

- [ ] **Step 6: Submit to GSC for indexing**

Brian can request indexing via GSC URL inspection tool, or wait for natural crawl (sitemap is already submitted).

---

## Not in Scope (Future Work)

- **Ebook PDF rebuild:** Separate project. New content, keep existing color palette from naproebook.com. Source from the same verified material as this guide.
- **Domain redirects:** naproebook.com, whatisnapro.com, napro.org, naprosurgeon.com, naprofertilitysurgeon.com to /naprotechnology/. See `memory/napro-domains.md` for inventory. Do after guide stabilizes in GSC.
- **SchemaAnswer expansion:** Expand 25 published FAQ schemaAnswers from ~39 words to 80-120 words. Separate effort.
- **Additional guide pages:** /endometriosis/, /isthmocele/, /rrm-vs-ivf/ based on search demand.
- **Male factor FAQ:** Standalone FAQ on the academy site for male infertility + NaPro's couple-centered model.
- **FAQ citation linking:** Add the same dual-link citation pattern to published FAQ answers -- inline links to /library/[slug]/ in the body, external DOI/PubMed URLs in a references section. Applies to all 25 published FAQs (especially F02, F16, F20 which cite specific studies).
