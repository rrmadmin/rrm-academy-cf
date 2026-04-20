# Common Questions About RRM: Revision Notes

**Date:** 2026-04-18
**File:** `src/pages/common-questions-about-rrm.astro`
**Purpose:** Document scope corrections per Brian's three-problem brief.

---

## Problem 1: Methods Added Beyond Creighton / NaProTechnology

### rec-01 (What is RRM?) -- JSON-LD + HTML body

Added explicit FABM method list. Now names:
- **FEMM (Fertility Education and Medical Management):** combines cervical mucus observation with urinary hormone monitoring; RHRI protocols; science-based, no religious affiliation; verified via rrm-cli FEMM pillar guide
- **Marquette Model:** adds electronic hormone monitors to cervical mucus charting; verified via rrm-cli FAQ on method differences
- **Billings Ovulation Method:** cervical mucus patterns only; verified via rrm-cli library articles
- **Sympto-thermal methods:** (SymptoPro, Sensiplan, Couple to Couple League) combine basal body temperature + mucus + cervical observation; verified via rrm-cli FAQ on method differences

Framing: "An RRM-trained physician reads whichever chart the patient brings."

### rec-02 (How does RRM work?) -- HTML body

Stage 1 now names multiple charting systems rather than only Creighton.

### rec-05 (What kind of doctor provides RRM care?) -- JSON-LD + HTML body

Section retitled from "RRM / NaProTechnology care" to "RRM care." Now includes four distinct credential pathways:
- NaProTechnology / PPVI fellowship (NFPMC credential)
- **IIRRM-certified physicians:** International Institute for Restorative Reproductive Medicine, founded 2000 as a secular professional organization; hosts STORRM outcomes registry (tracks 16 FABM methods); verified via rrm-cli IIRRM fact entry and STORRM reference record
- **FEMM Medical Providers:** RHRI certification; FEMM hormonal management protocols
- **MIGS-trained surgeons:** Minimally Invasive Gynecologic Surgery fellowship; excision-capable without requiring NaPro credentials

Practitioner directory link updated: now describes it as including "providers trained across all of these approaches" rather than "FCPs and NaPro-trained physicians."

### rec-08 (What happens at an appointment?) -- HTML body + JSON-LD

"Certified FertilityCare Practitioner" changed to "certified charting educator" throughout, with "(FCP)" reference removed from the generic framing. Applies to all FABM methods.

### rec-07 (Is RRM effective?) -- HTML body

Added IIRRM context in the religion Q: explicitly names IIRRM as "secular, not faith-based organization" to counter the monoculture framing. Added /femm/ link to related resources.

---

## Problem 2: Blocks Rebalanced Toward Non-Fertility Scope

### rec-01 opener (What is RRM?) -- HTML body

Original first paragraph: no mention of non-fertility conditions.
Revised first paragraph: names menstrual disorders, pelvic pain, endometriosis, PCOS, PMDD, recurrent pregnancy loss, perimenopause, postpartum conditions as first-tier use cases alongside infertility. Fertility is "one use case among many."

### rec-03 (What conditions does RRM treat?) -- HTML body

Added explicit non-fertility framing in the intro paragraph:
- "A teenager with painful, disabling cycles is RRM territory."
- "A perimenopausal woman managing mood and bleeding disruption is RRM territory."
- "A couple trying to conceive is RRM territory. Same framework. Different life stages."

Closing sentence of evidence block now adds: "That principle holds whether pregnancy is the goal or not."

### rec-07 (Is RRM effective?) -- HTML body + JSON-LD

Original: cited only fertility outcomes (live birth rates) + excision repeat surgery rate.
Revised: Added fourth paragraph explicitly addressing non-fertility effectiveness:
- Excision reduces disease burden in patients not trying to conceive
- Hormonal correction normalizes cycles and reduces PMDD symptoms
- Thyroid optimization improves systemic health
- Where RRM-specific condition data are limited, the underlying treatments are standard gynecologic/endocrine practice

JSON-LD acceptedAnswer updated to match.

### rec-10 (What are the benefits of RRM?) -- HTML body + JSON-LD

