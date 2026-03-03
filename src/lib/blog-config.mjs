/**
 * Shared Airtable configuration for the Blog (Commentary) data pipeline.
 *
 * Used by:
 *   - blog.ts              (Astro build-time — reads cache or fetches live)
 *   - fetch-blog-data.mjs  (standalone CLI — writes cache to posts.json)
 *
 * Using .mjs so both TypeScript (via Vite) and plain Node scripts can import it.
 */

export const AIRTABLE_BASE_ID = 'app1CKV1heL0qH2Oz';
export const AIRTABLE_TABLE_ID = 'tblS8q3XHj6mhwxvl';
export const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

export const FIELDS = [
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
  'Audio URL',
];
