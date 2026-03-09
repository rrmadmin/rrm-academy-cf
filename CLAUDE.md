# RRM Academy (Astro + CF Pages)

> **This is `rrm-academy-cf` — the rrmacademy.org website.** Not `rrm-foundation` (separate project, separate site). All work here affects the live education platform.

> Wix-to-Cloudflare migration via strangler fig pattern. Phases 0-8 complete (courses, quizzes, enrollment, progress tracking, comments, certificates all live). Active work tracked in `docs/plans/backlog.md`.

## Quick Reference

- **Stack**: Astro 5.3 (static) + Pagefind + CF Pages Functions + D1
- **Live**: https://rrmacademy.org/
- **CF Pages project**: `rrm-academy`
- **Deploy**: Three triggers, all via GitHub Actions → CF Pages:
  - `git push origin main` (code changes)
  - `repository_dispatch` with `article_id` (library article publish from yellowbase)
  - `repository_dispatch` with `record_id` (blog post publish from editorial base)
  - `workflow_dispatch` (manual, optional skip_fetch)
- **Build**: `npm run build` (runs `astro build && npx pagefind --site dist`)
- **Data**: `AIRTABLE_PAT=xxx npm run fetch-all` then `npm run build`
- **Router Worker**: `~/iCode/projects/rrm-router/src/index.js`
- **Wix site code**: `~/iCode/projects/rrm-academy-wix/`

## Airtable Architecture

Two Airtable bases feed the library. Never confuse them.

| Base | Nickname | Base ID | Purpose |
|------|----------|---------|---------|
| RRM Library | **Greenbase** | `appyZWo2G7iByXCgZ` | Master enrichment base — all 3,200+ articles, 106 fields, BIFID/PMID/Authors/Wiki tables. Never exposed to the public web. |
| ⚡️ Library | **Yellowbase** | `app78UTVdeFph9qhL` | Curated public subset — only safe fields, only synced records. This is what the site fetches. |

### Literature Pipeline

```
Greenbase: Wiki (Add) table          ← Rose bot or manual entry
    │  BIFID enrichment pipeline
    ▼
Greenbase: BIFID table               ← master record, all enrichment metadata
    │  Airtable base-to-base sync (automatic)
    │  (triggered by "Sync to RRM Library" = "Synced" on BIFID record)
    ▼
Yellowbase: ⚡️ Synced Literature     ← curated public fields only
    │  Airtable automation: sets "onDeck", sends repository_dispatch with article_id
    ▼
GitHub Actions: fetch-data.mjs       ← single-record mode (accepts onDeck or Synced)
    ▼
src/data/articles.json → Astro build → rrmacademy.org/library
    │  On success: pings Airtable webhook → automation sets "Synced"
```

**Config:** Base/table IDs in `src/lib/airtable-config.mjs`. Filter: `{Sync to RRM Library}='Synced'`.

### Blog Pipeline

```
Airtable Editorial base              ← draft → review → publish
    │  Airtable automation: sets Status="Publishing", sends dispatch with record_id
    ▼
GitHub Actions: fetch-blog-data.mjs  ← single-record mode (accepts Publishing or Published)
    │  Image pipeline: download → Tinify compress → WebP+JPG → R2 upload
    ▼
src/data/posts.json → Astro build → rrmacademy.org/commentary
    │  On success: pings Airtable webhook → automation sets "Published"
```

**Config:** Base/table IDs in `src/lib/blog-config.mjs`.

### Full Rebuild

`fetch-all` fetches all 4 data sources: articles, posts, FAQs, courses. Runs on push-to-main and workflow_dispatch (unless skip_fetch). GitHub Actions caches data per day (`airtable-data-YYYY-MM-DD`).

## Docs

```
docs/
├── architecture/
│   └── airtable-cf-pipeline.md   # Airtable → CF data pipeline
├── plans/
│   ├── backlog.md                # Living backlog & project status
│   ├── completed/                # Archived completed plans
│   └── *.md                      # Active implementation plans
└── endo-survey-icd10-internal.md
```

## Local Reference

| Topic | File |
|-------|------|
| Design system | `STYLE-GUIDE.md` |
| Backlog & project status | `docs/plans/backlog.md` |
| Airtable-to-CF data pipeline | `docs/architecture/airtable-cf-pipeline.md` |
| ICD-10 codes (endo survey) | `docs/endo-survey-icd10-internal.md` |

## Site Map

