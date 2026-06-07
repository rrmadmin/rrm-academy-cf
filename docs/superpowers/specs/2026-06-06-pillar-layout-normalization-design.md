<!-- Spec: PillarLayout normalization. Created 2026-06-06. -->
# PillarLayout: Normalized Construction for Pillar/Condition Pages

**Status:** Design approved 2026-06-06. Awaiting spec review → implementation plan.
**Owner:** Brian (RRM Academy)
**Scope:** `rrm-academy-cf` — pillar/condition guide pages.

## Problem

Pillar and condition guide pages (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/common-questions-about-rrm/`, `/glossary/`, `/art-registries-and-codes/`, `/rrm-success-rates/`, `/pcos/`, `/endometriosis/`, `/endometritis/`, `/miscarriage/`, `/isthmocele/`) are **hand-authored ~600-750 line `.astro` files, cloned from one another.** There is no single constructor that guarantees their SEO foundation.

Consequences observed:
- **Silent drift** in schema completeness, byline pattern, breadcrumb, TOC, OG wiring, and disclaimer between pages.
- **Missed scaffolding entirely:** `/isthmocele/` (built 2026-06-06 by manually cloning `/endometritis/`) shipped with the **generic fallback OG card**, **no `sitemap-pillars.xml` entry**, and **no `/guides/` listing**, because the manual clone bypassed the `ssot/pillars.json` registry. The gap was caught only after publish.

Content types that are already data-driven (library, commentary, FAQs, courses) do not have this problem: one template renders every item, so SEO scaffolding is uniform by construction. Pillars are the remaining hand-built surface.

## Goals

1. A single `PillarLayout` component owns the **entire SEO foundation** for every pillar/condition page, so it cannot be forgotten or drift.
2. Every pillar is **normalized up** to one best-practice standard (schema completeness, byline, breadcrumb, OG, TOC, speakable, disclaimer). Pages currently missing pieces gain them.
3. Metadata stays single-sourced in `ssot/pillars.json` (the existing registry).
4. A **gate** makes the normalized construction mandatory — a clinical/pillar page cannot ship hand-rolling its own scaffolding.
5. **Body content is never changed** by migration. Prose, sections, and card grids render exactly as today.

## Non-goals (YAGNI)

- No redesign / visual restyling of pillar bodies. This is structural normalization, not a content or design pass.
- No conversion of pillar prose into data (the "fully data-driven body" option was considered and declined). Prose stays in each page's `.astro`, supplied to the layout via a slot.
- No change to the already-normalized library/commentary/FAQ/course templates.
- No new pillar content is authored as part of this work.

## Current state (what exists)

- **`BaseLayout.astro`** — every page uses it; centralizes `<title>`, meta description, canonical, OG/Twitter, JSON-LD injection, citation meta, font preload, noindex. Head-level SEO is already uniform.
- **`ssot/pillars.json`** — canonical pillar registry (13 entries). 8 consumers derive from it (guides catalogue, shell nav, `library-sitemaps.mjs` → `sitemap-pillars.xml`, `build-og-index.mjs` → per-page OG card, `BaseLayout`, `saved-pillars`, `build-pillar-reviews`, `build-guides-data`). Required fields enforced by `scripts/gates/validate-pillar-registry.mjs` (G1–G3, plus G5 router-parity warn, plus G6 added 2026-06-06: clinical pages must be registered).
- **Per-page `.astro`** — each pillar hand-emits its own `pageSchema` (Article+MedicalWebPage [+MedicalCondition+ICD-10 for conditions]), `breadcrumbSchema`, `faqSchema` (FAQPage), byline, TOC (`TOC_ITEMS`), `SectionTocChips`, mobile TOC, `MaybeShell` wrap, `LastUpdated`, disclaimer, CTA. This is the duplicated surface PillarLayout replaces.
- Shared pieces already exist: `MaybeShell`, `SectionTocChips`, `LastUpdated`, `BackToTop`, `safeJsonLd`, `buildScholarlyArticleStub`, the global byline CSS (`.author-byline`, `.has-reviewer`, `.byline-reviewer`), and the condition card grid CSS (`.condition-grid`, `.pathway-grid`).

**Pillar taxonomy (drives schema):**
- **Condition pillars (5)** — emit `MedicalCondition` + ICD-10: `pcos`, `endometriosis`, `endometritis`, `miscarriage`, `isthmocele`.
- **Concept/method pillars (8)** — `Article`+`MedicalWebPage` only: `what-is-rrm`, `naprotechnology`, `femm`, `neofertility`, `common-questions-about-rrm`, `glossary`, `art-registries-and-codes`, `rrm-success-rates`.

## Design

### `src/layouts/PillarLayout.astro`

A layout that wraps `BaseLayout` and owns all SEO scaffolding. The page passes structured props and supplies its prose/cards via the default slot.

**Props**
- `slug` (string, required) — used to read the rest from `ssot/pillars.json`; the registry is the single source for `title`, `description`, `ogTitle`, `ogDescription`, `author`, `read_time`, `accent`. The layout resolves these by slug; explicit prop overrides are allowed only as an escape hatch.
- `condition?` (bool) and `icd10?` (string) and `alternateName?` (string[]) — when `condition`, the layout emits a `MedicalCondition` `about` node with the ICD-10 `MedicalCode`. Sourced from new registry fields (see below).
- `author?` / `reviewedBy?` — default to org author (`#organization`) + `#naomi-whittaker` reviewer, rendered as the canonical glossary-pattern byline ("By RRM Academy / Reviewed by Dr. Naomi Whittaker, MD…"). A pillar may override `author` to a person `@id` for Naomi-authored guides.
- `tocItems` (`{href, label}[]`, required) — drives the mobile `<details>` TOC, `SectionTocChips`, and the sidebar `.toc`, all rendered uniformly.
- `faqs` (`{question, answer}[]`, optional) — the layout renders **both** the `FAQPage` JSON-LD **and** the visible FAQ accordion from this one array, so schema and visible content can never disagree.
- `citations` (`{name, author, datePublished, journal?, librarySlug?}[]`, optional) — emitted as the JSON-LD `citation[]` (via `buildScholarlyArticleStub`).
- `keyTakeaways?` (string[] of HTML) — optional TL;DR block.
- `datePublished` (string, required) and `wordCount?` (number).
- `editingNotice?` (bool) — renders the "under review" banner.

**Body:** default `<slot>` — the page's unique prose sections (`<section id>…`) and card grids (`.condition-grid`, `.pathway-grid`). Unchanged from today.

**Emits, for every pillar, in one place:**
- `BaseLayout` with title/description/canonical/ogType/publishDate/`jsonLd`(pageSchema)/`speakable`/`chrome`.
- `pageSchema`: `["Article","MedicalWebPage"]` with headline, description, author, publisher (`#organization`), datePublished, dateModified (from `LastUpdated`/`page-dates.json`), wordCount, mainEntityOfPage, `articleSection`+`hasPart` (from `tocItems`), and `about` `MedicalCondition`+ICD-10 when `condition`.
- `BreadcrumbList` (Home › Guides › `title`).
- `FAQPage` (from `faqs`).
- `citation[]` (from `citations`).
- The org-author + reviewer byline.
- Breadcrumb nav, mobile TOC, `SectionTocChips`, sidebar `.toc`, `MaybeShell` wrap, `BackToTop`, `LastUpdated`, the medical disclaimer, and the FAQ accordion.

### Registry coupling

Add two optional fields to condition entries in `ssot/pillars.json`: `condition: true` and `icd10: "<code>"` (and `alternateName` where useful). Extend `validate-pillar-registry.mjs` so these are validated when present. The five condition pillars get them; concept pillars omit them.

### Gate

- **Keep G6** (clinical page emitting `MedicalWebPage`/`MedicalCondition` must be registered).
- **Add G7**: any page in the registry (or any root page emitting clinical schema) must render through `PillarLayout` — verified by grepping the page source for the `PillarLayout` import/use. This prevents a future page from hand-rolling scaffolding and drifting. `endo-survey` remains allowlisted (not a pillar).

## Migration plan (proof-first, then waves)

1. **Build** `PillarLayout.astro` + extend the registry schema + extend the gate. No page migrated yet.
2. **Proof (2 pages):** migrate `isthmocele` + `endometritis` onto `PillarLayout`. For each:
   - Move `pageSchema`/`breadcrumb`/`faqSchema`/byline/TOC/disclaimer emission into the layout; pass `faqs`, `citations`, `tocItems`, `condition`/`icd10`, `keyTakeaways` as props; leave prose + card grids in the slot.
   - **Verify:** live HTML diff shows JSON-LD, byline, breadcrumb, OG, canonical, speakable, sitemap entry **unchanged or improved**; gates green; `npm run build` clean; Playwright desktop + mobile (393×852) visual match.
3. **Waves:** migrate the remaining 11 in waves of ~3 (group conditions together, then concept pillars), re-running the same verification per wave.
4. **Normalize-up audit:** during each page's migration, note any SEO element it lacked (e.g., FAQPage, speakable, reviewer byline, complete citation array); the layout supplies the full set, so laggards are upgraded by construction. Record what changed per page.

Each migration ships via the standard worktree-off-`origin/main` → `claude/*` branch → auto-merge → deploy choreography, with the OG cache purged per migrated slug if its `?v=` key was previously fetched.

## Testing / verification

- **Gates:** `validate-pillar-registry.mjs` (G1–G7) green; `design-tokens:check`; `ssot:validate`.
- **Build:** `npm run build` succeeds; `build-og-index` lists every pillar; `sitemap-pillars.xml` lists every pillar.
- **Per-page parity:** scripted diff of pre/post live HTML for the SEO-bearing nodes (title, canonical, OG, all JSON-LD blocks, byline text, breadcrumb). Differences must be additive (normalize-up) only.
- **Visual:** Playwright desktop + mobile screenshots per migrated page; body must be visually unchanged.

## Rollback

Each page migration is an isolated commit. Revert = restore the page's prior `.astro` (the layout and registry changes are additive and inert for un-migrated pages). The layout file itself is unused until a page imports it, so landing it is zero-risk to live pages.

## Risks

- **Layout bug hits multiple pages.** Mitigated by proof-first (2 pages) before waves, and per-page HTML-parity verification.
- **Schema regression** (a node emitted differently than the hand-rolled version). Mitigated by the pre/post JSON-LD diff gate during migration.
- **Shell (app-shell) integration variance.** `MaybeShell`/`SectionTocChips` already differ slightly per page (e.g., glossary's custom rail); the layout must support per-page rail/shell opt-outs via props. Audited during the proof phase.

## Open items resolved in design

- Content model: structured props + body slot (Approach A). Confirmed.
- Rollout: proof-first then waves. Confirmed.
- Fidelity: normalize up to one standard. Confirmed.
