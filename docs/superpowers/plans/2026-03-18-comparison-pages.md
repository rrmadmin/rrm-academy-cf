# Comparison Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the comparison page template (4 new components + index page) and the first comparison page (RRM vs IVF) at `/compare/rrm-vs-ivf/`.

**Architecture:** Standalone `.astro` pages under `/compare/`. Four new components (`ComparisonTable`, `KeyTakeaways`, `StatCallout`, `PageCTA`) provide reusable structure. Content is authored directly in Astro files (not data-driven) to allow bespoke editorial control per page. Follows the existing pillar page pattern for schema, byline, TOC, breadcrumbs, and references.

**Tech Stack:** Astro 5.3, CSS custom properties (design system), JSON-LD schema markup

**Spec:** `docs/superpowers/specs/2026-03-18-comparison-pages-design.md`

**Reference file:** Read `src/pages/femm/index.astro` for the exact pillar page pattern (schema blocks, BaseLayout props, breadcrumbs, author byline, TOC, article-layout, FAQ, references, Pagefind meta). Every structural decision in this plan mirrors that file.

**Revert:** `git restore` on all created files, or `git revert HEAD` after commit.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/KeyTakeaways.astro` | Create | Styled bullet list box for key comparison points |
| `src/components/ComparisonTable.astro` | Create | Semantic HTML `<table>` for side-by-side comparison |
| `src/components/StatCallout.astro` | Create | Highlighted stat block (`<aside>`) |
| `src/components/PageCTA.astro` | Create | Generic CTA card (course, provider directory, etc.) |
| `src/pages/compare/index.astro` | Create | Comparison index page with card grid |
| `src/pages/compare/rrm-vs-ivf.astro` | Create | First comparison page (RRM vs IVF) |

No existing files are modified. All new files.

---

### Task 1: KeyTakeaways Component

**Files:**
- Create: `src/components/KeyTakeaways.astro`

- [ ] **Step 1: Read the STYLE-GUIDE.md for card/box patterns**

```bash
cat /Users/brian/iCode/projects/rrm-academy-cf/STYLE-GUIDE.md | head -100
```

Note the card elevation pattern: `box-shadow: var(--shadow-sm)`, accent borders, color tokens.

- [ ] **Step 2: Create the component**

```astro
---
// KeyTakeaways.astro
// Styled box with bullet points for comparison page summaries.
// Each item should be a complete, self-contained, citable statement.
interface Props {
  items: string[];
}
const { items } = Astro.props;
---

<aside class="key-takeaways">
  <h2 class="key-takeaways__heading">Key Takeaways</h2>
  <ul class="key-takeaways__list">
    {items.map((item) => (
      <li>{item}</li>
    ))}
  </ul>
</aside>

