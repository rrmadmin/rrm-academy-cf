# Design: "What is RRM?" Pillar Article Expansion

**Date:** 2026-03-01
**URL:** `/what-is-rrm/` (expand in place, preserve existing URL equity)
**Author:** Dr. Naomi Whittaker, MD
**Target:** 8,000-10,000 words
**Audience:** Dual -- patients lead, providers explicitly addressed via inline callouts

---

## Design Principle

**Clinical authority, not persuasion.** Clean typography, minimal decoration. No hero images, no colored graphics, no aesthetic that signals "designed to convince." Let the content, citations, and structured data do the work. Think medical journal meets educational resource.

---

## Voice: Gianna (Dr. Naomi Whittaker)

Source: `vault/self/voice-gianna.md`

This is patient-facing RRM clinical content. Written in Gianna's voice throughout.

### Rules
- **Short sentences. Active voice. No em dashes.**
- **Couple-centered language** -- "couples" not just "patients" or "women"
- **No academic passive** -- "We treat the root cause" not "The root cause is treated"
- **Plain, precise language** -- no marketing jargon, no superlatives without evidence
- **Authoritative educational register, NOT conversational clinical.** No first-person anecdotes ("I see this in my practice"). Authority comes from citations and precise language, not personal testimony. This is a reference article, not a commentary or social post.

### RRM Framing (non-negotiable)
- **RRM is its own paradigm, NOT a step before IVF.** Do not position RRM as something couples try "before" IVF.
- **Don't give IVF/IUI/ART airtime.** The comparison section exists for SEO (people search "RRM vs IVF") but lead with what RRM does, not what it opposes.
- **No ablation promotion** -- excision only.
- **Include male factor** -- never female-only framing.

### Preferred Terms
| Use | Instead of |
|-----|-----------|
| Suppressive medications | Hormonal contraception / birth control |
| Excision | Ablation |
| Couples | Patients (when discussing fertility) |
| Cause-based / root cause | Holistic |
| Cycle-timed / protocol block | (standard terms) |
| Disease progression | Symptoms |
| Fertility restoration | Fertility treatment |
| In vivo conception | Natural conception |

### Terms to Avoid
- "Cure" or "guarantee" -- use evidence-based probabilities
- "Holistic" alone -- specify what you mean
- "Complementary to ART" -- RRM is its own paradigm
- Marketing jargon of any kind

### Example (from voice profile)
Bad: "This groundbreaking study demonstrates that surgical excision of endometriosis may potentially improve fertility outcomes compared to medical management approaches."

Good: "Excision works. This study followed 200 couples. After surgery with adhesion prevention, 62% conceived within 18 months. No IVF needed. The disease was treated. Not masked."

---

## Page Layout

```
┌─────────────────────────────────────────┐
│  Breadcrumb: Home > About > What is RRM │
├─────────────────────────────────────────┤
│  H1: What is Restorative Reproductive   │
│      Medicine (RRM)?                     │
│  Byline: By Naomi Whittaker, MD         │
│  Last updated: [date]                    │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │  TL;DR Box (key takeaways)      │    │
│  │  5-6 bullet points              │    │
│  └─────────────────────────────────┘    │
├──────────┬──────────────────────────────┤
│  Sticky  │  Article body               │
│  TOC     │  (15 sections)              │
│  (left)  │                             │
│          │  [Provider callout boxes]    │
│          │  [Comparison tables]         │
│          │  [Inline citations¹]         │
│          │                             │
│          │  FAQ Accordion (15-20 Qs)   │
│          │                             │
│          │  References (numbered)       │
│          │                             │
│          │  CTA Box                     │
├──────────┴──────────────────────────────┤
│  Page updated: [date]                    │
└─────────────────────────────────────────┘
```

- **Sticky TOC:** CSS `position: sticky` on desktop (>1024px), ~220px left sidebar. Mobile: "On this page" dropdown or horizontal scroll bar. Progressive enhancement -- works without JS, loses only scroll highlighting.
- **TL;DR Box:** Fills CORE-EEAT O02 gap. Minimal styling: `var(--bg-surface)` background, thin left border.
- **Provider Callouts:** `<aside>` elements within relevant sections. Subtle differentiation, not visually loud.

---

## Section Outline

### 1. TL;DR / Key Takeaways (~150 words)
6 bullets: what RRM is, who it's for, root-cause distinction, key conditions, evidence summary, how to start.

### 2. What is Restorative Reproductive Medicine? (~600 words)
Expand existing opening definition. Three principles (identify, treat, restore). Position within conventional medicine -- not alternative, not faith-based. Address misconceptions upfront.

**Provider callout:** How RRM fits existing OBGYN practice; CME pathways.

### 3. A Brief History of RRM (~800 words)
**New.** Saint Paul VI Institute origins. Dr. Thomas Hilgers and NaProTechnology (1980s-90s). Evolution to broader RRM umbrella. IIRRM formation. 2025 Arkansas insurance mandate. Growing mainstream recognition (NYT, STAT, The Cut 2025 coverage).