| Route | File |
|-------|------|
| `/` | `src/pages/index.astro` |
| `/about` | `src/pages/about.astro` |
| `/contact` | `src/pages/contact.astro` (form + Turnstile) |
| `/donate` | `src/pages/donate/index.astro` |
| `/donate/thank-you` | `src/pages/donate/thank-you.astro` |
| `/faqs` | `src/pages/faqs.astro` |
| `/faqs/[slug]` | `src/pages/faqs/[...slug].astro` |
| `/library` | `src/pages/library/index.astro` |
| `/library/[slug]` | `src/pages/library/[...slug].astro` |
| `/library/page/[page]` | `src/pages/library/page/[page].astro` |
| `/library/saved` | `src/pages/library/saved.astro` |
| `/commentary` | `src/pages/commentary/index.astro` |
| `/commentary/[slug]` | `src/pages/commentary/[...slug].astro` |
| `/commentary/page/[page]` | `src/pages/commentary/page/[page].astro` |
| `/courses` | `src/pages/courses/index.astro` |
| `/courses/[slug]` | `src/pages/courses/[slug].astro` |
| `/courses/[slug]/[stepId]` | `src/pages/courses/[slug]/[stepId].astro` |
| `/community` | `src/pages/community/index.astro` |
| `/community/events` | `src/pages/community/events.astro` |
| `/community/members` | `src/pages/community/members.astro` |
| `/community/post/[id]` | `src/pages/community/post/[...id].astro` |
| `/admin/seo` | `src/pages/admin/seo.astro` |
| `/endo-survey` | `src/pages/endo-survey/index.astro` |
| `/endo-survey/take` | `src/pages/endo-survey/take.astro` |
| `/save-the-uterus-club` | `src/pages/save-the-uterus-club/index.astro` |
| `/save-the-uterus-club/thank-you` | `src/pages/save-the-uterus-club/thank-you.astro` |
| `/login` | `src/pages/login.astro` |
| `/signup` | `src/pages/signup.astro` |
| `/account` | `src/pages/account/index.astro` (auth required) |
| `/forgot-password` | `src/pages/forgot-password.astro` |
| `/reset-password` | `src/pages/reset-password.astro` |
| `/terms-of-use` | `src/pages/terms-of-use.astro` |
| `/privacy-policy` | `src/pages/privacy-policy.astro` |
| `/medical-disclaimer` | `src/pages/medical-disclaimer.astro` |
| `/linkinbio` | `src/pages/linkinbio.astro` |
| `/linkinbio/jointhecall` | `src/pages/linkinbio/jointhecall.astro` |
| `/404` | `src/pages/404.astro` |

## Page Templates & SEO Architecture

**BaseLayout** (`src/layouts/BaseLayout.astro`): Every page uses this. Controls `<title>`, meta description, canonical URL, OG/Twitter tags, JSON-LD injection, Highwire Press citation meta, font preloading, favicon, and noindex. Title suffix logic: appends `| RRM Academy` unless title already contains "RRM Academy" or starts with "RRM ".

**Dynamic route templates** generate all content pages from JSON data files:

| Template | Data Source | Schema (JSON-LD) | Notes |
|----------|------------|-------------------|-------|
| `src/pages/library/[...slug].astro` | `articles.json` | MedicalScholarlyArticle + citation_* meta | Highwire Press tags for Google Scholar |
| `src/pages/commentary/[...slug].astro` | `posts.json` | BlogPosting + BreadcrumbList (+ Person for Whittaker) | Cover image alt = post title |
| `src/pages/faqs/[...slug].astro` | `faqs.json` | QAPage | Related questions linking |
| `src/pages/courses/[slug].astro` | `courses.json` | Course + Person + BreadcrumbList + FAQPage | Lesson player at `[slug]/[stepId].astro` |
| `src/pages/courses/index.astro` | `courses.json` | ItemList | Catalog page |

SEO changes to these templates automatically apply to all existing and future content. No per-item overrides exist.

## Components

`src/components/`: Header, Footer, SearchBar, ArticleCard, BlogCard, CourseCard, Citation, AuthorByline, TopicTag, LibraryFundingCallout

## API Functions (`functions/api/`)

