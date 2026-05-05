# /what-is-rrm/ Proofread - 2026-05-05

**Source:** src/pages/what-is-rrm/index.astro
**Reviewer:** automated proofreader (Claude general-purpose agent)
**Scope:** copy-edit + duplication check (within page + vs naprotechnology, neofertility, femm)

## Summary
- Total findings: 14
- Must-fix (editorial rules / em dashes / typos / markup bugs): 3
- Should-fix (voice / redundancy / cross-pillar dup / number drift): 7
- Consider (style nits): 4

No em dashes were found. No "STORM/IRRM" typos. No "RRMA" misuse in body copy. No hype words ("revolutionary", "groundbreaking"). No "cure infertility" claims. No Hilgers protocols or clinical dosings exposed publicly. No external provider lists pushed where `/what-is-rrm/#get-started` (Brian's curated section) would do; the page already routes patients there. NaPro vs RRM distinction is held correctly throughout (NaPro is consistently framed as one approach within RRM). "Unexplained infertility" is consistently reframed as "not yet diagnosed" or "uninvestigated."

## Findings

### Must-fix

#### F1 - Stray superscript reference outside list block
- **File:line:** src/pages/what-is-rrm/index.astro:714
- **Category:** markup
- **Excerpt:** `</ul><sup><a href="#ref-7" id="cite-7d">7</a></sup>`
- **Issue:** The citation marker for ref 7 sits between `</ul>` and the next `<p>`, rendering as an orphan superscripted "7" floating in the page outside any sentence. Citations must attach to text, not block boundaries.
- **Suggested fix:** Move the `<sup>` inside the final list item, attached to the relevant clause. For example, change line 713 to `<li><strong>Couple-centered care:</strong> both partners are evaluated and involved in treatment. The charting process creates shared understanding and a framework for communication.<sup><a href="#ref-7" id="cite-7d">7</a></sup></li>` and delete the standalone `<sup>` block on line 714.

#### F2 - Treatment-window number disagrees across page and FAQs
- **File:line:** src/pages/what-is-rrm/index.astro:154, 1173, 1377
- **Category:** rrm-rule (factual consistency)
- **Excerpt:**
  - L154 (FAQ JSON-LD): "active treatment window of 3 to 18 months"
  - L1173 (body prose): "active treatment window of 6 to 18 months"
  - L1377 (FAQ accordion): "active treatment windows range from three to eighteen months"
- **Issue:** Three different numeric ranges for the same fact in three places on one page. The schema FAQ (3-18) and the accordion FAQ (3-18) agree; the body prose (6-18) does not. Search engines will pick up at least two of these and quote them against each other.
- **Suggested fix:** Pick one range and use it everywhere. Recommended: change L1173 from "Patients should plan for an active treatment window of 6 to 18 months." to "Patients should plan for an active treatment window of 3 to 18 months."

#### F3 - Subject-verb agreement: "outcome data that makes"
- **File:line:** src/pages/what-is-rrm/index.astro:448
- **Category:** grammar
- **Excerpt:** "That insight led to clinical protocols, surgical advances, and outcome data that makes the case for moving beyond symptom suppression"
- **Issue:** The relative clause "that makes" is ambiguous. If it modifies the compound antecedent "clinical protocols, surgical advances, and outcome data," it must be "make." If it modifies "outcome data" alone, the placement is misleading.
- **Suggested fix:** "That insight led to clinical protocols, surgical advances, and outcome data that together make the case for moving beyond symptom suppression toward investigating and treating the conditions themselves."

### Should-fix

#### F4 - Verbatim duplicate paragraph (clinician training pathways)
- **File:line:** src/pages/what-is-rrm/index.astro:443 and 716
- **Category:** redundancy
- **Excerpt (both lines, identical):** "Clinicians who want to practice RRM can pursue training through RRM Academy, IIRRM credentialing, FACTS About Fertility, FEMM's Reproductive Health Research Institute (RHRI), or NaProTechnology fellowship programs."
- **Issue:** Same sentence appears twice in the prose, in sections that are 270 lines apart. There is also a third, fuller treatment of training pathways in section 12 (line 1206 onward).
- **Suggested fix:** Delete the L716 occurrence. The L443 placement (end of "What Is RRM?") gets readers oriented; the comprehensive training section later is where they go for the full breakdown. The L716 paragraph adds nothing.

#### F5 - Endo-survey "ten-year/2.5%/40%" claim repeated three times in body, twice in FAQs
- **File:line:** src/pages/what-is-rrm/index.astro:484, 663, 1104, 258 (FAQ schema), 1468 (FAQ accordion)
- **Category:** redundancy
- **Excerpt:** Each one phrases the Yeung 2.5% repeat-surgery rate over ten years against the 40% recurrence after ablation.
- **Issue:** Three body-prose mentions of the same paired statistic in different sections (history, conditions, evidence). Acceptable to surface once in the conditions section and once in the evidence section. Three is overkill and reads like content padding.
- **Suggested fix:** Keep L663 (in the endometriosis treatment section, where readers expect it) and L1104 (in the evidence section, where it serves as a methodology anchor). Remove the duplicate phrasing on L484 (history section), e.g. trim to "Surgical outcomes advanced as well: Dr. Patrick Yeung's RESTORE Center documented long-term excision-surgery outcomes that distinguish excision from ablation as the standard of care.<sup><a href="#ref-11">11</a></sup>"

#### F6 - "24% to 1% unexplained" repeated five times
- **File:line:** src/pages/what-is-rrm/index.astro:514, 775, 884 (chart), 1139, 1285
- **Category:** redundancy
- **Excerpt:** "unexplained infertility dropped from 24% to 1% after RRM workup"
- **Issue:** This is the headline finding from Boyle 2025 and deserves emphasis, but five occurrences in body prose plus a chart label is excessive. Rhetorically, it loses force the more it repeats.
- **Suggested fix:** Keep the chart (L884), the diagnosis section primary mention (L514), and the alternative-to-IVF mention (L775). Trim the redundant cite at L1139 to a back-reference ("the same diagnostic gap documented above") and at L1285 to "(see chart above)" or remove the sentence entirely.

#### F7 - "Male factor 20% / 30 to 40%" stat repeated 4x
- **File:line:** src/pages/what-is-rrm/index.astro:412, 511, 691, plus FAQ schema (L162) and accordion (L1384)
- **Category:** redundancy
- **Excerpt:** "A male factor is solely responsible in about 20% of infertile couples and contributory in another 30 to 40%"
- **Issue:** Three near-identical body prose mentions plus two FAQ mentions. The Key Takeaways line is fine; the diagnosis section warrants it; the "male factor" condition row warrants it. Pick one.
- **Suggested fix:** Keep L412 (Key Takeaways) and L511 (Diagnosis: Male Factor Evaluation). Trim L691 to drop the stat ("RRM investigates the male factor: hormonal imbalances, varicocele, infections, oxidative stress...") since the stat is already established in the same page above.

#### F8 - "89% / 4.5% / 6.5% laparoscopy re-exam" stat repeated verbatim
- **File:line:** src/pages/what-is-rrm/index.astro:1139 and 1286
- **Category:** redundancy
- **Excerpt:** "When RRM surgeons re-examined patients whose prior laparoscopy had been read as normal, they found endometriosis in 89% of them. Another 4.5% had other pelvic disease. Only 6.5% were actually normal."
- **Issue:** Same three-sentence statistical block appears verbatim in the "What Do the Critics of RRM Actually Cite?" section and in the "RRM withholds treatment" myth/fact card. They are 150 lines apart and serve essentially the same rhetorical purpose.
- **Suggested fix:** Keep the L1139 occurrence (evidence section, where the methodology anchor reads naturally). Replace L1286 with a short back-reference: "When RRM surgeons re-examined patients whose prior laparoscopy had come back normal, the great majority were found to have endometriosis or other pelvic disease (see evidence section)."

#### F9 - Sentence fragment closer
- **File:line:** src/pages/what-is-rrm/index.astro:1356
- **Category:** grammar
- **Excerpt:** "RRM care begins with charting instruction and builds from there. Whether your goal is treatment, clinical practice, or research."
- **Issue:** "Whether your goal is treatment, clinical practice, or research." is a fragment. It should be joined to the previous sentence or rewritten as a complete sentence.
- **Suggested fix:** "RRM care begins with charting instruction and builds from there, whether your goal is treatment, clinical practice, or research."

#### F10 - "Vital sign in 2015" vs "vital sign in adolescents" inconsistency
- **File:line:** src/pages/what-is-rrm/index.astro:409, 519, 274 (FAQ schema), 1482 (FAQ accordion)
- **Category:** redundancy / consistency
- **Excerpt:**
  - L409, L519: "ACOG recognized the menstrual cycle as a vital sign in 2015"
  - L274, L1482: "ACOG recognizes the menstrual cycle as a vital sign in adolescents"
- **Issue:** The body prose dates the recognition to 2015. The FAQ language drops the year and qualifies "in adolescents." Both are factually correct (the 2015 ACOG Committee Opinion was specifically about adolescents) but the inconsistent framing reads sloppy.
- **Suggested fix:** Standardize to "ACOG recognized the menstrual cycle as a vital sign in adolescents in 2015 (Committee Opinion No. 651)" wherever the claim is made, or shorten consistently to "ACOG recognized the menstrual cycle as a vital sign in 2015" if the adolescent qualifier is editorial overhead.

### Consider

#### F11 - "RRM is a growing field of medicine" appears twice
- **File:line:** src/pages/what-is-rrm/index.astro:448 and 1206
- **Category:** redundancy
- **Excerpt:** L448 "RRM is a growing field of medicine with..." and L1206 "RRM is a growing field with structured training pathways..."
- **Issue:** Both section openers begin with "RRM is a growing field." Different sentences, but the rhetorical move is identical.
- **Suggested fix:** Reword L1206 to lead with the training-specific framing, e.g. "RRM training has structured pathways for charting instructors, medical students, practicing clinicians, and allied health professionals."

#### F12 - "Faith / Catholic / no religious commitment" appears 4x
- **File:line:** src/pages/what-is-rrm/index.astro:435, 1249, 186 (FAQ schema), 1405 (FAQ accordion)
- **Category:** redundancy
- **Issue:** The "you do not need to be Catholic" framing appears in the "Who Practices RRM?" body section, the "RRM is only for religious people" myth/fact card, and twice in FAQs. The myth/fact card and one FAQ are sufficient. The body sentence at L435 is a one-liner that reads as defensive without setup.
- **Suggested fix:** Consider deleting L435 (the body has not introduced the religion question; the myth/fact card later is the natural home).

#### F13 - "16 years of infertility, 8 failed IVF" case study referenced 3x
- **File:line:** src/pages/what-is-rrm/index.astro:170 (FAQ schema), 782, 800, 1391 (FAQ accordion)
- **Category:** redundancy
- **Issue:** The same Boyle 2022 case is restated in the RRM-after-failed-IVF section (L782), the evidence section (L800), and two FAQ entries. Three body-prose mentions is borderline.
- **Suggested fix:** Keep the evidence section (L800) as the primary mention, since that is where readers expect a citation-anchored case study. Trim L782 to a back-reference: "Boyle et al. (2022) documented a successful pregnancy after 16 years of infertility and eight failed IVF transfers; full details in the evidence section below."

#### F14 - "Most marketed fertility treatment in the world" line repeats
- **File:line:** src/pages/what-is-rrm/index.astro:194 (FAQ schema), 1286
- **Category:** redundancy
- **Excerpt:** "Everyone knows what IVF is. It is the most marketed fertility treatment in the world."
- **Issue:** Verbatim phrasing in the FAQ schema and in the body myth/fact card. The FAQ schema mirrors the answer to "Does RRM withhold information about IVF from patients?" - it would be cleaner if the FAQ schema language were not a near-copy of body prose. Schema markup readers (Google) and on-page readers will see the duplication.
- **Suggested fix:** Light paraphrase in either location. For example, the FAQ schema answer could open with "Everyone has heard of IVF; it is the most heavily marketed fertility treatment available. The informed consent gap actually runs in the opposite direction..." while the body card retains the punchier "It is the most marketed fertility treatment in the world."

### Internal duplication

Summarized above (F4-F14). The page has substantial repetition of:
- The Yeung 2.5% / 40% endo claim (3-5 places)
- The Boyle 24% to 1% unexplained-infertility claim (5 places)
- The 20% / 30-40% male-factor claim (4-5 places)
- The 89% / 4.5% / 6.5% post-laparoscopy re-exam stats (2 verbatim mentions)
- The "16 years of infertility" case study (3-4 places)
- The "no religious commitment required" framing (4 places)

Some of this is intentional - FAQs duplicate body prose by design for snippet eligibility, and the chart-section bar callouts mirror inline text - but the verbatim paragraph at L443/L716 and the L1139/L1286 stat block are pure duplication.

### Cross-pillar duplication

No cross-pillar paragraphs found that warrant flagging. Sister pillars (naprotechnology, neofertility, femm) reference shared canonical figures (Boyle 2025, Sanchez Mendez 2025, Yeung 2024) but each page contextualizes them within its own clinical framing. The shared touchpoints are:

- "what-is-rrm:146 ↔ naprotechnology:137": Both pages answer "Is NaPro the same as RRM?" - the framings are deliberately different (what-is-rrm says NaPro is one approach within RRM; naprotechnology says NaPro predates and stands apart from RRM as a label). This is a known editorial tension Brian has flagged before; not a copy-edit issue but worth noting that the two pages give different answers to the same question. Out of scope for this proofread.
- "what-is-rrm:480-482 ↔ femm/neofertility intros": Brief one-line attributions ("FEMM (2012)... Reproductive Health Research Institute") and ("NeoFertility (2016), developed by Dr. Phil Boyle") match the sister pillars by design. These are entity-attribution facts, not paraphrasable. Acceptable.
- "what-is-rrm:481 ↔ naprotechnology:480": Both pillars list the FEMM/NeoFertility/NaPro umbrella in similar phrasing. Short and citation-natural. Acceptable.

No multi-sentence verbatim cross-pillar overlaps found.

## Pages checked clean

The following sections of /what-is-rrm/ were reviewed and surfaced no findings:
- Section 1 (Key Takeaways) - copy-clean and editorially compliant
- Section 5 (Role of FABMs) - voice and citations are clean
- Section 6 conditions table (L598-L655) - factually consistent and editorially compliant
- Section 7 (RRM vs IVF) side-by-side comparison table - cost figures internally consistent ($40,000-$60,000 used throughout)
- Section 8 (Evidence) data charts and figures - numbers internally consistent
- Section 11 (Cost and Insurance) - no vague "more affordable" claims; uses specific anchor figures
- Section 14 (Get Started) - correctly routes to `#get-started` on this page (Brian's curated section) and to IIRRM/Natural Womanhood as the only external lists; Brian's link-direction policy honored
- References block (L1525-L1568) - formatting consistent
- All `Dr. Naomi Whittaker` byline references match the canonical SSOT byline format
- All `IIRRM` (double-I) and `STORRM` references correctly spelled (no typos found)
