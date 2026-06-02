<!-- Status: DRAFT — awaiting Brian's spec review (2026-06-02) -->
# RRM for Policymakers — Course Series Design

**Date:** 2026-06-02
**Project:** rrm-academy-cf (rrmacademy.org)
**Status:** Draft — design approved 2026-06-02; spec under review before planning.

## 1. Goal

A seven-course series on rrmacademy.org that makes policymakers **literate and prepared** on Restorative Reproductive Medicine: what it is, how it helps women, why women want it, how to talk about it accurately, how to respond to criticism, and how effective women's-health policy is structured.

The series serves two layered jobs (per the approved design):
1. **Be the cited reference** — a neutral, evidence-first front door that legislators, agency staff, and their researchers can cite.
2. **Equip the prepared advocate** — give policymakers the language, the rebuttals, and the policy-design principles to act credibly.

## 2. Audience

- US **state legislators and their staff** (health-committee staff, policy aides).
- **Federal / agency** staff (HHS, the MAHA agenda; congressional health staff).

Written for a time-poor, non-clinical reader. Each course is short and skimmable.

## 3. Guardrails (non-negotiable)

- **No tie to any specific grant or program.** Do not name the PA Rural Health Transformation grant, MAHA ELEVATE, or any active funding line. The content is general education.
- **No org-vs-org naming in copy.** Criticisms are addressed substantively but attributed generically ("critics argue…", "some professional bodies question…"). The *research* behind Course 6 catalogs the real criticisms (including those ASRM has advanced) so the rebuttals are real; the *published copy* names no organizations.
- **Nonpartisan legislation content.** Course 7 teaches how durable, effective women's-health policy is *structured* — principles, not "pass bill X." This keeps the content inside the 501(c)(3) education line with zero lobbying exposure. No specific bill is named.
- **Not a patient funnel.** No "book with Dr. Whittaker" CTAs. Patient pathways, if referenced at all, point to `/providers/`. Per the standing rule, rrmacademy.org must not route patients to Naomi.
- **Institutional voice, not patient-marketing.** Measured, evidence-first, non-promotional. Closest SSOT register is the Foundation `institutional-voice-canon.md`.
- **Mockup gate.** All seven courses are authored and staged on localhost for Brian's review. Nothing is published live until Brian gives explicit go-live. "Ship it / fix all" covers the technical code change only, never the content publication.
- **Every factual claim and statistic is verified** against the `rrm-cli` knowledge base / canon before it lands. No unverified PMIDs or invented stats (verify-before-trust).

## 4. The seven courses

Each course = **3–4 short article lessons + one 5-question quiz + a completion certificate + one downloadable 2-page PDF brief** (the brief is a lesson attachment). Lesson outlines below are the *substance to author*; all factual claims are verified during authoring.

### 1 · What Restorative Reproductive Medicine Is
- **L1** The restorative principle: diagnose and treat the underlying cause; cooperate with physiology rather than override it.
- **L2** How RRM differs from conventional reproductive care and IVF (root-cause vs bypass; cooperative vs suppressive).
- **L3** The building blocks: fertility-awareness-based methods (FABMs) as diagnostic data, medical and surgical treatment, the care model.
- **L4** Where RRM fits in women's health — complements primary/OBGYN care; the practitioner landscape.

### 2 · How RRM Helps Women
- **L1** Treating the cause, not masking symptoms.
- **L2** The conditions RRM addresses — endometriosis, PCOS, recurrent pregnancy loss, infertility, cycle/hormonal disorders (high-level, what RRM does for each).
- **L3** What the evidence shows — outcomes, with honest framing of evidence quality (sourced).
- **L4** Beyond fertility — whole-woman health, the cycle as a vital sign, long-term benefits.

### 3 · What Restorative Surgery Is
- **L1** What restorative/reproductive surgery is — organ-sparing, fertility-preserving aims.
- **L2** Excision vs ablation for endometriosis — why technique matters for outcomes and recurrence.
- **L3** Restoring function — adhesions, tubal/ovarian-sparing, anatomy; surgery as treatment, not last resort.
- **L4** Access and training realities — why few surgeons offer it; the workforce picture policymakers should understand.

