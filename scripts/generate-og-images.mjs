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
const STATIC_PAGES = [
  { slug: 'homepage', title: 'RRM Academy', description: 'Evidence-based education in Restorative Reproductive Medicine. Courses, a research library, and expert guidance for patients and clinicians.' },
  { slug: 'about', title: 'About RRM Academy', description: 'Expert-led education in restorative reproductive medicine. Clinician-taught courses and research resources, all free or low-cost.' },
  { slug: 'contact', title: 'Contact Us', description: 'Get in touch with RRM Academy. Questions about courses, scholarships, or restorative reproductive medicine?' },
  { slug: 'donate', title: 'Donate', description: 'Support a 501(c)(3) nonprofit advancing restorative reproductive medicine. Your donation funds free courses and research resources.' },
  { slug: 'donate-thank-you', title: 'Thank You for Your Donation', description: 'Your tax-deductible donation helps advance evidence-based reproductive health education.' },
  { slug: 'faqs', title: 'Frequently Asked Questions', description: 'Common questions about restorative reproductive medicine, NaProTechnology, fertility awareness, and RRM Academy.' },
  { slug: 'ask', title: 'Ask RRM Academy', description: 'Ask a question about restorative reproductive medicine. Answers drawn from the RRM Academy research library, FAQs, and pillar guides.' },
  { slug: 'library', title: 'Research Library', description: 'The largest free collection of RRM research. Peer-reviewed articles on endometriosis, PCOS, infertility, and reproductive health.' },
  { slug: 'commentary', title: 'Commentary', description: 'Expert commentary on restorative reproductive medicine from Dr. Naomi Whittaker. Research updates, patient advocacy, and clinical insights.' },
  { slug: 'courses', title: 'Courses', description: 'Online courses in endometriosis, fertility, PCOS, and restorative reproductive medicine.' },
  { slug: 'community', title: 'Community', description: 'Join the RRM Academy community. Connect with patients and healthcare providers committed to restorative reproductive medicine.' },
  { slug: 'community-events', title: 'Community Events', description: 'Upcoming and past events for Save the Uterus Club members.' },
  { slug: 'community-members', title: 'Community Members', description: 'Members of the Save the Uterus Club community.' },
  { slug: 'guides', title: 'Guides', description: 'In-depth guides on restorative reproductive medicine, NaProTechnology, and fertility awareness.' },
  { slug: 'terms-of-use', title: 'Terms of Use', description: 'Terms of Use for the RRM Academy website.' },
  { slug: 'privacy-policy', title: 'Privacy Policy', description: 'Learn how we collect, use, and protect your information.' },
  { slug: 'medical-disclaimer', title: 'Medical Disclaimer', description: 'This site provides educational content about restorative reproductive medicine and does not constitute medical advice.' },
  { slug: 'what-is-rrm', title: 'What Is Restorative Reproductive Medicine?', description: 'RRM diagnoses and treats root causes of infertility, endometriosis, PCOS, and recurrent miscarriage.' },
  { slug: 'naprotechnology', title: 'NaProTechnology', description: 'A complete guide to NaProTechnology: how it works, what it treats, and how to find a provider.' },
  { slug: 'common-questions-about-rrm', title: 'Common Questions About RRM', description: 'We address common questions about RRM with published evidence, acknowledge limitations, and clarify what RRM is and is not.' },
  { slug: 'endo-survey', title: 'Endometriosis Survey', description: 'Do your symptoms point to endometriosis? This evidence-based self-survey helps you assess your level of suspicion.' },
  { slug: 'ivf-success-calculator', title: 'IVF Success Rate Calculator', description: 'Evidence-based IVF success rate estimates from HFEA mandatory reporting data. See realistic odds by age, not clinic marketing.' },
  { slug: 'endo-survey-take', title: 'Take the Endometriosis Survey', description: 'Complete the 3-Tier Endometriosis Symptom Self-Survey developed by Dr. Naomi Whittaker.' },
  { slug: 'save-the-uterus-club', title: 'Save the Uterus Club', description: 'Join a community of patients and providers committed to restorative reproductive medicine.' },
  { slug: 'save-the-uterus-club-thank-you', title: 'Welcome to Save the Uterus Club', description: "You're officially a member. Here's how to get started." },
  { slug: 'partners', title: 'Educational Partners', description: 'Clinics and organizations that publicly affirm the principles of restorative reproductive medicine.' },
  { slug: 'partners-apply', title: 'Apply to Become a Friend', description: 'Affirm the three RRM principles and the clinical scope. Apply to join the RRM Academy Friends directory.' },
  { slug: '404', title: 'Page Not Found', description: "The page you're looking for doesn't exist or has been moved." },
];

