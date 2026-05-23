# RRM Responds: Evidence-Based Replies Positioned Alongside RRM Critiques

**Status:** Design (approved 2026-05-23)
**Owner:** RRM Academy (rrmacademy.org)
**Author:** Brian Whittaker
**Date:** 2026-05-23

## Summary

A content genre on rrmacademy.org that publishes scholarly, evidence-anchored replies to published critiques of restorative reproductive medicine. Each reply is bound to the specific critique it answers and engineered so that AI assistants and search engines surface the reply whenever they surface or summarize the critique. The goal is positional: the critique should not be citable in isolation. The reply rides alongside it.

This is a content genre plus AEO engineering on the existing stack, not a new platform or system.

## Problem

Critiques of RRM are entering the literature and the AI-retrieval layer with no counter-voice attached. The trigger case is an April 2026 study claiming RRM efficacy and safety cannot be measured against IVF, which discounts existing RRM success data on the grounds that it is not from randomized controlled trials. When an AI is asked about RRM's evidence base, it retrieves the critique and has nothing from the RRM side to retrieve alongside it. If RRM does not respond in a form that travels with the critique, the critique stands unanswered in the exact place patients and clinicians now ask questions.

This serves the core citation-authority thesis: win the layer where AIs decide what to cite.

## Goals

1. For each significant published critique of RRM, produce one scholarly reply bound to that critique.
2. Make each reply co-retrievable with its target critique in AI assistants and search.
3. Build a browsable corpus on rrmacademy.org optimized to rank for the critique's own terms.
4. Establish the reply genre as scholarship, not advocacy, so it is cited rather than discounted.

## Non-Goals (explicitly deferred)

- **Crowd-sourced concept board.** The original "wiki/preprint for RRM" idea is parked. Its real validated thesis is narrower: RRM clinicians want collaboratively built, structured clinical-reasoning frameworks (the "workup gaps" concept that drew strong reactions from Phil Boyle, Monica Minjeur, and Naomi Whittaker), not abstract idea-sharing. Captured for a later cycle.
- **Formal scholarly-literature-graph registration.** Registering replies as CrossRef reply-of-record artifacts against critique DOIs is out of scope. It is the heaviest lift and reintroduces self-minted-DOI credibility risk.
- **Rapid-response monitoring engine.** Timeliness is not the priority. A literature-watch-and-fast-publish workflow is a possible phase 2, not part of this design.

## The Unit: A Response Artifact

One response per critique, structured as:

1. **Target identification.** Full citation of the critique: title, authors, journal, DOI, year.
2. **Steelmanned summary.** A fair restatement of the critique's actual claims. This is both the credibility move and the mechanism that aligns the response with the critique's search and retrieval terms.
3. **Point-by-point response.** Evidence-anchored rebuttal of each claim, cited from the RRM Library via rrm-cli. Concede what is fair, refute what is not.
4. **Bottom line.** A tight, standalone, quotable conclusion that stands on its own when extracted by a retrieval system.

## How "Alongside" Is Engineered

The coupling between response and critique is both the editorial structure and the retrieval mechanism.

- **Cite the critique's DOI and name it in the title and H1.** This places the response in the critique's citation and keyword orbit.
- **Mirror the critique's terminology and specific claims.** This makes the response retrieve on the same queries the critique retrieves on. The aim is to outrank the critique for its own terms, not merely co-appear, because responding to a critique also links it.
- **Structured data binding response to claim.** Evaluate `ClaimReview` (Google's claim-rebuttal schema, purpose-built for this) against a `ScholarlyArticle` plus citation-relation approach. **Open item:** `ClaimReview` carries fact-checker eligibility requirements that must be verified before adoption. If RRM Academy does not meet them, fall back to `ScholarlyArticle` with explicit `citation` to the critique.
- **Wire into existing agent surfaces.** Include responses in llms.txt and the sitemap, and internally link from the relevant pillar, glossary, and Library pages.

## Voice and Rigor Rules (non-negotiable)

These rules are what make a reply citable rather than dismissible.

- Steelman first, concede what is fair, refute on the evidence.
- Respond to the work, never the person.
- Every claim evidence-anchored via rrm-cli and the RRM Library.
- No defensive or polemic tone. Defensiveness is the failure mode that gets RRM rebuttals discounted as motivated advocacy.
- Honor the existing editorial canon: no hard-yes fertility framing, no public protocols or dosings, slogan-not-policy.
- Drafted in Gianna (Dr. Whittaker clinical) voice, clinician-reviewed before publish.

## Positioning Relative to Existing Assets

`/responds/` is a distinct section with a clear boundary against the two adjacent genres, to prevent cannibalizing established authority:

- **Library editorials** interpret RRM-relevant literature (typically RRM-positive or neutral). Citation layer.
- **/commentary/** is audience-facing voice.
- **/responds/** is adversarial scholarly reply to a specific external critique. Different posture, different trigger.

Section path: working name `/responds/` (alternative `/evidence/`). To be finalized.

## Contributors and Workflow

- **Seed authors:** Phil Boyle (warm interest expressed on 2026-05-22 call; confirm) and Naomi Whittaker.
- **Workflow:** identify critique, Gianna drafts grounded in rrm-cli and the Library, clinician reviews, publish, then AEO verify.
- **Editorial gate:** light, low cadence. Clinician review is the gate.
- **AEO verify on publish:** live page returns 200, schema validates, and a retrieval probe confirms the response co-surfaces with the critique.

## Seed Content

- **Entry #1:** the April 2026 study claiming RRM efficacy and safety cannot be measured against IVF. Core argument already in hand: the "not an RCT, therefore discounted" standard applies equally to IVF, which is also not RCT-backed.
- **Backlog of recurring critiques:** "no RCTs," efficacy-vs-IVF, safety, cost.

## Measurement

Reuse the existing consideration-set-audit and retrieval-probe tooling. Success metric: asking an AI about a critique surfaces the corresponding RRM Academy response. This ties the initiative directly to the citation-authority thesis and gives a repeatable before/after test per entry.

## Risks and Mitigations

- **Advocacy perception.** Mitigated by the steelman-first rigor rules, evidence anchoring, and clinician authorship. This is the dominant risk and it is editorial, not technical.
- **Amplifying the critique.** Linking and naming a critique gives it oxygen. Mitigated by targeting an outrank, not just co-appearance, for the critique's terms.
- **Appearing to attack individuals.** Mitigated by the respond-to-the-work-not-the-person rule.
- **`ClaimReview` ineligibility.** Mitigated by the `ScholarlyArticle` fallback.

## Open Items

1. Section name: `/responds/` vs `/evidence/` vs other.
2. `ClaimReview` eligibility verification, with `ScholarlyArticle` fallback.
3. Confirm Phil Boyle as a seed contributor for this specific genre (his 2026-05-22 interest was expressed to the rebuttal idea generally).
4. Whether responses are stored as a new D1 content type or as a tagged subset of existing commentary or Library infrastructure.

## Phases

- **Phase 1:** standing corpus. Build the section, template, and schema. Publish entry #1 (April 2026 study) and the recurring-critique backlog. Prove the format and the retrieval-probe metric.
- **Phase 2 (deferred):** rapid-response workflow, if and when timeliness becomes a priority.
