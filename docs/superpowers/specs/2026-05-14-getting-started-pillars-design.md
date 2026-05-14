# Getting Started With RRM, Two-Pillar Suite

**Version:** 1.3
**Date:** 2026-05-14
**Owner:** Brian (RRM Academy)
**Status:** Draft for review (scope-trimmed post-pass-3 review)
**Scope:** rrm-academy-cf

## 0. Changelog

**v1.3 (2026-05-14), Scope Trim**

Pass-3 `/arise --deep` revealed an asymptotic-complexity pattern: every new gate added in v1.2 introduced its own gate-bypass and gate-interaction vectors. Yield went 35 → 28 → ~30, not converging. Root cause: the policy pillar introduced ~7 new state-machine primitives (policy_brief_waitlist D1 table, attestation artifact format, reviewer-roster, segment-allowlist, abortion-content gate, MAHA mention budget, Foundation legal review) that each spawn their own failure modes.

Decision: **defer policy pillar to a separate spec** (`docs/superpowers/specs/2026-05-14-policy-pillar-deferred.md`). This spec covers ONLY the patient + provider pillars. The trim drops ~22 policy-specific findings; the 8 remaining findings get squashed inline.

Changes from v1.2:

- Removed §7.3 (policy pillar) entirely; content moved to deferred spec
- §1 Summary, §2 Problem & Opportunity, §3 Audiences, §4 Scope: dropped all policy-pillar references
- §5 URL Strategy: dropped `/for-policymakers/`
- §6 Shared template: dropped policy-specific deviations and policy-second-sentence
- §8 Cross-pillar rails: simplified to 2 pillars (patient ↔ provider); inert placeholder still applies for Phase 1 patient-pillar's provider rail
- §9 Editorial constraints: dropped policy-specific rules (Foundation lobbying language, MAHA budget, secular descriptor, abortion section-aware gate, Naomi-not-on-policy-pillar)
- §10 JSON-LD: dropped policy pillar block; dropped Foundation `sameAs` (no longer needed without policy pillar); `#organization` still RRM Academy
- §11 Metrics: dropped policy section
- §12 Rollout: collapsed Phase 3 entirely; now just Phase 1 (Wks 1-3) + Phase 2 (Wks 4-6); gates trimmed from 28 to 16 (dropped Naomi-leak Phase 3 gate, MAHA budget, abortion gate, foundation co-brand audit, attestation artifact, reviewer roster, foundation-site Org JSON-LD assertion, policy-specific schedule gates)
- §13 Risks: dropped R3 (501(c)(3) policy advocacy), R4 (MAHA partisan), R6 (Naomi leak via policy JSON-LD), R7 (PDF promise slip), R15 (Foundation legal review slip); R13 stays (discoverability surface)
- §14 Open Questions: dropped Q6, Q7, Q8, Q9, Q14 (policy-pillar-specific)
- §15 Decisions Log: D-decisions kept but D6, D7 (partial), D8, D18, D25, D28, D29, D30, D35, D37 marked "MOVED to deferred spec" instead of removed (preserves squash history)

**v1.3 pass-3 squash (8 findings remaining after scope trim):**

- §12 #24+#27 ordering contradiction → resolved by accepting CF Pages atomic-deploy semantics; gate #24 rewritten to post-deploy verification via gate #22 (within 60s of deploy completion)
- §12 #22 new-pillar-after-sibling case → split into #22a (back-edit on previously-shipped) + #22b (new-ship rail verification: new pillar contains LIVE rails to already-shipped siblings)
- §12 Rollback step inverted-gate → rollback step uses dedicated `--inverted` mode of helper script (asserts inert rail present, live rail absent)
- §8 inert-rail markup → strips `data-future-href` AND `data-rail-state` AND `aria-disabled` at back-edit (canonical post-back-edit template added); gate #22 splits the two assertions so lone-leftover attribute is caught
- §8 inert-rail WCAG 2.5.3 → `aria-label` dropped; accessible name computes from visible text + sr-only; parentheses replace " , coming soon" comma
- §12 Naomi-leak grep → regex covers `Whit{1,2}aker` (Whitaker one-t whisper-transcript typo per `feedback-whisper-whittaker-typo.md`); applies to ALL pillars in scope
- §12 #25 daily citation-link cron → runtime named (GitHub Actions schedule in `.github/workflows/verify-pillar-citations.yml`); notification routes to SES + administrator@rrmacademy.org per overwatch-worker pattern (NOT retired n8n)
- §13 R8 + D40 errata_count → moved to "Prerequisites" section in §4; rrm-library-worker migration + PubMed `<CommentsCorrectionsList>` parser are Phase 1 prereqs

## 1. Summary

Two new top-of-funnel pillar pages on rrmacademy.org, one per audience: patient/civilian and provider/clinician. Each answers the question "How do I get started with RRM?" for its audience without competing with the existing conceptual pillars (`/what-is-rrm/`, `/naprotechnology/`, `/neofertility/`). The patient pillar is the default landing point at `/getting-started/`. The provider pillar lives at `/for-providers/`. The two pillars share a structural template, a 2-sentence "what RRM is" definition block, an audience-router rail at the top, and a "Where next" rail at the bottom. Voice and citation density diverge per audience. The suite ships in two phases: patient first, provider second. A policy pillar is deferred to a separate spec.

## 2. Problem & Opportunity

The site has nine pillar pages today, all conceptual ("what is X"). None answer "I am a [patient | clinician]; what do I do next?" The result:

- **Patient funnel collapses at intent.** `/what-is-rrm/#get-started` exists as an anchor inside a 14,300-word page, but a cold visitor searching "how to start naprotechnology" lands on conceptual content and bounces before reaching the action step.
- **Provider funnel has no on-ramp.** Clinicians searching "naprotechnology training", "RRM certification", "FEMM Foundations" land on patient-tilted pillars or external sites (IIRRM, FertilityCare). The academy is leaving provider-acquisition signal on the table.

The two pillars solve both funnels with the same shared template and one writing pass per audience. A separate spec will address the policy / policymaker audience when scope warrants the additional complexity.

## 3. Audience Definitions

### Patient / civilian
A person who has heard "NaProTechnology" or "fertility awareness" once and is dealing with infertility, endometriosis, PCOS, recurrent miscarriage, irregular cycles, or post-pill recovery. Or simply curious about ethical fertility care. Has never heard "RRM" as an umbrella term. Highest organic-search volume.

### Provider / clinician
Physicians (OBGYN, REI, family medicine, internal medicine), NPs, midwives, PAs, pelvic-floor PTs, dietitians, allied health, fellows, residents. Either ACOG/ASRM-skeptical and looking for an alternative, or RRM-curious and wondering how to train. Mid-funnel for IIRRM membership and the practitioner courses.

## 4. Scope

### In scope (this spec)
- Two new pillar pages at `/getting-started/`, `/for-providers/`
- Shared 2-sentence "what RRM is" definition block (principle-level only)
- Audience-router rail at top of each pillar (with inert placeholder semantics for not-yet-shipped sibling, per §8; relevant for Phase 1 patient pillar pointing to not-yet-shipped provider pillar)
- "Where next" rail at bottom of each pillar
- JSON-LD per pillar (`Article` + `MedicalWebPage` with `medicalAudience` + `BreadcrumbList` + `FAQPage`)
- FAQ accordion section (count specified per pillar in §7.1, §7.2)
- Inline citations + references list, all linking to verified library slugs
- Per-phase deploy-infrastructure gates: edit `rrm-router/src/index.js` `ASTRO_ROUTES`, register pillar in `ssot/pillars.json`, register pillar in `/guides/` catalogue source, bump `deploy.yml` `guides_count` assertion (current `-ne 11` → 12 → 13), run CI gate `scripts/gates/validate-pillar-registry.mjs`
- Daily citation-link cron in `.github/workflows/verify-pillar-citations.yml` (GitHub Actions schedule); notification routes to SES email + administrator@rrmacademy.org per overwatch-worker pattern
- Internal-link audit against existing pillars to prevent cannibalization

