# ART Registries & Codes of Practice -- Topic Hub Spec

> Generated 2026-05-11 from Bing Webmaster Tools AI grounding report.
> Captures unintended-but-valuable AEO traction on regulator/registry library records and turns it into a defended pillar.

## Why this hub

Bing AI grounding citations are concentrating on three regulator/registry library records that have no internal-link structure beyond the library index:

| Library record | Bing AI citations | Bing grounding queries |
|---|---|---|
| `/library/hfea-code-of-practice-9th-edition-version-94-0n2bg9oa/` | 122 | "hfea code of practice", "hfea code of practice 9th edition" |
| `/library/rtac-code-of-practice-for-reproductive-technology-units-australia-and-new-zealan-tml78lnz/` | 65 | "rtac code of practice" |
| `/library/human-fertilisation-and-embryology-act-1990-lmwayq0r/` | 15 | "hfea code of practice" (variant) |
| `/library/final-report-of-the-medical-research-councilroyal-college-of-obstetricians-and-g-recfymjps4idpfuga/` | 20 | (long-tail) |

Plus the broader cluster of national-registry records (Q-IVF Sweden, Japan ART, AU/NZ ART, France AMP, RLA Latin America, US ART) -- approximately 30 records, ~50 citations combined.

**Total AEO surface affected: ~270 citations / 15% of the total report.**

The traction is real and unprompted. AI engines are using rrmacademy.org as the canonical English-language reference for these regulator documents. A topic hub:
1. Defends and amplifies the existing AEO grounding
2. Provides a single landing surface that ties to the research-drafts ART registry comparison paper
3. Cross-links 30+ orphaned library records into a coherent topology
4. Captures the unique RRM/restorative POV that Wikipedia cannot replicate (regulator documents through a restorative lens)

## What this hub is NOT

- Not a Wikipedia-style neutral summary. RRM Academy's competitive advantage is the restorative POV. Every regulator code description must include the "what RRM patients should know about this" framing.
- Not a research paper. The ART registry comparison paper in `research-drafts/` is the academic artifact; this hub is the public landing surface that links to it.
- Not a directory of clinics. It's a directory of REGULATORY FRAMEWORKS and REGISTRIES.

## URL + IA

**Decision:** New pillar page at `/art-registries-and-codes/` (kebab-case, root-level, matches existing pillar pattern).

Alternative names considered and rejected:
- `/regulators/` -- too narrow, ambiguous (could mean drug regulators)
- `/ivf-quality-codes/` -- frames as IVF-positive; off-brand
- `/art-codes/` -- "codes" alone is ambiguous

`/art-registries-and-codes/` is unambiguous, long-tail-friendly, and matches the AEO queries Bing already routes to us.

**Short URL:** `/registries` -> 301 to `/art-registries-and-codes/` via rrm-router.

**Add to `ASTRO_ROUTES` in rrm-router**: `/art-registries-and-codes`.

## Page structure

```
H1: ART Registries and Codes of Practice: A Reference for Patients and Clinicians
Byline: By RRM Academy, Reviewed by Dr. Naomi Whittaker, MD

Hero/lede (200-300 words)
- What national ART registries and codes of practice are
- Why patients should care (data transparency, success-rate audits)
- The RRM perspective: registries focus on cycle outcomes, not patient outcomes

Section 1: National Codes of Practice (regulators)
- UK: HFEA Code of Practice 9th edition
  - 2-3 paragraph summary + restorative POV
  - Link to /library/hfea-code-of-practice-9th-edition-version-94-0n2bg9oa/
  - Inline link to /library/human-fertilisation-and-embryology-act-1990-lmwayq0r/
- Australia + New Zealand: RTAC Code of Practice
- US: ACOG + ASRM committee opinions (vary by topic, no single code)
- Other national bodies as records accumulate

Section 2: National Registries (data)
- UK: HFEA register + MRC/RCOG historical reports
- Sweden: Q-IVF Annual Reports (2014-2025)
- Japan: JSOG ART Annual Summary (2019, 2022, 2023)
- Australia + NZ: ANZARD reports (2010, 2020)
- France: AMP medical and scientific reports
- Latin America: RLA / REDLARA
- US: SART + CDC ART National Summary
[Each with restorative POV + library link]

Section 3: What the registries get right, and what they miss
- Cycle-level outcome focus (oocyte retrievals, embryo transfers, live births per cycle)
- Patient-level outcome gaps (cumulative LBR, time to LBR, drop-out)
- Surrogate/donor reporting variability
- Cost transparency variability
- Link to research-drafts ART registry comparison paper (when published)

Section 4: How RRM Academy uses these documents
- We treat them as ground truth on IVF transparency, while critiquing methodological gaps
- We link our IVF Clinical Ledger work to specific registry data

Section 5: FAQ schema (4-6 questions)
- "What is the HFEA Code of Practice?"
- "What is RTAC?"
- "Why do ART success rates differ between registries?"
- "Where can I find IVF success rates for [country]?"
- "What is a national ART registry?"
- "Does the US have a national ART code of practice?"

Section 6: All registry/code library records
- Auto-generated list pulling from D1 articles where category includes
  "regulatory_framework" OR "national_registry"
- Sorted by country, then year
- Each entry links to /library/<slug>/

Cross-links throughout:
- /naprotechnology/ (restorative alternative)
- /what-is-rrm/ (philosophical frame)
- /commentary/ posts on IVF outcomes
- /faqs/ entries on IVF vs RRM cost
```

