# "What is RRM?" Pillar Article -- Session Log

**Branch:** `feat/what-is-rrm-pillar` (merged to `main` locally, not pushed)
**Article:** `src/pages/what-is-rrm/index.astro` (2,076 lines)
**Commits:** 18 on feature branch

---

## Commit History

| SHA | Description |
|-----|-------------|
| `bcf61d0` | Add pillar article CSS components |
| `d95e631` | Scaffold article layout with sticky TOC |
| `1e1a3c8` | Move key-takeaways anchor to h2 element |
| `a4d21f3` | Sections 1-5: definition, history, diagnosis, FABMs |
| `909926e` | Sections 6-8: conditions, RRM vs IVF, evidence |
| `5268db9` | Sections 9-12: journey, cost, NaPro, training |
| `29ed6d5` | Sections 13-15 + refs: myths, getting started, FAQ |
| `43e5473` | Add What is RRM to header, footer, and mobile nav |
| `a8f7d5f` | Expand JSON-LD schema: 20 FAQs, hasPart, citations |
| `6fc155e` | Add internal cross-links from homepage and about |
| `ac86237` | Library gap tracking and final review fixes |
| `9d48def` | Address editorial review feedback |
| `ac10284` | Research-verified corrections to all citations |
| `1359bd2` | Apply 8 accuracy fixes from claims audit |
| `eaac027` | Apply 15 verification fixes from claims audit phase 2 |
| `13ebb23` | Verification round 3: authorship, sources, framing |
| `b7eaf23` | Correct Hilgers attribution and luteal phase threshold |
| `a32018e` | Add holistic care content, SART citation, deduplicate Hilgers |

---

## Article Structure (15 sections)

1. Key Takeaways
2. What Is Restorative Reproductive Medicine?
3. A Brief History of Restorative Reproductive Medicine
4. How RRM Diagnosis Works
5. Fertility Awareness-Based Methods (FABMs) Explained
6. Conditions Treated with Restorative Reproductive Medicine
7. RRM vs. IVF: A Detailed Comparison
8. The Evidence Behind RRM
9. What to Expect: The RRM Patient Journey
10. How Much Does RRM Cost?
11. NaProTechnology: What It Is and How It Works
12. RRM Training and Credentials for Healthcare Professionals
13. Common Myths About Restorative Reproductive Medicine
14. How to Get Started with Restorative Reproductive Medicine
15. Frequently Asked Questions (20 Q&A pairs)

Plus: 30 references, JSON-LD structured data (Article + MedicalWebPage + FAQPage + BreadcrumbList + citation array)

---

## Claims Audit and Verification

A 95-claim audit was extracted from the article (`docs/plans/2026-03-01-what-is-rrm-claims-audit.json`). Research was conducted across 4 rounds using parallel subagents with firecrawl and Airtable BIFID full-text search.

### Critical Corrections Applied

| Claim | Error | Fix |
|-------|-------|-----|
| IIRRM founding year | Article said 2008 | Corrected to 2000 (per IIRRM About page and Media Advisory) |
| Dr. Joseph Tracey coined RRM | Person does not appear in any IIRRM source | Replaced with Dr. Kevin McCarthy and founding group |
| Sanchez-Mendez 62.1% at 24 months | 24-month rate is 50.0%; 62.1% is the 36+ month plateau | Fixed to show both timepoints |
| Stanford 2008 "25.5% to 52.8% depending on age and BMI" | These are crude vs. life-table adjusted overall rates, not subgroup ranges | Corrected framing |
| Stanford 2021 preprint authored by "Stanford JB" | Actual authors: James G, McLinden LA, Hatch J, Mol BW | Corrected authorship and DOI |
| ref-5 cited for unexplained infertility 15-30% | Duane et al. 2022 does not contain this figure | Added ref-29 (Gelbaya et al. 2014) |
| Vesali meta-analysis 44-69% post-excision pregnancy | Cherry-picked EFI 5-10 range; Vesali is non-RRM author from IVF institution | Removed entirely |
| JAMA/PRIMED "commissioned through" | PRIMED is advocacy training, not a commissioning body | Fixed to "authored by a graduate of" |
| FertilityCare Centers of America covers all FABMs | FCCA is Creighton/NaPro only | Added method-specific directories |
| Boyle 2018 in general comparison chart | Post-IVF-failure cohort not comparable to general infertility populations | Moved to dedicated "RRM After Failed IVF" section |
| Hilgers superlative as editorial voice | "among the most detailed ever collected" sounded like article's claim | Attributed to Hilgers himself |
| "Fewer than 11 days" luteal phase threshold | BBT-era criterion from prior literature, not Hilgers' NaPro definition (Type I LPD = post-Peak phase <= 8 days) | Removed specific threshold |
| SART reporting claim unsourced | "clinics may selectively report favorable results" had no citation | Added ref-30: Kushnir et al. 2013 (Fertil Steril, PMID 23755956) |
| Endo diagnosis delay "seven to twelve years" | Conflated multiple studies; Pugsley & Ballard 2007 reports median 9 years | Fixed to "median of nine years" |
| RPL "consecutive" and "1-2%" | "Consecutive" dropped by current ACOG; prevalence for 2+ losses is 2-5% | Fixed both |
| HFEA IVF rates "30% per cycle" | HFEA reports per embryo transferred, not per cycle | Corrected to "33% per embryo transferred" |

