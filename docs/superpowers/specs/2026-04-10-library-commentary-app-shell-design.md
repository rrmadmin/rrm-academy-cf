# Library & Commentary App Shell — Design Spec

**Date:** 2026-04-10 (amended 2026-05-06 after `/arise --deep` + scope simplification: eink theme dropped, 25 findings folded in)
**Status:** Design approved + amended; ready for implementation plan
**Scope:** `/library/*` and `/commentary/*` routes
**Out of scope for v1:** Pillar guides, courses, FAQs

---

## Goal

Replace the current top-header layout on Library and Commentary routes with a persistent left-sidebar "app shell" that includes:
- Primary nav in the sidebar (Library, Commentary, Saved Articles)
- Secondary exit-shell links (Guides, FAQs, Courses, Community)
- A collapsible middle column on desktop showing "in this index" siblings when arriving from a list
- A pull-up sheet on mobile that shows the same siblings
- A theme toggle (light + dark)
- A Donate CTA button and account footer

The layout replaces the current `Header.astro` on these routes only. Non-shell pages keep the current Header and Footer untouched.

## History and prior art

On 2026-03-30, commit `832a70d` added `src/layouts/AppShell.astro` and duplicated library+commentary under `/app/library/` and `/app/commentary/`. Commit `8fdb17d` deleted it the same day: *"remove: delete /app/ prototype pages polluting semantic search — Vectorize was indexing these URLs, surfacing 404s in search results."* The deleted `AppShell.astro` and `src/pages/app/` are listed in `.gitignore`.

**The lesson:** no duplicate URLs. The shell replaces existing library and commentary pages in place. No `/app/` prefix, no alternate routes, no canonical split.

The deleted prototype's CSS for dark theme, sidebar layout, and mobile drawer is reusable.

## Decisions locked in during brainstorming

| Decision | Value | Rationale |
|---|---|---|
| Scope v1 | Library + Commentary routes | Shared "browse → read" shape. Pillars + courses join in a future phase. |
| Desktop interaction | Hybrid: sidebar + main + collapsible middle column on article pages | Preserves SEO-clean URLs while giving a reader-app feel on desktop. |
| Mobile interaction | Bottom nav + hamburger drawer + pull-up sheet for sibling context | Drawer holds exit-shell links; sheet mirrors the desktop middle column. |
| Global nav on shell routes | Sidebar replaces Header entirely (BaseLayout `chrome="shell"` prop omits Header + Footer) | Avoids double-nav clutter. Exit-shell links in sidebar navigate to non-shell pages where the current Header appears. |
| Theme (v1) | Light + dark only | v1 ships light + dark; no theme audit beyond shell pages. |
| Rollout | Commentary first commit, library second commit, same PR | Commentary has 18 posts; library has 3,200+. Safer diff order. |
| Architecture seam | `AppShellChrome.astro` wrapping component — NOT a `shell` prop on `BaseLayout` | Keeps head/meta logic pure. Avoids entangling SEO-critical meta with experimental UX chrome. |

## Sidebar composition

```
┌─────────────────────────┐
│  RRM Academy            │  ← logo, clickable to /
├─────────────────────────┤
│  READING                │
│  • Research Library     │  ← in-shell
│  • Commentary           │  ← in-shell
│  • Saved Articles       │  ← in-shell (requires sign-in)
│                         │
│  EXPLORE                │
│  • Guides          ↗    │  ← exit-shell
│  • FAQs            ↗    │  ← exit-shell
│  • Courses         ↗    │  ← exit-shell
│  • Community       ↗    │  ← exit-shell
│                         │
│  (spacer)               │
│                         │
│  [   Donate   ]         │  ← CTA button, exits shell
├─────────────────────────┤
│  👤 Brian W.  [theme]   │  ← avatar, account link, theme toggle
└─────────────────────────┘
```

**Not in the sidebar:** search (lives in page topbar, existing pattern), filters (per-index, live in main column), article table of contents (articles have in-body TOC if needed).

## Architecture

### File layout

```
src/
├── layouts/
│   └── BaseLayout.astro              # CHANGED — gains `chrome="default"|"shell"` prop; FOUC inline script replaced (commit 1)
├── components/
│   ├── Header.astro                  # UNCHANGED, but BaseLayout's `chrome="shell"` prop omits it on shell routes
│   ├── Footer.astro                  # UNCHANGED, but BaseLayout's `chrome="shell"` prop omits it on shell routes
│   ├── AppShellChrome.astro          # NEW — sidebar, drawer, bottom nav, middle column, theme toggle
│   └── AppShellSheet.astro           # NEW — mobile pull-up sheet, uses <dialog>
├── styles/
│   ├── global.css                    # gains .app-shell-* class rules and --z-shell-* custom props
│   └── app-shell.css                 # NEW — sidebar, drawer, middle column, sheet, dark-theme tokens
└── scripts/
    └── check-canonical-lockdown.mjs  # NEW — CI check preventing query-string shell modes
```

### How pages opt in

Library and commentary pages wrap their slot content:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import AppShellChrome from '../../components/AppShellChrome.astro';
import AppShellSheet from '../../components/AppShellSheet.astro';
// ...existing imports
---
<BaseLayout chrome="shell" title={...} description={...} canonicalUrl={...} jsonLd={...}>
  <AppShellChrome context="index" currentPath={Astro.url.pathname}>
    <!-- existing page body (hero, grid, cards, pagination) -->
  </AppShellChrome>
  <AppShellSheet />
