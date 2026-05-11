# SEO + AEO Pre-Publish Audit -- `/art-registries-and-codes/`

**Auditor:** rrma-seo-operator
**Date:** 2026-05-11 (ET)
**Draft source:** `/Users/brian/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-art-registries-hub-draft.md`
**SSOT source:** `/Users/brian/iCode/projects/rrm-academy-cf/src/data/art-registries.json`
**Intent:** Capture and amplify 270+ Bing AI grounding citations across library records for HFEA / RTAC / national ART registries.

PG0: Target rrmacademy.org. PASS.

---

## 1. Title + H1 + Meta Description

### Recommended `<title>` tag

```
ART Registries and Codes of Practice: A Global Reference
```

**Length:** 56 chars. Within 60-char SERP cap (no truncation in either Google or Bing).

**Rationale:**
- "ART Registries and Codes of Practice" is the exact phrase being grounded against (matches the 5 high-volume Bing AI queries head-on).
- "Global Reference" signals scope and authority without overclaiming (no "Complete Guide" puff).
- `| RRM Academy` is auto-appended by `BaseLayout.astro` — total in SERP becomes `ART Registries and Codes of Practice: A Global Reference | RRM Academy` (≈74 chars; brand wraps cleanly).

**Do NOT use** the draft H1 verbatim as the `<title>` tag — at 81 chars it truncates around "Reference for…" and loses the keyword anchor.

### Recommended H1

KEEP the draft H1 — it functions correctly as on-page heading:

```
ART Registries and Codes of Practice: A Reference for Patients and Clinicians
```

H1 stays natural (per non-negotiable rule: never keyword-stuff H1s). The audience qualifier ("Patients and Clinicians") strengthens E-E-A-T and matches how PMC/ASRM pages frame themselves.

### Recommended meta description

```
Reference guide to national IVF registries and codes of practice -- HFEA, RTAC, ANZARD, Q-IVF, CDC, DIR, JSOG -- with what each measures and what they miss.
```

**Length:** 154 chars. Inside the 155-char Google cap.

**Why this version wins:**
- Front-loads the canonical phrase ("national IVF registries and codes of practice").
- Names 7 acronyms that match Bing AI grounding queries directly.
- "what each measures and what they miss" telegraphs the RRM frame without making the description editorial.
- Avoids "comprehensive," "definitive," "ultimate" — Bing's AI grounding ranker penalizes filler adjectives.

---

## 2. Target Query Coverage

| Query | Bing AI cites | Covered in draft? | Action |
|-------|---------------|-------------------|--------|
| `hfea code of practice` | 80 | YES (§1 UK + §5 FAQ) | Add explicit `<h3 id="hfea-code-of-practice">` anchor so AI grounding can deep-link |
| `rtac code of practice` | 64 | YES (§1 AU/NZ + §5 FAQ) | Add `<h3 id="rtac-code-of-practice">` anchor |
| `hfea code of practice 9th edition` | 24 | YES — already names "9th edition (2024)" in §1 | GOOD — H3 anchor should include "9th edition" in body, not URL |
| `figo aub classification` | 6 | **GAP** — not addressed | OPTIONAL: add a 1-paragraph H3 note ("Other professional classification systems" mentioning FIGO AUB as a non-ART example of how international bodies set diagnostic vocabularies). Or accept the gap and let the FIGO query continue grounding library records directly. RECOMMEND: accept the gap. Adding FIGO content here dilutes topical focus. |
| `national IVF registries` | (likely) | YES — §2 covers 9 registries | GOOD |
| `IVF success rates by country` | (likely) | PARTIAL — touches on this in §5 FAQ Q3 but not as an H2 | RECOMMEND: rename §5 FAQ Q3 anchor from generic to `#ivf-success-rates-by-country` |
| `ART surveillance` | (likely) | YES — covered in §2 CDC subsection | GOOD |
| `fertility clinic transparency` | (likely) | YES — covered in §3 ("Three Things Registries Get Right" — clinic-level transparency) | GOOD — make sure the H3 anchor is `#clinic-level-transparency` |

### Identified gaps + recommended micro-additions

**Gap 1: "what does HFEA stand for" / "what does RTAC stand for"**
These are zero-volume but high-intent navigation queries. The draft expands acronyms inline ONCE on first use. ADD a single-line "At a glance" expansion grid (definition list) at the top of §1 to make the acronyms self-contained quotables for AI.

