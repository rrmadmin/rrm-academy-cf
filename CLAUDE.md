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

### Mobile Workflow

Editing from the Claude mobile app uses a cloud VM. It has no local credentials.

**Push to your `claude/` branch as normal.** GitHub Actions auto-builds, deploys to the live site (~2 min), and merges your changes into `main` automatically.

#### Steps:
1. Make the code edit
2. Show a brief before/after summary
3. Commit and push to your `claude/` branch
4. Tell the user: "Pushed. Your site will be live in ~2 minutes."

#### Do NOT:
- Run `npm run build`, `npm run fetch-data`, or `wrangler` — the cloud VM has no credentials, the automated pipeline handles all of that

The data files (`articles.json`, `posts.json`) are gitignored and won't be in the cloud VM. That's expected — the pipeline fetches them automatically.

### Rules
- Keep edits focused — one change at a time for easy review
- Show brief before/after summaries
- For large refactors, suggest deferring to desktop
- **Before editing styles or layout**, consult `STYLE-GUIDE.md`. Do NOT read the whole file — read only the section(s) relevant to your task using the line ranges below:

#### STYLE-GUIDE.md Section Index

| Section | Lines | Read when... |
|---------|-------|-------------|
| Color System | 52–157 | Adding/changing colors, tokens, dark mode values |
| Typography | 158–203 | Changing fonts, sizes, hero text, headings |
| Spacing & Layout | 204–260 | Changing padding, gaps, margins, containers |
| Borders & Radii | 261–281 | Changing border-radius, border styles |
| Buttons | 326–360 | Adding/modifying buttons |
| Links | 361–394 | Changing link styles |
| Forms | 395–428 | Editing form inputs, validation states |
| Cards | 429–468 | Modifying article cards, blog cards |
| Page Layout Patterns | 653–758 | Changing page structure, wrappers, sections |
| Header | 759–799 | Editing navigation, header elements |
| Navigation Icons | 800–835 | Adding/changing nav or footer icons |
| Footer | 836–867 | Editing footer layout or links |
| Dark Mode | 868–895 | Any dark mode changes |
| Accessibility | 911–957 | Adding interactive elements, icons, forms |
| CSS Naming Convention | 988–1010 | Creating new CSS classes |

Never introduce hardcoded colors, spacing, or font sizes that bypass existing design tokens.
