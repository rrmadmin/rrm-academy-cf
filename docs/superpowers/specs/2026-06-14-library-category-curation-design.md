# Library Category-Page Curation + Sentiment Filter — Design

**Date:** 2026-06-14
**Status:** Draft for review
**Surface:** `rrm-academy-cf` (library category pages) + `rrm-library` D1 (re-classification)
**Go-live:** Gated. Nothing ships to production without Brian's explicit go-live.

## Problem

The library's topic/category pages and landing atlas surface every published research
record, including papers hostile or critical of RRM. Brian wants those off the main
category pages. He also wants the category pages refreshed and confirmation of whether
they stay updated.

### Audit finding (D1 `rrm-library`, published + non-retracted research)

- `sentiment` axis (canonical: `supportive | neutral | critical | hostile`) classifies
  stance **toward RRM**.
- Distribution: **neutral 3172, supportive 823, critical 63, hostile 3, NULL 1** (4062 total).
- The 3 `hostile` are genuine attacks on RRM (JAMA "False Promise of RRM"; two F&S
  "illusion of reproductive choice" author-replies). Correct.
- **The 63 `critical` are noisy.** Only ~8 are genuinely critical of RRM/FABM/NaPro.
  The other ~55 are mislabeled: 22 contraceptive-harm studies, 10 ESHRE IVF-outcome
  registries, 21 HFEA fertility-sector statistics reports, 2 to re-read. Several actively
  *support* RRM's thesis (contraceptive harms, IVF child-health signals). The classifier
  appears to have read "critical" as "critical of contraception/IVF" rather than
  "critical of RRM."

### The 11 genuinely anti-RRM records (the exclusion target)

| id | sentiment | title (year) |
|----|-----------|--------------|
| recqRxIiGTT3AZ4QK | hostile | The False Promise of Restorative Reproductive Medicine (JAMA, 2026) |
| recA07i0bJXLk7VGp | hostile | Reply of the authors: Response to "The illusion of reproductive choice…" (F&S, 2026) |
| reckZdx7yVNLVMP6O | hostile | Response to "The illusion of reproductive choice…" (F&S, 2026) |
| recXuAGpgGIuWCtB0 | critical | Endometriosis Surgery: Debates About RRM (Obstet Gynecol, 2026) |
| receIN3PuPlSjOODh | critical | Too Soon to Adopt Progesterone for Prevention of Preterm Delivery (2003) |
| reca7WHvsnWaQY7qX | critical | False risk attribution… Yuzpe regimen (Contraception, 2003) |
| rectfW68sPM12S9WL | critical | Contraceptive failure of the ovulation method (Fam Plann Perspect, 1990) |
| recnPSZLQR19mVwSp | critical | The new politics of natural family planning (1986) |
| reckLRPo9VFs5YMkM | critical | The risks of the natural family planning methods (1986) |
| recicgZ9RHL5atFDk | critical | "Abortion myths and realities": who is misleading whom? (1982) |
| recguD4d9U7FUCwHh | critical | Between Advanced Medical Technology and Prayer (NaPro, 2014) |

Full bucketed list: `/tmp/rrm-library-hostile-critical-audit.md` (delivered to Brian 2026-06-14).

## Does the category surface stay updated? (answers Brian's question)

Yes — fully automatic, build-time. Two surfaces:

1. **`src/pages/library/topics/[slug].astro`** — `getStaticPaths()` re-derives the entire
   category SET and per-category membership from the live `/articles` feed on every build.
2. **`src/pages/library/index.astro`** — atlas tile counts (`countTopic`) recomputed from
   the same feed on every build.

Every deploy runs `fetch-all` → pulls fresh from D1 → regenerates both. A newly
classified+published paper lands in its topic grid and bumps the tile count on the next
deploy. **Zero manual upkeep.** The only hand-maintained pieces are the 9 atlas tile
definitions and the duplicated topic descriptors. Neither surface filters on `sentiment`
today — that is the sole reason flagged papers leak in.

## Goals

- Anti-RRM papers do not appear on any browsable category page or atlas count.
- `sentiment` is honest: `critical`/`hostile` means "anti-RRM," nothing else.
- Category set is curated, not an auto-generated junk-drawer of 21 pages.
- Atlas tiles + descriptors refreshed; descriptor duplication removed.

## Non-goals (deferred)

- **Phase 2 — "Critiques & Our Response" page.** Pairing each of the 11 with an RRM
  rebuttal via the `responds_to` relation. Current rebuttal coverage is **0/11** (the
  library holds exactly one `responds_to` link and one editorial record, unpublished,
  targeting a different paper). This requires authoring 11 rebuttals through the held
  `/editorials/` "RRM Responds" initiative (Gianna draft → Naomi review → citation-check
  → publish → link). Folds into that initiative as its own spec; out of scope here.
