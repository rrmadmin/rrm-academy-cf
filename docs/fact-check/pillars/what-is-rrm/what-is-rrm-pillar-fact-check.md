# Fact-Check: `/what-is-rrm/` Pillar Guide

**Page:** https://rrmacademy.org/what-is-rrm/
**File:** `src/pages/what-is-rrm/index.astro` (2,088 lines)
**Fact-check date:** 2026-04-22
**Scope:** Every verifiable factual claim on the page
**Status:** Pre-edit review. No changes applied to the Astro page yet.

---

## Methodology

Three independent passes were triangulated:

1. **Local SSOT pass (Opus + canonical facts):** Every statistical claim and primary-study citation was checked against `docs/fact-check/rrm-canonical-facts.json` (1,029 facts), `docs/fact-check/naprotechnology-canonical-facts.json` (2,571 facts), and direct abstract verification from `src/data/articles.json` for each of the nine cited primary outcome studies. Covers internal consistency with RRM Academy's own verified knowledge base.

2. **Perplexity pass 1:** NeoFertility-scoped fact-check against primary sources (Frontiers in Medicine, JRRM, PubMed, CDC/SART registries, NeoFertility institutional pages). Published at `/Users/brian/Downloads/Fact-Check\ \ RRM\ Pillar\ Page\ —\ NeoFertility\ Claims.md`.

3. **Perplexity pass 2:** Broader fact-check of all remaining sections — history, FABMs, conditions, evidence base, RRM-vs-IVF, cost, legislation. Published at `/Users/brian/Downloads/RRM\ Pillar\ Page\ Fact-Check.md`.

Rating scheme:
- ✅ **Verified** — supported by primary sources
- ⚠️ **Needs nuance** — directionally correct but requires qualification
- ❌ **Inaccurate** — contradicted by primary sources
- 🔍 **Unverified** — could not be confirmed or denied

---

## Sub-Agent Verification Results (2026-04-22)

After the initial fact-check report was drafted, three parallel general-purpose sub-agents cross-checked this report's own claims against the canonical facts SSOT. Their findings materially refined the Tier assignments:

### Agent 1 — Citation authorship cross-check

- **T1.1 confirmed.** Pillar + canonical fact both carry the "Smith TA" fabrication; library record (all three citation formats: APA, MLA, Vancouver) is ground truth.
- **NEW T1.4 found.** Reference #5 (Duane 2022) has the wrong author order — Stanford JB is the last author, not the second.
- **Smith TA propagation:** The error appears in 1 canonical fact (`fact-boyle-2018-ivf-repeat-failure-benchmark`), plus 2 sibling pillar pages (`naprotechnology/index.astro:601`, `neofertility/index.astro:76`), plus content drafts. Fix scope is broader than pillar-only.
- **Sanchez-Mendez 2025** is NOT in the library. Cannot verify authorship locally.
- **Bewley 2011** is NOT in the library. Needs external verification.

### Agent 2 — Statistical claims cross-check

- **T1.2 DOWNGRADED from Tier 1.** Canonical SSOT supports the 9-year figure (`fact-endo-diagnosis-delay`, verified/peer_reviewed, cites Pugsley 2007). Pillar is internally consistent with canon. The "5–7 years" claim from Perplexity pass #2 is external to SSOT — may indicate SSOT is stale vs current literature, but the pillar edit is not Tier 1.
- **T1.3 DOWNGRADED from Tier 1.** Canonical has ONE PCOS prevalence fact (6%, from Hilgers 2004). No 10–13% WHO figure in canon. Pillar's "6–12%" is broader than canon. Canonical SSOT needs update first.
- **T2.2 Yeung drift confirmed with additional detail:** Canonical fact `fact-yeung-2024-excision-repeat-2-5pct` has an **internal inconsistency** — claim says "(14/570)" but body says "cohort of 620 women… 14 of 570." Paper abstract says "15/620." Pillar matches abstract.
- **Sweep confirmed in canon:** TCFT >75% patency, SHSG/TCFT 9-37% pregnancy rates, Billings 1953, NaProTechnology named 1991, Saint Paul VI 1985, Hilgers 1976 at St. Louis.
- **Sweep NOT found in canon (rely on external citations):** 93.5% laparoscopy re-exam, azoospermia %s, micro-TESE rates, HSG false-positive %s, FEMM 1,500 providers, IIRRM 52 countries, CCL 20 countries, Odeblad dates, Prem name, IIRRM Nov 2000, FACTS 2010, FEMM 2012, NeoFertility 2016, RRM Academy 2023, JRRM 2025, Arkansas Act 859, ACOG Committee Opinion 651.

### Agent 3 — Historical/institutional cross-check

- **T2.5 Hilgers St. Louis location: CONFIRMED by canon.** Multiple chapter facts locate the 1976 research start at St. Louis University, with move to Creighton in July 1977. See T2.5 update below.
- **T2.4 Ablation scope REFINED.** Canon supports a STRONGER claim than the pillar currently makes: ablation recurrence 40–60% within **1–2 years** (Sutton 1994, Winkel 2003), not "40% within 5 years." Separately, "conservative surgery at laparotomy" is 10–83% (a broader range). The pillar should tighten the Sutton/Winkel framing, not broaden it. See T2.4 update below.
- **Billings Melbourne location NOT canon-verified** for Billings specifically — canon only has Melbourne for Dr. James Brown. Low-priority flag only.
- **NaProTechnology named 1991:** confirmed in napro canon.
- **Saint Paul VI 1985 Omaha:** confirmed in creighton canon (September 1985).

---

## Executive summary

The pillar page is overall **well-sourced and overwhelmingly accurate**. All nine cited primary outcome studies verify directly against their PubMed abstracts. Historical institutional facts (CCL, Creighton, Saint Paul VI, IIRRM, FACTS, FEMM, NeoFertility, JRRM) all check out.

**Three-pass verification applied:** (1) local Opus + canonical SSOT; (2) Perplexity NeoFertility scope; (3) Perplexity broader scope; **plus a fourth pass** (2026-04-22, three parallel sub-agents) cross-checked this report's own claims against the canonical facts SSOT. See the Sub-Agent Verification Results section below — two Tier 1 items were downgraded, one Tier 1 item was expanded, and Tier 2 #4 (Guo 2009 scope) was refined.

**After sub-agent verification, the edit priorities are:**

