# css-audit

Programmatic CSS drift and token-adherence sweep for rrmacademy.org. Quantifies the
"every page styles things slightly differently" problem so remediation can be ranked
by impact instead of vibes.

## Run

```bash
node scripts/css-audit/audit.mjs                       # summary to stdout
node scripts/css-audit/audit.mjs --json out.json       # full findings
node scripts/css-audit/audit.mjs --md report.md        # ranked markdown report
```

Always exits 0 — it is an audit, not a gate. Scans `src/**/*.{css,astro}` and
`functions/**/*.js` (CSS inside `<style>` template literals), plus inline `style=`
attributes. Excludes node_modules, dist, .claude, .superpowers.

## Checks (13 categories)

| Category | What it catches |
|---|---|
| undefined-var | `var(--x)` that resolves nowhere on that surface. Scope-aware: page/component styles are file-local (Astro scoping); `functions/` HTML never loads global.css; `style={}`/`setProperty` markup definitions count. |
| fallback-divergence | `var(--x, F)` where F differs from the defined token value (dead, misleading fallback) |
| raw-color | color literals: tokenizable (== a token), near-token (RGB dist <= 32), off-palette |
| dark-unthemed | hardcoded light bg / dark text / light border with no `[data-theme=dark]` path (same-file overrides suppress; alpha < 0.5 overlays exempt) |
| raw-px-spacing | px/rem in margin/padding/gap; on the 4px scale = tokenizable, off it = drift. calc() args stripped, not exempted. |
| type-scale | font-size outside global.css + design-system.json vocabulary |
| line-height-drift | line-height outside the global vocabulary |
| selector-divergence | same simple class selector styled with conflicting values in 2+ files. NOTE: Astro scopes page styles, so these are design-consistency findings, not cascade conflicts. |
| token-shadowing | page redefines a global token name |
| inline-style | style= attrs setting real properties (custom-property-only injection, pure display:none, and email templates exempt) |
| font-weight-unsupported | weights with no shipped font file (only Cormorant 400/600 + Inter 400/500/600 ship) — faux bold |
| radius-drift | border-radius off the 4/8/16/pill token scale |
| breakpoint-drift | @media widths outside the documented 640/768/769/1024 set |

Also emits value-distribution histograms (font-size, line-height, border-radius,
font-weight, transition durations, z-index, media breakpoints).

## Ranking

`score = severity weight (critical 10 / high 5 / medium 2 / low 1) x reach`
(global styles & layouts x5, dynamic page templates x4, components x3, pages x1,
admin/dev x0.5).

## Accuracy

A 112-finding stratified sample was adversarially verified on 2026-06-11: 96.4%
precision; all 4 false-positive root causes fixed and gated. Known limitations and
the unchecked-drift roadmap live in `docs/design/css-drift-audit-2026-06-11.md`.

## Proof gates (run after any scanner change)

1. 0 parse errors across all files.
2. Known-positive: `src/pages/community/members.astro` must yield undefined-var
   findings for `--surface` (x2) and `--border` (x3).
3. Known-negative: `--card-accent` in guides/index.astro (markup-supplied) must NOT
   be flagged; defined tokens (`--accent`, `--space-4`) must never be flagged.
4. Totals: findings length == sum(byCategory) == sum(bySeverity).
5. FP regressions: no `#fff` vs `#ffffff` fallback-divergence; no dark-unthemed at
   endo-survey/take.astro:229 (same-file dark override); no type-scale flag for
   `.8125rem` (leading zero).

## Guard modes

| Mode | Where | What |
|---|---|---|
| `--gate-critical` | pre-commit (`hooks/pre-commit`, staged .astro/.css/functions .js) | criticals must be 0. The undefined-var class verified at 100% precision — zero legitimate uses. |
| `--gate` | CI (`deploy.yml` after design-tokens:audit) | criticals 0 AND no category may exceed `baseline.json` (ratchet — counts only go down). |
| `--update-baseline` | manual, after a drain wave | tighten `baseline.json` to current counts. Commit the result. |

Bypass: `CSS_AUDIT_DISABLE=1` or `git commit --no-verify`. Advisory categories
(selector-divergence, type-scale, line-height, inline-style) are ratcheted in
aggregate but never block pre-commit — they need human judgment per finding.

## Documented exceptions (approved 2026-06-11)

- `src/pages/openapi.astro` method badges: GET blue `#2563eb` / POST green `#16a34a`.
  Plus PUT yellow `#ca8a04` / DELETE red `#dc2626`. REST-client convention; deliberately kept off-palette (gate allowlist in audit.mjs). Counted in baseline.

## Divergence exceptions

`divergence-exceptions.json` lists selectors whose cross-file divergence is a
verified deliberate variant (archive reading-view, post-detail controls,
compact-vs-full hub, icon-coupled search geometry). The scanner skips these and
reports the count as `divergenceExcepted`. Margins are excluded from divergence
comparison entirely (placement context, not component identity), and selectors
are compared within cascade domains (src vs functions) since standalone
functions/ HTML never shares a cascade with site pages.
