# Technical SEO Audit — rrmacademy.org

**Date:** 2026-03-01 | **Pages analyzed:** 20 top-level + 3,374 in sitemap | **URLs mapped:** 188

## Overall Technical Health: 84/100

```
Crawlability:    ████████░░ 8/10
Indexability:    ███████░░░ 7/10
Security:        █████████░ 9/10
URL Structure:   ███████░░░ 7/10
Meta/OG:         █████████░ 9/10
Schema/JSON-LD:  ██████████ 10/10  ↑ from 9 — 6d5ad0a
Internal Links:  ███████░░░ 7/10   ↑ from 6 — 9d0775d
```

---

## Crawlability (8/10)

### Robots.txt

| Check | Status | Notes |
|-------|--------|-------|
| File exists | OK | 200 response |
| Valid syntax | OK | Cloudflare managed + custom rules |
| AI bots blocked | OK | ClaudeBot, GPTBot, CCBot, etc. all blocked |
| Auth pages blocked | OK | /login, /signup, /forgot-password, /reset-password, /account |
| Sitemap declared | OK | Points to sitemap-index.xml |
| Private paths blocked | OK | /api/, /library/saved, thank-you pages |

### Sitemap

| Check | Status | Notes |
|-------|--------|-------|
| Sitemap index exists | OK | sitemap-index.xml returns valid XML |
| Child sitemap exists | OK | sitemap-0.xml with 3,374 URLs |
| /sitemap.xml redirect | **FIXED** | `_redirects`: `/sitemap.xml -> /sitemap-index.xml 301` |
| lastmod present | **FIXED** | Added `serialize` callback in `astro.config.mjs` — all URLs now include build-date lastmod |
| Noindex pages excluded | OK | No login/signup/account pages in sitemap |
| URLs use trailing slash | OK | All sitemap URLs use trailing slash consistently |

---

## Redirects & URL Canonicalization (7/10)

### Redirect Matrix

| From | To | Status | Hops |
|------|----|--------|------|
| https://www.rrmacademy.org | https://rrmacademy.org | 301 | **FIXED — 1 hop** |
| http://rrmacademy.org | https://rrmacademy.org | 301 | 1 hop — OK |
| http://www.rrmacademy.org | https://rrmacademy.org | 301 | 2 hops — residual (TLS layer fires before redirect rule) |
| /about (no slash) | /about/ (with slash) | 308 | 1 hop — OK |

> **Note:** `http://www.rrmacademy.org` remains 2 hops because Cloudflare's "Always Use HTTPS" fires before redirect rules. The `https://www` case (the common case) was fixed to 1 hop via CF Redirect Rule.

### Canonical Tags

**FIXED** — `BaseLayout.astro` now normalizes all canonical URLs to always include a trailing slash, matching the sitemap and served URLs.

### Old Wix Slugs

**FIXED** (`1808009`) — Three dead Wix-era slugs discovered via naomiwhittaker.com Bio.site audit now redirect correctly:

| From | To | Code |
|------|----|------|
| `/3-tier-endometriosis-symptom-self-survey` | `/endo-survey/` | 301 |
| `/endometriosis-and-surgery-101` | `/courses/masterclass-in-endometriosis-and-surgery/` | 301 |
| `/rrm-vs-ivf` | `/courses/rrm-vs-ivf/` | 301 |

Both URL variants (with and without trailing slash) are covered.

---

## Security Headers (9/10)

| Header | Present | Value |
|--------|---------|-------|
| HSTS | OK | max-age=31536000; includeSubDomains |
| Content-Security-Policy | OK | Comprehensive policy (self + CF challenges + Stream) |
| X-Content-Type-Options | OK | nosniff |
| X-Frame-Options | OK | SAMEORIGIN |
| Referrer-Policy | OK | strict-origin-when-cross-origin |
| Permissions-Policy | OK | camera=(), microphone=(), geolocation=() |
| X-XSS-Protection | Missing | Deprecated — low priority |

---

## Meta Tags & H1 (9/10)

Every top-level page has:
- Unique `<title>` with brand suffix
- Custom `<meta name="description">`
- Exactly 1 `<h1>`
- Full Open Graph set
- Twitter Card tags (summary_large_image)

