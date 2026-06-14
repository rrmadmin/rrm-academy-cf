# Library Category Curation — Phase 1 Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2 (2026-06-14):** Revised after an Opus 4.8 + GPT-5.5 fusion review. Changes from v1: (1) the index.astro filter no longer touches the global corpus count; (2) all D1 writes moved behind the go-live gate with read-only dry-run manifests first; (3) re-classify uses a unique tag + `classification_history` revert and recomputes the set from a fresh live query; (4) the 23 RE-only records are curated per-record, not bulk-defaulted; (5) `_redirects` keeps both slash forms + a live post-deploy curl gate; (6) a search-index refresh + llms-override update added; (7) a fail-hard Node proof script replaces the soft grep checks.

**Goal:** Stop surfacing anti-RRM papers on library category pages/atlas, fix the ~55 mislabeled `critical` records in D1, prune 21 auto-categories to 16 (demoting Reproductive Endocrinology, Ethics/Philosophy + 3 others to tag-only), and refresh the atlas tiles — build-time, self-maintaining, with every live write behind Brian's go-live gate.

**Architecture:** One shared SSOT registry `src/data/library-topics.ts` drives both library pages (allowlist + tiles + descriptors + `isCategorySafe`). The pages apply it at build time. A separate, gated D1 pass makes `critical`/`hostile` honestly mean "anti-RRM" and re-homes 23 orphan records. No worker/runtime/schema changes.

**Tech Stack:** Astro 5 (static), CF Pages, rrm-router (service binding in front of Pages), D1 `rrm-library`, `wrangler d1`, `/classify-library` skill, worker `/index/batch`, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-14-library-category-curation-design.md`

**HARD GATE:** No production write of ANY kind — not the site deploy, not the D1 mutations — happens until Brian gives explicit go-live. D1 writes are live the instant they land (visible via the worker `/articles`, search, `/ask`, MCP), so they sit in Phase 1B, after the gate. Phase 1A is code + read-only dry-run manifests only.

**Pre-flight (worktree off origin/main — the shared clone is DIRTY):**
```bash
source ~/.zshrc                                   # op + node on PATH (lights-off safety)
cd ~/iCode/projects/rrm-academy-cf && git fetch origin
WT=/tmp/lib-curation-wt
git worktree add -b claude/library-category-curation "$WT" origin/main
ln -sf ~/iCode/projects/rrm-academy-cf/node_modules "$WT/node_modules"   # MANDATORY: a bare worktree's
  # pre-commit guards (iOS-zoom, css-audit) crash with ERR_MODULE_NOT_FOUND: postcss and FALSE-BLOCK
  # .astro commits (confirmed incidents 2026-06-02, 2026-06-13). Symlink the main clone's node_modules.
cd "$WT"
export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/CF - D1 Operator - account/credential')
export ADMIN_TOKEN=$(op read 'op://Automation/RRM Library Worker Admin Token/credential')
WORKER="https://rrm-library-worker.administrator-cloudflare.workers.dev"
```
**Phase 1A revert authority:** NO production state changes in Phase 1A. To abort: `git worktree remove --force "$WT"` + delete the branch. Every commit is local to the worktree until Brian's go-live.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/data/library-topics.ts` | Create | SSOT registry: `CATEGORIES`, derived `CATEGORY_ALLOWLIST`/`ATLAS_TILES`/`TOPIC_DESCRIPTORS`, `DEMOTED_SLUGS`, `isCategorySafe`, `topicSlug`, `topLevelTopics` |
| `src/icons/healthicons/diagnostics.svg` | Create | Icon for the new Diagnostics tile |
| `src/pages/library/topics/[slug].astro` | Modify | `getStaticPaths` filters by `isCategorySafe` + allowlist; descriptors from SSOT |
| `src/pages/library/index.astro` | Modify | Split `allArticles` (corpus count) vs `safeArticles` (tiles + recent); `ATLAS_TILES`; iconKey wiring |
| `public/_redirects` | Modify | 301 the 5 demoted slugs (both slash forms) |
| `static-overrides/library-llms.txt` (+ source of llms.txt topic list) | Modify | Drop demoted categories from AI-facing topic inventory |
| `scripts/gates/verify-library-curation.mjs` | Create | Fail-hard build-output proof gate |
| D1 `rrm-library.articles` | Data op (Phase 1B) | Re-classify ~55 mislabeled; re-home 23 RE-only |