### 4. How RRM Diagnosis Works (~800 words)
**New.** Diagnostic workup walkthrough: cycle charting as foundation, timed bloodwork (peak +3/+5/+7/+9/+11), advanced imaging, diagnostic laparoscopy. How this differs from standard fertility workup that often skips to empiric treatment.

**Provider callout:** Specific hormonal panels, timing protocols, referral criteria.

### 5. Fertility Awareness-Based Methods (FABMs) Explained (~600 words)
**New.** Creighton Model, Marquette, FEMM, SymptoThermal -- what they are, how they differ, role in RRM diagnosis. FABMs as diagnostic tools, not just family planning.

### 6. Conditions Treated with RRM (~1,000 words)
**Expand existing table.** Each condition gets 2-3 paragraphs with inline citations:
- Endometriosis (excision surgery, long-term management)
- PCOS (phenotype-based, insulin resistance)
- Unexplained infertility ("unexplained" often means "underinvestigated")
- Recurrent miscarriage (progesterone, thyroid, immune)
- Irregular/painful periods
- Pelvic pain
- Ovulatory dysfunction
- Premenstrual syndrome

### 7. RRM vs. IVF: A Detailed Comparison (~800 words)
**Expand existing table. Reframe per Gianna voice rules:** RRM is its own paradigm, not a stepping stone to IVF. Lead with what RRM does. Section exists because people search "RRM vs IVF" -- meet the search intent, but don't give IVF the stage. Use HFEA data for IVF outcomes (not SART). Acknowledge when IVF may be appropriate (tubal blockage, severe male factor) without positioning it as the default. Cost analysis with citations. Outcomes by condition and age bracket.

### 8. The Evidence Behind RRM (~1,000 words)
**Expand existing.** By evidence type:
- RRM outcomes studies (JRRM, BMC Pregnancy and Childbirth)
- Surgical outcomes (endometriosis meta-analyses)
- Cost-effectiveness data
- Obstetric outcomes (preterm delivery, multiples risk)
- Honest assessment of evidence gaps and limitations

Citation-heavy backbone of the article.

### 9. What Does an RRM Patient Journey Look Like? (~600 words)
**New.** Timeline: first appointment through diagnosis, treatment, follow-up. What to expect at each stage. Typical duration (months, not a single cycle). Realistic expectations.

### 10. Cost and Insurance (~500 words)
**New.** Why RRM treatments are often covered (coded as treatment for diagnosed conditions). Cost comparison to IVF with citations. Arkansas insurance mandate precedent. What to ask your insurer.

### 11. NaProTechnology (~400 words)
**Existing, refined.** What it is, relationship to broader RRM, Creighton Model specifics, fellowship training.

### 12. Training and Credentials: For Healthcare Professionals (~500 words)
**New.** Provider-facing section. Fellowship programs, IIRRM credentialing, CME opportunities, integration into existing OBGYN practice.

### 13. Common Myths About RRM (~600 words)
**New.** Myth/fact pairs:
- "RRM is only for religious people"
- "RRM is alternative medicine"
- "RRM only works for infertility"
- "RRM has no evidence base"
- "RRM is anti-IVF"
- "You need to choose between RRM and conventional medicine"

### 14. How to Get Started (~400 words)
**Existing, expanded.** Three pathways: patients (courses, provider directory), providers (training), researchers (library).

### 15. Frequently Asked Questions (~800 words visible)
**Expand from 10 to 15-20 FAQs.** CSS-only `<details>/<summary>` accordion. All in FAQPage JSON-LD schema. New FAQs: cost, insurance, timeline, FABMs, provider training, adolescent applications.

### References
Numbered footnotes with full citations. Link to Research Library records when available.

**Estimated total: ~8,750 words**

---

## Source Authority Hierarchy

### Tier 1 -- Internal (highest trust)
1. **RRM Research Library** (library.rrmacademy.org) -- 3,164+ curated publications. Primary citation source.
2. **Dr. Naomi Whittaker's published work, course content, Instagram, and Twitter/X** -- her clinical voice and published takes.
3. **RRM Academy course content** -- treatment protocols, diagnostic workups, clinical pathways.

### Tier 2 -- Trusted External Organizations
4. **Peer-reviewed journals** -- JRRM, Fertility and Sterility, Human Reproduction, BMC Pregnancy and Childbirth, AJOG. Only papers in the Research Library or verifiable by Dr. Naomi.
5. **Natural Womanhood** (naturalwomanhood.org) -- RRM patient content, Dr. Naomi's published articles there.
6. **IIRRM** (iirrm.org) -- credentialing, provider directory, definitions.
7. **Saint Paul VI Institute** -- historical/NaProTechnology context.
8. **FertilityCare Centers of America** -- FABM/Creighton Model specifics.
9. **FACTS** (factsaboutfertility.org) -- FABM evidence summaries.

### Tier 3 -- Mainstream Medical (use for context only)
10. **ACOG, ASRM, WHO** -- baseline conventional medicine context only. Not RRM-friendly; cite for their own domain data, never for RRM claims.
11. **HFEA (UK)** -- IVF outcome statistics for comparison. Publishes comprehensive data including failure rates.

