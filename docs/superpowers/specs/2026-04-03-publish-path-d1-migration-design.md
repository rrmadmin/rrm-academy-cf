# Publish Path D1 Migration Design

> Migrate FAQs and courses from Airtable to D1, completing the Airtable-to-D1 migration for all four content types. Unifies the authoring, storage, and build pipeline under a single source of truth.

## Status

- **Phase 1 (FAQs):** Not started
- **Phase 2 (Courses):** Not started

## Problem

Two of four content types still depend on Airtable for both storage and build-time fetch:

| Content type | Build source | SSOT | Single-record dispatch | Status model |
|---|---|---|---|---|
| Articles (3,232) | D1 `rrm-library` via worker `/articles` | D1 | Yes | `status` TEXT field |
| Blog/Commentary (18) | D1 `rrm-auth` via `/api/blog/posts` | D1 | Yes | `status` TEXT field |
| FAQs (~25) | Airtable `appIiligSFffFWwGA` via `fetch-faq-data.mjs` | Airtable | No (full fetch only) | Checkbox filter |
| Courses (~11) | Airtable `app0nohI0WrgFWOE3` via `fetch-courses-data.mjs` | Airtable | No (full fetch only) | Checkbox filter |

This creates several problems:

1. **No single-record dispatch.** Any FAQ or course change requires a full fetch-all rebuild. Articles and posts support surgical single-record updates.
2. **Fragile citation linking.** FAQ evidence links are pattern-matched at build time (author+year regex against articles.json). This is brittle and produces false positives/negatives.
3. **Expiring attachment URLs.** Course file attachments use Airtable's temporary signed URLs, requiring a sync-to-R2 dance in the fetch script.
4. **No status lifecycle.** FAQs and courses have no draft/published/archived lifecycle -- they're either in Airtable with a "Published" checkbox or they're not.
5. **Bidirectional Airtable dependency.** The STUC pipeline (`scripts/stuc-pipeline/publish.mjs`) writes course structure back to Airtable, creating a two-way coupling.
6. **Inconsistent rrm-cli sync.** The CLI's `sync-remote` pulls articles and posts from D1 but must fall back to local JSON files for FAQs and courses.

## Context: What Was Just Fixed

The `is_published` boolean and `status` text field were out of sync for 677 articles (Airtable migration artifact). All read gates now use `status = 'published'` as the single source of truth. The retraction path also sets `status = 'retracted'`. Worker, rrm-cli, and site build now see the same published set.

This fix established the pattern: `status` TEXT field is the canonical publish gate, not a boolean flag.

## Decision Record

| Decision | Choice | Rationale |
|---|---|---|
| Target database | `rrm-auth` D1 | FAQs and courses are site content, not research data. Blog posts already proved this database works for small content types. |
| Authoring interface | Admin API endpoints only (no UI) | ~25 FAQs and ~11 courses change rarely. Claude Code + curl is sufficient. |
| Citation linking | Explicit `faq_evidence` junction table | Pattern matching is fragile. Explicit links are auditable and reliable. |
| Migration order | FAQs first, then courses | FAQs are simpler (~25 records, no attachments, no linked tables). Validates the pattern before tackling courses. |
| STUC pipeline | Rewrite to use admin API (clean break) | No transitional Airtable compatibility. STUC writes to D1 directly. |
| Status model | Same as articles/posts: `status` TEXT field | Unifies all four content types under one lifecycle model. |

---

## Phase 1: FAQs to D1

### 1.1 Schema

Add to `rrm-auth` D1 (alongside existing `posts` table):

```sql
CREATE TABLE IF NOT EXISTS faq (
    id TEXT PRIMARY KEY,              -- 'faq_' prefix + nanoid
    slug TEXT UNIQUE NOT NULL,
    question TEXT NOT NULL,
    basic_answer TEXT,                -- hub page answer (short, plain text)
    schema_answer TEXT,               -- JSON-LD answer (concise, for FAQPage schema)
    published_answer TEXT,            -- detail page answer (full HTML)
    category TEXT NOT NULL,           -- 'foundational' | 'condition-specific' | 'common-concerns'
    seo_title TEXT,
    seo_description TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | published | archived
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_status ON faq(status);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(category);
CREATE INDEX IF NOT EXISTS idx_faq_slug ON faq(slug);

CREATE TABLE IF NOT EXISTS faq_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,         -- rrm-library article record ID
    label TEXT,                       -- optional display label override
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_evidence_faq ON faq_evidence(faq_id);
```

