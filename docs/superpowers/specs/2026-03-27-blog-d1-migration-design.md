# Blog Pipeline: Airtable to D1 Migration

**Date:** 2026-03-27
**Status:** Spec complete, not yet executing

## Problem

Blog posts live in Airtable. The build fetches from Airtable every deploy. If an Airtable record's status changes (Published -> Review), the post silently vanishes from the site. This just caused 4 posts to disappear (including the site's #2 traffic page) and guardrail/framework records to leak onto the live library page.

## Solution

Replace Airtable with D1 as the blog SSOT. Same pattern as the library pipeline. Airtable is removed entirely.

## Workflow After Migration

```
Brian writes/edits in Google Docs (or anywhere)
  -> pastes into Claude Code
  -> Claude writes to D1 via wrangler or API endpoint
  -> git push triggers build
  -> fetch-blog-data.mjs fetches from D1 endpoint (not Airtable)
  -> posts.json -> Astro build -> deploy
```

Rollback = update the D1 record. Git history covers code changes. D1 covers content.

## What Changes

| Component | Before | After |
|-----------|--------|-------|
| SSOT | Airtable | D1 `rrm-academy` |
| Authoring | Airtable GUI | Google Docs -> Claude Code -> D1 |
| Fetch script | Airtable API | D1 endpoint (Pages Function) |
| Images | Airtable -> Tinify -> R2 | Already in R2, no change |
| Status changes | Silent post loss | Explicit `status` column in D1 |
| Single-record publish | `repository_dispatch` + Airtable API | `repository_dispatch` + D1 query |
| Airtable webhook | Fires on status change | Removed |
| `AIRTABLE_PAT` in CI | Required for blog fetch | No longer needed for blog |
| `blog-config.mjs` | Airtable base/table IDs | Removed or repurposed |

## What Does NOT Change

- `posts.json` still generated at build time (Astro reads it)
- Deploy guard baselines still check post count
- Citation verification still runs on blog deploys
- Commentary page templates, routes, components -- untouched
- Cover images stay in R2 at existing URLs
- Pagefind + Vectorize indexing -- untouched
- `repository_dispatch` trigger still works (just reads D1 instead of Airtable)

## D1 Schema

New table in existing `rrm-academy` database (binding `DB`).

```sql
CREATE TABLE posts (
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

CREATE UNIQUE INDEX idx_posts_slug ON posts(slug);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_publish_date ON posts(publish_date);
```

Fields map 1:1 from current `posts.json` shape:

| posts.json field | D1 column | Notes |
|-----------------|-----------|-------|
| `id` | `id` | Keep Airtable record IDs for traceability |
| `slug` | `slug` | |
| `title` | `title` | |
| `content` | `content` | Markdown body |
| `excerpt` | `excerpt` | |
| `author` | `author` | |
| `contentPillar` | `content_pillar` | camelCase -> snake_case |
| `coverImageUrl` | `cover_image_url` | R2 proxy path, already processed |
| `publishDate` | `publish_date` | ISO date string |
| `wordCount` | `word_count` | |
| `seoKeywords` | `seo_keywords` | |
| `lastModified` | `updated_at` | |
| `audioUrl` | dropped | Field exists but always empty |

## API Endpoint

`GET /api/blog/posts` -- CF Pages Function. Bearer auth via `WORKER_AUTH_TOKEN`.

```
GET /api/blog/posts              -> all published posts (status = 'published')
GET /api/blog/posts?id=recXXX    -> single post by ID (any status, for preview)
```

Response shape matches current `posts.json` entries exactly so downstream code needs zero changes.

```js
// functions/api/blog/posts.js
export async function onRequestGet(context) {
  const auth = context.request.headers.get('Authorization');
  if (auth !== `Bearer ${context.env.WORKER_AUTH_TOKEN}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const row = await context.env.DB.prepare(
      'SELECT * FROM posts WHERE id = ?'
    ).bind(id).first();
    if (!row) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(mapRow(row));
  }

  const { results } = await context.env.DB.prepare(
    'SELECT * FROM posts WHERE status = ? ORDER BY publish_date DESC'
  ).bind('published').all();

  return Response.json(results.map(mapRow));
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

## Fetch Script Changes

`fetch-blog-data.mjs` changes:

- `fetchAll()`: replace Airtable pagination with single fetch to `GET /api/blog/posts`
- `fetchSingle(id)`: replace Airtable record fetch with `GET /api/blog/posts?id=recXXX`
- Remove Airtable auth, retry logic, status filtering (D1 endpoint handles it)
- Keep: image processing pipeline, R2 upload, `r2UrlToProxy()`, `sortPosts()`, post-publish webhook ping
- Remove: `blog-config.mjs` import (no more Airtable base/table IDs needed)

Env var change: `AIRTABLE_PAT` no longer required for blog fetch. `WORKER_AUTH_TOKEN` already exists.

## Migration Script

One-time: `scripts/migrate-posts-to-d1.mjs`

1. Read current `posts.json` (18 posts)
2. For each post, INSERT into D1 `posts` table with `status = 'published'`
3. Verify count matches
4. Run locally with `npx wrangler d1 execute` or via the API endpoint

## Airtable Cleanup

After migration is verified and stable (1 week soak):

1. Remove `AIRTABLE_PAT` from GitHub Actions secrets (blog-specific usage)
2. Remove `AIRTABLE_BLOG_WEBHOOK_URL` from GitHub Actions secrets
3. Remove `blog-config.mjs` (Airtable base/table IDs)
4. Remove Airtable automation that fires `repository_dispatch`
5. Archive the Editorial Calendar base in Airtable (don't delete, just archive)

Note: `AIRTABLE_PAT` is also used by FAQs and courses fetch. Those are separate migration projects. Don't remove the secret until all three are off Airtable.

## Future: Adding a New Post

```
Brian: "here's a new post about [topic]" + pastes content
Claude: writes to D1 via wrangler d1 execute or POST /api/blog/posts
Brian: "push it"
Claude: git push -> rebuild fetches from D1 -> post is live
```

No Airtable, no webhook, no status field surprise.

## Implementation Steps

1. Create `posts` table in D1 `rrm-academy`
2. Write migration script, run it, verify 18 posts in D1
3. Create `functions/api/blog/posts.js` endpoint
4. Update `fetch-blog-data.mjs` to fetch from D1 endpoint
5. Update `deploy.yml` -- remove Airtable-specific blog fetch env vars
6. Test: full rebuild from D1, verify site matches current
7. Soak 1 week, then clean up Airtable references
