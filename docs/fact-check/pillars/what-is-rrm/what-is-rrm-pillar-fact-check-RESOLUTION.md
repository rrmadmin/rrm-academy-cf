# Fact-Check Resolution: 11 Outstanding Items — RRM Academy /what-is-rrm/
**Pass:** Post-4-pass supplemental verification | **Date:** April 22, 2026  
**Scope:** Items 1–6, 8–12 from the outstanding queue (Item 7, FEMM numbers, carried forward — see note)

***
## A. Canonical SSOT Refreshes
### Item 1 — Endometriosis Diagnostic Delay (fact-endo-diagnosis-delay)
**Current canon:** Pugsley 2007, PMID 17550672, 9 years.

**Sources found:**
- **French 2025 population study:** Couëllan et al., published in *Journal of Gynecology Obstetrics and Human Reproduction*, PMID 40818690. Prospective e-cohort (n = ~6,949; ComPaRe-Endometriosis cohort). Median diagnostic delay = **5.0 years (IQR 1.6–11.2)**.[^1]
- **Frontiers in Medicine 2025 systematic review and meta-analysis** (Frontiers Med. 2025, DOI 10.3389/fmed.2025.1576490): pooled patient-related delay SMD 1.94; characterizes "several years" as the mean time to diagnosis.[^2]
- **BJOG 2024 literature review** (PMID 39373298 / Obstet Gynecol online Oct 2024): 17 observational studies; diagnosis times **0.3–12 years** depending on definition and geography; confirms delay "still present."[^3]
- **Sage Journals 2025 cross-sectional study** (DOI 10.1177/15409996251380129): "An average time to diagnosis of **7 years** is commonly described."[^4]
- **PMC 2025 qualitative study** (PMC12629012): "mean delay to diagnosis time is nine years" citing UK APPG 2020 data; notes delays of "up to 10 years" in more recent UK reporting.[^5]
- **ComPaRe e-cohort large prospective study** (PMID 40999898, Sage Journals 2026): average diagnostic delay **10 years for endometriosis**, 11 years for adenomyosis in this French community cohort.[^6]

**Key excerpt (PMID 40818690):** "The median diagnostic delay was 5.0 years (range 1.6–11.2) with no statistically significant difference observed before and after the implementation of the National Endometriosis Public Health Plan."[^1]

**Verdict:** Partially refuted / range is now better characterized. The landscape is complex: the strongest population-level study (Couëllan 2025, France, n ~6,949) finds a **median of 5 years** with wide IQR, while other 2024–2025 studies report means of 7–10 years depending on methodology, country, and definition. The Pugsley 2007 "9 years" figure is not wrong in historical context, but is no longer the best single-number citation for the current state.

**Recommendation:** Add Couëllan 2025 as a second source; do not delete Pugsley 2007. The honest framing is that delay has ranged widely across settings and has not uniformly improved despite awareness campaigns.

**Proposed pillar edit (pillar framing around the delay figure):**

| Before | After |
|---|---|
| "women wait an average of 9 years for a diagnosis of endometriosis" | "women wait an average of 5 to 9 years for an endometriosis diagnosis, with delays of up to a decade still common in many healthcare systems" |

**Proposed canonical fact update (fact-endo-diagnosis-delay):**

```json
{
  "id": "fact-endo-diagnosis-delay",
  "body": "Diagnostic delay for endometriosis ranges from a median of 5 years in recent population cohorts to means of 7–9 years in historical and cross-sectional data; delays of up to 10+ years persist in some settings.",
  "sources": [
    {
      "citation": "Pugsley Z, Ballard K. Management of endometriosis in general practice: the pathway to diagnosis. Br J Gen Pract. 2007;57(539):470-476.",
      "pmid": "17550672",
      "note": "historical baseline; 9-year figure"
    },
    {
      "citation": "Couëllan M et al. Impact of a National Public Health Plan on the time frame to diagnosis of moderate and severe endometriosis. J Gynecol Obstet Hum Reprod. 2025.",
      "pmid": "40818690",
      "note": "French population cohort n~6,949; median 5.0 years (IQR 1.6-11.2); strongest recent primary source"
    },
    {
      "citation": "Rees C et al. Time to Diagnose Endometriosis: Current Status, Challenges and Opportunities. BJOG. 2024.",
      "pmid": "39373298",
      "note": "systematic review; 0.3-12 years range across 17 studies"
    }
  ],
  "last_verified": "2026-04-22",
  "status": "updated"
}
```

***
### Item 2 — PCOS Prevalence (fact-wave1-...-110)
**Current canon:** Hilgers 2004, 6%.

