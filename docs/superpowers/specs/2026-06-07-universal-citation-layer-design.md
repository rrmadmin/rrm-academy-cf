# Universal Citation Layer — Design

Date: 2026-06-07
Status: DRAFT for Brian review (brainstorming output; not yet planned or built)
Spans: rrm-academy-cf (surfaces + guards), rrm-library-worker + rrm-cli (the registry), rrm-observatory (the health daemon)

## 1. Problem

Citations on RRM Academy are verified over and over, per surface, against external APIs, with no shared identity. The same paper cited in a glossary entry, an FAQ, a commentary post, and a pillar page is four unrelated records, and at least two surfaces re-verify it against NCBI/CrossRef on a recurring basis:

- The `glossary-citation-verify` daemon re-derives a PMID/DOI from each glossary URL and re-checks it live against NCBI/CrossRef on an 8-week rotating cycle. This is the source of the 429 / bot-wall / false-"hallucinated" noise that motivated this work.
- `scripts/verify-citations.mjs` runs a 4-API cascade (NCBI, CrossRef, Europe PMC, Semantic Scholar) over inline PMIDs/DOIs in `posts.content` on every deploy.

The core defect: there is no single canonical, verified-once store that every surface cites by a stable id. So verification cannot be amortized, citations cannot be de-duplicated, and a hallucinated citation in agent-authored content has no structural barrier stopping it from shipping.

The fix is to make the library the single source of truth for verified citations, give every citable source one stable `source_id`, verify once at ingest, and force every surface to cite by `source_id` through enforced guards. Verify once, cite everywhere, re-check link-rot centrally.

## 2. Current state (inventory, 2026-06-07)

| Surface | Storage today | Linked to library? | Re-verifies externally? |
|---|---|---|---|
| Glossary | `glossary_reference` (id, ref_num UNIQUE, anchor_text, url, publisher, journal, created_at) in rrm-auth. Footnote numbers in term `body_html`. | No | Yes (the daemon, 8-week cycle) |
| Commentary | Inline markdown/HTML in `posts.content` (rrm-auth). No structured citation store. | No | Yes (`verify-citations.mjs` at every deploy) |
| FAQ | `faq_library_ref` (faq_id, **article_id**, label, sort_order) + `faq_resource` (faq_id, title, url, sort_order) in rrm-auth. | **Partially — `faq_library_ref.article_id` already cites library articles** | No |
| Pillars | Hardcoded JSON-LD `citeStub()` tuples (title/author/year/journal, no PMID/DOI) in `.astro` frontmatter via `buildScholarlyArticleStub()` (`src/lib/identity.ts`). SEO-only, head not body. | No | No |
| Library | `articles` (id, pmid UNIQUE, doi UNIQUE NOCASE, slug, short/apa/vancouver/mla_citation, **content_hash**, **metadata_verified_at**, status) in rrm-library. Sparse `relationships` graph (incl. 'cites'). | n/a (is the corpus) | At ingest (enrichment pipeline) |

Two findings shape the design:
1. **FAQ already proves cite-by-id.** `faq_library_ref` is a working many-to-many from a surface to library `article_id`. It lacks non-article sources, a verified-once stamp, and link-health, but the shape is correct. The universal layer generalizes it.
2. **No `sources` table and no `cite` endpoint exist.** The library stores citations as denormalized strings on `articles` (apa/vancouver/mla/short) plus `content_hash` + `metadata_verified_at`. There is no canonical registry of non-article sources and no find-or-ingest-by-citation route. Both are net-new.

## 3. Goals / Non-goals

Goals:
- One canonical `sources` registry in the library; every citable thing has a stable `source_id`.
- Verify once at ingest; never re-verify existence on a recurring cycle.
- Every surface cites by `source_id`, enforced so agents cannot bypass it.
- One centralized link-rot signal shared by all surfaces.
- De-duplication: the same paper is one source row, cited from N surfaces.

Non-goals (YAGNI):
- No cryptographic proof-of-work. The threat is hallucinated citations and link rot, not a malicious forger. `content_hash` (already in the schema) is the only crypto needed: a tamper-evident diff to detect metadata drift.
- No dynamic render-from-library rewrite of how pillars/commentary are authored. Citations stay inline-authored; the win is registration + enforcement, not dynamic rendering.
- No change to how the research corpus itself is classified or counted (the `articles` table stays research-only).

## 4. Architecture

### 4.1 The sources registry (the spine)

A new `sources` table in rrm-library D1 (sibling to `articles`, not folded into it — `articles` is load-bearing for the 3000-article CI floor, classification, and facts extraction; mixing org pages in would corrupt those).

