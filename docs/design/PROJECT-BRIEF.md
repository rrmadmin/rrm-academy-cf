# RRM Academy Website Redesign — Project Brief

**Project:** Figma design system + page refinements for rrmacademy.org
**Approach:** Minimal — same vibe, consistent tokens, conversion optimization
**Platform:** Wix (current site)
**Date started:** 2026-02-15

---

## Current Site Audit

### Site Architecture (Wix-hosted)

```
rrmacademy.org/
├── / (Homepage)
├── /library (Research Library — 2,200+ articles, paginated list)
├── /commentary (Blog — categories below)
│   └── /categories/
│       ├── restorative-reproductive-medicine
│       ├── rrm-physicians (Physician Spotlights)
│       ├── research-library
│       └── case-study
├── /courses (4 courses listed)
│   ├── /course/rrm-vs-ivf (Free, 83 participants)
│   ├── /course/postpartum-depression-anxiety (Free, 42 participants)
│   ├── /course/long-term-endometriosis-management ($19, 39 participants)
│   └── /course/masterclass-in-endometriosis-and-surgery (37 participants)
├── /about
├── /donate (PayPal link, 501(c)(3) info)
├── /contact
├── /save-the-uterus-club (Community/membership)
├── /3-tier-endometriosis-symptom-self-survey
├── /members-area (Login)
├── /terms-of-use
└── /privacy-policy
```

---

## Extracted Design Tokens

### Fonts (Keep — Excellent Pairing)

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| **Headings** | Cormorant Garamond | Semibold (600) | Elegant serif, Google Font |
| **Body** | Inter | Regular (400) | Best-in-class sans-serif, Google Font |
| **Nav/UI small** | DIN Next W01 Light | Light (300) | Used sparingly for small labels |

**Verdict: Keep this pairing.** Cormorant Garamond + Inter is a well-regarded combination
used by premium brands. Cormorant brings the warmth and authority the medical/educational
tone needs. Inter is the gold standard for web readability. No change recommended.

### Typography Scale (from Wix CSS)

| Token | Font | Size | Line Height | Usage |
|-------|------|------|-------------|-------|
| `--font_0` | Cormorant Garamond SB | 32px | 1.15 | Display (bold 700) |
| `--font_2` | Cormorant Garamond SB | 28px | 1.15 | H1 |
| `--font_3` | Cormorant Garamond SB | 32px | 1.15 | H2 (same as display?) |
| `--font_4` | Cormorant Garamond SB | 24px | 1.15 | H3 / Subtitle |
| `--font_5` | Cormorant Garamond SB | 16px | 1.15 | H4 / Small heading |
| `--font_6` | Cormorant Garamond SB | 32px | 1.4 | Nav logo text |
| `--font_7` | Inter | 14px | 1.75 | Body (default paragraph) |
| `--font_8` | Inter | 16px | 1.75 | Body large |
| `--font_9` | Inter | 12px | 1.75 | Caption / small text |
| `--font_10` | DIN Next Light | 12px | 1.4 | UI labels |

**Issue to fix:** The heading scale has overlap (font_0, font_3, font_6 all at 32px).
Clean this up in Figma to create a clear, distinct hierarchy.

**Recommended clean scale for Figma:**

| Style | Font | Size | Line Height | Use |
|-------|------|------|-------------|-----|
| Display | Cormorant Garamond SB | 40px | 1.15 | Hero headlines |
| H1 | Cormorant Garamond SB | 32px | 1.15 | Page titles |
| H2 | Cormorant Garamond SB | 28px | 1.15 | Section headings |
| H3 | Cormorant Garamond SB | 24px | 1.15 | Subsections |
| H4 | Cormorant Garamond SB | 20px | 1.15 | Card titles |
| Body L | Inter Regular | 18px | 1.75 | Lead paragraphs |
| Body | Inter Regular | 16px | 1.75 | Default body text |
| Body S | Inter Regular | 14px | 1.75 | Secondary text |
| Caption | Inter Regular | 12px | 1.5 | Labels, meta |
| Button | Inter Medium (500) | 14px | 1.0 | Button labels |

### Color Palette (extracted from Wix CSS variables)

**Brand Purple (Primary)** — the core identity color:

| Name | Hex | RGB | Wix Var | Usage |
|------|-----|-----|---------|-------|
| Purple 900 | `#4c3e54` | 76, 62, 84 | `--color_17` | Darkest — hover states, headings on light bg |
| Purple 700 | `#725e7e` | 114, 94, 126 | `--color_18` | **Primary** — buttons, links, nav accents |
| Purple 500 | `#987da8` | 152, 125, 168 | `--color_19` | Medium — secondary elements |
| Purple 300 | `#c9b8d3` | 201, 184, 211 | `--color_20` | Light — borders, tags |
| Purple 50 | (derive) | — | — | ~`#f0eaf4` — tinted section backgrounds |

**Neutrals:**

| Name | Hex | RGB | Wix Var | Usage |
|------|-----|-----|---------|-------|
| Neutral 900 | `#313131` | 49, 49, 49 | `--color_15` | Primary text |
| Neutral 700 | `#636261` | 99, 98, 97 | `--color_14` | Secondary text |
| Neutral 500 | `#949392` | 148, 147, 146 | `--color_13` | Muted text, placeholders |
| Neutral 300 | `#c6c4c2` | 198, 196, 194 | `--color_12` | Borders, dividers |
| Neutral 100 | `#f7f5f3` | 247, 245, 243 | `--color_30` | Off-white backgrounds |
| White | `#ffffff` | 255, 255, 255 | `--color_0` | Page background |

