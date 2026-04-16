# Programmatic Content Expansion -- Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build five interconnected content directory types -- condition pages, condition x city pages, comparison pages, research topic hubs, and glossary retrofit -- that transform the existing library, practitioner directory, FAQs, and glossary into a topical authority graph that dominates both traditional search and AI citation.

**Architecture:** Static generation via Astro `getStaticPaths()` from curated JSON data files + D1 practitioner data. Each new page type cross-links to every other content type (library articles, practitioners, FAQs, glossary terms, courses, commentary). Data lives in hand-curated JSON files (not auto-generated from article domains) because medical content requires editorial control. Condition pages are the hub; everything else spokes off them.

**Tech Stack:** Astro 5.3 (static), existing design system (STYLE-GUIDE.md), D1 practitioner data (via practitioners.json), existing articles.json/faqs.json, new curated JSON data files, MedicalWebPage + FAQPage + MedicalCondition JSON-LD.

**Depends on:** Find-a-Provider plan (`2026-03-16-find-a-provider-plan.md`) must complete Phase 1-3 first. Condition x City pages query practitioner data.

---

## Editorial Rules (All Phases)

Every content-producing task in this plan must follow these rules. Implementing agents: read this section before drafting any content.

1. **Never recommend IVF** or include "When IVF May Be Appropriate" sections. RRM Academy educates about RRM, not IVF.
2. **"Clinicians" not "physicians"** in all RRM/NaPro content.
3. **"Underlying condition" not "root cause"** for NaPro-specific content (NaPro founders do not consider themselves under RRM).
4. **Cost comparison anchoring:** IVF costs first ($40-60K), then RRM as "fraction of that." The "20x less" figure is HALLUCINATED -- never use. Never lead with RRM dollar amounts.
5. **REIs are IVF doctors**, never RRM clinicians. RCTs are a double standard, not a legitimate critique.
6. **No performative honesty or self-undercutting evidence.** No "to be fair, IVF has better data."
7. **Use HFEA** (mandatory reporting) for IVF data, never SART/CDC (voluntary).
8. **All statistics must come from the library (rrm-cli) or Perplexity research.** Never generate PMIDs, DOIs, or references from model knowledge.
9. **Bold lead phrases must be complete citable statements** with "RRM" as subject so AI snippets have context.
10. **Question-format H2/H3 headings** for AEO optimization throughout.
11. **RRM is not fertility-only.** Fertility is one outcome, not the definition. Do not assume the reader is trying to conceive.
12. **Insurance billing is complex.** Never oversimplify or overstate ease of coverage.
13. **Content voice:** Use `gianna-copywriter` agent for all patient-facing content. Ground in library via `rrm-cli search --intent=voice`.

---

## URL Structure Decision

**IMPORTANT: This plan changes the prior IA decision in CLAUDE.md.**

CLAUDE.md currently states: "Future pillar guides (`/endometriosis/`, `/pcos/`, etc.) also go at root."

This plan uses `/conditions/{slug}/` instead. Rationale: condition pages are a **directory** (15+ pages with an index), not individual pillar guides. Pillar guides are framework-level explainers (5 pages); condition pages are condition-specific hubs. Different intent, different URL pattern.

**Required action:** After Brian approves this plan, update CLAUDE.md's Information Architecture section to replace the "Future pillar guides" note with: "Condition-specific pages live under `/conditions/` as a directory. Pillar guides remain at root."

---

## Scope & Priority

This plan covers 5 content types in priority order:

| # | Content Type | Pages | Effort | Impact | Phase |
|---|-------------|-------|--------|--------|-------|
| 1 | Condition pages | 15-20 | High | Highest -- hub for all cross-links | A |
| 2 | Condition x City pages | 200+ | Medium (programmatic) | High -- zero-competition local SEO | B |
| 3 | Comparison pages | 8-12 | Medium (editorial) | High -- AEO citation magnets | C |
| 4 | Research topic hubs | 10-15 | Low-Medium | Medium -- leverage existing library | D |
| 5 | Glossary v2 retrofit | 60-80 terms | Low (incremental) | Medium -- citable snippet per term | E |

Phases are sequential. Each phase ships independently and adds cross-links to prior phases.

---

## Data Architecture

### New data files

| File | Purpose | Source | Size |
|------|---------|--------|------|
| `src/data/conditions.json` | Curated condition definitions, stats, cross-links | Hand-authored, Gianna voice | ~100KB |
| `src/data/comparisons.json` | Comparison page content | Hand-authored, Gianna voice | ~80KB |
| `src/data/research-hubs.json` | Topic hub definitions + article filters | Hand-authored + auto-filtered | ~30KB |
| `src/data/glossary-terms.json` | Glossary v2 entries (definition + RRM relevance) | Extracted from glossary.astro + new | ~60KB |

### conditions.json schema

