# Wave 2: Messaging + Grammar Audit - Homepage

**Source:** `src/pages/index.astro` (859 lines)
**BASE_SHA:** b4b51e1a2b2053b482478e2b9dc76f7d801670ae
**Date:** 2026-05-05
**Auditor:** Gianna (Wave 2 mode, read-only)

---

## Summary

- must-fix: 9
- should-fix: 10
- consider: 8
- Highest concern: The phrase "The goal is answers and restored function" appears verbatim at lines 186 and 244, making consecutive sections echo each other in a way that signals copy-paste rather than intentional reinforcement.

---

## Must-fix tier (rules + clear bugs)

---

- id: W2-must-fix-1
- tier: must-fix
- location: src/pages/index.astro:228
- excerpt: `Male factor assessment, hormonal panels, semen analysis -- diagnostics for both partners`
- issue: Double-hyphen used as a dash in body prose. All prose dashes must use commas, colons, or periods. A double-hyphen is not a valid punctuation substitute on a published medical education site.
- suggested_fix: `Male factor assessment, hormonal panels, semen analysis: diagnostics for both partners`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-2
- tier: must-fix
- location: src/pages/index.astro:186 and 244
- excerpt: Line 186: `The goal is not indefinite condition management. The goal is answers and restored function.` / Line 244: `<strong>The goal is answers and restored function.</strong>`
- issue: Verbatim phrase repeat across adjacent sections (Intro and "What RRM Looks Like"). The four-word string "answers and restored function" appears twice, once as a closing sentence and once as a bold section-opener. A reader moving straight down the page says "you just told me that."
- suggested_fix: Line 244 bold opener: `<strong>When the underlying cause is treated, function returns.</strong>` (retains clinical truth, eliminates the verbatim repeat)
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-3
- tier: must-fix
- location: src/pages/index.astro:350
- excerpt: `Dr. Whittaker is a board-certified OBGYN and NaProTechnology`
- issue: Capitalization inconsistency. The credential is written "Board-Certified OBGYN" at lines 182, 323, and 334. Line 350 drops to lowercase "board-certified." One page, four instances, three capitalized and one not. The byline is a proper credential designation; it must be consistent. Prefer the uppercase form used in all other instances.
- suggested_fix: `Dr. Whittaker is a Board-Certified OBGYN and NaProTechnology`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-4
- tier: must-fix
- location: src/pages/index.astro:307
- excerpt: `You are a physician in OB/GYN, family medicine, or reproductive endocrinology who wants to offer patients real diagnostic and restorative options beyond suppressive medications and ART referrals.`
- issue: "Reproductive endocrinology" here implies REI physicians are an intended RRM audience. RRM voice profile explicitly states: "Reproductive endocrinologist / REI as RRM clinician" is a term to avoid because REIs are IVF doctors. Listing REI/reproductive endocrinology as a target audience without qualification blurs the paradigm distinction and could mislead visitors about whether RRM is compatible with REI practice. The sentence needs reframing to family medicine and OB/GYN practitioners who practice restoratively, not REI specialists.
- suggested_fix: `You are a physician in OB/GYN or family medicine who wants to offer patients real diagnostic and restorative options beyond suppressive medications and specialist referrals.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-5
- tier: must-fix
- location: src/pages/index.astro:371-373
- excerpt: `{articleCount.toLocaleString()} peer-reviewed articles. These are published studies in peer-reviewed journals, not opinion pieces.`
- issue: "Peer-reviewed" appears twice in two consecutive sentences. "Published studies in peer-reviewed journals" directly follows "{count} peer-reviewed articles." The redundancy weakens the claim by sounding defensive rather than confident. The voice guide requires removing filler and redundancy.
- suggested_fix: `{articleCount.toLocaleString()} peer-reviewed articles, published in indexed medical journals, not opinion pieces.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-6
- tier: must-fix
- location: src/pages/index.astro:244-245
- excerpt: `When the underlying disease is treated, hormonal rhythms can normalize and ovulation can return.`
- issue: Academic passive voice. "Is treated" is a passive construction. RRM voice requires active voice throughout.
- suggested_fix: `When treatment reaches the underlying disease, hormonal rhythms normalize and ovulation can return.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-7
- tier: must-fix
- location: src/pages/index.astro:292 and 435
- excerpt: Line 292 (heading): `You Are in the Right Place` / Line 435 (CTA close): `You are in the right place.`
- issue: Verbatim phrase used as both a section heading and the closing sentence of the CTA section. The repetition is a direct echo across 143 lines. This is not AEO-intentional duplication. It reads as an editing artifact. The CTA closing sentence needs to be rewritten as a forward-looking call to action, not a restatement of the heading from two sections earlier.
- suggested_fix: Replace line 435 with: `The evidence exists. The clinicians exist. Your first step is a course or the library.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-8
- tier: must-fix
- location: src/pages/index.astro:384
- excerpt: `<strong>I'm not a medical professional. Is this for me?</strong>`
- issue: Contraction ("I'm") in a bold heading within what is effectively an FAQ entry. The prose section uses formal full-word constructions throughout ("I am not a medical professional" appears in the schema FAQ at line 108). Inconsistency between schema FAQ question name and prose heading undermines voice consistency and schema match.
- suggested_fix: `<strong>I am not a medical professional. Is this for me?</strong>`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-must-fix-9
- tier: must-fix
- location: src/pages/index.astro:222 and 247
- excerpt: Line 222: `cooperate with the body rather than working around it` / Line 247: `repairs the reproductive system rather than routing around it`
- issue: Paraphrase duplication. Both sentences make the same conceptual move ("RRM works with the body rather than bypassing it") in slightly different words, appearing in adjacent paragraphs of the same section ("What RRM Looks Like"). The test: a reader moving through this section says "you just said that." One of these belongs; two does not.
- suggested_fix: Delete line 222's trailing clause. Rewrite the opener at line 220-222 as: `Every patient is different, and RRM does not follow a single fixed protocol. The same principles guide every case: find the cause, treat the disease, restore the function.`
- proposed_action_type: TRIM-PROSE