```html
<dl class="acronym-glance">
  <dt>HFEA</dt><dd>Human Fertilisation and Embryology Authority (United Kingdom)</dd>
  <dt>RTAC</dt><dd>Reproductive Technology Accreditation Committee (Australia + New Zealand)</dd>
  <dt>ANZARD</dt><dd>Australia and New Zealand Assisted Reproduction Database</dd>
  <dt>Q-IVF</dt><dd>Swedish National Quality Registry for Assisted Reproduction</dd>
  <dt>CARTR Plus</dt><dd>Canadian Assisted Reproductive Technologies Register Plus</dd>
  <dt>DIR</dt><dd>Deutsches IVF-Register (Germany)</dd>
  <dt>JSOG</dt><dd>Japan Society of Obstetrics and Gynecology</dd>
  <dt>ESHRE EIM</dt><dd>European Society of Human Reproduction and Embryology, European IVF Monitoring Consortium</dd>
  <dt>ICMART</dt><dd>International Committee for Monitoring Assisted Reproductive Technologies</dd>
  <dt>REDLARA / RLA</dt><dd>Red Latinoamericana de Reproducción Asistida / Registro Latinoamericano</dd>
</dl>
```

This block is high-leverage for AEO: every line is a standalone definition AI engines will quote verbatim.

**Gap 2: "Does the US have national IVF regulation?"**
The draft answers this in §1 (US: No Single National Code) and again in §5 FAQ Q5. The §5 FAQ answer is the AEO surface. Make sure the schemaAnswer is 80-120 words self-contained.

**Gap 3: "What is FCSRCA?" / "Fertility Clinic Success Rate and Certification Act"**
Mentioned twice in body but never defined as its own term. RECOMMEND: add a sentence in §1 US subsection: "The Fertility Clinic Success Rate and Certification Act (FCSRCA) of 1992 is the only federal US statute on ART data collection." Acronym surfaces cleanly to AI.

---

## 3. Schema Strategy (JSON-LD)

### Confirmed payload structure

Use **4 separate JSON-LD blocks** in `<head>` (matching the pattern in `naprotechnology/index.astro` — separate blocks avoid Google validator conflicts on merged types):

#### Block 1 — `Article` + `MedicalWebPage`

```json
{
  "@context": "https://schema.org",
  "@type": ["Article", "MedicalWebPage"],
  "headline": "ART Registries and Codes of Practice: A Reference for Patients and Clinicians",
  "description": "Reference guide to national IVF registries and codes of practice — HFEA, RTAC, ANZARD, Q-IVF, CDC, DIR, JSOG — with what each measures and what they miss.",
  "image": "https://rrmacademy.org/og/art-registries-and-codes.png",
  "author": { "@id": "https://rrmacademy.org/#organization" },
  "reviewedBy": { "@id": "https://rrmacademy.org/#naomi-whittaker" },
  "publisher": { "@id": "https://rrmacademy.org/#organization" },
  "datePublished": "2026-05-11",
  "dateModified": "2026-05-11",
  "wordCount": 2900,
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "https://rrmacademy.org/art-registries-and-codes/"
  },
  "about": [
    { "@type": "Thing", "name": "Assisted Reproductive Technology" },
    { "@type": "Thing", "name": "Fertility regulation" },
    { "@type": "Thing", "name": "IVF success rates" }
  ],
  "articleSection": [
    "What Are ART Registries and Codes of Practice?",
    "National Codes of Practice",
    "National Registries",
    "What the Registries Measure Well, and What They Miss",
    "How RRM Academy Uses These Documents",
    "Frequently Asked Questions"
  ],
  "hasPart": [
    { "@type": "WebPageElement", "name": "HFEA Code of Practice", "url": "https://rrmacademy.org/art-registries-and-codes/#hfea-code-of-practice" },
    { "@type": "WebPageElement", "name": "RTAC Code of Practice", "url": "https://rrmacademy.org/art-registries-and-codes/#rtac-code-of-practice" },
    { "@type": "WebPageElement", "name": "HFEA Register", "url": "https://rrmacademy.org/art-registries-and-codes/#hfea-register" },
    { "@type": "WebPageElement", "name": "Q-IVF Sweden", "url": "https://rrmacademy.org/art-registries-and-codes/#q-ivf-sweden" },
    { "@type": "WebPageElement", "name": "ANZARD", "url": "https://rrmacademy.org/art-registries-and-codes/#anzard" },
    { "@type": "WebPageElement", "name": "CDC ART National Summary", "url": "https://rrmacademy.org/art-registries-and-codes/#cdc-art" },
    { "@type": "WebPageElement", "name": "DIR Jahrbuch (Germany)", "url": "https://rrmacademy.org/art-registries-and-codes/#dir" },
    { "@type": "WebPageElement", "name": "ESHRE EIM (Europe)", "url": "https://rrmacademy.org/art-registries-and-codes/#eshre-eim" }
  ]
}
```

