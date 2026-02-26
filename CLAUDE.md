# RRM Academy (Astro + CF Pages)

> Wix-to-Cloudflare migration via strangler fig pattern. Phases 0-8 complete (courses, quizzes, enrollment, progress tracking, comments, certificates all live). Active work tracked in `docs/plans/backlog.md`.

## Quick Reference

- **Stack**: Astro 5.3 (static) + Pagefind + CF Pages Functions + D1
- **Live**: https://rrmacademy.org/
- **CF Pages project**: `rrm-academy`
- **Deploy**: Push to `main` -- CF Pages auto-builds from git
- **Build**: `npm run build` (runs `astro build && npx pagefind --site dist`)
- **Data**: `AIRTABLE_PAT=xxx npm run fetch-all` then `npm run build`
- **Router Worker**: `~/iCode/projects/rrm-router/src/index.js`
- **Wix site code**: `~/iCode/projects/rrm-academy-wix/`

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
| `/community/post/[id]` | `src/pages/community/post/[...id].astro` |
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
| **Courses** | | |
| `POST /api/courses/enroll` | `courses/enroll.js` | Enroll in a course |
| `GET/POST /api/courses/progress` | `courses/progress.js` | Track step completion |
| `POST /api/courses/quiz` | `courses/quiz.js` | Submit quiz/questionnaire answers |
| `GET/POST /api/courses/comments` | `courses/comments.js` | Course step comments |
| `GET /api/courses/certificate` | `courses/certificate.js` | Generate completion certificate |
| **Community** | | |
| `GET/POST /api/community/posts` | `community/posts.js` | Community posts CRUD |
| `GET/POST /api/community/comments` | `community/comments.js` | Post comments |
| `POST /api/community/reactions` | `community/reactions.js` | Post/comment reactions |
| `GET /api/community/status` | `community/status.js` | Community membership status |
| **Billing** | | |
| `GET /api/billing/status` | `billing/status.js` | Subscription status |
| `POST /api/billing/portal` | `billing/portal.js` | Stripe customer portal link |
| `POST /api/create-checkout` | `create-checkout.js` | Stripe checkout session |
| `POST /api/stripe-webhook` | `stripe-webhook.js` | Stripe webhook handler |
| **Other** | | |
| `POST /api/contact/submit` | `contact/submit.js` | Contact form submission |
| `GET/POST /api/saved` | `saved.js` | Save/unsave library articles |
| `GET /api/stream/token` | `stream/token.js` | CF Stream video token |
| `POST /api/survey/request` | `survey/request.js` | Request survey link |
| `POST /api/survey/submit` | `survey/submit.js` | Submit survey responses |

Middleware: `functions/_middleware.js` (session injection, CORS, auth gating)

## Mobile Editing

Push to `claude/` branch -- GitHub Actions auto-builds + merges. No local credentials needed.

## Shared Config

- **Airtable IDs**: Library and Blog base/table IDs live in `src/lib/airtable-config.mjs` and `src/lib/blog-config.mjs` — imported by both `.ts` (Astro build) and `.mjs` (CLI scripts)
- **Stripe API version**: `STRIPE_API_VERSION` in `functions/api/auth/_shared.js` — imported by all 6 Stripe consumers
- **Site URL for emails**: `SITE_URL` in `functions/api/auth/_shared.js` — used in transactional email body links only (CORS origin stays hardcoded for security; Astro pages use `Astro.site`)
- **Navigation**: Desktop, mobile, and footer navs are intentionally different item sets — see comments in `Header.astro` and `Footer.astro`

## Rules

- Read relevant `STYLE-GUIDE.md` sections before editing styles
- Never hardcode colors, spacing, or fonts -- use design tokens
- Keep edits focused, show before/after summaries