</BaseLayout>
```

The `context` prop is one of:
- `"index"` — library/commentary list pages (grid, no middle column)
- `"article"` — library article or commentary post (middle column or sheet with siblings)
- `"saved"` — saved articles page (user-specific, no siblings)

`BaseLayout.astro`'s `<script is:inline>` FOUC block (lines 167–179) is the single permitted edit, and a new `chrome="default"|"shell"` prop is added to suppress Header/Footer/outer `<main>` on shell routes. The rest (head, meta, SEO logic, citation tags, JSON-LD injection) remains the single source of truth.

### Component boundaries

**`AppShellChrome.astro`** is responsible for:
- Emitting the page's `<main class="app-shell-main">` element directly (when `BaseLayout chrome="shell"` is in effect, BaseLayout omits the outer `<main>` wrapper). Layout grid: `<aside class="app-shell-nav" data-pagefind-ignore="all">` (sidebar) + `<main class="app-shell-main">` (page content) + `<aside class="app-shell-middle-column" data-pagefind-ignore="all">` (siblings). Sidebar and middle column are siblings of `<main>`, not descendants — semantic HTML preserved. The `app-shell-main` class is the hook used by §Print styles and the §No-context CSS gate.
- Rendering the desktop sidebar (above 900px)
- Rendering the mobile bottom nav (below 900px, fixed position)
- Rendering the mobile hamburger drawer (CSS `:target` fallback + JS-enhanced)
- Always emitting the desktop middle column `<aside>` in static HTML so Pagefind's `data-pagefind-ignore` invariant (G-SEO-2) holds; visibility is class-gated only, never DOM-conditional. See §No-context CSS gate.
- Emitting an inline `<script is:inline>` in the body's first child position (before `<aside class="app-shell-middle-column">`) that reads `sessionStorage.rrm-shell-context`. If absent or invalid (parse error, shape error, or storage API unavailable), it adds `shell-no-context` to `<html>.classList` BEFORE first paint.
- Rendering the theme toggle button in the sidebar footer
- Applying `bodyClass` propagation so `page-library` and similar classes still work
- Applying `data-pagefind-ignore="all"` to the sidebar root and the middle column root
- Adding an inline `<script>` tag that writes sessionStorage on index-page card click (only when `context="index"`)

**`AppShellSheet.astro`** is responsible for:
- Rendering a native `<dialog>` element with the peek bar and sheet states
- Touch/pointer handlers for drag gestures
- Reading the same sessionStorage context as `AppShellChrome`
- Body scroll lock on iOS Safari via `position: fixed; top: -scrollY; width: 100%` pattern
- Focus trap and `aria-modal` via the `<dialog>` element's native behavior
- `prefers-reduced-motion` respect (shortened transitions)

These two components share a small inline helper function `getShellContext()` that parses sessionStorage and returns `null` or the context object.

## Data flow

### `sessionStorage.rrm-shell-context`

```json
{
  "source": "library",
  "label": "Endometriosis · 47 results",
  "query": "endometriosis",
  "filters": { "topic": "Endometriosis" },
  "returnUrl": "/library/?topic=Endometriosis",
  "slugs": [
    "redwine-excision-2012",
    "toljan-ldn-2018",
    "napro-stanford-2008"
  ],
  "writtenAt": 1775868956
}
```

**Lifecycle:**
1. User browses a library or commentary index page. The `AppShellContextWriter` inline script runs on DOMContentLoaded, attaches click handlers to all article/post cards, and captures the current result state into a JS variable.
2. On card click, handler serializes the state and writes to sessionStorage **before** navigation.
3. Article page loads. `AppShellChrome` middle column reads sessionStorage, finds current slug in `slugs[]`, renders the list with current highlighted. `AppShellSheet` does the same for mobile.
4. Clicking a sibling navigates to that article. sessionStorage persists. New article page reads the same context.
5. Clicking a bottom-nav tab (Library, Commentary, Saved, Account) or the sidebar logo calls `sessionStorage.removeItem('rrm-shell-context')` before navigation.
6. Closing the tab kills sessionStorage naturally.

**`slugs[]` semantics:** In v1, `slugs[]` contains ONLY the slugs of cards visible on the current index page (page 1 = first paginated set, page 5 = page-5 set, etc.). The middle column and sheet display these siblings only; they do NOT virtualize the full filter result. A user browsing 3,200 articles with no filter will see middle column / sheet with the visible page's siblings (~50), not all 3,200. `returnUrl` and `filters` are persisted to enable a future v2 "fetch full filter on scroll" enhancement, but v1 ships with visible-page-only. This is documented in §Out of scope as "Sheet virtualization for filter result sets >500 entries."

**Stale and adversarial handling:**

After `JSON.parse`, the parsed object MUST pass a shape validator before any rendering. The validator runs in the shared `getShellContext()` helper; failure returns `null` (no context).

Validation rules:
- `source`: must be one of `'library'`, `'commentary'`, `'search'`. Reject other values.
- `label`: typeof `'string'`, length ≤ 200. Always rendered via `textContent` only — never `innerHTML`. Never used as an attribute value or URL.
- `slugs`: `Array.isArray()` true, length ≤ 500. Each entry must match `/^[a-z0-9][a-z0-9-]{0,80}$/` (the slug grammar). Entries failing the regex are dropped from the array; if length drops to 0 after filtering, return null.
- `returnUrl`: typeof `'string'`, length ≤ 500. Must start with `/`, must NOT start with `//`, must NOT contain `://`, must NOT start with `javascript:` or `data:` or any other scheme. Reject otherwise.
- `filters`: typeof `'object'`, plain object, all keys and values are strings. Reject nested objects, arrays, null values.
- `writtenAt`: typeof `'number'`, finite, > 0.
- Any extra keys: ignored (forward-compat).

