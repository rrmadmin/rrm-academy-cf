<!-- Extracted from CLAUDE.md 2026-07-20 (context-size offload). This file is the live inventory: keep it updated exactly as the old in-CLAUDE.md section was. -->

## API Functions (`functions/`)

184 `.js` files: 96 user/public endpoint files, 38 admin endpoint files, 50 `_`-prefixed shared helpers/middleware. Full inventory (last synced 2026-07-02 — when adding an endpoint, add its row here). File paths relative to `functions/api/` unless prefixed `functions/`.

### User & public endpoints

| Endpoint | File | Purpose |
|----------|------|---------|
| **Auth** (all rate-limited) | | |
| `POST /api/auth/signup` | `auth/signup.js` | Create account, send verification email (Turnstile) |
| `POST /api/auth/login` | `auth/login.js` | Email/password login, set session cookie (Turnstile) |
| `POST /api/auth/logout` | `auth/logout.js` | Invalidate session, clear cookies |
| `GET /api/auth/session` | `auth/session.js` | Return current session's user or null |
| `PATCH /api/auth/profile` | `auth/profile.js` | Update first/last name (session) |
| `POST /api/auth/forgot-password` | `auth/forgot-password.js` | Send reset email (Turnstile) |
| `POST /api/auth/reset-password` | `auth/reset-password.js` | Reset with emailed token (no Turnstile — token possession) |
| `POST /api/auth/change-password` | `auth/change-password.js` | Authenticated password change (session) |
| `GET/POST /api/auth/verify-email` | `auth/verify-email.js` | Email verification (GET side-effect-free, POST consumes) |
| `POST /api/auth/resend-verification` | `auth/resend-verification.js` | Resend verification email (session) |
| `GET /api/auth/google` | `auth/google.js` | Redirect to Google OAuth consent (CSRF nonce cookie) |
| `GET /api/auth/google-callback` | `auth/google-callback.js` | OAuth callback, account link/create (state CSRF check) |
| `GET/POST /api/account/mcp-keys` | `account/mcp-keys/index.js` | List/create MCP API keys (session; POST rate-limited) |
| `DELETE /api/account/mcp-keys/[id]` | `account/mcp-keys/[id].js` | Soft-revoke an MCP API key (session) |
| **Courses** | | |
| `GET /api/courses` | `courses.js` | Published catalog/single course (Bearer LIBRARY_BUILD_TOKEN; build-time) |
| `POST /api/courses/enroll` | `courses/enroll.js` | Enroll or start paid-course Stripe checkout (session + gating) |
| `GET/PATCH /api/courses/progress` | `courses/progress.js` | Read/update step progress (session) |
| `GET/POST /api/courses/quiz` | `courses/quiz.js` | Fetch quiz / submit + score answers (session; POST rate-limited) |
| `GET/POST /api/courses/comments` | `courses/comments.js` | Lesson comments (session + enrollment/membership gate) |
| `GET /api/courses/certificate` | `courses/certificate.js` | HTML completion certificate (session) |
| `GET /api/courses/rendition` | `courses/rendition.js` | Published lesson rendition content (session + gate) |
| `POST /api/courses/waitlist` | `courses/waitlist.js` | Affiliate-course waitlist signup (public; Turnstile + rate limit) |
| `POST /api/courses/affiliate-click` | `courses/affiliate-click.js` | Affiliate click tracking (public, best-effort session) |
| `GET /api/stream/token` | `stream/token.js` | Signed CF Stream JWT (session + enrollment/membership check) |
| **Community** (all `requireMember` STUC gate unless noted) | | |
| `GET/POST/PATCH/DELETE /api/community/posts` | `community/posts.js` | Posts CRUD; pin is mod+ |
| `GET/POST/PATCH/DELETE /api/community/comments` | `community/comments.js` | Threaded comments CRUD (author/mod checks) |
| `POST/DELETE /api/community/reactions` | `community/reactions.js` | Toggle/remove emoji reactions (rate-limited) |
| `GET /api/community/status` | `community/status.js` | Caller's access level (session; anonymous-safe) |
| `GET /api/community/members` | `community/members.js` | Active member roster with tiers/badges |
| `GET /api/community/memberships` | `community/memberships.js` | Caller's own area/project memberships |
| `POST/GET/PATCH /api/community/flags` | `community/flags.js` | Flag/moderate content (GET mod+, PATCH admin+) |
| `POST /api/community/ban` | `community/ban.js` | Ban user, optional content wipe (admin role) |
| `POST /api/community/unban` | `community/unban.js` | Unban user (admin role) |
| `PATCH /api/community/notifications` | `community/notifications.js` | Toggle own email opt-out |
| `POST /api/community/upload` | `community/upload.js` | Image upload to R2 (type sniffing + rate limit) |
| `GET /api/community/unfurl` | `community/unfurl.js` | SSRF-guarded OG metadata fetch (rate-limited) |
| `GET /api/community/areas` | `community/areas.js` | List active action areas (public; session optional) |
| `POST /api/community/areas/join` | `community/areas/join.js` | Join an action area (idempotent) |
| `POST /api/community/areas/leave` | `community/areas/leave.js` | Leave area (blocked for area owner) |
| `POST/DELETE /api/community/areas/volunteer` | `community/areas/volunteer.js` | Volunteer/withdraw to lead an ownerless area |
| `GET /api/community/projects` | `community/projects.js` | List projects under active areas (public; session optional) |
| `POST /api/community/projects/join` | `community/projects/join.js` | Join a joinable project (idempotent) |
| `POST /api/community/projects/leave` | `community/projects/leave.js` | Leave project (blocked for owner) |
| `GET /api/community/impact` | `community/impact.js` | Current-month curated impact entries (public) |
| **Billing** | | |
| `POST /api/create-checkout` | `create-checkout.js` | Stripe Checkout session, donation + membership (public; rate-limited; Wix migration handoff) |
| `POST /api/stripe-webhook` | `stripe-webhook.js` | Webhook dispatcher (signature verify + dedup; handlers in `billing/_webhook-*.js`) |
| `GET /api/billing/status` | `billing/status.js` | Subscription + donation history, Stripe + legacy Wix (session) |
| `POST /api/billing/portal` | `billing/portal.js` | Stripe customer portal link (session) |
| `GET /api/billing/checkout-account` | `billing/checkout-account.js` | Account-exists check for checkout session (public; rate-limited) |
| `GET /api/billing/supporter-badge` | `billing/supporter-badge.js` | Public donor badge by checkout session (rate-limited) |
| `GET /api/fund-progress` | `fund-progress.js` | Fundraising totals from Stripe (public; KV-cached) |
| `GET /api/fund-supporters` | `fund-supporters.js` | Supporter recognition list (public; KV-cached) |
| **Newsletter** | | |
| `POST /api/newsletter/subscribe` | `newsletter/subscribe.js` | Signup (Turnstile + honeypot + ELV + rate limit + idempotency) |
| `GET/POST /api/newsletter/unsubscribe` | `newsletter/unsubscribe.js` | RFC 8058 one-click + page (HMAC token) |
| `POST /api/newsletter/send` | `newsletter/send.js` | Paginated campaign send (Bearer ADMIN_API_SECRET) |
| `POST /api/newsletter/send-first-email` | `newsletter/send-first-email.js` | Welcome backfill to explicit ids (Bearer ADMIN_API_SECRET) |
| `POST /api/newsletter/rss-check` | `newsletter/rss-check.js` | RSS poll to trigger send (Bearer ADMIN_API_SECRET) |
| `POST /api/newsletter/bounce` | `newsletter/bounce.js` | SES/SNS bounce+complaint webhook (secret param + SNS RSA sig) |
| `GET /api/newsletter/open` | `newsletter/open.js` | Open-tracking pixel (rate-limited) |
| `GET /api/newsletter/click` | `newsletter/click.js` | Click log + 302 redirect (rate-limited) |
| `POST /api/email/events` | `email/events.js` | SES/SNS delivery-event ingest (secret param + SNS RSA sig) |
| **Content data (build-time consumers)** | | |
| `GET /api/articles` | `articles.js` | Library articles, proxies rrm-library-worker (public; 30/min) |
| `GET/HEAD /api/articles/bulk` | `articles/bulk.js` | Bulk article fetch by id (shares rate-limit budget) |
| `GET/HEAD /api/bulk` | `bulk.js` | Alias re-exporting `articles/bulk.js` |
| `GET /api/blog/posts` | `blog/posts.js` | Published posts from D1 (Bearer LIBRARY_BUILD_TOKEN) |
| `GET /api/faqs` | `faqs.js` | Published FAQs + refs/resources (Bearer LIBRARY_BUILD_TOKEN) |
| `GET /api/glossary/terms` | `glossary/terms.js` | Terms/refs/abbreviations (Bearer LIBRARY_BUILD_TOKEN) |
| `GET /api/partners` | `partners/index.js` | Partner list for build (Bearer LIBRARY_BUILD_TOKEN) |
| `POST /api/library/deploy-record` | `library/deploy-record.js` | Trigger GH Actions single-record rebuild (X-Deploy-Secret header) |
| **Search & tracking** | | |
| `GET /api/search/semantic` | `search/semantic.js` | Vectorize semantic search (public; 20/min/IP) |
| `POST /api/search/log` | `search/log.js` | Pagefind query logging (public; rate-limited) |
| `POST /api/track` | `track.js` | Allowlisted client analytics → GA4/AE (public; rate-limited; see Analytics Gates) |
| **Ask & MCP** | | |
| `GET/POST /api/ask` | `ask.js` | Q&A chat; GET capability JSON, POST session + daily cap |
| `POST /api/ask/sandbox` | `ask/sandbox.js` | Canned test response (public) |
| `GET/POST/DELETE /api/ask/saved` | `ask/saved.js` | Save/list/delete user's Q&As (session; 30/hr POST) |
| `GET /api/ask/shared/[id]` | `ask/shared/[id].js` | Public read of shared Q&A (60/min/IP) |
| `GET /ask/s/<token>` | `functions/ask/s/[token].js` | Public server-rendered share page (noindex) |
| `ALL /mcp` | `functions/mcp/index.js` | Transparent proxy to mcp.rrmacademy.org |
| `GET /.well-known/mcp` | `functions/.well-known/mcp.js` | MCP manifest (extensionless-path workaround for static dir) |
| **Surveys, contact, partners, PDF** | | |
| `POST /api/survey/request` | `survey/request.js` | Email magic-link survey token (public; rate-limited) |
| `GET /api/survey/validate` | `survey/validate.js` | Validate magic-link token (rate-limited) |
| `POST /api/survey/submit` | `survey/submit.js` | Consume token, store pseudonymized responses |
| `POST /api/survey/event` | `survey/event.js` | Survey click beacon (rate-limited) |
| `GET /api/survey/count` | `survey/count.js` | Public survey-taker counts (edge-cached) |
| `POST /api/endo-quiz/request` | `endo-quiz/request.js` | Google Ads landing-flow single-step email capture (Turnstile + rate limit); stores pseudonymized symptoms tagged `source='ads'`, fires Google Ads conversion (live UPLOAD_CLICKS action 7671519551 via Data Manager) |
| `POST /api/contact/submit` | `contact/submit.js` | Contact form via SES (Turnstile + rate limit) |
| `POST /api/partners/apply` | `partners/apply.js` | Partner application intake (Turnstile) |
| `POST /api/pdf/request` | `pdf/request.js` | Email guide-PDF redeem token (Turnstile + 5/15min) |
| `GET /api/pdf/redeem` | `pdf/redeem.js` | Single-use expiring token gates R2 PDF download |
| **Other pages/assets served by functions** | | |
| `GET/POST/DELETE /api/saved` | `saved.js` | Save/unsave pages universally (session) |
| `GET /api/assets/*` | `assets/[[path]].js` | R2 assets; auth + enrollment for non-image course files |
| `ALL /og/*` | `functions/og/[[path]].js` | On-demand OG image PNGs (public; see OG Images section) |
| `GET /events/<slug>` | `functions/events/[slug].js` | Public STUC event landing page (join info stripped for non-members) |
| `GET /save-the-uterus-club/migrate` | `functions/save-the-uterus-club/migrate.js` | Wix→Stripe migration interstitial (feature flag + HMAC token + session) |

