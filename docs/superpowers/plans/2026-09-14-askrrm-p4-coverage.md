# AskRRM P4 Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put glossary terms and guide pages into the retrieval corpus through the live refresh path, teach `rrm-ai-search` to resolve a guide chunk to a real title and URL, refresh the namespace, and measure the fallback rate against the Phase 1 baseline.

**Architecture:** Three repos touched, one of them only to read. `rrm-library-worker` owns corpus refresh through `POST /index/batch`, so guide handling is added there, in `src/indexer/build-doc.js`, with a publish predicate; glossary is already a known type there and this plan CONFIRMS rather than assumes that. `rrm-ai-search` gains a `guides/` bucket in `bucketFromKey`, `itemUrl` and `resolveItems`, so a retrieved guide chunk resolves instead of being dropped by the `itemExists` gate. `scripts/ai-search-corpus-upload.mjs` stays retired and is not resurrected.

**Tech Stack:** Cloudflare Workers, D1 (`rrm-library`, `rrm-auth`), AutoRAG/AI Search, Vectorize, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-askrrm-engine-design.md` (sections 2 corpus note, 8, 14 step 4; proof gates G6, G14)

## Global Constraints

Every task's requirements implicitly include this section.

- Workers AI only at runtime, no paid API keys.
- Caps free 3 a day and member 20 a day unchanged.
- Wrangler pin `npx wrangler@4.62.0` for Pages; the pinned local wrangler for `rrm-ai-search`.
- Never edit `compatibility_date` by hand.
- Commit messages built in a file and passed with `-F`, never a long `-m`, ending with the two attribution lines `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH`.
- Every new file gets a census rule in `scripts/quality/lib/census-rules.mjs`.
- American English, no em dashes in any copy or code comment.
- Write-endpoint conformance: `validateBody`, the `json` helper, report rows via the vendored `report` package with blob1 = worker name and blob4 in `ok|error|slow|start|warn`.
- The pre-commit arise-scan hook stays on.

## File Structure

| Repo | Path | Responsibility |
|---|---|---|
| rrm-library-worker | `src/indexer/build-doc.js` | MODIFY. `guide` type, `/guides/` prefix, its AutoRAG body builder. |
| rrm-library-worker | `src/indexer/build-vector-input.js` | MODIFY. Vector input for a guide. |
| rrm-library-worker | `tests/indexer-guide.test.js` | CREATE. |
| rrm-ai-search | `src/index.js` | MODIFY. `guides` bucket in `bucketFromKey`, `itemUrl`, `resolveItems`. |
| rrm-ai-search | `test/url-routing.test.mjs` | MODIFY. Guide cases. |
| rrm-academy-cf | `scripts/ask-eval/fallback-rate.mjs` | CREATE. G6 measurement over `ask_answer`. |

---

### Task 1: Reconcile dry run

**HUMAN CHECKPOINT. This task writes no code and must happen before Task 2.** The spec is explicit that glossary may already be partially present through `bucketFromKey`'s existing glossary route, and that the dry run is what settles it.

**Files:** none.

**Interfaces:**
- Produces: a written answer to two questions, recorded in the commit message of Task 2. (a) How many glossary keys are in `retrieval_docs` today. (b) How many guide keys are (expected: zero).

- [ ] **Step 1: Run the report-only reconcile**

```bash
TOKEN=$(op read 'op://Automation/RRM Library Worker Admin Token/credential')
curl -sS -X POST https://rrm-library-worker.administrator-cloudflare.workers.dev/index/reconcile \
  -H "Authorization: Bearer $TOKEN" | jq .
```
Expected: `{ ok: true, summary: { ghosts, residuals, quarantine, vec_null } }`. `runReconcile` mutates nothing beyond one `reconcile_runs` audit row: it is a report, and this call is safe to make at any time.

- [ ] **Step 2: Count what is actually indexed, by source type**

```bash
npx wrangler@4.62.0 d1 execute rrm-library --remote --command \
  "SELECT source_type, COUNT(*) AS n, SUM(CASE WHEN tombstoned_at IS NOT NULL THEN 1 ELSE 0 END) AS tombstoned FROM retrieval_docs GROUP BY source_type ORDER BY n DESC"
