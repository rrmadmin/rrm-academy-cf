# "Did You Mean?" 404 Suggestions - Design Spec

**Date:** 2026-05-28
**Status:** Draft (pre-implementation, post-`/arise --deep`)
**Scope:** rrm-academy-cf - `src/pages/404.astro`, new `src/lib/url-match.js`, new `test/url-match.test.js`, `deploy.yml` step, new `scripts/check-suggest-coverage.mjs`
**Author:** Claude Code (brainstorm with Brian)

---

## 1. Problem

When a visitor hits a path that 404s, the page should help them recover. The most common
recoverable case is a hand-typed or mistyped top-level URL (`/glosary`, `/naprotech`,
`/donat`). Today the 404 page offers a Pagefind full-text search box, but the visitor must
type a query themselves; nothing uses the bad URL they already typed.

This feature reads the bad path and, before the user types anything, renders up to three
"Did you mean: <link>?" suggestions (best first) above the existing search box. If no
candidate clears a confidence bar, the block stays empty and the page is the normal 404.
It never auto-redirects.

## 2. Scope decision (what we are NOT building)

A prior brainstorm proposed a two-tier system (client-side core index + an
`/api/did-you-mean` edge function holding the full ~3,500-URL corpus). **Tier 2 is cut for
v1.** Reasons:

1. The current `/404.astro` already ships a Pagefind-powered live search that indexes the
   whole site. It already covers the "find the right deep page once the user types" job.
2. `rrm-router` already has `slug-redirects.js` (~490KB) + `rec-id-redirects.js` that 301
   most old/truncated library URLs *before* they reach a 404.

Tier 2's only marginal catch is a deep content URL that simultaneously escapes the router
redirect tables AND would not surface in Pagefind search. Narrow slice, real build cost.

**Out of scope for v1:** the edge function, the full-corpus JSON, a dedicated index-build
script, and 404-path logging. 404 logging is deferred until there is evidence it is needed.

## 3. Routing preconditions (verified against rrm-router/src/index.js)

Two facts the design depends on, both confirmed in source:

1. **The Astro 404 renders for both 404 classes, and the bad path is readable client-side.**
   - Unknown top-level paths (`/glosary`) fail `shouldRouteToAstro()` and hit the catch-all
     (`src/index.js` lines 681-695): the router fetches `/404` from Pages and returns that
     body **at the original URL with HTTP 404**. There is no redirect, so in the browser
     `location.pathname` is still `/glosary`.
   - Under-prefix paths (`/library/bad-slug`) route to Pages, come back as a soft-404 (200),
     and the router converts to a hard 404 (lines 757-761) with the URL preserved.
   - In both classes the browser's `location.pathname` reflects the path the visitor
     actually requested. The client script reads that.
   - **Coupling note (latent):** the under-prefix soft-404 to hard-404 conversion depends on
     the 404 page `<title>` continuing to begin with "Page Not Found" (router lines 757-761
     match `body.includes('<title>Page Not Found')`). Changing the 404 title without updating
     the router would make `/library/*`-class paths return a soft 200, breaking the 404 status
     (and the `noindex`/suggestion-on-404 guarantee) for that class. Not a defect today; flagged
     so a future title edit does not silently regress it.

2. **No new route is needed.** Because Tier 2 is cut, nothing in this feature calls
   `/api/*`. Everything runs in the 404 page's own client script.

## 4. Architecture

Three runtime pieces plus a CI guard. No index-build script, no generated artifact, no edge
function, no new API route.

### 4.1 `src/lib/url-match.js` - pure matcher (ESM, no DOM)

The only logic. Unit-tested in isolation. Exports:

```
normalize(path) -> string
levenshtein(a, b) -> number
score(badPath, candidatePath) -> number   // 0..1
bestMatches(badPath, index, opts) -> Array<{ path, title, score }>
```

`package.json` is `type: module`, so a plain `.js` ESM file is importable by both Astro's
client bundler and `node --test`.

**Constants** (top of file, tunable, pinned by fixtures):
```
THRESHOLD = 0.72       // minimum score to surface a suggestion
PREFIX_FLOOR = 0.82    // floor when one path is a prefix of the other
MIN_PREFIX_LEN = 3     // prefix floor applies only when the shared prefix is >= 3 chars
```

**`normalize(path)`**
1. If input is null/undefined/non-string, return `""`.
2. Strip everything from the first `?` or `#` on the RAW input, before decoding, so an
   encoded `%23`/`%3F` inside a slug is treated as a literal slug character, not a delimiter.
