# GSC Coverage Improvements -- Design

> Companion to `docs/superpowers/plans/2026-05-20-gsc-coverage-improvements.md`.
> Execution log lives at the bottom of this file; design intent + the per-bucket
> contract live above it.

## Purpose

Address the gaps surfaced by the 2026-05-20 Google Search Console coverage
sheet (`Spreadsheet ID 112aGo51yAMmIsRQFQbopDaKjRvIMBuXBaS8joR2xCnc`). Buckets
A-H+ each take a class of finding (404s, redirect chains, robots-policy gaps,
malformed URLs in the index, sitemap crawl status) and either fix the source
of the regression or document why no fix is warranted. Every change ships on
its own `claude/gsc-cov-<letter>` branch so the rollback unit is small.

## Bucket map

| Bucket | Scope | Owning repo(s) |
|--------|-------|----------------|
| A | 404 + 410 sweep, ghost-URL 301 reroutes, library lowercase contract | rrm-router |
| B | Trailing-slash canonicalisation audit + docs | rrm-router (docs) |
| C | robots.txt course-step disallow + blocking landing smoke | rrm-academy-cf |
| D | (reserved) | -- |
| E | (reserved) | -- |
| F | (reserved) | -- |
| G | `?topic=` URL-encoding defensive strip | rrm-academy-cf |
| H | Sitemap "not crawled" investigation (audit-only) | -- |
| H+ | Weekly GSC snapshot scaffold | rrm-academy-cf |

## Execution log

### Bucket B (2026-05-21)

- Router-level 301 at `rrm-router/src/index.js:598-618` (GET-only,
  `ASTRO_ROUTES`-gated, carve-outs for `/api/*`, `/mcp`, dotted paths) was
  already on `main`. Spot-checked 10 representative URLs (`/library`,
  `/commentary`, `/courses`, `/glossary`, `/faqs`, `/what-is-rrm`,
  `/naprotechnology`, `/about`, `/contact`, `/courses/aip-diet-inflammation`)
  -- all returned **308** with `server: cloudflare` + a slashed `Location`
  header. The 308 (not 301) comes from CF Pages' `trailingSlash: 'always'`
  baked `_redirects`; the router 301 is the fallback for `ASTRO_ROUTES`
  paths that bypass Pages.
- `rrm-academy-cf/astro.config.mjs:51` already declares
  `trailingSlash: 'always'`. No change required.
- Sitemap audit (2026-05-21):

  | Sitemap | URLs | Missing `/` |
  |--------|-----:|-----:|
  | sitemap-pillars.xml | 12 | 0 |
  | sitemap-commentary.xml | 23 | 0 |
  | sitemap-faqs.xml | 26 | 0 |
  | sitemap-courses.xml | 11 | 0 |
  | sitemap-policies.xml | 4 | 0 |
  | sitemap-library-t3.xml | 2646 | 0 |
  | sitemap-library-t2.xml | 829 | 0 |
  | sitemap-0.xml | 218 | 0 |
  | sitemap-index.xml | 8 | 0 |

  All 3,777 `<loc>` entries terminate with `/` (or `.xml` for index entries).
  No template fix required in `src/integrations/library-sitemaps.mjs` or
  `astro.config.mjs`.

- Documented in `rrm-router/RRM Router PRD/SEO-Preservation.md` (commit
  `5d0851a` on `claude/gsc-cov-b`).

### Bucket C (2026-05-21)

- `public/robots.txt`: added `Disallow: /courses/*/*/` under the
  `User-agent: *` block. The user's stated pattern `/courses/*/*` is unsafe
  -- robots.txt `*` matches the empty string, so `/courses/<slug>/` would
  match (first `*` = slug, second `*` = empty). The slash-terminated variant
  requires a non-empty second segment AND a trailing `/`, which exempts
  single-segment landings as intended. Verified live against all 10
  published landings (all returned 200 + no noindex meta).
- New blocking smoke `scripts/smoke-course-landings.mjs`. Reads slugs from
  `src/data/courses.json` filtered to `!comingSoon`; for each, asserts the
  `/courses/<slug>/` URL returns 200 AND has no
  `<meta name="robots" ... noindex>`. Exits non-zero if any fails.
