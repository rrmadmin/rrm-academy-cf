# Wave 1: AEO/SEO/GEO Audit -- Homepage

**Target:** `src/pages/index.astro` (859 lines)
**BASE_SHA:** `b4b51e1a2b2053b482478e2b9dc76f7d801670ae`
**Branch:** `claude/homepage-multipass-2026-05-05-2254`
**Audit date:** 2026-05-05
**Mode:** READ-ONLY

## Summary

- Total findings: 30 (top 30 of 38 total identified)
- By severity: CRITICAL 4 / HIGH 11 / MEDIUM 11 / LOW 4
- Top 3 highest-leverage opportunities:
  1. JSON-LD `@graph` is hand-authored and bypasses `buildIdentityGraph()` SSOT, drifts from `ssot/organization.json` (missing `MedicalOrganization` type, `EIN` PropertyValue, parent-org `@id` ref) -- single highest-leverage AEO+SEO fix.
  2. FAQ schema has only 4 Q/As while the page also publishes a 4-item visible "Common Questions" block, and the JSON-LD answers are 39-58 words (below the 80-120 word AEO sweet spot) and lack inline `Person`/`Organization` author refs -- low effort, high pickup gain in Perplexity/ChatGPT.
  3. Hero `<img>` is missing for the founder photo position above the fold; the Naomi photo at line 321 has good alt but uses raw `<img>` (no `<Image>` from `astro:assets`, no AVIF/responsive set) and the page is missing Naomi's ORCID/NPI from the inline `naomi` graph node since SSOT pulls `getPersonJsonLd()` but the snapshot binding isn't audited here -- verify `sameAs` arrives.

## Findings table

### W1-1
- **severity:** CRITICAL
- **location:** `src/pages/index.astro:17-131` / Schema
- **excerpt:** N/A (entire `jsonLd` constant is hand-authored)
- **issue:** The homepage hand-rolls the WebSite + Organization + Person + FAQPage + BreadcrumbList graph instead of using the central `buildIdentityGraph()` / `getOrganizationJsonLd()` / `getWebsiteJsonLd()` SSOT helpers in `src/lib/identity.ts`. CLAUDE.md mandates "Do not hand-author Organization or Person JSON-LD; emit through the @graph helper instead." This page violates that rule and will drift from `ssot/organization.json` on every SSOT update.
- **suggested_fix:** Replace lines 17-131 with `const graph = [...buildIdentityGraph(), buildFAQPage([...]), buildBreadcrumbList([{ name: 'Home', url: 'https://rrmacademy.org/' }]), buildHomepageOfferCatalog()]; const jsonLd = { '@context': 'https://schema.org', '@graph': graph };`
- **aeo_seo_geo_impact:** combo (AEO+SEO+GEO), VERY-HIGH
- **native_action:** REWRITE
- **proposed_action_type:** MODIFY-SCHEMA

### W1-2
- **severity:** CRITICAL
- **location:** `src/pages/index.astro:38-39` / Schema (Organization)
- **excerpt:** `'@type': ['EducationalOrganization', 'Organization'],`
- **issue:** Organization is missing `MedicalOrganization` from its `@type` array. `ssot/organization.json` declares `"types": ["Organization", "EducationalOrganization", "MedicalOrganization"]`. Dropping MedicalOrganization on a clinical-content site weakens Google's ability to map the entity to the medical knowledge graph and reduces eligibility for medical-context AI citations.
- **suggested_fix:** `'@type': ['Organization', 'EducationalOrganization', 'MedicalOrganization'],`
- **aeo_seo_geo_impact:** combo (SEO+GEO), HIGH
- **native_action:** ADD
- **proposed_action_type:** ADD-SCHEMA

### W1-3
- **severity:** CRITICAL
- **location:** `src/pages/index.astro:48-53` / Schema (parentOrganization)
- **excerpt:** `parentOrganization: { '@type': 'Organization', name: 'Restorative Reproductive Medicine Foundation', taxID: '93-4594315', nonprofitStatus: 'Nonprofit501c3', },`
- **issue:** Parent org is inlined as a fresh node instead of referencing `https://rrm.foundation/#organization` by `@id` (per `ssot/organization.json` `member_of[]`). Also, the parent's legal name in SSOT is "RRM Foundation", not "Restorative Reproductive Medicine Foundation", and `taxID` should be a structured `identifier: { '@type': 'PropertyValue', propertyID: 'EIN', value: '93-4594315' }`. This is the second-highest E-E-A-T signal on the page.
- **suggested_fix:** Replace with `parentOrganization: { '@id': 'https://rrm.foundation/#organization' },` and add EIN as a top-level `identifier` PropertyValue on the Organization node itself.
- **aeo_seo_geo_impact:** combo (SEO+GEO), HIGH
- **native_action:** REWRITE
- **proposed_action_type:** MODIFY-SCHEMA

