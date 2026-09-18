# RRM Academy search and taxonomy revamp

Date: 2026-09-18. Owner: Brian. Status: design, awaiting Brian's review before the plan.
Decision already made: **the patient wins a tie.** A patient typing "endo" gets the endometriosis guide above
fifty papers; a clinician's query is recognized by its shape (author, journal, "RCT", "meta-analysis",
a DOI or PMID) and only then do papers lead.

## 1. Problem

Site search is a Pagefind index (client side) fused by reciprocal rank fusion with a Vectorize semantic search
(server side, 300 ms budget) in `src/components/SearchBar.astro`, then adjusted by hand-set boosts: an RRM
relevance map, a recency term, a per-type "own content" bump, a sentiment penalty and a non-English demotion.
The boosts were set by feel and never measured. Measured on 2026-09-18 against the live site:

| Query | Live top results | Should lead |
|---|---|---|
| endo | NaPro guide, then 50 papers on platelet-rich plasma, food additives, bone density | Endometriosis guide, endo symptom survey (absent) |
| how do i find a doctor | FEMM guide, NaPro guide, NeoFertility guide | care team / provider page (absent) |
| pcos | PCOS guide, then 14 papers with titles cut at 70 characters | guide, FAQs, course, then papers |
| IVF success rates (semantic API) | glossary entry for PGT-A | the IVF guide or commentary |

Two causes. The corpus is 4,408 papers against roughly 200 patient-facing pages, so any query drowns in papers
unless a guide holds the literal word. And nothing understands the query: "endo" stems into "endometrial" and
"endocrine", the semantic half times out or scores under its 0.5 floor, and the fused list has no idea whether
the person wants a doctor, an explanation, or a study.

The topic taxonomy that the library browse pages depend on is in worse shape (audit 2026-09-18, mechanics):

- Two disconnected taxonomies. `domain` is a closed 21-value enum, 0 percent null, written by the guarded
  `/classify-result` endpoint. The topics UI (`/library/topics/`, 16 cards from a hand list in
  `src/data/library-topics.ts`) reads a different field, `topics`, a free-text "Domain > Category > Subcategory"
  array written by a one-off script (`scripts/reclassify-chunk.mjs`, raw `UPDATE`, no CAS, no proof gate).
- 1,359 of 4,408 published papers (30.8 percent) have no `topics` value. The 3,045 that do carry 6,657 distinct
  path strings. Only level 1 was ever constrained; categories and subcategories drifted freely, and about 300
  unparented single strings sit outside the 16-card allowlist and render nowhere.
- Skew: 75 to 812 papers per browsable topic, invisible to a visitor because the index shows no counts.
- The search log (`rrm-analytics.search_log`, 19,612 rows since 2026-04-18) shows the taxonomy driving search:
  many of the top queries are topic breadcrumb strings ("pregnancy > complications > ..."), so a bad taxonomy is
  a bad search twice. 5,850 distinct queries over 9,306 searches in 120 days: a long tail, which is exactly
  where hand weights fail.

## 2. Shape of the answer

Three deliverables, in order, each measured before the next starts. Jev (TypeSafe System One) does the
classification and grading at every layer; code does retrieval, arithmetic and everything exact. Jev never
writes prose and never decides alone at runtime; below a confidence threshold the code path stands.

```
D1 taxonomy  ──►  D2 tags + graded battery  ──►  D3 ranker (fitted weights + intent + rerank)
   (browse pages)      (the answer key)              (the search box)
```

Later consumers, out of scope here but served by D1 and D2: AskRRM retrieval, a knowledge graph (the tags are
its node set; page-to-condition and page-to-intervention are its first edges), the classify-library skill.

## 3. D1: one taxonomy, closed and hierarchical, every paper in it

**Vocabulary.** One tree, three levels, closed at every level: domain (about 16 to 20, the browsable set),
topic, subtopic. It lives in one file, `src/data/library-taxonomy.json` (name, slug, one-line descriptor,
parent, aliases, browsable flag), generated into `library-topics.ts` so the pages keep their shape. The tree
is authored by Gianna and signed by Naomi (clinical vocabulary is theirs; this session never edits topic names).
Starting material: the 21 `domain` values, the 16 cards, and the 6,657 existing paths clustered by a Sonnet
pass into candidate topics and subtopics for Gianna to accept, merge or drop.