Proposed shape (final columns pinned during planning):
```
sources (
  source_id        TEXT PRIMARY KEY,              -- stable, e.g. 'src_' + ULID
  type             TEXT NOT NULL CHECK(type IN ('article','guideline','org','book','dataset','other')),
  article_id       TEXT,                           -- FK -> articles.id when type='article' (in-DB), else NULL
  pmid             TEXT,                            -- when applicable
  doi              TEXT,                            -- when applicable
  canonical_url    TEXT,                            -- the cite target
  canonical_title  TEXT,
  canonical_authors TEXT,
  journal          TEXT,
  year             TEXT,
  short_citation   TEXT, apa_citation TEXT, vancouver_citation TEXT, mla_citation TEXT,
  content_hash     TEXT,                            -- SHA-256, tamper-evident drift detector
  verify_status    TEXT NOT NULL CHECK(verify_status IN ('verified','pending','needs_review','retracted','dead')),
  metadata_verified_at TEXT,                        -- ISO8601, set once at verify
  link_last_checked TEXT, link_http_status INTEGER, link_title_overlap REAL,  -- the one shared link_health block
  created_at TEXT, updated_at TEXT
)
-- UNIQUE(pmid) WHERE pmid IS NOT NULL; UNIQUE(doi COLLATE NOCASE) WHERE doi IS NOT NULL;
-- article-type rows reuse the verified articles row (article_id) for metadata + content_hash.
```

A source is `verified` once (PMID/DOI resolved at ingest, or org URL liveness+title confirmed). Thereafter consumers trust the id; only `link_*` fields refresh.

### 4.2 The cite affordance (the carrot)

A new `POST /cite` endpoint on rrm-library-worker (the path of least resistance that makes compliance painless):

```
POST /cite  { identifier: "<PMID|DOI|URL>", anchorText?: "..." }  ->  { source_id, verify_status }
```
- PMID/DOI that matches an existing published article -> ensure a `type='article'` source row linked to that `article_id` -> return `source_id` (`verified`).
- New PMID/DOI -> call existing `/ingest` (article enters `intake`), create a `pending` source -> return `source_id`. It becomes `verified` when the enrichment pipeline resolves it (existing path; no new verification logic).
- Bare URL, no identifier -> find-or-create a non-article source (liveness + title check at creation). New org/guideline sources land `needs_review` for a one-time human confirm; known ones return `verified`.

This is the only new verification surface, and it reuses `/ingest` + enrichment rather than re-implementing existence checks. Agents get a source_id back in one call.

### 4.3 Per-surface consumer model

- **Glossary** (slice 1): add `source_id` to `glossary_reference` (NOT NULL after backfill). `anchor_text` + `ref_num` stay for display/footnote numbering; `url`/`publisher`/`journal` become a display cache populated from the source row (or drop and read through). The glossary write/admin path validates `source_id` against the library before INSERT.
- **FAQ** (slice 2): generalize `faq_library_ref.article_id` -> `source_id` and fold `faq_resource` (external URLs) into `sources` (type='org'|'guideline') referenced by the same link table. FAQ ends with one citation-link table against `sources`, replacing two divergent ones. This is the smallest migration because the shape already exists.
- **Commentary** (slice 2): keep inline-authored citations in `posts.content`, but every inline PMID/DOI/URL must resolve to a `source_id` via `cite`, recorded in a new `post_source_ref` (post_id, source_id) link table at publish. `verify-citations.mjs` evolves from "re-verify against 4 APIs every deploy" into "resolve-or-ingest each inline citation to a source_id, fail if any cannot resolve." External liveness moves to the central daemon.
- **Pillars** (slice 3): citation `source_id`s live in a sidecar (`src/data/<pillar>-citations.json`) or frontmatter; `buildScholarlyArticleStub()` renders the JSON-LD from the resolved source instead of a hand-typed tuple. The lint hook + CI gate validate every referenced `source_id`. Tuple-to-source backfill (no PMID/DOI today) is the messiest, hence last.

### 4.4 The source-health daemon (collapse, not a new daemon)

`glossary-citation-verify` generalizes into one **source-health** daemon over the registry:
1. Internal integrity: every surface `source_id` resolves to a `verified` (non-retracted) source. Cheap D1 join, never rate-limits.
2. Link-rot: HEAD + title re-check on registry URLs, writing the shared `link_*` fields. One check per source, not one per (source x surface).
3. Retraction watch: existing `metadata_verified_at` retraction scan stays on the article rows.
External existence verification (NCBI/CrossRef) happens only at ingest via `cite`/`/ingest`, never on a recurring cycle. The 8-week API pounding ends.

## 5. Enforcement stack (tiered; load-bearing first)

1. **Structural (cannot be routed around).** DB-backed surfaces get `NOT NULL source_id`; the raw-URL-only slot is removed. No place to store an unregistered citation.
2. **Write-layer validation (logical cross-DB FK).** D1 does not enforce FKs across databases (sources in rrm-library, consumers in rrm-auth). The write endpoints validate `source_id` resolves to a `verified`/`published` source via the library service binding before INSERT.
3. **The affordance (`POST /cite`).** Makes the compliant path the fastest path. Without it, every gate below is a fight.
4. **Pre-commit hook (`lint-citations`).** For static surfaces with no write endpoint (pillars, commentary `.md`). Same shape + `*_DISABLE=1` bypass as the existing `hooks/pre-commit` chain; blocks a commit that introduces a raw PMID/DOI/citation-URL literal not expressed as a `source_id`.
5. **CI / deploy gate.** A new `scripts/gates/validate-citation-layer.mjs`, same pattern as the record floors, fails the deploy if any citation on any surface lacks a resolvable, verified `source_id`. Subsumes `verify-citations.mjs`'s gating role (resolve-not-reverify).
6. **Skill rules (necessary, not sufficient).** pillar-create, glossary-update, rrm-commentary each carry "cite by source_id, never raw," backed by 1-5, never relied on alone.

