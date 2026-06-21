# Synopsis Infographics: house-style stat graphics for library pages

Date: 2026-06-21 (revised same day after /arise --deep spec review: 3 CRITICAL, 8 HIGH, 5 MEDIUM, 2 LOW resolved; see Revision Log)
Status: approved design, hardened, held for implementation plan
Owner: Brian
Project: rrm-academy-cf (with a sibling skill in ~/iCode/skills/rrm-infographic)

## 1. Problem

Library research pages (`rrmacademy.org/library/<slug>/`) render the RRM Academy
synopsis as pure text. When a paper carries a clear quantitative finding (a 38%
increase, 62% vs 34%, 1 in 8), that number is buried in prose. Simple, academic
infographic blocks at the top of a synopsis would make the headline finding legible
at a glance, reinforce the synopsis text, and double as reusable assets for
Instagram, press, and email.

The reference that prompted this is realfood.gov's "State of Our Health" stat block
(bold filled bars, large numerals). We are borrowing its clarity, not its aesthetic:
realfood is loud red on black; RRM house style is warm paper, Cormorant numerals,
purple as a restrained authority color.

## 2. Goals and non-goals

Goals:
- A small, fixed catalogue of house-style infographic templates driven by a structured spec.
- One renderer, one source of truth, two render modes: inline on-page (themeable, dark-mode aware) and self-contained (export image files and standalone SVG).
- On-page version is crawlable (numeral stays as selectable DOM text) and retina sharp.
- Every infographic is bound to a registry-verified source or it does not render.
- Render is gated by an explicit per-article approval flag, so nothing appears on a live page until an operator promotes it (the go-live gate).
- Built lights-off to a held branch; the D1 schema migration, the live deploy, and per-article promotion all stay behind explicit go-live.

Non-goals:
- No general charting library (no line charts, scatter, time series, multi-series).
- No auto-extraction of stats from papers without operator confirmation against the source.
- No AI image generation (rrm-image-gen is a separate illustration engine, out of scope).
- No R2 storage for the on-page path (inline SVG needs no stored binary).

## 3. Storage and the spec

### 3.1 Storage (dedicated columns, not the insights blob)

The spec is NOT stored inside the worker-owned `insights` JSON blob. The insights
writer (`rrm-library-worker/src/routes/insights-result.js`) rebuilds that blob from a
fixed key allowlist and `JSON.stringify`s only those keys, so any nested key would be
silently dropped on the next synopsis write. Instead, add two dedicated columns to the
D1 `rrm-library` `articles` table (a schema migration, run before deploy):

- `infographic TEXT` (JSON-encoded spec object, nullable)
- `infographic_approved INTEGER NOT NULL DEFAULT 0`

This decouples the spec from every synopsis writer (no cross-writer overwrite, no
read-modify-write race on a shared blob) and gives a clean render gate that mirrors the
existing `synopsis_approved` pattern. Wire the columns through the worker and build the
same way the repo's canonical "Backfilling new content types" pattern does for
`word_count` (migration plus index, worker SELECT projection, build-side mapper in
`src/lib/fetch-data.mjs`, then drive the template), per rrm-academy-cf CLAUDE.md.

### 3.2 The spec (input contract)

Each infographic is one structured object, JSON-encoded into `articles.infographic`.
The skill also writes the spec to a local file for build, preview, and export runs.

Shared, required fields:
- `template`: one of `single | delta | bars | ratio`
- `eyebrow`: short kicker, for example "Headline finding" (max 28 chars)
- `source`: `{ label, pmid?, doi?, url? }`. At least one of pmid/doi/url plus a label is REQUIRED. Empty strings count as absent. The presence-and-shape check is syntactic (see 3.3); registry verification is a separate, fail-closed step (see 9).

Template-specific fields and per-template invariants (all enforced by validate, see 3.3):

`single` (one headline number):
- `value`: string rendered verbatim, for example "62%". Required.
- `label`: supporting clause, for example "cumulative live-birth rate over 24 months". Required.