3. `decodeURIComponent` wrapped in try/catch; on throw, keep the stripped raw string.
4. Lowercase.
5. Strip leading and trailing `/`.
6. Result is the bare path, e.g. `"glossary"` or `"library/bad-slug"`.

**`levenshtein(a, b)`** - standard iterative two-row DP over the normalized strings.

**`score(badPath, candidatePath)`** - whole-string edit distance, lifted only by a
length-guarded prefix rule. There is deliberately **no** last-segment rule and **no**
section rule. Both were removed after the deep trace: a last-segment rule promoted unrelated
deep paths to score 1.0 (e.g. `/zzz/donate` -> `/donate`), and the prefix rule already covers
the legitimate "deep slug under a real page" case (e.g. `/library/bad-slug` -> `/library`).
```
b = normalize(badPath); c = normalize(candidatePath)
if (!b || !c) return 0
maxLen = Math.max(b.length, c.length)
let s = maxLen === 0 ? 0 : 1 - levenshtein(b, c) / maxLen

// prefix floor: one normalized path is a prefix of the other (truncation OR
// deep-slug-under-a-real-page), but ONLY when the shared prefix is long enough that the
// match is meaningful. Guards against single/short-char paths matching many pages.
if ((c.startsWith(b) || b.startsWith(c)) && Math.min(b.length, c.length) >= MIN_PREFIX_LEN) {
  s = Math.max(s, PREFIX_FLOOR)
}

return Math.min(s, 1)
```
Worked examples:
- `/c` (len 1): `Math.min(1, ...) < 3`, no floor; raw distance to every candidate is low; none
  clears `THRESHOLD`; no suggestion. (Closes the single-char false-match class.)
- `/naprotech` (len 9): prefix of `/naprotechnology`, shared prefix 9 >= 3, floor 0.82.
- `/library/bad-slug`: `b.startsWith("library")`, shared prefix 7 >= 3, floor 0.82, suggests
  `/library`.
- `/zzz/donate`: neither a prefix of nor prefixed by any candidate; raw distance only; no false
  suggestion. `/library/glossary`: `/glossary` scores ~0.5 by raw distance (no prefix
  relationship) and is dropped; `/library` floors to 0.82 and wins.

