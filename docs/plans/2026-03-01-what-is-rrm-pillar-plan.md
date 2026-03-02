# "What is RRM?" Pillar Article Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand `/what-is-rrm/` from ~1,500 words to 8,000-10,000 words of cited, structured content with new CSS components, expanded schema, and navigation integration.

**Architecture:** Expand the existing Astro page in place (preserve URL equity). Add new CSS components (TL;DR box, sticky TOC, provider callouts, footnote system, FAQ accordion) using CSS-only patterns. Expand JSON-LD schema with more FAQs, `hasPart`, and `citation` entries. Update header/footer/mobile nav to include the page.

**Tech Stack:** Astro SSG, CSS (no JS required for core features), JSON-LD structured data, Cloudflare Pages

**Design Doc:** `docs/plans/2026-03-01-what-is-rrm-pillar-design.md`

**Research Files:**
- Competitor analysis: `.firecrawl/rrm-research/` (22 files)
- Dr. Naomi's content: `.firecrawl/whittaker-research/` (21 files)
- Keyword/SEO research: `.firecrawl/seo-research/` (36 files)
- Keyword map: `docs/seo/long-tail-keyword-map-2026-03-01.md`

**Voice:** Gianna (Dr. Naomi Whittaker). Source: `vault/self/voice-gianna.md`. Authoritative educational register, NOT conversational clinical. No first-person anecdotes.

---

## Task 1: CSS Components -- TL;DR Box, Provider Callout, Footnotes

**Files:**
- Modify: `src/styles/global.css` (append new component styles)

**Step 1: Add TL;DR box styles**

Append to `global.css`:

```css
/* === Pillar Article Components === */

/* TL;DR Box */
.tldr {
  background: var(--bg-surface);
  border-left: 3px solid var(--border-color);
  padding: var(--space-6) var(--space-8);
  margin-bottom: var(--space-8);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.tldr h2 {
  font-size: 1rem;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: var(--space-4);
}

.tldr ul {
  margin: 0;
  padding-left: var(--space-5);
}

.tldr li {
  margin-bottom: var(--space-2);
  line-height: 1.6;
}
```

**Step 2: Add provider callout styles**

```css
/* Provider Callout */
.callout-provider {
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-6) var(--space-8);
  margin: var(--space-8) 0;
}

.callout-provider h3 {
  font-size: 0.875rem;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: var(--space-3);
}

.callout-provider p,
.callout-provider ul {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
```

**Step 3: Add footnote/citation styles**

```css
/* Inline Citations */
.cite-ref {
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
}

.cite-ref a {
  color: var(--accent);
  text-decoration: none;
  padding: 0 1px;
}

.cite-ref a:hover {
  text-decoration: underline;
}

/* References Section */
.references {
  font-size: 0.8125rem;
  line-height: 1.7;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
  padding-top: var(--space-8);
  margin-top: var(--space-12);
}

.references ol {
  padding-left: var(--space-6);
}

.references li {
  margin-bottom: var(--space-4);
  padding-left: var(--space-2);
}

.references .ref-backlink {
  color: var(--accent);
  text-decoration: none;
  font-size: 0.875em;
  margin-left: var(--space-2);
}

.references .ref-backlink:hover {
  text-decoration: underline;
}
```

**Step 4: Add myth/fact pair styles**

```css
/* Myth/Fact Pairs */
.myth-fact {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--border-color);
}

.myth-fact:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.myth-label,
.fact-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--space-1);
}

.myth-label {
  color: var(--text-tertiary);
}

.fact-label {
  color: var(--text-primary);
}

.myth-text {
  color: var(--text-tertiary);
  font-style: italic;
  margin-bottom: var(--space-3);
}

.fact-text {
  color: var(--text-primary);
}
```

**Step 5: Add FAQ accordion styles (CSS-only)**

