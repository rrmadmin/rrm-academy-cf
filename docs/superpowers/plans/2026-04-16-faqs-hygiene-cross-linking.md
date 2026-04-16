# FAQs Hygiene + Cross-Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix FAQ-section drift since D1 migration: expose timestamps through the data layer, add hub breadcrumb + dynamic freshness, add pillar-aware CTAs on detail pages, clean curly-quote / NBSP typography in F12 and F06 questions, tighten hub meta description.

**Architecture:** Single-repo, **two-deploy** sequence (deploy 1 = API layer; deploy 2 = data + templates). `fetch-faqs` hits the live `/api/faqs` endpoint, so the `mapRow` change (Task 1) must reach production before Task 4 regenerates `faqs.json`. One guarded API file edit (`mapRow`), one D1 DML file, two Astro templates, one TS library addition (pillar map). Test-first on the API change using the existing `node --test` harness. Template changes verified via `npm run build` + post-deploy curl.

**Tech Stack:** Astro 5.3, Cloudflare Pages Functions (D1 + KV), TypeScript, node:test (unit tests for Pages Functions), wrangler CLI for D1.

**Spec:** `docs/superpowers/specs/2026-04-16-faqs-hygiene-cross-linking-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `functions/api/faqs.js` | Modify `mapRow` (guarded) | Expose `updatedAt`/`createdAt` to API |
| `test/faqs.test.js` | Extend fixtures + assertions | Cover new response fields |
| `guard-manifest.json` | Regenerate | Hash for modified guarded file |
| `src/lib/faq.ts` | Extend `FAQ` interface + add `PillarCTA`, `PILLAR_CTA_MAP` | Data types + pillar routing |
| `scripts/faq-typography-2026-04-16.sql` | Create | D1 DML for F12/F06 typography fix |
| `src/pages/faqs.astro` | Modify | Breadcrumb, dynamic "Last updated", `dateModified`/`datePublished`, tighten meta desc |
| `src/pages/faqs/[...slug].astro` | Modify | `dateModified`/`datePublished`, per-FAQ stamp, pillar CTA |
| `src/data/faqs.json` | Regenerate via `npm run fetch-faqs` | Build-time FAQ data |

---

## Task 1: Extend `mapRow` to expose timestamps (TDD)

**Files:**
- Modify: `functions/api/faqs.js:95-112` (mapRow function)
- Modify: `test/faqs.test.js` (extend existing tests)
- Modify: `guard-manifest.json` (regenerate)

- [ ] **Step 1: Add failing assertions for `updatedAt`/`createdAt` to `test/faqs.test.js`**

In `test/faqs.test.js`, find the fixture `faqRow` in the "returns all published FAQs..." test (around line 58) and add two fields:

```js
    const faqRow = {
      id: 'faq_001',
      faq_code: 'what-is-rrm',
      slug: 'what-is-rrm',
      question: 'What is RRM?',
      basic_answer: 'RRM is restorative reproductive medicine.',
      schema_answer: 'RRM stands for...',
      published_answer: '<p>Full answer</p>',
      category: 'basics',
      seo_title: 'What is RRM?',
      seo_description: 'Learn about RRM.',
      sort_order: 1,
      status: 'published',
      updated_at: '2026-04-10T12:00:00',
      created_at: '2026-01-15T08:00:00',
    };
```

After the existing assertions in the same test (after the `assert.equal(faq.status, 'published');` line around 105), add:

```js
    assert.equal(faq.updatedAt, '2026-04-10T12:00:00');
    assert.equal(faq.createdAt, '2026-01-15T08:00:00');
```

Also in the "returns single FAQ by id" test (around line 154), add both fields to the fixture:

```js
      ...
      status: 'draft',
      updated_at: '2026-03-01T00:00:00',
      created_at: '2026-03-01T00:00:00',
    };
