# PAA Research: /common-questions-about-rrm

**Start a fresh session with this prompt. Self-contained — don't assume prior context.**

---

## Task

Research Google "People Also Ask" (PAA) questions for the pillar page `/common-questions-about-rrm` on rrmacademy.org and produce a gap report of what's missing vs what's already covered.

## Context

- **Page:** https://rrmacademy.org/common-questions-about-rrm
- **File:** `~/iCode/projects/rrm-academy-cf/src/pages/common-questions-about-rrm.astro`
- **Status:** Published pillar page. Present with proper breadcrumb. UX bug: currently NOT included in `/guides/` index cards (fix separately).
- **Ecosystem SSOT:** `~/iCode/projects/rrm-academy-cf/docs/rrm-academy-ecosystem.json` -> `content.pillar_guides`
- **Style guide:** Read `~/iCode/projects/rrm-academy-cf/STYLE-GUIDE.md` and run `rrm-cli search "rrm" --intent=voice --limit=5` for voice before proposing any content edits.

## Scope

### 1. Pull PAA data
Use whichever tool has fresh SERP data:
- SerpAPI (`op read 'op://Automation/<redacted>/credential'` if it exists — check 1Password Automation vault)
- DataForSEO (check Automation vault)
- Firecrawl or cf-render on a Google SERP (brittle, last resort)

Run PAA queries for these seed terms (all should return PAA boxes):
- "restorative reproductive medicine"
- "what is RRM fertility"
- "NaProTechnology vs IVF"
- "is NaPro effective"
- "RRM vs standard fertility treatment"
- "does restorative reproductive medicine work"
- "fertility awareness methods effectiveness"
- "alternative to IVF"

Expand via the PAA recursion pattern — click each PAA, collect the new PAA questions that appear, go 2 levels deep. Target: 40-80 unique questions.

Also pull:
- Autocomplete suggestions for each seed (Google and Bing)
- Related searches block at bottom of SERP
- AlsoAsked.com if accessible

### 2. Audit the current page
Read `src/pages/common-questions-about-rrm.astro`. Extract every question currently answered on the page. List them verbatim.

### 3. Gap analysis
For each PAA question collected:
- Tag as COVERED (current page answers it), PARTIAL (touched but not direct Q+A), or MISSING
- Cluster into themes (effectiveness, cost, insurance, IVF-comparison, safety, religious-framing [skip per rules], process, providers, conditions-treated)
- Rank by search volume if SerpAPI returned it, otherwise by PAA depth (level-1 > level-2)

### 4. Output
Write two files:

**a) `~/iCode/projects/rrm-academy-cf/docs/research/2026-04-18-common-questions-paa.md`**
- Full raw data: all PAA questions, source, depth, theme
- Current page audit (verbatim questions it already answers)
- Gap list: MISSING + PARTIAL, ranked by priority
- Recommended additions: 8-15 new questions to add, with one-sentence rationale each

**b) `~/iCode/projects/rrm-academy-cf/docs/research/2026-04-18-common-questions-paa.json`**
- Machine-readable version of the gap list for follow-up automation
- Schema: `{ question, source, depth, status: "covered"|"partial"|"missing", theme, priority: 1-5, rationale }`

## Rules (read before writing anything)

- **DO NOT draft answer copy.** Research and gap list only. Voice-gated copywriting goes through Gianna in a separate session.
- **DO NOT include Catholic/religious disclaimer framing** even if PAA surfaces it. HARD RULE — see `memory/feedback-neofertility-no-secular-framing.md` (applies to RRM brand generally: Catholic is a silent draw, not a public disclaimer).
- **DO NOT include "IVF-legitimizing" questions** without flagging them (e.g. "Should I try IVF first?"). Those need editorial review before adding.
- Never recommend IVF. Never call RRM "alternative medicine." Use `rrm-cli` for framing if unsure.
- RRM is for full reproductive health, not just infertility — watch for PAA questions that narrow RRM to fertility only.
- Em dashes forbidden in output (Brian preference).

## Success criteria

- At least 40 unique PAA questions collected with source attribution
- Current page fully audited (every existing Q listed)
- Gap list distinguishes MISSING vs PARTIAL vs COVERED
- 8-15 prioritized recommendations ready for a Gianna draft session
- Both .md and .json files written to `docs/research/`

## Deliverable

Return a 200-word summary to Brian: total PAAs found, how many already covered, top 5 missing questions with theme + priority. Link to the two output files.