- Wired into `.github/workflows/deploy.yml` as `Smoke: course landings
  indexable` between `Submit to IndexNow` and the existing non-blocking
  `Post-deploy render quality` step.

### Bucket G (2026-05-21)

GSC surfaced `https://rrmacademy.org/library?topic=Infertility %3E
Epidemiology %3E \nFecundability`. Exhaustive search:

- `src/`, `functions/`, `scripts/`: only 2 sites generate `?topic=` URLs
  (`src/components/TopicTag.astro:6` and `src/pages/library/[...slug].astro:46`).
  Both already use `encodeURIComponent`. Neither can produce the literal
  space + literal `\n` form from a clean topic input.
- D1 `rrm-library.articles.topics`: zero rows containing `CHAR(10)` or
  `CHAR(13)` (newline / carriage return).
- D1 `rrm-library.article_bodies.body`: zero rows referencing a
  `topic=...Epidemiology` or `topic=...Fecundability` URL.
- D1 `rrm-auth.posts.content`: zero rows.
- D1 `rrm-auth.glossary_term.body_html`: zero rows.
- D1 `rrm-auth.faq.{basic_answer, schema_answer, published_answer}`: zero rows.
- The canonical topic `Infertility > Epidemiology > Fecundability` exists
  cleanly on `articles.id = recybuaB5ec2ElZco` (slug
  `elusive-fertility-fecundability-and-assisted-conception-in-perspective-...`).

Verdict: the malformed URL originated outside our codebase (a mangled
external share, social-card crawler artefact, or GSC display rendering of
an underlying clean URL). `/library` already emits
`<link rel="canonical">` to `/library` (no query); `topic` is in
`check-canonical-lockdown.mjs`'s ALLOWED_PARAMS; Google folds these
query variants automatically.

Shipped a defensive `.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()`
at both encoder sites so any future D1 ingest that lets a control
character into `articles.topics` cannot regress. No production URL today
contains the bad input, so this is a guard-rail not a behaviour change.

### Bucket H (2026-05-21) -- audit only, no commit

Pulled the 1,001-row `not crawled` tab from the GSC coverage sheet
(`Spreadsheet ID 112aGo51yAMmIsRQFQbopDaKjRvIMBuXBaS8joR2xCnc`,
`range="not crawled!A:B"`). 8 sitemap URLs surfaced:

| URL | HTTP | Content-Type | Size | Notes |
|-----|-----:|--------------|-----:|-------|
| `https://rrmacademy.org/sitemap-courses.xml` | 200 | application/xml | 1147 B | OK |
| `https://rrmacademy.org/sitemap-policies.xml` | 200 | application/xml | 581 B | OK |
| `https://rrmacademy.org/sitemap-commentary.xml` | 200 | application/xml | 3730 B | OK |
| `https://rrmacademy.org/sitemap-faqs.xml` | 200 | application/xml | 4237 B | OK |
| `https://rrmacademy.org/sitemap-pillars.xml` | 200 | application/xml | 1467 B | OK |
| `https://rrmacademy.org/sitemap-library-t3.xml` | 200 | application/xml | 528 KB | OK |
| `https://rrmacademy.org/sitemap-0.xml` | 200 | application/xml | 25 KB | OK |
| `https://rrmacademy.org/sitemap.xml` | 301 | text/plain | 33 B | `Location: /sitemap-index.xml` (correct legacy redirect) |

All 8 are healthy. Cross-checks:

- robots.txt declares `Sitemap: https://rrmacademy.org/sitemap-index.xml`.
- `sitemap-index.xml` references all 8 chunked sitemaps (plus
  `sitemap-library-t2.xml`).
- All chunks served as `application/xml` (not text/html, not a soft-404).

**Why they show as "not crawled":** sitemap XML files are fetched by
Google's sitemap-processing subsystem (visible under GSC > Sitemaps), not
the same crawl queue that produces the "not crawled" classification in
the URL inspection / coverage reports. They legitimately have no "last
crawled" timestamp in that report because Google does not index sitemap
XML files in search results. **No action required**; not a coverage
regression, not a code/config bug. No commit issued for Bucket H.

### Bucket H+ (pending) -- see plan section

Scaffold for weekly GSC snapshot script; explicitly stubbed
`getGSCSummary()` because the GSC API has no aggregate-coverage endpoint.
Lands on `claude/gsc-cov-h-plus`.
