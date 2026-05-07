# Page-Specific OG Images Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give high-traffic pages unique Open Graph images by screenshotting each page's hero section in mobile view.

**Architecture:** Use Playwright to screenshot the hero section of each page at mobile width, crop/resize to 1200x630, store in `public/images/og/`. Wire into the existing `ogImage` prop on `BaseLayout.astro`. No new dependencies -- the plumbing already exists.

**Tech Stack:** Playwright (screenshot capture), sips (resize/crop on macOS), Astro (prop wiring only)

---

## Current State

| Page | OG Image Today | Priority |
|------|---------------|----------|
| `/` (homepage) | `og-default.png` (generic) | **High** |
| `/courses` (catalog) | `og-default.png` | **High** |
| `/commentary` (blog index) | `og-default.png` | **Medium** |
| `/about` | `og-default.png` | **Medium** |
| `/commentary/[slug]` (posts) | Cover image from Airtable | Already done |
| `/courses/[slug]` (detail) | Course image from data | Already done |

## File Structure

```
public/images/og/
  homepage.png          # 1200x630 -- mobile hero screenshot of /
  courses.png           # 1200x630 -- mobile hero screenshot of /courses
  commentary.png        # 1200x630 -- mobile hero screenshot of /commentary
  about.png             # 1200x630 -- mobile hero screenshot of /about
```

Pages modified (one-line change each):
- `src/pages/index.astro`
- `src/pages/courses/index.astro`
- `src/pages/commentary/index.astro`
- `src/pages/about.astro`

## Screenshot Spec

- **Source:** Live dev server at `http://localhost:3000`
- **Viewport:** Mobile width (390px, iPhone 14 equivalent), device scale factor 2x
- **Capture area:** Hero section only (header + hero, no content below)
- **Output:** 1200x630px PNG, < 300 KB each
- **No header hiding** -- include the site header, it reinforces brand

**Hero selectors per page:**

| Page | Hero Element | Approx Hero Height |
|------|-------------|-------------------|
| `/` | `header.hp-hero` | Full viewport (`100vh - 56px`), includes trust bar |
| `/courses` | `section.courses-hero` | ~200px (heading + subtitle) |
| `/commentary` | `section.commentary-hero` | ~200px (heading + subtitle) |
| `/about` | `section.about-hero` | ~180px (heading + tagline) |

**Strategy:** Screenshot the full visible viewport at mobile width. For homepage, the hero fills the screen naturally. For shorter heroes (courses, commentary, about), capture header + hero + a bit of the content below to fill 1200x630 -- this is fine since it gives context about the page.

---

## Chunk 1: Capture OG Screenshots

### Task 1: Start dev server and create output directory

- [ ] **Step 1: Create output directory**

```bash
mkdir -p public/images/og
```

- [ ] **Step 2: Start the Astro dev server**

The site needs article data to build. If `src/data/articles.json` exists, just run:
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run dev
```
Dev server runs on port 3000.

If data files are missing, fetch first:
```bash
AIRTABLE_PAT=$(op read 'op://Automation/<redacted>/credential') npm run fetch-all
npm run dev
```

### Task 2: Capture mobile hero screenshots with Playwright

**Approach:** Use Playwright MCP to navigate to each page in a mobile viewport, then take a screenshot. The viewport should be set to 390x844 (iPhone 14) with device scale factor 2, which gives us a high-res capture.

Since OG images must be 1200x630 (roughly 1.9:1 ratio), and mobile screenshots are tall/narrow (roughly 1:2.16), we need to:
1. Set viewport to **630x630** (square-ish, wider than typical mobile but still "mobile feel")
   - This gives us a 1:1 raw screenshot
   - Actually, better: set viewport to **600x630** at 2x scale = 1200x1260 raw pixels
   - Then crop the top 1200x630 (the hero portion)
2. OR: Set viewport to **1200x630** directly (tablet-ish) but that loses the "mobile" feel

**Recommended:** Viewport **600x630**, device scale factor 2x. Raw screenshot = 1200x1260px. Crop top half = 1200x630px. This captures the hero at mobile layout but at OG image dimensions.

- [ ] **Step 1: Navigate to homepage and screenshot**

Using Playwright MCP:
1. Set viewport to 600x630 (if resize is available)
2. Navigate to `http://localhost:3000/`
3. Wait for page load
4. Take screenshot, save to `/Users/brian/iCode/projects/rrm-academy-cf/public/images/og/homepage-raw.png`

- [ ] **Step 2: Navigate to courses and screenshot**

1. Navigate to `http://localhost:3000/courses/`
2. Take screenshot, save to `/Users/brian/iCode/projects/rrm-academy-cf/public/images/og/courses-raw.png`

- [ ] **Step 3: Navigate to commentary and screenshot**

1. Navigate to `http://localhost:3000/commentary/`
2. Take screenshot, save to `/Users/brian/iCode/projects/rrm-academy-cf/public/images/og/commentary-raw.png`

- [ ] **Step 4: Navigate to about and screenshot**

1. Navigate to `http://localhost:3000/about/`
2. Take screenshot, save to `/Users/brian/iCode/projects/rrm-academy-cf/public/images/og/about-raw.png`

### Task 3: Crop and optimize screenshots