### Research Agents Dispatched

| Agent | Finding |
|-------|---------|
| FEMM/RHRI connection | Functionally one ecosystem; RHRI is research arm; 1,500+ providers trained |
| Vesali meta-analysis author | Iranian reproductive epidemiologist at IVF center, not RRM |
| Unexplained infertility stats | 15-30% correct but source was wrong (Gelbaya 2014, not Duane 2022) |
| Stanford 2021 preprint authorship | James et al., not Stanford; corrected with DOI |
| JAMA/PRIMED viewpoint | Lead author was PRIMED graduate, not "commissioned" |
| IVF cost per cycle | HHS says $15-20k; kept $15-30k per Brian's directive |
| FABM provider directories | FCCA = Creighton/NaPro only; added Marquette and FEMM directories |
| Whittaker credentials | Both verified: ABOG board certified, PPVI NaPro fellowship |
| BIFID luteal phase threshold | Hilgers Type I LPD = post-Peak <= 8 days; "11 days" is BBT-era literature |
| SART voluntary reporting | Kushnir et al. 2013: 13 clinics = 50% of excluded cycles, above-avg success rates |

### Verified Credentials

- **Dr. Naomi Whittaker:** ABOG board-certified OBGYN, St. John Paul II Research Fellow at PPVI (both confirmed via rrmacademy.org physician spotlight)

---

## Content Added (Final Session)

### Holistic / Whole-Body Care

Added two new subsections within the Conditions section:

1. **Perimenopause and Menopausal Care** -- cycle-charted hormonal transition monitoring, bio-identical support timed to individual data, longitudinal baseline advantage from years of chart data
2. **Whole-Body and Couple-Centered Care** -- five paragraphs covering:
   - Functional nutrition and metabolic health
   - Functional bloodwork (expanded metabolic/inflammatory panel)
   - Mental health and emotional support
   - Environmental and lifestyle factors (endocrine disruptors, toxic load)
   - Couple-centered healing

Updated: conditions comparison table (added perimenopause row), Key Takeaways (added whole-body bullet), intro paragraph (added male factor, perimenopause, holistic framing), JSON-LD and HTML FAQ answers.

### FEMM/RHRI

- History section: expanded FEMM bullet with RHRI details and 1,500+ providers trained
- Training section: new "5. FEMM and RHRI" subsection with Medical Management training details
- Provider callout: added RHRI/FEMM training link

---

## References (30 total)

| # | Source |
|---|--------|
| 1 | IIRRM -- What is RRM? |
| 2 | OSV News -- NaPro alternative to IVF |
| 3 | Stanford et al. 2008, JABFM |
| 4 | Tham et al. 2012, Can Fam Physician |
| 5 | Duane et al. 2022, Frontiers in Medicine |
| 6 | Duane & Brown 2025, FACTS |
| 7 | Shelton 2026, Technically Human (Whittaker interview) |
| 8 | Billings Atlas 1989 |
| 9 | Hilgers 2004, NaProTechnology textbook |
| 10 | Boyle et al. 2022, JMCR (16-year case report) |
| 11 | Yeung et al. 2024, Acta Sci Women's Health |
| 12 | Waters & Dodson 2025, Heritage Foundation |
| 13 | Pugsley & Ballard 2007, BJGP |
| 14 | ACOG Committee Opinion No. 651, 2015 |
| 15 | Katz et al. 2011, Fertil Steril |
| 16 | HFEA 2023, Fertility Treatment 2021 |
| 17 | Boyle et al. 2018, Frontiers in Medicine |
| 18 | James et al. 2021, medRxiv preprint |
| 19 | Bewley et al. 2011, BMJ |
| 20 | RESTORE Act, H.R. 3589 |
| 21 | FACTS About Fertility |
| 22 | Natural Womanhood -- Find a Doctor |
| 23 | *(removed: Vesali et al. 2020)* |
| 24 | Boyle et al. 2025, JRRM |
| 25 | Sanchez-Mendez et al. 2025, Frontiers Reprod Health |
| 26 | Whittaker 2025, RRM Academy commentary |
| 27 | Schlegel et al. 2021, J Urol (AUA/ASRM male factor guideline) |
| 28 | Stanford et al. 2021, BMC Preg Childbirth |
| 29 | Gelbaya et al. 2014, Obstet Gynecol Surv |
| 30 | Kushnir et al. 2013, Fertil Steril (SART reporting) |

---

## Remaining Work

- **Internal links:** Heavy internal link pass needed (cross-link to courses, commentary, library, other pages)
- **Library gap check:** 8 peer-reviewed refs to verify present in library.rrmacademy.org (see `docs/plans/2026-03-01-what-is-rrm-library-gaps.md`)
- **Push to remote:** Not yet pushed
- **Boyle 2025 study:** Brian prefers this for the primary IVF vs RRM comparison; currently featured prominently with chart
