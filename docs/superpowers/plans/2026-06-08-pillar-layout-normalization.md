# GuideLayout Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 13 hand-cloned pillar/condition `.astro` pages with a single `GuideLayout` that owns the registry-driven SEO foundation, while each page passes its rich schema through verbatim, so the foundation can never drift or be forgotten and migration is provably additive-only.

**Architecture:** Hybrid passthrough. `GuideLayout.astro` wraps `BaseLayout` and emits the foundation (title/description/canonical/OG from registry, the `<h1>`, breadcrumb + `BreadcrumbList`, byline, TOC, FAQ accordion, disclaimer/cite). The page keeps authoring its domain JSON-LD (Article + `about` + `citation` + `image` + `wordCount` + `ItemList` + `DefinedTermSet` + `FAQPage`) and hands it to the layout via `jsonLd` + `extraSchema`; the layout never re-derives a domain node. A flag-based gate (G7) + a semantic comparator make every migration commit additive-only and gate-green. Rollout is Phase 0 (atomic registry + validator + build-script) -> Phase 1 (layout + comparator) -> Phase 2 (7-page proof) -> Phase 3 (waves of 3).

**Tech Stack:** Astro 5.3 (static), CF Pages, Node ESM build scripts, the existing `scripts/gates/validate-guides-registry.mjs` proof gate, Playwright for visual parity. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-06-pillar-layout-normalization-design.md` (v6, converged after 5 `/arise --deep` traces).

**Working base:** Branch off `origin/main` (13 pillars incl. isthmocele; validator G1-G6) in an isolated worktree. Do NOT branch off the stale `claude/what-is-rrm-glossary-sync` working tree (12 pillars, no G6). This plan + the spec are committed alongside it on the execution branch (relocated out of the original `/tmp` worktree before execution).

---

## Autonomy Contract (lights-off execution)

- **runs-without-human-input:** YES, task-by-task via subagent-driven-development, two-stage review between tasks.
- **Abort conditions (STOP, do not commit, do not proceed to the next page; surface the output and halt for human review):**
  - the comparator (`compare-pillar-migration.mjs`) returns `NOT ADDITIVE` on any page;
  - `npm run build` fails;
  - `node scripts/gates/validate-guides-registry.mjs` reports any G1-G7 error after an edit;
  - `npm run lint` fails (merge.yml Lint gate blocks the auto-merge push regardless of whether the change touches `functions/`);
  - Playwright body-prose parity shows a visible body change.
- **Revert authority:**
  - the agent MAY autonomously revert a single Phase 2/3 page-migration commit (see Revert Procedure) if its own gate/comparator catches a problem after the commit;
  - the agent MAY NOT revert the Phase 0 or Phase 1 commits without explicit human authorization (they are foundational; reverting them un-bases every later commit).

## Revert Procedure

Every commit in this plan is a self-contained, revertable unit (page `.astro` + its `ssot/guides.json` flag flip together for migrations; the foundation as one atomic commit for Phase 0).

- **Revert one migration commit (whole-commit only, never partial):**
  ```bash
  git revert <commit-sha> --no-edit   # reverts BOTH the page .astro and its usesGuideLayout flag
  ```
  Then push the revert through the same `claude/* -> auto-merge -> Build & Deploy` path. NEVER revert the page `.astro` without its flag (or vice versa): a partial revert leaves the flag and import disagreeing and re-trips G7 (which is the intended local guard).
- **Phase 0 / Phase 1 revert (requires human authorization):** same `git revert <sha> --no-edit`; the revert leaves all `usesGuideLayout` flags false and G7 inert, so it is safe, but it un-bases every migration committed on top, so do not do it autonomously.

## Deploy Choreography (batch the deploys)

Per `feedback-batch-arise-deploys.md`, each push to a `claude/*` branch burns ~20 min of GHA (Merge → Build & Deploy → AI Search Refresh). Batch:

| Group | Commits | Branch | Deploys |
|-------|---------|--------|---------|
| Phase 0 + Phase 1 | foundation (1 atomic) + GuideLayout + comparator (inert, no page changed) | `claude/pillar-layout-foundation` | 1 |
| Phase 2 group A | Tasks 2.1-2.4 (endometritis, isthmocele, glossary, femm), one commit each | `claude/pillar-layout-proof-a` | 1 |
| Phase 2 group B | Tasks 2.5-2.7 (common-questions, rrm-success-rates, art-registries), one commit each | `claude/pillar-layout-proof-b` | 1 |
| Phase 3 wave 1 | Task 3.1 (what-is-rrm, naprotechnology, neofertility) | `claude/pillar-layout-wave-1` | 1 |
| Phase 3 wave 2 | Task 3.2 (pcos, endometriosis, miscarriage) | `claude/pillar-layout-wave-2` | 1 |

5 deploys total, not 15. Within a group: run the comparator + gates + lint PER COMMIT locally (the proof is per-page), accumulate commits on the one branch, then push ONCE at the end of the group after the last commit's checks pass. The per-page comparator still works batched: capture each page's PRE render before editing THAT page (the other pages on the branch are still un-migrated at that point, so their pre-render is origin/main state).

---

## File Structure

**Created:**
- `scripts/migrations/2026-06-08-capture-pillar-fields.mjs` — one-shot: scrapes the 7 new fields from each pillar's current source into `ssot/guides.json`. Run once in Phase 0, then archived.
- `src/layouts/GuideLayout.astro` — the layout. Owns the foundation; forwards `BaseLayout` props; relays page schema.
- `scripts/gates/compare-pillar-migration.mjs` — the semantic comparator. Diffs pre/post rendered HTML for one page; asserts additive-only.
- `tests/gates/validate-guides-registry-g7.test.mjs` — G7 unit tests (poison cases).
- `tests/gates/compare-pillar-migration.test.mjs` — comparator self-test (synthetic pre/post).

**Modified:**
- `ssot/guides.json` — +7 fields per entry (`pageTitle`, `pageDescription`, `pageH1`, `breadcrumbName`, `authorId`, optional `reviewer`, `usesGuideLayout`).
- `scripts/gates/validate-guides-registry.mjs` — extend `REQUIRED_FIELDS` (+6, not `reviewer`); add `gateG7`; wire into the error set.
- `scripts/build-guides-data.mjs` — read `pageH1`/`pageDescription` from the registry for `usesGuideLayout:true` pages instead of scraping.
- `src/pages/<slug>/index.astro` (×13) — swap `BaseLayout` -> `GuideLayout`, move prose into the slot, pass schema via `jsonLd`/`extraSchema`, flip `usesGuideLayout:true` in the same commit. The 3 `@graph` pages (what-is-rrm, common-questions-about-rrm, art-registries-and-codes) decompose their `@graph` in the process.

---

## Phase 0: Foundation SSOT (one atomic commit, no page migrated)

Everything in Phase 0 lands in ONE commit so every intermediate state passes the gates. Build the pieces across Tasks 0.1-0.4, stage them together, run the green-check, then a single commit.

### Task 0.1: Capture the 7 new registry fields into `ssot/guides.json`

**Files:**
- Create: `scripts/migrations/2026-06-08-capture-pillar-fields.mjs`
- Modify: `ssot/guides.json` (written by the script)

- [ ] **Step 1: Write the capture script**

```javascript
// scripts/migrations/2026-06-08-capture-pillar-fields.mjs
// One-shot: scrape pageTitle, pageH1, pageDescription, breadcrumbName, authorId,
// reviewer (optional) from each pillar's current .astro source and add them +
// usesGuideLayout:false to ssot/guides.json. Idempotent: re-running overwrites
// the same fields with the same scraped values. Run ONCE in Phase 0, then archive.
//
// Usage: node scripts/migrations/2026-06-08-capture-pillar-fields.mjs [--check]
//   --check : print what would be captured, do NOT write.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SSOT = join(ROOT, 'ssot', 'guides.json');
const PAGES = join(ROOT, 'src', 'pages');

function splitFrontmatter(src) {
  if (!src.startsWith('---')) return { frontmatter: '', body: src };
  const closing = src.slice(3).match(/\n---(?:\r?\n|$)/);
  if (!closing) return { frontmatter: '', body: src };
  const end = 3 + closing.index;
  return { frontmatter: src.slice(3, end), body: src.slice(end + closing[0].length) };
}
const ENT = { '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&apos;':"'",
  '&nbsp;':' ','&rsaquo;':'>','&lsaquo;':'<','&ndash;':'-','&mdash;':'-','&hellip;':'...',
  '&rsquo;':"'",'&lsquo;':"'",'&rdquo;':'"','&ldquo;':'"' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] || ' ');
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

function baseLayoutTag(body) {
  const start = body.indexOf('<BaseLayout');
  if (start === -1) return '';
  let i = start, depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '{') depth++; else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return body.slice(start, i + 1);
    i++;
  }
  return '';
}
function attr(tag, name) {
  const dq = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (dq) return decode(dq[1]).trim();
  const sq = tag.match(new RegExp(`\\b${name}='([^']+)'`));
  if (sq) return decode(sq[1]).trim();
  return '';
}
function extractH1(body) {
  const m = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : '';
}
function extractBreadcrumbName(body) {
  // The visible breadcrumb's last node is a bare <span> (no <a>): the current page.
  // Pattern in every pillar: <span>Endometritis</span> as the final crumb.
  const crumbs = [...body.matchAll(/<span(?:\s[^>]*)?>([^<]+)<\/span>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t && t !== '›' && t !== '>' && t !== '&rsaquo;');
  return crumbs.length ? crumbs[crumbs.length - 1] : '';
}
function extractAuthor(frontmatter) {
  // From the page's JSON-LD author/reviewedBy @id. Org-author pillars set
  // author=#organization + reviewedBy=#naomi-whittaker; Naomi-author pillars set
  // author=#naomi-whittaker with no reviewedBy; femm sets author=#naomi-whittaker
  // and renders a non-schema reviewer (Erin Kay) in the byline only.
  const authorId = /author:\s*\{[^}]*['"]@id['"]:\s*['"][^'"]*#organization['"]/.test(frontmatter)
    ? '#organization'
    : (/author:\s*\{[^}]*#naomi-whittaker/.test(frontmatter) ? '#naomi-whittaker' : null);
  let reviewer = null;
  const rev = frontmatter.match(/reviewedBy:\s*\{[^}]*['"]@id['"]:\s*['"][^'"]*#([a-z-]+)['"]/);
  if (rev) reviewer = { name: 'Dr. Naomi Whittaker, MD', id: `#${rev[1]}` };
  return { authorId, reviewer };
}
// femm is the one page with a byline reviewer that is NOT in the schema. Hand-map
// it so the scrape does not have to parse byline DOM for a string @id has no source.
const BYLINE_REVIEWER_OVERRIDE = {
  femm: { name: 'Erin Kay, DO' }, // no `id`: Erin Kay is not in the identity graph
};

const registry = JSON.parse(readFileSync(SSOT, 'utf-8'));
const check = process.argv.includes('--check');
const report = [];
for (const p of registry.pillars) {
  const path = join(PAGES, p.file);
  if (!existsSync(path)) { console.error(`MISSING ${p.file}`); process.exit(1); }
  const { frontmatter, body } = splitFrontmatter(readFileSync(path, 'utf-8'));
  const tag = baseLayoutTag(body);
  const pageTitle = attr(tag, 'title');
  const pageDescription = attr(tag, 'description');
  const pageH1 = extractH1(body);
  const breadcrumbName = extractBreadcrumbName(body);
  const { authorId, reviewer: schemaReviewer } = extractAuthor(frontmatter);
  const reviewer = BYLINE_REVIEWER_OVERRIDE[p.slug] || schemaReviewer || undefined;
  if (!pageTitle || !pageDescription || !pageH1 || !breadcrumbName || !authorId) {
    console.error(`CAPTURE GAP ${p.slug}: ` +
      JSON.stringify({ pageTitle, pageDescription, pageH1, breadcrumbName, authorId }));
    process.exit(1);
  }
  p.pageTitle = pageTitle;
  p.pageDescription = pageDescription;
  p.pageH1 = pageH1;
  p.breadcrumbName = breadcrumbName;
  p.authorId = authorId;
  if (reviewer) p.reviewer = reviewer; else delete p.reviewer;
  p.usesGuideLayout = false;
  report.push({ slug: p.slug, pageTitle, pageH1, breadcrumbName, authorId, reviewer: reviewer || null });
}
if (check) {
  console.table(report);
} else {
  writeFileSync(SSOT, JSON.stringify(registry, null, 2) + '\n');
  console.log(`Captured 7 fields for ${registry.pillars.length} pillars into ssot/guides.json`);
  console.table(report);
}
```

- [ ] **Step 2: Dry-run and eyeball the capture**

Run: `node scripts/migrations/2026-06-08-capture-pillar-fields.mjs --check`
Expected: a 13-row table. Verify by hand: `pageH1` differs from `pageTitle` on what-is-rrm / naprotechnology / femm / neofertility / art-registries-and-codes / miscarriage; `authorId='#organization'` on glossary / art-registries-and-codes / rrm-success-rates / isthmocele; `reviewer` is `{name:'Erin Kay, DO'}` on femm and `{name:'Dr. Naomi Whittaker, MD', id:'#naomi-whittaker'}` on the 4 org-author pillars; `null` on the other 8. If any row shows an empty cell, the scraper missed a pattern on that page — read that page's `<h1>`/`<BaseLayout>`/breadcrumb and adjust the relevant extractor, do NOT hand-edit the JSON.

- [ ] **Step 3: Write the fields**

Run: `node scripts/migrations/2026-06-08-capture-pillar-fields.mjs`
Expected: `Captured 7 fields for 13 pillars`. Confirm: `node -e "const p=require('./ssot/guides.json').pillars; console.log(p.every(x=>x.pageTitle&&x.pageH1&&x.pageDescription&&x.breadcrumbName&&x.authorId&&x.usesGuideLayout===false))"` prints `true`.

(No commit yet — Phase 0 commits atomically in Task 0.4.)

### Task 0.2: Extend `REQUIRED_FIELDS` + add `gateG7`

**Files:**
- Modify: `scripts/gates/validate-guides-registry.mjs:REQUIRED_FIELDS` (append 6) and add `gateG7` + wire into `errors`
- Test: `tests/gates/validate-guides-registry-g7.test.mjs`

- [ ] **Step 1: Write the failing G7 test**

```javascript
// tests/gates/validate-guides-registry-g7.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { gateG7 } from '../../scripts/gates/validate-guides-registry.mjs';

const mkReg = (overrides) => ({
  pillars: [{ slug: 'demo', file: 'demo/index.astro', usesGuideLayout: false, ...overrides }],
});

test('G7: usesGuideLayout:true page that imports BaseLayout directly fails', () => {
  const src = `---\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<BaseLayout title="x">y</BaseLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.ok(issues.some((i) => i.includes('must import GuideLayout') || i.includes('must NOT import or use BaseLayout')));
});

test('G7: usesGuideLayout:true page that imports GuideLayout and has no BaseLayout passes', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\n---\n<GuideLayout slug="demo">y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.deepStrictEqual(issues, []);
});

test('G7: usesGuideLayout:false page that imports GuideLayout fails (half-revert)', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\n---\n<GuideLayout slug="demo">y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: false }), () => src);
  assert.ok(issues.some((i) => i.includes('must NOT import GuideLayout')));
});

test('G7: a commented import does not satisfy the anchored regex', () => {
  const src = `---\n// import GuideLayout from '../../layouts/GuideLayout.astro';\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<BaseLayout title="x">y</BaseLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.ok(issues.length > 0);
});

test('G7: migrated page may keep an ItemList literal (passthrough, not banned)', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\nconst extra = [{ '@type': 'ItemList' }];\n---\n<GuideLayout slug="demo" extraSchema={extra}>y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.deepStrictEqual(issues, []);
});

test('G7: migrated page that hand-rolls a BreadcrumbList literal fails', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\nconst bc = { '@type': 'BreadcrumbList' };\n---\n<GuideLayout slug="demo">y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.ok(issues.some((i) => i.includes('BreadcrumbList')));
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test tests/gates/validate-guides-registry-g7.test.mjs`
Expected: FAIL — `gateG7` is not exported / not defined.

- [ ] **Step 3: Extend `REQUIRED_FIELDS` and add `gateG7`**

In `scripts/gates/validate-guides-registry.mjs`, change the `REQUIRED_FIELDS` array to append the 6 required new fields (NOT `reviewer`):

```javascript
const REQUIRED_FIELDS = [
  'slug',
  'file',
  'title',
  'description',
  'og_title',
  'og_description',
  'author',
  'read_time',
  'accent',
  'in_guides_catalogue',
  'in_shell_guides_nav',
  // GuideLayout foundation fields (added 2026-06-08). reviewer is intentionally
  // NOT here: 9 pillars have no reviewer and gateG1 fails on `=== undefined`.
  'pageTitle',
  'pageDescription',
  'pageH1',
  'breadcrumbName',
  'authorId',
  'usesGuideLayout',
];
```

Add the gate function (place it next to `gateG6`). It takes an optional `readFile` injector so the test can pass synthetic source:

```javascript
const IMPORT_PILLAR_RE = /^\s*import\s+GuideLayout\s+from\s+['"][^'"]*GuideLayout\.astro['"]/m;
const IMPORT_BASE_RE = /^\s*import\s+BaseLayout\s+from\s+['"][^'"]*BaseLayout\.astro['"]/m;
const USES_BASE_TAG_RE = /<BaseLayout[\s>]/;
const HANDROLLED_BREADCRUMB_RE = /['"]@type['"]\s*:\s*['"]BreadcrumbList['"]/;

export function gateG7(registry, readFile = (p) => readFileSync(p, 'utf-8')) {
  const issues = [];
  for (const p of registry.pillars || []) {
    if (typeof p.usesGuideLayout !== 'boolean' || !p.file) continue; // gateG1 already flagged a missing flag/file
    const fullPath = join(ROOT, 'src', 'pages', p.file);
    let src;
    try { src = readFile(fullPath); } catch { continue; } // gateG1 already flagged a missing file
    const importsPillar = IMPORT_PILLAR_RE.test(src);
    if (p.usesGuideLayout) {
      if (!importsPillar) issues.push(`G7 ${p.slug}: usesGuideLayout:true but does not import GuideLayout`);
      if (IMPORT_BASE_RE.test(src) || USES_BASE_TAG_RE.test(src))
        issues.push(`G7 ${p.slug}: usesGuideLayout:true but still imports/uses BaseLayout directly (GuideLayout wraps it)`);
      if (HANDROLLED_BREADCRUMB_RE.test(src))
        issues.push(`G7 ${p.slug}: usesGuideLayout:true but hand-rolls a BreadcrumbList literal (the layout owns it; @graph pages must delete the in-graph BreadcrumbList)`);
    } else if (importsPillar) {
      issues.push(`G7 ${p.slug}: usesGuideLayout:false but imports GuideLayout (half-revert?)`);
    }
  }
  return issues;
}
```

Wire it into the run block — change the `errors` line:

```javascript
  const g6 = gateG6(registry);
  const g7 = gateG7(registry);
  const g5 = gateG5(registry);
  const errors = [...g1, ...g23, ...g6, ...g7];
```

And update the ALL CLEAR log string to mention G7.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test tests/gates/validate-guides-registry-g7.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full validator against the captured registry**

Run: `node scripts/gates/validate-guides-registry.mjs`
Expected: `G1-G3 + G6 ... ALL CLEAR` (now also G7). All 13 pillars have `usesGuideLayout:false` and still import BaseLayout, so G7 is green. Exit 0.

(No commit yet.)

### Task 0.3: Refactor `build-guides-data.mjs` to read the registry for migrated pages

**Files:**
- Modify: `scripts/build-guides-data.mjs` (the `GUIDES` map and the `build()` extraction)
- Test: extend `tests/gates/` with a build-guides-data test, OR run the script directly (it self-validates)

- [ ] **Step 1: Carry the full pillar entry, not just slug/file**

Change the `GUIDES` definition:

```javascript
const GUIDES = PILLAR_REGISTRY.pillars
  .map((p) => ({
    slug: p.slug,
    file: p.file,
    usesGuideLayout: p.usesGuideLayout === true,
    pageH1: p.pageH1,
    pageDescription: p.pageDescription,
  }))
  .sort((a, b) => a.slug.localeCompare(b.slug));
```

- [ ] **Step 2: Branch the extraction on the flag**

In `build()`, replace the `const title = extractH1(body);` / `const description = extractBaseLayoutDescription(body);` lines and their guards with:

```javascript
    let title, description;
    if (g.usesGuideLayout) {
      // Migrated pages render the <h1> and wrap BaseLayout inside GuideLayout,
      // so there is no literal <h1>/<BaseLayout> to scrape. Read the verbatim
      // values the registry captured. pageH1 (NOT pageTitle) is the guides-card
      // title -- they differ on 6 concept pillars and this string is embedded 3x
      // by the Vectorize embedder, so substituting pageTitle would shift ranking.
      title = (g.pageH1 || '').trim();
      description = (g.pageDescription || '').trim();
      if (!title) { console.error(`Migrated pillar ${g.slug} missing registry pageH1`); process.exit(1); }
      if (!description) { console.error(`Migrated pillar ${g.slug} missing registry pageDescription`); process.exit(1); }
    } else {
      title = extractH1(body);
      description = extractBaseLayoutDescription(body);
      if (!title) { console.error(`Failed to extract <h1> from ${g.file}`); process.exit(1); }
      if (!description) { console.error(`Failed to extract BaseLayout description from ${g.file}`); process.exit(1); }
    }
```

- [ ] **Step 3: Verify the refactor is a no-op while all flags are false**

Run: `node scripts/build-guides-data.mjs && cp src/data/guides.json /tmp/guides-phase0.json`
Then confirm it byte-matches the pre-refactor output by stashing the script change is not needed — instead assert the title for a divergent pillar still equals its `<h1>`:
Run: `node -e "const g=require('./src/data/guides.json').find(x=>x.slug==='what-is-rrm'); console.log(g.title)"`
Expected: the `<h1>` text (e.g. `What is Restorative Reproductive Medicine (RRM)?`), NOT the `<title>`. Because all flags are false, every page still goes through the scrape branch, so guides.json is identical to before.

- [ ] **Step 4: Confirm the validator still passes (build-guides-data is a G2/G3 consumer)**

Run: `node scripts/gates/validate-guides-registry.mjs`
Expected: ALL CLEAR (the refactor keeps the `join(ROOT, 'ssot', 'guides.json')` import and introduces no hardcoded pillar list).

### Task 0.4: Green-check and commit Phase 0 atomically

- [ ] **Step 1: Full gate + build green-check**

Run:
```bash
node scripts/gates/validate-guides-registry.mjs && \
node --test tests/gates/validate-guides-registry-g7.test.mjs && \
npm run build
```
Expected: validator ALL CLEAR; G7 tests PASS; `npm run build` clean and prints `Wrote 13 guide entries`.

- [ ] **Step 2: Stage everything and commit as one atomic Phase 0 commit**

```bash
git add ssot/guides.json scripts/gates/validate-guides-registry.mjs scripts/build-guides-data.mjs scripts/migrations/2026-06-08-capture-pillar-fields.mjs tests/gates/validate-guides-registry-g7.test.mjs
git commit -m "pillar-layout phase 0: registry foundation fields + G7 + guides-data refactor

Adds 7 registry fields (6 required + optional reviewer), gateG7 (flag-based,
inert while all flags false), and the build-guides-data registry-read path for
migrated pages. No page migrated; gates + build green."
```

---

## Phase 1: Build the layout and the comparator (inert, zero-risk)

### Task 1.1: `GuideLayout.astro`

**Files:**
- Create: `src/layouts/GuideLayout.astro`

The layout reproduces the canonical pillar DOM (breadcrumb, byline, TOC, accordion, disclaimer, cite) that today lives hand-copied in every page, driven by registry fields + props. It forwards the full BaseLayout prop surface via a single spread so no prop is dropped.

- [ ] **Step 1: Write the component**

```astro
---
// src/layouts/GuideLayout.astro
// Owns the registry-driven SEO foundation + uniform scaffolding for pillar guides.
// The page passes its domain schema verbatim (jsonLd + extraSchema); the layout
// NEVER re-derives a domain node. It emits the one foundation node it owns:
// BreadcrumbList. Forwards every BaseLayout prop the page sets via ...baseLayout.
import BaseLayout from './BaseLayout.astro';
import MaybeShell from '../components/MaybeShell.astro';
import SectionTocChips from '../components/SectionTocChips.astro';
import BackToTop from '../components/BackToTop.astro';
import LastUpdated from '../components/LastUpdated.astro';
import { isShellEnabled } from '../lib/shell-routes';
import { safeJsonLd } from '../lib/jsonld';
import guideRegistry from '../../ssot/guides.json';

interface Reviewer { name: string; id?: string; }
interface TocItem { href: string; label: string; }
interface Faq { question: string; answerHtml: string; }

interface Props {
  slug: string;
  // Domain schema passthrough (the page authors these).
  jsonLd?: object;
  extraSchema?: object[];
  // Scaffolding DOM inputs.
  tocItems?: TocItem[];
  faqs?: Faq[];
  keyTakeawaysHtml?: string;     // inner HTML of the <aside class="tldr">
  disclaimerHtml?: string;       // inner HTML of the <p class="disclaimer">
  editingNotice?: boolean;
  disambigHtml?: string;
  citeThisPage?: boolean;
  // Shell opt-outs.
  hasRail?: boolean;
  showToc?: boolean;
  // Full BaseLayout prop surface, forwarded verbatim. The page passes what it
  // passes today (title/description are overridden from the registry below).
  baseLayout?: Record<string, unknown>;
}

const {
  slug,
  jsonLd,
  extraSchema = [],
  tocItems = [],
  faqs = [],
  keyTakeawaysHtml,
  disclaimerHtml = 'This content is for educational and reference purposes only and does not constitute medical advice, diagnosis, or treatment. Consult a qualified clinician about your specific situation.',
  editingNotice = false,
  disambigHtml,
  citeThisPage = false,
  hasRail = false,
  showToc = true,
  baseLayout = {},
} = Astro.props;

const entry = guideRegistry.pillars.find((p) => p.slug === slug);
if (!entry) throw new Error(`GuideLayout: slug "${slug}" not in ssot/guides.json`);

const PAGE_URL = `https://rrmacademy.org/${slug}/`;
const SHELL_ENABLED = isShellEnabled('guides');

// The ONE schema node the layout owns. The page must NOT also emit a BreadcrumbList
// (G7 enforces); @graph pages delete their in-graph BreadcrumbList during migration.
const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rrmacademy.org/' },
    { '@type': 'ListItem', position: 2, name: 'Guides', item: 'https://rrmacademy.org/guides/' },
    { '@type': 'ListItem', position: 3, name: entry.breadcrumbName, item: PAGE_URL },
  ],
};

// Byline resolution. authorId/reviewer drive the VISIBLE byline only; the JSON-LD
// author/reviewedBy live in the page's verbatim jsonLd.
const AVATAR = {
  '#naomi-whittaker': '/images/authors/naomi-whittaker.webp',
  '#organization': '/apple-touch-icon.png',
};
const NAOMI_BYLINE = 'Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI';
const authorIsNaomi = entry.authorId === '#naomi-whittaker';
const authorAvatar = AVATAR[entry.authorId] || null;
const reviewerAvatar = entry.reviewer?.id ? AVATAR[entry.reviewer.id] : (entry.reviewer ? '/images/authors/erin-kay.webp' : null);

// Forward title/description from the registry; the page's baseLayout spread
// supplies canonicalUrl/ogType/publishDate/speakable/chrome/trackScroll/markdownUrl/etc.
const baseLayoutProps = {
  ...baseLayout,
  title: entry.pageTitle,
  description: entry.pageDescription,
  canonicalUrl: (baseLayout as any).canonicalUrl ?? PAGE_URL,
  jsonLd,
  chrome: SHELL_ENABLED ? 'shell' : 'default',
};
---

<BaseLayout {...baseLayoutProps}>
  <script type="application/ld+json" set:html={safeJsonLd(breadcrumbSchema)} />
  {extraSchema.map((node) => (
    <script type="application/ld+json" set:html={safeJsonLd(node)} />
  ))}

  <MaybeShell enabled={SHELL_ENABLED} context="page" currentPath={Astro.url.pathname} saveTitle={entry.breadcrumbName} hasRail={hasRail}>
    <div class="page-wrapper" data-pagefind-body>
      <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a>
          <span aria-hidden="true"> &rsaquo; </span>
          <a href="/guides/">Guides</a>
          <span aria-hidden="true"> &rsaquo; </span>
          <span>{entry.breadcrumbName}</span>
        </nav>

        <h1 set:html={entry.pageH1} />

        <div class="author-byline">
          <div class="author-avatar-stack">
            {authorAvatar && <img src={authorAvatar} alt={authorIsNaomi ? 'Dr. Naomi Whittaker, MD' : 'RRM Academy'} class="author-byline__photo" width="48" height="48" />}
            {reviewerAvatar && <img src={reviewerAvatar} alt={entry.reviewer?.name} class="author-byline__photo" width="48" height="48" />}
          </div>
          <div class:list={['author-byline__text', { 'has-reviewer': !!entry.reviewer }]}>
            <span class="byline-author">By <strong>{authorIsNaomi
              ? <a href="/commentary/rrm-spotlight-naomi-whittaker-md/">{NAOMI_BYLINE}</a>
              : 'RRM Academy'}</strong></span>
            {entry.reviewer && <span class="byline-reviewer">Reviewed by <strong>{entry.reviewer.name}</strong></span>}
            <LastUpdated path={`/${slug}/`} class="byline-date" />
          </div>
        </div>

        {disambigHtml && <aside class="disambig" set:html={disambigHtml} />}

        {showToc && tocItems.length > 0 && (
          <details class="toc-mobile">
            <summary>On this page</summary>
            <ol>{tocItems.map((i) => <li><a href={i.href}>{i.label}</a></li>)}</ol>
          </details>
        )}
        {SHELL_ENABLED && showToc && tocItems.length > 0 && <SectionTocChips items={tocItems} />}

        <div class:list={['article-layout', { 'article-layout--no-toc': SHELL_ENABLED || tocItems.length === 0 }]}>
          {!SHELL_ENABLED && showToc && tocItems.length > 0 && (
            <nav class="toc" aria-label="Table of contents">
              <p class="toc-heading">On this page</p>
              <ol>{tocItems.map((i) => <li><a href={i.href}>{i.label}</a></li>)}</ol>
            </nav>
          )}

          <article class="prose">
            {editingNotice && (
              <aside class="editing-notice" role="status" aria-label="Editor's note">
                <p><strong>Editor's note:</strong> This guide is newly published and being actively reviewed. Content and citations may be refined over the next few days.</p>
              </aside>
            )}
            {keyTakeawaysHtml && (
              <aside class="tldr"><h2 id="key-takeaways">Key Takeaways</h2><Fragment set:html={keyTakeawaysHtml} /></aside>
            )}

            <slot />

            {faqs.length > 0 && (
              <section id="faq">
                <h2>Frequently Asked Questions</h2>
                <div class="faq-accordion" data-pagefind-ignore>
                  {faqs.map((f) => (
                    <details class="faq-item">
                      <summary>{f.question}</summary>
                      <div class="faq-answer"><Fragment set:html={f.answerHtml} /></div>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {citeThisPage && <slot name="cite" />}

            <p class="disclaimer"><em><Fragment set:html={disclaimerHtml} /></em></p>
          </article>

          {hasRail && <slot name="rail" />}
        </div>
      </div>
    </div>
    <BackToTop />
  </MaybeShell>
</BaseLayout>

<style>
  /* Copy the canonical pillar styles verbatim from the current isthmocele/endometritis
     page <style> block: .editing-notice, .author-byline, .author-avatar-stack,
     .author-byline__photo, .has-reviewer, .byline-reviewer, .tldr, .faq-accordion,
     .faq-item, .disclaimer, .disambig, .toc, .toc-mobile, .article-layout,
     .article-layout--no-toc. These are identical across all 13 pages today; lifting
     them into the layout is the point. Paste the exact rules so byline/TOC/accordion
     render byte-identical (the comparator checks byline outerHTML). */
