# Glossary Systematic Review & Fact-Check — 2026-05-02

**Scope:** 194 published terms across 8 Parts, 73 references, 60 abbreviations.
**Method:** 9 parallel sub-agents (one per Part, VI split into VI-A/B); each ran rrm-cli check-facts → rrm-cli search → Perplexity Sonar Pro → curl per cited reference → pillar-link liveness → abbreviation cross-check.
**Output:** this report. No D1 mutations or live-site changes.

## Headline Counts

| Severity | Count | Meaning |
|----------|-------|---------|
| **P0** | 5 | Factually wrong vs RRM canon or primary source. Blocks publish. |
| **P1** | 3 | Citation URL broken (4xx/5xx) or doesn't support cited claim. |
| **P2** | 36 | Drift / abbreviation mismatch / `consensus_conflict` (Brian arbitrates). |
| **P3** | 19 | Enhancement (better source, missing cross-ref, stronger Hilgers fact). |
| **TOTAL** | **63** | across 51 flagged terms (143 clean). |

**Per-part breakdown:**

| Part | Title | Terms | Clean | Flagged | P0 | P1 | P2 | P3 |
|------|-------|-------|-------|---------|----|----|----|-----|
| I | Core RRM Principles | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| II | Fertility Awareness Methods | 28 | 15 | 13 | 1 | 2 | 11 | 4 |
| III | Clinical Approaches | 23 | 17 | 6 | 3 | 0 | 3 | 2 |
| IV | Diagnostic Tools | 24 | 17 | 7 | 1 | 0 | 2 | 6 |
| V | Surgical Techniques | 16 | 11 | 5 | 0 | 0 | 4 | 1 |
| VI-A | Key Conditions (1–32) | 32 | 27 | 5 | 0 | 0 | 4 | 1 |
| VI-B | Key Conditions (33–65) | 33 | 26 | 7 | 0 | 0 | 6 | 2 |
| VII | Overlapping Disciplines | 12 | 7 | 5 | 0 | 1 | 4 | 1 |
| VIII | Broader Framework | 16 | 13 | 3 | 0 | 0 | 2 | 2 |

## Methodology Notes & Coverage Caveats

- **Perplexity coverage:** 120 of 194 terms had a Perplexity query traced in their `proof_log` (sub-agents' self-reported `perplexity_queries_used` counter is unreliable across the 9 dropfiles; this number is derived by string-matching). The plan called for one query per term. Parts with low coverage may benefit from a top-up pass — see "Recommended Follow-up" at end.
- **Schema variance:** Parts VI-B, VII, VIII used a mildly different per-term schema (no `status` field, free-text `proof_log` strings instead of `{method, result}` objects, `name` instead of `title`). Orchestrator normalized; downstream readers see one shape.
- **Severity normalization:** Two agents put `consensus_conflict` in the `severity` slot rather than `category` — orchestrator remapped to P2 + category=consensus_conflict.
- **READ-ONLY pass.** Zero D1 writes. Zero live-site changes. Fixes go through `/glossary-update` after Brian reviews.

## P0 — Factually Wrong (Blocks Publish) (P0) — 5 issues

**[P0]** Fertility-Focused Intercourse (FFI) — `fertility-focused-intercourse` (Part II) · ref#83 · `wrong_citation_year_and_authors`
- **field:** `body_html`
- **current:** In the landmark 1998 Hilgers and Stanford cohort of 50 apparently-fertile couples, FFI produced cumulative pregnancy rates of 76% in cycle 1, 90% by cycle 3, and 98% by cycle 6.
- **evidence:** In the landmark 1998 Hilgers and Stanford cohort of 50 apparently-fertile couples, FFI produced cumulative pregnancy rates of 76% in cycle 1, 90% by cycle 3, and 98% by cycle 6.
- **canon:** rrm-cli get article cumulative-pregnancy-rates-in-patients-with-apparently-normal-fertility-and-fert-recqv9jlhiqhkev3f -> authors: Hilgers TW, Daly KD, Prebil AM, Hilgers SK; year: 1992; journal: J Reprod Med 37(10):864-866
- **perplexity:** The paper 'Cumulative pregnancy rates in patients with apparently normal fertility and fertility-focused intercourse' was published in 1992 in The Journal of Reproductive Medicine (37(10):864-866), with authors T. W. Hilgers, K. D. Daly, A. M. Prebil, and S. K. Hilgers. ... PMID: 1479570. ... No evidence supports a 1998 republication or authorship change; all sources align on 1992 details.
- **suggested fix:** Change '1998 Hilgers and Stanford' to '1992 Hilgers, Daly, Prebil, and Hilgers'. The 76%/90%/98% cumulative pregnancy figures by cycle 1/3/6 ARE accurate for this cohort. Suggested replacement: 'In the landmark 1992 Hilgers, Daly, Prebil, and Hilgers cohort of 50 apparently-fertile couples (J Reprod Med 37:864-866), FFI produced cumulative pregnancy rates of 76% in cycle 1, 90% by cycle 3, and 98%…

**[P0]** Cooperative Estrogen Replacement Therapy (CERT) — `cert` (Part III) · ref#78 · `wrong_protocol_specifics`
- **field:** `body_html`
- **current:** The typical protocol delivers 1 to 2 mg of oral estradiol every other day from approximately Peak Day minus one (P-1) through Peak +12, with dosing individualized to chart-timed hormone assay results. 78
- **evidence:** If the luteal phase E₂ level is suboptimal, cooperative estrogen replacement therapy (CERT) can also be used. In doing this, an oral, micronized E₂ form is available and is active (Estrace). The usual dosage is 0.5 or 1 mg by mouth every day at bedtime (PO QD hs) from Peak +3 through Peak +12. On occasion, the dosage may be increased to 2 mg from Peak +3 through Peak +12.
- **canon:** Hilgers TW, The Medical and Surgical Practice of NaProTECHNOLOGY (2004), Chapter 27, pp. 335-340. Direct text of the CERT protocol as described by Hilgers.
- **perplexity:** Verified directly against Hilgers Chapter 27 in rrm-cli D1 corpus (rowid 3245).
- **suggested fix:** Replace with: 'The typical protocol delivers 0.5 to 1 mg of oral micronized estradiol (Estrace) every day at bedtime, Peak +3 through Peak +12 (occasionally increased to 2 mg, same timing), with dosing individualized to chart-timed hormone assay results.' Three drift points to correct: (1) dose 0.5-1 mg standard (not 1-2 mg); (2) every day, not every other day; (3) Peak +3 start, not Peak Day minu…

**[P0]** NaProTECHNOLOGY Postpartum Depression Protocol — `napro-postpartum-protocol` (Part III) · ref#79 · `wrong_statistic`
- **field:** `body_html`
- **current:** Hilgers reports symptomatic relief in approximately 95% of treated cases in his cohort. 79
- **evidence:** In this group of 53 episodes of PPD in 50 patients, marked improvement was identified in 43 of the 53 episodes (81.1%) and moderate improvement was observed in another 6 episodes (11.3%). This resulted in a marked or moderate improvement in 92.4 percent of the episodes treated.
- **canon:** Hilgers TW, The Medical and Surgical Practice of NaProTECHNOLOGY (2004), Chapter 30, Table 30-8 (Phase I+II combined cohort, 53 episodes, 50 patients).
- **perplexity:** Confirmed against rrm-cli D1 corpus (Chapter 30 full text, rowid 3248). Direct quote from Hilgers Chapter 30: 'marked or moderate improvement in 92.4 percent of the episodes treated.' Perplexity Q2 also returned 92.4-96.75% range across secondary citations, with the primary number being 92.4%.
- **suggested fix:** Change 'approximately 95%' to 'approximately 92%' (or '92.4% across the Phase I + Phase II combined cohort of 53 episodes'). The primary published statistic is 92.4% marked-or-moderate improvement; 95% over-rounds the actual published number and represents drift from the canon source.

**[P0]** Reproductive Health Research Institute (RHRI) — `rhri` (Part III) · `wrong_attribution`
- **field:** `body_html`
- **current:** The research and training organization behind FEMM's medical management protocols, founded by Dr. Pilar Vigil, a specialist in obstetrics, gynecology, and reproductive endocrinology.
- **evidence:** Dr. Vigil (MD in Gynecology and Obstetrics, PhD in Biological Sciences from Pontifical Catholic University of Chile) is explicitly listed as RHRI's medical director, with offices in New York, USA, and Santiago, Chile. No search results designate her as founder; RHRI's origins trace to prior researchers like Brown.
- **canon:** Per RHRI public materials and FEMM Health platforms, Vigil is Medical Director (not founder). RHRI's foundational work traces to James Brown PhD (estrogen patterns across the menstrual cycle) and Emil Steinberger.
- **perplexity:** No, Dr. Pilar Vigil is not credited as the founder of the Reproductive Health Research Institute (RHRI); she serves as its medical director. RHRI was established to advance research in reproductive health and endocrinology, building on foundational work by researchers like James Brown, PhD (who documented estrogen patterns across the menstrual cycle, enabling insights into ovulation, health, and f…
- **suggested fix:** Change 'founded by Dr. Pilar Vigil' to 'led by Dr. Pilar Vigil as Medical Director' (or 'directed by'). Vigil is the Medical Director, not the founder; RHRI's foundational work traces to Drs. James Brown and Emil Steinberger.

**[P0]** PGT-A (Preimplantation Genetic Testing for Aneuploidy) — `pgt-a` (Part IV) · ref#59 · `wrong_vs_canon`
- **field:** `body_html`
- **current:** The STAR trial, a multicenter randomized controlled trial in good-prognosis IVF patients, found no significant difference in cumulative live-birth rates between PGT-A selection and morphology-based selection alone (37.0% vs. 35.9%; the difference was not statistically significant).
- **evidence:** Result(s): A total of 661 women (average age 33.7 ± 3.6 years) were randomized to PGT-A (n = 330) or morphology alone (n = 331). The OPR was equivalent between the two arms, with no significant difference per embryo transfer (50% [137/274] vs. 46% [143/313]) or per intention to treat (ITT) at randomization (41.8% [138/330] vs. 43.5% [144/331]). Post hoc analysis of women aged 35-40 years showed a significant increase in OPR per embryo transfer (51% [62/122] vs. 37% [54/145]) but not per ITT.
- **canon:** Munné S et al. Fertil Steril. 2019;112(6):1071-1079. PMID 31551155 - retrieved verbatim from PubMed abstract.
- **perplexity:** Per ITT (randomized population: PGT-A n=330, control n=331), the 20-week OPR was 41.8% (138/330) in the PGT-A arm versus 43.5% (144/331) in the morphology-only control arm; the difference was not statistically significant. Per protocol (per embryo transfer: PGT-A n=274, control n=313), the 20-week OPR was 50% (137/274) in the PGT-A arm versus 46% (143/313) in the control arm; the difference was no…
- **suggested fix:** The numbers '37.0% vs. 35.9% cumulative live-birth rates' and the framing 'cumulative live-birth rates' are both incorrect. The STAR trial primary outcome was 20-week ongoing pregnancy rate (OPR), not cumulative live birth, and the figures were 50% vs 46% per embryo transfer or 41.8% vs 43.5% per ITT. Recommend rewrite: 'The STAR trial (Munné et al., Fertility and Sterility 2019), a multicenter ra…

## P1 — Broken / Wrong Citation (P1) — 3 issues

**[P1]** Billings Ovulation Method — `billings-ovulation-method` (Part II) · `factual_overstatement`
- **field:** `body_html`
- **current:** Published effectiveness data from large multi-country trials report method-related pregnancy rates of approximately 1% per year when used correctly to avoid pregnancy.
- **evidence:** Published effectiveness data from large multi-country trials report method-related pregnancy rates of approximately 1% per year when used correctly to avoid pregnancy.
- **perplexity:** WHO Trial 1 (1981): 725 Australian/New Zealand women, correct use (method-related) pregnancy rate 0.5% at 6 months, 1.7% at 12 months. WHO Trial 2 (1985): correct use rate 9% per 100 women over ~5.3 months. Combined WHO data ... BOM 'moderate quality' studies: method-related ~1-18.5/100 women-year. ... Recent 2024 meta-analysis confirms BOM perfect-use ~3-9% in trained users.
- **suggested fix:** The '~1%' figure cherry-picks the lowest end of WHO Trial 1's first-year correct-use rate. WHO Trial 2 reports much higher rates (~9%), and recent meta-analyses report 3-9%. Replace with: 'Published effectiveness data vary by population: WHO Trial 1 (1981) reported a 1.7% method-related pregnancy rate at 12 months among Australian and New Zealand users with correct use, while WHO Trial 2 (1985) an…

**[P1]** Fertility Awareness-Based Methods (FABMs) — `fabms` (Part II) · ref#6 · `citation_mismatch`
- **field:** `body_html`
- **current:** A 2025 systematic review of 20,339 participants from 16 studies found that FABMs, when used correctly, were associated with a success rate of over 90% for both contraception and conception purposes.
- **evidence:** FABMs, when used correctly, were associated with a success rate of over 90% for both contraception and conception purposes.
- **perplexity:** The 2025 systematic review by Bassas et al. ... reports an *average* success rate of 69.5% across 13 studies where calculable ...; only five studies exceeded 90%, typically linked to correct use, timed intercourse, and digital enhancements. The review's conclusion states FABMs achieve 'more than 90% success rate ... when used correctly' ... but this qualifies high-performing subsets, not overall f…
- **suggested fix:** Reframe to reflect the source's stratified finding. Replace with: 'A 2025 systematic review (Bassas et al., n=20,339 across 16 studies) reported an average FABM success rate of 69.5% across studies where it could be calculated, with five studies exceeding 90% under correct-use conditions (timed intercourse, digital enhancements).' Cited as a blanket >90% the current sentence overstates the review'…

**[P1]** Reproductive Immunology — `reproductive-immunology` (Part VII)
- **evidence:** 1
- **suggested fix:** Coordinate with IIRRM site admin to whitelist citation crawlers, or substitute with a peer-reviewed RRM definitional source (e.g., Stanford 2014 BMC Womens Health Creighton infertility paper) that is not behind a WAF.

## P2 — Drift / Mismatch / Consensus Conflict (P2) — 36 issues

**[P2]** Base Infertile Pattern (BIP) — `base-infertile-pattern` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** BIP
- **evidence:** abbreviation: BIP
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'BIP', full_term:'Base Infertile Pattern', term_slug:'base-infertile-pattern'}.

**[P2]** Billings Ovulation Method — `billings-ovulation-method` (Part II) · `missing_citation`
- **field:** `body_html`
- **current:** no <a href="#ref-N"> citations cited
- **evidence:** refs cited: []
- **suggested fix:** Term cites 'large multi-country trials supported by WHO' and 'published effectiveness data' but has no inline citations. Add WHO Trial 1 (1981, Contraception, doi:10.1016/0010-7824(81)90022-0) and Billings JJ. Cervical mucus paper (already in refs as ref-74) as supporting refs.

**[P2]** Essential Sameness Pattern and Yellow Stamps — `essential-sameness-pattern-yellow-stamps` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** ESP
- **evidence:** abbreviation: ESP
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'ESP', full_term:'Essential Sameness Pattern', term_slug:'essential-sameness-pattern-yellow-stamps'}.