- Changing the `/articles` worker feed filter, retraction handling, or search ranking.

## Architecture

Build-time only. No worker/runtime/schema changes. Phase 1 = a D1 re-classification pass
(data) + edits to two Astro pages + `public/_redirects` (code).

### Workstream A — Fix the mislabels (D1 re-classification)

Re-classify the **55** mislabeled records (66 flagged − 11 genuine, per the 2026-06-14
live query; the local `articles.json` cache lags live by ~2, so **recompute the exact set
from a fresh live query into a checked manifest at execution** — do not hard-code 55) so
`sentiment` is correct.

- **Mechanism:** `/classify-library --re-classify <id1> <id2> …` scoped to the mislabeled
  ids, run under a **unique model tag** (e.g. `reclassify-mislabel-2026-06-14`) so revert is
  clean via `classification_history WHERE model='<tag>'` (do NOT rely on a 4-column capture —
  `/classify-result` rewrites domain, rrm_relevance, evidence_weight, reasoning, hashes,
  timestamps too). The current
  canonical classifier already encodes the rule ("IVF/ART/CONTRACEPTION studies are NOT
  anti-RRM → neutral; reserve `critical` for substantive academic disagreement with RRM,
  `hostile` for active attacks"). Persisted via the worker `/classify-result` endpoint
  (writes `rrm_relevance`, `domain`, `sentiment`, `traditions`).
- **Expected outcome:** contraceptive-harm → `neutral` (or `supportive` where the paper
  explicitly advances an RRM-aligned argument); IVF registries + HFEA stats → `neutral`.
  The 2 review-bucket records resolve per the classifier's read.
- **Sanity gate:** after the pass, re-run the audit query; the only records left in
  `critical`/`hostile` must be the 11 (± any the classifier legitimately re-confirms — a
  human read confirms before accepting a 12th). PG-3 proof gate in the worker already
  warns when a known RRM-aligned author is tagged `critical`.
- This is the heaviest piece and the prerequisite that makes Workstream B a clean,
  self-maintaining `sentiment IN ('hostile','critical')` filter.

### Workstream B — Sentiment filter on the two surfaces

After A, exclude `sentiment IN ('hostile','critical')` at build time. The article objects
already carry `sentiment` (`src/lib/fetch-data.mjs:76`, `src/lib/airtable.ts` Article type).

- **`src/pages/library/topics/[slug].astro`** — in `getStaticPaths()`, filter the article
  set before deriving `segmentLabels` and before `matched`. A single shared predicate
  `isCategorySafe(a)` = `!['hostile','critical'].includes((a.sentiment||'').toLowerCase())`.
- **`src/pages/library/index.astro`** — apply the same predicate to the `articles` set
  feeding `countTopic()` and the "recent additions" list.
- **Self-maintaining:** any future anti-RRM paper auto-drops from categories the moment
  it is classified — no code change ever needed again.
- Flagged papers remain published, individually reachable at `/library/<slug>/`, and in
  search (Pagefind/Vectorize). They are removed only from curated category browsing.

### Workstream C — Prune junk categories (curated allowlist)

Today `getStaticPaths()` emits a page for **every** top-level topic = 21 pages. Introduce
an allowlist; non-allowlisted top-level topics do not get a page.

Current inventory (top-level topic → published count). Allowlist = **16 browsable / 5
demoted-to-tag**:

| Keep — browsable page | n | Demote to tag (no page) | n |
|---|---|---|---|
| Infertility | 875 | Reproductive Endocrinology | 957 |
| Diagnostics | 570 | Research Methodology | 710 |
| Pregnancy | 558 | General OB/GYN | 659 |
| Menstrual Cycle | 438 | Ethics/Philosophy | 203 |
| Fertility Awareness | 437 | Patient Education | 1 |
| Contraception/Comparison | 392 | | |
| Endometriosis | 259 | | |
| Surgery | 228 | | |
| Body Literacy | 203 | | |
| PCOS | 203 | | |
| Perimenopause/Menopause | 201 | | |
| Bone Health | 192 | | |
| RRM Methods | 144 | | |
| NaProTECHNOLOGY | 139 | | |
| Andrology | 86 | | |
| Postpartum | 81 | | |

**Demote rationale:** Research Methodology + General OB/GYN are meta/junk-drawer buckets;
Ethics/Philosophy is not clinical evidence and clusters anti-RRM content (18/203 flagged) —
Brian: keep the tag, no page; Patient Education is a singleton. **Reproductive
Endocrinology** added per the 2026-06-14 fusion verdict (Opus 4.8 + GPT-5.4, both
independent → unanimous): it is the conventional IVF establishment subspecialty's own name
(REI), co-extensive with the union of its siblings — **934/957 (97.6%) of its records
already carry another top-level topic; only 23 are RE-only**. Off-brand to headline on an
RRM library, and a definitional junk drawer. Per ASRM 2025 scope-of-practice, REI's scope
*is* PCOS + endometriosis + infertility + menstrual disorders + andrology + surgery; and no
major patient library (MedlinePlus, HHS OWH) browses by it. Re-home the 23 RE-only records
into the existing **Hormones & Cycle** tile (RRM's condition/biology vocabulary, not the
specialty name). Do NOT merge wholesale into Infertility (re-bloats it past 1,800).
**16 keep / 5 demote.**

- **Implementation:** `const CATEGORY_ALLOWLIST = new Set([...])` (lowercased) in the
  shared `src/data/library-topics.ts`; `getStaticPaths()` skips non-allowlisted segments.
  Demoted topics remain as record tags (searchable, surface under articles' other topics) —
  they just get no browse page.
- **Demoted slugs:** `reproductive-endocrinology`, `research-methodology`, `general-ob-gyn`,
  `ethics-philosophy`, `patient-education` → **301 to `/library/`** via `public/_redirects`
  (avoid 404s on any indexed/linked category page).
- **Edge case:** the 23 RE-only records re-home to Hormones & Cycle; any other article whose
  *only* top-level topic is demoted stays search-only (rare). No article leaves the corpus.

### Workstream D — Refresh tiles + de-duplicate descriptors

- Descriptors live in two places today (`index.astro` `TOPICS[].desc` and
  `topics/[slug].astro` `TOPIC_DESCRIPTORS`) — a drift risk. **Consolidate** into one
  shared module `src/data/library-topics.ts` exporting `{ label, slug, descriptor, atlas?,
  accent?, icon? }` per category; both pages import it. Single source of truth for the
  allowlist (C), atlas tiles (D), and descriptors.
- **Atlas tiles (locked):** refresh the 9 existing tiles' copy + **add a "Diagnostics" tile**
  (→ 10 tiles). Perimenopause/Menopause stays browsable but not a featured tile. The
  "Hormones & Cycle" tile absorbs the 23 RE-only re-homed records. No REI tile.

## Data / IA decisions — RESOLVED (Brian, 2026-06-14)

1. **Allowlist** — 16 browsable / 5 demoted-to-tag. Ethics/Philosophy + Reproductive
   Endocrinology both demoted to tag-only (tag stays on records; no browse page; old slug
   301s to `/library/`; records stay searchable + on their other category pages).
2. **Atlas tiles** — refresh the 9 existing tiles' copy + **add a "Diagnostics" tile** (→ 10
   tiles). Perimenopause/Menopause stays browsable but is not a featured tile. No REI tile.
3. **Contraceptive-harm 22** — re-tag default `neutral`; the re-classify pass promotes an
   individual paper to `supportive` only where its abstract explicitly advances an
   RRM/anti-contraception argument. No blanket `supportive`.

## Risks

- **Re-classification flips a genuine critique to neutral.** Mitigated: the 11 are excluded
  from the re-classify batch; sanity gate confirms only the 11 remain flagged after.
- **Dropping a category orphans articles.** Mitigated: search + other-topic membership retain them.
- **Descriptor consolidation touches two live pages.** Covered by existing E2E
  (`tests/e2e/library-pagination.spec.js`, `library-search.spec.js`) + visual check.
- **CI floor** `articles >= 3000` unaffected (no records removed from the feed).

## Verification (proof gates)

- After A: audit query returns exactly 11 in `critical`+`hostile` (± human-confirmed).
- After B: build locally; assert no flagged `slug` appears in any
  `dist/library/topics/*/index.html`; atlas counts drop by the flagged-per-topic deltas.
- After C: `dist/library/topics/` contains only allowlisted slugs; dropped slugs 301
  under `wrangler pages dev dist`.
- After D: both pages render identical descriptors from the shared module; Playwright
  screenshot of `/library/` (desktop + 393×852 mobile) before "done."
- Lint/build gates: `npm run check-types`, `npm run lint`, `npm run guard` as applicable.

## Rollback

Site changes are build-time: revert the commit + redeploy. Re-classification (A) is
reversible via `classification_history WHERE model='reclassify-mislabel-2026-06-14'` (the
unique batch tag) — not a partial column capture. The RE-only re-home (Task 10) is reversible
from the per-record before-state in `manifest-rehome.json`. NOTE: both A and the re-home are
LIVE D1 writes (visible via the worker `/articles`, search, `/ask`, MCP the instant they
land) — they sit in Phase 1B, after the go-live gate, never pre-staged.

## Phase 2 pointer

"Critiques & Our Response" (`/library/critiques/`) pairing the 11 with RRM rebuttals via
`responds_to` → folds into the held `/editorials/` "RRM Responds" initiative. Separate spec
when that initiative is un-held. See memory `rrm-responds-initiative`.