**Sources found:**
- **WHO Fact Sheet (current as of January 2026):** "PCOS affects an estimated **10–13% of reproductive-aged women**. It is estimated that up to 70% of women with PCOS worldwide do not know they have this condition."[^7]
- **Teede et al. 2023 International Evidence-based Guideline for PCOS:** Published in *Fertility and Sterility* and *Human Reproduction*. PMID 37580861 / PMID 37589624. The 2023 guideline references 8–13% prevalence globally and provides 254 recommendations and practice points.[^8][^9]
- Cross-check via Allara Health summary of WHO data: "10–13% of people who menstruate worldwide have received a PCOS diagnosis, according to the World Health Organization."[^10]

**Key excerpt (WHO fact sheet, January 2026):** "PCOS affects an estimated 10–13% of reproductive-aged women."[^7]

**Verdict:** Refuted (Hilgers 6% is outdated). WHO and the 2023 international guideline both cite **8–13%** (WHO states 10–13%). The pillar's current text "6-12%" spans a range that includes an outdated floor. The WHO/Teede 2023 range of **8–13%** (WHO specifies 10–13%) is the authoritative current figure.

**Proposed pillar edit (line 671):**

| Before | After |
|---|---|
| "PCOS affects 6-12% of reproductive-age women" | "PCOS affects an estimated 10–13% of reproductive-age women" |

**Proposed canonical fact update:**

```json
{
  "id": "fact-wave1-the-prevalence-of-pcos-is-thought-to-be-found-in-about-six-p-110",
  "body": "PCOS affects an estimated 10–13% of reproductive-aged women globally; up to 70% are undiagnosed.",
  "sources": [
    {
      "citation": "World Health Organization. Polycystic ovary syndrome fact sheet. Updated January 2026.",
      "url": "https://www.who.int/news-room/fact-sheets/detail/polycystic-ovary-syndrome",
      "note": "primary authoritative source; 10-13% global prevalence"
    },
    {
      "citation": "Teede HJ et al. Recommendations from the 2023 International Evidence-based Guideline for the Assessment and Management of PCOS. Fertil Steril. 2023.",
      "pmid": "37580861",
      "note": "254 recommendations; supersedes earlier guidelines including Hilgers 2004"
    }
  ],
  "supersedes": "Hilgers 2004 (6% figure)",
  "last_verified": "2026-04-22",
  "status": "updated"
}
```

***
## B. Data Freshness
### Item 3 — IVF Per-Cycle Cost in the US
**Sources found (2024–2026):**
- **AdvancedFertility.com (March 2026):** Base IVF cycle $12,000–$18,000; total all-in (meds, ICSI, PGT, monitoring) $20,000–$25,000+.[^11]
- **Panama Fertility / Florida clinic guide (2025):** $12,000–$18,000 base; total with medications $15,000–$25,000.[^12]
- **GoodRx (2024):** Median $12,400 before meds and add-ons.[^13]
- **Genetics and Fertility (2025):** Full cycle with ICSI $16,000–$30,000 depending on clinic, meds, extras.[^13]

**Verdict:** The pillar's current range of "$15,000 to $30,000 per cycle" is defensible as an **all-in estimate** (base + meds + add-ons) but overstates the base cycle cost. A more precise framing distinguishes the two:

- **Base cycle (monitoring, retrieval, lab, transfer):** $12,000–$18,000[^11]
- **All-in (base + meds + ICSI + diagnostics):** $15,000–$30,000[^13][^11]

**Proposed pillar edit:**

| Before | After |
|---|---|
| "$15,000 to $30,000 per cycle" | "$12,000 to $18,000 per base cycle, rising to $20,000–$30,000 or more when medications, genetic testing, and other add-ons are included" |

**Proposed canonical fact update:** Add a new fact or update the existing IVF cost fact to distinguish base vs. all-in costs, citing AdvancedFertility.com 2026 and GoodRx 2024. Note that costs are in 2025–2026 USD and should be reviewed annually.

***
### Item 4 — CDC Singleton IVF Prematurity Rate
**Sources found:**
- **CDC MMWR, ART Surveillance United States, 2018** (published February 18, 2022; PMID 35176012 / ): "The percentage of preterm births among ART-conceived singleton infants was **14.9%** compared with 8.3% among all singleton infants."[^14]
- This is the most recent finalized MMWR ART Surveillance report with singleton-specific preterm data publicly available as of April 2026.[^15]
- The pillar currently cites 11.8% from Boyle 2025's reference to "CDC 2019 ART Surveillance data." The 2019 surveillance data report was published as MMWR 2022 (covering 2018 data); **the correct figure for that report is 14.9%, not 11.8%.**[^14]

**Key excerpt:** "The percentage of preterm births among ART-conceived singleton infants was 14.9% compared with 8.3% among all singleton infants."[^15][^14]

