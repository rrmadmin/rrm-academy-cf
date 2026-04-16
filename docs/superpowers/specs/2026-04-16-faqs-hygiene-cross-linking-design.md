# FAQs Hygiene + Cross-Linking (Scope B')

Date: 2026-04-16
Owner: Brian
Status: draft — awaiting approval

## Problem

The `/faqs/` section on rrmacademy.org has accumulated drift since the Airtable → D1 migration:

- Live API returns **zero library refs** across all 25 FAQs. The 11 refs visible in the committed `src/data/faqs.json` are stale pre-migration artifacts that will disappear on the next deploy.
- Hub page has no breadcrumb and hardcodes "Last updated: February 2026" (two months stale).
- Hub `meta description` is 173 chars, beyond the 160-char SERP truncation cap.
- Detail pages ship a generic `Courses / Library` CTA with no pillar-guide cross-linking, leaving high-intent FAQ readers with a weak next step.
- FAQPage JSON-LD omits `dateModified` and `datePublished`.
- **Data-layer gap:** `functions/api/faqs.js:mapRow` does not expose `updated_at` / `created_at`, so the built `faqs.json` has no timestamps — any freshness-aware template work requires a data-layer edit first.
- Two question strings carry user-visible typography noise: F12 has curly apostrophes (U+2019), F06 has a non-breaking hyphen (U+2011).
- Related-FAQs logic is same-category-only. Condition-Specific has 2 entries, so the widget under those two FAQs will be thin forever until the category grows.

## Out of scope (explicit)

Each of these was considered and cut:

1. **Slug renames.** Truncated slugs (`...symptot`, `...dhea-inosit`) and awkward slugs (`what-s-rrm-s-...`) are ugly but functional. Renaming forces 301s in rrm-router (sibling repo), Vectorize re-embed (slug-keyed), Pagefind re-index, internal-link sweep, and external-backlink redirect tax — all for cosmetic wins on strings Google weighs lightly. Defer indefinitely.
2. **`schema_answer` and `seo_description` rewrites.** 16 schema answers exceed 300ch and 10 SEO descriptions exceed 160ch. Editing 16 clinical medical answers is voice work subject to RRM editorial rules (evidence-framing, IVF-framing, RRM-not-fertility-only). Flag for a separate Gianna pass, not this session.
3. **Library-ref auto-wiring from rrm-cli top-K.** Algorithmic FTS relevance on a medical-education site can surface low-quality citations that read as curated. Handled as a separate two-step workstream (generate TSV → human review → bulk insert) outside this spec.
4. **Related-FAQs algorithm rework.** Either leave category-only (thin but honest) or do it properly via Vectorize semantic search. Token-overlap scoring is worse than either. Defer Vectorize variant to a later spec.
5. **New Condition-Specific / Common Concerns authoring.** Scope C.
6. **Category archive pages, hub search/filter, F19 sort-order backfill.** Nice-to-have, not breaking.

## Scope

Six surgical changes, one deploy, one repo.

### 1. Data-layer: expose timestamps (`functions/api/faqs.js` + `src/lib/faq.ts`)

**Blocker-fix.** Without this, the rest of the scope is unimplementable.

- `functions/api/faqs.js:mapRow` → add `updatedAt: r.updated_at` and `createdAt: r.created_at` to the returned object. This file is in `guard-manifest.json`. After edit, run `npm run guard:update` and include the regenerated manifest in the same commit.
- `src/lib/faq.ts` → add `updatedAt: string` and `createdAt: string` to the `FAQ` interface.
- Re-run `npm run fetch-faqs` so `src/data/faqs.json` includes the new fields.

### 2. Hub typography + freshness + meta (`src/pages/faqs.astro`)

- Add `BreadcrumbList` to the page JSON-LD using the `@graph` pattern already used on the detail page — preserve the existing `FAQPage` entry, add a second `BreadcrumbList` entry (`Home › FAQs`). Single `<script type="application/ld+json">` block, wrapped in `@graph`.
- Add a visible breadcrumb row (`<nav class="breadcrumb" aria-label="Breadcrumb">`) matching the detail-page pattern exactly.
- Replace hardcoded `Last updated: February 2026` with a derived value: compute the latest timestamp across all FAQs as `new Date(Math.max(...faqs.map(f => Date.parse(f.updatedAt))))`. Visible format: `Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(...)`. (Avoid `Math.max` on raw ISO strings — use `Date.parse` first.)
- Inject the same latest timestamp as `dateModified` (ISO) and `new Date(Math.min(...createdAtTimestamps))` as `datePublished` in the `FAQPage` JSON-LD.
- Tighten hub `description` prop from 173ch to ≤160ch. Proposed: "Answers to common questions about Restorative Reproductive Medicine (RRM), NaProTechnology, fertility charting, treatment, and costs." (149ch)