| Endpoint | File | Purpose |
|----------|------|---------|
| **Auth** | | |
| `POST /api/auth/signup` | `auth/signup.js` | Create account |
| `POST /api/auth/login` | `auth/login.js` | Login, set session cookie |
| `POST /api/auth/logout` | `auth/logout.js` | Clear session |
| `GET /api/auth/session` | `auth/session.js` | Check current session |
| `GET /api/auth/profile` | `auth/profile.js` | Get/update user profile |
| `POST /api/auth/forgot-password` | `auth/forgot-password.js` | Send reset email |
| `POST /api/auth/reset-password` | `auth/reset-password.js` | Reset with token |
| `POST /api/auth/change-password` | `auth/change-password.js` | Authenticated password change |
| `GET /api/auth/verify-email` | `auth/verify-email.js` | Email verification link handler |
| `POST /api/auth/resend-verification` | `auth/resend-verification.js` | Resend verification email |
| `GET /api/auth/google` | `auth/google.js` | Redirect to Google OAuth consent |
| `GET /api/auth/google-callback` | `auth/google-callback.js` | Google OAuth callback, account link/create |
| **Courses** | | |
| `POST /api/courses/enroll` | `courses/enroll.js` | Enroll in a course |
| `GET/POST /api/courses/progress` | `courses/progress.js` | Track step completion |
| `POST /api/courses/quiz` | `courses/quiz.js` | Submit quiz/questionnaire answers |
| `GET/POST /api/courses/comments` | `courses/comments.js` | Course step comments |
| `GET /api/courses/certificate` | `courses/certificate.js` | Generate completion certificate |
| **Community** | | |
| `GET/POST /api/community/posts` | `community/posts.js` | Community posts CRUD |
| `GET/POST /api/community/comments` | `community/comments.js` | Post comments (author editing via PUT) |
| `POST /api/community/reactions` | `community/reactions.js` | Post/comment reactions |
| `GET /api/community/status` | `community/status.js` | Community membership status |
| `GET /api/community/members` | `community/members.js` | Members list with tiers/badges |
| `POST /api/community/flags` | `community/flags.js` | Report/flag posts and comments |
| `POST /api/community/ban` | `community/ban.js` | Ban user (admin only) |
| `POST /api/community/unban` | `community/unban.js` | Unban user (admin only) |
| `GET/PUT /api/community/notifications` | `community/notifications.js` | Email notification preferences |
| `POST /api/community/upload` | `community/upload.js` | Image upload to R2 |
| **Billing** | | |
| `GET /api/billing/status` | `billing/status.js` | Subscription + donation history |
| `POST /api/billing/portal` | `billing/portal.js` | Stripe customer portal link |
| `GET /api/billing/checkout-account` | `billing/checkout-account.js` | Check if account exists for checkout session |
| `POST /api/create-checkout` | `create-checkout.js` | Stripe checkout session |
| `POST /api/stripe-webhook` | `stripe-webhook.js` | Stripe webhook handler |
| **Other** | | |
| `POST /api/admin/cleanup` | `admin/cleanup.js` | Prune expired sessions/resets/verifications/webhook events (ADMIN_API_SECRET) |
| `GET /api/admin/seo` | `admin/seo.js` | Proxy to rrm-seo-monitor Worker (ADMIN_TOKEN) |
| `POST /api/contact/submit` | `contact/submit.js` | Contact form submission |
| `GET/POST /api/saved` | `saved.js` | Save/unsave library articles |
| `GET /api/stream/token` | `stream/token.js` | CF Stream video token |
| `POST /api/survey/request` | `survey/request.js` | Request survey link |
| `GET /api/survey/validate` | `survey/validate.js` | Validate survey magic-link token |
| `POST /api/survey/submit` | `survey/submit.js` | Submit survey responses |

Middleware: `functions/_middleware.js` (session injection, CORS, auth gating)

## Email