```

And add one assertion in that same test after `assert.equal(body.data.status, 'draft');`:

```js
    assert.equal(body.data.updatedAt, '2026-03-01T00:00:00');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="api/faqs"`
Expected: FAIL — `body.results[0].updatedAt` is `undefined`, expected `'2026-04-10T12:00:00'`.

- [ ] **Step 3: Extend `mapRow` in `functions/api/faqs.js:95`**

Replace the entire `mapRow` function (lines 95-112) with:

```js
function mapRow(r, refs, resources) {
  return {
    id: r.id,
    faqId: r.faq_code,
    slug: r.slug,
    question: r.question,
    basicAnswer: r.basic_answer,
    schemaAnswer: r.schema_answer,
    publishedAnswer: r.published_answer,
    category: r.category,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    sortOrder: r.sort_order,
    status: r.status,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    evidence: (resources || []).map(r => ({ title: r.title, url: r.url, sortOrder: r.sort_order })),
    libraryRefs: (refs || []).map(r => ({ articleId: r.article_id, label: r.label, sortOrder: r.sort_order })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="api/faqs"`
Expected: PASS — all FAQ tests green.

- [ ] **Step 5: Regenerate guard manifest**

Run: `npm run guard:update`
Expected: `guard-manifest.json` regenerated with new hash for `functions/api/faqs.js`.

- [ ] **Step 6: Verify guard still passes**

Run: `npm run guard`
Expected: exit code 0, no invariant violations.

- [ ] **Step 7: Commit and push (deploy 1)**

```bash
git add functions/api/faqs.js test/faqs.test.js guard-manifest.json
git commit -m "feat(faqs): expose updatedAt/createdAt via /api/faqs"
git push origin main
```

- [ ] **Step 8: Wait for deploy 1 to land**

Run: `gh run watch --exit-status`
Expected: green deploy. Then verify live endpoint:

```bash
curl -sH "Authorization: Bearer $(op read 'op://Automation/RRM Library Worker Build Token/credential')" https://rrmacademy.org/api/faqs | jq '.results[0] | {updatedAt, createdAt}'
```
Expected: both fields non-null. Do not proceed to Task 2 until this passes.

---

## Task 2: Extend FAQ interface + add pillar map (`src/lib/faq.ts`)

**Files:**
- Modify: `src/lib/faq.ts`

- [ ] **Step 1: Add timestamp fields to `FAQ` interface**

In `src/lib/faq.ts`, extend the `FAQ` interface (around line 23) by adding two fields right before `evidence`:

```ts
export interface FAQ {
  id: string;
  faqId: string;
  slug: string;
  question: string;
  publishedAnswer: string;
  basicAnswer: string;
  schemaAnswer: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  status: string;
  category: 'Foundational' | 'Condition-Specific' | 'Common Concerns';
  updatedAt: string;
  createdAt: string;
  evidence: EvidenceLink[];
  libraryRefs: LibraryRef[];
}
```

- [ ] **Step 2: Add `PillarCTA` type + `PILLAR_CTA_MAP` export**

Append to the bottom of `src/lib/faq.ts`:

```ts
export interface PillarCTA {
  href: string;
  label: string;
}

/**
 * Maps FAQ code (F01, C10, etc.) to a pillar-page CTA.
 * `null` means fall back to the generic Courses + Library block.
 * Unknown codes fall through to `null` via `?? null` at the call site.
 */
export const PILLAR_CTA_MAP: Record<string, PillarCTA | null> = {
  // /what-is-rrm/ — broad intro, clinical detail, cost/insurance/timeline
  F01: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F02: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F03: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F05: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F07: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F08: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F10: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F11: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F12: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F13: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F17: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F18: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F20: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  C10: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  C35: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },

  // /naprotechnology/
  F04: { href: '/naprotechnology/', label: 'Read the NaProTechnology guide' },

  // /femm/ — comparison angle
  F22: { href: '/femm/', label: 'Compare fertility-awareness methods' },

  // /neofertility/ — consult-oriented
  F09: { href: '/neofertility/', label: 'Read the NeoFertility guide' },
  F15: { href: '/neofertility/', label: 'Read the NeoFertility guide' },

  // /common-questions-about-rrm — critic-response / skeptic-framed
  F06: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F16: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F21: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F23: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F24: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },

  // F14 (Do I need to be Catholic?) — deliberately null, uses fallback block
  F14: null,
};
```

- [ ] **Step 3: Run type check**

Run: `npm run check-types`
Expected: PASS. New interface fields and constant exports are well-typed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/faq.ts
git commit -m "feat(faqs): add FAQ timestamp fields + PILLAR_CTA_MAP"
```

---

## Task 3: Create D1 typography-fix SQL file

**Files:**
- Create: `scripts/faq-typography-2026-04-16.sql`

- [ ] **Step 1: Create the SQL file**

Write this exact content to `scripts/faq-typography-2026-04-16.sql`:

```sql
-- FAQ question typography fix, 2026-04-16.
-- F12: replace curly apostrophes (U+2019, U+2018) with straight apostrophe (U+0027).
-- F06: replace non-breaking hyphen (U+2011) with regular hyphen (U+002D).
-- `updated_at` is deliberately NOT set — typography cleanup is not a content revision.

BEGIN;

UPDATE faq
   SET question = REPLACE(REPLACE(question, CHAR(8217), CHAR(39)), CHAR(8216), CHAR(39))
 WHERE faq_code = 'F12';

UPDATE faq
   SET question = REPLACE(question, CHAR(8209), CHAR(45))
 WHERE faq_code = 'F06';

COMMIT;
```

- [ ] **Step 2: Dry-run the SQL locally (SELECT-preview before UPDATE)**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT faq_code, HEX(question) AS hex_q, question FROM faq WHERE faq_code IN ('F06','F12')"
```
Expected: two rows. `F12` question shows `E2 80 99` (U+2019) in HEX. `F06` shows `E2 80 91` (U+2011). Capture this output as before-state.

- [ ] **Step 3: Execute the SQL against remote D1**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/faq-typography-2026-04-16.sql
```
Expected: 2 rows written, no errors.

- [ ] **Step 4: Verify the replacement**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT faq_code, HEX(question) AS hex_q, question FROM faq WHERE faq_code IN ('F06','F12')"
```
Expected: `F12` question contains `27` (U+0027) where `E2 80 99` was. `F06` contains `2D` (U+002D) where `E2 80 91` was. `updated_at` column unchanged from before (confirm with a third column in the SELECT if helpful).

- [ ] **Step 5: Commit the SQL file**

```bash
git add scripts/faq-typography-2026-04-16.sql
git commit -m "chore(faqs): D1 typography fix for F12 + F06"
```

---

## Task 4: Regenerate `src/data/faqs.json`

**Files:**
- Modify: `src/data/faqs.json` (regenerated)

- [ ] **Step 1: Fetch FAQ data from live API**

Run:
```bash
LIBRARY_BUILD_TOKEN=$(op read 'op://Automation/RRM Library Worker Build Token/credential') npm run fetch-faqs
```
Expected: script prints "Wrote src/data/faqs.json (25 entries)" or similar.

- [ ] **Step 2: Verify new fields present + typography fixed**

Run:
```bash
jq '.[0] | {updatedAt, createdAt}' src/data/faqs.json
jq '.[] | select(.faqId == "F12") | .question' src/data/faqs.json
jq '.[] | select(.faqId == "F06") | .question' src/data/faqs.json
```
Expected:
- First command prints non-null `updatedAt` and `createdAt` ISO strings.
- F12 question contains straight `'` (no curly apostrophes). Visual check: no `’` glyphs.
- F06 "evidence-based" contains regular `-` (no U+2011).

- [ ] **Step 3: Commit the regenerated JSON**

```bash
git add src/data/faqs.json
git commit -m "chore(faqs): regenerate faqs.json with timestamps + typography fixes"
```

---

## Task 5: Hub template — breadcrumb, dynamic date, JSON-LD, meta description

**Files:**
- Modify: `src/pages/faqs.astro`

- [ ] **Step 1: Replace the frontmatter script block**

Replace lines 1-23 (everything between and including the opening `---` and closing `---`) with:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import { fetchAllFaqs, groupByCategory } from '../lib/faq';

const allFaqs = await fetchAllFaqs();
const groups = groupByCategory(allFaqs);

// Derive latest + earliest timestamps from FAQ data.
const updatedTimestamps = allFaqs
  .map(f => Date.parse(f.updatedAt))
  .filter(n => Number.isFinite(n));
const createdTimestamps = allFaqs
  .map(f => Date.parse(f.createdAt))
  .filter(n => Number.isFinite(n));

const latestUpdated = updatedTimestamps.length
  ? new Date(Math.max(...updatedTimestamps))
  : new Date();
const earliestCreated = createdTimestamps.length
  ? new Date(Math.min(...createdTimestamps))
  : latestUpdated;

const lastUpdatedLabel = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
}).format(latestUpdated);

