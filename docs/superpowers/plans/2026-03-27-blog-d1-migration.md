# Blog D1 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Airtable with D1 as the blog/commentary SSOT so posts never silently vanish.

**Architecture:** Add a `posts` table to the existing D1 `rrm-auth` database. Add a Pages Function endpoint that serves published posts. Rewrite `fetch-blog-data.mjs` to fetch from that endpoint instead of Airtable. Migrate the 18 existing posts from `posts.json` into D1.

**Tech Stack:** D1, CF Pages Functions, Node.js fetch scripts

**Spec:** `docs/superpowers/specs/2026-03-27-blog-d1-migration-design.md`

---

### Task 1: Create D1 posts table

**Files:**
- Create: `scripts/migrate-posts-to-d1.sql`

- [ ] **Step 1: Write the schema SQL**

Create `scripts/migrate-posts-to-d1.sql`:

```sql
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT 'Naomi Whittaker, MD',
  content_pillar TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT NOT NULL DEFAULT '',
  publish_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'review', 'published', 'archived')),
  word_count INTEGER NOT NULL DEFAULT 0,
  seo_keywords TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_publish_date ON posts(publish_date);
```

- [ ] **Step 2: Execute against remote D1**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --file=scripts/migrate-posts-to-d1.sql
```

Expected: Table created, 3 indexes created.

- [ ] **Step 3: Verify table exists**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='posts'"
```

Expected: One row with `name: "posts"`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-posts-to-d1.sql
git commit -m "feat: add posts table schema for D1 blog migration"
```

---

### Task 2: Migrate existing posts from posts.json to D1

**Files:**
- Create: `scripts/migrate-posts-to-d1.mjs`

- [ ] **Step 1: Write migration script**

Create `scripts/migrate-posts-to-d1.mjs`:

```js
/**
 * One-time migration: posts.json -> D1 posts table.
 * Run: node scripts/migrate-posts-to-d1.mjs
 *
 * Reads current posts.json (fetched from Airtable) and inserts all records
 * into the D1 posts table with status='published'.
 *
 * Uses wrangler d1 execute under the hood. Requires wrangler CLI.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = join(__dirname, '..', 'src', 'data', 'posts.json');
const DB_NAME = 'rrm-auth';

const posts = JSON.parse(readFileSync(POSTS_PATH, 'utf-8'));
console.log(`Loaded ${posts.length} posts from posts.json`);

// Build SQL statements
const statements = posts.map(p => {
  // Escape single quotes in content
  const esc = (s) => (s || '').replace(/'/g, "''");

  return `INSERT OR REPLACE INTO posts (id, slug, title, content, excerpt, author, content_pillar, cover_image_url, publish_date, status, word_count, seo_keywords, updated_at)
VALUES ('${esc(p.id)}', '${esc(p.slug)}', '${esc(p.title)}', '${esc(p.content)}', '${esc(p.excerpt)}', '${esc(p.author)}', '${esc(p.contentPillar)}', '${esc(p.coverImageUrl)}', '${esc(p.publishDate)}', 'published', ${p.wordCount || 0}, '${esc(p.seoKeywords)}', '${esc(p.lastModified || new Date().toISOString())}');`;
});

const sql = statements.join('\n');
const tmpFile = join(__dirname, '.tmp-migrate-posts.sql');
writeFileSync(tmpFile, sql);

console.log(`Generated ${statements.length} INSERT statements`);
console.log('Executing against remote D1...');

try {
  const result = execFileSync('npx', [
    'wrangler', 'd1', 'execute', DB_NAME,
    '--remote',
    `--file=${tmpFile}`,
  ], { stdio: 'pipe', timeout: 60000 });
  console.log(result.toString());
} finally {
  try { unlinkSync(tmpFile); } catch {}
}

console.log('Migration complete. Verify with:');
console.log(`  npx wrangler d1 execute ${DB_NAME} --remote --command "SELECT COUNT(*) as cnt FROM posts WHERE status='published'"`);
```

- [ ] **Step 2: Run the migration**

Run:
```bash
node scripts/migrate-posts-to-d1.mjs
```

Expected: "Loaded 18 posts from posts.json", "Generated 18 INSERT statements", "Migration complete."

- [ ] **Step 3: Verify migration**

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT COUNT(*) as cnt FROM posts WHERE status='published'"
```

Expected: `cnt: 18`

Run:
```bash
npx wrangler d1 execute rrm-auth --remote --command "SELECT slug, title FROM posts ORDER BY publish_date DESC LIMIT 5"
```

Expected: 5 most recent posts with correct titles.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-posts-to-d1.mjs
git commit -m "feat: add one-time posts migration script (Airtable -> D1)"
```

---

### Task 3: Create blog posts API endpoint

**Files:**
- Create: `functions/api/blog/posts.js`

- [ ] **Step 1: Read sibling endpoint patterns**

Read these files to match error handling, CORS, and response patterns:
- `functions/api/admin/cleanup.js` (Bearer auth pattern)
- `functions/api/stream/token.js` (simple GET with auth)

- [ ] **Step 2: Write the endpoint**

Create `functions/api/blog/posts.js`:

```js
/**
 * GET /api/blog/posts - Serve published blog posts from D1.
 *
 * Auth: Bearer WORKER_AUTH_TOKEN (build-time fetch only, not public).
 *
 * Query params:
 *   ?id=recXXX  - single post by ID (any status, for preview/rebuild)
 *   (none)      - all published posts, sorted by publish_date DESC
 */

