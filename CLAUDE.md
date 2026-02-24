# RRM Academy (Astro + CF Pages)

> Wix → Cloudflare migration via strangler fig pattern. Phases 0-7 complete. Phase 8 (Courses) in progress. PRD: `~/iCode/projects/rrm-router/prd/PRD-Index.md`

## Quick Reference

- **Stack**: Astro 5.3 (static) + Pagefind + CF Pages Functions
- **Live**: https://rrmacademy.org/
- **CF Pages project**: `rrm-academy`
- **Deploy**: Push to `main` — CF Pages auto-builds from git
- **Build**: `npm run build` (runs `astro build && npx pagefind --site dist`)
- **Data**: `AIRTABLE_PAT=xxx npm run fetch-all` then `npm run build`
- **Router Worker**: `~/iCode/projects/rrm-router/src/index.js`
- **Wix site code**: `~/iCode/projects/rrm-academy-wix/`

## PRD (Single Source of Truth)

All migration status, phase specs, architecture, auth, data flow, and acceptance criteria live in the PRD:

```
~/iCode/projects/rrm-router/prd/PRD-Index.md
```

Do NOT create duplicate docs here. Read the PRD before working.

## Local Reference

| Topic | File |
|-------|------|
| Design system | `STYLE-GUIDE.md` |
| ICD-10 codes (endo survey internal) | `docs/endo-survey-icd10-internal.md` |

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
| `/save-the-uterus-club` | `src/pages/save-the-uterus-club/index.astro` |
| `/linkinbio` | `src/pages/linkinbio.astro` |
| `/linkinbio/jointhecall` | `src/pages/linkinbio/jointhecall.astro` |

## Components

`src/components/`: Header, Footer, SearchBar, ArticleCard, BlogCard, Citation, AuthorByline, TopicTag

## Mobile Editing

Push to `claude/` branch → GitHub Actions auto-builds + merges. No local credentials needed.

## Rules

- Read relevant `STYLE-GUIDE.md` sections before editing styles
- Never hardcode colors, spacing, or fonts — use design tokens
- Keep edits focused, show before/after summaries
