// scripts/build-og-index.mjs
//
// Builds src/data/og-index.json -- a slim { slug: {title, description} } map
// consumed by functions/og/[[path]].js at request time for on-demand OG image
// rendering. Runs as part of the deploy pipeline after all content JSON files
// have been fetched.
//
// Key format mirrors routeToOgSlug() in src/layouts/BaseLayout.astro:
//   /                       -> "homepage"
//   /about                  -> "about"
//   /library/<slug>         -> "library-<slug>"
//   /commentary/<slug>      -> "commentary-<slug>"
//   /faqs/<slug>            -> "faqs-<slug>"
//   /courses/<slug>         -> "courses-<slug>"
//   /what-is-rrm            -> "what-is-rrm"
//   ...
//
// The function looks up by slug; unknown slugs fall back to the homepage card.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'src', 'data');
const OUT_PATH = join(DATA_DIR, 'og-index.json');

// Static pages -- single source of truth for non-dynamic routes. Mirrors what
// the deleted scripts/generate-og-images.mjs registry contained.
const STATIC_PAGES = {
  homepage: {
    title: 'RRM Academy',
    description: 'Evidence-based education in Restorative Reproductive Medicine. Courses, a research library, and expert guidance for patients and clinicians.',
  },
  about: {
    title: 'About RRM Academy',
    description: 'Expert-led education in restorative reproductive medicine. Clinician-taught courses and research resources, all free or low-cost.',
  },
  contact: {
    title: 'Contact Us',
    description: 'Get in touch with RRM Academy. Questions about courses, scholarships, or restorative reproductive medicine?',
  },
  donate: {
    title: 'Donate',
    description: 'Support a 501(c)(3) nonprofit advancing restorative reproductive medicine. Your donation funds free courses and research resources.',
  },
  'donate-thank-you': {
    title: 'Thank You for Your Donation',
    description: 'Your tax-deductible donation helps advance evidence-based reproductive health education.',
  },
  faqs: {
    title: 'Frequently Asked Questions',
    description: 'Common questions about restorative reproductive medicine, NaProTechnology, fertility awareness, and RRM Academy.',
  },
  ask: {
    title: 'Ask RRM Academy',
    description: 'Ask a question about restorative reproductive medicine. Answers drawn from the RRM Academy research library, FAQs, and pillar guides.',
  },
  library: {
    title: 'Research Library',
    description: 'The largest free collection of RRM research. Peer-reviewed articles on endometriosis, PCOS, infertility, and reproductive health.',
  },
  commentary: {
    title: 'Commentary',
    description: 'Expert commentary on restorative reproductive medicine from Dr. Naomi Whittaker. Research updates, patient advocacy, and clinical insights.',
  },
  courses: {
    title: 'Courses',
    description: 'Online courses in endometriosis, fertility, PCOS, and restorative reproductive medicine.',
  },
  community: {
    title: 'Community',
    description: 'Join the RRM Academy community. Connect with patients and healthcare providers committed to restorative reproductive medicine.',
  },
  'community-events': {
    title: 'Community Events',
    description: 'Upcoming and past events for Save the Uterus Club members.',
  },
  'community-members': {
    title: 'Community Members',
    description: 'Members of the Save the Uterus Club community.',
  },
  guides: {
    title: 'Guides',
    description: 'In-depth guides on restorative reproductive medicine, NaProTechnology, and fertility awareness.',
  },
  'terms-of-use': {
    title: 'Terms of Use',
    description: 'Terms of Use for the RRM Academy website.',
  },
  'privacy-policy': {
    title: 'Privacy Policy',
    description: 'Learn how we collect, use, and protect your information.',
  },
  'medical-disclaimer': {
    title: 'Medical Disclaimer',
    description: 'This site provides educational content about restorative reproductive medicine and does not constitute medical advice.',
  },
  // Pillar entries (what-is-rrm, naprotechnology, femm, neofertility,
  // common-questions-about-rrm, glossary, art-registries-and-codes, pcos)
  // are merged in from ssot/pillars.json below using og_title + og_description.
  // Do not hardcode them here.
  'endo-survey': {
    title: 'Endometriosis Survey',
    description: 'Do your symptoms point to endometriosis? This evidence-based self-survey helps you assess your level of suspicion.',
  },
  'endo-survey-take': {
    title: 'Take the Endometriosis Survey',
    description: 'Complete the 3-Tier Endometriosis Symptom Self-Survey developed by Dr. Naomi Whittaker.',
  },
  'ivf-success-calculator': {
    title: 'IVF Success Rate Calculator',
    description: 'Evidence-based IVF success rate estimates from HFEA mandatory reporting data. See realistic odds by age, not clinic marketing.',
  },
  'save-the-uterus-club': {
    title: 'Save the Uterus Club',
    description: 'Join a community of patients and providers committed to restorative reproductive medicine.',
  },
  'save-the-uterus-club-thank-you': {
    title: 'Welcome to Save the Uterus Club',
    description: 'You\u2019re officially a member. Here\u2019s how to get started.',
  },
  partners: {
    title: 'Educational Partners',
    description: 'Clinics and organizations that publicly affirm the principles of restorative reproductive medicine.',
  },
  'partners-apply': {
    title: 'Apply to Become a Friend',
    description: 'Affirm the three RRM principles and the clinical scope. Apply to join the RRM Academy Friends directory.',
  },
  policies: {
    title: 'Editorial Policies',
    description: 'How RRM Academy sources, reviews, and corrects its content.',
  },
  'policies-editorial': {
    title: 'Editorial Policy',
    description: 'Who writes and reviews content on RRM Academy, and how editorial decisions are made.',
  },
  'policies-corrections': {
    title: 'Corrections Policy',
    description: 'How RRM Academy surfaces and corrects errors in published content.',
  },
  'policies-fact-checking': {
    title: 'Fact-Checking Policy',
    description: 'How claims on RRM Academy are verified before publication.',
  },
  404: {
    title: 'Page Not Found',
    description: 'The page you\u2019re looking for doesn\u2019t exist or has been moved.',
  },
};