Render rules:
- `label` and slug strings: always `textContent`, never `innerHTML`. Astro `.astro` template default escaping applies if rendered server-side, but middle column and sheet are client-hydrated, so the JS render path must use textContent explicitly.
- `returnUrl`: only used as the `href` of an internal `<a>`. Never assigned to `location.href` programmatically. The startsWith-`/`-not-`//` check prevents both open redirect (`https://evil.com/`) and javascript: scheme XSS.
- `slugs[N]`: only used to construct `/library/${slug}/` or `/commentary/${slug}/` href values; the slug-grammar regex ensures no path traversal or scheme injection.

**Failure modes (all return null = no context, render full-width):**
- Storage API unavailable (`SecurityError` on `getItem`/`setItem`): privacy-mode browsers (Safari Strict, Brave shields, Firefox Total Cookie Protection)
- `JSON.parse` throws (malformed JSON)
- Shape validation fails any rule above
- `slugs[]` empty after grammar filtering
- Current article's slug not in `slugs[]`: render the list without highlighting any entry (user landed mid-list — not a failure)

**Storage write robustness:**
- Every `sessionStorage.setItem`, `getItem`, `removeItem` call MUST be wrapped in try/catch. Failure (`SecurityError`, `QuotaExceededError`, `ReferenceError` if storage globally absent) degrades silently to no-context.
- Card-click writer: use the `pagehide` event for the actual `setItem` call, not `click`. The click handler captures intent into a local var; pagehide commits to storage. This avoids Safari iOS's documented same-tick-storage-flush race during top-level navigation.
- Bottom-nav and logo `removeItem` calls: real `<a href>` anchors with `pointerdown` clear (best-effort try/catch). The anchor's default navigation always proceeds regardless of clear success.
- Writer captures slugs from the current page's visible cards (paginated index = ~50 entries). On any DOMContentLoaded for `context='index'`, the writer also UNCONDITIONALLY overwrites any stale context (so navigating between filter changes, pagination, or empty-result pages always reflects the current view, not a prior tab state). On `context='index'` with zero visible cards (empty filter), the writer CLEARS sessionStorage (does not write empty-slugs context).

**Quota fallback:** If `setItem` throws `QuotaExceededError` (very rare given the 500-slug cap, but iOS Safari Private mode allows ~0 bytes), the writer falls back to no-context. The user's click navigates normally; article page renders full-width.

**Not included (dropped from earlier draft):**
- 60-minute staleness timer — sessionStorage dies with the tab; extra timer is complexity for no user value
- `rrm-shell-context-collapsed` localStorage — column collapse stays transient

### `localStorage.rrm_theme`

String: `"light"` or `"dark"`. Default `"light"` if unset or invalid. Applied via `data-theme` attribute on `<html>`.

Inline FOUC-prevention script in `BaseLayout.astro` `<head>`:

```html
<script is:inline>
  (function() {
    var saved = localStorage.getItem('rrm_theme');
    var theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
```

### No server involvement

None of this touches the server. Googlebot, Pagefind, and Vectorize see exactly the same HTML as a cold-landed user: sidebar + main content, no middle column, no sheet. All context-driven features are client-side hydrated from sessionStorage, which doesn't exist at crawl time. Zero SEO surface for shell-specific interactions.

## Routing and SEO

### URLs unchanged

Every current library and commentary URL keeps its exact path, canonical, and rendered HTML body content.

| URL | Before | After |
|---|---|---|
| `/library/` | BaseLayout + Header + grid | BaseLayout + AppShellChrome(index) + grid |
| `/library/[slug]/` | BaseLayout + Header + article | BaseLayout + AppShellChrome(article) + article + AppShellSheet |
| `/library/page/[n]/` | BaseLayout + Header + paginated grid | BaseLayout + AppShellChrome(index) + paginated grid |
| `/library/saved/` | BaseLayout + Header + saved list | BaseLayout + AppShellChrome(saved) + saved list |
| `/commentary/` | BaseLayout + Header + grid | BaseLayout + AppShellChrome(index) + grid |
| `/commentary/[slug]/` | BaseLayout + Header + post | BaseLayout + AppShellChrome(article) + post + AppShellSheet |
| `/commentary/page/[n]/` | BaseLayout + Header + paginated grid | BaseLayout + AppShellChrome(index) + paginated grid |

### What crawlers see

- **Identical `<head>`:** title, description, canonical, OG, Twitter, JSON-LD, Highwire Press citation_* meta. Guaranteed because `BaseLayout.astro` is single-source and untouched.
- **Identical `<main>` body content:** article title, abstract, full text, references, cards, pagination. The shell wraps this; it does not replace it.
- **Different chrome region:** `<nav class="app-shell-nav">` instead of `<header class="site-header">`. Both are semantically equivalent navigation. Google treats them the same.
- **Sidebar and middle column have `data-pagefind-ignore="all"`** — no nav content leaks into the Pagefind index.

