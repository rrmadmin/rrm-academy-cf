/**
 * Standalone script to fetch blog data from Airtable and cache as JSON.
 * Run: AIRTABLE_PAT=xxx node src/lib/fetch-blog-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { API_URL, FIELDS } from './blog-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'posts.json');

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

    let res;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${pat}` },
        });
        lastError = undefined;
        if (res.status !== 429) break;
      } catch (e) {
        lastError = e;
      }
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Retry ${attempt + 1}/5 in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }

    if (lastError) throw lastError;
    if (!res || !res.ok) {
      const err = res ? await res.text() : 'No response';
      throw new Error(`Airtable ${res?.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;

    for (const record of data.records) {
      const f = record.fields;

      if (f['Status'] !== 'Published') continue;
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
        audioUrl: f['Audio URL'] || '',
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

  const seen = new Set();
  const deduplicated = posts.filter(p => {
    if (seen.has(p.slug)) {
      console.warn(`Warning: duplicate slug "${p.slug}" — keeping first occurrence`);
      return false;
    }
    seen.add(p.slug);
    return true;
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(deduplicated, null, 2));
  console.log(`\nWrote ${deduplicated.length} posts to ${OUTPUT_PATH}`);
}

fetchAll().catch(err => {
  console.error(err);
  process.exit(1);
});
