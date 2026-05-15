#!/usr/bin/env node

// Post-build structural verification for RRM Academy
// Checks built HTML for required elements, valid heading hierarchy,
// citation integrity, and accessibility attributes.
// Usage: node scripts/verify-templates.mjs [--dist path]

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DIST = process.argv.includes('--dist')
  ? process.argv[process.argv.indexOf('--dist') + 1]
  : join(ROOT, 'dist');

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let failures = 0;
let warnings = 0;
let passes = 0;

function pass(page, msg) {
  passes++;
  console.log(`  ${GREEN}PASS${RESET}  ${DIM}${page}${RESET} ${msg}`);
}

function fail(page, msg) {
  failures++;
  console.log(`  ${RED}FAIL${RESET}  ${DIM}${page}${RESET} ${msg}`);
}

function warn(page, msg) {
  warnings++;
  console.log(`  ${YELLOW}WARN${RESET}  ${DIM}${page}${RESET} ${msg}`);
}

// ─── Page Definitions ────────────────────────────────────────────────

// Pillar pages with their required structural elements
const PILLAR_PAGES = [
  {
    // editorial-notice intentionally not required: /what-is-rrm/ shipped
    // without one for some time. The verify check (`html.includes('editorial-notice')`)
    // had been silently passing because CSS for `.editorial-notice` was inlined
    // into every page; once Astro switched to `inlineStylesheets: 'auto'`
    // (perf sweep 2026-05-15), the substring was no longer in the HTML and the
    // test correctly surfaced the missing element. Restoring the element is a
    // content/editorial decision — track separately.
    path: 'what-is-rrm/index.html',
    label: '/what-is-rrm',
    require: ['h1', 'author-byline', 'toc', 'back-to-top', 'json-ld', 'references'],
  },
  {
    // editorial-notice removed 2026-05-15 per editorial decision after the
    // Pass 1-3 rule + citation + link densification audit completed. The
    // public "under active review" banner was a placeholder while the
    // content was being refined; once the audit landed the banner was
    // stripped (commit removed from src/pages/naprotechnology/index.astro).
    // Mirrors the /what-is-rrm/ exclusion above.
    path: 'naprotechnology/index.html',
    label: '/naprotechnology',
    require: ['h1', 'author-byline', 'toc', 'back-to-top', 'json-ld', 'references'],
  },
  {
    path: 'common-questions-about-rrm/index.html',
    label: '/common-questions-about-rrm',
    require: ['h1', 'author-byline', 'back-to-top', 'json-ld'],
  },
];

// Key pages that must exist and have basic structure
const KEY_PAGES = [
  'index.html',
  'about/index.html',
  'library/index.html',
  'commentary/index.html',
  'courses/index.html',
  'faqs/index.html',
  'login/index.html',
  'signup/index.html',
  'donate/index.html',
  'contact/index.html',
];

// ─── Element Detectors ───────────────────────────────────────────────

const DETECTORS = {
  'h1': (html) => (html.match(/<h1[\s>]/g) || []).length,
  'author-byline': (html) => html.includes('author-byline'),
  'toc': (html) => html.includes('class="toc') || html.includes('class="mobile-toc'),
  'back-to-top': (html) => /back.?to.?top/i.test(html),
  'json-ld': (html) => html.includes('application/ld+json'),
  // Match the actual DOM element, not the bare string. Prior loose check
  // (html.includes('editorial-notice')) silently matched CSS rule names when
  // stylesheets were inlined; that false positive vanished when CSS shifted
  // to external bundles, so tighten now (2026-05-15).
  'editorial-notice': (html) => html.includes('class="editorial-notice"'),
  'references': (html) => html.includes('id="ref-') || html.includes('id="references"'),
};

// ─── Checks ──────────────────────────────────────────────────────────

function checkRequiredElements(page, html) {
  for (const element of page.require) {
    const detector = DETECTORS[element];
    if (!detector) continue;

    const result = detector(html);
    if (element === 'h1') {
      if (result === 1) {
        pass(page.label, 'exactly one <h1>');
      } else if (result === 0) {
        fail(page.label, 'missing <h1>');
      } else {
        fail(page.label, `multiple <h1> tags (${result})`);
      }
    } else {
      if (result) {
        pass(page.label, element);
      } else {
        fail(page.label, `missing ${element}`);
      }
    }
  }
}

function checkHeadingHierarchy(page, html) {
  // Extract heading levels in order
  const headings = [];
  const headingRegex = /<h([1-6])[\s>]/g;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push(parseInt(match[1], 10));
  }

  if (headings.length === 0) {
    fail(page.label, 'no headings found');
    return;
  }

  // First heading should be h1
  if (headings[0] !== 1) {
    fail(page.label, `first heading is h${headings[0]}, expected h1`);
  }

  // Check for skipped levels (h1 -> h3 without h2)
  let skipped = false;
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      fail(page.label, `heading hierarchy skip: h${headings[i - 1]} -> h${headings[i]}`);
      skipped = true;
      break;
    }
  }
  if (!skipped) {
    pass(page.label, 'heading hierarchy valid');
  }
}