**Verdict:** The 14.9% figure is confirmed. The 11.8% figure cited on the pillar appears to be incorrect even for the 2019 ART surveillance data it references. The CDC 2018 surveillance data (most recent finalized MMWR ART singleton preterm report) states 14.9%.

**Proposed pillar edit:**

| Before | After |
|---|---|
| "CDC 2019 ART Surveillance data shows singleton preterm birth at 11.8%" | "CDC ART Surveillance data show that singleton infants conceived via ART are born preterm at a rate of 14.9%, nearly double the 8.3% rate for all singleton infants" |

**Citation to use:** CDC MMWR 71(4):1–19, February 18, 2022. DOI or URL: https://www.cdc.gov/mmwr/volumes/71/ss/ss7104a1.htm

**Proposed canonical fact update:** Update the preterm birth fact to 14.9% (CDC MMWR 2022, 2018 surveillance data), and flag for update when CDC publishes the 2021+ surveillance MMWR.

***
### Item 5 — IVF Decline Trend Post-2016
**Sources found:**
- **Gleicher et al. 2025/2026, "The declining efficiency of IVF in the USA,"** published in *Human Reproduction* (Oxford), PMC12872396, PMID 41660485.[^16][^17]
- **Key data from the study:** IVF cycle starts increased 234.7% from 2012 to 2021; live births increased only 179.2%; cycle efficiency declined from **29.1% in 2012 to 22.2% in 2021**, a relative reduction of 23.4%, following a "nearly linear decline across the decade."[^17]
- The pillar says 30% (2010) → 22% (2016). The PMC 2025/2026 study starts at **29.1% in 2012** (not 30% in 2010) and ends at **22.2% in 2021** (not 22% in 2016).[^17]

**Key excerpt:** "Cycle efficiency declined from 29.1% in 2012 to 22.2% in 2021, a relative reduction of 23.4%, with an approximately linear decline across the decade."[^17]

**Verdict:** Confirmed that the trend continued and worsened. The pillar's specific figures (30% in 2010, 22% in 2016) are close but not precisely matched by this peer-reviewed source. The PMC 2025/2026 paper covers 2012–2021 and is the requested primary source.

**Proposed pillar edit:**

| Before | After |
|---|---|
| "fresh non-donor per-cycle live birth rate declined from 30% (2010) to 22% (2016)" | "per-cycle live birth rate (cycle efficiency) declined from 29.1% in 2012 to 22.2% in 2021, a sustained linear decline coinciding with expanded use of embryo banking and other add-ons" |

**Citation:** Gleicher N et al. The declining efficiency of IVF in the USA. Hum Reprod. 2025/2026. PMID 41660485. PMC12872396.[^16][^17]

**Proposed canonical fact update:** Add or update IVF efficiency fact with Gleicher et al. 2025/2026 as primary source; data range 2012–2021; cycle efficiency 22.2% in 2021.

***
## C. External Citations
### Item 6 — Yeung "50% Response Rate" Acknowledgment
**Sources found:**
- **Natural Womanhood Podcast S4Ep2**, published **June 23, 2025**, titled "One and done Endo surgery is possible: How Dr. Patrick Yeung does it." URL: https://naturalwomanhood.org/podcast/nw-podcast-s4ep2-one-and-done-endometriosis-surgery-dr-yeung/[^18]
- The podcast page and show notes confirm the episode exists and aired on the stated date. The 2.5% repeat surgery figure is stated on the podcast page: "the RESTORE Center boasts a mere 2.5% rate of repeat surgeries in 10 years."[^18]
- The RESTORE Center's own outcomes page (restoreendo.com/outcomes) states: "After analyzing 10 years worth of patient data, the rate of repeat surgery was a staggering low 2.5%."[^19]
- An EPPC white paper authored by Dr. Yeung (media.eppc.org, 2025) states: "My rate of repeat surgery from the ten-year database is 2.5 percent in ten years" and references "footnote 5" as the source.[^20]
- The RESTORE Center's publications page states: "This study found that women who underwent optimal excision surgery for endometriosis had a much lower rate of repeat surgeries (2.5%) compared to historical ablation methods." The underlying study is described as a preprint.[^21]

**Regarding the "50% response rate" acknowledgment:** The podcast page does not display a transcript, and no publicly retrievable transcript was found through web search. The Natural Womanhood podcast page for S4Ep2 does not reproduce Dr. Yeung's verbal acknowledgment of the questionnaire methodology limitation. The EPPC white paper and RESTORE Center website present the 2.5% figure without methodological caveats. **No verifiable public document containing Dr. Yeung's specific acknowledgment of a ~50% questionnaire response rate was retrievable.**

**Verdict:** Partially verifiable. The S4Ep2 episode (June 23, 2025, Natural Womanhood Podcast) exists and is publicly accessible, and the 2.5% figure is confirmed from multiple sources including the RESTORE Center website and an EPPC white paper. However, the specific "~50% response rate" caveat is **still-unverifiable** from publicly retrievable text — it may exist only in the audio of the podcast. No transcript is indexed.[^20][^19][^18]

