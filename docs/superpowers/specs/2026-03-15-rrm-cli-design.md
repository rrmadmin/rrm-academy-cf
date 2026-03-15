# rrm-cli Design Spec

> A CLI knowledge layer for Claude Code agents and human operators, providing fast, intent-aware access to RRM Academy's curated content.

## Problem

RRM Academy's curated content -- 3,200+ research articles, commentary posts, pillar guides, FAQs, and courses -- is the most authoritative RRM knowledge base that exists. But Claude Code agents can't access it during conversations without manually reading large JSON files or scraping the live site. This means agents writing RRM content default to broader internet sources that lack the correct tone, framing, and editorial standards.

The CLI makes RRM Academy data a first-class tool that any Claude Code session can query via Bash.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package name | `rrm-cli` | Clean, unambiguous |
| Command | `rrm-cli` | Matches package name |
| Language | Node.js (ESM) | Consistent with entire RRM stack, npm publish for public release |
| Location | `~/iCode/projects/rrm-cli/` | Own project, eventual public repo |
| Data storage | SQLite via better-sqlite3 + FTS5 | Fast queries, proper full-text search, zero-config |
| DB location | `~/.rrm-cli/rrm.db` | Global, not project-specific |
| Data source | Local JSON files (primary), live Vectorize API (semantic) |
| Output format | JSON (default), `--pretty` for human-readable |
| Guide content | `guides.json` generated in rrm-academy-cf build pipeline | CLI never touches .astro files |
| Release | Private-first, public later | Validate before shipping |

## Content Types

Five content types, all first-class citizens in search and retrieval:

| Type | Source | Record count | Role in agent workflow |
|------|--------|-------------|----------------------|
| `article` | `articles.json` | ~3,200 | What to cite -- research evidence |
| `post` | `posts.json` | ~16 | How to sound -- editorial voice, commentary |
| `faq` | `faqs.json` | ~25 | Citable answers -- structured Q&A for AEO |
| `guide` | `guides.json` | ~3+ (growing) | Voice + framing -- pillar content, authoritative tone |
| `course` | `courses.json` | ~10 | Educational structure -- curriculum, learning paths |

Guides include both `.astro` pillar pages and markdown guides (NeoFertility, FEMM, Glossary, etc.), all extracted to `guides.json` at build time.

## Commands

### Sync

```
rrm-cli sync
```

Ingests local JSON files into SQLite. First run prompts for data directory path if no config exists.

**Sync flow:**
1. Read config (`~/.rrm-cli/config.json`) for data directory path
2. Load each JSON file (`articles.json`, `posts.json`, `faqs.json`, `guides.json`, `courses.json`). Missing files are skipped with a warning (exit 0). `guides.json` missing is expected early on. Other missing files produce warnings like `posts.json not found, skipping`. `sync_failed` only triggers on SQLite write failures or corrupt JSON
3. Validate record counts against existing DB -- refuse to replace if new count drops below 50% of existing (deploy-guard pattern). **Exception:** the count guard is bypassed for any type whose source file is missing (ENOENT) -- a missing file is not the same as a file with zero records
4. Upsert per-type in separate transactions (if courses fail, articles remain safe). Compute `url` during ingest: `articles -> /library/{slug}`, `posts -> /commentary/{slug}`, `faqs -> /faqs/{slug}`, `courses -> /courses/{slug}`, `guides -> use url from JSON (relative path)`
5. Rebuild FTS5 index
6. Generate auto-relationships (see Intelligence Layer). Runs after FTS5 rebuild. Auto-relationship algorithms must NOT use FTS5 queries -- they operate on raw column data
7. Report: counts per type, time elapsed, warnings, skipped types. A sync that successfully processes at least one type exits 0

### Search

```
rrm-cli search "endometriosis diagnosis"
rrm-cli search "excision surgery outcomes" --type=article,post --year=2020: --full
rrm-cli search "what is NaPro" --type=faq,guide --full
rrm-cli search "hormone monitoring" --semantic --full
rrm-cli search "endometriosis" --intent=voice
```

**Full-text search:** FTS5 with BM25 ranking across all content types. Returns top 20 results by default.