### 3. Detail-page `dateModified` + pillar-aware CTA (`src/pages/faqs/[...slug].astro`)

- Inject `dateModified: faq.updatedAt` and `datePublished: faq.createdAt` into the detail-page FAQPage JSON-LD (the first entry of the existing `@graph`).
- Add a visible per-FAQ freshness stamp near the category badge: `Last updated {Month YYYY}` derived from `faq.updatedAt`. Styled subtly (small, `--text-tertiary`).
- Replace the current `faq-cta` block with a pillar-aware CTA. Given `faq.faqId`, look up `PILLAR_CTA_MAP[faq.faqId] ?? null`. Render:
  - If non-null: one primary button (`Read the <Pillar> guide`, href from map) + existing secondary button (`Browse the Research Library`).
  - If null (F14 fallback): render existing two-button block unchanged (`Explore Courses` primary + `Browse the Research Library` secondary).

### 4. Pillar map (`src/lib/faq.ts`)

Add to `src/lib/faq.ts`:

```ts
export interface PillarCTA { href: string; label: string }
export const PILLAR_CTA_MAP: Record<string, PillarCTA | null> = { /* below */ };
```

| FAQ codes | Pillar | CTA label |
|---|---|---|
| F01, F02, F03, F05, F07, F08, F10, F11, F12, F13, F17, F18, F20, C10, C35 | `/what-is-rrm/` | Read the Restorative Reproductive Medicine guide |
| F04 | `/naprotechnology/` | Read the NaProTechnology guide |
| F22 | `/femm/` | Compare fertility-awareness methods |
| F09, F15 | `/neofertility/` | Read the NeoFertility guide |
| F06, F16, F21, F23, F24 | `/common-questions-about-rrm` | Read answers to common RRM questions |
| F14 | `null` | (fallback: existing Library + Courses block) |

**Routing notes for review:**
- F06 ("Is RRM evidence-based?") and F21 ("Why haven't I heard of RRM?") moved to `/common-questions-about-rrm` — that page is the critic-response pillar; evidence and awareness questions fit better there than on the general intro.
- F22 CTA reads "Compare fertility-awareness methods" rather than "Read the FEMM guide" to match the question (Creighton/Marquette/FEMM/symptothermal comparison). Pillar target remains `/femm/` because no dedicated methods-comparison pillar exists. **Follow-up:** a dedicated comparison pillar is a known content gap.
- Unknown `faqId` falls through to `null` → fallback block. No hard-coded assertions; future FAQ codes fail gracefully.

### 5. D1 typography fix (no `updated_at` bump)

One DML file: `scripts/faq-typography-2026-04-16.sql`.

```sql
BEGIN;
UPDATE faq SET question = REPLACE(REPLACE(question, CHAR(8217), CHAR(39)), CHAR(8216), CHAR(39))
 WHERE faq_code = 'F12';
UPDATE faq SET question = REPLACE(question, CHAR(8209), CHAR(45))
 WHERE faq_code = 'F06';
COMMIT;
```

`updated_at` is **deliberately not touched.** Per schema, `updated_at TEXT DEFAULT (datetime('now'))` fires on INSERT only — there is no trigger. Omitting `updated_at` from the SET list preserves the prior value, which is correct: a curly-quote replacement is not a content revision, and bumping `dateModified` for typography would mislead readers and Google.

### 6. Verification

**Pre-push (local):**
- `npm run check-types` — must pass.
- `npm run build` — must pass; catches Astro template errors and malformed JSON-LD.
- Spot-check with `npm run dev` or `npm run preview`: load hub, load 3 detail pages (one per pillar bucket), confirm visual + JSON-LD sanity.

**Post-deploy:**
- `curl` hub + 6 detail pages (one per pillar bucket — see success criteria) — extract JSON-LD blocks, save as `test/faq-baselines-2026-04-16.json` for future regression comparison.
- Run Google's Rich Results Test on hub + one detail page to confirm FAQPage eligibility maintained.
- Confirm Pagefind index rebuilt: fetch pagefind fragments for updated FAQs, confirm question strings contain clean apostrophes/hyphens.

## Data flow

**Deploy sequence (single commit, single deploy):**

