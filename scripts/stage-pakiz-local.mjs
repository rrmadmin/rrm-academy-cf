import { readFile, writeFile } from 'node:fs/promises';

const POSTS_PATH = 'src/data/posts.json';
const DRAFT_PATH = 'drafts/pakiz-post-content.md';

const content = await readFile(DRAFT_PATH, 'utf8');
const posts = JSON.parse(await readFile(POSTS_PATH, 'utf8'));

const slug = 'rrm-physician-spotlight-kristina-pakiz-md';
const filtered = posts.filter(p => p.slug !== slug);

const entry = {
  id: 'draft-pakiz-local',
  slug,
  title: 'RRM Physician Spotlight: Kristina Pakiz, MD',
  excerpt: 'For women battling chronic pelvic pain, endometriosis, and infertility, Dr. Kristina Pakiz, FACOG, CFCMC, offers hope through advanced minimally invasive surgery and the restorative principles of NaProTechnology.',
  content,
  author: 'RRM Academy',
  contentPillar: 'Personal/Practice',
  coverImageUrl: 'http://localhost:4330/images/commentary/rrm-physician-spotlight-kristina-pakiz-md.webp',
  publishDate: '2026-04-24',
  wordCount: 1606,
  seoKeywords: 'kristina pakiz, rrm physician, napro, omaha, vivify fertility, endometriosis, minimally invasive gynecologic surgery, restorative reproductive medicine, MIGS, laser excision',
  audioUrl: '',
  lastModified: new Date().toISOString(),
};

filtered.unshift(entry);
await writeFile(POSTS_PATH, JSON.stringify(filtered, null, 2) + '\n');
console.log(`staged: ${slug} (${filtered.length} posts total)`);