### Indexing surfaces

- **Pagefind:** runs on build, walks DOM for content blocks. Article body is inside `<main>`, which exists in both shells. Sidebar is ignored. **No re-index needed.**
- **Vectorize:** `scripts/embed-library-ci.mjs` embeds from `articles.json` and `posts.json`, not rendered HTML. Source data is untouched. **No re-embed needed.**
- **Google/GSC:** no URL changes, no canonical changes, no sitemap changes, no robots.txt changes, no hreflang changes. Rankings preserved.

### Canonical lockdown

**Forbidden:** any query-string-driven shell mode (`?view=app`, `?shell=default`, etc.). A new CI script `scripts/check-canonical-lockdown.mjs` greps for such patterns and fails the build if found.

Current hard-coded canonicals in library/commentary index pages are preserved as-is. The shell never manipulates canonical URLs.

**Wiring:** This script must be invoked from `.github/workflows/deploy.yml` to run on every push. Add a new step after the existing `Security guard` step:

```yaml
- name: Canonical lockdown
  run: node scripts/check-canonical-lockdown.mjs
```

Workflow file edits to `deploy.yml` require the `WORKFLOWS_PAT` repo secret wired into `actions/checkout@v4` (per CLAUDE.md). Verify the workflow runs on the PR's first push; absence of the step is a silent gate failure.

**Allowlist over denylist:** The script's source of truth is `ALLOWED_PARAMS` (an explicit list of permitted query parameters on `/library/*` and `/commentary/*`). Default v1 allowlist: `['topic', 'page', 'q', 'sort']` (verify against actual existing usage during pre-flight). Any query parameter NOT in the allowlist fails the gate — covers `?view=`, `?shell=`, `?app=`, `?app_layout=`, `?application=`, and anything else not explicitly approved. New canonical-affecting params require an explicit allowlist edit + reviewer sign-off.

### `/library/saved/` noindex

`/library/saved/` already passes `noindex` to BaseLayout (saved.astro:9), and BaseLayout.astro:165 emits `<meta name="robots" content="noindex, nofollow" />` accordingly. Verify this in pre-flight by curling the built page and grepping the rendered HTML — do NOT add an inline `<meta>` tag to saved.astro (would duplicate). The sidebar's link to /library/saved/ does not need `rel="nofollow"`: noindex prevents indexing, crawl budget for a single auth-gated page is negligible, and the existing pattern (linking to noindex pages) is already in use across the site.

### Static rendering

Library and commentary pages are Astro static builds. The shell introduces no SSR, no new API endpoints, no new CF Pages Functions, no new middleware. All runtime code is client-side and runs after page load.

## Theme system (v1: light + dark)

### CSS tokens

```css
:root,
:root[data-theme="light"] {
  --bg-primary: <from STYLE-GUIDE.md>;
  --bg-secondary: <from STYLE-GUIDE.md>;
  --text-primary: <from STYLE-GUIDE.md>;
  --text-secondary: <from STYLE-GUIDE.md>;
  --accent: <from STYLE-GUIDE.md>;
  /* existing light palette */
}

:root[data-theme="dark"] {
  --bg-primary: #0f1419;
  --bg-secondary: #161c24;
  --bg-tertiary: #1f2630;
  --text-primary: #e6e9ee;
  --text-secondary: #9aa4b8;
  --accent: /* dark variant from STYLE-GUIDE.md */;
  /* ported from deleted prototype where applicable */
}
```

Exact hex values pulled from `STYLE-GUIDE.md` at implementation time. Dark palette adapts the prior prototype's dark mode.

### Scope

v1 applies `data-theme` to `<html>` globally (the FOUC script runs on every page), but only app-shell pages meaningfully respect the variants. Non-shell pages use current hardcoded light values. When clicking from library to a pillar page, the user's theme preference is remembered but visual application reverts to light for that page.

This is an acceptable inconsistency in v1. If Brian later wants global theming, that's a separate decision.

### Toggle behavior

Light ↔ dark. Icon changes to reflect current state. Click handler debounced to one transition per 200ms. No OS `prefers-color-scheme` auto-detect — explicit user choice only.

On shell pages, Header and Footer are not rendered (per `chrome="shell"` prop in BaseLayout). The theme toggle exists ONLY in the sidebar (desktop) and drawer (mobile). Both share a single inline IIFE (`window.__rrmThemeToggle__()`) defined once in AppShellChrome's mounted script; both sidebar and drawer toggle DOM nodes register click handlers against this shared function. Toggle state reads/writes from `localStorage.rrm_theme` debounced 200ms via the shared handler. CSS-driven icon visibility (`:root[data-theme='dark'] .icon-moon { display: none; }` etc.) keeps icons in sync without explicit JS.

### No-context CSS gate

CSS rule `.shell-no-context .app-shell-layout { grid-template-columns: 240px 1fr 0; } .shell-no-context .app-shell-middle-column { display: none; }` collapses the column rail before first paint on cold-land. Warm-arrive lacks the class; column renders normally. The `<aside class="app-shell-middle-column">` is ALWAYS emitted in static HTML so Pagefind's `data-pagefind-ignore` invariant (G-SEO-2) holds and Astro's single static build serves both cold and warm landings without CLS regression.

