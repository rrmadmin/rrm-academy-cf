# RRM Academy -- Backlog

> Living document. Check before starting any session. This is the SINGLE consolidated task list for all RRM Academy work.

## Priority

### SEO Audit 2026-04-18 -- Remaining Open Items

Most April audit items shipped 2026-04-19 / 2026-04-20 (Physician entity, policy pages, Organization trust fields, BreadcrumbList, IndexNow, sitemap chunking, CF managed-robots-txt unblock, timestamp system, pillar inline-author flatten, commentary/library hub linked @graph). See `projects/whittaker-ai/public/reports/rrmacademy/2026-04-18/index.html` for full audit + current state (80/100 from 68/100 baseline). Remaining open actionable items:

- **#4 Wikidata QIDs** -- mint Wikidata entries for RRM Academy (Organization) + Dr. Whittaker (Person), then add the QIDs as `sameAs` on both entities. Highest-leverage remaining entity-graph move for LLM retrieval. Effort: high (multi-week, needs notability evidence + Wikidata community review). Separate workstream, not a code task
- **#7 Condition pages** -- ship `/conditions/endometriosis/`, `/conditions/pcos/`, `/conditions/adenomyosis/`. Each needs direct-answer opening, `MedicalCondition` schema, cross-links to relevant library articles. Currently covered only inside pillar guides. Splitting doubles conditioned entry points for AI retrieval. Effort: medium per page
- **#8 Compare pages** -- ship standalone `/compare/napro-vs-ivf/` and `/compare/rrm-vs-ivf/` (both currently 404). Partial mitigation already live: "Is RRM an Alternative to IVF?" H3 section on `/what-is-rrm/` citing Boyle 2025. Effort: medium
- **#9 FAQ schemaAnswer expansion** -- expand `schemaAnswer` fields to 80-120 word target across all 25 FAQ detail pages. Validate each with Rich Results Test. Effort: Gianna-dispatch (content) + D1 UPDATE (mechanical)

Items explicitly SKIPPED per Perplexity verification (not backlog):
- #6 "Key Takeaways" -> "Here is what matters:" rename -- folk SEO, zero evidence of LLM-extraction impact. Memory: `feedback-aeo-folk-rules.md`
- #12 `/schema/*.json` + `schemamap.xml` (NLWeb pattern) -- proposal-only, zero adoption by ChatGPT/Claude/Perplexity/Gemini. Memory: `feedback-nlweb-schemamap-skip.md`

### 2026-05-27 6-Agent Audit — Remaining P1 / P2

Six parallel sub-agents reviewed the codebase across non-overlapping slices (API hygiene, design system + a11y, D1 schema/queries, CI/build, agent surfaces/AEO, SEO + content). All 12 P0 items shipped in 5 batches (claude/p0-{ci-baselines-tests, d1-indexes-schema, rate-limits-quiz-community, openapi-schemamap, about-schedule-link}). The P1/P2 items below remain open. Picked from the synthesized punch list — full agent transcripts referenced in `~/iCode/.claude` task outputs from this session.

**Deferred from P0 (vendor work):**
- **Vendor `~/iCode/tools/site-ssot/`** into the repo and re-enable `/schemamap.xml` — `_headers` Link advertisement was removed in 235faef because the postbuild generator lives at a sibling-tool path that doesn't exist in CI. Follow the `lint-cf-headers` precedent (rrmadmin/rrm-tools shared workflow). When restored, add the Link back to `public/_headers` line ~142 and the `/schemamap.xml` Content-Type block to line ~170. Same vendoring opportunity covers the `standards-gate` step in deploy.yml:445-455 (currently a dead step for the same reason).

**P1 — bug-class fixes worth doing this month:**

