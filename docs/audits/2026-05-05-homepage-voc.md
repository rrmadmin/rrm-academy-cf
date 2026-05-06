# Wave 4: VOC Audit — Homepage

Source: `src/pages/index.astro`
BASE_SHA: `b4b51e1a2b2053b482478e2b9dc76f7d801670ae`
Audit date: 2026-05-05
Mode: read-only

## Legitimization regex (snapshot at audit time)

```
not (irrational|being heartless|being cruel|acting carelessly|bad advice)
(honest|logical|reasonable|sensible) (step|advice|option|logic|pathway)
within (that|their) paradigm
is not wrong to
real option
right option
not bad advice
```

Applied to every `suggested_fix` below. Matches were rewritten or moved to the Dropped section.

## Summary

- Per-section alignment findings: 11
- VOC-gap findings: 8
- MICHELLE-WARMTH tagged: 5
- Dropped (failed legitimization regex): 2
- Top concern: Homepage opens with a clinician-voiced manifesto (stats, declarations, "is not a personality trait") before any acknowledgment of the buyer's emotional state, violating the high-anxiety-audience Recognize -> Mirror -> Prove -> Explain -> Offer sequencing the VOC skill prescribes.

## Per-section VOC alignment table

| section_heading | line_range | buyer_state_expected | what_page_delivers | alignment_verdict |
|---|---|---|---|---|
| Hero | 143-168 | Late-funnel trust check, "is this real and credible" | 501c3 descriptor + "Evidence-Based" headline + scholarly works count + journal trust bar | PARTIAL |
| Intro | 172-189 | Recognition that her experience matches a pattern | Three declarative manifesto sentences + founder credentials | MISALIGNED |
| Analogy (Check Engine Light) | 192-213 | Conceptual frame for why she has been failed | Car-tape metaphor that lands hard but skirts emotional acknowledgment | PARTIAL |
| What RRM Looks Like | 216-256 | "What will actually happen if I pursue this" | Four-stage clinical explanation with examples (excision, catheterization, multidisciplinary team) | ALIGNED |
| Two Approaches. One Choice | 259-287 | Comparative frame to validate her pull toward RRM | Two-column compare; clean and mechanical | ALIGNED |
| You Are in the Right Place | 290-313 | Membership / "this is for me" signal | Bullet "you belong here if" lists for patients + clinicians | ALIGNED |
| Built on a Moment | 316-360 | Trust the founder; see lived empathy | Photo + credential + miscarriage anecdote + mission line | ALIGNED |
| Common Questions | 363-400 | Answer the three or four blocking objections | 4 FAQs (evidence, advocacy, non-clinician, finding a provider) | PARTIAL |
| Research and Commentary | 403-418 | Where can I read the proof | Two-link block (Library, Commentary) | ALIGNED |
| CTA | 421-442 | What do I do next | "Your body is not broken" tagline + recap + two buttons | PARTIAL |

## Findings (alignment + warmth)

- id: W4-1
- severity: HIGH
- location: src/pages/index.astro:174-177
- excerpt: "Painful periods are not a personality trait. Irregular cycles are not 'just how you are.' Infertility is not unexplained. It is undiagnosed."
- issue: The page's first body paragraph is three declarative manifesto sentences. For a 1.1/5 OB-trust audience checking credibility, the first content beat needs recognition before declaration. Stats-and-claims-before-empathy is the exact failure mode the VOC skill flags.
- suggested_fix: "If you have been told your pain is normal, your cycles are difficult, or your infertility is unexplained, and something inside you has been quietly insisting that cannot be the whole story, you are reading the right page. Painful periods are not a personality trait. Irregular cycles are not 'just how you are.' Infertility is not unexplained. It is undiagnosed."
- voc_evidence: VOC skill: "Empathy before proof. Acknowledging negative emotions increases credibility by 40%." Buyer language: "I also don't know what I don't know" (verbatim post-IVF-failure quote). Recognition has to land before the manifesto.
- proposed_action_type: ADD-PROSE
- tags: [MICHELLE-WARMTH]
- disposition: DEFER

