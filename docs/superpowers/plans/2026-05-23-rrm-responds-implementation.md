# RRM Responds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `/responds/` content genre on rrmacademy.org that publishes scholarly, evidence-anchored replies to published RRM critiques, each bound to its target critique and engineered for AI/search co-retrieval.

**Architecture:** Mirror the existing per-content-type pipeline (the `posts`/commentary pattern): a new D1 table `responds` in `rrm-auth` is SSOT; a read-only Bearer-auth Pages Function serves it at build time; a fetch script writes `src/data/responds.json`; Astro static routes render index, detail, and pagination pages; a JSON-LD `ScholarlyArticle` builder with a `citation` edge to the critique plus Highwire `citation_*` meta provide the co-retrieval coupling; a chunked sitemap, single-record dispatch, CI floor, and agent-surface entries complete the pipeline.

**Tech Stack:** Astro 5.3 (static), Cloudflare Pages Functions, D1 (`rrm-auth`), `wrangler`, GitHub Actions deploy, `node:test`, Playwright (e2e).

---

## Resolved Decisions (from spec open items)

| Open item | Decision | Reason |
|-----------|----------|--------|
| Section name / slug | `/responds/` | Distinct genre signal. Cheap to swap before launch; if changed, find/replace the slug in all paths below. |
| Storage | New D1 table `responds` in `rrm-auth` | Matches the per-content-type convention (faqs/courses/glossary each have own table+pipeline). Critique metadata is first-class. Keeps `posts` floors/queries unpolluted, enforcing the spec's boundary at the data layer. |
| Schema | `ScholarlyArticle` + `citation` to the critique (NOT `ClaimReview`) | Google **deprecated ClaimReview rich results on 2025-06-12** (one of 7 retired structured-data types); the markup now yields no SERP feature for anyone. It was never IFCN-gated. `ScholarlyArticle` with a `citation` edge + Highwire meta is the durable, eligible choice and is the existing library pattern. Do NOT revisit ClaimReview (the feature is gone, not gated). Sources: Poynter / Google Search Central blog 2025/06. |
| Critique link `rel` | `rel="nofollow noopener"` on the "View the original" link (deliberate spec-override) | The spec's co-retrieval mechanism counts the outbound link as part of the binding (spec: "responding to a critique also links it"), but the spec ALSO says do not give the critique oxygen. These two spec sentences are in tension. We resolve toward mitigation: the JSON-LD `citation`/`about`/`sameAs` edge (Task 5) carries the machine-readable coupling regardless, so the HTML link can be `nofollow` without losing the structured-data binding. Documented here rather than left as a silent aside. |
| Phil confirmation | Out of build critical path | The `author` field supports any byline. Confirming Phil is a content/people step, handled out of band. |
| Nav placement | NOT forced into the 3-item primary nav | IA rule keeps primary nav at 3 items. Discoverable via footer link + internal cross-links + `/guides` index. Primary-nav placement is Brian's call post-launch. |