// Pages that intentionally have no generated OG image.
// Dynamic route files ([slug].astro) are skipped by scanPages automatically.
const KNOWN_EXCLUDED = new Set([
  'admin/*',
  'linkinbio',
  'linkinbio/jointhecall',
  'account',
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'library/saved',
  'community/archive/*',
]);

// --- Font Loading ---
function loadFont(pkg, filename) {
  const fontPath = join(ROOT, 'node_modules', '@fontsource', pkg, 'files', filename);
  return readFileSync(fontPath);
}

// --- Build Warnings ---
function scanPages(dir, prefix = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  const routes = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      routes.push(...scanPages(fullPath, prefix + entry.name + '/'));
    } else if (entry.name.endsWith('.astro')) {
      // Skip dynamic route files (e.g. [...slug].astro, [page].astro)
      if (entry.name.includes('[')) continue;
      const route = (prefix + entry.name.replace(/\.astro$/, '').replace(/index$/, '')).replace(/\/$/, '');
      routes.push(route);
    }
  }
  return routes;
}

function checkForMissingPages(generatedSlugs) {
  const pagesDir = join(ROOT, 'src', 'pages');
  const allRoutes = scanPages(pagesDir);

  for (const route of allRoutes) {
    const isExcluded = [...KNOWN_EXCLUDED].some(pattern => {
      if (pattern.endsWith('/*')) return route.startsWith(pattern.slice(0, -2));
      return route === pattern;
    });
    if (isExcluded) continue;

    const slug = route === '' ? 'homepage' : route.replace(/\//g, '-');
    if (!generatedSlugs.has(slug)) {
      console.warn(`⚠ No OG image for /${route} — add to STATIC_PAGES or KNOWN_EXCLUDED`);
    }
  }
}

// --- Main ---
async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const cormorant600 = loadFont('cormorant-garamond', 'cormorant-garamond-latin-600-normal.woff');
  const inter400 = loadFont('inter', 'inter-latin-400-normal.woff');

  const fonts = [
    { name: 'Cormorant Garamond', data: cormorant600, weight: 600, style: 'normal' },
    { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
  ];

  // Collect all pages to generate
  const pages = [...STATIC_PAGES];

  // Load FAQ data and add individual FAQ pages
  const faqsPath = join(ROOT, 'src', 'data', 'faqs.json');
  if (existsSync(faqsPath)) {
    const faqs = JSON.parse(readFileSync(faqsPath, 'utf-8'));
    for (const faq of faqs) {
      pages.push({
        slug: `faqs-${faq.slug}`,
        title: faq.question,
        description: faq.basicAnswer || undefined,
      });
    }
  } else {
    console.warn('⚠ faqs.json not found, skipping FAQ OG images');
  }

  console.log(`Generating ${pages.length} OG image(s)...`);
  let generated = 0;

  for (const page of pages) {
    const filename = `og-${page.slug}.png`;
    const outPath = join(OUT_DIR, filename);

    const svg = await satori(ogTemplate(page.title, page.description), {
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

  // Check for pages missing from registry
  const generatedSlugs = new Set(pages.map(p => p.slug));
  checkForMissingPages(generatedSlugs);

  console.log(`✓ Generated ${generated} OG image(s) in public/images/og/`);
}

main().catch(err => {
  console.error('OG image generation failed:', err);
  process.exit(1);
});
