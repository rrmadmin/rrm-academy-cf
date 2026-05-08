<!-- Last reviewed: 2026-03-10 -->
# RRM Academy (Astro + CF Pages)

> **This is `rrm-academy-cf` — the rrmacademy.org website.** Not `rrm-foundation` (separate project, separate site). All work here affects the live education platform.

> Wix-to-Cloudflare migration via strangler fig pattern. Phases 0-8 complete (courses, quizzes, enrollment, progress tracking, comments, certificates all live). Active work tracked in `docs/plans/backlog.md`.

> **Satellite repo (private):** Sensitive operational docs (ecosystem map, internal plans, runbooks, design docs with system internals) live in `rrmadmin/rrm-academy-internal`. Clone it as a sibling of this repo: `~/iCode/projects/rrm-academy-internal/`. Build scripts that consume satellite files (e.g. `sync-ecosystem.mjs`) resolve via env-var → sibling → absolute home fallback. Override with `RRM_INTERNAL_ECOSYSTEM_PATH` if cloned elsewhere.
>
> **Ecosystem map:** `rrm-academy-internal/ecosystem.json` is the structured map of the entire RRM Academy system -- infrastructure, databases, contact model, deploy pipelines, workers, projects, people, finances, calendar, and timeline. Read it for system-wide context. Also available via `GET /api/admin/ecosystem` (ADMIN_API_SECRET auth) and D1 `system_config` table (`key = 'ecosystem-map'`, gzip+base64-encoded with `gz:` prefix; the GET endpoint decodes on read).
>
> **Admin API smoke test (one-liner):**
> ```bash
> SECRET=$(op read 'op://Automation/<redacted>/credential')
> curl -sS https://rrmacademy.org/api/admin/ecosystem -H "Authorization: Bearer $SECRET" | jq 'keys'
> ```
> Same secret gates 7 endpoints: `/api/admin/cleanup`, `/api/admin/ecosystem`, `/api/admin/search-queries`, `/api/admin/wix-migration-link`, `/api/admin/wix-migration-email`, `/api/newsletter/send`, `/api/newsletter/rss-check`. After editing the ecosystem JSON in the satellite, re-sync to D1 with `node scripts/sync-ecosystem.mjs` then verify with the curl above.

## Quick Reference

- **Stack**: Astro 5.3 (static) + Pagefind + CF Pages Functions + D1
- **Live**: https://rrmacademy.org/
- **CF Pages project**: `rrm-academy`
- **Deploy**: Three triggers, all via GitHub Actions → CF Pages:
  - `git push origin main` (code changes)
  - `repository_dispatch` with `article_id` (library article publish from yellowbase)
  - `repository_dispatch` with `record_id` (blog post publish from D1 `posts` table)
  - `workflow_dispatch` (manual, optional skip_fetch)
- **AI Search refresh**: Decoupled into its own workflow `.github/workflows/ai-search-refresh.yml` (2026-05-05). Triggers via `workflow_run` after every successful Build & Deploy. Own concurrency group `ai-search-refresh` with `cancel-in-progress: true` so a stuck refresh never blocks the next deploy and newer refreshes supersede older ones. Source artifact `site-data` is uploaded by the deploy job and downloaded cross-workflow via run-id. Plan: `docs/plans/2026-05-05-ai-search-refresh-decoupling.md`. The `Build & Deploy` workflow's `concurrency: deploy` lock now releases the moment the deploy job finishes — does NOT wait on refresh.
- **Build**: `npm run build` (runs `astro build && npx pagefind --site dist`)
- **Data**: `LIBRARY_BUILD_TOKEN=xxx npm run fetch-all` then `npm run build` (post-courses-cutover; AIRTABLE_PAT/TINIFY_API_KEY still in deploy.yml env but DEAD — no fetcher consumes them. Step 10 cleanup pending.)
- **Router Worker**: `~/iCode/projects/rrm-router/src/index.js`
- **Wix site code**: `~/iCode/projects/rrm-academy-wix/`

## Library Architecture

Library data lives in **D1** (`rrm-library`). Airtable is NOT used for library data.

### Literature Pipeline

```
D1 (rrm-library)                     ← enrichment worker manages all articles
    │  rrm-library-worker /articles endpoint (Bearer auth)
    ▼
GitHub Actions: fetch-data.mjs       ← WORKER_AUTH_TOKEN, full or single-record (?id=xxx)
    ▼
src/data/articles.json → Astro build → rrmacademy.org/library
```

**Worker endpoint:** `https://rrm-library-worker.administrator-cloudflare.workers.dev/articles` (all) or `?id=recXXX` (single). Filters: `is_published = 1 AND is_retracted = 0 AND type NOT IN ('faq', 'post', 'course', 'guide')`. Use exclusion filter (NOT IN) so new research types are included by default.

**Ingest endpoint:** POST `/ingest` with Bearer auth. Creates new articles at `intake` status. Enrichment cron picks them up automatically.

### Blog Pipeline

Blog posts moved from Airtable to D1 on 2026-03-27. D1 (`rrm-auth.posts`) is SSOT. Authoring flow: Google Docs -> Claude Code -> D1 insert/update. `src/data/posts.json` is a stale build artifact; never grep it to resolve a slug. Query D1 directly.

```
D1 (rrm-auth, posts table)           ← SSOT. Authoring via Claude Code from Google Docs
    │  GET /api/blog/posts (Bearer LIBRARY_BUILD_TOKEN)
    │  Single-record: ?id=recXXX. Full: all published.
    ▼
GitHub Actions: fetch-blog-data.mjs  ← full or single-record mode
    │  Image pipeline: /commentary-cover skill handles cover swaps (Sharp → R2)
    ▼
src/data/posts.json → Astro build → rrmacademy.org/commentary
```

**Resolve a slug:** query D1 directly, e.g.
`wrangler d1 execute rrm-auth --remote --command "SELECT id, slug, title, cover_image_url FROM posts WHERE slug LIKE '%keyword%'"`.

**Schema:** `posts(id, slug, title, content, excerpt, author, content_pillar, cover_image_url, publish_date, status, word_count, seo_keywords, created_at, updated_at)`. `cover_image_url` is R2-served via `/api/assets/commentary/<slug>.webp` for all new posts.

### FAQ Pipeline

```
D1 (rrm-auth, faq table)             ← admin API endpoints for CRUD
    │  GET /api/faqs (Bearer LIBRARY_BUILD_TOKEN)
    ▼
GitHub Actions: fetch-faq-data.mjs   ← full or single-record (?id=faq_xxx)
    ▼
src/data/faqs.json → Astro build → rrmacademy.org/faqs
```

**Tables:** `faq` (main), `faq_library_ref` (article cross-references), `faq_resource` (external evidence URLs). Schema in `scripts/migrate-faqs-to-d1.sql`.

**Admin endpoints:** `POST/PUT/DELETE /api/admin/faqs/` -- session + admin role auth. Library refs and resources managed via sub-endpoints (`/api/admin/faqs/:id/library-refs`, `/api/admin/faqs/:id/resources`).

**Single-record dispatch:** `repository_dispatch` with `{ faq_id: "faq_xxx" }` triggers `fetch-faq-data.mjs` in single-record mode.

### Courses Pipeline

