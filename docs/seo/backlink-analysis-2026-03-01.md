# Backlink Analysis — rrmacademy.org

**Date:** 2026-03-01 | **Method:** Web search + page scraping (no Ahrefs/Moz — DA estimates approximate)

---

## Profile Overview

| Metric | Value | Notes |
|--------|-------|-------|
| Confirmed referring domains | ~5 | fabmbase.org, rrm.foundation, instagram.com, facebook.com, vimeo.com |
| Dofollow links | ~2-3 | fabmbase.org (confirmed), rrm.foundation |
| Social profiles | 3+ | Instagram, Facebook, Threads (nofollow) |
| Unlinked brand mentions | 6+ | NW, STAT, NYT, The Cut, 19th News, MedPage Today |

**Profile health:** Thin but clean. No toxic links. Strong content fundamentals with minimal off-site authority — typical for a 2023-launched site migrated from Wix.

### Authority Distribution (Confirmed)

```
DA 70+:   ░░░░░░░░░░ 0 confirmed
DA 50-69: ░░░░░░░░░░ 0 confirmed
DA 30-49: ██░░░░░░░░ fabmbase.org (~35)
DA 10-29: █████░░░░░ rrm.foundation (~20)
```

---

## Confirmed Backlinks

| Source | Est. DA | Anchor | Target | Follow |
|--------|---------|--------|--------|--------|
| fabmbase.org | ~35 | "RRM Academy \| restorative reproductive medicine" | rrmacademy.org/ | Dofollow |
| rrm.foundation | ~20 | "RRM Academy", "Explore Academy →", "Search Library →" | /, /library/, /save-the-uterus-club/ | Dofollow |
| naomiwhittaker.com | ~10 | Course titles, survey | /endo-survey/, /courses/masterclass-in-endometriosis-and-surgery/, /courses/rrm-vs-ivf/ | Dofollow (Bio.site) |
| naomiwhittakermd.com | ~10 | Same as above (same Bio.site page) | Same | Dofollow (Bio.site) |
| instagram.com | N/A | Brand | rrmacademy.org | Nofollow |
| facebook.com | N/A | Brand | rrmacademy.org | Nofollow |
| threads.com | N/A | Brand | rrmacademy.org | Nofollow |
| vimeo.com | ~80 | Course clip titles | — | Nofollow |

### Issues Found and Fixed

**rrm.foundation** — still links to `www.rrmacademy.org/save-the-uterus-club` (www variant, redirect chain). Update on the foundation site.

**naomiwhittaker.com / naomiwhittakermd.com** — Bio.site page (`bio.site/napro_fertility_surgeon`). Both domains resolved to same page. Three rrmacademy.org links found:

| Old link | Problem | Fix |
|----------|---------|-----|
| `/3-tier-endometriosis-symptom-self-survey?userorigin=biosite` | 3-hop redirect chain | Redirects added `_redirects` → `/endo-survey/`; Brian updated Bio.site link |
| `/endometriosis-and-surgery-101?SQF_SOURCE=biosite` | 404 (old Wix slug) | Redirects added → `/courses/masterclass-in-endometriosis-and-surgery/`; Brian updated |
| `/rrm-vs-ivf` | 404 (missing `/courses/` prefix + trailing slash) | Redirects added → `/courses/rrm-vs-ivf/`; Brian updated |

**Redirects committed:** `1808009` — all old Wix slugs now redirect correctly regardless of who else may be linking to them.

**Bio.site links updated by Brian** — links now point directly to correct canonical URLs, no hops.

---

## Toxic Link Analysis

**Risk level: None.** Profile is thin but entirely clean.

| Risk Type | Count |
|-----------|-------|
| Spammy domains | 0 |
| PBN suspected | 0 |
| Link farms | 0 |
| Redirect chain links | 1 (rrm.foundation → www variant, pending fix on rrm.foundation site) |

No disavow needed.

---

## Unlinked Brand Mentions

| Site | Est. DA | Mention | Status |
|------|---------|---------|--------|
| naturalwomanhood.org | ~50 | "Dr. Naomi Whittaker of RRM Academy" in RRM overview article | No link — high priority |
| statnews.com | ~78 | Arkansas RRM law coverage (2025) | No RRM Academy mention |
| nytimes.com | ~93 | "Republicans backing RRM" (Aug 2025) | No org links |
| thecut.com | ~75 | RRM explainer article | No org-specific mentions |
| 19thnews.org | ~70 | RRM clinics coverage (Nov 2025) | No org links |
| medpagetoday.com | ~72 | Arkansas RRM law (2025) | No org links |