### Migration note (theme)

Existing users with `localStorage.rrm_theme` set retain their preference. New cold visitors with dark OS preference no longer auto-detect; they get light by default until they explicitly toggle. This is intentional — the v1 promise is explicit user choice. The pre-PR FOUC in `BaseLayout.astro` lines 167–179 wrote `localStorage.rrm_theme` from `prefers-color-scheme` on first visit; replacing that script with the read-only block in §Data flow is the single permitted BaseLayout edit.

## Mobile behavior

### Breakpoint

`max-width: 900px` activates mobile mode. Above 900px, desktop sidebar layout.

### Layout at ≤900px

- Sidebar hidden (`display: none`)
- Bottom nav fixed at the bottom with four tabs: Library, Commentary, Saved, Account
- Main content fills the viewport above the bottom nav, with `padding-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))`
- Hamburger drawer accessible via icon in the top strip
- Top strip: brand wordmark + back arrow (on article pages) + hamburger icon
- Middle column replaced by pull-up sheet
- Peek bar visible only when sessionStorage has context

### Hamburger drawer

Tapping the hamburger slides the sidebar in from the left as a drawer. Contains identical items to the desktop sidebar (Reading, Explore, Donate, account, theme toggle). Overlay dims the main content. Tap overlay, swipe left, or tap the × to dismiss.

**No-JS fallback:** CSS-only `:target` pattern. `<a href="#shell-drawer">` toggles `:target` class, styled to slide in. Actual close via `<a href="#">` inside the drawer.

### Pull-up sheet (`AppShellSheet.astro`)

Three states:

| State | Height | Entry | Exit |
|---|---|---|---|
| Hidden | 0 | No sessionStorage context, or drag peek downward beyond threshold | Arrive with context → peek |
| Peek | ~44px bar above bottom nav | sessionStorage context present | Tap peek or drag up → half |
| Half | ~58% screen height | Tap peek, or drag up from peek | Drag down → peek, further → hidden |
| Full | ~92% screen height | Drag up from half beyond threshold | Drag down → half, further → peek |

**Implementation:** native `<dialog>` element with `::backdrop`. Provides focus trap, inert background, ESC-to-close for free on iOS Safari 18+. Body scroll lock via `position: fixed; top: -scrollY; width: 100%` pattern.

**Feature-detect:** AppShellSheet's mount script first checks `'showModal' in HTMLDialogElement.prototype`. If absent (iOS Safari 14–17 long-tail, older Android WebViews), the sheet does NOT render: peek bar is hidden via `<html>.classList.add('shell-no-sheet')`, getShellContext() returns null on this device for sheet purposes (middle column behavior on desktop is unaffected). Documented degradation: mobile users on these older browsers see no sheet, no peek bar — the same UX as cold-landing. No polyfill in v1 (cost not justified; long-tail diminishing). v2 may revisit.

**CSS contract (load-bearing on iOS Safari):**
- Sheet list element: `overscroll-behavior: contain; touch-action: pan-y;` — prevents scroll momentum from bubbling to the sheet body.
- Grip element: `touch-action: none;` with `pointerdown` capture — prevents touch from being claimed by the underlying scroll container.
- `pointerdown` handler on grip uses `event.target.closest('.sheet-grip')` predicate before binding pointermove; events bubbling from list scroll do not reach the grip handler.
- Sheet body (`<dialog>`): `overscroll-behavior: contain;` to keep momentum contained even at sheet boundaries.

**Touch handlers:** `pointerdown` on grip or peek bar captures starting Y. `pointermove` updates `translateY` clamped to `[hidden..full]`. `pointerup` snaps to nearest state based on velocity + position. Spring animation: `transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1)`. Horizontal swipes pass through. Scroll inside sheet list does not drag the sheet — only the grip area triggers drag.

**Momentum-safe scroll lock:** Capture `scrollY` via `requestAnimationFrame` so momentum-scroll has settled at least one frame before lock applies: `requestAnimationFrame(() => { savedScrollY = window.scrollY; document.body.style.position = 'fixed'; document.body.style.top = `${-savedScrollY}px`; document.body.style.width = '100%'; })`. On sheet close, restore via `window.scrollTo({top: savedScrollY, behavior: 'instant'})`. Acceptance criterion: open sheet during a flick, close, verify final scroll position within 50px of pre-open position on a physical iPhone.

**Accessibility:**
- `<dialog role="dialog" aria-modal="true" aria-labelledby="sheet-title">`
- Focus trap via native `<dialog>` behavior
- ESC key collapses to peek (not hidden — peek is the persistent context indicator)
- VoiceOver / TalkBack announce state transitions
- Peek bar is a `<button aria-expanded="false">`

**Reduced motion:** `@media (prefers-reduced-motion: reduce)` shortens sheet transitions to 80ms and drawer slide to instant.

### Z-stack (CSS custom props, defined up front)

```css
:root {
  --z-bottom-nav: 60;
  --z-sheet-peek: 70;
  --z-sheet: 80;
  --z-drawer: 90;
  --z-modal: 100;
}
```

Enforced by a proof gate: raw `z-index: \d+` in app-shell CSS files fails the build.

### Print styles

```css
@media print {
  .app-shell-nav,
  .app-shell-drawer,
  .app-shell-bottom-nav,
  .app-shell-sheet,
  .app-shell-middle-column {
    display: none !important;
  }
  .app-shell-main {
    margin: 0 !important;
    padding: 0 !important;
  }
}
```

