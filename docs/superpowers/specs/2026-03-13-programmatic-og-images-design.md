# Programmatic OG Images -- Design Spec

## Goal

Auto-generate page-specific Open Graph images at build time for all pages except library synopsis pages (`/library/[slug]`) and commentary posts (`/commentary/[slug]`). Course detail pages (`/courses/[slug]`) keep their existing cover images.

## Architecture

**Pipeline:** Astro integration using Satori (JSX to SVG) + resvg (SVG to PNG). Runs as a **pre-build script** (not `afterBuild`), so generated images exist in `public/images/og/` before Astro renders pages.

```
npm run build
  ├── 1. node scripts/generate-og-images.mjs
  │     ├── Reads page registry (static list + FAQ data)
  │     ├── For each page: renders JSX template with title → SVG → PNG
  │     └── Writes to public/images/og/og-{slug}.png
  └── 2. astro build && npx pagefind --site dist
```

**Build script wiring:** Update `package.json` build script to:
```json
"build": "node scripts/generate-og-images.mjs && astro build && npx pagefind --site dist"
```

**No new infrastructure.** Images are ephemeral build artifacts. Generated into `public/images/og/`, gitignored, rebuilt every deploy. No R2, no KV, no caching layer.

## Template Design (1200x630)

Matches the site's e-ink paper aesthetic. Always renders in light mode regardless of user theme preference.

- **Background:** `#f7f5f3` (warm paper)
- **Title:** Cormorant Garamond 600, `#313131`
- **Wordmark:** "RRM Academy" in Cormorant Garamond, `#725e7e` (brand purple), positioned bottom-left
- **Accent:** Thin horizontal purple line (`#725e7e`, ~2px) separating title area from wordmark
- **Padding:** Generous (~60px all sides) so text never crowds edges
- **No images, no gradients** -- pure typography on paper

### Dynamic Font Sizing

Title font size scales by character count to guarantee the text fits within the available vertical space (~430px after padding and wordmark area).

| Title Length | Font Size | Max Lines | Covers |
|-------------|-----------|-----------|--------|
| <= 30 chars | 56px | 2 | Short page names ("About RRM Academy", "Donate") |
| 31-60 chars | 44px | 3 | Medium titles, most static pages |
| 61-80 chars | 36px | 4 | Long FAQ questions |
| > 80 chars | 30px | 5 | Longest FAQ questions (up to 99 chars observed) |

Satori handles line wrapping automatically within the container. At 30px with 1080px usable width, ~45 chars fit per line, so 99 chars wraps to ~3 lines at that size -- well within the 5-line budget.

If a title ever exceeds the vertical space (defensive), Satori clips with `overflow: hidden`. No ellipsis truncation -- if a title is too long, fix the title.

### Unicode Handling

FAQ questions contain unicode non-breaking hyphens (`\u2011`) and smart quotes (`\u2019`). Satori renders these correctly with embedded fonts. FAQ slugs are clean ASCII -- no filesystem concerns.

## Font Embedding

Satori requires raw font file buffers. The `@fontsource` packages ship `.woff` files which Satori accepts (confirmed in Satori v0.10+). If `.woff` causes rendering issues, download `.ttf` from Google Fonts at build time as fallback.

- `@fontsource/cormorant-garamond` -- weight 600 (titles + wordmark)
- `@fontsource/inter` -- weight 400 (reserved for future subtitle/URL text)

Read font files from `node_modules/@fontsource/*/files/` at build time.

## Title Extraction

Titles come from two sources:

**Static pages** -- a hardcoded registry in the generation script mapping route to title:

```js
const STATIC_PAGES = [
  { slug: 'homepage', title: 'RRM Academy' },
  { slug: 'about', title: 'About RRM Academy' },
  { slug: 'contact', title: 'Contact Us' },
  { slug: 'donate', title: 'Donate' },
  { slug: 'donate-thank-you', title: 'Thank You for Your Donation' },
  { slug: 'faqs', title: 'Frequently Asked Questions' },
  { slug: 'library', title: 'Research Library' },
  { slug: 'commentary', title: 'Commentary' },
  { slug: 'courses', title: 'Courses' },
  { slug: 'community', title: 'Community' },
  { slug: 'community-events', title: 'Community Events' },
  { slug: 'community-members', title: 'Community Members' },
  { slug: 'terms-of-use', title: 'Terms of Use' },
  { slug: 'privacy-policy', title: 'Privacy Policy' },
  { slug: 'medical-disclaimer', title: 'Medical Disclaimer' },
  { slug: 'what-is-rrm', title: 'What Is Restorative Reproductive Medicine?' },
  { slug: 'naprotechnology', title: 'NaProTechnology' },
  { slug: 'common-questions-about-rrm', title: 'Common Questions About RRM' },
  { slug: 'endo-survey', title: 'Endometriosis Survey' },
  { slug: 'endo-survey-take', title: 'Take the Endometriosis Survey' },
  { slug: 'save-the-uterus-club', title: 'Save the Uterus Club' },
  { slug: 'save-the-uterus-club-thank-you', title: 'Welcome to Save the Uterus Club' },
  { slug: '404', title: 'Page Not Found' },
];
```

This is the canonical source. When a page title changes, update this registry.

**Dynamic pages** -- read from JSON data files at build time:

- FAQs: `src/data/faqs.json` -- use the `question` field as title, `slug` field for filename

## Slug Derivation

```
function routeToSlug(path):
  if path === '/':  return 'homepage'
  strip leading/trailing slashes
  replace all '/' with '-'
  return result
```

Examples:
- `/` -> `homepage`
- `/about` -> `about`
- `/donate/thank-you` -> `donate-thank-you`
- `/faqs/what-is-rrm` -> `faqs-what-is-rrm`
- `/endo-survey/take` -> `endo-survey-take`