**Classification.** Hierarchical Choice, the TypeSafe cookbook shape: Jev picks the domain from the closed set,
then the topic within that domain, then the subtopic within that topic, each with confidence; a paper may carry
a primary path and up to two secondary paths (a second Choice with `none` as an option). State per paper: title,
abstract or first 1,500 characters of fulltext, journal, year, existing `domain`. One call per paper,
about 4,400 calls, cents. Below 0.5 confidence at any level the paper goes to a review queue instead of the
tree; the queue is worked through the classify-library skill, never silently filled.

**Writes.** Through `/classify-result` extended to accept `topics` (paths as slugs), CAS-guarded, proof-gated,
identity-coherence checked, the same as `domain` today. `scripts/reclassify-chunk.mjs` is retired. The
`topics` column stores slug paths only; labels come from the taxonomy file at render time, so a rename never
touches D1.

**Gates.** G1: zero published papers without a primary path (review queue counted and visible). G2: every
stored path resolves in the taxonomy file (a build check, fails the deploy). G3: agreement with a 200-paper
sample labeled by Gianna at or above 0.85 on domain and 0.75 on topic, calibrated (lower confidence on the
disagreements). G4: the topics index shows counts, and no browsable topic is under 20 or over 800 papers
without a Brian ruling recorded in the taxonomy file.

## 4. D2: tags on every page, and a graded battery

**Tags** (one Jev call per indexed page, all content types, rerun only on change, stored as Pagefind
`data-pagefind-meta` and as Vectorize metadata so both retrieval paths carry them):

| Tag | Type | Values |
|---|---|---|
| page_type | Choice | guide, faq, course, commentary, research, glossary, care_team, tool, other |
| audience | Choice | patient, clinician, both |
| conditions | multi | from the D1 taxonomy domains and topics (closed) |
| language | Choice | en, other (replaces the title heuristic in `isNonEnglish`) |
| register | Choice | plain_language, technical |
| scope (research only) | Choice | foundational, narrow, commentary_on_research |
| has_plain_summary | Noul | a patient-readable layer exists on the page |

Pages are 4,400 papers plus about 200 site pages; the paper call is folded into the D1 classification call.

