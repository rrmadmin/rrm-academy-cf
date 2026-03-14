# RRM Academy -- Backlog

> Living document. Check before starting any session. This is the SINGLE consolidated task list for all RRM Academy work.

## Priority

### Internal Linking (Quick Wins)

Full plan at `docs/plans/2026-03-10-internal-linking-plan.md`.

- **Commentary template: cross-section CTA block** -- add related courses, library filter links, and endo survey CTAs below "More from this series". Small effort, medium SEO impact
- ~~**Desktop nav: add About link**~~ DONE (2026-03-10)
- **Course template: background reading links** -- link to relevant library articles and commentary posts from course landing pages
- **Library template: commentary cross-links** -- surface related commentary posts on library article pages
- **Quick wins** -- add endo survey links from endo commentary posts, cross-link between related clusters

### Email Marketing (Phase 4)

SES newsletter system built (self-hosted, replaces Buttondown). Newsletter signup deployed in footer with Turnstile. RSS feed live at `/commentary/rss.xml`.

- ~~**Subscriber import from D1**~~ DONE (2026-03-10)
- ~~**RSS-to-email configuration**~~ DONE (2026-03-10)
- **Domain warmup** -- graduated send schedule: Brian+Naomi only (days 1-3), engaged users (days 4-7), all students (days 8-14), full list (days 15+). Monitor bounce rate <2%, spam rate <0.1%
- ~~**Privacy policy update**~~ DONE -- named Stripe, Amazon SES, and Cloudflare as processors (2026-03-10)
- **Stale Mailchimp DKIM cleanup** -- `k2._domainkey` and `k3._domainkey` pointing to `mcsv.net`, likely orphaned. Ask Brian if these can be deleted.
- **DMARC tightening** -- upgrade from `p=none` to `p=quarantine` after 2-4 weeks of clean sends
- **CAN-SPAM physical address** -- get RRM Foundation mailing address from Brian for email footer

### Site IA: "Learn" Nav + `/guides/` Index

**Decision (2026-03-12):** Flat URL structure for SEO authority. Nav dropdown for UX grouping. No nesting pillar pages under parent paths.

**Nav (3 items, down from 4):** Research Library, Commentary, **Learn** (dropdown: Guides, FAQs, Courses)

**URL architecture (no changes to existing URLs):**
- Pillar pages stay at root: `/naprotechnology/`, `/what-is-rrm/`, `/common-questions-about-rrm`
- Future pillar pages also at root: `/endometriosis/`, `/pcos/`, etc.
- `/guides/` -- new index page listing all pillar guides (browse page, not URL parent)
- `/faqs/` -- unchanged
- `/courses/` -- unchanged
- Short URLs (e.g. `/napro` -> `/naprotechnology/`) via router 301s

**TODO:**
- [ ] Create `/guides/` index page (list + link to all pillar guides)
- [ ] Update Header.astro nav: replace Courses + Join Us with Learn dropdown
- [ ] Add `/guides` to router ASTRO_ROUTES
- [ ] Planned guides: mental health (STUC members), 9 Facts About NaPro, endo guide, PCOS guide

### AEO (Answer Engine Optimization)

Full plan in `rrm-router/RRM Router PRD/PRD-Index.md` Post-Launch Roadmap.

- **Layer 1: Answer Intent Map** -- run 50+ queries across ChatGPT/Perplexity/Claude/Gemini, log who gets recommended. Baseline scan done (4/80, 5%). Repeat monthly.
- **Layer 2: Answer Hubs** -- pillar guides at root (`/endometriosis/`, `/pcos/`, etc.) with TL;DR blocks, ranked resources, comparison tables, FAQ sections. Listed on `/guides/` index
- **Layer 3: Brand-Facts page** -- `/brand-facts` with Wikipedia-style org facts, EIN, credentials
- **Layer 4: Machine-readable brand data** -- `public/.well-known/brand-facts.json`
- ~~**Layer 5: Schema markup audit**~~ DONE -- all major types implemented (MedicalScholarlyArticle, BlogPosting, FAQPage, Course, ItemList, DefinedTermSet, Organization, Person)
- **Layer 6: Third-party citation building** -- Wikidata page, press page, resource directory outreach, Reddit engagement

