# Apply Sheet — Homepage Multi-Pass Review

**Run:** 2254 | **Branch:** claude/homepage-multipass-2026-05-05-2254 | **BASE_SHA:** b4b51e1

## Totals

- Total rows after dedupe + bulk grouping: 78 (95 raw findings before dedupe)
- By default disposition: APPLY-suggested 39 / DEFER 28 / BACKLOG 11
- Multi-wave consensus rows: 8
- Conflicts flagged: 5
- Bulk groups: 2
- MICHELLE-WARMTH (DEFER, row-level approval required): 5
- VOC-gap (BACKLOG): 8

## Top concerns

1. **W1-1** (CRITICAL): Hand-authored JSON-LD `@graph` bypasses `buildIdentityGraph()` SSOT — single highest-leverage fix; unlocks W1-2, W1-3, W1-6, W1-7 by SSOT propagation.
2. **W1-4 + W1-12** (CRITICAL/HIGH, AEO): FAQPage answers 39-58 words (AEO sweet spot 80-120) and hero subtitle is inventory boilerplate, not a definitional answer; both are top-extracted slots.
3. **W3-1 + W3-2** (HIGH, multi-wave): Two inline anchors for "Restorative Reproductive Medicine" misroute to FAQ stub instead of `/what-is-rrm/` pillar — single retarget fixes both.
4. **W3-11** (HIGH): Five named pillars (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/common-questions-about-rrm`) are unreachable from any inline link on the homepage.
5. **W2-must-fix-2 / W2-must-fix-7 / W4-1** (HIGH, multi-wave): Verbatim repeats and manifesto-before-recognition violate voice rules and Recognize-Mirror-Prove sequencing.

## Ruling format reminder for Brian

```
# One line per row id with APPLY | DEFER | DROP
W1-3: APPLY
W1-7: DROP
W1-12: APPLY (note: "use suggested_fix verbatim, no rewrite")
BULK-APPLY trust-bar-aria
BULK-DEFER schema-low-leverage
W4-michelle-warmth-2: APPLY  # MUST be row-level, bulk does not approve MICHELLE-WARMTH
... (any unmentioned rows default to DEFER)
```

Special rules:
- MICHELLE-WARMTH rows REQUIRE row-level APPLY. Bulk does not satisfy.
- BACKLOG rows stay BACKLOG unless explicit `APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS`.
- Conflicting rows: choose one or merge. "APPLY both" only valid if commutative.

## Multi-wave consensus

Rows where 2+ waves flagged the same issue.

| id | waves | severity | location | issue | suggested_action |
|----|-------|----------|----------|-------|------------------|
| MW-1 (W1-23 + W2-should-fix-10 + W3-7) | W1, W2, W3 | MEDIUM | index.astro:301 | "natural conception" anchor links to `/courses/rrm-vs-ivf/` — anchor/target mismatch, possible 404, sales-funnel for primer term | RE-ANCHOR to "compare RRM and IVF" or retarget to `/what-is-rrm/`; verify URL with curl |
| MW-2 (W1-12 + W2-consider-1 + W4-2) | W1, W2, W4 | HIGH | index.astro:147-149 | Hero subtitle is corpus inventory, not a definitional/empathic answer; misses AEO snippet eligibility AND late-funnel buyer recognition | REWRITE-PROSE per W1-12 (definitional lead) or W4-2 (use-it-yourself frame); pick one |
| MW-3 (W1-19 + W2-should-fix-1 + W4-3) | W1, W2, W4 | MEDIUM | index.astro:194-202 | Check Engine analogy heading has zero retrieval value AND uses non-Naomi metaphor AND opens cold for high-anxiety reader | REWRITE-PROSE: replace H2 with clinical framing per W2-should-fix-1; add recognition opener per W4-3 (DEFER, MICHELLE-WARMTH) |
| MW-4 (W2-must-fix-2 + W2-must-fix-7) | W2, W2 | HIGH | index.astro:186, 244, 292, 435 | Two verbatim repeats across page ("answers and restored function" and "you are in the right place") | REWRITE per W2-must-fix-2 line 244 + per W2-must-fix-7 line 435 |
| MW-5 (W2-should-fix-9 + W4-7) | W2, W4 | MEDIUM | index.astro:262-265 | Two Approaches paragraph hedges with "Often" AND reads as soft jab at IVF for post-IVF reader | REWRITE-PROSE per W4-7 ("RRM starts from a different question") which solves both concerns |
| MW-6 (W2-should-fix-8 + W4-10) | W2, W4 | LOW-MEDIUM | index.astro:424, 426-428 | "Waiting to be heard" is hedged sentiment AND CTA pivots to third-person "patients" right after second-person tagline | REWRITE-PROSE: combine W2-should-fix-8 (declarative close) + W4-10 (second-person retention) |
| MW-7 (W1-22 + W3-3 + W3-9) | W1, W3, W3 | MEDIUM-HIGH | index.astro:182, 225-229, 282 | Multiple high-intent terms unlinked: "evaluates both partners", "NaProTechnology", "hormonal suppression", first-mention founder | ADD-LINK per W3-3, W3-4, W3-9 (NaPro pillar, founder, suppression FAQ) |
| MW-8 (W1-23 / W2-should-fix-10 / W3-13) | W1, W2, W3 | LOW-MEDIUM | index.astro:298-302 | For-Patients list is sales-funnel-only, asymmetric link distribution, anchor mismatch on "natural conception" | combined fix: ADD-LINK per W3-13 + RE-ANCHOR per MW-1 |

## Conflicts

Rows that conflict with each other. Brian must resolve.

| id | conflicts_with | reason | suggested_resolution |
|----|----------------|--------|----------------------|
| W1-12 | W2-consider-1, W4-2 | All three rewrite the hero subtitle (line 147-149) to non-commutative outcomes (definitional vs Recognize-frame vs corpus-as-tool) | Pick W1-12 (AEO leverage) OR W4-2 (VOC alignment); merging the patient hook + definition is also possible |
| W1-11 | (advisory) W2-consider-2 | W1-11 adds H2 "What Is Restorative Reproductive Medicine?" before line 174; W2-consider-2 inserts a peer-mirror paragraph between 175-184. Same line range, different action_types. | APPLY W1-11 first (structural); defer W2-consider-2 to a later content pass |
| W2-must-fix-1 | W4-8 | Both touch Comparison/Suppressive section copy near line 282; W2-must-fix-1 fixes a double-hyphen at line 228 (different concrete line); W4-8 reframes the cost line at 282. | No real conflict on lines, but APPLY both — apply W4-8 first to set the section tone, then W2-must-fix-1 |
| W3-5 | W3-6 | Both touch the endometriosis link strategy; W3-5 keeps two same-anchor links, W3-6 diversifies anchor on line 234 to "excision surgery". | APPLY W3-6 (re-anchor at 234) AND drop redundant W3-5; net effect = same target with anchor diversity |
| W2-must-fix-9 | W2-must-fix-2 | W2-must-fix-9 rewrites lines 220-222 (and notes paraphrase with line 247); W2-must-fix-2 rewrites line 244 (close to 247). Same section, opposing TRIM vs REWRITE; risk of touching adjacent prose with stale references. | APPLY W2-must-fix-2 first (line 244 only), then W2-must-fix-9 (lines 220-222 trim) — non-overlapping lines, sequential edits OK |

---

## Wave 1: AEO/SEO/GEO (30 rows)

### Schema (highest-leverage)

```
- id: W1-1
- waves: [W1]
- severity: CRITICAL
- location: src/pages/index.astro:17-131 / Schema
- excerpt: N/A (entire jsonLd constant is hand-authored)
- issue: Homepage hand-rolls the @graph instead of using buildIdentityGraph() SSOT — violates CLAUDE.md rule.
- suggested_fix: Replace 17-131 with const graph = [...buildIdentityGraph(), buildFAQPage([...]), buildBreadcrumbList(...), buildHomepageOfferCatalog()]; emit @graph.
- action_type: MODIFY-SCHEMA
- tags: [SCHEMA, SSOT]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-2
- waves: [W1]
- severity: CRITICAL
- location: src/pages/index.astro:38-39 / Schema (Organization)
- excerpt: '@type': ['EducationalOrganization', 'Organization'],
- issue: Missing MedicalOrganization in @type array; SSOT declares all three.
- suggested_fix: '@type': ['Organization', 'EducationalOrganization', 'MedicalOrganization'],
- action_type: ADD-SCHEMA
- tags: [SCHEMA]
- conflict_check: empty (subsumed by W1-1 if applied)
- default_disposition: APPLY-suggested
```

```
- id: W1-3
- waves: [W1]
- severity: CRITICAL
- location: src/pages/index.astro:48-53 / Schema (parentOrganization)
- excerpt: parentOrganization: { '@type': 'Organization', name: '...', taxID: '93-4594315', ... }
- issue: Parent inlined as fresh node; should be @id ref to https://rrm.foundation/#organization. EIN should be PropertyValue.
- suggested_fix: parentOrganization: { '@id': 'https://rrm.foundation/#organization' }; add identifier PropertyValue for EIN.
- action_type: MODIFY-SCHEMA
- tags: [SCHEMA, GEO]
- conflict_check: empty (subsumed by W1-1)
- default_disposition: APPLY-suggested
```

```
- id: W1-4
- waves: [W1]
- severity: CRITICAL
- location: src/pages/index.astro:87-123 / Schema (FAQPage)
- excerpt: Four Question entries with text answers 39-58 words.
- issue: FAQPage not nested under WebPage mainEntity; answers below 80-120 word AEO sweet spot; missing author/publisher refs.
- suggested_fix: Add WebPage node @id=#webpage with mainEntity=#faq; add author/publisher refs to each Answer; expand answers to 80-120 words.
- action_type: MODIFY-SCHEMA
- tags: [SCHEMA, AEO]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-5
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:124-129 / Schema (BreadcrumbList)
- excerpt: BreadcrumbList with single item "Home"
- issue: No @id, item is bare URL string, single-item breadcrumb adds zero SEO value on homepage.
- suggested_fix: Remove entirely OR add @id=#breadcrumb and reshape item to {@id, name}.
- action_type: MODIFY-SCHEMA
- tags: [SCHEMA]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W1-6
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:54-57 / Schema (Organization sameAs)
- excerpt: sameAs: ['https://www.instagram.com/rrmacademy', 'https://www.youtube.com/@rrmacademy']
- issue: Only 2 sameAs URLs. Missing Wikipedia/Wikidata, ProPublica, Charity Navigator, LinkedIn, X, Substack, TikTok.
- suggested_fix: Expand ssot/organization.json same_as[] with Wikidata QID, ProPublica EIN URL, LinkedIn, X, GuideStar.
- action_type: MODIFY-SCHEMA
- tags: [SCHEMA, GEO, SSOT]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-7
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:36 / Schema (Person resolution)
- excerpt: naomi,
- issue: Verify SSOT-bound Naomi node includes ORCID 0000-0003-3706-3112, NPI 1881034908, medicalSpecialty[], worksFor.
- suggested_fix: Audit src/generated/ssot-schema.json; if missing, fix at SSOT layer (config/ecosystem-identity/).
- action_type: ADD-SCHEMA
- tags: [SCHEMA, GEO, AEO, SSOT]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-8
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:67-84 / Schema (OfferCatalog)
- excerpt: Each Offer is leaf-only — no Course reference.
- issue: Offers should itemOffered: { @id: courses/<slug>/#course } and emit Course nodes via buildCourse(slug).
- suggested_fix: Add itemOffered with @id ref to each Offer and emit corresponding Course nodes in the same @graph.
- action_type: ADD-SCHEMA
- tags: [SCHEMA, AEO]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-14
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:138 / Speakable
- excerpt: speakable={['.hp-hero h1', '.hp-hero__subtitle', '.hp-section p']}
- issue: '.hp-section p' matches 30+ paragraphs across the whole page.
- suggested_fix: speakable={['.hp-hero h1', '.hp-hero__subtitle', '.hp-section:first-of-type p:first-of-type']}
- action_type: MODIFY-SCHEMA
- tags: [SCHEMA, AEO]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-25
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:344 / Quote attribution
- excerpt: <cite>Dr. Naomi Whittaker, Founder of RRM Academy</cite>
- issue: blockquote lacks Quotation schema and structured @id attribution.
- suggested_fix: Add Quotation graph piece with @id and spokenByCharacter=#naomi-whittaker, OR add cite="..." attribute.
- action_type: ADD-SCHEMA
- tags: [SCHEMA, GEO]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W1-30
- waves: [W1]
- severity: LOW
- location: src/pages/index.astro:54-57 / Schema (subjectOf)
- excerpt: Organization sameAs array.
- issue: Agent-discovery URLs (.well-known/agent-card.json, llms.txt) not declared.
- suggested_fix: Add subjectOf: [{CreativeWork, url: '/.well-known/agent-card.json'}, {CreativeWork, url: '/llms.txt'}].
- action_type: ADD-SCHEMA
- tags: [SCHEMA, GEO]
- conflict_check: empty
- default_disposition: DEFER
```

### Meta + headings

```
- id: W1-9
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:134, 146 / Title vs H1
- excerpt: title="RRM Academy | Evidence-Based Reproductive Medicine Education" / H1 "Evidence-Based Restorative Reproductive Medicine Education"
- issue: Title drops "Restorative" while H1 includes it; SERP/H1 mismatch.
- suggested_fix: Title: RRM Academy | Evidence-Based Restorative Reproductive Medicine Education (60 chars).
- action_type: REWRITE-PROSE
- tags: [META]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-10
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:135 / Meta description
- excerpt: "RRM Academy offers evidence-based education in Restorative Reproductive Medicine. Courses, a research library, and expert guidance for patients and clinicians."
- issue: Misses NaProTechnology entity and founder name; no numerical credibility hook.
- suggested_fix: "RRM Academy: 3,370+ peer-reviewed studies, NaProTechnology-grounded courses, and clinical guidance from Dr. Naomi Whittaker, MD..."
- action_type: REWRITE-PROSE
- tags: [META, AEO]
- conflict_check: conflicts with W2-consider-8 (different rewrite of same line)
- default_disposition: APPLY-suggested
```

```
- id: W1-11
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:174-188 / Intro section
- excerpt: 3 paragraphs of substantive content with no H2 (skips H1 -> H2 at 194)
- issue: Heading hierarchy gap; intro is highest-density "What is RRM" definition with no queryable H2.
- suggested_fix: Add <h2>What Is Restorative Reproductive Medicine?</h2> before line 174.
- action_type: ADD-PROSE
- tags: [HEADING, AEO]
- conflict_check: advisory conflict with W2-consider-2 (line range overlap, different additions)
- default_disposition: APPLY-suggested
```

```
- id: W1-12
- waves: [W1, W2, W4] -- see MW-2
- severity: HIGH
- location: src/pages/index.astro:148-149 / Hero subtitle
- excerpt: "{articleCount} scholarly works related to RRM cataloged and linked to authors, institutions, and topics."
- issue: Boilerplate inventory; misses AEO definitional snippet; misses Recognize beat for buyer.
- suggested_fix: "Restorative Reproductive Medicine (RRM) diagnoses and treats the underlying causes of infertility, painful periods, and reproductive disorders rather than suppressing or bypassing them."
- action_type: REWRITE-PROSE
- tags: [AEO]
- conflict_check: conflicts with W2-consider-1, W4-2 (same line, non-commutative)
- default_disposition: APPLY-suggested (multi-wave consensus)
```

```
- id: W1-19
- waves: [W1, W2, W4] -- see MW-3
- severity: MEDIUM
- location: src/pages/index.astro:194-212 / Check Engine H2
- excerpt: <h2>The Check Engine Light Analogy</h2>
- issue: Zero AEO retrieval value; non-Naomi metaphor; cold opener.
- suggested_fix: <h2>Why Symptom Suppression Fails: The Check Engine Light</h2> OR replace per W2-should-fix-1.
- action_type: REWRITE-PROSE
- tags: [HEADING, AEO]
- conflict_check: see MW-3
- default_disposition: APPLY-suggested
```

```
- id: W1-20
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:218 / How RRM Works H2
- excerpt: <h2>What RRM Looks Like</h2>
- issue: Casual heading; doesn't match query intent.
- suggested_fix: <h2>How Restorative Reproductive Medicine Works</h2>
- action_type: REWRITE-PROSE
- tags: [HEADING]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-21
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:405 / Latest Insights H2
- excerpt: <h2>Research and Commentary</h2>
- issue: Generic heading; doesn't pull queries.
- suggested_fix: <h2>Peer-Reviewed Research and Clinical Commentary</h2>
- action_type: REWRITE-PROSE
- tags: [HEADING]
- conflict_check: empty
- default_disposition: DEFER
```

### AEO snippets + comparison

```
- id: W1-17
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:280 / Comparison column
- excerpt: <h3>Suppressive Medicine</h3>
- issue: Editorial framing not recognized as a medical term; loses retrieval intercept.
- suggested_fix: <h3>Conventional Suppressive and Bypass Medicine</h3>
- action_type: REWRITE-PROSE
- tags: [AEO]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W1-18
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:262-265 / Two Approaches intro
- excerpt: "RRM does not declare that your body has failed... It asks: what is actually wrong, and can it be fixed? Often, the answer is yes."
- issue: Subject anchor drops after first sentence; AEO extractability suffers.
- suggested_fix: Repeat "RRM" as subject in second sentence.
- action_type: REWRITE-PROSE
- tags: [AEO]
- conflict_check: see MW-5 (W4-7 supersedes for same passage)
- default_disposition: APPLY-suggested
```

```
- id: W1-24
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:267-285 / Comparison structure
- excerpt: Two <div class="hp-comparison__col"> columns
- issue: No <table> semantics; high-extraction-value content lacks structural marker.
- suggested_fix: Wrap in <table role="table"> with <thead>/<tbody> rows for Goal/Method/Your Role.
- action_type: REWRITE-PROSE
- tags: [AEO]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W1-27
- waves: [W1]
- severity: LOW
- location: src/pages/index.astro:367-398 / Common Questions UL
- excerpt: <ul><li><strong>Q?</strong> A.</li></ul>
- issue: Should be <dl>/<dt>/<dd> or <details>/<summary> for FAQ pattern.
- suggested_fix: Restructure as <dl class="hp-faq"> or <details> accordion.
- action_type: REWRITE-PROSE
- tags: [AEO]
- conflict_check: empty
- default_disposition: DEFER
```

### Founder + photo

```
- id: W1-13
- waves: [W1]
- severity: HIGH
- location: src/pages/index.astro:321-329 / Founder photo
- excerpt: Raw <img src="/images/authors/naomi-whittaker.webp" ... />
- issue: Raw <img>, no <Image>, no AVIF, no responsive srcset.
- suggested_fix: Convert to <Image> from astro:assets with widths={[80,96,192]}, formats={['avif','webp']}.
- action_type: REWRITE-PROSE
- tags: [PERFORMANCE]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W1-26
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:332 / Founder name link
- excerpt: <a href="/commentary/rrm-spotlight-naomi-whittaker-md/">
- issue: Links to commentary post, not canonical /about/dr-whittaker/ profile.
- suggested_fix: Link to /about/dr-whittaker/ if it exists; until then add rel="author".
- action_type: REWRITE-PROSE
- tags: [GEO]
- conflict_check: empty (advisory: W3-10 may DROP one of the two founder links)
- default_disposition: DEFER
```

### Trust bar + accessibility

```
- id: W1-15
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:159, 162-163, 165 / Trust logos as text
- excerpt: <span class="hp-trust__logo hp-trust__logo--jama">JAMA</span>
- issue: Six logos are CSS-styled text spans without semantic meaning AND claim outlet coverage with no citations — possible misrepresentation.
- suggested_fix: Add aria-label="Cited by [outlet]" + link to coverage URL OR reframe as journals-cited and link to library filters. Verify citations exist first.
- action_type: REWRITE-PROSE
- tags: [TRUST, A11Y]
- conflict_check: empty
- default_disposition: DEFER (verification gate)
```

```
- id: W1-16
- waves: [W1]
- severity: MEDIUM
- location: src/pages/index.astro:158, 161, 164 / Logo image alt
- excerpt: <span role="img" aria-label="The New England Journal of Medicine">
- issue: NEJM CSS-mask span will fail strict image validation; technically passes a11y.
- suggested_fix: Convert NEJM to <img alt="..." /> styled with CSS filter.
- action_type: REWRITE-PROSE
- tags: [BULK-CANDIDATE-trust-bar-aria, A11Y]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W1-29
- waves: [W1]
- severity: LOW
- location: src/pages/index.astro:156-167 / Trust bar markup
- excerpt: <div class="hp-hero__trust ...">
- issue: No aria-labelledby or section heading.
- suggested_fix: Wrap in <section aria-labelledby="trust-bar-heading"> with sr-only heading.
- action_type: ADD-PROSE
- tags: [BULK-CANDIDATE-trust-bar-aria, A11Y]
- conflict_check: empty (gated by W1-15 verification)
- default_disposition: DEFER
```

### Internal anchors + UX

```
- id: W1-22
- waves: [W1, W3]
- severity: MEDIUM
- location: src/pages/index.astro:225-229 / Why paragraph
- excerpt: "It starts with the question: why? RRM evaluates both partners. ..."
- issue: Key terms ("evaluates both partners", "cycle is diagnostic data", "male factor assessment") lack internal links.
- suggested_fix: Internal links: "evaluates both partners" -> appropriate FAQ; "cycle is diagnostic data" -> /glossary/charting; "male factor assessment" -> future pillar.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING]
- conflict_check: see MW-7
- default_disposition: APPLY-suggested
```

```
- id: W1-23
- waves: [W1, W2, W3] -- see MW-1
- severity: MEDIUM
- location: src/pages/index.astro:301 / "natural conception" link
- excerpt: <a href="/courses/rrm-vs-ivf/">natural conception</a>
- issue: Verify URL; anchor text mismatches sales-page target.
- suggested_fix: Verify with curl. RE-ANCHOR to "compare RRM and IVF" OR retarget to /what-is-rrm/.
- action_type: RE-ANCHOR
- tags: [INTERNAL-LINKING]
- conflict_check: see MW-1
- default_disposition: APPLY-suggested (multi-wave consensus)
```

```
- id: W1-28
- waves: [W1]
- severity: LOW
- location: src/pages/index.astro:154 / LastUpdated
- excerpt: <p class="hp-hero__updated">...</p> (display:none on mobile)
- issue: Last-updated date hidden on mobile (60-70% of patient traffic) — loses freshness signal.
- suggested_fix: Show on mobile, smaller font; "Updated 2026-05-05" format.
- action_type: REWRITE-PROSE
- tags: [TRUST]
- conflict_check: empty
- default_disposition: DEFER
```

---

## Wave 2: Messaging + Grammar (27 rows)

### Must-fix tier (HIGH)

```
- id: W2-must-fix-1
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:228
- excerpt: "Male factor assessment, hormonal panels, semen analysis -- diagnostics for both partners"
- issue: Double-hyphen used as dash in body prose.
- suggested_fix: "Male factor assessment, hormonal panels, semen analysis: diagnostics for both partners"
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-2
- waves: [W2] -- see MW-4
- severity: HIGH
- location: src/pages/index.astro:186 and 244
- excerpt: Verbatim repeat: "The goal is answers and restored function."
- issue: Verbatim phrase repeat in adjacent sections; reads as copy-paste.
- suggested_fix: Line 244 bold opener: "When the underlying cause is treated, function returns."
- action_type: REWRITE-PROSE
- tags: [VOICE, REPEAT]
- conflict_check: see MW-4 (sequential with W2-must-fix-9)
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-3
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:350
- excerpt: "Dr. Whittaker is a board-certified OBGYN and NaProTechnology"
- issue: Capitalization inconsistency — "Board-Certified" used 3x, lowercase 1x.
- suggested_fix: "Dr. Whittaker is a Board-Certified OBGYN and NaProTechnology"
- action_type: REWRITE-PROSE
- tags: [VOICE, BULK-CANDIDATE-capitalization]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-4
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:307
- excerpt: "...physician in OB/GYN, family medicine, or reproductive endocrinology..."
- issue: Lists REI/reproductive endocrinology as RRM target audience; voice profile flags REIs as IVF doctors.
- suggested_fix: "You are a physician in OB/GYN or family medicine who wants to offer patients real diagnostic and restorative options beyond suppressive medications and specialist referrals."
- action_type: REWRITE-PROSE
- tags: [VOICE, RRM-EDITORIAL]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-5
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:371-373
- excerpt: "{count} peer-reviewed articles. These are published studies in peer-reviewed journals, not opinion pieces."
- issue: "Peer-reviewed" appears twice in two consecutive sentences.
- suggested_fix: "{count} peer-reviewed articles, published in indexed medical journals, not opinion pieces."
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-6
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:244-245
- excerpt: "When the underlying disease is treated, hormonal rhythms can normalize..."
- issue: Academic passive voice; RRM voice requires active.
- suggested_fix: "When treatment reaches the underlying disease, hormonal rhythms normalize and ovulation can return."
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-7
- waves: [W2] -- see MW-4
- severity: HIGH
- location: src/pages/index.astro:292 and 435
- excerpt: Verbatim: "You Are in the Right Place" (heading) / "You are in the right place." (CTA close)
- issue: Verbatim heading-as-close echo across 143 lines.
- suggested_fix: Replace line 435: "The evidence exists. The clinicians exist. Your first step is a course or the library."
- action_type: REWRITE-PROSE
- tags: [VOICE, REPEAT]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-8
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:384
- excerpt: "<strong>I'm not a medical professional. Is this for me?</strong>"
- issue: Contraction in bold heading; schema FAQ uses "I am not a medical professional".
- suggested_fix: "<strong>I am not a medical professional. Is this for me?</strong>"
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-must-fix-9
- waves: [W2]
- severity: HIGH
- location: src/pages/index.astro:222 and 247
- excerpt: Paraphrase duplication: "cooperate with the body rather than working around it" vs "repairs the reproductive system rather than routing around it"
- issue: Same conceptual move in adjacent paragraphs.
- suggested_fix: Delete line 222's trailing clause; rewrite 220-222 as: "Every patient is different, and RRM does not follow a single fixed protocol. The same principles guide every case: find the cause, treat the disease, restore the function."
- action_type: TRIM-PROSE
- tags: [VOICE, REPEAT]
- conflict_check: see MW-4 conflict notes
- default_disposition: APPLY-suggested
```

### Should-fix tier (MEDIUM)

```
- id: W2-should-fix-1
- waves: [W2] -- see MW-3
- severity: MEDIUM
- location: src/pages/index.astro:194-201
- excerpt: "The Check Engine Light Analogy"
- issue: Generic AI analogy not from Naomi's interviews; voice profile flags this.
- suggested_fix: Replace section heading with "The Standard Playbook, and Why It Fails"; use verified language.
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: see MW-3
- default_disposition: DEFER
```

```
- id: W2-should-fix-2
- waves: [W2]
- severity: MEDIUM
- location: src/pages/index.astro:199-201
- excerpt: "For decades, women have been handed the tape..."
- issue: Female-only framing; voice rule = couple-centered.
- suggested_fix: Add: "For the partner, abnormal semen parameters are overlooked or attributed to stress."
- action_type: ADD-PROSE
- tags: [VOICE, RRM-EDITORIAL]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W2-should-fix-3
- waves: [W2]
- severity: MEDIUM
- location: src/pages/index.astro:237-240
- excerpt: "Because RRM is multidisciplinary, the care team might include..."
- issue: 41-word run-on; violates 20-word cap.
- suggested_fix: Break into three short sentences.
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-should-fix-4
- waves: [W2]
- severity: MEDIUM
- location: src/pages/index.astro:378
- excerpt: "Our students come in saying..."
- issue: Institutional "our" voice; "come in" ambiguous.
- suggested_fix: "Students often arrive saying..."
- action_type: REWRITE-PROSE
- tags: [VOICE, BULK-CANDIDATE-our-voice]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-should-fix-5
- waves: [W2]
- severity: MEDIUM
- location: src/pages/index.astro:384-391
- excerpt: "Many of our students are patients, not clinicians."
- issue: Same "our students" institutional voice (2nd occurrence).
- suggested_fix: "Many students are patients, not clinicians."
- action_type: REWRITE-PROSE
- tags: [VOICE, BULK-CANDIDATE-our-voice]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-should-fix-6
- waves: [W2]
- severity: MEDIUM
- location: src/pages/index.astro:181
- excerpt: "Our founder, Dr. Naomi Whittaker..."
- issue: Institutional "our"; 23-word sentence breaches 20-word cap.
- suggested_fix: "RRM Academy was founded by Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI. She is a NaProTechnology fellowship-trained surgeon."
- action_type: REWRITE-PROSE
- tags: [VOICE, BULK-CANDIDATE-our-voice]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W2-should-fix-7
- waves: [W2]
- severity: MEDIUM
- location: src/pages/index.astro:347-355
- excerpt: "Dr. Whittaker built RRM Academy because of her..."
- issue: Narrative preamble softens verified-language sharpness.
- suggested_fix: "Women with real, diagnosable conditions. Told their pain was normal. Dismissed. Clinicians who wanted to help and were never taught how. Those are two separate failures, and they compound each other. Dr. Whittaker built RRM Academy to close both."
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W2-should-fix-8
- waves: [W2] -- see MW-6
- severity: MEDIUM
- location: src/pages/index.astro:424
- excerpt: "Your body is not broken. It is waiting to be heard."
- issue: Hedged sentiment close; voice profile requires declarative endings.
- suggested_fix: "Your body is not broken. It has signals. RRM is how you read them."
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: see MW-6
- default_disposition: APPLY-suggested
```

```
- id: W2-should-fix-9
- waves: [W2] -- see MW-5
- severity: MEDIUM
- location: src/pages/index.astro:263-265
- excerpt: "...In most cases, the answer is yes." (currently "Often, the answer is yes.")
- issue: Hedging "Often" undercuts directness.
- suggested_fix: "For most couples, the answer is yes."
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: see MW-5 (W4-7 supersedes)
- default_disposition: APPLY-suggested
```

```
- id: W2-should-fix-10
- waves: [W2] -- see MW-1
- severity: MEDIUM
- location: src/pages/index.astro:301
- excerpt: <a href="/courses/rrm-vs-ivf/">natural conception</a>
- issue: Anchor-target mismatch (term vs sales page).
- suggested_fix: Separate link from preference: "You prefer natural conception... <a>See the RRM vs. IVF course.</a>"
- action_type: REWRITE-PROSE
- tags: [INTERNAL-LINKING]
- conflict_check: see MW-1
- default_disposition: APPLY-suggested
```

### Consider tier (LOW)

```
- id: W2-consider-1
- waves: [W2] -- see MW-2
- severity: LOW
- location: src/pages/index.astro:146-149
- excerpt: Hero subtitle leads with library count
- issue: Recognize step missing — opens with credential count instead of acknowledging visitor's situation.
- suggested_fix: "The educational platform for patients who have been dismissed and clinicians who want to do better. {count} peer-reviewed studies to back every claim."
- action_type: REWRITE-PROSE
- tags: [VOC, BUYER-PSYCH]
- conflict_check: see MW-2
- default_disposition: DEFER (conflict resolution required)
```

```
- id: W2-consider-2
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:172-188 / Intro
- excerpt: Recognize -> Explain -> Offer (Mirror missing)
- issue: No peer story (Mirror step) until founder blockquote at line 338.
- suggested_fix: Insert one-paragraph patient mirror between intro Recognize and RRM Academy intro.
- action_type: ADD-PROSE
- tags: [VOC, BUYER-PSYCH]
- conflict_check: advisory conflict with W1-11
- default_disposition: DEFER
```

```
- id: W2-consider-3
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:425-435 / CTA
- excerpt: "Most of the patients who find RRM Academy have spent years..."
- issue: Paraphrases intro 175-177 and analogy 199-201; CTA should advance, not re-summarize.
- suggested_fix: "The patients who find RRM Academy have already done the reading. They know something is wrong. What they need is a path forward."
- action_type: REWRITE-PROSE
- tags: [VOICE, REPEAT]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W2-consider-4
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:183-184
- excerpt: "Everything here reflects her clinical standards."
- issue: Vague institutional self-assertion.
- suggested_fix: "The diagnostics, surgical standards, and educational content here reflect her NaProTechnology fellowship training and clinical practice."
- action_type: REWRITE-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W2-consider-5
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:338-345
- excerpt: "I'll never forget a patient I saw during my residency..."
- issue: "I'll never forget" is sentimental opener; preserve verbatim if from Naomi's recorded interview.
- suggested_fix: If verbatim, KEEP. If paraphrased, reopen with: "During my residency, I saw a patient with a history of miscarriages..."
- action_type: REWRITE-PROSE
- tags: [VOICE, VERBATIM-CHECK]
- conflict_check: empty
- default_disposition: DEFER (verbatim verification gate)
```

```
- id: W2-consider-6
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:413-416
- excerpt: "Dr. Whittaker and the RRM Academy faculty..."
- issue: "Faculty" introduced with no prior reference.
- suggested_fix: "Dr. Whittaker translates the research into clinical context. What a new study actually means..."
- action_type: TRIM-PROSE
- tags: [VOICE]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W2-consider-7
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:309-311
- excerpt: "...how NaProTechnology-based medicine, restorative surgery, and complementary disciplines..."
- issue: NaPro=RRM confusion risk in clinician bullet.
- suggested_fix: "...how restorative diagnostics, cycle-based medicine, and surgical approaches..."
- action_type: REWRITE-PROSE
- tags: [VOICE, RRM-EDITORIAL]
- conflict_check: empty
- default_disposition: DEFER
```

```
- id: W2-consider-8
- waves: [W2]
- severity: LOW
- location: src/pages/index.astro:134 / Meta description
- excerpt: "RRM Academy offers evidence-based education..."
- issue: Passive verb "offers"; lacks problem hook.
- suggested_fix: "Dismissed, misdiagnosed, or told your infertility is unexplained? RRM Academy is the educational home of Restorative Reproductive Medicine..."
- action_type: REWRITE-PROSE
- tags: [META]
- conflict_check: conflicts with W1-10 (same line, different rewrite)
- default_disposition: DEFER
```

---

## Wave 3: Internal Linking (14 rows)

### Anchor-text + retargeting issues

```
- id: W3-1
- waves: [W3]
- severity: HIGH
- location: src/pages/index.astro:179
- excerpt: '"RRM Academy is the educational home for <a href="/faqs/...">Restorative Reproductive Medicine</a>"'
- issue: Lede inline link points at FAQ stub instead of /what-is-rrm/ pillar.
- suggested_fix: Retarget href to /what-is-rrm/. Anchor text stays.
- action_type: RETARGET
- tags: [INTERNAL-LINKING, PILLAR]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-2
- waves: [W3]
- severity: HIGH
- location: src/pages/index.astro:204
- excerpt: 'Second inline use of "Restorative Reproductive Medicine" -> same FAQ stub'
- issue: Compounds W3-1 misrouting.
- suggested_fix: Retarget href to /what-is-rrm/.
- action_type: RETARGET
- tags: [INTERNAL-LINKING, PILLAR]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-3
- waves: [W3] -- see MW-7
- severity: HIGH
- location: src/pages/index.astro:182-183
- excerpt: First mention of founder + NaProTechnology in body, both unlinked.
- issue: Top-shelf entity terms unlinked at lede.
- suggested_fix: Wrap "Dr. Naomi Whittaker, MD" -> /commentary/rrm-spotlight-naomi-whittaker-md/. Wrap "NaProTechnology" -> /naprotechnology/.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING, PILLAR, GEO]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-4
- waves: [W3] -- see MW-7
- severity: HIGH
- location: src/pages/index.astro:310
- excerpt: "NaProTechnology-based medicine" unlinked
- issue: Pillar /naprotechnology/ is primary cluster destination; unlinked here.
- suggested_fix: Wrap "NaProTechnology" -> /naprotechnology/.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING, PILLAR]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-5
- waves: [W3]
- severity: MEDIUM
- location: src/pages/index.astro:298
- excerpt: "endometriosis" links course; "PCOS" and "recurrent miscarriage" unlinked
- issue: Asymmetric link distribution; only one of three diagnoses gets a destination.
- suggested_fix: Add parallel links for PCOS and recurrent miscarriage when pages exist; or re-anchor endometriosis to primer.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING]
- conflict_check: redundant with W3-6 (both touch endo link strategy)
- default_disposition: DEFER
```

```
- id: W3-6
- waves: [W3]
- severity: MEDIUM
- location: src/pages/index.astro:234
- excerpt: '<a href="/courses/...endometriosis-and-surgery/">endometriosis</a>'
- issue: Second of two homepage endometriosis links to same paid masterclass; low anchor diversity.
- suggested_fix: RE-ANCHOR line 234 to "excision surgery" -> future /endometriosis/ pillar or relevant FAQ.
- action_type: RE-ANCHOR
- tags: [INTERNAL-LINKING]
- conflict_check: see W3-5 conflict note
- default_disposition: APPLY-suggested
```

```
- id: W3-7
- waves: [W3] -- see MW-1
- severity: MEDIUM
- location: src/pages/index.astro:301
- excerpt: '<a href="/courses/rrm-vs-ivf/">natural conception</a>'
- issue: Anchor-target mismatch.
- suggested_fix: RE-ANCHOR to "compare RRM and IVF" -> /courses/rrm-vs-ivf/.
- action_type: RE-ANCHOR
- tags: [INTERNAL-LINKING]
- conflict_check: see MW-1
- default_disposition: APPLY-suggested
```

### Orphan-opportunity adds

```
- id: W3-8
- waves: [W3]
- severity: MEDIUM
- location: src/pages/index.astro:299
- excerpt: '"unexplained" infertility — unlinked'
- issue: Top patient-search query left as orphan.
- suggested_fix: Link "unexplained" -> /faqs/?q=unexplained-infertility or /what-is-rrm/.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-9
- waves: [W3] -- see MW-7
- severity: MEDIUM
- location: src/pages/index.astro:282
- excerpt: '"Hormonal suppression does not stop disease advancement. It hides it."'
- issue: High-intent term used 3x, never linked.
- suggested_fix: ADD-LINK on line 282 to relevant FAQ or commentary slug; queue if no canonical destination.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-11
- waves: [W3]
- severity: HIGH
- location: src/pages/index.astro:402-417 / Research and Commentary
- excerpt: Section consolidates pillar destinations but contains zero anchors to /what-is-rrm/, /naprotechnology/, /femm/, /neofertility/, /common-questions-about-rrm.
- issue: Five named pillars unreachable from homepage via inline anchors.
- suggested_fix: Add third paragraph: "Pillar Guides. Plain-language explainers of NaProTechnology, FEMM, and NeoFertility, plus the most common questions..."
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING, PILLAR]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-12
- waves: [W3]
- severity: MEDIUM
- location: src/pages/index.astro:362-400 / Common Questions section
- excerpt: Section titled "Common Questions" with no link to /faqs/ or /common-questions-about-rrm
- issue: Reader who wants more questions has no destination.
- suggested_fix: Add closing line: "More questions? See the full list of common questions about RRM or browse all FAQs."
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING, PILLAR]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W3-13
- waves: [W3]
- severity: LOW
- location: src/pages/index.astro:298-302 / For-Patients ul
- excerpt: 5 list items; both linked items go to paid courses; zero links to free explainers
- issue: Sales-funnel rather than information ramp.
- suggested_fix: Add at least one informational link; on item 3 wrap "unexplained" -> /faqs/ or /what-is-rrm/. Cumulatively satisfies W3-8.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING]
- conflict_check: see MW-8
- default_disposition: DEFER (subsumed by W3-8)
```

```
- id: W3-14
- waves: [W3] -- see MW-7
- severity: LOW
- location: src/pages/index.astro:304-311 / For-Clinicians ul
- excerpt: Zero inline links in clinician block
- issue: NaProTechnology, restorative surgery, fertility awareness educator unlinked.
- suggested_fix: ADD-LINK NaProTechnology -> /naprotechnology/ (covers W3-4); fertility awareness educator -> /femm/.
- action_type: ADD-LINK
- tags: [INTERNAL-LINKING, PILLAR]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

