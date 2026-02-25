# RRM Academy — Backlog

## Critical

- **Stripe live key mismatch**: `STRIPE_SECRET_KEY` in Pages secrets is a test mode key (`sk_test_...`) but course price IDs in courses.json are live mode. Enrollment checkout fails with "No such price" error. Fix: `npx wrangler pages secret put STRIPE_SECRET_KEY --project-name rrm-academy` with the live key.

## Course Player

- **Next Lesson button bypasses step locking**: The prev/next navigation buttons at the bottom of lesson pages are static HTML links — they always work regardless of completion state. The sidebar correctly locks future steps, but the Next button lets users skip ahead. Fix: either hide/disable the Next button via JS when `fixedOrder` is true and the next step is locked, or rely on the progress API redirect on page load (which already redirects unenrolled users).
- **Questionnaire steps need implementation**: Pre-Class Questionnaire type steps need a UI.

## Stream Migration (remaining)

- **Cancel Vimeo subscription** ($25/mo saved) — Stream player confirmed working in production
- **Remove `vimeoId` fields** from courses.json once Vimeo is fully decommissioned
- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key — no longer needed

## Design Decisions

- **CTA buttons stay Purple 700 everywhere**: "Support this work" on library synopsis pages, "Donate", course enrollment, etc. — all CTAs use `btn--primary` (Purple 700 `#725e7e`). Rose/pink palette is for accents and backgrounds only, never action buttons. Keeps brand consistency across the site.
- **Button sizing on lesson pages uses default `.btn`**: Mark Complete, Previous/Next, and Post all use the base `.btn` size (10px/24px). No `btn--sm` or `btn--lg` variations within the lesson player.
- **Course pages use `must-revalidate` cache**: `/courses/*` gets `Cache-Control: public, max-age=0, must-revalidate`. All `/api/*` routes get `no-store`.

## Resolved

- ~~`token.js` validateSession signature mismatch~~ — fixed in 00d199c
- ~~Stream customer code 1 vs i~~ — fixed in 00d199c
- ~~Scoped CSS on dynamic iframe~~ — fixed in 00d199c
- ~~Video player missing on lesson pages~~ — `fetch-courses-data.mjs` dropped `streamUid` in assembly; fixed by adding it to clean step output (2026-02-25)
- ~~Quiz showing "Coming Soon" instead of questions~~ — stale `quizzes.json` with empty `questions: []` baked into CF Pages Functions bundle; fresh deploy picked up populated data. Also added superadmin auto-enroll and specific error messages (2026-02-25)
- ~~Quiz CSS not applying to dynamic content~~ — all quiz/result selectors wrapped in `:global()` — fixed in d0f8800 (2026-02-25)
- ~~Quiz styling needs work~~ — radio buttons and form layout fixed alongside `:global()` CSS fix (2026-02-25)
- ~~Continue button starts on lesson 2 instead of lesson 1~~ — `resumeStep === firstStepId` guard stayed true when first step was incomplete; replaced with `foundIncomplete` boolean flag (2026-02-25)
- ~~Discussion section too wide on lesson pages~~ — added `max-width: var(--max-width-article)` and auto margins to `.lesson-comments` to match other content sections (2026-02-25)
- ~~Inconsistent button sizes on lesson pages~~ — removed `btn--sm` from Previous/Next and Post buttons; all now use default `.btn` size (2026-02-25)
- ~~Course pages served stale cache~~ — added `Cache-Control: public, max-age=0, must-revalidate` for `/courses/*` and `no-store` for all `/api/*` routes (2026-02-25)