`delta` (directional change, polarity aware):
- `value`: string, for example "38%" or "3.2x". Required.
- `direction`: `up | down` (which way the number moved). Required.
- `polarity`: `favorable | unfavorable | neutral` (is that good or bad for the patient or the RRM thesis). Required.
- `label`: clause. Required.

`bars` (2 to 3 comparison bars):
- `unit`: for example "%". Required.
- `caption`: short context line. Required.
- `bars`: array of 2 or 3 `{ name, value:number, hero?:boolean }`. Exactly one `hero` (rendered purple); the rest render muted grey. Each `value` is a finite number, `>= 0`, and `<= 100` when `unit` is `%`.

`ratio` (proportion / pictograph):
- `numerator`: integer, `0 <= numerator <= denominator`. Required.
- `denominator`: integer, `1 <= denominator <= 20`. Required.
- `label`: clause. Required.

`direction` and `polarity` are intentionally decoupled. "Miscarriage risk up" is
`direction: up, polarity: unfavorable` and renders clay, not green.

### 3.3 Validation contract (validate.ts is pure and synchronous)

`validate.ts` is a pure function shared by the renderer, the component, and the CLI. It
performs NO network calls. It enforces, and returns typed errors for, all of:
- unknown `template` rejected
- `source`: at least one of pmid/doi/url present and non-empty after trim, plus a non-empty `label`; identifier shape checked syntactically (PMID `^\d+$`, DOI `^10\.\d{4,}/`, URL parseable). Syntactic only; resolution is the skill's job (see 9).
- all template-specific required fields present (per 3.2)
- `bars`: exactly 2 or 3 entries; exactly one `hero`; each `value` finite, `>= 0`, and `<= 100` when `unit === '%'`
- `ratio`: `denominator` integer in `[1, 20]`; `numerator` integer in `[0, denominator]`
- `delta`: `direction` in `{up, down}`; `polarity` in `{favorable, unfavorable, neutral}`
- `eyebrow` max 28 chars; every operator string field rejected if it contains an em dash (U+2014) or en dash (U+2013), so the house ban is enforced at the input boundary, not only by a post-render grep

## 4. The four templates (bold register)

Default register is bold: filled columns, large Cormorant numerals, RRM purple ramp
on warm paper. All four obey the house invariants below.

- `single`: large numeral (Cormorant 600), label, provenance footer.
- `delta`: chevron glyph + numeral + a text polarity tag ("Favorable" / "Unfavorable"). Color is never the only signal; the chevron and the tag text both carry meaning.
- `bars`: filled vertical columns. Column heights are normalized to `max(bars[].value)` (the tallest bar fills the plot height); when `unit === '%'` the axis is fixed to 100 instead of the data max. The hero bar uses `--purple-700`, comparators a muted neutral; the value renders as a numeral on each column.
- `ratio`: large `N in M` numeral plus a dot pictograph (filled = numerator, tinted = remainder).