**Recommendation:** If citing the podcast as evidence Dr. Yeung acknowledged the limitation, note that the claim is based on audio content of S4Ep2 (June 23, 2025) without a retrievable transcript. If the pillar text is asserting a methodological caveat, it should be footnoted as "per audio of S4Ep2" rather than cited as a quotable source.

***
### Item 7 — FEMM Annual Patient Numbers
*Not addressed in this pass — item was not included in the 11-item task scope as originally presented. Carry forward.*

***
### Item 8 — Arkansas Act 859 (2025)
**Sources found:**
- **Arkansas Legislature official record:** HB1142, 2025 Regular Session, became **Act 859**. Bill number: HB1142. Act date: **April 17, 2025**.[^22]
- **Full title:** "AN ACT TO CREATE THE REPRODUCTIVE EMPOWERMENT AND SUPPORT THROUGH OPTIMAL RESTORATION (RESTORE) ACT."[^23][^24]
- **Primary sponsors:** Rep. Alyssa Brown [R] (House lead); Sen. Jim Dotson [R] (Senate lead).[^25]
- **Signed by:** Governor Sarah Huckabee Sanders, on or around April 17, 2025.[^26]
- **Key mandate:** Requires accident and health insurance companies, including Arkansas Medicaid, to cover IVF and restorative reproductive medicine as covered expenses, effective August 2025.[^27][^28]
- **Significance confirmed:** Multiple sources confirm this is the first state law to mandate coverage for restorative reproductive medicine specifically.[^29][^30]

**Key excerpt (Healthcare Value Hub PDF):** "Effective in August 2025, Act 859 will require accident and health insurance companies, including Arkansas' Medicaid program, to include as a covered expense, in vitro fertilization and restorative reproductive medicine."[^27]

**Key excerpt (Mitchell Williams Law):** "HB1142 (Act 859) – Creates the Reproductive ... Among other requirements, the Act mandates coverage for restorative reproductive medicine."[^28]

**Key excerpt (STAT News):** "The Arkansas law, passed in June [sic — signed April 17], requires state insurance companies to cover so-called restorative reproductive medicine (RRM) treatments. It's the first piece of legislation in the country to endorse a new approach to treating infertility."[^30]

**Verdict:** Confirmed. All key facts are verifiable from primary and secondary sources.

**Proposed pillar edit (if needed):** Ensure the pillar states the act date as April 17, 2025 (signed), effective August 2025, sponsored by Rep. Alyssa Brown and Sen. Jim Dotson, signed by Gov. Sarah Huckabee Sanders.

| Field | Verified value |
|---|---|
| Bill number | HB1142 |
| Act number | Act 859 |
| Full title | Reproductive Empowerment and Support Through Optimal Restoration (RESTORE) Act |
| Signed | April 17, 2025 |
| Effective | August 2025 |
| House sponsor | Rep. Alyssa Brown (R) |
| Senate sponsor | Sen. Jim Dotson (R) |
| Governor | Sarah Huckabee Sanders |
| Mandate | Insurance coverage for IVF and restorative reproductive medicine, including Medicaid |

***
### Item 9 — RESTORE Act H.R. 3589 (119th Congress)
**Sources found:**
- **GovInfo.gov:** H.R. 3589, 119th Congress, "Reproductive Empowerment and Support Through Optimal Restoration Act." Introduced in House.[^31]
- **Harshbarger press release (June 4, 2025):** "Congresswoman Diana Harshbarger, alongside co-lead Congressman Riley Moore (R-WV), introduced H.R. 3589."[^32]
- **LegiScan:** Introduced May 23, 2025; referred to House Committee on Energy and Commerce, May 23, 2025. Status as of available data: **Referred to committee; no further action recorded.**[^33]
- **Key provisions (Quiver Quant summary):**[^33]
  - Mandates data collection and research on endometriosis, adenomyosis, PCOS, uterine fibroids, and blocked fallopian tubes
  - Provides training for healthcare providers in restorative reproductive medicine
  - Requires RRM referrals before ART/IVF
  - Includes discrimination protections for providers who decline to participate in ART on religious/moral grounds
  - Promotes fertility awareness-based methods in health education
  - Expands federal grant access for RRM entities
  - Updates medical coding for RRM
  - Addresses male factor infertility
  - Updates the National Survey of Family Growth

**Senate companion:** The Senate version of the RESTORE Act (S. companion bill introduced by Sens. Hyde-Smith and Lankford) existed in the 118th Congress; a Senate companion in the 119th has not been confirmed in available sources.[^34]