### Over-link / cleanup

```
- id: W3-10
- waves: [W3]
- severity: LOW
- location: src/pages/index.astro:332, 357
- excerpt: Founder name as anchor twice on same page, both -> commentary spotlight, near-identical anchor text
- issue: Textbook over-link; two links to one URL with low anchor diversity.
- suggested_fix: Keep both is acceptable; if cleanup desired, drop bold-name link at 332 OR convert 357 to non-link CTA.
- action_type: DELETE-PROSE
- tags: [INTERNAL-LINKING]
- conflict_check: empty
- default_disposition: DEFER
```

---

## Wave 4: VOC (24 rows)

### Alignment / quick wins (APPLY-suggested)

```
- id: W4-2
- waves: [W4] -- see MW-2
- severity: MEDIUM
- location: src/pages/index.astro:147-149 / Hero subtitle
- excerpt: "{articleCount} scholarly works related to RRM cataloged..."
- issue: Late-funnel buyer wants corpus framed as a tool, not metadata.
- suggested_fix: "{articleCount} peer-reviewed studies on Restorative Reproductive Medicine, organized so you can read the evidence yourself before you trust anyone with what comes next."
- action_type: REWRITE-PROSE
- tags: [VOC]
- conflict_check: see MW-2
- default_disposition: APPLY-suggested
```

