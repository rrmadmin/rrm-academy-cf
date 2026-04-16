# FAQs Hygiene + Cross-Linking (Scope B')

Date: 2026-04-16
Owner: Brian
Status: draft — awaiting approval

## Problem

The `/faqs/` section on rrmacademy.org has accumulated drift since the Airtable → D1 migration:

- Live API returns **zero library refs** across all 25 FAQs. The 11 refs visible in the committed `src/data/faqs.json` are stale pre-migration artifacts that will disappear on the next deploy.
- Hub page has no breadcrumb and hardcodes "Last updated: February 2026" (two months stale).
- Detail pages ship a generic `Courses / Library` CTA with no pillar-guide cross-linking, leaving high-intent FAQ readers with a weak next step.
- FAQPage JSON-LD omits `dateModified`.
- Two question strings carry user-visible typography noise: F12 has curly apostrophes (U+2019), F06 has a non-breaking hyphen (U+2011).
- Related-FAQs logic is same-category-only. Condition-Specific has 2 entries, so the widget under those two FAQs will be thin forever until the category grows.

## Out of scope (explicit)

Each of these was considered and cut:

1. **Slug renames.** Truncated slugs (`...symptot`, `...dhea-inosit`) and awkward slugs (`what-s-rrm-s-...`) are ugly but functional. Renaming forces 301s in rrm-router (sibling repo), Vectorize re-embed (slug-keyed), Pagefind re-index, internal-link sweep, and external-backlink redirect tax — all for cosmetic wins on strings Google weighs lightly. Defer indefinitely.
2. **`schema_answer` and `seo_description` rewrites.** 16 schema answers exceed 300ch and 10 SEO descriptions exceed 160ch. Editing 16 clinical medical answers is voice work subject to RRM editorial rules (evidence-framing, IVF-framing, RRM-not-fertility-only). Flag for a separate Gianna pass, not this session.
3. **Library-ref auto-wiring from rrm-cli top-K.** Algorithmic FTS relevance on a medical-education site can surface low-quality citations that read as curated. Handled as a separate two-step workstream (generate TSV → human review → bulk insert) outside this spec.
4. **Related-FAQs algorithm rework.** Either leave category-only (thin but honest) or do it properly via Vectorize semantic search (FAQ embeddings already exist). Token-overlap scoring is worse than either. Defer the Vectorize variant to a later spec.
5. **New Condition-Specific / Common Concerns authoring.** Scope C.
6. **Category archive pages, hub search/filter, F19 sort-order backfill.** Nice-to-have, not breaking.

## Scope

Five surgical changes, one deploy, one repo.

### 1. Hub typography + freshness (`src/pages/faqs.astro`)

- Add `BreadcrumbList` to the page's JSON-LD graph (`@graph` with existing FAQPage + new BreadcrumbList).
- Add a visible breadcrumb row (`<nav class="breadcrumb">`) matching the detail-page pattern: `Home › FAQs`.
- Replace hardcoded `Last updated: February 2026` with a derived value from `max(faq.updated_at)` across all FAQs. Formatted as "Month YYYY".
- Inject `dateModified` into the `FAQPage` JSON-LD using the same `max(faq.updated_at)` ISO string.

### 2. Detail-page `dateModified` + pillar-aware CTA (`src/pages/faqs/[...slug].astro`)

- Inject `dateModified: faq.updated_at` into the FAQPage JSON-LD.
- Replace the current `faq-cta` block with a pillar-aware CTA. Given `faq.faqId`, pick the pillar from a module constant; render one primary button (`Read the [Pillar] guide`) and keep `Browse the Research Library` as secondary.

Pillar map (FAQ code → pillar slug):

| FAQ codes | Pillar | CTA text |
|---|---|---|
| F01, F02, F03, F05, F06, F07, F08, F10, F11, F12, F13, F17, F18, F20, F21, C10, C35 | `/what-is-rrm/` | Read the Restorative Reproductive Medicine guide |
| F04 | `/naprotechnology/` | Read the NaProTechnology guide |
| F22 | `/femm/` | Read the FEMM + methods guide |
| F09, F15 | `/neofertility/` | Read the NeoFertility guide |
| F16, F23, F24 | `/common-questions-about-rrm` | Read answers to common RRM questions |
| F14 | *(no pillar)* | fallback → Browse the Library + Explore Courses |

