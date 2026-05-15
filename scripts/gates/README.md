# Fact Pipeline Gates

Deterministic proof-gate runner for the canonical facts extraction pipeline.
Prevents the bug classes found in commit 70958c2 (/arise --deep, 13 bugs).

## Usage

```
npm run gates            # all 5 gates (includes D1 network query)
npm run gates:check      # G1-G4 only — fast, no network (pre-commit)
node scripts/gates/validate-fact-pipeline.mjs --gate G1
node scripts/gates/validate-fact-pipeline.mjs --json
```

## Gates

### G1: Schema Self-Consistency

Reads `scripts/lib/canonical-facts-schema.mjs`. For each entity:

- Every tradition value in the matcher is in `ALLOWED_TRADITIONS`.
- Slug-named entities accept their corresponding tradition (e.g. `creighton` entity
  must accept `'creighton'`). This is the exact class of bug that dropped 724 Creighton
  facts: the matcher only accepted `'fabm'` instead of `'creighton'`.
- Every value in `ALLOWED_TRADITIONS` is accepted by at least one entity (no stranded
  traditions).

### G2: SSOT Integrity

For each `docs/fact-check/*-canonical-facts.json` (plus neofertility-ie):

- `_meta.record_count == facts.length`
- All fact IDs match expected formats (rec-prefixed, chapter-slug-prefixed, legacy curator IDs)
- All `source_id` fields are non-empty
- All `tradition` arrays are non-empty and contain only `ALLOWED_TRADITIONS` values
- All facts have `verified >= 1`
- All facts route correctly via their entity's `matches()` function

### G3: Validator-Prompt Enum Sync

Compares `ALLOWED_CATEGORIES` and `ALLOWED_CLAIM_TYPES` Sets in the validator scripts
against the `"category"` and `"claim_type"` enum values in the system prompts.
Fails if they diverge — adding a new category to the prompt without updating the
validator (or vice versa) is a silent data-loss bug.

### G4: Orchestrator Exit Codes (static)

Reads source of each orchestrator script. Asserts that when a `failed` array is
non-empty, the script calls `process.exit(<non-zero>)`. Silent zero-exit on failures
means CI passes while facts are silently dropped.

### G5: D1↔SSOT Reconciliation (network-dependent)

Queries D1 `rrm-library.facts` for each entity's tradition filter. Compares the
count to `_meta.record_count` in the SSOT JSON. Fails if delta > 2. This is the
gate that would have caught the Creighton bug after build (D1 had 1,016 creighton-tagged
facts, SSOT contained only 292 — a 724-record delta).

Skipped with `--quick` flag.

## Pre-commit trigger

The pre-commit hook runs `npm run gates:check` (G1-G4, no network) when any of these
files change:

- `scripts/lib/canonical-facts-schema.mjs`
- `scripts/extract-article-facts.mjs`
- `scripts/extract-chapter-facts.mjs`
- `scripts/promote-article-facts.mjs`
- `scripts/promote-chapter-facts.mjs`
- `scripts/build-canonical-facts.mjs`
- `scripts/article-extraction/system-prompt.md`
- `scripts/chapter-extraction/system-prompt.md`

---

# Glossary Spoke Pipeline Gates

Deterministic proof-gate runner for the glossary spoke pages pipeline (per-term URLs
under `/glossary/<slug>/`, shipped 2026-05-03). Prevents the failure modes Brian
flagged manually after the v1 launch: pillar/spoke filter drift, duplicate H1, and
the structural drift class the shared <GlossaryTerm> component was built to prevent.

## Usage

```
npm run gates:glossary            # all 5 gates (static-only today)
npm run gates:glossary:check      # quick mode (no-op today; reserved for future network gates)
node scripts/gates/validate-glossary-pipeline.mjs --gate G1
node scripts/gates/validate-glossary-pipeline.mjs --json
```

## Gates

### G1: Status Filter Agreement

