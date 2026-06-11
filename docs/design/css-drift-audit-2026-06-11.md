# CSS Drift & Token-Adherence Audit — rrmacademy.org

> Generated 2026-06-11T04:27:15.167Z by `scripts/css-audit/audit.mjs`. 262 files scanned, 120 CSS chunks parsed, 148 tokens in registry. Parse errors: 0.

## Executive summary

| Severity | Count |
|---|---|
| critical | 17 |
| high | 252 |
| medium | 1087 |
| low | 733 |

| Category | Count | What it means |
|---|---|---|
| raw-px-spacing | 696 | hardcoded px spacing (on-scale = tokenizable; off-scale = drift) |
| raw-color | 627 | color literal instead of a token (tokenizable / near-token / off-palette) |
| dark-unthemed | 168 | hardcoded light-bound color with no dark-theme path |
| type-scale | 160 | font-size outside the documented vocabulary |
| inline-style | 110 | style= attribute bypassing the system |
| selector-divergence | 84 | same selector styled differently across files |
| radius-drift | 65 | border-radius off the 4/8/16/pill scale or hardcoded |
| fallback-divergence | 59 | var() fallback contradicts the defined token value |
| font-weight-unsupported | 38 | weight with no shipped font file — browser-synthesized faux bold/light |
| breakpoint-drift | 30 | media query width outside the documented 640/768/769/1024 set |
| line-height-drift | 24 | line-height outside the global vocabulary |
| undefined-var | 20 | var() references a token that does not exist — silent wrong rendering / dark-mode breakage |
| token-shadowing | 8 | page redefines a global token name |

## Verified accuracy (adversarial sample, 2026-06-11)

A stratified sample of 112 findings (all criticals, all undefined-var and token-shadowing, spread samples of every other category) was adversarially verified by 12 independent agents reading the actual source, instructed to refute each finding. Result: **108 true-positive, 4 false-positive, 0 uncertain (96.4% precision)**. All 4 false-positive root causes were fixed in the scanner and re-gated; the numbers in this report are from the corrected run.

| Category | Sample | Verified precision (pre-fix) | Post-fix |
|---|---|---|---|
| undefined-var | 20/20 | 100% | — |
| selector-divergence | 10/10 | 100% | — |
| token-shadowing | 8/8 | 100% | — |
| raw-color | 15/15 | 100% | — |
| raw-px-spacing | 12/12 | 100% | — |
| inline-style | 8/8 | 100% | display:none + email templates now exempt |
| line-height-drift | 6/6 | 100% | — |
| dark-unthemed | 14/15 | 93% | same-file dark-override suppression added |
| type-scale | 9/10 | 90% | leading-zero normalization added |
| fallback-divergence | 6/8 | 75% | hex-shorthand normalization added |

Notable verified true-positives that are nonetheless **by design** (read context before fixing): certificate HTML (functions/api/courses/certificate.js) is a printable fixed-light document; Pagefind `display:none` metadata spans are functional (now exempt); transactional email templates require inline styles (now exempt).

## Known scanner limitations (from adversarial methodology review)