```
Expected: rows for `article`, `post`, `faq`, `pillar`, and possibly `glossary`. Write the numbers down.

- [ ] **Step 3: Decide, and record the decision**

- If `glossary` has a row count close to the 132 terms in `glossary_term`, glossary is already covered. Task 3's `guides` bucket work still stands; Task 2's glossary half becomes a no-op and the commit message says so.
- If `glossary` is absent or far short, the caller that drives `/index/batch` is not sending glossary records and Task 2 Step 5 is where that is fixed.
- `guide` will be absent either way: no such type exists in `build-doc.js` before Task 2.

Do not proceed to Task 2 without these three numbers.

---

### Task 2: Guides in rrm-library-worker /index/batch

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-library-worker/src/indexer/build-doc.js`, `src/indexer/build-vector-input.js`
- Test: `/Users/brian/iCode/projects/rrm-library-worker/tests/indexer-guide.test.js`

**Interfaces:**
- Consumes: the existing `buildKey(prefix, slug)` from `src/indexer/keys.js`.
- Produces:
  - `buildDoc('guide', record)` accepts `record = { slug, title, body, description?, keywords?, status? }` and returns `{ key: '/guides/<slug>.md', fullSlug, sourceType: 'guide', in_vectorize: 1, in_autorag: 1, autorag: { body, metadata } }`.
  - The publish predicate: a record whose `status` is present and not `'published'` THROWS `guide record not published`, so `/index/batch` reports it as a build failure rather than indexing a draft.
  - `buildVectorInput('guide', record)` returns `{ text, metadata }` in the same shape as the other types.

- [ ] **Step 1: Write the failing test**

Create `/Users/brian/iCode/projects/rrm-library-worker/tests/indexer-guide.test.js`:

```js
/**
 * Guides in the retrieval corpus.
 *
 * Pillar pages already index under the single-segment '/' prefix. Guides are
 * the pillar COMPANIONS plus the neofertility guide pages, and they have their
 * own /guides/ prefix so rrm-ai-search can tell one from the other and emit the
 * right URL and the right type badge.
 *
 * The publish predicate is the load-bearing half: a draft guide that reaches
 * the namespace is a page the model can quote and the reader cannot open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDoc } from '../src/indexer/build-doc.js';
import { buildVectorInput } from '../src/indexer/build-vector-input.js';

const GUIDE = { slug: 'endometriosis-surgery', title: 'Endometriosis Surgery', body: 'Excision removes lesions including deep infiltrating disease.', description: 'What the library documents about surgical options.', status: 'published' };

test('buildDoc mints a /guides/ key and a guide sourceType', async () => {
  const doc = await buildDoc('guide', GUIDE);
  assert.equal(doc.key, '/guides/endometriosis-surgery.md');
  assert.equal(doc.sourceType, 'guide');
  assert.equal(doc.in_vectorize, 1);
  assert.equal(doc.in_autorag, 1);
  assert.equal(doc.fullSlug, null);
});

test('the AutoRAG body carries the title, the description and the body', async () => {
  const doc = await buildDoc('guide', GUIDE);
  assert.match(doc.autorag.body, /^# Endometriosis Surgery/);
  assert.match(doc.autorag.body, /deep infiltrating disease/);
  assert.equal(doc.autorag.metadata.type, 'Guide');
});

test('a long slug is sha8-truncated and records its full slug, like every other type', async () => {
  const long = 'a'.repeat(140);
  const doc = await buildDoc('guide', { ...GUIDE, slug: long });
  assert.ok(doc.key.length <= 125, 'key must fit the AutoRAG cap');
  assert.equal(doc.fullSlug, long);
});

test('an unpublished guide is REFUSED, not indexed', async () => {
  for (const status of ['draft', 'archived', 'review']) {
    await assert.rejects(() => buildDoc('guide', { ...GUIDE, status }), /not published/, `status ${status} must be refused`);
  }
});

test('a guide with no status is accepted: the caller filtered already', async () => {
  const { status, ...noStatus } = GUIDE;
  const doc = await buildDoc('guide', noStatus);
  assert.equal(doc.key, '/guides/endometriosis-surgery.md');
});

test('a guide missing a slug, a title or a body is refused', async () => {
  await assert.rejects(() => buildDoc('guide', { ...GUIDE, slug: '' }), /missing slug/);
  await assert.rejects(() => buildDoc('guide', { ...GUIDE, title: '' }), /missing title/);
  await assert.rejects(() => buildDoc('guide', { ...GUIDE, body: '   ' }), /missing body/);
});

test('buildVectorInput produces text for a guide', () => {
  const vec = buildVectorInput('guide', GUIDE);
  assert.equal(typeof vec.text, 'string');
  assert.match(vec.text, /Endometriosis Surgery/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brian/iCode/projects/rrm-library-worker && node --test tests/indexer-guide.test.js`