import { CORS_HEADERS } from '../auth/_shared.js';

export async function onRequestGet(context) {
  const { env, request } = context;

  // Bearer auth
  const auth = request.headers.get('Authorization');
  if (!env.WORKER_AUTH_TOKEN || auth !== `Bearer ${env.WORKER_AUTH_TOKEN}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'service_unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  try {
    if (id) {
      const row = await env.DB.prepare(
        'SELECT * FROM posts WHERE id = ?'
      ).bind(id).first();

      if (!row) {
        return new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }

      return new Response(JSON.stringify(mapRow(row)), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const { results } = await env.DB.prepare(
      'SELECT * FROM posts WHERE status = ? ORDER BY publish_date DESC'
    ).bind('published').all();

    return new Response(JSON.stringify((results || []).map(mapRow)), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'database_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}

function mapRow(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content,
    excerpt: r.excerpt,
    author: r.author,
    contentPillar: r.content_pillar,
    coverImageUrl: r.cover_image_url,
    publishDate: r.publish_date,
    wordCount: r.word_count,
    seoKeywords: r.seo_keywords,
    audioUrl: '',
    lastModified: r.updated_at,
  };
}
```

- [ ] **Step 3: Add WORKER_AUTH_TOKEN to wrangler.toml vars (if not already present)**

Check `wrangler.toml` for `WORKER_AUTH_TOKEN` in `[vars]`. It may only be a CI secret. If it's not in wrangler.toml, that's fine -- it's passed as an env var in CI and the endpoint reads from `env.WORKER_AUTH_TOKEN`.

- [ ] **Step 4: Commit**

```bash
git add functions/api/blog/posts.js
git commit -m "feat: add GET /api/blog/posts endpoint (D1-backed)"
```

---

### Task 4: Rewrite fetch-blog-data.mjs to use D1 endpoint

**Files:**
- Modify: `src/lib/fetch-blog-data.mjs` (full rewrite)

- [ ] **Step 1: Rewrite the fetch script**

Replace `src/lib/fetch-blog-data.mjs` with:

```js
/**
 * Fetch blog posts from D1 via /api/blog/posts endpoint and cache as JSON.
 * Run: WORKER_AUTH_TOKEN=xxx node src/lib/fetch-blog-data.mjs
 *
 * Single-record mode: RECORD_ID=recXXX fetches one post for merge.
 * Full mode: fetches all published posts.
 *
 * Replaces the previous Airtable-based fetch.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'posts.json');
const DRY_RUN = process.argv.includes('--dry-run');

const POSTS_URL = 'https://rrmacademy.org/api/blog/posts';

async function fetchWithRetry(url, options, retries = 5) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    const delay = Math.pow(2, attempt) * 1000;
    console.warn(`Retry ${attempt + 1}/${retries} in ${delay / 1000}s...`);
    await new Promise(r => setTimeout(r, delay));
  }
  throw lastError;
}

function sortPosts(posts) {
  posts.sort((a, b) => {
    if (!a.publishDate && !b.publishDate) return 0;
    if (!a.publishDate) return 1;
    if (!b.publishDate) return -1;
    return b.publishDate.localeCompare(a.publishDate);
  });
  return posts;
}

async function fetchSingle(recordId) {
  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    console.error('Error: WORKER_AUTH_TOKEN environment variable required');
    process.exit(1);
  }

  console.log(`Fetching single post: ${recordId}`);
  const res = await fetchWithRetry(`${POSTS_URL}?id=${recordId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blog API ${res.status}: ${err}`);
  }

  const post = await res.json();

  // Load existing posts.json
  let posts = [];
  if (existsSync(OUTPUT_PATH)) {
    posts = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    console.log(`Loaded ${posts.length} existing posts from cache`);
  } else {
    console.warn('Cache missing. Falling back to full fetch.');
    return fetchAll();
  }

  // Remove old version of this record (if present)
  const before = posts.length;
  posts = posts.filter(p => p.id !== recordId);
  const wasPresent = posts.length < before;

  // Add updated post
  posts.push(post);
  console.log(`${wasPresent ? 'Updated' : 'Added'} post: ${post.slug}`);

  sortPosts(posts);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(posts, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${posts.length} posts to ${OUTPUT_PATH}`);
}

async function fetchAll() {
  if (DRY_RUN) {
    const fixturePath = join(__dirname, '..', '..', '.pipeline', 'snapshots', 'latest', 'posts.json');
    const fallbackPath = join(__dirname, '..', 'data', 'posts.json');
    const source = existsSync(fixturePath) ? fixturePath : fallbackPath;
    const data = JSON.parse(readFileSync(source, 'utf-8'));
    console.log(`DRY-RUN: Loaded ${data.length} records from ${source}`);
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
    console.log(`DRY-RUN: Wrote ${data.length} records to ${OUTPUT_PATH}`);
    return;
  }

  const token = process.env.WORKER_AUTH_TOKEN;
  if (!token) {
    console.error('Error: WORKER_AUTH_TOKEN environment variable required');
    process.exit(1);
  }

  console.log('Fetching all published posts from D1...');
  const res = await fetchWithRetry(POSTS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Blog API ${res.status}: ${err}`);
  }

  const posts = await res.json();
  console.log(`Fetched ${posts.length} published posts`);

  sortPosts(posts);

  // Dedup by slug (shouldn't happen, but safety net)
  const seen = new Set();
  const deduplicated = posts.filter(p => {
    if (seen.has(p.slug)) {
      console.warn(`Warning: duplicate slug "${p.slug}" -- keeping first occurrence`);
      return false;
    }
    seen.add(p.slug);
    return true;
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const tmpPath = OUTPUT_PATH + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(deduplicated, null, 2));
  renameSync(tmpPath, OUTPUT_PATH);
  console.log(`Wrote ${deduplicated.length} posts to ${OUTPUT_PATH}`);
}

const recordId = process.env.RECORD_ID;
const main = recordId ? () => fetchSingle(recordId) : fetchAll;

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

Key changes from original:
- `POSTS_URL` replaces `API_URL` (Airtable)
- `WORKER_AUTH_TOKEN` replaces `AIRTABLE_PAT`
- No image processing (images already in R2)
- No Airtable status filtering (D1 endpoint only returns published)
- No `blog-config.mjs` import
- No Airtable webhook ping on publish (removed)
- `fetchSingle()` always adds the post (D1 endpoint returns it if it exists, 404 if not)

- [ ] **Step 2: Verify local build works**

Run:
```bash
WORKER_AUTH_TOKEN=$(op read 'op://Automation/RRM Library Worker Auth Token/credential') node src/lib/fetch-blog-data.mjs
```

Expected: "Fetched 18 published posts", "Wrote 18 posts to .../posts.json"

Then:
```bash
npm run build
```

Expected: Build passes, same page count as before.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fetch-blog-data.mjs
git commit -m "feat: rewrite blog fetch to use D1 endpoint instead of Airtable"
```

---

### Task 5: Update deploy.yml to remove Airtable blog dependencies

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Update single-post dispatch step**

In `.github/workflows/deploy.yml`, find the "Fetch single blog post (dispatch)" step (~line 72). Change:

```yaml
      - name: Fetch single blog post (dispatch)
        if: ${{ github.event.client_payload.record_id }}
        env:
          AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
          RECORD_ID: ${{ github.event.client_payload.record_id }}
          TINIFY_API_KEY: ${{ secrets.TINIFY_API_KEY }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          AIRTABLE_BLOG_WEBHOOK_URL: ${{ secrets.AIRTABLE_BLOG_WEBHOOK_URL }}
        run: |
          npm run fetch-blog
          echo "Posts: $(node -e "console.log(require('./src/data/posts.json').length)")"
```

To:

```yaml
      - name: Fetch single blog post (dispatch)
        if: ${{ github.event.client_payload.record_id }}
        env:
          WORKER_AUTH_TOKEN: ${{ secrets.WORKER_AUTH_TOKEN }}
          RECORD_ID: ${{ github.event.client_payload.record_id }}
        run: |
          npm run fetch-blog
          echo "Posts: $(node -e "console.log(require('./src/data/posts.json').length)")"
```

- [ ] **Step 2: Update fetch-all step**

In the "Fetch all data" step (~line 95), remove `AIRTABLE_BLOG_WEBHOOK_URL` from the env vars. Keep `AIRTABLE_PAT` (still needed for FAQs/courses until those are migrated too). The `WORKER_AUTH_TOKEN` is already present.

Remove this line from the env block:
```yaml
          AIRTABLE_BLOG_WEBHOOK_URL: ${{ secrets.AIRTABLE_BLOG_WEBHOOK_URL }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: remove Airtable blog deps from deploy pipeline"
```

---

### Task 6: Delete blog-config.mjs

**Files:**
- Delete: `src/lib/blog-config.mjs`
- Modify: `src/lib/fetch-blog-data.mjs` (already done in Task 4 -- verify no import)

- [ ] **Step 1: Verify no remaining imports of blog-config.mjs**

Run:
```bash
grep -rn "blog-config" src/ functions/ scripts/
```

Expected: No matches (the rewrite in Task 4 removed the import). If there are matches, remove them.

- [ ] **Step 2: Delete the file**

```bash
rm src/lib/blog-config.mjs
```

- [ ] **Step 3: Verify build still passes**

```bash
npm run build
```

Expected: Build passes. No import errors.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/blog-config.mjs
git commit -m "chore: remove blog-config.mjs (Airtable IDs no longer needed)"
```

---

### Task 7: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Full local rebuild from D1**

```bash
WORKER_AUTH_TOKEN=$(op read 'op://Automation/RRM Library Worker Auth Token/credential') npm run fetch-all
npm run build
```

Expected: posts.json has 18 posts, build passes, page count matches previous.

- [ ] **Step 2: Spot-check post content**

```bash
node -e "
const posts = require('./src/data/posts.json');
const p = posts.find(p => p.slug.includes('isthmocele'));
console.log(p ? p.title + ' -- OK' : 'MISSING: isthmocele post');
const p2 = posts.find(p => p.slug.includes('naomi-whittaker'));
console.log(p2 ? p2.title + ' -- OK' : 'MISSING: naomi spotlight');
console.log('Total:', posts.length, 'posts');
"
```

Expected: Both posts present, 18 total.

- [ ] **Step 3: Push and trigger full deploy**

```bash
git push origin main
gh workflow run deploy.yml
```

Expected: Deploy succeeds. Live site shows all 18 commentary posts. No guardrails, no frameworks.

- [ ] **Step 4: Verify live site**

```bash
curl -s "https://rrmacademy.org/commentary/" | grep -c 'article-card'
```

Expected: 6 (the recent grid shows 6 posts on the commentary index).

```bash
curl -s -o /dev/null -w "%{http_code}" "https://rrmacademy.org/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/"
```

Expected: 200

---

### Post-Migration Cleanup (1 week soak, not part of this plan)

After confirming D1 pipeline is stable for 1 week:

1. Remove `AIRTABLE_BLOG_WEBHOOK_URL` from GitHub Actions secrets
2. Remove Airtable automation that fires `repository_dispatch` for blog posts
3. Archive the Editorial Calendar base in Airtable (don't delete)
4. Update `CLAUDE.md` deploy pipeline docs to reflect D1 blog source
5. Update memory: `commentary-content-strategy.md`, `library-e2e-pipeline-gap.md`
