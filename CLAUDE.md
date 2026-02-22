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