**`bestMatches(badPath, index, { threshold = THRESHOLD, limit = 3 } = {})`**
1. `nb = normalize(badPath)`.
2. For each entry `{ path, title }` in `index`: skip if `normalize(entry.path) === nb`
   (never suggest the path that just 404'd). Compute `score(badPath, entry.path)`.
3. Keep entries with `score >= threshold`.
4. Sort by score descending. **Tie-break** deterministically: higher raw whole-string
   similarity first (so among floor-tied candidates the most string-similar surfaces), then
   shorter normalized path, then lexicographically by path.
5. Return the first `limit` as `{ path, title, score }`.

### 4.2 `src/pages/404.astro` - build-time index + client wiring

**Build-time index (frontmatter):**
- Enumerate candidate pages with Vite glob (keys only; modules not loaded):
  ```
  const topFiles = import.meta.glob('/src/pages/*.astro', { eager: false });
  const dirIndexFiles = import.meta.glob('/src/pages/*/index.astro', { eager: false });
  ```
- Derive a route from each key by stripping the literal `/src/pages/` prefix and the
  `(/index)?.astro` suffix:
  - `/src/pages/about.astro` -> `/about`
  - `/src/pages/glossary/index.astro` -> `/glossary`
- **Exclusion rule.** Drop keys that are: dynamic (`[` present), partials/private
  (`_`-prefixed basename), the root index (`/src/pages/index.astro` -> `/`), `404.astro`, and
  any page that is **not a public, indexable recovery destination**. The last clause matters:
  the glob auto-includes every depth-1 page, so the exclusion set must drop auth pages,
  `noindex` pages, and developer/utility pages, otherwise a typo can suggest an auth-gated or
  noindex page (e.g. `/acount` -> "Account"). Maintain it as an explicit `PRIVATE_EXCLUDE`
  set, populated by auditing the actual depth-1 page list at implementation. Initial
  classification from the current tree:
  - **Exclude:** `admin`, `dev`, `ivf-success-calculator`, `account`, `login`, `signup`,
    `forgot-password`, `reset-password`, `ask`, `saved`, `providers` (noindex coming-soon),
    `agent-auth`, `webhooks`, `openapi`, `connect`, `mcp`, `linkinbio`.
  - **Keep (public content, must stay suggestable):** all pillar pages, `about`, `contact`,
    `donate`, `faqs`, `library`, `commentary`, `courses`, `glossary`, `endo-survey`,
    `save-the-uterus-club`, `terms-of-use`, `privacy-policy`, `medical-disclaimer`.
- **Anti-drift guard (required, `scripts/check-suggest-coverage.mjs`):** fail the build when a
  depth-1 `src/pages` route is neither in `knownPages` nor in `PRIVATE_EXCLUDE`. This converts
  the silent drift the glob would otherwise hide (a new private page auto-becoming suggestable)
  into a loud build failure that forces a classify-it decision.
- Map each route to a display title via a `TITLE_OVERRIDES` map with a titlecased-slug
  fallback. **Every brand/acronym slug must have an override** - the titlecased fallback
  violates the repo's canonical-names rule (it would render "Neofertility", "Openapi"). Seed:
  `what-is-rrm` -> "What is RRM", `naprotechnology` -> "NaProTechnology", `femm` -> "FEMM",
  `neofertility` -> "NeoFertility", `faqs` -> "FAQs", `pcos` -> "PCOS",
  `common-questions-about-rrm` -> "Common Questions About RRM",
  `save-the-uterus-club` -> "Save the Uterus Club",
  `endo-survey` -> "Endometriosis Self-Survey",
  `art-registries-and-codes` -> "ART Registries and Codes".
  Fallback: split the slug on `-`, capitalize each word, join with spaces (safe only for
  plain-English multiword slugs such as `endometriosis`, `endometritis`, `miscarriage`).
- Build `const knownPages = [{ path, title }, ...]`, sorted by path for stable output.
- Emit it as JSON the client can read, escaping `<` so a value can never break out of the
  script element (matching the in-repo precedent at `src/pages/saved/index.astro:345`):
  ```
  <script type="application/json" id="nf-known-pages"
    set:html={JSON.stringify(knownPages).replace(/</g, '\\u003c')}></script>
  ```
  Use the paired `></script>` close form, not a self-closing tag.

**Why glob + exclude, not a static path list:** routes are enumerated from the actual page
files at build, so the suggestable *path* set never silently drops a public page. Two caveats
the design owns explicitly:
1. **Suggestability requires a `src/pages` file.** A route registered only in rrm-router's
   `ASTRO_ROUTES` (e.g. `/original-research`, added 2026-05-28 before its page landed) is
   invisible to this index until its page exists. The coverage guard checks only same-repo
   pages, so this cross-repo dependency is documented rather than enforced; add the route's
   page before relying on a suggestion for it.
2. **`TITLE_OVERRIDES` and `PRIVATE_EXCLUDE` are hand-maintained *classification* lists.** The
   CI guard catches a missing exclusion; the canonical-names rule catches a missing title
   override. This is a softer, guarded drift than a hand-maintained path list.

**Suggestion container (markup):** a new block placed immediately above
`<div class="not-found__search">`:
```
<div class="not-found__suggest" id="nf-suggest" hidden></div>
```
Starts `hidden`; the client unhides it only when it has at least one suggestion to show.

**Client wiring (a bundled module `<script>`, separate from the existing inline Pagefind
script):**
```
<script>
  import { bestMatches } from '../lib/url-match.js';
  // 1. read + parse the JSON index from #nf-known-pages (try/catch; bail on parse error)
  // 2. read location.pathname; if normalize() is empty (root), do nothing
  // 3. matches = bestMatches(location.pathname, index)
  // 4. if matches.length === 0, leave #nf-suggest hidden, return
  // 5. build the block via DOM APIs (createElement + textContent), append <a> per match,
  //    unhide #nf-suggest
</script>
```
- Astro emits a non-`is:inline` `<script>` as a deferred `type="module"` bundle, so the DOM
  (`#nf-suggest`) exists when it runs. It is a separate execution context from the existing
  `is:inline` Pagefind script; a throw in one cannot abort the other. Both coexist on one page
  (precedent: `src/pages/saved/index.astro`).
- Links are real `<a href={match.path}>` anchors. No buttons, no auto-navigation.
- Link text and any interpolated value use `textContent` / `createElement`, never
  `innerHTML`, so a crafted bad path cannot inject markup.

### 4.3 Styling

Reuse existing tokens (`--accent`, Cormorant for the lead suggestion, e-ink aesthetic). The
suggestion block sits above the search box. Best match is visually primary; 2nd/3rd are
smaller secondary links. Dark mode is covered by token reuse (no new colors). Mobile: the
block is full-width and stacks; no decorative images (the existing `@media (max-width:768px)`
already hides `.not-found__images`).

## 5. Data flow

```
visitor types /glosary
   -> rrm-router catch-all -> serves /404 body at /glosary, HTTP 404
   -> browser renders 404.astro at location.pathname = "/glosary"
   -> module script reads #nf-known-pages JSON  (built at deploy from page files)
   -> bestMatches("/glosary", index)
        normalize -> "glosary"
        score vs "glossary": 1 - lev(1)/9 = 0.889  -> above 0.72
   -> render "Did you mean: Glossary?" linking /glossary
   -> existing Pagefind search remains below, untouched
```

The build-time index is baked into the static `dist/404.html` (`output: 'static'`), and the
same artifact is served for both 404 classes (router `/404` fetch and CF Pages soft-404), so
the index is identical in both.

## 6. Error handling

| Condition | Behavior |
|-----------|----------|
| `location.pathname` is `/` or normalizes to `""` | No suggestions; block stays hidden. |
| `#nf-known-pages` missing or `JSON.parse` throws | try/catch; bail silently, block stays hidden, page is normal 404. |
| `url-match.js` import fails | Module script never runs its body; existing 404 + Pagefind search unaffected. |
| No candidate clears threshold | Block stays hidden; normal 404. |
| Bad path contains markup or `%`-garbage | `?`/`#` stripped before decode; `decodeURIComponent` is try/catch-guarded (keeps stripped raw on failure); rendering uses `textContent` + a real `<a href>`, so no injection. A percent-malformed *near-miss* of a real slug (e.g. `/glossary%zz`) may still clear threshold and render a safe, usually-correct suggestion; that is acceptable, not a failure. |
| Index is empty (glob returned nothing) | `bestMatches` returns `[]`; block stays hidden. |

No network calls, so there is no timeout, retry, or fetch-failure path. No SEO/canonical
risk: suggestions render client-side only; the response is still a 404 with `noindex`.

## 7. Invariants the implementation must uphold

1. **Never auto-redirect.** Suggestions are links the user clicks.
2. **Never suggest the path that 404'd.** `bestMatches` excludes `normalize(badPath)`.
3. **The page is a valid 404 with zero suggestions.** The feature is purely additive; if
   anything in the suggestion path fails, the existing 404 (search + nav links) is intact.
4. **No `innerHTML` in the suggestion render path.** DOM construction only. The build-time
   JSON embed replaces `<` with the JSON unicode escape `\\u003c` so no value can break the
   `<script>` element.
5. **The matcher is pure and deterministic.** No `Date`, no randomness, stable tie-break.
6. **The suggestable *path* set is enumerated from real page files at build.** No
   hand-maintained path list. `TITLE_OVERRIDES` and `PRIVATE_EXCLUDE` are hand-maintained
   *classification* lists; a CI coverage guard fails the build on an unclassified new page,
   and every brand/acronym slug needs a title override (canonical-names rule).
7. **Only public, indexable pages are suggestable.** Auth, `noindex`, and developer/utility
   pages are excluded; verified by a unit fixture asserting none is ever returned.
8. **The existing Pagefind search is not modified.** The new script is additive and separate.

## 8. Testing

**Unit (`test/url-match.test.js`, `node --test`):**

| Input | Expected top suggestion | Why |
|-------|-------------------------|-----|
| `/glosary` | `/glossary` | single-char deletion, high full-string sim |
| `/naprotech` | `/naprotechnology` | truncation -> prefix floor |
| `/donat` | `/donate` | single-char deletion |
| `/librery` | `/library` | substitution typo |
| `/library/some-truncated-slug` | `/library` | deep slug under a real page -> prefix floor |
| `/library/glossary` | `/library` (not `/glossary`) | last-segment coincidence must NOT win |
| `/zzzzzzzz/donate` | none | last-segment coincidence must NOT manufacture a match |
| `/c` (single char) | none | short path must not trip the prefix floor |
| `/glossary` (equals a real page) | none | never suggest a path equal to the bad path |
| `/` or `""` | none | root / empty |
| `/x9q7zzv` (garbage) | none | below threshold |
| 2000-char random string | none (and no throw) | boundary / no crash |

Also assert:
- `bestMatches` returns at most `limit`; results are sorted descending by score; ties break
  deterministically (raw similarity, then length, then lexicographic).
- `normalize` handles `%`-encoded and uppercase input, and reorders strip-before-decode
  (`/foo%23bar` normalizes to `foo#bar`, i.e. the encoded `#` is kept as a literal slug
  character rather than truncating the path; `/foo%2Fabout` does not become a spurious
  match for `/about`).
- **No excluded page (any name in `PRIVATE_EXCLUDE`) is ever returned by `bestMatches`** for a
  near-miss of its slug (pins invariant 7).

**Test wiring (required):** the test already runs under `npm test` in `merge.yml` (the
`claude/**` auto-merge path). Add a `node --test test/url-match.test.js` step to `deploy.yml`
as well, so the direct-`push origin main`, `workflow_dispatch`, and `repository_dispatch`
deploy triggers also gate on it.

**Manual (preview deploy):** Playwright screenshot of a 404 (e.g. `/glosary`) confirming the
suggestion renders and links correctly; mobile 393x852 included; confirm a real URL
(`/glossary`) still returns 200 and never falsely 404s; confirm a deep wrong slug
(`/library/zzz`) shows the `/library` suggestion and the Pagefind search still works.

## 9. Files touched

| File | Change |
|------|--------|
| `src/lib/url-match.js` | New. Pure matcher. |
| `src/pages/404.astro` | Add build-time index (frontmatter), suggestion container, module script, styles. Existing inline Pagefind script unchanged. |
| `test/url-match.test.js` | New. Unit fixtures. |
| `scripts/check-suggest-coverage.mjs` | New. CI guard: every depth-1 `src/pages` route is in `knownPages` or `PRIVATE_EXCLUDE`. |
| `.github/workflows/deploy.yml` | Add a `node --test test/url-match.test.js` step + a `check-suggest-coverage` step. |

No changes to `rrm-router`, `functions/`, `wrangler.toml`, or any data pipeline.

## 10. Rollback

Single revert of the `404.astro` change disables the feature (the suggestion block is the
only user-visible surface). `url-match.js`, the test, and the coverage guard are inert if
unused. No data, no schema, no deploy-pipeline coupling beyond the two added CI steps (which
no-op without the matcher).
```

---

## Appendix: `/arise --deep` disposition (2026-05-28)

11 findings (0 CRITICAL, 4 HIGH, 4 MEDIUM, 3 LOW). All folded into this spec:

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| 1 | HIGH | Prefix-floor fires for single/short-char paths | §4.1 `MIN_PREFIX_LEN = 3` guard |
| 2 | HIGH | `lastSim` promotes deep garbage to score 1.0 | §4.1 last-segment rule removed entirely |
| 3 | HIGH | `PRIVATE_EXCLUDE` lets noindex/auth pages be suggested | §4.2 exclusion rule + curated set + unit fixture (inv. 7) |
| 4 | HIGH | `original-research` router pillar has no page (silent gap) | §4.2 coverage guard + §4.2 caveat 1 documenting the cross-repo dependency |
| 5 | MED | Section-floor fires for flat depth-1 pages | §4.1 section rule removed (prefix rule covers the real case); #3 excludes the auth/utility ones |
| 6 | MED | Unit test gates only the auto-merge path | §8 "Test wiring": add `node --test` to `deploy.yml` |
| 7 | MED | JSON `set:html` omits `</script>`/`<` escape | §4.2 `.replace(/</g, '\\u003c')` + paired close; invariant 4 |
| 8 | MED | `TITLE_OVERRIDES` drift -> wrong brand titles | §4.2 add `neofertility` (openapi is excluded, no override needed); invariant 6 reworded (path vs display) |
| 9 | LOW | `normalize` decode ordering + decode-failure claim | §4.1 strip-before-decode; §6 row corrected |
| 10 | LOW | Tie-break by length not relevance | §4.1 tie-break now: raw similarity, then length, then lexicographic |
| 11 | LOW | Soft-404 depends on undocumented `<title>` coupling | §3 precondition 1 coupling note |

Deliberation override: TRACER-D listed `endo-survey` among pages to exclude. Rejected -
`endo-survey` is a public, promoted flagship page and a valid recovery target; kept
suggestable.
