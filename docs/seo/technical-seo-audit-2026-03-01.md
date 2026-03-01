# Technical SEO Audit — rrmacademy.org

**Date:** 2026-03-01 | **Pages analyzed:** 20 top-level + 3,374 in sitemap | **URLs mapped:** 188

## Overall Technical Health: 82/100

```
Crawlability:    ████████░░ 8/10
Indexability:    ███████░░░ 7/10
Security:        █████████░ 9/10
URL Structure:   ███████░░░ 7/10
Meta/OG:         █████████░ 9/10
Schema/JSON-LD:  █████████░ 9/10
Internal Links:  ██████░░░░ 6/10
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
| / | RRM Academy \| Evidence-Based Reproductive Medicine Education | Custom | 1 | EducationalOrganization |
| /about/ | About RRM Academy \| Restorative Reproductive Medicine | Custom | 1 | EducationalOrganization + 2x Person |
| /contact/ | Contact RRM Academy \| Questions About Courses & RRM | Custom | 1 | ContactPage |
| /courses/ | Online RRM Courses \| Endometriosis, Fertility, PCOS | Custom | 1 | ItemList + Course |
| /donate/ | Donate to RRM Academy \| Support Reproductive Medicine Education | Custom | 1 | DonateAction |
| /faqs/ | RRM FAQs \| Restorative Reproductive Medicine Questions | Custom | 1 | FAQPage |
| /library/ | RRM Research Library \| 3,164+ Peer-Reviewed Resources | Custom | 1 | CollectionPage + SearchAction |
| /commentary/ | RRM Articles \| Research, Policy & Patient Advocacy | Custom | 1 | Blog |
| /save-the-uterus-club/ | Save the Uterus Club \| Join the RRM Community | Custom | 1 | WebPage + JoinAction |
| /what-is-rrm/ | What is Restorative Reproductive Medicine (RRM)? | Custom | 1 | Article + MedicalWebPage + FAQPage |
| /endo-survey/ | Endometriosis Symptom Self-Survey \| RRM Academy | Custom | 1 | Quiz |
| /common-questions-about-rrm/ | — | — | — | 301 → /faqs/ |

**OG Images:** All pages fall back to `/images/og-default.png`. No page-specific OG images (open opportunity).

---

## Internal Links (6/10)

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
| /what-is-rrm/ | MISSING | MISSING | MISSING | About page only |
| /common-questions-about-rrm/ | — | — | — | 301 → /faqs/ |

### Remaining Gaps

- `/what-is-rrm/` — pillar page for the primary keyword. Not in header, footer, or mobile nav. Only linked from the about page as inline text.

---

## Priority Issues — Status

| # | Issue | Status |
|---|-------|--------|
| 1 | Canonical/sitemap trailing slash mismatch | **FIXED** — `BaseLayout.astro` |
| 2 | `/common-questions-about-rrm/` orphan | **FIXED** — 301 redirect to `/faqs/` in `_redirects` |
| 3 | `http://www` redirect chain (2 hops) | Partially fixed — `https://www` now 1 hop; `http://www` remains 2 hops (Cloudflare TLS ordering) |
| 4 | `/what-is-rrm/` missing from navigation | Open |
| 5 | No lastmod in sitemap | **FIXED** — build-date lastmod added via `astro.config.mjs` serialize callback |
| 6 | `/sitemap.xml` returns 404 | **FIXED** — `_redirects` 301 to `/sitemap-index.xml` |
| 7 | `[CITE]` and `[YEAR]` placeholders | Open — visible in `/what-is-rrm/` and `/common-questions-about-rrm/` content |
| 8 | No page-specific OG images | Open |
| 9 | Community page double H1 | Open — low priority (page is noindex) |

---

## Open Items

- Add `/what-is-rrm/` to footer nav (high value pillar page)
- Replace `[CITE]` / `[YEAR]` placeholders in content
- Create page-specific OG images for homepage, courses hub, and top course pages
