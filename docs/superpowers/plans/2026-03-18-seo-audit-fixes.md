# SEO Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute all automatable fixes from the March 18, 2026 SEO audit of rrmacademy.org.

**Architecture:** Direct edits to Astro page files (meta descriptions, H1s) + GSC API diagnostic calls. All changes are in `src/pages/`. No backend/function changes. No editorial content changes -- only mechanical SEO metadata fixes.

**Tech Stack:** Astro 5.3 static pages, Google Search Console API (via gcloud ADC), curl

**Autonomy contract:** All tasks are mechanical metadata edits or read-only API diagnostics. No editorial content decisions. No deploy -- Brian will review the diff and push.

---

## File Map

| File | Change |
|------|--------|
| `src/pages/femm/index.astro:166` | Trim meta description from 206 to ~149 chars |
| `src/pages/neofertility/index.astro:190` | Trim meta description from 223 to ~150 chars |
| `src/pages/glossary/index.astro:82` | Trim meta description from 241 to ~148 chars |
| `src/pages/endo-survey/index.astro:31` | Trim meta description from 171 to ~153 chars |
| `src/pages/guides/index.astro:71` | Improve H1 for keyword value |
| ~~`src/pages/library/index.astro:51`~~ | ~~Remove "v2.0" version badge from H1~~ **CANCELLED -- Brian wants it** |

## Revert

**Before commit:** `git restore src/pages/femm/index.astro src/pages/neofertility/index.astro src/pages/glossary/index.astro src/pages/endo-survey/index.astro src/pages/guides/index.astro src/pages/library/index.astro`

**After commit:** `git revert HEAD`

---

### Task 1: GSC Pillar Page Indexation Diagnostic

**Files:** None (read-only API calls)

This task produces a diagnostic report. It does NOT make code changes.

- [ ] **Step 1: Get gcloud access token**

```bash
TOKEN=$(gcloud auth application-default print-access-token)
```

- [ ] **Step 2: Inspect all 5 pillar pages via URL Inspection API**

Run this for each pillar URL. Record the full response.

```bash
for URL in \
  "https://rrmacademy.org/what-is-rrm/" \
  "https://rrmacademy.org/naprotechnology/" \
  "https://rrmacademy.org/femm/" \
  "https://rrmacademy.org/neofertility/" \
  "https://rrmacademy.org/glossary/"; do
  echo "=== $URL ==="
  curl -s -X POST \
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect' \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: rrm-academy" \
    -H 'Content-Type: application/json' \
    -d "{\"inspectionUrl\": \"$URL\", \"siteUrl\": \"sc-domain:rrmacademy.org\"}" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=d.get('inspectionResult',{})
idx=r.get('indexStatusResult',{})
print(f'  Verdict: {idx.get(\"verdict\",\"?\")}'  )
print(f'  Coverage: {idx.get(\"coverageState\",\"?\")}'  )
print(f'  Robots: {idx.get(\"robotsTxtState\",\"?\")}'  )
print(f'  Indexing: {idx.get(\"indexingState\",\"?\")}'  )
print(f'  Page fetch: {idx.get(\"pageFetchState\",\"?\")}'  )
print(f'  Last crawl: {idx.get(\"lastCrawlTime\",\"never\")}'  )
print(f'  Google canonical: {idx.get(\"googleCanonical\",\"?\")}'  )
print(f'  User canonical: {idx.get(\"userCanonical\",\"?\")}'  )
print(f'  Sitemaps: {idx.get(\"sitemap\",idx.get(\"sitemaps\",\"none\"))}'  )
"
  echo ""
done
```

- [ ] **Step 3: Inspect FAQs hub and endo-survey**

Same API call pattern for:
- `https://rrmacademy.org/faqs/`
- `https://rrmacademy.org/endo-survey/`
- `https://rrmacademy.org/guides/`

- [ ] **Step 4: Inspect "rrm" brand ranking pages**

Check what Google considers the canonical for the homepage:

```bash
curl -s -X POST \
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: rrm-academy" \
  -H 'Content-Type: application/json' \
  -d '{"inspectionUrl": "https://rrmacademy.org/", "siteUrl": "sc-domain:rrmacademy.org"}'
```

Also check the www variant:

```bash
curl -s -X POST \
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: rrm-academy" \
  -H 'Content-Type: application/json' \
  -d '{"inspectionUrl": "https://www.rrmacademy.org/", "siteUrl": "sc-domain:rrmacademy.org"}'
```

