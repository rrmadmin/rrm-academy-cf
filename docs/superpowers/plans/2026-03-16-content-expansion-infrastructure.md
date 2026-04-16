# Content Expansion Infrastructure -- Implementation Plan (v2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build templates, components, data loaders, and cross-link wiring for three new content types (research hubs, comparison pages, glossary v2 outbound links) plus cross-link upgrades to existing pages.

**Architecture:** Static generation via Astro `getStaticPaths()` from curated JSON data files. Each new page type follows the existing pattern: JSON data file -> TypeScript loader -> Astro template. Content production (Naomi's commentary, comparison narratives) happens incrementally outside this plan with editorial review gates.

**Tech Stack:** Astro 5.3, existing design system (STYLE-GUIDE.md), TypeScript data loaders, JSON data files.

**Spec:** `docs/superpowers/specs/2026-03-16-content-expansion-crosslink-design.md`

**Editorial content is NOT in scope.** This plan builds infrastructure + 1 stub entry per content type for build validation. Content fills in over time through a separate editorial process.

**v2 changes from /arise review:** Glossary uses hybrid approach (prose stays in Astro, only outbound links data-driven). Topic pills kept as library filters with separate hub links section added. Build-time slug validation. Pagefind-ignore on article grids. Domain values corrected. Keyword matching replaced with explicit slug arrays. Show-more replaced with "View all in library" link. StucCallout added alongside existing CTA, not replacing it. `.detail-heading` promoted to global.css. Stub pages get conditional noindex.

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/data/research-hubs.json` | Curated research hub definitions (stub: 1 entry) |
| `src/data/comparisons.json` | Comparison page content (stub: 1 entry, starts as `[]`) |
| `src/data/glossary-outbound-links.json` | Outbound links for glossary terms (slug -> hub/faq/comparison refs) |
| `src/lib/research-hubs.ts` | Data loader: load hubs, filter articles, get related content, build-time validation |
| `src/lib/comparisons.ts` | Data loader: load comparisons |
| `src/pages/research/index.astro` | Research hub index page |
| `src/pages/research/[...slug].astro` | Research hub detail page |
| `src/pages/compare/index.astro` | Comparison index page |
| `src/pages/compare/[...slug].astro` | Comparison detail page |
| `src/components/StucCallout.astro` | STUC membership CTA (4 context variants) |
| `src/components/CrossLinkSection.astro` | Reusable below-content section |
| `src/components/ComparisonTable.astro` | Side-by-side evidence table with mobile stack |
| `src/components/ResearchHubBadge.astro` | Inline badge linking article to research hub |

### Modified files

| File | Change |
|------|--------|
| `src/styles/global.css` | Promote `.detail-heading` from scoped to global |
| `src/pages/glossary/index.astro` | Add data-driven outbound links to existing terms (prose stays in Astro) |
| `src/pages/library/index.astro` | Add "Research Collections" section below topic pills |
| `src/pages/library/[...slug].astro` | Add ResearchHubBadge |
| `src/pages/faqs/[...slug].astro` | Add StucCallout below existing CTA |
| `src/pages/commentary/[...slug].astro` | Add StucCallout after related posts |

### Router update (separate repo)

| File | Change |
|------|--------|
| `~/iCode/projects/rrm-router/src/index.js` | Add `/research`, `/compare` to ASTRO_ROUTES |

---

## Chunk 1: Foundation (global CSS + shared components)

### Task 1: Promote `.detail-heading` to global.css

**Files:**
- Modify: `src/styles/global.css`
- Modify: `src/pages/library/[...slug].astro` (remove scoped `.detail-heading`)
- Modify: `src/pages/faqs/[...slug].astro` (remove scoped `.detail-heading`)
- Modify: `src/pages/commentary/[...slug].astro` (remove scoped `.detail-heading`)

The `.detail-heading` class is defined independently in 3 scoped style blocks. CrossLinkSection needs it but can't access scoped styles from parent pages. Promote to global.

- [ ] **Step 1: Read the 3 scoped definitions**

Read the `.detail-heading` definitions in library/[...slug].astro, faqs/[...slug].astro, and commentary/[...slug].astro. Note any differences.

- [ ] **Step 2: Add `.detail-heading` to global.css**

Use the semantic token (`--text-primary` not `--neutral-900`):

```css
/* Section headings in detail/below-content areas */
.detail-heading {
  font-family: 'Cormorant Garamond', 'Georgia', serif;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-4);
}
```

- [ ] **Step 3: Remove the 3 scoped definitions**

Remove `.detail-heading` from the `<style>` blocks in all 3 files.

- [ ] **Step 4: Verify build**

```bash
cd ~/iCode/projects/rrm-academy-cf && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css src/pages/library/[...slug].astro src/pages/faqs/[...slug].astro src/pages/commentary/[...slug].astro
git commit -m "refactor: promote .detail-heading to global.css"
```

### Task 2: Create CrossLinkSection component

**Files:**
- Create: `src/components/CrossLinkSection.astro`

- [ ] **Step 1: Read existing below-content patterns**

Read `src/pages/faqs/[...slug].astro` lines 75-120 for `.library-section`, `.related-section` spacing pattern: `padding-top: var(--space-8); border-top: 1px solid var(--border-color); margin-bottom: var(--space-8)`.

- [ ] **Step 2: Write CrossLinkSection.astro**

```astro
---
interface LinkItem {
  href: string;
  title: string;
  subtitle?: string;
}

interface Props {
  heading: string;
  items: LinkItem[];
  layout?: 'list' | 'grid' | 'pills';
}

const { heading, items, layout = 'list' } = Astro.props;
---

{items.length > 0 && (
  <section class="cross-link-section" aria-label={heading}>
    <h2 class="detail-heading">{heading}</h2>
    {layout === 'pills' ? (
      <nav class="cross-link-pills">
        {items.map((item, i) => (
          <>
            <a href={item.href}>{item.title}</a>
            {i < items.length - 1 && <span class="cross-link-pills__dot" aria-hidden="true">&middot;</span>}
          </>
        ))}
      </nav>
    ) : layout === 'grid' ? (
      <div class="cross-link-grid">
        {items.map(item => (
          <a href={item.href} class="cross-link-card">
            <span class="cross-link-card__title">{item.title}</span>
            {item.subtitle && <span class="cross-link-card__subtitle">{item.subtitle}</span>}
          </a>
        ))}
      </div>
    ) : (
      <ul class="cross-link-list">
        {items.map(item => (
          <li>
            <a href={item.href}>{item.title}</a>
            {item.subtitle && <span class="cross-link-list__subtitle">{item.subtitle}</span>}
          </li>
        ))}
      </ul>
    )}
  </section>
)}

