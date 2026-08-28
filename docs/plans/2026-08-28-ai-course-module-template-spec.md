# AI Zero to Hero: Module Template Spec (Honen-style)

Date: 2026-08-28. Status: DRAFT for Brian review. Parent plan: `2026-08-28-ai-zero-to-hero-course-track.md`.

The contract every module in all 3 courses is authored against, and the contract the interactive components are built against. Style target: Honen-style interactivity (lesson + retrieval practice + flashcards + applied scenario + progress), emulated natively on rrmacademy.org. No AI tutor in v1.

## Module anatomy (6 parts, fixed order)

| # | Part | Shape | Authoring source |
|---|---|---|---|
| 1 | Orientation | 2-3 sentences: what you'll be able to do after this module, which glossary terms it introduces | Lesson brief |
| 2 | Lesson | 800-1500 words written lesson, text-first. Callout boxes: "Term" (definition card inline), "Clinical hazard" (safety), "Try it" (micro-prompt to run right now) | Full draft, Brian byline |
| 3 | Demo | One screen-recorded demo, 2-5 min, scripted in the lesson brief so recording is a read-through. Embedded video, transcript below | Demo script |
| 4 | Quiz | 5 questions, retrieval practice on THIS module only. Types: multiple choice, true/false-with-why, "spot the problem" (shown an AI output, identify the failure). Instant feedback with 1-2 sentence explanation per answer | Authored with lesson |
| 5 | Scenario | One applied exercise: a realistic clinician situation ("a patient brings you this AI answer...", "this draft contains a fabricated citation...", "decide: AI-appropriate or not"). Learner writes/does the thing, then reveals a worked model answer. Self-check, not graded | Authored with lesson |
| 6 | Flashcards | The module's glossary terms as a reviewable card set (term -> plain definition -> clinical relevance line). Cards accumulate across modules into the course deck | Generated from glossary SSOT |

## Data model (authoring format)

One JSON/frontmatter file per module (exact format decided after the infra audit lands; principle below):

- `module`: id, course, order, title, orientation
- `lesson`: markdown body (callouts as directives/components)
- `demo`: video ref + transcript + script
- `quiz[]`: {type, prompt, choices?, answer, explanation}
- `scenario`: {setup, task, model_answer}
- `terms[]`: glossary term ids (definitions live in the glossary SSOT, never duplicated per module)

Content is data, not bespoke pages: the course player renders any module from this shape, so courses 2-3 are pure authoring.

## Progress + completion

- Per-user, per-module state: `not_started | in_progress | complete`. Complete = quiz submitted (any score) + scenario revealed. No pass/fail gates; retrieval practice, not certification.
- Course progress bar on the course landing page; "resume where you left off".
- Flashcard deck tracks per-card "got it / review again" locally (no server round-trip needed per card flip).

## Gating + access

- Entire track behind existing STUC membership gating (same mechanism as current member content; wiring per infra audit).
- Module 1 of course 1 publicly previewable (marketing surface for membership), everything else gated.

## Style rules

- All components in the RRMA design system (STYLE-GUIDE.md tokens/fonts); no new visual language.
- Exercises PHI-free by construction. Quiz/scenario content never asks the learner to input patient information anywhere, including into third-party AI tools.
- Reading level: clinician-adult but plain; every term defined before use (parent plan structure rule).
- No em dashes in learner-facing copy.

## Infra audit resolution (2026-08-28)

The Honen-style rails ALREADY EXIST in rrm-academy-cf (Honen Phase 1 live; specs `docs/superpowers/specs/2026-06-06-honen-style-courses-upgrade-design.md` + `2026-08-10-text-first-courses-design.md`, the latter approved pending implementation). This template maps onto them:

- Storage: D1 `rrm-auth` (`course` / `course_section` / `course_step` / `step_rendition`), authored via existing admin CRUD. Module = `course_step` (type `article`), parts 2-6 = `step_rendition` rows (`reading` / `quiz` / `flashcards` / new `scenario`).
- Quiz: existing engine (`functions/api/courses/quiz.js`) covers MCQ + questionnaire types; per-question `quiz_response` audit already ships. "Spot the problem" = MCQ with an AI-output excerpt in the prompt.
- Flashcards: `RenditionFlashcards.astro` fully built (flip/shuffle/"Again"/"Got it" piles, localStorage) with ZERO content rows in production; this course is its first real payload. Local-only pile state confirmed as the v1 choice.
- Progress: per-step tracking, monotonic completion, resume, certificates all live. Per-module rollup = client-side grouping from courses.json (cheap, no new API).
- Demos: Cloudflare Stream, existing player hydration.
- Gating: set `access_type='members'` on the course row; `requireMember` + lapsed-paywall + guest-preview states already wired. Public preview of module 1 = the free-with-account gate in the 2026-08-10 spec.

## Build gaps (the only code work)

1. Article-primary reading render bug: `[stepId].astro` `activate()` early-return; the ONE blocking PR for any text-first course (documented in the 2026-08-10 spec, section 2).
2. Logged-out signup panel on rendition 401 (same spec, section 4).
3. `scenario` as 5th `step_rendition` format: CHECK-constraint migration, validator, `RenditionScenario.astro` (reveal-model-answer, self-check; responses can ride `quiz_response`), player renderer entry.
4. Optional: per-module rollup UI in the player sidebar.

Everything else is authoring.