// JSON-LD: FAQPage + BreadcrumbList in a single @graph.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'FAQPage',
      name: 'Frequently Asked Questions about Restorative Reproductive Medicine',
      description: 'Answers to common questions about RRM, NaProTechnology, fertility charting, treatment approaches, success rates, and costs.',
      dateModified: latestUpdated.toISOString(),
      datePublished: earliestCreated.toISOString(),
      mainEntity: allFaqs.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.schemaAnswer || faq.basicAnswer || faq.publishedAnswer,
        },
      })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rrmacademy.org/' },
        { '@type': 'ListItem', position: 2, name: 'FAQs', item: 'https://rrmacademy.org/faqs/' },
      ],
    },
  ],
};
---
```

- [ ] **Step 2: Tighten the `BaseLayout` `description` prop**

Replace line 26 (the `description="..."` prop of `<BaseLayout>`) with:

```astro
  description="Answers to common questions about Restorative Reproductive Medicine (RRM), NaProTechnology, fertility charting, treatment, and costs."
```

(149 chars, down from 173.)

- [ ] **Step 3: Insert breadcrumb above the hero section**

Immediately after the opening `<div class="container container--narrow">` line (currently line 31) and before the `<section class="faqs-hero">` line, insert:

```astro
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true"> &rsaquo; </span>
        <span aria-current="page">FAQs</span>
      </nav>