---

## Should-fix tier (style + voice drift)

---

- id: W2-should-fix-1
- tier: should-fix
- location: src/pages/index.astro:194-201
- excerpt: `The Check Engine Light Analogy` (section heading and body paragraph)
- issue: The voice profile explicitly flags "Generic AI analogies (builder/inspector, car engine, orchestra) - if the metaphor isn't from Naomi's interviews, cut it." The car/check-engine-light analogy is a generic consumer metaphor, not a verified phrase from Dr. Whittaker's recorded interviews. It may undercut clinical authority by reaching for an everyday frame the moment the reader arrives. The analogy section also paraphrases what the Intro section already established: suppressive medications hide the problem instead of fixing it.
- suggested_fix: Replace the check-engine section heading with a direct clinical framing, e.g., `The Standard Playbook, and Why It Fails`. Rewrite to use the verified language: "It is hiding symptoms and hiding them very well" plus the disease-progression frame.
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-2
- tier: should-fix
- location: src/pages/index.astro:199-201
- excerpt: `For decades, women have been handed the tape. Suppressive medications to mask the pain. Hormones to quiet the cycle. Bypass procedures when the cycle is too damaged to read. The underlying disease keeps advancing, unseen.`
- issue: Female-only framing in a stand-alone paragraph. The Analogy section focuses entirely on "women." RRM voice rule: couple-centered language throughout. Male factor contributes in roughly 20% of couples as sole cause and another 30-40% as a co-factor. One brief acknowledgment of the couple in this section would align the paragraph with the page's otherwise consistent couple-centered posture.
- suggested_fix: Add one sentence after "Bypass procedures when the cycle is too damaged to read." for example: `For the partner, abnormal semen parameters are overlooked or attributed to stress.` Then retain: `The underlying disease keeps advancing, unseen.`
- proposed_action_type: ADD-PROSE

---

