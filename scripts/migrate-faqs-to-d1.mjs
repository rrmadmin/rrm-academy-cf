#!/usr/bin/env node
/**
 * migrate-faqs-to-d1.mjs
 *
 * Reads src/data/faqs.json and generates SQL INSERT statements for:
 *   - faq (main record)
 *   - faq_resource (external evidence URLs)
 *   - faq_library_ref (article cross-refs -- slugs only, article_id needs manual resolution)
 *
 * Usage:
 *   node scripts/migrate-faqs-to-d1.mjs > scripts/migrate-faqs-data.sql
 *   npx wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-data.sql
 */

import { readFileSync } from 'fs';
import { createHash, randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const faqs = JSON.parse(readFileSync(join(projectRoot, 'src/data/faqs.json'), 'utf-8'));

// Escape single quotes for SQL
function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// Generate faq_ prefixed ID (faq_ + 32 hex chars = 36 chars total)
function genId() {
  return 'faq_' + randomBytes(16).toString('hex');
}

const lines = [];
const now = new Date().toISOString();

lines.push(`-- FAQ migration data (auto-generated from faqs.json)`);
lines.push(`-- Generated: ${now}`);
lines.push(`-- Source: 25 FAQs from Airtable (cached in src/data/faqs.json)`);
lines.push(`-- Run: npx wrangler d1 execute rrm-auth --remote --file=scripts/migrate-faqs-data.sql`);
lines.push(``);
// D1 remote execution does not support BEGIN/COMMIT transaction blocks.
// Statements are executed as individual operations.

let totalResources = 0;
let totalLibraryRefs = 0;

for (const faq of faqs) {
  const id = genId();

  // Main faq row
  const cols = [
    'id',
    'faq_code',
    'slug',
    'question',
    'basic_answer',
    'schema_answer',
    'published_answer',
    'category',
    'seo_title',
    'seo_description',
    'sort_order',
    'status',
  ].join(', ');

  const vals = [
    esc(id),
    esc(faq.faqId),
    esc(faq.slug),
    esc(faq.question),
    esc(faq.basicAnswer ?? null),
    esc(faq.schemaAnswer ?? null),
    esc(faq.publishedAnswer ?? null),
    esc(faq.category),
    esc(faq.seoTitle ?? null),
    esc(faq.seoDescription ?? null),
    faq.sortOrder !== undefined ? faq.sortOrder : 'NULL',
    esc('published'),
  ].join(', ');

  lines.push(`-- ${faq.faqId}: ${faq.question.substring(0, 60)}`);
  lines.push(`INSERT INTO faq (${cols}) VALUES (${vals});`);

  // faq_resource rows (external evidence URLs)
  if (faq.evidence && faq.evidence.length > 0) {
    for (let i = 0; i < faq.evidence.length; i++) {
      const ev = faq.evidence[i];
      lines.push(
        `INSERT INTO faq_resource (faq_id, title, url, sort_order) VALUES (${esc(id)}, ${esc(ev.title)}, ${esc(ev.url)}, ${i});`
      );
      totalResources++;
    }
  }

  // faq_library_ref rows (article cross-refs -- slug-only, article_id requires manual lookup)
  if (faq.libraryRefs && faq.libraryRefs.length > 0) {
    for (const ref of faq.libraryRefs) {
      lines.push(
        `-- MANUAL RESOLUTION NEEDED: faq_library_ref for ${faq.faqId} -> article slug="${ref.slug}" (${ref.shortCitation})`
      );
      lines.push(
        `-- INSERT INTO faq_library_ref (faq_id, article_id, sort_order) VALUES (${esc(id)}, '<resolve article_id for slug: ${ref.slug}>', 0);`
      );
      totalLibraryRefs++;
    }
  }

  lines.push(``);
}

// End of migration statements
lines.push(`-- Total: ${faqs.length} FAQs, ${totalResources} resources, ${totalLibraryRefs} library refs (commented out -- need manual article_id resolution)`);

process.stdout.write(lines.join('\n') + '\n');