Key decisions:
- `author = #organization` (RRM Academy), `reviewedBy = #naomi-whittaker`. Matches the glossary precedent: organization-authored reference pages keep RRM Academy as author and Naomi as reviewer.
- `@type` is the array form `["Article", "MedicalWebPage"]` (precedent: every existing pillar).
- `hasPart` deep-links AI grounding queries to specific subsections (this is what Bing AI rewards — granular anchor metadata).

#### Block 2 — `BreadcrumbList`

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://rrmacademy.org/" },
    { "@type": "ListItem", "position": 2, "name": "Guides", "item": "https://rrmacademy.org/guides/" },
    { "@type": "ListItem", "position": 3, "name": "ART Registries and Codes of Practice", "item": "https://rrmacademy.org/art-registries-and-codes/" }
  ]
}
```

#### Block 3 — `FAQPage`

Critical for AEO. Convert the 5 questions in §5 into a dedicated `FAQPage` block. **Do NOT use `QAPage`** (per editorial rule: FAQ content always uses `FAQPage`). schemaAnswer must be 80-120 words per answer (per RRM Academy three-tier system).

The 5 existing answers in the draft are 90-170 words each. Tighten the longer ones (esp. "Where can I find IVF success rates for my country?" at ~170 words) to the 80-120 window before emitting JSON-LD. Use the trimmed version for the JSON-LD `acceptedAnswer.text`; keep the longer prose on the visible HTML page (that's the `publishedAnswer` tier).

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is the HFEA Code of Practice?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The HFEA Code of Practice is the legally binding regulatory standard for fertility clinics in the United Kingdom, issued by the Human Fertilisation and Embryology Authority under the Human Fertilisation and Embryology Acts of 1990 and 2008. It governs staff qualifications, laboratory standards, consent procedures, welfare-of-the-child assessments, and embryo handling. Any UK clinic that creates, stores, or transfers embryos must hold an HFEA licence and comply with the code. The 9th edition has been in force since 2024."
      }
    },
    {
      "@type": "Question",
      "name": "What is RTAC?",
      "acceptedAnswer": { "@type": "Answer", "text": "..." }
    },
    {
      "@type": "Question",
      "name": "Why do ART success rates differ between countries?",
      "acceptedAnswer": { "@type": "Answer", "text": "..." }
    },
    {
      "@type": "Question",
      "name": "Where can I find IVF success rates for my country?",
      "acceptedAnswer": { "@type": "Answer", "text": "..." }
    },
    {
      "@type": "Question",
      "name": "Does the US have a national ART code of practice?",
      "acceptedAnswer": { "@type": "Answer", "text": "..." }
    }
  ]
}
```

#### Block 4 — `ItemList` (the 14 canonical SSOT entries)

This is the schema spec is missing in the proposed setup. The Bing AI grounding signal is that AI engines are citing INDIVIDUAL library records. An `ItemList` block formalizes the hub-spoke relationship — each spoke is a citable entity. This is what makes the page a true "hub" in schema terms.

```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "National ART Registries and Codes of Practice",
  "description": "Curated set of national ART registries, codes of practice, and statutory frameworks indexed in the RRM Academy Research Library.",
  "numberOfItems": 14,
  "itemListOrder": "https://schema.org/ItemListUnordered",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "CreativeWork",
        "name": "HFEA Code of Practice (9th Edition)",
        "datePublished": "2024",
        "publisher": "Human Fertilisation and Embryology Authority",
        "url": "https://rrmacademy.org/library/hfea-code-of-practice-9th-edition-version-94-0n2bg9oa/",
        "about": { "@type": "Place", "name": "United Kingdom" }
      }
    },
    { "@type": "ListItem", "position": 2, "item": { "@type": "CreativeWork", "name": "RTAC Code of Practice 2024", "publisher": "Fertility Society of Australia and New Zealand", "url": "https://rrmacademy.org/library/rtac-code-of-practice-for-reproductive-technology-units-australia-and-new-zealan/", "about": { "@type": "Place", "name": "Australia + New Zealand" } } }
    // ... 12 more list items, one per art-registries.json entry
  ]
}
```

**Build implementation note:** Drive this `ItemList` from `src/data/art-registries.json` at build time, not by hand. That way future additions to the SSOT auto-propagate.

### Schema additions Bing AI grounding rewards (added beyond the spec)

1. **`ItemList`** (above) — formalizes the hub-spoke pattern.
2. **`reviewedBy`** on the Article block — Bing AI's medical content scorer specifically rewards this attribute on health pages.
3. **`hasPart` with deep-anchor URLs** — turns each subsection into an addressable entity.

### Schema NOT to use

- `Dataset` — tempting because of the registries, but RRM Academy doesn't host the underlying data. Pointing schema at HFEA/CDC/etc. as `Dataset` would falsely imply distribution rights.
- `Course` — this is a reference page, not instructional content.
- `MedicalGuideline` — these registries are regulatory and statistical, not clinical practice guidelines.

