# Library + Commentary App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top-Header layout on `/library/*` and `/commentary/*` with a persistent left-sidebar app shell (light + dark theme, mobile drawer + pull-up sheet) without breaking SEO, indexing, or canonical URLs.

**Architecture:** AppShellChrome.astro wraps page content as a slot child; BaseLayout receives a new `chrome="default"|"shell"` prop that suppresses `<Header />`, `<Footer />`, and the outer `<main>` on shell routes. Sibling context flows through tab-scoped `sessionStorage.rrm-shell-context` (strict shape validator, `pagehide` write bus). Two-commit PR (commentary first, library second) gated by `PUBLIC_SHELL_ROUTES` env-var feature flag for atomic rollback (PUBLIC_ prefix required so Vite exposes the value to `import.meta.env`).

**Tech Stack:** Astro 5.3 (static), CSS custom properties for theme + z-stack, native `<dialog>` for sheet, Pagefind (untouched), Cloudflare Pages, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-04-10-library-commentary-app-shell-design.md` (commit `bc45727`).

---

## File Structure

**Created:**
- `src/components/AppShellChrome.astro` — sidebar, drawer, bottom nav, middle column, theme toggle, pre-paint inline script, click writer
- `src/components/AppShellSheet.astro` — mobile pull-up sheet (peek/half/full states, `<dialog>` based)
- `src/styles/app-shell.css` — sidebar/drawer/middle-column/sheet/dark-theme tokens, `.shell-no-context` class, z-stack custom props, print rules
- `scripts/check-canonical-lockdown.mjs` — CI gate enforcing `ALLOWED_PARAMS` allowlist on `/library/*` + `/commentary/*` query params
- `tests/e2e/app-shell.spec.ts` — Playwright E2E for desktop, mobile, cold-land, no-JS scenarios
- `tests/unit/canonical-lockdown.test.mjs` — unit test for G-SEO-5 (canonical URLs have no query params)

**Modified:**
- `src/layouts/BaseLayout.astro` — add `chrome` prop, replace FOUC inline script (lines 167-179)
- `src/components/SearchBar.astro` — write `sessionStorage.rrm-shell-context` on Pagefind-result click with `source: 'search'`
- `guard-manifest.json` — rebake hashes for `BaseLayout.astro` (already guarded) and `SearchBar.astro` (already guarded)
- `.github/workflows/deploy.yml` — add `Canonical lockdown` step + `PUBLIC_SHELL_ROUTES` env var
- `src/pages/commentary/index.astro`, `src/pages/commentary/[...slug].astro`, `src/pages/commentary/page/[page].astro` — wrap in AppShellChrome with `chrome="shell"` (commit 1)
- `src/pages/library/index.astro`, `src/pages/library/[...slug].astro`, `src/pages/library/page/[page].astro`, `src/pages/library/saved.astro` — wrap (commit 2)

**Untouched but suppressed on shell pages:** `src/components/Header.astro`, `src/components/Footer.astro`.

---

## Phase 1 — Foundations (CSS + component skeletons, no integration)

### Task 1: Create app-shell.css with z-stack and base tokens

**Files:**
- Create: `src/styles/app-shell.css`

- [ ] **Step 1: Create the file with z-stack custom props and dark-theme tokens**

```css
/* src/styles/app-shell.css
 * Z-stack, theme tokens, layout grid, drawer, middle column, sheet, print rules.
 * Z-stack and color tokens are the load-bearing primitives — proof gates G-Z-STACK
 * and G-SEO-1 enforce them. */

:root {
  --z-bottom-nav: 60;
  --z-sheet-peek: 70;
  --z-sheet: 80;
  --z-drawer: 90;
  --z-modal: 100;

  --shell-sidebar-width: 240px;
  --shell-middle-column-width: 280px;
  --shell-bottom-nav-height: 56px;
  --shell-breakpoint-mobile: 900px;
}

:root[data-theme="dark"] {
  --bg-primary: #0f1419;
  --bg-secondary: #161c24;
  --bg-tertiary: #1f2630;
  --text-primary: #e6e9ee;
  --text-secondary: #9aa4b8;
  --border-subtle: #232a36;
}

/* Cold-land / no-context gate: collapses middle column rail before first paint. */
.shell-no-context .app-shell-layout {
  grid-template-columns: var(--shell-sidebar-width) 1fr 0;
}
.shell-no-context .app-shell-middle-column {
  display: none;
}

/* Feature-detect fallback: hides peek bar when <dialog>.showModal absent. */
.shell-no-sheet .app-shell-sheet,
.shell-no-sheet .app-shell-sheet-peek {
  display: none;
}