**Design notes:**

- `id` uses `faq_` prefix + nanoid (same pattern as blog post IDs) for easy identification across systems.
- `slug` is generated from the question text via the existing `slugify()` function. UNIQUE constraint prevents collisions.
- Three answer tiers match the current Airtable structure: `schema_answer` (JSON-LD), `basic_answer` (hub), `published_answer` (detail page).
- `category` is a constrained TEXT field, not an enum. Values: `foundational`, `condition-specific`, `common-concerns`. Application-level validation enforces these.
- `status` follows the same lifecycle as posts: `draft` -> `published` -> `archived`. The build-time fetch query filters on `status = 'published'`.
- `faq_evidence` links FAQs to library articles by article record ID (from `rrm-library` D1). The `article_id` is not a foreign key because it references a different D1 database. Application-level validation should verify the article exists.
- `ON DELETE CASCADE` on `faq_evidence.faq_id` ensures evidence links are cleaned up when a FAQ is deleted.

### 1.2 API Endpoints

All endpoints live under `functions/api/` as CF Pages Functions. Admin endpoints require session auth + admin role check.

#### Public endpoint (build-time fetch)

**`GET /api/faqs`** -- `functions/api/faqs.js`

- Auth: Bearer `WORKER_AUTH_TOKEN` (same as blog posts)
- Query: `?id=faq_xxx` for single-record fetch, omit for all published
- Response (all): `{ ok: true, results: [...] }`
- Response (single): `{ ok: true, data: {...} }`
- Joins `faq_evidence` to include evidence array in each FAQ record
- Filters: `status = 'published'` for all-records mode; no status filter for single-record mode (allows preview of drafts)
- Sort: `sort_order ASC`

Response shape per FAQ:

```json
{
  "id": "faq_abc123",
  "slug": "what-is-rrm",
  "question": "What is Restorative Reproductive Medicine?",
  "basicAnswer": "...",
  "schemaAnswer": "...",
  "publishedAnswer": "...",
  "category": "foundational",
  "seoTitle": "...",
  "seoDescription": "...",
  "sortOrder": 1,
  "evidence": [
    { "articleId": "recXXX", "label": "Hilgers 2004", "sortOrder": 0 }
  ]
}
```

Field name mapping: DB snake_case -> API camelCase (same as blog posts `mapRow()`).

#### Admin endpoints

**`GET /api/admin/faqs`** -- `functions/api/admin/faqs/index.js`

- Auth: session + `user.role === 'admin'`
- Returns all FAQs (any status) with evidence, sorted by `sort_order`
- Response: `{ ok: true, results: [...] }`

**`GET /api/admin/faqs/:id`** -- `functions/api/admin/faqs/[id].js`

- Auth: session + admin
- Returns single FAQ with evidence
- Response: `{ ok: true, data: {...} }`

**`POST /api/admin/faqs`** -- `functions/api/admin/faqs/index.js`

- Auth: session + admin
- Body: `{ question, basicAnswer?, schemaAnswer?, publishedAnswer?, category, seoTitle?, seoDescription?, sortOrder?, status? }`
- Generates `id` (faq_ + nanoid) and `slug` (from question)
- Input validation: question required, category must be valid enum, string length caps
- Response: `{ ok: true, data: {...} }`

**`PUT /api/admin/faqs/:id`** -- `functions/api/admin/faqs/[id].js`

- Auth: session + admin
- Body: partial update (only provided fields are updated)
- Sets `updated_at` to current timestamp
- Response: `{ ok: true, data: {...} }`

**`DELETE /api/admin/faqs/:id`** -- `functions/api/admin/faqs/[id].js`