Per the drop-fragile-defense-in-depth rule: the load-bearing pair is **1 (no slot for raw) + 3 (easy compliant path)**. Items 4-5 are the catch-net for static surfaces. If 1+3 prove airtight, 4-5 stay lightweight rather than growing into fragile parsers.

## 6. Migration / backfill

Per slice, a one-time backfill that, for each existing citation, matches PMID/DOI/URL to a library article (link), ingests missing research papers via `cite`, and creates non-article source rows for org pages, flagging unmatchable ones `needs_review` for human confirm. Old columns are kept until the slice is verified live, then dropped (no big-bang). Glossary's ~157 refs are slice 1's backfill set (quantify the article-vs-org split during planning).

## 7. Build slices (sequence)

- **Slice 0 — spine.** `sources` table (rrm-cli schema + remote migration), `POST /cite` endpoint, library-side verify/health fields. Nothing consumes it yet.
- **Slice 1 — glossary.** Migrate `glossary_reference` to `source_id` (NOT NULL + write validation), backfill 157 refs, repoint the daemon to internal-integrity + central link-health, land `lint-citations` + the CI gate end to end. Proves the entire stack including non-article org pages (e.g. IIRRM "What is RRM"). This is where the pain and the daemon already live.
- **Slice 2 — FAQ + commentary.** FAQ: `faq_library_ref.article_id` -> `source_id`, fold `faq_resource` into `sources`. Commentary: `post_source_ref` + evolve `verify-citations.mjs` to resolve-or-ingest.
- **Slice 3 — pillars.** Sidecar `source_id`s + render JSON-LD from sources + tuple backfill (human review of unmatched).

Each slice ships behind the brian-agent gate (behavior-changing, touches live alerting + deploy gates). Cross-DB writes follow the existing dirty-clone / worktree shipping discipline.

## 8. Risks / open questions

- **Cross-DB referential integrity.** No enforced FK between rrm-auth consumers and rrm-library `sources`. Mitigated by write-layer validation (tier 2) + the CI gate (tier 5) + the daemon's internal-integrity check. Accept eventual-consistency: a source deleted in the library shows as a daemon integrity finding, not a hard FK error.
- **Org-source verification is weaker than PMID/DOI.** No authoritative existence oracle for an org page. Mitigate: one-time human confirm on new org sources (`needs_review`) + ongoing link_health.
- **Pillar tuple backfill ambiguity.** No PMID/DOI on existing pillar citations; title/author/year matching may be imperfect. Mitigate: human review of unmatched; pillars are slice 3 precisely so the pattern is proven first.
- **Migration double-write window.** Keep old columns until a slice is verified live; drop only after. Apply ADD COLUMN to remote D1 before deploying code that SELECTs it (existing discipline).
- **Does commentary need inline `source_id` syntax, or is a parsed `post_source_ref` link table enough?** Lean: parsed link table at publish (no new authoring syntax), decide in planning.

## 9. Acceptance criteria (per slice)

- Slice 0: `sources` table live on remote D1; `POST /cite` returns a `source_id` for a PMID, a DOI, and a bare URL; idempotent (same identifier -> same source_id).
- Slice 1: every `glossary_reference` carries a resolvable `source_id`; the daemon makes zero NCBI/CrossRef existence calls on a normal tick; `lint-citations` + CI gate block a raw-citation commit (proven by negative test); the rendered glossary page is byte-identical to today; 157 refs backfilled (org pages confirmed).
- Slice 2/3: analogous, per surface; old citation columns dropped only after live verification.

## 10. References (files)

- Glossary: `schema.sql` ~L507 (`glossary_reference`); `src/pages/glossary/index.astro`.
- Commentary: `schema.sql` ~L745 (`posts`); `scripts/verify-citations.mjs`; `src/pages/commentary/[...slug].astro`; deploy gate `.github/workflows/deploy.yml` ~L350.
- FAQ: `schema.sql` ~L360 (`faq`, `faq_library_ref`, `faq_resource`); `functions/api/admin/faqs/`.
- Pillars: `src/pages/what-is-rrm/index.astro` ~L99 (`citeStub`); `src/lib/identity.ts` (`buildScholarlyArticleStub`).
- Library: `rrm-cli/schema/d1-library.sql` ~L40 (`articles`), `relationships`; rrm-library-worker `src/index.js` routes + `src/routes/` (`ingest`, `publish`, `content`).
- Guards: `hooks/pre-commit`; `scripts/gates/validate-*.mjs`; `.github/workflows/deploy.yml`.
- Daemon: `projects/rrm-observatory/src/daemons/wave3/glossary-citation-verify.js`.