- [ ] **Step 5: Write diagnostic summary**

Print a table summarizing findings for all inspected URLs:
- Indexed or not
- Last crawl date
- Google canonical vs user canonical (mismatches = problem)
- Any robots/fetch issues

This completes Task 1. No commit needed (diagnostic only).

---

### Task 2: Fix Truncated Meta Description on /femm/

**Files:**
- Modify: `src/pages/femm/index.astro:166`

Current (206 chars):
> "FEMM (Fertility Education and Medical Management) uses biomarker charting and RHRI protocols to diagnose and treat hormonal and reproductive conditions. Learn how FEMM works, find a provider, compare costs."

- [ ] **Step 1: Read the file to confirm current meta description**

```bash
# Read around line 166
```

- [ ] **Step 2: Edit meta description to ~155 chars**

New value (~149 chars):
> "FEMM uses biomarker charting and RHRI protocols to diagnose and treat hormonal and reproductive conditions. Learn how FEMM works and find a provider."

Trim strategy: Remove parenthetical expansion of FEMM (it's in the title tag already), drop "compare costs" (secondary).

- [ ] **Step 3: Verify edit is correct** (no build here -- single build in Task 8)

---

### Task 3: Fix Truncated Meta Description on /neofertility/

**Files:**
- Modify: `src/pages/neofertility/index.astro:190`

Current (223 chars):
> "NeoFertility is an RRM approach developed by Dr. Phil Boyle that diagnoses and treats infertility, recurrent miscarriage, and reproductive disorders through cycle-based evaluation, immune modulation, and natural conception."

- [ ] **Step 1: Read the file to confirm current meta description**

- [ ] **Step 2: Edit meta description to ~155 chars**

New value (~150 chars):
> "NeoFertility diagnoses and treats infertility, recurrent miscarriage, and reproductive disorders through cycle-based evaluation and immune modulation."

Trim strategy: Drop "is an RRM approach developed by Dr. Phil Boyle that" (author attribution is in the content, not needed in meta), drop "and natural conception" (implied).

**NOTE for Brian:** This removes the Phil Boyle attribution from the meta description. The name is still prominent in page content and schema. If you want Phil's name in the SERP snippet, adjust the trim differently.

- [ ] **Step 3: Verify edit is correct** (no build here -- single build in Task 8)

---

### Task 4: Fix Truncated Meta Description on /glossary/

**Files:**
- Modify: `src/pages/glossary/index.astro:82`

Current (241 chars):
> "A comprehensive, evidence-based glossary of Restorative Reproductive Medicine (RRM) terminology covering core principles, fertility awareness methods, NaProTechnology, diagnostic tools, surgical techniques, key conditions, and abbreviations."

- [ ] **Step 1: Read the file to confirm current meta description**

- [ ] **Step 2: Edit meta description to ~155 chars**

New value (~148 chars):
> "Evidence-based glossary of RRM terminology: fertility awareness methods, NaProTechnology, diagnostic tools, surgical techniques, and key conditions."

Trim strategy: Drop "A comprehensive," (filler), drop "covering core principles," (redundant with "terminology"), shorten "Restorative Reproductive Medicine (RRM)" to "RRM" (spelled out in title tag).

- [ ] **Step 3: Verify edit is correct** (no build here -- single build in Task 8)

---

### Task 5: Trim Meta Description on /endo-survey/

**Files:**
- Modify: `src/pages/endo-survey/index.astro:31`

Current (171 chars):
> "Do your symptoms point to endometriosis? This evidence-based self-survey from Dr. Naomi Whittaker helps you assess your level of suspicion based on real clinical patterns."

- [ ] **Step 1: Read the file to confirm current meta description**

- [ ] **Step 2: Edit meta description to ~160 chars**

New value (~153 chars):
> "Do your symptoms point to endometriosis? This evidence-based self-survey from Dr. Naomi Whittaker helps assess your level of suspicion for endometriosis."

Trim strategy: Drop "based on real clinical patterns" (replaced with "for endometriosis" to reinforce keyword), drop "you" before "assess" (tighter).

- [ ] **Step 3: Verify edit is correct** (no build here -- single build in Task 8)

---

### Task 6: Improve /guides/ H1

**Files:**
- Modify: `src/pages/guides/index.astro:71` (H1 only -- title tag is fine as-is)

Current H1: `Guides`

- [ ] **Step 1: Read the file to confirm current H1**

- [ ] **Step 2: Edit H1**

New H1: `Restorative Reproductive Medicine Guides`

This adds keyword value while staying concise. The title tag is already fine (`Guides | Restorative Reproductive Medicine` -- 42 chars, keywords present). Do NOT modify the title tag.

- [ ] **Step 3: Verify edit is correct** (H1 verification happens in Task 8 Step 5 after build)

---

### ~~Task 7: Remove "v2.0" from /library/ H1~~ CANCELLED

Brian wants the v2.0 badge. Do not touch it.

---

### Task 8: Build Verification and Commit

**Files:** All modified files from Tasks 2-7

- [ ] **Step 1: Run guard check**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && node scripts/guard.mjs
```

Expected: Pass (none of the modified files are guarded).

- [ ] **Step 2: Run full build**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build 2>&1 | tail -20
```

Expected: Clean build, no errors.

- [ ] **Step 3: Run template verification**

```bash
node scripts/verify-templates.mjs
```

Expected: All tests pass.

- [ ] **Step 4: Run type check**

```bash
node scripts/check-types.mjs
```

Expected: No new type errors beyond baseline.

**ABORT CONDITION:** If guard, build, template verify, or type check fails: STOP immediately, do NOT commit, run `git restore src/pages/femm/index.astro src/pages/neofertility/index.astro src/pages/glossary/index.astro src/pages/endo-survey/index.astro src/pages/guides/index.astro src/pages/library/index.astro`, and report the failure output to Brian.

- [ ] **Step 5: Verify all modified pages in built output**

Run these grep commands and confirm each row passes:

| Page | Check | Command | Pass Criteria |
|------|-------|---------|---------------|
| /femm/ | meta desc | `grep -o 'meta name="description" content="[^"]*"' dist/femm/index.html` | Length <= 155 chars |
| /neofertility/ | meta desc | `grep -o 'meta name="description" content="[^"]*"' dist/neofertility/index.html` | Length <= 155 chars |
| /glossary/ | meta desc | `grep -o 'meta name="description" content="[^"]*"' dist/glossary/index.html` | Length <= 155 chars |
| /endo-survey/ | meta desc | `grep -o 'meta name="description" content="[^"]*"' dist/endo-survey/index.html` | Length <= 160 chars |
| /guides/ | H1 | `grep '<h1' dist/guides/index.html` | Contains "Restorative Reproductive Medicine Guides" |

All 6 rows must pass. If any fails, ABORT (see abort condition above).

- [ ] **Step 6: Commit**

```bash
git add \
  src/pages/femm/index.astro \
  src/pages/neofertility/index.astro \
  src/pages/glossary/index.astro \
  src/pages/endo-survey/index.astro \
  src/pages/guides/index.astro
git commit -m "fix: trim truncated meta descriptions, improve guides H1

Fixes from March 18 SEO audit:
- /femm/ meta description: 206 -> 149 chars
- /neofertility/ meta description: 223 -> 150 chars
- /glossary/ meta description: 241 -> 148 chars
- /endo-survey/ meta description: 171 -> 153 chars
- /guides/ H1: 'Guides' -> 'Restorative Reproductive Medicine Guides'"
```

---

### Task 9: Ping Bing Sitemap (Post-Deploy)

**Note:** Only run this AFTER Brian pushes to main and deploy completes. Google's sitemap ping endpoint is deprecated (no-op since late 2023). Google discovers changes via sitemap crawl and GSC.

- [ ] **Step 1: Ping Bing**

```bash
curl -s "https://www.bing.com/ping?sitemap=https://rrmacademy.org/sitemap-index.xml"
```

---

## Out of Scope (Requires Brian)

These items from the audit need editorial decisions or manual GSC UI work:

| Item | Why Not Lights-Out |
|------|-------------------|
| Request indexing for pillar pages | GSC UI only -- no API for this. Brian must click "Request Indexing" per URL in Search Console |
| Build internal links to pillar pages from commentary | Editing article body content = editorial |
| Create endometriosis/PCOS pillar guides | Major content creation |
| Investigate "rrm" position 7.9 competitors | Requires search analysis + strategic decisions |
| Image alt text audit | Needs visual review of images |
| Backlink acquisition | External outreach |

## Diagnostic Data to Surface

After Task 1, the worker should print the full GSC URL Inspection results clearly so Brian can see:
1. Which pillar pages are indexed vs. not
2. Whether Google's canonical matches the user canonical
3. Last crawl dates
4. Any robots.txt or fetch issues

This data informs whether Brian needs to manually request indexing in the GSC UI.
