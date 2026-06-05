# rrmacademy.org — Comprehensive SEO / AEO / GEO / Agent-Readiness Audit

**Date:** 2026-06-05
**Method:** 7-dimension multi-agent fan-out (15 agents, 864 tool calls) against the live site + origin/main code. Each finding passed a skeptic verification gate (confirmed only if live HTTP/DOM proved it or two independent checks agreed; false positives killed). 83 findings survived verification.
**Reused baseline (no re-run):** consideration-set 2026-06-03 (in-set 31%, brand 0/99, rrmacademy.org cited 3/99), aeo-checker 2026-06-03 (LLM citation 5%, find-rate 24%, avg rank 6.7), Website Specification audit 2026-05-30 (Wave 1+2 shipped).

---

## Scorecard — Overall 63 / 100

| Dimension | Score | Grade | One-liner |
|-----------|:---:|:---:|-----------|
| SEO-Technical | 82 | B | Clean hygiene; only leaks are crawl-discovery gaps (499 articles + 9 topic hubs missing from sitemaps, duplicate sitemap Link header). |
| Performance | 85 | B+ | Strong and largely intentional; remainder are cold-cache mobile hints (fp preconnect, fetchpriority, page-gated Stream preconnect). |
| SEO-OnPage | 68 | C+ | Two flagship H1s carry zero keywords, titles/metas overrun SERP limits, two highest-intent pillars (/infertility/, FABM comparison) don't exist. |
| Structured Data | 62 | C | Broad schema coverage undercut by a thin entity graph: no Wikidata on org/person, 4,050 library articles unwired to #organization, individual FAQs mistyped. |
| Agent Readiness | 58 | C- | Unusually complete agent stack, but stale MCP article count, near-duplicate llms-full.txt, missing .md twins, non-A2A agent-card. |
| AEO | 48 | D+ | Measured 3/99 citation: empty llms-full.txt, span-not-heading FAQ questions, hard-"Yes" answers, noindex /ask surface. |
| GEO | 40 | D | The strategic gap: no Wikidata entity disambiguation, no pillar markdown twins, no citation network — direct cause of absence from AI answers. |

## Executive summary

rrmacademy.org is a technically mature site (Wave 1+2 already closed ~22 schema and surface gaps) that is still effectively **absent** from AI answers — the 2026-06-03 consideration-set re-run measured brand 0/99, cited 3/99. That gap is not a content-volume problem (4,057 library articles, 13 pillars, a working MCP server and agent stack already exist); it is an **entity-recognition and retrieval-coverage** problem, which is exactly the compounding asset the core thesis says to win.

Two confirmed criticals gate the move from absent to cited:
1. The Organization and Naomi Person JSON-LD carry **no Wikidata Q-ID anywhere** (grep `wikidata` = 0 on the homepage, re-verified live), so LLMs cannot disambiguate the entity.
2. The highest-authority citation targets — the ~12 **pillar pages — have no markdown twins** (verified `/what-is-rrm.md` = 404) while commentary and FAQ slugs do, leaving them invisible to plain-text crawlers.

The flagship `llms-full.txt` compounds this: it is a 13.5KB near-duplicate of `llms.txt` (13,578 vs 13,876 bytes) with zero article/FAQ/glossary corpus, so any agent loading the "full" file learns nothing new.

Technical hygiene, structured-data breadth, and performance are genuinely strong (single-hop 301s, correct robots Sitemap directive, Brotli + immutable caching, broad schema coverage). The low scores are deliberately reserved for GEO (40) and AEO (48), where the measured citation outcome proves the gap. The fastest compounding wins are the entity-recognition JSON-LD edits (propagate site-wide in one SSOT commit) and the citation-metadata additions; the heavier Wave-3 lift is the real `llms-full.txt` and the pillar/library markdown twins.

---

## Top priorities (ranked by impact × effort)

