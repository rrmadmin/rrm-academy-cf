# Verification Pass on `what-is-rrm-pillar-fact-check.md`

**Date:** 2026-04-22
**Method:** 4 parallel sub-agents cross-checked the report's own claims against
(a) canonical facts SSOTs, (b) `src/data/articles.json` library records,
(c) the pillar source at `src/pages/what-is-rrm/index.astro`,
(d) live PubMed / PDF / Wikipedia / HFEA / WOOMB external sources.

**Bottom line:** the report is directionally correct on most flags, but
contains **four material errors** and **misses three real pillar bugs**.

---

## Report errors (report corrected here)

### E1. T1.1 — Boyle 2018: author ORDER in the "correction" is wrong

- Report recommended fix: `de Groot T, Andralojc KM, Boyle PC, Parnell TA`
- **PubMed PMID 30109231 ground truth:** `Boyle PC, de Groot T, Andralojc KM, Parnell TA` (Boyle is FIRST author)
- The pillar's only error is **`Smith TA` → `Parnell TA`**. Order is already correct. Do NOT reorder.

### E2. T1.1 propagation — library record is also wrong

- Report assumed "library record is ground truth."
- `src/data/articles.json` record `recaOmK7fzRWF0fud` (Boyle 2018) contains `Smith TA` in BOTH `authors` and `vancouverCitation` fields.
- Root cause is in **D1 `articles`** — article record `recaOmK7fzRWF0fud`. Fix must land in D1 first, then regen articles.json, then regen canonical SSOT. Plus pillar edits.

### E3. T1.4 — Duane 2022: report is backwards

- Report flagged pillar as wrong: `Duane M, Stanford JB, Porucznik CA, Vigil P`
- **PubMed PMID 35685421 ground truth:** `Duane M, Stanford JB, Porucznik CA, Vigil P` — pillar matches PubMed **exactly**.
- Mismatch is in the **library record** `recqZT89JyKkR2pwi` (D1), which stores `Duane M, Porucznik CA, Vigil P, Stanford JB`.
- **Do NOT edit the pillar.** Fix the D1 record to match PubMed.

### E4. T2.2 — Yeung denominator: actual paper is 15/620, not 14/620

- Report flagged canonical inconsistency between `14/570` (claim) and `14 of 570` (body).
- **Paper abstract (confirmed in articles.json `recrbMJ978V341R4u`):** `2.5%, 15/620`.
- Canonical is wrong on BOTH numerator (14 → 15) AND denominator (570 → 620).
- Pillar line 665 says "620 patients" with no fraction, which matches the abstract and is fine.

---

## New pillar bugs the report missed

### N1. Stanford 2021 volume/page number typo (ref #28)

- `what-is-rrm/index.astro:1553` reads: `BMC Pregnancy and Childbirth 21 (2021): 455`.
- **Correct (PubMed + articles.json):** `21, no. 1 (2021): 495`.
- Same propagation sweep needed on sibling pillars.

### N2. Yeung 2024 journal/volume are BOTH wrong in pillar (not just library)

- `what-is-rrm/index.astro:1537` reads: `Acta Scientific Women's Health 6, no. 12 (2024)`.
- **Actual journal metadata** (from PDF at `actascientific.com/ASWH/pdf/ASWH-06-0643.pdf`):
  - **Volume 7, Issue 1, January 2025**
  - Received Dec 9, 2024 / Published online Dec 18, 2024 / Print issue Jan 2025
  - The `ASWH-06-0643` filename is article number, **not** volume number — a natural source of confusion.
- Report flagged the library as stale (Preprints.org DOI) but missed that the pillar itself cites a nonexistent volume/issue.
- **Fix pillar to:** `Acta Scientific Women's Health 7, no. 1 (January 2025)`.

### N3. 93.5% "pelvic disease on near-contact re-exam" vs 89% endometriosis

- Canonical (`rrm-canonical-facts.json`, Hilgers clinical series) reports: **6.5% truly normal, 89% endometriosis specifically** on near-contact re-exam after "normal" prior laparoscopy.
- Pillar's 93.5% is arithmetically `100 – 6.5` ("any pelvic finding"). If the page is framed as **endometriosis**, cite **89%**; if framed as **any pelvic abnormality**, 93.5% is defensible. Recommend tightening the framing.