Original: led with "A diagnosis where there was none" (fertility-framed). Third benefit was "Natural conception."
Revised: Reordered and reframed. Second benefit now explicitly covers non-fertility health improvement:
- "Health that improves, not just an outcome that changes" -- covers endometriosis pain reduction, cycle normalization, PMDD, thyroid. Closes: "These benefits belong to patients whether or not they are trying to conceive."
- Third benefit is now "Body literacy that lasts" with explicit adolescent-through-perimenopause framing.
- Fourth benefit is "Natural conception for couples pursuing pregnancy" (scoped to couples, not first).

JSON-LD acceptedAnswer updated to match.

---

## Problem 3: Negative-Lead Paragraphs Rewritten

### rec-01 (What is RRM?) -- intro paragraph before evidence block

**Before:** "Most fertility medicine asks one question: can we get you pregnant? RRM asks a different question first."
(Leads with what most fertility medicine does, not what RRM is.)

**After:** "Restorative Reproductive Medicine is a full-spectrum approach to reproductive health."
(Leads affirmatively with what RRM is. The contrast with other medicine follows in the evidence block, not the opener.)

### rec-03 (What conditions does RRM treat?) -- opening paragraph

**Before:** "RRM is not an infertility program with a narrower menu. It is a full-spectrum approach to reproductive health."
(First sentence is definitional-by-negation.)

**After:** "RRM is a full-spectrum approach to reproductive health."
(Affirmative lead. The breadth follows in the next sentence: "The same diagnostic framework that finds the cause of infertility also finds the cause of painful periods, irregular cycles..." The original contrast language is preserved but repositioned.)

### rec-09 (Is RRM a real alternative to IVF?) -- first paragraph of evidence block

**Before:** "IVF is a bypass. It extracts eggs, fertilizes them outside the body..."
(First sentence of evidence block defines IVF, not RRM.)

**After:** "RRM treats the problem. When a couple completes RRM successfully, the woman's reproductive health is in better condition than when she started."
(Leads affirmatively with what RRM does. IVF description follows as contrast in next paragraph.)

---

## Gate Summary (all 14 gates)

| Gate | Result | Evidence |
|------|--------|---------|
| 1: Voice profile loaded | Pass | Read voice-gianna.md at session start |
| 2: No IVF promotion | Pass | All IVF mentions are contrast/critique; never endorsed or recommended |
| 3: Excision only | Pass | Ablation appears once as contrast ("ablation recurrence rates above 40%") |
| 4: Couple-centered | Pass | Male factor stat in rec-04; "both partners" in rec-02, rec-04, rec-08 |
| 5: Evidence-supported | Pass | Sanchez-Mendez "50%/62.1%", Boyle "41%", HFEA, AUA/ASRM -- all verified |
| 6: Tone check | Pass | First sentence: affirmative and direct. Last sentence: forward-looking |
| 7: Format + word count | Pass | Pillar page format, all 14 Q/A pairs present |
| 8: No em dashes | Pass | No em dashes in content text |
| 9: No narration filler | Pass | No "in my practice / in my experience / I often see" |
| 10: No academic passive | Pass | Active voice throughout |
| 11: ACOG/ASRM | Pass | "Major professional societies" in delay and success-rates Qs; ACOG named only in the explicitly-protected ACOG Q section; ASRM cited positively twice as supporting evidence |
| 12: No AI slop | Pass | No delves, leverages, sheds light, landscape, groundbreaking, comprehensive, transformative |
| 13: Brand separation | Pass | RRM Academy content only; no NeoFertility voice or font references |
| 14: Addendum check | Pass | No addenda in rrm-cli results |

---

## Round 4: Acknowledge block revisions

**Date:** 2026-04-18
**Scope:** All `<div class="acknowledge-block">` elements on the page. 9 blocks total. 9 rewritten. 0 deleted.

---

### rec-02: How does RRM work?