All transactional email uses **AWS SES** via `functions/api/_ses.js` (aws4fetch). Sends from `@mail.rrmacademy.org` subdomain (isolates transactional reputation from root domain). DKIM, SPF, DMARC, and custom MAIL FROM (`bounce.mail.rrmacademy.org`) all configured. Required env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_REGION`.

## Operational Automation (n8n)

| Workflow | Schedule | What |
|----------|----------|------|
| Daily Cleanup (`La9Bauj70L82oua8`) | 5 AM UTC | POST `/api/admin/cleanup` -- prunes expired sessions, resets, verifications, webhook events >7d |
| Down Detector (`HxxCkFOPbrXa0r08`) | Every 5 min | Checks site, library data, n8n. Telegram alert on failure via @rrm_n8n_notification_bot |

## Survey Pseudonymization

Endo survey splits PII from health data across two systems:

| System | Binding | Contains |
|--------|---------|----------|
| D1 `rrm-survey` | `SURVEY_DB` | email + Airtable record ID (identity) |
| Airtable | via `AIRTABLE_PAT` | symptoms, scores, metadata (no email) |
| KV `SURVEY_TOKENS` | `SURVEY_TOKENS` | token, used flag, UTM (email stripped after submit) |

- **D1 table:** `survey_identities` (email, airtable_record_id, source, created_at). UNIQUE on airtable_record_id, INDEX on email
- **Sources:** `endo-survey-v1` (live submissions), `endo-survey-v1-backfill` (migration)
- **Airtable IDs:** base `appb7HeeJQsVe3Jpr`, table `tblMAw2tih2ie3ZCu`
- **Token TTL:** 24 hours (both request.js and submit.js)
- **D1 failure handling:** logs to Analytics Engine + SES alert to administrator@rrmacademy.org
- **Migration script:** `scripts/migrate-survey-identities.mjs` (one-time, already run)
- **Design doc:** `docs/plans/2026-03-09-survey-pseudonymization-design.md`

## Webhook Event Dedup

`webhook_event` table in D1 stores Stripe `event.id` on first processing. `INSERT OR IGNORE` skips duplicates on retries. Prevents duplicate welcome emails and account creation.

## Semantic Search Rate Limiting

`/api/search/semantic.js` has IP-based rate limiting (20 req/min per IP via `cf-connecting-ip`). Per-isolate (resets on cold start). Protects billed AI.run() and Vectorize.query() calls.

## CI Deploy Guard

`deploy.yml` enforces minimum record counts: articles >= 3000, posts >= 5, faqs >= 10, courses >= 1. Prevents catastrophic data loss from deploying.

## Mobile Editing

Push to `claude/` branch -- GitHub Actions auto-builds + merges. No local credentials needed.

## Shared Config

- **Airtable IDs**: Library and Blog base/table IDs live in `src/lib/airtable-config.mjs` and `src/lib/blog-config.mjs` — imported by both `.ts` (Astro build) and `.mjs` (CLI scripts)
- **Stripe API version**: `STRIPE_API_VERSION` in `functions/api/auth/_shared.js` — imported by all 6 Stripe consumers
- **Site URL for emails**: `SITE_URL` in `functions/api/auth/_shared.js` — used in transactional email body links only (CORS origin stays hardcoded for security; Astro pages use `Astro.site`)
- **Navigation**: Desktop, mobile, and footer navs are intentionally different item sets — see comments in `Header.astro` and `Footer.astro`

## Security Guard

A zero-dependency Node.js script (`scripts/guard.mjs`) that blocks deployments if critical security files are tampered with.

**Guarded files** (hash-checked via `guard-manifest.json`):
- `functions/api/auth/_shared.js` — CORS, sessions, crypto, rate limiting
- `functions/api/auth/login.js`, `signup.js`, `google-callback.js` — authentication
- `functions/api/stripe-webhook.js` — webhook signature verification
- `functions/api/create-checkout.js`, `billing/status.js`, `billing/portal.js` — billing
- `functions/_middleware.js` — auth gating for /account and /community
- `wrangler.toml` — D1, KV, R2 bindings
- `scripts/guard.mjs` — self-guarding

**Security invariants** (always enforced, even after `guard:update`):
- All `Access-Control-Allow-Origin` values in `functions/` must be `https://rrmacademy.org`
- `stripe-webhook.js` must use `stripe-signature` + `constructEventAsync`
- `_middleware.js` must protect `/account` and `/community`
- `login.js` and `signup.js` must use `checkRateLimit`

**Secret scanning**: Blocks `sk_live_`, `sk_test_`, `whsec_`, private keys, Bearer tokens, Airtable PATs in `functions/` and `src/`.

**Commands**:
- `npm run guard` — verify (exit 1 on failure)
- `npm run guard:update` — regenerate manifest hashes after intentional changes
- `npm run guard:install` — install pre-commit hook

**Runs automatically**: pre-commit hook (local, critical files only), CI deploy workflow, CI claude/** auto-merge workflow.

## Citation Integrity

**Never insert academic citations from model knowledge.** Hallucinated PMIDs, DOIs, and references are an existential threat to a medical education site.

Citations must come from one of:
- Perplexity research (live web search, verified)
- The RRM Research Library (Airtable BIFID)
- Brian directly

When a post needs references, research each one live before inserting. If asked to "add citations" to existing content, look them up via Perplexity or the library first. Never generate a PMID, DOI, or journal reference from memory.

CI enforces this: `scripts/verify-citations.mjs` (v2, multi-API cascade) runs on every blog deploy and blocks publication if any citation fails verification.

## Rules

- Read relevant `STYLE-GUIDE.md` sections before editing styles
- Never hardcode colors, spacing, or fonts -- use design tokens
- Keep edits focused, show before/after summaries
- After modifying a guarded file, run `npm run guard:update` before committing