### 4 · Why Women Choose RRM
- **L1** The unmet need — what conventional care leaves on the table.
- **L2** Autonomy and values — informed choice; alignment with personal/health values; wanting answers, not bypasses.
- **L3** What women report wanting — demand-side, grounded in real patient voice, careful not to overclaim.
- **L4** The equity/access dimension — who can and can't access RRM today, and why it matters for policy.

### 5 · Talking About RRM
- **L1** Get the terminology right — RRM, FABM, NaProTechnology, "restorative"; what each means and common mix-ups.
- **L2** Common misconceptions and how to correct them (RRM is not "the rhythm method"; not anti-IVF; not religious-only).
- **L3** How to discuss RRM accurately and non-politically — keep it about women's health and evidence.
- **L4** A short policymaker reference glossary / cheat-sheet (also the PDF brief).

### 6 · Responding to Criticism of RRM
*Myth-vs-evidence. Organizations are not named in copy; rebuttals are sourced to real studies/positions.*
- **L1** The posture — engage criticism constructively, evidence-first, not defensive.
- **L2** "The evidence base is weak / lacks RCTs" — what's true, what's misleading, what the research actually shows (sourced).
- **L3** "Fertility-awareness methods don't work" — efficacy data; typical vs perfect use; diagnostic vs contraceptive use (sourced).
- **L4** "RRM is anti-IVF / ideological" — separating clinical practice from politics; RRM as an option, not an opposition.

### 7 · Building Effective RRM Policy
*Nonpartisan, educational. No specific bill named.*
- **L1** What durable women's-health policy looks like — principles of effective, evidence-based health policy.
- **L2** Coverage and access design — what makes coverage/parity provisions actually work (general principles).
- **L3** Workforce and training — policy levers for building practitioner capacity.
- **L4** Common pitfalls — how well-meaning provisions fail; designing for measurable outcomes.

## 5. Voice & sourcing

- Register: institutional/educational — measured, non-partisan, evidence-first, non-promotional (Foundation `institutional-voice-canon.md` is the closest SSOT). Warmer where the subject is women's experience (Courses 2, 4), but never marketing.
- Byline: **By RRM Academy / Reviewed by Dr. Naomi Whittaker, MD.** Org is author/provider; Naomi is reviewer.
- Sourcing: draft every factual claim from `rrm-cli` (library articles, facts, glossary). Verify each statistic and any criticism-rebuttal against the actual source before it lands. Course 6 in particular must rebut the *real* documented criticisms.

## 6. Reading-access change (technical, ships independently)

**Problem:** today the lesson player redirects any logged-out or non-enrolled visitor off the lesson back to the course detail page (`src/pages/courses/[slug]/[stepId].astro:323`), because `GET /api/courses/progress` returns `401 {ok:false}` without a session and the client treats `!ok` as "redirect." A policymaker in a browser therefore cannot read a lesson without creating an account and enrolling — hostile to the audience and weak for citation.

**Change (page-only, surgical):** in `[stepId].astro`, when the course `access_type === 'public'`, do **not** redirect on `!data.ok`. Instead:
- Render the lesson body read-only (the body is already server-rendered via `set:html`, so no data change needed).
- Replace the progress / "Mark Complete" / quiz controls with a "Log in to take the quiz and earn your certificate" prompt plus the existing enroll button.
- Members/private courses keep today's exact behavior (members paywall, redirect for non-members).

**No API change is required** — the progress endpoint's 401 is fine; the quiz endpoint already shows "sign in to access this quiz." If planning surfaces any `functions/api/courses/*` edit, it routes through the **coder agent**. The `.astro` change is kept minimal and matched to existing sibling patterns.

**JSON-LD `reviewedBy` (decided 2026-06-02 — include in this change):** add `reviewedBy: { "@id": "#naomi-whittaker" }` to the Course JSON-LD, mirroring the glossary precedent (`author = #organization`, `reviewedBy = #naomi-whittaker`). Ships as part of this access-change commit, not deferred.

This change is **technical**, not content-publication — it can deploy on its own ahead of the content go-live.

## 7. Data model mapping (D1 `rrm-auth`, via `/courses-update` skill + admin endpoints — never raw SQL)