**Hard gate — content publication:** Tasks 1-13 build the pipeline and may ship. Task 14 (writing/publishing entry #1) is CONTENT and is governed by the mockup-before-live-publish hard rule. Stage entry #1, present for review, and publish live only on Brian's explicit go-live confirmation. "Ship the pipeline" does NOT authorize publishing the rebuttal content.

---

## File Structure

**Create:**
- `scripts/migrate-responds-to-d1.sql` — table + index DDL
- `functions/api/responds/posts.js` — read-only Bearer endpoint (built via coder agent)
- `src/lib/fetch-responds-data.mjs` — build-time fetch (full + single-record), exports pure `shapeRecord()`
- `src/lib/responds.ts` — `RespondsPost` TS interface + `fetchAllResponds()` / `getRelatedResponds()` helpers
- `src/pages/responds/index.astro` — corpus index
- `src/pages/responds/[...slug].astro` — detail page (schema + citation coupling)
- `src/pages/responds/page/[page].astro` — pagination
- `static-overrides/responds-llms.txt` — section llms.txt
- `test/responds-shape.test.js` — unit test for `shapeRecord()`
- `test/responds-schema.test.js` — unit test for `buildScholarlyResponse()` (imports the pure `.mjs`, NOT `identity.ts`)

**Modify:**
- `src/lib/schema-builders.mjs` — add the pure `buildScholarlyResponse(record)` builder here (no JSON imports, so `node --test` can import it). See Task 5 / finding H3.
- `src/lib/identity.ts` — re-export `buildScholarlyResponse` from `schema-builders.mjs` (matches how `buildBreadcrumbList` is split today)
- `src/integrations/library-sitemaps.mjs` — emit `sitemap-responds.xml`, exclude from main sitemap
- `astro.config.mjs` — sitemap filter excludes `/responds/` detail + pagination
- `package.json` — add `fetch-responds` script; chain into `fetch-all` and `fetch-all:dry`
- `.github/workflows/deploy.yml` — single-record dispatch step for `responds_id`; add `responds_id` to the "Fetch all data" skip-guard + the IndexNow step; add `responds.json` to the CI floor loop AND the baseline auto-update loop (finding H5/H6)
- `src/data/.baselines.json` — add `responds.json` floor
- `src/components/Footer.astro` — add `/responds/` link
- `.gitignore` — add explicit `src/data/responds.json` line (no `src/data/*.json` glob exists; finding M3)
- `guard-manifest.json` — manually add the `functions/api/responds/posts.js` entry, THEN `npm run guard:update` to populate its hash (`guard:update` does NOT discover new files; finding M7)
- `ssot/agent-surfaces.json` — register the `/responds/` surface (then re-emit)
- `scripts/ssot-prebuild.mjs` — add the `responds-llms.txt` pair to the hardcoded `STATIC_RESTORES` array (it does not enumerate; finding H7)

---

## Task 0: Branch + credentials (do this FIRST — finding H9, token placeholder)

This checkout may be on another session's branch (e.g. `claude/orank-discoverability`) with unrelated uncommitted work. Committing the responds tasks onto it would intermingle history and `git add -A` would sweep foreign files. Start clean.

- [ ] **Step 1: Create a dedicated branch off `origin/main`**

```bash
git fetch origin
git switch -c claude/rrm-responds-impl origin/main
```
If the working tree has uncommitted changes from another session, do NOT stash blindly — use a worktree instead: `git worktree add ../rrm-responds-wt -b claude/rrm-responds-impl origin/main` and run all tasks there. Confirm: `git rev-parse --abbrev-ref HEAD` returns `claude/rrm-responds-impl`.

- [ ] **Step 2: Export the build token ONCE (STOP if unresolved)**

The build steps need `LIBRARY_BUILD_TOKEN` (the same secret the blog pipeline uses; it is the CF Pages secret `LIBRARY_BUILD_TOKEN`). Resolve its value (1Password or the CF Pages env) and export it for this shell:

```bash
export LIBRARY_BUILD_TOKEN='<resolve-the-real-value-first>'
[ -n "$LIBRARY_BUILD_TOKEN" ] || { echo "STOP: LIBRARY_BUILD_TOKEN unset"; }
```
Do NOT proceed to any `fetch-*` step until `echo ${#LIBRARY_BUILD_TOKEN}` prints a non-zero length. All later tasks reference `$LIBRARY_BUILD_TOKEN` (never an inline `op://…<placeholder>…` literal).

---

## Task 1: Create the `responds` D1 table

**Files:**
- Create: `scripts/migrate-responds-to-d1.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- scripts/migrate-responds-to-d1.sql
-- RRM Responds: scholarly replies to published RRM critiques. D1 rrm-auth.
CREATE TABLE IF NOT EXISTS responds (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,            -- response body (HTML/markdown, same convention as posts.content)
  excerpt       TEXT,
  author        TEXT,                     -- byline (e.g. "Dr. Phil Boyle, MD" / "Dr. Naomi Whittaker, MD…")
  content_pillar TEXT,                    -- topical pillar tag (e.g. "evidence", "safety")
  cover_image_url TEXT,
  publish_date  TEXT,                     -- ISO 8601
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
  word_count    INTEGER NOT NULL DEFAULT 0,   -- match posts (NOT NULL DEFAULT 0); never NULL so noindex logic is deterministic
  seo_keywords  TEXT,
  -- critique-coupling fields (the genre's first-class metadata):
  critique_title    TEXT NOT NULL,        -- title of the critique being answered
  critique_authors  TEXT,                 -- semicolon-separated author list
  critique_journal  TEXT,
  critique_year     INTEGER,
  critique_doi      TEXT,                 -- bare DOI, e.g. 10.1016/j.xxxx
  critique_url      TEXT,                 -- canonical URL of the critique
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_responds_slug ON responds(slug);
CREATE INDEX IF NOT EXISTS idx_responds_status ON responds(status);
CREATE INDEX IF NOT EXISTS idx_responds_publish_date ON responds(publish_date);
CREATE INDEX IF NOT EXISTS idx_responds_word_count ON responds(word_count);
```

- [ ] **Step 2: Apply to remote D1**

Run: `wrangler d1 execute rrm-auth --remote --file scripts/migrate-responds-to-d1.sql`
Expected: `Executed N commands` with no error.

- [ ] **Step 3: Verify the table exists**

Run: `wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='responds'"`
Expected: one row, `responds`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-responds-to-d1.sql
git commit -m "feat(responds): add responds D1 table migration"
```

---

## Task 2: Build-time read endpoint (via coder agent)

**Files:**
- Create: `functions/api/responds/posts.js`

This is `functions/api/` code. Per project rule, dispatch the **coder agent** to write it — do not hand-write it. The agent reads siblings (`functions/api/blog/posts.js`, `functions/api/faqs.js`) and applies the proof + review gates.

- [ ] **Step 1: Dispatch the coder agent**

Prompt the coder agent:

> Create `functions/api/responds/posts.js`, a read-only build-time endpoint that mirrors `functions/api/blog/posts.js` exactly in structure (auth, error shapes, OPTIONS handler, logging). Differences: query `FROM responds` instead of `posts`; `mapRow` must return camelCase including the critique fields: `critiqueTitle, critiqueAuthors, critiqueJournal, critiqueYear, critiqueDoi, critiqueUrl` (mapped from the snake_case columns) plus the same base fields as the blog mapper (`id, slug, title, content, excerpt, author, contentPillar, coverImageUrl, publishDate, wordCount, seoKeywords, lastModified`). Single-record mode via `?id=`. Full mode: `WHERE status = 'published' ORDER BY publish_date DESC`. Auth: Bearer `LIBRARY_BUILD_TOKEN`. Use `env.DB` (rrm-auth binding). Follow the coding-standards checklist in CLAUDE.md.

- [ ] **Step 2: Verify the file matches the sibling contract**

Run: `node -e "const s=require('fs').readFileSync('functions/api/responds/posts.js','utf8'); ['LIBRARY_BUILD_TOKEN','constantTimeEqual','onRequestOptions','FROM responds','critiqueDoi'].forEach(t=>{if(!s.includes(t))throw new Error('missing '+t)}); console.log('contract OK')"`
Expected: `contract OK`

- [ ] **Step 3: Register the endpoint in the security guard manifest**

`npm run guard:update` only RE-HASHES files already in `guard-manifest.json` — it does NOT discover new files (verified: `scripts/guard.mjs` UPDATE_MODE iterates `Object.entries(manifest.files)`). The sibling `functions/api/faqs.js` is guarded, so guard this Bearer-token prod-D1 endpoint too. Manually add the entry first, then populate its hash:

```bash
# add the key with an empty hash, then let guard:update fill it
node -e "const f='guard-manifest.json';const m=require('./'+f);m.files['functions/api/responds/posts.js']={hash:''};require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
npm run guard:update    # computes + writes the real sha256 for the new entry
npm run guard           # verify clean (exit 0), endpoint now hash-guarded
```
Expected: `guard` passes and `functions/api/responds/posts.js` appears in the manifest with a non-empty hash.

- [ ] **Step 4: Commit**

```bash
git add functions/api/responds/posts.js guard-manifest.json
git commit -m "feat(responds): add build-time read endpoint"
```

---

## Task 3: Fetch script with a pure, testable shaper

**Files:**
- Create: `src/lib/fetch-responds-data.mjs`
- Test: `test/responds-shape.test.js`

- [ ] **Step 1: Write the failing test for `shapeRecord()`**

```js
// test/responds-shape.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeRecord } from '../src/lib/fetch-responds-data.mjs';

test('shapeRecord normalizes a published response row', () => {
  const out = shapeRecord({
    id: 'resp-001', slug: 'no-rct-critique', title: 'On the "no RCT" claim',
    content: '<p>…</p>', excerpt: 'x', author: 'Dr. Phil Boyle, MD',
    contentPillar: 'evidence', coverImageUrl: '', publishDate: '2026-05-23',
    wordCount: 800, seoKeywords: 'rrm,ivf,rct',
    critiqueTitle: 'RRM efficacy unmeasurable', critiqueAuthors: 'Smith J; Doe A',
    critiqueJournal: 'Fertil Steril', critiqueYear: 2026,
    critiqueDoi: '10.1016/j.example.2026.01', critiqueUrl: 'https://doi.org/10.1016/j.example.2026.01',
    lastModified: '2026-05-23T00:00:00Z',
  });
  assert.equal(out.id, 'resp-001');           // id MUST survive (single-record dispatch dedupes on it)
  assert.equal(out.slug, 'no-rct-critique');
  assert.equal(out.critique.doi, '10.1016/j.example.2026.01');
  assert.equal(out.critique.year, 2026);
  assert.deepEqual(out.critique.authors, ['Smith J', 'Doe A']);
});

test('shapeRecord throws on missing critique title', () => {
  assert.throws(() => shapeRecord({ slug: 's', title: 't', content: 'c', critiqueTitle: '' }), /critique title/i);
});

test('shapeRecord throws when critique has neither DOI nor URL', () => {
  // a critique must be locatable for co-retrieval to mean anything
  assert.throws(
    () => shapeRecord({ id: 'x', slug: 's', title: 't', content: 'c', critiqueTitle: 'A critique' }),
    /doi or url/i
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/responds-shape.test.js`
Expected: FAIL — `Cannot find module '../src/lib/fetch-responds-data.mjs'`.

- [ ] **Step 3: Write `fetch-responds-data.mjs`**

Base it on `src/lib/fetch-blog-data.mjs` (read that file first). Keep its full/single-record logic, `--dry-run` support, the `existsSync(OUTPUT_PATH)` fallback, and the `LIBRARY_BUILD_TOKEN` env auth. Point it at `/api/responds/posts`, output to `src/data/responds.json`. Export the pure shaper:

```js
// near the top of src/lib/fetch-responds-data.mjs (after imports)
export function shapeRecord(r) {
  if (!r || !r.critiqueTitle) throw new Error('responds record missing critique title');
  // a critique must be locatable; otherwise the citation edge + co-retrieval is meaningless
  if (!r.critiqueDoi && !r.critiqueUrl) {
    throw new Error(`responds record ${r.slug || r.id || '?'} critique has neither DOI nor URL`);
  }
  return {
    id: r.id,                       // REQUIRED: single-record dispatch dedupes on id (finding H4)
    slug: r.slug, title: r.title, content: r.content, excerpt: r.excerpt || '',
    author: r.author || 'RRM Academy', contentPillar: r.contentPillar || null,
    coverImageUrl: r.coverImageUrl || '', publishDate: r.publishDate,
    wordCount: typeof r.wordCount === 'number' ? r.wordCount : 0,
    seoKeywords: r.seoKeywords || '', lastModified: r.lastModified || r.publishDate,
    critique: {
      title: r.critiqueTitle,
      authors: (r.critiqueAuthors || '').split(';').map(s => s.trim()).filter(Boolean),
      journal: r.critiqueJournal || null,
      year: typeof r.critiqueYear === 'number' ? r.critiqueYear : (r.critiqueYear ? Number(r.critiqueYear) : null),
      doi: r.critiqueDoi || null,
      url: r.critiqueUrl || null,
    },
  };
}
```

Map both the full-list (`results`) and single-record (`data`) responses through `shapeRecord`. Write the array to `src/data/responds.json` with `JSON.stringify(records, null, 2)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/responds-shape.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add npm scripts**

In `package.json` add to `scripts`:
```json
"fetch-responds": "node src/lib/fetch-responds-data.mjs",
```
Append ` && node src/lib/fetch-responds-data.mjs` to both the `fetch-all` and `fetch-all:dry` (with `--dry-run`) script values.

- [ ] **Step 6: Smoke the fetch (dry-run, no token needed)**

The blog dry-run reads a prior snapshot/`src/data/posts.json`; the responds equivalent has none yet (the seed file is created in Task 4). Either seed it first OR make the responds dry-run tolerate a missing source (write `[]`). Seed first:

```bash
[ -f src/data/responds.json ] || echo "[]" > src/data/responds.json
node src/lib/fetch-responds-data.mjs --dry-run
```
Expected: logs intended fetch, writes nothing (dry-run), exits 0. (When you write `fetch-responds-data.mjs`, guard the dry-run read with `existsSync` so a missing source yields `[]` rather than throwing.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/fetch-responds-data.mjs test/responds-shape.test.js package.json
git commit -m "feat(responds): add fetch script with testable shaper + npm wiring"
```

---

## Task 4: TypeScript helpers

**Files:**
- Create: `src/lib/responds.ts`

- [ ] **Step 1: Write the helpers**

Mirror `src/lib/blog.ts`. Read it first for the `import data from '../data/posts.json'` pattern and the related-posts logic.

```ts
// src/lib/responds.ts
import data from '../data/responds.json';

export interface Critique {
  title: string;
  authors: string[];
  journal: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
}
export interface RespondsPost {
  id: string;
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  author: string;
  contentPillar: string | null;
  coverImageUrl: string;
  publishDate: string;
  wordCount: number | null;
  seoKeywords: string;
  lastModified: string;
  critique: Critique;
}

export function fetchAllResponds(): RespondsPost[] {
  return (data as RespondsPost[]).slice().sort(
    (a, b) => (b.publishDate || '').localeCompare(a.publishDate || '')
  );
}

export function getRelatedResponds(slug: string, pillar: string | null, limit = 3): RespondsPost[] {
  return fetchAllResponds()
    .filter(p => p.slug !== slug)
    .sort((a, b) => Number(b.contentPillar === pillar) - Number(a.contentPillar === pillar))
    .slice(0, limit);
}
```

- [ ] **Step 2: Gitignore the data file, then seed it so the import resolves**

`.gitignore` lists each data file by literal name; there is NO `src/data/*.json` glob (finding M3). Add the explicit line, then seed:

```bash
grep -qxF 'src/data/responds.json' .gitignore || echo 'src/data/responds.json' >> .gitignore
echo "[]" > src/data/responds.json
```
This guarantees the `[]` seed (and later fetched copy) is never committed as a stale build artifact (the exact rollback hazard the blog-pipeline note in CLAUDE.md warns about).

- [ ] **Step 3: Type-check**

Run: `npm run check-types`
Expected: no NEW errors above the type-check baseline. If it raises the count, fix the types (do not bump the baseline to mask real errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/responds.ts .gitignore
git commit -m "feat(responds): add RespondsPost helpers + gitignore data file"
```

---

## Task 5: JSON-LD builder `buildScholarlyResponse()`

**Files:**
- Modify: `src/lib/schema-builders.mjs` (add the pure builder here)
- Modify: `src/lib/identity.ts` (re-export it)
- Test: `test/responds-schema.test.js` (imports the `.mjs`)

> **Why the `.mjs`, not `identity.ts` (finding H3):** `identity.ts` transitively `import`s several `.json` files without `with { type: 'json' }`. Plain `node --test` cannot resolve those (`ERR_IMPORT_ATTRIBUTE_MISSING`) — Astro/Vite handles it at build, Node does not. So a test importing `identity.ts` crashes at import time. The repo already splits pure schema builders into `src/lib/schema-builders.mjs` (no JSON imports; this is where `buildBreadcrumbList` is implemented) and re-exports them from `identity.ts`. Put `buildScholarlyResponse` there and test the `.mjs` directly.

- [ ] **Step 1: Write the failing test (imports the pure `.mjs`)**

```js
// test/responds-schema.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScholarlyResponse } from '../src/lib/schema-builders.mjs';

const rec = {
  slug: 'no-rct-critique', title: 'On the "no RCT" claim',
  excerpt: 'A reply.', author: 'Dr. Phil Boyle, MD', publishDate: '2026-05-23',
  lastModified: '2026-05-23T00:00:00Z',
  critique: { title: 'RRM efficacy unmeasurable', authors: ['Smith J'], journal: 'Fertil Steril',
    year: 2026, doi: '10.1016/j.example.2026.01', url: 'https://doi.org/10.1016/j.example.2026.01' },
};

test('buildScholarlyResponse emits ScholarlyArticle citing a journal critique', () => {
  const ld = buildScholarlyResponse(rec);
  assert.equal(ld['@type'], 'ScholarlyArticle');
  assert.equal(ld.url, 'https://rrmacademy.org/responds/no-rct-critique/');
  assert.ok(ld.citation, 'has citation edge');
  assert.equal(ld.citation['@type'], 'ScholarlyArticle');   // journal => ScholarlyArticle
  assert.equal(ld.citation.sameAs, 'https://doi.org/10.1016/j.example.2026.01');
  assert.equal(ld.citation.name, 'RRM efficacy unmeasurable');
});

test('non-journal critique (no DOI, no journal) cites a CreativeWork, not a ScholarlyArticle', () => {
  const ld = buildScholarlyResponse({
    ...rec,
    critique: { title: 'A news op-ed against RRM', url: 'https://news.example/op-ed' },
  });
  assert.equal(ld.citation['@type'], 'CreativeWork');       // honest typing for non-scholarly sources
  assert.equal(ld.citation.sameAs, 'https://news.example/op-ed');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/responds-schema.test.js`
Expected: FAIL — `buildScholarlyResponse is not exported` (clean import error, NOT a JSON-attribute crash).

- [ ] **Step 3: Add the builder to `schema-builders.mjs`, re-export from `identity.ts`**

Read `src/lib/schema-builders.mjs` first (note `buildBreadcrumbList`'s style and the org `@id` convention `https://rrmacademy.org/#organization`). Add (plain JS, no JSON imports). The critique is typed `ScholarlyArticle` only when it has a DOI or a journal; otherwise `CreativeWork` (honest typing — a news article is not scholarly; finding M5):

```js
// src/lib/schema-builders.mjs — add and export
export function buildScholarlyResponse(rec) {
  const url = `https://rrmacademy.org/responds/${rec.slug}/`;
  const isScholarly = !!(rec.critique.doi || rec.critique.journal);
  const critiqueRef = {
    '@type': isScholarly ? 'ScholarlyArticle' : 'CreativeWork',
    name: rec.critique.title,
  };
  if (rec.critique.authors?.length) {
    critiqueRef.author = rec.critique.authors.map((n) => ({ '@type': 'Person', name: n }));
  }
  if (rec.critique.journal) critiqueRef.isPartOf = { '@type': 'Periodical', name: rec.critique.journal };
  if (rec.critique.year) critiqueRef.datePublished = String(rec.critique.year);
  if (rec.critique.doi) critiqueRef.identifier = { '@type': 'PropertyValue', propertyID: 'DOI', value: rec.critique.doi };
  if (rec.critique.url) critiqueRef.sameAs = rec.critique.url;

  return {
    '@type': 'ScholarlyArticle',
    '@id': `${url}#response`,
    url,
    headline: rec.title,
    name: rec.title,
    description: rec.excerpt || '',
    datePublished: rec.publishDate,
    dateModified: rec.lastModified || rec.publishDate,
    author: rec.author
      ? { '@type': 'Person', name: rec.author }
      : { '@id': 'https://rrmacademy.org/#organization' },
    publisher: { '@id': 'https://rrmacademy.org/#organization' },
    isPartOf: { '@type': 'WebSite', '@id': 'https://rrmacademy.org/#website' },
    about: critiqueRef,        // what the article is about (the critique)
    citation: critiqueRef,     // explicit citation edge for retrieval/co-citation
    inLanguage: 'en',
  };
}
```

Then re-export from `identity.ts` (match how `buildBreadcrumbList` is surfaced), with the type:

```ts
// src/lib/identity.ts
export { buildScholarlyResponse } from './schema-builders.mjs';
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/responds-schema.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schema-builders.mjs src/lib/identity.ts test/responds-schema.test.js
git commit -m "feat(responds): add buildScholarlyResponse JSON-LD builder"
```

---

## Task 6: Detail page `/responds/[...slug]`

**Files:**
- Create: `src/pages/responds/[...slug].astro`

- [ ] **Step 1: Write the page**

Read `src/pages/commentary/[...slug].astro` first and mirror its structure (getStaticPaths, BaseLayout usage, app-shell wiring via `MaybeShell`, related-content rail). Use the SAME sanitizing renderer commentary uses (`parseMarkdown` from `src/lib/markdown-sanitize.mjs`) — NOT raw `marked` (finding M1: raw `marked` + `set:html` is an unsanitized-HTML path, and the genre reproduces external critique text verbatim). Replace the data source with `fetchAllResponds()`/`getRelatedResponds()` from `src/lib/responds.ts`, and replace the BlogPosting @graph with the response schema. The JSON-LD @graph must be:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { fetchAllResponds, getRelatedResponds } from '../../lib/responds.ts';
import { buildScholarlyResponse, buildBreadcrumbList } from '../../lib/identity.ts';
import { parseMarkdown } from '../../lib/markdown-sanitize.mjs';   // sanitizing renderer (finding M1)

export function getStaticPaths() {
  return fetchAllResponds().map(post => ({ params: { slug: post.slug }, props: { post } }));
}
const { post } = Astro.props;
const related = getRelatedResponds(post.slug, post.contentPillar);

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    buildScholarlyResponse(post),
    // buildBreadcrumbList expects { name, url } (NOT { name, item }) — finding H1
    buildBreadcrumbList([
      { name: 'Home', url: 'https://rrmacademy.org/' },
      { name: 'RRM Responds', url: 'https://rrmacademy.org/responds/' },
      { name: post.title, url: `https://rrmacademy.org/responds/${post.slug}/` },
    ]),
  ],
};

// Highwire meta for the RESPONSE. BaseLayout reads `date` and `journal` (NOT
// `publicationDate`/`journalTitle`) — finding H2. `date` wants YYYY/MM/DD or YYYY.
const citationMeta = {
  title: post.title,
  authors: [post.author],
  date: (post.publishDate || '').replaceAll('-', '/'),   // ISO YYYY-MM-DD -> YYYY/MM/DD
  journal: 'RRM Responds',
};

// word_count is NOT NULL DEFAULT 0 (Task 1), so the numeric branch always applies
const noindex = post.wordCount < 30;
const body = await parseMarkdown(post.content || '');
---
<BaseLayout
  title={post.title}
  description={post.excerpt}
  jsonLd={jsonLd}
  citationMeta={citationMeta}
  publishDate={post.publishDate}
  lastModified={post.lastModified}
  noindex={noindex}
>
  <!-- mirror commentary article markup; add a "Responding to" citation block: -->
  <article class="article-layout">
    <header>
      <p class="eyebrow">RRM Responds</p>
      <h1>{post.title}</h1>
      <p class="byline">By {post.author}</p>
      <aside class="responds-target">
        <p>Responding to: <strong>{post.critique.title}</strong>{post.critique.journal ? `, ${post.critique.journal}` : ''}{post.critique.year ? ` (${post.critique.year})` : ''}.
        {post.critique.url && <a href={post.critique.url} rel="nofollow noopener" target="_blank">View the original</a>}</p>
      </aside>
    </header>
    <div class="article-body" set:html={body} />
  </article>
</BaseLayout>
```

> Use existing design-system tokens for `.responds-target` styling; do not hardcode colors/spacing. Read `docs/design/design-system.json` for token names. The `rel="nofollow noopener"` on the critique link is a deliberate, documented decision (see the Decisions table, "Critique link `rel`"): the structured-data `citation`/`sameAs` edge carries the machine-readable coupling, so the HTML link can be nofollow without losing the binding.

- [ ] **Step 2: Seed a LOCAL fixture (never write a fixture to prod D1) — finding H8**

Do NOT INSERT a fixture into `--remote` rrm-auth (a build failure mid-flip could strand a live-eligible row, and a flip-to-`published` can leak a fixture live on any unrelated deploy). The page only needs a local `src/data/responds.json` to exercise `getStaticPaths`:

```bash
cat > src/data/responds.json <<'JSON'
[{"id":"resp-fixture","slug":"fixture-build-check","title":"Fixture","content":"<p>Build fixture body with enough words to exceed the thin-page threshold for local verification only.</p>","excerpt":"Fixture","author":"RRM Academy","contentPillar":"evidence","coverImageUrl":"","publishDate":"2026-05-23","wordCount":40,"seoKeywords":"","lastModified":"2026-05-23","critique":{"title":"Fixture critique","authors":[],"journal":"Test J","year":2026,"doi":null,"url":"https://example.org"}}]
JSON
```

- [ ] **Step 3: Build and verify the page renders with schema (NO fetch — it would wipe the local fixture)**

Run: `npm run build:astro`   (do NOT run `fetch-responds` here; it overwrites `responds.json` from the empty prod table)
Then: `grep -l 'ScholarlyArticle' dist/responds/fixture-build-check/index.html`
Expected: the fixture page emits the ScholarlyArticle JSON-LD with a valid BreadcrumbList (item URLs present). Then reset the seed: `echo "[]" > src/data/responds.json` (gitignored; regenerated by the real fetch). No prod row was ever created, so there is nothing to clean up in D1.

- [ ] **Step 4: Commit**

```bash
git add src/pages/responds/[...slug].astro
git commit -m "feat(responds): add detail page with response schema + critique coupling"
```

---

## Task 7: Index + pagination pages

**Files:**
- Create: `src/pages/responds/index.astro`
- Create: `src/pages/responds/page/[page].astro`

- [ ] **Step 1: Write the index page**

Mirror `src/pages/commentary/index.astro` (read it first). Use `fetchAllResponds()`, render 6 per page with pagination to `/responds/page/[page]/`, and emit a `CollectionPage` + `BreadcrumbList` @graph. Each card shows the response title, the critique it answers, and the excerpt.

- [ ] **Step 2: Write the pagination page**

Mirror `src/pages/commentary/page/[page].astro`. `getStaticPaths` paginates `fetchAllResponds()` at 6 per page; page 1 redirects to `/responds/`.

- [ ] **Step 3: Build and verify**

Run: `npm run build:astro`
Then: `test -f dist/responds/index.html && echo INDEX_OK`
Expected: `INDEX_OK`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/responds/index.astro src/pages/responds/page/[page].astro
git commit -m "feat(responds): add corpus index + pagination"
```

---

## Task 8: Sitemap chunk + main-sitemap exclusion

**Files:**
- Modify: `src/integrations/library-sitemaps.mjs`
- Modify: `astro.config.mjs`

- [ ] **Step 1: Add the responds sitemap chunk**

In `src/integrations/library-sitemaps.mjs` (read it first), add a `sitemap-responds.xml` emitter following the existing `sitemap-commentary.xml` block: enumerate `fetchAllResponds()` slugs to `https://rrmacademy.org/responds/<slug>/`, lastmod from `src/data/page-dates.json` (fall back to `publishDate`). Add `/responds/` URLs to the set excluded from the main `sitemap-0.xml`.

- [ ] **Step 2: Add the index URL to the sitemap and filter detail/pagination in astro.config**

In `astro.config.mjs` sitemap `filter`, exclude `/responds/[slug]` detail and `/responds/page/` pagination URLs (they live in the chunk), keeping `/responds/` index in the main sitemap. Mirror the existing commentary filter rule.

- [ ] **Step 3: Build and verify the chunk emits**

Run: `npm run build:astro`
Then: `test -f dist/sitemap-responds.xml && echo SITEMAP_OK`
Expected: `SITEMAP_OK` (will list 0 URLs until a response is published; that is fine).

- [ ] **Step 4: Commit**

```bash
git add src/integrations/library-sitemaps.mjs astro.config.mjs
git commit -m "feat(responds): add sitemap-responds chunk + main-sitemap exclusion"
```

---

## Task 9: Single-record dispatch + CI floor

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `src/data/.baselines.json`

> **`deploy.yml` is a Tier 2 /arise hotspot** (14 findings across 7 runs). Make every edit below precisely; re-read the surrounding step before each change. The env var for single-record mode is confirmed `RECORD_ID` (verified `fetch-blog-data.mjs:139`).

- [ ] **Step 1: Add the single-record fetch step**

Read the existing "Fetch single blog record (dispatch)" step and add a parallel step:

```yaml
      - name: Fetch single responds record (dispatch)
        if: github.event_name == 'repository_dispatch' && github.event.client_payload.responds_id
        run: npm run fetch-responds
        env:
          LIBRARY_BUILD_TOKEN: ${{ secrets.LIBRARY_BUILD_TOKEN }}
          RECORD_ID: ${{ github.event.client_payload.responds_id }}
```

- [ ] **Step 2: Stop a `responds_id` dispatch from also running a full `fetch-all` (finding H6)**

The "Fetch all data" step's `if:` excludes the other single-record ids but not `responds_id`, so a responds dispatch would run BOTH the single step AND a full fetch. Add the exclusion. Read the current condition (it lists `!record_id && !article_id && !faq_id && !glossary_term_id && !course_id`) and append:

```yaml
        # ... && !github.event.client_payload.responds_id
```

- [ ] **Step 3: Wire `responds_id` into the IndexNow single-URL step (finding H6)**

The "Compute IndexNow single URL" step maps each `*_id` to a slug via `findSlug(..., key='id')`. Add a `responds_id` branch that resolves the slug from `src/data/responds.json` and emits `https://rrmacademy.org/responds/<slug>/`, mirroring the blog branch. (This is why `id` must survive `shapeRecord` — finding H4.)

- [ ] **Step 4: Make the CI floor actually cover responds (finding H5)**

The floor is enforced by a bash loop over a HARDCODED file list, and `.baselines.json` is rewritten post-deploy by a SECOND hardcoded list. Adding a JSON key alone is inert. Do all three:
  1. Add `src/data/responds.json` to the floor-check loop's file list (the `for f in src/data/articles.json src/data/posts.json …` step) with `ABSOLUTE_FLOOR=0` initially.
  2. Add `responds.json` to the post-deploy "Update data baselines" writer array (`['articles.json','posts.json','faqs.json','courses.json','partners.json', …]`) so the baseline key persists instead of being dropped on the next green deploy.
  3. Add `"responds.json": 0` to `src/data/.baselines.json`.

- [ ] **Step 5: Verify the workflow YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml src/data/.baselines.json
git commit -m "feat(responds): wire single-record dispatch + working CI floor"
```

---

## Task 10: Agent surfaces (llms.txt) + footer discoverability

**Files:**
- Create: `static-overrides/responds-llms.txt`
- Modify: `ssot/agent-surfaces.json`
- Modify: `src/components/Footer.astro`

- [ ] **Step 1: Write the section llms.txt**

Create `static-overrides/responds-llms.txt` describing the genre ("RRM Responds: scholarly, evidence-based replies to published critiques of restorative reproductive medicine, each bound to the critique it answers"). Mirror the structure of `static-overrides/library-llms.txt`.

Then — REQUIRED, not conditional (finding H7) — add the copy pair to the hardcoded `STATIC_RESTORES` array in `scripts/ssot-prebuild.mjs`. The array does NOT enumerate `static-overrides/*`; without this edit the file is never copied and `/responds/llms.txt` 404s (and Task 12 Step 2's 200-assert fails). A missing/typo'd path here hard-fails the build (`process.exit(1)`), so copy the exact paths:

```js
// scripts/ssot-prebuild.mjs — add to STATIC_RESTORES
['static-overrides/responds-llms.txt', 'public/responds/llms.txt'],
```

- [ ] **Step 2: Register the surface in agent-surfaces SSOT**

In `ssot/agent-surfaces.json`, add `/responds/` as a content surface alongside the existing library/commentary/faqs/courses entries.

- [ ] **Step 3: Add the footer link**

In `src/components/Footer.astro`, add a `/responds/` link in the content/section list (mirror the `/commentary/` link). Do NOT add it to the 3-item primary nav.

- [ ] **Step 4: Build and verify the emitted surfaces**

Run: `SITE_SSOT_ENABLED=1 npm run build:astro`
Then: `npm run ssot:validate && test -f dist/responds/llms.txt && echo LLMS_OK`
Expected: validation passes and `LLMS_OK` prints (confirms the STATIC_RESTORES copy landed).

- [ ] **Step 5: Commit**

```bash
git add static-overrides/responds-llms.txt ssot/agent-surfaces.json src/components/Footer.astro
git commit -m "feat(responds): register agent surface + footer link"
```

---

## Task 11: Full build + gates green

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all `test/*.test.js` pass, including the two new files.

- [ ] **Step 2: Run the guard + type check**

Run: `npm run guard && npm run check-types`
Expected: both pass; type errors not above baseline.

- [ ] **Step 3: Full data fetch + build**

Run: `npm run fetch-all && npm run build`  (uses `$LIBRARY_BUILD_TOKEN` exported in Task 0)
Expected: build completes; baselines not tripped (all content types at/above floor). `responds.json` will be `[]` (empty prod table) — floor is 0, so this passes.

- [ ] **Step 4: Confirm no fixture leaked to prod**

No fixture was ever written to remote D1 (Task 6 uses a local seed), so there is nothing to delete. Sanity-check the prod table is empty:
Run: `wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) AS n FROM responds"`
Expected: `n = 0`.

- [ ] **Step 5: Commit generated/config changes (explicit paths, NOT `git add -A`)**

`git add -A` would sweep any unrelated working-tree files (finding H9). Stage only what this work touched:

```bash
git add package.json src/data/.baselines.json .gitignore
git commit -m "chore(responds): full build green"
```
(`src/data/responds.json` is gitignored and must NOT be committed.)

---

## Task 12: Ship the pipeline (no content yet)

- [ ] **Step 1: Pre-push: validate the sitemap chunk locally (finding L2)**

This branch auto-merges and deploys with no preview gate, and `sitemap-responds.xml` is a search-engine-visible artifact. Validate it from the local `dist/` (already built in Task 8) before pushing:

```bash
python3 -c "import xml.dom.minidom as m; m.parse('dist/sitemap-responds.xml'); print('sitemap well-formed')"
# /responds/ detail URLs must appear in the chunk, NOT in the main sitemap:
grep -c '/responds/' dist/sitemap-responds.xml
grep -c '/responds/[a-z]' dist/sitemap-0.xml   # expect 0 (index-only may appear; detail must not)
```
Expected: well-formed; detail URLs only in the chunk.

- [ ] **Step 2: Push the branch**

This auto-merges (`claude/*` auto-merge) and deploys. Confirm `git rev-parse --abbrev-ref HEAD` is `claude/rrm-responds-impl` (created in Task 0).

```bash
git push -u origin claude/rrm-responds-impl
```

- [ ] **Step 3: Verify deploy + live empty section**

After the merge + deploy workflow completes (watch `gh run list`), verify:
Run: `curl -s -o /dev/null -w "%{http_code}" https://rrmacademy.org/responds/`
Expected: `200` (empty corpus page renders).
Run: `curl -s -o /dev/null -w "%{http_code}" https://rrmacademy.org/responds/llms.txt`
Expected: `200`.

---

## Task 13: Author + stage entry #1 (CONTENT — mockup gate applies)

**Hard rule:** This task produces publishable content. Do NOT publish live without Brian's explicit go-live confirmation, even though the pipeline is shipped.

- [ ] **Step 1: Draft the response to the April 2026 critique**

Use the `rrm-commentary` skill (Gianna voice) grounded in `rrm-cli search "RRM efficacy IVF RCT" --intent=cite --full` for citations. Steelman the critique first, then refute on evidence (the "IVF is not RCT-backed either" argument is the core). Apply the rigor rules from the spec. Never insert citations from model knowledge (CLAUDE.md Citation Integrity rule).

- [ ] **Step 2: Enforce one-response-per-critique, then insert as `status='draft'`**

"One response per critique" (spec) is editorial, not structural — nothing in the schema blocks a duplicate. Check before inserting (finding L3):

```bash
wrangler d1 execute rrm-auth --remote --command "SELECT id,slug FROM responds WHERE critique_doi='<doi>' OR critique_url='<url>'"
```
Expected: 0 rows. If a row exists, edit that response instead of creating a second.

Then insert. MANDATORY (finding M4): compute `word_count` from the rendered body and include it (the column is `NOT NULL DEFAULT 0`, so omitting it silently yields 0 and forces `noindex`); include `critique_doi` OR `critique_url` (the shaper throws otherwise — finding M5); populate all available critique fields from the verified citation (no model-knowledge DOIs — CLAUDE.md Citation Integrity).

```bash
wrangler d1 execute rrm-auth --remote --command "INSERT INTO responds (id,slug,title,content,excerpt,author,content_pillar,publish_date,status,word_count,seo_keywords,critique_title,critique_authors,critique_journal,critique_year,critique_doi,critique_url) VALUES (...)"
```

- [ ] **Step 3: Stage a preview WITHOUT publishing, present for review**

Do not flip the row to `published` to preview (finding H8). The endpoint's single-record `?id=` mode returns ANY status, so fetch the draft directly and build locally:

```bash
RECORD_ID='<entry-1-id>' npm run fetch-responds   # ?id= mode returns the draft row
npm run build:astro
```
Screenshot the rendered page (desktop + mobile 393×852 per the visual-verification rule) and present to Brian. WAIT for explicit go-live approval. The row stays `draft` in prod throughout.

- [ ] **Step 4: On approval — publish + dispatch**

```bash
wrangler d1 execute rrm-auth --remote --command "UPDATE responds SET status='published' WHERE slug='<entry-1-slug>'"
gh api repos/rrmadmin/rrm-academy-cf/dispatches -f event_type=publish -F client_payload[responds_id]='<entry-1-id>'
```

- [ ] **Step 5: Verify live + raise the CI floor**

Run: `curl -s -o /dev/null -w "%{http_code}" https://rrmacademy.org/responds/<entry-1-slug>/`
Expected: `200`.
Then bump `responds.json` floor in `.baselines.json` from 0 to 1 and commit, so a future accidental wipe trips the guard.

---

## Task 14: AEO co-retrieval verification

- [ ] **Step 1: Run the retrieval probe**

Use the `consideration-set-audit` tooling (`projects/consideration-set-audit/audit.py`) or the rrma retrieval probe to ask frontier models about the April 2026 critique and check whether the RRM Academy response co-surfaces. Record the baseline result.

- [ ] **Step 2: Confirm structured-data validity**

Validate the live page's JSON-LD (Google Rich Results test or schema validator). Confirm the `citation`/`about` edge to the critique DOI is present and the Highwire `citation_*` meta render.

- [ ] **Step 3: Document the baseline**

Record the co-retrieval result as the entry's success baseline for later before/after comparison.

---

## Self-Review Notes

- **Spec coverage:** owner (RRM Academy) ✓ Task 6/10; per-critique unit + DOI binding ✓ Tasks 1,5,6; steelman-first rigor ✓ Task 13; co-retrieval engineering (schema + Highwire + llms.txt + internal links) ✓ Tasks 5,6,8,10; distinct from commentary/library ✓ separate table+route; measurement ✓ Task 14; parked items not built ✓. ClaimReview evaluated and rejected with fallback ✓ Decisions table.
- **Open dependencies the engineer must supply:** the real value of `LIBRARY_BUILD_TOKEN` (exported once in Task 0; the only manual prerequisite). The single-record env var is confirmed `RECORD_ID` (`fetch-blog-data.mjs:139`); the `node --test` TS-import problem is resolved by putting the builder in `schema-builders.mjs` (Task 5).
- **Convention adherence:** endpoint via coder agent ✓; security guard manifest entry added manually + re-hashed (guard:update does not discover new files) ✓; design tokens (no hardcoded CSS) ✓; citation integrity (no model-knowledge DOIs) ✓; mockup gate before publish ✓; branch created off origin/main first (Task 0) ✓; explicit `git add` paths, no `git add -A` ✓.
- **Hardened via `/arise --deep` (2026-05-23):** 4 Opus tracers, 19 findings folded in (9 HIGH, 7 MEDIUM, 3 LOW). Key fixes: `buildBreadcrumbList`/`citationMeta` signature corrections (H1/H2), test importing a pure `.mjs` to avoid the transitive-JSON-import crash (H3), `id` preserved through the shaper for single-record dispatch (H4), CI floor wired into BOTH the floor loop and the baseline-writer (H5), `responds_id` excluded from the full-fetch fallthrough + IndexNow (H6), unconditional `STATIC_RESTORES` edit so `/responds/llms.txt` exists (H7), local-only fixture instead of prod pollution (H8), Task 0 branch hygiene (H9), `parseMarkdown` sanitizer instead of raw `marked` (M1), corrected ClaimReview rationale to "deprecated 2025-06-12, not IFCN-gated" (M2), explicit gitignore line (M3), `word_count NOT NULL DEFAULT 0` (M4), CreativeWork fallback + doi-or-url requirement for non-journal critiques (M5), documented `rel=nofollow` decision (M6), manual guard-manifest registration (M7).
```