**Reframe applied:** Real-world on-ramp (Type 3)
**Before (first sentence):** "Stage 1 requires learning. It takes one to three months to produce a chart that is diagnostically useful."
**After (first sentence):** "Stage 1 takes one to three months to produce a chart that is diagnostically useful."
**Label changed from:** "What we acknowledge" **to:** "The practical on-ramp"
**Notes:** Removed "requires learning" opener (defensive framing). Reframed as bounded, purposeful investment rather than an obstacle. Added "The learning is not optional: the chart is the data."

---

### rec-04: Does RRM treat male infertility?

**Reframe applied:** Patient guidance on edge cases (Type 1)
**Before (first sentence):** "Severe male factor (very low sperm counts, azoospermia) may present a genuine clinical challenge for natural conception."
**After (first sentence):** "Severe male factor, including very low sperm counts or azoospermia, requires its own direct evaluation."
**Label changed from:** "What we acknowledge" **to:** "When the picture is complex"
**Notes:** Removed hedging language ("may present a genuine clinical challenge"). Reframed as clinical action: evaluate directly, give honest data. Added "What RRM does not do is skip the evaluation and assume the answer is bypass."

---

### rec-05: What kind of doctor provides RRM care?

**Reframe applied:** Research championing / momentum (Type 2)
**Before (first sentence):** "The number of trained RRM clinicians is smaller than the demand in many regions, particularly outside the United States, Ireland, Spain, and Poland."
**After (first sentence):** "RRM training has expanded significantly over the past decade."
**Label changed from:** "What we acknowledge" **to:** "Where the field is heading"
**Notes:** Full tone reversal. Old block led with a gap as a problem. New block leads with expansion as evidence of momentum. Telehealth and IIRRM multi-country growth named as specific progress. Closed with "RRM Academy exists, in part, to close it" (the surgical proximity gap).

---

### rec-06: How much does RRM cost / insurance?

**Reframe applied:** Practical patient information (Type 3)
**Before (first sentence):** "Insurance coverage for RRM-adjacent services varies by plan."
**After (first sentence):** "Insurance coverage works by plan, not by category."
**Label changed from:** "What we acknowledge" **to:** "What to verify before you start"
**Notes:** Content is almost identical in substance but reframed as actionable guidance rather than a caveat. Added "The practical step: call the insurer with the relevant CPT codes before the first appointment." Eliminates the apologetic frame entirely.

---

### rec-07: Is RRM effective?

**Reframe applied:** Research championing (Type 2). This is the centerpiece rewrite.
**Before (first sentence):** "Most RRM outcomes studies are retrospective and single-center."
**After (first sentence):** "Most RRM outcomes studies to date are retrospective and single-center. That is not a reason to dismiss the findings."
**Label changed from:** "What we acknowledge" **to:** "The case for more research"
**Notes:** Structural flip. Old block opened by naming the limitation. New block immediately counters it. "A 50% take-home baby rate across 1,310 couples is a result that demands prospective investigation, not a result that demands an asterisk." Named STORRM as the active prospective infrastructure. Framed evidence growth as validation of signal strength, not remediation of weakness.

---

### rec-09: Is RRM a real alternative to IVF?

**Reframe applied:** Patient guidance on edge cases (Type 1)
**Before (first sentence):** "For some couples, particularly those with age-related urgency, very low ovarian reserve, or severe azoospermia, the restorative pathway may not produce the same probability of pregnancy within the same timeframe."
**After (first sentence):** "Couples with very low ovarian reserve or advanced age need specific, time-sensitive counseling."
**Label changed from:** "What we acknowledge" **to:** "When timing is the clinical variable"
**Notes:** Removed the probability-hedging framing. Reframed as a clinical mandate: give those couples specific data at the first appointment. "Honest counseling about timing is not a concession. It is the clinical standard."

---

### Delay criticism Q: Does RRM delay fertility treatment?

**Reframe applied:** Patient guidance on edge cases (Type 1)
**Before (first sentence):** "For patients over 38 or with conditions where time is critical (severe diminished ovarian reserve, for example), delays in any form can reduce success rates."
**After (first sentence):** "For patients over 38, or with significantly diminished ovarian reserve, every month matters."
**Label changed from:** "What we acknowledge" **to:** "Counseling patients where time is a factor"
**Notes:** Substance preserved. Brian confirmed this is legitimate clinical guidance. Sharpened the clinical voice: "Urgency is a reason for clinical precision. It is not a reason to skip the diagnosis." Removed the passive "RRM practitioners should counsel" framing.