- Auth: session + admin
- Cascades to `faq_evidence` (via ON DELETE CASCADE)
- Response: `{ ok: true }`

**`POST /api/admin/faqs/:id/evidence`** -- `functions/api/admin/faqs/[id]/evidence.js`

- Auth: session + admin
- Body: `{ articleId, label?, sortOrder? }`
- Input validation: articleId required, length cap
- Uses `INSERT OR IGNORE` (UNIQUE constraint on faq_id + article_id prevents duplicates)
- Response: `{ ok: true }`

**`DELETE /api/admin/faqs/:id/evidence/:articleId`** -- `functions/api/admin/faqs/[id]/evidence.js`

- Auth: session + admin
- Deletes specific evidence link
- Response: `{ ok: true }`

### 1.3 Build Pipeline Changes

#### Rewrite `fetch-faq-data.mjs`

Replace Airtable fetch with D1 API call:

```
Before: AIRTABLE_PAT -> Airtable API -> pattern-match citations -> faqs.json
After:  WORKER_AUTH_TOKEN -> GET /api/faqs -> faqs.json
```

The rewritten script:

1. Calls `GET https://rrmacademy.org/api/faqs` with Bearer token (same as `fetch-blog-data.mjs`)
2. Supports single-record mode via `RECORD_ID` env var: `GET /api/faqs?id=faq_xxx`
3. In single-record mode, reads existing `faqs.json`, finds and replaces the matching record, writes back
4. In full mode, writes the entire response as `faqs.json`
5. Drops all Airtable-specific code (API client, field mapping, evidence table joins, pagination)
6. Drops citation pattern-matching code (evidence links are now explicit in the API response)

**Evidence resolution at build time:** The fetch script receives evidence as `[{ articleId, label, sortOrder }]`. It resolves `articleId` to article metadata (slug, title, shortCitation) by looking up `articles.json` (already fetched by `fetch-data.mjs` which runs first in `fetch-all`). This is a simple ID lookup, not pattern matching.

#### Single-record dispatch

Add FAQ dispatch to GitHub Actions workflow:

```yaml
# In deploy.yml, alongside existing article_id and record_id handlers:
- name: Fetch single FAQ
  if: github.event.client_payload.faq_id
  run: RECORD_ID=${{ github.event.client_payload.faq_id }} node src/lib/fetch-faq-data.mjs
```

Trigger: `repository_dispatch` with `{ event_type: "faq_update", client_payload: { faq_id: "faq_xxx" } }`

#### Deploy guard

Add FAQ baseline to `.baselines.json`:

```json
{
  "articles": { "count": 3232, "maxDrop": 50 },
  "posts": { "count": 18, "maxDrop": 1 },
  "faqs": { "count": 25, "maxDrop": 2 },
  "courses": { "count": 11, "maxDrop": 1 }
}
```

FAQ max drop = 2 (stricter than articles because the dataset is small -- losing 2 of 25 is 8%).

### 1.4 rrm-cli Integration

#### sync-remote changes

Add FAQ sync to `sync-remote.js`:

1. Call `GET https://rrmacademy.org/api/faqs` with Bearer token (same auth as articles/posts)
2. Map response to local `content` table schema:
   - `type = 'faq'`
   - `authors = NULL` (FAQs have no author field)
   - `body = published_answer` (the full HTML answer)
   - `abstract = basic_answer` (the short answer)
   - `title = question`
   - `slug` from response
   - `category` from response
3. Map evidence links to `relationships` table:
   - `source_id = faq.id`
   - `target_id = evidence.articleId`
   - `relation = 'cites'`
   - `discovered_by = 'sync'`
   - `confidence = 1.0`

No new CLI commands needed. Existing commands work immediately:
- `rrm-cli search --type=faq "endometriosis"`
- `rrm-cli get faq what-is-rrm --full`
- `rrm-cli related faq what-is-rrm --type=article`

### 1.5 Migration Script

One-time script: `scripts/migrate-faqs-to-d1.mjs`