### Prerequisites (must ship before Phase 1)
- `rrm-library-worker` migration adding `errata_count INTEGER DEFAULT 0` + `last_errata_date TEXT` columns to `article` table
- `rrm-library-worker/src/pubmed.js` extension to parse `<CommentsCorrectionsList><CommentsCorrections RefType="ErratumIn">` entries and count them
- Backfill cron run over existing cited PMIDs
- `src/data/pillar-reviews.json` build-time emit from each pillar's `.astro` frontmatter `lastReviewed` field; this is the source of truth for the quarterly erratum audit

### Out of scope (separate workstream / future spec)
- Provider directory live integration (depends on `rrm-provider-directory` project ship; Phase 1 v1 of provider pillar uses "directory coming soon" + IIRRM external link)
- Translation (English only at launch)
- App-shell guides-nav inclusion (deferred; pillars live in `/guides/` catalogue only until product call)
- Building a dedicated `/method-picker/` page (deferred to v2; Phase 1 secondary CTA targets `/what-is-rrm/#fabms` until such a page exists)
- **Policy pillar `/for-policymakers/`** , deferred to `docs/superpowers/specs/2026-05-14-policy-pillar-deferred.md`. That spec captures the policy-pillar audience, CTAs, schemas (policy_brief_waitlist), Foundation legal review attestation, reviewer roster, segment-allowlist newsletter extension, abortion-content section design, MAHA mention budget, and related risks.

### Anti-goals (explicit non-goals)
- Replacing `/what-is-rrm/`. That page keeps the deep conceptual treatment; these pillars are action-oriented.
- Cannibalizing `/naprotechnology/`, `/neofertility/`, condition pillars. New pillars must internal-link, not duplicate.
- Telehealth-first framing on the patient pillar. RRM is in-person-first by clinical design.
- Hilgers protocols, dosing, or prescriptive field-level RRM intervention claims on any of the two pillars. Principle-level only; named methods (NaProTechnology, NeoFertility, FEMM, Creighton, Marquette, Billings) own protocols.

## 5. URL Strategy

Flat URLs, matching the 2026-03-12 IA decision in `STYLE-GUIDE.md`.

| Audience | URL | Title (H1) | Eyebrow |
|---|---|---|---|
| Patient | `/getting-started/` | Getting Started With RRM | A Patient Guide |
| Provider | `/for-providers/` | RRM For Providers | A Clinician's Guide |

### Slug rationale
- `/getting-started/` carries the highest-intent generic search and reads naturally inside an RRM education site context. No disambiguation needed because site context establishes "RRM".
- `/for-providers/` complements the existing `/providers/` directory landing without conflicting. `/providers/` is the directory; `/for-providers/` is the on-ramp.

### Pre-publish deploy-infrastructure gates
Verified against current `src/pages/` listing as of 2026-05-14: neither slug exists. Beyond pages, deploy-time gates also confirm (see §12 for operational steps):

1. **rrm-router gate**, slug added to `ASTRO_ROUTES` and redeployed before Astro deploy.
2. **`ssot/pillars.json` gate**, pillar registered with all required fields; CI gate passes.
3. **`/guides/` catalogue gate**, pillar source-of-truth entry; build-time rendering verified.
4. **`deploy.yml` `guides_count` bump**, the hardcoded `if [ "$guides_count" -ne 11 ]` is bumped per phase: 11→12 (Phase 1 PR), 12→13 (Phase 2 PR). Alternative: refactor to read length from `ssot/pillars.json` once, eliminating the hardcoded constant.
5. **App-shell wrap gate**, if pillar is intended to render inside the shell (recommended), `isShellEnabled('guides')` is wired and pillar uses `<MaybeShell>` with `<SectionTocChips>`.

## 6. Shared Structural Template

Both pillars use the existing pillar template established by `/what-is-rrm/`, `/naprotechnology/`, `/endometriosis/`, etc. Identical scaffolding except where flagged per-audience:

```
+---------------------------------------------------+
| Breadcrumb                                        |
| Eyebrow + Hero title                              |
| Byline + last-modified date                       |
| 2-sentence shared "what RRM is" definition block  |
| Audience-router rail (top; inert for unshipped)   |
+---------------------------------------------------+
| Sticky TOC (left desktop, chip-pill mobile)       |
|                                                   |
| Section 1: Key takeaways (5-6 audience bullets)   |
| Section 2-N: Audience-specific body sections      |
| Section: FAQ accordion                            |
| Section: References list                          |
| Section: "Where next" rail (bottom)               |
+---------------------------------------------------+
| Footer + page-end CTA                             |
+---------------------------------------------------+
```

### Shared definition block (principle-level; identical across both)
> Restorative Reproductive Medicine is a model of women's health care focused on diagnosing and treating the underlying causes of cycle disorders, infertility, and miscarriage. Named methods (NaProTechnology, NeoFertility, FEMM, Creighton, Marquette, Billings) each define their own clinical protocols, while sharing the principle of restoring fertility and reproductive health rather than bypassing it.

This block is hardcoded in a shared partial so any future edit propagates to both pillars in a single deploy. Edits are intentionally rare; JSON-LD `dateModified` shifting across both simultaneously is expected and tolerated. Bundle definition edits with at least one substantive section edit per pillar so Google sees real content change, not just a metadata shift.

### Provider-specific deviations
- Hero eyebrow reads "A Clinician's Guide"
- Citation density higher than patient pillar (peer-defendable)
- "Refer a patient" lateral CTA in addition to the training CTA

## 7. Per-Pillar Content Scaffolds

### 7.1 Patient pillar `/getting-started/`

**Voice:** Gianna (Naomi clinical voice for patient comms).
**Byline at top of page:** `Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI` (full credential string, matching `/naprotechnology/` and `/what-is-rrm/` precedent). In body prose, reference as "Dr. Whittaker" per honorific rule.
**Target length:** 4,500 to 6,000 words

#### Sections (TOC)
1. Key takeaways
2. What RRM is, in two sentences (shared block; faith-neutral lede)
3. Is RRM right for my situation? (problem router: infertility / endo / PCOS / miscarriage / irregular cycles / post-pill, in-page anchors to existing condition pillars)
4. How RRM differs from what your OBGYN already offers
5. Find a provider (the action step, primary CTA)
6. How much does it cost vs IVF
7. Insurance and what to expect
8. Timeline: what the first 12 months look like
9. What to bring to your first appointment
10. Red flags: behavior patterns to watch for (no specific clinic names)
11. Common questions (FAQ accordion, 10 entries; see "Hardest objections" below for required entries)
12. References

#### Hardest objections (placement: FAQ accordion entries 1, 2, 4, 6, 8)
Religious-origin discussion is opt-in (FAQ entry 4), not in body. Faith-neutral lede in §2.

1. "This is just 'natural family planning' rebranded." No: FABM is the diagnostic tool; named methods (NaProTechnology, NeoFertility, FEMM, Creighton, Marquette, Billings) provide the medical/surgical superstructure that uses FABM as input.
2. "My OB said this isn't evidence-based." Counter with published cohorts (Boyle 2025, Stanford 2021, Sánchez-Méndez 2025) and the IVF-evidence double-standard reframe.
3. "RRM doctors will just delay me and I'll run out of time." Workup runs in parallel with the ART clock; RRM does not gatekeep IVF.
4. "Is this Catholic / religious medicine?" (FAQ entry, opt-in by click), The medical workup is standard OBGYN. Specific methods originated in different clinical settings (NaProTechnology at the Pope Paul VI Institute; FEMM in a non-confessional foundation; Marquette at a Catholic university; Billings in Australia) and are practiced internationally by clinicians of every faith and none. RRM as a category is faith-neutral.
5. "This is only for infertility." Reframe as women's-health-first: cycle disorders, endometriosis, PCOS, miscarriage, postpartum, perimenopause.