Per course:
- `access_type='public'`, `is_free=1`, `price_cents=0`, `self_paced=1`, `coming_soon=0`.
- `has_certificate=1`, `certificate_quiz_step_id=<the course's quiz step id>`.
- `instructors_json`: lead = "RRM Academy"; reviewer entry = "Dr. Naomi Whittaker, MD". (Naomi auto-resolves to canonical `@id` in the template.)
- `includes_json` / `faqs_json` / `seo_json`: per-course "what you'll learn," FAQ, and SEO title/description.
- `short_description`: one-liner ending "Part of the RRM for Policymakers series."
- `status`: created as `draft`; flipped to `published` only at go-live.
- `sort_order`: a **contiguous block** so the seven cluster together in `/courses`.

Structure: each course has 1–2 `course_section` rows; each lesson is a `course_step` of `type='article'` carrying `content` (HTML); the quiz is a `course_step` of `type='quiz'`; the PDF is uploaded as a step attachment.

**Byline rendering (decided):** `reviewedBy = #naomi-whittaker` is set in the Course JSON-LD (see §6). The visible "Reviewed by Dr. Naomi Whittaker, MD" line is shown via the course intro/`includes` copy — no course-template change unless a trivial one-liner proves cleaner during planning.

## 8. Quizzes & certificate

- One quiz step per course; definition added to `src/data/quizzes.json` keyed by the quiz step id, shape: `{ type, title, description, passingScore, questions:[{id,text,options,correctIndex}] }`.
- 5 questions each, reinforcing the course's key points (and, for Course 5/6, the correct framing/rebuttals).
- `passingScore` set so the quiz gates the certificate (e.g., 4/5). Exact value and certificate-issuance mechanics confirmed during planning against `functions/api/courses/quiz.js` + `certificate.js`.
- Certificate title surfaced to the learner: **"RRM Policymaker Briefing."**

## 9. PDF briefs (downloads)

- One 2-page branded PDF per course, summarizing the course for take-away (the "download").
- Course 5 brief = the terminology cheat-sheet; Course 6 brief = a myth-vs-fact one-pager; Course 7 brief = a policy-design principles checklist.
- Generated as branded HTML rendered to PDF (RRM design tokens), then uploaded as the step attachment via the attachments admin endpoint (multipart). Exact generation tool (Playwright print-to-PDF vs existing skill) chosen in planning.
- Known gap to respect: R2 attachment orphans on partial upload failure (no auto-cleanup) — verify each upload succeeded.

## 10. Grouping (no schema change)

No native course `category`/`series` field exists. Group the seven by: (a) contiguous `sort_order` block; (b) "Part of the RRM for Policymakers series" in each `short_description`; (c) cross-links among the seven (via `includes`/FAQ/related). No new page, no route, no router change. A dedicated `/policy` series landing is a deliberate later option, not in scope.

## 11. Build flow & gates

1. **Code change** (public-readable lessons) — page-only `.astro` edit; `web-page-qa` at mobile + desktop; deploy; verify a public course lesson is readable logged-out. Ships independently.
2. **Author all content** — 7 courses × (3–4 article lessons + 5-question quiz) + 7 PDF briefs, institutional voice, every claim verified. (Implementation will fan this out across agents with adversarial fact-checking per claim; orchestration detail lives in the plan.)
3. **Stage on localhost** — render all seven for Brian's review. **Mockup gate: nothing live until explicit go-live.**
4. **Go-live (on Brian's word):** create D1 records via `/courses-update` (draft → published), add `quizzes.json` entries, upload PDFs, wire `certificate_quiz_step_id`, set `sort_order` block, dispatch single-record rebuilds, and **verify each `/courses/<slug>/` returns 200** (D1 publish ≠ live).

## 12. Acceptance criteria

- A logged-out visitor can read every lesson of a public policymaker course in a browser with no redirect; members/private courses are unchanged.
- All seven courses live at `/courses/<slug>/`, returning 200, grouped contiguously in the catalog, each with byline "By RRM Academy / Reviewed by Dr. Naomi Whittaker, MD."
- Each course has a working 5-question quiz that gates a "RRM Policymaker Briefing" certificate, and one downloadable PDF brief.
- No organization is named in Course 6 copy; every criticism-rebuttal is sourced. Course 7 names no specific bill.
- No grant/program is named anywhere. No patient-funnel CTA to Naomi.
- Content went live only after explicit go-live.

## 13. Out of scope

- A dedicated `/policy` or series landing page (later option).
- Video lessons.
- Any new D1 schema field (category/series/track).
- Translations / localization.