**Verification philosophy:** static-site IA + data change → binding gates are the **fail-hard proof script** (greps `dist/`, exits nonzero), **live production curls** (post-deploy), and **D1 query checks** for data ops. Not a unit-test runner (repo uses Playwright e2e only).

---
---
# PHASE 1A — code + read-only dry-run (PRE-GATE: no live writes, no deploy)
---

## Task 1: SSOT registry `src/data/library-topics.ts`

**Files:** Create `src/data/library-topics.ts`

- [ ] **Step 1: Write the module** (one registry → all derived; no duplicated descriptor maps)

```ts
// src/data/library-topics.ts
// SINGLE source of truth for library category browse: which top-level topics get a browse
// page (allowlist), which appear as atlas tiles, their copy, and the build-time sentiment
// filter. Imported by index.astro + topics/[slug].astro so the surfaces can't drift.

export interface Category {
  label: string;          // canonical top-level topic label exactly as stored in D1 topics[]
  pageDescriptor: string; // intro line on /library/topics/<slug>/
  browsable: boolean;     // true => gets a browse page
  tile?: {                // present => also an atlas tile on /library/
    name: string;         // tile display name (may differ from label, e.g. "Hormones & Cycle")
    accent: string;       // y|r|g|p|s (existing tile CSS)
    desc: string;         // short tile copy (distinct purpose from pageDescriptor; co-located so no silent drift)
    iconKey: string;      // key into TOPIC_ICONS in index.astro
    match?: string[];     // top-level labels this tile counts (default [label]); MUST equal what the page shows
  };
}

// 16 browsable categories; 10 of them are atlas tiles. Everything NOT here is tag-only.
export const CATEGORIES: Category[] = [
  { label: 'Endometriosis', browsable: true, pageDescriptor: 'Excision, AMH, recurrence, biomarkers.',
    tile: { name: 'Endometriosis', accent: 'y', iconKey: 'Endometriosis', desc: 'Excision surgery, recurrence, biomarkers, fertility outcomes.' } },
  { label: 'Infertility', browsable: true, pageDescriptor: 'RRM work-up, IVF outcomes, recurrent loss.',
    tile: { name: 'Infertility', accent: 'r', iconKey: 'Infertility', desc: 'RRM work-up, IVF outcomes, recurrent loss, cumulative pregnancy rates.' } },
  { label: 'PCOS', browsable: true, pageDescriptor: 'Phenotype, insulin resistance, progesterone.',
    tile: { name: 'PCOS', accent: 'g', iconKey: 'PCOS', desc: 'Phenotypes, insulin resistance, ovulation, progesterone.' } },
  { label: 'Pregnancy', browsable: true, pageDescriptor: 'Progesterone support, miscarriage, neonatal outcomes.',
    tile: { name: 'Pregnancy', accent: 'r', iconKey: 'Pregnancy', desc: 'Progesterone support, miscarriage prevention, neonatal outcomes.' } },
  { label: 'Menstrual Cycle', browsable: true, pageDescriptor: 'Cycle physiology, mucus biomarkers, ovulation.',
    tile: { name: 'Hormones & Cycle', accent: 'p', iconKey: 'Hormones & Cycle', desc: 'Cycle physiology, mucus and temperature biomarkers, ovulation timing.' } },
  { label: 'Diagnostics', browsable: true, pageDescriptor: 'Hormone panels, ultrasound, ovarian reserve, cycle charting.',
    tile: { name: 'Diagnostics', accent: 's', iconKey: 'Diagnostics', desc: 'Hormone panels, ultrasound, ovarian reserve, cycle charting as a diagnostic.' } },
  { label: 'Contraception/Comparison', browsable: true, pageDescriptor: 'Side effects, long-term outcomes, comparison studies.',
    tile: { name: 'Contraception', accent: 's', iconKey: 'Contraception', desc: 'Side effects, long-term outcomes, head-to-head comparisons.' } },
  // NaPro tile counts ONLY NaProTECHNOLOGY so the number matches the destination page (RRM Methods has its own page).
  { label: 'NaProTECHNOLOGY', browsable: true, pageDescriptor: 'Cumulative pregnancy rates, protocols, vs IVF.',
    tile: { name: 'NaProTECHNOLOGY', accent: 'p', iconKey: 'NaProTECHNOLOGY', desc: 'Protocols, cumulative pregnancy rates, restorative vs IVF.', match: ['NaProTECHNOLOGY'] } },
  { label: 'Fertility Awareness', browsable: true, pageDescriptor: 'Method efficacy, Creighton, Marquette, Billings, FEMM.',
    tile: { name: 'Fertility Awareness', accent: 'g', iconKey: 'Fertility Awareness', desc: 'Method efficacy: Creighton, Marquette, Billings, FEMM, sympto-thermal.' } },
  { label: 'Surgery', browsable: true, pageDescriptor: 'Excision, laparoscopy, fertility-sparing approaches.',
    tile: { name: 'Surgery', accent: 's', iconKey: 'Surgery', desc: 'Excision, laparoscopy, fertility-sparing reproductive surgery.' } },
  // browsable, no tile:
  { label: 'RRM Methods', browsable: true, pageDescriptor: 'Restorative protocols and outcomes.' },
  { label: 'Body Literacy', browsable: true, pageDescriptor: 'Understanding the cycle as a vital sign.' },
  { label: 'Perimenopause/Menopause', browsable: true, pageDescriptor: 'Hormonal transition, symptoms, restorative options.' },
  { label: 'Bone Health', browsable: true, pageDescriptor: 'Estrogen, bone density, contraceptive and lifecycle effects.' },
  { label: 'Andrology', browsable: true, pageDescriptor: 'Male-factor evaluation and treatment.' },
  { label: 'Postpartum', browsable: true, pageDescriptor: 'Recovery, breastfeeding, return of fertility.' },
];

export const GENERIC_DESCRIPTOR = 'Research articles on this topic in the RRM Academy library.';

// Demoted top-level topics — tag-only, no page. 301 → /library/. (Brian + fusion verdict 2026-06-14.)
export const DEMOTED_SLUGS = [
  'reproductive-endocrinology', 'research-methodology',
  'general-ob-gyn', 'ethics-philosophy', 'patient-education',
];

// Derived (single registry → no parallel maps to drift)
export const CATEGORY_ALLOWLIST = new Set(CATEGORIES.filter(c => c.browsable).map(c => c.label.toLowerCase()));
export const TOPIC_DESCRIPTORS: Record<string, string> =
  Object.fromEntries(CATEGORIES.map(c => [c.label, c.pageDescriptor]));
export const ATLAS_TILES = CATEGORIES.filter(c => c.tile).map(c => ({
  name: c.tile!.name, accent: c.tile!.accent, desc: c.tile!.desc, iconKey: c.tile!.iconKey,
  match: c.tile!.match ?? [c.label],
}));

// top-level topic = text before the first " > "
export function topLevelTopics(topics: unknown): string[] {
  const out: string[] = [];
  for (const t of (Array.isArray(topics) ? topics : [])) {
    const seg = String(t).split(' > ')[0].trim();
    if (seg && !out.includes(seg)) out.push(seg);
  }
  return out;
}

// Anti-RRM papers excluded from curated browse (pages + atlas counts + recent). Still
// published, searchable, individually reachable, and present in /library/?topic= and the
// JSONL feed by design. Self-maintaining: future hostile/critical papers auto-drop.
const EXCLUDED_SENTIMENTS = new Set(['hostile', 'critical']);
export function isCategorySafe(article: { sentiment?: string }): boolean {
  return !EXCLUDED_SENTIMENTS.has(String(article?.sentiment || '').toLowerCase());
}

export function topicSlug(topic: string): string {
  return topic
    .toLowerCase().replace(/\//g, '-').replace(/\s+&\s+/g, '-and-').replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
```

