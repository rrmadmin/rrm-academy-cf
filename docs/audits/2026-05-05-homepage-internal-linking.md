# Wave 3: Internal Linking Audit — Homepage

**Source:** `src/pages/index.astro` (859 lines)
**Base SHA:** b4b51e1a2b2053b482478e2b9dc76f7d801670ae
**Generated:** 2026-05-05
**Mode:** Read-only.

## Summary

- Total links on homepage: 14 (7 unique destinations)
- Broken: 0 (sticky 4xx) | Flaky: 0 (5xx after 3 retries) | External (skipped): 0
- Findings: 14 (top 14 of 14 total; cap is 20)

The homepage is link-light by design: an editorial long-form layout with very few inline links and four CTA buttons. All 7 unique same-origin destinations return 200. The dominant issue is not breakage but coverage and routing: the five named pillar destinations (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/common-questions-about-rrm`) are not reachable from any inline link on the homepage, and several high-value terms (NaProTechnology, RRM, FEMM, NeoFertility, ovulation, recurrent miscarriage, unexplained infertility, hormonal suppression, cause-based diagnostics, excision, cycle charting, fellowship-trained) are mentioned in body copy but unlinked. The single inline FAQ retarget (`/faqs/what-is-restorative-reproductive-medicine-rrm/`) is used for "Restorative Reproductive Medicine" twice and is the ONLY inline link sending readers to a primer on the core concept. Retargeting it to `/what-is-rrm/` (pillar) would materially improve cluster cohesion.

## Link inventory table

| line | anchor_text | target_url | status |
|------|-------------|------------|--------|
| 151 | Explore Courses | /courses/ | 200 |
| 152 | Browse {N} Studies | /library/ | 200 |
| 179 | Restorative Reproductive Medicine | /faqs/what-is-restorative-reproductive-medicine-rrm/ | 200 |
| 204 | Restorative Reproductive Medicine | /faqs/what-is-restorative-reproductive-medicine-rrm/ | 200 |
| 234 | endometriosis | /courses/masterclass-in-endometriosis-and-surgery/ | 200 |
| 298 | endometriosis | /courses/masterclass-in-endometriosis-and-surgery/ | 200 |
| 301 | natural conception | /courses/rrm-vs-ivf/ | 200 |
| 332 | Dr. Naomi Whittaker, MD (bold) | /commentary/rrm-spotlight-naomi-whittaker-md/ | 200 |
| 357 | Meet Dr. Naomi Whittaker → | /commentary/rrm-spotlight-naomi-whittaker-md/ | 200 |
| 370 | RRM Academy Research Library | /library/ | 200 |
| 407 | Research Library. (bold) | /library/ | 200 |
| 413 | Expert Commentary. (bold) | /commentary/ | 200 |
| 438 | Explore Courses | /courses/ | 200 |
| 439 | Access the Research Library | /library/ | 200 |

Per-destination tally (14 links → 7 unique targets):

| target | count |
|--------|-------|
| /library/ | 4 |
| /courses/ | 2 |
| /faqs/what-is-restorative-reproductive-medicine-rrm/ | 2 |
| /courses/masterclass-in-endometriosis-and-surgery/ | 2 |
| /commentary/rrm-spotlight-naomi-whittaker-md/ | 2 |
| /courses/ rrm-vs-ivf/ | 1 |
| /commentary/ | 1 |

## Findings

```
- id: W3-1
- severity: HIGH
- location: src/pages/index.astro:179
- excerpt: "RRM Academy is the educational home for <a href=\"/faqs/what-is-restorative-reproductive-medicine-rrm/\">Restorative Reproductive Medicine</a>."
- issue: The single most important "what is this thing" anchor on the homepage points at an FAQ stub instead of the canonical pillar guide /what-is-rrm/. This is the lede inline link and it is misrouted away from the pillar.
- suggested_fix: Retarget href to /what-is-rrm/ (pillar). Anchor text "Restorative Reproductive Medicine" stays.
- aeo_seo_geo_impact: combo (SEO+GEO), HIGH magnitude. Pillar pages are the canonical answer-engine targets; the FAQ entry is a leaf node, not a cluster hub.
- native_action: RETARGET
- proposed_action_type: RETARGET
- persona_served: Searcher, Curious Generalist, Frustrated OBGYN
```

```
- id: W3-2
- severity: HIGH
- location: src/pages/index.astro:204
- excerpt: "<a href=\"/faqs/what-is-restorative-reproductive-medicine-rrm/\">Restorative Reproductive Medicine</a> is the under-the-hood approach."
- issue: Second inline use of "Restorative Reproductive Medicine" routes to the same FAQ stub, compounding the W3-1 misrouting. Two consecutive sections on the homepage send users away from the pillar.
- suggested_fix: Retarget href to /what-is-rrm/. Keep anchor text "Restorative Reproductive Medicine".
- aeo_seo_geo_impact: combo, HIGH magnitude. Pillar gets +2 inbound from homepage with diverse/identical anchor; cluster cohesion fixed.
- native_action: RETARGET
- proposed_action_type: RETARGET
- persona_served: Searcher, Exhausted Patient
```

```
- id: W3-3
- severity: HIGH
- location: src/pages/index.astro:182-183
- excerpt: "Our founder, Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI, is a NaProTechnology fellowship-trained surgeon."
- issue: First mention of the founder in body copy is unlinked. "NaProTechnology" is also unlinked here and in the body copy below at lines 310-311. Both are top-shelf entity terms.
- suggested_fix: Wrap "Dr. Naomi Whittaker, MD" with <a href="/commentary/rrm-spotlight-naomi-whittaker-md/">. Wrap "NaProTechnology" with <a href="/naprotechnology/">.
- aeo_seo_geo_impact: combo, HIGH magnitude. Adds entity links for the founder Person node and the NaPro pillar at the lede position.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Searcher, Frustrated OBGYN, FABM Professional
```

```
- id: W3-4
- severity: HIGH
- location: src/pages/index.astro:310
- excerpt: "You want to understand how NaProTechnology-based medicine, restorative surgery, and complementary disciplines integrate into a full patient care model."
- issue: "NaProTechnology" appears unlinked in the For-Clinicians list. Pillar /naprotechnology/ is live and is a primary cluster destination per the methodology brief.
- suggested_fix: Wrap "NaProTechnology" with <a href="/naprotechnology/">. Anchor stays as "NaProTechnology".
- aeo_seo_geo_impact: combo, HIGH magnitude. Routes the clinician-persona block toward the NaPro pillar.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Frustrated OBGYN, FABM Professional
```

```
- id: W3-5
- severity: MEDIUM
- location: src/pages/index.astro:298
- excerpt: "You have been diagnosed with <a href=\"/courses/masterclass-in-endometriosis-and-surgery/\">endometriosis</a>, PCOS, or recurrent miscarriage and want more than indefinite symptom management."
- issue: "endometriosis" links to a paid course masterclass. "PCOS" and "recurrent miscarriage" are unlinked despite being equally weighted patient-entry terms. This is asymmetric: only one of three diagnoses gets a destination, and that destination is a sales page, not a primer.
- suggested_fix: Either (a) RE-ANCHOR endometriosis link target to /faqs/ (or to a future pillar page) and add parallel links for PCOS and recurrent miscarriage when those pages exist, OR (b) leave endometriosis pointing to the course but add a sister inline link "PCOS" → /faqs/ search or relevant FAQ slug to keep symmetry.
- aeo_seo_geo_impact: SEO, MEDIUM magnitude. Removes anchor-bias toward course-sale and reduces orphan signal for PCOS and recurrent miscarriage.
- native_action: ADD or RE-ANCHOR
- proposed_action_type: ADD-LINK
- persona_served: Exhausted Patient, Values-Driven Couple
```

```
- id: W3-6
- severity: MEDIUM
- location: src/pages/index.astro:234
- excerpt: "For <a href=\"/courses/masterclass-in-endometriosis-and-surgery/\">endometriosis</a>, it may mean excision surgery to remove the disease itself rather than suppressing it with hormones."
- issue: Anchor text "endometriosis" sends readers to a paid course rather than to a content/diagnostic primer. This is the second of two homepage inline mentions both routed to the same paid masterclass. Anchor diversity to the same target is low (exact-match repetition) and target is sales-funnel, not informational.
- suggested_fix: Diversify: keep one inline endometriosis link to the masterclass (line 298, the For-Patients list is appropriate) and re-anchor the line 234 link to "excision surgery" → a future /endometriosis/ pillar page or to the relevant FAQ slug. If no informational page exists, retarget to /faqs/?q=endometriosis or remove the inline link and let the strong primer link to /what-is-rrm/ carry the body.
- aeo_seo_geo_impact: SEO, MEDIUM magnitude. Anchor-text diversity improves; "excision surgery" is a higher-intent keyword than "endometriosis" for that sentence.
- native_action: RE-ANCHOR
- proposed_action_type: RE-ANCHOR
- persona_served: Exhausted Patient, Curious Generalist
```

```
- id: W3-7
- severity: MEDIUM
- location: src/pages/index.astro:301
- excerpt: "You prefer <a href=\"/courses/rrm-vs-ivf/\">natural conception</a> and want to know what that path actually requires."
- issue: Anchor "natural conception" lands on a comparison course page (RRM vs IVF). The anchor describes the destination poorly: a reader expecting a "what is natural conception" primer lands on a comparative sales page. Mismatch between anchor and target intent.
- suggested_fix: RE-ANCHOR to "RRM versus IVF" with the same href, OR retarget the existing anchor to /what-is-rrm/#natural-conception (if that section exists) or to a /faqs/ entry. Cleanest: RE-ANCHOR to "compare RRM and IVF" pointing to /courses/rrm-vs-ivf/.
- aeo_seo_geo_impact: SEO, MEDIUM magnitude. Anchor-target alignment is a documented quality signal.
- native_action: RE-ANCHOR
- proposed_action_type: RE-ANCHOR
- persona_served: Values-Driven Couple, Cost-Conscious Couple
```

```
- id: W3-8
- severity: MEDIUM
- location: src/pages/index.astro:299
- excerpt: "You carry a diagnosis of \"unexplained\" infertility. (Undiagnosed is the more accurate word. RRM finds what was missed.)"
- issue: "Unexplained infertility" is one of the highest-intent patient search terms in the entire RRM cluster and appears unlinked. There is no destination route for a patient who recognizes themselves in this line.
- suggested_fix: Wrap "unexplained" infertility with <a href="/faqs/?q=unexplained-infertility"> if a faq exists, or to /what-is-rrm/ (pillar) until a dedicated page is live. Preferred target: an explainer FAQ on undiagnosed-vs-unexplained.
- aeo_seo_geo_impact: combo, MEDIUM-HIGH magnitude. Top patient-search query left as orphan.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Exhausted Patient, Searcher
```

```
- id: W3-9
- severity: MEDIUM
- location: src/pages/index.astro:282
- excerpt: "Hormonal suppression does not stop disease advancement. It hides it."
- issue: "Hormonal suppression" is a high-intent term used multiple times on the homepage (lines 199, 282, 393) and never linked. This is a key concept the page argues against; an inline link to a primer or commentary lets the argument carry weight.
- suggested_fix: ADD-LINK on the first or strongest occurrence (line 282 is the strongest) to a relevant FAQ or commentary slug. If no current canonical destination exists, queue this finding for a follow-up content task; do not force an arbitrary target.
- aeo_seo_geo_impact: SEO, MEDIUM magnitude.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Exhausted Patient, Frustrated OBGYN
```

```
- id: W3-10
- severity: LOW
- location: src/pages/index.astro:332
- excerpt: "<a href=\"/commentary/rrm-spotlight-naomi-whittaker-md/\"><strong>Dr. Naomi Whittaker, MD</strong></a>"
- issue: Anchor wraps the strong tag rather than the strong tag wrapping the anchor; this is fine functionally but the founder name appears twice as an anchor on the same page (line 332 and line 357), both pointing to the same commentary spotlight, with low anchor-text diversity ("Dr. Naomi Whittaker, MD" and "Meet Dr. Naomi Whittaker →"). Two links to one URL with near-identical anchor text is the textbook over-link pattern.
- suggested_fix: Keep one. Either drop the bold-name link at 332 (line 357 already has the explicit "Meet Dr. Naomi Whittaker →" CTA), OR keep 332 and convert 357 to a non-link button or remove. Recommended: keep 332 as the primary entity link (it surrounds the credential block), and keep 357 since it is the explicit CTA at the end of the section. If kept, the duplication is acceptable.
- aeo_seo_geo_impact: SEO, LOW magnitude.
- native_action: REMOVE (one of the two) or accept duplication
- proposed_action_type: DELETE-PROSE
- persona_served: general
```

```
- id: W3-11
- severity: HIGH
- location: src/pages/index.astro:402-417 (entire "Research and Commentary" section)
- excerpt: "<a href=\"/library/\"><strong>Research Library.</strong></a> ... <a href=\"/commentary/\"><strong>Expert Commentary.</strong></a>"
- issue: The "Research and Commentary" section consolidates four of the five pillar-tier destinations into one section but contains zero anchors to /what-is-rrm/, /naprotechnology/, /femm/, /neofertility/, or /common-questions-about-rrm. The five named pillars are unreachable from this homepage via inline anchors. The page visits four of them only via their root section CTA buttons (no inline pillar links anywhere).
- suggested_fix: Add a third paragraph to the Research and Commentary section: "<a href=\"/what-is-rrm/\"><strong>Pillar Guides.</strong></a> Plain-language explainers of <a href=\"/naprotechnology/\">NaProTechnology</a>, <a href=\"/femm/\">FEMM</a>, and <a href=\"/neofertility/\">NeoFertility</a>, plus the <a href=\"/common-questions-about-rrm\">most common questions</a> patients and clinicians ask." This adds five pillar links from a high-value section above the final CTA.
- aeo_seo_geo_impact: combo, HIGH magnitude. Closes the pillar-orphan gap on the homepage in one section.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Searcher, Curious Generalist, FABM Professional, Frustrated OBGYN
```

```
- id: W3-12
- severity: MEDIUM
- location: src/pages/index.astro:362-400 (Common Questions section)
- excerpt: "<h2>Common Questions</h2>" followed by a 4-question prose list with no link to /faqs/ or /common-questions-about-rrm.
- issue: The section is titled "Common Questions" and lists four FAQ-style answers but does not link to /faqs/ (the FAQ index) or to /common-questions-about-rrm (the pillar). A reader who wants more questions has nowhere to go.
- suggested_fix: Add a closing line beneath the <ul>: "More questions? See the <a href=\"/common-questions-about-rrm\">full list of common questions about RRM</a> or browse <a href=\"/faqs/\">all FAQs</a>." Two links, both to live pages.
- aeo_seo_geo_impact: combo, MEDIUM-HIGH magnitude. /common-questions-about-rrm is otherwise unreachable from the homepage.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Searcher, Curious Generalist
```

```
- id: W3-13
- severity: LOW
- location: src/pages/index.astro:298-302
- excerpt: For-Patients <ul> with five list items.
- issue: Two of five list items contain links (endometriosis course; rrm-vs-ivf course). Both link targets are paid course pages. There are zero links to free explainers, zero links to /library/ in this section, zero links to a glossary, FAQs, or pillar guides. The section reads as a sales funnel rather than an information ramp.
- suggested_fix: Add at least one informational link in this list. Suggested: on item 3 ("\"unexplained\" infertility") add anchor "<a href=\"/what-is-rrm/\">RRM finds what was missed.</a>" or wrap "unexplained" with /faqs/. Cumulatively this also satisfies W3-8.
- aeo_seo_geo_impact: combo, LOW-MEDIUM magnitude.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Exhausted Patient, Cost-Conscious Couple
```

```
- id: W3-14
- severity: LOW
- location: src/pages/index.astro:304-311
- excerpt: For-Clinicians <ul> with four list items.
- issue: Zero inline links in the For-Clinicians block. References to "NaProTechnology-based medicine, restorative surgery" and "fertility awareness educator" are all unlinked. This is the homepage's only clinician-direct touchpoint; sending zero clinicians to /naprotechnology/, /femm/, or /courses/ from this section is a missed routing opportunity.
- suggested_fix: ADD-LINK on "NaProTechnology" → /naprotechnology/ (covers W3-4). Optionally ADD-LINK on "fertility awareness educator" → /femm/ if FEMM is the canonical FABM destination, or to /faqs/ for the broader concept.
- aeo_seo_geo_impact: combo, LOW-MEDIUM magnitude.
- native_action: ADD
- proposed_action_type: ADD-LINK
- persona_served: Frustrated OBGYN, FABM Professional
```

## Orphan opportunities

High-value terms present in homepage body copy but unlinked, with proposed targets:

| Term | First occurrence | Proposed target | Rationale |
|------|------------------|-----------------|-----------|
| NaProTechnology | line 182, 310, 410 | /naprotechnology/ | Pillar; never linked from homepage. |
| RRM (acronym) | line 179, 197, 204, 220, etc. | /what-is-rrm/ | Pillar; acronym unlinked across the page. |
| FEMM | not present in body copy (only in clinician list as "fertility awareness educator") | /femm/ | Pillar unreachable from homepage entirely. |
| NeoFertility | not present in body copy | /neofertility/ | Pillar unreachable from homepage entirely. |
| unexplained infertility | line 299 | /faqs/?q=unexplained-infertility or /what-is-rrm/ | Top patient-search query. |
| recurrent miscarriage | line 298 | /faqs/?q=recurrent-miscarriage or future pillar | High-intent diagnosis. |
| PCOS | line 298 | /faqs/?q=pcos or future pillar | High-intent diagnosis. |
| excision surgery | line 235, 393 | future /endometriosis/ pillar or /courses/masterclass-in-endometriosis-and-surgery/ | Surgery-vs-ablation distinction is a key Whittaker talking point. |
| ablation (vs excision) | line 119 (FAQ schema) and line 393 | same as above | Compound with excision. |
| cycle charting | line 226-227, 293, 393 | /faqs/ slug or pillar | Core RRM diagnostic primitive. |
| fertility awareness educator | line 309 | /femm/ or /faqs/ | Routes the FABM-professional persona. |
| hormonal suppression | line 199, 282, 393 | /faqs/ or commentary slug | Page argues against this concept; link gives the argument citation weight. |
| cause-based diagnostics | line 272, 300 | /what-is-rrm/ | Concept central to the cluster argument. |
| ovulation | line 245 | /glossary/ entry | Glossary is otherwise unreachable from homepage. |
| Naomi Whittaker (first mention) | line 182 | /commentary/rrm-spotlight-naomi-whittaker-md/ | First mention is unlinked; second and third are linked. Best practice: link first mention. |
| restorative reproductive medicine (lowercase, body copy) | line 182, 197, 220, etc. | /what-is-rrm/ | Already covered by W3-1 / W3-2 retargeting. |

Also unreachable from homepage entirely: `/glossary/`. The page's high concept-density (cycle charting, ovulation, hormonal suppression, ablation, excision, NaProTechnology, NFPMC, MIGS, FCI) makes a single inline link to `/glossary/` from the credentials block or the "What RRM Looks Like" section a high-leverage micro-add.

## Cluster-cohesion summary

| Pillar | Inbound links from homepage | Anchor-text diversity | Gap |
|--------|----------------------------|----------------------|-----|
| /what-is-rrm/ | 0 | n/a | CRITICAL. Pillar is unreachable inline. Two inline anchors for "Restorative Reproductive Medicine" point at /faqs/ stub instead. |
| /naprotechnology/ | 0 | n/a | CRITICAL. Term used 3x in body, zero links. |
| /femm/ | 0 | n/a | CRITICAL. Pillar unreachable. |
| /neofertility/ | 0 | n/a | CRITICAL. Pillar unreachable. |
| /common-questions-about-rrm | 0 | n/a | HIGH. Page has a "Common Questions" section that does not link to it. |
| /glossary/ | 0 | n/a | MEDIUM. Concept-dense page, no glossary link. |
| /library/ | 4 | "Browse N Studies", "RRM Academy Research Library", "Research Library.", "Access the Research Library" | Healthy. Diverse anchors. |
| /courses/ | 2 | "Explore Courses" x2 | Acceptable but exact-match repetition; both are CTAs. |
| /faqs/ | 0 (inline); section /faqs/what-is-... is linked 2x | n/a | The faqs index itself is unreachable; only one specific FAQ slug receives traffic, and that slug is misrouted (W3-1, W3-2). |
| /commentary/ | 1 | "Expert Commentary." | Healthy. |

Net summary: of 10 cluster destinations, 5 have 0 inbound homepage links (5 pillars: what-is-rrm, naprotechnology, femm, neofertility, common-questions-about-rrm). One additional destination (`/glossary/`) is also orphan. The homepage is heavily over-weighted toward `/library/` (4 links, 4 diverse anchors) and the founder-spotlight commentary (2 links). Course pages collectively receive 5 links (2 to /courses/ root, 2 to the endo masterclass, 1 to rrm-vs-ivf), which is healthy for a CTA-driven page.

## Pages-clean

- Hero CTA pair (lines 151-152): correct anchors, correct targets, status 200.
- Final CTA pair (lines 438-439): correct anchors, correct targets, status 200, anchor diversity good ("Explore Courses" / "Access the Research Library").
- Founder spotlight links (lines 332, 357): correct anchors, correct targets; minor over-link concern flagged in W3-10 but not action-blocking.
- Research and Commentary section paragraph 1 and 2 (lines 407, 413): clean. Bold-anchor pattern is consistent and the targets (`/library/`, `/commentary/`) are correct.
- All 7 unique destinations return 200 OK on live curl. No broken anchors detected.

## Persona-funnel notes

- **Searcher** (organic, top-of-funnel): served by hero links and library/commentary anchors. Pillar pages are the missing link layer (W3-11).
- **Exhausted Patient**: served by For-Patients list; W3-5, W3-6, W3-8, W3-13 add the missing primer routes.
- **Values-Driven Couple**: routed via /courses/rrm-vs-ivf/ but anchor mismatch (W3-7).
- **Cost-Conscious Couple**: only one route (rrm-vs-ivf course); add /what-is-rrm/ via W3-1/W3-2 retarget for free explainer path.
- **Curious Generalist**: best served by W3-1/W3-2 retarget plus W3-12 (link to /common-questions-about-rrm).
- **Frustrated OBGYN**: served only by For-Clinicians block (W3-14) and indirectly by founder spotlight. NaProTechnology pillar (W3-3, W3-4) is the natural deep-dive destination.
- **FABM Professional**: For-Clinicians item 3 (line 309) "fertility awareness educator who wants clinical grounding" is unlinked. /femm/ pillar is unreachable from homepage. Add via W3-14.