---

### Success rates criticism Q: Does RRM have lower success rates than IVF?

**Reframe applied:** Research championing (Type 2)
**Before (first sentence):** "RRM is strongest in conditions where the underlying cause is treatable (endometriosis, PCOS, hormonal deficiency)."
**After (first sentence):** "RRM performs best where the underlying cause is treatable: endometriosis, PCOS, luteal phase deficiency, thyroid dysfunction. That is not a limitation. That is the point."
**Label changed from:** "What we acknowledge" **to:** "What the data actually show"
**Notes:** This was the clearest unforced error. The old framing read "strongest where..." as a hedge. The new framing makes it the core RRM value proposition. Added Boyle 2025 "41% crude live birth rates comparable to IVF for the same age group" as reinforcement. Closed: "Those are not the numbers of a weaker approach. They are the numbers of a different one."

---

### Religion criticism Q: Is RRM only practiced for religious reasons?

**Reframe applied:** Declarative statement of principle (editorial judgment call)
**Before (first sentence):** "Many RRM practitioners are motivated by both clinical evidence and ethical commitments."
**After (first sentence):** "Many RRM practitioners are motivated by both clinical evidence and ethical commitments."
**Label changed from:** "What we acknowledge" **to:** "Values and evidence are not opposites"
**Notes:** Substance unchanged. The label was the problem: "What we acknowledge" in a religion-framing context reads as a soft confession. New label is declarative. Added comparator clinicians (oncologists, palliative care) to normalize values-driven practice. Closed with "On both counts, the data stand on their own."

---

### Additional tone fixes (outside acknowledge blocks but same problem)

- **Page intro paragraph:** Removed "honest acknowledgment of where the field still has work to do." Replaced with "direct clinical answers."
- **Section-heading intro:** Removed "honest acknowledgment of the field's limitations." Replaced with "the clinical precision those questions deserve."
- **Closing paragraph:** Removed "Restorative reproductive medicine is not perfect. No approach to reproductive health is." Replaced with affirmative statement of the field's core principle and trajectory.
- **Article JSON-LD description:** Synced with new framing.
- **Byline:** Replaced `&mdash;` separator with `|` (no em dashes anywhere).
- **Related link:** Replaced `&mdash;` in "RRM vs. Standard ART &mdash; Free Course" with colon.

---

### Gate summary (Round 4)

All 14 gates passed clean. No blocks deleted (all 9 earned their place after reframing). Key gate evidence:
- Gate 2 (No IVF promotion): All IVF mentions are contrast/critique confirmed by grep
- Gate 8 (No em dashes): Zero matches for `&mdash;` or literal em dash confirmed by grep
- Gate 12 (No AI slop): Zero matches for prohibited terms confirmed by grep

---

## Round 5: Delay Q paradigm reframe

**Date:** 2026-04-18
**Scope:** `<h2>Does RRM delay fertility treatment?</h2>` block only. HTML body + JSON-LD `acceptedAnswer.text`.

---

### Before/After: Setup paragraph

**Before:**
> "The concern, raised by major professional societies, is that pursuing RRM delays treatment, especially for older patients."

This sentence accepted the premise that a concern about "delay" is legitimate. It positioned RRM as the subject of a valid criticism rather than as a misclassified object. It did not challenge whether "fertility treatment" in the critic's framing actually included RRM.

**After:**
> "The question contains a hidden premise: that 'fertility treatment' means IVF or other assisted reproductive procedures. It does not. RRM is fertility treatment. The concern conflates delay with choice of paradigm. Choosing to treat the underlying condition is not a detour from fertility care. It is fertility care."

The reframe names the false equivalence in the first sentence. It does not concede the framing. The rest of the block builds on this: RRM produces fertility outcomes; the diagnostic window is comparable to an IVF preparation cycle; the distinction between "treatment" (intervening on pathology) and "procedure" (routing around it) is made explicit.

