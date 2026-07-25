# RRM Academy Glossary Review — 2026-07-24

Systematic review of all published glossary terms in D1 `rrm-auth`. Read-only pass: no D1, `body_html`, or live-site mutations. Fixes route through `/glossary-update` after sign-off.

## Summary

- Terms reviewed: **230** across 11 Part chunks
- Terms with at least one open finding: **204**
- **P0 18** · P1 56 · P2 155 · P3 157
- Findings dropped by adversarial verification: **5**
- References: 347. **Broken for humans: 0.** Behind publisher AI-crawler blocks: 5

Method: one reviewer agent per Part chunk (rrm-cli against the local RRM SSOT, then Perplexity Sonar Pro for claims the SSOT could not settle), followed by adversarial verifiers prompted to refute by default. Citation liveness, robots.txt accessibility, citation-index integrity, em dashes, canonical names, protocol/dosing leaks and cross-term numeric consistency were checked deterministically by the orchestrator rather than by agents.

## P0 — factually wrong (18)

### `reproductive-health-optimization` — overclaim  ·  Part I

**Field:** `body_html (menstrual cycle health-value sentence, cited to ref 89)`  ·  **ref#89**

**Current:** The menstrual cycle itself carries independent health value: regular ovulation protects bone density, cardiometabolic function, and mood across a woman's lifespan.<sup><a href="#ref-89">89</a></sup>

**Evidence:** Perplexity (verbatim): "**Bone:** There is **some primary evidence** linking ovulatory disturbances to **greater spinal bone loss** in premenopausal women, but findings are mixed and do **not** prove a universal lifelong protective effect of regular ovulation. **Cardiometabolic health:** The provided sources do **not** supply primary evidence sufficient to claim that regular ovulation protects cardiometabolic health across the lifespan. **Mood:** The provided sources do **not** supply primary evidence sufficient to claim that regular ovulation protects mood across the lifespan."

**Suggested fix:** Three causal 'protects' claims across three organ systems, over a lifespan, on one narrative review. Bone carries real primary evidence (ovulatory-disturbance/spinal bone loss literature); cardiometabolic and mood do not carry it at this strength. Do NOT weaken RRM's position with a self-caveat -- strengthen the sourcing instead: keep the cycle-as-health-signal claim, cite the ovulatory-disturbance bone literature directly for bone, and carry cardiometabolic/mood as association rather than protection. Verify what Vigil 2012 (Linacre Q) actually concludes before leaving ref 89 attached; Perplexity could not retrieve its text and declined to quote it.

**Adversarial verdict:** UPGRADE — Upgraded, because I obtained the evidence the prior reviewer explicitly could not and it converts a conditional suspicion into a confirmed zero-support citation. QUOTE CHECK: current_value is verbatim in terms-part-I.json apart from the dropped class="cite-ref" attribute. RE-DERIVED: the reviewer wrote "Verify what Vigil 2012 actually concludes before leaving ref 89 attached; Perplexity could not 

**Corrected fix:** Keep RRM's position, fix the sourcing. Do not self-caveat and do not delete the cycle-as-health-signal claim. Split the sentence by evidence grade, using sources I verified myself at NCBI rather than any Perplexity assertion. BONE, keep protective language, cite: Li D, Hitchcock CL, Barr SI, Yu T, Prior JC. Negative spinal bone mineral density changes and subclinical ovulatory disturbances, prospe

---

### `fertile-window` — factual_error  ·  Part II

**Field:** `body_html`  ·  **ref#300**

**Current:** The CrMS definition accounts for variability in ovulation timing relative to Peak Day, with the fertile window extending from Peak Day minus 4 to Peak Day plus 2 and pregnancy probabilities quantified across that range.[ref-300]

**Evidence:** The CrMS definition accounts for variability in ovulation timing relative to Peak Day, with the fertile window extending from Peak Day minus 4 to Peak Day plus 2 and pregnancy probabilities quantified across that range.

**Canon:** rrm-cli full abstract of ref 300 (Stanford JB, Smith KR, Dunson DB, Obstet Gynecol 2003): 'The probability of pregnancy was greater than .05 for normally fertile couples from 3 days before to 2 days after the peak, and for subfertile couples from 1 day before to 1 day after the peak.' The same paper

**Suggested fix:** Two errors in one sentence. (1) The cited paper says 3 days before Peak, not 4; day -4 to +2 is seven days, which contradicts the same paper's own '6 days' statement. (Provenance note for the editor: Hilgers Ch 48 in the RRM library does print 'from day -4 to day +2' for this study, so the glossary likely inherited a textbook typo rather than inventing the number; the peer-reviewed abstract and the 6-day arithmetic both say -3.) (2) This is a day-specific fecundability estimate, not 'the CrMS definition' of the fertile window: CrMS's own clinically charted fertile window is about 9 to 10 days. Rewrite to separate the two, e.g. 'Day-specific pregnancy probabilities exceed 5% from three days b

**Adversarial verdict:** CONFIRMED — Quote check passes: the sentence 'The CrMS definition accounts for variability in ovulation timing relative to Peak Day, with the fertile window extending from Peak Day minus 4 to Peak Day plus 2 and pregnancy probabilities quantified across that range.[ref-300]' appears verbatim in terms-part-II.json. I re-derived the truth rather than trusting the prior reviewer. Ref 300 resolves to PMID 1279853

**Corrected fix:** Split the two claims and qualify the population, since the reviewer's proposed wording drops the 'normally fertile couples' qualifier and leaves the 9 to 10 day figure hanging off ref 300, which does not contain it. Suggested replacement: 'Day-specific pregnancy probabilities exceed 5 percent from three days before Peak Day through two days after for normally fertile couples, and from one day befo

---

### `rrm-outcomes-published-evidence` — misattribution  ·  Part III

**Field:** `body_html`

**Current:** Stanford et al. (2022, Human Reproduction Open) reported a 29% cumulative live birth rate at 24 months in a primary infertility population.

**Evidence:** Stanford 2021 cumulative live birth rate at 2 years || Stanford JB et al., BMC Pregnancy and Childbirth, 2021 (PMID 34238262) || The cumulative live birth rate at 2 years was 29% overall; this was significantly higher for women under age 35 (34%), and for women with body mass index < 25 (40%).

**Canon:** Cite the strongest defensible cohort; do not soften RRM outcome claims (rrm-success-rate-cite-best-cohort)

**Suggested fix:** Wrong year and wrong journal. The 29%-at-two-years figure is Stanford et al. 2021, BMC Pregnancy and Childbirth (PMID 34238262). Stanford et al. 2022 in Human Reproduction Open is the iNEST enrollment-and-methods paper, which reported 57% pregnancy and 44.2% live birth across 843 couples over three years, per the RRM SSOT fact inest-pregnancy-rate-57pct and the paper's own text. As written the entry both misattributes the study and understates the Human Reproduction Open result by fifteen points. Fix to: 'Stanford et al. (2021, BMC Pregnancy and Childbirth) reported a 29% cumulative live birth rate at 24 months overall, 34% under age 35. Stanford et al. (2022, Human Reproduction Open, iNEST,

**Adversarial verdict:** CONFIRMED — Quoted sentence appears verbatim in body_html. The finding is right and the rubric puts 'wrong publication year/author' squarely at P0, so the severity is correct. I re-derived it rather than trusting the reviewer, and in doing so found the reviewer's own supporting data is partly wrong. Verified independently: the 29% at two years is Stanford JB, Carpentier PA, Meier BL, Rollo M, Tingey B, 'Resto

**Corrected fix:** Apply the reviewer's fix but with corrected identifiers and framing. Replacement text: 'Stanford et al. (2021, BMC Pregnancy and Childbirth, n=370, two New England family medicine clinics) reported a cumulative live birth rate of 29% at 24 months overall, rising to 34% for women under 35 and 40% for women with a BMI under 25. Stanford et al. (2022, Human Reproduction Open, iNEST, n=834) reported c

---

### `sonographic-ovulation-classification` — wrong_classification  ·  Part IV

**Field:** `body_html`  ·  **ref#78**

**Current:** The classification identifies eight patterns: anatomically normal ovulation; Luteinized Unruptured Follicle Syndrome (LUF)... mature follicle with absent or retained cumulus oophorus; Afollicularism...; and Empty Follicle Syndrome, in which the cumulus oophorus sign is absent despite apparent follicle development.

**Evidence:** The classification identifies eight patterns: anatomically normal ovulation; Luteinized Unruptured Follicle Syndrome (LUF), in which the follicle luteinizes without releasing the oocyte; Immature Follicle Syndrome, in which the follicle ruptures before reaching adequate size; Partial Rupture Syndrome, in which follicle collapse is incomplete over the expected timeframe; Delayed Rupture Syndrome, in which rupture occurs but is spread across an abnormally prolonged window; mature follicle with absent or retained cumulus oophorus; Afollicularism, in which no follicle reaches dominance; and Empty 

**Canon:** rrm-cli chapter-20-disorders-of-human-ovulation-sonographic-classification-system: 'With this approach, we are now able to identify the following defined ovulatory events: I. Anatomically Normal Ovulation by Ultrasound (MF: +) ... II. Anatomically Abnormal Ovulation by Ultrasound: A. Mature Follicle

**Suggested fix:** The primary source defines SEVEN categories, not eight: one anatomically normal plus six abnormal. The term double-counts the absent-cumulus category, listing it once as 'mature follicle with absent or retained cumulus oophorus' and again as 'Empty Follicle Syndrome', which in Hilgers is the same entity (the empty follicle IS the mature follicle whose cumulus is absent). The opening sentence inherits the error as 'six distinct pathological patterns and one anovulatory variant' (seven abnormal). Fix: state 'one anatomically normal pattern and six abnormal patterns' and merge the two duplicate entries into a single category, e.g. 'mature follicle with absent or retained cumulus oophorus, also 

**Adversarial verdict:** CONFIRMED — Quote check passes: the evidence_quote matches the tag-stripped body_html verbatim (programmatic containment, True), and the opening clause 'six distinct pathological patterns and one anovulatory variant' is also present verbatim. I re-derived the count from the primary source instead of trusting the reviewer. rrm-cli chapter-20-disorders-of-human-ovulation-sonographic-classification-system enumer

**Corrected fix:** The count correction is right, but the reviewer's merge wording would introduce a new, subtler error and must not be applied as written. Do NOT write 'mature follicle with absent or retained cumulus oophorus, also called Empty Follicle Syndrome'. Chapter 20 is explicit that the empty follicle is a cumulus-status attribute recorded across every category, not a synonym for category A: 'The empty fol

---

### `sonographic-ovulation-classification` — wrong_mechanism  ·  Part IV

**Field:** `body_html`  ·  **ref#78**

**Current:** a positive cumulus oophorus sign confirming oocyte-cumulus complex release

**Evidence:** Normal ovulation requires a dominant follicle reaching adequate mean diameter at rupture, a positive cumulus oophorus sign confirming oocyte-cumulus complex release, and complete follicle collapse.

**Canon:** rrm-cli chapter-20: 'The cumulus oophorus must be visualized in both longitudinal and transverse planes to verify its presence within the follicle... The empty follicle is identified by the absence of the cumulus in both planes.'

**Suggested fix:** The cumulus oophorus sign is a PRE-rupture finding: the sonographer searches for internal echoes adjacent to the inner follicle wall and must visualize the cumulus in both longitudinal and transverse planes to verify its presence WITHIN the follicle. It confirms that an oocyte-cumulus complex is present in the follicle before rupture; it does not confirm release. The term's own Empty Follicle Syndrome definition (cumulus absent despite apparent follicle development) depends on the correct reading, so the sentence contradicts itself. Rewrite as: 'a positive cumulus oophorus sign confirming an oocyte-cumulus complex is present within the follicle'.

**Adversarial verdict:** CONFIRMED — Quote check passes: the full sentence and the fragment 'a positive cumulus oophorus sign confirming oocyte-cumulus complex release' both appear verbatim in the raw body_html (programmatic containment, True). I re-derived the mechanism from the primary source and found stronger disproof than the reviewer offered. Three independent verbatim points from rrm-cli chapter-20: (a) the sign is assessed on

**Corrected fix:** The reviewer's rewrite is substantively correct and should be applied, with one sharpening so the release criterion is explicitly re-homed rather than merely dropped. Replace 'a positive cumulus oophorus sign confirming oocyte-cumulus complex release' with 'a positive cumulus oophorus sign, visualized in both scan planes, confirming an oocyte-cumulus complex is present within the follicle'. Leave 

---

### `microsurgery` — contradicts_cited_source  ·  Part V

**Field:** `body_html`  ·  **ref#184**

**Current:** The skill of the surgeon and the length of remaining tube after reversal are the two primary determinants of outcome.

**Evidence:** The skill of the surgeon and the length of remaining tube after reversal are the two primary determinants of outcome.

**Suggested fix:** This sentence names two determinants and silently drops the one its own cited meta-analysis identifies as most significant. It also contradicts the sibling glossary entry, which states 'Age at reversal is the single strongest predictor of success' (tubal-ligation-reversal). Rewrite to: 'The patient's age is the single strongest determinant of outcome; surgeon experience and the length of remaining tube after reversal are the principal technical determinants.' Fixing this also removes a live self-contradiction between two published glossary pages.

**Adversarial verdict:** CONFIRMED — Quote check passes: the sentence 'The skill of the surgeon and the length of remaining tube after reversal are the two primary determinants of outcome.' appears verbatim in terms-part-V.json, closing the third paragraph of the microsurgery entry. I re-derived the source independently via NCBI efetch on PMID 38353086 rather than accepting the prior reviewer's excerpt. Ref 184 resolves correctly to 

**Corrected fix:** Rewrite to: 'The woman's age at the time of reversal is the single strongest determinant of outcome. The length of remaining tube, the original method of sterilization, and the experience of the surgeon are the principal technical determinants.' Three notes on the reviewer's version. First, use 'the woman's age at the time of reversal' rather than 'the patient's age' so the wording matches the sib

---

### `near-adhesion-free-pelvic-surgery` — wrong_authors  ·  Part V

**Field:** `reference[80].anchor_text`  ·  **ref#80**

**Current:** Hilgers TW, Stanford JB, Boyle PC, et al. Near Adhesion-Free Reconstructive Pelvic Surgery: Three Distinct Phases of Progress Over 23 Years. J Gynecol Surg. 2010.

**Evidence:** rrm-cli get article near-adhesion-free-reconstructive-pelvic-surgery-three-distinct-phases-of-progre-reciu1zzbrhn9o052 returns: "authors": "Hilgers TW", "year": 2010, "journal": "Journal of gynecologic surgery"

**Suggested fix:** The paper is single-authored. Two named co-authors who did not write it are being publicly credited, and both are real, identifiable people in this field. Correct reference 80 to: 'Hilgers TW. Near Adhesion-Free Reconstructive Pelvic Surgery: Three Distinct Phases of Progress Over 23 Years. J Gynecol Surg. 2010;26(1):31-40.' Note this reference row is shared and also feeds the adhesiolysis and anti-adhesion-barriers entries, so one fix corrects three pages.

**Adversarial verdict:** CONFIRMED — Anchor text verified verbatim at ref_num 80 in references.json. Confirmed and correctly rated P0. I established authorship from three independent sources rather than accepting the prior reviewer's Semantic Scholar assertion, per the rule against laundering a search result into evidence. (1) I downloaded the published article PDF and extracted page 1: the byline is a single name, 'Thomas W. Hilgers

**Corrected fix:** The citation string is right but incomplete, and the blast radius is understated. Use the library SSOT's own Vancouver form, which carries the DOI I confirmed resolves to this exact paper: 'Hilgers TW. Near Adhesion-Free Reconstructive Pelvic Surgery: Three Distinct Phases of Progress Over 23 Years. J Gynecol Surg. 2010;26(1):31-40. doi:10.1089/gyn.2009.0031'. Correct the count: one fix repairs si

---

### `vasectomy-reversal` — wrong_mechanism  ·  Part V

**Field:** `body_html`

**Current:** Vasoepididymostomy bypasses the vas deferens and connects directly to the epididymis; surgeons must use it when secondary epididymal obstruction has developed upstream, a complication more common with longer obstructive intervals.

**Evidence:** Vasoepididymostomy bypasses the vas deferens and connects directly to the epididymis

**Suggested fix:** This is anatomically backwards. Vasoepididymostomy uses the vas deferens as the outflow conduit and bypasses the obstructed segment of the EPIDIDYMIS. Rewrite to: 'Vasoepididymostomy bypasses an obstruction inside the epididymis by joining the vas deferens directly to a patent epididymal tubule above the blockage.' The rest of the sentence (secondary epididymal obstruction, longer obstructive intervals) is correct and should be kept.

**Adversarial verdict:** CONFIRMED — Quote confirmed verbatim in terms-part-V.json. The mechanism as written is wrong and I re-derived this from a primary source I retrieved myself rather than from the prior reviewer's Perplexity excerpt: Namekawa T, Imamoto T, Kato M, Komiya A, Ichikawa T, 'Vasovasostomy and vasoepididymostomy: Review of the procedures, outcomes, and predictors of patency and pregnancy over the last decade', Reprodu

**Corrected fix:** Apply the reviewer's rewrite with one directional tightening, since the sentence already uses 'upstream' and 'above' is ambiguous in this anatomy. Use: 'Vasoepididymostomy joins the vas deferens directly to a patent epididymal tubule upstream of an obstruction inside the epididymis; surgeons must use it when secondary epididymal obstruction has developed, a complication more common with longer obs

---

### `dor` — study_attribution_error  ·  Part VI-B

**Field:** `body_html`  ·  **ref#101**

**Current:** A 2017 JAMA study found that AMH and AFC did not predict natural conception rates in older reproductive-age women as precisely as commonly assumed, underscoring the importance of individualized evaluation over thresholds alone.<sup class="cite-ref"><a href="#ref-101">101</a></sup>

**Evidence:** A 2017 JAMA study found that AMH and AFC did not predict natural conception rates in older reproductive-age women as precisely as commonly assumed

**Suggested fix:** Steiner 2017 JAMA (ref 101) did not measure antral follicle count. Its exposures, verbatim from the abstract, were 'Early-follicular-phase serum level of antimullerian hormone (AMH), follicle-stimulating hormone (FSH), and inhibin B and urinary level of FSH.' A full-text scan of the library record returns zero hits for AFC and only bibliography-level mentions of antral follicle count. Two fixes needed: (1) drop AFC from the attribution and replace with FSH and inhibin B; (2) the study found no significant association at all, which is stronger than 'not as precisely as commonly assumed'. Suggested: 'A 2017 JAMA study of women aged 30 to 44 found that low AMH, high FSH and inhibin B levels wer

**Adversarial verdict:** CONFIRMED — Quote check: current_value appears verbatim in terms-part-VI-B.json, paragraph 2 of the dor entry. Independent derivation, not deference to the reviewer: I pulled the primary record myself. Note first that Perplexity returned PMID 28975287 for this paper, which I checked via esummary and it resolves to 'Humanizing the Treatment of Hyperactive Delirium in the Last Days of Life' (JAMA 2017;318(11):1

**Corrected fix:** Replace with: 'A 2017 JAMA study of women aged 30 to 44 with no history of infertility found that low AMH, high serum or urinary FSH, and inhibin B levels were not associated with a reduced probability of conceiving naturally, underscoring the importance of individualized evaluation over thresholds alone.' Three corrections to the reviewer's proposed wording, all from the primary abstract: (1) uri

---

### `empty-follicle-syndrome` — contradicts_primary_source  ·  Part VI-C

**Field:** `body_html`  ·  **ref#78**

**Current:** EFS is distinct from <a href="#anovulatory-cycles" class="gloss-xref">anovulation</a> and from <a href="#afollicularism" class="gloss-xref">afollicularism</a>. In EFS, follicular development proceeds and collapse occurs. The failure is at a different level: no viable oocyte accompanies that collapse. It is also distinct from <a href="#immature-follicle-syndrome" class="gloss-xref">Immature Follicle Syndrome</a>, where the follicle ruptures before reaching maturity, and from <a href="#partial-rupture-syndrome" class="gloss-xref">Partial Rupture Syndrome</a>, where collapse is incomplete.

**Evidence:** EFS is distinct from anovulation and from afollicularism. In EFS, follicular development proceeds and collapse occurs. The failure is at a different level: no viable oocyte accompanies that collapse. It is also distinct from Immature Follicle Syndrome, where the follicle ruptures before reaching maturity, and from Partial Rupture Syndrome, where collapse is incomplete.

**Canon:** Hilgers TW, 'The Medical and Surgical Practice of NaProTECHNOLOGY', Chapter 20: Disorders of Human Ovulation: Sonographic Classification System (ref 78), retrieved in full from the RRM library via rrm-cli. Verbatim from that chapter: 'The empty follicle (a negative cumulus oophorus) underwent severa

**Suggested fix:** This directly contradicts the source the term cites. In Hilgers' classification the empty follicle is a CUMULUS OOPHORUS finding that runs orthogonally across the rupture categories, not a seventh mutually exclusive syndrome. Empty follicles were specifically observed in immature follicles, partial ruptures, luteinized unruptured follicles, delayed ruptures and afollicular cycles, which is the opposite of 'distinct from'. Rewrite as: 'The empty follicle finding is recorded alongside the rupture pattern rather than instead of it. A follicle may be immature, partially ruptured, unruptured or afollicular and also lack a visible cumulus, and the classification captures both facts about the same 

**Adversarial verdict:** CONFIRMED — Quote check: the current_value appears VERBATIM in /tmp/glossary-review/terms-part-VI-C.json, slug empty-follicle-syndrome, third paragraph. No misquote.

I re-derived this independently rather than trusting the prior reviewer. I retrieved Hilgers Chapter 20 body in full from the local corpus at ~/.rrm-cli/private/chapters.json (21,650 chars, 'Chapter 20: Disorders of Human Ovulation: Sonographic 

**Corrected fix:** Replace the paragraph with (xrefs preserved, no thresholds or measurements, so no protocol leak):

<p>The empty follicle is a cumulus finding recorded alongside the rupture pattern, not instead of it. Hilgers reported that its frequency was independent of the type of follicular rupture, and of whether rupture occurred at all.<sup class="cite-ref"><a href="#ref-78">78</a></sup> A cycle may be <a hr

---

### `fsh` — citation_contradiction  ·  Part VI-C

**Field:** `body_html`  ·  **ref#101**

**Current:** A large study of women 30 to 44 years old found that elevated FSH was independently associated with infertility across all age groups, confirming its relevance beyond the IVF context where it is most commonly discussed.<sup class="cite-ref"><a href="#ref-101">101</a></sup>

**Evidence:** A large study of women 30 to 44 years old found that elevated FSH was independently associated with infertility across all age groups, confirming its relevance beyond the IVF context where it is most commonly discussed.

**Suggested fix:** The glossary states the exact opposite of the study it cites. Ref 101 is Steiner AZ et al., 'Association Between Biomarkers of Ovarian Reserve and Infertility Among Older Women of Reproductive Age', JAMA 2017 (the anchor text matches this paper precisely), and its conclusion is that diminished-ovarian-reserve biomarkers including elevated FSH were NOT associated with reduced fertility in women aged 30-44, with the authors explicitly cautioning against using FSH or AMH as natural-fertility tests. Do not simply delete this: the true finding is more useful to RRM than the false one. Rewrite along the lines of 'A large study of women aged 30 to 44 found that elevated FSH did not predict reduced 

**Adversarial verdict:** CONFIRMED — Quote check passes: the current_value appears verbatim in terms-part-VI-C.json under slug fsh. Ref 101 resolves from references.json to the library record association-between-biomarkers-of-ovarian-reserve-and-infertility-among-older-wo-reckxs7k83ltnbrhv, which rrm-cli confirms is PMID 29049585 / DOI 10.1001/jama.2017.14588. I verified that PMID directly via NCBI efetch: Steiner AZ, Pritchard D, St

**Corrected fix:** The prior suggested_fix has the right direction and the right instinct (rewrite rather than delete, because the true finding serves RRM better than the false one), but its proposed sentence drops the population qualifier and would create a fresh, subtler mismatch. Steiner's conclusion is explicitly bounded to 'women with these characteristics' - no history of infertility, trying to conceive for th

---

### `mature-reproductive-age` — mechanism_error  ·  Part VI-D

**Field:** `body_html`

**Current:** as the ovarian reserve that was built across childhood declines with accelerating pace through the mid-thirties and beyond

**Evidence:** acknowledging that fertility potential, egg quality, and time-to-pregnancy change meaningfully as the ovarian reserve that was built across childhood declines with accelerating pace through the mid-thirties and beyond

**Suggested fix:** Factually wrong and reverses the direction of the biology. The primordial follicle pool is established in FETAL life (primordial follicles from ~18 weeks gestation, peaking around 5 months gestation) and declines continuously from before birth onward - nothing is 'built across childhood'; the pool is already falling throughout childhood. Fix: 'as the ovarian reserve established before birth continues its decline, at an accelerating pace through the mid-thirties and beyond.' This is the one P0 in the entry and it sits in the opening bold definition, which is the highest-visibility line on the page.

**Adversarial verdict:** CONFIRMED — Quote check PASSES: 'as the ovarian reserve that was built across childhood declines with accelerating pace through the mid-thirties and beyond' appears verbatim in the opening bold definition of mature-reproductive-age. On the substance I refused to take the reviewer's Perplexity excerpt at face value and went to the publisher. Crossref resolves DOI 10.1371/journal.pone.0008772 to Wallace WHB and

**Corrected fix:** Replace 'as the ovarian reserve that was built across childhood declines with accelerating pace through the mid-thirties and beyond' with 'as the ovarian reserve established before birth declines at an accelerating pace through the mid-thirties and beyond'. This is the reviewer's fix with the redundant 'continues its decline' tightened and no em dashes. Deliberately avoids naming a peak gestationa

---

### `oligospermia` — factual_error  ·  Part VI-D

**Field:** `body_html`

**Current:** Historically defined as fewer than 20 million sperm per milliliter, the WHO 2010 and 2021 reference ranges revised the threshold to fewer than 15 million per milliliter, representing the fifth centile of fertile men.

**Evidence:** the WHO 2010 and 2021 reference ranges revised the threshold to fewer than 15 million per milliliter, representing the fifth centile of fertile men

**Suggested fix:** WHO 2010 and WHO 2021 do not share a threshold. The 5th edition (2010) lower reference limit is 15 x 10^6/mL; the 6th edition (2021) raised it to 16 x 10^6/mL. Collapsing them into a single '15 million' figure publishes an out-of-date number as current. Rewrite: 'Historically defined as fewer than 20 million sperm per millilitre (WHO 1999), the threshold was revised to 15 million per millilitre in the WHO 2010 fifth edition and to 16 million per millilitre in the WHO 2021 sixth edition, each representing the fifth centile of men who achieved a natural conception within twelve months.' Note the 'fertile men' phrasing should also become the WHO's own framing - men in couples achieving natural 

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-VI-D.json. I re-derived the claim from a document I retrieved and read rather than from the prior reviewer's Perplexity excerpt. The EAU Guidelines on Sexual and Reproductive Health, 2023 limited update (local copy /tmp/glossary-review/eau2023.txt, page footer 'SEXUAL AND REPRODUCTIVE HEALTH - LIMITED UPDATE 2023'), Table 53 'Lower reference limits (5th centil

**Corrected fix:** Adopt the reviewer's rewrite with two amendments. Use: 'Historically defined as fewer than 20 million sperm per milliliter under the WHO manuals through the fourth edition, the threshold was revised to 15 million per milliliter in the WHO 2010 fifth edition and to 16 million per milliliter in the WHO 2021 sixth edition. Each figure is the fifth centile of a reference population of men whose partne

---

### `fertilitycare-practitioner` — factual_error  ·  Part VII

**Field:** `body_html`  ·  **ref#7**

**Current:** The credential is issued through the FertilityCare Centers of America training program.<sup class="cite-ref"><a href="#ref-7">7</a></sup>

**Evidence:** The credential is issued through the FertilityCare Centers of America training program.<sup class="cite-ref"><a href="#ref-7">7</a></sup>

**Canon:** Contradicts glossary term fertilitycare-practice (same batch)

**Suggested fix:** Wrong issuing body, and it directly contradicts the sibling glossary term fertilitycare-practice, which states 'FertilityCare Practitioners are credentialed through the American Academy of FertilityCare Professionals (AAFCP).' Both cannot stand. Per the organizations' own documents, FCCA-affiliated centers deliver the education program while AAFCP issues certification, and the fully certified designation is CFCP (Certified FertilityCare Practitioner). Rewrite to: 'Training is delivered through FertilityCare Centers of America affiliated education programs; certification is issued by the American Academy of FertilityCare Professionals (AAFCP), which awards the Certified FertilityCare Practiti

**Adversarial verdict:** UPGRADE — Quote check PASSES verbatim. I did NOT take the reviewer's word and I did not launder Perplexity: I curled https://fertilitycareinternational.org/certification/ myself (HTTP 200, 89,922 bytes) and the page states under the heading 'Certification by the AAFCP' that 'The American Academy of Fertility Care Professionals (AAFCP) is the professional organization for providers of the CREIGHTON MODEL Fer

**Corrected fix:** The reviewer's diagnosis is right but their proposed wording introduces an unverified claim. I could NOT confirm 'CFCP (Certified FertilityCare Practitioner)' as the certifying body's own designation: aafcp.org returns 403 to browser, Googlebot and crawler UAs, and the FertilityCare International certification page I did retrieve contains the string 'CFCP' ZERO times - its 'Professional Definition

---

### `pelvic-floor-physical-therapy` — factual_error  ·  Part VII

**Field:** `body_html`  ·  **ref#221**

**Current:** A randomized controlled trial in women with deep infiltrating endometriosis found that pelvic floor muscle physiotherapy produced significant improvements in urinary, bowel, and sexual function compared to controls.<sup class="cite-ref"><a href="#ref-221">221</a></sup>

**Evidence:** A randomized controlled trial in women with deep infiltrating endometriosis found that pelvic floor muscle physiotherapy produced significant improvements in urinary, bowel, and sexual function compared to controls.<sup class="cite-ref"><a href="#ref-221">221</a></sup>

**Suggested fix:** This states the OPPOSITE of what the cited trial found. Ref 221 is Del Forno S et al, Medicina (Kaunas) 2024;60(1):4 (PMID 38256327) - the trial reported NO significant difference between groups in urinary, bowel or sexual function. The sentence appears to have conflated this paper with the same group's earlier RCT in the same cohort, which did report improvement in superficial dyspareunia, chronic pelvic pain and pelvic floor muscle relaxation. Two options: (a) restate accurately - 'A randomized controlled trial in women with deep infiltrating endometriosis found pelvic floor muscle physiotherapy did not significantly change urinary, bowel or sexual function, though the same cohort had prev

**Adversarial verdict:** CONFIRMED — Quote check passed: exact substring match in body_html. I verified the trial from the registry, not from the prior reviewer's summary. PubMed efetch of PMID 38256327 returns Del Forno S, Cocchi L, Arena A, Pellizzone V, Lenzi J, Raffone A, et al., 'Effects of Pelvic Floor Muscle Physiotherapy on Urinary, Bowel, and Sexual Functions in Women with Deep Infiltrating Endometriosis: A Randomized Contro

**Corrected fix:** Take option (b), and unlike the prior reviewer I can supply the identifiers because I confirmed them in PubMed. Replace the sentence with: 'A randomized controlled trial in women with deep infiltrating endometriosis found that pelvic floor muscle physiotherapy improved superficial dyspareunia, chronic pelvic pain, and pelvic floor muscle relaxation compared with no intervention.' Cite Del Forno S,

---

### `art` — citation_mismatch  ·  Part VIII

**Field:** `body_html`  ·  **ref#96**

**Current:** A systematic review of controlled studies confirmed elevated risk for both singletons and twins after assisted conception.

**Evidence:** Conclusions: The increased risk for singletons after assisted conception is comparable to the risk in women who conceive naturally after being subfertile (time to pregnancy more than a year). In twin pregnancies, perinatal mortality is about 40% lower after assisted compared with natural conception.

**Suggested fix:** Ref 96 is Helmerhorst FM et al., BMJ 2004;328:261 (PMID 14742347, identity confirmed via NCBI esummary). For TWINS the review found the opposite of what this sentence claims: perinatal mortality RR 0.58 (0.44-0.77), very preterm RR 0.95 (0.78-1.15), very low birth weight RR 0.89 (0.74-1.07), low birth weight RR 1.03 (0.99-1.08) - i.e. lower mortality and null differences, and the abstract's own conclusion says twin perinatal mortality is about 40% LOWER after assisted conception. Only the singleton arm supports 'elevated risk' (perinatal mortality RR 1.68, preterm RR 2.04, LBW RR 1.70). Rewrite to: 'A systematic review of controlled studies found that singletons conceived after assisted conc

**Adversarial verdict:** CONFIRMED — Quote check passes. 'A systematic review of controlled studies confirmed elevated risk for both singletons and twins after assisted conception.' appears verbatim in the art body_html, paragraph 4, attached to ref 96. I resolved ref 96 myself rather than trusting the prior reviewer: references.json ref_num 96 points to pubmed.ncbi.nlm.nih.gov/14742347, and NCBI esummary plus efetch return Helmerhor

**Corrected fix:** The reviewer's replacement sentence is numerically accurate; I checked 2.04, 1.70 and 1.68 against the NCBI abstract and all three match the matched-control singleton estimates. Adopt it in strengthened form rather than verbatim, because the abstract carries larger matched-control effects that the proposed sentence leaves unused, and canon says make the strong claim the evidence actually carries: 

---

### `ivf` — misattributed_statistic  ·  Part VIII

**Field:** `body_html`  ·  **ref#14**

**Current:** IVF does not correct the underlying obstacle to conception: in couples with prior ART failure, NaProTechnology subsequently identified a mean of 2.5 unresolved anatomical, hormonal, or endometrial conditions per couple and achieved a 62.1% adjusted cumulative live birth rate.

**Evidence:** 98.1% had at least one cause of infertility identified, mean 2.5 diagnoses per couple / 62.1% adjusted cumulative take-home baby rate (95% CI: 58.8-65.4) / 25.3% THB rate in patients with prior ART, vs 17.0% spontaneous rate after failed IVF

**Canon:** [[rrm-success-rate-cite-best-cohort]] - cite the best cohort, but cite it to the population it was measured in

**Suggested fix:** Both figures are misattributed to the wrong population. Ref 14 is Sanchez-Mendez JI et al., Front Reprod Health 2025 (PMID 41323405, N=1,310) and the RRM SSOT records both numbers as WHOLE-COHORT values: facts sanchez-2025-diagnostic-yield ('mean 2.5 diagnoses per couple') and sanchez-2025-adjusted-thb ('62.1% adjusted cumulative take-home baby rate'). The prior-ART subgroup value in the same paper is materially lower: fact sanchez-2025-prior-art-success gives '25.3% THB rate in patients with prior ART'. As written the sentence claims a 62.1% live birth rate specifically in prior-ART-failure couples, which the source does not support and which an ART critic can dismantle in one lookup. Rewri

**Adversarial verdict:** CONFIRMED — Quote check PASSES: the sentence appears verbatim in terms-part-VIII.json, ivf body_html, paragraph 4, cited to ref 14. Ref 14 identity independently confirmed via NCBI esummary, not via the prior reviewer: PMID 41323405 = Sanchez-Mendez JI et al., 'Natural procreative technology (NaProTechnology) for infertility: take-home baby rate and clinical outcomes in a 5-year single-center cohort of 1,310 

**Corrected fix:** Prior reviewer's diagnosis is right; its remedy needs one correction before it is applied. CORRECT: (1) attribute 'mean of 2.5 diagnoses per couple' and '62.1% adjusted cumulative' to the full 1,310-couple cohort; (2) relabel 'live birth rate' as 'take-home baby rate'. WRONG AS WRITTEN: the fix offers 25.3% as the prior-ART-failure substitute for 62.1%. Those are different estimators. 25.3% is the

---

### `ohss` — internal_contradiction  ·  Part VIII

**Field:** `body_html`

**Current:** OHSS does not occur in restorative reproductive medicine protocols.

**Evidence:** When used, gonadotropin cycles are closely monitored by serial transvaginal ultrasound to detect multi-follicular development and reduce the risk of ovarian hyperstimulation syndrome (OHSS).

**Canon:** [[feedback-no-absolutist-patient-copy]] - no absolutist patient copy

**Suggested fix:** This absolute is contradicted inside the same glossary. The gonadotropins term (Part VIII, sort_order 17) states that NaProTechnology practice uses injectable gonadotropins and monitors those cycles specifically 'to reduce the risk of ovarian hyperstimulation syndrome (OHSS)' - which only makes sense if the risk is non-zero. It is also wrong against the literature: OHSS is documented with non-IVF ovulation induction using gonadotropins (roughly 1% overall, 0.2-1% severe), rarely with clomiphene citrate, and even spontaneously. Rewrite to the true and stronger claim: 'OHSS is overwhelmingly a complication of high-dose superstimulation for ART. Restorative protocols use low-dose hormonal suppo

**Adversarial verdict:** CONFIRMED — Quote check passes. 'OHSS does not occur in restorative reproductive medicine protocols.' appears verbatim in the ohss body_html (paragraph 3), and the gonadotropins entry (same file, sort_order 17) contains the cited counter-sentence verbatim. The contradiction is real and internal: one entry says the risk does not exist in RRM, the sibling entry says NaProTechnology practice uses injectable rFSH

**Corrected fix:** Keep the reviewer's structure, but do not confine the residual risk to gonadotropin cycles only. Replace 'OHSS does not occur in restorative reproductive medicine protocols.' with: 'OHSS is overwhelmingly a complication of the high dose superstimulation used in ART. Restorative protocols use low dose hormonal support calibrated to documented cycle deficiencies, so the risk is far lower, and it is 

---

## P1 — citation does not support the claim, or protocol leak (56)

### `follicular-phase` — contradicted_by_own_evidence  ·  Part I

**Field:** `body_html (luteal phase length)`

**Current:** Unlike the <a href="#luteal-phase" class="gloss-xref">luteal phase</a>, which is relatively fixed at approximately 14 days, follicular phase length is variable.

**Evidence:** RRM library, Najmabadi S, Simonsen SE, Porucznik CA, Egger MJ, Stanford JB, Schliep KC (Paediatric and Perinatal Epidemiology, 2020), abstract verbatim: "581 women (3,324 cycles) with no known subfertility... luteal phase length 11.7 (2.8) days, median 12... within-woman differences between the longest and shortest... luteal phase >3 days were found in... 58.8% of women" -- and the glossary's OWN Part VI entry: "In a healthy cycle, the luteal phase typically spans 11 to 16 days."

**Suggested fix:** 'Relatively fixed at approximately 14 days' is the classic textbook simplification that FABM/RRM literature exists to refute, and it contradicts both the glossary's own luteal-phase entry (11 to 16 days) and RRM's own published pooled analysis (mean 11.7 days, median 12, with 58.8% of women varying by more than 3 days). Rewrite, e.g.: 'The luteal phase is less variable than the follicular phase, typically 11 to 16 days; most cycle-to-cycle variation in total cycle length originates in the follicular phase.' This keeps the term's actual point intact while removing the 14-day myth.

**Adversarial verdict:** CONFIRMED — Quote check PASSES verbatim, including the anchor markup. I re-derived this independently rather than accepting the reviewer's framing. First, the internal contradiction is real and I read both entries myself: the glossary's own luteal-phase entry (terms-part-VI-A.json and terms-part-VI.json) states 'In a healthy cycle, the luteal phase typically spans 11 to 16 days' and cites ref-44, while the fo

**Corrected fix:** The reviewer's replacement text is factually fine but would introduce a duplication defect: the paragraph's existing next sentence already reads 'Most cycle-to-cycle variation in total cycle length originates here', and the proposed fix re-states that clause. Use this instead, preserving the xref markup and leaving the following sentence untouched: 'Unlike the <a href="#luteal-phase" class="gloss-

---

### `natural-fertility` — citation_mismatch  ·  Part I

**Field:** `body_html (fecundability sentence, cited to ref 3)`  ·  **ref#3**

**Current:** In healthy couples, the chance of conception in a given cycle is approximately 20-25%, declining with age and with unaddressed conditions such as [endometriosis, tubal disease, ovulatory dysfunction, male-factor impairment]<sup><a href="#ref-3">3</a></sup>

**Evidence:** Ref 3 abstract (rrm-cli, verbatim): "Among 370 couples beginning treatment for infertility, the mean age was 34.8 years... The cumulative live birth rate at 2 years was 29% overall; this was significantly higher for women under age 35 (34%), and for women with body mass index < 25 (40%)."

**Suggested fix:** The per-cycle fecundability figure is attached to Stanford 2021 (an observational outcomes study of 370 subfertile couples in two family medicine clinics), which reports nothing about the per-cycle conception probability of healthy couples. Re-point the figure to a source that actually reports population fecundability. Note also that Perplexity could not find '20-25% per cycle' in the ASRM committee opinion currently cited as ref 87. Keep the number only if a fecundability source is attached; the 20-25% range is standard textbook material but is currently unsourced in practice.

**Adversarial verdict:** CONFIRMED — Confirmed, though I had to correct part of the reviewer's supporting reasoning. QUOTE CHECK: current_value is a normalized quote, not verbatim, the reviewer collapsed the four inline glossary links into a bracketed list and dropped class="cite-ref" from the sup. I did not refute on that, because the load-bearing text is verbatim in terms-part-I.json: "the chance of conception in a given cycle is a

**Corrected fix:** The reviewer's direction is right (re-point the figure to a real fecundability source) but the fix as written would create a NEW number/source mismatch, so use this instead. The nearest verified primary source does not report 20-25%. I pulled Zinaman MJ, Clegg ED, Brown CC, O'Connor J, Selevan SG, Estimates of human fertility and pregnancy loss, Fertil Steril 1996 Mar;65(3):503-9, PMID 8774277, ve

---

### `progesterone-as-a-neurosteroid` — wrong_drug_description  ·  Part I

**Field:** `body_html (brexanolone)`  ·  **ref#259**

**Current:** The pharmaceutical industry recognized this mechanism and produced brexanolone (Zulresso), a synthetic intravenous allopregnanolone analogue that received FDA approval in 2019 as the first treatment specifically indicated for postpartum depression, at a cost of approximately $34,000 per course of treatment.

**Evidence:** Perplexity quoting the FDA review verbatim: “Brexanolone is an allosteric modulator of GABAA receptors and chemically identical to the endogenous metabolite of progesterone, allopregnanolone.” and “Brexanolone… is classified as a **pregnane neurosteroid**… chemically identical to the endogenous neurosteroid allopregnanolone…”

**Suggested fix:** Brexanolone is not an analogue. It is chemically identical to endogenous allopregnanolone (C21H34O2), formulated for IV infusion. Change 'a synthetic intravenous allopregnanolone analogue' to 'an intravenous formulation of allopregnanolone itself' or 'synthetic allopregnanolone, chemically identical to the endogenous neurosteroid'. This correction strengthens the term's own argument: the industry did not invent a new molecule, it packaged the one the body makes. Everything else in the sentence checks out (FDA approval March 19 2019, first agent specifically indicated for postpartum depression, ~$34,000 launch list price per course).

**Adversarial verdict:** DOWNGRADE — Quote check PASSES verbatim. The factual core of the finding is correct and I established it independently rather than relying on the reviewer's Perplexity excerpt. I queried PubChem directly by name for both 'brexanolone' and 'allopregnanolone' and both resolve to the SAME compound record: CID 92786, molecular formula C21H34O2, InChIKey AURFZBICLPNKBZ-SYBPFIFISA-N. The synonym list for that singl

**Corrected fix:** Accept the substance of the reviewer's fix. Replace 'a synthetic intravenous allopregnanolone analogue' with 'an intravenous formulation of allopregnanolone itself, chemically identical to the endogenous neurosteroid'. This matches the FDA label wording, keeps the sentence free of em dashes per house style, and strengthens the entry's own argument that the industry did not invent a new molecule. W

---

### `root-cause-diagnosis` — citation_metadata_wrong  ·  Part I

**Field:** `references.json ref_num 4 (journal), cited in root-cause-diagnosis body_html`  ·  **ref#4**

**Current:** ref_num 4 | anchor_text: "Infertility is a symptom, not a disease" | journal: "Int J Fertil Womens Med"

**Evidence:** Perplexity (verbatim): "The first paper was published in **_Fertility and Sterility_** in **2000**.[1] The PubMed record gives the citation verbatim as: **“Fertil Steril. 2000 Aug;74(2):398.”**" -- and independently, rrm-cli D1 record: "title":"Infertility is a symptom, not a disease","authors":"Dickey RP, Taylor SN, Rye PH, Lu PY, Sartor BM","year":2000,"journal":"Fertility and Sterility"

**Suggested fix:** Change ref 4 journal from "Int J Fertil Womens Med" to "Fertility and Sterility". Correct citation: Dickey RP, Taylor SN, Rye PH, Lu PY, Sartor BM. Infertility is a symptom, not a disease. Fertil Steril. 2000 Aug;74(2):398. Two independent sources agree (RRM D1 library record + PubMed 10927067 via Perplexity). The claim the citation supports is fine; only the journal attribution is wrong.

**Adversarial verdict:** DOWNGRADE — The error is REAL and I re-derived it independently three ways, but P0 is too high. (1) current_value confirmed verbatim: references.json ref_num 4 carries anchor_text "Infertility is a symptom, not a disease" with journal "Int J Fertil Womens Med". (2) I did NOT take Perplexity's word. I hit NCBI eutils esummary directly for PMID 10927067 and got source "Fertil Steril", fulljournalname "Fertility

**Corrected fix:** Change ref 4 journal from "Int J Fertil Womens Med" to "Fertility and Sterility" (abbrev "Fertil Steril"). Canonical: Dickey RP, Taylor SN, Rye PH, Lu PY, Sartor BM. Infertility is a symptom, not a disease. Fertil Steril. 2000 Aug;74(2):398. Two additions the prior reviewer missed, both registry-confirmed by me: (a) record the verified identifiers alongside the fix, DOI 10.1016/s0015-0282(00)00604

---

### `cervical-mucus-patterns` — unsupported_claim  ·  Part II

**Field:** `body_html`

**Current:** The Peak Day, defined as the last day of clear, stretchy, or lubricative mucus, correlates within one to two days of ovulation in approximately 90% of cycles.

**Evidence:** The Peak Day, defined as the last day of clear, stretchy, or lubricative mucus, correlates within one to two days of ovulation in approximately 90% of cycles.

**Canon:** No primary source gives this pairing. rrm-cli, ref 100 (Hilgers 1978): 'In 95.4% of these cycles, ovulation was estimated to occur from 2 days before to 2 days after the Peak symptom.' rrm-cli, ref 297 (Stanford 2020): 'The woman-picked Peak Day was the same as the referent day in 25% of 117 cycles,

**Suggested fix:** The figure is uncited and matches neither primary source: the +/-2 day figure is 95.4% (Hilgers 1978, trained users) or 84% (Stanford 2020, blinded, novice users), and +/-1 day is 58%. Replace with one sourced statement, e.g. 'ovulation falls within two days either side of Peak Day in about 95% of hormonally evaluated cycles (ref 100)', and cite it. Also harmonise with the peak-day term, which states 95%.

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in the rendered plain text of terms-part-II.json. I re-derived every number rather than trusting the finding.

(1) Both primary sources verified by direct retrieval, not laundered. NCBI esummary/efetch on PMID 724176 returns Hilgers TW, Abraham GE, Cavanagh D, "Natural family planning. I. The peak symptom and estimated time of ovulation," Obstet Gynecol. 1978 Nov;52(5):575-

**Corrected fix:** Take the reviewer's replacement sentence and citation ("about 95% ... ref 100") but do NOT execute the second half of the instruction as written. The reviewer says "harmonise with the peak-day term, which states 95%" - I checked what peak-day cites for that number and it is ref 8 (https://pmc.ncbi.nlm.nih.gov/articles/PMC12306780/, "Pregnancies, intentions, and fertility behaviors during use of th

---

### `essential-sameness-pattern-yellow-stamps` — protocol_leak  ·  Part II

**Field:** `body_html`  ·  **ref#78**

**Current:** Post-Peak Yellow Stamps apply from Peak+4 onward in qualifying continuous-discharge cycles.

**Evidence:** Post-Peak Yellow Stamps apply from Peak+4 onward in qualifying continuous-discharge cycles. Pre-Peak Yellow Stamps require the ESP criteria to be met. Both require formal instruction by a certified FertilityCare Practitioner.

**Canon:** RRM canon: no public protocols; cycle-day rules of the Peak+N form are curriculum-level detail

**Suggested fix:** Remove the explicit Peak+4 day. Rewrite at concept level: 'Post-Peak Yellow Stamps apply only once the post-Peak infertile phase has been reached under the method's rules; Pre-Peak Yellow Stamps require the ESP criteria to be met. Both require formal instruction by a certified FertilityCare Practitioner.' Note the sibling mucus-cycle-score term already models this posture correctly by withholding thresholds; this term contradicts that posture by publishing a chart rule while saying instruction is required.

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-II.json (raw-HTML exact match). I re-derived the finding rather than accepting it. Two independent lines of evidence confirm the leak, and one refutes the sentence's sourcing.

(1) It is an actionable avoid-pregnancy day rule. I downloaded the Saint Paul VI Institute's own CrMS chart/instruction sheet (https://saintpaulvi.com/PDF/CrMS_App_Copyright.pdf, HTTP 2

**Corrected fix:** Adopt the reviewer's concept-level rewrite but key it to the method's actual gate rather than a phase boundary, since Table 8-1 is explicit that post-Peak use turns on Peak Day confidence, not a day number. Suggested: "Post-Peak Yellow Stamps are introduced only after a woman confidently identifies her Peak Day and has charted the pattern through a full cycle; Pre-Peak Yellow Stamps require the ES

---

### `fabms` — citation_mismatch  ·  Part II

**Field:** `body_html`  ·  **ref#5**

**Current:** Note: The Creighton Model FertilityCare System is specifically classified as an NFP method by its developers and is distinct from the FABM umbrella.

**Evidence:** Specific methods include the Creighton Model FertilityCare System, the Billings Ovulation Method, the Sympto-Thermal Method, and the Marquette Method. Note: The Creighton Model FertilityCare System is specifically classified as an NFP method by its developers and is distinct from the FABM umbrella.

**Canon:** rrm-cli, Hilgers TW, Chapter 4: Introduction to the CREIGHTON MODEL System (2004), library excerpt: 'The CREIGHTON MODEL FertilityCare System (CrMS) is described as a standardized fertility awareness method enabling prospective identification of the fertile window'

**Suggested fix:** Self-contradicting sentence: the same paragraph lists CrMS as one of the 'specific methods' of FABMs and then excludes it from the FABM umbrella. RRM's own primary source (Hilgers, Medical and Surgical Practice of NaProTECHNOLOGY, Ch 4) calls CrMS 'a standardized fertility awareness method'; the CEIBA paper (ref 8) treats NFP and FABM as overlapping categories. Ref 5 does not support exclusion. Rewrite as: 'Its developers classify the Creighton Model FertilityCare System specifically as a system of natural family planning; it is also standardly counted among the FABMs.' Note the sibling term creighton-model already words this correctly ('distinct from other fertility awareness-based methods'

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-II.json (the only difference is an inline anchor wrapping 'Creighton Model'). I re-derived the finding rather than accepting it.

(1) Citation does not support the claim. Ref 5 resolves to PMID 33762172, Brewer M, Stevens L, 'Use of fertility awareness-based methods of contraception: Evidence from the National Survey of Family Growth, 2013-2017', Contraception

**Corrected fix:** The prior fix is directionally right but leaves ref 5 attached to a sentence it cannot support. Apply both changes together:

Replace: 'Note: The Creighton Model FertilityCare System is specifically classified as an NFP method by its developers and is distinct from the FABM umbrella.[ref-5]'
With: 'The Creighton Model FertilityCare System is classified by its developers specifically as a system of

---

### `fertile-window` — citation_mismatch  ·  Part II

**Field:** `body_html`  ·  **ref#413**

**Current:** The ovum is fertilizable for approximately 12 to 24 hours after ovulation.[ref-413]

**Evidence:** The ovum is fertilizable for approximately 12 to 24 hours after ovulation.

**Canon:** An on-point RRM source already exists in the library: Hilgers Ch 48 'Fecundity and Mucus Cycle Score' (author Joseph B. Stanford): 'Because ovum viability is less than 24 hours after ovulation, the number of days during which conception can occur is based on the viability and transport of sperm'

**Suggested fix:** The claim is standard physiology and should stay, but ref 413 (Dunson 1999, a day-specific-probability modelling paper) does not contain it. Recite to a reproductive physiology source; Hilgers Ch 48 in the RRM library states 'ovum viability is less than 24 hours after ovulation' and can carry it. Do not propagate any DOI or year I have not verified. The same 12-to-24-hour figure is restated later in the term and inherits the same citation gap.

**Adversarial verdict:** CONFIRMED — Quote check passes: 'The ovum is fertilizable for approximately 12 to 24 hours after ovulation.[ref-413]' appears verbatim. Ref 413 resolves to PMID 10402400 (Dunson DB, Baird DD, Wilcox AJ, Weinberg CR, Hum Reprod 1999). I fetched that abstract myself via NCBI efetch and read it in full: it is a statistical re-estimation of the six-day fertile interval correcting for error in identifying ovulatio

**Corrected fix:** The reviewer's recite target is close but not exact. I confirmed the Chapter 48 line verbatim in the RRM library: 'Because ovum viability is less than 24 hours after ovulation, the number of days during which conception can occur is based on the viability and transport of sperm, which in turn is based on estrogenic (type E) cervical mucus.' That supports 'less than about 24 hours' but not the 12 h

---

### `fertile-window` — protocol_leak  ·  Part II

**Field:** `body_html`  ·  **ref#276**

**Current:** In the Creighton Model FertilityCare System (CrMS), Peak Day +3 is an established protocol boundary marking the close of the fertile phase, operationalized in NaProTechnology clinical practice as the cutoff for early luteal phase progesterone measurement.[ref-276]

**Evidence:** In the Creighton Model FertilityCare System (CrMS), Peak Day +3 is an established protocol boundary marking the close of the fertile phase, operationalized in NaProTechnology clinical practice as the cutoff for early luteal phase progesterone measurement.

**Canon:** RRM canon: no public protocols or dosings; cycle-day timing of the P+N form must be rewritten at concept level

**Suggested fix:** Rewrite at concept level: 'CrMS closes the fertile phase a set number of days after Peak Day, and NaProTechnology anchors early luteal progesterone measurement to that same reference point.' Mitigating context for the editor: the cited paper's own published title contains '(Peak Day +3)', so this specific value is already public in the citation line; if the term is kept as-is that should be a conscious decision rather than drift. Also note this sentence conflates two different things (a family-planning rule and a diagnostic draw timing) and sits one sentence away from the contradictory 'Peak Day plus 2' claim flagged above.

**Adversarial verdict:** CONFIRMED — Quote check passes once the inline link markup around 'Creighton Model' is stripped. The canon rule is explicit and unconditional: cycle-day timing of the P plus N form must be flagged P1 protocol_leak, and 'Peak Day +3' is exactly that form, so the category and severity are correct as filed. I verified the mitigating context myself rather than taking it on trust: NCBI efetch on PMID 32431450 retu

**Corrected fix:** Keep the concept-level rewrite, for example: 'CrMS closes the fertile phase a set number of days after Peak Day, and NaProTechnology anchors early luteal progesterone measurement to that same reference point.[ref-276]' Strike both of the prior reviewer's supporting claims, which do not survive checking. First, the sentence does not 'conflate two different things': the cited paper explicitly unites

---

### `peak-day` — citation_mismatch  ·  Part II

**Field:** `body_html`  ·  **ref#8**

**Current:** in hormonally confirmed cycles charted with method instruction, hormonal confirmation placed ovulation within plus or minus two days of Peak Day in about 95% of cycles.[ref-8]

**Evidence:** Peak Day closely tracks the timing of ovulation: in hormonally confirmed cycles charted with method instruction, hormonal confirmation placed ovulation within plus or minus two days of Peak Day in about 95% of cycles.

**Canon:** rrm-cli full abstract of ref 100 (Hilgers TW, Abraham GE, Cavanagh D, Obstet Gynecol 1978): 'In 95.4% of these cycles, ovulation was estimated to occur from 2 days before to 2 days after the Peak symptom.' Also Hilgers Ch 48 (author Joseph B. Stanford): 'The Peak Day ... has been shown to be a relia

**Suggested fix:** The claim is TRUE but cited to the wrong paper. Ref 8 (CEIBA, PLoS One 2025) contains no hormonal ovulation confirmation and no accuracy analysis at all: a full-text scan for '95', 'ovulation with', 'hormonal', 'LH' and 'ultrasound' returns zero hits. Recite to ref 100 (Hilgers 1978), which states 95.4% within +/-2 days, and optionally to Hilgers Ch 48 in the library. Do not weaken the claim.

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-II.json, cited to ref-8. I re-derived both halves of the finding.

(1) Ref 8 cannot support the claim. Ref 8 resolves to PMID 40729325, DOI 10.1371/journal.pone.0328806, 'Pregnancies, intentions, and fertility behaviors during use of the Creighton Model FertilityCare System after initial intention to avoid pregnancy', PLoS One 2025 (the CEIBA effectiveness pap

**Corrected fix:** Recite to ref 100 as the prior reviewer says, and tighten the attribution to match what Hilgers 1978 actually measured. Do not weaken the claim and do not add a hedge or a 'however'.

Replace: 'Peak Day closely tracks the timing of ovulation: in hormonally confirmed cycles charted with method instruction, hormonal confirmation placed ovulation within plus or minus two days of Peak Day in about 95%

---

### `peak-day` — protocol_leak  ·  Part II

**Field:** `body_html`  ·  **ref#296**

**Current:** particularly the post-peak day 7 (P+7) progesterone and estradiol measurements used to evaluate luteal phase adequacy

**Evidence:** In NaProTECHNOLOGY, Peak Day also serves as the reference anchor for cycle-timed diagnostic blood draws, particularly the post-peak day 7 (P+7) progesterone and estradiol measurements used to evaluate luteal phase adequacy.

**Canon:** RRM canon: no public protocols or dosings; cycle-day timing in the P+3 to P+12 range is protocol-level detail

**Suggested fix:** Rewrite at concept level: 'Peak Day is the anchor for cycle-timed diagnostic blood draws, so that progesterone and estradiol are measured at the point in the luteal phase when the values are physiologically interpretable. The specific draw days are set by the clinician.' Remove the explicit P+7 day.

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-II.json (an inline anchor wraps 'luteal phase'). Confirmed on two independent grounds.

(1) Canon rule applies squarely. The stated rule is categorical: cycle-day timing in the P+3 through P+12 range MUST be flagged P1 protocol_leak. P+7 is inside that range, is stated explicitly with its notation, and is attributed to NaProTECHNOLOGY as a named clinical proce

**Corrected fix:** The prior fix is close but drops the NaProTECHNOLOGY attribution and its singular 'the point in the luteal phase' perpetuates the single-draw misreading of the source. Use:

Replace: 'In NaProTECHNOLOGY, Peak Day also serves as the reference anchor for cycle-timed diagnostic blood draws, particularly the post-peak day 7 (P+7) progesterone and estradiol measurements used to evaluate luteal phase ad

---

### `premenstrual-bleeding` — citation_mismatch  ·  Part II

**Field:** `body_html`  ·  **ref#44**

**Current:** Premenstrual Bleeding (PMB) is a Creighton Model biomarker consisting of brown spotting or light bleeding that appears before the onset of true menstrual flow, on days that should be post-Peak infertile days.[ref-44]

**Evidence:** Premenstrual Bleeding (PMB) is a Creighton Model biomarker consisting of brown spotting or light bleeding that appears before the onset of true menstrual flow, on days that should be post-Peak infertile days.

**Canon:** rrm-cli, Hilgers Ch 32 'Unusual Bleeding: Evaluation and Treatment', under the heading 'CREIGHTON MODEL Definitions': 'Premenstrual bleeding: Three or more days of light or very light or brown bleeding occurring prior to the beginning of the first moderate day of menstrual bleeding (PMB).'

**Suggested fix:** A definition explicitly labelled a Creighton Model biomarker is cited to ref 44 (Mesen & Young, a general progesterone/luteal-phase review), which does not define any CrMS biomarker. Recite to Hilgers Ch 32 (in the RRM library) and add the definitional threshold the CrMS source uses: three or more days of light, very light or brown bleeding before the first moderate day of flow. Note the sibling TEB entry does carry its 'two or more days' threshold, so the pair is currently inconsistent in rigour.

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in the rendered plain text of terms-part-II.json (raw-HTML match fails only because "Creighton Model" is wrapped in an anchor). I re-derived both halves independently.

(1) The correct source exists and says what the reviewer says it says. I pulled Hilgers 2004 Ch 32 full text via rrm-cli (get chapter chapter-32-unusual-bleeding-evaluation-and-treatment --full) and located 

**Corrected fix:** Reviewer's fix is directionally right; two corrections. (a) Cite the chapter, not the book: ref 78 points at the whole 2004 textbook, but the definition lives in Ch 32, which has its own live library record (https://rrmacademy.org/library/chapter-32-unusual-bleeding-evaluation-and-treatment/, HTTP 200). Ref 296 shows the glossary already uses chapter-level refs, so add a Ch 32 ref rather than reus

---

### `cooperative-progesterone-replacement` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#45**

**Current:** Major professional societies acknowledge luteal phase deficiency as a clinical entity requiring individualized evaluation and management. [ref 45]

**Evidence:** Luteal phase deficiency (LPD) is a clinical diagnosis associated with abnormal luteal phase length of <=10 days. ... Although progesterone is important for the process of implantation and early embryonic development, LPD has not been proven to be an independent entity causing infertility or recurrent...

**Canon:** Perplexity/mainstream disagreement never makes RRM canon wrong; log both sides. Here the defect is the attribution, not the RRM position.

**Suggested fix:** The cited document says close to the opposite. Ref 45 is the ASRM 2021 committee opinion, whose own summary states LPD 'has not been proven to be an independent entity causing infertility or recurrent pregnancy loss'. This is NOT a case of RRM canon being wrong; RRM's position that luteal phase deficiency is real, diagnosable by serial cycle-timed assay, and treatable stands. The error is the false claim that mainstream societies endorse it. Rewrite to state the disagreement plainly and from strength, for example: 'ASRM's 2021 committee opinion holds that luteal phase deficiency has not been established as an independent cause of infertility, largely because a single random progesterone draw

**Adversarial verdict:** CONFIRMED — Quoted sentence appears verbatim in body_html with the ref-45 <sup>. Ref 45 resolves to the ASRM 2021 committee opinion 'Diagnosis and treatment of luteal phase deficiency'. I retrieved the primary source myself twice: PubMed PMID 33827766 (Fertil Steril 2021 Jun;115(6):1416-1423, DOI 10.1016/j.fertnstert.2021.02.010) and the full text on asrm.org (HTTP 200 with a browser UA). The document states 

**Corrected fix:** Do not apply the reviewer's replacement prose verbatim. Two of its clauses are false against the source I pulled. (1) 'largely because a single random progesterone draw cannot characterise the luteal phase' misstates ASRM's stated reasoning, which is broader: the document evaluates cycle length, BBT, urinary LH kits, single AND multiple serum progesterone levels, and endometrial biopsy, and reject

---

### `fertilitas-study` — overclaim  ·  Part III

**Field:** `body_html`  ·  **ref#93**

**Current:** The methodology accounts for dropout through sensitivity analysis, making the 62.1% figure a conservative adjusted estimate rather than a raw completion rate.

**Evidence:** Kaplan-Meier analysis assumes non-informative censoring. However, if couples who discontinued treatment did so due to poor prognoses, this assumption may be violated, potentially leading to an overestimation of the adjusted THB rate. A sensitivity analysis modeled three scenarios: (A) 50% lower pregnancy probability among dropouts, (B) equal probability, and (C) 50% higher. Resulting adjusted cumulative pregnancy rates were 47.7%, 62.1%, and 76.5%, respectively, highlighting the impact of dropout assumptions.

**Suggested fix:** Directly contradicts the cited paper. 62.1% is scenario B, the equal-probability base case, not a conservative estimate; the conservative scenario is 47.7%, and the authors explicitly warn the adjusted rate may be an overestimate. Rewrite as: 'The authors ran a dropout sensitivity analysis; the 62.1% figure is the base-case estimate, with a conservative dropout assumption yielding 47.7% and a favourable one 76.5%.' Reporting the base case honestly is stronger than mislabelling it conservative, and pre-empts the obvious critique.

---

### `hcg-trigger` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#122**

**Current:** The trigger works because hCG is structurally similar to LH and binds the same receptor, producing the hormonal signal needed for the dominant follicle to complete maturation and rupture. [ref 122]

**Evidence:** Influence of corpus luteum age on the steroidogenic response to exogenous human chorionic gonadotropin in normal cycling women.

**Suggested fix:** Ref 122 is a 1992 AJOG study of the corpus luteum's steroidogenic response to hCG during the luteal phase. It does not investigate follicular maturation or rupture, yet it is attached to that mechanism sentence and again to 'The trigger does not stimulate follicle development; it signals a mature follicle to complete ovulation.' Ref 122 is correctly applied only to the post-ovulatory corpus luteum support sentence. For the LH/hCG receptor and final-maturation mechanism, cite a source that actually addresses ovulation triggering, and verify its identifiers directly rather than accepting a search-engine suggestion.

**Adversarial verdict:** CONFIRMED — STEP 1 (quote check): current_value appears verbatim in terms-part-III.json under slug hcg-trigger, with the sup markup '<sup class="cite-ref"><a href="#ref-122">122</a></sup>' immediately following. STEP 2 (independent re-derivation): I pulled the full abstract of ref 122 from NCBI efetch rather than relying on the reviewer's characterisation. PMID 1530028 = Fritz MA, Hess DL, Patton PE. Am J Obs

**Corrected fix:** The reviewer's diagnosis is correct and their caution about verifying identifiers is correct. Two additions. (1) DO NOT REPOINT REF 122 IN PLACE. I checked blast radius: ref 122 is cited by 2 terms (hcg-trigger x3 and corpus-luteum x1). Per the skill's hard rule at cross-term count >= 2, mint a new ref instead. Concretely: leave ref 122 attached ONLY to the post-ovulatory corpus luteum sentence in

---

### `hcg-trigger` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#60**

**Current:** Named methods in restorative reproductive medicine, including NaProTechnology, use hCG selectively for documented ovulatory dysfunction: a delayed or absent endogenous LH surge, inadequate follicular response, or timing variability that makes natural intercourse less precise. [ref 60]

**Evidence:** Quenby S, Farquharson RG. Human chorionic gonadotropin supplementation in recurring pregnancy loss: a controlled trial. Fertil Steril. 1994.

**Suggested fix:** Ref 60 is a controlled trial of hCG supplementation in recurrent pregnancy loss, i.e. luteal-phase support, not ovulation triggering for ovulatory dysfunction. It is correctly applied to the next sentence about post-ovulatory hCG and corpus luteum function. For the ovulatory-dysfunction indication, cite ref 78 (Hilgers, The Medical and Surgical Practice of NaProTECHNOLOGY), which is the NaProTechnology source of record and is not currently cited in this term at all.

**Adversarial verdict:** CONFIRMED — Quoted text appears verbatim in the live body_html (modulo the anchor markup and the <sup> ref-60 citation). Ref 60 resolves in references.json to 'Quenby S, Farquharson RG. Human chorionic gonadotropin supplementation in recurring pregnancy loss: a controlled trial. Fertil Steril. 1994.' I located the paper myself on PubMed: PMID 7646609, Fertil Steril 1994 Oct;62(4):708-10, DOI 10.1016/s0015-028

**Corrected fix:** Keep the core of the fix: attach ref 78 (Hilgers, The Medical and Surgical Practice of NaProTECHNOLOGY) to the ovulatory-dysfunction sentence and remove ref 60 from it. Concept level only, no doses, no cycle-day timing. Tighten one point in the reviewer's rationale: Quenby 1994 gave hCG in early pregnancy to women with recurrent pregnancy loss, not in the early luteal phase of a treatment cycle, s

---

### `ldn` — mechanism_overclaim  ·  Part III

**Field:** `body_html`  ·  **ref#90**

**Current:** At low doses, transient opioid receptor blockade triggers a compensatory increase in the body's own endorphin production and modulates T-regulatory cell activity, reducing pro-inflammatory cytokines such as TNF-alpha and IL-6.

**Evidence:** In addition to the antagonist effect on mu-opioid and other opioid receptors, naltrexone simultaneously has an antagonist effect on non-opioid receptors (Toll-like receptor 4 or TLR4) that are found on macrophages such as microglia. It is via the non-opioid antagonist path that LDN is thought to exert its anti-inflammatory effects.

**Suggested fix:** The sentence omits the best-supported anti-inflammatory mechanism (TLR4 antagonism on microglia and macrophages) and states T-regulatory cell modulation as established when it is hypothesised. The cytokine claim is supportable but runs through peripheral macrophages, not Tregs. Rewrite as: 'At low doses, naltrexone acts both as a transient opioid receptor antagonist, prompting a compensatory rise in endogenous endorphins, and as an antagonist at Toll-like receptor 4 on microglia and macrophages; the latter pathway is the one most associated with reduced pro-inflammatory cytokines such as TNF-alpha and IL-6.' Also swap the citation: ref 90 is Younger's fibromyalgia crossover RCT, a clinical o

**Adversarial verdict:** CONFIRMED — STEP 1 (quote check): current_value appears verbatim in terms-part-III.json under slug ldn. STEP 2 (independent re-derivation): I did NOT take the reviewer's evidence quote on trust. I fetched PMC3962576 directly (HTTP 200) and found the quoted sentences verbatim at offset 10033 of the de-tagged text. I then verified the paper's identity independently via NCBI esummary/efetch on PMID 24526250: You

**Corrected fix:** Adopt the reviewer's rewrite with two corrections, one of which prevents a real regression. (1) THE REVIEWER'S 'swap the citation' INSTRUCTION IS UNSAFE AS WRITTEN. I checked blast radius: ref 90 is cited by 2 terms (ldn x2 and clinical-endorphin-deficiency x1). The skill's hard rule is that at cross-term count >= 2 you mint a NEW ref rather than repoint in place, otherwise the swap silently rewri

---

### `napro-surgery` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#80**

**Current:** Published outcomes from the development of this technique documented mean adhesion scores dropping from 33.3 to 6.0 over a decade of protocol refinement, measured using standardized pelvic adhesion scoring.

**Evidence:** Using the American Fertility Society scoring system for adnexal adhesions, the total adhesion score decreased from 33.8 to 18.1 in phase I, from 33.3 to 6.0 in phase II, and from 33.2 to 2.5 in phase III.

**Suggested fix:** The numbers are real but the sentence misdescribes what they measure. 33.3 to 6.0 is a within-phase pre-operative to second-look-laparoscopy reduction in phase II (1994-2005), not an improvement accumulated 'over a decade of protocol refinement'. The across-phase progression is 18.1 to 6.0 to 2.5. Two further defects: (a) the source calls it a 'total adhesion score', not a 'mean' score (it separately notes a mean of 3.0 per adnexa); (b) citing phase II understates the result, since phase III achieved 33.2 to 2.5. Rewrite as: 'In the phase III protocol, total American Fertility Society adnexal adhesion scores in patients with extensive adhesive disease fell from 33.2 pre-operatively to 2.5 at

**Adversarial verdict:** CONFIRMED — current_value appears verbatim in body_html. Core claim independently re-derived and upheld against the primary full text (R2 copy in the RRM library, record recw0LH4Hnt4ByntA) and corroborated by an independent Perplexity retrieval of the article PDF. The 33.3 to 6.0 pair is a pre-operative to second-look-laparoscopy change inside phase II (1994-2005), measured roughly ten days apart in the same 

**Corrected fix:** Core defect confirmed, but two sub-claims in the proposed fix are wrong and must be dropped. (a) 'mean' is not an error. The paper's own Results text reads 'phase I (total AFS mean, 18.1) and phase II (total AFS mean, 6.0)'. The missing words are 'total adnexal', not 'mean'. (b) The paper states no 'mean of 3.0 per adnexa' anywhere. The strings 'per adnexa' and '3.0' do not occur in the full text;

---

### `sympto-hormonal-method` — factual_error  ·  Part III

**Field:** `body_html`  ·  **ref#134**

**Current:** using the Clearblue Fertility Monitor to generate daily LH and E1G readings that are charted alongside physical observations

**Evidence:** The Clearblue Fertility Monitor ([CBFM]...) is a hand-held electronic hormonal fertility monitor that estimates a woman's fertile window by identifying a threshold level of the urine metabolites of estrone-3-glucuronide (E3G) and LH and provides the user with a reading of 'low,' 'high,' and 'peak' fertility.

**Suggested fix:** Two device facts are wrong. (1) The monitor does not output hormone readings; it outputs a Low/High/Peak fertility status, and that status, not an LH or E3G value, is what Marquette users chart. (2) Testing is not daily; the monitor prompts for tests on selected days within a testing window. Rewrite as: 'using the Clearblue Fertility Monitor, which detects urinary estrone-3-glucuronide (E3G) and LH on monitor-prompted test days and displays a Low, High or Peak fertility reading that is charted alongside physical observations.'

**Adversarial verdict:** CONFIRMED — STEP 1 (quote check): the current_value appears verbatim in terms-part-III.json under slug sympto-hormonal-method: 'using the Clearblue Fertility Monitor to generate daily LH and E1G readings that are charted alongside physical observations.<sup class="cite-ref"><a href="#ref-134">134</a></sup>'. STEP 2 (independent re-derivation, NOT taken from the prior reviewer): I fetched PMC9960263 directly (

**Corrected fix:** Keep the substance of the reviewer's rewrite but fix three things. (1) Drop 'testing is not daily' as a ground -- the monitor does give a daily fertility reading; the bounded thing is the urine test count (max 20 per cycle, never before cycle day 6). The single defect is that the monitor outputs a fertility status, not hormone values, and the status is what Marquette users chart. (2) Do NOT introd

---

### `cd138` — threshold_overstated  ·  Part IV

**Field:** `body_html`

**Current:** Diagnostic thresholds vary by laboratory, but most published protocols flag one or more CD138-positive plasma cells per high-power field as abnormal.

**Evidence:** Diagnostic thresholds vary by laboratory, but most published protocols flag one or more CD138-positive plasma cells per high-power field as abnormal.

**Suggested fix:** The stated cutoff is an order of magnitude stricter than the common published definitions and the 'most published protocols' claim is not carried by the literature. Rewrite as: 'Diagnostic thresholds are not standardized. Commonly published definitions range from at least one CD138-positive plasma cell per 10 or 20 high-power fields to higher cutoffs such as five per 10 high-power fields, and studies differ on which cutoff is clinically meaningful.' Keep the sentence at concept level rather than committing the glossary to one lab's number.

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-IV.json. I re-derived this independently rather than trusting the prior reviewer, and the finding holds on both of its parts. (1) The numeric criterion is wrong. I pulled McQueen DB et al., Fertil Steril 2021;116(3):855-861 (PMID 34120737, DOI 10.1016/j.fertnstert.2021.04.036, confirmed to resolve to Elsevier S0015028221004192), the paper that actually propose

**Corrected fix:** The prior reviewer's rewrite is directionally right but contains an unverified '>=1 per 20 high-power fields' definition and omits the single most important nuance, McQueen's stromal-changes requirement. Use instead: 'Diagnostic thresholds are not standardized and there is currently no accepted consensus definition. Published criteria range from one or more plasma cells per 10 high-power fields, w

---

### `era` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#25**

**Current:** An earlier observational study (ref-25) reported improved outcomes in a retrospective cohort with recurrent implantation failure.

**Evidence:** An earlier observational study (ref-25) reported improved outcomes in a retrospective cohort with recurrent implantation failure.

**Suggested fix:** ref-25 is 'The study on the clinical efficacy of endometrial receptivity analysis' in Scientific Reports, URL s41598-025-91745-y, i.e. a 2025 publication. It is not 'earlier' than the 2022 JAMA RCT; it postdates it by three years. This inverts the evidence chronology the paragraph is built on. Either swap in a genuinely earlier observational study (the Ruiz-Alonso 2013 era of ERA validation work) after registry-verifying its identifier, or rewrite as 'A later retrospective cohort in patients with recurrent implantation failure reported improved outcomes' and keep the argument that observational findings in selected populations cannot generalize.

**Adversarial verdict:** CONFIRMED — Re-derived independently. The sentence appears verbatim in body_html, including the broken literal '(ref-25)' placeholder, which I also confirmed is rendering as raw text on the live page (grep of live.html returns 'an earlier observational study (ref-25) reported improved outcomes'). So the term ships a visibly unrendered citation token in production, a defect the prior reviewer quoted but did no

**Corrected fix:** Fix both defects in one edit. Replace the sentence with: 'A later retrospective analysis of 3605 patients with prior failed transfer, of whom 782 received receptivity-guided personalized transfer, reported higher clinical pregnancy and live birth rates, most strongly in the recurrent implantation failure subgroup.[ref-25] Observational findings in selected populations cannot establish that ERA wor

---

### `follicle-development` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#111**

**Current:** That is how a deficiency in the follicular phase produces luteal phase deficiency even in a cycle that appeared ovulatory on a basal body temperature chart.[ref-111]

**Evidence:** A follicle that does not reach adequate size before rupture produces a less mature oocyte and a smaller corpus luteum. A smaller corpus luteum means lower progesterone output across the luteal phase. That is how a deficiency in the follicular phase produces luteal phase deficiency even in a cycle that appeared ovulatory on a basal body temperature chart.

**Canon:** Grunfeld L et al., Fertil Steril 1989;52(6):919-23, PMID 2591570

**Suggested fix:** ref-111 is Grunfeld L et al., 'Luteal phase deficiency after completely normal follicular and periovulatory phases' (Fertil Steril 1989). The paper's entire point is that luteal phase deficiency occurs AFTER normal follicular and periovulatory phases, which is the converse of the sentence it is attached to. Two options: (a) keep the follicular-deficiency mechanism and cite an RRM source that establishes it (Hilgers NaProTECHNOLOGY Ch. 21, the endocrine validation chapter, is in the RRM library and correlates ovulation defects with progesterone output), or (b) add Grunfeld correctly as the counterpoint: 'luteal deficiency can also arise after an entirely normal follicular phase.'

**Adversarial verdict:** CONFIRMED — Quote check: PASSES. The sentence and its trailing sup marker to ref-111 appear verbatim in follicle-development. references.json ref_num 111 = "Grunfeld L et al. Luteal phase deficiency after completely normal follicular and periovulatory phases. Fertil Steril. 1989." mapped to https://pubmed.ncbi.nlm.nih.gov/2591570/. I verified the identifier myself rather than trusting the registry entry: NCBI

**Corrected fix:** Take option (a) as the primary fix, and option (b) only as an optional added sentence. Re-anchor the mechanism sentence to Hilgers TW, The Medical and Surgical Practice of NaProTECHNOLOGY, Chapter 21 (Disorders of Human Ovulation: Endocrine Validation of the Sonographic Classification System), which is in the RRM library (rrm-cli slug chapter-21-disorders-of-human-ovulation-endocrine-validation-of

---

### `follicle-development` — wrong_count  ·  Part IV

**Field:** `body_html`

**Current:** The sonographic ovulation classification system identifies six additional ovulatory disorder patterns beyond LUF.

**Evidence:** The sonographic ovulation classification system identifies six additional ovulatory disorder patterns beyond LUF.

**Canon:** rrm-cli chapter-20: II. Anatomically Abnormal Ovulation lists A. Mature Follicle with Absent or Retained Cumulus, B. Luteinized Unruptured Follicle, C. Immature Follicle, D. Partial Rupture, E. Delayed Rupture, F. Afollicularism

**Suggested fix:** Hilgers Ch. 20 defines one normal category plus SIX abnormal categories in total, and LUF is one of the six. So there are FIVE additional disorder patterns beyond LUF, not six. Change to 'five additional ovulatory disorder patterns beyond LUF'. This error is inherited from the sonographic-ovulation-classification term, which inflates the category count by splitting the absent-cumulus category in two; fix both together.

**Adversarial verdict:** CONFIRMED — Quote check: PASSES. Stripped of the xref anchor, follicle-development reads "The sonographic ovulation classification system identifies six additional ovulatory disorder patterns beyond LUF." I did not take the canon_reference on trust; I pulled Hilgers Chapter 20 in full from the RRM library via rrm-cli (slug chapter-20-disorders-of-human-ovulation-sonographic-classification-system, pp. 259-268)

**Corrected fix:** Apply the filed fix in follicle-development: "six additional ovulatory disorder patterns beyond LUF" becomes "five additional ovulatory disorder patterns beyond LUF". Then fix sonographic-ovulation-classification in THREE places, not one, and ship them together: (1) the bolded lede "six distinct pathological patterns and one anovulatory variant" becomes "five distinct pathological patterns and one

---

### `laparoscopy-diagnostic` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#127**

**Current:** Surgeons using near-contact and close-approach techniques report higher recognition of subtle or atypical implants compared with standard distance.[ref-127]

**Evidence:** Surgeons using near-contact and close-approach techniques report higher recognition of subtle or atypical implants compared with standard distance.

**Canon:** rrm-cli chapter-63-diagnostic-laparoscopy-near-contact-approach

**Suggested fix:** ref-127 is Nezhat C et al., The Prevalence of Endometriosis in Patients with Unexplained Infertility (J Clin Med 2024). I read the full text held in the RRM library: it is a retrospective cross-sectional prevalence study of 215 patients and contains no discussion of near-contact technique, camera working distance or magnification comparison. Replace with the in-library primary source that does carry this claim: Hilgers TW, NaProTECHNOLOGY Ch. 63, which reports repeat laparoscopy in 46 patients with previously normal laparoscopies using near-contact technique (2-3 cm versus 15-20 cm), 89.1% found to have missed endometriosis.

**Adversarial verdict:** CONFIRMED — Independently re-derived, not taken from the prior reviewer. The sentence appears verbatim in body_html with a single ref-127 cite. I registry-verified ref-127 via PubMed esummary: PMID 38256580, Nezhat C, Khoyloo F, Tsuei A, Armani E et al., The Prevalence of Endometriosis in Patients with Unexplained Infertility, J Clin Med 2024;13(2):444, DOI 10.3390/jcm13020444. I then pulled the full text hel

**Corrected fix:** Drop ref-127 from this sentence. Do NOT ship the suggested fix verbatim: I could not confirm the '89.1%' or the '2-3 cm versus 15-20 cm' figures. The in-library Hilgers Ch. 63 record (rec9PGFQZ7QYjGvLC, 'Chapter 63: Diagnostic Laparoscopy: "Near Contact" Approach', Hilgers TW 2004, pp. 845-854) has body = null, metadata and insights only, consistent with the standing NaPro-textbook-chapters-metada

---

### `ovarian-reserve` — unverified_statistic  ·  Part IV

**Field:** `body_html`  ·  **ref#77**

**Current:** In documented low-DHEA-S cases, a meta-analysis of 8 studies found DHEA supplementation significantly raised AMH in women with diminished ovarian reserve.[ref-77]

**Evidence:** In documented low-DHEA-S cases, a meta-analysis of 8 studies found DHEA supplementation significantly raised AMH in women with diminished ovarian reserve.

**Suggested fix:** Two defects in one sentence. First, the study count: Perplexity reports the DHEA subgroup of ref-77 pooled 5 studies, not 8; I could not independently confirm the exact count without opening the paper, so verify against Yin 2022 before republishing any number, and if in doubt drop the count entirely ('a meta-analysis found'). Second, the qualifier 'In documented low-DHEA-S cases' is not a restriction the meta-analysis applied and should be removed. Third, align with the amh term by adding the RCT-subset hedge. Rewrite as: 'A meta-analysis found DHEA supplementation was associated with higher serum AMH in women with diminished ovarian reserve, with a weaker effect in the randomized subset.'

**Adversarial verdict:** CONFIRMED — Quote check: PASSES. "Vitamin D deficiency suppresses AMH and is correctable with repletion." appears verbatim in the third paragraph of ovarian-reserve in /tmp/glossary-review/terms-part-IV.json, uncited (the only sup marker in that paragraph is ref-77, attached to the later DHEA sentence). Not a consensus_conflict: no RRM positional canon is at stake, and RRM's OWN library holds the counter-evid

**Corrected fix:** Do not keep this in the list of correctable contributors to declining reserve, because that framing fails even on the evidence most favourable to vitamin D. Replace the sentence with: "Vitamin D status belongs in the workup on general health grounds. Repletion has not been shown to raise AMH: pooled randomized evidence across 11 trials in 992 women found no significant effect, and in PCOS suppleme

---

### `peak-plus-series` — protocol_leak  ·  Part IV

**Field:** `name`

**Current:** Targeted Post-Peak Progesterone Series (Peak +3, +5, +7, +9, +11)

**Evidence:** Targeted Post-Peak Progesterone Series (Peak +3, +5, +7, +9, +11)

**Canon:** RRM canon: no public protocols or dosings; cycle-day timing such as P+3 through P+12 must be rewritten at concept level

**Suggested fix:** The term NAME publishes the exact Hilgers draw schedule as a cycle-day list. The body is disciplined and stays at concept level ('Draws are obtained across both the early and late post-Peak phase'), which makes the title the only leak. Rename to 'Targeted Post-Peak Progesterone Series' and, if a parenthetical is wanted for search, use a non-protocol descriptor such as '(Serial Post-Peak Progesterone Profile)'. Check the glossary index, any internal anchors and the abbreviations table for the old string before renaming.

**Adversarial verdict:** CONFIRMED — Quote check passes: terms-part-IV.json peak-plus-series has name exactly 'Targeted Post-Peak Progesterone Series (Peak +3, +5, +7, +9, +11)' (programmatic string equality, True). I re-derived the substance rather than accepting the reviewer's assertion. The parenthetical is not a generic descriptor, it is the verbatim Hilgers draw schedule: rrm-cli chapter-21-disorders-of-human-ovulation-endocrine

**Corrected fix:** Rename to 'Peak Plus Series (Targeted Post-Peak Progesterone Series)'. Do not use the reviewer's '(Serial Post-Peak Progesterone Profile)' parenthetical, it merely restates the head noun and adds no retrieval value. 'Peak Plus Series' is the label the term's own opening sentence uses ('The Peak Plus Series is a NaProTechnology and Creighton Model protocol...'), it matches the slug, and it matches 

---

### `transcervical-catheterization` — overstated_claim  ·  Part IV

**Field:** `body_html`  ·  **ref#84**

**Current:** Published series report that the majority of proximally obstructed tubes can be reopened following catheterization.

**Evidence:** Published series report that the majority of proximally obstructed tubes can be reopened following catheterization.

**Canon:** Hilgers TW, Yeung PP Jr. Intratubal pressure before and after transcervical catheterization of the fallopian tubes. Fertil Steril 1999: 'The ITP was normalized in 76% of partially obstructed tubes and in 29.5% of completely obstructed tubes. In all cases of complete obstruction in which surgical cor

**Suggested fix:** Uncited, and the foundational study for this procedure does not support it as stated. Hilgers and Yeung 1999 (ref-84, full text held in the RRM library) reports that intratubal pressure normalized in 76% of PARTIALLY obstructed tubes but in only 29.5% of COMPLETELY obstructed tubes. An unqualified 'majority of proximally obstructed tubes' is therefore true only for partial obstruction and false for complete obstruction, which is precisely the distinction the rest of this term is built on. Rewrite as: 'Most partial proximal obstructions can be cleared by catheterization, while complete obstructions respond far less often and usually reflect organic pathology.' That is exactly what the study c

---

### `microsurgery` — citation_mismatch  ·  Part V

**Field:** `body_html`  ·  **ref#184**

**Current:** A 2023 systematic review and meta-analysis reported pregnancy rates following microsurgical tubal anastomosis comparable to those seen with other reconstructive approaches.

**Evidence:** A 2023 systematic review and meta-analysis reported pregnancy rates following microsurgical tubal anastomosis comparable to those seen with other reconstructive approaches.

**Canon:** RRM canon: never soften restorative outcome claims. Here the glossary is under-claiming a verified favourable finding.

**Suggested fix:** The cited paper makes no comparison to 'other reconstructive approaches'; it compares surgical ROUTES (laparotomy vs laparoscopy vs robotic) within microsurgical anastomosis and finds no difference between them. As written the citation does not support the sentence. Replace with the paper's actual headline: 'A 2023 systematic review and meta-analysis of microsurgical tubal anastomosis reported a pooled pregnancy rate of 65.3% (95% CI 61.0-69.6) and a live birth rate of 42.6%, with no difference in outcomes between laparotomy, laparoscopy and robotic-assisted approaches.' The same paper also reports that reversal is more favourable than IVF in women over 35, which is directly on-canon and is 

**Adversarial verdict:** CONFIRMED — Quote check passes: 'A 2023 systematic review and meta-analysis reported pregnancy rates following microsurgical tubal anastomosis comparable to those seen with other reconstructive approaches.' appears verbatim with a ref-184 superscript attached. I fetched the Sastre 2023 abstract directly from NCBI. The paper runs two comparisons and neither is the one the glossary implies. It compares access R

**Corrected fix:** Use: 'A 2023 systematic review and meta-analysis of microsurgical tubal anastomosis pooled 22 studies and over 14,113 patients, reporting a pregnancy rate of 65.3% (95% CI 61.0 to 69.6) and a live birth rate of 42.6% (95% CI 34.9 to 51.4), with no difference in outcomes between laparotomy, laparoscopy, and robotic-assisted routes. In the same analysis, reversal compared favorably with in vitro fer

---

### `adenomyosis` — citation_mismatch  ·  Part VI-A

**Field:** `body_html`  ·  **ref#48**

**Current:** A meta-analysis found women with adenomyosis had a 28% lower probability of clinical pregnancy and more than twice the odds of miscarriage (OR 2.17) compared to women without the condition.<sup class="cite-ref"><a href="#ref-48">48</a></sup>

**Evidence:** In a systematic review, pregnancy rates were reported to be lower in patients with adenomyosis when compared to women undergoing ART for different reasons, OR (odds ratio) 0.69 (95% confidence interval: 0.51-0.94), while higher miscarriage rates were noted, OR 2.17 (95% confidence interval: 1.25-3.79)

**Suggested fix:** The sentence attributes two figures to one meta-analysis via ref 48, but ref 48 reports OR 0.69 for pregnancy, not a 28% reduction; I retrieved the full text of ref 48 (PMC11355825, Kim H, Frisch EH, Falcone T, J Clin Med 2024) and the string '28%' does not appear anywhere in it. The 28% figure belongs to a different meta-analysis: Vercellini P et al, 'Uterine adenomyosis and in vitro fertilization outcome: a systematic review and meta-analysis', Hum Reprod 2014, PMID 24622619, whose abstract states verbatim 'women with adenomyosis had a 28% reduction in the likelihood of clinical pregnancy at IVF/ICSI' with 'a common RR of 2.12 (95% CI, 1.20-3.75)' for miscarriage. Fix either by reporting r

**Adversarial verdict:** CONFIRMED — Quote check passed: the sentence appears verbatim in terms-part-VI-A.json. I re-derived the claim independently rather than accepting the reviewer's chain. I fetched ref 48 (https://pmc.ncbi.nlm.nih.gov/articles/PMC11355825/), stripped it to plain text, and ran literal string counts: '28%' occurs 0 times; the only odds ratios in the paper are in one sentence reading 'In a systematic review, pregna

**Corrected fix:** Split the conflated attribution rather than rewriting the clinical content, which is accurate. Replace with: 'One meta-analysis found women with adenomyosis had a 28% lower probability of clinical pregnancy at IVF/ICSI compared to women without the condition;<sup class="cite-ref"><a href="#ref-49">49</a></sup> a second meta-analysis found more than twice the odds of miscarriage (OR 2.17, 95% CI 1.

---

### `adenomyosis` — clinical_accuracy  ·  Part VI-A

**Field:** `body_html`  ·  **ref#48**

**Current:** <strong>Focal adenomyosis</strong> presents differently. It includes adenomyomas, which are mass-like lesions that can mimic fibroids on imaging, and cesarean-scar defects (<a href="/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/">isthmocele</a>) where endometrial-like tissue grows into the uterine scar.

**Evidence:** An <a href="/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/">isthmocele</a> (also called a cesarean scar defect or uterine niche) is a myometrial deficiency at the anterior wall of the lower uterine segment, occurring at the site of a prior cesarean scar where the uterine wall failed to heal with full thickness.

**Suggested fix:** This term classifies isthmocele as a form of focal adenomyosis, which contradicts the glossary's own isthmocele term (quoted above, same part), is unsupported by ref 48 (its full text never mentions cesarean scar or niche), and conflicts with standard definitions. Rewrite as: 'Focal adenomyosis includes adenomyomas, mass-like lesions that can mimic fibroids on imaging. Focal adenomyotic change can also arise within a cesarean scar, which is distinct from an isthmocele, the healing defect itself.' Keep the isthmocele link but change the framing from identity to co-occurrence.

**Adversarial verdict:** CONFIRMED — Quote check passed: the sentence appears verbatim in the file, as does the reviewer's counter-quote from the isthmocele term in the same part. I tried to refute this one hard, because 'cesarean scar adenomyosis' is a genuinely described entity and I expected the finding to collapse into a terminology quibble. It does not. Three independent checks all fail to support the glossary's identity claim. 

**Corrected fix:** Adopt the reviewer's rewrite with one addition: state the relationship that the sources actually support, which is risk factor plus possible co-location, and cite ref 49 for it since ref 49 carries exactly that claim. Suggested text: '<strong>Focal adenomyosis</strong> presents differently. It includes adenomyomas, which are mass-like lesions that can mimic fibroids on imaging. Prior uterine surge

---

### `infertility` — citation_mismatch  ·  Part VI-A

**Field:** `body_html`  ·  **ref#35**

**Current:** The goal is diagnosis followed by correction, not bypass. A <a href="#comprehensive-evaluation" class="gloss-xref">comprehensive evaluation</a> in RRM maps the cause before any treatment begins.<sup class="cite-ref"><a href="#ref-35">35</a></sup>

**Evidence:** 35: The Impact of Oxidative Stress in Male Infertility. | J:PMC / NIH | https://pmc.ncbi.nlm.nih.gov/articles/PMC8766739/

**Suggested fix:** Reference 35 is a male-factor oxidative-stress paper. It cannot support a claim about the scope and sequencing of an RRM comprehensive evaluation. Re-point this citation to an RRM evaluation source already in the glossary reference set (e.g. ref 290 iNEST methods, or the Stanford 2021 comprehensive-evaluation paper used elsewhere in the glossary), or move ref 35 up to the male-factor paragraph where it is topically relevant.

**Adversarial verdict:** CONFIRMED — Quote check passes: the current_value string appears literally in terms-part-VI-A.json under slug 'infertility' (final paragraph). Independent re-derivation: ref 35 resolves to PMID 35071326 (verified myself via NCBI esummary AND efetch, not via Perplexity) = Mannucci A, 'The Impact of Oxidative Stress in Male Infertility', Frontiers in Molecular Biosciences 2021;8:799294, PMC8766739. Its own abst

**Corrected fix:** Re-anchor to ref 3, which I verified is PMID 34233646 = Stanford JB et al., 'Restorative reproductive medicine for infertility in two family medicine clinics in New England, an observational study', BMC Pregnancy and Childbirth 2021;21:495 (PMC8265110). Ref 3 is already the anchor on the glossary's own 'comprehensive-evaluation' term, so this keeps the two terms citing the same source for the same

---

### `luf-syndrome` — citation_mismatch  ·  Part VI-A

**Field:** `body_html`  ·  **ref#3**

**Current:** LUF syndrome is a clinically underappreciated contributor to infertility that goes undetected without serial ultrasound monitoring across the cycle.<sup class="cite-ref"><a href="#ref-3">3</a></sup> ... Diagnosis requires sonographic confirmation. Serial follicle tracking documents the growth of the dominant follicle to expected mature size, followed by signs of luteinization such as increased echogenicity and structural change within the follicle wall, without the collapse and fluid release that accompanies true rupture.<sup class="cite-ref"><a href="#ref-3">3</a></sup>

**Evidence:** For example, in the Irish group, follicular ultrasound tracking was used routinely, whereas it was rarely used in these New England practices.

**Suggested fix:** Reference 3 is the term's ONLY citation and it carries both the definition and the entire sonographic-diagnosis paragraph, but it is an RRM clinic outcomes paper that never discusses LUF. I retrieved its full text (PMC8265110, 40,878 characters) and searched it: 'unruptured' appears 0 times, 'LUF' appears 0 times, 'serial' appears 0 times, and its only relevant sentence says follicular ultrasound tracking was rarely used in the studied practices. Replace with primary LUF literature (the classic ultrasound-based LUF descriptions and modern serial-monitoring series) and verify each PMID directly against PubMed before adding it. Do not accept an AI-supplied citation here without that check.

**Adversarial verdict:** CONFIRMED — I re-derived this rather than accepting the prior reviewer's word. Both quoted glossary sentences appear verbatim in /tmp/glossary-review/terms-part-VI-A.json, slug luf-syndrome, and ref 3 is confirmed as the term's ONLY citation (it appears twice, terminating the definitional paragraph and the sonographic-diagnosis paragraph; the rest of the term is uncited). references.json ref_num 3 = 'Restorat

**Corrected fix:** The prior reviewer's direction is right but supplies no replacement sources, so here are two I verified myself against NCBI efetch (do not add either without re-checking, and do not accept AI-supplied author/PMID pairings for this term). PMID 16613885 is the best fit and should carry the sonographic-diagnosis and intermittency claims: Qublan H, Amarin Z, Nawasreh M, et al. 'Luteinized unruptured f

---

### `luteal-phase-deficiency` — protocol_leak  ·  Part VI-A

**Field:** `body_html`  ·  **ref#276**

**Current:** The Peak+3 progesterone level confirms ovulation and establishes early luteal function.<sup class="cite-ref"><a href="#ref-276">276</a></sup>

**Evidence:** The Peak+3 progesterone level confirms ovulation and establishes early luteal function.

**Canon:** NO PUBLIC PROTOCOLS OR DOSINGS: cycle-day timing like P+3 through P+12 must be flagged and rewritten at concept level.

**Suggested fix:** Per the no-public-protocols rule, cycle-day timing of the P+3 through P+12 form must be rewritten at concept level: 'An early post-Peak progesterone draw confirms ovulation and establishes early luteal function; the timing is set by the clinician against the charted Peak Day.' Mitigating context for the human reviewer: this particular day marker appears verbatim in the title of the published source (Hilgers TW, 'The Identification of Postovulation Infertility with the Measurement of Early Luteal Phase (Peak Day +3) Progesterone Production', Linacre Q 2020, PMID 32431450 verified), so it is not textbook-internal. The decision is a policy call, not a factual one.

**Adversarial verdict:** CONFIRMED — Quote verified literally present in /tmp/glossary-review/terms-part-VI-A.json, slug luteal-phase-deficiency, second paragraph, with the <sup class="cite-ref"><a href="#ref-276">276</a></sup> attached exactly as reported. The canon rule enumerates 'cycle-day timing like P+3 through P+12' as an unconditional MUST-flag at P1 category protocol_leak; 'Peak+3' is literally the first member of that serie

**Corrected fix:** Apply the prior reviewer's sentence rewrite as written (it is factually accurate against PMID 32431450 and preserves meaning): 'An early post-Peak progesterone draw confirms ovulation and establishes early luteal function; the timing is set by the clinician against the charted Peak Day.' But scope it as a class sweep, not a one-line edit, per sweep-then-drain: the same marker class appears 14 time

---

### `pcos` — definition_error  ·  Part VI-A

**Field:** `body_html`  ·  **ref#94**

**Current:** Diagnosis requires two of three Rotterdam criteria: oligo- or anovulation, clinical or biochemical signs of hyperandrogenism (elevated androgens causing acne, hirsutism, or irregular cycles), and polycystic ovarian morphology on ultrasound.

**Evidence:** clinical or biochemical signs of hyperandrogenism (elevated androgens causing acne, hirsutism, or irregular cycles)

**Suggested fix:** Irregular cycles are the separate ovulatory-dysfunction criterion, not a clinical sign of hyperandrogenism, and they are already listed first in the same sentence. As written the sentence tells the reader that irregular cycles satisfy the hyperandrogenism criterion, which misstates the cited Rotterdam consensus (ref 94) and can produce a false two-of-three count. Change the parenthetical to '(elevated androgens causing acne, hirsutism, or androgenic hair loss)'.

**Adversarial verdict:** DOWNGRADE — Quote check passes: the current_value appears literally in the pcos term. The underlying defect is real, but P0 overstates it. Real part: the sentence enumerates the Rotterdam two-of-three criteria and lists 'irregular cycles' inside the parenthetical gloss on the hyperandrogenism criterion, while 'oligo- or anovulation' is already criterion one in the same sentence. I verified against the actual 

**Corrected fix:** Change the parenthetical to '(elevated androgens causing acne, hirsutism, or scalp hair thinning)'. This matches the criterion triad in the cited consensus and the international guideline (acne, alopecia, hirsutism) and removes the double-count. Prefer 'scalp hair thinning' over the finding's 'androgenic hair loss', which is jargon-heavy for a patient-facing glossary and reads harsher than needed 

---

### `pcos-phenotypes` — citation_mismatch  ·  Part VI-A

**Field:** `body_html`  ·  **ref#94**

**Current:** Phenotype identification matters because treatment response varies substantially across subtypes. Phenotypes A and B tend to require insulin sensitization and metabolic correction before ovulatory function stabilizes. Phenotype C may respond to targeted hormonal support without a full metabolic workup. Phenotype D often responds to ovulation support with less aggressive intervention.<sup class="cite-ref"><a href="#ref-94">94</a></sup>

**Evidence:** 94: Revised 2003 consensus on diagnostic criteria and long-term health risks related to polycystic ovary syndrome (PCOS) | J:Human Reproduction | https://pubmed.ncbi.nlm.nih.gov/14688154/

**Suggested fix:** An entire paragraph of phenotype-specific treatment-response guidance is anchored to a 2003 diagnostic-criteria consensus that contains no treatment-response content. Worse, 'Phenotype C may respond to targeted hormonal support without a full metabolic workup' tells a reader that a hyperandrogenic phenotype can skip metabolic assessment, which runs against consensus that metabolic screening should not be stratified by ovarian morphology. Either cite phenotype-stratified outcome literature for each sentence, or rewrite as an explicitly clinical-judgment paragraph and delete the 'without a full metabolic workup' clause.

**Adversarial verdict:** CONFIRMED — Quote check: the prose of current_value appears verbatim, but the finding misplaces the citation marker. In the actual body_html one further sentence intervenes ('Treating every PCOS presentation identically, without phenotyping, is how patients cycle through years of management without meaningful resolution.') before the ref-94 sup. That is an elision, not a material misquote, and it does not cha

**Corrected fix:** Delete the clause 'without a full metabolic workup' outright rather than leaving it to be re-cited. Then either (a) drop the ref-94 marker from this paragraph and reframe the block explicitly as clinical judgment, since neither cited reference (94, Rotterdam 2003 diagnostic criteria; 39, StatPearls, which describes seven phenotypes A to G, not four A to D) contains phenotype-stratified treatment-r

---

### `ashermans-syndrome` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#51**

**Current:** Post-surgical hormonal support to promote endometrial regrowth and follow-up office hysteroscopy are standard components of the restorative approach.<sup class="cite-ref"><a href="#ref-51">51</a></sup>

**Evidence:** Post-surgical hormonal support to promote endometrial regrowth and follow-up office hysteroscopy are standard components of the restorative approach.

**Suggested fix:** Reference 51 is Mitter et al., AJRI 2021, a chronic-endometritis antibiotic-treatment cohort. It contains nothing about adhesiolysis, post-adhesiolysis estrogen therapy, or second-look hysteroscopy for Asherman's. Swap for an adhesion-specific source (AAGL/ESGE intrauterine adhesions practice guideline, or extend ref 17 ACOG hysteroscopy committee opinion which does cover adhesiolysis). I have not independently confirmed a replacement URL, so the editor should select and verify it.

**Adversarial verdict:** CONFIRMED — Quote check PASSES: the sentence plus the <sup class="cite-ref"><a href="#ref-51">51</a></sup> tag appears verbatim in the ashermans-syndrome body_html in terms-part-VI-B.json. Re-derived independently rather than trusting the prior reviewer: references.json maps ref 51 to https://onlinelibrary.wiley.com/doi/10.1111/aji.13482. I resolved that DOI against the CrossRef REST API (not Perplexity) and 

**Corrected fix:** The prior reviewer's direction is right but they explicitly declined to verify a replacement. I verified one. Use the AAGL/ESGE intrauterine adhesions practice guideline: J Minim Invasive Gynecol 2017, DOI 10.1016/j.jmig.2016.11.008, PMID 28473177 (both confirmed via CrossRef and PubMed efetch). Prefer citing the open-access co-published twin, Gynecological Surgery 2017, DOI 10.1186/s10397-017-100

---

### `azoospermia` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#274**

**Current:** Surgical and empirical treatments for NOA, including varicocele repair, lack validation from high-quality studies; the EAU 2021 guidelines cite insufficient evidence to support their widespread use in routine clinical practice.<sup class="cite-ref"><a href="#ref-359">359</a></sup><sup class="cite-ref"><a href="#ref-274">274</a></sup>

**Evidence:** Surgical and empirical treatments for NOA, including varicocele repair, lack validation from high-quality studies; the EAU 2021 guidelines cite insufficient evidence to support their widespread use in routine clinical practice.

**Canon:** NaProTechnology / restorative reproductive medicine positioning must not be hedged or described as fringe/unproven

**Suggested fix:** Reference 274 (Esteves 2016 meta-analysis) is cited in support of a sentence that says the opposite of what it concluded. Esteves found sperm in postoperative ejaculates in 43.9% of NOA men and concluded that men with NOA and clinical varicocele benefit from varicocelectomy, with the caveat that evidence is low to moderate quality. Rewrite so the citation matches: 'Varicocele repair in non-obstructive azoospermia has been associated with sperm returning to the ejaculate in roughly 44% of men in pooled analysis, on low to moderate quality evidence; the EAU 2021 guideline therefore does not endorse it as routine practice.' As currently written the entry leads with mainstream skepticism of the 

**Adversarial verdict:** CONFIRMED — Quote verified verbatim, including both sup tags. I tried hard to refute this one and instead found the reviewer UNDERSTATED it: the sentence misrepresents BOTH of its citations, not just ref 274.

Ref 274 verified by direct efetch (PMID 26680033, Esteves SC, Miyaoka R, Roque M, Agarwal A, Asian J Androl 2016;18:246). Its stated conclusion: 'In conclusion, the results of our study indicate that in

**Corrected fix:** The reviewer's replacement sentence must NOT be used as written: it introduces a fresh citation mismatch against ref 359. It asserts 'the EAU 2021 guideline therefore does not endorse it as routine practice', but EAU makes no recommendation for or against varicocele repair in NOA. EAU's 'not recommended routinely' language attaches to empirical MEDICAL therapy (FSH, hCG, aromatase inhibitors, SERM

---

### `chronic-endometritis` — protocol_leak  ·  Part VI-B

**Field:** `body_html`

**Current:** Treatment uses targeted antibiotics (typically doxycycline, amoxicillin, or based on culture).

**Evidence:** Treatment uses targeted antibiotics (typically doxycycline, amoxicillin, or based on culture).

**Canon:** NO PUBLIC PROTOCOLS OR DOSINGS: drug lists in the form Treatment includes X Y Z MUST be flagged P1 protocol_leak

**Suggested fix:** Named drug list in the 'treatment uses X, Y' form on a public page. Rewrite at concept level: 'Treatment is culture-directed or empiric antibiotic therapy prescribed by the treating clinician, with cure confirmed on repeat CD138 biopsy.' Drop the specific agent names.

**Adversarial verdict:** CONFIRMED — Quote check PASSES: appears verbatim in the chronic-endometritis body_html. The canon rule is explicit and mandatory, and the text matches its letter, not merely its spirit: a named drug list in the 'Treatment uses X, Y' construction on a public page. There are no mg amounts or schedules here, but the rule enumerates 'drug lists in the form Treatment includes X Y Z' as an independent trigger along

**Corrected fix:** CONFIRM the finding but DO NOT apply the reviewer's suggested_fix as written, because it introduces a fresh citation_mismatch while curing the protocol_leak. The proposed replacement ends 'with cure confirmed on repeat CD138 biopsy'. That clause is supported by NEITHER reference flanking the sentence. Ref 51 is Mitter et al. AJRI 2021 (DOI 10.1111/aji.13482, verified via CrossRef): it treated CD13

---

### `hyperprolactinemia` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#3**

**Current:** Prolactinoma is treated with dopamine agonists under appropriate clinical supervision.<sup class="cite-ref"><a href="#ref-3">3</a></sup>

**Evidence:** Prolactinoma is treated with dopamine agonists under appropriate clinical supervision.

**Suggested fix:** Reference 3 is 'Restorative reproductive medicine for infertility in two family medicine clinics in New England, an observational study' (BMC Pregnancy and Childbirth 2021), a 370-couple outcomes cohort. A full-text scan of the library record returns zero occurrences of 'dopamine', 'cabergoline' or 'bromocriptine'; its only prolactin content is a diagnosis-frequency table row, 'Elevated prolactin in female 18 (5)'. It cannot support a statement about prolactinoma pharmacotherapy. Re-point this sentence to ref 119, the Endocrine Society hyperprolactinemia clinical practice guideline, which is already in the reference list and is the correct authority.

**Adversarial verdict:** CONFIRMED — Quote check: the current_value appears verbatim in terms-part-VI-B.json, paragraph 2 of the hyperprolactinemia entry, superscript pointing to #ref-3. Ref identity: references.json ref_num 3 = 'Restorative reproductive medicine for infertility in two family medicine clinics in New England.' (BMC Pregnancy and Childbirth, PMC8265110). I independently resolved it on PubMed by title search to PMID 342

---

### `methylated-folate` — mechanism_error  ·  Part VI-B

**Field:** `body_html`

**Current:** Most prenatal vitamins and fortified foods supply synthetic folic acid, which requires a functional MTHFR enzyme to convert it into usable form.

**Evidence:** Most prenatal vitamins and fortified foods supply synthetic folic acid, which requires a functional MTHFR enzyme to convert it into usable form.

**Suggested fix:** Correct the pathway: folic acid is reduced by dihydrofolate reductase (DHFR) to dihydrofolate and then tetrahydrofolate; MTHFR acts only downstream, converting 5,10-methylenetetrahydrofolate to 5-MTHF, the methyl donor used to remethylate homocysteine. Reduced MTHFR activity therefore constrains the methylation arm of folate metabolism, not the ability to use folic acid at all. As written the sentence states a mechanism the biochemistry does not support and echoes a claim the CDC explicitly rebuts.

**Adversarial verdict:** DOWNGRADE — Quote check PASSES: appears verbatim in the methylated-folate body_html. The SUBSTANCE of the finding is CONFIRMED, and I re-derived it rather than accepting the prior reviewer's Perplexity excerpt. I retrieved NCBI Bookshelf NBK6561 (Molecular Biology of Methylenetetrahydrofolate Reductase) directly and it states MTHFR's step verbatim as quoted above: 5,10-methylene-THF to 5-methyl-THF. That step

**Corrected fix:** Apply the reviewer's biochemical correction, which is accurate, but with two guards they did not supply. GUARD 1, scope: fix the enzymology ONLY. Do not let the CDC quotation trigger deletion or hedging of the term's L-methylfolate recommendation. Whether MTHFR carriers should preferentially take 5-MTHF is a contested clinical-practice question where CDC and RRM practice diverge; that divergence i

---

### `unexplained-infertility` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#127**

**Current:** Stage I to II <a href="#endometriosis" class="gloss-xref">endometriosis</a> (present in up to 47% of women with unexplained infertility who undergo diagnostic laparoscopy),<sup class="cite-ref"><a href="#ref-127">127</a></sup>

**Evidence:** Stage I to II endometriosis (present in up to 47% of women with unexplained infertility who undergo diagnostic laparoscopy)

**Suggested fix:** Reference 127 (Nezhat et al, The Prevalence of Endometriosis in Patients with Unexplained Infertility, J Clin Med) reports, verbatim from its abstract: 'In a retrospective cross-sectional study involving 215 patients aged 25 to 45 with unexplained infertility, diagnostic laparoscopy was performed after unsuccessful reproductive technology attempts. Pathology results revealed tissue abnormalities in 98.6% of patients, with 90.7% showing endometriosis.' The 47% figure does appear in that paper but in its introduction, referring to a different denominator entirely: 'endometriosis affects 47% of patients seeking gynecological care'. The glossary has lifted the wrong number, attached a stage rest

**Adversarial verdict:** CONFIRMED — Quote check passed: the string 'Stage I to II <a href="#endometriosis" class="gloss-xref">endometriosis</a> (present in up to 47% of women with unexplained infertility who undergo diagnostic laparoscopy),<sup class="cite-ref"><a href="#ref-127">127</a></sup>' appears verbatim in terms-part-VI-B.json. Ref 127 identity independently verified twice: CrossRef on 10.3390/jcm13020444 returns 'The Preval

**Corrected fix:** Keep the substance, replace the citation. Ref 127 (Nezhat 2024, verified DOI 10.3390/jcm13020444 and PMID 38256580) supports neither the 47% figure nor the Stage I to II restriction: it reports 90.7% endometriosis in 215 women with a stage split of Stage I 2.4%, Stage II 31.6%, Stage III 24.5%, Stage IV 41.5%. Its 47% belongs to a different denominator ('patients seeking gynecological care'). The 

---

### `empty-follicle-syndrome` — definition_error  ·  Part VI-C

**Field:** `body_html`  ·  **ref#78**

**Current:** <strong>Empty Follicle Syndrome (EFS) is an ovulation disorder in which the dominant follicle reaches mature size and ruptures appropriately, yet no oocyte is recovered at the expected reproductive event.</strong>

**Evidence:** Empty Follicle Syndrome (EFS) is an ovulation disorder in which the dominant follicle reaches mature size and ruptures appropriately, yet no oocyte is recovered at the expected reproductive event.

**Canon:** Hilgers TW, Chapter 20 (ref 78), verbatim: 'When the dominant follicle is identified, the sonographer searches for internal echoes that may represent the cumulus oophorus. These echoes are found adjacent to the inner wall of the follicle' and 'The empty follicle is identified by the absence of the c

**Suggested fix:** The lead definition omits the actual diagnostic basis and substitutes IVF language. In a spontaneous unstimulated cycle nothing is 'recovered', so 'no oocyte is recovered at the expected reproductive event' is incoherent for the very setting the term says Hilgers extended it to. The source defines the empty follicle by the sonographic ABSENCE OF THE CUMULUS OOPHORUS confirmed in both longitudinal and transverse planes. Rewrite the lead as: 'Empty Follicle Syndrome is an ovulation disorder identified when serial ultrasound shows a developing follicle without a visible cumulus oophorus, the structure that carries the oocyte. The follicle may still grow and rupture on schedule while no ovum acc

**Adversarial verdict:** CONFIRMED — Quote check: the bolded lead sentence appears VERBATIM in the term's body_html, and it carries a <sup class="cite-ref"><a href="#ref-78">78</a></sup> marker. No misquote.

Ref 78 resolves in /tmp/glossary-review/references.json to 'Hilgers TW. The Medical and Surgical Practice of NaProTECHNOLOGY. Pope Paul VI Institute Press; 2004.' I read Chapter 20 in full and confirmed the reviewer's quotes ver

**Corrected fix:** Replace the bolded lead with:

<p><strong>Empty Follicle Syndrome (EFS) is an ovulation disorder identified when serial ultrasound shows a developing follicle with no visible cumulus oophorus, the small cell mass that carries the egg.</strong><sup class="cite-ref"><a href="#ref-78">78</a></sup> The finding is defined by what the scan shows rather than by an egg retrieval, and it can appear whether

---

### `endometrial-thickness` — citation_mismatch  ·  Part VI-C

**Field:** `body_html`  ·  **ref#87**

**Current:** Thickness below an adequate preovulatory range is associated with reduced implantation potential, though exact thresholds vary by population and cycle type.<sup class="cite-ref"><a href="#ref-87">87</a></sup>

**Evidence:** A trilaminar (three-layer) pattern in the preovulatory phase indicates coordinated estrogen stimulation of the endometrium. Thickness below an adequate preovulatory range is associated with reduced implantation potential, though exact thresholds vary by population and cycle type.

**Suggested fix:** Ref 87 is the ASRM 'Optimizing natural fertility: a committee opinion', which covers age, fertile-window timing, intercourse frequency, lifestyle and environmental exposures, and preconception supplements. It does not discuss endometrial thickness, the trilaminar pattern, or implantation thresholds, so it cannot support this sentence. Replace with a source that actually reports endometrial thickness and implantation outcomes (e.g. a receptivity/thickness systematic review) before republication. Do not reuse any Perplexity-supplied DOI without registry verification.

**Adversarial verdict:** CONFIRMED — Quote check passes: the current_value string appears verbatim in terms-part-VI-C.json under slug endometrial-thickness. Ref 87 resolved from references.json to the library record optimizing-natural-fertility-a-committee-opinion-rechyu5vnvihyqdwy, which rrm-cli confirms is PMID 28228319 / DOI 10.1016/j.fertnstert.2016.09.029, Fertil Steril 2017;107(1):52-58. I verified that PMID via NCBI efetch (it

**Corrected fix:** Keep the sentence's existing hedge ('exact thresholds vary by population and cycle type') and swap ref 87 for a source that actually measures thickness against outcome. Two candidates I verified against PubMed by fetching the records myself: (1) Kasius A, Smit JG, Torrance HL, Eijkemans MJ, Mol BW, Opmeer BC, Broekmans FJ. 'Endometrial thickness and pregnancy rates after IVF: a systematic review a

---

### `postpartum-fertility` — citation_mismatch  ·  Part VI-C

**Field:** `body_html`  ·  **ref#87**

**Current:** Cycle charting during the postpartum transition documents this return accurately, distinguishing true ovulatory cycles from anovulatory bleeding.<sup class="cite-ref"><a href="#ref-87">87</a></sup>

**Evidence:** A return of menstruation does not guarantee a return of ovulation, and the first ovulation frequently precedes the first visible bleed. Cycle charting during the postpartum transition documents this return accurately, distinguishing true ovulatory cycles from anovulatory bleeding.

**Suggested fix:** Ref 87 (ASRM 'Optimizing natural fertility: a committee opinion') does not address the postpartum period at all, so it cannot support a claim about charting the postpartum return of ovulation. Replace with a postpartum-specific source, for example the Bellagio/LAM consensus literature or a published breastfeeding-and-return-of-fertility cohort. This is the second term in this batch where ref 87 is attached to a claim outside its scope, so audit every other use of ref 87 across the whole glossary.

**Adversarial verdict:** CONFIRMED — Quote check passes: the current_value appears verbatim in terms-part-VI-C.json under slug postpartum-fertility. Same ref 87 as the endometrial-thickness finding, same verified target (ASRM Optimizing natural fertility, Fertil Steril 2017;107(1):52-58, PMID 28228319 confirmed via NCBI efetch). Working from the actual 2017 PDF text I extracted, the scope exclusion is even starker than for thickness:

**Corrected fix:** The prior suggested_fix is partly off-target and would introduce a second mismatch: it proposes 'the Bellagio/LAM consensus literature' as the replacement, but LAM sources support the lactational-amenorrhea contraception claim in the PRECEDING paragraph, which is already correctly cited to ref 207 (Cochrane LAM review, PMID 26457821). They do not support the flagged claim, which is about charting 

---

### `tsh` — false_confidence  ·  Part VI-C

**Field:** `body_html`  ·  **ref#102**

**Current:** A Cochrane review found that subfertile women with euthyroid autoimmune thyroid disease may benefit from thyroxine replacement even when TSH is near-normal, though the evidence remained limited at the time of publication.<sup class="cite-ref"><a href="#ref-102">102</a></sup>

**Evidence:** A Cochrane review found that subfertile women with euthyroid autoimmune thyroid disease may benefit from thyroxine replacement even when TSH is near-normal, though the evidence remained limited at the time of publication.

**Suggested fix:** The cited Cochrane review (Akhtar et al. 2019, CD011009) did not find benefit. It found SIMILAR live birth rates (RR 1.04, 95% CI 0.83-1.29) and similar miscarriage rates, and its Authors' conclusions are 'We could draw no clear conclusions in this systematic review due to the very low to low quality of the evidence reported.' Attributing a possible benefit to it is a false-confidence error. Rewrite as: 'A Cochrane review of thyroxine replacement in subfertile women with euthyroid autoimmune thyroid disease found similar live birth and miscarriage rates versus no treatment, and the reviewers could draw no clear conclusions because the underlying evidence was low quality. The question is open

**Adversarial verdict:** CONFIRMED — Quote check PASSES verbatim. Ref 102 independently resolved from PubMed: PMID 31236916 = Akhtar MA, Agrawal R, Brown J, Sajjad Y, Craciunas L. 'Thyroxine replacement for subfertile women with euthyroid autoimmune thyroid disease or subclinical hypothyroidism.' Cochrane Database Syst Rev. 2019 Jun 25;6(6):CD011009, doi 10.1002/14651858.CD011009.pub2. I retrieved the full structured abstract directl

**Corrected fix:** The reviewer's rewrite is directionally right but has two errors to correct. (1) It omits the review's population restriction: the review included only 'women undergoing assisted reproduction treatment, meaning both in vitro fertilisation and intracytoplasmic sperm injection', so it is weak evidence about restorative, spontaneous-conception management and that limit should be stated. (2) Its closi

---

### `afollicularism` — internal_contradiction  ·  Part VI-D

**Field:** `body_html`  ·  **ref#78**

**Current:** This distinguishes afollicularism from <a href="#luf-syndrome" class="gloss-xref">Luteinized Unruptured Follicle Syndrome</a> and from <a href="#follicular-deficiency" class="gloss-xref">follicular deficiency</a>, which presents with measurable but suboptimal follicular growth rather than an absence of recruitment.

**Evidence:** from <a href="#follicular-deficiency" class="gloss-xref">follicular deficiency</a>, which presents with measurable but suboptimal follicular growth rather than an absence of recruitment.

**Canon:** Hilgers Chapter 35, Follicular and Luteal Phase Deficiencies (rrm-cli)

**Suggested fix:** This directly contradicts the follicular-deficiency entry in the same part, which states: 'the dominant follicle reaches adequate size and ruptures on schedule but does not produce sufficient hormonal output' and 'The follicle looks normal on ultrasound. It ruptures.' Suboptimal follicular GROWTH is immature follicle syndrome, not follicular deficiency. rrm-cli chapter 35 ('Follicular and Luteal Phase Deficiencies: Advancing Concepts and New Terminology') characterises follicular deficiency by hormone profiles and follicular function grades, not by size. Fix the afollicularism entry to read '...from <a href="#immature-follicle-syndrome">immature follicle syndrome</a>, which presents with mea

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in /tmp/glossary-review/terms-part-VI-D.json (slug afollicularism, paragraph 3). Re-derived independently rather than accepting the prior reviewer's reasoning. The descriptive clause is wrong for BOTH terms it can attach to. (a) follicular-deficiency, same file, opens: 'the dominant follicle reaches adequate size and ruptures on schedule but does not produce sufficient horm

**Corrected fix:** The prior fix is directionally right but silently drops the LUF contrast and does not register that the same clause is also false for LUF. Replace the whole sentence so all three contrasts are accurate: 'This distinguishes afollicularism from <a href="#luf-syndrome" class="gloss-xref">Luteinized Unruptured Follicle Syndrome</a>, where a follicle grows to mature size and luteinizes without rupturin

---

### `estrogen-dominance` — unsupported_claim  ·  Part VI-D

**Field:** `body_html`

**Current:** Uterine fibroids grow in an estrogen-driven environment.

**Evidence:** Beyond the endometrium, an estrogen-progesterone imbalance is implicated in several conditions. Uterine fibroids grow in an estrogen-driven environment.

**Suggested fix:** Fibroids are the one condition in this list where the entry's organising thesis runs backwards. The paragraph's conclusion is that 'adequate physiologic progesterone is a necessary counterweight, and its absence creates a permissive environment for tissue proliferation' - but in leiomyoma, progesterone receptor signalling is an established growth driver, mitotic activity peaks in the luteal phase, and PR blockade shrinks fibroids. Including fibroids as supporting evidence weakens an otherwise well-built argument and gives a knowledgeable critic the easiest possible entry point. Either drop the fibroid sentence, or handle it honestly as the exception: 'Uterine fibroids are hormone-dependent, 

---

### `follicular-deficiency` — citation_mismatch  ·  Part VI-D

**Field:** `body_html`  ·  **ref#111**

**Current:** Serial <a href="#follicle-maturation-study" class="gloss-xref">follicle maturation study</a> ultrasound, read alongside cycle-timed blood work, gives clinicians the combined picture needed to make the diagnosis.<sup class="cite-ref"><a href="#ref-111">111</a></sup>

**Evidence:** The deficit begins in the follicular phase and propagates forward. Follicular deficiency is a recognized hidden contributor to luteal insufficiency, recurrent early pregnancy loss, and short luteal phase in cycles that carry no other obvious diagnosis.

**Suggested fix:** Reference 111 (Grunfeld L et al., Fertil Steril 1989, PMID 2591570, confirmed present in the RRM library as slug luteal-phase-deficiency-after-completely-normal-follicular-and-periovulatory-pha-recffp2t90xpdja4n) is a paper whose stated conclusion is the OPPOSITE of this entry's thesis: it documents LPD arising after documented-normal follicular and periovulatory phases. Citing it as support for 'the corpus luteum is only as capable as the follicle that preceded it' and 'the deficit begins in the follicular phase' inverts the source. Either (a) move ref 111 and cite it honestly as the counter-case, i.e. 'not every luteal phase deficiency traces back to the follicle', or (b) replace it with H

**Adversarial verdict:** CONFIRMED — Quote verified verbatim in terms-part-VI-D.json. Reference 111 independently confirmed three ways: references.json ref_num 111 = 'Grunfeld L et al. Luteal phase deficiency after completely normal follicular and periovulatory phases. Fertil Steril. 1989.' pointing at pubmed.ncbi.nlm.nih.gov/2591570/; NCBI eutils esummary for PMID 2591570 returns exactly that title, Fertility and sterility, 1989 Dec

**Corrected fix:** Reject the prior reviewer's option (a). Rewriting the entry to say 'not every luteal phase deficiency traces back to the follicle' would import a mainstream counter-frame and self-caveat RRM canon inside RRM's own glossary, which violates the no-self-caveat and do-not-concede-contestable-frames rules. Take option (b) and strengthen it: drop ref 111 from that sentence entirely and cite instead Abdu

---

### `perimenopause` — citation_mismatch  ·  Part VI-D

**Field:** `body_html`  ·  **ref#218**

**Current:** The staging criteria established by the Stages of Reproductive Aging Workshop (STRAW+10) define early perimenopause by variable cycle length and late perimenopause by cycles 60 or more days apart, concluding at the final menstrual period.<sup class="cite-ref"><a href="#ref-218">218</a></sup>

**Evidence:** define early perimenopause by variable cycle length and late perimenopause by cycles 60 or more days apart, concluding at the final menstrual period.

**Suggested fix:** STRAW+10 (ref 218, Harlow 2012 JCEM) does not conclude perimenopause at the FMP - it explicitly extends perimenopause through stage +1a, ending 12 months after the FMP. The claim is attributed verbatim to the cited paper and the cited paper says otherwise. Fix: 'concluding twelve months after the final menstrual period.' The stage -2 (variable cycle length) and stage -1 (60 or more days of amenorrhea) descriptions are correct and should stay.

**Adversarial verdict:** CONFIRMED — Quote check PASSES: the current_value string appears verbatim in terms-part-VI-D.json under slug perimenopause. Independent re-derivation, not reliance on the prior reviewer: I resolved ref 218 via NCBI eutils esummary (PMID 22344196 = Harlow SD, Gass M, Hall JE, et al., J Clin Endocrinol Metab 2012 Apr;97(4):1159-68, DOI 10.1210/jc.2011-3362, PMC3319184) and pulled the actual full text from PMC. 

**Corrected fix:** Replace with: 'The staging criteria established by the Stages of Reproductive Aging Workshop (STRAW+10) define the early menopausal transition by increased variability in cycle length and the late menopausal transition by amenorrhea of 60 days or longer, with perimenopause as a whole concluding twelve months after the final menstrual period.' This keeps the two stage descriptions the source suppor

---

### `perimenopause` — citation_mismatch  ·  Part VI-D

**Field:** `body_html`  ·  **ref#77**

**Current:** <a href="#fsh" class="gloss-xref">FSH</a> rises irregularly, <a href="#amh" class="gloss-xref">AMH</a> falls progressively as the ovarian follicle pool depletes, estradiol fluctuates widely between cycles, and anovulatory cycles become more frequent.<sup class="cite-ref"><a href="#ref-77">77</a></sup>

**Evidence:** Hormonally, perimenopause brings volatility rather than simple decline. <a href="#fsh" class="gloss-xref">FSH</a> rises irregularly, <a href="#amh" class="gloss-xref">AMH</a> falls progressively as the ovarian follicle pool depletes, estradiol fluctuates widely between cycles, and anovulatory cycles become more frequent.

**Suggested fix:** Reference 77 is Yin WW et al., 'The effect of medication on serum anti-mullerian hormone (AMH) levels in women of reproductive age: a meta-analysis', BMC Endocrine Disorders 2022. Its exposure is MEDICATION (chiefly hormonal contraception) and its population is reproductive-age women, not the menopausal transition. It cannot support a four-part claim about perimenopausal FSH, estradiol and anovulation. Replace with a menopausal-transition hormone source (the SWAN longitudinal hormone papers, or STRAW+10 itself, which does describe the endocrine criteria for each stage).

**Adversarial verdict:** CONFIRMED — Quote check PASSES: the sentence appears verbatim in the perimenopause body_html, carrying a single ref-77 marker for a four-part hormonal claim. I re-derived the reference identity myself rather than trusting the reviewer: eutils esummary and efetch on PMID 35698127 return Yin WW, Huang CC, Chen YR, Yu DQ, Jin M, Feng C, 'The effect of medication on serum anti-mullerian hormone (AMH) levels in wo

**Corrected fix:** Repoint the citation from ref 77 to ref 218 (Harlow 2012, STRAW+10), which is already cited in this entry and which I confirmed supports every clause verbatim: for Stage -2 it says cycles are 'characterized by elevated but variable early follicular phase FSH levels and low AMH levels and AFC', and for Stage -1 it says cycles show 'increased variability in cycle length, extreme fluctuations in horm

---

### `vitamin-d` — unsupported_claim  ·  Part VI-D

**Field:** `body_html`

**Current:** Vitamin D deficiency is associated with reduced ovarian stimulation response in women with PCOS, lower live birth rates, impaired endometrial receptivity, and increased miscarriage risk.

**Evidence:** and increased miscarriage risk

**Suggested fix:** The two systematic reviews that establish the live-birth association explicitly report NO association with miscarriage. Listing 'increased miscarriage risk' alongside the live-birth finding, with no citation and at the same confidence level, states as fact something the best available meta-analyses specifically negate in the ART population. Remove the miscarriage item, or scope it precisely if it is being drawn from the separate recurrent-pregnancy-loss literature rather than the ART literature - and if so, say which and cite it. I did not verify identifiers for Chu 2018 or Alshenawy 2024, so retrieve them before adding either as a reference.

---

### `follicle-stimulation` — citation_mismatch  ·  Part VII

**Field:** `body_html`  ·  **ref#39**

**Current:** Retrieval-based stimulation bypasses the process that failed without resolving why it failed.<sup class="cite-ref"><a href="#ref-39">39</a></sup><sup class="cite-ref"><a href="#ref-94">94</a></sup>

**Evidence:** Retrieval-based stimulation bypasses the process that failed without resolving why it failed.<sup class="cite-ref"><a href="#ref-39">39</a></sup><sup class="cite-ref"><a href="#ref-94">94</a></sup>

**Canon:** RRM canon: IVF bypasses rather than treats - keep the claim, fix the citation.

**Suggested fix:** Neither citation is about ART or retrieval-based stimulation. Ref 39 is StatPearls 'Polycystic Ovarian Syndrome' and ref 94 is the 'Revised 2003 consensus on diagnostic criteria and long-term health risks related to polycystic ovary syndrome' (Rotterdam criteria, Hum Reprod). Both are PCOS diagnostic-criteria documents attached to a claim about what IVF stimulation does and does not resolve. The claim itself is correct RRM canon and should NOT be softened - only the citations are wrong. Re-point to ref 268 (Boyle 2018, RRM after failed IVF) and/or ref 403 (Huirne et al, 'Contemporary pharmacological manipulation in assisted reproduction'), which is already cited two sentences earlier for the

**Adversarial verdict:** CONFIRMED — Quote check PASSES verbatim - the sentence with both sups is the closing sentence of the term. I verified both ref identities from primary registries myself rather than from references.json alone. Ref 94: NCBI esummary for PMID 14688154 returns the title quoted above, Human reproduction (Oxford, England), 2004 Jan - a PCOS diagnostic-criteria consensus. Ref 39: I fetched https://www.ncbi.nlm.nih.g

**Corrected fix:** Endorse the reviewer's core fix (swap citations, do not soften the claim) with one correction. Do NOT use ref 403: I confirmed PMID 14871171 = Huirne JA et al, 'Contemporary pharmacological manipulation in assisted reproduction', Drugs 2004 - a pharmacology review of ART agents. It supports the higher-dose contrast it is already carrying but says nothing about failing to resolve underlying causes,

---

### `functional-nutritional-medicine` — citation_mismatch  ·  Part VII

**Field:** `body_html`  ·  **ref#3**

**Current:** Deficiencies in folate, vitamin D, zinc, iron, omega-3 fatty acids, and B vitamins, as well as elevated inflammatory markers and uncontrolled insulin resistance, can each disrupt the hormonal signaling that governs the reproductive cycle.<sup class="cite-ref"><a href="#ref-3">3</a></sup>

**Evidence:** Conclusions: Family physicians can provide a RRM approach for infertility to identify underlying causes and promote healthy term live births. Younger women and women with body mass index < 25 are more likely to have a live birth.

**Canon:** rrm-cli get --full on restorative-reproductive-medicine-for-infertility-in-two-family-medicine-clinics-recyiv7uvglmix9ex; grep hits: zinc=0, omega=0, micronutrient=0, nutrition=0

**Suggested fix:** Ref 3 (Stanford JB et al, BMC Pregnancy Childbirth 2021) is a retrospective outcomes cohort of 370 couples. I read its full text from the RRM library: it contains ZERO mentions of zinc, omega-3, or micronutrients, and it makes no mechanistic claim about micronutrient status disrupting hormonal signaling. What it does support is the practice pattern - 'Vitamin D deficiency 53 (14)' as a diagnosis and 'Vitamins and supplements 302 (82) / Folic acid 231 (63) / Vitamin D 202 (55) / Iron 21 (6)' as treatment components. Either move ref 3 to the following paragraph (where it genuinely supports 'RRM clinicians who incorporate functional medicine may evaluate these factors') and cite a nutrition-mec

**Adversarial verdict:** CONFIRMED — Quote check PASSES: the current_value string appears verbatim in /tmp/glossary-review/terms-part-VII.json, and ref 3's sup is the ONLY citation in paragraph 1, so the whole paragraph's evidentiary weight rests on it. Ref identity independently confirmed, not laundered: I resolved DOI 10.1186/s12884-021-03946-8 through Crossref myself and it returns title 'Restorative reproductive medicine for infe

**Corrected fix:** Reviewer's fix is directionally right and safe (it moves the sup rather than repointing ref 3, so the global-ref blast radius rule is respected). Refine it: (1) Move the ref-3 sup to paragraph 2, onto 'RRM clinicians who incorporate functional medicine may evaluate these factors as part of the diagnostic picture' - Stanford 2021 genuinely evidences that practice pattern (vitamin D deficiency dx in

---

### `migs` — citation_mismatch  ·  Part VII

**Field:** `body_html`  ·  **ref#186**

**Current:** Minimally Invasive Gynecologic Surgery (MIGS) is a recognized gynecologic subspecialty focused on laparoscopic, hysteroscopic, and robotic surgical techniques

**Evidence:** <strong>Minimally Invasive Gynecologic Surgery (MIGS) is a recognized gynecologic subspecialty focused on laparoscopic, hysteroscopic, and robotic surgical techniques for treating disorders of the female reproductive tract.</strong><sup class="cite-ref"><a href="#ref-185">185</a></sup><sup class="cite-ref"><a href="#ref-186">186</a></sup>

**Canon:** memory itc-iirrm-letters-of-support: MIGS = FPD, not board cert

**Suggested fix:** Reference 186 is literally the ABOG 'Focused Practice Designations' page, and ABOG classifies MIGS as a Focused Practice Designation (FPD), not as one of its board-certified subspecialties. The sentence is contradicted by its own second citation. Rewrite to: 'MIGS is a formally designated area of focused practice within obstetrics and gynecology. ABOG recognizes it through a Focused Practice Designation rather than subspecialty board certification, and AAGL accredits the FMIGS fellowship.' Note the honest nuance: ACOG's own career page does colloquially list MIGS under 'Subspecialties of Ob-Gyn', so this is a precision error rather than a fabrication. This also matters institutionally - hous

**Adversarial verdict:** CONFIRMED — Quote check passed: exact substring match in body_html. I fetched both ABOG pages directly rather than relying on the prior reviewer or Perplexity. The FPD page (HTTP 200) states verbatim: 'ABOG currently offers Focused Practice Designations (FPDs) in Minimally Invasive Gynecologic Surgery (MIGS) and Pediatric and Adolescent Gynecology (PAG). The process for obtaining FPDs with ABOG is voluntary. 

**Corrected fix:** Adopt the prior reviewer's direction but correct two errors in their wording. Proposed sentence: 'Minimally Invasive Gynecologic Surgery (MIGS) is a formally recognized area of focused practice within obstetrics and gynecology, covering laparoscopic, hysteroscopic, and robotic techniques for disorders of the female reproductive tract. ABOG recognizes it through a Focused Practice Designation, appr

---

### `reproductive-immunology` — citation_mismatch  ·  Part VII

**Field:** `body_html`  ·  **ref#37**

**Current:** Elevated uterine natural killer cell activity and autoimmune and thrombophilic disorders appear in a subset of couples with otherwise unexplained implantation failure.<sup class="cite-ref"><a href="#ref-37">37</a></sup>

**Evidence:** Elevated uterine <a href="#natural-killer-cells" class="gloss-xref">natural killer cell</a> activity and <a href="#autoimmune-thrombophilic" class="gloss-xref">autoimmune and thrombophilic</a> disorders appear in a subset of couples with otherwise unexplained implantation failure.<sup class="cite-ref"><a href="#ref-37">37</a></sup>

**Canon:** RRM canon: mainstream disagreement is not grounds to change the RRM position; only the citation attribution is wrong.

**Suggested fix:** Reference 37 is the ESHRE guideline on recurrent pregnancy loss (PMC6276652). That guideline explicitly declines to support this claim and it is scoped to RPL, not implantation failure. Do NOT change the RRM clinical position here - RRM clinicians legitimately diverge from ESHRE on immune evaluation. Fix the attribution: move ref 37 to the APS sentence (which it does support), and support the uNK sentence with a source that actually reports elevated uNK activity in unexplained implantation failure, or restate as 'an area RRM clinicians evaluate where mainstream guidelines find evidence insufficient'. I did not independently open PMC6276652 (URL probing is out of scope for this pass), so conf

**Adversarial verdict:** CONFIRMED — Quote check passed: the evidence_quote appears byte-for-byte in body_html of terms-part-VII.json (verified by exact substring match, not by eye). Ref 37 in references.json resolves to https://pmc.ncbi.nlm.nih.gov/articles/PMC6276652/ which I fetched directly (HTTP 200, 326KB) and confirmed is 'ESHRE guideline: recurrent pregnancy loss', Hum Reprod Open 2018;2018(2):hoy004. I re-derived the defect 

**Corrected fix:** Keep the RRM clinical position. Fix attribution only. (1) Re-cite the uNK sentence to Von Woon E, Greer O, Shah N, Nikolaou D, Johnson M, Male V. Number and function of uterine natural killer cells in recurrent miscarriage and implantation failure: a systematic review and meta-analysis. Hum Reprod Update. 2022;28(4):548-582. PMID 35265977, DOI 10.1093/humupd/dmac006, PMCID PMC9247428. I confirmed 

---

### `iud` — false_confidence  ·  Part VIII

**Field:** `body_html`

**Current:** Fertility Awareness-Based Methods provide an alternative to intrauterine contraception with equivalent effectiveness when used correctly, without a device, systemic or local hormonal exposure, or the post-fertilization mechanisms that have prompted ongoing scientific and ethical discussion.

**Evidence:** <a href="#fabms" class="gloss-xref">Fertility Awareness-Based Methods</a> provide an alternative to intrauterine contraception with equivalent effectiveness when used correctly, without a device, systemic or local hormonal exposure, or the post-fertilization mechanisms that have prompted ongoing scientific and ethical discussion.

**Canon:** [[feedback-no-absolutist-patient-copy]]; [[dont-concede-contestable-frames-rrm]] - make the strong claim the evidence carries, not one it does not

**Suggested fix:** 'Equivalent effectiveness' is not supportable and the sentence carries no citation. Published correct-use first-year failure is roughly 0.2% for the levonorgestrel IUD and 0.6-0.8% for the copper IUD, against a correct-use range of under 1% to about 5% across FABMs depending on method; and because an IUD requires no ongoing user action, its typical use is essentially its perfect use, while FABM typical-use failure is materially higher. The honest and still-strong version: 'The most effective fertility awareness-based methods achieve correct-use effectiveness in the same range as intrauterine contraception, without a device, without systemic or local hormonal exposure, and without the post-fe

**Adversarial verdict:** CONFIRMED — Quote check passes; the sentence appears verbatim in the iud body_html, paragraph 4, including the gloss-xref anchor markup, and it carries no citation. I re-derived the evidence instead of accepting the reviewer's Perplexity synthesis. I pulled Peragallo Urrutia R, Polis CB, Jensen ET, Greene ME, Kennedy E, Stanford JB, 'Effectiveness of Fertility Awareness-Based Methods for Pregnancy Prevention:

**Corrected fix:** Adopt the reviewer's rewrite, with two corrections to the surrounding note. First, do not publish the IUD failure figures it quotes (0.2% levonorgestrel, 0.6 to 0.8% copper). I could not verify them from a primary source in this pass; they trace to Trussell failure-rate tables that were never retrieved, so treat them as unverified. Second, the note's FABM range ('under 1% to about 5%') should be r

---

## P2 — drift, mismatch, or RRM-vs-mainstream conflict (155)

### `body-literacy` — citation_metadata_wrong  ·  Part I

**Field:** `references.json ref_num 88 (journal + anchor_text)`  ·  **ref#88**

**Current:** ref 88 | anchor_text: "Body/self awareness and interpersonal communications: fundamental components of reproductive health" | journal: "Holistic Nurs Pract"

**Evidence:** rrm-cli D1 record (verbatim): "title":"Body/self awareness and interpersonal communications: fundamental components of  reproductive health awareness","authors":"Aumack-Yee K","year":1997,"journal":"Advances in Contraception : the Official Journal of the Society for the  Advancement of Contraception"

**Suggested fix:** Two defects in one reference row. (1) Journal: the RRM library record for this exact paper says Advances in Contraception (1997), not Holistic Nurs Pract. (2) anchor_text truncates the title: it ends '...components of reproductive health' where the paper is '...components of reproductive health awareness'. Verify against PubMed before rewriting -- Perplexity could not retrieve this record and explicitly declined to guess, so the D1 record is currently the only independent source. Do not write a journal name into the reference until a registry lookup confirms it.

---

### `chorionic-gonadotropin` — duplicate_term  ·  Part I

**Field:** `term identity (Part I slug chorionic-gonadotropin vs Part VI slug hcg)`

**Current:** Part I: "Chorionic Gonadotropin is a glycoprotein hormone the syncytiotrophoblast cells of the developing embryo and placenta produce, beginning shortly after implantation."

**Evidence:** Part VI term 'hcg' (verbatim): "Human Chorionic Gonadotropin (hCG) is a glycoprotein hormone produced by the syncytiotrophoblast immediately after implantation, and it is the hormone detected by all standard pregnancy tests." ... "luteo-placental shift at approximately 8 to 10 weeks of gestation."

**Suggested fix:** The glossary carries two entries for the same hormone: chorionic-gonadotropin (Part I, uncited) and hcg (Part VI, 'Human Chorionic Gonadotropin (hCG)', cited to ref 122), plus hcg-trigger (Part III). glossary_abbreviation maps 'hCG' -> slug 'hcg', so the Part I entry is the orphan. Merge into the Part VI entry or make Part I an explicit pointer. Two secondary defects fall out of the same fix: the Part I title drops 'Human', and the body's first bare use of 'hCG' is never expanded.

---

### `chorionic-gonadotropin` — timing_imprecision  ·  Part I

**Field:** `body_html (luteal-placental shift)`

**Current:** until placental progesterone synthesis is established at roughly 8 to 10 weeks of gestation.

**Evidence:** Perplexity (verbatim): "**“Transfer of luteal support to placenta occurs between seventh and ninth week … Luteal placental shift occurs between 7 and 9 weeks of pregnancy.”** ... “Roughly 8 to 10 weeks” overstates the timing if interpreted as the *start* of placental takeover; it corresponds more to a **conservative upper bound** used in clinical practice for stopping luteal support rather than the experimentally defined shift."

**Suggested fix:** Change to '7 to 9 weeks of gestation' (Csapo's corpus luteum ablation data and modern reviews). SYSTEMIC: the same 8-to-10-week figure appears in the Part VI terms hcg ('luteo-placental shift at approximately 8 to 10 weeks') and corpus-luteum ('until the placenta assumes that function at approximately 8 to 10 weeks'). Fix all three together or the glossary will self-contradict.

---

### `chorionic-gonadotropin` — canonical_name  ·  Part I

**Field:** `body_html (NaProTechnology capitalization, 3 Part I terms)`

**Current:** chorionic-gonadotropin: 'In <a href="/naprotechnology/">NaProTECHNOLOGY</a> practice'; follicular-phase: '<a href="/naprotechnology/">NaProTECHNOLOGY</a> and FEMM practitioners'; thyroid: '<a href="/naprotechnology/">NaProTECHNOLOGY</a> evaluation addresses thyroid replacement'

**Evidence:** Part I term restorative-reproductive-medicine (verbatim): '<a href="/naprotechnology/">NaProTechnology</a> is one well-developed method within it' -- versus 'NaProTECHNOLOGY' in three sibling terms in the same Part.

**Canon:** Canonical names: NaProTechnology

**Suggested fix:** Canonical form is NaProTechnology. Normalize all three occurrences. The all-caps form is Hilgers' own house styling and is legitimate when quoting the textbook title ('The Medical and Surgical Practice of NaProTECHNOLOGY'), but running prose in this glossary already uses NaProTechnology in term 1, so Part I currently contradicts itself. Note the shared glossary_abbreviation row also carries the all-caps form ('NaPro' | 'NaProTECHNOLOGY (Natural Procreative Technology)') and should be normalized in the same pass.

---

### `chorionic-gonadotropin` — citation_missing  ·  Part I

**Field:** `body_html (whole hormone block, terms 11-16 of Part I)`

**Current:** chorionic-gonadotropin, estrogens, estrone, follicular-phase, hydroxyprogesterones, thyroid: zero <sup class="cite-ref"> anchors between them

**Evidence:** Link extraction over Part I body_html: the only href values in these six terms are '#corpus-luteum', '#cervical-mucus-patterns', '#luteal-phase' and '/naprotechnology/'. No '#ref-N' anchor appears in any of the six.

**Suggested fix:** Terms 0-9 and 16 of Part I carry inline citations; terms 10-15 carry none, while making specific factual assertions (a receptor-affinity percentage, a gestational-age threshold, an FDA withdrawal year and rationale, a named-author attribution to Hilgers, a thyroid panel recommendation). That is an integrity gap on a public medical glossary, not a formatting nit. Attach references to at least the numeric and regulatory claims in this block.

---

### `estrogens` — protocol_leak  ·  Part I

**Field:** `body_html (RRM measurement paragraph)`

**Current:** Draws at early follicular (cycle days 3 to 5) and post-peak phases allow RRM clinicians to assess follicular adequacy, luteal function, and estrogen support for the endometrium, rather than relying on a single snapshot.

**Evidence:** Draws at early follicular (cycle days 3 to 5) and post-peak phases allow RRM clinicians to assess follicular adequacy, [luteal] function, and estrogen support for the endometrium, rather than relying on a single snapshot.

**Canon:** NO PUBLIC PROTOCOLS OR DOSINGS

**Suggested fix:** DOWNGRADED FROM P1 DELIBERATELY, flagging for human arbitration rather than asserting. The rule says any cycle-day timing must be flagged P1 protocol_leak, and 'cycle days 3 to 5' is literally cycle-day timing. But this is the universally published mainstream baseline draw (day-3 FSH/estradiol), not a Hilgers-proprietary post-Peak schedule, and no dose or agent accompanies it. If the standard is strict, rewrite at concept level: 'Draws in the early follicular phase and again after Peak allow RRM clinicians to assess...'. Note the sibling term comprehensive-evaluation already models the concept-level phrasing ('biologically meaningful days post-ovulation, not arbitrary cycle days'), so the tw

---

### `estrogens` — overclaim  ·  Part I

**Field:** `body_html (estriol in pregnancy)`

**Current:** During pregnancy, estriol facilitates uterine growth, placental blood flow, and fetal organ development.

**Evidence:** Perplexity (verbatim): "Uterine growth: broadly consistent with clinical summaries but not strongly estriol-specific in primary literature. Placental blood flow: **reasonably accurate** and supported as a dominant proposed role. Fetal organ development: **over-broad and not well supported** beyond speculative CNS antioxidant hypotheses."

**Suggested fix:** Drop 'and fetal organ development'. Estriol's supported pregnancy roles are uteroplacental blood flow and, clinically, its use as a marker of fetoplacental function (uE3 in maternal serum screening). Suggested rewrite: 'During pregnancy, estriol supports uteroplacental blood flow and serves clinically as a marker of fetoplacental function.'

---

### `estrone` — unsupported_precision  ·  Part I

**Field:** `body_html (receptor binding affinity)`

**Current:** It is a weaker estrogen than estradiol, with substantially lower receptor binding affinity at the estrogen receptor, estimated at roughly 4 to 8 percent of E2's affinity at ERα.

**Evidence:** Perplexity (verbatim): "**Typical/central values:** about **15–30%** of E2. **Assay-dependent range seen in primary literature:** roughly **10–60%**. **Very low (≈4%) values** reflect specific older assay conditions and whole-tissue preparations and are outliers relative to more controlled receptor-level binding assays." Compiled values quoted: "**Estradiol … ERα RBA 100 … Estrone … ERα RBA 16.39 (0.7–60)**"

**Suggested fix:** The narrow '4 to 8 percent' band is an uncited numeric claim that sits at the extreme low end of the literature and reads as false precision. Kuiper 1997 (recombinant ERα) and compiled RBA tables put estrone materially higher. Rewrite without the fabricated-looking band, e.g.: 'Estrone binds ERα with substantially lower affinity than estradiol; reported relative binding affinities vary widely by assay.' If a number is wanted, attach a primary citation and use a range that reflects the literature rather than a two-point band. Do NOT copy Perplexity's figures into the page as fact -- they came partly from compiled secondary tables and need a primary-source check first.

**Adversarial verdict:** DOWNGRADE — Quote check PASSES: the sentence appears verbatim in /tmp/glossary-review/terms-part-I.json, and the estrone entry carries zero cite-ref markers, so the band is genuinely uncited. But the prior reviewer's evidence does not survive re-derivation. I pulled Kuiper 1997 myself (PubMed efetch, PMID 9048584, Endocrinology 138:863-70, title confirmed): the abstract reports only a rank ORDER of competitor

**Corrected fix:** Direction of the fix is right, rationale is not. Drop the numeric band and do not replace it with any figure, because every candidate number I could reach is either assay-specific or secondary. Replace the sentence with: 'It is a weaker estrogen than estradiol, binding estrogen receptor alpha with substantially lower affinity. Reported relative binding affinities vary widely across assay systems.'

---

### `follicular-phase` — uncited_attribution  ·  Part I

**Field:** `body_html (named-author claim)`

**Current:** Hilgers describes follicular phase defect as a distinct, often-overlooked counterpart to luteal phase defect.

**Evidence:** Hilgers describes follicular phase defect as a distinct, often-overlooked counterpart to luteal phase defect.

**Suggested fix:** A named-author attribution with no citation, in a term block that carries no references at all. I could not confirm it: rrm-cli returned no Hilgers chapter titled or excerpted for follicular phase defect (the closest are Ch. 19 Targeted Hormone Assessment of the Menstrual Cycle and Ch. 20-22 Disorders of Human Ovulation), and Perplexity returned luteal-phase-defect literature instead. Either cite the specific chapter of The Medical and Surgical Practice of NaProTECHNOLOGY that carries this claim, or drop the personal attribution and state the concept unattributed. Do not leave a named attribution standing unverified on a public page.

---

### `hydroxyprogesterones` — abbreviation_missing  ·  Part I

**Field:** `body_html abbreviations vs glossary_abbreviation table`

**Current:** 17-alpha-hydroxyprogesterone (17-OHP) ... non-classic congenital adrenal hyperplasia (CAH) ... 17-alpha-hydroxyprogesterone caproate (17-OHPC)

**Evidence:** abbreviations.json contains 70 rows; a scan for 17-OHP, 17-OHPC and CAH returns no match. Nearest rows are 'LPD' | 'Luteal Phase Deficiency' and 'DHEA' | 'Dehydroepiandrosterone'.

**Suggested fix:** This term introduces three abbreviations, none of which has a glossary_abbreviation row. Add rows for 17-OHP (17-alpha-Hydroxyprogesterone), 17-OHPC (17-alpha-Hydroxyprogesterone Caproate) and CAH (Congenital Adrenal Hyperplasia). Part I introduces several more with no row: E1/E2/E3, TPO, Tg, rT3 (thyroid), PMDD (restorative-reproductive-medicine) and GABA-A (progesterone-as-a-neurosteroid). Decide once whether the table is a curated quick-reference or an index, then make Part I consistent with that decision.

---

### `progesterone-as-a-neurosteroid` — citation_metadata_wrong  ·  Part I

**Field:** `references.json ref_num 44 (journal)`  ·  **ref#44**

**Current:** ref_num 44 | anchor_text: "Progesterone and the Luteal Phase: A Requisite to Reproduction." | url: https://pmc.ncbi.nlm.nih.gov/articles/PMC4436586/ | journal: "PMC"

**Evidence:** references.json row 44 verbatim: {"ref_num": 44, "anchor_text": "Progesterone and the Luteal Phase: A Requisite to Reproduction.", "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC4436586/", "publisher": null, "journal": "PMC"}

**Suggested fix:** 'PMC' is a repository, not a journal. Replace with the real journal for PMC4436586 -- I believe it is Obstetrics and Gynecology Clinics of North America (Mesen TB, Young SL, 2015), but I did not open the record and the assignment forbids URL probing, so VERIFY against PubMed before writing it in. Ref 44 is also used by the Part VI terms luteal-phase and corpus-luteum, so the fix propagates.

---

### `thyroid` — consensus_conflict  ·  Part I

**Field:** `body_html (RRM thyroid panel)`

**Current:** RRM clinicians assess TSH, free T4, free T3, reverse T3, and TPO/Tg antibodies, applying tighter TSH targets than non-fertility populations.

**Evidence:** GLOSSARY SIDE (verbatim): 'RRM clinicians assess TSH, free T4, free T3, reverse T3, and TPO/Tg antibodies, applying tighter TSH targets than non-fertility populations.' MAINSTREAM SIDE, Perplexity quoting ATA verbatim: 'In healthy, non-hospitalized people, measurement of reverse T3 does not help determine whether hypothyroidism exists or not, and is not clinically useful.' and 'Except for these three uncommon situations, there is no need to measure rT3 in routine clinical practice.'

**Suggested fix:** Human arbitration required, both sides logged. The American Thyroid Association explicitly says reverse T3 is not clinically useful outside rare situations; the glossary presents it as part of the routine RRM panel. This is NOT a case where mainstream disagreement makes RRM wrong on a positional question -- rT3 is a lab-utilization question, not an RRM canon position, so it is more exposed than the excision or IVF positions are. Options: drop rT3 from the listed panel, or keep it and state the specific indication it is being run for. The tighter-TSH-target claim is mainstream-compatible and can stay.

---

### `base-infertile-pattern` — canonical_name  ·  Part II

**Field:** `name`

**Current:** Base Infertile Pattern (BIP)

**Evidence:** The Base Infertile Pattern (BIP) is a woman's individual baseline of dryness or unchanging, featureless discharge that persists across consecutive days in the pre-Peak phase, during which conception is unlikely. The BIP concept originated in the Billings Ovulation Method.

**Canon:** Counter-evidence from RRM's own corpus: rrm-cli, Hilgers Ch 15 'Scientific Foundations of the CrMS': 'the days of fertility can be properly identified with the use of a base infertile pattern (BIP) which is identified with the presence of an unchanging discharge.'

**Suggested fix:** The term is attributed to the Billings Ovulation Method but uses Hilgers' spelling. Billings LIFE/WOOMB's own materials say 'Basic Infertile Pattern (BIP)'; Hilgers' textbook says 'base infertile pattern (BIP)'. Recommended fix: title the term 'Basic Infertile Pattern (BIP)' (matching the originating method), add a line noting that CrMS materials write it 'base infertile pattern', update the glossary_abbreviation full_term, and fix the dry-day term's 'basic infertile pattern' anchor text so all three agree. Human arbitration on which head-term wins.

---

### `base-infertile-pattern` — factual_error  ·  Part II

**Field:** `body_html`

**Current:** In the Creighton Model, a closely related concept applies under different nomenclature.

**Evidence:** In the Creighton Model, a closely related concept applies under different nomenclature. In both systems, establishing the BIP requires observation across multiple cycles and instruction from a trained practitioner.

**Canon:** rrm-cli, Hilgers Ch 15 'Scientific Foundations of the CrMS' uses the identical term: 'the days of fertility can be properly identified with the use of a base infertile pattern (BIP)'

**Suggested fix:** CrMS does not use different nomenclature for this: Hilgers' own textbook uses 'base infertile pattern (BIP)' verbatim (and separately adds the Essential Sameness Pattern with yellow stamps as the charting apparatus for continuous discharge). Rewrite as: 'The Creighton Model uses the same term, and adds the Essential Sameness Pattern and Yellow Stamps as its charting apparatus for continuous discharge.' Cross-link to essential-sameness-pattern-yellow-stamps.

---

### `biomarkers` — abbreviation_mismatch  ·  Part II

**Field:** `body_html`

**Current:** urinary LH and estrogen metabolites (E1G)

**Evidence:** Primary biomarkers include cervical mucus quality and sensation (rising estrogen), basal body temperature (rises after ovulation with progesterone release), urinary LH and estrogen metabolites (E1G), and serum hormone levels drawn at cycle-phase-specific intervals.

**Suggested fix:** Change '(E1G)' to '(E3G, estrone-3-glucuronide)'. E3G is the abbreviation used by the Clearblue monitor (the device named in the marquette-method term) and by the FABM literature; E1G is nonstandard in this context and creates a mismatch with the sibling Marquette entry.

---

### `cervical-mucus-patterns` — missing_citations  ·  Part II

**Field:** `body_html`

**Current:** (entire term body carries zero reference anchors)

**Evidence:** These patterns are the biological foundation of all Fertility Awareness-Based Methods (FABMs). The Billings Ovulation Method first formalized them clinically; the Creighton Model FertilityCare System (CrMS) standardized them into a precise clinical vocabulary.

**Suggested fix:** This is the only Part II term with no citations at all, yet it carries a hard percentage claim, a historical priority claim (Billings formalized, CrMS standardized) and a mechanism claim (progesterone-driven cervical plug). Add refs 74 (Billings 1981), 7 (FertilityCare Centers of America) and 100 (Hilgers 1978) at minimum. Also note the word_count field is null for this term while every other Part II term has one.

---

### `dpo` — unsupported_claim  ·  Part II

**Field:** `body_html`  ·  **ref#245**

**Current:** The luteal phase length holds more consistently when measured from the mucus-based Peak Day reference than from a predicted ovulation date, which shifts across cycles and across cycle-tracking methods.[ref-245][ref-243]

**Evidence:** The practical significance lies in anchor stability. The luteal phase length holds more consistently when measured from the mucus-based Peak Day reference than from a predicted ovulation date, which shifts across cycles and across cycle-tracking methods.

**Canon:** Ref 245 = Wilcox/Dunson/Baird, 'The timing of the fertile window in the menstrual cycle' (PMID 11082086), a day-specific fertile-window estimation study; ref 243 = Ecochard R et al., 'Chronological aspects of ultrasonic, hormonal, and other indirect indices of ovulation' (PMID 11510707)

**Suggested fix:** Neither cited paper compares luteal-phase-length variance measured from Peak Day against variance measured from an app-predicted ovulation date. Either cite a source that makes that head-to-head comparison, or soften to what the sources do support: that calendar or prediction-based ovulation estimates vary substantially between women and cycles, whereas Peak Day is an observed biomarker. Do not weaken the RRM position, just match the claim to the evidence.

---

### `fertile-window` — canonical_name  ·  Part II

**Field:** `body_html`

**Current:** The Marquette Model uses urinary luteinizing hormone and estrogen monitoring to identify the window. Symptothermal methods cross-check mucus observations with basal body temperature.

**Evidence:** The Marquette Model uses urinary luteinizing hormone and estrogen monitoring to identify the window. Symptothermal methods cross-check mucus observations with basal body temperature.

**Canon:** The glossary's own head-terms are 'Marquette Method' (slug marquette-method, used in the fabms, nfp and sympto-thermal-method entries) and 'Sympto-Thermal Method (STM)'

**Suggested fix:** Part II uses both 'Marquette Method' (five places) and 'Marquette Model' (here), and both 'Sympto-Thermal Method' and 'Symptothermal'. Pick one form per method and apply it glossary-wide. Flagging rather than fixing because the review brief's canon list says 'Marquette Model' while the glossary head-term, the Marquette University institute and Fehring's own papers say 'Marquette Method': human arbitration needed.

---

### `fertility-focused-intercourse` — abbreviation_missing  ·  Part II

**Field:** `abbreviation`

**Current:** FFI

**Evidence:** Fertility-focused intercourse (FFI) is the practice of a couple timing relations to align with the fertile window identified through FABM charting, particularly the days around and preceding the Peak Day.

**Canon:** abbreviations.json contains no row with abbreviation 'FFI'; every other abbreviated Part II term (FABMs, NFP, CrMS, STM, BBT, DPO, VDRS, MCS, BIP, POC, ESP, TEB, PMB) has one

**Suggested fix:** Add the missing glossary_abbreviation row: abbreviation 'FFI', full_term 'Fertility-Focused Intercourse', term_slug 'fertility-focused-intercourse'. This is the only Part II term whose abbreviation field has no matching abbreviations row.

---

### `mucus-cycle` — internal_consistency  ·  Part II

**Field:** `body_html`

**Current:** The mucus cycle is the fertile window in practical terms.

**Evidence:** The Mucus Cycle is the discrete window of fertile-type cervical mucus within a single menstrual cycle, beginning at the Point of Change (the first observable shift from the dry baseline) and ending on Peak Day. The mucus cycle is the fertile window in practical terms.

**Canon:** rrm-cli, Hilgers TW Ch 48 'Fecundity and Mucus Cycle Score' (author Joseph B. Stanford): 'because the mucus symptom has some variability in onset and the Peak Day can vary up to three days in relation to ovulation, the clinically estimated fecund window as identified in the CrMS chart is generally 9

**Suggested fix:** The mucus cycle ends on Peak Day, but the charted fertile window does not: CrMS keeps the fertile time open through the post-Peak days, and the glossary's own fertile-window term states 'Peak Day +3 is an established protocol boundary marking the close of the fertile phase'. Equating the two will teach users to end the fertile window three days early. Rewrite as: 'The mucus cycle is the estrogen-driven core of the fertile time; the charted fertile window extends past Peak Day until the method's post-Peak rule closes it.'

---

### `post-peak-phase` — statistic_drift  ·  Part II

**Field:** `body_html`  ·  **ref#44**

**Current:** the post-peak phase typically runs 11 to 16 days in ovulatory cycles with adequate hormonal support

**Evidence:** While the pre-peak phase can vary considerably in length from cycle to cycle, the post-peak phase typically runs 11 to 16 days in ovulatory cycles with adequate hormonal support.

**Suggested fix:** Either use the cited source's range (11 to 17 days, most 12 to 14) or, if the one-day reduction is deliberate because the post-Peak count starts the day after Peak Day rather than at ovulation, say so explicitly. Also note the glossary's own Luteal Phase entry reads 'typically lasting 12 to 16 days', a third variant: harmonise all three.

---

### `premenstrual-bleeding` — consensus_conflict  ·  Part II

**Field:** `body_html`  ·  **ref#45**

**Current:** The most common underlying cause is progesterone deficiency, specifically a corpus luteum that failed to sustain its output long enough.[ref-45][ref-44]

**Evidence:** The most common underlying cause is progesterone deficiency, specifically a corpus luteum that failed to sustain its output long enough.

**Canon:** RRM canon holds luteal phase deficiency to be a real, diagnosable, correctable finding. Ref 45 is the ASRM committee opinion 'Diagnosis and treatment of luteal phase deficiency', whose mainstream position is that LPD is not an independently established clinical entity with a validated diagnostic tes

**Suggested fix:** RRM canon is NOT wrong here and should not be softened. The problem is instrumental: an ASRM document that disputes LPD as a diagnosable entity is being used as support for a causal LPD claim, which hands a reviewer an easy hit. Swap the support to RRM primary sources already in the library (Hilgers Ch 32, which ties perimenstrual bleeding dysfunction to measured early-luteal progesterone, and Ch 86) and keep ref 45 only if the text explicitly frames it as the contested mainstream position. Human arbitration per the consensus-conflict rule.

---

### `achieving-related-pregnancy-rate` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#93**

**Current:** It is also used to contextualize outcomes in the Fertilitas Study, the largest published NaProTechnology infertility cohort to date. [ref 93]

**Evidence:** achieving-related -> 0 / achieving related -> 0 / arpr -> 0 / fertility-focused -> 0

**Suggested fix:** The Fertilitas paper does not use the ARPR metric at all. I ran a case-insensitive count over the full article body retrieved from the RRM library: zero occurrences of 'achieving-related', 'ARPR', or 'fertility-focused'. That study reports crude take-home baby rate and Kaplan-Meier adjusted cumulative rates, which are exactly the unselected-denominator style of metric this term contrasts ARPR against. Either delete the sentence or reframe it: 'The Fertilitas Study reports crude and follow-up-adjusted rates rather than ARPR, which is why its 35.3% crude figure is not directly comparable to Creighton achieving-related data.' That reframing is stronger, because it makes the term's own methodolo

---

### `achieving-related-pregnancy-rate` — abbreviation_missing  ·  Part III

**Field:** `abbreviation`

**Current:** ARPR

**Evidence:** The Achieving-Related Pregnancy Rate (ARPR) is a use-effectiveness statistic developed within the Creighton Model FertilityCare System

**Suggested fix:** The term record carries abbreviation 'ARPR' and the body introduces it in the opening sentence, but there is no matching row in glossary_abbreviation. Add {abbreviation: 'ARPR', full_term: 'Achieving-Related Pregnancy Rate', term_slug: 'achieving-related-pregnancy-rate'}.

---

### `cooperative-cyclic-hrt` — abbreviation_missing  ·  Part III

**Field:** `abbreviation`

**Current:** ccHRT

**Evidence:** Cooperative Cyclic Hormone Replacement (ccHRT) is an approach to hormone replacement that is timed and calibrated to support a woman's own ovulatory cycle

**Suggested fix:** The term record carries abbreviation 'ccHRT' and the body introduces it in the opening sentence, but there is no matching row in glossary_abbreviation. Add {abbreviation: 'ccHRT', full_term: 'Cooperative Cyclic Hormone Replacement', term_slug: 'cooperative-cyclic-hrt'}. Same batch as IMH, HMA, CPRT, CERT and ARPR.

---

### `cooperative-estrogen-replacement` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#82**

**Current:** CERT uses isomolecular hormones, preparations chemically identical to endogenous estradiol, consistent with NaProTechnology's preference for physiologic-pattern matching over pharmacologic substitution. [ref 82]

**Evidence:** Hilgers TW, Keefe CE, Pakiz KA. The Use of Isomolecular Progesterone in the Support of Pregnancy and Fetal Safety. Issues Law Med. 2015.

**Suggested fix:** Ref 82 is specifically about isomolecular PROGESTERONE in pregnancy support; it is not a source for isomolecular ESTRADIOL preparations in a cycling-woman estrogen protocol. Cite ref 78 (Hilgers, The Medical and Surgical Practice of NaProTECHNOLOGY), which is the source of record for CERT and is already cited in the opening sentence, and reserve ref 82 for progesterone-specific statements.

---

### `cooperative-progesterone-replacement` — overclaim  ·  Part III

**Field:** `body_html`  ·  **ref#44**

**Current:** its failure to produce adequate progesterone is a well-recognized cause of implantation failure and early loss. [ref 44]

**Evidence:** Progesterone and the Luteal Phase: A Requisite to Reproduction.

**Suggested fix:** Ref 44 (Mesen and Young) supports the first half of the sentence, that the corpus luteum is the primary source of progesterone in early pregnancy, but 'well-recognized cause' overstates what that review concludes about luteal phase deficiency as an established causal entity. Split the sentence: cite ref 44 for corpus luteum physiology, and state the causal claim as the RRM position with a NaProTechnology source (ref 78 or ref 81), rather than implying general recognition.

---

### `fertilitas-study` — internal_inconsistency  ·  Part III

**Field:** `body_html`  ·  **ref#93**

**Current:** It is one of the largest single-center NaProTECHNOLOGY outcome datasets published to date

**Evidence:** To our knowledge, this is the largest series published to date on NPT.

**Canon:** Never soften RRM outcome claims; no self-caveating (feedback-no-self-caveat-rrm-case)

**Suggested fix:** Softer than the primary source and inconsistent with the sibling glossary term achieving-related-pregnancy-rate, which calls it 'the largest published NaProTechnology infertility cohort to date'. The claim is verifiable: the largest prior NaPro series in the paper's own comparison set is the 843-couple iNEST multicenter study. Align both terms to the source wording: 'the largest NaProTechnology series published to date'. Per RRM canon, do not self-caveat an outcome claim the primary source states plainly.

---

### `heteromolecular-artimones` — abbreviation_missing  ·  Part III

**Field:** `abbreviation`

**Current:** HMA

**Evidence:** Heteromolecular artimones (HMA) are hormone-like compounds whose molecular structure differs from the hormones the human body produces naturally.

**Suggested fix:** The term record carries abbreviation 'HMA' and the body introduces it in the opening sentence, but there is no matching row in glossary_abbreviation. Add {abbreviation: 'HMA', full_term: 'Heteromolecular Artimones', term_slug: 'heteromolecular-artimones'}.

---

### `immune-modifying-framework` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#146**

**Current:** NeoFertility has published outcomes data on couples with implantation failure and recurrent loss, [ref 146]

**Evidence:** NeoFertility.

**Suggested fix:** A claim about published outcomes data is footnoted to the clinic's own homepage (ref 146 = neofertility.ie). Cite the actual publications instead: ref 132 (Boyle et al. 2025, JRRM, 2019 clinic cohort) is already in the reference set, and Boyle et al. 2018, Frontiers in Medicine, PMID 30109231, covers the post-failed-IVF population directly. Verify PMIDs against PubMed before insertion.

---

### `isomolecular-hormones` — abbreviation_missing  ·  Part III

**Field:** `abbreviation`

**Current:** IMH

**Evidence:** Isomolecular hormones (IMH) are hormone preparations that are chemically identical to those the human body produces

**Suggested fix:** The term record carries abbreviation 'IMH' and the body introduces it in the opening sentence, but there is no matching row in glossary_abbreviation. Add {abbreviation: 'IMH', full_term: 'Isomolecular Hormones', term_slug: 'isomolecular-hormones'}. Six Part III terms have this same gap (IMH, HMA, CPRT, CERT, ARPR, ccHRT), so fix them as one batch.

---

### `live-birth` — definition_drift  ·  Part III

**Field:** `body_html`

**Current:** Live birth is the complete expulsion or extraction from a woman of a fetus, irrespective of the duration of the pregnancy, which after such separation breathes or shows any other sign of life (heartbeat, umbilical cord pulsation, or definite movement of voluntary muscles), whether or not the umbilical cord has been cut or the placenta is attached. This definition is harmonized across the World Health Organization, ICD-10, ICD-11, MeSH, and the National Cancer Institute Thesaurus

**Evidence:** Live birth: the complete expulsion or extraction from its mother of a product of conception, irrespective of the duration of the pregnancy, which, after such separation, breathes or shows any other evidence of life such as beating of the heart, pulsation of the umbilical cord, or definite movement of voluntary muscles, whether or not the umbilical cord has been cut or the placenta is attached.

**Suggested fix:** The quoted text is a blend of two different official definitions, presented as if it were one harmonized text. The WHO/ICD-10 statistical definition says 'from its mother of a product of conception' and 'evidence of life'; the ICD-11 Reference Guide says 'from a woman of a fetus' and 'shows signs of life' but omits the enumerated signs and the cord/placenta clause entirely. The glossary takes ICD-11's opening and 'sign of life', then appends the WHO/ICD-10 enumerations. Fix by quoting one source verbatim and attributing it, then noting the ICD-11 variant separately, and soften 'harmonized across' to 'substantively consistent across'. Also attach a citation: this definitional paragraph and th

---

### `marquette-protocol` — abbreviation_error  ·  Part III

**Field:** `body_html`  ·  **ref#134**

**Current:** a device that reads urinary levels of estrone-3-glucuronide (E1G) and luteinizing hormone (LH)

**Evidence:** Both the CBFM and Mira measure estrone-3-glucuronide (E3G), the urinary metabolite of estrogen, and luteinizing hormone (LH) in the urine...

**Suggested fix:** Same nonstandard abbreviation as in sympto-hormonal-method. Fehring's own Marquette publications and Clearblue's materials both use E3G. Change to E3G here and in sympto-hormonal-method, and add an E3G row to glossary_abbreviation.

---

### `reproductive-health-research-institute` — internal_inconsistency  ·  Part III

**Field:** `body_html`  ·  **ref#145**

**Current:** RHRI is the academic arm of the [FEMM] framework.

**Evidence:** FEMM was developed through the Reproductive Health Research Institute and is taught through a tiered curriculum for both patients and clinicians.

**Suggested fix:** Reverses the parent/child relationship stated by three sibling glossary terms. The Part II term femm says FEMM 'was developed through the Reproductive Health Research Institute'; femm-medical-management says FEMM Medical Management 'is developed and supported by the Reproductive Health Research Institute (RHRI)'; femm-levels says the same. RHRI's own site describes itself as 'the research partner for Fertility Education and Medical Management (FEMM)'. Pick one formulation and apply it glossary-wide; 'RHRI is the research and training organization behind FEMM' satisfies all four terms and RHRI's own wording.

---

### `reproductive-health-research-institute` — unsupported_attribution  ·  Part III

**Field:** `body_html`

**Current:** RHRI's research has helped establish that cycles characterized by chronic anovulation carry long-term health implications beyond infertility, including elevated risk for metabolic and cardiovascular disease.

**Evidence:** RHRI's research has helped establish that cycles characterized by chronic anovulation carry long-term health implications beyond infertility, including elevated risk for metabolic and cardiovascular disease.

**Suggested fix:** This entire paragraph carries no citation. It makes a specific cardiometabolic risk claim and attributes its establishment to one named institute. Either cite the specific RHRI-authored publications, or soften the attribution to 'RHRI's published work addresses the health significance of chronic anovulation' and cite the underlying anovulation/cardiometabolic literature separately. As written it is the kind of uncited institutional claim that fails an external fact-check.

---

### `rrm-outcomes-published-evidence` — imprecise_attribution  ·  Part III

**Field:** `body_html`

**Current:** These rates compare favorably to IVF, which the HFEA reports at approximately 33% per embryo transferred

**Evidence:** HFEA 2019 data: the Boyle comparison year benchmarks || HFEA Fertility Treatment 2019: Trends and Figures (published May 2021); HFEA 2023 report historical data || HFEA 2019: 33.7% fresh ET birth rate under 35 (per ET), 6% multiple birth rate

**Canon:** IVF comparisons must state the per-cycle versus per-transfer basis (acog-asrm-rebuttal PG-F4)

**Suggested fix:** The 33% figure is unqualified and therefore unverifiable as stated. HFEA publishes materially different per-embryo-transferred birth rates depending on year, fresh versus frozen, and age band. The RRM SSOT holds two separate 33%-ish figures: 33.7% for fresh embryo transfer in the UNDER-35 band (2019) and 33% for frozen embryo transfer all ages (2023); the all-ages fresh figure is lower. Add the qualifier, for example 'approximately 34% per fresh embryo transferred for women under 35 (HFEA 2019)', and pick the year that matches the RRM cohort being compared, which for Boyle et al. is 2019. An unqualified 33% also understates RRM's comparative position across the full age distribution.

---

### `rrm-outcomes-published-evidence` — missing_citation  ·  Part III

**Field:** `body_html`

**Current:** entire term contains zero reference anchors

**Evidence:** Boyle et al. (2025, Journal of Restorative Reproductive Medicine, n=187, NeoFertility Dublin) reported a crude live birth rate of 41%, with a preterm birth rate in singletons of 4.0%.

**Suggested fix:** This is the single most citation-critical term in Part III: it is a roundup of four study attributions, seven percentages, two sample sizes, and an HFEA benchmark, and it carries no reference anchors at all. Every other outcome-bearing term in this part cites. Attach refs for all four studies (ref 93 already exists for Sanchez-Mendez, ref 126 for Tham, ref 132 for Boyle) plus a dated HFEA report reference, and add the ref for the corrected Stanford entries.

---

### `sympto-hormonal-method` — abbreviation_error  ·  Part III

**Field:** `body_html`  ·  **ref#134**

**Current:** estrone-3-glucuronide (E1G), a urinary estrogen metabolite

**Evidence:** Both the CBFM and Mira measure estrone-3-glucuronide (E3G), the urinary metabolite of estrogen, and luteinizing hormone (LH) in the urine...

**Suggested fix:** Estrone-3-glucuronide is abbreviated E3G in the Marquette literature, in Fehring's own papers, and in Clearblue's product materials. E1G is nonstandard here and appears in this term three times and in the marquette-protocol term once. Change all occurrences to E3G and add an E3G row to glossary_abbreviation (currently absent).

---

### `afc` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#77**

**Current:** It reflects the number of follicles beginning development at the start of that cycle and serves as a marker of ovarian reserve alongside AMH and FSH.[ref-77][ref-101]

**Evidence:** It reflects the number of follicles beginning development at the start of that cycle and serves as a marker of ovarian reserve alongside AMH and FSH.

**Suggested fix:** ref-77 is Yin WW et al., 'The effect of medication on serum anti-Mullerian hormone (AMH) levels in women of reproductive age: a meta-analysis'. It studies how drugs move AMH; it says nothing about AFC as an ovarian reserve marker. ref-101 (Steiner 2017, JAMA, biomarkers of ovarian reserve and infertility) carries this claim on its own. Drop ref-77 here.

---

### `amh` — internal_contradiction  ·  Part IV

**Field:** `body_html`  ·  **ref#404**

**Current:** Its serum level reflects the size of the pool of small growing follicles and stays relatively steady across the cycle.[ref-265]

**Evidence:** Its serum level reflects the size of the pool of small growing follicles and stays relatively steady across the cycle.

**Suggested fix:** Two sentences later the term cites ref-404, whose title is 'Anti-Mullerian Hormone During Natural Cycle Presents Significant Intra and Intercycle Variations When Measured With Fully Automated Assay' (Melado 2018). The glossary asserts stability while citing, in the same paragraph, the paper that found the opposite. Rewrite as: 'AMH is less cycle-dependent than FSH or estradiol, though modern automated assays show measurable intra-cycle and between-cycle variation.' That preserves the clinical point and stops the citation from contradicting the sentence above it.

---

### `amh` — citation_weak_support  ·  Part IV

**Field:** `body_html`  ·  **ref#405**

**Current:** It may shift when correctable contributors are identified and addressed.[ref-405]

**Evidence:** It may shift when correctable contributors are identified and addressed.

**Suggested fix:** ref-405 is Lerchbaum 2021, a vitamin D RCT in PCOS women. The vitamin D and AMH literature is directionally inconsistent, and in PCOS supplementation has been reported to LOWER AMH, which is the opposite reading of 'a correctable contributor moving the marker in the desired direction'. Move this claim onto ref-410 (Moridi 2020 systematic review and meta-analysis) alone, or re-anchor to ref-267 (Younis 2022, endometrioma surgery effect on AMH and AFC), which is a cleaner example of an identifiable contributor changing the measured value.

---

### `amh` — cross_term_inconsistency  ·  Part IV

**Field:** `body_html`  ·  **ref#77**

**Current:** A meta-analysis found DHEA supplementation was associated with higher serum AMH in women with diminished ovarian reserve, though the effect was weaker when limited to randomized trials.[ref-77]

**Evidence:** A meta-analysis found DHEA supplementation was associated with higher serum AMH in women with diminished ovarian reserve, though the effect was weaker when limited to randomized trials.

**Suggested fix:** The same reference (ref-77) is described very differently in the ovarian-reserve term, which states 'In documented low-DHEA-S cases, a meta-analysis of 8 studies found DHEA supplementation significantly raised AMH'. One term hedges on the RCT subset, the other asserts significance and adds a low-DHEA-S restriction that is not in the paper. Align both terms to a single characterization. This term's hedged wording is the safer one; note that per Perplexity the RCT-only null result may come from a later focused review rather than from ref-77 itself, so verify which paper carries it before publishing that clause.

---

### `emma-alice` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#65**

**Current:** No published RCT has established the clinical utility of routine endometrial microbiome testing.[ref-65]

**Evidence:** Controlled trial data supporting this approach remain limited. No published RCT has established the clinical utility of routine endometrial microbiome testing.

**Suggested fix:** ref-65 is Moreno I et al. 2016 (AJOG), the observational study that generated the field. A single 2016 observational paper cannot support an absence-of-evidence claim about the RCT literature that came after it. Either cite a recent systematic review of endometrial microbiome testing (registry-verify the identifier first) or drop the citation and rephrase to what can be sourced: 'The evidence base remains observational; ref-65 is the study that generated the hypothesis.'

---

### `era` — markup_defect  ·  Part IV

**Field:** `body_html`  ·  **ref#25**

**Current:** An earlier observational study (ref-25) reported

**Evidence:** <p>An earlier observational study (ref-25) reported improved outcomes in a retrospective cohort with recurrent implantation failure.

**Suggested fix:** A raw internal citation token '(ref-25)' is rendering as literal body text. The properly formatted superscript anchor for ref-25 already appears at the end of the same paragraph, so this is a duplicate. Delete the '(ref-25)' string.

---

### `follicle-maturation-study` — abbreviation_mismatch  ·  Part IV

**Field:** `body_html`

**Current:** Partial Rupture Syndrome (PRS); Delayed Rupture Syndrome (DRS); Empty Follicle Syndrome (EFS); Immature Follicle Syndrome (IFS); and complete absence of follicular development, classified as Afollicularism (AF)

**Evidence:** These include the luteinized unruptured follicle (LUF) syndrome, in which the follicle luteinizes without releasing the oocyte; Partial Rupture Syndrome (PRS); Delayed Rupture Syndrome (DRS); Empty Follicle Syndrome (EFS); Immature Follicle Syndrome (IFS); and complete absence of follicular development, classified as Afollicularism (AF).

**Canon:** abbreviations.json contains rows for LUF, DOR, POI, WOI, SIS, HSG, S-MAP but none for FMS, PRS, DRS, EFS, IFS, AF

**Suggested fix:** Six abbreviations are introduced here (FMS, PRS, DRS, EFS, IFS, AF) and none has a glossary_abbreviation row; only LUF does. Add rows for FMS, PRS, DRS, EFS, IFS, AF with term_slug=follicle-maturation-study (or sonographic-ovulation-classification), or drop the parenthetical abbreviations that are never reused.

---

### `intratubal-pressure` — abbreviation_missing  ·  Part IV

**Field:** `abbreviation`

**Current:** ITP

**Evidence:** Intratubal pressure (ITP) is a quantitative measure of fallopian tube patency obtained by recording the pressure required to advance contrast through the tube during selective hysterosalpingography

**Canon:** abbreviations.json (70 rows) contains no ITP entry

**Suggested fix:** The term declares abbreviation ITP and introduces it in the body, but abbreviations.json has no ITP row. Add: ITP -> Intratubal Pressure, term_slug=intratubal-pressure. Note ITP also collides with the common haematology abbreviation for immune thrombocytopenic purpura, so the full_term field should be explicit.

---

### `laparoscopy-diagnostic` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#325**

**Current:** Surgeons generally consider laparoscopy when there is clinical suspicion of the disease, pelvic adhesions, or other structural pathology that imaging cannot adequately characterize.[ref-325]

**Evidence:** Surgeons generally consider laparoscopy when there is clinical suspicion of the disease, pelvic adhesions, or other structural pathology that imaging cannot adequately characterize.

**Canon:** ESHRE guideline: endometriosis 2022 (Becker CM et al., PMID 35350465)

**Suggested fix:** ref-325 is the ESHRE 2022 endometriosis guideline, which specifically de-ranked diagnostic laparoscopy and recommends imaging first, reserving laparoscopy for negative imaging or failed empirical treatment. It does not support 'surgeons generally consider laparoscopy when there is clinical suspicion.' Keep the RRM position but stop sourcing it to ESHRE: re-anchor the indication statement to RRM surgical sources (Hilgers NaProTECHNOLOGY Ch. 63, in-library) and to ref-422 (Maheux-Lacroix 2020) for the imaging-miss rate. ESHRE 2022 is cited seven times in this term and is carrying claims it does not make.

**Adversarial verdict:** DOWNGRADE — Quote verifies: after stripping the <sup>/<a> tags the sentence appears verbatim in terms-part-IV.json, and ref-325 does resolve to the ESHRE 2022 guideline (Becker CM et al., Hum Reprod Open 2022, PMID 35350465, DOI 10.1093/hropen/hoac009, PMC8951218) which I registry-verified via PubMed esummary and whose full text I pulled from EuropePMC. The finding is PARTLY right and materially overstated. R

**Corrected fix:** Do not strip ESHRE from this sentence and do not send the imaging-miss claim to ref-422. Narrow the sentence to what ref-325 actually carries and move the unsupported half elsewhere. Suggested rewrite: 'Surgeons consider laparoscopy when imaging is negative or cannot characterize the suspected disease, or when empirical medical treatment has failed or is inappropriate.[ref-325] Suspected pelvic ad

---

### `laparoscopy-diagnostic` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#420**

**Current:** The procedure typically runs under general anesthesia.[ref-420]

**Evidence:** The procedure typically runs under general anesthesia.

**Suggested fix:** ref-420 is Afzal B et al., Role of Laparoscopy in Diagnosing and Treating Acute Nonspecific Abdominal Pain (Cureus 2021), a general-surgery acute-abdomen paper. It is off-target for a statement about anesthesia in gynecologic diagnostic laparoscopy. Either drop the citation (the claim is uncontroversial) or cite a gynecologic laparoscopy source.

---

### `laparoscopy-diagnostic` — consensus_conflict  ·  Part IV

**Field:** `body_html`  ·  **ref#325**

**Current:** Diagnostic laparoscopy remains the most accurate way to surgically confirm endometriosis, including the early, subtle, and superficial peritoneal disease that imaging often misses.[ref-325]

**Evidence:** Diagnostic laparoscopy remains the most accurate way to surgically confirm endometriosis, including the early, subtle, and superficial peritoneal disease that imaging often misses.

**Canon:** RRM canon: excision and accurate surgical diagnosis are the standard; mainstream ESHRE 2022 position logged for contrast only

**Suggested fix:** RRM canon holds: surgical visualization with directed biopsy is the accurate diagnosis for superficial peritoneal disease, and the term's qualifier 'surgically confirm' is defensible. Mainstream ESHRE 2022 disagrees on posture, holding that laparoscopy is no longer the diagnostic gold standard and that imaging is comparable for endometrioma and deep disease (note: ESHRE's imaging claim covers endometrioma and DIE, not superficial peritoneal disease, which is exactly RRM's point). Human arbitration required only on whether to keep ESHRE as the citation. Do not weaken the RRM claim.

---

### `near-contact-laparoscopy` — attribution_drift  ·  Part IV

**Field:** `body_html`  ·  **ref#170**

**Current:** The technique was developed to identify subtle endometriotic implants: atypical, early-stage, or non-pigmented lesions that are routinely missed when the camera is positioned at conventional distance from tissue.[ref-170]

**Evidence:** The technique was developed to identify subtle endometriotic implants: atypical, early-stage, or non-pigmented lesions that are routinely missed when the camera is positioned at conventional distance from tissue.

**Canon:** rrm-cli addendum smap-full-name-correction, guidance.when_writing_content: 'Credit Whittaker for the term, Hilgers for the method, Redwine for NCL.'

**Suggested fix:** The RRM SSOT addendum for this technique family states the attribution explicitly: 'Credit Whittaker for the term, Hilgers for the method, Redwine for NCL.' This term credits no one. Add the Redwine attribution for near-contact laparoscopy. CAUTION before publishing a name: the RRM textbook (Ch. 63) states 'Redwine introduced the term near-contact laparoscopy (NCL)', while a Perplexity lookup of ref-170 (PMID 3190209, AORN Journal 1988) returned a different author name. Verify the authorship of ref-170 against the PubMed record before printing any byline; do not propagate the Perplexity-supplied name.

---

### `ovarian-reserve` — uncited_claims  ·  Part IV

**Field:** `body_html`

**Current:** Autoimmune thyroid disease accelerates follicle loss and responds to thyroid optimization. Vitamin D deficiency suppresses AMH and is correctable with repletion. Endometriosis causes direct ovarian damage through endometriomas and surgical scarring.

**Evidence:** Autoimmune thyroid disease accelerates follicle loss and responds to thyroid optimization. Vitamin D deficiency suppresses AMH and is correctable with repletion. Endometriosis causes direct ovarian damage through endometriomas and surgical scarring. Excision addresses the structural source.

**Suggested fix:** This 303-word term carries exactly one citation (ref-77) while making three mechanistic assertions in consecutive sentences. The endometrioma claim is the easiest to fix: ref-267 (Younis JS et al. 2022, Endometrioma surgery: a systematic review and meta-analysis of the effect on antral follicle count and anti-Mullerian hormone) is already in the reference set and directly supports it. Add citations for the thyroid claim or soften it to a workup direction rather than a mechanism.

---

### `peak-plus-series` — internal_contradiction  ·  Part IV

**Field:** `body_html`  ·  **ref#81**

**Current:** The protocol also provides an early-luteal reference point that can confirm whether ovulation occurred, separate from whether the luteal phase was hormonally adequate.[ref-81]

**Evidence:** The protocol also provides an early-luteal reference point that can confirm whether ovulation occurred, separate from whether the luteal phase was hormonally adequate.

**Canon:** ovulation-confirmation term: 'An ovulatory event means luteinization has occurred... Luteinization usually follows oocyte release. But not always.'

**Suggested fix:** This contradicts the ovulation-confirmation term in the same part, which states that a post-Peak progesterone rise confirms an ovulatory event (luteinization) but cannot confirm oocyte release, and that only serial follicle-tracking ultrasound or a resulting pregnancy can. A progesterone draw cannot distinguish ovulation from LUF, which is the whole point of the LUF discussion. Rewrite as: 'provides an early-luteal reference point that documents whether luteinization occurred, separate from whether the luteal phase was hormonally adequate.' Also note ref-81 (Hilgers, Linacre Q 2020) is about identifying postovulation infertility from early luteal progesterone, not about confirming that ovula

---

### `pgt-a` — citation_mismatch  ·  Part IV

**Field:** `body_html`  ·  **ref#430**

**Current:** from an RRM perspective, PGT-A and PGT-M screen embryos for chromosomal or monogenic variants but leave the underlying cause of natural conception failure unaddressed and undiagnosed.[ref-430]

**Evidence:** Both require IVF and embryo biopsy; from an RRM perspective, PGT-A and PGT-M screen embryos for chromosomal or monogenic variants but leave the underlying cause of natural conception failure unaddressed and undiagnosed.

**Suggested fix:** ref-430 is Rasouli MA et al., 'Likelihood of obtaining a usable embryo for transfer after IVF with PGT-A and PGT-M for variants in two genes' (J Assist Reprod Genet). That paper reports embryo-yield probabilities for dual-indication testing; it makes no claim about underlying causes of natural conception failure being left unaddressed. This is an RRM positional statement and should either carry no citation or be anchored to an RRM source such as ref-268 (Boyle 2018), which is already used for the adjacent sentence. Keep the RRM position; fix the attribution.

**Adversarial verdict:** DOWNGRADE — Quote verified verbatim in terms-part-IV.json. The prior reviewer's factual identification of ref-430 is accurate and I confirmed it independently: PMID 42026396 resolves to Rasouli MA, Collins L, Lee M, Martel R, Siavoshi M, Kwan L, et al., 'Likelihood of obtaining a usable embryo for transfer after IVF with PGT-A and PGT-M for variants in two genes', J Assist Reprod Genet 2026;43(6):1749-1755, D

**Corrected fix:** Keep the prior reviewer's core, which is sound: preserve the RRM position verbatim and fix only the attribution, moving the anchor to ref-268 (Boyle 2018), which is already the term's established anchor for this exact position. Add a better second option rather than simply deleting ref-430: re-anchor it to a claim it actually makes. Rasouli 2026 found that testing for variants in two genes signifi

---

### `s-map` — attribution_drift  ·  Part IV

**Field:** `body_html`

**Current:** S-MAP (Systematic Mapping of the Abdomen and Pelvis) is an operative protocol developed within NaProTechnology and refined by IIRRM-trained surgeons

**Evidence:** S-MAP (Systematic Mapping of the Abdomen and Pelvis) is an operative protocol developed within NaProTechnology and refined by IIRRM-trained surgeons that requires a structured, sequential inspection of all abdominal and pelvic regions before any surgical intervention begins.

**Canon:** rrm-cli addendum smap-full-name-correction (effective 2024-11-16): 'The method was described by Hilgers (Ch. 63); the term coined by Dr. Naomi Whittaker.' Citation guidance: 'Cite: Whittaker NM, AAGL 53rd Global Congress on MIGS, Nov 2024.'

**Suggested fix:** The RRM SSOT addendum sets the required attribution: method described by Hilgers (NaProTECHNOLOGY Ch. 63), the term S-MAP coined by Dr. Naomi Whittaker, presented at AAGL 2024 (53rd Global Congress on MIGS, Nov 2024), with Redwine credited for NCL. Replace the vague 'refined by IIRRM-trained surgeons' with that attribution chain and cite Whittaker NM, AAGL 2024 (in library as whittaker-aagl-2024-smap-ncl). Separately, the closing claim that training 'is delivered through the IIRRM surgical training program' is an institutional assertion with no source in the term; verify it exists before publishing or drop it.

---

### `s-map` — uncited_claims  ·  Part IV

**Field:** `body_html`

**Current:** Adhesions, diaphragmatic implants, appendiceal involvement, and upper abdominal disease are found at laparoscopy in a proportion of patients with pelvic pain or infertility that would surprise a surgeon who only looks where the patient reports pain.

**Evidence:** Adhesions, diaphragmatic implants, appendiceal involvement, and upper abdominal disease are found at laparoscopy in a proportion of patients with pelvic pain or infertility that would surprise a surgeon who only looks where the patient reports pain.

**Canon:** rrm-cli fact smap-definition, short_citation: 'Hilgers TW, NaProTECHNOLOGY textbook Ch. 63, 2004; Whittaker NM, AAGL 2024 case series'

**Suggested fix:** This 295-word term carries ZERO citations, the only such term in Part IV, while making clinical, epidemiologic and institutional claims. At minimum cite Hilgers NaProTECHNOLOGY Ch. 63 and the Whittaker AAGL 2024 case series, both already in the RRM library. The AAGL case series is the natural support for upper-abdominal and appendiceal findings: per the SSOT addendum it documents 4 cancers (3 neuroendocrine tumors of the appendix plus 1 WDPM) over 3 years found via systematic mapping and near-contact technique. Note the addendum's correction: 4 cancers over 3 years, NOT 'three appendiceal cancers in six months'.

---

### `sonographic-ovulation-classification` — wrong_mechanism  ·  Part IV

**Field:** `body_html`  ·  **ref#78**

**Current:** Afollicularism and empty follicle syndrome represent the most severe end of the spectrum, overlapping with anovulatory cycle physiology.

**Evidence:** Afollicularism and empty follicle syndrome represent the most severe end of the spectrum, overlapping with anovulatory cycle physiology.

**Canon:** rrm-cli chapter-20 section II.A: 'A mature follicle (with a MFD greater than or equal to 1.90 cm) in which the cumulus oophorus is either absent or retained (MF: -, Re). These follicles are observed to completely rupture over 24 hours.'

**Suggested fix:** Afollicularism does overlap with anovulatory physiology (no follicle reaches dominance). The empty follicle does not: per Hilgers these are MATURE follicles that are 'observed to completely rupture over 24 hours' and go on to form a corpus luteum. Grouping them together as the most severe end and as anovulatory-overlapping is mechanistically wrong and undercuts the clinical point that an empty follicle looks like a fully normal ovulation on every other parameter. Separate the two: keep afollicularism in the anovulatory-overlap sentence and describe the empty follicle as a cycle that appears ovulatory in every respect except the cumulus sign.

---

### `transcervical-catheterization` — internal_contradiction  ·  Part IV

**Field:** `body_html`  ·  **ref#161**

**Current:** Where obstruction is complete rather than partial, TCFT findings inform the decision for surgical recanalization via fallopian tube recanalization.[ref-161]

**Evidence:** Where obstruction is complete rather than partial, TCFT findings inform the decision for surgical recanalization via fallopian tube recanalization.

**Suggested fix:** Circular ('surgical recanalization via fallopian tube recanalization') and contradictory: the selective-salpingography term defines fallopian tube recanalization as the transcervical, NON-surgical catheter procedure ('offers a minimally invasive restorative option', 'without surgery'). The same phrase cannot name both the non-surgical catheter technique and the surgical fallback. Pick one referent across the glossary. Suggested: 'Where obstruction is complete rather than partial, TCFT findings inform the decision for surgical evaluation, such as tubal anastomosis or resection of the obstructed segment.' The intratubal-pressure term carries the same conflation and should be fixed with it.

---

### `transcervical-catheterization` — abbreviation_missing  ·  Part IV

**Field:** `abbreviation`

**Current:** TCFT

**Evidence:** Transcervical catheterization of the fallopian tubes (TCFT) is a procedure that advances a specialized catheter-guidewire system through the cervix and uterine cavity to the uterotubal junction

**Canon:** abbreviations.json (70 rows) contains no TCFT entry

**Suggested fix:** The term declares abbreviation TCFT and introduces it in the body, but abbreviations.json has no TCFT row. Add: TCFT -> Transcervical Catheterization of the Fallopian Tubes, term_slug=transcervical-catheterization.

---

### `excision-surgery` — evidence_overstatement  ·  Part V

**Field:** `body_html`  ·  **ref#27**

**Current:** The clinical case for excision rests on outcome data. A cohort comparison found that excision improved outcomes across all 63 symptom measures evaluated, with improvements ranging from 28% to 46%.

**Evidence:** The clinical case for excision rests on outcome data. A cohort comparison found that excision improved outcomes across all 63 symptom measures evaluated, with improvements ranging from 28% to 46%.

**Canon:** RRM canon: excision is the standard position. This fix strengthens rather than softens it by moving the load onto the RCT meta-analysis.

**Suggested fix:** The underlying study is a crowd-sourced retrospective patient-PERCEPTION survey (title verified via NCBI: "A Crowd-Sourced Comparative Evaluation"), not a cohort comparison, and the numbers are self-reported symptom perception, not measured outcome data. Rewrite as: "In a crowd-sourced patient survey of respondents who underwent both procedures, excision was reported to improve every symptom domain assessed, by 28% to 46%." Drop "rests on outcome data" and lead the paragraph with Pundir 2017 (ref 28), which is an RCT meta-analysis and carries the real evidentiary weight. Also note the "63 symptom measures" count does not appear in the primary abstract (which says "across all symptoms"); it a

**Adversarial verdict:** DOWNGRADE — Quote confirmed verbatim in terms-part-V.json. But the finding's two load-bearing claims are both refuted by the primary source, which I pulled directly via NCBI efetch (not via Perplexity). (1) 'Not a cohort comparison' is wrong: the authors' own abstract DESIGN field reads 'A Cohort, Method comparison Questionnaire-based study' and the CONCLUSION opens 'In this cohort of patients undergoing lapa

**Corrected fix:** Do NOT apply the original suggested_fix; it asserts two things the primary abstract contradicts. Keep the word cohort (the authors' own DESIGN label) and keep the 63 count (it is verbatim in the abstract). Correct only the scope conflation. Replace the two sentences with: 'The clinical case for excision rests on outcome data. A cohort questionnaire study of 232 patients who had undergone both proc

---

### `hysteroscopic-septoplasty` — internal_contradiction  ·  Part V

**Field:** `body_html`

**Current:** It is the definitive surgical treatment for septate uterus.

**Evidence:** It is the definitive surgical treatment for septate uterus.</p><p>The procedure ... Evidence from randomized trials, including the TRUST trial, has been inconclusive regarding reproductive benefit, and current recurrent pregnancy loss guidelines offer hysteroscopic septoplasty alongside expectant management as a clinical option rather than a proven intervention.

**Suggested fix:** The opening calls the procedure definitive; two paragraphs later the same entry calls it unproven. A reader gets opposite answers from one page. Resolve by scoping the first claim to anatomy: 'It is the definitive procedure for correcting the septum itself,' then let the third paragraph carry the reproductive-outcome discussion. That preserves the RRM position without the page arguing with itself.

---

### `hysteroscopic-septoplasty` — consensus_conflict  ·  Part V

**Field:** `body_html`

**Current:** Evidence from randomized trials, including the TRUST trial, has been inconclusive regarding reproductive benefit, and current recurrent pregnancy loss guidelines offer hysteroscopic septoplasty alongside expectant management as a clinical option rather than a proven intervention. In Restorative Reproductive Medicine, hysteroscopic septoplasty is a standard corrective procedure for recurrent pregnancy loss patients with a confirmed uterine septum identified on workup.

**Evidence:** Evidence from randomized trials, including the TRUST trial, has been inconclusive regarding reproductive benefit, and current recurrent pregnancy loss guidelines offer hysteroscopic septoplasty alongside expectant management as a clinical option rather than a proven intervention.

**Canon:** consensus_conflict rule: P2 only, log both sides verbatim, never mark RRM canon wrong because mainstream disagrees. Human arbitrates.

**Suggested fix:** HUMAN DECISION REQUIRED. Both positions are logged above verbatim. The exposure is narrow and specific: the entry characterises the mainstream evidence as 'inconclusive' and describes guidelines as offering the procedure 'alongside expectant management as a clinical option', when TRUST's authors explicitly recommended against routine resection and ESHRE does not recommend it routinely. That characterisation is easy to attack and, if corrected, does not weaken the RRM position at all. Recommended shape for arbitration: state the mainstream finding accurately and by name (TRUST, n=79, live birth 31% vs 35%, underpowered, recruitment over eight years), then state the RRM rationale for correctin

---

### `hysteroscopic-septoplasty` — uncited  ·  Part V

**Field:** `body_html`

**Current:** Evidence from randomized trials, including the TRUST trial, has been inconclusive regarding reproductive benefit, and current recurrent pregnancy loss guidelines offer hysteroscopic septoplasty alongside expectant management as a clinical option

**Evidence:** Deterministic scan: 'ref-' does not appear anywhere in this term's body_html.

**Suggested fix:** The entry names a specific randomized trial and characterises current guideline positions with zero citations. A named trial and a guideline attribution both require references. Add the TRUST results paper (Rikken et al., septum resection versus expectant management, Human Reproduction 2021) and the ESHRE recurrent pregnancy loss guideline. VERIFY BOTH IDENTIFIERS DIRECTLY AGAINST PUBMED BEFORE PUBLISHING: I confirmed the trial's existence, findings and quoted conclusions through Perplexity but did not independently resolve a PMID or DOI for the results paper, so do not paste an identifier on my word.

---

### `laparoscopic-ovarian-wedge-resection` — anatomy_drift  ·  Part V

**Field:** `body_html`

**Current:** a wedge-shaped section of androgen-producing ovarian cortex is removed laparoscopically

**Evidence:** Laparoscopic Ovarian Wedge Resection (LOWR) is a surgical procedure in which a wedge-shaped section of androgen-producing ovarian cortex is removed laparoscopically to normalize hormonal balance and restore ovulation in select patients with PCOS.

**Suggested fix:** Wedge resection is a full-thickness wedge, and the dominant androgen source in PCOS is the theca cell compartment and hyperplastic stroma rather than cortex per se. Rewrite the definition to: 'a full-thickness wedge of ovarian tissue, including the thickened cortex and the underlying androgen-producing stroma, is removed laparoscopically'. Small change, but this is the term's defining sentence.

---

### `microsurgery` — study_design_error  ·  Part V

**Field:** `body_html`  ·  **ref#33**

**Current:** Earlier prospective series confirm the technique is durable.<sup class="cite-ref"><a href="#ref-32">32</a></sup><sup class="cite-ref"><a href="#ref-33">33</a></sup>

**Evidence:** Earlier prospective series confirm the technique is durable.

**Suggested fix:** Both cited studies are retrospective, not prospective. Ref 33's own title contains the word 'retrospective'; ref 32 (Berger 2016) is a retrospective review of a large outpatient practice. Change to 'Earlier retrospective series report durable results' or simply 'Published series report durable results'. Mislabelling retrospective data as prospective is the kind of error a hostile reviewer will use to discredit the whole entry.

**Adversarial verdict:** DOWNGRADE — Quote check passes, but the finding's central premise is false and its suggested_fix would introduce a new error into the glossary. The reviewer asserts 'Both cited studies are retrospective, not prospective' and characterises ref 32 as 'a retrospective review of a large outpatient practice.' I fetched ref 32 directly from NCBI (PMID 26980770, Berger GS, Thorp JM Jr, Weaver MA, Hum Reprod 2016;31(

**Corrected fix:** Do NOT apply the suggested fix; ref 32 is prospective and relabelling it retrospective would understate the evidence. Two acceptable repairs. Preferred, state the evidence instead of characterising it: 'A prospectively followed cohort of 6,692 outpatient anastomoses reported a 69% pregnancy rate and a 35% live birth rate, and a later laparoscopic series reported a 55.5% pregnancy rate.' Minimal, i

---

### `near-adhesion-free-pelvic-surgery` — abbreviation_missing  ·  Part V

**Field:** `abbreviation`

**Current:** NARPS (set on the term row; no matching glossary_abbreviation row exists)

**Evidence:** abbreviations.json contains 70 rows and NARPS is absent from the list; the closest surgical entries present are 'MIGS' and 'TLA / TT anastomosis'.

**Suggested fix:** Add a glossary_abbreviation row: NARPS = Near Adhesion-Free Reconstructive Pelvic Surgery, term_slug near-adhesion-free-pelvic-surgery.

---

### `pelvic-excision-and-repair-surgery` — abbreviation_missing  ·  Part V

**Field:** `abbreviation`

**Current:** PEARS (set on the term row; no matching glossary_abbreviation row exists)

**Evidence:** abbreviations.json contains 70 rows: ['5-MTHF','AAFCP','AFC','ALICE','AMH','APS','ART','BBT','BIP','BMI','CE','CL','CLD','CrMS','DHEA','DOR','DPO','EMMA','ERA','ESP','FABM','FABMs','FCP','FEMM','FSH','hCG','HRT','HSG','ICSI','IUD','IUI','IVF','LDN','LH','LOWR','LP','LPD','LUF','MCS','MIGS','MTHFR','NaPro','NFP','NFPMC','NK cells','OAT','OC','OHSS','PCOS','PGT-A','PMB','PMS','POC','POI','RHRI','RIF','RMT','ROS','RPL','RRM','S-MAP','SDF / DFI','SIS','STM','TEB','TLA / TT anastomosis','TSH','TTP','VDRS','WOI'] - PEARS is absent.

**Suggested fix:** Add a glossary_abbreviation row: PEARS = Pelvic Excision And Repair Surgery, term_slug pelvic-excision-and-repair-surgery. The sibling LOWR term has its row; PEARS and NARPS are the only two abbreviated terms in Part V without one.

---

### `tubal-ligation-reversal` — unsupported_claim  ·  Part V

**Field:** `body_html`

**Current:** Women under 37 at time of reversal have the highest cumulative pregnancy rates in comparative series.

**Evidence:** Women under 37 at time of reversal have the highest cumulative pregnancy rates in comparative series.

**Suggested fix:** This sentence carries no citation and the two nearest cited papers do not contain the 37-year cutoff. Berger 2016 (ref 32) stratifies at under 30 ('Women under 30 years of age at reversal of ring/clip sterilizations had an 88% pregnancy rate and 62% birth rate'). The <37 figure originates in an IVF-versus-reversal comparative cohort. Either attach the correct primary citation (identify and verify it directly against PubMed before publishing; I did not independently confirm which paper it is) or rewrite to what the cited sources do say: pregnancy and birth rates decline steadily as age at reversal increases.

---

### `anovulatory-cycles` — citation_mismatch  ·  Part VI-A

**Field:** `body_html`  ·  **ref#117**

**Current:** Anovulation is one of the most common causes of female <a href="#infertility" class="gloss-xref">infertility</a>, accounting for roughly 30% of cases. The absence of ovulation means the <a href="#corpus-luteum" class="gloss-xref">corpus luteum</a> never forms, progesterone is not produced, and the <a href="#luteal-phase" class="gloss-xref">luteal phase</a> does not occur.<sup class="cite-ref"><a href="#ref-117">117</a></sup>

**Evidence:** 36833150 | Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of Infertility in Polycystic Ovary Syndrome-Case Report.

**Suggested fix:** A 30% epidemiologic figure is anchored to a single case report. The number itself is defensible: Thonneau 1991, already in the glossary reference set as ref 395, reports verbatim 'The main causes of female infertility were ovulation disorders (32%) and tubal damage (26%)' (verified via PubMed efetch, PMID 1757519). Re-anchor the 30% claim to ref 395 and keep ref 117 for the RRM-practice sentences only.

**Adversarial verdict:** DOWNGRADE — The quoted glossary passage is verbatim present in terms-part-VI-A.json, slug anovulatory-cycles. ref 117 verified via NCBI efetch as PMID 36833150, Kicinska AM, Stachowska A, Kajdy A, Wierzba TH, Maksym RB, 'Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of Infertility in Polycystic Ovary Syndrome-Case Report', Healthcare (Basel). 2023 Feb 18;11(4):616, doi 10.3390/healt

**Corrected fix:** Re-anchor as the prior reviewer proposes, but their fix as written would introduce a subtle category mismatch that must be corrected first. Thonneau (ref 395) measured 'ovulation disorders (32%)', a broader category that includes oligo-ovulation, luteal phase deficiency and LUF, whereas the glossary sentence says 'Anovulation ... accounting for roughly 30% of cases'. Attaching ref 395 to the narro

---

### `anovulatory-cycles` — reference_metadata  ·  Part VI-A

**Field:** `references`  ·  **ref#117**

**Current:** 117: Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of Infertility in Polycystic Ovary Syndrome. | J:Healthcare (Basel) | https://pubmed.ncbi.nlm.nih.gov/36833150/

**Evidence:** Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of Infertility in Polycystic Ovary Syndrome-Case Report.

**Suggested fix:** The stored anchor_text drops the '-Case Report' suffix from the real PubMed title, which hides the evidence level from any reader checking the citation. Ref 117 is also cited in the pcos term. Restore the full title so the design is visible wherever it is cited.

---

### `corpus-luteum` — numeric_drift  ·  Part VI-A

**Field:** `body_html`  ·  **ref#122**

**Current:** hCG from the implanting trophoblast binds to CL receptors and rescues the structure from its programmed regression, sustaining progesterone production until the placenta assumes that function at approximately 8 to 10 weeks of gestation.<sup class="cite-ref"><a href="#ref-122">122</a></sup>

**Evidence:** STUDY DESIGN : Twenty-five normally cycling women in whom the midcycle urinary luteinizing hormone surge (luteal day 0) was identified ... were prospectively randomized to receive no treatment (group I, n = 5) or exogenous human chorionic gonadotropin 5000 IU

**Suggested fix:** Two problems in one sentence. (1) Ref 122 (PMID 1530028) studied exogenous hCG in non-pregnant normally cycling women; it establishes age-dependent corpus luteum responsiveness to hCG but says nothing about gestational weeks or placental takeover, so it cannot carry the second half of the sentence. (2) The best-supported luteal-placental shift window is 7 to 9 weeks (Csapo luteectomy evidence: loss before ~7 weeks, no effect after ~9 weeks), not 8 to 10. Change to 'approximately 7 to 9 weeks of gestation' and attach a source that addresses the luteal-placental shift; keep ref 122 on the hCG-rescue half only. I did not independently retrieve Csapo's original papers, so verify any replacement 

---

### `endometrioma` — evidence_strength  ·  Part VI-A

**Field:** `body_html`  ·  **ref#38**

**Current:** A 2024 Cochrane review confirms excision reduces recurrence rates compared to drainage and ablation.<sup class="cite-ref"><a href="#ref-38">38</a></sup>

**Evidence:** AUTHORS' CONCLUSIONS : Surgical management of endometrioma with excision (cystectomy) may be more effective than drainage and ablation for reducing painful menstrual periods, pain during sexual intercourse, endometrioma recurrence, and the need for further endometrioma surgery.

**Canon:** RRM canon: excision is the standard. This fix keeps excision superior and adds the numbers, rather than hedging.

**Suggested fix:** The 2024 Cochrane review is real and correctly dated (verified: PMID 39588841, Kalra R, McDonnell R, Stewart F, Hart RJ, Cochrane Database Syst Rev, 2024 Nov 26) and its direction favors excision, but it grades the recurrence finding as low-certainty ('may reduce the risk of endometrioma recurrence ... OR 0.17, 95% CI 0.09 to 0.34; 4 studies, 264 women; low-certainty evidence'). Replace 'confirms' with the review's own strength, e.g. 'A 2024 Cochrane review found excision reduces endometrioma recurrence compared with drainage and ablation (OR 0.17), and also reduced recurrent dysmenorrhoea and dyspareunia.' Quoting the effect sizes is stronger than the word 'confirms' and is attack-proof.

---

### `endometriosis` — citation_precision  ·  Part VI-A

**Field:** `body_html`  ·  **ref#315**

**Current:** Hormonal suppression can reduce pain and lower the rate of symptom and endometrioma recurrence.<sup class="cite-ref"><a href="#ref-315">315</a></sup>

**Evidence:** 315: Zakhari A, Delpero E, McKeown S, Tomlinson G, Bougie O, Murji A Endometriosis recurrence following post-operative hormonal suppression: a systematic review and meta-analysis. Human reproduction update. 2021.

**Canon:** RRM canon: hormonal suppression is not curative and must never read as equivalent to excision. The unqualified sentence drifts toward that reading; the qualifier restores it.

**Suggested fix:** The cited meta-analysis measures recurrence after surgery, in patients who have already had disease excised. As written, the sentence reads as suppression lowering recurrence on its own, which is a canon-risk framing. Add the qualifier: 'After surgery, hormonal suppression can reduce pain and lower the rate of symptom and endometrioma recurrence.'

---

### `endometriosis` — abbreviation  ·  Part VI-A

**Field:** `body_html`

**Current:** including the approaches defined here as <a href="#pelvic-excision-and-repair-surgery" class="gloss-xref">PEARS</a>, <a href="#near-adhesion-free-pelvic-surgery" class="gloss-xref">NARPS</a>, and <a href="#s-map" class="gloss-xref">S-MAP</a>

**Evidence:** PEARS (Pelvic Excision and Repair Surgery) is a form of plastic reconstructive surgery of the pelvis whose primary intent is to remove disease present within the pelvic organs and repair it in such a fashion so as not to form pelvic adhesions.

**Suggested fix:** PEARS and NARPS are introduced as bare acronyms with no expansion and have no rows in glossary_abbreviation (S-MAP does: 'S-MAP | Systematic Mapping of the Abdomen and Pelvis'). Add abbreviation rows. PEARS expands to 'Pelvic Excision and Repair Surgery' per Hilgers Chapter 70 (verified in the RRM library corpus); NARPS expands to 'Near Adhesion-Free Reconstructive Pelvic Surgery' per the title of ref 80.

---

### `isthmocele` — abbreviation  ·  Part VI-A

**Field:** `body_html`

**Current:** Transvaginal ultrasound (TVUS) and saline infusion sonohysterography (SIS) are the preferred initial imaging tools.

**Evidence:** SIS          | Saline Infusion Sonohysterogram | slug=sis

**Suggested fix:** TVUS is introduced with an expansion but has no glossary_abbreviation row; add 'TVUS | Transvaginal Ultrasound'. Separately, the body expands SIS as 'saline infusion sonohysterography' while the abbreviation row stores 'Saline Infusion Sonohysterogram'. Pick one expansion and use it in both places (the uterine-septum term uses the -graphy form as well, so the row is the outlier).

---

### `luteal-phase-deficiency` — internal_consistency  ·  Part VI-A

**Field:** `body_html`  ·  **ref#45**

**Current:** The NaProTechnology post-Peak duration threshold for a short luteal phase is 8 days, not the older luteal-phase criterion anchored to BBT-phase length (Jones 1949). Those criteria measured different endpoints with different methods.

**Evidence:** Type I: The post-Peak phase is short (≤ 8 days in duration) estimating a short luteal phase. The last progesterone level prior to the onset of menstruation is ≤ 2.0 ng/mL.

**Canon:** NaProTechnology positioning must not be hedged; the 8-day post-Peak threshold is correct as stated and should stay.

**Suggested fix:** The 8-day figure is CORRECT and verified against the primary NaPro source. The problem is that the sibling term shortened-luteal-phase defines a shortened luteal phase as 'fewer than 11 days' measured from Peak Day, i.e. it applies a different threshold to the same post-Peak endpoint that this term warns must not be conflated. Add a one-line cross-reference here stating which threshold applies to which measurement, and fix the sibling term. Note also that the '11 days' figure is not only the BBT criterion: ASRM 2021 (ref 45/369) defines LPD by 'an abnormal luteal phase length of ≤10 days', which is a third standard now live in the glossary.

---

### `luteal-phase-deficiency` — consensus_conflict  ·  Part VI-A

**Field:** `body_html`  ·  **ref#369**

**Current:** Luteal Phase Deficiency (LPD), also called luteal phase defect, is a hormonal condition in which the corpus luteum produces insufficient progesterone, the luteal phase is too short, or the endometrium fails to respond adequately to progesterone, impairing implantation and early pregnancy support.

**Evidence:** Although progesterone is important for the process of implantation and early embryonic development, LPD has not been proven to be an independent entity causing infertility or recurrent pregnancy loss. Controversy exists regarding the multiple proposed measures for diagnosing LPD and, assuming it can be diagnosed accurately, whether treatment improves outcomes.

**Canon:** RRM canon: NaProTechnology and RRM positioning must not be hedged or described as unproven. Mainstream disagreement is logged as consensus_conflict at P2 only.

**Suggested fix:** Logged for human arbitration only, NOT a defect in the RRM position. The term cites ASRM refs 45 and 369 as supporting sources while ASRM's 2021 committee opinion (verbatim above, PMID 33827766) holds that LPD is not a proven independent entity and that its diagnosis is contested. Two safe options: (a) keep the RRM position and stop citing ASRM as if it endorses the entity, citing it instead where the term acknowledges heterogeneity, or (b) name the disagreement explicitly in one sentence, which is stronger than citing an opponent as support. Do not soften the RRM position.

---

### `myo-inositol` — source_quality  ·  Part VI-A

**Field:** `references`  ·  **ref#41**

**Current:** 41: Effect of Myo-Inositol in Treating Polycystic Ovary Syndrome (PCOS). | P:Research &amp; Publication Journals | https://respubjournals.com/obstetrics-gynecological-surgery/Effect-of-Myo-Inositol-in-Treating-Polycystic-Ovary-Syndrome-PCOS-A-Review.php

**Evidence:** Evidence supports improvements in LH-to-FSH ratios, reductions in androgen levels, and restoration of more regular ovulation in anovulatory patients.<sup class="cite-ref"><a href="#ref-41">41</a></sup><sup class="cite-ref"><a href="#ref-42">42</a></sup>

**Suggested fix:** Reference 41 is published by respubjournals.com, which is not PubMed-indexed and has no visible peer-review record; it is carrying the term's two central evidence claims alongside ref 42. Replace it with an indexed systematic review or meta-analysis of myo-inositol in PCOS. Do not import a citation from an AI answer without verifying the PMID or DOI directly against PubMed.

---

### `pcos` — citation_support  ·  Part VI-A

**Field:** `body_html`  ·  **ref#392**

**Current:** Clomid functions only as an ovulation stimulus and does not improve the insulin resistance that underlies PCOS, meaning the metabolic dysfunction persists between cycles even when ovulation is achieved.<sup class="cite-ref"><a href="#ref-392">392</a></sup>

**Evidence:** 392: Legro RS, Barnhart HX, Schlaff WD, Carr BR, Diamond MP, Carson SA et al. Clomiphene, metformin, or both for infertility in the polycystic ovary syndrome. The New England journal of medicine. 2007.

**Suggested fix:** Legro 2007 (PPCOS) is a live-birth trial of clomiphene versus metformin versus both; it did not measure insulin resistance as an outcome, so it cannot carry 'does not improve the insulin resistance'. The claim is mechanistically sound (clomiphene is a SERM with no insulin-sensitizing action). Either cite a pharmacology or insulin-sensitizer source for the mechanism half, or split the sentence so ref 392 supports only the ovulation/live-birth half.

---

### `pelvic-adhesions` — canonical_name  ·  Part VI-A

**Field:** `body_html`  ·  **ref#80**

**Current:** Techniques developed within <a href="#near-adhesion-free-pelvic-surgery" class="gloss-xref">near-adhesion-free pelvic surgery</a> protocols ... See also: ... <a href="#near-adhesion-free-pelvic-surgery" class="gloss-xref">Near Adhesion-Free Pelvic Surgery</a>

**Evidence:** 80: Hilgers TW, Stanford JB, Boyle PC, et al. Near Adhesion-Free Reconstructive Pelvic Surgery: Three Distinct Phases of Progress Over 23 Years. J Gynecol Surg. 2010.

**Canon:** Canonical names rule: RRM technique names must match their published form.

**Suggested fix:** The term drops 'Reconstructive' from the technique name, so the glossary calls it 'Near Adhesion-Free Pelvic Surgery' while the source it cites (and the NARPS acronym used in the endometriosis term) is 'Near Adhesion-Free Reconstructive Pelvic Surgery'. Align the prose, the See-also label and the target term title to the source name, and add a NARPS abbreviation row.

---

### `rpl` — citation_support  ·  Part VI-A

**Field:** `body_html`  ·  **ref#37**

**Current:** Assessment includes peripheral karyotype analysis of both partners, antiphospholipid antibody testing, uterine anatomical evaluation (SHG, HSG, or hysteroscopy), thyroid and prolactin screening, and evaluation for hereditary thrombophilias. RRM pursues identification of underlying conditions including hormonal (progesterone deficiency, thyroid dysfunction), anatomical (isthmocele, septum, fibroids), immunologic (APS, NK cell activity), and metabolic factors.

**Evidence:** Parental karyotyping is not routinely recommended in couples with RPL. It could be carried out after individual assessment of risk

**Canon:** RRM canon: comprehensive root-cause evaluation is the RRM position and must not be softened; the fix preserves it and only corrects what the ESHRE citation is being asked to carry.

**Suggested fix:** The paragraph presents parental karyotyping and NK-cell assessment as standard workup while citing ESHRE (ref 37), whose guideline text says the opposite ('not routinely recommended'; NK cell testing listed among tests 'not recommended in routine clinical practice'). This is a citation-support problem, not a canon problem: keep the RRM position, but split the sentence so the guideline-endorsed elements (APS testing, uterine cavity evaluation, thyroid/prolactin) carry refs 36/37, and state the broader RRM workup (parental karyotype, NK activity, hereditary thrombophilia) as RRM practice rather than as guideline content.

---

### `shortened-luteal-phase` — internal_consistency  ·  Part VI-A

**Field:** `body_html`  ·  **ref#45**

**Current:** A shortened luteal phase is a post-ovulatory phase lasting fewer than 11 days, measured from the day of confirmed ovulation (Peak Day) through the onset of the next menstruation.

**Evidence:** The NaProTechnology post-Peak duration threshold for a short luteal phase is 8 days, not the older luteal-phase criterion anchored to BBT-phase length (Jones 1949). Those criteria measured different endpoints with different methods.

**Canon:** NaProTechnology positioning must not be hedged; naming both standards side by side strengthens rather than weakens the NaPro criterion.

**Suggested fix:** Two adjacent glossary terms give two different thresholds for the same clinical concept, and the sibling term (luteal-phase-deficiency) explicitly warns that the two criteria are not interchangeable. This term then applies the non-NaPro threshold to the NaPro measurement endpoint, which is exactly the conflation being warned against. Fix by naming both standards in one sentence: the NaPro post-Peak threshold is 8 days or fewer (verified against Hilgers Chapter 35, Type I), while ASRM 2021 defines an abnormal luteal phase length as 10 days or fewer measured from ovulation. State which endpoint each applies to.

---

### `shortened-luteal-phase` — clinical_accuracy  ·  Part VI-A

**Field:** `body_html`

**Current:** measured from the day of confirmed ovulation (Peak Day) through the onset of the next menstruation

**Evidence:** The chapter describes postovulatory-only progesterone and estrogen supplementation protocols (CPRT/CERT) timed to Peak Day identification, claiming to preserve ovulation while treating luteal phase dysfunction and cycle irregularities, with ovulation occurring within 2 days of Peak Day in 95.4% of cycles versus on day 14 in only 13.5% of cycles.

**Suggested fix:** Peak Day is a mucus biomarker that brackets ovulation, not the day of confirmed ovulation: the RRM library's own Hilgers Chapter 27 states ovulation occurs within 2 days of Peak Day in 95.4% of cycles, which is a window, not an identity. Rewrite as 'measured from the Peak Day, the mucus marker that brackets ovulation, through the onset of the next menstruation', and drop 'confirmed ovulation' or attribute confirmation to ultrasound or progesterone.

---

### `uterine-septum` — false_confidence  ·  Part VI-A

**Field:** `body_html`  ·  **ref#289**

**Current:** A uterine septum is a structural, surgically correctable contributor to pregnancy loss: hysteroscopic resection significantly reduces abortion rates and improves term delivery rates across septum sizes.<sup class="cite-ref"><a href="#ref-289">289</a></sup>

**Evidence:** SUMMARY ANSWER : Hysteroscopic septum resection does not improve reproductive outcomes in women with a septate uterus.

**Canon:** This is not an RRM-versus-mainstream positional question and not false balance: the term already states the limitation itself, so the overreach is internal and is the kind of claim a hostile reader will use to discredit the surrounding, well-sourced material.

**Suggested fix:** This closing sentence states flatly what the term's own fourth paragraph correctly hedges ('randomized data on whether resection improves live birth remain limited', 'these designs cannot separate the surgery's effect from background spontaneous resolution'), and the two paragraphs cannot both stand. Its citation, ref 289, is an uncontrolled single-centre before/after series of 121 patients whose own title calls it 'A retrospective cohort study protocol' (verified: PMID 31348312, Medicine (Baltimore) 2019). Meanwhile the only randomized trial found no benefit: Rikken JFW et al, 'Septum resection versus expectant management in women with a septate uterus: an international multicentre open-lab

**Adversarial verdict:** DOWNGRADE — Quote check passed and the reviewer's external evidence checks out exactly. By PubMed efetch, PMID 33793794 is Rikken JFW et al, Hum Reprod 2021 Apr 20, and its abstract reads verbatim 'SUMMARY ANSWER: Hysteroscopic septum resection does not improve reproductive outcomes in women with a septate uterus' with 'Live birth occurred in 12 of 39 women allocated to septum resection (31%) and in 14 of 40 

**Corrected fix:** Keep the miscarriage claim, drop the term-delivery claim, and re-cite to the strongest available sources rather than to ref 289. Suggested replacement: 'A uterine septum is a structural, surgically correctable contributor to pregnancy loss. Pooled observational data show hysteroscopic resection significantly reduces miscarriage,<sup class="cite-ref"><a href="#ref-348">348</a></sup> and guideline r

---

### `aps` — criteria_incomplete  ·  Part VI-B

**Field:** `body_html`  ·  **ref#37**

**Current:** The clinical criteria are vascular thrombosis or a recognized pattern of pregnancy morbidity: three or more early pregnancy losses, one or more unexplained losses after ten weeks, or one or more preterm births before thirty-four weeks from placental insufficiency.

**Evidence:** three or more early pregnancy losses, one or more unexplained losses after ten weeks, or one or more preterm births before thirty-four weeks from placental insufficiency

**Suggested fix:** Restore the two dropped qualifiers, which change who meets the criterion: 'three or more unexplained consecutive losses before ten weeks' and 'one or more preterm births before thirty-four weeks due to eclampsia, severe preeclampsia, or placental insufficiency.' Without 'before ten weeks' the first and second criteria overlap and read as contradictory.

---

### `autoimmune-thrombophilic` — consensus_conflict  ·  Part VI-B

**Field:** `body_html`  ·  **ref#37**

**Current:** Evaluation through targeted testing can identify these conditions before a subsequent pregnancy attempt.

**Evidence:** Evaluation through targeted testing can identify these conditions before a subsequent pregnancy attempt.

**Canon:** Perplexity reflects MAINSTREAM consensus, not RRM canon. Never mark RRM canon wrong because mainstream disagrees. Log both sides verbatim.

**Suggested fix:** RRM POSITION (do not overwrite): thorough diagnostic evaluation is the point of RRM and inherited thrombophilia testing is defensible within it. MAINSTREAM POSITION: ESHRE, ASRM and ACOG recommend against routine hereditary thrombophilia screening in RPL absent additional risk factors, and ESHRE (ref 37) is cited in this very entry. Human arbitration needed. Minimum safe edit: make the divergence explicit rather than silent, e.g. note that major guidelines reserve hereditary thrombophilia testing for women with additional risk factors while RRM evaluates it as part of a fuller workup.

---

### `autoimmune-thrombophilic` — citation_weak  ·  Part VI-B

**Field:** `body_html`  ·  **ref#75**

**Current:** Inherited thrombophilias alter coagulation factor activity, increasing the likelihood of clot formation in small vessels including the placental vasculature. Not all carriers experience adverse pregnancy outcomes. Clinical severity depends on mutation type, zygosity, and the presence of other risk factors. Evaluation through targeted testing can identify these conditions before a subsequent pregnancy attempt.<sup class="cite-ref"><a href="#ref-75">75</a></sup>

**Evidence:** Evaluation through targeted testing can identify these conditions before a subsequent pregnancy attempt.

**Suggested fix:** Reference 75 is Phillippe M, 'Cell-free fetal DNA, hemorrhage, and the etiology of term and preterm birth: inherited thrombophilia as a unifying mechanism,' Am J Perinatol 2014, a mechanistic hypothesis paper about parturition timing. It plausibly supports the coagulation-mechanism sentence but does not support a testing-strategy recommendation. Move ref 75 to the mechanism sentence only, and cite a thrombophilia-evaluation source for the testing sentence.

---

### `azoospermia` — abbreviation_missing  ·  Part VI-B

**Field:** `body_html`

**Current:** obstructive azoospermia (OA) and non-obstructive azoospermia (NOA) ... Congenital bilateral absence of the vas deferens (CBAVD)

**Evidence:** The condition is classified into two mechanistically distinct categories: obstructive azoospermia (OA) and non-obstructive azoospermia (NOA).

**Suggested fix:** OA, NOA and CBAVD are introduced as abbreviations in the body but have no rows in glossary_abbreviation. Add: OA = Obstructive Azoospermia (term_slug azoospermia); NOA = Non-Obstructive Azoospermia (term_slug azoospermia); CBAVD = Congenital Bilateral Absence of the Vas Deferens (term_slug azoospermia). These three are load-bearing across the male-factor cluster.

---

### `cervical-factor-infertility` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#68**

**Current:** This means cervical factor is frequently a downstream expression of <a href="#hormonal-abnormalities" class="gloss-xref">hormonal abnormalities</a> rather than an isolated structural problem.<sup class="cite-ref"><a href="#ref-68">68</a></sup>

**Evidence:** This means cervical factor is frequently a downstream expression of hormonal abnormalities rather than an isolated structural problem.

**Suggested fix:** Reference 68 is Orouji Jokar T et al, 'Higher TSH Levels Within the Normal Range Are Associated With Unexplained Infertility,' J Clin Endocrinol Metab 2017. It is a thyroid study and says nothing about follicular estrogen, cervical mucus production, or cervical factor infertility. The claim it is attached to is specifically about estrogen driving mucus proliferation. Replace with a cervical mucus and estrogen source; ref 74 (Billings 1981, cervical mucus as the biological marker of fertility and infertility) is already in the reference list and is far closer, or cite an estrogen-and-cervical-secretion physiology source verified before use.

**Adversarial verdict:** DOWNGRADE — Quote check passed: 'This means cervical factor is frequently a downstream expression of <a href="#hormonal-abnormalities" class="gloss-xref">hormonal abnormalities</a> rather than an isolated structural problem.<sup class="cite-ref"><a href="#ref-68">68</a></sup>' appears verbatim in terms-part-VI-B.json. Ref 68 identity verified independently via PubMed esummary on PMID 29272395: 'Higher TSH Lev

**Corrected fix:** Recite the sentence to a source that actually states the mechanism, rather than to Billings 1981 as the reviewer proposes. Verified verbatim by direct fetch of NCBI Bookshelf NBK279054 (Endotext, 'The Normal Menstrual Cycle and the Control of Ovulation', last updated 2018-08-05): 'The mucous secreting glands of the endocervix are affected by the changes in steroid hormone concentration. Immediatel

---

### `chronic-endometritis` — diagnostic_overstatement  ·  Part VI-B

**Field:** `body_html`

**Current:** Diagnosis requires office hysteroscopy (strawberry-pattern micropolypoid endometrium) confirmed by <a href="#cd138" class="gloss-xref">CD138 immunohistochemistry</a> on endometrial biopsy.

**Evidence:** Diagnosis requires office hysteroscopy (strawberry-pattern micropolypoid endometrium) confirmed by CD138 immunohistochemistry on endometrial biopsy.

**Suggested fix:** Reverse the emphasis: 'Diagnosis rests on CD138 (syndecan-1) immunohistochemistry demonstrating plasma cells in an endometrial biopsy. Office hysteroscopy is a useful adjunct, showing micropolyps, focal hyperemia, and the strawberry pattern, but it is suggestive rather than confirmatory and is not required to make the diagnosis.'

---

### `dor` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#3**

**Current:** and <a href="#dhea-supplementation" class="gloss-xref">DHEA supplementation</a> for one studied supportive strategy in DOR.<sup class="cite-ref"><a href="#ref-3">3</a></sup>

**Evidence:** DHEA supplementation for one studied supportive strategy in DOR.

**Suggested fix:** Reference 3 (Restorative reproductive medicine in two family medicine clinics in New England, BMC Pregnancy and Childbirth 2021) contains zero occurrences of DHEA or dehydroepiandrosterone on full-text scan. It does report 'Diminished ovarian reserve 45 (12)' as a diagnosis frequency, but nothing about DHEA supplementation. Either drop the citation from this cross-reference sentence or replace it with a DHEA-in-DOR source, verified before use.

**Adversarial verdict:** DOWNGRADE — Quote check: current_value appears verbatim as the closing clause of paragraph 3 of the dor entry. The reviewer's factual claim about ref 3 is correct and I reproduced it independently: the complete Stanford 2021 full text (11 of 11 pages) returns 0 case-insensitive hits for DHEA and 0 for dehydroepiandrosterone, and 'Diminished ovarian reserve 45 (12)' does appear as a diagnosis-frequency row. So

**Corrected fix:** Do not drop ref 3, and do not go hunting for a new source. Two moves. (1) Relocate the superscript: ref 3 legitimately supports the substantive claims of this paragraph, so attach it to 'Where modifiable factors exist, they are addressed.<sup>3</sup>' instead of to the trailing cross-reference clause. (2) Cite the DHEA clause with ref 147, which is already in the reference list and which I verifie

---

### `hormonal-abnormalities` — citation_mismatch  ·  Part VI-B

**Field:** `body_html`  ·  **ref#77**

**Current:** AMH reflects the pool of recruitable follicles; low AMH indicates <a href="#ovarian-reserve" class="gloss-xref">diminished ovarian reserve</a> (<a href="#dor" class="gloss-xref">DOR</a>); in cases of severe reduction before age 40, it may signal <a href="#poi" class="gloss-xref">premature ovarian insufficiency (POI)</a>.<sup class="cite-ref"><a href="#ref-77">77</a></sup>

**Evidence:** AMH reflects the pool of recruitable follicles; low AMH indicates diminished ovarian reserve (DOR); in cases of severe reduction before age 40, it may signal premature ovarian insufficiency (POI).

**Suggested fix:** Reference 77 is Yin WW et al, 'The effect of medication on serum anti-Mullerian hormone (AMH) levels in women of reproductive age: a meta-analysis,' BMC Endocrine Disorders 2022. It is about how drugs (hormonal contraceptives, GnRH agonists and others) alter measured AMH. It does not establish AMH as a marker of the recruitable follicle pool, DOR, or POI. Either move ref 77 to a new caveat sentence it actually supports ('measured AMH can be suppressed by medication, so interpret values in context of current prescriptions'), or replace it with ref 120 or an AMH physiology source for the claim as written.

**Adversarial verdict:** DOWNGRADE — Quote verified verbatim, including the ref-77 sup tag. The mismatch is real and I confirmed it independently, but P1 overstates the harm.

Ref 77 verified by direct efetch (PMID 35698127, Yin WW et al., BMC Endocr Disord 2022;22:158). It is a meta-analysis of 51 self-control studies on whether medications (oral contraceptives, metformin, GnRH agonists, DHEA, vitamin D, clomiphene, letrozole) shift

**Corrected fix:** The reviewer's fix is sound in direction but a single swap to ref 120 will not cover the whole sentence, because the sentence bundles three distinct claims. Attribute clause by clause.

1. Recruitable follicle pool and DOR ('AMH reflects the pool of recruitable follicles; low AMH indicates diminished ovarian reserve'): ref 120 does not establish this either. Needs an AMH physiology or ovarian-rese

---

### `hypothyroidism` — source_mischaracterization  ·  Part VI-B

**Field:** `body_html`  ·  **ref#102**

**Current:** The clinical threshold for intervention is typically set lower than conventional population norms, because the evidence supports more aggressive optimization in women attempting conception. A Cochrane review of thyroxine replacement in subfertile women with subclinical hypothyroidism or autoimmune thyroid disease found mixed results across trials, underscoring that treatment decisions require individual clinical judgment rather than a blanket protocol.<sup class="cite-ref"><a href="#ref-102">102</a></sup>

**Evidence:** A Cochrane review of thyroxine replacement in subfertile women with subclinical hypothyroidism or autoimmune thyroid disease found mixed results across trials, underscoring that treatment decisions require individual clinical judgment rather than a blanket protocol.

**Canon:** Never soften RRM outcome claims with false balance; also P1 rule on claims stated with confidence the cited evidence does not carry

**Suggested fix:** Two linked problems. First, 'mixed results across trials' is not what Akhtar 2019 concluded; it concluded insufficient evidence of low to very low quality. Second, the preceding sentence asserts 'the evidence supports more aggressive optimization' and is then immediately followed by a citation that says the evidence is insufficient, so the paragraph argues against itself. Recommended rewrite that keeps the RRM position intact without false balance: state the RRM clinical rationale (preconception TSH optimization based on observational association with miscarriage and ovulatory dysfunction) as the rationale it is, then note separately and accurately that randomized trial evidence for levothyr

---

### `insulin-resistance` — overstatement  ·  Part VI-B

**Field:** `body_html`  ·  **ref#39**

**Current:** insulin resistance is most clinically significant in <a href="#pcos" class="gloss-xref">PCOS</a>, where it is present in an estimated 50 to 70% of affected individuals regardless of body weight.<sup class="cite-ref"><a href="#ref-39">39</a></sup>

**Evidence:** where it is present in an estimated 50 to 70% of affected individuals regardless of body weight

**Suggested fix:** Keep the 50 to 70% figure, which is well supported for the overall PCOS population, but replace 'regardless of body weight' with the accurate formulation: 'present in an estimated 50 to 70% of affected individuals overall, more frequent and more pronounced with obesity but also demonstrable in lean women with PCOS.' The entry's real point, that lean PCOS is not exempt, survives intact and is made better by the correction; it is stated correctly later in the same entry ('including lean PCOS where insulin resistance may be present without BMI elevation'), so the opening overstatement is not even load-bearing.

---

### `methylated-folate` — false_confidence  ·  Part VI-B

**Field:** `body_html`

**Current:** Carriers of common MTHFR gene variants, C677T and A1298C, have reduced MTHFR enzyme activity and convert folic acid less efficiently than those without the variants.

**Evidence:** Carriers of common MTHFR gene variants, C677T and A1298C, have reduced MTHFR enzyme activity and convert folic acid less efficiently than those without the variants.

**Suggested fix:** Separate the two variants. C677T homozygosity reduces enzyme activity substantially and raises homocysteine, particularly at low folate intake. Isolated A1298C has a mild effect and the evidence that it alone meaningfully alters folate handling is insufficient; compound C677T/A1298C heterozygosity is where A1298C matters most. The current sentence attributes the C677T effect to both variants equally.

**Adversarial verdict:** DOWNGRADE — Quote verified verbatim in terms-part-VI-B.json. The finding is real but half-wrong and over-severitised, and its evidence base is contaminated.

I re-derived this from primary sources rather than accepting the reviewer's reasoning. The glossary sentence makes TWO claims about the compound subject (C677T and A1298C): (1) reduced MTHFR enzyme activity, (2) less efficient folic acid conversion.

Cla

**Corrected fix:** The reviewer's fix is directionally right but concedes too much on enzyme activity. Split the clause by variant AND by endpoint, keeping what the primary literature supports.

Enzyme activity: keep it for both variants. It is sound (A1298C homozygotes ~60% of control activity, Weisberg 1998; decreased activity P<.0001, van der Put 1998).

Folate handling: this is the only part that overreaches. Is

---

### `methylated-folate` — consensus_conflict  ·  Part VI-B

**Field:** `body_html`

**Current:** MTHFR variants are common across the general population, far more so than rare thrombophilias like Factor V Leiden. Most carriers have never been tested. ... Homocysteine measurement adds useful context alongside genotyping.

**Evidence:** Most carriers have never been tested. The clinical question is whether an individual's folate metabolism is adequate, not simply whether a variant is present. Homocysteine measurement adds useful context alongside genotyping.

**Canon:** Perplexity reflects MAINSTREAM consensus, not RRM canon; consensus_conflict is P2 only and the human arbitrates.

**Suggested fix:** Log both sides for human arbitration. MAINSTREAM: ACMG (and ACOG, aligned) recommend against MTHFR polymorphism testing in RPL or thrombophilia workups. RRM POSITION: the entry already lands close to the defensible middle by centering functional adequacy over genotype. Suggested minimum edit: lead with homocysteine and folate status as the functional measures and state that genotype alone does not drive management, which preserves the RRM point while not implying routine genotyping.

---

### `poi` — factual_imprecision  ·  Part VI-B

**Field:** `body_html`

**Current:** and from natural <a href="#menopause" class="gloss-xref">menopause</a>, which occurs in the fifth decade.

**Evidence:** and from natural menopause, which occurs in the fifth decade.

**Suggested fix:** Replace 'which occurs in the fifth decade' with 'which typically occurs around age 50 to 51, generally between 45 and 55.' The fifth decade means ages 40 to 49, which sits immediately adjacent to the POI cutoff this sentence is drawing a contrast against, so the imprecision blunts the very distinction the sentence exists to make.

---

### `secondary-infertility` — false_confidence  ·  Part VI-B

**Field:** `body_html`  ·  **ref#128**

**Current:** a niche or <a href="#isthmocele" class="gloss-xref">isthmocele</a> at the scar can impair implantation and cause secondary infertility, a finding confirmed by endoscopic repair restoring conception in affected patients.<sup class="cite-ref"><a href="#ref-128">128</a></sup>

**Evidence:** a finding confirmed by endoscopic repair restoring conception in affected patients

**Suggested fix:** Reference 128 (Tanimura 2015, J Obstet Gynaecol Res) is an uncontrolled case series of 22 women with secondary infertility from post-cesarean scar defect; 14 of 22 (63.6%) conceived after endoscopic repair. 'Confirmed' overstates what an uncontrolled 22-patient series can establish. Replace the vague overclaim with the concrete finding, which is more persuasive anyway: 'in one series of 22 women with secondary infertility from a cesarean scar defect, 14 (64%) conceived after endoscopic repair.'

---

### `time-to-pregnancy` — denominator_drift  ·  Part VI-B

**Field:** `body_html`  ·  **ref#197**

**Current:** In couples with normal fertility using fertility-aware, timed intercourse, studies estimate that approximately 81% conceive within 6 cycles and 92% within 12 cycles.<sup class="cite-ref"><a href="#ref-197">197</a></sup>

**Evidence:** In couples with normal fertility using fertility-aware, timed intercourse, studies estimate that approximately 81% conceive within 6 cycles and 92% within 12 cycles.

**Suggested fix:** The 81% and 92% figures are exactly right, but they belong to Gnoth's TOTAL cohort (n=340), which includes the subfertile couples. The subgroup Gnoth calls 'truly fertile' had 88% at six cycles and 98% at twelve. As written, the entry attaches the total-cohort numbers to 'couples with normal fertility', which understates the fertile-subgroup result and blurs the denominator. Fix: 'In one German prospective cohort of couples using fertility-aware timed intercourse, 81% conceived within 6 cycles and 92% within 12; among the couples who ultimately proved fertile, the figures were 88% and 98%.' The stronger numbers are the ones the entry is arguably trying to cite.

---

### `chronic-pelvic-pain` — abbreviation_missing  ·  Part VI-C

**Field:** `abbreviation`

**Current:** CPP

**Evidence:** Chronic pelvic pain (CPP) is persistent or recurrent pain in the pelvis lasting six months or longer, unrelated to menstruation alone, that causes functional impairment or requires medical care.

**Suggested fix:** The term row declares abbreviation 'CPP' and the body introduces it, but there is no matching row in glossary_abbreviation (the table jumps CL -> CLD -> CrMS). Insert: abbreviation 'CPP', full_term 'Chronic Pelvic Pain', term_slug 'chronic-pelvic-pain'. Same defect affects EFS and IFS in this batch, so fix as a class.

---

### `clinical-endorphin-deficiency` — mechanism_drift  ·  Part VI-C

**Field:** `body_html`  ·  **ref#241**

**Current:** LDN works by transiently occupying opioid receptors; the brief blockade triggers a compensatory upregulation of endogenous opioid production, increasing beta-endorphin availability in the period between doses.<sup class="cite-ref"><a href="#ref-241">241</a></sup>

**Evidence:** LDN works by transiently occupying opioid receptors; the brief blockade triggers a compensatory upregulation of endogenous opioid production, increasing beta-endorphin availability in the period between doses.

**Suggested fix:** The mechanism is right in outline (transient blockade producing compensatory upregulation) but the specific molecule is likely wrong for the cited source. Ref 241 is McLaughlin and Zagon, 'Duration of opioid receptor blockade determines biotherapeutic response', whose experimental work centres on the opioid growth factor (OGF, met-enkephalin) and its receptor OGFr, not beta-endorphin. Change to 'increasing endogenous opioid peptide availability in the period between doses' and, if the beta-endorphin claim is to be kept, cite it separately to the endorphin-and-GnRH literature that the term's own opening paragraph already invokes via ref 78. Confirm against the McLaughlin and Zagon full text b

---

### `early-pregnancy-loss` — false_confidence  ·  Part VI-C

**Field:** `body_html`  ·  **ref#130**

**Current:** A treatment strategy that systematically addresses thyroid function, thrombophilia, immune dysregulation, and uterine environment has demonstrated significantly improved live birth rates in women with recurrent loss compared to expectant management alone.<sup class="cite-ref"><a href="#ref-130">130</a></sup>

**Evidence:** A treatment strategy that systematically addresses thyroid function, thrombophilia, immune dysregulation, and uterine environment has demonstrated significantly improved live birth rates in women with recurrent loss compared to expectant management alone.

**Suggested fix:** The claim is real but is stated without its two load-bearing qualifiers. Ref 130 (the OPTIMUM strategy) is a retrospective, non-randomized single-clinic study, and the live-birth benefit was significant only in women under 40 (78.1% vs 42.3%, p=0.002); in women 40 and over the difference was not significant (55.6% vs 30.0%, p=0.09). The comparator was a contemporaneous group not receiving the protocol, which is not the same thing as formal expectant management. Rewrite as: 'In a retrospective cohort, a strategy systematically addressing thyroid function, thrombophilia, immune dysregulation and uterine environment produced significantly higher live birth rates in women under 40 than in compar

---

### `empty-follicle-syndrome` — abbreviation_missing  ·  Part VI-C

**Field:** `abbreviation`

**Current:** EFS

**Evidence:** Empty Follicle Syndrome (EFS) is an ovulation disorder in which the dominant follicle reaches mature size and ruptures appropriately, yet no oocyte is recovered at the expected reproductive event.

**Suggested fix:** The term row declares abbreviation 'EFS' and the body introduces it, but there is no matching row in glossary_abbreviation (the table jumps ERA -> ESP -> FABM). Insert: abbreviation 'EFS', full_term 'Empty Follicle Syndrome', term_slug 'empty-follicle-syndrome'. Same defect affects CPP and IFS in this batch, so fix as a class.

---

### `endometrial-hyperplasia` — citation_mismatch  ·  Part VI-C

**Field:** `body_html`  ·  **ref#44**

**Current:** For atypical hyperplasia in women who desire future fertility, intensive progestin therapy with close endometrial surveillance is a recognized option before hysterectomy. Either way, addressing the source of estrogen excess, not just treating the endometrium, is the restorative principle.<sup class="cite-ref"><a href="#ref-44">44</a></sup>

**Evidence:** Progesterone therapy reverses many cases of non-atypical hyperplasia by countering the unopposed estrogen state. For atypical hyperplasia in women who desire future fertility, intensive progestin therapy with close endometrial surveillance is a recognized option before hysterectomy.

**Suggested fix:** Ref 44 is 'Progesterone and the Luteal Phase: A Requisite to Reproduction', a luteal-phase physiology review. It is a plausible support for the unopposed-estrogen mechanism but is the wrong source for a fertility-sparing oncology management claim about atypical hyperplasia / endometrial intraepithelial neoplasia. Add a gynecologic-oncology guideline citation (RCOG Green-top 67 'Management of Endometrial Hyperplasia' or the equivalent ACOG committee opinion) for the progestin-before-hysterectomy sentence, keeping ref 44 only on the mechanism sentence. Verify the added source directly; a Perplexity pass declined to confirm ref 44's contents.

---

### `hcg` — unverified_number  ·  Part VI-C

**Field:** `body_html`  ·  **ref#60**

**Current:** Quenby and Farquharson published a randomized controlled trial of 81 women with idiopathic recurrent loss.

**Evidence:** In <a href="#rpl" class="gloss-xref">recurrent pregnancy loss</a>, hCG supplementation in early pregnancy has been studied as a support strategy. Quenby and Farquharson published a randomized controlled trial of 81 women with idiopathic recurrent loss.

**Suggested fix:** The sample size of 81 could not be independently confirmed this pass and should be checked against PubMed before republication. Two Perplexity passes returned conflicting and unreliable numbers (one said 23 citing the PubMed record, a second said 80 with completely off-topic sources and is discarded as hallucinated), and the local library record for ref 60 has no abstract stored. Do NOT adopt either Perplexity number. Pull the Fertil Steril 1994;62(4):708-710 abstract directly and correct or confirm 'n=81'. Note also that the paper's own title is 'a controlled trial', so 'randomized controlled trial' should be checked at the same time.

---

### `immature-follicle-syndrome` — abbreviation_missing  ·  Part VI-C

**Field:** `abbreviation`

**Current:** IFS

**Evidence:** Immature Follicle Syndrome (IFS) is an ovulation disorder in which the dominant follicle ruptures before reaching the size associated with follicular maturity, preventing reliable release of a fully developed oocyte.

**Suggested fix:** The term row declares abbreviation 'IFS' and the body introduces it, but there is no matching row in glossary_abbreviation (the table jumps ICSI -> IUD -> IUI -> IVF). Insert: abbreviation 'IFS', full_term 'Immature Follicle Syndrome', term_slug 'immature-follicle-syndrome'. Same defect affects CPP and EFS in this batch, so fix as a class.

---

### `lh` — numeric_precision  ·  Part VI-C

**Field:** `body_html`

**Current:** The LH surge initiates follicle rupture within 36 to 40 hours.

**Evidence:** The LH surge initiates follicle rupture within 36 to 40 hours. Urinary ovulation predictor kits detect this surge and are commonly used to estimate fertile-window timing.

**Suggested fix:** Stated as a flat rule, 36 to 40 hours sits above the pooled mean. The 2022 Human Reproduction Update systematic review and meta-analysis (Hoffmann et al.) gives a mean of 33.91 hours from surge ONSET (95% CI 30.79-37.03) with an individual range of 22-56 hours. Rewrite to carry the variability, e.g. 'Ovulation typically follows the onset of the LH surge by roughly 24 to 40 hours, with a pooled mean near 34 hours and wide individual variation.' Note the figure is not wrong in spirit (the ASRM patient fact sheet uses 36-40 hours), which is why this is P2 precision rather than P0. Verify the meta-analysis citation directly before adding it; do not paste a Perplexity-supplied DOI.

---

### `molimina` — citation_mismatch  ·  Part VI-C

**Field:** `body_html`  ·  **ref#220**

**Current:** Research data show that absence of molimina has high specificity for ovulatory disturbance, while its presence alone does not confirm adequate ovulation.<sup class="cite-ref"><a href="#ref-220">220</a></sup>

**Evidence:** Its absence, particularly in cycles that appear outwardly regular, raises clinical suspicion for <a href="#anovulatory-cycles" class="gloss-xref">anovulatory bleeding</a> or a deteriorating <a href="#post-peak-phase" class="gloss-xref">luteal phase</a>. Research data show that absence of molimina has high specificity for ovulatory disturbance, while its presence alone does not confirm adequate ovulation.

**Suggested fix:** Ref 220 does not support this. The paper found that the Molimina Question was SIMILAR in women with ovulatory and ovulatory-disturbed cycles, and concluded 'Molimina did not confirm ovulation'. The specificity framing is technically arithmetic (molimina was present in ~89% of everyone) but carries no discriminative value, so presenting absent molimina as a clinical suspicion trigger 'shown by research data' overstates the source. Rewrite honestly: 'In the one prospective hormonally documented study, molimina was reported by most women regardless of whether the cycle was ovulatory, so it cannot confirm ovulation. Its clinical value is as one charted observation among several, not as a stand-a

**Adversarial verdict:** DOWNGRADE — Quote check PASSES verbatim. Ref 220 confirmed as PMID 29783630 (Prior 2018, IJERPH 15(5):1016, PMC5982055) by direct retrieval. The reviewer's central assertion, 'Ref 220 does not support this' and that the specificity framing is merely the reviewer's own arithmetic off the 89% MQ-positive rate, is FACTUALLY WRONG about provenance. I read the PMC full text: the paper's own Introduction reports th

**Corrected fix:** Do not delete the clinical teaching; attribute it honestly and add the disconfirming result. Replace the sentence with: 'An early clinical series reported that a negative answer to the molimina question was highly specific for anovulation, but the larger prospective study that documented ovulation hormonally did not reproduce that discrimination: molimina was reported by most women whether or not 

---

### `molimina` — citation_metadata  ·  Part VI-C

**Field:** `body_html`  ·  **ref#220**

**Current:** Prior JC, et al. Does Molimina Indicate Ovulation? Prospective Data in a Hormonally Documented Single-Cycle in Spontaneously Menstruating Women. Front Endocrinol (Lausanne). 2018;9:330.

**Evidence:** Prior JC, et al. Does Molimina Indicate Ovulation? Prospective Data in a Hormonally Documented Single-Cycle in Spontaneously Menstruating Women. Front Endocrinol (Lausanne). 2018;9:330.

**Suggested fix:** The references.json row for ref 220 gives the journal as Frontiers in Endocrinology 2018;9:330, but the RRM library record for the identical title gives the journal as International Journal of Environmental Research and Public Health, 2018. One of the two is wrong. Resolve against PubMed/DOI directly and correct whichever is stale. Explicit warning: a Perplexity pass on this exact question returned fabricated bibliographic data (it asserted PMID 29783630 was the STRAW+10 staging paper and that the molimina paper was Fertil Steril 2015;103:718-724) with completely unrelated molecular-biology sources, so NOTHING from that pass may be used. This must be settled by direct registry lookup only.

---

### `molimina` — citation_mismatch  ·  Part VI-C

**Field:** `body_html`  ·  **ref#100**

**Current:** Eliminating all premenstrual awareness with suppressive medications masks a signal that carries diagnostic value. The chart captures it.<sup class="cite-ref"><a href="#ref-100">100</a></sup>

**Evidence:** The distinction matters clinically. Eliminating all premenstrual awareness with suppressive medications masks a signal that carries diagnostic value. The chart captures it.

**Suggested fix:** Ref 100 is 'Natural family planning. I. The peak symptom and estimated time of ovulation' (Obstet Gynecol 1978), which establishes the mucus peak symptom as a marker of ovulation timing. It says nothing about molimina, premenstrual awareness, or suppressive medications. Either move ref 100 to a sentence about Peak Day (where it genuinely belongs) or replace it here. The 'suppressive medications mask a diagnostic signal' claim is a reasonable clinical position but currently has no supporting source at all.

---

### `pms` — citation_mismatch  ·  Part VI-C

**Field:** `body_html`  ·  **ref#220**

**Current:** Cyclical premenstrual symptoms are a recognized correlate of ovulation.<sup>[220]</sup>

**Evidence:** Cyclical premenstrual symptoms are a recognized correlate of ovulation.<sup>[220]</sup> That connection is clinically important.

**Suggested fix:** Ref 220 is Prior JC et al., 'Does Molimina Indicate Ovulation?', whose own abstract states 'Molimina did not confirm ovulation' and reports that women with and without ovulatory cycles were SIMILAR on the Molimina Question. Citing it to establish that premenstrual symptoms are a correlate of ovulation inverts the paper. Either drop ref 220 from this sentence and cite luteal-phase physiology instead (ref 44 already does this work in the same term), or restate honestly as 'premenstrual symptoms are commonly reported in both ovulatory and ovulatory-disturbed cycles, so they cannot stand in for confirmation of ovulation, which is exactly why charting plus cycle-timed hormone measurement is requi

**Adversarial verdict:** DOWNGRADE — Quote check PASSES: 'Cyclical premenstrual symptoms are a recognized correlate of ovulation.<sup>[220]</sup> That connection is clinically important.' appears verbatim in /tmp/glossary-review/terms-part-VI-C.json. Ref 220 independently resolved: PMID 29783630 = Prior JC, Konishi C, Hitchcock CL, Kingwell E, Janssen P, Cheung AP, Fairbrother N, Goshtasebi A. 'Does Molimina Indicate Ovulation?' Int 

**Corrected fix:** Keep the sentence's substance; fix the citation. Replace ref 220 with ref 44 for this sentence: ref 44 independently verified as Mesen TB, Young SL, 'Progesterone and the luteal phase: a requisite to reproduction', Obstet Gynecol Clin North Am. 2015 Mar (PMID 25681845, PMC4436586, doi 10.1016/j.ogc.2014.10.003), which is the correct luteal-physiology anchor and is already cited in this term. If re

---

### `postpartum-fertility` — mechanism_drift  ·  Part VI-C

**Field:** `body_html`

**Current:** Breastfeeding suppresses ovulation through sustained prolactin elevation, delaying cycle return by weeks to months depending on feeding frequency and exclusivity.

**Evidence:** Breastfeeding suppresses ovulation through sustained prolactin elevation, delaying cycle return by weeks to months depending on feeding frequency and exclusivity.

**Suggested fix:** The primary mechanism is suckling-induced suppression of hypothalamic GnRH pulsatility (mediated in part by beta-endorphin), with prolactin elevation being part of the same efferent lactation response rather than the causal suppressor. Rewrite as: 'Breastfeeding suppresses ovulation because the suckling stimulus slows hypothalamic GnRH pulses, reducing LH and FSH release; sustained prolactin elevation accompanies this.' Bonus: this wording is internally consistent with the beta-endorphin/GnRH mechanism already stated in the clinical-endorphin-deficiency term.

---

### `postpartum-fertility` — citation_drift  ·  Part VI-C

**Field:** `body_html`  ·  **ref#207**

**Current:** with effectiveness exceeding 98% when all three criteria apply.<sup class="cite-ref"><a href="#ref-207">207</a></sup>

**Evidence:** The lactational amenorrhea method (LAM) relies on this biology: exclusive breastfeeding, amenorrhea, and age of the infant under six months together provide highly effective contraception, with effectiveness exceeding 98% when all three criteria apply.

**Suggested fix:** The >98% figure is defensible in the wider literature (WHO multicentre study reports 99% with correct use), but it is not what ref 207 reports: the cited Cochrane review's own LAM life-table pregnancy rates run from 0.45% up to 2.45% at six months, i.e. as low as ~97.6%. Either soften to 'approximately 98% or better when all three criteria are strictly met' with the Cochrane range stated, or attach the WHO multicentre study as the source for the >98% number. Do not assert a single point estimate against a review that reports a range.

---

### `thrombophilia` — nomenclature  ·  Part VI-C

**Field:** `body_html`

**Current:** Inherited forms include Factor V Leiden, prothrombin G20210A mutation, antithrombin deficiency, protein C deficiency, protein S deficiency, and MTHFR variants associated with elevated homocysteine.

**Evidence:** Inherited forms include Factor V Leiden, prothrombin G20210A mutation, antithrombin deficiency, protein C deficiency, protein S deficiency, and MTHFR variants associated with elevated homocysteine.

**Canon:** Not an RRM positional question. RRM canon addresses methylfolate for homocysteine/folate metabolism, which is a separate matter from thrombophilia classification, so this is a taxonomy correction rather than a consensus conflict.

**Suggested fix:** Listing MTHFR variants inside the inherited-thrombophilia enumeration conflicts with the ACMG 2013 practice guideline (reaffirmed 2020) and ACOG, both of which state MTHFR polymorphism testing should not be part of a thrombophilia or recurrent-pregnancy-loss evaluation. The term already half-corrects itself two paragraphs later ('their independent contribution to pregnancy loss remains debated'), which makes the opening list internally inconsistent. Move MTHFR out of the inherited-thrombophilia list into its own sentence, e.g. 'MTHFR variants are frequently grouped with the thrombophilias but are not classified as one; their relevance is to homocysteine and folate metabolism.' This preserves

---

### `thrombophilia` — citation_strength  ·  Part VI-C

**Field:** `body_html`  ·  **ref#75**

**Current:** The acquired form most relevant to reproductive medicine is <a href="#aps" class="gloss-xref">antiphospholipid syndrome (APS)</a>, an autoimmune condition that generates antibodies against phospholipid-binding proteins.<sup>[75]</sup>

**Evidence:** The acquired form most relevant to reproductive medicine is <a href="#aps" class="gloss-xref">antiphospholipid syndrome (APS)</a>, an autoimmune condition that generates antibodies against phospholipid-binding proteins.<sup>[75]</sup>

**Suggested fix:** Ref 75 is Phillippe M, 'Cell-free fetal DNA, hemorrhage, and the etiology of term and preterm birth: inherited thrombophilia as a unifying mechanism', Am J Perinatol 2014, a hypothesis paper about preterm birth. It is a weak source for a general definition of thrombophilia and an especially poor one for the APS sentence, since APS is acquired rather than inherited and falls outside that paper's stated unifying mechanism. Replace with a general haemostasis review or the ISTH/ACOG APS criteria for the definitional paragraph, and keep ref 75 only if a claim specific to inherited thrombophilia and placental/preterm mechanisms is retained.

---

### `afollicularism` — abbreviation_mismatch  ·  Part VI-D

**Field:** `abbreviation`

**Current:** AF

**Evidence:** <strong>Afollicularism is a sonographic ovulation disorder, developed and formalized by Dr. Thomas W. Hilgers within <a href="/naprotechnology/">NaProTechnology</a>

**Suggested fix:** Term record carries abbreviation='AF' but abbreviations.json has no AF row, AND body_html never actually introduces '(AF)' - the abbreviation appears only in the term name. Two problems: the missing row, and the fact that 'AF' collides with the existing 'AFC' (Antral Follicle Count) row and with the common cardiology sense. Either add 'AF' -> 'Afollicularism' with an explicit disambiguation, or drop the abbreviation field entirely since the body never uses it.

---

### `coq10-fertility-use` — citation_mismatch  ·  Part VI-D

**Field:** `body_html`  ·  **ref#282**

**Current:** supplementation has improved measurable sperm parameters such as count and motility in several trials, with smaller and more mixed signals on oocyte and embryo measures.<sup class="cite-ref"><a href="#ref-282">282</a></sup><sup class="cite-ref"><a href="#ref-283">283</a></sup><sup class="cite-ref"><a href="#ref-433">433</a></sup>

**Evidence:** CoQ10 supports the mitochondrial energy oocytes and sperm rely on, and supplementation has improved measurable sperm parameters such as count and motility in several trials

**Suggested fix:** The word 'count' is not carried by any of the three citations attached. Ref 282 (Balercia 2009 RCT) improved motility and kinetic features only; ref 283 (Florou 2020) is a meta-analysis in WOMEN undergoing ART; ref 433 (Bentov & Casper 2013) is an oocyte-aging review. Either drop 'count' and write 'improved sperm motility and kinetic parameters', or keep 'count' and add the meta-analysis that reports it - Lafuente et al. 2013 reported a significant increase in sperm concentration as well as motility, but I did not independently verify that paper's identifiers, so confirm before citing it.

---

### `d-chiro-inositol` — mechanism_error  ·  Part VI-D

**Field:** `body_html`

**Current:** <strong>D-Chiro-Inositol</strong> (DCI) is a secondary messenger in insulin signaling pathways that promotes cellular glucose uptake and reduces androgen synthesis.

**Evidence:** is a secondary messenger in insulin signaling pathways that promotes cellular glucose uptake and reduces androgen synthesis

**Suggested fix:** The mechanism is stated backwards. DCI does not reduce androgen synthesis - at the ovarian level it is the second messenger THROUGH WHICH insulin stimulates theca-cell androgen production, and it downregulates granulosa aromatase. The androgen-lowering effect seen with DCI supplementation (Nestler, NEJM) is systemic and indirect: restoring DCI in muscle/liver/adipose improves insulin sensitivity, lowers circulating insulin, and therefore reduces the insulin drive on ovarian androgen output. Fix the opening line to: 'DCI is a second messenger in insulin signaling that promotes cellular glucose uptake. In PCOS/PMOS, restoring DCI in insulin-target tissues improves insulin sensitivity and lower

**Adversarial verdict:** DOWNGRADE — Quote check: the current_value appears verbatim in terms-part-VI-D.json. The finding is partly real but P0 and "stated backwards" are both overstated, and the reviewer's supporting gloss is not supported by the paper it leans on.

What I confirmed myself (every PMID below fetched live from NCBI eutils in this session, titles/journals/years verified, none laundered from Perplexity):
- PMID 9626131,

**Corrected fix:** Adopt the reviewer's STRUCTURE (split messenger role from clinical effect) but not the reviewer's mechanism claim, and fix two errors the reviewer's own rewrite carries. Replace the opening sentence with: 'D-Chiro-Inositol (DCI) acts through inositolphosphoglycan second messengers in insulin signaling, where it mediates non-oxidative glucose disposal and glycogen synthesis. In PCOS/PMOS, restoring

---

### `d-chiro-inositol` — missing_citation  ·  Part VI-D

**Field:** `body_html`

**Current:** (entire entry carries zero <sup class="cite-ref"> markers)

**Evidence:** DCI supplementation in PCOS reduces circulating androgen levels, improves insulin sensitivity, and can restore ovulatory function. However, high doses of DCI alone may negatively affect oocyte quality.

**Suggested fix:** This entry makes biochemical, pathophysiologic and clinical-recommendation claims with no references at all, in a glossary where adjacent entries carry 3-8 citations each. At minimum anchor the supplementation claim to Nestler's NEJM trial and the ratio/paradox claims to the Carlomagno-Unfer work. I have NOT independently verified identifiers for either, so retrieve and confirm the DOIs/PMIDs before adding them - do not paste them from an LLM.

---

### `d-chiro-inositol` — abbreviation_mismatch  ·  Part VI-D

**Field:** `body_html`

**Current:** <strong>D-Chiro-Inositol</strong> (DCI)

**Evidence:** <strong>D-Chiro-Inositol</strong> (DCI) is a secondary messenger in insulin signaling pathways

**Suggested fix:** body_html introduces the abbreviation '(DCI)' and reuses it four times, but abbreviations.json has no DCI row. Add 'DCI' -> 'D-Chiro-Inositol', term_slug='d-chiro-inositol'. Consider adding 'MI' -> 'Myo-Inositol' at the same time if the ratio language stays.

---

### `delayed-rupture-syndrome` — abbreviation_mismatch  ·  Part VI-D

**Field:** `abbreviation`

**Current:** DRS

**Evidence:** <strong>Delayed Rupture Syndrome (DRS) is a sonographic ovulation disorder, developed and formalized by Dr. Thomas W. Hilgers within <a href="/naprotechnology/">NaProTechnology</a>

**Suggested fix:** Term record carries abbreviation='DRS' and body_html introduces '(DRS)', but abbreviations.json has no DRS row. Add 'DRS' -> 'Delayed Rupture Syndrome', term_slug='delayed-rupture-syndrome'.

---

### `dysmenorrhea` — missing_citation  ·  Part VI-D

**Field:** `body_html`

**Current:** (entire entry carries zero <sup class="cite-ref"> markers)

**Evidence:** Persistent or severe dysmenorrhea triggers a thorough workup: cycle charting (<a href="/faqs/what-is-the-difference-between-creighton-model-marquette-method-femm-and-symptot/">Creighton Model</a>, FEMM), pelvic ultrasound, and laparoscopy with directed excision of endometriosis when pathology is confirmed.

**Canon:** Excision is the standard RRM position - it should be the best-cited claim, not the least-cited

**Suggested fix:** Zero citations in an entry that makes a mechanism claim (prostaglandin-mediated myometrial contractions and ischemia), an epidemiologic claim (onset within six to twelve months of menarche), a differential-diagnosis list, and a surgical recommendation (laparoscopy with directed excision). The excision recommendation in particular is the load-bearing RRM position on this page and should carry the strongest citation in the entry, not none. The RRM library has excision-outcome material available via rrm-cli; anchor at least the excision sentence and the primary-dysmenorrhea mechanism.

---

### `follicular-deficiency` — unsupported_claim  ·  Part VI-D

**Field:** `body_html`

**Current:** That failure pattern, when luteal rescue does not restore normal Peak+7 values, is itself diagnostic. ... Follicular deficiency is a recognized hidden contributor to luteal insufficiency, recurrent early pregnancy loss, and short luteal phase in cycles that carry no other obvious diagnosis.

**Evidence:** That failure pattern, when luteal rescue does not restore normal Peak+7 values, is itself diagnostic.

**Suggested fix:** Two strong claims carry no citation: that failure of luteal rescue 'is itself diagnostic', and that follicular deficiency is a 'recognized' contributor to recurrent early pregnancy loss. 'Recognized' asserts external consensus for a term the entry itself opens by calling 'a clinical RRM concept'. Either cite (Hilgers Ch 35 is the natural anchor, plus the RRM library holds 'Follicular phase treatment of luteal phase dysfunction' and 'Early follicular phase follicle-stimulating hormone treatment of endometrial luteal phase deficiency'), or soften 'recognized' to 'in RRM practice, understood as'.

---

### `hyperandrogenism` — factual_error  ·  Part VI-D

**Field:** `body_html`

**Current:** It is the defining feature of <a href="#pcos" class="gloss-xref">PCOS</a> in most international diagnostic criteria.

**Evidence:** It is the defining feature of <a href="#pcos" class="gloss-xref">PCOS</a> in most international diagnostic criteria.

**Suggested fix:** Not accurate for the criteria actually in force. Rotterdam 2003 and the 2023 International Evidence-based Guideline (modified Rotterdam) both permit a PCOS diagnosis without hyperandrogenism, on anovulation plus polycystic ovarian morphology. Only NIH 1990 and the AE-PCOS Society criteria require it. Since the 2023 international guideline is the current governing document, 'most international diagnostic criteria' points the reader the wrong way. Rewrite: 'It is required for diagnosis under the NIH 1990 and AE-PCOS Society criteria, and is one of the three Rotterdam features carried forward into the 2023 international guideline, where two of three suffice.'

**Adversarial verdict:** DOWNGRADE — Quote check: the current_value appears verbatim. The finding is real, the suggested fix is broadly sound, but P1 factual_error overstates it and the fix is incomplete.

I verified the governing criteria from the primary document rather than from Perplexity. Teede HJ et al., 'Recommendations from the 2023 International Evidence-based Guideline for the Assessment and Management of Polycystic Ovary S

**Corrected fix:** The suggested rewrite is accurate for adults but omits the adolescent rule, where hyperandrogenism IS required, which is the strongest part of the case for keeping the term prominent. Use instead: 'Hyperandrogenism is required for diagnosis under the NIH 1990 and Androgen Excess and PCOS Society criteria. Under the Rotterdam 2003 criteria and the 2023 International Evidence-based Guideline it is o

---

### `hyperandrogenism` — missing_citation  ·  Part VI-D

**Field:** `body_html`

**Current:** (entire entry carries zero <sup class="cite-ref"> markers)

**Evidence:** Biochemical hyperandrogenism is established by elevated free or total testosterone, DHEA-S, or androstenedione above age-specific reference ranges.

**Suggested fix:** Zero citations while making diagnostic-criteria claims, biochemical-threshold claims, and a differential-diagnosis exclusion requirement (non-classic 21-hydroxylase deficiency). The diagnostic-criteria sentence in particular is the one this audit found to be wrong, which is what happens when criteria claims go unanchored. Cite the 2023 International Evidence-based Guideline for the criteria sentence at minimum.

---

### `levothyroxine-in-fertility` — factual_error  ·  Part VI-D

**Field:** `body_html`

**Current:** During pregnancy, thyroid hormone requirements typically increase by thirty to fifty percent in the first trimester to meet gestational demands.

**Evidence:** During pregnancy, thyroid hormone requirements typically increase by thirty to fifty percent in the first trimester to meet gestational demands.

**Suggested fix:** The magnitude is right but the window is wrong. The requirement begins rising at 4-8 weeks but plateaus at 16-20 weeks, i.e. into the second trimester - the full 30-50% is not reached within the first trimester. The ATA-recommended immediate empiric step is 20-30% at confirmation of pregnancy. Rewrite: 'Thyroid hormone requirements begin rising within the first weeks of pregnancy and increase by roughly thirty to fifty percent overall, plateauing by about sixteen to twenty weeks. Guidelines recommend an empiric increase as soon as pregnancy is confirmed, with dose then guided by serial testing.'

---

### `levothyroxine-in-fertility` — study_attribution  ·  Part VI-D

**Field:** `body_html`

**Current:** the 2019 TABLET trial found no benefit in this population

**Evidence:** Evidence for levothyroxine use in euthyroid women who are TPO-antibody positive with recurrent miscarriage is mixed: the 2019 TABLET trial found no benefit in this population, and the question remains under active investigation.

**Suggested fix:** Two problems. (1) Population drift: TABLET enrolled euthyroid TPO-antibody-positive women with a history of miscarriage OR infertility, not recurrent miscarriage specifically. Saying 'no benefit in this population' where 'this population' has been defined as recurrent miscarriage overstates what TABLET settles. (2) The trial is named with a year but carries no reference marker, in a glossary where named studies elsewhere are cited. Add the citation (Dhillon-Smith RK et al., NEJM 2019) and widen the population wording to 'women with a history of miscarriage or infertility'. I confirmed the year, journal, population and null live-birth result via Perplexity but did not open the primary paper, 

---

### `oligospermia` — missing_citation  ·  Part VI-D

**Field:** `body_html`

**Current:** <a href="/naprotechnology/">NaProTECHNOLOGY</a>-based protocols address oligospermia within a couple-centered evaluation, with published outcomes reporting favorable pregnancy results in oligospermia-related infertility.

**Evidence:** with published outcomes reporting favorable pregnancy results in oligospermia-related infertility

**Suggested fix:** The entry asserts 'published outcomes' without pointing at a single publication, and it is the only outcome claim on the page. That is the weakest possible form of an RRM efficacy claim: it invites the 'no evidence' attack while supplying nothing to check. The Sanchez-Mendez 2025 cohort (ref 93 / ref 14 in this same glossary, PMC12660242) reports diagnosis-stratified results and is already in the reference table - cite it here, or cite whichever male-factor-specific analysis the claim is actually drawn from. Do not leave a bare 'published outcomes' claim standing.

---

### `omega-3-fatty-acids` — unsupported_claim  ·  Part VI-D

**Field:** `body_html`

**Current:** In reproductive medicine, omega-3s are associated with improved oocyte quality, reduced endometriosis-related inflammation, improved sperm motility and morphology, better endometrial blood flow, and reduced risk of <a href="#preterm-birth" class="gloss-xref">preterm birth</a>.

**Evidence:** In reproductive medicine, omega-3s are associated with improved oocyte quality, reduced endometriosis-related inflammation, improved sperm motility and morphology, better endometrial blood flow, and reduced risk of <a href="#preterm-birth" class="gloss-xref">preterm birth</a>.

**Suggested fix:** A five-item benefit list with zero citations, presented at a uniform confidence level when the underlying evidence is not uniform. Reduced preterm birth is the one item with randomised-trial support (the Cochrane review of omega-3 supplementation in pregnancy); oocyte quality, endometrial blood flow, endometriosis-related inflammation and sperm morphology rest on observational or mechanistic data. Split the list by evidence strength and cite at least the preterm-birth item: 'The strongest evidence is for reduced preterm birth risk. Signals for oocyte quality, endometrial blood flow, endometriosis-related inflammation and sperm parameters are mechanistic or observational and have not been set

---

### `partial-rupture-syndrome` — definition_drift  ·  Part VI-D

**Field:** `body_html`  ·  **ref#78**

**Current:** And it is distinct from <a href="#empty-follicle-syndrome" class="gloss-xref">Empty Follicle Syndrome</a>, where collapse appears complete but no oocyte is recovered.

**Evidence:** It is distinct from <a href="#delayed-rupture-syndrome" class="gloss-xref">Delayed Rupture Syndrome</a>, where full collapse eventually occurs but later than expected. And it is distinct from <a href="#empty-follicle-syndrome" class="gloss-xref">Empty Follicle Syndrome</a>, where collapse appears complete but no oocyte is recovered.

**Canon:** Hilgers sonographic classification (rrm-cli chapters 20/21/22)

**Suggested fix:** The whole entry is framed around a natural-cycle follicle maturation study, where no aspiration occurs and therefore nothing can be 'recovered'. The 'no oocyte is recovered' wording is the Bustillo/Schulman/Coulam 1986 Fertil Steril IVF-retrieval definition. Hilgers has his OWN sonographic EFS definition (Hilgers TW et al., 'Sonographic definition of the empty follicle syndrome', J Ultrasound Med 1989; and 'Assessment of the empty follicle syndrome by transvaginal sonography', J Ultrasound Med 1992 - both present in the RRM library). Reword to the sonographic sense, e.g. 'where the follicle appears to collapse but the sonographic features of true oocyte release are absent', and cite the Hilg

---

### `partial-rupture-syndrome` — abbreviation_mismatch  ·  Part VI-D

**Field:** `abbreviation`

**Current:** PRS

**Evidence:** <strong>Partial Rupture Syndrome (PRS) is an ovulation disorder in which the dominant follicle decreases in size at the expected time of ovulation

**Suggested fix:** The term record carries abbreviation='PRS' and body_html introduces '(PRS)', but there is no matching row in glossary_abbreviations (verified against the full 71-row abbreviations.json dump: LUF, OAT, POI, DOR etc. are present; PRS, DRS and AF are not). Add a glossary_abbreviation row 'PRS' -> 'Partial Rupture Syndrome' with term_slug='partial-rupture-syndrome', or drop the abbreviation field for consistency.

---

### `perimenopause` — clinical_accuracy  ·  Part VI-D

**Field:** `body_html`

**Current:** Couples who do not wish to conceive should understand that contraceptive needs persist until 12 consecutive months of amenorrhea confirm <a href="#menopause" class="gloss-xref">Menopause</a>.

**Evidence:** contraceptive needs persist until 12 consecutive months of amenorrhea confirm <a href="#menopause" class="gloss-xref">Menopause</a>.

**Suggested fix:** The 12-month rule defines menopause, but it is not the contraception-cessation rule for women under 50, where guideline practice requires 24 months of amenorrhea because ovarian activity can resume. Since perimenopause routinely begins in the forties, this matters for the actual reader. Add the age split: 'twelve consecutive months of amenorrhea at age fifty or over, and twenty-four months under fifty.' Note: I did not pull the FSRH or NAMS documents directly, so confirm the exact wording before publishing the numbers.

---

### `perimenopause` — citation_mismatch  ·  Part VI-D

**Field:** `body_html`  ·  **ref#218**

**Current:** typically spanning 4 to 10 years

**Evidence:** <strong>Perimenopause is the biological transition period preceding menopause, typically spanning 4 to 10 years, during which ovarian function declines progressively and menstrual cycle patterns become irregular.</strong>

**Suggested fix:** The '4 to 10 years' span is not stated in ref 218 (STRAW+10), which is the only citation in that paragraph, and it conflates the transition itself (SWAN median ~4.5 years) with the longer symptomatic window. Either cite SWAN directly and give the median, or soften to 'typically several years, with wide individual variation'. Low-severity because the range is not wrong, only imprecise and mis-sourced.

---

### `preterm-birth` — unsupported_claim  ·  Part VI-D

**Field:** `body_html`

**Current:** The Prematurity Prevention Program developed by Thomas Hilgers at the Pope Paul VI Institute combines serial hormone monitoring during pregnancy with bioidentical progesterone support when levels fall below established curve thresholds, with reported reductions in spontaneous preterm delivery rates compared to standard obstetric care.

**Evidence:** with reported reductions in spontaneous preterm delivery rates compared to standard obstetric care

**Suggested fix:** The phrase 'compared to standard obstetric care' asserts a comparison that no published controlled study supports - the accessible figures compare an internal rate to a national average, with no concurrent control group, no published methods and no peer-reviewed indexing. This is precisely the kind of claim that hands critics a free hit. Two options, both better than the status quo: (a) drop the comparator and describe the program on its own terms - 'combines serial hormone monitoring during pregnancy with bioidentical progesterone support, with outcomes reported in the NaProTechnology textbook'; or (b) keep an outcome claim but state the design honestly and cite it. Do NOT leave an uncited 

**Adversarial verdict:** DOWNGRADE — Quote verified verbatim. The reviewer is right on one narrow point and wrong on the framing. Narrow point confirmed by me on PubMed: Hilgers TW has 23 indexed records, none of which is a prematurity-prevention outcomes study, and the query for 'prematurity prevention' AND (naprotechnology OR 'Pope Paul') returns zero. So no peer-reviewed controlled trial is indexed. Where the reviewer is wrong is 

**Corrected fix:** Keep the outcome claim, cite it, and tighten the comparator. Replace 'with reported reductions in spontaneous preterm delivery rates compared to standard obstetric care' with 'with substantial reductions in preterm delivery reported against the institution's own rates before the protocol was implemented', carrying a citation to ref 78 (Hilgers TW, The Medical and Surgical Practice of NaProTECHNOLO

---

### `preterm-birth` — outdated_nomenclature  ·  Part VI-D

**Field:** `body_html`

**Current:** The Prematurity Prevention Program developed by Thomas Hilgers at the Pope Paul VI Institute

**Evidence:** developed by Thomas Hilgers at the Pope Paul VI Institute

**Suggested fix:** The institution renamed to 'Saint Paul VI Institute' following the 2018 canonisation, and that is the name it uses itself today. A present-tense sentence should use the current name. Note the distinction: reference 78's publisher field ('Pope Paul VI Institute Press; 2004') is correct as historical bibliographic data and must NOT be changed - only the body prose should be updated. Also consider matching the byline style used elsewhere in this part, 'Dr. Thomas W. Hilgers'.

---

### `vitamin-d` — missing_citation  ·  Part VI-D

**Field:** `body_html`

**Current:** (entire entry carries zero <sup class="cite-ref"> markers)

**Evidence:** Vitamin D deficiency is associated with reduced ovarian stimulation response in women with PCOS, lower live birth rates, impaired endometrial receptivity, and increased miscarriage risk.

**Suggested fix:** Zero citations behind a four-item clinical-association list. The evidence is observational throughout, with no randomised supplementation trial showing improved live birth - a distinction worth making explicit in a public entry, since a reader will otherwise infer that correcting deficiency raises live birth. Add a qualifier along the lines of 'These are observational associations; randomised supplementation trials have not yet demonstrated improved live birth rates', and cite the ART meta-analyses. The CoQ10 entry in this same part models the right posture.

---

### `cycle-timed-diagnostics` — evidence_strength  ·  Part VII

**Field:** `body_html`  ·  **ref#117**

**Current:** This principle transforms charting from a family planning tool into a clinical diagnostic instrument.<sup class="cite-ref"><a href="#ref-3">3</a></sup><sup class="cite-ref"><a href="#ref-117">117</a></sup>

**Evidence:** Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of  Infertility in Polycystic Ovary Syndrome-Case Report

**Canon:** rrm-cli library record: successful-implementation-of-menstrual-cycle-biomarkers-in-the-treatment-of-infe-recgrmsnfyc5dmeuu, Healthcare (Basel), 2023

**Suggested fix:** The references.json anchor_text for ref 117 is truncated to 'Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of Infertility in Polycystic Ovary Syndrome.' - dropping the '-Case Report' suffix that the RRM library record carries. A single case report is thin support for a general diagnostic principle, and hiding its design in the anchor text overstates the evidence. Fix the anchor_text to include '-Case Report' (a references.json-level fix affecting every term that cites 117), and lean the principle claim on ref 3 (Stanford 2021, n=370) which is the stronger of the two.

---

### `follicle-stimulation` — citation_support  ·  Part VII

**Field:** `body_html`  ·  **ref#268**

**Current:** Restorative protocols aim for a single, well-developed follicle, which lowers the chance of conceiving multiples compared with retrieval-based stimulation, though the risk remains higher than in an unstimulated natural cycle.<sup class="cite-ref"><a href="#ref-268">268</a></sup>

**Evidence:** Restorative protocols aim for a single, well-developed follicle, which lowers the chance of conceiving multiples compared with retrieval-based stimulation, though the risk remains higher than in an unstimulated natural cycle.<sup class="cite-ref"><a href="#ref-268">268</a></sup>

**Canon:** rrm-cli get --full on Stanford 2021 (recyiv7uvglmix9ex): 'Any ovulation drug 229 (62)'

**Suggested fix:** Ref 268 (Boyle PC et al, 'Healthy Singleton Pregnancies From Restorative Reproductive Medicine (RRM) After Failed IVF', Front Med 2018) supports the singleton-outcome half of this sentence but is not a comparative multiples-risk analysis and says nothing about risk relative to an unstimulated natural cycle. Add ref 3 (Stanford 2021), which carries a directly quotable multiples denominator I verified in full text: 'There were 2 sets of twins and no higher-order multiple gestations' among 370 couples, 62% of whom received ovulation-stimulating medication.

---

### `functional-nutritional-medicine` — consensus_conflict  ·  Part VII

**Field:** `body_html`

**Current:** Methylated folate is relevant for couples with MTHFR variants, where standard folic acid supplementation may not achieve adequate tissue levels.

**Evidence:** <a href="#methylated-folate" class="gloss-xref">Methylated folate</a> is relevant for couples with MTHFR variants, where standard folic acid supplementation may not achieve adequate tissue levels. These are not fringe considerations; they are well-documented physiological mechanisms with published reproductive relevance.

**Canon:** Mainstream = ACMG/ACOG. RRM canon does not have a stated position on MTHFR that I could locate in rrm-cli.

**Suggested fix:** HUMAN ARBITRATION REQUIRED - do not auto-change. Mainstream position (ACMG 2013 practice guideline, endorsed by ACOG) is directly opposed: 'MTHFR polymorphism genotyping should not be ordered as part of the clinical evaluation for thrombophilia or recurrent pregnancy loss' and 'MTHFR status does not change the recommendation that women of childbearing age should take the standard dose of folic acid supplementation.' The RRM/functional-medicine position may still be the house position, but this sentence carries no citation at all while the adjacent sentence asserts 'These are not fringe considerations; they are well-documented physiological mechanisms with published reproductive relevance.' I

---

### `nfp-medical-consultant` — abbreviation_mismatch  ·  Part VII

**Field:** `name / abbreviation / body_html`

**Current:** A NaProTechnology Medical Consultant (NFPMC) is a physician who has completed formal postgraduate training in NaProTechnology

**Evidence:** <strong>A <a href="/naprotechnology/">NaProTechnology</a> Medical Consultant (NFPMC) is a physician who has completed formal postgraduate training in NaProTechnology through an accredited program.</strong>

**Canon:** abbreviations.json row: {'abbreviation': 'NFPMC', 'full_term': 'NaProTechnology Medical Consultant', 'term_slug': 'nfp-medical-consultant'}

**Suggested fix:** The letters N-F-P-M-C do not derive from 'NaProTechnology Medical Consultant'. The slug itself (nfp-medical-consultant) is the fossil evidence that this was originally 'NFP Medical Consultant'. The glossary_abbreviation row repeats the mismatched expansion (NFPMC = 'NaProTechnology Medical Consultant'). Separately, AAFCP's own certification list names the physician credential 'FertilityCare Medical Consultant', not 'NaProTechnology Medical Consultant'. Recommended fix: keep 'NaProTechnology Medical Consultant' as the plain-English role name for SEO/patient search, but state the credential letters accurately, e.g. 'often credentialed as an NFP Medical Consultant (NFPMC) or FertilityCare Medic

---

### `pelvic-floor-physical-therapy` — citation_uncertain  ·  Part VII

**Field:** `body_html`  ·  **ref#222**

**Current:** A 2025 systematic review and meta-analysis confirmed that physical rehabilitation reduces endometriosis and adenomyosis-related symptom burden, with locally applied techniques showing the strongest effect.<sup class="cite-ref"><a href="#ref-222">222</a></sup>

**Evidence:** A 2025 systematic review and meta-analysis confirmed that physical rehabilitation reduces endometriosis and adenomyosis-related symptom burden, with locally applied techniques showing the strongest effect.<sup class="cite-ref"><a href="#ref-222">222</a></sup>

**Suggested fix:** The specific 'locally applied techniques showing the strongest effect' finding could only be verified verbatim in a sibling publication by the same group (a Pain Medicine meta-analysis: 'locally applied interventions might be more effective (MD -2.26, 95% CI -3.28 to -1.24, P = .004)'), not in ref 222 (Rodriguez-Ruiz A et al, J Clin Med 2025;14(23)) itself. Verify that the J Clin Med paper carries the locally-applied subgroup result before publishing; if it does not, either re-attribute to the correct paper or drop the subgroup clause. Also soften 'confirmed' - a single meta-analysis does not confirm.

---

### `pelvic-floor-physical-therapy` — abbreviation_missing  ·  Part VII

**Field:** `body_html`

**Current:** Pelvic floor physical therapy (PFPT) is a specialized rehabilitation discipline

**Evidence:** <strong>Pelvic floor physical therapy (PFPT) is a specialized rehabilitation discipline that evaluates and treats musculoskeletal contributors to chronic pelvic pain, dyspareunia, voiding and bowel dysfunction, and post-surgical or postpartum pelvic floor impairment.</strong>

**Canon:** abbreviations.json (70 rows, no PFPT)

**Suggested fix:** The body introduces PFPT and then uses it three more times, but there is no PFPT row in glossary_abbreviation (verified: 70 rows, 'PFPT' absent) and the term's own abbreviation field is null. Add abbreviation row PFPT = 'Pelvic Floor Physical Therapy' with term_slug pelvic-floor-physical-therapy, and populate the term's abbreviation field.

---

### `reproductive-endocrinology` — abbreviation_missing  ·  Part VII

**Field:** `body_html`

**Current:** Reproductive Endocrinology and Infertility (REI) developed with close ties to assisted reproductive technology

**Evidence:** As a conventional subspecialty, Reproductive Endocrinology and Infertility (REI) developed with close ties to assisted reproductive technology, making IVF a central clinical pathway for many fellowship-trained practitioners.

**Canon:** abbreviations.json (70 rows, no REI)

**Suggested fix:** The body introduces the abbreviation REI but there is no row for REI in glossary_abbreviation (verified: 70 rows dumped, 'REI' absent). Either add a row REI = 'Reproductive Endocrinology and Infertility' or drop the parenthetical since REI is never reused in this term.

---

### `art` — citation_drift  ·  Part VIII

**Field:** `body_html`  ·  **ref#97**

**Current:** Note that intrauterine insemination (IUI), while sometimes grouped colloquially with fertility treatments, does not involve eggs handled outside the body and is classified separately from ART in CDC, HFEA, and SART reporting.

**Evidence:** is classified separately from ART in CDC, HFEA, and SART reporting.<sup class="cite-ref"><a href="#ref-97">97</a></sup>

**Suggested fix:** The substance is correct - I verified it - but ref 97 is the HFEA 'Fertility Treatment 2019: Trends and Figures' report, which cannot establish how CDC and SART classify IUI. Cite the CDC ART glossary or the federal definition alongside it. CDC states verbatim: 'IUI is not considered an ART procedure because it does not involve the manipulation of eggs', and the federal definition SART reports under states 'ART does not include assisted insemination using sperm from either a woman's partner or sperm donor.' Separately, ref 97 is now a 2019 dataset used for two different claims in this term; refresh to the latest HFEA Trends and Figures edition.

---

### `art` — xref_mismatch  ·  Part VIII

**Field:** `body_html`

**Current:** The category includes <a href="#ivf-vs-rrm" class="gloss-xref">in vitro fertilization</a> (IVF), <a href="#icsi" class="gloss-xref">intracytoplasmic sperm injection</a> (ICSI), donor egg and donor sperm cycles, embryo banking, frozen embryo transfer, and gestational surrogacy.

**Evidence:** The category includes <a href="#ivf-vs-rrm" class="gloss-xref">in vitro fertilization</a> (IVF), <a href="#icsi" class="gloss-xref">intracytoplasmic sperm injection</a> (ICSI), donor egg and donor sperm cycles, embryo banking, frozen embryo transfer, and gestational surrogacy.

**Suggested fix:** In a list of what ART includes, 'in vitro fertilization' should link to the definitional #ivf term, not to the #ivf-vs-rrm comparison essay. The sibling term ICSI in the same sentence correctly links to #icsi. Repoint to href="#ivf". Third instance of the same defect (see also iui, icsi).

---

### `couple-based-treatment` — reference_metadata  ·  Part VIII

**Field:** `reference ref-193`  ·  **ref#193**

**Current:** Schlegel PN, Sigman M, Collura B, et al. Diagnosis and Treatment of Infertility in Men: AUA/ASRM Guideline Part I. Fertil Steril. 2021;115(1):54-61. -> https://pubmed.ncbi.nlm.nih.gov/33295257/

**Evidence:** --- PMID 33295257
 TITLE: Diagnosis and Treatment of Infertility in Men: AUA/ASRM Guideline Part I.
 JOURNAL: J Urol | 2021 Jan |vol 205 |pages 36-43

**Suggested fix:** The citation string and the identifier disagree. PMID 33295257 is the JOURNAL OF UROLOGY printing (J Urol 2021;205(1):36-43); the Fertil Steril 2021;115(1):54-61 printing that the anchor text describes is PMID 33309062 - which is separately stored as ref 374 and cited in the icsi term. Verified via NCBI esummary on both PMIDs. Fix: point ref 193 at PMID 33309062 to match its own citation string, then merge refs 193 and 374 into one row (they are the same guideline) and repoint the icsi citation.

---

### `gonadotropins` — internal_contradiction  ·  Part VIII

**Field:** `body_html`

**Current:** When used, gonadotropin cycles are closely monitored by serial transvaginal ultrasound to detect multi-follicular development and reduce the risk of ovarian hyperstimulation syndrome (OHSS).

**Evidence:** OHSS does not occur in restorative reproductive medicine protocols.

**Suggested fix:** This entry says RRM practice uses injectable gonadotropins and monitors those cycles to reduce OHSS risk; the ohss entry (same part, sort_order 11) says OHSS does not occur in restorative protocols at all. The two cannot both be published. The P0 fix belongs on the ohss term - soften that absolute rather than deleting the honest risk language here, which is the accurate half of the pair. Whichever way it is resolved, both entries must be edited in the same change so the glossary does not ship contradicting itself.

---

### `hrt` — outdated_nomenclature  ·  Part VIII

**Field:** `name`

**Current:** Hormone Replacement Therapy (HRT)

**Evidence:** <strong>Hormone replacement therapy (HRT) is the exogenous administration of estrogen, progesterone, or both, to address the decline in hormonal production that occurs during <a href="#perimenopause" class="gloss-xref">perimenopause</a>, <a href="#menopause" class="gloss-xref">menopause</a>, or in conditions such as <a href="#poi" class="gloss-xref">premature ovarian insufficiency (POI)</a>.</strong>

**Suggested fix:** 'HRT' has been superseded in professional usage by 'menopausal hormone therapy (MHT)' or simply 'hormone therapy (HT)' - the Menopause Society, IMS and ESHRE all use the newer terms, and the shift was deliberate, because 'replacement' implies restoring a physiological state that hormone therapy does not restore. Keep HRT as the head term for search discoverability but add one clause on first use: 'also called menopausal hormone therapy (MHT), the term now preferred in professional guidelines'. This matters here because the entry's own second paragraph draws the replacement-vs-suppression distinction, and the nomenclature note reinforces that argument rather than undercutting it.

---

### `icsi` — xref_mismatch  ·  Part VIII

**Field:** `body_html`

**Current:** It was developed in the early 1990s as a response to severe male factor infertility where conventional <a href="#art" class="gloss-xref">IVF</a> fertilization rates were poor.

**Evidence:** It was developed in the early 1990s as a response to severe <a href="#male-factor-infertility" class="gloss-xref">male factor infertility</a> where conventional <a href="#art" class="gloss-xref">IVF</a> fertilization rates were poor.

**Suggested fix:** Anchor text 'IVF' points at #art. A dedicated #ivf term exists. Repoint to href="#ivf". Same defect class as in the iui and art terms - fix all three in one pass.

---

### `iui` — xref_mismatch  ·  Part VIII

**Field:** `body_html`

**Current:** It is less technically demanding than <a href="#art" class="gloss-xref">IVF</a> and does not require egg retrieval or laboratory fertilization.

**Evidence:** It is less technically demanding than <a href="#art" class="gloss-xref">IVF</a> and does not require egg retrieval or laboratory fertilization.

**Suggested fix:** Anchor text reads 'IVF' but the href points to #art. A dedicated #ivf term exists in the glossary (slug 'ivf', Part VIII sort_order 2). Repoint to href="#ivf". This is one instance of a three-place pattern: icsi has the same #art-labelled-IVF link, and art links 'in vitro fertilization' to #ivf-vs-rrm. Fix all three together.

---

### `ivf` — citation_mismatch  ·  Part VIII

**Field:** `body_html`  ·  **ref#284**

**Current:** Endometriosis, one of the most common underlying conditions in infertile women, can persist and progress during and after IVF regardless of reproductive outcome.

**Evidence:** Endometriosis, one of the most common underlying conditions in infertile women, can persist and progress during and after IVF regardless of reproductive outcome.<sup class="cite-ref"><a href="#ref-284">284</a></sup>

**Suggested fix:** Ref 284 is Somigliana E et al., 'Risk of endometriosis progression in infertile women trying to conceive naturally or using IVF', Hum Reprod 2025;40(7):1249-1256 (PMID 40344687, verified via NCBI esummary). Its headline direction runs opposite to the rhetorical use here: it frames the ART evidence as reassuring and indicates progression risk is if anything slightly higher with natural conception attempts than with ART. Citing it to support an anti-IVF contrast hands a critic a free hit. Either (a) requote it accurately as 'endometriosis carries a low but consistent risk of progression during any conception attempt, roughly 10% over a year, whether natural or IVF' and keep the RRM point that 

**Adversarial verdict:** DOWNGRADE — Quote check PASSES: the sentence with its ref-284 superscript appears verbatim in ivf body_html. Ref 284 identity confirmed via NCBI esummary: PMID 40344687 = Somigliana E, Vigano' P, Invernici D, Fornelli G, Merli CEM, Vercellini P, Hum Reprod 2025;40(7):1249-1256, DOI 10.1093/humrep/deaf090, PMC12222615. It is a narrative REVIEW, not a cohort study. I resolved the prior reviewer's own CAVEAT: I 

**Corrected fix:** Do NOT apply the prior reviewer's option (a). Its proposed replacement text, 'endometriosis carries a low but consistent risk of progression during any conception attempt, roughly 10% over a year, whether natural or IVF', imports the mainstream comparative frame into RRM copy and would have the glossary imply that trying naturally is at least as risky as IVF. That is false balance that softens the

---

### `ivf-vs-rrm` — citation_drift  ·  Part VIII

**Field:** `body_html`  ·  **ref#309**

**Current:** A rate quoted per embryo transferred excludes couples who never reach transfer and cycles that are cancelled, which is why national registries also report outcomes per cycle started and per intended retrieval.

**Evidence:** which is why national registries also report outcomes per cycle started and per intended retrieval.<sup class="cite-ref"><a href="#ref-309">309</a></sup>

**Suggested fix:** Ref 309 is Malizia BA, Hacker MR, Penzias AS, 'Cumulative live-birth rates after in vitro fertilization', N Engl J Med 2009;360(3):236-43 (verified via NCBI esummary). That is a single-centre (Boston IVF) cumulative-outcome analysis, not a national registry practice. It supports the denominator point but not the specific assertion about what national registries report. Either reattribute the sentence to a registry source (CDC ART National Summary or HFEA methodology) or reword to 'which is why cumulative analyses report outcomes per cycle started rather than per transfer'.

---

### `napro-vs-rrm` — canonical_name  ·  Part VIII

**Field:** `body_html`

**Current:** Other approaches sharing this philosophy include: NeoFertility, Marquette Method-based medical management, and FEMM-based care.

**Evidence:** Other approaches sharing this philosophy include: <a href="#neofertility" class="gloss-xref">NeoFertility</a>, Marquette Method-based medical management, and <a href="#femm" class="gloss-xref">FEMM</a>-based care.

**Canon:** RRM canonical names: Marquette Model (not Marquette Method)

**Suggested fix:** Change 'Marquette Method-based medical management' to 'Marquette Model-based medical management'. Note the same paragraph correctly uses the canonical 'Creighton Model FertilityCare System', so the drift is isolated to this one name.

---

### `nutritional-lifestyle-medicine` — citation_drift  ·  Part VIII

**Field:** `body_html`  ·  **ref#87**

**Current:** A charted cycle showing luteal phase abnormalities, for example, may reflect nutritional gaps or metabolic dysfunction that a hormone panel alone would not fully explain.

**Evidence:** A charted cycle showing luteal phase abnormalities, for example, may reflect nutritional gaps or metabolic dysfunction that a hormone panel alone would not fully explain.<sup class="cite-ref"><a href="#ref-87">87</a></sup>

**Suggested fix:** Ref 87 is the ASRM committee opinion 'Optimizing natural fertility', which covers the fertile window, coital timing, BMI, smoking, caffeine and alcohol. It does not make the specific claim that charted luteal-phase abnormalities reflect nutritional or metabolic gaps that a hormone panel would miss - that is an RRM clinical inference laid on top of it. Either move ref 87 to the preceding general lifestyle sentence where it does fit, or cite an RRM source for the charting-to-nutrition inference (ref 89, 'The importance of fertility awareness in the assessment of a woman's health', is already in the reference set and is a closer fit).

---

### `oral-contraceptive` — abbreviation_missing  ·  Part VIII

**Field:** `body_html`

**Current:** Combined oral contraceptives (COCs) contain synthetic estrogen and progestin.

**Evidence:** Combined oral contraceptives (COCs) contain synthetic estrogen and progestin. Progestin-only pills contain progestin alone.

**Suggested fix:** The body introduces COC/COCs as an abbreviation but there is no row for it in glossary_abbreviation (I checked all rows; OC, IUD, HRT, ICSI, OHSS, ART, IUI, IVF, FSH, LH, POI, ROS, PCOS and FEMM are present, COC is not). Either add a COC row pointing at this slug, or drop the parenthetical and write 'combined pills' in the following sentence, which is what the rest of the paragraph already does. Same gap pattern as 'hMG' in gonadotropins and 'CIO' in iirrm.

---

### `progestins` — protocol_adjacent  ·  Part VIII

**Field:** `body_html`

**Current:** For luteal phase defect, threatened miscarriage, and premenstrual symptoms, RRM clinicians use bioidentical progesterone (typically intramuscular, vaginal, or oral micronized formulations) rather than synthetic progestins, on the basis of differing receptor pharmacology, breast cancer risk profiles, and pregnancy safety data.

**Evidence:** For luteal phase defect, threatened miscarriage, and premenstrual symptoms, RRM clinicians use bioidentical progesterone (typically intramuscular, vaginal, or oral micronized formulations) rather than synthetic progestins, on the basis of differing receptor pharmacology, breast cancer risk profiles, and pregnancy safety data.

**Canon:** NO PUBLIC PROTOCOLS OR DOSINGS

**Suggested fix:** Filed at P2 rather than P1 deliberately, and here is the reasoning so a human can overrule it: there are no mg amounts, no cycle-day timing (nothing of the P+3 to P+12 kind), and no percentages lifted from a textbook - so it does not meet the P1 protocol-leak bar on its face. What it does publish is an indication list paired with a route list, which is one editing pass away from reading as a prescribing summary. Recommend dropping the parenthetical routes and keeping the pharmacological argument: '...RRM clinicians use bioidentical progesterone rather than synthetic progestins, on the basis of differing receptor pharmacology, breast cancer risk profiles, and pregnancy safety data. Formulatio

---

## P3 — enhancement (157)

### `comprehensive-evaluation` — style_double_hyphen  ·  Part I

**Field:** `body_html (two inline glosses)`

**Current:** saline infusion sonohysterogram -- a fluid-enhanced ultrasound to assess uterine cavity) ... hysterosalpingogram (HSG -- an X-ray procedure to evaluate tubal openness)

**Evidence:** 'saline infusion sonohysterogram -- a fluid-enhanced ultrasound to assess uterine cavity)' and 'hysterosalpingogram (HSG -- an X-ray procedure to evaluate tubal openness)'

**Suggested fix:** No literal em dash is present anywhere in Part I (verified by codepoint scan), so the em-dash rule is not violated. But a bare '--' renders as a visible double hyphen in published body copy. Recast with a comma or colon: 'saline infusion sonohysterogram, a fluid-enhanced ultrasound of the uterine cavity' and 'hysterosalpingogram (HSG), an X-ray procedure to evaluate tubal openness'. Same pattern occurs once in personalized-treatment.

---

### `holistic-approach` — pcos_pmos_dual_label  ·  Part I

**Field:** `body_html (insulin resistance sentence)`

**Current:** Insulin resistance drives anovulation in <a href="/glossary/pcos/">PCOS</a>.

**Evidence:** Thyroid dysfunction alters cycle length and luteal function. Insulin resistance drives anovulation in PCOS. Chronic inflammation affects implantation.

**Canon:** PCOS/PMOS dual label, 3-year transition

**Suggested fix:** Not an error. But this is the single sentence in Part I where the RRM-preferred dual label earns its keep: the claim is explicitly about a metabolic driver, which is the whole argument for PCOS/PMOS. Consider 'Insulin resistance drives anovulation in PCOS/PMOS' during the 3-year transition. The estrone entry carries the same opportunity ('particularly in obesity and PCOS'). Keep slugs unchanged.

---

### `natural-fertility` — outdated_source  ·  Part I

**Field:** `references.json ref_num 87 (URL points at the 2017 edition)`  ·  **ref#87**

**Current:** ref 87 -> /library/optimizing-natural-fertility-a-committee-opinion-rechyu5vnvihyqdwy/ (ASRM committee opinion, 2017)

**Evidence:** rrm-cli search returned two library records: "optimizing-natural-fertility-a-committee-opinion-rechyu5vnvihyqdwy" ... "year":2017 and "optimizing-natural-fertility-a-committee-opinion-y7bycdvm" ... "authors":"Practice Committee of the American Society for Reproductive Medicine","year":2022

**Suggested fix:** Repoint ref 87 to the 2022 committee opinion already in the RRM library (slug optimizing-natural-fertility-a-committee-opinion-y7bycdvm), which also carries proper authorship instead of 'No Authors Listed'.

---

### `personalized-treatment` — style_double_hyphen  ·  Part I

**Field:** `body_html (male-partner sentence)`

**Current:** Male-partner treatment is personalized in the same framework -- varicocele repair timing, antioxidant protocols, and hormonal correction are determined by each man's specific workup, not a uniform andrology algorithm.

**Evidence:** framework -- varicocele repair timing, antioxidant protocols, and hormonal correction are determined by each man's specific workup, not a uniform andrology algorithm

**Suggested fix:** Replace ' -- ' with a colon: 'Male-partner treatment is personalized in the same framework: varicocele repair timing, antioxidant protocols, and hormonal correction are determined by each man's specific workup, not a uniform andrology algorithm.' No literal em dash is present, so this is typography only.

---

### `thyroid` — uncited_attribution  ·  Part I

**Field:** `body_html (case report claim)`

**Current:** published case reports document conception after combined thyroid and ovulation-support treatment.

**Evidence:** <a href="/naprotechnology/">NaProTECHNOLOGY</a> evaluation addresses thyroid replacement in the context of infertility, and published case reports document conception after combined thyroid and ovulation-support treatment.

**Suggested fix:** 'Published case reports document...' asserts a literature base with no reference in a term that carries zero citations. Either cite one (the RRM library holds candidates, e.g. Kicinska AM et al., Healthcare 2023, 'Successful Implementation of Menstrual Cycle Biomarkers in the Treatment of Infertility in Polycystic Ovary Syndrome - Case Report', though I did not verify that its thyroid content matches this sentence) or drop the appeal to unnamed literature.

---

### `bbt` — internal_consistency  ·  Part II

**Field:** `body_html`  ·  **ref#99**

**Current:** BBT rises 0.2 to 0.6 degrees C within one to three days after ovulation

**Evidence:** BBT rises 0.2 to 0.6 degrees C within one to three days after ovulation due to the thermogenic effect of progesterone released by the corpus luteum.

**Suggested fix:** The sibling sympto-thermal-method term states '0.2 to 0.5 degrees Celsius' for the same physiological event. Harmonise the two entries. 0.2-0.6 C is a legitimate conversion of the 0.4-1.0 F range used in some FABM teaching, so this is a consistency fix, not a factual correction; pick one range and use it in both terms. The timing window 'one to three days' is also wider than the usual 'within about one day' but is defensible for delayed thermal shifts.

---

### `billings-ovulation-method` — historical_precision  ·  Part II

**Field:** `body_html`

**Current:** developed by Australian physicians Drs. John and Evelyn Billings in the 1950s

**Evidence:** The Billings Ovulation Method (BOM) is a mucus-only fertility awareness method developed by Australian physicians Drs. John and Evelyn Billings in the 1950s, based on the recognition that cervical mucus characteristics at the vulva change predictably across the cycle in response to estrogen and progesterone.

**Suggested fix:** Tighten to: 'developed in Melbourne by Dr John Billings, whose research began in 1953, and further developed with his wife Dr Evelyn Billings.' Acceptable as a lay summary today, so P3 only. I did not independently confirm the year Evelyn Billings joined and no year should be asserted for her without a primary source.

---

### `cervical-mucus-patterns` — wrong_link_target  ·  Part II

**Field:** `body_html`

**Current:** <a href="#peak-symptom">Peak Day</a>

**Evidence:** The Peak Day, defined as the last day of clear, stretchy, or lubricative mucus, correlates within one to two days of ovulation in approximately 90% of cycles.

**Suggested fix:** The anchor text reads 'Peak Day' but the href points to #peak-symptom, and a dedicated #peak-day term exists (the glossary carefully distinguishes the two: the peak symptom is the observation, Peak Day is the chart label). Repoint to #peak-day.

---

### `creighton-model` — statistic_precision  ·  Part II

**Field:** `body_html`  ·  **ref#8**

**Current:** reported a 13-cycle pregnancy rate of 89.6% among couples using correct CrMS technique and timing intercourse to peak-type mucus days

**Evidence:** The CEIBA prospective cohort study, conducted across 17 CrMS centers in the USA and Canada, reported a 13-cycle pregnancy rate of 89.6% among couples using correct CrMS technique and timing intercourse to peak-type mucus days.

**Canon:** rrm-cli full text of ref 8 (Stanford JB et al., PLoS One 2025): 'For correct use to conceive, the highest cumulative 13-cycle pregnancy rate was 89.6%, with intercourse on peak-type mucus days, which are the days of higher fertility'

**Suggested fix:** The number is exactly right, but 89.6% is the HIGHEST of several correct-use-to-conceive definitions (the paper also reports 88.0-89.8% by cycle intention), computed on the 184 couples who confirmed complete intercourse recording. Restore the word 'highest' (the earlier published glossary text in the library snapshot had it: 'found the highest 13-cycle pregnancy rate with correct use to conceive was 89.6%'). This strengthens rather than weakens the claim by making it audit-proof.

---

### `creighton-model` — canonical_name  ·  Part II

**Field:** `body_html`

**Current:** NaProTECHNOLOGY

**Evidence:** It is used by couples to achieve or avoid pregnancy and, in conjunction with NaProTECHNOLOGY, to identify cycle-phase abnormalities that guide targeted medical and surgical treatment.

**Suggested fix:** Part II mixes 'NaProTECHNOLOGY' (creighton-model, peak-day) with 'NaProTechnology' (dpo, vdrs, mucus-cycle-score, limited-mucus-cycle, tail-end-brown-bleeding, premenstrual-bleeding, fertile-window). Pick one house form and apply it across the glossary; the abbreviations table currently carries 'NaProTECHNOLOGY (Natural Procreative Technology)' while the memory canon is 'NaProTechnology'. Human arbitration needed on which form wins.

---

### `dry-day` — internal_consistency  ·  Part II

**Field:** `body_html`

**Current:** Continuous or recurring mucus outside the normal fertile window can reflect a basic infertile pattern, hormonal dysregulation, or cervical irritation

**Evidence:** Continuous or recurring mucus outside the normal fertile window can reflect a basic infertile pattern, hormonal dysregulation, or cervical irritation, each pointing toward a distinct cause worth investigating.

**Canon:** The linked glossary term is titled 'Base Infertile Pattern (BIP)' and the glossary_abbreviation row reads 'Base Infertile Pattern'

**Suggested fix:** The anchor text here says 'basic infertile pattern' while linking to the term titled 'Base Infertile Pattern'. Resolve alongside the naming decision flagged on base-infertile-pattern (official Billings LIFE wording is 'Basic Infertile Pattern (BIP)'; Hilgers' textbook writes 'base infertile pattern (BIP)'). Whichever form wins, both places must match.

---

### `essential-sameness-pattern-yellow-stamps` — attribution  ·  Part II

**Field:** `body_html`

**Current:** The Essential Sameness Pattern (ESP) and Yellow Stamps are the CrMS construct for charting infertility windows when continuous discharge is present

**Evidence:** The Essential Sameness Pattern (ESP) and Yellow Stamps are the CrMS construct for charting infertility windows when continuous discharge is present: the ESP defines pre-Peak infertile days through day-to-day identical observations, and Yellow Stamps are the chart symbol that records those days.

**Canon:** rrm-cli, Hilgers Ch 8 'Charting Continuous Discharges': 'The original use of yellow stamps was introduced by Drs. John and Lyn Billings and published in the early 1970s. The work with yellow stamps in the CrMS began in 1976, and the system now has over 25 years of experience in their use.'

**Suggested fix:** Yellow stamps are not originally a CrMS construct: Hilgers credits Drs John and Lyn Billings (early 1970s), with CrMS work beginning in 1976. The ESP itself is CrMS. Add the attribution; it costs nothing and matches RRM's own textbook.

---

### `fabms` — terminology  ·  Part II

**Field:** `body_html`

**Current:** They also aid in identifying hormonal and cycle-related conditions, including PCOS.

**Evidence:** They also aid in identifying hormonal and cycle-related conditions, including PCOS.

**Canon:** RRM dual-label transition: PCOS/PMOS

**Suggested fix:** Use the RRM-preferred dual label 'PCOS/PMOS' on first mention during the 3-year transition. Same applies to the bare 'PCOS' mention in pre-peak-phase. Not an error as written.

---

### `femm` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#133**

**Current:** FEMM was developed through the Reproductive Health Research Institute and is taught through a tiered curriculum for both patients and clinicians.[ref-133]

**Evidence:** FEMM was developed through the Reproductive Health Research Institute and is taught through a tiered curriculum for both patients and clinicians.

**Suggested fix:** Ref 133 is the femmhealth.org home page, which is not a stable citation for a specific origin-and-curriculum claim. Deep-link to FEMM's own 'about'/'programs' page (or RHRI's) so the claim is verifiable. I could NOT independently confirm the RHRI development claim from a primary source in this pass, so treat it as unverified rather than wrong; the abbreviations table does carry RHRI = Reproductive Health Research Institute mapped to its own glossary term.

---

### `fertility-charting` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#100**

**Current:** Changes in charting patterns serve as a form of biofeedback to assess treatment efficacy.

**Evidence:** Tracking these observations across multiple cycles is essential: patterns invisible in a single cycle become diagnostically clear over time. Changes in charting patterns serve as a form of biofeedback to assess treatment efficacy.

**Suggested fix:** Ref 100 (Hilgers 1978, 'Natural family planning. I. The peak symptom and estimated time of ovulation') is about peak-symptom/ovulation timing and says nothing about charting as treatment-efficacy biofeedback; ref 1 is the IIRRM landing page. Recite to an on-point in-library source, e.g. Hilgers Ch 86 'Summary of NaProTECHNOLOGY Biomarkers' (rrmacademy.org library) which documents chart change before/after treatment, or drop the citation.

---

### `marquette-method` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#85**

**Current:** Published effectiveness data from prospective cohort studies support low pregnancy rates with correct use of the Marquette Method for avoiding pregnancy, consistent with other well-studied Fertility Awareness-Based Methods.[ref-85]

**Evidence:** Published effectiveness data from prospective cohort studies support low pregnancy rates with correct use of the Marquette Method for avoiding pregnancy, consistent with other well-studied Fertility Awareness-Based Methods.

**Canon:** Reference 414 already exists in the shared reference table: Fehring RJ, Schneider M, Barron ML, 'Efficacy of the Marquette Method of natural family planning', MCN 2008 (PMID 18997569); rrm-cli ref 85 abstract gives Marquette Monitor perfect use 0 and typical use 2-6.8 per 100 woman-years

**Suggested fix:** Add ref 414 (Fehring 2008, the method-specific efficacy study, already in the reference table and cited by the fertile-window term) alongside ref 85, and consider naming the numbers: perfect use 0 and typical use 2-6.8 per 100 woman-years for the monitor-only protocol. Strengthens the claim; no error as written.

---

### `mucus-cycle` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#79**

**Current:** Hilgers documented this architecture in CrMS training materials, charting the mucus cycle as its own bounded phase between menstruation and post-Peak dryness.[ref-79]

**Evidence:** Hilgers documented this architecture in CrMS training materials, charting the mucus cycle as its own bounded phase between menstruation and post-Peak dryness.

**Canon:** rrm-cli, Hilgers Ch 14 'Objective Classification of the Mucus Cycle': 'These scores are then tallied for the six days of the mucus cycle beginning five days prior to the Peak Day and including the Peak Day's observations ... The 6-day time frame was specifically chosen because it approximates the av

**Suggested fix:** Ref 79 is 'The NaProTECHNOLOGY Revolution' (Beaufort Books, 2010), a trade book, described here as 'CrMS training materials'. The on-point primary source is already in the RRM library: Hilgers Ch 14, 'Objective Classification of the Mucus Cycle', which defines the mucus cycle and gives its average 6-day length. Recite to that and drop the 'training materials' characterisation.

---

### `mucus-cycle-score` — definition_precision  ·  Part II

**Field:** `body_html`

**Current:** summarizes the cervical mucus observations across the pre-ovulatory phase of a single cycle

**Evidence:** The Mucus Cycle Score (MCS) is a CrMS-derived quantitative measure that summarizes the cervical mucus observations across the pre-ovulatory phase of a single cycle to estimate the quality of estrogen-driven follicular activity for that cycle.

**Canon:** rrm-cli, Hilgers Ch 14: 'These scores are then tallied for the six days of the mucus cycle beginning five days prior to the Peak Day and including the Peak Day's observations. The cervical mucus score is then obtained by totaling the daily points and dividing by six.' Confirmed independently in Stan

**Suggested fix:** The MCS is not computed across the whole pre-ovulatory phase; it averages the daily scores over the six days ending on Peak Day. Say 'summarizes the mucus observations over the days leading up to and including Peak Day' (no thresholds needed, so the no-protocol posture is preserved).

---

### `mucus-cycle-score` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#81**

**Current:** The MCS quantifies this pattern systematically, replacing subjective clinical impression with a reproducible numerical classification.[ref-81]

**Evidence:** The MCS quantifies this pattern systematically, replacing subjective clinical impression with a reproducible numerical classification.

**Canon:** rrm-cli holds two on-point sources: Hilgers Ch 14 'Objective Classification of the Mucus Cycle' (3C'S mucus cycle scoring system, 197 cycles from 122 patients, five classifications) and Ch 48 'Fecundity and Mucus Cycle Score'

**Suggested fix:** Ref 81 is the Linacre 2020 Peak Day +3 progesterone paper, which is not the MCS source. Recite to Hilgers Ch 14 (the paper that introduces the scoring system and validates it blind against chart reading) and/or Ch 48 (which links MCS to cycle fecundity). Both are already in the RRM library.

---

### `nfp` — statistic_precision  ·  Part II

**Field:** `body_html`  ·  **ref#85**

**Current:** Across well-studied NFP methods, perfect-use pregnancy rates range from approximately 0.4 to 5 per 100 woman-years

**Evidence:** Across well-studied NFP methods, perfect-use pregnancy rates range from approximately 0.4 to 5 per 100 woman-years, with typical-use rates varying more widely by method and user population.

**Canon:** rrm-cli full text of ref 85 (Peragallo Urrutia 2018, Obstet Gynecol): 'First-year perfect use pregnancy rates or probabilities among moderate-quality studies were 4.8 for the Standard Days Method, 3.5 for the TwoDay Method, 1.1-3.4 for the Billings Ovulation Method, 2.7 for the Marquette Mucus Metho

**Suggested fix:** The 0.4-5 range is a fair summary only if Persona (12.1, a device rather than a taught NFP method) is excluded and the Marquette Monitor's 0 is rounded up. State the scope explicitly, e.g. 'perfect-use rates from 0 to about 5 per 100 woman-years across the taught NFP methods (0.4 for Sensiplan, 0 for the Marquette Monitor, 1.1-3.4 for Billings), with the Persona device an outlier at 12.1.' No factual error, but the current range is silently scoped.

---

### `peak-day` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#385**

**Current:** Both "peak fertility" and "Peak Day" point to the same last day of fertile-type mucus.[ref-385]

**Evidence:** Both "peak fertility" and "Peak Day" point to the same last day of fertile-type mucus.

**Suggested fix:** Ref 385 (Porucznik 2014, pilot validation of the peak day method against a handheld urine hormone monitor) is a validation study, not a source on lay vocabulary. Either drop the citation from this terminology sentence or move it to the accuracy sentence it actually supports. Also consider adding the modern blinded figure from ref 297 (woman-picked Peak Day within +/-2 days of the LH-surge referent in 84% of cycles among women with no prior charting experience) alongside the 95% figure from trained users, since the term already cites ref 297.

---

### `point-of-change` — missing_cross_reference  ·  Part II

**Field:** `body_html`

**Current:** In the Billings Ovulation Method, the POC functions as the equivalent of the first day of fertile-type mucus in a standard cycle.

**Evidence:** In the Billings Ovulation Method, the POC functions as the equivalent of the first day of fertile-type mucus in a standard cycle.

**Canon:** rrm-cli, Hilgers Ch 8 'Charting Continuous Discharges': 'Look for the presence of a change from that pattern (identifying a point of change, POC) ... What POC indicates: The ovary is now actively moving toward ovulation'. Also Ch 25: 'When the mucus pattern changes from this ESP, a point of change (

**Suggested fix:** The term reads as though POC is Billings-only. CrMS uses POC formally too, paired with the Essential Sameness Pattern, and Hilgers documents estradiol confirmation of the POC. Add one sentence and a cross-link to essential-sameness-pattern-yellow-stamps; this strengthens the entry with RRM's own hormonal validation data.

---

### `vaginal-discharge-recording-system` — citation_quality  ·  Part II

**Field:** `body_html`  ·  **ref#64**

**Current:** Each observation combines a mucus type descriptor, stretch measurement, color category, and sensation qualifier into a coded record.[ref-64]

**Evidence:** Each observation combines a mucus type descriptor, stretch measurement, color category, and sensation qualifier into a coded record.

**Canon:** rrm-cli library holds Hilgers Ch 7 'Basic Charting and Chart Reading' and Ch 5 'Standardization of Teaching'; ref 64 is Ch 84 'Role of FertilityCare Practitioner'

**Suggested fix:** Ref 64 (Hilgers Ch 84, 'Role of FertilityCare Practitioner') is about the practitioner's role, not about the structure of the VDRS record. Recite the coding-structure sentence to Hilgers Ch 7 'Basic Charting and Chart Reading' (already in the RRM library) and keep ref 64 for the practitioner-review sentence in paragraph two.

---

### `chartneo` — unsupported_attribution  ·  Part III

**Field:** `body_html`  ·  **ref#146**

**Current:** ChartNeo is a digital cycle-charting platform developed by Dr. Phil Boyle as part of the NeoFertility restorative reproductive medicine framework.

**Evidence:** NeoFertility.

**Suggested fix:** The only citation in this term is ref 146, the neofertility.ie site, attached to the opening sentence; paragraphs two through four carry no citation at all, including the specific claims that ChartNeo 'integrates with clinician-facing dashboards' and 'was designed from the outset as a clinical workflow tool, not a standalone consumer app'. I could not independently confirm the 'developed by Dr. Phil Boyle' attribution from any source available to me, and did not try to confirm it via Perplexity because product-authorship claims are exactly where secondary sources fabricate. Either cite a ChartNeo or NeoFertility page that states the authorship and product claims, or attribute more loosely ('

---

### `compounding-pharmacist-triad` — name_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#78**

**Current:** The compounding pharmacist collaboration in NaProTechnology is a structured clinical relationship connecting three roles

**Evidence:** The compounding pharmacist collaboration in NaProTechnology is a structured clinical relationship connecting three roles: the NaProTechnology-trained physician, the FertilityCare practitioner, and a licensed compounding pharmacist

**Suggested fix:** The term is titled 'Compounding Pharmacist Triad' but the phrase 'triad' never appears in the body, and the opening definition names a different construct ('the compounding pharmacist collaboration'). Glossary convention across the rest of Part III is that the opening sentence restates the term name. Either open with 'The compounding pharmacist triad is...' or rename the term to match the body. Also note the whole term rests on a single citation (ref 78); the claim that the pharmacist relationship is 'an integral component of the medical care model' rather than ancillary would benefit from a page-level anchor.

---

### `dhea-supplementation` — overclaim  ·  Part III

**Field:** `body_html`  ·  **ref#147**

**Current:** Several meta-analyses have examined DHEA supplementation in women with poor ovarian response or diminished ovarian reserve (DOR), reporting modest improvements in ovarian response markers such as antral follicle count and oocyte yield.

**Evidence:** Efficacy of dehydroepiandrosterone priming in women with poor ovarian response undergoing IVF/ICSI: a meta-analysis.

**Suggested fix:** 'Several meta-analyses' is footnoted to one meta-analysis (ref 147). Either add the additional meta-analyses, or change to 'A meta-analysis of DHEA priming in women with poor ovarian response reported...'. Minor, but it is the kind of plural-source claim backed by a single citation that an external reviewer will pull on.

---

### `femm-levels` — clarity  ·  Part III

**Field:** `body_html`

**Current:** It gives users the tools to recognize cycle patterns, identify potential hormonal irregularities, and communicate meaningfully with a clinician, and bring a partner into the picture when fertility is the shared goal.

**Evidence:** and communicate meaningfully with a clinician, and bring a partner into the picture when fertility is the shared goal

**Suggested fix:** Broken list parallelism: the series closes with 'and' twice, so the final item reads as an afterthought grafted onto the clause. Rewrite as: 'It gives users the tools to recognize cycle patterns, identify potential hormonal irregularities, communicate meaningfully with a clinician, and bring a partner into the picture when fertility is the shared goal.'

---

### `fertilitas-study` — factual_error  ·  Part III

**Field:** `body_html`  ·  **ref#93**

**Current:** an adjusted cumulative take-home baby rate of 62.1% over a median treatment duration of approximately 11 months

**Evidence:** When restricting the analysis to a minimum follow-up of 3 years (2018-2021), which more accurately reflects the full course of the NPT, the distribution over time was 57.8% (n = 115) in the first year, 32.7% (n = 65) in the second year, and a residual 8.1% (n = 16) in the third year. The adjusted cumulative THB rate was 62.1% (CI: 95%: 58.8-65.4) (Figure 2A).

**Suggested fix:** Two real but separate figures have been welded into one misleading claim. The paper reports the 62.1% adjusted cumulative THB rate under the minimum-3-year-follow-up analysis, and separately reports 'The median duration of the NPT process was 10.9 months (range, 8.1-17.0).' As written, a reader concludes 62.1% is reached in about 11 months. This also contradicts two sibling glossary terms and the RRM SSOT verified fact sanchez-mendez-2025-lbr ('50% at 24 months, 62.1% at 36+ months'). Rewrite as: 'an adjusted cumulative take-home baby rate of 50% at 24 months rising to 62.1% at 36 or more months; the median duration of the NaProTechnology process was 10.9 months.'

**Adversarial verdict:** DOWNGRADE — current_value appears verbatim in body_html, and the reviewer's evidence_quote is verbatim in the paper. But the P1 factual_error framing is refuted. The reviewer's central assertion is that 'two real but separate figures have been welded into one misleading claim'. The weld is the authors'. The paper's own abstract, verified by exact string match against the full text and independently confirmed 

**Corrected fix:** Do not apply the proposed rewrite; it would introduce an unsourced number. Leave the fertilitas-study sentence as the source-faithful anchor. If tightened at all, mirror the authors and add the interval: 'an adjusted cumulative take-home baby rate of 62.1% (95% CI 58.8 to 65.4), calculated over a median NaProTechnology duration of 10.9 months.' The real work is elsewhere and should be filed as its

---

### `fertilitas-study` — duplicate_reference  ·  Part III

**Field:** `body_html`  ·  **ref#14**

**Current:** [ref 14] and [ref 93] cited side by side in the opening paragraph

**Evidence:** NaProTechnology for infertility: take-home baby rate and clinical outcomes in a 5-year single-center cohort.

**Suggested fix:** Refs 14 and 93 are the same paper under two reference numbers (ref 14 = PubMed record 41323405; ref 93 = PMC12660242, same title, same journal). Citing both in one sentence reads as two independent sources corroborating each other. Merge to a single reference number across the whole glossary.

---

### `hcg-trigger` — weak_source  ·  Part III

**Field:** `body_html`  ·  **ref#95**

**Current:** In assisted reproductive technology, including IVF and IUI, it serves to synchronize oocyte maturation with the procedure schedule, functioning as a component of the stimulation protocol rather than a therapeutic intervention in its own right. [ref 95]

**Evidence:** Prevention of moderate and severe ovarian hyperstimulation syndrome: a guideline

**Suggested fix:** Ref 95 is an OHSS prevention guideline. It touches trigger selection but is not a source for the general role of hCG triggering across IVF and IUI, and it says nothing about IUI. Use an ART stimulation or IUI guideline for this sentence and keep ref 95 for any OHSS-specific statement.

---

### `heteromolecular-artimones` — precision  ·  Part III

**Field:** `body_html`  ·  **ref#82**

**Current:** Synthetic progestins bind progesterone receptors, but they also interact with androgen and glucocorticoid receptors in ways that endogenous progesterone does not.

**Evidence:** Synthetic progestins bind progesterone receptors, but they also interact with androgen and glucocorticoid receptors in ways that endogenous progesterone does not.

**Suggested fix:** Endogenous progesterone is not receptor-silent outside the progesterone receptor; it is a potent mineralocorticoid receptor antagonist and has measurable glucocorticoid receptor affinity. The 'in ways that' qualifier partly saves the sentence, but a reader takes away that progesterone binds only its own receptor. Tighten to: 'Synthetic progestins show androgenic and glucocorticoid receptor activity that differs in kind and degree from endogenous progesterone's own off-target profile, which is principally antimineralocorticoid.' This strengthens rather than weakens the isomolecular-versus-heteromolecular argument.

---

### `live-birth` — missing_citation  ·  Part III

**Field:** `body_html`  ·  **ref#126**

**Current:** entire term cites only [ref 126]

**Evidence:** Tham E, Schliep K, Stanford J. Natural procreative technology for infertility and recurrent miscarriage: outcomes in a Canadian family practice.

**Suggested fix:** Only the final sentence carries a citation. The definitional paragraph, the five-authority harmonization claim, the live-birth-is-not-healthy-birth argument, and the 'commonly 24 months' RRM convention are all uncited. At minimum cite the WHO/ICD source for the definition and one RRM outcomes paper for the 24-month convention (the Sanchez-Mendez and Tham cohorts both use it).

---

### `marquette-protocol` — reference_metadata  ·  Part III

**Field:** `body_html`  ·  **ref#5**

**Current:** [ref 5] cited for the monitor's suitability in women with limited mucus production and for cross-method integration

**Evidence:** Use of fertility awareness-based methods of contraception.

**Suggested fix:** Ref 5's journal field in the shared reference table is recorded as 'ScienceDirect', which is a publishing platform, not a journal. Correct the journal metadata so the citation renders as a real bibliographic record. Also note ref 5 is a contraception-effectiveness source being used to support a claim about clinical suitability for atypical-mucus patients; ref 231 (Mu, Fehring, Bouchard 2022 multisite effectiveness study) is the stronger anchor and is already cited in the term.

---

### `napro-medical` — weak_source  ·  Part III

**Field:** `body_html`  ·  **ref#13**

**Current:** Treatment categories addressed through NaPro Medical include luteal phase deficiency, low progesterone support, thyroid dysfunction, hyperprolactinemia, insulin resistance, ovulation disorders, and cycle-related immune conditions.

**Evidence:** 4 key findings on infertility from the largest NaPro study to date.

**Suggested fix:** That clinical treatment-category list is footnoted to ref 13, a Natural Womanhood lay advocacy article about the Sanchez-Mendez cohort study, which is not a source for NaPro treatment categories. Ref 78 (Hilgers, The Medical and Surgical Practice of NaProTECHNOLOGY, 2004) is already cited two sentences earlier and is the correct authority. Drop ref 13 here or move it to a sentence about the Fertilitas cohort.

---

### `neofertility` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#132**

**Current:** NeoFertility structures its work in three sequential phases. Phase 1 is diagnostic... Phase 2 is treatment and cycle optimization... Phase 3 focuses on conception timing, confirmed ovulation, and follow-through support from the peri-conception period. [ref 132]

**Evidence:** Restorative reproductive medicine (RRM) outcomes compared to in-vitro fertilization (IVF) for the treatment of infertility: a retrospective evaluation of a 2019 clinic cohort.

**Suggested fix:** Ref 132 is Boyle et al. 2025, a retrospective outcomes comparison against IVF registry data; it does not set out NeoFertility's three-phase clinic structure. Cite ref 146 (neofertility.ie) for the phase model and keep ref 132 for the outcomes sentence in the final paragraph, where it is correctly applied.

---

### `peak-7-progesterone` — missing_citation  ·  Part III

**Field:** `body_html`

**Current:** Values are interpreted against Hilgers-established normative ranges to assess the adequacy of corpus luteum function.

**Evidence:** Values are interpreted against Hilgers-established normative ranges to assess the adequacy of corpus luteum function.

**Suggested fix:** This term carries zero references. It names Hilgers-established normative ranges, asserts that P+7 is expected to be the highest of the serial luteal draws, and makes a comparative claim about random draws, all uncited. Cite ref 78 (Hilgers 2004 textbook) for the normative ranges and ref 81 (Hilgers, early luteal Peak Day +3 progesterone) for the serial-draw rationale; both are already in the shared reference set.

---

### `peak-7-progesterone` — link_target_mismatch  ·  Part III

**Field:** `body_html`

**Current:** the Creighton Model FertilityCare System (CrMS) [Peak Day linked to #peak-symptom]

**Evidence:** The peak symptom is the last day in a menstrual cycle on which cervical mucus is observed as clear, stretchy, or lubricative, regardless of the total amount of discharge present.

**Suggested fix:** The anchor text 'Peak Day' links to #peak-symptom, but the glossary carries a distinct #peak-day term ('Peak Day is the last day in a menstrual cycle on which cervical mucus is clear, stretchy... and serves as the primary ovulation reference point'). Every other Part III term links the phrase Peak Day to #peak-day. Repoint this one to #peak-day for consistency; both slugs exist, so the link is not broken, just aimed at the sibling concept.

---

### `reproductive-health-research-institute` — citation_mismatch  ·  Part III

**Field:** `body_html`  ·  **ref#6**

**Current:** By publishing in peer-reviewed journals, RHRI contributes to a growing body of evidence that fertility-awareness methods have diagnostic as well as family-planning applications.

**Evidence:** Fertility Awareness-Based Methods for Family Planning: A Systematic Review.

**Suggested fix:** Ref 6 is a general Cureus systematic review of FABMs for family planning, not an RHRI publication, so it cannot evidence a claim about what RHRI publishes. Replace with one or two actual RHRI-authored papers, or drop the citation and let ref 145 (rhri.org) carry the institutional description.

---

### `amh` — precision  ·  Part IV

**Field:** `body_html`  ·  **ref#268**

**Current:** restorative care was associated with a 32.1 percent live birth rate.[ref-268]

**Evidence:** In a 2018 observational cohort of 403 women who had averaged 2.1 prior IVF attempts, restorative care was associated with a 32.1 percent live birth rate.

**Suggested fix:** All three figures verify against Boyle 2018. For precision, label 32.1% as the life-table (cumulative) live birth rate, which is how the paper reports it. Say 'a 32.1 percent cumulative (life-table) live birth rate'. No caveat or hedge on the RRM result is needed or wanted; this is a labelling refinement only.

---

### `amh` — precision  ·  Part IV

**Field:** `body_html`  ·  **ref#265**

**Current:** AMH (Anti-Mullerian Hormone) is a glycoprotein produced by granulosa cells of small antral ovarian follicles.

**Evidence:** AMH (Anti-Mullerian Hormone) is a glycoprotein produced by granulosa cells of small antral ovarian follicles.

**Suggested fix:** ref-265 (Dewailly 2014, Human Reproduction Update) describes AMH as produced by granulosa cells of preantral AND small antral follicles. Add 'preantral and' so the definition matches the cited physiology review.

---

### `amh` — terminology  ·  Part IV

**Field:** `body_html`

**Current:** AMH also has a ceiling problem. In PCOS, many small follicles accumulate without maturing, which drives AMH markedly higher.[ref-266]

**Evidence:** In PCOS, many small follicles accumulate without maturing, which drives AMH markedly higher.

**Canon:** RRM dual-label convention PCOS/PMOS, three-year transition

**Suggested fix:** This term discusses PCOS pathophysiology substantively and would benefit from the RRM dual label during the three-year transition: 'In PCOS/PMOS, many small follicles accumulate without maturing'. Keep the existing slug and any URLs unchanged.

---

### `era` — precision  ·  Part IV

**Field:** `body_html`

**Current:** The test analyzes the expression profile of several hundred genes.

**Evidence:** The test analyzes the expression profile of several hundred genes.

**Suggested fix:** Replace with the specific figure: the classic ERA microarray panel is 238 genes, and the current NGS implementation is described as 248. Use '238 genes (248 in the current sequencing version)'. Verify the 248 figure against the manufacturer documentation before publishing it, since it comes from a vendor manual rather than a peer-reviewed source.

---

### `follicle-maturation-study` — precision  ·  Part IV

**Field:** `body_html`

**Current:** a series of transvaginal ultrasounds performed across the follicular phase of the menstrual cycle to track follicular growth, the ovulation event, and post-rupture changes in real time

**Evidence:** is a series of transvaginal ultrasounds performed across the follicular phase of the menstrual cycle to track follicular growth, the ovulation event, and post-rupture changes in real time

**Canon:** Hilgers TW, NaProTECHNOLOGY Ch. 20 (rrm-cli chapter-20): 'Daily observation continued until at least 24 hours past follicular rupture' and 'the patient was usually seen during the mid-luteal phase'

**Suggested fix:** The same sentence claims post-rupture and corpus luteum imaging, which is not the follicular phase. Hilgers Ch. 20 continues scanning 'until at least 24 hours past follicular rupture' plus a mid-luteal scan. Use 'across the periovulatory window and into the early luteal phase', matching the wording already used in the follicle-development term.

---

### `hsg` — citation_weak_support  ·  Part IV

**Field:** `body_html`  ·  **ref#335**

**Current:** HSG reveals uterine septal defects.[ref-335]

**Evidence:** HSG reveals uterine septal defects.

**Suggested fix:** ref-335 is the ESHRE/ESGE consensus on the CLASSIFICATION of female genital tract congenital anomalies. It defines anomaly categories rather than establishing HSG's detection performance for septa. Move this claim onto ref-337 (Jayaprakasan and Ojha, Diagnosis of Congenital Uterine Abnormalities), which is already cited two sentences later and directly addresses diagnostic modality performance.

---

### `laparoscopy-diagnostic` — style_em_dash  ·  Part IV

**Field:** `body_html`

**Current:** concurrent histopathologic biopsy at the same procedure -- rather than a separate surgery -- supports accurate diagnosis

**Evidence:** At laparoscopy for suspected endometriosis, concurrent histopathologic biopsy at the same procedure -- rather than a separate surgery -- supports accurate diagnosis, allowing visualization and tissue confirmation to occur in a single operative session.

**Canon:** rrm-cli check rule no-em-dashes (medium), line 26, two hits

**Suggested fix:** Two ' -- ' em-dash substitutes. Rewrite as: 'At laparoscopy for suspected endometriosis, taking the histopathologic biopsy during the same procedure rather than at a separate surgery supports accurate diagnosis, allowing visualization and tissue confirmation to occur in one operative session.'

---

### `laparoscopy-operative` — citation_quality  ·  Part IV

**Field:** `body_html`

**Current:** Ablation techniques destroy only the surface layer of visible lesions; they do not address deeper implants and are associated with higher recurrence rates.[ref-27][ref-28][ref-29]

**Evidence:** Ablation techniques destroy only the surface layer of visible lesions; they do not address deeper implants and are associated with higher recurrence rates.

**Canon:** RRM canon: excision is the standard; ablation is never equivalent

**Suggested fix:** The RRM position is correct and must not be softened. But two of the three citations carrying it are non-peer-reviewed advocacy pages: ref-27 (EndoNews) and ref-29 (PC3 Connect). Only ref-28 (PubMed 28456617, Laparoscopic Excision Versus Ablation for Endometriosis) is peer-reviewed. This is the single most load-bearing canon claim in the term and it should rest entirely on peer-reviewed sources. Drop refs 27 and 29 and add peer-reviewed excision-versus-ablation evidence after registry-verifying the identifiers.

---

### `laparoscopy-operative` — citation_hygiene  ·  Part IV

**Field:** `body_html`  ·  **ref#38**

**Current:** [ref-38] https://pubmed.ncbi.nlm.nih.gov/?term=39588841

**Evidence:** For ovarian endometrioma, excision of the cyst wall is likewise preferred over drainage or ablation, as evidence supports lower recurrence rates, though cystectomy carries a recognized risk of inadvertent removal of normal ovarian cortex and associated AMH reduction.

**Suggested fix:** ref-38's URL is a PubMed SEARCH query string (?term=39588841) rather than a record URL. Replace with the canonical record URL form so the citation resolves to a fixed record. Also note rrm-cli check flags 'evidence supports' here as vague attribution; naming the source inline (author, year) resolves it.

---

### `near-contact-laparoscopy` — precision  ·  Part IV

**Field:** `body_html`

**Current:** Standard laparoscopy, performed at working distances of 10 cm or more, can fail to resolve the fine detail needed to characterize peritoneal abnormality accurately.

**Evidence:** Standard laparoscopy, performed at working distances of 10 cm or more, can fail to resolve the fine detail needed to characterize peritoneal abnormality accurately.

**Canon:** rrm-cli chapter-63-diagnostic-laparoscopy-near-contact-approach excerpt: 'near-contact technique (2-3 cm from tissue rather than 15-20 cm), 89.1% were found to have endometriosis that had been missed with standard laparoscopy'

**Suggested fix:** This figure is uncited and vaguer than the RRM primary source. Hilgers Ch. 63 gives the paired distances directly: near-contact at 2-3 cm from tissue versus 15-20 cm at standard distance. Use those two numbers and cite Ch. 63. The term currently never states the near-contact distance at all, which is the defining parameter of the technique. Ch. 63 also supplies the strongest supporting datum (46 repeat laparoscopies previously reported normal, 89.1% found to have missed endometriosis).

---

### `ovarian-reserve` — overstated_claim  ·  Part IV

**Field:** `body_html`

**Current:** Vitamin D deficiency suppresses AMH and is correctable with repletion.

**Evidence:** Vitamin D deficiency suppresses AMH and is correctable with repletion.

**Suggested fix:** Stated as settled fact, uncited, and the literature does not carry it: the direction of the vitamin D and AMH relationship differs by population and supplementation has been reported to LOWER AMH in PCOS. Rewrite as: 'Vitamin D status has been studied in relation to AMH, with mixed findings, and repletion is a reasonable part of a workup on its own merits.' Cite ref-410 (Moridi 2020) if a citation is wanted.

**Adversarial verdict:** DOWNGRADE — Quote verified verbatim in terms-part-IV.json. The headline claim of this finding is REFUTED and the proposed fix would introduce a new error, so P1 unverified_statistic cannot stand. On the study count: I opened the ref-77 full text (Yin WW, Huang CC, Chen YR, Yu DQ, Jin M, Feng C, BMC Endocr Disord 2022;22:158, PMID 35698127, DOI 10.1186/s12902-022-01065-9, confirmed to resolve) rather than rely

**Corrected fix:** Keep the count of 8; it is verified against the primary source and must not be changed or dropped. Do NOT add any randomized-trial hedge, because ref-77 contains no randomized studies. Fix only the population qualifier, and hedge on study design instead. Rewrite as: 'Where DHEA-S is documented low, RRM clinicians may consider supplementation. A meta-analysis of 8 before-and-after studies found DHE

---

### `ovulation-confirmation` — style_terminology  ·  Part IV

**Field:** `body_html`

**Current:** it is a frequent root cause of cases labeled "unexplained" infertility

**Evidence:** The distinction matters more than most clinicians appreciate, and it is a frequent root cause of cases labeled "unexplained" infertility.

**Canon:** rrm-cli check rule use-underlying-condition (medium), line 80: "Use 'underlying condition' not 'root cause' in NaPro content"

**Suggested fix:** The RRM editorial guardrail use-underlying-condition flags 'root cause' in NaPro-specific content in favour of 'underlying condition'. Rewrite as: 'and it is a frequent underlying condition behind cases labeled unexplained infertility.' Optionally apply the standard reframe of 'unexplained' as 'not yet diagnosed', which the RRM framework guardrails prefer.

---

### `semen-analysis` — uncited_statistic  ·  Part IV

**Field:** `body_html`

**Current:** reflecting that male factor is the sole cause in approximately 20% of couples and a contributing cause in an additional 30 to 40%.

**Evidence:** It is among the first investigations ordered when a couple presents with difficulty conceiving, reflecting that male factor is the sole cause in approximately 20% of couples and a contributing cause in an additional 30 to 40%.

**Suggested fix:** The figures are accurate and match standard clinical references almost verbatim, but they carry no citation, which is the only uncited hard statistic in the term. Add a source. Note also that current reviews phrase male-factor sole cause as 20-30% and total involvement as roughly half, so the existing numbers sit at the conservative end and are safe to publish.

---

### `sis` — outdated_source  ·  Part IV

**Field:** `body_html`  ·  **ref#160**

**Current:** [ref-160] ACOG technology assessment in obstetrics and gynecology. Number 3, September 2003. Saline infusion sonohysterography.

**Evidence:** SIS detects endometrial polyps, submucosal fibroids, intrauterine adhesions, uterine septa, and can reveal an isthmocele (cesarean scar defect), including measurable defect dimensions and residual myometrial thickness.

**Suggested fix:** ref-160 is a 2003 ACOG technology assessment, now more than twenty years old and superseded by the AIUM/ACR/ACOG/SRU practice parameter for the performance of sonohysterography. Replace or supplement with the current practice parameter. Do not restate a specific replacement citation until its identifier is registry-verified.

---

### `sis` — metadata_consistency  ·  Part IV

**Field:** `abbreviation`

**Current:** None

**Evidence:** A Saline Infusion Sonohysterogram (SIS) is a transvaginal ultrasound procedure

**Canon:** abbreviations.json: {'abbreviation': 'SIS', 'full_term': 'Saline Infusion Sonohysterogram', 'term_slug': 'sis'}

**Suggested fix:** The term introduces SIS and abbreviations.json carries a matching row (SIS -> Saline Infusion Sonohysterogram, term_slug=sis), but the term's own abbreviation column is null. Same pattern affects s-map, emma-alice and pgt-a, all of which have abbreviation rows but null abbreviation fields. Backfill the column so the two stores agree.

---

### `sperm-dna-fragmentation` — abbreviation_mismatch  ·  Part IV

**Field:** `abbreviation`

**Current:** DFI

**Evidence:** Sperm DNA Fragmentation Index (DFI) is a measure of the proportion of sperm with damaged or broken DNA strands.

**Canon:** abbreviations.json: {'abbreviation': 'SDF / DFI', 'full_term': 'Sperm DNA Fragmentation / DNA Fragmentation Index', 'term_slug': 'sperm-dna-fragmentation'}

**Suggested fix:** The term's abbreviation field and body both use 'DFI', but the glossary_abbreviation row is stored as the compound 'SDF / DFI' -> 'Sperm DNA Fragmentation / DNA Fragmentation Index'. Split into two rows (SDF and DFI) so an exact lookup on 'DFI' resolves, or align the term field to the compound form.

---

### `sperm-dna-fragmentation` — precision  ·  Part IV

**Field:** `body_html`

**Current:** The male factor contributes to fertility outcomes in the majority of couples

**Evidence:** The male factor contributes to fertility outcomes in the majority of couples, and DNA integrity is one dimension of male fertility that standard analysis leaves unevaluated.

**Suggested fix:** 'Majority' (over half) sits just past what the sourced ranges carry, and it also drifts from the sibling semen-analysis term, which states 20% sole plus 30-40% contributing. Change to 'in about half of couples' or 'in up to half or more of couples' so the two terms agree and the claim stays inside the evidence.

---

### `transcervical-catheterization` — style_em_dash  ·  Part IV

**Field:** `body_html`

**Current:** TCFT is performed with intratubal pressure monitoring throughout the procedure -- a refinement added to standard fluoroscopic tubal cannulation.

**Evidence:** In NaProTechnology practice, TCFT is performed with intratubal pressure monitoring throughout the procedure -- a refinement added to standard fluoroscopic tubal cannulation.

**Canon:** rrm-cli check rule no-em-dashes (medium), line 74

**Suggested fix:** Em-dash substitute ' -- '. Rewrite as: 'In NaProTechnology practice, TCFT is performed with intratubal pressure monitoring throughout the procedure, a refinement added to standard fluoroscopic tubal cannulation.'

---

### `anti-adhesion-barriers` — clarity_omission  ·  Part V

**Field:** `body_html`  ·  **ref#80**

**Current:** Expanded polytetrafluoroethylene (ePTFE) membrane has been used in reconstructive pelvic surgery with published data showing reductions in adhesion reformation scores over serial evaluation.

**Evidence:** Oxidized regenerated cellulose (Interceed) and sodium hyaluronate-carboxymethylcellulose membrane (Seprafilm) are bioresorbable barriers approved for use in abdominal and pelvic surgery. Hyaluronic-acid-based gels provide a similar function in a more conformable form. Expanded polytetrafluoroethylene (ePTFE) membrane has been used in reconstructive pelvic surgery with published data showing reductions in adhesion reformation scores over serial evaluation.

**Suggested fix:** The opening defines barriers as materials that 'physically separate tissue surfaces during the early healing period', which implies all of them are temporary. Interceed and Seprafilm are explicitly labelled bioresorbable; ePTFE is not resorbable and is a permanent implant unless removed at a subsequent procedure. Add one clause: 'ePTFE is non-absorbable and remains in place unless removed at a later procedure, which is a consideration distinct from the resorbable barriers above.' A patient reading this entry currently cannot tell the two classes apart.

---

### `electrosurgery` — uncited  ·  Part V

**Field:** `body_html`

**Current:** (entire entry, zero <a href="#ref-N"> citations)

**Evidence:** Deterministic scan: 'ref-' does not appear anywhere in this term's body_html. Terms with zero refs in Part V: laparoscopic-ovarian-wedge-resection, mini-laparotomy, electrosurgery, hysteroscopic-septoplasty.

**Suggested fix:** The entry makes device-safety claims (thermal spread, bipolar preferred near the ureter, bowel and fallopian tubes) and a clinical-practice claim (indiscriminate coagulation of lesions is discouraged) with no source. The excision-over-ablation half is already supported by refs 28 and 38 elsewhere in this glossary; attach at least ref 28 to the last sentence, and add an electrosurgery-safety source for the thermal-spread claim.

---

### `electrosurgery` — structure_inconsistency  ·  Part V

**Field:** `body_html`

**Current:** <p><strong>Electrosurgery (Reproductive Surgery)</strong> uses electrical energy to cut, coagulate, or vaporize tissue during operative procedures.

**Evidence:** <p><strong>Electrosurgery (Reproductive Surgery)</strong> uses electrical energy to cut, coagulate, or vaporize tissue during operative procedures.

**Suggested fix:** Sixteen of the eighteen Part V entries open with a full bolded definition sentence (for example 'Myomectomy is the surgical removal of uterine fibroids (leiomyomas) while preserving the uterus.'). This entry and hysteroscopic-septoplasty bold only the term name, which breaks the definition-snippet pattern that AI answer engines and featured snippets key on. Rewrite as a bolded standalone definition: '<strong>Electrosurgery in reproductive surgery uses high-frequency electrical current to cut, coagulate, or vaporize tissue during an operation.</strong>'

---

### `excision-surgery` — source_quality  ·  Part V

**Field:** `reference[27].url`  ·  **ref#27**

**Current:** https://www.endonews.com/laparoscopic-excision-vs.-ablation-in-endometriosis-a-comparison-of-symptom-and-quality-of-life-outcomes

**Evidence:** anchor_text: 'Laparoscopic Excision vs. Ablation in Endometriosis: A Comparison of Symptom and Quality of Life Outcomes.' publisher: EndoNews

**Suggested fix:** Every hard number in this paragraph is attributed to a lay news aggregator. Repoint ref 27 to the primary study, verified via NCBI esummary as PMID 39490891, Isaac A, Kapetanakis T, Thibeault E, Chatburn L, Mackenzie M, J Minim Invasive Gynecol 2025 Mar. Do NOT use the author list Perplexity returned for this PMID (it returned 'Soliman AM, Stafford RS, Araya AV' which is fabricated and contradicted by NCBI).

---

### `fallopian-tube-recanalization` — missing_etiology  ·  Part V

**Field:** `body_html`  ·  **ref#84**

**Current:** Proximal tubal occlusion, located near the uterotubal junction, is distinct from distal disease and is frequently caused by mucus plugging, amorphous debris, or inflammatory fibrosis.

**Evidence:** Proximal tubal occlusion, located near the uterotubal junction, is distinct from distal disease and is frequently caused by mucus plugging, amorphous debris, or inflammatory fibrosis.

**Suggested fix:** Salpingitis isthmica nodosa (SIN) is a principal cause of true proximal occlusion and is the one that predicts recanalization failure, yet it is absent from the causal list. The RRM corpus already documents it: rrm-cli returns Hilgers Chapter 66 with 'Completely obstructed tubes (average ITP 2.79 atmospheres) showed specific pathology including salpingitis isthmica n[odosa]', and the library holds Thurmond AS, Burry KA, Novy MJ, 'Salpingitis isthmica nodosa: results of transcervical fluoroscopic catheter recanalization', Fertil Steril 1995. Add SIN to the list and cross-link it.

---

### `fulguration-ablation` — source_quality  ·  Part V

**Field:** `body_html`  ·  **ref#29**

**Current:** Fulguration and ablation remain common in general gynecologic settings, but the evidence supports excision as the surgical standard for endometriosis when symptom resolution and fertility preservation are the goals.<sup class="cite-ref"><a href="#ref-29">29</a></sup>

**Evidence:** reference 29 anchor_text: 'Excision vs Ablation: Understanding the Key Differences for Treating Endometriosis.' url: https://www.pc3connect.org/excision-vs-ablation-understanding-the-key-differences-for-treating-washington-endometriosis/ publisher: PC3 Connect

**Suggested fix:** The strongest sentence in the entry ('the evidence supports excision as the surgical standard') is carried by an advocacy-organisation web page. Two verified high-tier sources are already in this glossary's own reference list and say exactly this: ref 28 (Pundir 2017 RCT meta-analysis, PMID 28456617) and ref 38 (Cochrane 2024, PMID 39588841). Cite those instead of, or in addition to, ref 29.

---

### `hysteroscopic-septoplasty` — structure_inconsistency  ·  Part V

**Field:** `body_html`

**Current:** <p><strong>Hysteroscopic Septoplasty</strong> is the operative hysteroscopic procedure used to incise or resect a uterine septum, converting a septate uterine cavity into a single normal cavity.

**Evidence:** <p><strong>Hysteroscopic Septoplasty</strong> is the operative hysteroscopic procedure used to incise or resect a uterine septum, converting a septate uterine cavity into a single normal cavity.

**Suggested fix:** Same pattern break as the electrosurgery entry: only the term name is bolded, so the page has no bolded standalone definition sentence for snippet extraction. Extend the bold to cover the full definition clause.

---

### `isthmocele-repair-hysteroscopic` — internal_consistency  ·  Part V

**Field:** `body_html`

**Current:** A residual myometrial thickness of at least 2.5 to 3 mm at the defect is generally required before hysteroscopic resection

**Evidence:** A residual myometrial thickness of at least 2.5 to 3 mm at the defect is generally required before hysteroscopic resection; thinner walls carry a risk of bladder injury or perforation during the procedure.

**Suggested fix:** Both this entry (2.5 to 3 mm) and the sibling laparoscopic entry (less than 3 mm is too thin) are individually defensible against the literature, but read together they leave a 2.5-3.0 mm band where the two pages give opposite advice. Harmonize on the consensus figure: hysteroscopy when RMT is 3 mm or greater, laparoscopy below 3 mm, with a note that some authors accept 2.5 mm in women not planning pregnancy. Cite the Global Congress on Hysteroscopy consensus alongside ref 128 (Tanimura), which is the source of the 2.5 mm figure.

---

### `isthmocele-repair-laparoscopic` — duplicate_citation  ·  Part V

**Field:** `body_html`  ·  **ref#16**

**Current:** ...below safe thresholds for hysteroscopic resection.<sup class="cite-ref"><a href="#ref-15">15</a></sup><sup class="cite-ref"><a href="#ref-16">16</a></sup>

**Evidence:** reference 15 anchor_text: 'Isthmocele: an overview of diagnosis and treatment.' url https://www.scielo.br/j/ramb/a/sybvcWWJG8F7tL7yB8RH3DQ/?lang=en ; reference 16 anchor_text: 'Isthmocele: an overview of diagnosis and treatment.' url https://pubmed.ncbi.nlm.nih.gov/31166450/

**Suggested fix:** Refs 15 and 16 are the same paper (NCBI esummary for PMID 31166450 returns 'Isthmocele: an overview of diagnosis and treatment.' Kremer TG, Ghiorzi IB, Dibi RP, Rev Assoc Med Bras 2019) reached by two different hosts, and this sentence cites both back to back, which reads as two independent sources supporting the claim. Merge them into one reference row (keep the PubMed URL, add the SciELO link as a secondary locator) and renumber, or drop ref 16 from this citation.

---

### `laparoscopic-ovarian-wedge-resection` — uncited  ·  Part V

**Field:** `body_html`

**Current:** (entire entry, 115 words, zero <a href="#ref-N"> citations)

**Evidence:** Deterministic scan: 'ref-' does not appear anywhere in this term's body_html. Terms with zero refs in Part V: laparoscopic-ovarian-wedge-resection, mini-laparotomy, electrosurgery, hysteroscopic-septoplasty.

**Suggested fix:** This is the only surgical-outcome term in the part with both a mechanism claim and an efficacy implication and no citation at all. The RRM SSOT has directly usable sources: rrm-cli returns Hilgers Chapter 75 'PEARS for Polycystic Ovaries: Ovarian Wedge Resection' (excerpt: 'The PEARS technique for polycystic ovarian disease achieved 91% ovulation resumption and 92% pregnancy rates ... with near-zero adhesion formation versus 20-70% with laparoscopic drilling techniques'), plus Yildirim M et al., Eur J Obstet Gynecol Reprod Biol 2003, and Hjortrup A et al., Acta Obstet Gynecol Scand 1983. Attach at least one. Do not import the 91%/92% figures as protocol-specific percentages without a decisio

---

### `laparoscopic-ovarian-wedge-resection` — pcos_pmos_label  ·  Part V

**Field:** `body_html`

**Current:** restore ovulation in select patients with <a href="#pcos" class="gloss-xref">PCOS</a>

**Evidence:** restore ovulation in select patients with PCOS

**Canon:** RRM-preferred dual label PCOS/PMOS during the 3-year transition

**Suggested fix:** This entry is entirely about PCOS and mentions it three times, so it is a natural place for the dual label. Consider 'PCOS/PMOS' on first mention. Not an error as written.

---

### `mini-laparotomy` — internal_consistency  ·  Part V

**Field:** `body_html`

**Current:** some surgeons prefer mini-laparotomy over laparoscopy because the magnification and hand control available at an open field supports the fine suture work that microsurgery demands

**Evidence:** In tubal reversal and other reconstructive procedures, some surgeons prefer mini-laparotomy over laparoscopy because the magnification and hand control available at an open field supports the fine suture work that <a href="#microsurgery" class="gloss-xref">microsurgery</a> demands.

**Suggested fix:** An open field does not itself supply magnification; the sibling microsurgery entry in this same part defines magnification as coming from 'loupes or an operating microscope'. As written the two pages disagree about where magnification comes from. Rewrite to: 'because an open field allows direct hand control and accommodates loupe or operating-microscope magnification for the fine suture work that microsurgery demands.'

---

### `mini-laparotomy` — uncited  ·  Part V

**Field:** `body_html`

**Current:** (entire entry, 189 words, zero <a href="#ref-N"> citations)

**Evidence:** Deterministic scan: 'ref-' does not appear anywhere in this term's body_html.

**Suggested fix:** The entry makes a specific quantitative claim ('a horizontal incision of 3 to 7 cm') and a comparative-morbidity claim ('substantially less morbidity than a full laparotomy') with no source. The RRM library holds a directly usable citation for the reproductive application: Yildirim M, Noyan V, Bulent Tiras M, Yildiz A, Guner H, 'Ovarian wedge resection by minilaparatomy in infertile patients with polycystic ovarian syndrome: a new technique', Eur J Obstet Gynecol Reprod Biol 2003 (returned by rrm-cli). Attach at least one reference, and either source the 3 to 7 cm range or soften it, since published minilaparotomy definitions more commonly cap at 5 to 6 cm.

---

### `near-adhesion-free-pelvic-surgery` — missing_data  ·  Part V

**Field:** `body_html`  ·  **ref#80**

**Current:** Postoperative adhesion scores declined progressively across the three phases, reflecting measurable improvement with each iteration of the technique. The data establish that a near-adhesion-free result is a documented clinical target, not a marketing claim.

**Evidence:** Postoperative adhesion scores declined progressively across the three phases, reflecting measurable improvement with each iteration of the technique. The data establish that a near-adhesion-free result is a documented clinical target, not a marketing claim.

**Suggested fix:** The paragraph asserts the result is documented but withholds the numbers that document it, then defends itself with 'not a marketing claim'. Give the reader the data instead: AFS total adhesion score fell 33.8 to 18.1 in Phase I, 33.3 to 6.0 in Phase II, and 33.2 to 2.5 in Phase III across 95 patients, each within-phase reduction significant at P<0.001 and the between-phase improvements at P<0.01 on second-look laparoscopy. The numbers make the claim; the disclaimer sentence can then be deleted.

---

### `neosalpingostomy` — denominator_precision  ·  Part V

**Field:** `body_html`  ·  **ref#159**

**Current:** A review of 402 laparoscopic fimbrioplasty and neosalpingostomy cases found an overall intrauterine pregnancy rate of 26.1%

**Evidence:** A review of 402 laparoscopic fimbrioplasty and neosalpingostomy cases found an overall intrauterine pregnancy rate of 26.1%

**Suggested fix:** The 26.1% denominator is the 260 women who had follow-up, not the 402 operated cases. Rewrite to: 'A series of 402 laparoscopic fimbrioplasty and neosalpingostomy cases reported an intrauterine pregnancy rate of 26.1% among the 260 women with follow-up.' Optionally add the ectopic figure from the same paper (2.3%, 6/260), which would give the entry's own ectopic-risk paragraph a number it currently lacks.

---

### `pelvic-excision-and-repair-surgery` — unverified_expansion  ·  Part V

**Field:** `name`

**Current:** PEARS (Pelvic Excision And Repair Surgery)

**Evidence:** rrm-cli list of Hilgers textbook chapters returns nine PEARS chapters, none of which expands the acronym: 'Chapter 70: PEARS: Peritoneal and Ovarian Endometriosis', 'Chapter 71: PEARS for Bowel Endometriosis...', 'Chapter 73: PEARS for Extensive Pelvic Adhesive Disease', 'Chapter 74: PEARS for Uterine Leiomyomata: Myomectomy', 'Chapter 75: PEARS for Polycystic Ovaries: Ovarian Wedge Resection', 'Chapter 76: PEARS for the Fallopian Tubes...', 'Chapter 79: Recurrence of Endometriosis after PEARS'

**Suggested fix:** I could NOT independently confirm the expansion 'Pelvic Excision And Repair Surgery' from the RRM corpus or from any source I verified. Every library reference uses the bare acronym. Before this stays on a public page as the term's title, have someone check the expansion against the Hilgers textbook text directly. Flagging as unverified, not as wrong.

---

### `tubal-ligation-reversal` — source_quality  ·  Part V

**Field:** `body_html`  ·  **ref#30**

**Current:** The type of original sterilization also matters: clip and ring ligations preserve more tube length and yield higher reversal success than coagulation or segmental resection methods.<sup class="cite-ref"><a href="#ref-30">30</a></sup><sup class="cite-ref"><a href="#ref-31">31</a></sup>

**Evidence:** reference 30: 'Tubal Ligation Reversal: Success Rates, Complications.' https://ro.co/fertility/tubal-ligation-reversal/ (publisher: Ro); reference 31: 'Tubal Reversal V IVF Success Rates.' https://www.mcrmfertility.com/2023/06/13/tubal-reversal/ (publisher: MCRM Fertility)

**Suggested fix:** A clinically substantive claim is sourced to a telehealth commerce site (ro.co) and an IVF clinic's marketing page (mcrmfertility.com). Berger 2016 is ALREADY ref 32 in this glossary and states the finding with primary data and a p-value. Swap refs 30/31 for ref 32 here and cite the actual figures (76% ring/clip vs 68% ligation/resection vs 67% coagulation, P<0.001). This is a citation-authority liability on a page whose whole purpose is to be cited.

---

### `tubal-ligation-reversal` — citation_metadata  ·  Part V

**Field:** `reference[32].journal, reference[33].journal`  ·  **ref#32**

**Current:** reference 32 journal = "PMC"; reference 33 journal = "PMC / NIH"

**Evidence:** NCBI esummary db=pmc id=4840024 returns: 'Effectiveness of bilateral tubotubal anastomosis in a large outpatient population.' Berger GS, Thorp JM Jr, Weaver MA. Human reproduction (Oxford, England) | 2016 May. NCBI esummary db=pmc id=5536424 returns: 'Pregnancy outcome of laparoscopic tubal reanastomosis: retrospective results from a single clinical centre.' Karayalcin R, Ozcan S, Tokmak A, Gurlek B, Yenicesu O, Timur H. The Journal of international medical research | 2017 Jun.

**Suggested fix:** The journal field for these two references contains the repository name rather than the journal. Set ref 32 journal to 'Human Reproduction' and ref 33 journal to 'The Journal of International Medical Research'. This pattern repeats across the shared reference table (refs 15 'SciELO', 16/28/38 'PubMed'), so it is worth a single sweep rather than per-term fixes.

---

### `vasectomy-reversal` — denominator_precision  ·  Part V

**Field:** `body_html`  ·  **ref#158**

**Current:** The Vasovasostomy Study Group analyzed 1,469 microsurgical reversals and reported overall patency of 86% and pregnancy in 52% of couples with available follow-up data.

**Evidence:** The Vasovasostomy Study Group analyzed 1,469 microsurgical reversals and reported overall patency of 86% and pregnancy in 52% of couples with available follow-up data.

**Suggested fix:** The 86% and 52% figures come from the 1,247 FIRST-TIME procedures subgroup (865/1,012 and 421/810), not from all 1,469 reversals. Tighten to: 'The Vasovasostomy Study Group reported on 1,469 microsurgical reversals; among the 1,247 first-time procedures, patency was 86% (865/1,012) and pregnancy 52% (421/810).' All four stratified interval pairs in the entry are exact and need no change.

---

### `adenomyosis` — source_quality  ·  Part VI-A

**Field:** `references`  ·  **ref#50**

**Current:** 50: Adenomyosis &amp; Infertility: Symptoms, Diagnosis &amp; Treatment. | P:BackTable | https://www.backtable.com/shows/obgyn/articles/adenomyosis-infertility-symptoms-diagnosis-treatment

**Evidence:** For women who want to conceive, <a href="#excision-surgery" class="gloss-xref">excision</a> of focal disease is the uterine-preserving, restorative surgical path.<sup class="cite-ref"><a href="#ref-48">48</a></sup><sup class="cite-ref"><a href="#ref-50">50</a></sup>

**Suggested fix:** Ref 50 is a podcast/media article carrying part of the load for the term's central surgical recommendation. Replace with a peer-reviewed adenomyomectomy or focal-resection series; ref 48 (J Clin Med 2024 review) already covers uterine-preserving options and can stand alone in the interim.

---

### `adenomyosis` — clinical_precision  ·  Part VI-A

**Field:** `body_html`  ·  **ref#49**

**Current:** Definitive diagnosis is histologic, classically by examination of the junctional zone after hysterectomy; contemporary practice diagnoses on clinical suspicion plus imaging, which can strongly suggest but not formally confirm the condition.

**Evidence:** classically by examination of the junctional zone after hysterectomy

**Suggested fix:** Histologic diagnosis rests on finding endometrial glands and stroma within the myometrium on the hysterectomy specimen; the junctional zone is an imaging construct (MRI/ultrasound), not the histologic target. Change to 'classically by finding endometrial glands and stroma within the myometrium on a hysterectomy specimen'. Junctional-zone thickening belongs in the imaging sentence instead.

---

### `endometrioma` — citation_url  ·  Part VI-A

**Field:** `references`  ·  **ref#38**

**Current:** 38: Excisional surgery versus ablative surgery for ovarian endometrioma. | https://pubmed.ncbi.nlm.nih.gov/?term=39588841

**Evidence:** 38: Excisional surgery versus ablative surgery for ovarian endometrioma. | J:PubMed | P:None | https://pubmed.ncbi.nlm.nih.gov/?term=39588841

**Suggested fix:** Reference 38 points at a PubMed search-results URL rather than the article record. A liveness sweep will pass it while the reader lands on a search page. Change to https://pubmed.ncbi.nlm.nih.gov/39588841/ and add the journal (Cochrane Database Syst Rev) and year (2024).

---

### `endometrioma` — vague_claim  ·  Part VI-A

**Field:** `body_html`  ·  **ref#116**

**Current:** A 2023 RCT found timing of excision within the cycle influences outcomes and tissue preservation.<sup class="cite-ref"><a href="#ref-116">116</a></sup>

**Evidence:** 37370122 | 2023 Jun 27 | Reprod Biol Endocrinol | The optimal time for laparoscopic excision of ovarian endometrioma: a prospective randomized controlled trial.

**Suggested fix:** The trial is real and correctly dated (verified by PubMed esummary: Wu Q, Yang Q, Lin Y, Wu L, Reprod Biol Endocrinol, 2023 Jun 27, publication type Randomized Controlled Trial). The glossary sentence never states what the trial found, so a reader cannot act on it and a reviewer cannot check it. State the actual comparison and direction of the result, or drop the sentence. I could not confirm the specific finding from a primary source in this pass; Perplexity's account of the arms and outcome was unsourced and is not safe to propagate.

---

### `endometriosis` — evidence_strength  ·  Part VI-A

**Field:** `body_html`  ·  **ref#286**

**Current:** Laparoscopic excision surgery physically removes established endometriosis lesions; multicenter outcomes data confirm this operative approach produces measurable patient benefit.<sup class="cite-ref"><a href="#ref-286">286</a></sup>

**Evidence:** OBJECTIVE : To serve as a pilot feasibility study for a randomized study of excision versus ablation in the treatment of endometriosis by (1) estimating the magnitude of change in symptoms after excision only at multiple referral centers and (2) determining the proportion of women willing to participate in a randomized trial.

**Canon:** RRM canon: excision is the standard position and must not be hedged. This fix upgrades the evidence rather than softening the claim.

**Suggested fix:** Ref 286 (Yeung 2013, JSLS) is a pilot feasibility study with no comparator and 8.5-month mean follow-up; its results do show significant pain and quality-of-life improvement, so the claim is directionally right but 'confirm' overstates the design. Either pair it with ref 28 (Pundir 2017 meta-analysis, already in the reference set) or say 'multicenter prospective data show measurable improvement in pain and quality of life after excision.' Do not weaken the excision position; strengthen the citation.

---

### `endometriosis` — source_quality  ·  Part VI-A

**Field:** `body_html`  ·  **ref#27**

**Current:** Some comparative data favor excision over ablation for symptom domains such as dysmenorrhea, dyschezia, and chronic pelvic pain, though the trial evidence is limited and clinicians weigh lesion type and depth in choosing technique.<sup class="cite-ref"><a href="#ref-28">28</a></sup><sup class="cite-ref"><a href="#ref-27">27</a></sup>

**Evidence:** 27: Laparoscopic Excision vs. Ablation in Endometriosis: A Comparison of Symptom and Quality of Life Outcomes. | P:EndoNews | https://www.endonews.com/laparoscopic-excision-vs.-ablation-in-endometriosis-a-comparison-of-symptom-and-quality-of-life-outcomes

**Suggested fix:** Ref 27 is EndoNews, a non-peer-reviewed news summary, sitting beside ref 28 which is the actual source (verified: PMID 28456617 = Pundir J et al, 'Laparoscopic Excision Versus Ablation for Endometriosis-associated Pain: An Updated Systematic Review and Meta-analysis', J Minim Invasive Gynecol 2017). Drop ref 27 or replace it with the underlying trial it summarizes.

---

### `fallopian-tube-anatomy` — source_quality  ·  Part VI-A

**Field:** `references`  ·  **ref#46**

**Current:** 46: Fallopian tube. | P:Wikipedia | https://en.wikipedia.org/wiki/Fallopian_tube

**Evidence:** <strong>The fallopian tube is a paired muscular and ciliated structure, roughly 10 to 12 centimeters in length, connecting each ovary to the uterine cavity and serving as the site of fertilization and early embryo transport.</strong><sup class="cite-ref"><a href="#ref-46">46</a></sup><sup class="cite-ref"><a href="#ref-47">47</a></sup>

**Suggested fix:** Wikipedia is cited as a co-equal source in the opening definition of a clinical reference term, next to StatPearls (ref 47) which already covers every anatomical claim in the paragraph. Drop ref 46 or replace it with an anatomy text. For an authority-facing glossary this is the single weakest citation in Part VI-A.

---

### `hydrosalpinx` — terminology  ·  Part VI-A

**Field:** `body_html`

**Current:** The accumulated serosal fluid is not inert: it is biochemically hostile to embryo implantation, and its retrograde flow into the uterine cavity disrupts the endometrial environment.

**Evidence:** The accumulated serosal fluid is not inert

**Suggested fix:** 'Serosal' refers to the outer serosal layer of the tube; the fluid that accumulates in the obstructed lumen is serous fluid produced by the tubal epithelium. Change 'serosal fluid' to 'serous fluid' or simply 'the accumulated fluid'.

---

### `hydrosalpinx` — uncited_claim  ·  Part VI-A

**Field:** `body_html`

**Current:** The implantation-impairing effect of hydrosalpinx fluid is well-documented in the reproductive medicine literature. When a hydrosalpinx is present, clinicians evaluating fertility cannot treat only the uterus or ovaries in isolation. The tube is a clinically active variable.

**Evidence:** The implantation-impairing effect of hydrosalpinx fluid is well-documented in the reproductive medicine literature.

**Suggested fix:** The paragraph asserting the term's central mechanism carries no citation at all, and the phrase 'well-documented in the literature' names no document. Attach a source for the embryotoxic/implantation-impairing effect. The claim is mainstream and well supported, so this is a sourcing gap rather than a factual error.

---

### `infertility` — uncited_claim  ·  Part VI-A

**Field:** `body_html`

**Current:** Male factor is solely responsible in approximately 20% of couples and contributes alongside female factors in another 30 to 40%.

**Evidence:** Infertility was also found to be caused by disorders in both the male and female partners together; thus in 39% of cases both the man and woman presented with disorders. The woman alone was responsible for infertility in one-third of cases and the man alone in one-fifth.

**Suggested fix:** The figures are defensible but carry no citation. Thonneau 1991 (PubMed 1757519), already in the glossary reference set as ref 395, reports male-alone ~one-fifth and both-partners 39%. Attach ref 395 to this sentence.

---

### `isthmocele` — duplicate_reference  ·  Part VI-A

**Field:** `references`  ·  **ref#16**

**Current:** 15: Isthmocele: an overview of diagnosis and treatment. | J:SciELO | https://www.scielo.br/j/ramb/a/sybvcWWJG8F7tL7yB8RH3DQ/?lang=en / 16: Isthmocele: an overview of diagnosis and treatment. | J:PubMed | https://pubmed.ncbi.nlm.nih.gov/31166450/

**Evidence:** contributing to secondary infertility and elevated early pregnancy loss risk in women with an inadequate residual myometrial wall.<sup class="cite-ref"><a href="#ref-15">15</a></sup><sup class="cite-ref"><a href="#ref-16">16</a></sup><sup class="cite-ref"><a href="#ref-34">34</a></sup>

**Suggested fix:** Refs 15 and 16 are the same paper (verified via PubMed esummary: PMID 31166450, Rev Assoc Med Bras (1992), 2019 Jun 3), one linked through SciELO and one through PubMed. Cited together they inflate the apparent evidence base. Merge into a single reference with the PubMed URL and keep the SciELO link as the full-text pointer.

---

### `luteal-phase-deficiency` — duplicate_reference  ·  Part VI-A

**Field:** `references`  ·  **ref#293**

**Current:** 81 and 276 both = Hilgers TW, 'The Identification of Postovulation Infertility with the Measurement of Early Luteal Phase (Peak Day +3) Progesterone Production', Linacre Q 2020; 293 and 294 both = Abdulla SH et al, 'Hormonal Predictors of Abnormal Luteal Phases in Normally Cycling Women', Front Public Health 2018

**Evidence:** 293: Abdulla SH, Bouchard TP, Leiva RA, Boyle P, Iwaz J, Ecochard R. Hormonal Predictors of Abn | J:Frontiers in Public Health | P:None | https://doi.org/10.3389/fpubh.2018.00144

**Suggested fix:** Two reference pairs in this single term are duplicates of the same paper under different URLs (library vs PubMed, DOI vs PubMed). Deduplicate to one row each. Note ref 293's anchor_text is also truncated mid-word ('Hormonal Predictors of Abn').

---

### `luteal-phase-deficiency` — style_em_dash  ·  Part VI-A

**Field:** `body_html`

**Current:** Menstrual cycle biomarkers -- including mucus quality, ovulation timing, and menstrual flow -- remain altered for at least several cycles after oral contraceptives are stopped

**Evidence:** Menstrual cycle biomarkers -- including mucus quality, ovulation timing, and menstrual flow -- remain altered

**Canon:** Style rule: no em dashes in body_html.

**Suggested fix:** No em dash character is present anywhere in Part VI-A, but this term ships a double-hyphen em-dash surrogate into published body copy, where it renders literally as '--'. Recast with commas: 'Menstrual cycle biomarkers, including mucus quality, ovulation timing, and menstrual flow, remain altered...' This is the only occurrence in the part.

---

### `myo-inositol` — unsupported_specificity  ·  Part VI-A

**Field:** `body_html`  ·  **ref#42**

**Current:** disrupted inositol metabolism is a recognized feature of the insulin resistance seen across PCOS phenotypes, particularly Phenotypes A and B, where hyperandrogenism and metabolic dysfunction overlap.<sup class="cite-ref"><a href="#ref-41">41</a></sup><sup class="cite-ref"><a href="#ref-42">42</a></sup>

**Evidence:** particularly Phenotypes A and B, where hyperandrogenism and metabolic dysfunction overlap

**Suggested fix:** The phenotype-specific qualifier is a stronger claim than the two general PCOS reviews cited can support; neither is a phenotype-stratified analysis. Either cite phenotype-stratified inositol data or drop 'particularly Phenotypes A and B' and keep the general PCOS statement.

---

### `pcos` — duplicate_reference  ·  Part VI-A

**Field:** `references`  ·  **ref#393**

**Current:** 388: Lim SS, Hutchison SK, Van Ryswyk E, Norman RJ, Teede HJ, Moran LJ Lifestyle changes in women with polycystic ovary syndrome. The Cochrane database of systematic reviews. 2019. / 393: Moran LJ, Hutchison SK, Norman RJ, Teede HJ Lifestyle changes in women with polycystic ovary syndrome. The Cochrane database of systematic reviews. 2011.

**Evidence:** for many patients, even a modest reduction in body weight can help restore ovulation.<sup class="cite-ref"><a href="#ref-388">388</a></sup><sup class="cite-ref"><a href="#ref-393">393</a></sup>

**Suggested fix:** Refs 388 and 393 are the same Cochrane review, 2019 update and superseded 2011 version, cited side by side as if two independent sources. Keep the 2019 version (ref 388) only.

---

### `pcos` — canonical_name  ·  Part VI-A

**Field:** `body_html`

**Current:** In <a href="#naprotechnology-definition" class="gloss-xref">NaProTECHNOLOGY</a> and restorative reproductive medicine practice

**Evidence:** In <a href="#naprotechnology-definition" class="gloss-xref">NaProTECHNOLOGY</a> and restorative reproductive medicine practice

**Canon:** Canonical names rule: NaProTechnology.

**Suggested fix:** This term renders the mark as NaProTECHNOLOGY while the adenomyosis and luteal-phase-deficiency terms in the same part render it NaProTechnology. The glossary_abbreviation row itself stores 'NaPro | NaProTECHNOLOGY (Natural Procreative Technology)', so the SSOT is inconsistent with prose in other terms. Pick one rendering glossary-wide (house canonical form is NaProTechnology) and update the abbreviation row to match.

---

### `pelvic-adhesions` — overstatement  ·  Part VI-A

**Field:** `body_html`

**Current:** They are frequently present in women labeled as having <a href="#unexplained-infertility" class="gloss-xref">unexplained infertility</a>, because adhesive disease is invisible on ultrasound and HSG and only becomes apparent at laparoscopy.

**Evidence:** adhesive disease is invisible on ultrasound and HSG and only becomes apparent at laparoscopy

**Suggested fix:** 'Invisible on ultrasound' is absolute and is contradicted inside this same glossary part: the endometriosis term credits skilled transvaginal ultrasound with detecting deep infiltrating disease, and dynamic ultrasound assessment (sliding sign) does detect pouch-of-Douglas obliteration and adhesions. Soften to 'largely occult on routine ultrasound and HSG' and keep laparoscopy as the definitive route. The clinical point survives intact and stops being falsifiable.

---

### `rpl` — internal_crossref  ·  Part VI-A

**Field:** `body_html`

**Current:** anatomical (<a href="/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/">isthmocele</a>, septum, fibroids)

**Evidence:** anatomical (<a href="/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/">isthmocele</a>, septum, fibroids)

**Suggested fix:** A dedicated isthmocele glossary term exists in this same part (slug isthmocele). Use the in-glossary xref pattern (#isthmocele, class gloss-xref) as every other term does, and keep the commentary link as a secondary read-more if wanted. Same pattern appears in the adenomyosis term.

---

### `shortened-luteal-phase` — citation_support  ·  Part VI-A

**Field:** `body_html`  ·  **ref#111**

**Current:** Luteal phase duration can also vary cycle to cycle in the same individual, so a single short cycle does not establish the pattern; consistent measurement across multiple cycles is needed to characterize it as a recurring finding.<sup class="cite-ref"><a href="#ref-111">111</a></sup><sup class="cite-ref"><a href="#ref-44">44</a></sup>

**Evidence:** Perfectly normal follicular and periovulatory events may be followed by deficient luteal phases.

**Suggested fix:** Ref 111 (Grunfeld 1989, PMID 2591570, abstract read in full) is a single-cycle study of 37 women showing that LPD can follow a completely normal follicular and periovulatory phase. It is excellent evidence for a different claim and says nothing about within-woman cycle-to-cycle variability. Either move ref 111 to a sentence about LPD arising despite normal folliculogenesis, or cite a study that actually measured repeated luteal lengths in the same women. Verify any replacement PMID against PubMed directly.

---

### `uterine-fibroids` — missing_standard  ·  Part VI-A

**Field:** `body_html`  ·  **ref#183**

**Current:** <strong>Uterine fibroids, or leiomyomas, are benign smooth-muscle tumors of the uterus that are classified by their anatomic location, which directly determines their fertility impact.</strong>

**Evidence:** 38453041 | 2024 Jul | Fertil Steril | Uterine fibroid-related infertility: mechanisms and management.

**Suggested fix:** The term states that fibroids are classified by anatomic location but never names the FIGO leiomyoma classification (types 0 through 8), which is the standard system used in the fertility literature and by the cited source (Donnez, Taylor, Marcellin, Fertil Steril 2024, PMID 38453041, verified via PubMed esummary). Naming it, and mapping submucosal to FIGO 0-2, would make the term usable for patients reading their own operative or imaging reports.

---

### `uterine-septum` — missing_citation  ·  Part VI-A

**Field:** `body_html`  ·  **ref#194**

**Current:** Observational cohorts report higher pregnancy continuation after resection in women with a confirmed septum and prior loss, though these designs cannot separate the surgery's effect from background spontaneous resolution rates after a single loss; randomized data on whether resection improves live birth remain limited.<sup class="cite-ref"><a href="#ref-194">194</a></sup><sup class="cite-ref"><a href="#ref-17">17</a></sup>

**Evidence:** randomized data on whether resection improves live birth remain limited

**Suggested fix:** This is the best-reasoned paragraph in the term but it discusses randomized evidence while citing an observational cohort (ref 194) and an ACOG hysteroscopy committee opinion (ref 17), and never cites the trial itself. Add the TRUST RCT (Rikken 2021, Hum Reprod, PMID 33793794, verified against PubMed) here. Citing it makes the paragraph unattackable and also fixes the contradiction flagged above.

---

### `aps` — outdated_nomenclature  ·  Part VI-B

**Field:** `body_html`

**Current:** Diagnosis requires both a clinical event and laboratory confirmation.

**Evidence:** Laboratory criteria require at least one characteristic antibody confirmed on two separate occasions twelve or more weeks apart.

**Suggested fix:** Add one sentence noting that the 2023 ACR/EULAR classification criteria are now the current classification standard (weighted additive scoring, aPL positivity required within three years of the clinical event), while the 2006 Sydney criteria remain widely used clinically. This is an addition, not a correction.

---

### `hypothyroidism` — definition_precision  ·  Part VI-B

**Field:** `body_html`

**Current:** It is diagnosed by elevated TSH with low or normal free T4. Subclinical hypothyroidism is a milder form: TSH is elevated while free T4 remains within normal range.

**Evidence:** It is diagnosed by elevated TSH with low or normal free T4.

**Suggested fix:** The first sentence folds subclinical into overt disease and then the second sentence separates them, which reads as a contradiction. Tighten: 'Overt hypothyroidism is diagnosed by elevated TSH with low free T4. Subclinical hypothyroidism is the milder form: TSH is elevated while free T4 remains within the normal range.'

---

### `insulin-resistance` — weak_source  ·  Part VI-B

**Field:** `body_html`  ·  **ref#41**

**Current:** <a href="#myo-inositol" class="gloss-xref">Myo-inositol</a> has a documented role in improving insulin signaling in PCOS and is among the nutritional options with published clinical evidence.<sup class="cite-ref"><a href="#ref-41">41</a></sup>

**Evidence:** Myo-inositol has a documented role in improving insulin signaling in PCOS and is among the nutritional options with published clinical evidence.

**Suggested fix:** Ref 41 is hosted at respubjournals.com, a non-indexed publisher, and carries the myo-inositol evidence claim. Ref 42 (PMC10926319) is already in the reference list, is PubMed Central indexed, and covers the same ground. Drop ref 41 or demote it behind ref 42.

---

### `insulin-resistance` — pcos_pmos_dual_label  ·  Part VI-B

**Field:** `body_html`

**Current:** insulin resistance is most clinically significant in <a href="#pcos" class="gloss-xref">PCOS</a>

**Evidence:** Understanding insulin resistance as the upstream metabolic driver reframes PCOS from a hormone disorder to a metabolic condition with hormonal consequences.

**Canon:** PCOS: the RRM-preferred dual label is PCOS/PMOS during a 3-year transition. Not an error if only PCOS is used, but note as P3 if a term would benefit.

**Suggested fix:** This entry is the strongest place in Part VI-B for the PCOS/PMOS dual label, because its central argument is precisely that the condition is metabolic rather than primarily ovarian. Consider introducing PCOS/PMOS once at first mention. Not an error; enhancement only, and the slug should not change.

---

### `male-factor-infertility` — clarity_and_internal_consistency  ·  Part VI-B

**Field:** `body_html`

**Current:** the clinical pathway branches based on whether the obstruction is obstructive or secretory: obstructive azoospermia may be surgically correctable, while secretory causes require genetic evaluation before determining whether natural conception is possible

**Evidence:** the clinical pathway branches based on whether the obstruction is obstructive or secretory

**Canon:** Canonical names / internal consistency

**Suggested fix:** The phrase is self-contradictory (an obstruction cannot be 'secretory') and the vocabulary conflicts with the azoospermia entry in the same part, which uses obstructive (OA) versus non-obstructive (NOA). Rewrite as: 'the clinical pathway branches on whether the cause is obstructive or non-obstructive: obstructive azoospermia may be surgically correctable, while non-obstructive causes require hormonal and genetic evaluation before determining whether natural conception is possible.'

---

### `oat-syndrome` — nomenclature  ·  Part VI-B

**Field:** `name`  ·  **ref#171**

**Current:** Oligospermia / Asthenospermia / Teratospermia

**Evidence:** low sperm concentration (oligospermia), reduced progressive motility (asthenospermia), and abnormal morphology (teratospermia)

**Canon:** Canonical names

**Suggested fix:** The entry cites WHO 2021 (ref 171) as its authority but uses the legacy '-spermia' forms in both the term name and the body. Add the WHO forms as the primary label with the common forms in parentheses: 'Oligozoospermia (oligospermia) / Asthenozoospermia (asthenospermia) / Teratozoospermia (teratospermia)'. Slug should stay oat-syndrome.

---

### `oat-syndrome` — source_nuance  ·  Part VI-B

**Field:** `body_html`  ·  **ref#171**

**Current:** Each parameter is measured against WHO 2021 reference values: concentration below 16 million per milliliter, progressive motility below 30%, and normal morphology below 4% by Kruger strict criteria.

**Evidence:** When all three fall below threshold together, the combined deficiency is termed OAT syndrome.

**Suggested fix:** Add half a sentence noting these are 5th-centile lower reference limits from a fertile reference population, and that WHO 6th edition explicitly states they are not standalone diagnostic thresholds. This strengthens rather than weakens the entry's existing point that OAT is a signal, not a disease.

---

### `oxidative-stress` — clarity  ·  Part VI-B

**Field:** `body_html`  ·  **ref#58**

**Current:** In female reproductive biology, oxidative stress is implicated in the peritoneal environment of <a href="#endometriosis" class="gloss-xref">endometriosis</a>, contributing to impaired follicle development and impaired sperm function and <a href="#sperm-dna-fragmentation" class="gloss-xref">sperm DNA</a> integrity within the peritoneal environment, reducing fertilization competence.

**Evidence:** contributing to impaired follicle development and impaired sperm function and sperm DNA integrity within the peritoneal environment, reducing fertilization competence

**Suggested fix:** The sentence repeats 'peritoneal environment' twice, chains three 'and' clauses, and mixes a female-side mechanism (impaired follicle development) with a male-side one (sperm function and DNA integrity) inside a sentence introduced as female reproductive biology. Split it: 'In female reproductive biology, oxidative stress is implicated in the peritoneal environment of endometriosis, where it impairs follicle development. The same inflammatory peritoneal fluid also damages sperm function and sperm DNA integrity, reducing fertilization competence.'

---

### `oxidative-stress` — weak_source  ·  Part VI-B

**Field:** `body_html`  ·  **ref#58**

**Current:** <sup class="cite-ref"><a href="#ref-58">58</a></sup>

**Evidence:** reducing fertilization competence.

**Suggested fix:** Ref 58 is 'Impact of Oxidative stress on Infertility' in Global Journal of Fertility Research (reprodgroup.us), a low-tier non-indexed publisher, carrying the entry's only female-side mechanistic claim. Replace with indexed literature on peritoneal fluid oxidative stress in endometriosis; ref 57 (PMC9535111) is already available and better placed for this.

---

### `secondary-infertility` — citation_weak  ·  Part VI-B

**Field:** `body_html`  ·  **ref#3**

**Current:** The couple presenting today may have a different underlying pathology than the couple who conceived two years ago.<sup class="cite-ref"><a href="#ref-3">3</a></sup>

**Evidence:** The couple presenting today may have a different underlying pathology than the couple who conceived two years ago.

**Suggested fix:** Ref 3 is a general RRM outcomes cohort (370 couples, 27% with a prior live birth). It establishes that RRM practices treat secondary infertility but says nothing about changed pathology between pregnancies. Either drop the citation from this rhetorical sentence or move it to the opening claim that secondary infertility 'is more common than many clinicians acknowledge', where the 27% prior-live-birth figure is directly usable.

---

### `sperm-dna-fragmentation-extended` — weak_source  ·  Part VI-B

**Field:** `body_html`  ·  **ref#20**

**Current:** Elevated DNA fragmentation index (DFI) is independently associated with reduced natural conception rates, lower pregnancy rates following intrauterine insemination, increased miscarriage risk, and impaired embryo development.<sup class="cite-ref"><a href="#ref-19">19</a></sup><sup class="cite-ref"><a href="#ref-20">20</a></sup>

**Evidence:** Elevated DNA fragmentation index (DFI) is independently associated with reduced natural conception rates, lower pregnancy rates following intrauterine insemination, increased miscarriage risk, and impaired embryo development.

**Suggested fix:** Ref 20 is a private fertility clinic page (evewell.com/support/sperm-dna-fragmentation-and-ivf) and ref 22 is a patient-education forum page (ssmr.org). Both are cited alongside a four-part clinical association claim on a page whose purpose is citation authority. Ref 19 (PMC11152411) and ref 21 (PMC5922225) already carry these claims. Drop 20 and 22 or replace with indexed meta-analyses of DFI and reproductive outcomes.

---

### `varicocele` — weak_source  ·  Part VI-B

**Field:** `body_html`  ·  **ref#54**

**Current:** Repair results in measurable improvement in <a href="#semen-analysis" class="gloss-xref">semen parameters</a> in the majority of men, and <a href="#sperm-dna-fragmentation" class="gloss-xref">sperm DNA fragmentation</a> decreases significantly following correction of testicular venous outflow.<sup class="cite-ref"><a href="#ref-53">53</a></sup><sup class="cite-ref"><a href="#ref-54">54</a></sup><sup class="cite-ref"><a href="#ref-55">55</a></sup><sup class="cite-ref"><a href="#ref-56">56</a></sup>

**Evidence:** Repair results in measurable improvement in semen parameters in the majority of men, and sperm DNA fragmentation decreases significantly following correction of testicular venous outflow.

**Suggested fix:** Refs 54 (maleinfertility.org 'Varicocelectomy Results', a clinic procedure page) and 55 (fertilitycenter.com blog post) are commercial clinic marketing pages carrying a clinical efficacy claim on a citation-authority page. Refs 53 (PMC review) and 56 (PubMed 35734643) already carry the claim. Drop 54 and 55 or replace with indexed meta-analyses of varicocelectomy effects on semen parameters and DFI.

---

### `bmi` — citation_format  ·  Part VI-C

**Field:** `body_html`

**Current:** <sup>[69]</sup> ... <sup>[70]</sup>

**Evidence:** BMI does not measure body composition or metabolic health directly, and its limitations are well documented at the individual level.<sup>[69]</sup>

**Suggested fix:** Both citations render as bare literal text instead of linked anchors, so neither resolves to the reference list. Refs 69 (Hu Q et al., preconception BMI and subfertility) and 70 (Westerman and Kuhnt, metabolic risk factors and fertility disorders) both exist and are well matched to their claims. Fix in the glossary-wide citation-format pass.

---

### `chronic-pelvic-pain` — citation_format  ·  Part VI-C

**Field:** `body_html`  ·  **ref#208**

**Current:** and more than one cause often operates at the same time.<sup>[208]</sup>

**Evidence:** CPP can arise from <a href="#endometriosis" class="gloss-xref">endometriosis</a>, <a href="#adenomyosis" class="gloss-xref">adenomyosis</a>, <a href="#pelvic-adhesions" class="gloss-xref">pelvic adhesions</a>, interstitial cystitis, irritable bowel syndrome, or <a href="#pelvic-floor-physical-therapy" class="gloss-xref">pelvic floor dysfunction</a>, and more than one cause often operates at the same time.<sup>[208]</sup>

**Suggested fix:** Citation is rendered as bare literal text '<sup>[208]</sup>' instead of the linked form '<sup class="cite-ref"><a href="#ref-208">208</a></sup>' used elsewhere, so the reader cannot click through to the reference list. Ref 208 exists and is correct (Howard FM, Chronic pelvic pain, Obstet Gynecol 2003). Class defect: same pattern in natural-killer-cells, pms, bmi and thrombophilia in this batch alone. Fix with a single pass over the whole glossary.

---

### `early-pregnancy-loss` — citation_strength  ·  Part VI-C

**Field:** `body_html`  ·  **ref#129**

**Current:** It is the most common complication of pregnancy, affecting approximately 10 to 20% of confirmed pregnancies. The majority of isolated losses result from chromosomal aneuploidy in the embryo, and a single loss in an otherwise healthy couple carries a reasonable prognosis for subsequent success without intervention.<sup class="cite-ref"><a href="#ref-129">129</a></sup>

**Evidence:** It is the most common complication of pregnancy, affecting approximately 10 to 20% of confirmed pregnancies. The majority of isolated losses result from chromosomal aneuploidy in the embryo

**Suggested fix:** Ref 129 is Hakim RB, Gray RH, Zacur H, 'Infertility and early pregnancy loss' (AJOG), a study of the relationship between infertility and loss rates. It is an unlikely source for the general population prevalence figure and an especially unlikely one for the aneuploidy-majority claim. Add the ACOG Practice Bulletin on Early Pregnancy Loss (or the ASRM equivalent) as the source for the prevalence and aneuploidy sentences, keeping ref 129 for the infertility-related content if any is retained. Flagged at P3 rather than P2 because the Hakim abstract was not obtained this pass, so non-support is inferred from title and scope rather than demonstrated.

---

### `immature-follicle-syndrome` — clarity  ·  Part VI-C

**Field:** `body_html`  ·  **ref#78**

**Current:** The specific diagnostic criteria reside in the follicle-maturation-study protocol training. No single measurement defines the diagnosis in isolation.

**Evidence:** Diagnosis is made by a trained sonographer observing the full serial scan picture across the periovulatory window: the dominant follicle collapses before the pattern consistent with mature follicular development is established. The specific diagnostic criteria reside in the follicle-maturation-study protocol training. No single measurement defines the diagnosis in isolation.

**Canon:** Hilgers TW, Chapter 20 (ref 78), retrieved in full via rrm-cli. The source defines the category by a single stated mean-follicular-diameter threshold and explicitly contrasts it with the normal category, which is also threshold-defined.

**Suggested fix:** The sentence 'No single measurement defines the diagnosis in isolation' is not accurate to the cited source, which does define this category by a stated diameter criterion. The withholding instinct is correct and must be preserved, so do NOT publish the threshold. Reword to keep the protocol sealed without asserting something the source contradicts: 'The maturity criterion is specified in the follicle-maturation-study protocol training and is applied by a trained sonographer to the full serial scan series.' This says the same operational thing, keeps the number out of public copy, and stops contradicting ref 78.

---

### `natural-killer-cells` — citation_format  ·  Part VI-C

**Field:** `body_html`

**Current:** <sup>[209]</sup> ... <sup>[37]</sup> ... <sup>[26]</sup> ... <sup>[65]</sup>

**Evidence:** Elevated uterine NK cell activity has been associated with implantation failure and <a href="#rpl" class="gloss-xref">recurrent pregnancy loss</a> in a subset of patients, though clinical testing and optimal management remain areas of active investigation rather than settled protocol.<sup>[37]</sup>

**Suggested fix:** All four citations in this term are bare literal text rather than the linked '<sup class="cite-ref"><a href="#ref-N">N</a></sup>' form used elsewhere, so none of them resolve to the reference list. All four ref numbers (209, 37, 26, 65) exist and are correctly matched to their claims. Fix as part of the glossary-wide citation-format pass (also affects chronic-pelvic-pain, pms, bmi, thrombophilia in this batch).

---

### `pms` — metadata_error  ·  Part VI-C

**Field:** `word_count`

**Current:** 247

**Evidence:** Premenstrual syndrome (PMS) is a pattern of cyclical physical, cognitive, and emotional symptoms that appear in the luteal phase of the menstrual cycle and resolve with or shortly after the onset of menses.

**Suggested fix:** The stored word_count is 247 but the actual body is 642 words, a 395-word gap and by far the largest discrepancy in this batch (every other term in Part VI-C matches within 10 words). Whatever consumes word_count (reading-time display, index weighting, QA gates) is being fed a stale value. Recompute word_count for this row and add a build-time assertion that the stored value matches the rendered body.

---

### `pms` — citation_format  ·  Part VI-C

**Field:** `body_html`

**Current:** <sup>[66]</sup> ... <sup>[45]</sup> ... <sup>[44]</sup> ... <sup>[131]</sup> ... <sup>[67]</sup> ... <sup>[220]</sup> ... <sup>[111]</sup> ... <sup>[248]</sup>

**Evidence:** Major reproductive medicine bodies acknowledge that no diagnostic test for luteal dysfunction has proven reliably reproducible, and that defining a normal hormonal threshold for the luteal phase remains an unsolved problem.<sup>[45]</sup>

**Suggested fix:** All eight citations in this term are bare literal text rather than linked anchors, so none resolve to the reference list. This is the most heavily cited term in the batch and the one where unlinked citations cost the most credibility. All eight numbers exist in references.json. Fix in the glossary-wide citation-format pass.

---

### `postpartum-fertility` — copy_error  ·  Part VI-C

**Field:** `body_html`

**Current:** The first post-postpartum cycles are often anovulatory, particularly in the transition phase as breastfeeding frequency decreases.

**Evidence:** The first post-postpartum cycles are often anovulatory, particularly in the transition phase as breastfeeding frequency decreases.

**Suggested fix:** 'post-postpartum' is a duplicated prefix. Change to 'The first postpartum cycles are often anovulatory'.

---

### `thrombophilia` — citation_format  ·  Part VI-C

**Field:** `body_html`

**Current:** <sup>[75]</sup> ... <sup>[37][52]</sup> ... <sup>[52]</sup>

**Evidence:** Not all thrombophilias carry the same reproductive risk; the degree varies with the specific mutation, zygosity, and additional risk factors.<sup>[37][52]</sup>

**Suggested fix:** All citations in this term are bare literal text rather than linked anchors, and the '[37][52]' pair is doubly awkward because neither number resolves. All three numbers exist in references.json. Fix in the glossary-wide citation-format pass.

---

### `window-of-implantation` — evidence_precision  ·  Part VI-C

**Field:** `body_html`  ·  **ref#86**

**Current:** In women with recurrent implantation failure, endometrial receptivity testing (<a href="#era" class="gloss-xref">ERA</a>) can detect a displaced WOI, though evidence on whether ERA-guided timing improves live birth rates is mixed.

**Evidence:** though evidence on whether ERA-guided timing improves live birth rates is mixed

**Suggested fix:** 'Mixed' understates ref 86, which is a randomized clinical trial in JAMA (Doyle et al. 2022;328(21):2117-2125) whose primary result was that ERA-guided timing did not improve live birth versus standard timing. Naming the RCT result explicitly ('the largest randomized trial found no live-birth benefit, while some later observational work reports gains') is stronger and more defensible than the generic hedge, and it is directionally favourable to the restorative argument that receptivity follows cycle physiology rather than a test. Enhancement only, not an error.

---

### `d-chiro-inositol` — nomenclature  ·  Part VI-D

**Field:** `body_html`

**Current:** In <a href="#pcos" class="gloss-xref">PCOS</a>, a defect in DCI metabolism

**Evidence:** In RRM practice, ratio-based inositol supplementation is considered as a nutritional support option for women with PCOS, dosed under clinical supervision.

**Canon:** PCOS/PMOS dual label, 3-year transition

**Suggested fix:** Three bare uses of PCOS in a metabolic entry. This is exactly the kind of term that benefits from the PCOS/PMOS dual label during the three-year transition, since the entry is entirely about the metabolic/insulin axis that motivated the rename. Suggest first mention as 'PCOS/PMOS' and bare PCOS thereafter. Not an error - enhancement only.

---

### `dysmenorrhea` — canonical_name  ·  Part VI-D

**Field:** `body_html`

**Current:** cycle charting (<a href="/faqs/what-is-the-difference-between-creighton-model-marquette-method-femm-and-symptot/">Creighton Model</a>, FEMM)

**Evidence:** cycle charting (<a href="/faqs/what-is-the-difference-between-creighton-model-marquette-method-femm-and-symptot/">Creighton Model</a>, FEMM)

**Canon:** Canonical: Creighton Model FertilityCare System

**Suggested fix:** The canonical name is 'Creighton Model FertilityCare System' - which is also exactly how the glossary_abbreviations table has it (CrMS -> Creighton Model FertilityCare System, term_slug creighton-model). Use the full canonical name on first mention here. Also note the anchor points at an FAQ rather than at the #creighton-model glossary term that the abbreviations table already maps to; an in-glossary xref would be more consistent with how every other cross-reference in this part is built.

---

### `follicular-deficiency` — protocol_leak  ·  Part VI-D

**Field:** `body_html`

**Current:** RRM clinicians evaluate Peak+7 estradiol and progesterone as integrated markers of what the follicle actually produced. ... When Peak+7 estradiol falls below target range ... when luteal rescue does not restore normal Peak+7 values

**Evidence:** The diagnostic window is the post-Peak hormonal picture. RRM clinicians evaluate Peak+7 estradiol and progesterone as integrated markers of what the follicle actually produced.

**Canon:** NO PUBLIC PROTOCOLS OR DOSINGS - cycle-day timing

**Suggested fix:** Three separate publications of Peak-relative cycle-day timing ('Peak+7', x3) in a public glossary entry. Per the no-public-protocols rule, rewrite at concept level: 'RRM clinicians evaluate mid-luteal estradiol and progesterone together, drawn at a cycle-timed point after Peak Day determined by the clinician' and 'when mid-luteal estradiol falls below the expected range'. Note for the human arbiter: a single mid-luteal draw is widely published standard practice outside NaPro, so this may be judged an acceptable disclosure - but the specific Peak+N notation is Hilgers-protocol notation and is the part that should go.

**Adversarial verdict:** DOWNGRADE — All three Peak+7 strings verified verbatim in the entry, so the textual claim is accurate. The severity is not. The prior reviewer missed dispositive context. (1) The glossary already carries a dedicated public term, slug peak-7-progesterone, name 'Peak +7 Progesterone (P+7)', in terms-part-III.json, whose entire purpose is to define this notation, and which uses P+7 four times. (2) A sweep of all

**Corrected fix:** Do not strip the notation. Rewriting to 'mid-luteal' as proposed would contradict the glossary's own peak-7-progesterone term and the live commentary page, and would blunt the entry's actual differentiator, that RRM anchors the draw to a confirmed cycle landmark. The real defect is a missing cross-link: follicular-deficiency names Peak+7 three times with no xref while a dedicated term exists. Fix 

---

### `fsh-desensitization` — citation_quality  ·  Part VI-D

**Field:** `body_html`

**Current:** AMH and FSH are inversely related, and AMH tracks declining ovarian reserve over time.<sup class="cite-ref"><a href="#ref-120">120</a></sup>

**Evidence:** AMH and FSH are inversely related, and AMH tracks declining ovarian reserve over time.

**Suggested fix:** Reference 120 is 'Using anti-Mullerian hormone to predict premature ovarian insufficiency: a retrospective cross-sectional study' (Frontiers in Endocrinology). A cross-sectional design cannot establish that AMH 'tracks declining ovarian reserve over time' - that is a longitudinal claim. The inverse AMH-FSH relationship is fine from a cross-sectional study; the temporal-tracking half needs a longitudinal source. Either split the sentence and cite each half appropriately, or swap in a longitudinal AMH trajectory source. Enhancement only - the claim itself is true, just under-supported by the specific paper attached.

---

### `fsh-desensitization` — missing_citation  ·  Part VI-D

**Field:** `body_html`

**Current:** Current evidence links chronic pelvic inflammation to lower ovarian reserve markers, suggesting inflammation may diminish reserve, but published evidence has not demonstrated that reducing inflammation reverses elevated FSH.

**Evidence:** Current evidence links chronic pelvic inflammation to lower ovarian reserve markers, suggesting inflammation may diminish reserve, but published evidence has not demonstrated that reducing inflammation reverses elevated FSH.

**Suggested fix:** This sentence appeals explicitly to 'current evidence' and 'published evidence' but carries no reference, in a paragraph and an entry where every other evidentiary claim does. Since the sentence is doing careful work - separating an established directional association from an unestablished reversibility claim - it should carry the citation that lets a reader check exactly that boundary. Add a source for the inflammation-to-reserve association. Enhancement only; the epistemics of the sentence are sound as written.

---

### `hyperandrogenism` — protocol_leak  ·  Part VI-D

**Field:** `body_html`

**Current:** RRM clinicians treat the identified cause with targeted interventions (which may include metformin, myo-inositol, or adrenal support) rather than suppressing androgen production with oral contraceptives.

**Evidence:** RRM clinicians treat the identified cause with targeted interventions (which may include metformin, myo-inositol, or adrenal support)

**Canon:** NO PUBLIC PROTOCOLS OR DOSINGS - drug lists in the form 'Treatment includes X Y Z'

**Suggested fix:** A named drug list in the 'treatment may include X, Y, Z' form, published on a public glossary page. No dosing is given, which limits the exposure, but the construction is exactly what the no-public-protocols rule names. Rewrite at concept level: 'RRM clinicians treat the identified cause directly - insulin-sensitising, ovarian, or adrenal-directed approaches chosen to match the source - rather than suppressing androgen production with oral contraceptives.' Flagging at P1 per the rule; a human arbiter may reasonably downgrade given the absence of doses and the fact that metformin in PCOS is not RRM-specific.

**Adversarial verdict:** DOWNGRADE — The quote appears verbatim in terms-part-VI-D.json, so the finding is not a misquote. The protocol_leak framing does not survive scrutiny. The sentence publishes no dose, route, frequency, cycle-day timing, sequence, or Hilgers-derived percentage; it names two agents behind a hedge ('which may include'). Both are mainstream first-line agents for the insulin-driven hyperandrogenism of PCOS, not RRM

**Corrected fix:** Do not strip the agent names. Doing so would leave hyperandrogenism inconsistent with the cited 'pcos' and 'insulin-resistance' entries and would weaken a correct RRM contrast for no safety gain. Align it with the house pattern and cite it instead: 'In RRM, hyperandrogenism drives a source-directed workup. Insulin sensitization with agents such as metformin or myo-inositol, and adrenal-directed ev

---

### `hyperandrogenism` — nomenclature  ·  Part VI-D

**Field:** `body_html`

**Current:** It is the defining feature of <a href="#pcos" class="gloss-xref">PCOS</a> in most international diagnostic criteria.

**Evidence:** Congenital adrenal hyperplasia, particularly non-classic 21-hydroxylase deficiency, mimics PCOS and must be excluded before a PCOS diagnosis is finalized.

**Canon:** PCOS/PMOS dual label, 3-year transition

**Suggested fix:** Three bare uses of PCOS. Hyperandrogenism is the clinical axis most directly implicated in the PCOS/PMOS rename, so this entry is a strong candidate for the dual label on first mention: 'PCOS/PMOS'. Enhancement only, not an error.

---

### `levothyroxine-in-fertility` — abbreviation_mismatch  ·  Part VI-D

**Field:** `name`

**Current:** Levothyroxine (L-T4) in Fertility

**Evidence:** <strong>Levothyroxine</strong> is the synthetic thyroid hormone preparation used to treat hypothyroidism, subclinical hypothyroidism, and thyroid autoimmunity in the fertility context.

**Suggested fix:** The term NAME introduces 'L-T4' but body_html never uses it and abbreviations.json has no L-T4 row (TSH is present; L-T4 is not). Either add the row, or drop it from the title since nothing downstream uses it. Lower severity than the PRS/DRS/AF cases because the abbreviation is not introduced in body_html.

---

### `mature-reproductive-age` — citation_placement  ·  Part VI-D

**Field:** `body_html`  ·  **ref#101**

**Current:** These changes confront every clinician working with older reproductive-age couples, regardless of the care model.<sup class="cite-ref"><a href="#ref-101">101</a></sup>

**Evidence:** Cycle regularity may remain intact while egg quality and fertilization potential fall. These changes confront every clinician working with older reproductive-age couples, regardless of the care model.

**Suggested fix:** Ref 101 (Steiner AZ et al., JAMA 2017) is anchored to a rhetorical sentence rather than to the factual sentence it supports. Worse, Steiner 2017's actual finding is that diminished-ovarian-reserve biomarkers were NOT associated with reduced fertility in women 30-44 - which is exactly how the fsh-desensitization entry (correctly) uses it. Using the same paper here as generic backing for 'AMH and antral follicle count both decline' risks an apparent cross-entry contradiction. Move the marker to the biomarker-decline sentence and consider a one-clause acknowledgement that declining markers are not the same as declining natural fertility, which is the RRM position stated elsewhere in this glossa

---

### `menopause` — citation_quality  ·  Part VI-D

**Field:** `body_html`  ·  **ref#73**

**Current:** Hormone therapy is one tool for managing menopausal symptoms; it is not the only one, and decisions are made relative to each person's clinical picture and values.<sup class="cite-ref"><a href="#ref-73">73</a></sup>

**Evidence:** Hormone therapy is one tool for managing menopausal symptoms; it is not the only one, and decisions are made relative to each person's clinical picture and values.

**Suggested fix:** Reference 73 is Panay N et al., 'Evidence-based guideline: premature ovarian insufficiency', Climacteric 2024. That is a POI guideline, where hormone therapy has a different indication and a different risk-benefit calculus (replacement to the average age of natural menopause, not symptom management in a 52-year-old). Using it as the authority for general menopausal symptom management is off-target. Swap in a menopause-specific source (Menopause Society / NAMS hormone therapy position statement) and keep ref 73 attached only to the POI sentence in the third paragraph, where it genuinely belongs.

---

### `oligospermia` — canonical_name  ·  Part VI-D

**Field:** `body_html`

**Current:** <a href="/naprotechnology/">NaProTECHNOLOGY</a>-based protocols

**Evidence:** <a href="/naprotechnology/">NaProTECHNOLOGY</a>-based protocols address oligospermia within a couple-centered evaluation

**Suggested fix:** This is the only term in Part VI-D that renders the mark as 'NaProTECHNOLOGY'; the other five occurrences across partial-rupture-syndrome, delayed-rupture-syndrome, afollicularism, mature-reproductive-age and estrogen-dominance all use 'NaProTechnology', which is the canonical form. The all-caps variant is the 2004 textbook's typography, correct in the reference table (ref 78) but not in body prose. Normalise to 'NaProTechnology'.

---

### `premenopause` — precision  ·  Part VI-D

**Field:** `body_html`

**Current:** <a href="#amh" class="gloss-xref">AMH</a> is at or near its lifetime peak in the early-to-mid premenopausal years, declining gradually through the late thirties as the transition approaches

**Evidence:** FSH remains within normal range, and <a href="#amh" class="gloss-xref">AMH</a> is at or near its lifetime peak in the early-to-mid premenopausal years, declining gradually through the late thirties as the transition approaches.

**Suggested fix:** The phrasing reads as though AMH holds near-peak until the late thirties and only then declines. Validated nomograms (Kelsey/Nelson 2011; Lie Fong 2012 JCEM) put the peak at ~24.5 years with steady decline from ~25 onward, steepening in the late thirties. Rewrite as: 'AMH reaches its lifetime peak in the mid-twenties and declines steadily from then on, with the fall steepening in the late thirties as the transition approaches.' Note: I did not independently confirm the Nelson 2011 and Lie Fong 2012 citations against the primary papers, so verify before adding either as a reference.

---

### `premenopause` — internal_consistency  ·  Part VI-D

**Field:** `body_html`

**Current:** spanning the years of regular ovulatory cycling from adolescence through the late thirties or early forties

**Evidence:** <strong>Premenopause is the reproductive life stage preceding perimenopause, spanning the years of regular ovulatory cycling from adolescence through the late thirties or early forties.</strong>

**Suggested fix:** Leaves an unexplained gap against the sibling entry: the perimenopause entry says perimenopause 'most commonly begins in the mid-forties'. If premenopause ends in the 'late thirties or early forties' and perimenopause starts 'mid-forties', a reader gets a stage-less interval. Align the two: either extend premenopause to 'the early-to-mid forties' or soften the perimenopause onset to 'typically the early-to-mid forties'. Both entries also correctly say the boundary is biological rather than calendar-defined, so the numeric hedges should at least not conflict.

---

### `retrograde-menstruation` — precision  ·  Part VI-D

**Field:** `body_html`  ·  **ref#254**

**Current:** Researchers have documented ectopic endometrial tissue in human female fetuses, examining 101 fetal specimens.<sup class="cite-ref"><a href="#ref-254">254</a></sup>

**Evidence:** Researchers have documented ectopic endometrial tissue in human female fetuses, examining 101 fetal specimens.

**Suggested fix:** The sentence gives the denominator (101 specimens) but not the numerator, which invites a reader to infer that ectopic tissue was a general finding across the series rather than present in a small minority. Signorile's 2012 J Cell Physiol paper reports it in only a few of the 101 fetuses. Add the proportion actually reported in the paper - 'documented in a small proportion of 101 human female fetal specimens'. IMPORTANT: I did not open the primary paper and am not asserting a specific count here; pull the exact numerator from Signorile 2012 before publishing a figure. The argument survives either way, because the embryologic-origin point rests on the finding existing at all, not on its frequ

---

### `vitamin-d` — precision  ·  Part VI-D

**Field:** `body_html`

**Current:** <strong>Vitamin D</strong> (25-hydroxyvitamin D) is a fat-soluble prohormone that functions as a steroid hormone

**Evidence:** <strong>Vitamin D</strong> (25-hydroxyvitamin D) is a fat-soluble prohormone that functions as a steroid hormone, regulating immune function, inflammation, and reproductive biology.

**Suggested fix:** Conflates three distinct species. Vitamin D (cholecalciferol/ergocalciferol) is the parent compound; 25-hydroxyvitamin D is the circulating storage metabolite that is measured to assess status; 1,25-dihydroxyvitamin D is the active hormone that binds the VDR. Equating 'Vitamin D' with '(25-hydroxyvitamin D)' in the opening definition is imprecise in an entry that then talks about receptor expression. Fix: 'Vitamin D is a fat-soluble prohormone. Status is assessed by measuring 25-hydroxyvitamin D, the circulating storage form; the active hormone, 1,25-dihydroxyvitamin D, binds vitamin D receptors and regulates immune function, inflammation, and reproductive biology.'

---

### `follicle-stimulation` — style_em_dash  ·  Part VII

**Field:** `body_html`

**Current:** Correcting the underlying metabolic cause -- such as insulin resistance in PCOS with an insulin sensitizer -- can restore spontaneous ovulation

**Evidence:** Correcting the underlying metabolic cause -- such as insulin resistance in PCOS with an insulin sensitizer -- can restore spontaneous ovulation without requiring dedicated ovulation-stimulation agents such as clomiphene or gonadotropins.

**Canon:** House rule: never use em dashes

**Suggested fix:** No true em dash character is present (scanned for U+2014 and U+2013: zero hits across all 12 Part VII terms), but this is the only term in the batch using a double hyphen as an em-dash stand-in, and it renders as a literal '--' on the published page. Replace with commas or a colon: 'Correcting the underlying metabolic cause, such as insulin resistance in PCOS with an insulin sensitizer, can restore spontaneous ovulation...'

---

### `follicle-stimulation` — dated_source  ·  Part VII

**Field:** `body_html`  ·  **ref#400**

**Current:** can restore spontaneous ovulation without requiring dedicated ovulation-stimulation agents such as clomiphene or gonadotropins.<sup class="cite-ref"><a href="#ref-400">400</a></sup>

**Evidence:** Correcting the underlying metabolic cause -- such as insulin resistance in PCOS with an insulin sensitizer -- can restore spontaneous ovulation without requiring dedicated ovulation-stimulation agents such as clomiphene or gonadotropins.<sup class="cite-ref"><a href="#ref-400">400</a></sup>

**Suggested fix:** Ref 400 is Costello MF, Eden JA, Fertil Steril 2003 - a 23-year-old systematic review that predates the letrozole evidence shift. My Perplexity check could not retrieve its conclusion verbatim and flagged the strong reading as unverified. The glossary's modal 'can restore' is defensible and I am NOT calling it an error, but ref 398 (Balen AH et al, Hum Reprod Update 2016, WHO guidance on anovulatory PCOS) is already in the reference set, is current, and would carry this sentence better. Suggest adding or substituting 398.

---

### `functional-nutritional-medicine` — unsupported_mechanism  ·  Part VII

**Field:** `body_html`

**Current:** it disrupts LH pulsatility, ovarian androgen production, and endometrial receptivity, yet it often goes undetected unless a clinician looks for it deliberately

**Evidence:** <a href="#insulin-resistance" class="gloss-xref">Insulin resistance</a> is a relevant example: it disrupts LH pulsatility, ovarian androgen production, and endometrial receptivity, yet it often goes undetected unless a clinician looks for it deliberately.

**Suggested fix:** Three mechanisms asserted, no citation on the sentence. Of the three, hyperinsulinemia augmenting ovarian androgen production and impaired endometrial receptivity are well supported; the direct 'disrupts LH pulsatility' link is the weakest and is entangled with PCOS rather than insulin resistance alone. HONEST NOTE: my Perplexity query on this declined to quote primary literature and I could not settle it - treat as unverified. Add a citation or drop the LH pulsatility clause.

---

### `nfp-medical-consultant` — precision  ·  Part VII

**Field:** `body_html`

**Current:** a physician who has completed formal postgraduate training in NaProTechnology through an accredited program

**Evidence:** completed formal postgraduate training in NaProTechnology through an accredited program.</strong> Training routes include the fellowship at the Pope Paul VI Institute for the Study of Human Reproduction and the AAFCP Medical Consultant program.

**Suggested fix:** 'Accredited program' is ambiguous on a public credentialing page and could be read as ACGME accreditation, which these programs do not hold. AAFCP accredits its own education programs. Suggest: 'through an AAFCP-accredited education program or the fellowship at the Pope Paul VI Institute for the Study of Human Reproduction.' Precision here is consistent with the same care already applied to MIGS credential language elsewhere.

---

### `reproductive-endocrinology` — completeness  ·  Part VII

**Field:** `body_html`

**Current:** Key hormones in this evaluation include FSH, LH, TSH, and hCG, each interpretable only within the context of the cycle phase at the time of the draw.

**Evidence:** Key hormones in this evaluation include <a href="#fsh" class="gloss-xref">FSH</a>, <a href="#lh" class="gloss-xref">LH</a>, <a href="#tsh" class="gloss-xref">TSH</a>, and <a href="#hcg" class="gloss-xref">hCG</a>, each interpretable only within the context of the cycle phase at the time of the draw.

**Suggested fix:** The list omits progesterone and estradiol, which are the two analytes whose interpretation is most cycle-phase dependent and which are the backbone of RRM cycle-timed hormone panels. hCG is also the odd inclusion here: outside pregnancy detection and hCG-trigger use it is not a cycle-phase-interpreted evaluation hormone, so it weakens the sentence's own point. Suggest: progesterone, estradiol, FSH, LH, TSH, prolactin.

---

### `reproductive-immunology` — overreach  ·  Part VII

**Field:** `body_html`  ·  **ref#65**

**Current:** microbial imbalance in the uterine environment correlates with implantation outcomes independent of structural pathology.<sup class="cite-ref"><a href="#ref-65">65</a></sup>

**Evidence:** The endometrial microbiome is an adjacent area of investigation: microbial imbalance in the uterine environment correlates with implantation outcomes independent of structural pathology.<sup class="cite-ref"><a href="#ref-65">65</a></sup>

**Suggested fix:** Ref 65 (Moreno I et al, Am J Obstet Gynecol 2016;215(6):684-703) reports that non-Lactobacillus-dominated endometrial microbiota associates with reduced implantation, pregnancy and live birth in an IVF population. It does not test or establish independence from structural pathology. Drop the phrase 'independent of structural pathology' or replace with 'in women without identified structural pathology' only if the cohort actually supports that.

---

### `adhesion-prevention` — single_source_dependency  ·  Part VIII

**Field:** `body_html`  ·  **ref#80**

**Current:** A multi-component approach is the standard in restorative pelvic surgery. ... Anti-adhesion barriers provide a second layer of protection ... Published NaProTechnology surgical series document progressive reduction in adhesion scores over decades of systematic barrier use

**Evidence:** Excision is preferred over fulguration precisely because it removes lesions with defined margins rather than burning and leaving devitalized tissue behind.<sup class="cite-ref"><a href="#ref-80">80</a></sup>

**Suggested fix:** All three substantive paragraphs - surgical technique as primary determinant, the barrier-product classes, and the adhesion-score reduction - rest on one reference (ref 80, Hilgers TW, Stanford JB, Boyle PC et al., J Gynecol Surg 2010). That is the right source for the NaProTechnology series claim, but the barrier-class and technique claims are general surgical standards that deserve an independent citation so the entry is not answering 'says who?' with a single RRM-internal paper. Add a Cochrane or ESHRE/AAGL adhesion-prevention reference alongside ref 80 for those two paragraphs only.

---

### `antioxidant-therapy` — source_quality  ·  Part VIII

**Field:** `reference ref-58`  ·  **ref#58**

**Current:** 58 | Impact of Oxidative stress on Infertility. | Global Journal of Fertility Research | https://www.reprodgroup.us/articles/GJFR-4-112.php

**Evidence:** In female reproductive health, oxidative stress is implicated in endometriosis progression, oocyte quality decline, and luteal phase dysfunction. Antioxidant support targets these mechanisms at the cellular level.<sup class="cite-ref"><a href="#ref-57">57</a></sup><sup class="cite-ref"><a href="#ref-58">58</a></sup>

**Suggested fix:** Ref 58 is published by reprodgroup.us ('Global Journal of Fertility Research'), a non-indexed open-access venue with predatory characteristics - it is not PubMed-indexed and carries no PMID or DOI in the reference row, unlike every other source in this entry. Replace it with a source already in the RRM library, surfaced by rrm-cli: de Ligny W, Smits RM, Mackenzie-Proctor R et al., 'Antioxidants for male subfertility', Cochrane Database Syst Rev 2022 (rrmacademy.org/library/antioxidants-for-male-subfertility-recfw3dyog0wvgtmb). Adding the Cochrane review also lets the entry state the evidence grade honestly, since it is the standard authority a sceptical clinician will check first.

---

### `gonadotropins` — missing_citation  ·  Part VIII

**Field:** `body_html`

**Current:** (entire entry, zero <sup class="cite-ref"> citations; word_count is null)

**Evidence:** <p><strong>Gonadotropins</strong> are protein hormones that regulate gonadal function. In the clinical fertility context, the term commonly refers to injectable preparations used for ovulation induction or ovarian stimulation: recombinant FSH (follitropin alfa/beta) and human menopausal gonadotropin (hMG, containing FSH and LH activity).

**Suggested fix:** Two hygiene defects in one row. (1) The entry carries no citations at all despite making pharmacological and clinical-practice claims - add at least a source for the OHSS-risk and mild-stimulation statements (ref 95, the ASRM prevention guideline, is already in the reference set). (2) word_count is NULL on this row and on the three that follow it (iirrm, progestin-vs-progesterone, progestins), while all fifteen earlier Part VIII rows have it populated - the four terms appear to have been inserted by a different path that skipped the word_count computation. Backfill it. Also: 'hMG' is introduced as an abbreviation with no glossary_abbreviation row (FSH and LH both have rows); either add one o

---

### `hrt` — clinical_precision  ·  Part VIII

**Field:** `body_html`  ·  **ref#73**

**Current:** A 32-year-old with POI who has no functional ovarian estrogen production faces accelerated bone loss, cardiovascular risk, and neurological consequences without treatment.

**Evidence:** The clinical context matters. A 32-year-old with POI who has no functional ovarian estrogen production faces accelerated bone loss, cardiovascular risk, and neurological consequences without treatment.

**Suggested fix:** Stated as a specific hypothetical it is defensible, but readers will generalise it, and POI is not ovarian failure: intermittent ovarian function occurs in roughly half of women with POI and spontaneous pregnancy occurs in about 5%. Ref 73 (Panay N et al., 'Evidence-based guideline: premature ovarian insufficiency', Climacteric 2024) is explicit on this and is already cited in the term. Reword to 'A 32-year-old with POI and persistently low estrogen faces...' and, since RRM readers include women hoping to conceive, add the guideline's point that POI does not always mean permanent loss of ovarian function.

---

### `icsi` — numeric_precision  ·  Part VIII

**Field:** `body_html`  ·  **ref#372**

**Current:** reaching 60-74% of non-male-factor cycles in the U.S. by 2015

**Evidence:** ICSI use increased significantly during 2000-2015 in states both with and without a mandate; however, for non-male-factor infertility cycles, the percentage increase in ICSI use was greater among nonmandate states (34.6% in 2000 to 73.9% in 2015) versus mandate states (39.5% in 2000 to 63.5% in 2015).

**Suggested fix:** The claim is directionally right and the reference is correct (ref 372 = Dieke AC et al., Fertil Steril 2018;109(4):691-697, PMID 29580644 confirmed via NCBI esummary), but the stated range rounds the lower bound down by three and a half points and drops the variable that generates the range. Tighten to '63.5% of non-male-factor cycles in states with an insurance mandate and 73.9% in states without, by 2015' - the mandate split is the more interesting fact and it is what the paper actually reports.

---

### `icsi` — style_double_hyphen  ·  Part VIII

**Field:** `body_html`

**Current:** ICSI is now used in the majority of IVF cycles without a male-factor diagnosis -- reaching 60-74% of non-male-factor cycles in the U.S. by 2015 -- a scope well beyond the male infertility problem it was designed to address.

**Evidence:** ICSI is now used in the majority of IVF cycles without a male-factor diagnosis -- reaching 60-74% of non-male-factor cycles in the U.S. by 2015 -- a scope well beyond the male infertility problem it was designed to address.

**Canon:** House style: never use em dashes

**Suggested fix:** No literal em dash is present (I scanned all 19 bodies for U+2014, U+2013, &mdash; and &#8212; and found none), but this is the only term in Part VIII using '--' as a parenthetical dash, and it renders as two literal hyphens on the page. Recast as a comma-bounded clause or parentheses: 'ICSI is now used in the majority of IVF cycles without a male-factor diagnosis, reaching 63.5% to 73.9% of non-male-factor cycles in the U.S. by 2015, a scope well beyond...'.

---

### `iirrm` — missing_citation  ·  Part VIII

**Field:** `body_html`

**Current:** Founded in London, UK in 2000, it is registered as a Charitable Incorporated Organisation (CIO) in England and Wales. With members across more than 50 countries, the IIRRM promotes evidence-based RRM practice, establishes professional standards, and sponsors research, including the STORRM outcomes registry conducted in collaboration with the University of Utah.

**Evidence:** Founded in London, UK in 2000, it is registered as a Charitable Incorporated Organisation (CIO) in England and Wales.

**Suggested fix:** Every institutional fact here is verifiable and every one of them checked out, but none is cited - which is a weakness in an entry whose whole job is to establish that a professional body exists and is real. Add the UK Charity Commission register entry (registered charity number 1189777, CIO registration 4 June 2020 per the Charity Commission listing) and an iirrm.org About link. That also resolves an implicit ambiguity: founded 2000, but constituted as a CIO only in 2020, so the sentence as written can be misread as claiming CIO status since 2000. Consider 'Founded in London in 2000 and registered as a Charitable Incorporated Organisation in England and Wales'. Minor: 'CIO' is introduced as

---

### `iirrm` — canonical_name  ·  Part VIII

**Field:** `body_html`

**Current:** including <a href="/naprotechnology/">NaProTechnology</a>, NeoFertility, and FEMM.

**Evidence:** The institute provides educational programming and brings together clinicians and researchers who practice across the range of restorative reproductive medicine approaches, including <a href="/naprotechnology/">NaProTechnology</a>, NeoFertility, and FEMM.

**Canon:** RRM canonical names

**Suggested fix:** Not an error - IIRRM, STORRM, NaProTechnology, NeoFertility and FEMM are all rendered canonically here, and 'IIRRM' and 'STORRM' in particular are correct where the common drifts are 'IRRM' and 'STORM'. Logged only to record that this entry uses 'NaProTechnology' while napro-vs-rrm and gonadotropins use 'NaProTECHNOLOGY'; resolving that casing choice glossary-wide (see the napro-vs-rrm P3) will touch this row.

---

### `iui` — missing_citation  ·  Part VIII

**Field:** `body_html`

**Current:** Per-cycle pregnancy rates vary substantially by age, sperm parameters, and underlying cause.

**Evidence:** Indications include donor sperm use, mild <a href="#male-factor-infertility" class="gloss-xref">male factor infertility</a>, <a href="#cervical-factor-infertility" class="gloss-xref">cervical factor infertility</a>, and some cases of undiagnosed subfertility. Per-cycle pregnancy rates vary substantially by age, sperm parameters, and underlying cause.

**Suggested fix:** The entire 255-word, three-paragraph entry carries zero <sup class="cite-ref"> citations, unlike every neighbouring ART-family term (ivf, icsi, ohss, art all cite). Add at least one source for the indications and per-cycle pregnancy-rate statements, and one for the RRM position that IUI is not employed. Candidate already in the RRM library: Keefe CE, Mirkes R, Yeung PP Jr, 'The Evaluation and Treatment of Cervical Factor Infertility: A Medical-Moral Analysis', Linacre Q 2012 (rrmacademy.org/library/the-evaluation-and-treatment-of-cervical-factor-infertility-a-medical-moral-anal-recdkvjhcuigoqnsb), surfaced by rrm-cli.

---

### `iui` — abbreviation_inconsistency  ·  Part VIII

**Field:** `abbreviation`

**Current:** null

**Evidence:** {'abbreviation': 'IUI', 'full_term': 'Intrauterine Insemination', 'term_slug': 'iui'}

**Suggested fix:** A glossary_abbreviation row exists for IUI pointing at this slug and matches the parenthetical in the term name, but the term row's own abbreviation column is NULL. Sibling terms icsi, ohss, art, oral-contraceptive, iud and hrt all populate it; ivf has the same NULL. Backfill abbreviation='IUI' on this row and 'IVF' on the ivf row so the abbreviation index and the term records agree.

---

### `ivf-vs-rrm` — duplicate_reference  ·  Part VIII

**Field:** `body_html`  ·  **ref#93**

**Current:** Published NaProTechnology cohort data document clinically meaningful take-home baby rates across couples with long infertility durations, advanced maternal age, and prior failed ART.<sup class="cite-ref"><a href="#ref-14">14</a></sup><sup class="cite-ref"><a href="#ref-93">93</a></sup>

**Evidence:** 14 | NaProTechnology for infertility: take-home baby rate and clinical outcomes in a 5-year single-center cohort. | PubMed | https://pubmed.ncbi.nlm.nih.gov/41323405/ ... 93 | Natural procreative technology (NaProTechnology) for infertility: take-home baby rate and clinical outcomes in a 5-year single-center cohort of 1,310 couples | Frontiers in Reproductive Health | https://pmc.ncbi.nlm.nih.gov/articles/PMC12660242/

**Suggested fix:** Refs 14 and 93 are the same paper (Sanchez-Mendez 2025, Front Reprod Health) reached by two routes - PubMed 41323405 and PMC12660242 - and are cited back to back as if two independent cohorts. Merge into a single reference row (prefer the PMC/journal record, which carries the full title and the n=1,310) and update every citation that points at the retired number. The same duplication pattern exists at refs 193/374 (AUA/ASRM guideline in J Urol and Fertil Steril).

---

### `napro-vs-rrm` — style_consistency  ·  Part VIII

**Field:** `body_html`  ·  **ref#1**

**Current:** NaProTECHNOLOGY (NaPro) is the most established and extensively studied approach within Restorative Reproductive Medicine,

**Evidence:** <strong><a href="/naprotechnology/">NaProTECHNOLOGY</a> (NaPro) is the most established and extensively studied approach within Restorative Reproductive Medicine,</strong>

**Canon:** RRM canonical name: NaProTechnology

**Suggested fix:** Part VIII mixes three casings of the same mark: 'NaProTECHNOLOGY' (this term, gonadotropins), 'NaProTechnology' (ivf, adhesion-prevention, iirrm), and the canon form. Pick one house casing (canon list says NaProTechnology) and normalise across the glossary, or record NaProTECHNOLOGY as the deliberate trademark rendering in the style guide so the lint stops treating it as drift. Separately, the superlative 'most established and extensively studied' is carried by ref 1 (IIRRM 'What is RRM?' landing page), which is a general definitional page; consider anchoring the superlative to a cohort-count source instead.

---

### `ohss` — mechanism_precision  ·  Part VIII

**Field:** `body_html`  ·  **ref#62**

**Current:** in which pharmacologically elevated gonadotropin levels cause the ovaries to produce an excessive number of follicles, triggering systemic vascular and fluid changes

**Evidence:** Ovarian hyperstimulation syndrome (OHSS) is an iatrogenic complication of ovarian stimulation protocols used in ART, in which pharmacologically elevated gonadotropin levels cause the ovaries to produce an excessive number of follicles, triggering systemic vascular and fluid changes that range in severity from mild bloating to life-threatening thromboembolism.

**Suggested fix:** The lead definition skips the proximate trigger. Multifollicular recruitment sets up the risk, but the syndrome is precipitated by hCG exposure driving VEGF-mediated capillary permeability - which is why withholding the hCG trigger prevents it and why the condition can worsen with an implanting pregnancy. Add one clause: '...produce an excessive number of follicles, which on exposure to hCG release vascular endothelial growth factor and other mediators that make capillaries leaky, triggering the systemic vascular and fluid changes...'. This also explains the late-onset form, which the current text has no way to account for.

---

### `ohss` — outdated_source  ·  Part VIII

**Field:** `reference ref-62`  ·  **ref#62**

**Current:** 62 | ASRM Practice Committee. Ovarian hyperstimulation syndrome. Fertil Steril. 2003.

**Evidence:** 62 | ASRM Practice Committee. Ovarian hyperstimulation syndrome. Fertil Steril. 2003. | Fertility and Sterility | https://rrmacademy.org/library/ovarian-hyperstimulation-syndrome-recwglgkt0fw2lwbx/

**Suggested fix:** The lead definition rests on a 2003 ASRM practice committee document, superseded twice since. The current guideline is already in the reference set as ref 95 ('Prevention of moderate and severe ovarian hyperstimulation syndrome: a guideline', PMID 38099867). Either move the definitional citation to ref 95 or keep ref 62 only for the historical grading system and add ref 95 alongside it.

---

### `oral-contraceptive` — incomplete_risk_disclosure  ·  Part VIII

**Field:** `body_html`  ·  **ref#71**

**Current:** Documented risks associated with OC use include venous thromboembolism, mood and libido changes, and effects on bone mineral density and cardiovascular markers.

**Evidence:** Documented risks associated with OC use include venous thromboembolism, mood and libido changes, and effects on bone mineral density and cardiovascular markers. The magnitude of risk varies by formulation, duration of use, and individual factors. These risks are supported by published evidence and deserve clear disclosure as part of any informed prescribing conversation.

**Suggested fix:** The paragraph explicitly frames itself as the informed-consent disclosure list, then omits the two risks most likely to matter to a reader weighing long-term use: the small increase in breast cancer risk during current use, and cervical cancer risk with long duration of use. Both are in the IARC assessment and both are covered in ref 71 (Williams WV et al., 'Hormonally Active Contraceptives Part I: Risks Acknowledged and Unacknowledged', Linacre Q 2021), which is already the citation on this sentence. Add them, with the same 'magnitude varies' calibration already used. Leaving them out of a list that advertises itself as complete is the kind of gap a critic reads as selective.

---

### `patient-centered-care` — missing_citation  ·  Part VIII

**Field:** `body_html`

**Current:** The framework identifies several interconnected dimensions of care quality: respecting patient preferences, providing emotional support, ensuring access to information, involving family and close partners, and maintaining continuity across the care team.

**Evidence:** The framework identifies several interconnected dimensions of care quality: respecting patient preferences, providing emotional support, ensuring access to information, involving family and close partners, and maintaining continuity across the care team.

**Suggested fix:** The sentence says 'The framework' as if a specific named framework has been introduced, but none is named and no citation follows. The five dimensions listed are the Picker Institute / IOM 'Crossing the Quality Chasm' dimensions, which ESHRE adapted for fertility care (Dancet EA et al., 'The patients' perspective on fertility care: a systematic review', Hum Reprod Update 2010). Name the framework and cite it. Doing so also strengthens the RRM alignment argument that follows, because the ESHRE version is the one fertility clinicians already recognise.

---

### `progestin-vs-progesterone` — missing_citation  ·  Part VIII

**Field:** `body_html`

**Current:** Because progestins differ structurally from natural progesterone, they bind not only progesterone receptors but also androgen, glucocorticoid, and mineralocorticoid receptors, producing off-target effects that include mood changes, libido reduction, and metabolic alterations.

**Evidence:** Because progestins differ structurally from natural progesterone, they bind not only progesterone receptors but also androgen, glucocorticoid, and mineralocorticoid receptors, producing off-target effects that include mood changes, libido reduction, and metabolic alterations.

**Suggested fix:** The entry carries zero citations while making specific receptor-pharmacology and clinical-outcome claims, and it is the term a sceptical clinician is most likely to arrive at from a search for 'is bioidentical progesterone different'. Add a receptor-binding-profile reference (Stanczyk's comparative progestin pharmacology work is the standard) and a clinical-outcome reference for the preference in luteal support. The claims themselves check out; they are just unsupported on the page.

---

### `progestins` — missing_citation  ·  Part VIII

**Field:** `body_html`

**Current:** which Hilgers frames as the difference between isomolecular hormones and heteromolecular artimones ... on the basis of differing receptor pharmacology, breast cancer risk profiles, and pregnancy safety data.

**Evidence:** <a href="#restorative-reproductive-medicine" class="gloss-xref">Restorative Reproductive Medicine</a> draws a sharp clinical and ethical distinction between progestins and bioidentical progesterone, which Hilgers frames as the difference between isomolecular hormones and heteromolecular artimones.

**Suggested fix:** Two uncited load-bearing claims. (1) The isomolecular/heteromolecular 'artimone' framing is attributed to Hilgers by name with no source - cite the specific Hilgers text so readers encountering the coined term 'artimone' for the first time can trace it, otherwise it reads as invented. (2) 'breast cancer risk profiles' asserts a differential between micronized progesterone and synthetic progestins - a real and defensible finding from the large European cohort literature, but a contested one that needs its source on the page rather than as an unsupported clause. The entry carries no citations at all.

---

## Citation accessibility (orchestrator, deterministic)

All 347 reference URLs and every distinct `pillar_link` were probed. **Zero are broken.** An initial sweep that spoofed AI-crawler user-agent strings produced seven false positives (iirrm.org, SSMR, WHO/iris, RHRI, neofertility.ie, AAGL, JRRM); a spoofed bot UA from an ordinary IP is exactly what WAFs reject, so it measures UA-spoof rejection rather than crawler policy. The corrected test uses a full browser-shaped request plus the host's own robots.txt.

These refs are reachable by people but their publishers disallow AI crawlers in robots.txt, so an AI answering a question cannot follow the citation:

| ref | host | disallows |
|---|---|---|
| #17 | www.acog.org | CCBot, ChatGPT-User, ClaudeBot, GPTBot, Google-Extended, anthropic-ai |
| #25 | www.nature.com | CCBot, ChatGPT-User, Claude-Web, ClaudeBot, GPTBot, Google-Extended, PerplexityBot, anthropic-ai |
| #27 | www.endonews.com | CCBot, ClaudeBot, GPTBot, Google-Extended |
| #51 | onlinelibrary.wiley.com | GPTBot, Google-Extended |
| #133 | femmhealth.org | CCBot, ClaudeBot, GPTBot, Google-Extended |

## Structural findings (orchestrator, deterministic)

| sev | count | category |
|---|---|---|
| P1 | 9 | protocol_leak |
| P2 | 49 | abbreviation_full_term_mismatch |
| P2 | 18 | abbreviation_missing_row |
| P3 | 23 | canonical_name |
| P3 | 22 | abbreviation_undocumented |
| P3 | 4 | orphan_reference |

- Orphan references (cited by no published term): [9, 66, 67, 248]
- Terms with no `pillar_link`: **225** of 230

Highest-blast-radius references — a URL or anchor swap here cascades to every citing term, so prefer minting a new ref over editing in place:

| ref | cited by | source |
|---|---|---|
| #78 | 27 terms | https://rrmacademy.org/library/the-medical-surgical-practice-of-naprotechnology- |
| #44 | 13 terms | https://pmc.ncbi.nlm.nih.gov/articles/PMC4436586/ |
| #87 | 12 terms | https://rrmacademy.org/library/optimizing-natural-fertility-a-committee-opinion- |
| #3 | 12 terms | https://pmc.ncbi.nlm.nih.gov/articles/PMC8265110/ |
| #89 | 11 terms | https://rrmacademy.org/library/the-importance-of-fertility-awareness-in-the-asse |
| #1 | 10 terms | https://iirrm.org/what-is-rrm/ |
| #74 | 9 terms | https://rrmacademy.org/library/cervical-mucus-the-biological-marker-of-fertility |
| #6 | 9 terms | https://pmc.ncbi.nlm.nih.gov/articles/PMC12270466/ |

## Appendix — findings dropped by adversarial verification

Reported by a reviewer, then refuted on independent re-derivation. Recorded so the same false positive is not re-raised next cycle.

- `couple-based-treatment` / citation_mismatch — Quote check PASSES on the glossary side: the sentence and its ref-193 superscript appear verbatim in couple-based-treatment body_html. The finding itself is REFUTED on the source side. I fetched the full AUA/ASRM guideline text directly rather than relying on 
- `gonadotropins` / protocol_leak — QUOTE CHECK PASSES. The current_value and evidence_quote both appear verbatim in body_html of the gonadotropins entry in /tmp/glossary-review/terms-part-VIII.json, anchor tags included. The finding is not refuted on misquote. It is refuted on the merits.

1) T
- `fulguration-ablation` / evidence_overstatement — Quote confirmed verbatim in terms-part-V.json. The finding concedes the numbers are accurate and rests entirely on the design label, alleging the source is 'not a cohort study'. That allegation is refuted by the primary abstract, which I retrieved directly via
- `pelvic-excision-and-repair-surgery` / protocol_leak — Quote verified verbatim in terms-part-V.json. Refuted on two independent grounds. First, canon drift. The rule triggers on dosing schedules, mg amounts, cycle-day timing, drug lists in 'Treatment includes X, Y, Z' form, and protocol-specific percentages. The p
- `d-chiro-inositol` / mechanism_error — Quote check: the current_value appears verbatim. But the finding's diagnosis is wrong, and its suggested fix would inject a mis-citation into the glossary.

The finding asserts the entry "applies the wrong half to hyperandrogenism" and that reduced myo-inosito