---

## 4. AEO Retrieval Optimization

### Does the first 200 words pass the "answer the canonical query" test?

**PARTIAL PASS — needs a single revision.**

The current opening:

> "When a fertility clinic reports a 'success rate,' that number comes from somewhere. Most national governments and professional bodies now require fertility clinics to submit their treatment data to a central registry…"

This is good narrative writing, but it does NOT directly answer "What are ART registries and codes of practice?" until the second paragraph. AI grounding engines (esp. Bing AI and Perplexity) reward first-paragraph definitional openers.

**Recommended replacement — first paragraph only:**

> **ART registries and codes of practice are the two accountability instruments that govern assisted reproductive technology worldwide.** A **code of practice** is the rulebook a fertility clinic must follow to operate legally in a given jurisdiction. A **registry** is the dataset of cycle outcomes those clinics are required to submit. Together, they define what fertility clinics must do and what they must report. This guide covers the major national instruments — HFEA (UK), RTAC (Australia/New Zealand), CDC (US), ANZARD, Q-IVF (Sweden), DIR (Germany), CARTR Plus (Canada), JSOG (Japan), REDLARA (Latin America), ESHRE EIM (Europe), and ICMART (global) — what each measures, and what they miss.

This 100-word opener:
- Leads with a complete, citable definition (`X are the two…`)
- Bolds the two terms inline so AI grounding can extract them as defined terms
- Names every major acronym in the first paragraph (maximizes entity density)
- Closes with the "what they miss" hook that signals the RRM frame without polemicizing

The existing second/third paragraphs ("A code of practice is the rulebook…" and "A registry is the dataset…") can move down to §1 as the more detailed expansion, or be deleted as redundant.

### Are H2/H3 questions phrased the way patients ask?

| Current heading | Score | Recommended |
|-----------------|-------|-------------|
| "What Are ART Registries and Codes of Practice?" | GOOD | Keep |
| "Section 1: National Codes of Practice" | POOR — "Section 1" is an editorial artifact | "National Codes of Practice" (drop "Section N:" prefix from all 5 sections) |
| "United Kingdom: HFEA Code of Practice (9th Edition, 2024)" | GOOD — names jurisdiction + acronym + edition | Keep; add `id="hfea-code-of-practice"` anchor |
| "Australia and New Zealand: RTAC Code of Practice (2024)" | GOOD | Keep; add `id="rtac-code-of-practice"` |
| "United States: No Single National Code" | GOOD — query-shaped | Keep |
| "What the Registries Cover" | OK | Rename to "What National IVF Registries Cover" (denser query match) |
| "Three Things Registries Get Right" | GOOD | Keep |
| "Six Things Registries Consistently Miss or Under-Report" | GOOD | Keep |
| "What is the HFEA Code of Practice?" | GOOD — verbatim query | Keep |
| "What is RTAC?" | GOOD | Keep |
| "Why do ART success rates differ between countries?" | GOOD | Keep |
| "Where can I find IVF success rates for my country?" | GOOD | Keep |
| "Does the US have a national ART code of practice?" | GOOD | Keep |

**Add 2 additional FAQ questions** (gap-coverage):
- "What is the difference between a fertility registry and a code of practice?" — 60 words schemaAnswer
- "Why does the US not have a national IVF code?" — 80 words schemaAnswer

### Are statistics + definitions self-contained quotables?

**Most are. Two need tightening.**

**Buried stat #1 (§4):**
> "Boyle et al. (2025), in the first head-to-head retrospective comparison of RRM outcomes against a matched IVF cohort, reported a 41% crude live birth rate in the RRM cohort compared against one cycle of IVF from registry-comparable benchmarks."

The "41% crude live birth rate" is citable but the sentence is too long. AI engines pull at the sentence level. Split:

> "Boyle et al. (2025) published the first head-to-head retrospective comparison of RRM outcomes against a matched IVF cohort. The study reported a 41% crude live birth rate in the RRM cohort, compared against one cycle of IVF from registry-comparable benchmarks."

**Buried stat #2 (§3, point 1):**
> "Sharma et al. (2002) examined 2,056 patients across 2,708 IVF cycles in a UK university hospital and found an overall cumulative live birth rate of 66% after four attempts. But only 36% of patients who did not conceive after the first cycle continued to a second."

Both numbers are great quotables but the conjunction "But only 36%…" hides the second stat in a comma chain. Split:

> "Sharma et al. (2002) examined 2,056 patients across 2,708 IVF cycles at a UK university hospital. The study found an overall cumulative live birth rate of 66% after four attempts. Only 36% of patients who did not conceive after the first cycle continued to a second cycle."