1. Fetch current FAQs from Airtable (using existing `fetch-faq-data.mjs` logic)
2. For each FAQ:
   - Generate `id` (faq_ + nanoid)
   - Generate `slug` from question
   - Map Airtable fields to D1 columns
   - Set `status = 'published'` (all current FAQs are published)
3. For evidence links:
   - Resolve Airtable evidence URL records to library article IDs
   - Use the pattern-matching logic one final time to resolve existing citations
   - Insert into `faq_evidence` with explicit article IDs
4. Insert all records via `wrangler d1 execute`
5. Verify: diff output of old `fetch-faq-data.mjs` (Airtable) vs new `GET /api/faqs` (D1) -- the build output (`faqs.json`) should be identical

### 1.6 Cleanup

After Phase 1 is deployed and verified in production:

1. Remove Airtable FAQ base ID and table ID constants from codebase
2. Remove old citation pattern-matching functions (`buildArticleIndex`, `extractCitations`, `matchCitations`)
3. Remove `AIRTABLE_PAT` from CI if no longer needed by any fetch script (wait for Phase 2)
4. Update `CLAUDE.md` to reflect FAQ data source change
5. Update deploy guard docs

---

## Phase 2: Courses to D1

### 2.1 Schema

Add to `rrm-auth` D1:

```sql
CREATE TABLE IF NOT EXISTS course (
    id TEXT PRIMARY KEY,              -- 'course_' prefix + nanoid
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    short_description TEXT,
    instructors TEXT,                  -- JSON array of instructor objects
    cover_image_url TEXT,             -- R2 URL (permanent, not Airtable temp)
    seo_title TEXT,
    seo_description TEXT,
    seo_keywords TEXT,
    access_type TEXT NOT NULL DEFAULT 'public',  -- public | private
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | published | archived
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_course_status ON course(status);
CREATE INDEX IF NOT EXISTS idx_course_slug ON course(slug);

CREATE TABLE IF NOT EXISTS course_module (
    id TEXT PRIMARY KEY,              -- 'mod_' prefix + nanoid
    course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_module_course ON course_module(course_id);

CREATE TABLE IF NOT EXISTS course_lesson (
    id TEXT PRIMARY KEY,              -- 'lesson_' prefix + nanoid
    module_id TEXT NOT NULL REFERENCES course_module(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    video_url TEXT,
    duration_minutes INTEGER,
    has_quiz INTEGER DEFAULT 0,
    quiz_id TEXT,
    sort_order INTEGER DEFAULT 0,
    attachments TEXT                   -- JSON array: [{name, url, size}]
);

CREATE INDEX IF NOT EXISTS idx_lesson_module ON course_lesson(module_id);
```

**Design notes:**

- `instructors` is stored as a JSON TEXT column, not a normalized table. Instructor data is display-only (name, title, bio, image URL) and doesn't need relational queries. Parsing happens at read time.
- `cover_image_url` points to R2 (permanent URLs). No more Airtable expiring URL dance.
- `attachments` in `course_lesson` is a JSON array of objects with `name`, `url` (R2), and `size`. Same rationale as instructors -- display-only data.
- `ON DELETE CASCADE` chains: deleting a course deletes its modules, which deletes their lessons.
- The existing `enrollment` and `step_progress` tables reference `course_id` as a plain TEXT field (no FK constraint). These continue to work unchanged -- the `course_id` values just need to match the new `course.id` values after migration.

**Enrollment compatibility:** The existing `enrollment` table uses `course_id` TEXT. Current course IDs come from Airtable (e.g., `recXXX`). After migration, new courses get `course_` prefix IDs. The migration script must preserve original Airtable IDs as the D1 primary key to avoid breaking existing enrollments, or migrate enrollment records to use new IDs. Decision: **preserve Airtable IDs** for migrated courses. New courses created post-migration use `course_` prefix.

### 2.2 API Endpoints

#### Public endpoint (build-time fetch)

**`GET /api/courses`** -- `functions/api/courses/index.js` (new file, does not conflict with existing `courses/enroll.js` etc.)