- id: W4-2
- severity: MEDIUM
- location: src/pages/index.astro:147-149
- excerpt: "{articleCount} scholarly works related to RRM cataloged and linked to authors, institutions, and topics."
- issue: Hero subtitle is a corpus inventory. Michelle is on a credibility check, not a database tour. The number is impressive but the verb does not connect to her question ("does this help me?").
- suggested_fix: "{articleCount} peer-reviewed studies on Restorative Reproductive Medicine, organized so you can read the evidence yourself before you trust anyone with what comes next."
- voc_evidence: Endo masterclass VOC: top motivation is "answers you won't find in a search" and "the right questions." Late-funnel Michelle wants the corpus framed as a tool she can use, not metadata about itself.
- proposed_action_type: REWRITE-PROSE
- tags: []
- disposition: APPLY-suggested

- id: W4-3
- severity: MEDIUM
- location: src/pages/index.astro:194-202
- excerpt: "When the warning light comes on in your car, you don't cover it with tape. You open the hood. For decades, women have been handed the tape..."
- issue: The car analogy lands as cleverness before recognition. For a high-anxiety reader, comparing her body to a car can read as flippant unless preceded by a sentence that names her experience. The argument is correct; the entry beat is cold.
- suggested_fix: Insert before line 196: "If you have spent years being told to live with what you know is not normal, this analogy will sound familiar. When the warning light comes on in your car, you don't cover it with tape. You open the hood."
- voc_evidence: VOC: "comfort going to ANY OB/GYN: 1.1 / 5." Patients have earned their skepticism. Open with recognition, then move to metaphor.
- proposed_action_type: ADD-PROSE
- tags: [MICHELLE-WARMTH]
- disposition: DEFER

- id: W4-4
- severity: MEDIUM
- location: src/pages/index.astro:296-302
- excerpt: "You belong here if: You have been told your painful or irregular cycles are 'normal'... You carry a diagnosis of 'unexplained' infertility. (Undiagnosed is the more accurate word. RRM finds what was missed.) ..."
- issue: The patient list is missing the largest Michelle-shaped pattern: the woman who has already done IVF or been told donor eggs are her only path. Audience-personas (Michelle baseline) calls this out specifically. Without that bullet, the most ready-to-convert visitor reads the list and does not see herself.
- suggested_fix: Insert as a new bullet between current bullets at line 299 and line 300: "You have been through one or more IVF cycles, or been told donor eggs or a hysterectomy is your only option, and you are looking for a different question to be asked about your body."
- voc_evidence: Michelle profile baseline (audit spec): "33-43, married, 1-7+ years trying to conceive, often post-failed-IVF or told donor-eggs-only." This is the visitor who is closest to converting and least represented in the current list.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: APPLY-suggested

- id: W4-5
- severity: MEDIUM
- location: src/pages/index.astro:391-397
- excerpt: "How do I find a surgeon or provider I can trust? Start with the right questions... RRM Academy gives you the knowledge to evaluate any provider, not just the ones on a list..."
- issue: The answer says "not just the ones on a list" but never tells her what list to start with. The single most common Michelle-state question on a homepage is "where do I actually go from here." The site has `/what-is-rrm/#get-started` as Brian's curated entry pathway (per memory `feedback-verify-external-urls.md`), but the homepage does not link to it.
- suggested_fix: Add a final sentence to the answer: "If you want a starting list while you build that confidence, the curated 'how to find a provider' pathway is at /what-is-rrm/#get-started."
- voc_evidence: Endo masterclass VOC: "How to pick the right surgeon" is the #1 motivation (13+ mentions). The homepage answer should not leave her with knowledge but no first step.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: APPLY-suggested

- id: W4-6
- severity: LOW
- location: src/pages/index.astro:175
- excerpt: "Painful periods are not a personality trait."
- issue: The line is good and very on-brand, but the rhythm of three manifesto sentences in a row is too dense for the first paragraph she reads. Splitting it across the recognition opener (W4-1) softens entry without losing the line.
- suggested_fix: Keep the sentence but route through the W4-1 rewrite, which preserves the same three lines as the second beat of the paragraph.
- voc_evidence: VOC empathy-before-proof rule. Same evidence as W4-1.
- proposed_action_type: REWRITE-PROSE
- tags: [MICHELLE-WARMTH]
- disposition: DEFER