House invariants (enforced, derived from STYLE-GUIDE.md, design-system.json, and visual-profile.md):
- Background is warm paper (`--bg-body` / #F7F5F3 light), never pure white, never realfood red on black.
- Numerals use Cormorant Garamond (400/600 only). Labels, eyebrows, captions use Inter (400/500/600 only). No other fonts or weights.
- Purple ramp (`--purple-50/100/300/500/700/900`) carries the data fill. `--purple-700` marks the hero/RRM element. Comparators are muted neutral.
- Polarity colors: favorable = sage, unfavorable = clay/rose, neutral = purple. Never the alarmist error red.
- Escaping: every operator-supplied string (`value`, `label`, `eyebrow`, `caption`, `unit`, `bars[].name`, `source.label`) is XML-escaped for the five predefined XML entities (`&amp; &lt; &gt; &quot; &apos;`) before insertion into any `<text>`, `<title>`, `<desc>`, or attribute. Use numeric or predefined entities only; never HTML named entities (`&ndash;` etc.), which break standalone SVG XML parsing per rrm-academy-cf CLAUDE.md. Escaping preserves the displayed glyph; it never strips. The verbatim rule (see 9) governs numeric rounding, not character encoding, so escaping and verbatim do not conflict.
- No em dashes anywhere in rendered output (and rejected at input per 3.3).

## 5. Render architecture: one renderer, two modes

The renderers and validator live in the repo, not the skill, so on-page and exported
output cannot drift. One renderer, parameterized by mode.

- `src/lib/infographic/templates.ts`: four functions `(spec, opts) -> svgString`, where `opts.mode` is `inline` or `standalone` and `opts.aspect` is `1:1 | 4:5 | 1.91:1`.
  - `inline` mode: colors are `var(--token)` references plus `currentColor`, so on-page theming and dark mode come for free from the page stylesheet.
  - `standalone` mode: colors are the resolved light-theme hex values, read from `docs/design/design-system.json`, inlined into the SVG so the file is genuinely self-contained and portable (email, Instagram, a raw `.svg` opened anywhere). The "no hardcoded hex" house rule is relaxed for `standalone` output only (it is generated from the token SSOT, not hand-typed).
  - Each template defines a layout per `aspect`. "Identical pixels" applies WITHIN an aspect, never across aspects; an aspect re-flows the layout to fill its canvas rather than stretching or letterboxing a single fixed viewBox.
  - Every returned `<svg>` carries `role="img"`, `<title>`, `<desc>` (alt text from value + label + source), with all operator text XML-escaped (see 4).
- `src/lib/infographic/validate.ts`: the pure validator of 3.3.
- `src/lib/infographic/types.ts`: the spec types.
- `scripts/infographic-render.mjs`: thin CLI. Reads a spec JSON on stdin or a path, validates, and on success prints the SVG to stdout and exits 0; on an invalid spec prints the typed errors to stderr and exits non-zero. Accepts `--mode` and `--aspect`. This is the single entry the skill calls. Consumers MUST check the exit code before using stdout.

### Fonts and rasterization

For export, the `standalone` SVG is wrapped in a minimal HTML document at the target
canvas size with the paper background, padding, and the resolved `:root` token block
inlined (so `var()`/`currentColor` and fonts resolve even though standalone already
inlines hex). It is rasterized with the house Chromium-screenshot path (Playwright),
which renders the webfonts and chevron glyphs faithfully. The rasterize step is wrapped
in try/catch; on a Playwright launch or screenshot failure (a known failure mode on
these machines, see the `playwright-comet` skill) it automatically falls back to the
`@resvg/resvg-js` path (already a runtime dependency) with the project font files, and on
total failure it removes any orphaned `.svg`/partial output and surfaces the error to the
operator. resvg-js is the defined on-error fallback, not an unwired note.

## 6. On-page integration (rrm-academy-cf, Phase 2, held)

Render is gated by `infographic_approved`. The worker `/articles` projection
(`rrm-library-worker/src/index.js`) emits the parsed `infographic` spec ONLY when
`infographic_approved === 1` (the same shape as the existing `synopsis_approved` gate
for `insights`); otherwise it emits `infographic: undefined`. `src/lib/fetch-data.mjs`
maps the field through to `articles.json`.

- `src/components/SynopsisInfographic.astro`: takes the spec, re-validates with the shared `validate.ts`, and renders the inline-mode SVG. For an absent spec it renders nothing. For a PRESENT-but-invalid spec it is a build error, not a silent skip (see 10), so a stored bad spec cannot silently vanish.
- `src/pages/library/[...slug].astro`: the synopsis renders in TWO branches (the editorial-layout block near line 396 and the standard-layout block near line 575). Place `<SynopsisInfographic>` in BOTH (or first refactor the duplicated synopsis into one shared partial and place it once). Wiring only one branch would silently omit the infographic for one article class.
- Accessibility: SVG carries `role="img"`, `<title>`, `<desc>`. Reduced-motion: any count-up or grow animation is gated behind `prefers-reduced-motion`; the resting state is complete and readable.
- Dark mode: inline-mode colors reference semantic CSS variables and `currentColor`, so they flip with `[data-theme="dark"]`. Exported (standalone) image files stay light by design (resolved light-theme hex). Follow the existing `.chart-figure` light/dark precedent in `src/pages/naprotechnology/index.astro` if a two-asset light/dark swap is ever needed on-page (do not add `display:` to the img selector; specificity trap documented in CLAUDE.md), though the inline `var()` SVG avoids needing it.

The library page is statically baked via `getStaticPaths()`, so a stored, approved spec
goes live on the next build of that article. "Held" therefore means EITHER not yet
written to D1, OR written with `infographic_approved = 0`. The component reads nothing
until the flag is 1, so a routine rebuild cannot self-publish an unapproved infographic.

## 7. Export presets

- On-page default: responsive inline-mode SVG, no fixed pixel size.
- File presets (each rendered in `standalone` mode at its own `aspect`, with a per-aspect layout): `square` 1080x1080 (1:1, Instagram feed), `portrait` 1080x1350 (4:5, Instagram), `og` 1200x630 (1.91:1, press, email, social cards).
- Operator picks presets; default export is `square` plus `og`.
- Each run emits: the standalone `.svg` per requested aspect, the `.png` and `.webp` per preset, and prints the inline-mode SVG snippet for on-page use.
- Export files land in a gitignored scratch dir under the skill; Brian collects them. They are never committed (no large binaries in git).

## 8. The skill (~/iCode/skills/rrm-infographic)

Trigger phrases: "infographic", "stat graphic", "synopsis chart", "bar graph for
[article]", "make a stat image", "infographic for [paper]".

Flow:
1. Resolve the article (id or slug) and read its synopsis from D1.
2. Assist: propose a candidate spec (template guess plus the headline number). When the number is read from `insights.tldr` / `key_findings`, mark it UNCONFIRMED and tell the operator to confirm it against the primary source (abstract/fulltext), not the synopsis prose, which may round or paraphrase. PROPOSE only; the operator edits or accepts. Never auto-publishes.
3. Validate the spec with `validate.ts` (syntactic; see 3.3). Abort with the typed errors on failure.
4. Verify the source against the registry (see 9), fail-closed.
5. Render via `scripts/infographic-render.mjs`. Check the exit code; on non-zero, surface stderr and abort (no rasterize, no write).
6. Rasterize to the chosen presets via the Chromium path with the resvg-js fallback (see 5).
7. Write the spec to a LOCAL file only. This is the held state. The skill does NOT write the D1 `infographic` column during a normal run, so nothing can reach a live page.
8. Emit a preview by rendering the local spec at mobile, desktop, and dark for sign-off. The preview is rendered from the local artifact, not fetched from the apex, so it is cache-immune and shows exactly the artifact under review.
9. Go-live (a separate, explicitly operator-gated action): write the validated, source-verified spec into `articles.infographic` AND set `infographic_approved = 1`, as one atomic statement, routed through a worker endpoint (Bearer-authed with the existing worker admin token, writing ONLY these two columns, never the shared `insights` blob) that owns the column (no blind partial-key write). Then deploy/rebuild the article and verify on the immutable `<hash>.pages.dev` URL (or purge the article URL via cf-cache-purge before checking the apex), never an un-purged apex read.

Re-run on an article that already has an infographic: require explicit operator
confirmation, reset `infographic_approved` to 0, and log the prior spec, so a re-run can
never silently replace a live, approved graphic.

## 9. Fidelity gates (clinical-site discipline)

- Source present and well-formed: enforced syntactically in `validate.ts` (see 3.3).
- Source resolvable: a separate skill-flow step (step 4) registry-verifies every identifier the way the repo's identifier-verification system requires (doi.org content-negotiation plus Handle API for DOIs; direct esummary for PMIDs). It is FAIL-CLOSED: on a dead identifier the spec is rejected; on a verify timeout or 5xx the spec is NOT staged and the operator is told "source could not be verified," never rendered anyway. A source inherited unchanged from the article's own already-verified D1 identifiers may skip re-verification only when the identifier string is byte-equal to the stored D1 value (state which identifier it inherited); any operator edit to the identifier forces full registry verification.
- Verbatim value: the displayed number is rendered exactly as the operator entered it; the skill never rounds, derives, or recomputes. The value must be bound to the exact figure in the cited source, not to the synopsis paraphrase (see step 2). The provenance footer cites the source.
- Assist proposes, operator confirms. No write to the D1 `infographic` column without confirmation; no `infographic_approved = 1` without the explicit go-live action.
- Consistent with the existing Citation Integrity posture (never insert citations from model knowledge) and the stat-link-fidelity posture for stat-producing surfaces.

## 10. Verification (definition of done)

Phase 1 (renderers, validation, skill, export):
- All four templates render from sample specs at mobile (393) and desktop (1280) and in dark, with no horizontal overflow.
- XML well-formedness: feeding `& < > " '` in every operator string field produces well-formed SVG that parses. Reuse the repo's existing SVG XML gate (the `xml.etree` parse over `public/images/**/*.svg`) extended to cover rendered sample output.
- Grep: zero em dashes in any rendered SVG or HTML output.
- `validate.ts` rejects, each as an enumerated test case: missing/empty/malformed source; a `bars` spec with fewer than 2 or more than 3 bars, with zero heroes, or with two heroes; a `bars[].value` that is negative, NaN, or `> 100` when `unit` is `%`; a `ratio` with `denominator` 0 or `> 20`, or with `numerator > denominator`; a `delta` missing `direction` or `polarity`; a `single` missing `value` or `label`; an `eyebrow` over 28 chars; an unknown template; any string field containing an em or en dash.
- Raster export produces valid PNG and WebP at the target dimensions (magic-byte and dimension check) AND asserts the expected numeral `<text>`/pixels are present, so an empty/blank render cannot pass on dimensions alone.
- Standalone-mode color check: an exported PNG renders the house palette (purple ramp, paper background), not fallback black/transparent, confirming the resolved-hex inlining.

Phase 2 (on-page):
- D1 migration applied first (the two columns) before any code that reads them deploys.
- On a sample article with `infographic` set and `infographic_approved = 1`, the synopsis page renders the inline SVG under the title on BOTH an editorial-type and a standard-type article; the numeral is present as selectable DOM `<text>` (crawlable check).
- A row with a non-null `infographic` that `validate.ts` rejects FAILS the build (no silent render-nothing for a populated-but-invalid spec; render-nothing applies only to the genuinely-absent case).
- An article with `infographic_approved = 0` renders nothing live (gate check).
- web-page-qa gate passes on the synopsis page at mobile and desktop.
- rrm-academy-cf lint, design-tokens:check, and arise-scan gates pass locally before any push; the push, the migration, and per-article promotion are held for go-live.

## 11. Build phases

- Phase 1: `src/lib/infographic/{templates,validate,types}.ts`, `scripts/infographic-render.mjs`, the skill, export (Chromium + resvg fallback), and a standalone preview. Local-only; nothing touches D1 or live pages.
- Phase 2 (held, ordered, following the canonical "Backfilling new content types" sequence in CLAUDE.md): (a) the D1 migration adding `infographic` + `infographic_approved`; (b) the worker `/articles` projection emitting `infographic` under the approval flag, and the go-live write endpoint that owns the column; (c) `src/lib/fetch-data.mjs` mapping; (d) `SynopsisInfographic.astro` and wiring into BOTH `[...slug].astro` synopsis blocks. Migration runs before the reading code deploys.

## 12. File inventory

Repo (rrm-academy-cf):
- `src/lib/infographic/types.ts` (new, spec types)
- `src/lib/infographic/validate.ts` (new, pure validator of 3.3)
- `src/lib/infographic/templates.ts` (new, four renderers, inline/standalone x aspect)
- `scripts/infographic-render.mjs` (new, CLI with exit-code contract)
- `src/components/SynopsisInfographic.astro` (new, Phase 2)
- `src/pages/library/[...slug].astro` (edit, Phase 2: a render slot in BOTH synopsis blocks, ~396 and ~575, or a refactor to one shared partial)
- `src/lib/fetch-data.mjs` (edit, Phase 2: map the `infographic` field through)

Repo (rrm-library-worker):
- D1 migration: `ALTER TABLE articles ADD COLUMN infographic TEXT; ALTER TABLE articles ADD COLUMN infographic_approved INTEGER NOT NULL DEFAULT 0;` (run before deploy)
- `src/index.js` (edit: `/articles` projection emits `infographic` only when `infographic_approved = 1`)
- a go-live write route that sets `infographic` + `infographic_approved = 1` atomically (Bearer-authed with the worker admin token; writes ONLY these two columns; owns the column; no shared-blob write)

Skill (~/iCode/skills/rrm-infographic):
- `SKILL.md`
- `helpers/propose.mjs` (spec assist from synopsis, marks value UNCONFIRMED)
- `helpers/verify-source.mjs` (registry verification, fail-closed)
- `helpers/export.mjs` (rasterize presets via Chromium with resvg fallback)
- `example/` (sample specs + preview)

## 13. Risks and mitigations

- Misrepresenting a paper: mitigated by syntactic source gate plus fail-closed registry verification, verbatim value bound to the source figure (not the synopsis), assist-proposes-only, provenance footer, and the approval-flag publish gate.
- Cross-writer data loss: mitigated by a dedicated column (not the worker-owned insights blob) and an atomic, column-owning go-live write.
- Self-publish without go-live: mitigated by `infographic_approved` (the component reads nothing until the flag is 1) and local-only skill writes.
- Broken or insecure rendered output: mitigated by XML-escaping all operator text (prevents malformed SVG and inline-DOM XSS), the well-formedness gate, and the populated-but-invalid build failure.
- Broken exports: mitigated by standalone-mode resolved-hex inlining, the exported-color check, the CLI exit-code gate, and the resvg-js rasterize fallback.
- Stale sign-off: mitigated by previewing the local artifact and verifying the immutable `<hash>.pages.dev` URL (or purging before an apex check). Note the `/images` 1-week cache rule does not apply (inline SVG is in-page, not an `/images/*` asset), but any future raster served from the site must version its URL per CLAUDE.md.
- Renderer drift: mitigated by a single in-repo renderer that the component and CLI both call; the only variation is `mode`/`aspect`, both sourced from the same token SSOT.
- Dirty-clone publishing footgun: implement on a worktree off origin/main, cherry-pick, never stash/rebase.

## 14. Execution gate

This build carries an autonomy contract (lights-off to held). Before execution begins,
the `brian` agent reviews the task plus the implementation plan and must return APPROVE
or CONDITIONALLY APPROVE. The D1 migration, the live deploy, and any per-article
promotion stay behind an explicit go-live from Brian.

## Revision Log (2026-06-21, /arise --deep spec review)

- C1 (insights blob overwrite): moved storage to a dedicated `articles.infographic` column; the worker-owned insights writers never touch it. (3.1, 12, 13)
- C2 (held-in-D1 impossible vs static bake): added `infographic_approved` render gate; "held" = unwritten or flag 0; skill writes local-only; go-live is a separate gated D1 write. (3.1, 6, 8, 11)
- C3 (no escaping in inline SVG, XSS): mandatory XML-escaping of all operator strings; well-formedness gate. (4, 5, 10)
- H4 (resolvable source undefined / fail-open): split syntactic validate from a fail-closed registry-verify step. (3.3, 9)
- H5 (validator omits per-template invariants): validate enforces hero-count, numerator/denominator bounds, delta direction/polarity, required fields; all added to the test list. (3.3, 10)
- H6 (bar normalization undefined): columns normalized to max value, axis to 100 for percent units. (4)
- H7 (self-contained vs page CSS vars): two render modes; standalone inlines resolved hex; export wrapper inlines tokens. (5, 7)
- H8 (component silent render-nothing): populated-but-invalid stored spec fails the build; render-nothing only for absent. (6, 10)
- H9 (CLI exit code not gated): exit-code contract; consumers must check; raster numeral-present check. (5, 8, 10)
- H10 (naked rasterize, resvg unwired): try/catch with resvg-js as the defined fallback and orphan cleanup. (5)
- H11 (verbatim vs paper): assist value marked unconfirmed; bind to the source figure, not the synopsis. (8, 9)
- M12 (re-run idempotency): re-run confirms, resets the flag, logs the prior spec. (8)
- M13 (RMW race on shared blob): dedicated column + atomic column-owning go-live write. (3.1, 8)
- M14 (one viewBox into 3 aspects): per-aspect layouts; identical pixels within an aspect only. (5, 7)
- M15 (two synopsis blocks): wire both branches (or refactor to one partial). (6, 12)
- M16 (stale apex preview): preview the local artifact; verify the immutable hash URL or purge. (8)
- L17 (em-dash via grep only): em/en dash rejected at the input boundary in validate. (3.3)
- L18 (title already dropped): moot under the dedicated-column model; no insights-blob allowlist dependency.

## Phase 3: Social-share export (2026-06-21, approved extension)

The export surface is extended so the same infographics are sharable on Instagram and
X. The on-page render and the worker/D1 schema are UNTOUCHED; this is purely the
standalone-export path.

### 3-a. Branded frame (export only)

A new render option `frame` (`none` | `branded`) wraps the standalone infographic in a
card chrome:
- RRM wordmark at the top (inlined as SVG `<path>` data lifted from
  `public/press/rrm-academy-wordmark-purple.svg`, so the export stays self-contained and
  needs no external asset).
- A thin purple accent rule under the wordmark.
- The infographic in the middle content area.
- The source provenance line.
- A footer band: `rrmacademy.org` (left) and the social handle (right).

`inline` mode (on-page) always renders bare (`frame: none`) since it sits in synopsis
context. `standalone` export defaults to `frame: branded`. A `--platform` flag selects
the footer handle: `ig` -> `@rrmacademy` (default), `x` -> `@RRM_academy`.

The card text is eyebrow + stat + source only. No study title, no claim line.

### 3-b. Content-box layout (resolves the deferred M14)

The four renderers are refactored to draw into a CONTENT BOX `{ x, y, w, h }` provided by
the caller, instead of the full canvas. The frame reserves a top band (wordmark) and a
bottom band (footer) and hands the middle to the template. A bare render passes a
full-canvas box (minus standard padding), so the on-page inline output stays visually
identical (regression-checked against the live 62%/34% page). Because the content box
proportions differ per aspect, each format re-flows cleanly rather than one layout being
stretched.

### 3-c. Export presets (four)

- `square` 1:1 1080x1080 (IG feed + X in-stream + Facebook)
- `portrait` 4:5 1080x1350 (IG feed)
- `story` 9:16 1080x1920 (IG / Facebook stories) [new]
- `card` 1.91:1 1200x630 (X summary-large-image + on-page OG meta) [renamed from `og`; alias kept]

Default export emits all four; each yields PNG + WebP + SVG.

### 3-d. Files (held branch)

- `src/lib/infographic/wordmark.mjs` (new): the wordmark path data + viewBox as a constant.
- `src/lib/infographic/templates.mjs` (edit): content-box refactor of the four renderers + a `frameCard()` helper that draws the chrome and computes the inner content box per aspect; `renderInfographic` gains `opts.frame` and `opts.platform`.
- `scripts/infographic-export.mjs` (edit): add the `story` preset, default `frame: branded`, pass `--platform`.
- Tests: branded-frame assertions (wordmark + footer present), all four templates x four aspects well-formed + dash-free + no overflow, and a regression test that `inline`/bare output is unchanged.

### 3-e. Verification

All four templates rendered at all four aspects in branded frame: well-formed XML, zero
em/en dashes, no element off-canvas, wordmark + footer present. On-page inline render
byte-stable for the existing samples (bare, unframed). Screenshot each aspect for sign-off.