Each sentence now stands as an independent factual quotable.

**Buried stat #3 (§3, point 5):**
> "13.1% of ART singletons were born preterm, well above background rates for spontaneously conceived singletons"

Add the specific source: "(De Geyter et al., 2025, drawing on ESHRE EIM data through 2020)" — already in the draft but the year should immediately follow the percentage.

### Pull-quote / "Here is what matters" block

The RRM Academy AEO summary label is `Here is what matters:` (per editorial standard). RECOMMEND: add this block immediately after the opener paragraph and before §1:

```html
<aside class="summary-callout">
  <h2 id="here-is-what-matters">Here is what matters:</h2>
  <ul>
    <li>The UK is the only country with a legally binding national fertility code (HFEA, 9th edition, in force from 2024).</li>
    <li>The US has a federal data-collection mandate (FCSRCA 1992) but no national clinical-practice code.</li>
    <li>Sweden's Q-IVF is the methodologically strongest registry for cumulative patient outcomes; most others report cycle-level data only.</li>
    <li>Registries measure cycles. They do not measure whether the underlying cause of infertility was ever diagnosed.</li>
  </ul>
</aside>
```

This block is highly quotable by AI engines and matches the existing pillar precedent.

---

## 5. Internal-Link Strategy

### Outbound links FROM the new hub (recommended anchor texts + insertion points)

| Anchor text | Target URL | Where in body |
|-------------|------------|---------------|
| `restorative reproductive medicine` | `/what-is-rrm/` | Opener paragraph 5, replacing the bare phrase |
| `NaProTechnology outcomes` | `/naprotechnology/#napro-vs-ivf` | §4, first paragraph, on "NaProTechnology or RRM outcomes data is published" |
| `IVF success rate calculator` | `/ivf-success-calculator/` | §5 FAQ Q4, after the registry list ("To compare expected outcomes for your age band, see our [IVF success rate calculator]") |
| `assisted reproductive technology (ART)` | `/glossary/#art` | §1 first mention of "(ART)" |
| `cumulative live birth rate` | `/glossary/#cumulative-live-birth-rate` | §3 point 1 first mention (NOTE: this term may not yet be in glossary — see Section 5b below) |
| `unexplained infertility` | `/glossary/#unexplained-infertility` | §3 point 6 ("a couple labeled with what registries call 'unexplained infertility'") |
| `not-yet-diagnosed` | `/glossary/#not-yet-diagnosed` | §3 point 6, on "RRM clinicians refer to this population as not-yet-diagnosed rather than unexplained" |
| `Read the FAQ: How do RRM success rates compare?` | `/faqs/what-are-the-success-rates-for-naprotechnology-and-rrm/` | §4 closing paragraph |
| `Read the FAQ: Is RRM evidence-based?` | `/faqs/is-rrm-evidence-based-key-trials-registries-and-guidelines/` | §3 closing / before §4 |
| `Boyle et al. (2025)` | `/library/restorative-reproductive-medicine-rrm-outcomes-compared-to-in-vitro-fertilization-rec4qqhafqb8stlnd/` | §4 (already linked in draft references section — also link inline) |
| `Sánchez-Méndez et al. (2025)` | `/library/natural-procreative-technology-naprotechnology-for-infertility-take-home-baby-ra-recv02qu0r8ycnzoa/` | §4 (also link inline) |

**Library record links for §2 (one inline link per registry/code subsection):**

Add inline links from each registry/code H3 heading to its canonical library record (from `art-registries.json` `library_slug`):

- §1 UK → `/library/hfea-code-of-practice-9th-edition-version-94-0n2bg9oa/`
- §1 RTAC → `/library/rtac-code-of-practice-for-reproductive-technology-units-australia-and-new-zealan/`
- §1 1993 MRC/RCOG → `/library/final-report-of-the-medical-research-councilroyal-college-of-obstetricians-and-g-recfymjps4idpfuga/`
- §2 HFEA Register → (link to HFEA gov UK + library record for ESHRE EIM)
- §2 Q-IVF → `/library/qivf-annual-report-2025-fertility-treatments-in-sweden-treatment-year-2023-fcd8af41/`
- §2 JSOG → `/library/assisted-reproductive-technology-in-japan-a-summary-report-for-2023-by-the-commi-pkxezwws/`
- §2 ANZARD → `/library/assisted-reproductive-technology-in-australia-and-new-zealand-2023-ymotfmjg/`
- §2 CARTR Plus → `/library/cartr-plus-2025-annual-report-2024-data-canadian-assisted-reproductive-technolog-e94qosl4/`
- §2 DIR → `/library/dir-jahrbuch-2024-deutsches-ivfregister-annual-report-2024-qasldzbe/`
- §2 REDLARA → `/library/rla-2021-registro-latinoamericano-de-reproduccion-asistida-latin-american-regist-6c2cj4qx/`
- §2 CDC → `/library/2019-assisted-reproductive-technology-fertility-clinic-and-national-summary-repo-yveyxcvj/`
- §2 ESHRE EIM → `/library/assisted-reproductive-technology-in-europe-2013-results-generated-from-european--zsha3zfp/`
- §2 ICMART → `/library/international-committee-for-monitoring-assisted-reproductive-technologies-icmart-92iwxlye/`