</style>
```

- [ ] **Step 2: Lift the shared `<style>` block verbatim**

Open `src/pages/isthmocele/index.astro`, copy its entire `<style>` block (the `.editing-notice`, `.author-byline*`, `.condition-grid`, `.pathway-*`, `.toc*`, `.faq-*`, `.disclaimer` rules) into GuideLayout's `<style>`, replacing the placeholder comment. Keep card-grid rules (`.condition-grid`, `.pathway-grid`) since condition pages render those grids in the slot.

- [ ] **Step 3: Type-check + build (layout is unused, must not break the build)**

Run: `npm run check-types && npm run build`
Expected: no new type errors above baseline; build clean. The layout is imported by nothing yet, so `astro build` only type-checks it.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/GuideLayout.astro
git commit -m "pillar-layout phase 1: add GuideLayout.astro (inert, unused)"
```

### Task 1.2: The semantic comparator

**Files:**
- Create: `scripts/gates/compare-pillar-migration.mjs`
- Test: `tests/gates/compare-pillar-migration.test.mjs`

The comparator takes two rendered HTML files (pre = the page built before migration, post = after) and asserts the migration is additive-only: every pre JSON-LD node reappears post byte-equal (node-level, so an `@graph` decomposition is not flagged); exactly one BreadcrumbList exists post; the full `<head>` meta/link set + `<body>` attributes are unchanged; the byline outerHTML is unchanged; `guides.json` title/description match.

