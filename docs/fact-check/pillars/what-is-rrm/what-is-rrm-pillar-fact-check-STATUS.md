# `/what-is-rrm/` Pillar Fact-Check — Execution Status

**Date:** 2026-04-22
**Scope:** Post-verification edit plan from `what-is-rrm-pillar-fact-check-VERIFICATION.md`

---

## ✅ Completed (autonomous)

### Phase 1 — D1 library record fixes (3 records via `wrangler d1 execute --remote`)

| Record | Change |
|---|---|
| `recaOmK7fzRWF0fud` Boyle 2018 | `authors` and `vancouver_citation`: `Smith TA` → `Parnell TA` |
| `recqZT89JyKkR2pwi` Duane 2022 | `authors`: reordered to match PubMed (`Duane M, Stanford JB, Porucznik CA, Vigil P`) |
| `recrbMJ978V341R4u` Yeung 2024 | `journal`: Preprints.org → Acta Scientific Women's Health; year 2024 → 2025; volume 7 / issue 1; DOI cleared (Acta Scientific does not mint DOIs); all three citation formats updated |

### Phase 2 — Pillar mechanical edits (7 edits, 3 files)

**`src/pages/what-is-rrm/index.astro`:**
- L101 (JSON-LD) + L1543 (ref #17): `Smith TA` → `Parnell TA` (Boyle 2018)
- L1537 (ref #11): Yeung journal `6, no. 12 (2024)` → `7, no. 1 (January 2025)`
- L1553 (ref #28): Stanford 2021 `21 (2021): 455` → `21, no. 1 (2021): 495`
- L458: CCL founder `Ronald Prem` → `Konald Prem`
- L460: Hilgers 1976 rewritten — St. Louis University start, Creighton July 1977 move

**`src/pages/naprotechnology/index.astro` L601:** `Smith TA` → `Parnell TA`
**`src/pages/neofertility/index.astro` L76:** `Smith TA` → `Parnell TA`

Final grep confirms zero remaining `Smith TA` or `Ronald Prem` strings across the 3 files.

### Phase 3 — Gianna prose refinements (6 edits on pillar, voice-compliant)

| Tier | Location | Change |
|---|---|---|
| T2.3 | L486 | Added Yeung methodology sentence (single tertiary referral center, ~50% annual questionnaire response rate) at first citation |
| T2.7 | L783 | Boyle 2018 prose: "32.1%" now labeled as life-table (Kaplan-Meier adjusted), paired correctly with 74 live births |
| T2.8 | L941 | Boyle 2025 "74% conceived again" → "Of 35 couples who remained in contact and tried for another pregnancy, 74% (26/35) achieved a second live birth" |
| T2.9 | L798 | Tham 2012 now shows both crude (38%) and Kaplan-Meier adjusted (66% at 24 months) |
| T2.10 | L945 | Sanchez-Mendez attribution: added NaPro protocol at Fertilitas Center Madrid clarifier |
| T2.11 | L755 | Comparison table: added `chart-note` footnote on RRM-12-cycles vs IVF-single-transfer time-horizon asymmetry |

All 14 voice gates passed (no em dashes, no IVF endorsement, excision-only framing intact, etc.).

### Phase 4 — articles.json + canonical SSOT regen

- `npm run fetch-data` → `src/data/articles.json` now has 3,247 records; all 3 target records reflect corrected metadata.
- `scripts/build-canonical-facts.mjs --entity rrm` → `fact-boyle-2018-ivf-repeat-failure-benchmark` now has `source.authors` = `Boyle PC, de Groot T, Andralojc KM, Parnell TA`.
- napro SSOT regen'd (Boyle 2018 fact is not in napro tradition — no cross-SSOT propagation needed).

---

## ⚠️ Flagged follow-ups (need Brian)

### F1. Boyle 2018 `apa_citation` still contains `Smith, T. A.`

**Status:** Blocked by permission gate on direct D1 `UPDATE` after initial write batch.

**Impact:** Low — `authors` and `vancouver_citation` are the fields consumed by the site build and canonical SSOT. `apa_citation` is legacy / export-only.

**Fix path:** One SQL line, needs explicit re-authorization:
```sql
UPDATE articles
SET apa_citation = REPLACE(apa_citation, 'Smith, T. A.', 'Parnell, T. A.')
WHERE id='recaOmK7fzRWF0fud';
```

### F2. Yeung canonical fact body still has wrong denominator

**Status:** `fact-yeung-2024-excision-repeat-2-5pct` in `rrm-canonical-facts.json` still shows:
- `claim`: `"Repeat surgery rate after optimal excision: 2.5% (14/570) vs historical ablation rate 40-60%"`
- `body`: contains `"cohort of 620 women … 14 of 570"` plus `"Preprint, not yet peer-reviewed"` tail

**Actual paper abstract:** `2.5%, 15/620` (published in Acta Scientific Women's Health 7(1), January 2025).

**Why regen didn't fix:** canonical SSOT builder pulls fact row from D1 `facts` table, not from the `articles` row I updated. The fact's own `claim` and `body` fields are stored statically in `facts`.

**Fix path:** Direct UPDATE to D1 `facts` table (or via `/promote-facts` workflow with corrected claim). Needs similar re-authorization as F1.

---

## 🔍 Unverifiable without external primary sources

Items that couldn't be resolved during the verification pass — sources returned 402/403/404 or require transcripts I couldn't retrieve.

### Data-freshness (Tier 3 in original report)

| # | Claim | What's needed |
|---|---|---|
| T1.2 | Endometriosis diagnostic delay — canon cites Pugsley 2007 (9 years); report suggests French 2025 / PSNet 2024 show 5–8 years | Pull French 2025 and PSNet 2024 systematic review, compare to Pugsley. Decide whether to replace canonical fact or add a 2nd source. |
| T1.3 | PCOS prevalence — canon has only Hilgers 2004 (6%); WHO current is 10–13% | Add/update canonical PCOS fact with WHO 2026 fact sheet or Teede 2023 International Evidence-based Guideline |
| T3.1 | IVF per-cycle cost $15k–30k — SART/FertilityIQ/RESOLVE all returned 404 in fact-check pass | Manual check against SART 2025 or FertilityIQ current figures |
| T3.2 | CDC singleton IVF prematurity 11.8% (from 2019 data) — report suggests current is ~14.9% | Manual check CDC ART Surveillance latest annual report |
| T3.3 | HFEA under-35 figure — confirmed 35% for 2022 fresh transfers via external | Already validated as "slightly stale" (pillar says 33%). Low priority. |
| T3.4 | IVF decline trend past 2016 — PMC 2025 "declining efficiency of IVF" paper | Manual fetch of the specific PMC paper |

### External citation verifications

| # | Claim | What's needed |
|---|---|---|
| T2.3 | Yeung acknowledged "50% response rate, survey data" on Natural Womanhood podcast | NW podcast episode exists (June 23, 2025) but transcript inaccessible via WebFetch. If this caveat is added to the pillar, sourcing the exact quote would strengthen it. Currently added as a statement of methodological fact (T2.3 landed). |
| T4.4 | FEMM 2012 founding + "1,500 medical providers trained" | femmhealth.org pages don't expose these numbers publicly. Would need FEMM annual report PDF or direct contact. |
| — | Arkansas Act 859 (2025) first state to mandate RRM insurance coverage | Arkansas Legislature server returned 404 during verification. |
| — | RESTORE Act H.R. 3589 (119th Congress, Harshbarger + Moore) | Congress.gov returned 403. |
| — | ACOG Committee Opinion No. 651 (Dec 2015, "Menstruation in Girls and Adolescents: Using the Menstrual Cycle as a Vital Sign") | ACOG URL returned 402. Not in canon either. |
| — | Katz et al. 2011 cost study ($1,182 / $24,373 medians) | Not in local library. Would need PubMed PMID 20189169 external fetch. |
| — | Cochrane 2023 review "2 RCTs, 86 women combined" (unexplained subfertility IVF) | Not in local library as primary record. |
| — | IIRRM 52 countries, CCL 20+ countries | Not in canon; external-only. Low impact — both plausible and cited. |

### Framing judgment calls

| # | Claim | Options |
|---|---|---|
| — | "93.5% pelvic disease on near-contact re-examination" (Hilgers) | Canon cleaner claim is **89% endometriosis specifically** (6.5% truly normal = 93.5% any finding). If the pillar prose is about endometriosis detection, cite 89%; if about any pelvic abnormality, 93.5% is defensible. |
| — | NOA "affects ~1% of all men" | Canon pooled fact is 1.2% [95% CI 0.7–1.8%] in infertility-workup denominator, not "all men." If pillar framing says "all men," slight tightening needed. |

---

## Files modified

| File | Fields / sections |
|---|---|
| D1 `articles` table | 3 records (Boyle 2018, Duane 2022, Yeung 2024) — authors, journal, year, volume, issue, DOI, vancouver_citation, (+apa/mla for Yeung) |
| `src/pages/what-is-rrm/index.astro` | JSON-LD citation, reference list, body prose (T2.3 / T2.7 / T2.8 / T2.9 / T2.10 / T2.11), historical section, CCL/FEMM history |
| `src/pages/naprotechnology/index.astro` | Line 601 Boyle 2018 authorship |
| `src/pages/neofertility/index.astro` | Line 76 Boyle 2018 authorship (JSON-LD) |
| `src/data/articles.json` | Regenerated from D1 (3,247 records) |
| `docs/fact-check/rrm-canonical-facts.json` | Regenerated (1,047 facts); Boyle 2018 source.authors corrected |
| `docs/fact-check/naprotechnology-canonical-facts.json` | Regenerated (2,571 facts) — no Boyle 2018 cross-propagation needed |

No git commits made. No deploys triggered. Safe to review diffs and commit manually when ready.

---

## Recommended commit sequence

```bash
cd ~/iCode/projects/rrm-academy-cf
git status
git diff src/pages/what-is-rrm/index.astro src/pages/naprotechnology/index.astro src/pages/neofertility/index.astro
# Review edits, then:
git add src/pages/what-is-rrm/index.astro \
        src/pages/naprotechnology/index.astro \
        src/pages/neofertility/index.astro \
        src/data/articles.json \
        docs/fact-check/rrm-canonical-facts.json \
        docs/fact-check/naprotechnology-canonical-facts.json
git commit -m "fix(pillars): correct Boyle 2018 + Duane 2022 authorship, Yeung 2024 journal, Stanford 2021 vol/page, Hilgers 1976 location, Konald Prem spelling

- D1 authors/vancouver_citation fixed: Boyle 2018 (Smith->Parnell), Duane 2022 (reorder to match PubMed), Yeung 2024 (Preprints->Acta Scientific 7:1 Jan 2025)
- Pillar ref #17, #11, #28 + JSON-LD + sibling pillars swept
- T2 prose: Boyle 2018 life-table/crude conflation, Boyle 2025 denominator, Tham 2012 adjusted rate, Sanchez-Mendez attribution, RRM-vs-IVF time-horizon footnote, Yeung methodology caveat
- Regen articles.json + canonical SSOT"
```