### Community

- **Member transition email** -- draft and send welcome email to existing members explaining the new platform
- **Meet recording pipeline** -- design doc at `docs/plans/2026-02-25-meet-recording-pipeline-design.md`. Auto-upload STUC live call recordings to community.
- **Members + Masterclass archive import** -- ~197 Members posts + ~18 Masterclass posts not yet scraped. Blocked on Brian scraping via Claude in Chrome. Lower priority than transition email.

---

## Queued

### Admin Content Dashboard Backend

The `/admin/content/` page exists but has no API endpoint (`/api/admin/content`). Needs a backend that queries CF Analytics Engine (or CF Web Analytics API) for page views, sessions, referrers, content category breakdown, and avg duration. The frontend is already built and expects a specific response shape.

### Zotero Two-Way Sync

Full bidirectional sync between `/library/saved` and a user's Zotero library. Zotero uses OAuth 1.0a (not 2.0). Users connect once via "Connect Zotero" on saved articles page, then saves/unsaves push to their Zotero collection automatically. Requires: OAuth 1.0a handshake, Zotero API item creation/deletion, metadata mapping (article data to Zotero item schema), connection status UI, conflict handling. RIS export already exists as the non-API fallback.

### GA4 Source Attribution

Full plan at `docs/plans/2026-03-09-ga4-source-attribution-plan.md` (6 file changes, test coverage defined).

### Google Ad Grants Resubmission

Plan ready at `docs/plans/2026-03-09-google-ad-grants-plan.md`. Waiting on ~1 month GSC stabilization after CF migration. Target: mid-April.

### ~~Programmatic OG Images~~ DONE (2026-03-13)

- **COMPLETE.** 49 build-time OG images (24 static + 25 FAQs) via Satori + resvg. Convention-based resolution in BaseLayout. Spec: `docs/superpowers/specs/2026-03-13-programmatic-og-images-design.md`

### Performance Optimization

- **Remove `articles.json` from `public/data/`** -- 12MB file still publicly served at `/data/articles.json`. Only needed at build time (already in `src/data/`). If Pagefind needs it at runtime, gate behind long cache headers instead.
- **Dark mode body filter scroll jank** -- partially mitigated (fixed positioning + pointer-events:none on grain overlay), but filter still on body element. Full fix: move filter to content containers, disable grain on mobile via `@media`.
- **Commentary images: add `<picture>` with WebP** -- cover images are 120-260KB JPGs. WebP variants exist for some but aren't served. Add `<picture>` elements with WebP + JPG fallback and responsive `srcset`.

### Content Refinement

- **Refine IVF comparison stats** -- updated with HFEA 2022 data (commit `1dc3579`). Two RRM stats still have `[CITE]` markers needing source citations. Review the comparison table for accuracy and completeness.
- **Draft FAQ approval** -- 37 draft Condition-Specific FAQs pending Naomi's review. 6 high-priority for AEO (see PRD Post-Launch Roadmap). 3 missing FAQs need creation: "What is NaProTechnology?", "Best resources for endo patients?", "What is reproductive restoration medicine?" (Blocked on Naomi)

### Pillar Page Section Refinement Backlog

Use `/pillar-edit` skill. Create comparison file, Brian reviews, then apply.

**`/what-is-rrm/` -- 5 sections remaining (8 of 13 done 2026-03-13):**