| # | Move | Dimension | Effort | Why |
|:-:|------|-----------|:---:|-----|
| 1 | Add Wikidata Q-ID (+ROR, +EIN) to Org + Naomi Person JSON-LD | GEO / SD | S (JSON-LD), M incl. item creation | Gates the entire absent→cited transition. Verified absent live. **Blocked: Wikidata items must be created first (editorial, HELD).** |
| 2 | Build a real `llms-full.txt` with the full corpus | AEO / GEO / AR | M-L | The one file every AI crawler is told is the "full" index is a 13.5KB stub. Wave 3, HELD. |
| 3 | Markdown twins for the ~12 pillar pages | GEO / AR | M | Makes the highest-authority citation targets visible to plain-text crawlers. Pattern exists (commentary), not applied to pillars. Wave 3, HELD. |
| 4 | Wire library MedicalScholarlyArticle into entity + citation graph | SD / GEO | S | Two-line publisher `@id` + `@id` + `headline` + `citation[]`; propagates to all 4,050+ pages on next build. **Pending approval (exceeds allowlist).** |
| 5 | Add "Cite this" blocks to commentary + pillar pages | GEO | S | Citation.astro already exists; just not rendered on high-authority pages. Content, HELD. |
| 6 | Fix stale "3,370+" article count on apex MCP server | AR | S | Primary agent endpoint undercounts corpus 21%. Separate rrm-mcp repo, HELD. |
| 7 | Add 499 missing library articles + 9 topic hubs to sitemaps | SEO-Tech | S | Restores crawl discovery for ~12% of corpus + highest-value CollectionPages. Build-logic, pending approval. |
| 8 | FAQ hub questions `<span>`→`<h3>` + fix Speakable targeting | AEO | S | Heading signal on 25 Q&A; CSS class-targeted so appearance unchanged. Pending approval. |
| 9 | Rewrite hard-"Yes." fertility FAQ answers to hedged leads | AEO | S | Violates the site's own no-hard-yes rule. Content + D1, HELD. |
| 10 | Tighten on-page: keyword H1s, sub-60c titles, sub-160c metas | SEO-OnPage | S | Homepage + library H1s have zero keywords; titles run to 122c. Content, HELD. |
| 11 | Restructure agent-card.json to A2A skills schema | AR | S | Flat string array unparseable by A2A orchestrators. Generated from SSOT, pending approval. |
| 12 | Build `/infertility/` + `/fertility-awareness-methods/` pillars | SEO-OnPage / GEO | L | Highest-intent query clusters currently 404 where naprotechnology.com wins. Content, go-live gate, HELD. |

---

## Fix disposition

### ✅ Applied this session (worktree `claude/seo-audit-fixes-20260605` off `9e8795ea`)

- **`src/layouts/BaseLayout.astro`** — added `preconnect` + `dns-prefetch` for `fp.rrmacademy.org` (the credentialed visitor-ID call that fires on first load; CSP `connect-src` already allows it). Saves ~100-200ms on mobile first load. *(perf-001)*

### ⏸ Pending approval — technical fixes that exceed the pre-cleared write-allowlist, sit behind an SSOT generator, or carry high blast radius

| Fix | File | Why it needs a look |
|-----|------|---------------------|
| MedicalScholarlyArticle `publisher @id` + `@id` + `headline` + `citation[]` | `src/lib/schema-builders.mjs` | 4,050-page blast radius; `.mjs` (lint gate); rank-4 win |
| FAQPage `@id`/`publisher`/`author`/`reviewedBy`; individual FAQ → QAPage | `src/pages/faqs/[...slug].astro`, `faqs.astro` | Schema-type change on every FAQ; not in allowlist |
| Speakable on commentary BlogPosting | `src/pages/commentary/[...slug].astro` | Additive schema; not in allowlist |
| Remove duplicate `/sitemap.xml` rel=sitemap Link header; dedupe `describedby` (3×) + `service-desc` (2×) | `public/_headers` | Site-wide response-header **removal** (allowlist authorized additive-only) |
| Remove `/ask` from robots.txt Disallow | `public/robots.txt` | Crawl-**policy** nuance: `/ask` is deliberately grouped with auth/private paths; the file documents "Private paths blocked." nlweb-mismatch fix conflicts with that intent |
| Homepage founder photo `loading=eager` + `fetchpriority=high` | `src/pages/index.astro` | Homepage markup; not in allowlist (trivial) |
| Org `logo` + `description` + `knowsAbout`; **confirm** `legalName`/`foundingDate` | `ssot/organization.json` | SSOT source; `legalName`/`foundingDate` ambiguous (Academy brand vs Foundation 501c3 entity) |
| Add X.com handle to SSOT; remove hardcoded `inlineSameAs` from index.astro | `ssot/organization.json`, `ssot/agent-surfaces.json`, `index.astro` | SSOT + homepage; verify handle |
| agent-card.json A2A `skills[]` schema | `ssot/agent-surfaces.json` (NOT the built file) | **Generated** — `.well-known/agent-card.json` is emitted from SSOT at build; direct edit gets clobbered |
| Sitemap coverage: 499 tier-null articles, 9 topic hubs, `/saved/` exclusion, `/common-questions` removal, pagination `rel=prev/next` | `src/integrations/library-sitemaps.mjs`, `astro.config.mjs`, `src/pages/library/page/[page].astro` | Build-logic, not leaf files |

