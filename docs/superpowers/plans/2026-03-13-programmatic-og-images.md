# Programmatic OG Images Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate page-specific OG images at build time using Satori (SVG) + resvg (PNG), wired into BaseLayout via URL convention.

**Architecture:** A pre-build Node script reads a static page registry + FAQ data, renders each title onto a branded SVG template via Satori, converts to PNG via resvg, and writes to `public/images/og/`. BaseLayout derives the OG image path from the page URL using the same slug convention. Phase 1 tests on `/about` only; Phase 2 expands to all pages.

**Tech Stack:** satori, @resvg/resvg-js (devDependencies), Astro BaseLayout (convention wiring)

**Spec:** `docs/superpowers/specs/2026-03-13-programmatic-og-images-design.md`

---

## File Structure

```
scripts/generate-og-images.mjs     # Pre-build script: page registry + Satori + resvg
scripts/og-template.js             # JSX template function (returns Satori-compatible JSX)
src/layouts/BaseLayout.astro       # Modify: convention-based OG image resolution
.gitignore                         # Modify: add public/images/og/og-*.png
package.json                       # Modify: prepend OG script to build command
```

---

## Chunk 1: Foundation (Phase 1 -- single page test)

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install satori and resvg-js as devDependencies**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm install --save-dev satori @resvg/resvg-js
```

- [ ] **Step 2: Verify installation**

```bash
node -e "const s = await import('satori'); const r = await import('@resvg/resvg-js'); console.log('satori:', typeof s.default, 'resvg:', typeof r.Resvg)"
```

Expected: `satori: function resvg: function`

### Task 2: Create the OG template

**Files:**
- Create: `scripts/og-template.js`

- [ ] **Step 1: Write the template function**

This function returns a Satori-compatible JSX object (using React-like `createElement` syntax since we're in plain Node, not JSX). The template renders: warm paper background, dynamic title, purple accent line, "RRM Academy" wordmark.

```js
// scripts/og-template.js
// Satori JSX template for OG images
// Returns a React-element-like object for satori to render

/**
 * @param {string} title - Page title to render
 * @returns {object} Satori-compatible JSX element
 */
export function ogTemplate(title) {
  const len = title.length;
  const fontSize = len <= 30 ? 56 : len <= 60 ? 44 : len <= 80 ? 36 : 30;

  return {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        backgroundColor: '#f7f5f3',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '60px',
        fontFamily: 'Cormorant Garamond',
      },
      children: [
        // Title area
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              justifyContent: 'center',
              overflow: 'hidden',
            },
            children: {
              type: 'div',
              props: {
                style: {
                  fontSize: `${fontSize}px`,
                  fontWeight: 600,
                  color: '#313131',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                },
                children: title,
              },
            },
          },
        },
        // Accent line
        {
          type: 'div',
          props: {
            style: {
              width: '100%',
              height: '2px',
              backgroundColor: '#725e7e',
              marginBottom: '20px',
            },
            children: [],
          },
        },
        // Wordmark
        {
          type: 'div',
          props: {
            style: {
              fontSize: '24px',
              fontWeight: 600,
              color: '#725e7e',
              display: 'flex',
            },
            children: 'RRM Academy',
          },
        },
      ],
    },
  };
}
```

- [ ] **Step 2: Verify template loads**

```bash
node -e "import('./scripts/og-template.js').then(m => { const el = m.ogTemplate('Test Title'); console.log(el.type, el.props.children.length) })"
```

Expected: `div 3`

### Task 3: Create the generation script (Phase 1 -- about only)

**Files:**
- Create: `scripts/generate-og-images.mjs`

- [ ] **Step 1: Write the generation script**

```js
// scripts/generate-og-images.mjs
// Pre-build script: generates OG images for all registered pages
// Usage: node scripts/generate-og-images.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { ogTemplate } from './og-template.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'images', 'og');

// --- Page Registry ---
// Phase 1: just /about for testing
// Phase 2: expand to all static pages + FAQ data
const STATIC_PAGES = [
  { slug: 'about', title: 'About RRM Academy' },
];

// --- Font Loading ---
function loadFont(filename) {
  const fontPath = join(ROOT, 'node_modules', '@fontsource', 'cormorant-garamond', 'files', filename);
  return readFileSync(fontPath);
}

