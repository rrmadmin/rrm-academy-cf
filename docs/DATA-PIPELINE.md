# Data Pipeline

## Build Process

```
Airtable → fetch scripts → JSON files → Astro build → Pagefind → dist/
```

### Fetch Data

```bash
# Library articles (3,162 records from greenbase)
AIRTABLE_PAT=xxx node src/lib/fetch-data.mjs
# → src/data/articles.json (gitignored)

# Commentary blog posts (14 posts from Editorial Commentary base)
node src/lib/fetch-blog-data.mjs
# → src/data/posts.json (gitignored)

# FAQ pages (26 published from FAQ Knowledge Base)
node src/lib/fetch-faq-data.mjs
# → src/data/faqs.json (gitignored)
# Cross-references citations in Published Answers against articles.json

# All at once
npm run fetch-all
```

### Build

```bash
npm run build
# Runs: astro build && npx pagefind --site dist
```

### Deploy

```bash
CLOUDFLARE_ACCOUNT_ID="ecf2c5bc8b5ebd634bcb587b3890910a" \
  npx wrangler pages deploy dist --project-name rrm-academy
```

## Airtable Sources

| Data | Base | Table | Script |
|------|------|-------|--------|
| Library articles | greenbase | BIFID | `src/lib/fetch-data.mjs` |
| Blog posts | `app1CKV1heL0qH2Oz` | `tblS8q3XHj6mhwxvl` | `src/lib/fetch-blog-data.mjs` |
| FAQs | `appIiligSFffFWwGA` | `tblLSbusrE9jCfKEn` + `tblPa4CzwFBaCQTwP` | `src/lib/fetch-faq-data.mjs` |
| Site pages | `appYiF1S4zFafiE3k` | `tblhktcClrM3MBZrc` | (manual, 7 records) |

## GitHub Actions

Daily rebuild at 6 AM ET (currently blocked by billing).
Mobile edits push to `claude/` branch → auto-build + merge to `main`.

## Key Files

- `src/data/articles.json` — 3,162 library articles (gitignored)
- `src/data/posts.json` — 14 blog posts (gitignored)
- `src/data/faqs.json` — 26 published FAQs (gitignored)
- `src/lib/fetch-data.mjs` — Airtable fetch for library
- `src/lib/fetch-blog-data.mjs` — Airtable fetch for blog
- `src/lib/fetch-faq-data.mjs` — Airtable fetch for FAQs (+ library cross-ref)
- `src/lib/faq.ts` — FAQ types and helpers
- `wrangler.toml` — CF Pages config + KV bindings
