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
| Citation linking | Explicit `faq_library_ref` junction table + `faq_resource` table | Pattern matching is fragile. Explicit links are auditable and reliable. Separate tables for library refs (article IDs) vs external resources (URLs). |
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
    faq_code TEXT,                    -- legacy human-readable ID (F01, C03, etc.)
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    question TEXT NOT NULL,
    basic_answer TEXT,                -- hub page answer (short, plain text)
    schema_answer TEXT,               -- JSON-LD answer (concise, for FAQPage schema)
    published_answer TEXT,            -- detail page answer (full HTML)
    category TEXT NOT NULL,           -- 'Foundational' | 'Condition-Specific' | 'Common Concerns'
    seo_title TEXT,
    seo_description TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_status ON faq(status);
CREATE INDEX IF NOT EXISTS idx_faq_category ON faq(category);

-- Library article cross-references (rendered as "From the RRM Research Library")
CREATE TABLE IF NOT EXISTS faq_library_ref (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faq_id TEXT NOT NULL REFERENCES faq(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,         -- rrm-library article record ID
    label TEXT,                       -- optional display label override
    sort_order INTEGER DEFAULT 0,
    UNIQUE(faq_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_library_ref_faq ON faq_library_ref(faq_id);

-- External evidence resources (rendered as "External Resources")
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

**Design notes:**

- `id` uses `faq_` prefix + nanoid (same pattern as blog post IDs) for easy identification across systems.
- `faq_code` preserves the legacy human-readable ID (`F01`, `C03`). The current `faqId` field in `faqs.json` maps here. Nullable for new FAQs created post-migration.
- `slug` uses `COLLATE NOCASE` per project coding standards. The UNIQUE constraint creates an implicit index (no separate `idx_faq_slug` needed).
- Three answer tiers match the current Airtable structure: `schema_answer` (JSON-LD), `basic_answer` (hub), `published_answer` (detail page).
- `category` uses **title-case values matching the current `faqs.json`**: `Foundational`, `Condition-Specific`, `Common Concerns`. This avoids template changes in `faq.ts` where `groupByCategory()` hardcodes these exact strings.
- `status` has a CHECK constraint for parity with the `posts` table. Values: `draft`, `published`, `archived`.
- **Two separate evidence tables** preserve the current dual-rendering in the FAQ detail template:
  - `faq_library_ref`: links to library articles by record ID (rendered as "From the RRM Research Library" with internal `/library/{slug}` links). The `article_id` is not a foreign key because it references a different D1 database. Application-level validation should verify the article exists.
  - `faq_resource`: stores external evidence URLs (rendered as "External Resources" with outbound links). Examples: IIRRM.org pages, WHO guidelines.
- `ON DELETE CASCADE` on both tables ensures cleanup when a FAQ is deleted.

### 1.2 API Endpoints

All endpoints live under `functions/api/` as CF Pages Functions. Admin endpoints require session auth + admin role check.

#### Public endpoint (build-time fetch)

**`GET /api/faqs`** -- `functions/api/faqs.js`

- Auth: Bearer `WORKER_AUTH_TOKEN` (same as blog posts)
- Query: `?id=faq_xxx` for single-record fetch, omit for all published
- Response (all): `{ ok: true, results: [...] }`
- Response (single): `{ ok: true, data: {...} }`
- Joins `faq_library_ref` and `faq_resource` to include both arrays in each FAQ record
- Filters: `status = 'published'` for all-records mode; no status filter for single-record mode (allows preview of drafts)
- Sort: `sort_order ASC`
- Includes `status` in all responses (admin consumers need it; build script ignores it)

Response shape per FAQ:

```json
{
  "id": "faq_abc123",
  "faqId": "F01",
  "slug": "what-is-rrm",
  "question": "What is Restorative Reproductive Medicine?",
  "basicAnswer": "...",
  "schemaAnswer": "...",
  "publishedAnswer": "...",
  "category": "Foundational",
  "seoTitle": "...",
  "seoDescription": "...",
  "sortOrder": 1,
  "status": "published",
  "evidence": [
    { "title": "What is RRM -- IIRRM", "url": "https://iirrm.org/what-is-rrm/" }
  ],
  "libraryRefs": [
    { "articleId": "recXXX", "label": "Hilgers 2004", "sortOrder": 0 }
  ]
}
```

Field name mapping: DB snake_case -> API camelCase (same as blog posts `mapRow()`). `faq_code` -> `faqId` for backward compatibility with existing `faq.ts` interface.

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

**`POST /api/admin/faqs/:id/library-refs`** -- `functions/api/admin/faqs/[id]/library-refs.js`

- Auth: session + admin
- Body: `{ articleId, label?, sortOrder? }`
- Input validation: articleId required, length cap
- Uses `INSERT OR IGNORE` (UNIQUE constraint on faq_id + article_id prevents duplicates)
- Response: `{ ok: true }`

**`DELETE /api/admin/faqs/:id/library-refs/:articleId`** -- `functions/api/admin/faqs/[id]/library-refs.js`

- Auth: session + admin
- Deletes specific library reference link
- Response: `{ ok: true }`

**`POST /api/admin/faqs/:id/resources`** -- `functions/api/admin/faqs/[id]/resources.js`

- Auth: session + admin
- Body: `{ title, url, sortOrder? }`
- Input validation: title required, url required and valid format, length caps
- Uses `INSERT OR IGNORE` (UNIQUE constraint on faq_id + url prevents duplicates)
- Response: `{ ok: true }`

**`DELETE /api/admin/faqs/:id/resources/:resourceId`** -- `functions/api/admin/faqs/[id]/resources.js`

- Auth: session + admin
- Deletes specific external resource link
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

**Library ref resolution at build time:** The API returns `libraryRefs` as `[{ articleId, label, sortOrder }]`. The fetch script resolves each `articleId` to full article metadata (`slug`, `title`, `shortCitation`) by looking up `articles.json`. This is a simple ID lookup, not pattern matching.

**Graceful degradation when `articles.json` is missing:** In single-record dispatch mode, only the FAQ fetch runs -- `articles.json` may not exist if the cache was cleared. The fetch script must handle this: if `articles.json` is not found, emit `libraryRefs` with `articleId` only (no `slug`/`title`/`shortCitation`). The template should render these as plain text citations rather than library links. The deploy workflow should restore the data cache before running any single-record fetch (same pattern as blog posts).

**External resources** (`evidence` array) come directly from the API as `[{ title, url }]` -- no resolution needed.

#### Single-record dispatch

Add FAQ dispatch to GitHub Actions workflow:

```yaml
# In deploy.yml, alongside existing article_id and record_id handlers:
- name: Fetch single FAQ
  if: github.event.client_payload.faq_id
  run: RECORD_ID=${{ github.event.client_payload.faq_id }} node src/lib/fetch-faq-data.mjs
```

Trigger: `repository_dispatch` with `{ event_type: "faq_update", client_payload: { faq_id: "faq_xxx" } }`

**Deploy workflow gate update:** The `Fetch all data` step's condition must be updated to exclude `faq_id` (and later `course_id`) dispatch payloads. Without this, a `faq_id` dispatch triggers a full fetch-all (since neither `record_id` nor `article_id` is present). Add `!github.event.client_payload.faq_id` to the existing condition.

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
3. Map library refs to `relationships` table:
   - `source_id = faq.id`
   - `target_id = libraryRef.articleId`
   - `relation = 'cites'`
   - `discovered_by = 'sync'`
   - `confidence = 1.0`
4. External resources (`evidence` array) are not synced to rrm-cli (they are URL-only display data, not content relationships)

No new CLI commands needed. Existing commands work immediately:
- `rrm-cli search --type=faq "endometriosis"`
- `rrm-cli get faq what-is-rrm --full`
- `rrm-cli related faq what-is-rrm --type=article`

### 1.5 Migration Script

One-time script: `scripts/migrate-faqs-to-d1.mjs`

1. Fetch current FAQs from Airtable (using existing `fetch-faq-data.mjs` logic)
2. For each FAQ:
   - Generate `id` (faq_ + nanoid)
   - Preserve `faqId` as `faq_code` (e.g., `F01`, `C03`)
   - Preserve `slug` from current `faqs.json` (not regenerated, to avoid URL changes)
   - Map Airtable fields to D1 columns
   - Preserve title-case `category` values (`Foundational`, `Condition-Specific`, `Common Concerns`)
   - Set `status = 'published'` (all current FAQs are published)
3. For library references (current `libraryRefs` array):
   - Insert into `faq_library_ref` with explicit article IDs
   - Use the pattern-matching logic one final time to resolve existing citations
4. For external resources (current `evidence` array):
   - Insert into `faq_resource` with `title` and `url`
   - These are direct copies -- no resolution needed
5. Insert all records via `wrangler d1 execute`
6. Verify: diff output of old `fetch-faq-data.mjs` (Airtable) vs new `GET /api/faqs` (D1) -- the build output (`faqs.json`) should be identical in structure and content

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
    id TEXT PRIMARY KEY,              -- human-readable slug-style (e.g. 'masterclass-endo-surgery')
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    title TEXT NOT NULL,
    description TEXT,
    short_description TEXT,
    instructors TEXT,                  -- JSON array: [{name, role}]
    image TEXT,                       -- R2 URL (permanent, not Airtable temp)
    image_alt TEXT,
    price_cents INTEGER DEFAULT 0,
    stripe_price_id TEXT,
    is_free INTEGER DEFAULT 0,
    has_certificate INTEGER DEFAULT 0,
    certificate_quiz_id TEXT,         -- step_id of the certificate quiz
    self_paced INTEGER DEFAULT 1,
    coming_soon INTEGER DEFAULT 0,
    is_affiliate INTEGER DEFAULT 0,
    affiliate_url TEXT,
    affiliate_price_cents INTEGER,
    cohort_dates TEXT,                -- JSON array of date strings (for cohort courses)
    participants INTEGER DEFAULT 0,
    access_type TEXT NOT NULL DEFAULT 'public',  -- public | private
    includes TEXT,                    -- JSON array of course slugs included with purchase
    included_in TEXT,                 -- JSON array of course slugs that include this one
    faqs TEXT,                        -- JSON array: [{question, answer}]
    related_courses TEXT,             -- JSON array of course slugs
    settings TEXT,                    -- JSON: {stepOrder, futureStepContent, videoWatchRequirement, autoplayNextVideo}
    seo_title TEXT,
    seo_description TEXT,
    seo_keywords TEXT,
    sort_order INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_course_status ON course(status);

-- Uses 'sections' and 'steps' naming to match existing courses.json and step_progress table
CREATE TABLE IF NOT EXISTS course_section (
    id TEXT PRIMARY KEY,              -- human-readable (e.g. 'mc-intro', 'ltm-1')
    course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_section_course ON course_section(course_id);

CREATE TABLE IF NOT EXISTS course_step (
    id TEXT PRIMARY KEY,              -- human-readable (e.g. 'mc-intro-1', 'ltm-1-1')
    section_id TEXT NOT NULL REFERENCES course_section(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'video',  -- video | article | quiz
    stream_uid TEXT,                  -- CF Stream video UID
    duration INTEGER,                 -- seconds
    sort_order INTEGER DEFAULT 0,
    attachments TEXT                   -- JSON array: [{name, url, size}]
);

CREATE INDEX IF NOT EXISTS idx_step_section ON course_step(section_id);
```

**Design notes:**

- **Course IDs are human-readable strings**, not Airtable `recXXX` IDs. Current values: `masterclass-endo-surgery`, `long-term-endo`, `postpartum`, etc. The `enrollment` and `step_progress` tables already reference these exact strings. New courses should follow the same slug-style naming for consistency.
- **Section/step naming matches `courses.json`** (`sections`/`steps`, not `modules`/`lessons`). This is critical because `_shared.js` references `course.sections` and `step_progress` stores `step_id` values like `mc-intro-1`. Changing the naming would break all existing enrollments and progress.
- **Section and step IDs are human-readable and must be preserved during migration.** Existing IDs (`mc-intro`, `mc-intro-1`, `ltm-1-1`) are referenced in `step_progress`, `quiz_response`, and `lesson_comment` tables. Only post-migration sections/steps may use new-format IDs.
- `instructors` is stored as a JSON TEXT column. Instructor data is display-only (name, role) and doesn't need relational queries.
- `settings` is a JSON TEXT column containing `stepOrder`, `futureStepContent`, `videoWatchRequirement`, `autoplayNextVideo`. These are consumed by `progress.js` and `quiz.js` at runtime.
- `includes`/`included_in` store course slug arrays. `_shared.js` resolves these via `getIncludedCourseIds()`.
- `faqs` stores course-specific FAQ pairs as JSON. These render as FAQPage schema on the course detail page.
- `ON DELETE CASCADE` chains: deleting a course deletes its sections, which deletes their steps.

**Runtime consumption pattern:** `functions/api/courses/_shared.js` imports `courses.json` at module init and builds an in-memory Map. All 7 course API functions (`enroll.js`, `progress.js`, `quiz.js`, etc.) use this Map at runtime. **This pattern continues after migration.** The D1 migration changes the source of truth for generating `courses.json`, not how runtime functions consume it. The JSON is bundled into Pages Functions at deploy time.

### 2.2 API Endpoints

#### Public endpoint (build-time fetch)

**`GET /api/courses`** -- `functions/api/courses/list.js` (named `list.js` to avoid conflict with existing `courses/index.js` directory behavior)

- Auth: Bearer `WORKER_AUTH_TOKEN`
- Query: `?id=masterclass-endo-surgery` for single-record, omit for all published
- Response includes nested sections and steps (3-level join)
- Filters: `status = 'published'` for all-records mode
- Sort: courses by `sort_order`, sections by `sort_order`, steps by `sort_order`
- Includes `status` in all responses

Response shape per course (matches current `courses.json` exactly):

```json
{
  "id": "masterclass-endo-surgery",
  "slug": "masterclass-in-endometriosis-and-surgery",
  "title": "Masterclass in Endometriosis & Surgery",
  "description": "...",
  "shortDescription": "...",
  "image": "/api/assets/courses/masterclass-endo-surgery/cover.jpeg",
  "imageAlt": "...",
  "priceCents": 19900,
  "stripePriceId": "price_1T4SQrAYnsgNHm0HnDTyevzw",
  "isFree": false,
  "hasCertificate": true,
  "certificateQuizId": "mc-feedback-3",
  "selfPaced": true,
  "comingSoon": false,
  "participants": 79,
  "accessType": "public",
  "instructors": [{"name": "Naomi Whittaker, MD", "role": "Lead Instructor"}],
  "includes": ["long-term-endometriosis-management"],
  "settings": {"stepOrder": "fixed", "videoWatchRequirement": 0.9, "autoplayNextVideo": true},
  "seo": {"title": "...", "description": "...", "keywords": ["Endometriosis"]},
  "faqs": [{"question": "Who is this course for?", "answer": "..."}],
  "sections": [
    {
      "id": "mc-intro",
      "title": "Introduction",
      "steps": [
        {
          "id": "mc-intro-1",
          "title": "Introduction",
          "type": "article"
        },
        {
          "id": "mc-intro-2",
          "title": "Let's get started",
          "type": "video",
          "streamUid": "ee5a46eec25475fc8ea7f10d60f1d8b2",
          "duration": 134
        }
      ]
    }
  ]
}
```

**Field mapping note:** The API response preserves the exact field names from current `courses.json` so that `_shared.js`, Astro templates, and schema.org generation work without changes. DB snake_case columns map to camelCase on output (e.g., `price_cents` -> `priceCents`, `stripe_price_id` -> `stripePriceId`). The `seo` object is reconstructed from `seo_title`, `seo_description`, `seo_keywords` columns.

#### Admin endpoints

**`POST /api/admin/courses`** -- create course
**`PUT /api/admin/courses/:id`** -- update course
**`DELETE /api/admin/courses/:id`** -- delete course (cascades to sections/steps)
**`POST /api/admin/courses/:id/sections`** -- add section
**`PUT /api/admin/sections/:id`** -- update section
**`DELETE /api/admin/sections/:id`** -- delete section (cascades to steps)
**`POST /api/admin/sections/:id/steps`** -- add step
**`PUT /api/admin/steps/:id`** -- update step
**`DELETE /api/admin/steps/:id`** -- delete step

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
After:  STUC pipeline -> POST /api/admin/courses/:id/sections, POST /api/admin/sections/:id/steps
```

The pipeline authenticates using an admin session or a dedicated STUC API token (implementation decision for Phase 2).

**Scope note:** The STUC rewrite is larger than just swapping API targets. It also handles CF Stream video upload, chapter parsing, and manifest management. The STUC rewrite should be scoped as its own implementation sub-plan within Phase 2, not treated as a simple find-and-replace.

### 2.5 rrm-cli Integration

Same pattern as FAQs:

1. `sync-remote` calls `GET /api/courses` with Bearer token
2. Maps to local `content` table: `type = 'course'`, `title`, `slug`, `body = description`, `authors = instructors[0].name`
3. Module and lesson data stored in `body` as structured text or in annotations

### 2.6 Migration Script

One-time script: `scripts/migrate-courses-to-d1.mjs`

Data source: current `courses.json` (the git-committed version is the canonical snapshot).

1. For each course:
   - **Preserve existing course ID** as D1 primary key (e.g., `masterclass-endo-surgery`). These are human-readable strings, not Airtable `recXXX` IDs. The `enrollment`, `step_progress`, `quiz_response`, and `lesson_comment` tables already reference these exact strings.
   - Map all fields from `courses.json` to D1 columns (including `priceCents`, `stripePriceId`, `isFree`, `hasCertificate`, `certificateQuizId`, `settings`, `includes`, `faqs`, etc.)
   - Flatten `seo` object into `seo_title`, `seo_description`, `seo_keywords` columns
   - Set `status = 'published'` for all courses (or `'draft'` if `comingSoon = true`)
2. For sections:
   - **Preserve existing section IDs** (e.g., `mc-intro`, `ltm-1`). These are human-readable and referenced in downstream code.
   - Map `title` and derive `sort_order` from array position
3. For steps:
   - **Preserve existing step IDs** (e.g., `mc-intro-1`, `ltm-1-1`). These are referenced in `step_progress`, `quiz_response`, and `lesson_comment` tables.
   - Map `title`, `type`, `streamUid`, `duration`, and derive `sort_order` from array position
4. For file attachments:
   - Verify R2 URLs are already permanent (from prior sync)
   - Store in `attachments` JSON column
5. Insert via `wrangler d1 execute`
6. Verify: the API response produces `courses.json` identical to the pre-migration version

### 2.7 Cleanup

After Phase 2 is deployed and verified:

1. Remove all Airtable base/table ID constants for courses
2. Remove `AIRTABLE_PAT` from CI secrets (no longer needed by any fetch script)
3. Remove `src/lib/airtable-config.mjs` if it only served FAQ/course config
4. Delete old STUC Airtable integration code
5. **Remove `courses.json` from git tracking.** Currently, `deploy.yml` runs `git checkout HEAD -- courses.json` which overwrites any fetched data with the committed version. This must be removed:
   - Remove `courses.json` from the `git checkout HEAD --` line in `deploy.yml`
   - Add `src/data/courses.json` to `.gitignore`
   - Remove the committed file from git (`git rm --cached`)
   - This is a **prerequisite** before enabling single-record dispatch for courses
6. **Update `deploy.yml` fetch-all gate** to exclude `course_id` dispatch payloads (same fix as FAQ `faq_id` exclusion)
7. Update `CLAUDE.md` -- remove Airtable dependency references, update data source table
8. Update `wrangler.toml` if Airtable-specific bindings existed

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
| Enrollment/progress ID mismatch (courses) | Preserve existing human-readable course IDs (`masterclass-endo-surgery`), section IDs (`mc-intro`), and step IDs (`mc-intro-1`) as D1 primary keys. These are referenced by `enrollment`, `step_progress`, `quiz_response`, and `lesson_comment` tables. |
| Build regression | Deploy guard baseline counts catch missing records. Diff `faqs.json` / `courses.json` before and after. |
| STUC pipeline breaks | STUC rewrite is scoped as a sub-plan within Phase 2. Test end-to-end before deploying. |
| Library ref resolution | Migration script resolves existing pattern-matched citations to explicit article IDs. External evidence URLs are direct copies. Manual review of edge cases. |
| Single-record dispatch without articles.json | FAQ fetch script handles missing articles.json gracefully (emits libraryRefs without slug/title). Deploy workflow restores data cache before single-record fetch. |
| courses.json git checkout overwrite | Phase 2 cleanup removes courses.json from git tracking and the `git checkout HEAD --` line before enabling single-record dispatch. |

## Non-Goals

- Admin UI for FAQ/course editing (API-only authoring is sufficient for current scale)
- Airtable decommissioning for non-site data (ledger, surveys, consultants)
- Changes to the article or blog post pipelines (already on D1)

## Template Changes Required

Despite the goal of keeping `faqs.json`/`courses.json` output identical to pre-migration, minor TypeScript interface updates are needed:

- **`src/lib/faq.ts`**: The `FAQ` interface already matches the new API response shape (the spec preserves `faqId`, `evidence`, `libraryRefs`, and title-case categories). No changes needed if the API output matches current `faqs.json` exactly.
- **Course templates**: No changes needed -- the API response preserves the exact `courses.json` field names (`sections`/`steps`, `priceCents`, `stripePriceId`, etc.).

## Diagram

See `docs/publish-path-diagram.html` for visual flow diagrams of current state, Phase 1, Phase 2, and final state.