// --- Main ---
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const cormorant600 = loadFont('cormorant-garamond-latin-600-normal.woff');

  const fonts = [
    { name: 'Cormorant Garamond', data: cormorant600, weight: 600, style: 'normal' },
  ];

  // Collect all pages to generate
  const pages = [...STATIC_PAGES];

  // TODO Phase 2: read faqs.json and add FAQ pages

  console.log(`Generating ${pages.length} OG image(s)...`);
  let generated = 0;

  for (const page of pages) {
    const filename = `og-${page.slug}.png`;
    const outPath = join(OUT_DIR, filename);

    const svg = await satori(ogTemplate(page.title), {
      width: 1200,
      height: 630,
      fonts,
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    });
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();

    writeFileSync(outPath, pngBuffer);
    generated++;
  }

  console.log(`✓ Generated ${generated} OG image(s) in public/images/og/`);
}

main().catch(err => {
  console.error('OG image generation failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script and verify output**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && node scripts/generate-og-images.mjs
```

Expected: `✓ Generated 1 OG image(s) in public/images/og/`

- [ ] **Step 3: Verify the generated image**

```bash
sips -g pixelWidth -g pixelHeight public/images/og/og-about.png && ls -lh public/images/og/og-about.png
```

Expected: 1200x630, under 300KB.

- [ ] **Step 4: Open the image and visually verify**

```bash
open public/images/og/og-about.png
```

Check: title text is readable in Cormorant Garamond, purple accent line visible, "RRM Academy" wordmark at bottom, warm paper background.

### Task 4: Wire convention-based resolution into BaseLayout

**Files:**
- Modify: `src/layouts/BaseLayout.astro:58-64`

- [ ] **Step 1: Read BaseLayout to confirm current OG resolution code**

Read `src/layouts/BaseLayout.astro` lines 58-68. Current code:

```js
const resolvedOgImage = ogImage
  ? (ogImage.startsWith('http') ? ogImage : `${siteOrigin}${ogImage}`)
  : `${siteOrigin}/images/og-default.png`;
```

- [ ] **Step 2: Add convention-based slug derivation and resolution**

Replace the `resolvedOgImage` assignment (lines 62-64) with:

```js
// Convention-based OG image: derive slug from URL path
function routeToOgSlug(pathname) {
  if (pathname === '/' || pathname === '') return 'homepage';
  // Pagination pages reuse parent index image
  const paginationMatch = pathname.match(/^\/(library|commentary)\/page\/\d+\/?$/);
  if (paginationMatch) return paginationMatch[1];
  return pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-');
}
const ogSlug = routeToOgSlug(Astro.url.pathname);
const conventionOgPath = `/images/og/og-${ogSlug}.png`;
const resolvedOgImage = ogImage
  ? (ogImage.startsWith('http') ? ogImage : `${siteOrigin}${ogImage}`)
  : `${siteOrigin}${conventionOgPath}`;
```

This keeps the existing explicit `ogImage` prop as highest priority. Pages without the prop get the convention path. Pages without a generated image (login, admin, etc.) get a convention path that 404s -- social crawlers handle missing images gracefully by showing no preview, which is fine for auth/admin pages that are never shared socially.

- [ ] **Step 3: Verify the about page uses the convention path**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run dev &
sleep 3
curl -s http://localhost:3000/about/ | grep 'og:image'
kill %1
```

Expected: `<meta property="og:image" content="https://rrmacademy.org/images/og/og-about.png" />`

**Note:** The about page currently has an explicit `ogImage="/images/og/about.png"` prop. That will still take precedence in Phase 1. The convention path kicks in for pages **without** an explicit prop. We'll remove the explicit prop in Phase 2.

To test the convention path in Phase 1, check a page that does NOT have an explicit ogImage prop, like `/contact`:

```bash
curl -s http://localhost:3000/contact/ | grep 'og:image'
```

Expected: `<meta property="og:image" content="https://rrmacademy.org/images/og/og-contact.png" />`

### Task 5: Gitignore generated images

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add gitignore entry for generated OG images**

Append to `.gitignore`:

```
# Generated OG images (rebuilt every deploy)
public/images/og/og-*.png
```

This preserves `og-default.png` (no `og-` prefix) while ignoring all generated images.

- [ ] **Step 2: Verify the pattern works**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && git status public/images/og/
```

Expected: `og-about.png` should NOT appear as untracked (gitignored).

### Task 6: Wire build script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Prepend OG generation to the build command**

Change `package.json` `scripts.build` from:
```json
"build": "astro build && npx pagefind --site dist",
```
To:
```json
"build": "node scripts/generate-og-images.mjs && astro build && npx pagefind --site dist",
```

- [ ] **Step 2: Test the full build**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf && npm run build
```

Expected: OG generation runs first, then Astro build, then Pagefind. No errors.

- [ ] **Step 3: Verify the about OG image is in the build output**

```bash
ls -lh dist/images/og/og-about.png && sips -g pixelWidth -g pixelHeight dist/images/og/og-about.png
```

Expected: File exists, 1200x630.

### Task 7: Phase 1 commit

- [ ] **Step 1: Commit Phase 1**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add scripts/og-template.js scripts/generate-og-images.mjs src/layouts/BaseLayout.astro .gitignore package.json package-lock.json
git commit -m "feat: programmatic OG images (Phase 1 -- about page only)

Adds Satori + resvg build-time OG image generation.
Convention-based resolution in BaseLayout derives OG path from URL.
Phase 1 generates only /about for validation."
```

---

## Chunk 2: Full Rollout (Phase 2)

### Task 8: Expand page registry to all pages

**Files:**
- Modify: `scripts/generate-og-images.mjs`

- [ ] **Step 1: Add full static page registry**

Replace the `STATIC_PAGES` array in `scripts/generate-og-images.mjs` with:

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
  { slug: 'guides', title: 'Guides' },
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

- [ ] **Step 2: Add FAQ page generation from data**

After `const pages = [...STATIC_PAGES];`, add:

```js
// Load FAQ data and add individual FAQ pages
const faqsPath = join(ROOT, 'src', 'data', 'faqs.json');
if (existsSync(faqsPath)) {
  const faqs = JSON.parse(readFileSync(faqsPath, 'utf-8'));
  for (const faq of faqs) {
    pages.push({
      slug: `faqs-${faq.slug}`,
      title: faq.question,
    });
  }
} else {
  console.warn('⚠ faqs.json not found, skipping FAQ OG images');
}
```

- [ ] **Step 3: Run and verify full generation**

```bash
node scripts/generate-og-images.mjs
```

Expected: `✓ Generated ~49 OG image(s) in public/images/og/` (24 static + ~25 FAQs)

- [ ] **Step 4: Spot-check a few images**

```bash
open public/images/og/og-homepage.png public/images/og/og-what-is-rrm.png public/images/og/og-faqs-what-is-restorative-reproductive-medicine-rrm.png
```

Check: short title (homepage) uses large font, long FAQ question uses smaller font, all readable.

### Task 9: Add build warnings for unregistered pages

**Files:**
- Modify: `scripts/generate-og-images.mjs`

- [ ] **Step 1: Add known-excluded set and warning logic**

Add after the image generation loop, before the final success log:

```js
// --- Build Warnings ---
// Warn about pages that have no OG image and aren't in the known-excluded list
// Dynamic route files ([slug].astro etc.) are already skipped by scanPages.
// This set covers static .astro files that intentionally have no OG image.
const KNOWN_EXCLUDED = new Set([
  'admin/*',                  // Internal admin pages
  'linkinbio',                // Custom OG tags hardcoded
  'linkinbio/jointhecall',    // Custom OG tags hardcoded
  'account/',                 // Auth-gated
  'login',                    // Auth flow
  'signup',                   // Auth flow
  'forgot-password',          // Auth flow
  'reset-password',           // Auth flow
  'library/saved',            // Auth-gated
  'community/archive/*',      // Archive pages
]);

const generatedSlugs = new Set(pages.map(p => p.slug));

// Scan src/pages/ for .astro files and derive their slugs
function scanPages(dir, prefix = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  const routes = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...scanPages(fullPath, prefix + entry.name + '/'));
    } else if (entry.name.endsWith('.astro')) {
      // Skip dynamic route files (e.g. [...slug].astro, [page].astro)
      // These are either generated from data (FAQs) or excluded
      if (entry.name.includes('[')) continue;
      const route = prefix + entry.name.replace(/\.astro$/, '').replace(/index$/, '').replace(/\/$/, '');
      routes.push(route);
    }
  }
  return routes;
}