### 🔒 Held for explicit go-live / editorial / cross-repo / Wave-3

- **Wikidata items** for RRM Academy + Naomi (editorial; `wikidata-sitting` HARD rules HR#17; Naomi profile updates frozen until UPMC resolves). *Gates rank-1.*
- **Real `llms-full.txt`** corpus build (Wave 3, build pipeline).
- **Pillar + library `.md` twins** (Wave 3, build pipeline; prioritize pillars).
- **`/infertility/` + `/fertility-awareness-methods/` pillars** (content, go-live gate).
- **Hard-"Yes" FAQ rewrites** (content + D1 `faqs`).
- **Title / meta / H1 rewrites** on homepage, library, pillars (content).
- **Rename "RRM vs Standard ART" course** condition-first via `/courses-update` (D1).
- **~900-article citation backfill** via enrichment worker (separate `rrm-library-worker` repo).
- **Static `/ask/examples` indexable page** (AEO policy decision).
- **HSTS `preload`** (irreversible, Brian-gated, on DEFER list).
- **CF zone-level `Access-Control-Allow-Origin: *` scoping** (infra, security review, no SEO impact).
- **MCP "3,370+" count fix** (separate `rrm-mcp` repo).

---

## Per-dimension confirmed findings

### SEO-Technical (82/B)
Strong hygiene: single-hop sitemap 301, correct robots.txt Sitemap directive, clean canonicals, HSTS+includeSubDomains, multi-chunk sitemap index. Confirmed gaps are crawl-discovery leaks, not breakage:
- **HIGH** — 499 library articles (~12% of corpus) excluded from all sitemaps (tier-null when abstract <300 chars or no domain). `t3=3499 + t2=59 = 3558` vs hub "4,057". `classifyArticleTier()` returns null in `library-sitemaps.mjs:103-111`.
- **HIGH** — 9 library topic-hub CollectionPages (endometriosis, pcos, infertility, naprotechnology, surgery, contraception-comparison…) missing from all sitemaps; all 200 with `numberOfItems` up to 259.
- **MED** — Duplicate `rel=sitemap` Link headers on homepage (`_headers:169` emits `/sitemap.xml`, `_middleware.js:73` emits `/sitemap-index.xml`). Also 3× `describedby` (llms.txt), 2× `service-desc` (openapi.json).
- **MED** — Library pagination (82 pages) lacks `rel=prev/next`.
- **MED** — Dev/utility pages (`/agent-auth/`, `/webhooks/`, `/openapi/`) indexable + in sitemap-0 (likely intentional, inconsistent).
- **LOW** — `/saved/` noindexed but in sitemap-0; HSTS missing `preload` (deferred policy); CF zone-level `ACAO: *` on homepage HTML (infra).

### SEO-OnPage (68/C+)
- **HIGH** — `/infertility/` 404 (highest-intent RRM use case unserved); `/fabm/`, `/fertility-awareness/`, `/fertility-awareness-methods/` also 404.
- **HIGH** — Library H1 "Find your topic in the evidence" — zero keywords (title is keyword-rich → semantic mismatch).
- **HIGH** — Homepage H1 "Reclaim Reproductive Health with the Evidence" — no RRM/condition keywords.
- **HIGH** — Pillar titles exceed 60c (neofertility 118c, endometritis 93c, endometriosis 88c, miscarriage 82c, pcos 73c, femm 72c, homepage 72c).
- **HIGH** — Meta descriptions exceed 160c (miscarriage 363c, endometriosis 221c, homepage 188c, pcos 176c).
- **MED** — No comparative FABM pillar; `/pcos/` links deprecated `/glossary/#pcos` anchor; thin glossary cross-linking (endometriosis 1, pcos/femm/miscarriage 0; what-is-rrm 5 = best); `/common-questions-about-rrm/` in sitemap-pillars despite 301→/faqs/; `/what-is-rrm/` H2 near-duplicates H1.
- **LOW** — Commentary og:image (.webp) vs twitter:image (.jpg) mismatch; library titles systemically 100-122c; glossary term H1s inconsistent; "RRM vs Standard ART" course approach-first; NeoFertility title has HTML entity.

### Structured Data (62/C)
- **CRITICAL** — Organization missing Wikidata Q-ID + ROR in sameAs (grep wikidata = 0, re-verified).
- **HIGH** — Org node missing logo/description/foundingDate/legalName; Naomi Person inconsistent across page types (homepage identifier-only, commentary sameAs-only, about = full); MedicalScholarlyArticle lacks `@id` + uses inline publisher (4,050+ pages); FAQPage missing publisher/author/reviewedBy/`@id`.
- **MED** — Individual FAQ pages emit FAQPage instead of QAPage; Course missing `@id`/teaches/credential (OfferCatalog points to undeclared #course fragment); X.com hardcoded in index.astro absent from SSOT; WebSite SearchAction library-only; commentary BlogPosting missing Speakable; Naomi sameAs missing Wikidata; pillars inconsistent on reviewedBy.
- **LOW** — Library uses `name` not `headline`; providers page WebPage not MedicalWebPage.

### Performance (85/B+)
- **MED** — No preconnect for fp.rrmacademy.org *(FIXED this session)*; `/what-is-rrm/` 369KB with ~92KB inline CSS (2.3× homepage); homepage founder photo above-fold is `loading=lazy` no fetchpriority.
- **LOW** — 5 font weights preloaded globally (Inter 500 minimal use); candid seal PNG no WebP; Stream preconnect on all pages regardless of video; MobileSearchModal 28KB on every page; HTML `max-age=0` forces in-session revalidation; CrUX field data unavailable (PSI quota — re-run later); OG PNG + auth-hint cookie working as designed.

### AEO (48/D+)
- **HIGH** — `llms-full.txt` near-duplicate of llms.txt, no corpus; hard "Yes." leads on fertility/treatment FAQs (letrozole body + 5 in /what-is-rrm/ FAQPage JSON-LD).
- **MED** — FAQ hub questions are `<span>` not headings; `/ask` noindex + triple-Disallowed; commentary lacks FAQPage despite question-shaped H3s; no dedicated FAQ pages for high-volume PAA queries (tubal factor, perimenopause, excision, standalone FEMM).
- **LOW** — Speakable on /faqs/ targets a category blurb not the 44-word RRM definition; library articles lack answer-extraction supplements; /faqs/ hub lacks headered above-fold definition; IndexNow wired but Bing acceptance unverified.

### GEO (40/D)
- **CRITICAL** — Org + Naomi Person JSON-LD missing Wikidata Q-ID (entity disambiguation broken); ~12 pillar pages have no markdown twins (`/what-is-rrm.md` 404) + no `rel=alternate text/markdown`.
- **HIGH** — Org sameAs missing Wikidata/ROR/EIN; Naomi homepage node has no sameAs; 4,050 library pages no .md twins (library-feed.jsonl live but not in sitemap-index); commentary + pillars have no "Cite this" block; MedicalScholarlyArticle lacks `citation`/`isResponseTo`.
- **MED** — /faqs/ index missing .md twin; llms version drift (v1.6 vs v1.1); ~900 articles lack APA/Vancouver citations; BlogPosting lacks citation/mentions/about.

### Agent Readiness (58/C-)
- **HIGH** — `llms-full.txt` near-duplicate (no corpus dump); 4,078 articles + ~13 pillars no markdown twins.
- **MED** — Apex MCP server hardcodes stale "3,370+" (21% undercount; every other surface says 4,050+); agent-card.json flat capability strings not A2A `skills[]`; Org schema missing Wikidata/ISNI/LEI/EIN/LinkedIn; pillars no .md twins.
- **LOW** — llms-full.txt version (1.1) < llms.txt (1.6); robots blocks /ask (and the obvious /api/ask alt is also blocked); library heads lack rel=alternate markdown; Org sameAs missing LinkedIn.

---

*Generated by the rrma-comprehensive-audit workflow. Raw verified findings: workflow run `wf_0487c85c-478`.*
