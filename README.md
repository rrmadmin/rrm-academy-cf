# RRM Academy

Online education platform for restorative reproductive medicine. Built with Astro + Cloudflare Pages.

**Live site:** https://rrmacademy.org

## Stack

| Layer | Tech |
|-------|------|
| Framework | Astro 5.3 (static output) |
| Hosting | Cloudflare Pages |
| Functions | CF Pages Functions (edge, no Node) |
| Database | Cloudflare D1 (SQLite) |
| Search | Pagefind (build-time index) |
| Auth | DIY sessions via D1 + PBKDF2 |
| Payments | Stripe |
| Video | Vimeo embed |
| Content | Airtable (library + blog) |
| Router | CF Worker at `~/iCode/projects/rrm-router/` |

## Deploy

Push to `main` — Cloudflare Pages auto-builds and deploys. No manual step needed.

Build command: `npm run build` (`astro build && npx pagefind --site dist`)

## Local Dev

```bash
npm install
npm run dev          # Astro dev server (no CF Functions)
npm run preview      # Wrangler preview (includes CF Functions + D1)
```

To refresh Airtable data before building:

```bash
AIRTABLE_PAT=xxx npm run fetch-all
npm run build
```

## Reference

| File | What it covers |
|------|----------------|
| `CLAUDE.md` | Architecture, site map, API endpoints, security guard |
| `STYLE-GUIDE.md` | Design tokens, typography, component patterns |
| `docs/plans/backlog.md` | Active backlog and project status |
| `docs/architecture/airtable-cf-pipeline.md` | Airtable → CF data pipeline |
| `wrangler.toml` | D1, KV, R2 bindings |