#### Must-cite facts (8)
| Claim | Source | Library slug |
|---|---|---|
| RRM 2019 cohort live-birth rate vs single IVF cycle outcomes | Boyle P et al., 2025, *JRRM* | `restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd` |
| US family-medicine cohort RRM outcomes | Stanford JB et al., 2021, *BMC Pregnancy Childbirth* | `restorative-reproductive-medicine-for-infertility-in-two-family-medicine-clinics-recyiv7uvglmix9ex` |
| 1,310-couple 5-yr NaPro cohort take-home-baby rate | Sánchez-Méndez JI et al., 2025, *Front Reprod Health* | `natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa` |
| Creighton Model + FABM effectiveness systematic review | Peragallo Urrutia R et al., 2018, *Obstet Gynecol* | `effectiveness-of-fertility-awareness-based-methods-for-pregnancy-prevention-a-sy-recd5efxu6j5ww0j8` |
| Creighton Model SORT-A correct-use effectiveness | Manhart MD et al., 2013, *Osteopathic Family Physician* | `fertility-awareness-based-methods-of-family-planning-a-review-of-effectiveness-f-recpanxsmpcrgo8zq` |
| US endometriosis prevalence + symptomatic burden | Fuldeore MJ, Soliman AM, 2017, *Gynecol Obstet Invest* | (verify slug at ingest time; end-to-end pre-flight via `/rrm-ingest` , all 6 stages including publish + live verify , before Week 1 writing pass) |
| US infertility / impaired-fecundity baseline prevalence | Chandra A, Copen CE, Stephen EH, 2014, NSFG 1982-2010 | (verify slug at ingest time; end-to-end pre-flight via `/rrm-ingest` , all 6 stages including publish + live verify , before Week 1 writing pass) |
| Healthy singleton pregnancies after failed IVF, RRM rescue cohort | Boyle PC et al., 2018, *Front Med* | `healthy-singleton-pregnancies-from-restorative-reproductive-medicine-rrm-after-f-recior3akxtg2a6ya` |