```
- id: W4-4
- waves: [W4]
- severity: MEDIUM
- location: src/pages/index.astro:296-302 / For-Patients list
- excerpt: List missing the largest Michelle-shaped pattern (post-IVF, donor-egg-only).
- issue: Most ready-to-convert visitor doesn't see herself in the list.
- suggested_fix: Insert bullet: "You have been through one or more IVF cycles, or been told donor eggs or a hysterectomy is your only option, and you are looking for a different question to be asked about your body."
- action_type: ADD-PROSE
- tags: [VOC]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W4-5
- waves: [W4]
- severity: MEDIUM
- location: src/pages/index.astro:391-397
- excerpt: "How do I find a surgeon... RRM Academy gives you the knowledge..."
- issue: Answer says "not just the ones on a list" but never tells her what list to start with.
- suggested_fix: Add: "If you want a starting list while you build that confidence, the curated 'how to find a provider' pathway is at /what-is-rrm/#get-started."
- action_type: ADD-PROSE
- tags: [VOC]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W4-7
- waves: [W4] -- see MW-5
- severity: MEDIUM
- location: src/pages/index.astro:262-265
- excerpt: "RRM does not declare that your body has failed and that technology must take over..."
- issue: For post-IVF reader, "technology must take over" reads as soft jab.
- suggested_fix: "RRM starts from a different question. Not 'how do we work around this?' but 'what is actually wrong, and can it be addressed?' Often, the answer is yes."
- action_type: REWRITE-PROSE
- tags: [VOC, RRM-EDITORIAL]
- conflict_check: see MW-5
- default_disposition: APPLY-suggested
```