---

### Citation resolution: [CITE meta-analysis] (55.3% pregnancy rate claim)

**Original text:** "RRM surgical treatment has shown pregnancy rates of 55.3% per woman [CITE meta-analysis]"

**Resolution:** Dropped. The 55.3% figure is not present in rrm-cli and cannot be verified against a specific source. It is not in the voice profile's Verified Facts section. Fabricating a citation on a medical education site is an existential risk. The claim was removed entirely.

The evidence block was rebuilt around two statistics that are already hard-cited elsewhere on this same page (Sanchez-Mendez 2025 and Boyle 2025), which are both in the voice profile's Verified Facts section with exact phrasing confirmed. No statistical claim was weakened; the block now carries stronger, verified evidence than the original unverifiable figure.

---

### Citation resolution: [CITE JRRM] (41% live birth rate claim)

**Original text:** "a 2021 study showed a 41% live birth rate with RRM treatment followed by timed intercourse [CITE JRRM]"

**Resolution:** Deduped to Boyle 2025, already cited on the page. The "41% crude LBR" figure appears in the voice profile's Verified Facts as Boyle 2025 (n=187, Journal of Restorative Reproductive Medicine). There is no separate 2021 study with this exact figure in rrm-cli. The [CITE JRRM] mark was referencing the same Boyle 2025 study already cited in the "Is RRM effective?" and "Is RRM a real alternative to IVF?" sections. The citation now reads consistently across all three locations: `Boyle P et al., Journal of Restorative Reproductive Medicine, 2025`.

**Additional citation added:** Boyle 2018 (Frontiers in Medicine, n=403, 32.1% LBR in post-IVF-failure population). This is in rrm-cli and in the voice profile ("use for rescue narrative ONLY"). The paradigm reframe required naming the flow of post-IVF patients to RRM. This study documents exactly that population. No specific percentage was needed for the "substantial share" qualitative claim, but citing the 2018 study adds verifiable specificity to the post-IVF patient flow claim.

---

### Softening note

No claims were softened for lack of citations. One unverifiable claim (55.3%) was removed. All replacement claims are either:
- Drawn from the Verified Facts section of the voice profile with exact phrasing
- Already cited elsewhere on the same page (dedupe, not weakening)
- From rrm-cli confirmed library entries (Boyle 2018)

The qualitative claim "a substantial share of RRM patients arrive after IVF or IUI has not delivered a live birth" was phrased qualitatively because no cohort-wide percentage for this exists in rrm-cli. The Boyle 2018 study (n=403, specifically a post-IVF-failure population) is cited immediately after to provide the best available quantitative anchor.

---

### Gate summary (Round 5)

| Gate | Result | Evidence |
|------|--------|---------|
| 1: Voice profile loaded | Pass | Read at session start |
| 2: No IVF promotion | Pass | IVF mentioned only as contrast and to cite Boyle 2018 post-IVF cohort |
| 3: Excision only | Pass | No surgery recommendations in this block |
| 4: Couple-centered | Pass | Block references "couples" and "her body" (female patient context appropriate) |
| 5: Evidence-supported | Pass | All stats verified: Sanchez-Mendez 2025, Boyle 2025, Boyle 2018 all in rrm-cli and voice profile |
| 6: Tone check | Pass | First sentence names the false premise. Last sentence closes on what RRM Academy exists to do |
| 7: Format + word count | Pass | Four-block pillar Q structure (setup, evidence, acknowledge, position) |
| 8: No em dashes | Pass | Grep confirmed. No `&mdash;` or literal em dash in the block |
| 9: No narration filler | Pass | No "in my practice" / "in my experience" present |
| 10: No academic passive | Pass | Active voice throughout. "RRM treats." "ART routes around." |
| 11: ACOG/ASRM not named | Pass | "Major professional societies" not used in this block; no ACOG/ASRM named |
| 12: No AI slop | Pass | No prohibited terms present |
| 13: Brand separation | Pass | RRM Academy content only |
| 14: Addendum check | Pass | No addenda in rrm-cli results for this session |