### IVF Data Policy
- **Use HFEA** for IVF comparison statistics (comprehensive, includes failures).
- **Do NOT cite SART/CORS** as a primary source. May mention editorially that US IVF reporting via SART is voluntary and selectively published.
- **Do NOT cite CDC NASS** for IVF outcomes (relies on SART data).

### Never Cite
- Wikipedia, WebMD, Healthline, or general health content sites
- Social media posts or anecdotal sources (except Dr. Naomi's own published social content)
- Unpublished data or personal communications (unless attributed to Dr. Naomi)
- Anti-RRM or hostile sources (not a debate piece)
- AI-generated claims passed off as sourced

### Library Gap Tracking
Any research article cited in the article that is NOT already in the RRM Research Library gets added to a separate "Articles to Ingest" list. These must be added to the library before or at publication time.

---

## Citation Format

### Inline
```html
...live birth rate of 41%<sup><a href="#ref-1" id="cite-1">1</a></sup> compared to...
```

### References Section
```
1. Stanford JB, et al. "Outcomes of treatment with NaProTechnology
   in subfertile couples." J Restorative Reprod Med. 2021.
   [Research Library →](https://library.rrmacademy.org/...)
   [↩](#cite-1)
```

Each reference links to the Research Library record (preferred, keeps traffic internal) or DOI when no library record exists.

---

## Component Design

All components follow the "clinical authority, not persuasion" principle. Minimal styling. No decorative elements.

### TL;DR Box
- `<aside class="tldr">`
- `var(--bg-surface)` background, thin `var(--border-color)` left border
- No icons, no colored accents

### Provider Callout
- `<aside class="callout-provider">`
- Heading: "For Healthcare Professionals"
- Subtle border differentiation from TL;DR, no bold colors
- Links to relevant CME/courses

### Myth/Fact Pairs
- Clean typographic treatment: myth in lighter weight, fact in standard
- No red/green coloring or check/X icons -- too "designed"
- Simple structural differentiation via indentation or blockquote

### FAQ Accordion
- CSS-only `<details>/<summary>`
- Native browser behavior, zero JS
- Schema markup in JSON-LD frontmatter

### Footnote System
- Superscript numbers linked to references
- Back-link arrows from reference to citation point
- Standard academic convention

### Sticky TOC
- CSS `position: sticky`, top offset for header clearance
- Plain text links, current section optionally bold (via minimal JS intersection observer, progressive enhancement)
- Mobile: "On this page" collapsible, or omit entirely if it clutters mobile experience

### Comparison Tables
- Existing `.table-wrap` + `<table>` pattern
- No colored cells or decorative headers
- Clean borders, readable on mobile via horizontal scroll

---

## Schema / Structured Data

Expand existing JSON-LD `@graph`:

1. **Article + MedicalWebPage** -- update `dateModified`, expand `description`
2. **FAQPage** -- expand from 10 to 15-20 questions
3. **BreadcrumbList** -- unchanged
4. **MedicalTherapy** `about` -- unchanged
5. **Add `hasPart`** -- for major sections, enabling potential featured snippets per section
6. **Add `citation`** -- array of `ScholarlyArticle` references for key studies

---

## SEO Actions (bundled with article)

1. Add `/what-is-rrm/` to header nav, footer nav, and mobile nav
2. Replace all `[CITE]` placeholders with real footnotes
3. Create page-specific OG image (simple: title text on brand background, not a graphic)
4. Internal links from: homepage, about, course pages, commentary posts
5. `<link rel="canonical">` stays at `https://rrmacademy.org/what-is-rrm/`

---

## Implementation Phases

### Phase 1: Research and Citation Gathering
- Query RRM Research Library for all studies referenced
- Review Dr. Naomi's Instagram/Twitter for published clinical takes
- Review Natural Womanhood articles
- Build the numbered reference list
- Flag articles not in the library (for ingestion)

### Phase 2: Content Writing
- Write each section per outline
- Insert inline citations as written
- Write provider callout boxes
- Write new FAQ entries
- Draft TL;DR box

### Phase 3: Technical Implementation
- Build new CSS components (TOC, TL;DR, callouts, footnotes)
- Expand the Astro page with new HTML
- Update JSON-LD schema (expanded FAQs, citations)
- Add nav links (header, footer, mobile)

### Phase 4: Review and Polish
- Dr. Naomi reviews all clinical claims
- Verify all citations resolve to real papers
- Cross-check library gap list
- Final SEO check (meta, OG, schema validation)
- Ingest missing articles to Research Library

---

## Success Criteria

- [ ] 8,000+ words of sourced, cited content
- [ ] Every statistic has a numbered footnote to a specific study
- [ ] Zero `[CITE]` or `[NEEDS CITATION]` placeholders at publish time
- [ ] All cited papers exist in the Research Library (or are ingested before publish)
- [ ] FAQPage schema with 15+ questions validated in Rich Results Test
- [ ] Page appears in header, footer, and mobile navigation
- [ ] Page-specific OG image
- [ ] Lighthouse SEO score > 95
- [ ] CORE-EEAT O02 gap closed (TL;DR box present)
- [ ] Provider callouts in at least 4 sections
- [ ] HFEA data used for IVF comparisons (not SART)
