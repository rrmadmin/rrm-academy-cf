# RRM Academy — Cloudflare (Astro SSG)

> **Renamed 2026-02-22**: This directory was `rrm-library-site`. GitHub repo also renamed from `rrmadmin/rrm-library-site` to `rrmadmin/rrm-academy-cf`.

The Wix Velo project is in a **separate** directory: `iCode/projects/rrm-academy-wix/` (GitHub: `rrmadmin/rrm-academy`).

## Quick Reference

- **Stack**: Astro 5.3 (static) + Pagefind + CF Pages Functions
- **Live**: https://rrmacademy.org/
- **CF Pages project**: `rrm-academy`
- **Deploy**: `CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" npx wrangler pages deploy dist --project-name rrm-academy`
- **Data fetch**: `AIRTABLE_PAT=xxx node src/lib/fetch-data.mjs` (library) / `node src/lib/fetch-blog-data.mjs` (commentary)
- **Build**: `npm run build` (runs `astro build && npx pagefind --site dist`)
- **Style guide**: `STYLE-GUIDE.md` in project root

## Mobile Editing Guide

When editing this site from the Claude mobile app, follow these conventions:

### Site Map

**Pages** (`src/pages/`):
| Route | File |
|-------|------|
| `/` | `index.astro` — Homepage (hero + 8 sections + CTA) |
| `/about` | `about.astro` |
| `/contact` | `contact.astro` |
| `/donate` | `donate.astro` |
| `/faqs` | `faqs.astro` |
| `/library` | `library/index.astro` — Search, topics, recent articles |
| `/library/[slug]` | `library/[...slug].astro` — Article detail |
| `/library/saved` | `library/saved.astro` — Bookmarked articles |
| `/commentary` | `commentary/index.astro` — Blog landing |
| `/commentary/[slug]` | `commentary/[...slug].astro` — Blog post |
| `/commentary/rss` | `commentary/rss.xml.ts` — RSS feed |
| `/endo-survey` | `endo-survey/index.astro` — Survey intro |
| `/endo-survey/take` | `endo-survey/take.astro` — 3-tier checklist |
| `/save-the-uterus-club` | `save-the-uterus-club.astro` |
| `/medical-disclaimer` | `medical-disclaimer.astro` |
| `/privacy-policy` | `privacy-policy.astro` |
| `/terms-of-use` | `terms-of-use.astro` |

**Components** (`src/components/`): Header, Footer, SearchBar, ArticleCard, BlogCard, Citation, AuthorByline, TopicTag

**Layout**: `src/layouts/BaseLayout.astro` — master layout (head, header, main, footer)

**Styles**: `src/styles/global.css` — design tokens, purple palette, dark mode, e-ink filter

**Data**: `src/data/articles.json` (3100+ articles), `src/data/posts.json` (14 posts) — both gitignored, fetched from Airtable

### Design System
- **Primary**: Purple 700 `#725e7e`. Hover: `#4c3e54`. Body text: `#313131`
- **Fonts**: Cormorant Garamond (headings), Inter (body)
- **Dark mode**: `data-theme="dark"`, warm charcoal `#1e1a16`
- **Layout**: `.page-body` has 2px purple left border

### Mobile Workflow (IMPORTANT)

**Cloud sessions do NOT have Airtable or Cloudflare credentials. Do NOT try to build, fetch data, or deploy.**

1. **Make the code edit** — read the file, apply the change
2. **Show a before/after summary** so the change is clear on a small screen
3. **Commit to a branch and create a PR** — Brian will review, merge, and deploy from his Mac
4. If the user asks to deploy, tell them: "I'll create a PR. Pull and deploy from your Mac."

The data files (`articles.json`, `posts.json`) are gitignored and won't be present. That's fine — you don't need them to edit pages, components, or styles.

### Rules
- Keep edits focused — one change at a time for easy review
- Show brief before/after summaries
- NEVER try to build or deploy — create a PR instead
- For large refactors, suggest deferring to desktop