<style>
  /* Match existing FAQ/library below-content section spacing exactly */
  .cross-link-section {
    padding-top: var(--space-8);
    border-top: 1px solid var(--border-color);
    margin-bottom: var(--space-8);
  }

  .cross-link-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .cross-link-list a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .cross-link-list__subtitle {
    display: block;
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }

  .cross-link-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: var(--space-4);
  }
  .cross-link-card {
    display: flex;
    flex-direction: column;
    padding: var(--space-4);
    text-decoration: none;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    background: var(--bg-surface);
    transition: box-shadow 0.2s ease;
  }
  .cross-link-card:hover {
    box-shadow: var(--shadow-md);
  }
  .cross-link-card__title {
    font-weight: 500;
    color: var(--text-primary);
  }
  .cross-link-card__subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }

  .cross-link-pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.9375rem;
  }
  .cross-link-pills a {
    color: var(--text-secondary);
    text-decoration: none;
    transition: color 0.15s ease;
  }
  .cross-link-pills a:hover {
    color: var(--accent);
  }
  .cross-link-pills__dot {
    color: var(--text-tertiary);
  }
</style>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/CrossLinkSection.astro
git commit -m "feat: add CrossLinkSection reusable below-content component"
```

### Task 3: Create StucCallout component

**Files:**
- Create: `src/components/StucCallout.astro`

- [ ] **Step 1: Write StucCallout.astro**

```astro
---
interface Props {
  context: 'commentary' | 'faq' | 'guide' | 'research';
}

const { context } = Astro.props;

const messages: Record<string, { heading: string; body: string }> = {
  commentary: {
    heading: 'Continue the conversation',
    body: 'STUC members discuss topics like this on live monthly calls with Dr. Whittaker.',
  },
  faq: {
    heading: 'Have more questions?',
    body: 'STUC members get live Q&A with Dr. Whittaker and access to a private community of patients and clinicians.',
  },
  guide: {
    heading: 'Join clinicians and patients exploring RRM together',
    body: 'The Save the Uterus Club meets monthly for live discussion, Q&A, and community support.',
  },
  research: {
    heading: 'Discuss this research',
    body: 'STUC members discuss new studies and clinical findings on monthly live calls.',
  },
};

const msg = messages[context];
---

<aside class="stuc-callout" aria-label="Community membership">
  <p class="stuc-callout__heading">{msg.heading}</p>
  <p class="stuc-callout__body">{msg.body}</p>
  <a href="/save-the-uterus-club/" class="stuc-callout__link">Learn about STUC</a>
</aside>

