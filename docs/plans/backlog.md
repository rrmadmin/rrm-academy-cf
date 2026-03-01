# RRM Academy — Backlog

> Living document. Check before starting any session. This is the SINGLE consolidated task list for all RRM Academy work.

## Bugs

- ~~**CF Pages build cache corrupts function bundles**~~ -- RESOLVED. Root cause: GitHub Actions `actions/cache` for `src/data/` was overwriting committed `quizzes.json` with stale cached copy. Fix: deploy.yml now runs `git checkout HEAD` on committed data files after cache restore. CF Pages GitHub integration was already disconnected (source: none); all deploys go through GitHub Action.

---

## Phase 4: Email Marketing (IN PROGRESS)

Buttondown selected ($4.50/mo nonprofit). Sending domain verified. Newsletter signup shell deployed.

- **Subscriber import from D1** -- export non-spam, non-blocked users with segmentation tags (donor, student, STUC member). Import via Buttondown API in batches, suppress welcome emails. See `rrm-router/RRM Router PRD/phase-4-execution-prompt.md` for full details.
- **RSS-to-email configuration** -- connect `https://rrmacademy.org/commentary/rss.xml` to Buttondown's RSS-to-email feature, design email template with RRM branding
- **Domain warmup** -- graduated send schedule: Brian+Naomi only (days 1-3), engaged users (days 4-7), all students (days 8-14), full list (days 15+). Monitor bounce rate <2%, spam rate <0.1%
- **Privacy policy update** -- reference Buttondown as email marketing processor
- **Stale Mailchimp DKIM cleanup** -- `k2._domainkey` and `k3._domainkey` pointing to `mcsv.net`, likely orphaned. Ask Brian if these can be deleted.
- **DMARC tightening** -- upgrade from `p=none` to `p=quarantine` after 2-4 weeks of clean sends
- **CAN-SPAM physical address** -- get RRM Foundation mailing address from Brian for email footer

---

## Payments & Enrollment

- **Course purchase flow: Stripe before account creation** -- paid courses should go directly to Stripe Checkout on "Purchase Course" click, with account creation happening via webhook after payment completes. Free courses still require account first. Needs webhook handler to create user from Stripe customer email, auto-enroll, and send "set your password" email.

---

## Content Refinement

- **Refine FAQ category rename** -- "General" renamed to "Common Concerns" (commit `1dc3579`). Review the renamed category to ensure all FAQs are correctly categorized. May need additional categories or reordering.
- **Refine IVF comparison stats** -- updated with HFEA 2022 data (commit `1dc3579`). Two RRM stats still have `[CITE]` markers needing source citations. Review the comparison table for accuracy and completeness.
- **Link FAQ questions to library articles** -- new FAQ detail pages should cross-reference relevant research articles in the RRM Library via direct links to `/library/[slug]`. Improves UX and internal linking for SEO.
- **Draft FAQ approval** -- 37 draft Condition-Specific FAQs pending Naomi's review. 6 high-priority for AEO (see PRD Post-Launch Roadmap). 3 missing FAQs need creation: "What is NaProTechnology?", "Best resources for endo patients?", "What is reproductive restoration medicine?"

---

## Site Features

- **Search result type badges** -- visually differentiate result types in Pagefind search results using CSS badges. Add `data-pagefind-meta="type:research"` to library article pages, `type:faq` to FAQ pages, `type:commentary` to commentary pages. In `renderResult()`, read `data.meta.type` and inject badge elements styled per type.
- **GA4 server-side analytics** -- design docs at `docs/plans/2026-02-27-ga4-middleware-plan.md` and `docs/plans/2026-02-27-ga4-server-side-design.md`. Evaluate whether CF Zone Analytics is sufficient or GA4 is needed.
- **Meet recording pipeline** -- design doc at `docs/plans/2026-02-25-meet-recording-pipeline-design.md`. Auto-upload STUC live call recordings to community. Depends on STUC community tables.
- **Edge caching** -- flip `public/_headers` from `max-age=0, must-revalidate` to `max-age=300, stale-while-revalidate=3600` when development stabilizes. One-line change for sub-20ms TTFB.