1. **Citation graph builder** (single biggest AEO unlock per [[rrma-core-thesis-citation-authority]]). Build-time scan of `src/pages/commentary/[...slug].astro` rendered bodies + pillar pages for `/library/<slug>/` references; emit bidirectional `citation: [...]` on both ends of the JSON-LD. Files: `src/lib/identity.ts` (buildMedicalScholarlyArticle), `src/pages/library/[...slug].astro:130`, `src/pages/commentary/[...slug].astro:76-106`. Bidirectional emit = the graph LLMs traverse to decide "RRMA is the source PMC and ASRM agree with."
2. **Commentary BlogPosting schema lacks `citation` field** even when post body cites library articles. Pair with item #1.
3. **Pillar /neofertility/ hardcodes 3 ScholarlyArticles** instead of referencing live `/library/<slug>/` URLs — refactor `src/pages/neofertility/index.astro:43+` to use canonical library URLs so the graph stays internal. Same for `/endometriosis/` and other pillars.
4. **`/editorials/` parked despite being built** (per [[rrm-responds-initiative]]). Decide: go live or de-park. Sitting wastes built work + the ScholarlyArticle co-retrieval edge.
5. **`/health` declared in openapi.json but no handler exists** — add `functions/health.js` returning `{status:"ok"}` OR strip the path from spec. Calls TO downstream workers (admin/seo.js:42, admin/backlinks.js:52) are unrelated.
6. **Test glob silently skips files**: `npm test` runs `test/*.test.js` only — misses `.test.mjs` + everything under `tests/`. Change to `node --test test/**/*.test.{js,mjs} tests/**/*.test.{js,mjs}` and add a Playwright job for e2e. Likely 7+ tests sit dark.
7. **`blog/posts.js:54` `SELECT * FROM posts`** with full bodies on hot path. Project columns + paginate. Will approach D1 100KB per-statement ceiling as corpus grows.
8. **`partners/apply.js`** uses `Math.random()` for partner ID (weak RNG vs sibling `crypto.randomUUID()`), no rate limit, no `withIdempotency`. Mirror `contact/submit.js`.
9. **`survey/request.js:105,109`** `env.DB` not guarded for the `sendEmail` log path — throws 500 if binding missing.
10. **N+1-ish correlated subqueries** in `community/posts.js:80,90,157,185` — `(SELECT COUNT(*) FROM community_comment WHERE post_id=p.id)` per row in every feed query. Switch to LEFT JOIN aggregate or denormalize `comment_count` with triggers.
11. **`_webhook-checkout.js`** has ~17 sequential `.run()/.first()` outside `db.batch([…])` (already PG4 warn-flagged 2026-05-07; still unresolved).
12. **53 raw `<img>` tags in `/src/pages/`** should migrate to Astro `<Image>` for optimization. Backlog because volume.
13. **Responsive breakpoint drift**: `NewsletterSignup.astro` uses 480/600px while rest of site uses 640/768/1024. Standardize.
14. **A11y gaps**: 5 pages missing alt text (linkinbio, hero, commentary cover images); 3 icon-only buttons missing `aria-label` (search button, format buttons, community link button).
15. **`security.yml` triple-fires** on the typical claude/* → merge → main flow. Restrict trigger to `main` + `pull_request` only (drop claude/** branch trigger; pre-commit catches it locally via gitleaks protect).

**P2 — backlog (touch opportunistically when in the file):**

16. **Dead components**: `AudienceRail.astro`, `OptimizedImage.astro` — 0 imports across `src/pages/` and `src/layouts/`. Archive or promote to use.
17. **`/providers/index.astro` missing JSON-LD** — emit `ItemList` + per-provider `MedicalBusiness`/`Physician` nodes. Provider directory is the kind of structured page that benefits most.
18. **Glossary references point to external PMC/PubMed** instead of `/library/<slug>/` where the paper exists in D1 — breaks internal citation graph. 85 external citations. Where library record exists, swap to internal URL; external fallback only when no library record.
19. **Hardcoded shadows** (`rgba(0,0,0,0.08)` / `0.1`) appear inline in 8+ places — consolidate to `--shadow-sm` / `--shadow-md` / `--shadow-lg` tokens. Plus `CourseCard.astro` badge colors, `SearchBar.astro` focus shadow, `MobileSearchModal.astro` backdrop — all should be tokens.
20. **`courses/comments.js`** has no PATCH/DELETE handler (sibling `community/comments.js` does both). Author can't edit/delete after posting. Verify intentional vs gap.
21. **`courses/enroll.js:41`** no `withIdempotency` wrapper. INSERT has ON CONFLICT so safe, but two Stripe Checkout sessions can be created before the dedup fires on a double-tap.
22. **`merge.yml` duplicates 3 guards** that re-run in deploy.yml minutes later (~30-60s waste per merge). Drop from merge.yml; pre-commit + deploy.yml already cover.
23. **AI Search reconcile weekly cron** refetches 4 data sources with no `actions/cache` step. 1-3 min wasted per Sunday run.
24. **`standards-gate` step in deploy.yml:445-455** references a sibling path that doesn't exist in CI — dead step. Either vendor (see deferred P0 above) or remove invocation.
25. **OpenAPI version stuck at `1.0.0`**, no `x-updated-at`, no `deprecated:` markers. Bump to `1.1.0` + add `x-updated-at` next time the spec is touched.
26. **No `/glossary/rss.xml` feed** for AI agent freshness polling. llms.txt advertises glossary; agents need a poll target.
27. **Corpus count drift**: site copy says "4,030+" articles; live D1 is 4,074 published / 5,323 total. Either re-pull `sync-library-count.mjs` more often or hardcode "4,070+".
28. **Sample-3 pillar pages** (`/neofertility/`, `/endometriosis/`) missing `Speakable` selector for first H2 section paragraph — only h1 + `.pillar-lead` declared. Single-sentence speakable answer is thin.
29. **No `dateModified` on `WebPage` graph node** for `/`, `/library/`, `/commentary/`. Only `article:modified_time` meta. Add `dateModified` from `page-dates.json` for crawler freshness signal.
30. **`/api/community/upload` returns `{ url }` bare**, not the `{ ok: true, ... }` convention used by sibling endpoints. Caller still works via `.url` directly, but `.ok` is undefined.
31. **`survey/validate.js:21`** mixes semantics: `{ valid: false, reason: 'misconfigured' }` on 500 (server broken) collides with same shape used for invalid-token (client error). Split into `{ error: 'service_unavailable' }` for 500.
32. **CASE_CANONICAL_PREFIXES tests** could be expanded to cover `/library/*` cases (the only remaining prefix). Currently zero test coverage on that path now that schedule-with-dr-whittaker is gone.

**Process / methodology:**

33. **api-contract-surface-completeness invariant** — codify "if openapi.json `x-idempotency-policy.applies_to[]` lists a path, that path MUST have implementation + schema stub" as a `scripts/agent-discovery-check.mjs` invariant. Born from Batch D — the audit caught the drift this time; a guard would catch it the moment it appears.

### Homepage visuals: comparison diagram + commentary thumbnails

Homepage is intentionally text-heavy to match high-anxiety audience register (Michelle persona, OB/GYN comfort 1.1/5). Two visual additions worth considering when bandwidth allows:

1. **Designed comparison diagram** for the "Two Approaches. One Choice." section, replacing the side-by-side bullet list. Carries information (not decoration); preserves clinical register. Effort: medium (one branded SVG + a11y labels).
2. **Latest commentary thumbnails** in the existing "Research and Commentary" section. Reuses already-authentic RRM Academy cover art (no stock photos), breaks up lower-half text density, supports CTR to commentary cluster. Effort: low (template tweak; covers + slugs already in `posts.json`).

Skip: hero imagery, stock photography, lifestyle shots, icon-decorated bullet lists. Those undo the credibility text is currently doing.

OG image / Twitter card variant for social sharing is a separate, smaller task worth pairing.

### Endo Self-Survey: per-user Wix download attribution

The homepage displays `surveyCount = liveDistinct + sqspLegacyExact + wixLegacyEstimate`. Current values:
- `liveDistinct` -- D1 `survey_identities` (CF Pages era, exact)
- `sqspLegacyExact = 1,512` -- Squarespace CSV (exact)
- `wixLegacyEstimate = 3,347` -- Wix File Share view counter (3,719 views, 10% repeat-view discount as of 2026-05-06)

The Wix value is now measurement-based (PDF view counter on `Endometriosis Symptom Self-Survey.pdf`, file uploaded Apr 25, 2024), which replaces the prior derivation `5,983 Wix members - 200 non-survey - 1,512 Squarespace migrants = 4,271`. The view-counter basis is more direct than the member-count basis.

Open question for further refinement: per-user download attribution. The current Wix estimate cannot deduplicate against the Squarespace cohort (no email list per download event on Wix File Share). Some Squarespace migrants likely re-downloaded on Wix, which would inflate the combined `sqspLegacyExact + wixLegacyEstimate`. Without per-user attribution we cannot quantify the overlap.

Approach options:
- Wix Site API token (Wix Dashboard, Settings, Headless / API Keys, scope = Members Read) + GraphQL or REST member-activity query for downloads of the PDF asset
- Wix Velo backend HTTP function querying member badges, tags, or segments specifically associated with the PDF download flow
- Wix CSV member export filtered on the signup-source field, then deduplicated against the Squarespace CSV
- Increase the repeat-view discount above 10% if a sample of authenticated viewers shows higher repeat behavior

Once per-user attribution is in hand, recompute `WIX_LEGACY_ESTIMATE` (deduped against Squarespace) in `functions/api/survey/count.js`. Bootstrap JSON refreshes on next deploy via `scripts/fetch-survey-count`.

Effort: low-medium. Blocker: Wix API token availability + which member metadata field tagged PDF downloads at signup. See `~/iCode/projects/rrm-academy-wix/CLAUDE.md` for project context.

### Internal Linking (Quick Wins)

Full plan at `docs/plans/2026-03-10-internal-linking-plan.md`.

- **Commentary template: cross-section CTA block** -- add related courses, library filter links, and endo survey CTAs below "More from this series". Small effort, medium SEO impact
- ~~**Desktop nav: add About link**~~ DONE (2026-03-10)
- **Course template: background reading links** -- link to relevant library articles and commentary posts from course landing pages
- **Library template: commentary cross-links** -- surface related commentary posts on library article pages
- **Quick wins** -- add endo survey links from endo commentary posts, cross-link between related clusters
- **Commentary images: add `<picture>` with WebP** -- cover images are 120-260KB JPGs. WebP variants exist for some but aren't served. Add `<picture>` elements with WebP + JPG fallback and responsive `srcset`

### Email Marketing (Phase 4)

SES newsletter system built (self-hosted, replaces Buttondown). Newsletter signup deployed in footer with Turnstile. RSS feed live at `/commentary/rss.xml`.

- ~~**Subscriber import from D1**~~ DONE (2026-03-10)
- ~~**RSS-to-email configuration**~~ DONE (2026-03-10)
- **Domain warmup** -- graduated send schedule: Brian+Naomi only (days 1-3), engaged users (days 4-7), all students (days 8-14), full list (days 15+). Monitor bounce rate <2%, spam rate <0.1%
- ~~**Privacy policy update**~~ DONE -- named Stripe, Amazon SES, and Cloudflare as processors (2026-03-10)
- **DMARC tightening** -- upgrade from `p=none` to `p=quarantine` after 2-4 weeks of clean sends
- ~~**CAN-SPAM physical address**~~ DONE (2026-05-06) -- 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011 wired into `functions/api/newsletter/_template.js`

### ~~Site IA: "Learn" Nav + `/guides/` Index~~ DONE (2026-03-15)

All structural items complete: `/guides/index.astro` exists, Header has "Learn" dropdown, `/guides` in router ASTRO_ROUTES. Keeping future guide ideas below.

- ~~Create `/guides/` index page~~ DONE
- ~~Update Header.astro nav: Learn dropdown~~ DONE
- ~~Add `/guides` to router ASTRO_ROUTES~~ DONE
- **Planned guides** (content, not structural): mental health (STUC members), 9 Facts About NaPro, endo guide, PCOS guide
- **`/rrm-success-rates/` pillar page** -- ON BRANCH `feat/rrm-success-rates`. Build passes, 8 commits. Voice needs another pass (more direct Gianna tone). Then merge to main + add to router ASTRO_ROUTES. Spec: `docs/superpowers/specs/2026-03-26-rrm-success-rates-pillar-design.md`. Also update cross-links from `/what-is-rrm/#evidence`, `/naprotechnology/`, `/faqs/is-rrm-evidence-based`

### AEO (Answer Engine Optimization)

Full plan in `rrm-router/RRM Router PRD/PRD-Index.md` Post-Launch Roadmap.

- **Layer 1: Answer Intent Map** -- run 50+ queries across ChatGPT/Perplexity/Claude/Gemini, log who gets recommended. Baseline scan done (6/80, 7.5%). Repeat monthly.
- **Layer 2: Answer Hubs** -- pillar guides at root (`/endometriosis/`, `/pcos/`, etc.) with TL;DR blocks, ranked resources, comparison tables, FAQ sections. Listed on `/guides/` index
- **Layer 3: Brand-Facts page** -- `/brand-facts` with Wikipedia-style org facts, EIN, credentials
- **Layer 4: Machine-readable brand data** -- `public/.well-known/brand-facts.json`
- ~~**Layer 5: Schema markup audit**~~ DONE -- all major types implemented (MedicalScholarlyArticle, BlogPosting, FAQPage, Course, ItemList, DefinedTermSet, Organization, Person)
- **Layer 6: Third-party citation building** -- ~~Wikidata entries~~ IN PROGRESS (spec + plan at `~/iCode/docs/superpowers/specs/2026-03-25-wikidata-rrm-entries-design.md` and `~/iCode/docs/superpowers/plans/2026-03-25-wikidata-rrm-entries.md`). Fix NaPro Q23815908 classification + create RRM item. ~14 day execution. Press page, resource directory outreach, Reddit engagement still pending

### Domain Authority (CITE Audit 2026-03-26)

CITE Score: **44/100 (Low)**. C: 50, I: 25, T: 60, E: 30. Full audit output in session. Priority order: entity establishment > external link building > AI citation optimization > SERP features.

**Quick wins (< 1 week):**
- [ ] Add FAQ schema to all pillar pages (targets SERP features + AI citations)
- [ ] Ensure all pillar page lead statements are bold, complete, with "RRM Academy" as subject
- [ ] Add `sameAs` links to Organization schema for all social profiles

**Medium effort (1-4 weeks):**
- [ ] Create Wikidata entity for "Restorative Reproductive Medicine" (already planned in Layer 6)
- [ ] Guest commentary in AAFP or similar medical education publication
- [ ] Pitch Dr. Whittaker for 2-3 medical education podcasts beyond niche

**Strategic (1-3 months):**
- [ ] Earn .edu backlinks by offering CME content to medical school libraries
- [ ] Build LinkedIn Organization page with regular posting
- [ ] Pursue coverage in Catholic health media (OSV, NCR) and women's health publications
- [ ] Reciprocal citation strategy with FEMM, FertilityCare, Marquette Method orgs
- [ ] Fix backlink profile: 8/10 top referring domains are owned properties -- need editorial links

### Community

- **Member transition email** -- draft and send welcome email to existing members explaining the new platform
- **Meet recording pipeline** -- design doc at `docs/plans/2026-02-25-meet-recording-pipeline-design.md`. Auto-upload STUC live call recordings to community.
- ~~**Members + Masterclass archive import**~~ DONE

---

## Queued

### Glossary as Internal-Link Hub

Plan at `docs/plans/2026-05-03-glossary-as-internal-link-hub.md`.

Invert the current pattern. Today some content (incl. course descriptions, now stripped) inlines `[term](/glossary/#<slug>)` links. The hub model puts the link list ON each glossary term: a "Discussed in" block per term with related courses, commentary, library articles, FAQs. Course descriptions stay clean (only related-course links allowed). Schema add: `glossary_term_link` join table in rrm-auth. Authoring via extended `/glossary-update` skill.

### Page Templatization

Full spec at `docs/superpowers/specs/2026-03-21-page-templatization-design.md`. Plan at `docs/plans/2026-03-21-page-templatization-plan.md`.

15 intermediate Astro layouts (PillarLayout, AuthLayout, LegalLayout, etc.) to eliminate per-page SEO drift. 61-check CI proof gate (`verify-seo.mjs`) with 5 tiers: universal SEO (22), type-specific schema (18), AEO/GEO signals (12, pillar + FAQ only), asset integrity (5), site-level (4). Non-blocking initially, blocking for new pages later. Incremental migration with mobile-first Playwright baseline snapshots (375/768/1280px). Commentary excluded from AEO/GEO (personal voice). Provider directory layouts deferred.

### Admin Content Dashboard Backend

The `/admin/content/` page exists but has no API endpoint (`/api/admin/content`). Needs a backend that queries CF Analytics Engine (or CF Web Analytics API) for page views, sessions, referrers, content category breakdown, and avg duration. The frontend is already built and expects a specific response shape.

### ~~Zotero Two-Way Sync~~ CUT (2026-03-15)

Removed. OAuth 1.0a complexity for a niche feature. RIS export exists as fallback. Revisit only if users request it.

### GA4 Source Attribution

Full plan at `docs/plans/2026-03-09-ga4-source-attribution-plan.md` (6 file changes, test coverage defined).

### Google Ad Grants Resubmission

Plan ready at `docs/plans/2026-03-09-google-ad-grants-plan.md`. Waiting on ~1 month GSC stabilization after CF migration. Target: mid-April.

### ~~Programmatic OG Images~~ DONE (2026-03-13)

- **COMPLETE.** 49 build-time OG images (24 static + 25 FAQs) via Satori + resvg. Convention-based resolution in BaseLayout. Spec: `docs/superpowers/specs/2026-03-13-programmatic-og-images-design.md`

### Performance Optimization

- **COMPLETE.** Removed `articles.json` from `public/data/` (12MB publicly served). Deleted CI copy step from deploy.yml. Build-time copy at `src/data/` is unaffected.
- ~~**Dark mode body filter scroll jank**~~ CUT (2026-03-15) -- partially mitigated, edge case. Not worth the effort.

### Content Refinement

- **Refine IVF comparison stats** -- updated with HFEA 2022 data (commit `1dc3579`). Two RRM stats still have `[CITE]` markers needing source citations. Review the comparison table for accuracy and completeness.
- **Draft FAQ approval** -- 37 draft Condition-Specific FAQs pending Naomi's review. 6 high-priority for AEO (see PRD Post-Launch Roadmap). 3 missing FAQs need creation: "What is NaProTechnology?", "Best resources for endo patients?", "What is reproductive restoration medicine?" (Blocked on Naomi)
- **Extract FEMM facts from tagged D1 articles** -- `femm` entity scaffolded at `docs/fact-check/femm-canonical-facts.json` with 21 curator_overrides. 27 D1 articles now tagged `'femm'` in `articles.traditions` (Vigil 1st-author + Blackwell/Brown/Vigil Ovarian Monitor lineage + Contreras/Vigil insulin/PCOS + Del-Rio/Vigil RHRI neurobiology). Builder reads `facts.tradition`, not `articles.traditions`, so `record_count: 0` until `/fact-extraction` runs on the tagged articles (rrm_relevance >= 3) and promoted facts inherit `tradition = ["femm"]`. Then rerun `node scripts/build-canonical-facts.mjs --entity femm` to populate the `facts: []` array.

### Pillar Page Section Refinement Backlog

Use `/pillar-edit` skill. Create comparison file, Brian reviews, then apply.

**~~`/what-is-rrm/` -- COMPLETE (13/13 done)~~**

All sections refined across 4 rounds. See memory `pillar-page-refinement-status.md` for commit references.

**`/naprotechnology/` -- 10 sections, none refined yet. Gianna recon complete 2026-03-13:**

| # | Section | Priority | Issues (from Gianna recon) |
|---|---------|----------|---------------------------|
| 1 | Key Takeaways | Low (do last) | 62% -> 62.1% stat fix; "standard insurance codes" overstates coverage; CTA doesn't belong in takeaways; Yeung citation needs verification |
| 2 | What is NaProTechnology? | Medium | H3s need question format for AEO; "physicians" -> "clinicians"; cut "extensively published" (redundant); trim FEMM/NeoFertility enumeration once /what-is-rrm/ link is live |
| 3 | How NaProTechnology Works | Medium | 3 noun-phrase H3s need question format; "physicians" -> "clinicians"; dense list-sentence at L272 hurts AEO; Peak+3/+5/+7/+9/+11 enumeration is prescriptive (soften to "multiple post-peak days") |
| 4 | Conditions NaPro Treats | Medium | "ten years" -> "nine years" (verified stat); H3s need question format NaPro-attributed; "NaPro reframes" -> "In NaPro practice"; endo stats overlap with /what-is-rrm/ (link, don't duplicate); table not AEO-friendly |
| 5 | NaPro Surgery | Medium | Prescriptive surgical detail (micro-suturing, non-reactive materials) -> framework level; "fertility preservation" framing is fertility-only (broaden); Yeung stat should lead with number for AEO; citation needs verification |
| 6 | Who is NaPro For? | Medium | "suppressed or bypassed" is RRM framing leaking into NaPro; "that deserve" -> "who want"; H3 "NaPro After Failed IVF" needs question format; "RRM Academy supports..." pivots away from NaPro; "RRM achieved" -> "NaProTechnology achieved" |
| 7 | NaPro vs IVF | **HIGH** | ~~"When IVF May Be Appropriate" REMOVED (bb63f3e).~~ Rest of section still needs review: cost table anchor framing, voice alignment |
| 8 | How to Find a NaPro Provider | **HIGH** | Reads like reference doc, not Whittaker voice; no emotional acknowledgment (VOC: surgeon confidence 2.3/5); asking-questions list needs answer calibration; Natural Womanhood directory has weak NaPro signal; FCCA PDF link will break; IIRRM equivalence claim needs verification; no scarcity/telehealth/wait-time handling |
| 9 | Cost and Insurance | **HIGH** | CPT-code billing logic overstates coverage ease (insurance complexity rule); "often covered" sets wrong expectation; "broader field that includes NaProTechnology" violates NaPro/RRM distinction; H3 needs softening |
| 10 | FAQ | Medium | 4 of 5 answers below 80w schemaAnswer target; overlap with /what-is-rrm/ FAQ and faqs.json needs audit; "cause-directed" -> "cause-based" |

**Cross-cutting themes (apply to all sections):**
- "physicians" -> "clinicians" site-wide on NaPro page
- Noun-phrase H3s -> question format for AEO throughout
- RRM framing vocabulary ("suppressed or bypassed", "root cause") leaking into NaPro-specific content
- Several stats need citation verification against the library (Yeung, endo diagnosis delay)

---

## Operations

- ~~**Delete temporary CF API token** (`3h-YUCih...`)~~ DONE (verified deleted 2026-05-06; not in active token list)
- **Verify CF Stream delivery minutes** -- storage clean at 624/1000 min (62%, 93 videos, no overage as of 2026-05-06). Delivery-minutes confirmation requires `Account Analytics:Read` perm or 30s CF dashboard check (Stream > Analytics). Once confirmed within 10,000 min/mo cap, update `~/iCode/projects/rrm-academy-internal/plans/2026-03-03-migration-cost-savings-analysis.md` line 20 (replace `~$0-10 (TBD)` with actual)
- **Migration cost/savings analysis update** -- doc moved to satellite repo at `~/iCode/projects/rrm-academy-internal/plans/2026-03-03-migration-cost-savings-analysis.md` (commit 725fab1). Last updated 2026-03-03, stale by 9wk. Wix Plus 2yr term lapsed ~Apr 30, 2026 -- Phase 9 Decommission not yet started (rrm-finance-sync still pulling from Wix every 15min, STUC donor migration UX in-flight on `claude/stuc-wix-donor-ux`). Cost line items needing update: Resend paid plan ($20/mo) was downgraded to free tier when rrm-academy-cf moved transactional email to AWS SES -- account retained on free plan for femtech-reviews-mvp signup emails (still active, $0/mo). Buttondown ($4.50/mo) replaced by self-hosted newsletter -- verify cancellation. Net saving likely ~$385/mo / $4,620/yr (up from $361.50 listed) once Buttondown confirmed cancelled. Action: confirm Buttondown cancelled, verify Wix Plus actually lapsed, update doc with Resend free-tier status + actual realized savings

### /arise Recommendations

- ~~**Input validation -- arise-scanner rule**~~ DONE (2026-05-06) -- `missing-validation` rule shipped in arise-scanner v0.7+. Flags `await request.json()` (or `await context.request.json()`) in any function that lacks both `validateBody()` and `typeof` guards. Zero current findings across 125 scanned endpoints -- every endpoint already validates inline or via the helper. Catches genuinely un-validated input on new endpoints.
- **Optional: validateBody() consistency sweep** -- helper at `functions/api/_validate.js` adopted by 8 endpoints (~15%). The other ~42 hand-roll `typeof + length` checks inline (e.g. `community/posts.js` has 14 inline guards). Migration would standardize error shapes, auto-strip unknown fields, normalize emails. NOT a bug fix -- inline checks are functionally correct. Lower priority than originally framed; do opportunistically when touching endpoints, not as a one-shot sweep.
- ~~**Turnstile resp.ok checks**~~ DONE -- HTTP status checks added to both `newsletter/subscribe.js` and `contact/submit.js` (2026-03-10)
- ~~**Remaining alias cleanup in rrm-library scripts**~~ DONE -- enrich-trigger.py and verify-classifications.py migrated to `airtable_headers()` (2026-03-10)

---

## Waiting On (Blocked)

| Item | Blocker | Since |
|------|---------|-------|
| 37 draft Condition-Specific FAQs | Naomi review | 2026-03 |
| IVF calculator production data | Needs verified HFEA figures replacing placeholders | 2026-03 |

---

## Phase 9: Wix Decommission (Start mid-April)

Not started. See `rrm-router/RRM Router PRD/Phase-9-Decommission.md`.

- Export remaining Wix data (email subscribers if not already captured)
- 30-day soak period monitoring for zero proxied requests
- Remove Wix SPF include and DKIM CNAMEs from DNS
- Cancel Wix Premium

---

## Design Decisions

- **CTA buttons stay Purple 700 everywhere**: "Support this work" on library synopsis pages, "Donate", course enrollment, etc. -- all CTAs use `btn--primary` (Purple 700 `#725e7e`). Rose/pink palette is for accents and backgrounds only, never action buttons. Keeps brand consistency across the site.
- **Button sizing on lesson pages uses default `.btn`**: Mark Complete, Previous/Next, and Post all use the base `.btn` size (10px/24px). No `btn--sm` or `btn--lg` variations within the lesson player.
- **Course pages use `must-revalidate` cache**: `/courses/*` gets `Cache-Control: public, max-age=0, must-revalidate`. All `/api/*` routes get `no-store`.
- **STUC Stripe Checkout button says "Subscribe" not "Donate"**: Stripe only allows `submit_type: 'donate'` on `mode: 'payment'` sessions. Subscription sessions hardcode the button to "Subscribe". Changing this would require migrating from Stripe Checkout to Stripe Elements -- not worth it.

---

## Done (Recent)

- Site IA: `/guides/` index page, Header "Learn" dropdown, router ASTRO_ROUTES -- all structural items complete (2026-03-15)
- `/what-is-rrm/` pillar refinement -- 13/13 sections across 4 rounds (2026-03-14)
- NaPro S7 "When IVF May Be Appropriate" -- hard rule violation removed (bb63f3e, 2026-03-13)
- AEO Layer 5: Schema markup -- all major types implemented across all content templates (2026-03-10)
- `_headers` file for static asset caching -- immutable hashed assets, tiered caching for pagefind/images/OG (2026-03-10)
- FAQ cross-links to library articles -- `libraryRefs` section in FAQ detail template (2026-03-10)
- Stripe-before-account flow -- `ensureAccountForCheckout()` in webhook handler auto-creates accounts on paid checkout (2026-03-10)
- Survey pseudonymization -- D1 `rrm-survey` binding splits PII from health data, migration script run (2026-03-09)
- Stripe webhook decomposition -- modular handlers: `_webhook-checkout.js`, `_webhook-subscription.js`, `_webhook-invoice.js`, `_webhook-shared.js` (2026-03-08)
- Observatory Worker (Layer 2 observability) deployed -- queries AE across all Workers, 3 alert conditions, daily 8 AM ET digest + weekly Monday observation to Telegram (2026-03-10)
- STUC pre-launch features shipped -- flagging, banning, comment editing, email notifications, COMMUNITY_KV binding for 15-min cooldown (2026-03-06)
- Vimeo subscription cancelled (2026-03-06)
- Search result type badges (done)
- Page-specific OG images for homepage, courses, commentary, about (2026-03-10)
- GA4 server-side analytics (done / CF Zone Analytics sufficient)
- Edge caching flip (done)
- FAQ category rename review (done)
- Library pipeline switched to yellowbase (`app78UTVdeFph9qhL`, `⚡️ Synced Literature` table) (2026-03-01)
- Added AI enrichment fields to library pipeline (2026-03-01)
- Airtable publish automation wired (2026-03-01)
- Deploy concurrency guard (2026-03-01)
- Mobile tier card formatting, nav fixes, search icon, clickable cards, dark mode fixes (2026-02-28)
- One-time donation fix, production canary, security guard Phase 3, deploy cache fix (2026-02-27)
- Stripe checkout fix, contact form fix, quiz data restore, STUC cutover cleanup (2026-02-27)
- Grandfather Wix STUC members, community nav cutover, next lesson locking, build-time security guard (2026-02-26)
- Endo survey validate endpoint, auto-create accounts on checkout, thank-you page 3-state logic (2026-02-26)
- Login passwordless differentiation, donation history, profile card, Google OAuth fix (2026-02-26)
- Community inline images, inline feed, saved articles sync, quiz responses, dead code cleanup (2026-02-25)

<!-- merge.yml pipeline canary: 2026-06-22 -- validates the hardened auto-merge path (PR #42). Safe to remove. -->