<style>
  .stuc-callout {
    margin-top: var(--space-8);
    padding: var(--space-5) var(--space-6);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
  }
  .stuc-callout__heading {
    font-family: 'Cormorant Garamond', 'Georgia', serif;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2) 0;
  }
  .stuc-callout__body {
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 var(--space-4) 0;
  }
  .stuc-callout__link {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StucCallout.astro
git commit -m "feat: add StucCallout community CTA component"
```

### Task 4: Create ComparisonTable component

**Files:**
- Create: `src/components/ComparisonTable.astro`

- [ ] **Step 1: Write ComparisonTable.astro**

Uses `<div>` with ARIA roles (not native `<table>`) per Astro gotcha.

```astro
---
interface Row {
  dimension: string;
  approach1: string;
  approach2: string;
  source?: string;
}

interface Props {
  approach1Name: string;
  approach2Name: string;
  rows: Row[];
}

const { approach1Name, approach2Name, rows } = Astro.props;
---

<div class="comparison-table" role="table" aria-label={`${approach1Name} vs ${approach2Name}`}>
  <div class="comparison-table__header" role="row">
    <div role="columnheader" class="comparison-table__cell comparison-table__cell--dim"></div>
    <div role="columnheader" class="comparison-table__cell comparison-table__cell--val">{approach1Name}</div>
    <div role="columnheader" class="comparison-table__cell comparison-table__cell--val">{approach2Name}</div>
  </div>
  {rows.map(row => (
    <div class="comparison-table__row" role="row">
      <div role="rowheader" class="comparison-table__cell comparison-table__cell--dim">{row.dimension}</div>
      <div role="cell" class="comparison-table__cell comparison-table__cell--val" data-label={approach1Name}>{row.approach1}</div>
      <div role="cell" class="comparison-table__cell comparison-table__cell--val" data-label={approach2Name}>{row.approach2}</div>
    </div>
  ))}
</div>

<style>
  .comparison-table {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 1fr 1fr;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    background: var(--bg-surface);
    font-size: 0.9375rem;
  }
  .comparison-table__header {
    display: contents;
  }
  .comparison-table__header [role="columnheader"] {
    background: var(--bg-surface);
    font-weight: 600;
    font-family: 'Cormorant Garamond', 'Georgia', serif;
    padding: var(--space-3) var(--space-4);
    border-bottom: 2px solid var(--border-color);
  }
  .comparison-table__row {
    display: contents;
  }
  .comparison-table__cell {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-color);
    line-height: 1.5;
  }
  .comparison-table__cell--dim {
    font-weight: 500;
    color: var(--text-secondary);
  }

  @media (max-width: 768px) {
    .comparison-table {
      grid-template-columns: 1fr;
    }
    .comparison-table__header {
      display: none;
    }
    .comparison-table__row {
      display: flex;
      flex-direction: column;
      padding: var(--space-4);
      border-bottom: 1px solid var(--border-color);
    }
    .comparison-table__cell {
      padding: var(--space-1) 0;
      border-bottom: none;
    }
    .comparison-table__cell--dim {
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .comparison-table__cell--val::before {
      content: attr(data-label);
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ComparisonTable.astro
git commit -m "feat: add ComparisonTable component with mobile stack layout"
```

### Task 5: Create ResearchHubBadge component

**Files:**
- Create: `src/components/ResearchHubBadge.astro`

- [ ] **Step 1: Write ResearchHubBadge.astro**

```astro
---
interface Props {
  hubSlug: string;
  hubTitle: string;
  articleCount: number;
}

const { hubSlug, hubTitle, articleCount } = Astro.props;
---

<a href={`/research/${hubSlug}/`} class="research-hub-badge">
  Part of <strong>{hubTitle}</strong> &middot; {articleCount} studies
</a>

<style>
  .research-hub-badge {
    display: inline-block;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    text-decoration: none;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .research-hub-badge:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .research-hub-badge strong {
    font-weight: 600;
    color: var(--text-primary);
  }
  .research-hub-badge:hover strong {
    color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ResearchHubBadge.astro
git commit -m "feat: add ResearchHubBadge inline component"
```

---

## Chunk 2: Research Hubs

### Task 6: Create research hub data file and loader

**Files:**
- Create: `src/data/research-hubs.json`
- Create: `src/data/comparisons.json` (empty array, prevents build failure when hub template tries to import it)
- Create: `src/lib/research-hubs.ts`

- [ ] **Step 1: Create stub research-hubs.json**

One entry (endometriosis). **Domain values must match articles.json exactly.**

```json
[
  {
    "slug": "endometriosis",
    "title": "Endometriosis Research",
    "seoTitle": "Endometriosis Research",
    "metaDescription": "Curated endometriosis research from peer-reviewed studies. Excision outcomes, diagnostic advances, fertility impact, and the restorative medicine approach.",
    "commentary": "<p>Placeholder. Editorial commentary by Dr. Whittaker will replace this.</p>",
    "filterDomains": ["Endometriosis"],
    "filterTopicPrefixes": ["Endometriosis"],
    "featuredArticleSlugs": [],
    "relatedFaqSlugs": [],
    "relatedPostSlugs": [],
    "relatedComparisonSlugs": [],
    "relatedHubSlugs": [],
    "providerLink": "/find-a-provider/",
    "publishedDate": "2026-04-01",
    "ready": false
  }
]
```

**Notes:**
- `relatedHubSlugs` is empty (not referencing non-existent hubs)
- `ready: false` -- pages with `ready: false` get `noindex` to prevent Google indexing placeholder content
- Domain values reference: Endometriosis, PCOS, Infertility, Pregnancy, Fertility Awareness, NaProTECHNOLOGY, Surgery, Menstrual Cycle, Reproductive Endocrinology, Perimenopause/Menopause, Contraception/Comparison, Andrology/Male Factor, General OB/GYN, Body Literacy/Education, Other

- [ ] **Step 2: Create empty comparisons.json**

```json
[]
```

This prevents Vite build failure when the research hub template imports it.

- [ ] **Step 3: Create research-hubs.ts**

```typescript
import type { Article } from './airtable';

export interface ResearchHub {
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  commentary: string;
  filterDomains: string[];
  filterTopicPrefixes: string[];
  featuredArticleSlugs: string[];
  relatedFaqSlugs: string[];
  relatedPostSlugs: string[];
  relatedComparisonSlugs: string[];
  relatedHubSlugs: string[];
  providerLink: string;
  publishedDate: string;
  ready: boolean;
}

export async function fetchAllHubs(): Promise<ResearchHub[]> {
  try {
    const cached = await import('../data/research-hubs.json');
    const hubs = (cached.default || cached) as ResearchHub[];
    console.log(`[research-hubs] Loaded ${hubs.length} hubs from cache`);
    return hubs;
  } catch {
    throw new Error('research-hubs.json not found.');
  }
}

export function getArticlesForHub(hub: ResearchHub, allArticles: Article[]): Article[] {
  return allArticles.filter(a =>
    hub.filterDomains.includes(a.domain) ||
    hub.filterTopicPrefixes.some(prefix =>
      (a.topics || []).some(t => t.startsWith(prefix))
    )
  ).sort((a, b) => (b.year || 0) - (a.year || 0));
}

export function getFeaturedArticles(hub: ResearchHub, allArticles: Article[]): Article[] {
  if (hub.featuredArticleSlugs.length === 0) return [];
  return hub.featuredArticleSlugs
    .map(slug => allArticles.find(a => a.slug === slug))
    .filter((a): a is Article => a !== undefined);
}

/**
 * Find which hub an article belongs to (for ResearchHubBadge).
 * Prefers domain match over topic prefix match.
 * Returns the first matching hub or undefined.
 */
export function findHubForArticle(article: Article, hubs: ResearchHub[]): ResearchHub | undefined {
  // First pass: exact domain match (highest signal)
  const domainMatch = hubs.find(hub => hub.filterDomains.includes(article.domain));
  if (domainMatch) return domainMatch;
  // Second pass: topic prefix match (broader)
  return hubs.find(hub =>
    hub.filterTopicPrefixes.some(prefix =>
      (article.topics || []).some(t => t.startsWith(prefix))
    )
  );
}

/**
 * Build-time validation: log warnings for any slug cross-references that don't resolve.
 * Call this in getStaticPaths to catch dangling refs early.
 */
export function validateHubCrossRefs(
  hubs: ResearchHub[],
  allFaqSlugs: Set<string>,
  allPostSlugs: Set<string>,
  allArticleSlugs: Set<string>,
) {
  const hubSlugs = new Set(hubs.map(h => h.slug));
  for (const hub of hubs) {
    for (const ref of hub.relatedHubSlugs) {
      if (!hubSlugs.has(ref)) console.warn(`[research-hubs] WARNING: "${hub.slug}" references non-existent hub "${ref}"`);
    }
    for (const ref of hub.relatedFaqSlugs) {
      if (!allFaqSlugs.has(ref)) console.warn(`[research-hubs] WARNING: "${hub.slug}" references non-existent FAQ "${ref}"`);
    }
    for (const ref of hub.relatedPostSlugs) {
      if (!allPostSlugs.has(ref)) console.warn(`[research-hubs] WARNING: "${hub.slug}" references non-existent post "${ref}"`);
    }
    for (const ref of hub.featuredArticleSlugs) {
      if (!allArticleSlugs.has(ref)) console.warn(`[research-hubs] WARNING: "${hub.slug}" references non-existent article "${ref}"`);
    }
    for (const ref of hub.relatedComparisonSlugs) {
      // Comparisons validated separately, but warn if slug looks wrong
      console.log(`[research-hubs] Note: "${hub.slug}" references comparison "${ref}" (validated when comparisons build)`);
    }
  }
}

/**
 * Build-time validation for comparison cross-references.
 * Call in comparison detail page's getStaticPaths.
 */
export function validateComparisonCrossRefs(
  comparisons: { slug: string; relatedHubSlugs: string[]; relatedComparisonSlugs: string[]; relatedPostSlugs: string[] }[],
  allHubSlugs: Set<string>,
  allPostSlugs: Set<string>,
) {
  const compSlugs = new Set(comparisons.map(c => c.slug));
  for (const comp of comparisons) {
    for (const ref of comp.relatedHubSlugs) {
      if (!allHubSlugs.has(ref)) console.warn(`[comparisons] WARNING: "${comp.slug}" references non-existent hub "${ref}"`);
    }
    for (const ref of comp.relatedComparisonSlugs) {
      if (!compSlugs.has(ref)) console.warn(`[comparisons] WARNING: "${comp.slug}" references non-existent comparison "${ref}"`);
    }
    for (const ref of comp.relatedPostSlugs) {
      if (!allPostSlugs.has(ref)) console.warn(`[comparisons] WARNING: "${comp.slug}" references non-existent post "${ref}"`);
    }
  }
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/data/research-hubs.json src/data/comparisons.json src/lib/research-hubs.ts
git commit -m "feat: add research hub data, empty comparisons stub, and loader with validation"
```

### Task 7: Create research hub pages

**Files:**
- Create: `src/pages/research/index.astro`
- Create: `src/pages/research/[...slug].astro`

- [ ] **Step 1: Create research hub index page**

Key elements:
- `<div class="page-wrapper" data-pagefind-ignore="all">`
- Breadcrumb: Home > Research (using `&rsaquo;` separator)
- Grid of hub cards with article counts
- Link to full library at bottom
- CollectionPage JSON-LD

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { fetchAllHubs, getArticlesForHub } from '../../lib/research-hubs';
import { fetchAllArticles } from '../../lib/airtable';

const hubs = await fetchAllHubs();
const articles = await fetchAllArticles();

// Only show hubs with real content (ready: true). Stubs are hidden.
const hubsWithCounts = hubs.filter(h => h.ready).map(hub => ({
  ...hub,
  articleCount: getArticlesForHub(hub, articles).length,
}));

const pageTitle = 'Research by Topic';
const metaDescription = 'Browse curated research collections across reproductive medicine topics. Peer-reviewed studies with expert commentary from Dr. Whittaker.';
const canonicalUrl = 'https://rrmacademy.org/research/';
const jsonLd = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: pageTitle, url: canonicalUrl, description: metaDescription };
---

<BaseLayout title={pageTitle} description={metaDescription} canonicalUrl={canonicalUrl} jsonLd={jsonLd}>
  <div class="page-wrapper" data-pagefind-ignore="all">
    <div class="container container--narrow">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> <span aria-hidden="true"> &rsaquo; </span>
        <span aria-current="page">Research</span>
      </nav>
      <h1>Research by Topic</h1>
      <p class="page-subtitle">Curated collections of peer-reviewed studies, each with expert commentary from Dr. Whittaker.</p>
      <div class="hub-grid">
        {hubsWithCounts.map(hub => (
          <a href={`/research/${hub.slug}/`} class="card hub-card">
            <h2 class="hub-card__title">{hub.title}</h2>
            <p class="hub-card__count">{hub.articleCount} peer-reviewed studies</p>
          </a>
        ))}
      </div>
      <div class="research-cta">
        <p>Looking for a specific study? <a href="/library/">Search the full library</a> of {articles.length.toLocaleString()}+ articles.</p>
      </div>
    </div>
  </div>
</BaseLayout>

<style>
  .page-subtitle { font-size: 1.0625rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: var(--space-8); }
  .hub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-5); margin-bottom: var(--space-10); }
  .hub-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-6); text-decoration: none; color: var(--text-primary); }
  .hub-card__title { font-family: 'Cormorant Garamond', 'Georgia', serif; font-size: 1.25rem; font-weight: 600; margin: 0; }
  .hub-card__count { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }
  .research-cta { text-align: center; color: var(--text-secondary); font-size: 0.9375rem; }
  .research-cta a { color: var(--accent); }
</style>
```

- [ ] **Step 2: Create research hub detail page**

Key design decisions addressing /arise findings:
- Article grid wrapped in `data-pagefind-ignore="all"` (prevents search pollution)
- Only `INITIAL_SHOW` (12) articles rendered; "View all in library" link for the rest (no dead button)
- Data passed through `getStaticPaths` props (matches existing pattern)
- `validateHubCrossRefs()` called at build time
- Conditional `noindex` when `hub.ready === false`

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import ArticleCard from '../../components/ArticleCard.astro';
import CrossLinkSection from '../../components/CrossLinkSection.astro';
import StucCallout from '../../components/StucCallout.astro';
import BackToTop from '../../components/BackToTop.astro';
import { fetchAllHubs, getArticlesForHub, getFeaturedArticles, validateHubCrossRefs, type ResearchHub } from '../../lib/research-hubs';
import { fetchAllArticles, type Article } from '../../lib/airtable';
import { fetchAllFaqs, type FAQ } from '../../lib/faq';
import { fetchAllPosts, type BlogPost } from '../../lib/blog';

export async function getStaticPaths() {
  const hubs = await fetchAllHubs();
  const allArticles = await fetchAllArticles();
  const allFaqs = await fetchAllFaqs();
  const allPosts = await fetchAllPosts();

  // Build-time validation: warn on dangling cross-references
  validateHubCrossRefs(
    hubs,
    new Set(allFaqs.map(f => f.slug)),
    new Set(allPosts.map(p => p.slug)),
    new Set(allArticles.map(a => a.slug)),
  );

  return hubs.map(hub => ({
    params: { slug: hub.slug },
    props: { hub, allArticles, allFaqs, allPosts, allHubs: hubs },
  }));
}

interface Props {
  hub: ResearchHub;
  allArticles: Article[];
  allFaqs: FAQ[];
  allPosts: BlogPost[];
  allHubs: ResearchHub[];
}

const { hub, allArticles, allFaqs, allPosts, allHubs } = Astro.props;

const hubArticles = getArticlesForHub(hub, allArticles);
const featured = getFeaturedArticles(hub, allArticles);
const articleCount = hubArticles.length;
const INITIAL_SHOW = 12;

// Resolve cross-references (filter out any that don't resolve)
const relatedFaqs = hub.relatedFaqSlugs
  .map(slug => allFaqs.find(f => f.slug === slug))
  .filter((f): f is FAQ => f !== undefined);

const relatedPosts = hub.relatedPostSlugs
  .map(slug => allPosts.find(p => p.slug === slug))
  .filter((p): p is BlogPost => p !== undefined);

const relatedHubs = hub.relatedHubSlugs
  .map(slug => allHubs.find(h => h.slug === slug))
  .filter((h): h is ResearchHub => h !== undefined);

// Comparisons (may be empty)
let relatedComparisons: { slug: string; title: string }[] = [];
try {
  const compData = await import('../../data/comparisons.json');
  const allComps = (compData.default || compData) as { slug: string; title: string }[];
  relatedComparisons = hub.relatedComparisonSlugs
    .map(slug => allComps.find(c => c.slug === slug))
    .filter((c): c is { slug: string; title: string } => c !== undefined);
} catch { /* comparisons.json is [] initially */ }

const nonFeatured = hubArticles.filter(a => !hub.featuredArticleSlugs.includes(a.slug));
const displayArticles = nonFeatured.slice(0, INITIAL_SHOW);
const remaining = nonFeatured.length - INITIAL_SHOW;

// Domain filter for "View all in library" link
const domainFilter = hub.filterDomains[0] || '';

const canonicalUrl = `https://rrmacademy.org/research/${hub.slug}/`;
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: hub.title,
  url: canonicalUrl,
  description: hub.metaDescription,
  numberOfItems: articleCount,
  breadcrumb: {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rrmacademy.org/' },
      { '@type': 'ListItem', position: 2, name: 'Research', item: 'https://rrmacademy.org/research/' },
      { '@type': 'ListItem', position: 3, name: hub.title },
    ],
  },
};
---

<BaseLayout title={hub.seoTitle} description={hub.metaDescription} canonicalUrl={canonicalUrl} jsonLd={jsonLd} noindex={!hub.ready}>
  <div class="page-wrapper" data-pagefind-body>
    <span data-pagefind-meta="type:Research Collection" style="display:none"></span>
    <div class="container container--narrow">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a> <span aria-hidden="true"> &rsaquo; </span>
        <a href="/research/">Research</a> <span aria-hidden="true"> &rsaquo; </span>
        <span aria-current="page">{hub.title}</span>
      </nav>

      <h1>{hub.title}</h1>
      <p class="hub-subtitle">{articleCount} peer-reviewed studies</p>

      <!-- Naomi's commentary (indexed by Pagefind) -->
      <div class="hub-commentary prose" set:html={hub.commentary} />

      <StucCallout context="research" />

      <!-- Article grids: NOT indexed by Pagefind (prevents search pollution) -->
      <div data-pagefind-ignore="all">
        {featured.length > 0 && (
          <section class="hub-featured" aria-label="Featured research">
            <h2 class="detail-heading">Featured Studies</h2>
            <div class="related-grid">
              {featured.map(article => (
                <ArticleCard article={article} compact />
              ))}
            </div>
          </section>
        )}

        <section class="hub-collection" aria-label="Recent studies">
          <h2 class="detail-heading">Recent Studies</h2>
          <div class="related-grid">
            {displayArticles.map(article => (
              <ArticleCard article={article} compact />
            ))}
          </div>
          {remaining > 0 && (
            <p class="hub-view-all">
              <a href={`/library/?topic=${encodeURIComponent(domainFilter)}`} class="btn btn--secondary">
                View all {articleCount} studies in the library
              </a>
            </p>
          )}
        </section>
      </div>

      <!-- Below-content cross-links (max 4 per spec) -->
      <CrossLinkSection
        heading="Common Questions"
        items={relatedFaqs.map(f => ({ href: `/faqs/${f.slug}/`, title: f.question }))}
        layout="list"
      />
      <CrossLinkSection
        heading="Dr. Whittaker's Commentary"
        items={relatedPosts.map(p => ({ href: `/commentary/${p.slug}/`, title: p.title }))}
        layout="list"
      />
      <CrossLinkSection
        heading="Related Comparisons"
        items={relatedComparisons.map(c => ({ href: `/compare/${c.slug}/`, title: c.title }))}
        layout="list"
      />
      <CrossLinkSection
        heading="Related Research Topics"
        items={relatedHubs.map(h => ({ href: `/research/${h.slug}/`, title: h.title }))}
        layout="pills"
      />
    </div>
    <BackToTop />
  </div>
</BaseLayout>

<style>
  .hub-subtitle { font-size: 1.0625rem; color: var(--text-secondary); margin-bottom: var(--space-6); }
  .hub-commentary { margin-bottom: var(--space-8); }
  .hub-featured { margin-top: var(--space-10); }
  .hub-collection { margin-top: var(--space-8); }
  .hub-view-all { text-align: center; margin-top: var(--space-6); }
  .related-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }
  @media (min-width: 640px) {
    .related-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (min-width: 1024px) {
    .related-grid { grid-template-columns: repeat(3, 1fr); }
  }
</style>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: `dist/research/index.html` and `dist/research/endometriosis/index.html` exist. Hub page has `<meta name="robots" content="noindex">` because `ready: false`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/research/
git commit -m "feat: add research hub index and detail pages with pagefind-ignore and noindex"
```

### Task 8: Add /research to router

**Files:**
- Modify: `~/iCode/projects/rrm-router/src/index.js`

- [ ] **Step 1: Add '/research' to ASTRO_ROUTES array**

```javascript
'/research',                     // Research topic hubs
```

- [ ] **Step 2: Commit in rrm-router repo**

```bash
cd ~/iCode/projects/rrm-router && git add src/index.js && git commit -m "feat: add /research to ASTRO_ROUTES"
```

---

## Chunk 3: Comparison Pages

### Task 9: Create comparison loader

**Files:**
- Modify: `src/data/comparisons.json` (add stub entry)
- Create: `src/lib/comparisons.ts`

- [ ] **Step 1: Add stub entry to comparisons.json**

```json
[
  {
    "slug": "excision-vs-ablation",
    "title": "Excision Surgery vs Ablation for Endometriosis",
    "seoTitle": "Excision vs Ablation: What the Evidence Shows",
    "metaDescription": "Compare excision surgery and ablation for endometriosis treatment. Evidence-based analysis of outcomes, recurrence rates, and fertility impact.",
    "heroSummary": "Placeholder. Editorial summary will replace this.",
    "approach1": { "name": "Excision Surgery", "description": "Placeholder." },
    "approach2": { "name": "Ablation", "description": "Placeholder." },
    "comparisonRows": [
      { "dimension": "Technique", "approach1": "Cuts out lesions", "approach2": "Burns surface tissue", "source": "" }
    ],
    "evidenceNarrative": "<p>Placeholder. Editorial evidence narrative will replace this.</p>",
    "faqs": [
      { "question": "Is excision better than ablation for endometriosis?", "schemaAnswer": "Placeholder schema answer.", "basicAnswer": "Placeholder." }
    ],
    "relatedHubSlugs": ["endometriosis"],
    "relatedComparisonSlugs": [],
    "relatedPostSlugs": [],
    "publishedDate": "2026-04-15",
    "ready": false
  }
]
```

- [ ] **Step 2: Create comparisons.ts**

```typescript
export interface ComparisonApproach {
  name: string;
  description: string;
}

export interface ComparisonRow {
  dimension: string;
  approach1: string;
  approach2: string;
  source?: string;
}

export interface ComparisonFAQ {
  question: string;
  schemaAnswer: string;
  basicAnswer: string;
}

export interface Comparison {
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  heroSummary: string;
  approach1: ComparisonApproach;
  approach2: ComparisonApproach;
  comparisonRows: ComparisonRow[];
  evidenceNarrative: string;
  faqs: ComparisonFAQ[];
  relatedHubSlugs: string[];
  relatedComparisonSlugs: string[];
  relatedPostSlugs: string[];
  publishedDate: string;
  ready: boolean;
}

export async function fetchAllComparisons(): Promise<Comparison[]> {
  try {
    const cached = await import('../data/comparisons.json');
    const comparisons = (cached.default || cached) as Comparison[];
    console.log(`[comparisons] Loaded ${comparisons.length} comparisons from cache`);
    return comparisons;
  } catch {
    throw new Error('comparisons.json not found.');
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/data/comparisons.json src/lib/comparisons.ts
git commit -m "feat: add comparison data stub and loader"
```

### Task 10: Create comparison pages

**Files:**
- Create: `src/pages/compare/index.astro`
- Create: `src/pages/compare/[...slug].astro`

- [ ] **Step 1: Create comparison index page**

Same pattern as research hub index. `data-pagefind-ignore="all"`. CollectionPage JSON-LD. Cards showing "A vs B" titles. **Filter to `ready: true` comparisons only** (same as research hub index).

- [ ] **Step 2: Create comparison detail page**

Key elements:
- `<div class="page-wrapper" data-pagefind-body>` + `<span data-pagefind-meta="type:Comparison">`
- Breadcrumb: Home > Compare > [Title]
- Hero summary
- ComparisonTable component
- Evidence narrative (`set:html`)
- FAQ accordion using existing `.faq-list`, `.faq-item`, `.faq-question`, `.faq-question-text`, `.faq-chevron`, `.faq-answer` classes from STYLE-GUIDE (NOT a new accordion pattern)
- FAQPage JSON-LD for the on-page FAQ content
- Below-content: CrossLinkSection for research hubs, related comparisons, commentary
- BackToTop
- Conditional `noindex={!comp.ready}`
- Schema: MedicalWebPage + Article + FAQPage + BreadcrumbList

```astro
import { validateComparisonCrossRefs } from '../../lib/research-hubs';

export async function getStaticPaths() {
  const comparisons = await fetchAllComparisons();
  const allHubs = await fetchAllHubs();
  const allPosts = await fetchAllPosts();

  // Build-time validation for dangling cross-references
  validateComparisonCrossRefs(
    comparisons,
    new Set(allHubs.map(h => h.slug)),
    new Set(allPosts.map(p => p.slug)),
  );

  return comparisons.map(comp => ({
    params: { slug: comp.slug },
    props: { comp, allHubs, allPosts, allComps: comparisons },
  }));
}
```

Resolve cross-references the same way as research hubs (`.find()` + `.filter(Boolean)`).

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: `dist/compare/index.html` and `dist/compare/excision-vs-ablation/index.html` exist. Comparison page has noindex.

- [ ] **Step 4: Commit**

```bash
git add src/pages/compare/
git commit -m "feat: add comparison index and detail pages with noindex for stubs"
```

### Task 11: Add /compare to router

**Files:**
- Modify: `~/iCode/projects/rrm-router/src/index.js`

- [ ] **Step 1: Add '/compare' to ASTRO_ROUTES**

- [ ] **Step 2: Commit**

```bash
cd ~/iCode/projects/rrm-router && git add src/index.js && git commit -m "feat: add /compare to ASTRO_ROUTES"
```

---

## Chunk 4: Glossary v2 (Hybrid Approach)

**Key /arise fix:** The glossary prose stays in Astro. We only data-drive the outbound links (to research hubs, FAQs, comparisons). This preserves all 58 citations, tables, formatting, editorial notices, TOC, and references.

### Task 12: Create glossary outbound links data file

**Files:**
- Create: `src/data/glossary-outbound-links.json`

- [ ] **Step 1: Read the current glossary page**

Read `src/pages/glossary/index.astro` in full. Identify every term's anchor ID (the `id` attribute on its heading or container).

- [ ] **Step 2: Create glossary-outbound-links.json**

Map term slugs to their outbound link targets. Only terms with real connections get entries. Start with a few key terms:

```json
{
  "endometriosis": {
    "researchHubSlugs": ["endometriosis"],
    "faqSlugs": [],
    "comparisonSlugs": ["excision-vs-ablation"],
    "pillarGuideSlugs": []
  },
  "excision-surgery": {
    "researchHubSlugs": ["endometriosis"],
    "faqSlugs": [],
    "comparisonSlugs": ["excision-vs-ablation"],
    "pillarGuideSlugs": []
  }
}
```

Most terms start with empty arrays. Links are added incrementally as research hubs and comparisons are published.

- [ ] **Step 3: Commit**

```bash
git add src/data/glossary-outbound-links.json
git commit -m "feat: add glossary outbound links data file"
```

### Task 13: Add outbound links to glossary page

**Files:**
- Modify: `src/pages/glossary/index.astro`

- [ ] **Step 1: Read glossary page in full**

Understand the term rendering structure. Find where each term's content ends (before the next term heading).

- [ ] **Step 2: Import outbound links data and hub titles**

In the frontmatter:

```astro
import { fetchAllHubs } from '../../lib/research-hubs';
import { fetchAllComparisons } from '../../lib/comparisons';
import { fetchAllFaqs } from '../../lib/faq';

const hubs = await fetchAllHubs();
const comparisons = await fetchAllComparisons();
const faqs = await fetchAllFaqs();

// Import outbound links
const outboundData = await import('../../data/glossary-outbound-links.json');
const outboundLinks = (outboundData.default || outboundData) as Record<string, {
  researchHubSlugs: string[];
  faqSlugs: string[];
  comparisonSlugs: string[];
  pillarGuideSlugs: string[];
}>;

// Build lookup maps
const hubMap = new Map(hubs.map(h => [h.slug, h.title]));
const compMap = new Map(comparisons.map(c => [c.slug, c.title]));
const faqMap = new Map(faqs.map(f => [f.slug, f.question]));
```

- [ ] **Step 3: Create a helper component for "See also" links**

Add a small inline helper at the bottom of the page (or create `GlossarySeeAlso.astro`). For each term's anchor, add a "See also" line after the term's prose:

```astro
<!-- After a term's content, e.g., after the endometriosis paragraphs -->
{outboundLinks['endometriosis'] && (() => {
  const links = outboundLinks['endometriosis'];
  const items = [
    ...links.researchHubSlugs.filter(s => hubMap.has(s)).map(s => ({ href: `/research/${s}/`, label: hubMap.get(s)! })),
    ...links.comparisonSlugs.filter(s => compMap.has(s)).map(s => ({ href: `/compare/${s}/`, label: compMap.get(s)! })),
    ...links.faqSlugs.filter(s => faqMap.has(s)).map(s => ({ href: `/faqs/${s}/`, label: faqMap.get(s)! })),
  ];
  return items.length > 0 ? (
    <p class="glossary-see-also">
      See also: {items.map((item, i) => (
        <><a href={item.href}>{item.label}</a>{i < items.length - 1 ? ', ' : ''}</>
      ))}
    </p>
  ) : null;
})()}
```

**Practical approach:** Since each term is hardcoded in the Astro template, add the "See also" lines by hand to terms that have outbound links. This is manageable because only ~10-15 terms will have links initially. As more hubs/comparisons are published, add more "See also" lines.

- [ ] **Step 4: Add CSS for `.glossary-see-also`**

```css
.glossary-see-also {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-top: var(--space-2);
  font-style: italic;
}
.glossary-see-also a {
  color: var(--accent);
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Check that the glossary page renders with "See also" links for endometriosis and excision-surgery terms.

- [ ] **Step 6: Commit**

```bash
git add src/pages/glossary/index.astro
git commit -m "feat: add outbound links to glossary terms (hybrid approach)"
```

---

## Chunk 5: Cross-Link Upgrades to Existing Pages

### Task 14: Add ResearchHubBadge to library article detail

**Files:**
- Modify: `src/pages/library/[...slug].astro`

- [ ] **Step 1: Read library article detail page**

Find the Topics section. Note that `allArticles` is already available via `getStaticPaths` props.

- [ ] **Step 2: Import hub data and add badge**

In the existing `getStaticPaths`, add hub loading:

```astro
import ResearchHubBadge from '../../components/ResearchHubBadge.astro';
import { fetchAllHubs, findHubForArticle, getArticlesForHub } from '../../lib/research-hubs';

// Inside getStaticPaths:
const allHubs = await fetchAllHubs();

// In the return, add allHubs to props:
props: { article, allArticles, allHubs },
```

Update the Props interface and destructuring to include `allHubs`.

In the template, above or below the Topics section:

```astro
{(() => {
  const matchingHub = findHubForArticle(article, allHubs);
  if (!matchingHub) return null;
  const hubArticleCount = getArticlesForHub(matchingHub, allArticles).length;
  return <ResearchHubBadge hubSlug={matchingHub.slug} hubTitle={matchingHub.title} articleCount={hubArticleCount} />;
})()}
```

Uses `allArticles` from existing props (NOT a redundant re-fetch).

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/library/[...slug].astro
git commit -m "feat: add ResearchHubBadge to library article detail"
```

### Task 15: Add "Research Collections" section to library landing

**Files:**
- Modify: `src/pages/library/index.astro`

**Key /arise fix:** Topic pills stay as `?topic=X` library filters (preserving in-place browse). A new "Research Collections" section is added separately below.

- [ ] **Step 1: Read library landing page**

Find the topic-links nav and the "Recent additions" section.

- [ ] **Step 2: Add Research Collections section between topic pills and recent additions**

```astro
import { fetchAllHubs, getArticlesForHub } from '../../lib/research-hubs';
const hubs = await fetchAllHubs();
const readyHubs = hubs.filter(h => h.ready);
```

Between the topic-links nav and "Recent additions":

```astro
{readyHubs.length > 0 && (
  <section class="research-collections animate-enter" style="--stagger: 5;" aria-label="Research collections">
    <h2 class="detail-heading">Research Collections</h2>
    <p class="collections-subtitle">Curated studies with expert commentary</p>
    <div class="collections-grid">
      {readyHubs.map(hub => {
        const count = getArticlesForHub(hub, articles).length;
        return (
          <a href={`/research/${hub.slug}/`} class="card collection-card">
            <span class="collection-card__title">{hub.title}</span>
            <span class="collection-card__count">{count} studies</span>
          </a>
        );
      })}
    </div>
  </section>
)}
```

Only shows hubs where `ready: true`. When no hubs are ready, section is hidden entirely.

- [ ] **Step 3: Add CSS**

```css
.collections-subtitle { font-size: 0.9375rem; color: var(--text-secondary); margin-bottom: var(--space-4); }
.collections-grid { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-8); }
.collection-card { display: flex; flex-direction: column; padding: var(--space-4) var(--space-5); text-decoration: none; gap: var(--space-1); }
.collection-card__title { font-weight: 500; color: var(--text-primary); font-size: 0.9375rem; }
.collection-card__count { font-size: 0.8125rem; color: var(--text-secondary); }
```

- [ ] **Step 4: Verify build**

- [ ] **Step 5: Commit**

```bash
git add src/pages/library/index.astro
git commit -m "feat: add Research Collections section to library landing"
```

### Task 16: Add StucCallout to FAQ detail (alongside existing CTA)

**Files:**
- Modify: `src/pages/faqs/[...slug].astro`

**Key /arise fix:** Keep existing "Ready to go deeper?" CTA. Add StucCallout below it, not replacing it. The existing CTA is removed later when inline course/library links are added to FAQ prose editorially.

- [ ] **Step 1: Import StucCallout**

```astro
import StucCallout from '../../components/StucCallout.astro';
```

- [ ] **Step 2: Add StucCallout after existing CTA section**

After the existing `<section class="faq-cta">...</section>`:

```astro
      <StucCallout context="faq" />
```

- [ ] **Step 3: Verify build**

- [ ] **Step 4: Commit**

```bash
git add src/pages/faqs/[...slug].astro
git commit -m "feat: add StucCallout to FAQ detail pages"
```

### Task 17: Add StucCallout to commentary post detail

**Files:**
- Modify: `src/pages/commentary/[...slug].astro`

- [ ] **Step 1: Add StucCallout after "More from this series"**

```astro
import StucCallout from '../../components/StucCallout.astro';
```

After the related posts section:

```astro
    <div class="container container--narrow">
      <StucCallout context="commentary" />
    </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/commentary/[...slug].astro
git commit -m "feat: add StucCallout to commentary post detail"
```

---

## Chunk 6: Build Verification and Guards

### Task 18: Add deploy guard for new data files

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add minimum record counts**

Add to the deploy guard section:

```yaml
# New content expansion files (>= 1 prevents empty array deploys)
HUBS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('src/data/research-hubs.json','utf8')).length)")
COMPS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('src/data/comparisons.json','utf8')).length)")
if [ "$HUBS" -lt 1 ]; then echo "ERROR: research-hubs.json is empty"; exit 1; fi
```

Note: comparisons.json starts as `[]` (0 entries) intentionally. Only add a guard for it once the first comparison is published. Guard research-hubs.json >= 1 immediately.

- [ ] **Step 2: Add new git-committed JSON files to cache restore**

In the data cache restore step, add:

```yaml
git checkout HEAD -- src/data/research-hubs.json src/data/comparisons.json src/data/glossary-outbound-links.json
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add deploy guard for research-hubs.json and cache restore for new data files"
```

### Task 19: Update verify-templates.mjs

**Files:**
- Modify: `scripts/verify-templates.mjs`

- [ ] **Step 1: Read current verify-templates.mjs**

- [ ] **Step 2: Add structural checks**

- Research hub detail pages contain CollectionPage schema
- Comparison detail pages contain FAQPage schema
- Research hub index exists
- Comparison index exists
- Hub pages with `ready: false` have noindex meta tag
- Comparison pages with `ready: false` have noindex meta tag

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-templates.mjs
git commit -m "feat: add template verification for research hubs and comparisons"
```

### Task 20: Full build verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

- [ ] **Step 2: Verify output files exist**

- `dist/research/index.html`
- `dist/research/endometriosis/index.html`
- `dist/compare/index.html`
- `dist/compare/excision-vs-ablation/index.html`
- `dist/glossary/index.html` (still works)

- [ ] **Step 3: Verify Pagefind indexing**

Research hub detail: `data-pagefind-body` on wrapper, `data-pagefind-ignore` on article grid
Comparison detail: `data-pagefind-body` + `data-pagefind-meta="type:Comparison"`
Indexes: `data-pagefind-ignore="all"`

- [ ] **Step 4: Verify noindex on stub pages**

Both research hub and comparison stub pages should have `<meta name="robots" content="noindex">`.

- [ ] **Step 5: Verify build-time validation warnings**

Check build output for any `[research-hubs] WARNING:` messages about dangling cross-references.

---

## What's NOT in This Plan

These are ongoing editorial processes or deferred items:

1. **Writing research hub commentary** -- rrm-cli research -> Gianna draft -> Brian review -> update JSON.
2. **Writing comparison content** -- rrm-cli + Perplexity research -> Gianna draft -> Brian review -> citation verification -> update JSON.
3. **Additional research hubs** (9 more) -- add entries to research-hubs.json as ready.
4. **Additional comparisons** (3-9 more) -- add entries to comparisons.json as ready.
5. **Cross-links from pillar guides** -- inline links within editorial prose, added during pillar page refinement.
6. **Condition x city pages** -- deferred until provider directory has 500+ medical practitioners with >50% telehealth data.
7. **Homepage Find-a-Provider link** -- blocked on Find-a-Provider plan completion.
8. **Course detail cross-links** (background reading + commentary) -- deferred. Spec shows below-content for courses -> library and courses -> commentary, but courses have their own enrollment flow. Cross-links added when course completion UX is finalized.
9. **Vectorize embedding update** -- update `scripts/embed-library-ci.mjs` to include research hub commentary and comparison content in semantic search. Follow-up after templates are validated.
10. **Commentary cross-links on library/FAQ pages** -- originally planned as keyword-matched heuristics (Tasks 16b-16d in v1). Removed because keyword matching produces noisy results. Instead: add explicit `relatedPostSlugs` or `relatedDomains` fields to blog posts in Airtable, then implement cross-links using those curated references. This is an editorial + data task, not infrastructure.
11. **Removing "Ready to go deeper?" CTA** -- keep until inline course/library links exist in FAQ prose. StucCallout sits alongside it for now.
