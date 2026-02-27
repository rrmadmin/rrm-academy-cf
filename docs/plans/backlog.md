# RRM Academy — Backlog

> Living document. Check before starting any session.

## Bugs

(none)

## To Do

- **Cancel Vimeo subscription** ($25/mo saved) -- Stream player confirmed working in production
- **Delete temporary CF API token** (`3h-YUCih...`) created for Stream signing key -- no longer needed
- **Meet recording pipeline** -- design doc at `docs/plans/2026-02-25-meet-recording-pipeline-design.md`, depends on STUC community tables

## Design Decisions

- **CTA buttons stay Purple 700 everywhere**: "Support this work" on library synopsis pages, "Donate", course enrollment, etc. -- all CTAs use `btn--primary` (Purple 700 `#725e7e`). Rose/pink palette is for accents and backgrounds only, never action buttons. Keeps brand consistency across the site.
- **Button sizing on lesson pages uses default `.btn`**: Mark Complete, Previous/Next, and Post all use the base `.btn` size (10px/24px). No `btn--sm` or `btn--lg` variations within the lesson player.
- **Course pages use `must-revalidate` cache**: `/courses/*` gets `Cache-Control: public, max-age=0, must-revalidate`. All `/api/*` routes get `no-store`.

## Done (Recent)

- Next Lesson button step locking — Next button now disabled in `fixedOrder` courses when current step is incomplete, unlocks on mark-complete / video end / quiz pass (2026-02-26)
- Build-time security guard — `scripts/guard.mjs` checks SHA256 hashes of critical files, enforces CORS/webhook/auth invariants, scans for secrets; runs as pre-commit hook + CI (2026-02-26)
- Endo survey validate endpoint — created missing `/api/survey/validate` that was blocking all survey takers ("expired" error on every magic link) (2026-02-26)
- Auto-create accounts on anonymous Stripe checkout — webhook `ensureAccountForCheckout()` creates D1 account with empty password, sends welcome email with 7-day password-setup link (2026-02-26)
- Checkout account endpoint — `/api/billing/checkout-account` lets thank-you pages detect auto-created accounts for 3-state messaging (2026-02-26)
- Thank-you page 3-state logic — donate + STUC thank-you pages show contextual message: linked (logged in), account created (check email), or create account (fallback) (2026-02-26)
- Login differentiates passwordless accounts — Google-only vs auto-created accounts get distinct error messages pointing users to the right login method (2026-02-26)
- Donation history on account page — billing API returns one-time donations + subscription payments, collapsible list shows most recent with "Show all" toggle (2026-02-26)
- `customer_creation: 'always'` on one-time donation checkout — forces Stripe to create Customer for anonymous donations so webhook can link them (2026-02-26)
- Two-column profile/password card + Member Since date on account page (2026-02-26)
- Google OAuth fix — set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` secrets, fixed redirect URI to use `SITE_URL` instead of `url.origin` (2026-02-26)
- CSS fix: donation row `hidden` attribute overridden by `display: grid` (2026-02-26)
- Library synopsis share button icon changed from Lucide 'link' to 'forward' (2026-02-26)
- Community inline images + bare domain URL detection — R2 upload endpoint, `linkify()` renders `![alt](url)` as `<img>`, auto-links `rrmacademy.org/...` style URLs (2026-02-26)
- Community feed fully inline — comments, replies, edit modal, comment reactions all in-feed, no detail page navigation (2026-02-26)
- Saved articles cross-device sync nudge for guests (2026-02-25)
- Quiz response recording -- new `quiz_response` D1 table captures individual answers (2026-02-25)
- Dead code cleanup -- removed unused API endpoints, CSS, functions (2026-02-25)
- Dark mode persistence fix -- localStorage save on OS detection (2026-02-25)
- Removed `vimeoId` fields from courses.json (2026-02-25)