**[P2]** Fertility Awareness-Based Methods (FABMs) — `fabms` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** FABMs
- **evidence:** abbreviation: FABMs
- **suggested fix:** glossary_abbreviation has 'FABM' (singular) -> fabms but no 'FABMs'. Add row {abbreviation:'FABMs', full_term:'Fertility Awareness-Based Methods', term_slug:'fabms'} for plural lookup parity, OR drop the plural 's' from the term-level abbreviation field.

**[P2]** Marquette Method — `marquette-method` (Part II) · `misleading_organizational_link`
- **field:** `body_html`
- **current:** Marquette is also used clinically through the FACTS (Fertility Appreciation Collaborative to Teach the Science) training program; see Marquette Method Clinical Protocol for the medical-management arm.
- **evidence:** Marquette is also used clinically through the FACTS (Fertility Appreciation Collaborative to Teach the Science) training program
- **perplexity:** FACTS (Fertility Appreciation Collaborative to Teach the Science) and Marquette Method training organizations are separate. Marquette training is managed by the Marquette University College of Nursing Institute for Natural Family Planning ... and affiliates ... with no overlap indicated in sources. FACTS is a distinct nonprofit focused on broader NFP education, not specifically training Marquette …
- **suggested fix:** Phrasing implies FACTS is the clinical-training arm of Marquette; FACTS is a separate physician-education nonprofit covering multiple FABMs. Recommend rewording to: 'Marquette training is delivered by the Marquette University Institute for Natural Family Planning. The method is also taught to physicians through FACTS (Fertility Appreciation Collaborative to Teach the Science), a separate nonprofit…

**[P2]** Mucus Cycle Score (MCS) — `mucus-cycle-score` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** MCS
- **evidence:** abbreviation: MCS
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'MCS', full_term:'Mucus Cycle Score', term_slug:'mucus-cycle-score'}.

**[P2]** Point of Change (POC) — `point-of-change` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** POC
- **evidence:** abbreviation: POC
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'POC', full_term:'Point of Change', term_slug:'point-of-change'}.

**[P2]** Premenstrual Bleeding (PMB) — `premenstrual-bleeding` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** PMB
- **evidence:** abbreviation: PMB
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'PMB', full_term:'Premenstrual Bleeding', term_slug:'premenstrual-bleeding'}.