---

## Competitor Landscape

| Competitor | Est. DA | Type |
|------------|---------|------|
| naturalwomanhood.org | ~50 | Patient content, high social reach |
| naprotechnology.com | ~45 | NaProTechnology home base |
| saintpaulvi.com | ~50 | Pope Paul VI Institute (NaPro origin) |
| iirrm.org | ~30 | International RRM credentialing |
| irrma.org | ~25 | US RRM physician org, CME |
| factsaboutfertility.org | ~40 | FACTS — has intro RRM course |
| fabmbase.org | ~35 | Already links to us |

---

## Link Building Opportunities — Prioritized

### Tier 1: Quick Wins

**Natural Womanhood — unlinked mention**
- RRM overview article names "Dr. Naomi Whittaker of RRM Academy" with no link
- Dr. Naomi has an author profile and published a 2018 article on NW — relationship exists
- Ask: add rrmacademy.org to her author page + inline link on the RRM article
- Effort: Low | Impact: High (DA ~50, exact audience match)

**FAbM Base — expand existing link**
- Already links to `www.rrmacademy.org/` (www variant, should be non-www)
- Resource page could also link to `/library/` and `/courses/` specifically
- Effort: Very Low | Impact: Medium

### Tier 2: Relationship Outreach

**IIRRM (iirrm.org)**
- International RRM org with an online education section — rrmacademy.org not listed
- Effort: Medium | Impact: Medium

**IRRMA (irrma.org)**
- US physician org, holds CME case discussions — RRM Research Library is a natural resource link
- Effort: Medium | Impact: Medium

**FACTS (factsaboutfertility.org)**
- Has their own "Introduction to RRM" course — should cross-reference RRM Academy
- DA ~40, relevant audience
- Effort: Medium | Impact: Medium-High

### Tier 3: Media / Press

RRM got national coverage in 2025: NYT (DA 93), STAT (DA 78), The Cut (DA 75), 19th News (DA 70), MedPage Today (DA 72), Stateline. None linked to RRM Academy specifically.

Strategy: Identify the reporters from 2025 coverage; pitch Dr. Naomi as a clinical expert source for follow-up or new RRM coverage. Being quoted = likely editorial link from DA 70-93 publication.

The nonprofit/free-access model and Dr. Naomi's UPMC affiliation are strong credentialing angles for press pitches.

**ASRM / ACOG** — adversarial to RRM; do not pursue.

### Tier 4: Content Assets for Passive Links

- "Find an RRM Physician" directory page — other orgs would link to this as a resource
- Expanded `/what-is-rrm/` pillar content — link magnet for RRM explainer searches

---

## Action Checklist

### Done
- [x] Added `_redirects` for all old Wix slugs (`commit 1808009`)
- [x] naomiwhittaker.com / naomiwhittakermd.com Bio.site links updated by Brian

### This Week
- [ ] Email NW to link Dr. Naomi's author page + RRM overview article → rrmacademy.org
- [ ] Email FAbM Base to update link from `www.rrmacademy.org` to `rrmacademy.org` and add library/courses links
- [ ] Fix rrm.foundation link: `www.rrmacademy.org/save-the-uterus-club` → `rrmacademy.org/save-the-uterus-club/`

### This Month
- [ ] Reach out to IIRRM and IRRMA about RRM Academy listing in their education resources
- [ ] Contact FACTS about cross-referencing the research library
- [ ] Identify 5-10 FABM blogs linking to competitors; pitch RRM Academy

### This Quarter
- [ ] Pitch Dr. Naomi to 2025 RRM reporters (STAT, The Cut, 19th News, MedPage)
- [ ] Pitch new Dr. Naomi guest article to Natural Womanhood
- [ ] Evaluate building a "Find an RRM Physician" directory as a link-earning asset

---

## Strategic Note

The 2025 RRM media wave (driven by Arkansas insurance mandate) raised the profile of RRM nationally without linking to RRM Academy. That window narrows over time. A targeted outreach effort — Dr. Naomi as expert source, nonprofit free-education angle — is the highest-ROI link building move currently available.