---

## Community & Members

- **Members + Masterclass archive import** -- STUC posts imported (73 posts, 34 comments), but Members (~197 posts) and Masterclass (~18 posts) archives not yet scraped. Blocked on Brian scraping via Claude in Chrome.
- **Member transition email** -- draft and send welcome email to imported members explaining the new platform.

---

## Operations & Cleanup

- **Cancel Vimeo subscription** ($25/mo saved) -- Stream player confirmed working in production
- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key -- no longer needed

---

## AEO (Answer Engine Optimization)

Full plan in `rrm-router/RRM Router PRD/PRD-Index.md` Post-Launch Roadmap.

- **Layer 1: Answer Intent Map** -- run 50+ queries across ChatGPT/Perplexity/Claude/Gemini, log who gets recommended. Baseline scan done (4/80, 5%). Repeat monthly.
- **Layer 2: Answer Hubs** -- create `/guides/endometriosis-resources`, `/guides/pcos-resources`, `/guides/naprotechnology` with TL;DR blocks, ranked resources, comparison tables, FAQ sections
- **Layer 3: Brand-Facts page** -- `/brand-facts` with Wikipedia-style org facts, EIN, credentials
- **Layer 4: Machine-readable brand data** -- `public/.well-known/brand-facts.json`
- **Layer 5: Schema markup audit** -- verify `ScholarlyArticle`, add `Organization`, `ItemList` on hubs
- **Layer 6: Third-party citation building** -- Wikidata page, press page, resource directory outreach, Reddit engagement

---

## Phase 9: Wix Decommission

Not started. See `rrm-router/RRM Router PRD/Phase-9-Decommission.md`.

- Export remaining Wix data (email subscribers if not already captured)
- 30-day soak period monitoring for zero proxied requests
- Remove Wix SPF include and DKIM CNAMEs from DNS
- Cancel Wix Premium

## Design Decisions

- **CTA buttons stay Purple 700 everywhere**: "Support this work" on library synopsis pages, "Donate", course enrollment, etc. -- all CTAs use `btn--primary` (Purple 700 `#725e7e`). Rose/pink palette is for accents and backgrounds only, never action buttons. Keeps brand consistency across the site.
- **Button sizing on lesson pages uses default `.btn`**: Mark Complete, Previous/Next, and Post all use the base `.btn` size (10px/24px). No `btn--sm` or `btn--lg` variations within the lesson player.
- **Course pages use `must-revalidate` cache**: `/courses/*` gets `Cache-Control: public, max-age=0, must-revalidate`. All `/api/*` routes get `no-store`.
- **STUC Stripe Checkout button says "Subscribe" not "Donate"**: Stripe only allows `submit_type: 'donate'` on `mode: 'payment'` sessions. Subscription sessions hardcode the button to "Subscribe". Changing this would require migrating from Stripe Checkout to Stripe Elements — not worth it.

## Done (Recent)

- Library pipeline switched to yellowbase (`app78UTVdeFph9qhL`, `⚡️ Synced Literature` table) — updated `airtable-config.mjs`, `airtable.ts`, `fetch-data.mjs`. Filter: `{Sync to RRM Library}='Synced'`. All field names now `⚡️`-prefix. Re-enabled related articles algorithm (Topics + Search Terms now populated). (2026-03-01)
- Added AI enrichment fields to library pipeline: `⚡️ Sentiment (AI)`, `⚡️ RRM Relevance (AI)`, `⚡️ Domain (AI)`, `⚡️ Topics (AI)`, `⚡️ Search Terms (AI)` — all surfaced in Article interface and transform. (2026-03-01)
- Airtable publish automation wired — flipping `Sync to RRM Library` → `Synced` POST to `/api/library/deploy-record`, CF Worker authenticates via `X-Deploy-Secret`, fires GitHub `repository_dispatch` → full site rebuild. `DEPLOY_SECRET` + `GITHUB_DEPLOY_TOKEN` set in CF Pages production secrets. (2026-03-01)
- Deploy concurrency guard — `concurrency: group: deploy, cancel-in-progress: true` in `deploy.yml` prevents parallel rebuilds when multiple records are synced in quick succession. (2026-03-01)