1. Edit `functions/api/faqs.js:mapRow` (+ `npm run guard:update`).
2. Edit `src/lib/faq.ts` (add timestamp fields + `PILLAR_CTA_MAP`).
3. Edit `src/pages/faqs.astro` and `src/pages/faqs/[...slug].astro`.
4. Run `wrangler d1 execute rrm-auth --remote --file=scripts/faq-typography-2026-04-16.sql`.
5. Run `npm run fetch-faqs` with `LIBRARY_BUILD_TOKEN` → regenerates `src/data/faqs.json` with fresh question strings + new timestamp fields.
6. `npm run check-types && npm run build` locally — must pass.
7. Commit: template edits + lib edits + function edit + updated `guard-manifest.json` + updated `src/data/faqs.json` + new SQL file, single commit.
8. `git push origin main`. Push events skip CI `fetch-all`, so the committed JSON ships as-is.

No guarded files touched in the view layer (`src/pages/faqs*`, `src/lib/faq.ts` verified against `guard-manifest.json`). `functions/api/faqs.js` **is** guarded — manifest regeneration is the only required ceremony.

## Risks + mitigations

- **FAQ deploy guard (MAX_DROP=1):** scope does not add/remove FAQs. Count stays 25. Safe.
- **Guard invariant check:** `functions/api/faqs.js` changes must not touch Bearer-token auth, CORS origin, or SQL quoting. Only `mapRow()` returned-object shape changes.
- **Vectorize drift:** F12/F06 question edits change embedding input for 2 of 25 FAQs. FAQ search relevance for those 2 slightly stale until next `embed-library-ci.mjs` run (which executes post-deploy in CI). Non-blocking.
- **JSON-LD regression:** `@graph` addition on the hub must not drop the existing `FAQPage` entry. Local `npm run build` + Rich Results Test catches.
- **Pillar-map regressions:** F14 null-handling requires template to handle the null case. Covered by success criterion 6 below.
- **`createdAt` defaults:** some FAQ rows may have stale `created_at` from the migration batch. `datePublished` accuracy is best-effort; not blocking.

## Rollback

If post-deploy verification fails:

- **Template regression:** `git revert <commit> && git push` triggers a re-deploy of the prior build.
- **D1 typography:** leave in place — benign even if template reverted.
- **Guard-manifest mismatch:** if `mapRow` change needs reverting, re-run `npm run guard:update` in the revert commit.

## Success criteria

All eight must be true post-deploy:

1. `curl https://rrmacademy.org/faqs/` returns HTML with visible breadcrumb and a "Last updated" string matching the month of `max(faq.updatedAt)` from `src/data/faqs.json`.
2. Hub JSON-LD `@graph` contains both `FAQPage` (with `dateModified` + `datePublished`) and `BreadcrumbList`.
3. Hub meta `description` length ≤ 160 characters.
4. All 25 detail pages have `dateModified` + `datePublished` in FAQPage JSON-LD, ISO-formatted, plus visible per-FAQ "Last updated" stamp.
5. F12 and F06 question strings render without curly apostrophes / NBSP in page source AND in JSON-LD `mainEntity.name`.
6. **Primary CTA correctness, one sample per bucket:**
   - F01 (bucket `/what-is-rrm/`) → href is `/what-is-rrm/`
   - F04 (bucket `/naprotechnology/`) → href is `/naprotechnology/`
   - F22 (bucket `/femm/`) → href is `/femm/`, CTA text is "Compare fertility-awareness methods"
   - F09 (bucket `/neofertility/`) → href is `/neofertility/`
   - F16 (bucket `/common-questions-about-rrm`) → href is `/common-questions-about-rrm`
   - F14 (null fallback) → CTA block contains `Explore Courses` + `Browse the Research Library`, no pillar button.
7. Google Rich Results Test reports FAQPage eligibility on hub + at least one detail page.
8. `npm run guard` passes on the deployed commit.

## Non-goals reminder

If implementation reveals that a deferred item (slug rename, schema_answer tightening, library ref wiring) must ship today for some reason, stop and escalate. Do not bolt on out-of-scope work mid-implementation.

## Open questions for Brian

These don't block the spec but should be answered during implementation review:

1. F06 and F21 routed to `/common-questions-about-rrm` (critic-response pillar) rather than `/what-is-rrm/`. Confirm?
2. F22 CTA text "Compare fertility-awareness methods" routed to `/femm/` — acceptable stopgap, or should F22 stay with the old generic CTA until a dedicated methods-comparison pillar exists?
3. Per-FAQ "Last updated" stamp on detail pages (nice-to-have added to scope 3) — keep, or drop as visual noise?