**Semantic search** (`--semantic`): Hits live `rrmacademy.org/api/search/semantic?q=` endpoint. Can combine with `--full` to hydrate results from local SQLite. **Hydration join:** Vectorize returns slugs with type prefixes (`post-{slug}`, `faq-{slug}`, `course-{slug}`; articles use raw slug). The CLI strips the prefix and matches against `content.slug` + `content.type`. Vectorize type values also differ: `Research` = CLI `article`, `Article` = CLI `post`. **Rate limiting:** Server-side 20 req/min per IP (shared with website users). The CLI implements client-side throttling at 10 req/min with exponential backoff on 429 responses, leaving headroom for website users. **Degradation:** If the endpoint is unreachable, returns non-200, or rate-limits, the CLI falls back to FTS5-only results and includes a warning in the `warnings` array: `semantic_unavailable`. Exit code remains 0.

**Intent-aware boosting** (`--intent`): Applies type-weight multipliers to search ranking:

| Intent | Boost order | Use case |
|--------|------------|----------|
| `cite` | articles >> faqs > posts > guides | Agent needs research evidence |
| `voice` | guides > posts > faqs >> articles | Agent needs tone/framing reference |
| `educate` | guides > courses > faqs > posts | Agent building educational content |
| (none) | Equal weight across all types | General search |

Intent boosting is SQL-level weight multiplication on BM25 scores, not AI inference.

**Filters:**
- `--type=article,faq` -- filter by content type(s). Always singular names matching the `type` column
- `--year=2024` -- exact year; `--year=2020:` -- 2020 onward; `--year=2020:2023` -- range
- `--open-access` -- open-access articles only
- `--topic="Endometriosis"` -- topic substring match
- `--domain="Surgery"` -- AI-classified domain
- `--category="Conditions"` -- FAQ category filter. Implicitly limits results to type=faq unless combined with `--type`
- `--limit=N` -- max results (default 20)
- `--full` -- include full content (abstract, body, answers)

**Query sanitization:** User queries are sanitized before FTS5 MATCH: double quotes are balanced or stripped, FTS5 operators (AND/OR/NOT/NEAR) in user input are treated as literals by quoting, and column-prefix syntax (`column:term`) is stripped. Query length capped at 1,000 characters for local FTS5. The `--semantic` path inherits the server's 500-character limit.

**Query logging:** The `search` command automatically logs query text, types, intent, and **total FTS5 match count** (ignoring LIMIT clause) to `query_log`. This prevents false gap signals when agents use `--limit`.

### Get

```
rrm-cli get article <slug>
rrm-cli get article <slug> --full
rrm-cli get faq <slug> --full
rrm-cli get guide <slug> --full
```

Direct retrieval by type + slug. Compact metadata by default, `--full` for complete content. If no record matches the given type + slug, returns `not_found` error (exit 1).

**Compact output** (default): type, slug, url, title, authors, year, journal, date_published, short_citation
**Full output** (`--full`): adds abstract, body/content, citations (APA/Vancouver/MLA), topics, search_terms, AI classifications, sections, all type-specific fields. JSON array fields (`topics`, `search_terms`, `sections`) are parsed from their SQLite string storage and returned as native JSON arrays, not double-encoded strings.

### List

```
rrm-cli list article --topic="Endometriosis" --open-access --year=2023: --limit=50
rrm-cli list post
rrm-cli list faq --category="Conditions"
rrm-cli list guide
```

Browse/filter without a search query. Takes an optional positional type argument (singular, matching `--type` convention). Supports: `--type`, `--year`, `--open-access`, `--topic`, `--domain`, `--category`, `--limit`, `--full`. Does NOT support `--semantic` or `--intent` (those require a query). Returns compact format by default.

### Related

```
rrm-cli related <type> <slug>
rrm-cli related guide what-is-rrm --type=article --depth=2
```

Traverses the relationship graph to find connected content. Requires type + slug (consistent with `get` and `annotate`) to avoid ambiguity since slugs are not globally unique. Default: 1-hop traversal, max 50 results. `--depth=N` for deeper traversal (capped at 3). `--type=article,post` filters result types (traversal still follows all edges but only returns matching types). **Cycle detection:** maintains a visited set during traversal -- already-visited nodes are skipped to prevent infinite loops in bidirectional relationships.

### Status

```
rrm-cli status
```

Reports: record counts per type, last sync time, file modification dates vs DB (staleness warning), relationship count, annotation count, top gap signals.

