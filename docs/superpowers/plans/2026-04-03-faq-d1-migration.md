# FAQ D1 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate FAQs from Airtable to D1, adding admin CRUD endpoints, explicit evidence linking, single-record dispatch, and rrm-cli sync.

**Architecture:** Three D1 tables (`faq`, `faq_library_ref`, `faq_resource`) in the existing `rrm-auth` database. Public read endpoint (`GET /api/faqs`) mirrors blog posts pattern. Admin CRUD endpoints under `/api/admin/faqs/`. Fetch script rewritten to call D1 API. One-time migration script moves Airtable data to D1.

**Tech Stack:** CF Pages Functions (JS), D1 (SQLite), Node.js test runner, Astro 5.3

**Spec:** `docs/superpowers/specs/2026-04-03-publish-path-d1-migration-design.md`

**Pattern to follow:** `functions/api/blog/posts.js` is the reference implementation for the public read endpoint. All new endpoints must follow the coding standards in `CLAUDE.md` (sibling consistency, try/catch, COLLATE NOCASE, etc.). Use `coder` agent for any file under `functions/api/`.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/migrate-faqs-to-d1.sql` | Create | D1 schema DDL (3 tables + indexes) |
| `scripts/migrate-faqs-to-d1.mjs` | Create | One-time Airtable -> D1 data migration |
| `functions/api/faqs.js` | Create | Public `GET /api/faqs` (build-time fetch) |
| `functions/api/admin/faqs/index.js` | Create | Admin `GET` (list all) + `POST` (create) |
| `functions/api/admin/faqs/[id].js` | Create | Admin `GET` (single) + `PUT` (update) + `DELETE` |
| `functions/api/admin/faqs/[id]/library-refs.js` | Create | Admin `POST` + `DELETE` for library article links |
| `functions/api/admin/faqs/[id]/resources.js` | Create | Admin `POST` + `DELETE` for external resource links |
| `test/faqs.test.js` | Create | Tests for public endpoint |
| `test/admin-faqs.test.js` | Create | Tests for admin CRUD endpoints |
| `src/lib/fetch-faq-data.mjs` | Rewrite | Replace Airtable fetch with D1 API call |
| `.github/workflows/deploy.yml` | Modify | Add `faq_id` dispatch + gate update |
| `schema.sql` | Modify | Append FAQ tables (documentation, not migration) |

---

### Task 1: D1 Schema

**Files:**
- Create: `scripts/migrate-faqs-to-d1.sql`
- Modify: `schema.sql` (append at end)

- [ ] **Step 1: Create the SQL migration file**

```sql
-- scripts/migrate-faqs-to-d1.sql
-- FAQ tables for rrm-auth D1 (Phase 1 of publish path D1 migration)
-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-to-d1.sql