Courses moved from Airtable to D1 on 2026-04-26 (PR #8 + commits 924722d → 9ae363f). D1 (`rrm-auth`) is SSOT across 3 tables: `course`, `course_section`, `course_step`. Authoring flow: admin endpoints (`/api/admin/courses/*`) — never raw SQL.

```
D1 (rrm-auth, course + course_section + course_step)
    │  GET /api/courses (Bearer LIBRARY_BUILD_TOKEN)
    │  Single-record: ?id=<courseId>. Full: all status='published'.
    ▼
GitHub Actions: fetch-courses-data.mjs   ← full or single-record (?id=<courseId>)
    │  ↓ after D1 fetch: merge src/data/courses-overrides.json (affiliate slot)
    ▼
src/data/courses.json → Astro build → rrmacademy.org/courses
```

**Tables:** `course` (10 D1-origin rows; PK is human-readable id like `masterclass-endo-surgery`, slug UNIQUE COLLATE NOCASE), `course_section` (66 rows; FK to course), `course_step` (103 rows; FK to course_section + denormalized course_id). All step IDs preserved verbatim because `enrollment.course_id`, `step_progress.step_id`, `quiz_response`, `lesson_comment`, `affiliate_clicks`, `course_waitlist` reference them by string. Counts grew on 2026-05-01 when 5 STUC courses were cut from single full-length recordings into 33 individual lesson clips via the CF Stream clip API.

**Schema file:** `scripts/migrate-courses-to-d1.sql`. Migration script `scripts/migrate-courses-to-d1.mjs` is one-shot seed only — re-running requires `--seed-mode-i-understand` flag and clobbers admin-edited status (per /arise --deep finding #3). For pre-flight FK check (read-only), `node scripts/migrate-courses-to-d1.mjs --check-fk`.

**Public endpoint** `functions/api/courses.js`: Bearer LIBRARY_BUILD_TOKEN. Full mode filters `status='published'`; single-mode `?id=X` returns any-status course; `?id=X&preview=1` returns any-status steps too.

**Admin endpoints** under `functions/api/admin/courses/` (17 total, session+admin role): course CRUD + section CRUD + step CRUD + multipart attachments. Enforces FK refusals (course DELETE refused if any of 6 ref tables have rows), cert-quiz integrity (step PUT/DELETE refused if step is referenced as `course.certificate_quiz_step_id` for any course), explicit `db.batch()` cleanup (CASCADE inert in D1).

**Affiliate / externally-hosted courses live in `src/data/courses-overrides.json`**, NOT D1. `fetch-courses-data.mjs` merges them after the D1 fetch, honoring a `_position` field (default: append) and replacing in-place if a matching `id`/`slug` exists (idempotent). NeoFertility Medical Training Cohort is the only override today — it has no D1 record, so without the merge step every cache-miss deploy silently wipes it and 404s `/courses/neofertility-medical-training/`. Migration script's override skip filter excludes any override id/slug (case-insensitive, matches schema COLLATE NOCASE).

**Adding a new affiliate course:** append an entry to `courses-overrides.json` with `_position` hint and PR. Deploys auto-merge on the next fetch-all.

**Single-record dispatch:** `repository_dispatch` with `{ course_id: "<id>" }` triggers `fetch-courses-data.mjs` single-mode. Single-mode filters out updated id + all overrides, sorts D1 by sortOrder, then re-merges overrides at their `_position` — handles BOTH publish (status='published' re-adds) AND un-publish (status='draft'/'archived' leaves removed).

**Endpoint-down resilience:** if `/api/courses` returns 5xx after retries, fetch script logs loudly and `process.exit(0)` with `courses.json` untouched. Combined with `MAX_DROP=1` and `ABSOLUTE_FLOOR=8` deploy guards, an outage is a no-op deploy, not a data-loss deploy.

**MANDATORY: route ALL course edits through the `/courses-update` skill** at `~/.claude/skills/courses-update/SKILL.md`. Workflows A-H cover edit metadata, add section, add step (with Stream UID validation), upload attachment, status changes, deletes, affiliate edits (route to JSON), and pre-flight FK check. Direct `wrangler d1 execute` bypasses input validation, FK checks, and cert-quiz integrity that admin endpoints enforce.

**Soak window (Step 9 of migration plan):** 2026-04-26 → ~2026-05-03. During soak, no Airtable edits and no code changes to course pipeline. Step 10 cleanup follows: drop AIRTABLE_PAT + TINIFY_API_KEY from "Fetch all data" env, untrack `src/data/courses.json` from git, archive the legacy Airtable base. See `docs/plans/backlog.md` and memory `courses-d1-migration.md`.

### Glossary Pipeline

Glossary moved from a monolithic 1200-line Astro file to D1 SSOT on 2026-04-18 (commit d63dee3). Three D1 tables in `rrm-auth` back the page.

```
D1 (rrm-auth, glossary_term + glossary_reference + glossary_abbreviation tables)
    │  GET /api/glossary/terms (Bearer LIBRARY_BUILD_TOKEN)
    ▼
GitHub Actions: fetch-glossary-data.mjs   ← full or single-record (?id=term_xxx)
    ▼
src/data/glossary.json → Astro build → rrmacademy.org/glossary
```

**Tables:**
- `glossary_term` (132 rows) — slug (UNIQUE COLLATE NOCASE), name, part (I-VIII), sort_order, body_html, abbreviation, pillar_link, status
- `glossary_reference` (58 rows) — ref_num (UNIQUE), anchor_text, url, publisher, journal
- `glossary_abbreviation` (52 rows) — abbreviation (PK), full_term, term_slug (nullable link to glossary_term), sort_order

**Schema file:** `scripts/migrate-glossary-to-d1.sql`. Run to create tables.

**Seeding (idempotent upsert via ON CONFLICT):**
- `scripts/regenerate-glossary-seed.mjs` — reads `src/data/glossary.json` → emits `scripts/migrate-glossary-data.sql`
- `scripts/seed-glossary-abbreviations.mjs` — hand-curated 52 abbreviations + emits SQL + merges into glossary.json
- Safe to re-run. Preserves admin edits. To wipe: run `scripts/reset-glossary-data.sql` first.

**Destructive reset:** `scripts/reset-glossary-data.sql` wipes all 3 tables. Never run unless intentional.

**Archived (DO NOT RUN):** `scripts/parse-glossary-to-seed.mjs` — one-shot migration parser from the pre-2026-04-18 monolithic .astro. Throws on execute. Kept for historical context.

**Single-record dispatch:** `repository_dispatch` with `{ glossary_term_id: "term_xxx" }` triggers `fetch-glossary-data.mjs` in single-record mode.

**Page rendering:** `src/pages/glossary/index.astro` is data-driven. Imports `src/data/glossary.json`. Auto-generates TOC, A-Z index (from term names), abbreviations table, references list. Emits 3 JSON-LD blocks: Article+MedicalWebPage, BreadcrumbList, DefinedTermSet (132 DefinedTerm entities for per-term AEO).

**Editing protocol:** D1 is SSOT. Edit via `wrangler d1 execute rrm-auth --remote --command "UPDATE glossary_term SET body_html=... WHERE slug='xxx'"` or via future admin UI. Then trigger rebuild. Never edit term bodies in `src/pages/glossary/index.astro` — that file only has template logic + hardcoded intro/CTA.

**MANDATORY: route ALL glossary edits through the `/glossary-update` skill.** The skill (at `~/.claude/skills/glossary-update/SKILL.md`) encodes the full workflow: slug uniqueness check, sort_order computation per part, MAX(ref_num) lookup, Gianna dispatch for prose, batch SQL via `/tmp/glossary-bulk.sql`, single-record vs full rebuild dispatch, and live verification. Direct `wrangler d1 execute` calls without invoking the skill skip required structural lookups and have repeatedly produced misordered terms, missing cross-references, and stale src/data/glossary.json. Gianna agent is also instructed to invoke this skill before drafting any glossary content.

### Full Rebuild

`fetch-all` fetches all 5 data sources: articles, posts, FAQs, courses, glossary. Cache key: `site-data-YYYY-MM-DD` (ET timezone). Since 2026-04-18, push events also fetch fresh (cache acts as fallback only) -- this fixes silent content rollback when committed `src/data/*.json` drifts from D1. `workflow_dispatch` always fetches fresh. Single-record `repository_dispatch` (record_id / article_id / faq_id / glossary_term_id) uses cache + 1-record patch.

**Baseline auto-commit requires `permissions: contents: write`** in `deploy.yml`. The Update data baselines step writes `src/data/.baselines.json` and runs `git push`; without write permission the push 403s and the fallback `|| echo "Baseline update skipped (no changes)"` swallows it as a misleading success. If baselines drift from reality (check CI logs for actual counts), verify permissions first before editing the file.

## Docs

```
docs/
├── architecture/
│   └── airtable-cf-pipeline.md   # Airtable → CF data pipeline
├── plans/
│   ├── backlog.md                # Living backlog & project status
│   ├── completed/                # Archived completed plans
│   └── *.md                      # Active implementation plans
└── endo-survey-icd10-internal.md
```

## Local Reference

| Topic | File |
|-------|------|
| Design system entry point | `DESIGN.md` |
| Design system SSOT (machine-readable) | `docs/design/design-system.json` |
| Design system narrative (human-readable) | `STYLE-GUIDE.md` |
| Backlog & project status | `docs/plans/backlog.md` |
| Airtable-to-CF data pipeline | `docs/architecture/airtable-cf-pipeline.md` |
| ICD-10 codes (endo survey) | `docs/endo-survey-icd10-internal.md` |
| Ecosystem SSOT | `rrm-academy-internal/ecosystem.json` (satellite repo, sibling clone) |
| Site-SSOT inputs | `ssot/` (site, organization, people refs, services, agent-surfaces) |
| Site-SSOT identity helper | `src/lib/identity.ts` reads from `src/generated/ssot-schema.json` (gitignored, regenerated each build) |

### Site-SSOT (Phase 0a / 2026-04-29)

`rrm-academy-cf` is the second site-ssot consumer (after neofertility-ie). The `ssot/*.json` files declare site identity, organization, people refs to `~/iCode/config/ecosystem-identity/`, services, and agent-surfaces (incl. `social_handles`).

`scripts/ssot-prebuild.mjs` runs before `astro build` (chained in `package.json` build) and writes `src/generated/ssot-schema.json`. Pages import via `src/lib/identity.ts` — `getOrganizationJsonLd()`, `getTeam()`, `getSocialHandles()`, `buildIdentityGraph()`. Build-time assertion: every social_handle URL must exist in `organization.sameAs`.

`SITE_SSOT_ENABLED=1` (default) emits `public/llms.txt`, `public/llms-full.txt`, `public/agents.md`, `public/.well-known/agent-card.json` from agent-surfaces.json. `=0` skips these and just regenerates the schema snapshot.

Validation: `npm run ssot:validate` (schema + cross-ref) and `npm run ssot:smoke` (1P refs).

### Design System SSOT

`docs/design/design-system.json` is the canonical machine-readable source of truth for all design tokens, brand rules, fonts, and typography. It is auto-generated from `src/styles/global.css` (CSS tokens) and `docs/design/design-system.manual.json` (brand rules, fonts, typography scale).

- Read this file FIRST before writing CSS, designing badges, or making any brand-related decision. Do NOT guess token names.
- Top-level sections: `brand`, `fonts`, `typography`, `themes.light|dark|eink`, `shared`.
- To change a CSS token: edit `src/styles/global.css`, then run `npm run design-tokens`.
- To change a brand rule or typography scale: edit `docs/design/design-system.manual.json`, then run `npm run design-tokens`.
- CI runs `npm run design-tokens:check` and blocks deploys on drift.
- **Deprecated:** `docs/design/tokens.json` (older static snapshot, no longer consumed). Do not read. Will be removed.

## Site Map

| Route | File |
|-------|------|
| `/` | `src/pages/index.astro` |
| `/about` | `src/pages/about.astro` |
| `/contact` | `src/pages/contact.astro` (form + Turnstile) |
| `/donate` | `src/pages/donate/index.astro` |
| `/donate/thank-you` | `src/pages/donate/thank-you.astro` |
| `/faqs` | `src/pages/faqs.astro` |
| `/faqs/[slug]` | `src/pages/faqs/[...slug].astro` |
| `/library` | `src/pages/library/index.astro` |
| `/library/[slug]` | `src/pages/library/[...slug].astro` |
| `/library/page/[page]` | `src/pages/library/page/[page].astro` |
| `/library/saved` | `src/pages/library/saved.astro` |
| `/commentary` | `src/pages/commentary/index.astro` |
| `/commentary/[slug]` | `src/pages/commentary/[...slug].astro` |
| `/commentary/page/[page]` | `src/pages/commentary/page/[page].astro` |
| `/courses` | `src/pages/courses/index.astro` |
| `/courses/[slug]` | `src/pages/courses/[slug].astro` |
| `/courses/[slug]/[stepId]` | `src/pages/courses/[slug]/[stepId].astro` |
| `/community` | `src/pages/community/index.astro` |
| `/community/events` | `src/pages/community/events.astro` |
| `/community/members` | `src/pages/community/members.astro` |
| `/community/post/[id]` | `src/pages/community/post/[...id].astro` |
| `/admin/seo` | `src/pages/admin/seo.astro` |
| `/naprotechnology` | `src/pages/naprotechnology/index.astro` (pillar guide) |
| `/what-is-rrm` | `src/pages/what-is-rrm/index.astro` (pillar guide) |
| `/common-questions-about-rrm` | `src/pages/common-questions-about-rrm.astro` (pillar guide) |
| `/femm` | `src/pages/femm/index.astro` (pillar guide) |
| `/neofertility` | `src/pages/neofertility/index.astro` (pillar guide) |
| `/glossary` | `src/pages/glossary/index.astro` (pillar guide) |
| `/endo-survey` | `src/pages/endo-survey/index.astro` |
| `/endo-survey/take` | `src/pages/endo-survey/take.astro` |
| `/save-the-uterus-club` | `src/pages/save-the-uterus-club/index.astro` |
| `/save-the-uterus-club/thank-you` | `src/pages/save-the-uterus-club/thank-you.astro` |
| `/login` | `src/pages/login.astro` |
| `/signup` | `src/pages/signup.astro` |
| `/account` | `src/pages/account/index.astro` (auth required) |
| `/forgot-password` | `src/pages/forgot-password.astro` |
| `/reset-password` | `src/pages/reset-password.astro` |
| `/terms-of-use` | `src/pages/terms-of-use.astro` |
| `/privacy-policy` | `src/pages/privacy-policy.astro` |
| `/medical-disclaimer` | `src/pages/medical-disclaimer.astro` |
| `/linkinbio` | `src/pages/linkinbio.astro` |
| `/linkinbio/jointhecall` | `src/pages/linkinbio/jointhecall.astro` |
| `/connect` | `src/pages/connect/index.astro` (MCP setup guide + developer section) |
| `/openapi` | `src/pages/openapi.astro` (OpenAPI 3.1 reference, build-time imports `public/openapi.json`) |
| `/404` | `src/pages/404.astro` |

## Information Architecture

**Decision (2026-03-12):** Flat URL structure for pillar pages. Nav dropdown for UX grouping. URL structure and navigation structure are independent.

**Pillar pages live at root** for maximum SEO authority: `/naprotechnology/`, `/what-is-rrm/`, `/common-questions-about-rrm`. Future pillar guides (`/endometriosis/`, `/pcos/`, etc.) also go at root. Short vanity URLs (e.g. `/napro`) 301 via rrm-router.

**`/guides/` is an index page**, not a URL parent. It lists and links to all pillar guides. Guides do NOT live under `/guides/[slug]`.

**Nav structure (3 items):** Research Library, Commentary, Learn (dropdown: Guides, FAQs, Courses). "Learn" groups educational content in the UI without nesting URLs.

**Do not** move FAQs, courses, or pillar pages under a `/learn/` path. The 301 redirect tax and URL depth penalty outweigh the organizational neatness.

## App Shell

Wraps `/library/*`, `/commentary/*`, `/guides/`, `/faqs/*`, `/account/*`, `/ask/`, and 6 pillar pages (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`, `/common-questions-about-rrm/`, `/glossary/`) with a left-sidebar app shell instead of the global Header. Code on main, **production INERT** until activated via:

```bash
gh variable set PUBLIC_SHELL_ROUTES --body "library,commentary,guides,faqs,account,ask"
gh workflow run deploy.yml
```

Rollback: `gh variable set PUBLIC_SHELL_ROUTES --body ""` + redeploy.

**Components:**
- `src/components/AppShellChrome.astro` — sidebar + drawer + middle column.
- `src/components/AppShellSheet.astro` — mobile pull-up sheet.
- `src/components/MaybeShell.astro` — conditional wrapper for shell-on/shell-off without duplicating page body across two ternary branches. Forwards `hasRail` prop and `rail` named slot. Use this on every new wrap target.
- `src/components/SectionTocChips.astro` — chip-pill "On this page" callout that replaces the sticky internal `.toc` sidebar on shell-enabled pillar pages. Pair with `.article-layout--no-toc` modifier.
- `src/styles/app-shell.css` — grid, tokens, mobile rules.
- Helper: `src/lib/shell-routes.ts` exports `isShellEnabled(route)` reading `PUBLIC_SHELL_ROUTES`. `ShellRoute = 'commentary' | 'library' | 'guides' | 'faqs' | 'account' | 'ask'`.

**Activation gating:** every wrapped page tests `isShellEnabled(...)` to decide between `chrome="shell"` (sidebar) and `chrome="default"` (Header). BaseLayout's `chrome="shell"` prop suppresses Header AND outer `<main>` (AppShellChrome emits its own); Footer renders inside AppShellChrome's grid.

**Context types:** `'index' | 'article' | 'saved' | 'page'`. The `'page'` context (added 2026-05-07) is the generic 2-col baseline used by guides/faqs/account/ask/pillar pages — no card writer, no rail unless `hasRail` prop is set.

**Right rail.** Two opt-in mechanisms:
1. `relatedSections={Array<{heading, items}>}` — server-rendered list. Library articles pass `[Topics, By this author, Related research]`. Commentary posts pass `[Pillar, More by this author, Related commentary]`. Helpers: `getArticlesByAuthor()` / `getRelatedArticles()` in `src/lib/airtable.ts`, `getRelatedPosts()` in `src/lib/blog.ts`. Empty sections drop; cross-section dedup by id.
2. `hasRail={true}` + `<Fragment slot="rail">…</Fragment>` — arbitrary HTML in the rail. Used by `/glossary/` for the A-Z index. Why an explicit prop instead of `Astro.slots.has('rail')`: when forwarded through MaybeShell, Astro reports the slot as "present" even when no upstream content was passed.

3-col grid triggers on `data-shell-context="article"` OR `data-has-related="true"`.

When neither rail mechanism is in use on an article page, AppShellChrome falls back to the legacy sessionStorage `rrm-shell-context` "Continue browsing" hydrator. Cold-land gate: `data-has-related="true"` skips the `.shell-no-context` CSS collapse so direct-traffic visitors still see the server-rendered rail.

**Pillar guide TOC.** Sticky `.toc` sidebar inside `.article-layout` is the off-shell pattern. When SHELL_ENABLED, all 5 pillar guides + glossary render `<SectionTocChips items={...} />` between byline and first section, and add the `article-layout--no-toc` modifier so the article grid collapses to single column.

**Middle-column max-width.** When shell is on, all `.container` content inside `.app-shell-main` for `data-shell-context="page"` is constrained to `var(--max-width-article)` so headers, byline, chip TOC, and body all align to the same vertical edges.

**Glossary specifics.** Authorship: `By RRM Academy / Reviewed by Dr. Naomi Whittaker, MD…` using the canonical `.author-avatar-stack` + `.has-reviewer` pattern (precedent: `/femm/` byline). JSON-LD: `author = #organization`, `reviewedBy = #naomi-whittaker`. Pillar guides written in Naomi's clinical voice keep her as primary author — glossary is the only org-author exception.

**H1 typography (2026-05-08).** Global `<h1>` now uses `clamp(2rem, 1.25rem + 2.5vw, 3.25rem)` (52px on wide viewports). All interior pages share this size — pillar guides, index pages, slug pages, ask, library/saved. Local `font-size` overrides have been removed; `line-height`/`letter-spacing`/`margin` tweaks preserved. Auth-card h1 (login/signup/account small-card pattern), admin dashboard h1, and homepage hero (72px) keep their own intentional sizes.

CI gate: `scripts/check-canonical-lockdown.mjs` enforces `ALLOWED_PARAMS` allowlist (`topic, page, q, sort` + analytics params) on `/library/*` + `/commentary/*` query strings. New canonical-affecting params require explicit allowlist edit.

E2E spec: `tests/e2e/app-shell.spec.ts` asserts `/library/` index has no middle column on cold land (G-SEO-6).

11 proof gates documented in spec (G-SEO-1..6, G-GUARD, G-CHROME-1, G-ARCH-1/2, G-Z-STACK). Spec: `docs/superpowers/specs/2026-04-10-library-commentary-app-shell-design.md`. Plan: `docs/superpowers/plans/2026-05-06-library-commentary-app-shell-implementation.md`. Two /arise --deep passes done on the original library/commentary surface (#124 + #125).

## Page Templates & SEO Architecture

**BaseLayout** (`src/layouts/BaseLayout.astro`): Every page uses this. Controls `<title>`, meta description, canonical URL, OG/Twitter tags, JSON-LD injection, Highwire Press citation meta, font preloading, favicon, and noindex. Title suffix logic: appends `| RRM Academy` unless title already contains "RRM Academy" or starts with "RRM ".

**Dynamic route templates** generate all content pages from JSON data files:

| Template | Data Source | Schema (JSON-LD) | Notes |
|----------|------------|-------------------|-------|
| `src/pages/library/[...slug].astro` | `articles.json` | MedicalScholarlyArticle + citation_* meta | Highwire Press tags for Google Scholar |
| `src/pages/commentary/[...slug].astro` | `posts.json` | BlogPosting + BreadcrumbList (+ Person for Whittaker) | Cover image alt = post title |
| `src/pages/faqs/[...slug].astro` | `faqs.json` | QAPage | Related questions linking |
| `src/pages/courses/[slug].astro` | `courses.json` | Course + Person + BreadcrumbList + FAQPage | Lesson player at `[slug]/[stepId].astro` |
| `src/pages/courses/index.astro` | `courses.json` | ItemList | Catalog page |

SEO changes to these templates automatically apply to all existing and future content. No per-item overrides exist.

## OG Images (on-demand)

Every page's `<meta property="og:image">` points at `/og/<slug>.png?v=${OG_VERSION}`. PNGs are rendered on demand by `functions/og/[[path]].js` via `workers-og` (satori + resvg-wasm). No pre-built PNGs ship with the site -- the lookup is a static `src/data/og-index.json` map built at deploy time from articles/posts/faqs/courses + a static-page constant.

**Pipeline:**

```
fetch-all (articles.json, posts.json, faqs.json, courses.json, glossary.json)
    |
    v
scripts/build-og-index.mjs  -> src/data/og-index.json (gitignored)
    |  (runs first inside `npm run build`)
    v
astro build  -> dist/
    |
    v
Pages deploy  -> functions/og/[[path]].js imports og-index.json at request time
```

**Slug convention** matches `routeToOgSlug()` in BaseLayout.astro:
- `/` -> `homepage`
- `/what-is-rrm` -> `what-is-rrm`
- `/library/<slug>` -> `library-<slug>`
- `/commentary/<slug>` -> `commentary-<slug>`
- `/faqs/<slug>` -> `faqs-<slug>`
- `/courses/<slug>` -> `courses-<slug>`

Unknown slugs -> branded fallback card (still 200 PNG, never a 404).

**Cache busting (`OG_VERSION`):** The version constant lives at `src/lib/og-config.ts`. Bump it whenever the satori template design changes (palette, typography, layout, fallback card). BaseLayout.astro appends `?v=${OG_VERSION}` to every og:image URL -- bumping changes the cache key at both the CF edge and every social scraper (Facebook/LinkedIn/Twitter/iMessage/Slack) that caches per URL.

**Cache-Control:** `public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800`. Never `immutable` -- that strands old palettes at the edge forever.

**Router:** `/og` is in `ASTRO_ROUTES` in rrm-router/src/index.js. Without that entry, the router proxies `/og/*` to Wix and the function never sees the request.

## Components

`src/components/`: Header, Footer, SearchBar, ArticleCard, BlogCard, CourseCard, Citation, AuthorByline, TopicTag, LibraryFundingCallout

## API Functions (`functions/api/`)

| Endpoint | File | Purpose |
|----------|------|---------|
| **Auth** | | |
| `POST /api/auth/signup` | `auth/signup.js` | Create account |
| `POST /api/auth/login` | `auth/login.js` | Login, set session cookie |
| `POST /api/auth/logout` | `auth/logout.js` | Clear session |
| `GET /api/auth/session` | `auth/session.js` | Check current session |
| `GET /api/auth/profile` | `auth/profile.js` | Get/update user profile |
| `POST /api/auth/forgot-password` | `auth/forgot-password.js` | Send reset email |
| `POST /api/auth/reset-password` | `auth/reset-password.js` | Reset with token |
| `POST /api/auth/change-password` | `auth/change-password.js` | Authenticated password change |
| `GET /api/auth/verify-email` | `auth/verify-email.js` | Email verification link handler |
| `POST /api/auth/resend-verification` | `auth/resend-verification.js` | Resend verification email |
| `GET /api/auth/google` | `auth/google.js` | Redirect to Google OAuth consent |
| `GET /api/auth/google-callback` | `auth/google-callback.js` | Google OAuth callback, account link/create |
| **Courses** | | |
| `POST /api/courses/enroll` | `courses/enroll.js` | Enroll in a course |
| `GET/POST /api/courses/progress` | `courses/progress.js` | Track step completion |
| `POST /api/courses/quiz` | `courses/quiz.js` | Submit quiz/questionnaire answers |
| `GET/POST /api/courses/comments` | `courses/comments.js` | Course step comments |
| `GET /api/courses/certificate` | `courses/certificate.js` | Generate completion certificate |
| **Community** | | |
| `GET/POST /api/community/posts` | `community/posts.js` | Community posts CRUD |
| `GET/POST /api/community/comments` | `community/comments.js` | Post comments (author editing via PUT) |
| `POST /api/community/reactions` | `community/reactions.js` | Post/comment reactions |
| `GET /api/community/status` | `community/status.js` | Community membership status |
| `GET /api/community/members` | `community/members.js` | Members list with tiers/badges |
| `POST /api/community/flags` | `community/flags.js` | Report/flag posts and comments |
| `POST /api/community/ban` | `community/ban.js` | Ban user (admin only) |
| `POST /api/community/unban` | `community/unban.js` | Unban user (admin only) |
| `GET/PUT /api/community/notifications` | `community/notifications.js` | Email notification preferences |
| `POST /api/community/upload` | `community/upload.js` | Image upload to R2 |
| **Billing** | | |
| `GET /api/billing/status` | `billing/status.js` | Subscription + donation history |
| `POST /api/billing/portal` | `billing/portal.js` | Stripe customer portal link |
| `GET /api/billing/checkout-account` | `billing/checkout-account.js` | Check if account exists for checkout session |
| `POST /api/create-checkout` | `create-checkout.js` | Stripe checkout session |
| `POST /api/stripe-webhook` | `stripe-webhook.js` | Stripe webhook handler |
| **Other** | | |
| `POST /api/admin/cleanup` | `admin/cleanup.js` | Prune expired sessions/resets/verifications/webhook events (ADMIN_API_SECRET) |
| `GET /api/admin/seo` | `admin/seo.js` | Proxy to rrm-seo-monitor Worker (ADMIN_TOKEN) |
| `POST /api/contact/submit` | `contact/submit.js` | Contact form submission |
| `GET/POST /api/saved` | `saved.js` | Save/unsave library articles |
| `GET /api/stream/token` | `stream/token.js` | CF Stream video token |
| `POST /api/survey/request` | `survey/request.js` | Request survey link |
| `GET /api/survey/validate` | `survey/validate.js` | Validate survey magic-link token |
| `POST /api/survey/submit` | `survey/submit.js` | Submit survey responses |
| `POST /api/survey/event` | `survey/event.js` | Survey button click tracking (beacon) |

Middleware: `functions/_middleware.js` (session injection, CORS, auth gating)

## Email

All transactional email uses **AWS SES** via `functions/api/_ses.js` (aws4fetch). Sends from `@mail.rrmacademy.org` subdomain (isolates transactional reputation from root domain). DKIM, SPF, DMARC, and custom MAIL FROM (`bounce.mail.rrmacademy.org`) all configured. Required env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_REGION`.

## Email Validation (ELV)

**EmailListVerify** provides SMTP-level mailbox verification. Shared helper: `functions/api/_elv.js`.

- `verifyEmailELV(email, env)` -- pure check, returns `{ status, blocked, reason }`
- `verifyAndTagEmail(email, env, opts)` -- check + CRM upsert (`contact` table) + `elv:STATUS` tag
- **Fail-open**: ELV errors/timeouts allow the email through (local validator already caught structural issues)
- **Integrated at**: signup, contact form, survey, newsletter subscribe (blocking), checkout (non-blocking via waitUntil)
- **Not integrated at**: login, forgot-password (would lock people out), Google OAuth (email from Google, always valid)
- CF Pages secret: `ELV_API_KEY`

## Newsletter

- **Table**: `newsletter_subscriber` in D1 (separate from `contact` CRM table)
- **Segments**: JSON array in `segments` column. 15 segment types mapped from CRM tags + enrollment + Stripe.
- **Send**: `POST /api/newsletter/send` (admin-only, paginated). Suppression safety net queries ELV blocked tags before sending.
- **Subscribe**: Rate limited (10/15min per IP). ELV check before insert. Single opt-in (Brian confirmed).
- **Unsubscribe**: RFC 8058 one-click + confirmation page. Uses status UPDATE, never DELETE.
- **Scripts**: `verify-crm-elv.mjs` (bulk verify), `import-newsletter-subscribers.mjs` (ELV-filtered import), `segment-newsletter.mjs` (tag-based segmentation)

## Operational Automation (n8n)

| Workflow | Schedule | What |
|----------|----------|------|
| Daily Cleanup (`La9Bauj70L82oua8`) | 5 AM UTC | POST `/api/admin/cleanup` -- prunes expired sessions, resets, verifications, webhook events >7d |
| Down Detector (`HxxCkFOPbrXa0r08`) | Every 5 min | Checks site, library data, n8n. Telegram alert on failure via @rrm_n8n_notification_bot |

## Survey Pseudonymization

Endo survey splits PII from health data across two systems:

| System | Binding | Contains |
|--------|---------|----------|
| D1 `rrm-survey` | `SURVEY_DB` | email + Airtable record ID (identity) |
| Airtable | via `AIRTABLE_PAT` | symptoms, scores, metadata (no email) |
| KV `SURVEY_TOKENS` | `SURVEY_TOKENS` | token, used flag, UTM (email stripped after submit) |

- **D1 table:** `survey_identities` (email, airtable_record_id, source, created_at). UNIQUE on airtable_record_id, INDEX on email
- **Sources:** `endo-survey-v1` (live submissions), `endo-survey-v1-backfill` (migration)
- **Airtable IDs:** base `appb7HeeJQsVe3Jpr`, table `tblMAw2tih2ie3ZCu`
- **Token TTL:** 24 hours (both request.js and submit.js)
- **D1 failure handling:** logs to Analytics Engine + SES alert to administrator@rrmacademy.org
- **Migration script:** `scripts/migrate-survey-identities.mjs` (one-time, already run)
- **Design doc:** `docs/plans/2026-03-09-survey-pseudonymization-design.md`

## Webhook Event Dedup

`webhook_event` table in D1 stores Stripe `event.id` on first processing. `INSERT OR IGNORE` skips duplicates on retries. Dedup record deleted only on 5xx (transient errors), not 4xx (permanent failures). Prevents duplicate welcome emails and account creation.

## Enrollment Revocation

Full Stripe refunds (`charge.refunded === true`) soft-revoke enrollment via `revoked_at` column. Guard blocks `DELETE FROM enrollment`, so use UPDATE instead. All 16 enrollment access queries include `AND revoked_at IS NULL`. Partial refunds log only. Admin email on every revocation.

## Semantic Search

**Architecture:** Pagefind (client-side full-text, instant) + Vectorize (server-side semantic, ~200ms) merged via **Reciprocal Rank Fusion** (RRF) in `SearchBar.astro`. Score = `sum(1/(60+rank))` across both systems. Items in both lists get boosted. 300ms timeout for semantic; late results append as addenda.

**Embedding pipeline:** `scripts/embed-library-ci.mjs` runs post-deploy in CI (REST API). `scripts/embed-library.mjs` for local use (Worker bindings). Both embed all content types: articles (enriched with Topics/SearchTerms/Domain/abstract), posts (full content), FAQs (full answers), courses (section titles). Model: `@cf/baai/bge-base-en-v1.5`.

**Vectorize metadata constraint:** Values must be strings, numbers, booleans, or string arrays. `null` is rejected with 400. Filter nulls before upsert (e.g., omit `year` when null).

**Rate limiting:** `/api/search/semantic.js` has IP-based rate limiting (20 req/min per IP via `cf-connecting-ip`). Per-isolate (resets on cold start). Query length capped at 500 chars. Protects billed AI.run() and Vectorize.query() calls.

## CI Deploy Guard

`deploy.yml` enforces minimum record counts: articles >= 2500, posts >= 5, faqs >= 10, courses >= 1, glossary terms >= 100, glossary references >= 30, glossary abbreviations >= 40. Glossary also enforces max term drop of 5 per deploy. Prevents catastrophic data loss from deploying.

**Two "baseline" files exist and are independent — don't confuse them:**
- `src/data/.baselines.json` -- record-count floor for articles/posts/faqs/courses JSON + glossary.terms/references/abbreviations. Auto-updated by CI after green deploys.
- `scripts/type-check-baseline.json` -- Astro `npx astro check` error count ceiling. Deploy's `Type check (baseline)` step fails if current errors > baseline. NOT auto-updated. Manually bump via `node scripts/check-types.mjs --update` OR fix the errors.

A commit introducing new type errors silently blocks deploys until the baseline is bumped or errors are fixed. Always run `npm run check-types` before pushing.

## Mobile Editing

Push to `claude/` branch -- GitHub Actions auto-builds + merges. No local credentials needed.

## Shared Config

- **Blog posts**: D1 `rrm-auth.posts` is SSOT (migrated from Airtable 2026-03-27). Library, FAQs, glossary, courses also D1. **Airtable holdouts:** endo survey symptom data (`appb7HeeJQsVe3Jpr` — by-design HIPAA pseudonymization split), STUC publisher (manual CLI with `--i-understand-d1-divergence` guard). See `~/iCode/CLAUDE.md` "Airtable Deprecation" for the complete current map (verified 2026-04-27).
- **Stripe API version**: `STRIPE_API_VERSION` in `functions/api/auth/_shared.js` — imported by all 6 Stripe consumers
- **Site URL for emails**: `SITE_URL` in `functions/api/auth/_shared.js` — used in transactional email body links only (CORS origin stays hardcoded for security; Astro pages use `Astro.site`)
- **Navigation**: Desktop, mobile, and footer navs are intentionally different item sets — see comments in `Header.astro` and `Footer.astro`
- **`password_reset.purpose` column** (added 2026-05-03 via migration 019): TEXT NOT NULL DEFAULT `'reset'`. Two values: `'reset'` (forgot-password tokens, 1hr TTL) and `'welcome'` (Stripe-auto-account onboarding tokens, 7d TTL). `forgot-password.js` DELETE is scoped to `purpose = 'reset'` so welcome tokens survive a forgot-password click. `_webhook-checkout.js` writes `purpose = 'welcome'` when auto-creating accounts. `reset-password.js` validates `purpose = 'reset'` in the atomic DELETE...RETURNING consume.
- **`idx_user_email_nocase` UNIQUE INDEX** (added 2026-05-03 via migration 018): closes the case-mismatched-email duplicate-account class. Application-layer COLLATE NOCASE checks were racy on concurrent signups. Pre-apply check confirmed 0 dup-email groups across 7,940 users.
- **Community email_verified gate** (added 2026-05-03): `requireMember()` in `functions/api/community/_shared.js` now requires `user.email_verified = 1` before allowing post/comment/reaction. Blocks unverified Stripe-auto-created accounts whose verification email bounced. Returns 403 with humane "verify your email first" copy + resend link.

## Security Guard

A zero-dependency Node.js script (`scripts/guard.mjs`) that blocks deployments if critical security files are tampered with.

**Guarded files** (hash-checked via `guard-manifest.json`, 42 files):
- `functions/api/auth/_shared.js` — CORS, sessions, crypto, rate limiting
- `functions/api/auth/login.js`, `signup.js`, `google-callback.js`, `google.js` — authentication
- `functions/api/auth/forgot-password.js`, `reset-password.js`, `change-password.js` — password management
- `functions/api/auth/_email-validate.js` — email validation, disposable/typo detection
- `functions/api/auth/verify-email.js` — email verification token consumption
- `functions/api/auth/logout.js` — session invalidation
- `functions/api/_ses.js` — SES email sending infrastructure
- `functions/api/_elv.js` — EmailListVerify SMTP validation
- `functions/api/stripe-webhook.js` — webhook signature verification + dispatch
- `functions/api/billing/_webhook-checkout.js`, `_webhook-subscription.js`, `_webhook-shared.js`, `_webhook-invoice.js` — webhook handlers
- `functions/api/create-checkout.js`, `billing/status.js`, `billing/portal.js`, `billing/checkout-account.js` — billing
- `functions/api/survey/submit.js`, `survey/request.js` — pseudonymization + magic-link tokens
- `functions/api/newsletter/send.js`, `unsubscribe.js`, `subscribe.js` — mass email, CAN-SPAM, intake
- `functions/api/search/semantic.js` — billed AI.run() + Vectorize (rate-limited)
- `functions/api/community/_shared.js` — community access control (requireMember)
- `functions/api/community/upload.js` — R2 image upload (file validation)
- `functions/api/admin/cleanup.js` — expired data deletion from D1
- `functions/api/faqs.js` — public FAQ endpoint (Bearer token auth)
- `functions/api/admin/faqs/index.js`, `[id].js`, `[id]/library-refs.js`, `[id]/resources.js` — FAQ admin CRUD
- `functions/api/pdf/request.js`, `pdf/redeem.js` — PDF magic-link tokens
- `functions/_middleware.js` — auth gating for /account and /community
- `wrangler.toml` — D1, KV, R2 bindings
- `scripts/guard.mjs` — self-guarding
- `src/components/SearchBar.astro` — search UX + RRF fusion (Pagefind init, relevance boost, error resilience)

**Security invariants** (always enforced, even after `guard:update`):
- All `Access-Control-Allow-Origin` values in `functions/` must be `https://rrmacademy.org`
- `stripe-webhook.js` must use `stripe-signature` + `constructEventAsync`
- `_middleware.js` must protect `/account` and `/community`
- `login.js` and `signup.js` must use `checkRateLimit`
- `google-callback.js` must have `user.blocked` check, `hashed_password = ''`, and `isSafeRedirect`
- `community/upload.js` must have content-type allowlist
- Directory file counts monitored for auth/ (15) and billing/ (7) -- warns on new unguarded files

**Secret scanning**: Blocks `sk_live_`, `sk_test_`, `whsec_`, `GOCSPX-`, `AKIA`, private keys, Bearer tokens, Airtable PATs, 1Password `op://` references in `functions/` and `src/`.

**CRM & newsletter safety** (Phase 5):
- No `DELETE FROM` / `DROP TABLE` / `TRUNCATE` on `contact`, `newsletter_subscriber`, `contact_tag`, `user`, or `enrollment` tables
- `unsubscribe.js` must use `status = 'unsubscribed'` UPDATE, never DELETE (CAN-SPAM)
- `send.js` must require `ADMIN_API_SECRET` Bearer auth
- `subscribe.js` must have rate limiting

**Commands**:
- `npm run guard` — verify (exit 1 on failure)
- `npm run guard:update` — regenerate manifest hashes after intentional changes
- `npm run guard:install` — install pre-commit hook

**Runs automatically**: pre-commit hook (local, critical files only), CI deploy workflow, CI claude/** auto-merge workflow.

## Fact Pipeline Proof Gates

`scripts/gates/validate-fact-pipeline.mjs` runs 5 deterministic gates that prevent the bug classes /arise --deep found in the canonical-facts pipeline (commit 70958c2 — Creighton matcher dropped 724 facts; promote-* silent on partial failure; validator/prompt enum drift). Wired to npm + pre-commit hook.

**Gates**:

| Gate | What it prevents |
|------|------------------|
| **G1** Schema self-consistency | Entity matchers in `scripts/lib/canonical-facts-schema.mjs` referencing missing/wrong tradition values; slug-named traditions not accepted by their entity; values in ALLOWED_TRADITIONS that route to no entity (the "stranded fact" pattern) |
| **G2** SSOT integrity | `_meta.record_count` drift, malformed fact IDs (4 patterns: `fact-rec*-N` article, `fact-<slug>-N` chapter, `fact-<slug>` legacy curator, `<registry>-<slug>` legacy registry), invalid tradition arrays, broken matcher routing |
| **G3** Validator-prompt enum sync | `ALLOWED_CATEGORIES` + `ALLOWED_CLAIM_TYPES` Sets in `extract-article-facts.mjs` must match enums declared in `scripts/article-extraction/system-prompt.md` exactly (same for chapter side when added) |
| **G4** Orchestrator exit codes | Every script with a `failed`/`failures` array must call `process.exit(<non-zero>)` inside the failure block. Static check via brace-balanced regex |
| **G5** D1↔SSOT reconciliation | D1 fact count per entity matches SSOT `_meta.record_count` within ±2 tolerance. Network-dependent; skipped in `--quick` mode |

**Commands**:
- `npm run gates` — full G1-G5 (queries D1)
- `npm run gates:check` — quick G1-G4 (no network) — pre-commit invokes this
- `node scripts/gates/validate-fact-pipeline.mjs --gate G1` — single gate
- `node scripts/gates/validate-fact-pipeline.mjs --json` — machine-readable output

**Pre-commit auto-fires** on changes to:
- `scripts/lib/canonical-facts-schema.mjs`
- `scripts/extract-article-facts.mjs`, `scripts/extract-chapter-facts.mjs`
- `scripts/promote-article-facts.mjs`, `scripts/promote-chapter-facts.mjs`
- `scripts/build-canonical-facts.mjs`
- `scripts/article-extraction/system-prompt.md`, `scripts/chapter-extraction/system-prompt.md`

**When you change**:
- A schema entity matcher → run `npm run gates` to confirm D1 routing still aligns.
- An orchestrator's enum (system prompt) → update validator allowlist Sets to match.
- The ALLOWED_TRADITIONS list → ensure ≥1 entity matcher accepts the new value, OR document why it's intentionally stranded.

**Bypass**: `git commit --no-verify` (don't, except for emergency reverts).

Docs: `scripts/gates/README.md`.

## Payment Pipeline Proof Gates

`scripts/gates/validate-payment-pipeline.mjs` runs 4 deterministic gates against the payment surface (`functions/api/{stripe-webhook,create-checkout,billing/*}`). Built 2026-05-07 in response to /arise-intel finding that the payment surface accumulated 41 findings across 13 distinct /arise runs. Code is currently clean — gates encode the recurring bug classes so regressions trip deterministically.

**Gates**:

| Gate | What it prevents |
|------|------------------|
| **PG1** Webhook signature + dedup | Missing `stripe-signature` read; `constructEvent` (sync) used instead of `constructEventAsync` (Workers-only); no `INSERT OR IGNORE INTO webhook_event` envelope; no `DELETE FROM webhook_event` rollback on 5xx (transient failures become permanent); sub-handler re-implements dedup |
| **PG2** No err.message leak | `err.message` / `error.message` inside any `JSON.stringify(...)` argument across the 10 payment files. Uses balanced-paren extraction (catches single-line and multi-line cases). `err.message` inside `log()` is fine (server-side). |
| **PG3** Enrollment revocation | `DELETE FROM enrollment` forbidden in payment files (must `UPDATE SET revoked_at`); every `FROM enrollment` query must include `revoked_at IS NULL` filter (or be the revocation `UPDATE` itself) |
| **PG4** Atomicity heuristic | Webhook handlers (`billing/_webhook-*.js`) with ≥5 sequential `.run()` calls and zero `db.batch()` get a yellow warn (review for transactional safety). Calibrated as warn not fail — sequential `.run()`s are sometimes legitimate. |

**Commands**:
- `npm run gates:payment` — runs all 4 gates
- `node scripts/gates/validate-payment-pipeline.mjs --gate PG1` — single gate
- `node scripts/gates/validate-payment-pipeline.mjs --json` — machine-readable

**Auto-fires**:
- Pre-commit (in `hooks/pre-commit`) on changes to `functions/api/{stripe-webhook,create-checkout}.js`, `functions/api/billing/*.js`, or the gate script itself
- CI deploy workflow `.github/workflows/deploy.yml` step "Validate payment pipeline gates" runs on every deploy regardless of dispatch shape

**Adding a new payment file**: append to the `PAYMENT_FILES` array in `validate-payment-pipeline.mjs` and to the regex in `hooks/pre-commit`.

## Citation Integrity

**Never insert academic citations from model knowledge.** Hallucinated PMIDs, DOIs, and references are an existential threat to a medical education site.

Citations must come from one of:
- Perplexity research (live web search, verified)
- The RRM Research Library (D1 rrm-library, via rrm-cli)
- Brian directly

When a post needs references, research each one live before inserting. If asked to "add citations" to existing content, look them up via Perplexity or the library first. Never generate a PMID, DOI, or journal reference from memory.

CI enforces this: `scripts/verify-citations.mjs` (v2, multi-API cascade) runs on every blog deploy and blocks publication if any citation fails verification.

## Coding Standards (from 40 /arise runs, 451 findings)

These are the top recurring bug patterns. Violating any of these will be caught by /arise and cost time to fix. Get them right the first time.

1. **Read siblings before writing.** Before creating or modifying an endpoint in `functions/api/`, read every other file in the same directory. Match their patterns for: try/catch wrapping, response shape, auth checks, input validation, error logging. Sibling divergence is the #1 bug category (23% of all findings).

2. **Never return 200 on failure.** If an env var, binding, or dependency is missing, return 503 with `{ error: 'service_unavailable' }`. Never `if (!env.X) return` with an implicit 200. Silent success on failure is #2 (16%).

3. **Validate all input at system boundaries.** Every user-facing parameter needs: type check, length cap, range check. No exceptions. Missing validation is #3 (14%).

4. **Wrap every external fetch in try/catch.** Stripe, AI.run(), Resend, Airtable, Vectorize -- all external calls throw on network errors. The catch block must return structured JSON `{ error: 'descriptive_code' }` with the right HTTP status. Never leak `err.message` to the client. Naked fetches are #4 (9%).

5. **Use consistent response shapes.** Success: `{ results }` or `{ data }`. Error: `{ error: 'code' }` with correct HTTP status (400 client error, 401 unauthed, 403 forbidden, 404 not found, 429 rate limited, 500 server error, 503 unavailable). Never return raw strings, HTML error pages, or `{ ok: false }`. Inconsistent contracts are #5 (8%).

6. **Fix one, grep all.** After fixing a bug pattern in one file, grep the entire codebase for the same pattern and fix every instance. Cross-file "fixed here, missed there" is the single most common recurring bug (22%). This applies to `functions/api/`, `src/lib/`, build scripts, and Astro components equally.

7. **SQL discipline.** sql-issue is the fastest-growing /arise category (+6pp, now 5% of all findings). D1 and SQLite have sharp edges. Follow these rules for every SQL query:
   - **COLLATE NOCASE** on every text comparison (WHERE, JOIN ON, UNIQUE constraints on email/name/slug). SQLite text comparison is case-sensitive by default.
   - **Explicit NULL handling.** `NULL != NULL` in SQL. Use `IS NULL` / `IS NOT NULL`, never `= NULL`. Watch for `WHERE x = ?` silently excluding NULL rows. `UNIQUE` constraints allow multiple NULLs.
   - **UNIQUE constraint awareness.** Know which columns have UNIQUE constraints before writing INSERT. Use `INSERT OR IGNORE` or `ON CONFLICT` for idempotent operations. Bare INSERT will throw on duplicates.
   - **Write-after-read atomicity.** Never read a value, compute in JS, then write back without a transaction. Use `db.batch()` or `BEGIN/COMMIT` for read-modify-write patterns. Token-consumed-before-write-confirmed is the #1 data-loss pattern.
   - **INTEGER vs TEXT types.** SQLite is loosely typed but D1 enforces declared types on some operations. Don't store booleans as "true"/"false" strings -- use 0/1.
   - **datetime format consistency.** Always use ISO 8601 (`datetime('now')` in SQL, `new Date().toISOString()` in JS). Never store Unix timestamps or locale-formatted dates.
   - **ON DELETE CASCADE is inert in D1.** D1 does not run `PRAGMA foreign_keys = ON` per connection. All `ON DELETE CASCADE` / `ON UPDATE CASCADE` declarations in the schema are decorative. Always use explicit child-row cleanup via `db.batch()` before deleting a parent row. Example: `functions/api/admin/faqs/[id].js` DELETE handler.

### Prevention Checklist

Before shipping any new endpoint or modifying an existing one, verify:

- [ ] Every external fetch (Stripe, Airtable, AI.run, Vectorize) wrapped in try/catch
- [ ] Error responses use generic messages, never err.message to client
- [ ] SQL WHERE on email uses COLLATE NOCASE
- [ ] SQL read-then-write patterns use transactions (db.batch or BEGIN/COMMIT)
- [ ] SQL INSERT uses ON CONFLICT or INSERT OR IGNORE for idempotent operations
- [ ] SQL NULL handling is explicit (IS NULL, not = NULL; COALESCE where needed)
- [ ] New endpoint imports and uses CORS_HEADERS from _shared.js
- [ ] Missing env/binding returns 503, not silent 200
- [ ] `if (!env.X)` patterns always have an explicit `return new Response(JSON.stringify({error:...}), {status: 503})`
- [ ] After fixing a pattern in one file, grep for siblings with the same pattern
- [ ] No `${variable}` inside SQL strings -- use `?` params (D1 prepared statements)
- [ ] Write/delete SQL with `user_id =` binds from session (`context.data.user.id`), never from request body
- [ ] Rate limits on any endpoint that calls a billed service
- [ ] ON DELETE CASCADE tables: explicit child cleanup in `db.batch()` (D1 doesn't honor CASCADE)
- [ ] Single-record dispatch endpoints: status guard in fetch script (don't publish drafts)
- [ ] After adding length caps: verify no dead validation for fields not in the target table

### QA Gates (from /arise -- 643 findings, 50 runs)

Two tiers of enforcement. Proof gates are automated and deterministic. Review gates require judgment and context.

**Proof gates** -- automated by `arise-scanner` (`arise-scan --json --files [files]`). Binary pass/fail, <1s, zero judgment. Run before every commit.

| Rule | Scanner ID | What it greps for |
|------|-----------|-------------------|
| External fetch in try/catch | `unwrapped-await` | Stripe/SES/R2/fetch calls outside try blocks |
| err.message not in response | `error-leak` | `err.message` inside `json()` or `Response` |
| COLLATE NOCASE on text WHERE | `collate-nocase` | `WHERE.*email\|slug\|name` without COLLATE |
| db.batch() for multi-writes | `unbatched-writes` | Sequential `.run()` calls without batch |
| Missing env guard | `silent-failure` | `!env.X` patterns without explicit error return |
| No INSERT OR REPLACE | `insert-or-replace` | `INSERT OR REPLACE` (silently overwrites) |
| CASCADE child cleanup | `cascade-cleanup` (candidate) | `DELETE FROM` on parent table without child deletes in batch |
| HTML escapes 5 entities | `html-escape` (candidate) | Template literals with HTML missing `escapeHtml()` |

Scanner rules are the source of truth. If arise-scanner catches it, the coder agent does not re-check it.

**Review gates** -- applied by the `coder` agent when reading/writing code. Require context, sibling comparison, or architectural judgment. Cannot be automated.

| Gate | What the coder agent checks | Gold standard |
|------|----------------------------|---------------|
| R1: Blocked user check | Auth-gated endpoints check `user.blocked` after session validation | `community/_shared.js` `requireMember()` |
| R2: Rate limiting scope | Public endpoints calling billed services (Stripe, SES, R2, Vectorize) have rate limits | `search/semantic.js` IP rate limiter |
| R3: UNIQUE before OR IGNORE | Cross-ref `schema.sql` to verify a UNIQUE constraint exists before using `INSERT OR IGNORE` | `scripts/migrate-faqs-to-d1.sql` UNIQUE on `(faq_id, article_id)` |
| R4: R2 cleanup on delete | DELETE handlers that remove D1 rows also clean up associated R2 objects | Known gap -- zero `R2_ASSETS.delete()` calls exist |
| R5: Status gate in build | Single-record fetch endpoints returning all statuses have a downstream status guard in the build fetch script | `fetch-faq-data.mjs` `fetchSingle()` status check |
| R6: Sibling pattern match | After writing/fixing code, grep the same directory for the pattern and apply consistently | Every /arise run's "fix one, grep all" step |

## Rules

- **When writing RRM content, consult `rrm-cli` first.** The CLI has the correct tone, framing, and citations. Do not default to external sources when the knowledge base has what you need.
  - Voice/framing reference: `rrm-cli search "topic" --intent=voice --full --limit=5`
  - Research citations: `rrm-cli search "topic" --intent=cite --full --limit=10`
  - Specific FAQ answer: `rrm-cli get faq <slug> --full`
  - Related content: `rrm-cli related <type> <slug> --type=article`
  - After using content: `rrm-cli annotate <type> <slug> --key=used_for --value="task description"`
- **When writing or modifying code in `functions/api/`, dispatch the `coder` agent** (`subagent_type: "coder"`). It reads sibling files first, runs arise-scanner proof gates (automated), and applies 6 review gates (R1-R6) requiring judgment. Do not write endpoint code directly -- always use the coder agent.
- **Before editing styles or designing any branded asset, read `docs/design/design-system.json`** (the machine-readable SSOT). Cross-reference `STYLE-GUIDE.md` only for narrative context. Do not guess token names -- if a token is not in the SSOT, it does not exist.
- Never hardcode colors, spacing, or fonts -- use CSS variables that exist in the SSOT
- When editing `src/styles/global.css` or `docs/design/design-system.manual.json`, run `npm run design-tokens` and commit the regenerated `docs/design/design-system.json`. CI will block on drift.
- Keep edits focused, show before/after summaries
- After modifying a guarded file, run `npm run guard:update` before committing