// Satori truncates descriptions at ~120 chars anyway. Clamp at the source to
// keep og-index.json lean -- a single research abstract can be 2 KB, and 3200
// of them is ~6 MB of dead weight in the Pages Function bundle.
const MAX_TITLE_LEN = 180;
const MAX_DESC_LEN = 240;
function clamp(s, max) {
  if (!s || typeof s !== 'string') return s;
  // Codepoint-aware slice so emoji / multi-byte chars don't split.
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join('') + '\u2026';
}

// Returns parsed JSON or null when the file is absent. Throws on parse error.
// Use for REQUIRED inputs (articles.json, posts.json, faqs.json, courses.json):
// a missing file is acceptable (initial deploy, optional content type), but a
// corrupt file must fail the build loudly -- silently shipping an og-index.json
// with an empty content-type bucket means every social share of that type
// renders the fallback card for the 24h cache lifetime.
function readJsonOrThrow(name) {
  const path = join(DATA_DIR, name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Returns parsed JSON or null when the file is absent OR parse fails. Use only
// for OPTIONAL inputs (none today). Kept for future opt-in surfaces; do not
// reach for this when corrupt input should fail the build.
function readJsonOrNull(name) {
  try {
    return readJsonOrThrow(name);
  } catch (err) {
    console.warn(`[build-og-index] Skipping ${name}: ${err.message}`);
    return null;
  }
}

const readJsonSafely = readJsonOrThrow;

// Merge pillar entries from ssot/pillars.json into the OG index. og_title +
// og_description live in the SSOT so adding a new pillar doesn't require an
// edit here. clamp() applies in main() once the entries are folded into index.
function loadPillarEntries() {
  const path = join(ROOT, 'ssot', 'pillars.json');
  const registry = JSON.parse(readFileSync(path, 'utf-8'));
  const out = {};
  for (const p of registry.pillars) {
    out[p.slug] = {
      title: p.og_title || p.title,
      description: p.og_description || p.description,
    };
  }
  return out;
}

// Strip HTML tags + decode the handful of named entities that appear in
// glossary bodyHtml. The first <strong>...</strong> in a term body is the
// canonical short definition; fall back to leading prose when absent.
function extractGlossaryDescription(bodyHtml) {
  if (!bodyHtml || typeof bodyHtml !== 'string') return null;
  const strongMatch = bodyHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
  const source = strongMatch ? strongMatch[1] : bodyHtml;
  const text = source
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function main() {
  const PILLAR_ENTRIES = loadPillarEntries();
  const index = { ...STATIC_PAGES, ...PILLAR_ENTRIES };
  const counts = { static: Object.keys(STATIC_PAGES).length, pillars: Object.keys(PILLAR_ENTRIES).length, library: 0, commentary: 0, faqs: 0, courses: 0, glossary: 0 };

  const articles = readJsonSafely('articles.json');
  if (Array.isArray(articles)) {
    for (const a of articles) {
      if (!a || !a.slug) continue;
      index[`library-${a.slug}`] = {
        title: clamp(a.title || 'Research Article', MAX_TITLE_LEN),
        // description dropped from bundled entries to keep Pages Function cold-start fast.
        // Satori renders title-only cards cleanly. Descriptions remain on static pages.
      };
      counts.library += 1;
    }
  }

  const posts = readJsonSafely('posts.json');
  if (Array.isArray(posts)) {
    for (const p of posts) {
      if (!p || !p.slug) continue;
      index[`commentary-${p.slug}`] = {
        title: clamp(p.title || 'Commentary', MAX_TITLE_LEN),
        description: clamp(p.excerpt || 'Commentary from Dr. Naomi Whittaker.', MAX_DESC_LEN),
      };
      counts.commentary += 1;
    }
  }

  const faqs = readJsonSafely('faqs.json');
  if (Array.isArray(faqs)) {
    for (const f of faqs) {
      if (!f || !f.slug) continue;
      index[`faqs-${f.slug}`] = {
        title: clamp(f.question || 'FAQ', MAX_TITLE_LEN),
        description: clamp(f.basicAnswer || 'Common question about restorative reproductive medicine.', MAX_DESC_LEN),
      };
      counts.faqs += 1;
    }
  }

  const courses = readJsonSafely('courses.json');
  if (Array.isArray(courses)) {
    for (const c of courses) {
      if (!c || !c.slug) continue;
      index[`courses-${c.slug}`] = {
        title: clamp(c.title || 'Course', MAX_TITLE_LEN),
        description: clamp(c.shortDescription || c.description || 'Online course from RRM Academy.', MAX_DESC_LEN),
      };
      counts.courses += 1;
    }
  }

  // Glossary terms render under /glossary/<slug>/ which routes to og slug
  // `glossary-<slug>` in BaseLayout.routeToOgSlug(). Without this loop every
  // glossary unfurl renders the branded fallback card.
  const glossary = readJsonSafely('glossary.json');
  const glossaryTerms = Array.isArray(glossary?.terms) ? glossary.terms : [];
  for (const t of glossaryTerms) {
    if (!t || !t.slug) continue;
    const description = extractGlossaryDescription(t.bodyHtml);
    index[`glossary-${t.slug}`] = {
      title: clamp(t.name || 'Glossary Term', MAX_TITLE_LEN),
      description: clamp(description || 'A term defined in the RRM Academy glossary.', MAX_DESC_LEN),
    };
    counts.glossary += 1;
  }

  // Minimum-count assertions. Match deploy.yml CI floors so a corrupt input
  // that produces an empty content-type bucket fails the build loudly instead
  // of shipping a degraded og-index.json (every social share of that type
  // rendering the fallback card, cached at the edge for 24h). If a content
  // type is genuinely absent (initial deploy), the floor blocks; treat that
  // as a one-time override via FLOOR_OVERRIDE_<type>=0 env vars.
  const FLOORS = { library: 2500, commentary: 5, faqs: 10, courses: 1, glossary: 100 };
  const failures = [];
  for (const [type, floor] of Object.entries(FLOORS)) {
    const override = process.env[`FLOOR_OVERRIDE_${type.toUpperCase()}`];
    const effectiveFloor = override !== undefined ? Number(override) : floor;
    if (counts[type] < effectiveFloor) {
      failures.push(`${type}: ${counts[type]} (floor ${effectiveFloor})`);
    }
  }
  if (failures.length > 0) {
    console.error(`[build-og-index] FLOOR FAILURE: ${failures.join(', ')}`);
    console.error('[build-og-index] og-index.json NOT written. Investigate source JSON corruption or set FLOOR_OVERRIDE_<TYPE>=0 if the gap is intentional.');
    process.exit(1);
  }

  writeFileSync(OUT_PATH, JSON.stringify(index));
  const sizeKb = (JSON.stringify(index).length / 1024).toFixed(1);
  console.log(
    `[build-og-index] wrote ${Object.keys(index).length} entries (${sizeKb} KB): ` +
    `${counts.static} static, ${counts.pillars} pillars, ${counts.library} library, ${counts.commentary} commentary, ` +
    `${counts.faqs} faqs, ${counts.courses} courses, ${counts.glossary} glossary`
  );
}

main();