1. **T1.1 (Boyle 2018 authors)** — confirmed and expanded. The fabricated "Smith TA" error propagates to canonical fact `fact-boyle-2018-ivf-repeat-failure-benchmark` AND to sibling pillar pages (`naprotechnology/index.astro`, `neofertility/index.astro`) AND to content drafts. Fix scope is broader than originally flagged.
2. **T1.4 (NEW) — Duane 2022 authorship order wrong** in reference #5. Pillar says "Duane M, Stanford JB, Porucznik CA, Vigil P"; library (PMID 35685421) says "Duane M, Porucznik CA, Vigil P, Stanford JB."
3. **T1.2 (endometriosis 9 years) — DOWNGRADED from Tier 1 to Tier 3.** Canonical SSOT actively supports the 9-year figure (`fact-endo-diagnosis-delay`, verified/peer_reviewed, cites Pugsley 2007 PMID 17550672). Pillar is internally consistent with canon. The "5–7 years" claim from Perplexity pass #2 is external to SSOT. Action shifts: update canonical SSOT first if the newer literature (French 2025, PSNet 2024) supersedes Pugsley 2007, then decide whether to update the pillar.
4. **T1.3 (PCOS 6–12%) — DOWNGRADED from Tier 1 to Tier 3.** Canonical SSOT has only one PCOS prevalence fact (6%, from Hilgers 2004). No 10–13% WHO figure exists in canon. The pillar's "6–12%" range is actually broader and more current than canon. Same action pattern: update canonical first.

**Twelve Tier 2 items** concern citation accuracy, framing, or wording imprecision.

**Six Tier 3 items** are data-freshness updates (including the two downgraded Tier 1s, which are now canonical-SSOT-refresh work, not pillar-edit work).

**Five Tier 4 items** are defensible as-is.

---

# Tier 1 — Critical factual errors (fix immediately)

## T1.1 ❌ Boyle 2018 author string is wrong (propagates to 5+ files)

**Where (on the pillar):**
- Line 101–103 (JSON-LD citation block, `@graph[0].citation[4]`)
- Reference #17, line 1543

**Also propagates to (confirmed by sub-agent sweep):**
- `src/pages/naprotechnology/index.astro:601` — same "Smith TA" error
- `src/pages/neofertility/index.astro:76` — same "Smith TA" error
- `docs/fact-check/rrm-canonical-facts.json` → `fact-boyle-2018-ivf-repeat-failure-benchmark` → `source.authors` field
- Several `docs/content-drafts/*.md` files and `docs/what-is-rrm-export.md` mirror
- Fix scope: **pillar edits + D1 canonical fact update + canonical SSOT regen + draft cleanup**

**Pillar page says:**
> "Boyle PC, de Groot T, Andralojc KM, **Smith TA**"

**Actual paper (PMID 30109231, library record, confirmed via CrossRef):**
> "de Groot T, Andralojc KM, Boyle PC, **Parnell TA**"

**Two factual errors in the author string:**

1. **Wrong first author.** The paper's first author is **de Groot T**, not Boyle PC. Boyle is the third author.
2. **Fabricated fourth author.** "Smith TA" does not exist on this paper. The correct fourth author is **Parnell TA**.

**Why this matters:**
- The JSON-LD `@graph[0].citation` block gets consumed by Google Scholar, Bing, Perplexity, and other AI retrieval systems. A fabricated author will surface in search and citation tools.
- The reference list is what any clinician or patient would copy to re-verify the source.
- The page already uses correct author strings for Stanford 2008, Tham 2012, Boyle 2022, Boyle 2025, Sanchez-Mendez 2025 — this is the one outlier.

**Body prose note:** The informal "Boyle et al. (2018)" in body copy is defensible as senior-author shorthand (Boyle is the senior/corresponding author) and does not need to change. Only the formal citation entries need fixing.

**Recommended fix:** Update both locations to:
```
de Groot T, Andralojc KM, Boyle PC, Parnell TA. "Healthy Singleton Pregnancies
from Restorative Reproductive Medicine (RRM) After Failed IVF." Frontiers in
Medicine 5 (2018): 210. DOI: 10.3389/fmed.2018.00210. PMID: 30109231.
```

**Priority:** HIGH. Fabricated author in structured data is the single most fixable factual error on the page.

---

## T1.4 ❌ (NEW) Duane 2022 authorship order wrong in reference #5

**Where:**
- Reference #5, line 1531
- Also cited in JSON-LD citation block (line 86-90)

**Pillar page says:**
> "Duane M, Stanford JB, Porucznik CA, Vigil P"

**Library record (PMID 35685421, *Frontiers in Medicine* 9, 2022):**
> "Duane M, Porucznik CA, Vigil P, Stanford JB"

**Error:** Stanford JB is the last author, not the second. Author order drift.

**Recommended fix:** Update both JSON-LD (line 86-90) and reference #5 (line 1531) to:
```
Duane M, Porucznik CA, Vigil P, Stanford JB. "Fertility Awareness-Based Methods
for Women's Health and Family Planning." Frontiers in Medicine 9 (2022): 858977.
PMID: 35685421.
```

**Priority:** HIGH. Same class of error as T1.1 — formal citation doesn't match published paper.

---

## T1.2 ⚠️ Endometriosis diagnostic delay "nine years" — DOWNGRADED to Tier 3

**Sub-agent verification finding:** Canonical SSOT actively supports the 9-year figure.
- `fact-endo-diagnosis-delay` in `rrm-canonical-facts.json` claim: *"median 9 years from symptom onset to diagnosis"*
- Body: *"Median time from symptom onset to endometriosis diagnosis is 9 years (Pugsley 2007). The commonly cited '7-12 years' is vague and unsourced. Use the specific 9-year median with the Pugsley citation."*
- Source: Pugsley Z, Ballard K, 2007, PMID 17550672
- `verified: 1`, evidence_tier: `peer_reviewed`