```json
{
  "slug": "endometriosis",
  "title": "Endometriosis",
  "seoTitle": "Endometriosis: RRM Approach, Treatment & Research",
  "metaDescription": "Learn how restorative reproductive medicine approaches endometriosis through excision surgery, cycle charting, and treating the underlying condition.",
  "heroSummary": "A 2-3 sentence citable summary for AI engines",
  "sections": [
    {
      "id": "what-is",
      "heading": "What is endometriosis?",
      "content": "<p>HTML content</p>"
    },
    {
      "id": "rrm-approach",
      "heading": "How does RRM approach endometriosis?",
      "content": "<p>HTML content</p>"
    },
    {
      "id": "diagnosis",
      "heading": "How is endometriosis diagnosed?",
      "content": "<p>HTML content</p>"
    },
    {
      "id": "treatment",
      "heading": "How is endometriosis treated in RRM?",
      "content": "<p>HTML content</p>"
    },
    {
      "id": "research",
      "heading": "What does the research say?",
      "content": "<p>HTML content</p>"
    },
    {
      "id": "finding-care",
      "heading": "How do I find care?",
      "content": "<p>HTML content</p>"
    }
  ],
  "faqs": [
    {
      "question": "Can endometriosis be treated without surgery?",
      "schemaAnswer": "80-120 word answer for JSON-LD",
      "basicAnswer": "1-2 sentence version"
    }
  ],
  "stats": [
    { "value": "1 in 10", "label": "women affected", "source": "WHO" },
    { "value": "7-10 years", "label": "average diagnosis delay", "source": "PMID:12345678" }
  ],
  "libraryDomains": ["Endometriosis"],
  "libraryTopicPrefixes": ["Endometriosis"],
  "relatedFaqSlugs": ["can-rrm-treat-endometriosis", "what-is-excision-surgery"],
  "relatedGlossaryTerms": ["endometriosis", "excision-surgery", "ablation"],
  "relatedConditions": ["pcos", "infertility", "pelvic-pain"],
  "relatedComparisons": ["excision-vs-ablation", "napro-vs-ivf-for-endometriosis"],
  "practitionerMethodFilter": "napro",
  "publishedDate": "2026-04-01",
  "lastUpdated": "2026-04-01"
}
```

### comparisons.json schema

```json
{
  "slug": "excision-vs-ablation",
  "title": "Excision Surgery vs Ablation for Endometriosis",
  "seoTitle": "Excision vs Ablation: What the Evidence Shows",
  "metaDescription": "Compare excision surgery and ablation for endometriosis treatment. Evidence-based analysis of outcomes, recurrence rates, and fertility impact.",
  "heroSummary": "2-3 sentence citable summary",
  "approach1": {
    "name": "Excision Surgery",
    "description": "Brief description",
    "strengths": ["list"],
    "limitations": ["list"]
  },
  "approach2": {
    "name": "Ablation",
    "description": "Brief description",
    "strengths": ["list"],
    "limitations": ["list"]
  },
  "comparisonTable": [
    { "dimension": "Recurrence rate", "approach1": "Data point", "approach2": "Data point", "source": "PMID or library slug" }
  ],
  "evidenceSummary": "<p>HTML editorial analysis</p>",
  "faqs": [],
  "relatedConditions": ["endometriosis"],
  "relatedLibraryDomains": ["Endometriosis", "Surgery"],
  "publishedDate": "2026-04-15"
}
```

### research-hubs.json schema

```json
{
  "slug": "endometriosis",
  "title": "Endometriosis Research",
  "seoTitle": "Endometriosis Research Library | RRM Academy",
  "metaDescription": "Curated endometriosis research from 190+ peer-reviewed studies. Excision outcomes, diagnostic advances, and fertility impact.",
  "introduction": "<p>Naomi commentary HTML</p>",
  "filterDomains": ["Endometriosis"],
  "filterTopicPrefixes": ["Endometriosis"],
  "highlightedArticleSlugs": ["editorial-picks-for-featured-section"],
  "relatedConditionSlug": "endometriosis",
  "articleCount": 191,
  "publishedDate": "2026-05-01"
}
```

---

## Condition Page List (Phase A)

Based on library domain counts, FAQ coverage, and search intent:

| # | Condition | Library articles | Search intent | Notes |
|---|-----------|-----------------|---------------|-------|
| 1 | Endometriosis | 191 | Very high | Endo survey exists, excision angle unique |
| 2 | PCOS | 155 | Very high | Metabolic + hormonal, strong RRM angle |
| 3 | Infertility (unexplained) | 384 | Very high | Core RRM differentiator vs IVF |
| 4 | Recurrent pregnancy loss | ~80 (Pregnancy domain) | High | NaPro progesterone protocol unique |
| 5 | Thyroid dysfunction | ~50 (Repro Endo) | High | Underdiagnosed, strong charting signal |
| 6 | Luteal phase defect | ~40 (Repro Endo) | Medium-High | Classic NaPro diagnosis |
| 7 | Anovulation | ~30 (Repro Endo) | Medium | Charting reveals it |
| 8 | Pelvic pain | ~40 (various) | Medium-High | Broader than endo |
| 9 | Male factor infertility | 56 | Medium | Underserved in RRM content |
| 10 | PMS/PMDD | ~25 (Menstrual Cycle) | Medium | High search volume |
| 11 | Perimenopause | 105 | Medium | Growing search demand |
| 12 | Fibroids/polyps | ~20 (Surgery) | Medium | Surgical RRM angle |
| 13 | Adenomyosis | ~15 (Endo adjacent) | Medium | Often confused with endo |
| 14 | Chronic endometritis | ~10 | Lower | Emerging research |
| 15 | Ovarian cysts | ~15 | Medium | Common concern, NaPro approach |

Start with top 8 (endometriosis through pelvic pain). Add 9-15 in a second wave.

---

## Comparison Page List (Phase C)

| # | Comparison | AEO value | Notes |
|---|-----------|-----------|-------|
| 1 | Excision vs ablation for endometriosis | Very high | RRM-unique angle, data-rich |
| 2 | NaProTechnology vs IVF for infertility | Very high | THE core comparison. Careful framing (never recommend IVF) |
| 3 | NaPro vs IVF for PCOS | High | Condition-specific version |
| 4 | NaPro vs IVF for recurrent miscarriage | High | Progesterone protocol angle |
| 5 | Creighton vs Marquette method | Medium | Method comparison, not treatment |
| 6 | Creighton vs sympto-thermal | Medium | Charting method comparison |
| 7 | Letrozole vs Clomid for ovulation induction | High | Evidence-based, RRM uses both |
| 8 | Hormonal suppression vs restorative treatment | Very high | Philosophical comparison |
| 9 | NaPro vs FEMM approach | Medium | Inter-framework comparison |
| 10 | Laparoscopic excision vs robotic excision | Medium | Surgical technique comparison |

