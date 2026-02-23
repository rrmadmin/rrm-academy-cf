# Migration Status (Wix → Cloudflare)

## Architecture

Strangler fig pattern: `rrm-router` CF Worker proxies all traffic to `rrmacademy.org`.
Paths in `ASTRO_ROUTES` → Astro/CF Pages. Everything else → Wix origin.

- **Router Worker**: `~/iCode/projects/rrm-router/src/index.js`
- **Astro site**: `~/iCode/projects/rrm-academy-cf/` (CF Pages project `rrm-academy`)
- **Wix origin**: `rrmfoundation.wixstudio.com/rrm-academy`

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| 0-3 Core pages | DONE | Homepage, library, commentary, legal, endo-survey |
| 4 Email marketing | DEFERRED | Broadcast tool TBD. Resend handles transactional. |
| 5 Forms & contact | DONE | Contact form + Turnstile + Resend |
| 6 Auth | DONE | D1 database, DIY sessions, PBKDF2, Resend emails |
| 7 Payments | NOT STARTED | Stripe. Prereq for courses. |
| 8 Courses | NOT STARTED | CF Stream + D1 + Discord. Final phase. |

## ASTRO_ROUTES (served by CF Pages)

```
/                          # Homepage
/library                   # Research library (3,162 articles)
/about                     # About page
/contact                   # Contact page + form
/donate                    # Donation page
/faqs                      # FAQ landing + /faqs/{slug} detail pages (26)
/privacy-policy            # Legal
/terms-of-use              # Legal
/medical-disclaimer        # Legal
/save-the-uterus-club      # Membership landing
/commentary                # Blog (14 posts)
/endo-survey               # Symptom self-survey
/api                       # CF Pages Functions
/_astro                    # Build assets
/pagefind                  # Search index
/favicon                   # Favicon
/images                    # Static images
/robots.txt                # SEO
/sitemap-index.xml         # SEO
/sitemap-0.xml             # SEO
```

## Redirects (301)

```
/post/{slug}                        → /commentary/{slug}
/blog                               → /commentary
/3-tier-endometriosis-symptom-self-survey → /endo-survey
```

## Still on Wix

- `/courses` — Online programs (video content, enrolled students)
- `/members-area` — Member login/profile
- `/plans-pricing` — Subscription plans
- `/groups` — Private community groups
- `/custom-signup` — Registration
- All other paths not in ASTRO_ROUTES

## CF Pages Functions

```
functions/
├── _middleware.js              # Subdomain + old URL redirects
└── api/
    ├── contact/
    │   └── submit.js           # POST /api/contact/submit (Phase 5)
    └── survey/
        ├── request.js          # POST /api/survey/request (email gate)
        ├── submit.js           # POST /api/survey/submit (store results)
        └── validate.js         # GET /api/survey/validate (check token)
```

## Environment Secrets (wrangler pages secret)

| Secret | Purpose | Phase |
|--------|---------|-------|
| `RESEND_API_KEY` | Email delivery (transactional) | 0 |
| `AIRTABLE_PAT` | Store survey results | 0 |
| `AIRTABLE_SURVEY_BASE` | Survey base ID | 0 |
| `AIRTABLE_SURVEY_TABLE` | Survey table ID | 0 |
| `CF_TURNSTILE_SECRET` | Bot protection (server-side) | 5 |

## KV Namespaces

| Binding | ID | Purpose |
|---------|----|---------|
| `SURVEY_TOKENS` | `ef52bc09f1b44b5f8e3367372be8d63d` | Endo survey magic-link tokens |