```css
/* FAQ Accordion (CSS-only) */
.faq-accordion {
  border-top: 1px solid var(--border-color);
}

.faq-accordion details {
  border-bottom: 1px solid var(--border-color);
}

.faq-accordion summary {
  padding: var(--space-4) 0;
  cursor: pointer;
  font-weight: 500;
  list-style: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}

.faq-accordion summary::-webkit-details-marker {
  display: none;
}

.faq-accordion summary::after {
  content: '+';
  font-size: 1.25rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.faq-accordion details[open] summary::after {
  content: '−';
}

.faq-accordion .faq-answer {
  padding: 0 0 var(--space-6);
  color: var(--text-secondary);
  line-height: 1.7;
}
```

**Step 6: Add sticky TOC styles**

```css
/* Sticky Table of Contents */
.article-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-8);
}

@media (min-width: 1024px) {
  .article-layout {
    grid-template-columns: 220px 1fr;
    gap: var(--space-10);
    max-width: calc(var(--max-width-article) + 220px + var(--space-10));
  }
}

.toc {
  display: none;
}

@media (min-width: 1024px) {
  .toc {
    display: block;
    position: sticky;
    top: calc(var(--space-16) + var(--space-8));
    align-self: start;
    max-height: calc(100vh - var(--space-16) - var(--space-16));
    overflow-y: auto;
  }
}

.toc-heading {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  margin-bottom: var(--space-3);
}

.toc ol {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc li {
  margin-bottom: var(--space-1);
}

.toc a {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  text-decoration: none;
  line-height: 1.5;
  display: block;
  padding: var(--space-1) 0;
}

.toc a:hover {
  color: var(--text-primary);
}

/* Mobile TOC (collapsible) */
.toc-mobile {
  margin-bottom: var(--space-6);
}

@media (min-width: 1024px) {
  .toc-mobile {
    display: none;
  }
}

.toc-mobile summary {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  padding: var(--space-3) 0;
}

.toc-mobile ol {
  list-style: none;
  padding: var(--space-2) 0 var(--space-2) var(--space-4);
  margin: 0;
  columns: 2;
  column-gap: var(--space-6);
}

.toc-mobile li {
  break-inside: avoid;
  margin-bottom: var(--space-1);
}

.toc-mobile a {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  text-decoration: none;
}
```

**Step 7: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(what-is-rrm): add pillar article CSS components

TL;DR box, provider callout, footnote system, myth/fact pairs,
FAQ accordion (CSS-only), sticky TOC with mobile fallback."
```

---

## Task 2: Page Structure -- Layout Scaffold and TOC

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro`

**Step 1: Update page layout to grid with sticky TOC**

Replace the current `<div class="container container--narrow">` wrapper with the article-layout grid. The page should follow this structure:

```html
<div class="page-wrapper" data-pagefind-body>
  <div class="container">

    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a>
      <span aria-hidden="true"> &rsaquo; </span>
      <span>What is RRM?</span>
    </nav>

    <h1>What is Restorative Reproductive Medicine (RRM)?</h1>

    <p class="author-byline">
      By <strong>Naomi Whittaker, MD</strong>, Board-Certified OBGYN and NaProTechnology Fellow
      <br><time datetime="2026-03-01">Last updated March 2026</time>
    </p>

    <!-- Mobile TOC -->
    <details class="toc-mobile">
      <summary>On this page</summary>
      <ol>
        <li><a href="#key-takeaways">Key Takeaways</a></li>
        <li><a href="#what-is-rrm">What is RRM?</a></li>
        <li><a href="#history">History of RRM</a></li>
        <li><a href="#diagnosis">How Diagnosis Works</a></li>
        <li><a href="#fabms">FABMs Explained</a></li>
        <li><a href="#conditions">Conditions Treated</a></li>
        <li><a href="#rrm-vs-ivf">RRM vs. IVF</a></li>
        <li><a href="#evidence">The Evidence</a></li>
        <li><a href="#patient-journey">Patient Journey</a></li>
        <li><a href="#cost-insurance">Cost and Insurance</a></li>
        <li><a href="#naprotechnology">NaProTechnology</a></li>
        <li><a href="#training">Training and Credentials</a></li>
        <li><a href="#myths">Common Myths</a></li>
        <li><a href="#get-started">How to Get Started</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ol>
    </details>

    <div class="article-layout">

      <!-- Desktop Sticky TOC -->
      <nav class="toc" aria-label="Table of contents">
        <p class="toc-heading">On this page</p>
        <ol>
          <!-- Same links as mobile TOC -->
        </ol>
      </nav>

      <!-- Article Body -->
      <article class="prose">

        <!-- Section 1: TL;DR -->
        <aside class="tldr" id="key-takeaways">
          <h2>Key Takeaways</h2>
          <ul>
            <li>...</li>
          </ul>
        </aside>

        <!-- Sections 2-14 with id anchors -->
        <h2 id="what-is-rrm">What Is Restorative Reproductive Medicine?</h2>
        <!-- content... -->

        <!-- Section 15: FAQ Accordion -->
        <h2 id="faq">Frequently Asked Questions</h2>
        <div class="faq-accordion">
          <details>
            <summary>Question text</summary>
            <div class="faq-answer"><p>Answer text</p></div>
          </details>
        </div>

        <!-- References -->
        <section class="references" id="references">
          <h2>References</h2>
          <ol>
            <li id="ref-1">...</li>
          </ol>
        </section>

        <!-- CTA Box -->
        <div class="cta-box">...</div>

      </article>
    </div>
  </div>
</div>
```

