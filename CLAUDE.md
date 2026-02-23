# RRM Academy (Astro + CF Pages)

> Wix → Cloudflare migration via strangler fig pattern. Phases 0-5 done, Phase 6 (Auth) deployed.

## Quick Reference

- **Stack**: Astro 5.3 (static) + Pagefind + CF Pages Functions
- **Live**: https://rrmacademy.org/
- **CF Pages project**: `rrm-academy`
- **Deploy**: `CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages deploy dist --project-name rrm-academy`
- **Build**: `npm run build` (runs `astro build && npx pagefind --site dist`)
- **Data**: `AIRTABLE_PAT=xxx npm run fetch-all` then `npm run build`
- **Router Worker**: `~/iCode/projects/rrm-router/src/index.js`
- **Wix site code**: `~/iCode/projects/rrm-academy-wix/`

## Section Index

| Topic | File | Key Lines | Updated |
|-------|------|-----------|---------|
| Migration status & phases | `docs/MIGRATION-STATUS.md` | 1-20 | 2026-02-22 |
| Current ASTRO_ROUTES | `docs/MIGRATION-STATUS.md` | 22-50 | 2026-02-22 |
| What's still on Wix | `docs/MIGRATION-STATUS.md` | 58-68 | 2026-02-22 |
| CF Pages Functions | `docs/MIGRATION-STATUS.md` | 70-82 | 2026-02-22 |
| Env secrets & KV | `docs/MIGRATION-STATUS.md` | 84-100 | 2026-02-22 |
| Build & deploy pipeline | `docs/DATA-PIPELINE.md` | 1-30 | 2026-02-22 |
| Airtable data sources | `docs/DATA-PIPELINE.md` | 32-45 | 2026-02-22 |
| Design system overview | `STYLE-GUIDE.md` | 1-50 | 2026-02-22 |
| Color tokens | `STYLE-GUIDE.md` | 52-157 | 2026-02-22 |
| Typography | `STYLE-GUIDE.md` | 158-203 | 2026-02-22 |
| Form patterns | `STYLE-GUIDE.md` | 395-428 | 2026-02-22 |
| Button patterns | `STYLE-GUIDE.md` | 326-360 | 2026-02-22 |
| Page layout patterns | `STYLE-GUIDE.md` | 653-758 | 2026-02-22 |
| Dark mode | `STYLE-GUIDE.md` | 868-895 | 2026-02-22 |
| Auth architecture & API | `docs/AUTH-SPEC.md` | 1-40 | 2026-02-22 |
| Auth endpoints | `docs/AUTH-SPEC.md` | 42-55 | 2026-02-22 |
| Auth security | `docs/AUTH-SPEC.md` | 63-80 | 2026-02-22 |

## Site Map

| Route | File |
|-------|------|
| `/` | `src/pages/index.astro` |
| `/about` | `src/pages/about.astro` |
| `/contact` | `src/pages/contact.astro` (form + Turnstile) |
| `/donate` | `src/pages/donate.astro` |
| `/faqs` | `src/pages/faqs.astro` |
| `/library` | `src/pages/library/index.astro` |
| `/library/[slug]` | `src/pages/library/[...slug].astro` |
| `/library/saved` | `src/pages/library/saved.astro` |
| `/commentary` | `src/pages/commentary/index.astro` |
| `/commentary/[slug]` | `src/pages/commentary/[...slug].astro` |
| `/endo-survey` | `src/pages/endo-survey/index.astro` |
| `/endo-survey/take` | `src/pages/endo-survey/take.astro` |
| `/login` | `src/pages/login.astro` |
| `/signup` | `src/pages/signup.astro` |
| `/account` | `src/pages/account/index.astro` (auth required) |
| `/forgot-password` | `src/pages/forgot-password.astro` |
| `/reset-password` | `src/pages/reset-password.astro` |
| `/save-the-uterus-club` | `src/pages/save-the-uterus-club.astro` |

## Components

`src/components/`: Header, Footer, SearchBar, ArticleCard, BlogCard, Citation, AuthorByline, TopicTag

## Mobile Editing

Push to `claude/` branch → GitHub Actions auto-builds + merges. No local credentials needed.

## Rules

- Read relevant `STYLE-GUIDE.md` sections before editing styles
- Never hardcode colors, spacing, or fonts — use design tokens
- Keep edits focused, show before/after summaries