Expected: FAIL with `unknown type: guide`.

- [ ] **Step 3: Add the type to build-doc.js**

In `/Users/brian/iCode/projects/rrm-library-worker/src/indexer/build-doc.js`:

```js
const KNOWN_TYPES = new Set(['article', 'post', 'faq', 'glossary', 'pillar', 'course', 'guide']);
const KEY_PREFIX = {
  article: '/library/', post: '/commentary/', faq: '/faqs/', glossary: '/glossary/', pillar: '/', course: '/courses/', guide: '/guides/',
};
const APPLIES = {
  article: { v: 1, a: 1 }, post: { v: 1, a: 1 }, faq: { v: 1, a: 1 },
  glossary: { v: 1, a: 1 }, pillar: { v: 1, a: 1 }, course: { v: 1, a: 0 }, guide: { v: 1, a: 1 },
};

const TITLE_FIELD = { article: 'title', post: 'title', faq: 'question', glossary: 'name', pillar: 'title', course: 'title', guide: 'title' };
```

Add the body builder beside `pillarAutorag`:

```js
/**
 * A guide: a pillar companion or one of the neofertility guide pages. Its own
 * /guides/ prefix rather than the pillar '/' prefix, so rrm-ai-search can tell
 * the two apart and emit the right URL and the right type badge.
 */
function guideAutorag(g) {
  const lines = [`# ${g.title}`, ''];
  if (g.description) { lines.push(g.description); lines.push(''); }
  if (typeof g.body === 'string' && g.body.trim()) lines.push(g.body);
  const metadata = { type: 'Guide', domain: 'Guide', rrm_relevance: '5', is_open_access: 'true' };
  if (Array.isArray(g.keywords) && g.keywords.length) metadata.keywords = g.keywords.join('; ');
  return { body: lines.join('\n'), metadata };
}
```

Add `guide: guideAutorag,` to `AUTORAG_BUILDER`.

In `buildDoc`, beside the existing pillar body check, add:

```js
  if (type === 'guide') {
    // PUBLISH PREDICATE. A draft guide in the namespace is a page the model can
    // quote and the reader cannot open. The caller is expected to filter, and
    // this refuses anyway: the caller has been wrong before.
    if (record.status !== undefined && record.status !== 'published') {
      throw new Error(`guide record not published: status=${record.status}`);
    }
    if (typeof record.body !== 'string' || record.body.trim().length === 0) throw new Error('guide record missing body');
  }