<style>
  .key-takeaways {
    background: var(--bg-surface);
    border-left: 4px solid var(--accent);
    border-radius: var(--radius-md, 8px);
    padding: 1.5rem 2rem;
    margin: 2rem 0;
    box-shadow: var(--shadow-sm);
  }

  .key-takeaways__heading {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
    color: var(--text-primary);
  }

  .key-takeaways__list {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .key-takeaways__list li {
    color: var(--text-secondary);
    line-height: 1.6;
  }
</style>
```

- [ ] **Step 3: Verify it builds**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build 2>&1 | tail -3
```

Expected: Build succeeds (component exists but isn't used yet -- no error).

- [ ] **Step 4: Commit**

```bash
git add src/components/KeyTakeaways.astro
git commit -m "feat: add KeyTakeaways component for comparison pages"
```

---

### Task 2: ComparisonTable Component

**Files:**
- Create: `src/components/ComparisonTable.astro`

- [ ] **Step 1: Create the component**

```astro
---
// ComparisonTable.astro
// Semantic HTML <table> for side-by-side comparison.
// Uses <table> (not CSS grid) because AI parsers extract <table> reliably.
interface Props {
  optionALabel: string;
  optionBLabel: string;
  rows: Array<{ dimension: string; optionA: string; optionB: string }>;
}
const { optionALabel, optionBLabel, rows } = Astro.props;
---

<div class="comparison-table-wrapper">
  <table class="comparison-table">
    <thead>
      <tr>
        <th scope="col"></th>
        <th scope="col">{optionALabel}</th>
        <th scope="col">{optionBLabel}</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr>
          <th scope="row">{row.dimension}</th>
          <td>{row.optionA}</td>
          <td>{row.optionB}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>

<style>
  .comparison-table-wrapper {
    overflow-x: auto;
    margin: 2rem 0;
    -webkit-overflow-scrolling: touch;
  }

  .comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9375rem;
    min-width: 600px;
  }

  .comparison-table thead th {
    background: var(--bg-surface);
    font-weight: 600;
    text-align: left;
    padding: 0.875rem 1rem;
    border-bottom: 2px solid var(--border-color);
    color: var(--text-primary);
  }

  .comparison-table thead th:first-child {
    width: 22%;
  }

  .comparison-table tbody th {
    font-weight: 600;
    text-align: left;
    padding: 0.875rem 1rem;
    color: var(--text-primary);
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
  }

  .comparison-table tbody td {
    padding: 0.875rem 1rem;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-color);
    vertical-align: top;
    line-height: 1.5;
  }

  .comparison-table tbody tr:last-child th,
  .comparison-table tbody tr:last-child td {
    border-bottom: none;
  }

  @media (max-width: 640px) {
    .comparison-table {
      font-size: 0.875rem;
    }
    .comparison-table thead th,
    .comparison-table tbody th,
    .comparison-table tbody td {
      padding: 0.625rem 0.75rem;
    }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ComparisonTable.astro
git commit -m "feat: add ComparisonTable component for side-by-side comparisons"
```

---

### Task 3: StatCallout and PageCTA Components

**Files:**
- Create: `src/components/StatCallout.astro`
- Create: `src/components/PageCTA.astro`

- [ ] **Step 1: Create StatCallout**

```astro
---
// StatCallout.astro
// Highlighted statistic block. Used inline in comparison page sections.
interface Props {
  stat: string;
  source: string;
  sourceUrl?: string;
}
const { stat, source, sourceUrl } = Astro.props;
---

<aside class="stat-callout">
  <p class="stat-callout__number">{stat}</p>
  <p class="stat-callout__source">
    {sourceUrl ? <a href={sourceUrl}>{source}</a> : source}
  </p>
</aside>

<style>
  .stat-callout {
    background: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    padding: 1.25rem 1.5rem;
    margin: 1.5rem 0;
    box-shadow: var(--shadow-sm);
    text-align: center;
  }

  .stat-callout__number {
    font-family: 'Cormorant Garamond', 'Georgia', serif;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 0.25rem 0;
    line-height: 1.3;
  }

  .stat-callout__source {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .stat-callout__source a {
    color: var(--text-secondary);
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 2: Create PageCTA**

```astro
---
// PageCTA.astro
// Generic CTA card. Reusable for course CTAs, provider directory CTAs, etc.
interface Props {
  href: string;
  title: string;
  description: string;
  icon?: string;
}
const { href, title, description } = Astro.props;
---

<div class="page-cta">
  <h3 class="page-cta__title">{title}</h3>
  <p class="page-cta__description">{description}</p>
  <a href={href} class="page-cta__link">Learn more &rarr;</a>
</div>

<style>
  .page-cta {
    background: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    padding: 1.5rem 2rem;
    margin: 2rem 0;
    box-shadow: var(--shadow-sm);
    border-left: 4px solid var(--accent);
  }

  .page-cta__title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: var(--text-primary);
  }

  .page-cta__description {
    color: var(--text-secondary);
    margin: 0 0 1rem 0;
    line-height: 1.6;
  }

  .page-cta__link {
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
  }

  .page-cta__link:hover {
    text-decoration: underline;
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/StatCallout.astro src/components/PageCTA.astro
git commit -m "feat: add StatCallout and PageCTA components"
```

---

### Task 4: Compare Index Page

**Files:**
- Create: `src/pages/compare/index.astro`

**Reference:** Read `src/pages/guides/index.astro` for the exact card grid pattern (CollectionPage + ItemList schema, card layout, BaseLayout props).

- [ ] **Step 1: Create the index page**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

const comparisons = [
  {
    title: 'RRM vs IVF: How Do They Compare?',
    href: '/compare/rrm-vs-ivf/',
    description: 'A side-by-side comparison of Restorative Reproductive Medicine and IVF, covering success rates, costs, risks, and treatment philosophy.',
    author: 'Dr. Naomi Whittaker',
  },
];

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Fertility Treatment Comparisons',
  description: 'Evidence-based comparisons of fertility treatments, including RRM vs IVF, NaProTechnology, and more.',
  url: 'https://rrmacademy.org/compare/',
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: comparisons.length,
    itemListElement: comparisons.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.title,
      url: `https://rrmacademy.org${c.href}`,
    })),
  },
};
---
<BaseLayout
  title="Compare | Fertility Treatment Comparisons"
  description="Evidence-based comparisons of fertility treatments. RRM vs IVF, NaProTechnology vs IVF, and more. Written by board-certified physicians."
  canonicalUrl="https://rrmacademy.org/compare/"
  jsonLd={jsonLd}
