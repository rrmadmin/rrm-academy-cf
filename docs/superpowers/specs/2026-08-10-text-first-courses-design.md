# Text-First Courses: Free Written Courses on the Rendition Rails

**Date:** 2026-08-10
**Status:** Approved design, pending implementation plan
**Decided with:** Brian (brainstorming session 2026-08-10)
**Builds on:** `2026-06-06-honen-style-courses-upgrade-design.md` (Phases 0-1 shipped; this spec revives Phase 2 refocused on net-new courses)

## 1. Goal

Add brand-new text-first courses to rrmacademy.org/courses/: course products whose lessons are written articles rather than videos. Free with account (signup required to read), quizzes and completion certificates included. Launch set: 2-3 courses.

### Decisions made in brainstorming

| Decision | Choice |
|----------|--------|
| Product | Net-new text-first courses (not Read tabs on existing video courses) |
| Access | Free with account: session-gated content, public indexable sales page |
| Content source | Gianna grounded in library corpus + structured transcripts + existing guides |
| Launch scope | 2-3 courses |
| Assessment | Knowledge-check quizzes + certificate quiz per course |
| Publish gate | Brian reviews every lesson; Naomi signs off once per course |
| Approach | Factory: one small player PR + a `/text-course` generation skill |

### Non-goals

- Flashcards at launch (Cards tab infra exists; a later toggle, generated from readings)
- Audio renditions, AI tutor (Honen Phases 3-4, still deferred)
- Indexable lesson content (lesson pages stay noindex; content stays runtime-gated)
- Paid or members-only text courses (shape supports them later; launch set is free)
- Read tabs on the existing 10 video courses (Honen Phase 2 original scope; separate effort)

## 2. Current-state facts this design builds on

Verified against code and live D1 on 2026-08-10:

- Honen Phase 0 SHIPPED: `step_rendition` table live in `rrm-auth` (4 published quiz rows, the quizzes.json migration), gated runtime endpoint `GET /api/courses/rendition` with the three-way status JOIN trust anchor, admin CRUD at `/api/admin/courses/[id]/steps/[stepId]/renditions` with server-side HTML sanitizer, size caps, empty-payload rejection, idempotent upserts, cert-quiz integrity guard, CS3 schema gates.
- Honen Phase 1 SHIPPED (commit a376f412): player tab bar, `RenditionReading/Quiz/Flashcards/Audio` components, lazy fetch on tab activation.
- Honen Phase 2 (generation skill + reading content) NEVER BUILT. Zero `reading` renditions exist.
- **The gap this spec closes in code:** the player's lazy-loader skips panels marked `data-rendition-primary` (`[stepId].astro` line 1508), and the primary article panel renders `step.content`, a field no mapper emits. An `article`-primary step with a published reading rendition therefore still shows the placeholder. `RenditionReading.astro`'s header comment documents this split.
- Free-course gate already correct for "free with account": the rendition endpoint's gate matrix requires only a valid session for free public courses (no enrollment row). No gate changes needed.
- `quiz.js` dual-reads quiz content from `step_rendition` first. New quizzes are D1 rendition rows; no static file involvement.
- Certificates: `course.has_certificate` + `certificate_quiz_step_id` + existing PDF flow, untouched.
- Catalog: `/courses/` topic filter (`topics_json`), newest-first sort (`created_at DESC`), OG cards from the courses feed. All apply to new courses automatically.

## 3. Product shape

A text course is a normal D1 course row authored via existing admin endpoints. No schema changes.

- `access_type='public'`, `is_free=1`, `price_cents=0`, `has_certificate=1`, `status='draft'` until publish.
- Structure: 4-6 sections; each section 2-4 `article`-type steps; a short knowledge-check `quiz` step ends most sections; final section ends with the certificate quiz step referenced by `certificate_quiz_step_id`.
- Each article step's body is a `reading` rendition (`{html}` with callout boxes and glossary term cards per the Honen payload shape, <= 80,000 bytes, split lessons rather than trim).
- Each quiz step's content is a `quiz` rendition (existing shape: `passingScore`, `questions[]`).
- **Read times:** the skill sets `course_step.duration_seconds` from the reading's word count at ~200 wpm so the player sidebar and the sales-page curriculum accordion show per-lesson read times with zero template changes.
- `topics_json` tagged from the existing 8-tag taxonomy. `instructors_json`: Dr. Naomi Whittaker, canonical byline.
- Sales page (`/courses/<slug>/`) is public and indexable: the SEO front door. Lesson pages stay noindex; lesson content is served only by the session-gated rendition endpoint, never baked into static HTML.

### Launch set (proposed, confirm at outline stage per course)