Medical researchers print articles. Required on day one.

## Edge cases

| Case | Behavior |
|---|---|
| Cold landing from Google | No sessionStorage. Middle column and sheet render nothing. Article is full-width. |
| Stale context from previous session in a different tab | Current tab's sessionStorage is independent. No cross-tab leakage. |
| Bottom-nav tab click | sessionStorage cleared before navigation. |
| Context references a retracted article | Article page shows retraction notice (existing behavior). Shell doesn't pre-validate. |
| Article missing from current `articles.json` | Click → 404. Log `console.warn('shell: stale context slug', slug)`. Acceptable. |
| Empty result set | Writer doesn't fire. Context not written. |
| Signed-out user on `/library/saved/` | Page auth gate handles it (existing). Shell is orthogonal. |
| Direct link to `/library/page/5/` | Writer captures page-5 context on first card click. Sheet shows page-5 siblings. |
| Filter state carryover | Writer includes `filters` and `returnUrl` with filter applied. Sheet shows filtered results. |
| User clicks theme toggle rapidly | Debounced 200ms. No flicker (FOUC script already ran). |
| No-JS | Sidebar static HTML works. Bottom nav works. Drawer via `:target` CSS. Theme toggle inert. Sheet and middle column absent. |
| `prefers-reduced-motion` | Sheet snap shortens to 80ms. Drawer slide instant. |
| Narrow desktop (900–1200px) | Middle column drops to 200px. Below 900px → mobile mode. |
| Very long sibling lists (300+) | Not reachable in v1 (slugs[] is the current visible page only, capped at 50–100 entries). If v2 adds full-filter virtualization, render first 50 + lazy-load on scroll. |
| Long article titles in sheet | `-webkit-line-clamp: 2` with `title` attribute for full text. |
| RSS (`commentary/rss.xml.ts`) | Does not use BaseLayout. Unaffected. Verify in pre-flight. |
| Sitemap.xml | Build-time. Unaffected. |
| `rrm-router` interactions | Router runs before CF Pages. Shell client-side code makes no URL assumptions. |
| Pagefind search click | SearchBar writes context with `source: 'search'`. **SearchBar is guarded** — requires `guard:update` + invariant re-verify as part of PR. |
| Middle column indexed by Pagefind | `data-pagefind-ignore="all"` on aside root. Proof gate enforced. |
| Canonical URL split via query string | Forbidden. Proof gate `check-canonical-lockdown.mjs` validates all query parameters on /library/* and /commentary/* are in the explicit `ALLOWED_PARAMS` allowlist; anything else fails the build. |
| `/library/saved/` noindex | Verify in pre-flight (curl + grep `dist/library/saved/index.html`). Do NOT add inline tag — already emitted by BaseLayout from the `noindex` prop (see §`/library/saved/` noindex). |
| Viewport crosses 900px boundary mid-session | Window resize listener calls `dialog.close()` if entering desktop mode while sheet is open. Middle column and sheet are both mounted in DOM at all viewports; CSS-hides one or the other. Sheet's open state resets to `peek` on entering mobile mode if sessionStorage has context, otherwise `hidden`. |

## Testing strategy

### Layer 1: proof gates (arise-scanner + custom)

| Gate | Check | Enforcement |
|---|---|---|
| G-SEO-1 | `BaseLayout.astro` `<head>` block byte-identical to pre-PR baseline EXCEPT the inline FOUC `<script is:inline>` at lines 167–179, which is the single permitted edit. | Hash-diff against pre-PR baseline (with the FOUC region carved out) |
| G-SEO-2 | `data-pagefind-ignore="all"` on sidebar AND middle column AND `<dialog>` sheet root | `grep` across `AppShellChrome.astro` and `AppShellSheet.astro` — both must carry the attribute on every nav/aside/dialog root |
| G-SEO-3 | No query-string shell modes; all `/library/*` + `/commentary/*` query params in `ALLOWED_PARAMS` allowlist | `scripts/check-canonical-lockdown.mjs` (allowlist source: `['topic', 'page', 'q', 'sort']` — denylist of `?view=\|?shell=\|?app=` is insufficient against future-param drift) |
| G-SEO-4 | `/library/saved/` rendered HTML contains `<meta name="robots" content="noindex, nofollow" />` exactly once | post-build grep against `dist/library/saved/index.html`. Source-level grep against saved.astro is insufficient because noindex is emitted by BaseLayout from a prop. |
| G-SEO-5 | Canonical URL has no query params in shell-routed pages; canonical never depends on JS-driven shell state | Unit test against `articles.json` + `posts.json`; verify no `?view=`/`?shell=` in canonical strings emitted by BaseLayout |
| G-SEO-6 | `<aside class="app-shell-middle-column" data-pagefind-ignore="all">` always present in static HTML of every `/library/[slug]/` and `/commentary/[slug]/` page; visibility is class-gated via `.shell-no-context` only, never DOM-conditional. | `grep` build output |
| G-GUARD | `BaseLayout.astro` hash matches `guard-manifest.json` (after being added) | `npm run guard` |
| G-CHROME-1 | BaseLayout's `chrome` prop ∈ {`'default'`, `'shell'`}; shell routes pass `chrome='shell'`; non-shell routes either omit the prop or pass `'default'`. | `grep` across `src/pages/` |
| G-ARCH-1 | No new `/app/` prefix paths | `grep` — fails if `src/pages/app/` has any file |
| G-ARCH-2 | NO non-library, non-commentary page in `src/pages/` imports `AppShellChrome`. Tolerates partial coverage during a multi-commit PR (commit 1 wraps commentary only; commit 2 wraps library). Failure mode: only fails on a non-shell page wrapping. | `grep` across `src/pages/` |
| G-Z-STACK | Z-index in app-shell CSS comes from `--z-*` custom props only; bottom-nav < sheet-peek < sheet < drawer < modal stacking order is preserved | `grep` against `src/styles/app-shell.css` and any `<style>` blocks in `AppShellChrome.astro` / `AppShellSheet.astro` — fails on raw `z-index: \d+` (numeric literals); also asserts `--z-bottom-nav < --z-sheet-peek < --z-sheet < --z-drawer < --z-modal` numerically |

### Layer 2: Astro and TypeScript build verification

- `astro check` passes with zero new errors (baseline in `scripts/type-check-baseline.json`)
- `npm run build` succeeds
- Page count matches: ≥3,200 library, ≥18 commentary, ≥25 FAQs, ≥1 course
- `.baselines.json` record counts respected
- `npm run guard` passes with updated manifest (BaseLayout added)
- Pagefind index builds; spot-check a known article search returns expected result
- Vectorize embeddings NOT re-run (source data unchanged)

### Layer 3: Playwright end-to-end

`tests/e2e/app-shell.spec.ts` against local `npm run dev`:

**Desktop (1440×900):**
1. Visit `/library/`. Sidebar visible, grid visible, no middle column, no bottom nav, no sheet.
2. Click first article card. Navigate to `/library/[slug]/`. Sidebar visible, middle column present, current article highlighted.
3. Click a sibling. Navigate to new article. Sibling list preserved.
4. Click × on middle column. Column collapses (transient).
5. Click "Commentary" in sidebar. sessionStorage cleared.
6. Click theme toggle. Cycles light ↔ dark. Reload → persists.

**Mobile (375×812):**
1. Visit `/library/`. Bottom nav visible, sidebar hidden, drawer closed.
2. Tap hamburger. Drawer slides in. Tap overlay → closes.
3. Tap first article card. Article loads. Peek bar above bottom nav.
4. Tap peek. Sheet opens to half. Article dims.
5. Drag grip up. Sheet expands to full.
6. Tap sibling in sheet. Navigate. Sheet returns to peek.
7. Tap outside sheet. Collapses.
8. Tap Library tab in bottom nav. Returns to `/library/`. sessionStorage cleared.

**Cold landing:**
1. Direct navigate to `/library/napro-stanford-2008/`. Article visible. No middle column (desktop). No peek bar (mobile).

**No-JS:**
1. Disable JS. Visit `/library/`. Sidebar renders. Bottom nav renders on mobile. Theme toggle visible but inert. Sheet and middle column absent.
2. Tap hamburger (`href="#shell-drawer"`). `:target` drawer opens.

### Layer 4: visual regression (manual pre-merge)

Screenshots for PR description:
- Library index (desktop light, desktop dark, mobile light, mobile dark)
- Library article (desktop with context, desktop cold, mobile with peek, mobile cold)
- Commentary index (same matrix)
- Commentary post (same matrix)
- Drawer open (mobile)
- Sheet half (mobile)
- Sheet full (mobile)
- Print preview of an article (no sidebar, no sheet, no bottom nav)

Diff against current screenshots to catch unintended layout shift on non-shell pages. Spot-check homepage, `/naprotechnology/`, `/donate/`, `/account/`.

### Layer 5: production smoke test (post-deploy)

- `curl -I https://rrmacademy.org/library/` — `text/html`, fresh cache
- `curl -s https://rrmacademy.org/library/ | grep -c 'data-pagefind-ignore'` — confirms presence
- Google Rich Results Test on one library article + one commentary post — MedicalScholarlyArticle + BlogPosting validate
- GSC URL Inspection on `/library/` — rendered HTML shows sidebar, `<head>` meta unchanged
- Pagefind live query for a known phrase — top result is the expected article, no sidebar content leaking

### Not tested in v1

- Pillar pages / courses / FAQs shell integration (out of scope)
- Vectorize re-embedding (no source data change)
- Load testing the sheet
- iOS device farm (one manual device spot-check is sufficient for v1)

## Implementation order within the PR

Two commits, one PR:

**Commit 1 — commentary shell**
- Create `AppShellChrome.astro` (emits the inline context-writer `<script>` when `context="index"`) and `AppShellSheet.astro`
- Create `src/styles/app-shell.css`
- Add `scripts/check-canonical-lockdown.mjs` to CI
- Replace BaseLayout.astro lines 167–179 (the existing FOUC `<script is:inline>` block) with the 3-line block specified in §Data flow > localStorage.rrm_theme. The existing block sets `localStorage.rrm_theme` from `prefers-color-scheme` on first visit, which contradicts the v1 "explicit user choice only" rule. Add the `chrome="default"|"shell"` prop to BaseLayout per Finding #2 (omits `<Header />`, `<Footer />`, and outer `<main>` when `chrome="shell"`). Re-run `npm run guard:update` to bake the new BaseLayout hash. Add BaseLayout.astro to `guard-manifest.json` IF NOT ALREADY PRESENT (verify in pre-flight).
- Modify `src/components/SearchBar.astro` to write sessionStorage on Pagefind result click with `source: 'search'` (per spec line 384). Re-run `npm run guard:update` to rebake SearchBar's manifest hash. SearchBar is guarded — verify all security invariants still pass (`Access-Control-Allow-Origin`, no err.message leaks, no new external fetches without try/catch).
- Update `src/pages/commentary/index.astro`, `[...slug].astro`, `page/[page].astro` to wrap their body in `<AppShellChrome context="...">` and pass `chrome="shell"` to BaseLayout
- Add `<AppShellSheet />` to `commentary/[...slug].astro`
- Verify commentary pages build, deploy to preview, smoke-test
- Fix any commentary-specific issues before touching library

**Commit 2 — library shell**
- Update `src/pages/library/index.astro`, `[...slug].astro`, `page/[page].astro`, `saved.astro` to wrap their body in `<AppShellChrome context="...">` and pass `chrome="shell"` to BaseLayout
- Add `<AppShellSheet />` to `library/[...slug].astro`
- Verify library pages build, deploy to preview, smoke-test
- Confirm G-SEO-5 unit test passes (canonical URL lockdown)
- Add Playwright tests

Both commits ship together in one PR. No intermediate production deploy between them.

**Atomicity guard:** Both commits ship behind a build-time env var `SHELL_ROUTES`. Default empty. Commit 1 introduces the components and CSS; the env var stays empty, so AppShellChrome wraps NOTHING in production. Commit 2 enables `SHELL_ROUTES=commentary,library` in `deploy.yml` and wraps the pages. If commit 2 fails CI, commit 1 lands inert. Reverting just the env-var change rolls back both routes atomically. Rollback procedure: open emergency PR setting `SHELL_ROUTES=` (empty); merge bypasses auto-FF queue. The rrm-academy-cf claude/* auto-FF policy means commit 1 can land on main alone; the env-var gate is what makes that safe.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| iOS Safari body scroll lock edge cases | High | Use `position: fixed; top: -scrollY; width: 100%` pattern. Budget 1 day. Test on physical iPhone. |
| Pagefind indexes sidebar/middle column content | Medium | `data-pagefind-ignore="all"` proof gate. Verify post-build. |
| Canonical URL drift via query string | Low | Dedicated CI check. Forbidden at build time. |
| `BaseLayout.astro` accidental meta regression | Low | Added to guard manifest in this PR. Pre-commit hook catches any hash mismatch. |
| SearchBar (guarded) needs shell-aware changes | Medium | Modified in commit 1. `guard:update` dance + re-verify invariants before committing. |
| Dark theme ripple to existing scoped styles | Medium | Shell-only scope in v1. Acceptable inconsistency; resolved only if Brian decides to expand theming to non-shell pages later. |
| Theme toggle drift between sidebar and drawer | Low | Both register against shared `__rrmThemeToggle__` function; CSS-driven icon visibility means no explicit DOM sync needed. |
| Sheet drag gesture conflicts with scroll | High | Grip-only drag trigger + `touch-action`/`overscroll-behavior` CSS contract on sheet list and grip (see §Mobile behavior). Test on real touch device. |
| Drawer + sheet z-index conflicts | Medium | CSS custom props for z-stack (`--z-bottom-nav` < `--z-sheet-peek` < `--z-sheet` < `--z-drawer` < `--z-modal`); G-Z-STACK proof gate fails build on raw `z-index: \d+` in app-shell CSS. |
| iOS 14–17 sheet absence | Low | Feature-detect via `'showModal' in HTMLDialogElement.prototype`; long-tail users see cold-land UX (no sheet, no peek bar). Acceptable in v1. |
| Non-shell pages accidentally use shell CSS | Low | Scoped class names (`app-shell-*`). Pillar page screenshots in pre-merge diff. |

## Open questions for the plan

None. All architectural decisions are locked. The writing-plans skill should produce a step-by-step implementation sequence from this spec without further clarification.

## Out of scope for this PR (future work)

- Theme expansion to non-shell pages
- Pillar guides adopt the shell (future PR)
- Courses adopt the shell (future PR)
- FAQs adopt the shell (future PR)
- Full theme audit across the site
- Related articles block at the bottom of articles (separate feature)
- Sheet virtualization library if sibling counts exceed 500
- Saved article sync across devices

---

**Review status:**
- 2026-04-10: Senior SWE review complete. Verdict: needs revisions → all 10 revisions accepted → design updated → re-approved.
- 2026-05-06: `/arise --deep` (4 Opus 4.7 tracers — Data Lifecycle, Error Cascade, Boundary Fuzzer, State Machine). 25 findings (2 CRITICAL, 8 HIGH, 7 MEDIUM, 8 LOW) folded in via 27 spec amendments. Eink theme dropped from scope (Brian decision). Two CRITICALs resolved by acknowledging BaseLayout receives two narrow, audited edits (FOUC inline script + new `chrome="default"|"shell"` prop) — the original "BaseLayout untouched" claim was false. Additional security hardening: sessionStorage shape validator, `pagehide` write bus, storage try/catch wrapping, dialog feature-detect, `SHELL_ROUTES` atomicity flag.

Ready for implementation plan.