| Page | Title | Description | H1 | Schema Type |
|------|-------|-------------|----|-------------|
| / | RRM Academy \| Evidence-Based Reproductive Medicine Education | Custom | 1 | WebSite + EducationalOrganization |
| /about/ | About RRM Academy \| Restorative Reproductive Medicine | Custom | 1 | EducationalOrganization + 2x Person |
| /contact/ | Contact RRM Academy \| Questions About Courses & RRM | Custom | 1 | ContactPage |
| /courses/ | Online RRM Courses \| Endometriosis, Fertility, PCOS | Custom | 1 | ItemList + Course |
| /donate/ | Donate to RRM Academy \| Support Reproductive Medicine Education | Custom | 1 | DonateAction |
| /faqs/ | RRM FAQs \| Restorative Reproductive Medicine Questions | Custom | 1 | FAQPage |
| /library/ | RRM Research Library \| 3,164+ Peer-Reviewed Resources | Custom | 1 | CollectionPage |
| /commentary/ | RRM Articles \| Research, Policy & Patient Advocacy | Custom | 1 | Blog |
| /save-the-uterus-club/ | Save the Uterus Club \| Join the RRM Community | Custom | 1 | WebPage + JoinAction |
| /what-is-rrm/ | What is Restorative Reproductive Medicine (RRM)? | Custom | 1 | Article + MedicalWebPage + FAQPage |
| /endo-survey/ | Endometriosis Symptom Self-Survey \| RRM Academy | Custom | 1 | Quiz |
| /common-questions-about-rrm/ | — | — | — | 301 → /faqs/ |

**OG Images:** All pages fall back to `/images/og-default.png`. No page-specific OG images (open opportunity).

---

## Internal Links (7/10)

### Navigation Coverage

| Page | Header Nav | Mobile Nav | Footer | Linked From Body |
|------|-----------|-----------|--------|-----------------|
| /library/ | OK | OK | OK | Homepage, about, donate |
| /commentary/ | OK | OK | OK | Homepage |
| /courses/ | OK | OK | OK | Homepage, about, donate |
| /save-the-uterus-club/ | OK | OK | OK | About |
| /about/ | — | OK | OK | — |
| /contact/ | — | OK | OK | — |
| /faqs/ | — | OK | OK | — |
| /endo-survey/ | — | OK | OK | — |
| /donate/ | Button | Button | OK | — |
| /what-is-rrm/ | MISSING | MISSING | **FIXED** | About page + footer |
| /common-questions-about-rrm/ | — | — | — | 301 → /faqs/ |

### Remaining Gaps

- `/what-is-rrm/` — pillar page for the primary keyword. Added to footer nav. Still missing from header nav and mobile nav.

---

## Schema / JSON-LD (10/10)

All rich result blockers resolved in `6d5ad0a`. Full details in `docs/seo/schema-audit-2026-03-01.md`.

| Change | Commit |
|--------|--------|
| Homepage: `WebSite` + `SearchAction` added (sitelinks search box eligibility) | 6d5ad0a |
| Course pages: `image`, `isAccessibleForFree`, `offers`, `CourseInstance`, `BreadcrumbList` added | 6d5ad0a |
| Commentary posts: `mainEntityOfPage` + `BreadcrumbList` added (Article rich result eligibility) | 6d5ad0a |
| `what-is-rrm`: `image` + typed `mainEntityOfPage` + `BreadcrumbList` added | 6d5ad0a |
| Library: `SearchAction` removed (moved to homepage `WebSite` node) | 6d5ad0a |
| All pages: trailing slashes on `url` fields; `publisher`/`provider` use `@id` references | 6d5ad0a |

---

## Priority Issues — Status

| # | Issue | Status |
|---|-------|--------|
| 1 | Canonical/sitemap trailing slash mismatch | **FIXED** — `BaseLayout.astro` |
| 2 | `/common-questions-about-rrm/` orphan | **FIXED** — 301 redirect to `/faqs/` in `_redirects` |
| 3 | `http://www` redirect chain (2 hops) | Partially fixed — `https://www` now 1 hop; `http://www` remains 2 hops (Cloudflare TLS ordering) |
| 4 | `/what-is-rrm/` missing from navigation | **PARTIAL** — added to footer nav; still missing from header nav and mobile nav |
| 5 | No lastmod in sitemap | **FIXED** — build-date lastmod added via `astro.config.mjs` serialize callback |
| 6 | `/sitemap.xml` returns 404 | **FIXED** — `_redirects` 301 to `/sitemap-index.xml` |
| 7 | `[CITE]` and `[YEAR]` placeholders | **FIXED** — all placeholders replaced with real citations during pillar article expansion |
| 8 | No page-specific OG images | Open |
| 9 | Community page double H1 | Open — low priority (page is noindex) |

---

## Open Items

- ~~Add `/what-is-rrm/` to footer nav~~ — done; still needs header nav and mobile nav
- ~~Replace `[CITE]` / `[YEAR]` placeholders in content~~ — done
- Create page-specific OG images for homepage, courses hub, and top course pages
