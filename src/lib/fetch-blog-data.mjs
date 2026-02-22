/**
 * Standalone script to fetch blog data from Airtable and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-blog-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'posts.json');

const AIRTABLE_BASE_ID = 'app1CKV1heL0qH2Oz';
const AIRTABLE_TABLE_ID = 'tblS8q3XHj6mhwxvl';
const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const FIELDS = [
  'Title',
  'Slug',
  'Content',
  'Excerpt',
  'Author',
  'Content Pillar',
  'Processed Cover URL',
  'Actual Publish Date',
  'Status',
  'Word Count',
  'SEO Keywords',
];

async function fetchAll() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) {
    console.error('Error: AIRTABLE_PAT environment variable required');
    process.exit(1);
  }

  const posts = [];
  let offset;
  let page = 0;

  const formula = encodeURIComponent("{Status}='Published'");
  const fieldsParams = FIELDS.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');

  do {
    page++;
    const url = `${API_URL}?${fieldsParams}&filterByFormula=${formula}&pageSize=100${
      offset ? `&offset=${offset}` : ''
    }`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable ${res.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;

    for (const record of data.records) {
      const f = record.fields;

      const slug = f['Slug'];
      const title = f['Title'];
      if (!slug || !title) continue;

      posts.push({
        id: record.id,
        slug: slug.trim(),
        title: title.trim(),
        excerpt: f['Excerpt'] || '',
        content: f['Content'] || '',
        author: f['Author'] || '',
        contentPillar: f['Content Pillar'] || '',
        coverImageUrl: f['Processed Cover URL'] || '',
        publishDate: f['Actual Publish Date'] || '',
        wordCount: f['Word Count'] ? Number(f['Word Count']) : 0,
        seoKeywords: f['SEO Keywords'] || '',
      });
    }

    console.log(`Page ${page}: ${data.records.length} records (${posts.length} published with slug)`);
  } while (offset);

  // Sort newest first
  posts.sort((a, b) => {
    if (!a.publishDate && !b.publishDate) return 0;
    if (!a.publishDate) return 1;
    if (!b.publishDate) return -1;
    return b.publishDate.localeCompare(a.publishDate);
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(posts, null, 2));
  console.log(`\nWrote ${posts.length} posts to ${OUTPUT_PATH}`);
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