- Auth: Bearer `WORKER_AUTH_TOKEN`
- Query: `?id=course_xxx` for single-record, omit for all published
- Response includes nested modules and lessons (3-level join)
- Filters: `status = 'published'` for all-records mode
- Sort: courses by `sort_order`, modules by `sort_order`, lessons by `sort_order`

Response shape per course:

```json
{
  "id": "recXXX",
  "slug": "intro-to-rrm",
  "title": "Introduction to RRM",
  "description": "...",
  "shortDescription": "...",
  "instructors": [{"name": "Dr. Naomi Whittaker", "title": "MD", "bio": "...", "image": "..."}],
  "coverImageUrl": "https://...",
  "seoTitle": "...",
  "seoDescription": "...",
  "seoKeywords": "...",
  "accessType": "private",
  "sortOrder": 1,
  "modules": [
    {
      "id": "mod_xxx",
      "title": "Module 1",
      "description": "...",
      "sortOrder": 0,
      "lessons": [
        {
          "id": "lesson_xxx",
          "title": "Lesson 1",
          "description": "...",
          "videoUrl": "...",
          "durationMinutes": 15,
          "hasQuiz": false,
          "quizId": null,
          "sortOrder": 0,
          "attachments": []
        }
      ]
    }
  ]
}
```

#### Admin endpoints

**`POST /api/admin/courses`** -- create course
**`PUT /api/admin/courses/:id`** -- update course
**`DELETE /api/admin/courses/:id`** -- delete course (cascades to modules/lessons)
**`POST /api/admin/courses/:id/modules`** -- add module
**`PUT /api/admin/modules/:id`** -- update module
**`DELETE /api/admin/modules/:id`** -- delete module (cascades to lessons)
**`POST /api/admin/modules/:id/lessons`** -- add lesson
**`PUT /api/admin/lessons/:id`** -- update lesson
**`DELETE /api/admin/lessons/:id`** -- delete lesson

All admin endpoints: session + admin role auth, input validation, structured error responses.

#### File upload endpoint

**`POST /api/admin/upload`** -- `functions/api/admin/upload.js`