**WARNING:** The draft's "References" footer block has a broken link for ESHRE EIM:

```
[Library record: ESHRE EIM 2020](/library/)
```

Bare `/library/` link. Fix to the canonical SSOT slug `/library/assisted-reproductive-technology-in-europe-2013-results-generated-from-european--zsha3zfp/` (note: the De Geyter et al. 2025 article is 2020 data; verify slug matches — if not, query D1 for the correct slug or omit until verified).

### 5b. Glossary terms that need backlinks/cross-links to this hub

The glossary currently has `art` (slug `art`), `ivf`, `unexplained-infertility`, `not-yet-diagnosed` but does NOT have dedicated entries for HFEA, RTAC, ANZARD, Q-IVF, "ART registry", "code of practice", or "cumulative live birth rate."

**RECOMMEND (separate work item, route through `/glossary-update` skill):**

Add 6 new glossary terms (Part II — Regulation and Outcome Measurement, or wherever fits):
1. `hfea` — Human Fertilisation and Embryology Authority
2. `rtac` — Reproductive Technology Accreditation Committee
3. `art-registry` — generic class entry, pointing at the hub
4. `code-of-practice` — generic class entry, pointing at the hub
5. `cumulative-live-birth-rate` — distinguishing per-cycle vs per-patient measurement
6. `fcsrca` — Fertility Clinic Success Rate and Certification Act of 1992

Each new term body should pillar_link to `/art-registries-and-codes/`. Cross-link existing terms (`art`, `ivf`) to add a "See also: [ART Registries and Codes of Practice](/art-registries-and-codes/)" line at the foot of each body.

### 5c. FAQ slugs that should receive backlinks to this hub

These existing FAQs should have a sentence added linking to the new hub (route through admin FAQ endpoints or `/faqs` skill):

| FAQ slug | Where to add the link | Suggested anchor text |
|----------|----------------------|----------------------|
| `is-rrm-evidence-based-key-trials-registries-and-guidelines` | End of `publishedAnswer` | "For an overview of the national registries themselves, see [ART Registries and Codes of Practice](/art-registries-and-codes/)." |
| `what-are-the-success-rates-for-naprotechnology-and-rrm` | After registry citation | "See [how the major national registries report success rates](/art-registries-and-codes/#what-the-registries-measure)." |
| `how-much-does-rrm-or-naprotechnology-treatment-cost-compared-to-ivf` | Where IVF cost data is cited | "(Registry sources documented in [ART Registries and Codes of Practice](/art-registries-and-codes/#cdc-art).)" |
| `how-is-rrm-different-from-ivf-iui-centered-care` | First mention of IVF success rates | Link to `/art-registries-and-codes/#what-the-registries-measure-well-and-what-they-miss` |

### 5d. Existing pillar pages that should receive backlinks

| Page | Where | Anchor |
|------|-------|--------|
| `/what-is-rrm/` | §"NaPro vs IVF" or §"How RRM Compares" | "(How are IVF success rates measured? See [ART Registries and Codes of Practice](/art-registries-and-codes/).)" |
| `/naprotechnology/` | §"NaPro vs IVF" | Same anchor pattern |
| `/ivf-success-calculator/` | Below the calculator | "Calculations are based on the per-cycle methodology used by [national IVF registries](/art-registries-and-codes/#what-the-registries-cover)." |
| `/glossary/` | The "art" term body | "See also: [ART Registries and Codes of Practice](/art-registries-and-codes/) for how national bodies define and report ART outcomes." |

### 5e. Commentary cross-promotion

Per editorial policy (`feedback-rrma-link-direction-policy.md`): reference content NEVER inline-cites commentary, but commentary CAN link to the hub. Do NOT add commentary links to the hub body. The hub can appear in commentary posts' "Related" rails.

---

## 6. Sitemap + llms.txt + Agent Surfaces

### Sitemap

**Auto-included.** `astro.config.mjs` line 80-85 lists `chunkedPillars` as the only routes excluded from the main sitemap (because they get their own chunk). The new page at `/art-registries-and-codes/` will be:
- **PROBLEM:** It will NOT be excluded by the chunkedPillars list (which only contains the existing 6 pillars), so it will land in the main sitemap. GOOD.
- **DECISION POINT:** Do we add it to the `chunkedPillars` list to get its own chunk sitemap, or let it ride in main?