- id: W2-should-fix-3
- tier: should-fix
- location: src/pages/index.astro:237-240
- excerpt: `For hormonal dysfunction, it may mean targeted medical support timed to the cycle. Because RRM is multidisciplinary, the care team might include physicians, naturopaths, nutritionists, pelvic floor physical therapists, mental health professionals, or fertility awareness educators, depending on what you need.`
- issue: Sentence construction issue. "Because RRM is multidisciplinary" opens a clause that runs 41 words before landing. This violates the short-sentence rule (20-word cap). The sentence should be broken at the period and the multidisciplinary list given its own short sentence.
- suggested_fix: `For hormonal dysfunction, it may mean targeted medical support timed to the cycle. RRM is multidisciplinary. The care team may include physicians, naturopaths, nutritionists, pelvic floor physical therapists, mental health professionals, or fertility awareness educators.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-4
- tier: should-fix
- location: src/pages/index.astro:378
- excerpt: `Our students come in saying "I don't even know what questions to ask."`
- issue: Institutional voice creep. "Our students" on a patient-facing page implies RRM Academy is a clinic or practitioner rather than an educational nonprofit. The MEMORY.md rule is explicit: "Our" clinical voice is prohibited for RRM Academy. Correct framing avoids possessive-institution phrasing. Additionally, "come in" is ambiguous (come into a physical office?). Rephrase.
- suggested_fix: `Students often arrive saying "I don't even know what questions to ask."`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-5
- tier: should-fix
- location: src/pages/index.astro:384-391
- excerpt: `Many of our students are patients, not clinicians.`
- issue: Same "our students" institutional voice problem as W2-should-fix-4. Appears twice in the prose FAQ section (lines 378 and 385). Both occurrences need correction.
- suggested_fix: `Many students are patients, not clinicians.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-6
- tier: should-fix
- location: src/pages/index.astro:181
- excerpt: `Our founder, Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI, is a NaProTechnology fellowship-trained surgeon.`
- issue: "Our founder" again uses institutional-voice "our." Consistent with the MEMORY.md rule, patient-facing prose should avoid "our" as an institutional possessive. Also, this sentence is 23 words; the 20-word cap is breached. The credential string is dense for a mid-paragraph placement.
- suggested_fix: `RRM Academy was founded by Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI. She is a NaProTechnology fellowship-trained surgeon.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-7
- tier: should-fix
- location: src/pages/index.astro:347-355
- excerpt: `Dr. Whittaker built RRM Academy because of her. And the thousands like her. Women with real, diagnosable conditions who were told their pain was normal. Clinicians who wanted to help and were never taught how. Those are two separate failures, and they compound each other.`
- issue: Voice drift toward narration. "Dr. Whittaker built RRM Academy because of her" is a narrative preamble that announces the story rather than showing it. The verified phrase from the voice profile ("Women with real, diagnosable conditions. Dismissed.") is sharper and should anchor this paragraph without the preamble. The current prose softens the sharpness.
- suggested_fix: `Women with real, diagnosable conditions. Told their pain was normal. Dismissed. Clinicians who wanted to help and were never taught how. Those are two separate failures, and they compound each other. Dr. Whittaker built RRM Academy to close both.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-8
- tier: should-fix
- location: src/pages/index.astro:424
- excerpt: `Your body is not broken. It is waiting to be heard.`
- issue: "Waiting to be heard" is a hedged, soft closing that drifts toward sentiment. The voice profile warns against "may change how you view" and hedged closings; it requires declarative endings. "Waiting to be heard" implies passivity. RRM's clinical message is that the body already has signals, and RRM-trained clinicians can read them. The close should be direct, not wistful.
- suggested_fix: `Your body is not broken. It has signals. RRM is how you read them.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-9
- tier: should-fix
- location: src/pages/index.astro:263-265
- excerpt: `RRM does not declare that your body has failed and that technology must take over. It asks: what is actually wrong, and can it be fixed? Often, the answer is yes.`
- issue: Hedging close ("Often, the answer is yes") undercuts the preceding directness. "Often" is a qualifier that invites doubt at the moment the page is making its strongest claim. If the evidence supports a higher confidence claim, make it. If genuine uncertainty must be expressed, the voice profile says "We don't even have data for that" or "It's hard to prove this" are acceptable framings, not "often."
- suggested_fix: `RRM does not declare that your body has failed and that technology must take over. It asks: what is actually wrong, and can it be fixed? For most couples, the answer is yes.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-should-fix-10
- tier: should-fix
- location: src/pages/index.astro:301
- excerpt: `You prefer <a href="/courses/rrm-vs-ivf/">natural conception</a> and want to know what that path actually requires.`
- issue: The link text "natural conception" anchors to the rrm-vs-ivf course page. The link destination is appropriate, but "natural conception" as a hyperlink anchor creates a curious UX: readers click on the term expecting a definition page, not a course sales page. This is a link-text mismatch. The anchor text should reflect the destination, or the link should point to the /faqs/what-is-natural-conception/ or a /what-is-rrm/ explainer instead.
- suggested_fix: `You prefer natural conception and want to know what that path actually requires. <a href="/courses/rrm-vs-ivf/">See the RRM vs. IVF course.</a>` (separate the link from the preference statement)
- proposed_action_type: REWRITE-PROSE