- id: W4-7
- severity: MEDIUM
- location: src/pages/index.astro:262-265
- excerpt: "RRM does not declare that your body has failed and that technology must take over. It asks: what is actually wrong, and can it be fixed? Often, the answer is yes."
- issue: For a post-IVF reader, "technology must take over" reads as a soft jab at the path she has already walked. The high-anxiety-audience rule says "Never position against IVF combatively." The line is borderline. It can be reworded so the contrast lands as "different question" rather than "she chose wrong."
- suggested_fix: "RRM starts from a different question. Not 'how do we work around this?' but 'what is actually wrong, and can it be addressed?' Often, the answer is yes."
- voc_evidence: VOC: "'Instead of IVF' or 'better than IVF' asks her to invalidate a choice she already suffered for. Frame as 'a different approach to a different question.'"
- proposed_action_type: REWRITE-PROSE
- tags: []
- disposition: APPLY-suggested

- id: W4-8
- severity: LOW
- location: src/pages/index.astro:282
- excerpt: "Symptoms are masked while disease progresses undetected. Diagnoses are delayed by years. Hormonal suppression does not stop disease advancement. It hides it."
- issue: Strong line. Reads slightly clinical-prosecutorial in a section already labeled "Suppressive Medicine." The bullet on cost is correct factually; tightening keeps the section comparative rather than indicting.
- suggested_fix: "The cost: symptoms are masked while disease keeps advancing underneath. Diagnoses are delayed by years on average. Hormonal suppression does not stop disease, it hides it."
- voc_evidence: VOC: avoid combative posture; the comparative frame works only if the reader does not feel scolded for ever having been on the suppressive side.
- proposed_action_type: REWRITE-PROSE
- tags: []
- disposition: APPLY-suggested

- id: W4-9
- severity: LOW
- location: src/pages/index.astro:347-355
- excerpt: "Dr. Whittaker built RRM Academy because of her. And the thousands like her..."
- issue: The mission paragraph is good. It currently ends on the institutional mission ("RRM Academy exists to close both") without giving Michelle a sentence she can hold for herself. One additional clause would carry the founder block from credibility into membership.
- suggested_fix: Add as the final sentence of the paragraph at line 355: "If you have been carrying a question your doctor would not answer, you are exactly who Dr. Whittaker built this for."
- voc_evidence: VOC dual audience rule plus Michelle late-funnel mode: she is checking, "is this for me." A direct membership sentence at the end of the founder block answers that question.
- proposed_action_type: ADD-PROSE
- tags: [MICHELLE-WARMTH]
- disposition: DEFER

- id: W4-10
- severity: LOW
- location: src/pages/index.astro:424
- excerpt: "Your body is not broken. It is waiting to be heard."
- issue: The tagline is strong. The CTA section opens with it, then immediately pivots to "Most of the patients who find RRM Academy have spent years being told the wrong things" which moves the focus back to the systemic indictment instead of holding the membership beat. The CTA can land harder if the recap stays in second person.
- suggested_fix: At line 426-428, replace "Most of the patients who find RRM Academy have spent years being told the wrong things. That their pain is normal. That their cycles are just difficult. That their only option is to suppress or bypass." with: "Most of the people who find RRM Academy have spent years being told the wrong things. That your pain is normal. That your cycles are just difficult. That your only option is to suppress or bypass. None of those were the whole story."
- voc_evidence: VOC second-person address rule (we/you contract). The CTA loses Michelle when it switches into third-person "patients."
- proposed_action_type: REWRITE-PROSE
- tags: [MICHELLE-WARMTH]
- disposition: DEFER

- id: W4-11
- severity: LOW
- location: src/pages/index.astro:294
- excerpt: "For Patients"
- issue: The H3 reads as taxonomic. Buyers do not introduce themselves as "patients" to themselves; they think "is this for me." A softer H3 frames the same list without forcing the role label first.
- suggested_fix: Change H3 from "For Patients" to "If you are looking for answers about your own body" and the next H3 from "For Clinicians and Educators" to "If you are a clinician or allied professional."
- voc_evidence: VOC: "buyers arrive motivated but under-informed." The label "Patient" is a clinician word; "looking for answers about your own body" is the buyer's own framing of why she is here.
- proposed_action_type: REWRITE-PROSE
- tags: []
- disposition: APPLY-suggested