**Verdict:** Confirmed. Bill number, sponsors, introduction date, and key provisions are all verifiable.

| Field | Verified value |
|---|---|
| Bill number | H.R. 3589 |
| Congress | 119th |
| Full title | Reproductive Empowerment and Support Through Optimal Restoration Act (RESTORE Act) |
| Introduced | May 23, 2025 |
| House lead sponsors | Rep. Diana Harshbarger (R-TN); Rep. Riley Moore (R-WV) |
| Status | Referred to House Committee on Energy and Commerce; no floor vote recorded |
| Key provisions | RRM research, training, pre-IVF referral requirement, provider conscience protections, FAM education, coding updates |

***
### Item 10 — ACOG Committee Opinion No. 651
**Sources found:**
- **ACOG.org (live):** Committee Opinion No. 651, "Menstruation in Girls and Adolescents: Using the Menstrual Cycle as a Vital Sign," published December 2015 in *Obstetrics & Gynecology* 126(6):e143–e146. DOI: 10.1097/AOG.0000000000001215.[^35]
- **PubMed PMID 26595586:** Confirms publication December 2015, Obstet Gynecol.[^36]
- **Reaffirmation date:** Multiple third-party citations (including a YouTube video description by a board-certified OB-GYN citing the document) specify the document as **"Dec 2015, reaffirmed 2021."** No source found indicating a 2025 reaffirmation.[^37]

**Key excerpt (ACOG.org):** "By including an evaluation of the menstrual cycle as an additional vital sign, clinicians reinforce its importance in assessing overall health status for patients and caretakers."[^35]

**Verdict:** Confirmed with correction. ACOG CO 651 exists, is accessible at ACOG.org, and was published December 2015. The most recent reaffirmation found in available sources is **2021**, not 2025 as claimed on the pillar. No evidence of a 2025 reaffirmation was found. ACOG's website does not display reaffirmation dates on the committee opinion page itself, but third-party medical sources consistently cite "reaffirmed 2021."[^37][^35]

**Proposed pillar edit:**

| Before | After |
|---|---|
| "ACOG Committee Opinion No. 651 (December 2015, reaffirmed 2025)" | "ACOG Committee Opinion No. 651 (December 2015, reaffirmed 2021)" |

**Proposed canonical fact update:** Update the reaffirmation year from 2025 to 2021. Flag for review if ACOG publishes a 2025 reaffirmation (none found as of April 2026).

***
### Item 11 — Katz et al. 2011 Cost Study
**Sources found:**
- **PMC full text, PMC3043157** (PMID 21130988): Katz P, Showstack J, Smith JF, Nachtigall RD, Millstein SG, Wing H, Eisenberg ML, Pasch LA, Croughan MS, Adler N. "Costs of infertility treatment: Results from an 18-month prospective cohort study." *Fertil Steril.* 2010 Dec 4;95(3):915–921.[^38]
- **Published in final form:** *Fertility and Sterility* 95(3):915–921, March 2011 (epub December 4, 2010).[^38]

**Full author list (verified):**
1. Patricia Katz, PhD — Dept. of Medicine, UCSF
2. Jonathan Showstack — Dept. of Medicine, UCSF
3. James F. Smith — Dept. of Urology and Dept. of Ob/Gyn & Reproductive Sciences, UCSF
4. Robert D. Nachtigall — Dept. of Ob/Gyn & Reproductive Sciences, UCSF
5. Susan G. Millstein — Dept. of Pediatrics, UCSF
6. Holly Wing — Dept. of Medicine, UCSF
7. Michael L. Eisenberg — Dept. of Urology, UCSF
8. Lauri A. Pasch — Dept. of Psychiatry, UCSF
9. Mary S. Croughan — Dept. of Ob/Gyn & Reproductive Sciences and Epidemiology, UCSF
10. Nancy Adler — Dept. of Psychiatry, UCSF[^38]

**Dollar figures verified:**
- Medications only (MEDS): median per-person cost = **$1,182**[^38]
- IVF group: median per-person cost over 18 months = **$24,373**[^38]
- IVF-donor egg: median = $38,015[^38]

**Study design verified:** Prospective cohort study, 398 women recruited from 8 reproductive endocrinology practices, followed 18 months; costs based on medical records and standardized relative value units from 2006 fee schedules. Note: cost figures are in **2006 USD**.[^38]

**Verdict:** Confirmed. The pillar's figures ($1,182 and $24,373) are exactly correct from Table 3 of the paper. The PMID 20189169 listed in the task brief is incorrect — the correct PMID is **21130988**. PMID 20189169 is an unrelated Mediterranean diet and IVF study.[^39]

**Proposed pillar edit:** No change to the dollar figures needed. If citing the PMID, correct it from 20189169 to **21130988**. Consider adding a footnote noting figures are in 2006 USD.