- Mobile tier card formatting — centered content, reduced price size, full-width buttons, larger tier name (1.5rem) for clear visual hierarchy on `/donate/` and `/save-the-uterus-club/` pages (2026-02-28)
- Mobile nav tap-outside-to-close — tapping page content visible below/behind the open mobile nav panel now closes the nav, preventing inconsistent scroll-behind behavior across pages (2026-02-28)
- Mobile nav footer button positioning — removed bottom padding from `.main-nav` panel (`padding: var(--space-4) 0` → `var(--space-4) 0 0`) so footer buttons (My Account, Donate) sit closer to bottom edge instead of appearing too high (2026-02-28)
- Funding callout responsive — "Support this work" callout on synopsis pages stacks vertically and centers on mobile instead of awkward side-by-side wrap (2026-02-28)
- Synopsis topbar alignment — action buttons (share, cite, save) now sit on same line as breadcrumb on both mobile and desktop (removed breadcrumb margin inside topbar) (2026-02-28)
- Mobile search icon — added magnifying glass icon to mobile header bar (left of hamburger), links to `/library/` for quick search access from any page (2026-02-28)
- Clickable article cards — entire card surface is now clickable on `/library/` and `/library/page/` (CSS `::after` overlay on title link), title highlights on card hover (2026-02-28)
- My Account button style — mobile nav footer button changed from custom gray-border `.account-btn` to standard `btn btn--secondary` (purple border) for consistency (2026-02-28)
- Bookmark fill on save — saved article ribbon icon now fills solid purple instead of just changing stroke color (2026-02-28)
- Dark mode hero gradient — changed opaque dark purple `#2e2636` to semi-transparent `rgba(46,38,54,0.85)` so gradient glow is visible in dark mode (2026-02-28)
- Freetext textarea dark mode — added `background: var(--bg-surface)` and `color: var(--text-primary)` to `.ft-input` on course questionnaire pages (2026-02-28)
- Sync nudge hidden when logged in — `.sync-nudge[hidden] { display: none }` prevents CSS `display: flex` from overriding HTML `hidden` attribute on `/library/saved/` (2026-02-28)
- Mobile nav gap fixed — changed `top: 56px` to `top: 48px` to match actual header height (2026-02-28)
- Contrast fix on /library — `.section-label` changed from `var(--text-tertiary)` (~2.8:1) to `var(--text-secondary)` (~5.3:1) for WCAG AA compliance (2026-02-28)
- ARIA fix on homepage — added `role="img"` to NYT and WP trust logo spans to fix prohibited `aria-label` on generic elements (2026-02-28)
- CSP fix for Cloudflare analytics — added `https://static.cloudflareinsights.com` to `script-src` and `https://cloudflareinsights.com` to `connect-src` in `public/_headers` (2026-02-28)
- One-time donation fix for logged-in users — `customer_creation: 'always'` conflicted with `customer` param when user had existing Stripe customer ID; moved `customer_creation` to anonymous-only branch. Subscription checkout unaffected because it never set `customer_creation`. (2026-02-27)
- Production canary cron — `scripts/canary.mjs` tests 6 critical endpoints every 30 min (homepage, quiz API, survey validate, donation checkout, subscription checkout, contact form); emails administrator@ on failure, silent on success; Telegram ready pending chat ID (2026-02-27)
- Security guard Phase 3 — verifies 7 critical files exist + quizzes.json has content; runtime guard in create-checkout.js blocks test-mode price IDs with live key (2026-02-27)
- Deploy.yml cache fix — `git checkout HEAD` restores committed data files after `actions/cache` restore, preventing stale quizzes.json overwrites (2026-02-27)
- Stripe checkout fix — CF Pages STRIPE_PRICE_MEMBER/HERO/SUPERHERO secrets had test-mode price IDs; updated to live values, redeployed via direct deploy (2026-02-27)
- Contact form delivery fix — self-send (contact@ → contact@) silently dropped; changed to contact@ → administrator@rrmacademy.org; from display name shows submitter (2026-02-27)
- Quiz data restored via direct deploy — CF Pages build cache was bundling empty quiz arrays; `wrangler pages deploy dist` bypassed stale cache (2026-02-27)
- Resend API key resynced in CF Pages from 1Password (2026-02-27)
- STUC-CUTOVER cleanup — replaced all 5 Wix URLs with CF routes in stripe-webhook.js, thank-you page, linkinbio/jointhecall; removed legacy migration note (2026-02-27)
- Grandfather Wix STUC members — label-based bypass in `requireMember()` grants `member` tier to users with `Save the Uterus Club 🏷️` label, no Stripe check needed (2026-02-27)
- Community nav cutover — uncommented Community link in desktop nav, mobile nav, and footer (2026-02-26)
- Next Lesson button step locking — Next button now disabled in `fixedOrder` courses when current step is incomplete, unlocks on mark-complete / video end / quiz pass (2026-02-26)
- Build-time security guard — `scripts/guard.mjs` checks SHA256 hashes of critical files, enforces CORS/webhook/auth invariants, scans for secrets; runs as pre-commit hook + CI (2026-02-26)
- Endo survey validate endpoint — created missing `/api/survey/validate` that was blocking all survey takers ("expired" error on every magic link) (2026-02-26)
- Auto-create accounts on anonymous Stripe checkout — webhook `ensureAccountForCheckout()` creates D1 account with empty password, sends welcome email with 7-day password-setup link (2026-02-26)
- Checkout account endpoint — `/api/billing/checkout-account` lets thank-you pages detect auto-created accounts for 3-state messaging (2026-02-26)
- Thank-you page 3-state logic — donate + STUC thank-you pages show contextual message: linked (logged in), account created (check email), or create account (fallback) (2026-02-26)
- Login differentiates passwordless accounts — Google-only vs auto-created accounts get distinct error messages pointing users to the right login method (2026-02-26)
- Donation history on account page — billing API returns one-time donations + subscription payments, collapsible list shows most recent with "Show all" toggle (2026-02-26)
- `customer_creation: 'always'` on one-time donation checkout — forces Stripe to create Customer for anonymous donations so webhook can link them (2026-02-26)
- Two-column profile/password card + Member Since date on account page (2026-02-26)
- Google OAuth fix — set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` secrets, fixed redirect URI to use `SITE_URL` instead of `url.origin` (2026-02-26)
- CSS fix: donation row `hidden` attribute overridden by `display: grid` (2026-02-26)
- Library synopsis share button icon changed from Lucide 'link' to 'forward' (2026-02-26)
- Community inline images + bare domain URL detection — R2 upload endpoint, `linkify()` renders `![alt](url)` as `<img>`, auto-links `rrmacademy.org/...` style URLs (2026-02-26)
- Community feed fully inline — comments, replies, edit modal, comment reactions all in-feed, no detail page navigation (2026-02-26)
- Saved articles cross-device sync nudge for guests (2026-02-25)
- Quiz response recording -- new `quiz_response` D1 table captures individual answers (2026-02-25)
- Dead code cleanup -- removed unused API endpoints, CSS, functions (2026-02-25)
- Dark mode persistence fix -- localStorage save on OS detection (2026-02-25)
- Removed `vimeoId` fields from courses.json (2026-02-25)
