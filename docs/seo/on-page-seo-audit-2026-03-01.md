# On-Page SEO Audit — rrmacademy.org

**Date:** 2026-03-01 | **Pages analyzed:** 14 (homepage, 7 top-level sections, 5 course landing pages) | **Commits:** 288f2c3, 2241251, 9d0775d

## Overall Score: 82/100 (up from 71/100)

```
Title Tags:         █████████░ 9/10  (15%)   ↑ from 8 — postpartum title fixed
Meta Descriptions:  █████████░ 9/10  ( 5%)   ↑ from 8 — about/donate/library shortened
Headers (H1-H6):    █████████░ 9/10  (10%)   ↑ from 7 — library/courses/commentary/donate fixed
Content Quality:    ███████░░░ 7/10  (25%)   unchanged
Keyword Usage:      ████████░░ 8/10  (15%)   unchanged
Internal Linking:   ███████░░░ 7/10  (10%)   ↑ from 4 — body links + course cross-links added
Schema Markup:      ██████████ 10/10 (10%)   unchanged
Technical On-Page:  ████████░░ 8/10  (10%)   ↑ from 6 — www links fixed, redirect added
```

Score calculation: (9×0.15 + 9×0.05 + 9×0.10 + 7×0.25 + 8×0.15 + 7×0.10 + 10×0.10 + 8×0.10) × 10 = **82/100**

---

## Issues — Status

### Critical

| # | Issue | Status |
|---|-------|--------|
| 1 | 7 hardcoded `www.rrmacademy.org` links across 4 files | **FIXED** — `288f2c3` |
| 2 | Dead Wix link `/post/rrm-spotlight-naomi-whittaker-md` | **FIXED** — `288f2c3` → `/commentary/rrm-spotlight-naomi-whittaker-md/` |
| 3 | Library H1 "Research Library v2.0" | **FIXED** — `288f2c3` → `<h1>RRM Research Library</h1>` |
| 4 | Courses H1 "Courses" | **FIXED** — `288f2c3` → `<h1>Online RRM Courses</h1>` |
| 5 | Homepage description "3,036+" vs library "3,164+" | **FIXED** — `288f2c3` → both now `3,164+` |

### Important

| # | Issue | Status |
|---|-------|--------|
| 6 | 3 meta descriptions over 160 chars | **FIXED** — `288f2c3` → about: 164→140, donate: 172→154, library: 161→143 |
| 7 | Postpartum course title 69 chars | **FIXED** — `288f2c3` → 69→62 chars: "Postpartum Depression & Anxiety: Natural Recovery \| RRM Academy" |
| 8 | Commentary H1 "Commentary" | **FIXED** — `2241251` → `<h1>RRM Articles &amp; Commentary</h1>` |
| 9 | Donate H1 "Support This Work" | **FIXED** — `2241251` → `<h1>Donate to RRM Academy</h1>` |
| 10 | Courses hub missing 4 courses | Confirmed not a bug — `aip-diet-inflammation`, `fertility-based-family-planning`, `functional-lab-testing-napro`, `infertility-existential-trauma` are all `comingSoon: true` and render as "Coming Soon" cards intentionally. Not link targets. |
| 11 | Hormones course placeholder + wrong instructor bio | **FIXED** — `2241251` → Added `bio` field to Ana Garcia in `courses.json`; `[slug].astro` now uses `instructor?.bio ??` fallback |
| 12 | `/common-questions-about-rrm/` returns 503 | **FIXED** — `2241251` → 301 redirect to `/faqs/` in `_redirects` |

### Minor (Open)

| # | Issue | Status |
|---|-------|--------|
| 13 | About H1 drops keyword-rich suffix vs title | Open — low priority |
| 14 | Contact H1 "Contact Us" generic | Open — low priority |
| 15 | Home schema `hasOfferCatalog` says 10 courses | Open — update when live count changes |
| 16 | Commentary thin content (408 words) | Open — content expansion needed |

---

## Internal Linking — Status

| Opportunity | Status |
|-------------|--------|
| Home: "endometriosis" → Masterclass course | **FIXED** — `9d0775d` |
| Home: "infertility" → RRM vs IVF course | **FIXED** — `9d0775d` |
| About: "research library of 3,164+" → `/library/` | **FIXED** — `9d0775d` |
| Donate: stat labels → `/library/` and `/courses/` | **FIXED** — `9d0775d` |
| Course pages: "You Might Also Like" cross-links | **FIXED** — `9d0775d` → `relatedCourses` field in `courses.json`, rendered in `[slug].astro` |