| # | Section | id | Status | Notes |
|---|---------|-----|--------|-------|
| 1 | Key Takeaways | `key-takeaways` | Not started | Update after all other sections stabilize |
| 2 | What Is RRM? | `what-is-rrm` | DONE | AEO-optimized, round 2 (2026-03-13) |
| 3 | History | `history` | DONE | Added Odeblad, CCL, Stanford, round 2 (2026-03-13) |
| 4 | Diagnosis | `diagnosis` | DONE | Rewritten in round 1 (2026-03-13, bc447e3) |
| 5 | FABMs | `fabms` | DONE | AEO-optimized, round 2 (2026-03-13) |
| 6 | Conditions | `conditions` | DONE | Question-format H3s, framework-level, round 2 (2026-03-13) |
| 7 | RRM vs IVF | `rrm-vs-ivf` | DONE | Rewritten in round 1 (2026-03-13, bc447e3). Has charts |
| 8 | Evidence | `evidence` | Not started | Longest section on page. May need restructure |
| 9 | Patient Journey | `patient-journey` | DONE | Rewritten in round 1 (2026-03-13, bc447e3) |
| 10 | Cost & Insurance | `cost-insurance` | DONE | Rewritten in round 1, honest insurance framing (2026-03-13, bc447e3) |
| 11 | Training | `training` | Not started | Provider-facing, may be fine |
| 12 | Common Myths | `myths` | Not started | Check overlap with revised section 2 |
| 13 | FAQ | `faq` | Not started | Schema-critical, check schemaAnswer expansion |

**`/naprotechnology/` -- 10 sections, none refined yet. Gianna recon complete 2026-03-13:**

| # | Section | Priority | Issues (from Gianna recon) |
|---|---------|----------|---------------------------|
| 1 | Key Takeaways | Low (do last) | 62% -> 62.1% stat fix; "standard insurance codes" overstates coverage; CTA doesn't belong in takeaways; Yeung citation needs verification |
| 2 | What is NaProTechnology? | Medium | H3s need question format for AEO; "physicians" -> "clinicians"; cut "extensively published" (redundant); trim FEMM/NeoFertility enumeration once /what-is-rrm/ link is live |
| 3 | How NaProTechnology Works | Medium | 3 noun-phrase H3s need question format; "physicians" -> "clinicians"; dense list-sentence at L272 hurts AEO; Peak+3/+5/+7/+9/+11 enumeration is prescriptive (soften to "multiple post-peak days") |
| 4 | Conditions NaPro Treats | Medium | "ten years" -> "nine years" (verified stat); H3s need question format NaPro-attributed; "NaPro reframes" -> "In NaPro practice"; endo stats overlap with /what-is-rrm/ (link, don't duplicate); table not AEO-friendly |
| 5 | NaPro Surgery | Medium | Prescriptive surgical detail (micro-suturing, non-reactive materials) -> framework level; "fertility preservation" framing is fertility-only (broaden); Yeung stat should lead with number for AEO; citation needs verification |
| 6 | Who is NaPro For? | Medium | "suppressed or bypassed" is RRM framing leaking into NaPro; "that deserve" -> "who want"; H3 "NaPro After Failed IVF" needs question format; "RRM Academy supports..." pivots away from NaPro; "RRM achieved" -> "NaProTechnology achieved" |
| 7 | NaPro vs IVF | **HIGH** | **HARD RULE VIOLATION: "When IVF May Be Appropriate" section explicitly recommends IVF. Must be removed or reframed.** Cost table anchor framing needs review |
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

- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key -- no longer needed
- **Verify CF Stream first billing cycle** (due ~Mar 22, 2026) -- confirm variable usage stays within included 10,000 min/mo allocation; update `docs/plans/2026-03-03-migration-cost-savings-analysis.md`
- **Migration cost/savings analysis** -- full before/after breakdown at `docs/plans/2026-03-03-migration-cost-savings-analysis.md`. Net saving: $361.50/mo / $4,338/yr. Update after Apr 2026 when Wix Plus lapses.

### /arise Recommendations (from run 14 intelligence report)

- **Input validation standardization** -- Create a shared `validateBody()` helper or lightweight schema validation for CF Pages Functions. Input validation is the only top-5 bug category (11% of all findings) without a structural fix. Every new endpoint re-invents type/length/range checks.
- ~~**Turnstile resp.ok checks**~~ DONE -- HTTP status checks added to both `newsletter/subscribe.js` and `contact/submit.js` (2026-03-10)
- ~~**Remaining alias cleanup in rrm-library scripts**~~ DONE -- enrich-trigger.py and verify-classifications.py migrated to `airtable_headers()` (2026-03-10)

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