### Gaps

```
rrm-cli gaps
```

Surfaces topics with high search frequency but low result counts or frequent external fallback. Derived from `query_log`. Gap detection works from automatic data (query text, total match count, intent) logged by the `search` command itself. The `gap_signal` and `used_results` fields are reserved columns for a future `log-usage` command (v2) -- gap analysis in v1 works without them, using only auto-logged data.

### Annotate

```
rrm-cli annotate <type> <slug> --key=used_for --value="endo blog post draft"
rrm-cli annotate article <slug> --key=voice_quality --value=4
```

Adds metadata to content. Requires both type and slug to avoid ambiguity (slugs are not globally unique). Returns `not_found` (exit 1) if the type+slug doesn't resolve. Used by agents during workflows or by Brian manually.

### Learn

```
rrm-cli learn <type>:<slug> --relates-to=<type>:<slug> --relation=supports --context="Both cover excision outcomes"
```

Adds a relationship between two pieces of content. Uses `type:slug` format to avoid ambiguity (e.g., `article:endometriosis-excision-outcomes`). Returns `not_found` (exit 1) if either reference doesn't resolve. Builds the knowledge graph over time.

## Data Model

### SQLite Schema

```sql
-- All content types in one table, nullable columns for type-specific fields
CREATE TABLE content (
  rowid INTEGER PRIMARY KEY,    -- stable integer PK for FTS5 content sync
  id TEXT NOT NULL UNIQUE,      -- Airtable record ID or guide-{slug} for guides
  type TEXT NOT NULL,           -- article | post | faq | guide | course
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,                     -- full rrmacademy.org URL

  -- Compact fields (returned by default)
  authors TEXT,                 -- articles (also maps post.author -> authors)
  year INTEGER,                 -- articles
  journal TEXT,                 -- articles
  journal_abbv TEXT,            -- articles
  category TEXT,                -- faqs
  content_pillar TEXT,          -- posts
  excerpt TEXT,                 -- posts
  word_count INTEGER,           -- posts
  short_citation TEXT,          -- articles (e.g. "Schliep KC et al., 2026")

  -- Full fields (returned with --full)
  abstract TEXT,                -- articles
  body TEXT,                    -- posts (HTML), guides (prose), faqs (publishedAnswer)
  basic_answer TEXT,            -- faqs
  schema_answer TEXT,           -- faqs
  apa_citation TEXT,            -- articles
  vancouver_citation TEXT,      -- articles
  mla_citation TEXT,            -- articles
  source_url TEXT,              -- articles (publisher link)
  sections TEXT,                -- courses (JSON), guides (JSON array of {id, heading, content, order})

  -- Metadata
  topics TEXT,                  -- JSON array
  search_terms TEXT,            -- JSON array
  domain TEXT,                  -- AI classification
  sentiment TEXT,               -- AI classification
  rrm_relevance TEXT,           -- AI classification
  is_open_access INTEGER,       -- boolean (articles)
  doi TEXT,                     -- articles
  pmid TEXT,                    -- articles
  date_published TEXT,
  last_synced TEXT
);

CREATE UNIQUE INDEX idx_content_type_slug ON content(type, slug);
CREATE INDEX idx_content_type ON content(type);
CREATE INDEX idx_content_year ON content(year);

-- FTS5 stores its own content (no external content table).
-- Simpler, avoids rowid sync footguns. ~6MB text storage cost is negligible.
CREATE VIRTUAL TABLE content_fts USING fts5(
  id UNINDEXED,                -- stored for join-back, NOT searchable (prevents guide-{slug} matching "guide")
  title, authors, abstract, body, topics, search_terms, domain, category
);
```

**FTS5 sync:** After each upsert batch, delete all rows from `content_fts` and re-insert from `content`. FTS5 is self-contained (no external content table) to avoid rowid instability during delete/re-insert cycles. The 6MB text duplication is negligible.

**Guide IDs:** Use the convention `guide-{slug}` (e.g., `guide-naprotechnology`). This matches the existing `extract-guides.mjs` output. Hyphen separator, no collision with Airtable `rec*` IDs.

**Null handling:** Null/undefined values from JSON are stored as NULL in SQLite. Empty strings are normalized to NULL during ingest for consistency (e.g., `pmid: ""` becomes NULL). FTS5 columns with NULL values are indexed as empty.