- [ ] **Step 1: Write the comparator**

```javascript
// scripts/gates/compare-pillar-migration.mjs
// Usage: node scripts/gates/compare-pillar-migration.mjs <pre.html> <post.html> [--slug <slug>] [--guides-pre <file>] [--guides-post <file>]
// Exit 0 = additive-only; exit 1 = a removal/change detected.
import { readFileSync } from 'fs';

export function extractLdJson(html) {
  const nodes = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let obj;
    try { obj = JSON.parse(m[1].trim()); } catch { continue; }
    const graph = obj['@graph'] && Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
    for (const node of graph) nodes.push(node);
  }
  return nodes;
}
const nodeKey = (n) => {
  const t = Array.isArray(n['@type']) ? n['@type'].join('+') : (n['@type'] || '?');
  return n['@id'] || `${t}::${n.headline || n.name || ''}`;
};
const canon = (v) => JSON.stringify(v, Object.keys(v).sort?.() ? sortDeep(v) : v);
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

export function extractHead(html) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [''])[0];
  const metas = [...head.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim());
  const links = [...head.matchAll(/<link\s[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim());
  const title = (head.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  return { title, metas: metas.sort(), links: links.sort() };
}
export function extractBodyAttrs(html) {
  const tag = (html.match(/<body\b[^>]*>/i) || [''])[0];
  return [...tag.matchAll(/[a-z-]+(?:="[^"]*")?/gi)].map((m) => m[0]).filter((a) => a !== 'body').sort();
}
export function extractByline(html) {
  const m = html.match(/<div class="author-byline">[\s\S]*?<\/div>\s*<\/div>/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

export function compare(preHtml, postHtml) {
  const issues = [];
  // 1. JSON-LD nodes: node-level superset, no removals/changes (BreadcrumbList exempt).
  const pre = extractLdJson(preHtml).filter((n) => nodeKey(n) !== 'BreadcrumbList::');
  const post = extractLdJson(postHtml);
  const postByKey = new Map(post.map((n) => [nodeKey(n), n]));
  for (const n of pre) {
    const k = nodeKey(n);
    if (k.startsWith('BreadcrumbList')) continue;
    if (!postByKey.has(k)) { issues.push(`JSON-LD node removed: ${k}`); continue; }
    if (canon(postByKey.get(k)) !== canon(n)) issues.push(`JSON-LD node changed: ${k}`);
  }
  const bcCount = post.filter((n) => nodeKey(n).startsWith('BreadcrumbList')).length;
  if (bcCount !== 1) issues.push(`expected exactly 1 BreadcrumbList post-migration, found ${bcCount}`);
  // 2. head + body.
  const h0 = extractHead(preHtml), h1 = extractHead(postHtml);
  if (h0.title !== h1.title) issues.push(`<title> changed: "${h0.title}" -> "${h1.title}"`);
  if (JSON.stringify(h0.metas) !== JSON.stringify(h1.metas)) issues.push('<head> <meta> set changed');
  if (JSON.stringify(h0.links) !== JSON.stringify(h1.links)) issues.push('<head> <link> set changed');
  if (JSON.stringify(extractBodyAttrs(preHtml)) !== JSON.stringify(extractBodyAttrs(postHtml)))
    issues.push('<body> attribute set changed (trackScroll/etc)');
  // 3. byline.
  if (extractByline(preHtml) !== extractByline(postHtml)) issues.push('byline DOM changed');
  return issues;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [pre, post] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const gi = process.argv.indexOf('--guides-pre'), gj = process.argv.indexOf('--guides-post'), si = process.argv.indexOf('--slug');
  const issues = compare(readFileSync(pre, 'utf-8'), readFileSync(post, 'utf-8'));
  if (gi > -1 && gj > -1 && si > -1) {
    const slug = process.argv[si + 1];
    const g0 = JSON.parse(readFileSync(process.argv[gi + 1], 'utf-8')).find((g) => g.slug === slug);
    const g1 = JSON.parse(readFileSync(process.argv[gj + 1], 'utf-8')).find((g) => g.slug === slug);
    if (!g0 || !g1) issues.push(`guides.json entry for ${slug} missing in pre or post`);
    else {
      if (g0.title !== g1.title) issues.push(`guides.json title changed: "${g0.title}" -> "${g1.title}"`);
      if (g0.description !== g1.description) issues.push(`guides.json description changed`);
    }
  }
  if (issues.length) { console.error(`NOT ADDITIVE (${issues.length}):`); for (const i of issues) console.error('  - ' + i); process.exit(1); }
  console.log('ADDITIVE: pre == post for all schema nodes, head, body, byline' + (gi > -1 ? ', guides.json' : ''));
  process.exit(0);
}
```