- [ ] **Step 1: Crop each raw screenshot to 1200x630**

Using macOS `sips` (no extra dependencies):
```bash
cd /Users/brian/iCode/projects/rrm-academy-cf/public/images/og

# Crop to 1200x630 from top-left corner (keeps hero, cuts bottom)
for name in homepage courses commentary about; do
  sips --cropToHeightWidth 630 1200 "${name}-raw.png" --out "${name}.png"
done
```

If raw screenshots are not 1200px wide (Playwright didn't honor 2x scale), resize first:
```bash
for name in homepage courses commentary about; do
  sips --resampleWidth 1200 "${name}-raw.png" --out "${name}-resized.png"
  sips --cropToHeightWidth 630 1200 "${name}-resized.png" --out "${name}.png"
  rm "${name}-resized.png"
done
```

- [ ] **Step 2: Verify dimensions**

```bash
for f in homepage.png courses.png commentary.png about.png; do
  sips -g pixelWidth -g pixelHeight "$f"
done
```
Expected: All show 1200x630.

- [ ] **Step 3: Verify file sizes and compress if needed**

```bash
ls -lh homepage.png courses.png commentary.png about.png
```
Expected: Each < 300 KB. If larger:
```bash
# Install if needed: brew install pngquant
for f in homepage.png courses.png commentary.png about.png; do
  pngquant --quality=65-80 --output "$f" --force "$f"
done
```

- [ ] **Step 4: Clean up raw files**

```bash
rm -f *-raw.png
```

- [ ] **Step 5: Visual review**

Open each image to confirm it looks good:
```bash
open homepage.png courses.png commentary.png about.png
```

Check: hero text is readable, brand is clear, no awkward crops.

---

## Chunk 2: Wire OG Images Into Pages

### Task 4: Wire homepage OG image

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Read the file to find the BaseLayout call**

Read `src/pages/index.astro` and locate the `<BaseLayout` opening tag.

- [ ] **Step 2: Add ogImage prop**

Add `ogImage="/images/og/homepage.png"` to the BaseLayout props. Example:

```astro
<BaseLayout
  title="RRM Academy"
  description="..."
  ogImage="/images/og/homepage.png"
>
```

### Task 5: Wire courses index OG image

**Files:**
- Modify: `src/pages/courses/index.astro`

- [ ] **Step 1: Add ogImage prop to BaseLayout**

Add `ogImage="/images/og/courses.png"` to the BaseLayout props.

### Task 6: Wire commentary index OG image

**Files:**
- Modify: `src/pages/commentary/index.astro`

- [ ] **Step 1: Add ogImage prop to BaseLayout**

Add `ogImage="/images/og/commentary.png"` to the BaseLayout props.

### Task 7: Wire about page OG image

**Files:**
- Modify: `src/pages/about.astro`

- [ ] **Step 1: Add ogImage prop to BaseLayout**

Add `ogImage="/images/og/about.png"` to the BaseLayout props.

### Task 8: Verify all wiring via dev server

- [ ] **Step 1: Check og:image tags**

```bash
for path in "/" "/courses/" "/commentary/" "/about/"; do
  echo "=== $path ===" && curl -s "http://localhost:3000$path" | grep 'og:image'
done
```
Expected: Each shows its unique `/images/og/*.png` path resolved to `https://rrmacademy.org/images/og/*.png`.

### Task 9: Commit all changes

- [ ] **Step 1: Stage and commit**

```bash
git add public/images/og/ src/pages/index.astro src/pages/courses/index.astro src/pages/commentary/index.astro src/pages/about.astro
git commit -m "feat: add page-specific OG images (mobile hero screenshots)"
```

---

## Chunk 3: Validate

### Task 10: Full build validation

- [ ] **Step 1: Build the site**

```bash
npm run build
```
Expected: Clean build, no errors.

- [ ] **Step 2: Verify all 4 pages have correct og:image in built output**

```bash
for page in index.html courses/index.html commentary/index.html about/index.html; do
  echo "=== $page ===" && grep 'og:image' "dist/$page"
done
```
Expected: Each shows its unique `/images/og/*.png` path.

- [ ] **Step 3: Verify remaining pages still use default**

```bash
grep 'og:image' dist/faqs/index.html
```
Expected: Still shows `/images/og-default.png`.

- [ ] **Step 4: Post-deploy -- test with OG validators**

After deploy, validate with:
- https://developers.facebook.com/tools/debug/ (paste each URL, hit "Scrape Again")
- https://opengraph.xyz (paste each URL for preview)
- Or: `curl -s -A facebookexternalhit https://rrmacademy.org/ | grep 'og:image'`

Note: Social platforms cache OG images aggressively (~30 days). If you later update an image at the same path, re-scrape via the Facebook debugger to bust the cache.

---

## Future Expansion (Out of Scope)

- **Donate, FAQs, endo survey, STUC** -- add OG images when these pages get more social traffic
- **Library articles** -- would require dynamic OG image generation (e.g., Satori/`@vercel/og` at build time for 3,200+ articles). Separate project
- **Blog posts** -- already handled via Airtable cover images
- **Automated refresh** -- if page designs change significantly, re-run the screenshot process. Could be scripted as a Playwright test