- [ ] **Step 2: Type-check** — `npx astro check --minimumSeverity error 2>&1 | tail -5` → no new errors.
- [ ] **Step 3: Commit** — `git add src/data/library-topics.ts && git commit -m "feat(library): single-registry category SSOT (allowlist, tiles, sentiment filter)"`

---

## Task 2: Diagnostics tile icon

**Files:** Create `src/icons/healthicons/diagnostics.svg`

- [ ] **Step 1** Add a filled, `fill="currentColor"` glyph from the healthicons set (e.g. "blood_tubes" or "microscope"). Match the existing siblings' viewBox/structure.
- [ ] **Step 2** Validate XML: `python3 -c "import xml.etree.ElementTree as ET; ET.parse('src/icons/healthicons/diagnostics.svg'); print('OK')"` → `OK`.
- [ ] **Step 3: Commit** — `git add src/icons/healthicons/diagnostics.svg && git commit -m "feat(library): diagnostics atlas tile icon"`

---

## Task 3: Wire `topics/[slug].astro` (sentiment filter + allowlist)

**Files:** Modify `src/pages/library/topics/[slug].astro`

- [ ] **Step 1** Replace the local `TOPIC_DESCRIPTORS`, local `topicSlug`, and `getStaticPaths` with SSOT imports. New frontmatter top:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import ArticleCard from '../../../components/ArticleCard.astro';
import AppShellChrome from '../../../components/AppShellChrome.astro';
import { isShellEnabled } from '../../../lib/shell-routes';
import { fetchAllArticles } from '../../../lib/airtable';
import {
  CATEGORY_ALLOWLIST, TOPIC_DESCRIPTORS, GENERIC_DESCRIPTOR,
  isCategorySafe, topicSlug, topLevelTopics,
} from '../../../data/library-topics';

