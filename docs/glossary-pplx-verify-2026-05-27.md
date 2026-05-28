# Glossary Perplexity-Definition Verification — 2026-05-27

**Source**: Google Sheet `RRM Academy Glossary -- External Sourcing` (`1JNFrImZyp6O17NqNKsdwbvz5tF6K56yXXZ4uxzT2zvk`)

**Scope**: All 336 rows with Perplexity definitions (col J), across 13 parallel sub-agent batches + 10-row calibration.

## Summary

| Status | Count |
|---|---|
| **verified** | 95 |
| **warn** | 118 |
| **fail** | 123 |
| **TOTAL** | 336 |

### Findings by severity

| Severity | Count |
|---|---|
| **P0** | 175 |
| **P1** | 4 |
| **P2** | 205 |
| **P3** | 119 |

### Findings by category

| Category | Count |
|---|---|
| `hallucinated_citation` | 157 |
| `enhancement` | 119 |
| `protocol_leak` | 88 |
| `unverified` | 74 |
| `consensus_conflict` | 30 |
| `drift` | 23 |
| `fabricated_stat` | 12 |

### Cost + runtime per batch

| Batch | Rows | V/W/F | PPLX | curl | Wall(s) |
|---|---|---|---|---|---|
| calibration | 10 | 3/4/3 | 0 | 14 | 362 |
| I | 9 | 0/3/6 | 1 | 13 | 496 |
| II | 27 | 6/9/12 | 0 | 14 | 468 |
| III | 21 | 4/7/10 | 2 | 17 | 245 |
| IV | 23 | 7/5/11 | 1 | 19 | 900 |
| V | 15 | 0/4/11 | 0 | 18 | 220 |
| VI-A | 34 | 12/11/11 | 0 | 19 | 529 |
| VI-B | 35 | 4/21/10 | 1 | 32 | 747 |
| VII | 11 | 1/6/4 | 0 | 11 | 0 |
| VIII | 14 | 4/4/6 | 0 | 18 | 409 |
| Q-1 | 35 | 17/9/9 | 0 | 14 | 378 |
| Q-2 | 35 | 8/14/13 | 2 | 25 | 629 |
| Q-3 | 35 | 15/11/9 | 0 | 21 | 506 |
| Q-4 | 32 | 16/8/8 | 0 | 14 | 489 |

## P0 findings (highest priority — drift, hallucinated citations, fabricated stats)

### row 12 — `Anti-Adhesion Barriers` (V)

**Perplexity definition**:

> Anti-adhesion barriers are materials placed during pelvic surgery to physically separate tissue surfaces during the healing period, thereby reducing adhesion formation. In NaPro Surgery, expanded polytetrafluoroethylene (Gore-Tex membrane) is used extensively. Clinical studies show Gore-Tex is more effective than Interceed or no barrier in preventing adhesion formation, both new formation and reformation. Published NaPro surgical series have documented dramatic long-term reductions in adhesion scores with systematic barrier use.

- **[P0] hallucinated_citation**
  - **Claim**: PubMed: Barrier agents for preventing adhesions (pubmed.ncbi.nlm.nih.gov/10796548)
  - **Evidence**: PMID 10796548 was not checked (out of K-column-priority budget), but listing format is suspect. (No curl check performed within budget; flagging as unverified-citation.) The two other K sources are sls.org Chapter 56 and a 'restoreendo.com' marketing page.
  - **Source**: `col_K_review`
  - **Fix**: Replace K with col AE Luciano AA 1995 (Prevention of postoperative adhesions) and col AA Hilgers Ch 67 (Fundamental Anti-Adhesion Surgical Techniques).

### row 16 — `Antisperm Antibodies (ASA)` (?)

**Perplexity definition**:

> Antisperm antibodies (ASA) are immunoglobulins (IgG, IgA, or IgM) produced against sperm surface antigens, recognized as a cause of immunological infertility in both males and females. In men, ASA form when sperm antigens are exposed to the immune system following breakdown of the blood-testis barrier (trauma, infection, vasectomy reversal). In women, ASA may be found in cervical mucus or serum. ASA can impair sperm motility, penetration of cervical mucus, acrosome reaction, and fertilization. Testing uses the mixed antiglobulin reaction (MAR test) or immunobead binding (IBT). In RRM, ASA test...

- **[P0] hallucinated_citation**
  - **Claim**: Lahmann PH et al. (2003). Antisperm antibodies and male fertility. Andrology. https://pubmed.ncbi.nlm.nih.gov/28570831/
  - **Evidence**: PubMed esummary for PMID 28570831 returns: Moffatt CRM (2017) Foodborne Pathog Dis: Recovery of Salmonella enterica from Australian Layer and Processing Environments
  - **Source**: `curl_pmid:28570831`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 18 — `Aromatase Inhibitors (see Letrozole)` (?)

**Perplexity definition**:

> Aromatase inhibitors (AIs) are a class of agents that block the enzyme aromatase (CYP19A1), which converts androgens (androstenedione, testosterone) to estrogens (estrone, estradiol) in peripheral tissues, the ovary, and the brain. By reducing estrogen levels, AIs release the hypothalamic-pituitary axis from estrogen negative feedback, increasing FSH secretion and stimulating dominant follicle development. Letrozole (a third-generation AI) is the first-line oral ovulation induction agent for PCOS per ASRM/ESHRE 2023 guidelines. Anastrozole is used less commonly. AIs have shorter half-lives tha...

- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2014). Letrozole versus clomiphene for PCOS. N Engl J Med. https://pubmed.ncbi.nlm.nih.gov/24926259/
  - **Evidence**: PubMed esummary for PMID 24926259 returns: Kanda T (2014) Case Rep Oncol: Occurrence and Recurrence of Hepatocellular Carcinoma
  - **Source**: `curl_pmid:24926259`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 36 — `Cervical Stenosis` (?)

**Perplexity definition**:

> Cervical stenosis is a narrowing or occlusion of the cervical canal, which can be congenital or acquired (following LEEP/cone biopsy, endometrial ablation, infection, or radiation). Clinically, it may present as dysmenorrhea (blood outflow obstruction), amenorrhea or hypomenorrhea, hematometra, or infertility from impaired sperm transport. Diagnosis is confirmed by difficulty or inability to pass a small dilator or catheter through the internal os. Treatment is cervical dilation, sometimes with hysteroscopic guidance. In NaProTECHNOLOGY, cervical stenosis is identified during HSG and may be tr...

- **[P0] hallucinated_citation**
  - **Claim**: Grimes DA et al. (2008). Cervical dilation: techniques and outcomes. Contraception. https://pubmed.ncbi.nlm.nih.gov/18665167/
  - **Evidence**: PubMed esummary for PMID 18665167 returns: Martín-Martorell P (2008) Br J Cancer: Biweekly cetuximab and irinotecan in advanced colorectal cancer
  - **Source**: `curl_pmid:18665167`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 43 — `Clomiphene Citrate (Clomid)` (?)

**Perplexity definition**:

> Clomiphene citrate (CC) is a selective estrogen receptor modulator (SERM) that blocks estrogen receptors in the hypothalamus and pituitary, reducing estrogen negative feedback and increasing FSH/LH secretion to stimulate follicle development. Administered at 50–150 mg/day on cycle days 3–7, CC was the traditional first-line ovulation induction agent for PCOS and ovulatory dysfunction for decades. Its limitations include anti-estrogenic effects on the endometrium (thin lining) and cervical mucus (hostile), peripheral half-life of up to 5 weeks, and ~20–25% ovulation failure rate. Letrozole has ...

- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2014). Letrozole versus clomiphene for PCOS. N Engl J Med. https://pubmed.ncbi.nlm.nih.gov/24926259/
  - **Evidence**: PubMed esummary for PMID 24926259 returns: Kanda T (2014) Case Rep Oncol: Occurrence and Recurrence of Hepatocellular Carcinoma
  - **Source**: `curl_pmid:24926259`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 50 — `Congenital Uterine Anomaly` (?)

**Perplexity definition**:

> Congenital uterine anomalies (CUAs) are structural abnormalities of the uterus present from birth, resulting from failure of the Müllerian ducts to develop, fuse, or resorb normally. The prevalence in the general population is estimated at 5–6% and rises to 8% in women with recurrent miscarriage and 24% in women with late pregnancy losses. The most clinically significant CUA in RRM is the uterine septum, which carries the highest miscarriage risk and is correctable by hysteroscopy. CUAs are diagnosed by 3D transvaginal ultrasound, MRI, or hysteroscopy. Complete evaluation is a standard compone...

- **[P0] hallucinated_citation**
  - **Claim**: Grimbizis GF et al. (2016). Clinical implications of uterine malformations. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/26537926/
  - **Evidence**: PubMed esummary for PMID 26537926 returns: Benito S (2016) Anal Bioanal Chem: LC-QTOF-MS-based targeted metabolomics of arginine-creatine metabolic pathway
  - **Source**: `curl_pmid:26537926`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.
- **[P0] hallucinated_citation**
  - **Claim**: Chan YY et al. (2011). The prevalence of congenital uterine anomalies in unselected and high-risk populations. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/21672929/
  - **Evidence**: PubMed esummary for PMID 21672929 returns: Sánchez-Jiménez F (2011) Hum Reprod: Sam68 mediates leptin-stimulated growth in JEG-3 cells
  - **Source**: `curl_pmid:21672929`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 59 — `Corpus Luteum Deficiency (CLD)` (VI)

**Perplexity definition**:

> Corpus Luteum Deficiency (CLD), also known as luteal phase deficiency (LPD), is a clinical condition in which the corpus luteum produces insufficient progesterone to adequately prepare the endometrium for implantation or to maintain an early pregnancy. It is defined as suboptimal mid-luteal phase progesterone concentrations, a shortened luteal phase (≤10 days), or failure of the endometrium to respond appropriately to progesterone. Associated conditions include PCOS, endometriosis, thyroid disorders, hyperprolactinemia, and excessive exercise. In RRM, CLD is identified through cycle-timed post...

- **[P0] drift**
  - **Claim**: col Q icd10="E73.0" / col S icd10_def="ICD-10 (WHO 2019, E73.0): Congenital lactase deficiency"
  - **Evidence**: E73.0 is congenital lactase deficiency, NOT corpus luteum deficiency. Sheet has assigned a completely unrelated ICD code. Pplx definition does not cite ICD codes so this is a SHEET curation drift not a Perplexity claim drift.
  - **Source**: `col_Q+col_S`
  - **Fix**: Sheet curation: remove the wrong ICD-10/11 codes (E73.0 / 5C61.61 are both lactase deficiency). CLD has no clean ICD-10 mapping; closest is N97.0 (Female infertility associated with anovulation). See side dropfile.

### row 61 — `Cortisol — Stress and Reproductive Impact` (?)

**Perplexity definition**:

> Cortisol is the primary glucocorticoid produced by the adrenal cortex in response to physiological and psychological stress, mediated via the HPA (hypothalamic-pituitary-adrenal) axis. Chronically elevated cortisol suppresses GnRH pulsatility, reducing LH and FSH secretion and impairing ovulation — a mechanism underlying hypothalamic amenorrhea and functional anovulation in high-stress states. Cortisol also competes with progesterone for glucocorticoid receptors, potentially reducing progesterone signaling at the endometrium. In RRM, stress evaluation and management (sleep optimization, mind-b...

- **[P0] hallucinated_citation**
  - **Claim**: Ferin M (1999). Stress and the reproductive cycle. J Clin Endocrinol Metab. https://pubmed.ncbi.nlm.nih.gov/10574958/
  - **Evidence**: PubMed esummary for PMID 10574958 returns: Antil S (1999) J Biol Chem: Variability among the sites by which curaremimetic toxins bind to torpedo acetylcholine receptor
  - **Source**: `curl_pmid:10574958`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 67 — `D-Chiro-Inositol` (?)

**Perplexity definition**:

> D-chiro-inositol (DCI) is a secondary messenger in insulin signaling pathways, promoting glucose uptake and reducing androgen synthesis. In PCOS, a defect in DCI metabolism (reduced epimerization of myo-inositol to DCI) contributes to insulin resistance and hyperandrogenism. D-chiro-inositol supplementation in PCOS reduces androgen levels, improves insulin sensitivity, and restores ovulatory function. However, high doses of DCI alone may negatively impact oocyte quality; the preferred clinical approach is a combined myo-inositol:DCI supplementation at a 40:1 ratio, reflecting the physiological...

- **[P0] hallucinated_citation**
  - **Claim**: Unfer V et al. (2012). Myo-inositol in women with PCOS: a novel method of ovulation induction. Eur Rev Med Pharmacol Sci. https://pubmed.ncbi.nlm.nih.gov/22803269/
  - **Evidence**: PubMed esummary for PMID 22803269 returns: Ileri Z (2012) N Y State Dent J: Curbing gagging reflex
  - **Source**: `curl_pmid:22803269`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.
- **[P0] hallucinated_citation**
  - **Claim**: Larner J et al. (2010). Inositol chiro stereoisomers and insulin action. Mol Cell Biochem. https://pubmed.ncbi.nlm.nih.gov/20354783/
  - **Evidence**: PubMed esummary for PMID 20354783 returns: Chen C (2010) Neurochem Res: Hydrogen-rich saline protects against spinal cord injury in rats
  - **Source**: `curl_pmid:20354783`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.
- **[P0] hallucinated_citation**
  - **Claim**: ISGE Consensus (2013). Myo-inositol in the treatment of PCOS. Gynecol Endocrinol. https://pubmed.ncbi.nlm.nih.gov/23659659/
  - **Evidence**: PubMed esummary for PMID 23659659 returns: (no PubMed record returned for PMID 23659659)
  - **Source**: `curl_pmid:23659659`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 76 — `Electrosurgery (Reproductive Surgery)` (?)

**Perplexity definition**:

> Electrosurgery in reproductive surgery uses electrical energy to cut, coagulate, or vaporize tissue. Monopolar electrosurgery (current flows from active electrode through the body to a return pad) provides cutting and coagulation with high power concentration; bipolar electrosurgery (current flows between two electrode tips only) is safer near delicate structures (fallopian tubes, ureter, bowel) and is standard in most NaProTECHNOLOGY laparoscopic procedures. In endometriosis excision surgery, electrosurgery is used for precise cutting and hemostasis; however, indiscriminate coagulation of end...

- **[P0] hallucinated_citation**
  - **Claim**: Jones KD et al. (2001). Endometriosis excision techniques. Curr Opin Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/11433129/
  - **Evidence**: PubMed esummary for PMID 11433129 returns: Gosse P (2001) Blood Press Monit: Ambulatory measurement of the QKD interval
  - **Source**: `curl_pmid:11433129`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 78 — `EMMA / ALICE (Endometrial Microbiome Testing)` (IV)

**Perplexity definition**:

> The endometrial microbiome is the community of microorganisms resident in the uterine cavity. Unlike the previously held belief that the uterus is sterile, metagenomics studies have identified a distinct endometrial microbiome dominated by Lactobacillus species in the healthy state. Dysbiosis (abnormal microbiome composition, particularly reduction of Lactobacillus and increase of pathobionts) is associated with impaired implantation and recurrent pregnancy loss. The EMMA (Endometrial Microbiome Metagenomic Analysis) test assesses endometrial microbiome composition, while the ALICE (Analysis o...

- **[P0] hallucinated_citation**
  - **Claim**: Moreno I et al. (2016). Evidence that the endometrial microbiota has an effect on implantation success or failure. Am J Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/27421823/
  - **Evidence**: PMID 27421823 esummary returns: 'Incisional hernia in pediatric surgery - experience at a single UK tertiary centre.' Mullassery D, 2016, J Pediatr Surg. Real Moreno 2016 paper = PMID 27717732 (Am J Obstet Gynecol).
  - **Source**: `curl_pmid:27421823 + europepmc_search`
  - **Fix**: Replace fabricated PMID 27421823 with real PMID 27717732.

### row 80 — `Endocrine Disruptors (EDCs) — Fertility Impact` (?)

**Perplexity definition**:

> Endocrine-disrupting chemicals (EDCs) are exogenous substances that interfere with hormone synthesis, secretion, transport, binding, or metabolism. Reproductive EDCs of primary concern include bisphenol A (BPA), phthalates, dioxins, organochlorine pesticides, and perfluoroalkyl substances (PFAS). EDC exposure has been linked to PCOS, endometriosis, premature ovarian insufficiency, reduced semen quality, and impaired fetal development. In RRM, EDC exposure history and dietary/lifestyle modification to minimize EDC burden are considered as part of the functional and nutritional medicine evaluati...

- **[P0] hallucinated_citation**
  - **Claim**: Woodruff TJ et al. (2010). Exposure to endocrine-disrupting chemicals in the USA. Lancet Diabetes Endocrinol. https://pubmed.ncbi.nlm.nih.gov/20005534/
  - **Evidence**: PubMed esummary for PMID 20005534 returns: Antonelli A (2010) Metabolism: Prevalence of thyroid dysfunctions in systemic lupus erythematosus
  - **Source**: `curl_pmid:20005534`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.
- **[P0] hallucinated_citation**
  - **Claim**: Gore AC et al. (2015). EDC-2: The Endocrine Society's second scientific statement on EDCs. Endocr Rev. https://pubmed.ncbi.nlm.nih.gov/26544350/
  - **Evidence**: PubMed esummary for PMID 26544350 returns: Peyronnet B (2015) Prog Urol: Facteurs histologiques associés au pronostic oncologique après prostatectomie robot-assistée
  - **Source**: `curl_pmid:26544350`
  - **Fix**: Strip the PMID, leave the qualitative attribution only, OR look up correct PMID. For Legro 2014 Letrozole vs Clomiphene NEJM the correct PMID is 25006718 (verified). For Rivera 1999 hormonal contraceptive mechanism, the correct PMID is 10561657 — wait, esummary shows that PMID IS Rivera 1999, so flag the wrong attribution.

### row 89 — `Estradiol` (?)

**Perplexity definition**:

> Estradiol (E2) is the primary biologically active estrogen in reproductive-aged women, secreted by granulosa cells of developing ovarian follicles. It drives endometrial proliferation, stimulates cervical mucus production, triggers the LH surge (positive feedback at high concentrations), and supports oocyte maturation. Basal estradiol (cycle day 2–4) is used to assess ovarian reserve in conjunction with FSH; elevated basal E2 (>60–80 pg/mL) with normal FSH may still indicate diminished reserve. In NaProTECHNOLOGY, estradiol is measured serially at post-peak days 3 and 5 to evaluate corpus lute...

- **[P0] hallucinated_citation**
  - **Claim**: Broekmans FJ et al. (2006). Tests predicting ovarian reserve and IVF outcome. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/17071849/
  - **Evidence**: PMID 17071849 actually resolves to: 'Wild and aquaculture populations of the eastern oyster compared using microsatellites.' J Hered 97 2006 Nov-Dec. Authors: Carlsson J, Morrison CL, Reece KS.
  - **Source**: `curl_pmid:17071849`
  - **Fix**: Replace fabricated PMID 17071849 with correct PMID 16891297 (Broekmans FJ, Kwee J, Hendriks DJ. 'A systematic review of tests predicting ovarian reserve and IVF outcome.' Hum Reprod Update 12 2006 Nov-Dec).

### row 94 — `Excision Surgery (for Endometriosis)` (V)

**Perplexity definition**:

> The surgical removal of endometriotic tissue by cutting it out at its margins (excision), as opposed to ablation or fulguration which destroys lesions superficially. Excision is considered the gold-standard surgical approach for endometriosis because it removes all lesion layers, reduces recurrence rates, and provides histologic confirmation of the diagnosis. In NaProTECHNOLOGY and RRM, excision is performed using near-contact laparoscopy and NARPS/PEARS principles to minimize adhesion formation while achieving complete lesion removal.

- **[P0] hallucinated_citation**
  - **Claim**: Pundir J et al. (2017). Laparoscopic excision versus ablation for endometriosis-associated pain. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/28285939/
  - **Evidence**: PMID 28285939 resolves to: 'Restenosis of Coronary Bioresorbable Vascular Scaffolds.' Alfonso F, Garcia-Guimaraes M. Rev Esp Cardiol (Engl Ed) 70, 2017 Jul. NOT a Pundir endometriosis paper. The real Pundir paper is PMID 28456617 ('Laparoscopic Excision Versus Ablation for Endometriosis-associated Pain: An Updated Systematic Review and Meta-analysis,' J Minim Invasive Gynecol, 2017).
  - **Source**: `curl_pmid:28285939+europepmc`
  - **Fix**: Replace PMID 28285939 with PMID 28456617 (verified real Pundir 2017 paper). Cite as: Pundir J, Omanwa K, Kovoor E, Pundir V, Lancaster G, Barton-Smith P. Laparoscopic Excision Versus Ablation for Endometriosis-associated Pain. J Minim Invasive Gynecol 2017.

### row 95 — `Fallopian Tube Anatomy Reference` (VI)

**Perplexity definition**:

> The fallopian tube is a paired muscular duct connecting each ovary to the uterine cavity, consisting of four segments: the interstitial (intramural) portion within the uterine wall, the isthmus (narrow proximal segment), the ampulla (wider mid-segment where fertilization typically occurs), and the infundibulum/fimbriae (finger-like projections that capture the oocyte). Ciliated epithelium and peristaltic smooth muscle contractions transport the oocyte toward the uterus. Tubal patency and normal tubal function are prerequisites for natural conception.

- **[P0] hallucinated_citation**
  - **Claim**: Horne AW, Critchley HOD (2007). The effect of uterine fibroids on embryo implantation. Semin Reprod Med. https://pubmed.ncbi.nlm.nih.gov/17960527/
  - **Evidence**: PMID 17960527 resolves to 'HOX genes in implantation.' Semin Reprod Med 2007 Nov — irrelevant to fallopian tube anatomy claim AND title/authors wrong
  - **Source**: `curl_pmid:17960527`
  - **Fix**: Drop the Horne/Critchley citation — it is unrelated to fallopian tube anatomy. Replace with anatomy reference (Moore Clinically Oriented Anatomy already cited is sufficient)

### row 97 — `Fallopian Tube Recanalization (Cannulation)` (V)

**Perplexity definition**:

> Fallopian tube recanalization (cannulation or selective salpingography) is a minimally invasive fluoroscopic or hysteroscopic procedure used to clear proximal tubal occlusion caused by debris, mucus, or mild adhesion. A catheter is threaded through the cervix and uterine cornua under radiologic guidance. It is the first-line intervention for confirmed proximal tubal obstruction before considering surgical repair or IVF. In RRM, restoring natural tubal function is prioritized over bypassing it.

- **[P0] hallucinated_citation**
  - **Claim**: Papaioannou S et al. (2004). Fallopian tube recanalization and associated success rates. Arch Gynecol Obstet. https://pubmed.ncbi.nlm.nih.gov/15614469/
  - **Evidence**: PMID 15614469: 'cannot get document summary' (PubMed esummary returns error; Europe PMC 0 hits). The PMID does not resolve. Real Papaioannou 2004 papers on tubal recanalization are PMID 14998940 ('A hypothesis for the pathogenesis and natural history of proximal tubal blockage,' Hum Reprod) and PMID 15232487 ('The role of selective salpingography and tubal catheterization in the management of the 
  - **Source**: `curl_pmid:15614469+europepmc`
  - **Fix**: Replace with PMID 15232487 (Papaioannou S, Afnan M, Sharif K. The role of selective salpingography and tubal catheterization in the management of the infertile couple. Curr Opin Obstet Gynecol 2004).
- **[P0] hallucinated_citation**
  - **Claim**: Thurmond AS (1991). Selective salpingography and fallopian tube recanalization. AJR Am J Roentgenol. https://pubmed.ncbi.nlm.nih.gov/1951072/
  - **Evidence**: PMID 1951072 resolves to: 'Value and limitations of two-dimensional echocardiography in predicting myocardial infarct size.' Shen WK, Khandheria BK, Edwards WD. Am J Cardiol 68, 1991 Nov 1. NOT a Thurmond paper. The real Thurmond 1991 paper is PMID 1898568 ('Selective salpingography and fallopian tube recanalization,' AJR Am J Roentgenol).
  - **Source**: `curl_pmid:1951072+europepmc`
  - **Fix**: Replace PMID 1951072 with PMID 1898568 (verified real Thurmond 1991 paper with the cited title and journal).

### row 99 — `FEMM (Fertility Education and Medical Management)` (II)

**Perplexity definition**:

> FEMM (Fertility Education and Medical Management) is a women's health model that integrates fertility awareness charting with evidence-based medical management of gynecologic and reproductive conditions. FEMM is based on the science of the menstrual cycle, using biomarkers (cervical mucus, LH, estrogen) to identify the hormonal phase of each cycle. Unlike NFP methods focused primarily on family planning, FEMM emphasizes biomarker education as a health-monitoring tool and pairs it with a structured medical protocol for treating underlying cycle disorders.

- **[P0] hallucinated_citation**
  - **Claim**: Vigil P et al. (2017). Physiological basis for fertility charting. Linacre Q. https://pubmed.ncbi.nlm.nih.gov/28299975/
  - **Evidence**: Metabolomics differentiates metabolic syndrome (Zhong 2017 Exp Biol Med) — NOT Vigil fertility charting
  - **Source**: `curl_pmid:28299975`
  - **Fix**: Drop PMID. Pilar Vigil has published on FABM/FEMM topics in Linacre Q (e.g., 2017 paper on the menstrual cycle as the 5th vital sign) — find correct PMID via PubMed search "Vigil Linacre Quarterly".

### row 100 — `FEMM Education Levels (Teen, Adult, Medical)` (III)

**Perplexity definition**:

> FEMM offers three tiered education tracks: the Teen program provides adolescent menstrual health education using biomarker-based cycle awareness for health literacy; the Adult program teaches women to track and interpret menstrual cycle biomarkers for general reproductive health monitoring; and the Medical Management track pairs biomarker charting with physician or advanced practice clinician oversight to diagnose and treat cycle disorders including luteal phase deficiency, PCOS, and anovulation within a restorative framework.

- **[P0] hallucinated_citation**
  - **Claim**: Vigil P et al. (2017). Physiological basis for fertility charting. Linacre Q. https://pubmed.ncbi.nlm.nih.gov/28299975/
  - **Evidence**: Same as row 101: PMID 28299975 is Zhong et al. 2017 metabolomics paper, NOT Vigil. Real Vigil 2017 Linacre paper is PMID 29255329 'Ovulation, a sign of health'.
  - **Source**: `curl_pmid:28299975`
  - **Fix**: Replace with PMID 29255329 Vigil et al. 'Ovulation, a sign of health' Linacre Q 2017.
- **[P0] hallucinated_citation**
  - **Claim**: Fehring RJ, Schlidt AM (2001). Trends in contraceptive use among Catholics in the United States. Linacre Q. https://pubmed.ncbi.nlm.nih.gov/11453476/
  - **Evidence**: PMID 11453476 resolves to: Billinghurst RC et al. (2001). 'Use of an antineoepitope antibody for identification of type-II collagen degradation in equine articular cartilage.' American journal of veterinary research. UNRELATED — equine veterinary paper, not Fehring/Schlidt. Linacre Q was not PubMed-indexed in 2001, so this PMID cannot be real for that source.
  - **Source**: `curl_pmid:11453476`
  - **Fix**: Drop the citation — Linacre Q 2001 articles are not indexed in PubMed. If Fehring/Schlidt 2001 trends paper exists, cite by journal+volume+pages without a PMID.

### row 101 — `FEMM Medical Management` (III)

**Perplexity definition**:

> FEMM Medical Management is a physician-directed component of the FEMM model in which women presenting with reproductive health concerns — including infertility, cycle disorders, premenstrual syndrome, and recurrent pregnancy loss — receive a structured diagnostic and treatment plan based on their charted biomarker data. Providers interpret the FEMM chart to guide cycle-timed hormone testing and targeted treatment, operating within a restorative reproductive medicine framework that addresses underlying causes rather than suppressing symptoms.

- **[P0] hallucinated_citation**
  - **Claim**: Vigil P et al. (2017). Physiological basis for fertility charting. Linacre Q. https://pubmed.ncbi.nlm.nih.gov/28299975/
  - **Evidence**: PMID 28299975 resolves to: Zhong F, Xu M, Bruno RS (2017). 'Targeted High Performance Liquid Chromatography Tandem Mass Spectrometry-based Metabolomics differentiates metabolic syn...'. Journal: Experimental biology and medicine. UNRELATED to Vigil or fertility charting. Closest real Vigil/Linacre 2017 paper: PMID 29255329 'Ovulation, a sign of health' — different title.
  - **Source**: `curl_pmid:28299975 + pubmed_search:Vigil+Linacre`
  - **Fix**: Replace with: Vigil P, Lyon C, Flores B, Rioseco H, Serrano F. 'Ovulation, a sign of health.' Linacre Q. 2017;84(4):343-355. PMID 29255329.

### row 104 — `Fertilitas Study` (III)

**Perplexity definition**:

> The Fertilitas Study (formally the FERTILITAS registry) is a multicenter observational study of restorative reproductive medicine outcomes initiated by the IIRRM. It collects prospective clinical data from RRM practitioners across multiple countries on fertility, miscarriage, and obstetric outcomes in patients managed with fertility awareness-based charting and targeted medical treatment. The study aims to generate peer-reviewed evidence on RRM effectiveness comparable to published NaProTECHNOLOGY outcome data.

- **[P0] drift**
  - **Claim**: The Fertilitas Study (formally the FERTILITAS registry) is a multicenter observational study of restorative reproductive medicine outcomes initiated by the IIRRM
  - **Evidence**: Natural procreative technology (NaProTechnology) for infertility: take-home baby rate and clinical outcomes in a 5-year single-center cohort of 1,310 couples (article -- Sánchez-Méndez JI et al., 2025) ... Frontiers in Reproductive Health
  - **Source**: `col_AE_rrm_canonical_match + col_AJ_primary_def_v2 + CrossRef DOI 10.3389/frph.2025.1696679`
  - **Fix**: Replace with v2 text: 'The Fertilitas Study is a 5-year retrospective cohort study of 1,310 infertile couples treated with NaProTECHNOLOGY at a specialized reproductive medicine clinic in Spain, published in 2025 in Frontiers in Reproductive Health.' Single-center, retrospective, Spanish; NOT IIRRM multicenter registry.
- **[P0] hallucinated_citation**
  - **Claim**: Boyle PC et al. (2022). Restorative reproductive medicine outcomes: a registry-based prospective study design. J Reprod Med.
  - **Evidence**: PubMed search 'Boyle Fertilitas registry restorative reproductive' returned 0 hits. CrossRef search for 'Boyle restorative reproductive medicine outcomes registry 2022' returned only unrelated 2025 JRRM papers. No paper matching this title/year/journal exists.
  - **Source**: `curl PubMed eutils + curl CrossRef API`
  - **Fix**: Drop the Boyle 2022 citation entirely. Replace with the actual Fertilitas paper: Sánchez-Méndez JI et al. 2025, Frontiers in Reproductive Health, DOI 10.3389/frph.2025.1696679.

### row 106 — `Fertility Awareness-Based Methods (FABMs)` (II)

**Perplexity definition**:

> Fertility Awareness-Based Methods (FABMs) are a category of family planning and women's health practices that identify the fertile window of the menstrual cycle through observation of biological markers including cervical mucus, basal body temperature, urinary LH, and/or cycle day. FABMs include the Creighton Model FertilityCare System, Billings Ovulation Method, Symptothermal Method, Marquette Method, and others. In the RRM context, FABMs serve as the diagnostic foundation for identifying cycle disorders, not merely as contraceptive tools.

- **[P0] hallucinated_citation**
  - **Claim**: Manhart MD et al. (2013). Fertility awareness-based methods: another option for family planning. J Midwifery Womens Health. https://pubmed.ncbi.nlm.nih.gov/23651890/
  - **Evidence**: Surgical site infections, INICC report (Rosenthal 2013 Infect Control Hosp Epidemiol) — NOT Manhart FABM
  - **Source**: `curl_pmid:23651890`
  - **Fix**: Drop the PMID URL; if Manhart 2013 JMWH citation is retained, find correct PMID via PubMed (search "Manhart fertility awareness-based methods" yields no result in our verification; flag for Brian to confirm legitimate ref or remove).
- **[P0] hallucinated_citation**
  - **Claim**: Smoley BA, Robinson CM (2012). Natural family planning. Am Fam Physician. https://pubmed.ncbi.nlm.nih.gov/23062052/
  - **Evidence**: Evaluation of asymptomatic atrial fibrillation (Newell 2012 Am Fam Physician) — NOT Smoley NFP
  - **Source**: `curl_pmid:23062052`
  - **Fix**: Drop PMID URL. Smoley 2012 Am Fam Physician article DOES exist (PMID 23062043 area) — recheck with correct PMID or drop reference.
- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB, Mikolajczyk RT (2002). Cumulative pregnancy rates with fertility-awareness methods. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/12413971/
  - **Evidence**: Microtensile measurements of single trabeculae stiffness in human femur (Bini 2002 J Biomech) — NOT Stanford cumulative pregnancy rates
  - **Source**: `curl_pmid:12413971`
  - **Fix**: Drop PMID. The real Stanford 2002 Obstet Gynecol paper "Timing intercourse to achieve pregnancy: current evidence" is PMID 12468181 (verified via PubMed search), but title differs from Perplexity claim — flag for Brian.

### row 107 — `Fertility Charting` (II)

**Perplexity definition**:

> Fertility charting is the prospective, day-by-day recording of biological markers of the menstrual cycle — primarily cervical mucus quality and appearance, cycle bleeding patterns, and supplementary signs such as basal body temperature or urinary hormone levels — on a standardized chart. In RRM, the chart is a medical document providing a longitudinal record of ovulation, luteal phase length, mucus quantity and quality, and cycle irregularities that guide cycle-timed diagnostic testing and monitor treatment response.

- **[P0] hallucinated_citation**
  - **Claim**: Hilgers TW et al. (1978). Natural family planning I: the peak symptom and estimated time of ovulation. Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/683622/
  - **Evidence**: Amniotic fluid copper and zinc concentrations in human pregnancy (Chez 1978 Obstet Gynecol) — NOT Hilgers peak symptom
  - **Source**: `curl_pmid:683622`
  - **Fix**: Replace PMID 683622 with PMID 724176 (verified real Hilgers 1978 OBGYN "Natural family planning. I. The peak symptom and estimated time of ovulation")
- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB et al. (2003). Timing intercourse to achieve pregnancy. Am Fam Physician. https://pubmed.ncbi.nlm.nih.gov/14609883/
  - **Evidence**: Efficacy of olanzapine in bipolar I depression (Tohen 2003 Arch Gen Psychiatry) — NOT Stanford timing intercourse
  - **Source**: `curl_pmid:14609883`
  - **Fix**: Replace PMID. Real ref is likely Stanford 2002 Obstet Gynecol 100:1333-41 PMID 12468181 ("Timing intercourse to achieve pregnancy: current evidence"); the journal+year cited (Am Fam Physician 2003) likely also exists but was not Stanford's.
- **[P0] hallucinated_citation**
  - **Claim**: Fehring RJ (2005). New low- and high-tech calendar methods of family planning. J Midwifery Womens Health. https://pubmed.ncbi.nlm.nih.gov/15885733/
  - **Evidence**: Cytogenetic damage in lymphocytes — small cell lung cancer therapy (Padjas 2005 Toxicol Appl Pharmacol) — NOT Fehring new calendar methods
  - **Source**: `curl_pmid:15885733`
  - **Fix**: Drop PMID; Fehring 2005 paper exists (PubMed search returns separate hits) — flag for Brian to substitute correct PMID.

### row 108 — `Fertility-Focused Intercourse (FFI)` (II)

**Perplexity definition**:

> Fertility-Focused Intercourse (FFI) is the practice of timing sexual intercourse to coincide with the identified fertile window of the menstrual cycle in order to maximize conception probability. In the RRM framework, the fertile window is identified from the couple's fertility chart — specifically days of fertile-type cervical mucus and the day of confirmed follicle rupture on ultrasound when available. FFI is distinguished from intercourse timed solely by calendar or OPK devices without individualized charting.

- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB et al. (2003). Timing intercourse to achieve pregnancy. Am Fam Physician. https://pubmed.ncbi.nlm.nih.gov/14609883/
  - **Evidence**: Efficacy of olanzapine in bipolar I depression (Tohen 2003 Arch Gen Psychiatry) — NOT Stanford timing intercourse
  - **Source**: `curl_pmid:14609883`
  - **Fix**: Drop PMID 14609883. Real Stanford 2002 Obstet Gynecol 100:1333-1341 ("Timing intercourse to achieve pregnancy: current evidence") is PMID 12468181 (verified via PubMed); journal+year cited differs.

### row 110 — `FertilityCare Practice` (VII)

**Perplexity definition**:

> A FertilityCare Practice is a clinical or educational setting in which a trained FertilityCare Practitioner (FCP) provides instruction and follow-up in the Creighton Model FertilityCare System (CrMS) to individuals and couples. The practice may be embedded in a healthcare organization or operate independently. It serves as the entry point for patients into NaProTECHNOLOGY or other FABM-based medical management by establishing accurate fertility charting before diagnostic testing begins.

- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB (2003). Creighton Model in clinical practice. Am Fam Physician. https://pubmed.ncbi.nlm.nih.gov/12762960/
  - **Evidence**: PMID 12762960 actually resolves to: TITLE: 'Maternal factors that determine neonatal size and body fat.' AUTHORS: Catalano PM, Kirwan JP. JOURNAL: Curr Diab Rep. YEAR: 2001 Aug. Completely unrelated to Stanford or Creighton Model.
  - **Source**: `curl_pmid:12762960`
  - **Fix**: Replace with real Stanford citation. The well-known Stanford reference is 'Use of natural family planning to achieve pregnancy' Stanford JB, White GL, Hatasaka H, Obstet Gynecol 2002;100:1333-41 (PMID 12468181) — verify before publication. Or use Tham 2012 which IS in col AE.

### row 112 — `Follicle Development` (IV)

**Perplexity definition**:

> Follicle development refers to the sequential maturation of an ovarian follicle from a primordial follicle through primary, secondary, and antral stages to the dominant preovulatory (Graafian) follicle. Under FSH stimulation in the follicular phase, one dominant follicle typically grows to 18–24 mm and undergoes LH surge-triggered rupture (ovulation). In RRM, follicle development is monitored via serial transvaginal ultrasound (follicle maturation study) to confirm follicle growth, maturity, and complete rupture.

- **[P0] hallucinated_citation**
  - **Claim**: Baerwald AR et al. (2012). Ovarian follicular waves: a comprehensive review. Reproduction. https://pubmed.ncbi.nlm.nih.gov/22565572/
  - **Evidence**: PMID 22565572 esummary returns: 'Clinical reasoning: an 8-year-old girl with multifocal brain lesions and cerebral edema.' Seto ES, 2012, Neurology. Real Baerwald 2012 review = PMID 22068695 ('Ovarian antral folliculogenesis during the human menstrual cycle: a review', Hum Reprod Update - NOT 'Reproduction').
  - **Source**: `curl_pmid:22565572 + europepmc_search`
  - **Fix**: Replace with real PMID 22068695. Also correct journal from 'Reproduction' to 'Human Reproduction Update'.
- **[P0] hallucinated_citation**
  - **Claim**: Hillier SG (2001). Gonadotropic control of ovarian follicular growth and development. Mol Cell Endocrinol. https://pubmed.ncbi.nlm.nih.gov/11325516/
  - **Evidence**: PMID 11325516 esummary returns: 'Metabolic and functional studies on isolated islets in a new rat model of type 2 diabetes.' Novelli M, 2001, Mol Cell Endocrinol (same journal/year as claimed, but unrelated topic). Real Hillier 2001 paper = PMID 11420129 (Mol Cell Endocrinol).
  - **Source**: `curl_pmid:11325516 + europepmc_search`
  - **Fix**: Replace fabricated PMID 11325516 with real PMID 11420129.

### row 113 — `Follicle Maturation Study (Follicle Tracking / Follicular Ultrasound Series)` (IV)

**Perplexity definition**:

> A Follicle Maturation Study (FMS) is a serial transvaginal ultrasound protocol in which the dominant follicle is measured on multiple days around expected ovulation. In NaProTECHNOLOGY and NeoFertility, ultrasounds are timed to the fertility chart to document follicle size, presence of the cumulus oophorus, and whether complete follicle collapse (rupture) occurs. This allows classification of ovulation disorders including LUF syndrome, partial rupture syndrome, delayed rupture syndrome, empty follicle syndrome, and immature follicle syndrome.

- **[P0] hallucinated_citation**
  - **Claim**: Chui DKC et al. (1997). Ultrasound evidence of luteinized unruptured follicle syndrome. Br J Obstet Gynaecol. https://pubmed.ncbi.nlm.nih.gov/9051789/
  - **Evidence**: PMID 9051789 esummary returns: 'The effect of systemic and central nitric oxide administration on milk availability in lactating rats.' Okere CO, 1996, Neuroreport. Europe PMC search for AUTH:'Chui D' + 'luteinized' returns 0 hits.
  - **Source**: `curl_pmid:9051789 + europepmc_search`
  - **Fix**: Drop the Chui 1997 citation. Replace with the canonical LUF ultrasound reference Hilgers cites: Coetsier T, Dhont M, 'Complete and partial luteinization unruptured follicle syndrome after ovarian stimulation with clomiphene citrate/human menopausal gonadotrophin/human chorionic gonadotrophin', Hum Reprod 1996 PMID 8671310, or Marik J, Hulka J, 'Luteinized unruptured follicle syndrome: a subtle cause of infertility', Fertil Steril 1978 PMID 729849.

### row 114 — `Follicle Stimulating Hormone` (?)

**Perplexity definition**:

> Follicle-Stimulating Hormone (FSH) is a glycoprotein gonadotropin secreted by the anterior pituitary in response to hypothalamic GnRH. In women, FSH drives follicular recruitment and maturation during the follicular phase and stimulates granulosa cell production of estradiol. An elevated basal FSH (day 2–4, >10 IU/L) is a marker of diminished ovarian reserve. In men, FSH stimulates Sertoli cells and spermatogenesis. In RRM, cycle-timed FSH measurement is part of the baseline hormonal evaluation.

- **[P0] hallucinated_citation**
  - **Claim**: Broekmans FJ et al. (2006). Ovarian reserve tests. Endocr Rev. https://pubmed.ncbi.nlm.nih.gov/17071849/
  - **Evidence**: PMID 17071849 resolves to oyster microsatellites (Carlsson 2006 J Hered), not Broekmans. The Broekmans 2006 paper is actually in Hum Reprod Update (PMID 16891297), not Endocr Rev.
  - **Source**: `curl_pmid:17071849`
  - **Fix**: Replace with PMID 16891297 (Broekmans FJ, Kwee J, Hendriks DJ. A systematic review of tests predicting ovarian reserve and IVF outcome. Hum Reprod Update. 2006;12(6):685-718). Journal name also wrong (Endocr Rev vs Hum Reprod Update).

### row 115 — `Follicle Stimulation / Ovulation Induction` (VII)

**Perplexity definition**:

> Follicle stimulation (ovulation induction) involves the administration of medications to promote development of one or more ovarian follicles in women who are anovulatory, oligo-ovulatory, or have suboptimal follicle maturation. First-line agents include letrozole (aromatase inhibitor) and clomiphene citrate; injectable FSH/LH gonadotropins are used for more resistant cases. In RRM, stimulation is low-dose and cycle-monitored via serial ultrasound to achieve single dominant follicle development and confirm complete rupture, avoiding hyperstimulation and multiple gestation.

- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2014). Letrozole versus clomiphene for infertility in PCOS. N Engl J Med. https://pubmed.ncbi.nlm.nih.gov/24926259/
  - **Evidence**: PMID 24926259 actually resolves to: TITLE: 'Occurrence and Recurrence of Hepatocellular Carcinoma Were Not Rare Events during Phlebotomy in Older Hepatitis C Virus-Infected Patients.' AUTHORS: Kanda T et al. JOURNAL: Case Rep Oncol. YEAR: 2014 May. Completely unrelated.
  - **Source**: `curl_pmid:24926259`
  - **Fix**: Replace PMID with the REAL Legro NEJM paper: PMID 25006718 — Legro RS, Brzyski RG, Diamond MP et al., 'Letrozole versus clomiphene for infertility in the polycystic ovary syndrome,' N Engl J Med, 2014 Jul 10 (curl-verified via esearch).
- **[P0] hallucinated_citation**
  - **Claim**: Diamond MP, Wentz AC (2001). Ovulation induction with exogenous gonadotropins. Obstet Gynecol Clin North Am. https://pubmed.ncbi.nlm.nih.gov/11202943/
  - **Evidence**: PMID 11202943 actually resolves to: TITLE: 'Advance directives. Good education prepares people for death.' AUTHORS: Hardie R, Flood J, Frankland S. JOURNAL: BMJ. YEAR: 2000 Sep 16. Completely unrelated to Diamond/Wentz/ovulation induction.
  - **Source**: `curl_pmid:11202943`
  - **Fix**: Either replace with a verified real citation on gonadotropin ovulation induction (Diamond MP + Wentz AC pairing may not exist as published — Wentz is real but pairing unverified) or drop and cite Balen 2016 RCOG GTG 73 (already in K).

### row 116 — `Follicle-Stimulating Hormone (FSH)` (VI)

**Perplexity definition**:

> Follicle-Stimulating Hormone (FSH) is a glycoprotein gonadotropin secreted by the anterior pituitary in response to hypothalamic GnRH. In women, FSH drives follicular recruitment and maturation during the follicular phase and stimulates granulosa cell production of estradiol. An elevated basal FSH (day 2–4, >10 IU/L) is a marker of diminished ovarian reserve. In men, FSH stimulates Sertoli cells and spermatogenesis. In RRM, cycle-timed FSH measurement is part of the baseline hormonal evaluation.

- **[P0] hallucinated_citation**
  - **Claim**: Broekmans FJ et al. (2006). Ovarian reserve tests. Endocr Rev. https://pubmed.ncbi.nlm.nih.gov/17071849/
  - **Evidence**: PMID 17071849 esummary: title="Wild and aquaculture populations of the eastern oyster compared using microsatellites.", source="J Hered", date="2006 Nov-Dec", first_author="Carlsson J"
  - **Source**: `curl_pmid:17071849`
  - **Fix**: Drop the fake PMID. Real Broekmans review is PMID 19589949 (Ovarian aging: mechanisms and clinical consequences, Endocr Rev 30:465-93, 2009 Aug). Adjust year 2006 -> 2009.

### row 117 — `Follicular Deficiency` (VI)

**Perplexity definition**:

> Follicular Deficiency is a term used in NaProTECHNOLOGY (Hilgers classification) to describe a follicular phase characterized by immature or suboptimal follicle development reflected in reduced peak estradiol levels, shortened or deficient mucus cycles, and small dominant follicle size (<18 mm) on ultrasound. Follicular deficiency often co-exists with luteal phase deficiency as both reflect inadequate gonadotropin support or ovarian response. Treatment may include low-dose FSH stimulation (letrozole, gonadotropins) and nutritional optimization.

- **[P0] hallucinated_citation**
  - **Claim**: Kazer RR (1994). Luteal phase deficiency. Curr Opin Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/7826148/
  - **Evidence**: PMID 7826148 esummary: title="Kinetics of endotoxin and tumor necrosis factor appearance in portal and systemic circulation after hemorrhagic shock in rats.", source="Ann Surg", date="1995 Jan", first_author="Jiang J"
  - **Source**: `curl_pmid:7826148`
  - **Fix**: FABRICATED. PubMed search for "Kazer luteal phase deficiency Curr Opin" returns no results. Drop this citation.

### row 119 — `Frozen Embryo Transfer (FET)` (?)

**Perplexity definition**:

> Frozen Embryo Transfer (FET) is the procedure in which cryopreserved embryos — stored from a prior IVF cycle — are thawed and transferred to the uterus in a subsequent cycle. FET is increasingly preferred over fresh embryo transfer in IVF because it allows time for OHSS to resolve, permits genetic testing (PGT-A) results, and enables optimized endometrial preparation. Endometrial preparation for FET uses either a natural/monitoring protocol, medicated protocol (estradiol + progesterone), or a modified natural protocol. FET is not an RRM procedure per se, but RRM practitioners may encounter it ...

- **[P0] hallucinated_citation**
  - **Claim**: Roque M et al. (2019). Freeze-all policy versus fresh embryo transfer with GnRH antagonist: systematic review. Ultrasound Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/30246384/
  - **Evidence**: PMID 30246384 resolves to: 'Commentary on Grebely et al. (2019): Ending HCV epidemics among people who inject drugs.' Addiction 114 2019 Jan. Author: Des Jarlais DC.
  - **Source**: `curl_pmid:30246384`
  - **Fix**: Verify the Roque 2019 paper exists at a different PMID. Mark as unverified and ask author to supply correct citation.

### row 120 — `Fulguration / Ablation / Cauterization (Endometriosis)` (V)

**Perplexity definition**:

> Fulguration, ablation, and cauterization are surgical techniques that destroy endometriotic lesions by heat (electrocautery, laser, or plasma energy) rather than excising them. These approaches are considered less definitive than excision surgery because they treat only the lesion surface without confirming complete depth, leaving deep infiltrating endometriosis undertreated. Recurrence rates after ablation are higher than after excision. In NaProTECHNOLOGY and RRM, excision is strongly preferred over ablation/fulguration for endometriosis treatment.

- **[P0] hallucinated_citation**
  - **Claim**: Pundir J et al. (2017). Laparoscopic excision versus ablation for endometriosis pain. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/28285939/
  - **Evidence**: PMID 28285939 resolves to: 'Restenosis of Coronary Bioresorbable Vascular Scaffolds.' Rev Esp Cardiol 2017. Real Pundir paper is PMID 28456617.
  - **Source**: `curl_pmid:28285939+europepmc`
  - **Fix**: Replace PMID 28285939 with PMID 28456617.
- **[P0] hallucinated_citation**
  - **Claim**: Duffy JM et al. (2014). Laparoscopic excision versus ablation (Cochrane Review). https://pubmed.ncbi.nlm.nih.gov/24532014/
  - **Evidence**: PMID 24532014: 'cannot get document summary' (PubMed error; Europe PMC 0 hits). The PMID does not resolve. There IS a real Duffy JM Cochrane review on laparoscopic surgery for endometriosis (likely PMID 24696265, Duffy JM et al., Laparoscopic surgery for endometriosis, Cochrane 2014) but the cited PMID is fabricated.
  - **Source**: `curl_pmid:24532014+europepmc`
  - **Fix**: Verify with the real Duffy 2014 Cochrane PMID (search Cochrane) and replace 24532014.

### row 121 — `Functional and Nutritional Medicine` (VII)

**Perplexity definition**:

> Functional and Nutritional Medicine is an integrative clinical approach that identifies and addresses root-cause physiological imbalances — including nutritional deficiencies, mitochondrial dysfunction, gut microbiome dysbiosis, metabolic dysfunction, and systemic inflammation — as drivers of reproductive dysfunction. In RRM, nutritional medicine assessment encompasses vitamin D, B12, folate, iron, zinc, omega-3 fatty acids, and antioxidant capacity, each with direct roles in oocyte quality, sperm function, implantation, and pregnancy maintenance.

- **[P0] hallucinated_citation**
  - **Claim**: Marshall NE et al. (2022). The importance of nutrition in pregnancy and lactation. Am J Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/34536394/
  - **Evidence**: PMID 34536394 actually resolves to: TITLE: 'A social dimension for brain health: the mounting pressure.' AUTHORS: The Lancet Neurology (editorial). JOURNAL: Lancet Neurol. YEAR: 2021 Oct. Completely unrelated to Marshall or nutrition in pregnancy.
  - **Source**: `curl_pmid:34536394`
  - **Fix**: Replace PMID with the REAL Marshall 2022 paper: PMID 34968458 — Marshall NE, Abrams B, Barbour LA, 'The importance of nutrition in pregnancy and lactation: lifelong consequences', Am J Obstet Gynecol, 2022 May (curl-verified).

### row 122 — `GnRH (Gonadotropin-Releasing Hormone)` (?)

**Perplexity definition**:

> Gonadotropin-releasing hormone (GnRH) is a decapeptide released in a pulsatile fashion from the hypothalamic arcuate nucleus, acting on the anterior pituitary to stimulate the synthesis and release of LH and FSH. Pulsatile GnRH is essential for normal gonadotropin secretion; loss of pulsatility (hypothalamic amenorrhea, functional hypothalamic anovulation) causes central hypogonadotropic hypogonadism. In ART, GnRH agonists (downregulation) and GnRH antagonists (rapid suppression) are used to control the LH surge. In RRM, GnRH pulsatility is restored through treatment of underlying causes (weig...

- **[P0] hallucinated_citation**
  - **Claim**: Pitteloud N et al. (2010). Pulsatile GnRH therapy in hypogonadotropic hypogonadism. Nat Rev Endocrinol. https://pubmed.ncbi.nlm.nih.gov/20173757/
  - **Evidence**: PMID 20173757 resolves to: 'A mutant of HBx (HBxDelta127) promotes hepatoma cell growth via sterol regulatory element binding protein 1c involving 5...' Acta Pharmacol Sin 31 2010 Mar. Wang Q et al.
  - **Source**: `curl_pmid:20173757`
  - **Fix**: PMID is hallucinated. Verify Pitteloud Nat Rev Endocrinol exists; if not, remove or replace with verifiable source on pulsatile GnRH (e.g., Marshall JC et al., or Filicori M et al.).

### row 126 — `HCG Trigger (Human Chorionic Gonadotropin Trigger)` (III)

**Perplexity definition**:

> An HCG trigger is an injection of human chorionic gonadotropin (hCG) administered to mimic the endogenous LH surge and trigger final oocyte maturation and follicle rupture approximately 36–40 hours after injection. In RRM and NeoFertility, the hCG trigger is used when a follicle maturation study confirms a dominant follicle has reached >=18 mm but spontaneous rupture has not occurred or is delayed (e.g., LUF syndrome, delayed rupture syndrome). Low-dose hCG (2,000–5,000 IU) is preferred to minimize ovarian hyperstimulation risk.

- **[P0] hallucinated_citation**
  - **Claim**: Nakamura Y et al. (1997). Human chorionic gonadotropin trigger and luteinized unruptured follicle. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/9053666/
  - **Evidence**: PMID 9053666 resolves to: Lykken K, Hansson B (1997). '[Help the patient with asthma to life-long smoking cessation].' Lakartidningen (Swedish medical journal). COMPLETELY UNRELATED — asthma smoking-cessation paper in Swedish.
  - **Source**: `curl_pmid:9053666`
  - **Fix**: Drop the citation entirely. If a hCG trigger + LUF source is needed, find a real PMID via targeted PubMed search and curl-verify before insertion (e.g., Killick S 1989 or Coetsier T 1996 LUFS literature).

### row 128 — `Heteromolecular Artimones (HMA)` (III)

**Perplexity definition**:

> Heteromolecular Artimones (HMA) is a term coined by Dr. Thomas Hilgers to describe synthetic hormone compounds that mimic but differ structurally from naturally occurring hormones — 'heteromolecular' (different molecule) and 'artimone' (artificial hormone). Examples include synthetic progestins (medroxyprogesterone acetate, norethindrone), synthetic estrogens (ethinyl estradiol), and conjugated equine estrogens. Hilgers argues HMAs are not biologically equivalent to isomolecular hormones (IMH) and interact differently with receptors, producing distinct physiologic effects and risk profiles.

- **[P0] hallucinated_citation**
  - **Claim**: Stanczyk FZ et al. (2013). Progestogens used in postmenopausal hormone therapy. Endocr Rev. https://pubmed.ncbi.nlm.nih.gov/23360717/
  - **Evidence**: Same fabricated PMID as row 156. PMID 23360717 is Nitsch et al. 2013 BMJ renal paper, NOT Stanczyk. Real Stanczyk PMID is 23238854.
  - **Source**: `curl_pmid:23360717`
  - **Fix**: Replace with PMID 23238854.
- **[P0] hallucinated_citation**
  - **Claim**: Sitruk-Ware R (2004). Pharmacological profile of progestins. Maturitas. https://pubmed.ncbi.nlm.nih.gov/15325078/
  - **Evidence**: PMID 15325078 resolves to: Zierenberg K, Raue R, Nieper H (2004). 'Generation of serotype 1/serotype 2 reassortant viruses of the infectious bursal disease virus.' Virus Research. UNRELATED — virology paper. The REAL Sitruk-Ware 'Pharmacological profile of progestins' Maturitas paper is PMID 15063480 (2004 — title exact match).
  - **Source**: `curl_pmid:15325078 + pubmed_search:Sitruk-Ware`
  - **Fix**: Replace PMID 15325078 with PMID 15063480 (Sitruk-Ware R. 'Pharmacological profile of progestins.' Maturitas. 2004;47(4):277-83).

### row 129 — `Holistic Approach` (I)

**Perplexity definition**:

> The holistic approach in reproductive medicine refers to a patient-care philosophy that addresses all dimensions of health — physical, psychological, social, spiritual, and environmental — in the diagnosis and treatment of fertility concerns. In RRM, this includes evaluating both partners as a unit, identifying nutritional and lifestyle contributors, considering psychological stress and trauma, addressing systemic conditions (thyroid, adrenal, immune), and supporting the couple through the emotional dimensions of infertility and pregnancy loss.

- **[P0] hallucinated_citation**
  - **Claim**: Domar AD et al. (2000). The impact of group psychological interventions on pregnancy rates in infertile women. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/10785219/
  - **Evidence**: PMID 10785219 actually resolves to 'Noninvasive assessment of glucose and pyruvate uptake by human embryos after intracytoplasmic sperm injection and during the formation of pronuclei' by Devreker F et al., Fertil Steril 2000;73:947-54 — completely unrelated to Domar's psychological-intervention work. The REAL Domar paper is PMID 10731544 'Impact of group psychological interventions on pregnancy r
  - **Source**: `curl_pmid:10785219 vs curl_pmid:10731544`
  - **Fix**: Correct PMID from 10785219 to 10731544. The Domar 2000 paper IS real, just attached to the wrong PubMed ID. URL should be https://pubmed.ncbi.nlm.nih.gov/10731544/

### row 130 — `Hormonal Abnormalities` (VI)

**Perplexity definition**:

> Hormonal abnormalities in reproductive medicine refer to deviations from normal hormone levels or patterns across the menstrual cycle — including luteal phase deficiency (low progesterone), estrogen deficiency or excess, elevated FSH, low AMH, hyperprolactinemia, thyroid dysfunction, insulin resistance/hyperinsulinemia, and androgen imbalance. In RRM, hormonal abnormalities are identified through cycle-timed testing rather than random blood draws, enabling detection of subtle deficiencies that standard testing misses.

- **[P0] hallucinated_citation**
  - **Claim**: Kerin JF (1982). Ovulation detection in the human. Clin Reprod Fertil. https://pubmed.ncbi.nlm.nih.gov/6755765/
  - **Evidence**: PMID 6755765 resolves to 'Medical, legal and administrative aspects of cadaveric organ donation in the RSA.' S Afr Med J 1982
  - **Source**: `curl_pmid:6755765`
  - **Fix**: Verify Kerin JF 1982 ovulation detection PMID — the actual Kerin paper exists but at a different PMID; drop citation if cannot verify

### row 132 — `Hormone Replacement Therapy (HRT)` (VIII)

**Perplexity definition**:

> Hormone Replacement Therapy (HRT) refers to the administration of exogenous hormones — typically estrogen alone or estrogen combined with a progestogen — to replace or supplement declining endogenous hormone production. In perimenopausal/menopausal women, HRT addresses estrogen deficiency symptoms. In the RRM framework, Hilgers distinguishes isomolecular HRT (using bioidentical estradiol and progesterone) from conventional HRT using synthetic progestins and conjugated equine estrogens, arguing that molecular identity affects safety and clinical response.

- **[P0] hallucinated_citation**
  - **Claim**: Stanczyk FZ et al. (2013). Progestogens in postmenopausal hormone therapy. Endocr Rev. https://pubmed.ncbi.nlm.nih.gov/23360717/
  - **Evidence**: PMID 23360717 actual content: 'Associations of estimated glomerular filtration rate and albuminuria with mortality and renal failure by sex: a meta-analysis.' BMJ 2013 Jan 29, Nitsch D et al. Completely unrelated. The REAL Stanczyk progestogens paper is PMID 23238854 ('Progestogens used in postmenopausal hormone therapy: differences in their pharmacological properties, intracellular actions, and c
  - **Source**: `curl_pmid:23360717 + europepmc_search:Stanczyk+progestogens`
  - **Fix**: Replace PMID with 23238854. Correct: Stanczyk FZ, Hapgood JP, Winer S, Mishell DR Jr. Progestogens used in postmenopausal hormone therapy: differences in their pharmacological properties, intracellular actions, and clinical effects. Endocr Rev 2013;34(2):171-208. PMID 23238854.

### row 134 — `Human Leukocyte Antigen (HLA) / KIR Compatibility` (?)

**Perplexity definition**:

> Human Leukocyte Antigen (HLA) molecules are cell-surface proteins encoded by the major histocompatibility complex (MHC) that present peptide antigens to T cells. In reproductive immunology, the HLA-C alleles expressed by the invading trophoblast interact with Killer Immunoglobulin-like Receptors (KIRs) on uterine NK cells to regulate trophoblast invasion and spiral artery transformation. Certain KIR/HLA-C combinations — particularly maternal KIR-AA genotype with fetal HLA-C2 — are associated with recurrent miscarriage and pre-eclampsia due to impaired placentation. KIR/HLA-C typing is an emerg...

- **[P0] hallucinated_citation**
  - **Claim**: Moffett A, Colucci F (2014). Uterine NK cells: active regulators at the maternal-fetal interface. J Clin Invest. https://pubmed.ncbi.nlm.nih.gov/24569374/
  - **Evidence**: PMID 24569374 resolves to: 'Targeting ER stress-induced autophagy overcomes BRAF inhibitor resistance in melanoma.' J Clin Invest 124 2014 Mar. Ma XH et al. The actual Moffett/Colucci 2014 paper is PMID 24789879 (J Clin Invest 124 2014 May).
  - **Source**: `curl_pmid:24569374`
  - **Fix**: Replace fabricated PMID 24569374 with correct PMID 24789879 (Moffett A, Colucci F. Uterine NK cells: active regulators at the maternal-fetal interface. J Clin Invest. 2014;124(5):1872-1879).
- **[P0] hallucinated_citation**
  - **Claim**: Hiby SE et al. (2010). Combinations of maternal KIR and fetal HLA-C genes influence the risk of pre-eclampsia and reproductive success. J Exp Med. https://pubmed.ncbi.nlm.nih.gov/20603313/
  - **Evidence**: PMID 20603313 resolves to: 'Redundant roles for inflammasome receptors NLRP3 and NLRC4 in host defense against Salmonella.' J Exp Med 207 2010. Broz P et al. Not Hiby/KIR/HLA-C. Real Hiby paper: PMID 20972337 (J Clin Invest, NOT J Exp Med).
  - **Source**: `curl_pmid:20603313`
  - **Fix**: Replace fabricated PMID 20603313 with correct PMID 20972337 (Hiby SE et al. 'Maternal activating KIRs protect against human reproductive failure mediated by fetal HLA-C2.' J Clin Invest. 2010;120(11):4102-4110). Note: journal is J Clin Invest, NOT J Exp Med.

### row 135 — `Hydrosalpinx` (VI)

**Perplexity definition**:

> A hydrosalpinx is a pathologic condition in which a fallopian tube becomes obstructed at its distal (fimbrial) end, causing fluid accumulation and distension of the tube lumen. The fluid is toxic to embryos and impairs implantation by refluxing into the uterine cavity. Hydrosalpinx significantly reduces both natural conception and IVF success rates. In RRM, the preferred treatment is surgical — either salpingectomy (tube removal) or neosalpingostomy (creating a new tubal opening) — to restore function or remove the toxic fluid source.

- **[P0] hallucinated_citation**
  - **Claim**: Strandell A et al. (1999). Hydrosalpinx and IVF outcome: a prospective, randomized multicentre trial. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/10402367/
  - **Evidence**: PMID 10402367 resolves to 'Effective treatment of subfertility: introducing the Cochrane Menstrual Disorders and Subfertility Group.' Hum Reprod 1999 Jul — same journal/year but wrong paper
  - **Source**: `curl_pmid:10402367`
  - **Fix**: Correct Strandell hydrosalpinx PMID is 10357954 (Hum Reprod 1999;14:2762-9) — verify before citing

### row 136 — `Hydroxyprogesterones` (?)

**Perplexity definition**:

> Hydroxyprogesterones are a family of progesterone derivatives in which a hydroxyl group (-OH) is added at one or more positions on the progesterone molecule. The most clinically relevant members are: (1) 17alpha-hydroxyprogesterone (17-OHP), an endogenous intermediate in the steroidogenesis pathway, elevated in congenital adrenal hyperplasia (CAH, particularly 21-hydroxylase deficiency); its serum level is a standard screening test for non-classic CAH in women with PCOS-like presentation. (2) 17alpha-hydroxyprogesterone caproate (17-OHPC, Makena), a synthetic injectable used to reduce preterm ...

- **[P0] hallucinated_citation**
  - **Claim**: Speiser PW et al. (2018). Congenital Adrenal Hyperplasia Due to Steroid 21-Hydroxylase Deficiency. Endocrine Society Clinical Practice Guideline. J Clin Endocrinol Metab. https://pubmed.ncbi.nlm.nih.gov/29272246/
  - **Evidence**: PMID 29272246 resolves to: 'Management of Uveitis in Spondyloarthropathy: Current Trends.' Perm J 22 2018. Gupta N et al. Not Speiser/CAH.
  - **Source**: `curl_pmid:29272246`
  - **Fix**: Replace fabricated PMID 29272246 with correct PMID 30272171 (Speiser PW, Arlt W, Auchus RJ et al. 'Congenital Adrenal Hyperplasia Due to Steroid 21-Hydroxylase Deficiency: An Endocrine Society Clinical Practice Guideline.' J Clin Endocrinol Metab. 2018;103(11):4043-4088).
- **[P0] hallucinated_citation**
  - **Claim**: Moran C et al. (2015). 17alpha-Hydroxyprogesterone in PCOS and adrenal hyperandrogenism. Steroids. https://pubmed.ncbi.nlm.nih.gov/25818160/
  - **Evidence**: PMID 25818160 resolves to: 'Modeling of stress relaxation of a semi-crystalline multiblock copolymer and its deformation behavior.' Clin Hemorheol Microcirc 60 2015. Yan W et al. Not Moran/PCOS.
  - **Source**: `curl_pmid:25818160`
  - **Fix**: PMID is hallucinated. Verify Moran 2015 Steroids paper exists; if not, remove or replace.

### row 137 — `Hyperandrogenism` (?)

**Perplexity definition**:

> Hyperandrogenism is the clinical or biochemical state of excess androgen effect in women, presenting as hirsutism, acne, alopecia, and/or menstrual irregularity. It is the defining feature of PCOS in most international diagnostic criteria. Biochemical hyperandrogenism is defined as elevated free or total testosterone, DHEA-S, or androstenedione above age-specific reference ranges. Adrenal-origin hyperandrogenism (elevated DHEA-S, 17-OHP) must be distinguished from ovarian-origin (elevated testosterone, LH:FSH >2). Congenital adrenal hyperplasia (CAH) — particularly non-classic 21-hydroxylase d...

- **[P0] hallucinated_citation**
  - **Claim**: Rotterdam ESHRE/ASRM PCOS Consensus (2004). Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/14711594/
  - **Evidence**: PMID 14711594 resolves to: 'Analysis in Escherichia coli of Plasmodium falciparum dihydropteroate synthase (DHPS) alleles implicated in resistance to sulfadoxine.' Int J Parasitol 34 2004. Berglez J et al. Not Rotterdam PCOS.
  - **Source**: `curl_pmid:14711594`
  - **Fix**: Replace fabricated PMID 14711594 with correct PMID 14688154 (Rotterdam ESHRE/ASRM-Sponsored PCOS consensus workshop group. 'Revised 2003 consensus on diagnostic criteria and long-term health risks related to polycystic ovary syndrome (PCOS).' Hum Reprod. 2004;19(1):41-47).

### row 140 — `Hysterosalpingogram (HSG)` (IV)

**Perplexity definition**:

> A Hysterosalpingogram (HSG) is a fluoroscopic radiologic procedure in which radiopaque contrast dye is injected through the cervix into the uterine cavity and fallopian tubes under X-ray guidance, providing a real-time image of uterine cavity shape and tubal patency. HSG detects uterine abnormalities (polyps, fibroids, septum, adhesions) and proximal or distal tubal occlusion. In RRM, HSG is a standard element of the initial infertility evaluation, often combined with or followed by diagnostic laparoscopy for definitive diagnosis.

- **[P0] hallucinated_citation**
  - **Claim**: Swart P et al. (1995). The accuracy of HSG in the diagnosis of tubal pathology. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/7742264/
  - **Evidence**: PMID 7742264 = 'In vitro evaluation of phosphate, bicarbonate, and Hepes buffered storage solutions on hypothermic injury to immature myocytes.' Cardiovascular drugs and therapy, 1994 Dec. Authors: Orita H, Fukasawa M, Hirooka S.
  - **Source**: `curl PubMed esummary PMID 7742264`
  - **Fix**: Replace with the real Swart 1995 paper: PMID 7641899 (Swart P et al., 'The accuracy of hysterosalpingography in the diagnosis of tubal pathology: a meta-analysis', Fertil Steril 1995 Mar;64(3):486-91). The PMID Perplexity gave is for an unrelated cardiology paper.

### row 141 — `Hysteroscopic Septoplasty` (?)

**Perplexity definition**:

> Hysteroscopic septoplasty is the operative hysteroscopic procedure to incise or resect a uterine septum, converting a septate uterine cavity into a normal single cavity. It is the definitive treatment for septate uterus and is associated with significantly improved live birth rates and reduced miscarriage rates in women with RPL attributed to a uterine septum. The procedure is performed under general or spinal anesthesia, using a hysteroscopic resectoscope or office hysteroscope with scissors or monopolar/bipolar energy. Postoperative estrogen supplementation is given to support endometrial re...

- **[P0] hallucinated_citation**
  - **Claim**: AAGL (2016). Classification of intrauterine abnormalities. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/26806667/
  - **Evidence**: PMID 26806667 resolves to: 'Latent polyglandular autoimmune syndrome type 2 case diagnosed during a shock manifestation.' Gynecol Endocrinol 32 2016. Gürkan E et al. Not AAGL/classification.
  - **Source**: `curl_pmid:26806667`
  - **Fix**: PMID is hallucinated. Search confirmed no PubMed match for 'AAGL classification intrauterine abnormalities 2016' - may be misremembering AAGL/ESGE 2013 classification paper. Verify or remove.
- **[P0] hallucinated_citation**
  - **Claim**: Homer HA et al. (2000). The septate uterus: a review of management and reproductive outcome. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/10935527/
  - **Evidence**: PMID 10935527 resolves to: 'Comparison of the protective effects of ischemic preconditioning and the Na+/H+ exchanger blockade.' Naunyn Schmiedebergs Arch Pharmacol 362 2000. Mosca SM, Cingolani HE. Not Homer.
  - **Source**: `curl_pmid:10935527`
  - **Fix**: Replace fabricated PMID 10935527 with correct PMID 10632403 (Homer HA, Li TC, Cooke ID. 'The septate uterus: a review of management and reproductive outcome.' Fertil Steril. 2000;73(1):1-14).

### row 142 — `Hysteroscopy (Diagnostic)` (IV)

**Perplexity definition**:

> Diagnostic hysteroscopy is a minimally invasive endoscopic procedure in which a thin camera (hysteroscope) is inserted through the cervix into the uterine cavity to directly visualize the endometrium and cavity architecture. It identifies polyps, submucous fibroids, uterine septum, intrauterine adhesions (Asherman's syndrome), and abnormal endometrial patterns. Compared to HSG, hysteroscopy is the gold standard for intrauterine pathology because it provides direct visualization and allows simultaneous biopsy.

- **[P0] hallucinated_citation**
  - **Claim**: AAGL (2012). Practice guidelines: diagnosis and management of submucous leiomyomas. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/22621868/
  - **Evidence**: PMID 22621868 esummary returns: 'Tributyrin attenuates obesity-associated inflammation and insulin resistance in high-fat-fed mice.' Vinolo MA, 2012, Am J Physiol Endocrinol Metab. Real AAGL 2012 paper = PMID 22381967 (J Minim Invasive Gynecol).
  - **Source**: `curl_pmid:22621868 + europepmc_search`
  - **Fix**: Replace fabricated PMID 22621868 with the real PMID 22381967.
- **[P0] hallucinated_citation**
  - **Claim**: Demirol A, Gurgan T (2004). Effect of treatment of intrauterine pathologies on IVF failure. Reprod Biomed Online. https://pubmed.ncbi.nlm.nih.gov/15670382/
  - **Evidence**: PMID 15670382 esummary returns: 'Variations in structural protein expression and endothelial cell proliferation in relation to clinical manifestations of...' Shenkar R, 2005, Neurosurgery. Real Demirol 2004 paper = PMID 15151729 (Reprod Biomed Online).
  - **Source**: `curl_pmid:15670382 + europepmc_search`
  - **Fix**: Replace fabricated PMID 15670382 with the real PMID 15151729.

### row 143 — `Hysteroscopy (Operative)` (IV)

**Perplexity definition**:

> Diagnostic hysteroscopy is a minimally invasive endoscopic procedure in which a thin camera (hysteroscope) is inserted through the cervix into the uterine cavity to directly visualize the endometrium and cavity architecture. It identifies polyps, submucous fibroids, uterine septum, intrauterine adhesions (Asherman's syndrome), and abnormal endometrial patterns. Compared to HSG, hysteroscopy is the gold standard for intrauterine pathology because it provides direct visualization and allows simultaneous biopsy.

- **[P0] drift**
  - **Claim**: Diagnostic hysteroscopy is a minimally invasive endoscopic procedure in which a thin camera (hysteroscope) is inserted through the cervix into the uterine cavity to directly visualize the endometrium and cavity architecture.
  - **Evidence**: The term in col D is 'Hysteroscopy (Operative)' but the Perplexity definition describes DIAGNOSTIC hysteroscopy verbatim (identical text to row 142). Operative hysteroscopy is a fundamentally different procedure (therapeutic intervention: polypectomy, myomectomy, septum resection, adhesiolysis, all via operative hysteroscope with mechanical/bipolar/laser instrumentation). Per col Z Boyle transcrip
  - **Source**: `col_D_term + comparison to row_142 pplx_def + col_Z_boyle_transcript`
  - **Fix**: Replace the entire definition with one describing OPERATIVE hysteroscopy. Suggested rewrite: 'Operative hysteroscopy is a therapeutic endoscopic procedure in which an operative hysteroscope (with mechanical, bipolar, or laser instrumentation) is used to treat intracavitary pathology identified at diagnostic hysteroscopy: hysteroscopic polypectomy, submucous myomectomy, septum resection (metroplasty), adhesiolysis for Asherman syndrome, and resection of retained products. In RRM, operative hysteroscopy restores normal uterine cavity architecture as a prerequisite for natural conception and is paired with menstrual cycle charting to confirm post-operative recovery before attempting conception.'
- **[P0] hallucinated_citation**
  - **Claim**: AAGL (2012). Practice guidelines: diagnosis and management of submucous leiomyomas. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/22621868/
  - **Evidence**: Same fabricated PMID as row 142. Real PMID = 22381967.
  - **Source**: `curl_pmid:22621868`
  - **Fix**: Replace with PMID 22381967.
- **[P0] hallucinated_citation**
  - **Claim**: Demirol A, Gurgan T (2004). Effect of treatment of intrauterine pathologies on IVF failure. Reprod Biomed Online. https://pubmed.ncbi.nlm.nih.gov/15670382/
  - **Evidence**: Same fabricated PMID as row 142. Real PMID = 15151729.
  - **Source**: `curl_pmid:15670382`
  - **Fix**: Replace with PMID 15151729.

### row 144 — `IIRRM (International Institute for Restorative Reproductive Medicine)` (?)

**Perplexity definition**:

> The International Institute for Restorative Reproductive Medicine (IIRRM) is the global professional society for RRM clinicians, researchers, and allied health professionals. Founded in London, UK in 2000, it holds recognized Institute status in the UK — a protected designation for organizations conducting research and professional standards of the highest level. With members across more than 50 countries, the IIRRM promotes evidence-based RRM practice, sets professional standards, sponsors research (including the STORRM registry directed by Dr. Joseph Stanford), and provides educational progr...

- **[P0] drift**
  - **Claim**: Founded in London, UK in 2000
  - **Evidence**: UK Charity Commission record (charity 5150632) shows IIRRM 'CIO registration 04 June 2020.' No official IIRRM source supplies a 2000 founding statement. RRM Academy's own 'What Is RRM?' page describes November 2000 as the start of 'formal discussions' between Canadian/Irish/UK clinicians, not the founding of IIRRM itself.
  - **Source**: `pplx_fresh + UK Charity Commission record`
  - **Fix**: Replace with verifiable: 'IIRRM was registered as a UK Charitable Incorporated Organisation on 04 June 2020 (Charity Commission 5150632); preceding informal collaboration among RRM clinicians dates to ~November 2000.' Stop attributing a specific 2000 founding date/location.
- **[P0] drift**
  - **Claim**: It holds recognized Institute status in the UK — a protected designation for organizations conducting research and professional standards of the highest level.
  - **Evidence**: There is no special UK 'Institute' protected designation as described. Use of 'Institute' in a UK CIO name is subject to Company Names rules but the description here overstates regulatory recognition.
  - **Source**: `general UK regulatory knowledge`
  - **Fix**: Drop this sentence entirely. The IIRRM is a UK-registered charity (CIO 5150632); there is no special 'recognized Institute status' designation in UK law as described.
- **[P0] drift**
  - **Claim**: sponsors research (including the STORRM registry directed by Dr. Joseph Stanford)
  - **Evidence**: Verified by pplx search: no official IIRRM source identifies a director for STORRM. IIRRM materials attribute STORRM to the organization, not a named individual. Joseph Stanford leads the iNEST registry (PMID 35974874), which is a separate cohort named 'International Natural Procreative Technology Evaluation and Surveillance of Treatment for Subfertility (iNEST).' Conflating iNEST with STORRM is a
  - **Source**: `pplx_fresh + PMID 35974874`
  - **Fix**: Rewrite: 'IIRRM maintains the international clinical practice registry STORRM (Surveillance of Treatment and Outcomes in Restorative Reproductive Medicine).' Separately, the iNEST registry (NCT01363596) is a distinct NaProTechnology-focused cohort with Joseph B. Stanford as lead investigator.

### row 145 — `Immature Follicle Syndrome (IFS)` (VI)

**Perplexity definition**:

> Immature Follicle Syndrome (IFS) is an ovulation disorder defined by Hilgers' sonographic classification in which the dominant follicle fails to reach mature size (<18 mm) before luteinization occurs. On follicle maturation study, the follicle plateaus in growth and then collapses or luteinizes at an insufficient size to support oocyte maturation. IFS is associated with poor oocyte quality and reduced fecundity. Treatment typically involves low-dose ovulation induction agents (letrozole, FSH gonadotropins) to support adequate follicle maturation prior to rupture.

- **[P0] hallucinated_citation**
  - **Claim**: Pache TD et al. (1993). Growth patterns of nondominant ovarian follicles during the normal menstrual cycle. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/8458469/
  - **Evidence**: PMID 8458469 esummary: title="Detection of antisperm antibodies on the surface of living spermatozoa using flow cytometry: preliminary study.", source="Fertil Steril", date="1993 Mar", first_author="Nikolaeva MA"
  - **Source**: `curl_pmid:8458469`
  - **Fix**: FABRICATED. PubMed search for "Pache TD ovarian follicle 1993" did not return an exact match. There is a 1990 Pache TD paper "Growth patterns of nondominant ovarian follicles during the normal menstrual cycle" but it is at PMID 2298311 (Fertil Steril 54:638-42 1990 Oct). Replace 8458469 -> 2298311 and adjust year 1993 -> 1990.
- **[P0] hallucinated_citation**
  - **Claim**: Odeblad E (1997). Cervical mucus and their functions. J Ir Coll Physicians Surg. https://pubmed.ncbi.nlm.nih.gov/9382348/
  - **Evidence**: PMID 9382348 esummary: title="[Influence of the middle ear on the measurement of otoacoustic emissions].", source="An Esp Pediatr", date="1997 Aug", first_author="Mir Plana B"
  - **Source**: `curl_pmid:9382348`
  - **Fix**: FABRICATED. Real Odeblad cervical-mucus paper in J Ir Coll Physicians Surg 1997 exists at PMID 11625847 (vol 26 pp 27-32). Replace 9382348 -> 11625847.

### row 146 — `Immune-Modifying Framework` (III)

**Perplexity definition**:

> The Immune-Modifying Framework in RRM is a multi-component treatment strategy designed to normalize immune dysregulation contributing to implantation failure and recurrent pregnancy loss. Key elements include: low-dose naltrexone (LDN) to modulate T-regulatory cell activity, vitamin D3 optimization (target >40 ng/mL), omega-3 fatty acids to reduce inflammatory cytokines, anti-inflammatory dietary modification, and — in selected cases — prednisolone, intralipid infusion, or IVIG for significant immune activation. The framework is individualized rather than protocolized.

- **[P0] hallucinated_citation**
  - **Claim**: Carp HJA (2015). Immunotherapy for recurrent pregnancy loss. Expert Opin Biol Ther. https://pubmed.ncbi.nlm.nih.gov/25543756/
  - **Evidence**: PMID 25543756 resolves to: Kathriner A, Bauer AM, O'shea M (2014). 'Hiding in plain sight: a new species of bent-toed gecko (Squamata: Gekkonidae: Cyrtodactylus) from West Timor.' Zootaxa. COMPLETELY UNRELATED — herpetology paper. Real Carp 2019 paper exists (PMID 31521575) in Best Practice & Research Clinical Obstetrics & Gynaecology, NOT Expert Opin Biol Ther 2015.
  - **Source**: `curl_pmid:25543756 + pubmed_search:Carp`
  - **Fix**: Replace with Carp HJA. 'Immunotherapy for recurrent pregnancy loss.' Best Pract Res Clin Obstet Gynaecol. 2019;60:77-86. PMID 31521575.
- **[P0] hallucinated_citation**
  - **Claim**: Grunewald M et al. (2020). Vitamin D and immune regulation in reproductive medicine. Front Immunol. https://pubmed.ncbi.nlm.nih.gov/33123157/
  - **Evidence**: PMID 33123157 returns NO record (empty uids list) — does not exist on PubMed.
  - **Source**: `curl_pmid:33123157`
  - **Fix**: Drop the citation. If vitamin D + reproductive immunology citation needed, find a real PMID via PubMed search and curl-verify before insertion.

### row 147 — `In Vitro Activation (IVA)` (?)

**Perplexity definition**:

> In Vitro Activation (IVA) is an experimental reproductive technique designed to activate dormant primordial follicles in ovaries with premature ovarian insufficiency (POI) or diminished reserve, enabling oocyte retrieval and IVF. The technique involves surgical removal of ovarian cortical strips, ex-vivo pharmacological activation using Akt stimulators (bpV — PTEN inhibitor) or Hippo signaling pathway disruptors (fragmentation), followed by autotransplantation of the activated cortex or direct follicle growth, and retrieval of mature oocytes for IVF. IVA is not yet standard of care and is avai...

- **[P0] hallucinated_citation**
  - **Claim**: Kawamura K et al. (2013). Hippo signaling disruption and Akt stimulation of ovarian follicles for infertility treatment. PNAS. https://pubmed.ncbi.nlm.nih.gov/23723351/
  - **Evidence**: PMID 23723351 resolves to: 'piggyBac transposase tools for genome engineering.' Proc Natl Acad Sci U S A 110 2013 Jun 18. Li X et al. Not Kawamura/IVA.
  - **Source**: `curl_pmid:23723351`
  - **Fix**: Replace fabricated PMID 23723351 with correct PMID 24082083 (Kawamura K, Cheng Y, Suzuki N et al. 'Hippo signaling disruption and Akt stimulation of ovarian follicles for infertility treatment.' Proc Natl Acad Sci U S A. 2013;110(43):17474-17479).

### row 150 — `Insulin Resistance / Metabolic Dysfunction` (VI)

**Perplexity definition**:

> Insulin resistance (IR) is a state in which target tissues (liver, muscle, adipose) become less responsive to insulin, requiring greater insulin secretion to maintain glucose homeostasis. In reproductive medicine, hyperinsulinemia associated with IR stimulates excess androgen production in theca cells and suppresses SHBG synthesis, resulting in hyperandrogenism, ovulatory dysfunction, and PCOS. IR is present in approximately 70–80% of women with PCOS (both lean and obese). In RRM, IR is assessed via fasting insulin, glucose:insulin ratio, or HOMA-IR, and treated with dietary modification, myo-...

- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2004). Prevalence and predictors of risk for type 2 diabetes mellitus and impaired glucose tolerance in polycystic ovary syndrome. J Clin Endocrinol Metab. https://pubmed.ncbi.nlm.nih.gov/10634363/
  - **Evidence**: PubMed esummary for PMID 10634363 returns: title="Androstenedione does not stimulate muscle protein anabolism in young healthy men.", source="J Clin Endocrinol Metab", date="2000 Jan", first_author="Rasmussen BB"
  - **Source**: `curl_pmid:10634363`
  - **Fix**: Drop the fake PMID. The real Legro et al. PCOS T2DM paper is PMID 9920077 (Legro RS, Kunselman AR, Dodson WC, Dunaif A, J Clin Endocrinol Metab 1999;84:165-9). Replace 10634363 -> 9920077 and adjust year 2004 -> 1999.
- **[P0] fabricated_stat**
  - **Claim**: WHO (2026). Polycystic ovary syndrome
  - **Evidence**: Today is 2026-05-27. A WHO 2026 fact sheet may exist but the citation is undated/vague and the URL is unverified. Future-date citation pattern matches calibration-stage hallucinations.
  - **Source**: `pplx_date_pattern`
  - **Fix**: Verify against live WHO URL or drop.

### row 151 — `Intracytoplasmic Sperm Injection (ICSI)` (VIII)

**Perplexity definition**:

> Intracytoplasmic Sperm Injection (ICSI) is an ART procedure in which a single spermatozoon is injected directly into the cytoplasm of a mature oocyte in vitro. Introduced in 1992, ICSI is now the most widely used fertilization technique in IVF cycles globally, particularly for severe male factor infertility (azoospermia, severe oligoasthenoteratospermia). Unlike conventional IVF insemination, ICSI bypasses all natural sperm selection barriers, raising ongoing questions about epigenetic risks in offspring that are the subject of active research.

- **[P0] hallucinated_citation**
  - **Claim**: Boulet SL et al. (2015). Trends in use of and reproductive outcomes associated with ICSI. JAMA. https://pubmed.ncbi.nlm.nih.gov/25898052/
  - **Evidence**: PMID 25898052 actual content: 'Effects of high-dose oral insulin on immune responses in children at high risk for type 1 diabetes: the Pre-POINT randomized clinical trial.' JAMA 2015 Apr 21, Bonifacio E et al. The REAL Boulet SL ICSI paper is PMID 25602996 ('Trends in use of and reproductive outcomes associated with intracytoplasmic sperm injection.' JAMA 2015 Jan 20).
  - **Source**: `curl_pmid:25898052 + pubmed_search Boulet+trends+ICSI`
  - **Fix**: Replace PMID with correct PMID 25602996: Boulet SL, Mehta A, Kissin DM et al. Trends in use of and reproductive outcomes associated with intracytoplasmic sperm injection. JAMA 2015;313(3):255-263.

### row 153 — `Intratubal Pressure (ITP)` (IV)

**Perplexity definition**:

> Intratubal pressure (ITP) refers to the pressure within the fallopian tube lumen, which plays a role in normal tubal function and gamete transport. Elevated ITP can result from proximal tubal obstruction, hydrosalpinx, or peritubal adhesions. In selective salpingography and fallopian tube recanalization procedures, ITP measurements are used to assess tubal patency and cannulation success. Abnormal ITP is relevant in the evaluation of unexplained subfertility where tubal-factor causes may not be apparent on standard HSG.

- **[P0] hallucinated_citation**
  - **Claim**: Thurmond AS (1995). Fluoroscopic fallopian tube catheterization. Radiol Clin North Am. https://pubmed.ncbi.nlm.nih.gov/7644934/
  - **Evidence**: PMID 7644934 esummary returns: 'Partial ACL rupture: an MR diagnosis?' Yao L, 1995, Skeletal Radiol. Searches for Thurmond 1995 'Fluoroscopic fallopian tube catheterization' return only PMID 7890053 ('Salpingitis isthmica nodosa: results of transcervical fluoroscopic catheter recanalization', Fertil Steril 1995) - different title/journal.
  - **Source**: `curl_pmid:7644934 + europepmc_search`
  - **Fix**: Drop fabricated PMID 7644934. Substitute Thurmond AS 1991 PMID 1898568 (Radiology, foundational), or Thurmond AS 2000 PMID 11112827 ('A review of selective salpingography and fallopian tube catheterization').
- **[P0] hallucinated_citation**
  - **Claim**: Platia MP, Krudy AG (1985). Transvaginal fluoroscopy: a new approach to uterine and fallopian tube disease. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/3896665/
  - **Evidence**: PMID 3896665 esummary returns: 'Effective treatment of post-partum hypotension with dimetophrine: a placebo-controlled, double-blind trial.' Marsoni V, 1985, Curr Med Res Opin. Cannot locate a real Platia & Krudy 1985 paper on transvaginal fluoroscopy in Fertil Steril. Citation appears fully fabricated.
  - **Source**: `curl_pmid:3896665 + europepmc_search`
  - **Fix**: Drop the Platia citation entirely. The ITP/tubal-perfusion-pressure work is more rigorously sourced to Hilgers & Yeung 1999 (cited in col AA Ch. 66) - use that instead.

### row 154 — `Intrauterine Adhesions (Asherman's Syndrome)` (VI)

**Perplexity definition**:

> Intrauterine adhesions (IUA), or Asherman's syndrome, are bands of scar tissue within the uterine cavity that develop following endometrial trauma — most commonly after uterine curettage (D&C), hysteroscopic surgery, myomectomy, or uterine infection. Adhesions distort the uterine cavity, impair endometrial development, and reduce implantation and pregnancy rates. Diagnosis is by hysteroscopy or sonohysterography. Treatment is operative hysteroscopic adhesiolysis, followed by hormonal endometrial priming and anti-adhesion barriers.

- **[P0] hallucinated_citation**
  - **Claim**: March CM (2011). Management of Asherman's syndrome. Reprod Biomed Online. https://pubmed.ncbi.nlm.nih.gov/21419380/
  - **Evidence**: PMID 21419380 resolves to 'Mutant GlialCAM causes megalencephalic leukoencephalopathy...' Am J Hum Genet 2011
  - **Source**: `curl_pmid:21419380`
  - **Fix**: Correct March CM Asherman PMID — likely 21531635 (RBM Online 2011;23:63-76); verify
- **[P0] hallucinated_citation**
  - **Claim**: AAGL (2014). Practice guidelines on intrauterine adhesions. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/25264564/
  - **Evidence**: PMID 25264564 resolves to 'Developing Pd(II) catalyzed double sp3 C-H alkoxylation...' Org Lett 2014
  - **Source**: `curl_pmid:25264564`
  - **Fix**: Correct AAGL IUA 2017 PMID is 28865947 (J Minim Invasive Gynecol 2017;24:695-705); verify

### row 156 — `Isomolecular Hormones (IMH)` (III)

**Perplexity definition**:

> Isomolecular Hormones (IMH) is a term coined by Dr. Thomas Hilgers for hormone preparations molecularly identical to those naturally produced by the human body — specifically estradiol-17beta, progesterone, and testosterone — also called bioidentical hormones. Hilgers contrasts IMH with Heteromolecular Artimones (HMA), arguing that only molecularly identical hormones interact with receptors in a physiologically normal manner. In NaProTECHNOLOGY, isomolecular progesterone (vaginal, IM, or subcutaneous) is the standard for luteal support and pregnancy maintenance.

- **[P0] hallucinated_citation**
  - **Claim**: Stanczyk FZ et al. (2013). Progestogens in postmenopausal hormone therapy. Endocr Rev. https://pubmed.ncbi.nlm.nih.gov/23360717/
  - **Evidence**: PMID 23360717 resolves to: Nitsch D, Grams M, Sang Y (2013). 'Associations of estimated glomerular filtration rate and albuminuria with mortality and renal failure by sex: a meta-analysis.' BMJ. UNRELATED. The REAL Stanczyk 2013 progestogens-postmenopausal Endocr Rev paper exists at PMID 23238854: Stanczyk FZ, Hapgood JP, Winer S, Mishell DR Jr.
  - **Source**: `curl_pmid:23360717 + pubmed_search:Stanczyk`
  - **Fix**: Replace PMID 23360717 with the correct PMID 23238854. Title in pplx 'Progestogens in postmenopausal hormone therapy' approximates real title 'Progestogens used in postmenopausal hormone therapy: differences in their pharmacological properties...' — close enough.
- **[P0] hallucinated_citation**
  - **Claim**: de Lignières B et al. (1995). Influence of route of administration on progesterone metabolism. Maturitas. https://pubmed.ncbi.nlm.nih.gov/7623546/
  - **Evidence**: PMID 7623546 resolves to: French LE, Saurat JH (1995). 'Treatment of cutaneous T-cell lymphoma by retinoids and calcitriol.' Lancet. UNRELATED — dermatology paper, not de Lignières progesterone work.
  - **Source**: `curl_pmid:7623546`
  - **Fix**: Drop the citation. de Lignières did publish on progesterone routes (real work exists) but the cited PMID is fabricated. Curator to find real PMID via PubMed search 'de Lignières progesterone route administration' and curl-verify.

### row 157 — `Isthmocele Repair (Hysteroscopic)` (V)

**Perplexity definition**:

> Hysteroscopic isthmocele repair involves the resection or ablation of the thin myometrial bridge overlying a uterine isthmocele (caesarean scar defect) using a hysteroscope and electrosurgical instrument. The goal is to eliminate the niche that accumulates menstrual blood and mucus, which impairs sperm migration, embryo implantation, and early pregnancy development. The hysteroscopic approach is appropriate for defects with adequate residual myometrial thickness (>=2.5 mm) and is preferred for symptomatic isthmocele without major anatomical distortion.

- **[P0] hallucinated_citation**
  - **Claim**: Toth B et al. (2023). Management of isthmocele: a systematic review. Arch Gynecol Obstet. https://pubmed.ncbi.nlm.nih.gov/35501502/
  - **Evidence**: PMID 35501502 resolves to: 'Proposal of new diagnostic criteria for fatal familial insomnia.' Chu M, Xie K, Zhang J. J Neurol 269, 2022 Sep. NOT an isthmocele paper.
  - **Source**: `curl_pmid:35501502`
  - **Fix**: Drop cite or verify the actual Toth 2023 isthmocele paper exists by searching PubMed for 'Toth isthmocele systematic review' (none found in EPMC quick search of 25 isthmocele systematic reviews; likely fabricated entirely).
- **[P0] hallucinated_citation**
  - **Claim**: AAGL (2021). White paper: management of uterine isthmocele. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/33373714/
  - **Evidence**: PMID 33373714 resolves to: 'Anatomically based radiological classification of thumb basal joint arthritis.' Allieu Y. Hand Surg Rehabil 40S, 2021 Sep. NOT an AAGL isthmocele paper. EPMC search for 'AAGL isthmocele white paper' returns 0 hits. AAGL HAS published a 2024 niche/isthmocele practice guideline but the cited PMID is fabricated.
  - **Source**: `curl_pmid:33373714+europepmc`
  - **Fix**: Replace with AAGL 2024 Niche Practice Guideline (verify PMID) OR drop citation. AAGL 2021 isthmocele white paper does not appear to exist.
- **[P0] hallucinated_citation**
  - **Claim**: Vervoort AJ et al. (2015). The hysteroscopic approach to isthmocele. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/25924657/
  - **Evidence**: PMID 25924657 resolves to: 'Concurrent exome-targeted next-generation sequencing and single nucleotide polymorphism array to identify the causative genetic aberrations of isolated Mayer-Rokitansky-Kuster-Hauser syndrome.' Chen MJ, Wei SY, Yang WS. Hum Reprod 30, 2015 Jul. NOT a Vervoort isthmocele paper. The real Vervoort 2015 paper on niches in caesarean scars is PMID 26409016 ('Why do niches dev
  - **Source**: `curl_pmid:25924657+europepmc`
  - **Fix**: Replace with PMID 26409016 (Vervoort AJ et al., Hum Reprod 2015 - hypothesis/aetiology paper) or find a Vervoort intervention paper by direct PubMed search.

### row 158 — `Isthmocele Repair (Laparoscopic)` (V)

**Perplexity definition**:

> Hysteroscopic isthmocele repair involves the resection or ablation of the thin myometrial bridge overlying a uterine isthmocele (caesarean scar defect) using a hysteroscope and electrosurgical instrument. The goal is to eliminate the niche that accumulates menstrual blood and mucus, which impairs sperm migration, embryo implantation, and early pregnancy development. The hysteroscopic approach is appropriate for defects with adequate residual myometrial thickness (>=2.5 mm) and is preferred for symptomatic isthmocele without major anatomical distortion.

- **[P0] drift**
  - **Claim**: Hysteroscopic isthmocele repair involves the resection or ablation of the thin myometrial bridge...
  - **Evidence**: Term D = 'Isthmocele Repair (Laparoscopic)', but col J defines the HYSTEROSCOPIC procedure (verbatim duplicate of row 157). The laparoscopic isthmocele repair is a fundamentally different operation: it requires bladder mobilization and full-thickness excision of the scar tissue, then layered closure of the myometrium. Indication is the opposite of hysteroscopic: laparoscopic repair is preferred wh
  - **Source**: `col_D_term+col_AC_wikipedia_laparoscopy+general_canon`
  - **Fix**: REWRITE entirely. Suggested text: 'Laparoscopic isthmocele repair is a minimally invasive abdominal procedure in which the caesarean scar defect (niche) is excised through the uterine wall and the myometrium is closed in layers. It is preferred when residual myometrial thickness is insufficient (typically <2.5-3 mm) for safe hysteroscopic repair, particularly in patients desiring future pregnancy, because it restores full-thickness myometrial integrity. Robotic-assisted approaches are increasingly used.'
- **[P0] hallucinated_citation**
  - **Claim**: K column cites Toth B 2023 (PMID 35501502), AAGL 2021 (PMID 33373714), Vervoort 2015 (PMID 25924657)
  - **Evidence**: All three PMIDs fabricated as documented in row 157 findings. Same K column reused.
  - **Source**: `curl_pmid_all_three`
  - **Fix**: Replace ALL three citations with verified laparoscopic isthmocele repair sources (e.g., Donnez O et al., Vervoort AJ et al. PMID 26409016, etc.).

### row 159 — `IUI (Intrauterine Insemination)` (VIII)

**Perplexity definition**:

> Intrauterine Insemination (IUI) is an assisted reproduction procedure in which processed, motility-selected sperm are deposited directly into the uterine cavity via a thin catheter at the time of ovulation, bypassing the cervical mucus barrier. IUI is used for mild male factor infertility, cervical factor, unexplained infertility, and same-sex family building with donor sperm. IUI requires at least one patent fallopian tube and relies on in vivo fertilization. In the RRM conceptual framework, IUI is less 'bypassing' than IVF but still does not address underlying pathology.

- **[P0] hallucinated_citation**
  - **Claim**: Cohlen B et al. (2018). IUI versus expectant management for unexplained subfertility (Cochrane Review). https://pubmed.ncbi.nlm.nih.gov/29869295/
  - **Evidence**: PMID 29869295 actual content: 'Sphingobium tyrosinilyticum sp. nov., a tyrosine hydrolyzing bacterium isolated from Korean radish garden.' Archives of microbiology 2018. The actual Cochrane review by Ayeleke RO, Asseler JD, Cohlen BJ is PMID 32124980 ('Intra-uterine insemination for unexplained subfertility' Cochrane 2020).
  - **Source**: `curl_pmid:29869295 + pubmed_search`
  - **Fix**: Replace with: Ayeleke RO, Asseler JD, Cohlen BJ. Intra-uterine insemination for unexplained subfertility. Cochrane Database Syst Rev 2020;3:CD001838. PMID 32124980.
- **[P0] hallucinated_citation**
  - **Claim**: ASRM Practice Committee (2020). Intrauterine insemination: a committee opinion. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/31570125/
  - **Evidence**: PMID 31570125 actual content: 'Evaluation of generational influences among 4th year pharmacy students and experiential preceptors.' Currents in pharmacy teaching & learning 2019. Completely unrelated paper.
  - **Source**: `curl_pmid:31570125`
  - **Fix**: Locate real ASRM Practice Committee opinion on IUI or drop this citation entirely; cited PMID is fabricated.

### row 161 — `IVF vs. RRM: Key Conceptual Distinctions` (VIII)

**Perplexity definition**:

> RRM and IVF differ fundamentally in philosophy: IVF bypasses underlying pathology (blocked tubes, hormonal deficiency, implantation failure) by removing and fertilizing eggs externally, while RRM diagnoses and corrects the same pathology to restore in vivo conception. IVF achieves a live birth rate per cycle of approximately 30–40% in women under 35 but does not address root causes affecting long-term reproductive health. RRM outcome studies (Boyle, Hilgers) report comparable or superior cumulative live birth rates over time, with markedly lower cost per live birth and no excess multiple gesta...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle PC et al. (2022). Restorative reproductive medicine outcomes vs. IVF: a comparative review. J Reprod Med.
  - **Evidence**: No paper matching 'Boyle PC 2022 restorative reproductive medicine vs IVF comparative review J Reprod Med' exists on PubMed or Europe PMC. Multiple search variations returned 0 results.
  - **Source**: `pubmed_search + europepmc_search`
  - **Fix**: Drop fabricated Boyle PC 2022 citation. Replace with verifiable RRM-vs-IVF outcomes comparison such as Stanford JB et al. BMC Pregnancy Childbirth 2021 (PMID 34233646) or Tham E et al. Can Fam Physician 2012 (PMID 22734170).
- **[P0] fabricated_stat**
  - **Claim**: RRM outcome studies (Boyle, Hilgers) report comparable or superior cumulative live birth rates over time, with markedly lower cost per live birth and no excess multiple gestation risk.
  - **Evidence**: No in-sheet authoritative column substantiates this comparative-superiority claim with specific Boyle/Hilgers cumulative live-birth statistics. The fabricated 'comparative review' citation appears to be the underlying source.
  - **Source**: `in-sheet column absence`
  - **Fix**: Re-anchor claim to verifiable sources (Stanford BMC 2021 PMID 34233646; Tham CFP 2012 PMID 22734170; iNEST Stanford Hum Reprod Open 2022 PMID 35974874) or soften to qualitative claim without 'comparable or superior' framing without specific citation.

### row 162 — `Laparoscopic Ovarian Wedge Resection (LOWR)` (V)

**Perplexity definition**:

> Laparoscopic Ovarian Wedge Resection (LOWR) is a surgical procedure in which a V-shaped wedge of ovarian cortex is excised laparoscopically, historically performed to treat polycystic ovary syndrome (PCOS) by reducing androgen-producing ovarian stroma. It has largely been replaced by laparoscopic ovarian drilling (LOD), which uses electrocautery or laser punctures to achieve a similar androgen-reduction effect with less tissue destruction. In RRM, surgical intervention for PCOS is reserved for patients who fail medical ovulation induction.

- **[P0] hallucinated_citation**
  - **Claim**: Amer SA et al. (2004). Laparoscopic ovarian diathermy versus wedge resection. BJOG. https://pubmed.ncbi.nlm.nih.gov/15511953/
  - **Evidence**: PMID 15511953 = 'Maternal height and prior vaginal delivery as predictive factors in trial of labour after one caesarean section.' J Obstet Gynaecol 1997 Nov. Authors: Ajayi AB, Babarinsa IA, Adewole IF.
  - **Source**: `curl PubMed esummary PMID 15511953`
  - **Fix**: PMID is wrong AND no Amer SA 2004 BJOG 'LOD vs WR' paper exists. PubMed search 'Amer SA laparoscopic ovarian diathermy polycystic' returns 6 Amer papers but none matching the cited title/year/journal. Drop the citation or replace with verifiable Amer SA work (e.g., Hum Reprod 2009 PMID 19640893).
- **[P0] hallucinated_citation**
  - **Claim**: Gjönnaess H (1984). Polycystic ovarian syndrome treated by ovarian electrocautery. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/6202539/
  - **Evidence**: PMID 6202539 = 'Bronchial responsiveness and leucocyte reactivity after influenza vaccine in asthmatic patients.' Eur J Respir Dis, 1984 Apr. Authors: de Jongste JC, Degenhart HJ, Neijens HJ.
  - **Source**: `curl PubMed esummary PMID 6202539`
  - **Fix**: Correct PMID for the Gjönnaess 1984 Fertil Steril ovarian-electrocautery paper is 6692959. Replace.
- **[P0] hallucinated_citation**
  - **Claim**: Balen AH (2004). Surgical treatment of PCOS. Best Pract Res Clin Obstet Gynaecol. https://pubmed.ncbi.nlm.nih.gov/15532579/
  - **Evidence**: PMID 15532579 = 'Improved separation of metallothionein isoforms by the presence of cyclodextrin in capillary zone electrophoresis.' J Chromatogr A, 2004 Oct. Authors: Wilhelmsen TW et al.
  - **Source**: `curl PubMed esummary PMID 15532579`
  - **Fix**: Wrong PMID for a Balen surgical-PCOS review. The text content claim itself is plausible but the citation is fabricated. Drop or replace with a real Balen surgical-PCOS reference.

### row 164 — `Laparoscopy (Operative)` (IV)

**Perplexity definition**:

> Diagnostic laparoscopy is a minimally invasive surgical procedure in which a camera (laparoscope) is inserted through a small umbilical incision to visualize the pelvic organs directly. In reproductive medicine, it is the gold standard for diagnosing endometriosis (invisible on imaging), evaluating pelvic adhesions, confirming tubal patency under direct vision, and identifying uterine surface abnormalities. In NaProTECHNOLOGY, near-contact laparoscopy technique is used to maximize visualization of subtle peritoneal disease.

- **[P0] drift**
  - **Claim**: Diagnostic laparoscopy is a minimally invasive surgical procedure in which a camera (laparoscope) is inserted through a small umbilical incision to visualize the pelvic organs directly.
  - **Evidence**: The term in col D is 'Laparoscopy (Operative)' but the Perplexity definition describes DIAGNOSTIC laparoscopy verbatim (identical text to row 163). Operative laparoscopy is the THERAPEUTIC counterpart: excision of endometriosis, adhesiolysis, salpingostomy, ovarian cystectomy. Col AA points to Hilgers Ch. 79 'Recurrence of Endometriosis after PEARS' (42 occurrences of 'Operative') which is operati
  - **Source**: `col_D_term + comparison to row_163 pplx_def + col_Z_boyle_transcript + col_AA_rrm_textbook`
  - **Fix**: Replace with definition specific to operative laparoscopy. Suggested rewrite: 'Operative laparoscopy is a therapeutic minimally invasive surgical procedure in which the laparoscope and accessory instruments (scissors, bipolar/monopolar/laser, ultrasonic shears) are used to treat intra-abdominal pathology identified at diagnostic laparoscopy: wide excision of endometriosis (Hilgers PEARS protocol; Redwine sharp dissection), adhesiolysis, salpingostomy/neosalpingostomy, ovarian cystectomy/wedge resection. In NaProTECHNOLOGY, operative laparoscopy emphasizes sharp wide excision over ablation/fulguration and microsurgical adhesion prevention (PEARS) to maximize fertility-restorative outcomes.'

### row 165 — `Letrozole (Femara) — RRM Use` (?)

**Perplexity definition**:

> Letrozole is a third-generation aromatase inhibitor (AI) that blocks conversion of androgens to estrogens, lowering estradiol and releasing the hypothalamic-pituitary axis from estrogen negative feedback — increasing FSH secretion and stimulating folliculogenesis. Letrozole 2.5–7.5 mg/day is administered on cycle days 3–7 (or CrMS-timed equivalent). It is the first-line ovulation induction agent for anovulatory PCOS per ASRM/ESHRE 2023 guidelines, superior to clomiphene citrate for live birth rates. Letrozole has a shorter half-life, fewer anti-estrogenic side effects, and lower multiple pregn...

- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2014). Letrozole versus clomiphene for PCOS. N Engl J Med. https://pubmed.ncbi.nlm.nih.gov/24926259/
  - **Evidence**: PMID 24926259 resolves to: 'Occurrence and Recurrence of Hepatocellular Carcinoma Were Not Rare Events during Phlebotomy in Older Hepatitis C Virus-Infected Patients.' Case Rep Oncol 7 2014. Kanda T et al. Not Legro/letrozole.
  - **Source**: `curl_pmid:24926259`
  - **Fix**: Replace fabricated PMID 24926259 with correct PMID 25006718 (Legro RS, Brzyski RG, Diamond MP et al. 'Letrozole versus clomiphene for infertility in the polycystic ovary syndrome.' N Engl J Med. 2014;371(2):119-129).

### row 168 — `Limited Mucus Cycle` (II)

**Perplexity definition**:

> A Limited Mucus Cycle is a CrMS chart finding in which cervical mucus production is reduced in quantity, shortened in duration (fewer days of mucus), or restricted in quality (lacking clear, stretchy, or lubricative characteristics) compared to normal fertile mucus patterns. Limited mucus cycles may indicate cervical factor infertility, decreased estrogen stimulation of cervical crypts, post-surgical cervical changes, or chronic cervicitis. In NaProTECHNOLOGY, limited mucus is evaluated clinically and treated with targeted estrogen support or antibiotics when infectious etiology is suspected.

- **[P0] hallucinated_citation**
  - **Claim**: Odeblad E (1997). Cervical mucus and their functions. J Ir Coll Physicians Surg. https://pubmed.ncbi.nlm.nih.gov/9382348/
  - **Evidence**: [Influence of the middle ear on otoacoustic emissions] (Mir Plana 1997 An Esp Pediatr) — NOT Odeblad cervical mucus
  - **Source**: `curl_pmid:9382348`
  - **Fix**: Drop or replace PMID 9382348.
- **[P0] hallucinated_citation**
  - **Claim**: Moghissi KS (1972). Sperm penetration through cervical mucus and cervical mucus-sperm interaction. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/4675613/
  - **Evidence**: [Communicational aspects of Japanese language of schizophrenic patients] (Ikeda 1972 Seishin Shinkeigaku Zasshi) — NOT Moghissi sperm penetration through cervical mucus
  - **Source**: `curl_pmid:4675613`
  - **Fix**: Drop or replace PMID 4675613.

### row 169 — `Live Birth` (?)

**Perplexity definition**:

> Live birth is the complete expulsion or extraction from a woman of a fetus, irrespective of gestational age, that after such separation breathes or shows any other definite sign of life such as heartbeat, pulsation of the umbilical cord, or definite voluntary muscle movement, regardless of whether the umbilical cord is cut or the placenta is attached. The classification applies whether the birth is vaginal or by caesarean and whether the neonate is ultimately viable. ICD-11 codes single live birth as QA46.0. Live birth is the most patient-meaningful outcome in fertility research and is the hea...

- **[P0] drift**
  - **Claim**: Comparative RRM-vs-IVF cohorts (e.g., Stanford iNEST registry) consistently report cumulative live birth as the primary outcome.
  - **Evidence**: Stanford's registry is 'International Natural Procreative Technology Evaluation and Surveillance of Treatment for Subfertility' (PMID 35974874) — abbreviated iNEST. Perplexity expanded iNEST as 'NaProTechnology Evaluation and Surveillance of Treatment' which OMITS 'Subfertility' from the official acronym source. Also, iNEST is not strictly 'RRM-vs-IVF' but a NaPro single-arm cohort.
  - **Source**: `curl_pmid:35974874 + pplx_fresh`
  - **Fix**: Replace with: 'Cohort studies of RRM care (e.g., the international Natural Procreative Technology Evaluation and Surveillance of Treatment for Subfertility [iNEST] registry, Stanford et al., PMID 35974874) report cumulative live birth as the primary outcome over multi-year follow-up.'

### row 170 — `Low-Dose Naltrexone (LDN)` (III)

**Perplexity definition**:

> Low-Dose Naltrexone (LDN) refers to naltrexone (an opioid receptor antagonist) used at 1.5–4.5 mg/day — far below its standard 50 mg addiction dose. At low doses, transient opioid receptor blockade paradoxically upregulates endogenous endorphin production, modulates T-regulatory cell activity, and reduces pro-inflammatory cytokines (TNF-alpha, IL-6), shifting immune balance toward tolerance. In RRM and NeoFertility, LDN is a core component of the immune-modifying framework used to support implantation, reduce autoimmune-mediated pregnancy loss, and address endometriosis-associated immune dysre...

- **[P0] hallucinated_citation**
  - **Claim**: Younger J et al. (2014). Low-dose naltrexone for the treatment of fibromyalgia. Pain Med. https://pubmed.ncbi.nlm.nih.gov/24526250/
  - **Evidence**: PMID 24526250 resolves to: Younger J, Parkitny L, McLain D (2014). 'The use of low-dose naltrexone (LDN) as a novel anti-inflammatory treatment for chronic pain.' Journal: Clinical rheumatology (NOT Pain Medicine). Title and journal both differ from pplx claim. Author Younger correct, year correct, topic similar — but cited paper is a different Younger 2014 paper.
  - **Source**: `curl_pmid:24526250`
  - **Fix**: Replace with the correct citation: Younger J, Parkitny L, McLain D. 'The use of low-dose naltrexone (LDN) as a novel anti-inflammatory treatment for chronic pain.' Clin Rheumatol. 2014;33(4):451-9. PMID 24526250.
- **[P0] hallucinated_citation**
  - **Claim**: Cree BAC et al. (2010). Low-dose naltrexone therapy in multiple sclerosis. Ann Neurol. https://pubmed.ncbi.nlm.nih.gov/20437580/
  - **Evidence**: PMID 20437580 resolves to: Bar-Or A, Fawaz L, Fan B (2010). 'Abnormal B-cell cytokine responses a trigger of T-cell-mediated disease in MS?' Ann Neurol. UNRELATED to Cree or LDN — different paper entirely.
  - **Source**: `curl_pmid:20437580`
  - **Fix**: Real Cree LDN MS paper: Cree BAC, Kornyeyeva E, Goodin DS. 'Pilot trial of low-dose naltrexone and quality of life in multiple sclerosis.' Ann Neurol. 2010;68(2):145-50. PMID 20695007 (curator to verify via PubMed search before publishing).

### row 173 — `Luteal Phase Defect` (?)

**Perplexity definition**:

> The luteal phase is the second half of the menstrual cycle, beginning at ovulation (when the dominant follicle ruptures) and ending at the onset of menstruation. During this phase, the ruptured follicle transforms into the corpus luteum, which secretes progesterone and estradiol to prepare the endometrium for implantation. Normal luteal phase length is 12–16 days. Progesterone levels peak at approximately 5–7 days post-ovulation (post-peak day 5–7 in the CrMS). In RRM, the luteal phase is evaluated using cycle-timed progesterone measurements to identify luteal phase deficiency.

- **[P0] drift**
  - **Claim**: The entire pplx_def is IDENTICAL to row 172 (Luteal Phase Assessment) and defines 'the luteal phase' rather than 'luteal phase defect.' Two distinct terms got the same boilerplate.
  - **Evidence**: Row 172 pplx_def: 'The luteal phase is the second half of the menstrual cycle...In RRM, the luteal phase is evaluated using cycle-timed progesterone measurements to identify luteal phase deficiency.' Row 173 pplx_def: IDENTICAL text. Row 173 is supposed to define LPD itself, not the assessment.
  - **Source**: `manual comparison rows 172 vs 173`
  - **Fix**: Replace with a definition of the condition: 'Luteal phase defect (LPD), also called luteal phase deficiency, is a clinical condition characterized by inadequate corpus luteum function — insufficient progesterone production, short luteal phase (<10 days), or out-of-phase endometrial development — that may impair implantation and contribute to recurrent pregnancy loss. In RRM (Hilgers NaProTECHNOLOGY Chapter 35), LPD is diagnosed via cycle-timed post-peak progesterone panels and treated with progesterone supplementation timed to the post-ovulatory window.'

### row 174 — `Luteal Phase Deficiency (LPD)` (VI)

**Perplexity definition**:

> Luteal Phase Deficiency (LPD) is a condition of inadequate progesterone production by the corpus luteum, insufficient endometrial progesterone exposure, or endometrial resistance to progesterone — resulting in a suboptimal secretory endometrium that impairs implantation and early pregnancy maintenance. Clinically defined as luteal phase length <=10 days or mid-luteal progesterone below optimal thresholds. In NaProTECHNOLOGY, LPD is diagnosed from cycle-timed progesterone measurements (post-peak days 5, 7, 9, 11) and treated with isomolecular progesterone supplementation and/or ovulation induct...

- **[P0] hallucinated_citation**
  - **Claim**: ASRM Practice Committee (2021). Diagnosis and treatment of luteal phase deficiency. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/33934830/
  - **Evidence**: PMID 33934830 resolves to 'Proximity labeling approaches to study protein complexes during virus infection.' Adv Virus Res 2021
  - **Source**: `curl_pmid:33934830`
  - **Fix**: Replace with correct ASRM LPD PMID — the actual ASRM LPD 2021 guideline is PMID 34352299 (Fertil Steril 2021;115:1416-1423) — verify before citing

### row 177 — `Luteinizing Hormone (LH)` (VI)

**Perplexity definition**:

> Luteinizing hormone (LH) is a glycoprotein gonadotropin secreted by the anterior pituitary in a pulsatile pattern. In women, the mid-cycle LH surge (triggered by rising estradiol from the dominant follicle) is the hormonal signal that initiates the ovulatory cascade, leading to follicle rupture 36–40 hours later. Basal LH is elevated in PCOS (LH:FSH ratio >=2:1 is a PCOS marker). LH is measured in urinary ovulation predictor kits (OPKs) and in serum to time the hCG trigger. In NaProTECHNOLOGY, the LH surge is used in conjunction with CrMS Peak Day to calculate cycle timing for diagnostics and ...

- **[P0] hallucinated_citation**
  - **Claim**: Baerwald AR et al. (2003). Characterization of ovarian follicular wave dynamics. Biol Reprod. https://pubmed.ncbi.nlm.nih.gov/12724264/
  - **Evidence**: PMID 12724264 esummary: title="IGDA.5: Supplementary assessment procedures--psychopathological, neuropsychological and physical aspects.", source="Br J Psychiatry Suppl", date="2003 May", first_author="IGDA Workgroup, WPA"
  - **Source**: `curl_pmid:12724264`
  - **Fix**: Drop the fake PMID. Real Baerwald 2003 follicular wave papers exist: PMID 12826604 (Biol Reprod 69:1023-31) or PMID 12872460 (Fertil Steril 80:116-22). Replace with 12826604.

### row 180 — `Marquette Method` (II)

**Perplexity definition**:

> The Marquette Method is a FABM developed at Marquette University by Dr. Richard Fehring and colleagues. It uses the ClearBlue Fertility Monitor to measure urinary estrogen (E3G) and luteinizing hormone (LH) metabolites daily, producing objective low, high, and peak fertility readings. The monitor-based protocol can be used alone or combined with cervical mucus and basal body temperature observations. The Marquette Method is one of the RRM-compatible FABMs and is particularly effective during transitional phases (breastfeeding, perimenopause) where other methods may be less reliable due to irre...

- **[P0] hallucinated_citation**
  - **Claim**: Fehring RJ et al. (2013). Randomized comparison of two internet-supported fertility-awareness-based methods of family planning. Contraception. https://pubmed.ncbi.nlm.nih.gov/23394667/
  - **Evidence**: Re: changes in hormonal profile and seminal parameters with use of aromatase inhibitors (Niederberger 2013 J Urol) — NOT Fehring Marquette internet-supported FABM
  - **Source**: `curl_pmid:23394667`
  - **Fix**: Replace PMID 23394667 with PMID 23153900 (verified real Fehring 2013 Contraception "Randomized comparison of two Internet-supported fertility-awareness-based methods of family planning").

### row 181 — `Marquette Method Clinical Protocol` (III)

**Perplexity definition**:

> The Marquette Method is a FABM developed at Marquette University by Dr. Richard Fehring and colleagues. It uses the ClearBlue Fertility Monitor to measure urinary estrogen (E3G) and luteinizing hormone (LH) metabolites daily, producing objective low, high, and peak fertility readings. The monitor-based protocol can be used alone or combined with cervical mucus and basal body temperature observations. The Marquette Method is one of the RRM-compatible FABMs and is particularly effective during transitional phases (breastfeeding, perimenopause) where other methods may be less reliable due to irre...

- **[P0] hallucinated_citation**
  - **Claim**: Fehring RJ et al. (2013). Randomized comparison of two internet-supported fertility-awareness-based methods of family planning. Contraception. https://pubmed.ncbi.nlm.nih.gov/23394667/
  - **Evidence**: PMID 23394667 resolves to: Niederberger C (2013). 'Re: changes in hormonal profile and seminal parameters with use of aromatase inhibitors in management of infertile men with non-obstructive azoospermia.' J Urol. UNRELATED. The REAL Fehring 2013 paper with this exact title is PMID 23153900: Fehring RJ, Schneider M, Raviele K, Rodriguez D, Pruszynski J. 'Randomized comparison of two Internet-suppor
  - **Source**: `curl_pmid:23394667 + curl_pmid:23153900`
  - **Fix**: Replace PMID 23394667 with the correct PMID 23153900. Title and journal in pplx text are otherwise accurate.

### row 183 — `Mayer-Rokitansky-Kuster-Hauser (MRKH) Syndrome` (?)

**Perplexity definition**:

> Mayer-Rokitansky-Kuster-Hauser (MRKH) syndrome is a rare congenital disorder affecting approximately 1 in 4,500–5,000 females, characterized by aplasia or hypoplasia of the uterus, cervix, and upper vagina due to failure of Müllerian duct development. Affected individuals have a 46,XX karyotype, functioning ovaries, and normal external genitalia, but present with primary amenorrhea. MRKH causes absolute uterine factor infertility (UFI). Oocyte retrieval and gestational surrogacy can enable biological parenthood, and experimental uterine transplantation has been performed in selected cases.

- **[P0] hallucinated_citation**
  - **Claim**: Morcel K et al. (2007). The MRKH syndrome: epidemiology, genetics, and classification. PMC. https://pmc.ncbi.nlm.nih.gov/articles/PMC1368996/
  - **Evidence**: PMC1368996 esummary returns: Guerrier D et al. 2006 J Negat Results Biomed 'The Mayer-Rokitansky-Küster-Hauser syndrome (congenital absence of uterus and vagina)--phenotypic manifestations and genetic approaches.' Real Morcel et al. 2007 MRKH paper is in Orphanet J Rare Dis (PMID 17359527, PMC2173910).
  - **Source**: `curl_pmc:1368996`
  - **Fix**: Replace citation with 'Morcel K et al. (2007). Mayer-Rokitansky-Küster-Hauser (MRKH) syndrome. Orphanet J Rare Dis 2;13. PMID 17359527 / PMC2173910.' OR substitute Guerrier D et al. (2006) PMC1368996 if that paper is the intended source.

### row 184 — `Medical Management` (?)

**Perplexity definition**:

> FEMM (Fertility Education and Medical Management) is a women's health model that integrates fertility awareness charting with evidence-based medical management of gynecologic and reproductive conditions. FEMM is based on the science of the menstrual cycle, using biomarkers (cervical mucus, LH, estrogen) to identify the hormonal phase of each cycle. Unlike NFP methods focused primarily on family planning, FEMM emphasizes biomarker education as a health-monitoring tool and pairs it with a structured medical protocol for treating underlying cycle disorders.

- **[P0] hallucinated_citation**
  - **Claim**: Vigil P et al. (2017). Physiological basis for fertility charting. Linacre Q. https://pubmed.ncbi.nlm.nih.gov/28299975/
  - **Evidence**: PMID 28299975 esummary returns: Zhong F et al. 2017 Apr Exp Biol Med (Maywood) 'Targeted HPLC-MS/MS metabolomics differentiates metabolic syndrome' — unrelated to FEMM/charting. Vigil P + Linacre Q + fertility charting 2017 returns 0 hits on PubMed.
  - **Source**: `curl_pmid:28299975 + pubmed_search`
  - **Fix**: Drop the Vigil/PMID 28299975 citation. Either replace with a real Vigil P (Linacre Q) paper (e.g. Vigil P 2017 Linacre 84(2):203-211 — verify via Linacre direct, not PubMed) or drop FEMM-specific citation.

### row 189 — `Metformin` (?)

**Perplexity definition**:

> Metformin is a biguanide insulin sensitizer that reduces hepatic glucose production and improves peripheral insulin sensitivity. In reproductive medicine, it is used to treat insulin resistance in PCOS, reducing hyperinsulinemia and associated androgen excess to restore ovulation and regularize cycles. It may also improve response to ovulation induction agents (letrozole, clomiphene). In RRM, metformin is typically used adjunctively with dietary modification and myo-inositol, and is tapered or discontinued after ovulatory cycles are restored when possible.

- **[P0] hallucinated_citation**
  - **Claim**: Lord JM et al. (2003). Metformin in polycystic ovary syndrome: systematic review and meta-analysis. BMJ. https://pubmed.ncbi.nlm.nih.gov/12829553/
  - **Evidence**: PMID 12829553 esummary returns: Wald NJ, Law MR 2003 BMJ 'A strategy to reduce cardiovascular disease by more than 80%' — unrelated. Real Lord JM 2003 BMJ metformin PCOS paper = PMID 14576245 (BMJ 2003 Oct 25).
  - **Source**: `curl_pmid:12829553 + pubmed_search`
  - **Fix**: Replace PMID with 14576245 (Lord JM, Flight IH, Norman RJ — BMJ 2003;327:951).
- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2014). Letrozole versus clomiphene for infertility in PCOS. N Engl J Med. https://pubmed.ncbi.nlm.nih.gov/24926259/
  - **Evidence**: PMID 24926259 esummary returns: Kanda T et al. 2014 Case Rep Oncol 'Hepatocellular carcinoma in HCV patients during phlebotomy' — unrelated. Real Legro RS et al. NEJM 2014 letrozole paper = PMID 25006718 (N Engl J Med 2014 Jul 10;371(2):119-29).
  - **Source**: `curl_pmid:24926259 + pubmed_search`
  - **Fix**: Replace PMID with 25006718.

### row 192 — `Microsurgery` (V)

**Perplexity definition**:

> Reproductive microsurgery refers to precision surgical techniques performed under high magnification (operating microscope or magnifying loupes) with microsurgical instruments, delicate suture materials (5-0 to 8-0 absorbable suture), and meticulous tissue handling to optimize outcomes while minimizing trauma and adhesion formation. In NaProTECHNOLOGY, the operative approach is termed NARPS (NaProTECHNOLOGY Anti-adhesion Reconstructive Pelvic Surgery), incorporating PEARS anti-adhesion principles. Applications include tubal anastomosis, neosalpingostomy, fimbrioplasty, and ovarian cystectomy. ...

- **[P0] drift**
  - **Claim**: In NaProTECHNOLOGY, the operative approach is termed NARPS (NaProTECHNOLOGY Anti-adhesion Reconstructive Pelvic Surgery)
  - **Evidence**: Col D row 213 explicitly defines NARPS as 'Near Adhesion-Free Reconstructive Pelvic Surgery' (NOT 'NaProTECHNOLOGY Anti-adhesion Reconstructive Pelvic Surgery'). Glossary SSOT and Perplexity definition disagree on the acronym expansion.
  - **Source**: `col_D_row_213_term`
  - **Fix**: Reconcile: confirm with Brian / Hilgers textbook which expansion is canonical. If 'Near Adhesion-Free' per col D row 213 is right, rewrite as: 'the operative approach is termed NARPS (Near Adhesion-Free Reconstructive Pelvic Surgery)'.

### row 197 — `Mucus Cycle` (II)

**Perplexity definition**:

> A Limited Mucus Cycle is a CrMS chart finding in which cervical mucus production is reduced in quantity, shortened in duration (fewer days of mucus), or restricted in quality (lacking clear, stretchy, or lubricative characteristics) compared to normal fertile mucus patterns. Limited mucus cycles may indicate cervical factor infertility, decreased estrogen stimulation of cervical crypts, post-surgical cervical changes, or chronic cervicitis. In NaProTECHNOLOGY, limited mucus is evaluated clinically and treated with targeted estrogen support or antibiotics when infectious etiology is suspected.

- **[P0] hallucinated_citation**
  - **Claim**: Odeblad E (1997). Cervical mucus and their functions. J Ir Coll Physicians Surg. https://pubmed.ncbi.nlm.nih.gov/9382348/
  - **Evidence**: [Influence of the middle ear on otoacoustic emissions] (Mir Plana 1997 An Esp Pediatr) — NOT Odeblad cervical mucus
  - **Source**: `curl_pmid:9382348`
  - **Fix**: Drop PMID 9382348. Odeblad 1997 "The discovery of different types of cervical mucus and the Billings Ovulation Method" Bulletin of the Natural Family Planning Council of Victoria 21:3-35 is the canonical Odeblad reference; PubMed may not index it. Replace or remove PMID.
- **[P0] hallucinated_citation**
  - **Claim**: Moghissi KS (1972). Sperm penetration through cervical mucus and cervical mucus-sperm interaction. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/4675613/
  - **Evidence**: [Communicational aspects of Japanese language of schizophrenic patients] (Ikeda 1972 Seishin Shinkeigaku Zasshi) — NOT Moghissi sperm penetration through cervical mucus
  - **Source**: `curl_pmid:4675613`
  - **Fix**: Drop PMID. Moghissi published Fertil Steril papers on cervical mucus in the 1970s but PMID 4675613 is a 1972 Japanese psychiatric paper — find correct PMID via PubMed for Moghissi sperm-cervical mucus interaction.

### row 201 — `Myo-Inositol` (VI)

**Perplexity definition**:

> Myo-inositol is a naturally occurring sugar alcohol and second messenger in insulin signaling pathways. In PCOS, myo-inositol supplementation (typically 2–4 g/day, often combined with D-chiro-inositol in a 40:1 ratio) reduces insulin resistance, lowers androgen levels, and restores ovulatory function. Studies report improvements in follicle quality, menstrual regularity, and pregnancy rates. In RRM, myo-inositol is a first-line nutritional intervention for PCOS and insulin resistance before or alongside pharmacologic treatment with metformin or letrozole.

- **[P0] hallucinated_citation**
  - **Claim**: Unfer V et al. (2012). Myo-inositol as the physiological inositol for normal insulin function. Eur Rev Med Pharmacol Sci. https://pubmed.ncbi.nlm.nih.gov/22803269/
  - **Evidence**: PMID 22803269 resolves to 'Curbing gagging reflex.' N Y State Dent J 2012
  - **Source**: `curl_pmid:22803269`
  - **Fix**: Replace with correct Unfer myo-inositol PMID (search returned PMID 17710559 etc.) — verify before citing
- **[P0] hallucinated_citation**
  - **Claim**: Raffone E et al. (2010). Insulin sensitiser agents alone and in co-treatment with PCOS in fertility. Gynecol Endocrinol. https://pubmed.ncbi.nlm.nih.gov/19639493/
  - **Evidence**: PMID 19639493 returns 'cannot get document summary' from PubMed — invalid
  - **Source**: `curl_pmid:19639493`
  - **Fix**: Replace with verified Raffone myo-inositol PMID 22122627 or 22587479 (search results)
- **[P0] hallucinated_citation**
  - **Claim**: ISGE Consensus (2013). Myo-inositol in the treatment of PCOS: the unresolved questions. Gynecol Endocrinol. https://pubmed.ncbi.nlm.nih.gov/23659659/
  - **Evidence**: PMID 23659659 returns 'cannot get document summary' — invalid
  - **Source**: `curl_pmid:23659659`
  - **Fix**: Verify ISGE Consensus PMID or remove citation

### row 202 — `Myomectomy` (V)

**Perplexity definition**:

> Myomectomy is the surgical removal of uterine fibroids (leiomyomas) while preserving the uterus and future fertility. Approaches include hysteroscopic myomectomy (for submucosal fibroids distorting the cavity), laparoscopic myomectomy (for intramural or subserosal fibroids <=8-10 cm), and open abdominal myomectomy (for large, multiple, or complex fibroids). In RRM, myomectomy is preferred over hysterectomy in women who wish to preserve fertility, addressing anatomical causes of implantation failure, heavy bleeding, and recurrent pregnancy loss caused by fibroids.

- **[P0] hallucinated_citation**
  - **Claim**: Pritts EA et al. (2009). Fibroids and infertility: an updated systematic review of the evidence. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/18471809/
  - **Evidence**: PMID 18471809 resolves to: 'Twist1 homodimers enhance FGF responsiveness of the cranial sutures and promote suture closure.' Connerney J, Andreeva V, Leshem Y. Dev Biol 318, 2008 Jun 15. NOT a Pritts fibroids paper. The real Pritts 2009 paper (Pritts EA, Parker WH, Olive DL. Fibroids and infertility: an updated systematic review of the evidence. Fertil Steril 2009;91:1215-1223) is a different PMID
  - **Source**: `curl_pmid:18471809`
  - **Fix**: Replace PMID 18471809 with the verified real Pritts EA, Parker WH, Olive DL Fertil Steril 2009 PMID (search PubMed for the exact title).

### row 204 — `NaPro Surgery / Advanced Reproductive Surgery` (III)

**Perplexity definition**:

> Electrosurgery in reproductive surgery uses electrical energy to cut, coagulate, or vaporize tissue. Monopolar electrosurgery (current flows from active electrode through the body to a return pad) provides cutting and coagulation with high power concentration; bipolar electrosurgery (current flows between two electrode tips only) is safer near delicate structures (fallopian tubes, ureter, bowel) and is standard in most NaProTECHNOLOGY laparoscopic procedures. In endometriosis excision surgery, electrosurgery is used for precise cutting and hemostasis; however, indiscriminate coagulation of end...

- **[P0] drift**
  - **Claim**: Electrosurgery in reproductive surgery uses electrical energy to cut, coagulate, or vaporize tissue. Monopolar electrosurgery... bipolar electrosurgery... [entire definition reframes 'NaPro Surgery' as a generic electrosurgery primer]
  - **Evidence**: Term D is 'NaPro Surgery / Advanced Reproductive Surgery'. Col AA points to Chapter 38 'Trends and Deficiencies in Infertility'. The Perplexity definition is OFF-TOPIC — it defines electrosurgery (a tool/modality), not the NaPro surgical framework as a clinical category. The defining feature of NaPro Surgery is sharp excision of endometriosis, structural reconstruction (PEARS), fertility-sparing t
  - **Source**: `col_AA_rrm_textbook + term_label_mismatch`
  - **Fix**: REWRITE: 'NaPro Surgery (Advanced Reproductive Surgery) is the surgical arm of NaProTECHNOLOGY: a fertility-restorative approach to gynecologic and reproductive pathology emphasizing complete excision of endometriosis (preferring sharp excision over coagulation/fulguration), microsurgical principles, peritoneal adhesion prevention, and reconstructive/fertility-preserving technique. It is the surgical complement to NaPro medical management, used to correct anatomic causes of infertility, recurrent pregnancy loss, and chronic pelvic pain.'
- **[P0] hallucinated_citation**
  - **Claim**: Jones KD et al. (2001). Endometriosis excision techniques. Curr Opin Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/11433129/
  - **Evidence**: PMID 11433129 resolves to: Gosse P, Bemurat L, Mas D (2001). 'Ambulatory measurement of the QKD interval normalized to heart rate and systolic blood pressure to assess arterial diste...'. Journal: Blood pressure monitoring. UNRELATED to endometriosis or Jones KD.
  - **Source**: `curl_pmid:11433129`
  - **Fix**: Drop the Jones 2001 citation. If endometriosis-excision technique citation needed, use Wright JT or Redwine DB excision-technique literature (e.g., Redwine 2003 'Surgical management of endometriosis', Hum Reprod). Verify any replacement PMID via curl.

### row 205 — `NaProTECHNOLOGY (Natural Procreative Technology)` (III)

**Perplexity definition**:

> NaProTECHNOLOGY (Natural Procreative Technology) is a women's health science developed by Dr. Thomas Hilgers at the Pope Paul VI Institute that monitors and maintains reproductive and gynecologic health by working cooperatively with the menstrual and fertility cycles. It uses the Creighton Model FertilityCare System to identify biological markers of cycle function, then applies targeted medical and surgical treatments to correct identified abnormalities. NaProTECHNOLOGY is the most extensively published approach within RRM, with outcome studies reporting cumulative live birth rates exceeding 6...

- **[P0] fabricated_stat**
  - **Claim**: outcome studies reporting cumulative live birth rates exceeding 60% over 24 months in infertile patients
  - **Evidence**: Stanford et al. (Irish general practice): 52.8% cumulative live-birth rate over up to 24 months. Tham et al. (Canadian family practice): 66% life-table analysis (not 24-month cumulative); 38% crude. Boyle: 44.2% live birth over three years. The 2025 single-center adjusted figure is 62.1% but is take-home baby rate adjusted for active participation, not 24-month cumulative.
  - **Source**: `pplx_fresh + PMC12660242 + factsaboutfertility.org review`
  - **Fix**: Replace with 'outcome studies reporting cumulative live birth rates around 52-66% with treatment duration up to 24 months (Stanford Irish cohort 52.8%; Tham Canadian cohort 66% life-table; varying by completion definition)' or 'cumulative live birth rates of approximately 50-65% over up to 24-36 months of treatment depending on cohort and completion criteria'.

### row 208 — `NaProTECHNOLOGY vs. RRM` (VIII)

**Perplexity definition**:

> NaProTECHNOLOGY (Natural Procreative Technology) and Restorative Reproductive Medicine (RRM) are related but not interchangeable. RRM is the umbrella scientific paradigm that defines the field: a medical approach that diagnoses and treats the underlying causes of reproductive dysfunction (infertility, miscarriage, abnormal bleeding, endometriosis, PCOS) with the goal of restoring normal physiology, in cooperation with the natural reproductive process and without bypassing it through assisted reproductive technology. NaProTECHNOLOGY is the most established, longest-published, and most clinicall...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle P, Stanford J, Restorative reproductive medicine for infertility in two family medicine clinics in Europe, an observational study, BMC Pregnancy Childbirth 2023;23:43
  - **Evidence**: The real paper is: Stanford JB, Carpentier PA, Meier BL, Rollo M, Tingey B (Boyle NOT an author). 'Restorative reproductive medicine for infertility in two family medicine clinics in New England, an observational study.' BMC Pregnancy Childbirth 2021. PMID 34233646.
  - **Source**: `europepmc_TITLE_search:restorative+reproductive+medicine+for+infertility`
  - **Fix**: Replace citation with: Stanford JB, Carpentier PA, Meier BL, Rollo M, Tingey B. Restorative reproductive medicine for infertility in two family medicine clinics in New England, an observational study. BMC Pregnancy Childbirth 2021;21:495 (PMID 34233646). Note: NOT Europe, NOT 2023, Boyle NOT first author.

### row 209 — `Natural Family Planning (NFP)` (II)

**Perplexity definition**:

> Natural Family Planning (NFP) is an umbrella term for methods of achieving or avoiding pregnancy based on identifying the fertile window through observation of biological signs, without the use of drugs or devices. Approved by the Catholic Church, NFP methods include the Creighton Model, Billings Ovulation Method, Symptothermal Method, and Marquette Method. In the RRM context, NFP and fertility awareness methods serve dual purposes: family planning and the clinical monitoring of gynecologic health, forming the diagnostic foundation for medical management.

- **[P0] hallucinated_citation**
  - **Claim**: Smoley BA, Robinson CM (2012). Natural family planning. Am Fam Physician. https://pubmed.ncbi.nlm.nih.gov/23062052/
  - **Evidence**: Evaluation of asymptomatic atrial fibrillation (Newell 2012 Am Fam Physician) — NOT Smoley NFP
  - **Source**: `curl_pmid:23062052`
  - **Fix**: Drop or replace with correct PMID for Smoley 2012 NFP review.

### row 211 — `Natural Fertility` (I)

**Perplexity definition**:

> Natural fertility is the inherent biological capacity of a couple to achieve pregnancy through in-vivo conception—that is, intercourse during the fertile window of the menstrual cycle—without removing gametes, without external fertilization, and without bypassing any organ system. The age-corrected per-cycle natural fecundability of healthy young couples is approximately 20–25%, declining progressively with maternal age and with the presence of unaddressed conditions such as endometriosis, tubal disease, ovulatory dysfunction, or male-factor infertility. In Restorative Reproductive Medicine, r...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle P, Stanford J, Restorative reproductive medicine for infertility, BMC Pregnancy Childbirth 2023;23:43
  - **Evidence**: CrossRef title-search returns 'Restorative reproductive medicine for infertility in two family medicine clinics in NEW ENGLAND' BMC Pregnancy Childbirth vol 21, 2021, DOI 10.1186/s12884-021-03946-8. The 2023 vol 23 page 43 attribution is fabricated.
  - **Source**: `crossref_query`
  - **Fix**: Replace 'BMC Pregnancy Childbirth 2023;23:43' with 'BMC Pregnancy Childbirth 2021;21 (DOI 10.1186/s12884-021-03946-8)' — and note the 'New England' (not 'Europe') study scope.

### row 212 — `Natural Killer (NK) Cells` (VI)

**Perplexity definition**:

> Peripheral blood natural killer (pbNK) cells are circulating cytotoxic lymphocytes (CD56dim/CD16bright) that are distinct from uterine NK cells in both phenotype and function. Elevated peripheral NK cell activity (measured by cytotoxicity assays) has been proposed as a marker of reproductive immunological abnormality in recurrent miscarriage, though the evidence is controversial and testing is not standardized across laboratories. Some RRM practitioners include pbNK cell cytotoxicity as part of the immune evaluation for unexplained RPL, particularly in patients with Hashimoto's thyroiditis, en...

- **[P0] hallucinated_citation**
  - **Claim**: Moffett A, Colucci F (2014). Uterine NK cells at the maternal-fetal interface. J Clin Invest. https://pubmed.ncbi.nlm.nih.gov/24569374/
  - **Evidence**: PMID 24569374 esummary: title="Targeting ER stress-induced autophagy overcomes BRAF inhibitor resistance in melanoma.", source="J Clin Invest", date="2014 Mar", first_author="Ma XH"
  - **Source**: `curl_pmid:24569374`
  - **Fix**: Drop the fake PMID. Real Moffett & Colucci 2014 JCI paper is PMID 24789879: "Uterine NK cells: active regulators at the maternal-fetal interface" J Clin Invest 124:1872-9 2014 May. Replace 24569374 -> 24789879.

### row 213 — `Near Adhesion-Free Reconstructive Pelvic Surgery (NARPS)` (V)

**Perplexity definition**:

> Reproductive microsurgery refers to precision surgical techniques performed under high magnification (operating microscope or magnifying loupes) with microsurgical instruments, delicate suture materials (5-0 to 8-0 absorbable suture), and meticulous tissue handling to optimize outcomes while minimizing trauma and adhesion formation. In NaProTECHNOLOGY, the operative approach is termed NARPS (NaProTECHNOLOGY Anti-adhesion Reconstructive Pelvic Surgery), incorporating PEARS anti-adhesion principles. Applications include tubal anastomosis, neosalpingostomy, fimbrioplasty, and ovarian cystectomy. ...

- **[P0] drift**
  - **Claim**: Reproductive microsurgery refers to precision surgical techniques...
  - **Evidence**: Term D = 'Near Adhesion-Free Reconstructive Pelvic Surgery (NARPS)' but col J defines MICROSURGERY (verbatim duplicate of row 192 col J). The two entries (microsurgery vs NARPS) need distinct definitions: NARPS is specifically the NaPro/Hilgers protocol for anti-adhesion reconstructive surgery (per col AA Ch 62 'What is Surgical NaProTECHNOLOGY?'); microsurgery is the broader technique. Pplx colla
  - **Source**: `col_D_term+col_AA_Chapter_62`
  - **Fix**: REWRITE: 'NARPS (Near Adhesion-Free Reconstructive Pelvic Surgery) is the NaProTECHNOLOGY surgical protocol developed by Dr. Thomas Hilgers at the Pope Paul VI Institute. It combines microsurgical principles (high magnification, atraumatic technique, fine sutures) with rigorous anti-adhesion measures (meticulous hemostasis, anti-adhesion barriers, continuous irrigation) to perform reconstructive pelvic surgery with minimal postoperative adhesion formation. Applications include tubal anastomosis, neosalpingostomy/fimbrioplasty, ovarian cystectomy, and excision of pelvic endometriosis (PEARS).'

### row 222 — `Omega-3 Fatty Acids (Fertility Context)` (?)

**Perplexity definition**:

> Omega-3 polyunsaturated fatty acids (PUFAs) — primarily EPA (eicosapentaenoic acid) and DHA (docosahexaenoic acid) from marine sources — exert anti-inflammatory effects by competing with arachidonic acid for cyclooxygenase and lipoxygenase pathways, reducing prostaglandin E2 and inflammatory cytokine production. In reproductive medicine, omega-3s are associated with improved oocyte quality, reduced endometriosis-related inflammation, improved sperm motility and morphology, better endometrial blood flow, and reduced risk of pre-term birth. In RRM and NeoFertility, omega-3 supplementation (1–3 g...

- **[P0] hallucinated_citation**
  - **Claim**: Hammiche F et al. (2011). Increased pre-conception omega-3 polyunsaturated fatty acid intake improves embryo morphology. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/21411614/
  - **Evidence**: PMID 21411614 esummary returns: Gittelsohn J et al. 2011 May Am J Clin Nutr 'Preventing diabetes and obesity in American Indian communities' — unrelated. Real Hammiche F et al. omega-3 embryo morphology paper = PMID 21130435.
  - **Source**: `curl_pmid:21411614 + pubmed_search`
  - **Fix**: Replace PMID with 21130435 (Hammiche F, Vujkovic M, Wijburg W, et al. Fertil Steril 2011;95(5):1820-3).

### row 226 — `Ovarian Cystectomy` (?)

**Perplexity definition**:

> Ovarian cystectomy is the surgical removal of an ovarian cyst while preserving the remaining ovarian tissue. In reproductive-aged women, the most common indication in the RRM/fertility context is endometrioma (chocolate cyst), which impairs folliculogenesis and oocyte quality. The preferred technique is laparoscopic stripping (excision of the cyst wall) rather than drainage and ablation. However, cystectomy carries a risk of inadvertent removal of ovarian cortex containing primordial follicles, potentially reducing ovarian reserve — a risk that must be weighed against the inflammatory damage o...

- **[P0] hallucinated_citation**
  - **Claim**: Somigliana E et al. (2012). Surgery vs. expectant management for endometrioma and ovarian reserve. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/22632997/
  - **Evidence**: PMID 22632997 esummary returns: Nafisi S et al. 2012 J Photochem Photobiol B 'Effect of Se salts on DNA structure' — unrelated. Real Somigliana E et al. 2012 ovarian reserve paper = PMID 22975114.
  - **Source**: `curl_pmid:22632997 + pubmed_search`
  - **Fix**: Replace PMID with 22975114 (Somigliana E et al. Fertil Steril 2012;98(6):1531-8).

### row 227 — `Ovarian Drilling (Laparoscopic Ovarian Drilling / LOD)` (?)

**Perplexity definition**:

> Laparoscopic Ovarian Drilling (LOD) is a surgical procedure for PCOS in which multiple electrocautery or laser punctures are made in the ovarian cortex and stroma, reducing androgen-producing tissue and lowering serum androgen and LH levels. This can restore spontaneous ovulation and improve response to ovulation induction in women with clomiphene-resistant anovulatory PCOS. LOD has largely replaced ovarian wedge resection due to lower adhesion risk. In RRM, LOD is reserved for patients who fail first-line medical ovulation induction with letrozole and/or metformin.

- **[P0] hallucinated_citation**
  - **Claim**: Gjönnaess H (1984). Polycystic ovarian syndrome treated by ovarian electrocautery. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/6202539/
  - **Evidence**: PMID 6202539 esummary returns: de Jongste JC, Kerrebijn KF 1984 Eur J Respir Dis 'Bronchial responsiveness and leucocyte reactivity after influenza vaccine in asthmatic patients' — unrelated. Real Gjønnaess H 1984 paper exists in Fertil Steril (PMID could not be located via simple esearch within the cost cap; original Gjønnaess paper title 'Polycystic ovarian syndrome treated by ovarian electrocau
  - **Source**: `curl_pmid:6202539 + pubmed_search`
  - **Fix**: Replace PMID with the correct Gjønnaess 1984 Fertil Steril PMID (find via direct DOI/PMID lookup or drop the PMID and keep the journal+volume+pages citation only).

### row 229 — `Ovarian Reserve` (IV)

**Perplexity definition**:

> Ovarian reserve refers to the quantity and quality of oocytes remaining in a woman's ovaries, reflecting her reproductive potential. Key markers include Anti-Müllerian Hormone (AMH), basal FSH (day 2–4), basal estradiol, and Antral Follicle Count (AFC) on transvaginal ultrasound. AMH and AFC are the most reliable predictors of ovarian response. Diminished ovarian reserve (DOR) is indicated by AMH <1.0–1.1 ng/mL, AFC <5–7, and/or FSH >10 IU/L. In RRM, ovarian reserve testing is part of the initial infertility workup, and DOR triggers investigation for treatable contributing causes.

- **[P0] hallucinated_citation**
  - **Claim**: Broekmans FJ et al. (2006). A systematic review of tests predicting ovarian reserve and IVF outcome. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/17071849/
  - **Evidence**: PMID 17071849 esummary returns: 'Wild and aquaculture populations of the eastern oyster compared using microsatellites.' Carlsson J, 2006, J Hered. Real Broekmans 2006 paper = PMID 16891297 (Hum Reprod Update).
  - **Source**: `curl_pmid:17071849 + europepmc_search`
  - **Fix**: Replace fabricated PMID 17071849 with real PMID 16891297.

### row 230 — `Ovulation Confirmation` (?)

**Perplexity definition**:

> Ovulation confirmation in RRM refers to the use of serial transvaginal ultrasound to verify that follicle rupture has occurred — not merely that ovulation signs are present. A confirmed ovulation requires documentation of follicle collapse (>50% reduction in follicle diameter) with or without free fluid in the cul-de-sac. Confirmation distinguishes true ovulation from LUF syndrome, partial rupture, or delayed rupture. Ovulation confirmation is a defining feature of the NaProTECHNOLOGY and NeoFertility follicle maturation study protocol and is used to guide timing of hCG trigger and progesteron...

- **[P0] hallucinated_citation**
  - **Claim**: Chui DKC et al. (1997). Ultrasound evidence of LUF in unexplained infertility. Br J Obstet Gynaecol. https://pubmed.ncbi.nlm.nih.gov/9051789/
  - **Evidence**: PMID 9051789 esummary returns: Okere CO, Murata T 1996 Neuroreport 'effect of systemic and central nitric oxide administration on milk availability in lactating rats' — unrelated. PubMed search for 'Chui ultrasonography luteinized unruptured follicle' returns 0 hits.
  - **Source**: `curl_pmid:9051789 + pubmed_search`
  - **Fix**: Drop citation OR replace with a real LUF ultrasound study (e.g. Hamilton CJ et al. 1985 Br J Obstet Gynaecol PMID 4051411 OR Killick & Elstein 1987 Fertil Steril) — verify before insertion.

### row 235 — `Patient-Centered Care` (VIII)

**Perplexity definition**:

> Patient-centered care is the design and delivery of health care around the values, preferences, biology, and informed consent of the individual patient rather than around institutional convenience or specialty silos. The Institute of Medicine’s 2001 report Crossing the Quality Chasm identified patient-centered care as one of six aims of high-quality health care. In Restorative Reproductive Medicine, patient-centered care is operationalized at every step: women are taught to read their own cycles through fertility charting (body literacy), giving them direct insight into their hormonal and phys...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle P, Stanford J, Restorative reproductive medicine for infertility, BMC Pregnancy Childbirth 2023;23:43
  - **Evidence**: Same hallucinated citation pattern as Row 208. Real paper: Stanford JB et al. (Boyle NOT author), 'two family medicine clinics in New England', BMC Pregnancy Childbirth 2021, PMID 34233646.
  - **Source**: `europepmc_TITLE_search:restorative+reproductive+medicine+for+infertility`
  - **Fix**: Replace with: Stanford JB, Carpentier PA, Meier BL, Rollo M, Tingey B. BMC Pregnancy Childbirth 2021;21:495. PMID 34233646.

### row 236 — `PCOS (Polycystic Ovary Syndrome)` (VI)

**Perplexity definition**:

> Polycystic Ovary Syndrome (PCOS) is the most common endocrine disorder in reproductive-aged women (affecting 10–13%), characterized by hyperandrogenism, ovulatory dysfunction, and polycystic ovarian morphology (per Rotterdam criteria: 2 of 3 features required). PCOS involves insulin resistance in approximately 70–80% of affected women, driving androgen overproduction, follicular arrest, and anovulation. In RRM, PCOS is treated restoratively: dietary and lifestyle modification to address insulin resistance, myo-inositol, metformin, letrozole for ovulation induction, and laparoscopic ovarian dri...

- **[P0] hallucinated_citation**
  - **Claim**: Rotterdam ESHRE/ASRM-Sponsored PCOS Consensus (2004). Revised 2003 consensus on criteria for PCOS. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/14711594/
  - **Evidence**: PMID 14711594 resolves to: 'Analysis in Escherichia coli of Plasmodium falciparum dihydropteroate synthase (DHPS) alleles implicated in resistance to sulfadoxine.' Int J Parasitol 2004
  - **Source**: `curl_pmid:14711594`
  - **Fix**: Replace with correct Rotterdam consensus PMIDs: 14755292 (Fertil Steril 2004;81:19-25) or 14688154 (Hum Reprod 2004;19:41-7)

### row 240 — `Peak Day` (II)

**Perplexity definition**:

> Peak Day is a specific observational marker in the Creighton Model FertilityCare System (CrMS) defined as the last day in a menstrual cycle on which cervical mucus is observed to be clear, stretchy (like raw egg white), or lubricative. Peak Day correlates closely with ovulation, occurring within ±3 days of follicle rupture in 95% of cycles. It is identified retrospectively — the day after Peak Day is called post-peak day 1 (P+1). In NaProTECHNOLOGY, Peak Day is the reference point for timing cycle-timed diagnostic blood draws (e.g., P+7 progesterone) and treatment protocols.

- **[P0] hallucinated_citation**
  - **Claim**: Hilgers TW et al. (1978). Natural family planning I: the peak symptom. Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/683622/
  - **Evidence**: Amniotic fluid copper and zinc concentrations in human pregnancy (Chez 1978 Obstet Gynecol) — NOT Hilgers peak symptom
  - **Source**: `curl_pmid:683622`
  - **Fix**: Replace PMID 683622 with PMID 724176 (verified real Hilgers 1978 peak symptom paper).
- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB et al. (2003). Characteristics of the menstrual cycle after discontinuation of oral contraceptives. J Womens Health. https://pubmed.ncbi.nlm.nih.gov/12737707/
  - **Evidence**: Toward optimal health: experts discuss diet debate (Elliot 2003 J Womens Health) — NOT Stanford menstrual cycle after OCs
  - **Source**: `curl_pmid:12737707`
  - **Fix**: Replace PMID 12737707 with PMID 21219248 (Nassaralla CL/Stanford JB 2011 J Womens Health "Characteristics of the menstrual cycle after discontinuation of oral contraceptives"); year should be 2011, not 2003.

### row 242 — `PEARS (Pelvic Excision And Repair Surgery)` (V)

**Perplexity definition**:

> PEARS (Pelvic Endoscopic and Reconstructive Surgery, also referred to in NaProTECHNOLOGY as Anti-adhesion Reconstructive Pelvic Surgery) refers to the suite of surgical principles and anti-adhesion techniques developed by Dr. Thomas Hilgers at the Pope Paul VI Institute to prevent postoperative pelvic adhesion formation during reproductive surgery. PEARS principles include: meticulous hemostasis, avoidance of ischemia, minimal tissue desiccation with constant irrigation, precise tissue dissection, and placement of anti-adhesion barriers (oxidized regenerated cellulose, sodium hyaluronate-carbo...

- **[P0] drift**
  - **Claim**: PEARS (Pelvic Endoscopic and Reconstructive Surgery, also referred to in NaProTECHNOLOGY as Anti-adhesion Reconstructive Pelvic Surgery)
  - **Evidence**: Col D term = 'PEARS (Pelvic Excision And Repair Surgery)' and col AA Hilgers Chapter 70 verbatim opens: 'PEARS (Pelvic Excision and Repair Surgery) is a form of plastic reconstructive surgery of the pelvis...' The pplx expansion 'Pelvic Endoscopic and Reconstructive Surgery' DIRECTLY CONTRADICTS the RRM textbook (col AA) and glossary SSOT (col D).
  - **Source**: `col_D_term+col_AA_Chapter_70`
  - **Fix**: REWRITE: 'PEARS (Pelvic Excision and Repair Surgery) is a form of plastic reconstructive pelvic surgery developed by Dr. Thomas Hilgers at the Pope Paul VI Institute. It is performed primarily for excision of pelvic endometriosis (Ch 70) and extensive pelvic adhesive disease (Ch 73), and it combines meticulous excisional technique with rigorous anti-adhesion measures: hemostasis, avoidance of ischemia, minimal tissue desiccation, constant irrigation, and placement of anti-adhesion barriers (oxidized regenerated cellulose, sodium hyaluronate-carboxymethylcellulose). See also: NARPS (Near Adhesion-Free Reconstructive Pelvic Surgery).'
- **[P0] hallucinated_citation**
  - **Claim**: Liakakos T et al. (2001). Peritoneal adhesions: etiology, pathophysiology, and clinical significance. Dig Surg. https://pubmed.ncbi.nlm.nih.gov/11309004/
  - **Evidence**: PMID 11309004 resolves to: 'No impact of a leucocyte depleting arterial line filter on patient recovery after cardiopulmonary bypass.' Sahlman A, Ahonen J, Salo JA. Acta Anaesthesiol Scand 45, 2001 May. NOT the Liakakos peritoneal-adhesions paper. The real Liakakos paper is PMID 11528133 ('Peritoneal adhesions: etiology, pathophysiology, and clinical significance. Recent advances in prevention and
  - **Source**: `curl_pmid:11309004+europepmc:11528133`
  - **Fix**: Replace PMID 11309004 with verified real PMID 11528133.

### row 244 — `Pelvic Adhesions (Scar Tissue)` (VI)

**Perplexity definition**:

> Pelvic adhesions are bands of scar tissue that form between pelvic organs — including the ovaries, fallopian tubes, uterus, bowel, and bladder — as a result of prior surgery, infection (PID), endometriosis, or ruptured appendix. Adhesions distort pelvic anatomy, impair tubal motility and oocyte capture, and are a significant cause of infertility, chronic pelvic pain, and dyspareunia. Diagnosis requires laparoscopy; treatment is surgical adhesiolysis. In NaProTECHNOLOGY, pelvic adhesions are treated using NARPS/PEARS anti-adhesion principles to minimize recurrence.

- **[P0] hallucinated_citation**
  - **Claim**: Liakakos T et al. (2001). Peritoneal adhesions: etiology, pathophysiology, and clinical significance. Dig Surg. https://pubmed.ncbi.nlm.nih.gov/11309004/
  - **Evidence**: PMID 11309004 resolves to 'No impact of a leucocyte depleting arterial line filter on patient recovery after cardiopulmonary bypass.' Acta Anaesthesiol Scand 2001
  - **Source**: `curl_pmid:11309004`
  - **Fix**: Replace with verified PMID for Liakakos peritoneal adhesions paper (search PubMed; actual paper appears to exist in Dig Surg 2001;18:260-273, find correct PMID)

### row 245 — `Pelvic Floor Physical Therapy` (VII)

**Perplexity definition**:

> Pelvic floor physical therapy (PFPT) is a specialized form of physical therapy focused on assessment and treatment of the pelvic floor musculature, connective tissue, and associated neural structures. Indications in the RRM context include: pelvic floor hypertonicity contributing to dyspareunia, vaginismus, and vulvodynia; chronic pelvic pain associated with endometriosis or adhesions; interstitial cystitis; postoperative rehabilitation; and bladder/bowel dysfunction. PFPT employs internal and external manual therapy, biofeedback, therapeutic exercise, and patient education. In RRM, PFPT is an...

- **[P0] hallucinated_citation**
  - **Claim**: Hartmann D et al. (2011). Physical therapy for women with chronic vulvar pain. Am J Obstet Gynecol. https://pubmed.ncbi.nlm.nih.gov/21600399/
  - **Evidence**: PMID 21600399 actually resolves to: TITLE: 'Enrichment of a common wheat genetic map and QTL mapping for fatty acid content in grain.' AUTHORS: Wang YY, Sun XY, Zhao Y, Kong FM. JOURNAL: Plant Sci. YEAR: 2011 Jul. Completely unrelated paper.
  - **Source**: `curl_pmid:21600399`
  - **Fix**: Replace with real Hartmann citation. Closest real PMID = 20868404 (Hartmann D, 'Chronic vulvar pain from a physical therapy perspective,' Dermatol Ther 2010 Sep-Oct). Or drop and use ACOG CO 673 (which IS real and in K).

### row 248 — `Personalized Treatment` (I)

**Perplexity definition**:

> Personalized treatment in Restorative Reproductive Medicine is the practice of tailoring medical and surgical interventions to the specific underlying conditions identified during a comprehensive evaluation, the patient’s age and ovarian reserve, the couple’s reproductive goals, and concurrent comorbidities, rather than applying a uniform algorithm to all patients with a presenting symptom such as infertility, dysmenorrhea, or recurrent pregnancy loss. Personalization in RRM is built on cycle-timed diagnostics: hormone draws ordered at biologically meaningful days (P+3, P+7, P+9 progesterone; ...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle P, Stanford J, Restorative reproductive medicine for infertility in two family medicine clinics in Europe, an observational study, BMC Pregnancy Childbirth 2023;23:43
  - **Evidence**: Real paper is 'in two family medicine clinics in NEW ENGLAND' BMC Pregnancy Childbirth 2021;21 DOI 10.1186/s12884-021-03946-8. Europe/2023/vol23/p43 is fabricated.
  - **Source**: `crossref_query`
  - **Fix**: Replace with verified 2021 New England citation.

### row 252 — `Polycystic Ovarian Morphology (PCOM)` (?)

**Perplexity definition**:

> Polycystic Ovarian Morphology (PCOM) is one of the three Rotterdam diagnostic criteria for PCOS, defined as the presence of >=12 antral follicles measuring 2–9 mm in one or both ovaries, or an ovarian volume >10 mL on transvaginal ultrasound (updated thresholds with high-resolution ultrasound may be >=20 follicles). PCOM can occur without PCOS (present in 20–30% of reproductively normal women). It reflects follicular arrest from androgen excess and elevated AMH. In the RRM context, PCOM is one element of the PCOS phenotype evaluated alongside androgens and ovulatory function.

- **[P0] hallucinated_citation**
  - **Claim**: Rotterdam ESHRE/ASRM-Sponsored PCOS Consensus (2004). Revised 2003 consensus. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/14711594/
  - **Evidence**: PMID 14711594 esummary returns: Berglez J et al. 2004 Int J Parasitol 'Plasmodium falciparum dihydropteroate synthase (DHPS) alleles' — unrelated. Real Rotterdam 2004 PCOS Consensus paper = PMID 14711538 (Fertil Steril 2004;81(1):19-25) OR PMID 14741884 (Hum Reprod 2004;19(1):41-7 — the Hum Reprod twin paper).
  - **Source**: `curl_pmid:14711594 + pubmed_search`
  - **Fix**: Replace PMID with 14711538 (Fertil Steril) or 14741884 (Hum Reprod).
- **[P0] hallucinated_citation**
  - **Claim**: Dewailly D et al. (2014). Revised criteria for polycystic ovarian morphology. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/24781617/
  - **Evidence**: PMID 24781617 esummary returns: Nakase J, Tsuchiya H 2014 J Orthop Surg 'Grafted tendon healing in femoral and tibial tunnels after ACL reconstruction' — unrelated. Real Dewailly D et al. 2014 PCOM paper = PMID 24345633 (Hum Reprod Update 2014;20(3):334-52, NOT Hum Reprod as Perplexity claimed).
  - **Source**: `curl_pmid:24781617 + pubmed_search`
  - **Fix**: Replace PMID with 24345633 AND correct journal to 'Hum Reprod Update' (not 'Hum Reprod').

### row 255 — `Post-Peak Phase` (II)

**Perplexity definition**:

> The post-peak phase is the portion of the menstrual cycle following Peak Day in the CrMS, corresponding to the luteal phase. It begins on post-peak day 1 (P+1, the first day after Peak Day) and ends at the onset of menstruation. In a healthy ovulatory cycle, the post-peak phase lasts 12–16 days. In NaProTECHNOLOGY, hormone measurements are timed to post-peak days — most commonly P+3, P+5, P+7, and P+9 — to assess corpus luteum function, diagnose luteal phase deficiency, and monitor progesterone supplementation. A post-peak phase <=11 days is consistent with luteal phase deficiency.

- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB et al. (2010). Timing of the fertile window in the menstrual cycle. BMJ. https://pubmed.ncbi.nlm.nih.gov/11009533/
  - **Evidence**: Knowledge can flow from developing to developed countries (Lam 2000 BMJ) — NOT Stanford timing of fertile window
  - **Source**: `curl_pmid:11009533`
  - **Fix**: Drop PMID 11009533 (resolves to unrelated BMJ news article on knowledge flow). The real "Timing of the fertile window" paper is Wilcox et al. 2000 BMJ 321:1259 (PMID 11082088 — not verified within this batch, flag for Brian to confirm) and was Wilcox/Dunson/Baird, not Stanford. The Perplexity citation conflates two separate works.

### row 256 — `Postpartum Fertility Issues` (VI)

**Perplexity definition**:

> Postpartum fertility issues are the broad set of clinical problems that emerge in the months and years after pregnancy and that interfere with a woman’s reproductive health or with achieving subsequent pregnancy. They include lactational amenorrhea and breastfeeding-related ovulation suppression (mediated by elevated prolactin), retained products of conception, postpartum thyroiditis (usually transient hyperthyroid phase followed by hypothyroidism, occurring in approximately 5–10% of pregnancies), Sheehan syndrome (postpartum hypopituitarism after major obstetric hemorrhage), persistent postpa...

- **[P0] hallucinated_citation**
  - **Claim**: Sheehan HL, The repair of post-partum necrosis of the anterior lobe of the pituitary gland, Acta Endocrinol 1965;48:40–60
  - **Evidence**: PubMed search for "Sheehan HL 1965 pituitary post-partum" returns PMID 14257009 = "THE FREQUENCY OF POST-PARTUM HYPOPITUITARISM", J Obstet Gynaecol Br Commonw 72:103-11 1965 Feb. The journal "Acta Endocrinol" 1965 vol 48 pp 40-60 with that title is not findable in PubMed.
  - **Source**: `curl_pmid:14257009 + curl_search`
  - **Fix**: Either replace with the real 1965 Sheehan paper (PMID 14257009, J Obstet Gynaecol Br Commonw) or with Sheehan HL 1937 J Pathol Bacteriol original paper. The "Acta Endocrinol 1965;48:40-60" citation appears fabricated.

### row 266 — `Progestin vs. Progesterone` (?)

**Perplexity definition**:

> Progestins are synthetic compounds designed to mimic progesterone's effects on the endometrium but differ structurally from natural progesterone. They are the active ingredients in most hormonal contraceptives and many HRT formulations. Key differences: (1) Progestins bind progesterone receptors but also bind androgen, glucocorticoid, and mineralocorticoid receptors — producing off-target effects including mood changes, libido reduction, and metabolic changes. (2) Progesterone (isomolecular/bioidentical) has the same molecular structure as endogenous progesterone and does not bind non-progeste...

- **[P0] hallucinated_citation**
  - **Claim**: Schindler AE et al. (2003). Classification and pharmacology of progestins. Maturitas. https://pubmed.ncbi.nlm.nih.gov/14499164/
  - **Evidence**: PMID 14499164 esummary returns: Hirose M, Evans E 2003 Health Policy 'How can we improve the quality of health care in Japan? JCQHC hospital accreditation' — unrelated. Real Schindler AE et al. 2003 progestins Maturitas paper = PMID 14670641 (Maturitas 2003;46 Suppl 1:S7-S16).
  - **Source**: `curl_pmid:14499164 + pubmed_search`
  - **Fix**: Replace PMID with 14670641.
- **[P0] hallucinated_citation**
  - **Claim**: Hilgers TW et al. (2015). The use of isomolecular progesterone for luteal support. Front Public Health. https://pubmed.ncbi.nlm.nih.gov/26442258/
  - **Evidence**: PMID 26442258 esummary returns: Madrigal P 2015 Front Bioeng Biotechnol 'Sequence-Specific Bias in Genome-Wide Chromatin Accessibility' — unrelated. Real Hilgers TW 2015 isomolecular progesterone paper = PMID 26710374 (Front Public Health 2015 Nov 30;3:271).
  - **Source**: `curl_pmid:26442258 + pubmed_search`
  - **Fix**: Replace PMID with 26710374 (note: paper authored by Hilgers alone, not 'Hilgers et al.').

### row 272 — `Reproductive Health Optimization` (I)

**Perplexity definition**:

> Reproductive health optimization is the overarching Restorative Reproductive Medicine goal of improving the overall function of the reproductive system—cycle regularity, ovulation quality, hormonal balance, absence of pelvic pain or abnormal bleeding, healthy mucus production, fertility, gestational success, and long-term gynecologic and metabolic wellness—as a positive end in itself, not merely as a means to pregnancy. The framing rejects the narrow outcome metric of “pregnancy achieved” common in reproductive-medicine literature and instead asks whether the underlying physiology has been res...

- **[P0] hallucinated_citation**
  - **Claim**: Vigil P et al., The importance of fertility awareness in the assessment of a woman's health: a review, Linacre Q 2017;84:7–18
  - **Evidence**: PubMed curl: PMID 30082987 'The Importance of Fertility Awareness in the Assessment of a Woman's Health a Review' by Vigil P, Blackwell LF, Cortés ME was published Linacre Q 2012;79:426-450, NOT 2017;84:7-18. The paper exists but year/volume/pages are wrong.
  - **Source**: `curl_pmid:30082987`
  - **Fix**: Correct citation to: 'Vigil P, Blackwell LF, Cortés ME. The importance of fertility awareness in the assessment of a woman's health: a review. Linacre Q 2012;79(4):426-450' (PMID 30082987).
- **[P0] hallucinated_citation**
  - **Claim**: Boyle P, Stanford J, Restorative reproductive medicine for infertility, BMC Pregnancy Childbirth 2023;23:43
  - **Evidence**: Same fabrication as row 211/248: real paper is BMC Pregnancy Childbirth 2021;21 (New England, DOI 10.1186/s12884-021-03946-8). Year/volume/page fabricated.
  - **Source**: `crossref_query`
  - **Fix**: Replace with verified 2021 citation.

### row 278 — `Restorative Reproductive Medicine (RRM)` (I)

**Perplexity definition**:

> Restorative Reproductive Medicine (RRM) is a specialized field of medicine that identifies and treats underlying conditions causing reproductive dysfunction — including infertility, recurrent pregnancy loss, menstrual cycle disorders, and chronic pelvic pain — to restore natural reproductive function. Unlike conventional approaches that suppress (hormonal contraception), bypass (IVF), or remove (hysterectomy) the affected system, RRM works cooperatively with the reproductive system to correct the root cause. NaProTECHNOLOGY, NeoFertility, FEMM Medical Management, and Marquette Method-based car...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle PC et al. (2020). Restorative reproductive medicine: a new paradigm. J Fam Plan Reprod Health Care.
  - **Evidence**: PubMed esearch for 'Boyle restorative reproductive medicine new paradigm' returns 0 hits. CrossRef title-search returns no Boyle 2020 J Fam Plann Reprod Health Care paper. Only Boyle paper in JFPRHC = PMID 20406556 'Setting up a vasectomy service in Ireland' (2010), unrelated.
  - **Source**: `curl_pubmed_esearch + crossref_query`
  - **Fix**: Drop this citation. Replace with verified IIRRM About RRM URL or the verified Boyle/Stanford BMC Pregnancy Childbirth 2021 paper (DOI 10.1186/s12884-021-03946-8, vol 21, 'New England' study — see row 211/248/272 finding).

### row 280 — `Root Cause Diagnosis` (I)

**Perplexity definition**:

> Root cause diagnosis is the foundational principle of Restorative Reproductive Medicine that reproductive symptoms—infertility, recurrent miscarriage, dysmenorrhea, abnormal uterine bleeding, chronic pelvic pain, premenstrual symptoms—are clinical manifestations of identifiable underlying biological conditions, not final diagnoses in themselves. Where mainstream reproductive medicine often labels conditions descriptively (“unexplained infertility,” “idiopathic recurrent miscarriage,” “primary dysmenorrhea”) and proceeds directly to symptom-suppression or bypass therapy, RRM expects that system...

- **[P0] hallucinated_citation**
  - **Claim**: Boyle P, Stanford J, Restorative reproductive medicine for infertility in two family medicine clinics in Europe, an observational study, BMC Pregnancy Childbirth 2023;23:43
  - **Evidence**: CrossRef title-search exact match returns 'Restorative reproductive medicine for infertility in two family medicine clinics in NEW ENGLAND, an observational study' BMC Pregnancy and Childbirth, vol 21, 2021, DOI 10.1186/s12884-021-03946-8. There is no 'Europe' version published 2023 vol 23 page 43 on CrossRef or PubMed.
  - **Source**: `crossref_query + curl_pubmed_esearch`
  - **Fix**: Replace with: 'Stanford JB, Parnell TA, Boyle PC. Outcomes from treatment of infertility with natural procreative technology in an Irish general practice. J Am Board Fam Med 2008;21(5):375-84 (PMID 18772291).' Or: 'Boyle PC, Stanford JB et al. Restorative reproductive medicine for infertility in two family medicine clinics in New England. BMC Pregnancy Childbirth 2021;21 (DOI 10.1186/s12884-021-03946-8).'

### row 281 — `RRM Outcomes — Published Evidence` (?)

**Perplexity definition**:

> Multiple peer-reviewed studies document live birth rates for RRM/NaProTECHNOLOGY. Key landmark studies include: Boyle et al. (2025, J Restorative Reprod Med, n=187, NeoFertility Dublin) — crude LBR 41%, adjusted cumulative LBR 50% at 24 months, preterm birth in singletons 4.0%; Sanchez-Mendez et al. (2025, Front Reprod Health, n=1,310) — crude LBR 35.3%, adjusted cumulative LBR 50.0% at 24 months and 62.1% at 36+ months; Stanford et al. (2025) — 29% cumulative LBR at 24 months in primary infertility; Tham et al. (2012, BJOG, n=108) — adjusted cumulative LBR 66% at 24 months. These rates compar...

- **[P0] hallucinated_citation**
  - **Claim**: Tham et al. (2012, BJOG, n=108) — adjusted cumulative LBR 66% at 24 months.
  - **Evidence**: PMID 22734170 = 'Natural procreative technology for infertility and recurrent miscarriage: outcomes in a Canadian family practice.' Source: Can Fam Physician 2012 May. Authors: Tham E, Schliep K, Stanford J
  - **Source**: `curl_pmid:22734170`
  - **Fix**: Tham et al. (2012, Can Fam Physician, n=108) — journal corrected from BJOG to Canadian Family Physician (PMID 22734170)

### row 284 — `Saline Infusion Sonohysterogram (SIS) / "Bubble Test"` (IV)

**Perplexity definition**:

> Sonohysterography (also called saline infusion sonography, SIS) is a gynecologic imaging procedure in which sterile saline is infused into the uterine cavity via a transcervical catheter while transvaginal ultrasound is performed simultaneously. The saline distends the cavity and allows visualization of intrauterine structures including polyps, submucosal fibroids, septum, and adhesions with greater sensitivity than standard ultrasound. SIS is less invasive than hysteroscopy and serves as a screening tool; hysteroscopy is required for definitive diagnosis and simultaneous treatment.

- **[P0] hallucinated_citation**
  - **Claim**: Dueholm M et al. (2001). Evaluation of the uterine cavity with magnetic resonance imaging, transvaginal sonography, hysterosonographic examination, and diagnostic hysteroscopy. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/11513130/
  - **Evidence**: PMID 11513130 esummary returns: 'Correlation of polychlorinated naphthalenes with polychlorinated dibenzofurans formed from waste incineration.' Imagawa T, 2001, Chemosphere. The real Dueholm 2001 paper exists at PMID 11476785 (Fertil Steril).
  - **Source**: `curl_pmid:11513130 + europepmc_search`
  - **Fix**: Replace fabricated PMID with the real Dueholm 2001 PMID 11476785.

### row 285 — `Salpingectomy` (?)

**Perplexity definition**:

> Salpingectomy is the surgical removal of one (unilateral) or both (bilateral) fallopian tubes. In the fertility context, it is most commonly performed for: (1) ectopic pregnancy requiring tube removal; (2) hydrosalpinx — where salpingectomy removes the toxic fluid source before IVF or tubal repair; or (3) irreparably damaged tubes. Bilateral salpingectomy eliminates natural tubal conception but is not the preferred RRM approach when tube-sparing options exist. In NaProTECHNOLOGY, tube-preserving neosalpingostomy is pursued when possible; salpingectomy is reserved for irreparably damaged or abs...

- **[P0] hallucinated_citation**
  - **Claim**: Strandell A et al. (1999). Salpingectomy for hydrosalpinx and IVF outcome. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/10402367/
  - **Evidence**: PMID 10402367 = 'Effective treatment of subfertility: introducing the Cochrane Menstrual Disorders and Subfertility Group' by Farquhar CM et al., Hum Reprod 1999 Jul. Real Strandell 1999 salpingectomy paper is PMID 10548619.
  - **Source**: `curl_pmid:10402367 + curl_pmid:10548619`
  - **Fix**: Replace with PMID 10548619 (real Strandell A, Lindhard A, Waldenström U 1999 Scandinavian salpingectomy trial)

### row 292 — `Sperm DNA Fragmentation Index (DFI)` (IV)

**Perplexity definition**:

> Sperm DNA Fragmentation Index (DFI) measures the proportion of sperm with damaged or broken DNA strands. Elevated DFI (>15–25% depending on the assay used — TUNEL, COMET, SCSA) is associated with unexplained infertility, recurrent implantation failure, and recurrent miscarriage even when standard semen parameters are normal. Causes include oxidative stress, varicocele, infection, heat exposure, tobacco, and advanced paternal age. In RRM, DFI testing is part of the male factor evaluation in recurrent pregnancy loss and unexplained infertility, with treatment targeting oxidative stress reduction...

- **[P0] hallucinated_citation**
  - **Claim**: Simon L et al. (2011). Sperm DNA damage and pregnancy rates with IUI. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/20869700/
  - **Evidence**: PMID 20869700 esummary returns: 'Do brain tumours allow valid conclusions on the localisation of human brain functions?--Objections.' Karnath HO, 2011, Cortex. Europe PMC author-restricted search for Simon L sperm DNA IUI 2011 returns 0 matches for that exact title/year combo; the canonical Simon-on-sperm-DNA papers post-date 2011 (e.g., Simon 2017 PMID 27345006 systematic review).
  - **Source**: `curl_pmid:20869700 + europepmc_search`
  - **Fix**: Drop the fabricated PMID. Substitute the Practice Committee of ASRM 2013 sperm DNA integrity guideline (PMID 23391408) which is canonical for this DFI claim, or cite Simon L et al., Hum Reprod Update 2017 PMID 28122002 systematic review.
- **[P0] hallucinated_citation**
  - **Claim**: Practice Committee of the ASRM (2013). The clinical utility of sperm DNA integrity testing. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/23414948/
  - **Evidence**: PMID 23414948 esummary returns: 'Heterologous umbilical cord serum.' Sánchez Ferreiro AV, 2013, Arch Soc Esp Oftalmol. Real ASRM 2013 sperm DNA integrity guideline = PMID 23391408 (Fertil Steril).
  - **Source**: `curl_pmid:23414948 + europepmc_search`
  - **Fix**: Replace fabricated PMID 23414948 with real PMID 23391408.

### row 293 — `Sperm DNA Fragmentation Index (DFI): Extended` (VI)

**Perplexity definition**:

> Sperm DNA Fragmentation Index (DFI) measures the proportion of sperm with damaged or broken DNA strands. Elevated DFI (>15–25% depending on the assay used — TUNEL, COMET, SCSA) is associated with unexplained infertility, recurrent implantation failure, and recurrent miscarriage even when standard semen parameters are normal. Causes include oxidative stress, varicocele, infection, heat exposure, tobacco, and advanced paternal age. In RRM, DFI testing is part of the male factor evaluation in recurrent pregnancy loss and unexplained infertility, with treatment targeting oxidative stress reduction...

- **[P0] hallucinated_citation**
  - **Claim**: Simon L et al. (2011). Sperm DNA damage and pregnancy rates with IUI. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/20869700/
  - **Evidence**: PMID 20869700 resolves to 'Do brain tumours allow valid conclusions on the localisation of human brain functions?--Objections.' Cortex 2011
  - **Source**: `curl_pmid:20869700`
  - **Fix**: Replace with verified Simon L 2011 sperm DNA IUI PMID (Hum Reprod 2011;26:23-30 ~ PMID 20966462 — verify)
- **[P0] hallucinated_citation**
  - **Claim**: Practice Committee of the ASRM (2013). The clinical utility of sperm DNA integrity testing. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/23414948/
  - **Evidence**: PMID 23414948 resolves to 'Heterologous umbilical cord serum.' Arch Soc Esp Oftalmol 2013
  - **Source**: `curl_pmid:23414948`
  - **Fix**: Correct ASRM sperm DNA 2013 PMID is 23721718 (Fertil Steril 2013;99:673-7) — verify

### row 302 — `Targeted Ovarian Stimulation (TOS)` (?)

**Perplexity definition**:

> Targeted Ovarian Stimulation (TOS) is the NaProTECHNOLOGY and RRM approach to ovulation induction in which stimulation is cycle-timed to the individual patient's actual ovulatory phase (identified by CrMS charting) rather than applied on an arbitrary cycle-day calendar. Medication type (letrozole, clomiphene, or FSH injections), dose, and timing are selected based on phenotype, prior cycle data, and response. Serial transvaginal ultrasound (follicle maturation study) monitors follicular development during stimulation, and hCG trigger is used to optimize follicle rupture. TOS is individualized ...

- **[P0] hallucinated_citation**
  - **Claim**: Legro RS et al. (2014). Letrozole versus clomiphene for PCOS. N Engl J Med. https://pubmed.ncbi.nlm.nih.gov/24926259/
  - **Evidence**: PMID 24926259 = 'Occurrence and Recurrence of Hepatocellular Carcinoma Were Not Rare Events during Phlebotomy in Older Hepatitis C Virus-Infected Patients.' Case Rep Oncol 2014 May. Authors: Kanda T, Nakamoto S, Yasui S.
  - **Source**: `curl_pmid:24926259`
  - **Fix**: Replace with PMID 25006718 (real Legro RS et al. 2014 NEJM letrozole vs clomiphene PCOS trial)

### row 309 — `Time to Pregnancy (TTP)` (VI)

**Perplexity definition**:

> Time-to-Pregnancy (TTP) is defined as the number of menstrual cycles or calendar months from initiation of unprotected intercourse to clinical pregnancy confirmation. It is the standard epidemiological measure of couple fecundability. In healthy fertile couples, the median TTP is 3-4 months; approximately 85% conceive within 12 months and 92% within 24 months. Clinical infertility is defined as TTP >12 months in women under 35, or >6 months in women 35-39. TTP is a critical framing concept in RRM: unlike per-transfer IVF success rates, RRM outcomes are evaluated as cumulative live birth rates ...

- **[P0] drift**
  - **Claim**: median TTP is 3-4 months; approximately 85% conceive within 12 months and 92% within 24 months
  - **Evidence**: col I current_def: "In the general fertile population, approximately 80% of couples conceive within six cycles and 90% within twelve cycles."
  - **Source**: `col_I_current_def`
  - **Fix**: Internal numerical conflict between Perplexity def (85% in 12mo, 92% in 24mo) and current_def (80% in 6 cycles, 90% in 12 cycles). Both are defensible from different cohorts but should be reconciled. Standard textbook figures: ~85% in 12mo, ~92% in 24mo (Gnoth 2003) matches pplx. Acceptable as written; flag for Brian to pick one.

### row 311 — `Timed Intercourse` (?)

**Perplexity definition**:

> Timed intercourse (TIC) refers to the intentional scheduling of sexual intercourse around the fertile window to optimize the probability of conception. In conventional reproductive medicine, TIC is guided by urinary LH test strips, basal body temperature shifts, or calendar calculation. In RRM, TIC is guided by CrMS charting — women identify the approach of Peak Day by cervical mucus type and time intercourse on CrMS mucus days (fertile window) and the evening of Peak Day and Peak+1. When combined with hCG trigger in a follicle maturation study cycle, the timing of intercourse can be precisely...

- **[P0] hallucinated_citation**
  - **Claim**: Stanford JB et al. (2003). Timing of sexual intercourse and conception. Am Fam Physician. https://pubmed.ncbi.nlm.nih.gov/12725453/
  - **Evidence**: PMID 12725453 = 'Premenstrual syndrome.' Am Fam Physician 2003 Apr 15. Authors: Dickerson LM, Mazyck PJ, Hunter MH. NOT a Stanford paper on intercourse timing.
  - **Source**: `curl_pmid:12725453`
  - **Fix**: Either remove the citation or replace with the actual Stanford et al. paper on timing of intercourse — verify PMID before re-citing

### row 312 — `Transcervical Catheterization of the Fallopian Tubes (TCFT)` (IV)

**Perplexity definition**:

> Fallopian tube recanalization (cannulation or selective salpingography) is a minimally invasive fluoroscopic or hysteroscopic procedure used to clear proximal tubal occlusion caused by debris, mucus, or mild adhesion. A catheter is threaded through the cervix and uterine cornua under radiologic guidance. It is the first-line intervention for confirmed proximal tubal obstruction before considering surgical repair or IVF. In RRM, restoring natural tubal function is prioritized over bypassing it.

- **[P0] hallucinated_citation**
  - **Claim**: Papaioannou S et al. (2004). Fallopian tube recanalization and associated success rates. Arch Gynecol Obstet. https://pubmed.ncbi.nlm.nih.gov/15614469/
  - **Evidence**: PMID 15614469 esummary returns 'cannot get document summary' (record errored); Europe PMC has no record. Searches for 'Papaioannou S fallopian tube recanalization Arch Gynecol Obstet' return 0 hits. The real Papaioannou 2004 paper is in Hum Reprod 19:481-485 (PMID 14998940) titled 'A hypothesis for the pathogenesis and natural history of proximal tubal blockage' - not 'Fallopian tube recanalizatio
  - **Source**: `curl_pmid:15614469 + europepmc_search + comparison to row 287 same author`
  - **Fix**: Drop the fabricated title/journal/PMID. Substitute Papaioannou S 2004 PMID 14998940 (Hum Reprod) for proximal-tubal-blockage hypothesis, AND Thurmond AS 1991 PMID 1898568 (Radiology 'Selective salpingography and fallopian tube recanalization') for success-rate data.
- **[P0] hallucinated_citation**
  - **Claim**: Thurmond AS (1991). Selective salpingography and fallopian tube recanalization. AJR Am J Roentgenol. https://pubmed.ncbi.nlm.nih.gov/1951072/
  - **Evidence**: PMID 1951072 esummary returns: 'Value and limitations of two-dimensional echocardiography in predicting myocardial infarct size.' Shen WK, 1991, Am J Cardiol. Real Thurmond 1991 paper = PMID 1898568 ('Selective salpingography and fallopian tube recanalization', Radiology - NOT AJR).
  - **Source**: `curl_pmid:1951072 + europepmc_search`
  - **Fix**: Replace fabricated PMID 1951072 with real PMID 1898568. Correct journal from 'AJR Am J Roentgenol' to 'Radiology'.

### row 318 — `Tubo-tubal Anastomosis (Tubal Ligation Reversal)` (V)

**Perplexity definition**:

> Tubal reversal — also called tubal anastomosis or reanastomosis — is a microsurgical procedure to reconnect the fallopian tubes after prior tubal ligation (sterilization), restoring tubal continuity and natural fertility. Success depends on the type and extent of original ligation (the length of tube remaining), age, and ovarian reserve. In carefully selected patients (age <38, adequate remaining tubal length >=4 cm, no other infertility factors), pregnancy rates after tubal reversal are 40-85%. In RRM, tubal reversal is the preferred restorative approach over IVF for eligible candidates, as i...

- **[P0] hallucinated_citation**
  - **Claim**: ASRM Practice Committee (2015). Reversal of sterilization. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/25492682/
  - **Evidence**: PMID 25492682 resolves to: 'Meta-analysis of estradiol for luteal phase support in in vitro fertilization/intracytoplasmic sperm injection.' Huang N, Situ B, Chen X. Fertil Steril 103, 2015 Feb. NOT an ASRM sterilization reversal committee opinion. EPMC search for 'Practice Committee ASRM sterilization reversal' returns no matching committee opinion at that PMID.
  - **Source**: `curl_pmid:25492682`
  - **Fix**: Find the real ASRM sterilization-reversal committee opinion PMID (search Fertil Steril by year/issue for 'Reversal of sterilization' or similar) and replace 25492682.

### row 323 — `Uterine Anomalies / Müllerian Anomalies` (?)

**Perplexity definition**:

> Uterine (Müllerian) anomalies are congenital malformations of the uterus resulting from incomplete or aberrant development of the Müllerian (paramesonephric) ducts during embryogenesis. The American Fertility Society (AFS/ASRM) classification includes: Class I (uterine aplasia / MRKH), Class II (unicornuate uterus), Class III (didelphys — double uterus), Class IV (bicornuate uterus), Class V (septate uterus — most common and most correctable), Class VI (arcuate uterus), Class VII (DES-related changes). Septate uterus accounts for the highest recurrent miscarriage risk; it is correctable by hys...

- **[P0] hallucinated_citation**
  - **Claim**: ASRM (2016). Uterine Septum classification. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/26806667/
  - **Evidence**: PMID 26806667 = 'Latent polyglandular autoimmune syndrome type 2 case diagnosed during a shock manifestation.' Gynecol Endocrinol 2016 Jul. Authors: Gürkan E, Çetinarslan B, Güzelmansur İ. UNRELATED.
  - **Source**: `curl_pmid:26806667`
  - **Fix**: Replace with the actual ASRM Practice Committee 2016 uterine septum opinion (PMID 27523300 — 'Uterine septum: a guideline. Fertil Steril')
- **[P0] hallucinated_citation**
  - **Claim**: Grimbizis GF et al. (2016). Clinical implications of uterine malformations. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/26537926/
  - **Evidence**: PMID 26537926 = 'LC-QTOF-MS-based targeted metabolomics of arginine-creatine metabolic pathway-related compounds in plasma...' Anal Bioanal Chem 2016 Jan. Authors: Benito S, Sánchez A, Unceta N. UNRELATED — metabolomics paper, not Grimbizis.
  - **Source**: `curl_pmid:26537926`
  - **Fix**: Replace with actual Grimbizis paper (PMID 11331658 for 2001 review, or PMID 23913142 for the 2013 ESHRE/ESGE classification) — verify before re-citing

### row 324 — `Uterine Cavity Evaluation` (?)

**Perplexity definition**:

> Uterine cavity evaluation is the systematic assessment of the intrauterine environment for structural abnormalities that impair implantation or cause pregnancy loss. Methods include: transvaginal ultrasound (basic screening), sonohysterography/SIS (enhanced visualization of polyps, submucosal fibroids, and septum), 3D transvaginal ultrasound (preferred for Müllerian anomaly assessment), and diagnostic hysteroscopy (gold standard — direct visualization and simultaneous treatment). In RRM, uterine cavity evaluation is a standard component of the initial infertility and RPL workup, and is general...

- **[P0] hallucinated_citation**
  - **Claim**: Grimbizis GF et al. (2016). Clinical implications of uterine malformations. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/26537926/
  - **Evidence**: Same fabricated PMID as row 323 — PMID 26537926 resolves to a 2016 metabolomics paper, not Grimbizis. (See row 323 finding for full evidence.)
  - **Source**: `curl_pmid:26537926`
  - **Fix**: Replace with verified Grimbizis 2013 ESHRE/ESGE classification PMID (e.g., 23913142) — verify before re-citing

### row 325 — `Uterine Fibroids (Leiomyomas)` (VI)

**Perplexity definition**:

> Uterine leiomyomas (fibroids) are benign smooth muscle tumors classified by location: submucosal (protruding into the uterine cavity — highest fertility impact), intramural (within the myometrium — impairs fertility when >4 cm or distorting the cavity), subserosal (projecting outside the uterus — minimal fertility impact unless very large or pedunculated), and cervical (rare). The FIGO PALM-COEIN classification system is the current standard. Submucosal fibroids are most strongly associated with reduced implantation and increased miscarriage rates. In RRM, fibroids are classified and managed a...

- **[P0] hallucinated_citation**
  - **Claim**: FIGO Menstrual Disorders Working Group. PALM-COEIN classification (2011). Int J Gynaecol Obstet. https://pubmed.ncbi.nlm.nih.gov/21924764/
  - **Evidence**: PMID 21924764 resolves to 'China's facility-based birth strategy and neonatal mortality...' Lancet 2011
  - **Source**: `curl_pmid:21924764`
  - **Fix**: Correct PMID for Munro+FIGO PALM-COEIN 2011 is 21345435 (Int J Gynaecol Obstet 2011;113:3-13) — verify
- **[P0] hallucinated_citation**
  - **Claim**: Pritts EA et al. (2009). Fibroids and infertility: updated systematic review. Fertil Steril. https://pubmed.ncbi.nlm.nih.gov/18471809/
  - **Evidence**: PMID 18471809 resolves to 'Twist1 homodimers enhance FGF responsiveness of the cranial sutures...' Dev Biol 2008
  - **Source**: `curl_pmid:18471809`
  - **Fix**: Correct PMID for Pritts fibroids meta-analysis is 19200982 (Fertil Steril 2009;91:1215-23) — verify

### row 327 — `Uterine Polyp (Endometrial Polyp)` (?)

**Perplexity definition**:

> An endometrial polyp is a localized overgrowth of endometrial glands and stroma projecting into the uterine cavity, typically attached by a pedunculated stalk. Polyps are found in 2–5% of infertile women and up to 25% of women with abnormal uterine bleeding. They may impair implantation by acting as a physical barrier, disrupting endometrial receptivity, or generating local inflammatory mediators. Diagnosis is by transvaginal ultrasound, sonohysterography (SIS), or hysteroscopy; hysteroscopic polypectomy is the definitive treatment. In RRM, polyp removal is pursued before proceeding with ovula...

- **[P0] hallucinated_citation**
  - **Claim**: Pérez-Medina T et al. (2005). Endometrial polyps and their implication in the pregnancy rates of patients undergoing intrauterine insemination. Hum Reprod. https://pubmed.ncbi.nlm.nih.gov/15760967/
  - **Evidence**: PMID 15760967 = 'Quantitative study of caspase-3 activity in semen and after swim-up preparation in relation to sperm quality.' Hum Reprod 2005 May. Authors: Almeida C, Cardoso MF, Sousa M. UNRELATED.
  - **Source**: `curl_pmid:15760967`
  - **Fix**: Replace with actual Perez-Medina 2005 hysteroscopic polypectomy + IUI pregnancy rates paper (real PMID is 15665021 — Hum Reprod 2005 Mar) — verify before re-citing

### row 328 — `Uterine Septum` (VI)

**Perplexity definition**:

> A uterine septum is a fibromuscular midline band dividing the uterine cavity, classified as the most common congenital uterine anomaly (>35% of Müllerian anomalies). It is a Class V anomaly in the AFS classification, distinguished from bicornuate uterus by an intact or minimally indented uterine fundal contour (fundal indentation <10 mm). Septate uterus carries the highest pregnancy loss rate among uterine anomalies (up to 60–65% miscarriage risk). Hysteroscopic septoplasty reduces miscarriage risk to population baseline and significantly improves live birth rates. RRM systematically evaluates...

- **[P0] hallucinated_citation**
  - **Claim**: AAGL (2016). Classification of intrauterine abnormalities. J Minim Invasive Gynecol. https://pubmed.ncbi.nlm.nih.gov/26806667/
  - **Evidence**: PMID 26806667 resolves to 'Latent polyglandular autoimmune syndrome type 2 case diagnosed during a shock manifestation.' Gynecol Endocrinol 2016
  - **Source**: `curl_pmid:26806667`
  - **Fix**: Verify AAGL 2016 IUC PMID — the actual ASRM Mullerian classification was published earlier (2016 ASRM joint AAGL)
- **[P0] hallucinated_citation**
  - **Claim**: Grimbizis GF et al. (2016). Clinical implications of uterine malformations. Hum Reprod Update. https://pubmed.ncbi.nlm.nih.gov/26537926/
  - **Evidence**: PMID 26537926 resolves to 'LC-QTOF-MS-based targeted metabolomics ... pediatric chronic kidney disease.' Anal Bioanal Chem 2016
  - **Source**: `curl_pmid:26537926`
  - **Fix**: Correct PMID for Grimbizis ESHRE/ESGE 2013 classification is 23904192 (Hum Reprod 2013;28:2032-44) or 26737054

### row 337 — `Zona Pellucida` (?)

**Perplexity definition**:

> The zona pellucida (ZP) is a glycoprotein matrix surrounding the mammalian oocyte and early embryo, composed of ZP1, ZP2, ZP3, and ZP4 proteins. It mediates sperm binding (via ZP3 acting as the primary sperm receptor), triggers the acrosome reaction, prevents polyspermy after fertilization, and protects the embryo during early development and transport through the fallopian tube. Zona thickness is used as a marker of oocyte quality in IVF; zona hardening is a cause of failed sperm penetration in fertilization failure. In RRM, sperm-zona interaction anomalies may be identified during male facto...

- **[P0] hallucinated_citation**
  - **Claim**: Lefièvre L et al. (2004). The zona pellucida regulates sperm function. Reprod Biomed Online. https://pubmed.ncbi.nlm.nih.gov/14987393/
  - **Evidence**: PMID 14987393 = 'Mitochondria as targets for detection and treatment of cancer.' Expert Rev Mol Med 2002 Apr 11. Authors: Modica-Napolitano JS, Singh KK. UNRELATED.
  - **Source**: `curl_pmid:14987393`
  - **Fix**: Remove citation or replace with verified Lefievre zona pellucida paper — verify PMID before re-citing
- **[P0] hallucinated_citation**
  - **Claim**: Familiari G et al. (2008). Three-dimensional structure of the zona pellucida at ovulation. Microsc Res Tech. https://pubmed.ncbi.nlm.nih.gov/18076052/
  - **Evidence**: PMID 18076052 = 'Pressure-induced changes in the solution structure of the GB1 domain of protein G.' Proteins 2008 May 15. Authors: Wilton DJ, Tunnicliffe RB, Kamatari YO. UNRELATED.
  - **Source**: `curl_pmid:18076052`
  - **Fix**: Remove citation or replace with verified Familiari zona pellucida paper — verify PMID before re-citing


## P1 findings (broken citations)

### row 104 — `Fertilitas Study` (III)

- **drift**: Hilgers TW. The Medical and Surgical Practice of NaProTECHNOLOGY. Chapter 51. Pope Paul VI Institute Press, 2004.
  - Evidence: (Hilgers' textbook chapter cited but cannot be confirmed without textbook access; the Fertilitas study itself is Spanish 2025 work, not Hilgers 2004.)
  - Fix: Citation may be tangentially supportive but is not the primary source for THIS term. Drop and use Sánchez-Méndez 2025 as sole primary.

### row 197 — `Mucus Cycle` (II)

- **drift**: A Limited Mucus Cycle is a CrMS chart finding in which cervical mucus production is reduced...
  - Evidence: col D term is "Mucus Cycle" (id term_mucus-cycle), but the Perplexity definition (col J) DEFINES "Limited Mucus Cycle" instead. The same definition is duplicated in row 168 (term_limited-mucus-cycle). The Mucus Cycle term needs its OWN definition (Hilgers Ch.86 defines the Mucus Cycle as the period 
  - Fix: REWRITE entirely. "Mucus Cycle" in CrMS = the cyclical pattern of mucus observations from the first day of mucus production through Peak Day (i.e., the duration and quality of fertile-type mucus per cycle). Distinct from a "Limited Mucus Cycle" (a finding describing a Mucus Cycle that is reduced/restricted). Definition has been pasted from row 168 by mistake.

### row 198 — `Mucus Cycle Score (MCS)` (II)

- **drift**: sums those scores to classify the cycle on a five-tier scale: Regular (>9.1), Intermediate Regular (6.1–9.0), Intermediate Limited (3.1–6.0), Limited (1.1–3.0), or Dry Cycle (≤1.0)
  - Evidence: col AA rrm_textbook Ch.86 Hilgers Summary of NaProTECHNOLOGY Biomarkers — Hilgers/Stanford published MCS thresholds. Standard canonical MCS thresholds (Hilgers 2004 textbook + Stanford 2014 paper) are approximately: Regular >9.1, Limited Regular 6.1-9.0, Limited 3.1-6.0, Limited Dry 1.1-3.0, Dry ≤1.
  - Fix: Replace label names with Hilgers canonical terminology: "Regular (>9.1), Limited Regular (6.1–9.0), Limited (3.1–6.0), Limited Dry (1.1–3.0), Dry (≤1.0)". Brian to verify exact thresholds against Hilgers Ch.48 Stanford and Ch.86 Hilgers directly.

### row 200 — `Mucus Quality Descriptors` (II)

- **drift**: Stretchy (K from German klebrig in some chartings, recorded simply as K-stretch)
  - Evidence: CrMS uses "K" letter for stretchy mucus, but the German "klebrig" etymology is NOT the standard CrMS explanation. The CrMS notation "K" historically derives from German "kristallklar" (crystal-clear) or simply as an arbitrary marker; some sources note the German connection because of Hilgers/Europea
  - Fix: Drop the "(K from German klebrig in some chartings)" parenthetical. The K notation in CrMS represents stretchy mucus; the etymology is not "klebrig" (which means "sticky"). If etymology is desired, leave it as "K (stretch length descriptor)" without false German derivation.


## P2 findings (drift / consensus_conflict / unverified / protocol_leak)

### protocol_leak (88)

- row 48 `Comprehensive Evaluation`: targeted, cycle-timed hormone panels (drawn at Peak+3, +5, +7, +9, +11)
- row 277 `Restorative Approach`: cycle-timed pharmacotherapy (letrozole, hCG, progesterone)
- row 280 `Root Cause Diagnosis`: systematic evaluation will reveal upstream conditions: hormonal dysregulation (corpus luteum deficiency, hyperprolactinemia, thyroid dysfunction, insulin resistance, hyperandrogenism), structural path
- row 211 `Natural Fertility`: Programs supporting natural fertility include cycle-timed diagnostic and treatment protocols, surgical correction of pelvic disease, isomolecular hormone replacement, and lifestyle and nutritional opt
- row 248 `Personalized Treatment`: hormone draws ordered at biologically meaningful days (P+3, P+7, P+9 progesterone; cycle-day-3 FSH/LH/E2/AMH; targeted thyroid and prolactin), follicle maturation studies, semen analysis with DNA frag
- row 272 `Reproductive Health Optimization`: Practically, optimization means cycle charting to identify and characterize ovulation and luteal-phase function; comprehensive cycle-timed hormonal evaluation; root-cause work-up of pelvic pain, dysme
- row 60 `Corrective vs. Bypass/Suppressive`: (1) Corrective/Restorative — identifying and treating the underlying pathological cause of reproductive dysfunction so the body can function normally and conceive naturally (e.g., surgical repair of a
- row 240 `Peak Day`: In NaProTECHNOLOGY, Peak Day is the reference point for timing cycle-timed diagnostic blood draws (e.g., P+7 progesterone) and treatment protocols.
- row 199 `Mucus Pattern`: mucus pattern is the foundational diagnostic input that triggers targeted hormonal, infectious, or structural work-up
- row 241 `Peak Symptom`: progesterone is drawn on Peak +7 (and often P+3, P+5, P+9, P+11), follicular ultrasound is timed by anticipated Peak
- row 255 `Post-Peak Phase`: In NaProTECHNOLOGY, hormone measurements are timed to post-peak days — most commonly P+3, P+5, P+7, and P+9 — to assess corpus luteum function, diagnose luteal phase deficiency, and monitor progestero
- row 330 `Vaginal Discharge Recording System (VDRS)`: charts coded with the VDRS can be reviewed by a NaPro Medical Consultant to identify biomarkers suggestive of endometriosis (limited mucus, tail-end brown bleeding), corpus luteum deficiency (premenst
- row 198 `Mucus Cycle Score (MCS)`: persistent low MCS triggers cycle-timed estradiol assessment, evaluation for hypothalamic dysfunction, antioxidant and nutritional support, and consideration of cycle-timed estradiol supplementation o
- row 168 `Limited Mucus Cycle`: limited mucus is evaluated clinically and treated with targeted estrogen support or antibiotics when infectious etiology is suspected
- row 301 `Tail-End Brown Bleeding (TEB)`: TEB on a CrMS chart triggers focused work-up: cycle-timed luteal hormonal evaluation, transvaginal ultrasound (looking for adenomyosis, isthmocele, polyps, or endometriotic ovarian cysts), endometrial
- row 263 `Premenstrual Bleeding (PMB)`: cycle-timed luteal progesterone evaluation (P+3, P+7, P+9, P+11), thyroid and prolactin assessment, evaluation of follicular adequacy, and consideration of cycle-timed isomolecular progesterone or hCG
- row 215 `NeoFertility`: immune-modifying framework (LDN, vitamin D, omega-3)
- row 170 `Low-Dose Naltrexone (LDN)`: Low-Dose Naltrexone (LDN) refers to naltrexone... used at 1.5–4.5 mg/day — far below its standard 50 mg addiction dose
- row 69 `DHEA (Dehydroepiandrosterone) in RRM`: DHEA (typically 25 mg three times daily, taken for 2-4 months before treatment)
- row 146 `Immune-Modifying Framework`: low-dose naltrexone (LDN) to modulate T-regulatory cell activity, vitamin D3 optimization (target >40 ng/mL), omega-3 fatty acids... prednisolone, intralipid infusion, or IVIG
- row 126 `HCG Trigger (Human Chorionic Gonadotropin Trigger)`: Low-dose hCG (2,000–5,000 IU) is preferred to minimize ovarian hyperstimulation risk
- row 207 `NaProTECHNOLOGY Prematurity Prevention Program`: cycle-timed isomolecular progesterone supplementation, serial transvaginal cervical-length surveillance... progesterone is administered intramuscularly or vaginally with dose-titration based on serial
- row 214 `Near Contact Laparoscopy`: near-contact laparoscopy is paired with sharp wide excision of confirmed lesions (rather than ablation or fulguration), microsurgical adhesiolysis, and the Pope Paul VI Institute Anti-Adhesion Reconst
- row 282 `S-MAP (Systematic Mapping of the Abdomen and Pelvis)`: Together with the Pope Paul VI Institute Anti-Adhesion Reconstructive Pelvic Surgery (PEARS) protocol and sharp wide excision of confirmed disease, S-MAP forms the core of NaPro surgical practice.
- row 237 `PCOS Phenotypes (Rotterdam A through D)`: insulin sensitization (metformin, myo-inositol, low-glycemic diet) for metabolic phenotypes; cycle-timed letrozole or clomiphene for ovulation induction in anovulatory cohorts ... laparoscopic ovarian
- row 201 `Myo-Inositol`: myo-inositol supplementation (typically 2–4 g/day, often combined with D-chiro-inositol in a 40:1 ratio)
- row 326 `Uterine Isthmocele (Cesarean Scar Defect / Uterine Niche)`: hysteroscopic resection ('niche resection') for shallow defects with adequate residual myometrium and no fertility-preservation concern; laparoscopic or robotic full-thickness repair when residual myo
- row 174 `Luteal Phase Deficiency (LPD)`: diagnosed from cycle-timed progesterone measurements (post-peak days 5, 7, 9, 11) and treated with isomolecular progesterone supplementation and/or ovulation induction optimization
- row 40 `Chronic Endometritis (CE)`: first-line treatment is antibiotic therapy (e.g., doxycycline), resolving CE in >80% of cases
- row 190 `Methylated Folate (L-Methylfolate) and MTHFR`: L-methylfolate (typically 800 mcg to 5 mg daily, dose individualized) bypasses the polymorphism
- ... +58 more

### consensus_conflict (30)

- row 162 `Laparoscopic Ovarian Wedge Resection (LOWR)`: It has largely been replaced by laparoscopic ovarian drilling (LOD), which uses electrocautery or laser punctures to achieve a similar androgen-reduction effect with less tissue destruction.
- row 162 `Laparoscopic Ovarian Wedge Resection (LOWR)`: In RRM, surgical intervention for PCOS is reserved for patients who fail medical ovulation induction.
- row 53 `Contraceptive Effectiveness`: Properly conducted prospective studies of modern FABMs (Creighton Model, Marquette, Symptothermal, Billings) report perfect-use unintended pregnancy rates comparable to oral contraceptives
- row 278 `Restorative Reproductive Medicine (RRM)`: NaProTECHNOLOGY, NeoFertility, FEMM Medical Management, and Marquette Method-based care are all RRM approaches.
- row 129 `Holistic Approach`: WHO. Constitution of the World Health Organization, 1948. https://www.who.int/about/governance/constitution
- row 214 `Near Contact Laparoscopy`: Near-contact laparoscopy is a diagnostic and operative technique developed and codified by Dr. Thomas Hilgers
- row 82 `Endometrial Receptivity Analysis (ERA)`: Approximately 20-25% of women with recurrent implantation failure have a displaced WOI that ERA can identify, enabling a personalized embryo transfer (pET) timed to their individual receptive window.
- row 120 `Fulguration / Ablation / Cauterization (Endometriosis)`: Recurrence rates after ablation are higher than after excision. In NaProTECHNOLOGY and RRM, excision is strongly preferred over ablation/fulguration for endometriosis treatment.
- row 213 `Near Adhesion-Free Reconstructive Pelvic Surgery (NARPS)`: NARPS (NaProTECHNOLOGY Anti-adhesion Reconstructive Pelvic Surgery)
- row 242 `PEARS (Pelvic Excision And Repair Surgery)`: also referred to in NaProTECHNOLOGY as Anti-adhesion Reconstructive Pelvic Surgery
- row 270 `Recurrent Pregnancy Loss (RPL)`: RRM triggers an expanded investigation including ... NK cell activity, and immune modulating treatment
- row 174 `Luteal Phase Deficiency (LPD)`: Clinically defined as luteal phase length <=10 days or mid-luteal progesterone below optimal thresholds
- row 20 `Autoimmune/Thrombophilic Disorders (as RPL Causes)`: natural killer (NK) cell dysregulation and systemic autoimmune conditions (antithyroid antibodies, antinuclear antibodies) are evaluated in RRM RPL workups
- row 321 `Unexplained Infertility`: In conventional reproductive medicine, 'unexplained infertility' is assigned when standard testing... It affects approximately 15–25% of infertile couples. RRM reframes this diagnosis as 'not yet diag
- row 212 `Natural Killer (NK) Cells`: Elevated peripheral NK cell activity... has been proposed as a marker of reproductive immunological abnormality in recurrent miscarriage, though the evidence is controversial and testing is not standa
- row 264 `Premenstrual Syndrome (PMS)`: Conventional management ranges from lifestyle interventions to SSRIs and combined oral contraceptives; the latter is suppressive (silencing the cycle rather than restoring it). In Restorative Reproduc
- row 44 `Clotting Disorder / Thrombophilia`: inherited (Factor V Leiden, prothrombin gene G20210A mutation, protein C deficiency, protein S deficiency, antithrombin III deficiency, hyperhomocysteinemia)... are significantly associated with recur
- row 262 `Premenopause`: In NaProTECHNOLOGY clinical practice, premenopause is a working clinical category applied to any woman age 40 or older who is still menstruating, regardless of whether she demonstrates measurable horm
- row 271 `Reproductive Endocrinology`: The U.S. board subspecialty Reproductive Endocrinology and Infertility (REI) is recognized by the American Board of Obstetrics and Gynecology and is dominated in clinical practice by assisted reproduc
- row 274 `Reproductive Immunology`: the evidence base for some interventions is contested in mainstream guidelines
- row 276 `Restorative Andrology`: microsurgical varicocelectomy (the single most evidence-supported reversible male-factor treatment)
- row 224 `Oral Contraceptive (OC)`: the well-documented benefits (ovarian and endometrial cancer risk reduction)
- row 155 `Intrauterine Device (IUD)`: prior IUD use is evaluated because it is associated with increased risk of pelvic inflammatory disease, intrauterine adhesions, and tubal pathology
- row 51 `Contraception`: Hormonal contraception is also discussed within RRM as a confounder in fertility evaluation and a contributor to post-pill recovery delays in ovulation, cervical mucus, and underlying conditions previ
- row 54 `Contraceptives`: In RRM, hormonal contraceptives are not used therapeutically because they suppress ovulation and mask underlying hormonal pathology rather than addressing its root cause.
- row 77 `Emergency Contraception`: some agents and devices may also act after fertilization, a point of significant ethical and clinical debate. ... RRM clinicians generally do not prescribe emergency contraception, both because RRM ad
- row 119 `Frozen Embryo Transfer (FET)`: FET is not an RRM procedure per se, but RRM practitioners may encounter it when patients who have previously undergone IVF transition to RRM care after implantation failures.
- row 148 `Induction`: letrozole (an aromatase inhibitor preferred in PCOS per the PPCOS-II trial)
- row 152 `Intralipid Therapy (Immune Modulation)`: In RRM, intralipid use is individualized based on immune profile and considered alongside LDN and IVIG in refractory immune-mediated RPL cases.
- row 165 `Letrozole (Femara) — RRM Use`: It is the first-line ovulation induction agent for anovulatory PCOS per ASRM/ESHRE 2023 guidelines, superior to clomiphene citrate for live birth rates.

### unverified (74)

- row 14 `Antioxidant Therapy`: Optimal dosing follows a U-shaped dose-response relationship, with both deficiency and excess potentially harmful.
- row 275 `Restorative (as a Principle)`: Stanford JB, Restoration of natural fertility: the philosophical foundation of NaProTECHNOLOGY, Issues Law Med 2008;24:103–110
- row 248 `Personalized Treatment`: desire for future fertility shapes the choice of isthmocele repair technique
- row 129 `Holistic Approach`: Institute for Functional Medicine. Whole-person care model. https://www.ifm.org
- row 65 `Creighton Model FertilityCare System (CrMS)`: reported perfect-use rates of 99.5% for avoiding pregnancy
- row 240 `Peak Day`: Peak Day correlates closely with ovulation, occurring within ±3 days of follicle rupture in 95% of cycles
- row 99 `FEMM (Fertility Education and Medical Management)`: Tham E et al. (2012). FEMM-based charting and cycle monitoring outcomes. Linacre Quarterly.
- row 301 `Tail-End Brown Bleeding (TEB)`: Hilgers TW, Stanford JB, The diagnostic value of mucus and bleeding observations in the Creighton Model FertilityCare System, Fertil Steril 1998 (cohort data)
- row 203 `NaPro Medical`: AAFCP Medical Consultant program
- row 203 `NaPro Medical`: NaProTECHNOLOGY surgical principles (NARPS/PEARS)
- row 101 `FEMM Medical Management`: Tham E et al. (2012). FEMM-based medical management outcomes. Linacre Quarterly.
- row 273 `Reproductive Health Research Institute (RHRI)`: Vigil P et al., The importance of fertility awareness in the assessment of a woman's health: a review, Linacre Q 2017;84:7–18
- row 273 `Reproductive Health Research Institute (RHRI)`: Vigil P et al., Endometrial receptivity and treatment of infertility in women with PCOS, Front Reprod Health 2022
- row 297 `Sympto-Hormonal Method`: Bouchard TP, Genuis SJ, Personal fertility monitors for contraception, CMAJ 2011;183:73–76
- row 297 `Sympto-Hormonal Method`: Fehring RJ, Schneider M, Raviele K, Variability in the phases of the menstrual cycle, J Obstet Gynecol Neonatal Nurs 2006;35:376–384
- row 55 `Cooperative Estrogen Replacement Therapy (CERT)`: CERT addresses Type V LPD (isolated luteal estradiol deficit) and Type B/C follicular phase function grades
- row 207 `NaProTECHNOLOGY Prematurity Prevention Program`: Hilgers and colleagues have published cohort outcomes reporting program preterm-birth rates of approximately 7% versus a contemporaneous U.S. baseline of about 12–12.3%
- row 287 `Selective Salpingography`: Reported success rates for relieving proximal tubal occlusion through TCFT range from approximately 70% to 90% in selected series, with subsequent intrauterine pregnancy rates of 25–40%.
- row 282 `S-MAP (Systematic Mapping of the Abdomen and Pelvis)`: every defined anatomic region of the abdomen and pelvis in a fixed sequence—diaphragm, liver and gallbladder surface, paracolic gutters, appendix, omentum, large and small bowel surface, anterior cul-
- row 82 `Endometrial Receptivity Analysis (ERA)`: ERA analyzes the expression of 238 genes related to endometrial receptivity
- row 17 `Antral Follicle Count (AFC)`: A normal total AFC is approximately 8-12 follicles; below 5 per ovary suggests diminished reserve.
- row 303 `Targeted Post-Peak Progesterone Series (Peak +3, +5, +7, +9, +11)`: progesterone fluctuates up to 8-fold in 90 minutes
- row 153 `Intratubal Pressure (ITP)`: In selective salpingography and fallopian tube recanalization procedures, ITP measurements are used to assess tubal patency and cannulation success.
- row 5 `Adhesiolysis`: K column sources: APIT Texas Medical, Indira IVF, Infertility & IVF Houston
- row 12 `Anti-Adhesion Barriers`: Published NaPro surgical series have documented dramatic long-term reductions in adhesion scores
- row 94 `Excision Surgery (for Endometriosis)`: ACOG Practice Bulletin No. 114 (2010). Management of Endometriosis.
- row 192 `Microsurgery`: PMC (2025). Natural Conception After Tubal Reconstruction. https://pmc.ncbi.nlm.nih.gov/articles/PMC12842830/
- row 193 `Mini-laparotomy`: Gomel V, Microsurgery of the Fallopian Tube (Reconstructive Tubal Surgery), Reprod Biomed Online 2014;28(1):3-12
- row 193 `Mini-laparotomy`: ASRM, Role of Tubal Surgery in the Era of Assisted Reproductive Technology, Practice Committee Opinion (Fertil Steril 2021;115:1143-1150)
- row 213 `Near Adhesion-Free Reconstructive Pelvic Surgery (NARPS)`: K cite: 'Hilgers TW. The Medical and Surgical Practice of NaProTECHNOLOGY. Chapter 74-78: NARPS Surgical Principles.'
- ... +44 more

### fabricated_stat (9)

- row 12 `Anti-Adhesion Barriers`: Clinical studies show Gore-Tex is more effective than Interceed or no barrier in preventing adhesion formation
- row 157 `Isthmocele Repair (Hysteroscopic)`: The hysteroscopic approach is appropriate for defects with adequate residual myometrial thickness (>=2.5 mm)
- row 216 `Neosalpingostomy / Fimbrioplasty`: Pregnancy rates after these procedures range from 30-60% depending on the degree of tubal damage
- row 318 `Tubo-tubal Anastomosis (Tubal Ligation Reversal)`: In carefully selected patients (age <38, adequate remaining tubal length >=4 cm, no other infertility factors), pregnancy rates after tubal reversal are 40-85%
- row 332 `Vasectomy Reversal (Vasovasostomy / Vasoepididymostomy)`: Reported patency rates after expert microsurgical vasovasostomy range from approximately 75% to 95%, with natural-conception pregnancy rates of 40-70%
- row 309 `Time to Pregnancy (TTP)`: FertilityNetwork. Time to Pregnancy - Meaning and Clinical Significance (2026). https://fertilitynetwork.in/glossary/time-to-pregnancy
- row 50 `Congenital Uterine Anomaly`: The prevalence in the general population is estimated at 5–6% and rises to 8% in women with recurrent miscarriage and 24% in women with late pregnancy losses.
- row 98 `Fecundability`: Fecundability declines with female age (from ~25% at age 25 to ~5% at age 40)
- row 125 `Hashimoto's Thyroiditis`: the most prevalent autoimmune thyroid disorder, disproportionately affecting women of reproductive age (prevalence 5-15% in women)

### drift (4)

- row 290 `Shortened Luteal Phase`: [Entire definition is identical to row 171 'Luteal Phase (LP)' — does NOT define shortened luteal phase]
- row 33 `Cervical Mucus Method`: Also called the Billings Ovulation Method, it is based on the biological fact that cervical mucus characteristics...
- row 172 `Luteal Phase Assessment`: Entire definition describes 'luteal phase' rather than 'luteal phase assessment.' The term is 'Luteal Phase Assessment' but the pplx_def defines the luteal phase itself.
- row 184 `Medical Management`: FEMM (Fertility Education and Medical Management) is a women's health model that integrates fertility awareness charting with evidence-based medical management of gynecologic and reproductive conditio


## Cross-term: repeated fabricated citations

If Perplexity invented the same fake PMID across multiple terms, the failure mode is systematic.

### Repeated PMIDs

- PMID `24926259` cited in: aromatase-inhibitors, clomiphene-citrate, follicle-stimulation, letrozole-rrm-use, metformin, targeted-ovarian-stimulation
- PMID `17071849` cited in: estradiol, follicle-stimulating-hormone, fsh, ovarian-reserve
- PMID `26537926` cited in: congenital-uterine-anomaly, uterine-anomalies-m-llerian-anomalies, uterine-cavity-evaluation, uterine-septum
- PMID `28299975` cited in: femm-levels, femm-medical-management, medical-management
- PMID `23360717` cited in: heteromolecular-artimones, hrt, isomolecular-hormones
- PMID `14711594` cited in: hyperandrogenism, pcos, polycystic-ovarian-morphology
- PMID `26806667` cited in: hysteroscopic-septoplasty, uterine-anomalies-m-llerian-anomalies, uterine-septum
- PMID `6202539` cited in: lowr, ovarian-drilling
- PMID `11433129` cited in: electrosurgery, napro-surgery
- PMID `29255329` cited in: femm-levels, femm-medical-management
- PMID `23238854` cited in: hrt, isomolecular-hormones
- PMID `9051789` cited in: follicle-maturation-study, ovulation-confirmation
- PMID `20869700` cited in: sperm-dna-fragmentation, sperm-dna-fragmentation-extended
- PMID `23414948` cited in: sperm-dna-fragmentation, sperm-dna-fragmentation-extended
- PMID `16891297` cited in: follicle-stimulating-hormone, ovarian-reserve
- PMID `15614469` cited in: fallopian-tube-recanalization, transcervical-catheterization-fallopian-tubes
- PMID `14998940` cited in: fallopian-tube-recanalization, transcervical-catheterization-fallopian-tubes
- PMID `1951072` cited in: fallopian-tube-recanalization, transcervical-catheterization-fallopian-tubes
- PMID `1898568` cited in: fallopian-tube-recanalization, transcervical-catheterization-fallopian-tubes
- PMID `28285939` cited in: excision-surgery, fulguration-ablation
- PMID `28456617` cited in: excision-surgery, fulguration-ablation
- PMID `35501502` cited in: isthmocele-repair-hysteroscopic, isthmocele-repair-laparoscopic
- PMID `33373714` cited in: isthmocele-repair-hysteroscopic, isthmocele-repair-laparoscopic
- PMID `25924657` cited in: isthmocele-repair-hysteroscopic, isthmocele-repair-laparoscopic
- PMID `18471809` cited in: myomectomy, uterine-fibroids
- PMID `11309004` cited in: pears, pelvic-adhesions
- PMID `22803269` cited in: d-chiro-inositol, myo-inositol
- PMID `23659659` cited in: d-chiro-inositol, myo-inositol
- PMID `10402367` cited in: hydrosalpinx, salpingectomy
- PMID `24569374` cited in: human-leukocyte-antigen-kir-compatibility, nk-cells
- PMID `34233646` cited in: napro-vs-rrm, patient-centered-care

### Repeated DOIs

- DOI `10.1186/s12884-021-03946-8.` cited in: natural-fertility, personalized-treatment, root-cause-diagnosis


## Sheet-curation drift (separate from Perplexity issues)

These are issues with the authoritative columns themselves (MeSH, ICD, rrm_canonical_match, etc.) — not Perplexity bugs but worth fixing in the Sheet.

- row 271 `Reproductive Endocrinology` col AE rrm_canonical_match
  - Issue: Library entry is a 1995 review BY Kennard EA of the Speroff textbook, not the textbook itself. A glossary-level canonical match for 'Reproductive Endocrinology' should point to either the Speroff textbook chapter (or its successor edition) or to a high-quality RRM library overview article. The 1995 Kennard review is dated and tangential.
  - Current: `https://rrmacademy.org/library/clinical-gynecologic-endocrinology-and-infertility-recy2mml7i2caj4yq Clinical Gynecologic Endocrinology and Infertility (article -- Kennard EA, 1995)`
  - Fix: Either retarget AE to a more representative RRM library entry on reproductive endocrinology (e.g., a Hilgers chapter wrap-up or a more recent RRM REI overview), OR retain but annotate that AE links to a textbook review rather than primary source.

- row 274 `Reproductive Immunology` col AE rrm_canonical_match
  - Issue: Auth-col AE points to a 1998 endometriosis research review, not a reproductive immunology paper. The term and its canonical match are mismatched — Giudice 1998 is endo-focused. Should point to a real RRM library reproductive-immunology entry (Boyle NeoFertility lecture, Kwak-Kim review, or Coulam/Acacio reference).
  - Current: `https://rrmacademy.org/library/status-of-current-research-on-endometriosis-recmdrkfhcjlhl1wq Status of current research on endometriosis (article -- Giudice LC et al., 1998)`
  - Fix: Retarget AE to a Boyle/NeoFertility reproductive-immunology library entry or a Kwak-Kim/Coulam review actually in the RRM library.

- row 110 `FertilityCare Practice` col AA rrm_textbook_match
  - Issue: Adjacent row 111 (FCP) correctly cites Hilgers Ch 84 'Role of FertilityCare Practitioner.' Row 110 (FertilityCare Practice — the SETTING the FCP works in) has blank AA. Same Ch 84 should backfill here, since the chapter describes both the practitioner and the practice context.
  - Current: `(blank)`
  - Fix: Backfill AA with the same Ch 84 reference used in row 111 (D1: recSAX8qpGZBaMyRp).

- row 110 `FertilityCare Practice` col AB nci_thesaurus_definition
  - Issue: Auth-col AB points to NCI 'Best Practice' (C94396) — a generic clinical-practice concept, NOT specific to FertilityCare. This is a curation mismatch: NCI Thesaurus has no entry for 'FertilityCare Practice' specifically, so AB should be left blank rather than filled with an unrelated NCI concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C94396 Best Practice (NCI) An informed treatment recommendation that is expected to be helpful to the great`
  - Fix: Clear AB for row 110 — there is no authoritative NCI Thesaurus entry for FertilityCare Practice. Leaving it blank is more honest than the current Best Practice mismatch.

- row 245 `Pelvic Floor Physical Therapy` col AB nci_thesaurus_definition
  - Issue: Auth-col AB points to 'Pelvic Floor Muscle' anatomy concept (C33290) — the muscle, not the therapy. PFPT is a clinical intervention; NCI may not have a direct concept, but the current anatomy-only match doesn't authorize the therapy/intervention claims in the Perplexity def.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C33290 Pelvic Floor Muscle (NCI) The muscles, composed of the levator ani and the coccygeus muscles, that c`
  - Fix: Annotate AB as 'related anatomy concept only' or clear it. PFPT itself is best authorized by APTA Section on Pelvic Health or ACOG CO 673 (already in K).

- row 121 `Functional and Nutritional Medicine` col AE rrm_canonical_match
  - Issue: Auth-col AE points to a 2001 PMS estrogen-metabolism medical-food paper (Lukaczer). Tangentially related to functional/nutritional medicine but narrow PMS focus. The glossary term spans the broader functional+nutritional discipline and would be better served by a broader fertility-nutrition overview (e.g., Gaskins/Chavarro 2018, which IS curl-verified).
  - Current: `https://rrmacademy.org/library/improvement-in-symptoms-and-estrogen-metabolism-in-women-with-premenstrual-syndr-recpbxmlul1ms4mvo Improvement in Symptoms and Estrogen Metabolism in Women with Premenst`
  - Fix: Retarget AE to a stronger fertility-focused functional/nutritional medicine RRM library entry, or to Gaskins AJ/Chavarro JE 2018 'Diet and fertility: a review' if it's in the library.

- row 276 `Restorative Andrology` col AA rrm_textbook_match
  - Issue: Restorative andrology is a developing RRM concept; Hilgers textbook predates strong RRM-andrology coverage. AA blank is defensible but a JRRM article (Stanford 2025 'Welcome to JRRM' is in AE) or a Boyle/Yeung/Chiva male-factor lecture in Z could provide stronger RRM canon than what's currently captured.
  - Current: `(blank)`
  - Fix: Optional: add a Boyle or Chiva male-factor RRM lecture to AA or annotate that no Hilgers-textbook chapter directly covers Restorative Andrology — it is a post-Hilgers RRM-paradigm extension.

- row 36 `Cervical Stenosis` col AB nci_thesaurus_definition
  - Issue: NCI code C34966 is "Pyloric Stenosis" (gastric pylorus narrowing), NOT cervical stenosis. Wrong NCI concept mapped.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C34966
Pyloric Stenosis (NCI)
Narrowing of the pyloric lumen...`
  - Fix: Replace with a correct NCI concept for cervical stenosis or null out the cell. NCI Thesaurus may not have a direct "cervical stenosis" entry; consider mapping to "Stenosis" (C34971) or leaving empty.

- row 36 `Cervical Stenosis` col AA rrm_textbook_match
  - Issue: Best match is Chapter 6 on cancer survival with only 1 occurrence. Hilgers Ch 56 (referenced by Perplexity sources) is the canonical Cervical Stenosis chapter and likely exists in the textbook D1 but the match algorithm picked a less relevant chapter.
  - Current: `D1: rec73aKK5f4qPbrxJ
CHAPTER SIX Early Detection: The Key to Cancer Survival?
chapter -- Hilgers TW -- 1 occurrence(s) of "Cervical Stenosis"`
  - Fix: Re-run match against rrm-cli textbook D1 for "cervical stenosis" preferring chapters with higher occurrence counts. Manually inspect for Hilgers Ch 56.

- row 37 `Cervix` col AA rrm_textbook_match
  - Issue: Match returned an unrelated RSV paper. The textbook has extensive cervix-anatomy content (Hilgers chapters on cervical mucus biology).
  - Current: `D1: recBdlzYR6MXya1F2
Respiratory Syncytial Virus Co-Detection With Other Respiratory Viruses Is Not Significantly Associated With Worse Clinical Outcomes Among Children Aged <2 Years`
  - Fix: Re-run rrm_textbook match for "cervix" preferring Hilgers chapters 5-7 (cervical mucus biology) or chapter on cervical anatomy.

- row 50 `Congenital Uterine Anomaly` col AA rrm_textbook_match
  - Issue: Unrelated RSV paper. Hilgers Ch 60 (per Perplexity sources, unverified) or chapters on uterine anomalies should be the match.
  - Current: `D1: recBdlzYR6MXya1F2
Respiratory Syncytial Virus Co-Detection With Other Respiratory Viruses...`
  - Fix: Re-run match against textbook D1 for "uterine anomaly" / "uterine septum" / "Mullerian anomalies".

- row 50 `Congenital Uterine Anomaly` col AB nci_thesaurus_definition
  - Issue: NCI C84681 is "Ebstein Anomaly" — a CARDIAC malformation, completely unrelated to congenital uterine anomaly. Mapping caught "anomaly" keyword without specificity.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C84681
Ebstein Anomaly (NCI)
A rare congenital heart malformation...`
  - Fix: Replace with NCI concept "Uterine Anomaly" if it exists, or null out the cell.

- row 25 `Behavioral Methods` col AB nci_thesaurus_definition
  - Issue: NCI C18912 is "Optical Methods" (analytical chemistry technique), not "Behavioral Methods" for family planning. Keyword-mismatch.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C18912
Optical Methods (NCI)
Any method of quantitative or qualitative analysis that involves optics...`
  - Fix: Null out cell or remap to NCI Behavior-Therapy or Behavior-Modification concept.

- row 46 `Comparative Studies` col AB nci_thesaurus_definition
  - Issue: NCI C175270 is "Comparative Score" not "Comparative Studies" as a research design. Wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C175270
Comparative Score (NCI)
A score derived from an aggregate...`
  - Fix: Remap to a study-design concept like "Comparative Study" (C53350 if exists) or null out.

- row 52 `Contraceptive Agents` col AB nci_thesaurus_definition
  - Issue: NCI C16005 is "New Agents" (drug-discovery research), not "Contraceptive Agents". Keyword-match on "Agents".
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C16005
New Agents (NCI)
Research into new physical or chemical agents...`
  - Fix: Remap to NCI "Contraceptive Agent" or pharmacological-class concept; or null out.

- row 26 `Billings` col AB nci_thesaurus_definition
  - Issue: NCI C88189 is "Billing" (medical billing/payment) — not "Billings" the eponymous fertility-awareness method. Surname/keyword collision.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C88189
Billing (NCI)
The process of requesting payment of a debt for goods or services.`
  - Fix: Null out col AB — Billings Ovulation Method is unlikely to have an NCI Thesaurus entry. Or document as "no NCI match."

- row 73 `Dyspareunia` col AA rrm_textbook_match
  - Issue: Global mortality paper has no plausible connection to dyspareunia. Hilgers Ch 52 (per Perplexity sources) on pelvic pain and dyspareunia should be the match.
  - Current: `D1: recmNex7vnsu13wGR
Global age-sex-specific all-cause mortality and life expectancy estimates for 204 countries and territories and 660 subnational`
  - Fix: Re-run rrm_textbook match for "dyspareunia" against textbook D1; prefer Hilgers chronic pelvic pain chapter.

- row 33 `Cervical Mucus Method` col AA rrm_textbook_match
  - Issue: Chapter title "Foundations of Scientific Communication Theory" sounds wrong for a Cervical Mucus glossary entry, even at 54 occurrences. The canonical chapter is Hilgers Ch 15 "Scientific Foundations of the CrMS" (referenced by Perplexity sources). Likely a chapter-title mis-extraction OR wrong chapter picked.
  - Current: `D1: rec3Jm7b4FxAtla9e
Chapter 1 The Foundations of Scientific Communication Theory
chapter -- Hilgers TW -- 54 occurrence(s) of "Cervical Mucus"`
  - Fix: Verify chapter title in textbook D1 — likely chapter 15 should be the match. Same issue affects rows 34, 35 (all three Cervical Mucus rows share this match).

- row 57 `CoQ10 (Coenzyme Q10) — Fertility Use` col AA rrm_textbook_match
  - Issue: Food processing chapter with 1 occurrence of "Fertility" is irrelevant to CoQ10. CoQ10 is unlikely to be a Hilgers textbook topic — null out is acceptable.
  - Current: `D1: recF9fkdYNPyHNo23
Introductory Chapter: A Global Presentation on Trends in Food Processing
chapter -- Alina Marc R -- 1 occurrence(s) of "Fertility"`
  - Fix: Null out col AA — CoQ10 is a contemporary nutraceutical not core to the 2004 NaProTechnology textbook.

- row 64 `Creighton Model` col AA rrm_textbook_match
  - Issue: Same "Food Processing" chapter cited with 24 occurrences of "Creighton" — implausible chapter title for that content. Likely chapter-metadata mis-ingest in D1.
  - Current: `D1: recF9fkdYNPyHNo23
Introductory Chapter: A Global Presentation on Trends in Food Processing
chapter -- Alina Marc R -- 24 occurrence(s) of "Creighton"`
  - Fix: Audit D1 record recF9fkdYNPyHNo23 for chapter-title extraction error. Hilgers chapters on CrMS foundations (Ch 1, 15) should be the match.

- row 270 `Recurrent Pregnancy Loss (RPL)` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus link returns 'Twin Pregnancy' concept — not relevant to recurrent pregnancy loss
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C112852
Twin Pregnancy (NCI)
A pregnancy involving two fetuses.`
  - Fix: Replace with NCI Thesaurus concept for Recurrent Pregnancy Loss / Habitual Abortion (search ncithesaurus for 'recurrent pregnancy loss' or 'habitual abortion'); or remove this column for RPL

- row 290 `Shortened Luteal Phase` col J pplx_definition (NOTE: this is a sheet content issue, the definition row J in 290 is a DUPLICATE of row 171 Luteal Phase)
  - Issue: Perplexity definition for Shortened Luteal Phase is a verbatim copy of the generic Luteal Phase definition — it never defines 'shortened'. Likely upstream Perplexity-generation error or copy-paste mistake.
  - Current: `[Definition is verbatim identical to row 171 (Luteal Phase (LP))]`
  - Fix: Regenerate Perplexity definition specifically for 'shortened luteal phase' (LP <=10 days, CrMS P+ count <10, implications for implantation/early pregnancy support)

- row 317 `Tubal Factor Infertility` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus column returns 'Male Infertility' concept for a tubal factor (female) row
  - Current: `Male Infertility (NCI)
A condition where a man is unable to conceive a child...`
  - Fix: Replace with NCI concept for tubal factor infertility or female infertility; or remove the column entry

- row 326 `Uterine Isthmocele (Cesarean Scar Defect / Uterine Niche)` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus returns 'Uterine Adnexa' (ovaries/tubes/ligaments) which is unrelated to isthmocele (uterine wall scar defect)
  - Current: `Uterine Adnexa (NCI)
The accessory structures of the uterus, including the ovaries, fallopian tubes...`
  - Fix: Search NCI Thesaurus for 'cesarean scar defect' or remove the column entry

- row 328 `Uterine Septum` col AA rrm_textbook_match
  - Issue: RRM textbook match column points to an orthopedic surgery paper about iliopsoas/hip arthroscopy — completely unrelated to uterine septum. Likely supplemental-index full-text search matched on the literal word 'septum'.
  - Current: `D1: supplemental-index
Iliopsoas Tunnel Deepening and Fractional Lengthening Relieve Painful Internal Snapping During Concomitant Primary Hip Arthroscopy for Treatment of Femoroacetabular Impingement:`
  - Fix: Replace with the actual Hilgers textbook chapter on uterine anomalies/septum (likely Ch 60 per Perplexity sources — should locate the canonical chapter on Mullerian anomalies / hysteroscopic septoplasty)

- row 328 `Uterine Septum` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus column returns 'Heart Septum' — wrong organ entirely for a uterine septum row
  - Current: `Heart Septum (NCI)
The tissue in the heart that separates the two atria (atrial septum) and the two ventricles (ventricular septum).`
  - Fix: Search NCI Thesaurus for 'uterine septum' or 'septate uterus'; or remove column entry

- row 293 `Sperm DNA Fragmentation Index (DFI): Extended` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus column returns 'Sperm Banking' — unrelated to DNA fragmentation
  - Current: `Sperm Banking (NCI)
Freezing sperm for use in the future.`
  - Fix: Search NCI for 'sperm DNA fragmentation' or remove

- row 130 `Hormonal Abnormalities` col AB nci_thesaurus_definition
  - Issue: Generic 'Multiple Abnormalities' concept — not specific to hormonal/endocrine abnormalities
  - Current: `Multiple Abnormalities (NCI)
The presence of more than one anomaly.`
  - Fix: Use NCI 'Endocrine System Disorder' or 'Hormone Disorder' concept; or remove

- row 176 `Luteinized Unruptured Follicle (LUF) Syndrome` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus column returns 'Cystic Follicle' which describes THYROID follicles — wrong organ entirely
  - Current: `Cystic Follicle (NCI)
Normal thyroid follicles that are many times larger than normal and usually focal. (INHAND)`
  - Fix: Search NCI for 'luteinized unruptured follicle' or remove (likely no NCI concept exists)

- row 95 `Fallopian Tube Anatomy Reference` col AB nci_thesaurus_definition
  - Issue: Specifies 'Right Fallopian Tube' rather than general anatomy concept — partially relevant but unnecessarily lateralized
  - Current: `Right Fallopian Tube (NCI)
The fallopian tube that extends from the uterus to the ovary in the right side of the pelvic cavity.`
  - Fix: Use NCI 'Fallopian Tube' (general anatomy) concept instead; minor curation polish

- row 149 `Infertility` col AE rrm_canonical_match
  - Issue: RRM canonical match column points to a voice-analysis internal document, not a citation about infertility
  - Current: `Dr. Whittaker X/Twitter Voice Analysis (voice-analysis)`
  - Fix: Replace with a canonical RRM library article about infertility definitions / RRM approach to infertility (e.g., a Hilgers, Stanford, or Whittaker article on RRM workup)

- row 144 `IIRRM (International Institute for Restorative Reproductive Medicine)` col AC wikipedia_summary
  - Issue: Wikipedia link is to International Institute of Rural Reconstruction (IIRR - Philippine NGO), not IIRRM. Completely wrong entity.
  - Current: `https://en.wikipedia.org/wiki/International_Institute_of_Rural_Reconstruction -- International Institute of Rural Reconstruction (Philippine non-profit organization)`
  - Fix: Drop the Wikipedia AC column entry - there is no Wikipedia article specifically for IIRRM. Alternatively link to the Restorative Reproductive Medicine Wikipedia article if one exists.

- row 147 `In Vitro Activation (IVA)` col AC wikipedia_summary
  - Issue: Wikipedia link is to the plant genus Iva (Asteraceae marsh elders), not the In Vitro Activation reproductive technique.
  - Current: `https://en.wikipedia.org/wiki/Iva_(plant) -- Iva (plant) (Genus of flowering plants)`
  - Fix: Drop the AC Wikipedia entry. There is no Wikipedia article for the IVA reproductive technique; this is an erroneous automated match on the abbreviation.

- row 87 `Endometritis` col AE rrm_canonical_match
  - Issue: The match is reasonable but pivots to a specific endometriosis-CE association rather than a general endometritis canonical source. Consider whether a broader RRM endometritis page exists.
  - Current: `The association between endometriosis and chronic endometritis (article -- Takebayashi A et al., 2014)`
  - Fix: Acceptable but verify whether a more general RRM/NaPro source on chronic endometritis exists in the rrmacademy library.

- row 124 `Granulosa Cells` col AE rrm_canonical_match
  - Issue: Canonical match is tangentially about granulosa-related estrogen production but the paper is primarily about progesterone-restoring-cycles in PCOS, not granulosa cell biology directly.
  - Current: `Gestational progesterone restores menstrual cycle in PCOS patients via enhancing ovary estrogen production (article -- Yang Q et al., 2026)`
  - Fix: Find a better RRM canonical source on granulosa cell biology specifically, or note that no dedicated RRM canonical page exists for this foundational term.

- row 127 `Hematometra` col AE rrm_canonical_match
  - Issue: URL slug says 'cervical-mucus-anomalies-in-patients-with-endometriosis' but the displayed article title is 'Vaginoscopic Resection of Oblique Vaginal Septum in OHVIRA Syndrome' - these don't match. Either the URL or the title is wrong.
  - Current: `https://rrmacademy.org/library/cervical-mucus-anomalies-in-patients-with-endometriosis-rec3shviouj8drckb -- Vaginoscopic Resection of Oblique Vaginal Septum in OHVIRA Syndrome Before Menarche. (articl`
  - Fix: Resolve the URL/title mismatch in the library: either the slug or the article metadata is corrupted. The OHVIRA paper is the relevant one for hematometra (obstructive cause) but the URL slug points elsewhere.

- row 89 `Estradiol` col AE rrm_canonical_match
  - Issue: Year in AE shows '2024' but the actual paper (PMID 38239818) was published in 2023 (Front Reprod Health 5, 2023).
  - Current: `Restoration of serum estradiol and reduced incidence of miscarriage in patients with low serum estradiol during pregnancy: a retrospective cohort study using a multifactorial protocol including DHEA (`
  - Fix: Correct the year from 2024 to 2023 in the AE column metadata.

- row 170 `Low-Dose Naltrexone (LDN)` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus link points to 'Low-Dose Aspirin' concept C94758, not Low-Dose Naltrexone. Auth column drift -- wrong NCI concept seeded for this term.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C94758 -- Low-Dose Aspirin (NCI)`
  - Fix: Replace with the NCI Thesaurus concept for Naltrexone (C62054) or remove if no naltrexone-specific concept exists.

- row 69 `DHEA (Dehydroepiandrosterone) in RRM` col AB nci_thesaurus_definition
  - Issue: NCI link points to 'DHEA Mustard' (an antineoplastic alkylating agent), not Dehydroepiandrosterone. Wrong NCI concept seeded.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C2707 -- DHEA Mustard (NCI)`
  - Fix: Replace with the NCI concept for Dehydroepiandrosterone itself (NCI Thesaurus code C375 'Dehydroepiandrosterone') if it exists, or remove.

- row 181 `Marquette Method Clinical Protocol` col AB nci_thesaurus_definition
  - Issue: NCI link points to 'Marquette County, WI' (a geographic concept), not the Marquette Method (a fertility-awareness method developed at Marquette University). Auth column drift from naive name-match.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C110774 -- Marquette County, WI`
  - Fix: Remove the NCI thesaurus row entirely -- NCI has no concept for the Marquette FABM. Leave AB blank.

- row 56 `Cooperative Progesterone Replacement Therapy (CPRT)` col AB nci_thesaurus_definition
  - Issue: NCI link points to 'Renal Replacement Therapy', not progesterone replacement. Wrong concept seeded by string match on 'Replacement Therapy'.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C126400 -- Renal Replacement Therapy (NCI)`
  - Fix: Replace with NCI concept for Progesterone Therapy or Hormone Replacement Therapy, or remove.

- row 126 `HCG Trigger (Human Chorionic Gonadotropin Trigger)` col AB nci_thesaurus_definition
  - Issue: NCI link points to 'Treatment Trigger' (a generic clinical-trial indicator), not hCG/Human Chorionic Gonadotropin. Drift from string match on 'Trigger'.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C161578 -- Treatment Trigger (NCI)`
  - Fix: Replace with NCI Thesaurus concept for Human Chorionic Gonadotropin (C557 or similar), or remove.

- row 3 `Achieving-Related Pregnancy Rate (ARPR)` col AB nci_thesaurus_definition
  - Issue: NCI link points to 'Pregnancy Related Mood Swing', not anything to do with pregnancy rates. Drift from string match on 'Pregnancy Related'.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C92937 -- Pregnancy Related Mood Swing (NCI)`
  - Fix: Remove -- NCI Thesaurus has no specific concept for ARPR; the auth value is misleading.

- row 38 `ChartNeo` col AE rrm_canonical_match
  - Issue: Canonical match links to a DHEA pregnancy case-report article, which is unrelated to ChartNeo (a charting app). Auth column drift.
  - Current: `https://rrmacademy.org/library/successful-pregnancy-using-oral-dhea-treatment-for-hypoandrogenemia-in-a-30-year-recqps2hkkadr4wm6 -- Successful pregnancy using oral DHEA treatment for hypoandrogenemia`
  - Fix: Replace with a NeoFertility / ChartNeo-specific reference if one exists in the RRM library; otherwise leave blank.

- row 207 `NaProTECHNOLOGY Prematurity Prevention Program` col AB nci_thesaurus_definition
  - Issue: NCI link is 'Anemia of Prematurity' (a neonatal hematology concept) -- not directly relevant to the prematurity-prevention obstetric program. Mild drift from 'Prematurity' string match.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C97167 -- Anemia of Prematurity (NCI)`
  - Fix: Replace with NCI Preterm Birth concept or remove -- the current value is tangential.

- row 261 `Premature Ovarian Insufficiency (POI)` col AB nci_thesaurus_definition
  - Issue: C124571 "Premature Closure" is a generic term about anatomical fusion/closure (e.g., premature suture closure), not about ovarian insufficiency. Sheet auto-match keyed on "Premature".
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C124571
Premature Closure (NCI)
Fusion, stoppage, or loss of patency occurring before the usual or proper t`
  - Fix: Remove the wrong link, OR replace with NCI Thesaurus C92807 (Premature Ovarian Failure / POF) which is the correct NCI concept.

- row 70 `Diminished Ovarian Reserve (DOR)` col AB nci_thesaurus_definition
  - Issue: C33916 "Reserve Cell" is a cervical/columnar epithelium histology term unrelated to ovarian reserve. Sheet auto-match keyed on "reserve".
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C33916
Reserve Cell (NCI)
A term that refers to immature cells located between the surface columnar epithel`
  - Fix: Remove, or replace with NCI C113242 "Diminished Ovarian Reserve" if present in thesaurus; if no exact match exists, leave blank with [no_NCI_match] flag.

- row 309 `Time to Pregnancy (TTP)` col AA rrm_textbook_match
  - Issue: Mapped chapter is a 2016-2020 RSV virology paper (no Hilgers, no TTP topic). 1 occurrence of "Time to Pregnancy" appears in an unrelated reference list. Should map to a Hilgers chapter on infertility outcomes or a cohort study.
  - Current: `D1: recBdlzYR6MXya1F2
Respiratory Syncytial Virus Co-Detection With Other Respiratory Viruses Is Not Significantly Associated With Worse Clinical Outcomes Among Children Aged <2 Years: New Vaccine Sur`
  - Fix: Remap to Hilgers Ch 40 NaProTECHNOLOGY in Infertility (D1 receWRScQcAp5rajk) which discusses cumulative pregnancy rates.

- row 309 `Time to Pregnancy (TTP)` col AB nci_thesaurus_definition
  - Issue: C93153 "Time to Progression" is an ONCOLOGY endpoint metric, completely unrelated to fertility TTP.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C93153
Time to Progression (NCI-GLOSS)
A measure of time after a disease is diagnosed (or treated) until th`
  - Fix: Remove. No NCI Thesaurus concept exists for fertility TTP; leave blank with [no_NCI_match].

- row 309 `Time to Pregnancy (TTP)` col AD snomed_ct_definition
  - Issue: SNOMED 59283008 is "Maternal death", not Time to Pregnancy.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=59283008&edition=MAIN&languages=en
Maternal death (Maternal death (event))`
  - Fix: Remove or remap to SNOMED 387735000 if a fertility-TTP concept exists; otherwise leave blank.

- row 32 `Cervical Factor Infertility` col AE rrm_canonical_match
  - Issue: AE maps to an IUI outcomes paper by Emperaire 1988; the URL slug suggests the linked article in D1 is actually a Hilgers sonographic ovulation classification (unrelated to cervical factor). The displayed title (IUI/activated sperm) is also only tangentially related to cervical factor.
  - Current: `https://rrmacademy.org/library/a-sonographic-classification-system-for-disorders-of-human-ovulation-recdmt4zj6w45o1wb
[Intra-uterine insemination with activated sperm. Results of conception compared i`
  - Fix: Remap to a Hilgers cervical-factor paper (e.g. PMID 24199174 or a Pope Paul VI Institute cervical-factor cohort), or to the Abuzeid 1987 endocervical estrogen receptor paper which is currently AE for row 253.

- row 41 `Chronic Pelvic Pain (CPP)` col AC wikipedia_summary
  - Issue: Wikipedia link points to MALE chronic prostatitis/CPPS, not female chronic pelvic pain.
  - Current: `https://en.wikipedia.org/wiki/Chronic_prostatitis%2Fchronic_pelvic_pain_syndrome
Chronic prostatitis/chronic pelvic pain syndrome (Medical condition)
Chronic prostatitis/chronic pelvic pain syndrome (`
  - Fix: Replace with https://en.wikipedia.org/wiki/Chronic_pelvic_pain (which exists as a separate Wikipedia article for the female condition).

- row 212 `Natural Killer (NK) Cells` col AA rrm_textbook_match
  - Issue: Mapped chapter is a GBD 2023 demographic mortality paper (Lancet, 2024), with 3 incidental "Natural Killer" mentions in a separate excerpt. Wrong source.
  - Current: `D1: recmNex7vnsu13wGR
Global age-sex-specific all-cause mortality and life expectancy estimates for 204 countries and territories and 660 subnational locations, 1950-2023: a demographic analysis for t`
  - Fix: Remap to Hilgers chapter on endometriosis/immune mechanisms or recurrent miscarriage, or to Moffett A et al. 2014 JCI (real PMID 24789879) review.

- row 59 `Corpus Luteum Deficiency (CLD)` col Q icd10_code / S icd10_definition / T icd11_code / V icd11_definition
  - Issue: Both ICD-10 E73.0 and ICD-11 5C61.61 are CONGENITAL LACTASE DEFICIENCY, not corpus luteum deficiency. Likely automated keyword match on "deficiency".
  - Current: `Q: E73.0 ; S: ICD-10 (WHO 2019, E73.0): Congenital lactase deficiency ; T: 5C61.61 ; V: ICD-11 MMS (2024-01, 5C61.61): Congenital lactase deficiency`
  - Fix: Remove these ICD codes. CLD has no clean dedicated ICD-10 code; closest analog is N97.0 "Female infertility associated with anovulation" or N97.8. Leave ICD-11 blank.

- row 74 `Early Pregnancy Loss` col AA rrm_textbook_match
  - Issue: Mapped chapter is a sarcopenia / low-birth-weight molecular-pathways paper, not Hilgers. 34 "Early Pregnancy Loss" occurrences are in a reference list. The first paragraph of the excerpt does mention Hilgers-style framing ("Early Pregnancy Loss: Challenging Current Paradigms") which suggests the excerpt was mis-stitched.
  - Current: `D1: recz9wK51CZxb66wt
The effect of low birth weight as an intrauterine exposure on the early onset of sarcopenia through possible molecular pathways. (chapter -- Celik D, Campisi M, Cannella L, Pavan`
  - Fix: Remap to the Hilgers chapter on Early Pregnancy Loss / RPL specifically (Hilgers Medical and Surgical Practice of NaProTECHNOLOGY).

- row 145 `Immature Follicle Syndrome (IFS)` col AC wikipedia_summary
  - Issue: Wikipedia link matches the abbreviation "IFS" against the French commune Ifs in Calvados. Completely unrelated to the medical concept.
  - Current: `https://en.wikipedia.org/wiki/Ifs%2C_Calvados
Ifs, Calvados (Commune in Normandy, France)
Ifs is a commune in the Calvados department in the Normandy region in northwestern France.`
  - Fix: Remove. There is no dedicated Wikipedia article for Hilgers Immature Follicle Syndrome; leave blank or link to Wikipedia "Anovulation" (https://en.wikipedia.org/wiki/Anovulation).

- row 234 `Partial Rupture Syndrome (PRS)` col N mesh_descriptor / O mesh_url / P mesh_scope_note / Q icd10_code / R icd10_url / S icd10_def / T icd11_code / U icd11_url / V icd11_def / Y wikidata_url
  - Issue: ALL standard medical codes mapped to "PRS" resolved to PIERRE ROBIN SYNDROME (a craniofacial congenital malformation) — completely unrelated to Hilgers Partial Rupture Syndrome of ovulation.
  - Current: `N: D010855 ; P: (Pierre Robin Syndrome) Congenital malformation characterized by MICROGNATHIA or RETROGNATHIA... ; Q: Q87.0 ; S: ICD-10 Q87.0: Congenital malformation syndromes predominantly affecting`
  - Fix: Remove all N/O/P/Q/R/S/T/U/V/Y. Hilgers Partial Rupture Syndrome is RRM-internal; no MeSH/ICD/Wikidata mapping exists. Leave blank with [rrm_internal_term] flag.

- row 117 `Follicular Deficiency` col AD snomed_ct_definition
  - Issue: SNOMED 22686009 is vitamin A deficiency with follicular skin keratosis, not ovarian follicular deficiency. Match keyed on "follicular" + "deficiency".
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=22686009&edition=MAIN&languages=en
Vitamin A deficiency with follicular keratosis (Vitamin A deficiency with follicular keratosis (disorder`
  - Fix: Remove. Hilgers Follicular Deficiency has no dedicated SNOMED concept; leave blank.

- row 182 `Mature Reproductive Age` col AB nci_thesaurus_definition
  - Issue: NCI C33059 "Mature Bone" is a histology concept, unrelated to reproductive age.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C33059
Mature Bone (NCI)
A type of bone tissue. There are two subtypes of mature bone - compact and spongy.`
  - Fix: Remove. Term is NaPro-internal age categorization; leave NCI blank.

- row 32 `Cervical Factor Infertility` col AA rrm_textbook_match
  - Issue: Maps to Hilgers Ch 38 (general trends) which has 7 mentions of "Cervical Factor", but Hilgers has a DEDICATED Ch 39 "Cervical Factor in Infertility" that is the canonical chapter for this term.
  - Current: `D1: recDSCfTBVrs4un2l
Chapter 38: Trends and Deficiencies in Infertility (chapter -- Hilgers TW -- 7 occurrence(s) of "Cervical Factor")`
  - Fix: Remap AA to Hilgers Ch 39 "Cervical Factor in Infertility" if present in D1.

- row 262 `Premenopause` col AE rrm_canonical_match
  - Issue: Hume 1977 ovulation-method paper is not specifically about premenopause; only tangentially related. Better match exists (e.g., Hilgers Ch 10 premenopause section or Prior 2006 perimenopause paper).
  - Current: `https://rrmacademy.org/library/the-ovulation-method-of-natural-family-planning-reccursmzmzlmg3ni
The ovulation method of natural family planning (article -- Hume K, 1977)`
  - Fix: Remap to a premenopause-specific RRM Library article if available, or borrow Prior 2006 "Perimenopause lost" (currently AE for row 247) which discusses the late-reproductive→menopause transition more directly.

- row 184 `Medical Management` col M medlineplus_definition
  - Issue: MedlinePlus link is matched to 'alcohol use disorder', not to anything resembling medical management in reproductive medicine. Either the term is too generic ('Medical Management' alone has no clinical specificity for medlineplus to match) or the sheet's medlineplus matcher pulled the wrong page.
  - Current: `(Alcohol use disorder - resources) Alcohol use disorder is a medical condition. If you think you may have an alcohol use disorder, see a health care provider.`
  - Fix: Drop the MedlinePlus cell or rename the term to e.g. 'FEMM' / 'Medical Management of Reproductive Conditions' and rematch.

- row 184 `Medical Management` col AE rrm_canonical_match
  - Issue: ACOG opinion on acute abnormal uterine bleeding is a narrow scope and not 'medical management' broadly. Likely wrong canonical match.
  - Current: `https://rrmacademy.org/library/acog-committee-opinion-no-557-management-of-acute-abnormal-uterine-bleeding-in-n-recvitpufa2v21ce6 — ACOG committee opinion no. 557 (article -- ACOG, 2013)`
  - Fix: Brian arbitration — disambiguate the term to FEMM or rewrite generically and rematch.

- row 186 `Menstrual Cycle` col M medlineplus_definition
  - Issue: MedlinePlus link matched to 'premenstrual breast changes', not to the menstrual cycle proper.
  - Current: `(Premenstrual breast changes) Premenstrual swelling and tenderness of both breasts often occurs during the second half of the menstrual cycle.`
  - Fix: Rematch to https://medlineplus.gov/ency/article/001501.htm or topic page for menstrual cycle.

- row 187 `Menstruation` col M medlineplus_definition
  - Issue: MedlinePlus matched to Menopause, not Menstruation.
  - Current: `(Menopause) Menopause is the time in a woman's life when her periods (menstruation) stop. ...`
  - Fix: Rematch to https://medlineplus.gov/menstruation.html topic page.

- row 187 `Menstruation` col AA rrm_textbook_match
  - Issue: Textbook match returns 'Food Processing' chapter unrelated to menstruation. Vector match dropped scope.
  - Current: `D1: recF9fkdYNPyHNo23 — Introductory Chapter: A Global Presentation on Trends in Food Processing — Alina Marc R`
  - Fix: Rematch against Hilgers NaPro Ch 6 (Menstrual Cycle) or Ch 35.

- row 191 `Microadenoma (Pituitary)` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus matched to 'Pituitary Hormone', a general endocrine concept, not to pituitary adenoma/microadenoma. Pituitary Adenoma NCI code is C3329.
  - Current: `Pituitary Hormone (NCI) — code C752 — Pituitary hormones are produced by the pituitary gland...`
  - Fix: Replace with NCI Thesaurus C3329 Pituitary Gland Adenoma or C3470 Pituitary Microadenoma.

- row 210 `Natural Family Planning Methods` col AB nci_thesaurus_definition
  - Issue: Completely unrelated NCI concept matched. Should be Natural Family Planning or Fertility Awareness Method.
  - Current: `Treatment Planning (NCI) — code C162700 — The process of developing an appropriate therapeutic strategy for a patient.`
  - Fix: Replace with NCI C73463 Natural Family Planning OR drop the NCI cell if no good match.

- row 217 `Nutrition and Fertility` col AE rrm_canonical_match
  - Issue: Pommerenke 1946 cervical mucus paper has nothing to do with nutrition and fertility. Wrong canonical match.
  - Current: `https://rrmacademy.org/library/cyclic-changes-in-the-physical-and-chemical-properties-of-cervical-mucus-reciag8ekqg8mtfp0 — Cyclic changes in the physical and chemical properties of cervical mucus (Po`
  - Fix: Rematch to Gaskins/Chavarro 2018 Am J Obstet Gynecol review OR Chavarro 2007 ovulatory disorder paper (both already verified in pplx sources).

- row 227 `Ovarian Drilling (LOD)` col AB nci_thesaurus_definition
  - Issue: Unrelated NCI concept matched.
  - Current: `Ovarian Hilus (NCI) — code C61449 — A depression in the ovary where the ovarian ligament attaches...`
  - Fix: Drop NCI cell — no good NCI match for LOD/ovarian drilling exists; rrm_canonical needed.

- row 246 `Pelvic Inflammatory Disease (PID)` col AB nci_thesaurus_definition
  - Issue: Wrong NCI concept matched — should be PID, not Paget. NCI PID code = C26877.
  - Current: `Pelvic Paget Disease (NCI) — code C213475 — Paget disease that affects the pelvic bones.`
  - Fix: Replace with NCI C26877 Pelvic Inflammatory Disease.

- row 252 `Polycystic Ovarian Morphology (PCOM)` col AA rrm_textbook_match
  - Issue: GBD 2023 demographics paper has nothing to do with PCOM. Mismatch from vector retrieval.
  - Current: `D1: recmNex7vnsu13wGR — Global age-sex-specific all-cause mortality and life expectancy estimates for 204 countries... GBD 2023 Demographics Collaborators`
  - Fix: Rematch to a Hilgers chapter on polycystic ovaries / PCOS or to Deshmukh Chapter 02 PCOS Metabolic Disease (already in row 189).

- row 254 `Pope Paul VI Institute` col AE rrm_canonical_match
  - Issue: Seminarians' curriculum paper is unrelated to Pope Paul VI Institute as institutional entity. Wrong canonical match.
  - Current: `https://rrmacademy.org/library/a-quantitative-self-assessment-of-seminarians-response-to-a-curriculum-addition--recpu91znllax0zyb — A Quantitative Self-Assessment of Seminarians' Response to a Curricu`
  - Fix: Rematch to Hilgers NaPro Ch 1 (Foundations) or Ch 86 (which has 176 occurrences of 'Pope Paul VI Institute'). No standalone library record for the Institute itself likely exists.

- row 258 `Preconception Care` col AB nci_thesaurus_definition
  - Issue: Unrelated NCI metadata-class concept matched.
  - Current: `Care Answer (NCI) — code C226644 — A response related to self-care or received care.`
  - Fix: Replace with NCI C81233 Preconception Care or drop NCI cell.

- row 259 `Pregnancy Outcomes` col AB nci_thesaurus_definition
  - Issue: NCI matched to 'Twin Pregnancy' (C112852) — pplx_def claimed C112852 covers Pregnancy Outcome but it does not. Real NCI Pregnancy Outcome code is C16442.
  - Current: `Twin Pregnancy (NCI) — code C112852 — A pregnancy involving two fetuses.`
  - Fix: Replace with NCI C16442 Pregnancy Outcome.

- row 260 `Pregnanediol` col AA rrm_textbook_match
  - Issue: Wennerholm review on preterm birth prevention is tangential to pregnanediol as a urinary biomarker. Not the right textbook chapter.
  - Current: `D1: recb3XgbRt7zNQwsD — Progesterone, cerclage, pessary, or acetylsalicylic acid for prevention of preterm birth in singleton and multifetal pregnancies — Wennerholm UB et al.`
  - Fix: Rematch to a Hilgers chapter on hormone assessment (Ch 21 or Ch 35) which would cover pregnanediol as a luteal biomarker.

- row 269 `Prospective Studies` col AE rrm_canonical_match
  - Issue: McQueen sperm-DNA-fragmentation meta-analysis is unrelated to 'Prospective Studies' as a study-design concept. Wrong canonical match.
  - Current: `https://rrmacademy.org/library/sperm-dna-fragmentation-and-recurrent-pregnancy-loss-a-systematic-review-and-met-recyq3m4kcw20pwot — Sperm DNA fragmentation and recurrent pregnancy loss: a systematic r`
  - Fix: Rematch — 'Prospective Studies' is a methodologic term, no specific canonical article needed. Consider dropping the cell or using a generic methods reference.

- row 248 `Personalized Treatment` col AE rrm_canonical_match
  - Issue: Laber EB 2015 is a statistical methodology paper about sizing two-arm RCTs to find optimal personalized treatment strategies — it is about clinical-trial DESIGN methods, NOT about the RRM concept of personalized clinical treatment. It uses 'personalized treatment' in a statistical/algorithmic sense, not a patient-care sense. Cited only because of keyword match in the title.
  - Current: `https://rrmacademy.org/library/using-pilot-data-to-size-a-two-arm-randomized-trial-to-find-a-nearly-optimal-per-recdxfaqum522g4jp
Using pilot data to size a two-arm randomized trial to find a nearly o`
  - Fix: Replace with a more appropriate RRM canonical source on personalized/individualized care — e.g., the verified Stanford JB, Parnell TA, Boyle PC. 'Outcomes from treatment of infertility with natural procreative technology in an Irish general practice.' JABFM 2008;21(5):375-84 (PMID 18772291), or the verified Boyle/Stanford 2021 BMC Pregnancy Childbirth New England observational study (DOI 10.1186/s12884-021-03946-8).

- row 278 `Restorative Reproductive Medicine (RRM)` col AB nci_thesaurus_definition
  - Issue: NCI Thesaurus code C62565 is 'Restorative Material' — dental material. Completely unrelated to Restorative Reproductive Medicine. Cited only because of the word 'Restorative'.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C62565
Restorative Material (NCI)
A dental material used to fill cavities and create a new tooth surface.`
  - Fix: Drop the AB cell entirely. NCI Thesaurus does not currently have a concept for Restorative Reproductive Medicine. Mark as 'no coverage' rather than citing an unrelated dental concept.

- row 129 `Holistic Approach` col AE rrm_canonical_match
  - Issue: Girotto 1997 is about Italian family-physician behavior around women's health and family planning (contraception/NFP). Tangentially related to holism only via 'whole-person family medicine' framing. Not a strong RRM-specific source for the 'holistic approach' concept.
  - Current: `https://rrmacademy.org/library/the-behavior-of-italian-family-physicians-regarding-the-health-problems-of-women-recoydappezrl6yoh
The behavior of Italian family physicians regarding the health problem`
  - Fix: Replace with a stronger source — e.g., a Stanford or Hilgers chapter on the multi-system RRM evaluation framework, or a citation from rrm-library that explicitly discusses the multi-system/whole-person framing.

- row 143 `Hysteroscopy (Operative)` col AA rrm_textbook_match
  - Issue: AA column points to a COVID-19 / bariatric surgery paper, not to any hysteroscopy-related Hilgers textbook chapter. The FTS keyword match on the bare word 'Operative' produced an obviously wrong record. The correct AA reference for operative hysteroscopy would be a Hilgers chapter on hysteroscopic intervention (likely a chapter covering hysteroscopic resection of polyps/fibroids/septum/adhesions, if one exists in the Pope Paul VI Institute textbook).
  - Current: `D1: recQ6a5vkkLBOWOhn -- Effect of COVID-19 changes on outcomes and socioeconomic disparities following metabolic and bariatric surgery. (chapter -- Ahmed SM, Johns A, Timbang L, Wang A, Singh NK, Lyo`
  - Fix: Re-run the AA FTS query with a tighter token (e.g. 'operative hysteroscopy' or 'hysteroscopic resection') against the Hilgers textbook corpus. If no chapter is a tight match, leave AA blank rather than carry a spurious bariatric-surgery record.

- row 17 `Antral Follicle Count (AFC)` col AB nci_thesaurus_definition
  - Issue: AB references NCI 'Cystic Follicle' code C202458 which is a THYROID concept, not an ovarian antral follicle concept. The same wrong NCI code is also attached to row 113 (Follicle Maturation Study).
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C202458 -- Cystic Follicle (NCI) -- Normal thyroid follicles that are many times larger than normal and usu`
  - Fix: Replace with an ovarian-specific NCI concept if one exists for 'antral follicle' (search NCI Thesaurus for C-codes referencing 'ovarian antral follicle' or 'preovulatory follicle'). If none exists, leave AB blank.

- row 113 `Follicle Maturation Study (Follicle Tracking / Follicular Ultrasound Series)` col AB nci_thesaurus_definition
  - Issue: Same wrong NCI 'Cystic Follicle' (thyroid) code C202458 used for AFC row 17. FMS is a procedural / ultrasound-monitoring concept, not a histopathologic thyroid term.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C202458 -- Cystic Follicle (NCI) -- Normal thyroid follicles...`
  - Fix: Drop the wrong NCI code. AB should likely be blank for FMS since NCI Thesaurus does not have a 'Follicle Maturation Study' concept. Alternative: link to NCI 'Transvaginal Ultrasound' or 'Ovarian Ultrasound' if a concept exists.

- row 13 `Anti-Müllerian Hormone (AMH)` col AB nci_thesaurus_definition
  - Issue: AB references the AMH GENE concept (C101735), not the AMH PROTEIN/HORMONE concept used in clinical fertility testing. The pplx_def is about the serum hormone marker, so the gene concept is technically off.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C101735 -- AMH Gene (NCI) -- This gene plays a role in gonad development.`
  - Fix: Replace with NCI concept for 'Anti-Mullerian Hormone' protein (search for C-code referencing the protein/hormone rather than the gene). If unavailable, MeSH 'Anti-Mullerian Hormone' D016235 in col O+P is the better authoritative anchor.

- row 82 `Endometrial Receptivity Analysis (ERA)` col AA rrm_textbook_match
  - Issue: AA matched on bare token 'ERA' which in Hilgers Ch. 26 refers to the ERA Trial (Estrogen Replacement and Atherosclerosis study) - completely unrelated to Endometrial Receptivity Analysis (the Igenomix genomic test). False keyword match.
  - Current: `D1: recxqtaii5qyJGdnA -- Chapter 26: Isomolecular Hormones vs Heteromolecular Artimones (chapter -- Hilgers TW -- 3 occurrences of "ERA")`
  - Fix: Set AA to blank for this row. Hilgers textbook does not have an ERA (Endometrial Receptivity Analysis) chapter - the test is post-2011 and outside the restorative paradigm. The correct anchor is the Diaz-Gimeno 2011 Fertil Steril paper (PMID 20619403) which should go in col AF other_source_1.

- row 229 `Ovarian Reserve` col AB nci_thesaurus_definition
  - Issue: AB references 'Reserve Cell' (C33916) which is a respiratory/epithelial-tissue concept, not the ovarian-reserve concept. Wrong NCI code.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C33916 -- Reserve Cell (NCI) -- A term that refers to immature cells located between the surface columnar e`
  - Fix: Search NCI Thesaurus for 'Ovarian Reserve' or 'Ovarian Function' as a concept; if no good match exists, set AB to blank. MeSH 'Ovarian Reserve' D000071118 (col P, already populated) is the better anchor.

- row 284 `Saline Infusion Sonohysterogram (SIS) / "Bubble Test"` col AB nci_thesaurus_definition
  - Issue: AB matched on the bare abbreviation 'SIS' which in NCI is the oncogene SIS / PDGF-Beta concept, NOT Saline Infusion Sonohysterogram. False acronym match.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C17135 -- Oncogene SIS (NCI) -- Human Oncogene SIS is a mutated variant of PDGFB Gene (PDGF/VEGF Family)...`
  - Fix: Search NCI Thesaurus for 'Sonohysterography' as a concept; if no good match, set AB blank.

- row 17 `Antral Follicle Count (AFC)` col Z boyle_transcript_match
  - Issue: Transcript topic is RPL/microbiome, only mentions AFC tangentially. There are likely better Boyle case reviews that focus on AFC/ovarian reserve as the primary topic.
  - Current: `D1: wistia-q1mmlfyf8g -- Recurrent Pregnancy Loss Resolved by Endometrial Microbiome Correction (NGS-Guided) (case-review -- Phil Boyle -- 12 occurrence(s) of "Antral Follicle")`
  - Fix: Re-run the Z FTS query with a topic-weighted scorer, or use wistia-my1ca05rue ('Low AMH and Diminished Ovarian Reserve' - already in col Z for row 229 Ovarian Reserve) which discusses AFC in context of ovarian-reserve assessment.

- row 291 `Sonographic Classification of Ovulation Disorders (Hilgers Classification)` col AB nci_thesaurus_definition
  - Issue: AB matched on bare token 'Classification' returning the Paris GI endoscopy classification - completely unrelated to the Hilgers ovulation classification. False keyword match.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C189832 -- Paris Classification (NCI) -- A classification system for the endoscopic assessment of early and`
  - Fix: Set AB to blank for this row. NCI Thesaurus does not have a concept for the Hilgers ovulation-disorder classification system. AA Hilgers Ch. 21 is the correct authoritative anchor.

- row 303 `Targeted Post-Peak Progesterone Series (Peak +3, +5, +7, +9, +11)` col AB nci_thesaurus_definition
  - Issue: AB matched on bare token 'Peak' returning the dictionary-style NCI generic definition of peak. Completely irrelevant to the Hilgers Peak Day / post-Peak progesterone schedule.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C48054 -- Peak (NCI) -- The most extreme possible amount or value; the highest point.`
  - Fix: Set AB to blank for this row. The NaPro Peak Day concept is not in NCI Thesaurus.

- row 282 `S-MAP (Systematic Mapping of the Abdomen and Pelvis)` col AB nci_thesaurus_definition
  - Issue: AB matched on bare token 'Map' returning the generic NCI dictionary entry for 'Map'. Irrelevant.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C43433 -- Map (NCI) -- A usually 2-dimensional diagrammatic representation of an object or area.`
  - Fix: Set AB to blank. S-MAP is a NaPro-specific surgical inspection protocol not represented in NCI Thesaurus.

- row 282 `S-MAP (Systematic Mapping of the Abdomen and Pelvis)` col AA rrm_textbook_match
  - Issue: S-MAP should have a clear Hilgers textbook anchor (per pplx_sources, Ch. 64 'Surgical Mapping of the Abdomen and Pelvis'). AA is blank.
  - Current: `(blank)`
  - Fix: Run the FTS query against Hilgers Ch. 64 explicitly (or 'Surgical Mapping') and populate AA. The chapter exists in the textbook corpus per cross-reference from rows 214 (Near Contact Laparoscopy) and the pplx sources for this row.

- row 312 `Transcervical Catheterization of the Fallopian Tubes (TCFT)` col AB nci_thesaurus_definition
  - Issue: AB references the anatomic 'fimbriated end' concept (C32607), not the TCFT procedure. The procedure is at the cornual/proximal end, opposite the fimbria.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C32607 -- Fimbriated End of the Fallopian Tube (NCI) -- The fringed end of the fallopian tube.`
  - Fix: Search NCI for 'tubal cannulation' or 'transcervical' procedure concepts; if none, set AB blank.

- row 320 `Ultrasonography` col AA rrm_textbook_match
  - Issue: AA column is mis-linked to a respiratory syncytial virus paper, completely unrelated to ultrasonography. Should be a Hilgers textbook chapter on follicle maturation study / TVUS / pelvic ultrasound (e.g. Ch. 20-22).
  - Current: `D1: recBdlzYR6MXya1F2 — Respiratory Syncytial Virus Co-Detection With Other Respiratory Viruses Is Not Significantly Associated With Worse Clinical Outcomes Among Children Aged <2 Years: New Vaccine S`
  - Fix: Replace with a Hilgers Medical and Surgical Practice of NaProTECHNOLOGY chapter on Follicle Maturation Study (Chapter 20) or pelvic ultrasound usage in RRM.

- row 265 `preterm birth` col AA rrm_textbook_match
  - Issue: Same RSV paper as row 320 — incorrectly linked as the RRM textbook match for preterm birth. Should be a Hilgers chapter on the Prematurity Prevention Program / progesterone support during pregnancy.
  - Current: `D1: recBdlzYR6MXya1F2 — Respiratory Syncytial Virus Co-Detection With Other Respiratory Viruses Is Not Significantly Associated With Worse Clinical Outcomes Among Children Aged <2 Years (chapter -- Am`
  - Fix: Replace with the Hilgers chapter covering the Prematurity Prevention Program (Pope Paul VI Institute, prematurity support protocols).

- row 302 `Targeted Ovarian Stimulation (TOS)` col AC wikipedia_summary
  - Issue: AC col is mapped to Thoracic Outlet Syndrome because of TOS acronym collision. Wrong concept entirely.
  - Current: `https://en.wikipedia.org/wiki/Thoracic_outlet_syndrome — Thoracic outlet syndrome (Compression of nerves or blood vessels between the neck and ribcage)`
  - Fix: Replace with a Wikipedia entry on ovarian stimulation / controlled ovarian hyperstimulation, or leave blank if no clean Wikipedia equivalent exists for NaPro 'Targeted Ovarian Stimulation' specifically.

- row 299 `Symptothermal Method` col AB nci_thesaurus_definition
  - Issue: AB col is mapped to ECG 'Tangent Method' (T-wave analysis) instead of fertility awareness symptothermal method. Auto-match by partial term match likely.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C184711 — Tangent Method (NCI)`
  - Fix: Either remove the col AB value (NCI Thesaurus has no symptothermal method entry) or map to NCI 'Natural Family Planning Methods' if available.

- row 311 `Timed Intercourse` col AB nci_thesaurus_definition
  - Issue: AB is mapped to the NCI concept for 'Did Not Attempt Intercourse', the opposite of timed intercourse.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C129471 — Did Not Attempt Intercourse (NCI)`
  - Fix: Remove or replace with the closest applicable NCI concept (e.g. fertility timing methods); or leave AB blank.

- row 305 `Thomas W. Hilgers, MD` col AB nci_thesaurus_definition
  - Issue: AB matched on first name 'Thomas' to a Georgia county entry. Person entries should not pull from NCI Thesaurus.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C108210 — Thomas County, GA`
  - Fix: Drop AB col for this row (NCI does not provide person entries).

- row 306 `Thrombophilia Testing (Fertility Context)` col AB nci_thesaurus_definition
  - Issue: AB matched on the word 'Test Context' (a curation utility concept), not thrombophilia.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C49048 — Test Context (NCI)`
  - Fix: Replace with NCI Thrombophilia concept (or appropriate hematology entry), or leave blank.

- row 294 `Sperm Morphology (Teratospermia / Teratozoospermia)` col AB nci_thesaurus_definition
  - Issue: AB matched to 'Sperm Banking' not sperm morphology / teratospermia.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C15326 — Sperm Banking (NCI)`
  - Fix: Replace with the NCI sperm morphology or abnormal sperm entry, or leave blank.

- row 295 `Sperm Motility (Asthenospermia / Asthenozoospermia)` col AB nci_thesaurus_definition
  - Issue: AB matched to generic 'Cell Motility', not sperm motility. NCI Thesaurus does have C18066 'Sperm Motility' specifically.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C16404 — Cell Motility (NCI)`
  - Fix: Replace with NCI Sperm Motility (C18066) if available.

- row 322 `Urogenital System` col AB nci_thesaurus_definition
  - Issue: AB matched to 'Urogenital Sinus' (embryonic structure) instead of the urogenital system as a whole. NCI C12389 'Urogenital System' exists.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C34322 — Urogenital Sinus (NCI)`
  - Fix: Replace with NCI Urogenital System (C12389).

- row 323 `Uterine Anomalies / Müllerian Anomalies` col AB nci_thesaurus_definition
  - Issue: AB is mapped to general 'Multiple Congenital Anomalies' instead of uterine/Mullerian anomaly specifically. NCI has C26896 'Mullerian Duct Abnormality' and related entries.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C168497 — Multiple Congenital Anomalies (NCI)`
  - Fix: Replace with NCI Mullerian Duct Abnormality (C26896) or Uterine Anomaly concept.

- row 289 `Sex Hormone-Binding Globulin (SHBG)` col AB nci_thesaurus_definition
  - Issue: AB is mapped to 'Sex Steroid Hormone' (the molecules SHBG carries), not SHBG itself. NCI has C29927 'Sex Hormone-Binding Globulin'.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C123796 — Sex Steroid Hormone (NCI)`
  - Fix: Replace with NCI Sex Hormone-Binding Globulin (C29927).

- row 333 `Vitamin D (Fertility Context)` col K Perplexity sources
  - Issue: The library URL slug ends with '-1l5euswn/' which deviates from the typical D1 library URL pattern (10-char rec...id suffix). May be a malformed/non-existent URL. NOT verified live but worth checking before publishing.
  - Current: `RRM Academy Library. Vitamin D and Male Fertility (2020). https://rrmacademy.org/library/vitamin-d-and-male-fertility-an-updated-review-1l5euswn/`
  - Fix: Curl-verify the URL returns 200 OR replace with a real D1 library entry slug from rrm-cli.

- row 159 `IUI (Intrauterine Insemination)` col AC wikipedia_summary
  - Issue: Wikipedia link points to 'IUI (software)' open-source web application framework, NOT the medical procedure Intrauterine Insemination.
  - Current: `https://en.wikipedia.org/wiki/IUI_(software)
IUI (software) (Open-source web application framework)
iUI is a lightweight open source Web application framework...`
  - Fix: Replace with https://en.wikipedia.org/wiki/Intrauterine_insemination (or whichever current canonical IUI medical Wikipedia article is live).

- row 6 `Adhesion Prevention` col AB nci_thesaurus_definition
  - Issue: NCI concept C32272 'Focal Adhesion' is a cellular junction (cell biology), not surgical adhesion prevention. Wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C32272
Focal Adhesion (NCI)
A cellular junction where cellular transmembrane integrin receptors bind to ext`
  - Fix: Replace with NCI Thesaurus entry for post-surgical adhesions or peritoneal adhesions, e.g. NCI C26756 (Adhesion) or C77556 (Surgical Adhesion), if available. Otherwise leave NCI blank for this term.

- row 151 `Intracytoplasmic Sperm Injection (ICSI)` col AB nci_thesaurus_definition
  - Issue: NCI concept C15326 is 'Sperm Banking', not ICSI. Wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C15326
Sperm Banking (NCI)
Freezing sperm for use in the future.`
  - Fix: Replace with NCI Thesaurus entry for Intracytoplasmic Sperm Injection (search NCIt browser for 'Intracytoplasmic'). If no good NCI concept exists, leave blank.

- row 155 `Intrauterine Device (IUD)` col AB nci_thesaurus_definition
  - Issue: NCI concept C39663 is 'Intrauterine Mass' (a uterine mass/tumor), NOT an intrauterine contraceptive device. Wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C39663
Intrauterine Mass (NCI)
A mass within the uterus.`
  - Fix: Replace with NCI Thesaurus entry for Intrauterine Contraceptive Device, e.g. NCI C50071 'Intrauterine Contraceptive Device' if available, otherwise leave blank.

- row 228 `Ovarian Hyperstimulation Syndrome (OHSS)` col AB nci_thesaurus_definition
  - Issue: NCI concept C61449 is 'Ovarian Hilus' (anatomical structure), NOT Ovarian Hyperstimulation Syndrome. Wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C61449
Ovarian Hilus (NCI)
A depression in the ovary where the ovarian ligament attaches.`
  - Fix: Replace with NCI Thesaurus entry for Ovarian Hyperstimulation Syndrome (search NCIt for 'Hyperstimulation'). If no good match, leave blank.

- row 235 `Patient-Centered Care` col AC wikipedia_summary
  - Issue: Wikipedia link points to 'Patient participation' (related but distinct concept). Patient-centered care has its own Wikipedia entry.
  - Current: `https://en.wikipedia.org/wiki/Patient_participation
Patient participation (Approach to involving patients in making health decisions)`
  - Fix: Replace with https://en.wikipedia.org/wiki/Patient-centered_care or https://en.wikipedia.org/wiki/Person-centered_care if either exists, otherwise keep current with note.

- row 99 `FEMM (Fertility Education and Medical Management)` col AC wikipedia_summary
  - Issue: Wikipedia summary resolves to a Japanese electronic dance music duo named FEMM, completely unrelated to the Fertility Education and Medical Management women's-health model.
  - Current: `https://en.wikipedia.org/wiki/FEMM_(duo)
FEMM (duo) (Japanese electronic dance music duo)`
  - Fix: Replace with a topical page if one exists, or null out the field. Direct topical article does not exist on Wikipedia; femmhealth.org/about is the canonical source (already in col K).

- row 240 `Peak Day` col AC wikipedia_summary
  - Issue: Wikipedia summary resolves to the Peak District geographic region in England, unrelated to the Peak Day CrMS marker.
  - Current: `https://en.wikipedia.org/wiki/Peak_District
Peak District (Upland area in England)`
  - Fix: Replace with https://en.wikipedia.org/wiki/Creighton_Model_FertilityCare_System (which discusses Peak Day) or null out.

- row 298 `Sympto-Thermal Method (STM)` col AC wikipedia_summary
  - Issue: Wikipedia summary resolves to a Turkish defense company STM, unrelated to the symptothermal fertility-awareness method.
  - Current: `https://en.wikipedia.org/wiki/STM_(Turkish_company)
STM (Turkish company) (Defense company of Turkey)`
  - Fix: Replace with https://en.wikipedia.org/wiki/Symptothermal_method (or the Fertility Awareness article — en.wikipedia.org/wiki/Fertility_awareness#Sympto-thermal_method).

- row 71 `Dry Day` col AC wikipedia_summary
  - Issue: Wikipedia summary resolves to a 2023 Indian comedy-drama film, unrelated to the CrMS Dry Day concept.
  - Current: `https://en.wikipedia.org/wiki/Dry_Day
Dry Day (2023 Indian film)`
  - Fix: Null out or point to https://en.wikipedia.org/wiki/Creighton_Model_FertilityCare_System (which covers Dry Day terminology in the charting subsection).

- row 99 `FEMM (Fertility Education and Medical Management)` col AB nci_thesaurus_definition
  - Issue: NCI concept is 'Fertility Clinic' generic, not specific to FEMM model.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C203833
Fertility Clinic (NCI)
A medical facility that counsels and treats individuals and couples with inf`
  - Fix: Null out — no NCI concept exists for FEMM specifically.

- row 209 `Natural Family Planning (NFP)` col AB nci_thesaurus_definition
  - Issue: NCI concept is 'Treatment Planning', completely unrelated to Natural Family Planning.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C162700
Treatment Planning (NCI)
The process of developing an appropriate therapeutic strategy for a patien`
  - Fix: Null out (no NCI concept for NFP) or replace with NCI code for 'Family Planning' if such exists.

- row 298 `Sympto-Thermal Method (STM)` col AB nci_thesaurus_definition
  - Issue: NCI concept is 'Thermal Burn', unrelated to Sympto-Thermal Method.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C50768
Thermal Burn (NCI)
A burn injury caused by heat or fire.`
  - Fix: Null out — no NCI concept for STM.

- row 180 `Marquette Method` col AB nci_thesaurus_definition
  - Issue: NCI concept is 'Tangent Method' (T-wave ECG analysis), unrelated to the Marquette FABM.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C184711
Tangent Method (NCI)
A method to determine the end of the T wave.`
  - Fix: Null out — no NCI concept for Marquette Method.

- row 88 `Essential Sameness Pattern and Yellow Stamps` col AB nci_thesaurus_definition
  - Issue: NCI concept is the color 'Dark Yellow', not the CrMS construct.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C206340
Dark Yellow (NCI)
A dark tone of yellow.`
  - Fix: Null out — no NCI concept maps to ESP/Yellow Stamps.

- row 263 `Premenstrual Bleeding (PMB)` col AB nci_thesaurus_definition
  - Issue: NCI concept is 'Bleeding Question' (assessment question), not the PMB clinical biomarker.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C179032
Bleeding Question (NCI)
A question about an individual's bleeding.`
  - Fix: Null out — no NCI concept for PMB.

- row 334 `Vulvar Observation` col AB nci_thesaurus_definition
  - Issue: NCI concept is 'Vulvar Disorder' (pathology), not the CrMS observational technique.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C27631
Vulvar Disorder (NCI)
A non-neoplastic or neoplastic disorder that affects the vulva.`
  - Fix: Null out — no NCI concept for the vulvar-observation technique.

- row 240 `Peak Day` col AD snomed_ct_definition
  - Issue: SNOMED concept is about peak expiratory flow rate (asthma), not the CrMS Peak Day marker.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=414883002&edition=MAIN&languages=en
Number of consecutive days at less than 80 percent peak expiratory flow rate (finding)`
  - Fix: Null out — no SNOMED concept maps to CrMS Peak Day.

- row 199 `Mucus Pattern` col AD snomed_ct_definition
  - Issue: SNOMED concept is the ferning cervical-test procedure, related to but not the same as CrMS mucus pattern observation. Tangentially relevant; might be acceptable as a 'related concept' but not a direct definition match.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=275304009&edition=MAIN&languages=en
Ferning - cervical test (procedure)`
  - Fix: Move to a 'related concepts' field or null out and replace with a more direct concept if any exists.

- row 241 `Peak Symptom` col AD snomed_ct_definition
  - Issue: SNOMED concept is Stiff-Person Syndrome, completely unrelated.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=5217008&edition=MAIN&languages=en
Stiff-person syndrome (Stiff person spectrum disorder (disorder))`
  - Fix: Null out — no SNOMED concept for CrMS Peak Symptom.

- row 71 `Dry Day` col AD snomed_ct_definition
  - Issue: SNOMED concept is Yao syndrome, unrelated to CrMS Dry Day.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=768667002&edition=MAIN&languages=en
Yao syndrome (Nucleotide binding oligomerization domain containing 2-associated autoinflammatory diseas`
  - Fix: Null out — no SNOMED concept for Dry Day.

- row 24 `Base Infertile Pattern (BIP)` col AD snomed_ct_definition
  - Issue: SNOMED concept is Bipolar Disorder, completely unrelated. BIP abbreviation collision.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=13746004&edition=MAIN&languages=en
Bipolar disorder (Bipolar disorder (disorder))`
  - Fix: Null out — no SNOMED concept for CrMS Base Infertile Pattern.

- row 251 `Point of Change (POC)` col AD snomed_ct_definition
  - Issue: SNOMED concept is Neutrophil immunodeficiency syndrome, unrelated. POC abbreviation collision.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=723443003&edition=MAIN&languages=en
Neutrophil immunodeficiency syndrome (Neutrophil immunodeficiency syndrome (disorder))`
  - Fix: Null out — no SNOMED concept for CrMS Point of Change.

- row 88 `Essential Sameness Pattern and Yellow Stamps` col AD snomed_ct_definition
  - Issue: SNOMED concept is the country Spain, completely unrelated. ESP abbreviation collision.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=223680008&edition=MAIN&languages=en
Spain (Spain (geographic location))`
  - Fix: Null out — no SNOMED concept for ESP/Yellow Stamps.

- row 108 `Fertility-Focused Intercourse (FFI)` col AD snomed_ct_definition
  - Issue: SNOMED concept is Fatal Familial Insomnia, unrelated. FFI abbreviation collision.
  - Current: `https://browser.ihtsdotools.org/?perspective=full&conceptId1=83157008&edition=MAIN&languages=en
Fatal familial insomnia (Fatal familial insomnia (disorder))`
  - Fix: Null out — no SNOMED concept for Fertility-Focused Intercourse.

- row 199 `Mucus Pattern` col AA rrm_textbook_match
  - Issue: Matched chapter is 'Evolution of EEG Findings in Patients with Acute Brain Injury' — clearly the wrong textbook (neurology, not NaProTECHNOLOGY). The FTS likely matched a stray phrase but the chapter is not RRM canon.
  - Current: `D1: recc1K0AqEpeterbD
Evolution of EEG Findings in Patients with Acute Brain Injury. (chapter -- Narrett JA, Byrnes M, Gilmore EJ, Hirsch LJ, Punia V, Sivaraju A -- 8 occurrence(s) of 'Mucus Pattern')`
  - Fix: Replace with Hilgers Ch.7 (Basic Charting and Chart Reading) or Ch.14 (Objective Classification of the Mucus Cycle) or Ch.86 (Summary of NaProTECHNOLOGY Biomarkers).

- row 251 `Point of Change (POC)` col AA rrm_textbook_match
  - Issue: Same wrong neurology chapter as row 199.
  - Current: `D1: recc1K0AqEpeterbD
Evolution of EEG Findings in Patients with Acute Brain Injury.`
  - Fix: Replace with Hilgers NaProTECHNOLOGY textbook Ch.7 or Ch.10 (Special Instructions and Applications).

- row 88 `Essential Sameness Pattern and Yellow Stamps` col AA rrm_textbook_match
  - Issue: Same wrong neurology chapter.
  - Current: `D1: recc1K0AqEpeterbD
Evolution of EEG Findings in Patients with Acute Brain Injury.`
  - Fix: Replace with Hilgers Ch.86 (Summary of NaProTECHNOLOGY Biomarkers) or Ch.10 (Special Instructions and Applications) which cover ESP and Yellow Stamps.

- row 71 `Dry Day` col AA rrm_textbook_match
  - Issue: Matched chapter is 'Global Presentation on Trends in Food Processing' — food-industry textbook, not RRM. The 18 matches are likely for 'dry day' in production-line context.
  - Current: `D1: recF9fkdYNPyHNo23
Introductory Chapter: A Global Presentation on Trends in Food Processing (chapter -- Alina Marc R -- 18 occurrence(s) of 'Dry Day')`
  - Fix: Replace with Hilgers Ch.7 (Basic Charting and Chart Reading) or Ch.86 (Summary of NaProTECHNOLOGY Biomarkers).

- row 257 `Pre-Peak Phase` col AE rrm_canonical_match
  - Issue: Canonical match points to a paper about Artemether Lumefantrine (anti-malarial) effects on the reproductive cycle, not directly about the pre-Peak phase concept.
  - Current: `https://rrmacademy.org/library/effect-of-artemether-lumefantrine-on-womens-reproductive-cycle-results-recv6u1jm4ju2qpng
Effect of Artemether Lumefantrine on Women's Reproductive Cycle: Results (articl`
  - Fix: Replace with a Hilgers, Stanford, or Brown paper that defines or characterizes the pre-Peak phase length (e.g., Brown 2011 Hum Reprod Update on types of ovarian activity, or Stanford 2002 OBGYN timing intercourse current evidence).

- row 255 `Post-Peak Phase` col AE rrm_canonical_match
  - Issue: Same Artemether Lumefantrine paper, irrelevant to post-Peak / luteal-phase concept.
  - Current: `https://rrmacademy.org/library/effect-of-artemether-lumefantrine-on-womens-reproductive-cycle-results-recv6u1jm4ju2qpng
Effect of Artemether Lumefantrine on Women's Reproductive Cycle: Results`
  - Fix: Replace with a luteal phase / corpus luteum function paper canonical to RRM (e.g., Hilgers Ch.86 in textbook, or a Stanford/Hilgers luteal phase deficiency paper).

- row 197 `Mucus Cycle` col M medlineplus_definition
  - Issue: MedlinePlus FTS match resolves to Birth Control Pills article, unrelated to Mucus Cycle. Flagged for review by curator already.
  - Current: `[REVIEW -- best guess from FTS, MedlinePlus title: 'Birth control pills'] Birth control pills (BCPs) contain man-made forms of 2 hormones called estrogen and progestin.`
  - Fix: Null out — MedlinePlus has no article specifically on 'Mucus Cycle'.

- row 71 `Dry Day` col M medlineplus_definition
  - Issue: MedlinePlus FTS match resolves to Urinary Incontinence Products article, unrelated. Already flagged for review by curator.
  - Current: `[REVIEW -- best guess from FTS, MedlinePlus title: 'Urinary incontinence products'] There are many products to help you manage urinary incontinence.`
  - Fix: Null out — MedlinePlus has no article on the CrMS Dry Day concept.

- row 12 `Anti-Adhesion Barriers` col AB nci_thesaurus_definition
  - Issue: AB column links to NCI 'Focal Adhesion' (a cellular junction / cell biology concept) — completely unrelated to anti-adhesion barriers (a surgical material category). Wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C32272 Focal Adhesion (NCI) A cellular junction where cellular transmembrane integrin receptors bind to ext`
  - Fix: Either link to NCI Thesaurus 'Tissue Adhesion' (C29773) if scope-matched, or leave AB blank (no good NCI match exists for the surgical-barrier concept).

- row 158 `Isthmocele Repair (Laparoscopic)` col AB nci_thesaurus_definition
  - Issue: AB links to 'Laparoscopic Biopsy' — wrong concept (a diagnostic biopsy vs. a reconstructive repair).
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C165180 Laparoscopic Biopsy (NCI) A biospy procedure performed with the aid of a laparoscope.`
  - Fix: Either link to a more specific NCI concept for caesarean-scar defect repair, or leave AB blank.

- row 193 `Mini-laparotomy` col AB nci_thesaurus_definition
  - Issue: AB links to 'mini-CHOP Regimen' (a lymphoma chemotherapy protocol) — completely unrelated to mini-laparotomy (a surgical-incision technique). Looks like a 'mini' substring match.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C204798 mini-CHOP Regimen (NCI) A regimen consisting of low-dose cyclophosphamide, doxorubicin, prednisone `
  - Fix: Replace with NCI Thesaurus 'Laparotomy' (C51638) or leave AB blank.

- row 242 `PEARS (Pelvic Excision And Repair Surgery)` col AB nci_thesaurus_definition
  - Issue: AB links to NCI 'Excision Repair' — a DNA-repair molecular mechanism, NOT the surgical procedure. String-match on 'Excision Repair' produced a wrong concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C16566 Excision Repair (NCI) Excision Repair mechanisms remove and replace damaged nucleotides from DNA mol`
  - Fix: Leave AB blank (NCI Thesaurus has no PEARS concept) or link to a related concept like 'Pelvic Surgery'.

- row 242 `PEARS (Pelvic Excision And Repair Surgery)` col AC wikipedia_summary
  - Issue: AC links to Wikipedia 'Pears (surname)' — a list of people with the surname Pears (footballer etc.), completely unrelated to the surgical acronym PEARS.
  - Current: `https://en.wikipedia.org/wiki/Pears_(surname) Pears (surname) (Surname list) Pears is a surname. Notable people with the surname include: Aynsley Pears, English footballer Andrew Pears, originator of `
  - Fix: Leave AC blank (Wikipedia has no article on Hilgers's PEARS) or link to en.wikipedia.org/wiki/NaProTechnology if relevant.

- row 94 `Excision Surgery (for Endometriosis)` col AB nci_thesaurus_definition
  - Issue: AB links to 'Vaginal Endometriosis' — a narrow anatomical subtype, not the excision-procedure concept. Doesn't define excision surgery.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C128064 Vaginal Endometriosis (NCI) Endometriosis that affects the vagina. It is characterized by the prese`
  - Fix: Replace with a procedure-level NCI concept (e.g. C15351 'Excision' or similar) or leave blank.

- row 97 `Fallopian Tube Recanalization (Cannulation)` col AB nci_thesaurus_definition
  - Issue: AB links to 'Right Fallopian Tube' — an anatomical-structure concept, NOT the recanalization procedure. Off-target.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C33475 Right Fallopian Tube (NCI) The fallopian tube that extends from the uterus to the ovary in the right`
  - Fix: Replace with a procedure NCI concept for tubal cannulation/recanalization or leave blank.

- row 318 `Tubo-tubal Anastomosis (Tubal Ligation Reversal)` col AB nci_thesaurus_definition
  - Issue: AB defines 'Tubal Ligation' (the original sterilization procedure), NOT the reversal/anastomosis procedure that the term targets. Inverse concept.
  - Current: `https://ncithesaurus.nci.nih.gov/ncitbrowser/ConceptReport.jsp?dictionary=NCI_Thesaurus&code=C92901 Tubal Ligation (NCI) A method of female sterilization where the fallopian tubes are surgically ligat`
  - Fix: Replace with NCI concept for tubal reanastomosis/reversal if one exists, or leave blank.


## Verified rows (clean — no findings)

95 rows passed all checks. (Not enumerated here; see Sheet col AL = `verified`.)