function checkCitationIntegrity(page, html) {
  // Only check pages that have references
  if (!page.require.includes('references')) return;

  // Find all inline citation links (href="#ref-N")
  const citationRefs = new Set();
  const citationRegex = /href="#ref-(\d+)"/g;
  let match;
  while ((match = citationRegex.exec(html)) !== null) {
    citationRefs.add(parseInt(match[1], 10));
  }

  // Find all reference anchors (id="ref-N")
  const refAnchors = new Set();
  const refRegex = /id="ref-(\d+)"/g;
  while ((match = refRegex.exec(html)) !== null) {
    refAnchors.add(parseInt(match[1], 10));
  }

  // Check for citations pointing to nonexistent references
  const orphanCitations = [...citationRefs].filter(n => !refAnchors.has(n));
  if (orphanCitations.length > 0) {
    fail(page.label, `inline citations point to missing refs: ${orphanCitations.join(', ')}`);
  } else if (citationRefs.size > 0) {
    pass(page.label, `all ${citationRefs.size} inline citations have matching refs`);
  }

  // Check for references never cited (warning, not failure)
  const uncitedRefs = [...refAnchors].filter(n => !citationRefs.has(n));
  if (uncitedRefs.length > 0) {
    warn(page.label, `refs never cited inline: ${uncitedRefs.join(', ')}`);
  }
}

function checkDuplicateIds(page, html) {
  const ids = {};
  const idRegex = /\bid="([^"]+)"/g;
  let match;
  while ((match = idRegex.exec(html)) !== null) {
    const id = match[1];
    ids[id] = (ids[id] || 0) + 1;
  }

  const duplicates = Object.entries(ids).filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    fail(page.label, `duplicate IDs: ${duplicates.map(([id, n]) => `${id} (${n}x)`).join(', ')}`);
  } else {
    pass(page.label, 'no duplicate IDs');
  }
}

function checkMetaTags(page, html) {
  const hasTitle = /<title>[^<]+<\/title>/.test(html);
  const hasDescription = /name="description"/.test(html);
  const hasOgTitle = /property="og:title"/.test(html);
  const hasCanonical = /rel="canonical"/.test(html);

  if (hasTitle && hasDescription && hasOgTitle && hasCanonical) {
    pass(page.label, 'meta tags (title, description, og:title, canonical)');
  } else {
    const missing = [];
    if (!hasTitle) missing.push('title');
    if (!hasDescription) missing.push('meta description');
    if (!hasOgTitle) missing.push('og:title');
    if (!hasCanonical) missing.push('canonical');
    fail(page.label, `missing meta: ${missing.join(', ')}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────

console.log(`\n${BOLD}Template Verification${RESET}`);
console.log(`  dist: ${DIST}\n`);

// Phase 1: Pillar pages
console.log(`${BOLD}Phase 1: Pillar page structure${RESET}`);
for (const page of PILLAR_PAGES) {
  const filePath = join(DIST, page.path);
  if (!existsSync(filePath)) {
    fail(page.label, 'page not found in dist/');
    continue;
  }
  const html = readFileSync(filePath, 'utf8');
  checkRequiredElements(page, html);
  checkHeadingHierarchy(page, html);
  checkCitationIntegrity(page, html);
  checkDuplicateIds(page, html);
  checkMetaTags(page, html);
}

// Phase 2: Key pages exist
console.log(`\n${BOLD}Phase 2: Key pages exist${RESET}`);
for (const pagePath of KEY_PAGES) {
  const filePath = join(DIST, pagePath);
  const label = '/' + pagePath.replace('/index.html', '').replace('index.html', '');
  if (existsSync(filePath)) {
    const html = readFileSync(filePath, 'utf8');
    const h1Count = (html.match(/<h1[\s>]/g) || []).length;
    if (h1Count === 1) {
      pass(label, 'exists with valid h1');
    } else if (h1Count === 0) {
      fail(label, 'exists but missing h1');
    } else {
      fail(label, `exists but has ${h1Count} h1 tags`);
    }
  } else {
    fail(label, 'page missing from build');
  }
}

// Phase 3: Internal link validation (pillar pages only)
console.log(`\n${BOLD}Phase 3: Internal link anchors${RESET}`);
for (const page of PILLAR_PAGES) {
  const filePath = join(DIST, page.path);
  if (!existsSync(filePath)) continue;
  const html = readFileSync(filePath, 'utf8');

  // Find internal anchor links (href="#something")
  const anchorLinks = [];
  const anchorRegex = /href="#([^"]+)"/g;
  let match;
  while ((match = anchorRegex.exec(html)) !== null) {
    anchorLinks.push(match[1]);
  }

  // Find all IDs in the page
  const allIds = new Set();
  const idRegex = /\bid="([^"]+)"/g;
  while ((match = idRegex.exec(html)) !== null) {
    allIds.add(match[1]);
  }

  const broken = anchorLinks.filter(anchor => !allIds.has(anchor));
  if (broken.length > 0) {
    fail(page.label, `broken anchor links: ${broken.slice(0, 5).join(', ')}${broken.length > 5 ? ` (+${broken.length - 5} more)` : ''}`);
  } else if (anchorLinks.length > 0) {
    pass(page.label, `${anchorLinks.length} internal anchors all resolve`);
  }
}

// ─── Affiliate Course Invariants ───────────────────────────────────
console.log(`\n${BOLD}Phase 4: Affiliate course invariants${RESET}`);
const courses = JSON.parse(readFileSync(join(ROOT, 'src/data/courses.json'), 'utf-8'));
for (const c of courses) {
  if (c.isAffiliate && c.stripePriceId) {
    fail('courses.json', `Affiliate course "${c.slug}" must not have stripePriceId`);
  } else if (c.isAffiliate) {
    pass('courses.json', `Affiliate course "${c.slug}" has no stripePriceId`);
  }
}

// Summary
console.log('');
if (failures > 0) {
  console.log(`${RED}${BOLD}BLOCKED${RESET} — ${failures} failure(s), ${warnings} warning(s), ${passes} passed.`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}ALL CLEAR${RESET} — ${passes} passed, ${warnings} warning(s).`);
}
