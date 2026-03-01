/**
 * Shared Airtable configuration for the BIFID (Research Library) data pipeline.
 *
 * Used by:
 *   - airtable.ts      (Astro build-time — reads cache or fetches live)
 *   - fetch-data.mjs   (standalone CLI — writes cache to articles.json)
 *
 * Using .mjs so both TypeScript (via Vite) and plain Node scripts can import it.
 */

export const AIRTABLE_BASE_ID = 'appyZWo2G7iByXCgZ';
export const BIFID_TABLE_ID = 'tbloxbruSGmhZ23BC';
export const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BIFID_TABLE_ID}`;

export const FIELDS = [
  '1️⃣ Title (static)',
  '1️⃣ Author(s)',
  '1️⃣ Year (static)',
  '1️⃣ Abstract (static)',
  '1️⃣ Journal (static)',
  '1️⃣ Journal Abbv (static)',
  '1️⃣ DOI (static)',
  '1️⃣ PMID (static)',
  '1️⃣ Source URL (static)',
  '1️⃣ SEO:Base-Slug (static)',
  '1️⃣ SEO:Slug',
  '1️⃣ Date Published (static)',
  '1️⃣ Volume (static)',
  '1️⃣ Issue (static)',
  '1️⃣ Pages (static)',
  '1️⃣ Keywords (static)',
  '1️⃣ APA Citation (static)',
  '1️⃣ Vancouver Citation (static)',
  '1️⃣ MLA Citation (static)',
  '1️⃣ Topics (AI)',
  '1️⃣ Search Terms (AI)',
  '1️⃣ Approved or Not',
  'Enrichment Status',
  '1️⃣ Short Citation',
  '1️⃣ Identifier (static)',
  '1️⃣ OA Type (static)',
  '1️⃣ License (static)',
  '1️⃣ OA URL (static)',
  '1️⃣ Sentiment (AI)',
];
