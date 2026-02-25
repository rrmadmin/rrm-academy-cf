# RRM Academy — Backlog

## Critical

- **Stripe live key mismatch**: `STRIPE_SECRET_KEY` in Pages secrets is a test mode key (`sk_test_...`) but course price IDs in courses.json are live mode. Enrollment checkout fails with "No such price" error. Fix: `npx wrangler pages secret put STRIPE_SECRET_KEY --project-name rrm-academy` with the live key.

## Course Player

- **Next Lesson button bypasses step locking**: The prev/next navigation buttons at the bottom of lesson pages are static HTML links — they always work regardless of completion state. The sidebar correctly locks future steps, but the Next button lets users skip ahead. Fix: either hide/disable the Next button via JS when `fixedOrder` is true and the next step is locked, or rely on the progress API redirect on page load (which already redirects unenrolled users).
- **Quiz styling needs work**: Radio button options render inline without spacing. Needs proper form layout with vertical stacking and visual selection states.
- **Questionnaire steps need implementation**: Pre-Class Questionnaire type steps need a UI.

## Stream Migration (remaining)

- **Cancel Vimeo subscription** ($25/mo saved) — Stream player confirmed working in production
- **Remove `vimeoId` fields** from courses.json once Vimeo is fully decommissioned
- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key — no longer needed

## Resolved

- ~~`token.js` validateSession signature mismatch~~ — fixed in 00d199c
- ~~Stream customer code 1 vs i~~ — fixed in 00d199c
- ~~Scoped CSS on dynamic iframe~~ — fixed in 00d199c