**Warm accent palette** (defined in Wix, used lightly):

| Name | Hex | Wix Var | Notes |
|------|-----|---------|-------|
| Sage 700 | `#7e8772` | `--color_22` | Not prominently used |
| Sage 300 | `#bec3b8` | `--color_16` | Not prominently used |
| Rose 700 | `#b0778a` | `--color_23` | Not prominently used |
| Rose 500 | `#eb9fb8` | `--color_24` | Not prominently used |
| Rose 300 | `#f5cdda` | `--color_25` | Not prominently used |
| Cream | `#eee5dd` | `--color_21` | Warm section backgrounds |
| Sand 300 | `#dbcbbb` | `--color_35` | Warm accents |

**Accessibility check:**
- `#725e7e` on white = ~5.8:1 contrast ratio — **passes WCAG AA** (4.5:1 required)
- `#4c3e54` on white = ~9.9:1 — **passes WCAG AAA**
- `#987da8` on white = ~3.6:1 — **fails for body text**, OK for large headings only
- Recommendation: Use `#725e7e` minimum for any text on white backgrounds

### Button System (from Wix variables)

| Style | Fill | Border | Text | Wix Vars |
|-------|------|--------|------|----------|
| Primary | `#725e7e` | `#725e7e` | `#ffffff` | 48/49/50 |
| Primary hover | `#725e7e` | `#725e7e` | `#ffffff` | 51/52/53 |
| Primary disabled | `#949392` | `#949392` | `#ffffff` | 54/55/56 |
| Secondary | `#ffffff` | `#725e7e` | `#725e7e` | 57/58/59 |
| Secondary hover | `#ffffff` | `#725e7e` | `#725e7e` | 60/61/62 |
| Secondary disabled | `#ffffff` | `#949392` | `#949392` | 63/64/65 |

**Issue:** Primary and primary hover are identical — there's no visible hover state.
Fix this in the design system with a darker hover (`#4c3e54` or `#5a4a65`).

---

## What Needs Fixing (Minimal Redesign Scope)

### Consistency Issues

1. **Heading hierarchy overlap** — three different tokens all use 32px. Establish a clear,
   descending type scale.
2. **No visible button hover state** — primary and hover are the same color. Add
   darkening or subtle shift on hover.
3. **Inconsistent section backgrounds** — some use cream (#eee5dd), some use lavender
   tints, some white. Standardize to 2-3 background options max.
4. **Rose/sage/sand palette defined but barely used** — decide: use them intentionally
   (e.g., rose for "for patients" sections, sage for "for professionals") or remove.

### Conversion Optimization

5. **Donate page** — currently plain text with a PayPal link. Needs:
   - Impact stats (625K+ monthly Instagram reach, 2,200+ library articles, 200+ enrolled)
   - Visual hierarchy drawing eye to the donate CTA
   - Trust signals (501(c)(3), EIN, tax-deductible messaging)
   - Optional: suggested donation amounts / tiers
6. **Homepage CTA clarity** — two buttons ("Explore Courses" / "Find RRM Research") are
   good, but the page is so long the CTAs get buried. Add a sticky or repeated CTA.
7. **Courses page** — consider adding social proof more prominently (participant counts)
   and a clearer visual distinction between free and paid courses.

### Spacing

8. **Define a spacing scale and apply consistently** — current spacing appears eyeballed.
   Use a 4px-base system: 4, 8, 12, 16, 24, 32, 48, 64, 96.

---

## Figma Structure

### File: "RRM Academy Redesign"

**Page 1: Design System**
- Color swatches (purple scale, neutrals, warm accents)
- Typography specimens (each style with sample text)
- Button states (primary, secondary, disabled, hover)
- Spacing scale visual
- Component library (nav, cards, CTA banner, footer, FAQ)

**Page 2: Page Refinements**
1. Homepage — tighten sections, consistent spacing, better CTA placement
2. Donate — conversion-optimized layout
3. Courses — clearer card hierarchy, social proof
4. About — minor consistency pass

**Page 3: Current Site Reference**
- Screenshots of current pages for comparison

### Figma Quick-Start (for Figma beginners)

1. Create a new file in Figma (free plan works fine)
2. On the Design System page, start with rectangles for color swatches:
   - Draw a rectangle (`R`), set fill to each hex value, label it
3. For typography, use text layers (`T`) set to each style
4. Use **Figma Variables** (right panel > Local Variables) to store colors as reusable tokens
5. Build components with **Auto Layout** (`Shift+A`) so they resize properly
6. When designing pages, use a 1440px wide frame (`F`) for desktop

Key shortcuts: `F` Frame, `T` Text, `R` Rectangle, `Shift+A` Auto Layout, `Cmd+D` Duplicate

---

## Reference Assets

Scraped data: `~/.firecrawl/rrm-redesign/`
- `homepage.json` — Full homepage content + links
- `homepage-raw.html` — Raw HTML with CSS variables
- `homepage-screenshot.png` — Visual screenshot
- `about.md`, `donate.md`, `courses.md`, `library.md` — Page content
- `sitemap.json` — All discovered URLs