- Auth: session + admin
- Accepts multipart file upload
- Validates content type (allowlist: image/*, application/pdf, video/*)
- Uploads to R2 `rrm-assets` bucket with path prefix `courses/`
- Returns `{ ok: true, url: "https://..." }`
- Used for course cover images and lesson attachments

This may already be partially covered by `community/upload.js`. Evaluate reuse vs. separate endpoint during implementation.

### 2.3 Build Pipeline Changes

#### Rewrite `fetch-courses-data.mjs`

Replace Airtable fetch with D1 API call:

```
Before: AIRTABLE_PAT -> 3 Airtable tables -> nest hierarchy -> sync attachments to R2 -> courses.json
After:  WORKER_AUTH_TOKEN -> GET /api/courses -> courses.json
```

The rewritten script:

1. Calls `GET https://rrmacademy.org/api/courses` with Bearer token
2. Response already contains nested modules/lessons (joined in the API)
3. Attachments already point to R2 (no more Airtable URL sync)
4. Single-record mode via `RECORD_ID` env var
5. Drops all Airtable pagination, 3-table join, image optimization, and URL sync code

#### Single-record dispatch

```yaml
- name: Fetch single course
  if: github.event.client_payload.course_id
  run: RECORD_ID=${{ github.event.client_payload.course_id }} node src/lib/fetch-courses-data.mjs
```

### 2.4 STUC Pipeline Rewrite

The STUC pipeline (`scripts/stuc-pipeline/publish.mjs`) currently writes course module/lesson structure to Airtable. Rewrite to call admin API endpoints:

```
Before: STUC pipeline -> Airtable API (create/update modules + lessons)
After:  STUC pipeline -> POST /api/admin/courses/:id/modules, POST /api/admin/modules/:id/lessons
```

The pipeline authenticates using an admin session or a dedicated STUC API token (implementation decision for Phase 2).

### 2.5 rrm-cli Integration

Same pattern as FAQs:

1. `sync-remote` calls `GET /api/courses` with Bearer token
2. Maps to local `content` table: `type = 'course'`, `title`, `slug`, `body = description`, `authors = instructors[0].name`
3. Module and lesson data stored in `body` as structured text or in annotations

### 2.6 Migration Script

One-time script: `scripts/migrate-courses-to-d1.mjs`

1. Fetch current courses from Airtable (3 tables: Courses, Modules, Lessons)
2. For each course:
   - **Preserve Airtable record ID as D1 primary key** (enrollment compatibility)
   - Map Airtable fields to D1 columns
   - Set `status = 'published'` for published courses
3. For modules and lessons:
   - Generate new IDs (`mod_` and `lesson_` prefix + nanoid)
   - Maintain sort order and hierarchy
4. For file attachments:
   - Verify R2 URLs are already permanent (from prior sync)
   - Update `attachments` JSON with R2 paths
5. Insert via `wrangler d1 execute`
6. Verify: diff old vs new `courses.json` output

### 2.7 Cleanup

After Phase 2 is deployed and verified:

1. Remove all Airtable base/table ID constants for courses
2. Remove `AIRTABLE_PAT` from CI secrets (no longer needed by any fetch script)
3. Remove `src/lib/airtable-config.mjs` if it only served FAQ/course config
4. Delete old STUC Airtable integration code
5. Update `CLAUDE.md` -- remove Airtable dependency references, update data source table
6. Update `wrangler.toml` if Airtable-specific bindings existed

---

## Final State

After both phases:

| Content type | Build source | SSOT | Single-record dispatch | Status model |
|---|---|---|---|---|
| Articles (3,232) | D1 `rrm-library` via worker `/articles` | D1 | Yes | `status` TEXT |
| Blog/Commentary (18) | D1 `rrm-auth` via `/api/blog/posts` | D1 | Yes | `status` TEXT |
| FAQs (~25) | D1 `rrm-auth` via `/api/faqs` | D1 | Yes | `status` TEXT |
| Courses (~11) | D1 `rrm-auth` via `/api/courses` | D1 | Yes | `status` TEXT |

All four content types:

- **Unified status lifecycle:** `draft` -> `published` -> `archived` (articles also have `intake`, `enriching`, `needs_classification`, `classified`, `review`)
- **Single-record dispatch:** All support `repository_dispatch` with a record ID for surgical rebuilds
- **Deploy guard:** Baseline counts + max drop thresholds for all four types
- **rrm-cli sync:** `sync-remote` pulls all four types from D1 APIs into local SQLite
- **Zero Airtable dependency:** Build pipeline requires only `WORKER_AUTH_TOKEN`, not `AIRTABLE_PAT`

### Airtable residual usage

After this migration, Airtable is NOT used for any site content. Remaining Airtable usage:

- Financial ledger (rrm-foundation bookkeeping)
- Medical consultants table
- Endo survey responses (pseudonymized health data)
- n8n workflow state

These are separate concerns and not in scope for this migration.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Migration data loss | Diff pre/post JSON output. Run migration in staging D1 first. Keep Airtable read-only as rollback for 2 weeks. |
| Enrollment ID mismatch (courses) | Preserve Airtable record IDs as D1 primary keys for migrated courses. New courses use `course_` prefix. |
| Build regression | Deploy guard baseline counts catch missing records. Diff `faqs.json` / `courses.json` before and after. |
| STUC pipeline breaks | STUC rewrite is part of Phase 2, not a separate step. Test end-to-end before deploying. |
| Evidence link resolution | Migration script resolves existing pattern-matched citations to explicit article IDs. Manual review of edge cases. |

## Non-Goals

- Admin UI for FAQ/course editing (API-only authoring is sufficient for current scale)
- Airtable decommissioning for non-site data (ledger, surveys, consultants)
- Changes to the article or blog post pipelines (already on D1)
- Changes to the Astro page templates (they consume JSON, which doesn't change shape)

## Diagram

See `docs/publish-path-diagram.html` for visual flow diagrams of current state, Phase 1, Phase 2, and final state.