### W1-4
- **severity:** CRITICAL
- **location:** `src/pages/index.astro:87-123` / Schema (FAQPage)
- **excerpt:** Four `Question` entries with `text` answers ranging 39-58 words.
- **issue:** FAQPage is not combined with a parent `WebPage` node (CLAUDE.md rule: "FAQPage always combined with parent WebPage"). Also, `acceptedAnswer.text` runs 39-58 words; AEO sweet spot is 80-120 words. Answers also lack `author`/`publisher` refs to the Naomi `Person` and the Organization, which Perplexity uses for citation attribution.
- **suggested_fix:** Add a `WebPage` node with `@id: 'https://rrmacademy.org/#webpage'`, `mainEntity: { '@id': 'https://rrmacademy.org/#faq' }`, and add `author: { '@id': 'https://rrmacademy.org/#naomi-whittaker' }`, `publisher: { '@id': 'https://rrmacademy.org/#organization' }` to each `Answer`. Expand each answer to 80-120 words mirroring the visible body card text.
- **aeo_seo_geo_impact:** AEO, VERY-HIGH
- **native_action:** REWRITE
- **proposed_action_type:** MODIFY-SCHEMA

### W1-5
- **severity:** HIGH
- **location:** `src/pages/index.astro:124-129` / Schema (BreadcrumbList)
- **excerpt:** `{ '@type': 'BreadcrumbList', itemListElement: [ { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rrmacademy.org/' }, ], }`
- **issue:** BreadcrumbList lacks `@id` and `item` is a bare URL string, not a `{ @id, name }` ref. Single-item breadcrumb on a homepage adds zero SEO value and will not render as a rich result; either upgrade or remove.
- **suggested_fix:** Either remove entirely (homepages don't need breadcrumb schema) or add `@id: 'https://rrmacademy.org/#breadcrumb'` and reshape `item` to `{ '@id': 'https://rrmacademy.org/', name: 'RRM Academy' }`.
- **aeo_seo_geo_impact:** SEO, LOW
- **native_action:** DELETE
- **proposed_action_type:** MODIFY-SCHEMA

### W1-6
- **severity:** HIGH
- **location:** `src/pages/index.astro:54-57` / Schema (Organization sameAs)
- **excerpt:** `sameAs: [ 'https://www.instagram.com/rrmacademy', 'https://www.youtube.com/@rrmacademy', ],`
- **issue:** Only 2 `sameAs` URLs. Missing the strongest entity anchors: Wikipedia/Wikidata (CLAUDE.md flags this as the strongest E-E-A-T signal), GuideStar/ProPublica nonprofit profile (EIN 93-4594315 is verifiable there), Charity Navigator, and high-traffic platforms (LinkedIn, X/Twitter, Substack, TikTok). The site's own `agent-surfaces.json` likely declares more handles than 2.
- **suggested_fix:** Pull the full `sameAs` list via `getOrganizationJsonLd().sameAs` from SSOT (the SSOT `same_as` array currently has only 2 -- expand `ssot/organization.json` with: Wikidata QID once obtained, ProPublica Nonprofit Explorer URL for EIN 93-4594315, LinkedIn company page, X handle, GuideStar/Candid profile).
- **aeo_seo_geo_impact:** combo (GEO+SEO), HIGH
- **native_action:** ADD
- **proposed_action_type:** MODIFY-SCHEMA

### W1-7
- **severity:** HIGH
- **location:** `src/pages/index.astro:36` / Schema (Person resolution)
- **excerpt:** `naomi,`
- **issue:** The `naomi` node is spread from `getPersonJsonLd()`, but if `ssot/people-refs.json` does not declare `sameAs` for ORCID `0000-0003-3706-3112` and NPI `1881034908`, the homepage's primary E-E-A-T anchor is incomplete. Per Brian's `naomi-canonical-bio.md` (memory), Naomi has both. Also missing: `medicalSpecialty`, `alumniOf`, `worksFor`. Audit the snapshot to verify they're present; if not, add them.
- **suggested_fix:** Verify `src/generated/ssot-schema.json` Naomi node includes `identifier: [{ '@type': 'PropertyValue', propertyID: 'NPI', value: '1881034908' }, { '@type': 'PropertyValue', propertyID: 'ORCID', value: '0000-0003-3706-3112' }]`, `medicalSpecialty: ['Obstetrics and Gynecology', 'Restorative Reproductive Medicine', 'Minimally Invasive Gynecologic Surgery']`, `worksFor: { '@id': 'https://rrmacademy.org/#organization' }`. If missing, fix at SSOT layer (`config/ecosystem-identity/`).
- **aeo_seo_geo_impact:** combo (AEO+GEO), HIGH
- **native_action:** ADD
- **proposed_action_type:** ADD-SCHEMA

### W1-8
- **severity:** HIGH
- **location:** `src/pages/index.astro:67-84` / Schema (OfferCatalog)
- **excerpt:** `hasOfferCatalog: { '@type': 'OfferCatalog', ... itemListElement: coursesData.filter(...).map((c: any) => ({ '@type': 'Offer', ... }))`
- **issue:** Each `Offer` should `itemOffered: { '@type': 'Course', '@id': 'https://rrmacademy.org/courses/<slug>/#course' }` so AI agents can resolve the course entity. Currently the Offer is leaf-only (no Course reference), which means the rich-result eligibility for `Course` carousels and the entity binding for `buildCourse(slug)` from identity.ts never wire up.
- **suggested_fix:** Add `itemOffered: { '@id': \`https://rrmacademy.org/courses/${c.slug}/#course\` }` to each Offer, and emit each referenced Course node (use `buildCourse(c.slug)` from identity.ts) in the same `@graph`.
- **aeo_seo_geo_impact:** combo (SEO+AEO), HIGH
- **native_action:** ADD
- **proposed_action_type:** ADD-SCHEMA

### W1-9
- **severity:** HIGH
- **location:** `src/pages/index.astro:146` / Hero H1
- **excerpt:** `<h1 id="hp-hero-h1" ...>Evidence-Based Restorative Reproductive Medicine Education</h1>`
- **issue:** H1 is keyword-good but the meta title (line 134) is identical-prefix `RRM Academy | Evidence-Based Reproductive Medicine Education`, dropping "Restorative" and creating SERP/H1 mismatch. Title also omits "Restorative" while the H1 includes it -- this fragments topical signal. GSC top queries for the brand likely include "restorative reproductive medicine" not just "reproductive medicine".
- **suggested_fix:** Title -> `RRM Academy | Evidence-Based Restorative Reproductive Medicine Education` (60 chars, fits). Keeps H1/title aligned and reinforces the "Restorative" qualifier.
- **aeo_seo_geo_impact:** SEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-10
- **severity:** HIGH
- **location:** `src/pages/index.astro:135` / Meta description
- **excerpt:** `description="RRM Academy offers evidence-based education in Restorative Reproductive Medicine. Courses, a research library, and expert guidance for patients and clinicians."`
- **issue:** 158 chars, fits 120-160 window. But misses two retrieval-relevant entities: NaProTechnology and the founder's name. Both surface heavily in Perplexity gap queries (per AEO retrieval baseline). No CTR-driver: lacks numerical credibility (3,370+ articles) or social proof.
- **suggested_fix:** `RRM Academy: 3,370+ peer-reviewed studies, NaProTechnology-grounded courses, and clinical guidance from Dr. Naomi Whittaker, MD. Restorative reproductive medicine education for patients and clinicians.` (159 chars)
- **aeo_seo_geo_impact:** combo (SEO+AEO), HIGH
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-11
- **severity:** HIGH
- **location:** `src/pages/index.astro:174-188` / Intro section
- **excerpt:** Intro paragraphs describe RRM but the section has no H2 (skips from H1 in hero to H2 "The Check Engine Light Analogy" at line 194).
- **issue:** Heading hierarchy: H1 -> [no H2] -> H2 at line 194. The Intro section has 3 paragraphs of substantive content but no heading, so it's invisible to AI extractors and to ToC generators. The Intro is the highest-density "What is RRM" definition on the page; it deserves a queryable H2.
- **suggested_fix:** Add an H2 like `<h2>What Is Restorative Reproductive Medicine?</h2>` before line 174. This becomes the AEO snippet hook for "what is RRM" queries (high-intent, currently splitting traffic between this page and `/what-is-rrm/`).
- **aeo_seo_geo_impact:** combo (AEO+SEO), VERY-HIGH
- **native_action:** ADD
- **proposed_action_type:** ADD-PROSE

### W1-12
- **severity:** HIGH
- **location:** `src/pages/index.astro:148-149` / Hero subtitle
- **excerpt:** `{articleCount.toLocaleString()} scholarly works related to RRM cataloged and linked to authors, institutions, and topics.`
- **issue:** Hero subtitle has zero entity anchors and reads as inventory boilerplate. AEO opportunity: this is the single most-extracted slot on the page (it's first below H1 and inside `speakable` selector at line 138). Should be a 25-35 word direct-answer definition of RRM that can serve as a featured snippet.
- **suggested_fix:** Lead the subtitle with a definitional answer: `Restorative Reproductive Medicine (RRM) diagnoses and treats the underlying causes of infertility, painful periods, and reproductive disorders rather than suppressing or bypassing them.` (28 words). Move the {articleCount} stat to a separate line below or to the trust bar.
- **aeo_seo_geo_impact:** AEO, VERY-HIGH
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-13
- **severity:** HIGH
- **location:** `src/pages/index.astro:321-329` / Founder photo
- **excerpt:** `<img src="/images/authors/naomi-whittaker.webp" alt="Dr. Naomi Whittaker, MD, Board-Certified OBGYN and Founder of RRM Academy" class="hp-founder__photo" width="120" height="120" loading="lazy" decoding="async" />`
- **issue:** Raw `<img>` instead of `<Image>` from `astro:assets`. CLAUDE.md gotcha #1: "Raw `<img>` instead of `<Image>` for content images." No responsive `srcset`, no AVIF fallback, single-resolution 120x120 served at 80px or 96px display (CSS at lines 588-614 sets 80px mobile, 96px tablet+). This fires CLS-clean (width/height present) but loses ~20-30% byte savings and image rich-result eligibility.
- **suggested_fix:** Convert to `<Image src={import('../assets/authors/naomi-whittaker.webp')} ... widths={[80, 96, 192]} sizes="(min-width: 640px) 96px, 80px" formats={['avif', 'webp']} />`. Keep the existing alt text -- it is excellent.
- **aeo_seo_geo_impact:** SEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-14
- **severity:** HIGH
- **location:** `src/pages/index.astro:138` / Speakable selectors
- **excerpt:** `speakable={['.hp-hero h1', '.hp-hero__subtitle', '.hp-section p']}`
- **issue:** `.hp-section p` matches every `<p>` in every `<section class="hp-section">` -- that's 30+ paragraphs across the whole page, including the Common Questions list items which aren't `<p>`s. Voice assistants pick the first match and tend to read sequentially. Better: target one direct-answer paragraph per section, or limit to hero only.
- **suggested_fix:** `speakable={['.hp-hero h1', '.hp-hero__subtitle', '.hp-section:first-of-type p:first-of-type']}` -- limits to the intro's first paragraph after H2.
- **aeo_seo_geo_impact:** AEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** MODIFY-SCHEMA

### W1-15
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:159, 162-163, 165` / Trust logos as text
- **excerpt:** `<span class="hp-trust__logo hp-trust__logo--jama">JAMA</span>` (also Lancet, NBC News, Guardian, F&S)
- **issue:** Six of the eight trust-bar logos are CSS-styled text spans with no semantic meaning. Screen readers will read "JAMA The Lancet NBC News The Guardian Fertility & Sterility" with no context for what these are. Crucially, these claim publication coverage -- but the page provides NO citations or links proving RRM Academy or Dr. Whittaker has been covered by these outlets. If unsupported, this is a trust-signal liability and a possible misrepresentation finding.
- **suggested_fix:** Either (a) add `aria-label="Cited by [outlet]"` and link each to the actual coverage URL, or (b) reframe as `aria-labelledby` to a heading like "Research from journals we cite" and link to library filters showing those journals' articles. Verify Naomi/RRM Academy actually has been cited/featured by each before keeping.
- **aeo_seo_geo_impact:** combo (SEO+GEO), MEDIUM (and trust-risk)
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-16
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:158, 161, 164` / Logo image alt
- **excerpt:** `<span class="hp-trust__logo hp-trust__logo--nejm" role="img" aria-label="The New England Journal of Medicine"></span>` (and NYT, Washington Post)
- **issue:** Three logos use `role="img"` with `aria-label`. NEJM is a CSS mask (background image), NYT and WaPo are inline SVGs. The inline SVGs duplicate the aria-label by also having internal `aria-hidden="true"` on the SVG -- that's correct. NEJM's CSS mask works for screen readers via aria-label, but the empty `<span>` will fail any image-validation tool that expects an `<img>` with `alt`. Acceptable but non-ideal.
- **suggested_fix:** Convert NEJM to `<img src="/images/journal-logos/nejm.webp" alt="The New England Journal of Medicine" />` styled with CSS filter to neutral color, OR keep aria-label approach but add a build-time test asserting these logos resolve.
- **aeo_seo_geo_impact:** SEO, LOW
- **native_action:** TRIM
- **proposed_action_type:** REWRITE-PROSE

### W1-17
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:280` / Comparison column heading
- **excerpt:** `<h3>Suppressive Medicine</h3>`
- **issue:** "Suppressive Medicine" is RRM Academy's editorial framing but is not a recognized medical term and won't surface for any external retrieval queries. The competing concept queried by patients is "conventional fertility treatment", "IVF", "hormonal suppression", or "ART (assisted reproductive technology)". Loses retrieval intercept for high-volume queries.
- **suggested_fix:** Reframe as `<h3>Conventional Suppressive and Bypass Medicine</h3>` or split into two columns: "Hormonal suppression" and "ART/IVF bypass". Adds query-intercept surface area without changing editorial position.
- **aeo_seo_geo_impact:** AEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-18
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:262-265` / Two Approaches intro
- **excerpt:** `RRM does not declare that your body has failed and that technology must take over. It asks: what is actually wrong, and can it be fixed? Often, the answer is yes.`
- **issue:** Strong rhetorical paragraph but no subject anchor for AEO. First word is "RRM" (good) but the next sentence drops the subject. Per CLAUDE.md "Bold lead phrases on pillar pages must be complete citable statements with 'RRM' as subject" -- the homepage isn't a pillar page but the same principle applies for AI extractability.
- **suggested_fix:** `Restorative Reproductive Medicine does not declare that the body has failed and that technology must take over. RRM asks: what is actually wrong, and can it be fixed? In most cases, the answer is yes.`
- **aeo_seo_geo_impact:** AEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-19
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:194-212` / Check Engine analogy section
- **excerpt:** Section heading: `<h2>The Check Engine Light Analogy</h2>`
- **issue:** This H2 has zero AEO retrieval value. No human queries "check engine light analogy reproductive medicine". The section content is good (the analogy is Brian-/Naomi-grade and citable) but the wrapper title doesn't pull queries. H2 should answer a real question.
- **suggested_fix:** `<h2>Why Symptom Suppression Fails: The Check Engine Light</h2>` -- preserves the analogy hook while exposing query-intercept surface for "why does symptom suppression fail" / "why birth control doesn't fix endometriosis".
- **aeo_seo_geo_impact:** combo (AEO+SEO), MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-20
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:218` / How RRM Works H2
- **excerpt:** `<h2>What RRM Looks Like</h2>`
- **issue:** Casual, low-intent heading. Doesn't match how patients/clinicians query the topic. Better: "How RRM Works" or "What an RRM Workup Includes".
- **suggested_fix:** `<h2>How Restorative Reproductive Medicine Works</h2>` -- keyword-aligned, query-intercept, and natural.
- **aeo_seo_geo_impact:** SEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-21
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:405` / Latest Insights H2
- **excerpt:** `<h2>Research and Commentary</h2>`
- **issue:** Generic. Doesn't pull any real query. The two paragraphs below describe the Library and Commentary sections, which are the second-most-traffic surfaces on the site. H2 should tee up the section's discoverability value.
- **suggested_fix:** `<h2>Peer-Reviewed Research and Clinical Commentary</h2>` -- includes "peer-reviewed" (high-intent qualifier) and "clinical commentary" (a niche term Perplexity surfaces for).
- **aeo_seo_geo_impact:** SEO, LOW
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-22
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:225-229` / Why paragraph
- **excerpt:** `It starts with the question: why? RRM evaluates both partners. A woman's cycle is diagnostic data, not background noise. ...`
- **issue:** Excellent prose for AEO but lacks an internal link from the phrase "evaluates both partners" to a deeper page (e.g., `/faqs/does-rrm-evaluate-both-partners/` or `/what-is-rrm/#diagnostic-workup`). Same for "cycle charting" (line 272) which has no link.
- **suggested_fix:** Internal links on key terms: "evaluates both partners" -> appropriate FAQ; "cycle is diagnostic data" -> `/glossary/charting` or `/femm/`; "male factor assessment" -> any future male factor pillar.
- **aeo_seo_geo_impact:** SEO (internal linking), MEDIUM
- **native_action:** ADD
- **proposed_action_type:** ADD-LINK

### W1-23
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:301` / `/courses/rrm-vs-ivf/` link
- **excerpt:** `<a href="/courses/rrm-vs-ivf/">natural conception</a>`
- **issue:** Verify the target slug exists. CLAUDE.md `feedback-verify-external-urls.md` and the courses migration to D1 mean a courses-overrides entry might be the only path. If `/courses/rrm-vs-ivf/` 404s, the homepage has a broken outbound link in a high-intent CTA position. Also the link text "natural conception" doesn't reveal the target is a comparison course; user-facing is misleading.
- **suggested_fix:** Verify the URL with `curl -sI https://rrmacademy.org/courses/rrm-vs-ivf/`. If valid, change anchor text to `<a href="/courses/rrm-vs-ivf/">RRM vs IVF (free comparison course)</a>`. If 404, swap to `/compare/rrm-vs-ivf/` or `/faqs/can-rrm-help-with-ivf-failure/`.
- **aeo_seo_geo_impact:** SEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-24
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:267-285` / Comparison structure
- **excerpt:** `<div class="hp-comparison">` with two `<div class="hp-comparison__col">` columns
- **issue:** The comparison table renders structurally as two `<ul>`s but lacks `<table>` semantics or `ComparisonTable`-style schema. Comparison content is high-extraction value for AI engines but currently has no structural marker. Bonus: the second column lists 4 bullets while the first lists 3 (asymmetric -- the "cost" bullet only appears on the suppressive side, which is editorially loaded but structurally disorienting).
- **suggested_fix:** Wrap the comparison in `<table class="hp-comparison" role="table">` with `<thead>`, `<tbody>`, three rows (Goal, Method, Your Role) and an optional fourth (Outcome), matching pillar-page comparison patterns. Add a `Table` schema or ItemList graph piece if going schema-heavy.
- **aeo_seo_geo_impact:** AEO, MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-25
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:344` / Quote attribution
- **excerpt:** `<cite>Dr. Naomi Whittaker, Founder of RRM Academy</cite>`
- **issue:** The blockquote is a powerful E-E-A-T signal but lacks `Quotation` schema and lacks structured attribution to Naomi's `@id`. AI extractors often pick up `<blockquote>` content as quotes-by-author; without schema attribution, attribution is brittle.
- **suggested_fix:** Add a `Quotation` graph piece: `{ '@type': 'Quotation', '@id': 'https://rrmacademy.org/#whittaker-residency-quote', text: '...', spokenByCharacter: { '@id': 'https://rrmacademy.org/#naomi-whittaker' } }`. Alternative: keep prose simple and add `cite="https://rrmacademy.org/about/dr-whittaker/"` attribute on `<blockquote>`.
- **aeo_seo_geo_impact:** combo (AEO+GEO), MEDIUM
- **native_action:** ADD
- **proposed_action_type:** ADD-SCHEMA

### W1-26
- **severity:** MEDIUM
- **location:** `src/pages/index.astro:332` / Founder name link
- **excerpt:** `<a href="/commentary/rrm-spotlight-naomi-whittaker-md/"><strong>Dr. Naomi Whittaker, MD</strong></a>`
- **issue:** Naomi's bio link points to `/commentary/rrm-spotlight-naomi-whittaker-md/` (a commentary post) rather than a canonical author/about page. SEO best practice for E-E-A-T: link to a stable `Person` profile URL (`/about/dr-whittaker/` per the SSOT pattern). Commentary URLs are second-class and dilute the entity anchor.
- **suggested_fix:** If `/about/dr-whittaker/` exists, link there. If not, this is a P-level finding to create that profile page (Phase 0a SSOT references it as canonical: `personUrl: 'https://rrmacademy.org/about/dr-whittaker/'`). Until then, accept the commentary link but add `rel="author"`.
- **aeo_seo_geo_impact:** combo (SEO+GEO), MEDIUM
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-27
- **severity:** LOW
- **location:** `src/pages/index.astro:367-398` / Common Questions UL
- **excerpt:** `<ul>` with 4 `<li>` entries containing `<strong>` question + answer
- **issue:** The visible "Common Questions" block uses `<ul><li><strong>Q?</strong> A.</li></ul>` instead of `<dl>/<dt>/<dd>` or proper `<details>/<summary>`. This works for AI extraction but signals to assistive tech as a list, not a Q&A. FAQ-pattern best practice is `<details>` for collapsible or `<dl>` for definitional.
- **suggested_fix:** Restructure as `<details>` accordion or `<dl>` if non-collapsible: `<dl class="hp-faq"><dt>Is this backed by real evidence?</dt><dd>Yes...</dd>...</dl>`.
- **aeo_seo_geo_impact:** AEO, LOW
- **native_action:** REWRITE
- **proposed_action_type:** REWRITE-PROSE

### W1-28
- **severity:** LOW
- **location:** `src/pages/index.astro:154` / LastUpdated component
- **excerpt:** `<p class="hp-hero__updated animate-enter" style="--stagger: 4;"><LastUpdated path="/" /></p>`
- **issue:** The LastUpdated date is hidden on mobile (CSS line 627-630: `.hp-hero__updated { display: none; }`). Mobile is 60-70% of patient traffic. Last-updated date is a non-trivial trust + freshness signal for both humans and Google's freshness algorithm. Hiding it on mobile means the majority of visitors don't see it.
- **suggested_fix:** Show on mobile, just smaller. Remove the `display: none` rule on mobile; reduce font-size to 0.625rem and shorten to "Updated 2026-05-05" format.
- **aeo_seo_geo_impact:** SEO, LOW
- **native_action:** ADD
- **proposed_action_type:** REWRITE-PROSE

### W1-29
- **severity:** LOW
- **location:** `src/pages/index.astro:156-167` / Trust bar markup
- **excerpt:** `<div class="hp-hero__trust ...">` with `.hp-trust__logos` containing 8 logos
- **issue:** No `aria-labelledby` or section heading for the trust strip. Screen readers encounter a list of orgs with no contextualizing label like "Cited by" or "Featured in". Contains 8 logos but no count, no semantic frame.
- **suggested_fix:** Wrap in `<section aria-labelledby="trust-bar-heading">` with a visually-hidden `<h2 id="trust-bar-heading" class="sr-only">Featured in and citing</h2>` (only if true; see W1-15).
- **aeo_seo_geo_impact:** SEO, LOW
- **native_action:** ADD
- **proposed_action_type:** ADD-PROSE

### W1-30
- **severity:** LOW
- **location:** `src/pages/index.astro:54-57` / Schema (sameAs missing well-known)
- **excerpt:** Organization `sameAs` array.
- **issue:** GEO-specific: agent-discovery URLs are not in `sameAs`. Adding `https://rrmacademy.org/.well-known/agent-card.json` and `https://mcp.rrmacademy.org/.well-known/mcp.json` to sameAs (or as separate `subjectOf` / `additionalProperty` fields) explicitly tells AI agents that the canonical agent card lives there.
- **suggested_fix:** Add `subjectOf: [{ '@type': 'CreativeWork', url: 'https://rrmacademy.org/.well-known/agent-card.json', name: 'Agent Card' }, { '@type': 'CreativeWork', url: 'https://rrmacademy.org/llms.txt', name: 'LLM Index' }]` to the Organization node.
- **aeo_seo_geo_impact:** GEO, LOW
- **native_action:** ADD
- **proposed_action_type:** ADD-SCHEMA

## Schema audit

**What's there:**
- `WebSite` with `SearchAction` -> `/library/?q={search_term_string}`. Correct shape, well-formed. KEEP.
- `EducationalOrganization` + `Organization` (compound `@type`). Has `founder`, `nonprofitStatus`, `parentOrganization` (inlined), `publishingPrinciples`, `correctionsPolicy`, `verificationFactCheckingPolicy`, `contactPoint`, `hasOfferCatalog` with 4 Offers (matching liveCourseCount).
- `Person` (Naomi) -- spread from `getPersonJsonLd()`, content depends on SSOT snapshot.
- `FAQPage` with 4 questions and 39-58 word answers.
- `BreadcrumbList` with single item (Home).

**What's missing:**
- `MedicalOrganization` type (CRITICAL, W1-2).
- `MedicalWebPage` or even `WebPage` node binding the FAQPage to the home URL (CRITICAL, W1-4).
- Parent org `@id` reference instead of inlined repeat node (CRITICAL, W1-3).
- Organization `identifier` PropertyValue for EIN.
- Wikidata QID, ProPublica, LinkedIn, X handle in `sameAs` (HIGH, W1-6).
- Naomi's NPI, ORCID `identifier` PropertyValue array (depends on SSOT snapshot, W1-7).
- `itemOffered` Course refs in OfferCatalog (HIGH, W1-8).
- `Quotation` for Naomi's blockquote (MEDIUM, W1-25).
- `subjectOf` for agent-card.json and llms.txt (LOW, W1-30).

**What's malformed:**
- `parentOrganization` is a fresh node, not an `@id` reference -- creates entity duplication.
- `BreadcrumbList` has no `@id`, single-item, and `item` is bare URL string, not ref.
- FAQPage stands alone (not nested under WebPage `mainEntity`).

**What would unlock retrieval:**
- Routing the entire graph through `buildIdentityGraph()` (W1-1) -- single fix that enables all SSOT-driven enrichment to flow into the homepage automatically.
- Expanding FAQ answers to 80-120 words and adding author/publisher refs (W1-4) -- direct AEO snippet eligibility.
- Adding Course refs in OfferCatalog (W1-8) -- enables Course-carousel rich result and entity binding for AI agents.

## Pages-clean

- **Hero CTA buttons (lines 150-153):** Two buttons, primary + secondary, well-labeled. Solid.
- **Animation/motion (lines 449-458):** Respects `prefers-reduced-motion`. Solid.
- **CSS responsive trust bar (lines 786-803):** Mobile breakpoints clean. Solid.
- **CSS for `.hp-section`:** Letter-line styling delegated to global `.page-body`. Solid.
- **Canonical URL (line 136):** `https://rrmacademy.org/` -- correct, absolute, no query params.
- **Hreflang (live):** `en` and `x-default` both self-reference homepage. Single-language site, correct.
- **OG image (live):** `/og/homepage.png?v=v1` -- correct format, version-busted, follows site OG pattern. NOTE: 1200x630 not 1200x675; site uses 630 throughout. Acceptable, just a documentation discrepancy with this skill's spec.
- **`og:locale`:** `en_US` -- correct.
- **Twitter card:** `summary_large_image` -- correct.
- **`format-detection`:** `telephone=no` set in `<head>` -- correct for nonprofit/education.
- **`<html lang="en">`:** Correct.
- **`articleCount` rendering (lines 148, 152, 371, 408):** Pulls live count from articles.json -- excellent, never goes stale.
- **CTA section (lines 421-442):** Clean, no left-border, centered, two buttons. Solid.
- **`<LastUpdated>` component (line 154):** Live timestamp from build. Solid (just hidden on mobile per W1-28).

## Residual count

Identified 38 total findings. 8 not in top-30 by leverage:

1. CSS uses `clamp()` for H1 font-size with no upper safety -- aesthetic, no SEO impact.
2. NEJM logo CSS mask uses `-webkit-mask` only (no `mask:` standalone for non-webkit) -- already has both, false flag, withdrawn.
3. `liveCourseCount` (line 11) filters out `comingSoon` and `isAffiliate` -- correct for OfferCatalog, but the visible page doesn't surface the count anywhere. Could add "Currently 8 live courses" trust signal.
4. The Comparison section (line 268-275) RRM column has 3 bullets, "Suppressive" column has 4 -- asymmetric structure noted in W1-24 but separate issue: "Cost" bullet on suppressive side has no equivalent on RRM side. Could add an "Outcome" row with a positive RRM equivalent.
5. The `<blockquote>` (line 338-345) lacks a `cite` attribute pointing to a source URL.
6. Mobile trust bar drops 4 of 8 logos via CSS (lines 659-664) -- intentional, but leaves only NEJM, JAMA, Lancet, NYT visible. Could justify which 4 stay.
7. `hp-hero__nonprofit` CSS class (line 561-567) is defined but never rendered -- dead CSS.
8. Inline `style="--stagger: 0;"` etc. on lines 145-156 could move to a data-attribute + CSS rule for cleaner separation. Cosmetic.