CREATE TABLE IF NOT EXISTS faq (
    id TEXT PRIMARY KEY,
    faq_code TEXT,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    question TEXT NOT NULL,
    basic_answer TEXT,
    schema_answer TEXT,
    published_answer TEXT,
    category TEXT NOT NULL,
    seo_title TEXT,
    seo_description TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_status ON faq(status);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(category);

CREATE TABLE IF NOT EXISTS faq_library_ref (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    label TEXT,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_library_ref_faq ON faq_library_ref(faq_id);

CREATE TABLE IF NOT EXISTS faq_resource (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, url)
);

CREATE INDEX IF NOT EXISTS idx_faq_resource_faq ON faq_resource(faq_id);
```

- [ ] **Step 2: Append to schema.sql for documentation**

Add the same DDL to the end of `schema.sql` after the practitioner section, with a comment header:

```sql
-- FAQ Content (Phase 1 of publish path D1 migration)
```

- [ ] **Step 3: Run migration on remote D1**

```bash
cd ~/iCode/projects/rrm-academy-cf
npx wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-to-d1.sql
```

Expected: `Executed N commands` with no errors.

- [ ] **Step 4: Verify tables exist**

```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'faq%'"
```

Expected: `faq`, `faq_library_ref`, `faq_resource`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-faqs-to-d1.sql schema.sql
git commit -m "feat: add FAQ tables to rrm-auth D1"
```

---

### Task 2: Public Read Endpoint (`GET /api/faqs`)

**Files:**
- Create: `functions/api/faqs.js`
- Create: `test/faqs.test.js`

**IMPORTANT:** Dispatch the `coder` agent for this task. The file is under `functions/api/`.

**Reference:** `functions/api/blog/posts.js` -- mirror its auth pattern, error handling, and response shape exactly.

- [ ] **Step 1: Write the test file**

```js
// test/faqs.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

// We'll import the handler after writing it
const MODULE_PATH = '../functions/api/faqs.js';

describe('GET /api/faqs', () => {
  it('returns 503 when WORKER_AUTH_TOKEN missing', async () => {
    const { onRequestGet } = await import(MODULE_PATH);
    const env = mockEnv({ WORKER_AUTH_TOKEN: undefined });
    const res = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/faqs',
        headers: { Authorization: 'Bearer test-token' },
      }),
      env,
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 503);
    assert.equal(body.ok, false);
  });

  it('returns 401 when Bearer token wrong', async () => {
    const { onRequestGet } = await import(MODULE_PATH);
    const env = mockEnv({ WORKER_AUTH_TOKEN: 'correct-token' });
    const res = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/faqs',
        headers: { Authorization: 'Bearer wrong-token' },
      }),
      env,
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
  });

  it('returns 503 when DB missing', async () => {
    const { onRequestGet } = await import(MODULE_PATH);
    const env = mockEnv({ WORKER_AUTH_TOKEN: 'tok', DB: undefined });
    const res = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/faqs',
        headers: { Authorization: 'Bearer tok' },
      }),
      env,
      waitUntil: mockWaitUntil(),
    });
    const { status } = await parseResponse(res);
    assert.equal(status, 503);
  });

  it('returns all published FAQs with library refs and resources', async () => {
    const { onRequestGet } = await import(MODULE_PATH);
    const db = mockDB({
      "status = 'published'": {
        all: {
          results: [
            {
              id: 'faq_abc', faq_code: 'F01', slug: 'what-is-rrm',
              question: 'What is RRM?', basic_answer: 'Short answer',
              schema_answer: 'Schema answer', published_answer: '<p>Full</p>',
              category: 'Foundational', seo_title: 'What is RRM?',
              seo_description: 'Learn about RRM', sort_order: 1,
              status: 'published',
              created_at: '2026-01-01', updated_at: '2026-01-01',
            },
          ],
        },
      },
      'faq_library_ref': {
        all: {
          results: [
            { faq_id: 'faq_abc', article_id: 'rec123', label: 'Hilgers 2004', sort_order: 0 },
          ],
        },
      },
      'faq_resource': {
        all: {
          results: [
            { faq_id: 'faq_abc', title: 'IIRRM', url: 'https://iirrm.org/', sort_order: 0 },
          ],
        },
      },
    });
    const env = mockEnv({ WORKER_AUTH_TOKEN: 'tok', DB: db });
    const res = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/faqs',
        headers: { Authorization: 'Bearer tok' },
      }),
      env,
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].faqId, 'F01');
    assert.equal(body.results[0].category, 'Foundational');
    assert.equal(body.results[0].libraryRefs.length, 1);
    assert.equal(body.results[0].evidence.length, 1);
    assert.equal(body.results[0].evidence[0].url, 'https://iirrm.org/');
  });

  it('returns single FAQ by id (any status)', async () => {
    const { onRequestGet } = await import(MODULE_PATH);
    const db = mockDB({
      'WHERE id = ?': {
        first: {
          id: 'faq_abc', faq_code: 'F01', slug: 'what-is-rrm',
          question: 'What is RRM?', basic_answer: 'Short',
          schema_answer: 'Schema', published_answer: '<p>Full</p>',
          category: 'Foundational', seo_title: '', seo_description: '',
          sort_order: 1, status: 'draft',
          created_at: '2026-01-01', updated_at: '2026-01-01',
        },
      },
      'faq_library_ref': { all: { results: [] } },
      'faq_resource': { all: { results: [] } },
    });
    const env = mockEnv({ WORKER_AUTH_TOKEN: 'tok', DB: db });
    const res = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/faqs?id=faq_abc',
        headers: { Authorization: 'Bearer tok' },
      }),
      env,
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.id, 'faq_abc');
    assert.equal(body.data.status, 'draft');
  });

  it('returns 404 for unknown id', async () => {
    const { onRequestGet } = await import(MODULE_PATH);
    const db = mockDB({ 'WHERE id = ?': { first: null } });
    const env = mockEnv({ WORKER_AUTH_TOKEN: 'tok', DB: db });
    const res = await onRequestGet({
      request: mockRequest('GET', {
        url: 'https://rrmacademy.org/api/faqs?id=faq_nope',
        headers: { Authorization: 'Bearer tok' },
      }),
      env,
      waitUntil: mockWaitUntil(),
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 404);
    assert.equal(body.ok, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/faqs.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `functions/api/faqs.js`**

Use the `coder` agent. Provide these instructions:

> Create `functions/api/faqs.js` mirroring `functions/api/blog/posts.js` exactly in structure. Read `posts.js` first.
>
> **Auth:** Bearer `WORKER_AUTH_TOKEN`. Check `env.WORKER_AUTH_TOKEN` exists (503 if not), match against Authorization header (401 if wrong), check `env.DB` exists (503 if not).
>
> **Single-record mode** (`?id=faq_xxx`): Query `SELECT * FROM faq WHERE id = ?`, then fetch library refs and resources for that FAQ. Return `{ ok: true, data: mapRow(row) }`. Return 404 if not found. Validate id string (length <= 100).
>
> **All-records mode** (no `?id`): Query `SELECT * FROM faq WHERE status = 'published' ORDER BY sort_order ASC`. Then batch-fetch all library refs and resources. Group refs/resources by faq_id and attach to each FAQ.
>
> **Library refs query:** `SELECT * FROM faq_library_ref WHERE faq_id IN (?)` (use the faq IDs from the main query).
> **Resources query:** `SELECT * FROM faq_resource WHERE faq_id IN (?)` (same).
>
> **mapRow function** (snake_case -> camelCase):
> ```
> id, faqId (from faq_code), slug, question, basicAnswer, schemaAnswer,
> publishedAnswer, category, seoTitle, seoDescription, sortOrder, status,
> evidence: [{title, url, sortOrder}],  (from faq_resource)
> libraryRefs: [{articleId, label, sortOrder}]  (from faq_library_ref)
> ```
>
> **Error handling:** Wrap entire handler in try/catch. Log via `log(env, waitUntil, 'faq', ...)`. Return `{ ok: false, error: 'Internal error' }` with 500.
>
> Include `onRequestOptions()` returning `optionsResponse()`.

- [ ] **Step 4: Run tests**

```bash
node --test test/faqs.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/api/faqs.js test/faqs.test.js
git commit -m "feat: add public GET /api/faqs endpoint with tests"
```

---

### Task 3: Admin CRUD Endpoints

**Files:**
- Create: `functions/api/admin/faqs/index.js`
- Create: `functions/api/admin/faqs/[id].js`
- Create: `functions/api/admin/faqs/[id]/library-refs.js`
- Create: `functions/api/admin/faqs/[id]/resources.js`
- Create: `test/admin-faqs.test.js`

**IMPORTANT:** Dispatch the `coder` agent for this task. All files are under `functions/api/`.

- [ ] **Step 1: Write admin test file**

```js
// test/admin-faqs.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockDB, mockEnv, mockWaitUntil, parseResponse } from './_helpers.js';

describe('Admin FAQ endpoints', () => {
  it('POST /api/admin/faqs returns 401 without session', async () => {
    const { onRequestPost } = await import('../functions/api/admin/faqs/index.js');
    const env = mockEnv({});
    const res = await onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/faqs',
        body: { question: 'Test?', category: 'Foundational' },
      }),
      env,
      waitUntil: mockWaitUntil(),
      data: {},  // no user in session
    });
    const { status } = await parseResponse(res);
    assert.equal(status, 401);
  });

  it('POST /api/admin/faqs returns 403 for non-admin', async () => {
    const { onRequestPost } = await import('../functions/api/admin/faqs/index.js');
    const env = mockEnv({});
    const res = await onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/faqs',
        body: { question: 'Test?', category: 'Foundational' },
      }),
      env,
      waitUntil: mockWaitUntil(),
      data: { user: { id: 'u1', role: 'member' } },
    });
    const { status } = await parseResponse(res);
    assert.equal(status, 403);
  });

  it('POST /api/admin/faqs creates FAQ with valid input', async () => {
    const { onRequestPost } = await import('../functions/api/admin/faqs/index.js');
    const db = mockDB({
      'INSERT INTO faq': { run: { success: true } },
    });
    const env = mockEnv({ DB: db });
    const res = await onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/faqs',
        body: {
          question: 'What is RRM?',
          category: 'Foundational',
          basicAnswer: 'Short answer',
          status: 'published',
        },
      }),
      env,
      waitUntil: mockWaitUntil(),
      data: { user: { id: 'u1', role: 'superadmin' } },
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 201);
    assert.equal(body.ok, true);
    assert.ok(body.data.id.startsWith('faq_'));
    assert.equal(body.data.slug, 'what-is-rrm');
  });

  it('POST /api/admin/faqs rejects invalid category', async () => {
    const { onRequestPost } = await import('../functions/api/admin/faqs/index.js');
    const env = mockEnv({});
    const res = await onRequestPost({
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/admin/faqs',
        body: { question: 'Test?', category: 'Invalid' },
      }),
      env,
      waitUntil: mockWaitUntil(),
      data: { user: { id: 'u1', role: 'superadmin' } },
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 400);
    assert.match(body.error, /category/i);
  });

  it('DELETE /api/admin/faqs/:id deletes FAQ', async () => {
    const { onRequestDelete } = await import('../functions/api/admin/faqs/[id].js');
    const db = mockDB({
      'WHERE id = ?': { first: { id: 'faq_abc' } },
      'DELETE FROM faq': { run: { success: true } },
    });
    const env = mockEnv({ DB: db });
    const res = await onRequestDelete({
      request: mockRequest('DELETE', { url: 'https://rrmacademy.org/api/admin/faqs/faq_abc' }),
      env,
      waitUntil: mockWaitUntil(),
      data: { user: { id: 'u1', role: 'superadmin' } },
      params: { id: 'faq_abc' },
    });
    const { status, body } = await parseResponse(res);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/admin-faqs.test.js
```

Expected: FAIL (modules not found).

- [ ] **Step 3: Implement admin endpoints**

Use the `coder` agent. Provide these instructions:

> Create 4 files under `functions/api/admin/faqs/`. Read existing admin endpoints in `functions/api/admin/` for patterns. Read `functions/api/auth/_shared.js` for `json()`, `optionsResponse()`, `generateId()`.
>
> **Auth pattern for all admin endpoints:**
> ```js
> const user = context.data?.user;
> if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
> if (user.role !== 'superadmin' && user.role !== 'admin') return json({ ok: false, error: 'Forbidden' }, 403);
> ```
>
> **`index.js` -- GET (list all) + POST (create):**
> - GET: `SELECT * FROM faq ORDER BY sort_order ASC` (all statuses). Attach library refs + resources (same join pattern as public endpoint).
> - POST: Body `{ question, category, basicAnswer?, schemaAnswer?, publishedAnswer?, seoTitle?, seoDescription?, sortOrder?, status? }`. Validate: question required (max 500 chars), category must be one of `Foundational`, `Condition-Specific`, `Common Concerns`. Generate id: `'faq_' + generateId()`. Generate slug from question using slugify (copy the `slugify()` function from `src/lib/fetch-faq-data.mjs`). Default status to `draft`. Return 201 with `{ ok: true, data: mapRow(inserted) }`.
>
> **`[id].js` -- GET (single) + PUT (update) + DELETE:**
> - GET: Fetch FAQ by `context.params.id`. Attach refs + resources. Return 404 if not found.
> - PUT: Partial update -- only update provided fields. Always set `updated_at = datetime('now')`. Validate category if provided. Return updated FAQ.
> - DELETE: Check FAQ exists (404 if not). Delete (CASCADE handles refs/resources). Return `{ ok: true }`.
>
> **`[id]/library-refs.js` -- POST + DELETE:**
> - POST: Body `{ articleId, label?, sortOrder? }`. Validate articleId required (max 100 chars). `INSERT OR IGNORE INTO faq_library_ref`. Return `{ ok: true }`.
> - DELETE: Extract articleId from URL search params or path. `DELETE FROM faq_library_ref WHERE faq_id = ? AND article_id = ?`. Return `{ ok: true }`.
>
> **`[id]/resources.js` -- POST + DELETE:**
> - POST: Body `{ title, url, sortOrder? }`. Validate title + url required (max 500 chars each). `INSERT OR IGNORE INTO faq_resource`. Return `{ ok: true }`.
> - DELETE: Extract resourceId from URL. `DELETE FROM faq_resource WHERE id = ? AND faq_id = ?`. Return `{ ok: true }`.
>
> All endpoints: import `json`, `optionsResponse`, `generateId` from `../../auth/_shared.js`. Import `log` from `../../_log.js`. Wrap in try/catch. Include `onRequestOptions`.

- [ ] **Step 4: Run tests**

```bash
node --test test/admin-faqs.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/faqs/ test/admin-faqs.test.js
git commit -m "feat: add admin FAQ CRUD endpoints with tests"
```

---

### Task 4: Migration Script (Airtable -> D1)

**Files:**
- Create: `scripts/migrate-faqs-to-d1.mjs`

- [ ] **Step 1: Write the migration script**

This script reads the current `faqs.json` (already fetched from Airtable) and inserts into D1. It does NOT call Airtable directly -- it uses the cached JSON as the migration source. This avoids needing Airtable credentials and ensures the migration matches what's currently deployed.

```js
// scripts/migrate-faqs-to-d1.mjs
// One-time migration: faqs.json -> D1 rrm-auth
// Run: node scripts/migrate-faqs-to-d1.mjs > scripts/migrate-faqs-data.sql
// Then: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-data.sql

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const faqs = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'faqs.json'), 'utf-8'));

