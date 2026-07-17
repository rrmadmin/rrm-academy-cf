# HANDOFF: Board portal — professionalize /admin/ + board-member access

**From:** 2026-07-16 session (Brian, verbatim ask: "formalize/professionalize shadcn-ize the /admin/ dashboard so the different board members can log in and get access to nonprofit details too")
**Status:** NOT STARTED. This doc is the brief. Read fully before any code.
**Context that motivates it:** RRMF board restructuring in flight (see `~/iCode/projects/rrm-foundation/governance/2026-07-board-restructuring/`): board becoming Naomi (Chair) + Bailey (Secretary) + Erin Callaghan + Rebecca Vavilov (Treasurer), Brian moving to staff ED. Directors need a professional window into the nonprofit: financials, grants, compliance, governance docs. Treasurer specifically needs oversight surfaces (monthly financial summary).

## Decisions

**D1 — RESOLVED by Brian, 2026-07-16, verbatim:** "basically i hate my admin dashboard. about 50% is dead or not functional and it needs to have a left sidebar like a REAL dashboard. shadcn has some good code to start with."
- This is the explicit owner override of the house vanilla-primitives doctrine, FOR /admin/ (and /board/) ONLY. Public site stays on the house design system untouched. Do not re-litigate; build with literal shadcn.
- Starting point: shadcn dashboard blocks (left-sidebar shell: the `sidebar-07` / `dashboard-01` family at ui.shadcn.com/blocks) via Astro React islands (`@astrojs/react`) with Tailwind SCOPED to admin routes.
- Known CI friction to solve deliberately, not by surprise (memories `rrm-academy-cf-ci-only-gates`, `rrm-academy-local-build-regenerates-files`):
  1. Tailwind preflight/base must NOT leak into public-site CSS: prefix or selector-scope (e.g. generate under `#admin-root`), or a CSS entry imported only by admin layouts.
  2. css-audit ratchet + design-token "no phantoms" audit run repo-wide; shadcn CSS variables + utilities will trip baselines. Bump `scripts/css-audit/baseline.json` intentionally in the same PR and document the admin-route exception.
  3. Bundle isolation: React only on /admin + /board routes (`client:only="react"` or full-page islands); zero React on public pages.

**D0 (NEW, do FIRST) — kill-list audit of the existing 12 pages.** Brian: ~50% dead or not functional. Before any shell work, triage each of backlinks / campaign-report / community / content / conversions / dm-queue / email / enrollments / index / partners / revenue / seo: does the page load, does its API respond, is the data current, does Brian use it? Verdict per page: KEEP (port to new shell) / FIX (small repair, then port) / KILL (delete page + endpoint + nav). Get Brian's 10-minute sign-off on the kill list before building; the rebuild ports only KEEP+FIX pages.

**D2 — where board access lives.**
- Option A (RECOMMENDED): role-gated section IN the app. D1 `rrm-auth.user` already has a `role` column; sessions already flow via `functions/api/admin/_middleware.js` (best-effort populate; each endpoint enforces). Add role `board`; new section `/board/` (distinct from operational `/admin/`, which stays Brian/admin-only); directors log in with normal accounts.
- Option B: CF Access email-OTP subdomain (precedent: reports.rrmacademy.org, memory `rrm-training-reports-gated-site`) — zero app-auth code, but a second surface, static-only content, no per-role logic. Fine for a stopgap "board packet" site; weaker as the long-term portal.

## Recommended scope (phased)

**P0 — kill-list audit (D0) + auth + shadcn shell (one session)**
- Run D0; Brian signs the kill list.
- Stand up the shadcn left-sidebar shell (nav groups: Dashboard / Content / Community / Revenue / Marketing / Board), topbar, breadcrumbs; React-island architecture with scoped Tailwind per D1.
- `role='board'` handling: shared `requireRole(context, ['admin','board'])` helper; NEGATIVE TESTS mandatory (anon 401, member 403, board 200, board CANNOT hit admin-only endpoints; IDOR checks per the coder-agent bug patterns).
- `/board/` layout: same shadcn shell, board-role nav group: Overview · Financials · Grants · Compliance · Documents · Board & Policies.
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

**Estimate:** D0 ~half a session; P0+P1 ≈ 3-4 focused sessions (shadcn island infra adds setup). Start only after 07-23/07-24 grant submissions land.