Key changes from existing page:
- Remove `container--narrow` (the grid handles width)
- Remove breadcrumb "About" link (this page is top-level, not under About)
- Move `<h1>` and byline above the grid (full-width)
- Add mobile and desktop TOC with identical link lists
- Add `id` anchors to every `<h2>`
- Remove the em dash in byline (Brian's preference: never use em dashes)

**Step 2: Update the page-level `<style>` block**

Remove the `.cite-needed` styles (no more `[CITE]` placeholders after this). Keep `.author-byline`, `.table-wrap`, `table`, `th`, `td`, `.cta-box` styles. Update `.container` override:

```css
/* Override container for article layout */
.container {
  max-width: calc(var(--max-width-article) + 220px + var(--space-10) + var(--space-8) * 2);
}

@media (max-width: 1023px) {
  .container {
    max-width: var(--max-width-article);
  }
}
```

**Step 3: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "feat(what-is-rrm): scaffold article layout with sticky TOC

Grid layout for desktop sidebar TOC, mobile collapsible TOC,
section anchors for all 15 sections."
```

---

## Task 3: Content -- Sections 1-5 (Definition, History, Diagnosis, FABMs)

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro`

**Context for content writer:**
- Voice: Read `vault/self/voice-gianna.md` before writing
- Short sentences. Active voice. No em dashes.
- "Couples" not "patients" (when discussing fertility)
- "Suppressive medications" not "hormonal contraception"
- "Excision" not "ablation"
- "Disease progression" not "symptoms"
- Authority from citations, not personal testimony
- RRM is its own paradigm, NOT a step before IVF

**Sources to reference:**
- IIRRM definition: `.firecrawl/rrm-research/iirrm-what-is-rrm.md`
- FACTS overview: `.firecrawl/rrm-research/facts-rrm.md`
- Dr. Naomi's positions: `.firecrawl/whittaker-research/substack-technically-human.md` (richest source)
- Dr. Naomi NW article: `.firecrawl/whittaker-research/nw-hidden-costs-ivf.md`
- Keyword targets: `docs/seo/long-tail-keyword-map-2026-03-01.md`

**Step 1: Write Section 1 -- TL;DR / Key Takeaways (~150 words)**

6 bullets covering: what RRM is, who it's for, root-cause distinction, key conditions, evidence summary, how to start. This fills the CORE-EEAT O02 gap (summary box).

**Step 2: Write Section 2 -- What Is Restorative Reproductive Medicine? (~600 words)**

Expand existing opening. Three principles (identify, treat, restore). Position within conventional medicine. Address misconceptions. Include provider callout (CME pathways, how RRM fits existing OBGYN practice).

Primary keyword: "what is restorative reproductive medicine" (exact match in H2).

**Step 3: Write Section 3 -- A Brief History of RRM (~800 words)**

New section. Timeline:
- Billings Method origins (1950s-60s)
- Creighton Model development (1976, Dr. Thomas Hilgers)
- NaProTechnology formalization (1980s-90s, Pope Paul VI Institute)
- IIRRM founding (2008)
- Journal of RRM launch
- 2025 events: Arkansas insurance mandate, RESTORE Act, national media coverage (NYT, STAT, The Cut)
- Growing mainstream recognition

Sources: Heritage Foundation report (`.firecrawl/seo-research/scrape-heritage-rrm.md`), OSV News article (`.firecrawl/whittaker-research/diocese-scranton.md`), competitor pages.

**Step 4: Write Section 4 -- How RRM Diagnosis Works (~800 words)**

New section. Diagnostic workup walkthrough:
1. Cycle charting as foundation (the "EKG for the female body" -- Dr. Naomi's analogy from OSV News)
2. Timed bloodwork (peak +3/+5/+7/+9/+11)
3. Advanced imaging
4. Diagnostic laparoscopy
5. Semen analysis (male factor always evaluated)

How this differs from standard fertility workup. Provider callout with specific panels and timing protocols.

**Step 5: Write Section 5 -- FABMs Explained (~600 words)**

New section. Methods comparison:
- Creighton Model (cervical mucus, NaPro foundation)
- Marquette (urinary hormones, monitor-based)
- FEMM (hormonal + mucus, app-based)
- Billings (cervical mucus, original method)
- SymptoThermal (BBT + mucus)

Key angle: FABMs as diagnostic tools, not just family planning. This is the "blue ocean" content gap identified in keyword research.

Sources: FAbM Base comparison (`.firecrawl/seo-research/scrape-fabm-comparison.md`), FACTS content.

**Step 6: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "content(what-is-rrm): sections 1-5 -- definition, history, diagnosis, FABMs

TL;DR box, expanded definition, new history section, diagnostic
walkthrough, FABM comparison. ~3,000 words with inline citations."
```

---

## Task 4: Content -- Sections 6-8 (Conditions, RRM vs IVF, Evidence)

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro`

**Step 1: Write Section 6 -- Conditions Treated with RRM (~1,000 words)**

Expand existing table. Each condition gets 2-3 paragraphs with inline citations:
- Endometriosis (excision only, no ablation promotion)
- PCOS (phenotype-based, insulin resistance)
- Unexplained infertility ("unexplained" = "underinvestigated")
- Recurrent miscarriage (progesterone, thyroid, immune)
- Irregular/painful periods
- Pelvic pain
- Ovulatory dysfunction
- Male factor (restorative andrology -- counters ACOG/ASRM criticism)
- Premenstrual syndrome

Keep the comparison table but expand narrative around it. Use condition-specific long-tail keywords from the keyword map.

**Step 2: Write Section 7 -- RRM vs. IVF (~800 words)**

Expand existing table. Per design doc rules:
- RRM is its own paradigm, NOT a stepping stone to IVF
- Lead with what RRM does, not what it opposes
- Use HFEA data for IVF outcomes (NOT SART/CORS)
- May mention editorially that US IVF reporting via SART is voluntary and selectively published
- Acknowledge when IVF may be appropriate (tubal blockage, severe male factor)
- Cost analysis with citations
- Outcomes by condition and age bracket
- Reference Boyle et al. (2018) for RRM after failed IVF

Sources: Dr. Naomi NW article on hidden costs of IVF, Substack interview positions, HFEA data.

**Step 3: Write Section 8 -- The Evidence Behind RRM (~1,000 words)**

Expand existing section. Organize by evidence type:
- RRM outcomes studies (Stanford et al., Tham et al., JRRM)
- Surgical outcomes (endometriosis meta-analyses)
- Cost-effectiveness data (Katz et al.)
- Obstetric outcomes (preterm delivery, multiples risk)
- Honest assessment of evidence gaps and limitations (no large-scale RCTs yet)

This is the citation-heavy backbone. Every statistic needs a numbered footnote. Remove all `[CITE]` and `<mark class="cite-needed">` placeholders.

Sources: FACTS one-pager citations, keyword map evidence section, NaPro research references.

**Step 4: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "content(what-is-rrm): sections 6-8 -- conditions, RRM vs IVF, evidence

Expanded conditions with citations, IVF comparison using HFEA data,
comprehensive evidence review. ~2,800 words."
```

---

## Task 5: Content -- Sections 9-12 (Journey, Cost, NaPro, Training)

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro`

**Step 1: Write Section 9 -- Patient Journey (~600 words)**

New section. Timeline walkthrough:
1. Learn to chart (1-3 cycles)
2. Initial consultation (chart review, medical history, both partners)
3. Diagnostic workup (timed bloodwork, imaging, semen analysis, possible laparoscopy)
4. Diagnosis and treatment plan
5. Ongoing monitoring (cycle-by-cycle adjustments)
6. Outcomes (conception support, early pregnancy monitoring, or continued investigation)

Realistic expectations on duration (months, not a single cycle).

**Step 2: Write Section 10 -- Cost and Insurance (~500 words)**

New section. Key data points:
- IVF average cost: $15,000-$30,000 per cycle (HFEA data for UK, cite US ranges from published studies)
- RRM evaluation and treatment: typically $2,000-$8,000 total
- Charting instruction: $200-$500
- Why RRM is often covered (coded as treatment for diagnosed conditions, not "fertility treatment")
- Arkansas insurance mandate (2025) -- first state
- RESTORE Act (H.R. 3589) -- federal legislation
- What to ask your insurer

Include comparison table with cost ranges.

**Step 3: Write Section 11 -- NaProTechnology (~400 words)**

Refine existing section. Clarify the relationship:
- Creighton Model = the charting system
- NaProTechnology = the medical application of Creighton data
- RRM = the broader discipline (NaPro is one approach within it)
- Fellowship training specifics
- Address "is NaPro only for Catholics" directly

**Step 4: Write Section 12 -- Training and Credentials (~500 words)**

New provider-facing section. Map the training landscape:
- FertilityCare Practitioner (FCP) certification via AAFCP
- Medical Consultant certification (Pope Paul VI Institute)
- RRM Academy online courses
- FACTS medical elective
- IIRRM conferences and CME
- Fellowship programs

Provider callout with specific credentialing paths and CME opportunities.
Internal link to `/courses/` prominently.

**Step 5: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "content(what-is-rrm): sections 9-12 -- journey, cost, NaPro, training

Patient journey timeline, cost comparison with insurance context,
refined NaPro section, provider training landscape. ~2,000 words."
```

---

## Task 6: Content -- Sections 13-15 (Myths, Get Started, FAQ)

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro`

**Step 1: Write Section 13 -- Common Myths About RRM (~600 words)**

New section using myth/fact pair markup:

1. "RRM is only for religious people" -- Medical protocols based on physiology, not theology
2. "RRM is alternative medicine" -- Board-certified physicians, peer-reviewed research, standard diagnostics
3. "RRM only works for infertility" -- Treats gynecological conditions regardless of fertility goals
4. "RRM has no evidence base" -- Cite published studies (cross-reference Section 8)
5. "RRM is anti-IVF" -- RRM treats root causes; it's a medical approach, not a position statement
6. "You need to choose between RRM and conventional medicine" -- RRM IS conventional medicine applied differently

Each myth directly addresses a real ACOG/ASRM/RESOLVE objection with citations.

```html
<div class="myth-fact">
  <span class="myth-label">Myth</span>
  <p class="myth-text">"RRM is only for religious people."</p>
  <span class="fact-label">Fact</span>
  <p class="fact-text">RRM is practiced by board-certified OBGYNs using standard medical diagnostics...</p>
</div>
```

**Step 2: Write Section 14 -- How to Get Started (~400 words)**

Expand existing section. Three pathways:
1. **For couples:** Learn a validated FABM, find a provider (IIRRM directory, NW directory), browse RRM Academy courses
2. **For providers:** Explore training pathways (link to Section 12), RRM Academy CME courses
3. **For researchers:** RRM Research Library (library.rrmacademy.org)

Internal links: `/courses/`, `/library/`, `/save-the-uterus-club/`

**Step 3: Write Section 15 -- FAQ Accordion (15-20 questions, ~800 words visible)**

Expand from 10 to 20 FAQs using `<details>/<summary>` pattern. New questions to add:
- How much does RRM cost compared to IVF?
- Does insurance cover RRM?
- How long does treatment take?
- What fertility charting methods are used?
- Can RRM help after failed IVF?
- Is RRM safe?
- What is the difference between NaPro and RRM?
- Can teenagers benefit from RRM?
- Does my partner need to be involved?
- How do I find an RRM doctor near me?

All answers must be in the JSON-LD FAQPage schema (Task 7).

**Step 4: Write References section**

Numbered footnotes with full citations. Format per design doc:

```html
<section class="references" id="references">
  <h2>References</h2>
  <ol>
    <li id="ref-1">
      Stanford JB, et al. "Outcomes of treatment with NaProTechnology
      in subfertile couples." <em>J Restorative Reprod Med.</em> 2021.
      <a href="https://library.rrmacademy.org/..." rel="noopener">Research Library</a>
      <a href="#cite-1" class="ref-backlink" aria-label="Back to citation 1">&#8617;</a>
    </li>
  </ol>
</section>
```

Each reference links to the Research Library record (preferred) or DOI. Track any cited article NOT in the library on a separate list (for ingestion before publish).

**Step 5: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "content(what-is-rrm): sections 13-15 + references -- myths, getting started, FAQ

6 myth/fact pairs addressing ACOG/ASRM objections, expanded get-started
with 3 pathways, 20-question FAQ accordion, numbered references. ~1,800 words."
```

---

## Task 7: Schema -- Expand JSON-LD

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro` (frontmatter `jsonLd` object)

**Step 1: Update Article schema**

- Update `dateModified` to current date
- Expand `description` to match new meta description
- Add `wordCount` property
- Add `articleSection` array listing all H2 section titles

**Step 2: Expand FAQPage schema to 20 questions**

Update the `mainEntity` array in the FAQPage schema to include all 20 FAQ questions from Section 15. Each question/answer pair must exactly match the visible `<details>/<summary>` content.

**Step 3: Add `hasPart` to Article schema**

Add `hasPart` array for major sections, enabling potential featured snippets:

```javascript
hasPart: [
  {
    '@type': 'WebPageElement',
    name: 'What Is Restorative Reproductive Medicine?',
    url: 'https://rrmacademy.org/what-is-rrm/#what-is-rrm',
  },
  // ... one entry per H2 section
],
```

**Step 4: Add `citation` array**

Add `citation` as array of `ScholarlyArticle` references for key studies:

```javascript
citation: [
  {
    '@type': 'ScholarlyArticle',
    name: 'Outcomes of treatment with NaProTechnology in subfertile couples',
    author: 'Stanford JB, et al.',
    datePublished: '2021',
    isPartOf: {
      '@type': 'Periodical',
      name: 'Journal of Restorative Reproductive Medicine',
    },
  },
  // ... key studies only (5-8 most important)
],
```

**Step 5: Update meta description**

Ensure the `<BaseLayout>` `description` prop matches the expanded content. Target 140-155 characters.

**Step 6: Commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "feat(what-is-rrm): expand JSON-LD schema

20-question FAQPage, hasPart for section snippets, citation array
for key studies, updated Article metadata."
```

---

## Task 8: Navigation -- Header, Footer, Mobile Nav

**Files:**
- Modify: `src/components/Header.astro`
- Modify: `src/components/Footer.astro`

**Step 1: Add to desktop header nav**

In `Header.astro`, add "What is RRM?" as the first item in the desktop nav (before Research Library). This positions the pillar article as the primary educational entry point.

```html
<a href="/what-is-rrm/" class:list={[{ active: pathname === '/what-is-rrm/' }]}>What is RRM?</a>
```

Check the existing nav link pattern for `class:list` and `active` state logic. Match exactly.

**Step 2: Add to mobile nav**

In the mobile nav Education section, add "What is RRM?" as the first item (before FAQ).

**Step 3: Add to footer nav**

In `Footer.astro`, add "What is RRM?" as the first item in the Education column (before FAQ).

**Step 4: Verify all nav items render**

Run: `npm run build` or `npx astro build`
Expected: Build succeeds with no errors.

**Step 5: Commit**

```bash
git add src/components/Header.astro src/components/Footer.astro
git commit -m "feat(nav): add What is RRM to header, footer, and mobile nav

Pillar article now accessible from all navigation points."
```

---

## Task 9: Internal Links and Cross-References

**Files:**
- Modify: `src/pages/index.astro` (homepage)
- Modify: `src/pages/about/index.astro` (about page)
- Modify: `src/pages/what-is-rrm/index.astro` (verify internal links within article)

**Step 1: Add internal links from homepage**

Find relevant text on the homepage that mentions RRM, fertility, or the approach, and add inline links to `/what-is-rrm/`. Target 2-3 contextual links.

**Step 2: Update about page links**

The about page already links to the what-is-rrm page. Verify the link text is descriptive (not just "learn more").

**Step 3: Verify internal links within the article**

Ensure these internal links exist within the article body:
- `/courses/` (Sections 12, 14)
- `/courses/masterclass-in-endometriosis-and-surgery/` (Section 6, endometriosis)
- `/courses/rrm-vs-ivf/` (Section 7)
- `/courses/postpartum-depression-anxiety/` (Section 6, if relevant)
- `/library/` or `library.rrmacademy.org` (Sections 8, 14)
- `/save-the-uterus-club/` (Section 14)
- `/commentary/` (if relevant articles exist)
- External: `iirrm.org` (Sections 3, 12, 14)
- External: `fertilitycare.org` (Section 14)
- External: `factsaboutfertility.org` (Section 12)

**Step 4: Verify no broken links**

Run build and check for any broken internal links.

**Step 5: Commit**

```bash
git add src/pages/index.astro src/pages/about/index.astro src/pages/what-is-rrm/index.astro
git commit -m "feat(what-is-rrm): internal cross-links from homepage and about page

Added contextual links to pillar article, verified all internal
and external links within article body."
```

---

## Task 10: Library Gap Tracking and Final Polish

**Files:**
- Create: `docs/plans/2026-03-01-what-is-rrm-library-gaps.md`
- Modify: `src/pages/what-is-rrm/index.astro` (final pass)

**Step 1: Create library gap list**

Review every citation in the References section. For each cited paper, check if it exists in the RRM Research Library at `library.rrmacademy.org`. Create a list of articles that need to be ingested before publication.

Format:
```markdown
# Articles to Ingest -- What is RRM Pillar Article

| # | Title | Authors | Journal | Year | In Library? | Action |
|---|-------|---------|---------|------|-------------|--------|
| 1 | ... | ... | ... | ... | No | Ingest |
```

**Step 2: Final content review pass**

- Verify word count target (8,000-10,000)
- Verify no `[CITE]` or `<mark class="cite-needed">` placeholders remain
- Verify every statistic has a numbered footnote
- Verify all `id` anchors match TOC links
- Verify all FAQ answers in HTML match JSON-LD schema exactly
- Verify byline has no em dashes
- Verify "3,164+" library count is current (check homepage)
- Verify HFEA used for IVF data (not SART)

**Step 3: Verify page builds and renders**

Run: `npm run build && npm run preview`
Expected: Page builds, renders all sections, TOC links work, FAQ accordion works.

**Step 4: Commit**

```bash
git add docs/plans/2026-03-01-what-is-rrm-library-gaps.md src/pages/what-is-rrm/index.astro
git commit -m "chore(what-is-rrm): library gap tracking and final polish

Library gap list for pre-publish ingestion. Final content review
pass: all citations resolved, schema validated, no placeholders."
```

---

## Task 11: SEO Validation

**Files:**
- Modify: `src/pages/what-is-rrm/index.astro` (if fixes needed)

**Step 1: Validate JSON-LD schema**

Copy the rendered JSON-LD from the built page and validate using Google Rich Results Test or Schema.org validator. Fix any errors.

**Step 2: Check meta tags**

Verify in built HTML:
- `<title>` is 50-60 characters
- `<meta name="description">` is 140-155 characters
- `<link rel="canonical">` is `https://rrmacademy.org/what-is-rrm/` (note: existing has `/what-is-rrm` without trailing slash -- fix if needed)
- OG tags present (ogType: "article")

**Step 3: Lighthouse audit**

Run Lighthouse on the preview URL. Target SEO score > 95.

**Step 4: Verify heading hierarchy**

Ensure single H1, all H2s are section headings, H3s are subsections within H2s. No skipped levels.

**Step 5: Fix any issues found, commit**

```bash
git add src/pages/what-is-rrm/index.astro
git commit -m "fix(what-is-rrm): SEO validation fixes

Schema validated, meta tags verified, heading hierarchy clean."
```

---

## Pre-Publication Checklist

Before deploying:

- [ ] 8,000+ words of sourced, cited content
- [ ] Every statistic has a numbered footnote to a specific study
- [ ] Zero `[CITE]` or `[NEEDS CITATION]` placeholders
- [ ] All cited papers exist in the Research Library (or are on the ingestion list)
- [ ] FAQPage schema with 20 questions validated in Rich Results Test
- [ ] Page appears in header, footer, and mobile navigation
- [ ] Sticky TOC works on desktop, collapsible TOC on mobile
- [ ] Provider callouts in at least 4 sections
- [ ] HFEA data used for IVF comparisons (not SART)
- [ ] No em dashes anywhere
- [ ] Gianna voice throughout (short sentences, active voice, couple-centered)
- [ ] RRM framed as its own paradigm (not "before IVF")
- [ ] Lighthouse SEO score > 95
- [ ] CORE-EEAT O02 gap closed (TL;DR box present)
- [ ] Library gap list complete and actioned

---

## Notes for Content Writer

### Key Clinical Positions from Dr. Naomi (from research)

These are direct or closely paraphrased positions from Dr. Naomi's published content. Use these to inform the voice and framing, but cite the original sources, not these notes.

**On RRM's core identity:**
- "The essence of RRM is using medicine to restore the healthy, physiologic state of women, which is ovulation."
- "Even if we don't get a baby, they at least feel better that they have answers."
- "Healing is not one-size-fits-all; it's a partnership built on trust, compassion, and science."

**On diagnosis:**
- Cycle chart = "a real-time report card of reproductive health" / "EKG for the female body"
- "Rather than flying blind like most OBGYNs, I rely on data provided by the patient to identify ovulation."

**On IVF:**
- IVF live birth rate per cycle flat at ~31% since 2003 (from NW article)
- Cochrane: insufficient evidence IVF outperforms expectant management for unexplained infertility
- No RCTs for IVF + PCOS or IVF + endometriosis
- "High-dose hormone stimulation can worsen inflammatory conditions such as endometriosis or PCOS."
- "Male factor infertility is often ignored and circumvented through ICSI, shifting the burden entirely onto women."
- Cost: $200K couple example, no baby, no money left for adoption

**On medical training gaps:**
- "I was taught in med school that ovulation was a risk factor for cancer."
- "The training on hormones is abysmal and antiquated in medical school and even OBGYN residency."
- Over-reliance on suppressive medications "has led to a stagnation of intellectual curiosity"

**On evidence:**
- Dr. Thomas Hilgers "conducted the only prospective, real-time studies tracking women's hormones throughout their cycles."
- Women's health research is decades behind other fields
- Need more RCTs -- honest about gaps

**On myths/femtech:**
- "The science of femtech is overwhelmingly bad."
- "We need to educate women on valid methods of FABM or else they will be duped by the next best marketing ad."

### IVF Data Policy

- **Use HFEA (UK)** for IVF comparison statistics -- comprehensive, includes failure rates
- **Do NOT cite SART/CORS** as primary source. May mention editorially that US IVF reporting via SART is voluntary and selectively published
- **Do NOT cite CDC NASS** for IVF outcomes (relies on SART data)

### Source Authority (from design doc)

**Tier 1 (highest trust):** RRM Research Library, Dr. Naomi's published work, RRM Academy courses
**Tier 2:** Peer-reviewed journals (JRRM, F&S, Human Reprod, BMC, AJOG), Natural Womanhood, IIRRM, Saint Paul VI, FertilityCare, FACTS
**Tier 3 (context only):** ACOG, ASRM, WHO, HFEA

**Never cite:** Wikipedia, WebMD, Healthline, social media (except Dr. Naomi's), unpublished data, hostile sources, AI-generated claims