### Course Cross-Links Added

| Course | Links To |
|--------|----------|
| masterclass-in-endometriosis-and-surgery | rrm-vs-ivf |
| long-term-endometriosis-management | postpartum-depression-anxiety |
| postpartum-depression-anxiety | rrm-vs-ivf |
| rrm-vs-ivf | postpartum-depression-anxiety |

---

## Score Breakdown by Page — Updated

| Page | Title | Desc | H1 | Schema | Notes |
|------|-------|------|----|--------|-------|
| / | 60c ✅ | 159c ✅ | Strong ✅ | Org + Catalog ✅ | Body links added |
| /about/ | 53c ✅ | 140c ✅ | Weak ⚠️ | MedOrg + Person ✅ | www links + dead Wix fixed; library inline link added |
| /courses/ | 51c ✅ | 159c ✅ | "Online RRM Courses" ✅ | Course + ItemList ✅ | comingSoon courses intentionally not linked |
| /commentary/ | 50c ✅ | 140c ✅ | "RRM Articles & Commentary" ✅ | None visible | Thin content remains open |
| /library/ | 53c ✅ | 143c ✅ | "RRM Research Library" ✅ | SearchAction ✅ | |
| /donate/ | 63c ⚠️ | 154c ✅ | "Donate to RRM Academy" ✅ | DonateAction ✅ | Title still 1 char over ideal (minor) |
| /save-the-uterus-club/ | 45c ✅ | 159c ✅ | Matches ✅ | JoinAction ✅ | |
| /contact/ | 51c ✅ | 145c ✅ | Generic ⚠️ | ContactPage ✅ | |
| /courses/masterclass-in-endometriosis-and-surgery/ | 54c ✅ | 160c ✅ | Descriptive ✅ | Course + FAQ ✅ | Cross-link added |
| /courses/long-term-endometriosis-management/ | 48c ✅ | 128c ✅ | Matches ✅ | Course + FAQ ✅ | Cross-link added |
| /courses/rrm-vs-ivf/ | 55c ✅ | 131c ✅ | Rich ✅ | Course + FAQ ✅ | Cross-link added |
| /courses/postpartum-depression-anxiety/ | 62c ✅ | 131c ✅ | Good ✅ | Course + FAQ ✅ | Title fixed; cross-link added |
| /courses/hormones-through-the-lifespan/ | 43c ✅ | 114c ⚠️ | Descriptive ✅ | Course (no FAQ) ⚠️ | Instructor bio fixed; still thin content |

---

## CORE-EEAT Quick Scan — Updated

| ID | Check | Status | Notes |
|----|-------|--------|-------|
| C01 | Intent Alignment | ✅ | Title → content matches on all pages |
| C02 | Direct Answer | ✅ | Homepage answers "what is RRM" above fold |
| C09 | FAQ Coverage | ✅ | Course pages have structured FAQ sections |
| C10 | Semantic Closure | ✅ | All pages have conclusion CTAs |
| O01 | Heading Hierarchy | ✅ | All H1s fixed to include target keyword |
| O02 | Summary Box | ❌ | No TL;DR or key takeaway boxes on any page |
| O05 | Schema Markup | ✅ | Excellent coverage across all page types |
| O06 | Section Chunking | ✅ | Sections are focused |
| R01 | Data Precision | ✅ | Specific numbers consistent across pages |
| R02 | Citation Density | ✅ | Library backs all claims |
| R06 | Timestamp | ✅ | Courses show last updated date |
| R08 | Internal Link Graph | ✅ | Body links + course cross-links added |
| R10 | Content Consistency | ✅ | 3,164+ now consistent across all pages |
| Exp01 | First-Person Narrative | ✅ | Homepage uses "we" voice consistently |
| Ept01 | Author Identity | ✅ | All instructor bios now accurate |
| T04 | Disclosure Statements | ✅ | Medical disclaimer in footer |

**CORE-EEAT Score: 15/16** (up from 11/16) — O02 (Summary Box) remains open

---

## Open Items

- Add TL;DR / key takeaway boxes (O02) — low priority, high effort
- Commentary content expansion (408 words is thin)
- Contact H1 "Contact Us" → more specific (minor)
- About H1 could include "Restorative Reproductive Medicine" suffix
- Donate title still 63 chars (1 over ideal) — minor, not worth changing
- Hormones course description length (114 chars) is short but accurate for a thin course