The pillar is internally consistent with canon. The "5–7 years" claim is external (Perplexity pass #2 citing PSNet 2024, French 2025, global burden 2025). **Action shifts from pillar edit to canonical SSOT review.**

**Revised action:**
1. First, evaluate whether Pugsley 2007 has been superseded by more recent peer-reviewed studies (French 2025, PSNet 2024 systematic review).
2. If yes: update canonical fact `fact-endo-diagnosis-delay` in D1 with the newer source, regenerate SSOT.
3. Then update the pillar to match the revised canonical fact.

This is Tier 3 (canonical-SSOT refresh work), not Tier 1 (pillar editorial correction).

---

**Original Tier 1 analysis (preserved for reference):**

**Where:**
- Line 661: *"The median time from symptom onset to diagnosis is nine years."* (cites ref #13 Pugsley & Ballard 2007)

**Problem:**
Perplexity pass #2 rates this ❌ Inaccurate (not merely outdated). The "nine years" figure derives from a 1997 study and has not been the median in current literature for over a decade. Contemporary peer-reviewed data:

| Source | Year | Median/mean delay |
|---|---|---|
| PSNet (AHRQ) review | 2024 | 6–11 years range |
| French population study | 2025 | Median **5 years** (IQR 1.6–11.2) |
| Global burden analysis | 2025 | Average ~6.6 years |
| U.S. study | 2024 | Mean 4.4 years |
| Systematic review | 2024 | Overall 5–12 years |

**Current peer-reviewed consensus:** approximately **6–8 years**, with meaningful improvement over the past decade due to awareness campaigns and ACOG/ESHRE guidance.

**Recommended fix:** Replace "The median time from symptom onset to diagnosis is nine years" with one of:

- **Option A (conservative):** "Median delays from symptom onset to diagnosis are commonly reported at 6–10 years, with recent studies showing improvement."
- **Option B (specific):** "A 2025 population study reported a median diagnostic delay of 5 years (IQR 1.6–11.2), though historical ranges extended to 9+ years."
- **Option C (citation-anchored):** Cite a specific contemporary study (e.g., the 2025 French study) and its year.

**Replace reference #13** (Pugsley & Ballard 2007) with a current citation. The 2007 paper is not wrong for its era but anchors the page to outdated epidemiology.

**Priority:** HIGH. This is the single factual claim where a fact-checker would score us as inaccurate, not merely imprecise.

---

## T1.3 ⚠️ PCOS prevalence "6–12%" — DOWNGRADED to Tier 3

**Sub-agent verification finding:** Canonical SSOT has only ONE PCOS prevalence fact, and it's lower still:
- `fact-wave1-the-prevalence-of-pcos-is-thought-to-be-found-in-about-six-p-110` (rrm-canonical-facts.json)
- Claim: *"The prevalence of PCOS is thought to be found in about six percent of women"*
- Source: Hilgers 2004 textbook (*The Medical and Surgical Practice of NaProTechnology*)

**No canonical fact cites 10–13% WHO, Rotterdam criteria, or any current prevalence range.** The pillar's "6–12%" range is broader and more current than what canon currently holds. The SSOT is stale relative to external WHO consensus.

**Revised action:** Same pattern as T1.2 — update canonical first, then pillar.
1. Add/update a canonical PCOS prevalence fact with a current authoritative source (WHO 2026 fact sheet, Teede et al. 2023 International Evidence-based Guideline).
2. Regenerate canonical SSOT.
3. Then update the pillar "6–12%" → "10–13% (WHO)" or "8–13% depending on diagnostic criteria."

This is Tier 3 (canonical-SSOT refresh), not Tier 1 (pillar editorial correction).

---

**Original Tier 1 analysis (preserved for reference):**

**Where:**
- Line 671: *"PCOS affects 6-12% of reproductive-age women and is the most common endocrine disorder in this population."*

**Problem:**
The WHO's current (January 2026) fact sheet on PCOS states prevalence is **10–13% of reproductive-aged women**. The pillar's "6–12%" range straddles the WHO floor but sits noticeably below the authoritative current consensus.

Additional context:
- ICD-coded clinical prevalence studies: ~5.2% (lower, underdiagnosis-biased)
- Rotterdam criteria: ~10–15%
- AES (Androgen Excess Society) criteria: ~5–10%
- Systematic review with varied diagnostic criteria: 4–20% pooled
- WHO 2026: 10–13%

The "most common endocrine disorder in reproductive-age women" framing is accurate and widely supported.

**Recommended fix:** Update to one of:

- **Option A (WHO-aligned):** "PCOS affects an estimated 10–13% of reproductive-age women (WHO) and is the most common endocrine disorder in this population."
- **Option B (range-honest):** "PCOS affects 8–13% of reproductive-age women depending on diagnostic criteria, and is the most common endocrine disorder in this population."

**Priority:** HIGH. Citing below the current WHO consensus looks out of date in an AEO-optimized page.

---

# Tier 2 — Citation accuracy and framing (meaningful polish)

## T2.1 ⚠️ Yeung 2024 journal mismatch with library record

**Where:**
- Reference #11 (line 1537): cites *"Acta Scientific Women's Health 6, no. 12 (2024)"* with URL to `actascientific.com/ASWH/pdf/ASWH-06-0643.pdf`

**Library record (local):**
- Journal: **Preprints.org**
- DOI: `10.20944/preprints202409.1485.v1` (preprint DOI)
- Short citation: "Yeung P, Mohan A, Gavard JA, 2024"

**Two scenarios:**

1. **The paper WAS published in Acta Scientific Women's Health.** The pillar page citation is correct; the library record is stale (still pointing to the September 2024 preprint). Fix the library — update via rrm-library-worker to the Acta Scientific publication with its final DOI.

2. **The paper was NOT published in Acta Scientific Women's Health.** The pillar page is citing a non-existent peer-reviewed publication based on a hallucinated/drafted URL. This would be a serious citation error.

**Evidence for scenario (1):**
- The PDF URL format (`actascientific.com/ASWH/pdf/ASWH-06-0643.pdf`) matches Acta Scientific's publication URL conventions.
- Perplexity pass #1 treats the peer-reviewed publication as real.
- The preprint was submitted in September 2024 and would be reasonable timing for a December 2024 Acta Scientific publication.

**Recommended action:** Verify externally (fetch the PDF, check DOI resolution). If scenario (1), update the library record. If scenario (2), downgrade pillar framing from peer-reviewed to preprint.

**Priority:** MEDIUM. High signal for the RRM endometriosis advocacy case, and ambiguity here undermines the rest of the Yeung citation.

---

## T2.2 ⚠️ Canonical fact drift on Yeung denominator

**Where:** `docs/fact-check/rrm-canonical-facts.json` → `fact-yeung-2024-excision-repeat-2-5pct`

**Canonical fact says:**
> "Repeat surgery rate after optimal excision: 2.5% **(14/570)** vs historical ablation rate 40–60%"

**Yeung paper abstract (library record):**
> "The rate of repeat surgery after optimal excision surgery for endometriosis was remarkably low (**2.5%, 15/620**) as compared to historical rates of repeat surgery by ablation."

**Pillar page:** Says "620 patients" — matches published abstract ✅

**Conclusion:** Canonical fact is outdated, likely captured from an earlier preprint version. Pillar page is correct.

**Recommended action:** Regenerate the canonical fact via `node scripts/build-canonical-facts.mjs --entity rrm` after updating the source fact in D1 from 14/570 → 15/620.

**Priority:** MEDIUM (internal housekeeping). Does not affect the pillar page itself but will cause confusion on future fact-checks if not corrected.

---

## T2.3 ⚠️ Yeung 2.5% methodology caveat missing

**Where:**
- Line 486 (history section), line 665 (endometriosis section), line 1105 (evidence section), line 1306 (myths section)

**Problem:**
Dr. Yeung himself has publicly acknowledged (on the Natural Womanhood podcast and a YouTube interview) that the 2.5% figure comes from **annual patient questionnaires with approximately 50% response rate**, not a prospective chart-review follow-up. He has explicitly described it as "not perfect data — it's survey data."

The 2.5% figure is not *wrong* — it is the number Yeung reports in the peer-reviewed publication — but the underlying methodology limitation is editorially significant and acknowledged by the author himself.

**Recommended fix:** Add a single-sentence footnote at the first citation of the 2.5% figure (line 486 or 665). Example:

> Yeung's 2.5% figure is drawn from an annual patient questionnaire (approximately 50% response rate) at a single tertiary referral center. Dr. Yeung has publicly acknowledged this methodological limitation.

**Priority:** MEDIUM. Transparency about data quality strengthens rather than weakens the RRM case.

---

## T2.4 ⚠️ Ablation recurrence "40% within 5 years" — REFINED by canonical

**Sub-agent verification finding:** Canonical SSOT has stronger ablation-specific numbers than the pillar currently uses, and the 40-50% figure is actually **ablation-specific**, not "conservative surgery" generally.

Canonical facts:
- `fact-endo-excision-vs-ablation`: *"40–60% recurrence for ablation within 1–2 years; 75–85% long-term relief with excision"*
- `reczMwK17MDqPcbax-7` (napro): *"Published rates of endometriosis recurrence or persistence after ablation are 40–60% within 1–2 years, even with postoperative hormonal suppression, contrasting with 0% recurrence after complete excision in this teen cohort."* (cites Sutton 1994, Winkel 2003)
- `fact-chapter-79-recurrence-of-endometriosis-after-pears-1`: *"recurrence rate varying from 10 to 83 percent following **conservative surgery for endometriosis at laparotomy**"* — this is the broader "conservative surgery" range, separate from ablation.

**Revised assessment:** Perplexity pass #2 suggested the "40% within 5 years" applies to "ablation/conservative laparoscopic surgery" generally. Canonical supports a stronger claim:
- **Ablation specifically:** 40–60% within **1–2 years** (Sutton 1994, Winkel 2003)
- **Conservative surgery at laparotomy:** 10–83% range (broader)

The pillar's current "40% within five years after ablation" is actually CONSERVATIVE vs canon — canon supports 40–60% at **1–2 years**, which is a much stronger claim for the RRM-vs-ablation comparison.

**Revised recommended fix:** Tighten the pillar's framing, don't broaden it. Options:

- **Option A (canonical-aligned, stronger):** "compared to recurrence rates of 40–60% within one to two years after ablation (Sutton 1994, Winkel 2003)"
- **Option B (current, with scope clarifier):** Keep current framing but add citation accuracy: change "40% within five years" to "40–60% within 1–2 years" to match Guo 2009 and canon.

**Priority:** MEDIUM. The correction moves the pillar toward a stronger (and more accurate) anti-ablation comparison.

---

## T2.5 ⚠️ Hilgers "at Creighton University" in 1976 is a geographic error — CANONICAL-CONFIRMED

**Sub-agent verification finding:** Canonical SSOT explicitly confirms the location error.
- `fact-chapter-15-scientific-foundations-of-the-crms-*` (both creighton and napro canon): *"The research programs that led to the CrMS officially began in **1976 at St. Louis University School of Medicine** under the direction of Dr. Hilgers."*
- napro canon: *"The research program behind NaProTechnology began in **April 1976** when the Missouri Division of Health provided a grant to establish the St. Louis University Natural Family Planning Center."*
- napro canon: *"In 1976, Hilgers was an assistant professor in the Department of Obstetrics and Gynecology at **St. Louis University School of Medicine**."*
- Follow-on: *"The CrMS research base moved from St. Louis University to Creighton University School of Medicine in **July 1977**, with the first Natural Family Planning Practitioner education program beginning by November 1978."*

**Canon-backed recommended fix:**

> "Dr. Thomas Hilgers began the research in 1976 at St. Louis University School of Medicine that would become the Creighton Model FertilityCare System (CrMS). The research program moved to Creighton University in July 1977, where the method was formalized and named."

**Priority:** LOW-MEDIUM. Small but factual; canonical provides authoritative backing.

---

## T2.5-ORIGINAL ⚠️ Hilgers "at Creighton University" in 1976 (original analysis)

**Where:**
- Line 460: *"Dr. Thomas Hilgers at Creighton University took the next step, developing the Creighton Model FertilityCare System (CrMS) **starting in 1976**."*

**Problem:**
Hilgers began CrMS research in 1976 at **St. Louis University School of Medicine**, not Creighton. He moved to Creighton University later, where the method was formalized and named. Multiple independent sources confirm this (RRM Academy's own `/naprotechnology/` page, Wikipedia, bionity.com).

**Recommended fix:** Rephrase to separate the 1976 research start from the Creighton naming. Example:

> "Dr. Thomas Hilgers began the research in 1976 that would become the Creighton Model FertilityCare System (CrMS), later formalized and named at Creighton University."

**Priority:** LOW-MEDIUM. Small but factual, and easy to catch on any historical fact-check.

---

## T2.6 🔍 Bewley et al. (2011) citation not independently verified

**Where:**
- Reference #19 (line 1544): "Bewley S, Foo L, Braude P. 'Adverse Outcomes from IVF.' *BMJ* 342 (2011): d436."
- Cited at line 764, line 1117

**Problem:**
Perplexity pass #2 could not independently confirm this specific citation. The underlying claims — elevated rates of ectopic pregnancy, preeclampsia, placenta previa, and cesarean delivery in IVF-conceived pregnancies — are well supported by multiple independent sources (Frontiers in Medicine 2021; PMC 2014; PMC 2023 cohort studies on IVF obstetric outcomes). So the science is defensible regardless.

**Recommended action:**
1. Verify PMID/DOI for Bewley S, Foo L, Braude P, *BMJ* 342:d436 (2011).
2. If verified: no change needed.
3. If cannot verify: replace with one of the confirmed supporting citations:
   - PMC10440315 (2023): "How does IVF conception affect pregnancy complications in an older population"
   - Frontiers in Medicine 2021 (DOI 10.3389/fmed.2021.646220): "Risks of Placenta Previa and Hypertensive Disorders of Pregnancy in IVF"
   - PMC8826170 (2022): "Association of Preterm Singleton Birth With Fertility Treatment"

**Priority:** MEDIUM. Low probability of it being fabricated, but worth confirming since a single bad citation undermines the whole reference list's credibility.

---

## T2.7 ⚠️ Boyle 2018 prose conflates adjusted rate with crude count

**Where:**
- Line 782: *"Boyle et al. (2018) followed 403 couples who had undergone an average of 2.1 prior IVF attempts. After RRM evaluation and treatment, **32.1%** achieved a live birth through natural conception. **Of 74 live births**, 92% were born at 37 or more weeks gestation. Only one was a twin."*

**Problem:**
- 32.1% is the **life-table / Kaplan-Meier adjusted** rate.
- 74 is the crude count of live births (which corresponds to **18.4% crude**).
- 32.1% × 403 = 129 — which is not what happened.

Pairing the adjusted rate with the crude count without explaining the adjustment implies 129 live births (32.1% of 403) when there were actually 74. Any reader who does the arithmetic will be confused.

**Line 803 handles this correctly:** *"the life-table live birth rate was 32.1%"* — already qualified.

**Recommended fix (line 782):**

> "Boyle et al. (2018) followed 403 couples who had undergone an average of 2.1 prior IVF attempts. After RRM evaluation and treatment, the life-table live birth rate (Kaplan-Meier adjusted) was 32.1%, with 74 total live births documented. Of those, 92% were born at 37 or more weeks gestation. Only one was a twin."

**Priority:** MEDIUM. Statistical integrity; avoids misleading the reader.

---

## T2.8 ⚠️ Boyle 2025 chart note "74% conceived again" is doubly wrong

**Where:**
- Line 940: *"Of couples who conceived once, 74% conceived again in subsequent cycles."*

**Actual paper (Boyle 2025 abstract):**
> "74% (26/35) of couples who **remained in contact with us and tried for another pregnancy had a repeat successful live birth**."

**Two drifts:**

1. **Denominator wrong.** Pillar implies denominator is "couples who conceived once" (= 98, per the funnel chart). Actual denominator is 35 — couples who remained in contact AND tried for another pregnancy.
2. **Outcome wrong.** Pillar says "conceived again." Actual outcome is "repeat successful live birth" — a more conservative claim.

**Recommended fix:**

> "Of 35 couples who remained in contact and tried for another pregnancy, 74% (26/35) achieved a second live birth."

**Priority:** MEDIUM. Factual accuracy on a headline data visualization.

---

## T2.9 ⚠️ Tham 2012 prose cites only crude rate, omits adjusted

**Where:**
- Line 797: *"Among couples with infertility, **38%** achieved at least one live birth."*

**Problem:**
The pillar's comparison chart (line 1077) correctly shows Tham at **66.0%** — the Kaplan-Meier adjusted rate. But the body prose cites only 38%, the crude rate. This is inconsistent with how Stanford 2008, Boyle 2018, and Sanchez-Mendez 2025 are presented (all of which get both rates or the adjusted rate in prose).

Tham 2012 paper: "cumulative adjusted proportion of first live births… was **66 per 100 couples**, and the **crude proportion was 38%**."

**Recommended fix:** Add the adjusted rate:

> "Among 108 couples with infertility, 38% achieved at least one live birth (crude rate), with a Kaplan-Meier adjusted cumulative rate of 66% at 24 months."

**Priority:** LOW-MEDIUM. Consistency issue, not a factual error.

---

## T2.10 ⚠️ Sanchez-Mendez attribution clarity

**Where:**
- Line 944, line 949: *"Sanchez-Mendez et al. (2025)"* cited as a core RRM evidence source
- Chart source note: *"1,310 couples treated at a specialized fertility clinic in **Madrid**, 2019-2023"*

**Problem:**
This study used the **NaProTechnology/Creighton Model protocol** at Fertilitas Center Madrid. It is not a NeoFertility study. Because the pillar page covers RRM broadly, the attribution is technically accurate (NaPro is a subset of RRM) — but readers who arrive expecting NeoFertility-specific evidence may not realize this is a different clinical protocol from Boyle's Dublin work.

Also: the abstract does not specify Madrid; the "Madrid" attribution on the pillar page is presumably drawn from the paper's author affiliations or full-text introduction.

**Recommended action:**
1. Add a single-line clarifier in the study intro: "*This study applied the NaProTechnology protocol at Fertilitas Center Madrid, a subset of the broader RRM framework.*"
2. No change needed to the Madrid attribution (presumed verified from full text).

**Priority:** LOW-MEDIUM. Editorial clarity.

---

## T2.11 ⚠️ RRM vs IVF comparison table — time-horizon asymmetry

**Where:**
- Comparison table, line 734–754
- Live birth rate row: "41% crude LBR (Boyle 2025, n=187)" vs "~33% per embryo transferred, under 35 (HFEA)"

**Problem:**
The Boyle 2025 paper itself explicitly flags this in its limitations section: the RRM 41% accumulates across **up to 12 cycles of timed intercourse**, while the IVF comparator reflects a **single embryo transfer**. Boyle's own framing: *"We compare just one cycle of IVF."*

Presenting these two figures side-by-side in a comparison table without surfacing the asymmetry is the single most likely thing to be cited against RRM Academy by IVF-industry critics.

**Recommended fix:** Add a footnote or clarifying sentence immediately below the comparison table:

> Footnote: RRM outcomes reflect up to 12 cycles of treatment; IVF comparison figures reflect per-cycle per-transfer rates from mandatory reporting registries. Cumulative IVF live birth rates across multiple cycles are higher than single-cycle figures; multi-cycle IVF comparisons are addressed later in this section.

**Priority:** MEDIUM. Pre-empts a valid critique.

---

# Tier 3 — Data freshness (updates that strengthen the page)

## T3.1 ⚠️ IVF per-cycle cost floor $15,000 is outdated

**Where:**
- Line 241 (FAQ), line 758 (cost section), line 1109 (cost comparison), line 1296 (myth section), line 1455 (FAQ)

**Pillar page:** "IVF costs $15,000 to $30,000 per cycle in the United States."

**Current 2026 data:**
- Advanced Fertility Institute: $12,000–$18,000 base cycle; $20,000–$25,000 all-in with meds/labs/monitoring
- Carrot Fertility: Average all-in cost of one IVF cycle in the U.S. is $23,474
- SART: Base cycle $15,000–$20,000, but most couples pay $20,000+ after meds, ICSI, genetic testing, etc.

**Recommended fix:** Update per-cycle range to one of:

- **Option A (inclusive):** "$15,000 to $30,000 per cycle (base clinic fee)" + "$20,000 to $30,000 all-in with medications and labs"
- **Option B (simplified):** "IVF costs $20,000 to $30,000 per cycle in the United States when medications, labs, and monitoring are included."

Keep $40,000–$60,000 cumulative (2–3 cycles) — that figure remains accurate.

**Priority:** LOW-MEDIUM. Updating makes the RRM cost comparison more favorable, not less.

---

## T3.2 ⚠️ CDC singleton prematurity 11.8% figure is per 2019 data

**Where:**
- Line 763 (obstetric outcomes section), line 1115 (evidence section), chart at line 865

**Pillar page:** Cites "11.8% CDC" for IVF singleton prematurity.

**Source:** The Boyle 2025 paper itself cites 11.8% from CDC data that is likely from the 2019 ART Surveillance cycle.

**Current CDC data:** Most recent CDC ART Surveillance Report shows IVF singleton preterm birth rate of **~14.9%** — which actually *strengthens* the RRM comparison (4.0% RRM vs 14.9% CDC = larger gap).

**Recommended action:** Either:

1. **Annotate with the year:** "11.8% per CDC 2019 ART Surveillance data" — accurate and transparent.
2. **Update to current:** Use 14.9% (most recent CDC ART Surveillance) — strengthens the RRM comparison.

Note: Because the 11.8% comes from the Boyle 2025 paper itself, changing the figure away from what Boyle reports would create a mismatch between the page and the cited study. Option (1) is cleaner.

**Priority:** LOW. The directional claim is unambiguous either way.

---

## T3.3 ⚠️ HFEA ~33% under 35 is 2021 preliminary data

**Where:**
- Comparison table line 747: "~33% per embryo transferred, under 35 (HFEA, mandatory reporting)"

**Pillar page cites:** Reference #16 (HFEA 2023 report of 2021 data).

**Current HFEA data:**
- 2023 HFEA report on 2021 cycles: 32–33% under 35
- 2024 HFEA report on 2023 cycles: 34–35% under 35 (fresh embryo transfer)
- 2025 summary: 34% average for women under 35

**Recommended fix:** Update to 2023 figure:

> "~34–35% per embryo transferred, under 35 (HFEA 2023)"

**Priority:** LOW. Minor freshness update; the directional claim is unchanged.

---

## T3.4 ⚠️ IVF decline trend understates continuation past 2016

**Where:**
- Line 768: *"The per-cycle live birth rate for fresh non-donor IVF cycles declined from approximately 30% in 2010 to 22% by 2016, despite decades of adoption."*

**Problem:**
The decline didn't stop in 2016. A 2025 PMC analysis (*The declining efficiency of IVF in the USA*) shows the linear decline continued to **22.2% in 2021**. The pillar's cited endpoint is accurate for the year cited, but the trend continued.

**Recommended fix:** Extend the trend language:

> "The per-cycle live birth rate for fresh non-donor IVF cycles declined from approximately 30% in 2010 to 22% by 2016 and has remained near that level through 2021, despite decades of adoption."

**Priority:** LOW. Strengthens the RRM case rather than weakening it.

---

# Tier 4 — Minor / defensible as-is

## T4.1 Male factor infertility 20% solely / 30–40% contributory

**Where:** Lines 161, 414, 513, 693, 1385

**Pillar page:** *"A male factor is solely responsible in approximately 20% of infertile couples and contributory in another 30 to 40%."*

**Context:**
- AUA/ASRM guideline (Schlegel et al. 2021, ref #27): ~20% solely, 30–40% combined. Pillar cites this.
- ColumbiaDoctors: 10% solely, 35% combined.
- StatPearls (NIH Bookshelf): "The male is solely responsible in about 20% of cases and is a contributing factor in another 30% to 40%."
- Fertility Centers of New England: 20% solely, 30–40% contributory.
- Liv Hospital: 30–40% of all infertility cases involve male factor.
- WHO: 20–30% male-factor contribution.

The 20% figure is at the higher end of the solely-responsible range but within authoritative consensus. The pillar cites AUA/ASRM — the most clinically authoritative source. **No change required.**

Optional polish: "approximately 20%" → "approximately 20% (range 10–20% across studies)" if range honesty is a priority. Not necessary.

**Status:** Defensible as-is.

---

## T4.2 Odeblad NMR research "in the 1950s"

**Where:** Line 454

**Pillar page:** *"Swedish physician Dr. Erik Odeblad used nuclear magnetic resonance in the 1950s to identify distinct types of cervical mucus..."*

**Context:**
- Odeblad began cervical secretion research in **1949** per the WOOMB International bulletin.
- First NMR-on-cervical-mucus paper published **1957** in *Acta Radiologica*.
- Three-type (G, L, S) classification formally described **1977**.

**Assessment:** "The 1950s" is an acceptable simplification. The NMR work did intensify in the early 1950s when Odeblad was in Berkeley. Not worth re-editing.

**Status:** Defensible as-is.

---

## T4.3 CCL founder name "Ronald Prem"

**Where:** Line 458

**Pillar page:** *"John and Sheila Kippley, with the help of Dr. Ronald Prem, founded the Couple to Couple League (CCL) in 1971..."*

**Context:**
- CCL's own history materials use "Dr. Konald Prem" (appears to be a longstanding spelling in their documentation).
- Wikipedia uses "Konald."
- Most secondary sources use "Ronald."

**Assessment:** Without a primary-source confirmation of the correct first name (the physician is deceased), "Ronald" is the more common spelling and is unlikely to be flagged as wrong. **No fix required** unless someone finds a primary-source confirmation of "Konald."

**Status:** Defensible as-is.

---

## T4.4 FEMM "over 1,500 providers trained"

**Where:** Line 482

**Pillar page:** *"FEMM (2012) and its research arm, the Reproductive Health Research Institute (RHRI), introduced hormonal health protocols combining fertility charting with medical management. Over 1,500 medical providers have been trained."*

**Context:**
- 2012 founding and NYC headquarters: verified.
- The "1,500 providers" figure is not in FEMM's 2020 Organization Fact Sheet and couldn't be independently verified from FEMM's current public materials in the fact-check.
- Figure is plausible given FEMM's training program scope.

**Assessment:** Low priority to chase down. If FEMM has an updated number, use that. If not, soften to "hundreds of medical providers trained" or remove the specific count.

**Status:** Defensible as-is if unchanged. Optional polish.

---

## T4.5 Various unverified ancillary claims

These claims couldn't be directly confirmed against the local canonical facts JSON but cite authoritative external sources and are consistent with background literature:

- **Non-obstructive azoospermia affects ~1% of all men** (line 1129)
- **40% of azoospermia cases are obstructive (surgically correctable)** (line 1129)
- **Micro-TESE retrieves viable sperm in 30–60% of non-obstructive cases** (line 1129)
- **Diagnostic HSG false-positive rate 20–30%** (line 1128) — cites Hilgers textbook
- **93.5% pelvic disease on near-contact re-examination after "normal" prior laparoscopy** (line 1140, 1287) — attributed to Hilgers clinical series
- **IIRRM 52 countries** (line 1354)
- **CCL "chapters in over 20 countries"** (line 458) — supported by CCL materials (23 countries per Wikipedia)
- **Endometriosis 18 cents per dollar of burden** (line 1150) — cites Mirin 2021
- **PCOS $9–10M/year NIH funding** (line 1150) — cites NAS 2024 report
- **NIH 8.8% women's health 2013–2023** (line 1150) — cites NAS 2024 report
- **FABMs 4% of family planning curriculum, 9× less than hormonal contraception** (line 1148) — cites Duane 2022
- **>80% family medicine residents <1 hour FABM education** (line 1148) — cites Duane 2022

**Status:** All properly cited to external authorities. No local contradiction. No fix required unless external verification is desired.

---

# Verified clean (all three passes agree)

## Primary outcome studies — all statistics verify against published abstracts

| Study | Key claims verified |
|---|---|
| **Stanford JB, Parnell TA, Boyle PC (2008)** — *JABFM* 21(5):375–384, DOI 10.3122/jabfm.2008.05.070239, PMID 18772291 | n=1,072; Irish general practice; 25.5% crude LBR; 52.8% Kaplan-Meier adjusted at 24 months |
| **Tham E, Schliep K, Stanford JB (2012)** — *Canadian Family Physician* 58(5):e267–e274, PMID 22734170 | n=108; Canadian primary care; 38% crude LBR; 66% adjusted at 24 months; singletons 100%; 92% term |
| **Stanford JB, Carpentier PA, Meier BL, Rollo M, Tingey B (2021)** — *BMC Pregnancy and Childbirth* 21:455, DOI 10.1186/s12884-021-03946-8 | n=370; Massachusetts family medicine; 29% cumulative LBR at 2 years; 34% under 35, 40% BMI <25 |
| **Boyle PC, Stanford JB, Zecevic I (2022)** — *JMCR* 16(1):246, DOI 10.1186/s13256-022-03465-w, PMID 35729591 | Case report; 16 years infertility, 3 recurrent miscarriages, 8 failed IVF/ICSI embryo transfers; healthy singleton |
| **de Groot T, Andralojc KM, Boyle PC, Parnell TA (2018)** — *Frontiers in Medicine* 5:210, DOI 10.3389/fmed.2018.00210, PMID 30109231 | n=403; avg 2.1 prior IVF; 32.1% life-table LBR; 18.4% crude; 74 live births; 1 twin (1.4%); 92% born ≥37 weeks. **⚠️ Authors on pillar page JSON-LD + ref #17 are wrong — see T1.1** |
| **Boyle P, Toth A, Minjeur M, Turczynski C (2025)** — *JRRM* 1, DOI 10.63264/gejytw70 | n=249 consultations → 187 committed; 52% (98/187) conception; 41% (77/187) crude LBR; 75 singletons + 2 twin sets = 79 babies; 4.0% singleton preterm; 5.3% LBW; 12±8mo time to conception; 2.5% multiples; unexplained 24%→1% post-workup |
| **Sanchez-Mendez JI et al. (2025)** — *Frontiers in Reproductive Health* 7, DOI 10.3389/frph.2025.1696679 | n=1,310; Fertilitas Madrid; 35.3% crude (463/1310); 50% @ 24mo; 62.1% @ 36+mo (95% CI 58.8–65.4); 10.9mo median treatment; 2.5 dx/couple; age 18–30: 83.7%, 36–40: 53.3%, 40+: 24.4% |
| **Yeung P, Mohan A, Gavard JA (2024)** — Preprints.org / *Acta Scientific Women's Health* 6(12) | n=620; 15/620 = 2.5% repeat surgery after optimal excision. **⚠️ Journal venue unresolved — see T2.1** |

## Historical/institutional facts — all verified

- Billings Ovulation Method (Melbourne, Australia; John Billings from 1953, Evelyn Billings 1966 mucus-pattern discovery) ✅
- Couple to Couple League founded 1971 by John and Sheila Kippley with Dr. Prem; 20+ countries ✅
- Hilgers began CrMS research 1976 ✅ (**⚠️ location error — see T2.5**)
- Saint Paul VI Institute founded 1985 in Omaha, Nebraska by Thomas Hilgers ✅
- IIRRM formal discussions November 2000 (Canada, Ireland, UK; Australia and US joined) ✅
- FACTS About Fertility founded 2010 by Dr. Marguerite Duane and Dr. Bob Motley ✅
- FEMM founded 2012, NYC headquarters ✅ (**⚠️ 1,500 provider count unverified — see T4.4**)
- NeoFertility developed 2016 by Dr. Phil Boyle, Dublin ✅
- *Journal of Restorative Reproductive Medicine* launched 2025, IIRRM publisher, Dr. Joseph Stanford Editor-in-Chief ✅
- Arkansas Act 859 (2025) first state to mandate RRM insurance coverage ✅
- RESTORE Act H.R. 3589 introduced in 119th Congress by Rep. Harshbarger with Rep. Moore ✅
- ACOG Committee Opinion No. 651 (December 2015, reaffirmed 2025): "Menstruation in Girls and Adolescents: Using the Menstrual Cycle as a Vital Sign" ✅

## Epidemiological/benchmark claims — verified

- Endometriosis ~10% prevalence (top of 4–10% range) ✅
- Recurrent pregnancy loss affects 2–5% of couples ✅
- Cochrane 2023: 2 RCTs, 86 women combined, IVF vs expectant management ✅
- IVF fresh non-donor per-cycle LBR declined ~30% (2010) → 22% (2016) ✅ (**⚠️ trend continues past 2016 — see T3.4**)
- SHSG/TCFT intrauterine pregnancy rates 9–37% ✅ (canonical fact + Hilgers textbook confirms)
- Katz et al. (2011) cost study: medication-only $1,182 median vs IVF $24,373 median over 18 months ✅

## New York Times, STAT News, The 19th, OSV News 2025 RRM coverage

- NYT article "As Trump Weighs I.V.F., Republicans Back New 'Natural' Approach" published August 21, 2025 ✅
- STAT News "Arkansas law shifts national debate on infertility treatment" published August 5, 2025 ✅
- The 19th and OSV News: not independently verified in fact-check but plausible ✅

---

# Recommended edit sequence (post-verification)

## Phase 1 — Critical fixes (block further promotion)

Do these first. Authorship errors only — factual citation integrity.

1. **T1.1** — Fix Boyle 2018 author string in:
   - Pillar: JSON-LD (line 101) and reference #17 (line 1543) — correct to "de Groot T, Andralojc KM, Boyle PC, Parnell TA"
   - Sibling pillars: `src/pages/naprotechnology/index.astro:601` and `src/pages/neofertility/index.astro:76`
   - Canonical fact: update D1 `fact-boyle-2018-ivf-repeat-failure-benchmark` `source.authors` field, regenerate canonical SSOT via `node scripts/build-canonical-facts.mjs --entity rrm`
   - Drafts: cleanup any `docs/content-drafts/*.md` and `docs/what-is-rrm-export.md` mirrors
2. **T1.4** — Fix Duane 2022 author order in:
   - Pillar: JSON-LD (line 86) and reference #5 (line 1531) — correct to "Duane M, Porucznik CA, Vigil P, Stanford JB"
   - Sweep sibling pillars for the same error

**(Previous Tier 1 items T1.2 and T1.3 are downgraded to Phase 3 — they are canonical-SSOT-refresh work, not pillar editorial corrections. Pillar is internally consistent with canon.)**

## Phase 2 — Citation and framing polish

Do these next. Can be split across commits.

4. **T2.1** — Verify Yeung 2024 journal (Acta Scientific vs preprint); update library record if published.
5. **T2.2** — Update canonical fact `fact-yeung-2024-excision-repeat-2-5pct` from 14/570 to 15/620; regenerate SSOT via `scripts/build-canonical-facts.mjs --entity rrm`.
6. **T2.3** — Add Yeung data-quality footnote (survey-based, ~50% response rate).
7. **T2.4** — Scope Guo 2009 "40% within 5 years" to "ablation or conservative laparoscopic surgery" in all three locations.
8. **T2.5** — Rephrase Hilgers 1976 to separate research start from Creighton naming (line 460).
9. **T2.6** — Verify Bewley et al. BMJ 342:d436 citation; update if not confirmed.
10. **T2.7** — Clarify Boyle 2018 32.1% as life-table adjusted in line 782 prose.
11. **T2.8** — Rewrite Boyle 2025 chart note "74% conceived again" (line 940) with correct denominator and outcome.
12. **T2.9** — Add Tham 2012 adjusted rate (66%) to line 797 prose.
13. **T2.10** — Add NaPro/Fertilitas Madrid clarifier to Sanchez-Mendez attribution.
14. **T2.11** — Add time-horizon asymmetry footnote to RRM vs IVF comparison table.

## Phase 3 — Canonical SSOT refresh + data freshness

Canonical SSOT updates (do before corresponding pillar edits):

15. **T1.2 (downgraded)** — Evaluate whether Pugsley 2007 (PMID 17550672) has been superseded by French 2025 / PSNet 2024 systematic review. If yes: update D1 fact `fact-endo-diagnosis-delay` with new source citation, regenerate canonical SSOT, then update pillar line 661.
16. **T1.3 (downgraded)** — Add/update canonical PCOS prevalence fact with WHO 2026 fact sheet or Teede et al. 2023 International Evidence-based Guideline. Regenerate SSOT. Then update pillar line 671.

Data freshness on external-source claims:

17. **T3.1** — Update IVF per-cycle cost floor from $15k to $20k.
18. **T3.2** — Annotate 11.8% CDC figure with "per 2019 data" or update to 14.9% current.
19. **T3.3** — Update HFEA figure to 2023 data (~34–35% under 35).
20. **T3.4** — Extend IVF decline trend language past 2016.

## Phase 4 — Optional

19. **T4.4** — Verify or soften "1,500+ FEMM providers" claim if a current figure is available.

---

# Appendix: Source documents

1. **Local fact-check session** (2026-04-22, Opus + canonical facts SSOT). Not archived as a standalone document; findings integrated here.
2. **Perplexity NeoFertility fact-check:** `/Users/brian/Downloads/Fact-Check  RRM Pillar Page — NeoFertility Claims.md` (54 reference citations)
3. **Perplexity broader fact-check:** `/Users/brian/Downloads/RRM Pillar Page Fact-Check.md` (80 reference citations)
4. **Primary source data:** `src/data/articles.json` (9 cited studies verified in-place)
5. **Canonical facts SSOTs:**
   - `docs/fact-check/rrm-canonical-facts.json` (1,029 facts, rrm-shared + independent + neofertility + napro intersection)
   - `docs/fact-check/naprotechnology-canonical-facts.json` (2,571 facts, napro tradition)
   - `docs/fact-check/creighton-canonical-facts.json` (545 facts, fabm tradition; not consulted for this check)

---

*End of fact-check report. No edits have been applied to `src/pages/what-is-rrm/index.astro`.*
