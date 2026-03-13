# SVG Chart Guide for RRM Academy

Hand-crafted SVG charts for inline use in pillar pages, commentary, and FAQs. These match the e-ink paper aesthetic and support light/dark mode.

---

## Quick Start

1. Create two SVGs: `chart-name.svg` (light) and `chart-name-dark.svg` (dark)
2. Place in `public/images/<section>/`
3. Use the dual-image pattern in the page (see [Page Integration](#page-integration))

---

## Design Language

Charts match the site's e-ink paper aesthetic: muted, warm, clinical without being sterile. Inter for all text. No gradients, no drop shadows, no rounded-everything.

### Visual Rules

- **Background**: solid fill, no transparency (light: `#ffffff`, dark: `#28241e`)
- **Bars/shapes**: flat fill, `rx="3"` for subtle rounding
- **Text**: Inter font family, `sans-serif` fallback
- **Heading**: uppercase, letter-spacing `0.05em`, 11px
- **Divider line**: below heading, accent color
- **Caption**: italic, muted purple, 11.5px
- **No axis lines** except a subtle baseline where needed
- **No gridlines**

---

## Color Palette

### Light Mode

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#ffffff` | SVG background rect |
| Heading text | `#636261` | Section headings (uppercase) |
| Body text | `#313131` | Value labels, primary text |
| Secondary text | `#636261` | Row labels, secondary text |
| Caption text | `#987da8` | Source notes, axis labels |
| Divider line | `#c9b8d3` | Heading underline |
| Primary bar | `#725e7e` | NaPro/main data bars |
| Secondary bar | `#b0aaa2` | Comparison/IVF bars |
| Light bar | `#e8ddef` | Lighter data bars |
| Accent bar | `#c9b8d3` | Medium emphasis bar |
| Accent stroke | `#725e7e` | Highlight bar border |
| Track/background | `#f0eeeb` | Empty track behind bars |
| Baseline | `#dddbd8` | Subtle axis line |
| Value highlight | `#725e7e` | Emphasized value text |

### Dark Mode

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#28241e` | SVG background rect |
| Heading text | `#b0aaa2` | Section headings |
| Body text | `#dcd6ce` | Value labels, primary text |
| Secondary text | `#b0aaa2` | Row labels |
| Caption text | `#987da8` | Source notes (same both modes) |
| Divider line | `#6b5877` | Heading underline |
| Primary bar | `#b8a3c4` | NaPro/main data bars |
| Secondary bar | `#6b6560` | Comparison bars |
| Light bar | `#3d3345` | Lighter data bars |
| Accent bar | `#6b5877` | Medium emphasis bar |
| Accent stroke | `#b8a3c4` | Highlight bar border |
| Track/background | `#3a3632` | Empty track |
| Baseline | `#3a3632` | Subtle axis line |
| Value highlight | `#b8a3c4` | Emphasized value text |

### Color Mapping Cheat Sheet

```
Light           Dark
#ffffff    -->   #28241e   (background)
#313131    -->   #dcd6ce   (primary text)
#636261    -->   #b0aaa2   (secondary text)
#987da8    -->   #987da8   (caption -- same)
#725e7e    -->   #b8a3c4   (accent/primary bar)
#b0aaa2    -->   #6b6560   (comparison bar)
#e8ddef    -->   #3d3345   (light bar)
#c9b8d3    -->   #6b5877   (medium bar/divider)
#f0eeeb    -->   #3a3632   (track)
#dddbd8    -->   #3a3632   (baseline/border)
```

---

## Chart Types

### Horizontal Bar Chart

Best for: comparisons (NaPro vs IVF, study vs study).

```
viewBox="0 0 700 340"

Layout:
- Labels right-aligned at x=235
- Track starts at x=248, width=350
- Bar widths = (value / max_value) * 350
- Value text at x=618 (after track end)
- Row spacing: 45px between rows
- First row y=90
```

**Anatomy:**
```svg
<!-- Heading -->
<text x="30" y="35" class="heading">SECTION TITLE</text>
<line x1="30" y1="48" x2="670" y2="48" class="divider"/>

<!-- Each row -->
<text x="235" y="90" class="label">Label text</text>
<rect x="248" y="78" width="350" height="22" rx="3" class="track"/>
<rect x="248" y="78" width="[calculated]" height="22" rx="3" class="bar-primary"/>
<text x="618" y="90" class="value value-primary">XX%</text>

<!-- Caption at bottom -->
<text x="30" y="280" class="caption">Source note in italics.</text>
```

### Vertical Bar Chart

Best for: progression over time, cumulative data.

```
viewBox="0 0 700 380"

Layout:
- Chart area: y=90 (top) to y=290 (baseline), 200px height
- Bar width: 90px, spacing: 10px gap
- First bar x=80
- Bar height = (value / max_value) * 200
- Bar y = 290 - height
- Value labels 10px above bar top
- Axis labels 18px below baseline (y=308)
```

**Anatomy:**
```svg
<!-- Heading + optional subtitle -->
<text x="30" y="35" class="heading">SECTION TITLE</text>
<line x1="30" y1="48" x2="670" y2="48" class="divider"/>
<text x="30" y="72" class="subtitle">Subtitle text</text>

<!-- Each bar -->
<rect x="80" y="[290-height]" width="90" height="[calculated]" rx="3" class="bar"/>
<text x="125" y="[bar_y - 10]" class="val">X.X%</text>
<text x="125" y="308" class="axis-label">6 mo</text>

<!-- Baseline -->
<line x1="70" y1="290" x2="620" y2="290" stroke="#dddbd8" stroke-width="1"/>
```

### Stat Callout (Single Number)

Best for: one or two key statistics in a FAQ or short section.

```
viewBox="0 0 350 120"

Layout:
- Centered number, large (28-32px)
- Label below (12px)
- Optional accent underline
```

---

## CSS Classes (Reusable)

Every SVG uses embedded `<style>` with these class names:

```css
/* Text */
.heading   { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; fill: [heading-color]; letter-spacing: 0.05em; }
.subtitle  { font-family: 'Inter', sans-serif; font-size: 12.5px; font-weight: 400; fill: [secondary-text]; }
.label     { font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 400; fill: [secondary-text]; }
.val       { font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; fill: [primary-text]; text-anchor: middle; }
.value     { font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; dominant-baseline: central; }
.axis-label{ font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 400; fill: [caption-color]; text-anchor: middle; }
.caption   { font-family: 'Inter', sans-serif; font-size: 11.5px; font-style: italic; fill: #987da8; }

/* Structural */
.divider   { stroke: [divider-color]; stroke-width: 1; }

/* Bars */
.bar-primary   { fill: [primary-bar]; }
.bar-secondary { fill: [secondary-bar]; }
.bar-light     { fill: [light-bar]; }
.bar-accent    { fill: [accent-bar]; stroke: [accent-stroke]; stroke-width: 2; }
.track         { fill: [track-color]; }
```

Replace `[bracketed]` values from the color palette tables above.

---

## SVG Template

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 340" role="img" aria-label="[Descriptive label]">
  <title>[Chart Title]</title>
  <desc>[Full text description of data for screen readers and SEO]</desc>

  <style>
    /* Paste classes from above with correct colors */
  </style>

  <rect width="700" height="340" fill="[background]"/>

  <!-- Heading -->
  <text x="30" y="35" class="heading">[TITLE IN CAPS]</text>
  <line x1="30" y1="48" x2="670" y2="48" class="divider"/>

  <!-- Data -->
  <!-- ... bars, labels, values ... -->

  <!-- Caption -->
  <text x="30" y="[bottom]" class="caption">[Source attribution]</text>
</svg>
```

---

## Page Integration

### Dual Image Pattern (Light/Dark)

In the Astro page:

```astro
<figure class="chart-figure">
  <img src="/images/section/chart-name.svg"
       alt="[Full descriptive alt text with data values]"
       class="chart-light" loading="lazy" width="700" height="340" />
  <img src="/images/section/chart-name-dark.svg"
       alt="[Same alt text]"
       class="chart-dark" loading="lazy" width="700" height="340" />
</figure>
```

### Scoped CSS (in page `<style>` block)

```css
.chart-figure {
  margin: var(--space-8) 0;
}
.chart-figure img {
  width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}
.chart-dark { display: none; }
:global([data-theme="dark"]) .chart-light { display: none; }
:global([data-theme="dark"]) .chart-dark { display: block; }
```

### Alt Text Rules

- Include ALL data values in alt text (screen readers and SEO)
- Describe chart type: "Horizontal bar chart comparing..."
- Name the data: "NaPro Boyle 2025 41%, NaPro S. Mendez 24 months 50%..."
- Both light and dark images get identical alt text

---

## Sizing Guide

| Chart Type | viewBox | Typical Use |
|------------|---------|-------------|
| Horizontal bar (4 rows) | `0 0 700 340` | Comparisons |
| Vertical bar (5 bars) | `0 0 700 380` | Time series |
| Horizontal bar (6+ rows) | `0 0 700 400+` | Extended comparisons |
| Stat callout | `0 0 350 120` | Single stat in FAQ |
| Small inline | `0 0 500 200` | Compact charts |

Width is always fluid (100% of container). Height scales proportionally via viewBox.

---

## Accessibility

- `role="img"` on root `<svg>`
- `aria-label` with brief description
- `<title>` element (accessible name)
- `<desc>` element with full data description (screen readers get all values)
- Alt text on `<img>` tags when using as external files

---

## File Naming

```
public/images/
  naprotechnology/
    success-rates.svg
    success-rates-dark.svg
    cumulative-rates.svg
    cumulative-rates-dark.svg
  what-is-rrm/
    outcomes-chart.svg
    outcomes-chart-dark.svg
  faqs/
    stat-callout.svg
    stat-callout-dark.svg
```

Pattern: `[descriptive-name].svg` + `[descriptive-name]-dark.svg`

---

## Existing Charts

| File | Type | Data |
|------|------|------|
| `naprotechnology/success-rates.svg` | Horizontal bar | NaPro vs IVF live birth rates (4 rows) |
| `naprotechnology/cumulative-rates.svg` | Vertical bar | Cumulative birth rate over time (5 bars) |

---

## Checklist

Before committing a new chart:

- [ ] Light and dark versions both created
- [ ] Colors match palette tables exactly
- [ ] `role="img"`, `aria-label`, `<title>`, `<desc>` present
- [ ] All data values in `<desc>` and `alt` text
- [ ] Caption includes source attribution
- [ ] Inter font specified with sans-serif fallback
- [ ] Background rect covers full viewBox (no transparency)
- [ ] `width` and `height` attributes on `<img>` tags (CLS prevention)
- [ ] `loading="lazy"` on `<img>` tags
- [ ] Dark mode toggle CSS in page style block
