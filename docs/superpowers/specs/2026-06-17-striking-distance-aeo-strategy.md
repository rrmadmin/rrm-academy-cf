# Striking-Distance AEO Strategy — rrmacademy.org

**2026-06-17** · source: Ahrefs organic export (crawl 06-12) · lens: **AEO / citation capture first** · output: strategy + prioritized plan, **execution gated**.

## Frame
239 keywords at SERP 4-10 across 69 pages (19 owned, 50 library). Low difficulty (median KD 2), low volume, high intent — winnable on-page, not link-gated. **56 carry an AI Overview, 115 carry People-Also-Ask.** The prize is being the *extracted/cited answer*, not the blue link.

**Root cause (recurs on nearly every owned page):** our pages are editorially strong but **not answer-shaped or schema-marked for extraction**, so AI Overviews/snippets get pulled from competitors that lead with a one-sentence definition + structured data (Cleveland Clinic, ACOG, clinic blogs).

**The repeatable winning pattern (the 5 moves):**
1. **Definition-first lede** — open the section with a one-sentence, extractable answer containing the term + synonyms + mechanism.
2. **FAQPage JSON-LD** — answer the live PAA questions in 40-60-word direct-answer voice (wire existing copy into schema; don't rewrite visible content).
3. **Entity schema** — MedicalCondition / Person / Course as fits, + Speakable block on the definition.
4. **Internal links** into the topic cluster (and `/providers/` for patient intent, never to Dr. Whittaker).
5. **Title/meta** tuned to the query + synonyms.

> **Adversarial-verify caveat:** live AI-Overview presence was independently re-confirmable on only **1/19** owned pages — WebSearch/APIs don't expose AI Overviews, so AIO/PAA presence is taken from the Ahrefs crawl, not re-observed. The schema + answer-shaping moves pay off regardless (featured snippets, PAA, classic position). Treat AIO capture as the upside, snippet/PAA/position lift as the floor. 0 cards dropped, 0 constraint violations.

## Two playbooks
**A. Owned editorial (19 pages):** the 5-move pattern, tuned per page — full content control, win outright.

**B. Library research pages (50 pages):** abstract is verbatim; levers = title/meta, author Insights commentary, schema, internal links, Highwire tags.

**Library playbook levers:**
- **Meta description (currently missing on all inspected pages)** — Google's AI Overview extractor and PAA card generator pull answer-shaped sentences directly from on-page text. When meta description is absent the system falls…
- **Title tag — query-shaped rewrite** — Current title tags are verbatim paper titles (often 15+ words, passive, journal-formatted). AI Overviews preferentially cite pages whose title closely matches…
- **Insights commentary block (currently absent on all inspected pages)** — This is the single highest-leverage AEO lever unique to RRMA's library pages. The abstract is verbatim publisher text and cannot be changed. But the Insights…
- **JSON-LD schema — MedicalScholarlyArticle + supporting types (currently absent on all inspected pages)** — No JSON-LD schema was found on any inspected page. The Highwire citation tags are present (a good base) but schema.org structured data provides the entity…
- **Highwire citation tags — completeness audit** — Highwire meta tags (citation_title, citation_author, citation_doi, citation_journal_title, citation_publication_date, citation_abstract) are the primary signal…
- **Internal links — inbound from owned pillar, FAQ, and commentary pages** — AI Overview citation weight is partly a PageRank proxy — pages with strong topical inbound links from authoritative same-site pages are more likely to be…

_Prioritize:_ Prioritize by: (1) AI Overview already present (9 pages) over non-AIO pages — Google has confirmed query-page topical alignment; the gap is extractable answer content, not relevance; (2) within AI Overview pages, prioritize by lever gap…

---
## Owned action cards (prioritized)

### Tier 1 — highest-impact, do first  (9)

**/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/**  
`c section scar on uterus` · pos 6 · effort M · conf high · verify revise
  
*Why stuck:* Three concrete blockers: (1) Schema gap -- the page emits bare Article schema with no MedicalCondition, FAQPage, or speakable block; the FAQ answers exist in HTML but are invisible to AI extraction…
  
*Moves:* Add FAQPage JSON-LD block covering the 5 observed PAA questions with answer text of 40-60… · Rewrite the article lede (first 2 sentences under H1) to be extractable · Upgrade JSON-LD from bare Article to MedicalCondition (or add a second block). Required fields · Add a Speakable schema block (cssSelector pointing to the opening definition paragraph and the…

**/femm/**  
`what is femm` · pos 6 · effort M · conf medium · verify revise
  
*Why stuck:* Three compounding problems: (1) Entity authority deficit -- femmhealth.org IS FEMM; we are a third-party explainer. Google's entity graph associates FEMM the brand with femmhealth.org, not us. Our…
  
*Moves:* Rewrite the page opening · Retitle the page to · Add meta description (currently missing) · Upgrade schema

**/commentary/rrm-spotlight-naomi-whittaker-md/**  
`dr whittaker obgyn` · pos 5 · effort M · conf medium · verify revise
  
*Why stuck:* Three compounding problems. (1) Schema gap: the page has zero JSON-LD -- no Person, MedicalBusiness, or ProfilePage schema. Doximity wins the entity-answer slot because it is a structured physician…
  
*Moves:* SCHEMA -- Add Person + ProfilePage JSON-LD · LEDE REWRITE -- Replace the series-framing first sentence with a direct-answer paragraph · GEOGRAPHIC DISAMBIGUATION PASSAGE -- Insert a short passage (or sidebar callout) that… · H1 + TITLE TAG -- Change H1 from 'RRM Physician Spotlight

**/commentary/naprotechnology-surgery-a-restorative-approach-to-fertility-and-gynecologic-health/**  
`naprotechnology criticism` · pos 10 · effort M · conf medium · verify solid
  
*Why stuck:* Three compounding deficits: (A) Answer shape -- the page leads with a narrative explainer, not extractable direct-answer sentences. AI Overviews pull from pages whose first 1-2 sentences directly…
  
*Moves:* REWRITE THE LEAD as a two-sentence direct answer · ADD A CRITICISM-REBUTTAL SECTION (H2 · ADD FAQPage JSON-LD schema with 4-5 Q&A pairs mapped to observed PAA questions · ADD Article + MedicalWebPage JSON-LD

**/faqs/what-is-the-difference-between-creighton-model-marquette-method-femm-and-symptot/**  
`creighton vs marquette nfp` · pos 7 · effort M · conf high · verify solid
  
*Why stuck:* Three structural deficits explain the gap: (1) CONTENT THINNESS -- ~450-500 words vs. 1,900-3,200 words for every outranking page. The AI Overview needs extractable, granular comparison points (cost,…
  
*Moves:* REWRITE THE LEAD as a 2-sentence direct answer · ADD A COMPARISON TABLE with at minimum 6 rows · EXPAND TO 1,500-2,000 WORDS by adding discrete H2 sections for the exact PAA questions observed · ADD FAQPage JSON-LD SCHEMA covering at minimum 5 Q/A pairs drawn from the new H2 sections

**/faqs/is-letrozole-first-line-for-anovulatory-pcos-in-rrm/**  
`2023 pcos guideline letrozole first line…` · pos 7 · effort M · conf high · verify solid
  
*Why stuck:* Three compounding deficits keep us out of the AI Overview citation set. (1) NO JSON-LD schema: the page has zero structured data -- no FAQPage, no MedicalWebPage, no speakable -- so Google cannot…
  
*Moves:* Add FAQPage JSON-LD schema with the exact Q · Rewrite the lead answer sentence to drop the hedge 'In many cases' and open with · Add a dedicated H2 block · Add a second PAA-targeted H2

**/faqs/is-letrozole-first-line-for-anovulatory-pcos-in-rrm/**  
`international pcos guideline letrozole first…` · pos 6 · effort M · conf medium · verify solid
  
*Why stuck:* Three compounding problems: (1) Answer lead opens with 'In many cases' -- a softening hedge that prevents AI Overview extraction because the guideline recommendation itself is categorical and direct;…
  
*Moves:* Rewrite the answer lead as a direct declarative · Add FAQPage + Question + Answer JSON-LD schema to the individual FAQ page at… · Write a meta description (150-155 chars) that leads with the answer · Add explicit guideline provenance in the H1/answer body

**/faqs/how-much-does-rrm-or-naprotechnology-treatment-cost-compared-to-ivf/**  
`what is restorative reproductive medicine` · pos 4 · effort M · conf medium · verify revise
  
*Why stuck:* Critical mismatch: the page ranking 4-10 for 'what is restorative reproductive medicine' is a COST COMPARISON FAQ, not a definitional page. Google is surfacing it for the definitional query because…
  
*Moves:* REDIRECT AEO EFFORT TO THE RIGHT PAGE · ADD JSON-LD FAQPage + MedicalWebPage SCHEMA to /what-is-rrm/ · SHARPEN THE DEFINITION PARAGRAPH to exactly match query grammar · ADD A SPEAKABLE BLOCK

**/naprotechnology/**  
`how does naprotechnology work` · pos 10 · effort M · conf medium · verify revise
  
*Why stuck:* The page is a 6,500-7,000 word clinician-grade guide with strong content depth but ZERO JSON-LD schema detected (no FAQPage, no MedicalWebPage, no HowTo, no MedicalOrganization). This is the primary…
  
*Moves:* Add FAQPage JSON-LD schema targeting the exact PAA questions · Add MedicalWebPage JSON-LD with 'about' pointing to a NaProTechnology Thing entity (name,… · Rewrite the lead paragraph (first 100 words) as a direct-answer block structured for AI… · Promote the 'Three-Step Flow' section from H3 to H2 and move it immediately after the lead…

### Tier 2 — solid secondary  (2)

**/commentary/rrm-spotlight-patrick-p-yeung-jr-md/**  
`restore center for endometriosis` · pos 9 · effort M · conf medium · verify revise
  
*Why stuck:* Four compounding problems: (1) GENRE MISMATCH -- the page is a narrative "spotlight" commentary, not a structured entity/bio page; Google and AI systems are looking for extractable, answer-shaped…
  
*Moves:* ADD Person schema (schema.org/Person) with · REWRITE the opening 60 words as a direct-answer lede that Google/AI can lift verbatim for both… · ADD a short FAQ section (3-5 Q&As marked up with FAQPage + Question/Answer schema) targeting… · CANONICALIZE the URL

**/faqs/what-is-restorative-reproductive-medicine-rrm/**  
`what is restorative reproductive medicine` · pos 8 · effort M · conf high · verify revise
  
*Why stuck:* Three compounding problems: (1) Internal cannibalization -- /what-is-rrm/ (pillar) and this /faqs/ URL compete for the same query; Google consolidates equity to the pillar and demotes the FAQ. (2) No…
  
*Moves:* RESOLVE CANNIBALIZATION FIRST · ADD FAQPage SCHEMA to whichever page becomes canonical · EMBED THE FORMAL IIRRM DEFINITION verbatim (quoted and attributed) · ADD meta description

### Tier 3 — low-volume / branded / edge  (8)

**/endometritis/**  
`acog chronic endometritis plasma cells…` · pos 4 · effort M · conf medium · verify revise
  
*Why stuck:* Three structural gaps keep the page from being AI-extractable for this query. First, the page never mentions ACOG by name -- the query contains "ACOG" explicitly and zero ACOG citation or…
  
*Moves:* Add a single-sentence direct-answer lede immediately under the H1 (or as a Key Takeaways… · Add one FAQ entry whose question is a verbatim match of the PAA · Add FAQPage JSON-LD schema wrapping that new FAQ entry (and any existing FAQ Q&As). Target… · Add MedicalCondition schema to the page's existing schema block with

**/neofertility/**  
`neofertility` · pos 6 · effort M · conf medium · verify revise
  
*Why stuck:* Three compounding problems: (1) Brand-navigational intent mismatch -- "neofertility" and "neofertility clinic" are dominated by the neofertility.ie/neofertility.us brand owners who have entity-level…
  
*Moves:* Add FAQPage JSON-LD schema covering all 9 existing FAQ questions -- this is the single… · Rewrite the opening paragraph (first 40-60 words after H1) as a standalone direct-answer… · Add MedicalWebPage schema (schema.org/MedicalWebPage) with 'about' pointing to a… · Add a 'NeoFertility vs

**/save-the-uterus-club/**  
`rrm club` · pos 6 · effort S · conf medium · verify solid
  
*Why stuck:* The page is stuck because: (1) Query "rrm club" is ambiguous -- Google has no strong entity signal connecting "RRM" + "club" to this page; Wikipedia disambiguation pages win on entity clarity. (2)…
  
*Moves:* Add a direct-answer lede sentence BEFORE the vision paragraph · Add FAQPage schema (JSON-LD) wrapping the existing 'Questions?' section · Add Organization + Nonprofit schema (JSON-LD) · Add 'rrm club' and 'RRM club restorative reproductive medicine' as explicit text anchors in…

**/commentary/living-with-pcos-a-personal-journey-of-healing-through-rrm-and-lifestyle-restoration/**  
`pcos healing journey` · pos 7 · effort M · conf medium · verify revise
  
*Why stuck:* Three compounding gaps keep this page out of position 1-3 and away from PAA / AI Overview candidacy. First, the page lacks a direct-answer lead: the article opens with a personal narrative…
  
*Moves:* Add a 40-60 word direct-answer summary block as the FIRST rendered element -- before the… · Add FAQ schema (FAQPage JSON-LD) with at minimum these Q&A pairs mapped to observed PAA… · Fix the title tag and H1 to lead with the target phrase · Add BlogPosting + MedicalWebPage JSON-LD with full author entity block

**/donate/**  
`rrm foundation` · pos 4 · effort S · conf high · verify revise
  
*Why stuck:* Three compounding problems: (1) Entity mismatch -- the page H1 says "Donate to RRM Academy" and the title tag says "RRM Academy", never naming "RRM Foundation" as the primary entity being answered.…
  
*Moves:* Add an 'About the RRM Foundation' answer block as the FIRST content section (above the… · Update the page <title> to · Update H1 to · Add Organization JSON-LD schema to this page (and ideally site-wide)

**/commentary/rrm-physician-spotlight-kristina-pakiz-md/**  
`kristina pakiz` · pos 4 · effort S · conf high · verify solid
  
*Why stuck:* Three compounding problems: (1) ZERO schema -- the page has no JSON-LD whatsoever (no Person, no MedicalBusiness, no ProfilePage, no FAQPage), so Google and AI engines cannot extract structured…
  
*Moves:* Add Person JSON-LD schema to the page head · Add a 'Quick Facts' structured summary box near the top of the page (visually scannable) · Add 3-5 FAQPage JSON-LD Q&A pairs targeting likely PAA questions · In the body copy, add an explicit disambiguating sentence early

**/commentary/rrm-explained-a-path-to-understanding-and-true-healing/**  
`rrm model` · pos 9 · effort M · conf medium · verify revise
  
*Why stuck:* Four compounding reasons: (1) CANONICAL SPLIT -- the page is indexed at the legacy Wix URL (www.rrmacademy.org/post/rrm-explained...) while the CF Pages version lives at…
  
*Moves:* CANONICAL CONSOLIDATION FIRST · ADD FAQPage JSON-LD TO THE COMMENTARY PAGE · ADD Article + DefinedTerm schema · REWRITE THE LEAD SENTENCE TO ANSWER-SHAPE FORMAT

**/endo-survey/**  
`endometriosis survey` · pos 9 · effort M · conf medium · verify revise
  
*Why stuck:* Three compounding problems: (1) INTENT MISMATCH -- the head keyword "endometriosis survey" skews heavily toward research/academic intent (PubMed articles rank above all patient tools); our page is a…
  
*Moves:* RETARGET the head keyword · ADD FAQPage schema to the existing FAQ section · ADD MedicalWebPage schema (or WebApplication schema) with · SURFACE a crawlable answer block ABOVE the email gate

---
## Library targeted cards (top 15)

**/library/the-sonographic-assessment-of-the-cervix-following-cervical-cerclage-reclp36d5d4ukicyb/**  
`rcog green-top guideline cervical cerclage 25 mm` · pos 8 · effort M · conf medium
  
*Why stuck:* Three compounding deficits: (1) Title tag promotes the guideline name ('Cervical Cerclage: Green-top Guideline No. 75') rather than the article title, so Google cannot match the specific query signal…
  
*Moves:* TITLE TAG · META DESCRIPTION (150 chars) · INSIGHTS EXPANSION · SCHEMA -- MedicalScholarlyArticle JSON-LD

**/library/placenta-and-appetite-genes-gdf15-and-igfbp7-are-associated-with-hyperemesis-gra-ofbolc3l/**  
`igfbp7 role in hyperemesis gravidarum` · pos 9 · effort M · conf medium
  
*Why stuck:* The page is a bare abstract card: no meta description, no Insights commentary, no answer-shaped prose beyond the verbatim abstract. The abstract is dense GWAS methodology text, not an extractable…
  
*Moves:* Write a 120-180 word Insights section (author-commentary, not abstract rewrite) that opens… · Set a meta description that front-loads the answer · Add MedicalScholarlyArticle schema with · Add missing Highwire tags

**/library/adjuvant-l-arginine-treatment-for-in-vitro-fertilization-in-poor-responder-patie-recnjnknu19ezskro/**  
`10.1093/humrep/14.7.1690` · pos 5 · effort S · conf medium
  
*Why stuck:* The page holds the verbatim abstract and all citation metadata (DOI, PMID, authors, journal, year) in human-readable prose, but is missing the machine-readable layer that AI Overview / PAA extraction…
  
*Moves:* Add Highwire Press citation meta tags to the HTML <head> · Add a ScholarlyArticle (or MedicalScholarlyArticle) JSON-LD block in the page <head> · Update the title tag to · Update the meta description to

**/library/clomiphene-citrate-affects-cervical-mucus-and-endometrial-morphology-independent-recztpbld4d90me3e/**  
`clomiphene citrate endometrial thickness…` · pos 6 · effort S · conf medium
  
*Why stuck:* Three compounding gaps. (1) No Insights section: the article-insights CSS is present but there is zero authored commentary text on the page. AI Overviews and PAA boxes extract answer-shaped prose; a…
  
*Moves:* INSIGHTS (highest priority) · TITLE TAG · META DESCRIPTION · SCHEMA -- add `description` field

**/library/antiestrogenic-effect-of-clomiphene-citrate-correlation-with-serum-estradiol-con-recifpvxi7fjb0bru/**  
`clomiphene citrate antiestrogenic effect…` · pos 7 · effort S · conf medium
  
*Why stuck:* The page is answer-shaped in its abstract but invisible to the AI Overview extractor because: (1) no meta description to surface the core claim; (2) no JSON-LD MedicalScholarlyArticle schema to…
  
*Moves:* TITLE TAG · META DESCRIPTION (155 chars) · INSIGHTS COMMENTARY (author-written, not abstract rewrite) · JSON-LD SCHEMA

**/library/third-generation-oral-contraceptives-and-risk-of-venous-thromboembolic-disorders-rechxzvtzywyxby3a/**  
`10.1136/bmj.312.7023.83` · pos 5 · effort S · conf medium
  
*Why stuck:* The page currently lacks three things AI extractors need to prefer it over PubMed: (1) No structured Insights/commentary block -- there is no author-written prose that synthesizes the study finding…
  
*Moves:* Add a short Insights block (2-4 sentences, author-written, not a rewrite of the abstract) · Upgrade schema from ScholarlyArticle to MedicalScholarlyArticle · Hardcode all five Highwire citation meta tags if not already confirmed server-rendered… · Rewrite the title tag to be answer-shaped

**/library/births-final-data-for-2001-recxvdodidtfhgyt9/**  
`births final data for 2001 number of births…` · pos 6 · effort S · conf medium
  
*Why stuck:* Three compounding deficits: (1) No meta description -- Google/AI crawlers cannot extract a clean answer snippet; the page has no single sentence that matches the AI Overview answer shape ("X births,…
  
*Moves:* TITLE TAG · META DESCRIPTION · INSIGHTS SECTION (author-written commentary, NOT the abstract) · SCHEMA — ADD JSON-LD MedicalScholarlyArticle

**/library/hormones-in-recurrent-abortion-recerqshqqdnnetac/**  
`hormones in recurrent abortion doi` · pos 5 · effort S · conf medium
  
*Why stuck:* The page has zero schema markup (no ScholarlyArticle/MedicalScholarlyArticle JSON-LD, no Highwire citation meta tags), no meta description, and the abstract is flagged as "not indexed." Without…
  
*Moves:* Add Highwire citation meta tags to the page head · Add MedicalScholarlyArticle JSON-LD schema block with · Write an answer-shaped Insights paragraph (3-5 sentences, author-reviewed) that directly… · Set meta description to a 150-char answer-shaped string

**/library/effect-of-lactobacillus-rhamnosus-hn001-in-pregnancy-on-postpartum-symptoms-of-d-recfcgloib4unba6h/**  
`slykerman et al. 2017 rct lactobacillus…` · pos 4 · effort S · conf medium
  
*Why stuck:* Four concrete gaps keep us from being the cited answer: (1) Zero JSON-LD schema -- no ScholarlyArticle or MedicalScholarlyArticle markup, so Google cannot parse structured bibliographic facts to…
  
*Moves:* ADD JSON-LD ScholarlyArticle (or MedicalScholarlyArticle) block · WRITE a short Insights section (3-5 sentences, author-attributed, not rewriting the abstract) · ADD meta description (~155 chars) · VERIFY and surface existing Highwire citation meta tags are rendering in the live HTML head…

**/library/myo-inositol-may-prevent-gestational-diabetes-onset-in-overweight-women-a-random-recf4fpklq4ro4ydl/**  
`myo-inositol may prevent gestational diabetes…` · pos 5 · effort S · conf medium
  
*Why stuck:* Three compounding gaps: (1) No Insights/commentary block -- the page has the verbatim abstract but no author-written synthesis paragraph in plain-English, answer-shaped prose. AI Overviews extract…
  
*Moves:* TITLE TAG · META DESCRIPTION (missing -- add immediately) · INSIGHTS BLOCK (highest leverage lever) · SCHEMA -- add MedicalTrial JSON-LD

**/library/amenorrhea-associated-with-bilateral-polycystic-ovaries-rec5hgikiihsbv0dj/**  
`amenorrhea associated with bilateral polycystic…` · pos 6 · effort S · conf medium
  
*Why stuck:* The page is a bare abstract card with zero answer-shaped prose for AI extraction. Four specific gaps: (1) No meta description -- Google has nothing to pull as a snippet anchor. (2) No…
  
*Moves:* TITLE TAG · META DESCRIPTION (draft) · INSIGHTS COMMENTARY (new section, author-written, not touching abstract) · SCHEMA -- add MedicalScholarlyArticle

**/library/the-effects-of-depot-medroxyprogesterone-acetate-and-intrauterine-device-use-on-fracture-risk-in-danish-women-rec5pel9tbbtdvgy3/**  
`10.1016/j.contraception.2008.07.014` · pos 7 · effort M · conf medium
  
*Why stuck:* The page is an abstract mirror competing against PubMed and ScienceDirect — the two sources Google treats as authoritative for DOI-based citation queries. Three concrete gaps hold it back: (1) No…
  
*Moves:* ADD Insights block (300-500 words, author-written RRM Academy commentary below the abstract) · FIX meta description · SPLIT Highwire citation_author into one <meta name="citation_author"> tag per author (three… · ADD citation_issn Highwire tag

**/library/effects-of-menstrual-cycle-phase-on-athletic-performance-recvh7u1ac4vlobby/**  
`effects of menstrual cycle phase on athletic…` · pos 6 · effort S · conf medium
  
*Why stuck:* The page has zero JSON-LD schema (no MedicalScholarlyArticle, no author entities, no journal entity), no meta description, no Insights commentary, and a generic title tag that omits the author…
  
*Moves:* TITLE TAG · META DESCRIPTION (missing -- add now) · INSIGHTS COMMENTARY (author-written, not the abstract) · JSON-LD SCHEMA -- add MedicalScholarlyArticle block

**/library/acog-committee-opinion-no-651-menstruation-in-girls-and-adolescents-using-the-me-recwnkz9cmxxz7f5b/**  
`acog adolescent menstrual cycle interval 90…` · pos 9 · effort S · conf high
  
*Why stuck:* The page has no extractable author-written commentary for AI/Google to attribute to RRM Academy. The abstract is verbatim and off-limits. Without an Insights section, the only prose on the page is…
  
*Moves:* ADD Insights section (~120-180 words, author-written, not the abstract) · ADD meta description (155 chars max) · ADD JSON-LD MedicalScholarlyArticle block · FIX Highwire citation_author tags

**/library/the-fertility-sector-202425-recthw4mknjg2k8fa/**  
`the fertility sector 2024/25` · pos 4 · effort S · conf medium
  
*Why stuck:* The page is a clean synopsis of an HFEA report but provides no author-written Insights layer -- the single most important extractable-answer signal for AI Overviews. Without Insights, AI models must…
  
*Moves:* Write an Insights block (2-4 sentences, author-voice) · Update the title tag to · Update the meta description to · Add MedicalScholarlyArticle schema with

---
## Sequencing
1. **Wave 1 (Tier-1 owned, ~1 week):** schema stack (FAQPage + MedicalCondition + Speakable) + definition-first ledes on isthmocele, /femm/, Creighton-vs-Marquette FAQ, NaPro-surgery, cost/'what is RRM' FAQ, /naprotechnology/. Mostly S/M effort, highest score.
2. **Wave 2 (library playbook):** apply the uniform lever-set to the ~12 high-AIO library pages (title/meta/Insights/schema). Repeatable, scriptable.
3. **Wave 3 (Tier 2-3 owned):** person spotlights (entity/Person schema), and the long tail.

Full per-card detail (every move, schema field, internal link, expected lift) is in the structured result; this doc is the reviewable summary.