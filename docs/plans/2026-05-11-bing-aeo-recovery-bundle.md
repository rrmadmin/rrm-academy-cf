# Bing AEO Recovery Bundle — 2026-05-11

> Consolidated plan generated from the 2026-05-11 Bing Webmaster Tools AI grounding report audit.
> Status: drafted, awaiting Brian's explicit approval on production D1 mutations.

## Summary of findings

Bing/Copilot AI grounding cites rrmacademy.org **1,833 times across 214 URLs**. Three structural leaks identified:

| Leak | Citations | Status | Plan |
|---|---|---|---|
| `www.rrmacademy.org/library/...` 404s (slug divergence) | ~94 | drafted | rrm-router patch (28 rec-ID redirects + 9 slug-redirect entries + regex extension) |
| Archived canonical regulator/registry records (HFEA, RTAC, ANZARD 2023, Q-IVF 2025, etc.) | ~270 | **drafted, blocked** | Un-archive 7 D1 records + remove 4 router 410 entries + rebuild |
| Isthmocele commentary lacks FAQ schema (high-AEO post) | indirect | drafted | Append FAQ section + commentary template patch (FAQPage detection) |

Plus already-submitted IndexNow ping (HTTP 200) for 20 priority apex URLs.

## Deliverables (artifacts ready)

1. **rrm-router patch** — `~/iCode/projects/rrm-router/docs/2026-05-11-bing-aeo-recovery-patch.md`
2. **REC_ID_REDIRECTS map** — `~/iCode/projects/rrm-router/docs/2026-05-11-rec-id-redirects.js.proposed` (28 entries)
3. **Pattern B slug redirects** — `~/iCode/projects/rrm-router/docs/2026-05-11-slug-redirects-additions.js.proposed` (9 entries)
4. **ART registry hub spec** — `~/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-art-registries-topic-hub.md`
5. **ART registry hub body draft** — `~/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-art-registries-hub-draft.md` (Gianna voice, 198 lines, 12 proof gates passed)
6. **ART registry curated SSOT** — `~/iCode/projects/rrm-academy-cf/src/data/art-registries.json` (14 canonical singletons)
7. **Isthmocele FAQ additions** — `~/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-isthmocele-faq-additions.md` (5 FAQs + reusable template patch)

## Blocked production mutations (awaiting Brian's explicit approval)

### A. D1 status flip on rrm-library (7 records)

```sql
UPDATE articles
SET status='published', updated_at=datetime('now')
WHERE id IN (
  'rec0N2BG9oAt3t96t1If',  -- HFEA Code of Practice 9th edition (122 cites)
  'recTml78LNzEKUjpgyKw',  -- RTAC Code of Practice 2024 (65 cites)
  'recyMOTFmJgbDoQOgyLz',  -- ANZARD 2023
  'recfwGutrJ1KGQ6ZyChG',  -- Q-IVF 2025
  'rec6C2Cj4qxNMxoseSBp',  -- RLA 2021
  'recv99NMs5R9Mzv1ahKw',  -- HFE Act 2008
  'recLmwAyq0R8wTshlvxg'   -- HFE Act 1990
) AND status='archived';
```

All 7 records have short abstracts (440–1,256 chars) already in summary form. No public page renders article_bodies; restoration does not expose any full-text content. Per Brian's "short summary + link only" rule.

### B. rrm-router 410 list removal (4 entries)

In `~/iCode/projects/rrm-router/src/index.js`, remove these from the GONE_410 array:
- `/library/human-fertilisation-and-embryology-act-1990-lmwayq0r`
- `/library/human-fertilisation-and-embryology-act-2008-v99nms5r`
- `/library/rla-2021-registro-latinoamericano-de-reproduccion-asistida-latin-american-regist-6c2cj4qx`
- `/library/rtac-code-of-practice-for-reproductive-technology-units-australia-and-new-zealan-tml78lnz`

### C. D1 post body update on rrm-auth (1 record)

Append the FAQ section to the isthmocele commentary in `posts.content`. Full markdown payload in the isthmocele FAQ plan file.

### D. Rebuild + IndexNow

After A + B + C: trigger `gh workflow run deploy.yml`, verify URLs return 200, IndexNow-ping the 14 canonical registry URLs + the isthmocele commentary.

## Execution plan (post-approval)