>
  <div class="page-wrapper">
    <div class="container container--narrow">

      <section class="compare-hero">
        <h1 class="hero-title">Compare Fertility Treatments</h1>
        <p class="compare-intro">Evidence-based comparisons of fertility treatment approaches, written by board-certified physicians and grounded in peer-reviewed research.</p>
      </section>

      <div class="compare-list">
        {comparisons.map((comp) => (
          <a href={comp.href} class="compare-card">
            <h2 class="compare-card__title">{comp.title}</h2>
            <p class="compare-card__description">{comp.description}</p>
            <span class="compare-card__author">{comp.author}</span>
          </a>
        ))}
      </div>

    </div>
  </div>
</BaseLayout>

<style>
  .compare-hero {
    padding: 3rem 0 2rem;
    text-align: center;
  }

  .hero-title {
    margin: 0 0 1rem 0;
  }

  .compare-intro {
    color: var(--text-secondary);
    max-width: 600px;
    margin: 0 auto;
    line-height: 1.6;
  }

  .compare-list {
    display: grid;
    gap: 1.5rem;
    padding-bottom: 4rem;
  }

  .compare-card {
    display: block;
    background: var(--bg-surface);
    border-radius: var(--radius-md, 8px);
    padding: 1.5rem 2rem;
    box-shadow: var(--shadow-sm);
    text-decoration: none;
    color: inherit;
    transition: box-shadow 0.2s ease;
  }

  .compare-card:hover {
    box-shadow: var(--shadow-md);
  }

  .compare-card__title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0;
    color: var(--text-primary);
  }

  .compare-card__description {
    color: var(--text-secondary);
    margin: 0 0 0.75rem 0;
    line-height: 1.5;
  }

  .compare-card__author {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
</style>
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Verify the page exists in dist**

```bash
ls dist/compare/index.html
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/compare/index.astro
git commit -m "feat: add /compare/ index page for comparison content"
```

---

### Task 5: RRM vs IVF Comparison Page -- Content Generation

**Files:**
- Create: `src/pages/compare/rrm-vs-ivf.astro`

This is the most complex task. It has two phases: content research (rrm-cli), then page authoring (Gianna agent).

**IMPORTANT:** This task requires the Gianna copywriting agent to write content in Dr. Whittaker's voice. The content must be grounded in:
1. Naomi's transcript: `docs/source-material/rrm-vs-art-transcript.txt`
2. Research comparison points: `docs/source-material/rrm-vs-ivf-comparison-points.txt`
3. Fresh citations from rrm-cli

- [ ] **Step 1: Run rrm-cli searches to gather the latest citations**

Run these searches and save the results for content grounding:

```bash
rrm-cli search "RRM outcomes compared IVF" --intent=cite
rrm-cli search "NaProTechnology live birth take home baby rate" --intent=cite
rrm-cli search "IVF pregnancy risks complications prematurity" --intent=cite
rrm-cli search "IVF cost financial burden" --intent=cite
rrm-cli search "NaProTechnology after failed IVF" --intent=cite
rrm-cli search "endometriosis IVF outcomes reduced" --intent=cite
```

Record the key studies with their library URLs for inline citations:
- Boyle et al., 2025 (RRM vs IVF head-to-head)
- Sanchez-Mendez et al., 2025 (NaPro 1,310 couples)
- Stanford et al., 2022 (iNEST)
- Plus any IVF risk/cost studies surfaced

- [ ] **Step 2: Read the source material**

Read these files to understand Naomi's framing and claims:
- `docs/source-material/rrm-vs-art-transcript.txt` (full lecture transcript)
- `docs/source-material/rrm-vs-ivf-comparison-points.txt` (structured comparison analysis)
- `docs/source-material/rrm-vs-ivf-references.txt` (reference list)

Key claims to ground the page in (from transcript):
- REI fellowship has no minimum endometriosis/tubal surgery requirements
- IUI data shows no benefit over timed intercourse (medication is the benefit, not IUI itself)
- Dutch/British trials show IVF and IUI have similar pregnancy rates
- Selective HSG is RRM-unique, highly effective
- NaPro fellowship included 114 laparoscopies, 54 endo surgeries

- [ ] **Step 3: Write the page content using Gianna agent**

Dispatch the Gianna copywriting agent with this prompt:

> Write the content sections for an RRM vs IVF comparison page at rrmacademy.org/compare/rrm-vs-ivf/. This is a 3,000-5,000 word page targeting patients who are deciding between RRM and IVF, optimized for AI citation.
>
> Use Dr. Whittaker's clinical voice. Ground every claim in the transcript and rrm-cli citations provided.
>
> **Required sections (each H2 is a question):**
> 1. Key Takeaways (4-5 bullet points, each a complete citable statement)
> 2. "What is the difference between RRM and IVF?" (~600 words)
> 3. "How do success rates compare?" (~800 words, include stat callouts)
> 4. "What are the risks of IVF compared to RRM?" (~600 words)
> 5. "How much does RRM cost compared to IVF?" (~400 words, cost anchoring: IVF total $40-60K first, then RRM as fraction)
> 6. "Who is RRM for?" (~400 words)
> 7. FAQ section (7 questions, 80-120 word answers each)
> 8. References list (numbered, with library URLs)
>
> **Editorial guardrails:**
> - Never recommend IVF
> - Cost anchoring: IVF anchor first ($40-60K), then RRM as "fraction of that"
> - "Clinicians" not "physicians"
> - Use "underlying condition" not "root cause" for NaPro content
> - Don't frame RRM as merely an IVF alternative
> - Don't self-undercut with performative honesty
>
> **Differentiation from /what-is-rrm/ pillar page:**
> - Do NOT repeat the pillar page's comparison framing. That page explains RRM comprehensively and includes a comparison section as one chapter among many.
> - This page is for someone who already knows what IVF is and wants a direct, evidence-driven comparison. Lead with data and outcomes, not with "what is RRM."
> - The "Who is RRM for?" section must include a structured bulleted list of conditions/situations (unexplained infertility, endometriosis, PCOS, recurrent miscarriage, failed IVF). This is highly citable by AI systems.

The Gianna agent returns the raw content. The implementer then wraps it in the Astro page structure (next step).

- [ ] **Step 4: Assemble the Astro page**

Create `src/pages/compare/rrm-vs-ivf.astro` following the exact pattern from `src/pages/femm/index.astro`:

Structure (in order):
1. Frontmatter: imports, `pageSchema` (Article + MedicalWebPage), `breadcrumbSchema`, `faqSchema`
2. `<BaseLayout>` with title, description, canonicalUrl, ogType="article", publishDate, jsonLd
3. Separate `<script type="application/ld+json">` blocks for breadcrumb and FAQ schemas
4. `<div class="page-wrapper" data-pagefind-body>` with `data-pagefind-meta` spans: `type:Compare` (title-case, matching existing convention) and `title:RRM vs IVF: How Do They Compare?`
5. Breadcrumb nav: Home > Compare > RRM vs IVF
6. H1: "RRM vs IVF: How Do They Compare?"
7. Author byline (inline div, not AuthorByline component): linked name, `<time>`, no PdfDownload
8. Mobile TOC (`<details>`) + desktop TOC (`<nav class="toc">`)
9. `<div class="article-layout">` wrapping TOC sidebar + `<article class="article-content">`
10. KeyTakeaways component
11. ComparisonTable component with comparison data
12. Content sections (H2s as questions, with StatCallout components for key stats)
13. FAQ section: use the `<details class="faq-item">` accordion pattern from `src/pages/faqs.astro` (NOT the `<dl>` pattern from pillar pages). Each FAQ is a `<details>` with `<summary>` containing the question
14. PageCTA component linking to `/courses/rrm-vs-ivf/`
15. Related Comparisons section: `<section id="related-comparisons">` -- empty for first page, scaffolding only. Will be populated when more pages exist
16. References section with numbered `<sup><a href="#ref-N">N</a></sup>` inline citations and `<section id="references">` at bottom
17. Disclaimer: `<p class="disclaimer">This content is for educational purposes only and does not constitute medical advice. Consult a qualified clinician for personalized care.</p>`
18. BackToTop component

**Key props for the page:**
- `title`: "RRM vs IVF: How Do They Compare? | RRM Academy"
- `description`: "RRM diagnoses and treats the underlying condition causing infertility. IVF bypasses it. Compare success rates, costs, risks, and approaches side by side."
- `canonicalUrl`: "https://rrmacademy.org/compare/rrm-vs-ivf/"
- `publishDate`: today's date

**ComparisonTable data:**
```javascript
const comparisonRows = [
  { dimension: 'Philosophy', optionA: 'Diagnose and treat the underlying condition', optionB: 'Bypass the underlying condition to achieve pregnancy' },
  { dimension: 'Typical total cost', optionA: 'A fraction of IVF', optionB: '$15,000-$30,000 per cycle; $40,000-$60,000+ total' },
  { dimension: 'Success metric', optionA: 'Cumulative live birth rate over 24 months', optionB: 'Per-cycle live birth rate' },
  { dimension: 'Reported success', optionA: '52.8% cumulative at 24 months (Boyle 2025)', optionB: '~30% per cycle (HFEA)' },
  { dimension: 'After failed IVF', optionA: 'Comparable outcomes to another IVF cycle', optionB: 'Declining returns per additional cycle' },
  { dimension: 'Surgical training', optionA: 'Fertility-focused fellowship (NaPro)', optionB: 'No minimum endo/tubal surgery requirements' },
  { dimension: 'Risks', optionA: 'Standard medical/surgical risks', optionB: 'OHSS, multiple pregnancy, prematurity, low birth weight' },
  { dimension: 'Long-term health', optionA: 'Treats the underlying condition', optionB: 'Underlying condition remains unaddressed' },
  { dimension: 'Insurance', optionA: 'Often codeable as diagnostic/treatment', optionB: 'Varies by state mandate; often out-of-pocket' },
];
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Verify in dist**

```bash
ls dist/compare/rrm-vs-ivf/index.html
grep 'meta name="description"' dist/compare/rrm-vs-ivf/index.html
grep '<h1' dist/compare/rrm-vs-ivf/index.html
grep 'data-pagefind-body' dist/compare/rrm-vs-ivf/index.html
```

- [ ] **Step 7: Run editorial guardrail check**

```bash
rrm-cli check --file src/pages/compare/rrm-vs-ivf.astro
```

Fix any violations before proceeding.

- [ ] **Step 8: Run template verification**

```bash
node scripts/verify-templates.mjs
```

Expected: All existing tests pass. New page may not be covered yet (that's fine).

- [ ] **Step 9: Commit**

```bash
git add src/pages/compare/rrm-vs-ivf.astro
git commit -m "feat: add RRM vs IVF comparison page

First comparison page at /compare/rrm-vs-ivf/. Content grounded in
Dr. Whittaker's IIRRM lecture transcript and updated with 2025 studies
(Boyle et al., Sanchez-Mendez et al.) via rrm-cli.

Targets: 'rrm vs ivf', 'restorative reproductive medicine vs ivf'"
```

---

### Task 6: Internal Links, Index Update, and Final Verification

**Files:**
- Modify: `src/pages/compare/index.astro` (if needed -- card data should already reference rrm-vs-ivf)
- Modify: `src/pages/what-is-rrm/index.astro` (add link to comparison page from RRM vs IVF section)
- Modify: `src/pages/compare/rrm-vs-ivf.astro` (add link back to /what-is-rrm/)

A comparison page with zero internal links won't rank (see /naprotechnology/ and /guides/ lesson from this session). These links are essential, not optional.

- [ ] **Step 1: Add internal link from /what-is-rrm/ to comparison page**

Find the "RRM vs. IVF" section in `src/pages/what-is-rrm/index.astro`. Add a contextual link, e.g.:
"For a detailed side-by-side comparison of RRM and IVF, including updated 2025 outcomes data, see our <a href="/compare/rrm-vs-ivf/">RRM vs IVF comparison</a>."

Do NOT rewrite the section. Add one sentence with a link.

- [ ] **Step 2: Verify the comparison page links back to /what-is-rrm/**

In the "What is the difference between RRM and IVF?" section of the comparison page, ensure there's a link like: "Learn more about <a href="/what-is-rrm/">what Restorative Reproductive Medicine is</a>."

- [ ] **Step 3: Full build**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build 2>&1 | tail -20
```

- [ ] **Step 2: Run all verification**

```bash
node scripts/verify-templates.mjs
node scripts/check-types.mjs
```

- [ ] **Step 3: Verify both pages in dist**

```bash
# Index page
curl -s file://$(pwd)/dist/compare/index.html | grep '<h1'
# Detail page
curl -s file://$(pwd)/dist/compare/rrm-vs-ivf/index.html | grep '<h1'
# Schema blocks
grep -c 'application/ld+json' dist/compare/rrm-vs-ivf/index.html
# Expected: 3 (pageSchema via BaseLayout, breadcrumbSchema, faqSchema)
```

- [ ] **Step 4: Verify Pagefind indexes the page**

```bash
grep -r "rrm-vs-ivf" dist/pagefind/ 2>/dev/null | head -3
```

The page should appear in Pagefind's index if `data-pagefind-body` is correctly set.

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A src/pages/compare/
git commit -m "fix: comparison page build fixes"
```

---

## Out of Scope

These are follow-up tasks, not part of this plan:

- Adding `/compare/` to the sitemap generation (may need `astro.config` change or manual addition)
- Adding "Compare" to nav (deferred until 3+ pages exist)
- Building subsequent comparison pages (NaPro vs IVF next, then letrozole vs clomid -- see spec roadmap)
- OG image generation for comparison pages
- Router redirect for any old URLs