Both `src/pages/glossary/index.astro` (pillar) and `src/pages/glossary/[slug].astro`
(spoke) must collect terms via `terms.filter(t => t.status === 'published')`. Drift
between the two filters either leaks unpublished terms into the pillar's
DefinedTermSet (whose @ids then 404 because the spoke route refuses to build them)
or surfaces unpublished content as a canonical entity URL.

### G2: Shared Render Path Enforcement

`src/components/GlossaryTerm.astro` is the only file allowed to render glossary
`bodyHtml` via `set:html`. Any other `.astro` file matching `set:html={...bodyHtml}`
or `set:html={...body_html}` shapes fails the gate. This is the structural guarantee
that pillar-vs-spoke drift is impossible: edit the body once in D1, two surfaces
render the same string.

### G3: Rewriter Anchor Coverage

`rewriteAnchors()` inside `GlossaryTerm.astro` special-cases three anchor shapes
(`ref-N` prefix, exact `abbreviations`, exact `references`) so they rewrite to
`/glossary/#<anchor>` (jump back to pillar) instead of `/glossary/<anchor>/` (spoke
link, which would 404). Drop one of the three, every spoke containing that anchor
type ships broken links.

### G4: Heading Level Contract

The `headingLevel` Props type must be a union including `'h1'`, `'h2'`, `'h3'`. Every
`<GlossaryTerm headingLevel="...">` consumer under `src/pages/` must pass a value
inside the union. The pillar must use `"h3"` (under per-Part `<h2>` sections) and
the spoke must use `"h1"` (the page heading). Catches the duplicate-H1 regression
that landed at v1 launch (spoke route had its own `<h1>` AND the component rendered
a second one).

### G5: Schema @id Consistency (static source check)

The spoke route declares three `@id` constants (`TERM_ID`, `WEBPAGE_ID`, `SPOKE_URL`)
that must be parameterized on `${term.slug}` so each spoke gets a unique entity URL.
The cross-references must wire correctly: `DefinedTerm.subjectOf -> WEBPAGE_ID` and
`MedicalWebPage.mainEntity -> TERM_ID`. The `TERM_SET_ID` constant must equal
`https://rrmacademy.org/glossary/#defined-term-set` on BOTH the spoke and the pillar
so the `inDefinedTermSet` pointer resolves.

## Pre-commit trigger

The pre-commit hook runs `npm run gates:glossary:check` when either of these
glossary surfaces change:

- `src/components/GlossaryTerm.astro`
- `src/pages/glossary/**/*.astro`

## Companion: snapshot script

`scripts/glossary-snapshot.mjs` is the runtime counterpart to these static gates.
It walks the built `dist/glossary/` tree (or live site with `--live`) and validates
per-spoke heading uniqueness, JSON-LD `@id` cross-refs, cross-ref rewriter coverage,
and pillar/spoke parity (DefinedTermSet @id count vs spoke directory count, sitemap
URL count vs spoke directory count). Wired into npm via `snapshot:glossary` (pillar
only) and `snapshot:spokes` (spoke + parity).

---

# Analytics Pipeline Gates (AG1-AG12)

`validate-analytics-pipeline.mjs` covers the client analytics surface: `functions/api/track.js`, `functions/api/_track-events.js`, `functions/api/_ga4-source.js`, `functions/_middleware.js` (CSP), and `src/scripts/track*.ts`. Encodes the bug classes the client-analytics spec defends against.

**Spec:** `docs/superpowers/specs/2026-05-15-client-analytics-spec.html`

## AG1: Endpoint contract

`functions/api/track.js` must import `checkRateLimit`, `sendGA4Event`, `ALLOWED_CLIENT_EVENTS`, `REQUIRED_PARAMS`, `PII_REGEX`; export `onRequestPost` + `onRequestOptions`; call `checkRateLimit()` on POST; not contain inline `fetch(google-analytics.com)` (must use `sendGA4Event`); and return `{ error: 'service_unavailable' }` on missing GA4 env.