```

- [ ] **Step 4: Replace the hardcoded "Last updated" line**

Replace line 72 (`<p class="page-updated">Last updated: February 2026</p>`) with:

```astro
    <p class="page-updated">Last updated: {lastUpdatedLabel}</p>
```

- [ ] **Step 5: Add breadcrumb styles**

Find the closing `</style>` tag at the end of the file. Add these rules just before the closing `</style>`:

```css
  .breadcrumb {
    font-size: 0.875rem;
    color: var(--text-tertiary);
    margin-bottom: var(--space-6);
  }
  .breadcrumb a {
    color: var(--text-tertiary);
    text-decoration: none;
  }
  .breadcrumb a:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .breadcrumb [aria-current="page"] {
    color: var(--text-secondary);
  }
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/faqs.astro
git commit -m "feat(faqs): hub breadcrumb, dynamic date, BreadcrumbList JSON-LD"
```

---

## Task 6: Detail template — dateModified, per-FAQ stamp, pillar CTA

**Files:**
- Modify: `src/pages/faqs/[...slug].astro`

- [ ] **Step 1: Update the imports + frontmatter additions**

Replace line 3 (the existing import from `../../lib/faq`) with:

```astro
import { fetchAllFaqs, getRelatedFaqs, PILLAR_CTA_MAP, type FAQ } from '../../lib/faq';
```

Then after the existing `const { faq, allFaqs } = Astro.props;` line (around line 19), insert:

```astro
const pillar = PILLAR_CTA_MAP[faq.faqId] ?? null;

const lastUpdatedLabel = faq.updatedAt
  ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(faq.updatedAt))
  : null;
```

- [ ] **Step 2: Extend JSON-LD with dateModified + datePublished**

Replace the `jsonLd` constant block (currently spanning roughly lines 35-58) with:

```astro
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'FAQPage',
      dateModified: faq.updatedAt,
      datePublished: faq.createdAt,
      mainEntity: [{
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.schemaAnswer || faq.basicAnswer || faq.publishedAnswer,
        },
      }],
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rrmacademy.org/' },
        { '@type': 'ListItem', position: 2, name: 'FAQs', item: 'https://rrmacademy.org/faqs/' },
        { '@type': 'ListItem', position: 3, name: faq.question, item: `https://rrmacademy.org/faqs/${faq.slug}/` },
      ],
    },
  ],
};
```

- [ ] **Step 3: Add per-FAQ "Last updated" stamp**

Find the `<span class="faq-category-badge">{faq.category}</span>` line (around line 82). Replace that line with:

```astro
      <div class="faq-meta-row">
        <span class="faq-category-badge">{faq.category}</span>
        {lastUpdatedLabel && (
          <span class="faq-updated">Last updated {lastUpdatedLabel}</span>
        )}
      </div>
