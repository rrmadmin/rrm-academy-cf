# RRM Academy — Backlog

> Living document. Check before starting any session.

## Bugs

- **Stripe live key mismatch**: `STRIPE_SECRET_KEY` in Pages secrets is a test mode key (`sk_test_...`) but course price IDs in courses.json are live mode. Enrollment checkout fails with "No such price" error. Fix: `npx wrangler pages secret put STRIPE_SECRET_KEY --project-name rrm-academy` with the live key.
- **Next Lesson button bypasses step locking**: The prev/next navigation buttons at the bottom of lesson pages are static HTML links -- they always work regardless of completion state. The sidebar correctly locks future steps, but the Next button lets users skip ahead. Fix: either hide/disable the Next button via JS when `fixedOrder` is true and the next step is locked, or rely on the progress API redirect on page load.

## To Do

- **Cancel Vimeo subscription** ($25/mo saved) -- Stream player confirmed working in production
- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key -- no longer needed
- **Meet recording pipeline** -- design doc at `docs/plans/2026-02-25-meet-recording-pipeline-design.md`, depends on STUC community tables

## Design Decisions

- **CTA buttons stay Purple 700 everywhere**: "Support this work" on library synopsis pages, "Donate", course enrollment, etc. -- all CTAs use `btn--primary` (Purple 700 `#725e7e`). Rose/pink palette is for accents and backgrounds only, never action buttons. Keeps brand consistency across the site.
- **Button sizing on lesson pages uses default `.btn`**: Mark Complete, Previous/Next, and Post all use the base `.btn` size (10px/24px). No `btn--sm` or `btn--lg` variations within the lesson player.
- **Course pages use `must-revalidate` cache**: `/courses/*` gets `Cache-Control: public, max-age=0, must-revalidate`. All `/api/*` routes get `no-store`.

## Done (Recent)

- Community inline images + bare domain URL detection — R2 upload endpoint, `linkify()` renders `![alt](url)` as `<img>`, auto-links `rrmacademy.org/...` style URLs (2026-02-26)
- Community feed fully inline — comments, replies, edit modal, comment reactions all in-feed, no detail page navigation (2026-02-26)
- Saved articles cross-device sync nudge for guests (2026-02-25)
- Quiz response recording -- new `quiz_response` D1 table captures individual answers (2026-02-25)
- Dead code cleanup -- removed unused API endpoints, CSS, functions (2026-02-25)
- Dark mode persistence fix -- localStorage save on OS detection (2026-02-25)
- Removed `vimeoId` fields from courses.json (2026-02-25)
