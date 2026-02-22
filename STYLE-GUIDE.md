# RRM Academy — Style Guide

> Canonical reference for `rrmacademy.org`. Every pattern documented here is live in production.
> Last updated: 2026-02-22.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Borders & Radii](#borders--radii)
6. [Shadows](#shadows)
7. [E-Ink Filter & Grain](#e-ink-filter--grain)
8. [Buttons](#buttons)
9. [Links](#links)
10. [Forms](#forms)
11. [Cards](#cards)
12. [Badges & Pills](#badges--pills)
13. [FAQ Accordion](#faq-accordion)
14. [Citations](#citations)
15. [Pagination](#pagination)
16. [Stats Row](#stats-row)
17. [Blockquotes](#blockquotes)
18. [Prose & Legal](#prose--legal)
19. [Page Layout Patterns](#page-layout-patterns)
20. [Header](#header)
21. [Footer](#footer)
22. [Dark Mode](#dark-mode)
23. [Responsive Breakpoints](#responsive-breakpoints)
24. [Accessibility](#accessibility)
25. [Transitions & Animation](#transitions--animation)
26. [Component Inventory](#component-inventory)
27. [Page Inventory](#page-inventory)

---

## Design Philosophy

The site uses an **e-ink paper aesthetic** — muted saturation, paper-grain texture, warm neutrals, and high-contrast typography. The goal is a distraction-free reading environment that communicates clinical seriousness without sterility.

**Core principles:**
- **Readability first.** Long-form scientific content demands generous line-height, constrained line-length, and clear typographic hierarchy.
- **Purple as authority.** The brand purple (`#725e7e`) is used sparingly — accent links, buttons, and interactive states. It never competes with content.
- **Paper, not screen.** The body filter desaturates and adds sepia warmth. An SVG grain texture completes the tactile illusion.
- **Couple-centered language.** Content addresses women and couples, never patients in isolation.

---

## Color System

All colors are defined as CSS custom properties on `:root` and redefined under `[data-theme="dark"]`. Every component uses semantic aliases, never raw hex values.

### Light Theme (default)

#### Purple Palette (brand)

| Token | Hex | Usage |
|-------|-----|-------|
| `--purple-900` | `#4c3e54` | Hover states, darkest accent |
| `--purple-700` | `#725e7e` | **Primary accent** — buttons, links, active states |
| `--purple-500` | `#987da8` | Medium accent |
| `--purple-300` | `#c9b8d3` | Letter-line border, light accent |
| `--purple-200` | `#d5c6de` | Subtle backgrounds |
| `--purple-100` | `#e8ddef` | Pale tints |
| `--purple-50`  | `#f5f0f8` | Palest tint |

#### Neutral Palette (text & UI)

| Token | Hex | Usage |
|-------|-----|-------|
| `--neutral-900` | `#313131` | Body text, headings |
| `--neutral-700` | `#636261` | Secondary text |
| `--neutral-600` | `#7b7a78` | Mid-tone labels |
| `--neutral-500` | `#949392` | Tertiary text, meta |
| `--neutral-400` | `#adaba9` | Muted text, placeholders |
| `--neutral-300` | `#c6c4c2` | Input borders |
| `--neutral-200` | `#dddbd8` | Card borders, dividers |
| `--neutral-100` | `#f7f5f3` | Page background |
| `--cream`       | `#eee5dd` | Warm tint |
| `--white`       | `#ffffff` | Card/surface background |

#### Accent

| Token | Hex | Usage |
|-------|-----|-------|
| `--green-700` | `#2e7d32` | Open Access badge text |
| `--green-100` | `#e8f5e9` | Open Access badge background |

#### Semantic Aliases

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg-body` | `#f7f5f3` | Page background |
| `--bg-surface` | `#ffffff` | Cards, inputs, elevated surfaces |
| `--bg-header` | `#f7f5f3` | Sticky header |
| `--text-primary` | `#313131` | Body copy, headings |
| `--text-secondary` | `#636261` | Supporting text, prose |
| `--text-tertiary` | `#949392` | Meta, captions, timestamps |
| `--text-muted` | `#adaba9` | Placeholders, disabled |
| `--accent` | `#725e7e` | Links, interactive elements |
| `--accent-hover` | `#4c3e54` | Hover/active accent |
| `--border-color` | `#dddbd8` | Default borders |
| `--border-light` | `#dddbd8` | Subtle dividers |
| `--focus-ring` | `rgba(114,94,126,0.08)` | Focus halo |

#### Footer Tokens

The footer is **always dark** in light mode. It uses its own token set to prevent theme inversion from flipping it.

| Token | Value |
|-------|-------|
| `--footer-bg` | `#313131` |
| `--footer-text` | `#adaba9` |
| `--footer-heading` | `#ffffff` |
| `--footer-link` | `#adaba9` |
| `--footer-link-hover` | `#ffffff` |
| `--footer-accent` | `#c9b8d3` |
| `--footer-accent-hover` | `#e8ddef` |
| `--footer-muted` | `#b5b3b1` |
| `--footer-border` | `rgba(255,255,255,0.1)` |

### Dark Theme

Dark mode is **warm charcoal, not OLED black.** Think Kindle Paperwhite dark mode: `#1e1a16` background with soft cream text.

| Semantic Token | Dark Value |
|----------------|------------|
| `--bg-body` | `#1e1a16` |
| `--bg-surface` | `#28241e` |
| `--bg-header` | `#242018` |
| `--text-primary` | `#dcd6ce` |
| `--text-secondary` | `#b0aaa2` |
| `--text-tertiary` | `#8a8480` |
| `--text-muted` | `#6a6460` |
| `--accent` | `#b8a3c4` |
| `--accent-hover` | `#d5c6de` |
| `--border-color` | `#3a3632` |
| `--border-light` | `#332f2b` |
| `--focus-ring` | `rgba(184,163,196,0.12)` |

The purple and neutral scales fully invert. See `global.css` `[data-theme="dark"]` block for exact values.

---

## Typography

### Fonts

| Font | Weights | Role |
|------|---------|------|
| **Cormorant Garamond** | 400, 600 | Display: headings, blockquotes, hero text, FAQ questions, stat numbers |
| **Inter** | 400, 500, 600 | UI: body text, buttons, inputs, labels, meta, navigation |

Both are self-hosted via `@fontsource` packages and preloaded as WOFF2 in `<head>` to eliminate the CSS-to-font waterfall.

### Scale

| Element | Font | Size | Weight | Line-height | Notes |
|---------|------|------|--------|-------------|-------|
| `h1` | Cormorant | `2rem` | 600 | 1.15 | Mobile: `1.5rem` |
| `h2` | Cormorant | `1.75rem` | 600 | 1.15 | Mobile: `1.375rem`. Margin-bottom: `--space-6` |
| `h3` | Cormorant | `1.5rem` | 600 | 1.15 | Margin-bottom: `--space-3` |
| `h4` | Cormorant | `1.25rem` | 600 | 1.15 | Margin-bottom: `--space-2` |
| Body | Inter | `1rem` | 400 | 1.75 | — |
| Prose | Inter | `0.9375rem` | 400 | 1.8 | Used on static/info pages, color: `--text-secondary` |
| Meta | Inter | `0.75rem`–`0.875rem` | 500 | varies | Journal lines, timestamps, counts |
| Small labels | Inter | `0.6875rem` | 600 | — | Eyebrow labels, badge text, uppercase |

### Hero Typography

Heroes use fluid `clamp()` sizing:

| Element | Size |
|---------|------|
| Homepage h1 | `clamp(2rem, 1.2rem + 3.5vw, 4.25rem)` |
| Homepage h2 | `clamp(1.75rem, 1.25rem + 1.5vw, 2.75rem)` |
| Library hero h1 | `2.5rem` → `3.5rem` at 769px |
| Commentary hero h1 | `2.5rem` → `3.5rem` at 769px |
| Article detail h1 | `1.875rem` → `1.5rem` mobile |
| Blog post h1 | `2rem` → `2.5rem` at 769px |

---

## Spacing & Layout

### Spacing Scale

4px baseline grid. All values are CSS custom properties.

| Token | Value | Common use |
|-------|-------|------------|
| `--space-1` | `4px` | Micro gaps, icon margins |
| `--space-2` | `8px` | Tight gaps, list items |
| `--space-3` | `12px` | Small gaps, pill padding |
| `--space-4` | `16px` | Base padding, form gaps |
| `--space-5` | `20px` | Card padding, input padding |
| `--space-6` | `24px` | Section gaps, card padding |
| `--space-8` | `32px` | Section separations |
| `--space-10` | `40px` | Desktop section padding |
| `--space-12` | `48px` | Hero/footer padding |
| `--space-16` | `64px` | Large vertical padding |
| `--space-24` | `96px` | Maximum spacing |

### Max Widths

| Token | Value | Purpose |
|-------|-------|---------|
| `--max-width-page` | `1120px` | Full-width sections, grids |
| `--max-width-article` | `780px` | Reading columns, forms |

### Container Classes

**`.container`** — Centers content, adds horizontal padding.
- Max-width: `--max-width-page`
- Padding: `0 var(--space-4)` mobile, `0 var(--space-6)` at 769px+

**`.container--narrow`** — Constrains to reading width.
- Max-width: `--max-width-article`
- Additive — combine with `.container`

**Letter-line border** — Applied via `.page-body .container--narrow`:
- `border-left: 2px solid var(--purple-300)`
- Padding: `var(--space-12) var(--space-4) var(--space-12) var(--space-8)` desktop
- Padding: `var(--space-8) var(--space-4) var(--space-8) var(--space-5)` mobile

### Page Wrappers

**`.page-wrapper`** — Standard content page.
- `padding: var(--space-8) 0 var(--space-16)`
- `min-height: 60vh`

**`.browse-page`** — Pagination/listing pages.
- `padding: var(--space-8) 0 var(--space-16)`

**`.section`** — Generic section with vertical padding.
- Mobile: `var(--space-6) 0`
- Desktop (769px+): `var(--space-10) 0`

---

## Borders & Radii

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `4px` | Topic pills, small elements |
| `--radius-md` | `8px` | Cards, citations, images |
| `--radius-lg` | `16px` | Large containers |
| `--radius-pill` | `9999px` | Buttons, inputs, search bars |

### Standard Borders

- Card/section borders: `1px solid var(--border-color)`
- Subtle dividers: `1px solid var(--border-light)`
- Input borders: `1.5px solid var(--neutral-300)`
- Focus ring: `0 0 0 3px var(--focus-ring)`
- Letter-line: `2px solid var(--purple-300)`

---

## Shadows

| Token | Light | Dark |
|-------|-------|------|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.08)` | `0 1px 2px rgba(0,0,0,0.2)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.12)` | `0 2px 8px rgba(0,0,0,0.3)` |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.08)` | `0 4px 16px rgba(0,0,0,0.35)` |

Shadows are used sparingly — card hover states, dropdown menus, and the header divider.

---

## E-Ink Filter & Grain

### Body Filter

```css
body {
  filter: saturate(0.7) sepia(0.04) brightness(0.98) contrast(1.05);
}
```

| Property | Value | Effect |
|----------|-------|--------|
| `saturate` | 0.7 | Mutes color vibrancy |
| `sepia` | 0.04 | Adds warm paper tone without yellowing |
| `brightness` | 0.98 | Slight dimming, prevents glare |
| `contrast` | 1.05 | Sharpens text legibility |

### Grain Texture

A `body::before` pseudo-element renders SVG fractal noise over the entire viewport.

| Property | Light | Dark |
|----------|-------|------|
| Opacity | `0.025` | `0.03` |
| Blend mode | `multiply` | `soft-light` |
| Z-index | `9999` | `9999` |
| Pointer-events | `none` | `none` |

The grain is barely perceptible but gives the page a tactile, printed-paper quality.

---

## Buttons

All buttons use `.btn` as the base class with modifier classes for variants.

### Base (`.btn`)

```
display: inline-flex
align-items: center; justify-content: center
gap: var(--space-2)
font-family: Inter; font-size: 0.875rem; font-weight: 500
padding: 10px 24px
border-radius: var(--radius-pill)
border: none; cursor: pointer
transition: background 0.15s, color 0.15s, border-color 0.15s
```

### Variants

| Class | Background | Text | Border | Hover |
|-------|-----------|------|--------|-------|
| `.btn--primary` | `--purple-700` | `--white` | `1px solid --purple-700` | bg/border → `--purple-900` |
| `.btn--secondary` | `--white` | `--purple-700` | `1px solid --purple-700` | text/border → `--purple-900` |
| `.btn--text` | transparent | `--purple-700` | none | text → `--purple-900` |

### Sizes

| Class | Padding | Font size | Notes |
|-------|---------|-----------|-------|
| (default) | `10px 24px` | `0.875rem` | Standard |
| `.btn--sm` | `6px 16px` | `0.8125rem` | Compact |
| `.btn--lg` | `14px 36px` | `1rem` (weight 600) | CTAs, donate buttons |

---

## Links

### Default Link (`a`)

```css
color: var(--accent);
text-decoration: none;
transition: color 0.15s;
```

Hover: `color: var(--accent-hover)`

### Prose Links (`p a`, `li a`, `.prose a`, `blockquote a`)

Same as above, plus:
```css
text-decoration: underline;
text-underline-offset: 2px;
```

Inline links in running text always have underlines for WCAG link distinguishability.

### External Links (`.external-link`)

```
display: inline-flex; align-items: center; gap: 5px
font-size: 0.875rem; font-weight: 500
color: var(--purple-700)
```

Hover: `color: var(--purple-900)`, no underline. Typically paired with an external-link SVG icon.

---

## Forms

### Structure

```html
<div class="form-group">
  <label class="form-label">
    Field Name <span class="form-required">*</span>
  </label>
  <input class="form-input" />
</div>
```

### Tokens

| Class | Properties |
|-------|------------|
| `.form-group` | `margin-bottom: var(--space-5)` |
| `.form-label` | Inter, `0.8125rem`, weight 500, `margin-bottom: var(--space-2)` |
| `.form-required` | `color: var(--accent)` (purple asterisk) |
| `.form-input` | Pill-shaped (`--radius-pill`), `1.5px` border, `0.9375rem` text |
| `.form-textarea` | Rounded (`--radius-md`), `min-height: 120px`, `resize: vertical` |

### States

| State | Style |
|-------|-------|
| Default | `border: 1.5px solid var(--neutral-300)` |
| Focus | `border-color: var(--purple-700)`, `box-shadow: 0 0 0 3px var(--focus-ring)` |
| Invalid | `border-color: #c0392b` |
| Placeholder | `color: var(--text-muted)` |

---

## Cards

### Base Card (`.card`)

```css
background: var(--bg-surface);
border: 1px solid var(--border-color);
border-radius: var(--radius-md);
padding: var(--space-6);
```

Used for audience cards, tier cards, impact cards, and any generic container.

### Article Card (`.article-card`)

Full card with title, meta line, abstract excerpt, and topic pills.

| Part | Font | Size | Color |
|------|------|------|-------|
| `.article-card__title` | Cormorant | `1.125rem`, weight 600 | `--text-primary` → `--accent` hover |
| `.article-card__meta` | Inter | `0.75rem`, weight 500 | `--text-secondary` (author), `--text-tertiary` (journal) |
| `.article-card__abstract` | Inter | `0.8125rem` | `--text-secondary` |
| `.article-card__topic` | Inter | `0.625rem`, weight 500 | `--text-tertiary` on `--neutral-100` bg |

Title clamps at 2 lines; abstract at 3 lines. Card hover: `box-shadow: var(--shadow-md)`.

**Compact variant** (`.article-card--compact`): Transparent bg, no border-radius, bottom-border only. Title uses Inter `0.875rem` weight 500. No shadow on hover. Used in article list/grid views.

### Blog Card (`.blog-card`)

Cover image + body. Image is square (`aspect-ratio: 1/1`) with subtle zoom on hover (`transform: scale(1.03)`).

| Part | Font | Size |
|------|------|------|
| `.blog-card__title` | Cormorant | `1.125rem`, weight 600 |
| `.blog-card__excerpt` | Inter | `0.8125rem` |
| `.blog-card__meta` | Inter | `0.75rem` |

---

## Badges & Pills

### Badge (`.badge`)

```
display: inline-flex; align-items: center; gap: 4px
font-size: 0.6875rem; font-weight: 600
padding: 2px 10px; border-radius: 12px
letter-spacing: 0.02em
```

**`.badge--oa`** (Open Access): green text on green background.

### Topic Pill (`.topic-pill`)

```
display: inline-block
font-size: 0.6875rem; font-weight: 500
color: var(--neutral-700); background: var(--white)
padding: 3px 12px; border-radius: var(--radius-pill)
border: 1px solid var(--neutral-200)
```

Hover: border → `--purple-300`, text → `--purple-700`.

---

## FAQ Accordion

Uses native `<details>`/`<summary>` elements. No JavaScript required.

### Structure

```html
<div class="faq-list">
  <details class="faq-item">
    <summary class="faq-question">
      <span class="faq-question-text">Question text</span>
      <span class="faq-chevron" aria-hidden="true">
        <svg><!-- chevron icon --></svg>
      </span>
    </summary>
    <div class="faq-answer">
      <p>Answer text</p>
    </div>
  </details>
</div>
```

### Styles

| Element | Properties |
|---------|------------|
| `.faq-list` | Flex column, no gap (borders separate items) |
| `.faq-item` | `border-bottom: 1px solid var(--border-light)`. Last child: no border |
| `.faq-question` | Flex row, space-between. Cursor pointer, no list marker |
| `.faq-question-text` | Cormorant, `1.125rem`, weight 600. Hover: accent color |
| `.faq-chevron` | 24px square, `--text-muted`. Rotates 180deg when `[open]`, color → accent |
| `.faq-answer` | Padding-bottom: `--space-5`. Right padding accommodates chevron width |
| `.faq-answer p` | Inter, `0.9375rem`, line-height 1.8, `--text-secondary` |

Mobile (768px): question text shrinks to `1rem`.

---

## Citations

### Citation Tabs (`.citation-tabs`)

Tabbed interface for APA/Vancouver/MLA citation formats.

```
border: 1px solid var(--neutral-200)
border-radius: var(--radius-md)
overflow: hidden; background: var(--white)
```

| Element | Properties |
|---------|------------|
| `.citation-tab-bar` | Flex row, bottom border |
| `.citation-tab` | Flex: 1, `0.8125rem`, weight 500, `--neutral-500`. Active: `--purple-700` with bottom border |
| `.citation-panel` | Padding: `--space-4`. `0.875rem`, line-height 1.75 |
| `.citation-copy-btn` | Inline button, `0.75rem`, `1px solid --neutral-300`. Hover: border → purple |

---

## Pagination

```html
<nav class="pagination" aria-label="Pagination">
  <a href="...">« Prev</a>
  <span class="current">1</span>
  <a href="...">2</a>
  <span class="ellipsis">…</span>
  <a href="...">Next »</a>
</nav>
```

| Element | Style |
|---------|-------|
| Container | Flex, centered, `gap: var(--space-2)`, `margin-top: var(--space-10)` |
| All items | `min-width: 36px`, `height: 36px`, pill-shaped, `0.8125rem` weight 500 |
| Links | `--neutral-600` text, `1px solid --neutral-200` border. Hover: purple |
| `.current` | White text on `--purple-700` bg, weight 600 |
| `.ellipsis` | `--neutral-400`, no border |

---

## Stats Row

```html
<div class="stats-row">
  <div class="stat">
    <span class="stat-number">3,000+</span>
    <span class="stat-label">Research articles</span>
  </div>
</div>
```

| Element | Style |
|---------|-------|
| `.stats-row` | Grid, 3 columns desktop, 1 column mobile (640px). Centered text |
| `.stat-number` | Cormorant, `2rem`, weight 600, `--accent` color |
| `.stat-label` | Inter, `0.8125rem`, `--text-tertiary` |

---

## Blockquotes

```css
blockquote {
  border-left: 3px solid var(--purple-300);
  padding: var(--space-5) var(--space-6);
  margin: 0 0 var(--space-6);
}
```

| Element | Style |
|---------|-------|
| `blockquote p` | Cormorant, `clamp(1.125rem, 1rem + 0.5vw, 1.5rem)`, italic, line-height 1.55 |
| `blockquote cite` | Inter, `0.875rem`, weight 600, normal style, `--accent` color |

---

## Prose & Legal

### Prose (`.prose`)

Applied to info/static page body text and blog post content.

| Element | Style |
|---------|-------|
| `p`, `li`, `address` | Inter, `0.9375rem`, line-height 1.8, `--text-secondary` |
| `ul` | `list-style: disc`, `padding-left: var(--space-6)` |
| `li` | `margin-bottom: var(--space-2)` |
| `a` | Accent color, underline on hover |
| `address` | `font-style: normal` |

### Legal Sections (`.legal-section`)

For privacy policy and terms of use pages.

| Element | Style |
|---------|-------|
| `.legal-section` | `margin-bottom: var(--space-8)` |
| `h2` | `1.375rem` (mobile: `1.25rem`), `margin-bottom: var(--space-3)` |
| `h3` | `1.25rem`, `margin-top: var(--space-5)` |
| `.legal-caps` | `0.8125rem`, line-height 1.8, `--text-secondary` |
| `.effective-date` | `0.875rem`, weight 500, `--text-tertiary` |

### Goals List (`.goals-list`)

Numbered list used on donate and STUC pages.

```css
list-style: decimal;
padding-left: var(--space-6);
margin: var(--space-4) 0;
```

Items: `0.9375rem`, line-height 1.8, `--text-secondary`, `margin-bottom: var(--space-3)`.

---

## Page Layout Patterns

### Standard Content Page

```
BaseLayout > .page-wrapper > .container.container--narrow > sections
```

Used by: About, Contact, Donate, FAQs, Privacy, Terms, STUC, Saved.

### Library Landing

```
BaseLayout > hero (full-viewport) > .section > .container > grids
```

No `.page-wrapper`. Hero takes full viewport height.

### Detail Pages (Library Article, Commentary Post)

```
BaseLayout > .page-wrapper[data-pagefind-body] > .container.container--narrow > content
```

`data-pagefind-body` marks these as the only pages Pagefind should index.

### Listing/Pagination Pages

```
BaseLayout > .browse-page[data-pagefind-ignore="all"] > .container > grid + pagination
```

`data-pagefind-ignore="all"` ensures listing pages are excluded from search results.

### Section Headers

```html
<div class="section-header">
  <h2 class="section-label">Section title</h2>
  <span class="meta-count">N articles</span>
</div>
```

`.section-header`: Flex row, baseline-aligned, space-between.
`.section-label` (eyebrow): Inter, `0.6875rem`, weight 600, uppercase, `0.08em` letter-spacing, `--text-tertiary`. Desktop: `0.75rem`.
`.meta-count`: `0.75rem`, `--text-tertiary`.

### Detail Headings

`.detail-heading` (used within article/post detail pages for section titles like "Abstract", "Topics", "Cite this article", "Related"):

```css
font-family: Cormorant Garamond;
font-size: 1.125rem;
font-weight: 600;
margin-bottom: var(--space-4);
color: var(--neutral-900);
```

Note: This is intentionally a different pattern from `.section-label`. The eyebrow label is small/uppercase Inter; the detail heading is larger/normal-case Cormorant.

### Browse Header

```html
<div class="browse-header">
  <div>
    <h1>Browse all articles</h1>
    <p class="browse-meta">Showing 1–50 of 3,159</p>
  </div>
  <a href="..." class="btn btn--secondary btn--sm">Search</a>
</div>
```

`.browse-header`: Flex row, `align-items: flex-end`, space-between, `margin-bottom: var(--space-8)`.
`.browse-meta`: Inter, `0.8125rem`, weight 500, `--neutral-500`.

### Breadcrumb

```html
<nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="/library">Research Library</a>
  <span aria-hidden="true"> › </span>
  <span>Current Page</span>
</nav>
```

`0.8125rem`, `--text-tertiary`. Links in accent color, underline on hover. `margin-bottom: var(--space-6)`.

### Divider

```html
<hr class="divider" />
```

`border-top: 1px solid var(--border-color)`, `margin: var(--space-6) 0`.

### Footnote

```html
<p class="footnote">Tax-deductible text here.</p>
```

`0.75rem`, line-height 1.5, `--text-tertiary`.

---

## Header

### Structure

Sticky header, 56px tall, full-width.

```
.site-header (sticky, z-100)
  .header-inner.container (flex, 56px height)
    .logo (Cormorant, 1.625rem)
    .main-nav > .nav-list (flex row)
    .header-search (centered, library pages only)
    .header-actions (saved link, theme toggle, donate button)
    .mobile-saved (mobile only)
    .mobile-toggle (hamburger, mobile only)
```

### Key Elements

| Element | Style |
|---------|-------|
| `.logo` | Cormorant, `1.625rem`, weight 600. No hover underline |
| `.nav-link` | Inter, `0.875rem`, weight 400. Hover: accent color |
| `.header-search` | Hidden by default. Visible on `.page-library` body class |
| `.theme-toggle` | Sun/moon icons. Only one visible per theme |
| `.donate-btn` | `0.8125rem`, weight 500, pill-shaped, `--purple-700` bg |
| `.saved-link` | Hidden until `.has-items` class. Shows bookmark count |

### Mobile (≤768px)

- Hamburger toggle shows; nav, search, actions hide
- Menu opens as full-width dropdown below header (flex column)
- Dropdown menus become static, single-column
- Mobile nav footer shows theme toggle + donate button

---

## Footer

### Structure

Always dark background. Uses `--footer-*` tokens.

```
.site-footer
  .container
    .footer-columns (3-col grid: links, links, about text)
    .footer-bottom (copyright + legal links)
```

### Key Elements

| Element | Style |
|---------|-------|
| `.footer-heading` | Cormorant, `1.125rem`, weight 500, `--footer-heading` |
| `.footer-links a` | Inter, `0.8125rem`, `--footer-link` → `--footer-link-hover` |
| `.footer-text` | `0.8125rem`, `--footer-text`, line-height 1.7 |
| `.footer-text a` | `--footer-accent`, underline |
| `.footer-copyright` | `0.75rem`, `--footer-muted` |
| `.footer-legal a` | `0.75rem`, `--footer-muted`, underline |

### Layout

Desktop: 3-column grid (`1fr 1fr 2fr`), `gap: var(--space-10)`.
Mobile: single column.

---

## Dark Mode

### Implementation

1. **Inline script in `<head>`** reads `localStorage('rrm_theme')` and applies `data-theme` attribute before first paint. Falls back to `prefers-color-scheme: dark` system preference.
2. All color tokens are redefined under `[data-theme="dark"]`.
3. Theme toggle button in header dispatches the switch and persists to `localStorage`.

### Key Differences

| Property | Light | Dark |
|----------|-------|------|
| Background | `#f7f5f3` (warm cream) | `#1e1a16` (warm charcoal) |
| Text | `#313131` (near-black) | `#dcd6ce` (soft cream) |
| Surface | `#ffffff` | `#28241e` |
| Accent | `#725e7e` (dark purple) | `#b8a3c4` (light purple) |
| Grain blend | `multiply` | `soft-light` |
| Shadows | Lighter | Heavier |
| Footer | Always dark | Subtly darker than body |

### What NOT to override

- Footer tokens handle themselves — no dark-mode overrides needed
- The e-ink filter stays the same (saturate/sepia/brightness/contrast)
- Grain opacity increases slightly in dark mode (0.025 → 0.03)

---

## Responsive Breakpoints

| Breakpoint | Direction | Usage |
|------------|-----------|-------|
| `640px` | `min-width` | 2-column grids (audience, impact, blog, related) |
| `768px` | `max-width` | Mobile typography, single-column layouts |
| `769px` | `min-width` | Desktop nav, wider padding, 2-column featured topics |
| `1024px` | `min-width` | 3-column blog grid |

### Design approach

Mobile-first. Base styles are for narrow viewports. `min-width` queries add complexity for larger screens.

---

## Accessibility

### Color Contrast

| Pair | Ratio | Level |
|------|-------|-------|
| `--purple-700` on white | ≥4.5:1 | AA |
| `--purple-900` on white | ≥7:1 | AAA |
| `--text-primary` on `--bg-body` | ≥10:1 | AAA |
| `--text-secondary` on `--bg-body` | ≥4.5:1 | AA |

### Focus States

All interactive elements receive a soft purple halo on focus:

```css
box-shadow: 0 0 0 3px var(--focus-ring);
```

### Link Distinguishability

Links inside prose content (`p a`, `li a`, `blockquote a`, `.prose a`) always display underlines, per WCAG 1.4.1.

### Semantic HTML

- Headings: proper h1→h4 hierarchy per page
- Navigation: `<nav>` with `aria-label`
- Breadcrumbs: `aria-label="Breadcrumb"`
- Pagination: `aria-label="Pagination"`
- FAQ: native `<details>`/`<summary>` (no JS needed)
- Forms: `<label>` elements linked to inputs
- Icons: decorative SVGs marked `aria-hidden="true"`
- Screen reader text: `.sr-only` utility class

### Keyboard Navigation

- All buttons and links are focusable in logical tab order
- FAQ accordions toggle with Enter/Space (native `<details>` behavior)
- Dropdown menus accessible via hover and focus states

---

## Transitions & Animation

### Standard Transitions

| Property | Duration | Easing |
|----------|----------|--------|
| Color, border-color, background | `0.15s` | default (ease) |
| Box-shadow (cards) | `0.2s` | default |
| Chevron rotation | `0.2s` | `ease` |
| Blog card image zoom | `0.3s` | default |
| Body/header/footer theme switch | `0.3s` | default |
| Ticker card fade/scale | `0.5s` | `ease` |

### Animations

| Element | Behavior |
|---------|----------|
| Library ticker | Auto-rotates every 4s. Cards stack with scale(0.97/0.94) behind. Active card fades in, previous slides up and fades |
| Blog card image | `transform: scale(1.03)` on card hover (0.3s) |
| Share/save button | "Copied!"/"Saved!" label appears for 2s then clears |

### No-animation elements

- E-ink grain: always-on, no transition
- Body filter: constant, no animation
- Theme toggle icons: instant swap (display:none toggle)

---

## Component Inventory

### Astro Components (`src/components/`)

| Component | Purpose | Props |
|-----------|---------|-------|
| `BaseLayout.astro` | Page shell — `<html>`, `<head>`, fonts, meta, theme script | `title`, `description?`, `canonicalUrl?`, `ogType?`, `jsonLd?`, `bodyClass?` |
| `Header.astro` | Sticky navigation, search, theme toggle, mobile menu | (none — reads body class) |
| `Footer.astro` | Site footer with column layout and legal links | (none) |
| `ArticleCard.astro` | Library article card (full or compact) | `article`, `compact?` |
| `BlogCard.astro` | Commentary blog card with cover image | `post` |
| `AuthorByline.astro` | Author name + date line for blog posts | `author`, `date` |
| `Citation.astro` | Tabbed APA/Vancouver/MLA citation block | `apa?`, `vancouver?`, `mla?` |
| `SearchBar.astro` | Pagefind search input with icon | (none) |
| `TopicTag.astro` | Single topic pill link | `topic` |

---

## Page Inventory

### Static Pages (8)

| Page | File | JSON-LD | canonicalUrl |
|------|------|---------|-------------|
| Homepage | `src/pages/index.astro` | EducationalOrganization | `https://rrmacademy.org/` |
| About | `src/pages/about.astro` | AboutPage | `https://rrmacademy.org/about` |
| Contact | `src/pages/contact.astro` | ContactPage | `https://rrmacademy.org/contact` |
| Donate | `src/pages/donate.astro` | DonateAction | `https://rrmacademy.org/donate` |
| FAQs | `src/pages/faqs.astro` | FAQPage | `https://rrmacademy.org/faqs` |
| Privacy Policy | `src/pages/privacy-policy.astro` | — | `https://rrmacademy.org/privacy-policy` |
| Terms of Use | `src/pages/terms-of-use.astro` | — | `https://rrmacademy.org/terms-of-use` |
| Save the Uterus Club | `src/pages/save-the-uterus-club.astro` | WebPage + JoinAction | `https://rrmacademy.org/save-the-uterus-club` |

### Library Pages (4)

| Page | File | Notes |
|------|------|-------|
| Landing | `src/pages/library/index.astro` | Full-viewport hero, ticker, topic browse, article grid |
| Detail | `src/pages/library/[...slug].astro` | `data-pagefind-body`, MedicalScholarlyArticle JSON-LD |
| Pagination | `src/pages/library/page/[page].astro` | `data-pagefind-ignore="all"` |
| Saved | `src/pages/library/saved.astro` | Client-side localStorage, no SSR data |

### Commentary Pages (3 + RSS)

| Page | File | Notes |
|------|------|-------|
| Landing | `src/pages/commentary/index.astro` | Blog JSON-LD, `data-pagefind-ignore="all"` |
| Detail | `src/pages/commentary/[...slug].astro` | `data-pagefind-body`, BlogPosting JSON-LD |
| Pagination | `src/pages/commentary/page/[page].astro` | `data-pagefind-ignore="all"` |
| RSS Feed | `src/pages/commentary/rss.xml.ts` | XML endpoint |