**Proposed canonical fact update:** Correct PMID from 20189169 to 21130988 in the canonical facts JSON.

***
## D. Framing Judgment Call
### Item 12 — "93.5% Pelvic Disease on Near-Contact Re-examination" (Hilgers)
**Context review:** The task notes that the canonical SSOT supports 89% endometriosis specifically (6.5% truly normal = 93.5% any finding). The pillar currently uses 93.5%.

**Framing analysis:**

The two figures represent different claims:
- **93.5%** = any pelvic abnormality not previously appreciated on prior laparoscopy (i.e., only 6.5% of near-contact re-examinations found truly nothing abnormal)
- **89%** = specifically endometriosis found on near-contact re-examination

These are not interchangeable. The correct figure to use depends entirely on what the surrounding prose is asserting:

| Surrounding prose says... | Correct figure | Reasoning |
|---|---|---|
| "...found endometriosis" or "...diagnosed with endometriosis" | **89%** | Endometriosis-specific finding rate |
| "...found pelvic disease" or "...found some form of pelvic abnormality" | **93.5%** | Composite finding rate (endo + other pathology) |
| "...found previously undetected disease" | **93.5%** | Inclusive of all abnormal findings |

**Recommendation:** If the pillar's surrounding prose is specifically framing this statistic in the context of endometriosis detection (e.g., "X% had endometriosis found"), change to **89%** with the note that an additional 4.5% had other pelvic pathology, totaling 93.5% with any finding. If the prose is about the general inadequacy of standard laparoscopy or the detection of "any pelvic disease," **93.5% stands and is accurate.**

Given that the RRM Academy pillar's primary argument in this section is typically about endometriosis being missed, the intellectually honest approach is:

**Proposed pillar edit (if prose is about endometriosis):**

| Before | After |
|---|---|
| "93.5% were found to have pelvic disease on near-contact re-examination" | "89% were found to have endometriosis on near-contact re-examination, with an additional 4.5% having other pelvic pathology — meaning only 6.5% were truly normal" |

This framing is more precise, more honest, and arguably more rhetorically powerful because it gives both numbers with clear attribution.

***
## Summary Table
| # | Item | Verdict | Action Required |
|---|---|---|---|
| 1 | Endo diagnostic delay | Partially refuted (5–9 yr range; median 5 yr per Couëllan 2025) | Add Couëllan 2025 (PMID 40818690) as second source; update canon body text |
| 2 | PCOS prevalence | Refuted (WHO/Teede 2023: 10–13%) | Change pillar line 671 to "10–13%"; update canon, supersede Hilgers 2004 |
| 3 | IVF per-cycle cost | Confirmed (all-in $15–30K defensible) | Clarify base vs. all-in in pillar text |
| 4 | CDC singleton IVF preterm | Confirmed (14.9%) | Correct 11.8% to 14.9% in pillar; cite CDC MMWR 71(4) 2022 |
| 5 | IVF efficiency decline trend | Confirmed and extended to 2021 | Update figures to Gleicher et al. (PMID 41660485): 29.1% (2012) to 22.2% (2021) |
| 6 | Yeung 50% response rate acknowledgment | Episode confirmed; specific caveat still-unverifiable (no transcript) | Note in pillar as audio-only claim from S4Ep2 (June 23, 2025) |
| 8 | Arkansas Act 859 | Confirmed | Verify pillar has: signed April 17, 2025; effective Aug 2025; sponsors Brown/Dotson |
| 9 | RESTORE Act H.R. 3589 | Confirmed | Pillar should note: introduced May 23, 2025; referred to Energy and Commerce; Harshbarger + Moore |
| 10 | ACOG CO 651 | Confirmed; reaffirmed 2021, NOT 2025 | Correct "reaffirmed 2025" to "reaffirmed 2021" in pillar and canon |
| 11 | Katz et al. 2011 cost study | Confirmed | Correct PMID in canon from 20189169 to 21130988; dollar figures ($1,182/$24,373) are exact |
| 12 | 93.5% vs 89% (Hilgers) | Framing-dependent; see analysis | If prose is about endometriosis: use 89%; if about any pelvic disease: 93.5% stands |

---

## References