**RECOMMEND:** Add `'/art-registries-and-codes/'` to the `chunkedPillars` array in `astro.config.mjs` AND update `src/integrations/library-sitemaps.mjs` to emit a chunk entry for the new pillar.

**Build verification:** After first deploy, curl `https://rrmacademy.org/sitemap-index.xml` and confirm the new pillar URL appears (either in main sitemap or in a dedicated pillar chunk).

### llms.txt

**Manual addition required.** `public/llms.txt` is at v1.3 (last updated 2026-04-28). It is not auto-regenerated from page additions. ADD entry under the "Pillar Guides" section. Bump version to v1.4 with date `2026-05-11`.

Insert as a sibling of existing pillars:

```
### ART Registries and Codes of Practice
- URL: https://rrmacademy.org/art-registries-and-codes/
- Purpose: Reference guide to national IVF registries (HFEA, CDC, ANZARD, Q-IVF, CARTR Plus, DIR, JSOG, ESHRE EIM, ICMART, REDLARA) and codes of practice (HFEA Code of Practice 9th Edition, RTAC Code of Practice). Documents what each measures, what they miss, and how RRM Academy uses them in benchmarking.
- Key facts: HFEA Code of Practice 9th edition (2024) is legally binding under the HFE Acts 1990/2008. The US has no national fertility code; FCSRCA 1992 only mandates data collection to CDC. Sweden's Q-IVF is the strongest registry for cumulative patient outcomes.
- Reviewed by: Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI
```

### llms-full.txt

Also at v1.3. If `llms-full.txt` is auto-emitted from page content (verify via `scripts/` or `ssot-prebuild.mjs`), the page should auto-appear. If hand-curated, mirror the llms.txt entry.

### agent-surfaces.json

Check `ssot/agent-surfaces.json` (per CLAUDE.md, this is the SSOT for agents.md / agent-card.json / well-known endpoints). If the new pillar is "agent-discoverable" content, add it to the relevant array. Brian: confirm whether art-registries is to be MCP-tool-discoverable or just web-discoverable.

### robots.txt

No change needed. `/art-registries-and-codes/` is not in any disallow rule.

### IndexNow

See Section 7.

---

## 7. Post-Publish Hygiene — IndexNow URLs to Ping

After the deploy verifies (200 status at the new URL), POST IndexNow notifications for the following 10 URLs. Use the `/indexnow-integration` skill or the standard IndexNow worker:

```
https://rrmacademy.org/art-registries-and-codes/
https://rrmacademy.org/sitemap-index.xml
https://rrmacademy.org/llms.txt
https://rrmacademy.org/library/hfea-code-of-practice-9th-edition-version-94-0n2bg9oa/
https://rrmacademy.org/library/rtac-code-of-practice-for-reproductive-technology-units-australia-and-new-zealan/
https://rrmacademy.org/library/qivf-annual-report-2025-fertility-treatments-in-sweden-treatment-year-2023-fcd8af41/
https://rrmacademy.org/library/assisted-reproductive-technology-in-australia-and-new-zealand-2023-ymotfmjg/
https://rrmacademy.org/library/2019-assisted-reproductive-technology-fertility-clinic-and-national-summary-repo-yveyxcvj/
https://rrmacademy.org/faqs/is-rrm-evidence-based-key-trials-registries-and-guidelines/
https://rrmacademy.org/faqs/what-are-the-success-rates-for-naprotechnology-and-rrm/
```

If the existing pillar pages (`/what-is-rrm/`, `/naprotechnology/`) are updated with backlinks to the new hub as part of this work, include them in the IndexNow ping list as well (`+2 URLs = 12 total`).

### Post-publish verification checklist

Within 1 hour of deploy:

```bash
# 1. Verify the page is live and returns 200
curl -sI https://rrmacademy.org/art-registries-and-codes/ | head -5

# 2. Verify meta tags (WebFetch strips them — must use curl)
curl -s https://rrmacademy.org/art-registries-and-codes/ | grep -E '<title|<meta name="description|<meta property="og:|<link rel="canonical' | head -10

# 3. Verify JSON-LD payloads
curl -s https://rrmacademy.org/art-registries-and-codes/ | grep -A2 'application/ld+json' | head -40

# 4. Verify sitemap inclusion
curl -s https://rrmacademy.org/sitemap-index.xml | grep -i 'art-registries'

# 5. Verify llms.txt updated
curl -s https://rrmacademy.org/llms.txt | grep -i 'art-registries\|Version: 1.4'

# 6. Verify OG image renders
curl -sI 'https://rrmacademy.org/og/art-registries-and-codes.png' | head -5
```