### Admin endpoints (`functions/api/admin/`)

Auth is per-endpoint, NOT via the admin middleware (`admin/_middleware.js` only injects `context.data.user` best-effort and never blocks — `ADMIN_API_SECRET` endpoints ignore sessions). Three patterns: **[A]** session + admin-or-superadmin role, **[S]** `requireSuperAdmin` (superadmin only), **[B]** Bearer `ADMIN_API_SECRET` (constant-time compare; service/cron).

| Endpoint | File | Purpose |
|----------|------|---------|
| **Courses [A]** — 17 endpoints | `admin/courses/…` | Course/section/step/rendition CRUD + multipart attachments. FK refusals, cert-quiz integrity, explicit `db.batch()` cleanup, R2 cleanup on delete. Files: `index.js`, `[id].js`, `[id]/attachments.js`, `[id]/sections.js`, `[id]/sections/[sectionId].js`, `[id]/steps.js`, `[id]/steps/[stepId].js`, `[id]/steps/[stepId]/renditions.js` |
| **FAQs [A]** — 9 endpoints | `admin/faqs/…` | FAQ CRUD + library-refs + resources sub-endpoints. Files: `index.js`, `[id].js`, `[id]/library-refs.js`, `[id]/resources.js`. NOTE: `[id].js` PUT also accepts Bearer ADMIN_API_SECRET (dual-path; only CRUD endpoint with a service-token bypass) |
| **Glossary [A]** — 15 endpoints | `admin/glossary/…` | Term/reference/abbreviation CRUD; slug immutable, cross-citation delete refusals. Files: `terms/index.js`, `terms/[id].js`, `refs/index.js`, `refs/[refnum].js`, `abbreviations/index.js`, `abbreviations/[abbr].js` |
| **Community [A]** — 11 endpoints | `admin/community/…` | Action areas, projects, impact log CRUD (soft-archive or hard-delete) + area-ownership request approve/reject. Files: `areas.js`, `projects.js`, `impact.js`, `ownership.js` |
| `GET/POST /api/admin/partners[/(id)]` **[S]** | `admin/partners/index.js`, `[id].js` | List applications; approve/reject/revoke + notification email |
| `GET /api/admin/revenue` **[S]** | `admin/revenue.js` | MRR/tier/donation report (KV-cached 15m) |
| `GET /api/admin/enrollments` **[S]** | `admin/enrollments.js` | Enrollment summary + paginated list |
| `GET /api/admin/membership-report` **[A/B]** | `admin/membership-report.js` | Unified membership/supporter report (admin-or-bearer; ?month ET bucketing; Stripe-degradation to D1; no-store) |
| `GET /api/admin/content` **[S]** | `admin/content.js` | GA4 content-performance report |
| `GET /api/admin/conversions` **[S]** | `admin/conversions.js` | GA4 conversion funnels (KV-cached 1h) |
| `GET /api/admin/email` **[S]** | `admin/email.js` | Email observability (summary/broadcasts/log/cohort views) |
| `GET/PUT/POST /api/admin/seo` **[S]** | `admin/seo.js` | Proxy to rrm-seo-monitor + rrm-observatory Workers |
| `POST /api/admin/backlinks` **[S]** | `admin/backlinks.js` | Proxy to rrm-backlinks Worker |
| `GET /api/admin/campaign-report` **[S]** | `admin/campaign-report.js` | HMAC-signed UTM-cohort pull from fp.rrmacademy.org, resolved to members |
| `POST /api/admin/cleanup` **[B]** | `admin/cleanup.js` | Prune expired sessions/resets/verifications/webhook events (n8n cron) |
| `GET /api/admin/ecosystem` **[B]** | `admin/ecosystem.js` | Ecosystem-map SSOT JSON from `system_config` (gzip-aware) |
| `GET /api/admin/search-queries` **[B]** | `admin/search-queries.js` | Query `search_log` (list/top/gaps/users views) |
| `POST /api/admin/wix-migration-email` **[B]** | `admin/wix-migration-email.js` | Migration outreach/reminder send (dry-run supported) |
| `POST /api/admin/wix-migration-link` **[B]** | `admin/wix-migration-link.js` | Bind `wix_subscription` row to a user (dry-run supported) |
| `GET /api/admin/wix-migration-status` **[B]** | `admin/wix-migration-status.js` | Read-only migration dashboard (rate-limited) |