```

The existing generic checks already produce `guide record missing slug` and `guide record missing title`, because they interpolate `type` and `titleField`.

- [ ] **Step 4: Add the vector input**

In `/Users/brian/iCode/projects/rrm-library-worker/src/indexer/build-vector-input.js`, add a `guide` branch mirroring the `pillar` branch exactly: title, description and body concatenated, with the same metadata keys the pillar branch sets. Read the pillar branch first and match it field for field rather than inventing a shape.

- [ ] **Step 5: Confirm the caller sends glossary and start sending guides**

Task 1 Step 3 told you whether glossary is already flowing. Find the caller:

```bash
cd /Users/brian/iCode/projects/rrm-library-worker
grep -rn "index/batch" --include=*.js --include=*.mjs --include=*.yml . | grep -v node_modules
```

Whatever drives the batch (a cron lane in `src/index.js`, a GitHub Actions workflow, or a script) must now also send `{ type: 'guide', record }` items sourced from `rrm-academy-cf/ssot/guides.json` plus the guide bodies, filtered to `status === 'published'`, in batches of at most 50 (the `MAX_BATCH` cap). If Task 1 showed glossary absent, add `{ type: 'glossary', record }` items from `rrm-auth.glossary_term WHERE status = 'published'` in the same pass.

Keep the two additions in ONE change, as the spec says: they land together.

- [ ] **Step 6: Run tests, deploy (Brian's go required), and commit**

```bash
cd /Users/brian/iCode/projects/rrm-library-worker
npm test
```
Expected: PASS.

**HUMAN CHECKPOINT**, then deploy per that repo's own runbook, then:

```bash
cat > /tmp/askrrm-p4-t2.msg <<'MSG'
feat(index): guides in the retrieval corpus

A guide type with its own /guides/ prefix, so rrm-ai-search can tell a guide
from a pillar and emit the right URL and type badge. The publish predicate
refuses a draft outright: a draft in the namespace is a page the model can quote
and the reader cannot open.

Reconcile dry run before this change: <glossary count> glossary keys,
<guide count> guide keys, <article/post/faq/pillar counts> elsewhere.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add src/indexer/build-doc.js src/indexer/build-vector-input.js tests/indexer-guide.test.js
git commit -F /tmp/askrrm-p4-t2.msg
```

Fill the three counts in from Task 1 before committing. That is the record of what the corpus looked like before this change, and nothing else records it.

---

### Task 3: The guides bucket in rrm-ai-search

**Files:**
- Modify: `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`
- Test: `/Users/brian/iCode/projects/rrm-ai-search/test/url-routing.test.mjs`

**Interfaces:**
- Consumes: Task 2's `/guides/<slug>.md` key shape.
- Produces:
  - `bucketFromKey('/guides/x.md')` returns `{ bucket: 'guides', slug: 'x', sourceType: 'guide' }`.
  - `itemUrl('/guides/x.md', { sourceType: 'guide' })` returns `https://rrmacademy.org/x/`. **Guides live at the site root**, per the repo's flat-URL decision; `/guides/` is an index page, not a URL parent.
  - `resolveItems` resolves a guide title from `rrm-auth` so `itemExists` passes.

- [ ] **Step 1: Write the failing test**

Append to `/Users/brian/iCode/projects/rrm-ai-search/test/url-routing.test.mjs`:

```js
// --------------------------------------------------------------------------
// guides bucket (G14)
//
// Before this bucket existed, a retrieved guide chunk fell through
// bucketFromKey to null, resolveItems never set a title, itemExists said false,
// and chunksToCitations DROPPED it silently. The reader saw an answer with one
// fewer source and no sign that a source had gone missing.
// --------------------------------------------------------------------------

test('bucketFromKey: guides -> guide', () => {
  assert.deepEqual(
    bucketFromKey('/guides/endometriosis-surgery.md'),
    { bucket: 'guides', slug: 'endometriosis-surgery', sourceType: 'guide' },
  );
});

test('itemUrl: a guide resolves to its ROOT url, not /guides/<slug>/', () => {
  // Information architecture decision, 2026-03-12: guide pages live at the
  // site root for SEO authority and /guides/ is an index page, not a parent.
  assert.equal(
    itemUrl('/guides/endometriosis-surgery.md', { sourceType: 'guide', title: 'Endometriosis Surgery' }),
    'https://rrmacademy.org/endometriosis-surgery/',
  );
});

test('itemUrl: a sha8-truncated guide key uses its full slug', () => {
  const long = 'b'.repeat(140);
  assert.equal(
    itemUrl('/guides/bbbb-1a2b3c4d.md', { sourceType: 'guide', fullSlug: long }),
    `https://rrmacademy.org/${long}/`,
  );
});