Start with 1-4 (highest AEO value). Add 5-10 later.

---

## Research Hub List (Phase D)

One hub per condition page + additional topic hubs:

| Hub | Filter domains | Articles |
|-----|---------------|----------|
| Endometriosis | Endometriosis | 191 |
| PCOS | PCOS | 155 |
| Infertility | Infertility | 384 |
| Pregnancy & RPL | Pregnancy | 349 |
| NaProTECHNOLOGY | NaProTECHNOLOGY | 142 |
| Fertility Awareness Methods | Fertility Awareness | 329 |
| Male Factor | Andrology/Male Factor | 56 |
| Surgery & Excision | Surgery | 139 |
| Hormones & Cycle Science | Menstrual Cycle, Reproductive Endocrinology | 624 |
| Perimenopause & Menopause | Perimenopause/Menopause | 105 |

---

## URL Structure

All new content types live at root or under purpose-built directories:

| Content type | URL pattern | Example |
|-------------|------------|---------|
| Condition pages | `/conditions/{slug}/` | `/conditions/endometriosis/` |
| Condition x City | `/find/{condition}/{city-state}/` | `/find/endometriosis/harrisburg-pa/` |
| Comparisons | `/compare/{slug}/` | `/compare/excision-vs-ablation/` |
| Research hubs | `/research/{slug}/` | `/research/endometriosis/` |
| Glossary terms | `/glossary/{slug}/` | `/glossary/endometriosis/` (detail) |
| Glossary index | `/glossary/` | `/glossary/` (existing, keep) |

**Decision rationale:**
- `/conditions/` not root-level: unlike pillar guides (5 pages), conditions are a directory (15+). A parent path is appropriate and helps AI models understand the taxonomy
- `/find/` for condition x city: short, action-oriented, parallels `/find-a-provider/`. Avoids `/conditions/endometriosis/harrisburg-pa/` depth
- `/compare/` is clear intent signaling for both users and AI
- `/research/` parallels library but adds editorial curation layer
- `/glossary/{slug}/` adds detail pages under existing glossary index

---

## Component Architecture

### New components

| Component | Purpose | Used by |
|-----------|---------|---------|
| `ConditionCard.astro` | Card for condition listings | Condition index, related conditions |
| `ComparisonTable.astro` | Side-by-side comparison table | Comparison pages |
| `ResearchHubGrid.astro` | Filtered article grid with domain counts | Research hub pages |
| `StatBadge.astro` | Statistic display (value + label + source) | Condition pages, comparisons |
| `CrossLinkSection.astro` | Reusable "Related [type]" section | All new page types |
| `ConditionCityCard.astro` | Card for city-specific practitioner results | Condition x City pages |

### Existing components to reuse

| Component | Usage |
|-----------|-------|
| `ArticleCard.astro` | Research hub article grids |
| `BackToTop.astro` | All new long-form pages |
| `Citation.astro` | Research hubs, condition pages |
| `TopicTag.astro` | Condition pills on research hubs |
| `BaseLayout.astro` | All pages (title, meta, schema) |

---

## Router Updates

Add to `ASTRO_ROUTES` in `~/iCode/projects/rrm-router/src/index.js`:

```js
'/conditions',      // Condition directory
'/compare',         // Comparison pages
'/research',        // Research topic hubs
'/find',            // Condition x City (separate from /find-a-provider)
```

`/glossary` is already routed (existing pillar page).

---

## Cross-Linking Strategy

Every new page type links to every other. This is the topical authority graph:

```
                    ┌──────────────┐
                    │  CONDITIONS  │ ← hub
                    └──────┬───────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  RESEARCH   │ │  PROVIDERS  │ │ COMPARISONS │
    │    HUBS     │ │ (find-a-    │ │  (compare/) │
    │ (research/) │ │  provider/) │ │             │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  LIBRARY    │ │ COND x CITY │ │    FAQs     │
    │  ARTICLES   │ │  (find/)    │ │             │
    └─────────────┘ └─────────────┘ └─────────────┘
           │               │               │
           └───────────────┼───────────────┘
                    ┌──────▼──────┐
                    │  GLOSSARY   │
                    │   TERMS     │
                    └─────────────┘
```

### Link placement per page type

| Page type | Links TO |
|-----------|----------|
| Condition page | Research hub, related FAQs, related glossary terms, comparison pages, practitioners (filtered), library (filtered), related conditions, courses |
| Condition x City | Condition page, practitioners in that city, state provider page |
| Comparison page | Both condition pages, research hub, related FAQs, library articles cited |
| Research hub | Condition page, highlighted articles, commentary posts by topic, related FAQs |
| Glossary term detail | Condition page (if condition term), related glossary terms, library search link |

### Links FROM existing pages

| Existing page | New links |
|---------------|-----------|
| Library article detail | Condition page badge (based on domain) |
| FAQ detail | Condition page link (if condition-specific) |
| Pillar guides | Condition pages section, comparison pages |
| Commentary posts | Condition page links (manual, per-post) |
| Homepage | Conditions section (top 8 conditions as cards) |
| `/find-a-provider/` state pages | Condition x City links for that state |
| Glossary index | Links to individual glossary term detail pages |

---

## Schema Markup

| Page type | JSON-LD |
|-----------|---------|
| Condition page | MedicalCondition + MedicalWebPage + FAQPage + BreadcrumbList |
| Condition x City | MedicalBusiness (aggregate) + BreadcrumbList |
| Comparison page | MedicalWebPage + Article + FAQPage + BreadcrumbList |
| Research hub | CollectionPage + BreadcrumbList |
| Glossary term detail | DefinedTerm + MedicalWebPage + BreadcrumbList |

---

