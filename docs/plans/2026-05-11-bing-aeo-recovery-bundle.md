# Bing AEO Recovery Bundle — 2026-05-11

> Consolidated plan generated from the 2026-05-11 Bing Webmaster Tools AI grounding report audit.
> Status: drafted, awaiting Brian's explicit approval on production D1 mutations.

## Summary of findings

Bing/Copilot AI grounding cites rrmacademy.org **1,833 times across 214 URLs**. Three structural leaks identified:

| Leak | Citations | Status | Plan |
|---|---|---|---|
| `www.rrmacademy.org/library/...` 404s (slug divergence) | ~94 | drafted | rrm-router patch (28 rec-ID redirects + 9 slug-redirect entries + regex extension) |
| Archived canonical regulator/registry records (HFEA, RTAC, ANZARD 2023, Q-IVF 2025, etc.) | ~270 | **drafted, blocked** | Un-archive 7 D1 records + remove 4 router 410 entries + rebuild |
| Isthmocele commentary lacks FAQ schema (high-AEO post) | indirect | drafted | Append FAQ section + commentary template patch (FAQPage detection) |

Plus already-submitted IndexNow ping (HTTP 200) for 20 priority apex URLs.

## Deliverables (artifacts ready)

1. **rrm-router patch** — `~/iCode/projects/rrm-router/docs/2026-05-11-bing-aeo-recovery-patch.md`
2. **REC_ID_REDIRECTS map** — `~/iCode/projects/rrm-router/docs/2026-05-11-rec-id-redirects.js.proposed` (28 entries)
3. **Pattern B slug redirects** — `~/iCode/projects/rrm-router/docs/2026-05-11-slug-redirects-additions.js.proposed` (9 entries)
4. **ART registry hub spec** — `~/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-art-registries-topic-hub.md`
5. **ART registry hub body draft** — `~/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-art-registries-hub-draft.md` (Gianna voice, 198 lines, 12 proof gates passed)
6. **ART registry curated SSOT** — `~/iCode/projects/rrm-academy-cf/src/data/art-registries.json` (14 canonical singletons)
7. **Isthmocele FAQ additions** — `~/iCode/projects/rrm-academy-cf/docs/plans/2026-05-11-isthmocele-faq-additions.md` (5 FAQs + reusable template patch)

## Blocked production mutations (awaiting Brian's explicit approval)

### A. D1 status flip on rrm-library (7 records)

```sql
UPDATE articles
SET status='published', updated_at=datetime('now')
WHERE id IN (
  'rec0N2BG9oAt3t96t1If',  -- HFEA Code of Practice 9th edition (122 cites)
  'recTml78LNzEKUjpgyKw',  -- RTAC Code of Practice 2024 (65 cites)
  'recyMOTFmJgbDoQOgyLz',  -- ANZARD 2023
  'recfwGutrJ1KGQ6ZyChG',  -- Q-IVF 2025
  'rec6C2Cj4qxNMxoseSBp',  -- RLA 2021
  'recv99NMs5R9Mzv1ahKw',  -- HFE Act 2008
  'recLmwAyq0R8wTshlvxg'   -- HFE Act 1990
) AND status='archived';
```

All 7 records have short abstracts (440–1,256 chars) already in summary form. No public page renders article_bodies; restoration does not expose any full-text content. Per Brian's "short summary + link only" rule.

### B. rrm-router 410 list removal (4 entries)

In `~/iCode/projects/rrm-router/src/index.js`, remove these from the GONE_410 array:
- `/library/human-fertilisation-and-embryology-act-1990-lmwayq0r`
- `/library/human-fertilisation-and-embryology-act-2008-v99nms5r`
- `/library/rla-2021-registro-latinoamericano-de-reproduccion-asistida-latin-american-regist-6c2cj4qx`
- `/library/rtac-code-of-practice-for-reproductive-technology-units-australia-and-new-zealan-tml78lnz`

### C. D1 post body update on rrm-auth (1 record)

Append the FAQ section to the isthmocele commentary in `posts.content`. Full markdown payload in the isthmocele FAQ plan file.

### D. Rebuild + IndexNow

After A + B + C: trigger `gh workflow run deploy.yml`, verify URLs return 200, IndexNow-ping the 14 canonical registry URLs + the isthmocele commentary.

## Execution plan (post-approval)

1. **Single PR in rrm-academy-cf** (`claude/2026-05-11-bing-aeo-recovery`):
   - `src/pages/commentary/[...slug].astro` — FAQPage detection patch
   - `src/data/art-registries.json` — curated SSOT (already committed)
   - `src/pages/art-registries-and-codes/index.astro` — new pillar page (using Gianna's draft + standard pillar template)
   - `docs/plans/2026-05-11-*.md` — all 4 planning artifacts
2. **Single PR in rrm-router** (`bing-aeo-recovery`):
   - `src/index.js` — regex extension + REC_ID_REDIRECTS import + rec-ID fallback block + remove 4 entries from 410 list
   - `src/rec-id-redirects.js` — new (28 entries)
   - `src/slug-redirects.js` — append 9 Pattern B entries
3. **D1 mutations** (after PRs merge):
   - rrm-library: 1 UPDATE (7 rows)
   - rrm-auth: 1 UPDATE (1 row, posts table)
4. **Build + verify**:
   - `gh workflow run deploy.yml` in rrm-academy-cf (full rebuild picks up D1 changes)
   - `wrangler deploy` in rrm-router
   - Verify 14 registry URLs return 200
   - Verify isthmocele page emits FAQPage JSON-LD
5. **IndexNow ping**:
   - 14 registry canonical URLs + 1 isthmocele URL = 15 URLs in one batch submission

## Expected impact (citation accounting)

| Today | After execution | After 30-day Bing re-grounding |
|---|---|---|
| ~270 citations to 404/410 on registry/regulator records | URLs return 200; AEO surface restored | Expected recovery + 10-20% lift on isthmocele page |
| ~94 citations to 404 on www. library URLs | URLs 301 to apex canonical | Bing index converges within 30-60 days |
| 1,833 total citations | Same surface, drift-corrected | Expected 10-15% net AI citation growth over 60 days |

## Risks

- **D1 status flip on rrm-library** is reversible (UPDATE back to status='archived').
- **router 410 removal** is reversible (re-add the entries).
- **D1 post body update** is reversible if the prior content is preserved before update; the FAQ append doesn't replace existing content.
- **Build trigger** is a no-op deploy with refreshed data; rollback is the prior commit.

No part of this bundle modifies user-facing data (signups, donations, courses, etc.).