**[P2]** Sympto-Thermal Method (STM) — `sympto-thermal-method` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** STM
- **evidence:** abbreviation: STM
- **suggested fix:** Term-level abbreviation 'STM' is set, but glossary_abbreviation has no row for STM. Add: {abbreviation:'STM', full_term:'Sympto-Thermal Method', term_slug:'sympto-thermal-method'}.

**[P2]** Tail-End Brown Bleeding (TEB) — `tail-end-brown-bleeding` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** TEB
- **evidence:** abbreviation: TEB
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'TEB', full_term:'Tail-End Brown Bleeding', term_slug:'tail-end-brown-bleeding'}.

**[P2]** Vaginal Discharge Recording System (VDRS) — `vdrs` (Part II) · `abbreviation_missing_from_table`
- **field:** `abbreviation`
- **current:** VDRS
- **evidence:** abbreviation: VDRS
- **suggested fix:** Add row to glossary_abbreviation: {abbreviation:'VDRS', full_term:'Vaginal Discharge Recording System', term_slug:'vdrs'}.

**[P2]** Achieving-Related Pregnancy Rate (ARPR) — `achieving-related-pregnancy-rate` (Part III) · ref#78 · `consensus_conflict`
- **field:** `body_html`
- **current:** calculated using Hilgers' life-table adaptation of the Tietze-Lewit framework. The foundational dataset includes a five-study composite of 1,876 couples across 17,130.5 couple-months. 78 83
- **evidence:** This dataset is published in the Hilgers & Stanford paper, 'Creighton Model NaProEducation Technology for avoiding pregnancy. Use effectiveness,' Journal of Reproductive Medicine 1998;43(6):495-502 (https://pubmed.ncbi.nlm.nih.gov/9653695/). The paper details a prospective life-table (survival) analysis—a meta-analysis of five use-effectiveness studies... The paper does not explicitly use 'ARPR' terminology, as this term appears in later Hilgers works to denote Achieving-Related Pregnancy Rates in NaProTechnology restorative contexts.
- **canon:** The 1,876 couples / 17,130.5 couple-months five-study composite is from Hilgers & Stanford 1998 (J Reprod Med), an AVOIDING-pregnancy use-effectiveness study. ARPR (achieving) is a methodological reframing of the same life-table cohort framework, applied in later Hilgers works (e.g., Hilgers 2010, PMID 20575910).
- **perplexity:** This exact dataset (1,876 couples / ~17,130 couple-months, five-study composite) is not published in Hilgers's 2004 textbook ... which references NaPro outcomes but aggregates later data without citing this specific 1998 meta-analysis dataset for ARPR. The 1998 paper remains the primary peer-reviewed source for these precise figures.
- **suggested fix:** Refine framing to clarify that the 1,876-couple / 17,130.5-couple-month dataset originated in Hilgers & Stanford's 1998 J Reprod Med paper as an avoiding-pregnancy use-effectiveness cohort, with ARPR being a methodological adaptation applied to the same cohort/framework in later achieving-conception analyses. Adding ref 83 to anchor the achieving-conception adaptation is appropriate; the avoiding-…

**[P2]** NaProTECHNOLOGY Prematurity Prevention Program — `prematurity-prevention-program` (Part III) · ref#79 · `consensus_conflict`
- **field:** `body_html`
- **current:** Hilgers reports cohort prematurity rates of approximately 7%, compared with the U.S. national rate of 12.7% at the time of publication. 79
- **evidence:** naprotechnology.com/prevention/: 'For the entire group, the comparison group had a preterm birth rate of 12.0 percent and the Pope Paul VI Institute group protocol only had a 7.0 percent prematurity rate'. diobelle PDF: 'NaProTechnology Prematurity Prevention Program has cut the rate from 12.1% to 7%'.
- **canon:** Hilgers reports the comparison group at 12.0%; NaPro at 7.0% (Pope Paul VI Institute web). Diocesan summary quotes 12.1%. CDC U.S. preterm birth rate hovered 12.0-12.8% during 2006-2010 (so 12.7% is plausible but not Hilgers's specific cited comparator).
- **perplexity:** The 12.7% in the query approximates 12.1% from [1], presented as a U.S. national average pre-intervention. CDC data ~2006-2010 had preterm birth at 12.0-12.7% (e.g., CDC 2006: 12.8%; 2010: 12.0%). [2] uses 12.0% explicitly as the 'comparison group' rate. No specific year/source is named for 12.7% in Hilgers's writings.
- **suggested fix:** Either (a) change 12.7% → 12.0% to match Hilgers's primary published comparator (most defensible); (b) keep 12.7% but anchor it to a specific CDC year (e.g., '12.7% — CDC NVSR 2007'); or (c) reframe as '~12% U.S. national rate.' P2 (no auto-fail) — figure is plausible but not what Hilgers cites in his primary materials.

**[P2]** Reproductive Health Research Institute (RHRI) — `rhri` (Part III) · `consensus_conflict`
- **field:** `body_html`
- **current:** RHRI has published peer-reviewed research linking chronic anovulation to long-term health risks including cardiovascular disease and Type 2 diabetes
- **evidence:** Search results do not provide peer-reviewed publications by RHRI or Dr. Vigil explicitly linking chronic anovulation to long-term cardiovascular disease (CVD) or Type 2 diabetes (T2D) risks.
- **canon:** PCOS-CVD/T2D linkage is well established in non-RHRI literature (e.g., Hum Reprod Update 2018), but specific peer-reviewed RHRI publications drawing this link were not located in this verification.
- **perplexity:** RHRI/FEMM protocols address anovulation within ovarian dysfunction and PCOS but lack specific citations here to such outcomes.
- **suggested fix:** Either (a) cite specific RHRI/Vigil publications making this claim, or (b) soften to 'has championed clinical attention to' rather than 'has published peer-reviewed research linking'. Not auto-fail; consensus_conflict only.

**[P2]** Endometrial Receptivity Analysis (ERA) — `era` (Part IV) · `consensus_conflict`
- **field:** `body_html`
- **current:** A study of 3,605 patients found that clinical pregnancy rate and live birth rate improved after personalized embryo transfer guided by ERA results, particularly in recurrent implantation failure patients.
- **evidence:** The ESHRE 2023 good practice recommendations on recurrent implantation failure (RIF) explicitly state that endometrial receptivity tests, including ERA, are not recommended for routine use, even in women with RIF; they should only be considered in research settings or exceptional cases. ... Doyle et al. 2022 RCT (JAMA), a multicenter randomized controlled trial of 767 good-prognosis patients (all with PGT-A euploid embryos), which found no improvement in live birth rates with ERA-guided personalized embryo transfer (pET) versus standard timing: 58.5% (ERA group) vs. 61.9% (standard group), wit…
- **canon:** ESHRE 2023 RIF Guideline; ASRM 2023; Doyle et al. JAMA 2022 RCT (n=767); Simón C et al. RBMO 2020 (n=458) RCT showed PET benefit but had 50% dropout. Glossary cites Renmin Hospital retrospective n=3,605 (Nature Sci Rep 2025, ref-25), which is real but methodologically inferior to RCT evidence.
- **perplexity:** evidence through 2025 confirms no large RCTs show clear ERA benefit in good-prognosis or RIF patients, with most implantation failures attributed to embryo aneuploidy (not addressable by ERA) or cycle-to-cycle WOI variability. Conflicting smaller/non-randomized studies exist but are outweighed by RCTs and guidelines due to bias risks.
- **suggested fix:** Add a balanced caveat sentence: 'However, randomized controlled trial evidence is conflicting: the Doyle 2022 RCT (n=767, JAMA) found no live-birth improvement with ERA-guided transfer, and ESHRE 2023 and ASRM 2023 guidelines do not recommend routine ERA use outside research settings or exceptional RIF cases.' This acknowledges the consensus conflict without removing the existing retrospective cit…

**[P2]** Sperm DNA Fragmentation Index (DFI) — `sperm-dna-fragmentation` (Part IV) · `drift`
- **field:** `body_html / abbreviation`
- **current:** term name uses 'DFI'; abbreviation field = 'DFI'; body uses 'SDF' four times: 'High SDF is associated...', 'making SDF testing...'
- **evidence:** <strong>A measure of the proportion of sperm with damaged or fragmented DNA.</strong> High SDF is associated with poor reproductive outcomes including reduced natural conception rates, failed IUI, increased miscarriage risk, and impaired embryo development. Standard semen analysis does not assess DNA integrity, making SDF testing an important adjunct...
- **canon:** Internal consistency: term abbreviation declared as DFI but body text uses SDF
- **perplexity:** n/a (internal-consistency issue, not a clinical-fact issue)
- **suggested fix:** Pick one abbreviation throughout. DFI = DNA Fragmentation Index (the assay output, e.g., SCSA reports DFI). SDF = Sperm DNA Fragmentation (the phenomenon). Recommend: keep term name as 'Sperm DNA Fragmentation Index (DFI)', but rewrite body to consistently use 'DFI' (e.g., 'A high DFI is associated with...', 'making DFI testing an important adjunct...'). Alternative: rename term to 'Sperm DNA Frag…

**[P2]** Isthmocele Repair (Hysteroscopic) — `isthmocele-repair-hysteroscopic` (Part V) · ref#34 · `drift`
- **field:** `body_html`
- **current:** Best suited for symptomatic patients (primarily bleeding complaints) with a residual myometrial wall thickness >5mm who do not desire future pregnancy.
- **evidence:** Indications: Preferred for symptomatic patients with RMT ≥2.5-3.5 mm (not strictly >5 mm as claimed; sources cite 2.5-3 mm minimum to avoid uterine perforation). User's >5 mm exceeds sources' 2.5-3.5 mm; may reflect conservative practice or older data — current evidence favors ≥2.5-3 mm for hysteroscopy safety.
- **canon:** Refs 34 (Vitale et al. PMC10416161) and 15 (Tulandi/Cohen scielo) discuss thresholds in the 2.5-3.5 mm range; 5mm is more conservative than current meta-analytic consensus.
- **perplexity:** RMT threshold variance: User's >5 mm exceeds sources' 2.5-3.5 mm; may reflect conservative practice or older data — current evidence favors ≥2.5-3 mm for hysteroscopy safety.
- **suggested fix:** Change '>5mm' to '≥2.5–3mm' (per Vitale 2023 PMC10416161 / Tulandi & Cohen 2019), or qualify as 'most conservative practice uses >5mm; current meta-analyses support ≥2.5–3mm as minimum'. Same fix applies to the paired laparoscopic entry below (where <5mm is the inverse threshold).

**[P2]** Isthmocele Repair (Laparoscopic) — `isthmocele-repair-laparoscopic` (Part V) · ref#16 · `drift`
- **field:** `body_html`
- **current:** Preferred when fertility preservation is desired or when residual myometrial thickness is <5mm.
- **evidence:** Preferred for RMT <3 mm, large/complex defects, or fertility preservation (restores myometrial integrity for implantation/pregnancy).
- **canon:** Pairs with the >5mm threshold issue on the hysteroscopic entry above. Current peer-reviewed consensus uses ~3 mm as the lap-vs-hysteroscopic decision boundary, not 5 mm.
- **perplexity:** Indications: Preferred for RMT <3 mm, large/complex defects, or fertility preservation.
- **suggested fix:** Change '<5mm' to '<3mm' (or 'thin RMT'), aligning with Vitale 2023 / Tulandi & Cohen 2019. Or qualify both thresholds as 'conservative-practice cutoffs; mainstream meta-analyses use ~3 mm'.

**[P2]** Laparoscopic Ovarian Wedge Resection (LOWR) — `lowr` (Part V) · ref#10 · `consensus_conflict`
- **field:** `body_html`
- **current:** Using microsurgical laser techniques, NaPro wedge resection has achieved approximately 70% pregnancy rates, over twice as effective as standard clomiphene citrate treatment (~30%) and higher than reported IVF success rates in PCOS (~23%).
- **evidence:** ~70% NaPro rate: Supported by practice reports/pilots but lacks peer-reviewed RCTs >50 patients; largely from NaPro/PPVI centers (e.g., pilot insulin data). Contrasts LOD meta-analyses (cumulative ~50% pregnancy, Cochrane 2014-2024 updates ~40-60%). Considered optimistic/preliminary.
- **canon:** Internal NaPro literature (NaProTechnology Surgery commentary, ref 10) supports 70% PR; cited correctly. Mainstream comparison is laparoscopic ovarian drilling (LOD) at ~50% cumulative, not LOWR per se. Glossary frames the claim explicitly as 'NaPro wedge resection' — internally consistent.
- **perplexity:** Considered optimistic/preliminary relative to dominant laparoscopic ovarian drilling (LOD) evidence. No 2025-2026 Phase III trials refute but highlight selection bias.
- **suggested fix:** Acceptable as-is given explicit 'NaPro wedge resection' framing + ref 10 attribution. Optionally add 'in NaPro center series' to the 70% claim for additional sourcing precision. Not a canon error.

**[P2]** Tubo-tubal Anastomosis (Tubal Ligation Reversal) — `tubal-ligation-reversal` (Part V) · `consensus_conflict`
- **field:** `body_html`
- **current:** A large series found that women under 30 with ring/clip sterilization reversals achieved an 88% pregnancy rate.
- **evidence:** 88% for <30 ring/clip: Unverified in provided data; closest is 78% clips (all ages). May stem from older/unpublished subsets — lacks peer-reviewed corroboration here.
- **canon:** The 88% figure appears in NaPro/microsurgical center series (consistent with refs 32 PMC4840024 Schubert outpatient series). Mainstream peer-reviewed range cited 60-80%; high-end NaPro center data plausibly support 88% for the most favorable subgroup. Internal NaPro consistency intact.
- **perplexity:** Pregnancy success rates typically ranging from 50-80% across studies... The claimed rates of 57-84% overall and 88% for women under 30 with ring/clip reversals are plausible but represent higher-end figures from specialized centers.
- **suggested fix:** Optionally add 'in microsurgical center series' to the 88% figure, OR cite the specific Schubert outpatient series (ref 32) directly in the sentence. Not a factual error; just stronger sourcing.

**[P2]** Autoimmune/Thrombophilic Disorders (as RPL Causes) — `autoimmune-thrombophilic` (Part VI-A) · ref#37 · `consensus_conflict`
- **field:** `body_html`
- **current:** Beyond APS, RRM evaluates for inherited thrombophilias (Factor V Leiden, prothrombin mutation, protein C/S deficiency), natural killer (NK) cell dysregulation, and systemic autoimmune conditions.
- **evidence:** Hereditary thrombophilia evaluation [...] Not recommended routinely by ASRM/ESHRE; low RPL association, no proven pregnancy benefit. Contested/outdated for screening.
- **canon:** RRM tradition includes inherited thrombophilia screening as part of comprehensive RPL workup; ESHRE 2017 RPL guideline reserves testing for personal/family VTE history.
- **perplexity:** ASRM/ESHRE do not recommend routine hereditary thrombophilia screening for RPL; reserved for personal or family history of VTE.
- **suggested fix:** This is a documented RRM-vs-mainstream divergence -- glossary already frames it as 'beyond APS, RRM evaluates'. The framing accurately distinguishes RRM workup philosophy from minimal-testing mainstream. No edit required; tagged consensus_conflict per Brian's hard rule.

**[P2]** Chronic Endometritis (CE) — `chronic-endometritis` (Part VI-A) · ref#51 · `consensus_conflict`
- **field:** `body_html (HR 2.28 / HR 2.76)`
- **current:** A cohort study showed the biopsy/treatment group had significantly higher chances of pregnancy (HR 2.28) and live birth (HR 2.76) compared to hysteroscopy-only controls.
- **evidence:** Mitter VR et al, AJRI 2021. Biopsy-treatment group: clinical pregnancy HR 2.28 (95% CI 1.23-4.24; p=0.009) vs hysteroscopy-only controls; live birth HR 2.76 (95% CI 1.30-5.87; p=0.008). DOI 10.1111/aji.13482.
- **canon:** Ref 51 (Mitter et al AJRI 2021) is the correct primary source for these HRs.
- **perplexity:** Some retrospective cohorts and 2024 large-cohort reanalyses show no benefit from CE antibiotic treatment vs untreated CE (e.g., source [1]: IVF-ET live birth 36.8% treated vs 37.7% untreated, p>0.05). The Mitter 2021 results are not universally replicated.
- **suggested fix:** Glossary text correctly cites Mitter 2021 figures and is internally consistent. Optional: add 'though replication in larger cohorts has been mixed' as a P3 enhancement. Not required for clean status.

**[P2]** Methylated Folate (L-Methylfolate) and MTHFR — `methylated-folate` (Part VI-A) · `consensus_conflict`
- **field:** `body_html`
- **current:** MTHFR variants are common, and most patients who carry them have never been tested. RRM protocols specify L-methylfolate preconceptionally for women with known MTHFR variants, recurrent miscarriage, or elevated homocysteine.
- **evidence:** ACMG (2017 technical standards, reaffirmed 2023-2026): Recommends against routine MTHFR testing in most contexts, including pregnancy/RPL, due to low predictive value and poor actionability. ACOG (Committee Opinion 2021, no 2026 update): Discourages MTHFR testing for RPL or thrombophilia; standard folic acid (not 5-MTHF) suffices preconceptionally.
- **canon:** RRM tradition (Hilgers/NaPro) supports L-methylfolate for known MTHFR carriers and elevated homocysteine; this is part of the broader RRM-vs-ACMG/ACOG framing.
- **perplexity:** 5-MTHF (1-5 mg daily) only if confirmed folate malabsorption or non-response to folic acid; otherwise, unnecessary. No 2026 peer-reviewed consensus for routine preconceptional 5-MTHF in MTHFR carriers without hyperhomocysteinemia.
- **suggested fix:** Glossary should keep RRM framing but consider adding a single sentence acknowledging the ACMG/ACOG position: 'ACMG and ACOG do not recommend routine MTHFR testing in mainstream practice; RRM follows a more proactive testing posture when homocysteine is elevated or RPL is present.' This is a P3 enhancement, not required for clean status. Tagged consensus_conflict per Brian's hard rule.

**[P2]** Recurrent Pregnancy Loss (RPL) — `rpl` (Part VI-A) · ref#36 · `consensus_conflict`
- **field:** `body_html`
- **current:** Assessment includes ... evaluation for hereditary thrombophilias.
- **evidence:** Hereditary thrombophilia evaluation [...] Not recommended routinely by ASRM/ESHRE; low RPL association, no proven pregnancy benefit. Contested/outdated for screening.
- **canon:** RRM workup includes inherited thrombophilias (Factor V Leiden, prothrombin, protein C/S) per Hilgers/RRM tradition; cross-linked to autoimmune-thrombophilic glossary entry.
- **perplexity:** ASRM and ESHRE do not recommend routine hereditary thrombophilia testing for RPL absent personal/family history of VTE; low yield and no proven pregnancy benefit.
- **suggested fix:** Keep current RRM framing; this is a documented RRM-vs-mainstream divergence already captured in autoimmune-thrombophilic entry. No glossary edit required.

**[P2]** Afollicularism (AF) — `afollicularism` (Part VI-B) · `consensus_conflict`
- **field:** `perplexity threshold`
- **evidence:** Hilgers Ch 20 body: 'this follicle never reaches an MFD of greater than 1.4 cm whereas a dominant follicle begins at 1.5 cm'
- **suggested fix:** No glossary edit. RRM canon is authoritative; Perplexity got it wrong (and noted figure 20-16 shows a 1.3 cm follicle as one observation within an afollicular cycle, but the threshold for the classification is >1.4 cm).

**[P2]** Human Chorionic Gonadotropin (hCG) — `hcg` (Part VI-B) · `consensus_conflict`
- **field:** `perplexity correction`
- **evidence:** rrm-cli D1 record reck8foTYr4nz9AC8 / recScncO5hzWefw8l: 'Quenby S, Farquharson RG. Human chorionic gonadotropin supplementation in recurring pregnancy loss: a controlled trial. Fertil Steril. 1994.'
- **suggested fix:** No glossary edit needed. Logging consensus_conflict so downstream agents do not treat the Perplexity false-negative as authoritative.

**[P2]** Immature Follicle Syndrome (IFS) — `immature-follicle-syndrome` (Part VI-B) · `consensus_conflict`
- **field:** `perplexity threshold`
- **evidence:** Hilgers Ch 20 D1 body: 'A follicle is sonographically observed to develop and reach maturity (defined as a MFD greater than or equal to 1.90 cm)'
- **suggested fix:** No glossary edit. RRM canon is authoritative; Perplexity got it wrong.

**[P2]** Time to Pregnancy (TTP) — `time-to-pregnancy` (Part VI-B)
- **field:** `ref-11 url`
- **evidence:** GET-UA-Accept: 403 https://hoiobgyn.com/blog/article/2023/05/napro-technology
- **suggested fix:** Bot protection; page is canonical. No edit; track as access_blocked.

**[P2]** Unexplained Infertility — `unexplained-infertility` (Part VI-B)
- **field:** `ref-1 url`
- **evidence:** HEAD-UA: 403 https://iirrm.org/what-is-rrm/  GET-UA-Accept: 403 https://iirrm.org/what-is-rrm/
- **suggested fix:** Likely Cloudflare bot challenge; URL is canonical and active in browser. No edit. Track as access_blocked, not broken.

**[P2]** Window of Implantation (WOI) — `window-of-implantation` (Part VI-B) · `consensus_conflict`
- **field:** `20-25% RIF displacement claim`
- **evidence:** displaced in approximately 20 to 25% of women with recurrent implantation failure, identifiable via ERA testing
- **suggested fix:** No P0/P1 fix required for glossary scope (this is reporting a measurement, not a claim of clinical benefit). If retained, optional hedging: 'reported in approximately 20-25%... though the clinical utility of ERA-guided transfers is debated.'

**[P2]** FertilityCare Practitioner (FCP) — `fcp` (Part VII)
- **evidence:** The FCP role is defined and credentialed through the FertilityCare Centers of America training program.
- **suggested fix:** Replace 'defined and credentialed through the FertilityCare Centers of America training program' with 'trained through AAFCP-accredited programs (such as those run by FertilityCare Centers of America and other accredited providers) and credentialed by the American Academy of FertilityCare Professionals (AAFCP)'. Aligns with the parallel 'FertilityCare Practice' entry.

**[P2]** Minimally Invasive Gynecologic Surgery (MIGS) — `migs` (Part VII) · `consensus_conflict`
- **evidence:** Robotic-assisted and mini-laparotomy techniques are included under this umbrella.
- **suggested fix:** Either (a) rephrase as 'Robotic-assisted and, in some RRM/NaPro practices, mini-laparotomy techniques are included under this umbrella' to flag the non-universal inclusion, or (b) leave as-is since RRM/NaPro surgical practice does treat mini-lap as fertility-sparing-equivalent. No auto-fail.

**[P2]** NaProTechnology Medical Consultant (NFPMC) — `nfpmc` (Part VII)
- **evidence:** Training routes include the fellowship at the Pope Paul VI Institute for the Study of Human Reproduction and the AAFCP Medical Consultant program.
- **suggested fix:** Update the body to: (a) acknowledge that 'NFPMC' is the legacy designation used for physicians who completed the CrMS Medical Consultant program prior to 2019, with the current credential designated 'CrMSMC' (Creighton Model System Medical Consultant); and (b) clarify that the Pope Paul VI Institute (SPVI) Saint John Paul the Great Fellowship is a distinct one-year postgraduate fellowship (which i…

**[P2]** Reproductive Immunology — `reproductive-immunology` (Part VII) · `consensus_conflict`
- **evidence:** reproductive immunology evaluation includes NK cell panels (natural killer cell activity), antiphospholipid antibody testing, food antibody screening, and chronic endometritis workup. Treatment modalities include low-dose naltrexone (LDN), intralipid infusions, corticosteroids, and anticoagulation therapy.
- **suggested fix:** Acceptable to retain as RRM/NeoFertility canon, but consider adding a one-clause note that these tests/treatments are RRM-distinct and not part of mainstream ASRM/ESHRE/HFEA guidelines. No auto-fail per Hard Rules — RRM canon ≠ mainstream consensus by design.

**[P2]** Adhesion Prevention — `adhesion-prevention` (Part VIII) · `drift`
- **evidence:** One published NaPro series documented a mean adhesion score reduction from 33.3 to 6.0 over a decade with systematic barrier use
- **suggested fix:** Either (a) change 'over a decade' to 'over 23 years' to match the Hilgers 2010 J Gynecol Surg primary source, or (b) cite the primary paper directly: 'Hilgers TW. Near Adhesion-Free Reconstructive Pelvic Surgery: Three Distinct Phases of Progress Over 23 Years. J Gynecol Surg. 2010' (already in D1 library at /library/near-adhesion-free-reconstructive-pelvic-surgery-three-distinct-phases-of-progre-…

**[P2]** Assisted Reproductive Technology (ART) — `art` (Part VIII) · `consensus_conflict`
- **evidence:** This includes in vitro fertilization (IVF), intracytoplasmic sperm injection (ICSI), intrauterine insemination (IUI), donor egg and donor sperm cycles, embryo transfer, and gestational surrogacy. Insurance documents, fertility clinic literature, and public health data all use ART as the standard classification.
- **suggested fix:** Either (a) remove IUI from the ART list and add a clarifying sentence: 'Note: CDC's official ART surveillance under ARTSAA 1992 excludes IUI because only sperm is handled. HFEA and ESHRE use a broader definition that may include IUI.' or (b) keep IUI in the list but immediately clarify the definitional split. The cleaner fix is (a) since the term is ART and IUI is covered separately under Part VII…

## P3 — Enhancements (P3) — 19 issues

**[P3]** Creighton Model FertilityCare System (CrMS) — `creighton-model` (Part II) · ref#8 · `precision`
- **field:** `body_html`
- **current:** the highest 13-cycle pregnancy rate with correct use to conceive was 89.6%
- **evidence:** A prospective cohort study (CEIBA) in 17 CrMS centers across the USA and Canada found the highest 13-cycle pregnancy rate with correct use to conceive was 89.6%, when intercourse was timed to peak-type mucus days.
- **perplexity:** Stanford et al. 2025 CEIBA study ... reports cumulative 13-cycle pregnancy rates with cycle intention to conceive ranging from 88.0% to 89.8% across all sensitivity scenarios. ... Published rate: 88.0-89.8% (not precisely 89.6%).
- **suggested fix:** The 89.6% lies inside the published 88.0-89.8% sensitivity range, but is not the singular highest rate quoted in the paper. Either (a) cite the range '13-cycle cumulative pregnancy rate of 88.0-89.8% across sensitivity analyses' or (b) name the specific scenario being quoted. Minor enhancement, not a factual error.

**[P3]** Marquette Method — `marquette-method` (Part II) · `branding`
- **field:** `body_html`
- **current:** ClearBlue Fertility Monitor
- **evidence:** uses the ClearBlue Fertility Monitor to measure urinary estrogen and LH metabolites
- **perplexity:** Official branding in Marquette protocols consistently uses Clearblue Fertility Monitor (lowercase 'b'), though peer-reviewed sources and early descriptions specify Clearblue Easy Fertility Monitor or ClearBlue Fertility Monitor (CBFM).
- **suggested fix:** Manufacturer's canonical capitalization is 'Clearblue' (one capital C). Both spellings appear in the literature so this is cosmetic; standardize to 'Clearblue Fertility Monitor' to match official branding.

**[P3]** Marquette Method — `marquette-method` (Part II) · `marquette_perfect_use_2pct`
- **field:** `body_html`
- **current:** Published effectiveness data from prospective cohort studies report perfect-use pregnancy rates of approximately 2% per year to avoid pregnancy.
- **evidence:** perfect-use pregnancy rates of approximately 2% per year to avoid pregnancy
- **perplexity:** Marquette Method ... Breastfeeding/postpartum protocol: Perfect-use unintended pregnancy rate is 2% per 100 women over 12 months. ... Regular cycles: Typically <1-0.6% perfect-use rate (better than 2%).
- **suggested fix:** The 2% figure aligns with Marquette's breastfeeding protocol; regular-cycle perfect-use rates are typically below 1%. Either qualify ('2% per year in the breastfeeding protocol; <1% in regular cycles in published studies') or state the population-pooled figure.

**[P3]** Sympto-Thermal Method (STM) — `sympto-thermal-method` (Part II) · `missing_citation`
- **field:** `body_html`
- **current:** 0 refs cited
- **evidence:** refs cited: []
- **suggested fix:** Concrete BBT magnitude claim (0.2-0.5 deg C rise from progesterone) and STM definition would benefit from at least one citation; see ref-74 (Billings) or add a sympto-thermal reference (e.g., Frank-Herrmann 2007 Hum Reprod).

**[P3]** Heteromolecular Artimones (HMA) — `heteromolecular-artimones` (Part III) · `enhancement`
- **field:** `body_html`
- **current:** Heteromolecular artimones are synthetic compounds whose molecular structure has been altered from endogenous human hormones, coined by Dr. Thomas Hilgers as the antonym to isomolecular hormones .
- **evidence:** No explicit 'heteromolecular artimones' phrasing found; this may be interpretive or from unpublished/ later Hilgers materials.
- **canon:** Hilgers's 2004 textbook codifies the heteromolecular contrast in concept; the exact compound term 'heteromolecular artimones' is documented in NaProTECHNOLOGY teaching materials but not always in the same exact phrasing in cited public sources.
- **perplexity:** No explicit 'heteromolecular artimones' phrasing found; this may be interpretive or from unpublished/ later Hilgers materials. For primary verification, consult the 2004 textbook directly via Pope Paul VI Institute.
- **suggested fix:** OPTIONAL enhancement: add page-anchored citation to ref 78 (Hilgers 2004 textbook chapter where the term is defined) so readers can locate the primary source. Not a content fix; the term IS Hilgers's, just verifying anchor.

**[P3]** NaProTECHNOLOGY (Natural Procreative Technology) — `naprotechnology-definition` (Part III) · ref#10 · `citation_precision`
- **field:** `body_html`
- **current:** In Hilgers (2004), a cohort of 1,045 infertile patients reported cumulative live-birth rates exceeding 60% by 24 months and approximately 70% by 36 months. 10
- **evidence:** [10] NaProTechnology Surgery: A Restorative Approach to Fertility and Gynecologic Health | https://rrmacademy.org/commentary/naprotechnology-surgery-a-restorative-approach-to-fertil
- **canon:** Hilgers TW. The Medical and Surgical Practice of NaProTECHNOLOGY. 2004 (ref 78) is the primary source for the 1,045-patient cohort outcome data; ref 10 is a derivative commentary on NaPro surgery, not the original outcome study.
- **perplexity:** These data are summarized in Chapter 51 of the textbook, with figures directly from the Saint Paul VI Institute's database (1989-2003 accrual). Full textbook access: https://naprotechnology.com/references/ (lists Hilgers 2004)
- **suggested fix:** Replace inline ref 10 with ref 78 (Hilgers 2004 textbook) for the 1,045-cohort outcome statistic. Ref 10 (RRM Academy NaPro Surgery commentary) does not document this cohort's pregnancy rates.

**[P3]** CD138 (Syndecan-1) Immunohistochemistry — `cd138` (Part IV) · `enhancement`
- **field:** `body_html`
- **current:** CD138 IHC is more sensitive than routine histology alone for detecting chronic endometritis and is the current standard for diagnosis when chronic endometritis is suspected.
- **evidence:** Newer markers like MUM1 (multiple myeloma oncogene-1, nuclear-specific) show higher sensitivity (e.g., 57% vs. 40% for CD138 in one study, p=0.01) and better specificity for scarce plasma cells, with superior inter-observer consistency.
- **canon:** MUM1 emerging as superior alternative to CD138 in some 2024-2025 literature; CD138 remains current clinical standard but is being challenged.
- **perplexity:** Combined approaches (hysteroscopy + CD138/MUM1/CD38) enhance accuracy, with ongoing AI integration promising further precision. No universal guidelines exist; CE prevalence in infertility/RPL is 40-60% via IHC vs. lower with H&E/hysteroscopy alone.
- **suggested fix:** Optional clarification: 'CD138 IHC is the current clinical standard, though emerging markers such as MUM1 show comparable or higher sensitivity in research settings.' Not blocking; current text accurately reflects today's clinical practice.

**[P3]** Endometrial Receptivity Analysis (ERA) — `era` (Part IV) · `enhancement`
- **field:** `body_html`
- **current:** The ERA analyzes the expression profile of 236 to 238 genes related to endometrial receptivity status.
- **evidence:** Sources cite 236 genes and 238 genes, with one source noting the commercial ERA test 'recently dropped to 236 genes' from an earlier 238-gene panel.
- **canon:** Igenomix/IVI commercial ERA evolution: original 238-gene panel narrowed to 236 in current version
- **perplexity:** demonstrates high sensitivity (0.99758) and specificity (0.8857) for diagnosing endometrial receptivity
- **suggested fix:** Optional: rephrase to 'analyzes a 236-gene expression panel (previously 238 genes)' for greater precision. Current 'between 236 and 238 genes' is technically correct but vague.

**[P3]** Intratubal Pressure (ITP) — `intratubal-pressure` (Part IV) · `enhancement`
- **field:** `abbreviation table coverage`
- **current:** abbreviation 'ITP' set on glossary_term row but not in glossary_abbreviation table
- **evidence:** abbreviations.json filter for ITP returned no rows
- **canon:** Same gap as DFI/TCFT
- **perplexity:** n/a
- **suggested fix:** Add row to glossary_abbreviation: ITP -> Intratubal Pressure -> intratubal-pressure. Read-only finding; no action taken. Note also that 'ITP' more commonly refers to 'idiopathic thrombocytopenic purpura' in general medicine; intra-glossary usage is unambiguous but external readers may need disambiguation.

**[P3]** Semen Analysis — `semen-analysis` (Part IV) · `enhancement`
- **field:** `body_html`
- **current:** evaluating sperm concentration (count), motility, morphology (shape), volume, and other parameters
- **evidence:** The current WHO manual is the 6th edition (2021), titled WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th ed., superseding the 5th edition (2010); it provides updated reference values for normal semen parameters based on fertile men (lower reference limits, 5th centile; 95% CI).
- **canon:** WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th ed., 2021
- **perplexity:** Concentration 16 million/mL (down from 15), Total motility 42% (vs 40), Progressive motility 30% (vs 32), Vitality 54% (vs 58), Morphology normal 4% (unchanged)
- **suggested fix:** Optionally add sentence: 'Reference values follow the WHO Laboratory Manual for the Examination and Processing of Human Semen, 6th edition (2021).' Adds clinical specificity without changing meaning.

**[P3]** Sperm DNA Fragmentation Index (DFI) — `sperm-dna-fragmentation` (Part IV) · `enhancement`
- **field:** `abbreviation table coverage`
- **current:** abbreviation 'DFI' is set on glossary_term row but does not appear in glossary_abbreviation table (filtered jq query returned only HSG, ERA, AMH, AFC)
- **evidence:** jq '.[0].results[] | select(.abbreviation | IN("HSG","DFI","ERA","AMH","AFC","TCFT","ITP","SDF"))' /tmp/glossary-review/abbreviations.json -- only HSG, ERA, AMH, AFC present
- **canon:** Same gap exists for TCFT and ITP (both have abbreviation field set on glossary_term but no entry in glossary_abbreviation table).
- **perplexity:** n/a
- **suggested fix:** Add rows to glossary_abbreviation table for DFI->Sperm DNA Fragmentation Index (or SDF), TCFT->Transcervical Catheterization of the Fallopian Tubes, ITP->Intratubal Pressure to keep cross-reference layer complete. Read-only finding; no action taken.

**[P3]** Transcervical Catheterization of the Fallopian Tubes (TCFT) — `tcft` (Part IV) · `enhancement`
- **field:** `abbreviation table coverage`
- **current:** abbreviation 'TCFT' set on glossary_term row but not in glossary_abbreviation table
- **evidence:** abbreviations.json filter for TCFT returned no rows
- **canon:** Same gap as DFI/ITP (see sperm-dna-fragmentation entry for full enumeration)
- **perplexity:** n/a
- **suggested fix:** Add row to glossary_abbreviation: TCFT -> Transcervical Catheterization of the Fallopian Tubes -> tcft. Read-only finding; no action taken.

**[P3]** Anti-Adhesion Barriers — `anti-adhesion-barriers` (Part V) · ref#10 · `enhancement`
- **field:** `body_html`
- **current:** Materials placed during surgery to physically separate tissue surfaces during the healing period, reducing adhesion formation. In NaPro Surgery, Gore-Tex membrane (expanded polytetrafluoroethylene) has been used extensively, with published results showing dramatic reductions in adhesion reformation scores over time.
- **evidence:** Gore-Tex (expanded polytetrafluoroethylene, ePTFE) has historically been used in some fertility-preserving surgeries like NaProTechnology for its barrier properties, but it is not a first-line or standard agent in contemporary gynecologic practice as of 2026. Current evidence favors resorbable barriers like HA-CMC (Seprafilm).
- **canon:** Hilgers/Stanford/Boyle 2010 NARPS paper (ref 80) documents Gore-Tex use in Phase II-III; this is correct historical attribution to NaPro Surgery, not a canon error. P3 enhancement only.
- **perplexity:** Update recommended: Broaden to 'resorbable/non-resorbable barriers (e.g., HA-CMC, ePTFE in select cases).'
- **suggested fix:** Optionally add a parenthetical that mainstream practice has shifted toward resorbable barriers (HA-CMC/Seprafilm), while retaining the NaPro/Gore-Tex historical attribution. Not blocking.

**[P3]** Uterine Isthmocele (Cesarean Scar Defect / Uterine Niche) — `isthmocele` (Part VI-A) · ref#15 · `consensus_conflict`
- **field:** `body_html (Treatment classification table)`
- **current:** Hysteroscopic [...] RMT >5mm; no future pregnancy desired. Laparoscopic [...] RMT <5mm; preferred overall.
- **evidence:** User threshold -- hysteroscopic shaving for RMT >5 mm, laparoscopic excision + multilayer reconstruction for RMT <5 mm with fertility desire -- lacks direct support in results and appears contested/outdated; no sources specify 5 mm cutoff or modality based on RMT alone. [...] Guidelines emphasize individualized planning via Delphi metrics (defect shape, volume, location); evidence favors symptom-driven approaches over fixed thresholds.
- **canon:** Cited refs 15, 16, 34 (scielo + PubMed Vitale et al + PMC Tower-Rader) reference the 5mm threshold framework.
- **perplexity:** 2019 Delphi consensus standardizes width, depth, and RMT measurements; no universal RMT-stratified protocols.
- **suggested fix:** Soften the table absolute thresholds slightly: 'RMT generally >5mm' / 'RMT generally <5mm', and add 'as one common framework; final approach is individualized to defect shape, depth, fertility desire, and surgeon experience.' Optional P3 enhancement; not a P0/P1.

**[P3]** Chronic Pelvic Pain (CPP) — `chronic-pelvic-pain` (Part VI-B)
- **field:** `abbreviation registry`
- **evidence:** abbreviation: CPP, term_slug=chronic-pelvic-pain (from glossary_term); not present in glossary_abbreviation list.
- **suggested fix:** Optional: add row to glossary_abbreviation { abbreviation: 'CPP', full_term: 'Chronic Pelvic Pain', term_slug: 'chronic-pelvic-pain' } for cross-link consistency.

**[P3]** Window of Implantation (WOI) — `window-of-implantation` (Part VI-B)
- **field:** `body cycle-day range`
- **evidence:** approximately cycle days 19 to 23 in a standard 28-day cycle
- **suggested fix:** Optional: refine to 'approximately cycle days 19 to 23 (LH+5 to LH+9)' or shift to 'cycle days 20-24'. Current text is within tolerance and includes the leading 'approximately' hedge; no canon violation.

**[P3]** Follicle Stimulation / Ovulation Induction — `follicle-stimulation` (Part VII)
- **evidence:** The NEJM trial by Legro and colleagues demonstrated letrozole's superiority over clomiphene for live birth rates in PCOS.
- **suggested fix:** Append effect size to the existing sentence: 'The NEJM trial by Legro and colleagues demonstrated letrozole's superiority over clomiphene for live birth rates in PCOS (27.5% vs 19.1%; rate ratio 1.44, 95% CI 1.10-1.87, p=0.007).'

**[P3]** Assisted Reproductive Technology (ART) — `art` (Part VIII) · `enhancement`
- **evidence:** Per CDC and HFEA annual reporting, national averages for fresh non-donor IVF cycles decline sharply after age 35.
- **suggested fix:** Optional: add a single representative data point or link directly to the most recent CDC ART Report. Not blocking.

**[P3]** NaProTECHNOLOGY vs. RRM — `napro-vs-rrm` (Part VIII) · `enhancement`
- **evidence:** NaProTECHNOLOGY (NaPro) is the most established and studied approach within restorative reproductive medicine
- **suggested fix:** Soften slightly: 'NaProTECHNOLOGY is the longest-established and most extensively documented approach within RRM' or qualify with 'in published clinical literature'. Current wording is rhetorically strong but not technically wrong, so this is a P3 polish, not a P2 drift.

## Cross-Cutting Findings

_No cross-citation propagations found (P1s are isolated to single terms)._

**Most-cited references in flagged terms** (top 10):
- ref#10 → 3 terms
- ref#78 → 2 terms
- ref#79 → 2 terms

## Recommended Follow-up

1. **Brian review:** mark accept/reject on each P0/P1 issue. P2 `consensus_conflict` items need explicit Brian arbitration (RRM stance vs mainstream).
2. **Perplexity top-up pass:** 74 terms appear to have skipped Perplexity verification (~$0.11 to close at $0.0015/query). Recommended for completeness — say the word and I dispatch a focused top-up agent.
3. **Apply approved fixes** via `/glossary-update` skill in batches grouped by table (`glossary_term`, `glossary_reference`, `glossary_abbreviation`).
4. **Mandatory rebuild after fixes:** `gh workflow run` with `glossary_term_id=<id>` per fixed term, OR a single full rebuild dispatch. D1 publish ≠ live (Brian's hard rule).
5. **Phase 2 schema addition (optional but recommended):** add `verified_at TEXT`, `verified_by TEXT`, `last_review_report TEXT` columns to `glossary_term`, `glossary_reference`, `glossary_abbreviation`. Lets the next review skip clean terms (`WHERE verified_at < date('now','-90 day')`).

## Appendix: Clean Terms

### Part I — Core RRM Principles (10 clean)
- `restorative-reproductive-medicine` — Restorative Reproductive Medicine (RRM)
- `root-cause-diagnosis` — Root Cause Diagnosis
- `restorative-as-a-principle` — Restorative (as a Principle)
- `natural-fertility` — Natural Fertility
- `body-literacy` — Body Literacy
- `comprehensive-evaluation` — Comprehensive Evaluation
- `personalized-treatment` — Personalized Treatment
- `holistic-approach` — Holistic Approach
- `reproductive-health-optimization` — Reproductive Health Optimization
- `corrective-vs-bypass` — Corrective vs. Bypass/Suppressive

### Part II — Fertility Awareness Methods (15 clean)
- `fertility-charting` — Fertility Charting
- `biomarkers` — Biomarkers (Fertility)
- `nfp` — Natural Family Planning (NFP)
- `peak-day` — Peak Day
- `femm` — FEMM (Fertility Education and Medical Management)
- `bbt` — Basal Body Temperature (BBT)
- `mucus-pattern` — Mucus Pattern
- `peak-symptom` — Peak Symptom
- `pre-peak-phase` — Pre-Peak Phase
- `post-peak-phase` — Post-Peak Phase
- `mucus-cycle` — Mucus Cycle
- `dry-day` — Dry Day
- `mucus-descriptors` — Mucus Quality Descriptors
- `vulvar-observation` — Vulvar Observation
- `limited-mucus-cycle` — Limited Mucus Cycle

### Part III — Clinical Approaches (17 clean)
- `napro-medical` — NaPro Medical
- `napro-surgery` — NaPro Surgery / Advanced Reproductive Surgery
- `fertilitas-study` — Fertilitas Study
- `femm-medical-management` — FEMM Medical Management
- `femm-levels` — FEMM Education Levels (Teen, Adult, Medical)
- `sympto-hormonal-method` — Sympto-Hormonal Method
- `neofertility` — NeoFertility
- `chartneo` — ChartNeo
- `ldn` — Low-Dose Naltrexone (LDN)
- `dhea-supplementation` — DHEA (Dehydroepiandrosterone) in RRM
- `immune-modifying-framework` — Immune-Modifying Framework
- `marquette-protocol` — Marquette Method Clinical Protocol
- `hcg-trigger` — HCG Trigger (Human Chorionic Gonadotropin Trigger)
- `cprt` — Cooperative Progesterone Replacement Therapy (CPRT)
- `isomolecular-hormones` — Isomolecular Hormones (IMH)
- `heteromolecular-artimones` — Heteromolecular Artimones (HMA)
- `compounding-pharmacist-triad` — Compounding Pharmacist Triad

### Part IV — Diagnostic Tools (17 clean)
- `follicle-maturation-study` — Follicle Maturation Study (Follicle Tracking / Follicular Ultrasound Series)
- `sis` — Saline Infusion Sonohysterogram (SIS) / "Bubble Test"
- `hsg` — Hysterosalpingogram (HSG)
- `selective-salpingography` — Selective Salpingography
- `hysteroscopy-diagnostic` — Hysteroscopy (Diagnostic)
- `hysteroscopy-operative` — Hysteroscopy (Operative)
- `laparoscopy-diagnostic` — Laparoscopy (Diagnostic)
- `laparoscopy-operative` — Laparoscopy (Operative)
- `near-contact-laparoscopy` — Near Contact Laparoscopy
- `s-map` — S-MAP (Systematic Mapping of the Abdomen and Pelvis)
- `emma-alice` — EMMA / ALICE (Endometrial Microbiome Testing)
- `amh` — Anti-Müllerian Hormone (AMH)
- `afc` — Antral Follicle Count (AFC)
- `ovarian-reserve` — Ovarian Reserve
- `follicle-development` — Follicle Development
- `peak-plus-series` — Targeted Post-Peak Progesterone Series (Peak +3, +5, +7, +9, +11)
- `sonographic-ovulation-classification` — Sonographic Classification of Ovulation Disorders (Hilgers Classification)

### Part V — Surgical Techniques (11 clean)
- `excision-surgery` — Excision Surgery (for Endometriosis)
- `fulguration-ablation` — Fulguration / Ablation / Cauterization (Endometriosis)
- `adhesiolysis` — Adhesiolysis
- `vasectomy-reversal` — Vasectomy Reversal (Vasovasostomy / Vasoepididymostomy)
- `fallopian-tube-recanalization` — Fallopian Tube Recanalization (Cannulation)
- `neosalpingostomy` — Neosalpingostomy / Fimbrioplasty
- `myomectomy` — Myomectomy
- `microsurgery` — Microsurgery
- `mini-laparotomy` — Mini-laparotomy
- `pears` — PEARS (Pelvic Excision And Repair Surgery)
- `narps` — Near Adhesion-Free Reconstructive Pelvic Surgery (NARPS)

### Part VI-A — Key Conditions (1–32) (27 clean)
- `infertility` — Infertility
- `endometriosis` — Endometriosis
- `endometrioma` — Endometrioma
- `pcos` — PCOS (Polycystic Ovary Syndrome)
- `pcos-phenotypes` — PCOS Phenotypes (Rotterdam A through D)
- `myo-inositol` — Myo-Inositol
- `luteal-phase-deficiency` — Luteal Phase Deficiency (LPD)
- `luteal-phase` — Luteal Phase (LP)
- `corpus-luteum` — Corpus Luteum (CL)
- `luf-syndrome` — Luteinized Unruptured Follicle (LUF) Syndrome
- `anovulatory-cycles` — Anovulatory Cycles
- `shortened-luteal-phase` — Shortened Luteal Phase
- `tubal-factor-infertility` — Tubal Factor Infertility
- `hydrosalpinx` — Hydrosalpinx
- `fallopian-tube-anatomy` — Fallopian Tube Anatomy Reference
- `pelvic-adhesions` — Pelvic Adhesions (Scar Tissue)
- `adenomyosis` — Adenomyosis
- `uterine-fibroids` — Uterine Fibroids (Leiomyomas)
- `uterine-septum` — Uterine Septum
- `ashermans-syndrome` — Intrauterine Adhesions (Asherman's Syndrome)
- `aps` — Antiphospholipid Syndrome (APS)
- `varicocele` — Varicocele
- `male-factor-infertility` — Male Factor Infertility
- `oat-syndrome` — Oligospermia / Asthenospermia / Teratospermia
- `azoospermia` — Azoospermia
- `oxidative-stress` — Oxidative Stress / Reactive Oxygen Species (ROS)
- `sperm-dna-fragmentation-extended` — Sperm DNA Fragmentation Index (DFI): Extended

### Part VI-B — Key Conditions (33–65) (26 clean)
- `hormonal-abnormalities` — Hormonal Abnormalities
- `hypothyroidism` — Hypothyroidism / Subclinical Hypothyroidism
- `hyperprolactinemia` — Hyperprolactinemia
- `poi` — Premature Ovarian Insufficiency (POI)
- `dor` — Diminished Ovarian Reserve (DOR)
- `insulin-resistance` — Insulin Resistance / Metabolic Dysfunction
- `secondary-infertility` — Secondary Infertility
- `cervical-factor-infertility` — Cervical Factor Infertility
- `poor-cervical-mucus` — Poor Cervical Mucus Production
- `endometrial-thickness` — Endometrial Thickness
- `endometrial-hyperplasia` — Endometrial Hyperplasia
- `postpartum-fertility` — Postpartum Fertility Issues
- `lh` — Luteinizing Hormone (LH)
- `fsh` — Follicle-Stimulating Hormone (FSH)
- `nk-cells` — Natural Killer (NK) Cells
- `pms` — Premenstrual Syndrome (PMS)
- `tsh` — Thyroid-Stimulating Hormone (TSH)
- `bmi` — Body Mass Index (BMI)
- `molimina` — Molimina
- `clinical-endorphin-deficiency` — Clinical Endorphin Deficiency
- `thrombophilia` — Clotting Disorder / Thrombophilia
- `early-pregnancy-loss` — Early Pregnancy Loss
- `corpus-luteum-deficiency` — Corpus Luteum Deficiency (CLD)
- `empty-follicle-syndrome` — Empty Follicle Syndrome (EFS)
- `partial-rupture-syndrome` — Partial Rupture Syndrome (PRS)
- `delayed-rupture-syndrome` — Delayed Rupture Syndrome (DRS)

### Part VII — Overlapping Disciplines (7 clean)
- `reproductive-endocrinology` — Reproductive Endocrinology
- `restorative-andrology` — Restorative Andrology
- `cycle-timed-diagnostics` — Cycle-Timed Diagnostics
- `pelvic-floor-physical-therapy` — Pelvic Floor Physical Therapy
- `fertilitycare-practice` — FertilityCare Practice
- `functional-nutritional-medicine` — Functional and Nutritional Medicine
- `transdermal-estrogen` — Transdermal Estrogen

### Part VIII — Broader Framework (13 clean)
- `iui` — IUI (Intrauterine Insemination)
- `ivf` — IVF (In Vitro Fertilization)
- `ivf-vs-rrm` — IVF vs. RRM: Key Conceptual Distinctions
- `patient-centered-care` — Patient-Centered Care
- `couple-based-treatment` — Couple-Based Treatment
- `minimally-invasive-surgery` — Minimally Invasive Surgery (MIS)
- `antioxidant-therapy` — Antioxidant Therapy
- `nutritional-lifestyle-medicine` — Nutritional and Lifestyle Medicine
- `icsi` — Intracytoplasmic Sperm Injection (ICSI)
- `ohss` — Ovarian Hyperstimulation Syndrome (OHSS)
- `oc` — Oral Contraceptive (OC)
- `iud` — Intrauterine Device (IUD)
- `hrt` — Hormone Replacement Therapy (HRT)

---

_Generated 2026-05-03T10:04:53.657083 from `/tmp/glossary-review/part-*.json` dropfiles. 9 parallel `general-purpose` sub-agents. Total Perplexity spend ≈ $0.18._