#### CTA ladder
1. **Primary: Find a provider near you.** Phase 1 fallback target: `/what-is-rrm/#get-started` (Brian's curated find-a-provider rail), because `/providers/` is currently a noindex waitlist stub. Once `rrm-provider-directory` ships, swap target to `/providers/` (triggered by §12 gate #16).
2. **Secondary: Learn about fertility-awareness methods.** Phase 1 target: `/what-is-rrm/#fabms` (verified existing anchor; not `#methods` which does not exist). Build of a dedicated method-picker page is a v2 backlog item, out of scope here.
3. Tertiary: Take a course (`/courses/`).
4. Soft: Join Save the Uterus Club (community).
5. Bottom: Read the research yourself (`/library/`).

#### Editorial constraints
- FAQ answers on fertility / pregnancy / treatment questions never lead with strong affirmatives (Yes, Absolutely, Sure, Definitely, Of course, Certainly, Yeah, Indeed, Affirmative, Correct, Most certainly). Lead with "In many cases, …" or evidence-statement framing instead. "No" answers are different risk class, leave alone.
- No religious framing in the lede or body. The Catholic-origin discussion appears only in FAQ entry 4 (opt-in by click).
- No Hilgers protocols, dosing, or named-method-prescriptive claims in body. Specific protocols belong to named methods.
- No telehealth-first framing.
- No "guaranteed" or "cure" language for endometriosis or infertility.
- §10 "Red flags": describe behavior patterns (no peer-reviewed work cited, no fertility-awareness charting integrated into workup, no surgical follow-through, dismissive of underlying causes). Never name specific clinics by name. Trade-libel safety.

### 7.2 Provider pillar `/for-providers/`

**Voice:** Gianna (Naomi clinical voice), peer-to-peer.
**Byline at top of page:** `Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI`. In body prose, reference as "Dr. Whittaker".
**Target length:** 5,500 to 7,000 words

#### Sections (TOC)
1. Key takeaways
2. What RRM is, in two sentences (shared block)
3. Why this is an actual medical category, not a side credential
4. The evidence base, at a level you can defend to your department
5. Training pathways and certification (NaProTech, NFPMC, FEMM Foundations, Creighton FCP, NeoFertility, Boma-Deutsch)
6. Integrating RRM into OBGYN / family medicine / midwifery / pelvic-floor practice
7. Diagnostic protocols at a high level (no dosing; refer to method-specific training)
8. Evidence by condition (infertility, endo, PCOS, miscarriage)
9. Referral relationships: refer in, refer out, or co-manage
10. Find peers near you (IIRRM directory + provider directory once live)
11. Common questions (FAQ accordion, 10 entries)
12. References

#### Hardest objections to address
1. "ACOG and ASRM say this isn't evidence-based." Counter via the `acog-asrm-rebuttal` framework in the library and the IVF-evidence double-standard.
2. "This is Catholic medicine and my hospital won't credential it." The medical workup (HSG, laparoscopy, hormone panels, PCOS metabolic management, miscarriage workup) is standard OBGYN coded with standard CPT. Method-specific philosophical commitments are separate from the procedures.
3. "FABM tracking is patient-reported and unreliable." Counter with Stanford 2024 simulated-comparison data, FABM-effectiveness systematic review (Peragallo Urrutia 2018), and decades of method-specific effectiveness literature.
4. "There's no way to practice this and pay my staff." Sánchez-Méndez 2025 five-year sustained-practice cohort (1,310 couples); Stanford 2021 family-medicine integration; NeoFertility cash-pay model; STORRM clinic template.
5. "This delays patients past the fertility window." Workup runs in parallel with the ART clock; addresses underlying disease ART pipelines do not.

#### Must-cite facts (8)
| Claim | Source | Library slug |
|---|---|---|
| iNEST international NaPro registry methodology and enrollment | Stanford JB et al., 2022, *Hum Reprod Open* | `international-natural-procreative-technology-evaluation-and-surveillance-of-trea-recudgdct40otosdm` |
| RRM vs single-IVF-cycle retrospective comparison | Boyle P et al., 2025, *JRRM* | `restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd` |
| Family-medicine RRM cohort, New England | Stanford JB et al., 2021, *BMC Pregnancy Childbirth* | `restorative-reproductive-medicine-for-infertility-in-two-family-medicine-clinics-recyiv7uvglmix9ex` |
| 1,310-couple 5-yr NaPro single-center cohort | Sánchez-Méndez JI et al., 2025, *Front Reprod Health* | `natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa` |
| FABM effectiveness systematic review | Peragallo Urrutia R et al., 2018, *Obstet Gynecol* | `effectiveness-of-fertility-awareness-based-methods-for-pregnancy-prevention-a-sy-recd5efxu6j5ww0j8` |
| Short luteal phase / miscarriage cohort | Duane M et al., 2022, *BMC Pregnancy Childbirth* | `does-a-short-luteal-phase-correlate-with-an-increased-risk-of-miscarriage-a-coho-recsypcebszclpsk1` |
| Surgery in RRM methodology overview | Yeung P, 2025, *JRRM* | (verify slug at ingest time; end-to-end pre-flight via `/rrm-ingest` before Week 4 writing pass; if paper not yet published in JRRM at Phase 2 time, fall back to Yeung's prior surgical-RRM citation in library or remove from must-cite) |
| IVF perinatal-outcome comparison vs sibling unassisted | Reeder MR et al., 2026, *Fertility & Sterility* | (verify slug at ingest time; end-to-end pre-flight via `/rrm-ingest` before Week 4 writing pass; if not in PubMed at Phase 2 time, fall back to comparable F&S cohort or remove from must-cite) |

#### CTA ladder
1. **Primary: Take the practitioner course.** Links to applicable method's training landing page (org-level only, never instructor-page; verify each linked URL contains no individual-instructor attribution before merge, per Q4 + R11 symmetry).
2. Secondary: Join IIRRM (org-level membership page, not Naomi's role page).
3. Tertiary: List in the provider directory. v1 says "directory coming soon, join the waitlist" with link to `/providers/` waitlist; v2 swaps in directory search once `rrm-provider-directory` ships (per §12 gate #16).
4. Lateral: Refer a patient now. v1 target = IIRRM external directory listing (since `/providers/` is a waitlist stub); v2 swaps in `/providers/` search.
5. Bottom: Partner program / clinic affiliate (links to `/partners/`).

#### Editorial constraints
- No Hilgers protocols or dosing on the public page (private clinician-portal OK).
- No prescriptive RRM field-level claims; principle-level only, with named-method ownership of specifics.
- No clinical decision support (that's a clinician-portal artifact behind auth).
- No salary or income claims for RRM practice (no published data; speculation breeds liability).
- No anti-IVF rhetoric; counter-evidence is fine, animosity is not.
- Naomi byline is permitted (clinical authority context); no UPMC-related promotional framing.
- Religious-origin discussion appears only in FAQ accordion (opt-in by click), not body objections.

## 8. Cross-Pillar Interlinking Rails

Each pillar carries two structural rails. The audience-router (top) catches misrouted visitors. The "Where next" rail (bottom) routes the visitor onward.

### Rail rendering states

For not-yet-shipped sibling pillars, the audience-router rail renders as an **inert placeholder**, not a broken link. This applies during Phase 1 (patient pillar live, provider pillar not yet shipped). Canonical inert markup:

```html
<span class="audience-rail audience-rail--inert"
      role="link"
      aria-disabled="true"
      data-rail-state="inert"
      data-future-href="/for-providers/">
  Are you a clinician? Read RRM For Providers
  <span class="sr-only"> (coming soon)</span>
</span>
```

Note: visible-text and accessible-name match (WCAG 2.5.3 Level A); no `aria-label` override. Parentheses around "coming soon" render as a brief SR pause (not literal "comma comma"). Voice-control users speaking "click clinician" or "Read RRM For Providers" can match.

Plus a page-level JSON-LD `Action` node:

```json
{
  "@type": "Action",
  "name": "Read RRM For Providers",
  "actionStatus": "PotentialActionStatus",
  "target": "https://rrmacademy.org/for-providers/"
}
```

Plus CSS rule registered in `docs/design/design-system.manual.json` and emitted via `npm run design-tokens`:
- `.audience-rail--inert`, muted text color (`--color-text-secondary`), reduced opacity, no underline, `cursor: not-allowed`.

### Canonical post-back-edit markup

When the sibling pillar ships, the back-edit step REPLACES the entire inert `<span>` with:

```html
<a class="audience-rail"
   href="/for-providers/">
  Are you a clinician? Read RRM For Providers
</a>
```

The back-edit strips ALL three inert-state attributes: `data-rail-state`, `data-future-href`, `aria-disabled`. The sr-only "(coming soon)" span is also removed. The JSON-LD `Action` node with `PotentialActionStatus` is dropped from the page's `@graph`.

Verification (per §12 gates #5a + #5b): post-back-edit live rail HTML has live `href` AND no `data-future-href` AND no `data-rail-state` AND no `aria-disabled`.

### Patient pillar
- Top rail: "Are you a clinician? Read RRM For Providers." (inert during Phase 1; live after Phase 2 ship per §12 back-edit step)
- Bottom rail: deeper RRM pillars (`/what-is-rrm/`, `/naprotechnology/`, `/neofertility/`), method-specific pages, condition pillars (`/endometriosis/`, `/pcos/`), Save the Uterus Club, library.
- Lateral: Provider directory (Phase 1 fallback: `/what-is-rrm/#get-started`; v2 once directory ships: `/providers/`, swap triggered by §12 gate #16).

### Provider pillar
- Top rail: "Patient looking for care? Get started here." (always live to /getting-started/ since patient ships first)
- Bottom rail: IIRRM, library, clinical commentary, `/courses/`, `/partners/`.
- Lateral: Provider directory (Phase 1 fallback: IIRRM external; v2: `/providers/` search), foundation contact (form-based, not mailto).

### Cannibalization safety
- Existing pillars (`/what-is-rrm/`, condition pillars) keep deep conceptual treatment.
- New pillars are top-of-funnel action-oriented; they internal-link to the conceptual pillars, never duplicate them.
- Run the cannibalization audit playbook (`docs/cannibalization-audit-2026-05-13.md`) against the live pillars after each phase ships. R1 expanded remediation (§13) defines what to do if regression is detected.

## 9. Voice, Byline, Editorial Constraints (Suite-Wide)

| Rule | Rationale | Source |
|---|---|---|
| No em-style dashes anywhere (U+2014 em-dash, U+2013 en-dash, U+2212 minus, U+2012 figure-dash, U+2015 horizontal bar, `&mdash;`, `&ndash;`, `&#8212;`, `&#x2014;`); use hyphens or rewrite | User preference | `~/CLAUDE.md` |
| No Hilgers protocols, dosing, prescriptive RRM field-level claims | HARD RULE | `feedback-no-public-protocols-or-dosings.md`, `feedback-no-prescriptive-rrm-field-claims.md` |
| No FAQ lead with strong affirmatives (Yes, Absolutely, Sure, Definitely, Of course, Certainly, Yeah, Indeed, Affirmative, Correct, Most certainly) on fertility / pregnancy / treatment questions | HARD RULE | `feedback-no-hard-yes-fertility-faqs.md` |
| Patient and provider pillar bylines use the canonical `author-byline` + `has-reviewer` pattern: author = "RRM Academy"; reviewer = "Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI". No in-body references to Naomi by name. | HARD RULE | `feedback-naomi-honorific-to-members.md` + `feedback-naomi-profile-updates-on-hold.md` (UPMC capture-only) + glossary precedent |
| RRM is in-person-first; no telehealth-first framing on patient pillar | Editorial | This spec |
| Faith-neutral lede on patient pillar; religious-origin discussion only in FAQ accordion entries (opt-in by click), never in body objections list | Editorial | This spec |
| No specific clinic names in patient pillar §10 Red Flags; use behavior patterns only (trade-libel safety) | Editorial / Legal | This spec |
| Both pillars must pass `/arise --deep` with 0 CRITICAL and 0 HIGH findings before merge; max 3 passes per phase; remaining HIGHs after pass 3 require Brian sign-off documented in §15 decisions log | Spec-review process | `arise-intel-2026-05-07.md` |

### Voice fan-out
- Patient pillar: Gianna writes (Naomi voice for patient comms).
- Provider pillar: Gianna writes (Naomi voice for clinician peer-to-peer).

### Concurrent-edit protocol
- Per-claim canonical framing lives in rrm-cli voice/cite intents (`rrm-cli search "topic" --intent=cite --full`).
- Before any pillar edit touching a shared claim, refresh framing from rrm-cli.
- Cross-pillar claim audit step is §12 gate #14: after each ship, diff cited claims across both pillars; flag drift.
- When Brian + Gianna both have drafts open on overlapping claims, the rrm-cli canonical wins; whoever lands later refreshes from rrm-cli before merge.

## 10. SEO + AEO Design

### Title tags
| Pillar | Title (50 to 60 chars) |
|---|---|
| Patient | Getting Started With RRM | RRM Academy |
| Provider | RRM For Providers: A Clinician's Guide | RRM Academy |

### Meta descriptions
- Patient: "How to find an RRM-trained doctor, what to expect, costs, timeline, and the differences from IVF-centered care. Start your fertility journey here."
- Provider: "Training pathways, evidence by condition, integration patterns, and referral networks for clinicians exploring restorative reproductive medicine."

### Primary keyword targets
- Patient: "getting started with rrm", "how to start naprotechnology", "rrm for patients", "what to expect rrm", "find rrm doctor"
- Provider: "rrm training", "naprotechnology training", "rrm certification", "rrm for doctors", "iirrm membership", "femm foundations"

### JSON-LD per pillar

`#organization` on both pillars resolves to **RRM Academy** (the publisher entity, defined in `ssot/organization.json`). `#naomi-whittaker` Person node appears on both pillars' `Article.author`. Each pillar's `.astro` frontmatter exposes a `lastReviewed` ISO 8601 date (build-time emit to `src/data/pillar-reviews.json` for the quarterly erratum cron).

**Patient pillar:**
```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "BreadcrumbList", "..." },
    { "@type": "Article", "headline": "...", "datePublished": "...", "dateModified": "...", "author": { "@id": "#naomi-whittaker" }, "publisher": { "@id": "#organization" } },
    { "@type": "MedicalWebPage", "mainContentOfPage": "...", "lastReviewed": "...", "medicalAudience": { "@type": "MedicalAudience", "audienceType": "Patient" } },
    { "@type": "FAQPage", "mainEntity": ["..."] }
  ]
}
```

**Provider pillar:** same shape; `medicalAudience.audienceType: "Clinician"`.

During Phase 1 only, patient pillar emits an additional `Action` node (per §8) marking the not-yet-shipped provider rail as `PotentialActionStatus`. Removed at Phase 2 back-edit.

### AEO (retrieval) optimization
- Each pillar's H2 sections are quotable in 1 to 3 sentences (per `geo-content-optimizer` skill conventions).
- Stat citations include the source name in-paragraph so retrieval LLMs can cite the source by name without resolving the footnote.
- `llms.txt` entry per pillar after launch (2 new entries).
- Run `rrma-seo-operator` retrieval baseline at launch; re-run at 30 / 60 / 90 days.

## 11. Success Metrics

Metric definitions are fixed in advance to make success/failure calls falsifiable.

**Definitions:**
- **Start clock** = first day with a non-zero GSC click on the pillar's primary URL (not the deploy date).
- **Click-through denominator** = GA4 sessions with a pageview of the pillar URL.
- **"AI citation"** = the pillar URL appears in a Perplexity / ChatGPT (browse) / Gemini / Google AI Overview response for the listed query, verified by manual spot-check during the metric window.

### Patient pillar
- Top-3 SERP position for "getting started with rrm" within 90 days of start clock
- 1,000 monthly organic sessions within 180 days of start clock
- 5% session-based click-through to the primary CTA target (Phase 1: `/what-is-rrm/#get-started`; v2: `/providers/`). When the target swaps (per §12 gate #16), the 180-day window resets and prior measurements are footnoted, not erased.
- 2% session-based click-through to `/courses/`
- AI citation for "how do I start with naprotechnology" within 60 days of start clock

### Provider pillar
- 300 monthly organic sessions within 180 days of start clock
- 30% scroll depth past the training-pathways section
- 8% session-based click-through to a method-training landing page
- 5% session-based click-through to IIRRM membership page
- 10 partner-program inquiries via `/partners/` within 180 days attributable to this pillar (via UTM tagging)

## 12. Rollout Plan

Two phases, one pillar per phase. Each phase ships independently and is verifiable.

### Prerequisites (before Phase 1 starts)
- `rrm-library-worker` migration adds `errata_count INTEGER DEFAULT 0` + `last_errata_date TEXT` to `article` table; migration applied to remote D1
- `rrm-library-worker/src/pubmed.js` parses `<CommentsCorrectionsList><CommentsCorrections RefType="ErratumIn">` entries and counts them
- Backfill cron runs against existing cited PMIDs (Boyle 2025, Stanford 2021, Sánchez-Méndez 2025, Manhart 2013, Peragallo Urrutia 2018, Stanford 2022 iNEST, Duane 2022, Boyle 2018) and populates errata_count for each
- `.github/workflows/verify-pillar-citations.yml` exists with daily schedule; sends SES email to administrator@rrmacademy.org on any citation 404 (overwatch-worker notification pattern)
- `src/data/pillar-reviews.json` build-time emit from each pillar's `lastReviewed` frontmatter

### Phase 1: Patient pillar (Weeks 1 to 3)
- Week 1: outline + draft via `/pillar-create`; end-to-end pre-flight ingest of Fuldeore 2017 + Chandra 2014 if not yet in library, with `/library/<slug>/` 200 verify
- Week 2: Gianna voice pass + citation pass + claim audit + Brian review
- Week 3: pre-ship gates (below), ship to staging, `/arise --deep` review (max 3 passes), fix, deploy, IndexNow ping, retrieval baseline, llms.txt update

### Phase 2: Provider pillar (Weeks 4 to 6)
- Week 4: outline + draft via `/pillar-create`; end-to-end pre-flight ingest of Yeung 2025 + Reeder 2026 with `/library/<slug>/` 200 verify; if either paper is not yet published or not yet in PubMed at Phase 2 time, swap citation to a comparable library-resident article and document in §15
- Week 5: Gianna voice pass + citation pass + claim audit + Brian review; cross-link audit against patient pillar
- Week 6: pre-ship gates, `/arise --deep` review, fix, deploy, IndexNow ping, retrieval baseline, llms.txt update
- Back-edit (same PR as the pillar intro commit per §12 gate #15): update patient pillar's "Read RRM For Providers" rail from inert placeholder to live `<a>` link (strip ALL three inert-state attributes: data-rail-state, data-future-href, aria-disabled, and the sr-only "(coming soon)" span; remove the page-level `Action` JSON-LD node); full Astro rebuild; verify via §12 gates #5a + #5b post-deploy

### Per-phase gates (run before deploy)

**Deploy-infrastructure gates:**
1. `rrm-router` `ASTRO_ROUTES` includes the new pillar slug; rrm-router redeployed via `npx wrangler deploy` before Astro deploy. Verify: `curl -sI https://rrmacademy.org/<slug>/` returns Astro-origin headers, not Wix-proxy.
2. `ssot/pillars.json` includes the new pillar entry; CI gate `scripts/gates/validate-pillar-registry.mjs` passes.
3. `/guides/` catalogue source includes the new pillar; `/guides/` page renders the new pillar card.
4. `deploy.yml` `guides_count` bumped per phase: 11→12 (Phase 1), 12→13 (Phase 2). Alternative refactor reads length from `ssot/pillars.json` in Phase 1 PR.
5. OG image generates correctly: `curl -fsI https://rrmacademy.org/og/<slug>.png?v=...` returns 200, image bytes > 5KB.

**Cross-pillar rail verification gates:**
5a. **Back-edit rail (Phase 2 only):** for patient pillar `dist/getting-started/index.html`, assert the rail to `/for-providers/` is now a live `<a href="/for-providers/" class="audience-rail">...</a>`. Helper script `scripts/gates/validate-cross-pillar-rails.mjs --mode=back-edit --target=/for-providers/`.
5b. **No-leftover inert-state attributes:** post-back-edit pillar HTML must NOT contain `data-future-href`, `data-rail-state="inert"`, or `aria-disabled="true"` ANYWHERE (regardless of pairing). Same helper script with `--mode=no-leftovers`. Catches the lone-leftover-attribute case.
5c. **New-ship rail (Phase 2 new pillar):** provider pillar `dist/for-providers/index.html` must contain a live `<a>` rail to `/getting-started/` (already-shipped sibling). Helper script with `--mode=new-ship --sibling=/getting-started/`.

**Content gates:**
6. **Em-style dash gate:** `grep -P '[\x{2014}\x{2013}\x{2212}\x{2012}\x{2015}]' dist/<slug>/index.html` returns no matches. Also `grep -E '&(mdash|ndash);|&#(8212|8211|x2014|x2013);'` returns no matches. Applies to rendered pillar HTML only, not this spec doc.
7. **"No 'Yes' lead" gate:** parse `dist/<slug>/index.html` FAQ accordion `<dd>` answers; strip leading whitespace + opening tags; assert first 20 chars do not match `^(Yes|Absolutely|Sure|Definitely|Of course|Certainly|Yeah|Indeed|Affirmative|Correct|Most certainly)\b` (case-insensitive). Helper `scripts/gates/faq-no-affirmative-lead.mjs`.
8. No telehealth-first framing: `grep -i 'telehealth' dist/getting-started/index.html` returns no occurrences in Hero / Section-1 / Section-3 (allowlisted only inside Section-5 Find-a-Provider).
9. No prescriptive RRM field-level claims (manual pass).
10. FAQPage JSON-LD validates against schema.org.
11. **Library citation 200 gate:** every `/library/<slug>/` URL referenced in pillar footnotes returns 200 via `curl -fsI`. Verified AFTER end-to-end ingest completes (all 6 stages: ingest → fulltext → classify → publish → fact extraction → live verify), not Stage 1 alone.
12. Manhart 2013 citation, if cited, links to correct library slug `fertility-awareness-based-methods-of-family-planning-a-review-of-effectiveness-f-recpanxsmpcrgo8zq`.

**Naomi-attribution gates (apply to BOTH pillars):**
13. **Naomi-leak grep (tightened):** `grep -PoE '\b(Naomi|Whit{1,2}aker|MIGS|NFPMC|0000-0003-3706-3112|1881034908|rrm-spotlight-naomi-whittaker)\b' dist/<slug>/index.html`. Note the `\bWhit{1,2}aker\b` pattern catches both "Whittaker" and "Whitaker" (one-t whisper-transcript typo per `feedback-whisper-whittaker-typo.md`). Allowlist (per D49): the entire `<div class="author-byline">...</div>` wrapper (depth-aware close-match, NOT non-greedy regex; the wrapper contains nested `author-avatar-stack` + `author-byline__text has-reviewer` children), plus `<header>` blocks and JSON-LD `<script>` blocks. Gate runs against body prose only. Helper script `scripts/gates/validate-naomi-attribution.mjs --pillar=<slug>`.
14. **Cross-pillar claim audit:** shared citations cited consistently across both shipped pillars (run `rrm-cli` diff per claim).

**Convergence gates:**
15. **Same-PR back-edit lockdown (Phase 2 only):** the back-edit on patient pillar MUST be in the same PR as provider pillar's introduction commit. CI gate `scripts/gates/validate-back-edit-in-pr.mjs` confirms any PR adding `src/pages/for-providers/index.astro` also edits `src/pages/getting-started/index.astro`. No waiver mechanism (drop the v1.2 `[back-edit-waiver]` escape valve; small-radius lockdown is enforceable without it).
16. **Provider-directory ship trigger:** when `rrm-provider-directory` ships, Brian opens a single-commit PR to `rrm-academy-cf` flipping patient pillar's primary CTA target from `/what-is-rrm/#get-started` to `/providers/`. Trigger event = the rrm-provider-directory project's `target_deploy_date` field in `provider-directory.json` moves from null to a date AND the noindex flag on `/providers/` flips to false. Verification: curl-grep new CTA href post-PR; success-metric window restart documented in §15.

### Rollback procedure
If a phase ships and monitoring or post-publish audit detects damage:

1. Revert the new pillar's PR via `git revert` (this reverts both the pillar intro commit AND the back-edit commit on previously-shipped pillars, because §12 gate #15 locks them into the same PR).
2. Remove the new pillar's `ssot/pillars.json` entry; CI propagates removal to 6 downstream consumers.
3. Bump `deploy.yml` `guides_count` assertion back to the previous phase's value.
4. **Verify rolled-back inert state:** run `scripts/gates/validate-cross-pillar-rails.mjs --mode=inverted --target=/for-providers/` against `dist/getting-started/index.html`. The `--inverted` mode asserts the inert rail is present (`data-rail-state="inert" data-future-href="/for-providers/" aria-disabled="true"` markup restored) AND no live `<a href="/for-providers/">` rail exists. Different polarity from the back-edit mode used in gate #5a.
5. Open a postmortem doc at `docs/plans/postmortem-<phase>-<date>.md`.
6. Re-attempt phase is gated on resolved root cause documented in the postmortem.

### Citation accuracy watch (post-publish, both pillars)
- **Daily cron (`.github/workflows/verify-pillar-citations.yml`):** every `/library/<slug>/` URL referenced on shipped pillars is checked for HTTP 200; SES email to administrator@rrmacademy.org on any failure (overwatch-worker pattern, exponential backoff on transient 5xx to avoid alert spam).
- **Quarterly audit:** for each cited library slug, check `is_retracted = 1` OR (`errata_count > 0` AND `last_errata_date > pillar.last_reviewed`). `pillar.last_reviewed` is sourced from `src/data/pillar-reviews.json` (build-time emit from each pillar's `.astro` frontmatter `lastReviewed` field). Failures route to either replacement citation OR inline correction notice on the pillar.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Patient pillar cannibalizes `/what-is-rrm/` for "what is rrm" intent | M | Internal-link audit pre-publish; new pillar targets "getting started" intent. **Remediation if regression detected:** (1) add canonical from new pillar to `/what-is-rrm/`, OR (2) rewrite new pillar's H1/H2 to remove competing keyword, OR (3) noindex new pillar pending re-write. Brian owns the decision; documented in §15. |
| R2 | Provider pillar cannibalizes `/naprotechnology/` for "naprotechnology training" intent | M | Same audit; provider pillar targets training-pathway intent broadly across methods. Same R1 remediation tree applies. |
| R5 | Provider directory not live when provider pillar ships; CTAs dead-end | M | Provider pillar v1 uses "directory coming soon" link + IIRRM external as Lateral fallback. **Patient pillar primary CTA also affected:** Phase 1 falls back to `/what-is-rrm/#get-started` (Brian's curated rail); swap to `/providers/` triggered by §12 gate #16 once `rrm-provider-directory` ships. |
| R8 | Citations drift between pillars and the library (stat changes, retraction, OR erratum/corrigendum touching cited claim post-publish) | M | Cite by library slug; library worker enrichment cron keeps stats fresh; daily cron checks `/library/<slug>/` 200; quarterly audit checks `is_retracted = 1` AND `errata_count > 0`. Library schema fields: `errata_count`, `last_errata_date`. Retraction OR substantive erratum triggers replacement-citation or inline-correction workflow. **INV-21:** cited content remains substantively accurate post-publish, including coverage of errata that touch the cited claim. |
| R9 | New pillars added to `/guides/` catalogue blow up the catalogue UX | L | Single guides catalogue revision pass after Phase 2 to re-sort and re-classify. Per-phase gate confirms new pillar renders in /guides/. |
| R10 | AEO retrieval check fails post-launch (LLM citations point to old pillars) | M | Run `rrma-seo-operator` retrieval baseline at launch; re-run at 30 / 60 / 90 days. |
| R11 | Provider pillar promotes IIRRM membership that may surface UPMC-related Naomi role; same risk applies to NeoFertility, Creighton, FEMM training links | H | Org-level only, never instructor-page. Per-phase grep gate (§12 #13) verifies linked-out URLs do not name Naomi. Capture-only rule per `feedback-naomi-profile-updates-on-hold.md`. |
| R12 | Patient pillar telehealth callout sneaks in via Gianna draft | L | Editorial gate explicit in spec; pre-publish grep for "telehealth" outside the Find-a-Provider allowlisted section. |
| R13 | Discoverability of spec's own risk register creates negligence ammunition if mitigations not applied; spec lives in same repo + leak surfaces include CF Pages build artifacts, satellite repo `rrm-academy-internal`, Anthropic Claude Code transcripts under enterprise retention, GitHub Codespaces snapshots, org-internal code search, LSP caches, `.recovered-docs/` paths, Bing Webmaster Tools AI Search Queries CSVs | M | Confirm `rrm-academy-cf` repo is private. Per-phase, log applied mitigations + verification evidence in project tracker after merge. Assess each leak surface enumerated above. If repo made public later, sanitize risk register first. |
| R14 | Phase 1 patient pillar ships with audience-router rail pointing at not-yet-shipped /for-providers/ | H | Rail renders as inert placeholder (§8 canonical markup); back-edit step at Phase 2 ship flips it live (same PR per §12 #15); rollback procedure preserves inert state with verification via §12 #4 inverted gate. |

## 14. Open Questions

To resolve before or during the relevant phase.

| ID | Question | Phase | Default if no answer |
|---|---|---|---|
| Q1 | Should `/getting-started/` accept a query param to bias the routing rail (`?audience=provider`)? | P1 | No. Keep rails neutral. |
| Q2 | Method picker on patient pillar: link to existing decision page or build fresh? | P1 | No method picker exists today. Secondary CTA links to `/what-is-rrm/#fabms` (closest existing anchor). Do NOT build a picker as part of this Phase. v2 backlog item for `/method-picker/`. |
| Q3 | Patient pillar problem-router: separate landing pages per condition or single in-page anchor? | P1 | In-page anchor with deep-link to existing condition pillar. |
| Q4 | Provider pillar: link to NeoFertility training (consulting project) or only to academy-affiliated training? | P2 | Link to NeoFertility org-level training landing pages only (e.g., `https://neofertility.training/` not instructor-page). Same org-vs-role rule as R11 / IIRRM. Per-phase grep gate verifies no Naomi attribution on linked URLs. |
| Q5 | Provider pillar partner-program section: link to `/partners/` or to a new `/partners/clinic-affiliate/` sub-page? | P2 | `/partners/`. |
| Q10 | Should we generate audience-specific OG images per pillar? | P1, P2 | Yes, per `programmatic-og-images-design.md`. |
| Q11 | Should the patient pillar add a "Take the readiness quiz" interactive (à la `/ivf-success-calculator/`)? | P1 follow-on | Defer to v2. |
| Q12 | Does the provider pillar need a "clinical-evidence appendix" PDF download? | P2 follow-on | Defer to v2. |

## 15. Decisions Log (Appendix A)

| ID | Decision | Rationale |
|---|---|---|
| D1 | Two flat URLs: `/getting-started/`, `/for-providers/` | Matches 2026-03-12 flat-URL convention; preserves SEO keyword targeting per audience |
| D2 | Patient pillar is the default at `/getting-started/`, not at `/for-patients/` | Highest organic intent; cleaner generic-search match inside site context |
| D3 | Single combined spec for both pillars; one `/pillar-create` invocation per pillar at execution | Shared structural template; per-pillar content fan-out is the right boundary |
| D4 | Shared 2-sentence "what RRM is" definition block, identical across both | Prevents cannibalization with `/what-is-rrm/`; principle-level only avoids field-level prescriptive-claim rule |
| D5 | Build sequence: patient → provider | Patient has highest organic intent and existing CTA infrastructure; provider depends on directory + IIRRM page state |
| D7 | Provider pillar v1 uses "directory coming soon" + IIRRM external link | Provider directory project is mid-build; provider pillar should not block on directory v1 |
| D9 (revised v1.3 → 2026-05-14 patch) | Patient and provider pillar bylines use the canonical glossary-style `author-byline` + `has-reviewer` pattern: author = "RRM Academy", reviewer = "Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI"; no in-body references to Naomi by name. Supersedes the original D9 ("full Naomi byline at top"). | See D49. |
| D10 | No nested URL structure (`/getting-started/providers/`) | Matches existing pillar URL convention; preserves SEO targeting per slug |
| D11 | No telehealth-first framing on patient pillar | RRM is in-person-first by clinical design |
| D12 | Faith-neutral lede on patient pillar; religious-origin discussion only in opt-in FAQ entry | Reaches the largest cold audience without pre-filtering |
| D14 | Run `/arise --deep` against each pillar spec and page before merge; max 3 passes per phase | Default-deep rule; convergence ceiling prevents unbounded loops |
| D15 | Run cannibalization audit after each phase ships; R1 remediation tree codified | `docs/cannibalization-audit-2026-05-13.md` playbook |
| D16 | FAQPage JSON-LD auto-emits from the FAQ accordion section on each pillar | Convention established by `/commentary-faq-add` skill |
| D17 | OG images per pillar via `programmatic-og-images-design.md` | Consistent with existing pillar OG treatment |
| D19 | Per-phase deploy-infrastructure gates: rrm-router ASTRO_ROUTES + ssot/pillars.json + /guides/ catalogue + deploy.yml count bump + OG image render + app-shell wrap | Prevents 404 / wrong-content launches |
| D20 | Shared definition block is principle-level only; named methods own specific clinical protocols | Resolves v1.0 self-audit failure against `feedback-no-prescriptive-rrm-field-claims.md` |
| D21 | Patient pillar primary CTA Phase 1 fallback: `/what-is-rrm/#get-started`; swap to `/providers/` v2 once directory ships (triggered by §12 gate #16) | `/providers/` is currently a noindex waitlist stub; primary CTA must function on day one |
| D22 | Audience-router rail to not-yet-shipped sibling renders as inert placeholder; canonical markup template in §8; back-edit step at sibling-ship time flips it live | Prevents 404 rails during Phase 1 isolation and during rollback |
| D23 | JSON-LD `audienceType` uses Text values, not schema.org class names | Schema.org `Audience.audienceType` is typed Text |
| D24 | `MedicalWebPage.medicalAudience` (typed `MedicalAudience`) replaces `audience`; audience node nested INSIDE MedicalWebPage | schema.org/MedicalWebPage uses `medicalAudience` as canonical audience property |
| D26 | Em-style dash gate covers U+2014, U+2013, U+2212, U+2012, U+2015, `&mdash;`, `&ndash;`, `&#8212;`, `&#8211;`, `&#x2014;`, `&#x2013;` (applied to rendered HTML) | Brian's "no em dashes" preference covers visually-equivalent dash characters |
| D27 | "No 'Yes' lead" gate parses FAQ accordion `<dd>` answers (HTML-aware), strips leading whitespace/tags, asserts first 20 chars do not match strong-affirmative regex | Underlying rule is "no strong-affirmative lead on fertility/pregnancy/treatment FAQs" |
| D31 | Patient pillar secondary CTA targets `/what-is-rrm/#fabms` (verified existing anchor), not `/what-is-rrm/#methods` (does not exist) | `/what-is-rrm/#methods` anchor verified absent via grep |
| D32 | Phase 2 back-edit on previously-shipped pillar is a normal Astro source edit + commit + push + full rebuild (NOT single-record dispatch); back-edit MUST be in the same PR as new pillar's intro commit (§12 gate #15) | Static pillar pages aren't backed by D1; same-PR rule guarantees `git revert` atomicity; v1.2's `[back-edit-waiver]` escape valve dropped in v1.3 (small-radius lockdown is enforceable without it) |
| D33 | `deploy.yml` `guides_count -ne N` assertion bumped per phase (11→12→13); alternative refactor reads length from `ssot/pillars.json` in Phase 1 PR | Hardcoded count constant traps every phase otherwise |
| D36 | `/rrm-ingest` pre-flight in both pillars runs end-to-end (all 6 stages); `/library/<slug>/` 200 check before slug commits to draft | Stage-1-only ingest leaves articles at `is_published=0`; `/library/<slug>/` 404s; gate #11 fails |
| D38 | Canonical inert-rail markup template in §8: `<span role="link" aria-disabled="true" data-rail-state="inert" data-future-href="/X/">` + visible text + `<span class="sr-only"> (coming soon)</span>`; no `aria-label` (visible-text and accessible-name must match per WCAG 2.5.3); page-level schema.org `Action` with `actionStatus: "PotentialActionStatus"`; CSS rule in design-system.manual.json; back-edit STRIPS all three inert-state attributes AND the sr-only span AND the Action node | Inert-rail accessibility, back-edit determinism, and forward-compat with /arise gate enforcement |
| D39 | Provider-directory ship triggers patient-pillar primary CTA flip via §12 gate #16 (single-commit PR on `rrm-academy-cf` when `rrm-provider-directory`'s `target_deploy_date` becomes non-null AND `/providers/` noindex flips false); §11 metric window restarts and prior measurements footnoted | Cross-project coordination signal documented, not informal |
| D40 | Library worker enrichment cron extended to track `errata_count INTEGER DEFAULT 0` and `last_errata_date TEXT` from PubMed `<CommentsCorrectionsList><CommentsCorrections RefType="ErratumIn">` parsing; daily cron checks `/library/<slug>/` 200; quarterly audit checks retraction + erratum against `pillar.last_reviewed` from `src/data/pillar-reviews.json` | Citation accuracy watch covers erratum/corrigendum, not just full retraction (INV-21); cron host pinned to GitHub Actions schedule |
| D41 (v1.3) | Scope trimmed: policy pillar deferred to separate spec `docs/superpowers/specs/2026-05-14-policy-pillar-deferred.md` | Pass-3 `/arise --deep` revealed asymptotic complexity from policy-pillar primitives (waitlist schema, attestation, reviewer roster, segment-allowlist, abortion gate, MAHA budget, Foundation legal review); each squash spawned new gate-bypass / gate-semantics findings; yield was 35 → 28 → 30 (not converging); trimming policy scope drops ~22 of 30 pass-3 findings and re-anchors the convergence curve |
| D42 (v1.3) | Naomi-leak grep regex covers `Whit{1,2}aker` (one-t whisper-transcript typo) | `feedback-whisper-whittaker-typo.md` documents mlx-whisper drops one t even with vocab bias prompt; failure mode predicted by memory; gate now matches both spellings |
| D43 (v1.3) | §12 gate #5a (back-edit verification) + #5b (no-leftover inert-state attributes) + #5c (new-ship rail verification): three explicit assertions cover all three rail-state transitions cleanly without ordering vs same-PR contradiction | v1.2 gates #22 + #24 + #27 were mechanically incompatible under CF Pages atomic deploy; v1.3 collapses to post-deploy verification with helper script in three modes (back-edit, no-leftovers, new-ship) + a separate `--inverted` rollback mode |
| D44 (v1.3) | Inert-rail markup drops `aria-label`; visible text + sr-only "(coming soon)" provides accessible name | v1.2's `aria-label="Read RRM For Policymakers, coming soon"` overrode visible "Policy professional?" prefix; WCAG 2.5.3 Level A failure; v1.3 parenthetical also reads as SR pause rather than "comma comma" |
| D45 (v1.3) | Citation cron runtime = GitHub Actions schedule in `.github/workflows/verify-pillar-citations.yml`; notification routes via SES email to administrator@rrmacademy.org per overwatch-worker pattern (NOT retired n8n) | n8n retired 2026-05-08 per memory `n8n-host-outage-2026-04-27.md`; v1.2 cron host was vapor; v1.3 names the live infrastructure |
| D46 (v1.3) | `rrm-library-worker` errata_count migration + PubMed `<CommentsCorrectionsList>` parser are explicit Phase 1 prerequisites; backfill cron runs over existing cited PMIDs | v1.2 R8 + D40 claimed the field exists; worker source verified to have zero errata handling; v1.3 promotes to Phase 1 prereq with explicit deliverables |
| D47 (v1.3) | `pillar.last_reviewed` source = `src/data/pillar-reviews.json` build-time emit from each pillar's `.astro` frontmatter | v1.2 quarterly cron compared against undefined source; v1.3 pins to build-time JSON file |
| D48 (v1.3) | v1.2 `[back-edit-waiver]` escape valve dropped in v1.3 | 2-pillar suite has fixed back-edit topology (Phase 2 → 1 back-edit on patient); no operational case for a waiver; small-radius lockdown is enforceable; removes the self-attestation surface |
| D49 (2026-05-14 patch, post-cleared-tier review) | Byline pattern for both new pillars = canonical glossary-style author-byline: `<div class="author-byline">` outer wrapper, with `<div class="author-avatar-stack">` (RRMA logo `/apple-touch-icon.png` + `/images/authors/naomi-whittaker.webp`), and `<div class="author-byline__text has-reviewer">` containing `<span class="byline-author">By <strong>RRM Academy</strong></span>` + `<span class="byline-reviewer">Reviewed by <strong><a href="/commentary/rrm-spotlight-naomi-whittaker-md/">Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI</a></strong></span>` + `<LastUpdated />` + (optional) `<PdfDownload />`. JSON-LD upstream mirrors: `author = #organization` (RRMA), `reviewedBy = #naomi-whittaker`. The pillar guides written in Naomi's clinical voice today (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/pcos/`, `/endometriosis/`, etc.) keep her as primary author per their precedent; the 2-pillar suite (`/getting-started/` + `/for-providers/`) is the second org-author exception alongside `/glossary/` (already org-authored). | Brian directive 2026-05-14 ("RRMA and Naomi as authors"). Three motivations: (a) Brian explicitly named both organizations as the desired authorship; (b) `feedback-naomi-profile-updates-on-hold.md` HARD RULE puts new Naomi-as-primary-author content on hold pending UPMC resolution — RRMA-author + Whittaker-reviewer respects the hold while still attributing Naomi clinically; (c) the new pillars are entry-point / wayfinding content (intro for cold patient + cold clinician traffic), not Naomi's deep clinical practice content — institutional authorship matches the function. Affects Task 8 gate code (depth-aware author-byline strip), pillars.json `author` field (= "RRM Academy"), Tasks 13 + 19 /pillar-create byline directive. |

**Decisions deferred to policy-pillar spec:** D6, D8, D13, D18, D25, D28, D29, D30, D34, D35, D37 (all v1.2 decisions related to policy pillar byline, Foundation EIN graph, abortion section, CTAs, attestation artifact, reviewer roster, MAHA budget). See `docs/superpowers/specs/2026-05-14-policy-pillar-deferred.md` for current state.

## 16. Glossary

| Term | Meaning |
|---|---|
| RRM | Restorative Reproductive Medicine |
| FABM | Fertility Awareness-Based Methods |
| NaPro | NaProTechnology |
| IIRRM | International Institute for Restorative Reproductive Medicine |
| AEO | Answer Engine Optimization (LLM retrieval) |
| Cannibalization | Two pages competing for the same search intent and splitting ranking signal |
| Pillar | A top-of-funnel long-form landing page on rrmacademy.org |
| Inert placeholder | A `<span role="link" aria-disabled="true">` rail element with "(coming soon)" sr-only text and `data-future-href` attribute; activated to live `<a>` at sibling-ship time per D38 |
| Back-edit | The cross-pillar commit that flips inert rails on previously-shipped pillars to live `<a>` when a new sibling pillar ships; per D32, must live in the same PR as the new pillar's introduction commit |
| `/arise --deep` | The 4-Opus-tracer spec/code review pipeline |
| Start clock | Metric anchor = first day with non-zero GSC clicks on the pillar URL (NOT deploy date) |
| End-to-end ingest | All 6 stages of `/rrm-ingest` (ingest → fulltext → classify → publish → fact extraction → live verify), required before any pillar footnote commits a `/library/<slug>/` reference |

## 17. Spec Self-Review (v1.3)

- **Placeholders:** none. Two "verify slug at ingest time" cells are intentional and paired with explicit end-to-end pre-flight ingest steps in §12.
- **Internal consistency:** URL strategy (§5) matches D1/D2/D10; Catholic-framing rule (§9 + §7.1 FAQ-only placement) is consistent; definition block (§6) matches §9 "no prescriptive field-level claims"; metric definitions (§11) match success-criteria language in §12 gates; inert-rail markup (§8) matches back-edit selector (§12 gates #5a-c).
- **Scope:** policy pillar deferred to separate spec per D41; this spec is appropriately scoped to 2 pillars + their shared infrastructure.
- **Ambiguity:** byline rule disambiguated (full credential string at top, "Dr. Whittaker" in body); FAQ count locked per pillar in §7; rail rendering states locked in §8 with canonical markup template; back-edit topology is 1 commit on 1 sibling (deterministic).
- **Em-style dashes in body prose:** 0 (grep-verified post-rewrite; code-span occurrences in spec are intentional gate documentation per §17 self-review clause).
- **HARD RULES present:** byline rules, no-prescriptive-claims (definition block self-audit passing), no-Yes-leads (with synonym + HTML-aware coverage), no-Hilgers-protocols, no-telehealth-first, no-clinic-names-in-red-flags, faith-content-in-opt-in-FAQ-only, Naomi-byline-allowed (clinical context, both pillars).
- **Cross-references:** existing memory files cited inline; helper script paths (`scripts/gates/...`) cited where new gates are introduced (writing-plans implementation step).
- **/arise --deep squash trajectory:**
  - v1.0 → v1.1: 35 findings squashed
  - v1.1 → v1.2: 28 findings squashed
  - v1.2 → v1.3: scope-trimmed (policy pillar moved to separate spec, dropping ~22 findings); 8 findings squashed inline (gate #22/#24/#27 ordering reconciled via 5a/5b/5c three-mode gate; rollback inverted-gate via `--inverted` mode; lone-leftover `data-future-href` caught by gate #5b; inert-rail WCAG 2.5.3 via D44; SR comma pronunciation via parentheses; Naomi-leak Whitaker typo via D42; citation cron host via D45; errata_count migration via D46 + Prerequisites section)
- **Convergence forecast:** trimmed 2-pillar surface has ~17 gates, 27 decisions, 9 risks, 8 open questions, ~700 lines. Pass-4 against the trimmed surface should yield <10 findings if convergence is the asymptotic-complexity issue the trim resolved.
