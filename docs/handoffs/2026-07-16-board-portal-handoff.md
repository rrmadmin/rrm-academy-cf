# HANDOFF: Board portal — professionalize /admin/ + board-member access

**From:** 2026-07-16 session (Brian, verbatim ask: "formalize/professionalize shadcn-ize the /admin/ dashboard so the different board members can log in and get access to nonprofit details too")
**Status:** NOT STARTED. This doc is the brief. Read fully before any code.
**Context that motivates it:** RRMF board restructuring in flight (see `~/iCode/projects/rrm-foundation/governance/2026-07-board-restructuring/`): board becoming Naomi (Chair) + Bailey (Secretary) + Erin Callaghan + Rebecca Vavilov (Treasurer), Brian moving to staff ED. Directors need a professional window into the nonprofit: financials, grants, compliance, governance docs. Treasurer specifically needs oversight surfaces (monthly financial summary).

## Two decisions to put to Brian FIRST (do not assume)

**D1 — what "shadcn-ize" means here.** The house doctrine is vanilla CSS/JS primitives, NO React/Tailwind (STYLE-GUIDE.md + skills/CLAUDE.md; several house primitives ARE literal shadcn ports already: `stats-2`, `area-chart`, watermelon family — see `apply-house-primitives` skill + its `references/catalog.md`).
- Option A (RECOMMENDED): shadcn-QUALITY, not shadcn-the-library — normalize every /admin/ page onto a shared admin shell (sidebar nav, consistent header, card grid) built from house tokens + the existing shadcn-port primitives. `/admin/email` (Email Observatory) is the exemplar page: stats-2 count-up tiles + area-chart, built via apply-house-primitives.
- Option B: literal shadcn via Astro React islands on /admin/ only. Breaks house doctrine; needs Brian's explicit override and a written design-system exception. Do not choose silently.

**D2 — where board access lives.**
- Option A (RECOMMENDED): role-gated section IN the app. D1 `rrm-auth.user` already has a `role` column; sessions already flow via `functions/api/admin/_middleware.js` (best-effort populate; each endpoint enforces). Add role `board`; new section `/board/` (distinct from operational `/admin/`, which stays Brian/admin-only); directors log in with normal accounts.
- Option B: CF Access email-OTP subdomain (precedent: reports.rrmacademy.org, memory `rrm-training-reports-gated-site`) — zero app-auth code, but a second surface, static-only content, no per-role logic. Fine for a stopgap "board packet" site; weaker as the long-term portal.

## Recommended scope (phased)

**P0 — auth + shell (one session)**
- `role='board'` handling: shared `requireRole(context, ['admin','board'])` helper; NEGATIVE TESTS mandatory (anon 401, member 403, board 200, board CANNOT hit admin-only endpoints; IDOR checks per the coder-agent bug patterns).
- `/board/` layout: shared admin shell (D1 decision applied), nav: Overview · Financials · Grants · Compliance · Documents · Board & Policies.
- Seed board accounts for the 4 directors (invite flow or manual insert + welcome-password path — reuse existing auth; note the STUC empty-password lockout bug class, memory `stuc-member-access-incidents`: set passwords via the existing reset flow, never empty-hash).

**P1 — content surfaces (1-2 sessions)**
- **Overview:** org KPIs reusing existing admin data (members, library size, courses, traffic) as stats-2 tiles.
- **Financials (Treasurer's page):** v1 = monthly summary table (revenue, expenses, cash) hand-entered/synced by ED from the ledger (source of truth: RRM Finance Master Sheet / `projects/rrm-foundation` bookkeeping); simple D1 table `board_financial_summary`. Do NOT wire Bluevine live in v1.
- **Grants:** read-only portfolio view. Easiest source: the grant tracker SSOT already syncs `tracker.yaml` -> rrm-grant-scan worker KV on push; expose a read endpoint or reuse the sheet embed. Show status colors like the Google Sheet (status palette in `skills/grant-tracker-sheet/rebuild_portfolio.py` STATUS_COLORS).
- **Compliance calendar:** static-ish D1 table: 990/990-N due dates, SAM renewal (2027-07-09), PA annual report (2027), D&O renewal, board meeting calendar.
- **Documents:** governance library (minutes, consents, COI policy, strategy). Source files live in the PRIVATE repo `rrmadmin/RRM-Foundation` `governance/`. Publishing path: `board_document` D1 table (title, category, date, r2_key) + private R2 bucket + upload endpoint (admin-only) + signed/streamed GET (board+admin). NEVER commit governance docs into the public site repo.
- **Board & Policies:** roster, officers, COI annual-statement status checkboxes.

**P2 — polish:** primitives everywhere, print-to-PDF "board packet" view (directors love paper), mobile pass at 393px, light-only styling (Brian HARD-prefers light; memory `feedback-artifacts-light-mode-only` — apply the spirit to this internal surface).

## Hard rules for the implementing session
- `functions/api/` changes go through the **coder agent** (MANDATORY per iCode CLAUDE.md — sibling-dense dir).
- Aggregates only on board surfaces: NO member PII, NO survey/symptom data, nothing from content-plane stores. Board sees the org, not the users.
- Board role must NOT reach: ADMIN_API_SECRET endpoints, email observatory sends, dm-queue, cleanup, ecosystem.
- CI: css-audit ratchet + hash gates are CI-only (memory `rrm-academy-cf-ci-only-gates`); deploy choreography per memory (one branch, one push, claude/* auto-merge).
- Verify with `/rrma-local-shots` screenshots at 393x852 before "done"; run the `verify` skill on the auth boundary (negative tests live, not just unit).
- OG/meta rule does NOT apply to authed pages, but add `noindex` + exclude /board/ from sitemap + Pagefind.

## Pointers
- Repo CLAUDE.md + STYLE-GUIDE.md (read first, as always) · `src/pages/admin/*.astro` (12 pages today) · `functions/api/admin/_middleware.js` (session populate pattern) · `functions/api/auth/_shared.js` · `/admin/email` = design exemplar · `apply-house-primitives` skill + catalog · reports.rrmacademy.org CF Access pattern (memory `rrm-training-reports-gated-site`) · governance sources: `~/iCode/projects/rrm-foundation/governance/`.

**Estimate:** P0+P1 ≈ 2-3 focused sessions. Start only after 07-23/07-24 grant submissions land.