test('G14: a resolved guide chunk becomes a citation with type guide', () => {
  const itemMap = new Map([['/guides/endometriosis-surgery.md', { sourceType: 'guide', title: 'Endometriosis Surgery' }]]);
  const cites = chunksToCitations([{ item: { key: '/guides/endometriosis-surgery.md' } }], itemMap);
  assert.equal(cites.length, 1, 'a live guide must not be dropped by itemExists');
  assert.equal(cites[0].url, 'https://rrmacademy.org/endometriosis-surgery/');
  assert.equal(cites[0].title, 'Endometriosis Surgery');
});

test('an UNRESOLVED guide is still dropped: the gate did not get looser', () => {
  const itemMap = new Map([['/guides/nope.md', { sourceType: 'guide' }]]);
  assert.deepEqual(chunksToCitations([{ item: { key: '/guides/nope.md' } }], itemMap), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/brian/iCode/projects/rrm-ai-search && node --test test/url-routing.test.mjs`
Expected: FAIL. `bucketFromKey` returns null for a `/guides/` key.

- [ ] **Step 3: Implement**

In `/Users/brian/iCode/projects/rrm-ai-search/src/index.js`:

In `bucketFromKey`, change the nested-content regex and add the branch:

```js
export function bucketFromKey(key) {
  // Nested content: /<prefix>/<slug>.md
  const m = key.match(/^\/(library|commentary|faqs|glossary|guides)\/(.+)\.md$/);
  if (m) {
    const [, prefix, slug] = m;
    if (prefix === 'library') return { bucket: 'articles', slug, sourceType: 'article' };
    if (prefix === 'commentary') return { bucket: 'posts', slug, sourceType: 'post' };
    if (prefix === 'faqs') return { bucket: 'faqs', slug, sourceType: 'faq' };
    if (prefix === 'guides') return { bucket: 'guides', slug, sourceType: 'guide' };
    return { bucket: 'glossary', slug, sourceType: 'glossary' };
  }
  // ... pillar branch unchanged
```

In `itemUrl`, add above the `if (fullSlug)` block:

```js
  if (sourceType === 'guide') {
    // Guide pages live at the site ROOT. rrm-academy-cf's information
    // architecture decision (2026-03-12) puts pillar and companion guides at
    // /<slug>/ for SEO authority; /guides/ is an index page, not a URL parent.
    // The corpus key carries the /guides/ prefix only to name the bucket.
    const slug = fullSlug || path.replace(/^\/guides\//, '');
    return `https://rrmacademy.org/${slug}/`;
  }
```

In `titleFromKey`, add `guides` to the strip alternation:

```js
  const slug = stripped.replace(/^(library|commentary|faqs|glossary|guides)\//, '');
```

In `resolveItems`, add `guides: []` to the `buckets` literal and to `titlesByBucket`, add `guide: 'guides'` to `sourceToBucket` in the fallback block, and add the lookup. Guides are registered in `rrm-academy-cf/ssot/guides.json` and rendered from `src/data/*.json`, not from a D1 table, so there is no `guides` table to query. The pragmatic resolution, and the one that keeps the `itemExists` promise honest, is the `ai_search_docs` mirror the indexer already writes:

```js
  if (buckets.guides.length && env.AUTH_DB) {
    const ph = buckets.guides.map(() => '?').join(',');
    lookups.push(
      safeAll(env.AUTH_DB.prepare(
        // The indexer wrote this row when it indexed the guide, and it refuses
        // an unpublished guide at build time (build-doc.js publish predicate).
        // A row here therefore means "a published guide was indexed under this
        // key", which is the same promise the other buckets make.
        `SELECT full_slug AS slug, title FROM ai_search_docs WHERE source_type = 'guide' AND key IN (${ph})`,
      ).bind(...buckets.guides.map((s) => `/guides/${s}.md`)).all(), 'guides.primary').then((rows) => ({ bucket: 'guides', rows })),
    );
  }
```

If `ai_search_docs` carries no `title` column, add it in the same change (`ALTER TABLE ai_search_docs ADD COLUMN title TEXT`) and have the indexer write it; check first:

```bash
npx wrangler@4.62.0 d1 execute rrm-auth --remote --command "SELECT name FROM pragma_table_info('ai_search_docs')"
```

- [ ] **Step 4: Run tests, deploy (Brian's go required), commit**

```bash
cd /Users/brian/iCode/projects/rrm-ai-search && npm test
```
Expected: PASS.

**HUMAN CHECKPOINT**, then:

```bash
PHASE2_ID=$(op item get "Cloudflare API Token - Phase 2 (account-scoped, 90d)" --vault Automation --format json | jq -r .id)
export CLOUDFLARE_API_TOKEN=$(op item get "$PHASE2_ID" --vault Automation --fields credential --reveal)
npm run deploy
cat > /tmp/askrrm-p4-t3.msg <<'MSG'
feat(ask): guides bucket

A retrieved guide chunk used to fall through bucketFromKey to null, resolve no
title, fail itemExists, and be dropped from the citation list in silence: the
reader saw an answer with one fewer source and no sign one had gone missing.
Guides now resolve to their root URL, because guide pages live at the site root
and /guides/ is an index page rather than a URL parent. Proof gate G14.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add src/index.js test/url-routing.test.mjs
git commit -F /tmp/askrrm-p4-t3.msg
```

---

### Task 4: Namespace refresh

**Files:** none. This is an operation.

**Interfaces:**
- Consumes: Tasks 2 and 3, both deployed.
- Produces: guide and glossary keys present in `retrieval_docs` and in the AI Search namespace.

- [ ] **Step 1: Drive the batch**

Run whatever Task 2 Step 5 identified as the caller, in its full-refresh mode. Do NOT invent a new script: `scripts/ai-search-corpus-upload.mjs` is retired and this plan does not resurrect it.

- [ ] **Step 2: Confirm the corpus grew, by type**

```bash
npx wrangler@4.62.0 d1 execute rrm-library --remote --command \
  "SELECT source_type, COUNT(*) AS n FROM retrieval_docs WHERE tombstoned_at IS NULL GROUP BY source_type ORDER BY n DESC"
```
Expected: a `guide` row that did not exist before, and a `glossary` row at or near the count of published `glossary_term` rows.

- [ ] **Step 3: Prove G14 end to end against the live namespace**

```bash
AUTH=$(op read 'op://Automation/AI Search Worker Auth Token/credential')
curl -sS -X POST https://rrm-ai-search.administrator-cloudflare.workers.dev/retrieve \
  -H "Authorization: Bearer $AUTH" -H 'Content-Type: application/json' \
  -d '{"query":"what does the guide say about excision surgery","top_k":20}' \
  | jq '[.chunks[] | select(.type == "guide")] | {count: length, first: .[0]}'
```
Expected: `count` at least 1, and `first` carries a non-null `title` and a `url` of the form `https://rrmacademy.org/<slug>/`. A `count` of 0 means the refresh did not carry guides; go back to Task 2 Step 5.

- [ ] **Step 4: Run the reconcile again**

```bash
TOKEN=$(op read 'op://Automation/RRM Library Worker Admin Token/credential')
curl -sS -X POST https://rrm-library-worker.administrator-cloudflare.workers.dev/index/reconcile \
  -H "Authorization: Bearer $TOKEN" | jq .summary
```
Expected: `ghosts` and `residuals` no higher than Task 1's numbers. A jump in `ghosts` means the refresh indexed something whose source page does not exist, and that must be fixed before the golden set is rerun.

---

### Task 5: G6, the fallback-rate measurement

**Files:**
- Create: `scripts/ask-eval/fallback-rate.mjs`
- Modify: `scripts/quality/lib/census-rules.mjs`

**Interfaces:**
- Consumes: `ask_answer` rows with an `eval_tag`.
- Produces: `node scripts/ask-eval/fallback-rate.mjs --tag <tag> [--baseline <tag>]` prints the fallback rate and the zero-citation rate for a run tag, and compares two tags when `--baseline` is given. Exits 1 when `--baseline` is given and the rate did not improve.

**The Phase 1 baseline, from the ledger:** fallback rate 0 of 357 (0.0%), zero-citation answers 68 of 357 (19.0%), in-scope refusal rate 1 of 320 (0.3%). **The number G6 is actually about is the zero-citation rate**, not the fallback column: before P1, an uncited answer was served as prose and never marked, so `fallback` stayed at zero while 19% of answers had nothing behind them. From P1 onward cite-or-refuse converts exactly that population into refusals, so the fallback rate will RISE on the first rerun and then fall as coverage lands. Measure both and read them together, or the numbers will look like a regression when they are the fix.

- [ ] **Step 1: Write the script**

Create `scripts/ask-eval/fallback-rate.mjs`:

```js
#!/usr/bin/env node
/**
 * G6: the fallback rate on the eval bank, measured on the same run tag before
 * and after a coverage change.
 *
 * READ THE TWO NUMBERS TOGETHER. The Phase 1 baseline is fallback 0.0% and
 * zero-citation 19.0%, and those two facts are the same fact: an uncited answer
 * was served as prose and never marked, so the fallback column stayed at zero
 * while a fifth of all answers had nothing behind them. Cite-or-refuse converts
 * that population into refusals, so fallback RISES on the first rerun after P1
 * and falls again as coverage lands. A fallback rate read alone will call the
 * fix a regression.
 *
 * Reads rrm-analytics through wrangler. No writes.
 */
import { execFileSync } from 'node:child_process';

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
}

const TAG = arg('tag');
const BASELINE = arg('baseline');
if (!TAG) {
  console.error('usage: node scripts/ask-eval/fallback-rate.mjs --tag <eval_tag> [--baseline <eval_tag>]');
  process.exit(1);
}

function measure(tag) {
  const sql = `SELECT COUNT(*) AS n,
       SUM(CASE WHEN fallback = 1 THEN 1 ELSE 0 END) AS fallbacks,
       SUM(CASE WHEN citations_json = '[]' OR citations_json IS NULL THEN 1 ELSE 0 END) AS zero_cite
  FROM ask_answer WHERE eval_tag LIKE '${tag.replace(/'/g, "''")}%'`;
  const out = execFileSync('npx', ['wrangler@4.62.0', 'd1', 'execute', 'rrm-analytics', '--remote', '--json', '--command', sql], { encoding: 'utf8' });
  const rows = JSON.parse(out)?.[0]?.results || [];
  const row = rows[0] || {};
  const n = Number(row.n) || 0;
  if (n === 0) {
    // An empty read is not a zero rate. It is a tag that matched nothing, and
    // reporting 0% for it would be a green light built out of silence.
    throw new Error(`no ask_answer rows for tag ${tag}`);
  }
  return {
    tag, n,
    fallbackPct: (Number(row.fallbacks) || 0) * 100 / n,
    zeroCitePct: (Number(row.zero_cite) || 0) * 100 / n,
  };
}

const now = measure(TAG);
console.log(`${now.tag}: ${now.n} answers, fallback ${now.fallbackPct.toFixed(1)}%, zero-citation ${now.zeroCitePct.toFixed(1)}%`);

if (BASELINE) {
  const before = measure(BASELINE);
  console.log(`${before.tag}: ${before.n} answers, fallback ${before.fallbackPct.toFixed(1)}%, zero-citation ${before.zeroCitePct.toFixed(1)}%`);
  const delta = now.fallbackPct - before.fallbackPct;
  console.log(`fallback delta ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} points; target is under 10.0% after coverage`);
  // The bar the spec sets: under 10% on the golden set after the coverage
  // upload. A rise against the Phase 1 baseline is expected and is not the
  // failure; being over the bar is.
  if (now.fallbackPct >= 10) {
    console.log('G6 FAIL: fallback rate is at or over the 10% target');
    process.exit(1);
  }
  console.log('G6 PASS');
}
```

- [ ] **Step 2: Add the census rule**

In `scripts/quality/lib/census-rules.mjs` `OVERRIDES`:

```js
  ['scripts/ask-eval/fallback-rate.mjs', ['E2E-DRIVER', 'Measures G6 by reading live rrm-analytics ask_answer rows through wrangler. Its whole body is live D1 I/O against production data; the correctness instrument is the run, and the one piece of logic worth pinning (an empty read must throw rather than report 0%) is visible in the file.']],
```

- [ ] **Step 3: Measure, before and after**

```bash
node scripts/ask-eval/fallback-rate.mjs --tag run-2026-09-14
EVAL_TOKEN=$(op read 'op://Automation/RRM Ask Eval Worker Token/credential') \
  node scripts/ask-eval/run.mjs --eval --golden --tag "golden-$(date -u +%Y-%m-%d)-p4"
node scripts/ask-eval/fallback-rate.mjs --tag "golden-$(date -u +%Y-%m-%d)-p4" --baseline run-2026-09-14
```
Expected: `GOLDEN PASS` from the run, then `G6 PASS` from the comparison. Record both lines in the commit.

- [ ] **Step 4: Commit**

```bash
cat > /tmp/askrrm-p4-t5.msg <<'MSG'
feat(ask): G6 fallback-rate measurement

Reads the fallback rate AND the zero-citation rate for a run tag, because on
this surface they are the same fact seen from two sides: the Phase 1 baseline
was fallback 0.0% with zero-citation 19.0%, an uncited answer served as prose
and never marked. Cite or refuse converts that population into refusals, so
fallback rises on the first rerun and falls as coverage lands. Read alone, it
would call the fix a regression.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DK6PGKTJwE9v8MWKnsreHH
MSG
git add scripts/ask-eval/fallback-rate.mjs scripts/quality/lib/census-rules.mjs
git commit -F /tmp/askrrm-p4-t5.msg
git push origin main
```

---

## Self-review

**Spec coverage.** Section 8's first bullet, "`rrm-library-worker` gains a `guides/` prefix, with a publish predicate so an unpublished or draft guide never enters the namespace", is Task 2. The second bullet, "`rrm-ai-search`'s `bucketFromKey`, `itemUrl` and `resolveItems` gain a `guides/` bucket", is Task 3. The third, "run `/index/batch --reconcile` (dry run) before this ships to learn what, if anything, is actually indexed today", is Task 1 and is a human checkpoint rather than a step buried in a task. "`scripts/ai-search-corpus-upload.mjs` stays retired" is stated in the architecture and again in Task 4 Step 1. "Fallback rate becomes a tracked metric in the digest with a target under 10% on the golden set" is split: the MEASUREMENT is Task 5 here, and the DIGEST line is P6, which is where the observatory work lives. Section 14 step 4 is Tasks 2 to 4. G6 is Task 5; G14 is Task 3's unit test plus Task 4 Step 3's live probe.

One spec sentence I could not implement as written: section 2 says glossary terms "are not carried by the live refresh path as of this writing", while `build-doc.js` already knows the `glossary` type with a `/glossary/` prefix. Both can be true, if the CALLER is not sending glossary records. Task 1 resolves which, by measurement, before any code is written, and Task 2 Step 5 handles either answer.

**Placeholder scan.** Two deliberate measure-then-decide points, both human checkpoints with the command that produces the answer: Task 1 Step 3 (is glossary already indexed) and Task 2 Step 5 (which process drives `/index/batch`, which this repo cannot know from outside `rrm-library-worker`). Task 3 Step 3 carries the same shape for `ai_search_docs.title`, with the probe that settles it. Task 2 Step 4 says to read the pillar branch and match it field for field rather than pasting a guessed shape, which is the more reliable instruction for a file this plan cannot see in full.

**Type consistency.** `sourceType: 'guide'` is the same string in `build-doc.js` (`buildDoc`'s return), in `bucketFromKey`, in `itemUrl`, in `resolveItems`'s `sourceToBucket`, and in the `type: 'guide'` badge P2's `toCitation` and P5's page renderer expect. The bucket NAME is `guides` (plural, matching `articles`, `posts`, `faqs`) while the sourceType is `guide` (singular, matching `article`, `post`, `faq`); that asymmetry is the existing convention in `rrm-ai-search`, not a new one, and the tests pin both. The key prefix is `/guides/` in both repos.
