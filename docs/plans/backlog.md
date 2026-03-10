# RRM Academy — Backlog

> Living document. Check before starting any session. This is the SINGLE consolidated task list for all RRM Academy work.

## Priority

### Email Marketing (Phase 4)

Buttondown selected ($4.50/mo nonprofit). Sending domain verified. Newsletter signup shell deployed.

- **Subscriber import from D1** -- export non-spam, non-blocked users with segmentation tags (donor, student, STUC member). Import via Buttondown API in batches, suppress welcome emails.
- **RSS-to-email configuration** -- connect `https://rrmacademy.org/commentary/rss.xml` to Buttondown's RSS-to-email feature, design email template with RRM branding
- **Domain warmup** -- graduated send schedule: Brian+Naomi only (days 1-3), engaged users (days 4-7), all students (days 8-14), full list (days 15+). Monitor bounce rate <2%, spam rate <0.1%
- **Privacy policy update** -- reference Buttondown as email marketing processor
- **Stale Mailchimp DKIM cleanup** -- `k2._domainkey` and `k3._domainkey` pointing to `mcsv.net`, likely orphaned. Ask Brian if these can be deleted.
- **DMARC tightening** -- upgrade from `p=none` to `p=quarantine` after 2-4 weeks of clean sends
- **CAN-SPAM physical address** -- get RRM Foundation mailing address from Brian for email footer

### AEO (Answer Engine Optimization)

Full plan in `rrm-router/RRM Router PRD/PRD-Index.md` Post-Launch Roadmap.

- **Layer 1: Answer Intent Map** -- run 50+ queries across ChatGPT/Perplexity/Claude/Gemini, log who gets recommended. Baseline scan done (4/80, 5%). Repeat monthly.
- **Layer 2: Answer Hubs** -- create `/guides/endometriosis-resources`, `/guides/pcos-resources`, `/guides/naprotechnology` with TL;DR blocks, ranked resources, comparison tables, FAQ sections
- **Layer 3: Brand-Facts page** -- `/brand-facts` with Wikipedia-style org facts, EIN, credentials
- **Layer 4: Machine-readable brand data** -- `public/.well-known/brand-facts.json`
- **Layer 5: Schema markup audit** -- verify `ScholarlyArticle`, add `Organization`, `ItemList` on hubs
- **Layer 6: Third-party citation building** -- Wikidata page, press page, resource directory outreach, Reddit engagement

### Community

- **Member transition email** -- draft and send welcome email to existing members explaining the new platform
- **Meet recording pipeline** -- design doc at `docs/plans/2026-02-25-meet-recording-pipeline-design.md`. Auto-upload STUC live call recordings to community.
- **Members + Masterclass archive import** -- ~197 Members posts + ~18 Masterclass posts not yet scraped. Blocked on Brian scraping via Claude in Chrome. Lower priority than transition email.

---

## Queued

### Payments & Enrollment

- **Course purchase flow: Stripe before account creation** -- paid courses should go directly to Stripe Checkout on "Purchase Course" click, with account creation happening via webhook after payment completes. Free courses still require account first. Needs webhook handler to create user from Stripe customer email, auto-enroll, and send "set your password" email.

### Content Refinement

- **Refine IVF comparison stats** -- updated with HFEA 2022 data (commit `1dc3579`). Two RRM stats still have `[CITE]` markers needing source citations. Review the comparison table for accuracy and completeness.
- **Link FAQ questions to library articles** -- FAQ detail pages should cross-reference relevant research articles in the RRM Library via direct links to `/library/[slug]`. Improves UX and internal linking for SEO.
- **Draft FAQ approval** -- 37 draft Condition-Specific FAQs pending Naomi's review. 6 high-priority for AEO (see PRD Post-Launch Roadmap). 3 missing FAQs need creation: "What is NaProTechnology?", "Best resources for endo patients?", "What is reproductive restoration medicine?" (Blocked on Naomi)

---

## Operations

- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key -- no longer needed
- **Verify CF Stream first billing cycle** (due ~Mar 22, 2026) -- confirm variable usage stays within included 10,000 min/mo allocation; update `docs/plans/2026-03-03-migration-cost-savings-analysis.md`
- **Migration cost/savings analysis** -- full before/after breakdown at `docs/plans/2026-03-03-migration-cost-savings-analysis.md`. Net saving: $361.50/mo / $4,338/yr. Update after Apr 2026 when Wix Plus lapses.

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
