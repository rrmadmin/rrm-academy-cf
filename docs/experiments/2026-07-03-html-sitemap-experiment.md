# HTML Sitemap Experiment

**Started:** 2026-07-03
**Owner:** SEO
**Status:** deployed, awaiting re-measurement (~2026-07-31)

## Hypothesis

A footer-linked, plain-HTML sitemap concentrates internal link authority onto
deep library pages and reduces the share of `Crawled - currently not indexed`
(CNI) and `Discovered - currently not indexed` (DNI) statuses across the ~3,658
library article pages.

Claim under test (David G. Quaid):
https://x.com/DavidGQuaid/status/2072885191064891400

Mechanism: the library's deepest article pages are reachable today only through
paginated `/library/page/N/` lists and search. An always-footer-linked HTML
sitemap gives every published article a durable internal link two hops from the
global footer, which should improve crawl/index selection for the long tail.

## What shipped

- `/sitemap/` - hub. Plain server-rendered link lists (no JS, indexable, not
  noindexed): Sections, Guides & Pillars, Research Library (count + links to the
  paginated index pages + `/library/topics/`), Courses, Commentary, FAQs,
  Glossary (all terms), Core pages.
- `/sitemap/library/[page]/` - paginated flat list of ALL published library
  articles, alphabetical by title, 400 per page (11 pages at ~4,139 articles),
  each a plain `<a href="/library/<slug>/">`. Prev/next + numbered pagination at
  top and bottom. Breadcrumb back to `/sitemap/`. Indexable.
  - Source set is `fetchAllArticles()` - the identical collection
    `src/pages/library/[...slug].astro` builds pages from, so link targets can
    never point at a nonexistent slug. Thin pages (`word_count < 30`) that get
    `noindex` on their own page are still linked here; links are the point.
- Footer: a `Sitemap` link to `/sitemap/` in the global footer legal row, so
  every page on the site links to the hub.
- Router: `/sitemap` added to `ASTRO_ROUTES` in rrm-router (new root path).

## Baseline (2026-07-03)

Captured via the GSC URL Inspection API, deterministic seed `20260703`. Stored at
`docs/experiments/2026-07-03-html-sitemap-baseline.json`.

**Full sample (120 URLs):**

| Status | Count |
|--------|------:|
| Indexed | 111 |
| Crawled - currently not indexed (CNI) | 6 |
| Discovered - currently not indexed (DNI) | 2 |
| 404 | 1 |

**Zero-impression sample (80 URLs)** - library pages with 0 GSC impressions,
the population most likely to be unindexed:

| Status | Count |
|--------|------:|
| Indexed | 50 |
| Crawled - currently not indexed (CNI) | 8 |
| Discovered - currently not indexed (DNI) | 14 |
| Unknown to Google | 3 |
| noindex | 3 |
| 404 | 1 |
| Redirect | 1 |

## Method

1. Baseline captured (above), seed `20260703`, 120 full-sample + 80
   zero-impression-sample URLs via URL Inspection API.
2. Ship the HTML sitemap + footer link + router route (this change).
3. Wait ~4 weeks for Google to recrawl and re-select.
4. Re-run the identical inspection with the same seed (`20260703`) and same two
   samples. Compare CNI and DNI rates against baseline, focusing on the
   zero-impression sample.
5. Success = a measurable drop in CNI + DNI share in the zero-impression sample.
   Null result = flat rates (would falsify the concentration claim for this site).

## Known sitemap hygiene bugs (follow-ups, NOT fixed here)

Found during baselining. Track separately; out of scope for this branch.

- **XML sitemap lists a 404:**
  `https://rrmacademy.org/library/hormones-in-human-pregnancy-iv-plasma-progesterone-recumy4gmktz358tu/`
  is in the XML sitemap but returns 404.
- **Redirect error on a non-ASCII slug:**
  `https://rrmacademy.org/library/elevated-prenatal-anti-müllerian-hormone-reprograms-the-fetus-and-induces-polycy-recklrtb6mq5jqzzj/`
  has a redirect error (non-ASCII `ü` in the slug).