- [ ] **Step 2: Write the comparator self-test**

```javascript
// tests/gates/compare-pillar-migration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { compare } from '../../scripts/gates/compare-pillar-migration.mjs';

const wrap = (head, body) => `<html><head><title>T</title>${head}</head><body data-x>${body}</body></html>`;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const BYLINE = '<div class="author-byline"><div class="author-avatar-stack"></div><div class="author-byline__text"><span>By X</span></div></div>';

test('identical pages are additive', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.deepStrictEqual(compare(pre, pre), []);
});

test('@graph decomposed into separate blocks is additive (node-level)', () => {
  const pre = wrap('', ld({ '@graph': [{ '@type': 'Article', headline: 'H' }, { '@type': 'FAQPage' }, { '@type': 'BreadcrumbList' }] }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'FAQPage' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.deepStrictEqual(compare(pre, post), []);
});

test('a dropped Article property is flagged', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H', image: 'x.png' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('changed')));
});

test('duplicate BreadcrumbList is flagged', () => {
  const pre = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'Article', headline: 'H' }) + ld({ '@type': 'BreadcrumbList' }) + ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('exactly 1 BreadcrumbList')));
});

test('a changed <meta> is flagged', () => {
  const pre = wrap('<meta name="description" content="A">', ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('<meta name="description" content="B">', ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  assert.ok(compare(pre, post).some((i) => i.includes('meta')));
});

test('a changed byline is flagged', () => {
  const pre = wrap('', ld({ '@type': 'BreadcrumbList' }) + BYLINE);
  const post = wrap('', ld({ '@type': 'BreadcrumbList' }) + BYLINE.replace('By X', 'By Y'));
  assert.ok(compare(pre, post).some((i) => i.includes('byline')));
});
```