## Phase A: Condition Pages

### Prerequisites
- Read `STYLE-GUIDE.md`, `CLAUDE.md`, this plan
- Existing pillar page patterns (especially `/what-is-rrm/index.astro`)
- `rrm-cli` available for voice/framing reference

### Task A1: Create conditions.json -- Endometriosis (first entry)

**Files:**
- Create: `src/data/conditions.json`

This is an editorial task. Content must be written in Gianna (Dr. Whittaker) voice using the `gianna-copywriter` agent, grounded in library research via `rrm-cli`. See "Editorial Rules" section above.

Each condition follows the same cycle: research -> draft -> validate citations -> assemble JSON.

- [ ] **Step 1: Research endometriosis via rrm-cli**

```bash
rrm-cli search "endometriosis treatment outcomes" --intent=cite --full --limit=10
rrm-cli search "endometriosis excision" --intent=voice --full --limit=5
rrm-cli search "endometriosis diagnosis" --intent=cite --full --limit=5
```

- [ ] **Step 2: Draft endometriosis entry via Gianna agent**

Dispatch `gianna-copywriter` agent with research results. Output: all sections, FAQs, stats, cross-link references for the endometriosis entry per the conditions.json schema.

- [ ] **Step 3: Validate citations**

```bash
# For each PMID or library slug referenced
rrm-cli get article <slug> --full
```

- [ ] **Step 4: Assemble into conditions.json**

Create `src/data/conditions.json` as an array with the endometriosis entry. Verify all `relatedFaqSlugs` exist in faqs.json, all `libraryDomains` match real domain values.

- [ ] **Step 5: Commit**

```bash
git add src/data/conditions.json
git commit -m "feat: add conditions.json with endometriosis entry"
```

### Task A1b: Add PCOS condition entry

- [ ] **Step 1: Research PCOS** (same rrm-cli pattern)
- [ ] **Step 2: Draft via Gianna agent**
- [ ] **Step 3: Validate citations**
- [ ] **Step 4: Add to conditions.json**
- [ ] **Step 5: Commit**

### Task A1c: Add unexplained infertility condition entry

- [ ] **Step 1-5:** Same cycle as above.

### Task A1d: Add recurrent pregnancy loss condition entry

- [ ] **Step 1-5:** Same cycle as above.

### Task A1e: Add remaining 4 conditions (thyroid, luteal phase, anovulation, pelvic pain)

These can be batched since the pattern is established.

- [ ] **Step 1: Research all 4 conditions**
- [ ] **Step 2: Draft all 4 via Gianna agent (parallel if possible)**
- [ ] **Step 3: Validate all citations**
- [ ] **Step 4: Add all 4 to conditions.json**
- [ ] **Step 5: Commit**

```bash
git add src/data/conditions.json
git commit -m "feat: add 4 more condition entries (thyroid, luteal phase, anovulation, pelvic pain)"
```

### Task A2: Create ConditionCard component

**Files:**
- Create: `src/components/ConditionCard.astro`

- [ ] **Step 1: Read existing card patterns**

Read `ArticleCard.astro`, `BlogCard.astro`, `CourseCard.astro` for card conventions.

- [ ] **Step 2: Write ConditionCard.astro**

```astro
---
interface Props {
  slug: string;
  title: string;
  heroSummary: string;
  articleCount: number;
  stats?: { value: string; label: string }[];
}

const { slug, title, heroSummary, articleCount, stats } = Astro.props;
---

<a href={`/conditions/${slug}/`} class="card condition-card" data-pagefind-ignore="all">
  <h3 class="condition-card__title">{title}</h3>
  <p class="condition-card__summary">{heroSummary}</p>
  <div class="condition-card__meta">
    <span class="condition-card__count">{articleCount} research articles</span>
  </div>
</a>

<style>
  .condition-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-5);
    text-decoration: none;
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
    border-radius: var(--radius-md);
    transition: box-shadow 0.2s ease;
  }
  .condition-card:hover {
    box-shadow: var(--shadow-md);
  }
  .condition-card__title {
    font-family: 'Cormorant Garamond', 'Georgia', serif;
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .condition-card__summary {
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0;
  }
  .condition-card__meta {
    margin-top: auto;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ConditionCard.astro
git commit -m "feat: add ConditionCard component"
```

### Task A3: Create StatBadge component

**Files:**
- Create: `src/components/StatBadge.astro`

- [ ] **Step 1: Write StatBadge.astro**

```astro
---
interface Props {
  value: string;
  label: string;
  source?: string;
}

const { value, label, source } = Astro.props;
---

<div class="stat-badge">
  <span class="stat-badge__value">{value}</span>
  <span class="stat-badge__label">{label}</span>
  {source && <cite class="stat-badge__source">{source}</cite>}
</div>

<style>
  .stat-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: var(--space-4);
  }
  .stat-badge__value {
    font-family: 'Cormorant Garamond', 'Georgia', serif;
    font-size: 2rem;
    font-weight: 600;
    color: var(--accent);
    line-height: 1.2;
  }
  .stat-badge__label {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }
  .stat-badge__source {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    font-style: normal;
    margin-top: var(--space-1);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StatBadge.astro
git commit -m "feat: add StatBadge component"
```

### Task A4: Create CrossLinkSection component

**Files:**
- Create: `src/components/CrossLinkSection.astro`

- [ ] **Step 1: Write CrossLinkSection.astro**

A reusable section that renders a heading + list of linked items. Used across all new page types for "Related Research", "Related FAQs", "Related Conditions", etc.

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
  layout?: 'list' | 'grid';
}

const { heading, items, layout = 'list' } = Astro.props;
---