Within 48 hours:

- Submit URL via Bing Webmaster Tools (Bing AI grounding latency: 24-72h)
- Submit URL via GSC URL Inspection API → Request indexing
- Run `cd ~/iCode/skills/aeo-checker && python3 retrieval.py --queries 5` against the target queries (hfea code of practice, rtac code of practice, national IVF registries) to establish baseline retrieval position
- Schedule re-run at 48h, 7d, 14d, 30d

### Rollback procedure

If the deploy creates a critical issue:

```bash
cd ~/iCode/projects/rrm-academy-cf
git revert <sha>
gh workflow run "Build & Deploy" -f skip_fetch=true
```

The new URL will 404. There is no legacy URL to redirect from (this is a net-new page), so no router patch is required.

---

## Summary — Critical Pre-Publish Actions

| # | Severity | Action | Owner |
|---|----------|--------|-------|
| 1 | CRITICAL | Rewrite opener paragraph to lead with the canonical definitional sentence (Section 4) | Apply via `/pillar-edit` |
| 2 | CRITICAL | Implement 4 JSON-LD blocks (Article+MedicalWebPage, BreadcrumbList, FAQPage, ItemList). ItemList must be data-driven from `art-registries.json` | Coder agent |
| 3 | CRITICAL | Add `id` anchors to every H2/H3 (esp. `hfea-code-of-practice`, `rtac-code-of-practice`, `q-ivf-sweden`, `anzard`, `cdc-art`) | Apply via `/pillar-edit` |
| 4 | CRITICAL | Fix broken `[Library record: ESHRE EIM 2020](/library/)` link in references | Apply via `/pillar-edit` |
| 5 | WARNING | Tighten the 5 FAQ schemaAnswers to 80-120 words each (some are 170+) | Apply via `/pillar-edit` |
| 6 | WARNING | Insert "Here is what matters:" summary block after opener | Apply via `/pillar-edit` |
| 7 | WARNING | Insert acronym definition list (`<dl class="acronym-glance">`) at top of §1 | Apply via `/pillar-edit` |
| 8 | WARNING | Drop "Section N:" prefix from H2 headings | Apply via `/pillar-edit` |
| 9 | WARNING | Add `/art-registries-and-codes/` to `chunkedPillars` array in `astro.config.mjs` and update `library-sitemaps.mjs` | Coder agent |
| 10 | WARNING | Bump `llms.txt` to v1.4 with date `2026-05-11` + add new section block | Manual edit |
| 11 | GOOD | Split 3 buried statistics into standalone sentences (Boyle 41%, Sharma 66%/36%, De Geyter 13.1%) | Apply via `/pillar-edit` |
| 12 | GOOD | Add 11 internal links per Section 5a anchor-text table | Apply via `/pillar-edit` |
| 13 | DEFERRED | Add 6 glossary terms (HFEA, RTAC, ART registry, code of practice, cumulative live birth rate, FCSRCA) | Separate work — route via `/glossary-update` |
| 14 | DEFERRED | Add 4 FAQ backlinks to existing FAQ records | Separate work — route via FAQ admin endpoints |
| 15 | DEFERRED | Update 2 pillar pages + `/ivf-success-calculator/` + `/glossary/` `art` term with hub backlinks | Separate work — route via `/pillar-edit` and `/glossary-update` |

### Files touched (if all CRITICAL+WARNING fixes applied)

```
src/pages/art-registries-and-codes/index.astro    NEW (~3,200 words after edits)
src/data/art-registries.json                       UNCHANGED
astro.config.mjs                                   MOD (add to chunkedPillars)
src/integrations/library-sitemaps.mjs              MOD (emit new pillar chunk)
public/llms.txt                                    MOD (version bump + new section)
```

5 files. Within the "5 file changes per commit" cap.

### Estimated GSC + retrieval impact

- **Bing AI grounding:** the existing 270+ citations should redirect-stick to the new hub within 7-14 days as Bing's index refreshes and discovers the canonical hub via internal links from library records (subject to library record cross-links being added — see Section 5b).
- **Perplexity retrieval (baseline 6/25):** likely +1 to +2 queries captured within 30 days, specifically for "hfea code of practice" and "rtac code of practice" which are not currently in the aeo-checker question set but which match the public-facing query intent. RECOMMEND adding these 5 queries to `~/iCode/skills/aeo-checker/retrieval.py` question set: `hfea code of practice`, `rtac code of practice 2024`, `national IVF registries by country`, `ART success rates by country`, `cumulative live birth rate IVF`.
- **GSC impressions:** target +500-1,000/month for ART-registry-related queries within 60 days, primarily long-tail acronym + jurisdiction queries.

---

End of audit.