**Battery.** Source: the top 400 distinct real queries from `search_log` over the last 120 days (breadcrumb
strings excluded, they are clicks not typing), plus 100 hand queries across the lenses the site-search-tune
skill names (money and booking intent, contact and location, condition vocabulary and short forms,
misspellings, people, tasks). For each query the current search's top 20 fused results are captured
(`scripts/search-probe.mjs`, the built index, the overlay's exact options), and Jev grades each (query, page)
pair: Noul `answers_query`, Noul `patient_would_open`, plus a Choice `intent` on the query alone (find_doctor,
learn_condition, research, course, donate_contact, tool, other). About 500 queries times 20 pairs is 10,000
Nouls in about 400 calls, cents. Output: `scripts/search-battery/battery.json` with expected top-1 and an
acceptable set per query, and per-pair labels for the fit.

**Battery gates.** B1: every query has at least one acceptable page or is marked `no_answer` with a reason
(a real gap in the site, reported separately). B2: a 60-query slice hand-checked by Brian against Jev's labels
at or above 0.85 agreement, because the whole ranker is fitted to these labels. B3: the runner exits non-zero
on a FAIL and runs in CI on every deploy (the neofertility-ie shape).

## 5. D3: the ranker

**Retrieval stays.** Pagefind and Vectorize as now, plus alias spans for short forms and misspellings that
the visible copy avoids (endo, ttc, napro, progestrone), and the care team page and every tool page in the index
with their tags. Titles no longer truncate at 70 characters in the result list.

**Scoring replaces the hand boosts.** Score = fused rank score plus a weighted sum over the page's tags and the
query's intent: intent-matches-page_type, audience-matches-intent, condition overlap, language, recency,
relevance, sentiment. The weights are fitted by a small regression on the D2 labels (pairwise, the standard
learning-to-rank shape, a hundred lines of Node, no dependency). The fit is rerun whenever the battery changes;
the weights live in `src/data/search-weights.json` with the fit's date and its held-out score. The rule that
the patient wins a tie is a constraint on the fit, not a hope: intent find_doctor or learn_condition may not
rank a research page above a guide that carries the same condition.

**Jev at runtime, inside the existing 300 ms budget, server side in `/api/search/semantic.js`:** a Choice on
the query's intent (one call, about 300 ms, cached by normalized query in KV for a day), and when there is
budget, a rerank of the top 30 fused candidates by `answers_query` Nouls over title, excerpt and tags. When the
call misses the budget the fitted weights alone stand, which is already the measured improvement; the rerank is
the last few points. Rate limit and query cap as today. Cost at current volume (about 120 searches a day) is
under a dollar a month.

**Grouping.** Groups stay (Guides, FAQs, Courses, Commentary, Research, Glossary) but the group order follows
intent: find_doctor and learn_condition lead with guides and care team; research leads with papers and shows
the taxonomy path under each title; course leads with courses. Preview limits per group stay.

**Gates.** R1: battery pass rate before and after, on the same queries; adoption needs top-1 agreement at or
above 0.85 and no lens under 0.75. R2: the four failing queries in section 1 pass. R3: p95 search latency at or
under today's, measured in the harness. R4: the non-English demotion is reproduced by the `language` tag with
the same or better precision on a 50-title sample, then the heuristic is deleted.

## 6. Data, privacy, cost

- Jev sees: paper titles, abstracts and fulltext excerpts (already public), site page text (public), and query
  strings from the log (no IP, the log stores a hash). Nothing about a user leaves the estate.
- All Jev calls at build or batch time run from a session or a CI job with `TYPESAFE_API_KEY`; the runtime
  intent call runs in the Pages Function with the key as a Pages secret, same posture as the Workers AI calls
  today. Runtime model rule: Jev is a paid API in a deployed surface, which the estate's rule allows only for
  classification with a code fallback, which this is; the fallback is exercised in the harness.
- Cost: D1 and D2 about 5,000 calls once, cents; runtime under a dollar a month; refits are free.

## 7. What is deliberately not in this spec

- A knowledge graph. The tags are its node set and stay closed-vocabulary so one can grow from them; building
  relations is a separate project.
- AskRRM changes. It consumes D1 and D2 later through `rrm-ai-search`; nothing here touches `/api/ask`.
- Search v2 (`feature:search_v2`, the AI Search Worker path). It stays behind its flag; D3 applies to the v1
  fused path that serves everyone. Folding v2 in is a follow-up once D3 is measured.
- Renaming topics or writing descriptors. Gianna and Naomi own the words.

## 8. Order, checkpoints, and what Brian decides

1. D1 vocabulary draft (Sonnet clusters, Gianna edits, Naomi signs). **Checkpoint: Brian approves the tree.**
2. D1 classification run to the review queue and the four gates. Topics pages rebuilt from slugs with counts.
3. D2 tags and battery; **checkpoint: Brian hand-checks the 60-query slice.**
4. D3 fit, alias spans, index additions, grouping by intent; harness numbers.
5. Runtime intent call behind a flag; measured; flag flipped. **Checkpoint: Brian sees before/after on the
   four queries and the battery table.**
6. Battery in CI. Hand boosts deleted.

Each step is a converge component; the build runs subagent-driven with the jev-controller helpers.

## 9. Open questions for Brian

- The 16 browsable topics: keep the number, or let the tree decide it (the audit suggests 3 are oversized and
  5 demoted ones are hidden today)?
- Should clinician-register pages (technical FAQs, protocol commentary) be a fourth audience value or fold into
  `both`?
- Is the review queue for low-confidence papers Gianna's or a Sonnet pass with Gianna spot-checking?