- [ ] **Step 3: Run the self-test**

Run: `node --test tests/gates/compare-pillar-migration.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 4: Commit**

```bash
git add scripts/gates/compare-pillar-migration.mjs tests/gates/compare-pillar-migration.test.mjs
git commit -m "pillar-layout phase 1: semantic migration comparator + self-test"
```

---

## Phase 2: Proof migrations (7 pages, one commit each)

### Task 2.0: The per-page migration procedure (reference for Tasks 2.1-2.7 and Phase 3)

Each migration is the same recipe. Steps marked (@graph) apply only to what-is-rrm, common-questions-about-rrm, art-registries-and-codes.

1. **Capture the PRE render.** Do this ONCE per deploy-group, at the group-start state (after the prior group's branch base, before editing ANY page in this group). At that point every page in the group is still un-migrated, so this single build is the correct PRE for every page in the group:
   ```bash
   npm run build
   cp -r dist /tmp/dist-pre                       # served for Playwright PRE screenshots (step 6)
   cp src/data/guides.json /tmp/guides-pre.json   # the un-migrated guides baseline (built, not git-read)
   for s in <slugs-in-this-group>; do cp dist/$s/index.html /tmp/$s-pre.html; done
   ```
   The `guides-pre.json` built here is the spec's "build the un-migrated page" baseline (not a git read, not a registry read), so the comparator's guides.json byte-equality check is non-tautological.
2. **Edit the page `.astro`:**
   - Replace `import BaseLayout from '...'` with `import GuideLayout from '../../layouts/GuideLayout.astro'`.
   - Keep the frontmatter that builds the domain schema object (`pageSchema`/`jsonLd`). DELETE the frontmatter that builds the BreadcrumbList (the layout owns it).
   - (@graph) Split the single `@graph` object: the Article/MedicalWebPage node becomes the `jsonLd` object; FAQPage / ItemList / DefinedTermSet become entries in an `extraSchema` array; the in-`@graph` BreadcrumbList node is deleted.
   - For separate-block pages: the standalone `<script set:html={safeJsonLd(faqSchema)} />` etc. become `extraSchema={[faqSchema, ...]}`; the standalone BreadcrumbList block is deleted.
   - Replace the `<BaseLayout ...> ... </BaseLayout>` wrapper with `<GuideLayout slug="<slug>" jsonLd={pageSchema} extraSchema={[...]} tocItems={TOC_ITEMS} faqs={FAQ_ITEMS} baseLayout={{ ...the props the page passed to BaseLayout EXCEPT title/description/jsonLd/chrome... }}>`.
   - Move ONLY the prose sections + card grids into the default slot. Delete the now-duplicated breadcrumb nav, `<h1>`, byline, TOC markup, FAQ accordion markup, disclaimer, and `<BackToTop/>` from the page body (the layout renders them). Delete the page's `<style>` rules that the layout now owns (keep page-unique styles, e.g. a condition-specific grid that is not in the layout).
   - Build `FAQ_ITEMS` as `[{question, answerHtml}]` from the visible accordion the page had (answerHtml preserves inline `<a href="/library/...">` links). The FAQPage SCHEMA stays in `extraSchema`/`jsonLd` verbatim.
3. **Flip the flag in the SAME edit:** set `"usesGuideLayout": true` for this slug in `ssot/guides.json`.
4. **Capture the POST render + compare:**
   ```bash
   npm run build
   cp dist/<slug>/index.html /tmp/<slug>-post.html
   node scripts/gates/compare-pillar-migration.mjs /tmp/<slug>-pre.html /tmp/<slug>-post.html \
     --slug <slug> --guides-pre /tmp/guides-pre.json --guides-post src/data/guides.json
   ```
   Expected: `ADDITIVE: ...`. If `NOT ADDITIVE`, read each issue and fix the page edit (a removed node = a schema block you forgot to pass via extraSchema; a changed meta = a BaseLayout prop you forgot to forward in `baseLayout`; a changed byline = an authorId/reviewer mismatch in the registry).
5. **Gates green:** `node scripts/gates/validate-guides-registry.mjs` (G7 now checks this page imports GuideLayout, no BaseLayout, no BreadcrumbList literal).
6. **Visual parity (body prose):** the comparator already proved the byline/breadcrumb/`<head>`/schema are byte-identical; this step guards the prose move into the slot. Serve the built site and screenshot pre vs post:
   ```bash
   # PRE (before editing the page, on the un-migrated build from step 1's dist):
   npx wrangler pages dev /tmp/dist-pre --port 8788 &   # (copy dist -> /tmp/dist-pre in step 1)
   npx playwright screenshot --viewport-size=1280,2000 http://localhost:8788/<slug>/ /tmp/<slug>-pre-desktop.png
   npx playwright screenshot --viewport-size=393,852  http://localhost:8788/<slug>/ /tmp/<slug>-pre-mobile.png
   # POST (after npm run build in step 4):
   npx wrangler pages dev dist --port 8789 &
   npx playwright screenshot --viewport-size=1280,2000 http://localhost:8789/<slug>/ /tmp/<slug>-post-desktop.png
   npx playwright screenshot --viewport-size=393,852  http://localhost:8789/<slug>/ /tmp/<slug>-post-mobile.png
   ```
   Compare each pre/post pair (the Playwright MCP `browser_take_screenshot` + visual inspection, or `node -e` pixel diff). The body prose must be visually identical; the byline/h1/breadcrumb were already byte-verified by the comparator. Any visible body delta is an ABORT condition (a prose section was dropped or reordered during the slot move).
7. **Commit** (one page per commit, on the GROUP branch from the Deploy Choreography table): `git commit -m "pillar-layout: migrate /<slug>/ to GuideLayout"`. Do NOT push per page — accumulate the group's commits, then at the end of the group run `npm run lint && node scripts/gates/validate-guides-registry.mjs && npm run build` once more and push the whole group branch ONE time.

### Task 2.1: Migrate `/endometritis/` (worked example — Person-author, hand-authored FAQPage, accordion)

**Files:**
- Modify: `src/pages/endometritis/index.astro`, `ssot/guides.json`

- [ ] **Step 1: PRE render** — `npm run build && cp dist/endometritis/index.html /tmp/endometritis-pre.html && cp src/data/guides.json /tmp/guides-pre.json`

- [ ] **Step 2: Edit `endometritis/index.astro`** following Task 2.0 step 2. endometritis emits SEPARATE blocks (`jsonLd={pageSchema}` + standalone `breadcrumbSchema` + `faqSchema` scripts). So:
  - Delete the `breadcrumbSchema` const and its `<script>` block.
  - Keep `pageSchema` (the Article+MedicalWebPage node) and `faqSchema` (the hand-authored FAQPage).
  - Wrapper becomes:
    ```astro
    <GuideLayout
      slug="endometritis"
      jsonLd={pageSchema}
      extraSchema={[faqSchema]}
      tocItems={TOC_ITEMS}
      faqs={FAQ_ITEMS}
      disambigHtml={`Endometritis is not endometriosis. <a href="/endometriosis/">See the endometriosis guide</a>.`}
      baseLayout={{ ogType: 'article', publishDate: PUBLISH_DATE, speakable: ['.pillar-lead','h1'], trackScroll: true }}
    >
      {/* prose sections only */}
    </GuideLayout>
    ```
  - `FAQ_ITEMS = [{ question, answerHtml }]` built from the 9 visible accordion entries (NOT from `faqSchema.mainEntity` — the accordion answers carry inline library links the schema text omits).
  - Remove the page body's breadcrumb nav, `<h1>`, byline, `.toc`, `.toc-mobile`, the `<section id="faq">` accordion, the disclaimer, `<BackToTop/>`. Move the remaining `<section>` prose into the slot.
  - Set `"usesGuideLayout": true` for endometritis in `ssot/guides.json`.

- [ ] **Step 3: POST render + comparator**

```bash
npm run build && cp dist/endometritis/index.html /tmp/endometritis-post.html
node scripts/gates/compare-pillar-migration.mjs /tmp/endometritis-pre.html /tmp/endometritis-post.html \
  --slug endometritis --guides-pre /tmp/guides-pre.json --guides-post src/data/guides.json