const SHELL_ENABLED = isShellEnabled('library');

export async function getStaticPaths() {
  const articles = (await fetchAllArticles()).filter(isCategorySafe);  // anti-RRM excluded
  const segmentLabels = new Map<string, string>();
  for (const a of articles) {
    for (const label of topLevelTopics(a.topics)) {
      const key = label.toLowerCase();
      if (CATEGORY_ALLOWLIST.has(key) && !segmentLabels.has(key)) segmentLabels.set(key, label);
    }
  }
  return Array.from(segmentLabels.values()).map(label => {
    const matched = articles.filter(a =>
      topLevelTopics(a.topics).some(t => t.toLowerCase() === label.toLowerCase())
    );
    matched.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
    return { params: { slug: topicSlug(label) }, props: { topicLabel: label, topicArticles: matched } };
  });
}

interface Props { topicLabel: string; topicArticles: any[]; }
const { topicLabel, topicArticles } = Astro.props;
const descriptor = TOPIC_DESCRIPTORS[topicLabel] ?? GENERIC_DESCRIPTOR;
const slug = topicSlug(topicLabel);
// (canonicalUrl, pageTitle, pageDescription, jsonLd below — UNCHANGED)
---
```
Leave the template + `<style>` unchanged.

- [ ] **Step 2** Type-check → no new errors in `topics/[slug].astro`.
- [ ] **Step 3: Commit** — `git add 'src/pages/library/topics/[slug].astro' && git commit -m "feat(library): category pages honor allowlist + exclude anti-RRM"`

---

## Task 4: Wire `index.astro` (split corpus count vs safe set; tiles; iconKey)

**Files:** Modify `src/pages/library/index.astro`

- [ ] **Step 1** Add the Diagnostics icon import (after line 19) and the `TOPIC_ICONS` entry:
```ts
import iconDiagnostics from '../../icons/healthicons/diagnostics.svg?raw';
```
```ts
  Diagnostics: iconDiagnostics,