1. **Single PR in rrm-academy-cf** (`claude/2026-05-11-bing-aeo-recovery`):
   - `src/pages/commentary/[...slug].astro` — FAQPage detection patch
   - `src/data/art-registries.json` — curated SSOT (already committed)
   - `src/pages/art-registries-and-codes/index.astro` — new pillar page (using Gianna's draft + standard pillar template)
   - `docs/plans/2026-05-11-*.md` — all 4 planning artifacts
2. **Single PR in rrm-router** (`bing-aeo-recovery`):
   - `src/index.js` — regex extension + REC_ID_REDIRECTS import + rec-ID fallback block + remove 4 entries from 410 list
   - `src/rec-id-redirects.js` — new (28 entries)
   - `src/slug-redirects.js` — append 9 Pattern B entries
3. **D1 mutations** (after PRs merge):
   - rrm-library: 1 UPDATE (7 rows)
   - rrm-auth: 1 UPDATE (1 row, posts table)
4. **Build + verify**:
   - `gh workflow run deploy.yml` in rrm-academy-cf (full rebuild picks up D1 changes)
   - `wrangler deploy` in rrm-router
   - Verify 14 registry URLs return 200
   - Verify isthmocele page emits FAQPage JSON-LD
5. **IndexNow ping**:
   - 14 registry canonical URLs + 1 isthmocele URL = 15 URLs in one batch submission

## Expected impact (citation accounting)

| Today | After execution | After 30-day Bing re-grounding |
|---|---|---|
| ~270 citations to 404/410 on registry/regulator records | URLs return 200; AEO surface restored | Expected recovery + 10-20% lift on isthmocele page |
| ~94 citations to 404 on www. library URLs | URLs 301 to apex canonical | Bing index converges within 30-60 days |
| 1,833 total citations | Same surface, drift-corrected | Expected 10-15% net AI citation growth over 60 days |

## Risks

- **D1 status flip on rrm-library** is reversible (UPDATE back to status='archived').
- **router 410 removal** is reversible (re-add the entries).
- **D1 post body update** is reversible if the prior content is preserved before update; the FAQ append doesn't replace existing content.
- **Build trigger** is a no-op deploy with refreshed data; rollback is the prior commit.

No part of this bundle modifies user-facing data (signups, donations, courses, etc.).

## Addendum 2026-05-11 (late evening): RRM Library backing for /art-registries-and-codes/ external citations

The §3 ("What the Registries Measure Well, and What They Miss") and §4 ("How RRM Academy Uses These Documents") rewrites cited 10 external peer-reviewed sources. All ingestible sources are now in the RRM Library (D1 + R2 + fact extraction where applicable), so internal links can replace external PubMed/DOI links per `feedback-rrma-link-direction-policy.md`.

**8 of 10 ingested end-to-end. 2 deferred.**

| # | Citation (corrected where source attribution was wrong) | recID | Slug |
|---|---|---|---|
| 1 | Malizia BA, Hacker MR, Penzias AS. Cumulative live-birth rates after IVF. N Engl J Med 2009;360(3):236-243. PMID 19144939 (user-provided 19129528 was wrong). | `recC1KONioNcA9YSqPwr` | `/library/cumulative-livebirth-rates-after-in-vitro-fertilization-c1konion/` |
| 2 | Smith ADAC, Tilling K, Nelson SM, Lawlor DA. Live-Birth Rate Associated With Repeat IVF Treatment Cycles. JAMA 2015;314(24):2654-2662. PMID 26717030 (off-by-one from user's 26717029). | `recrpeh9KNjow1EveQ9H` | `/library/livebirth-rate-associated-with-repeat-in-vitro-fertilization-treatment-cycles-rpeh9knj/` |
| 3 | Sharma V, Allgar V, Rajkhowa M. Factors influencing the cumulative conception rate and discontinuation of IVF treatment for infertility. **Fertil Steril 2002;78(1):40-46** (NOT BMJ as the brief stated). PMID 12095488. Pre-existing dupe; 10 new facts extracted. | `recaSZgI3MHDQgKO4` | `/library/factors-influencing-the-cumulative-conception-rate-and-discontinuation-of-in-vit-recirlkao5nysb6gc/` |
| 4 | Stoop D et al. "Why do women drop out of IVF treatment?" Hum Reprod 2014;29(9):1960-1969. **DEFERRED — citation does not exist.** DOI 10.1093/humrep/deu207 resolves to a different paper (severe teenage acne and endometriosis). Closest canonical match by topic+design is Verberg MFG et al, Hum Reprod 2008 PMID 18544578 (DOI 10.1093/humrep/den219) — but author/year shift is too large to silently substitute. Brian should confirm intended citation. | — | — |
| 5 | Pearson KR, Hauser R, Cramer DW, Missmer SA. Point of failure as a predictor of IVF treatment discontinuation. Fertil Steril 2009;91(4 Suppl):1483-1485. PMID 18829010 (user attributed to "Bell AM, Rajkhowa M" — incorrect; PMC2692136 is by Pearson et al.). | `recuQ5L5DGqWpTXqn2KN` | `/library/point-of-failure-as-a-predictor-of-in-vitro-fertilization-treatment-discontinuat-uq5l5dgq/` |
| 6 | Chambers GM, Hoang VP, Sullivan EA, Chapman MG, Ishihara O, Zegers-Hochschild F, Nygren KG, Adamson GD. The impact of consumer affordability on access to ART. **Fertil Steril 2014;101(1):191-198** (NOT MJA 201(3):158-159 as stated). PMID 24156958. The MJA item may be a derivative cost commentary; this is the primary international analysis. | `recp4vBFXvEakHApAw74` | `/library/the-impact-of-consumer-affordability-on-access-to-assisted-reproductive-technolo-p4vbfxve/` |
| 7 | Smeenk J, Wyns C, De Geyter C, et al. **ART in Europe, 2020** (NOT 2021): results generated from European registries by ESHRE. Hum Reprod 2025;40(11):2038-2055. PMID 40985526. The "ART in Europe 2021" paper does not exist in PubMed; the most recent EIM registry report is the 2020-data 24th ESHRE report published 2025-11-01. Pre-existing dupe (`receHrdx7d7wuBVqUKoi`) had wrong PMID 40986080 (sepsis paper) — patched to 40985526. | `receHrdx7d7wuBVqUKoi` | `/library/art-in-europe-2020-results-generated-from-european-registries-by-eshre-eHrdx7d7/` |
| 8 | GAO-20-519 "Assisted Reproductive Technology: Clarification of Definitions and Improvements in Data Collection Could Improve Accuracy". 2020. **DEFERRED — citation does not exist.** GAO-20-519 is actually "Bank Supervision: FDIC Could Better Address Regulatory Capture Risks" (Sept 2020). No GAO report with this ART title exists per gao.gov search. Brian should confirm whether intended source is CDC's NASS surveillance program, GAO-25-107477 (abortion restrictions, 2025), or a different oversight body. | — | — |
| 9 | Garolla A, Pizzol D, Carosso AR, et al. Practical Clinical and Diagnostic Pathway for the Investigation of the Infertile Couple. Front Endocrinol 2020;11:591837. PMID 33542705 / PMC7851076. User described as "multidisciplinary expert pathway for first-line IVF" — actual title is broader (infertile couple investigation, not IVF-specific). | `recHaHAKNthrYsXHGAlA` | `/library/practical-clinical-and-diagnostic-pathway-for-the-investigation-of-the-infertile-hahaknth/` |
| 10 | Sánchez-Méndez JI et al. NaProTechnology for infertility: take-home baby rate and clinical outcomes in a 5-year single-center cohort of 1,310 couples. Front Reprod Health 2025;7:1696679. PMID 41323405. Pre-existing dupe; 3 facts already extracted. | `recMAMtlS8CcPTWzQ` | `/library/natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa/` |

**All 8 live URLs verified HTTP 200 on 2026-05-11 23:55 UTC.** Rebuild 25704037825 succeeded; IndexNow auto-pinged via deploy workflow.

**Citation accuracy findings worth flagging:** of the 10 sources in the brief, **6 had factual errors in the citation provided** (wrong PMID, wrong journal, wrong authors, or non-existent paper). The /art-registries-and-codes/ rewrite went live with external citations that may misattribute these. Per the link-direction policy, replacing those external citations with the corrected internal library URLs both fixes the misattribution and converts the page from "we cite external sources" to "we have these sources in our research library" (E-A-T + AEO lift).

## Live-page corrections required (consolidated 2026-05-11 from ingest pass + Perplexity Sonar Pro fact-check)

Independently confirmed by Perplexity Sonar Pro (`~/Downloads/Fact-Check  RRM Academy — ART Registries and Codes of Practice.md`, May 11). The page text itself — not just the citation hrefs — has factual errors that need correcting before backlinks can safely point at the new library entries. Backlinking now would amplify, not fix, the misattribution.

| Loc | Current text | Correction | Source |
|---|---|---|---|
| §2 HFEA | "9th edition, in force from 2024" | "9th edition, launched January 2019; current version 9.4 in force from 26 October 2023" | hfea.gov.uk news 2019 + 2023 |
| §3 Malizia (line 404) | "Malizia et al. (2009, NEJM) followed **898 women** through four cycles: per-cycle live birth rate was 33%, but the intention-to-treat cumulative rate was **54%**, versus a theoretical **84%** with no dropout. A 30 percentage-point gap from attrition alone." Link points to PMID 19279322 (wrong PMID). | "Malizia et al. (2009, NEJM) followed **6,164 patients across 14,248 cycles**. After six cycles, the cumulative live-birth rate was **72% under an optimistic analysis** (assuming patients who didn't return had the same chance as those who continued) and **51% under a conservative analysis** (assuming no live births among those who dropped out). The ~20 percentage-point gap between optimistic and conservative reflects the impact of attrition." Replace href with `/library/cumulative-livebirth-rates-after-in-vitro-fertilization-c1konion/`. | PMID 19144939 abstract |
| §3 Smith (line 404) | "Smith et al. (2015, JAMA), using HFEA registry data on **64,065 patients**, found the real-world three-cycle cumulative rate was 46%, versus 58% without dropout." Link points to PMID 26717029 (off-by-one). | Cohort size — Perplexity confirms 64,065 is consistent with the paper's prognosis-adjusted analysis subset; full cohort was 156,947 UK women. Cumulative prognosis-adjusted live-birth rate **after 6 cycles was 65.3%**, not "46% after 3 cycles vs 58% without dropout". Brian should reconcile against actual abstract. Replace href with `/library/livebirth-rate-associated-with-repeat-in-vitro-fertilization-treatment-cycles-rpeh9knj/`. | PMID 26717030 abstract |
| §3 Sharma (line 406) | "Sharma et al. (2002, BMJ) found 66% of **899 HFEA registry patients** never returned for a second cycle" | Sharma 2002 was published in **Fertil Steril** (78(1):40-46), not BMJ. Cohort was **2,056 single-center patients** at St James's University Hospital, Leeds — not HFEA registry-wide and not 899. Extracted facts (recaSZgI3MHDQgKO4, 10 facts) show **64% of patients dropped out after the first attempt** (36% continued). Replace href with `/library/factors-influencing-the-cumulative-conception-rate-and-discontinuation-of-in-vit-recirlkao5nysb6gc/`. | PMID 12095488 abstract + extracted facts |
| §3 Stoop (line 406) | "Stoop et al. (2014, Human Reproduction) found 42% dropout after cycle one in 1,418 Belgian patients" | **Citation does not exist.** No Stoop paper with this title, year, journal, and cohort is indexed in PubMed/CrossRef. Closest match by topic is Verberg MFG et al, Hum Reprod 2008 PMID 18544578. Either remove the claim or replace with Verberg 2008 after Brian confirms. | search miss confirmed |
| §3 Bell (line 406) | "Bell et al. (2009, Fertility and Sterility) found 24% of 2,245 women ceased treatment entirely" | Cohort size (2,245) is correct. Authors are **Pearson KR, Hauser R, Cramer DW, Missmer SA**, not Bell. The paper's primary finding is about which point of cycle failure predicts discontinuation, not a single "24% ceased" headline. Perplexity could not confirm the 24% figure in the abstract. Either rewrite the sentence with correct attribution + paper's actual primary finding, or drop. Replace href with `/library/point-of-failure-as-a-predictor-of-in-vitro-fertilization-treatment-discontinuat-uq5l5dgq/`. | PMID 18829010 abstract |
| §3 Chambers (line 408) | "Chambers et al. (2014, Medical Journal of Australia) estimated Australian cumulative cost per live birth at AUD 25,000 to 80,000 by age group." Link points to MJA URL. | The cost-by-age-group claim is consistent with Chambers' Australian work; the **primary methods paper** is Fertil Steril 2014;101(1):191-198 (PMID 24156958). The MJA URL may point to a derivative cost commentary by the same author. Either keep MJA link if that's the actual cost-by-age source, or replace with `/library/the-impact-of-consumer-affordability-on-access-to-assisted-reproductive-technolo-p4vbfxve/`. | PMID 24156958 + brief verification |
| §3 De Geyter (line 410) | "De Geyter et al. (2025, Human Reproduction), analyzing ESHRE EIM data across 1.2 million cycles, reported 13.1% of ART singletons born preterm" Link `https://academic.oup.com/humrep/article/40/1/15/7841234` is **404**. | "ART in Europe, 2020" registry paper is the most recent (Smeenk J et al, Hum Reprod 2025;40(11):2038-2055, PMID 40985526). Brian should verify the 13.1% preterm figure against that paper (or the prior 2019-data report PMID 37847771). If the figure isn't in those reports, drop or re-source. Replace href with `/library/art-in-europe-2020-results-generated-from-european-registries-by-eshre-eHrdx7d7/` once stat is verified. | PMID 40985526 + Perplexity |
| §3 PMC7851076 (line 412) | "A 2021 multidisciplinary expert pathway documented in PMC7851076" | Replace href with `/library/practical-clinical-and-diagnostic-pathway-for-the-investigation-of-the-infertile-hahaknth/`. Otherwise text is OK. | PMID 33542705 |
| §3 GAO (line 416) | "The US Government Accountability Office (GAO-20-519, 2020) found SART data lacks independent verification..." Link points to a real GAO URL but **that report is about Bank Supervision / FDIC, not ART.** | The substance (SART self-reporting lacks independent audit) is **consistent with documented oversight concerns** per Perplexity, but GAO-20-519 is the wrong report number. Either remove the specific GAO report attribution and keep the substantive claim with an ASRM "Oversight of ART" reference, or find the actual GAO/oversight document the writer intended. | Perplexity + my gao.gov search |
| §4 SART 2022 | "The 2022 SART data implies a 35.3% live birth rate per retrieval" | Per Perplexity, **CDC most recent national data shows 37.5%**. SART 2022 35.3% could not be independently confirmed. Verify against SARTcorsonline.com 2022 national summary or replace. Note: this figure is suspiciously identical to Sanchez-Mendez's crude THB rate (35.3%), suggesting possible cross-contamination during drafting. | Perplexity |
| §4 Sanchez-Mendez | "Sanchez-Mendez et al. (2025), in a cohort of 1,310 couples followed at a NaProTechnology centre, reported **a 50% take-home baby rate at 24 months and 62.1% at 36 months or more**." | The "50% at 24 months" figure is **fabricated** — not in the published paper. Crude take-home baby rate was **35.3%** (n=463/1310); adjusted cumulative rate for couples completing protocol was 62.1%. RRM Academy's own FAQ page on this study correctly distinguishes crude vs adjusted; the ART page introduced the error. Rewrite to: "Sanchez-Mendez et al. (2025), in a cohort of 1,310 couples followed at a NaProTechnology centre, reported a crude take-home baby rate of 35.3% and an adjusted cumulative rate of 62.1% in couples who completed the full protocol." | PMID 41323405 + Perplexity + existing RRMA FAQ |

**Recommended fix flow (per Brian's standing rule — content goes through Gianna → rrma-seo-operator → write):**

1. Dispatch the **gianna-copywriter** agent with a brief: rewrite §3 and §4 paragraph-by-paragraph using corrected statistics (sources above), Naomi's clinical voice, with internal `/library/...` hrefs replacing the external PubMed/DOI/MJA links. Drop the Stoop and the GAO-20-519 attribution; leave the substantive claims if backed by other sources.
2. Pass the draft through **rrma-seo-operator** for AEO check (FAQPage / Article schema unchanged; verify no schema drift from text edits).
3. Apply via direct edit to `src/pages/art-registries-and-codes/index.astro`.
4. Trigger full rebuild dispatch + verify the live URL renders with the corrected stats + verify all internal library links return 200.
5. Submit IndexNow ping for the corrected page so Bing re-grounds quickly.

**Why this matters for AEO:** the page is currently a Bing AI grounding target as part of the recovery bundle. Fabricated stats (Malizia 898, Sanchez 50%) shipped today mean AI systems will cite RRM Academy as the source of those wrong numbers. Every day of delay is more AI training-data ingestion of the errors. Recommend Brian schedules the Gianna rewrite within 24–48 hours.