## VOC-gap recommendations

Each gap defaults to `disposition: BACKLOG`. Brian must explicitly approve via `APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS` to include in apply.

- id: W4-gap-1
- severity: HIGH
- location: src/pages/index.astro (homepage as a whole)
- excerpt: N/A (missing content)
- issue: No cost transparency anywhere on the homepage. Michelle arrives often post-IVF and is checking whether RRM is financially possible before she invests the next emotional cycle in research. The page never tells her courses range from free to $X, or that the library is free.
- suggested_fix: Add a single-sentence clause to the CTA paragraph (around line 432-433): "The Research Library is free to read. Courses range from free introductions to deep clinical training."
- voc_evidence: NeoFertility pricing-brief: Michelle's pricing-page intent is to find out "is this financially possible before I let myself hope." Same pattern carries to RRM Academy: cost is a silent disqualifier on the late-funnel trust page.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-2
- severity: HIGH
- location: src/pages/index.astro (between What RRM Looks Like and Two Approaches)
- excerpt: N/A (missing content)
- issue: No "what happens at a first appointment" beat. The page describes the philosophy and the contrast but never shows the buyer the mechanical steps. Michelle in late-funnel mode is asking "what would I do tomorrow morning if I decided this was the path."
- suggested_fix: Add a short "What a first step looks like" subsection after What RRM Looks Like with three bullets: charting a cycle, getting both partners assessed, finding an RRM-trained clinician. Each bullet links to the relevant guide.
- voc_evidence: VOC: top motivation is "the right questions" and "tools needed to pick the best doctor for me." A first-step block makes the pathway concrete and removes the "where do I even start" tax.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-3
- severity: MEDIUM
- location: src/pages/index.astro (homepage as a whole)
- excerpt: N/A (missing content)
- issue: No timeline expectation framing. Buyers want to know whether RRM is a 6-month or 2-year commitment so they can decide whether to start before age or AMH closes the window. Silence on timeline is read as evasion.
- suggested_fix: Add one sentence inside the "What RRM Looks Like" section: "Most people working through an RRM workup see a clearer diagnostic picture within three to six cycles, and treatment timelines depend on what is found."
- voc_evidence: Audience-personas (Michelle profile): age 33-43, AMH-driven urgency, post-failed-IVF. Timeline silence is a conversion killer for her cohort.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-4
- severity: MEDIUM
- location: src/pages/index.astro (homepage as a whole)
- excerpt: N/A (missing content)
- issue: No age-and-AMH framing. The page is silent on the most loaded number Michelle is carrying. She wants to see "is RRM still relevant if I am 41 and my AMH is 0.6" before she commits. The current page reads as if it were written for a 28-year-old at the start of trying.
- suggested_fix: Add to the "You Are in the Right Place" patient list: "You have been told your age or AMH puts you out of options, and you want to know what a different workup might still find."
- voc_evidence: Michelle profile baseline (audit spec). The age/AMH conversation is the silent first filter for her demographic.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-5
- severity: MEDIUM
- location: src/pages/index.astro:316-360
- excerpt: N/A (missing content from founder section)
- issue: "Will I actually see Naomi or get handed off" is a documented Michelle-pattern question (NeoFertility about-brief calls it out by name) and the founder section does not address it. The homepage links to her bio but does not say whether engaging with RRM Academy means engaging with her or with a faculty.
- suggested_fix: Add one sentence at the end of the founder block: "RRM Academy is the educational platform Dr. Whittaker built, and the courses, library, and commentary on this site reflect her clinical standards. Her surgical practice is separate and is not booked through this site."
- voc_evidence: NeoFertility about-brief: "will I actually see him or get handed off" is the explicit Michelle question. Same pattern transfers to Dr. Whittaker on RRM Academy.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-6
- severity: LOW
- location: src/pages/index.astro (homepage as a whole)
- excerpt: N/A (missing content)
- issue: No peer-mirror beat. The page makes its case in clinician language and founder voice but never lets a previous student or patient mirror Michelle's experience back to her. VOC skill calls peer stories the second beat after recognition.
- suggested_fix: Add a short pull-quote block (one sentence, attributed to a course alum) between the "Built on a Moment" section and the "Common Questions" section. Source from existing intake-survey free-response data.
- voc_evidence: VOC: "Recognize -> Mirror -> Prove." Mirror is missing entirely. Stats-after-recognition-and-peer-stories is the supported sequence.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-7
- severity: LOW
- location: src/pages/index.astro:421-442
- excerpt: N/A (missing content)
- issue: The CTA offers Courses + Library but no third path for the visitor who is not yet ready to enroll or read a study. The endo survey, ask tool, or guides could be a softer entry for a high-anxiety first-touch visitor.
- suggested_fix: Add a third secondary link below the two primary buttons: "Not ready for either? Start with the guides at /what-is-rrm/ or browse common questions."
- voc_evidence: Persona doc: `patient-curious` self-serve path is `/ask`; `clinical-appointment` is bridged at `/schedule-with-dr-whittaker/`. The homepage CTA currently routes only to courses + library, leaving the curious-but-not-ready persona with no soft entry.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