Output filename: `og-{slug}.png`

## Pagination: Parent Image Reuse

Pagination pages (`/library/page/2`, `/commentary/page/3`, etc.) do **not** get unique OG images. They reuse the parent index page's image:

- `/library/page/*` -> uses `og-library.png`
- `/commentary/page/*` -> uses `og-commentary.png`

BaseLayout detects pagination URLs and resolves to the parent slug. This avoids generating 64+ library pagination images and ~1 commentary pagination image that add no social sharing value.

## File Management

**Gitignored.** Add to `.gitignore`:
```
public/images/og/og-*.png
```

The existing `og-default.png` stays committed (it is the fallback). All generated `og-*.png` files are ephemeral -- regenerated every build in CI and locally. This prevents git bloat from binary churn.

**Existing manually-created PNGs** (`homepage.png`, `about.png`, `courses.png`, `commentary.png`) in `public/images/og/` will be deleted in Phase 2 once convention-based naming takes over.

## Wiring to BaseLayout

BaseLayout already accepts an `ogImage` prop and falls back to `og-default.png`.

**Approach: convention-based resolution.** BaseLayout derives the expected OG image path from the current page URL using the same slug algorithm. No per-page prop changes needed for new pages.

### Resolution Order in BaseLayout

1. Explicit `ogImage` prop (if set) -- used as-is (commentary posts, course detail pages)
2. Convention path `/images/og/og-{slug}.png` -- used for all other pages
3. For pagination URLs, resolve to parent: `/library/page/5` -> `/images/og/og-library.png`
4. Fallback to `/images/og-default.png`

Since the pre-build script generates all images before `astro build`, the convention path will always resolve for included pages.

### Existing Explicit Props

These pages currently set `ogImage` explicitly and will be migrated to convention in Phase 2:

| Page | Current explicit prop | Action |
|------|----------------------|--------|
| `/` | `/images/og/homepage.png` | Remove prop, convention resolves to `og-homepage.png` |
| `/about` | `/images/og/about.png` | Remove prop, convention resolves to `og-about.png` |
| `/courses` (index) | `/images/og/courses.png` | Remove prop, convention resolves to `og-courses.png` |
| `/commentary` (index) | `/images/og/commentary.png` | Remove prop, convention resolves to `og-commentary.png` |
| `/naprotechnology` | `/images/naprotechnology/og-naprotechnology.png` | Remove prop, convention resolves to `og-naprotechnology.png` |

## Build Warnings

The generation script maintains a `KNOWN_EXCLUDED` set of route patterns (library/[slug], commentary/[slug], courses/[slug], admin/*, linkinbio/*, account/*, login, signup, forgot-password, reset-password, library/saved, community/post/[id], courses/[slug]/[stepId]).

After generating all images, the script compares the generated slug set against the Astro page manifest (parsed from `src/pages/`). Any page that is:
- Not in the generated set, AND
- Not in `KNOWN_EXCLUDED`

...produces a build warning: `⚠ No OG image for /new-page -- add to STATIC_PAGES or KNOWN_EXCLUDED`.

This catches forgotten pages without breaking the build.

## Excluded Pages

| Route | Reason |
|-------|--------|
| `/library/[slug]` | 3,200+ synopsis pages, excluded per requirement |
| `/commentary/[slug]` | Already use Airtable cover images |
| `/courses/[slug]` | Already use course cover images |
| `/courses/[slug]/[stepId]` | Lesson player, not independently shared |
| `/admin/*` | Internal, not shared socially |
| `/linkinbio/*` | Already have custom OG tags hardcoded |
| `/account/*` | Auth-gated, not shared socially |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Auth flow pages, rarely shared |
| `/library/saved` | Auth-gated, not shared socially |
| `/community/post/[id]` | User-generated content, no meaningful title for OG |
| `/library/page/*`, `/commentary/page/*` | Reuse parent index OG image |

## Included Pages (~23 static + ~25 dynamic FAQs)

**Static:**
`/`, `/about`, `/contact`, `/donate`, `/donate/thank-you`, `/faqs`, `/library` (index), `/commentary` (index), `/courses` (index), `/community`, `/community/events`, `/community/members`, `/terms-of-use`, `/privacy-policy`, `/medical-disclaimer`, `/what-is-rrm`, `/naprotechnology`, `/common-questions-about-rrm`, `/endo-survey`, `/endo-survey/take`, `/save-the-uterus-club`, `/save-the-uterus-club/thank-you`, `/404`

**Dynamic (from data):**
- All individual FAQ pages (`/faqs/[slug]`) -- title from faqs.json `question` field (~25 currently)

## Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `satori` | JSX to SVG rendering | Handles text layout, font embedding, line wrapping |
| `@resvg/resvg-js` | SVG to PNG conversion | Uses platform-specific N-API bindings. Build-time only, works on macOS (dev) and Linux (CI) |

Both are devDependencies.

## Rollout Strategy

**Phase 1 (test on 1 page):** Generate OG image for `/about` only. Wire convention-based resolution into BaseLayout. Verify the template looks good, the build integration works, and the `og:image` meta tag is correct. Validate with opengraph.xyz after deploy.

**Phase 2 (all pages):** Expand to full page registry. Remove existing explicit `ogImage` props. Delete old manually-created PNGs. Enable build warnings.

## Build Impact

- ~48 images total (23 static + 25 FAQs)
- Satori + resvg per image: ~50-100ms
- Total added build time: ~3-5 seconds
- Image size: ~30-80KB each (flat background, text only)
- Images are gitignored, so no repo size impact

## Supersedes

This spec replaces the old Playwright screenshot approach documented in `docs/superpowers/plans/2026-03-09-page-specific-og-images.md` (now obsolete).