```

- [ ] **Step 4: Replace the CTA block with pillar-aware logic**

Find the current `<!-- CTA -->` block (lines ~134-141 — the `<section class="faq-cta">...</section>`) and replace it entirely with:

```astro
      <!-- CTA -->
      <section class="faq-cta">
        <h2>Ready to go deeper?</h2>
        <div class="faq-cta__links">
          {pillar ? (
            <>
              <a href={pillar.href} class="btn btn--primary">{pillar.label}</a>
              <a href="/library/" class="btn btn--secondary">Browse the Research Library</a>
            </>
          ) : (
            <>
              <a href="/courses/" class="btn btn--primary">Explore Courses</a>
              <a href="/library/" class="btn btn--secondary">Browse the Research Library</a>
            </>
          )}
        </div>
      </section>
```

- [ ] **Step 5: Add styles for the meta row + per-FAQ stamp**

Find the existing `.faq-category-badge` rule (around line 164). Immediately after the closing brace of that rule, add:

```css
  .faq-meta-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-6);
  }
  .faq-meta-row .faq-category-badge {
    margin-bottom: 0;
  }
  .faq-updated {
    font-size: 0.8125rem;
    color: var(--text-tertiary);
  }
```

(The `margin-bottom: 0` override prevents double spacing since the badge previously owned the bottom margin and now the row owns it.)

- [ ] **Step 6: Remove the old bottom margin on `.faq-category-badge`**

In the same `.faq-category-badge` rule, find `margin-bottom: var(--space-6);` and delete that single line. The row wrapper now owns the spacing.

- [ ] **Step 7: Commit**

```bash
git add src/pages/faqs/[...slug].astro
git commit -m "feat(faqs): detail-page pillar CTAs, per-FAQ freshness, @graph JSON-LD"
```

---

## Task 7: Local verification

**Files:**
- No file changes — verification only.

- [ ] **Step 1: Run type check**

Run: `npm run check-types`
Expected: PASS.

- [ ] **Step 2: Run unit tests**

Run: `npm test`
Expected: PASS, including new `updatedAt`/`createdAt` assertions.

- [ ] **Step 3: Run guard**

Run: `npm run guard`
Expected: exit 0, no invariant violations.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: PASS. No Astro errors. `dist/faqs/index.html` and all `dist/faqs/<slug>/index.html` built.

- [ ] **Step 5: Smoke-check built HTML**

Run:
```bash
grep -o "Last updated: [A-Za-z]* 202[0-9]" dist/faqs/index.html
grep -c 'dateModified' dist/faqs/index.html
grep -c 'BreadcrumbList' dist/faqs/index.html
grep -o 'What.*thyroid and fertility' dist/faqs/what-s-rrm-s-stance-on-thyroid-and-fertility/index.html | head -1
```
Expected:
- First: a single match like `Last updated: April 2026`.
- Second: at least `1` (dateModified in hub JSON-LD).
- Third: at least `1` (BreadcrumbList in hub JSON-LD).
- Fourth: F12 question with straight apostrophes (no `’` glyph).

- [ ] **Step 6: Smoke-check a pillar CTA**

Run:
```bash
grep -A1 'faq-cta__links' dist/faqs/what-is-naprotechnology-and-the-creighton-model-crms/index.html | head -10
```
Expected: output contains `href="/naprotechnology/"` and `Read the NaProTechnology guide`.

- [ ] **Step 7: Smoke-check the F14 fallback**

Run:
```bash
grep -A2 'faq-cta__links' dist/faqs/do-i-need-to-be-catholic-to-use-creighton-napro-or-see-an-rrm-clinician/index.html | head -10
```
Expected: output contains `href="/courses/"` and `Explore Courses` (the fallback block).

---

## Task 8: Push + deploy 2

**Files:**
- No file changes.

- [ ] **Step 1: Review pending commits**

Run: `git log --oneline origin/main..HEAD`
Expected: 5 commits — lib/faq.ts, SQL file, faqs.json regen, hub template, detail template. (Task 1's mapRow commit already pushed in deploy 1.)

- [ ] **Step 2: Push to main**

Run: `git push origin main`
Expected: push succeeds, GitHub Actions deploy starts.

- [ ] **Step 3: Monitor deploy**

Run:
```bash
gh run watch --exit-status
```
Expected: deploy completes green. If red, stop and diagnose; do not proceed.

---

## Task 9: Post-deploy verification

**Files:**
- Create: `test/faq-baselines-2026-04-16.json` (reference snapshot)

- [ ] **Step 1: Snapshot hub JSON-LD**

Run:
```bash
curl -sL https://rrmacademy.org/faqs/ \
  | python3 -c "import sys, re, json; html = sys.stdin.read(); blocks = re.findall(r'<script type=\"application/ld\\+json\">(.*?)</script>', html, re.DOTALL); print(json.dumps([json.loads(b) for b in blocks], indent=2))" \
  > /tmp/hub-jsonld.json