```
Expected: `ADDITIVE: ...`.

- [ ] **Step 4: Gate + visual parity** — `node scripts/gates/validate-guides-registry.mjs` (ALL CLEAR) + Playwright desktop/mobile screenshot of `/endometritis/` matches pre.

- [ ] **Step 5: Commit** — `git add src/pages/endometritis/index.astro ssot/guides.json && git commit -m "pillar-layout: migrate /endometritis/ to GuideLayout"`

### Tasks 2.2-2.7: Migrate the remaining 6 proof pages

Apply Task 2.0 to each, one commit per page, with the page-specific notes below. Run the comparator after each; it is the proof.

- [ ] **Task 2.2 `/isthmocele/`** — org-author + Naomi reviewer (byline two-avatar), `MedicalCondition` ICD-10-CM in `jsonLd`, `editingNotice={true}`. Separate blocks. Card-grid styles (`.condition-grid`, `.pathway-grid`) are in the layout already (lifted from this page in 1.1); delete them from the page.
- [ ] **Task 2.3 `/glossary/`** — custom rail: pass `hasRail={true}` + `<Fragment slot="rail">` (the A-Z index). org-author, no FAQ (omit `faqs`). `DefinedTermSet` is a standalone block today -> `extraSchema={[definedTermSetSchema]}`. Sets `markdownUrl="/glossary.md"` -> include in `baseLayout`. `in_shell_guides_nav:false` is already a registry display field, untouched.
- [ ] **Task 2.4 `/femm/`** — Person-author + non-Naomi reviewer: registry `reviewer:{name:'Erin Kay, DO'}` (no id) drives the second avatar (`erin-kay.webp`) + "Reviewed by Erin Kay, DO". The page's `jsonLd` keeps `author=#naomi-whittaker` and NO `reviewedBy` (verbatim). `about:MedicalTherapy` + the `CreativeWork` Vigil-2019 citation stay inside the Article node's `citation[]` in `jsonLd`, untouched. Confirm the comparator shows the `CreativeWork` node byte-equal.
- [ ] **Task 2.5 `/common-questions-about-rrm/` (@graph)** — root file (`src/pages/common-questions-about-rrm.astro`, registry `file` is the bare filename). bare `Article` (`schemaType` stays `['Article']`; the page's `jsonLd` is just the Article node post-decompose). `@graph` DECOMPOSE: Article -> `jsonLd`; `buildFAQPage(...)` node -> `extraSchema`; in-graph BreadcrumbList deleted. NO accordion (omit `faqs`; the FAQ is schema-only). `pagefindIgnore` + no TOC: pass `showToc={false}` and ensure `data-pagefind-ignore` is preserved (the page sets it on its body; keep it on the slot content).
- [ ] **Task 2.6 `/rrm-success-rates/`** — citations with `url`+`sameAs` (built by the page's `toCitation`/`citeStub`) + `about:MedicalTherapy` + `Article.image` + `wordCount` all ride in `jsonLd` verbatim. Separate blocks. `trackScroll:true` in `baseLayout`. The comparator must show the full `citation[]` (with url/sameAs) byte-equal.
- [ ] **Task 2.7 `/art-registries-and-codes/` (@graph)** — `@graph` DECOMPOSE: Article -> `jsonLd`; `ItemList` (the ~20-CreativeWork primary payload) -> `extraSchema`; FAQPage -> `extraSchema`; in-graph BreadcrumbList deleted. Disjoint `articleSection` vs `hasPart` both live inside the Article node in `jsonLd`, so both survive verbatim (no `tocItems`-derivation concern; `tocItems` only drives the visible TOC). org-author.

After Task 2.7: `git log --oneline -8` shows Phase 0/1 + 7 proof commits; the comparator passed on all 7 covering every edge (separate-block, @graph decompose, rail, two-avatar byline, schema-only FAQ, rich citations, ItemList).

---

## Phase 3: Waves (remaining 6, ~3 per wave)

Same Task 2.0 procedure, one commit per page. Batch each wave on one branch; push once per wave (per `feedback-batch-arise-deploys`).

### Task 3.1: Wave 1 — what-is-rrm (@graph), naprotechnology, neofertility

- [ ] **`/what-is-rrm/` (@graph)** — `@graph` DECOMPOSE (Article -> jsonLd; FAQPage -> extraSchema; in-graph BreadcrumbList deleted). Triple-distinct strings: `pageTitle` ("What Is RRM? Restorative Reproductive Medicine") drives `<title>`, `pageH1` ("What is Restorative Reproductive Medicine (RRM)?") drives the `<h1>` + guides card, registry `title` (card-label legacy) untouched. `about:MedicalTherapy` + `Article.image` ride in jsonLd. The comparator's `<title>` and guides.json assertions are the proof here.
- [ ] **`/naprotechnology/`** — separate blocks, Person-author, `about:MedicalTherapy`, `Article.image`. `pageH1` ≠ `pageTitle`.
- [ ] **`/neofertility/`** — separate blocks, Person-author, `about:MedicalTherapy`. `pageH1` ≠ `pageTitle`.
- [ ] Build all three (one branch), run the comparator per page, gates green, Playwright parity, then push the wave once.

### Task 3.2: Wave 2 — pcos, endometriosis, miscarriage

- [ ] **`/pcos/`** — condition, `MedicalCondition` in jsonLd, separate blocks, Person-author, accordion.
- [ ] **`/endometriosis/`** — condition, `MedicalCondition` in jsonLd, separate blocks, Person-author, accordion.
- [ ] **`/miscarriage/`** — condition, separate blocks, Person-author. `pageH1` ≠ `pageTitle`.
- [ ] Build all three, comparator per page, gates green, Playwright parity, push the wave once.

After Task 3.2: all 13 `usesGuideLayout:true`; G7 enforces the import on every pillar; `npm run build` lists 13 guides; `sitemap-pillars.xml` + `/guides/` + OG index unchanged (registry display fields were never touched). Archive the capture script: `git mv scripts/migrations/2026-06-08-capture-pillar-fields.mjs scripts/migrations/_archive/` with a note that it was one-shot.

---

## Self-Review

**Spec coverage:**
- Foundation ownership (title/desc/canonical/og/h1/breadcrumb/byline/toc/faq/disclaimer/cite) → Task 1.1. ✓
- 7 registry fields + capture → Task 0.1; `pageH1` distinct from `pageTitle` → 0.1 step 2 + 0.3. ✓
- `REQUIRED_FIELDS` 6-not-7, `reviewer` excluded → Task 0.2 step 3. ✓
- G7 flag-based, anchored regex, no-BaseLayout, no-hand-rolled-BreadcrumbList, does-not-ban-passthrough-literals → Task 0.2 (+ poison tests). ✓
- build-guides-data reads `pageH1` for migrated pages → Task 0.3. ✓
- Verbatim passthrough (`jsonLd` + `extraSchema`), layout owns only BreadcrumbList → Task 1.1 + 2.0. ✓
- `@graph` decomposition (node-level equality, single BreadcrumbList) → Task 2.0 step 2 (@graph) + comparator (2.1) + the 3 @graph pages (2.5, 2.7, 3.1). ✓
- Full BaseLayout-prop forwarding (`...baseLayout`, incl. canonicalUrl/trackScroll/markdownUrl) → Task 1.1. ✓
- Comparator: node-level JSON-LD superset, full `<head>`/`<body>` diff, byline outerHTML, guides.json baseline (built from the pre commit) → Task 1.2. ✓
- Flag flipped in the same commit; gate green per commit; whole-commit rollback → Task 2.0 steps 3/5/7. ✓
- Proof set of 7 covering every edge → Tasks 2.1-2.7. ✓
- Waves of 3 → Tasks 3.1-3.2. ✓

**Placeholder scan:** The only intentional "fill from source" is the lifted `<style>` block (Task 1.1 step 2, an explicit copy-from-isthmocele instruction, not a TODO) and the per-page prose moves (mechanical, specified in 2.0). All scripts/gates/comparator are complete code.

**Type/name consistency:** `gateG7(registry, readFile)` signature matches the test injector; `usesGuideLayout` boolean is the same field in capture (0.1), validator (0.2), build-guides-data (0.3), and G7; `pageH1`/`pageDescription`/`pageTitle`/`breadcrumbName`/`authorId`/`reviewer` consistent across 0.1/0.3/1.1; comparator exports `compare`/`extractLdJson`/`extractHead`/`extractBodyAttrs`/`extractByline` used by its test.

**Known follow-up (not blocking):** the comparator's `guides.json` baseline requires building the page at the parent commit first (Task 2.0 step 1 captures `/tmp/guides-pre.json`); this is the spec's "build the un-migrated page" mechanism, not a git read.
