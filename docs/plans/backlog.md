# RRM Academy — Backlog

## Critical

- **Stripe live key mismatch**: `STRIPE_SECRET_KEY` in Pages secrets is a test mode key (`sk_test_...`) but course price IDs in courses.json are live mode. Enrollment checkout fails with "No such price" error. Fix: `npx wrangler pages secret put STRIPE_SECRET_KEY --project-name rrm-academy` with the live key.

## Stream Migration (remaining)

- **Cancel Vimeo subscription** ($25/mo saved) — after confirming Stream player works in production
- **Remove `vimeoId` fields** from courses.json once Vimeo is fully decommissioned
- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key — no longer needed

## Validate Session signature mismatch in token.js

- `functions/api/stream/token.js` calls `validateSession(request, env)` but the actual function signature is `validateSession(db, sessionId)`. Needs fixing: extract `db` from `env.DB` and `sessionId` from cookie first.