---

## Confirmations that stand

| Tier | Claim | Verdict |
|---|---|---|
| T1.1 | `Smith TA` is on pillar line 101 (JSON-LD) and line 1543 (ref #17), on `naprotechnology/index.astro:601`, `neofertility/index.astro:76`, canonical fact `fact-boyle-2018-ivf-repeat-failure-benchmark`, AND `articles.json:255858` (library) | CONFIRMED + propagation scope corrected |
| T1.2 | Canonical `fact-endo-diagnosis-delay` cites Pugsley 2007 for 9-year median | CONFIRMED verbatim |
| T1.3 | Canonical has only ONE PCOS prevalence fact (6%, Hilgers 2004) | CONFIRMED |
| T2.2 | Canonical Yeung fact has internal inconsistency | CONFIRMED (correct values are 15/620) |
| T2.4 | Canonical supports 40–60% ablation recurrence within 1–2 years (Sutton 1994, Winkel 2003) via fact `reczMwK17MDqPcbax-7`; `fact-chapter-79` covers 10–83% conservative-surgery range | CONFIRMED |
| T2.5 | Canonical: Hilgers began CrMS at St. Louis University April 1976, moved to Creighton July 1977. Pillar line 460 wrong | CONFIRMED — pillar needs edit |
| T2.6 | Bewley S, Foo L, Braude P. *BMJ* 342:d436 (PMID 21273271) | CONFIRMED — citation is correct |
| T2.7 | Pillar line 782 conflates 32.1% (life-table adjusted) with 74 (crude count) | CONFIRMED |
| T2.8 | Pillar line 940 "74% conceived again" overstates denominator (35 not 98) and outcome (repeat live birth, not conception) | CONFIRMED |
| T2.9 | Pillar line 797 cites crude 38% without labeling, chart at line 1077 uses adjusted 66% | CONFIRMED |
| T2.10 | Sanchez-Mendez 2025 = NaProTechnology at Fertilitas Center, Madrid (per abstract + author affiliations) | CONFIRMED |
| T2.11 | Boyle 2025 abstract + title explicitly flag "up to 12 optimal cycles" vs "one cycle of IVF" asymmetry | CONFIRMED |
| T3.3 | HFEA 2022 preliminary data: **35%** per embryo transferred, age 18–34. Pillar's 33% is slightly stale | CONFIRMED |
| T4.3 | Wikipedia: "Dr. **Konald** Prem" (not Ronald) | CONFIRMED — pillar line 458 needs edit |
| Primary studies 1–8 | All other author strings match PubMed | CONFIRMED |

---

## Unverifiable (need external primary sources)

- T2.3 Yeung "50% response rate" podcast acknowledgment — NW podcast episode exists (June 23, 2025) but transcript inaccessible. Leave as editorial judgment.
- T3.1 IVF cost $15–30k/cycle — SART/FertilityIQ blocked; directional claim stands.
- T3.2 CDC singleton prematurity 11.8% vs current 14.9% — CDC ART page 404'd.
- T3.4 IVF decline trend continuation past 2016 — PMC 2025 paper not locally accessible.
- T4.4 FEMM 2012 + 1,500 providers — FEMM public pages did not expose these data.
- Katz 2011 cost figures, Cochrane 2023 "2 RCTs, 86 women" — referenced but not in local library.
- IIRRM 52 countries / CCL 20+ countries — not in canon; external-only.
- Arkansas Act 859, RESTORE Act H.R. 3589, ACOG Committee Opinion 651 — state/federal servers 403/402/404'd; defer external reverification.

---

## Revised edit plan

### Phase 1 — Critical citation fixes (HIGH priority)

1. **D1 `articles` record `recaOmK7fzRWF0fud` (Boyle 2018):**
   Change `authors` and `vancouverCitation` — `Smith TA` → `Parnell TA`.
   Preserve existing first-author position (`Boyle PC` is first).

2. **D1 `articles` record `recqZT89JyKkR2pwi` (Duane 2022):**
   Fix `authors` order to `Duane M, Stanford JB, Porucznik CA, Vigil P` to match PubMed.
   Pillar is already correct — do not touch pillar for T1.4.

3. **D1 `articles` record `recrbMJ978V341R4u` (Yeung 2024):**
   Update journal from `Preprints.org` → `Acta Scientific Women's Health`, Vol 7 Issue 1, Jan 2025.

4. **Regen articles.json** via `npm run fetch-data` → pushes corrected records.

5. **Pillar edits** (`what-is-rrm/index.astro`):
   - Line 101 + 1543: `Smith TA` → `Parnell TA` (only — do not reorder)
   - Line 1537: `6, no. 12 (2024)` → `7, no. 1 (January 2025)`
   - Line 1553: `21 (2021): 455` → `21, no. 1 (2021): 495`
   - Line 458: `Dr. Ronald Prem` → `Dr. Konald Prem`
   - Line 460: rephrase St. Louis 1976 → Creighton July 1977

6. **Sibling pillar edits**:
   - `src/pages/naprotechnology/index.astro:601` — `Smith TA` → `Parnell TA`
   - `src/pages/neofertility/index.astro:76` — `Smith TA` → `Parnell TA`
   - Sweep both siblings for Stanford 2021 volume/page and Konald Prem consistency

7. **Canonical SSOT regen** after D1 updates — `node scripts/build-canonical-facts.mjs --entity rrm` to propagate authorship + Yeung numerator/denominator fixes.

### Phase 2 — Statistical / framing polish (MEDIUM priority)

Same as report Tiers T2.2 (with 15/620 correction), T2.4 (cite Sutton/Winkel directly, not Whittaker Masterclass), T2.7, T2.8, T2.9, T2.10, T2.11.

### Phase 3 — Canonical SSOT + data freshness

- T1.2/T1.3: add newer PCOS (WHO 2026, Teede 2023) and endo-delay (French 2025, PSNet 2024) canonical facts if those sources verify. Pillar itself can stay.
- T3.1–T3.4: update figures when external sources reachable.

### Phase 4 — Nice-to-have

- Tighten 93.5% → 89% framing if the claim is specifically about endometriosis detection.
- Verify FEMM 2012 + 1,500 providers from FEMM annual report.

---

## Files and fact IDs referenced

- `/Users/brian/iCode/projects/rrm-academy-cf/src/pages/what-is-rrm/index.astro` (lines 101, 458, 460, 482, 661, 665, 671, 782, 797, 803, 940, 1077, 1537, 1543, 1553)
- `/Users/brian/iCode/projects/rrm-academy-cf/src/pages/naprotechnology/index.astro:601`
- `/Users/brian/iCode/projects/rrm-academy-cf/src/pages/neofertility/index.astro:76`
- `/Users/brian/iCode/projects/rrm-academy-cf/src/data/articles.json` (records `recaOmK7fzRWF0fud`, `recqZT89JyKkR2pwi`, `recrbMJ978V341R4u`, `recL71gZDoW7xaCZu`, `recXp2MFrb2AMuQPa`, line 41564)
- `/Users/brian/iCode/projects/rrm-academy-cf/docs/fact-check/rrm-canonical-facts.json` (facts: `fact-boyle-2018-ivf-repeat-failure-benchmark`, `fact-endo-diagnosis-delay`, `fact-wave1-…-six-p-110`, `fact-endo-excision-vs-ablation`, `fact-yeung-2024-excision-repeat-2-5pct`, `fact-chapter-15-scientific-foundations-of-the-crms-*`, `fact-chapter-66-…-22`, `fact-chapter-79-recurrence-…-pears-1`, `reczMwK17MDqPcbax-7`)
- `/Users/brian/iCode/projects/rrm-academy-cf/docs/fact-check/naprotechnology-canonical-facts.json`
- `/Users/brian/iCode/projects/rrm-academy-cf/docs/fact-check/creighton-canonical-facts.json`

*End of verification pass. No edits applied to any source file.*
