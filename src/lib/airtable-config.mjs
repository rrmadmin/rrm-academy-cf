/**
 * Shared Airtable configuration for the ⚡️ Library (yellowbase) data pipeline.
 *
 * Source: ⚡️ Library base (app78UTVdeFph9qhL), ⚡️ Synced Literature table
 * Greenbase (appyZWo2G7iByXCgZ) is the master enrichment base; this is the
 * curated sync used for the public website.
 *
 * Used by:
 *   - airtable.ts      (Astro build-time — reads cache or fetches live)
 *   - fetch-data.mjs   (standalone CLI — writes cache to articles.json)
 *
 * Using .mjs so both TypeScript (via Vite) and plain Node scripts can import it.
 */

export const AIRTABLE_BASE_ID = 'app78UTVdeFph9qhL';
export const TABLE_ID = 'tblbfEaSKygpzSoSq';
export const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_ID}`;

export const FIELDS = [
  '⚡️ Title',
  '⚡️ Author(s)',
  '⚡️ Year',
  '⚡️ Abstract',
  '⚡️ Journal',
  '⚡️ Journal Abbv',
  '⚡️ DOI',
  '⚡️ Source URL',
  '⚡️ SEO:Slug',
  '⚡️ Date Published',
  '⚡️ Volume',
  '⚡️ Issue',
  '⚡️ Pages',
  '⚡️ Keywords',
  '⚡️ Citation',            // APA citation
  '⚡️ Vancouver Citation',
  '⚡️ MLA Citation',
  '⚡️ Short Citation',
  '⚡️ Is Open Access',      // '©' or 'Open Access'
  '⚡️ Sentiment (AI)',
  '⚡️ RRM Relevance (AI)',
  '⚡️ Domain (AI)',
  '⚡️ Topics (AI)',
  '⚡️ Search Terms (AI)',
  '⚡️ Source Type',
  'Sync to RRM Library',    // filter: only 'Synced' records
];
