# Honen-Style Courses Upgrade: Multi-Format Lessons + AI Tutor

**Date:** 2026-06-06
**Status:** Approved design, pending implementation plan
**Decided with:** Brian (brainstorming session 2026-06-05/06)
**Revised 2026-06-06 after /arise --deep spec review (28 findings folded in).**

## 1. Goal

Clone the learner-facing core of Honen (honen.com, StudyFetch's AI course platform) for rrmacademy.org courses:

1. **Multi-format lessons**: each lesson offers the same material as switchable tabs: Watch / Read / Cards / Quiz / Listen. Learner picks the format that clicks.
2. **AI tutor (chat)**: a persistent "Ask the Tutor" chat in every lesson, grounded on approved RRM content, cited, Socratic, aware of lesson context and learner progress.

Explicitly chosen sequencing: learner experience first. Honen's creator-side generator becomes authoring-side Claude Code tooling (Section 6), not product UI.

### Non-goals (deferred, out of this spec)

- Voice tutor (realtime STT/TTS)
- In-product creator / course-generator UI
- Games, role-play scenarios, rubric-graded projects
- Analytics dashboard (engagement events ARE collected; the dashboard is a later project)
- Spaced repetition across sessions (flashcard pile state is localStorage only)
- Tutor thread persistence (session-ephemeral; per-answer Save reuses existing ask/saved infra)
- LMS / LTI interop
- A runtime transcript store. The tutor's lesson context reads only the published reading rendition; there is no separate transcript-text store at runtime. A future `transcript` rendition format could add one, but it is deferred (see 5.3).

## 2. Current-state facts this design builds on

- Courses are D1 SSOT (`rrm-auth`: `course`, `course_section`, `course_step`), 3 step types (`video`, `article`, `quiz`), authored only via admin endpoints.
- **Debt 1:** `course_step` has no content column; `article` steps render a placeholder. Article content is effectively unsupported.
- **Debt 2:** quiz content lives in static git-committed `src/data/quizzes.json` (4 steps), read via a build-time import in `functions/api/courses/quiz.js`, protected by a `git checkout HEAD` restore step in `deploy.yml` (line 105) and by `scripts/guard.mjs` (a REQUIRED-files entry near line 328 plus a content-validity block at lines 369-386 asserting the parsed JSON has entries and no empty `questions[]`).
- `/ask` (`functions/api/ask.js`) is a production auth-gated, KV-rate-limited, SSE-framed RAG chat; the `rrm-ai-search` worker (`projects/rrm-ai-search/src/index.js`) accepts a per-request `editorialPrompt` and (on its `/search` endpoint only) filtered retrieval; citations are proof-gated to live pages.
- Source material for generation: 177 structured video transcripts (`tools/video-ingest/out/`, with `key_claims[]` and timestamped sections), ~30 podcast structured files, 3,370+ library articles, verified `facts` table, `rrm-cli check-guardrails` / `check-facts`.
- TTS precedent is local-only (`tools/generate-commentary-audio.py`, Chatterbox). No production TTS service, and none is needed (audio is batch-generated at authoring time).

## 3. Data model and content read path

### 3.1 New table: `step_rendition` (rrm-auth)

```sql
CREATE TABLE step_rendition (
  step_id TEXT NOT NULL REFERENCES course_step(id),
  format TEXT NOT NULL CHECK (format IN ('reading','flashcards','quiz','audio')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source TEXT,              -- provenance: 'transcript:<uid>', 'migrated:quizzes.json', 'manual'
  word_count INTEGER,       -- reading only; thin-content parity with existing pattern
  duration_seconds INTEGER, -- audio only
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, -- timestamps set by endpoint code (existing convention; avoids datetime('now') gotcha)
  PRIMARY KEY (step_id, format)
);
```

No secondary index. The only hot read path is per-course "which formats are published" (3.3 build query) and per-(step,format) point reads (3.3 runtime endpoint); both are served by the `(step_id, format)` primary key prefix. The earlier `idx_step_rendition_status` index is dropped (status is never a leading filter on its own; it is always conjoined with a `step_id IN (...)` set the PK already covers). See finding #25.

`course_step` is untouched. `type` now means "primary rendition". No CHECK recreate.

**FK is decorative; explicit cleanup is mandatory.** D1 does not run `PRAGMA foreign_keys = ON`, so the `REFERENCES course_step(id)` clause does not cascade. Every existing FK-consumer / cleanup list MUST gain `step_rendition`:

- **Step DELETE** (`functions/api/admin/courses/[id]/steps/[stepId].js`): the existing batch (which already guards `step_progress` / `quiz_response` / `lesson_comment`) gains `DELETE FROM step_rendition WHERE step_id = ?`. For any `format='audio'` rendition the handler also deletes the backing R2 object (`R2_ASSETS.delete(...)`) per review gate R4 (see 3.4, 7, 26).
- **Course DELETE** (course admin endpoint): its `db.batch()` cleanup gains `DELETE FROM step_rendition WHERE step_id IN (SELECT id FROM course_step WHERE course_id = ?)`, executed BEFORE the `course_step` rows are removed (otherwise the subquery resolves to nothing). Audio R2 objects for the course's steps are deleted in the same handler.
- **Section DELETE** (`functions/api/admin/courses/[id]/sections/[sectionId].js`): it deletes the section's `course_step` rows, so its cleanup batch ALSO gains `DELETE FROM step_rendition WHERE step_id IN (SELECT id FROM course_step WHERE section_id = ?)` plus audio R2 deletion for those steps. (Found by the Phase 0 G1 sibling grep, 2026-06-06: the original spec listed only step and course DELETE.)

Rationale for explicit cleanup beyond "FKs are decorative": **step-ID reuse.** Step IDs are human-meaningful and have been reused before; an orphaned `step_rendition` row left behind by a deleted step would silently re-attach to a future step that reuses the ID, serving stale (and possibly paid) content under a new lesson. Explicit deletion closes that hazard.

### 3.2 Payload shapes (content_json)

| format | shape | per-format size cap |
|--------|-------|---------------------|
| `reading` | `{ html }` rich HTML with callout boxes (`key-insight`, `misconception`) and glossary term cards linking to `/glossary/`. Precedent: `glossary_term.body_html`; player already renders article HTML via `<Fragment set:html>`. | `content_json` <= 80,000 bytes |
| `flashcards` | `{ cards: [{front, back, source_claim_id?}] }` | `content_json` <= 32,000 bytes |
| `quiz` | identical to today's `quizzes.json` entry shape (`type: 'quiz'\|'questionnaire'`, `passingScore`, `questions[]`). Migration of the 4 existing quizzes is mechanical; `quiz.js` scoring logic ports unchanged; `certificate_quiz_step_id` integrity untouched. | `content_json` <= 32,000 bytes |
| `audio` | `{ r2_key, voice, duration_seconds }`. File in R2 (`R2_ASSETS`, `courses/audio/<step_id>.mp3`), never inline. The rendition GET returns this metadata; the binary streams from a sibling gated function (`GET /api/courses/audio?stepId=`) that runs the SAME access checks (3.3.1) then streams the R2 object with Range support. | `content_json` <= 1,000 bytes (metadata only) |

**Size caps enforced server-side before the write** (PUT and the generation pipeline write alike). A `content_json` payload over its per-format cap is refused with `400 {ok:false,error:'content_too_large'}`. The reading cap (80,000 bytes) sits under D1's ~100KB single-statement limit with headroom for the surrounding statement. Precedent: the existing 50,000-char description cap on the course admin surface. A reading that exceeds the cap is split or trimmed at authoring time, never stored truncated.

**XSS: server-side HTML sanitization on every reading write.** The `reading.html` field is rich HTML rendered with `<Fragment set:html>` (no Astro escaping), so it must be sanitized server-side before it is stored. Sanitization runs on every reading PUT AND on the generation pipeline's output before its admin write (Section 6), through the same sanitizer:

- Allowlist of tags: `p`, `h2`-`h4`, `ul`/`ol`/`li`, `strong`, `em`, `a` (with `href` restricted to `http:`/`https:` URIs), `blockquote`, `figure`/`figcaption`, `img` (with `src` restricted to approved hosts), and `aside`/`div` restricted to the callout-box / glossary-term-card class allowlist.
- Strip: `<script>`, `<style>`, `<iframe>`, all `on*` event-handler attributes, and any `javascript:` URI.

Empty/whitespace-only HTML is a separate rejection (`content_empty`, 3.4), not a sanitizer pass-through. See findings #12, #15, #18.

### 3.3 Read path: runtime, not build-time (key decision)

- The static build only learns WHICH formats exist per step. The `renditions: ['reading', ...]` array (published formats only) is added in **`functions/api/courses.js` `mapStep()`** (the public, build-feeding mapper). `src/lib/fetch-courses-data.mjs` has no mapper of its own; it passes the field through unchanged. The THREE admin mappers (`functions/api/admin/courses/[id].js`, `.../steps.js`, `.../steps/[stepId].js`) do NOT get the field: the admin/authoring surface reads formats via the new GET renditions-list endpoint (3.4), so the divergence is intentional and must not be "fixed" later by adding `renditions` to the admin mappers. See finding #14.
- The per-course build query that populates `renditions[]` is explicit:
  `SELECT step_id, format FROM step_rendition WHERE step_id IN (<the course's step ids>) AND status = 'published'`.
  The `(step_id, format)` primary-key prefix covers `step_id IN (...)`; no extra index is needed (3.1, #25).
- The baked `renditions[]` array is a RENDER HINT for the tab bar only. It is NEVER an access-control input (see 3.3.1, #7).
- ALL rendition content is fetched at runtime via one new gated endpoint:

`GET /api/courses/rendition?stepId=&format=`

#### 3.3.1 Gate (the trust anchor)

The endpoint resolves the owning course from LIVE D1 keyed only on `stepId` (and `format`), never on a caller-supplied course id. The single resolving query:

```sql
SELECT s.course_id,
       s.status       AS step_status,
       c.status       AS course_status,
       r.content_json,
       r.status       AS rendition_status
FROM step_rendition r
JOIN course_step s ON s.id = r.step_id
JOIN course c      ON c.id = s.course_id
WHERE r.step_id = ? AND r.format = ?
```

Content is served ONLY if `rendition_status`, `step_status`, AND `course_status` are all `'published'`. **`course_step.course_id` is the trust anchor; the endpoint never trusts a caller-supplied courseId for access.** Enrollment, `requireMember()`, and fixed-order step-lock all run against the RESOLVED `course_id` from this query, mirroring `quiz.js` / `stream/token.js`.

Why all three statuses are checked at read time: un-publishing a step or course does NOT auto-flip its `step_rendition` rows to `archived`. A published rendition under a now-draft course/step would otherwise still serve. The live three-way JOIN is therefore the mandatory kill switch, and it makes the baked `renditions[]` array (which may briefly lag, see #3) irrelevant to access (#7).

Quiz answers are stripped server-side as today.

Rationale for runtime delivery:
1. Paid/member lesson content never bakes into public static HTML (player pages are noindex but publicly fetchable; baked readings would leak paid content).
2. Content edits to an already-published format go live instantly with no redeploy and no progress reset. Adding or removing a format requires a single-course rebuild to update the tab bar (see 3.6, "living courses" nuance, #3).
3. `courses.json` stays small.

#### 3.3.2 Access gate matrix

| Case | Behavior |
|------|----------|
| `stepId` has no `course_step` row (affiliate/override step, or unknown id) | `404 {ok:false,error:'rendition_not_available'}` (no D1 step row to resolve, treated as missing) |
| Member course (`access_type='members'`) | live `requireMember()` against the resolved course; membership IS the grant |
| Paid course | active enrollment row (`revoked_at IS NULL`) against the resolved course |
| FREE public course | a valid session only; an enrollment row is NOT required. This mirrors `stream/token.js`'s all-free skip and is an intentional divergence from `quiz.js`, which gates on enrollment for all courses. Documented here so the divergence is not "corrected" later. |

#### 3.3.3 Error taxonomy

Shapes follow the `{ok:false,error}` sibling convention. Draft, archived, and nonexistent renditions are deliberately INDISTINGUISHABLE to the caller:

| Condition | Response |
|-----------|----------|
| rendition draft / archived / nonexistent; or step/course unpublished | `404 {ok:false,error:'rendition_not_available'}` (identical for all, no information leak) |
| `format` not in `VALID_FORMATS` | `400 {ok:false,error:'invalid_format'}` |
| `JSON.parse(content_json)` throws | `500 {ok:false,error:'server_error'}` (logged internally, parse detail never leaked) |
| not authenticated / not enrolled / not a member | `401` / `403` per the gate matrix, sibling shapes |

The player treats a `404` from a tab it previously rendered as a graceful "this format is no longer available" state, not an error toast. This covers the brief window during a format-removing rebuild (3.6, #3).

### 3.4 Admin CRUD

`/api/admin/courses/[id]/steps/[stepId]/renditions` (GET list, PUT upsert per format, DELETE) following the existing admin pattern: session + admin/superadmin role, input validation, `VALID_FORMATS` Set. All edits route through admin endpoints, never raw SQL (extend the `/courses-update` skill with a renditions workflow).

**Ownership chain.** Every rendition write first verifies the step belongs to the course: `SELECT 1 FROM course_step WHERE id = ? AND course_id = ?` (404 `step_not_found` otherwise), matching the step-admin sibling pattern in `[stepId].js` (which selects `WHERE id = ? AND course_id = ?` before any mutation). See finding #19.

**Write semantics (idempotent upsert).** PUT is `INSERT INTO step_rendition (...) VALUES (...) ON CONFLICT(step_id, format) DO UPDATE SET ...`. This makes re-running the generation skill after a partial failure safe (documented as such in Section 6). The generation skill NEVER overwrites a row whose `source = 'manual'` OR whose `updated_at` is newer than the skill's read timestamp; such conflicts are skipped and surfaced in the review HTML rather than clobbered. See finding #20.

**Empty-payload rejection.** Per-format non-empty validation before the write: reject `flashcards.cards: []`, `quiz.questions: []`, and empty/whitespace-only `reading.html` with `400 {ok:false,error:'content_empty'}`. Intentional removal of a format is a DELETE, never an empty PUT. See finding #18.

**Size caps + sanitization** run before the write per 3.2 (`content_too_large`; reading HTML sanitized).

**Certificate-quiz integrity guard.** A rendition DELETE, or any PUT that empties or sets `status='archived'` on a `format='quiz'` rendition, MUST refuse with `409 {ok:false,error:'step_referenced_as_certificate_quiz', courseId}` when the step is referenced as any course's certificate quiz. This ports the existing guard from the step admin endpoints verbatim: `SELECT id FROM course WHERE certificate_quiz_step_id = ?` (`[stepId].js` lines 184-206, 304-313). A learner mid-certification must never lose the quiz that gates their certificate. See finding #8.

### 3.5 Debt retirement

- `article` steps render their published `reading` rendition; the placeholder bug is gone WHEN a published reading rendition exists. An article step with no published reading rendition keeps today's placeholder + Mark Complete (no regression). See 4.1 and finding #21.
- `quizzes.json` migrates to D1 rendition rows. After the soak window (8.2.4), the static file, its build-time import in `quiz.js`, the D1 fallback, the `deploy.yml` `git checkout HEAD` restore token, and the two `guard.mjs` entries are retired together. The full ordered procedure and its six retirement touchpoints are in 8.2.4.

### 3.6 Rollback posture

Zero published renditions = exactly today's behavior. The tab bar renders only when published renditions exist. The feature is inert by default.

Kill switches differ by scope, because of the build-hint vs live-gate split:

- **Content kill (immediate):** flipping a rendition `status` to `draft`/`archived` (or un-publishing its step/course) blocks the CONTENT instantly via the live three-way JOIN (3.3.1). No redeploy needed. The dead tab keeps showing until the next rebuild, but activating it returns the graceful "no longer available" 404 state (3.3.3).
- **Tab-bar kill (next rebuild):** the dead tab disappears from the bar only after the baked `renditions[]` array is refreshed by a single-course rebuild (3.3, #3). This is the same machinery that already handles course publish.

A content edit to an already-published format is instant (no redeploy, no progress reset). ADDING or REMOVING a published format changes the step's published-format set, so it fires the existing `repository_dispatch { course_id }` single-course rebuild (`deploy.yml` line 144 -> `fetch-courses` single-mode) to update the tab bar; that rebuild takes minutes. See finding #3.

## 4. Player UX and progress semantics

### 4.1 Tab bar (`src/pages/courses/[slug]/[stepId].astro`)

- Fixed order: **Watch / Read / Cards / Quiz / Listen**. Only existing published formats render (Watch only when `stream_uid` present). Default-active tab = primary rendition (`course_step.type`).
- Client-side show/hide; rendition content lazy-loads on first activation via the gated endpoint (3.3). Video keeps its existing token hydration untouched.
- **Step-locking is per-step, never per-format.** All format tabs of an unlocked step are unlocked; the secondary tabs of a locked step are gated by the same fixed-order step-lock as the primary rendition (the rendition endpoint re-checks the lock against the resolved course, 3.3.1). See finding #28.
- **Missing-primary fallback.** An article step whose primary `reading` rendition is not (yet) published renders today's placeholder + Mark Complete, no regression (3.5, #21). The capability ships in Phase 0; the generated content that removes the placeholder ships in Phase 2.
- Tab logic lands as extracted components, not more inline script (player is already ~2,305 lines).
- Design tokens from `docs/design/design-system.json`. Mobile 393x852 Playwright verification before done.

### 4.2 Per-tab UX

- **Read:** rich HTML, read-time + word count header (from `word_count`), callout boxes + glossary term cards as site-wide styled components.
- **Cards:** one card at a time, flip on tap, prev/next, shuffle, "got it / again" piles. Pile state in localStorage only, **namespaced by authenticated user id**: key `flashcards:<userId>:<stepId>`, cleared on logout (so a shared device does not leak one learner's pile state to the next). See finding #27.
- **Quiz:** existing quiz UI ported as-is (MC radios, submit, score card, per-question breakdown, retake on fail). Only the data source changes.
- **Listen:** native `<audio>` + playback speed control. File streamed through the gated audio path (3.2 / 26: R2 get + the full 3.3.1 access gate, including rendition `status='published'`). No position persistence in v1.

### 4.3 Progress semantics: deliberately unchanged

- Completion stays anchored to the primary rendition: video = watch-% threshold, reading/article = Mark Complete, quiz-primary steps = quiz submit. Secondary tabs never complete a step.
- `step_progress`, `quiz_response`, fixed-order locking, certificates: all untouched. Quiz attempts from a secondary Quiz tab still write `quiz_response` + `score` (future mastery signal) but do not gate completion unless that step is the cert quiz.
- **Engagement events go through a server endpoint, never a raw client-to-AE write.** A tab-activation event POSTs to a server endpoint that validates (a) the session, (b) that `stepId` belongs to a course the user can access (resolve-and-gate per 3.3.1), and (c) that `format` is in `VALID_FORMATS`, BEFORE the single Analytics Engine (`EVENTS`) `writeDataPoint`. Payload schema: `{ courseId, stepId, format, ts }`. This feeds a future mastery dashboard without building one now and without exposing AE to unauthenticated/forged writes. See finding #24.

### 4.4 Sales page (`[slug].astro`)

Curriculum accordion gets per-step format icons; meta pills may say "X lessons, readings, flashcards, quizzes". No other changes.

## 5. AI tutor (chat)

### 5.1 Endpoint: `POST /api/tutor`

Sibling of `ask.js` reusing its plumbing verbatim: session auth, KV rate limit (`tutor:rate:<userId>:<utcDate>`, increment-before-call with refund-on-upstream-failure), idempotency, Analytics Engine logging, and the SAME single-buffered SSE framing.

**SSE framing is a single buffered frame, exactly like `ask.js`.** The upstream answer is fully computed by the `rrm-ai-search` worker and returned as one JSON body; the Pages function then frames it once via the `sseResponse(...)` helper (`ask.js` lines 80-93: `retry`, one `data:` line, `data: [DONE]`). There is NO token streaming. A mid-stream partial-answer failure is therefore structurally impossible: the function either writes the complete frame or returns a JSON error before any frame is written. See 5.5 and finding #13.

### 5.2 Gating, limits, and input validation

- Request carries `courseId` + `stepId`. **Before any context injection, the server validates `stepId` belongs to `courseId`** against live D1: `SELECT 1 FROM course_step WHERE id = ? AND course_id = ?`, returning `400` on mismatch. Only after that does it gate access and load context. Access follows the SAME gate matrix as the rendition endpoint (3.3.2): free courses require a session only; paid courses an active enrollment (`revoked_at IS NULL`); member courses a live `requireMember()` re-check (membership being the grant, mirroring `stream/token.js`); affiliate stepIds have no D1 row, so the ownership check above 400s them. See findings #2, #23.
- **Input validation at the boundary** inherits `ask.js`'s `validateBody` message rules (`message`: string, required, 2-500 chars; `ask.js` lines 294-299) PLUS explicit `courseId` / `stepId` type + length checks (string, non-empty, length <= 100, matching the step-admin bound of `courseId.length > 100` -> reject). These are handler-level checks named explicitly here because they are NOT part of the shared `ask.js` plumbing and must be added in the tutor handler. See finding #23.
- Rate limits separate from `/ask`: enrolled free users 10/day, members/staff 30/day (tunable constants).

### 5.3 Grounding and generation

Calls the existing `rrm-ai-search` worker `POST /ask` via the `AI_SEARCH` service binding with a composed `editorialPrompt`:

1. Non-negotiable RRM guardrail base from `functions/api/_ask_prompt.js` (never recommend IVF, reframe "unexplained infertility", no fabricated PMIDs, no em dashes).
2. Tutor persona layer: Socratic, encourages before correcting, adapts explanation level, NEVER gives medical advice (educational context only), care-seeking questions route to `/providers/` (hard rule: no patient funnel to Naomi).
3. Injected lesson context, loaded ONLY when the step is confirmed in the gated course (5.2) and the reading rendition is `status='published'` (3.3.1): course title, section, step title, the step's published reading rendition text, and a one-line progress summary.

**Context fallback chain (no transcript tier).** When the step has no published reading rendition, context falls back to step / section / course TITLES only. There is no transcript-excerpt tier: there is no runtime transcript store, so the tutor cannot read transcript text at request time (the transcripts in `tools/video-ingest/out/` are an authoring-time generation input, not a runtime resource). A future `transcript` rendition format could add one; deferred (Non-goals). See finding #11.

**Retrieval v1** is library-wide (all approved RRM content; citations already proof-gated to live pages by the worker's `resolveItems` publish predicates).

**Retrieval v1.1 (cross-repo scope).** Per-course scoping is NOT a `rrm-academy-cf` change alone: it requires modifying the separate `rrm-ai-search` worker repo (`projects/rrm-ai-search/src/index.js`). Today `handleAsk` does NOT accept `body.filters` (only `handleSearch` does, via `sanitizeFilters`); `FILTER_ALLOWLIST` is `{source_type, type, year}`. v1.1 must: (a) make `handleAsk` accept `body.filters`, (b) run them through `sanitizeFilters`, (c) pass the sanitized retrieval filters into `hybridSearch`, and (d) add `course_id` to `FILTER_ALLOWLIST`. Published reading renditions are first indexed into AI Search via the `rrm-library-worker /index/batch` path tagged with `course_id`. Honen-parity "answers only from course material" arrives there. See finding #10.

### 5.4 UI

Persistent "Ask the Tutor" button at the bottom of lesson content (Honen's placement), opening a slide-up panel in the player. Reuses `ask.astro` SSE rendering + citation display (single-frame, 5.1). Thread is session-ephemeral (survives tab switches, dies on page nav). Per-answer Save reuses `functions/api/ask/saved.js` unchanged.

### 5.5 Failure posture

The tutor is additive chrome; the lesson works without it. "Never blocks lesson progress" means the lesson UI tolerates every tutor failure mode, NOT that any access gate is bypassed. Four distinct cases:

| Case | Server behavior | Player behavior |
|------|-----------------|-----------------|
| Missing binding/secret (`DB`, `COMMUNITY_KV`, `AI_SEARCH`, `AI_SEARCH_WORKER_AUTH`) | `503 {error:'service_unavailable'}`, fail-loud (matches `ask.js`'s 503 on missing bindings) so monitoring sees it | friendly "tutor unavailable" message; lesson unaffected |
| KV rate-limit store unavailable | fail-CLOSED `503`; NEVER fail-open onto the billed AI path (a KV outage must not become unlimited free LLM calls) | friendly retry message |
| Upstream timeout / 5xx | refund the rate-limit increment, return the upstream error code/status (mirrors `ask.js` refund-on-failure, lines 318-326) | friendly retry message |
| `401` / `403` (no session / not enrolled / not a member) | the gate response | tutor panel collapses to the player's existing membership-paywall pattern with a join link; no retry loop |

Because the answer is a single buffered frame (5.1), a refund applies cleanly to ANY non-2xx that occurs before the frame is written. See finding #13, #22.

## 6. Content generation pipeline (authoring-side)

A new Claude Code skill (working name `/course-renditions`), invoked per course:

1. **Source resolution:** per step, locate source material: video `structured.json` (matched via stream UID / recording provenance), podcast `structured.json`, or existing article/description text. Steps with no source are flagged, never guessed at.
2. **Generate per step:** reading (rich HTML with callouts + glossary term cards), flashcards (from `key_claims[]`), quiz questions (answerable strictly from lesson material).
3. **Validate before write:** every artifact runs `rrm-cli check-guardrails` + `check-facts`; ungroundable claims are cut. Editorial canon applies (pathology-first titles, no "Yes"-led fertility answers, canonical names). Reading HTML passes through the SAME server-side sanitizer the PUT endpoint uses (3.2) before the admin write.
4. **Write as `draft`** via admin rendition endpoints, never raw SQL. Provenance in `source`. The write is the idempotent `ON CONFLICT(step_id, format) DO UPDATE` upsert (3.4), so re-running the skill after a partial failure is safe; it skips and reports (in the review HTML) any row that is `source='manual'` or newer than the skill's read timestamp rather than overwriting it.
5. **Review gate (hard rule):** the skill emits one review HTML per course with every generated rendition side by side. Nothing flips to `published` without Brian's explicit go-live.

Pilot order: one STUC course first (transcripts exist, members-only blast radius), then the remaining nine D1 courses.

## 7. Audio

- Batch-generated at authoring time from the reading rendition text. Text prep (markdown/citation stripping, number-to-words, sentence chunking) already exists in `tools/generate-commentary-audio.py`.
- **TTS default: Chatterbox locally with a neutral stock voice.** Naomi's voice clone is used ONLY if she explicitly approves AI-narrated lessons in her voice. Until then: neutral voice, labeled "AI-narrated audio version" in the player.
- **Write order is R2-object-first, then the rendition row.** Writing the `audio` row before the MP3 exists would create a Listen tab pointing at a missing object. If the row ever exists without its object (the failure mode to avoid), the Listen tab shows "audio unavailable", never a 500 (see 26).
- Output MP3 to R2 (`courses/audio/<step_id>.mp3`); the `audio` rendition row carries `r2_key` + `duration_seconds`, served through the gated audio path (3.2, 3.3.1, 26).
- **Per-seek recheck cost:** a seekable `<audio>` element issues many Range requests, each hitting the gated audio function. Member-course rechecks on those requests reuse `requireMember()`'s existing 300s KV cache (`member_sub:<id>`), so seeking never triggers per-request Stripe calls.
- Rendition DELETE for an `audio` format deletes the backing R2 object in the same handler (3.1, 3.4, R4).
- Last phase; zero coupling to anything else.

## 8. Testing, gates, deploy choreography

### 8.1 Proof gates and CI

**CS3 (added to `npm run gates:courses`, `scripts/gates/validate-courses-schema.mjs`).** The gate must be EXTENDED, concretely:

- (a) Add `step_rendition` to `COURSE_TABLES`.
- (b) Give the gate a SECOND migration input: the new `migrations/0NN-step-rendition.sql` file (8.2), parsed by the same `parseCreateTableBlocks` / `parseCheckSets` / `parseColumns` machinery already in the gate. (`migrate-courses-to-d1.sql` remains the only input for the original three tables; `step_rendition` lives in the new migration file, not in the one-shot seed.)
- (c) Add the renditions admin endpoint file (`functions/api/admin/courses/[id]/steps/[stepId]/renditions.js`) to `APP_ENUM_FILES`.
- (d) Extend `SET_TO_CHECK`: `VALID_FORMATS` -> `step_rendition.format`. For status, REUSE the existing `VALID_STATUSES` name (the renditions endpoint declares `VALID_STATUSES = {draft, published, archived}`, IDENTICAL to the sibling endpoints' Set and to the rendition status set) mapped to `step_rendition.status`, handled via the gate's existing dual-status special case (the block that already maps `VALID_STATUSES` to both `course.status` and `course_step.status`; it gains `step_rendition.status`). Do NOT introduce a `VALID_STATUS` (singular) name anywhere; the canonical name is `VALID_STATUSES`.
- (e) Add a meta-assertion that CS3 actually compared at least one value-set (a no-op guard, so a refactor that silently stops comparing fails loudly instead of passing vacuously).

(The earlier draft of this spec wrote `VALID_STATUS`; that was an error. The sibling endpoints and the gate use `VALID_STATUSES`, and the rendition endpoint MUST match.)

**Quiz parity gate** (8.2.4c): a DEEP-EQUAL (parsed-object, NOT byte-identical) comparison of each stored `content_json` against its `quizzes.json` entry INCLUDING `correctIndex`, PLUS a scoring round-trip per quiz (submit a known answer set through `POST /api/courses/quiz`, assert identical scores), for all 4 steps INCLUDING the cert quiz `mc-feedback-3`. (Byte-identity was the wrong assertion: JSON serialization order, whitespace, and unicode escaping legitimately differ between a hand-edited static file and a D1 round-trip. Equality must be structural.)

- E2E (`tests/e2e/`):
  - tab bar renders only existing PUBLISHED formats; player renders correctly with zero renditions.
  - rendition endpoint: `401` logged-out, `403` un-enrolled on a paid course, `403` lapsed member on a member course; free public course needs only a session (no enrollment), per the gate matrix (3.3.2).
  - draft/archived/nonexistent rendition all return identical `404 rendition_not_available` (3.3.3).
  - a rendition PUT containing an `onerror` attribute is stored SANITIZED (the attribute stripped), proving server-side sanitization (3.2, #12).
  - quiz GET payload contains no answers (`correctIndex` stripped).
  - certificate-quiz guard: DELETE / archive of the cert-quiz rendition returns `409 step_referenced_as_certificate_quiz` (3.4, #8).
  - audio: a Range request returns `206` with correct bytes; a `HEAD` returns headers with no body; an unsatisfiable Range returns `416`; a draft-audio request returns `403`/`404` (never streams even though the R2 object exists); an R2-missing object returns `404 audio_not_available` (26).
- Existing rituals: `npm run lint` before push; hash-integrity guard (`npm run guard:update`) if middleware/auth files are touched; arise-scan pre-commit; ALL `functions/api/` work through the coder agent; `/arise` pass on rendition + tutor + audio endpoints before deploy.

### 8.2 Deploy order

Deploy choreography, with per-step revert notes (the steps are NOT uniformly "independently revertible"; the quiz retirement, 8.2.4e, is the asymmetric one):

1. **D1 migration to remote BEFORE any referencing code.** The table lives in a NEW file `migrations/0NN-step-rendition.sql` (next number in the `migrations/` sequence, following that directory's convention). `scripts/migrate-courses-to-d1.sql` is NOT modified (it is the one-shot courses seed). `schema.sql` (the doc mirror) gets the table appended in the SAME PR. Apply to remote D1 via `wrangler d1 execute rrm-auth --remote --file=migrations/0NN-step-rendition.sql` BEFORE pushing any code that SELECTs from `step_rendition`. The CS3 gate (8.1) is extended to parse this new file. *Revert:* drop the table (no code references it yet).
2. **Admin endpoints + rendition endpoint + gates** (inert: no published renditions exist). *Revert:* code rollback; the table can stay (unused).
3. **Player tab UI** (renders nothing new until renditions publish). *Revert:* code rollback.
4. **Quiz migration + parity gate + retire static path** (sub-steps 4a-4e below).
5. **Per-course content publish, each gated on Brian's review HTML approval.** *Revert:* flip rendition `status` back to `draft` (instant content kill, 3.6) + a single-course rebuild to drop the tab.
6. **Tutor (independent track; no dependency on steps 1-5).** Lesson-context injection degrades gracefully: when no published reading rendition exists it falls back to step/section/course titles (5.3; NO transcript tier). *Revert:* code rollback.

#### 8.2.4 Quiz migration (ordered sub-steps)

The quiz cluster is sequenced so that a revert is a pure code rollback UNTIL the static file is deleted, and only deletes the file after a full soak:

- **4a. Migrate** the `quizzes.json` entries into `step_rendition` rows (`format='quiz'`, `source='migrated:quizzes.json'`), written `draft` first, then flipped to `published` after 4c verification.
- **4b. Dual-read `quiz.js`.** Rewrite `functions/api/courses/quiz.js` to read D1 FIRST: a real D1 `SELECT content_json FROM step_rendition WHERE step_id = ? AND format = 'quiz' AND status = 'published'` (resolved/gated as today), falling back to the existing static `quizData[stepId]` import only when no D1 row exists. Route this change through the coder agent (it touches an existing scored endpoint).
- **4c. Parity gate.** DEEP-EQUAL (parsed object, NOT byte-identical) the stored `content_json` against each `quizzes.json` entry INCLUDING `correctIndex`, PLUS a scoring round-trip per quiz (submit a known answer set through `POST`, assert identical scores), for all 4 steps INCLUDING the cert quiz `mc-feedback-3`. (8.1.)
- **4d. Soak** with dual-read active for at least one full deploy cycle. D1 is authoritative; the static file is the safety net. During soak, a revert is a code rollback (the file still exists).
- **4e. Retirement (only after soak), enumerating ALL SIX touchpoints:**
  1. `git rm src/data/quizzes.json`
  2. remove the `import quizData from '.../quizzes.json'` import + the D1 fallback branch in `quiz.js`
  3. remove the `git checkout HEAD -- ... src/data/quizzes.json ...` restore token in `deploy.yml` (line 105)
  4. remove the `quizzes.json` REQUIRED-files entry in `guard.mjs` (near line 328)
  5. remove the `guard.mjs` content-validity block that parses `quizzes.json` (lines 369-386)
  6. run `npm run guard:update` (guard.mjs is self-guarded; the manifest must be regenerated and committed in the SAME commit as the guard edits, per the existing guard ritual)

  **Revert runbook:** BEFORE 4e, a revert is a code rollback (D1 unchanged, file present). AFTER 4e, a revert requires RESTORING the file (`git revert`/`git checkout` the deletion), re-adding the `quiz.js` import + fallback, re-adding the `deploy.yml` restore token, re-adding both `guard.mjs` entries, and `npm run guard:update`. Because 4e is asymmetric, it happens ONLY after the 4d soak confirms D1 read parity.

## 9. Phasing summary

| Phase | Ships | Depends on |
|-------|-------|-----------|
| 0 | `step_rendition` (new `migrations/0NN-step-rendition.sql`) + admin CRUD + rendition endpoint + CS3 gate + quizzes.json migration + article-placeholder fallback CAPABILITY | none |
| 1 | Player tab bar: Read / Cards / Quiz tabs live | 0 |
| 2 | `/course-renditions` generation skill + pilot course + rollout to 10 courses + article-placeholder CONTENT (the generated readings that remove the placeholder) | 0 |
| 3 | AI tutor chat in lessons | none (parallel) |
| 4 | Audio renditions (batch TTS to R2) | 0, 2 |

Note: the "article placeholder fix" splits across phases. Phase 0 ships the runtime CAPABILITY (read a published reading rendition, fall back to placeholder when none exists, no regression). Phase 2 ships the generated CONTENT that actually replaces the placeholder. The fix depends on generated content, so it is not a Phase 0 deliverable on its own. See finding #21.

## 10. Risk register

| Risk | Mitigation |
|------|-----------|
| Generated medical content quality | Guardrail + fact validation pre-write; draft-only writes; per-item Brian review gate; nothing auto-publishes |
| Stored XSS via rich reading HTML | Server-side tag/attribute allowlist sanitizer on every reading write AND on generation output (3.2); E2E proves an `onerror` attribute is stripped |
| Player page bloat (~2,305 lines already) | Tab logic as extracted components, not inline script growth |
| Llama 3.3 70B Socratic quality | Model string is one line in the worker; evaluate in pilot before considering an external provider (none currently wired, by design) |
| Content leak via static HTML | Runtime-only rendition delivery with the live three-way status JOIN + enrollment/member gating (3.3.1) |
| Quiz migration regression | Deep-equal (parsed-object) + scoring-round-trip parity gate across all 4 quizzes including the cert quiz, before the static path retires (8.2.4c) |
| Tab bar lags a format add/remove | Adding/removing a published format fires the existing single-course `repository_dispatch { course_id }` rebuild to refresh the baked `renditions[]`; content kill is still immediate via the live gate; the player renders a removed tab's 404 as a graceful "no longer available" state (3.6, 3.3.3) |
| Audio row without its R2 object | R2-object-first write order; rendition DELETE removes the R2 object; missing object yields "audio unavailable", never a 500 (7, 26) |

## 11. Honen feature mapping (traceability)

| Honen feature | This design |
|---------------|-------------|
| Read/Flashcards/Quiz tabs per lesson | Section 3 + 4 (step_rendition + tab bar) |
| Rich readings with callouts + term cards | reading payload + glossary links (sanitized server-side, 3.2) |
| Live Tutor (chat), grounded + cited + Socratic | Section 5 (single-buffered SSE, 5.1) |
| Live Tutor (voice) | Deferred |
| Podcast/audio versions | Section 7 (batch, not realtime) |
| Agentic course generation | Section 6 (authoring-side skill, draft + review gate) |
| Living courses (update without progress reset) | Runtime read path (3.3): content edits to an already-published format are instant with no redeploy; ADDING/REMOVING a format requires a single-course rebuild (minutes) to update the tab bar (3.6) |
| Mastery analytics dashboard | Deferred; engagement events collected now via a gated server endpoint (4.3) |
| Games, scenarios, projects | Deferred |