{items.length > 0 && (
  <section class="cross-link-section">
    <h2 class="cross-link-section__heading">{heading}</h2>
    <div class={`cross-link-section__items cross-link-section__items--${layout}`}>
      {items.map(item => (
        <a href={item.href} class="cross-link-section__item">
          <span class="cross-link-section__title">{item.title}</span>
          {item.subtitle && <span class="cross-link-section__subtitle">{item.subtitle}</span>}
        </a>
      ))}
    </div>
  </section>
)}

<style>
  .cross-link-section {
    margin-top: var(--space-10);
    padding-top: var(--space-8);
    border-top: 1px solid var(--border-color);
  }
  .cross-link-section__heading {
    font-family: 'Cormorant Garamond', 'Georgia', serif;
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: var(--space-4);
  }
  .cross-link-section__items--list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .cross-link-section__items--grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: var(--space-4);
  }
  .cross-link-section__item {
    display: flex;
    flex-direction: column;
    padding: var(--space-3) var(--space-4);
    text-decoration: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
    transition: box-shadow 0.2s ease;
  }
  .cross-link-section__item:hover {
    box-shadow: var(--shadow-md);
  }
  .cross-link-section__title {
    font-weight: 500;
    color: var(--text-primary);
  }
  .cross-link-section__subtitle {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-top: var(--space-1);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/CrossLinkSection.astro
git commit -m "feat: add CrossLinkSection reusable component"
```

### Task A5: Create ComparisonTable component

**Files:**
- Create: `src/components/ComparisonTable.astro`

- [ ] **Step 1: Write ComparisonTable.astro**

Uses `<div>` with ARIA roles (not native `<table>`) per Astro gotchas -- native tables don't honor grid/flex.

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
    <div role="columnheader" class="comparison-table__cell comparison-table__cell--dimension"></div>
    <div role="columnheader" class="comparison-table__cell comparison-table__cell--approach">{approach1Name}</div>
    <div role="columnheader" class="comparison-table__cell comparison-table__cell--approach">{approach2Name}</div>
  </div>
  {rows.map(row => (
    <div class="comparison-table__row" role="row">
      <div role="rowheader" class="comparison-table__cell comparison-table__cell--dimension">{row.dimension}</div>
      <div role="cell" class="comparison-table__cell" data-label={approach1Name}>{row.approach1}</div>
      <div role="cell" class="comparison-table__cell" data-label={approach2Name}>{row.approach2}</div>
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
  .comparison-table__cell--dimension {
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
    .comparison-table__cell--dimension {
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .comparison-table__cell::before {
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

### Task A6: Build condition page template

**Files:**
- Create: `src/pages/conditions/index.astro`
- Create: `src/pages/conditions/[...slug].astro`
- Create: `src/lib/conditions.ts` (new data loader)

- [ ] **Step 1: Create conditions data loader**

Create `src/lib/conditions.ts`:

```typescript
import conditionsData from '../data/conditions.json';
import articlesData from '../data/articles.json';
import faqsData from '../data/faqs.json';

export interface ConditionEntry {
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  heroSummary: string;
  sections: { id: string; heading: string; content: string }[];
  faqs: { question: string; schemaAnswer: string; basicAnswer: string }[];
  stats: { value: string; label: string; source: string }[];
  libraryDomains: string[];
  libraryTopicPrefixes: string[];
  relatedFaqSlugs: string[];
  relatedGlossaryTerms: string[];
  relatedConditions: string[];
  relatedComparisons: string[];
  publishedDate: string;
  lastUpdated: string;
}

export async function getAllConditions(): Promise<ConditionEntry[]> {
  return conditionsData as ConditionEntry[];
}

export async function getCondition(slug: string): Promise<ConditionEntry | undefined> {
  return (conditionsData as ConditionEntry[]).find(c => c.slug === slug);
}

export async function getArticlesForCondition(condition: ConditionEntry) {
  return (articlesData as any[]).filter(a =>
    condition.libraryDomains.includes(a.domain) ||
    condition.libraryTopicPrefixes.some((prefix: string) =>
      (a.topics || []).some((t: string) => t.startsWith(prefix))
    )
  );
}

export async function getFaqsForCondition(condition: ConditionEntry) {
  return (faqsData as any[]).filter(f =>
    condition.relatedFaqSlugs.includes(f.slug)
  );
}
```

- [ ] **Step 2: Create condition index page**

Create `src/pages/conditions/index.astro` following the pillar page patterns. Key elements:
- H1: "Conditions Addressed by Restorative Reproductive Medicine"
- Grid of ConditionCard components
- Brief intro (Gianna voice) explaining RRM's approach to conditions
- BreadcrumbList: Home > Conditions
- CollectionPage + MedicalWebPage JSON-LD
- `data-pagefind-ignore="all"` on listing
- BackToTop component

- [ ] **Step 3: Create condition detail template**

Create `src/pages/conditions/[...slug].astro`:

Key structure (main content wrapper must have `data-pagefind-body` and `data-pagefind-meta="type:Condition"`):
```
Breadcrumb: Home > Conditions > [Title]
H1: condition.title
Hero summary (citable paragraph)
Stats row (StatBadge grid)
Table of contents (anchor links to sections)
Section content (from conditions.json)
FAQ accordion (native <details>)
"From the Research Library" (top 6 articles by domain, link to /research/{slug}/)
"Find a Provider" (link to /find-a-provider/?specialty=X)
Related Conditions (CrossLinkSection, grid layout)
Related Comparisons (CrossLinkSection, list layout)
Related FAQs (CrossLinkSection, list layout)
Related Glossary Terms (inline links)
BackToTop
```

Schema: MedicalCondition + MedicalWebPage + FAQPage + BreadcrumbList

- [ ] **Step 4: Run local build**

```bash
npm run build
```

Expected: Build succeeds, condition pages generated at `dist/conditions/`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conditions.ts src/pages/conditions/
git commit -m "feat: add condition pages with index and detail templates"
```

### Task A7: Add conditions to router

**Files:**
- Modify: `~/iCode/projects/rrm-router/src/index.js`

- [ ] **Step 1: Add /conditions to ASTRO_ROUTES**

- [ ] **Step 2: Verify router locally**

```bash
cd ~/iCode/projects/rrm-router && npx wrangler dev --test-scheduled
# In another terminal: curl -I http://localhost:8787/conditions/endometriosis/
# Expected: proxied to Astro (200 or 404 if not built yet)
```

- [ ] **Step 3: Commit in rrm-router repo**

### Task A8: Add cross-links from existing pages

**Files:**
- Modify: `src/pages/library/[...slug].astro` (add condition badge)
- Modify: `src/pages/faqs/[...slug].astro` (add condition link)
- Modify: `src/pages/index.astro` (add conditions section)

- [ ] **Step 1: Add condition badge to library article detail**

If article's domain matches a condition's `libraryDomains`, show a small linked badge: "Part of [Condition] research"

- [ ] **Step 2: Add condition link to FAQ detail**

If FAQ slug is in any condition's `relatedFaqSlugs`, add: "This FAQ relates to [Condition] -- learn more"

- [ ] **Step 3: Add conditions section to homepage**

Below existing sections, add a "Conditions We Address" section with top 8 ConditionCards in a 2x4 grid (2x2 on mobile).

- [ ] **Step 4: Run build, verify cross-links**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/library/[...slug].astro src/pages/faqs/[...slug].astro src/pages/index.astro
git commit -m "feat: add condition cross-links to library, FAQ, and homepage"
```

### Task A9: OG images for condition pages

**Files:**
- Modify: build-time OG image generation (follow existing Satori pattern)

- [ ] **Step 1: Add condition page OG image generation**

Follow the programmatic OG images pattern from `docs/superpowers/specs/2026-03-13-programmatic-og-images-design.md`. Convention: `/images/og/og-condition-{slug}.png`.

- [ ] **Step 2: Commit**

---

## Phase B: Condition x City Pages

### Prerequisites
- Phase A complete (condition pages exist)
- Find-a-Provider plan Phase 1-3 complete: `src/data/practitioners.json` generated by `scripts/fetch-practitioner-data.mjs` (D1 -> JSON). This file contains all practitioner records with city, state, method, practitioner_type fields needed for condition-city matching
- Condition-to-practitioner matching logic: all conditions match `practitioner_type: 'medical'` (MCs treat conditions). The `practitionerMethodFilter` field in conditions.json filters by method (e.g., `napro` for NaPro-treated conditions). Centers in the same city are also included

### Task B1: Create condition-city data generator

**Files:**
- Create: `scripts/generate-condition-city-pages.mjs`

This script cross-joins conditions with practitioner cities to generate static paths.

- [ ] **Step 1: Write generator script**

```javascript
// Read conditions.json and practitioners.json
// For each condition, find practitioners whose specialty/method could treat it
// Group by city+state
// Only generate pages where count >= 1 practitioner
// Output: list of { condition, city, state, practitioners[] }
```

Logic for condition-to-practitioner matching:
- Endometriosis, PCOS, infertility, RPL, etc. -> all `practitioner_type: 'medical'` (MCs treat conditions)
- Charting methods (if added later) -> `practitioner_type: 'educator'`
- All conditions also match `practitioner_type: 'center'` in same city

- [ ] **Step 2: Test with current data**

```bash
node scripts/generate-condition-city-pages.mjs --dry-run
```

Expected: ~200-400 city pages across 8 conditions x ~50 cities with practitioners.

- [ ] **Step 3: Commit**

### Task B2: Build condition x city template

**Files:**
- Create: `src/pages/find/[condition]/[...city].astro`

- [ ] **Step 1: Write template**

Key structure:
```
Breadcrumb: Home > Conditions > [Condition] > [City, State]
H1: "[Condition] Treatment in [City], [State]"
Brief intro: "Find RRM practitioners who address [condition] in [city]."
Practitioner cards (filtered from practitioners.json)
Telehealth section: practitioners with telehealth=yes who serve this state
Link to condition page (/conditions/{slug}/)
Link to state provider page (/find-a-provider/{state}/)
Link to all providers in city (/find-a-provider/?city={city})
Related conditions in same city
```

Schema: MedicalBusiness (aggregate) + BreadcrumbList

SEO: each page targets "[condition] [city] [state]" -- near-zero competition.

- [ ] **Step 2: Add /find to router ASTRO_ROUTES**

- [ ] **Step 3: Run build**

- [ ] **Step 4: Commit**

### Task B3: Add city links from condition pages

**Files:**
- Modify: `src/pages/conditions/[...slug].astro`

- [ ] **Step 1: Add "Find Care Near You" section**

Below the "Find a Provider" section on condition pages, add a state/city browse: "Find [condition] care in:" followed by linked state names that expand to show cities.

- [ ] **Step 2: Commit**

### Task B4: Sitemap for condition x city pages

**Files:**
- Create or modify sitemap generation

- [ ] **Step 1: Generate sitemap entries for all condition x city pages**

Low priority (monthly update) compared to condition pages. Set `changefreq: monthly`, `priority: 0.5`.

- [ ] **Step 2: Commit**

---

## Phase C: Comparison Pages

### Prerequisites
- Phase A complete (condition pages to link to)

### Task C1: Create comparisons.json data file

**Files:**
- Create: `src/data/comparisons.json`

Editorial task. Start with top 4 comparisons:
1. Excision vs ablation for endometriosis
2. NaProTechnology vs IVF for infertility
3. NaPro vs IVF for PCOS
4. NaPro vs IVF for recurrent miscarriage

- [ ] **Step 1: Research via rrm-cli and Perplexity**

```bash
rrm-cli search "excision ablation outcomes" --intent=cite --full --limit=10
rrm-cli search "NaPro IVF comparison" --intent=cite --full --limit=10
```

Use Perplexity (pplx skill) for outcome statistics.

- [ ] **Step 2: Draft comparison content via Gianna agent**

**Critical framing rules:**
- Structure as "balanced-seeming education that naturally favors RRM through data"
- NEVER recommend IVF or include "When IVF May Be Appropriate"
- Use anchoring: IVF costs first ($40-60K), then RRM as "fraction of that"
- "20x less" figure is HALLUCINATED -- never use
- REIs are IVF doctors, not RRM clinicians
- RCTs are a double standard, not a legitimate critique
- No performative honesty or self-undercutting evidence
- Use HFEA (mandatory reporting) for IVF data, never SART/CDC (voluntary)

- [ ] **Step 3: Assemble comparisons.json**

- [ ] **Step 4: Validate all citations**

- [ ] **Step 5: Commit**

### Task C2: Build comparison page template

**Files:**
- Create: `src/pages/compare/index.astro`
- Create: `src/pages/compare/[...slug].astro`
- Create: `src/lib/comparisons.ts`

- [ ] **Step 1: Create comparison data loader**

- [ ] **Step 2: Create comparison index page**

H1: "Evidence-Based Comparisons"
Grid of comparison cards with approach names
BreadcrumbList: Home > Compare
CollectionPage JSON-LD

- [ ] **Step 3: Create comparison detail template**

Key structure:
```
Breadcrumb: Home > Compare > [Title]
H1: comparison.title
Hero summary (citable)
"Key Differences" ComparisonTable
Approach 1 detail section
Approach 2 detail section
Evidence summary (editorial)
FAQ accordion
Related condition pages
Related research articles
```

Schema: MedicalWebPage + Article + FAQPage + BreadcrumbList

- [ ] **Step 4: Add /compare to router**

- [ ] **Step 5: Build and verify**

- [ ] **Step 6: Commit**

### Task C3: Cross-link comparisons from condition pages

**Files:**
- Already handled in Task A6 via `relatedComparisons` field

Verify links render correctly. Add comparison links to pillar guides manually where relevant.

---

## Phase D: Research Topic Hubs

### Prerequisites
- Phase A complete (condition pages to link to)

### Task D1: Create research-hubs.json

**Files:**
- Create: `src/data/research-hubs.json`

- [ ] **Step 1: Draft hub entries**

For each hub, write a 200-400 word introduction in Gianna voice (commentary on the research landscape for this topic). Highlight 5-8 key articles per hub.

- [ ] **Step 2: Write research-hubs.json**

- [ ] **Step 3: Commit**

### Task D2: Build research hub template

**Files:**
- Create: `src/pages/research/index.astro`
- Create: `src/pages/research/[...slug].astro`
- Create: `src/lib/research-hubs.ts`

- [ ] **Step 1: Create research hub data loader**

Filter articles from `articles.json` by `filterDomains` and `filterTopicPrefixes`. Sort by year descending. Include article count.

- [ ] **Step 2: Create research hub index**

H1: "Research by Topic"
Grid of topic cards with article counts
Link to full library

- [ ] **Step 3: Create research hub detail template**

Key structure:
```
Breadcrumb: Home > Research > [Topic]
H1: "Endometriosis Research"
Article count badge: "191 peer-reviewed studies"
Naomi's commentary (introduction HTML)
Featured articles section (highlighted picks)
Full article grid (ArticleCard, paginated client-side or show-more)
Link to condition page
Link to related FAQs
```

Schema: CollectionPage + BreadcrumbList

- [ ] **Step 4: Add /research to router**

- [ ] **Step 5: Build and verify**

- [ ] **Step 6: Commit**

### Task D3: Cross-link from library article detail

**Files:**
- Modify: `src/pages/library/[...slug].astro`

- [ ] **Step 1: Add "Part of [Topic] Research" link**

If article's domain matches a research hub's `filterDomains`, add a link above the article title: "Part of [Topic] Research -- browse all [count] studies"

- [ ] **Step 2: Commit**

---

## Phase E: Glossary v2 Retrofit

### Prerequisites
- None (can run in parallel with other phases)

### Task E1: Extract glossary terms to JSON

**Files:**
- Create: `src/data/glossary-terms.json`
- Read: `src/pages/glossary/index.astro` (current glossary)

- [ ] **Step 1: Parse existing glossary page**

Extract all terms from the current glossary.astro into structured JSON entries:
```json
{
  "slug": "endometriosis",
  "term": "Endometriosis",
  "definition": "Plain definition text",
  "rrmRelevance": "RRM relevance paragraph",
  "category": "Key Conditions",
  "relatedTerms": ["excision-surgery", "ablation"],
  "relatedConditionSlug": "endometriosis",
  "relatedLibraryDomain": "Endometriosis"
}
```

- [ ] **Step 2: Expand entries to v2 format**

For each term, ensure:
- Definition is a clear, standalone sentence
- "RRM relevance" paragraph explains why this term matters in restorative medicine
- Both are citable (complete statements, include "RRM" as subject where appropriate)

- [ ] **Step 3: Write glossary-terms.json**

- [ ] **Step 4: Commit**

### Task E2: Create glossary term detail pages

**Files:**
- Create: `src/pages/glossary/[...slug].astro`
- Modify: `src/pages/glossary/index.astro` (add links to detail pages)

- [ ] **Step 1: Create glossary term detail template**

Key structure:
```
Breadcrumb: Home > Glossary > [Term]
H1: term.term
Definition block (styled as blockquote or callout)
"RRM Relevance" section
Link to condition page (if relatedConditionSlug)
Link to library search (if relatedLibraryDomain)
Related terms (CrossLinkSection)
```

Schema: DefinedTerm + MedicalWebPage + BreadcrumbList

- [ ] **Step 2: Update glossary index to link to detail pages**

Each term in the glossary index becomes a link to `/glossary/{slug}/`. Keep the full index readable (definitions visible) but add "Learn more" links.

- [ ] **Step 3: Build and verify**

- [ ] **Step 4: Commit**

---

## Phase F: Integration & Polish

### Task F1: Navigation updates

**Files:**
- Modify: `src/components/Header.astro`
- Modify: `src/components/Footer.astro`

- [ ] **Step 1: Add "Conditions" to Learn dropdown**

Under the existing Learn dropdown, add "Conditions" linking to `/conditions/`.

- [ ] **Step 2: Add "Compare" to Learn dropdown**

Add "Compare" linking to `/compare/`.

- [ ] **Step 3: Update footer**

Add Conditions and Research links to the appropriate footer column.

- [ ] **Step 4: Commit**

### Task F2: Internal linking audit

- [ ] **Step 1: Verify all cross-links resolve**

```bash
npm run build
# Check for broken internal links in dist/
```

- [ ] **Step 2: Run rrm-cli check on all new pages**

```bash
rrm-cli check --file src/pages/conditions/index.astro
rrm-cli check --file src/pages/compare/index.astro
# etc.
```

- [ ] **Step 3: Fix any editorial guardrail violations**

### Task F3: Pagefind indexing

- [ ] **Step 1: Verify search indexing**

Condition detail pages: `data-pagefind-body` (indexed)
Condition index, research index, compare index: `data-pagefind-ignore="all"` (not indexed)
Glossary term details: `data-pagefind-body` (indexed)

- [ ] **Step 2: Add pagefind meta tags**

```html
data-pagefind-meta="type:Condition"
data-pagefind-meta="type:Comparison"
data-pagefind-meta="type:Research"
data-pagefind-meta="type:Glossary"
```

### Task F4: Vectorize embedding update

- [ ] **Step 1: Update embed script to include new content types**

Modify `scripts/embed-library-ci.mjs` to embed condition pages, comparison pages, and glossary terms into Vectorize index.

- [ ] **Step 2: Commit**

### Task F5: Deploy guard update

- [ ] **Step 1: Add minimum record counts for new data types**

Update `deploy.yml` to add guards for new JSON files:
- conditions >= 5
- comparisons >= 2
- glossary-terms >= 20

- [ ] **Step 2: Commit**

### Task F6: Verify templates (CI)

- [ ] **Step 1: Update verify-templates.mjs**

Add structural checks for new page types:
- Condition pages have MedicalCondition schema
- Comparison pages have ComparisonTable
- Research hubs have article count
- Glossary terms have DefinedTerm schema

- [ ] **Step 2: Commit**

---

## Build Impact Estimate

| Content type | Pages | Data size | Build time delta |
|-------------|-------|-----------|-----------------|
| Conditions | 8 + 1 index | ~100KB JSON | +5s |
| Condition x City | ~200 | Reuses practitioners.json | +30s |
| Comparisons | 4 + 1 index | ~80KB JSON | +3s |
| Research hubs | 10 + 1 index | ~30KB JSON + filtered articles | +5s |
| Glossary terms | 60-80 + modified index | ~60KB JSON | +10s |
| **Total** | **~285 new pages** | **~270KB new data** | **~53s** |

Current build: ~45s. Expected after: ~98s. Well within CF Pages limits.

---

## Content Production Workflow

Each condition/comparison page needs:

1. **Research** (rrm-cli + Perplexity): 30-60 min per page
2. **Draft** (Gianna agent): 20-40 min per page
3. **Brian editorial review**: variable
4. **Citation verification**: 15-30 min per page
5. **Technical implementation**: already done (templates)

**Total content production for Phase A+C:** ~8 conditions + 4 comparisons = 12 editorial pages.
At ~2 hours each: ~24 hours of content work spread across sessions.

Phases B, D, E are lower editorial effort (programmatic or extractive).

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Content quality bottleneck (Naomi review) | Blocks all phases | Draft in batches, get 2-3 approved at a time |
| Build time exceeds CF Pages limit | Blocks deploy | Condition x City can lazy-generate via pagination |
| Condition-to-practitioner matching too coarse | Poor UX on city pages | Start with medical consultants only (MCs treat conditions) |
| Hallucinated statistics | Existential (medical site) | All stats from library or Perplexity, CI citation check |
| URL structure changes later | 301 redirect tax | Lock URLs in this plan, don't change |
| Too many pages for Pagefind index | Slow search | Exclude listing pages (already planned) |
| Condition pages cannibalize pillar guides | SEO confusion | Conditions are specific; pillars are framework-level. Different intent |

---

## Dependency Graph

```
Find-a-Provider (separate plan, must complete Phase 1-3 first)
  │
  ├── Phase A: Condition Pages (no other deps)
  │     │
  │     ├── Phase B: Condition x City (needs A + provider data)
  │     │
  │     ├── Phase C: Comparison Pages (needs A for cross-links)
  │     │
  │     └── Phase D: Research Hubs (needs A for cross-links)
  │
  Phase E: Glossary Retrofit (independent, can run anytime)
  │
  Phase F: Integration & Polish (needs A-E complete)
```

---

## Success Metrics

| Metric | Baseline | Target (3 months post-launch) |
|--------|----------|-------------------------------|
| Organic pages indexed | ~3,300 | ~3,600 |
| Condition keyword rankings (top 50) | 0 | 15-20 keywords |
| AI citation rate (monthly scan) | 5% | 15% |
| Internal links per page (avg) | ~3 | ~8 |
| Pages per session (from conditions) | n/a | 2.5+ |
| Practitioner directory traffic from conditions | 0 | 10% of directory sessions |