/* Print: hide all chrome, only article content prints. */
@media print {
  .app-shell-nav,
  .app-shell-drawer,
  .app-shell-bottom-nav,
  .app-shell-sheet,
  .app-shell-sheet-peek,
  .app-shell-middle-column {
    display: none !important;
  }
  .app-shell-main {
    margin: 0 !important;
    padding: 0 !important;
  }
}
```

- [ ] **Step 2: Verify file is well-formed**

Run: `head -20 src/styles/app-shell.css`
Expected: prints the comment header + first :root block.

- [ ] **Step 3: Commit**

```bash
git add src/styles/app-shell.css
git commit -m "feat: add app-shell CSS skeleton with z-stack tokens + no-context gate"
```

---

### Task 2: Add desktop layout grid + sidebar styles to app-shell.css

**Files:**
- Modify: `src/styles/app-shell.css`

- [ ] **Step 1: Append layout grid rules**

Append to `src/styles/app-shell.css`:

```css
/* Desktop layout grid (above mobile breakpoint). */
@media (min-width: 901px) {
  .app-shell-layout {
    display: grid;
    grid-template-columns: var(--shell-sidebar-width) 1fr var(--shell-middle-column-width);
    grid-template-areas: "nav main aside";
    min-height: 100vh;
  }
  .app-shell-nav { grid-area: nav; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .app-shell-main { grid-area: main; min-width: 0; }
  .app-shell-middle-column { grid-area: aside; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .app-shell-bottom-nav, .app-shell-drawer, .app-shell-drawer-toggle, .app-shell-sheet, .app-shell-sheet-peek { display: none; }
}

/* Sidebar visual styling. */
.app-shell-nav {
  background: var(--bg-primary, #fff);
  border-right: 1px solid var(--border-subtle, #e5e7eb);
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.app-shell-nav__section { display: flex; flex-direction: column; gap: 0.25rem; }
.app-shell-nav__heading {
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em;
  text-transform: uppercase; color: var(--text-secondary, #6b7280);
  margin: 0.5rem 0 0.25rem;
}
.app-shell-nav__link {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.75rem; border-radius: 0.375rem;
  color: var(--text-primary, #111827); text-decoration: none;
  font-size: 0.875rem;
}
.app-shell-nav__link:hover { background: var(--bg-secondary, #f3f4f6); }
.app-shell-nav__link[aria-current="page"] { background: var(--bg-tertiary, #e5e7eb); font-weight: 600; }
.app-shell-nav__spacer { flex: 1; }
.app-shell-nav__cta { /* Donate button */ }
.app-shell-nav__footer { display: flex; align-items: center; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--border-subtle, #e5e7eb); }
```

- [ ] **Step 2: Verify CSS parses**

Run: `npx prettier --check src/styles/app-shell.css 2>&1 || true` (if prettier configured; otherwise visual inspection)
Expected: file parses without syntax errors. If prettier complains about formatting, run `npx prettier --write src/styles/app-shell.css`.

- [ ] **Step 3: Commit**

```bash
git add src/styles/app-shell.css
git commit -m "feat: add desktop layout grid and sidebar styles"
```

---

### Task 3: Add mobile bottom-nav, drawer, sheet styles to app-shell.css

**Files:**
- Modify: `src/styles/app-shell.css`

- [ ] **Step 1: Append mobile rules**

Append to `src/styles/app-shell.css`:

```css
/* Mobile (≤900px): sidebar hidden, bottom nav fixed, drawer slides from left. */
@media (max-width: 900px) {
  .app-shell-layout {
    padding-bottom: calc(var(--shell-bottom-nav-height) + env(safe-area-inset-bottom));
  }
  .app-shell-nav { display: none; }
  .app-shell-middle-column { display: none; }

  .app-shell-bottom-nav {
    position: fixed; bottom: 0; left: 0; right: 0;
    height: calc(var(--shell-bottom-nav-height) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--bg-primary, #fff);
    border-top: 1px solid var(--border-subtle, #e5e7eb);
    display: flex; align-items: stretch; justify-content: space-around;
    z-index: var(--z-bottom-nav);
  }
  .app-shell-bottom-nav__tab {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.125rem; padding: 0.25rem; text-decoration: none;
    color: var(--text-secondary, #6b7280); font-size: 0.6875rem;
  }
  .app-shell-bottom-nav__tab[aria-current="page"] { color: var(--text-primary, #111827); font-weight: 600; }

  .app-shell-drawer {
    position: fixed; top: 0; left: 0; bottom: 0; width: min(85%, 320px);
    background: var(--bg-primary, #fff);
    transform: translateX(-100%); transition: transform 200ms ease-out;
    z-index: var(--z-drawer);
    overflow-y: auto;
  }
  .app-shell-drawer:target,
  .app-shell-drawer[data-open="true"] { transform: translateX(0); }
  .app-shell-drawer__overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    opacity: 0; pointer-events: none; transition: opacity 200ms;
    z-index: calc(var(--z-drawer) - 1);
  }
  .app-shell-drawer:target ~ .app-shell-drawer__overlay,
  .app-shell-drawer[data-open="true"] ~ .app-shell-drawer__overlay { opacity: 1; pointer-events: auto; }

  /* Hamburger toggle (Task 13 markup): fixed top-left on mobile, hidden on desktop. */
  .app-shell-drawer-toggle {
    position: fixed;
    top: calc(0.5rem + env(safe-area-inset-top));
    left: 0.5rem;
    z-index: calc(var(--z-drawer) - 1);
    width: 44px; height: 44px;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--bg-primary, #fff);
    color: var(--text-primary, #111827);
    border: 1px solid var(--border-subtle, #e5e7eb);
    border-radius: 8px;
    font-size: 1.125rem; line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  }
  .app-shell-drawer-toggle:focus-visible {
    outline: 2px solid var(--text-primary, #111827);
    outline-offset: 2px;
  }
}

/* Pull-up sheet (mobile only, native <dialog>) */
.app-shell-sheet {
  position: fixed; bottom: 0; left: 0; right: 0;
  max-height: 92vh;
  background: var(--bg-primary, #fff);
  border-top: 1px solid var(--border-subtle, #e5e7eb);
  border-top-left-radius: 16px; border-top-right-radius: 16px;
  margin: 0; padding: 0; border: 0;
  transform: translateY(100%);
  transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
  z-index: var(--z-sheet);
}
.app-shell-sheet[open] { transform: translateY(0); }
.app-shell-sheet[data-state="peek"] { transform: translateY(calc(100% - 44px)); }
.app-shell-sheet[data-state="half"] { transform: translateY(42%); }
.app-shell-sheet[data-state="full"] { transform: translateY(8%); }
.app-shell-sheet::backdrop {
  background: rgba(0,0,0,0.4);
}
.app-shell-sheet__grip { touch-action: none; }
.app-shell-sheet__list { overscroll-behavior: contain; touch-action: pan-y; overflow-y: auto; }

@media (prefers-reduced-motion: reduce) {
  .app-shell-sheet { transition-duration: 80ms; }
  .app-shell-drawer { transition-duration: 0ms; }
}
```

- [ ] **Step 2: Visual sanity check**

Run: `wc -l src/styles/app-shell.css`
Expected: ~150-180 lines. If much longer, you've added duplicate rules.

- [ ] **Step 3: Commit**

```bash
git add src/styles/app-shell.css
git commit -m "feat: add mobile bottom nav, drawer, and sheet CSS"
```

---

### Task 4: Create AppShellChrome.astro skeleton (markup only, no behavior)

**Files:**
- Create: `src/components/AppShellChrome.astro`

- [ ] **Step 1: Create the component**

```astro
---
// AppShellChrome.astro — left-sidebar app shell wrapper for /library/* and /commentary/*.
//
// Responsibilities (per spec §Component boundaries):
//   - Emit <main class="app-shell-main"> directly (BaseLayout chrome="shell" omits its <main>)
//   - Render desktop sidebar (above 900px), mobile bottom nav (≤900px), hamburger drawer
//   - Always emit <aside class="app-shell-middle-column"> in static HTML; visibility class-gated
//   - Pre-paint inline script: read sessionStorage.rrm-shell-context, add .shell-no-context if absent
//   - Card-click writer: capture intent, commit on pagehide
//   - Theme toggle handler: shared __rrmThemeToggle__() IIFE
//
// All sessionStorage access wrapped in try/catch (per spec §Data flow).

// Frontmatter import emits app-shell.css as a global stylesheet — matches the
// canonical pattern used by BaseLayout.astro (line 8: `import '../styles/global.css'`).
// Do NOT use `<style>@import '/src/styles/app-shell.css';</style>` — Astro <style>
// blocks are component-scoped (data-astro-cid hashing) and root-absolute @import
// paths do not resolve in production builds.
import '../styles/app-shell.css';

// AppShellChrome runs INSIDE BaseLayout's slot. The `<body>` element belongs
// to BaseLayout (`<body class:list={[bodyClass]}>` around line 267), so this
// component cannot influence body classes from inside the slot. bodyClass is
// owned by BaseLayout — pass it there, not here. Adding `bodyClass` to this
// Props interface would create an inert prop that pages might pass and
// silently lose. Don't.
interface Props {
  context: 'index' | 'article' | 'saved';
  currentPath: string;
}

const { context, currentPath } = Astro.props;

// Identify current section for aria-current on sidebar links.
const inLibrary = currentPath.startsWith('/library');
const inCommentary = currentPath.startsWith('/commentary');
const inSaved = currentPath === '/library/saved' || currentPath === '/library/saved/';
---

<div class="app-shell-layout">
  <!-- Desktop sidebar -->
  <nav class="app-shell-nav" data-pagefind-ignore="all" aria-label="Primary">
    <a href="/" class="app-shell-nav__brand" aria-label="RRM Academy home" data-clear-shell-context>
      <strong>RRM Academy</strong>
    </a>

    <div class="app-shell-nav__section">
      <div class="app-shell-nav__heading">Reading</div>
      <a href="/library/" class="app-shell-nav__link" aria-current={inLibrary && !inSaved ? 'page' : undefined}>Research Library</a>
      <a href="/commentary/" class="app-shell-nav__link" aria-current={inCommentary ? 'page' : undefined}>Commentary</a>
      <a href="/library/saved/" class="app-shell-nav__link" aria-current={inSaved ? 'page' : undefined}>Saved Articles</a>
    </div>

    <div class="app-shell-nav__section">
      <div class="app-shell-nav__heading">Explore</div>
      <a href="/guides/" class="app-shell-nav__link">Guides ↗</a>
      <a href="/faqs/" class="app-shell-nav__link">FAQs ↗</a>
      <a href="/courses/" class="app-shell-nav__link">Courses ↗</a>
      <a href="/community/" class="app-shell-nav__link">Community ↗</a>
    </div>

    <div class="app-shell-nav__spacer"></div>

    <a href="/donate/" class="app-shell-nav__cta">Donate</a>

    <div class="app-shell-nav__footer">
      <a href="/account/" class="app-shell-nav__account">Account</a>
      <button type="button" class="app-shell-nav__theme-toggle" aria-label="Toggle theme" data-theme-toggle>
        <span class="icon-moon" aria-hidden="true">🌙</span>
        <span class="icon-sun" aria-hidden="true">☀️</span>
      </button>
    </div>
  </nav>

  <main class="app-shell-main">
    <slot />
  </main>

  <!-- Always emit middle column DOM; visibility class-gated by .shell-no-context (spec §No-context CSS gate) -->
  {context === 'article' && (
    <aside class="app-shell-middle-column" data-pagefind-ignore="all" aria-label="In this index">
      <div class="app-shell-middle-column__inner">
        <h2 class="app-shell-middle-column__heading"></h2>
        <ol class="app-shell-middle-column__list"></ol>
      </div>
    </aside>
  )}

  <!-- Mobile bottom nav -->
  <nav class="app-shell-bottom-nav" data-pagefind-ignore="all" aria-label="Mobile primary">
    <a href="/library/" class="app-shell-bottom-nav__tab" aria-current={inLibrary && !inSaved ? 'page' : undefined} data-clear-shell-context>Library</a>
    <a href="/commentary/" class="app-shell-bottom-nav__tab" aria-current={inCommentary ? 'page' : undefined} data-clear-shell-context>Commentary</a>
    <a href="/library/saved/" class="app-shell-bottom-nav__tab" aria-current={inSaved ? 'page' : undefined} data-clear-shell-context>Saved</a>
    <a href="/account/" class="app-shell-bottom-nav__tab" data-clear-shell-context>Account</a>
  </nav>
</div>

{/* No <style> block: app-shell.css is imported in frontmatter (above) so it
    emits as a global stylesheet, matching BaseLayout's pattern. */}
```

- [ ] **Step 2: Verify Astro can parse the component**

Run: `npx astro check 2>&1 | grep -i "AppShellChrome" | head`
Expected: no errors specific to AppShellChrome.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellChrome.astro
git commit -m "feat: add AppShellChrome skeleton (markup, no behavior)"
```

---

### Task 5: Create AppShellSheet.astro skeleton

**Files:**
- Create: `src/components/AppShellSheet.astro`

- [ ] **Step 1: Create the component**

```astro
---
// AppShellSheet.astro — mobile pull-up sheet (peek/half/full states).
// Native <dialog> with focus trap, ::backdrop, ESC-to-close.
// Feature-detected at mount; if 'showModal' absent (iOS 14-17, older Android),
// adds .shell-no-sheet to <html> to hide peek bar entirely.
---

<button type="button" class="app-shell-sheet-peek" aria-controls="app-shell-sheet" aria-expanded="false" hidden>
  <span class="app-shell-sheet-peek__label">In this index</span>
  <span class="app-shell-sheet-peek__chevron" aria-hidden="true">▲</span>
</button>

<dialog id="app-shell-sheet" class="app-shell-sheet" data-pagefind-ignore="all" aria-modal="true" aria-labelledby="app-shell-sheet-title">
  <div class="app-shell-sheet__grip" role="button" tabindex="0" aria-label="Drag to resize sheet">
    <span class="app-shell-sheet__grip-handle" aria-hidden="true"></span>
  </div>
  <header class="app-shell-sheet__header">
    <h2 id="app-shell-sheet-title" class="app-shell-sheet__title"></h2>
    <button type="button" class="app-shell-sheet__close" aria-label="Close">×</button>
  </header>
  <ol class="app-shell-sheet__list" role="list"></ol>
</dialog>
```

- [ ] **Step 2: Verify**

Run: `npx astro check 2>&1 | grep -i "AppShellSheet" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellSheet.astro
git commit -m "feat: add AppShellSheet skeleton (markup, no behavior)"
```

---

## Phase 2 — BaseLayout edits (the two permitted changes)

### Task 6: Add `chrome` prop to BaseLayout

**Files:**
- Modify: `src/layouts/BaseLayout.astro` (lines ~267-272)

- [ ] **Step 1: Read BaseLayout's current Props interface**

Run: `grep -n "interface Props\|^const {" src/layouts/BaseLayout.astro | head -5`
Expected: identifies the existing Props interface and destructure block.

- [ ] **Step 2: Add `chrome` to Props interface and destructure**

Find the existing `interface Props` block in BaseLayout.astro and add:

```typescript
interface Props {
  // ... existing fields ...
  chrome?: 'default' | 'shell';
}
```

Find the destructure block (`const { ... } = Astro.props;`) and add:

```typescript
const { /* existing */ chrome = 'default' } = Astro.props;
```

- [ ] **Step 3: Replace the body block to gate Header/Footer/main on chrome prop**

Find the body block (currently around line 267-272):

```astro
<body class:list={[bodyClass]}>
  <Header />
  <main>
    <slot />
  </main>
  <Footer />
```

Replace with:

```astro
<body class:list={[bodyClass]}>
  {chrome === 'shell' ? (
    <slot />
  ) : (
    <>
      <Header />
      <main>
        <slot />
      </main>
      <Footer />
    </>
  )}
```

Note: AppShellChrome emits its own `<main class="app-shell-main">` so we do not double-wrap.

- [ ] **Step 4: Verify build still succeeds for non-shell pages**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds. No type errors. Page count matches existing baseline.

- [ ] **Step 5: Smoke-test a non-shell page**

Run: `npm run dev` in one terminal, then in another:
```bash
curl -s http://localhost:4321/donate/ | grep -c '<header\|<footer'
```
Expected: at least 2 (header + footer present, since donate doesn't pass `chrome="shell"`).

- [ ] **Step 6: Commit**

```bash
git add src/layouts/BaseLayout.astro
git commit -m "feat: add chrome prop to BaseLayout (suppresses Header/Footer/main on shell routes)"
```

---

### Task 7: Replace BaseLayout FOUC inline script

**Files:**
- Modify: `src/layouts/BaseLayout.astro` (lines 167-179)

- [ ] **Step 1: Locate the existing FOUC block**

Run: `sed -n '167,179p' src/layouts/BaseLayout.astro`
Expected: prints the existing matchMedia auto-detect block.

- [ ] **Step 2: Replace it with the explicit-choice version**

Find:

```astro
  <script is:inline>
    // Apply saved theme before first paint to prevent flash
    (function() {
      var saved = localStorage.getItem('rrm_theme');
      if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
      } else {
        var initial = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', initial);
        localStorage.setItem('rrm_theme', initial);
      }
    })();
  </script>
```

Replace with:

```astro
  <script is:inline>
    // Apply saved theme before first paint. Read-only: no OS auto-detect, no write-back.
    // Existing users with a stored preference retain it. New cold visitors default to light.
    // localStorage access wrapped in try/catch — Safari Strict / Brave / Firefox TCP throw
    // on access; without the wrap, the FOUC script aborts and data-theme stays at the
    // hardcoded `<html data-theme="light">` for everyone (asymmetric with Tasks 9/12 which
    // both wrap). Wrapping keeps light as the safe default but stops the throw from leaking.
    (function() {
      var saved = null;
      try { saved = localStorage.getItem('rrm_theme'); } catch (e) {}
      var theme = saved === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
```

- [ ] **Step 3: Verify behavior on a fresh tab**

Run: `npm run dev` in one terminal. In a private window: navigate to http://localhost:4321/library/. Open DevTools → Application → Local Storage. Confirm `rrm_theme` is NOT set (cold visitor; FOUC no longer writes back).
Open DevTools → Elements. Confirm `<html data-theme="light">` regardless of OS preference.

- [ ] **Step 4: Verify existing dark users retain dark**

In DevTools console: `localStorage.setItem('rrm_theme', 'dark')`, then reload. Confirm `<html data-theme="dark">`.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/BaseLayout.astro
git commit -m "fix: BaseLayout FOUC reads localStorage only (no OS auto-detect, no write-back)"
```

---

### Task 8: Update guard-manifest.json for BaseLayout

**Files:**
- Modify: `guard-manifest.json` (BaseLayout.astro hash)

- [ ] **Step 1: Confirm BaseLayout is currently in guard manifest**

Run: `grep -c "BaseLayout.astro" guard-manifest.json`
Expected: BaseLayout MAY currently be 0 (verified empirically: `guard-manifest.json` has 0 hits for BaseLayout as of plan-write time). Per CLAUDE.md "Security Guard" section, the manifest is hand-maintained — `npm run guard:update` re-hashes existing entries but cannot ADD new ones. Step 2 below handles both the new-add case AND the rebake case.

- [ ] **Step 2a: Hand-add a BaseLayout.astro entry to guard-manifest.json (only if step 1 returned 0)**

If `grep -c "BaseLayout.astro" guard-manifest.json` returned 0, hand-edit `guard-manifest.json` to insert a placeholder entry (alphabetical order with the other `src/layouts/` entries if any, otherwise end of the files object):

```json
"src/layouts/BaseLayout.astro": {
  "hash": "PLACEHOLDER_WILL_BE_REPLACED_BY_GUARD_UPDATE",
  "note": "FOUC theme + chrome prop SEO invariants"
}
```

If `npm run guard:update` exposes an `--update-add <path>` flag (check `node scripts/guard.mjs --help`), prefer that over hand-editing. Hand-edit is the documented fallback.

If step 1 returned ≥1, skip step 2a entirely — the entry already exists and step 2b will rebake its hash.

- [ ] **Step 2b: Run guard:update to populate the real hash**

Run: `npm run guard:update`
Expected: replaces the placeholder hash on `BaseLayout.astro` with the real SHA, AND rebakes hashes for every other guarded file that changed during this PR (e.g. `SearchBar.astro` if Task 16 already committed). One rebake covers the whole manifest in a single pass.

- [ ] **Step 3: Verify guard passes AND BaseLayout is registered**

Run: `npm run guard`
Expected: exits 0. All guarded files match their manifest hashes.

Run: `grep -c "BaseLayout.astro" guard-manifest.json`
Expected: ≥1 (entry present and hashed).

- [ ] **Step 4: Commit**

```bash
git add guard-manifest.json
git commit -m "chore: register BaseLayout.astro in guard-manifest + rebake hashes"
```

---

### Task 8.5: Add `data-article-card` / `data-blog-card` + `data-slug` attributes (prerequisite for Task 10)

**Files:**
- Modify: `src/components/ArticleCard.astro`
- Modify: `src/components/BlogCard.astro`

The Task 10 writer queries `[data-article-card], [data-blog-card]` and reads `card.dataset.slug`. The Tasks 27 and 28 Playwright specs do the same. Today neither component emits these attributes (verified: `grep -c data-article-card src/components/ArticleCard.astro` returns 0). Without this task, the writer captures zero slugs and the shell's middle column / sheet are empty on every navigation.

- [ ] **Step 1: Add hooks to ArticleCard.astro**

Open `src/components/ArticleCard.astro`. Find the root `<article class="article-card">` element (around lines 53-94). Add three attributes:

```astro
<article class="article-card" data-article-card data-slug={article.slug} data-title={article.title}>
```

`data-title` is consumed by the Task 10 writer to populate `ctx.titles[]` so middle-column / sheet sibling links render the real article title (Task 11 + Task 14 hydration), not the slug-with-dashes-replaced placeholder. Do NOT change any other markup or CSS — only add the three attributes.

- [ ] **Step 2: Add hooks to BlogCard.astro**

Open `src/components/BlogCard.astro`. Find the root `<article>` element. Add:

```astro
<article class="blog-card" data-blog-card data-slug={post.slug} data-title={post.title}>
```

(Adjust the existing class list to whatever is already present — only add the three `data-*` attributes.)

- [ ] **Step 3: Verify**

```bash
grep -c 'data-article-card' src/components/ArticleCard.astro
grep -c 'data-blog-card' src/components/BlogCard.astro
grep -c 'data-slug=' src/components/ArticleCard.astro src/components/BlogCard.astro
grep -c 'data-title=' src/components/ArticleCard.astro src/components/BlogCard.astro
```
Expected: each ≥1.

- [ ] **Step 4: Build still passes**

Run: `npm run build 2>&1 | tail -10`
Expected: build succeeds; no Astro template errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ArticleCard.astro src/components/BlogCard.astro
git commit -m "feat: add data-article-card / data-blog-card + data-slug hooks (prereq for app shell writer)"
```

---

## Phase 3 — AppShellChrome behaviors (writer, validator, theme toggle)

> **Throughout Phases 3-5, run the dev server with PUBLIC_SHELL_ROUTES set:**
>
> ```bash
> PUBLIC_SHELL_ROUTES=commentary,library npm run dev
> ```
>
> Without this, AppShellChrome wraps nothing and the "Test in dev" steps in Tasks 9-16 cannot exercise shell behavior. Persist this env across terminal sessions for the duration of Phases 3-5. Note: Tasks 9-15 also require Tasks 20-26 (page wraps) to have committed first — the dev server can render shell only when at least one page is wrapped. Recommend completing Tasks 20-22 (commentary wraps) BEFORE running the Tasks 9-15 dev tests, OR running the dev tests after the full implementation is local-committed.

### Task 9: Add pre-paint inline script + getShellContext() helper

**Files:**
- Modify: `src/components/AppShellChrome.astro` (append `<script>` block at end)

- [ ] **Step 1: Append the pre-paint script and shape validator**

Append to `src/components/AppShellChrome.astro` (after the `<style>` block):

```astro
<script is:inline>
  // PRE-PAINT (must run before any layout): if no/invalid sessionStorage context,
  // add .shell-no-context to <html> to collapse middle column rail (spec §No-context CSS gate).
  (function() {
    // Slug cap is 250 chars; library data has slugs up to 230 chars (TRACER-A).
    // Build-time test in tests/unit/canonical-lockdown.test.mjs asserts the data
    // never exceeds this cap — keep the two in lockstep.
    var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,250}$/;
    var ALLOWED_SOURCES = { library: 1, commentary: 1, search: 1 };

    function isValidContext(c) {
      if (!c || typeof c !== 'object') return false;
      if (!ALLOWED_SOURCES[c.source]) return false;
      if (typeof c.label !== 'string' || c.label.length > 200) return false;
      if (typeof c.returnUrl !== 'string' || c.returnUrl.length > 500) return false;
      if (c.returnUrl[0] !== '/' || c.returnUrl[1] === '/') return false;
      if (c.returnUrl.indexOf('://') !== -1) return false;
      if (c.returnUrl.indexOf('javascript:') === 0 || c.returnUrl.indexOf('data:') === 0) return false;
      if (!Array.isArray(c.slugs) || c.slugs.length === 0 || c.slugs.length > 500) return false;
      // Filter (don't reject) bad entries: spec §Validator says "entries failing
      // the regex are dropped; if length drops to 0 after filtering, return null."
      var filtered = [];
      for (var i = 0; i < c.slugs.length; i++) {
        if (typeof c.slugs[i] === 'string' && SLUG_RE.test(c.slugs[i])) filtered.push(c.slugs[i]);
      }
      if (filtered.length === 0) return false;
      c.slugs = filtered; // mutate accepted shape
      if (typeof c.writtenAt !== 'number' || !isFinite(c.writtenAt) || c.writtenAt <= 0) return false;
      // Titles array (optional) — must parallel slugs[] when present. Tolerate
      // absence (legacy clients / writers that didn't capture titles), but
      // drop any malformed shape rather than partial-render with wrong indices.
      if (c.titles !== undefined) {
        if (!Array.isArray(c.titles) || c.titles.length !== c.slugs.length) {
          c.titles = [];
        } else {
          for (var t = 0; t < c.titles.length; t++) {
            if (typeof c.titles[t] !== 'string') c.titles[t] = '';
            if (c.titles[t].length > 300) c.titles[t] = c.titles[t].slice(0, 300);
          }
        }
      }
      // Filters: must be a plain object (not array, not null) AND every key/
      // value pair must be string-string. Spec line 178: "all keys and values
      // are strings. Reject nested objects, arrays, null values."
      if (c.filters) {
        if (typeof c.filters !== 'object' || Array.isArray(c.filters)) return false;
        for (var k in c.filters) {
          if (!Object.prototype.hasOwnProperty.call(c.filters, k)) continue;
          if (typeof k !== 'string' || typeof c.filters[k] !== 'string') return false;
        }
      }
      return true;
    }

    var ctx = null;
    try {
      var raw = sessionStorage.getItem('rrm-shell-context');
      if (raw) ctx = JSON.parse(raw);
    } catch (e) { ctx = null; }
    if (!isValidContext(ctx)) {
      document.documentElement.classList.add('shell-no-context');
    }

    // Expose helper for sheet + middle column to reuse.
    window.__rrmGetShellContext__ = function () {
      try {
        var raw = sessionStorage.getItem('rrm-shell-context');
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        return isValidContext(parsed) ? parsed : null;
      } catch (e) { return null; }
    };
  })();
</script>
```

- [ ] **Step 2: Test the pre-paint gate**

Run dev server. Navigate to a library article (after Task 24 wraps it). In DevTools: `document.documentElement.classList.contains('shell-no-context')` should be `true` on cold load.

In DevTools: `sessionStorage.setItem('rrm-shell-context', JSON.stringify({source:'library', label:'test', returnUrl:'/library/', slugs:['valid-slug-here'], writtenAt:Date.now()}))`. Reload. Now class should be `false`.

In DevTools: `sessionStorage.setItem('rrm-shell-context', JSON.stringify({label:'<script>alert(1)</script>'}))`. Reload. Class should be `true` (validator rejects malformed shape, treats as no-context).

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellChrome.astro
git commit -m "feat: add pre-paint context gate + getShellContext validator"
```

---

### Task 10: Add card-click writer (capture intent + pagehide commit)

**Files:**
- Modify: `src/components/AppShellChrome.astro` (extend the `<script>` block)

- [ ] **Step 1: Append writer logic conditional on context="index"**

(Note: requires Task 8.5 to have committed first; verify with `grep -c data-article-card src/components/ArticleCard.astro` returns ≥1. If 0, stop and complete Task 8.5 before proceeding.)

Inside the existing `<script is:inline>` block in AppShellChrome.astro, append:

```javascript
// Writer: only fires on index pages. Captures intent on card click;
// commits to sessionStorage on pagehide (Safari iOS race-safe).
if (document.documentElement.dataset.shellContext === 'index') {
  (function() {
    var pendingContext = null;

    function captureFromCards() {
      var cards = document.querySelectorAll('[data-article-card], [data-blog-card]');
      var slugs = [];
      var titles = [];
      cards.forEach(function (card) {
        var slug = card.dataset.slug;
        var title = card.dataset.title || '';
        if (slug && /^[a-z0-9][a-z0-9-]{0,250}$/.test(slug)) {
          slugs.push(slug);
          titles.push(title);
        }
      });
      return { slugs: slugs, titles: titles };
    }

    // Always overwrite stale context on every index DOMContentLoaded (spec §Storage write robustness).
    var captured = captureFromCards();
    var visibleSlugs = captured.slugs;
    var visibleTitles = captured.titles;
    if (visibleSlugs.length === 0) {
      // Empty filter / zero results: clear stale context.
      try { sessionStorage.removeItem('rrm-shell-context'); } catch (e) {}
    } else {
      var source = location.pathname.indexOf('/commentary') === 0 ? 'commentary' : 'library';
      var url = new URL(location.href);
      var filters = {};
      ['topic', 'q', 'sort'].forEach(function (k) {
        var v = url.searchParams.get(k);
        if (v && typeof v === 'string') filters[k] = v;
      });
      var label = (url.searchParams.get('topic') || 'All') + ' · ' + visibleSlugs.length + ' results';

      pendingContext = {
        source: source,
        label: label,
        slugs: visibleSlugs.slice(0, 500),
        titles: visibleTitles.slice(0, 500),
        returnUrl: url.pathname + url.search,
        filters: filters,
        writtenAt: Date.now()
      };
    }

    // Commit on pagehide (top-level navigation race-safe on Safari iOS).
    window.addEventListener('pagehide', function () {
      if (!pendingContext) return;
      try { sessionStorage.setItem('rrm-shell-context', JSON.stringify(pendingContext)); } catch (e) {}
    });

    // Bottom-nav and logo links clear context (best-effort, never blocks navigation).
    document.querySelectorAll('[data-clear-shell-context]').forEach(function (el) {
      el.addEventListener('pointerdown', function () {
        try { sessionStorage.removeItem('rrm-shell-context'); } catch (e) {}
      });
    });
  })();
}
```

- [ ] **Step 2: Set the data attribute on AppShellChrome's root**

In the AppShellChrome.astro template, change `<div class="app-shell-layout">` to `<div class="app-shell-layout" data-shell-context={context}>`.

(You also need to set `<html>` lookups — but the script reads `document.documentElement.dataset.shellContext` which won't be set unless we use `set:html` or a different approach. Simplest: read from the wrapper `<div>` instead.)

Actually update the script: change `if (document.documentElement.dataset.shellContext === 'index') {` to:

```javascript
var rootDiv = document.querySelector('.app-shell-layout[data-shell-context]');
if (rootDiv && rootDiv.dataset.shellContext === 'index') {
```

- [ ] **Step 3: Test in dev**

After Task 24 wraps commentary index: navigate to `/commentary/`. In DevTools console: `sessionStorage.getItem('rrm-shell-context')` should be `null` (writer fires on pagehide, not yet). Click a card. Article page loads. Now check storage: should have a populated context object with `slugs[]` ≥1.

Click bottom-nav "Commentary": context cleared.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShellChrome.astro
git commit -m "feat: add card-click context writer (captures intent, commits on pagehide)"
```

---

### Task 11: Render middle column from sessionStorage (article context only)

**Files:**
- Modify: `src/components/AppShellChrome.astro`

- [ ] **Step 1: Append middle-column hydration script**

Append to AppShellChrome's `<script is:inline>`:

```javascript
// Middle column hydration (article pages only, when sessionStorage has valid context).
(function() {
  var rootDiv = document.querySelector('.app-shell-layout[data-shell-context]');
  if (!rootDiv || rootDiv.dataset.shellContext !== 'article') return;

  var ctx = window.__rrmGetShellContext__ ? window.__rrmGetShellContext__() : null;
  if (!ctx) return;

  var aside = document.querySelector('.app-shell-middle-column');
  if (!aside) return;

  var heading = aside.querySelector('.app-shell-middle-column__heading');
  var list = aside.querySelector('.app-shell-middle-column__list');
  if (!heading || !list) return;

  // textContent only, never innerHTML (XSS guard per spec §Render rules).
  heading.textContent = ctx.label;

  var currentSlug = location.pathname.replace(/^\/(library|commentary)\//, '').replace(/\/$/, '');
  var basePath = ctx.source === 'commentary' ? '/commentary/' : '/library/';

  ctx.slugs.forEach(function (slug, i) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = basePath + slug + '/';
    // Prefer real title captured by the Task 10 writer (data-title on cards);
    // fall back to slug-replace only when the title is missing/empty.
    var label = (ctx.titles && ctx.titles[i]) || slug.replace(/-/g, ' ');
    a.textContent = label;
    if (slug === currentSlug) a.setAttribute('aria-current', 'page');
    li.appendChild(a);
    list.appendChild(li);
  });
})();
```

- [ ] **Step 2: Test**

After Task 25 wraps commentary article: navigate to `/commentary/` → click a card → article page loads → middle column shows sibling list with current article highlighted.

Direct-navigate to article URL (no sessionStorage): `.shell-no-context` class added → middle column hidden.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellChrome.astro
git commit -m "feat: hydrate middle column from sessionStorage on article pages"
```

---

### Task 12: Add shared theme toggle handler

**Files:**
- Modify: `src/components/AppShellChrome.astro`

- [ ] **Step 1: Append theme toggle IIFE to script block**

Append to AppShellChrome's `<script is:inline>`:

```javascript
// Theme toggle: shared handler so sidebar + drawer toggles operate identically.
window.__rrmThemeToggle__ = (function() {
  var lastClick = 0;
  return function() {
    var now = Date.now();
    if (now - lastClick < 200) return; // debounce
    lastClick = now;
    var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rrm_theme', next); } catch (e) {}
  };
})();

document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
  btn.addEventListener('click', window.__rrmThemeToggle__);
});
```

- [ ] **Step 2: Test**

Navigate to `/commentary/` (after Task 24). Click theme toggle in sidebar. `<html data-theme="dark">` should flip to light or vice versa. Reload: state persists.

Rapid double-click: only one transition (debounced).

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellChrome.astro
git commit -m "feat: shared __rrmThemeToggle__ handler with 200ms debounce"
```

---

### Task 13: Add hamburger drawer markup + open/close behavior

**Files:**
- Modify: `src/components/AppShellChrome.astro`

- [ ] **Step 1: Add drawer markup before `<main>`**

In AppShellChrome.astro, after the bottom nav `</nav>`, add:

```astro
  <!-- Mobile hamburger drawer (mirrors sidebar contents) -->
  <button type="button" class="app-shell-drawer-toggle" aria-controls="app-shell-drawer" aria-expanded="false" aria-label="Open menu">☰</button>
  <aside id="app-shell-drawer" class="app-shell-drawer" data-pagefind-ignore="all" aria-label="Mobile navigation">
    <button type="button" class="app-shell-drawer__close" aria-label="Close menu">×</button>
    <!-- duplicate sidebar nav contents here, OR factor into shared partial.
         All destination links carry data-clear-shell-context so the Task 10
         pointerdown listener clears stale context on drawer-driven navigation
         (parity with bottom-nav and brand-link). Donate is a parity-include
         even though it exits the shell — shared listener semantics. -->
    <div class="app-shell-nav__section">
      <div class="app-shell-nav__heading">Reading</div>
      <a href="/library/" class="app-shell-nav__link" data-clear-shell-context>Research Library</a>
      <a href="/commentary/" class="app-shell-nav__link" data-clear-shell-context>Commentary</a>
      <a href="/library/saved/" class="app-shell-nav__link" data-clear-shell-context>Saved Articles</a>
    </div>
    <div class="app-shell-nav__section">
      <div class="app-shell-nav__heading">Explore</div>
      <a href="/guides/" class="app-shell-nav__link" data-clear-shell-context>Guides</a>
      <a href="/faqs/" class="app-shell-nav__link" data-clear-shell-context>FAQs</a>
      <a href="/courses/" class="app-shell-nav__link" data-clear-shell-context>Courses</a>
      <a href="/community/" class="app-shell-nav__link" data-clear-shell-context>Community</a>
    </div>
    <a href="/donate/" class="app-shell-nav__cta" data-clear-shell-context>Donate</a>
    <a href="/account/" class="app-shell-nav__link" data-clear-shell-context>Account</a>
    <button type="button" class="app-shell-nav__theme-toggle" aria-label="Toggle theme" data-theme-toggle>
      <span class="icon-moon" aria-hidden="true">🌙</span>
      <span class="icon-sun" aria-hidden="true">☀️</span>
    </button>
  </aside>
  <div class="app-shell-drawer__overlay" aria-hidden="true"></div>
```

- [ ] **Step 2: Append drawer toggle script**

Append to script block:

```javascript
(function() {
  var toggle = document.querySelector('.app-shell-drawer-toggle');
  var drawer = document.getElementById('app-shell-drawer');
  var closeBtn = drawer && drawer.querySelector('.app-shell-drawer__close');
  var overlay = document.querySelector('.app-shell-drawer__overlay');
  if (!toggle || !drawer) return;

  function open() {
    drawer.dataset.open = 'true';
    toggle.setAttribute('aria-expanded', 'true');
  }
  function close() {
    drawer.dataset.open = 'false';
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (overlay) overlay.addEventListener('click', close);

  // ESC handler scoped to drawer-only. The sheet `<dialog>` closes natively
  // on ESC; if both fire on one keypress, you get focus loss + double state
  // change. Bail out when drawer isn't open OR when sheet is open (sheet
  // takes precedence). stopPropagation prevents downstream listeners from
  // also reacting to a drawer-handled ESC.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (drawer.dataset.open !== 'true') return;
    var sheetEl = document.getElementById('app-shell-sheet');
    if (sheetEl && sheetEl.open) return;
    close();
    e.stopPropagation();
  });

  // bfcache restore: iOS Safari (and other bfcache-enabled UAs) revives the
  // page DOM verbatim after back-nav. If drawer was open at navigation time,
  // it stays `data-open="true"` after restore — feels like a stuck UI. Force
  // closed on every bfcache hit. (e.persisted is true only for bfcache; cold
  // loads fall through unchanged.)
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) close();
  });
})();
```

- [ ] **Step 3: Test on mobile viewport**

Open dev tools → device toolbar → 375x812. Navigate to `/commentary/`. Tap hamburger → drawer slides in. Tap overlay → closes. Tap inside drawer link → navigates and resets.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShellChrome.astro
git commit -m "feat: hamburger drawer with open/close + overlay/ESC handlers"
```

---

## Phase 4 — AppShellSheet behaviors

### Task 14: Add feature-detect + sheet mount script

**Files:**
- Modify: `src/components/AppShellSheet.astro`

- [ ] **Step 1: Append script block**

Append to AppShellSheet.astro:

```astro
<script is:inline>
  // Wrapped in IIFE so feature-detect early `return` is legal and Task 15's
  // drag handlers (appended below) share the same `sheet` / `ctx` closure.
  (function () {
    // Defensive: very old browsers may not expose HTMLDialogElement at all.
    if (typeof HTMLDialogElement === 'undefined' || !('showModal' in HTMLDialogElement.prototype)) {
      document.documentElement.classList.add('shell-no-sheet');
      return; // Bare-minimum degradation: peek bar hidden, sheet does not mount.
    }

    var sheet = document.getElementById('app-shell-sheet');
    var peek = document.querySelector('.app-shell-sheet-peek');
    var ctx = window.__rrmGetShellContext__ ? window.__rrmGetShellContext__() : null;

    if (!ctx || !sheet || !peek) {
      if (peek) peek.hidden = true;
      return;
    }

    // Hydrate sheet contents from sessionStorage (textContent only).
    var title = sheet.querySelector('.app-shell-sheet__title');
    var list = sheet.querySelector('.app-shell-sheet__list');
    if (title) title.textContent = ctx.label;
    if (list) {
      var basePath = ctx.source === 'commentary' ? '/commentary/' : '/library/';
      var currentSlug = location.pathname.replace(/^\/(library|commentary)\//, '').replace(/\/$/, '');
      ctx.slugs.forEach(function (slug, i) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = basePath + slug + '/';
        // Prefer real title from ctx.titles[i] (Task 10 writer captures it
        // from card data-title); slug-replace is the fallback path only.
        var label = (ctx.titles && ctx.titles[i]) || slug.replace(/-/g, ' ');
        a.textContent = label;
        if (slug === currentSlug) a.setAttribute('aria-current', 'page');
        li.appendChild(a);
        list.appendChild(li);
      });
    }

    // Reveal peek bar; sheet starts hidden until peek-tap.
    peek.hidden = false;
    sheet.dataset.state = 'hidden';

    peek.addEventListener('click', function () {
      // showModal can throw InvalidStateError if dialog already open or detached.
      try {
        sheet.showModal();
      } catch (e) {
        return;
      }
      sheet.dataset.state = 'half';
      peek.setAttribute('aria-expanded', 'true');
    });

    var closeBtn = sheet.querySelector('.app-shell-sheet__close');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      sheet.dataset.state = 'peek';
      sheet.close();
      peek.setAttribute('aria-expanded', 'false');
    });

    // Resize listener: close sheet if entering desktop mode.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && sheet.open) {
        sheet.close();
        sheet.dataset.state = ctx ? 'peek' : 'hidden';
      }
    });

    // NOTE: Task 15 appends drag handlers below this comment, BEFORE the
    // closing `})();` that ends this IIFE. They share `sheet` and `ctx`.
  })();
</script>
```

- [ ] **Step 2: Test on mobile viewport**

After Task 25 wraps commentary article: open dev tools mobile viewport (375x812). Navigate to commentary index → click card → article. Peek bar appears at bottom. Tap peek → sheet opens to half. Close → sheet closes, peek visible. Resize to 1200px → sheet auto-closes.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellSheet.astro
git commit -m "feat: AppShellSheet feature-detect + mount + resize handler"
```

---

### Task 15: Add sheet drag handlers (peek/half/full)

**Files:**
- Modify: `src/components/AppShellSheet.astro`

- [ ] **Step 1: Append drag handler logic INSIDE Task 14's IIFE**

Append inside Task 14's `(function () { ... })();` block, after the resize listener and BEFORE the closing `})();`. The handlers share `sheet` and `ctx` from the IIFE closure. Do NOT add a new `<script is:inline>` tag — there is exactly one script block in this component.

```javascript
// Pointer drag handlers (grip-only — list scroll does NOT drag sheet).
var grip = sheet.querySelector('.app-shell-sheet__grip');
var startY = null;
var startState = null;
var savedScrollY = 0;

// Idempotent body-lock restore — only acts if the lock was applied. Used by both
// pointerup (when snapped to hidden) and pointercancel (iOS notification-center
// preempt). NEVER call without first checking position === 'fixed'; otherwise
// a stray pointercancel without a matching pointerdown would clobber unrelated
// inline styles.
function restoreScroll() {
  if (document.body.style.position !== 'fixed') return;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo({ top: savedScrollY, behavior: 'instant' });
}

if (grip) {
  grip.addEventListener('pointerdown', function (e) {
    if (!e.target.closest('.app-shell-sheet__grip')) return;
    startY = e.clientY;
    startState = sheet.dataset.state;
    // setPointerCapture throws if pointerId is invalid or element detached.
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* non-fatal */ }
    // Body scroll lock (rAF-gated for momentum-safety). Idempotent — if a
    // previous drag's restore was preempted (e.g. crash mid-pointermove), do
    // not re-apply on top of an already-locked body.
    requestAnimationFrame(function () {
      if (document.body.style.position === 'fixed') return;
      savedScrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = '-' + savedScrollY + 'px';
      document.body.style.width = '100%';
    });
  });

  grip.addEventListener('pointermove', function (e) {
    if (startY === null) return;
    var deltaY = e.clientY - startY;
    // First drag has no --current-y set; getPropertyValue returns ''. Fall back to 50.
    var raw = getComputedStyle(sheet).getPropertyValue('--current-y');
    var base = parseFloat(raw);
    if (!isFinite(base)) base = 50;
    var translatePct = Math.max(8, Math.min(100, base + (deltaY / window.innerHeight) * 100));
    sheet.style.setProperty('--current-y', translatePct);
  });

  grip.addEventListener('pointerup', function (e) {
    if (startY === null) return;
    var endY = e.clientY;
    var delta = endY - startY;
    // Snap to nearest state.
    var nextState;
    if (delta > 80) {
      nextState = startState === 'full' ? 'half' : startState === 'half' ? 'peek' : 'hidden';
    } else if (delta < -80) {
      nextState = startState === 'peek' ? 'half' : startState === 'half' ? 'full' : 'full';
    } else {
      nextState = startState;
    }
    sheet.dataset.state = nextState;
    sheet.style.removeProperty('--current-y');
    startY = null;
    if (nextState === 'hidden') {
      sheet.close();
      // Restore scroll via shared idempotent helper.
      restoreScroll();
    }
  });

  // iOS notification pull-down (and other system gestures) preempt mid-drag
  // with `pointercancel`, NOT `pointerup`. Without this handler, the body-lock
  // styles stay applied — subsequent drags compound the lock and the page
  // jumps when finally restored. Mirrors pointerup's restore branch.
  grip.addEventListener('pointercancel', function () {
    startY = null;
    sheet.style.removeProperty('--current-y');
    restoreScroll();
  });
}
```

- [ ] **Step 2: Test on mobile**

In mobile viewport: open sheet to half, drag grip up → snaps to full. Drag down → snaps to half → peek. Drag past peek → hidden, scroll restored.

Test on a real iPhone if possible (E2E spec covers this in Task 31).

- [ ] **Step 3: Commit**

```bash
git add src/components/AppShellSheet.astro
git commit -m "feat: sheet drag handlers with pointer capture + rAF-gated scroll lock"
```

---

## Phase 5 — SearchBar integration

### Task 16: Add sessionStorage write to SearchBar Pagefind result clicks

**Files:**
- Modify: `src/components/SearchBar.astro`

- [ ] **Step 1: Locate the existing search-result click handler**

Run: `grep -n "loadMore\|sr-item\|search-results" src/components/SearchBar.astro | head -10`
Expected: identifies where Pagefind results are rendered and bound.

- [ ] **Step 2: Add a click listener that writes context with source='search'**

Insert this code INSIDE SearchBar's main IIFE — the one that wraps the entire client script and contains `var currentQuery = '';` (around line 301; closing `})()` at line ~759). The pagehide commit listener is registered ONCE at the top of the IIFE, alongside other top-level vars. The pointerdown listener inside `renderResult()` only updates the shared `pendingSearchContext` closure variable — it does NOT register its own pagehide listener. (Mirrors the Task 10 writer pattern: register-once, mutate-pending. Per-pointerdown registration with `{ once: true }` leaks listeners across multi-pointerdown sessions because each fresh pointerdown adds another listener that only cleans itself up if pagehide fires.)

SearchBar's local variable for the rendered anchor is `a` (NOT `resultLink`); use `a.addEventListener(...)` when applying. Do NOT append the handler below `})()` — that scope cannot see `currentQuery` or `pendingSearchContext`.

Late-merged semantic results (the `semanticPromise.then` path around line 609 in SearchBar.astro) push entries with absolute `lr.url` values without `toRelative()` normalization. Use `new URL(href, location.origin)` to normalize relative AND absolute URLs uniformly — a regex anchored on `^/` would silently drop the absolute ones.

**Top of IIFE (alongside `var currentQuery = '';`):**

```javascript
// Shared mutable context written by per-result pointerdown handlers and
// committed once on pagehide. Single-listener pattern avoids the per-click
// listener leak that {once:true} would still produce when the user re-clicks
// without navigating (each click re-registers a listener; multi-click sessions
// stack them up before pagehide finally fires).
var pendingSearchContext = null;

window.addEventListener('pagehide', function () {
  if (!pendingSearchContext) return;
  try {
    sessionStorage.setItem('rrm-shell-context', JSON.stringify(pendingSearchContext));
  } catch (err) {}
});
```

**Inside `renderResult()` (per-link binding):**

```javascript
a.addEventListener('pointerdown', function (e) {
  // Capture all visible result slugs + titles into pendingSearchContext.
  // The URL parser handles relative AND absolute hrefs uniformly (semantic
  // late-merge results carry absolute URLs without toRelative() — a regex
  // anchored on `^/` would silently drop them).
  var allLinks = document.querySelectorAll(
    '#search-results a[href*="/library/"], #search-results a[href*="/commentary/"]'
  );
  var slugs = [];
  var titles = [];
  allLinks.forEach(function (link) {
    try {
      var u = new URL(link.getAttribute('href'), location.origin);
      var pm = u.pathname.match(/^\/(library|commentary)\/([a-z0-9][a-z0-9-]{0,250})\/?$/);
      if (!pm) return;
      slugs.push(pm[2]);
      // Look for `.sr-item__title` text inside the anchor (or its closest
      // result-item ancestor); fall back to '' so the validator's tolerant
      // titles[] handling renders slug-replace.
      var titleEl = link.querySelector('.sr-item__title') ||
                    (link.closest('.sr-item') && link.closest('.sr-item').querySelector('.sr-item__title'));
      titles.push(titleEl ? (titleEl.textContent || '').trim().slice(0, 300) : '');
    } catch (err) { /* malformed URL — skip */ }
  });
  if (slugs.length === 0) return;
  pendingSearchContext = {
    source: 'search',
    label: 'Search · "' + (currentQuery || '').slice(0, 80) + '" · ' + slugs.length + ' results',
    slugs: slugs.slice(0, 500),
    titles: titles.slice(0, 500),
    returnUrl: '/library/?q=' + encodeURIComponent(currentQuery || ''),
    filters: { q: currentQuery || '' },
    writtenAt: Date.now()
  };
});
```

`currentQuery` is the existing IIFE-scoped variable — the listener closes over it because it lives inside the same IIFE. No rename needed.

- [ ] **Step 3: guard:update for SearchBar**

Run: `npm run guard:update`
Expected: rebakes SearchBar's hash in guard-manifest.json.

Run: `npm run guard`
Expected: exits 0.

- [ ] **Step 4: Verify security invariants**

SearchBar is guarded for: `Access-Control-Allow-Origin`, no err.message leaks, no naked external fetches.
Run: `grep -n "Access-Control-Allow-Origin\|console.error\|fetch(" src/components/SearchBar.astro | head -10`
Expected: no new external fetches without try/catch; no `err.message` returned to user; CORS unchanged.

- [ ] **Step 5: Test**

Dev server. Navigate to `/library/`. Use search box. Click a result. Article page loads. Sheet/middle column shows search results context.

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchBar.astro guard-manifest.json
git commit -m "feat: SearchBar writes shell context with source='search' on result click"
```

---

## Phase 6 — CI gates

### Task 17: Create canonical-lockdown CI script

**Files:**
- Create: `scripts/check-canonical-lockdown.mjs`

- [ ] **Step 1: Create the script**

```javascript
#!/usr/bin/env node
// scripts/check-canonical-lockdown.mjs
// Enforces ALLOWED_PARAMS allowlist on /library/* and /commentary/* query params.
// Spec: §Routing and SEO / Canonical lockdown.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ALLOWED_PARAMS spans two categories. The gate fails if pages READ a param
// not in either set; analytics params don't affect canonical or content but
// must be tolerated because UTM tagging on inbound links is normal traffic.
const ALLOWED_PARAMS = new Set([
  // Canonical-affecting (drive content selection on /library and /commentary):
  'topic', 'page', 'q', 'sort',
  // Analytics-only (do NOT affect canonical or content; preserved for tracking):
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'gclid', 'fbclid', 'mc_cid', 'mc_eid'
]);
const SCAN_DIRS = ['src/pages/library', 'src/pages/commentary', 'src/components'];
const FORBIDDEN_PATTERNS = [
  /\?(view|shell|app|app_layout|application|layout|chrome|theme|density|mode)=/g
];

let failures = [];

function scanFile(path) {
  const raw = readFileSync(path, 'utf8');
  // Strip block comments and line comments before pattern scanning to avoid
  // false positives on documentation strings (e.g. `/* legacy: ?view=app */`
  // whose first line doesn't start with `//` or `*`).
  // Use `content` for pattern matching; keep `raw` for line-number reporting.
  const content = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')               // /* ... */
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');          // // ... line comments

  for (const pattern of FORBIDDEN_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const m of matches) {
      // Compute line number against the stripped content; report raw substring.
      const lineStart = content.lastIndexOf('\n', m.index);
      const lineEnd = content.indexOf('\n', m.index);
      const line = content.slice(lineStart + 1, lineEnd === -1 ? content.length : lineEnd);
      failures.push({ path, line: line.trim(), match: m[0] });
    }
  }
  // Also: check for any non-allowlisted query param read in pages.
  // Broader regex — matches both `searchParams.get(...)` and destructured
  // `params.get(...)`, allows whitespace, and accepts `[\w-]+` (alphanumeric +
  // underscore + hyphen) so we don't miss `utm_source`, `mc-id`, etc.
  const paramReads = content.matchAll(/(?:searchParams|params)\.get\(\s*['"]([\w-]+)['"]\s*\)/g);
  for (const m of paramReads) {
    const param = m[1];
    if (!ALLOWED_PARAMS.has(param.toLowerCase()) && (path.includes('/library/') || path.includes('/commentary/'))) {
      failures.push({ path, line: m[0], match: `non-allowlisted param: ${param}` });
    }
  }
}

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath);
    else if (/\.(astro|js|jsx|ts|tsx|mjs)$/.test(entry)) scanFile(fullPath);
  }
}

// Track scan health — silent dir-walk swallow lets a renamed/moved SCAN_DIR
// pass the gate vacuously. Warn on any missed dir; hard-fail if 0 walked.
let scanned = 0;
const skipped = [];
for (const dir of SCAN_DIRS) {
  try {
    walk(dir);
    scanned++;
  } catch (e) {
    skipped.push(`${dir}: ${e.code || e.message}`);
  }
}
if (skipped.length > 0) {
  console.warn(`⚠️ Canonical lockdown skipped ${skipped.length} dir(s): ${skipped.join('; ')}`);
}
if (scanned === 0) {
  console.error('❌ Canonical lockdown found no dirs to scan; check SCAN_DIRS config.');
  process.exit(1);
}

if (failures.length > 0) {
  console.error('❌ Canonical lockdown failed. Forbidden query params found:');
  failures.forEach(f => console.error(`  ${f.path}: ${f.match}\n    ${f.line}`));
  console.error(`\nALLOWED_PARAMS: ${[...ALLOWED_PARAMS].join(', ')}`);
  console.error('Add new params explicitly to ALLOWED_PARAMS and get reviewer sign-off.');
  process.exit(1);
}

console.log(`✅ Canonical lockdown: ${scanned}/${SCAN_DIRS.length} dirs scanned, no forbidden params.`);
process.exit(0);
```

- [ ] **Step 2: Make executable + test locally**

Run: `chmod +x scripts/check-canonical-lockdown.mjs && node scripts/check-canonical-lockdown.mjs`
Expected: exits 0 with success message (no forbidden params present in current code).

- [ ] **Step 3: Verify it catches violations**

Temporarily add `?view=app` to a comment in src/pages/library/index.astro (just to test). Run again.
Expected: exits 1, lists the violation.

Revert the test edit.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-canonical-lockdown.mjs
git commit -m "feat: add canonical-lockdown CI script with ALLOWED_PARAMS allowlist"
```

---

### Task 18: Wire canonical-lockdown into deploy.yml + add PUBLIC_SHELL_ROUTES env

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Locate the Security guard step**

Run: `grep -n "Security guard\|guard.mjs\|env:" .github/workflows/deploy.yml | head -20`
Expected: identifies the existing guard step + env block locations.

- [ ] **Step 2: Add new step + env var**

After the `Security guard` step in deploy.yml, add:

```yaml
      - name: Canonical lockdown
        run: node scripts/check-canonical-lockdown.mjs
```

In the build job's `env:` block, add:

```yaml
          PUBLIC_SHELL_ROUTES: ${{ vars.PUBLIC_SHELL_ROUTES || '' }}
```

(Default empty; setting via repo variable when ready to enable. The `PUBLIC_` prefix is required for Vite to expose the value to `import.meta.env` at build time.)

- [ ] **Step 3: Verify WORKFLOWS_PAT is wired in merge.yml's actions/checkout**

Per CLAUDE.md, WORKFLOWS_PAT lives in `.github/workflows/merge.yml`, not `deploy.yml`. The workflow-file edit (the `Canonical lockdown` step + new env var added in Step 2) is committed to the `claude/library-app-shell-2026-05-06` branch and lands on `main` via merge.yml's auto-FF pipeline (which carries the PAT). The engineer does NOT need to add WORKFLOWS_PAT to deploy.yml's checkout.

Run: `grep -A2 "actions/checkout" .github/workflows/merge.yml | grep -B1 "WORKFLOWS_PAT\|token:"`
Expected: merge.yml's checkout step has `token: ${{ secrets.WORKFLOWS_PAT }}`. If not, the auto-FF cannot push workflow changes — see CLAUDE.md for the WORKFLOWS_PAT setup pattern.

- [ ] **Step 4: Commit (will trigger CI; verify the new step appears)**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: wire canonical-lockdown step + PUBLIC_SHELL_ROUTES env var"
```

After push, check GitHub Actions UI: new "Canonical lockdown" step appears in deploy run. Step succeeds.

---

### Task 19: Add unit test for G-SEO-5 (canonical URLs no query params)

**Files:**
- Create: `tests/unit/canonical-lockdown.test.mjs`

- [ ] **Step 1: Create the test**

```javascript
// tests/unit/canonical-lockdown.test.mjs
// G-SEO-5: Canonical URL has no query params in shell-routed pages.
// G-SLUG-CAP: Slug length stays within the regex cap used by the shell
//             validator (Task 9), writer (Task 10), and SearchBar (Task 16).
// Run: node --test tests/unit/canonical-lockdown.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Keep in lockstep with SLUG_RE in:
//   - src/components/AppShellChrome.astro (validator + writer)
//   - src/components/SearchBar.astro       (search-result writer)
const SHELL_SLUG_CAP = 251; // [a-z0-9] + up to 250 chars = 251 max length

test('articles.json canonicals have no query params', () => {
  const data = JSON.parse(readFileSync('src/data/articles.json', 'utf8'));
  for (const a of data) {
    if (!a.slug) continue;
    assert.ok(!a.slug.includes('?'), `slug contains '?': ${a.slug}`);
    assert.ok(!a.slug.includes('&'), `slug contains '&': ${a.slug}`);
    assert.ok(!a.slug.includes('='), `slug contains '=': ${a.slug}`);
  }
});

test('posts.json canonicals have no query params', () => {
  const data = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
  for (const p of data) {
    if (!p.slug) continue;
    assert.ok(!p.slug.includes('?'), `slug contains '?': ${p.slug}`);
    assert.ok(!p.slug.includes('&'), `slug contains '&': ${p.slug}`);
    assert.ok(!p.slug.includes('='), `slug contains '=': ${p.slug}`);
  }
});

test('articles.json slug lengths fit shell SLUG_RE cap', () => {
  const data = JSON.parse(readFileSync('src/data/articles.json', 'utf8'));
  const lengths = data.map(a => (a.slug || '').length).filter(n => n > 0);
  const max = Math.max(...lengths);
  assert.ok(
    max <= SHELL_SLUG_CAP,
    `articles.json max slug length is ${max}, exceeds shell SLUG_RE cap ${SHELL_SLUG_CAP}. ` +
    `Raise the regex cap in AppShellChrome.astro + SearchBar.astro + this test in lockstep.`
  );
});

test('posts.json slug lengths fit shell SLUG_RE cap', () => {
  const data = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
  const lengths = data.map(p => (p.slug || '').length).filter(n => n > 0);
  if (lengths.length === 0) return;
  const max = Math.max(...lengths);
  assert.ok(
    max <= SHELL_SLUG_CAP,
    `posts.json max slug length is ${max}, exceeds shell SLUG_RE cap ${SHELL_SLUG_CAP}. ` +
    `Raise the regex cap in AppShellChrome.astro + SearchBar.astro + this test in lockstep.`
  );
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/unit/canonical-lockdown.test.mjs`
Expected: PASSES (slugs are clean).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/canonical-lockdown.test.mjs
git commit -m "test: G-SEO-5 unit test for canonical URL purity"
```

---

### Task 19.5: Add shared `isShellEnabled()` helper (prerequisite for Tasks 20-26)

**Files:**
- Create: `src/lib/shell-routes.ts`

Astro/Vite only expose env vars to `import.meta.env` when prefixed `PUBLIC_` (or via `vite.envPrefix`, which `astro.config.mjs` does NOT set). Reading `import.meta.env.SHELL_ROUTES` therefore always returns `undefined`, so the page-wrap tasks would silently never activate. Rename to `PUBLIC_SHELL_ROUTES` and factor the parsing into a shared helper to avoid drift across the 7 wrap sites.

- [ ] **Step 1: Create the helper**

```typescript
// src/lib/shell-routes.ts
//
// Reads PUBLIC_SHELL_ROUTES at build time and reports whether a route
// (commentary, library) is enabled in this build.
// Trim/lowercase tolerant — operator typos like "commentary, library" or
// "Library" don't silently disable the wrap.
export function isShellEnabled(route: 'commentary' | 'library'): boolean {
  const raw = (import.meta.env.PUBLIC_SHELL_ROUTES || '') as string;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(route);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx astro check 2>&1 | grep -i "shell-routes" | head`
Expected: no errors specific to this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shell-routes.ts
git commit -m "feat: add isShellEnabled() helper backed by PUBLIC_SHELL_ROUTES"
```

---

### Task 19.6: Wrap pattern reference (used by Tasks 20-26)

**Files:**
- (no edits — reference only)

Tasks 20-26 each modify exactly ONE existing page file. They all use the SAME wrap pattern, documented here once so the seven tasks don't drift. Critical rules:

1. **One `<BaseLayout>` call per page, not two.** Setting `chrome` conditionally avoids prop duplication and the `{...baseLayoutProps}` undefined crash (no existing page defines that const).
2. **Preserve every existing prop verbatim.** Read the target file first; identify the existing `<BaseLayout ...>` invocation; add the `chrome` prop only. Do NOT remove or rewrite `bodyClass`, `title`, `description`, `canonicalUrl`, `jsonLd`, `noindex`, or any other existing prop.
3. **Wrap the existing body in a ternary** so when the flag is off the body passes through unchanged.
4. **`<AppShellSheet />` only on article pages** (Tasks 21 and 25). It renders inside the BaseLayout slot, after the AppShellChrome wrapper.

The canonical pattern:

```astro
---
import AppShellChrome from '../../components/AppShellChrome.astro';
import AppShellSheet from '../../components/AppShellSheet.astro';
import { isShellEnabled } from '../../lib/shell-routes';

// 'commentary' for commentary pages, 'library' for library pages.
const SHELL_ENABLED = isShellEnabled('commentary');

// ... existing frontmatter unchanged (title, description, data fetches, etc.) ...
---

<BaseLayout
  chrome={SHELL_ENABLED ? 'shell' : 'default'}
  {/* every other existing prop preserved verbatim — bodyClass, title,
       description, canonicalUrl, jsonLd, noindex, etc. */}
>
  {SHELL_ENABLED ? (
    <AppShellChrome context="index" currentPath={Astro.url.pathname}>
      {/* existing page body unchanged */}
    </AppShellChrome>
  ) : (
    <Fragment>{/* existing page body unchanged */}</Fragment>
  )}
  {/* Article pages (Tasks 21, 25) ONLY: */}
  {SHELL_ENABLED && <AppShellSheet />}
</BaseLayout>
```

The `context` prop varies by task: `"index"` for index/page pages, `"article"` for slug pages, `"saved"` for `/library/saved/`. Tasks 20-26 all reference this pattern.

---

## Phase 7 — Commentary wrap (commit 1 of the 2-commit ship)

> **From here forward, all commits accumulate on a SINGLE `claude/library-app-shell-2026-05-06` branch (see memory: feedback-batch-arise-deploys.md). Push ONCE — at Task 31, after Task 30's local proof gates have passed. Tasks 32 and 33 happen on the live deploy, not on the branch. Do NOT push between Tasks 20-30.**

### Task 20: Wrap commentary/index.astro

**Files:**
- Modify: `src/pages/commentary/index.astro`

- [ ] **Step 1: Read the current file structure**

Run: `head -30 src/pages/commentary/index.astro`
Expected: identifies the BaseLayout import + frontmatter.

- [ ] **Step 2: Add imports + wrap content (gated by PUBLIC_SHELL_ROUTES via helper)**

Apply the canonical wrap pattern from Task 19.6. Read the target file first. Identify the existing `<BaseLayout ...>` invocation. Add `chrome={SHELL_ENABLED ? 'shell' : 'default'}` as a prop and wrap the EXISTING body in the ternary. Do NOT change any other prop on BaseLayout — preserve `bodyClass`, `title`, `description`, `canonicalUrl`, `jsonLd`, `noindex`, etc. exactly as they were. Do NOT introduce a `baseLayoutProps` spread (no existing page defines one).

Add to the frontmatter (alongside existing imports — do not remove any):

```typescript
import AppShellChrome from '../../components/AppShellChrome.astro';
import { isShellEnabled } from '../../lib/shell-routes';

const SHELL_ENABLED = isShellEnabled('commentary');
```

Then change the existing single `<BaseLayout ...>` invocation to:

```astro
<BaseLayout
  chrome={SHELL_ENABLED ? 'shell' : 'default'}
  {/* every existing prop preserved verbatim */}
>
  {SHELL_ENABLED ? (
    <AppShellChrome context="index" currentPath={Astro.url.pathname}>
      {/* existing page body unchanged */}
    </AppShellChrome>
  ) : (
    <Fragment>{/* existing page body unchanged */}</Fragment>
  )}
</BaseLayout>
```

(No `<AppShellSheet />` on this index page — sheet renders only on article pages.)

- [ ] **Step 3: Build and verify**

Run: `npm run build && grep -c "<header" dist/commentary/index.html`
Expected with PUBLIC_SHELL_ROUTES empty: ≥1 (Header still rendered, AppShellChrome wrapper inert).

Run: `PUBLIC_SHELL_ROUTES=commentary npm run build && grep -c "<header" dist/commentary/index.html`
Expected with PUBLIC_SHELL_ROUTES set: 0 (Header suppressed). And `grep -c 'class="app-shell-nav"' dist/commentary/index.html` returns ≥1.

- [ ] **Step 4: Commit (still local)**

```bash
git add src/pages/commentary/index.astro
git commit -m "feat: wrap /commentary/ in AppShellChrome (gated by PUBLIC_SHELL_ROUTES)"
```

---

### Task 21: Wrap commentary/[...slug].astro + AppShellSheet

**Files:**
- Modify: `src/pages/commentary/[...slug].astro`

- [ ] **Step 1: Apply the canonical wrap pattern from Task 19.6 with `context="article"` + `<AppShellSheet />`**

Read the target file. Identify the existing single `<BaseLayout ...>` invocation. Add `chrome={SHELL_ENABLED ? 'shell' : 'default'}`; preserve every other existing prop verbatim. No `baseLayoutProps` spread.

In frontmatter (alongside existing imports):

```typescript
import AppShellChrome from '../../components/AppShellChrome.astro';
import AppShellSheet from '../../components/AppShellSheet.astro';
import { isShellEnabled } from '../../lib/shell-routes';

const SHELL_ENABLED = isShellEnabled('commentary');
```

Change the existing `<BaseLayout ...>` invocation to:

```astro
<BaseLayout
  chrome={SHELL_ENABLED ? 'shell' : 'default'}
  {/* every existing prop preserved verbatim */}
>
  {SHELL_ENABLED ? (
    <AppShellChrome context="article" currentPath={Astro.url.pathname}>
      {/* existing article body unchanged */}
    </AppShellChrome>
  ) : (
    <Fragment>{/* existing article body unchanged */}</Fragment>
  )}
  {SHELL_ENABLED && <AppShellSheet />}
</BaseLayout>
```

- [ ] **Step 2: Build + verify**

Run: `PUBLIC_SHELL_ROUTES=commentary npm run build && grep -c 'app-shell-middle-column\|app-shell-sheet' dist/commentary/[any-existing-slug]/index.html`
Expected: ≥2 (middle column + sheet both present).

- [ ] **Step 3: Commit**

```bash
git add src/pages/commentary/[...slug].astro
git commit -m "feat: wrap /commentary/[slug]/ in AppShellChrome + AppShellSheet"
```

---

### Task 22: Wrap commentary/page/[page].astro

**Files:**
- Modify: `src/pages/commentary/page/[page].astro`

- [ ] **Step 1: Same wrap as Task 20 with context="index"**

Apply the canonical pattern from Task 19.6 with `context="index"` and `isShellEnabled('commentary')`. Path-depth note: this file is one directory deeper, so adjust import paths to `'../../../components/...'` and `'../../../lib/shell-routes'`.

- [ ] **Step 2: Build + verify**

Run: `PUBLIC_SHELL_ROUTES=commentary npm run build` and confirm pagination pages have shell.

- [ ] **Step 3: Commit**

```bash
git add src/pages/commentary/page/[page].astro
git commit -m "feat: wrap commentary pagination pages in AppShellChrome"
```

---

### Task 23: Run G-ARCH-2 + G-CHROME-1 + G-SEO-6 grep gates locally

**Files:**
- (no edits — verification only)

- [ ] **Step 1: G-ARCH-2 (only library/commentary wrap in AppShellChrome)**

Run: `grep -rl "AppShellChrome" src/pages/ | grep -v "/library/\|/commentary/"`
Expected: empty output (no other pages wrap).

- [ ] **Step 2: G-CHROME-1 (chrome prop usage)**

Run: `grep -r 'chrome="shell"' src/pages/commentary/ | wc -l`
Expected: ≥3 (commentary index + slug + page-N wrap).

- [ ] **Step 3: G-SEO-6 (middle column always present in static HTML for shell article pages)**

Run: `PUBLIC_SHELL_ROUTES=commentary npm run build && find dist/commentary -name "index.html" -path "*/[^p]*/index.html" | head -3 | xargs grep -l 'app-shell-middle-column' | wc -l`
Expected: ≥1.

- [ ] **Step 4: Commit (no edits, just confirms gates pass)**

(Skip — gates are verification only.)

---

## Phase 8 — Library wrap (commit 2 of the 2-commit ship)

### Task 24: Wrap library/index.astro

**Files:**
- Modify: `src/pages/library/index.astro`

- [ ] **Step 1: Apply same wrap pattern as Task 20 (canonical pattern in Task 19.6) with `isShellEnabled('library')`**

In frontmatter (alongside existing imports):

```typescript
import AppShellChrome from '../../components/AppShellChrome.astro';
import { isShellEnabled } from '../../lib/shell-routes';

const SHELL_ENABLED = isShellEnabled('library');
```

Change the existing `<BaseLayout ...>` invocation to add `chrome={SHELL_ENABLED ? 'shell' : 'default'}` and wrap the existing body in the ternary. Preserve every other existing prop verbatim. No `baseLayoutProps` spread.

- [ ] **Step 2: Build + verify**

Run: `PUBLIC_SHELL_ROUTES=library npm run build && grep -c 'app-shell-nav' dist/library/index.html`
Expected: ≥1.

- [ ] **Step 3: Commit**

```bash
git add src/pages/library/index.astro
git commit -m "feat: wrap /library/ in AppShellChrome"
```

---

### Task 25: Wrap library/[...slug].astro + AppShellSheet

**Files:**
- Modify: `src/pages/library/[...slug].astro`

- [ ] **Step 1: Apply same wrap as Task 21 (canonical pattern in Task 19.6) with `context="article"`, `<AppShellSheet />`, and `isShellEnabled('library')`**

In frontmatter (alongside existing imports):

```typescript
import AppShellChrome from '../../components/AppShellChrome.astro';
import AppShellSheet from '../../components/AppShellSheet.astro';
import { isShellEnabled } from '../../lib/shell-routes';

const SHELL_ENABLED = isShellEnabled('library');
```

Change the existing `<BaseLayout ...>` invocation to add `chrome={SHELL_ENABLED ? 'shell' : 'default'}`, wrap the existing article body in the ternary with `<AppShellChrome context="article" ...>`, and conditionally render `<AppShellSheet />` inside the BaseLayout slot. Preserve every other existing prop verbatim.

- [ ] **Step 2: Build + verify**

Run: `PUBLIC_SHELL_ROUTES=library npm run build && find dist/library -mindepth 2 -name "index.html" | head -1 | xargs grep -c "app-shell-sheet"`
Expected: ≥1 (sheet present on article pages).

- [ ] **Step 3: Commit**

```bash
git add 'src/pages/library/[...slug].astro'
git commit -m "feat: wrap /library/[slug]/ in AppShellChrome + AppShellSheet"
```

---

### Task 26: Wrap library/page/[page].astro and library/saved.astro

**Files:**
- Modify: `src/pages/library/page/[page].astro`, `src/pages/library/saved.astro`

- [ ] **Step 1: library/page/[page].astro — same canonical pattern as Task 22 with `isShellEnabled('library')`**

Path-depth note: this file is one directory deeper, so use `'../../../components/...'` and `'../../../lib/shell-routes'` in the imports.

- [ ] **Step 2: library/saved.astro — canonical pattern with `context="saved"` (no `<AppShellSheet />`)**

In frontmatter (alongside existing imports):

```typescript
import AppShellChrome from '../../components/AppShellChrome.astro';
import { isShellEnabled } from '../../lib/shell-routes';

const SHELL_ENABLED = isShellEnabled('library');
```

Change the existing `<BaseLayout ...>` invocation to:

```astro
<BaseLayout
  chrome={SHELL_ENABLED ? 'shell' : 'default'}
  {/* every existing prop preserved verbatim — including noindex */}
>
  {SHELL_ENABLED ? (
    <AppShellChrome context="saved" currentPath={Astro.url.pathname}>
      {/* existing saved-articles UI */}
    </AppShellChrome>
  ) : (
    <Fragment>{/* existing saved-articles UI */}</Fragment>
  )}
</BaseLayout>
```

- [ ] **Step 3: Verify noindex still emits**

Run: `PUBLIC_SHELL_ROUTES=library npm run build && grep "noindex" dist/library/saved/index.html`
Expected: `<meta name="robots" content="noindex, nofollow" />`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/library/page/[page].astro src/pages/library/saved.astro
git commit -m "feat: wrap /library/page/N/ + /library/saved/ in AppShellChrome"
```

---

## Phase 9 — E2E + verification

### Task 27: Playwright E2E desktop tests

**Files:**
- Create: `tests/e2e/app-shell.spec.ts`

- [ ] **Step 0: Pin baseURL to the local dev server**

The default `playwright.config.js` baseURL points to `https://rrmacademy.org` (production), where `PUBLIC_SHELL_ROUTES` is empty by design until Task 32 activates the shell. Without this pin, every shell-presence assertion (`.app-shell-nav` visible, etc.) fails because production has no shell yet.

The fix is a per-spec `test.use({ baseURL: 'http://localhost:4321' })` at the top of `app-shell.spec.ts`, applied to BOTH `test.describe()` blocks created in Step 1 and the additional describe blocks in Tasks 28 + 29. This is the surgically-scoped form — leaves `playwright.config.js` untouched so other specs continue to hit production.

(Optional CI follow-on: add `webServer: { command: 'PUBLIC_SHELL_ROUTES=commentary,library npm run dev', port: 4321, reuseExistingServer: !process.env.CI }` to `playwright.config.js` so CI auto-spawns the dev server. Out of scope for this PR — Brian's existing cadence is "run dev server manually, then test.")

- [ ] **Step 1: Create spec file**

```typescript
import { test, expect } from '@playwright/test';

// Pin baseURL to the local dev server. Default playwright.config.js baseURL
// points to production (https://rrmacademy.org) where PUBLIC_SHELL_ROUTES is
// empty until Task 32 activates the shell — every shell-presence assertion
// would fail there. Apply test.use({ baseURL: ... }) inside EVERY describe
// block in this file (incl. the ones added in Tasks 28 + 29).
const LOCAL_BASE_URL = 'http://localhost:4321';

const SHELL_ROUTES = process.env.PUBLIC_SHELL_ROUTES || 'commentary,library';

test.describe('App shell — desktop (1440x900)', () => {
  test.use({ baseURL: LOCAL_BASE_URL, viewport: { width: 1440, height: 900 } });

  test('library index has sidebar, no middle column on cold land', async ({ page }) => {
    await page.goto('/library/');
    await expect(page.locator('.app-shell-nav')).toBeVisible();
    await expect(page.locator('.app-shell-middle-column')).not.toBeVisible();
  });

  test('clicking article card writes context, article page shows middle column', async ({ page }) => {
    await page.goto('/library/');
    const firstCard = page.locator('[data-article-card]').first();
    const slug = await firstCard.getAttribute('data-slug');
    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(`/library/${slug}/`));
    await expect(page.locator('.app-shell-middle-column')).toBeVisible();
    await expect(page.locator(`.app-shell-middle-column a[href="/library/${slug}/"][aria-current="page"]`)).toBeVisible();
  });

  test('theme toggle persists across reload', async ({ page }) => {
    await page.goto('/library/');
    await page.click('[data-theme-toggle]');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.reload();
    const themeAfter = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(themeAfter).toBe(theme);
  });

  test('bottom-nav click clears sessionStorage', async ({ page }) => {
    await page.goto('/library/');
    await page.locator('[data-article-card]').first().click();
    // Bottom nav not visible on desktop — emulate via sidebar logo click clearing context
    await page.click('.app-shell-nav__brand');
    const ctx = await page.evaluate(() => sessionStorage.getItem('rrm-shell-context'));
    expect(ctx).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests against the local dev server**

In one terminal, start the dev server with the shell flag enabled:
```bash
PUBLIC_SHELL_ROUTES=commentary,library npm run dev
```
(Astro's dev server reads `PUBLIC_*` env vars and exposes them on `import.meta.env` for the helper from Task 19.5. Confirm the server is listening on `http://localhost:4321/` before running tests.)

In a second terminal:
```bash
npx playwright test tests/e2e/app-shell.spec.ts
```
Expected: all 4 tests pass against `http://localhost:4321` (pinned in Step 0).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app-shell.spec.ts
git commit -m "test: Playwright E2E for desktop shell behaviors"
```

---

### Task 28: Playwright E2E mobile tests

**Files:**
- Modify: `tests/e2e/app-shell.spec.ts`

- [ ] **Step 1: Append mobile test block**

```typescript
test.describe('App shell — mobile (375x812)', () => {
  test.use({ baseURL: LOCAL_BASE_URL, viewport: { width: 375, height: 812 } });

  test('mobile bottom nav visible, sidebar hidden', async ({ page }) => {
    await page.goto('/library/');
    await expect(page.locator('.app-shell-bottom-nav')).toBeVisible();
    await expect(page.locator('.app-shell-nav')).not.toBeVisible();
  });

  test('hamburger drawer opens and closes', async ({ page }) => {
    await page.goto('/library/');
    await page.click('.app-shell-drawer-toggle');
    await expect(page.locator('#app-shell-drawer')).toHaveAttribute('data-open', 'true');
    await page.click('.app-shell-drawer__overlay');
    await expect(page.locator('#app-shell-drawer')).toHaveAttribute('data-open', 'false');
  });

  test('peek bar appears after card click; sheet opens to half on tap', async ({ page }) => {
    await page.goto('/library/');
    await page.locator('[data-article-card]').first().click();
    await expect(page.locator('.app-shell-sheet-peek')).toBeVisible();
    await page.click('.app-shell-sheet-peek');
    await expect(page.locator('.app-shell-sheet')).toHaveAttribute('data-state', 'half');
  });

  test('bottom-nav Library tab clears context and returns to /library/', async ({ page }) => {
    await page.goto('/library/');
    await page.locator('[data-article-card]').first().click();
    await page.click('.app-shell-bottom-nav__tab[href="/library/"]');
    await expect(page).toHaveURL(/\/library\/?$/);
    const ctx = await page.evaluate(() => sessionStorage.getItem('rrm-shell-context'));
    expect(ctx).toBeNull();
  });
});
```

- [ ] **Step 2: Run mobile tests**

Run: `npx playwright test tests/e2e/app-shell.spec.ts`
Expected: all mobile tests pass alongside desktop.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app-shell.spec.ts
git commit -m "test: Playwright E2E for mobile shell behaviors"
```

---

### Task 29: Cold-land + no-JS + adversarial tests

**Files:**
- Modify: `tests/e2e/app-shell.spec.ts`

- [ ] **Step 1: Append**

```typescript
test.describe('App shell — cold landing + adversarial', () => {
  test.use({ baseURL: LOCAL_BASE_URL });

  test('cold landing on article = full-width (no middle column visible)', async ({ page }) => {
    // Direct navigate, no sessionStorage.
    await page.goto('/library/redwine-excision-2012/'); // adjust slug
    await expect(page.locator('html')).toHaveClass(/shell-no-context/);
    await expect(page.locator('.app-shell-middle-column')).not.toBeVisible();
  });

  test('malformed sessionStorage rejected silently (no XSS)', async ({ page }) => {
    await page.goto('/library/');
    await page.evaluate(() => {
      sessionStorage.setItem('rrm-shell-context', JSON.stringify({
        source: 'library',
        label: '<img src=x onerror=alert(1)>',
        slugs: ['<script>alert(1)</script>'],
        returnUrl: 'javascript:alert(1)',
        writtenAt: 1
      }));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/shell-no-context/);
    // Confirm no alerts fired (would have crashed the test if so).
  });

  test('storage SecurityError degrades gracefully', async ({ page, context }) => {
    // Block storage by intercepting; not all browsers support this. Skip if not.
    await page.goto('/library/');
    await page.evaluate(() => {
      // Override sessionStorage methods to throw.
      Object.defineProperty(window, 'sessionStorage', {
        get() { throw new DOMException('SecurityError', 'SecurityError'); }
      });
    });
    await page.reload();
    // Page should still render; .shell-no-context present.
    await expect(page.locator('html')).toHaveClass(/shell-no-context/);
  });
});

test.describe('App shell — no-JS fallback', () => {
  test.use({ baseURL: LOCAL_BASE_URL, javaScriptEnabled: false });

  test('sidebar renders without JS, theme toggle inert', async ({ page }) => {
    await page.goto('/library/');
    await expect(page.locator('.app-shell-nav')).toBeVisible();
    // Sheet absent (no JS to mount it).
    await expect(page.locator('.app-shell-sheet')).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx playwright test tests/e2e/app-shell.spec.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/app-shell.spec.ts
git commit -m "test: cold-land, adversarial, and no-JS shell E2E"
```

---

### Task 30: Run all proof gates locally before push

**Files:**
- (verification only)

- [ ] **Step 1: G-SEO-1 + G-GUARD (BaseLayout hash)**
Run: `npm run guard`
Expected: 0.

- [ ] **Step 2: G-SEO-2 (data-pagefind-ignore on chrome roots)**
Run: `grep -c 'data-pagefind-ignore="all"' src/components/AppShellChrome.astro src/components/AppShellSheet.astro`
Expected: ≥3 (sidebar, middle column, sheet).

- [ ] **Step 3: G-SEO-3 (canonical lockdown)**
Run: `node scripts/check-canonical-lockdown.mjs`
Expected: 0.

- [ ] **Step 4: G-SEO-4 (saved.astro noindex emits)**
Run: `PUBLIC_SHELL_ROUTES=library npm run build && grep -c 'noindex, nofollow' dist/library/saved/index.html`
Expected: 1 (exactly once, no duplicates).

- [ ] **Step 5: G-SEO-5 (canonical purity)**
Run: `node --test tests/unit/canonical-lockdown.test.mjs`
Expected: PASS.

- [ ] **Step 6: G-SEO-6 (middle column always-emitted on ARTICLE pages only)**
Run:
```bash
find dist/library dist/commentary -mindepth 2 -name 'index.html' \
  | grep -v '/page/\|/saved/' \
  | xargs grep -L 'app-shell-middle-column' \
  | head
```
Expected: empty (every shell ARTICLE page has the aside). Pagination pages (`/page/N/`) and `/library/saved/` legitimately do NOT emit the middle column — they use `context="index"` or `context="saved"`, not `"article"` — so they must be filtered out before the `grep -L` check or the gate fails on its first run.

- [ ] **Step 7: G-CHROME-1 (chrome prop usage)**
Run: `grep -rE 'chrome="(default|shell)"' src/pages/{library,commentary} | wc -l`
Expected: ≥7 (3 commentary + 4 library wrapped pages).

- [ ] **Step 8: G-ARCH-1 (no /app/ prefix)**
Run: `find src/pages/app -type f 2>/dev/null | wc -l`
Expected: 0.

- [ ] **Step 9: G-ARCH-2 (only library/commentary wrap)**
Run: `grep -rl 'AppShellChrome' src/pages/ | grep -v '/library/\|/commentary/' | wc -l`
Expected: 0.

- [ ] **Step 10: G-Z-STACK (no raw z-index in app-shell CSS)**
Run: `grep -E 'z-index:\s*[0-9]+' src/styles/app-shell.css src/components/AppShell*.astro`
Expected: empty (only `var(--z-*)` references).

- [ ] **Step 11: Commit (no edits — gate verification record)**

(Skip — gates are verification only. If any gate failed, fix and re-test before pushing.)

---

### Task 30.5: Visual regression snapshots (light + dark, desktop + mobile)

Spec §Testing strategy Layer 4 requires screenshots. Tasks 27-29 cover behavior; Task 33 production verification has no screenshot step. This task captures baseline PNGs across the four highest-value fixtures × two themes, committed alongside the spec. The PR description should attach these screenshots as the visual proof for spec §Testing strategy Layer 4.

**Files:**
- Create: `tests/e2e/app-shell-visual.spec.ts`

- [ ] **Step 1: Create the visual spec**

```typescript
// tests/e2e/app-shell-visual.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const articles = JSON.parse(readFileSync('./src/data/articles.json', 'utf8'));
const FIRST_ARTICLE_SLUG: string = articles[0].slug;

test.describe('App shell — visual regression', () => {
  const fixtures = [
    { name: 'library-index',    url: '/library/',                                       vp: { width: 1440, height: 900 } },
    { name: 'library-article',  url: `/library/${FIRST_ARTICLE_SLUG}/`,                 vp: { width: 1440, height: 900 } },
    { name: 'commentary-index', url: '/commentary/',                                    vp: { width: 1440, height: 900 } },
    { name: 'library-mobile',   url: '/library/',                                       vp: { width: 375, height: 812 } },
  ];
  for (const f of fixtures) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${f.name}-${theme}`, async ({ page }) => {
        await page.setViewportSize(f.vp);
        await page.goto(f.url);
        await page.evaluate((t) => {
          localStorage.setItem('rrm_theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, theme);
        await page.waitForTimeout(200);
        await expect(page).toHaveScreenshot(`${f.name}-${theme}.png`, {
          fullPage: false,
          animations: 'disabled',
        });
      });
    }
  }
});
```

`FIRST_ARTICLE_SLUG` is read from `src/data/articles.json` at test-load time. If the data file changes such that index 0 swaps, the screenshot diff will catch it on the next run; re-baseline only when the swap is intentional.

- [ ] **Step 2: Generate baselines**

Run: `PUBLIC_SHELL_ROUTES=commentary,library npx playwright test tests/e2e/app-shell-visual.spec.ts --update-snapshots`
Expected: baseline PNGs written to `tests/e2e/app-shell-visual.spec.ts-snapshots/`.

- [ ] **Step 3: Verify**

Run: `PUBLIC_SHELL_ROUTES=commentary,library npx playwright test tests/e2e/app-shell-visual.spec.ts` (without `--update-snapshots`).
Expected: all 8 tests pass against the baselines just created.

- [ ] **Step 4: Commit baselines**

```bash
git add tests/e2e/app-shell-visual.spec.ts tests/e2e/app-shell-visual.spec.ts-snapshots/
git commit -m "test: visual regression baselines for app shell (light + dark, desktop + mobile)"
```

The PR description should attach these screenshots as the visual proof for spec §Testing strategy Layer 4.

---

### Task 31: Push the branch and let CI run

**Files:**
- (no edits — push only)

- [ ] **Step 1: Final local commit summary**
Run: `git log --oneline ...origin/main | wc -l`
Expected: 26-32 commits (Phase 1 through Phase 9).

- [ ] **Step 2: Push**
Run: `git push -u origin claude/library-app-shell-2026-05-06`
Expected: branch created on remote; auto-merge workflow takes over.

- [ ] **Step 3: Watch CI**
Run: `gh run list --branch claude/library-app-shell-2026-05-06 --limit 3`
Expected: Build & Deploy + Merge Claude Branches both eventually succeed.

If a CI step fails: fix forward locally, commit, push again. Do NOT split into multiple branches.

---

### Task 31.5: Wait for auto-merge + deploy to complete (race-guard for Task 32)

**Files:**
- (verification only)

`merge.yml` auto-fast-forwards `main` to the `claude/*` branch within ~3-7 minutes. Then `deploy.yml` runs on `main`. Task 32 Step 1+2 (`gh variable set ... && gh workflow run deploy.yml`) can fire BEFORE the auto-merge has landed `AppShellChrome.astro` on main, building an inert deploy. This task is a hard barrier: confirm main has the commit AND the post-merge deploy has succeeded before proceeding.

- [ ] **Step 1: Capture branch SHA**

Run: `git rev-parse claude/library-app-shell-2026-05-06`
Save the value (e.g. as `BRANCH_SHA=$(git rev-parse claude/library-app-shell-2026-05-06)`).

- [ ] **Step 2: Wait for the AppShellChrome commit to land on main**

```bash
git fetch origin main
git log origin/main --oneline -5
```
Expected: the AppShellChrome / Phase-9 commits from the branch appear in origin/main's recent history. If not, re-run `git fetch origin main` every 60s until they do (auto-merge takes ~3-7 min).

- [ ] **Step 3: Wait for deploy.yml on main to complete with success**

```bash
gh run list --workflow=deploy.yml --branch=main --limit=1
```
Expected: most recent run shows `status: completed` AND `conclusion: success` AND its head SHA matches `$BRANCH_SHA` (or a later main commit that includes it). Re-run every ~60s until satisfied.

A faster check using `--json`:
```bash
gh run list --workflow=deploy.yml --branch=main --limit=1 --json status,conclusion,headSha
```

- [ ] **Step 4: Sanity-check the inert deploy**

`PUBLIC_SHELL_ROUTES` is still empty at this point (the var is set in Task 32). The deploy that just succeeded is the one that put `AppShellChrome.astro` into the dist bundle but did NOT activate it. Confirm:

```bash
curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
  -H 'Cache-Control: no-cache' \
  "https://rrmacademy.org/commentary/?_t=$(date +%s)" | grep -c 'app-shell-nav'
```
Expected: 0 (shell wraps nothing because the env var is empty).

Only after Steps 1-4 are all satisfied may Task 32 proceed.

---

## Phase 10 — Production smoke + activation

### Task 32: Set PUBLIC_SHELL_ROUTES repo variable to enable shell

**Files:**
- (GitHub repo settings — not a file edit)

- [ ] **Step 1: Set repo variable to commentary first (soak test)**
Run: `gh variable set PUBLIC_SHELL_ROUTES --body "commentary"`
Expected: variable set on rrmadmin/rrm-academy-cf.

- [ ] **Step 2: Trigger redeploy**
Run: `gh workflow run deploy.yml`
Expected: deploy with PUBLIC_SHELL_ROUTES=commentary. After ~3 min, shell is live on `/commentary/*` only; `/library/*` still uses Header.

- [ ] **Step 3: Smoke test commentary in production**

All production curl smokes use `--fail --max-time --retry` to avoid false pass/fail on transient CF 502s and stale-cache hits. The `?_t=...` cache-buster + `Cache-Control: no-cache` header force a fresh edge fetch.

```bash
curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
  -H 'Cache-Control: no-cache' \
  "https://rrmacademy.org/commentary/?_t=$(date +%s)" | grep -c 'app-shell-nav'
```
Expected: ≥1.

```bash
curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
  -H 'Cache-Control: no-cache' \
  "https://rrmacademy.org/library/?_t=$(date +%s)" | grep -c 'app-shell-nav'
```
Expected: 0 (library not yet enabled).

- [ ] **Step 4: Wait 24h soak. Monitor with periodic automated checks:**

Manual review surfaces (run at T+1h, T+6h, T+12h, T+24h):
- GA4 bounce rate on /commentary/* — should be flat or improved
- GSC URL inspection on a sample commentary post — confirm rendered HTML has shell + canonical unchanged
- Sentry / cloudflare logs — no spike in 4xx/5xx

Automated check (run at the same cadence; log results to `~/iCode/.soak-tests/2026-05-06-commentary-shell.log`):

```bash
mkdir -p ~/iCode/.soak-tests
LOG=~/iCode/.soak-tests/2026-05-06-commentary-shell.log
{
  echo "=== $(date -u +%FT%TZ) ==="
  /ai-surface-check 2>&1 || true   # if Brian's existing skill is available
  curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
    -I "https://rrmacademy.org/commentary/?_t=$(date +%s)" | head -1
  curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
    -H 'Cache-Control: no-cache' \
    "https://rrmacademy.org/commentary/?_t=$(date +%s)" | grep -c 'app-shell-nav'
  gh run list --workflow=ai-search-refresh.yml --branch=main --limit 3
} | tee -a "$LOG"
```

If Brian wants set-and-forget monitoring, wrap the block above in a `for i in 1 6 12 24; do sleep ${i}h; ...; done` loop or schedule via CronCreate / `/loop`. Any 4xx/5xx, missing `app-shell-nav` shell-wrapped pages, or refresh-workflow failure is a soak-failure signal — investigate before proceeding to library activation.

- [ ] **Step 5: After 24h, enable library**
Run: `gh variable set PUBLIC_SHELL_ROUTES --body "commentary,library"`
Run: `gh workflow run deploy.yml`

- [ ] **Step 6: Smoke library**
```bash
curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
  -H 'Cache-Control: no-cache' \
  "https://rrmacademy.org/library/?_t=$(date +%s)" | grep -c 'app-shell-nav'
curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 2 \
  -H 'Cache-Control: no-cache' \
  "https://rrmacademy.org/library/redwine-excision-2012/?_t=$(date +%s)" | grep -c 'app-shell-middle-column'
```
Expected: both ≥1.

---

### Task 33: Final production verification

**Files:**
- (verification only)

- [ ] **Step 1: Pagefind index unchanged**
Run: `curl -s https://rrmacademy.org/_pagefind/pagefind.js | wc -c` and compare to pre-deploy size. Expected: same order of magnitude (no large delta — sidebar text is data-pagefind-ignore'd).

- [ ] **Step 2: Vectorize unchanged**
No re-embed needed (source data unchanged). Skip Vectorize check.

- [ ] **Step 3: GSC URL Inspection on representative pages**
Use Search Console UI on:
- `/library/`
- `/library/redwine-excision-2012/` (or any other article)
- `/commentary/`
- `/commentary/[any post]/`

Confirm: rendered HTML shows shell + `<head>` meta unchanged + canonical preserved.

- [ ] **Step 4: Rich Results Test on a library article and a commentary post**
- https://search.google.com/test/rich-results
- Expected: MedicalScholarlyArticle (library) and BlogPosting (commentary) validate as before.

- [ ] **Step 5: Pagefind live query**
On https://rrmacademy.org/library/, search for a known phrase. Top result should be the expected article. Sidebar text must NOT appear in any result snippet.

- [ ] **Step 6: AI surface check**
Run the existing `/ai-surface-check` skill against rrmacademy.org. All 13 surfaces should still resolve.

- [ ] **Step 7: Final tag**
```bash
git tag -a "library-app-shell-v1" -m "Library + commentary app shell live in production"
git push origin "library-app-shell-v1"
```

---

## Rollback procedure (if something breaks in production)

Set `PUBLIC_SHELL_ROUTES` repo variable to empty:
```bash
gh variable set PUBLIC_SHELL_ROUTES --body ""
gh workflow run deploy.yml
```
Result: AppShellChrome wraps NOTHING. Site reverts to pre-shell behavior in ~3 min. Code stays in main; only the env var changes. No revert PR needed.

For deeper rollback (revert the BaseLayout `chrome` prop):
```bash
git revert <commit-hash-of-BaseLayout-edit>
git push
```
Auto-FF + deploy in ~20 min.

---

## Out of scope (future work)

Per spec §Out of scope: theme expansion to non-shell pages, pillar guides adopt the shell, courses adopt the shell, FAQs adopt the shell, full theme audit, related articles block, sheet virtualization (>500 entries), saved-article sync across devices.