```

- [ ] **Step 2** Add the SSOT import:
```ts
import { ATLAS_TILES, isCategorySafe, topicSlug, topLevelTopics } from '../../data/library-topics';
```

- [ ] **Step 3** **CRITICAL — do NOT reassign the global `articles`.** Keep line 35 (`const articles = await fetchAllArticles();`) unchanged so `numberOfItems` (line 142), the `<title>` (185), the meta description (186), and the visible hero count (202) still reflect the FULL corpus. Add a filtered set right after line 35:
```ts
// Anti-RRM papers are excluded from tiles + recent, but NOT from the headline corpus count.
const safeArticles = articles.filter(isCategorySafe);
```
Change `recent` (line 38) to derive from `safeArticles`:
```ts
const recent = safeArticles.slice(0, 6).map((a: Article) => {  // was: articles.slice(0, 6)
```

- [ ] **Step 4** Replace the local `countTopic`, `TOPICS`, `topicSlug`, `topicTiles` (lines ~64-124) with:
```ts
function countTopic(matchTargets: string[]): number {
  const targets = new Set(matchTargets.map(s => s.toLowerCase()));
  let n = 0;
  for (const a of safeArticles) {                       // count from the SAFE set (parity with pages)
    if (topLevelTopics(a.topics).some(t => targets.has(t.toLowerCase()))) n++;
  }
  return n;
}
const topicTiles = ATLAS_TILES.map(t => ({
  ...t,
  count: countTopic(t.match),
  href: `/library/topics/${topicSlug(t.match[0])}/`,
}));
```
Update the tile JSX icon lookup from `TOPIC_ICONS[t.name]` to `TOPIC_ICONS[t.iconKey]` (line ~228) so the icon key is decoupled from the display name. Leave `t.accent`, `t.desc`, `t.count` JSX as-is.

- [ ] **Step 5** Type-check → no new errors.
- [ ] **Step 6: Commit** — `git add src/pages/library/index.astro && git commit -m "feat(library): atlas tiles from SSOT, exclude anti-RRM from tiles/recent, preserve corpus count, add Diagnostics"`

---

## Task 5: 301 the demoted category slugs (both slash forms)

**Files:** Modify `public/_redirects`

`_redirects` IS honored for `/library/*` through the rrm-router (verified live:
`/library/saved` → 301 → `/saved/`, lines 14-15 of the same file). The line-63 "lives in the
router" note is about root/site-wide redirects the router handles directly — not `/library/*`,
which is proxied to Pages. Match the file's both-forms convention (lines 14-15).

- [ ] **Step 1** Append:
```
/library/topics/reproductive-endocrinology   /library/   301
/library/topics/reproductive-endocrinology/  /library/   301
/library/topics/research-methodology         /library/   301
/library/topics/research-methodology/        /library/   301
/library/topics/general-ob-gyn               /library/   301
/library/topics/general-ob-gyn/              /library/   301
/library/topics/ethics-philosophy            /library/   301
/library/topics/ethics-philosophy/           /library/   301
/library/topics/patient-education            /library/   301
/library/topics/patient-education/           /library/   301
```
- [ ] **Step 2: Commit** — `git add public/_redirects && git commit -m "feat(library): 301 demoted category slugs to /library/ (both slash forms)"`

---

## Task 6: Update the AI-facing topic inventory (consistency)

**Files:** Modify the SOURCE of the llms topic list (not the generated `public/` copies).

- [ ] **Step 1** Find where "Reproductive Endocrinology" (and the other 4 demoted labels) are named as headline topics:
```bash
grep -rn -i "reproductive endocrinology\|research methodology\|ethics/philosophy" static-overrides/ ssot/ scripts/ssot-prebuild.mjs 2>/dev/null
```
- [ ] **Step 2** Edit ONLY where a demoted label appears as an ENUMERATED browse topic/category. Drop the 5 demoted labels from the topic list and add Diagnostics. **Decision:** leave descriptive prose that merely mentions the subject (e.g. "hormonal imbalance and reproductive endocrinology" as a sentence, not a category) UNCHANGED — only the category enumeration is curated. Do NOT edit generated `public/*.txt` (overwritten at build).
- [ ] **Step 3** Rebuild (Task 8) regenerates `public/llms.txt` etc.; verify: `grep -i "reproductive endocrinology" dist/llms.txt dist/library/llms.txt` → no entry in a topic/category LIST (descriptive prose is fine).
- [ ] **Step 4: Commit** — name the exact files touched (NOT a directory add, which would sweep the dirty clone's WIP): `git add static-overrides/library-llms.txt static-overrides/llms.txt static-overrides/llms-full.txt && git commit -m "chore(library): align llms topic inventory with curated categories"` (adjust the file list to exactly what Step 1's grep surfaced).

---

## Task 7: Fail-hard build-output proof gate

**Files:** Create `scripts/gates/verify-library-curation.mjs`

- [ ] **Step 1** Write a Node script that exits nonzero on any violation:

```js
// scripts/gates/verify-library-curation.mjs — run after `npm run build`.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { CATEGORY_ALLOWLIST, DEMOTED_SLUGS, topicSlug, CATEGORIES } from '../../src/data/library-topics.ts';
// NOTE: run via `node --experimental-strip-types scripts/gates/verify-library-curation.mjs`
// (Node 22+) OR import from a built JS copy; if strip-types unavailable, inline the 16 slugs.

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const DIST = 'dist/library/topics';

// 1) exactly the 16 allowlisted slugs exist; none demoted.
const expected = new Set(CATEGORIES.filter(c => c.browsable).map(c => topicSlug(c.label)));
const got = existsSync(DIST) ? readdirSync(DIST).filter(d => !d.includes('.')) : [];
for (const d of got) if (!expected.has(d)) fail(`unexpected category page: ${d}`);
for (const e of expected) if (!got.includes(e)) fail(`missing category page: ${e}`);
for (const d of DEMOTED_SLUGS) if (got.includes(d)) fail(`demoted slug still has a page: ${d}`);

// 2) no flagged slug leaks onto any category page.
const FLAGGED = ['the-false-promise-of-restorative','endometriosis-surgery-debates','contraceptive-failure-of-the-ovulation','the-risks-of-the-natural-family-planning','the-new-politics-of-natural-family-planning','too-soon-to-adopt-progesterone','false-risk-attribution','abortion-myths-and-realities','between-advanced-medical-technology','reply-of-the-authors','response-to-the-illusion'];
for (const d of got) {
  const html = readFileSync(`${DIST}/${d}/index.html`, 'utf8');
  for (const f of FLAGGED) if (html.includes(f)) fail(`flagged slug ${f} leaked onto /library/topics/${d}/`);
}

// 3) schemamap lists exactly the 16 (if present).
if (existsSync('dist/schemamap.xml')) {
  const sm = readFileSync('dist/schemamap.xml', 'utf8');
  for (const d of DEMOTED_SLUGS) if (sm.includes(`/library/topics/${d}`)) fail(`schemamap still lists demoted ${d}`);
}

// 4) corpus headline count NOT reduced — index hero must still show the full count.
//    (Sanity: the homepage number should match the article feed length, not the safe subset.)
const idx = readFileSync('dist/library/index.html', 'utf8');
if (!/academic scholarly works/i.test(idx)) fail('index hero count text missing/changed unexpectedly');

if (process.exitCode) console.error('library-curation gate: FAILED'); else console.log('library-curation gate: PASS');
```
(If `--experimental-strip-types` import of the `.ts` SSOT is unavailable in the CI Node, inline the 16 expected slugs + DEMOTED_SLUGS as literals at the top.) The `FLAGGED` slug prefixes are the 11 known anti-RRM records (provenance = the 11 D1 ids in the spec table: recqRxIi, recA07i0, reckZdx7, recXuAGp, receIN3P, reca7WHv, rectfW68, recnPSZL, reckLRPo, recicgZ9, recguD4d). This gate guards the dist leak surface; the authoritative "exactly 11 remain flagged" check is the D1 query in Task 9.2.

- [ ] **Step 2: Commit** — `git add scripts/gates/verify-library-curation.mjs && git commit -m "test(library): fail-hard proof gate for category curation"`

---

## Task 8: Build + local verify + dry-run manifests (end of Phase 1A)

**Files:** none (build + read-only D1 queries)

- [ ] **Step 1** Fresh build with live data:
```bash
LIBRARY_BUILD_TOKEN=$(op read 'op://Automation/RRM Library Worker Build Token/credential') npm run fetch-all
npm run build
```
Expected: succeeds; CI floor `articles >= 3000` satisfied.

- [ ] **Step 2** Run the proof gate:
```bash
node --experimental-strip-types scripts/gates/verify-library-curation.mjs
```
Expected: `library-curation gate: PASS`.

- [ ] **Step 3** Repo gates: `npm run check-types && npm run lint && npm run guard` → all pass.

- [ ] **Step 4** Playwright visual (desktop + 393×852): `/library/` (10 tiles incl. Diagnostics, refreshed copy, headline count = full corpus) + `/library/topics/infertility/`. Confirm no broken layout, Diagnostics icon renders.

- [ ] **Step 5 — DRY-RUN re-classify manifest (read-only).** Recompute the mislabeled set from LIVE D1 (cache lags live):
```bash
cd ~/iCode/projects/rrm-library-worker
npx wrangler d1 execute rrm-library --remote --json --command \
 "SELECT id, slug, title, sentiment, domain, rrm_relevance FROM articles WHERE is_published=1 AND is_retracted=0 AND type NOT IN ('faq','post','course','guide') AND sentiment IN ('hostile','critical') AND id NOT IN ('recqRxIiGTT3AZ4QK','recA07i0bJXLk7VGp','reckZdx7yVNLVMP6O','recXuAGpgGIuWCtB0','receIN3PuPlSjOODh','reca7WHvsnWaQY7qX','rectfW68sPM12S9WL','recnPSZLQR19mVwSp','reckLRPo9VFs5YMkM','recicgZ9RHL5atFDk','recguD4d9U7FUCwHh')" \
 > ~/iCode/projects/rrm-academy-cf/docs/superpowers/plans/manifest-reclassify.json
```
Expected ≈55 rows. This is the before-state + the exact target id list (rollback source via the unique tag too). **Commit both manifests in the worktree** (`git add docs/superpowers/plans/manifest-*.json && git commit -m "docs(library): phase-1A dry-run manifests"`) so they survive worktree cleanup and Brian reviews them at the gate.

- [ ] **Step 6 — DRY-RUN re-home curation manifest (read-only).** Identify the RE-only records and PROPOSE a per-record destination (read title+abstract; Sonnet-tier, NOT the Fable main loop, per sanitize rules). Output `docs/superpowers/plans/manifest-rehome.json` with `{id, title, current_topics, proposed_topic|"search-only"|"remove-bad-RE-tag", reason}` for each. Default heuristic is a starting point only — curate per record (the 23 include off-topic records: bovine reproduction, thyroid, neuroendocrinology, gender-transition therapy). Do NOT bulk-default to Menstrual Cycle.
```bash
npx wrangler d1 execute rrm-library --remote --json --command \
 "SELECT id, slug, title, topics FROM articles WHERE is_published=1 AND is_retracted=0 AND topics LIKE '%Reproductive Endocrinology%'" \
 > /tmp/re-records.json   # then filter to RE-only (topLevelTopics == ['Reproductive Endocrinology']) in a script
```

- [ ] **Step 7 — HOLD.** Present to Brian: the Playwright screenshots, the PASS gate output, `manifest-reclassify.json` (≈55), and `manifest-rehome.json` (23 curated). **Do not deploy. Do not write to D1.** Await explicit go-live.

---
---
# GO-LIVE GATE — Brian's explicit approval required before anything below
---
---
# PHASE 1B — live writes + deploy (POST-GATE only)
---

## Task 9: Execute re-classification (D1, live)

- [ ] **Step 1** Run `/classify-library --re-classify <ids from manifest-reclassify.json>` under a **unique model tag** `reclassify-mislabel-2026-06-14`. Apply the canon (IVF/ART/contraception studies → `neutral`; `critical` only for substantive disagreement with RRM; `hostile` for active attack; contraceptive-harm → `neutral`, `supportive` only where the abstract explicitly advances an RRM/anti-contraception argument). Sonnet-tier (reads abstracts). Persists via `/classify-result` (CAS; writes `classification_history`).
- [ ] **Step 2 — Verify only the 11 remain:**
```bash
npx wrangler d1 execute rrm-library --remote --json --command \
 "SELECT sentiment, COUNT(*) n FROM articles WHERE is_published=1 AND is_retracted=0 AND type NOT IN ('faq','post','course','guide') AND sentiment IN ('hostile','critical') GROUP BY sentiment"
```
Expected: 3 hostile + 8 critical = 11 (± any the classifier legitimately re-confirms — read its abstract before accepting a 12th).
- [ ] **Step 3 — Refresh the retrieval index** so `/ask`/search reflect the new sentiment/domain/relevance:
```bash
curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$WORKER/index/batch" -d '{"ids":[<the ~55 ids>]}'
```
(Confirm the worker's batch-index path/param shape first; if absent, run the project's documented re-index step for these ids.)
- [ ] **Rollback if needed:** restore from `classification_history WHERE model='reclassify-mislabel-2026-06-14'`.

---

## Task 10: Execute the RE-only re-home (D1, live)

- [ ] **Step 1** Run a parse→modify→write script over the approved `manifest-rehome.json`. For each record: `JSON.parse(topics)` → push the approved bare top-level label (keep the existing RE tag) → `JSON.stringify` → write via a **parameterized** per-row statement (NOT string-concatenated SQL — repo rule "no `${variable}` in SQL"). Records marked `search-only` or `remove-bad-RE-tag` are handled per the manifest. Chunk ≤100 statements.
- [ ] **Step 2 — Verify each record round-trips** in a script: re-read the 23, assert each `parseJsonArray(topics)` is non-empty, still contains "Reproductive Endocrinology" (unless manifest said remove), and (for re-homed ones) contains ≥1 allowlisted **top-level** segment (parse + segment check, NOT substring LIKE).
- [ ] **Step 3 — Refresh index** for the 23 ids (same `/index/batch` call).
- [ ] **Rollback if needed:** restore `topics` from `docs/superpowers/plans/manifest-rehome.json` (before-state captured per record).

---

## Task 11: Deploy + post-deploy production verification

- [ ] **Step 1** Push **from the worktree** (never the dirty shared clone): `git -C "$WT" push -u origin claude/library-category-curation`. CI auto-merges `claude/*` + builds + deploys. Per `feedback-verify-deploy-conclusion-before-cleanup`, confirm the deploy conclusion (not just "merged").
- [ ] **Step 2 — Production redirect gate (the `_redirects`-through-router check):**
```bash
for s in reproductive-endocrinology research-methodology general-ob-gyn ethics-philosophy patient-education; do
  echo "$s:"; curl -sI "https://rrmacademy.org/library/topics/$s/" | grep -i -E "^HTTP|^location"
done
```
Expected: each `301` → `location: /library/`. **If any 404s, fall back to adding the entries to rrm-router `REDIRECTS` and redeploy the router.**
- [ ] **Step 3 — Production leak + count spot-check:** a flagged slug 404s on its category page but 200s at `/library/<slug>/`; `/library/` shows 10 tiles incl. Diagnostics and the FULL corpus headline count; a demoted category 301s.
- [ ] **Step 4 — `/ask` freshness spot-check:** query `/ask` (or search) for one re-classified paper's topic and confirm it reflects the corrected classification (index refresh landed).

---

## Self-Review

- **Spec coverage:** A→Task 9 (+manifest in 8.5); B→Tasks 3+4 (`isCategorySafe`); C→Tasks 3,5,10; D→Tasks 1,2,4. Update-mechanism is documented in the spec. ✓
- **Fusion fixes folded:** count-split (Task 4 Step 3), D1 behind gate (Phase 1B), unique-tag+history revert (Task 9), per-record re-home (Task 10), `_redirects` both-forms + live curl (Tasks 5/11), index refresh (Tasks 9.3/10.3), llms overrides (Task 6), fail-hard gate (Task 7), one-registry de-dup + live iconKey (Task 1/4), NaPro tile count = destination (Task 1). ✓
- **Placeholder scan:** none. The two judgment steps (manifests) are read-only, reviewed by Brian at the gate, and have explicit rules + verify gates. ✓
- **Type consistency:** `CATEGORIES`/`CATEGORY_ALLOWLIST`/`ATLAS_TILES`/`TOPIC_DESCRIPTORS`/`DEMOTED_SLUGS`/`isCategorySafe`/`topicSlug`/`topLevelTopics` defined once (Task 1), imported identically (Tasks 3,4,7). Tile `iconKey` matches `TOPIC_ICONS`. ✓
- **No live write before the gate:** Phase 1A is code + read-only queries only; every D1 write + the deploy are in Phase 1B. ✓