---

## Consider tier (subjective improvements)

---

- id: W2-consider-1
- tier: consider
- location: src/pages/index.astro:146-149
- excerpt: `{articleCount.toLocaleString()} scholarly works related to RRM cataloged and linked to authors, institutions, and topics.`
- issue: Hero subtitle leads with the library count rather than with the problem the visitor has. The Recognize step of the patient-page emotional sequence suggests the first visible sentence after the heading should acknowledge her situation, not present a credential count. A visitor in pain or in infertility distress does not arrive asking "how many studies do you have?" The library count is persuasive at the "Prove" stage (step 3), not in the opening frame.
- suggested_fix: Consider leading the subtitle with the patient problem: `The educational platform for patients who have been dismissed and clinicians who want to do better. {articleCount.toLocaleString()} peer-reviewed studies to back every claim.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-consider-2
- tier: consider
- location: src/pages/index.astro:172-188
- excerpt: Intro section (the opening prose paragraphs after the hero)
- issue: The intro opens with symptoms ("Painful periods are not a personality trait") which is good Recognize-step writing. But it moves immediately to credentials and mission in the second paragraph before placing a peer story (Mirror step). The sequence should be: Recognize - Mirror - Prove - Explain - Offer. Currently it goes: Recognize - Explain - Offer. No peer story appears until the founder blockquote at line 338, which is far below the fold for most mobile visitors. Consider moving the founder/patient story earlier, or adding a brief peer story near the intro.
- suggested_fix: Consider inserting a one-paragraph patient mirror (anonymous, condition named, real details) between the intro Recognize paragraph (lines 175-177) and the RRM Academy intro paragraph (lines 179-184). This is a structural suggestion for future CRO testing, not a line edit.
- proposed_action_type: ADD-PROSE

---

- id: W2-consider-3
- tier: consider
- location: src/pages/index.astro:425-435
- excerpt: CTA section body: `Most of the patients who find RRM Academy have spent years being told the wrong things. That their pain is normal. That their cycles are just difficult. That their only option is to suppress or bypass.`
- issue: This paragraph closely paraphrases the intro section opening at lines 175-177 ("Painful periods are not a personality trait. Irregular cycles are not just how you are.") and the Analogy section at lines 199-201. The three sections make the same conceptual move: "you were told the wrong things." The CTA should advance the narrative (offer the next step) rather than re-summarize the problem already presented twice.
- suggested_fix: Replace the first CTA paragraph with something that acknowledges the forward motion: `The patients who find RRM Academy have already done the reading. They know something is wrong. What they need is a path forward.`
- proposed_action_type: REWRITE-PROSE

---

- id: W2-consider-4
- tier: consider
- location: src/pages/index.astro:183-184
- excerpt: `Everything here reflects her clinical standards.`
- issue: This sentence is institutional self-assertion without specificity. "Clinical standards" is vague. What specifically makes Dr. Whittaker's approach distinct? The voice profile warns against "plain, precise language" being replaced with abstract claims. The sentence could be more specific or cut.
- suggested_fix: `The diagnostics, surgical standards, and educational content here reflect her NaProTechnology fellowship training and 15 years of clinical practice.` (adjust years if not verified; if years are uncertain, use: `The content reflects her fellowship training and clinical practice in restorative surgery and cycle-based medicine.`)
- proposed_action_type: REWRITE-PROSE

---

- id: W2-consider-5
- tier: consider
- location: src/pages/index.astro:338-345
- excerpt: `"I'll never forget a patient I saw during my residency..."`
- issue: The blockquote opens with "I'll never forget," which is a narration-announcement frame the voice profile flags. The verified phrase preference is to start from the clinical reality, not from the speaker's memory. The quote itself is powerful, but the "I'll never forget" opener is a tell of sentimental framing.
- suggested_fix: If this is a verbatim quote from Dr. Whittaker's recorded interview, preserve it exactly (verbatim quotes are protected per memory rule). If it is paraphrased or composed, reopen it: `"During my residency, I saw a patient with a history of miscarriages. She was pregnant again, terrified. My attending told me to do nothing. 'If she's going to miscarry, she's going to miscarry.' That moment broke my heart."` - removing "I'll never forget" reduces the sentimentality without changing the clinical truth.
- proposed_action_type: REWRITE-PROSE

---

- id: W2-consider-6
- tier: consider
- location: src/pages/index.astro:413-416
- excerpt: `Dr. Whittaker and the RRM Academy faculty translate the research into clinical context. What a new study actually means. What the evidence supports. What it does not.`
- issue: The phrase "What it does not" is a fragment ending used for rhetorical effect. The fragments work in context, but "RRM Academy faculty" is introduced here without any prior mention on the page. If "faculty" refers to additional instructors, they need a brief reference elsewhere. If it is a placeholder for Dr. Whittaker's own commentary alone, remove "faculty" to avoid implying a team that is not otherwise surfaced.
- suggested_fix: `Dr. Whittaker translates the research into clinical context. What a new study actually means. What the evidence supports. What it does not.`
- proposed_action_type: TRIM-PROSE

---

- id: W2-consider-7
- tier: consider
- location: src/pages/index.astro:309-311
- excerpt: `You want to understand how NaProTechnology-based medicine, restorative surgery, and complementary disciplines integrate into a full patient care model.`
- issue: This is the only line in the clinician section that foregrounds NaProTechnology specifically. All three other clinician bullets use "RRM" framing. This bullet implies NaProTechnology is the organizing framework for RRM. The editorial rule is that NaPro is one type of RRM, not synonymous. "NaProTechnology-based medicine" as the lead term in this bullet could create a NaPro=RRM confusion for a clinician just learning the paradigm.
- suggested_fix: `You want to understand how restorative diagnostics, cycle-based medicine, and surgical approaches integrate into a full patient care model.` (NaProTechnology can be named in a supplementary guide, not the homepage clinician bullet)
- proposed_action_type: REWRITE-PROSE

---

- id: W2-consider-8
- tier: consider
- location: src/pages/index.astro:134
- excerpt: `description="RRM Academy offers evidence-based education in Restorative Reproductive Medicine. Courses, a research library, and expert guidance for patients and clinicians."`
- issue: The meta description is factually accurate but passive. "Offers" is a weak verb for a homepage meta description. The description does not include a clear differentiator or patient-facing hook. AEO and SERP optimization both favor descriptions that include the user's problem and the specific outcome. The description could work harder at the 160-character limit.
- suggested_fix: `Dismissed, misdiagnosed, or told your infertility is unexplained? RRM Academy is the educational home of Restorative Reproductive Medicine. Evidence-based courses and a 3,000-article research library.`
- proposed_action_type: REWRITE-PROSE

---

## Internal duplication

### Verbatim repeats

| Lines A | Lines B | Type | Recommendation |
|---------|---------|------|----------------|
| 186 (`The goal is answers and restored function.`) | 244 (`The goal is answers and restored function.`) | verbatim | REWRITE-B: change the bold opener at line 244 to a clinical variation (see W2-must-fix-2) |
| 292 (`You Are in the Right Place` heading) | 435 (`You are in the right place.` closing sentence) | verbatim | REWRITE-B: change the CTA close to a forward-looking sentence (see W2-must-fix-7) |
| 103-104 (schema FAQ: "That is exactly what it is for. Students leave knowing how to screen a surgeon...") | 377-381 (prose FAQ: "That is exactly what it is for. Our students come in saying...They leave knowing how to screen a surgeon...") | near-verbatim | KEEP: schema mirror of prose is standard AEO pattern for snippet eligibility. Prose version has additive detail ("I don't even know what questions to ask"). Acceptable. |
| 119-120 (schema FAQ: "Start with the right questions. Do they perform excision, not ablation?...") | 392-395 (prose FAQ: "Start with the right questions. Do they perform excision, not ablation?...") | near-verbatim | KEEP: same AEO rationale. Prose version adds two sentences of context. Acceptable. |

### Paraphrase repeats

| Lines A | Lines B | Type | Recommendation |
|---------|---------|------|----------------|
| 175-177 (`Painful periods are not a personality trait. Irregular cycles are not "just how you are."`) | 425-429 (CTA: `Most of the patients who find RRM Academy have spent years being told the wrong things. That their pain is normal. That their cycles are just difficult.`) | paraphrase | REWRITE the CTA paragraph to advance the narrative rather than re-summarize the problem (see W2-consider-3) |
| 199-201 (Analogy: `Suppressive medications to mask the pain. Hormones to quiet the cycle. Bypass procedures when the cycle is too damaged to read.`) | 279-280 (Comparison: `Suppress symptoms or bypass the problem. Suppressive medications. Standardized protocols.`) and 427-428 (CTA: `That their only option is to suppress or bypass.`) | paraphrase (3-way) | KEEP two of three instances (Analogy for emotional impact, Comparison for clinical taxonomy). TRIM CTA repeat - it adds no new information at that stage of the page. |
| 222 (`cooperate with the body rather than working around it`) | 247 (`repairs the reproductive system rather than routing around it`) | paraphrase | TRIM line 222's trailing clause (see W2-must-fix-9) |
| 263-264 (`RRM does not declare that your body has failed and that technology must take over.`) | 424 (`Your body is not broken.`) | paraphrase | KEEP both: the Two Approaches section makes a paradigm argument; the CTA tagline makes an emotional affirmation. Different register, different intent. Both can stand. |
| 371-373 (FAQ: `{count} peer-reviewed articles. These are published studies in peer-reviewed journals`) | 407-408 (Research section: `{count} peer-reviewed resources, organized and searchable`) | paraphrase/stat-repeat | KEEP: different sections, different intent (FAQ answers a skeptic's objection; Research section is a navigation prompt). The proximity is manageable. Fix the redundant "peer-reviewed" within the FAQ bullet (see W2-must-fix-5). |

---

## Pages-clean

The following sections were reviewed and had no findings:

- **Hero heading and descriptor** (lines 145-155): "A 501(c)(3) nonprofit education platform" descriptor is accurate and unambiguous. H1 is clear, no passive voice, no prohibited terms.
- **Hero trust bar** (lines 156-168): Journal logo bar is factual. No prose to audit.
- **"What RRM Looks Like" paragraphs 3-5** (lines 231-255, excluding line 244 which is flagged): The endometriosis/excision surgery mention, tubal catheterization reference, and "You are part of the process" paragraph are all voice-compliant, couple-centered, and free of passive constructions.
- **"Two Approaches. One Choice." comparison table** (lines 267-285): The comparison table is structurally sound. "Suppressive Medicine" as the opposing column label is correct voice terminology. The table does not name IVF by recommendation. No "cure" claims.
- **"You Are in the Right Place" patient bullets** (lines 293-302): The five patient bullets are well-constructed. The "unexplained infertility" parenthetical at line 299 correctly deploys the "undiagnosed is the more accurate word" reframe. Couple-centered at line 300. The natural conception link at line 301 is noted as a UX issue (W2-should-fix-10) but the prose itself is not a rule violation.
- **"You Are in the Right Place" clinician bullets** (lines 305-311, excluding line 307 flagged as W2-must-fix-4 and line 310 as W2-consider-7): The nurse practitioner, midwife, nutritionist, and fertility awareness educator bullet are well-targeted and voice-compliant.
- **Founder photo alt text** (line 323): "Dr. Naomi Whittaker, MD, Board-Certified OBGYN and Founder of RRM Academy" - accurate, clear, no issues.
- **"Common Questions" section - surgeon/provider FAQ bullet** (lines 391-397): Excision-over-ablation framing is correct. Couple-centered ("Do they evaluate both partners?"). No ablation promotion. Clean.
- **"Research and Commentary" section** (lines 402-418, excluding faculty note at W2-consider-6): Library and commentary descriptions are accurate and factual. No passive voice. No prohibited terms.
- **Schema JSON-LD** (lines 17-131, prose content only): All four FAQ schema answers are factually accurate, free of IVF promotion, free of clinical dosing, free of "cure" claims. Capitalization of proper nouns is consistent within the schema block.

---

*Report generated: 2026-05-05. Audit scope: prose copy, headings, schema FAQ text, meta description. CSS, SVG path data, and code comments excluded from prose rules. Em-dash check: 4 em-dashes found; all are in JS/CSS developer comments, none in body prose. Em-dash count in rendered prose = 0.*