F14 ("Do I need to be Catholic...") deliberately stays pillar-less: pushing a religion-neutral reader to any of the faith-compatible pillar pages risks mis-signalling.

### 3. F12 + F06 user-visible typography

- F12 `question`: replace curly apostrophes (U+2019) with straight apostrophes (U+0027). Slug unchanged.
- F06 `question`: replace non-breaking hyphen (U+2011) with regular hyphen (U+002D). Slug unchanged.

### 4. Related-FAQs: leave as-is

Explicit no-op. Documented here so future reviewers don't think it was forgotten.

### 5. Verification

Post-deploy:

- `curl` hub + 3 sample detail pages; extract JSON-LD via `pup` or regex; diff against committed baselines.
- Confirm `dateModified` is present and ISO-formatted on all 26 responses (1 hub + 25 details).
- Confirm visible "Last updated" on hub matches `max(updated_at)`.
- Confirm primary CTA on 3 sample detail pages links to the expected pillar.
- Confirm F12 and F06 question strings render without curly apostrophes / NBSP.

## Data flow

All edits to D1 go through `wrangler d1 execute rrm-auth --remote --file=scripts/faq-typography-2026-04-16.sql`. Two `UPDATE faq SET question = ? WHERE faq_code = ?` statements wrapped in `BEGIN; ... COMMIT;`. `updated_at` bumps naturally via default or explicit `SET updated_at = datetime('now')`.

Template changes are local edits to `.astro` files — no CF Pages Functions touched, no guarded files touched (verified against `guard-manifest.json`: only `functions/api/faqs.js` and `functions/api/admin/faqs/**` are guarded; view layer is not).

**Deploy sequence (single commit, single deploy):**

1. Run the D1 typography SQL against `rrm-auth` (`--remote`).
2. Locally run `npm run fetch-faqs` with `LIBRARY_BUILD_TOKEN` to regenerate `src/data/faqs.json` with fresh `updated_at` values and clean question strings.
3. Commit template edits + updated `src/data/faqs.json` together.
4. `git push origin main`. Push events skip CI `fetch-all`, so the committed JSON ships as-is — which is what we want.

## Risks

- **FAQ deploy guard (MAX_DROP=1)**: this scope does not add/remove FAQs. Count stays 25. Safe.
- **Vectorize drift**: F12 and F06 `question` edits change embedding input. Vectorize FAQ entries will be slightly stale for those two items until the next embedding refresh (`scripts/embed-library-ci.mjs` runs post-deploy in CI if wired for FAQs — verify during implementation). Not blocking.
- **JSON-LD schema validation**: `@graph` addition on the hub must not drop the existing `FAQPage` entry. Manual diff of `jsonLd` object before/after edit.
- **Pillar-map regressions**: F14's pillar-less fallback must render a legal CTA block (not empty). Template must handle the `null` case.

## Success criteria

All six must be true post-deploy:

1. `curl https://rrmacademy.org/faqs/` returns HTML with visible breadcrumb and a "Last updated" string matching the month of `max(faq.updated_at)` from `src/data/faqs.json`.
2. Hub JSON-LD `@graph` contains both `FAQPage` and `BreadcrumbList`.
3. Hub + all 25 detail pages have `dateModified` in FAQPage JSON-LD, ISO-formatted.
4. F12 and F06 question strings render without curly quotes / NBSP in page source.
5. 3 sampled detail pages (one from each pillar bucket — F04 → NaPro, F16 → common-questions, F22 → FEMM) show correct primary CTA href.
6. F14 detail page shows fallback CTA block (Library + Courses), no pillar button.

## Non-goals reminder

If implementation reveals that a deferred item (slug rename, schema_answer tightening, library ref wiring) must ship today for some reason, stop and escalate. Do not bolt on out-of-scope work mid-implementation.