cat /tmp/hub-jsonld.json | jq '.[0]["@graph"] | map(."@type")'
```
Expected: output contains `["FAQPage", "BreadcrumbList"]` (in the hub graph).

- [ ] **Step 2: Verify hub `dateModified` + `datePublished`**

Run:
```bash
jq '.[0]["@graph"][0] | {dateModified, datePublished}' /tmp/hub-jsonld.json
```
Expected: both fields present and ISO-formatted.

- [ ] **Step 3: Verify hub visible "Last updated"**

Run:
```bash
curl -sL https://rrmacademy.org/faqs/ | grep -oE 'Last updated: [A-Za-z]+ 20[0-9]{2}'
```
Expected: exactly one match, matching the month of `max(updatedAt)` in `src/data/faqs.json`.

- [ ] **Step 4: Verify hub meta description ≤ 160 chars**

Run:
```bash
curl -sL https://rrmacademy.org/faqs/ | grep -oE '<meta name="description"[^>]*>' | awk -F'content="' '{print length($2)-2}'
```
Expected: a number ≤ 160.

- [ ] **Step 5: Sample all six pillar buckets**

Run this loop:
```bash
for entry in \
  "F01:what-is-restorative-reproductive-medicine-rrm:/what-is-rrm/" \
  "F04:what-is-naprotechnology-and-the-creighton-model-crms:/naprotechnology/" \
  "F22:what-is-the-difference-between-creighton-model-marquette-method-femm-and-symptot:/femm/" \
  "F09:what-should-i-expect-at-a-first-rrm-consult:/neofertility/" \
  "F16:how-much-does-rrm-or-naprotechnology-treatment-cost-compared-to-ivf:/common-questions-about-rrm" \
  "F14:do-i-need-to-be-catholic-to-use-creighton-napro-or-see-an-rrm-clinician:FALLBACK"; do
  code="${entry%%:*}"
  rest="${entry#*:}"
  slug="${rest%%:*}"
  expected="${rest#*:}"
  html=$(curl -sL "https://rrmacademy.org/faqs/${slug}/")
  if [ "$expected" = "FALLBACK" ]; then
    if echo "$html" | grep -q 'href="/courses/"' && echo "$html" | grep -q 'Explore Courses'; then
      echo "$code ok (fallback)"
    else
      echo "$code FAIL (fallback block missing)"
    fi
  else
    primary=$(echo "$html" | grep -oE 'class="btn btn--primary" *href="[^"]+"' | head -1 | grep -oE 'href="[^"]+"')
    if echo "$primary" | grep -q "href=\"$expected\""; then
      echo "$code ok (-> $expected)"
    else
      echo "$code FAIL (got $primary, expected href=\"$expected\")"
    fi
  fi