## AG2: Allowlist coverage

Static `track('event_name', …)` call sites in `src/` with string-literal event names must have `event_name` in `ALLOWED_CLIENT_EVENTS`. **Known blind spot:** dynamic event names from `data-track-*` attributes in `track-auto.ts` are not statically resolvable; runtime validation in `/api/track` catches those instead.

## AG3: Server/client event separation

Server-only conversion events (`page_view`, `sign_up`, `signup_from_ask`, `generate_lead`, `begin_checkout`, `purchase`) must NOT appear in `ALLOWED_CLIENT_EVENTS`. Prevents double-counting if both client and server fire the same event name.

## AG4: Required params satisfied

`track('event', { … })` call sites with literal object args must include all keys in `REQUIRED_PARAMS[event]`. Catches `track('cta_click', {})` missing required `id` + `page` before it reaches the endpoint.

## AG5: PII regex intact

`_track-events.js` exports `PII_REGEX` whose body must contain all of: `email`, `user`, `name`, `password`, `token`, `cookie`, `address`, `phone`, `ssn`, with case-insensitive flag. Future PR that dilutes the regex trips the gate.

## AG6: UTM convention

UTM-bearing URL literals in `src/` + `functions/` must use lowercase + underscores + ASCII per `docs/marketing/utm-conventions.md`. Catches `utm_campaign=Newsletter Monthly May 2026` (uppercase, space) before it pollutes the dashboard.

## AG7: No third-party analytics

`googletagmanager.com`, `stats.g.doubleclick.net`, `connect.facebook.net`, `analytics.ahrefs.com` must not appear as script sources or fetch targets. `www.google-analytics.com` allowed only in `functions/api/_ga4.js` (the Measurement Protocol endpoint that the server-side relay proxies through).

## AG8: CSP lockdown

`CSP_VALUE` in `functions/_middleware.js` must NOT contain `googletagmanager.com`, `analytics.google.com`, `stats.g.doubleclick.net`, `connect.facebook.net`. Catches accidental CSP loosening that would re-enable third-party analytics paths.

## AG9: Helper exclusivity

No raw `fetch('/api/track', …)` or `sendBeacon('/api/track', …)` outside `src/scripts/track.ts`. All client emissions must go through the validated helper so DNT, debug mode, and sendBeacon-fallback all apply consistently.

## AG10: Conversion completeness

Every event in the spec §15.3 conversion list (`sign_up`, `generate_lead`, `begin_checkout`, `purchase`, `pdf_download`, `copy_citation`, `video_complete`, `scroll_depth`) must have at least one call site in code — server-side via `sendGA4Event` or client-side via `track()`. Catches dashboard-flag drift where the GA4 conversion is marked but the underlying event never fires.

## AG11: Bundle size

After build, `dist/_astro/track.*.js` ≤ 2 KiB, `track-auto.*.js` ≤ 3.5 KiB. Skipped in `--quick` mode (no build artifacts). Trips on helper bloat.

## AG12: Custom dimension parity (warn-only)

Each spec §15.2 custom dimension name must appear as a param name somewhere in `src/` or `functions/`. **Warn-only** — surfaces drift but does not block deploy (some dimensions will fill from default GA4 params).

## Pre-commit trigger

Pre-commit fires `npm run gates:analytics:check` when any of these change:
- `functions/api/track.js`
- `functions/api/_track-events.js`
- `functions/api/_ga4-source.js`
- `functions/_middleware.js`
- `src/scripts/track.ts` / `track-auto.ts`
- `scripts/gates/validate-analytics-pipeline.mjs`

## Companion: spec + UTM doc

- **Spec:** `docs/superpowers/specs/2026-05-15-client-analytics-spec.html`
- **UTM conventions:** `docs/marketing/utm-conventions.md`