## Schema (JSON-LD)

- `MedicalWebPage` primary
- `BreadcrumbList`: Home -> ART Registries
- `FAQPage`: 4-6 questions
- `ItemList`: all linked library records (allows AI engines to discover the corpus)
- `Article` author = `#organization` (RRM Academy), reviewedBy = `#naomi-whittaker`

## Data dependency

D1 `articles` needs reliable category tagging. Audit current state:

```sql
SELECT id, slug, title, category
FROM articles
WHERE title LIKE '%code of practice%'
   OR title LIKE '%registry%'
   OR title LIKE '%annual report%' AND title LIKE '%fertility%'
   OR title LIKE '%registro latinoamericano%'
   OR title LIKE '%embryology act%'
   OR title LIKE '%ANZARD%'
   OR title LIKE '%REDLARA%'
   OR title LIKE '%Q-IVF%'
LIMIT 50;
```

If the `category` column doesn't reliably distinguish these, the page can use a curated list of slugs in `src/data/art-registries.json` (build-time) rather than a runtime query.

## Implementation

**File:** `src/pages/art-registries-and-codes/index.astro` (new directory + page).

**Data source:** `src/data/art-registries.json` (new) -- curated list of slugs grouped by country and type. Easier to maintain than runtime D1 queries.

**Template:** Follows the existing pillar pattern. Reference `/naprotechnology/index.astro` for structure (hero, sections, FAQ schema, byline pattern).

**Shell:** Enable via `PUBLIC_SHELL_ROUTES` once shell is rolled out (already chrome-aware: include `"art-registries-and-codes"` in the env var).

**Sitemap:** Auto-included via Astro sitemap integration. No manual addition.

**Internal-link sweep:** After page goes live, add cross-links from each library record's commentary (if any) to this hub. The library record template (`src/pages/library/[...slug].astro`) could add a "Topic hub" rail entry when category matches regulator/registry.

## Defend the AEO win

1. **Submit the new hub URL + the 3 top-cited library records to IndexNow** on first publish (auto-handled by `submit-indexnow.mjs` post-deploy).
2. **Add the hub to llms.txt** (auto-generated from sitemap, no action needed if integrated normally).
3. **Cross-link from FAQ section**: add a new FAQ slug `/faqs/where-can-i-find-national-ivf-registries/` linking the hub.
4. **Glossary cross-link**: glossary entries for "HFEA", "RTAC", "ANZARD", "Q-IVF", "ART registry" each link to the hub. Use `/glossary-update` skill.

## Out of scope (this spec)

- Building automated re-tagging of D1 records into a `regulatory_framework` category (could be a follow-up if curated JSON proves brittle)
- Translating regulator descriptions into multiple languages
- Adding embeds or visualizations of registry data trends
- Coordinating with the research-drafts ART registry comparison paper for inline embeds (do this after the paper is published)

## Estimated effort

- Spec: this file ✓
- Curated `art-registries.json` (~30 entries): 1 hour
- `index.astro` page: 3-4 hours (matches existing pillar patterns)
- FAQ entries + glossary cross-links: 1-2 hours via /glossary-update
- Internal-link sweep on 30 library records: defer until automation pattern proven; 2 hours manual
- IndexNow submission: automatic on deploy

Total: ~half-day of focused work. Brian to schedule.

## Citation accounting (this spec's expected impact)

| Today | After hub launch | After 30-day Bing re-grounding |
|---|---|---|
| ~270 citations spread across 30 orphan records | ~270 + ~50 from hub itself | Expected lift to 400-500 as Bing AI grounds on the hub as canonical |

The hub becomes the "easy answer" for Bing when patients ask about ART registries, while the underlying library records continue to absorb research-grade citations.