done
```
Expected: six lines, all ending in `ok`.

- [ ] **Step 6: Verify F12 + F06 typography in live HTML**

Run:
```bash
curl -sL https://rrmacademy.org/faqs/what-s-rrm-s-stance-on-thyroid-and-fertility/ | grep -oE "What.{1,40}thyroid and fertility" | head -1
curl -sL https://rrmacademy.org/faqs/is-rrm-evidence-based-key-trials-registries-and-guidelines/ | grep -oE "evidence.based" | head -3
```
Expected:
- First line contains straight apostrophes only. No `’` glyph.
- Second output shows `evidence-based` with regular hyphens only (no `‑` U+2011).

- [ ] **Step 7: Verify detail-page `dateModified`**

Run:
```bash
curl -sL https://rrmacademy.org/faqs/what-is-restorative-reproductive-medicine-rrm/ \
  | python3 -c "import sys, re, json; html = sys.stdin.read(); blocks = re.findall(r'<script type=\"application/ld\\+json\">(.*?)</script>', html, re.DOTALL); data = [json.loads(b) for b in blocks]; print(json.dumps([x['@graph'][0] for x in data if '@graph' in x], indent=2))" \
  | jq '{dateModified, datePublished}'
```
Expected: both `dateModified` and `datePublished` present, ISO-formatted, non-null.

- [ ] **Step 8: Rich Results Test (manual)**

Open `https://search.google.com/test/rich-results?url=https%3A%2F%2Frrmacademy.org%2Ffaqs%2F` in a browser. Confirm FAQPage is detected with no errors. Repeat for `https://rrmacademy.org/faqs/what-is-naprotechnology-and-the-creighton-model-crms/`. Both should show "Page is eligible for rich results" with FAQ markup detected.

- [ ] **Step 9: Save baseline for future regression comparison**

Run:
```bash
mkdir -p test/baselines
cp /tmp/hub-jsonld.json test/baselines/faq-hub-jsonld-2026-04-16.json
git add test/baselines/faq-hub-jsonld-2026-04-16.json
git commit -m "chore(faqs): snapshot FAQ hub JSON-LD baseline"
git push origin main
```
Expected: baseline committed and pushed.

- [ ] **Step 10: Run `npm run guard` on deployed commit**

Run: `npm run guard`
Expected: exit 0.

---

## Rollback Plan

If any post-deploy verification step fails:

1. **Template regression (Tasks 5–6):** Revert the template commits only:
   ```bash
   git revert <hub-commit-sha> <detail-commit-sha>
   git push origin main
   ```
2. **API regression (Task 1):** Revert the `mapRow` commit + run `npm run guard:update` locally to realign manifest, then revert-commit-push.
3. **D1 typography (Task 3):** Leave in place — the straight-apostrophe/regular-hyphen values are benign regardless of template state. To "undo" (rarely needed):
   ```sql
   BEGIN;
   UPDATE faq SET question = REPLACE(question, CHAR(39), CHAR(8217)) WHERE faq_code = 'F12';
   UPDATE faq SET question = REPLACE(question, CHAR(45), CHAR(8209)) WHERE faq_code = 'F06' AND question LIKE '%evidence-based%';
   COMMIT;
   ```
   Do not run unless Brian explicitly asks — typography fixes are strictly improvements.

---

## Success Criteria (from spec)

All eight must pass:

1. Hub HTML has visible breadcrumb + "Last updated: <Month YYYY>" matching `max(updatedAt)`.
2. Hub JSON-LD `@graph` has both `FAQPage` (with `dateModified` + `datePublished`) and `BreadcrumbList`.
3. Hub meta `description` ≤ 160 chars.
4. All 25 detail pages have `dateModified` + `datePublished` in JSON-LD + visible per-FAQ "Last updated" stamp.
5. F12 + F06 question strings render without curly apostrophes / NBSP, in HTML and in JSON-LD `mainEntity.name`.
6. Primary CTA correct for one sample per pillar bucket (F01, F04, F22, F09, F16, F14).
7. Google Rich Results Test reports FAQPage eligibility on hub + detail sample.
8. `npm run guard` passes on deployed commit.