```
- id: W4-8
- waves: [W4]
- severity: LOW
- location: src/pages/index.astro:282
- excerpt: "Symptoms are masked while disease progresses undetected..."
- issue: Reads slightly clinical-prosecutorial in already-labeled "Suppressive Medicine" section.
- suggested_fix: "The cost: symptoms are masked while disease keeps advancing underneath. Diagnoses are delayed by years on average. Hormonal suppression does not stop disease, it hides it."
- action_type: REWRITE-PROSE
- tags: [VOC]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

```
- id: W4-11
- waves: [W4]
- severity: LOW
- location: src/pages/index.astro:294
- excerpt: "For Patients" / "For Clinicians and Educators"
- issue: Clinician word "Patient" is taxonomic; buyer thinks "is this for me."
- suggested_fix: "If you are looking for answers about your own body" / "If you are a clinician or allied professional."
- action_type: REWRITE-PROSE
- tags: [VOC]
- conflict_check: empty
- default_disposition: APPLY-suggested
```

### MICHELLE-WARMTH (DEFER, row-level approval required)

```
- id: W4-1
- waves: [W4]
- severity: HIGH
- location: src/pages/index.astro:174-177
- excerpt: "Painful periods are not a personality trait. Irregular cycles are not 'just how you are.' Infertility is not unexplained. It is undiagnosed."
- issue: First body paragraph is three declarative manifesto sentences; for 1.1/5 OB-trust audience, recognition must precede declaration.
- suggested_fix: "If you have been told your pain is normal, your cycles are difficult, or your infertility is unexplained, and something inside you has been quietly insisting that cannot be the whole story, you are reading the right page. Painful periods are not a personality trait. Irregular cycles are not 'just how you are.' Infertility is not unexplained. It is undiagnosed."
- action_type: ADD-PROSE
- tags: [MICHELLE-WARMTH, VOC]
- conflict_check: empty
- default_disposition: DEFER (row-level APPLY required)
```

```
- id: W4-3
- waves: [W4] -- see MW-3
- severity: MEDIUM
- location: src/pages/index.astro:194-202
- excerpt: "When the warning light comes on in your car, you don't cover it with tape..."
- issue: Car analogy lands as cleverness before recognition.
- suggested_fix: Insert before line 196: "If you have spent years being told to live with what you know is not normal, this analogy will sound familiar..."
- action_type: ADD-PROSE
- tags: [MICHELLE-WARMTH, VOC]
- conflict_check: see MW-3
- default_disposition: DEFER (row-level APPLY required)
```

```
- id: W4-6
- waves: [W4]
- severity: LOW
- location: src/pages/index.astro:175
- excerpt: "Painful periods are not a personality trait."
- issue: Three manifesto sentences in a row too dense for first paragraph.
- suggested_fix: Route through W4-1 rewrite (preserves the three lines as second beat).
- action_type: REWRITE-PROSE
- tags: [MICHELLE-WARMTH, VOC]
- conflict_check: subsumed by W4-1
- default_disposition: DEFER (row-level APPLY required)
```

```
- id: W4-9
- waves: [W4]
- severity: LOW
- location: src/pages/index.astro:347-355
- excerpt: Mission paragraph ends on institutional mission ("RRM Academy exists to close both")
- issue: Doesn't give Michelle a sentence she can hold for herself.
- suggested_fix: Add final sentence: "If you have been carrying a question your doctor would not answer, you are exactly who Dr. Whittaker built this for."
- action_type: ADD-PROSE
- tags: [MICHELLE-WARMTH, VOC]
- conflict_check: empty
- default_disposition: DEFER (row-level APPLY required)
```

```
- id: W4-10
- waves: [W4] -- see MW-6
- severity: LOW
- location: src/pages/index.astro:424, 426-428
- excerpt: CTA tagline + pivot to third-person "patients"
- issue: CTA loses Michelle when it switches to third-person.
- suggested_fix: Replace "Most of the patients..." with "Most of the people who find RRM Academy have spent years being told the wrong things. That your pain is normal. That your cycles are just difficult. That your only option is to suppress or bypass. None of those were the whole story."
- action_type: REWRITE-PROSE
- tags: [MICHELLE-WARMTH, VOC]
- conflict_check: see MW-6
- default_disposition: DEFER (row-level APPLY required)
```

### VOC-gap (BACKLOG)

See "Backlog" section below for W4-gap-1 through W4-gap-8.

---

## Bulk groups

```
- id: BULK-our-voice
- description: "All institutional 'our' voice fixes (3 occurrences)"
- members: [W2-should-fix-4, W2-should-fix-5, W2-should-fix-6]
- default_disposition: APPLY-suggested
- note: All replace "our students/our founder" with subject-anchored alternatives. Commutative and safe to apply as a group.
```

```
- id: BULK-trust-bar-aria
- description: "All trust-bar a11y/semantics fixes (3 findings)"
- members: [W1-15, W1-16, W1-29]
- default_disposition: DEFER
- note: GATED on W1-15 verification (do citations actually exist for JAMA/Lancet/NBC News/Guardian/F&S?). Apply only after Brian confirms each outlet citation. Otherwise the trust bar may need removal, not enhancement.
```

---

## Backlog

VOC-gap rows that default to BACKLOG. Listed for Brian's awareness; not requesting APPLY without `APPLY-WITH-RELAXED-WAVE5-CONSTRAINTS` on a per-row basis.

```
- id: W4-gap-1
- severity: HIGH
- location: src/pages/index.astro (homepage as a whole)
- issue: No cost transparency anywhere on homepage.
- suggested_fix: Add to CTA: "The Research Library is free to read. Courses range from free introductions to deep clinical training."
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-2
- severity: HIGH
- location: between What RRM Looks Like and Two Approaches
- issue: No "what happens at a first appointment" beat.
- suggested_fix: Add "What a first step looks like" subsection with three bullets (charting, both-partner assessment, finding a provider).
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-3
- severity: MEDIUM
- location: src/pages/index.astro / What RRM Looks Like
- issue: No timeline expectation framing.
- suggested_fix: Add: "Most people working through an RRM workup see a clearer diagnostic picture within three to six cycles..."
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-4
- severity: MEDIUM
- location: src/pages/index.astro / You Are in the Right Place
- issue: No age-and-AMH framing — silent on the most loaded number Michelle is carrying.
- suggested_fix: Add bullet: "You have been told your age or AMH puts you out of options, and you want to know what a different workup might still find."
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-5
- severity: MEDIUM
- location: src/pages/index.astro:316-360 / Founder section
- issue: "Will I actually see Naomi or get handed off" question unaddressed.
- suggested_fix: Add: "RRM Academy is the educational platform Dr. Whittaker built... Her surgical practice is separate and is not booked through this site."
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-6
- severity: LOW
- location: src/pages/index.astro
- issue: No peer-mirror beat (Recognize -> Mirror -> Prove).
- suggested_fix: Add short pull-quote block from intake-survey free-response data between founder section and Common Questions.
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-7
- severity: LOW
- location: src/pages/index.astro:421-442 / CTA
- issue: No third path for not-yet-ready visitor.
- suggested_fix: Add secondary link: "Not ready for either? Start with the guides at /what-is-rrm/ or browse common questions."
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

```
- id: W4-gap-8
- severity: LOW
- location: src/pages/index.astro
- issue: No mention of community / "am I alone in this".
- suggested_fix: Add to CTA: "There is also a community of students and members on this site who are walking the same questions you are."
- tags: [VOC-GAP]
- default_disposition: BACKLOG
```

---

## Dropped from upstream audits

The 2 Wave 4 recommendations dropped by the legitimization regex:

### Drop 1
- intended_id: W4-michelle-warmth-drop-1
- intended_location: src/pages/index.astro:262-265 (Two Approaches)
- original_draft: "If you have already been through IVF, the clinicians who recommended it were not acting carelessly. They were working inside the paradigm they were trained in. RRM asks a different question."
- regex_pattern_fired: `not (irrational|...|acting carelessly|...)` and `within (that|their) paradigm`
- replacement: Routed via W4-7 instead.

### Drop 2
- intended_id: W4-michelle-warmth-drop-2
- intended_location: src/pages/index.astro:296-302 (You Are in the Right Place)
- original_draft: "You have been told donor eggs are your only real option, and you want to know whether that is genuinely the right option for you..."
- regex_pattern_fired: `real option` and `right option`
- replacement: Routed via W4-4 (names the diagnosis without legitimizing it).