- **Astro scoping in selector-divergence:** same-named classes in two .astro files compile to disjoint scoped selectors; divergence findings are design-consistency signals (same conceptual element styled differently), not cascade conflicts. All 10 sampled were judged real drift, but treat each as a review item, not an automatic merge.
- **app-shell.css is treated as site-wide** though it loads only on shell routes; its tokens slightly inflate the resolution set and vocabulary.
- **Per-page local tokens launder raw values:** a page declaring `--card-bg: #fff` locally and using it everywhere evades raw-color/dark-unthemed checks on the usage site (definition values are not yet value-checked).
- **functions/ CSS** is only captured when emitted inside a full `<style>` element in a template literal.
- **Inline-style values are not run through the color/spacing checks** — each gets one flat low-severity finding regardless of content.
- **One declaration can emit two findings** (raw-color + dark-unthemed), weighting color issues ~2x in file scores.
- **oklch()/hsl() literals** in pages are not parsed for palette matching (the repo's oklch tokens are matched by exact string only).
- **eink theme** is never specifically checked (dark-mode logic has no eink analogue).

## Roadmap: drift classes the scanner does not yet check

Ranked by the completeness critic; all deterministic to add.

1. **font-family rule** (HIGH): no --font-display/--font-ui tokens exist; 30+ files re-type font stacks by hand; a heading set in the wrong family is invisible to the scanner. (font-weight check WAS added this run: 38 findings.)
2. **Local light-only token definitions without dark counterparts** (HIGH): the laundering gap above.
3. **Transition duration/easing vocabulary** (MEDIUM): 15 distinct durations in use vs 4 documented (histogram now collected).
4. **z-index layer vocabulary** (MEDIUM): values 1-9999 with page elements at 200/1000 able to sit above the z-100 header (histogram now collected; the app-shell spec needed a G-Z-STACK gate for exactly this bug class).
5. **Focus-ring clobbering** (MEDIUM): components setting box-shadow on interactive elements silently erase the global focus ring; `outline: none` without replacement.
6. **Shorthand/longhand and pattern-level divergence** (LOW): .meta-pill vs .members-tier-badge vs .topic-pill are three pill implementations the selector-divergence check cannot see.
7. **box-shadow geometry, letter-spacing, color-mix percentage vocabularies** (LOW).

## Ranked remediation list (by impact = severity x reach)

Reach multiplier: global stylesheets & layouts x5, components x3, pages x1.

| # | File | Score | Findings | Top categories | First fix |
|---|---|---|---|---|---|
| 1 | `src/pages/community/post/[...id].astro` | 388 | 45 | raw-px-spacing (19), raw-color (13), type-scale (6) | Raw color rgba(139,92,246,0.1) in background |
| 2 | `src/pages/courses/[slug].astro` | 356 | 39 | raw-color (11), raw-px-spacing (9), dark-unthemed (6) | Hardcoded light background #efe9f5 — renders unchanged in dark mode |
| 3 | `src/styles/global.css` | 350 | 37 | raw-px-spacing (26), raw-color (8), radius-drift (2) | Raw color #991b1b in color |
| 4 | `src/pages/community/index.astro` | 297 | 177 | raw-px-spacing (79), type-scale (38), selector-divergence (17) | Raw color #1e5c99 in color |
| 5 | `src/components/ArticleHero.astro` | 276 | 60 | raw-px-spacing (40), type-scale (13), fallback-divergence (3) | selector-divergence |
| 6 | `src/pages/library/[...slug].astro` | 264 | 34 | raw-color (10), raw-px-spacing (6), fallback-divergence (5) | Hardcoded light background #fdfaf3 — renders unchanged in dark mode |
| 7 | `src/pages/courses/[slug]/[stepId].astro` | 252 | 30 | raw-color (8), inline-style (6), fallback-divergence (6) | Hardcoded light background white — renders unchanged in dark mode |
| 8 | `src/components/Header.astro` | 237 | 51 | raw-px-spacing (35), raw-color (10), radius-drift (3) | selector-divergence |
| 9 | `src/pages/community/members.astro` | 217 | 89 | raw-px-spacing (36), raw-color (15), fallback-divergence (11) | var(--surface) does not resolve on this page (only defined in src/pages/dev/providers.astr |
| 10 | `src/components/GlossaryTerm.astro` | 201 | 45 | raw-px-spacing (31), type-scale (7), raw-color (4) | raw-px-spacing |
| 11 | `functions/save-the-uterus-club/migrate.js` | 186 | 77 | raw-px-spacing (24), raw-color (23), dark-unthemed (16) | Hardcoded light background #f7f5f3 — renders unchanged in dark mode |
| 12 | `src/components/SearchBar.astro` | 180 | 33 | raw-px-spacing (14), raw-color (12), radius-drift (2) | Hardcoded light background #fff — renders unchanged in dark mode |
| 13 | `functions/ask/s/[token].js` | 158 | 68 | raw-color (26), raw-px-spacing (22), dark-unthemed (14) | Hardcoded light background #faf9f7 — renders unchanged in dark mode |
| 14 | `src/components/CourseCard.astro` | 153 | 18 | raw-color (6), dark-unthemed (5), raw-px-spacing (3) | Hardcoded light background #e0f0ff — renders unchanged in dark mode |
| 15 | `functions/api/courses/certificate.js` | 143 | 74 | raw-color (26), raw-px-spacing (22), dark-unthemed (8) | Hardcoded light background #f5f0f0 — renders unchanged in dark mode |
| 16 | `src/styles/app-shell.css` | 140 | 16 | raw-px-spacing (9), raw-color (4), breakpoint-drift (2) | raw-px-spacing |
| 17 | `src/pages/dev/providers.astro` | 118.5 | 128 | raw-px-spacing (56), raw-color (26), type-scale (19) | Raw color #f57f17 in color |
| 18 | `src/pages/admin/seo.astro` | 116.5 | 114 | raw-color (54), inline-style (26), dark-unthemed (14) | Hardcoded light border #fff — renders unchanged in dark mode |
| 19 | `src/pages/admin/email.astro` | 107 | 79 | raw-color (48), dark-unthemed (18), raw-px-spacing (11) | Hardcoded light border #fff — renders unchanged in dark mode |
| 20 | `src/pages/account/index.astro` | 87 | 30 | raw-color (12), inline-style (6), dark-unthemed (3) | var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, wh |
| 21 | `src/pages/admin/partners.astro` | 83.5 | 62 | raw-color (38), dark-unthemed (13), raw-px-spacing (10) | Hardcoded light border #fff — renders unchanged in dark mode |
| 22 | `src/pages/admin/backlinks.astro` | 79 | 67 | raw-color (34), dark-unthemed (11), inline-style (9) | Hardcoded light border #fff — renders unchanged in dark mode |
| 23 | `functions/events/[slug].js` | 76 | 49 | raw-px-spacing (27), type-scale (8), token-shadowing (6) | Hardcoded dark text color #532e3b — renders unchanged in dark mode |
| 24 | `src/pages/openapi.astro` | 73 | 28 | raw-color (11), raw-px-spacing (9), dark-unthemed (4) | Raw color #16a34a in background |
| 25 | `src/pages/admin/enrollments.astro` | 64 | 48 | raw-color (28), dark-unthemed (10), raw-px-spacing (9) | Hardcoded light border #fff — renders unchanged in dark mode |
| 26 | `src/components/NewsletterSignup.astro` | 54 | 14 | raw-px-spacing (8), fallback-divergence (3), raw-color (1) | raw-px-spacing |
| 27 | `src/pages/glossary/index.astro` | 49 | 26 | raw-color (12), raw-px-spacing (10), dark-unthemed (1) | Hardcoded light background #fff — renders unchanged in dark mode |
| 28 | `src/pages/ivf-success-calculator.astro` | 47 | 23 | raw-color (8), selector-divergence (4), dark-unthemed (2) | Hardcoded light background #fef9ee — renders unchanged in dark mode |
| 29 | `src/pages/donate/index.astro` | 43 | 19 | raw-px-spacing (6), raw-color (5), selector-divergence (3) | Hardcoded light background #e8f5ee — renders unchanged in dark mode |
| 30 | `src/pages/partners/apply.astro` | 43 | 17 | raw-color (5), dark-unthemed (4), type-scale (3) | Hardcoded light background #e8f5e9 — renders unchanged in dark mode |
| 31 | `src/pages/404.astro` | 42 | 22 | raw-color (10), raw-px-spacing (6), type-scale (3) | Hardcoded light background #fef9c3 — renders unchanged in dark mode |
| 32 | `src/pages/endo-survey/take.astro` | 40 | 24 | raw-color (9), inline-style (9), radius-drift (2) | Hardcoded light border #fff — renders unchanged in dark mode |
| 33 | `src/pages/ask.astro` | 39 | 13 | raw-px-spacing (5), raw-color (5), undefined-var (2) | var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, wh |
| 34 | `src/pages/community/archive/masterclass.astro` | 37 | 17 | selector-divergence (9), radius-drift (3), raw-px-spacing (3) | Raw color #1e5c99 in color |
| 35 | `src/pages/admin/conversions.astro` | 36.5 | 32 | raw-color (19), raw-px-spacing (6), dark-unthemed (4) | Hardcoded light border #fff — renders unchanged in dark mode |
| 36 | `src/pages/linkinbio/jointhecall.astro` | 36 | 15 | raw-px-spacing (10), undefined-var (2), raw-color (2) | var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, wh |
| 37 | `src/pages/admin/revenue.astro` | 35 | 30 | raw-color (19), raw-px-spacing (6), dark-unthemed (4) | Hardcoded light border #fff — renders unchanged in dark mode |
| 38 | `src/pages/admin/content.astro` | 34 | 29 | raw-color (18), raw-px-spacing (6), dark-unthemed (4) | Hardcoded light border #fff — renders unchanged in dark mode |
| 39 | `src/pages/commentary/[...slug].astro` | 32 | 4 | selector-divergence (4) | selector-divergence |
| 40 | `src/pages/glossary/[slug].astro` | 32 | 5 | selector-divergence (2), raw-px-spacing (2), line-height-drift (1) | selector-divergence |

## Critical: dark-mode breakage (fix first)

- `src/pages/account/index.astro:724` .profile-edit-form .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/ask.astro:958` .askauth .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/ask.astro:980` .askauth__google { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/community/members.astro:306` .member-card { background: var(--surface, #ffffff) } — var(--surface) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — fallback "#ffffff" always wins (silent, theme-blind). **Did you mean var(--bg-surface)?**
- `src/pages/community/members.astro:307` .member-card { border: 1px solid var(--border, #e8e2d8) } — var(--border) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — fallback "#e8e2d8" always wins (silent, theme-blind). **Did you mean var(--border-color)?**
- `src/pages/community/members.astro:323` .member-card__avatar-wrap { background: var(--border, #e8e2d8) } — var(--border) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — fallback "#e8e2d8" always wins (silent, theme-blind). **Did you mean var(--border-color)?**
- `src/pages/community/members.astro:342` .member-avatar { box-shadow: 0 0 0 3px var(--surface, #ffffff) } — var(--surface) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — fallback "#ffffff" always wins (silent, theme-blind). **Did you mean var(--bg-surface)?**
- `src/pages/community/members.astro:457` .member-card__admin { border-top: 1px dashed var(--border, #e8e2d8) } — var(--border) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — fallback "#e8e2d8" always wins (silent, theme-blind). **Did you mean var(--border-color)?**
- `src/pages/contact.astro:410` .contact-form .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/forgot-password.astro:120` .auth-form .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/linkinbio/jointhecall.astro:89` .jtc-card { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/linkinbio/jointhecall.astro:145` .jtc-btn--outline { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/login.astro:194` .auth-form .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/login.astro:224` .btn--google { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/reset-password.astro:130` .auth-form .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/signup.astro:271` .auth-form .form-input { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**
- `src/pages/signup.astro:305` .btn--google { background: var(--bg) } — var(--bg) does not resolve on this page (only defined in src/pages/dev/providers.astro, which does not apply here) — declaration is invalid at computed-value time. **Closest defined tokens: --color-bg, --admin-bg, --admin-bar-bg**

## High-severity findings

- `src/styles/global.css:681` .access-badge--hostile { color } — Raw color #991b1b in color
- `src/styles/global.css:1675` .editorial-notice { color } — Raw color #6b5a00 in color
- `src/styles/global.css:1689` [data-theme="dark"] .editorial-notice { color } — Raw color #d4c97a in color
- `src/pages/community/post/[...id].astro:1313` .role-badge--admin { background } — Raw color rgba(139,92,246,0.1) in background
- `src/pages/community/post/[...id].astro:1314` .role-badge--admin { color } — Raw color #7c3aed in color
- `src/pages/community/post/[...id].astro:1315` .role-badge--admin { border } — Raw color rgba(139,92,246,0.2) in border
- `src/pages/community/post/[...id].astro:1318` .role-badge--mod { background } — Raw color rgba(34,197,94,0.1) in background
- `src/pages/community/post/[...id].astro:1319` .role-badge--mod { color } — Raw color #16a34a in color
- `src/pages/community/post/[...id].astro:1320` .role-badge--mod { border } — Raw color rgba(34,197,94,0.2) in border
- `src/pages/community/post/[...id].astro:1336` .event-info-card { background } — Raw color rgba(34,197,94,0.06) in background
- `src/pages/community/post/[...id].astro:1337` .event-info-card { border } — Raw color rgba(34,197,94,0.2) in border
- `src/pages/courses/[slug].astro:1219` .course-hero__image--placeholder { background } — Hardcoded light background #efe9f5 — renders unchanged in dark mode
- `src/pages/courses/[slug].astro:1219` .course-hero__image--placeholder { background } — Hardcoded light background #faf3f8 — renders unchanged in dark mode
- `src/pages/courses/[slug].astro:1439` .meta-pill--partner { background } — Hardcoded light background #e0f0ff — renders unchanged in dark mode
- `src/pages/courses/[slug].astro:1440` .meta-pill--partner { border-color } — Raw color #b3d9f7 in border-color
- `src/pages/courses/[slug].astro:1440` .meta-pill--partner { border-color } — Hardcoded light border #b3d9f7 — renders unchanged in dark mode
- `src/pages/courses/[slug].astro:1445` .meta-pill--waitlist { color } — Raw color #92400e in color
- `src/pages/courses/[slug].astro:1445` .meta-pill--waitlist { color } — Hardcoded dark text color #92400e — renders unchanged in dark mode
- `src/pages/courses/[slug].astro:1446` .meta-pill--waitlist { background } — Hardcoded light background #fef3c7 — renders unchanged in dark mode
- `src/pages/courses/[slug].astro:1447` .meta-pill--waitlist { border-color } — Raw color #fcd34d in border-color
- `src/pages/courses/[slug]/[stepId].astro:1708` :global(.qo--sel .lk-opt__dot::after),
  :global(.lk-opt.qo--sel .lk-opt__dot::after) { background } — Hardcoded light background white — renders unchanged in dark mode
- `src/pages/courses/[slug]/[stepId].astro:1742` :global(.ft-input:focus) { box-shadow } — Raw color rgba(147, 51, 234, 0.1) in box-shadow
- `src/pages/courses/[slug]/[stepId].astro:2106` :global(.cert-banner) { background } — Raw color rgba(139, 92, 246, 0.08) in background
- `src/pages/courses/[slug]/[stepId].astro:2106` :global(.cert-banner) { background } — Raw color rgba(139, 92, 246, 0.04) in background
- `src/pages/courses/[slug]/[stepId].astro:2107` :global(.cert-banner) { border } — Raw color rgba(139, 92, 246, 0.2) in border
- `src/pages/courses/[slug]/[stepId].astro:2191` .lesson-comments__input:focus { box-shadow } — Raw color rgba(139, 92, 246, 0.1) in box-shadow
- `src/pages/library/[...slug].astro:930` .editorial-response-callout { background } — Hardcoded light background #fdfaf3 — renders unchanged in dark mode
- `src/pages/library/[...slug].astro:943` .editorial-response-eyebrow { color } — Raw color #8a6308 in color
- `src/pages/library/[...slug].astro:967` .editorial-response-link { color } — Raw color #8a6308 in color
- `src/pages/library/[...slug].astro:1010` .editorial-body a { color } — Raw color #8a6308 in color
- `src/components/CourseCard.astro:236` .course-card__badge--partner { background } — Hardcoded light background #e0f0ff — renders unchanged in dark mode
- `src/components/CourseCard.astro:241` .course-card__badge--waitlist { background } — Hardcoded light background #fef3c7 — renders unchanged in dark mode
- `src/components/CourseCard.astro:242` .course-card__badge--waitlist { color } — Raw color #92400e in color
- `src/components/CourseCard.astro:242` .course-card__badge--waitlist { color } — Hardcoded dark text color #92400e — renders unchanged in dark mode
- `src/components/CourseCard.astro:250` .course-card__image--placeholder { background } — Hardcoded light background #efe9f5 — renders unchanged in dark mode
- `src/components/CourseCard.astro:250` .course-card__image--placeholder { background } — Hardcoded light background #faf3f8 — renders unchanged in dark mode
- `src/components/SearchBar.astro:338` .search-results :global(.sr-chip--active .sr-chip-count) { background } — Hardcoded light background #fff — renders unchanged in dark mode
- `functions/_middleware.js:477` body { background } — Hardcoded light background #faf9f7 — renders unchanged in dark mode
- `functions/_middleware.js:477` body { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/_middleware.js:477` a { color } — Raw color #8b5e3c in color
- `functions/api/courses/certificate.js:140` body { background } — Hardcoded light background #f5f0f0 — renders unchanged in dark mode
- `functions/api/courses/certificate.js:145` body { color } — Hardcoded dark text color #2c2c2c — renders unchanged in dark mode
- `functions/api/courses/certificate.js:153` .certificate { background } — Hardcoded light background #fff — renders unchanged in dark mode
- `functions/api/courses/certificate.js:202` .student-name { color } — Hardcoded dark text color #2c2c2c — renders unchanged in dark mode
- `functions/api/courses/certificate.js:215` .course-title { color } — Hardcoded dark text color #2c2c2c — renders unchanged in dark mode
- `functions/api/courses/certificate.js:241` .details .value { color } — Hardcoded dark text color #2c2c2c — renders unchanged in dark mode
- `functions/api/courses/certificate.js:266` .actions .secondary { background } — Hardcoded light background #fff — renders unchanged in dark mode
- `functions/api/courses/certificate.js:269` .actions .secondary:hover { background } — Hardcoded light background #f5f0f5 — renders unchanged in dark mode
- `functions/api/newsletter/unsubscribe.js:48` body { color } — Hardcoded dark text color #333 — renders unchanged in dark mode
- `functions/ask/s/[token].js:103` body { background } — Hardcoded light background #faf9f7 — renders unchanged in dark mode
- `functions/ask/s/[token].js:104` body { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/ask/s/[token].js:121` .site-header a { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/ask/s/[token].js:157` .citations-section { border-top } — Hardcoded light border #e5e0d8 — renders unchanged in dark mode
- `functions/ask/s/[token].js:163` .citations-section h2 { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/ask/s/[token].js:173` ol.citations li { color } — Hardcoded dark text color #444 — renders unchanged in dark mode
- `functions/ask/s/[token].js:185` .cta-section { background } — Hardcoded light background #f0ebf5 — renders unchanged in dark mode
- `functions/ask/s/[token].js:186` .cta-section { border } — Hardcoded light border #d8cce6 — renders unchanged in dark mode
- `functions/ask/s/[token].js:192` .cta-section p { color } — Hardcoded dark text color #3d2a52 — renders unchanged in dark mode
- `functions/ask/s/[token].js:212` .site-footer { border-top } — Hardcoded light border #e5e0d8 — renders unchanged in dark mode
- `functions/ask/s/[token].js:222` .site-footer a:hover { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/ask/s/[token].js:264` body { background } — Hardcoded light background #faf9f7 — renders unchanged in dark mode
- `functions/ask/s/[token].js:264` body { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/ask/s/[token].js:266` .brand { color } — Hardcoded dark text color #1a1a1a — renders unchanged in dark mode
- `functions/events/[slug].js:402` .link:hover, .body a:hover { color } — Hardcoded dark text color #532e3b — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:53` body { background } — Hardcoded light background #f7f5f3 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:57` body { color } — Hardcoded dark text color #313131 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:69` .site-header { color } — Hardcoded dark text color #313131 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:79` .card { background } — Hardcoded light background #ffffff — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:80` .card { border } — Hardcoded light border #dddbd8 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:88` h1 { color } — Hardcoded dark text color #313131 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:93` p { color } — Hardcoded dark text color #313131 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:128` .btn-secondary { color } — Hardcoded dark text color #313131 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:130` .btn-secondary { border } — Hardcoded light border #dddbd8 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:144` .error-region { background } — Hardcoded light background #fff8f8 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:145` .error-region { border } — Hardcoded light border #e8c5c5 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:147` .error-region { color } — Raw color #5c2a2a in color
- `functions/save-the-uterus-club/migrate.js:147` .error-region { color } — Hardcoded dark text color #5c2a2a — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:155` .off-amount-panel { background } — Hardcoded light background #faf9f8 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:156` .off-amount-panel { border } — Hardcoded light border #dddbd8 — renders unchanged in dark mode
- `functions/save-the-uterus-club/migrate.js:163` .off-amount-panel h2 { color } — Hardcoded dark text color #313131 — renders unchanged in dark mode
- …and 172 more (see findings JSON)

## Selector divergence (page-to-page variation)

- **.post-title** — .post-title styled differently in 2 files (src/pages/commentary/[...slug].astro, src/pages/community/post/[...id].astro) — conflicting: line-height, letter-spacing, margin-bottom, font-size
- **.prose** — .prose styled differently in 3 files (src/pages/commentary/[...slug].astro, src/pages/common-questions-about-rrm.astro, src/pages/faqs/[...slug].astro) — conflicting: margin-bottom
- **.detail-heading** — .detail-heading styled differently in 3 files (src/pages/commentary/[...slug].astro, src/pages/faqs/[...slug].astro, src/pages/library/[...slug].astro) — conflicting: font-size, color
- **.related-grid** — .related-grid styled differently in 3 files (src/pages/commentary/[...slug].astro, src/pages/library/[...slug].astro, src/styles/global.css) — conflicting: grid-template-columns, gap
- **.author-byline__photo** — .author-byline__photo styled differently in 2 files (src/pages/glossary/[slug].astro, src/styles/global.css) — conflicting: width, height
- **.author-byline__text** — .author-byline__text styled differently in 2 files (src/pages/glossary/[slug].astro, src/styles/global.css) — conflicting: gap
- **.abstract** — .abstract styled differently in 2 files (src/pages/library/[...slug].astro, src/styles/global.css) — conflicting: background, border, border-radius, padding
- **.orcid-link** — .orcid-link styled differently in 2 files (src/components/ArticleHero.astro, src/pages/library/[...slug].astro) — conflicting: display, margin-left, vertical-align
- **.sr-only** — .sr-only styled differently in 3 files (src/components/Header.astro, src/pages/ask.astro, src/styles/global.css) — conflicting: clip
- **.pill** — .pill styled differently in 2 files (src/components/ProviderCard.astro, src/pages/dev/providers.astro) — conflicting: gap, font-size, padding, border-radius
- **.search-input** — .search-input styled differently in 2 files (src/components/SearchBar.astro, src/styles/global.css) — conflicting: padding, border
- **.actions** — .actions styled differently in 2 files (functions/api/courses/certificate.js, functions/save-the-uterus-club/migrate.js) — conflicting: margin-top, display, gap
- **.page-wrap** — .page-wrap styled differently in 2 files (functions/ask/s/[token].js, functions/save-the-uterus-club/migrate.js) — conflicting: max-width, margin
- **.site-header** — .site-header styled differently in 3 files (functions/ask/s/[token].js, functions/save-the-uterus-club/migrate.js, src/components/Header.astro) — conflicting: margin-bottom
- **.site-footer** — .site-footer styled differently in 3 files (functions/ask/s/[token].js, functions/save-the-uterus-club/migrate.js, src/components/Footer.astro) — conflicting: margin-top, font-size, color, line-height, padding
- **.container** — .container styled differently in 8 files (functions/events/[slug].js, src/pages/art-registries-and-codes/index.astro, src/pages/femm/index.astro, src/pages/glossary/index.astro, src/pages/naprotechnology/index.astro, src/pages/neofertility/index.astro, src/pages/what-is-rrm/index.astro, src/styles/global.css) — conflicting: max-width, padding
- **.btn** — .btn styled differently in 2 files (functions/events/[slug].js, src/styles/global.css) — conflicting: padding, border-radius, font-weight, font-size, transition, border
- **.btn--primary** — .btn--primary styled differently in 2 files (functions/events/[slug].js, src/styles/global.css) — conflicting: background, color
- **.btn--secondary** — .btn--secondary styled differently in 2 files (functions/events/[slug].js, src/styles/global.css) — conflicting: background, color
- **.card** — .card styled differently in 4 files (functions/save-the-uterus-club/migrate.js, src/pages/dev/providers.astro, src/pages/ivf-success-calculator.astro, src/styles/global.css) — conflicting: background, border, border-radius, padding, box-shadow, transition
- **.btn-primary** — .btn-primary styled differently in 2 files (functions/save-the-uterus-club/migrate.js, src/pages/ivf-success-calculator.astro) — conflicting: display, padding, background, border-radius, font-family, font-size, font-weight
- **.btn-secondary** — .btn-secondary styled differently in 2 files (functions/save-the-uterus-club/migrate.js, src/pages/ivf-success-calculator.astro) — conflicting: display, padding, color, border, border-radius, font-family, font-size, font-weight, transition
- **.auth-intro** — .auth-intro styled differently in 2 files (src/pages/account/index.astro, src/pages/forgot-password.astro) — conflicting: margin-bottom
- **.account-section** — .account-section styled differently in 2 files (src/pages/account/index.astro, src/pages/account/mcp-keys.astro) — conflicting: padding, border-radius
- **.section-header** — .section-header styled differently in 4 files (src/pages/account/index.astro, src/pages/account/mcp-keys.astro, src/pages/library/index.astro, src/styles/global.css) — conflicting: align-items
- **.breadcrumb** — .breadcrumb styled differently in 9 files (src/pages/account/mcp-keys.astro, src/pages/faqs.astro, src/pages/ivf-success-calculator.astro, src/pages/library/topics/[slug].astro, src/pages/original-research/index.astro, src/pages/original-research/lint-identity/index.astro, src/pages/original-research/proof-gates/index.astro, src/pages/original-research/proof-gates/patterns/index.astro, src/styles/global.css) — conflicting: font-size, color, margin-bottom
- **.form-hint** — .form-hint styled differently in 5 files (src/pages/account/mcp-keys.astro, src/pages/contact.astro, src/pages/partners/apply.astro, src/pages/reset-password.astro, src/pages/signup.astro) — conflicting: font-size, color, margin-top
- **.connect-field** — .connect-field styled differently in 2 files (src/pages/agent-auth.astro, src/pages/connect/index.astro) — conflicting: grid-template-columns, gap
- **.author-byline** — .author-byline styled differently in 9 files (src/pages/art-registries-and-codes/index.astro, src/pages/common-questions-about-rrm.astro, src/pages/femm/index.astro, src/pages/glossary/[slug].astro, src/pages/glossary/index.astro, src/pages/naprotechnology/index.astro, src/pages/neofertility/index.astro, src/pages/what-is-rrm/index.astro, src/styles/global.css) — conflicting: color, margin-bottom, padding-bottom, align-items
- **.disclaimer** — .disclaimer styled differently in 8 files (src/pages/art-registries-and-codes/index.astro, src/pages/femm/index.astro, src/pages/glossary/[slug].astro, src/pages/glossary/index.astro, src/pages/ivf-success-calculator.astro, src/pages/naprotechnology/index.astro, src/pages/neofertility/index.astro, src/pages/what-is-rrm/index.astro) — conflicting: font-size, color, margin-top
- **.section-label** — .section-label styled differently in 3 files (src/pages/commentary/index.astro, src/pages/community/events.astro, src/pages/library/index.astro) — conflicting: font-size, color, margin-bottom
- **.table-wrap** — .table-wrap styled differently in 7 files (src/pages/common-questions-about-rrm.astro, src/pages/femm/index.astro, src/pages/glossary/index.astro, src/pages/naprotechnology/index.astro, src/pages/neofertility/index.astro, src/pages/what-is-rrm/index.astro, src/styles/global.css) — conflicting: margin
- **.community-page** — .community-page styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: padding, min-height
- **.post-card** — .post-card styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: padding
- **.post-card__header** — .post-card__header styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: align-items, margin-bottom, gap
- **.post-author-name** — .post-author-name styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: font-weight
- **.post-role-badge** — .post-role-badge styled differently in 4 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro, src/pages/community/members.astro) — conflicting: font-size, font-weight, color, background, padding, border-radius, line-height
- **.post-time** — .post-time styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: color, font-size
- **.post-card__body** — .post-card__body styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: font-size, line-height, color
- **.post-comment-count** — .post-comment-count styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: font-size, color
- **.posts-empty** — .posts-empty styled differently in 3 files (src/pages/community/archive/masterclass.astro, src/pages/community/archive/members.astro, src/pages/community/index.astro) — conflicting: padding, font-size
- **.compose-card** — .compose-card styled differently in 2 files (src/pages/community/events.astro, src/pages/community/index.astro) — conflicting: padding
- **.compose-actions** — .compose-actions styled differently in 2 files (src/pages/community/events.astro, src/pages/community/index.astro) — conflicting: gap
- **.compose-feedback--error** — .compose-feedback--error styled differently in 2 files (src/pages/community/events.astro, src/pages/community/index.astro) — conflicting: margin-bottom, font-size
- **.gate-hero** — .gate-hero styled differently in 2 files (src/pages/community/index.astro, src/pages/community/members.astro) — conflicting: padding
- **.gate-description** — .gate-description styled differently in 2 files (src/pages/community/index.astro, src/pages/community/members.astro) — conflicting: font-size
- **.feed-header** — .feed-header styled differently in 2 files (src/pages/community/index.astro, src/pages/community/members.astro) — conflicting: padding
- **.post-inline-img** — .post-inline-img styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: margin
- **.link-card** — .link-card styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: margin
- **.post-tier-badge** — .post-tier-badge styled differently in 2 files (src/pages/community/index.astro, src/pages/community/members.astro) — conflicting: padding, border-radius, line-height
- **.post-tier-badge--member** — .post-tier-badge--member styled differently in 2 files (src/pages/community/index.astro, src/pages/community/members.astro) — conflicting: background, color
- **.reaction-bar** — .reaction-bar styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: gap
- **.reaction-btn** — .reaction-btn styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: gap, padding, font-size, background, border, transition
- **.reaction-count** — .reaction-count styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: font-size, font-weight, color
- **.comment** — .comment styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: padding
- **.comment--reply** — .comment--reply styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: padding-left, margin-left
- **.comment-time** — .comment-time styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: font-size, color
- **.reaction-btn--sm** — .reaction-btn--sm styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: padding, font-size
- **.event-info-card** — .event-info-card styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: padding, margin-bottom
- **.event-info-row** — .event-info-row styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: margin-bottom
- **.event-info-value** — .event-info-value styled differently in 2 files (src/pages/community/index.astro, src/pages/community/post/[...id].astro) — conflicting: font-size
- **.back-link** — .back-link styled differently in 4 files (src/pages/community/members.astro, src/pages/faqs/[...slug].astro, src/pages/library/saved.astro, src/pages/saved/index.astro) — conflicting: font-size, color, margin-bottom
- **.contact-block** — .contact-block styled differently in 2 files (src/pages/contact.astro, src/styles/global.css) — conflicting: margin-bottom
- **.faq-list** — .faq-list styled differently in 3 files (src/pages/courses/index.astro, src/pages/partners/index.astro, src/styles/global.css) — conflicting: display, gap
- **.faq-item** — .faq-item styled differently in 3 files (src/pages/courses/index.astro, src/pages/partners/index.astro, src/styles/global.css) — conflicting: border-bottom
- **.tier-btn--disabled** — .tier-btn--disabled styled differently in 2 files (src/pages/donate/index.astro, src/pages/save-the-uterus-club/index.astro) — conflicting: cursor
- **.tier-grid** — .tier-grid styled differently in 3 files (src/pages/donate/index.astro, src/pages/partners/index.astro, src/pages/save-the-uterus-club/index.astro) — conflicting: grid-template-columns, margin-top
- **.tier-card** — .tier-card styled differently in 3 files (src/pages/donate/index.astro, src/pages/partners/index.astro, src/pages/save-the-uterus-club/index.astro) — conflicting: text-align, padding
- **.btn--lg** — .btn--lg styled differently in 2 files (src/pages/endo-survey/take.astro, src/styles/global.css) — conflicting: padding
- **.references** — .references styled differently in 5 files (src/pages/femm/index.astro, src/pages/glossary/index.astro, src/pages/naprotechnology/index.astro, src/pages/neofertility/index.astro, src/styles/global.css) — conflicting: font-size
- **.divider** — .divider styled differently in 2 files (src/pages/ivf-success-calculator.astro, src/styles/global.css) — conflicting: margin
- **.stat-card** — .stat-card styled differently in 2 files (src/pages/ivf-success-calculator.astro, src/pages/what-is-rrm/index.astro) — conflicting: background, padding
- **.stat-number** — .stat-number styled differently in 2 files (src/pages/ivf-success-calculator.astro, src/styles/global.css) — conflicting: font-family, font-size
- **.stat-label** — .stat-label styled differently in 2 files (src/pages/ivf-success-calculator.astro, src/styles/global.css) — conflicting: color
- **.chart-figure** — .chart-figure styled differently in 2 files (src/pages/naprotechnology/index.astro, src/pages/what-is-rrm/index.astro) — conflicting: margin
- **.form-row** — .form-row styled differently in 2 files (src/pages/partners/apply.astro, src/pages/signup.astro) — conflicting: grid-template-columns
- **.form-label** — .form-label styled differently in 2 files (src/pages/partners/apply.astro, src/styles/global.css) — conflicting: font-size
- **.admin-bar** — .admin-bar styled differently in 8 files (src/pages/admin/backlinks.astro, src/pages/admin/content.astro, src/pages/admin/conversions.astro, src/pages/admin/email.astro, src/pages/admin/enrollments.astro, src/pages/admin/partners.astro, src/pages/admin/revenue.astro, src/pages/admin/seo.astro) — conflicting: background, color
- **.admin-bar__title** — .admin-bar__title styled differently in 8 files (src/pages/admin/backlinks.astro, src/pages/admin/content.astro, src/pages/admin/conversions.astro, src/pages/admin/email.astro, src/pages/admin/enrollments.astro, src/pages/admin/partners.astro, src/pages/admin/revenue.astro, src/pages/admin/seo.astro) — conflicting: font-family
- **.admin-bar__nav** — .admin-bar__nav styled differently in 8 files (src/pages/admin/backlinks.astro, src/pages/admin/content.astro, src/pages/admin/conversions.astro, src/pages/admin/email.astro, src/pages/admin/enrollments.astro, src/pages/admin/partners.astro, src/pages/admin/revenue.astro, src/pages/admin/seo.astro) — conflicting: display
- **.admin-bar__link** — .admin-bar__link styled differently in 8 files (src/pages/admin/backlinks.astro, src/pages/admin/content.astro, src/pages/admin/conversions.astro, src/pages/admin/email.astro, src/pages/admin/enrollments.astro, src/pages/admin/partners.astro, src/pages/admin/revenue.astro, src/pages/admin/seo.astro) — conflicting: transition
- **.admin-bar__site-link** — .admin-bar__site-link styled differently in 8 files (src/pages/admin/backlinks.astro, src/pages/admin/content.astro, src/pages/admin/conversions.astro, src/pages/admin/email.astro, src/pages/admin/enrollments.astro, src/pages/admin/partners.astro, src/pages/admin/revenue.astro, src/pages/admin/seo.astro) — conflicting: transition
- **.tier-badge** — .tier-badge styled differently in 4 files (src/pages/admin/seo.astro, src/pages/donate/index.astro, src/pages/partners/index.astro, src/pages/save-the-uterus-club/index.astro) — conflicting: font-size, font-weight, border-radius, background, color, padding, letter-spacing
- **.tier-badge--active** — .tier-badge--active styled differently in 2 files (src/pages/admin/seo.astro, src/pages/partners/index.astro) — conflicting: background

## Value-distribution histograms (how many "versions" of each decision exist)

### font-size — 75 distinct values in use

| Value | Uses |
|---|---|
| `0` | 2 |
| `0.8125rem` | 267 |
| `0.875rem` | 163 |
| `0.75rem` | 156 |
| `0.9375rem` | 137 |
| `0.6875rem` | 70 |
| `1.25rem` | 65 |
| `1rem` | 55 |
| `1.125rem` | 53 |
| `1.5rem` | 52 |
| `1.75rem` | 36 |
| `0.625rem` | 23 |
| `1.375rem` | 19 |
| `13px` | 18 |
| `1.0625rem` | 14 |
| `14px` | 14 |
| `15px` | 13 |
| `16px` | 12 |
| `11px` | 11 |
| `2rem` | 9 |
| `.8125rem` | 9 |
| `.75rem` | 8 |
| `12px` | 7 |
| `clamp(2rem, 1.25rem + 2.5vw, 3.25rem)` | 7 |
| `.8rem` | 6 |
| …50 more values | |

### line-height — 24 distinct values in use

| Value | Uses |
|---|---|
| `0` | 2 |
| `1` | 32 |
| `1.6` | 75 |
| `1.5` | 53 |
| `1.7` | 36 |
| `1.8` | 29 |
| `1.3` | 27 |
| `1.4` | 26 |
| `1.55` | 25 |
| `1.75` | 16 |
| `1.2` | 15 |
| `1.65` | 10 |
| `1.15` | 7 |
| `1.25` | 6 |
| `1.1` | 6 |
| `1.35` | 4 |
| `18px` | 4 |
| `1.45` | 3 |
| `20px` | 2 |
| `22px` | 1 |
| `1.08` | 1 |
| `normal` | 1 |
| `15px` | 1 |
| `inherit` | 1 |

### border-radius — 29 distinct values in use

| Value | Uses |
|---|---|
| `0` | 3 |
| `var(--radius-md)` | 165 |
| `var(--radius-pill)` | 87 |
| `var(--radius-sm)` | 68 |
| `50%` | 42 |
| `var(--radius-lg)` | 31 |
| `8px` | 16 |
| `4px` | 15 |
| `3px` | 10 |
| `6px` | 6 |
| `2px` | 5 |
| `10px` | 5 |
| `var(--radius-md, 8px)` | 5 |
| `100px` | 5 |
| `999px` | 4 |
| `1px` | 3 |
| `var(--radius-pill, 9999px)` | 3 |
| `12px` | 3 |
| `0 var(--radius-sm) var(--radius-sm) 0` | 3 |
| `var(--r)` | 2 |
| `0 0 var(--radius-md) var(--radius-md)` | 1 |
| `var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)` | 1 |
| `16px` | 1 |
| `0 var(--radius-md) var(--radius-md) 0` | 1 |
| `var(--radius-lg, 16px)` | 1 |
| …4 more values | |

### font-weight — 7 distinct values in use

| Value | Uses |
|---|---|
| `300` | 1 |
| `400` | 32 |
| `500` | 182 |
| `600` | 331 |
| `700` | 36 |
| `normal` | 2 |
| `bold` | 1 |