- id: W4-gap-8
- severity: LOW
- location: src/pages/index.astro (homepage as a whole)
- excerpt: N/A (missing content)
- issue: No mention of community or that other people are walking the same path right now. The site has a Community surface and Save the Uterus Club but the homepage does not signal the social dimension. Michelle in grief mode is checking for both clinical credibility and "am I alone in this."
- suggested_fix: Add a single sentence to the CTA paragraph: "There is also a community of students and members on this site who are walking the same questions you are."
- voc_evidence: VOC: high-anxiety audience checking "do they understand me." Community signal is one of the cheapest ways to answer that without overclaiming.
- proposed_action_type: ADD-PROSE
- tags: []
- disposition: BACKLOG

## Dropped recommendations (legitimization regex)

Two warmth recommendations were drafted, then dropped because the suggested_fix matched the banned-list. Documented here for traceability.

### Drop 1

- intended_id: W4-michelle-warmth-drop-1
- intended_location: src/pages/index.astro:262-265 (Two Approaches section)
- original_draft: "If you have already been through IVF, the clinicians who recommended it were not acting carelessly. They were working inside the paradigm they were trained in. RRM asks a different question."
- regex_pattern_fired: `not (irrational|being heartless|being cruel|acting carelessly|bad advice)` and `within (that|their) paradigm`
- why_dropped: Two banned phrases ("not acting carelessly", "inside the paradigm they were trained in") in one sentence. This is exactly the failure pattern documented in `feedback-michelle-scope-legitimization.md` (low-amh and fertility-after-35 incidents).
- replacement: Routed the same intent through W4-7 instead, which reframes as "different question" without legitimizing the prior clinician.

### Drop 2

- intended_id: W4-michelle-warmth-drop-2
- intended_location: src/pages/index.astro:296-302 (You Are in the Right Place patient list)
- original_draft: "You have been told donor eggs are your only real option, and you want to know whether that is genuinely the right option for you or whether something earlier in the workup was missed."
- regex_pattern_fired: `real option` and `right option`
- why_dropped: Two banned phrases. Even framed as a question, the words "real option" and "right option" trip the legitimization tripwire because they validate the donor-egg pathway as a legitimate baseline. This is the exact phrase pattern Brian rejected on fertility-after-35.
- replacement: Replaced with the W4-4 bullet, which addresses the same Michelle by naming the diagnosis ("told donor eggs or hysterectomy is your only option") without legitimizing it as right or real.

## Pages-clean

Sections that pass VOC alignment with no findings emitted:

- What RRM Looks Like (216-256). Cleanly delivers Phase-Phase-Phase with concrete examples; uses bolded lead-ins; respects Michelle's late-funnel "tell me what will actually happen" intent.
- Research and Commentary (403-418). Mechanical, accurate, and routes to the right surfaces.

The Built on a Moment / founder section (316-360) is also strong as written. The two findings against it (W4-9, W4-gap-5) are additive warmth or VOC-gap items, not corrections.