**JSON array normalization:** Fields stored as JSON text in SQLite (`topics`, `search_terms`, `sections`) must be parsed back to native arrays before JSON output. Post `seoKeywords` (comma-separated string) is split on commas, trimmed, and stored as a JSON array to match article `searchTerms` format.

**URL computation:** The `url` column is derived during ingest, not read from JSON (except guides, which have a relative URL in the source): articles = `/library/{slug}`, posts = `/commentary/{slug}`, faqs = `/faqs/{slug}`, courses = `/courses/{slug}`, guides = `url` from JSON (relative path like `/what-is-rrm/`).

**Airtable record IDs:** The `id` column stores internal identifiers (`rec*` for Airtable, `guide-{slug}` for guides). CLI output uses `slug` as the public identifier. The `id` field is excluded from default JSON output but available with `--include-id` for debugging. Relationships and annotations reference content internally by `id` but the user-facing interface uses `type:slug`.

### Intelligence Layer

```sql
-- Relationships between content (auto-generated + agent-added)
CREATE TABLE relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,        -- supports, contradicts, extends, cites, same_topic, references
  confidence REAL DEFAULT 1.0,   -- 0-1
  discovered_by TEXT NOT NULL,   -- auto, agent, manual
  context TEXT,                  -- why this relationship exists
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES content(id),
  FOREIGN KEY (target_id) REFERENCES content(id)
);

CREATE INDEX idx_rel_source ON relationships(source_id);
CREATE INDEX idx_rel_target ON relationships(target_id);

-- Agent and human annotations on content
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL,
  key TEXT NOT NULL,              -- structured vocabulary (see below)
  value TEXT NOT NULL,
  source TEXT,                   -- which agent/session/user
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (content_id) REFERENCES content(id)
);

CREATE INDEX idx_ann_content ON annotations(content_id);
CREATE INDEX idx_ann_key ON annotations(key);

-- Query log for gap detection (opt-in, default on for local install)
CREATE TABLE query_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  types TEXT,                    -- which types were searched
  intent TEXT,                   -- cite, voice, educate, or null
  result_count INTEGER,
  used_results TEXT,             -- JSON array of IDs the agent referenced
  gap_signal INTEGER DEFAULT 0,  -- 1 if agent went to external sources
  session_context TEXT,          -- what task was being performed
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Annotation Vocabulary

Structured keys for queryable annotations. Agents can add custom keys, but these enable structured queries.

| Key | Value type | Example | Query use |
|-----|-----------|---------|-----------|
| `used_for` | text | "endo blog post draft" | Find content by usage history |
| `voice_quality` | 1-5 | "4" | Filter for good framing reference |
| `citation_quality` | 1-5 | "5" | Filter for strong evidence |
| `gap_note` | text | "no patient-facing framing" | Surface content deficiencies |
| `summary` | text | agent-generated one-liner | Quick content preview |
| `stale` | boolean | "true" | Flag content needing refresh |

### Auto-Relationships (Generated on Sync)

During `rrm-cli sync`, the CLI auto-generates baseline relationships. Auto-relationships are cleared and regenerated on each sync (`discovered_by='auto'`). Agent/manual relationships are preserved.

| Condition | Algorithm | Relation type | Confidence |
|-----------|-----------|--------------|------------|
| Two articles share 2+ root-level topics | Parse `topics` JSON arrays, extract root category (first segment before ` > `), compute set intersection on roots, threshold >= 2. **Cap:** max 25 auto-relationships per article to prevent O(N^2) explosion on broad categories | `same_topic` | 0.6 |
| FAQ `libraryRefs` points to an article | Parse `libraryRefs` object array (each entry has `{author, shortCitation, slug, title, year}`), match each entry's `slug` against article `slug` | `cites` | 1.0 |
| Post and article share 2+ search terms | Parse post `search_terms` (normalized from `seoKeywords`) and article `search_terms`, compute case-insensitive token overlap, threshold >= 2 | `same_topic` | 0.7 |
| Guide and FAQ share 3+ non-stopword tokens | Tokenize guide section headings and FAQ questions, intersect after stopword removal, threshold >= 3 | `extends` | 0.5 |

Agent-added relationships (`rrm-cli learn`) default to confidence 1.0 and `discovered_by='agent'`. These refine and extend the auto-generated graph.

## Field Mapping (JSON -> SQLite)

Each content type uses different field names in its JSON source. The ingest layer normalizes these into the unified schema.

### articles.json

| JSON field | SQLite column | Notes |
|-----------|---------------|-------|
| `id` | `id` | Airtable record ID |
| `slug` | `slug` | |
| `title` | `title` | |
| `authors` | `authors` | String |
| `year` | `year` | Integer |
| `journal` | `journal` | |
| `journalAbbv` | `journal_abbv` | |
| `abstract` | `abstract` | |
| `shortCitation` | `short_citation` | e.g. "Schliep KC et al., 2026" |
| `apaCitation` | `apa_citation` | |
| `vancouverCitation` | `vancouver_citation` | |
| `mlaCitation` | `mla_citation` | |
| `sourceUrl` | `source_url` | Publisher link |
| `doi` | `doi` | |
| `pmid` | `pmid` | |
| `datePublished` | `date_published` | |
| `topics` | `topics` | JSON array |
| `searchTerms` | `search_terms` | JSON array |
| `domain` | `domain` | AI classification |
| `sentiment` | `sentiment` | AI classification |
| `rrmRelevance` | `rrm_relevance` | AI classification |
| `isOpenAccess` | `is_open_access` | Boolean -> 0/1 |
| `identifiers` | (not stored) | Redundant with `is_open_access` |
| `volume` | (not stored) | Bibliographic detail -- add later if citation formatting needed |
| `issue` | (not stored) | Bibliographic detail |
| `pages` | (not stored) | Bibliographic detail |
| `keywords` | (not stored) | Present in ~54% of articles. `searchTerms` covers search; add if needed |
| `accessLevel` | (not stored) | Redundant with `is_open_access` |
| `oaType` | (not stored) | OA classification detail |
| `oaUrl` | (not stored) | OA link |
| `license` | (not stored) | License type |
| `isCopyrighted` | (not stored) | Inverse of isOpenAccess |
| `enrichmentStatus` | (not stored) | Pipeline metadata, not useful for search |
| `lastModified` | (not stored) | Pipeline metadata. Staleness detection uses file mtime |

### posts.json

| JSON field | SQLite column | Notes |
|-----------|---------------|-------|
| `id` | `id` | |
| `slug` | `slug` | |
| `title` | `title` | |
| `author` | `authors` | Singular -> plural column |
| `content` | `body` | HTML |
| `excerpt` | `excerpt` | |
| `wordCount` | `word_count` | |
| `contentPillar` | `content_pillar` | |
| `publishDate` | `date_published` | Different name than articles |
| `seoKeywords` | `search_terms` | Comma-separated string -> split, trim, store as JSON array to match article format |
| `coverImageUrl` | (not stored) | CLI doesn't need images |

### faqs.json

| JSON field | SQLite column | Notes |
|-----------|---------------|-------|
| `id` | `id` | |
| `slug` | `slug` | |
| `question` | `title` | Question becomes the title |
| `publishedAnswer` | `body` | Full answer HTML |
| `basicAnswer` | `basic_answer` | Hub-level answer |
| `schemaAnswer` | `schema_answer` | JSON-LD answer |
| `category` | `category` | |
| `libraryRefs` | (used for auto-relationships, not stored as column) | Array of `{author, shortCitation, slug, title, year}` objects |
| `evidence` | (not stored) | Array of `{title, url}` external references. Consider adding later |
| `faqId` | (not stored) | Internal FAQ identifier (e.g., "F01") |
| `seoTitle` | (not stored) | SEO override title |
| `seoDescription` | (not stored) | SEO meta description |
| `sortOrder` | (not stored) | Canonical FAQ ordering. Consider adding later |

### guides.json (generated by `scripts/extract-guides.mjs`)

| JSON field | SQLite column | Notes |
|-----------|---------------|-------|
| `id` | `id` | Already `guide-{slug}` format from extract script |
| `type` | `type` | Already `"guide"` from extract script |
| `slug` | `slug` | |
| `title` | `title` | |
| `body` | `body` | Extracted prose (concatenated section content). Use directly from JSON |
| `sections` | `sections` | JSON array of `{id, heading, content, order}` |
| `url` | `url` | Relative path (e.g., `/what-is-rrm/`) |
| `date_extracted` | `date_published` | Extraction timestamp, not original publication date |

### courses.json

| JSON field | SQLite column | Notes |
|-----------|---------------|-------|
| `id` | `id` | |
| `slug` | `slug` | |
| `title` | `title` | |
| `description` | `body` | Course description |
| `sections` | `sections` | JSON blob (curriculum structure) |
| `instructors` | `authors` | Array of `{name, role}` objects -> extract `name` values, join with `, ` |

## Error Output

All commands follow a consistent error contract:

- **Success:** Exit code 0. JSON results to stdout.
- **Error:** Exit code 1. JSON `{ "error": "code", "message": "human-readable description" }` to stderr. `--pretty` mode also prints errors to stderr as plain text. Stdout is exclusively for successful results (Unix convention).
- **Warnings** (e.g., stale data, missing guides.json, semantic_unavailable): Exit code 0. Warnings included in JSON output as `{ "warnings": [...], "results": [...] }`.
- **Empty DB guard:** Commands other than `sync`, `status`, and `config` check whether the `content` table has any rows. If empty or the DB doesn't exist, they exit with `no_db` and message `No data found. Run rrm-cli sync first.` Schema creation only runs during `sync`, not on read commands.
- **Error output never includes raw `dataDir` paths.** Use `~/...` relative notation in user-facing output.

Error codes: `no_config`, `no_db`, `sync_failed`, `count_guard`, `not_found`, `network_error`, `invalid_args`.

**Output shape (all list-returning commands):**
```json
{
  "results": [{ "type": "article", "slug": "...", "title": "...", "score": 12.5 }],
  "total": 42,
  "query": "endometriosis diagnosis",
  "intent": "cite",
  "warnings": []
}
```
`search`, `list`, `related`, and `gaps` all use this wrapper. `get` returns a single object (not wrapped in `results` array).

## Schema Migrations

The DB uses `PRAGMA user_version` to track schema version. On startup, every command checks the version and runs migrations if needed.

```
user_version 0 -> 1: Initial schema (content, content_fts, relationships, annotations, query_log)
user_version 1 -> 2: (future changes)
```

Migration logic lives in `src/db/schema.js`. Each migration is a function that runs in a transaction. Forward-only (no rollback).

**`rrm-cli sync --reset`:** Drops and recreates `content` and `content_fts` tables only. Intelligence tables (`relationships`, `annotations`, `query_log`) are preserved. A separate `rrm-cli sync --factory-reset` drops everything (with confirmation prompt: `This will delete N agent relationships, M annotations, and K query log entries. Continue? [y/N]`).

## Configuration

**Config file:** `~/.rrm-cli/config.json`

```json
{
  "dataDir": "/Users/brian/iCode/projects/rrm-academy-cf/src/data",
  "siteUrl": "https://rrmacademy.org",
  "dbPath": "~/.rrm-cli/rrm.db",
  "queryLogging": true
}
```

**First run:** `rrm-cli sync` with no config prompts for the data directory path. Writes config and proceeds with sync.

**Public release consideration:** Future `rrm-cli sync --remote` mode that fetches from live site for users without the repo. Not in scope for v1.

## Project Structure

```
~/iCode/projects/rrm-cli/
├── bin/
│   └── rrm-cli.js              # Entry point (#!/usr/bin/env node)
├── src/
│   ├── commands/
│   │   ├── sync.js             # Ingest JSON -> SQLite + auto-relationships
│   │   ├── search.js           # FTS5 + semantic + intent boosting
│   │   ├── get.js              # Direct retrieval by slug
│   │   ├── list.js             # Filtered browsing
│   │   ├── related.js          # Relationship graph traversal
│   │   ├── status.js           # DB stats, freshness, gap summary
│   │   ├── gaps.js             # Gap analysis from query_log
│   │   ├── annotate.js         # Add annotations
│   │   └── learn.js            # Add relationships
│   ├── db/
│   │   ├── schema.js           # Table + FTS5 + intelligence layer creation
│   │   ├── ingest.js           # JSON -> SQLite upsert with count guards
│   │   ├── query.js            # Search/filter/intent query builders
│   │   └── relationships.js    # Auto-relationship generation logic
│   ├── output/
│   │   ├── json.js             # JSON formatter (default)
│   │   └── pretty.js           # Human-readable tables/cards
│   └── config.js               # Config read/write/init
├── package.json
├── CLAUDE.md
└── README.md
```

**Dependencies:**
- `better-sqlite3` -- SQLite with FTS5 support
- `commander` -- CLI argument parsing

No build step. Plain ESM. `npm link` for immediate PATH availability.

## External Dependency: guides.json

**Status:** Exists. `scripts/extract-guides.mjs` generates `src/data/guides.json` (gitignored). Currently extracts 3 Astro pillar guides (what-is-rrm, naprotechnology, common-questions-about-rrm). No markdown guides extracted yet (NeoFertility, FEMM, Glossary are planned).

**Regenerate:** `node scripts/extract-guides.mjs` from the `rrm-academy-cf` directory.

**Record shape:** Each guide has `{id, type, slug, title, url, sections[], body, date_extracted}`. Sections use `{id, heading, content, order}`. The `body` field contains the concatenated prose from all sections. Use `body` directly for the SQLite `body` column and FTS5 indexing.

**The CLI treats `guides.json` as optional** -- if missing, guides are simply not indexed, and `rrm-cli status` warns about it. Note: `courses.json` is committed to git (not gitignored), unlike the other data files which are fetched at build time.

## Query Logging and Privacy

Query logging (`query_log` table) is on by default for Brian's local install. For eventual public release:

- Default off (`"queryLogging": false` in config)
- Opt-in via `"queryLogging": true` or `rrm-cli config set queryLogging true`
- No data ever leaves the local SQLite database
- `rrm-cli gaps` requires logging to be enabled
- **Retention:** `rrm-cli log purge --before=DATE` clears old entries. Default retention: 90 days. `rrm-cli status` reports query_log row count and oldest entry date
- For public release, `config.json` should be in a `.gitignore` template. First-run setup notes that the file contains local paths

## How Claude Code Agents Use This

A typical agent workflow when writing RRM content:

1. **Research phase:** `rrm-cli search "endometriosis excision" --intent=cite --full` -- get research evidence
2. **Voice phase:** `rrm-cli search "endometriosis" --intent=voice --full` -- get tone/framing from guides and posts
3. **Specific lookup:** `rrm-cli get faq endometriosis-treatment --full` -- get the canonical FAQ answer
4. **Cross-references:** `rrm-cli related endometriosis-excision-outcomes --type=article` -- find related articles
5. **After writing:** `rrm-cli annotate article <slug> --key=used_for --value="endo blog post"` -- log usage
6. **Gap reporting:** `rrm-cli gaps` -- surface what's missing

CLAUDE.md instructions for agents should include guidance to consult `rrm-cli` before using external sources for RRM-related content.

**Relationship to other search systems:** Pagefind serves website visitors (client-side browser search). The CLI serves agents and operators (local SQLite, richer filters, intent boosting, intelligence layer). No overlap in use case.

## Body Field Content Types

The `body` column stores different content formats depending on type:

| Type | Format | Notes |
|------|--------|-------|
| `article` | (null) | Articles use `abstract`, not `body` |
| `post` | HTML | Raw HTML from Airtable Content field |
| `faq` | HTML | `publishedAnswer` from Airtable |
| `guide` | Plain text | Extracted prose, stripped of components |
| `course` | Plain text | Course description |

`--full` output includes the raw format. A future `--strip-html` flag could strip tags for cleaner agent consumption, but is not in v1 scope.

## Future Considerations (Not in v1)

- `rrm-cli sync --remote` -- fetch from live site for users without the repo
- npm publish as `rrm-cli` package
- Auto-sync on stale detection (background process)
- Agent-generated summaries stored as annotations
- Export graph as visualization (DOT/Mermaid)
- `--strip-html` flag for cleaner body output
- `rrm-cli log-usage` command for agents to report which results they used and whether they fell back to external sources (populates `used_results` and `gap_signal` in query_log)
- Integration with Rose bot pipeline (e.g., `rrm-cli list article --year=2026: --no-abstract` to find recently added articles missing enrichment)
- Dedicated semantic search endpoint for CLI (separate rate limit budget from website users)