1. **Understanding Endometriosis**: deepest library corpus; Ad Grants endo campaigns are re-enabled and need a conversion destination; endo survey audience.
2. **Cycle Charting 101** (choosing your method): compare-method guides and method pages are strong existing sources.
3. **RRM 101** (introduction to restorative reproductive medicine): the citation-authority intro; routes care-seeking readers to `/providers/`.

## 4. Player change (the one code PR)

In `src/pages/courses/[slug]/[stepId].astro`:

- For `article`-primary steps, fetch the published reading rendition on page load via the existing `GET /api/courses/rendition?stepId=&format=reading` path and render it into the existing primary `.article-content` panel. Reuse the same fetch/render helpers the secondary Read tab uses; do not duplicate them.
- The static placeholder becomes the no-rendition fallback only (an article step with no published reading rendition behaves exactly as today; zero regression for existing courses).
- **Logged-out state:** a 401 from the rendition fetch renders a "create a free account to read this lesson" panel with signup and login links, mirroring the player's existing membership-paywall pattern. 403/404 keep the graceful "not available" state.
- **Reading vs progress:** reading needs only a session (rendition gate); progress tracking and Mark Complete need the enrollment row, created by the existing one-click free-enroll fast path in `enroll.js` (the sales-page CTA). The signup state links back into that standard flow; no gate changes.
- Read-time header from the endpoint's `wordCount`, same as the secondary Read tab.
- Mark Complete semantics unchanged (`canComplete` already true for article steps).
- Video steps' token hydration path untouched.

The PR is inert for all existing courses: no article-primary step currently has a published reading rendition.

**E2E additions** (`tests/e2e/`): article-primary step with a published reading renders the content; logged-out visitor sees the signup state; article step with no rendition keeps the placeholder; existing rendition-endpoint auth tests already cover the gate.

## 5. `/text-course` skill (the factory)

A new Claude Code skill invoked per course. Five stages, each gated:

1. **Outline gate.** Produce the course outline: sections, lesson titles, quiz placement, per-lesson source pointers (library record ids, transcript files, guide URLs), read-time budget. Brian approves the outline before any prose is written.
2. **Generation.** Per lesson, the `gianna-copywriter` agent writes the reading HTML in Dr. Whittaker's voice, grounded via rrm-cli against library articles, verified facts, structured transcripts (`tools/video-ingest/out/`), and existing guide pages. Guardrail + fact checks (`rrm-cli check-guardrails`, `check-facts`); ungroundable claims are cut. Editorial canon applies: pathology-first titles, no hard-yes fertility answers, canonical names, care-seeking routes to `/providers/`, no em dashes. The main thread orchestrates mechanics only; clinical prose stays in Gianna's lane.
3. **Quizzes.** Knowledge-check and certificate quizzes generated answerable strictly from lesson text, same payload shape as existing quizzes.
4. **Draft writes.** Everything written as `draft` via existing admin endpoints only (course create, sections, steps, rendition PUTs). Never raw SQL. Server-side sanitizer, size caps, and `ON CONFLICT` upserts make re-runs after partial failure safe. Provenance recorded in `step_rendition.source`.
5. **Review + publish gate.** One review HTML per course: every lesson and quiz side by side with source provenance. Brian reviews lesson-by-lesson; Naomi signs off once per course (sign-off recorded in the review doc). Only then flip rendition/step/course statuses to `published`.

The skill also extends the `/courses-update` skill's workflow list with a pointer to itself, so course-edit routing stays coherent.

## 6. Deploy and verification

- **No schema changes, no migrations, no CS3 gate edits.**
- Order: player PR first (lint, tests, E2E, arise pass, single branch, one push). Then per-course: skill run -> review -> publish flip -> `repository_dispatch {course_id}` single-course rebuild -> live verification of the rendered lesson (desktop + 393x852 mobile screenshots), sales page 200, OG card renders.
- **Rollback:** flip course (or any rendition) back to `draft`: content is blocked instantly by the live three-way JOIN; the catalog entry clears on the next rebuild. Same kill-switch posture as the Honen spec.
- The `functions/api/` surface is untouched in the expected case. If any endpoint edit becomes necessary, it routes through the coder agent per repo doctrine.

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| Generated clinical content quality | Grounded generation + guardrail/fact checks + draft-only writes + Brian per-lesson review + Naomi per-course sign-off; nothing auto-publishes |
| Free-content leak into static HTML | Content only ever served by the gated runtime endpoint; sales page carries marketing copy only |
| Player regression on existing courses | Primary-panel hydration is conditional on article-primary + rendition presence; E2E asserts placeholder fallback |
| Signup friction kills completion | Sales page sells before the gate; signup state appears at lesson 1, not mid-course; certificate is the motivator |
| Course quality varies by corpus depth | Outline stage surfaces thin-source lessons before writing; topics chosen for corpus depth |