const pagesDir = join(ROOT, 'src', 'pages');
const allRoutes = scanPages(pagesDir);

for (const route of allRoutes) {
  // Check if excluded
  const isExcluded = [...KNOWN_EXCLUDED].some(pattern => {
    if (pattern.endsWith('/*')) return route.startsWith(pattern.slice(0, -2));
    return route === pattern;
  });
  if (isExcluded) continue;

  // Derive what the slug would be
  const slug = route === '' ? 'homepage' : route.replace(/\//g, '-');

  if (!generatedSlugs.has(slug)) {
    console.warn(`⚠ No OG image for /${route} — add to STATIC_PAGES or KNOWN_EXCLUDED`);
  }
}
```

- [ ] **Step 2: Run and verify no warnings for current pages**

```bash
node scripts/generate-og-images.mjs
```

Expected: no warnings (all pages are either generated or excluded).

### Task 10: Remove explicit ogImage props from migrated pages

**Files:**
- Modify: `src/pages/index.astro` (remove `ogImage="/images/og/homepage.png"`)
- Modify: `src/pages/about.astro` (remove `ogImage="/images/og/about.png"`)
- Modify: `src/pages/courses/index.astro` (remove `ogImage="/images/og/courses.png"`)
- Modify: `src/pages/commentary/index.astro` (remove `ogImage="/images/og/commentary.png"`)
- Modify: `src/pages/naprotechnology/index.astro` (remove `ogImage="/images/naprotechnology/og-naprotechnology.png"`)

- [ ] **Step 1: Read each file and remove the ogImage prop**

For each file, find and remove the `ogImage="..."` line from the `<BaseLayout>` tag. The convention-based resolution in BaseLayout will now handle these pages.

- [ ] **Step 2: Delete old manually-created OG images**

```bash
rm public/images/og/homepage.png public/images/og/about.png public/images/og/courses.png public/images/og/commentary.png public/images/naprotechnology/og-naprotechnology.png
```

- [ ] **Step 3: Verify convention paths resolve correctly**

```bash
npm run dev &
sleep 3
for path in "/" "/about/" "/courses/" "/commentary/" "/naprotechnology/"; do
  echo "=== $path ==="
  curl -s "http://localhost:3000$path" | grep 'og:image'
done
kill %1
```

Expected:
- `/` -> `og-homepage.png`
- `/about/` -> `og-about.png`
- `/courses/` -> `og-courses.png`
- `/commentary/` -> `og-commentary.png`
- `/naprotechnology/` -> `og-naprotechnology.png`

### Task 11: Full build validation

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: clean build, no errors, no warnings.

- [ ] **Step 2: Verify OG tags in built HTML**

```bash
for page in index.html about/index.html courses/index.html commentary/index.html faqs/index.html contact/index.html; do
  echo "=== $page ==="
  grep 'og:image' "dist/$page"
done
```

Expected: each shows its unique `/images/og/og-{slug}.png` path.

- [ ] **Step 3: Verify a FAQ page**

```bash
grep 'og:image' dist/faqs/what-is-restorative-reproductive-medicine-rrm/index.html
```

Expected: `og-faqs-what-is-restorative-reproductive-medicine-rrm.png`

- [ ] **Step 4: Verify pagination uses parent image**

```bash
grep 'og:image' dist/library/page/2/index.html
```

Expected: `og-library.png`

- [ ] **Step 5: Verify excluded pages still get convention path (not broken)**

```bash
grep 'og:image' dist/login/index.html
```

Expected: `og-login.png` (file won't exist, but the tag is there -- that's fine, social crawlers handle missing images gracefully).

### Task 12: Phase 2 commit

- [ ] **Step 1: Commit Phase 2**

```bash
cd /Users/brian/iCode/projects/rrm-academy-cf
git add scripts/generate-og-images.mjs src/pages/index.astro src/pages/about.astro src/pages/courses/index.astro src/pages/commentary/index.astro src/pages/naprotechnology/index.astro .gitignore
git commit -m "feat: programmatic OG images (Phase 2 -- all pages)

Expands OG generation to 24 static pages + all FAQs.
Removes manual ogImage props, convention-based resolution handles all pages.
Build warnings for unregistered pages. Pagination reuses parent image."
```

---

## Chunk 3: Post-Deploy Validation

### Task 13: Deploy and validate with social preview tools

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Wait for deploy, then validate OG images with external tools**

After deploy completes, test key pages:

```bash
# Quick check via curl
for page in "/" "/about/" "/faqs/" "/faqs/what-is-restorative-reproductive-medicine-rrm/" "/courses/" "/what-is-rrm/"; do
  echo "=== $page ==="
  curl -s -A facebookexternalhit "https://rrmacademy.org$page" | grep 'og:image'
done
```

Then manually check 2-3 pages at https://opengraph.xyz to verify the images render correctly in social previews.

- [ ] **Step 3: Force Facebook cache refresh for key pages**

Facebook caches OG images aggressively. For pages that previously had different OG images, scrape them via the Facebook Sharing Debugger at https://developers.facebook.com/tools/debug/ -- paste each URL and click "Scrape Again".

Key pages to re-scrape: homepage, about, courses index, commentary index, naprotechnology.