### Middleware & shared helpers

- `functions/_middleware.js` — site-wide: security headers/CSP, subdomain + case redirects, session injection, auth gating for `/account`, `/community`, `/ask`, `/save-the-uterus-club/migrate`; superadmin gate for `/admin`
- `functions/api/admin/_middleware.js` — best-effort user injection ONLY (never blocks; see Admin endpoints above)

Cross-cutting helpers in `functions/api/`: `_ses.js` (SES send + `email_log`), `_elv.js` (EmailListVerify + CRM tag), `_validate.js` (schema body validator), `_idempotency.js` (Idempotency-Key + KV), `_log.js` (Analytics Engine), `_ga4.js` + `_ga4-source.js` (server-side GA4), `_track-events.js` (client-event allowlist), `_ratelimit-headers.js`, `_search_log.js`, `_fp-link.js` (fingerprint-worker link), `_map-article.js`, `_ask_prompt.js`, `_guide-pdfs.js` (guide→R2 PDF map), `_endpoint-template.js` (inert scaffold, fully commented out). Subsystem helpers live beside their consumers: `auth/_shared.js` (sessions, PBKDF2, rate limiting, Turnstile, OAuth, `requireSuperAdmin`), `auth/_email-validate.js` + `auth/_disposable-domains.js`, `billing/_shared.js` + `_webhook-*.js` handlers + `_migration-handoff.js`/`_migration-token.js` + `_donor-gift.js`/`_supporter-gift.js`/`_campaign-count.js`, `community/_shared.js` (`requireMember`) + `_email.js` + `_areas-shared.js`, `courses/_shared.js` + `_quiz-content.js` + `_sanitize.js` + `_notify-admin.js`, `newsletter/_template.js`/`_tracking.js`/`_mail.js`/`_signup-emails.js`, `partners/_emails.js`, `contact/_subject.js`, `functions/events/_tracking.js`, `functions/og/_cuterus-image.js`.

**Gated PDF download (`_guide-pdfs.js` `GUIDE_PDFS` map) went live in production for the first time 2026-07-03**, for `rrm-care-team` (previously every entry was `enabled: false` since the feature was built 2026-03-14 — see `docs/superpowers/specs/2026-03-14-guide-pdf-download-design.md`). Activating a new entry is a first-activation event until proven otherwise for that specific guide: verify the D1 `pdf_token` table, the R2 object (`--remote` upload), `CF_TURNSTILE_SECRET`, and the SES `configurationSet` resolved by `pdf/request.js` before setting `enabled: true`. Full checklist + the companion-page pattern (bespoke layout instead of `GuideLayout.astro`, freeform guest-author byline) in skill `guide-companion-page`.