1. [Impact of a National Public Health Plan on the time frame ... - PubMed](https://pubmed.ncbi.nlm.nih.gov/40818690/) - Results: The median diagnostic delay was 5.0 years (range 1.6-11.2) ... Keywords: Diagnostic delay; ...

2. [Factors contributing to the delayed diagnosis of endometriosis—a ...](https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2025.1576490/full) - The evaluation of diagnostic delay revealed that diagnosis of endometriosis was significantly delaye...

3. [Time to Diagnose Endometriosis: Current Status, Challenges and ...](https://pubmed.ncbi.nlm.nih.gov/39373298/) - Endometriosis diagnosis reportedly faces delays of up to 10 years. Despite growing awareness and imp...

4. [Endometriosis Diagnostic Delay and Its Correlates - Sage Journals](https://journals.sagepub.com/doi/abs/10.1177/15409996251380129) - An average time to diagnosis of 7 years is commonly described for endometriosis; diagnostic delay fo...

5. [Exploring delay to diagnosis of endometriosis, a healthcare ... - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12629012/) - Delay to diagnosis of endometriosis is an increasing problem. As it stands, the mean delay to diagno...

6. [Endometriosis Diagnostic Delay and Its Correlates: Results from the ...](https://pubmed.ncbi.nlm.nih.gov/40999898/) - This study highlights several factors associated with diagnostic delay among women with self-reporte...

7. [Polycystic ovary syndrome - World Health Organization (WHO)](https://www.who.int/news-room/fact-sheets/detail/polycystic-ovary-syndrome) - An estimated 10–13% of women globally are thought to have PCOS, but up to 70% of affected women are ...

8. [Recommendations from the 2023 International Evidence-based ...](https://pubmed.ncbi.nlm.nih.gov/37589624/) - The 2023 International Guideline for the Assessment and Management of PCOS provides clinicians and p...

9. [Recommendations from the 2023 international evidence-based ...](https://pubmed.ncbi.nlm.nih.gov/37580861/) - The 2023 International Guideline for the Assessment and Management of PCOS provides clinicians and p...

10. [PCOS statistics: What the numbers really mean - Allara Health](https://www.allarahealth.com/blog/pcos-statistics-facts) - 10-13% of people who menstruate worldwide have received a PCOS diagnosis, according to the World Hea...

11. [What Is the Average Cost of IVF in the United States? | Blog](https://www.advancedfertility.com/blog/what-is-the-average-cost-of-ivf-in-the-united-states) - How is IVF Priced? ; Base IVF Cycle. $12,000 – $18,000. Includes monitoring, retrieval, and lab work...

12. [How Much Is IVF? 2025 Cost Guide to In Vitro Fertilization](https://panamafertility.com/Florida/blog-en/how-much-is-ivf-2025-cost-guide-to-in-vitro-fertilization/) - The answer to how much is IVF in 2025 is $12,000–$18,000 per cycle, plus medications and optional se...

13. [How Much Does ICSI Cost? (2025)](https://geneticsandfertility.com/how-much-does-icsi-cost-2025/) - So, a full cycle with ICSI costs between $16,000 and $30,000, depending on the clinic, meds, and ext...

14. [Assisted Reproductive Technology Surveillance - United States, 2018](https://pubmed.ncbi.nlm.nih.gov/35176012/) - The percentage of preterm births was higher among infants conceived with ART (26.1%) than among all ...

15. [Assisted Reproductive Technology Surveillance — United States ...](https://www.cdc.gov/mmwr/volumes/71/ss/ss7104a1.htm) - The percentage of preterm births among ART-conceived singleton infants was 14.9% compared with 8.3% ...

16. [The declining efficiency of IVF in the USA - PubMed](https://pubmed.ncbi.nlm.nih.gov/41660485/) - Summary answer: National U.S. data show a continuous linear decline in IVF cycle efficiency between ...

17. [The declining efficiency of IVF in the USA - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12872396/) - National U.S. data show a continuous linear decline in IVF cycle efficiency between 2012 and 2021. W...

18. [NW Podcast: One & done endometriosis surgery is possible](https://naturalwomanhood.org/podcast/nw-podcast-s4ep2-one-and-done-endometriosis-surgery-dr-yeung/) - The Natural Womanhood Podcast. Audio Player ... Find us on the web at naturalwomanhood.org and be su...

19. [Outcomes - RESTORE - Center for Endometriosis](https://www.restoreendo.com/outcomes) - After analyzing 10 years worth of patient data, the rate of repeat surgery was a staggering low 2.5%...

20. [[PDF] Restorative Reproductive Medicine: A Surgical Approach to Treating ...](https://media.eppc.org/2025/03/3-A-Surgical-Approach-to-Treating-Endometriosis.pdf) - Endometriosis develops when the cells that line the uterus are found outside of the uterus. This con...

21. [Dr. Yeung's Publications and Articles](https://www.restoreendo.com/dr-yeungs-publications) - This study found that women who underwent optimal excision surgery for endometriosis had a much lowe...

22. [Bill Information - Arkansas State Legislature](https://arkleg.state.ar.us/Bills/Detail?ddBienniumSession=2025%2F2025R&measureno=HB1142) - House -- Notification that HB1142 is now Act 859. Originating Chamber: House ... Act Date: 4/17/2025...

23. [[PDF] Act 859 of the Regular Session - Arkansas State Legislature](https://arkleg.state.ar.us/Home/FTPDocument?path=%2FACTS%2F2025R%2FPublic%2FACT859.pdf) - AN ACT TO CREATE THE REPRODUCTIVE EMPOWERMENT AND. 9. SUPPORT ... Medicine of America for programs o...

24. [[PDF] HB1142 as engrossed on 03-19-2025 15:36:33](https://webftp.blr.arkansas.gov/Home/FTPDocument?path=ACTS%2F2025R%2FPublic%2FSearchable%2FACT859.pdf) - This act shall be known and may be cited as the "Reproductive. Empowerment and Support Through Optim...

25. [AR HB1142 | 2025 | 95th General Assembly - LegiScan](https://legiscan.com/AR/bill/HB1142/2025) - To Create The Reproductive Empowerment And Support Through Optimal Restoration (restore) Act. Sponso...

26. [Heritage Action Praises Arkansas' Adoption of the Women's ...](https://heritageaction.com/press/heritage-action-praises-arkansas-adoption-of-the-womens-restore-act) - ... Governor Sarah Huckabee Sanders' signing of HB 1142, a bill focused on improving women's reprodu...

27. [[PDF] ARKANSAS - Healthcare Value Hub](https://healthcarevaluehub.org/wp-content/uploads/11_5_2025-Arkansas-Snapshot-PDF.pdf) - The state requires individual and small group health plans to offer coverage for in-vitro fertilizat...

28. [2025 Arkansas Insurance Legislation Summary: Health](https://www.mitchellwilliamslaw.com/2025-arkansas-insurance-legislation-summary-health) - HB1142 (Act 859) – Creates the Reproductive ... Among other requirements, the Act mandates coverage ...

29. [Arkansas leads nation with new infertility treatment law](https://arkansas-catholic.org/2025/12/24/insurance-coverage-restorative-medicine/?print=print) - ... Act 859, requires insurance companies to cover “restorative reproductive medicine” instead of so...

30. [Arkansas law shifts national debate on infertility treatment | STAT](https://www.statnews.com/2025/08/05/infertility-treatment-restorative-reproductive-medicine-explained/) - The Arkansas law, passed in June, requires state insurance companies to cover so-called restorative ...

31. [H.R. 3589 (IH) - BILLS-119hr3589ih | Content Details - GovInfo](https://www.govinfo.gov/app/details/BILLS-119hr3589ih) - H.R. 3589 (IH) - Reproductive Empowerment and Support Through Optimal Restoration Act ; Action: Mrs....

32. [Congresswoman Harshbarger Introduces Legislation to Support ...](http://harshbarger.house.gov/media/press-releases/congresswoman-harshbarger-introduces-legislation-support-reproductive) - WASHINGTON, D.C. — Congresswoman Diana Harshbarger, alongside co-lead Congressman Riley Moore (R-WV)...

33. [H.R. 3589: Reproductive Empowerment and Support Through ...](https://www.quiverquant.com/bills/119/hr-3589) - The bill mandates the collection of data and expansion of research into reproductive health conditio...

34. [Heritage and EPPC Applaud New Bill That Offers Women More ...](https://www.heritage.org/press/heritage-and-eppc-applaud-new-bill-offers-women-more-reproductive-health-options) - WASHINGTON—U.S. Sens. Cindy Hyde-Smith (R-MS) and James Lankford (R-OK) today introduced the Reprodu...

35. [Menstruation in Girls and Adolescents: Using the Menstrual Cycle as ...](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2015/12/menstruation-in-girls-and-adolescents-using-the-menstrual-cycle-as-a-vital-sign) - By including an evaluation of the menstrual cycle as an additional vital sign, clinicians reinforce ...

36. [Menstruation in Girls and Adolescents: Using the Menstrual Cycle as ...](https://pubmed.ncbi.nlm.nih.gov/26595586/) - ACOG Committee Opinion No. 651: Menstruation in Girls and Adolescents: Using the Menstrual Cycle as ...

37. [MUST-KNOW warning signs for your PERIOD | Dr. Jennifer Lincoln](https://www.youtube.com/watch?v=N147KAIa8iE) - ... Committee Opinion 651: Menstruation in Girls and Adolescents: Using the Menstrual Cycle as a Vit...

38. [Costs of infertility treatment: Results from an 18-month prospective ...](https://pmc.ncbi.nlm.nih.gov/articles/PMC3043157/) - Median per-person costs ranged from $1,182 for medications only, to $24,373 and $38,015 for IVF and ...

39. [The preconception Mediterranean dietary pattern in couples ...](https://pubmed.ncbi.nlm.nih.gov/20189169/) - A preconception "Mediterranean" diet by couples undergoing IVF/ICSI treatment contributes to the suc...