function generateId() {
  const bytes = new Uint8Array(16);
  // Use Math.random for migration (not security-sensitive)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'faq_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function escSql(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

console.log('-- FAQ migration data (auto-generated from faqs.json)');
console.log('-- Generated: ' + new Date().toISOString());
console.log('BEGIN;');
console.log('');

for (const faq of faqs) {
  const id = generateId();

  console.log(`INSERT INTO faq (id, faq_code, slug, question, basic_answer, schema_answer, published_answer, category, seo_title, seo_description, sort_order, status) VALUES (`);
  console.log(`  ${escSql(id)}, ${escSql(faq.faqId)}, ${escSql(faq.slug)}, ${escSql(faq.question)},`);
  console.log(`  ${escSql(faq.basicAnswer)}, ${escSql(faq.schemaAnswer)}, ${escSql(faq.publishedAnswer)},`);
  console.log(`  ${escSql(faq.category)}, ${escSql(faq.seoTitle)}, ${escSql(faq.seoDescription)},`);
  console.log(`  ${faq.sortOrder}, 'published'`);
  console.log(');');

  // Library refs
  if (faq.libraryRefs?.length) {
    for (let i = 0; i < faq.libraryRefs.length; i++) {
      const ref = faq.libraryRefs[i];
      // libraryRefs from faqs.json have {author, year, slug, title, shortCitation}
      // We need to find the article_id from articles.json by slug
      console.log(`-- NOTE: libraryRef for slug=${ref.slug} needs article_id resolution`);
      console.log(`-- INSERT INTO faq_library_ref (faq_id, article_id, label, sort_order) VALUES (${escSql(id)}, 'RESOLVE:${ref.slug}', ${escSql(ref.shortCitation)}, ${i});`);
    }
  }

  // External resources (evidence array)
  if (faq.evidence?.length) {
    for (let i = 0; i < faq.evidence.length; i++) {
      const ev = faq.evidence[i];
      console.log(`INSERT INTO faq_resource (faq_id, title, url, sort_order) VALUES (${escSql(id)}, ${escSql(ev.title)}, ${escSql(ev.url)}, ${i});`);
    }
  }

  console.log('');
}

console.log('COMMIT;');
console.log(`-- Total: ${faqs.length} FAQs`);
```

- [ ] **Step 2: Run and inspect output**

```bash
node scripts/migrate-faqs-to-d1.mjs | head -50
```

Expected: Valid SQL INSERT statements. Verify category values are title-case, slugs match current URLs, faq_code values are present.

- [ ] **Step 3: Generate the SQL file and resolve library refs**

```bash
node scripts/migrate-faqs-to-d1.mjs > scripts/migrate-faqs-data.sql
```

Manually review `scripts/migrate-faqs-data.sql`. For any `RESOLVE:slug` library refs, look up the article ID in `articles.json` and replace. Most FAQs currently have 0 library refs (pattern matching found few), so this may be empty.

- [ ] **Step 4: Execute migration on remote D1**

```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-data.sql
```

Expected: `Executed N commands` with no errors.

- [ ] **Step 5: Verify migration**

```bash
npx wrangler d1 execute rrm-auth --remote --command="SELECT COUNT(*) as cnt FROM faq"
npx wrangler d1 execute rrm-auth --remote --command="SELECT id, faq_code, slug, category, status FROM faq LIMIT 5"
npx wrangler d1 execute rrm-auth --remote --command="SELECT COUNT(*) as cnt FROM faq_resource"
```

Expected: FAQ count matches `faqs.json` length (~25). Categories are title-case. Status is `published`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-faqs-to-d1.mjs scripts/migrate-faqs-data.sql
git commit -m "feat: migrate FAQ data from Airtable to D1"
```

---

### Task 5: Rewrite Fetch Script

**Files:**
- Rewrite: `src/lib/fetch-faq-data.mjs`

- [ ] **Step 1: Save backup of current script**

```bash
cp src/lib/fetch-faq-data.mjs src/lib/fetch-faq-data.mjs.bak
```

- [ ] **Step 2: Rewrite fetch-faq-data.mjs**

Replace the entire file. The new version calls `GET /api/faqs` instead of Airtable. Model after `src/lib/fetch-blog-data.mjs`.

```js
/**
 * Fetch FAQ data from D1 via /api/faqs and cache as JSON.
 * Run: WORKER_AUTH_TOKEN=xxx node src/lib/fetch-faq-data.mjs
 *
 * Modes:
 *   RECORD_ID=faq_xxx  — single-record update (merge into existing faqs.json)
 *   (none)             — full fetch (all published FAQs)
 *
 * Library ref resolution: if articles.json exists, resolves articleId to
 * {slug, title, shortCitation}. If missing, emits refs with articleId only.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'faqs.json');
const ARTICLES_PATH = join(__dirname, '..', 'data', 'articles.json');
const DRY_RUN = process.argv.includes('--dry-run');

const API_BASE = 'https://rrmacademy.org/api/faqs';

function resolveLibraryRefs(faqs, articlesById) {
  if (!articlesById) return faqs;
  return faqs.map(faq => ({
    ...faq,
    libraryRefs: (faq.libraryRefs || []).map(ref => {
      const article = articlesById.get(ref.articleId);
      if (!article) return ref;
      return {
        ...ref,
        author: (article.authors || '').split(/[,;]/)[0].trim().split(/\s+/)[0],
        year: article.year,
        slug: article.slug,
        title: article.title,
        shortCitation: article.shortCitation || ref.label || ref.articleId,
      };
    }),
  }));
}

async function fetchAll() {
  if (DRY_RUN) {
    const fallbackPath = join(__dirname, '..', 'data', 'faqs.json');
    if (existsSync(fallbackPath)) {
      const data = JSON.parse(readFileSync(fallbackPath, 'utf-8'));
      console.log(`DRY-RUN: Loaded ${data.length} records from ${fallbackPath}`);
      return;
    }
    console.log('DRY-RUN: No cached faqs.json found');
    return;
  }

  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    console.error('Error: WORKER_AUTH_TOKEN environment variable required');
    process.exit(1);
  }

  // Load articles index for library ref resolution
  let articlesById = null;
  if (existsSync(ARTICLES_PATH)) {
    const articles = JSON.parse(readFileSync(ARTICLES_PATH, 'utf-8'));
    articlesById = new Map(articles.map(a => [a.id, a]));
    console.log(`Loaded ${articles.length} library articles for ref resolution`);
  } else {
    console.log('Warning: articles.json not found — library refs will lack slug/title');
  }

  const recordId = process.env.RECORD_ID;
  const url = recordId ? `${API_BASE}?id=${encodeURIComponent(recordId)}` : API_BASE;

  console.log(recordId ? `Fetching single FAQ: ${recordId}` : 'Fetching all published FAQs...');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  const json = await res.json();

  if (recordId) {
    // Single-record mode: merge into existing faqs.json
    if (!json.ok || !json.data) throw new Error('API returned no data for single record');

    let existing = [];
    if (existsSync(OUTPUT_PATH)) {
      existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    }

    const updated = resolveLibraryRefs([json.data], articlesById)[0];
    const idx = existing.findIndex(f => f.id === updated.id);
    if (idx >= 0) {
      existing[idx] = updated;
      console.log(`Updated FAQ: ${updated.slug}`);
    } else {
      existing.push(updated);
      console.log(`Added FAQ: ${updated.slug}`);
    }
    existing.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    const tmp = OUTPUT_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(existing, null, 2));
    renameSync(tmp, OUTPUT_PATH);
    console.log(`Wrote ${existing.length} FAQs to ${OUTPUT_PATH}`);
  } else {
    // Full fetch mode
    if (!json.ok || !json.results) throw new Error('API returned no results');

    const faqs = resolveLibraryRefs(json.results, articlesById);

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    const tmp = OUTPUT_PATH + '.tmp';
    writeFileSync(tmp, JSON.stringify(faqs, null, 2));
    renameSync(tmp, OUTPUT_PATH);

    const byCategory = {};
    for (const f of faqs) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    console.log(`\nWrote ${faqs.length} FAQs to ${OUTPUT_PATH}`);
    for (const [cat, count] of Object.entries(byCategory)) {
      console.log(`  ${cat}: ${count}`);
    }
  }
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Test locally against live API**

```bash
WORKER_AUTH_TOKEN=$(op read 'op://Automation/RRM Library Worker Auth Token/credential') node src/lib/fetch-faq-data.mjs
```

Expected: Fetches FAQs from D1 API, writes `faqs.json`. Compare output with the Airtable-sourced backup:

```bash
node -e "const a=require('./src/lib/fetch-faq-data.mjs.bak');const b=require('./src/data/faqs.json');console.log('count:', b.length)"
diff <(node -e "const d=require('./src/data/faqs.json');d.forEach(f=>console.log(f.slug,f.category,f.sortOrder))") <(node -e "const d=JSON.parse(require('fs').readFileSync('src/lib/fetch-faq-data.mjs.bak.json','utf8'));d.forEach(f=>console.log(f.slug,f.category,f.sortOrder))")
```

- [ ] **Step 4: Verify build still works**

```bash
npm run build
```

Expected: Astro build succeeds. FAQ pages render correctly.

- [ ] **Step 5: Remove backup and commit**

```bash
rm src/lib/fetch-faq-data.mjs.bak
git add src/lib/fetch-faq-data.mjs
git commit -m "feat: rewrite FAQ fetch to use D1 API instead of Airtable"
```

---

### Task 6: Deploy Workflow Updates

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add single-record FAQ dispatch step**

After the "Fetch single library article (dispatch)" step (~line 90), add:

```yaml
      - name: Fetch single FAQ (dispatch)
        if: ${{ github.event.client_payload.faq_id }}
        env:
          WORKER_AUTH_TOKEN: ${{ secrets.WORKER_AUTH_TOKEN }}
          RECORD_ID: ${{ github.event.client_payload.faq_id }}
        run: |
          npm run fetch-faqs
          echo "FAQs: $(node -e "console.log(require('./src/data/faqs.json').length)")"
```

- [ ] **Step 2: Update fetch-all gate condition**

The current condition on the "Fetch all data" step (~line 92) is:

```
if: ${{ github.event_name != 'push' && !inputs.skip_fetch && !github.event.client_payload.record_id && !github.event.client_payload.article_id && (github.event_name == 'workflow_dispatch' || steps.data-cache.outputs.cache-hit != 'true') }}
```

Add `&& !github.event.client_payload.faq_id` to the condition.

- [ ] **Step 3: Remove AIRTABLE_PAT from fetch-all (not yet -- courses still need it)**

Skip this step. `AIRTABLE_PAT` stays in the fetch-all env until Phase 2 (courses migration).

- [ ] **Step 4: Verify npm script exists**

Check `package.json` has a `fetch-faqs` script. If not, add:

```json
"fetch-faqs": "node src/lib/fetch-faq-data.mjs"
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml package.json
git commit -m "feat: add FAQ single-record dispatch to deploy workflow"
```

---

### Task 7: Update schema.sql and CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the FAQ data source in CLAUDE.md**

In the project's `CLAUDE.md`, find the Blog Pipeline section. After it, the FAQ pipeline should be documented. Update the data flow diagram and any references to Airtable FAQs.

Update the "Full Rebuild" section to note that FAQs now come from D1.

Update the deploy guard section if FAQ max drop changed.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for FAQ D1 migration"
```

---

### Task 8: Cleanup Old Airtable Code

**Files:**
- Modify: `src/lib/fetch-faq-data.mjs` (already rewritten in Task 5 -- just verify no Airtable references remain)

- [ ] **Step 1: Verify no Airtable references in FAQ fetch**

```bash
grep -r 'appIiligSFffFWwGA\|tblLSbusrE9jCfKEn\|tblPa4CzwFBaCQTwP' src/lib/
```

Expected: No matches (all Airtable IDs removed by the rewrite).

- [ ] **Step 2: Verify FAQ pages render correctly on local build**

```bash
npm run build && npx serve dist
```

Visit `http://localhost:3000/faqs` and verify the FAQ hub page renders. Click into a FAQ detail page and verify evidence + library refs render.

- [ ] **Step 3: Run full test suite**

```bash
node --test test/faqs.test.js test/admin-faqs.test.js
```

Expected: All tests pass.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

Expected: GitHub Actions deploy succeeds. FAQ pages on live site match pre-migration state.

---

### Task 9: rrm-cli Integration

**Files:**
- Modify: `~/iCode/projects/rrm-cli/src/commands/sync-remote.js`

This task is in a separate repo (`rrm-cli`). It teaches `sync-remote` to pull FAQs from the new D1 API.

- [ ] **Step 1: Read current sync-remote.js**

Read `~/iCode/projects/rrm-cli/src/commands/sync-remote.js` and `~/iCode/projects/rrm-cli/CLAUDE.md` to understand the existing sync pattern for articles and posts.

- [ ] **Step 2: Add FAQ sync to sync-remote**

Add a `syncFaqs()` function that:
1. Calls `GET https://rrmacademy.org/api/faqs` with Bearer token (same token used for articles/posts)
2. Maps each FAQ to the `content` table schema:
   - `type = 'faq'`
   - `title = question`
   - `slug` from response
   - `body = publishedAnswer`
   - `abstract = basicAnswer`
   - `authors = NULL`
   - `category` from response
3. For each FAQ's `libraryRefs` array, inserts into `relationships` table:
   - `source_id = faq.id`, `target_id = ref.articleId`, `relation = 'cites'`, `discovered_by = 'sync'`, `confidence = 1.0`

Wire `syncFaqs()` into the main sync-remote flow (after articles and posts).

- [ ] **Step 3: Test sync**

```bash
cd ~/iCode/projects/rrm-cli
node bin/rrm-cli.js sync-remote
```

Expected: FAQs synced. Verify:

```bash
node bin/rrm-cli.js search --type=faq "endometriosis"
node bin/rrm-cli.js get faq what-is-restorative-reproductive-medicine-rrm
```

- [ ] **Step 4: Commit in rrm-cli repo**

```bash
cd ~/iCode/projects/rrm-cli
git add src/commands/sync-remote.js
git commit -m "feat: sync FAQs from D1 API in sync-remote"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `wrangler d1 execute rrm-auth --remote --command="SELECT COUNT(*) FROM faq"` returns ~25
- [ ] `curl -H "Authorization: Bearer $TOKEN" https://rrmacademy.org/api/faqs | jq '.results | length'` returns ~25
- [ ] `curl -H "Authorization: Bearer $TOKEN" 'https://rrmacademy.org/api/faqs?id=faq_xxx' | jq '.data.faqId'` returns the legacy code
- [ ] Live site FAQ hub page (`/faqs`) renders correctly
- [ ] Live site FAQ detail page (`/faqs/what-is-rrm`) renders with evidence + library refs
- [ ] `rrm-cli search --type=faq "rrm"` returns results
- [ ] GitHub Actions deploy succeeds on push
- [ ] Single-record FAQ dispatch works (test with `gh api repos/rrmadmin/rrm-academy-cf/dispatches -f event_type=publish -f 'client_payload[faq_id]=faq_xxx'`)
